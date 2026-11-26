// Backups of the data on this computer (every item in clink.db) as one file, for Settings → Privacy & local data.
// Gzipped JSON; with a passphrase, sealed with AES-256-GCM under a scrypt key (N=2^17, r=8, p=1). Sign-ins, AI keys
// and phone pairings live elsewhere and are never in it.
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { t } from "@/lib/i18n";
import type { Seed } from "./localStore";

const FORMAT = "clink-backup";
const SEALED = Buffer.from("CLBK1\n");
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const MIN_PASSPHRASE = 8;

export class BackupProblem extends Error {
  constructor(message: string, readonly code: "passphrase" | "format") { super(message); }
}

/** Worked out off the main thread (libuv's pool): N=2^17 takes a few hundred milliseconds. */
const keyFor = (passphrase: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) =>
  scrypt(passphrase.normalize("NFKC"), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))));

export async function packBackup(items: readonly Seed[], passphrase = "", now = new Date()): Promise<Buffer> {
  const plain = gzipSync(JSON.stringify({ format: FORMAT, version: 1, createdAt: now.toISOString(), items }));
  if (!passphrase) return plain;
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupProblem(t("The passphrase needs at least {n} characters.", { n: MIN_PASSPHRASE }), "passphrase");
  const salt = randomBytes(16), nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await keyFor(passphrase, salt), nonce);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([SEALED, salt, nonce, cipher.getAuthTag(), sealed]);
}

export const isSealed = (file: Buffer): boolean => file.subarray(0, SEALED.length).equals(SEALED);

export async function unpackBackup(file: Buffer, passphrase = ""): Promise<{ items: Seed[]; createdAt: string }> {
  let plain = file;
  if (isSealed(file)) {
    if (!passphrase) throw new BackupProblem(t("This backup has a passphrase."), "passphrase");
    const at = SEALED.length;
    const salt = file.subarray(at, at + 16), nonce = file.subarray(at + 16, at + 28), tag = file.subarray(at + 28, at + 44);
    const key = await keyFor(passphrase, salt);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(file.subarray(at + 44)), decipher.final()]);
    } catch {
      throw new BackupProblem(t("That passphrase doesn't open this backup."), "passphrase");
    }
  }
  let parsed: { format?: unknown; items?: unknown; createdAt?: unknown };
  try { parsed = JSON.parse(gunzipSync(plain).toString("utf8")) as typeof parsed; } catch { throw new BackupProblem(t("This isn't a C-LINK backup."), "format"); }
  if (parsed.format !== FORMAT || !Array.isArray(parsed.items)) throw new BackupProblem(t("This isn't a C-LINK backup."), "format");
  const items = parsed.items.filter((i): i is Seed => typeof i?.collection === "string" && typeof i?.id === "string" && typeof i?.body === "object" && i.body !== null);
  return { items, createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "" };
}
