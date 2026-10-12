import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { requireWifiDownloadReady } from "./corosBleWifiProtocol";
import { decodePodcastTask, encodeLocalDownloadSettings, encodePodcastPause, encodePodcastStart, validateNormalDownloadSettings } from "./corosWifiMusicProtocol";
import { serveWifiMusic, type WifiMusicFile } from "./corosWifiMusicServer";
import type { CorosWifiMusicIdentity, CorosWifiMusicStatus } from "./corosWifiMusicTypes";

const PENDING_KEY = "coros.ble.wifiMusic.restorePending";
const MAX_FILE = 512 * 1024 * 1024, MAX_BATCH = 1024 * 1024 * 1024;
/**
 * Every send ends by writing the backup back to the watch, so an old one could
 * restore download settings (and a token) the watch no longer uses.
 */
const MAX_BACKUP_AGE_MS = 24 * 60 * 60_000;
const backupIsCurrent = (savedAt: number) => Date.now() - savedAt <= MAX_BACKUP_AGE_MS && savedAt <= Date.now() + 60_000;
interface Profile extends CorosWifiMusicIdentity { version: 1; payload: string; sha256: string; savedAt: number }
interface Pending { version: 1; profile: Profile; taskId: string; taskStarted: boolean; complete: boolean; totalBytes: number; directory: string }
export interface WifiMusicBridge {
  identity(): CorosWifiMusicIdentity;
  supported(): boolean;
  exchange(opcode: number, payload: Buffer): Promise<Buffer>;
  reconnect(identity: CorosWifiMusicIdentity): Promise<void>;
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  encrypt(value: string): string;
  decrypt(value: string): string;
  temporaryDirectory(): string;
}

const sameWatch = (a: CorosWifiMusicIdentity, b: CorosWifiMusicIdentity) => a.deviceName === b.deviceName &&
  a.accountUserId === b.accountUserId && (!a.serialNumber || a.serialNumber === b.serialNumber);
const profileKey = (i: CorosWifiMusicIdentity) => "coros.ble.wifiMusic.profile." + createHash("sha256").update(JSON.stringify([i.deviceName, i.accountUserId])).digest("hex");
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const syncSafe = (identity: CorosWifiMusicIdentity) => {
  if (!/^COROS.{1,100}$/.test(identity.deviceName) || !/^\d{1,20}$/.test(identity.accountUserId)) throw new Error("Authenticate your watch before preparing Wi-Fi sync.");
};

export class CorosWifiMusicService {
  private progress: CorosWifiMusicStatus = { supported: false, ready: false, phase: "idle", completedFiles: 0, totalFiles: 0, downloadedBytes: 0, totalBytes: 0, restorePending: false };
  private cancelled = false;
  private preparing?: AbortController;
  constructor(private readonly bridge: WifiMusicBridge, private readonly runtime: {
    serve?: typeof serveWifiMusic;
    wait?: (milliseconds: number) => Promise<unknown>;
  } = {}) {}

  private read<T>(key: string): T | undefined {
    const saved = this.bridge.getSetting(key);
    if (!saved) return undefined;
    return JSON.parse(this.bridge.decrypt(saved)) as T;
  }
  private write(key: string, value: unknown): void { this.bridge.setSetting(key, value === undefined ? "" : this.bridge.encrypt(JSON.stringify(value))); }
  hasPendingRestore(): boolean { return Boolean(this.bridge.getSetting(PENDING_KEY)); }
  private validateProfile(profile: Profile, identity: CorosWifiMusicIdentity): Buffer {
    syncSafe(identity);
    if (profile.version !== 1 || !sameWatch(profile, identity) || typeof profile.payload !== "string" || profile.payload.length > 1024 ||
        !Number.isFinite(profile.savedAt) || profile.savedAt <= 0) throw new Error("Import a current settings backup for this watch and COROS account.");
    const payload = Buffer.from(profile.payload, "base64");
    if (createHash("sha256").update(payload).digest("hex") !== profile.sha256) throw new Error("The settings backup failed its integrity check.");
    validateNormalDownloadSettings(payload); return payload;
  }
  status(): CorosWifiMusicStatus {
    let ready = false, backupSavedAt: number | undefined, deviceName: string | undefined;
    const supported = this.bridge.supported(), restorePending = this.hasPendingRestore();
    if (supported) {
      try {
        const identity = this.bridge.identity(); deviceName = identity.deviceName;
        const profile = this.read<Profile>(profileKey(identity));
        // A stale backup still reports its date, so the panel can ask for a current one.
        if (profile) { this.validateProfile(profile, identity); backupSavedAt = profile.savedAt; ready = !restorePending && backupIsCurrent(profile.savedAt); }
      } catch { /* Disconnection or a different account never exposes/uses the saved payload. */ }
    }
    return { ...this.progress, supported, ready, deviceName: deviceName ?? this.progress.deviceName,
      backupSavedAt, restorePending, phase: restorePending && !["preparing", "downloading", "restoring"].includes(this.progress.phase) ? "restore-required" : this.progress.phase };
  }
  choosing(): void { this.progress = { ...this.progress, phase: "choosing", error: undefined }; }
  selectionCancelled(): CorosWifiMusicStatus { this.progress = { ...this.progress, phase: "idle" }; return this.status(); }
  cancel(): void { this.cancelled = true; this.preparing?.abort(); }

