// The computer as C-LINK's phones see it: the environment protocol of CorosKit CoachContract (descriptor, DPoP
// pairing, DPoP-bound sessions), offering `sync` (the account server's sync API, answered from this computer's
// store) and `coach` (Coach's conversations on one WebSocket, socket.ts). Phones reach it on the local network, and,
// with Reach from anywhere on, through this computer's Cloudflare Tunnel, which arrives on 127.0.0.1 with the
// tunnel's own host name. Plain HTTP on the LAN is safe: the pairing secret only travels in the QR code, and every
// request is bound to the phone's key.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { phoneReachable } from "../nics";
import type { CoachHub } from "./coachHub";
import { checkProof, ProofError, ReplayGuard } from "./dpop";
import { PHONE_PERMISSIONS, type PhoneSessions } from "./sessions";
import { MAX_FRAME, serveSocket, type CoachModels } from "./socket";

export const PROTOCOL = 1;
const MAX_BODY = 1024 * 1024 + 4096;
const PAIR_ATTEMPTS_PER_MINUTE = 10;
/** Senders remembered at once; past this the oldest are forgotten, so a flood can't grow the list without end. */
const MAX_SENDERS = 1000;

/** Failed attempts per sender over the last minute, so one sender's failures don't lock out everyone else. */
export class FailedAttempts {
  private readonly bySender = new Map<string, number[]>();
  constructor(private readonly perMinute = PAIR_ATTEMPTS_PER_MINUTE) {}

  /** Whether `sender` has used up its attempts for now. */
  blocked(sender: string, now = Date.now()): boolean {
    const recent = (this.bySender.get(sender) ?? []).filter((t) => now - t < 60_000);
    if (recent.length) this.bySender.set(sender, recent); else this.bySender.delete(sender);
    return recent.length >= this.perMinute;
  }

  failed(sender: string, now = Date.now()): void {
    const list = this.bySender.get(sender) ?? [];
    list.push(now);
    this.bySender.delete(sender);
    this.bySender.set(sender, list);
    while (this.bySender.size > MAX_SENDERS) this.bySender.delete(this.bySender.keys().next().value as string);
  }
}

export interface SyncStore { token: string; handle(request: Request): Promise<Response> }
/** The relay's side of a phone away from home (remote/cloud): the tunnel's host and the mint exchange. */
export interface TunnelSide {
  hostname(): string | null;
  /** Checks a relay-signed mint request; the phone key's thumbprint it is for. Throws when it isn't good. */
  verifyMint(request: string): Promise<{ jkt: string; claims: unknown }>;
  /** The signed answer the relay passes on to the phone. */
  mintAnswer(claims: unknown, credential: string, expiresAt: number): Promise<unknown>;
}

export interface PhoneServerOptions {
  sessions: PhoneSessions; store: SyncStore; name: string; appVersion: string; platform: string;
  /** Coach for phones; without it the computer offers sync alone. */
  coach?: { hub: CoachHub; models: CoachModels };
  /** RFC 7638 thumbprint of this computer's key, which phones pin. */
  keyThumbprint?: () => string | null;
  tunnel?: TunnelSide;
}

const TICKET_MS = 30_000;
/** A socket closed because the phone was removed here: C-LINK pairs again. */
const CLOSE_REMOVED = 4401;

/** Private, link-local and Tailscale IPv4 addresses: the ones a phone may reach this computer on. */
export function isLocalIPv4(address: string): boolean {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const isTailscale = (address: string) => { const [a, b] = address.split(".").map(Number); return a === 100 && b >= 64 && b <= 127; };

/** This computer's addresses a phone could use, Wi-Fi first, at most four (as the pairing code allows). Virtual
 *  adapters (WSL, Hyper-V, VMs, Docker, VPNs) are left out: listed first, they'd push the Wi-Fi address off the code. */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  return phoneReachable(interfaces, isLocalIPv4, isTailscale).slice(0, 4);
}

