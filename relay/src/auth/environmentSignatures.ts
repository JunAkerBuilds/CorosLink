import { compactVerify, decodeProtectedHeader, importJWK } from "jose";
import type { Deps, RelayConfig } from "../env";
import { asObject, readJsonBody, RelayError, requireString } from "../http";
import { timingSafeEqual } from "../crypto";
import {
  ENVIRONMENT_ID_PATTERN,
  ENVIRONMENT_SIGNATURE_HEADER,
  ENVIRONMENT_SIGNATURE_TYP,
  SIGNATURE_MAX_SKEW_SECONDS,
  sha256Base64Url,
  type EnvironmentOperation,
  type EnvironmentPublicJwk,
  type EnvironmentSignaturePayload,
} from "../protocol";
import { consumeOnce } from "./replay";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;
/** Nonces stay recorded past the ±60 s iat window, so a replay is always caught. */
const NONCE_TTL_MS = (SIGNATURE_MAX_SKEW_SECONDS * 2 + 60) * 1000;

export interface SignedEnvironmentRequest<T> {
  environmentId: string;
  kid: string;
  body: Record<string, unknown>;
  /** Whatever resolveKey returned alongside the key, e.g. the link row. */
  context: T;
}

export function hasEnvironmentSignature(request: Request): boolean {
  return request.headers.has(ENVIRONMENT_SIGNATURE_HEADER);
}

/**
 * Reads the body and verifies the environment signature over it:
 * ES256 by the key `resolveKey` returns for (environmentId, kid), the right
 * audience and op, iat within ±60 s, a matching body hash, and a fresh nonce.
 */
export async function verifyEnvironmentRequest<T>(
  request: Request,
  input: {
    config: RelayConfig;
    deps: Deps;
    db: D1Database;
    op: EnvironmentOperation;
    resolveKey: (
      environmentId: string,
      kid: string,
      body: Record<string, unknown>,
    ) => Promise<{ jwk: EnvironmentPublicJwk; context: T } | null>;
  },
): Promise<SignedEnvironmentRequest<T>> {
  const signature = request.headers.get(ENVIRONMENT_SIGNATURE_HEADER)?.trim();
  if (!signature) {
    throw new RelayError("invalid_signature", `The ${ENVIRONMENT_SIGNATURE_HEADER} header is required.`);
  }
  const { raw, value } = await readJsonBody(request);
  const body = asObject(value);
  const environmentId = requireString(body, "environmentId", { pattern: ENVIRONMENT_ID_PATTERN, max: 64 });

  let kid: string;
  try {
    const header = decodeProtectedHeader(signature);
    if (header.alg !== "ES256" || header.typ !== ENVIRONMENT_SIGNATURE_TYP || typeof header.kid !== "string") {
      throw new Error("header");
    }
    kid = header.kid;
  } catch {
    throw new RelayError("invalid_signature", "The environment signature header is malformed.");
  }

  const resolved = await input.resolveKey(environmentId, kid, body);
  if (!resolved) {
    throw new RelayError("environment_not_linked", "This computer is not linked to the relay.");
  }

  let payload: Partial<EnvironmentSignaturePayload>;
  try {
    const key = await importJWK({ ...resolved.jwk }, "ES256");
    const verified = await compactVerify(signature, key, { algorithms: ["ES256"] });
    payload = JSON.parse(new TextDecoder().decode(verified.payload)) as Partial<EnvironmentSignaturePayload>;
  } catch {
    throw new RelayError("invalid_signature", "The environment signature does not verify.");
  }

  if (
    payload.aud !== input.config.origin ||
    payload.op !== input.op ||
    payload.environmentId !== environmentId ||
    typeof payload.nonce !== "string" ||
    !NONCE_PATTERN.test(payload.nonce) ||
    typeof payload.iat !== "number" ||
    typeof payload.bodySha256 !== "string"
  ) {
    throw new RelayError("invalid_signature", "The environment signature is for a different request.");
  }
  const nowSeconds = Math.floor(input.deps.now() / 1000);
  if (Math.abs(nowSeconds - payload.iat) > SIGNATURE_MAX_SKEW_SECONDS) {
    throw new RelayError("signature_stale", "The environment signature is too old or from the future. Check the computer's clock.", {
      details: { serverTime: nowSeconds },
    });
  }
  if (!timingSafeEqual(payload.bodySha256, await sha256Base64Url(raw))) {
    throw new RelayError("invalid_signature", "The environment signature does not cover this body.");
  }
  await consumeOnce(input.db, {
    scope: `env:${environmentId}`,
    value: payload.nonce,
    now: input.deps.now(),
    ttlMs: NONCE_TTL_MS,
  });
  return { environmentId, kid, body, context: resolved.context };
}
