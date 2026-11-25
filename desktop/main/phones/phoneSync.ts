// Phone sync as the app's own pages see it: pair a phone (QR), list and remove paired phones. The server for the
// phones starts with the app once a phone is paired, and when the first pairing code is shown.
import { hostname } from "node:os";
import QRCode from "qrcode";
import { lanAddresses, PhoneServer, type SyncStore } from "./server";
import { PhoneSessions } from "./sessions";

/** Where phones find this computer unless that port is taken. */
const PREFERRED_PORT = 47410;

export class PhoneSync {
  readonly sessions: PhoneSessions;
  private readonly server: PhoneServer;
  readonly name: string;

  constructor(file: string, private readonly store: SyncStore & { size: number }, appVersion: string) {
    this.sessions = new PhoneSessions(file);
    this.name = hostname().replace(/\.local$/, "").replace(/-/g, " ") || "This computer";
    this.server = new PhoneServer({ sessions: this.sessions, store, name: this.name, appVersion, platform: process.platform });
  }

  /** Starts listening, on the port phones already know when there is one. */
  async start(): Promise<void> {
    if (this.server.listening) return;
    const wanted = this.sessions.port || PREFERRED_PORT;
    let port: number;
    try { port = await this.server.start(wanted); } catch { port = await this.server.start(0); }
    this.sessions.port = port;
  }

  async startIfPaired(): Promise<void> {
    if (this.sessions.list().length > 0) await this.start().catch((error: unknown) => console.error("Phone sync couldn't start:", error));
  }

  stop(): Promise<void> {
    return this.server.stop();
  }

  /** `/api/desktop/phones`: the app's own page for phones. */
  async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/desktop/phones" && request.method === "GET") {
      return Response.json({
        name: this.name, listening: this.server.listening, port: this.server.port, addresses: lanAddresses(), items: this.store.size,
        pairing: this.sessions.pairingOpen,
        phones: this.sessions.list().map(({ id, label, createdAt, lastUsedAt }) => ({ id, label, createdAt, lastUsedAt })),
      });
    }
    if (url.pathname === "/api/desktop/phones/pair" && request.method === "POST") {
      await this.start();
      if (lanAddresses().length === 0) return Response.json({ error: { code: "no_network", message: "This computer isn't on a local network. Connect to Wi-Fi, then try again." } }, { status: 409 });
      const { secret, expiresAt } = this.sessions.startPairing();
      const link = this.server.pairingLink(secret);
      const qr = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return Response.json({ link, qr, expiresAt: new Date(expiresAt).toISOString() });
    }
    if (url.pathname === "/api/desktop/phones" && request.method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      return Response.json({ removed: this.sessions.remove(id) });
    }
    return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
}
