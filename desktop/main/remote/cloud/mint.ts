// The mint exchange (CorosLink relay/PROTOCOL.md, "Relay signing key and the mint exchange"): when a signed-in phone
// asks the relay to connect, the relay calls `POST https://<tunnel host>/v1/relay/mint` with `{request: <jwt>}`
// signed by its own key. The computer checks it against the relay keys it pinned at link time, mints a one-time
// credential bound to the phone's key (`jkt`), and answers with a proof signed by the environment key, which the
// relay checks before handing the credential to the phone. The phone then spends it at `POST /v1/auth/bootstrap`.
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { sha256b64 } from "../../phones/dpop";
import type { EnvironmentKey } from "../identity";
import type { RelayKey } from "./relay";

export const MINT_PATH = "/v1/relay/mint";
export const MINT_REQUEST_TYP = "coroslink-relay-mint+jwt";
export const MINT_PROOF_TYP = "coroslink-env-mint+jws";
const REQUEST_LIFETIME_SECONDS = 120;
/** A minted credential lives at most this long. */
export const MINT_CREDENTIAL_MAX_MS = 600_000;
const SKEW_SECONDS = 60;
const JKT = /^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9_-]{16,256}$/;

export interface MintClaims { iss: string; aud: string; environmentId: string; userId: string; jkt: string; nonce: string; iat: number; exp: number }
export interface MintAnswer { credential: string; expiresAt: string; proof: string }

export class MintError extends Error {
  /** `unknownKey`: signed with a key not pinned yet; fetch the relay's keys again and retry once. */
  constructor(readonly code: "invalid" | "unknownKey" | "replayed") { super(`mint request refused: ${code}`); }
}

function decode(jwt: string): { header: Record<string, unknown>; claims: Record<string, unknown>; parts: string[] } {
  const parts = jwt.split(".");
  if (jwt.length > 8192 || parts.length !== 3) throw new MintError("invalid");
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>,
      claims: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>,
      parts,
    };
  } catch {
    throw new MintError("invalid");
  }
}

/** The relay key id a mint request names, so the caller can refresh its pinned keys for one it doesn't know. */
export function mintRequestKid(jwt: unknown): string | null {
  if (typeof jwt !== "string") return null;
  try {
    const kid = decode(jwt).header.kid;
    return typeof kid === "string" ? kid : null;
  } catch {
    return null;
  }
}

export interface VerifyMintOptions {
  environmentId: string;
  /** The website user this computer is linked to; a mint for anyone else is refused. */
  linkedUserId: string;
  /** The relay origin the link was made with: the request's `iss`. */
  issuer: string;
  /** The pinned relay keys. */
  jwks: readonly RelayKey[];
  /** True when the nonce was seen before (and remembers it otherwise). Asked only once everything else checks out. */
  seenNonce: (nonce: string) => boolean;
  now?: number;
}

/** Checks a mint request as PROTOCOL.md says the desktop must, and returns its claims. Throws MintError. */
export function verifyMintRequest(jwt: unknown, options: VerifyMintOptions): MintClaims {
  if (typeof jwt !== "string") throw new MintError("invalid");
  const { header, claims, parts } = decode(jwt);
  if (header.alg !== "ES256" || header.typ !== MINT_REQUEST_TYP || typeof header.kid !== "string") throw new MintError("invalid");
  const jwk = options.jwks.find((key) => key.kid === header.kid);
  if (!jwk) throw new MintError("unknownKey");
  let signed = false;
  try {
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } as JsonWebKey, format: "jwk" });
    signed = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  } catch { /* a malformed key or signature */ }
  if (!signed) throw new MintError("invalid");
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const { iss, aud, environmentId, userId, jkt, nonce, iat, exp } = claims;
  if (iss !== options.issuer || aud !== `coroslink-env:${options.environmentId}` || environmentId !== options.environmentId || userId !== options.linkedUserId
    || typeof iat !== "number" || typeof exp !== "number" || exp <= now - SKEW_SECONDS || iat > now + SKEW_SECONDS || exp - iat > REQUEST_LIFETIME_SECONDS
    || typeof jkt !== "string" || !JKT.test(jkt) || typeof nonce !== "string" || !NONCE.test(nonce)) {
    throw new MintError("invalid");
  }
  if (options.seenNonce(nonce)) throw new MintError("replayed");
  return { iss, aud, environmentId, userId, jkt, nonce, iat, exp };
}

/** The 200 body for a verified request: the credential, when it expires (ms), and the environment's proof. */
export function mintAnswer(claims: MintClaims, credential: string, expiresAt: number, key: EnvironmentKey, now = Date.now()): MintAnswer {
  if (!(expiresAt > now && expiresAt - now <= MINT_CREDENTIAL_MAX_MS)) throw new Error("A minted credential lasts at most 10 minutes.");
  const proof = key.sign({ typ: MINT_PROOF_TYP }, {
    environmentId: claims.environmentId,
    nonce: claims.nonce,
    jkt: claims.jkt,
    credentialSha256: sha256b64(credential),
    exp: Math.floor(expiresAt / 1000),
    iat: Math.floor(now / 1000),
  });
  return { credential, expiresAt: new Date(expiresAt).toISOString(), proof };
}
