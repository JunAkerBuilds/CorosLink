import { SignJWT } from "jose";
import type { RelayConfig } from "./env";
import { importEs256Pkcs8 } from "./crypto";
import { RelayError } from "./http";
import {
  MINT_REQUEST_LIFETIME_SECONDS,
  mintRequestAudience,
  RELAY_MINT_REQUEST_TYP,
  type RelayMintRequestClaims,
} from "./protocol";

interface RelayKeyMaterial {
  pem: string;
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; alg: "ES256"; use: "sig" };
}

let cached: RelayKeyMaterial | null = null;

async function relayKey(config: RelayConfig): Promise<RelayKeyMaterial> {
  const signing = config.signingKey;
  if (!signing) {
    throw new RelayError("not_configured", "The relay signing key is not configured.");
  }
  if (cached && cached.pem === signing.pem && cached.kid === signing.kid) {
    return cached;
  }
  let privateKey: CryptoKey;
  let exported: JsonWebKey;
  try {
    const extractable = await importEs256Pkcs8(signing.pem, true);
    exported = (await crypto.subtle.exportKey("jwk", extractable)) as JsonWebKey;
    privateKey = await importEs256Pkcs8(signing.pem, false);
  } catch {
    throw new RelayError("not_configured", "RELAY_SIGNING_KEY is not a valid ES256 PKCS8 key.");
  }
  cached = {
    pem: signing.pem,
    kid: signing.kid,
    privateKey,
    publicJwk: { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y!, kid: signing.kid, alg: "ES256", use: "sig" },
  };
  return cached;
}

/** The relay's published keys: the current signing key plus any RELAY_EXTRA_JWKS. */
export async function relayJwks(config: RelayConfig): Promise<{ keys: JsonWebKey[] }> {
  const keys: JsonWebKey[] = [(await relayKey(config)).publicJwk];
  if (config.extraJwks) {
    try {
      const extra = JSON.parse(config.extraJwks) as unknown;
      for (const candidate of Array.isArray(extra) ? extra : []) {
        const jwk = candidate as Record<string, unknown>;
        if (jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.kid === "string" && !("d" in jwk)) {
          keys.push({ kty: "EC", crv: "P-256", x: jwk.x as string, y: jwk.y as string, kid: jwk.kid, alg: "ES256", use: "sig" } as JsonWebKey);
        }
      }
    } catch {
      // A malformed extra list never hides the current key.
    }
  }
  return { keys };
}

export async function signMintRequest(
  config: RelayConfig,
  input: { environmentId: string; userId: string; jkt: string; nonce: string; nowSeconds: number },
): Promise<string> {
  const key = await relayKey(config);
  const claims: Omit<RelayMintRequestClaims, "iss" | "aud" | "iat" | "exp"> = {
    environmentId: input.environmentId,
    userId: input.userId,
    jkt: input.jkt,
    nonce: input.nonce,
  };
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "ES256", typ: RELAY_MINT_REQUEST_TYP, kid: key.kid })
    .setIssuer(config.origin)
    .setAudience(mintRequestAudience(input.environmentId))
    .setIssuedAt(input.nowSeconds)
    .setExpirationTime(input.nowSeconds + MINT_REQUEST_LIFETIME_SECONDS)
    .sign(key.privateKey);
}
