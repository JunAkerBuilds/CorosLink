import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;
const database = await import(distUrl("database.js"));
const strava = await import(distUrl("stravaService.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-strava-test-"));
database.initializeDatabase(tempRoot);

let encryptionAvailable = true;
strava.setStravaCredentialStorageForTests({
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
});

// The fake browser: approve on Strava, which redirects to the loopback listener.
const realFetch = globalThis.fetch;
let grantedScope = "read,activity:read_all";
let lastAuthorizeUrl;
strava.setStravaUrlOpenerForTests(async (url) => {
  lastAuthorizeUrl = new URL(url);
  const callback = new URL(lastAuthorizeUrl.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", lastAuthorizeUrl.searchParams.get("state"));
  callback.searchParams.set("code", "auth-code");
  callback.searchParams.set("scope", grantedScope);
  await realFetch(callback);
});

const nowSec = Math.floor(Date.now() / 1000);
const isoDaysAgo = (days, hour = 12) => {
  const date = new Date((nowSec - days * 86_400) * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};
const gym = (id, daysAgo, extra = {}) => ({
  id,
  name: `Gym ${id}`,
  sport_type: "WeightTraining",
  type: "WeightTraining",
  start_date: isoDaysAgo(daysAgo),
  elapsed_time: 3600,
  moving_time: 3600,
  average_heartrate: 120,
  max_heartrate: 150,
  ...extra
});

let activities = [
  ...Array.from({ length: 20 }, (_, index) => gym(1000 + index, index + 1)),
  { id: 5000, name: "Easy run", sport_type: "Run", type: "Run", start_date: isoDaysAgo(2), elapsed_time: 1800 }
];
let tokenSerial = 1;
let expiresIn = 6 * 3600;
let refreshFailure = false;
let readUsage = 0;
let detailFailureId;
let listFailure;
let authorizeError;
const requests = [];
const revoked = [];

const rateHeaders = () => ({
  "content-type": "application/json",
  "x-ratelimit-limit": "200,2000",
  "x-ratelimit-usage": `${readUsage},${readUsage}`,
  "x-readratelimit-limit": "100,1000",
  "x-readratelimit-usage": `${readUsage},${readUsage}`
});

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  const body = init.body instanceof URLSearchParams ? init.body : undefined;
  requests.push({ url, method: init.method ?? "GET", body, headers: init.headers });

  if (url.pathname === "/oauth/authorize") {
    assert.equal(init.redirect, "manual", "the pre-check never follows Strava to its login page");
    return authorizeError
      ? Response.json(
          { message: "Bad Request", errors: [{ resource: "Application", field: authorizeError, code: "invalid" }] },
          { status: 400 }
        )
      : new Response(null, { status: 302, headers: { location: "https://www.strava.com/login" } });
  }
  if (url.pathname === "/oauth/token") {
    assert.equal(body.get("client_id"), "213543");
    assert.equal(body.get("client_secret"), "client-secret");
    if (body.get("grant_type") === "refresh_token" && refreshFailure) {
      return Response.json(
        {
          message: "Bad Request",
          errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }]
        },
        { status: 400 }
      );
    }
    if (body.get("grant_type") === "refresh_token") {
      assert.equal(body.get("refresh_token"), `refresh-${tokenSerial}`, "uses the latest rotated token");
    } else {
      assert.equal(body.get("code"), "auth-code");
    }
    tokenSerial += 1;
    return Response.json({
      token_type: "Bearer",
      access_token: `access-${tokenSerial}`,
      refresh_token: `refresh-${tokenSerial}`,
      expires_at: nowSec + expiresIn,
      expires_in: expiresIn,
      ...(body.get("grant_type") === "authorization_code"
        ? { athlete: { id: 42, firstname: "Ada", lastname: "Lovelace" }, scope: grantedScope.replace(/,/g, " ") }
        : {})
    });
  }
  if (url.pathname === "/oauth/revoke") {
    revoked.push({ token: body.get("token"), auth: init.headers.Authorization });
    return new Response(null, { status: 200 });
  }
  if (url.pathname === "/api/v3/athlete/activities") {
    assert.equal(init.headers.Authorization, `Bearer access-${tokenSerial}`);
    if (listFailure) return new Response("{}", { status: listFailure, headers: rateHeaders() });
    readUsage += 1;
    const after = Number(url.searchParams.get("after"));
    const perPage = Number(url.searchParams.get("per_page"));
    const page = Number(url.searchParams.get("page"));
    const inWindow = activities.filter((activity) => Date.parse(activity.start_date) / 1000 > after);
    return new Response(
      JSON.stringify(inWindow.slice((page - 1) * perPage, page * perPage)),
      { headers: rateHeaders() }
    );
  }
  const detailMatch = url.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
  if (detailMatch) {
    readUsage += 1;
    if (detailMatch[1] === detailFailureId) {
      return new Response("{}", { status: 404, headers: rateHeaders() });
    }
    const activity = activities.find((item) => String(item.id) === detailMatch[1]);
    return new Response(
      JSON.stringify({ ...activity, description: `Notes for ${activity.name}`, calories: 400 }),
      { headers: rateHeaders() }
    );
  }
  throw new Error(`Unexpected Strava request: ${init.method ?? "GET"} ${url}`);
};

