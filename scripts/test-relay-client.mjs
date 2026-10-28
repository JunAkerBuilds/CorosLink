import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  createDeviceKey,
  createFakeSecretBox,
  createHub,
  createProof,
  createRemoteDatabase,
  createSettings,
  jose,
  repoRoot,
  request,
  requireDist,
  waitFor
} from "./remote-test-support.mjs";

// electron/remote/cloud/: the relay client's signatures, link, recovery
// throttling, unlink and text-free activity against a stub relay that checks
// signatures the way relay/src/auth/environmentSignatures.ts does; then the
// environment server's POST /v1/relay/mint answering once the relay's keys
// are pinned. cloudflared is scripts/fixtures/fake-cloudflared.mjs.
// Run under Electron as Node (npm run test:relay-client).
const protocol = requireDist("./remote/cloud/relayProtocol.js");
const contract = requireDist("./remote/contract.js");
const { RelayClient, RelayRequestError, relayBaseUrl } = requireDist("./remote/cloud/relayClient.js");
const { CloudLink, ActivityThrottle, activityForCoachEvent } = requireDist("./remote/cloud/cloudLink.js");
const { LiveActivityFeed, entryWaitsForMember } = requireDist("./remote/cloud/liveActivityFeed.js");
const { RemoteServer } = requireDist("./remote/server.js");
const { RemoteAuth } = requireDist("./remote/auth.js");
const { loadOrCreateRemoteIdentity } = requireDist("./remote/identity.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("base64url");
const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-relay-client-test-"));

// ----- The copied contract matches relay/src/protocol.ts -----
{
  const candidates = [
    path.join(repoRoot, "relay", "src", "protocol.ts"),
    ...fs
      .readdirSync(path.resolve(repoRoot, ".."), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.resolve(repoRoot, "..", entry.name, "relay", "src", "protocol.ts"))
  ];
  const source = candidates.find((file) => fs.existsSync(file));
  if (!source) {
    console.log("relay/src/protocol.ts isn't checked out next to this one; skipped the drift check.");
  } else {
    const text = fs.readFileSync(source, "utf8");
    const constant = (name) => new RegExp(`export const ${name} = "([^"]+)"`).exec(text)?.[1];
    const list = (name) =>
      [...(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`).exec(text)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const regex = (name) => new RegExp(`export const ${name} = /(.+)/;`).exec(text)?.[1];
    assert.equal(protocol.ENVIRONMENT_SIGNATURE_HEADER, constant("ENVIRONMENT_SIGNATURE_HEADER"));
    assert.equal(protocol.ENVIRONMENT_SIGNATURE_TYP, constant("ENVIRONMENT_SIGNATURE_TYP"));
    assert.deepEqual([...protocol.ENVIRONMENT_OPERATIONS], list("ENVIRONMENT_OPERATIONS"));
    assert.deepEqual([...protocol.ACTIVITY_EVENTS], list("ACTIVITY_EVENTS"));
    assert.deepEqual([...protocol.LIVE_RUNNING_PHASES], list("LIVE_RUNNING_PHASES"));
    assert.deepEqual([...protocol.LIVE_FINAL_PHASES], list("LIVE_FINAL_PHASES"));
    assert.deepEqual([...protocol.LIVE_EVENTS], list("LIVE_EVENTS"));
    assert.equal(protocol.REQUEST_ID_PATTERN.source, regex("REQUEST_ID_PATTERN"));
    assert.match(text, new RegExp(`LIVE_UPDATE_MIN_INTERVAL_SECONDS = ${protocol.LIVE_UPDATE_MIN_INTERVAL_SECONDS};`));
    assert.match(text, /MAX_LIVE_WORDS = 1_000_000;/);
    assert.ok(text.includes("`POST /v1/activity/live`"), "live route");
    assert.equal(protocol.SESSION_ID_PATTERN.source, regex("SESSION_ID_PATTERN"));
    assert.equal(protocol.ENVIRONMENT_ID_PATTERN.source, regex("ENVIRONMENT_ID_PATTERN"));
    assert.match(text, new RegExp(`RECOVERY_MIN_INTERVAL_SECONDS = ${protocol.RECOVERY_MIN_INTERVAL_SECONDS};`));
    assert.match(text, new RegExp(`SIGNATURE_MAX_SKEW_SECONDS = ${protocol.SIGNATURE_MAX_SKEW_SECONDS};`));
    assert.equal(contract.RELAY_MINT_REQUEST_TYP, constant("RELAY_MINT_REQUEST_TYP"));
    assert.equal(contract.ENVIRONMENT_MINT_RESPONSE_TYP, constant("ENVIRONMENT_MINT_RESPONSE_TYP"));
    for (const name of ["link", "recovery", "unlink"]) {
      assert.ok(text.includes(`\`POST /v1/environments/${name}\``), `${name} route`);
    }
    // Relay nonces are 22-128 base64url characters.
    const signatures = path.join(path.dirname(source), "auth", "environmentSignatures.ts");
    if (fs.existsSync(signatures)) {
      const nonce = /const NONCE_PATTERN = \/(.+)\/u;/.exec(fs.readFileSync(signatures, "utf8"))?.[1];
      assert.ok(new RegExp(nonce).test("A".repeat(Math.ceil((protocol.ENVIRONMENT_NONCE_BYTES * 4) / 3))));
    }
    console.log(`checked against ${path.relative(path.resolve(repoRoot, ".."), source)}`);
  }
}

