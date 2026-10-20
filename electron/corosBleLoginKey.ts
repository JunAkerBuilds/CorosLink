import { createDecipheriv, createPrivateKey, createPublicKey } from "node:crypto";
import { corosWatchKeyId, crc32Mpeg2, formatCorosWatchKeyId, type CorosAccountCredential } from "./corosBleAuth";
import type { CorosWatchKeySummary } from "./types";

export const COROS_BLE_LOGIN_KEY_SETTING = "coros.ble.loginAuth";
export const COROS_BLE_IMPORTED_KEY_SETTING = "coros.ble.accountAuth";
/** Plain JSON {@link CorosWatchKeyCheck}: watch sign-in outcomes, no key material. */
export const COROS_WATCH_KEY_CHECK_SETTING = "coros.ble.watchKeyCheck";
const IV = Buffer.from("weloop3_2015_03#", "utf8");
const KEY_ERROR = "COROS did not provide a valid watch account key. Sign in to your COROS account again.";
// COROS key issue times before 2015 or more than a day ahead are not believed.
const EARLIEST_ISSUE_SECONDS = 1_420_070_400;

/**
 * Main-process data only. Never include this object in an IPC response.
 * Stays version 1 so CorosLink 0.1.57, which ignores the optional fields, still reads it.
 */
export interface CorosBleLoginKey {
  version: 1;
  accountUserId: string;
  privateKeyDer: string;
  unit: 0 | 1;
  dataCollectSwitch: number;
  /** When CorosLink saved the key (ms). Missing for keys saved by 0.1.57. */
  savedAt?: number;
  /** When COROS issued the key, its `createTime` (ms). */
  issuedAt?: number;
  /** The email the key was signed in with. */
  accountEmail?: string;
}

/** The last watch sign-ins with a saved key, by its key ID. */
export interface CorosWatchKeyCheck {
  lastUsed?: { at: number; watch: string; keyId: string };
  problem?: { at: number; watch: string; keyId: string; result: "mismatch" | "rejected" };
}

function accountId(value: unknown): string {
  const text = typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
  if (!/^\d{1,20}$/.test(text) || BigInt(text) < 1n || BigInt(text) > 0xffffffffffffffffn) throw new Error();
  return BigInt(text).toString();
}

