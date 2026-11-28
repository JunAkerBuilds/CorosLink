import type { spawn as spawnProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Sealer } from "../../secrets";
import { EnvironmentKey } from "../identity";
import { CloudLink, type CloudLinkOptions } from "./cloudLink";
import { SIGNATURE_HEADER } from "./relay";

const sealer: Sealer = { encrypt: async (t) => Buffer.from(`sealed:${t}`), decrypt: async (d) => ({ text: d.toString().replace(/^sealed:/, ""), stale: false }) };
const ENV_ID = "env_0123456789abcdef";
const HOST = "dev-0123456789abcdef.coroslinkrelay.com";
const APP_TOKEN = `clk_${"a".repeat(43)}`;
const JWK = { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43), alg: "ES256", use: "sig" };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clink-cloudlink-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let key: EnvironmentKey;
let cloudflared: string;
beforeAll(async () => {
  key = await EnvironmentKey.load(root, sealer);
  // Answers --version only; the connector itself is the fake spawn below.
  cloudflared = path.join(root, "cloudflared");
  fs.writeFileSync(cloudflared, "#!/bin/sh\necho 'cloudflared version 2026.10.5 (built 2026-10-27)'\n", { mode: 0o755 });
});

/** coroslink.com and the relay, as far as this computer sees them. */
function fakeServers(clock: () => number) {
  const calls: { route: string; body: Record<string, unknown>; signed: boolean }[] = [];
  let recovery: Response | null = null;
  let tunnel = 1;
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const route = `${init.method ?? "GET"} ${url.host}${url.pathname}`;
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ route, body, signed: Boolean((init.headers as Record<string, string> | undefined)?.[SIGNATURE_HEADER]) });
    const allocation = { environmentId: ENV_ID, hostname: HOST, httpBaseUrl: `https://${HOST}`, tunnelId: `tun-${tunnel}`, generation: tunnel };
    switch (route) {
      case "POST watchfaces.coroslink.com/api/v1/app/token": return Response.json({ accessToken: APP_TOKEN, viewer: { handle: "aker" }, expiresAt: "2027-05-01T00:00:00Z" });
      case "POST watchfaces.coroslink.com/api/v1/app/relay-token": return Response.json({ token: "relay-jwt", expiresAt: new Date(clock() + 600_000).toISOString() });
      case "DELETE watchfaces.coroslink.com/api/v1/app/session": return new Response(null, { status: 204 });
      case "POST relay.coroslink.com/v1/environments/link": return Response.json({ ...allocation, userId: "user-1", connectorToken: `connector-${tunnel}`, keyThumbprint: key.thumbprint });
      case "POST relay.coroslink.com/v1/environments/recovery": return recovery ?? Response.json({ ...allocation, action: "unchanged" });
      case "POST relay.coroslink.com/v1/environments/unlink": return Response.json({ environmentId: ENV_ID, unlinked: true, teardown: "complete" });
      case "GET relay.coroslink.com/.well-known/jwks.json": return Response.json({ keys: [{ ...JWK, kid: `relay-${calls.filter((c) => c.route === route).length}` }] });
      default: return new Response("not found", { status: 404 });
    }
  }) as typeof globalThis.fetch;
  return {
    fetch, calls,
    routes: () => calls.map((c) => c.route.replace(/^(\w+) [^/]+/, "$1 ")),
    answerRecovery: (response: Response | null) => { recovery = response; },
    rebuildTunnel: () => { tunnel++; },
  };
}

/** A connector that registers at once and stops when told; what it was started with is kept. */
function fakeSpawn() {
  const started: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  let alive = 0;
  const spawn = ((_binary: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined, exitCode: null as number | null, signalCode: null });
    Object.assign(child, { kill: () => { child.exitCode = 0; alive--; setImmediate(() => child.emit("exit", 0)); return true; } });
    started.push({ args, env: options.env });
    alive++;
    setTimeout(() => child.stderr.write("INF Registered tunnel connection connIndex=0\n"), 5);
    return child;
  }) as unknown as typeof spawnProcess;
  return { spawn, started, alive: () => alive };
}

const links: CloudLink[] = [];
afterEach(async () => { await Promise.all(links.splice(0).map((l) => l.stop())); });

