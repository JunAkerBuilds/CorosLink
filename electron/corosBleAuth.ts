import { constants, createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { WatchModelId } from "./watchModels";

export interface CorosAccountCredential {
  version: 1;
  deviceName: string;
  accountUserId: string;
  bindProfile: string;
  privateKeyDer: string;
}

export function crc32Mpeg2(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
  }
  return crc;
}

/** CRC-16/CCITT-FALSE, as the watch firmware computes it over its stored account key. */
function crc16CcittFalse(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

/**
 * The checksum a watch reports (SystemBind challenge bytes 7–8) for the account
 * public key it stores: CRC-16 over u16 modulus length, u16 exponent length,
 * modulus and exponent, all big-endian bytes without sign padding. It comes from
 * the public half only, so it may be shown and logged.
 */
export function corosWatchKeyId(key: KeyObject): number {
  const jwk = key.export({ format: "jwk" });
  const modulus = Buffer.from(jwk.n ?? "", "base64url");
  const exponent = Buffer.from(jwk.e ?? "", "base64url");
  if (key.asymmetricKeyType !== "rsa" || !modulus.length || !exponent.length || modulus.length > 0x100 || exponent.length > 8) {
    throw new Error("Not a COROS watch account key.");
  }
  const blob = Buffer.alloc(4 + modulus.length + exponent.length);
  blob.writeUInt16LE(modulus.length, 0);
  blob.writeUInt16LE(exponent.length, 2);
  modulus.copy(blob, 4);
  exponent.copy(blob, 4 + modulus.length);
  return crc16CcittFalse(blob);
}

/** Watches that always report their stored key's checksum in the challenge (checked on the PACE 4). */
export function watchReportsKeyId(model: WatchModelId | undefined): boolean {
  return model === "pace-4";
}

/** Four uppercase hex digits, as the watch's key checksum is shown. */
export function formatCorosWatchKeyId(keyId: number): string {
  return keyId.toString(16).toUpperCase().padStart(4, "0");
}

/** SystemBind bond states (reply byte 0, low bits), as the official app names them. */
export const BIND_STATUS = { success: 1, otherAccount: 2, authFailed: 5 } as const;

/** Why the watch refused, reply byte 10 (as a PACE 4 reports it). */
export const BIND_REASON = { challengeExpired: 1, otherAccount: 3, signatureRejected: 4, nonceMismatch: 9, noKey: 11 } as const;

export const BIND_MESSAGES = {
  keyUpdate: "The watch needs a COROS account key update. Reconnect with the official COROS app, then sign in to CorosLink again.",
  keyMismatch: "Your watch has a different COROS key than the one CorosLink saved. Sign in to COROS again here. If that doesn't fix it, connect the watch to the COROS app once, then reconnect.",
  otherAccount: "This watch is paired to a different COROS account. Sign in to CorosLink with that account, then reconnect.",
  timedOut: "The watch's sign-in request timed out. Reconnect to try again.",
  keyRejected: "The watch didn't accept CorosLink's key and cleared its own. Connect the watch to the COROS app once, then sign in to COROS here again and reconnect.",
  rejected: "The watch rejected COROS authentication. Sign in with the account paired to this watch, then reconnect."
} as const;

/**
 * The status, flags, key checksum and reason of a SystemBind reply, for error
 * reports. The account bytes and the nonce are left out.
 */
export function describeBindReply(reply: Buffer): string {
  if (reply.length !== 17) return `${reply.length}-byte reply`;
  const flags = reply[9]!;
  return `status ${reply[0]! & 7} (0x${reply[0]!.toString(16).padStart(2, "0")}), flags 0x${flags.toString(16).padStart(2, "0")}: ` +
    `${flags & 1 ? "key" : "no key"}, auth type ${(flags >> 1) & 1}, ${flags & 4 ? "challenge" : "no challenge"}, ` +
    `key ${formatCorosWatchKeyId(reply.readUInt16LE(7))}, reason ${reply[10]}`;
}

/** The user-facing message for a final SystemBind reply that isn't a success. */
export function bindRefusalMessage(reply: Buffer): string {
  if (reply.length !== 17) return BIND_MESSAGES.rejected;
  if ((reply[0]! & 7) === BIND_STATUS.otherAccount) return BIND_MESSAGES.otherAccount;
  switch (reply[10]) {
    case BIND_REASON.otherAccount: return BIND_MESSAGES.otherAccount;
    case BIND_REASON.challengeExpired: case BIND_REASON.nonceMismatch: return BIND_MESSAGES.timedOut;
    case BIND_REASON.signatureRejected: return BIND_MESSAGES.keyRejected;
    case BIND_REASON.noKey: return BIND_MESSAGES.keyUpdate;
    default: return BIND_MESSAGES.rejected;
  }
}

/**
 * A SystemBind reply CorosLink can't continue from; `reply` says what the watch
 * sent. `keyMismatch` marks a watch holding a different account key, which
 * CorosLink found before signing anything.
 */
export class CorosBindReplyError extends Error {
  constructor(message: string, readonly reply: string, readonly keyMismatch = false) {
    super(message);
    this.name = "CorosBindReplyError";
  }
}

/** Account secrets and signatures are main-process data, never renderer state. */
export class CorosBleAccountAuth {
  private readonly user: Buffer;
  /** The watch always reports its key's checksum (PACE 4), so 0000 means it holds no key. */
  private readonly keyIdReported: boolean;
  private readonly profile: Buffer;
  private readonly key: KeyObject;
  /** The checksum the watch reports when it stores this account key. */
  readonly keyId: number;

  constructor(credential: CorosAccountCredential, deviceName: string, options: { keyIdReported?: boolean } = {}) {
    this.keyIdReported = options.keyIdReported === true;
    try {
      if (credential.version !== 1 || credential.deviceName !== deviceName ||
          typeof credential.accountUserId !== "string" || !/^\d+$/.test(credential.accountUserId)) throw new Error();
      this.user = Buffer.alloc(8);
      this.user.writeBigUInt64LE(BigInt(credential.accountUserId));
      this.profile = Buffer.from(credential.bindProfile, "base64");
      if (this.profile.length !== 17 || this.profile[0] !== 1 || this.profile[16] !== 0x80 ||
          this.profile.readUInt32LE(1) !== crc32Mpeg2(this.user) || credential.privateKeyDer.length > 10_000) throw new Error();
      this.key = createPrivateKey({ key: Buffer.from(credential.privateKeyDer, "base64"), format: "der", type: "pkcs1" });
      if (this.key.asymmetricKeyType !== "rsa" || this.key.asymmetricKeyDetails?.modulusLength !== 2048) throw new Error();
      this.keyId = corosWatchKeyId(this.key);
    } catch {
      throw new Error("The saved COROS account key does not match this watch or its profile is invalid.");
    }
  }

  initialPayload(utcSeconds = Math.floor(Date.now() / 1000)): Buffer {
    const base = Buffer.from(this.profile);
    base.writeUInt32LE(utcSeconds, 5);
    return base;
  }

  /**
   * Signs the watch's challenge. The watch erases its stored key when a signature
   * fails against it, so a challenge naming a different key is refused unsigned.
   */
  authenticatedPayload(base: Buffer, challenge: Buffer): Buffer {
    if (challenge.length === 17 && (challenge[0]! & 7) === BIND_STATUS.otherAccount) {
      throw new CorosBindReplyError(BIND_MESSAGES.otherAccount, describeBindReply(challenge));
    }
    if (challenge.length !== 17 || (challenge[0]! & 7) !== BIND_STATUS.authFailed || (challenge[9]! & 7) !== 5) {
      throw new CorosBindReplyError(BIND_MESSAGES.keyUpdate, describeBindReply(challenge));
    }
    // 0 means the watch didn't report a checksum, except on a watch that always reports one: it holds no key.
    const watchKeyId = challenge.readUInt16LE(7);
    if (watchKeyId === 0 && this.keyIdReported) throw new CorosBindReplyError(BIND_MESSAGES.keyUpdate, describeBindReply(challenge));
    if (watchKeyId !== 0 && watchKeyId !== this.keyId) {
      throw new CorosBindReplyError(BIND_MESSAGES.keyMismatch, describeBindReply(challenge), true);
    }
    const nonce = challenge.subarray(11, 15);
    const signature = sign("sha256", Buffer.concat([nonce, this.user]), { key: this.key, padding: constants.RSA_PKCS1_PADDING });
    return Buffer.concat([base, Buffer.from([0, 1, 0x10, 1, 0, 0x11, 0, 0x0c]), signature, this.user, nonce]);
  }
}
