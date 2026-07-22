import { resolve } from "node:path";
import { FontCatalog } from "@fontinass/font-catalog";
import { SqliteDatabase, SqliteFontCatalogRepository } from "@fontinass/persistence";
import { FsFontFileStore } from "@fontinass/storage";
import { OpenTypeFontInspector } from "@fontinass/subtitle-processing";
import { RuntimeLogger } from "../src/runtime.js";

const fontDirectory = resolve(process.env.FONT_DIR ?? "./fonts");
const databasePath = resolve(process.env.DB_PATH ?? "./data/fontinass-v2.db");
if (databasePath.endsWith("/fonts.db")) throw new Error("Refusing to rebuild into the legacy fonts.db path");
const logger = new RuntimeLogger({ logDirectory: resolve(process.env.LOG_DIR ?? "./data/logs"), logLevel: "info" });
const database = new SqliteDatabase(databasePath);
const files = new FsFontFileStore(fontDirectory);
files.ensureReady();
const catalog = new FontCatalog(
  new SqliteFontCatalogRepository(database), files, new OpenTypeFontInspector(), logger,
  Number.parseInt(process.env.SUBSET_CONCURRENCY ?? "5", 10),
);
const startedAt = Date.now();
console.log(`Rebuilding font index from ${fontDirectory} into ${databasePath}`);
const result = await catalog.scan();
const stats = catalog.stats();
database.close();
console.log(JSON.stringify({ ...result, indexedFiles: stats.total, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2));
if (result.errors.length) process.exitCode = 2;
