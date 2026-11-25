// COROS SystemBind (opcode 0xA5): the watch sends a challenge, C-LINK signs its nonce with the account key, and the
// watch reports the session as bound. A port of CorosKit's Pairing/SystemBind.swift (itself from CorosLink's
// corosBleAuth.ts). It never asks the watch to activate or reset its account key.
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { CorosError, crc16Ccitt, crc32Mpeg2, le16, put32, u16 } from "./bytes";

export const BIND_OPCODE = 0xa5;
/** COROS counts its clock from 2014-01-01 00:00 UTC. */
export const COROS_EPOCH = 1_388_534_400;

/** The watch key as CorosKit encodes it (JSONEncoder: Data as base64). Kept sealed in watch/key.bin. */
export interface WatchAccountKey {
  accountUserId: number | bigint;
  unit: number;
  dataCollectSwitch: number;
  deviceName?: string | null;
  /** PKCS#1 RSAPrivateKey (2048-bit), base64. */
  privateKeyDER: string;
}

const INVALID = "The COROS account key is invalid. Sign in with COROS or scan from CorosLink desktop again.";

/** Reads the saved key text. The account ID can pass 2^53, so it is read from the text itself. */
export function parseWatchKey(text: string): WatchAccountKey {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { throw new CorosError(INVALID); }
  const id = /"accountUserId"\s*:\s*(\d+)/.exec(text)?.[1];
  if (!id || typeof parsed.privateKeyDER !== "string" || typeof parsed.unit !== "number" || typeof parsed.dataCollectSwitch !== "number") throw new CorosError(INVALID);
  return { accountUserId: BigInt(id), unit: parsed.unit, dataCollectSwitch: parsed.dataCollectSwitch, deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName : null, privateKeyDER: parsed.privateKeyDER };
}

/** The key as a private key, refused unless it is RSA-2048 and its signatures verify. */
export function accountPrivateKey(key: WatchAccountKey): KeyObject {
  let privateKey: KeyObject;
  try { privateKey = createPrivateKey({ key: Buffer.from(key.privateKeyDER, "base64"), format: "der", type: "pkcs1" }); } catch { throw new CorosError(INVALID); }
  if (privateKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyDetails?.modulusLength !== 2048) throw new CorosError(INVALID);
  const probe = Buffer.from("CorosLink key check");
  const signature = sign("sha256", probe, privateKey);
  if (!verify("sha256", probe, createPublicKey(privateKey), signature)) throw new CorosError(INVALID);
  return privateKey;
}

/** The 12-hour clock in this computer's locale (CorosKit's localeUses12HourClock). */
export function localeUses12HourClock(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
}

/** Seconds east of UTC at `date` (Foundation's secondsFromGMT). */
export const secondsFromGMT = (date: Date = new Date()): number => -date.getTimezoneOffset() * 60;

export class SystemBind {
  readonly user: Buffer;
  private readonly profile: Buffer;
  private readonly key: KeyObject;

  /** The "check bind" profile from account preferences and this computer's clock. */
  constructor(account: WatchAccountKey, deviceName: string, offsetSeconds: number = secondsFromGMT(), uses12HourClock: boolean = localeUses12HourClock()) {
    // Checked on PACE Pro; other COROS watches use the same check-bind (it never activates or resets).
    if (!deviceName.startsWith("COROS ")) throw new CorosError("This doesn't look like a COROS watch.");
    const id = BigInt(account.accountUserId);
    const user = Buffer.alloc(8);
    user.writeUInt32LE(Number(id & 0xffffffffn), 0);
    user.writeUInt32LE(Number((id >> 32n) & 0xffffffffn), 4);
    const profile = Buffer.alloc(17);
    profile[0] = 1; // Android-compatible protocol-v2 framing.
    put32(profile, crc32Mpeg2(user), 1);
    profile[9] = Math.round(offsetSeconds / 900) & 0xff;
    profile[10] = 0; // PACE Pro's English protocol language ID.
    // Bit 5 is the official check-bind flag; bit 0 is 12-hour time, bit 1 imperial units.
    profile[11] = (0x20 | (uses12HourClock ? 1 : 0) | (account.unit << 1)) & 0xff;
    put32(profile, account.dataCollectSwitch >>> 0, 12);
    profile[16] = 0x80; // Check command.
    this.user = user;
    this.profile = profile;
    this.key = accountPrivateKey(account);
  }

