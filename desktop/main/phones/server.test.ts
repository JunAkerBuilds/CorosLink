import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../localStore";
import { b64url, sha256b64 } from "./dpop";
import type { NetworkInterfaceInfo } from "node:os";
import { isLocalIPv4, lanAddresses, PhoneServer } from "./server";
import { PhoneSessions } from "./sessions";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";
import { CoachHub } from "./coachHub";

/** A phone, signing proofs the way CorosKit's DPoPKey does. */
function phoneKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { crv: string; kty: string; x: string; y: string };
  let n = 0;
  return (method: string, url: string, token?: string) => {
    const head = b64url(JSON.stringify({ alg: "ES256", jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }, typ: "dpop+jwt" }));
    const claims: Record<string, unknown> = { htm: method, htu: url.split("?")[0], iat: Math.floor(Date.now() / 1000), jti: `jti-${Date.now()}-${n++}-xxxxxxxx` };
    if (token) claims.ath = sha256b64(token);
    const body = b64url(JSON.stringify(claims));
    return `${head}.${body}.${b64url(sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" }))}`;
  };
}

let server: PhoneServer | null = null;
afterEach(async () => { await server?.stop(); server = null; });

async function setUp() {
  const dir = mkdtempSync(path.join(tmpdir(), "phones-"));
  const store = new LocalStore(path.join(dir, "clink.db")), sessions = new PhoneSessions(path.join(dir, "phones.db"));
  server = new PhoneServer({ sessions, store, name: "Test Mac", appVersion: "0.1.0", platform: "darwin" });
  const port = await server.start(0);
  return { store, sessions, base: `http://127.0.0.1:${port}` };
}

describe("phones on the local network", () => {
  it("pairs with the QR secret, then syncs with proofs from the same key", async () => {
    const { sessions, base } = await setUp();
    const descriptor = await (await fetch(`${base}/v1/descriptor`)).json();
    expect(descriptor).toMatchObject({ environmentId: sessions.environmentId, protocol: 1, capabilities: ["sync"] });
    expect(server!.pairingLink("S")).toContain(`coroslink://remote/1?e=${sessions.environmentId}`);

    const proof = phoneKey();
    const { secret } = sessions.startPairing();
    const paired = await fetch(`${base}/v1/auth/pair`, { method: "POST", headers: { DPoP: proof("POST", `${base}/v1/auth/pair`), "Content-Type": "application/json" }, body: JSON.stringify({ secret, label: "Aker's iPhone" }) });
    expect(paired.status).toBe(200);
    const grant = await paired.json() as { sessionToken: string };
    // The secret works once.
    const again = await fetch(`${base}/v1/auth/pair`, { method: "POST", headers: { DPoP: proof("POST", `${base}/v1/auth/pair`) }, body: JSON.stringify({ secret, label: "x" }) });
    expect(again.status).toBe(401);

    const auth = (method: string, url: string) => ({ Authorization: `DPoP ${grant.sessionToken}`, DPoP: proof(method, url, grant.sessionToken), "Content-Type": "application/json" });
    const pushed = await fetch(`${base}/v1/sync`, { method: "POST", headers: auth("POST", `${base}/v1/sync`), body: JSON.stringify({ changes: [{ collection: "health.day", id: "2026-11-21", body: { hrv: 62 } }] }) });
    expect((await pushed.json()).results[0]).toMatchObject({ changed: true, version: 1 });
    const pulled = await fetch(`${base}/v1/sync?since=0`, { headers: auth("GET", `${base}/v1/sync`) });
    expect((await pulled.json()).items).toHaveLength(1);
    expect(sessions.list()[0]).toMatchObject({ label: "Aker's iPhone" });
  });

  it("refuses another phone's key, an unknown token and a revoked phone", async () => {
    const { sessions, base } = await setUp();
    const mine = phoneKey(), theirs = phoneKey();
    const { secret } = sessions.startPairing();
    const grant = await (await fetch(`${base}/v1/auth/pair`, { method: "POST", headers: { DPoP: mine("POST", `${base}/v1/auth/pair`) }, body: JSON.stringify({ secret, label: "Phone" }) })).json() as { sessionToken: string };
    const stolen = await fetch(`${base}/v1/sync/status`, { headers: { Authorization: `DPoP ${grant.sessionToken}`, DPoP: theirs("GET", `${base}/v1/sync/status`, grant.sessionToken) } });
    expect(stolen.status).toBe(401);
    expect((await fetch(`${base}/v1/sync/status`, { headers: { Authorization: "DPoP nope", DPoP: mine("GET", `${base}/v1/sync/status`, "nope") } })).status).toBe(401);
    sessions.remove(sessions.list()[0].id);
    expect((await fetch(`${base}/v1/sync/status`, { headers: { Authorization: `DPoP ${grant.sessionToken}`, DPoP: mine("GET", `${base}/v1/sync/status`, grant.sessionToken) } })).status).toBe(401);
  });

  it("knows which addresses are on the local network", () => {
    expect(["192.168.1.4", "10.0.0.2", "172.20.1.1", "100.100.1.1", "::ffff:192.168.0.9"].every(isLocalIPv4)).toBe(true);
    expect(["8.8.8.8", "172.32.0.1", "127.0.0.1", "fe80::1"].some(isLocalIPv4)).toBe(false);
  });

  it("puts Wi-Fi first in the pairing code, not the virtual adapters Windows lists before it", () => {
    const nic = (address: string): NetworkInterfaceInfo => ({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });
    // A Windows PC with WSL, Docker, VirtualBox and a VPN: the Wi-Fi address came fifth and fell off the code.
    expect(lanAddresses({
      "vEthernet (WSL (Hyper-V firewall))": [nic("172.28.80.1")],
      "vEthernet (Default Switch)": [nic("172.20.0.1")],
      "VirtualBox Host-Only Network": [nic("192.168.56.1")],
      "Conexión de red Bluetooth": [nic("169.254.33.2")],
      "Ethernet 2": [nic("169.254.120.4")],
      "Wi-Fi": [nic("192.168.1.37")],
      Tailscale: [nic("100.101.2.3")],
      "Loopback Pseudo-Interface 1": [{ ...nic("127.0.0.1"), internal: true }],
    })).toEqual(["192.168.1.37", "100.101.2.3", "169.254.120.4"]);
    expect(lanAddresses({ en7: [nic("10.0.0.7")], en0: [nic("192.168.1.20")], utun4: [nic("100.90.1.1")], utun3: [nic("10.8.0.2")] }))
      .toEqual(["192.168.1.20", "10.0.0.7", "100.90.1.1"]);
  });
});