const countRequests = (pathname) =>
  requests.filter((request) => request.url.pathname === pathname).length;
const detailRequests = () =>
  requests.filter((request) => /^\/api\/v3\/activities\/\d+$/.test(request.url.pathname)).length;

// --- Configuration ----------------------------------------------------------
assert.deepEqual(
  { configured: strava.getStravaStatus().configured, connected: strava.getStravaStatus().connected },
  { configured: false, connected: false }
);
assert.throws(() => strava.saveStravaConfig({ clientId: "abc", clientSecret: "x" }), /numeric Client ID/);
assert.throws(() => strava.saveStravaConfig({ clientId: "213543" }), /Client Secret/);
await assert.rejects(() => strava.connectStrava(), /Client ID and Client Secret first/);
const configured = strava.saveStravaConfig({ clientId: " 213543 ", clientSecret: " client-secret " });
assert.equal(configured.configured, true);
assert.equal(configured.clientId, "213543");
assert.ok(!database.getSetting("strava.secureState").includes("client-secret"), "secret is not stored in plain text");
assert.equal(
  strava.saveStravaConfig({ clientId: "213543", clientSecret: "" }).configured,
  true,
  "a blank secret keeps the saved one"
);

// --- Sign-in ------------------------------------------------------------------
lastAuthorizeUrl = undefined;
authorizeError = "client_id";
await assert.rejects(() => strava.connectStrava(), /does not recognise this Client ID/);
authorizeError = "redirect_uri";
await assert.rejects(() => strava.connectStrava(), /Authorization Callback Domain/);
assert.equal(lastAuthorizeUrl, undefined, "a rejected pre-check never opens the browser");
assert.equal(strava.getStravaStatus().connecting, false);
authorizeError = undefined;

grantedScope = "read";
await assert.rejects(() => strava.connectStrava(), /did not grant activity access/);
assert.equal(strava.getStravaStatus().connected, false);
assert.equal(strava.getStravaStatus().connecting, false);

