// Proof-of-possession (RFC 9449 DPoP) as C-LINK's phones send it (CorosKit DPoPKey): an ES256 JWT whose header
// carries the phone's public key, naming the method and URL, and, with a session token, that token's hash.
// A session is bound to the key's thumbprint, so a token copied off the wire is useless without the phone.
import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";

export const b64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");
export const sha256b64 = (text: string): string => createHash("sha256").update(text).digest("base64url");

/** RFC 7638 thumbprint of a P-256 key: SHA-256 of its required members in order. */
export const thumbprint = (jwk: { crv: string; kty: string; x: string; y: string }): string =>
  sha256b64(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));

export class ProofError extends Error {}

const SKEW_SECONDS = 60;

export interface CheckedProof { jkt: string; jti: string }

/**
 * Checks a DPoP proof for `method` on `url` (no query) at `now`. With `accessToken`, its `ath` must be the token's
 * hash. `seen` refuses a `jti` used before (kept for longer than the allowed clock skew by the caller).
 */
export function checkProof(proof: string | null, expected: { method: string; url: string; accessToken?: string; now?: number }, seen: (jti: string) => boolean): CheckedProof {
  if (!proof || proof.length > 4096) throw new ProofError("missing proof");
  const parts = proof.split(".");
  if (parts.length !== 3) throw new ProofError("not a JWT");
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new ProofError("unreadable");
  }
  const jwk = header.jwk as { kty?: unknown; crv?: unknown; x?: unknown; y?: unknown; d?: unknown } | undefined;
  if (header.typ !== "dpop+jwt" || header.alg !== "ES256" || !jwk || jwk.kty !== "EC" || jwk.crv !== "P-256"
    || typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.d !== undefined) throw new ProofError("bad header");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } as JsonWebKey, format: "jwk" });
  const signed = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  if (!signed) throw new ProofError("bad signature");
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  if (claims.htm !== expected.method.toUpperCase() || claims.htu !== expected.url) throw new ProofError("wrong request");
  if (typeof claims.iat !== "number" || Math.abs(claims.iat - now) > SKEW_SECONDS) throw new ProofError("stale");
  if (typeof claims.jti !== "string" || claims.jti.length < 16 || claims.jti.length > 128) throw new ProofError("bad jti");
  if (expected.accessToken !== undefined ? claims.ath !== sha256b64(expected.accessToken) : claims.ath !== undefined) throw new ProofError("wrong token");
  if (seen(claims.jti)) throw new ProofError("replayed");
  return { jkt: thumbprint({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y }), jti: claims.jti };
}

/** Remembers recent `jti`s for twice the allowed skew, so a captured proof can't be sent again. */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();
  check = (jti: string): boolean => {
    const now = Date.now();
    for (const [k, at] of this.seen) if (now - at > 2 * SKEW_SECONDS * 1000) this.seen.delete(k);
    if (this.seen.has(jti)) return true;
    this.seen.set(jti, now);
    return false;
  };
}
