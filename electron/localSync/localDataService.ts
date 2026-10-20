import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ActivityRepository } from "./activityRepository";
import { LocalActivitySource, LocalHealthDataSource } from "./activitySource";
import { encodeTrainingPlan, LOCAL_PLAN_ENTRY_ID, planWindow } from "../corosBleTrainingProtocol";
import { LocalTrainingMetrics } from "./localTrainingMetrics";
import { LocalTrainingBackend } from "./localTrainingBackend";
import { importFitFiles } from "./fitImportService";
import { HealthRepository } from "./healthRepository";
import { LocalArchive } from "./localArchive";
import { exportLocalBackup, restoreLocalBackup, backupNeedsPassphrase, removeUnfinishedRestores } from "./localBackupService";
import type { LocalDataOverview, LocalImportResult, LocalBackupResult, LocalRestoreResult, WatchSyncProbe, WatchSyncProgress } from "./localDataTypes";
import { assertReadableSyncFile, DAILY_DATA_FILE, SPORT_RECORD_FILE } from "./activityProtocol";
import { sha256Hex } from "./localArchive";
import type { SyncCaptureLog } from "./syncCapture";
import { isFitFile } from "./syncPayloadDecoder";
import { failedDecoder, INTERRUPTED_DECODE, localDeviceId, WatchActivityService, watchSyncSupport, type WatchSyncTransport } from "./watchActivityService";
import { pruneSupersededPayloads, readStoredPayload } from "./payloadRetention";
import { WatchHealthService, type DailyHistoryImport, type WatchHealthReading } from "./watchHealthService";
import type { WatchModelId } from "../watchModels";
import { NOT_AVAILABLE_ON_WATCH } from "./watchSyncModels";

/** Bump when the daily-history decoder learns new records; payloads read by another version are re-imported at startup. */
const DAILY_DECODER = "coros-daily/v1";

/**
 * Everything Local-Only Mode needs to hold data on this computer: the
 * archive, repositories, local sources, watch sync and backups. Constructed
 * once by main after the database opens. Works the same in both data modes;
 * only the Training Hub's choice of source depends on the mode.
 */

export interface LocalWatchLink {
  watch(): { serialOrName: string; name?: string; model?: WatchModelId; firmware?: string } | undefined;
  runExclusive<T>(task: () => Promise<T>): Promise<T>;
  readSyncBlock(fileIndex: number, offset: number, selector: number): Promise<{ block: Buffer; remaining: number }>;
  readPedometer(payload: Buffer): Promise<Buffer>;
  disconnect(): Promise<unknown>;
  watchKeySaved(): boolean;
  /** The training plans the watch holds, by id (read-only). */
  listTrainingPlans?(): Promise<string[]>;
  /**
   * Sends the training calendar during a sync (SendFile 42), first removing exactly the plans in
   * `replace` and refusing if the watch holds any other. A transfer that fails partway disconnects.
   */
  sendTrainingPlan?(file: Buffer, replace: readonly string[]): Promise<{ listed: boolean }>;
  /**
   * Tops up the watch's GPS assistance when COROS has newer data (satelliteSync.ts); undefined when the
   * watch doesn't need or take it. `force` (developer test) sends the newest file even when the watch has it.
   */
  sendSatelliteData?(options?: { force?: boolean }): Promise<WatchSyncProgress["satellite"]>;
}

export interface WatchCalendarMemory {
  /** The user agreed to replace a training plan CorosLink didn't put on the watch (e.g. the COROS app's). */
  replaceForeignPlan(): boolean;
  /** Content hash of the calendar last confirmed on this watch. */
  lastSent(deviceId: string): string | undefined;
  recordSent(deviceId: string, contentHash: string): void;
}

export interface LocalDataServiceOptions {
  database: Database.Database;
  userDataPath: string;
  link: LocalWatchLink;
  appVersion?: string;
  indexSummary?: (absolutePath: string, meta: { activityId: string; sportType: number; sportName?: string; name?: string; startTime?: number }) => Promise<unknown>;
  onSyncProgress?: (progress: WatchSyncProgress) => void;
  /** The COROS account fields the workout editor reads, from the watch's own profile. */
  accountProfile?: () => Record<string, unknown>;
  /** Whether a sync also puts this computer's training calendar on the watch (Local-Only Mode). */
  pushTrainingCalendar?: () => boolean;
  /** What the calendar push remembers between syncs (settings database). */
  watchCalendar?: WatchCalendarMemory;
  /** Whether syncs top up the watch's GPS assistance (Local-Only Mode; Connected Mode leaves it to the COROS app). */
  pushSatelliteData?: () => boolean;
  /** Developer protocol capture (COROSLINK_SYNC_CAPTURE=1); undefined otherwise. */
  capture?: SyncCaptureLog;
}

