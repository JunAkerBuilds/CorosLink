import { createPrivateKey } from "node:crypto";
import type { CorosBleLoginKey } from "./corosBleLoginKey";

/**
 * The pairing QR C-LINK (the iPhone app) scans to connect to the watch the way
 * this app does: it carries the account RSA key that signs each SystemBind
 * challenge. The custom scheme keeps the iOS Camera from offering a web search
 * for the text. Layout (little-endian), matching `ios/CorosKit/…/PairingCode.swift`:
 *
 *   u8 version (1), u64 account user ID, u8 unit, u32 data-collection switches,
 *   u32 issued-at seconds, u8 + UTF-8 watch name, u32 public exponent,
 *   u16 + p, u16 + q, u16 + q⁻¹ mod p (big-endian), u32 CRC-32 of the rest.
 *
 * Only the primes and the CRT coefficient travel; the phone rebuilds n, d, dP
 * and dQ, which keeps the code small enough to scan from a laptop screen.
 */
export const PHONE_PAIRING_PREFIX = "coroslink://pair/1/";
/**
 * How long the desktop shows a code. The phone refuses codes older than ten minutes,
 * but issued-at is only CRC-checked: neither limit protects a code someone captured.
 */
export const PHONE_PAIRING_DISPLAY_MS = 2 * 60_000;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function lengthPrefixed(part: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16LE(part.length);
  return Buffer.concat([length, part]);
}

/** Main-process only: the returned text contains the account key. */
export function encodePhonePairingCode(key: CorosBleLoginKey, deviceName: string | undefined, issuedAt = Date.now()): string {
  let parts: Buffer[] = [];
  try {
    const jwk = createPrivateKey({ key: Buffer.from(key.privateKeyDer, "base64"), format: "der", type: "pkcs1" }).export({ format: "jwk" });
    const field = (value: string | undefined) => {
      const bytes = Buffer.from(value ?? "", "base64url");
      if (!bytes.length) throw new Error();
      return bytes;
    };
    const exponent = field(jwk.e);
    if (exponent.length > 4) throw new Error();
    const header = Buffer.alloc(18);
    header[0] = 1;
    header.writeBigUInt64LE(BigInt(key.accountUserId), 1);
    header[9] = key.unit;
    header.writeUInt32LE(key.dataCollectSwitch >>> 0, 10);
    header.writeUInt32LE(Math.floor(issuedAt / 1000), 14);
    const name = Buffer.from(deviceName?.startsWith("COROS") ? deviceName : "", "utf8").subarray(0, 64);
    const e = Buffer.alloc(4);
    e.writeUInt32LE(exponent.readUIntBE(0, exponent.length));
    parts = [header, Buffer.from([name.length]), name, e, lengthPrefixed(field(jwk.p)), lengthPrefixed(field(jwk.q)), lengthPrefixed(field(jwk.qi))];
    const body = Buffer.concat(parts);
    const check = Buffer.alloc(4);
    check.writeUInt32LE(crc32(body));
    const code = PHONE_PAIRING_PREFIX + Buffer.concat([body, check]).toString("base64url");
    body.fill(0);
    return code;
  } catch {
    // Key-handling exceptions can include key fragments.
    throw new Error("The saved COROS account key can't be shared. Sign in to your COROS account again.");
  } finally {
    for (const part of parts) part.fill(0);
  }
}
