import { describe, expect, test } from "bun:test";
import { FontCatalog, type FontCatalogRepository, type FontFileStore, type FontInspector } from "./index.js";

const rows = [
  { nameLower: "source han serif sc", fontIndex: 0, weight: 400, bold: false, italic: false, key: "regular.otf" },
  { nameLower: "source han serif sc", fontIndex: 0, weight: 700, bold: true, italic: false, key: "bold.otf" },
];
const repository = {
  lookupByNames: (names: string[]) => rows.filter((row) => names.includes(row.nameLower)),
  lookupByLooseNames: () => [], findExistingKeys: () => new Set<string>(), insertFile: () => {}, replaceFaces: () => {},
  listBrokenFiles: () => [], listFileEntries: () => [], listFiles: ({ page, limit }: { page: number; limit: number }) => ({ total: 0, page, limit, data: [] }),
  countByTopFolder: () => [], findById: () => null, findByKey: () => null, findBySha256: () => null, setSha256: () => {}, deleteByIds: () => [],
} satisfies FontCatalogRepository;
const files = { ensureReady: () => {}, get: async () => null, put: async () => {}, delete: async () => {}, exists: () => false, browse: () => ({ folders: [], files: [] }), list: () => [] } satisfies FontFileStore;
const inspector = { inspect: () => [], validate: () => ({ valid: true }) } satisfies FontInspector;
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe("FontCatalog.match", () => {
  test("selects weight-aware exact matches", () => {
    const catalog = new FontCatalog(repository, files, inspector, logger);
    const result = catalog.match([{ key: "font", nameLower: "source han serif sc", targetWeight: 700, targetItalic: false }]);
    expect(result.get("font")?.key).toBe("bold.otf");
  });

  test("strips weight suffixes before matching", () => {
    const catalog = new FontCatalog(repository, files, inspector, logger);
    const result = catalog.match([{ key: "font", nameLower: "source han serif sc bold", targetWeight: 400, targetItalic: false }]);
    expect(result.get("font")?.key).toBe("bold.otf");
  });
});
