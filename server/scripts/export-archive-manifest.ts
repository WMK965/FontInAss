import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { ArchiveManifestSchema, type SharedArchive } from "@fontinass/contracts";
import { R2PublishedArchiveStore } from "@fontinass/storage";

interface LegacyArchiveRow {
  id: string; name_cn: string; letter: string; season: string; sub_group: string;
  languages: string; subtitle_format: string; episode_count: number; has_fonts: number;
  filename: string; r2_key: string | null; file_size: number; file_count: number;
  status: string; contributor: string | null; sub_entries: string | null; created_at: string; updated_at: string;
}

const sourcePath = resolve(process.env.LEGACY_DB_PATH ?? "./data/fonts.db");
const database = new Database(sourcePath, { readonly: true });
const rows = database.query<LegacyArchiveRow, []>(
  "SELECT * FROM shared_archives WHERE status = 'published' ORDER BY letter, name_cn, season, filename",
).all();
database.close();

const archives = rows.map((row) => {
  if (!row.r2_key) throw new Error(`Published archive ${row.id} has no R2 key`);
  return {
    id: row.id, name_cn: row.name_cn, letter: row.letter, season: row.season, sub_group: row.sub_group,
    languages: stringArray(row.languages), subtitle_formats: stringArray(row.subtitle_format),
    episode_count: row.episode_count ?? 0, has_fonts: row.has_fonts === 1,
    filename: row.filename, r2_key: row.r2_key, file_size: row.file_size, file_count: row.file_count ?? 0,
    status: "published" as const, contributor: row.contributor, sub_entries: stringArray(row.sub_entries),
    created_at: row.created_at, updated_at: row.updated_at,
  } satisfies Omit<SharedArchive, "download_url">;
});

const manifest = ArchiveManifestSchema.parse({ version: 1, generated_at: new Date().toISOString(), archives });
const store = new R2PublishedArchiveStore({
  accountId: required("R2_ACCOUNT_ID"), accessKeyId: required("R2_ACCESS_KEY_ID"),
  secretAccessKey: required("R2_SECRET_ACCESS_KEY"), bucketName: required("R2_BUCKET_NAME"),
  publicUrl: process.env.R2_PUBLIC_URL ?? "",
});
await store.writeManifest(manifest);
console.log(`Wrote archive manifest with ${archives.length} published records`);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringArray(value: string | null): string[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}
