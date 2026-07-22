import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  FontCatalogRepository,
  FontFaceMetadata,
  FontFileRecord,
  FontLookupRow,
} from "@fontinass/font-catalog";
import type { ArchiveRecord, ArchiveRepository } from "@fontinass/archive-library";
import type { ApiTokenRecord, ApiTokenRepository } from "@fontinass/access-control";
import type { ActivityRepository, ProcessingEventInput } from "@fontinass/activity-log";
import type {
  ApiHistoryResponse,
  ApiTokenStats,
  ApiUploadHistoryItem,
  ApiUploadStatus,
  LogStats,
  MissingFontRanking,
  ProcessingLogList,
  UpdateApiToken,
} from "@fontinass/contracts";

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS font_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
DROP INDEX IF EXISTS idx_font_files_sha256;
CREATE INDEX IF NOT EXISTS idx_font_files_sha256 ON font_files(sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS font_faces (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES font_files(id) ON DELETE CASCADE,
  face_index INTEGER NOT NULL,
  weight INTEGER NOT NULL,
  bold INTEGER NOT NULL CHECK(bold IN (0,1)),
  italic INTEGER NOT NULL CHECK(italic IN (0,1)),
  UNIQUE(file_id, face_index)
);
CREATE INDEX IF NOT EXISTS idx_font_faces_file ON font_faces(file_id);

CREATE TABLE IF NOT EXISTS font_names (
  name_lower TEXT NOT NULL,
  face_id TEXT NOT NULL REFERENCES font_faces(id) ON DELETE CASCADE,
  PRIMARY KEY(name_lower, face_id)
);
CREATE INDEX IF NOT EXISTS idx_font_names_lower ON font_names(name_lower);

CREATE TABLE IF NOT EXISTS archives (
  id TEXT PRIMARY KEY,
  name_cn TEXT NOT NULL,
  letter TEXT NOT NULL,
  season TEXT NOT NULL,
  sub_group TEXT NOT NULL,
  languages_json TEXT NOT NULL DEFAULT '[]',
  subtitle_formats_json TEXT NOT NULL DEFAULT '[]',
  episode_count INTEGER NOT NULL DEFAULT 0,
  has_fonts INTEGER NOT NULL DEFAULT 0 CHECK(has_fonts IN (0,1)),
  filename TEXT NOT NULL,
  storage_key TEXT UNIQUE,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  pending_path TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','expired')),
  contributor TEXT,
  sub_entries_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_archives_status_sort ON archives(status, letter, name_cn, season);

CREATE TABLE IF NOT EXISTS upload_rate_limits (
  ip_hash TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(ip_hash, upload_date)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  note TEXT,
  upload_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_used_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS api_upload_history (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  font_file_id TEXT,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','duplicate','rejected','error')),
  error TEXT,
  client_ip TEXT,
  user_agent TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_upload_history_token_time ON api_upload_history(token_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS processing_events (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  client_ip TEXT,
  code INTEGER NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  missing_fonts_json TEXT NOT NULL DEFAULT '[]',
  font_count INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_processing_events_time ON processing_events(processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_events_code ON processing_events(code);

CREATE TABLE IF NOT EXISTS resolved_fonts (
  font_name TEXT PRIMARY KEY,
  resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

export class SqliteDatabase {
  readonly raw: Database;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new Database(path, { create: true });
    this.raw.run(SCHEMA);
  }

  ping(): void {
    this.raw.query("SELECT 1").get();
  }

  close(): void {
    this.raw.close();
  }
}

interface FontFileRow {
  id: string;
  filename: string;
  storage_key: string;
  size: number;
  sha256: string | null;
  created_at: string;
}

interface LookupRow {
  name_lower: string;
  face_index: number;
  weight: number;
  bold: number;
  italic: number;
  storage_key: string;
}

function toRecord(row: FontFileRow): FontFileRecord {
  return { id: row.id, filename: row.filename, key: row.storage_key, size: row.size, sha256: row.sha256, createdAt: row.created_at };
}

function toLookup(row: LookupRow): FontLookupRow {
  return { nameLower: row.name_lower, fontIndex: row.face_index, weight: row.weight, bold: row.bold === 1, italic: row.italic === 1, key: row.storage_key };
}

function chunks<T>(items: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export class SqliteFontCatalogRepository implements FontCatalogRepository {
  constructor(private readonly database: SqliteDatabase) {}

  lookupByNames(names: string[]): FontLookupRow[] {
    const rows: LookupRow[] = [];
    for (const part of chunks(names)) {
      if (!part.length) continue;
      rows.push(...this.database.raw.query<LookupRow, string[]>(`
        SELECT n.name_lower, f.face_index, f.weight, f.bold, f.italic, ff.storage_key
        FROM font_names n JOIN font_faces f ON f.id = n.face_id JOIN font_files ff ON ff.id = f.file_id
        WHERE n.name_lower IN (${placeholders(part.length)})
      `).all(...part));
    }
    return rows.map(toLookup);
  }

  lookupByLooseNames(normalizedNames: string[]): FontLookupRow[] {
    const rows: LookupRow[] = [];
    const expression = "lower(replace(replace(replace(n.name_lower, ' ', ''), '-', ''), '_', ''))";
    for (const part of chunks([...new Set(normalizedNames)], 200)) {
      if (!part.length) continue;
      rows.push(...this.database.raw.query<LookupRow, string[]>(`
        SELECT ${expression} AS name_lower, f.face_index, f.weight, f.bold, f.italic, ff.storage_key
        FROM font_names n JOIN font_faces f ON f.id = n.face_id JOIN font_files ff ON ff.id = f.file_id
        WHERE ${expression} IN (${placeholders(part.length)})
      `).all(...part));
    }
    return rows.map(toLookup);
  }

  findExistingKeys(keys: string[]): Set<string> {
    const found = new Set<string>();
    for (const part of chunks(keys)) {
      if (!part.length) continue;
      const rows = this.database.raw.query<{ storage_key: string }, string[]>(
        `SELECT storage_key FROM font_files WHERE storage_key IN (${placeholders(part.length)})`,
      ).all(...part);
      for (const row of rows) found.add(row.storage_key);
    }
    return found;
  }

  insertFile(file: Omit<FontFileRecord, "createdAt">, faces: FontFaceMetadata[]): void {
    this.database.raw.transaction(() => {
      this.database.raw.query("INSERT INTO font_files (id, filename, storage_key, size, sha256) VALUES (?, ?, ?, ?, ?)")
        .run(file.id, file.filename, file.key, file.size, file.sha256);
      this.insertFaces(file.id, faces);
    })();
  }

  replaceFaces(fileId: string, faces: FontFaceMetadata[]): void {
    this.database.raw.transaction(() => {
      this.database.raw.query("DELETE FROM font_faces WHERE file_id = ?").run(fileId);
      this.insertFaces(fileId, faces);
    })();
  }

  private insertFaces(fileId: string, faces: FontFaceMetadata[]): void {
    const faceStatement = this.database.raw.query("INSERT INTO font_faces (id, file_id, face_index, weight, bold, italic) VALUES (?, ?, ?, ?, ?, ?)");
    const nameStatement = this.database.raw.query("INSERT OR IGNORE INTO font_names (name_lower, face_id) VALUES (?, ?)");
    for (const face of faces) {
      const faceId = crypto.randomUUID();
      faceStatement.run(faceId, fileId, face.index, face.weight, Number(face.bold), Number(face.italic));
      for (const name of new Set(face.familyNames.map((value) => value.trim().toLowerCase()).filter(Boolean))) nameStatement.run(name, faceId);
    }
  }

  listBrokenFiles(): FontFileRecord[] {
    return this.database.raw.query<FontFileRow, []>(`
      SELECT ff.* FROM font_files ff WHERE NOT EXISTS (
        SELECT 1 FROM font_faces f JOIN font_names n ON n.face_id = f.id WHERE f.file_id = ff.id
      )
    `).all().map(toRecord);
  }

  listFileEntries(): FontFileRecord[] {
    return this.database.raw.query<FontFileRow, []>("SELECT * FROM font_files ORDER BY created_at, id").all().map(toRecord);
  }

  listFiles(query: { page: number; limit: number; search: string }) {
    const offset = (query.page - 1) * query.limit;
    const pattern = `%${query.search.toLowerCase()}%`;
    const where = query.search ? "WHERE lower(ff.filename) LIKE ? OR n.name_lower LIKE ?" : "";
    const parameters: SQLQueryBindings[] = query.search ? [pattern, pattern] : [];
    const total = this.database.raw.query<{ count: number }, SQLQueryBindings[]>(`
      SELECT COUNT(DISTINCT ff.id) AS count FROM font_files ff
      LEFT JOIN font_faces f ON f.file_id = ff.id LEFT JOIN font_names n ON n.face_id = f.id ${where}
    `).get(...parameters)?.count ?? 0;
    const rows = this.database.raw.query<{
      id: string; filename: string; size: number; created_at: string; names_json: string; weight: number | null; bold: number | null; italic: number | null;
    }, SQLQueryBindings[]>(`
      SELECT ff.id, ff.filename, ff.size, ff.created_at,
        json_group_array(DISTINCT n.name_lower) AS names_json,
        COALESCE(MIN(f.weight), 400) AS weight, COALESCE(MAX(f.bold), 0) AS bold, COALESCE(MAX(f.italic), 0) AS italic
      FROM font_files ff LEFT JOIN font_faces f ON f.file_id = ff.id LEFT JOIN font_names n ON n.face_id = f.id
      ${where} GROUP BY ff.id ORDER BY ff.created_at DESC LIMIT ? OFFSET ?
    `).all(...parameters, query.limit, offset);
    return {
      total, page: query.page, limit: query.limit,
      data: rows.map((row) => ({
        id: row.id, filename: row.filename, size: row.size, created_at: row.created_at,
        names: (JSON.parse(row.names_json) as Array<string | null>).filter((name): name is string => Boolean(name)),
        weight: row.weight ?? 400, bold: row.bold === 1, italic: row.italic === 1,
      })),
    };
  }

  countByTopFolder(): Array<{ prefix: string; count: number }> {
    return this.database.raw.query<{ prefix: string; count: number }, []>(`
      SELECT CASE WHEN instr(storage_key, '/') > 0 THEN substr(storage_key, 1, instr(storage_key, '/')) ELSE '(root)/' END AS prefix,
      COUNT(*) AS count FROM font_files GROUP BY prefix
    `).all();
  }

  findById(id: string): FontFileRecord | null {
    const row = this.database.raw.query<FontFileRow, [string]>("SELECT * FROM font_files WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  findByKey(key: string): FontFileRecord | null {
    const row = this.database.raw.query<FontFileRow, [string]>("SELECT * FROM font_files WHERE storage_key = ?").get(key);
    return row ? toRecord(row) : null;
  }

  findBySha256(sha256: string): (FontFileRecord & { faces: number }) | null {
    const row = this.database.raw.query<FontFileRow & { faces: number }, [string]>(`
      SELECT ff.*, (SELECT COUNT(*) FROM font_faces f WHERE f.file_id = ff.id) AS faces FROM font_files ff WHERE sha256 = ? LIMIT 1
    `).get(sha256);
    return row ? { ...toRecord(row), faces: row.faces } : null;
  }

  setSha256(id: string, sha256: string): void {
    this.database.raw.query("UPDATE font_files SET sha256 = ? WHERE id = ?").run(sha256, id);
  }

  deleteByIds(ids: string[]): FontFileRecord[] {
    if (!ids.length) return [];
    const deleted: FontFileRecord[] = [];
    this.database.raw.transaction(() => {
      for (const part of chunks(ids)) {
        const rows = this.database.raw.query<FontFileRow, string[]>(`SELECT * FROM font_files WHERE id IN (${placeholders(part.length)})`).all(...part);
        deleted.push(...rows.map(toRecord));
        this.database.raw.query(`DELETE FROM font_files WHERE id IN (${placeholders(part.length)})`).run(...part);
      }
    })();
    return deleted;
  }
}

interface ArchiveRow {
  id: string;
  name_cn: string;
  letter: string;
  season: string;
  sub_group: string;
  languages_json: string;
  subtitle_formats_json: string;
  episode_count: number;
  has_fonts: number;
  filename: string;
  storage_key: string | null;
  file_size: number;
  file_count: number;
  pending_path: string | null;
  status: ArchiveRecord["status"];
  contributor: string | null;
  sub_entries_json: string;
  created_at: string;
  updated_at: string;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toArchiveRecord(row: ArchiveRow): ArchiveRecord {
  return {
    id: row.id,
    name_cn: row.name_cn,
    letter: row.letter,
    season: row.season,
    sub_group: row.sub_group,
    languages: parseStringArray(row.languages_json),
    subtitle_formats: parseStringArray(row.subtitle_formats_json),
    episode_count: row.episode_count,
    has_fonts: row.has_fonts === 1,
    filename: row.filename,
    r2_key: row.storage_key,
    file_size: row.file_size,
    file_count: row.file_count,
    download_url: null,
    pending_path: row.pending_path,
    status: row.status,
    contributor: row.contributor,
    sub_entries: parseStringArray(row.sub_entries_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SqliteArchiveRepository implements ArchiveRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listPublished(): ArchiveRecord[] {
    return this.database.raw.query<ArchiveRow, []>("SELECT * FROM archives WHERE status = 'published' ORDER BY letter, name_cn, season, filename").all().map(toArchiveRecord);
  }

  listPending(): ArchiveRecord[] {
    return this.database.raw.query<ArchiveRow, []>("SELECT * FROM archives WHERE status = 'pending' ORDER BY created_at DESC").all().map(toArchiveRecord);
  }

  findById(id: string): ArchiveRecord | null {
    const row = this.database.raw.query<ArchiveRow, [string]>("SELECT * FROM archives WHERE id = ?").get(id);
    return row ? toArchiveRecord(row) : null;
  }

  findByStorageKey(key: string): ArchiveRecord | null {
    const row = this.database.raw.query<ArchiveRow, [string]>("SELECT * FROM archives WHERE storage_key = ?").get(key);
    return row ? toArchiveRecord(row) : null;
  }

  insert(record: ArchiveRecord): void {
    this.database.raw.query(`
      INSERT INTO archives (
        id, name_cn, letter, season, sub_group, languages_json, subtitle_formats_json,
        episode_count, has_fonts, filename, storage_key, file_size, file_count,
        pending_path, status, contributor, sub_entries_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.name_cn, record.letter, record.season, record.sub_group,
      JSON.stringify(record.languages), JSON.stringify(record.subtitle_formats), record.episode_count,
      Number(record.has_fonts), record.filename, record.r2_key, record.file_size, record.file_count,
      record.pending_path, record.status, record.contributor, JSON.stringify(record.sub_entries),
      record.created_at, record.updated_at,
    );
  }

  update(id: string, patch: Partial<ArchiveRecord>): ArchiveRecord | null {
    const columns: Array<[keyof ArchiveRecord, string, (value: ArchiveRecord[keyof ArchiveRecord] | undefined) => SQLQueryBindings]> = [
      ["name_cn", "name_cn", identity], ["letter", "letter", identity], ["season", "season", identity],
      ["sub_group", "sub_group", identity], ["languages", "languages_json", (value) => JSON.stringify(value)],
      ["subtitle_formats", "subtitle_formats_json", JSON.stringify], ["episode_count", "episode_count", identity],
      ["has_fonts", "has_fonts", (value) => Number(value)], ["filename", "filename", identity],
      ["r2_key", "storage_key", identity], ["file_size", "file_size", identity], ["file_count", "file_count", identity],
      ["pending_path", "pending_path", identity], ["status", "status", identity], ["contributor", "contributor", identity],
      ["sub_entries", "sub_entries_json", (value) => JSON.stringify(value)], ["updated_at", "updated_at", identity],
    ];
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];
    for (const [key, column, encode] of columns) {
      if (!(key in patch)) continue;
      assignments.push(`${column} = ?`);
      values.push(encode(patch[key]));
    }
    if (!assignments.length) return this.findById(id);
    this.database.raw.query(`UPDATE archives SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id);
    return this.findById(id);
  }

  delete(id: string): ArchiveRecord | null {
    const record = this.findById(id);
    if (!record) return null;
    this.database.raw.query("DELETE FROM archives WHERE id = ?").run(id);
    return record;
  }

  replacePublished(records: ArchiveRecord[]): void {
    this.database.raw.transaction(() => {
      this.database.raw.query("DELETE FROM archives WHERE status = 'published'").run();
      for (const record of records) this.insert(record);
    })();
  }

  consumeRateLimit(ipHash: string, date: string, limit: number): boolean {
    return this.database.raw.transaction(() => {
      const current = this.database.raw.query<{ count: number }, [string, string]>(
        "SELECT count FROM upload_rate_limits WHERE ip_hash = ? AND upload_date = ?",
      ).get(ipHash, date)?.count ?? 0;
      if (current >= limit) return false;
      this.database.raw.query(`
        INSERT INTO upload_rate_limits (ip_hash, upload_date, count) VALUES (?, ?, 1)
        ON CONFLICT(ip_hash, upload_date) DO UPDATE SET count = count + 1
      `).run(ipHash, date);
      return true;
    })();
  }

  expirePending(before: string): ArchiveRecord[] {
    const records = this.database.raw.query<ArchiveRow, [string]>(
      "SELECT * FROM archives WHERE status = 'pending' AND created_at < ?",
    ).all(before).map(toArchiveRecord);
    if (records.length) {
      this.database.raw.query("UPDATE archives SET status = 'expired', pending_path = NULL, updated_at = ? WHERE status = 'pending' AND created_at < ?")
        .run(new Date().toISOString(), before);
    }
    return records;
  }
}

function identity(value: ArchiveRecord[keyof ArchiveRecord] | undefined): SQLQueryBindings {
  if (value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

interface ApiTokenRow {
  id: string; name: string; prefix: string; token_hash: string; enabled: number; note: string | null;
  upload_count: number; total_bytes: number; last_used_at: string | null; last_used_ip: string | null; created_at: string;
}

function toToken(row: ApiTokenRow): ApiTokenRecord {
  return { ...row, enabled: row.enabled === 1 };
}

export class SqliteApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listTokens(): ApiTokenRecord[] {
    return this.database.raw.query<ApiTokenRow, []>("SELECT * FROM api_tokens ORDER BY created_at DESC").all().map(toToken);
  }

  findTokenById(id: string): ApiTokenRecord | null {
    const row = this.database.raw.query<ApiTokenRow, [string]>("SELECT * FROM api_tokens WHERE id = ?").get(id);
    return row ? toToken(row) : null;
  }

  findTokenByPrefix(prefix: string): ApiTokenRecord | null {
    const row = this.database.raw.query<ApiTokenRow, [string]>("SELECT * FROM api_tokens WHERE prefix = ?").get(prefix);
    return row ? toToken(row) : null;
  }

  insertToken(record: ApiTokenRecord): void {
    this.database.raw.query(`
      INSERT INTO api_tokens (id, name, prefix, token_hash, enabled, note, upload_count, total_bytes, last_used_at, last_used_ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.name, record.prefix, record.token_hash, Number(record.enabled), record.note, record.upload_count, record.total_bytes, record.last_used_at, record.last_used_ip, record.created_at);
  }

  updateToken(id: string, patch: UpdateApiToken): ApiTokenRecord | null {
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];
    if (patch.name !== undefined) { assignments.push("name = ?"); values.push(patch.name.trim()); }
    if (patch.note !== undefined) { assignments.push("note = ?"); values.push(patch.note?.trim() || null); }
    if (patch.enabled !== undefined) { assignments.push("enabled = ?"); values.push(Number(patch.enabled)); }
    if (!assignments.length) return this.findTokenById(id);
    this.database.raw.query(`UPDATE api_tokens SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id);
    return this.findTokenById(id);
  }

  deleteToken(id: string): boolean {
    return this.database.raw.query("DELETE FROM api_tokens WHERE id = ?").run(id).changes > 0;
  }

  markTokenUsed(id: string, bytes: number, ip: string | null): void {
    this.database.raw.query(`
      UPDATE api_tokens SET upload_count = upload_count + 1, total_bytes = total_bytes + ?, last_used_at = ?, last_used_ip = ? WHERE id = ?
    `).run(bytes, new Date().toISOString(), ip, id);
  }

  insertHistory(item: ApiUploadHistoryItem): void {
    this.database.raw.query(`
      INSERT INTO api_upload_history (id, token_id, font_file_id, filename, size, sha256, status, error, client_ip, user_agent, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.token_id, item.font_file_id, item.filename, item.size, item.sha256, item.status, item.error, item.client_ip, item.user_agent, item.uploaded_at);
  }

  listHistory(query: { tokenId?: string; status?: ApiUploadStatus; page: number; limit: number }): ApiHistoryResponse {
    const conditions: string[] = [];
    const parameters: SQLQueryBindings[] = [];
    if (query.tokenId) { conditions.push("token_id = ?"); parameters.push(query.tokenId); }
    if (query.status) { conditions.push("status = ?"); parameters.push(query.status); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = this.database.raw.query<{ count: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS count FROM api_upload_history ${where}`).get(...parameters)?.count ?? 0;
    const data = this.database.raw.query<ApiUploadHistoryItem, SQLQueryBindings[]>(`
      SELECT * FROM api_upload_history ${where} ORDER BY uploaded_at DESC LIMIT ? OFFSET ?
    `).all(...parameters, query.limit, (query.page - 1) * query.limit);
    return { total, page: query.page, limit: query.limit, data };
  }

  stats(): ApiTokenStats {
    const tokens = this.database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM api_tokens").get()?.count ?? 0;
    const totals = this.database.raw.query<{ uploads: number; bytes: number }, []>(
      "SELECT COALESCE(SUM(upload_count),0) AS uploads, COALESCE(SUM(total_bytes),0) AS bytes FROM api_tokens",
    ).get() ?? { uploads: 0, bytes: 0 };
    const byStatus = { success: 0, duplicate: 0, rejected: 0, error: 0 };
    for (const row of this.database.raw.query<{ status: ApiUploadStatus; count: number }, []>(
      "SELECT status, COUNT(*) AS count FROM api_upload_history GROUP BY status",
    ).all()) byStatus[row.status] = row.count;
    return { totals: { tokens, uploads: totals.uploads, bytes: totals.bytes }, byStatus };
  }
}

interface ProcessingRow {
  id: string; filename: string; code: number; messages_json: string; missing_fonts_json: string;
  font_count: number; file_size: number; elapsed_ms: number; processed_at: string;
}

function toProcessingLog(row: ProcessingRow) {
  return {
    id: row.id, filename: row.filename, code: row.code, messages: parseStringArray(row.messages_json),
    missing_fonts: parseStringArray(row.missing_fonts_json), font_count: row.font_count,
    file_size: row.file_size, elapsed_ms: row.elapsed_ms, processed_at: row.processed_at,
  };
}

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly database: SqliteDatabase) {}

  insert(input: ProcessingEventInput): void {
    this.database.raw.query(`
      INSERT INTO processing_events (id, filename, client_ip, code, messages_json, missing_fonts_json, font_count, file_size, elapsed_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), input.filename, input.clientIp, input.code, JSON.stringify(input.messages), JSON.stringify(input.missingFonts), input.fontCount, input.fileSize, input.elapsedMs);
  }

  list(query: { page: number; limit: number; search: string; code?: number }): ProcessingLogList {
    const conditions: string[] = [];
    const parameters: SQLQueryBindings[] = [];
    if (query.search) { conditions.push("(lower(filename) LIKE ? OR lower(missing_fonts_json) LIKE ?)"); parameters.push(`%${query.search}%`, `%${query.search}%`); }
    if (query.code !== undefined) { conditions.push("code = ?"); parameters.push(query.code); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = this.database.raw.query<{ count: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS count FROM processing_events ${where}`).get(...parameters)?.count ?? 0;
    const rows = this.database.raw.query<ProcessingRow, SQLQueryBindings[]>(`
      SELECT id, filename, code, messages_json, missing_fonts_json, font_count, file_size, elapsed_ms, processed_at
      FROM processing_events ${where} ORDER BY processed_at DESC LIMIT ? OFFSET ?
    `).all(...parameters, query.limit, (query.page - 1) * query.limit);
    return { total, page: query.page, limit: query.limit, data: rows.map(toProcessingLog) };
  }

  missingFonts(limit: number, showResolved: boolean): { total: number; data: MissingFontRanking[] } {
    const resolved = new Map(this.database.raw.query<{ font_name: string; resolved_at: string }, []>("SELECT * FROM resolved_fonts").all().map((row) => [row.font_name, row.resolved_at]));
    const counts = new Map<string, number>();
    for (const row of this.database.raw.query<{ missing_fonts_json: string }, []>("SELECT missing_fonts_json FROM processing_events WHERE missing_fonts_json <> '[]'").all()) {
      for (const name of parseStringArray(row.missing_fonts_json)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let data = [...counts].map(([font_name, count]) => ({ font_name, count, resolved: resolved.has(font_name), resolved_at: resolved.get(font_name) ?? null }));
    if (!showResolved) data = data.filter((item) => !item.resolved);
    data.sort((a, b) => b.count - a.count || a.font_name.localeCompare(b.font_name));
    return { total: data.length, data: data.slice(0, limit) };
  }

  resolveFont(name: string): void {
    this.database.raw.query("INSERT OR IGNORE INTO resolved_fonts (font_name) VALUES (?)").run(name);
  }

  unresolveFont(name: string): void {
    this.database.raw.query("DELETE FROM resolved_fonts WHERE font_name = ?").run(name);
  }

  stats(today: string): LogStats {
    const total = this.database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM processing_events").get()?.count ?? 0;
    const todayCount = this.database.raw.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM processing_events WHERE processed_at >= ?").get(today)?.count ?? 0;
    const counts = new Map(this.database.raw.query<{ code: number; count: number }, []>("SELECT code, COUNT(*) AS count FROM processing_events GROUP BY code").all().map((row) => [row.code, row.count]));
    const success = counts.get(200) ?? 0;
    const warnings = counts.get(201) ?? 0;
    const totalMissingFonts = this.database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM processing_events WHERE missing_fonts_json <> '[]'").get()?.count ?? 0;
    return { total, today: todayCount, success, warnings, errors: total - success - warnings, totalMissingFonts };
  }
}