export class LocalDataService {
  readonly archive: LocalArchive;
  readonly activities: ActivityRepository;
  readonly health: HealthRepository;
  readonly activitySource: LocalActivitySource;
  readonly healthSource: LocalHealthDataSource;
  readonly trainingBackend: LocalTrainingBackend;
  private readonly watchActivities: WatchActivityService;
  private readonly watchHealth: WatchHealthService;

  constructor(private readonly options: LocalDataServiceOptions) {
    this.archive = LocalArchive.forUserData(options.userDataPath);
    fs.mkdirSync(this.archive.root, { recursive: true, mode: 0o700 });
    removeUnfinishedRestores(this.archive);
    this.activities = new ActivityRepository(options.database);
    this.health = new HealthRepository(options.database);
    this.activitySource = new LocalActivitySource(this.activities, this.archive, this.health);
    this.healthSource = new LocalHealthDataSource(this.health, new LocalTrainingMetrics(options.database, this.activities, this.health, this.archive));
    this.trainingBackend = new LocalTrainingBackend(options.database, () => options.accountProfile?.() ?? {});
    const identity = () => {
      const watch = options.link.watch();
      return watch ? { deviceId: localDeviceId(watch.serialOrName), name: watch.name, model: watch.model, firmware: watch.firmware } : undefined;
    };
    const transport: WatchSyncTransport = {
      identity,
      readSyncBlock: (fileIndex, offset, selector) => options.link.readSyncBlock(fileIndex, offset, selector),
      // Only after a block request that failed partway; a finished or cancelled read keeps the watch connected.
      release: async () => { await options.link.disconnect(); }
    };
    this.watchActivities = new WatchActivityService({
      repository: this.activities,
      archive: this.archive,
      transport,
      indexSummary: options.indexSummary,
      onProgress: options.onSyncProgress
    });
    this.watchHealth = new WatchHealthService(this.health, {
      identity,
      exchange: (_opcode, payload) => options.link.readPedometer(payload),
      readSyncBlock: (fileIndex, offset, selector) => options.link.readSyncBlock(fileIndex, offset, selector)
    });
  }

  /**
   * Decodes activity payloads again when the sport-record decoder version
   * changed, and re-imports daily-history payloads read by another version of
   * the daily decoder, so newly decoded records appear without a re-sync.
   * Imports are idempotent. Returns the number of activities added.
   */
  async redecodeArchivedPayloads(): Promise<number> {
    const added = await this.watchActivities.redecodeArchivedPayloads();
    // Newest first: once it decodes, the older copies it contains are removed instead of imported again.
    // A payload this decoder version already failed on waits for the next version.
    const pending = this.activities.listPayloads()
      .filter(payload => payload.fileIndex === DAILY_DATA_FILE && payload.decoder !== DAILY_DECODER && payload.decoder !== failedDecoder(DAILY_DECODER))
      .sort((a, b) => b.id - a.id);
    for (const payload of pending) {
      if (!this.activities.hasPayload(payload.id)) continue;
      const bytes = await fs.promises.readFile(this.archive.resolve(payload.filePath)).catch(() => undefined);
      if (!bytes || sha256Hex(bytes) !== payload.sha256) continue;
      // Marked failed until it has decoded, so a file that hangs or crashes the app isn't retried at every launch.
      this.activities.recordPayloadDecode(payload.id, failedDecoder(DAILY_DECODER), 0, INTERRUPTED_DECODE);
      try {
        const result = this.watchHealth.importDailyFile(payload.deviceId, bytes);
        this.activities.recordPayloadDecode(payload.id, DAILY_DECODER, result.days.length);
      } catch (error) {
        this.activities.recordPayloadDecode(payload.id, failedDecoder(DAILY_DECODER), 0, error instanceof Error ? error.message : String(error));
      }
      await this.pruneDailyCopies(payload.deviceId);
    }
    return added;
  }

  importFitFiles(paths: string[]): Promise<LocalImportResult> {
    return importFitFiles({ repository: this.activities, archive: this.archive, indexSummary: this.options.indexSummary }, paths);
  }

