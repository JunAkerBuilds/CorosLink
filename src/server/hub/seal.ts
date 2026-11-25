// Sealing for the Hub cookies: AES-256-GCM, so page scripts, the network and anyone holding the cookie jar see
// only ciphertext, and a cookie that was altered or has run out opens as nothing. Nothing is written to disk.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The key cookies are sealed with. Set `HUB_COOKIE_SECRET` (any long random string) in production. Without
 * it a key made at start-up is used: fine for development, but every restart (and every other server
 * instance) signs people out of COROS.
 */
function cookieKey(): Buffer {
  // CLINK_COOKIE_SECRET is the name since the app's own session cookie is sealed here too; HUB_COOKIE_SECRET still works.
  const secret = process.env.CLINK_COOKIE_SECRET || process.env.HUB_COOKIE_SECRET;
  if (secret && secret.length >= 16) return createHash("sha256").update("clink-hub-cookie-v1:" + secret).digest();
  const store = globalThis as typeof globalThis & { __clinkHubKey?: Buffer };
  if (!store.__clinkHubKey) {
    store.__clinkHubKey = randomBytes(32);
    if (process.env.NODE_ENV === "production") {
      console.warn("CLINK_COOKIE_SECRET is not set (or shorter than 16 characters): sign-ins will not survive a restart.");
    }
  }
  return store.__clinkHubKey;
}

/** `value` sealed for the cookie `name`, good for `seconds`. */
export function seal(name: string, value: unknown, seconds: number, key: Buffer = cookieKey(), now: number = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name));
  const plain = Buffer.from(JSON.stringify({ v: value, exp: Math.floor(now / 1000) + seconds }));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** What `seal` sealed, or null when the cookie is missing, altered, for another name, from another key, or run out. */
export function open(name: string, sealed: string | undefined, key: Buffer = cookieKey(), now: number = Date.now()): unknown {
  if (!sealed || sealed.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as { v?: unknown; exp?: unknown };
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 <= now) return null;
    return parsed.v ?? null;
  } catch {
    return null;
  }
}
