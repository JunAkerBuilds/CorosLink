// Remote Coach, protocol 1: everything that crosses the environment server's
// boundary (electron/remote/server.ts). The Coach event and snapshot types
// live in ../coachHub/coachContract and are re-exported here, so this file is
// the one TypeScript source of truth. C-LINK's mirror is
// CorosKit/Sources/CorosKit/Coach/CoachContract.swift; both sides test against
// scripts/fixtures/coach-contract.json.
//
// No runtime imports: the renderer loads the status types and the link
// encoder from here too.
//
// HTTP (JSON bodies; every error is {"error": {"code", "message"}}):
//
//   GET    /v1/descriptor        public: who answers on this route
//   POST   /v1/auth/pair         DPoP proof + {secret, label}   -> EnvironmentGrant
//   POST   /v1/auth/bootstrap    DPoP proof + {credential}      -> EnvironmentGrant
//   POST   /v1/auth/ws-ticket    DPoP-bound session             -> WebSocketTicket
//   DELETE /v1/auth/session      DPoP-bound session             ends the caller's session
//   GET    /v1/auth/sessions     access:write                   -> {sessions: RemoteDevice[]}
//   DELETE /v1/auth/sessions/:id access:write                   revokes one session
//   POST   /v1/relay/mint        relay-signed request           -> MintHttpResponse
//   POST   /v1/coach/attachments coach:operate + RemoteFileUpload -> {attachment: ChatFileAttachment}
//   GET    /v1/ws?ticket=…       WebSocket: CoachRpcRequest in, CoachRpcResponse and events out
//
// A DPoP-bound request carries `Authorization: DPoP <sessionToken>` and a
// `DPoP` proof whose `ath` is the token's hash. A bearer token is never
// accepted.
import { COACH_PROTOCOL_VERSION, type CoachErrorBody, type CoachPermission } from "../coachHub/coachContract";

export * from "../coachHub/coachContract";

export const REMOTE_PROTOCOL_VERSION = COACH_PROTOCOL_VERSION;
export const REMOTE_CAPABILITIES = ["coach"] as const;
/** Listed too when this computer keeps files a phone attaches (`REMOTE_ROUTES.attachments`). */
export const REMOTE_FILES_CAPABILITY = "coach.files";
/** `coach.confirm` honours a phone's `options.destination` and `options.scheduleDate` for a one-off workout draft. */
export const REMOTE_PLAN_OPTIONS_CAPABILITY = "coach.planOptions";

export const REMOTE_ROUTES = {
  descriptor: "/v1/descriptor",
  pair: "/v1/auth/pair",
  bootstrap: "/v1/auth/bootstrap",
  wsTicket: "/v1/auth/ws-ticket",
  session: "/v1/auth/session",
  sessions: "/v1/auth/sessions",
  mint: "/v1/relay/mint",
  attachments: "/v1/coach/attachments",
  ws: "/v1/ws"
} as const;

// ----- Lifetimes -----

/** A pairing code's secret works once, for this long. */
export const PAIRING_SECRET_TTL_MS = 10 * 60_000;
/** A relay-brokered bootstrap credential works once, for this long. */
export const BOOTSTRAP_CREDENTIAL_TTL_MS = 2 * 60_000;
/** A WebSocket ticket works once, for this long. */
export const WS_TICKET_TTL_MS = 30_000;
/** A device's session ends after this long unused; every use extends it. */
export const SESSION_IDLE_TTL_MS = 90 * 24 * 60 * 60_000;
/** A DPoP proof's `iat` may be this far from the computer's clock. */
export const DPOP_MAX_SKEW_SECONDS = 60;
/** Request bodies and WebSocket frames from clients. */
export const MAX_REMOTE_BODY_BYTES = 64 * 1024;
/** An attachment upload: one file as base64, so a 32 MB original fits with its page images. */
export const MAX_REMOTE_UPLOAD_BYTES = 56 * 1024 * 1024;

// ----- Descriptor, grants and tickets -----

