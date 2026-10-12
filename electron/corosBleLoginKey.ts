import { createDecipheriv, createPrivateKey, createPublicKey } from "node:crypto";
import { crc32Mpeg2, type CorosAccountCredential } from "./corosBleAuth";

export const COROS_BLE_LOGIN_KEY_SETTING = "coros.ble.loginAuth";
export const COROS_BLE_IMPORTED_KEY_SETTING = "coros.ble.accountAuth";
const IV = Buffer.from("weloop3_2015_03#", "utf8");
const KEY_ERROR = "COROS did not provide a valid watch account key. Sign in to your COROS account again.";

/** Main-process data only. Never include this object in an IPC response. */
export interface CorosBleLoginKey {
  version: 1;
  accountUserId: string;
  privateKeyDer: string;
  unit: 0 | 1;
  dataCollectSwitch: number;
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
    const privateKey = createPrivateKey({ key: base64(keyInfo.privateKey, 10_000), format: "der", type: "pkcs1" });
    const publicKey = createPublicKey({ key: base64(keyInfo.publicKey, 2_000), format: "der", type: "spki" });
    if (privateKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyDetails?.modulusLength !== 2048 ||
        !createPublicKey(privateKey.export({ format: "pem", type: "pkcs1" })).export({ format: "der", type: "spki" })
          .equals(publicKey.export({ format: "der", type: "spki" }))) throw new Error();
    const profile = login.userProfile as Record<string, unknown> | undefined;
    const dataCollectSwitch = profile?.dataCollectSwitch;
    if ((login.unit !== 0 && login.unit !== 1) || !Number.isInteger(dataCollectSwitch) ||
        (dataCollectSwitch as number) < 0 || (dataCollectSwitch as number) > 0xffffffff) throw new Error();
    return { version: 1, accountUserId: userId,
      privateKeyDer: privateKey.export({ format: "der", type: "pkcs1" }).toString("base64"),
      unit: login.unit, dataCollectSwitch: dataCollectSwitch as number };
  } catch {
    // Crypto/JSON exceptions may include credential fragments.
    throw new Error(KEY_ERROR);
  } finally {
    clear?.fill(0);
    encryptionKey?.fill(0);
  }
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
