import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Training Hub request plumbing against the compiled build: recovering from a
// refused token, schedule-change notices, and empty plan lists. Settings,
// saved credentials and the network are stubbed.
const require = createRequire(import.meta.url);
const settings = new Map();
let credentials = () => null;
require.cache[require.resolve("../dist-electron/database.js")] = { exports: {
  getSetting: (key) => settings.get(key),
  setSetting: (key, value) => settings.set(key, value),
  deleteSettings: (keys) => keys.forEach((key) => settings.delete(key))
} };
require.cache[require.resolve("../dist-electron/corosCredentialStore.js")] = { exports: {
  getStoredCorosCredentials: () => credentials(),
  clearStoredCorosCredentials: () => undefined,
  hashCorosPassword: (password) => password,
  storeCorosCredentials: () => undefined
} };
const hub = require("../dist-electron/trainingHubService.js");

const BASE = "https://teamapi.coros.com";
function signIn(token) {
  settings.set("trainingHub.accessToken", token);
  settings.set("trainingHub.userId", "athlete");
  settings.set("trainingHub.regionId", "1");
  settings.set("trainingHub.baseUrl", BASE);
}

const requests = [];
let respond = () => ({ result: "0000", data: [] });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const request = { url: String(url), path: new URL(url).pathname, token: init.headers?.accesstoken };
  requests.push(request);
  return new Response(JSON.stringify(respond(request)), { status: 200 });
};
const refused = { result: "0101", message: "Access token is invalid" };
const library = (request) =>
  request.path === "/training/program/query" ? { result: "0000", data: [{ id: 7, name: "Lift" }] } : refused;

try {
  // ----- A refused token -----

  // Another request's re-login replaced the token meanwhile: retry with it,
  // without probing regions or signing in again.
  signIn("old-token");
  requests.length = 0;
  respond = (request) => {
    if (request.token === "old-token") {
      settings.set("trainingHub.accessToken", "new-token");
      return refused;
    }
    return library(request);
  };
  const recovered = await hub.queryLibraryWorkouts();
  assert.equal(recovered.workouts.length, 1);
  assert.deepEqual(requests.map((request) => request.token), ["old-token", "new-token"]);
  assert.equal(settings.get("trainingHub.accessToken"), "new-token", "the newer session stays");

  // No saved login: one request, no region probes, and the dead session is cleared.
  signIn("dead-token");
  requests.length = 0;
  respond = () => refused;
  await assert.rejects(hub.queryLibraryWorkouts(), /COROS session expired/);
  assert.equal(requests.length, 1, "a refused token is not probed in every region");
  assert.equal(settings.get("trainingHub.accessToken"), undefined);

  // A sign-in that lands while re-login fails is kept.
  signIn("dead-token");
  credentials = () => {
    settings.set("trainingHub.accessToken", "signed-in-again");
    return null;
  };
  await assert.rejects(hub.queryLibraryWorkouts(), /COROS session expired/);
  assert.equal(settings.get("trainingHub.accessToken"), "signed-in-again", "a newer session is never cleared");
  credentials = () => null;

  // A 404 still looks for the account's region, each probe on a timeout.
  signIn("good-token");
  requests.length = 0;
  respond = (request) =>
    request.url.startsWith("https://teameuapi.coros.com") ? { result: "0000", data: [] } : refused;
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), path: new URL(url).pathname, token: init.headers?.accesstoken, signal: init.signal };
    requests.push(request);
    if (request.url.startsWith(BASE) && request.path === "/training/program/query") {
      return new Response("", { status: 404, statusText: "Not Found" });
    }
    return new Response(JSON.stringify(respond(request)), { status: 200 });
  };
  await hub.queryLibraryWorkouts();
  assert.equal(settings.get("trainingHub.baseUrl"), "https://teameuapi.coros.com");
  assert.ok(
    requests.filter((request) => request.path !== "/training/program/query").every((request) => request.signal instanceof AbortSignal),
    "region probes carry a timeout"
  );

  // ----- Schedule changes -----
  signIn("good-token");
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), path: new URL(url).pathname });
    return new Response(JSON.stringify({ result: "0000" }), { status: 200 });
  };
  let changes = 0;
  hub.setScheduledWorkoutsChangedListener(() => {
    changes += 1;
  });
  const revision = hub.getScheduledWorkoutRevision();
  await hub.deactivateNativeTrainingPlan("plan-1");
  assert.equal(changes, 1, "a schedule write is announced");
  assert.notEqual(hub.getScheduledWorkoutRevision(), revision);
  await hub.deleteNativeTrainingPlan("plan-1");
  assert.equal(changes, 1, "a plan library write does not touch the schedule");
  hub.setScheduledWorkoutsChangedListener(null);

  // ----- Empty plan lists -----
  globalThis.fetch = async () => new Response(JSON.stringify({ result: "0000", data: null }), { status: 200 });
  assert.deepEqual(await hub.listActiveNativeTrainingPlanInstances(), []);
  assert.deepEqual(
    await hub.readNativeTrainingPlanEndpoint("/training/plan/query", { method: "POST", body: {} }),
    [],
    "COROS's null plan list is an empty list, not a failure"
  );
} finally {
  globalThis.fetch = realFetch;
}

console.log("training hub session tests passed (token recovery, region probe, schedule changes, empty plan lists)");