/** What a route answers before any credential is sent. */
export interface EnvironmentDescriptor {
  environmentId: string;
  name: string;
  /** `darwin`, `win32` or `linux`, as Node reports it. */
  platform: string;
  appVersion: string;
  protocol: number;
  capabilities: string[];
  /**
   * RFC 7638 SHA-256 thumbprint of the environment's public P-256 key: the
   * relay's `keyThumbprint` in GET /v1/environments and ConnectResponse.
   * C-LINK pins it when pairing on the LAN and refuses a relay connect signed
   * by another key. Older desktops leave it out (phones pin on first sight).
   */
  keyThumbprint: string;
}

/** A session issued to one device, bound to its DPoP key's thumbprint. */
export interface EnvironmentGrant {
  sessionToken: string;
  /** ISO 8601: when the session ends if the device stops using it. */
  expiresAt: string;
  permissions: CoachPermission[];
}

/** A single-use pass for opening the WebSocket, so the session token never appears in a URL. */
export interface WebSocketTicket {
  ticket: string;
  expiresAt: string;
}

/** Where this computer can also be reached, for the phone to learn while connected. */
export interface EnvironmentInfo {
  lanRoutes: Array<{ host: string; port: number }>;
}

// ----- Attachments -----

/**
 * One file a phone attaches to a Coach message, prepared as the desktop
 * window prepares it (src/chat/coachFiles.ts): document text already
 * extracted, images downscaled, scans rendered to page images. Bytes are
 * base64. The answer's attachment `id` goes in `coach.send`'s `files`.
 */
export interface RemoteFileUpload {
  sessionId: string;
  name: string;
  mimeType: string;
  kind: "image" | "document";
  original: string;
  text?: string;
  pageCount?: number;
  truncated?: boolean;
  images?: Array<{ mimeType: "image/jpeg" | "image/png"; data: string; width: number; height: number }>;
}

// ----- Permissions -----

export const COACH_PERMISSIONS: readonly CoachPermission[] = [
  "coach:read",
  "coach:operate",
  "coach:approve",
  "access:write"
];

/** What pairing and the relay grant by default. `access:write` is the desktop window's alone. */
export const DEFAULT_GRANT_PERMISSIONS: readonly CoachPermission[] = ["coach:read", "coach:operate", "coach:approve"];
/** A view-only grant. */
export const VIEW_ONLY_PERMISSIONS: readonly CoachPermission[] = ["coach:read"];

/**
 * The permissions an exchange ends up with: the grant's, narrowed to the ones
 * requested when the client asks for fewer. Never wider than `granted`.
 */
export function narrowPermissions(granted: readonly CoachPermission[], requested?: readonly unknown[]): CoachPermission[] {
  if (!requested) return COACH_PERMISSIONS.filter((permission) => granted.includes(permission));
  return COACH_PERMISSIONS.filter((permission) => granted.includes(permission) && requested.includes(permission));
}

// ----- WebSocket RPC -----

/** Every method and the permission checked before it runs. */
export const COACH_RPC_PERMISSIONS = {
  "coach.listSessions": "coach:read",
  "coach.getSession": "coach:read",
  "coach.subscribe": "coach:read",
  "coach.unsubscribe": "coach:read",
  "coach.createSession": "coach:operate",
  "coach.send": "coach:operate",
  "coach.cancel": "coach:operate",
  "coach.deleteSession": "coach:operate",
  "coach.getModels": "coach:read",
  "coach.setModel": "coach:operate",
  "coach.confirm": "coach:approve",
  "environment.info": "coach:read"
} as const satisfies Record<string, CoachPermission>;

export type CoachRpcMethod = keyof typeof COACH_RPC_PERMISSIONS;

export interface CoachRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

/** `failed` is a refusal from a service behind the hub (COROS, a provider), with its message. */
export type RemoteRpcErrorCode = CoachErrorBody["code"] | "failed";

export interface RemoteRpcError {
  code: RemoteRpcErrorCode;
  message: string;
  requiredPermission?: CoachPermission;
}

export type CoachRpcResponse =
  | { id: number | string | null; result: unknown }
  | { id: number | string | null; error: RemoteRpcError };

/** A row in `coach.listSessions`. `preview` and `messageCount` are extras clients may ignore. */
export interface RemoteSessionRow {
  id: string;
  title: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  messageCount?: number;
}

// ----- HTTP errors -----

