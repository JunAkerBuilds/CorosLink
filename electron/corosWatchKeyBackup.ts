import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { corosBleLoginKeyBackupFields, corosBleLoginKeyFromBackup, type CorosBleLoginKey } from "./corosBleLoginKey";
import { fsyncDirectory } from "./localSync/localArchive";
import {
  derivePassphraseKey, MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH, PASSPHRASE_CIPHER, PASSPHRASE_NONCE_BYTES,
  PASSPHRASE_SALT_BYTES, PASSPHRASE_SCRYPT, PASSPHRASE_TAG_BYTES
} from "./passphraseCrypto";

/**
 * A watch key backup (`.coroswatchkey`): the saved watch key, encrypted with a
 * passphrase so it can be restored on this or another computer without a
 * COROS sign-in. Version 1:
 *
 *   magic "CLWATCHKEY" (10) | version 1 (1) | KDF 1 = scrypt (1) | log2 N (1) | r (1) | p (1)
 *   | salt (16) | nonce (12) | AES-256-GCM ciphertext | tag (16)
 *
 * The whole header is the GCM additional data. The KDF bytes must equal
 * CorosLink's fixed parameters; a file can't choose its own. The plaintext is
 * the JSON of {@link corosBleLoginKeyBackupFields} and exists only in memory.
 */
export const WATCH_KEY_BACKUP_EXTENSION = "coroswatchkey";
export const WATCH_KEY_BACKUP_ERROR = "Wrong passphrase or damaged file.";
export const WATCH_KEY_BACKUP_NOT_A_BACKUP = "This file isn't a CorosLink watch key backup.";
export const WATCH_KEY_BACKUP_UNSUPPORTED = "This watch key backup was made by a version of CorosLink this one can't read.";
export const WATCH_KEY_PASSPHRASE_TOO_SHORT = "Use a passphrase of at least 8 characters.";
export const WATCH_KEY_PASSPHRASE_TOO_LONG = "Use a passphrase of at most 1,024 characters.";
/** A real backup is about 2.5 KB; anything past this is refused before it is read. */
export const MAX_WATCH_KEY_BACKUP_BYTES = 16 * 1024;

const MAGIC = Buffer.from("CLWATCHKEY", "latin1");
const FORMAT_VERSION = 1;
const KDF_SCRYPT = 1;
const KDF = Buffer.from([KDF_SCRYPT, Math.log2(PASSPHRASE_SCRYPT.N), PASSPHRASE_SCRYPT.r, PASSPHRASE_SCRYPT.p]);
const HEADER_BYTES = MAGIC.length + 1 + KDF.length + PASSPHRASE_SALT_BYTES + PASSPHRASE_NONCE_BYTES;
const MIN_FILE_BYTES = HEADER_BYTES + 1 + PASSPHRASE_TAG_BYTES;

/** The suggested file name: the four-hex-digit key ID the watch reports, nothing about the account. */
export function watchKeyBackupFileName(keyId: string): string {
  return `coros-watch-key-${/^[0-9A-F]{4}$/i.test(keyId) ? keyId.toLowerCase() : "backup"}.${WATCH_KEY_BACKUP_EXTENSION}`;
}

/** The passphrase from the renderer: a string within bounds. Export also needs the minimum length. */
export function watchKeyPassphrase(value: unknown, purpose: "export" | "import"): string {
  if (typeof value !== "string" || !value) throw new Error(purpose === "export" ? WATCH_KEY_PASSPHRASE_TOO_SHORT : "Enter the backup passphrase.");
  if (value.length > MAX_PASSPHRASE_LENGTH) throw new Error(WATCH_KEY_PASSPHRASE_TOO_LONG);
  if (purpose === "export" && value.length < MIN_PASSPHRASE_LENGTH) throw new Error(WATCH_KEY_PASSPHRASE_TOO_SHORT);
  return value;
}

