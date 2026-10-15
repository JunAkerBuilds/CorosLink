import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ACTIVITY_SCREEN_READ, ACTIVITY_SCREEN_WRITE, activityScreenDigest, activityScreenSport,
  buildActivityScreenLayout, decodeActivityScreens, decodeActivityScreenSports, requireActivityScreenAcknowledgement,
  supportedActivityScreenFieldCounts
} from "./corosActivityScreenProtocol";
import type {
  CorosActivityScreenBackup, CorosActivityScreenDevice, CorosActivityScreenDocument,
  CorosActivityScreenPreview, CorosActivityScreenResult, CorosActivityScreenStatus
} from "./corosActivityScreenTypes";

export interface ActivityScreenDependencies {
  enabled: () => boolean;
  identity: () => CorosActivityScreenDevice;
  session: () => string;
  exchange: (opcode: number, payload: Buffer) => Promise<Buffer>;
  directory: () => string;
}
interface CachedDocument { document: CorosActivityScreenDocument; payload: Buffer; session: string }
interface BackupFile { version: 1; backup: CorosActivityScreenBackup; payloadHex: string }
interface Proof { digest: string; confirmed: boolean; session: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Development-only settings service. Backups and an unfinished-write journal survive app restarts. */
export class CorosActivityScreenService {
  private documents = new Map<string, CachedDocument>();
  private previews = new Map<string, { preview: CorosActivityScreenPreview; payload: Buffer }>();
  private proofs = new Map<string, Proof>();
  constructor(private readonly deps: ActivityScreenDependencies) {}

