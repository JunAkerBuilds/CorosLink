import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const filename = path.resolve("dist-electron/corosNativeBleService.js");
const require = createRequire(filename);
const settings = new Map();
const writes = [];
const workers = [];
let imported = true;
const fakeBond = { adapterAddress: "00:11:22:33:44:55", watchAddress: "11:22:33:44:55:66",
  keys: { ltk_central: { value: "test-key-never-returned-to-renderer" } } };
const publicState = { phase: "connected", connected: true, encrypted: true,
  systemBind: "unavailable", channels: [], batteryPercent: 68 };
const fakeAuth = { privateKeyDer: "account-key-never-returned-to-renderer" };
const exports = {};
vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
  // The service's 6 s shutdown grace is shortened so the hung-helper case stays quick.
  exports, Buffer, clearTimeout, setTimeout: (callback, ms, ...args) => setTimeout(callback, ms === 6_000 ? 20 : ms, ...args),
  process: { env: { BUMBLE_SNOOPER: "unsafe-inherited-capture", BUMBLE_LOGLEVEL: "DEBUG" } },
  require(id) {
    if (id === "electron") return {
      app: { isPackaged: false, getAppPath: () => "/project" },
      safeStorage: { isEncryptionAvailable: () => true,
        encryptString: text => Buffer.from(`encrypted:${text}`),
        decryptString: bytes => bytes.toString().slice("encrypted:".length) }
    };
    if (id === "./database") return { getSetting: key => settings.get(key), setSetting: (key, value) => settings.set(key, value) };
    if (id === "node:fs") return {
      existsSync: file => file.endsWith("native-bond.json") ? imported : !file.endsWith("latest-session.txt"),
      readFileSync: () => JSON.stringify(fakeBond),
      unlinkSync: () => { imported = false; }
    };
    if (id === "node:child_process") return { spawn(_program, _args, options) {
      assert.equal(options.env.BUMBLE_SNOOPER, undefined);
      assert.equal(options.env.BUMBLE_LOGLEVEL, undefined);
      const worker = new EventEmitter();
      let currentState = publicState;
      worker.stdout = new EventEmitter();
      worker.stdout.setEncoding = () => {};
      worker.stderr = new EventEmitter();
      worker.stderr.setEncoding = () => {};
      worker.stdin = {
        on() {},
        write(line, callback) {
          if (worker.killed) return;
          const request = JSON.parse(line);
          writes.push(request);
          if (request.pair) {
            setTimeout(() => worker.stdout.emit("data", JSON.stringify({ bondUpdate: {
              ...fakeBond, keys: { ltk_central: { value: "new-test-key" } }
            } }) + "\n"), 1);
          }
          if (request.operation === "connect") currentState = { ...publicState, systemBind: request.auth ? "authenticated" : "unavailable" };
          const result = request.operation === "disconnect"
            ? { ...publicState, phase: "disconnected", connected: false, encrypted: false } : currentState;
          setTimeout(() => worker.stdout.emit("data", JSON.stringify({ id: request.id, result }) + "\n"), 5);
          callback?.();
        },
        end() { if (!worker.hangOnEnd) setTimeout(() => { worker.emit("exit", 0); worker.emit("close", 0); }, 0); }
      };
      worker.kill = () => {
        worker.killed = true;
        // A hung helper takes a while to report close after being killed.
        setTimeout(() => { worker.emit("exit", 1); worker.emit("close", 1); }, worker.hangOnEnd ? 200 : 0);
      };
      worker.simulateRemoteDisconnect = () => { currentState = { ...currentState, connected: false, encrypted: false,
        phase: "disconnected", systemBind: "not_authenticated" }; };
      workers.push(worker);
      return worker;
    } };
    return require(id);
  }
}, { filename });