function base64(value: unknown, limit: number): Buffer {
  if (typeof value !== "string" || value.length > limit) throw new Error();
  // The official API wraps its DER keys across lines.
  const compact = value.replace(/[\r\n]/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error();
  const bytes = Buffer.from(compact, "base64");
  if (bytes.toString("base64") !== compact) throw new Error();
  return bytes;
}

/** Reverse the official client's AES-CBC then repeating-XOR key envelope. */
export function decodeCorosBleLoginKey(data: unknown, expectedUserId: string): CorosBleLoginKey {
  let clear: Buffer | undefined;
  let encryptionKey: Buffer | undefined;
  try {
    if (!data || typeof data !== "object") throw new Error();
    const login = data as Record<string, unknown>;
    const userId = accountId(expectedUserId);
    if (accountId(login.userId) !== userId || typeof login.appEncKey !== "string") throw new Error();
    encryptionKey = Buffer.from(login.appEncKey, "utf8");
    if (encryptionKey.length !== 16) throw new Error();
    const encrypted = base64(login.userKey, 16_000);
    if (encrypted.length % 16) throw new Error();
    const decipher = createDecipheriv("aes-128-cbc", encryptionKey, IV);
    clear = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    for (let index = 0; index < clear.length; index++) clear[index] ^= encryptionKey[index % 16]!;
    // The key JSON carries the u64 user ID as a numeric literal.
    const keyInfo = JSON.parse(clear.toString("utf8").replace(
      /("userId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'
    )) as Record<string, unknown>;
    if (accountId(keyInfo.userId) !== userId) throw new Error();
    const privateKeyDer = checkedRsaKeyPair(base64(keyInfo.privateKey, 10_000), base64(keyInfo.publicKey, 2_000));
    const profile = login.userProfile as Record<string, unknown> | undefined;
    const dataCollectSwitch = profile?.dataCollectSwitch;
    if (!validPreferences(login.unit, dataCollectSwitch)) throw new Error();
    const issuedAt = keyIssueTime(keyInfo.createTime);
    return { version: 1, accountUserId: userId, privateKeyDer,
      unit: login.unit as 0 | 1, dataCollectSwitch, ...(issuedAt ? { issuedAt } : {}) };
  } catch {
    // Crypto/JSON exceptions may include credential fragments.
    throw new Error(KEY_ERROR);
  } finally {
    clear?.fill(0);
    encryptionKey?.fill(0);
  }
}

/**
 * The checks every saved key passes: an RSA-2048 private key (PKCS#1 DER) whose
 * public half is exactly `publicDer` (SPKI DER). Returns the private key as
 * canonical base64 DER. Throws a bare Error (no key material) otherwise.
 */
function checkedRsaKeyPair(privateDer: Buffer, publicDer: Buffer): string {
  const privateKey = createPrivateKey({ key: privateDer, format: "der", type: "pkcs1" });
  const publicKey = createPublicKey({ key: publicDer, format: "der", type: "spki" });
  if (privateKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyDetails?.modulusLength !== 2048 ||
      !createPublicKey(privateKey.export({ format: "pem", type: "pkcs1" })).export({ format: "der", type: "spki" }).equals(publicKey.export({ format: "der", type: "spki" }))) throw new Error();
  return privateKey.export({ format: "der", type: "pkcs1" }).toString("base64");
}

function validPreferences(unit: unknown, dataCollectSwitch: unknown): dataCollectSwitch is number {
  return (unit === 0 || unit === 1) && Number.isInteger(dataCollectSwitch) &&
    (dataCollectSwitch as number) >= 0 && (dataCollectSwitch as number) <= 0xffffffff;
}

/** The SPKI DER (base64) of a saved key's public half, for a backup to carry. */
export function corosBleLoginPublicKeyDer(key: Pick<CorosBleLoginKey, "privateKeyDer">): string {
  const privateKey = createPrivateKey({ key: Buffer.from(key.privateKeyDer, "base64"), format: "der", type: "pkcs1" });
  return createPublicKey(privateKey.export({ format: "pem", type: "pkcs1" })).export({ format: "der", type: "spki" }).toString("base64");
}

/** The fields a watch key backup carries: what signing in to a watch needs, nothing else. */
export interface CorosBleLoginKeyBackupFields {
  accountUserId: string;
  privateKeyDer: string;
  publicKeyDer: string;
  unit: 0 | 1;
  dataCollectSwitch: number;
  issuedAt?: number;
  accountEmail?: string;
}

const BACKUP_FIELDS = new Set(["accountUserId", "privateKeyDer", "publicKeyDer", "unit", "dataCollectSwitch", "issuedAt", "accountEmail"]);

export function corosBleLoginKeyBackupFields(key: CorosBleLoginKey): CorosBleLoginKeyBackupFields {
  const issuedAt = validTime(key.issuedAt);
  const accountEmail = backupEmail(key.accountEmail);
  return { accountUserId: key.accountUserId, privateKeyDer: key.privateKeyDer, publicKeyDer: corosBleLoginPublicKeyDer(key),
    unit: key.unit, dataCollectSwitch: key.dataCollectSwitch, ...(issuedAt ? { issuedAt } : {}), ...(accountEmail ? { accountEmail } : {}) };
}

function backupEmail(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(value) ? value : undefined;
}

/**
 * A key read back from a watch key backup, with the same checks as a COROS
 * sign-in: account ID format, RSA 2048, a matching key pair, valid account
 * preferences. Unknown fields are refused. `savedAt` is left for the caller.
 * Throws a bare Error, never one that quotes the input.
 */
export function corosBleLoginKeyFromBackup(value: unknown): CorosBleLoginKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(name => !BACKUP_FIELDS.has(name))) throw new Error();
  const accountUserId = accountId(fields.accountUserId);
  if (accountUserId !== fields.accountUserId) throw new Error();
  const privateKeyDer = checkedRsaKeyPair(base64(fields.privateKeyDer, 10_000), base64(fields.publicKeyDer, 2_000));
  if (privateKeyDer !== fields.privateKeyDer || !validPreferences(fields.unit, fields.dataCollectSwitch)) throw new Error();
  if (fields.issuedAt !== undefined && (!validTime(fields.issuedAt) || (fields.issuedAt as number) > Date.now() + 86_400_000)) throw new Error();
  if (fields.accountEmail !== undefined && !backupEmail(fields.accountEmail)) throw new Error();
  return { version: 1, accountUserId, privateKeyDer, unit: fields.unit as 0 | 1, dataCollectSwitch: fields.dataCollectSwitch as number,
    ...(fields.issuedAt !== undefined ? { issuedAt: fields.issuedAt as number } : {}),
    ...(fields.accountEmail !== undefined ? { accountEmail: fields.accountEmail as string } : {}) };
}

/** Whether two saved keys are the same key for the same account. */
export function sameCorosBleLoginKey(a: Pick<CorosBleLoginKey, "accountUserId" | "privateKeyDer">, b: Pick<CorosBleLoginKey, "accountUserId" | "privateKeyDer">): boolean {
  return a.accountUserId === b.accountUserId && a.privateKeyDer === b.privateKeyDer;
}

/** COROS `createTime` (Unix seconds) as ms; undefined when missing or unbelievable. Never throws. */
function keyIssueTime(value: unknown): number | undefined {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d{1,12}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < EARLIEST_ISSUE_SECONDS || seconds > Date.now() / 1000 + 86_400) return undefined;
  return seconds * 1000;
}

function validTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= EARLIEST_ISSUE_SECONDS * 1000 ? value : undefined;
}

