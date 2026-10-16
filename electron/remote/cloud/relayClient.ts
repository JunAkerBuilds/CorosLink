import crypto from "node:crypto";
import { loadJose } from "../auth";
import type { RemoteIdentity } from "../identity";
import {
  ENVIRONMENT_NONCE_BYTES,
  ENVIRONMENT_SIGNATURE_HEADER,
  ENVIRONMENT_SIGNATURE_TYP,
  RELAY_ROUTES,
  SESSION_ID_PATTERN,
  TUNNEL_HOSTNAME_PATTERN,
  type ActivityEvent,
  type ActivityRequest,
  type ActivityResponse,
  type EnvironmentOperation,
  type EnvironmentPlatform,
  type EnvironmentSignaturePayload,
  type LinkRequest,
  type LinkResponse,
  type RecoveryRequest,
  type RecoveryResponse,
  type RelayErrorBody,
  type RelayJwks,
  type RelayPublicJwk,
  type UnlinkResponse
} from "./relayProtocol";

/**
 * The desktop side of relay.coroslink.com: every call is signed with this
 * computer's environment key in the relay's format (relayProtocol.ts), and
 * link also carries the user's 10-minute website relay token. Connector tokens
 * come back in link and recovery answers; this class never logs or keeps them.
 */

export const PRODUCTION_RELAY_URL = "https://relay.coroslink.com";
export const DEV_RELAY_URL = "https://relay-dev.coroslink.com";
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The relay to use: production, or COROSLINK_RELAY_URL in an unpackaged
 * build (relay-dev, or a local stub on loopback).
 */
export function relayBaseUrl(input: { isPackaged: boolean; override?: string | undefined }): string {
  const override = input.override?.trim();
  if (!override || input.isPackaged) return PRODUCTION_RELAY_URL;
  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error("COROSLINK_RELAY_URL isn't a valid URL.");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("COROSLINK_RELAY_URL must use https (or http on this computer).");
  }
  return parsed.origin;
}

export class RelayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly details?: Record<string, string | number | boolean>
  ) {
    super(message);
    this.name = "RelayRequestError";
  }

  /** The relay has no active link for this key: treat this computer as unlinked. */
  get notLinked(): boolean {
    return this.code === "environment_not_linked";
  }
}

export interface RelayClientOptions {
  baseUrl: string;
  identity: RemoteIdentity;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function sha256Base64Url(bytes: string): string {
  return crypto.createHash("sha256").update(bytes, "utf8").digest("base64url");
}

function isPublicKey(value: unknown): value is RelayPublicJwk {
  const jwk = value as Partial<RelayPublicJwk> | null;
  return Boolean(
    jwk &&
      jwk.kty === "EC" &&
      jwk.crv === "P-256" &&
      typeof jwk.kid === "string" &&
      jwk.kid.length > 0 &&
      jwk.kid.length <= 128 &&
      typeof jwk.x === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(jwk.x) &&
      typeof jwk.y === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(jwk.y) &&
      !("d" in (jwk as object)) &&
      (jwk.alg === undefined || jwk.alg === "ES256") &&
      (jwk.use === undefined || jwk.use === "sig")
  );
}

/** The ES256 signing keys of a relay JWKS answer; anything else is dropped. */
export function relaySigningKeys(value: unknown): RelayPublicJwk[] {
  const keys = (value as Partial<RelayJwks> | null)?.keys;
  if (!Array.isArray(keys)) return [];
  return keys
    .filter(isPublicKey)
    .slice(0, 10)
    .map((key) => ({ kty: "EC", crv: "P-256", x: key.x, y: key.y, kid: key.kid, alg: "ES256" }));
}

function requireString(value: unknown, name: string, max = 4096): string {
  if (typeof value !== "string" || !value || value.length > max) {
    throw new RelayRequestError(502, "invalid_response", `The relay's answer is missing ${name}.`);
  }
  return value;
}

export class RelayClient {
  readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  /** relay clock − this clock, learned from a `signature_stale` answer. */
  private clockOffsetMs = 0;

  constructor(private readonly options: RelayClientOptions) {
    this.origin = new URL(options.baseUrl).origin;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get identity(): RemoteIdentity {
    return this.options.identity;
  }

  /** The compact JWS for one call: a fresh nonce, `iat` now, and the hash of exactly `body`. */
  async signRequest(op: EnvironmentOperation, body: string): Promise<string> {
    const jose = await loadJose();
    const payload: EnvironmentSignaturePayload = {
      aud: this.origin,
      environmentId: this.identity.environmentId,
      op,
      nonce: crypto.randomBytes(ENVIRONMENT_NONCE_BYTES).toString("base64url"),
      iat: Math.floor((this.now() + this.clockOffsetMs) / 1000),
      bodySha256: sha256Base64Url(body)
    };
    const key = await jose.importJWK({ ...this.identity.privateJwk }, "ES256");
    return new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: "ES256", typ: ENVIRONMENT_SIGNATURE_TYP, kid: this.identity.kid })
      .sign(key);
  }

  /** Links this computer to the account the relay token belongs to. */
  async link(input: { relayToken: string; label: string; platform: EnvironmentPlatform; port: number }): Promise<LinkResponse> {
    const body: LinkRequest = {
      environmentId: this.identity.environmentId,
      publicJwk: { ...this.identity.publicJwk },
      label: input.label.slice(0, 64) || "CorosLink",
      platform: input.platform,
      port: input.port
    };
    const answer = await this.call(RELAY_ROUTES.link, "environment.link", body, { Authorization: `Bearer ${input.relayToken}` });
    return this.checkAllocation(answer, true) as unknown as LinkResponse;
  }

