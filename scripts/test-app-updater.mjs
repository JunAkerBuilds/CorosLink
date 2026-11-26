import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { CancellationToken, CancellationError } = require("builder-util-runtime");
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Mirrors electron-updater's AppUpdater: setting channel turns allowDowngrade on, and a set channel can't be cleared. */
function createUpdaterMock() {
  const updater = new EventEmitter();
  let channel = null;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.channelWrites = [];
  Object.defineProperty(updater, "channel", {
    get: () => channel,
    set(value) {
      if (channel != null && (typeof value !== "string" || value.length === 0)) {
        throw new Error(`Channel must be a string, but got: ${value}`);
      }
      channel = value;
      updater.channelWrites.push(value);
      updater.allowDowngrade = true;
    }
  });
  return updater;
}

function loadUpdater({
  autoCheck = false,
  setTimeout: scheduleTimer = setTimeout,
  clearTimeout: cancelTimer = clearTimeout,
  platform = "darwin",
  isPackaged = true,
  extraSettings = []
} = {}) {
  const updater = createUpdaterMock();
  const requests = [];
  updater.downloadUpdate = (token) =>
    new Promise((resolve, reject) => requests.push({ token, resolve, reject }));
  const settings = new Map([
    ["updater.autoCheck", String(autoCheck)],
    ["updater.autoDownload", "true"],
    ...extraSettings
  ]);
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(new URL("../dist-electron/updaterService.js", import.meta.url), "utf8"),
    {
      module,
      exports: module.exports,
      process: { env: {}, platform, execPath: process.execPath },
      setTimeout: scheduleTimer,
      clearTimeout: cancelTimer,
      setImmediate,
      require(name) {
        if (name === "electron") return {
          app: { isPackaged, getVersion: () => "0.1.49", getPath: () => "/unused" }
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
  return { api, updater, requests, settings };
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

{
  // Legacy (the default) leaves electron-updater exactly as it starts:
  // no channel, no prereleases, so /releases/latest and latest-mac.yml.
  for (const platform of ["darwin", "win32", "linux"]) {
    const { api, updater } = loadUpdater({ platform });
    assert.equal(updater.channel, null, `${platform}: legacy sets no channel`);
    assert.deepEqual(updater.channelWrites, []);
    assert.equal(updater.allowPrerelease, false);
    assert.equal(updater.allowDowngrade, false);
    assert.equal(api.getAppUpdateSnapshot().track, "legacy");
    assert.equal(api.getAppUpdateSnapshot().clinkOfferAnswered, false);
  }
}

{
  // A saved "clink" track follows the C-LINK beta prereleases from startup, on every platform.
  for (const platform of ["darwin", "win32", "linux"]) {
    const { api, updater } = loadUpdater({ platform, extraSettings: [["updater.track", "clink"]] });
    assert.equal(updater.channel, "clink", `${platform}: clink channel`);
    assert.equal(updater.allowPrerelease, true);
    assert.equal(updater.allowDowngrade, false, "set after channel, which turns it on");
    assert.equal(api.getAppUpdateSnapshot().track, "clink");
  }
}

{
  // Windows and Linux can switch to C-LINK too (C-LINK betas ship clink.yml and clink-linux.yml).
  for (const platform of ["win32", "linux"]) {
    const { api, updater, settings } = loadUpdater({ platform });
    let checked = false;
    updater.checkForUpdates = async () => { checked = true; return null; };
    const snapshot = await api.setUpdateTrack("clink");
    assert.equal(snapshot.track, "clink", `${platform}: switched`);
    assert.equal(settings.get("updater.track"), "clink");
    assert.equal(updater.channel, "clink");
    assert.ok(checked, `${platform}: checks the beta at once`);
  }
}

{
  // Switching to C-LINK saves the track, answers the offer and checks the beta at once;
  // a beta found there downloads through the usual flow.
  const { api, updater, requests, settings } = loadUpdater();
  let checks = 0;
  let channelAtCheck;
  updater.checkForUpdates = async () => {
    checks += 1;
    channelAtCheck = [updater.channel, updater.allowPrerelease, updater.allowDowngrade];
    updater.emit("update-available", { version: "0.2.0-clink.1", releaseNotes: "" });
    return null;
  };
  const snapshot = await api.setUpdateTrack("clink");
  assert.equal(checks, 1);
  assert.deepEqual(channelAtCheck, ["clink", true, false]);
  assert.equal(settings.get("updater.track"), "clink");
  assert.equal(settings.get("updater.clinkOfferAnswered"), "true");
  assert.equal(snapshot.track, "clink");
  assert.equal(snapshot.clinkOfferAnswered, true);
  assert.equal(snapshot.availableVersion, "0.2.0-clink.1");
  assert.equal(requests.length, 1, "auto-download fetches the beta");
  updater.emit("update-downloaded", { version: "0.2.0-clink.1" });
  requests[0].resolve([]);
  await flush();
  assert.equal(api.getAppUpdateSnapshot().status, "downloaded");

  // Stay on CorosLink before it installs: back to /releases/latest and latest-mac.yml.
  updater.checkForUpdates = async () => {
    checks += 1;
    updater.emit("update-not-available", { version: "0.1.49" });
    return null;
  };
  const back = await api.setUpdateTrack("legacy");
  assert.equal(checks, 2);
  assert.equal(updater.channel, "latest", "electron-updater's default channel name");
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(settings.get("updater.track"), "legacy");
  assert.equal(back.track, "legacy");
  assert.equal(back.status, "not-available", "the downloaded beta is no longer offered");
}

{
  // Switching cancels a CorosLink download still under way.
  const { api, updater, requests } = createUpdater();
  updater.checkForUpdates = async () => null;
  const switching = api.setUpdateTrack("clink");
  assert.equal(requests[0].token.cancelled, true);
  requests[0].reject(new CancellationError());
  await switching;
  assert.equal(api.getAppUpdateSnapshot().availableVersion, undefined);
}

{
  // No C-LINK beta published yet: a plain message instead of electron-updater's.
  const { api, updater } = loadUpdater();
  updater.checkForUpdates = async () => {
    throw Object.assign(new Error("No published versions on GitHub"), { code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS" });
  };
  const snapshot = await api.setUpdateTrack("clink");
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.error, /C-LINK beta isn't out yet/);
}

{
  // "Not now" is remembered.
  const { api, settings } = loadUpdater();
  assert.equal(api.dismissClinkOffer().clinkOfferAnswered, true);
  assert.equal(settings.get("updater.clinkOfferAnswered"), "true");
  assert.equal(settings.get("updater.track"), undefined, "the track stays legacy");
  const reloaded = loadUpdater({ extraSettings: [["updater.clinkOfferAnswered", "true"]] });
  assert.equal(reloaded.api.getAppUpdateSnapshot().clinkOfferAnswered, true);
}

{
  // Development builds remember the choice but never touch electron-updater.
  const { api, updater, settings } = loadUpdater({ isPackaged: false });
  updater.checkForUpdates = async () => assert.fail("no check in development");
  const snapshot = await api.setUpdateTrack("clink");
  assert.equal(snapshot.track, "clink");
  assert.equal(settings.get("updater.track"), "clink");
  assert.equal(updater.channel, null);
}

console.log("App updater track (legacy/C-LINK beta) passed.");
console.log("App updater cancellation, queued requests, manual downloads and feed failures passed.");
