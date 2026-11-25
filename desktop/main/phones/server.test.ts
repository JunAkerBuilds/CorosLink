import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../localStore";
import { b64url, sha256b64 } from "./dpop";
import { isLocalIPv4, PhoneServer } from "./server";
import { PhoneSessions } from "./sessions";

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
});
