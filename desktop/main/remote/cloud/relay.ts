// The desktop side of relay.coroslink.com (CorosLink relay/PROTOCOL.md, version 1): link, recovery and unlink, each
// signed with the environment key in the `CorosLink-Environment-Signature` header, and the relay's own signing keys
// (its JWKS), which mint requests are checked against. Link also carries the athlete's 10-minute website token.
// Connector tokens come back in link and recovery answers; nothing here logs or keeps them.
import { randomBytes } from "node:crypto";
import { t } from "@/lib/i18n";
import { sha256b64 } from "../../phones/dpop";
import type { EnvironmentKey } from "../identity";

export const RELAY_URL = "https://relay.coroslink.com";
export const DEV_RELAY_URL = "https://relay-dev.coroslink.com";
export const SIGNATURE_HEADER = "CorosLink-Environment-Signature";
export const RECOVERY_MIN_INTERVAL_MS = 120_000;
/** One label under the tunnel zone: `<16 hex>` in production, `dev-<16 hex>` on relay-dev. */
export const TUNNEL_HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.coroslinkrelay\.com$/;
export type Platform = "darwin" | "win32" | "linux";
export type Operation = "environment.link" | "environment.recovery" | "environment.unlink";

const MAX_ANSWER = 64 * 1024;
const TIMEOUT_MS = 20_000;
const COORD = /^[A-Za-z0-9_-]{43}$/;

/** The relay: production, or COROSLINK_RELAY_URL in an unpackaged build (relay-dev, or a stub on loopback). */
export function relayOrigin(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.COROSLINK_RELAY_URL?.trim();
  if (!override || isPackaged) return RELAY_URL;
  const url = new URL(override);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("COROSLINK_RELAY_URL must use https (or http on this computer).");
  return url.origin;
}

/** A key from the relay's `/.well-known/jwks.json`. */
export interface RelayKey { kty: "EC"; crv: "P-256"; x: string; y: string; kid: string; alg: "ES256" }

/** The ES256 signing keys of a JWKS answer; anything else (a private key too) is dropped. */
export function relayKeys(value: unknown): RelayKey[] {
  const keys = (value as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return [];
  return keys.filter((k): k is RelayKey & { use?: string } => Boolean(k) && k.kty === "EC" && k.crv === "P-256" && !("d" in k)
    && typeof k.kid === "string" && k.kid.length > 0 && k.kid.length <= 128 && COORD.test(k.x) && COORD.test(k.y)
    && (k.alg === undefined || k.alg === "ES256") && (k.use === undefined || k.use === "sig"))
    .slice(0, 10)
    .map((k) => ({ kty: "EC", crv: "P-256", x: k.x, y: k.y, kid: k.kid, alg: "ES256" }));
}

export class RelayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSeconds?: number, readonly details?: Record<string, unknown>) {
    super(message);
  }
  /** The relay has no active link for this key: this computer is unlinked. */
  get notLinked(): boolean { return this.code === "environment_not_linked"; }
}

export interface Allocation { hostname: string; tunnelId: string; generation: number; connectorToken?: string }
export interface LinkAnswer extends Allocation { userId: string; connectorToken: string }
export interface RecoveryAnswer extends Allocation { action: "unchanged" | "reconfigured" | "reprovisioned" }

export interface RelayClientOptions {
  origin: string;
  key: EnvironmentKey;
  environmentId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const bad = (what: string) => new RelayError(502, "invalid_response", t("The relay's answer is missing {what}.", { what }));

export class RelayClient {
  readonly origin: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  /** Relay clock minus this one, learned from a `signature_stale` answer. */
  private offsetMs = 0;

  constructor(private readonly options: RelayClientOptions) {
    this.origin = new URL(options.origin).origin;
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
  }

  /** The signature for one call: a fresh nonce, `iat` now, and the hash of exactly `body`. */
  signature(op: Operation, body: string): string {
    return this.options.key.sign({ typ: "coroslink-env-request+jws" }, {
      aud: this.origin,
      environmentId: this.options.environmentId,
      op,
      nonce: randomBytes(32).toString("base64url"),
      iat: Math.floor((this.now() + this.offsetMs) / 1000),
      bodySha256: sha256b64(body),
    });
  }

  /** Links this computer to the account `relayToken` belongs to; idempotent, and how a new port or label is set. */
  async link(input: { relayToken: string; label: string; platform: Platform; port: number }): Promise<LinkAnswer> {
    const answer = await this.call("/v1/environments/link", "environment.link", {
      environmentId: this.options.environmentId,
      publicJwk: this.options.key.publicJwk,
      label: input.label,
      platform: input.platform,
      port: input.port,
    }, { Authorization: `Bearer ${input.relayToken}` });
    if (typeof answer.userId !== "string" || !answer.userId || answer.userId.length > 128) throw bad(t("the account"));
    if (typeof answer.connectorToken !== "string") throw bad(t("the connector token"));
    if (answer.keyThumbprint !== this.options.key.thumbprint) throw new RelayError(502, "invalid_response", t("The relay linked a different key."));
    return { ...this.allocation(answer), userId: answer.userId, connectorToken: answer.connectorToken };
  }

