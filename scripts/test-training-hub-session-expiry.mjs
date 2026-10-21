import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";

// A COROS session that stops working must end as "signed out, session expired"
// unless the saved login renews it, never as a connected but empty Training Hub.
// Network, database, credential store and error report are all mocked.
const repoRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const database = require(path.join(repoRoot, "dist-electron/database.js"));
const credentials = require(path.join(repoRoot, "dist-electron/corosCredentialStore.js"));
const diagnostics = require(path.join(repoRoot, "dist-electron/diagnosticsService.js"));
const {
  checkTrainingHubSession,
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubStatus,
  loginTrainingHub,
  logoutTrainingHub,
  onTrainingHubSessionChange
} = await import(
  pathToFileURL(path.join(repoRoot, "dist-electron", "trainingHubService.js")).href
);

const settings = new Map();
let savedCredentials = null;
mock.method(database, "getSetting", (key) => settings.get(key));
mock.method(database, "setSetting", (key, value) => settings.set(key, value));
mock.method(database, "deleteSettings", (keys) => keys.forEach((key) => settings.delete(key)));
mock.method(credentials, "getStoredCorosCredentials", () => savedCredentials);
mock.method(credentials, "storeCorosCredentials", (account, pwdHash) => {
  savedCredentials = { account, pwdHash };
  return true;
});
mock.method(credentials, "clearStoredCorosCredentials", () => {
  savedCredentials = null;
});
const recorded = [];
diagnostics.setDiagnosticRecorderForTests((source, error) => recorded.push({ source, error }));
let now = Date.now();
mock.method(Date, "now", () => now);

const success = (data) => Response.json({ result: "0000", data });
const failure = (result, message) => Response.json({ result, message });
const loginExpired = () => failure("1019", "Login expired, please log in again");
const twoFactorChallenge = () =>
  success({ loginTicket: "ticket", appKey: "key", account: "opaque", accountType2fa: 2, regionId: 1, userId: "42" });

const requests = [];
let respond;
mock.method(globalThis, "fetch", async (input, init = {}) => {
  const url = new URL(String(input));
  const token = init.headers?.accesstoken;
  requests.push({ path: url.pathname, token });
  return respond({ path: url.pathname, token });
});

const announced = [];
const stopListening = onTrainingHubSessionChange((status) => announced.push(status));

function signedInWith(token) {
  settings.clear();
  settings.set("trainingHub.accessToken", token);
  settings.set("trainingHub.userId", "42");
  settings.set("trainingHub.regionId", "1");
  settings.set("trainingHub.baseUrl", "https://teamapi.coros.com");
  savedCredentials = { account: "runner@example.com", pwdHash: "0123456789abcdef0123456789abcdef" };
  requests.length = 0;
  announced.length = 0;
  recorded.length = 0;
  // Each case starts outside the throttle windows of the previous one.
  now += 60 * 60_000;
}

// Reads for the fresh token succeed; everything else depends on the case.
function freshSession(path) {
  if (path === "/account/query") return success({ userId: "42" });
  if (path === "/activity/query") return success({ dataList: [] });
  return success({});
}

