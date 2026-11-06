import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { CancellationToken, CancellationError } = require("builder-util-runtime");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function loadUpdater({ autoCheck = false, setTimeout: scheduleTimer = setTimeout, clearTimeout: cancelTimer = clearTimeout } = {}) {
  const updater = new EventEmitter();
  const requests = [];
  updater.downloadUpdate = (token) =>
    new Promise((resolve, reject) => requests.push({ token, resolve, reject }));
  const settings = new Map([
    ["updater.autoCheck", String(autoCheck)],
    ["updater.autoDownload", "true"]
  ]);
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(new URL("../dist-electron/updaterService.js", import.meta.url), "utf8"),
    {
      module,
      exports: module.exports,
      process: { env: {}, platform: "darwin", execPath: process.execPath },
      setTimeout: scheduleTimer,
      clearTimeout: cancelTimer,
      setImmediate,
      require(name) {
        if (name === "electron") return {
          app: { isPackaged: true, getVersion: () => "0.1.49", getPath: () => "/unused" }
        };
        if (name === "electron-updater") return { autoUpdater: updater, CancellationToken };
        if (name === "./database") return {
          getSetting: (key) => settings.get(key),
          setSetting: (key, value) => settings.set(key, value)
        };
        // Updater startup must never touch the user's real cache in this test.
        if (name === "node:fs") return { promises: {
          readFile: async () => { throw new Error("No cached update"); },
          rm: async () => {}
        } };
        if (name === "node:child_process") return { execFileSync: () => "Authority=Test" };
        return require(name);
      }
    }
  );
  const api = module.exports;
  api.initializeAppUpdater({ isDestroyed: () => false, webContents: { send() {} } });
  return { api, updater, requests };
}

function createUpdater() {
  const { api, updater, requests } = loadUpdater();
  updater.emit("update-available", { version: "0.1.50", releaseNotes: "" });
  assert.equal(requests.length, 1);
  return { api, updater, requests };
}

{
  const { api, updater, requests } = createUpdater();
  api.setUpdaterPreferences({ autoDownload: false });
  assert.equal(requests[0].token.cancelled, true);
  api.setUpdaterPreferences({ autoDownload: true });
  api.setUpdaterPreferences({ autoDownload: false });
  requests[0].reject(new CancellationError());
  await flush();
  assert.equal(requests.length, 1, "off → on → off must invalidate the queued restart");
  assert.equal(api.getAppUpdateSnapshot().autoDownload, false);
  assert.equal(api.getAppUpdateSnapshot().status, "available");
  updater.emit("download-progress", { percent: 50 });
  assert.equal(api.getAppUpdateSnapshot().status, "available", "late progress stays ignored");

  const manual = api.downloadAppUpdate();
  assert.equal(requests.length, 2, "a later manual download works while automatic downloads are off");
  assert.equal(requests[1].token.cancelled, false);
  updater.emit("download-progress", { percent: 25 });
  assert.equal(api.getAppUpdateSnapshot().downloadPercent, 25);
  updater.emit("update-downloaded", { version: "0.1.50" });
  requests[1].resolve([]);
  assert.equal((await manual).status, "downloaded");
}

{
  const { api, requests } = createUpdater();
  api.setUpdaterPreferences({ autoDownload: false });
  api.setUpdaterPreferences({ autoDownload: true });
  api.setUpdaterPreferences({ autoDownload: false });
  api.setUpdaterPreferences({ autoDownload: true });
  requests[0].reject(new CancellationError());
  await flush();
  assert.equal(requests.length, 2, "the latest enable request restarts once after cancellation");
  assert.equal(api.getAppUpdateSnapshot().autoDownload, true);
  requests[1].resolve([]);
  await flush();
}

function httpError(statusCode) {
  // Same shape as builder-util-runtime's HttpError, digits in a header included.
  return Object.assign(
    new Error(`${statusCode} "method: GET url: https://github.com/x/y/releases.atom"\nHeaders: {"set-cookie":["_gh_sess=secret404"]}`),
    { statusCode, code: `HTTP_ERROR_${statusCode}` }
  );
}

function createFakeClock() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async fireNext(expectedDelay) {
      assert.equal(timers.size, 1, "exactly one check is scheduled");
      const [[id, timer]] = timers;
      assert.equal(timer.delay, expectedDelay);
      timers.delete(id);
      timer.callback();
      await flush();
    }
  };
}

function loadFailingChecks(clock, responses) {
  const loaded = loadUpdater({
    autoCheck: true,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  const state = { checks: 0 };
  loaded.updater.checkForUpdates = async () => {
    const response = responses[state.checks++];
    if (response) throw response;
    return null;
  };
  return { ...loaded, state };
}

{
  // A 529 on the feed: a short message, no headers, and two quiet retries.
  const clock = createFakeClock();
  const { api, state } = loadFailingChecks(clock, [httpError(529), httpError(503), httpError(529), httpError(529)]);
  await clock.fireNext(5000);
  assert.equal(state.checks, 1);
  const { status, error } = api.getAppUpdateSnapshot();
  assert.equal(status, "error");
  assert.equal(error, "GitHub is busy right now (HTTP 529). Try again in a few minutes.");
  await clock.fireNext(60_000);
  await clock.fireNext(300_000);
  assert.equal(state.checks, 3);
  assert.equal(clock.timers.size, 0, "retries stop after the last delay");
}

{
  // A check the user starts replaces the waiting retry.
  const clock = createFakeClock();
  const { api, state } = loadFailingChecks(clock, [httpError(529), undefined]);
  await clock.fireNext(5000);
  assert.equal(clock.timers.size, 1);
  await api.checkForAppUpdates();
  assert.equal(state.checks, 2);
  assert.equal(clock.timers.size, 0);
}

{
  // Turning automatic checks off cancels the waiting retry.
  const clock = createFakeClock();
  const { api } = loadFailingChecks(clock, [httpError(529)]);
  await clock.fireNext(5000);
  api.setUpdaterPreferences({ autoCheck: false });
  assert.equal(clock.timers.size, 0);
}

{
  // Lasting failures are not retried, and "404" in a header is not a 404.
  const clock = createFakeClock();
  const { api } = loadFailingChecks(clock, [httpError(403)]);
  await clock.fireNext(5000);
  assert.equal(api.getAppUpdateSnapshot().error, "GitHub could not provide the update (HTTP 403). Try again later.");
  assert.equal(clock.timers.size, 0);
}

{
  // A real missing release still points at the release page.
  const clock = createFakeClock();
  const { api } = loadFailingChecks(clock, [
    Object.assign(new Error("Cannot find latest-mac.yml"), { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" })
  ]);
  await clock.fireNext(5000);
  assert.match(api.getAppUpdateSnapshot().error, /^Update download failed\. .*releases\/latest$/);
  assert.equal(clock.timers.size, 0);
}

{
  // electron-updater wraps a busy /releases/latest as "latest version not found": still busy, still retried.
  const clock = createFakeClock();
  const wrapped = (statusCode) => Object.assign(
    new Error(`Unable to find latest version on GitHub (https://github.com/x/y/releases/latest), please ensure a production release exists: ${httpError(statusCode).stack}`),
    { code: "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" }
  );
  const { api, state } = loadFailingChecks(clock, [wrapped(503), undefined]);
  await clock.fireNext(5000);
  assert.equal(api.getAppUpdateSnapshot().error, "GitHub is busy right now (HTTP 503). Try again in a few minutes.");
  await clock.fireNext(60_000);
  assert.equal(state.checks, 2);
}

console.log("App updater cancellation, queued requests, manual downloads and feed failures passed.");