// ----- A stub relay -----

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
let clock = Date.now();
const now = () => clock;

async function createStubRelay() {
  const relayKeys = [];
  const addRelayKey = async (kid) => {
    const { publicKey, privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
    const jwk = await jose.exportJWK(publicKey);
    relayKeys.push({ kid, privateKey, jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" } });
  };
  await addRelayKey("relay-key-1");
  const state = {
    origin: "",
    published: ["relay-key-1"],
    links: new Map(),
    nonces: new Set(),
    calls: [],
    jwksFetches: 0,
    skewSeconds: 0,
    nextRecovery: null,
    tunnel: 1,
    hostname: "0123456789abcdef.coroslinkrelay.com"
  };
  const fail = (response, status, code, message, extra = {}) => {
    const { details, retryAfter } = extra;
    response.writeHead(status, { "Content-Type": "application/json", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) });
    response.end(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }));
  };
  const json = (response, value) => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));

  /** A port of verifyEnvironmentRequest: header, key, signature, aud/op/environmentId, nonce, iat, body hash. */
  async function verify(req, raw, op, resolveJwk) {
    const signature = req.headers[protocol.ENVIRONMENT_SIGNATURE_HEADER.toLowerCase()];
    if (!signature) throw [401, "invalid_signature", "missing"];
    const body = JSON.parse(raw);
    const header = jose.decodeProtectedHeader(signature);
    if (header.alg !== "ES256" || header.typ !== protocol.ENVIRONMENT_SIGNATURE_TYP || typeof header.kid !== "string") {
      throw [401, "invalid_signature", "header"];
    }
    assert.deepEqual(Object.keys(header).sort(), ["alg", "kid", "typ"]);
    const jwk = resolveJwk(body, header.kid);
    if (!jwk) throw [404, "environment_not_linked", "This computer is not linked to the relay."];
    const { payload } = await jose.compactVerify(signature, await jose.importJWK({ ...jwk }, "ES256"), { algorithms: ["ES256"] });
    const claims = JSON.parse(new TextDecoder().decode(payload));
    assert.deepEqual(Object.keys(claims).sort(), ["aud", "bodySha256", "environmentId", "iat", "nonce", "op"]);
    if (claims.aud !== state.origin || claims.op !== op || claims.environmentId !== body.environmentId) {
      throw [401, "invalid_signature", "different request"];
    }
    if (!NONCE_PATTERN.test(claims.nonce)) throw [401, "invalid_signature", "nonce"];
    const serverTime = Math.floor(clock / 1000) + state.skewSeconds;
    if (Math.abs(serverTime - claims.iat) > 60) {
      throw [401, "signature_stale", "Check the computer's clock.", { details: { serverTime } }];
    }
    if (claims.bodySha256 !== sha256(raw)) throw [401, "invalid_signature", "body"];
    if (state.nonces.has(`${body.environmentId}:${claims.nonce}`)) throw [401, "signature_replayed", "replayed"];
    state.nonces.add(`${body.environmentId}:${claims.nonce}`);
    return { body, claims };
  }

  const linkedKey = (body, kid) => {
    const link = state.links.get(body.environmentId);
    return link && link.kid === kid ? link.jwk : null;
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const call = {
        method: req.method,
        url: req.url,
        raw,
        authorization: req.headers.authorization,
        signature: req.headers[protocol.ENVIRONMENT_SIGNATURE_HEADER.toLowerCase()]
      };
      state.calls.push(call);
      try {
        if (req.method === "GET" && req.url === "/.well-known/jwks.json") {
          state.jwksFetches += 1;
          return json(res, { keys: relayKeys.filter((key) => state.published.includes(key.kid)).map((key) => key.jwk) });
        }
        if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "no");
        if (req.url === "/v1/environments/link") {
          if (!/^Bearer relay-token-\d+$/.test(req.headers.authorization ?? "")) return fail(res, 401, "invalid_token", "no token");
          // At link time the key comes from the body, and kid must be its RFC 7638 thumbprint.
          const thumbprint = (jwk) => sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
          const { body, claims } = await verify(req, raw, "environment.link", (candidate, kid) =>
            kid === thumbprint(candidate.publicJwk) ? candidate.publicJwk : null
          );
          call.claims = claims;
          call.body = body;
          state.links.set(body.environmentId, { jwk: body.publicJwk, kid: thumbprint(body.publicJwk), port: body.port });
          return json(res, {
            environmentId: body.environmentId,
            userId: "user-1",
            hostname: state.hostname,
            httpBaseUrl: `https://${state.hostname}`,
            tunnelId: `tunnel-${state.tunnel}`,
            connectorToken: `connector-token-${state.tunnel}`,
            generation: 1,
            keyThumbprint: state.links.get(body.environmentId).kid
          });
        }
        if (req.url === "/v1/environments/recovery") {
          const { body, claims } = await verify(req, raw, "environment.recovery", linkedKey);
          call.claims = claims;
          call.body = body;
          const next = state.nextRecovery;
          state.nextRecovery = null;
          if (next?.error) return fail(res, ...next.error);
          if (next?.reprovision) state.tunnel += 1;
          const current = `tunnel-${state.tunnel}`;
          return json(res, {
            environmentId: body.environmentId,
            hostname: state.hostname,
            httpBaseUrl: `https://${state.hostname}`,
            tunnelId: current,
            generation: 1 + state.tunnel,
            action: next?.reprovision ? "reprovisioned" : "unchanged",
            ...(body.tunnelId !== current ? { connectorToken: `connector-token-${state.tunnel}` } : {})
          });
        }
        if (req.url === "/v1/environments/unlink") {
          const { body, claims } = await verify(req, raw, "environment.unlink", linkedKey);
          call.claims = claims;
          state.links.delete(body.environmentId);
          return json(res, { environmentId: body.environmentId, unlinked: true, teardown: "complete" });
        }
        if (req.url === "/v1/activity") {
          const { body, claims } = await verify(req, raw, "environment.activity", linkedKey);
          call.claims = claims;
          call.body = body;
          return json(res, { sent: 1, failed: 0, removed: 0 });
        }
        if (req.url === "/v1/activity/live") {
          const { body, claims } = await verify(req, raw, "environment.live", linkedKey);
          call.claims = claims;
          call.body = body;
          return json(res, { sent: 1, failed: 0, removed: 0, skipped: 0 });
        }
        fail(res, 404, "not_found", "Not found.");
      } catch (error) {
        if (Array.isArray(error)) return fail(res, ...error);
        fail(res, 401, "invalid_signature", error instanceof Error ? error.message : String(error));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.origin = `http://127.0.0.1:${server.address().port}`;

  /** A mint request as the relay signs it (relay/src/connect.ts). */
  const mintRequest = async (environmentId, claims = {}, kid = "relay-key-1") => {
    const key = relayKeys.find((candidate) => candidate.kid === kid);
    const iat = Math.floor(Date.now() / 1000);
    return new jose.SignJWT({
      environmentId,
      userId: "user-1",
      jkt: claims.jkt,
      nonce: crypto.randomBytes(16).toString("base64url"),
      ...claims
    })
      .setProtectedHeader({ alg: "ES256", typ: "coroslink-relay-mint+jwt", kid })
      .setIssuer(state.origin)
      .setAudience(`coroslink-env:${environmentId}`)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 120)
      .sign(key.privateKey);
  };
  return { server, state, addRelayKey, mintRequest, calls: (url) => state.calls.filter((call) => call.url === url) };
}

