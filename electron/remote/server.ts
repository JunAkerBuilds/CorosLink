import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { SCHEDULED_STEPS_MAX_DAYS, scheduledStepsRange, scheduledStepsRows, type ScheduledProgram } from "./scheduledSteps";
import {
  ACTIVITY_NOTES_MAX_DAYS,
  activityNoteRows,
  activityNotesRange,
  remoteGear,
  remoteRaces,
  type ActivityNoteSource
} from "./trainingShare";
import type { RaceOverview } from "../raceTypes";
import type { RaceRoute } from "../raceService";
import type { Duplex } from "node:stream";
import os from "node:os";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { CoachSessionHub } from "../coachHub/coachSessionHub";
import { CoachAttachmentError } from "../coachAttachments";
import type { ChatFileAttachment, ChatProvider, ChatSettings, CoachFileUpload, CorosGearCatalog } from "../types";
import { getChatModelOptions, type ChatModelOption } from "../chatModels";
import { phoneSendAddresses } from "../watchfacePhoneSend";
import {
  COACH_RPC_PERMISSIONS,
  ENVIRONMENT_MINT_RESPONSE_TYP,
  MAX_REMOTE_BODY_BYTES,
  MAX_REMOTE_UPLOAD_BYTES,
  MINT_REQUEST_LIFETIME_SECONDS,
  REMOTE_CAPABILITIES,
  REMOTE_FILES_CAPABILITY,
  REMOTE_PLAN_OPTIONS_CAPABILITY,
  REMOTE_PROTOCOL_VERSION,
  REMOTE_SCHEDULED_STEPS_CAPABILITY,
  REMOTE_ACTIVITY_NOTES_CAPABILITY,
  REMOTE_GEAR_CAPABILITY,
  REMOTE_RACES_CAPABILITY,
  REMOTE_ROUTES,
  RELAY_MINT_REQUEST_TYP,
  coachSessionInfo,
  mintRequestAudience,
  type CoachConfirmInput,
  type CoachEventFrame,
  type CoachPermission,
  type CoachRpcMethod,
  type CoachSendInput,
  type EnvironmentDescriptor,
  type EnvironmentInfo,
  type EnvironmentMintResponseProof,
  type MintHttpResponse,
  type RemoteRpcError,
  type RemoteSessionRow
} from "./contract";
import { RemoteAuthError, loadJose, sha256Base64Url, type RemoteAuth, type RemoteSessionRecord } from "./auth";
import type { RemoteIdentity } from "./identity";

/**
 * The environment server: the HTTP + WebSocket front of CoachSessionHub for
 * C-LINK and scripts/remote-client.mjs. It always listens on 127.0.0.1 (where
 * cloudflared will forward the tunnel); with Network access on it listens on
 * every interface but only answers peers on private, link-local or Tailscale
 * addresses. See contract.ts for the routes.
 */

/** The relay's keys and the account this computer is linked to (P6 fills this in). */
export interface RelayTrust {
  /** The relay origin, the mint request's `iss`. */
  issuer: string;
  /** The website user this computer is linked to; a mint for anyone else is refused. */
  userId: string;
  keys: Array<{ kty: "EC"; crv: "P-256"; x: string; y: string; kid: string; alg?: string }>;
}

export interface RemoteAttachmentStore {
  /** Throws CoachAttachmentError, with a message for the athlete, for a file it refuses. */
  save(sessionId: string, upload: CoachFileUpload): Promise<ChatFileAttachment>;
  /** A stored file's summary, or null when it is gone. */
  get(sessionId: string, id: string): Promise<ChatFileAttachment | null>;
}

export type RemoteHub = Pick<
  CoachSessionHub,
  "listSessions" | "getSession" | "createSession" | "subscribe" | "send" | "cancel" | "deleteSession" | "confirm"
>;

export interface RemoteServerOptions {
  identity: RemoteIdentity;
  auth: RemoteAuth;
  hub: RemoteHub;
  descriptor: () => { name: string; appVersion: string; platform?: string };
  /** The provider a remote `coach.createSession` uses. */
  defaultProvider: () => ChatProvider;
  /** Coach's provider and model settings, for `coach.getModels` and `coach.setModel`. */
  chatSettings?: () => ChatSettings;
  saveChatSettings?: (settings: ChatSettings) => ChatSettings;
  /** The live model catalog for a provider; the static list without it. */
  chatModels?: (provider: ChatProvider) => Promise<ChatModelOption[]>;
  /** Where files a phone attaches are kept (coachAttachments.ts); without it phones can't attach. */
  attachments?: RemoteAttachmentStore;
  /** The calendar's workouts with COROS's own programs, from Training Hub; without it phones can't ask for steps. */
  scheduledPrograms?: (startDay: string, endDay: string) => Promise<ScheduledProgram[]>;
  /** Cached COROS activity notes started in [since, until) epoch seconds; without it phones can't ask for notes. */
  activityNotes?: (since: number, until: number) => ActivityNoteSource[];
  /** The COROS account's gear; without it phones can't ask for gear. */
  gear?: () => Promise<CorosGearCatalog>;
  /** Races and targets (raceService); with `raceRoute`, phones can ask for races. */
  races?: () => RaceOverview;
  raceRoute?: (raceId: string) => Promise<RaceRoute | null>;
  /** The port to try first (identity.ts saves it). */
  port: number;
  /** The saved port was taken and the server moved; save the new one. */
  onPortChanged?: (port: number) => void;
  /** Ports to try when the saved one is taken, before letting the OS pick. */
  nextPort?: () => number;
  networkAccess?: boolean;
  lanAddresses?: () => string[];
  /** The Cloudflare Tunnel hostname, once this computer is linked (P6). */
  tunnelHostname?: () => string | null;
  relayTrust?: () => RelayTrust | null;
  /** Fetches the relay's keys again, for a mint signed with a key not seen yet. */
  refreshRelayTrust?: () => Promise<RelayTrust | null>;
  /** A device connected or disconnected. */
  onConnectionsChanged?: () => void;
  now?: () => number;
  /** Interval between WebSocket keepalive pings. */
  pingIntervalMs?: number;
}

