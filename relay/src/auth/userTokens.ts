import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import type { Deps, RelayConfig } from "../env";
import { RelayError } from "../http";
import { log } from "../log";
import {
  USER_TOKEN_MAX_LIFETIME_SECONDS,
  WEBSITE_CLIENT_IDS,
  type WebsiteClientId,
} from "../protocol";

export interface UserIdentity {
  userId: string;
  clientId: WebsiteClientId;
  sessionId: string;
  token: string;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
/** A token with an unknown kid triggers at most one JWKS refetch per this window. */
const JWKS_REFETCH_COOLDOWN_MS = 30 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;
const CLOCK_TOLERANCE_SECONDS = 30;

interface CachedJwks {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

/** Per-isolate JWKS cache, keyed by URL. */
const jwksCache = new Map<string, CachedJwks>();
const lastFetchAttempt = new Map<string, number>();

export function resetWebsiteJwksCache(): void {
  jwksCache.clear();
  lastFetchAttempt.clear();
}

async function fetchJwks(url: string, deps: Deps): Promise<CachedJwks> {
  lastFetchAttempt.set(url, deps.now());
  const response = await deps.fetch(url, {
    headers: { accept: "application/json" },
    // Workers fetch has no redirect: "error"; a redirect is just a non-200 here.
    redirect: "manual",
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with ${response.status}`);
  }
  const body = (await response.json()) as { keys?: unknown };
  const keys = new Map<string, CryptoKey>();
  for (const candidate of Array.isArray(body.keys) ? body.keys : []) {
    const jwk = candidate as JWK;
    if (typeof jwk.kid !== "string" || jwk.kty !== "EC" || jwk.crv !== "P-256" || "d" in jwk) continue;
    if (jwk.alg !== undefined && jwk.alg !== "ES256") continue;
    if (jwk.use !== undefined && jwk.use !== "sig") continue;
    keys.set(jwk.kid, (await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, "ES256")) as CryptoKey);
  }
  const cached = { keys, fetchedAt: deps.now() };
  jwksCache.set(url, cached);
  return cached;
}

async function websiteKey(kid: string, config: RelayConfig, deps: Deps): Promise<CryptoKey | null> {
  const url = config.websiteJwksUrl;
  const now = deps.now();
  let cached = jwksCache.get(url);
  if (!cached || now - cached.fetchedAt > JWKS_TTL_MS) {
    try {
      cached = await fetchJwks(url, deps);
    } catch (error) {
      log("warn", "website_jwks_fetch_failed", { reason: error instanceof Error ? error.message : "unknown" });
      if (!cached) {
        throw new RelayError("upstream_error", "The website signing keys are unavailable. Retry shortly.");
      }
    }
  }
  const key = cached.keys.get(kid);
  if (key) return key;
  // A rotated key: refetch once per cooldown window, then give up.
  const lastAttempt = lastFetchAttempt.get(url) ?? 0;
  if (now - lastAttempt >= JWKS_REFETCH_COOLDOWN_MS) {
    try {
      return (await fetchJwks(url, deps)).keys.get(kid) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(header.trim());
  return match ? match[1]! : null;
}

export function hasBearerToken(request: Request): boolean {
  return request.headers.has("authorization");
}

/**
 * Verifies a website-issued relay token: ES256 with a known kid, the right
 * issuer and audience, unexpired, at most 10 minutes long, and a client the
 * endpoint allows.
 */
export async function verifyUserToken(
  request: Request,
  config: RelayConfig,
  deps: Deps,
  allowedClients: readonly WebsiteClientId[],
): Promise<UserIdentity> {
  const token = bearerToken(request);
  if (!token) {
    throw new RelayError("invalid_token", "A website relay token is required.");
  }
  let kid: string | undefined;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "ES256") throw new Error("alg");
    kid = header.kid;
  } catch {
    throw new RelayError("invalid_token", "The relay token is malformed.");
  }
  if (!kid) {
    throw new RelayError("invalid_token", "The relay token has no key id.");
  }
  const key = await websiteKey(kid, config, deps);
  if (!key) {
    throw new RelayError("invalid_token", "The relay token was signed with an unknown key.");
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ["ES256"],
      issuer: config.websiteIssuer,
      audience: config.websiteAudience,
      requiredClaims: ["sub", "iat", "exp", "jti", "sid", "client_id"],
      currentDate: new Date(deps.now()),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message =
      code === "ERR_JWT_EXPIRED"
        ? "The relay token has expired."
        : code === "ERR_JWT_CLAIM_VALIDATION_FAILED"
          ? "The relay token has the wrong issuer, audience or claims."
          : "The relay token is invalid.";
    throw new RelayError("invalid_token", message);
  }
  const nowSeconds = Math.floor(deps.now() / 1000);
  const { sub, iat, exp, sid, client_id: clientId } = payload as Record<string, unknown>;
  if (
    typeof sub !== "string" ||
    sub.length === 0 ||
    sub.length > 128 ||
    typeof sid !== "string" ||
    typeof iat !== "number" ||
    typeof exp !== "number"
  ) {
    throw new RelayError("invalid_token", "The relay token has the wrong issuer, audience or claims.");
  }
  if (exp - iat > USER_TOKEN_MAX_LIFETIME_SECONDS || iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
    throw new RelayError("invalid_token", "The relay token lifetime is not allowed.");
  }
  const knownClients = Object.values(WEBSITE_CLIENT_IDS) as string[];
  if (typeof clientId !== "string" || !knownClients.includes(clientId)) {
    throw new RelayError("invalid_token", "The relay token has an unknown client.");
  }
  if (!allowedClients.includes(clientId as WebsiteClientId)) {
    throw new RelayError("client_not_allowed", "This app cannot call this endpoint.");
  }
  return { userId: sub, clientId: clientId as WebsiteClientId, sessionId: sid, token };
}