  /** Called with a path selected by the main-process native dialog, never a renderer path. */
  async importBackup(filename: string): Promise<CorosWifiMusicStatus> {
    if (this.hasPendingRestore()) throw new Error("Restore the watch settings before replacing their backup.");
    const identity = this.bridge.identity(); syncSafe(identity);
    const info = await fsp.stat(filename);
    if (!info.isFile() || info.size > 16_384) throw new Error("This is not a CorosLink Wi-Fi settings backup.");
    const bytes = await fsp.readFile(filename);
    if (bytes.length > 16_384) throw new Error("This is not a CorosLink Wi-Fi settings backup.");
    const decoded = JSON.parse(this.bridge.decrypt(bytes.toString("base64"))) as Partial<Profile> & { source?: string };
    if (decoded.deviceName !== identity.deviceName || (decoded.accountUserId && decoded.accountUserId !== identity.accountUserId)) {
      throw new Error("Choose a settings backup for this watch and COROS account.");
    }
    const savedAt = decoded.savedAt ?? Date.parse(decoded.source ?? "");
    if (!Number.isFinite(savedAt) || !backupIsCurrent(savedAt)) {
      throw new Error("Import a fresh settings backup created in the last 24 hours.");
    }
    const profile = { ...identity, version: 1 as const, payload: decoded.payload ?? "", sha256: decoded.sha256 ?? "", savedAt };
    this.validateProfile(profile, identity); this.write(profileKey(identity), profile);
    this.progress = { ...this.progress, phase: "idle", error: undefined }; return this.status();
  }

