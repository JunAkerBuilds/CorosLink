import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { ActivityRepository } from "./activityRepository";
import type { HealthRepository } from "./healthRepository";
import type { LocalArchive } from "./localArchive";
import { fsyncDirectory, sha256File } from "./localArchive";
import { derivePassphraseKey, MIN_PASSPHRASE_LENGTH, PASSPHRASE_CIPHER, PASSPHRASE_NONCE_BYTES, PASSPHRASE_SALT_BYTES, PASSPHRASE_TAG_BYTES } from "../passphraseCrypto";
import type { LocalTrainingBackend } from "./localTrainingBackend";
import type { LocalActivityRecord, LocalBackupResult, LocalDevice, LocalHealthCheck, LocalHealthSample, LocalRestoreResult, LocalSleepSession, LocalWorkoutRecovery } from "./localDataTypes";

/**
 * Local backups: one file with every locally held activity file, raw watch
 * payload, health sample and the metadata to list them, plus a manifest of
 * SHA-256 hashes. A plain backup is a standard (stored) ZIP; an encrypted one
 * wraps that ZIP in AES-256-GCM with a scrypt-derived key.
 *
 * Never included: watch keys, cloud tokens, passwords or app settings.
 * Restoring verifies every hash before anything is written and never
 * overwrites existing records.
 */

const BACKUP_FORMAT = "coroslink-local-backup";
const BACKUP_VERSION = 1;
const ENCRYPTED_MAGIC = Buffer.from("CLBKENC1", "latin1");
const MAX_JSON_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 65_000;
const ARCHIVE_PATH = /^(fit|watch-sync)\/[0-9a-f]{2}\/([0-9a-f]{64})\.([a-z0-9]{1,8})$/;

interface ManifestFile { path: string; sha256: string; size: number }

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion?: string;
  containsCredentials: false;
  counts: { activities: number; payloads: number; devices: number; healthSamples: number; healthSummaries: number };
  files: ManifestFile[];
}

export interface BackupDependencies {
  repository: ActivityRepository;
  health: HealthRepository;
  archive: LocalArchive;
  /** Local-Only Mode's workout library and training calendar. */
  training?: Pick<LocalTrainingBackend, "exportData" | "importData">;
  appVersion?: string;
}

// ----- minimal streaming ZIP (store only, no ZIP64: < 4 GiB, < 65 535 entries) -----

interface CentralEntry { name: Buffer; crc: number; size: number; offset: number }

class ZipWriter {
  private offset = 0;
  private readonly entries: CentralEntry[] = [];

  constructor(private readonly sink: (chunk: Buffer) => Promise<void>) {}

  private async write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    if (this.offset > 0xffff_ffff) throw new Error("The backup is larger than 4 GB. Export fewer activities at a time.");
    await this.sink(chunk);
  }

  async addBuffer(name: string, data: Buffer): Promise<void> {
    await this.addEntry(name, zlib.crc32(data), data.length, async () => { await this.write(data); });
  }

  /** Streams a file in; its CRC is computed in a first pass so the local header is exact. */
  async addFile(name: string, filePath: string): Promise<void> {
    let crc = 0;
    let size = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
      crc = zlib.crc32(chunk as Buffer, crc);
      size += (chunk as Buffer).length;
    }
    await this.addEntry(name, crc, size, async () => {
      let written = 0;
      for await (const chunk of fs.createReadStream(filePath)) {
        written += (chunk as Buffer).length;
        await this.write(chunk as Buffer);
      }
      if (written !== size) throw new Error("A local file changed while it was being backed up.");
    });
  }

  private async addEntry(name: string, crc: number, size: number, body: () => Promise<void>): Promise<void> {
    if (this.entries.length >= MAX_ENTRIES) throw new Error("Too many files for one backup.");
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const offset = this.offset;
    await this.write(Buffer.concat([header, nameBytes]));
    await body();
    this.entries.push({ name: nameBytes, crc, size, offset });
  }

  async finish(): Promise<void> {
    const start = this.offset;
    for (const entry of this.entries) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.size, 20);
      central.writeUInt32LE(entry.size, 24);
      central.writeUInt16LE(entry.name.length, 28);
      central.writeUInt32LE(entry.offset, 42);
      await this.write(Buffer.concat([central, entry.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
  }
}

class ZipReader {
  private constructor(private readonly handle: fs.promises.FileHandle, readonly entries: Map<string, { offset: number; size: number; crc: number }>) {}

  static async open(filePath: string): Promise<ZipReader> {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const { size } = await handle.stat();
      const tailLength = Math.min(size, 22 + 65_535);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);
      const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (at < 0) throw new Error("This file is not a CorosLink backup.");
      const count = tail.readUInt16LE(at + 10);
      const directorySize = tail.readUInt32LE(at + 12);
      const directoryOffset = tail.readUInt32LE(at + 16);
      if (count > MAX_ENTRIES || directoryOffset + directorySize > size) throw new Error("The backup is damaged.");
      const directory = Buffer.alloc(directorySize);
      await handle.read(directory, 0, directorySize, directoryOffset);
      const entries = new Map<string, { offset: number; size: number; crc: number }>();
      let cursor = 0;
      for (let index = 0; index < count; index++) {
        if (directory.readUInt32LE(cursor) !== 0x02014b50 || directory.readUInt16LE(cursor + 10) !== 0) throw new Error("The backup is damaged.");
        const crc = directory.readUInt32LE(cursor + 16);
        const entrySize = directory.readUInt32LE(cursor + 24);
        const nameLength = directory.readUInt16LE(cursor + 28);
        const extra = directory.readUInt16LE(cursor + 30) + directory.readUInt16LE(cursor + 32);
        const localOffset = directory.readUInt32LE(cursor + 42);
        const name = directory.toString("utf8", cursor + 46, cursor + 46 + nameLength);
        cursor += 46 + nameLength + extra;
        const local = Buffer.alloc(30);
        await handle.read(local, 0, 30, localOffset);
        if (local.readUInt32LE(0) !== 0x04034b50) throw new Error("The backup is damaged.");
        const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        if (dataOffset + entrySize > size) throw new Error("The backup is damaged.");
        entries.set(name, { offset: dataOffset, size: entrySize, crc });
      }
      return new ZipReader(handle, entries);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(name: string, limit: number): Promise<Buffer> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`The backup is missing ${name}.`);
    if (entry.size > limit) throw new Error(`${name} in the backup is too large.`);
    const data = Buffer.alloc(entry.size);
    await this.handle.read(data, 0, entry.size, entry.offset);
    if (zlib.crc32(data) !== entry.crc) throw new Error(`${name} in the backup is damaged.`);
    return data;
  }

  has(name: string): boolean { return this.entries.has(name); }

  close(): Promise<void> { return this.handle.close(); }
}