  /** The first message: the profile stamped with the current time, in seconds since the COROS epoch. */
  initialPayload(date: Date = new Date()): Buffer {
    const base = Buffer.from(this.profile);
    put32(base, Math.max(0, Math.floor(date.getTime() / 1000) - COROS_EPOCH), 5);
    return base;
  }

  /** The signed reply to the watch's 17-byte challenge. */
  authenticatedPayload(base: Buffer, challenge: Uint8Array): Buffer {
    if (challenge.length !== 17 || (challenge[0] & 7) !== 5 || (challenge[9] & 7) !== 5) {
      throw new CorosError("This watch needs a COROS account key update. Reconnect it with the official COROS app, then pair with CorosLink again.");
    }
    const nonce = Buffer.from(challenge.subarray(11, 15));
    const signature = sign("sha256", Buffer.concat([nonce, this.user]), this.key);
    if (signature.length !== 256) throw new CorosError("The COROS account key could not sign the watch challenge.");
    return Buffer.concat([base, Buffer.from([0, 1, 0x10, 1, 0, 0x11, 0, 0x0c]), signature, this.user, nonce]);
  }

  static isBound(reply: Uint8Array): boolean {
    return reply.length === 17 && (reply[0] & 7) === 1;
  }

  /** The checksum the watch reports (challenge bytes 7–8) when it stores this account's key. */
  get keyChecksum(): number | null {
    const der = createPublicKey(this.key).export({ type: "pkcs1", format: "der" });
    return keyChecksum(der);
  }
}

/** CRC-16/CCITT-FALSE over the modulus and exponent lengths (u16 LE) and their bytes without sign padding. */
export function keyChecksum(der: Uint8Array): number | null {
  let at = 0;
  const header = (tag: number): number | null => {
    if (at + 2 > der.length || der[at] !== tag) return null;
    let length = der[at + 1];
    at += 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      if (count < 1 || count > 2 || at + count > der.length) return null;
      length = 0;
      for (let i = 0; i < count; i++) length = (length << 8) | der[at + i];
      at += count;
    }
    return at + length <= der.length ? length : null;
  };
  const integer = (): Uint8Array | null => {
    const length = header(0x02);
    if (length === null) return null;
    let start = at;
    const end = at + length;
    while (start < end && der[start] === 0) start++;
    at = end;
    return der.subarray(start, end);
  };
  if (header(0x30) === null) return null;
  const modulus = integer(), exponent = integer();
  if (!modulus || !exponent || !modulus.length || !exponent.length || modulus.length > 0x100 || exponent.length > 8) return null;
  return crc16Ccitt(Buffer.concat([le16(modulus.length), le16(exponent.length), modulus, exponent]));
}

/** The readable parts of a bind message from the watch, for reports: never the account bytes or the nonce. */
export function describeBindReply(message: Uint8Array): string {
  if (message.length !== 17) return `${message.length}-byte reply`;
  const status = message[0] & 7;
  const names: Record<number, string> = { 1: "bound", 2: "other account", 5: "challenge" };
  const reasons: Record<number, string> = { 1: "challenge expired", 3: "other account", 4: "signature refused", 9: "nonce mismatch", 11: "no key" };
  const reason = message[10];
  return `status ${status} ${names[status] ?? `status ${status}`}, watch checksum ${u16(message, 7).toString(16).toUpperCase().padStart(4, "0")}${reason ? `, reason ${reasons[reason] ?? reason}` : ""}`;
}
