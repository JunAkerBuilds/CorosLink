import http from "node:http";
import https from "node:https";
import { isCorosDestination, isCorosHost, LocalOnlyNetworkError, type CorosRequest, type NetworkPolicy } from "./networkPolicy";

/**
 * Process-wide guards for the Electron main process (plain Node APIs, so they
 * are testable without Electron). Installed once, before any other module
 * loads; they consult the policy on every call, so entering Local-Only Mode
 * takes effect immediately. Only uploads to COROS are refused; reads from
 * COROS and every other host pass through untouched.
 *
 * Deciding read vs upload needs the method, path and (for COROS MCP) the
 * JSON-RPC body, so the guards sit at the HTTP layer:
 * - `globalThis.fetch`: used by every COROS client in CorosLink, including the
 *   MCP SDK. In-flight uploads abort when enforcement begins. While enforcing,
 *   redirects are followed here rather than by fetch, so every hop is checked:
 *   a 307 from anywhere can't carry a body to a COROS upload endpoint.
 * - `http.request`/`https.request` (and `get`): any other Node HTTP client
 *   (these never follow redirects themselves). Judged as Node will send the
 *   request: the host it connects to and every name it presents (the `Host`
 *   header, set in the options or later with `setHeader`, and the TLS server
 *   name), so a raw IP address carrying a COROS `Host` is refused too.
 *
 * A guard always answers: if deciding fails, a request to COROS is judged by
 * method (`NetworkPolicy.allowRequest` never throws) and any other passes.
 */

const GUARDED = Symbol.for("coroslink.privacy.guarded");

type AnyFunction = (...args: unknown[]) => unknown;

function markGuarded<T extends object>(target: T): T {
  Object.defineProperty(target, GUARDED, { value: true });
  return target;
}

function isGuarded(target: unknown): boolean {
  return Boolean(target && (target as Record<symbol, unknown>)[GUARDED]);
}

function requestParts(input: unknown, init?: RequestInit): { url?: string; method?: string; body?: unknown } {
  if (typeof input === "string" || input instanceof URL) {
    return { url: String(input), method: init?.method, body: init?.body };
  }
  if (input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string") {
    const request = input as Request;
    // A Request object's body is a stream; only init.body is inspectable without consuming it.
    return { url: request.url, method: init?.method ?? request.method, body: init?.body };
  }
  return {};
}