/**
 * Status codes C-LINK's EnvironmentClient maps: 401 means the session (or a
 * pairing secret, or a bootstrap credential) is gone, so the phone pairs
 * again; 426 or `incompatible` means another protocol; 429 is a rate limit.
 * A bad DPoP proof is 400, so a phone with a wrong clock isn't told to re-pair.
 */
export type RemoteHttpErrorCode =
  | "invalid_request"
  | "invalid_dpop_proof"
  | "invalid_grant"
  | "invalid_token"
  | "forbidden"
  | "host_not_allowed"
  | "not_found"
  | "not_linked"
  | "invalid_signature"
  | "replayed"
  | "method_not_allowed"
  | "too_large"
  | "incompatible"
  | "rate_limited"
  | "unavailable"
  | "internal_error";

export interface RemoteHttpErrorBody {
  error: { code: RemoteHttpErrorCode; message: string; requiredPermission?: CoachPermission };
}

// ----- Pairing link -----

/**
 * `coroslink://remote/1?e=<envId>&a=<lan addrs>&p=<port>&n=<name>#<secret>`.
 * The secret sits in the fragment, so it is never part of a request or a log.
 * C-LINK's parser is `RemotePairingLink.parse`.
 */
export const REMOTE_PAIRING_LINK_PREFIX = "coroslink://remote/1";
export const REMOTE_PAIRING_MAX_HOSTS = 4;
export const REMOTE_PAIRING_MAX_NAME_LENGTH = 80;

export interface RemotePairingLinkFields {
  environmentId: string;
  hosts: string[];
  port: number;
  name?: string;
  secret: string;
}

/** RFC 3986 unreserved characters only, so `'` reaches Swift's URLComponents as written. */
function encodeLinkComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function sanitizeComputerName(name: string | undefined): string {
  return (name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, REMOTE_PAIRING_MAX_NAME_LENGTH);
}

export function encodeRemotePairingLink(fields: RemotePairingLinkFields): string {
  const name = sanitizeComputerName(fields.name);
  const items: Array<[string, string]> = [
    ["e", fields.environmentId],
    ["a", fields.hosts.slice(0, REMOTE_PAIRING_MAX_HOSTS).join(",")],
    ["p", String(fields.port)],
    ...(name ? [["n", name] as [string, string]] : [])
  ];
  const query = items.map(([key, value]) => `${key}=${encodeLinkComponent(value)}`).join("&");
  return `${REMOTE_PAIRING_LINK_PREFIX}?${query}#${fields.secret}`;
}

const BASE64URL_16_BYTES = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** For scripts/remote-client.mjs and tests; C-LINK has its own stricter parser. */
export function parseRemotePairingLink(text: string): RemotePairingLinkFields {
  const invalid = new Error("This isn't a CorosLink Coach pairing link.");
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(`${REMOTE_PAIRING_LINK_PREFIX}?`)) throw invalid;
  const hashAt = trimmed.indexOf("#");
  if (hashAt < 0) throw invalid;
  const secret = trimmed.slice(hashAt + 1);
  const query = trimmed.slice(REMOTE_PAIRING_LINK_PREFIX.length + 1, hashAt);
  const items = new Map<string, string>();
  for (const part of query.split("&")) {
    const equals = part.indexOf("=");
    if (equals <= 0) throw invalid;
    const key = part.slice(0, equals);
    if (items.has(key)) throw invalid;
    items.set(key, decodeURIComponent(part.slice(equals + 1)));
  }
  const environmentId = items.get("e") ?? "";
  const hosts = (items.get("a") ?? "").split(",").filter(Boolean);
  const port = Number(items.get("p"));
  if (
    !BASE64URL_16_BYTES.test(environmentId) ||
    !BASE64URL_32_BYTES.test(secret) ||
    hosts.length === 0 ||
    hosts.length > REMOTE_PAIRING_MAX_HOSTS ||
    new Set(hosts).size !== hosts.length ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw invalid;
  }
  const name = sanitizeComputerName(items.get("n"));
  return { environmentId, hosts, port, ...(name ? { name } : {}), secret };
}

// ----- Relay mint (mirrors relay/src/protocol.ts; keep the two in step) -----

