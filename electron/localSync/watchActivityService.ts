import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { corosSportName } from "../corosSportTypes";
import type { WatchModelId } from "../watchModels";
import { SPORT_RECORD_FILE, SyncFileChangedError, SyncFileCursor } from "./activityProtocol";
import type { ActivityRepository, LocalSyncPayload } from "./activityRepository";
import type { LocalArchive } from "./localArchive";
import { fsyncDirectory, sha256File, sha256Hex } from "./localArchive";
import type { WatchSyncProgress } from "./localDataTypes";
import { nextOffsetAfterStoredCopy, pruneSupersededPayloads, readStoredPayload } from "./payloadRetention";
import { COROS_SPORT_RECORD_DECODER, decodeSportSyncPayload } from "./syncPayloadDecoder";
import { EXPERIMENTAL_SYNC_MODELS } from "./watchSyncModels";

/**
 * Reads recorded activities directly from the watch over Bluetooth.
 *
 * Read-only by design: the watch serves the sport-record file block by block
 * at any offset without acknowledgements (verified on a PACE 4, W336
 * V3.2008.0, 2026-10-18), so CorosLink never acknowledges a block and never
 * changes the watch's sync state. Each block is a request of its own, so a
 * finished or cancelled read leaves nothing to close: the watch stays
 * connected and answers the next request, as the COROS app relies on after a
 * cancel. Only a read that failed partway disconnects, which stops a block the
 * watch may still be sending (as for every other interrupted transfer).
 *
 * Data-safety rules:
 * - every block is CRC-checked by the transport, written to a partial file
 *   and fsynced before the next one is requested;
 * - progress is checkpointed after every block, so a disconnect resumes
 *   from the last durable offset instead of starting over;
 * - the watch only appends to the file, so a sync starts from the copy stored
 *   last time and reads only what was added, after confirming the watch's
 *   first block and the stored copy's last page are unchanged; a file that
 *   shrank or was rewritten is read in full (`payloadRetention.ts`);
 * - a stored copy that a newer, decoded copy fully contains is removed, so
 *   the archive holds about one copy of the file however often it syncs;
 * - a payload that cannot be decoded, or whose decoding crashed or hung the
 *   app, stays archived with its error and is tried again only by another
 *   decoder version, never on every sync or launch;
 * - the completed payload is archived unchanged (content-addressed) before
 *   any decoding, so a better decoder can reprocess it later;
 * - only read requests are sent: never an acknowledgement, a write or a delete.
 */

export interface WatchIdentity {
  deviceId: string;
  name?: string;
  model?: WatchModelId;
  firmware?: string;
}

export interface WatchSyncTransport {
  /** The connected, authenticated watch, or undefined. */
  identity(): WatchIdentity | undefined;
  readSyncBlock(fileIndex: number, offset: number, selector: number): Promise<{ block: Buffer; remaining: number }>;
  /** Disconnects, to stop a block the watch may still be sending; called only when a read failed partway. */
  release(): Promise<void>;
}

export function watchSyncSupport(model: WatchModelId | undefined): { supported: boolean; reason?: string } {
  if (!model) return { supported: false, reason: "Connect and authenticate your watch first." };
  if (!EXPERIMENTAL_SYNC_MODELS.has(model)) {
    return { supported: false, reason: "Watch sync isn't available for this watch model yet." };
  }
  return { supported: true };
}

/** A stable local id for a watch that never exposes the serial number itself. */
export function localDeviceId(serialOrName: string): string {
  return `dev-${createHash("sha256").update(`coroslink-device:${serialOrName}`).digest("hex").slice(0, 20)}`;
}

export class WatchSyncCancelledError extends Error {
  constructor() {
    super("Watch sync was cancelled.");
    this.name = "WatchSyncCancelledError";
  }
}