const relay = await createStubRelay();

// ----- The fake connector -----
const logFile = path.join(root, "cloudflared.jsonl");
const fakeBinary = path.join(root, "bin", "cloudflared");
fs.mkdirSync(path.dirname(fakeBinary), { recursive: true });
fs.writeFileSync(
  fakeBinary,
  `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec '${process.execPath}' '${path.join(repoRoot, "scripts", "fixtures", "fake-cloudflared.mjs")}' "$@"\n`,
  { mode: 0o755 }
);
const connectorLog = () =>
  fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

// ----- The desktop side -----
const settings = createSettings();
const secrets = createFakeSecretBox();
const identity = loadOrCreateRemoteIdentity(settings, secrets);
const db = createRemoteDatabase();
const auth = new RemoteAuth({ database: () => db });
const { hub, stream } = createHub();
let relayTokens = 0;
let signedIn = true;
const account = {
  status: () => ({ signedIn, viewer: signedIn ? { handle: "aker", displayName: "Aker" } : null, signingIn: false }),
  get signedIn() {
    return signedIn;
  },
  relayToken: async () => `relay-token-${++relayTokens}`,
  forgetRelayToken: () => undefined,
  beginSignIn: async () => undefined,
  cancelSignIn: () => undefined,
  handleCallback: async () => undefined,
  signOut: async () => {
    signedIn = false;
  }
};
let cloud;
const relayTrust = () => {
  const saved = settings.get("remote.relayTrust");
  return saved ? JSON.parse(saved) : null;
};
const server = new RemoteServer({
  identity,
  auth,
  hub,
  descriptor: () => ({ name: "Test Mac", appVersion: "9.9.9", platform: "darwin" }),
  defaultProvider: () => "claude-code",
  port: 0,
  lanAddresses: () => [],
  tunnelHostname: () => settings.get("remote.tunnelHostname") || null,
  relayTrust,
  refreshRelayTrust: () => cloud.refreshRelayTrust(),
  pingIntervalMs: 60_000
});
await server.start();
const port = server.port;
let changes = 0;
/** The Live Activity feed's timers run on `clock`: `advanceLive` moves it and fires what's due. */
const liveTimers = [];
const liveScheduler = {
  setTimer: (run, ms) => {
    const timer = { run, at: clock + ms };
    liveTimers.push(timer);
    return timer;
  },
  clearTimer: (timer) => {
    const index = liveTimers.indexOf(timer);
    if (index >= 0) liveTimers.splice(index, 1);
  }
};
const advanceLive = (ms) => {
  clock += ms;
  for (const timer of liveTimers.filter((candidate) => candidate.at <= clock)) {
    liveScheduler.clearTimer(timer);
    timer.run();
  }
};
/** The connector's environment, read at each start, so a section can switch the fake's mode. */
const connectorEnv = { ...process.env, FAKE_CLOUDFLARED_LOG: logFile };
/** What the edge-port check finds, and the relay host and port each check tried. */
let edgeProbe = { tunnelPort: true, relay: true };
const probes = [];
cloud = new CloudLink({
  settings,
  secrets,
  account,
  relayUrl: relay.state.origin,
  environment: async () => ({ identity, port }),
  label: () => "Test Mac",
  platform: "darwin",
  arch: "arm64",
  userDataDir: root,
  now,
  findCloudflared: async () => ({ path: fakeBinary, source: "managed", version: "2026.10.5" }),
  downloadCloudflared: async () => {
    throw new Error("No downloads in this test.");
  },
  supervisor: { env: connectorEnv, restartDelayMs: () => 50 },
  probeEdge: async (target) => {
    probes.push(target);
    return edgeProbe;
  },
  liveActivity: liveScheduler,
  onChange: () => {
    changes += 1;
  }
});
hub.onEvent((frame) => cloud.noteCoachEvent(frame));

