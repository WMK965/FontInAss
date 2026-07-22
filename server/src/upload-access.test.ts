import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as opentype from "opentype.js";
import type { ApiTokenApplication, ApiUploadResponse } from "@fontinass/contracts";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import type { RuntimeConfig } from "./runtime.js";

function fixtureFont(): Uint8Array {
  const path = new opentype.Path();
  path.moveTo(80, 0); path.lineTo(300, 700); path.lineTo(520, 0); path.close();
  const font = new opentype.Font({
    familyName: "UploadAccessFixture", styleName: "Regular", unitsPerEm: 1000, ascender: 880, descender: -120,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path }),
    ],
  });
  return new Uint8Array(font.toArrayBuffer());
}

describe("upload access HTTP flow", () => {
  test("applies, approves, claims, uploads, audits and revokes without an anonymous upload route", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fontinass-upload-flow-"));
    const config: RuntimeConfig = {
      port: 3000, apiKey: "admin-test-key", corsOrigin: "*", fontDirectory: join(directory, "fonts"),
      databasePath: join(directory, "data.db"), pendingDirectory: join(directory, "pending"), logDirectory: join(directory, "logs"),
      logLevel: "error", subsetConcurrency: 2, cacheMaxEntries: 0, uploadTargetDirectory: "Contributions/",
      uploadMaxFiles: 20, uploadMaxFileSize: 100 * 1024 * 1024, uploadMaxBatchSize: 200 * 1024 * 1024,
      uploadRequestsPerMinute: 30, tokenApplicationDailyLimit: 3,
      archiveMaxFileSize: 200 * 1024 * 1024, archiveMaxUncompressed: 2 * 1024 * 1024 * 1024,
      contributionDailyLimit: 3, autoIndexIntervalHours: 4,
      r2: { accountId: "", accessKeyId: "", secretAccessKey: "", bucketName: "", publicUrl: "" },
    };
    const container = createContainer(config);
    const app = createApp(container);
    try {
      mkdirSync(config.logDirectory, { recursive: true });
      await container.bootstrap();
      const applyResponse = await app.request("/api/token-applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicant_name: "Atlas Subs", contact: "atlas@example.com", purpose: "Upload release fonts for subtitle production" }),
      });
      expect(applyResponse.status).toBe(201);
      const receipt = await applyResponse.json() as { application: ApiTokenApplication; recovery_secret: string };

      const pendingResponse = await app.request(`/api/token-applications/${receipt.application.id}`, {
        headers: { "X-Application-Secret": receipt.recovery_secret },
      });
      expect((await pendingResponse.json() as { application: ApiTokenApplication }).application.status).toBe("pending");

      const reviewResponse = await app.request(`/api/tokens/applications/${receipt.application.id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
        body: JSON.stringify({ decision: "approve", public_note: "Approved for release fonts" }),
      });
      expect(reviewResponse.status).toBe(200);

      const claimResponse = await app.request(`/api/token-applications/${receipt.application.id}/claim`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: receipt.recovery_secret }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = await claimResponse.json() as { token: { id: string }; plaintext: string };
      expect(claimed.plaintext).toBe(receipt.recovery_secret);

      const headers = { Authorization: `Bearer ${claimed.plaintext}` };
      expect((await app.request("/api/v1/whoami", { headers })).status).toBe(200);

      const upload = async () => {
        const form = new FormData();
        form.append("file", new File([fixtureFont()], "fixture.ttf"));
        const response = await app.request("/api/v1/upload", { method: "POST", headers, body: form });
        return { response, body: await response.json() as ApiUploadResponse };
      };
      const first = await upload();
      expect(first.response.status).toBe(200);
      expect(first.body.results[0].status).toBe("success");
      const second = await upload();
      expect(second.body.results[0].status).toBe("duplicate");

      const ownHistory = await app.request("/api/v1/history?page=1&limit=20", { headers });
      expect((await ownHistory.json() as { total: number }).total).toBe(2);

      const revoke = await app.request(`/api/tokens/${claimed.token.id}`, { method: "DELETE", headers: { "X-API-Key": config.apiKey } });
      expect(revoke.status).toBe(200);
      expect((await app.request("/api/v1/whoami", { headers })).status).toBe(401);
      const adminHistory = await app.request(`/api/tokens/${claimed.token.id}/history?page=1&limit=20`, { headers: { "X-API-Key": config.apiKey } });
      expect((await adminHistory.json() as { total: number }).total).toBe(2);
      expect((await app.request("/api/upload", { method: "POST" })).status).toBe(404);
    } finally {
      container.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
