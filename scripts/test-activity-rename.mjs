import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";

// Renaming a recorded activity: POST /activity/update as Training Hub sends
// it, confirmed by reading the activity back, because COROS answers a dead
// token's write with the same empty success as a live one. Network, database,
// credential store and error report are all mocked.
const repoRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const database = require(path.join(repoRoot, "dist-electron/database.js"));
const credentials = require(path.join(repoRoot, "dist-electron/corosCredentialStore.js"));
const diagnostics = require(path.join(repoRoot, "dist-electron/diagnosticsService.js"));
const { renameTrainingHubActivity } = await import(
  pathToFileURL(path.join(repoRoot, "dist-electron", "trainingHubService.js")).href
);
const { ACTIVITY_NAME_MAX_BYTES, activityNameBytes, clipActivityName, normalizeActivityName } = await import(
  pathToFileURL(path.join(repoRoot, "dist-electron", "activityName.js")).href
);

// Names follow Training Hub's field: trimmed, never empty, at most 150 UTF-8 bytes.
assert.equal(normalizeActivityName("  Morning run  "), "Morning run");
assert.equal(normalizeActivityName("   "), undefined);
const long = "跑".repeat(60); // 3 bytes each
assert.equal(activityNameBytes(clipActivityName(long)), ACTIVITY_NAME_MAX_BYTES);
assert.equal(clipActivityName(long), "跑".repeat(50), "whole characters only");
assert.equal(clipActivityName(`${"a".repeat(149)}é`), "a".repeat(149), "never half a character");
assert.equal(clipActivityName("Tempo 🏃"), "Tempo 🏃");

const settings = new Map();
let savedCredentials = null;
mock.method(database, "getSetting", (key) => settings.get(key));
mock.method(database, "setSetting", (key, value) => settings.set(key, value));
mock.method(database, "deleteSettings", (keys) => keys.forEach((key) => settings.delete(key)));
const storedRenames = [];
mock.method(database, "renameStoredTrainingActivity", (activityId, name) => storedRenames.push({ activityId, name }));
mock.method(credentials, "getStoredCorosCredentials", () => savedCredentials);
mock.method(credentials, "storeCorosCredentials", (account, pwdHash) => {
  savedCredentials = { account, pwdHash };
  return true;
});
mock.method(credentials, "clearStoredCorosCredentials", () => {
  savedCredentials = null;
});
diagnostics.setDiagnosticRecorderForTests(() => {});
let now = Date.now();
mock.method(Date, "now", () => now);

const success = (data) => Response.json({ result: "0000", data });
const ACTIVITY = "471234567890123456";
const START = 1_792_666_800; // 2026-10-22 morning, epoch seconds as the list sends it
const names = new Map();

const requests = [];
let respond;
mock.method(globalThis, "fetch", async (input, init = {}) => {
  const url = new URL(String(input));
  const token = init.headers?.accesstoken;
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  requests.push({ path: url.pathname, token, body, query: Object.fromEntries(url.searchParams) });
  return respond({ path: url.pathname, token, body });
});

// A live session: the write lands and the list reports it.
function live({ path, body }) {
  if (path === "/activity/update") {
    names.set(body.labelId, body.name);
    return success(null);
  }
  if (path === "/activity/query") {
    return success({ dataList: [{ labelId: ACTIVITY, name: names.get(ACTIVITY), sportType: 100, startTime: START }] });
  }
  if (path === "/account/query") return success({ userId: "42" });
  return success({});
}

function signedInWith(token) {
  settings.clear();
  settings.set("trainingHub.accessToken", token);
  settings.set("trainingHub.userId", "42");
  settings.set("trainingHub.regionId", "1");
  settings.set("trainingHub.baseUrl", "https://teamapi.coros.com");
  savedCredentials = { account: "runner@example.com", pwdHash: "0123456789abcdef0123456789abcdef" };
  names.set(ACTIVITY, "Morning Run");
  requests.length = 0;
  storedRenames.length = 0;
  // Outside the session check's throttle and back-off windows.
  now += 48 * 60 * 60_000;
}

// 1. Live session: the name is trimmed, sent as Training Hub sends it, read back and stored.
signedInWith("live-token");
respond = live;
assert.equal(await renameTrainingHubActivity(ACTIVITY, "  Sunrise tempo  ", START), "Sunrise tempo");
const update = requests.find(({ path }) => path === "/activity/update");
assert.deepEqual(update.body, { labelId: ACTIVITY, name: "Sunrise tempo" });
const readBack = requests.find(({ path }) => path === "/activity/query");
assert.ok(readBack.query.startDay < readBack.query.endDay, "reads the days around the start");
assert.deepEqual(storedRenames, [{ activityId: ACTIVITY, name: "Sunrise tempo" }]);

// 2. COROS accepts the write but still lists the old name: report it, store nothing.
signedInWith("live-token");
respond = (request) => (request.path === "/activity/update" ? success(null) : live(request));
await assert.rejects(renameTrainingHubActivity(ACTIVITY, "Club run", START), /COROS didn't keep the new name/);
assert.deepEqual(storedRenames, []);

// 3. A dead token gets empty successes for the write and the read-back. The
// session check renews it from the saved login and the rename goes again.
signedInWith("dead-token");
respond = (request) => {
  if (request.path === "/account/login") return success({ accessToken: "fresh-token", userId: "42", regionId: 1 });
  return request.token === "fresh-token" ? live(request) : success(null);
};
assert.equal(await renameTrainingHubActivity(ACTIVITY, "Hill reps", START), "Hill reps");
const updates = requests.filter(({ path }) => path === "/activity/update");
assert.deepEqual(updates.map(({ token }) => token), ["dead-token", "fresh-token"]);
assert.equal(names.get(ACTIVITY), "Hill reps");
assert.deepEqual(storedRenames, [{ activityId: ACTIVITY, name: "Hill reps" }]);

// 4. Nothing to send: no request at all.
signedInWith("live-token");
respond = live;
await assert.rejects(renameTrainingHubActivity(ACTIVITY, "   ", START), /An activity needs a name/);
await assert.rejects(renameTrainingHubActivity(ACTIVITY, "x".repeat(151), START), /too long for COROS/);
assert.equal(requests.length, 0);

console.log("Activity rename passed: Training Hub payload, read-back, unkept name, renewed dead token, name rules.");
process.exit(0);
