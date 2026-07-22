import { ActivityLog } from "@fontinass/activity-log";
import { TokenManager } from "@fontinass/access-control";
import { DefaultArchiveLibrary, SystemArchiveInspector, type ArchiveLibrary } from "@fontinass/archive-library";
import { FontCatalog } from "@fontinass/font-catalog";
import {
  SqliteActivityRepository,
  SqliteApiTokenRepository,
  SqliteArchiveRepository,
  SqliteDatabase,
  SqliteFontCatalogRepository,
} from "@fontinass/persistence";
import { FsFontFileStore, FsPendingArchiveStore, R2PublishedArchiveStore } from "@fontinass/storage";
import { DefaultSubtitleProcessor, OpenTypeFontInspector, type SubtitleProcessor } from "@fontinass/subtitle-processing";
import { loadRuntimeConfig, RuntimeLogger, type RuntimeConfig } from "./runtime.js";

export interface AppContainer {
  config: RuntimeConfig;
  logger: RuntimeLogger;
  database: SqliteDatabase;
  fonts: FontCatalog;
  archives: ArchiveLibrary;
  tokens: TokenManager;
  activity: ActivityLog;
  subtitles: SubtitleProcessor;
  bootstrap(): Promise<void>;
  startScheduler(): void;
  stopScheduler(): void;
  close(): void;
}

export function createContainer(config = loadRuntimeConfig()): AppContainer {
  const logger = new RuntimeLogger(config);
  const database = new SqliteDatabase(config.databasePath);
  const fontFiles = new FsFontFileStore(config.fontDirectory);
  const fonts = new FontCatalog(
    new SqliteFontCatalogRepository(database),
    fontFiles,
    new OpenTypeFontInspector(),
    logger,
    config.subsetConcurrency,
  );
  const published = new R2PublishedArchiveStore(config.r2);
  const archives = new DefaultArchiveLibrary(
    new SqliteArchiveRepository(database),
    published,
    new FsPendingArchiveStore(config.pendingDirectory),
    new SystemArchiveInspector(config.archiveMaxUncompressed),
    { maxFileSize: config.archiveMaxFileSize, dailyContributionLimit: config.contributionDailyLimit },
  );
  const tokens = new TokenManager(new SqliteApiTokenRepository(database));
  const activity = new ActivityLog(new SqliteActivityRepository(database));
  const subtitles = new DefaultSubtitleProcessor(fonts, logger, { cacheEntries: config.cacheMaxEntries });
  let interval: ReturnType<typeof setInterval> | null = null;

  return {
    config, logger, database, fonts, archives, tokens, activity, subtitles,
    async bootstrap() {
      fontFiles.ensureReady();
      logger.prune();
      if (archives.listPublished().length === 0 && published.isConfigured()) {
        try {
          const restored = await archives.restoreFromManifest();
          if (restored) logger.info(`[bootstrap] restored ${restored} archives from R2 manifest`);
        } catch (error) { logger.error("[bootstrap] archive manifest restore failed", error); }
      }
      const repair = await fonts.repairUnnamed();
      if (repair.attempted) logger.info(`[bootstrap] repaired ${repair.repaired}/${repair.attempted} unnamed font entries`);
    },
    startScheduler() {
      if (interval) return;
      const run = async () => {
        try {
          const scan = await fonts.scan();
          const dedup = await fonts.deduplicate();
          logger.info(`[scheduler] indexed=${scan.indexed} purged=${scan.purged} deduplicated=${dedup.removed}`);
        } catch (error) { logger.error("[scheduler] failed", error); }
      };
      interval = setInterval(() => void run(), config.autoIndexIntervalHours * 60 * 60 * 1000);
    },
    stopScheduler() { if (interval) clearInterval(interval); interval = null; },
    close() { if (interval) clearInterval(interval); database.close(); },
  };
}
