import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ApiHistoryResponse,
  ApiToken,
  ApiTokenStats,
  ApiUploadHistoryItem,
  ApiUploadStatus,
  CreateApiToken,
  UpdateApiToken,
} from "@fontinass/contracts";

export interface ApiTokenRecord extends ApiToken {
  token_hash: string;
}

export interface ApiTokenRepository {
  listTokens(): ApiTokenRecord[];
  findTokenById(id: string): ApiTokenRecord | null;
  findTokenByPrefix(prefix: string): ApiTokenRecord | null;
  insertToken(record: ApiTokenRecord): void;
  updateToken(id: string, patch: UpdateApiToken): ApiTokenRecord | null;
  deleteToken(id: string): boolean;
  markTokenUsed(id: string, bytes: number, ip: string | null): void;
  insertHistory(item: ApiUploadHistoryItem): void;
  listHistory(query: { tokenId?: string; status?: ApiUploadStatus; page: number; limit: number }): ApiHistoryResponse;
  stats(): ApiTokenStats;
}

export class TokenManager {
  constructor(private readonly repository: ApiTokenRepository) {}

  list(): ApiToken[] {
    return this.repository.listTokens().map(toView);
  }

  find(id: string): ApiToken | null {
    const record = this.repository.findTokenById(id);
    return record ? toView(record) : null;
  }

  create(input: CreateApiToken): { token: ApiToken; plaintext: string } {
    const prefix = randomBytes(6).toString("base64url").slice(0, 8);
    const plaintext = `fia_${prefix}_${randomBytes(24).toString("base64url")}`;
    const now = new Date().toISOString();
    const record: ApiTokenRecord = {
      id: crypto.randomUUID(), name: input.name.trim(), prefix, token_hash: hash(plaintext), enabled: input.enabled,
      note: input.note?.trim() || null, upload_count: 0, total_bytes: 0,
      last_used_at: null, last_used_ip: null, created_at: now,
    };
    this.repository.insertToken(record);
    return { token: toView(record), plaintext };
  }

  update(id: string, patch: UpdateApiToken): ApiToken | null {
    const record = this.repository.updateToken(id, patch);
    return record ? toView(record) : null;
  }

  delete(id: string): boolean {
    return this.repository.deleteToken(id);
  }

  verify(plaintext: string): ApiTokenRecord | null {
    const match = plaintext.match(/^fia_([^_]{8})_(.+)$/);
    if (!match) return null;
    const record = this.repository.findTokenByPrefix(match[1]);
    if (!record?.enabled || !safeEqual(hash(plaintext), record.token_hash)) return null;
    return record;
  }

  markUsed(id: string, bytes: number, ip: string | null): void {
    this.repository.markTokenUsed(id, bytes, ip);
  }

  recordUpload(input: Omit<ApiUploadHistoryItem, "id" | "uploaded_at">): void {
    this.repository.insertHistory({ ...input, id: crypto.randomUUID(), uploaded_at: new Date().toISOString() });
  }

  history(query: { tokenId?: string; status?: ApiUploadStatus; page?: number; limit?: number }): ApiHistoryResponse {
    return this.repository.listHistory({
      ...query,
      page: Math.max(1, query.page ?? 1),
      limit: Math.min(200, Math.max(1, query.limit ?? 50)),
    });
  }

  stats(): ApiTokenStats {
    return this.repository.stats();
  }
}

export function extractUploadToken(uploadHeader?: string | null, authorization?: string | null): string | null {
  if (uploadHeader?.trim()) return uploadHeader.trim();
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function toView({ token_hash: _hash, ...view }: ApiTokenRecord): ApiToken {
  return view;
}