// ----- Addresses -----

function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet <= 255) ? octets : null;
}

/** Tailscale's 100.64.0.0/10, which C-LINK also accepts in a pairing link. */
export function isTailscaleIPv4(address: string): boolean {
  const octets = ipv4Octets(address);
  return Boolean(octets && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127);
}

function isLoopback(address: string): boolean {
  return address === "::1" || ipv4Octets(address)?.[0] === 127;
}

/** Peers allowed with Network access on: private, link-local and Tailscale IPv4. */
function isLocalNetworkPeer(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || isTailscaleIPv4(address);
}

function peerAddress(socket: { remoteAddress?: string }): string {
  const address = socket.remoteAddress ?? "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/** This computer's addresses for the pairing link: Send to iPhone's, then Tailscale's. */
export function remoteLanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const tailscale = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((entry) => !entry.internal && entry.family === "IPv4" && isTailscaleIPv4(entry.address))
    .map((entry) => entry.address);
  return [...new Set([...phoneSendAddresses(interfaces), ...tailscale])].slice(0, 4);
}

// ----- Rate limits -----

/** Fixed one-minute windows per key. */
class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  /** Seconds to wait, or 0 if `key` may go ahead. */
  take(key: string, now: number): number {
    if (this.windows.size > 5_000) {
      for (const [candidate, window] of this.windows) if (window.resetAt <= now) this.windows.delete(candidate);
    }
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    window.count += 1;
    return window.count > this.limit ? Math.ceil((window.resetAt - now) / 1000) : 0;
  }
}

// ----- HTTP helpers -----

/** A refusal with the headers it needs (Allow, Retry-After, WWW-Authenticate). */
class HttpError extends RemoteAuthError {
  headers: Record<string, string> = {};

  with(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }
}

function errorHeaders(error: RemoteAuthError): Record<string, string> {
  const headers = error instanceof HttpError ? { ...error.headers } : {};
  if (error.status === 401 && error.code === "invalid_token") {
    headers["WWW-Authenticate"] = 'DPoP algs="ES256", error="invalid_token"';
  }
  return headers;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function sendNoContent(response: ServerResponse): void {
  if (response.headersSent) return;
  response.writeHead(204, { "Cache-Control": "no-store" });
  response.end();
}

function sendError(response: ServerResponse, error: RemoteAuthError): void {
  sendJson(response, error.status, error.toBody(), errorHeaders(error));
}

/**
 * The JSON object body, up to 64 KB unless `limit` says otherwise. A larger one is
 * refused without reading it into memory; the rest is drained, so the client gets
 * the 413 instead of a reset.
 */
function readJsonBody(
  request: IncomingMessage,
  required: boolean,
  limit = MAX_REMOTE_BODY_BYTES
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const tooLarge = new HttpError(413, "too_large", "The request is too large.");
    if (Number(request.headers["content-length"] ?? 0) > limit) {
      request.resume();
      reject(tooLarge);
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    };
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) fail(tooLarge);
      else chunks.push(chunk);
    });
    request.on("error", fail);
    request.on("end", () => {
      if (settled) return;
      settled = true;
      if (total === 0) {
        if (required) reject(new HttpError(400, "invalid_request", "The request needs a JSON body."));
        else resolve({});
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reject(new HttpError(400, "invalid_request", "The request body isn't valid JSON."));
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        reject(new HttpError(400, "invalid_request", "The request body must be a JSON object."));
        return;
      }
      resolve(parsed as Record<string, unknown>);
    });
  });
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

function boundedMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message ? error.message : fallback;
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

// ----- WebSocket clients -----

interface RemoteClient {
  ws: WebSocket;
  session: RemoteSessionRecord;
  subscriptions: Map<string, () => void>;
  alive: boolean;
  lastTouch: number;
}

interface RpcOutcome {
  result: unknown;
  /** Runs right after the result is sent, in the same tick (subscribe's replay). */
  after?: () => void;
}

type RpcHandler = (client: RemoteClient, params: Record<string, unknown>) => RpcOutcome | Promise<RpcOutcome>;

class RpcError extends Error {
  constructor(readonly body: RemoteRpcError) {
    super(body.message);
  }
}

function invalidParams(message: string): RpcError {
  return new RpcError({ code: "invalid", message });
}