  /** Registers recovery and repairs the tunnel; `connectorToken` comes back when the tunnel changed. */
  async recovery(input: { tunnelId: string | null; port: number }): Promise<RecoveryResponse> {
    const body: RecoveryRequest = { environmentId: this.identity.environmentId, tunnelId: input.tunnelId, port: input.port };
    const answer = await this.call(RELAY_ROUTES.recovery, "environment.recovery", body);
    const checked = this.checkAllocation(answer, false) as unknown as RecoveryResponse;
    if (!["unchanged", "reconfigured", "reprovisioned"].includes(checked.action)) {
      throw new RelayRequestError(502, "invalid_response", "The relay's recovery answer is unreadable.");
    }
    return checked;
  }

  async unlink(): Promise<UnlinkResponse> {
    const answer = (await this.call(RELAY_ROUTES.unlink, "environment.unlink", {
      environmentId: this.identity.environmentId
    })) as Partial<UnlinkResponse>;
    if (answer.unlinked !== true) throw new RelayRequestError(502, "invalid_response", "The relay didn't confirm the unlink.");
    return answer as UnlinkResponse;
  }

  /** A text-free push: which conversation, and whether Coach replied or needs approval. */
  async activity(input: { sessionId: string; event: ActivityEvent }): Promise<ActivityResponse> {
    if (!SESSION_ID_PATTERN.test(input.sessionId)) throw new Error("That conversation id can't be sent to the relay.");
    const body: ActivityRequest = { environmentId: this.identity.environmentId, sessionId: input.sessionId, event: input.event };
    return (await this.call(RELAY_ROUTES.activity, "environment.activity", body)) as unknown as ActivityResponse;
  }

  /** The relay's mint-request signing keys. */
  async jwks(): Promise<RelayPublicJwk[]> {
    const response = await this.send(RELAY_ROUTES.jwks, { method: "GET" });
    const keys = relaySigningKeys(response.json);
    if (!keys.length) throw new RelayRequestError(502, "invalid_response", "The relay published no signing keys.");
    return keys;
  }

  private checkAllocation(answer: Record<string, unknown>, link: boolean): Record<string, unknown> {
    if (answer.environmentId !== this.identity.environmentId) {
      throw new RelayRequestError(502, "invalid_response", "The relay answered for another computer.");
    }
    const hostname = requireString(answer.hostname, "the hostname", 253).toLowerCase();
    if (!TUNNEL_HOSTNAME_PATTERN.test(hostname)) {
      throw new RelayRequestError(502, "invalid_response", "The relay gave an address C-LINK wouldn't accept.");
    }
    requireString(answer.tunnelId, "the tunnel");
    if (link) {
      requireString(answer.userId, "the account", 128);
      requireString(answer.connectorToken, "the connector token", 8192);
      if (answer.keyThumbprint !== this.identity.kid) {
        throw new RelayRequestError(502, "invalid_response", "The relay linked a different key.");
      }
    } else if (answer.connectorToken !== undefined) {
      requireString(answer.connectorToken, "the connector token", 8192);
    }
    return { ...answer, hostname, httpBaseUrl: `https://${hostname}` };
  }

  /** A signed POST. A stale clock is corrected from the relay's time and retried once. */
  private async call(
    path: string,
    op: EnvironmentOperation,
    body: object,
    headers: Record<string, string> = {}
  ): Promise<Record<string, unknown>> {
    const text = JSON.stringify(body);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.send(path, {
          method: "POST",
          body: text,
          headers: {
            "Content-Type": "application/json",
            [ENVIRONMENT_SIGNATURE_HEADER]: await this.signRequest(op, text),
            ...headers
          }
        });
        const json = response.json;
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          throw new RelayRequestError(502, "invalid_response", "The relay's answer is unreadable.");
        }
        return json as Record<string, unknown>;
      } catch (error) {
        const serverTime = error instanceof RelayRequestError ? error.details?.serverTime : undefined;
        if (attempt === 0 && error instanceof RelayRequestError && error.code === "signature_stale" && typeof serverTime === "number") {
          this.clockOffsetMs = serverTime * 1000 - this.now();
          continue;
        }
        throw error;
      }
    }
  }

  private async send(path: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}${path}`, {
        ...init,
        // A redirect would carry the signature somewhere else.
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const timedOut = (error as Error)?.name === "TimeoutError";
      throw new RelayRequestError(
        0,
        "unreachable",
        timedOut ? "CorosLink's relay didn't answer in time." : "Couldn't reach CorosLink's relay. Check your internet connection."
      );
    }
    const text = await readLimited(response);
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new RelayRequestError(response.status, "redirect_refused", "CorosLink's relay answered with a redirect.");
    }
    if (!response.ok) {
      const error = (json as Partial<RelayErrorBody> | undefined)?.error;
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new RelayRequestError(
        response.status,
        typeof error?.code === "string" ? error.code : "http_error",
        typeof error?.message === "string" && error.message
          ? error.message.slice(0, 300)
          : `CorosLink's relay answered ${response.status}.`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        error?.details && typeof error.details === "object" ? error.details : undefined
      );
    }
    return { status: response.status, json };
  }
}

async function readLimited(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new RelayRequestError(502, "invalid_response", "The relay's answer is too large.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RelayRequestError(502, "invalid_response", "The relay's answer is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