grantedScope = "read,activity:read_all";
const connected = await strava.connectStrava();
assert.equal(connected.connected, true);
assert.equal(connected.displayName, "Ada Lovelace");
assert.equal(connected.athleteId, "42");
assert.equal(connected.canReadPrivate, true);
assert.equal(connected.profileUrl, "https://www.strava.com/athletes/42");
assert.equal(lastAuthorizeUrl.origin + lastAuthorizeUrl.pathname, "https://www.strava.com/oauth/authorize");
assert.equal(lastAuthorizeUrl.searchParams.get("scope"), "read,activity:read_all");
assert.equal(lastAuthorizeUrl.searchParams.get("response_type"), "code");
assert.match(lastAuthorizeUrl.searchParams.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
assert.ok(!database.getSetting("strava.secureState").includes("refresh-2"), "tokens are encrypted");

// --- First sync: list once, read details in a bounded batch -------------------
const first = await strava.syncStravaStrengthHistory(90, false);
assert.equal(first.sessions.length, 20, "the run is not a gym session");
assert.equal(first.fetched, 15, "details are read in batches");
assert.equal(first.pending, 5);
assert.equal(countRequests("/api/v3/athlete/activities"), 1, "200 per page covers the window");
assert.equal(
  requests.find((request) => request.url.pathname === "/api/v3/athlete/activities").url.searchParams.get("per_page"),
  "200"
);
assert.equal(first.sessions.filter((session) => session.strava.detailLoaded).length, 15);

const second = await strava.syncStravaStrengthHistory(90, false);
assert.equal(countRequests("/api/v3/athlete/activities"), 1, "a fresh listing is not repeated");
assert.equal(second.fetched, 5);
assert.equal(second.pending, 0);
assert.ok(second.sessions.every((session) => session.calories === 400));
assert.equal(second.sessions[0].strava.description, `Notes for ${second.sessions[0].name}`);

const third = await strava.syncStravaStrengthHistory(90, false);
assert.equal(third.fetched, 0, "nothing re-read once details are current");

// --- Forced refresh: re-list, reconcile, re-read changed and recent notes ------
activities = activities
  .filter((activity) => activity.id !== 1019)
  .map((activity) => (activity.id === 1010 ? { ...activity, name: "Renamed" } : activity));
const detailsBefore = detailRequests();
const forced = await strava.syncStravaStrengthHistory(90, true);
assert.equal(countRequests("/api/v3/athlete/activities"), 2);
assert.equal(forced.sessions.length, 19, "a deleted activity leaves the cache");
const reread = requests
  .slice(-(detailRequests() - detailsBefore))
  .map((request) => request.url.pathname.split("/").pop());
assert.ok(reread.includes("1010"), "a renamed activity re-reads its detail");
assert.ok(reread.includes("1000") && reread.includes("1001"), "recent notes are re-read");
assert.ok(!reread.includes("1015"), "older unchanged notes are left alone");

// --- A missing detail does not wedge the backlog ---------------------------------
activities = [...activities, gym(2000, 1), gym(2001, 1)];
detailFailureId = "2000";
const withMissing = await strava.syncStravaStrengthHistory(90, true);
assert.ok(withMissing.fetched >= 1);
assert.equal(withMissing.pending, 0, "an unreadable detail is skipped, not retried forever");
detailFailureId = undefined;

// --- Rate limit headroom defers details instead of spending the athlete's quota ---
activities = activities.map((activity) => ({ ...activity, name: `${activity.name}!` }));
readUsage = 95;
const deferred = await strava.syncStravaStrengthHistory(90, true);
assert.equal(deferred.fetched, 0);
assert.equal(deferred.pending, 0, "the view stops draining");
assert.match(deferred.notice, /limit is nearly used up/);
assert.equal(deferred.sessions.length, 21, "cached sessions still render");
readUsage = 0;

listFailure = 429;
await assert.rejects(() => strava.syncStravaStrengthHistory(90, true), /rate limit is used up/);
listFailure = undefined;

// --- Token refresh rotates and is shared ---------------------------------------
expiresIn = 60; // already inside the refresh margin
await strava.disconnectStrava();
await strava.connectStrava();
const serialAfterConnect = tokenSerial;
expiresIn = 6 * 3600;
await Promise.all([
  strava.syncStravaStrengthHistory(90, true),
  strava.syncStravaStrengthHistory(90, true)
]).catch(() => undefined);
assert.equal(tokenSerial, serialAfterConnect + 1, "concurrent requests share one refresh");

// --- A revoked grant signs out but keeps the API application ---------------------
expiresIn = 60;
await strava.disconnectStrava();
await strava.connectStrava();
refreshFailure = true;
await assert.rejects(() => strava.syncStravaStrengthHistory(90, true), /expired or was revoked/);
assert.equal(strava.getStravaStatus().connected, false);
assert.equal(strava.getStravaStatus().configured, true);
assert.equal(database.listStoredStravaActivities(0).length, 0, "a revoked grant erases the cache");
refreshFailure = false;
expiresIn = 6 * 3600;

// --- Disconnect revokes and erases ------------------------------------------------
await strava.connectStrava();
await strava.syncStravaStrengthHistory(90, true);
assert.ok(database.listStoredStravaActivities(0).length > 0);
const refreshBeforeDisconnect = `refresh-${tokenSerial}`;
await strava.disconnectStrava();
assert.equal(revoked.at(-1).token, refreshBeforeDisconnect);
assert.equal(
  revoked.at(-1).auth,
  `Basic ${Buffer.from("213543:client-secret").toString("base64")}`
);
assert.equal(strava.getStravaStatus().connected, false);
assert.equal(strava.getStravaStatus().configured, true, "the API application stays saved");
assert.equal(database.listStoredStravaActivities(0).length, 0);
assert.equal(database.getSetting("strava.athlete"), undefined);

// --- A different API application drops the old grant ------------------------------
await strava.connectStrava();
strava.saveStravaConfig({ clientId: "999", clientSecret: "other" });
assert.equal(strava.getStravaStatus().connected, false);
assert.equal(strava.getStravaStatus().clientId, "999");

encryptionAvailable = false;
assert.throws(
  () => strava.saveStravaConfig({ clientId: "213543", clientSecret: "client-secret" }),
  /Secure credential storage/
);
encryptionAvailable = true;

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("strava-service tests passed");