  /** Registers recovery and repairs the tunnel; `connectorToken` comes back when the tunnel isn't `tunnelId`. */
  async recovery(input: { tunnelId: string | null; port: number }): Promise<RecoveryAnswer> {
    const answer = await this.call("/v1/environments/recovery", "environment.recovery", { environmentId: this.options.environmentId, tunnelId: input.tunnelId, port: input.port });
    if (answer.action !== "unchanged" && answer.action !== "reconfigured" && answer.action !== "reprovisioned") throw bad(t("the action"));
    return { ...this.allocation(answer), action: answer.action };
  }

  async unlink(): Promise<{ teardown: "complete" | "pending" }> {
    const answer = await this.call("/v1/environments/unlink", "environment.unlink", { environmentId: this.options.environmentId });
    if (answer.unlinked !== true) throw new RelayError(502, "invalid_response", t("The relay didn't confirm the unlink."));
    return { teardown: answer.teardown === "pending" ? "pending" : "complete" };
  }

  /** The keys the relay signs mint requests with. */
  async jwks(): Promise<RelayKey[]> {
    const keys = relayKeys(await this.send("/.well-known/jwks.json", { method: "GET" }));
    if (!keys.length) throw new RelayError(502, "invalid_response", t("The relay published no signing keys."));
    return keys;
  }

  private allocation(answer: Record<string, unknown>): Allocation {
    if (answer.environmentId !== this.options.environmentId) throw new RelayError(502, "invalid_response", t("The relay answered for another computer."));
    const hostname = typeof answer.hostname === "string" ? answer.hostname.toLowerCase() : "";
    if (!TUNNEL_HOSTNAME.test(hostname)) throw new RelayError(502, "invalid_response", t("The relay gave an address C-LINK won't use."));
    if (typeof answer.tunnelId !== "string" || !answer.tunnelId || answer.tunnelId.length > 128) throw bad(t("the tunnel"));
    if (answer.connectorToken !== undefined && (typeof answer.connectorToken !== "string" || !answer.connectorToken || answer.connectorToken.length > 8192)) throw bad(t("the connector token"));
    return {
      hostname,
      tunnelId: answer.tunnelId,
      generation: typeof answer.generation === "number" ? answer.generation : 0,
      ...(typeof answer.connectorToken === "string" ? { connectorToken: answer.connectorToken } : {}),
    };
  }

  /** A signed POST. A clock the relay calls stale is corrected from its time and the call sent once more. */
  private async call(route: string, op: Operation, body: object, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const text = JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      try {
        const answer = await this.send(route, { method: "POST", body: text, headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: this.signature(op, text), ...headers } });
        if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new RelayError(502, "invalid_response", t("The relay's answer is unreadable."));
        return answer as Record<string, unknown>;
      } catch (error) {
        const serverTime = error instanceof RelayError ? error.details?.serverTime : undefined;
        if (attempt === 0 && error instanceof RelayError && error.code === "signature_stale" && typeof serverTime === "number") {
          this.offsetMs = serverTime * 1000 - this.now();
          continue;
        }
        throw error;
      }
    }
  }

  private async send(route: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      // A redirect would carry the signature somewhere else.
      response = await this.fetch(`${this.origin}${route}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new RelayError(0, "unreachable", (error as Error)?.name === "TimeoutError" ? t("The relay didn't answer in time.") : t("Couldn't reach the relay. Check your internet connection."));
    }
    const tooLarge = () => new RelayError(502, "invalid_response", t("The relay's answer is too large."));
    if (Number(response.headers.get("content-length") ?? 0) > MAX_ANSWER) {
      await response.body?.cancel().catch(() => {});
      throw tooLarge();
    }
    const text = await response.text().catch(() => "");
    if (text.length > MAX_ANSWER) throw tooLarge();
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (response.status >= 300 && response.status < 400) throw new RelayError(response.status, "redirect_refused", t("The relay answered with a redirect."));
    if (!response.ok) {
      const error = (json as { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined)?.error;
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new RelayError(
        response.status,
        typeof error?.code === "string" ? error.code : "http_error",
        typeof error?.message === "string" && error.message ? error.message.slice(0, 300) : t("The relay answered {status}.", { status: response.status }),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        error?.details && typeof error.details === "object" ? error.details as Record<string, unknown> : undefined,
      );
    }
    return json;
  }
}