const service = new exports.CorosNativeBleService();
assert.equal((await service.status()).available, true);
const first = service.connect();
const second = service.connect();
assert.equal(first, second, "concurrent connect requests share one worker and one BLE operation");
assert.equal((await service.status()).phase, "connecting");
const state = await first;
assert.equal(workers.length, 1);
assert.equal(writes.filter(item => item.operation === "connect").length, 1);
assert.equal(state.encrypted, true);
assert.equal(state.systemBind, "unavailable", "a BLE link does not imply COROS authentication");
assert.equal(JSON.stringify(state).includes(fakeBond.keys.ltk_central.value), false, "no key in renderer state");
assert.ok(settings.get("coros.ble.bond"));
assert.equal(imported, false, "plaintext import is removed after encryption");
assert.equal((await service.refresh()).batteryPercent, 68);
assert.equal((await service.disconnect()).connected, false);
settings.set("coros.ble.accountAuth", Buffer.from(`encrypted:${JSON.stringify(fakeAuth)}`).toString("base64"));
const authenticated = await service.connect(true);
assert.equal(authenticated.systemBind, "authenticated");
assert.equal(writes.at(-1).auth.privateKeyDer, fakeAuth.privateKeyDer, "the worker receives the key over private stdin");
assert.equal(JSON.stringify(authenticated).includes(fakeAuth.privateKeyDer), false, "account key stays out of renderer state");
assert.equal(workers.length, 2, "reconnect uses the encrypted saved bond");
assert.ok(Buffer.from(settings.get("coros.ble.bond"), "base64").toString().includes("new-test-key"),
  "fresh pairing replaces the encrypted bond without exposing keys in device state");
assert.equal(JSON.stringify(await service.status()).includes("new-test-key"), false);
workers[1].simulateRemoteDisconnect();
assert.equal((await service.status()).connected, false);
assert.equal((await service.connect()).systemBind, "authenticated");
assert.equal(workers.length, 3, "a remote disconnect releases the previous worker before reconnect");
const pending = service.refresh();
workers[2].stderr.emit("data", `ModuleNotFoundError: ${fakeAuth.privateKeyDer}\n`);
workers[2].emit("exit", 1);
workers[2].emit("close", 1);
await assert.rejects(pending, /worker stopped/);
assert.equal((await service.status()).connected, false, "worker exit clears a stale connected indicator");
assert.equal((await service.status()).systemBind, "not_authenticated", "worker exit clears the authenticated session");
await service.stop();

const missingRuntime = service.connect();
workers.at(-1).stderr.emit("data", `ImportError: secret-${fakeBond.keys.ltk_central.value}\n`);
workers.at(-1).emit("close", 1);
await assert.rejects(missingRuntime, error => {
  assert.match(error.message, /ImportError/);
  assert.equal(error.message.includes(fakeBond.keys.ltk_central.value), false);
  return true;
});

assert.equal((await service.connect()).connected, true);
const hung = workers.at(-1);
hung.hangOnEnd = true;
await service.stop();
assert.equal((await service.status()).connected, false, "a helper that ignores shutdown is detached once killed");
assert.equal((await service.connect()).connected, true);
assert.notEqual(workers.at(-1), hung, "reconnecting starts a new helper instead of reusing the dying one");
await service.stop();
// The USB adapter's identity is the bonded watch address (the bond's key encrypts the link): remembered on the
// user's first authenticated connection, checked before the worker is even started.
{
  const saveBond = bond => settings.set("coros.ble.bond", Buffer.from(`encrypted:${JSON.stringify(bond)}`).toString("base64"));
  const pinned = () => JSON.parse(settings.get("coros.ble.watchIdentity") ?? "{}").usb?.deviceId;
  settings.delete("coros.ble.watchIdentity");
  await service.connect();
  await service.disconnect();
  assert.equal(pinned(), undefined, "a connection CorosLink made doesn't remember the watch");
  assert.equal((await service.userConnect()).systemBind, "authenticated");
  assert.equal(pinned(), fakeBond.watchAddress);
  await service.disconnect();
  // Another bond (an imported or re-paired watch): asked first, nothing started.
  saveBond({ ...fakeBond, watchAddress: "66:55:44:33:22:11" });
  const before = writes.length, started = workers.length;
  const asked = await service.userConnect();
  assert.deepEqual([asked.identityMismatch, asked.connected], [true, false]);
  assert.deepEqual([writes.length, workers.length], [before, started], "no worker, no connection, no authentication");
  await assert.rejects(service.connect(), error => error.watchIdentity === "mismatch");
  assert.equal((await service.userConnect()).identityMismatch, true);
  const anyway = await service.userConnect(false, { confirmIdentity: true });
  assert.deepEqual([anyway.connected, anyway.systemBind, anyway.identityMismatch], [true, "authenticated", undefined]);
  assert.equal(pinned(), "66:55:44:33:22:11", "Connect anyway re-pins");
  await service.stop();
}
console.log("Direct COROS BLE lifecycle, hung-helper shutdown, key-boundary and watch identity checks passed.");
