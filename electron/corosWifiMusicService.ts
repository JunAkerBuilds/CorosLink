import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { decodeWifiDownloadReadiness, encodeWifiTaskRemove, requireWifiDownloadReady, requireWifiTaskRemoved } from "./corosBleWifiProtocol";
import { decodePodcastTask, encodeLocalDownloadSettings, encodePodcastPause, encodePodcastStart, validateNormalDownloadSettings } from "./corosWifiMusicProtocol";
import { serveWifiMusic, type WifiMusicFile } from "./corosWifiMusicServer";
import { openWifiAudioLookup, type WifiAudioLookup } from "./corosWifiMusicLookup";
import type { CorosNeteasePlaylistLabel, CorosWifiMusicIdentity, CorosWifiMusicStatus } from "./corosWifiMusicTypes";
import { validateNeteasePlaylistId, validateNeteasePlaylistName, validateWifiMusicOptions, WIFI_AUDIO_LOOKUP_LEGACY_FILES, WIFI_MUSIC_BATCH_BYTES, WIFI_MUSIC_BATCH_FILES, WIFI_MUSIC_MAX_FILES, type CorosWifiMusicOptions } from "./corosWifiMusicTypes";
import type { CorosWirelessAudioTrack } from "./corosBleMusicTypes";

const PENDING_KEY = "coros.ble.wifiMusic.restorePending";
const MAX_FILE = 512 * 1024 * 1024, MAX_BATCH = 1024 * 1024 * 1024;
// Capture age alone cannot establish whether settings changed. Reuse the saved
// watch/account-bound packet; the user refreshes it after changing those settings.
interface Profile extends CorosWifiMusicIdentity { version: 1; payload: string; sha256: string; savedAt: number }
interface Pending { version: 1; profile: Profile; taskId: string; taskStarted: boolean; complete: boolean; totalBytes: number; directory: string }
interface AudioLabel { id: string; destination: "podcasts" | "netease"; name: string }
interface AudioLabels extends CorosWifiMusicIdentity { version: 1; labels: AudioLabel[]; playlists?: CorosNeteasePlaylistLabel[] }
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
    openLookup?: typeof openWifiAudioLookup;
    wait?: (milliseconds: number) => Promise<unknown>;
    /** Files per batch; tests use small batches to exercise multi-batch recovery. */
    batchFiles?: number;
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
        !Number.isFinite(profile.savedAt) || profile.savedAt <= 0) throw new Error("Import a settings backup for this watch and COROS account.");
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
        if (profile) { this.validateProfile(profile, identity); backupSavedAt = profile.savedAt; ready = !restorePending; }
      } catch { /* Disconnection or a different account never exposes/uses the saved payload. */ }
    }
    return { ...this.progress, supported, ready, deviceName: deviceName ?? this.progress.deviceName,
      backupSavedAt, restorePending, phase: restorePending && !["preparing", "downloading", "restoring"].includes(this.progress.phase) ? "restore-required" : this.progress.phase };
  }
  choosing(): void { this.progress = { ...this.progress, phase: "choosing", error: undefined }; }
  selectionCancelled(): CorosWifiMusicStatus { this.progress = { ...this.progress, phase: "idle" }; return this.status(); }
  cancel(): void { this.cancelled = true; this.preparing?.abort(); }

  labelWirelessAudio(tracks: CorosWirelessAudioTrack[]): CorosWirelessAudioTrack[] {
    try {
      const identity = this.bridge.identity();
      const saved = this.read<AudioLabels>(profileKey(identity) + ".audioLabels");
      if (!saved || saved.version !== 1 || !sameWatch(saved, identity) || !Array.isArray(saved.labels) || saved.labels.length > 500) return tracks;
      const labels = saved.labels;
      return tracks.map(track => {
        const label = labels.find(row => row?.id === track.id && row.destination === track.destination &&
          typeof row.name === "string" && row.name.length > 0 && row.name.length <= 512 && !/[\x00-\x1f\x7f]/.test(row.name));
        return label ? { ...track, name: label.name } : track;
      });
    } catch { return tracks; }
  }

  /** NetEase playlists CorosLink created on the connected watch, newest last. Names are local; the watch keeps only IDs. */
  neteasePlaylists(): CorosNeteasePlaylistLabel[] {
    try {
      const identity = this.bridge.identity();
      const saved = this.read<AudioLabels>(profileKey(identity) + ".audioLabels");
      if (!saved || saved.version !== 1 || !sameWatch(saved, identity) || !Array.isArray(saved.playlists)) return [];
      return saved.playlists.filter(row => typeof row?.id === "string" && /^[A-F0-9]{8}$/.test(row.id) && typeof row.name === "string" &&
        row.name.length > 0 && row.name.length <= 64 && !/[\x00-\x1f\x7f]/.test(row.name))
        .map(row => Number.isFinite(row.updatedAt) && row.updatedAt! > 0 ? { id: row.id, name: row.name, updatedAt: row.updatedAt } : { id: row.id, name: row.name });
    } catch { return []; }
  }

  /** Name (or rename) a playlist on the connected watch. Local only: the watch never stores playlist names. */
  renameNeteasePlaylist(idValue: unknown, nameValue: unknown): CorosNeteasePlaylistLabel[] {
    const id = validateNeteasePlaylistId(idValue), name = validateNeteasePlaylistName(nameValue);
    const identity = this.bridge.identity(), key = profileKey(identity) + ".audioLabels";
    let previous: AudioLabels | undefined;
    try { previous = this.read<AudioLabels>(key); } catch { previous = undefined; }
    const current = previous?.version === 1 && sameWatch(previous, identity) ? previous : undefined;
    const playlists = Array.isArray(current?.playlists) ? current.playlists : [];
    const next = playlists.some(row => row?.id === id) ? playlists.map(row => row?.id === id ? { ...row, name } : row) : [...playlists, { id, name }];
    this.write(key, { ...identity, version: 1, labels: Array.isArray(current?.labels) ? current.labels : [], playlists: next.slice(-50) });
    return this.neteasePlaylists();
  }

  private rememberAudio(identity: CorosWifiMusicIdentity, files: WifiMusicFile[], destination: AudioLabel["destination"], playlist?: CorosNeteasePlaylistLabel): void {
    // Labels never establish presence: only a fresh watch inventory does that.
    // A label-cache failure must not invalidate an already completed download.
    try {
      const key = profileKey(identity) + ".audioLabels";
      const previous = this.read<AudioLabels>(key);
      const added = files.map(file => ({ id: file.id, destination, name: file.name }));
      const labels = previous?.version === 1 && sameWatch(previous, identity) && Array.isArray(previous.labels)
        ? previous.labels.filter(row => !added.some(a => a.id === row?.id && a.destination === row.destination)) : [];
      const playlists = (previous?.version === 1 && sameWatch(previous, identity) && Array.isArray(previous.playlists) ? previous.playlists : [])
        .filter(row => row?.id !== playlist?.id);
      this.write(key, { ...identity, version: 1, labels: [...labels, ...added].slice(-500),
        playlists: playlist ? [...playlists, playlist].slice(-50) : playlists });
    } catch { /* Display IDs when the optional local label cache is unavailable. */ }
  }

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
    if (!Number.isFinite(savedAt) || savedAt <= 0 || savedAt > Date.now() + 60_000) {
      throw new Error("Choose a settings backup with a valid capture date.");
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

  /** `screenAttempts`: how long a lone busy-screen flag may hold. Between batches the watch keeps its
   *  download-finished screen up until a button press, so the queue waits longer and says so. */
  private async waitForWatch(identity: CorosWifiMusicIdentity, screenAttempts = 15): Promise<void> {
    const deadline = Date.now() + Math.max(30_000, screenAttempts * 2000 + 2000);
    for (let attempt = 0; ; attempt++) {
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      const payload = await this.command(identity, 0xb6, Buffer.from([25]));
      const flags = decodeWifiDownloadReadiness(payload);
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      if (!flags) {
        if (this.progress.phase === "waiting") this.progress = { ...this.progress, phase: "preparing", waitingFor: undefined };
        return;
      }
      // W332 sets bit 8 whenever its current window is nonzero. The download
      // UI can hold it briefly after a successful task, even as the face appears.
      // Wait for it to clear; never bypass battery, USB, activity or unknown flags.
      if (flags !== 0x100 || attempt >= screenAttempts || Date.now() >= deadline) requireWifiDownloadReady(payload);
      this.progress = { ...this.progress, phase: "waiting", waitingFor: screenAttempts > 15 && attempt >= 2 ? "screen" : undefined };
      await (this.runtime.wait ?? wait)(2000);
    }
  }
  private async cleanup(directory: string): Promise<void> {
    const parent = path.resolve(this.bridge.temporaryDirectory());
    if (path.dirname(path.resolve(directory)) === parent && /^coros-wifi-music-[\w-]+$/.test(path.basename(directory))) {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  }

  /** The durable journal is cleared only after a positive settings-restoration acknowledgement. */
  async restore(): Promise<CorosWifiMusicStatus> {
    return this.restoreSettings(true);
  }

  private async restoreSettings(removeStagingFiles: boolean): Promise<CorosWifiMusicStatus> {
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
          // Remove an unfinished task so failed or cancelled sends don't pile up in the watch's queue.
          // If the watch refuses (USB cable in), pause a still-running one as before.
          if (task && !task.complete) {
            try { requireWifiTaskRemoved(await this.command(identity, 0xb6, encodeWifiTaskRemove(pending.taskId))); }
            catch (cause) { if (task.errorCode !== 0) throw cause; await this.acknowledged(identity, 0xb6, encodePodcastPause(pending.taskId)); }
          }
        }
        await this.acknowledged(identity, 0xb2, payload);
        this.write(PENDING_KEY, undefined);
        if (removeStagingFiles) await this.cleanup(pending.directory);
        this.progress = { ...this.progress, restorePending: false, phase: this.progress.error ? "failed" : "idle" };
        return this.status();
      } catch (cause) { message = cause instanceof Error ? cause.message : message; }
    }
    this.progress = { ...this.progress, phase: "restore-required", restorePending: true,
      error: `Download settings still need restoration. Reconnect the same watch. ${message}` };
    return this.status();
  }

  private async stage(filenames: string[], directory: string): Promise<WifiMusicFile[]> {
    if (!Array.isArray(filenames) || !filenames.length || filenames.length > WIFI_MUSIC_MAX_FILES ||
        filenames.some(filename => typeof filename !== "string") || new Set(filenames).size !== filenames.length)
      throw new Error(`Choose between 1 and ${WIFI_MUSIC_MAX_FILES} different MP3 files.`);
    const files: WifiMusicFile[] = [];
    let total = 0;
    this.preparing = new AbortController();
    for (const filename of filenames) {
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      const source = await fsp.open(filename, "r");
      let id: string;
      do { id = randomBytes(4).toString("hex").toUpperCase(); } while (files.some(file => file.id === id));
      const targetPath = path.join(directory, `${id}.mp3`);
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

  async send(filenames: string[], input?: CorosWifiMusicOptions): Promise<CorosWifiMusicStatus> {
    const options = validateWifiMusicOptions(input);
    const identity = this.bridge.identity();
    if (this.hasPendingRestore()) throw new Error("Reconnect the watch to restore its settings before sending more audio.");
    const profile = this.read<Profile>(profileKey(identity));
    if (!profile) throw new Error("Import a settings backup once to prepare Wi-Fi sync.");
    const normal = this.validateProfile(profile, identity);
    this.cancelled = false;
    this.progress = { ...this.progress, deviceName: identity.deviceName, phase: "preparing", error: undefined,
      fileName: undefined, destination: options.destination, playlistName: options.playlistName, playlistId: options.playlistId,
      batchIndex: undefined, batchCount: undefined, waitingFor: undefined,
      completedFiles: 0, totalFiles: filenames.length, downloadedBytes: 0, totalBytes: 0 };
    const directory = await fsp.mkdtemp(path.join(this.bridge.temporaryDirectory(), "coros-wifi-music-")); await fsp.chmod(directory, 0o700);
    let complete = false, failure: string | undefined;
    try {
      await this.waitForWatch(identity);
      const files = await this.stage(filenames, directory), totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      if (this.cancelled) throw new Error("Audio sync cancelled.");
      // Batches hold up to WIFI_MUSIC_BATCH_FILES files and WIFI_MUSIC_BATCH_BYTES; a relay that predates larger
      // NetEase lookups refuses them before any watch setting changes, and the queue continues in legacy-sized batches.
      let maxFiles = this.runtime.batchFiles ?? WIFI_MUSIC_BATCH_FILES;
      const batchesFrom = (start: number) => {
        const batches: WifiMusicFile[][] = [];
        for (let i = start; i < files.length;) {
          const batch: WifiMusicFile[] = [];
          let bytes = 0;
          while (i < files.length && batch.length < maxFiles && (!batch.length || bytes + files[i]!.size <= WIFI_MUSIC_BATCH_BYTES)) { bytes += files[i]!.size; batch.push(files[i++]!); }
          batches.push(batch);
        }
        return batches;
      };
      this.progress = { ...this.progress, totalBytes, batchCount: batchesFrom(0).length };
      const usedTaskIds = new Set<string>();
      let playlistId: string | undefined = options.playlistId;
      let completedBytes = 0;
      for (let offset = 0, batchIndex = 1; offset < files.length;) {
        if (this.cancelled) throw new Error("Audio sync cancelled.");
        const batch = batchesFrom(offset)[0]!;
        const batchBytes = batch.reduce((sum, file) => sum + file.size, 0);
        this.progress = { ...this.progress, phase: "preparing", batchIndex, batchCount: batchIndex - 1 + batchesFrom(offset).length,
          fileName: batch.length === 1 ? batch[0]!.name : `${batch.length} MP3s` };
        if (offset > 0) {
          // Let the completed task leave the watch's worker before starting the next.
          await (this.runtime.wait ?? wait)(2000);
          if (this.cancelled) throw new Error("Audio sync cancelled.");
          await this.waitForWatch(identity, 150);
        }
        let taskId = randomBytes(4).toString("hex").toUpperCase();
        const taskPayload = await this.command(identity, 0xb6, Buffer.from([11, 255]));
        for (let i = 0; usedTaskIds.has(taskId) || decodePodcastTask(taskPayload, taskId, batchBytes); i++) {
          if (i > 10) throw new Error("Could not reserve an audio task. Try again.");
          taskId = randomBytes(4).toString("hex").toUpperCase();
        }
        usedTaskIds.add(taskId);
        // Task IDs change per batch; the NetEase playlist ID stays the same for the queue.
        playlistId ??= taskId;
        if (options.destination === "netease") this.progress = { ...this.progress, playlistId };
        let server: Awaited<ReturnType<typeof serveWifiMusic>> | undefined;
        let lookup: WifiAudioLookup | undefined;
        let pending: Pending | undefined;
        try {
          server = await (this.runtime.serve ?? serveWifiMusic)(batch, taskId, undefined, options, playlistId);
          if (this.cancelled) throw new Error("Audio sync cancelled.");
          if (options.destination === "netease") {
            try { lookup = await (this.runtime.openLookup ?? openWifiAudioLookup)(server.lookup, taskId); }
            catch (cause) {
              if (batch.length <= WIFI_AUDIO_LOOKUP_LEGACY_FILES || !/\(400\)/.test(cause instanceof Error ? cause.message : "")) throw cause;
              maxFiles = WIFI_AUDIO_LOOKUP_LEGACY_FILES; continue; // Nothing changed on the watch yet; retry this offset smaller.
            }
            if (this.cancelled) throw new Error("Audio sync cancelled.");
          }
          pending = { version: 1, profile, taskId, totalBytes: batchBytes, directory, taskStarted: false, complete: false };
          this.write(PENDING_KEY, pending); // Persist BEFORE any watch settings can change.
          await this.acknowledged(identity, 0xb2, encodeLocalDownloadSettings(normal, server.prefix, options.destination, lookup));
          if (this.cancelled) throw new Error("Audio sync cancelled.");
          pending.taskStarted = true; this.write(PENDING_KEY, pending); // A lost start ACK must still pause/recover this task.
          await this.acknowledged(identity, 0xb6, encodePodcastStart(taskId, options.destination));
          this.progress = { ...this.progress, phase: "downloading", restorePending: true };
          const deadline = Date.now() + Math.min(30 * 60_000, Math.max(120_000, batchBytes / 65_536 * 1000 + 90_000));
          while (Date.now() < deadline) {
            if (this.cancelled) throw new Error("Audio sync cancelled.");
            await (this.runtime.wait ?? wait)(2000);
            const task = decodePodcastTask(await this.command(identity, 0xb6, Buffer.from([11, 255])), taskId, batchBytes);
            if (task) {
              let count = 0, accumulated = 0;
              for (const file of batch) { accumulated += file.size; if (task.downloadedBytes >= accumulated) count++; }
              this.progress = { ...this.progress, downloadedBytes: completedBytes + Math.min(batchBytes, task.downloadedBytes), completedFiles: offset + count };
              if (task.errorCode) throw new Error(`The watch could not download the audio (code 0x${task.errorCode.toString(16).toUpperCase()}). Check the connection and try again.`);
              if (task.complete) {
                pending.complete = true; this.write(PENDING_KEY, pending);
                this.rememberAudio(identity, batch, options.destination,
                  options.destination === "netease" && playlistId ? { id: playlistId, name: options.playlistName ?? "CorosLink", updatedAt: Date.now() } : undefined); break;
              }
            }
          }
          if (!pending.complete) throw new Error("The watch did not finish the download. Keep both devices on the same Wi-Fi network and try again.");
        } finally {
          // Restore between batches as well as on failure. Keep staged files for the queue;
          // public crash recovery still removes them after restoring the active journal.
          try { if (pending) await this.restoreSettings(false); }
          catch (cause) { this.progress = { ...this.progress, phase: "restore-required", restorePending: true,
            error: cause instanceof Error ? cause.message : "Reconnect the same watch to restore its download settings." }; }
          finally { try { await lookup?.close(); } finally { await server?.close(); } }
        }
        if (this.hasPendingRestore()) return this.status();
        completedBytes += batchBytes; offset += batch.length; batchIndex++;
      }
      complete = true;
    } catch (cause) { failure = this.cancelled ? "Audio sync cancelled." : cause instanceof Error ? cause.message.replace(/maps/g, "audio") : "Could not send audio over Wi-Fi."; }
    finally {
      this.preparing = undefined;
      await this.cleanup(directory);
    }
    if (!this.hasPendingRestore()) this.progress = { ...this.progress, phase: complete ? "complete" : this.cancelled ? "cancelled" : "failed", error: complete || this.cancelled ? undefined : failure };
    return this.status();
  }
}