function stringParam(params: Record<string, unknown>, key: string, maxLength = 200, required = true): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    if (required) throw invalidParams(`${key} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || !value || value.length > maxLength) throw invalidParams(`${key} must be a string.`);
  return value;
}

const PROVIDERS: ChatProvider[] = ["chatgpt", "claude-code", "gemini-cli", "antigravity", "openrouter", "local"];
const PROVIDER_LABELS: Record<ChatProvider, string> = {
  chatgpt: "ChatGPT",
  "claude-code": "Claude",
  "gemini-cli": "Gemini",
  antigravity: "Antigravity",
  openrouter: "OpenRouter",
  local: "Local model"
};

/** What `coach.getModels` answers: each provider's model and catalog, and the provider in use. */
export interface RemoteModelCatalog {
  provider: ChatProvider;
  providers: Array<{ id: ChatProvider; label: string; model: string; models: ChatModelOption[] }>;
}

function currentModel(settings: ChatSettings, provider: ChatProvider): string {
  switch (provider) {
    case "claude-code": return settings.claudeCode.model ?? "";
    case "gemini-cli": return settings.geminiCli.model ?? "";
    case "antigravity": return settings.antigravity?.model ?? "";
    case "openrouter": return settings.openRouter.model ?? "";
    case "local": return settings.local.model ?? "";
    default: return settings.chatgpt.model ?? "";
  }
}

/** Switches Coach to `provider` and, except for a local server, sets that provider's model. */
export function applyModelChoice(settings: ChatSettings, provider: ChatProvider, model: string): ChatSettings {
  const next: ChatSettings = { ...settings, provider };
  const chosen = model || undefined;
  if (provider === "claude-code") next.claudeCode = { ...settings.claudeCode, model: chosen };
  else if (provider === "gemini-cli") next.geminiCli = { ...settings.geminiCli, model: chosen };
  else if (provider === "antigravity") next.antigravity = { ...settings.antigravity, model: chosen };
  else if (provider === "chatgpt") next.chatgpt = { ...settings.chatgpt, model: chosen };
  else if (provider === "openrouter") next.openRouter = { ...settings.openRouter, model: chosen ?? "openrouter/auto" };
  return next;
}
const CONFIRM_KINDS = ["corosAction", "workoutDelete", "planUpload", "strengthEdit"] as const;
/** A client this far behind is dropped; it resubscribes from its cursor. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_SUBSCRIPTIONS_PER_SOCKET = 8;
const MAX_MESSAGE_LENGTH = 20_000;
/** As MAX_COACH_UPLOADS_PER_MESSAGE in coachAttachments.ts. */
const MAX_REMOTE_FILES_PER_MESSAGE = 6;

export class RemoteServer {
  private server: http.Server | null = null;
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_REMOTE_BODY_BYTES,
    perMessageDeflate: false
  });
  private readonly clients = new Set<RemoteClient>();
  private readonly grantLimiter = new RateLimiter(10);
  private readonly authLimiter = new RateLimiter(60);
  private readonly mintLimiter = new RateLimiter(30);
  private readonly now: () => number;
  private readonly handlers: Record<CoachRpcMethod, RpcHandler>;
  private boundPort: number | null = null;
  private network: boolean;
  private pingTimer: NodeJS.Timeout | null = null;
  private lanCache: { at: number; addresses: string[] } | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly options: RemoteServerOptions) {
    this.now = options.now ?? Date.now;
    this.network = options.networkAccess ?? false;
    this.handlers = {
      "coach.listSessions": () => ({ result: { sessions: this.sessionRows() } }),
      "coach.getSession": (_client, params) => ({
        result: this.options.hub.getSession(stringParam(params, "sessionId")!)
      }),
      "coach.subscribe": (client, params) => this.subscribe(client, params),
      "coach.unsubscribe": (client, params) => {
        const sessionId = stringParam(params, "sessionId")!;
        client.subscriptions.get(sessionId)?.();
        client.subscriptions.delete(sessionId);
        return { result: {} };
      },
      "coach.createSession": (_client, params) => {
        const requested = params.provider;
        const provider = PROVIDERS.includes(requested as ChatProvider)
          ? (requested as ChatProvider)
          : this.options.defaultProvider();
        return { result: { session: coachSessionInfo(this.options.hub.createSession(provider)) } };
      },
      "coach.send": async (_client, params) => ({ result: this.options.hub.send(await this.sendInput(params)) }),
      "coach.cancel": (_client, params) => ({
        result: this.options.hub.cancel(stringParam(params, "sessionId")!)
      }),
      "coach.getModels": async () => ({ result: await this.modelCatalog() }),
      "coach.setModel": async (_client, params) => {
        const settings = this.options.chatSettings?.();
        if (!settings || !this.options.saveChatSettings) {
          throw new RpcError({ code: "unsupported", message: "This CorosLink can't change Coach's model from a phone." });
        }
        const provider = stringParam(params, "provider")!;
        if (!PROVIDERS.includes(provider as ChatProvider)) throw invalidParams("Unknown Coach provider.");
        // An empty model means the provider's own default, so it's read without stringParam.
        const rawModel = params.model ?? "";
        if (typeof rawModel !== "string" || rawModel.length > 200) throw invalidParams("model must be a string.");
        const model = rawModel.trim();
        this.options.saveChatSettings(applyModelChoice(settings, provider as ChatProvider, model));
        return { result: await this.modelCatalog() };
      },
      "coach.deleteSession": (client, params) => {
        const sessionId = stringParam(params, "sessionId")!;
        client.subscriptions.get(sessionId)?.();
        client.subscriptions.delete(sessionId);
        this.options.hub.deleteSession(sessionId);
        return { result: {} };
      },
      "coach.confirm": async (client, params) => ({
        result: await this.options.hub.confirm(this.confirmInput(params), {
          kind: "remote",
          permissions: client.session.permissions
        })
      }),
      "training.scheduledSteps": async (_client, params) => {
        if (!this.options.scheduledPrograms) {
          throw new RpcError({ code: "unsupported", message: "This CorosLink can't read workout steps for a phone." });
        }
        const range = scheduledStepsRange(params);
        if (!range) throw invalidParams(`startDay and endDay must be YYYYMMDD, at most ${SCHEDULED_STEPS_MAX_DAYS} days apart.`);
        return { result: { workouts: scheduledStepsRows(await this.options.scheduledPrograms(range.startDay, range.endDay)) } };
      },
      "training.activityNotes": (_client, params) => {
        if (!this.options.activityNotes) {
          throw new RpcError({ code: "unsupported", message: "This CorosLink can't share activity notes with a phone." });
        }
        const range = activityNotesRange(params);
        if (!range) throw invalidParams(`startDay and endDay must be YYYYMMDD, at most ${ACTIVITY_NOTES_MAX_DAYS} days apart.`);
        return { result: { notes: activityNoteRows(this.options.activityNotes(range.since, range.until)) } };
      },
      "training.gear": async () => {
        if (!this.options.gear) {
          throw new RpcError({ code: "unsupported", message: "This CorosLink can't share gear with a phone." });
        }
        return { result: remoteGear(await this.options.gear()) };
      },
      "training.races": () => {
        if (!this.options.races) {
          throw new RpcError({ code: "unsupported", message: "This CorosLink can't share races with a phone." });
        }
        return { result: remoteRaces(this.options.races()) };
      },
      "training.raceRoute": async (_client, params) => {
        if (!this.options.raceRoute) {
          throw new RpcError({ code: "unsupported", message: "This CorosLink can't share race routes with a phone." });
        }
        const route = await this.options.raceRoute(stringParam(params, "raceId")!);
        if (!route) throw new RpcError({ code: "not_found", message: "That race has no COROS recording on this computer." });
        return { result: route };
      },
      "environment.info": () => ({ result: this.environmentInfo() })
    };
  }

  // ----- Lifecycle -----

  get port(): number | null {
    return this.boundPort;
  }

  get networkAccess(): boolean {
    return this.network;
  }

  get running(): boolean {
    return this.server !== null;
  }

  /** Remote sessions with at least one open WebSocket. */
  connectedSessionIds(): Set<string> {
    return new Set([...this.clients].map((client) => client.session.id));
  }

  start(): Promise<void> {
    return this.serialize(async () => {
      if (this.server) return;
      this.unsubscribeAuth ??= this.options.auth.onChange((change) => {
        if (change.kind === "revoked") this.closeSession(change.sessionId, 4401, "This device was removed.");
      });
      await this.listen();
      this.pingTimer = setInterval(() => this.pingClients(), this.options.pingIntervalMs ?? 30_000);
      this.pingTimer.unref?.();
    });
  }

  stop(): Promise<void> {
    return this.serialize(async () => {
      this.unsubscribeAuth?.();
      this.unsubscribeAuth = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      await this.close(1001, "CorosLink is closing.");
    });
  }

  /** Rebinds: every interface with Network access on, loopback alone with it off. */
  setNetworkAccess(enabled: boolean): Promise<void> {
    return this.serialize(async () => {
      if (enabled === this.network) return;
      this.network = enabled;
      if (!this.server) return;
      await this.close(1012, "Remote access settings changed. Reconnect.");
      await this.listen();
    });
  }

  private serialize(task: () => Promise<void>): Promise<void> {
    const next = this.transition.then(task, task);
    this.transition = next.catch(() => undefined);
    return next;
  }

  private async listen(): Promise<void> {
    const host = this.network ? "0.0.0.0" : "127.0.0.1";
    const candidates = [this.boundPort ?? this.options.port];
    for (let index = 0; index < 4 && this.options.nextPort; index += 1) candidates.push(this.options.nextPort());
    candidates.push(0);
    let lastError: unknown;
    for (const port of candidates) {
      const server = this.createHttpServer();
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
          });
        });
      } catch (error) {
        lastError = error;
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE" || (error as NodeJS.ErrnoException).code === "EACCES") continue;
        throw error;
      }
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      this.server = server;
      if (bound !== this.options.port && bound !== this.boundPort) this.options.onPortChanged?.(bound);
      this.boundPort = bound;
      return;
    }
    throw lastError instanceof Error ? lastError : new Error("Remote access couldn't find a free port.");
  }

  private async close(code: number, reason: string): Promise<void> {
    for (const client of [...this.clients]) client.ws.close(code, reason);
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const client of [...this.clients]) client.ws.terminate();
    });
  }

  private createHttpServer(): http.Server {
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        if (error instanceof RemoteAuthError) {
          sendError(response, error);
          return;
        }
        console.warn("[remote] request failed:", error instanceof Error ? error.message : error);
        sendJson(response, 500, { error: { code: "internal_error", message: "Something went wrong on this computer." } });
      });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.maxHeadersCount = 40;
    server.on("connection", (socket) => {
      if (!this.allowedPeer(peerAddress(socket))) socket.destroy();
    });
    server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    return server;
  }

  // ----- Who may connect -----

  private lanAddresses(): string[] {
    const now = this.now();
    if (!this.lanCache || now - this.lanCache.at > 5_000) {
      this.lanCache = { at: now, addresses: (this.options.lanAddresses ?? remoteLanAddresses)() };
    }
    return this.lanCache.addresses;
  }

  private allowedPeer(address: string): boolean {
    return isLoopback(address) || (this.network && isLocalNetworkPeer(address));
  }

  /**
   * The Host header must name this server: loopback, one of this computer's
   * LAN addresses (with Network access on), or the tunnel hostname (only via
   * cloudflared, which connects from loopback). Stops DNS rebinding.
   */
  private allowedHost(host: string | undefined, peer: string): boolean {
    if (!host || this.boundPort === null) return false;
    let parsed: URL;
    try {
      parsed = new URL(`http://${host}`);
    } catch {
      return false;
    }
    if (parsed.pathname !== "/" || parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? Number(parsed.port) : null;
    if (port === this.boundPort) {
      if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]") return true;
      if (this.network && this.lanAddresses().includes(hostname)) return true;
    }
    const tunnel = this.options.tunnelHostname?.()?.toLowerCase();
    return Boolean(tunnel && hostname === tunnel && (port === null || port === 443) && isLoopback(peer));
  }

  private allowedOrigin(origin: string | undefined, peer: string): boolean {
    if (origin === undefined) return true;
    try {
      const parsed = new URL(origin);
      return this.allowedHost(parsed.host, peer);
    } catch {
      return false;
    }
  }

  /** Forwarded headers count only from loopback, where cloudflared runs. */
  private requestScheme(request: IncomingMessage, peer: string): "http" | "https" {
    if (!isLoopback(peer)) return "http";
    const forwarded = singleHeader(request.headers["x-forwarded-proto"])?.split(",")[0]?.trim().toLowerCase();
    return forwarded === "https" ? "https" : "http";
  }

  private clientKey(request: IncomingMessage, peer: string): string {
    if (isLoopback(peer)) {
      const forwarded =
        singleHeader(request.headers["cf-connecting-ip"]) ??
        singleHeader(request.headers["x-forwarded-for"])?.split(",")[0];
      if (forwarded?.trim()) return forwarded.trim().slice(0, 64);
    }
    return peer;
  }

  private limit(limiter: RateLimiter, key: string): void {
    const wait = limiter.take(key, this.now());
    if (wait > 0) {
      throw new HttpError(429, "rate_limited", "Too many attempts. Wait a minute, then try again.").with("Retry-After", String(wait));
    }
  }

  // ----- HTTP -----

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const peer = peerAddress(request.socket);
    const rawUrl = request.url ?? "";
    if (!rawUrl.startsWith("/")) throw new HttpError(400, "invalid_request", "Bad request.");
    const pathname = rawUrl.split("?")[0]!.split("#")[0]!;
    if (!this.allowedHost(singleHeader(request.headers.host), peer)) {
      throw new HttpError(403, "host_not_allowed", "This address isn't one CorosLink answers on.");
    }
    if (!this.allowedOrigin(singleHeader(request.headers.origin), peer)) {
      throw new HttpError(403, "host_not_allowed", "Requests from web pages aren't allowed.");
    }
    const version = /^\/v(\d+)(\/|$)/.exec(pathname)?.[1];
    if (version !== undefined && version !== String(REMOTE_PROTOCOL_VERSION)) {
      throw new HttpError(426, "incompatible", "Update CorosLink and C-LINK so they can work together.");
    }
    const method = request.method ?? "GET";
    const url = `${this.requestScheme(request, peer)}://${request.headers.host}${pathname}`;
    await this.route(method, pathname, url, this.clientKey(request, peer), request, response);
  }

  private methodNotAllowed(allow: string): HttpError {
    return new HttpError(405, "method_not_allowed", "That method isn't allowed here.").with("Allow", allow);
  }

  private async route(
    method: string,
    pathname: string,
    url: string,
    key: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    switch (pathname) {
      case REMOTE_ROUTES.descriptor:
        if (method !== "GET" && method !== "HEAD") throw this.methodNotAllowed("GET, HEAD");
        return sendJson(response, 200, this.descriptor());
      case REMOTE_ROUTES.pair:
      case REMOTE_ROUTES.bootstrap: {
        if (method !== "POST") throw this.methodNotAllowed("POST");
        this.limit(this.grantLimiter, key);
        const body = await readJsonBody(request, true);
        const { jkt } = await this.options.auth.verifyProof({ proof: request.headers.dpop, method, url });
        const { grant } =
          pathname === REMOTE_ROUTES.pair
            ? this.options.auth.redeemPairing({ secret: body.secret, label: body.label, jkt, permissions: body.permissions })
            : this.options.auth.redeemBootstrap({
                credential: body.credential,
                label: body.label,
                jkt,
                permissions: body.permissions
              });
        return sendJson(response, 200, grant);
      }
      case REMOTE_ROUTES.wsTicket: {
        if (method !== "POST") throw this.methodNotAllowed("POST");
        this.limit(this.authLimiter, key);
        await readJsonBody(request, false);
        const session = await this.authenticate(request, method, url, "coach:read");
        return sendJson(response, 200, this.options.auth.issueTicket(session));
      }
      case REMOTE_ROUTES.session: {
        if (method !== "DELETE") throw this.methodNotAllowed("DELETE");
        this.limit(this.authLimiter, key);
        const session = await this.authenticate(request, method, url);
        this.options.auth.revokeSession(session.id);
        return sendNoContent(response);
      }
      case REMOTE_ROUTES.sessions: {
        if (method !== "GET") throw this.methodNotAllowed("GET");
        this.limit(this.authLimiter, key);
        await this.authenticate(request, method, url, "access:write");
        const connected = this.connectedSessionIds();
        return sendJson(response, 200, {
          sessions: this.options.auth.listSessions().map((record) => ({
            id: record.id,
            label: record.label,
            permissions: record.permissions,
            via: record.via,
            createdAt: new Date(record.createdAt).toISOString(),
            lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt).toISOString(),
            expiresAt: new Date(record.expiresAt).toISOString(),
            connected: connected.has(record.id)
          }))
        });
      }
      case REMOTE_ROUTES.mint: {
        if (method !== "POST") throw this.methodNotAllowed("POST");
        this.limit(this.mintLimiter, "relay");
        const body = await readJsonBody(request, true);
        return sendJson(response, 200, await this.mint(body.request));
      }
      case REMOTE_ROUTES.attachments: {
        if (method !== "POST") throw this.methodNotAllowed("POST");
        this.limit(this.authLimiter, key);
        const store = this.options.attachments;
        if (!store) throw new HttpError(404, "not_found", "This CorosLink can't keep files from a phone. Update it.");
        // Authenticated before the body is read, so only a paired device can send megabytes.
        await this.authenticate(request, method, url, "coach:operate");
        const body = await readJsonBody(request, true, MAX_REMOTE_UPLOAD_BYTES);
        const { sessionId, upload } = this.fileUpload(body);
        try {
          this.options.hub.getSession(sessionId);
        } catch {
          throw new HttpError(404, "not_found", "This conversation is no longer on your computer.");
        }
        try {
          return sendJson(response, 200, { attachment: await store.save(sessionId, upload) });
        } catch (error) {
          if (error instanceof CoachAttachmentError) {
            throw new HttpError(400, "invalid_request", boundedMessage(error, "That file could not be attached."));
          }
          throw error;
        }
      }
      case REMOTE_ROUTES.ws:
        throw new HttpError(400, "invalid_request", "Open this address as a WebSocket.");
      default:
        if (pathname.startsWith(`${REMOTE_ROUTES.sessions}/`)) {
          if (method !== "DELETE") throw this.methodNotAllowed("DELETE");
          this.limit(this.authLimiter, key);
          await this.authenticate(request, method, url, "access:write");
          const id = decodeURIComponent(pathname.slice(REMOTE_ROUTES.sessions.length + 1));
          if (!this.options.auth.revokeSession(id)) throw new HttpError(404, "not_found", "No such device.");
          return sendNoContent(response);
        }
        throw new HttpError(404, "not_found", "Not found.");
    }
  }

  /**
   * `Authorization: DPoP <token>` plus a proof from the key the session is
   * bound to, with `ath`. Bearer tokens are refused outright.
   */
  private async authenticate(
    request: IncomingMessage,
    method: string,
    url: string,
    permission?: CoachPermission
  ): Promise<RemoteSessionRecord> {
    const authorization = singleHeader(request.headers.authorization) ?? "";
    const match = /^DPoP ([\x21-\x7e]{1,512})$/.exec(authorization);
    if (!match) {
      throw new HttpError(401, "invalid_token", "This request needs Authorization: DPoP with a session token.");
    }
    const token = match[1]!;
    const { jkt } = await this.options.auth.verifyProof({ proof: request.headers.dpop, method, url, accessToken: token });
    return this.options.auth.authenticate({ token, jkt, permission });
  }

  descriptor(): EnvironmentDescriptor {
    const { name, appVersion, platform } = this.options.descriptor();
    return {
      environmentId: this.options.identity.environmentId,
      name,
      platform: platform ?? process.platform,
      appVersion,
      protocol: REMOTE_PROTOCOL_VERSION,
      capabilities: [
        ...REMOTE_CAPABILITIES,
        REMOTE_PLAN_OPTIONS_CAPABILITY,
        ...(this.options.attachments ? [REMOTE_FILES_CAPABILITY] : []),
        ...(this.options.scheduledPrograms ? [REMOTE_SCHEDULED_STEPS_CAPABILITY] : []),
        ...(this.options.activityNotes ? [REMOTE_ACTIVITY_NOTES_CAPABILITY] : []),
        ...(this.options.gear ? [REMOTE_GEAR_CAPABILITY] : []),
        ...(this.options.races && this.options.raceRoute ? [REMOTE_RACES_CAPABILITY] : [])
      ],
      keyThumbprint: this.options.identity.kid
    };
  }

  // ----- Relay mint -----

  private async mint(request: unknown): Promise<MintHttpResponse> {
    let trust = this.options.relayTrust?.() ?? null;
    if (!trust || !trust.keys.length) {
      throw new HttpError(404, "not_linked", "This computer isn't linked for access away from home.");
    }
    if (typeof request !== "string" || request.length > 8192) {
      throw new HttpError(400, "invalid_request", "The mint request is missing.");
    }
    const refused = new HttpError(401, "invalid_signature", "The mint request isn't signed by CorosLink's relay.");
    const jose = await loadJose();
    let header: ReturnType<typeof jose.decodeProtectedHeader>;
    try {
      header = jose.decodeProtectedHeader(request);
    } catch {
      throw refused;
    }
    if (header.alg !== "ES256" || header.typ !== RELAY_MINT_REQUEST_TYP || typeof header.kid !== "string") throw refused;
    let jwk = trust.keys.find((key) => key.kid === header.kid);
    if (!jwk && this.options.refreshRelayTrust) {
      trust = (await this.options.refreshRelayTrust()) ?? trust;
      jwk = trust.keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) throw refused;
    const environmentId = this.options.identity.environmentId;
    let claims: Record<string, unknown>;
    try {
      const key = await jose.importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, "ES256");
      const verified = await jose.jwtVerify(request, key, {
        algorithms: ["ES256"],
        typ: RELAY_MINT_REQUEST_TYP,
        issuer: trust.issuer,
        audience: mintRequestAudience(environmentId),
        currentDate: new Date(this.now()),
        clockTolerance: 60,
        requiredClaims: ["iat", "exp", "environmentId", "userId", "jkt", "nonce"]
      });
      claims = verified.payload as Record<string, unknown>;
    } catch {
      throw refused;
    }
    const { iat, exp, userId, jkt, nonce } = claims;
    if (
      claims.environmentId !== environmentId ||
      userId !== trust.userId ||
      typeof iat !== "number" ||
      typeof exp !== "number" ||
      exp - iat > MINT_REQUEST_LIFETIME_SECONDS + 5 ||
      typeof jkt !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(jkt) ||
      typeof nonce !== "string" ||
      !/^[A-Za-z0-9_-]{16,256}$/.test(nonce)
    ) {
      throw refused;
    }
    const minted = this.options.auth.mintBootstrap({ jkt, nonce });
    const proof: EnvironmentMintResponseProof = {
      environmentId,
      nonce,
      jkt,
      credentialSha256: sha256Base64Url(minted.credential),
      exp: Math.floor(minted.expiresAt / 1000),
      iat: Math.floor(this.now() / 1000)
    };
    const privateKey = await jose.importJWK({ ...this.options.identity.privateJwk }, "ES256");
    const signed = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(proof)))
      .setProtectedHeader({ alg: "ES256", typ: ENVIRONMENT_MINT_RESPONSE_TYP, kid: this.options.identity.kid })
      .sign(privateKey);
    return { credential: minted.credential, expiresAt: new Date(minted.expiresAt).toISOString(), proof: signed };
  }

  // ----- WebSocket -----

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const peer = peerAddress(request.socket);
    if (!this.allowedHost(singleHeader(request.headers.host), peer) || !this.allowedOrigin(singleHeader(request.headers.origin), peer)) {
      return refuse(403, "Forbidden");
    }
    // The ticket rides in the query; never log request.url.
    const [pathname, query = ""] = (request.url ?? "").split("?");
    if (pathname !== REMOTE_ROUTES.ws) return refuse(404, "Not Found");
    if (this.authLimiter.take(this.clientKey(request, peer), this.now()) > 0) return refuse(429, "Too Many Requests");
    const session = this.options.auth.redeemTicket(new URLSearchParams(query).get("ticket"));
    if (!session) return refuse(401, "Unauthorized");
    this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, session));
  }

  private accept(ws: WebSocket, session: RemoteSessionRecord): void {
    if (!this.server) {
      ws.close(1001, "CorosLink is closing.");
      return;
    }
    const client: RemoteClient = { ws, session, subscriptions: new Map(), alive: true, lastTouch: this.now() };
    this.clients.add(client);
    ws.on("pong", () => {
      client.alive = true;
    });
    ws.on("message", (data) => this.onMessage(client, data));
    ws.on("close", () => {
      for (const unsubscribe of client.subscriptions.values()) unsubscribe();
      client.subscriptions.clear();
      this.clients.delete(client);
      this.options.onConnectionsChanged?.();
    });
    ws.on("error", () => undefined);
    this.options.onConnectionsChanged?.();
  }

  /** Closes every socket of a session (revoked, or signed out). */
  closeSession(sessionId: string, code = 4401, reason = "This device was removed."): void {
    for (const client of [...this.clients]) {
      if (client.session.id === sessionId) {
        client.ws.close(code, reason);
        // A peer that doesn't answer the close handshake is cut off anyway.
        setTimeout(() => client.ws.terminate(), 2_000).unref?.();
      }
    }
  }

  private pingClients(): void {
    for (const client of [...this.clients]) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }

  private sendFrame(client: RemoteClient, frame: unknown): void {
    if (client.ws.readyState !== client.ws.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.ws.close(1013, "Too far behind. Reconnect and resume.");
      return;
    }
    client.ws.send(JSON.stringify(frame));
  }

  private onMessage(client: RemoteClient, data: RawData): void {
    // A socket being closed (revoked, settings changed) takes no more requests.
    if (client.ws.readyState !== client.ws.OPEN) return;
    const text = Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : Buffer.from(data).toString("utf8");
    let frame: { id?: unknown; method?: unknown; params?: unknown };
    try {
      frame = JSON.parse(text);
    } catch {
      this.sendFrame(client, { id: null, error: { code: "invalid", message: "Frames must be JSON." } });
      return;
    }
    const id = frame?.id;
    if (!(typeof id === "number" && Number.isSafeInteger(id)) && !(typeof id === "string" && id.length <= 128)) {
      this.sendFrame(client, { id: null, error: { code: "invalid", message: "Requests need an id." } });
      return;
    }
    const respondError = (error: unknown) => this.sendFrame(client, { id, error: this.rpcError(error) });
    const method = frame.method;
    if (typeof method !== "string" || !Object.hasOwn(COACH_RPC_PERMISSIONS, method)) {
      respondError(new RpcError({ code: "unsupported", message: `This computer doesn't know ${String(method).slice(0, 60)}.` }));
      return;
    }
    // Every method's permission is checked before its handler runs.
    const permission = COACH_RPC_PERMISSIONS[method as CoachRpcMethod];
    if (!client.session.permissions.includes(permission)) {
      respondError(new RpcError({ code: "forbidden", message: forbiddenMessage(permission), requiredPermission: permission }));
      return;
    }
    const params = frame.params ?? {};
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      respondError(invalidParams("params must be an object."));
      return;
    }
    this.touch(client);
    let outcome: RpcOutcome | Promise<RpcOutcome>;
    try {
      outcome = this.handlers[method as CoachRpcMethod](client, params as Record<string, unknown>);
    } catch (error) {
      respondError(error);
      return;
    }
    const respond = (value: RpcOutcome) => {
      this.sendFrame(client, { id, result: value.result ?? {} });
      value.after?.();
    };
    if (outcome instanceof Promise) outcome.then(respond, respondError);
    else respond(outcome);
  }

  private touch(client: RemoteClient): void {
    const now = this.now();
    if (now - client.lastTouch < 60_000) return;
    client.lastTouch = now;
    this.options.auth.touchSession(client.session.id);
  }

  private rpcError(error: unknown): RemoteRpcError {
    if (error instanceof RpcError) return error.body;
    const hubError = error as { name?: string; toJSON?: () => RemoteRpcError };
    if (hubError?.name === "CoachHubError" && typeof hubError.toJSON === "function") return hubError.toJSON();
    return { code: "failed", message: boundedMessage(error, "Coach couldn't do that.") };
  }

  // ----- Methods -----

  /** Every provider with its current model and the models it offers, plus the one in use. */
  private async modelCatalog(): Promise<RemoteModelCatalog> {
    const settings = this.options.chatSettings?.();
    const providers = await Promise.all(
      PROVIDERS.map(async (id): Promise<RemoteModelCatalog["providers"][number]> => {
        const current = settings ? currentModel(settings, id) : "";
        let models: ChatModelOption[];
        if (id === "local") {
          models = current ? [{ value: current, label: current }] : [];
        } else {
          models = await (this.options.chatModels?.(id) ?? Promise.resolve(getChatModelOptions(id))).catch(() => getChatModelOptions(id));
          if (!models.length) models = getChatModelOptions(id);
        }
        return { id, label: PROVIDER_LABELS[id], model: current, models };
      })
    );
    return { provider: settings?.provider ?? this.options.defaultProvider(), providers };
  }

  private sessionRows(): RemoteSessionRow[] {
    return this.options.hub.listSessions().map((summary) => ({
      ...coachSessionInfo(summary),
      preview: summary.preview,
      messageCount: summary.messageCount
    }));
  }

  private subscribe(client: RemoteClient, params: Record<string, unknown>): RpcOutcome {
    const sessionId = stringParam(params, "sessionId")!;
    const afterSeq = params.afterSeq;
    if (afterSeq !== undefined && afterSeq !== null && !(typeof afterSeq === "number" && Number.isSafeInteger(afterSeq))) {
      throw invalidParams("afterSeq must be a whole number.");
    }
    client.subscriptions.get(sessionId)?.();
    client.subscriptions.delete(sessionId);
    if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
      throw new RpcError({ code: "busy", message: "Unsubscribe from another conversation first." });
    }
    // No cursor: "from now", which is a snapshot.
    const subscription = this.options.hub.subscribe(sessionId, typeof afterSeq === "number" ? afterSeq : -1, (frame: CoachEventFrame) =>
      this.sendFrame(client, frame)
    );
    client.subscriptions.set(sessionId, subscription.unsubscribe);
    return {
      result: subscription.response,
      // Replayed events go out right after the answer, before any live one.
      after: () => {
        for (const frame of subscription.replay) this.sendFrame(client, frame);
      }
    };
  }

  private async sendInput(params: Record<string, unknown>): Promise<CoachSendInput> {
    const sessionId = stringParam(params, "sessionId")!;
    const clientMessageId = stringParam(params, "clientMessageId")!;
    const text = params.text;
    if (text !== undefined && text !== null && (typeof text !== "string" || text.length > MAX_MESSAGE_LENGTH)) {
      throw invalidParams("text must be a string of at most 20,000 characters.");
    }
    const answer = params.promptAnswer as Record<string, unknown> | undefined | null;
    let promptAnswer: CoachSendInput["promptAnswer"];
    if (answer !== undefined && answer !== null) {
      if (typeof answer !== "object" || Array.isArray(answer)) throw invalidParams("promptAnswer must be an object.");
      const choiceId = stringParam(answer, "choiceId", 200, false);
      const answerText = answer.text;
      if (answerText !== undefined && answerText !== null && (typeof answerText !== "string" || answerText.length > MAX_MESSAGE_LENGTH)) {
        throw invalidParams("promptAnswer.text must be a string.");
      }
      promptAnswer = {
        promptId: stringParam(answer, "promptId")!,
        ...(choiceId ? { choiceId } : {}),
        ...(typeof answerText === "string" ? { text: answerText } : {})
      };
    }
    // Files were uploaded to REMOTE_ROUTES.attachments first; chart attachments and units
    // are the desktop's, and remote sends use its last units.
    const files = await this.sendFiles(sessionId, params.files);
    return {
      sessionId,
      clientMessageId,
      ...(typeof text === "string" ? { text } : {}),
      ...(promptAnswer ? { promptAnswer } : {}),
      ...(files.length ? { files } : {})
    };
  }

  /** `coach.send`'s `files`: IDs of attachments uploaded to this conversation. */
  private async sendFiles(sessionId: string, ids: unknown): Promise<ChatFileAttachment[]> {
    if (ids === undefined || ids === null) return [];
    if (!Array.isArray(ids) || ids.length > MAX_REMOTE_FILES_PER_MESSAGE || ids.some((id) => typeof id !== "string" || !id || id.length > 128)) {
      throw invalidParams(`files must be up to ${MAX_REMOTE_FILES_PER_MESSAGE} attachment IDs.`);
    }
    if (!ids.length) return [];
    const store = this.options.attachments;
    if (!store) throw new RpcError({ code: "unsupported", message: "This CorosLink can't keep files from a phone. Update it." });
    const files = await Promise.all(ids.map((id: string) => store.get(sessionId, id).catch(() => null)));
    if (files.some((file) => !file)) throw invalidParams("An attached file is no longer on your computer. Attach it again.");
    return files as ChatFileAttachment[];
  }

  /** The upload route's body, checked field by field; coachAttachments.ts checks the contents. */
  private fileUpload(body: Record<string, unknown>): { sessionId: string; upload: CoachFileUpload } {
    const invalid = (message: string) => new HttpError(400, "invalid_request", message);
    const text = (key: string, max: number, required = true): string | undefined => {
      const value = body[key];
      if (value === undefined || value === null) {
        if (required) throw invalid(`${key} is required.`);
        return undefined;
      }
      if (typeof value !== "string" || value.length > max) throw invalid(`${key} must be a string.`);
      return value;
    };
    const bytes = (value: unknown, key: string): Uint8Array => {
      if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid(`${key} must be base64.`);
      return new Uint8Array(Buffer.from(value, "base64"));
    };
    const sessionId = text("sessionId", 200)!;
    const kind = body.kind;
    if (kind !== "image" && kind !== "document") throw invalid("kind must be image or document.");
    const rawImages = body.images ?? [];
    if (!Array.isArray(rawImages) || rawImages.length > 12) throw invalid("images must be a list of up to 12.");
    const images = rawImages.map((image: unknown) => {
      const value = (image ?? {}) as Record<string, unknown>;
      return {
        mimeType: value.mimeType as "image/jpeg" | "image/png",
        data: bytes(value.data, "images.data"),
        width: value.width as number,
        height: value.height as number
      };
    });
    const pageCount = body.pageCount;
    return {
      sessionId,
      upload: {
        name: text("name", 400)!,
        mimeType: text("mimeType", 200)!,
        kind,
        original: bytes(body.original, "original"),
        ...(typeof body.text === "string" ? { text: text("text", 2_000_000) } : {}),
        ...(typeof pageCount === "number" ? { pageCount } : {}),
        ...(body.truncated === true ? { truncated: true } : {}),
        images
      }
    };
  }

  private confirmInput(params: Record<string, unknown>): CoachConfirmInput {
    const kind = params.kind;
    if (!CONFIRM_KINDS.includes(kind as (typeof CONFIRM_KINDS)[number])) throw invalidParams("Unknown confirmation kind.");
    const decision = params.decision;
    if (decision !== "confirm" && decision !== "cancel") throw invalidParams("decision must be confirm or cancel.");
    const reviewHash = stringParam(params, "reviewHash", 200, false);
    // Remote approvals take the desktop card's defaults, except the two choices a phone's
    // workout card offers: Calendar or Workout Library, and the day.
    const options = kind === "planUpload" ? planUploadOptions(params.options) : undefined;
    return {
      sessionId: stringParam(params, "sessionId")!,
      kind: kind as CoachConfirmInput["kind"],
      id: stringParam(params, "id")!,
      decision,
      ...(reviewHash ? { reviewHash } : {}),
      ...(options ? { options } : {})
    };
  }

  environmentInfo(): EnvironmentInfo {
    const port = this.boundPort;
    if (!this.network || port === null) return { lanRoutes: [] };
    return { lanRoutes: this.lanAddresses().map((host) => ({ host, port })) };
  }
}