/** The policy's decision; if anything about the request can't even be read, a COROS destination fails closed. */
function decide(policy: NetworkPolicy, request: CorosRequest, channel: "fetch" | "http"): { allowed: boolean; kind: string; destination: string } {
  try {
    return policy.allowRequest(request, channel);
  } catch {
    const coros = isCorosDestination(request.url);
    return { allowed: !(policy.enforcing && coros), kind: coros ? "upload" : "not-coros", destination: "COROS" };
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;
const BODY_HEADERS = ["content-type", "content-length", "content-encoding", "content-language", "content-location"];
const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization", "cookie"];

/** A body fetch can send twice (a stream can't be replayed). */
function replayable(body: unknown): boolean {
  return body === undefined || body === null || typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams || body instanceof Blob || body instanceof FormData;
}

/**
 * fetch with redirects followed one hop at a time, each hop asked of the
 * policy with the method and body it would carry (the Fetch rules: 303, and
 * 301/302 after a POST, become a bodiless GET; 307/308 resend the body).
 */
async function fetchFollowingGuarded(
  original: typeof fetch,
  policy: NetworkPolicy,
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined
): Promise<Response> {
  // A Request object is unpacked once so its body can be resent on a 307/308.
  let url: string;
  let request: RequestInit;
  if (typeof input === "string" || input instanceof URL) {
    url = String(input);
    request = { ...init };
  } else {
    const source = input as Request;
    url = source.url;
    const body = init?.body !== undefined ? init.body : source.body ? await source.arrayBuffer() : undefined;
    request = { method: source.method, headers: source.headers, signal: source.signal, ...init, ...(body !== undefined ? { body } : {}) };
  }
  for (let hop = 0; ; hop++) {
    const response = await original(url, { ...request, redirect: "manual" });
    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || location === null) return response;
    if (hop >= MAX_REDIRECTS) throw new TypeError("fetch failed: too many redirects");
    const next = new URL(location, url);
    if (next.protocol !== "http:" && next.protocol !== "https:") throw new TypeError("fetch failed: redirect to an unsupported scheme");
    const method = (request.method ?? "GET").toUpperCase();
    const headers = new Headers(request.headers);
    let nextRequest: RequestInit = request;
    if (response.status === 303 ? method !== "HEAD" : (response.status === 301 || response.status === 302) && method === "POST") {
      for (const name of BODY_HEADERS) headers.delete(name);
      nextRequest = { ...request, method: method === "HEAD" ? "HEAD" : "GET", body: undefined };
    } else if (!replayable(request.body)) {
      throw new TypeError("fetch failed: a streamed body can't follow a redirect");
    }
    if (next.origin !== new URL(url).origin) for (const name of CREDENTIAL_HEADERS) headers.delete(name);
    nextRequest = { ...nextRequest, headers };
    await response.body?.cancel().catch(() => undefined);
    const decision = decide(policy, { url: next.href, method: nextRequest.method, body: nextRequest.body }, "fetch");
    if (!decision.allowed) throw new LocalOnlyNetworkError(decision.destination, "fetch");
    url = next.href;
    request = nextRequest;
  }
}

function installFetchGuard(policy: NetworkPolicy): void {
  const original = globalThis.fetch;
  if (typeof original !== "function" || isGuarded(original)) return;
  const guarded = markGuarded(async function guardedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    let parts: ReturnType<typeof requestParts>;
    try { parts = requestParts(input, init); } catch { parts = {}; }
    let upload = false;
    if (parts.url) {
      const decision = decide(policy, { url: parts.url, method: parts.method, body: parts.body }, "fetch");
      if (!decision.allowed) throw new LocalOnlyNetworkError(decision.destination, "fetch");
      upload = decision.kind === "upload";
    }
    let signalled = init;
    if (upload) {
      // An upload allowed in Connected Mode stops if Local-Only Mode starts mid-flight.
      const own = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const signals = [policy.abortSignal, own].filter((signal): signal is AbortSignal => Boolean(signal));
      signalled = { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] };
    }
    const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");
    if (policy.enforcing && redirect === "follow") return fetchFollowingGuarded(original, policy, input, signalled);
    return original(input, signalled);
  });
  globalThis.fetch = guarded as typeof fetch;
}

/** `protocol//host` + a request target, without letting the path name another host (`//elsewhere/…`). */
function targetUrl(protocol: string, rawHost: string, path: string): string {
  // An absolute-form target (a request sent through a proxy) names the real destination.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return new URL(path).href;
  let host = rawHost.trim();
  if (host.startsWith("[")) host = host.replace(/\]:\d*$/, "]");
  else if (host.split(":").length > 2) host = `[${host}]`; // bare IPv6
  else host = host.replace(/:\d*$/, "");
  return new URL(`${protocol}//${host}${path.startsWith("/") ? path : `/${path}`}`).href;
}

/** http.request(url[, options][, cb]) / http.request(options[, cb]) → URL and method. */
function nodeRequestTarget(args: unknown[], defaultProtocol: string): { url: string; method?: string } | undefined {
  let url: URL | undefined;
  let options: Record<string, unknown> = {};
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    try { url = new URL(String(args[0])); } catch { return undefined; }
    if (args[1] && typeof args[1] === "object") options = args[1] as Record<string, unknown>;
  } else if (args[0] && typeof args[0] === "object") {
    options = args[0] as Record<string, unknown>;
  } else {
    return undefined;
  }
  const host = String(options.hostname ?? options.host ?? url?.hostname ?? "localhost");
  const path = String(options.path ?? (url ? `${url.pathname}${url.search}` : "/"));
  const protocol = String(options.protocol ?? url?.protocol ?? defaultProtocol);
  try {
    return { url: targetUrl(protocol, host, path), method: typeof options.method === "string" ? options.method : undefined };
  } catch {
    return undefined;
  }
}