try {
  // 1. COROS answers "login expired" (1019); renewing needs the emailed code.
  // Parallel reads end in one announcement, and no code is emailed unasked.
  signedInWith("dead-token");
  respond = ({ path }) => (path === "/account/login" ? twoFactorChallenge() : loginExpired());
  const results = await Promise.allSettled([getTrainingDashboard(), getTrainingAnalytics()]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.ok(results.some((result) => /COROS session expired/.test(result.reason.message)));
  let status = getTrainingHubStatus();
  assert.equal(status.authenticated, false);
  assert.equal(status.sessionExpired, true);
  assert.equal(status.reloginNeedsCode, true);
  assert.equal(status.rememberCredentials, true, "Reconnect stays offered");
  assert.equal(announced.length, 1);
  assert.equal(announced[0].authenticated, false);
  assert.equal(announced[0].sessionExpired, true);
  assert.equal(requests.filter(({ path }) => path === "/account/captcha").length, 0);
  assert.equal(requests.filter(({ path }) => path === "/account/login").length, 1, "one shared re-login");
  assert.equal(requests.filter(({ path }) => path === "/activity/query").length, 0, "1019 skips the region probe");
  assert.ok(recorded.some(({ source }) => source === "trainingHub:session"));

  // Signing in again clears the expiry.
  respond = ({ path }) =>
    path === "/account/login" ? success({ accessToken: "fresh-token", userId: "42", regionId: 1 }) : freshSession(path);
  const relogin = await loginTrainingHub("runner@example.com", "test-password", true);
  assert.equal(relogin.status.authenticated, true);
  assert.equal(relogin.status.sessionExpired, undefined);
  assert.equal(settings.has("trainingHub.sessionExpired"), false);

  // 2. COROS keeps answering the dead token with empty successes. The check
  // renews it from the saved login and tells the window to reload.
  signedInWith("dead-token");
  respond = ({ path, token }) => {
    if (path === "/account/login") return success({ accessToken: "fresh-token", userId: "42", regionId: 1 });
    return token === "fresh-token" ? freshSession(path) : success(null);
  };
  await checkTrainingHubSession({ force: true });
  status = getTrainingHubStatus();
  assert.equal(status.authenticated, true);
  assert.equal(settings.get("trainingHub.accessToken"), "fresh-token");
  assert.equal(announced.length, 1);
  assert.equal(announced[0].authenticated, true);

  // A renewed token that also comes back empty ends the session: one login, no loop.
  signedInWith("dead-token");
  respond = ({ path }) =>
    path === "/account/login" ? success({ accessToken: "fresh-token", userId: "42", regionId: 1 }) : success(null);
  await checkTrainingHubSession({ force: true });
  status = getTrainingHubStatus();
  assert.equal(requests.filter(({ path }) => path === "/account/login").length, 1);
  assert.equal(status.authenticated, false);
  assert.equal(status.sessionExpired, true);
  assert.equal(status.reloginNeedsCode, false);
  assert.deepEqual(announced.map(({ authenticated }) => authenticated), [false]);

  // A sign-in that lands during the check is kept and used, never cleared.
  signedInWith("dead-token");
  respond = ({ path, token }) => {
    if (path === "/account/login") return assert.fail("must not log in over a newer session");
    if (token === "dead-token") {
      settings.set("trainingHub.accessToken", "signed-in-again");
      return success(null);
    }
    return freshSession(path);
  };
  await checkTrainingHubSession({ force: true });
  assert.equal(settings.get("trainingHub.accessToken"), "signed-in-again");
  assert.equal(getTrainingHubStatus().authenticated, true);

  // 3. Empty account, and the saved login needs the emailed code.
  signedInWith("dead-token");
  respond = ({ path }) => (path === "/account/login" ? twoFactorChallenge() : success(null));
  await checkTrainingHubSession({ force: true });
  status = getTrainingHubStatus();
  assert.equal(status.authenticated, false);
  assert.equal(status.reloginNeedsCode, true);
  assert.equal(announced.length, 1);
  assert.equal(requests.filter(({ path }) => path === "/account/captcha").length, 0);

  // Disconnecting forgets the expiry along with the account.
  assert.equal(logoutTrainingHub().sessionExpired, undefined);

  // 4. No saved login: the session ends without trying to log in.
  signedInWith("dead-token");
  savedCredentials = null;
  respond = ({ path }) => (path === "/account/login" ? assert.fail("no saved login") : success(null));
  await checkTrainingHubSession({ force: true });
  status = getTrainingHubStatus();
  assert.equal(status.sessionExpired, true);
  assert.equal(status.reloginNeedsCode, false);
  assert.equal(status.rememberCredentials, false);

  // 5. Signing out while the check renews the session keeps you signed out,
  // and nobody hears about an expired session.
  signedInWith("dead-token");
  respond = ({ path, token }) => {
    if (path === "/account/login") {
      logoutTrainingHub();
      return success({ accessToken: "fresh-token", userId: "42", regionId: 1 });
    }
    return token === "fresh-token" ? freshSession(path) : success(null);
  };
  await checkTrainingHubSession({ force: true });
  status = getTrainingHubStatus();
  assert.equal(status.authenticated, false);
  assert.equal(status.sessionExpired, undefined);
  assert.equal(settings.has("trainingHub.accessToken"), false, "the re-login's session isn't saved");
  assert.equal(announced.length, 0);
  assert.ok(!recorded.some(({ source }) => source === "trainingHub:session"));

  // Signing out while a re-login that needs the emailed code runs: not an expired session either.
  signedInWith("dead-token");
  respond = ({ path }) => {
    if (path === "/account/login") {
      logoutTrainingHub();
      return twoFactorChallenge();
    }
    return success(null);
  };
  await checkTrainingHubSession({ force: true });
  assert.equal(getTrainingHubStatus().sessionExpired, undefined);
  assert.equal(announced.length, 0);

  // Signing out while a read is refused: no login, and not an expired session.
  signedInWith("dead-token");
  respond = () => {
    logoutTrainingHub();
    return loginExpired();
  };
  await assert.rejects(getTrainingDashboard(), /Log in to COROS Training Hub first/);
  assert.equal(requests.filter(({ path }) => path === "/account/login").length, 0);
  assert.equal(getTrainingHubStatus().sessionExpired, undefined);
  assert.equal(announced.length, 0);

  // 6. A live session, an outage and being offline all stay signed in.
  for (const reply of [
    () => success({ userId: "42" }),
    () => failure("1001", "Service exceptions"),
    () => {
      throw new TypeError("fetch failed");
    }
  ]) {
    signedInWith("live-token");
    respond = ({ path }) => (path === "/account/login" ? assert.fail("must not log in") : reply());
    await checkTrainingHubSession({ force: true });
    assert.equal(getTrainingHubStatus().authenticated, true);
    assert.equal(announced.length, 0);
  }

  // 7. Checks are throttled, and a read that "succeeds" with no data prompts one.
  signedInWith("live-token");
  respond = () => success({ userId: "42" });
  await checkTrainingHubSession({ force: true });
  requests.length = 0;
  await checkTrainingHubSession();
  assert.equal(requests.length, 0, "a second check within a minute is skipped");
  now += 61_000;
  respond = ({ path }) => (path === "/account/query" ? success({ userId: "42" }) : success(null));
  await assert.rejects(getTrainingDashboard(), /succeeded but returned no data/);
  await checkTrainingHubSession();
  assert.ok(requests.some(({ path }) => path === "/account/query"), "the empty read started a check");
} finally {
  stopListening();
  diagnostics.setDiagnosticRecorderForTests();
  mock.restoreAll();
}

console.log("Training Hub session expiry tests passed");
