import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Local-Only Mode privacy core: classifying COROS requests (reads pass,
// uploads are refused), the process-wide HTTP guards, the persisted mode,
// the activation lifecycle and the IPC registry. Runs against the compiled
// main-process modules (npm run build:electron first). Nothing here contacts
// the internet: requests that must pass are sent to a loopback server.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "dist-electron", file)).href);

const { NetworkPolicy, classifyCorosRequest, isCorosHost, isCorosDestination, isLocalOnlyNetworkError } = await load("privacy/networkPolicy.js");
const { installNodeNetworkGuards, networkGuardInternals } = await load("privacy/networkGuards.js");
const { DataModeStore } = await load("privacy/dataModeStore.js");
const { DataModeService } = await load("privacy/dataModeService.js");
const { classifyChannel, assertChannelAllowed, installIpcPolicyGate, REMOTE_FEATURE_RULES } = await load("privacy/remoteFeatures.js");

let passed = 0;
async function test(name, body) {
  try {
    await body();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const kind = (url, method = "POST", body) => classifyCorosRequest({ url, method, body }).kind;
const mcpCall = (name) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });

// ----- classification -----

await test("recognises COROS hosts and nothing else", () => {
  for (const host of ["coros.com", "teamapi.coros.com", "MCPUS.COROS.COM.", "x.coros.com.cn", "coros-s3.s3.us-west-2.amazonaws.com", "eu-coros.s3.amazonaws.com"]) {
    assert.equal(isCorosHost(host), true, host);
  }
  for (const host of ["coroslink.com", "relay.coroslink.com", "coroslink-assets.akerrules.ca", "notcoros.com", "coros.com.evil.example", "s3.amazonaws.com", "my-coros-s3.s3.amazonaws.com", "", undefined]) {
    assert.equal(isCorosHost(host), false, String(host));
  }
});

await test("COROS reads pass whatever their method", () => {
  for (const url of [
    "https://teamapi.coros.com/activity/query?size=50", "https://teamapi.coros.com/activity/detail/query",
    "https://teamapi.coros.com/activity/detail/download", "https://teamapi.coros.com/dashboard/query",
    "https://teamapi.coros.com/activity/fit/getImportSportList", "https://teamapi.coros.com/training/program/calculate",
    "https://api.coros.com/coros/user/login", "https://api.coros.com/user/profile", "https://api.coros.com/user/gear/query",
    "https://mapstatic.coros.com/openapi/tileMap/getMapPackage", "https://mcpus.coros.com/oauth/token",
    "https://mcpus.coros.com/.well-known/oauth-authorization-server", "https://mcpus.coros.com/register",
    "https://epo.coros.com/cep/query?r=1234567", "https://EPO.COROS.COM/CEP/QUERY"
  ]) assert.equal(kind(url), "read", url);
  // The satellite-file list (cep/query) and its ELPO, LTO and RTO downloads are reads, allowed in Local-Only Mode.
  const enforcing = new NetworkPolicy({ enforcing: true });
  for (const url of ["https://epo.coros.com/cep/query?r=1234567", "https://s3.coros.com/cep_v5/airoha_elpo_gps_glo_bds_gal_6day/20261020/ELPO_GPS_GLO_BDS_GAL_6day.DAT",
    "https://s3.coros.com/cep_v5/lto_7d/20261020/1792484223552/lto2_coros.dat", "https://s3.coros.com/cep_v5/rto/20261020/1792484222981/rto_coros.dat"]) {
    assert.equal(kind(url, "GET"), "read", url);
    assert.equal(enforcing.allowRequest({ url, method: "GET" }, "fetch").allowed, true, url);
  }
  assert.equal(kind("https://coros-s3.s3.amazonaws.com/fit/123.fit", "GET"), "read");
  assert.equal(kind("https://t.coros.com/share/watchface?id=1", "GET"), "read");
});

await test("every sign-in endpoint CorosLink calls is a read, two-step sign-in included", () => {
  // Signing in uploads no athlete data, and Local-Only Mode needs it once for the watch key.
  const source = fs.readFileSync(path.join(repoRoot, "electron/trainingHubService.ts"), "utf8");
  const paths = [...new Set([...source.matchAll(/[`"]\$\{[a-zA-Z.]+\}(\/account\/[a-zA-Z0-9/]+)[`"]/g)].map((match) => match[1]))].sort();
  assert.deepEqual(paths, ["/account/2fa/login/verify", "/account/captcha", "/account/login", "/account/query"]);
  for (const base of ["https://teamapi.coros.com", "https://teameuapi.coros.com", "https://teamcnapi.coros.com"]) {
    for (const pathName of paths) assert.equal(kind(`${base}${pathName}`, "POST"), "read", pathName);
  }
  const policy = new NetworkPolicy({ enforcing: true });
  assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/account/captcha", method: "POST" }, "fetch").allowed, true);
  assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/account/2fa/login/verify", method: "POST" }, "fetch").allowed, true);
  assert.equal(kind("https://teamapi.coros.com/account/2fa/settings/update", "POST"), "upload", "only the sign-in steps");
});

await test("a malformed escape or an unreadable URL never makes the policy throw", () => {
  for (const enforcing of [false, true]) {
    const policy = new NetworkPolicy({ enforcing });
    for (const url of ["https://tiles.s3.amazonaws.com/%zz", "https://s3.amazonaws.com/%E0%A4%A/k", "https://s3.us-west-2.amazonaws.com/%zz/x"]) {
      for (const method of ["GET", "PUT"]) {
        assert.deepEqual(policy.allowRequest({ url, method }, "fetch"), { allowed: true, kind: "not-coros", destination: "" }, `${method} ${url}`);
      }
    }
    // A COROS host still fails closed for a write, whatever its path holds.
    assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/%zz/fit/import", method: "POST" }, "fetch").allowed, !enforcing);
    // An object that throws while it is read: judged by host and method, never an exception.
    const exploding = (hostname) => ({ protocol: "https:", hostname, get pathname() { throw new URIError("URI malformed"); } });
    assert.deepEqual(policy.allowRequest({ url: exploding("teamapi.coros.com"), method: "POST" }, "fetch").allowed, !enforcing);
    assert.equal(policy.allowRequest({ url: exploding("teamapi.coros.com"), method: "GET" }, "fetch").allowed, true);
    assert.equal(policy.allowRequest({ url: exploding("example.com"), method: "POST" }, "fetch").allowed, true);
  }
  assert.equal(isCorosDestination("https://s3.amazonaws.com/eu-coros/x.zip"), true);
  assert.equal(isCorosDestination("https://s3.amazonaws.com/%zz"), false);
  assert.equal(isCorosDestination("not a url"), false);
});

await test("anything that sends data to COROS is an upload", () => {
  for (const url of [
    "https://teamapi.coros.com/activity/fit/import", "https://teamapi.coros.com/training/plan/add",
    "https://teamapi.coros.com/training/program/update", "https://teamapi.coros.com/training/program/delete",
    "https://teamapi.coros.com/training/schedule/update", "https://teamapi.coros.com/training/schedule/executeSubPlan",
    "https://teamapi.coros.com/training/plan/copy", "https://api.coros.com/user/gear/save",
    "https://api.coros.com/watchface/share/createLink", "https://api.coros.com/watchFaceTemplateUserCustom/saveOrUpdateV2",
    "https://faq.coros.com/openapi/oss/sts", "https://teamapi.coros.com/something/unknown",
    "https://epo.coros.com/epoAction!uploadSomething.do", "https://epo.coros.com/cep/upload", "https://epo.coros.com/cep/query/update"
  ]) assert.equal(kind(url), "upload", url);
  assert.equal(kind("https://coros-s3.s3.us-west-2.amazonaws.com/fit/123.zip", "PUT"), "upload");
  assert.equal(kind("https://s3.amazonaws.com/eu-coros/fit/123.zip", "PUT"), "upload");
  assert.equal(kind("https://teamapi.coros.com/something/unknown", "GET"), "read", "unknown GETs read");
});

await test("COROS MCP: query tools read, every other tool uploads", () => {
  const mcp = "https://mcpus.coros.com/mcp";
  assert.equal(kind(mcp, "POST", mcpCall("querySleepData")), "read");
  assert.equal(kind(mcp, "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })), "read");
  assert.equal(kind(mcp, "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })), "read");
  for (const tool of ["createScheduledWorkout", "updateTrainingPlan", "scheduleWorkout", "coros__createSingleWorkout", "unknownTool"]) {
    assert.equal(kind(mcp, "POST", mcpCall(tool)), "upload", tool);
  }
  assert.equal(kind(mcp, "POST", JSON.stringify([JSON.parse(mcpCall("querySleepData")), JSON.parse(mcpCall("createTrainingPlan"))])), "upload");
  assert.equal(kind(mcp, "POST", undefined), "upload", "an unreadable body is not assumed to be a read");
  assert.equal(kind(mcp, "GET"), "read", "the SSE stream only receives");
});

await test("other services are never classified, whatever they do", () => {
  for (const url of ["https://api.strava.com/api/v3/uploads", "https://fonts.googleapis.com/css2", "https://amp-api.music.apple.com/v1/me/library",
    "https://relay.coroslink.com/v1/push", "https://api.github.com/repos/x/releases"]) {
    assert.equal(kind(url), "not-coros", url);
  }
  assert.equal(kind("file:///Users/me/teamapi.coros.com/activity/fit/import"), "not-coros");
  assert.equal(kind("not a url"), "not-coros");
});

await test("the policy refuses uploads only while enforcing, and logs no queries", () => {
  const policy = new NetworkPolicy({ now: () => 42 });
  assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/training/plan/add?token=SECRET", method: "POST" }, "fetch").allowed, true);
  policy.enforce();
  assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/activity/query", method: "POST" }, "fetch").allowed, true);
  assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/training/plan/add?token=SECRET", method: "POST" }, "fetch").allowed, false);
  assert.deepEqual(policy.recentAttempts(), [{ at: 42, channel: "fetch", destination: "POST teamapi.coros.com/training/plan/add" }]);
  assert.equal(JSON.stringify(policy.recentAttempts()).includes("SECRET"), false);
  assert.equal(policy.blockedCount, 1);
});

// ----- process-wide guards -----

const policy = new NetworkPolicy();
installNodeNetworkGuards(policy);
installNodeNetworkGuards(policy); // idempotent

const requests = [];
const server = http.createServer((request, response) => {
  requests.push(`${request.method} ${request.headers.host?.replace(/:\d+$/, "")}${request.url}`);
  response.end("ok");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
// Every name resolves to the loopback server, so allowed COROS reads are proven without touching the internet.
const toLoopback = (_host, options, callback) => {
  if (typeof options === "function") callback = options;
  if (options?.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
  else callback(null, "127.0.0.1", 4);
};
function nodeRequest(host, pathName, method) {
  return new Promise((resolve) => {
    const request = http.request({ host, port, path: pathName, method, lookup: toLoopback }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.once("error", resolve);
    request.end(method === "POST" ? "{\"workout\":1}" : undefined);
  });
}

await test("connected mode lets uploads through", async () => {
  assert.equal(await nodeRequest("teamapi.coros.com", "/training/plan/add", "POST"), 200);
  assert.equal(policy.blockedCount, 0);
});

policy.enforce();
requests.length = 0;

await test("http.request: COROS uploads never leave; COROS reads and other hosts do", async () => {
  const refused = await nodeRequest("teamapi.coros.com", "/training/plan/add", "POST");
  assert.equal(isLocalOnlyNetworkError(refused), true);
  assert.equal(await nodeRequest("teamapi.coros.com", "/activity/query", "POST"), 200);
  assert.equal(await nodeRequest("www.strava.com", "/api/v3/uploads", "POST"), 200);
  assert.deepEqual(requests, ["POST teamapi.coros.com/activity/query", "POST www.strava.com/api/v3/uploads"], "the refused upload sent nothing");
  assert.deepEqual(networkGuardInternals.nodeRequestTarget(["https://api.coros.com/user/gear/save", { method: "POST" }], "https:"),
    { url: "https://api.coros.com/user/gear/save", method: "POST" });
});

await test("fetch refuses COROS uploads, including MCP write tools and S3 PUTs", async () => {
  await assert.rejects(fetch("https://teamapi.coros.com/activity/fit/import", { method: "POST", body: "{}" }), (error) => isLocalOnlyNetworkError(error));
  await assert.rejects(fetch("https://coros-s3.s3.us-west-2.amazonaws.com/a.zip", { method: "PUT", body: "zip" }), (error) => isLocalOnlyNetworkError(error));
  await assert.rejects(fetch(new Request("https://mcpus.coros.com/mcp", { method: "POST" }), { method: "POST", body: mcpCall("createTrainingPlan") }), (error) => isLocalOnlyNetworkError(error));
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/local`, { method: "POST", body: "x" })).text(), "ok");
  assert.ok(policy.recentAttempts().some((attempt) => attempt.destination === "POST mcpus.coros.com/mcp createTrainingPlan"));
});

await test("http.request: a raw IP or another path can't carry a COROS upload past the guard", async () => {
  requests.length = 0;
  const send = (make) => new Promise((resolve) => {
    const request = make();
    request.once("response", (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.once("error", resolve);
    request.end("{\"workout\":1}");
  });
  const upload = { host: "127.0.0.1", port, path: "/training/plan/add", method: "POST" };
  // The Host header (and the TLS server name taken from it) decides which COROS service answers.
  assert.equal(isLocalOnlyNetworkError(await send(() => http.request({ ...upload, headers: { Host: "teamapi.coros.com" } }))), true);
  assert.equal(isLocalOnlyNetworkError(await send(() => http.request(`http://127.0.0.1:${port}/training/plan/add`, { method: "POST", headers: { host: "teamapi.coros.com" } }))), true);
  assert.equal(isLocalOnlyNetworkError(await send(() => { const request = http.request(upload); request.setHeader("Host", "teamapi.coros.com"); return request; })), true);
  assert.equal(isLocalOnlyNetworkError(await send(() => http.request({ ...upload, servername: "teamapi.coros.com" }))), true);
  // A path starting with `//` is still a path on the COROS host, not another host.
  assert.equal(isLocalOnlyNetworkError(await send(() => http.request({ host: "teamapi.coros.com", port, path: "//elsewhere.example/training/plan/add", method: "POST", lookup: toLoopback }))), true);
  // An absolute-form target (through a proxy) is judged by the URL it names.
  assert.equal(isLocalOnlyNetworkError(await send(() => http.request({ ...upload, path: "https://teamapi.coros.com/training/plan/add" }))), true);
  // A proxy tunnel to COROS could carry anything.
  assert.equal(isLocalOnlyNetworkError(await send(() => http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "teamapi.coros.com:443" }))), true);
  assert.deepEqual(requests, [], "nothing reached the server");
  // Reads from COROS by IP, and other hosts' Host headers, still go.
  assert.equal(await send(() => http.request({ ...upload, path: "/activity/query", headers: { Host: "teamapi.coros.com" } })), 200);
  assert.equal(await send(() => http.request({ ...upload, headers: { Host: "www.strava.com" } })), 200);
  assert.equal(await send(() => { const request = http.request({ ...upload, path: "/activity/query" }); request.setHeader("Host", "teamapi.coros.com"); return request; }), 200);
  assert.deepEqual(networkGuardInternals.nodeRequestTarget([{ host: "teamapi.coros.com", path: "//elsewhere.example/x/add", method: "POST" }], "https:"),
    { url: "https://teamapi.coros.com//elsewhere.example/x/add", method: "POST" });
  requests.length = 0;
});

await test("http.request answers a malformed escape on S3 hosts instead of throwing", async () => {
  // Enforcing: the guard classifies the request. Not a COROS bucket, so it goes out (here to the loopback server).
  assert.equal(await nodeRequest("tiles.s3.amazonaws.com", "/%zz", "GET"), 200);
  assert.equal(await nodeRequest("x.s3.amazonaws.com", "/%E0%A4%A/k", "PUT"), 200);
});

await test("fetch follows redirects itself while enforcing, so no hop reaches a COROS upload", async () => {
  // A redirecting server on loopback, for the real fetch: the method and body rules of each status.
  const redirects = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const status = { "/r301": 301, "/r302": 302, "/r303": 303, "/r307": 307, "/r308": 308 }[request.url];
      if (status) { response.writeHead(status, { Location: "/echo" }); response.end(); return; }
      if (request.url === "/loop") { response.writeHead(302, { Location: "/loop" }); response.end(); return; }
      response.end(`${request.method} ${request.url} ${body}`);
    });
  });
  await new Promise((resolve) => redirects.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${redirects.address().port}`;
  try {
    const post = async (route) => (await fetch(`${base}${route}`, { method: "POST", body: "data" })).text();
    assert.equal(await post("/r307"), "POST /echo data", "307 resends the body");
    assert.equal(await post("/r308"), "POST /echo data");
    assert.equal(await post("/r303"), "GET /echo ", "303 becomes a GET without a body");
    assert.equal(await post("/r302"), "GET /echo ");
    assert.equal(await post("/r301"), "GET /echo ");
    const fromRequest = await fetch(new Request(`${base}/r307`, { method: "POST", body: "from a Request" }));
    assert.equal(await fromRequest.text(), "POST /echo from a Request");
    assert.equal(fromRequest.url, `${base}/echo`);
    const manual = await fetch(`${base}/r307`, { method: "POST", body: "data", redirect: "manual" });
    assert.equal(manual.status, 307, "a caller asking for redirects itself gets them");
    await assert.rejects(fetch(`${base}/loop`), /redirect/);
  } finally {
    redirects.close();
  }

  // Redirects to COROS, without any network: the guard wraps a stand-in fetch that records what would have gone out.
  const guardedRealFetch = globalThis.fetch;
  const sent = [];
  const routes = {
    "http://127.0.0.1/go": [307, "https://teamapi.coros.com/activity/fit/import"],
    "https://teamapi.coros.com/activity/query": [307, "/activity/fit/import"],
    "http://127.0.0.1/s3": [308, "https://coros-s3.s3.us-west-2.amazonaws.com/fit/1.zip"],
    "http://127.0.0.1/see-other": [303, "https://teamapi.coros.com/dashboard/query"],
    "http://127.0.0.1/cross": [307, "https://elsewhere.example/dest"]
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    sent.push({ url, method: init.method ?? "GET", body: init.body, redirect: init.redirect, authorization: new Headers(init.headers).get("authorization") });
    const route = routes[url];
    return route ? new Response(null, { status: route[0], headers: { location: route[1] } }) : new Response("ok");
  };
  const stubPolicy = new NetworkPolicy({ enforcing: true });
  installNodeNetworkGuards(stubPolicy);
  try {
    const upload = { method: "POST", body: "secret activity" };
    await assert.rejects(fetch("http://127.0.0.1/go", upload), (error) => isLocalOnlyNetworkError(error));
    await assert.rejects(fetch("https://teamapi.coros.com/activity/query", upload), (error) => isLocalOnlyNetworkError(error), "a COROS read redirected to an upload");
    await assert.rejects(fetch("http://127.0.0.1/s3", { method: "PUT", body: "zip" }), (error) => isLocalOnlyNetworkError(error));
    assert.equal(sent.some((request) => request.url.includes("fit/import") || request.url.includes("coros-s3")), false, "no upload hop was sent");
    assert.deepEqual(stubPolicy.recentAttempts().map((attempt) => attempt.destination),
      ["POST teamapi.coros.com/activity/fit/import", "POST teamapi.coros.com/activity/fit/import", "PUT coros-s3.s3.us-west-2.amazonaws.com/fit/1.zip"]);
    sent.length = 0;
    assert.equal(await (await fetch("http://127.0.0.1/see-other", upload)).text(), "ok", "303 to a COROS read is a GET, which may go");
    assert.deepEqual(sent.map((request) => [request.url, request.method, request.body, request.redirect]),
      [["http://127.0.0.1/see-other", "POST", "secret activity", "manual"], ["https://teamapi.coros.com/dashboard/query", "GET", undefined, "manual"]]);
    sent.length = 0;
    await fetch("http://127.0.0.1/cross", { method: "POST", body: "x", headers: { authorization: "Bearer T" } });
    assert.deepEqual(sent.map((request) => request.authorization), ["Bearer T", null], "credentials don't follow to another origin");
    stubPolicy.relaxForTesting();
    sent.length = 0;
    await fetch("http://127.0.0.1/go", upload);
    assert.deepEqual(sent.map((request) => request.redirect), [undefined], "Connected Mode leaves redirects to fetch");
  } finally {
    globalThis.fetch = guardedRealFetch;
  }
});

await test("enforcement aborts the signal attached to uploads in flight", () => {
  const live = new NetworkPolicy();
  const signal = live.abortSignal;
  live.enforce();
  assert.equal(signal.aborted, true);
  assert.equal(isLocalOnlyNetworkError(signal.reason), true);
});

server.close();

// ----- persisted mode -----

const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-privacy-"));
try {
  await test("data mode store defaults to connected and fails closed", () => {
    const file = path.join(root, "privacy", "data-mode.json");
    const store = new DataModeStore(file, () => new Date("2026-10-18T00:00:00Z"));
    assert.equal(store.load().mode, "connected");
    const saved = store.save("local_only");
    assert.deepEqual(store.load(), saved);
    assert.equal(fs.readdirSync(path.dirname(file)).length, 1, "no temp files left behind");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.writeFileSync(file, "{ truncated");
    assert.deepEqual({ mode: store.load().mode, recovered: store.load().recovered }, { mode: "local_only", recovered: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, mode: "cloud" }));
    assert.equal(store.load().mode, "local_only");
    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.equal(store.load().mode, "local_only", "an unreadable file is not treated as absent");
  });

  // ----- lifecycle -----

  function service(options = {}) {
    const store = options.store ?? new DataModeStore(path.join(root, `mode-${Math.random()}.json`));
    const lifecyclePolicy = new NetworkPolicy();
    const relaunches = [];
    const dataMode = new DataModeService({
      store, policy: lifecyclePolicy, initial: store.load(),
      relaunch: () => relaunches.push(Date.now())
    });
    return { store, lifecyclePolicy, relaunches, dataMode };
  }

  await test("activation enforces, persists, then forgets the chosen credentials", async () => {
    const { store, lifecyclePolicy, dataMode } = service();
    const order = [];
    const credentials = [];
    dataMode.setCredentialActions({
      forgetCloudSession: () => { order.push(`forget while enforcing=${lifecyclePolicy.enforcing} persisted=${store.load().mode}`); credentials.push("cloud"); },
      forgetWatchKey: () => credentials.push("watch")
    });
    const phases = [];
    dataMode.onChange((status) => phases.push(status.phase));
    const status = await dataMode.activateLocalOnly({ forgetCloudSession: true });
    assert.deepEqual(order, ["forget while enforcing=true persisted=local_only"], "a crash during clean-up still restarts in Local-Only Mode");
    assert.deepEqual(credentials, ["cloud"], "the watch key is retained by default");
    assert.equal(status.phase, "active");
    assert.deepEqual(phases, ["activating", "active"]);
  });

  await test("a failed save or credential clean-up leaves the mode enforced but degraded", async () => {
    const { lifecyclePolicy, dataMode } = service();
    dataMode.setCredentialActions({ forgetCloudSession: () => { throw new Error("keychain locked"); }, forgetWatchKey: () => undefined });
    const status = await dataMode.activateLocalOnly({ forgetCloudSession: true });
    assert.equal(status.phase, "degraded");
    assert.deepEqual(status.failedServices.map((failure) => failure.id), ["credentials"]);
    assert.equal(lifecyclePolicy.enforcing, true);

    const broken = new DataModeStore(path.join(root, "missing-dir", "x.json"));
    broken.save = () => { throw new Error("disk full"); };
    const failing = service({ store: broken });
    const failed = await failing.dataMode.activateLocalOnly();
    assert.equal(failed.phase, "degraded");
    assert.deepEqual(failed.failedServices.map((failure) => failure.id), ["persist"]);
    assert.equal(failing.lifecyclePolicy.enforcing, true);
  });

  await test("returning to Connected Mode persists and relaunches without relaxing in place", async () => {
    const { store, lifecyclePolicy, relaunches, dataMode } = service();
    await dataMode.activateLocalOnly();
    const status = await dataMode.returnToConnected();
    assert.equal(status.phase, "restart-required");
    assert.equal(store.load().mode, "connected");
    assert.equal(relaunches.length, 1);
    assert.equal(lifecyclePolicy.enforcing, true, "guards stay on until the relaunch");
  });

  await test("concurrent activations share one transition", async () => {
    const { dataMode } = service();
    let forgets = 0;
    dataMode.setCredentialActions({ forgetCloudSession: async () => { forgets += 1; }, forgetWatchKey: () => undefined });
    const [first, second] = await Promise.all([dataMode.activateLocalOnly({ forgetCloudSession: true }), dataMode.activateLocalOnly({ forgetCloudSession: true })]);
    assert.equal(forgets, 1);
    assert.deepEqual(first, second);
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// ----- IPC registry -----

await test("every registered IPC channel is classified", () => {
  const channels = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const source = fs.readFileSync(full, "utf8");
        for (const match of source.matchAll(/(?:ipcMain|handleTrusted)\.?(?:handle|on|handleOnce|once)?\(\s*"([^"]+)"/g)) channels.add(match[1]);
      }
    }
  };
  walk(path.join(repoRoot, "electron"));
  assert.ok(channels.size > 300, `found ${channels.size} channels`);
  assert.deepEqual([...channels].filter((channel) => !classifyChannel(channel).known), []);
});

await test("only features that upload to COROS are refused, and only while enforcing", () => {
  const off = { enforcing: false };
  const on = { enforcing: true };
  assert.doesNotThrow(() => assertChannelAllowed("coros:addManualActivity", off));
  assert.throws(() => assertChannelAllowed("coros:addManualActivity", on), /Local-Only Mode: .* would send your data to COROS/);
  for (const channel of ["coros:addManualActivity", "intervals:import", "gear:save", "watchfaces:publish", "workoutEdits:confirm", "chat:confirmCorosAction"]) {
    assert.throws(() => assertChannelAllowed(channel, on), /Local-Only Mode/, channel);
  }
  // The workout library and training calendar are served from this computer in Local-Only Mode.
  for (const channel of ["trainingHub:createLibraryWorkout", "trainingHub:removeScheduledWorkout", "trainingHub:uploadTrainingPlan", "chat:uploadPlanDraft",
    "coach:confirm", "trainingLibrary:addPlanToCalendar"]) {
    assert.equal(classifyChannel(channel).class, "routed", channel);
    assert.doesNotThrow(() => assertChannelAllowed(channel, on), channel);
  }
  for (const channel of ["trainingHub:getDashboard", "trainingHub:listActivities", "trainingHub:login", "chatMcp:connect", "mcp:connect",
    "watchfaces:login", "watchfaces:listThemes", "maps:downloadCorosPackage", "fitIndex:startSync", "gear:query", "strava:connect",
    "spotify:login", "app:checkForUpdates", "chat:send", "corosBle:connect", "intervals:listMissing"]) {
    assert.doesNotThrow(() => assertChannelAllowed(channel, on), channel);
  }
  assert.equal(classifyChannel("brandNew:thing").known, false);
  assert.ok(Object.keys(REMOTE_FEATURE_RULES).includes("dataMode"));
});

await test("the IPC gate wraps handlers registered after it", async () => {
  const handlers = new Map();
  const ipc = { handle: (channel, listener) => handlers.set(channel, listener) };
  const gatePolicy = { enforcing: false };
  const unknown = [];
  installIpcPolicyGate(ipc, gatePolicy, (channel) => unknown.push(channel));
  ipc.handle("gear:save", () => "saved");
  ipc.handle("gear:query", () => "gear");
  ipc.handle("mystery:call", () => "ok");
  assert.equal(await handlers.get("gear:save")({}), "saved");
  gatePolicy.enforcing = true;
  assert.throws(() => handlers.get("gear:save")({}), /Local-Only Mode/);
  assert.equal(await handlers.get("gear:query")({}), "gear");
  assert.deepEqual(unknown, ["mystery:call"]);
});

console.log(`local-only privacy: ${passed} checks passed`);
