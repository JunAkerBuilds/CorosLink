import { calculateJwkThumbprint, EmbeddedJWK, jwtVerify, type JWK } from "jose";
import type { Deps } from "../env";
import { RelayError } from "../http";
import { timingSafeEqual } from "../crypto";
import { DPOP_HEADER, DPOP_TYP, SIGNATURE_MAX_SKEW_SECONDS, sha256Base64Url } from "../protocol";
import { consumeOnce } from "./replay";

const JTI_PATTERN = /^[A-Za-z0-9_.:-]{16,128}$/u;
const JTI_TTL_MS = (SIGNATURE_MAX_SKEW_SECONDS * 2 + 60) * 1000;

export interface VerifiedDpopProof {
  /** RFC 7638 SHA-256 thumbprint of the proof key. */
  jkt: string;
}

/**
 * Verifies an RFC 9449 DPoP proof: typ dpop+jwt, ES256 by the embedded public
 * P-256 jwk, htm and htu for this request, iat within ±60 s, ath binding the
 * presented access token, and a jti not seen before for this key.
 */
export async function verifyDpopProof(
  request: Request,
  input: { htu: string; accessToken: string; db: D1Database; deps: Deps },
): Promise<VerifiedDpopProof> {
  const proof = request.headers.get(DPOP_HEADER)?.trim();
  if (!proof || proof.includes(",")) {
    throw new RelayError("invalid_signature", "Exactly one DPoP proof is required.");
  }
  let payload: Record<string, unknown>;
  let jwk: JWK;
  try {
    const verified = await jwtVerify(proof, EmbeddedJWK, {
      typ: DPOP_TYP,
      algorithms: ["ES256"],
    });
    payload = verified.payload as Record<string, unknown>;
    jwk = verified.protectedHeader.jwk as JWK;
  } catch {
    throw new RelayError("invalid_signature", "The DPoP proof does not verify.");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || "d" in jwk) {
    throw new RelayError("invalid_signature", "The DPoP key must be a P-256 public key.");
  }
  const nowSeconds = Math.floor(input.deps.now() / 1000);
  if (
    payload.htm !== request.method ||
    typeof payload.htu !== "string" ||
    stripQuery(payload.htu) !== input.htu ||
    typeof payload.jti !== "string" ||
    !JTI_PATTERN.test(payload.jti) ||
    typeof payload.iat !== "number" ||
    typeof payload.ath !== "string"
  ) {
    throw new RelayError("invalid_signature", "The DPoP proof is for a different request.");
  }
  if (Math.abs(nowSeconds - payload.iat) > SIGNATURE_MAX_SKEW_SECONDS) {
    throw new RelayError("signature_stale", "The DPoP proof is too old or from the future.", {
      details: { serverTime: nowSeconds },
    });
  }
  if (!timingSafeEqual(payload.ath, await sha256Base64Url(input.accessToken))) {
    throw new RelayError("invalid_signature", "The DPoP proof is bound to a different token.");
  }
  const jkt = await calculateJwkThumbprint({ kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! }, "sha256");
  await consumeOnce(input.db, {
    scope: `dpop:${jkt}`,
    value: payload.jti,
    now: input.deps.now(),
    ttlMs: JTI_TTL_MS,
  });
  return { jkt };
}

function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}