/** "ru•••@example.com": enough to recognise the account, not to read it out. */
export function maskCorosEmail(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(email.trim());
  if (!match) return undefined;
  return `${match[1]!.slice(0, match[1]!.length > 2 ? 2 : 1)}•••@${match[2]}`;
}

/** The key ID (four hex digits) a watch reports when it stores this key. */
export function corosBleLoginKeyId(key: Pick<CorosBleLoginKey, "privateKeyDer">): string {
  return formatCorosWatchKeyId(corosWatchKeyId(createPrivateKey({ key: Buffer.from(key.privateKeyDer, "base64"), format: "der", type: "pkcs1" })));
}

function readWatchKeyCheck(value: unknown): CorosWatchKeyCheck {
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { return {}; }
  if (!parsed || typeof parsed !== "object") return {};
  const entry = (item: unknown) => {
    const record = item as Record<string, unknown> | undefined;
    return record && typeof record === "object" && validTime(record.at) && typeof record.watch === "string" &&
      record.watch.length <= 128 && typeof record.keyId === "string" && /^[0-9A-F]{4}$/.test(record.keyId) ? record : undefined;
  };
  const lastUsed = entry((parsed as CorosWatchKeyCheck).lastUsed);
  const problem = entry((parsed as CorosWatchKeyCheck).problem);
  return {
    ...(lastUsed ? { lastUsed: { at: lastUsed.at as number, watch: lastUsed.watch as string, keyId: lastUsed.keyId as string } } : {}),
    ...(problem && (problem.result === "mismatch" || problem.result === "rejected")
      ? { problem: { at: problem.at as number, watch: problem.watch as string, keyId: problem.keyId as string, result: problem.result } } : {})
  };
}

/** The check record after a watch sign-in: a success clears the problem. */
export function nextWatchKeyCheck(previous: unknown, outcome: "ok" | "mismatch" | "rejected", watch: string, keyId: string, at = Date.now()): string {
  const check = readWatchKeyCheck(previous);
  const entry = { at, watch: watch.slice(0, 128), keyId };
  return JSON.stringify(outcome === "ok" ? { lastUsed: entry } : { ...check, problem: { ...entry, result: outcome } });
}

/**
 * What the renderer may show about the saved key: no key material. "Last used"
 * and problems count only for the key they were recorded with.
 */
export function summarizeCorosBleLoginKey(key: CorosBleLoginKey, check: unknown): CorosWatchKeySummary {
  const keyId = corosBleLoginKeyId(key);
  const { lastUsed, problem } = readWatchKeyCheck(check);
  const used = lastUsed?.keyId === keyId ? { at: lastUsed.at, watch: lastUsed.watch } : undefined;
  const current = problem?.keyId === keyId && (!used || problem.at > used.at) ? problem : undefined;
  const accountEmail = maskCorosEmail(key.accountEmail);
  const savedAt = validTime(key.savedAt);
  const issuedAt = validTime(key.issuedAt);
  return {
    keyId, accountId: `•••• ${key.accountUserId.slice(-4)}`,
    ...(accountEmail ? { accountEmail } : {}), ...(savedAt ? { savedAt } : {}), ...(issuedAt ? { issuedAt } : {}),
    ...(used ? { lastUsed: used } : {}),
    ...(current ? { problem: { at: current.at, watch: current.watch, result: current.result } } : {})
  };
}

/** Build SystemBind from account preferences and this computer's current clock. */
export function createCorosLoginCredential(key: CorosBleLoginKey, deviceName: string): CorosAccountCredential {
  try {
    // Checked on PACE Pro; other COROS watches use the same check-bind, which never activates or resets.
    if (key.version !== 1 || !/^COROS [A-Za-z0-9]/.test(deviceName) || deviceName.length > 128 ||
        (key.unit !== 0 && key.unit !== 1) || !Number.isInteger(key.dataCollectSwitch) ||
        key.dataCollectSwitch < 0 || key.dataCollectSwitch > 0xffffffff) throw new Error();
    const user = Buffer.alloc(8);
    user.writeBigUInt64LE(BigInt(accountId(key.accountUserId)));
    const profile = Buffer.alloc(17);
    profile[0] = 1; // Android-compatible protocol-v2 framing.
    profile.writeUInt32LE(crc32Mpeg2(user), 1);
    profile[9] = -Math.round(new Date().getTimezoneOffset() / 15) & 0xff;
    profile[10] = 0; // PACE Pro's English protocol language ID.
    const hour12 = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
    // The official Android check-bind sets bit 5. Keep that flag while
    // deriving the display bits from local time and account units.
    profile[11] = 0x20 | (hour12 ? 0 : 1) | (key.unit << 1);
    profile.writeUInt32LE(key.dataCollectSwitch, 12);
    profile[16] = 0x80; // Check command; never request activation or a reset.
    return { version: 1, deviceName, accountUserId: key.accountUserId,
      privateKeyDer: key.privateKeyDer, bindProfile: profile.toString("base64") };
  } catch {
    throw new Error("COROS watch authentication needs a COROS watch and a valid signed-in account.");
  }
}
