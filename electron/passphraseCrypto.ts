import crypto from "node:crypto";

/**
 * Passphrase encryption shared by the local backup and the watch key backup:
 * an AES-256-GCM key from scrypt with fixed parameters. The parameters are
 * never read from a file, so a file can't make its own key cheaper to guess.
 */
export const PASSPHRASE_SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
export const PASSPHRASE_SALT_BYTES = 16;
export const PASSPHRASE_NONCE_BYTES = 12;
export const PASSPHRASE_TAG_BYTES = 16;
export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 1024;
export const PASSPHRASE_CIPHER = "aes-256-gcm";

/** The 32-byte key for `passphrase` (NFKC-normalised, so the same text typed on another computer matches). */
export function derivePassphraseKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase.normalize("NFKC"), salt, 32, PASSPHRASE_SCRYPT, (error, key) => error ? reject(error) : resolve(key));
  });
}