/** Plain checks that need no passphrase: size, magic and version. Throws a user-facing message. */
export function inspectWatchKeyBackup(data: Buffer): void {
  if (data.length >= MAGIC.length && !data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(WATCH_KEY_BACKUP_NOT_A_BACKUP);
  if (data.length < MIN_FILE_BYTES || data.length > MAX_WATCH_KEY_BACKUP_BYTES) throw new Error(WATCH_KEY_BACKUP_ERROR);
  if (data[MAGIC.length] !== FORMAT_VERSION) throw new Error(WATCH_KEY_BACKUP_UNSUPPORTED);
}

/** Encrypts `key` under `passphrase`. The result is safe to write anywhere. */
export async function sealWatchKeyBackup(key: CorosBleLoginKey, passphrase: string): Promise<Buffer> {
  watchKeyPassphrase(passphrase, "export");
  const salt = crypto.randomBytes(PASSPHRASE_SALT_BYTES);
  const nonce = crypto.randomBytes(PASSPHRASE_NONCE_BYTES);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), KDF, salt, nonce]);
  const secret = await derivePassphraseKey(passphrase, salt);
  const clear = Buffer.from(JSON.stringify(corosBleLoginKeyBackupFields(key)), "utf8");
  try {
    const cipher = crypto.createCipheriv(PASSPHRASE_CIPHER, secret, nonce);
    cipher.setAAD(header);
    return Buffer.concat([header, cipher.update(clear), cipher.final(), cipher.getAuthTag()]);
  } finally {
    clear.fill(0);
    secret.fill(0);
  }
}

/**
 * Decrypts and validates a backup. A wrong passphrase, any changed byte, a
 * short or long file and a key that fails the sign-in checks all give
 * {@link WATCH_KEY_BACKUP_ERROR}. The key comes back without `savedAt`.
 */
export async function openWatchKeyBackup(data: Buffer, passphrase: string): Promise<CorosBleLoginKey> {
  inspectWatchKeyBackup(data);
  watchKeyPassphrase(passphrase, "import");
  let offset = MAGIC.length + 1;
  if (!data.subarray(offset, offset + KDF.length).equals(KDF)) throw new Error(WATCH_KEY_BACKUP_ERROR);
  offset += KDF.length;
  const salt = data.subarray(offset, offset += PASSPHRASE_SALT_BYTES);
  const nonce = data.subarray(offset, offset += PASSPHRASE_NONCE_BYTES);
  const header = data.subarray(0, HEADER_BYTES);
  const tag = data.subarray(data.length - PASSPHRASE_TAG_BYTES);
  const secret = await derivePassphraseKey(passphrase, Buffer.from(salt));
  let clear: Buffer | undefined;
  try {
    const decipher = crypto.createDecipheriv(PASSPHRASE_CIPHER, secret, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(data.subarray(HEADER_BYTES, data.length - PASSPHRASE_TAG_BYTES)), decipher.final()]);
    return corosBleLoginKeyFromBackup(JSON.parse(clear.toString("utf8")));
  } catch {
    // Crypto and JSON errors can quote the input.
    throw new Error(WATCH_KEY_BACKUP_ERROR);
  } finally {
    clear?.fill(0);
    secret.fill(0);
  }
}

/** Reads a chosen file, refusing one too large to be a backup before reading it. */
export async function readWatchKeyBackupFile(filePath: string): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const { size, isFile } = await handle.stat().then(stat => ({ size: stat.size, isFile: stat.isFile() }));
    if (!isFile) throw new Error(WATCH_KEY_BACKUP_NOT_A_BACKUP);
    if (size > MAX_WATCH_KEY_BACKUP_BYTES) throw new Error(WATCH_KEY_BACKUP_ERROR);
    const data = Buffer.alloc(size);
    const { bytesRead } = await handle.read(data, 0, size, 0);
    return data.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Writes an encrypted backup: owner-only (0600), to a temp file in the same folder, fsynced, then renamed. */
export async function writeWatchKeyBackupFile(destination: string, data: Buffer): Promise<void> {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  const handle = await fs.promises.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
  await fsyncDirectory(directory);
}