export interface WatchActivityServiceOptions {
  repository: ActivityRepository;
  archive: LocalArchive;
  transport: WatchSyncTransport;
  indexSummary?: (absolutePath: string, meta: { activityId: string; sportType: number; sportName?: string; name?: string; startTime?: number }) => Promise<unknown>;
  onProgress?: (progress: WatchSyncProgress) => void;
  now?: () => number;
}

const SELECTOR = 0;

/** Decoder name recorded for a payload this decoder version could not decode; another version tries again. */
export const failedDecoder = (version: string) => `failed:${version}`;
/** Recorded while a payload is being decoded; only a crash or hang mid-decode leaves it. */
export const INTERRUPTED_DECODE = "Decoding didn't finish (the app stopped or the file is too costly to decode).";
const isCurrentSportDecoder = (decoder: string | undefined) => decoder === COROS_SPORT_RECORD_DECODER;

export class WatchActivityService {
  private task?: Promise<WatchSyncProgress>;
  private cancelRequested = false;
  /** A block request was sent and its block hasn't arrived complete yet. */
  private blockInFlight = false;
  private progressState: WatchSyncProgress = { state: "idle", receivedBytes: 0, newActivities: 0, undecodedPayloads: 0 };

  constructor(private readonly options: WatchActivityServiceOptions) {}

  progress(): WatchSyncProgress {
    return { ...this.progressState };
  }

  isRunning(): boolean {
    return this.task !== undefined;
  }

  cancel(): WatchSyncProgress {
    if (this.task) this.cancelRequested = true;
    return this.progress();
  }

  /** Waits for a running sync to stop at its next block boundary. */
  async stop(): Promise<void> {
    this.cancel();
    await this.task?.catch(() => undefined);
  }

  sync(): Promise<WatchSyncProgress> {
    if (this.task) return this.task;
    this.cancelRequested = false;
    this.task = this.run().finally(() => { this.task = undefined; });
    return this.task;
  }