  /**
   * Today's totals, the daily history and activities, then the training calendar and satellite data,
   * with exclusive use of the link. Reads come first, so a write that fails and resets the link
   * can't cost the reads. Nothing is acknowledged, and the watch stays connected afterwards.
   */
  syncWatch(): Promise<WatchSyncProgress> {
    return this.options.link.runExclusive(async () => {
      this.captureWatch("sync-start");
      await this.readDayTotalsInSession().catch(() => undefined);
      // A health-history failure doesn't stop the activity read; it is reported with the result.
      const health: NonNullable<WatchSyncProgress["health"]> = await this.readDailyHistoryInSession().then(
        result => ({ ok: true, newSleeps: result.newSleeps, ...(result.latestReadingAt !== undefined ? { latestReadingAt: result.latestReadingAt } : {}) }),
        error => ({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
      try {
        const activities = await this.watchActivities.sync();
        // A cancelled sync writes nothing to the watch.
        const cancelled = activities.state === "cancelled";
        const calendar = cancelled ? undefined : await this.pushTrainingCalendarInSession();
        const satellite = !cancelled && this.options.pushSatelliteData?.() && this.options.link.sendSatelliteData
          ? await this.options.link.sendSatelliteData().catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
          : undefined;
        const progress: WatchSyncProgress = { ...activities, health, ...(calendar ? { calendar } : {}), ...(satellite ? { satellite } : {}) };
        this.options.capture?.write({ type: "sync-end", progress });
        // The whole result, for views that refresh after a sync (manual or automatic).
        this.options.onSyncProgress?.(progress);
        return progress;
      } catch (error) {
        const progress = this.watchActivities.progress();
        this.options.capture?.write({ type: "sync-end", progress, error: error instanceof Error ? error.message : String(error) });
        this.options.onSyncProgress?.({ ...progress, health });
        throw error;
      }
    });
  }

  /**
   * Puts the next 35 days of the local training calendar on the watch; a failure is reported,
   * never fatal. Only a plan CorosLink put there is replaced; a plan from elsewhere (the COROS
   * app) is left alone until the user allows replacing it. Nothing is written when the calendar
   * is already on the watch, or when there is nothing to send and no CorosLink plan to update.
   */
  private async pushTrainingCalendarInSession(): Promise<WatchSyncProgress["calendar"]> {
    const link = this.options.link;
    if (!this.options.pushTrainingCalendar?.() || !link.sendTrainingPlan || !link.listTrainingPlans) return undefined;
    try {
      const watch = link.watch();
      if (!watch) throw new Error("Connect and authenticate your watch first.");
      const deviceId = localDeviceId(watch.serialOrName);
      const now = new Date();
      const { startDay, endDay } = planWindow(now);
      const { entities, programs } = this.trainingBackend.schedule(startDay, endDay);
      const days = new Map(entities.map(entity => [String(entity.idInPlan), String(entity.happenDay)]));
      const entries = programs.map(program => ({ idInPlan: Number(program.idInPlan), happenDay: days.get(String(program.idInPlan)) ?? "", program }));
      const { file, workouts, skipped, contentHash } = encodeTrainingPlan(entries, now);
      // Workouts left off the watch are reported with every result that says what the watch holds.
      const withSkipped = Object.keys(skipped).length ? { skipped } : undefined;
      const held = await link.listTrainingPlans();
      const ours = held.includes(LOCAL_PLAN_ENTRY_ID);
      const foreign = held.filter(id => id !== LOCAL_PLAN_ENTRY_ID);
      if (!workouts && !ours) return withSkipped && { ok: true, workouts: 0, unchanged: true, ...withSkipped };
      if (foreign.length && !this.options.watchCalendar?.replaceForeignPlan()) return { ok: false, foreignPlan: true };
      if (ours && !foreign.length && this.options.watchCalendar?.lastSent(deviceId) === contentHash) return { ok: true, workouts, unchanged: true, ...withSkipped };
      const { listed } = await link.sendTrainingPlan(file, held);
      if (!listed) return { ok: false, error: "The watch didn't confirm the training calendar. Reconnect the watch and sync again." };
      this.options.watchCalendar?.recordSent(deviceId, contentHash);
      return { ok: true, workouts, listed: true, ...withSkipped };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Reads the first block of the activity file and stops there: nothing is
   * acknowledged, so the watch's sync state is not changed. Stopping between
   * blocks leaves nothing open, so the watch stays connected; only a block
   * request that failed partway disconnects, as in a sync.
   */
  probeWatchSync(options: { allBlocks?: boolean; selector?: number; fileIndex?: number } = {}): Promise<WatchSyncProbe> {
    const selector = options.selector ?? 0;
    const fileIndex = options.fileIndex ?? SPORT_RECORD_FILE;
    if (!Number.isSafeInteger(selector) || selector < 0 || selector > 0xffff) throw new Error("Invalid probe selector.");
    assertReadableSyncFile(fileIndex);
    return this.options.link.runExclusive(async () => {
      const watch = this.options.link.watch();
      const support = watchSyncSupport(watch?.model);
      if (!watch || !support.supported) throw new Error(support.reason ?? "Connect and authenticate your watch first.");
      this.captureWatch("probe-start");
      const blocks: Buffer[] = [];
      let probe: WatchSyncProbe;
      let failed = false;
      try {
        // Later blocks are requested by offset without acknowledging earlier ones, to learn whether
        // the watch serves the whole file statelessly (a read that never changes watch state).
        let total: number | undefined;
        let offset = 0;
        do {
          const { block, remaining } = await this.options.link.readSyncBlock(fileIndex, offset, selector);
          total ??= remaining;
          blocks.push(block);
          offset += block.length;
        } while (options.allBlocks && total !== undefined && offset < total && blocks.length < 2048);
        const first = blocks[0]!;
        probe = {
          ok: true,
          totalBytes: total,
          blockBytes: first.length,
          blocksRead: blocks.length,
          bytesRead: offset,
          firstBytesHex: first.subarray(0, 64).toString("hex"),
          looksLike: first.toString("latin1", 0, 2) === "HF" && first[3] === fileIndex ? "hf-container" : isFitFile(first) ? "fit" : "unknown"
        };
      } catch (error) {
        failed = true;
        probe = { ok: false, blocksRead: blocks.length, error: error instanceof Error ? error.message : String(error) };
      }
      // The watch may still be sending the block that failed; disconnecting stops it.
      if (failed) await this.options.link.disconnect().catch(() => undefined);
      this.options.capture?.write({ type: "probe-end", fileIndex, selector, probe });
      if (this.options.capture && blocks.length) {
        // Raw bytes for offline analysis, next to the frame capture.
        const file = path.join(this.options.capture.directory, `probe-${new Date().toISOString().replace(/[:.]/g, "-")}-file${fileIndex}-sel${selector}.bin`);
        await fs.promises.writeFile(file, Buffer.concat(blocks), { mode: 0o600 });
        probe.rawFile = file;
      }
      return { ...probe, ...(this.options.capture?.filePath ? { captureFile: this.options.capture.filePath } : {}) };
    });
  }

  /** Model and firmware only; the serial number never enters a capture. */
  private captureWatch(type: string): void {
    const watch = this.options.link.watch();
    // The model only: the watch's Bluetooth name carries a per-device suffix (as identifying as its serial, which is never written).
    this.options.capture?.write({ type, watch: watch ? { model: watch.model, firmware: watch.firmware } : null });
  }

  readDayTotals(): Promise<WatchHealthReading> {
    return this.options.link.runExclusive(() => this.readDayTotalsInSession());
  }

  /**
   * Developer test (COROSLINK_SYNC_CAPTURE=1, Local-Only Mode): sends the newest satellite data the
   * watch takes now, without waiting for the usual rule. Only formats checked for the model go out.
   */
  sendSatelliteDataNow(): Promise<NonNullable<WatchSyncProgress["satellite"]>> {
    const send = this.options.link.sendSatelliteData;
    if (!this.options.capture || !send) return Promise.reject(new Error("Developer tools are off."));
    if (!this.options.pushSatelliteData?.()) return Promise.reject(new Error("Satellite data is sent only in Local-Only Mode."));
    return this.options.link.runExclusive(async () => {
      const watch = this.options.link.watch();
      const support = watchSyncSupport(watch?.model);
      if (!watch || !support.supported) throw new Error(support.reason ?? "Connect and authenticate your watch first.");
      this.captureWatch("satellite-test");
      const result = await send.call(this.options.link, { force: true });
      return result ?? { ok: false, error: NOT_AVAILABLE_ON_WATCH };
    });
  }

  /** Removes stored daily-history copies that a newer decoded copy fully contains (the watch only appends to the file). */
  private pruneDailyCopies(deviceId: string): Promise<unknown> {
    return pruneSupersededPayloads({ repository: this.activities, archive: this.archive }, deviceId, DAILY_DATA_FILE, decoder => decoder === DAILY_DECODER);
  }

  /**
   * Heart rate, stress, HRV and sleep history (file 5). The raw file is
   * archived and recorded before decoding, like activity payloads, and the
   * read is recorded as a health run. Only what the watch
   * added since the stored copy is read, an unchanged file isn't stored again,
   * and older copies the new one contains are removed.
   */
  private async readDailyHistoryInSession(): Promise<DailyHistoryImport> {
    const watch = this.options.link.watch();
    if (!watch) throw new Error("Connect and authenticate your watch first.");
    const deviceId = localDeviceId(watch.serialOrName);
    const runId = this.activities.startRun("health-totals", deviceId);
    try {
      const previous = this.activities.latestPayload(deviceId, DAILY_DATA_FILE);
      const previousBytes = await readStoredPayload({ repository: this.activities, archive: this.archive }, previous);
      const file = await this.watchHealth.readDailyFile(previousBytes);
      this.activities.updateRun(runId, { receivedBytes: file.length, totalBytes: file.length });
      const sha256 = sha256Hex(file);
      // Unchanged since the stored copy: nothing new is stored.
      const payload = previous && previousBytes && previous.sha256 === sha256 ? previous : this.activities.insertPayload({
        deviceId, fileIndex: DAILY_DATA_FILE, selector: 0, filePath: (await this.archive.storeContent("watch-sync", file, "bin")).relativePath, sha256, sizeBytes: file.length
      });
      // This decoder version failed on these bytes, or the app stopped while decoding them: they wait for another version.
      const known = this.activities.findPayload(deviceId, DAILY_DATA_FILE, sha256);
      if (known?.decoder === failedDecoder(DAILY_DECODER)) throw new Error(known.decodeError ?? INTERRUPTED_DECODE);
      let result: DailyHistoryImport;
      this.activities.recordPayloadDecode(payload.id, failedDecoder(DAILY_DECODER), 0, INTERRUPTED_DECODE);
      try {
        result = this.watchHealth.importDailyFile(deviceId, file);
      } catch (error) {
        this.activities.recordPayloadDecode(payload.id, failedDecoder(DAILY_DECODER), 0, error instanceof Error ? error.message : String(error));
        // An older copy this one contains, which failed the same way, is removed: the file is kept once.
        await this.pruneDailyCopies(deviceId);
        throw error;
      }
      this.activities.recordPayloadDecode(payload.id, DAILY_DECODER, result.days.length);
      await this.pruneDailyCopies(deviceId);
      this.activities.updateRun(runId, { newRecords: result.heartRateSamples + result.stressSamples + result.hrvSamples + result.newSleeps + result.newRecoveries });
      this.activities.finishRun(runId, "done");
      this.options.capture?.write({ type: "daily-history", bytes: file.length, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.activities.finishRun(runId, "failed", message);
      this.options.capture?.write({ type: "daily-history", error: message });
      throw error;
    }
  }

  private async readDayTotalsInSession(): Promise<WatchHealthReading> {
    const runId = this.activities.startRun("health-totals", undefined);
    try {
      const reading = await this.watchHealth.readDayTotals();
      this.activities.finishRun(runId, "done");
      this.options.capture?.write({ type: "day-totals", reading });
      return reading;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.activities.finishRun(runId, "failed", message);
      this.options.capture?.write({ type: "day-totals", error: message });
      throw error;
    }
  }

  syncProgress(): WatchSyncProgress {
    return this.watchActivities.progress();
  }

  cancelSync(): WatchSyncProgress {
    return this.watchActivities.cancel();
  }

  isSyncRunning(): boolean {
    return this.watchActivities.isRunning();
  }

  async overview(): Promise<LocalDataOverview> {
    const watch = this.options.link.watch();
    const support = watchSyncSupport(watch?.model);
    return {
      activities: this.activities.countActivities(),
      devices: this.activities.listDevices(),
      lastActivitySync: this.activities.lastSuccessfulRun("activities"),
      lastHealthSync: this.activities.lastSuccessfulRun("health-totals"),
      recentRuns: this.activities.recentRuns(5),
      storageBytes: await this.archive.usageBytes(),
      watchKeySaved: this.options.link.watchKeySaved(),
      watchConnected: Boolean(watch),
      watchName: watch?.name,
      watchSyncSupport: support.supported ? "experimental" : "unsupported",
      ...(support.reason ? { watchSyncUnsupportedReason: support.reason } : {}),
      healthDays: this.health.countDays(),
      captureEnabled: Boolean(this.options.capture),
      ...(this.options.capture ? { captureDirectory: this.options.capture.directory } : {})
    };
  }

  exportBackup(destination: string, passphrase?: string): Promise<LocalBackupResult> {
    return exportLocalBackup({ repository: this.activities, health: this.health, archive: this.archive, training: this.trainingBackend, appVersion: this.options.appVersion }, destination, { passphrase });
  }

  backupNeedsPassphrase(source: string): Promise<boolean> {
    return backupNeedsPassphrase(source);
  }

  restoreBackup(source: string, passphrase?: string): Promise<LocalRestoreResult> {
    return restoreLocalBackup({ repository: this.activities, health: this.health, archive: this.archive, training: this.trainingBackend }, source, { passphrase });
  }
}