export const RELAY_MINT_REQUEST_TYP = "coroslink-relay-mint+jwt";
export const ENVIRONMENT_MINT_RESPONSE_TYP = "coroslink-env-mint+jws";
export const MINT_REQUEST_LIFETIME_SECONDS = 120;
/** The relay refuses a minted credential that lives longer than this. */
export const MINT_CREDENTIAL_MAX_LIFETIME_SECONDS = 600;

export function mintRequestAudience(environmentId: string): string {
  return `coroslink-env:${environmentId}`;
}

/** Claims of the relay-signed request in `POST /v1/relay/mint` `{request}`. */
export interface RelayMintRequestClaims {
  iss: string;
  aud: string;
  environmentId: string;
  userId: string;
  /** Thumbprint of the phone's DPoP key: the credential only works with it. */
  jkt: string;
  nonce: string;
  iat: number;
  exp: number;
}

export interface MintHttpResponse {
  credential: string;
  expiresAt: string;
  /** Compact JWS over EnvironmentMintResponseProof, signed with the environment key. */
  proof: string;
}

export interface EnvironmentMintResponseProof {
  environmentId: string;
  nonce: string;
  jkt: string;
  /** base64url(SHA-256(UTF-8 credential)). */
  credentialSha256: string;
  /** floor(expiresAt / 1000). */
  exp: number;
  iat: number;
}

// ----- Desktop window (IPC) -----

/** A device paired with this computer, as the Remote access panel lists it. */
export interface RemoteDevice {
  id: string;
  label: string;
  permissions: CoachPermission[];
  /** How it was paired: a QR code on the LAN, or through the relay. */
  via: "pair" | "bootstrap";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  /** Has an open WebSocket right now. */
  connected: boolean;
}

export interface RemotePairingCode {
  id: string;
  /** The pairing link. It holds the secret: show it as a QR code, never log it. */
  link: string;
  qrDataUrl: string;
  hosts: string[];
  port: number;
  createdAt: string;
  expiresAt: string;
  permissions: CoachPermission[];
}

export interface RemoteAccessStatus {
  /** The server is listening (on loopback at least). */
  running: boolean;
  /** Also listening for this computer's local network. */
  networkAccess: boolean;
  keepAwake: boolean;
  /** Keep-awake is holding the computer up right now. */
  keepingAwake: boolean;
  port: number | null;
  lanAddresses: string[];
  name: string;
  environmentId: string | null;
  /** The pairing code being shown, while it's unused and unexpired. */
  pairing: { id: string; expiresAt: string } | null;
  devices: RemoteDevice[];
  error?: string;
  /** Away from home: the website account, the relay link and the Cloudflare connector. */
  cloud?: CloudLinkStatus;
}

// ----- Away from home (electron/remote/cloud/) -----

/**
 * off: away from home is off. linking: talking to the relay or starting
 * the connector. online: cloudflared has a connection to Cloudflare. offline:
 * linked, but cloudflared isn't connected right now. error: see `message`.
 */
export type CloudLinkState = "off" | "linking" | "online" | "offline" | "error";

export interface CloudLinkStatus {
  /** Cloudflare publishes a connector for this computer (or one is installed). */
  available: boolean;
  account: {
    signedIn: boolean;
    handle: string | null;
    displayName: string | null;
    /** Waiting for the browser to come back from watchfaces.coroslink.com. */
    signingIn: boolean;
    error?: string;
  };
  /** Away from home is on: follows the remote access switch once signed in. Off until then. */
  enabled: boolean;
  linked: boolean;
  state: CloudLinkState;
  message?: string;
  /** `<one label>.coroslinkrelay.com`, the only cloud host C-LINK accepts. */
  hostname: string | null;
  connector: {
    /** env: COROSLINK_CLOUDFLARED_PATH; path: on PATH; managed: downloaded by CorosLink. */
    source: "env" | "path" | "managed" | null;
    version: string | null;
    /** None is installed: ask before downloading `downloadVersion` (`downloadBytes`). */
    needsDownload: boolean;
    downloading: boolean;
    /** 0-1 while downloading. */
    progress: number | null;
    downloadVersion: string;
    downloadBytes: number | null;
    connections: number;
    /** Not connected because this network blocks Cloudflare's tunnel port (7844) while HTTPS gets out. */
    portBlocked: boolean;
  };
  /** Cloudflare stops building cloudflared for Intel Macs in 2027. */
  intelMac: boolean;
}
