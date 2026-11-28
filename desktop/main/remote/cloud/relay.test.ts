import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sealer } from "../../secrets";
import { EnvironmentKey } from "../identity";
import { RELAY_URL, RelayClient, RelayError, relayKeys, relayOrigin, SIGNATURE_HEADER } from "./relay";

const sealer: Sealer = { encrypt: async (t) => Buffer.from(t), decrypt: async (d) => ({ text: d.toString(), stale: false }) };
const ENV_ID = "env_0123456789abcdef";
const HOST = "0123456789abcdef.coroslinkrelay.com";
let dir: string;
let key: EnvironmentKey;
beforeAll(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "clink-relay-")); key = await EnvironmentKey.load(dir, sealer); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;

/** Checks the environment signature as the relay does, then answers with `answer(route, body)`. */
function fakeRelay(answer: (route: string, body: Record<string, unknown>, init: RequestInit) => Response) {
  const seen: { route: string; header: Record<string, unknown>; payload: Record<string, unknown>; init: RequestInit }[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (init.method === "GET") return answer(url.pathname, {}, init);
    const jws = (init.headers as Record<string, string>)[SIGNATURE_HEADER];
    const [h, p, s] = jws.split(".");
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: key.publicJwk as JsonWebKey, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    if (!ok) return Response.json({ error: { code: "invalid_signature", message: "bad" } }, { status: 401 });
    const payload = decode(p);
    expect(payload.bodySha256).toBe(createHash("sha256").update(String(init.body)).digest("base64url"));
    seen.push({ route: url.pathname, header: decode(h), payload, init });
    return answer(url.pathname, JSON.parse(String(init.body)) as Record<string, unknown>, init);
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
}

const allocation = { environmentId: ENV_ID, hostname: HOST, httpBaseUrl: `https://${HOST}`, tunnelId: "tun-1", generation: 3 };

describe("the relay client", () => {
  it("links with a signed call and the website token", async () => {
    const relay = fakeRelay((_route, body) => {
      expect(body).toEqual({ environmentId: ENV_ID, publicJwk: key.publicJwk, label: "Aker's Mac", platform: "darwin", port: 41234 });
      return Response.json({ ...allocation, userId: "user-1", connectorToken: "secret-token", keyThumbprint: key.thumbprint });
    });
    const client = new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: relay.fetch });
    const answer = await client.link({ relayToken: "jwt", label: "Aker's Mac", platform: "darwin", port: 41234 });
    expect(answer).toEqual({ hostname: HOST, tunnelId: "tun-1", generation: 3, userId: "user-1", connectorToken: "secret-token" });
    const [call] = relay.seen;
    expect(call.route).toBe("/v1/environments/link");
    expect(call.header).toEqual({ typ: "coroslink-env-request+jws", alg: "ES256", kid: key.thumbprint });
    expect(call.payload).toMatchObject({ aud: RELAY_URL, environmentId: ENV_ID, op: "environment.link" });
    expect(String(call.payload.nonce).length).toBeGreaterThanOrEqual(22);
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(call.init.redirect).toBe("manual");
  });

  it("refuses a link to another key or an address outside the tunnel zone", async () => {
    const answers = [
      { ...allocation, userId: "u", connectorToken: "t", keyThumbprint: "someone-else" },
      { ...allocation, hostname: "evil.example.com", userId: "u", connectorToken: "t", keyThumbprint: key.thumbprint },
      { ...allocation, environmentId: "env_other_computer", userId: "u", connectorToken: "t", keyThumbprint: key.thumbprint },
    ];
    for (const body of answers) {
      const client = new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: fakeRelay(() => Response.json(body)).fetch });
      await expect(client.link({ relayToken: "jwt", label: "x", platform: "linux", port: 1 })).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("recovers, and passes a new connector token on", async () => {
    const relay = fakeRelay((_r, body) => {
      expect(body).toEqual({ environmentId: ENV_ID, tunnelId: "tun-1", port: 5000 });
      return Response.json({ ...allocation, tunnelId: "tun-2", action: "reprovisioned", connectorToken: "new-token" });
    });
    const client = new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: relay.fetch });
    expect(await client.recovery({ tunnelId: "tun-1", port: 5000 })).toEqual({ hostname: HOST, tunnelId: "tun-2", generation: 3, action: "reprovisioned", connectorToken: "new-token" });
    expect(relay.seen[0].payload.op).toBe("environment.recovery");
  });

  it("unlinks", async () => {
    const relay = fakeRelay(() => Response.json({ environmentId: ENV_ID, unlinked: true, teardown: "pending" }));
    const client = new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: relay.fetch });
    expect(await client.unlink()).toEqual({ teardown: "pending" });
    expect(relay.seen[0].payload.op).toBe("environment.unlink");
  });

  it("corrects its clock from a stale-signature answer and tries once more", async () => {
    let calls = 0;
    const serverTime = Math.floor(Date.now() / 1000) + 3600;
    const relay = fakeRelay(() => (++calls === 1
      ? Response.json({ error: { code: "signature_stale", message: "stale", details: { serverTime } } }, { status: 401 })
      : Response.json({ environmentId: ENV_ID, unlinked: true, teardown: "complete" })));
    const client = new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: relay.fetch });
    await client.unlink();
    expect(Math.abs(Number(relay.seen[1].payload.iat) - serverTime)).toBeLessThanOrEqual(1);
    expect(relay.seen[1].payload.nonce).not.toBe(relay.seen[0].payload.nonce);
  });

  it("reports the relay's errors, and refuses redirects", async () => {
    const busy = fakeRelay(() => Response.json({ error: { code: "allocation_busy", message: "Busy." } }, { status: 503, headers: { "Retry-After": "40" } }));
    const error = await new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: busy.fetch }).unlink().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RelayError);
    expect(error).toMatchObject({ status: 503, code: "allocation_busy", message: "Busy.", retryAfterSeconds: 40 });
    const gone = fakeRelay(() => Response.json({ error: { code: "environment_not_linked", message: "No." } }, { status: 404 }));
    expect(await new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: gone.fetch }).unlink().catch((e: RelayError) => e.notLinked)).toBe(true);
    const moved = fakeRelay(() => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } }));
    await expect(new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: moved.fetch }).unlink()).rejects.toMatchObject({ code: "redirect_refused" });
  });

  it("reads only public ES256 keys from the relay's JWKS", async () => {
    const x = "x".repeat(43), y = "y".repeat(43);
    expect(relayKeys({ keys: [
      { kty: "EC", crv: "P-256", x, y, kid: "k1", alg: "ES256", use: "sig" },
      { kty: "EC", crv: "P-256", x, y, kid: "k2", d: "private" },
      { kty: "RSA", n: "n", e: "AQAB", kid: "k3" },
      { kty: "EC", crv: "P-256", x, y, kid: "k4", alg: "ES384" },
    ] })).toEqual([{ kty: "EC", crv: "P-256", x, y, kid: "k1", alg: "ES256" }]);
    const client = new RelayClient({ origin: RELAY_URL, key, environmentId: ENV_ID, fetch: fakeRelay((route) => {
      expect(route).toBe("/.well-known/jwks.json");
      return Response.json({ keys: [] });
    }).fetch });
    await expect(client.jwks()).rejects.toThrow(/no signing keys/);
  });

  it("is the production relay in a shipped build", () => {
    expect(relayOrigin(true, { COROSLINK_RELAY_URL: "https://relay-dev.coroslink.com" })).toBe(RELAY_URL);
    expect(relayOrigin(false, { COROSLINK_RELAY_URL: "https://relay-dev.coroslink.com/" })).toBe("https://relay-dev.coroslink.com");
    expect(relayOrigin(false, { COROSLINK_RELAY_URL: "http://127.0.0.1:8787" })).toBe("http://127.0.0.1:8787");
    expect(() => relayOrigin(false, { COROSLINK_RELAY_URL: "http://relay.example" })).toThrow(/https/);
  });
});