const tunnelHeaders = { Host: relay.state.hostname, "X-Forwarded-Proto": "https", "CF-Connecting-IP": "203.0.113.9" };
const mint = (body, headers = tunnelHeaders) => request(port, { method: "POST", path: "/v1/relay/mint", headers, body });

try {
  // ----- Relay URL -----
  assert.equal(relayBaseUrl({ isPackaged: true, override: "https://relay-dev.coroslink.com" }), "https://relay.coroslink.com");
  assert.equal(relayBaseUrl({ isPackaged: false, override: "https://relay-dev.coroslink.com/x" }), "https://relay-dev.coroslink.com");
  assert.equal(relayBaseUrl({ isPackaged: false, override: undefined }), "https://relay.coroslink.com");
  assert.equal(relayBaseUrl({ isPackaged: false, override: "http://127.0.0.1:8787" }), "http://127.0.0.1:8787");
  assert.throws(() => relayBaseUrl({ isPackaged: false, override: "http://relay.example" }), /https/);

  // ----- Not linked: off, and mint has nothing to answer with -----
  assert.equal(cloud.status().state, "off");
  assert.equal(cloud.status().linked, false);
  assert.equal(cloud.status().enabled, false, "linking stays off until turned on");
  assert.equal((await mint({ request: "x" }, { Host: `127.0.0.1:${port}` })).status, 404);
  assert.equal((await request(port, { path: "/v1/descriptor", headers: tunnelHeaders })).status, 403, "the tunnel host isn't allowed before linking");

  // ----- Link -----
  await cloud.setEnabled(true);
  assert.deepEqual(
    relay.state.calls.map((call) => call.url),
    ["/v1/environments/link", "/.well-known/jwks.json", "/v1/environments/recovery"],
    "link, pin the relay's keys, then recovery right away"
  );
  const [linkCall] = relay.calls("/v1/environments/link");
  assert.equal(linkCall.authorization, "Bearer relay-token-1");
  assert.deepEqual(linkCall.body, {
    environmentId: identity.environmentId,
    publicJwk: identity.publicJwk,
    label: "Test Mac",
    platform: "darwin",
    port
  });
  assert.equal(linkCall.claims.op, "environment.link");
  assert.equal(linkCall.claims.aud, relay.state.origin);
  assert.equal(linkCall.claims.bodySha256, sha256(linkCall.raw));
  assert.match(linkCall.claims.nonce, /^[A-Za-z0-9_-]{43}$/);
  const [firstRecovery] = relay.calls("/v1/environments/recovery");
  assert.deepEqual(firstRecovery.body, { environmentId: identity.environmentId, tunnelId: "tunnel-1", port });

  let status = cloud.status();
  assert.equal(status.linked, true);
  assert.equal(status.enabled, true);
  assert.equal(status.hostname, relay.state.hostname);
  assert.equal(settings.get("remote.tunnelHostname"), relay.state.hostname);
  assert.deepEqual(relayTrust().keys.map((key) => key.kid), ["relay-key-1"]);
  assert.equal(relayTrust().userId, "user-1");
  assert.equal(relayTrust().issuer, relay.state.origin);
  assert.ok(![...settings.values.values()].some((value) => value.includes("connector-token-1")), "connector token kept encrypted");

  await waitFor(() => cloud.status().state === "online", { message: "online" });
  const [firstStart] = connectorLog().filter((entry) => entry.event === "start");
  assert.equal(firstStart.tokenSha256, sha256Hex("connector-token-1"));
  assert.deepEqual(firstStart.argv, ["tunnel", "--no-autoupdate", "run"]);
  assert.ok(changes > 0);

  // ----- The descriptor's keyThumbprint is the key the relay linked -----
  {
    const thumbprint = await jose.calculateJwkThumbprint(linkCall.body.publicJwk, "sha256");
    const { protectedHeader } = await jose.compactVerify(
      linkCall.signature,
      await jose.importJWK({ ...linkCall.body.publicJwk }, "ES256")
    );
    assert.equal(protectedHeader.kid, thumbprint, "the link signature's kid is the RFC 7638 thumbprint of publicJwk");
    assert.equal(relay.state.links.get(identity.environmentId).kid, thumbprint, "what the relay reports as keyThumbprint");
    for (const headers of [{ Host: `127.0.0.1:${port}` }, tunnelHeaders]) {
      const descriptor = await request(port, { path: "/v1/descriptor", headers });
      assert.equal(descriptor.status, 200);
      assert.equal(descriptor.json.keyThumbprint, thumbprint, "LAN and tunnel descriptors carry the linked key's thumbprint");
    }
    assert.equal(JSON.parse(settings.get("remote.cloud.link")).keyThumbprint, thumbprint);
  }

  // ----- The tunnel host is allowed; mint answers with the pinned key -----
  {
    assert.equal((await request(port, { path: "/v1/descriptor", headers: tunnelHeaders })).status, 200);
    const device = await createDeviceKey();
    const minted = await mint({ request: await relay.mintRequest(identity.environmentId, { jkt: device.jkt }) });
    assert.equal(minted.status, 200, minted.text);
    const { credential, proof } = minted.json;
    const verified = await jose.compactVerify(proof, await jose.importJWK({ ...identity.publicJwk }, "ES256"));
    assert.deepEqual(verified.protectedHeader, { alg: "ES256", typ: "coroslink-env-mint+jws", kid: identity.kid });
    const proofClaims = JSON.parse(new TextDecoder().decode(verified.payload));
    assert.equal(proofClaims.environmentId, identity.environmentId);
    assert.equal(proofClaims.jkt, device.jkt);
    assert.equal(proofClaims.credentialSha256, sha256(credential));

    // The phone redeems it through the tunnel (https per X-Forwarded-Proto).
    const url = `https://${relay.state.hostname}/v1/auth/bootstrap`;
    const grant = await request(port, {
      method: "POST",
      path: "/v1/auth/bootstrap",
      headers: { ...tunnelHeaders, DPoP: await createProof(device, { url }) },
      body: { credential, label: "Aker's iPhone" }
    });
    assert.equal(grant.status, 200, grant.text);
    assert.ok(grant.json.sessionToken);

    // Someone else's account, or a key the relay doesn't publish, gets nothing.
    assert.equal((await mint({ request: await relay.mintRequest(identity.environmentId, { jkt: device.jkt, userId: "user-2" }) })).status, 401);
  }

  // ----- An unknown relay kid refetches the keys, at most once an hour -----
  {
    await relay.addRelayKey("relay-key-2");
    relay.state.published = ["relay-key-1", "relay-key-2"];
    const device = await createDeviceKey();
    const fetches = relay.state.jwksFetches;
    const rotated = () => relay.mintRequest(identity.environmentId, { jkt: device.jkt }, "relay-key-2");
    assert.equal((await mint({ request: await rotated() })).status, 401, "pinned keys are under an hour old: no refetch");
    assert.equal(relay.state.jwksFetches, fetches);
    clock += 61 * 60_000;
    assert.equal((await mint({ request: await rotated() })).status, 200, "an hour later the new key is fetched");
    assert.equal(relay.state.jwksFetches, fetches + 1);
    assert.deepEqual(relayTrust().keys.map((key) => key.kid), ["relay-key-1", "relay-key-2"]);
    await relay.addRelayKey("relay-key-3");
    assert.equal((await mint({ request: await relay.mintRequest(identity.environmentId, { jkt: device.jkt }, "relay-key-3") })).status, 401);
    assert.equal(relay.state.jwksFetches, fetches + 1, "and not again within the hour");
  }

  // ----- Recovery: at most once per 2 minutes -----
  {
    clock += 3 * 60_000;
    const before = relay.calls("/v1/environments/recovery").length;
    await cloud.recover("exit");
    assert.equal(relay.calls("/v1/environments/recovery").length, before + 1);
    await cloud.recover("exit");
    await cloud.recover("rejected");
    clock += 60_000;
    await cloud.recover("exit");
    assert.equal(relay.calls("/v1/environments/recovery").length, before + 1, "throttled inside 2 minutes");

    // cloudflared dies: restarted, and recovery asked once the window has passed.
    clock += 61_000;
    const starts = connectorLog().filter((entry) => entry.event === "start");
    process.kill(starts.at(-1).pid, "SIGKILL");
    await waitFor(() => relay.calls("/v1/environments/recovery").length === before + 2, { message: "recovery after exit" });
    await waitFor(() => connectorLog().filter((entry) => entry.event === "start").length === starts.length + 1, { message: "restart" });
    await waitFor(() => cloud.status().state === "online", { message: "online again" });

    // The relay rebuilt the tunnel: the new connector starts, then the old one stops.
    clock += 121_000;
    relay.state.nextRecovery = { reprovision: true };
    const running = connectorLog().filter((entry) => entry.event === "start").at(-1);
    await cloud.recover("rejected");
    await waitFor(
      () => connectorLog().some((entry) => entry.event === "start" && entry.tokenSha256 === sha256Hex("connector-token-2")),
      { message: "new connector" }
    );
    await waitFor(() => connectorLog().some((entry) => entry.event === "stop" && entry.pid === running.pid), { message: "old stopped" });
    const events = connectorLog().map((entry) => `${entry.pid}:${entry.event}`);
    const fresh = connectorLog().find((entry) => entry.tokenSha256 === sha256Hex("connector-token-2")).pid;
    assert.ok(events.indexOf(`${fresh}:registered`) < events.indexOf(`${running.pid}:stop`), events.join(" "));
    assert.equal(JSON.parse(settings.get("remote.cloud.link")).tunnelId, "tunnel-2");

    // Rate limited by the relay: nothing changes, the connector stays up.
    clock += 121_000;
    relay.state.nextRecovery = { error: [429, "rate_limited", "Slow down.", { retryAfter: 60 }] };
    await cloud.recover("exit");
    assert.equal(cloud.status().state, "online");
    assert.equal(cloud.status().message, undefined);
  }

  // ----- Activity: event names and the session id, never text -----
  {
    const activity = () => relay.calls("/v1/activity");
    assert.equal(activityForCoachEvent({ event: "turn.delta", sessionId: "s", seq: 1, data: { requestId: "r", delta: "x" } }), null);
    assert.equal(
      activityForCoachEvent({ event: "entry.appended", sessionId: "s", seq: 1, data: { index: 0, entry: { kind: "message", role: "assistant", content: "x" } } }),
      null
    );
    assert.equal(
      activityForCoachEvent({ event: "entry.appended", sessionId: "s", seq: 1, data: { index: 0, entry: { kind: "corosAction", preview: {} } } }),
      "approval"
    );

    // A real turn through the hub.
    const session = hub.createSession("claude-code");
    hub.send({ sessionId: session.id, clientMessageId: "m1", text: "My secret question about my knee" });
    const turn = stream.turns.at(-1);
    turn.send("chat:streamStart");
    turn.send("chat:streamToken", { delta: "A secret answer" });
    turn.send("chat:streamDone", { fullText: "A secret answer" });
    await waitFor(() => activity().length === 1, { message: "activity push" });
    assert.deepEqual(JSON.parse(activity()[0].raw), { environmentId: identity.environmentId, sessionId: session.id, event: "replied" });
    assert.equal(activity()[0].claims.op, "environment.activity");

    // Throttled per conversation; an approval may follow a reply.
    cloud.noteCoachEvent({ event: "turn.completed", sessionId: session.id, seq: 99, data: { requestId: "r" } });
    cloud.noteCoachEvent({ event: "entry.appended", sessionId: session.id, seq: 100, data: { index: 3, entry: { kind: "workoutDelete", preview: { title: "Secret tempo run" } } } });
    await waitFor(() => activity().length === 2, { message: "approval push" });
    assert.deepEqual(JSON.parse(activity()[1].raw), { environmentId: identity.environmentId, sessionId: session.id, event: "approval" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(activity().length, 2);
    for (const call of activity()) assert.ok(!/secret/i.test(call.raw), "no message text leaves the computer");

    const throttle = new ActivityThrottle(30_000, 3);
    assert.equal(throttle.allow("a", "replied", 0), true);
    assert.equal(throttle.allow("a", "replied", 10_000), false);
    assert.equal(throttle.allow("a", "approval", 11_000), true);
    assert.equal(throttle.allow("a", "approval", 12_000), false);
    assert.equal(throttle.allow("b", "replied", 13_000), true);
    assert.equal(throttle.allow("c", "replied", 14_000), false, "hourly cap");
    assert.equal(throttle.allow("c", "replied", 3_700_000), true);
  }

  // ----- Live Activity: the phase and a word count, never text or tool names -----
  {
    const session = hub.createSession("claude-code");
    // This conversation's reports only: the earlier turns' may still be landing.
    const live = () => relay.calls("/v1/activity/live").filter((call) => JSON.parse(call.raw).sessionId === session.id);
    const reports = () => live().map((call) => JSON.parse(call.raw));
    const before = 0;
    hub.send({ sessionId: session.id, clientMessageId: "live-1", text: "My secret question about my sleep" });
    const turn = stream.turns.at(-1);
    turn.send("chat:streamStart");
    turn.send("chat:streamInfo", { kind: "thinking", delta: "Secret reasoning" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(live().length, before, "the phone starts thinking; that needs no report");

    // A tool call goes at once: nothing was reported for this turn yet.
    turn.send("chat:streamInfo", { kind: "mcp", tool: "get_secret_sleep_scores", status: "call" });
    await waitFor(() => live().length === before + 1, { message: "tool report" });
    const base = { environmentId: identity.environmentId, sessionId: session.id, requestId: turn.requestId };
    assert.deepEqual(reports().at(-1), { ...base, event: "update", phase: "usingTool", words: 0 });
    assert.equal(live().at(-1).claims.op, "environment.live");

    // Writing within 10 s of the last report waits for it, and carries the newest count.
    turn.send("chat:streamToken", { delta: "Your secret sleep" });
    turn.send("chat:streamToken", { delta: " was short" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(live().length, before + 1);
    advanceLive(10_000);
    await waitFor(() => live().length === before + 2, { message: "writing report" });
    assert.deepEqual(reports().at(-1), { ...base, event: "update", phase: "writing", words: 5 });

    // A word count alone waits 30 s; the end goes at once and says the question waits for the member.
    turn.send("chat:streamToken", { delta: " last night.\n\nWhich night\tshould I compare?" });
    advanceLive(10_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(live().length, before + 2, "word counts wait 30 s");
    turn.send("chat:streamInfo", {
      kind: "coachPrompt",
      prompt: {
        promptId: "p1",
        question: "Secret question?",
        allowCustom: true,
        choices: [
          { id: "c1", label: "Tuesday", response: "Compare with Tuesday." },
          { id: "c2", label: "Last week", response: "Compare with last week." }
        ]
      }
    });
    turn.send("chat:streamDone", { fullText: "Your secret sleep was short last night.\n\nWhich night should I compare?" });
    await waitFor(() => live().length === before + 3, { message: "end report" });
    assert.deepEqual(reports().at(-1), { ...base, event: "end", phase: "needsYou", words: 12 });
    advanceLive(60_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(live().length, before + 3, "nothing after the end");
    for (const call of live()) assert.ok(!/secret|sleep_scores/i.test(call.raw), "no text or tool names leave the computer");

    // A failed turn ends failed.
    hub.send({ sessionId: session.id, clientMessageId: "live-2", text: "Again" });
    const failing = stream.turns.at(-1);
    failing.send("chat:streamError", { message: "The provider is down." });
    await waitFor(() => live().length === before + 4, { message: "failed end" });
    assert.deepEqual(reports().at(-1), { ...base, requestId: failing.requestId, event: "end", phase: "failed", words: 0 });
  }

  // ----- The feed on its own: approvals, coalescing, other turns -----
  {
    let at = 1_000_000;
    const timers = [];
    const sent = [];
    const feed = new LiveActivityFeed({
      send: async (report) => sent.push(report),
      now: () => at,
      setTimer: (run, ms) => {
        const timer = { run, at: at + ms };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer) => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      }
    });
    const advance = (ms) => {
      at += ms;
      for (const timer of timers.filter((candidate) => candidate.at <= at)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    let seq = 0;
    const frame = (event, data, sessionId = "s1") => feed.note({ event, sessionId, seq: ++seq, data });

    frame("turn.started", { requestId: "r1" });
    frame("turn.delta", { requestId: "r1", delta: "One" });
    frame("turn.tool", { requestId: "r1", tool: "a", status: "call" });
    frame("turn.tool", { requestId: "r1", status: "failed" });
    frame("turn.delta", { requestId: "r1", delta: " two" });
    frame("turn.delta", { requestId: "old", delta: " ignored words here" });
    await settle();
    assert.deepEqual(sent.map((report) => `${report.phase}:${report.words}`), ["writing:1"], "a tool call inside 10 s coalesces away");
    // Back to writing, only the word count changed: it waits 30 s from the last report.
    advance(10_000);
    await settle();
    assert.equal(sent.length, 1);
    advance(20_000);
    await settle();
    assert.deepEqual(sent.at(-1), { sessionId: "s1", requestId: "r1", event: "update", phase: "writing", words: 2 });

    // An approval card staged during the turn, then approved before it ended: replied.
    frame("entry.appended", { index: 4, entry: { kind: "corosAction", preview: { state: "pending" } } });
    frame("entry.updated", { index: 4, entry: { kind: "corosAction", preview: { state: "saved" } } });
    // An older card updated meanwhile doesn't count.
    frame("entry.updated", { index: 1, entry: { kind: "workoutDelete", preview: {} } });
    frame("turn.completed", { requestId: "r1" });
    await settle();
    assert.deepEqual(sent.at(-1), { sessionId: "s1", requestId: "r1", event: "end", phase: "replied", words: 2 });
    assert.equal(feed.followed, 0);
    assert.equal(timers.length, 0);

    // A card still waiting at the end: needsYou. Two conversations are followed apart.
    frame("turn.started", { requestId: "r2" });
    frame("turn.started", { requestId: "q1" }, "s2");
    frame("entry.appended", { index: 7, entry: { kind: "workoutEdit", preview: { state: "awaiting_confirmation" } } });
    frame("turn.completed", { requestId: "r2" });
    frame("turn.failed", { requestId: "q1", message: "x", authError: false }, "s2");
    await settle();
    assert.deepEqual(sent.slice(-2).map((report) => `${report.sessionId}:${report.phase}`), ["s1:needsYou", "s2:failed"]);

    assert.equal(entryWaitsForMember({ kind: "coachPrompt", prompt: { promptId: "p", question: "q", choices: [], allowCustom: true } }), true);
    assert.equal(entryWaitsForMember({ kind: "coachPrompt", prompt: { promptId: "p", question: "q", choices: [], allowCustom: true, answer: "Yes" } }), false);
    assert.equal(entryWaitsForMember({ kind: "workoutDelete", preview: {} }), true, "older cards without a state are pending");
    assert.equal(entryWaitsForMember({ kind: "planDraft", draft: { uploadedAt: 5 } }), false);
    assert.equal(entryWaitsForMember({ kind: "planDraft", draft: {} }), true);
    assert.equal(entryWaitsForMember({ kind: "message", role: "assistant", content: "x" }), false);
  }

  // ----- A stale clock is corrected from the relay's time -----
  {
    const client = new RelayClient({ baseUrl: relay.state.origin, identity, now });
    relay.state.skewSeconds = 600;
    const before = relay.calls("/v1/activity").length;
    assert.deepEqual(await client.activity({ sessionId: "clock-check", event: "replied" }), { sent: 1, failed: 0, removed: 0 });
    assert.equal(relay.calls("/v1/activity").length, before + 2, "one stale attempt, then a corrected one");
    assert.equal(relay.calls("/v1/activity").at(-1).claims.iat, Math.floor(clock / 1000) + 600);
    relay.state.skewSeconds = 0;
    await assert.rejects(client.activity({ sessionId: "bad id with spaces", event: "replied" }), /can't be sent/);
  }

  // ----- The signature covers exactly this body, this op, once -----
  {
    const client = new RelayClient({ baseUrl: relay.state.origin, identity, now });
    const body = JSON.stringify({ environmentId: identity.environmentId, sessionId: "sig-check", event: "replied" });
    const signature = await client.signRequest("environment.activity", body);
    const post = async (text, header = signature) => {
      const response = await fetch(`${relay.state.origin}/v1/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [protocol.ENVIRONMENT_SIGNATURE_HEADER]: header },
        body: text
      });
      return { status: response.status, code: (await response.json()).error?.code };
    };
    assert.deepEqual(await post(body.replace("replied", "approval")), { status: 401, code: "invalid_signature" }, "another body");
    assert.deepEqual(await post(body, await client.signRequest("environment.unlink", body)), { status: 401, code: "invalid_signature" }, "another op");
    assert.equal((await post(body)).status, 200);
    assert.deepEqual(await post(body), { status: 401, code: "signature_replayed" }, "the same nonce twice");
  }

  // ----- Every signature used a fresh nonce -----
  {
    const nonces = relay.state.calls.filter((call) => call.claims).map((call) => call.claims.nonce);
    assert.equal(new Set(nonces).size, nonces.length);
    assert.ok(nonces.length >= 8);
  }

  // ----- Switch off: the connector stops, the link and address stay -----
  {
    await cloud.setEnabled(false);
    assert.equal(cloud.status().state, "off");
    assert.equal(cloud.status().linked, true);
    assert.equal(cloud.connectorSnapshot().state, "stopped");
    await cloud.setEnabled(true);
    await waitFor(() => cloud.status().state === "online", { message: "back online" });
    assert.equal(relay.calls("/v1/environments/link").length, 1, "switching back on doesn't link again");
  }

  // ----- A network that blocks port 7844: the panel is told, until it connects -----
  {
    Object.assign(connectorEnv, {
      FAKE_CLOUDFLARED_MODE: "unreachable",
      FAKE_CLOUDFLARED_FAILURES: "4",
      FAKE_CLOUDFLARED_DELAY_MS: "60",
      FAKE_CLOUDFLARED_THEN: "register"
    });
    const relayUrl = new URL(relay.state.origin);
    edgeProbe = { tunnelPort: false, relay: true };
    await cloud.setEnabled(false);
    await cloud.setEnabled(true);
    await waitFor(() => cloud.status().connector.portBlocked, { message: "port blocked" });
    assert.equal(cloud.status().state, "offline", "never connected, but not left linking");
    assert.deepEqual(probes, [{ host: relayUrl.hostname, port: Number(relayUrl.port) }]);
    await waitFor(() => cloud.status().state === "online", { message: "online once out" });
    assert.equal(cloud.status().connector.portBlocked, false);
    assert.equal(probes.length, 1, "checked at most once a minute");

    // Nothing gets out at all: not a blocked port, so no such note.
    edgeProbe = { tunnelPort: false, relay: false };
    await cloud.setEnabled(false);
    await cloud.setEnabled(true);
    await waitFor(() => probes.length === 2, { message: "checked again after connecting" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cloud.status().connector.portBlocked, false);
    assert.equal(cloud.status().state, "linking");
    await waitFor(() => cloud.status().state === "online", { message: "online again" });
    for (const key of ["FAKE_CLOUDFLARED_MODE", "FAKE_CLOUDFLARED_FAILURES", "FAKE_CLOUDFLARED_DELAY_MS", "FAKE_CLOUDFLARED_THEN"]) {
      delete connectorEnv[key];
    }
  }

  // ----- Unlink -----
  {
    await cloud.unlink();
    const [unlinkCall] = relay.calls("/v1/environments/unlink");
    assert.deepEqual(JSON.parse(unlinkCall.raw), { environmentId: identity.environmentId });
    assert.equal(unlinkCall.claims.op, "environment.unlink");
    status = cloud.status();
    assert.equal(status.linked, false);
    assert.equal(status.enabled, false);
    assert.equal(status.hostname, null);
    assert.equal(cloud.connectorSnapshot().state, "stopped");
    assert.equal(settings.get("remote.relayTrust"), "");
    assert.equal((await request(port, { path: "/v1/descriptor", headers: tunnelHeaders })).status, 403);
    assert.equal((await mint({ request: "x" }, { Host: `127.0.0.1:${port}` })).status, 404, "unlinked: mint 404s again");
  }

  // ----- The relay forgot this computer: treated as unlinked -----
  {
    clock += 121_000;
    await cloud.setEnabled(true);
    await waitFor(() => cloud.status().state === "online", { message: "relinked" });
    relay.state.links.clear();
    clock += 121_000;
    await cloud.recover("exit");
    status = cloud.status();
    assert.equal(status.linked, false);
    assert.equal(status.state, "error");
    assert.match(status.message, /unlinked from your account/);
    assert.equal(cloud.connectorSnapshot().state, "stopped");
  }

  // ----- Signed out with nothing linked: the switch refuses -----
  {
    signedIn = false;
    await assert.rejects(cloud.setEnabled(true), /Sign in to watchfaces\.coroslink\.com first/);
    assert.equal(cloud.status().enabled, false);
  }

  // A relay error type the UI can read.
  assert.equal(new RelayRequestError(404, "environment_not_linked", "x").notLinked, true);

  console.log("relay client: ok");
} finally {
  await cloud.stop();
  await server.stop();
  hub.shutdown?.();
  relay.server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
