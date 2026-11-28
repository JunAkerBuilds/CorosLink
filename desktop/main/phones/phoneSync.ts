// Phone sync as the app's own pages see it: pair a phone (QR), list and remove paired phones. The server for the
// phones starts with the app once a phone is paired, and when the first pairing code is shown.
import { hostname } from "node:os";
import QRCode from "qrcode";
import { allowThroughFirewall, firewallState, type FirewallState } from "./firewall";
import { lanAddresses, PhoneServer, type PhoneServerOptions, type SyncStore } from "./server";
import { PhoneSessions } from "./sessions";
import type { CloudLink } from "../remote/cloud/cloudLink";
import { mintAnswer, mintRequestKid, verifyMintRequest, type MintClaims } from "../remote/cloud/mint";
import type { EnvironmentKey } from "../remote/identity";

/** Relay mint nonces are kept this long: longer than the request's two minutes and the clock skew. */
const NONCE_MS = 180_000;
import { t } from "@/lib/i18n";

/** Where phones find this computer unless that port is taken. */
const PREFERRED_PORT = 47410;

export class PhoneSync {
  readonly sessions: PhoneSessions;
  private readonly server: PhoneServer;
  readonly name: string;
  /** The firewall rule as last read: pages poll the status every two seconds, netsh runs at most every 30. */
  private firewall: { state: Promise<FirewallState>; at: number } | null = null;

  private cloud: { link: CloudLink; key: EnvironmentKey } | null = null;
  private readonly nonces = new Map<string, number>();

  constructor(file: string, private readonly store: SyncStore & { size: number }, appVersion: string, extra: Pick<PhoneServerOptions, "coach"> = {}) {
    this.sessions = new PhoneSessions(file);
    this.name = hostname().replace(/\.local$/, "").replace(/-/g, " ") || "This computer";
    this.server = new PhoneServer({
      sessions: this.sessions, store, name: this.name, appVersion, platform: process.platform, ...extra,
      keyThumbprint: () => this.cloud?.key.thumbprint ?? null,
      tunnel: {
        hostname: () => this.cloud?.link.hostname ?? null,
        verifyMint: async (request) => {
          const cloud = this.cloud, linkedUserId = cloud?.link.linkedUserId, issuer = cloud?.link.relayIssuer;
          if (!cloud || !linkedUserId || !issuer) throw new Error("not linked");
          const claims = verifyMintRequest(request, {
            environmentId: this.sessions.environmentId, linkedUserId, issuer, jwks: await cloud.link.relayJwks(mintRequestKid(request)),
            seenNonce: (nonce) => this.seenNonce(nonce),
          });
          return { jkt: claims.jkt, claims };
        },
        mintAnswer: async (claims, credential, expiresAt) => mintAnswer(claims as MintClaims, credential, expiresAt, this.cloud!.key),
      },
    });
  }

  private seenNonce(nonce: string): boolean {
    const now = Date.now();
    for (const [n, at] of this.nonces) if (now - at > NONCE_MS) this.nonces.delete(n);
    if (this.nonces.has(nonce)) return true;
    this.nonces.set(nonce, now);
    return false;
  }

  /** Reach from anywhere (remote/cloud): the tunnel to this server, and the key phones pin. */
  connectCloud(link: CloudLink, key: EnvironmentKey): void {
    this.cloud = { link, key };
  }

  /** The port phones (and the tunnel) reach this computer on; 0 until started. */
  get port(): number { return this.server.port; }

  /** Starts listening, on the port phones already know when there is one. */
  async start(): Promise<void> {
    if (this.server.listening) return;
    const wanted = this.sessions.port || PREFERRED_PORT;
    let port: number;
    try { port = await this.server.start(wanted); } catch { port = await this.server.start(0); }
    this.sessions.port = port;
  }

  async startIfPaired(): Promise<void> {
    if (this.sessions.list().length > 0 || (await this.cloud?.link.switchedOn())) await this.start().catch((error: unknown) => console.error("Phone sync couldn't start:", error));
  }

  stop(): Promise<void> {
    return this.server.stop();
  }

  private firewallState(): Promise<FirewallState> {
    if (!this.firewall || Date.now() - this.firewall.at > 30_000) this.firewall = { state: firewallState(), at: Date.now() };
    return this.firewall.state;
  }

  /** `/api/desktop/phones`: the app's own page for phones. */
  async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/desktop/phones" && request.method === "GET") {
      return Response.json({
        name: this.name, listening: this.server.listening, port: this.server.port, addresses: lanAddresses(), items: this.store.size,
        pairing: this.sessions.pairingOpen, firewall: await this.firewallState(),
        phones: this.sessions.list().map(({ id, label, createdAt, lastUsedAt }) => ({ id, label, createdAt, lastUsedAt })),
      });
    }
    if (url.pathname === "/api/desktop/phones/pair" && request.method === "POST") {
      await this.start();
      if (lanAddresses().length === 0) return Response.json({ error: { code: "no_network", message: t("This computer isn't on a local network. Connect to Wi-Fi, then try again.") } }, { status: 409 });
      const { secret, expiresAt } = this.sessions.startPairing();
      const link = this.server.pairingLink(secret);
      const qr = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return Response.json({ link, qr, expiresAt: new Date(expiresAt).toISOString() });
    }
    // Windows only: lets phones through the firewall, behind a UAC prompt.
    if (url.pathname === "/api/desktop/phones/firewall" && request.method === "POST") {
      const state = allowThroughFirewall();
      this.firewall = { state, at: Date.now() };
      return Response.json({ firewall: await state });
    }
    // Reach from anywhere.
    if (url.pathname.startsWith("/api/desktop/phones/cloud")) {
      const cloud = this.cloud?.link;
      if (!cloud) return Response.json({ error: { code: "not_found", message: t("Not found.") } }, { status: 404 });
      const action = url.pathname.slice("/api/desktop/phones/cloud".length).replace(/^\//, "");
      try {
        if (request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as { on?: unknown };
          if (action === "signin") await cloud.signIn();
          else if (action === "signout") await cloud.signOut();
          else if (action === "download") void cloud.download().catch(() => {});
          else if (action === "enabled") {
            // The tunnel points at this server, so it listens first.
            if (body.on === true) { await this.start(); await cloud.checkPort(); }
            await cloud.setEnabled(body.on === true);
          } else return Response.json({ error: { code: "not_found", message: t("Not found.") } }, { status: 404 });
        }
        return Response.json(cloud.status(), { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ error: { code: "failed", message: error instanceof Error ? error.message : t("That didn't work.") } }, { status: 502 });
      }
    }
    if (url.pathname === "/api/desktop/phones" && request.method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      return Response.json({ removed: this.sessions.remove(id) });
    }
    return Response.json({ error: { code: "not_found", message: t("Not found.") } }, { status: 404 });
  }
}