/** The TLS server name given in the options, if any. */
function requestedServerName(args: unknown[]): string | undefined {
  const options = [args[0], args[1]].find(arg => arg && typeof arg === "object" && !(arg instanceof URL)) as Record<string, unknown> | undefined;
  return typeof options?.servername === "string" ? options.servername : undefined;
}

/**
 * Refuses (destroys before it connects) a request when any name it goes to or
 * presents is a COROS upload. A name that can't even be turned into a URL is
 * refused if it is a COROS host. True when refused.
 */
function refuseNodeRequest(policy: NetworkPolicy, request: http.ClientRequest, hosts: unknown[], target: { protocol: string; path: string; method: string }): boolean {
  // A proxy tunnel (CONNECT host:port) goes where its target names, and what it will carry can't be seen: judged by method, so refused to COROS.
  if (target.method.toUpperCase() === "CONNECT") hosts = [target.path, ...hosts];
  for (const raw of new Set(hosts.filter(host => typeof host === "string" && host).map(String))) {
    let url: string | undefined;
    try { url = targetUrl(target.protocol, raw, target.path); } catch { url = undefined; }
    const decision = url
      ? decide(policy, { url, method: target.method }, "http")
      : { allowed: !(policy.enforcing && isCorosHost(raw.replace(/:\d*$/, ""))), destination: "COROS" };
    if (!decision.allowed) {
      // Destroyed before the socket connects, so no header or body byte is sent.
      request.destroy(new LocalOnlyNetworkError(decision.destination, "http"));
      return true;
    }
  }
  return false;
}

function guardNodeHttp(policy: NetworkPolicy, module: typeof http | typeof https, protocol: string): void {
  const target = module as unknown as Record<string, AnyFunction>;
  for (const name of ["request", "get"] as const) {
    const original = target[name];
    if (!original || isGuarded(original)) continue;
    target[name] = markGuarded(function guardedRequest(this: unknown, ...args: unknown[]) {
      const request = original.apply(this, args) as http.ClientRequest;
      // What Node will actually send; the parsed arguments only when the request doesn't say.
      const where = (): { protocol: string; path: string; method: string } => ({
        protocol: typeof request.protocol === "string" ? request.protocol : protocol,
        path: typeof request.path === "string" ? request.path : "/",
        method: name === "get" ? "GET" : String(request.method ?? "GET")
      });
      if (policy.enforcing) {
        let refused = false;
        try {
          const connectsTo = typeof request.host === "string" ? request.host : new URL(nodeRequestTarget(args, protocol)?.url ?? "http://localhost").host;
          refused = refuseNodeRequest(policy, request, [connectsTo, request.getHeader("host"), requestedServerName(args)], where());
        } catch {
          refused = false;
        }
        if (refused) return request;
      }
      // A Host header set after the request was made is a destination too.
      const setHeader = request.setHeader;
      request.setHeader = function guardedSetHeader(this: http.ClientRequest, header: string, value: number | string | readonly string[]) {
        if (policy.enforcing && typeof header === "string" && header.toLowerCase() === "host" && !this.destroyed) {
          let refused = false;
          try { refused = refuseNodeRequest(policy, this, [Array.isArray(value) ? value[0] : value], where()); } catch { refused = false; }
          if (refused) return this;
        }
        return setHeader.call(this, header, value);
      } as typeof request.setHeader;
      return request;
    });
  }
}

export function installNodeNetworkGuards(policy: NetworkPolicy): void {
  installFetchGuard(policy);
  guardNodeHttp(policy, http, "http:");
  guardNodeHttp(policy, https, "https:");
}

export const networkGuardInternals = { nodeRequestTarget };
