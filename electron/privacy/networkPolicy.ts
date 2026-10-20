import type { NetworkAttempt, NetworkAttemptChannel } from "./dataModeTypes";

/**
 * The single decision point for uploads to COROS. Guards (Node fetch and
 * http(s), Electron sessions) ask it before a request leaves the process;
 * services never decide for themselves.
 *
 * Local-Only Mode is not an offline mode. Reading from COROS (activity lists,
 * dashboards, MCP queries, maps, watch-face themes) and every other service
 * keep working. What is refused is anything that sends data *to* COROS:
 * activity uploads, workouts, plans, schedules, gear, watch-face publishing.
 *
 * COROS's APIs use POST for reads too, so the HTTP method alone cannot tell
 * them apart. Requests are classified by endpoint: a read verb (`query`,
 * `get…`, `detail`, `download`, …) is a read; a write verb (`add`, `save`,
 * `update`, `delete`, `import`, …) is an upload; anything else is judged by
 * method, so an unknown POST/PUT/PATCH/DELETE to COROS is refused.
 */

/** Domains COROS operates (and every subdomain of them). */
const COROS_DOMAINS: readonly string[] = ["coros.com", "coros.com.cn", "coros.cn"];
/** COROS's S3 buckets for activity uploads (electron/corosUploadConfig.ts). */
const COROS_BUCKETS: readonly string[] = ["coros-s3", "eu-coros"];

const READ_SEGMENT = /^(get|query|list|search|detail|download|estimate|calculate|login|logout|check|count|preview)/;
const WRITE_WORD = /(add|save|update|delete|remove|copy|import|upload|create|edit|modify|publish|execute|quit|bind|sync|report|feedback|share|move|reschedule|submit|sts)/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Sign-in and MCP OAuth: credentials and client metadata, not the athlete's data. */
const AUTH_SEGMENT = /^(token|authorize|register|revoke|introspect|userinfo|jwks)$/;
/**
 * Endpoints CorosLink only reads from, whose names don't say so: the
 * profile, the satellite-data server's list of files (`/cep/query`, a GET sent
 * only a random number), and two-step sign-in (`trainingHubService.ts`): asking COROS to email a code to
 * the account, and exchanging that code for a token. Like `/account/login`,
 * they carry sign-in details only, never the athlete's data.
 */
// Paths are compared lower-cased.
const KNOWN_READS = new Set([
  "/user/profile", "/cep/query",
  "/account/captcha", "/account/2fa/login/verify"
]);
/** COROS MCP tools that only read (all current ones are `query…`). */
const MCP_READ_TOOL = /^(query|get|list|search)/i;

const ATTEMPT_LOG_LIMIT = 200;

export class LocalOnlyNetworkError extends Error {
  readonly code = "COROSLINK_LOCAL_ONLY";
  constructor(readonly destination: string, readonly channel: NetworkAttemptChannel) {
    super("Local-Only Mode blocked an upload to COROS.");
    this.name = "LocalOnlyNetworkError";
  }
}

export function isLocalOnlyNetworkError(error: unknown): error is LocalOnlyNetworkError {
  return error instanceof Error && (error as { code?: unknown }).code === "COROSLINK_LOCAL_ONLY";
}

function normalizeHost(rawHost: string | undefined | null): string {
  let host = String(rawHost ?? "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host.replace(/\.+$/, "");
}

/** Whether a host name belongs to COROS. */
export function isCorosHost(rawHost: string | undefined | null): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (COROS_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) return true;
  // Virtual-hosted S3: <bucket>.s3.<region>.amazonaws.com or <bucket>.s3.amazonaws.com.
  return host.endsWith(".amazonaws.com") && COROS_BUCKETS.some(bucket => host.startsWith(`${bucket}.`));
}

function isCorosBucket(url: URL): boolean {
  const host = normalizeHost(url.hostname);
  if (!host.endsWith(".amazonaws.com")) return false;
  if (COROS_BUCKETS.some(bucket => host.startsWith(`${bucket}.`))) return true;
  // Path-style S3: the bucket is the first path segment. A malformed escape (`%zz`) can't name a COROS bucket.
  let bucket: string;
  try { bucket = decodeURIComponent(url.pathname.split("/")[1] ?? ""); } catch { return false; }
  return COROS_BUCKETS.includes(bucket);
}

/** Whether a URL goes to COROS (a COROS host or bucket), without throwing on anything. */
export function isCorosDestination(rawUrl: string | URL): boolean {
  try {
    const url = parseUrl(rawUrl);
    return Boolean(url && (isCorosHost(url.hostname) || isCorosBucket(url)));
  } catch {
    return false;
  }
}

function parseUrl(url: string | URL): URL | undefined {
  try {
    return typeof url === "string" ? new URL(url) : url;
  } catch {
    return undefined;
  }
}

/** The COROS MCP tool names in a JSON-RPC body (single message or batch). */
function mcpToolCalls(body: unknown): string[] | undefined {
  if (typeof body !== "string") return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  return messages
    .filter((message): message is { method: string; params?: { name?: unknown } } => Boolean(message) && typeof message === "object" && (message as { method?: unknown }).method === "tools/call")
    .map(message => String(message.params?.name ?? ""));
}

export interface CorosRequest {
  url: string | URL;
  method?: string;
  /** Request body when it is available as text (needed to tell MCP reads from writes). */
  body?: unknown;
}

export type CorosRequestKind = "not-coros" | "read" | "upload";