function setup(dir = fs.mkdtempSync(path.join(root, "case-")), overrides: Partial<CloudLinkOptions> = {}) {
  let clock = 1_800_000_000_000;
  let port = 41_000;
  const servers = fakeServers(() => clock);
  const connector = fakeSpawn();
  const opened: string[] = [];
  const make = (more: Partial<CloudLinkOptions> = {}) => {
    const link = new CloudLink({
      dir, sealer, key, environmentId: ENV_ID, label: "Aker's\u0007 Mac", platform: "darwin", arch: "arm64", isPackaged: true,
      port: () => port, openExternal: (url) => { opened.push(url); },
      env: { COROSLINK_CLOUDFLARED_PATH: cloudflared, PATH: "" }, fetch: servers.fetch, now: () => clock, spawn: connector.spawn,
      restartDelayMs: () => 10, edgePortBlocked: async () => false, ...overrides, ...more,
    });
    links.push(link);
    return link;
  };
  return { dir, servers, connector, opened, make, tick: (ms: number) => { clock += ms; }, setPort: (p: number) => { port = p; } };
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (const deadline = Date.now() + 5_000; !check();) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function signIn(cloud: CloudLink, opened: string[]) {
  await cloud.signIn();
  const state = new URL(opened.at(-1)!).searchParams.get("state");
  expect(cloud.handleDeepLink(`coroslink://auth/callback?code=${"c".repeat(40)}&state=${state}`)).toBe(true);
  await until(() => cloud.status().signedIn, "signed in");
}

async function linked() {
  const env = setup();
  const cloud = env.make();
  await cloud.start();
  await signIn(cloud, env.opened);
  await cloud.setEnabled(true);
  await until(() => cloud.status().state === "online", "online");
  return { ...env, cloud };
}

describe("Reach from anywhere", () => {
  it("calls no server until the athlete signs in, and none but the website until the switch is on", async () => {
    const env = setup();
    const cloud = env.make();
    await cloud.start();
    expect(cloud.status()).toMatchObject({ signedIn: false, enabled: false, linked: false, state: "off", hostname: null });
    expect(env.servers.calls).toEqual([]);
    await signIn(cloud, env.opened);
    expect(env.servers.routes()).toEqual(["POST /api/v1/app/token"]);
    expect(cloud.handleDeepLink("clink://app/settings")).toBe(false);
  });

  it("won't switch on before signing in", async () => {
    const env = setup();
    const cloud = env.make();
    await expect(cloud.setEnabled(true)).rejects.toThrow(/Sign in/);
    expect(cloud.status()).toMatchObject({ enabled: false, state: "error" });
    expect(env.servers.calls).toEqual([]);
  });

  it("links, pins the relay's keys, registers recovery and runs the connector", async () => {
    const { cloud, servers, connector } = await linked();
    expect(servers.routes()).toEqual([
      "POST /api/v1/app/token", "POST /api/v1/app/relay-token", "POST /v1/environments/link", "GET /.well-known/jwks.json", "POST /v1/environments/recovery",
    ]);
    const link = servers.calls.find((c) => c.route.endsWith("/link"))!;
    expect(link.body).toEqual({ environmentId: ENV_ID, publicJwk: key.publicJwk, label: "Aker's Mac", platform: "darwin", port: 41_000 });
    expect(link.signed).toBe(true);
    expect(servers.calls.find((c) => c.route.endsWith("/recovery"))!.body).toEqual({ environmentId: ENV_ID, tunnelId: "tun-1", port: 41_000 });
    expect(connector.started).toHaveLength(1);
    expect(connector.started[0].env.TUNNEL_TOKEN).toBe("connector-1");
    expect(cloud.status()).toMatchObject({ enabled: true, linked: true, state: "online", hostname: HOST, connector: { source: "env", connections: 1, needsDownload: false } });
    expect(cloud.hostname).toBe(HOST);
    expect(cloud.linkedUserId).toBe("user-1");
    expect(cloud.relayIssuer).toBe("https://relay.coroslink.com");
  });

  it("keeps the connector token sealed and nothing secret in its plain file", async () => {
    const { dir } = await linked();
    const plain = fs.readFileSync(path.join(dir, "cloud.json"), "utf8");
    expect(plain).not.toContain("connector-1");
    expect(plain).not.toContain(APP_TOKEN);
    expect(fs.readFileSync(path.join(dir, "cloud-secrets.bin"), "utf8")).toMatch(/^sealed:/);
  });

  it("fetches the relay's keys again for an unknown kid, at most once a minute", async () => {
    const { cloud, servers, tick } = await linked();
    const jwksCalls = () => servers.calls.filter((c) => c.route.endsWith("jwks.json")).length;
    expect((await cloud.relayJwks()).map((k) => k.kid)).toEqual(["relay-1"]);
    expect((await cloud.relayJwks("relay-2")).map((k) => k.kid)).toEqual(["relay-1"]);
    expect(jwksCalls()).toBe(1);
    tick(61_000);
    expect((await cloud.relayJwks("relay-2")).map((k) => k.kid)).toEqual(["relay-2"]);
    expect(await cloud.relayJwks("relay-3")).toHaveLength(1);
    expect(jwksCalls()).toBe(2);
  });

  it("points the tunnel at a new port", async () => {
    const { cloud, servers, setPort } = await linked();
    setPort(41_777);
    await cloud.checkPort();
    expect(servers.calls.at(-1)).toMatchObject({ route: "POST relay.coroslink.com/v1/environments/recovery", body: { port: 41_777 } });
    const before = servers.calls.length;
    await cloud.checkPort();
    expect(servers.calls.length).toBe(before);
  });

  it("restarts the connector with a new token when the relay rebuilt the tunnel", async () => {
    const { cloud, servers, connector, setPort } = await linked();
    servers.rebuildTunnel();
    servers.answerRecovery(Response.json({ environmentId: ENV_ID, hostname: HOST, tunnelId: "tun-2", generation: 2, action: "reprovisioned", connectorToken: "connector-2" }));
    setPort(41_001);
    await cloud.checkPort();
    await until(() => connector.started.length === 2, "a restart");
    expect(connector.started[1].env.TUNNEL_TOKEN).toBe("connector-2");
    await until(() => cloud.status().state === "online", "online again");
    expect(connector.alive()).toBe(1);
  });

  it("reconnects at the next launch with recovery only", async () => {
    const first = await linked();
    await first.cloud.stop();
    const before = first.servers.calls.length;
    const again = first.make();
    await again.start();
    await until(() => again.status().state === "online", "online");
    expect(first.servers.routes().slice(before)).toEqual(["POST /v1/environments/recovery"]);
  });

  it("forgets a link the relay no longer has", async () => {
    const { cloud, servers, make } = await linked();
    await cloud.stop();
    servers.answerRecovery(Response.json({ error: { code: "environment_not_linked", message: "No." } }, { status: 404 }));
    const again = make();
    await again.start();
    expect(again.status()).toMatchObject({ enabled: false, linked: false, state: "error", hostname: null, message: expect.stringMatching(/unlinked/) });
    expect(await again.relayJwks("relay-1")).toEqual([]);
  });

  it("keeps running the stored connector when recovery fails", async () => {
    const { cloud, servers, make } = await linked();
    await cloud.stop();
    servers.answerRecovery(Response.json({ error: { code: "upstream_error", message: "Cloudflare is down." } }, { status: 502 }));
    const again = make();
    await again.start();
    await until(() => again.status().state === "online", "online");
    expect(again.status().linked).toBe(true);
  });

  it("unlinks and stops when switched off", async () => {
    const { cloud, servers, connector, dir } = await linked();
    await cloud.setEnabled(false);
    expect(servers.calls.at(-1)).toMatchObject({ route: "POST relay.coroslink.com/v1/environments/unlink", signed: true });
    expect(cloud.status()).toMatchObject({ enabled: false, linked: false, state: "off", hostname: null, signedIn: true });
    expect(connector.alive()).toBe(0);
    expect(fs.existsSync(path.join(dir, "cloud-secrets.bin"))).toBe(false);
    expect(await cloud.relayJwks("relay-1")).toEqual([]);
  });

  it("unlinks and stops when signed out", async () => {
    const { cloud, servers, connector } = await linked();
    await cloud.signOut();
    expect(servers.routes().slice(-2)).toEqual(["POST /v1/environments/unlink", "DELETE /api/v1/app/session"]);
    expect(cloud.status()).toMatchObject({ signedIn: false, enabled: false, linked: false, state: "off" });
    expect(connector.alive()).toBe(0);
  });

  it("links without a connector and offers the download", async () => {
    const env = setup(undefined, { env: { PATH: "" } });
    const cloud = env.make();
    await cloud.start();
    await signIn(cloud, env.opened);
    await cloud.setEnabled(true);
    expect(cloud.status()).toMatchObject({ linked: true, state: "offline", message: expect.stringMatching(/Download/), connector: { needsDownload: true, downloadBytes: 19_840_425 } });
    expect(env.connector.started).toHaveLength(0);
  });
});
