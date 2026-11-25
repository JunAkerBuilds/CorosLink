// The computer as C-LINK's phones see it on the local network: the environment protocol they already speak for Remote
// Coach (CorosKit CoachContract: descriptor, DPoP pairing, DPoP-bound sessions), offering `sync`: the account
// server's sync API, answered from this computer's store. Plain HTTP on the LAN is safe the same way it is for
// Coach: the pairing secret only travels in the QR code, and every request is bound to the phone's key.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { checkProof, ProofError, ReplayGuard } from "./dpop";
import type { PhoneSessions } from "./sessions";

export const PROTOCOL = 1;
const MAX_BODY = 1024 * 1024 + 4096;
const PAIR_ATTEMPTS_PER_MINUTE = 10;

export interface SyncStore { token: string; handle(request: Request): Promise<Response> }
export interface PhoneServerOptions { sessions: PhoneSessions; store: SyncStore; name: string; appVersion: string; platform: string }

/** Private, link-local and Tailscale IPv4 addresses: the ones a phone may reach this computer on. */
export function isLocalIPv4(address: string): boolean {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** This computer's addresses a phone could use (at most four, as the pairing code allows). */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === "IPv4" && !i.internal && isLocalIPv4(i.address))
    .map((i) => i.address)
    .slice(0, 4);
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
  private failedPairs: number[] = [];
  port = 0;

  constructor(private readonly options: PhoneServerOptions) {}

  get listening(): boolean { return !!this.server?.listening; }

  /** Starts listening on all interfaces at `port` (0 picks one). Requests from outside the LAN are refused. */
  async start(port: number): Promise<number> {
    if (this.server?.listening) return this.port;
    const server = createServer((req, res) => { void this.answer(req, res).catch(() => refuse(res, 500, "internal", "Something went wrong on the computer.")); });
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
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  /** The pairing code C-LINK scans: `coroslink://remote/1?e=…&a=…&p=…&n=…#<secret>`. */
  pairingLink(secret: string): string {
    // Percent-encoded, spaces as %20: C-LINK reads the code as a URL, where `+` is a plus, not a space.
    const fields: [string, string][] = [["e", this.options.sessions.environmentId], ["a", lanAddresses().join(",")], ["p", String(this.port)], ["n", this.options.name.slice(0, 80)]];
    const query = fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    return `coroslink://remote/1?${query}#${secret}`;
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only phones on this network, and only by one of this computer's addresses (no DNS rebinding).
    const remote = req.socket.remoteAddress ?? "";
    const host = req.headers.host ?? "";
    const hostName = host.replace(/:\d+$/, "");
    if (!isLocalIPv4(remote) && remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1") return refuse(res, 403, "forbidden", "Not on this network.");
    if (host !== `${hostName}:${this.port}` || !(lanAddresses().includes(hostName) || hostName === "127.0.0.1")) return refuse(res, 421, "wrong_host", "Wrong address.");
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    const htu = `http://${host}${url.pathname}`;

    if (url.pathname === "/v1/descriptor" && method === "GET") {
      const { sessions, name, platform, appVersion } = this.options;
      return send(res, 200, { environmentId: sessions.environmentId, name, platform, appVersion, protocol: PROTOCOL, capabilities: ["sync"] });
    }

    if (url.pathname === "/v1/auth/pair" && method === "POST") {
      const now = Date.now();
      this.failedPairs = this.failedPairs.filter((t) => now - t < 60_000);
      if (this.failedPairs.length >= PAIR_ATTEMPTS_PER_MINUTE) return refuse(res, 429, "rate_limited", "Too many attempts.");
      let jkt: string;
      try { jkt = checkProof(header(req, "dpop"), { method, url: htu }, this.replay.check).jkt; }
      catch (error) { return refuse(res, 400, "invalid_dpop_proof", error instanceof ProofError ? error.message : "Bad proof."); }
      const body = parseJson(await readBody(req));
      const grant = typeof body?.secret === "string" ? this.options.sessions.pair(body.secret, jkt, typeof body.label === "string" ? body.label : "Phone") : null;
      if (!grant) { this.failedPairs.push(now); return refuse(res, 401, "invalid_secret", "This code has expired or was already used."); }
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
