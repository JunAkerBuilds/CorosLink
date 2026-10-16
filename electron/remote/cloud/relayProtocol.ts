// The parts of the relay's wire contract the desktop uses: environment request
// signatures, link, recovery, unlink, activity and the relay's JWKS. Copied
// from relay/src/protocol.ts (relay protocol version 1, written on
// claude/coach-relay-c1e389) the way P2 copied the mint types into
// ../contract.ts. Keep the two in step; relay/PROTOCOL.md explains them.
//
// One difference from the plan: there is no `GET /v1/nonce`. The desktop picks
// a fresh nonce for every call and the relay remembers it for three minutes.

export const RELAY_PROTOCOL_VERSION = 1;

// ----- Environment request signatures -----

/** Header that carries the environment's compact JWS on desktop calls. */
export const ENVIRONMENT_SIGNATURE_HEADER = "CorosLink-Environment-Signature";
/** `typ` of the environment request JWS protected header. */
export const ENVIRONMENT_SIGNATURE_TYP = "coroslink-env-request+jws";
/** `iat` must be within this many seconds of the relay's clock. */
export const SIGNATURE_MAX_SKEW_SECONDS = 60;
/** The relay accepts 22-128 base64url characters; 32 bytes is 43. */
export const ENVIRONMENT_NONCE_BYTES = 32;

export const ENVIRONMENT_OPERATIONS = [
  "environment.link",
  "environment.recovery",
  "environment.unlink",
  "environment.activity"
] as const;
export type EnvironmentOperation = (typeof ENVIRONMENT_OPERATIONS)[number];

/**
 * Payload of the environment request JWS. Protected header:
 * `{alg: "ES256", typ: ENVIRONMENT_SIGNATURE_TYP, kid: <RFC 7638 thumbprint>}`.
 */
export interface EnvironmentSignaturePayload {
  /** The relay origin, e.g. "https://relay.coroslink.com". */
  aud: string;
  environmentId: string;
  op: EnvironmentOperation;
  nonce: string;
  iat: number;
  /** base64url(SHA-256(raw request body bytes)). */
  bodySha256: string;
}

// ----- Endpoints -----

export const RELAY_ROUTES = {
  link: "/v1/environments/link",
  recovery: "/v1/environments/recovery",
  unlink: "/v1/environments/unlink",
  activity: "/v1/activity",
  jwks: "/.well-known/jwks.json"
} as const;

export const ENVIRONMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
export type EnvironmentPlatform = "darwin" | "win32" | "linux";
export const ENVIRONMENT_PLATFORMS: readonly EnvironmentPlatform[] = ["darwin", "win32", "linux"];
export const RECOVERY_MIN_INTERVAL_SECONDS = 120;

/**
 * Tunnel hostnames are always one label under the tunnel zone
 * (`<16 hex>` in production, `dev-<16 hex>` on relay-dev), which is all
 * C-LINK accepts as a cloud host.
 */
export const TUNNEL_ZONE_NAME = "coroslinkrelay.com";
export const TUNNEL_HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.coroslinkrelay\.com$/;

export interface EnvironmentPublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/** `POST /v1/environments/link`: Bearer website JWT (coroslink-desktop) + signature (op link). */
export interface LinkRequest {
  environmentId: string;
  publicJwk: EnvironmentPublicJwk;
  /** 1-64 characters, shown on the phone. */
  label: string;
  platform: EnvironmentPlatform;
  /** Loopback port of the environment server. */
  port: number;
}

export interface LinkResponse {
  environmentId: string;
  userId: string;
  hostname: string;
  httpBaseUrl: string;
  tunnelId: string;
  /** cloudflared connector token. Secret: kept with safeStorage, never logged. */
  connectorToken: string;
  generation: number;
  keyThumbprint: string;
}

/** `POST /v1/environments/recovery`: signature (op recovery). At startup, after linking, and when the connector fails. */
export interface RecoveryRequest {
  environmentId: string;
  tunnelId: string | null;
  port: number;
}

export interface RecoveryResponse {
  environmentId: string;
  hostname: string;
  httpBaseUrl: string;
  tunnelId: string;
  generation: number;
  action: "unchanged" | "reconfigured" | "reprovisioned";
  /** Present when the request's tunnelId is not the allocation's tunnel. */
  connectorToken?: string;
}

/** `POST /v1/environments/unlink`: signature (op unlink). */
export interface UnlinkRequest {
  environmentId: string;
}

export interface UnlinkResponse {
  environmentId: string;
  unlinked: true;
  teardown: "complete" | "pending";
}

export const ACTIVITY_EVENTS = ["replied", "approval"] as const;
export type ActivityEvent = (typeof ACTIVITY_EVENTS)[number];

/** `POST /v1/activity`: signature (op activity). Never carries message text. */
export interface ActivityRequest {
  environmentId: string;
  sessionId: string;
  event: ActivityEvent;
}

export interface ActivityResponse {
  sent: number;
  failed: number;
  removed: number;
}

/** A key in `GET /.well-known/jwks.json`. */
export interface RelayPublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
  alg?: string;
  use?: string;
}

export interface RelayJwks {
  keys: RelayPublicJwk[];
}

/** Every non-2xx body is `{error: {code, message, details?}}`; codes as in relay ERROR_CODES. */
export interface RelayErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string | number | boolean>;
  };
}
