import { constants, createPrivateKey, sign, type KeyObject } from "node:crypto";

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

/** Account secrets and signatures are main-process data, never renderer state. */
export class CorosBleAccountAuth {
  private readonly user: Buffer;
  private readonly profile: Buffer;
  private readonly key: KeyObject;

  constructor(credential: CorosAccountCredential, deviceName: string) {
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
    } catch {
      throw new Error("The saved COROS account key does not match this watch or its profile is invalid.");
    }
  }

  initialPayload(utcSeconds = Math.floor(Date.now() / 1000)): Buffer {
    const base = Buffer.from(this.profile);
    base.writeUInt32LE(utcSeconds, 5);
    return base;
  }

  authenticatedPayload(base: Buffer, challenge: Buffer): Buffer {
    if (challenge.length !== 17 || (challenge[0]! & 7) !== 5 || (challenge[9]! & 7) !== 5) {
      throw new Error("The watch needs a COROS account key update. Reconnect with the official COROS app, then sign in to CorosLink again.");
    }
    const nonce = challenge.subarray(11, 15);
    const signature = sign("sha256", Buffer.concat([nonce, this.user]), { key: this.key, padding: constants.RSA_PKCS1_PADDING });
    return Buffer.concat([base, Buffer.from([0, 1, 0x10, 1, 0, 0x11, 0, 0x0c]), signature, this.user, nonce]);
  }
}