/** A request as cloudflared makes it: from this computer, with the tunnel's name as Host. */
function viaTunnel(port: number, hostName: string, method: string, pathName: string, headers: Record<string, string>, body?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path: pathName, headers: { ...headers, Host: hostName } }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => { text += c.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) as Record<string, unknown> : {} }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("Coach for phones, on the network and through the tunnel", () => {
  async function withCoach() {
    const dir = mkdtempSync(path.join(tmpdir(), "phones-"));
    const store = new LocalStore(path.join(dir, "clink.db")), sessions = new PhoneSessions(path.join(dir, "phones.db"));
    const hub = new CoachHub({ items: () => store, ask: async () => new Response(""), provider: async () => "codex" });
    const minted: unknown[] = [];
    server = new PhoneServer({
      sessions, store, name: "Test Mac", appVersion: "0.1.0", platform: "darwin", keyThumbprint: () => "THUMB",
      coach: { hub, models: { catalog: async () => ({ provider: "codex", providers: [] }), choose: async () => {} } },
      tunnel: {
        hostname: () => "0123456789abcdef.coroslinkrelay.com",
        verifyMint: async (request) => { if (request !== "good") throw new Error("bad signature"); return { jkt: phoneJkt, claims: { nonce: "n" } }; },
        mintAnswer: async (claims, credential, expiresAt) => { minted.push(claims); return { credential, expiresAt: new Date(expiresAt).toISOString(), proof: "P" }; },
      },
    });
    const port = await server.start(0);
    return { sessions, port, base: `http://127.0.0.1:${port}`, minted };
  }
  let phoneJkt = "";

  it("offers Coach, opens the socket with a one-time ticket and answers calls", async () => {
    const { sessions, base } = await withCoach();
    expect(await (await fetch(`${base}/v1/descriptor`)).json()).toMatchObject({ capabilities: ["sync", "coach"], keyThumbprint: "THUMB" });
    const proof = phoneKey();
    const { secret } = sessions.startPairing();
    const grant = await (await fetch(`${base}/v1/auth/pair`, { method: "POST", headers: { DPoP: proof("POST", `${base}/v1/auth/pair`) }, body: JSON.stringify({ secret, label: "Phone" }) })).json() as { sessionToken: string; permissions: string[] };
    expect(grant.permissions).toEqual(expect.arrayContaining(["sync:write", "coach:operate"]));
    const auth = (url: string) => ({ Authorization: `DPoP ${grant.sessionToken}`, DPoP: proof("POST", url, grant.sessionToken) });
    const { ticket } = await (await fetch(`${base}/v1/auth/ws-ticket`, { method: "POST", headers: auth(`${base}/v1/auth/ws-ticket`), body: "{}" })).json() as { ticket: string };

    const ws = new WebSocket(`${base.replace("http", "ws")}/v1/ws?ticket=${ticket}`);
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const call = (id: number, method: string, params: object = {}) => new Promise<Record<string, unknown>>((resolve) => {
      const on = (data: Buffer) => { const m = JSON.parse(data.toString()) as Record<string, unknown>; if (m.id === id) { ws.off("message", on); resolve(m); } };
      ws.on("message", on);
      ws.send(JSON.stringify({ id, method, params }));
    });
    expect(await call(1, "coach.listSessions")).toEqual({ id: 1, result: { sessions: [] } });
    const created = await call(2, "coach.createSession") as { result: { session: { id: string } } };
    expect(await call(3, "coach.listSessions")).toMatchObject({ result: { sessions: [{ id: created.result.session.id }] } });
    expect(await call(4, "coach.confirm", { kind: "corosAction" })).toMatchObject({ error: { code: "unsupported" } });
    expect(await call(5, "nope")).toMatchObject({ error: { code: "unsupported" } });

    // The ticket worked once; removing the phone closes its socket.
    const again = new WebSocket(`${base.replace("http", "ws")}/v1/ws?ticket=${ticket}`);
    await expect(new Promise((resolve, reject) => { again.once("open", resolve); again.once("error", reject); })).rejects.toThrow();
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    sessions.remove(sessions.list()[0].id);
    expect(await closed).toBe(4401);
  });

  it("gives a phone away from home a session through the relay's one-time credential", async () => {
    const { port, base, minted } = await withCoach();
    const tunnel = "0123456789abcdef.coroslinkrelay.com";
    const proof = phoneKey();
    // The phone key's thumbprint, as the relay's mint request names it.
    const jwk = JSON.parse(Buffer.from(proof("GET", "x").split(".")[0], "base64url").toString()).jwk;
    phoneJkt = (await import("./dpop")).thumbprint(jwk);

    expect((await viaTunnel(port, tunnel, "GET", "/v1/descriptor", {})).json).toMatchObject({ capabilities: ["sync", "coach"] });
    // Any other name on this computer is refused, and the mint only works through the tunnel.
    expect((await viaTunnel(port, "evil.example", "GET", "/v1/descriptor", {})).status).toBe(421);
    expect((await fetch(`${base}/v1/relay/mint`, { method: "POST", body: JSON.stringify({ request: "good" }) })).status).toBe(404);
    expect((await viaTunnel(port, tunnel, "POST", "/v1/relay/mint", {}, JSON.stringify({ request: "forged" }))).status).toBe(401);

    const mint = await viaTunnel(port, tunnel, "POST", "/v1/relay/mint", {}, JSON.stringify({ request: "good" }));
    expect(mint.status).toBe(200);
    expect(minted).toEqual([{ nonce: "n" }]);
    const credential = mint.json.credential as string;
    const url = `https://${tunnel}/v1/auth/bootstrap`;
    const grant = await viaTunnel(port, tunnel, "POST", "/v1/auth/bootstrap", { DPoP: proof("POST", url) }, JSON.stringify({ credential }));
    expect(grant.status).toBe(200);
    expect(grant.json.sessionToken).toEqual(expect.any(String));
    // Once only.
    expect((await viaTunnel(port, tunnel, "POST", "/v1/auth/bootstrap", { DPoP: proof("POST", url) }, JSON.stringify({ credential }))).status).toBe(401);
    // The QR pairing stays on the local network.
    expect((await viaTunnel(port, tunnel, "POST", "/v1/auth/pair", {}, "{}")).status).toBe(404);
  });
});
