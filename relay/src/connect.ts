import { compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { isManagedHostname, requireTunnelConfig, type RelayContext } from "./allocations";
import { randomBase64Url, timingSafeEqual } from "./crypto";
import { getActiveLink, getAllocation, type LinkRow } from "./db";
import { readBounded, RelayError } from "./http";
import { log } from "./log";
import {
  ENVIRONMENT_MINT_RESPONSE_TYP,
  httpBaseUrlForHostname,
  MINT_CREDENTIAL_MAX_LIFETIME_SECONDS,
  MINT_PATH,
  MINT_TIMEOUT_MS,
  sha256Base64Url,
  SIGNATURE_MAX_SKEW_SECONDS,
  type ConnectResponse,
  type EnvironmentMintResponseProof,
  type EnvironmentPublicJwk,
  type MintHttpRequest,
} from "./protocol";
import { signMintRequest } from "./relayKey";

const MAX_MINT_RESPONSE_BYTES = 64 * 1024;
const MAX_CREDENTIAL_LENGTH = 4096;

function invalidResponse(): RelayError {
  return new RelayError("environment_response_invalid", "The computer's answer could not be verified.");
}

/**
 * Asks the linked desktop to mint a one-time credential bound to the phone's
 * DPoP key, and verifies the desktop's signed answer before handing it over.
 * The credential is never logged or stored.
 */
export async function brokerConnect(
  ctx: RelayContext,
  input: { userId: string; environmentId: string; jkt: string },
): Promise<ConnectResponse> {
  const tunnelConfig = requireTunnelConfig(ctx.config);
  const link = await getActiveLink(ctx.db, input);
  if (!link) {
    throw new RelayError("environment_not_linked", "This computer is not linked to your account.");
  }
  const allocation = await getAllocation(ctx.db, { ...input, kid: link.env_key_jkt });
  if (!allocation || allocation.status !== "ready" || !allocation.tunnel_id) {
    throw new RelayError("environment_not_ready", "This computer's remote access is not ready yet.");
  }
  // The relay only ever calls hostnames it derived itself, never one a caller supplied.
  if (!isManagedHostname(allocation.hostname, tunnelConfig.zoneName, ctx.config.stage)) {
    throw new RelayError("environment_not_ready", "This computer's remote address is not valid.");
  }

  const nowSeconds = Math.floor(ctx.deps.now() / 1000);
  const nonce = randomBase64Url(32);
  const request: MintHttpRequest = {
    request: await signMintRequest(ctx.config, {
      environmentId: input.environmentId,
      userId: input.userId,
      jkt: input.jkt,
      nonce,
      nowSeconds,
    }),
  };

  const url = `${httpBaseUrlForHostname(allocation.hostname)}${MINT_PATH}`;
  let response: Response;
  try {
    response = await ctx.deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      redirect: "manual",
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
  } catch (error) {
    log("warn", "mint_unreachable", {
      environmentId: input.environmentId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw new RelayError("environment_unreachable", "The computer did not answer. Is it awake and online?");
  }

  if (response.status >= 300 && response.status < 400) {
    log("warn", "mint_redirect_refused", { environmentId: input.environmentId, status: response.status });
    throw new RelayError("environment_redirect_refused", "The computer's address redirected; the relay does not follow redirects.");
  }
  if (!response.ok) {
    log("warn", "mint_refused", { environmentId: input.environmentId, status: response.status });
    throw response.status >= 500
      ? new RelayError("environment_unreachable", "The computer did not answer. Is it awake and online?", {
          details: { environmentStatus: response.status },
        })
      : new RelayError("environment_refused", "The computer refused to issue a credential.", {
          details: { environmentStatus: response.status },
        });
  }

  const raw = await readBounded(response.body, MAX_MINT_RESPONSE_BYTES);
  if (raw === null) throw invalidResponse();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  } catch {
    throw invalidResponse();
  }
  const { credential, expiresAt, proof } = body;
  if (
    typeof credential !== "string" ||
    credential.length === 0 ||
    credential.length > MAX_CREDENTIAL_LENGTH ||
    typeof expiresAt !== "string" ||
    typeof proof !== "string"
  ) {
    throw invalidResponse();
  }
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = ctx.deps.now();
  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= nowMs ||
    expiresAtMs > nowMs + (MINT_CREDENTIAL_MAX_LIFETIME_SECONDS + SIGNATURE_MAX_SKEW_SECONDS) * 1000
  ) {
    throw invalidResponse();
  }

  const verified = await verifyMintProof({
    link,
    proof,
    nonce,
    jkt: input.jkt,
    credentialSha256: await sha256Base64Url(credential),
    exp: Math.floor(expiresAtMs / 1000),
    nowSeconds: Math.floor(nowMs / 1000),
  });
  if (!verified) {
    log("warn", "mint_response_invalid", { environmentId: input.environmentId });
    throw invalidResponse();
  }
  // An unlink or re-key while the desktop was minting wins: hand nothing over.
  const still = await getActiveLink(ctx.db, input);
  if (!still || still.env_key_jkt !== link.env_key_jkt) {
    throw new RelayError("environment_not_linked", "This computer was unlinked while connecting.");
  }
  log("info", "connect_brokered", { environmentId: input.environmentId });
  return {
    environmentId: input.environmentId,
    keyThumbprint: link.env_key_jkt,
    hostname: allocation.hostname,
    httpBaseUrl: httpBaseUrlForHostname(allocation.hostname),
    credential,
    expiresAt,
  };
}

async function verifyMintProof(input: {
  link: LinkRow;
  proof: string;
  nonce: string;
  jkt: string;
  credentialSha256: string;
  exp: number;
  nowSeconds: number;
}): Promise<boolean> {
  try {
    const header = decodeProtectedHeader(input.proof);
    if (header.alg !== "ES256" || header.typ !== ENVIRONMENT_MINT_RESPONSE_TYP) return false;
    const jwk = JSON.parse(input.link.env_public_jwk) as EnvironmentPublicJwk;
    const key = await importJWK({ ...jwk }, "ES256");
    const { payload } = await compactVerify(input.proof, key, { algorithms: ["ES256"] });
    const claims = JSON.parse(new TextDecoder().decode(payload)) as Partial<EnvironmentMintResponseProof>;
    return (
      claims.environmentId === input.link.environment_id &&
      typeof claims.nonce === "string" &&
      timingSafeEqual(claims.nonce, input.nonce) &&
      claims.jkt === input.jkt &&
      typeof claims.credentialSha256 === "string" &&
      timingSafeEqual(claims.credentialSha256, input.credentialSha256) &&
      claims.exp === input.exp &&
      typeof claims.iat === "number" &&
      Math.abs(input.nowSeconds - claims.iat) <= SIGNATURE_MAX_SKEW_SECONDS
    );
  } catch {
    return false;
  }
}