/** Every address this computer answers on, for checking the Host a phone asked for. */
function ownAddresses(): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === "IPv4" && !i.internal && isLocalIPv4(i.address))
    .map((i) => i.address);
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
};
const refuse = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { error: { code, message } });

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export class PhoneServer {
  private server: Server | null = null;
  private readonly replay = new ReplayGuard();
  private readonly failedPairs = new FailedAttempts();
  private readonly failedBootstraps = new FailedAttempts();
  /** WebSocket tickets: single use, 30 s. */
  private readonly tickets = new Map<string, { phoneId: string; expiresAt: number }>();
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  port = 0;

  constructor(private readonly options: PhoneServerOptions) {
    options.sessions.onEnded = (id) => this.closeSockets(id);
  }

  private closeSockets(phoneId: string): void {
    for (const socket of this.sockets.get(phoneId) ?? []) socket.close(CLOSE_REMOVED, "removed");
    this.sockets.delete(phoneId);
  }

  get listening(): boolean { return !!this.server?.listening; }

  /** Starts listening on all interfaces at `port` (0 picks one). Requests from outside the LAN are refused. */
  async start(port: number): Promise<number> {
    if (this.server?.listening) return this.port;
    const server = createServer((req, res) => { void this.answer(req, res).catch(() => refuse(res, 500, "internal", "Something went wrong on the computer.")); });
    server.on("upgrade", (req, socket, head) => this.upgrade(req, socket, head));
    server.headersTimeout = 15_000;
    server.requestTimeout = 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => resolve());
    });
    this.server = server;
    this.port = (server.address() as { port: number }).port;
    return this.port;
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const set of this.sockets.values()) for (const socket of set) socket.terminate();
    this.sockets.clear();
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  /** The pairing code C-LINK scans: `coroslink://remote/1?e=…&a=…&p=…&n=…#<secret>`. */
  pairingLink(secret: string): string {
    // Percent-encoded, spaces as %20: C-LINK reads the code as a URL, where `+` is a plus, not a space.
    const fields: [string, string][] = [["e", this.options.sessions.environmentId], ["a", lanAddresses().join(",")], ["p", String(this.port)], ["n", this.options.name.slice(0, 80)]];
    const query = fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    return `coroslink://remote/1?${query}#${secret}`;
  }

  /**
   * Where a request came from: a phone on this network by one of this computer's addresses (no DNS rebinding), or
   * the tunnel (cloudflared on this computer, keeping the phone's Host: the tunnel's name). Null for anything else.
   */
  private where(req: IncomingMessage): { base: string; tunnel: boolean } | null {
    const remote = req.socket.remoteAddress ?? "";
    const host = req.headers.host ?? "";
    const hostName = host.replace(/:\d+$/, "");
    const loopback = remote === "127.0.0.1" || remote === "::ffff:127.0.0.1" || remote === "::1";
    const tunnel = this.options.tunnel?.hostname() ?? null;
    if (loopback && tunnel && host.toLowerCase() === tunnel) return { base: `https://${tunnel}`, tunnel: true };
    if (!isLocalIPv4(remote) && !loopback) return null;
    if (host !== `${hostName}:${this.port}` || !(ownAddresses().includes(hostName) || hostName === "127.0.0.1")) return null;
    return { base: `http://${host}`, tunnel: false };
  }

  private descriptor() {
    const { sessions, name, platform, appVersion, coach } = this.options;
    const keyThumbprint = this.options.keyThumbprint?.() ?? null;
    return { environmentId: sessions.environmentId, name, platform, appVersion, protocol: PROTOCOL, capabilities: coach ? ["sync", "coach"] : ["sync"], ...(keyThumbprint ? { keyThumbprint } : {}) };
  }

  /** The WebSocket, opened with a ticket from `/v1/auth/ws-ticket`. */
  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const reject = (status: number, text: string) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    const where = this.where(req);
    if (!where) return reject(403, "Forbidden");
    const url = new URL(req.url ?? "/", where.base);
    const coach = this.options.coach;
    if (url.pathname !== "/v1/ws" || !coach) return reject(404, "Not Found");
    const ticket = url.searchParams.get("ticket") ?? "";
    const held = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!held || held.expiresAt <= Date.now() || !this.options.sessions.list().some((p) => p.id === held.phoneId)) return reject(401, "Unauthorized");
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const set = this.sockets.get(held.phoneId) ?? new Set<WebSocket>();
      set.add(ws);
      this.sockets.set(held.phoneId, set);
      ws.on("close", () => set.delete(ws));
      serveSocket(ws, {
        hub: coach.hub, models: coach.models, permissions: PHONE_PERMISSIONS,
        info: () => ({ lanRoutes: lanAddresses().map((host) => ({ host, port: this.port })) }),
      });
    });
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const where = this.where(req);
    if (!where) return refuse(res, req.headers.host ? 421 : 403, "wrong_host", "Wrong address.");
    const url = new URL(req.url ?? "/", where.base);
    const method = req.method ?? "GET";
    const htu = `${where.base}${url.pathname}`;

    if (url.pathname === "/v1/descriptor" && method === "GET") return send(res, 200, this.descriptor());

    // The relay asking for a one-time credential for a phone away from home. Only through the tunnel.
    if (url.pathname === "/v1/relay/mint" && method === "POST") {
      const tunnel = this.options.tunnel;
      if (!where.tunnel || !tunnel) return refuse(res, 404, "not_found", "Not found.");
      const body = parseJson(await readBody(req));
      let checked: { jkt: string; claims: unknown };
      try { checked = await tunnel.verifyMint(typeof body?.request === "string" ? body.request : ""); }
      catch (error) { return refuse(res, 401, "invalid_signature", error instanceof Error ? error.message : "Bad request."); }
      const minted = this.options.sessions.mintCredential(checked.jkt);
      if (!minted) return refuse(res, 403, "phone_removed", "This phone was removed on the computer. Scan a new code there to pair it again.");
      return send(res, 200, await tunnel.mintAnswer(checked.claims, minted.credential, minted.expiresAt));
    }

    // A phone spending the relay's credential for a session.
    if (url.pathname === "/v1/auth/bootstrap" && method === "POST") {
      const sender = senderOf(req, where.tunnel);
      if (this.failedBootstraps.blocked(sender)) return refuse(res, 429, "rate_limited", "Too many attempts.");
      let jkt: string;
      try { jkt = checkProof(header(req, "dpop"), { method, url: htu }, this.replay.check).jkt; }
      catch (error) { return refuse(res, 400, "invalid_dpop_proof", error instanceof ProofError ? error.message : "Bad proof."); }
      const body = parseJson(await readBody(req));
      const grant = typeof body?.credential === "string" ? this.options.sessions.bootstrap(body.credential, jkt, typeof body.label === "string" ? body.label : "Phone") : null;
      if (!grant) { this.failedBootstraps.failed(sender); return refuse(res, 401, "invalid_grant", "This sign-in has expired. Try again."); }
      return send(res, 200, grant);
    }

    if (url.pathname === "/v1/auth/pair" && method === "POST") {
      // The QR code's secret, on this network only.
      if (where.tunnel) return refuse(res, 404, "not_found", "Not found.");
      const sender = senderOf(req, false);
      if (this.failedPairs.blocked(sender)) return refuse(res, 429, "rate_limited", "Too many attempts.");
      let jkt: string;
      try { jkt = checkProof(header(req, "dpop"), { method, url: htu }, this.replay.check).jkt; }
      catch (error) { return refuse(res, 400, "invalid_dpop_proof", error instanceof ProofError ? error.message : "Bad proof."); }
      const body = parseJson(await readBody(req));
      const grant = typeof body?.secret === "string" ? this.options.sessions.pair(body.secret, jkt, typeof body.label === "string" ? body.label : "Phone") : null;
      if (!grant) { this.failedPairs.failed(sender); return refuse(res, 401, "invalid_secret", "This code has expired or was already used."); }
      return send(res, 200, grant);
    }

    // Everything else needs a session, proven with the phone's key.
    const auth = header(req, "authorization");
    const token = auth?.startsWith("DPoP ") ? auth.slice(5) : null;
    const session = token ? this.options.sessions.use(token) : null;
    if (!token || !session) return refuse(res, 401, "unauthorized", "Pair this phone again.");
    try {
      const { jkt } = checkProof(header(req, "dpop"), { method, url: htu, accessToken: token }, this.replay.check);
      if (jkt !== session.jkt) return refuse(res, 401, "unauthorized", "Pair this phone again.");
    } catch (error) {
      return refuse(res, 400, "invalid_dpop_proof", error instanceof ProofError ? error.message : "Bad proof.");
    }

    if (url.pathname === "/v1/auth/session" && method === "DELETE") {
      this.options.sessions.end(token);
      return send(res, 200, { ended: true });
    }

    if (url.pathname === "/v1/auth/ws-ticket" && method === "POST" && this.options.coach) {
      const now = Date.now();
      for (const [k, v] of this.tickets) if (v.expiresAt <= now) this.tickets.delete(k);
      const ticket = randomBytes(32).toString("base64url"), expiresAt = now + TICKET_MS;
      this.tickets.set(ticket, { phoneId: session.id, expiresAt });
      return send(res, 200, { ticket, expiresAt: new Date(expiresAt).toISOString() });
    }

    // The sync API, as the local store has it (minus wiping everything: that stays on the computer).
    const syncPath = { "/v1/sync": "", "/v1/sync/status": "/status", "/v1/sync/items": "/items" }[url.pathname];
    if (syncPath !== undefined && (method === "GET" || (method === "POST" && syncPath === ""))) {
      const body = method === "POST" ? await readBody(req) : undefined;
      const answer = await this.options.store.handle(new Request(`http://local.invalid/api/v1/me/sync${syncPath}${url.search}`, {
        method, headers: { Authorization: `Bearer ${this.options.store.token}`, "Content-Type": "application/json" }, body: body ? new Uint8Array(body) : undefined,
      }));
      res.writeHead(answer.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(Buffer.from(await answer.arrayBuffer()));
      return;
    }
    return refuse(res, 404, "not_found", "Not found.");
  }
}

/**
 * Who is asking, for counting failed attempts: the phone's address on this network, or through the tunnel the one
 * Cloudflare's edge puts in CF-Connecting-IP (the edge sets it itself, so a caller can't choose it).
 */
function senderOf(req: IncomingMessage, tunnel: boolean): string {
  const edge = tunnel ? header(req, "cf-connecting-ip")?.trim() : null;
  return edge ? `edge:${edge.slice(0, 64)}` : `lan:${req.socket.remoteAddress ?? ""}`;
}

const header = (req: IncomingMessage, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
};

function parseJson(data: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(data.toString("utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