// ----- encryption -----

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error("Use a backup passphrase of at least 8 characters.");
  return derivePassphraseKey(passphrase, salt);
}

async function isEncryptedBackup(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const magic = Buffer.alloc(ENCRYPTED_MAGIC.length);
    await handle.read(magic, 0, magic.length, 0);
    return magic.equals(ENCRYPTED_MAGIC);
  } finally {
    await handle.close();
  }
}

/** Decrypts to a private temp file; GCM authenticates the whole file before it is used. */
async function decryptToFile(source: string, destination: string, passphrase: string): Promise<void> {
  const { size } = await fs.promises.stat(source);
  const headerLength = ENCRYPTED_MAGIC.length + PASSPHRASE_SALT_BYTES + PASSPHRASE_NONCE_BYTES;
  if (size < headerLength + PASSPHRASE_TAG_BYTES) throw new Error("The backup is damaged.");
  const handle = await fs.promises.open(source, "r");
  const output = await fs.promises.open(destination, "w", 0o600);
  try {
    const header = Buffer.alloc(headerLength);
    await handle.read(header, 0, headerLength, 0);
    const salt = header.subarray(ENCRYPTED_MAGIC.length, ENCRYPTED_MAGIC.length + PASSPHRASE_SALT_BYTES);
    const iv = header.subarray(ENCRYPTED_MAGIC.length + PASSPHRASE_SALT_BYTES);
    const tag = Buffer.alloc(PASSPHRASE_TAG_BYTES);
    await handle.read(tag, 0, PASSPHRASE_TAG_BYTES, size - PASSPHRASE_TAG_BYTES);
    const decipher = crypto.createDecipheriv(PASSPHRASE_CIPHER, await deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(header);
    const chunk = Buffer.alloc(1024 * 1024);
    for (let position = headerLength; position < size - 16;) {
      const length = Math.min(chunk.length, size - 16 - position);
      await handle.read(chunk, 0, length, position);
      await output.write(decipher.update(chunk.subarray(0, length)));
      position += length;
    }
    try {
      await output.write(decipher.final());
    } catch {
      throw new Error("The passphrase is wrong or the backup is damaged.");
    }
  } finally {
    await handle.close();
    await output.close();
  }
}

// ----- export / restore -----

export async function exportLocalBackup(dependencies: BackupDependencies, destination: string, options: { passphrase?: string } = {}): Promise<LocalBackupResult> {
  const { repository, health, archive } = dependencies;
  const activities = repository.allActivities();
  const payloads = repository.listPayloads();
  const devices = repository.listDevices();
  const samples = health.allSamples();
  const summaries = health.allSummaries();
  const sleeps = health.allSleeps();
  const recoveries = health.allRecoveries();
  const healthChecks = health.allHealthChecks();
  const training = dependencies.training?.exportData();

  const files = new Map<string, ManifestFile>();
  for (const filePath of [...activities.map(activity => activity.filePath), ...payloads.map(payload => payload.filePath)]) {
    if (files.has(filePath) || !ARCHIVE_PATH.test(filePath)) continue;
    const absolute = archive.resolve(filePath);
    const { size } = await fs.promises.stat(absolute);
    const sha256 = await sha256File(absolute);
    if (ARCHIVE_PATH.exec(filePath)![2] !== sha256) throw new Error(`A file on this computer is damaged (${path.basename(filePath)}). Re-import that activity, then export the backup again.`);
    files.set(filePath, { path: filePath, sha256, size });
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    ...(dependencies.appVersion ? { appVersion: dependencies.appVersion } : {}),
    containsCredentials: false,
    counts: { activities: activities.length, payloads: payloads.length, devices: devices.length, healthSamples: samples.length, healthSummaries: summaries.length },
    files: [...files.values()]
  };

  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  const handle = await fs.promises.open(temporary, "wx", 0o600);
  try {
    let cipher: crypto.CipherGCM | undefined;
    if (options.passphrase) {
      const salt = crypto.randomBytes(PASSPHRASE_SALT_BYTES);
      const iv = crypto.randomBytes(PASSPHRASE_NONCE_BYTES);
      const header = Buffer.concat([ENCRYPTED_MAGIC, salt, iv]);
      cipher = crypto.createCipheriv(PASSPHRASE_CIPHER, await deriveKey(options.passphrase, salt), iv);
      cipher.setAAD(header);
      await handle.write(header);
    }
    const zip = new ZipWriter(async chunk => { await handle.write(cipher ? cipher.update(chunk) : chunk); });
    const json = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8");
    await zip.addBuffer("manifest.json", json(manifest));
    await zip.addBuffer("data/devices.json", json(devices));
    await zip.addBuffer("data/activities.json", json(activities));
    await zip.addBuffer("data/payloads.json", json(payloads));
    await zip.addBuffer("data/health-samples.json", json(samples));
    await zip.addBuffer("data/health-summaries.json", json(summaries));
    await zip.addBuffer("data/sleep-sessions.json", json(sleeps));
    await zip.addBuffer("data/workout-recovery.json", json(recoveries));
    await zip.addBuffer("data/health-checks.json", json(healthChecks));
    if (training) await zip.addBuffer("data/training.json", json(training));
    for (const file of files.values()) await zip.addFile(`files/${file.path}`, archive.resolve(file.path));
    await zip.finish();
    if (cipher) {
      await handle.write(cipher.final());
      await handle.write(cipher.getAuthTag());
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  await fs.promises.rename(temporary, destination);
  await fsyncDirectory(directory);
  return { saved: true, filePath: destination, activities: activities.length, healthSamples: samples.length, encrypted: Boolean(options.passphrase) };
}

function parseJson<T>(data: Buffer, name: string): T {
  try {
    return JSON.parse(data.toString("utf8")) as T;
  } catch {
    throw new Error(`${name} in the backup is damaged.`);
  }
}

export async function backupNeedsPassphrase(filePath: string): Promise<boolean> {
  return isEncryptedBackup(filePath);
}

/**
 * A restore decrypts the backup next to the archive and removes the copy when it
 * ends; a crash or kill in between would leave the plaintext there. Run at startup.
 */
export function removeUnfinishedRestores(archive: LocalArchive): void {
  let names: string[];
  try { names = fs.readdirSync(archive.partialDirectory()); } catch { return; }
  for (const name of names) {
    if (!/^restore-[0-9a-f-]{36}\.zip$/.test(name)) continue;
    try { fs.rmSync(path.join(archive.partialDirectory(), name), { force: true }); } catch { /* tried again next launch */ }
  }
}

export async function restoreLocalBackup(dependencies: BackupDependencies, source: string, options: { passphrase?: string } = {}): Promise<LocalRestoreResult> {
  const { repository, health, archive } = dependencies;
  let zipPath = source;
  let decrypted: string | undefined;
  if (await isEncryptedBackup(source)) {
    if (!options.passphrase) throw new Error("This backup is encrypted. Enter its passphrase.");
    await fs.promises.mkdir(archive.partialDirectory(), { recursive: true, mode: 0o700 });
    decrypted = path.join(archive.partialDirectory(), `restore-${crypto.randomUUID()}.zip`);
    try {
      await decryptToFile(source, decrypted, options.passphrase);
    } catch (error) {
      await fs.promises.rm(decrypted, { force: true });
      throw error;
    }
    zipPath = decrypted;
  }
  const reader = await ZipReader.open(zipPath);
  try {
    const manifest = parseJson<BackupManifest>(await reader.read("manifest.json", MAX_JSON_ENTRY_BYTES), "The manifest");
    if (manifest?.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION || !Array.isArray(manifest.files)) {
      throw new Error("This file is not a supported CorosLink backup.");
    }
    for (const file of manifest.files) {
      const match = typeof file?.path === "string" ? ARCHIVE_PATH.exec(file.path) : null;
      if (!match || match[2] !== file.sha256) throw new Error("The backup is damaged.");
    }
    // Each file is checked against its hash, then stored content-addressed. A file stored before
    // a later failure is harmless: no record references it until the database rows below.
    const verified = new Set<string>();
    for (const file of manifest.files) {
      const match = ARCHIVE_PATH.exec(file.path)!;
      const data = await reader.read(`files/${file.path}`, 128 * 1024 * 1024);
      if (crypto.createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error(`The backup is damaged (${file.path}).`);
      await archive.storeContent(match[1] as "fit" | "watch-sync", data, match[3]!);
      verified.add(file.path);
    }
    const devices = parseJson<LocalDevice[]>(await reader.read("data/devices.json", MAX_JSON_ENTRY_BYTES), "Device data");
    const activities = parseJson<LocalActivityRecord[]>(await reader.read("data/activities.json", MAX_JSON_ENTRY_BYTES), "Activity data");
    const payloads = parseJson<Array<{ id: number; deviceId: string; fileIndex: number; selector: number; filePath: string; sha256: string; sizeBytes: number }>>(
      await reader.read("data/payloads.json", MAX_JSON_ENTRY_BYTES), "Sync data");
    const samples = parseJson<LocalHealthSample[]>(await reader.read("data/health-samples.json", MAX_JSON_ENTRY_BYTES), "Health data");
    const summaries = parseJson<Parameters<HealthRepository["restoreSummary"]>[0][]>(await reader.read("data/health-summaries.json", MAX_JSON_ENTRY_BYTES), "Health data");
    const sleeps = parseJson<LocalSleepSession[]>(await reader.read("data/sleep-sessions.json", MAX_JSON_ENTRY_BYTES), "Sleep data");
    const recoveries = parseJson<LocalWorkoutRecovery[]>(await reader.read("data/workout-recovery.json", MAX_JSON_ENTRY_BYTES), "Recovery data");
    const healthChecks = parseJson<LocalHealthCheck[]>(await reader.read("data/health-checks.json", MAX_JSON_ENTRY_BYTES), "Health check data");
    // Present when the backup was made with the workout library (always, from the app).
    const training = reader.has("data/training.json")
      ? parseJson<{ programs?: unknown; schedule?: unknown }>(await reader.read("data/training.json", MAX_JSON_ENTRY_BYTES), "Workout data")
      : undefined;

    let activitiesAdded = 0;
    let activitiesSkipped = 0;
    repository.transaction(() => {
      for (const device of Array.isArray(devices) ? devices : []) {
        if (typeof device?.deviceId === "string") repository.upsertDevice({ deviceId: device.deviceId, name: device.name, model: device.model, firmware: device.firmware });
      }
      const payloadIds = new Map<number, number>();
      for (const payload of Array.isArray(payloads) ? payloads : []) {
        if (!verified.has(payload.filePath)) continue;
        payloadIds.set(payload.id, repository.insertPayload(payload).id);
      }
      for (const activity of Array.isArray(activities) ? activities : []) {
        if (typeof activity?.activityId !== "string" || !verified.has(activity.filePath)) { activitiesSkipped += 1; continue; }
        // A FIT record must describe the very file it points at; anything else is a tampered backup.
        if (activity.format === "fit" && ARCHIVE_PATH.exec(activity.filePath)?.[2] !== activity.sha256) { activitiesSkipped += 1; continue; }
        const { importedAt: _importedAt, ...record } = activity;
        const outcome = repository.insertActivity({
          ...record,
          payloadId: activity.payloadId === undefined ? undefined : payloadIds.get(activity.payloadId)
        });
        if (outcome.inserted) activitiesAdded += 1; else activitiesSkipped += 1;
      }
    });
    const healthSamplesAdded = health.insertSamples(Array.isArray(samples) ? samples : []);
    for (const summary of Array.isArray(summaries) ? summaries : []) health.restoreSummary(summary);
    health.restoreSleeps(Array.isArray(sleeps) ? sleeps : []);
    health.insertRecoveries(Array.isArray(recoveries) ? recoveries : []);
    health.insertHealthChecks(Array.isArray(healthChecks) ? healthChecks : []);
    if (training && typeof training === "object") dependencies.training?.importData(training);
    return { restored: true, activitiesAdded, activitiesSkipped, healthSamplesAdded, verifiedFiles: verified.size };
  } finally {
    await reader.close();
    if (decrypted) await fs.promises.rm(decrypted, { force: true });
  }
}
