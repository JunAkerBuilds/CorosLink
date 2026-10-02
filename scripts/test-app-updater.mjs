import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { CancellationToken, CancellationError } = require("builder-util-runtime");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function createUpdater() {
  const updater = new EventEmitter();
  const requests = [];
  updater.downloadUpdate = (token) =>
    new Promise((resolve, reject) => requests.push({ token, resolve, reject }));
  const settings = new Map([
    ["updater.autoCheck", "false"],
    ["updater.autoDownload", "true"]
  ]);
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(new URL("../dist-electron/updaterService.js", import.meta.url), "utf8"),
    {
      module,
      exports: module.exports,
      process: { env: {}, platform: "darwin", execPath: process.execPath },
      setTimeout,
      clearTimeout,
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

console.log("App updater cancellation, queued requests and manual downloads passed.");