  private update(next: Partial<WatchSyncProgress>): void {
    this.progressState = { ...this.progressState, ...next };
    this.options.onProgress?.(this.progress());
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async run(): Promise<WatchSyncProgress> {
    const { repository, transport } = this.options;
    const identity = transport.identity();
    const support = watchSyncSupport(identity?.model);
    if (!identity || !support.supported) throw new Error(support.reason ?? "Connect and authenticate your watch first.");
    repository.upsertDevice({ deviceId: identity.deviceId, name: identity.name, model: identity.model, firmware: identity.firmware });
    const runId = repository.startRun("activities", identity.deviceId);
    this.progressState = { state: "reading", kind: "activities", receivedBytes: 0, newActivities: 0, undecodedPayloads: 0, startedAt: this.now() };
    this.update({});
    try {
      const payload = await this.readFile(identity, runId);
      if (payload) {
        this.update({ state: "decoding" });
        await this.storePayload(identity, payload);
        // Only a stored and decoded payload counts as done; a failure above re-imports it next time.
        repository.saveCheckpoint({
          deviceId: identity.deviceId, fileIndex: SPORT_RECORD_FILE, selector: SELECTOR, offsetBytes: 0,
          lastPayloadSha256: payload.sha256, lastCompleteAt: new Date(this.now()).toISOString()
        });
        await pruneSupersededPayloads(this.options, identity.deviceId, SPORT_RECORD_FILE, isCurrentSportDecoder);
      }
      repository.updateRun(runId, { newRecords: this.progressState.newActivities });
      repository.finishRun(runId, "done");
      this.update({ state: "done", finishedAt: this.now() });
      return this.progress();
    } catch (error) {
      const cancelled = error instanceof WatchSyncCancelledError;
      const message = error instanceof Error ? error.message : String(error);
      // A cancel stops between blocks; a failed block request may leave the watch sending the rest of it.
      if (!cancelled && this.blockInFlight) await transport.release().catch(() => undefined);
      repository.finishRun(runId, cancelled ? "cancelled" : "failed", message);
      this.update({ state: cancelled ? "cancelled" : "failed", error: message, finishedAt: this.now() });
      throw error;
    } finally {
      this.blockInFlight = false;
    }
  }

  /** Reads file 14 block by block; returns the completed payload path, or undefined if unchanged. */
  private async readFile(identity: WatchIdentity, runId: number): Promise<{ absolutePath: string; sha256: string } | undefined> {
    const { repository, archive, transport } = this.options;
    const checkpoint = repository.getCheckpoint(identity.deviceId, SPORT_RECORD_FILE, SELECTOR);
    const partialRelative = checkpoint?.partialPath ?? `partial/${identity.deviceId}-${SPORT_RECORD_FILE}-${SELECTOR}.part`;
    const partialPath = archive.resolve(partialRelative);
    await fs.promises.mkdir(path.dirname(partialPath), { recursive: true, mode: 0o700 });

    let resumeAt = 0;
    if (checkpoint?.partialPath && checkpoint.offsetBytes > 0) {
      const size = await fs.promises.stat(partialPath).then(stat => stat.size, () => -1);
      if (size >= checkpoint.offsetBytes) resumeAt = checkpoint.offsetBytes;
    }
    // Nothing to resume: start from the copy stored last time, and read only what the watch added since.
    let stored = resumeAt === 0 && checkpoint?.lastPayloadSha256
      ? await readStoredPayload(this.options, repository.findPayload(identity.deviceId, SPORT_RECORD_FILE, checkpoint.lastPayloadSha256))
      : undefined;
    let restarted = false;
    let cursor = new SyncFileCursor(resumeAt, resumeAt ? checkpoint?.totalBytes : undefined);
    const handle = await fs.promises.open(partialPath, resumeAt ? "r+" : "w", 0o600);
    const restartFromZero = async () => {
      stored = undefined;
      cursor = new SyncFileCursor(0);
      await handle.truncate(0);
      await handle.sync();
      repository.saveCheckpoint({ deviceId: identity.deviceId, fileIndex: SPORT_RECORD_FILE, selector: SELECTOR, partialPath: partialRelative, offsetBytes: 0,
        lastPayloadSha256: checkpoint?.lastPayloadSha256, lastCompleteAt: checkpoint?.lastCompleteAt });
    };
    try {
      // Anything past the last checkpointed offset may be incomplete; drop it.
      await handle.truncate(resumeAt);
      if (stored) await handle.write(stored, 0, stored.length, 0);
      await handle.sync();
      await fsyncDirectory(path.dirname(partialPath));
      while (!cursor.complete) {
        if (this.cancelRequested) throw new WatchSyncCancelledError();
        this.blockInFlight = true;
        const { block, remaining } = await transport.readSyncBlock(SPORT_RECORD_FILE, cursor.offset, SELECTOR);
        this.blockInFlight = false;
        let blockOffset: number;
        try {
          blockOffset = cursor.accept(block, remaining);
        } catch (error) {
          // Resuming against a file that changed (new activity recorded meanwhile): restart once from 0.
          if (!(error instanceof SyncFileChangedError) || restarted || cursor.offset === 0) throw error;
          restarted = true;
          await restartFromZero();
          continue;
        }
        let next: number | undefined;
        if (stored) {
          const plan = nextOffsetAfterStoredCopy(stored, block, blockOffset, cursor.total!);
          if (plan === "mismatch") {
            // The watch's file no longer starts with the stored copy (it shrank or was rewritten): read all of it.
            if (blockOffset !== 0) { await restartFromZero(); continue; }
            stored = undefined;
            await handle.truncate(0);
          } else {
            if (blockOffset + block.byteLength >= stored.length) stored = undefined;
            if (plan > cursor.offset) next = plan;
          }
        }
        await handle.write(block, 0, block.byteLength, blockOffset);
        await handle.datasync();
        repository.saveCheckpoint({
          deviceId: identity.deviceId, fileIndex: SPORT_RECORD_FILE, selector: SELECTOR, partialPath: partialRelative,
          offsetBytes: cursor.offset, totalBytes: cursor.total,
          lastPayloadSha256: checkpoint?.lastPayloadSha256, lastCompleteAt: checkpoint?.lastCompleteAt
        });
        repository.updateRun(runId, { receivedBytes: cursor.offset, totalBytes: cursor.total });
        this.update({ receivedBytes: cursor.offset, totalBytes: cursor.total });
        // Skip to the stored copy's last page; the bytes before it are already in the partial file.
        if (next !== undefined) cursor = new SyncFileCursor(next, cursor.total);
      }
    } finally {
      await handle.close();
    }

    const sha256 = await sha256File(partialPath);
    // The transfer is complete; the payload is marked imported by run() once it is stored.
    const done = { deviceId: identity.deviceId, fileIndex: SPORT_RECORD_FILE, selector: SELECTOR, offsetBytes: 0,
      lastPayloadSha256: checkpoint?.lastPayloadSha256, lastCompleteAt: checkpoint?.lastCompleteAt };
    if (sha256 === checkpoint?.lastPayloadSha256) {
      await fs.promises.rm(partialPath, { force: true });
      repository.saveCheckpoint(done);
      return undefined;
    }
    const relativePath = await archive.adoptFile("watch-sync", partialPath, sha256, "bin");
    repository.saveCheckpoint(done);
    return { absolutePath: archive.resolve(relativePath), sha256 };
  }

  private async storePayload(identity: WatchIdentity, payload: { absolutePath: string; sha256: string }): Promise<void> {
    const { repository, archive } = this.options;
    const bytes = await fs.promises.readFile(payload.absolutePath);
    const relativePath = archive.relative(payload.absolutePath);
    const stored = repository.insertPayload({
      deviceId: identity.deviceId, fileIndex: SPORT_RECORD_FILE, selector: SELECTOR, filePath: relativePath, sha256: payload.sha256, sizeBytes: bytes.length
    });
    const existing = stored.inserted ? undefined : repository.findPayload(identity.deviceId, SPORT_RECORD_FILE, payload.sha256);
    if (existing?.decoder === failedDecoder(COROS_SPORT_RECORD_DECODER)) {
      // This decoder version failed on these bytes, or the app stopped while decoding them: they wait for another version.
      this.update({ undecodedPayloads: this.progressState.undecodedPayloads + 1 });
      return;
    }
    const result = await this.importPayload(identity.deviceId, existing ?? { id: stored.id }, bytes);
    this.update({
      newActivities: this.progressState.newActivities + result.added,
      undecodedPayloads: this.progressState.undecodedPayloads + (result.undecoded ? 1 : 0)
    });
  }

  /**
   * Decodes archived payloads that another version of the sport-record
   * decoder failed on or decoded (whose activities then get the current
   * decoder's FIT file). Files are checked against their recorded hash first.
   * Returns the number of activities added.
   */
  async redecodeArchivedPayloads(): Promise<number> {
    if (this.task) return 0;
    const { repository, archive } = this.options;
    let added = 0;
    // Newest first: once it decodes, the older copies it contains are removed instead of decoded again.
    const pending = repository.listPayloads().filter((payload) => payload.fileIndex === SPORT_RECORD_FILE && (
      (payload.decoder?.startsWith("failed:") && payload.decoder !== failedDecoder(COROS_SPORT_RECORD_DECODER)) ||
      (payload.decoder?.startsWith("coros-sport-record/") && payload.decoder !== COROS_SPORT_RECORD_DECODER)
    )).sort((a, b) => b.id - a.id);
    for (const payload of pending) {
      if (!repository.hasPayload(payload.id)) continue;
      const absolutePath = archive.resolve(payload.filePath);
      const bytes = await fs.promises.readFile(absolutePath).catch(() => undefined);
      if (!bytes || sha256Hex(bytes) !== payload.sha256) continue;
      added += (await this.importPayload(payload.deviceId, payload, bytes)).added;
      await pruneSupersededPayloads(this.options, payload.deviceId, SPORT_RECORD_FILE, isCurrentSportDecoder);
    }
    return added;
  }

  private async importPayload(
    deviceId: string, stored: Pick<LocalSyncPayload, "id" | "decoder" | "decodedRecords" | "decodeError">, bytes: Buffer
  ): Promise<{ added: number; undecoded: boolean }> {
    const { repository } = this.options;
    let decoded: ReturnType<typeof decodeSportSyncPayload>;
    // Marked failed until it has decoded: a file that hangs or crashes the app isn't decoded again at every sync or launch.
    repository.recordPayloadDecode(stored.id, failedDecoder(COROS_SPORT_RECORD_DECODER), 0, INTERRUPTED_DECODE);
    try {
      decoded = decodeSportSyncPayload(bytes);
    } catch (error) {
      // Kept archived with the error; only another decoder version tries it again.
      repository.recordPayloadDecode(stored.id, failedDecoder(COROS_SPORT_RECORD_DECODER), 0, error instanceof Error ? error.message : String(error));
      return { added: 0, undecoded: true };
    }
    let added: number;
    try {
      added = await this.storeActivities(deviceId, stored.id, decoded.records);
    } catch (error) {
      // Storing failed (a full disk, say), not decoding: the previous state comes back, so the next sync tries again.
      repository.recordPayloadDecode(stored.id, stored.decoder, stored.decodedRecords ?? 0, stored.decodeError);
      throw error;
    }
    repository.recordPayloadDecode(stored.id, decoded.decoder, decoded.records.length, decoded.notes);
    return { added, undecoded: decoded.unrecognised > 0 };
  }

  private async storeActivities(deviceId: string, payloadId: number, records: ReturnType<typeof decodeSportSyncPayload>["records"]): Promise<number> {
    const { repository, archive } = this.options;
    let added = 0;
    const deviceShort = deviceId.replace(/^dev-/, "").slice(0, 8);
    for (const record of records) {
      const activityId = `watch-${deviceShort}-${record.watchActivityId.slice(0, 16)}`;
      const headline = record.headline;
      const fitStored = await archive.storeContent("fit", record.fit, "fit");
      const sportType = record.sportType;
      const sportName = corosSportName(sportType);
      const inserted = repository.insertActivity({
        activityId, deviceId, watchActivityId: record.watchActivityId, source: "watch-ble", provenance: "watch",
        filePath: fitStored.relativePath, payloadId, format: "fit", sha256: fitStored.sha256, sizeBytes: fitStored.sizeBytes,
        verification: "verified", sportType, sportName, name: sportName,
        startTime: headline.startTime, endTime: headline.endTime, duration: headline.duration, movingTime: headline.movingTime,
        distance: headline.distance, avgHr: headline.avgHr, maxHr: headline.maxHr, calories: headline.calories, elevationGain: headline.elevationGain
      });
      if (!inserted.inserted) {
        // The same watch activity decoded by another decoder version: keep the activity, use the current file.
        const existing = repository.findWatchActivity(deviceId, record.watchActivityId);
        if (existing && existing.format === "fit" && existing.sha256 !== fitStored.sha256 && existing.provenance === "watch") {
          repository.replaceActivityFile(existing.activityId, { filePath: fitStored.relativePath, sha256: fitStored.sha256, sizeBytes: fitStored.sizeBytes });
          if (!repository.isFileReferenced(existing.filePath)) await fs.promises.rm(archive.resolve(existing.filePath), { force: true });
          await this.options.indexSummary?.(archive.resolve(fitStored.relativePath), {
            activityId: existing.activityId, sportType, sportName, name: existing.name ?? sportName, startTime: headline.startTime
          }).catch(() => undefined);
        }
      } else {
        added += 1;
        await this.options.indexSummary?.(archive.resolve(fitStored.relativePath), {
          activityId, sportType, sportName, name: sportName, startTime: headline.startTime
        }).catch(() => undefined);
      }
    }
    return added;
  }
}