/** A phone's `options` for a plan upload: `calendar` or `workoutLibrary`, and a real day (`2026-10-28` or `20261028`). */
export function planUploadOptions(value: unknown): CoachConfirmInput["options"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw invalidParams("options must be an object.");
  const { destination, scheduleDate } = value as Record<string, unknown>;
  if (destination !== undefined && destination !== "calendar" && destination !== "workoutLibrary") {
    throw invalidParams("options.destination must be calendar or workoutLibrary.");
  }
  let day: string | undefined;
  if (scheduleDate !== undefined) {
    const match = typeof scheduleDate === "string" ? /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(scheduleDate) : null;
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!match || !date || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
      throw invalidParams("options.scheduleDate must be a day, YYYY-MM-DD.");
    }
    if (destination === "workoutLibrary") throw invalidParams("A library workout has no day.");
    day = `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (!destination && !day) return undefined;
  return { ...(destination ? { destination } : { destination: "calendar" as const }), ...(day ? { scheduleDate: day } : {}) };
}

function forbiddenMessage(permission: CoachPermission): string {
  switch (permission) {
    case "coach:approve":
      return "This device can view Coach but not approve changes.";
    case "coach:operate":
      return "This device can view Coach but not send messages.";
    default:
      return "This device doesn't have permission for that.";
  }
}