/** Classifies a request without performing it. */
export function classifyCorosRequest(request: CorosRequest): { kind: CorosRequestKind; destination: string } {
  const url = parseUrl(request.url);
  if (!url || !/^(https?|wss?):$/.test(url.protocol)) return { kind: "not-coros", destination: "" };
  const method = (request.method ?? "GET").toUpperCase();
  const destination = `${method} ${url.hostname}${url.pathname}`;
  if (isCorosBucket(url)) return { kind: SAFE_METHODS.has(method) ? "read" : "upload", destination };
  if (!isCorosHost(url.hostname)) return { kind: "not-coros", destination: "" };

  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.at(-1) === "mcp" && !SAFE_METHODS.has(method)) {
    const tools = mcpToolCalls(request.body);
    // Without a readable body the call cannot be shown to be a read.
    if (tools === undefined) return { kind: "upload", destination };
    const writes = tools.filter(name => !MCP_READ_TOOL.test(name.replace(/^.*__/, "")));
    return { kind: writes.length ? "upload" : "read", destination: writes.length ? `${destination} ${writes.join(",")}` : destination };
  }
  const last = segments.at(-1) ?? "";
  if (segments.includes("sts")) return { kind: "upload", destination }; // upload credentials
  if (segments.includes(".well-known") || segments.includes("oauth") || AUTH_SEGMENT.test(last) || KNOWN_READS.has(`/${segments.join("/")}`)) {
    return { kind: "read", destination };
  }
  if (READ_SEGMENT.test(last)) return { kind: "read", destination };
  if (WRITE_WORD.test(last)) return { kind: "upload", destination };
  return { kind: SAFE_METHODS.has(method) ? "read" : "upload", destination };
}

export interface NetworkPolicyOptions {
  enforcing?: boolean;
  now?: () => number;
}

type EnforcementListener = (enforcing: boolean) => void;
type AttemptListener = (attempt: NetworkAttempt) => void;

export class NetworkPolicy {
  private enforcingNow: boolean;
  private readonly now: () => number;
  private readonly attempts: NetworkAttempt[] = [];
  private blockedTotal = 0;
  private abortController = new AbortController();
  private readonly enforcementListeners = new Set<EnforcementListener>();
  private readonly attemptListeners = new Set<AttemptListener>();

  constructor(options: NetworkPolicyOptions = {}) {
    this.enforcingNow = options.enforcing === true;
    this.now = options.now ?? Date.now;
  }

  get enforcing(): boolean { return this.enforcingNow; }
  get blockedCount(): number { return this.blockedTotal; }

  /** Starts refusing uploads to COROS and aborts uploads already in flight. */
  enforce(): void {
    if (!this.enforcingNow) {
      this.enforcingNow = true;
      this.abortController.abort(new LocalOnlyNetworkError("in-flight upload", "fetch"));
    }
    for (const listener of this.enforcementListeners) listener(true);
  }

  /**
   * Only used when a relaunch is not possible (tests). The app itself never
   * relaxes enforcement in-process; leaving Local-Only Mode relaunches.
   */
  relaxForTesting(): void {
    this.enforcingNow = false;
    this.abortController = new AbortController();
    for (const listener of this.enforcementListeners) listener(false);
  }

  /** Aborts when enforcement begins, so an upload in flight stops with it. */
  get abortSignal(): AbortSignal { return this.abortController.signal; }

  /**
   * Whether the request may go out, recording a refusal. Only the method,
   * host and path are kept, never queries, headers or bodies.
   */
  allowRequest(request: CorosRequest, channel: NetworkAttemptChannel, initiator?: string): { allowed: boolean; kind: CorosRequestKind; destination: string } {
    let classified: { kind: CorosRequestKind; destination: string };
    try {
      classified = classifyCorosRequest(request);
    } catch {
      // Never throws: an unclassifiable request to COROS is judged by method (an unknown POST is refused), anything else passes.
      const method = String(request.method ?? "GET").toUpperCase();
      classified = isCorosDestination(request.url)
        ? { kind: SAFE_METHODS.has(method) ? "read" : "upload", destination: `${method} ${parseUrl(request.url)?.hostname ?? "COROS"}` }
        : { kind: "not-coros", destination: "" };
    }
    const { kind, destination } = classified;
    if (!this.enforcingNow || kind !== "upload") return { allowed: true, kind, destination };
    this.blockedTotal += 1;
    const attempt: NetworkAttempt = { at: this.now(), channel, destination, ...(initiator ? { initiator } : {}) };
    this.attempts.push(attempt);
    if (this.attempts.length > ATTEMPT_LOG_LIMIT) this.attempts.splice(0, this.attempts.length - ATTEMPT_LOG_LIMIT);
    for (const listener of this.attemptListeners) {
      try { listener(attempt); } catch { /* listeners never break the guard */ }
    }
    return { allowed: false, kind, destination };
  }

  recentAttempts(): NetworkAttempt[] {
    return this.attempts.map(attempt => ({ ...attempt }));
  }

  clearAttempts(): void {
    this.attempts.length = 0;
  }

  onEnforcementChange(listener: EnforcementListener): () => void {
    this.enforcementListeners.add(listener);
    return () => this.enforcementListeners.delete(listener);
  }

  onAttempt(listener: AttemptListener): () => void {
    this.attemptListeners.add(listener);
    return () => this.attemptListeners.delete(listener);
  }
}