  private assertIdentity(identity: CorosWifiMusicIdentity): void {
    if (!sameWatch(identity, this.bridge.identity())) throw new Error("The connected watch or COROS account changed during audio sync.");
  }
  private async command(identity: CorosWifiMusicIdentity, opcode: number, payload: Buffer): Promise<Buffer> {
    this.assertIdentity(identity); return this.bridge.exchange(opcode, payload);
  }
  private async acknowledged(identity: CorosWifiMusicIdentity, opcode: number, payload: Buffer): Promise<void> {
    const reply = await this.command(identity, opcode, payload);
    if (reply.length !== 1 || reply[0] !== 1) throw new Error("The watch did not accept the audio-sync command.");
  }
  private async cleanup(directory: string): Promise<void> {
    const parent = path.resolve(this.bridge.temporaryDirectory());
    if (path.dirname(path.resolve(directory)) === parent && /^coros-wifi-music-[\w-]+$/.test(path.basename(directory))) {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  }

  /** The durable journal is cleared only after a positive settings-restoration acknowledgement. */
  async restore(): Promise<CorosWifiMusicStatus> {
    const pending = this.read<Pending>(PENDING_KEY);
    if (!pending) return this.status();
    if (pending.version !== 1) throw new Error("The saved settings restoration needs attention.");
    const identity = pending.profile;
    const payload = this.validateProfile(pending.profile, identity);
    this.progress = { ...this.progress, deviceName: identity.deviceName, phase: "restoring", restorePending: true };
    let message = "Reconnect the same watch to restore its download settings.";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await this.bridge.reconnect(identity);
        this.assertIdentity(identity);
        if (pending.taskStarted && !pending.complete) {
          const task = decodePodcastTask(await this.command(identity, 0xb6, Buffer.from([11, 255])), pending.taskId, pending.totalBytes);
          if (task && !task.complete && task.errorCode === 0) await this.acknowledged(identity, 0xb6, encodePodcastPause(pending.taskId));
        }
        await this.acknowledged(identity, 0xb2, payload);
        this.write(PENDING_KEY, undefined); await this.cleanup(pending.directory);
        this.progress = { ...this.progress, restorePending: false, phase: this.progress.error ? "failed" : "idle" };
        return this.status();
      } catch (cause) { message = cause instanceof Error ? cause.message : message; }
    }
    this.progress = { ...this.progress, phase: "restore-required", restorePending: true,
      error: `Download settings still need restoration. Reconnect the same watch. ${message}` };
    return this.status();
  }

  private async stage(filenames: string[], directory: string): Promise<WifiMusicFile[]> {
    if (!filenames.length || filenames.length > 20) throw new Error("Choose between 1 and 20 MP3 files.");
    const files: WifiMusicFile[] = [];
    let total = 0;
    this.preparing = new AbortController();
    for (const filename of filenames) {
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      const source = await fsp.open(filename, "r");
      const id = randomBytes(4).toString("hex").toUpperCase(), targetPath = path.join(directory, `${id}.mp3`);
      let target: Awaited<ReturnType<typeof fsp.open>> | undefined;
      try {
        const before = await source.stat();
        if (!before.isFile() || !/\.mp3$/i.test(filename) || before.size <= 0 || before.size > MAX_FILE || total + before.size > MAX_BATCH) {
          throw new Error("Choose MP3s up to 512 MB each and 1 GB in total.");
        }
        const head = Buffer.alloc(Math.min(4096, before.size)); await source.read(head, 0, head.length, 0);
        const tagged = head.toString("ascii", 0, 3) === "ID3";
        if (!tagged && !head.some((v, i) => v === 255 && i + 1 < head.length && (head[i + 1]! & 224) === 224)) throw new Error("One of the selected files is not a readable MP3.");
        const name = path.basename(filename).replace(/[\x00-\x1f\x7f]/g, " ");
        this.progress = { ...this.progress, fileName: name };
        target = await fsp.open(targetPath, "wx", 0o600);
        // Untagged MP3s need a title so the podcast library can display their original name.
        let prefix = Buffer.alloc(0);
        if (!tagged) {
          let title = name.replace(/\.mp3$/i, "");
          while (Buffer.byteLength(title) > 240) title = title.slice(0, -1);
          const text = Buffer.concat([Buffer.from([3]), Buffer.from(title)]), frame = Buffer.alloc(10 + text.length);
          frame.write("TIT2"); const frameSize = text.length;
          for (let i = 0; i < 4; i++) frame[4 + i] = (frameSize >>> ((3 - i) * 7)) & 127;
          text.copy(frame, 10); const header = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
          for (let i = 0; i < 4; i++) header[6 + i] = (frame.length >>> ((3 - i) * 7)) & 127;
          prefix = Buffer.concat([header, frame]); await target.write(prefix, 0, prefix.length, 0);
        }
        if (before.size + prefix.length > MAX_FILE || total + before.size + prefix.length > MAX_BATCH) throw new Error("Choose MP3s up to 512 MB each and 1 GB in total.");
        const chunk = Buffer.alloc(65_536);
        for (let position = 0; position < before.size;) {
          if (this.cancelled || this.preparing.signal.aborted) throw new Error("Audio sync cancelled.");
          const { bytesRead } = await source.read(chunk, 0, Math.min(chunk.length, before.size - position), position);
          if (!bytesRead) throw new Error("A selected MP3 changed while preparing. Try again.");
          let written = 0;
          while (written < bytesRead) {
            const result = await target.write(chunk, written, bytesRead - written, prefix.length + position + written);
            if (!result.bytesWritten) throw new Error("Could not prepare the selected MP3.");
            written += result.bytesWritten;
          }
          position += bytesRead;
        }
        const after = await source.stat(), staged = await target.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || staged.size !== before.size + prefix.length) throw new Error("A selected MP3 changed while preparing. Try again.");
        total += staged.size; files.push({ id, path: targetPath, name, size: staged.size });
      } finally { await target?.close(); await source.close(); }
    }
    this.preparing = undefined; return files;
  }

  async send(filenames: string[]): Promise<CorosWifiMusicStatus> {
    const identity = this.bridge.identity();
    if (this.hasPendingRestore()) throw new Error("Reconnect the watch to restore its settings before sending more audio.");
    const profile = this.read<Profile>(profileKey(identity));
    if (!profile) throw new Error("Import a current settings backup to prepare Wi-Fi sync.");
    const normal = this.validateProfile(profile, identity);
    // Only checked here: a pending restore must write back what this send replaced, however old.
    if (!backupIsCurrent(profile.savedAt)) throw new Error("The Wi-Fi settings backup is more than a day old. Import a current backup before sending audio.");
    this.cancelled = false;
    this.progress = { ...this.progress, deviceName: identity.deviceName, phase: "preparing", error: undefined,
      fileName: undefined, completedFiles: 0, totalFiles: filenames.length, downloadedBytes: 0, totalBytes: 0 };
    const directory = await fsp.mkdtemp(path.join(this.bridge.temporaryDirectory(), "coros-wifi-music-")); await fsp.chmod(directory, 0o700);
    let server: Awaited<ReturnType<typeof serveWifiMusic>> | undefined;
    let pending: Pending | undefined;
    let complete = false, failure: string | undefined;
    try {
      requireWifiDownloadReady(await this.command(identity, 0xb6, Buffer.from([25])));
      const files = await this.stage(filenames, directory), totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      let taskId = randomBytes(4).toString("hex").toUpperCase();
      const taskPayload = await this.command(identity, 0xb6, Buffer.from([11, 255]));
      for (let i = 0; decodePodcastTask(taskPayload, taskId, totalBytes); i++) {
        if (i > 10) throw new Error("Could not reserve an audio task. Try again.");
        taskId = randomBytes(4).toString("hex").toUpperCase();
      }
      server = await (this.runtime.serve ?? serveWifiMusic)(files, taskId);
      this.progress = { ...this.progress, totalBytes, fileName: files.length === 1 ? files[0]!.name : `${files.length} MP3s` };
      pending = { version: 1, profile, taskId, totalBytes, directory, taskStarted: false, complete: false };
      this.write(PENDING_KEY, pending); // Persist BEFORE any watch settings can change.
      await this.acknowledged(identity, 0xb2, encodeLocalDownloadSettings(normal, server.prefix));
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      pending.taskStarted = true; this.write(PENDING_KEY, pending); // A lost start ACK must still pause/recover this task.
      await this.acknowledged(identity, 0xb6, encodePodcastStart(taskId));
      this.progress = { ...this.progress, phase: "downloading", restorePending: true };
      const deadline = Date.now() + Math.min(30 * 60_000, Math.max(120_000, totalBytes / 65_536 * 1000 + 90_000));
      while (Date.now() < deadline) {
        if (this.cancelled) throw new Error("Audio sync cancelled.");
        await (this.runtime.wait ?? wait)(2000);
        const task = decodePodcastTask(await this.command(identity, 0xb6, Buffer.from([11, 255])), taskId, totalBytes);
        if (task) {
          let count = 0, accumulated = 0;
          for (const file of files) { accumulated += file.size; if (task.downloadedBytes >= accumulated) count++; }
          this.progress = { ...this.progress, downloadedBytes: Math.min(totalBytes, task.downloadedBytes), completedFiles: count };
          if (task.errorCode) throw new Error(`The watch could not download the audio (code ${task.errorCode}). Check its Wi-Fi connection and free space.`);
          if (task.complete) { complete = true; pending.complete = true; this.write(PENDING_KEY, pending); break; }
        }
      }
      if (!complete) throw new Error("The watch did not finish the download. Keep both devices on the same Wi-Fi network and try again.");
    } catch (cause) { failure = this.cancelled ? "Audio sync cancelled." : cause instanceof Error ? cause.message.replace(/maps/g, "audio") : "Could not send audio over Wi-Fi."; }
    finally {
      this.preparing = undefined;
      this.progress = { ...this.progress, error: complete || this.cancelled ? undefined : failure };
      try { if (pending) await this.restore(); }
      catch (cause) { this.progress = { ...this.progress, phase: "restore-required", restorePending: true,
        error: cause instanceof Error ? cause.message : "Reconnect the same watch to restore its download settings." }; }
      finally { await server?.close(); await this.cleanup(directory); }
    }
    if (!this.hasPendingRestore()) this.progress = { ...this.progress, phase: complete ? "complete" : this.cancelled ? "cancelled" : "failed", error: complete || this.cancelled ? undefined : failure };
    return this.status();
  }
}