  private requireEnabled(): void {
    if (!this.deps.enabled()) throw new Error("Activity-screen sync is available only in development builds.");
  }
  private proofKey(device: CorosActivityScreenDevice, sportId: number): string {
    return JSON.stringify([device.key, device.firmware, sportId]);
  }
  private hasExperimentalPages(document: CorosActivityScreenDocument): boolean {
    return document.pages.some(page => page.kind === "grid" && ![2, 3, 4, 6, 8].includes(page.fieldCount!));
  }
  private identity(): CorosActivityScreenDevice {
    this.requireEnabled();
    const device = this.deps.identity();
    if (device.model !== "pace-pro" || !device.key || !device.firmware) throw new Error("Connect an authenticated PACE Pro with a known firmware version.");
    return device;
  }
  private async exchange(opcode: number, payload: Buffer, session: string): Promise<Buffer> {
    if (this.deps.session() !== session) throw new Error("The watch connection changed. Read its pages again.");
    const result = await this.deps.exchange(opcode, payload);
    if (this.deps.session() !== session) throw new Error("The watch connection changed during activity-page sync.");
    return result;
  }
  private remember(payload: Buffer, device: CorosActivityScreenDevice, session: string): CorosActivityScreenDocument {
    const sportId = payload[0]!, pages = decodeActivityScreens(payload, sportId), digest = activityScreenDigest(payload);
    const key = this.proofKey(device, sportId), proof = this.proofs.get(key);
    if (proof && (proof.digest !== digest || proof.session !== session)) this.proofs.delete(key);
    const valid = this.proofs.get(key);
    const document: CorosActivityScreenDocument = {
      id: randomUUID(), device: { ...device }, sport: activityScreenSport(sportId), readAt: Date.now(),
      digest, recordBytes: 44, pages, baseline: valid ? valid.confirmed ? "watch-confirmed" : "read-back-verified" : "unverified"
    };
    if (this.documents.size >= 30) this.documents.delete(this.documents.keys().next().value!);
    this.documents.set(document.id, { document, payload: Buffer.from(payload), session });
    return document;
  }
  private cached(id: unknown): CachedDocument {
    const cached = typeof id === "string" ? this.documents.get(id) : undefined;
    const device = this.identity();
    if (!cached || cached.session !== this.deps.session() || cached.document.device.key !== device.key ||
        cached.document.device.firmware !== device.firmware || Date.now() - cached.document.readAt > 15 * 60_000) {
      throw new Error("Read the watch's current activity pages again before continuing.");
    }
    return cached;
  }
  private async readPayload(sportId: number, session: string): Promise<Buffer> {
    activityScreenSport(sportId);
    const payload = await this.exchange(ACTIVITY_SCREEN_READ, Buffer.from([sportId]), session);
    decodeActivityScreens(payload, sportId);
    return payload;
  }
  async sports() {
    this.identity();
    return decodeActivityScreenSports(await this.exchange(ACTIVITY_SCREEN_READ, Buffer.from([255]), this.deps.session()));
  }
  async read(sportId: number): Promise<CorosActivityScreenDocument> {
    const device = this.identity(), session = this.deps.session();
    return this.remember(await this.readPayload(sportId, session), device, session);
  }
  private async directory(): Promise<string> {
    const directory = this.deps.directory();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }
  private backupPath(directory: string, id: string): string {
    if (!UUID.test(id)) throw new Error("Choose a saved activity-page backup.");
    return path.join(directory, `${id}.json`);
  }
  private async durableFile(filename: string, content: string): Promise<void> {
    const file = await fs.open(filename, "wx", 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  }
  private async saveBackup(payload: Buffer, device: CorosActivityScreenDevice, reason: CorosActivityScreenBackup["reason"]): Promise<CorosActivityScreenBackup> {
    const sportId = payload[0]!, pages = decodeActivityScreens(payload, sportId);
    if (!pages.length) throw new Error("Empty settings cannot be backed up for sync because writing them restores factory defaults.");
    const backup: CorosActivityScreenBackup = {
      id: randomUUID(), createdAt: Date.now(), device: { ...device }, sport: activityScreenSport(sportId),
      pageCount: pages.length, digest: activityScreenDigest(payload), reason
    };
    const stored: BackupFile = { version: 1, backup, payloadHex: payload.toString("hex") };
    await this.durableFile(this.backupPath(await this.directory(), backup.id), JSON.stringify(stored, null, 2) + "\n");
    return backup;
  }
  private async loadBackup(id: string): Promise<BackupFile> {
    this.requireEnabled();
    const filename = this.backupPath(await this.directory(), id);
    if ((await fs.stat(filename)).size > 32_768) throw new Error("The activity-page backup is too large.");
    const value = JSON.parse(await fs.readFile(filename, "utf8")) as BackupFile;
    if (value?.version !== 1 || value.backup?.id !== id || !value.backup.device?.key || value.backup.device.model !== "pace-pro" ||
        !Number.isFinite(value.backup.createdAt) || !["manual", "before-sync", "before-restore"].includes(value.backup.reason) ||
        typeof value.payloadHex !== "string" || !/^[0-9a-f]+$/.test(value.payloadHex) || value.payloadHex.length % 2) {
      throw new Error("The activity-page backup is invalid.");
    }
    const payload = Buffer.from(value.payloadHex, "hex"), pages = decodeActivityScreens(payload, value.backup.sport.id);
    if (!pages.length || pages.length !== value.backup.pageCount || activityScreenDigest(payload) !== value.backup.digest) {
      throw new Error("The activity-page backup failed its integrity check.");
    }
    return value;
  }
  async backups(): Promise<CorosActivityScreenBackup[]> {
    this.requireEnabled();
    const names = await fs.readdir(await this.directory()), backups: CorosActivityScreenBackup[] = [];
    for (const name of names.filter(name => name.endsWith(".json") && UUID.test(name.slice(0, -5)))) {
      try { backups.push((await this.loadBackup(name.slice(0, -5))).backup); } catch { /* A broken backup is never offered for restoration. */ }
    }
    return backups.sort((a, b) => b.createdAt - a.createdAt);
  }
  async backup(snapshotId: string): Promise<CorosActivityScreenBackup> {
    const cached = this.cached(snapshotId), payload = await this.requireUnchanged(cached);
    return this.saveBackup(payload, this.identity(), "manual");
  }
  private async requireUnchanged(cached: CachedDocument): Promise<Buffer> {
    const payload = await this.readPayload(cached.document.sport.id, cached.session);
    if (!payload.equals(cached.payload)) throw new Error("The watch's activity pages changed. Read them again before syncing.");
    return payload;
  }
  private async journal(backupId: string): Promise<void> {
    const directory = await this.directory(), temporary = path.join(directory, `pending-${randomUUID()}.tmp`);
    await this.durableFile(temporary, JSON.stringify({ version: 1, backupId }) + "\n");
    await fs.rename(temporary, path.join(directory, "pending-restore.json"));
  }
  private async clearJournal(): Promise<void> {
    await fs.rm(path.join(await this.directory(), "pending-restore.json"), { force: true });
  }
  async status(): Promise<CorosActivityScreenStatus> {
    if (!this.deps.enabled()) return { enabled: false, pendingRestore: null, supportedFieldCounts: [] };
    const filename = path.join(await this.directory(), "pending-restore.json");
    let content: string;
    try {
      if ((await fs.stat(filename)).size > 1024) throw new Error("The pending activity-page restore journal is invalid.");
      content = await fs.readFile(filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, pendingRestore: null, supportedFieldCounts: supportedActivityScreenFieldCounts() };
      throw error;
    }
    const journal = JSON.parse(content);
    if (journal?.version !== 1 || typeof journal.backupId !== "string" || !UUID.test(journal.backupId)) {
      throw new Error("The pending activity-page restore journal is invalid.");
    }
    // A journal whose backup is missing must block writes, never look like a completed sync.
    const pendingRestore = (await this.loadBackup(journal.backupId)).backup;
    return { enabled: true, pendingRestore, supportedFieldCounts: supportedActivityScreenFieldCounts() };
  }
  async exportBackup(id: string): Promise<string> {
    return JSON.stringify(await this.loadBackup(id), null, 2) + "\n";
  }
  private async write(payload: Buffer, before: Buffer, device: CorosActivityScreenDevice, session: string,
      reason: CorosActivityScreenBackup["reason"], restoreTargetId?: string): Promise<CorosActivityScreenResult> {
    const sportId = payload[0]!;
    if (!decodeActivityScreens(payload, sportId).length) throw new Error("Sending empty settings would reset the activity. Use a nonempty captured backup.");
    const pending = (await this.status()).pendingRestore;
    if (pending && pending.id !== restoreTargetId) throw new Error("Restore the previous activity-page backup before another write.");
    const backup = await this.saveBackup(before, device, reason);
    // Durable backup and journal are committed BEFORE the first write, even for the unchanged baseline.
    const recoveryId = restoreTargetId ?? backup.id;
    await this.journal(recoveryId);
    try {
      requireActivityScreenAcknowledgement(await this.exchange(ACTIVITY_SCREEN_WRITE, payload, session));
      const readBack = await this.readPayload(sportId, session);
      if (!readBack.equals(payload)) throw new Error("Activity-page read-back differs from the settings sent.");
      await this.clearJournal();
      return { document: this.remember(readBack, device, session), backup, verified: true };
    } catch (error) {
      this.proofs.delete(this.proofKey(device, sportId));
      throw new Error(`${error instanceof Error ? error.message : "Activity-page sync failed."} The recovery settings are saved in backup ${recoveryId}. Restore that backup before another write.`);
    }
  }
  async syncBaseline(snapshotId: string): Promise<CorosActivityScreenResult> {
    const cached = this.cached(snapshotId);
    if (this.hasExperimentalPages(cached.document)) {
      throw new Error("Restore the standard COROS backup before verifying the baseline. The current pages still contain an experimental layout.");
    }
    const before = await this.requireUnchanged(cached), device = this.identity();
    const result = await this.write(cached.payload, before, device, cached.session, "before-sync");
    const standard = result.document.pages.some(page => page.kind === "grid" && [2, 3, 4, 6, 8].includes(page.fieldCount!));
    if (standard) {
      this.proofs.set(this.proofKey(device, result.document.sport.id), { digest: result.document.digest, confirmed: false, session: cached.session });
      result.document.baseline = "read-back-verified";
    }
    return result;
  }
  async confirmBaseline(snapshotId: string): Promise<CorosActivityScreenDocument> {
    const cached = this.cached(snapshotId), device = this.identity();
    if (this.hasExperimentalPages(cached.document)) {
      throw new Error("Restore the standard COROS backup before confirming a new baseline.");
    }
    const proof = this.proofs.get(this.proofKey(device, cached.document.sport.id));
    if (!proof || proof.session !== cached.session || proof.digest !== cached.document.digest) {
      throw new Error("Sync and verify the unchanged COROS pages before confirming the watch display.");
    }
    await this.requireUnchanged(cached);
    proof.confirmed = true;
    return this.remember(cached.payload, device, cached.session);
  }
  preview(snapshotId: string, pageIndex: number, fieldCount: number): CorosActivityScreenPreview {
    const cached = this.cached(snapshotId), experimental = [5, 7, 9].includes(fieldCount);
    const proof = this.proofs.get(this.proofKey(this.identity(), cached.document.sport.id));
    if (experimental && (!proof?.confirmed || proof.session !== cached.session || proof.digest !== cached.document.digest)) {
      throw new Error("Confirm the standard COROS baseline on your watch before testing experimental layouts.");
    }
    if (fieldCount === 9 && this.hasExperimentalPages(cached.document)) {
      throw new Error("Restore the standard COROS backup, sync it unchanged, and confirm it before previewing nine fields.");
    }
    const payload = buildActivityScreenLayout(cached.payload, cached.document.sport.id, pageIndex, fieldCount);
    const preview: CorosActivityScreenPreview = {
      id: randomUUID(), sourceId: snapshotId, pageIndex, fieldCount, experimental,
      page: decodeActivityScreens(payload, cached.document.sport.id)[pageIndex]!
    };
    if (this.previews.size >= 30) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.id, { preview, payload });
    return preview;
  }
  async apply(previewId: string): Promise<CorosActivityScreenResult> {
    const prepared = this.previews.get(previewId);
    if (!prepared) throw new Error("Preview the layout again before syncing it.");
    const cached = this.cached(prepared.preview.sourceId), device = this.identity(), key = this.proofKey(device, cached.document.sport.id);
    const proof = this.proofs.get(key);
    if (!proof || proof.session !== cached.session || proof.digest !== cached.document.digest || (prepared.preview.experimental && !proof.confirmed)) {
      throw new Error("Verify the unchanged baseline before syncing a new layout.");
    }
    const before = await this.requireUnchanged(cached), wasConfirmed = proof.confirmed;
    const result = await this.write(prepared.payload, before, device, cached.session, "before-sync");
    this.proofs.set(key, { digest: result.document.digest, confirmed: wasConfirmed, session: cached.session });
    result.document.baseline = wasConfirmed ? "watch-confirmed" : "read-back-verified";
    this.previews.delete(previewId);
    return result;
  }
  async restore(backupId: string): Promise<CorosActivityScreenResult> {
    const stored = await this.loadBackup(backupId), device = this.identity(), session = this.deps.session();
    if (stored.backup.device.key !== device.key || stored.backup.device.firmware !== device.firmware) {
      throw new Error("Reconnect the original PACE Pro on the backup's firmware before restoring these pages.");
    }
    const before = await this.readPayload(stored.backup.sport.id, session);
    const result = await this.write(Buffer.from(stored.payloadHex, "hex"), before, device, session, "before-restore", backupId);
    this.proofs.delete(this.proofKey(device, stored.backup.sport.id));
    result.document.baseline = "unverified";
    return result;
  }
}
