import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const protocol = require("../dist-electron/corosActivityScreenProtocol.js");
const { CorosActivityScreenService } = require("../dist-electron/corosActivityScreenService.js");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "coros-activity-screens-"));
let checks = 0;
function check(callback) { callback(); checks++; }
async function rejects(promise, message) { await assert.rejects(promise, message); checks++; }

// Independent records based on the app's ordinary presets. Nonzero opaque tails
// catch accidental regeneration or data loss in unchanged syncs and restores.
function fixture() {
  const headers = [0x94, 0xa6, 0xb7, 0x80];
  return Buffer.concat([Buffer.from([0, 4]), ...headers.map((header, page) => {
    const bytes = Buffer.alloc(44); bytes[0] = header; bytes.writeUInt16LE(21, 2);
    for (let i = 0; i < 12; i++) bytes.writeUInt16LE(((10 + page * 20 + i) << 6) | (i % 4), 4 + i * 2);
    for (let i = 28; i < 44; i++) bytes[i] = (page + i) & 255;
    return bytes;
  })]);
}
function harness(directory = path.join(temporary, `case-${checks}`)) {
  const original = fixture(), state = { payload: Buffer.from(original), writes: [], exchanges: [], session: "connection-1",
    device: { key: "original-watch", name: "COROS PACE Pro TEST", model: "pace-pro", firmware: "3.2008.0" }, enabled: true,
    mismatch: false, failWrite: false, disconnectOnWrite: false, hold: null };
  const deps = {
    enabled: () => state.enabled, identity: () => ({ ...state.device }), session: () => state.session, directory: () => directory,
    exchange: async (opcode, payload) => {
      state.exchanges.push({ opcode, payload: Buffer.from(payload) });
      if (state.hold) { const held = state.hold; state.hold = null; await held; }
      if (opcode === 0x9e) return payload[0] === 255 ? Buffer.from([0, 1, 4, 5, 14, 64]) : Buffer.from(state.payload);
      assert.equal(opcode, 0x9f);
      // A recoverable backup and durable journal must already exist BEFORE SET.
      const journal = JSON.parse(await fs.readFile(path.join(directory, "pending-restore.json"), "utf8"));
      const backup = JSON.parse(await fs.readFile(path.join(directory, `${journal.backupId}.json`), "utf8"));
      assert.equal(backup.version, 1); assert.equal(backup.backup.device.key, "original-watch");
      state.writes.push(Buffer.from(payload));
      if (state.failWrite) throw new Error("Injected lost acknowledgement");
      state.payload = Buffer.from(payload);
      if (state.mismatch) state.payload[6] ^= 64;
      if (state.disconnectOnWrite) state.session = "disconnected";
      return Buffer.from([1]);
    }
  };
  return { state, original, deps, directory, service: new CorosActivityScreenService(deps) };
}

try {
  check(() => assert.equal(protocol.ACTIVITY_SCREEN_READ, 0x9e));
  check(() => assert.equal(protocol.ACTIVITY_SCREEN_WRITE, 0x9f));
  check(() => assert.deepEqual(protocol.supportedActivityScreenFieldCounts(), [2, 3, 4, 5, 6, 7, 8, 9]));
  const parsed = protocol.decodeActivityScreens(fixture(), 0);
  check(() => assert.deepEqual(parsed.map(page => page.fieldCount), [4, 6, 8, 2]));
  check(() => assert.equal(protocol.activityScreenSport(0).name, "Run"));
  check(() => assert.deepEqual(protocol.decodeActivityScreenSports(Buffer.from([0, 4, 64])).map(sport => sport.id), [0, 4]));
  for (const payload of [Buffer.from([0, 11]), Buffer.from([1, 0]), Buffer.alloc(30), Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(28)])]) {
    check(() => assert.throws(() => protocol.decodeActivityScreens(payload, 0), /unsupported/));
  }
  for (const ack of [Buffer.alloc(0), Buffer.from([0]), Buffer.from([1, 0])]) check(() => assert.throws(() => protocol.requireActivityScreenAcknowledgement(ack), /acknowledge/));
  const existingIds = new Set(parsed.flatMap(page => page.fields.map(field => field.metricId)));
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const modified = protocol.buildActivityScreenLayout(fixture(), 0, 1, count);
    const pages = protocol.decodeActivityScreens(modified, 0);
    check(() => assert.equal(pages[1].fieldCount, count));
    check(() => assert.ok(pages[1].fields.every(field => existingIds.has(field.metricId))));
    check(() => assert.deepEqual(modified.subarray(2, 46), fixture().subarray(2, 46)));
    check(() => assert.deepEqual(modified.subarray(90), fixture().subarray(90)));
    check(() => assert.deepEqual(modified.subarray(48, 50), fixture().subarray(48, 50), "base metric preserved"));
    check(() => assert.deepEqual(modified.subarray(74, 90), fixture().subarray(74, 90), "opaque extension preserved"));
  }
  const mapPage = Buffer.from(fixture()); mapPage.writeUInt16LE(194 << 6, 6);
  check(() => assert.throws(() => protocol.buildActivityScreenLayout(mapPage, 0, 0, 5), /ordinary grid/));
  const extendedPage = Buffer.from(fixture()); extendedPage[3] = 128;
  check(() => assert.equal(protocol.decodeActivityScreens(extendedPage, 0)[0].kind, "unknown"));
  check(() => assert.throws(() => protocol.buildActivityScreenLayout(extendedPage, 0, 0, 4), /ordinary grid/));
  check(() => assert.throws(() => protocol.buildActivityScreenLayout(fixture(), 0, 10, 4), /Choose a page/));

  const h = harness();
  check(() => assert.equal(h.state.writes.length, 0));
  const sports = await h.service.sports(); check(() => assert.equal(sports[0].name, "Run"));
  let document = await h.service.read(0);
  check(() => assert.equal(document.baseline, "unverified"));
  check(() => assert.equal(h.state.writes.length, 0, "read-only discovery never sends SET"));
  check(() => assert.throws(() => h.service.preview(document.id, 0, 5), /Confirm the standard/));
  check(() => assert.throws(() => h.service.preview(document.id, 0, 9), /Confirm the standard/));
  const beforeBaseline = h.service.preview(document.id, 0, 4);
  await rejects(h.service.apply(beforeBaseline.id), /Verify the unchanged/);
  await rejects(h.service.confirmBaseline(document.id), /Sync and verify/);
  const baseline = await h.service.syncBaseline(document.id);
  document = baseline.document;
  check(() => assert.equal(document.baseline, "read-back-verified"));
  check(() => assert.deepEqual(h.state.writes[0], h.original, "baseline SET matches the complete original payload"));
  check(() => assert.deepEqual(h.state.payload, h.original));
  check(() => assert.equal(baseline.backup.reason, "before-sync"));
  const backupText = JSON.parse(await h.service.exportBackup(baseline.backup.id));
  check(() => assert.equal(backupText.payloadHex, h.original.toString("hex")));
  check(() => assert.equal(document.recordBytes, 44));
  check(() => assert.throws(() => h.service.preview(document.id, 0, 7), /Confirm the standard/));
  check(() => assert.throws(() => h.service.preview(document.id, 0, 9), /Confirm the standard/));
  document = await h.service.confirmBaseline(document.id);
  check(() => assert.equal(document.baseline, "watch-confirmed"));
  const five = h.service.preview(document.id, 0, 5);
  check(() => assert.equal(five.page.fieldCount, 5));
  check(() => assert.equal(h.state.writes.length, 1, "preview is not a write"));
  const appliedFive = await h.service.apply(five.id); document = appliedFive.document;
  check(() => assert.equal(document.pages[0].fieldCount, 5));
  const seven = h.service.preview(document.id, 0, 7);
  document = (await h.service.apply(seven.id)).document;
  check(() => assert.equal(document.pages[0].fieldCount, 7));
  check(() => assert.throws(() => h.service.preview(document.id, 0, 9), /Restore the standard/));
  await rejects(h.service.confirmBaseline(document.id), /Restore the standard/);
  const writesBeforeBaselineRejection = h.state.writes.length;
  await rejects(h.service.syncBaseline(document.id), /Restore the standard/);
  check(() => assert.equal(h.state.writes.length, writesBeforeBaselineRejection, "experimental records cannot be re-labelled as a stock baseline"));
  document = (await h.service.restore(baseline.backup.id)).document;
  check(() => assert.throws(() => h.service.preview(document.id, 0, 9), /Confirm the standard/));
  document = (await h.service.syncBaseline(document.id)).document;
  document = await h.service.confirmBaseline(document.id);
  const nine = h.service.preview(document.id, 0, 9);
  check(() => assert.equal(nine.experimental, true));
  check(() => assert.deepEqual(nine.page.columns, [2, 2, 2, 2]));
  check(() => assert.equal(Buffer.from(nine.page.rawHex, "hex")[0], 0xbf));
  document = (await h.service.apply(nine.id)).document;
  check(() => assert.equal(document.pages[0].fieldCount, 9));
  const restored = await h.service.restore(baseline.backup.id);
  check(() => assert.deepEqual(h.state.payload, h.original, "restoration is byte-exact"));
  check(() => assert.equal(restored.document.baseline, "unverified"));
  check(() => assert.throws(() => h.service.preview(restored.document.id, 0, 5), /Confirm the standard/));
  check(() => assert.throws(() => h.service.preview(restored.document.id, 0, 9), /Confirm the standard/));
  check(() => assert.ok(h.state.writes.every(payload => payload.length === h.original.length)));

  const stale = harness(); const staleDocument = await stale.service.read(0); stale.state.payload[6] ^= 64;
  await rejects(stale.service.syncBaseline(staleDocument.id), /pages changed/);
  check(() => assert.equal(stale.state.writes.length, 0));

  const failed = harness(); const failedDocument = await failed.service.read(0); failed.state.mismatch = true;
  await rejects(failed.service.syncBaseline(failedDocument.id), /read-back differs/);
  const pending = (await failed.service.status()).pendingRestore;
  check(() => assert.ok(pending));
  const recoveryBackup = JSON.parse(await failed.service.exportBackup(pending.id));
  check(() => assert.equal(recoveryBackup.payloadHex, failed.original.toString("hex")));
  const restart = new CorosActivityScreenService(failed.deps);
  const restartedStatus = await restart.status();
  check(() => assert.equal(restartedStatus.pendingRestore.id, pending.id));
  failed.state.mismatch = false; failed.state.failWrite = true;
  await rejects(restart.restore(pending.id), /lost acknowledgement/);
  const failedRestoreStatus = await restart.status();
  check(() => assert.equal(failedRestoreStatus.pendingRestore.id, pending.id, "failed restoration retains its target backup"));
  failed.state.failWrite = false;
  const recovered = await restart.restore(pending.id);
  check(() => assert.equal(recovered.verified, true));
  check(() => assert.deepEqual(failed.state.payload, failed.original));
  const recoveredStatus = await restart.status();
  check(() => assert.equal(recoveredStatus.pendingRestore, null));

  const missing = harness(); const missingDocument = await missing.service.read(0); missing.state.mismatch = true;
  await rejects(missing.service.syncBaseline(missingDocument.id), /read-back differs/);
  const missingTarget = (await missing.service.status()).pendingRestore;
  await fs.rm(path.join(missing.directory, `${missingTarget.id}.json`));
  await rejects(missing.service.status(), /ENOENT/);
  missing.state.mismatch = false;
  const missingFresh = await missing.service.read(0), writesBeforeMissing = missing.state.writes.length;
  await rejects(missing.service.syncBaseline(missingFresh.id), /ENOENT/);
  check(() => assert.equal(missing.state.writes.length, writesBeforeMissing, "a missing recovery backup blocks further SETs"));
  await fs.writeFile(path.join(missing.directory, "pending-restore.json"), JSON.stringify({ version: 2, backupId: missingTarget.id }));
  await rejects(missing.service.status(), /journal is invalid/);

  const unwritableDirectory = path.join(temporary, "backup-path-is-a-file");
  await fs.writeFile(unwritableDirectory, "not a backup directory");
  const unwritable = harness(unwritableDirectory), unwritableDocument = await unwritable.service.read(0);
  await rejects(unwritable.service.syncBaseline(unwritableDocument.id), /EEXIST/);
  check(() => assert.equal(unwritable.state.writes.length, 0, "backup failures prevent any SET"));

  failed.state.device.key = "another-watch";
  await rejects(restart.restore(pending.id), /original PACE Pro/);
  failed.state.device.key = "original-watch"; failed.state.device.firmware = "another-firmware";
  await rejects(restart.restore(pending.id), /original PACE Pro/);
  const invalidBackup = JSON.parse(await restart.exportBackup(pending.id)); invalidBackup.payloadHex = "0000";
  await fs.writeFile(path.join(failed.directory, `${pending.id}.json`), JSON.stringify(invalidBackup));
  await rejects(restart.restore(pending.id), /integrity/);
  await rejects(restart.restore("../../escape"), /saved activity-page backup/);

  const disconnected = harness(); const disconnectedDoc = await disconnected.service.read(0); disconnected.state.disconnectOnWrite = true;
  await rejects(disconnected.service.syncBaseline(disconnectedDoc.id), /connection changed/);
  const disconnectedStatus = await disconnected.service.status();
  check(() => assert.ok(disconnectedStatus.pendingRestore));
  const empty = harness(); empty.state.payload = Buffer.from([0, 0]);
  const emptyDoc = await empty.service.read(0);
  await rejects(empty.service.syncBaseline(emptyDoc.id), /empty settings/i);
  check(() => assert.equal(empty.state.writes.length, 0));
  const release = harness(); release.state.enabled = false;
  await rejects(release.service.read(0), /development builds/);
  await rejects(release.service.backups(), /development builds/);
  const releaseStatus = await release.service.status();
  check(() => assert.equal(releaseStatus.enabled, false));
  check(() => assert.deepEqual(releaseStatus.supportedFieldCounts, []));
  check(() => assert.equal(release.state.exchanges.length, 0));

  // The real BLE owner serializes settings against existing transfer operations.
  const filename = path.resolve("dist-electron/corosNativeBleService.js"), nativeRequire = createRequire(filename);
  const nativeExports = {}, app = { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => path.join(temporary, "native") };
  vm.runInNewContext(await fs.readFile(filename, "utf8"), {
    exports: nativeExports, Buffer, process, clearTimeout, setTimeout,
    require(id) {
      if (id === "electron") return { app, safeStorage: { isEncryptionAvailable: () => true } };
      if (id === "./database") return { getSetting: () => undefined, setSetting: () => {} };
      return nativeRequire(id);
    }
  }, { filename });
  const native = new nativeExports.CorosNativeBleService();
  native.state = { phase: "connected", available: true, connected: true, encrypted: true, systemBind: "authenticated", channels: [],
    deviceName: "COROS PACE Pro TEST", deviceId: "test-device", serialNumber: "test-serial", modelNumber: "COROS W332", softwareRevision: "3.2008.0", authenticatedAt: 1 };
  let finish; const waiting = new Promise(resolve => { finish = resolve; });
  native.controlCommand = async () => { await waiting; return fixture(); };
  const reading = native.readActivityScreens(0);
  await rejects(native.readActivityScreens(0), /current Bluetooth operation/);
  await rejects(native.listMusic(), /current Bluetooth operation/);
  await rejects(native.connect(), /operation/);
  await rejects(native.scan(), /operation/);
  await rejects(native.syncRoute({}), /activity-page sync/);
  await rejects(native.syncWatchface("preview"), /Bluetooth transfer/);
  await rejects(native.listWatchfaceSlots(), /Bluetooth transfer/);
  await rejects(native.sendNotification({ message: "Fixture message" }), /Bluetooth operation/);
  check(() => assert.throws(() => native.downloadWifiMap("preview"), /activity-page sync/));
  check(() => assert.throws(() => native.sendMusicOverWifi(async () => null), /current Bluetooth operation/));
  const readingStatus = await native.status();
  check(() => assert.equal(readingStatus.phase, "connected"));
  finish(); await reading;
  native.state.serialNumber = undefined; native.state.deviceId = undefined;
  await rejects(native.readActivityScreens(0), /identity and firmware/);
  app.isPackaged = true;
  await rejects(native.readActivityScreens(0), /development builds/);
  await rejects(native.activityScreenBackups(), /development builds/);

  // Real compiled preload → registered handlers → settings service, without a GUI.
  const ipcWatch = harness(), handlers = new Map(), owner = {}, mainFrame = {}, mainSender = {};
  let caller = { sender: mainSender, senderFrame: mainFrame }, packaged = false, bridge, cancelExport = false;
  const exportedFile = path.join(temporary, "exported-backup.json");
  const { registerCorosActivityScreenIpc } = require("../dist-electron/corosActivityScreenIpc.js");
  registerCorosActivityScreenIpc({ ipc: { handle: (name, handler) => handlers.set(name, handler) }, isPackaged: () => packaged,
    owner(event) {
      if (event.sender !== mainSender || event.senderFrame !== mainFrame) throw new Error("Use activity-screen sync from the main window.");
      return owner;
    }, saveDialog: async selectedOwner => { assert.equal(selectedOwner, owner); return { canceled: cancelExport, filePath: exportedFile }; },
    api: {
      activityScreenStatus: () => ipcWatch.service.status(), activityScreenBackups: () => ipcWatch.service.backups(),
      listActivityScreenSports: () => ipcWatch.service.sports(), readActivityScreens: id => ipcWatch.service.read(id),
      backupActivityScreens: id => ipcWatch.service.backup(id), syncActivityScreenBaseline: id => ipcWatch.service.syncBaseline(id),
      confirmActivityScreenBaseline: id => ipcWatch.service.confirmBaseline(id), previewActivityScreenLayout: (...args) => ipcWatch.service.preview(...args),
      applyActivityScreenLayout: id => ipcWatch.service.apply(id), restoreActivityScreens: id => ipcWatch.service.restore(id),
      exportActivityScreenBackup: id => ipcWatch.service.exportBackup(id)
    }
  });
  vm.runInNewContext(await fs.readFile(path.resolve("dist-electron/preload.js"), "utf8"), {
    exports: {}, process: { platform: process.platform, argv: [] }, require(id) {
      assert.equal(id, "electron");
      return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "corosLink"); bridge = value; } },
        ipcRenderer: { invoke: async (channel, ...args) => {
          assert.ok(handlers.has(channel), `Preload channel ${channel} must be registered`);
          return handlers.get(channel)(caller, ...args);
        } } };
    }
  }, { filename: "dist-electron/preload.js" });
  check(() => assert.equal(handlers.size, 11));
  check(() => assert.equal((ipcWatch.state.exchanges.length), 0));
  const ipcStatus = await bridge.getCorosActivityScreenStatus(); check(() => assert.equal(ipcStatus.enabled, true));
  check(() => assert.ok(ipcStatus.supportedFieldCounts.includes(9), "preload status reports the running codec's nine-field support"));
  const ipcSports = await bridge.listCorosActivityScreenSports(); check(() => assert.equal(ipcSports[0].id, 0));
  let ipcDocument = await bridge.readCorosActivityScreens(0);
  const ipcManual = await bridge.backupCorosActivityScreens({ snapshotId: ipcDocument.id });
  const ipcBaseline = await bridge.syncCorosActivityScreenBaseline({ snapshotId: ipcDocument.id });
  check(() => assert.deepEqual(ipcWatch.state.writes[0], ipcWatch.original));
  ipcDocument = await bridge.confirmCorosActivityScreenBaseline({ snapshotId: ipcBaseline.document.id });
  const ipcPreview = await bridge.previewCorosActivityScreenLayout({ snapshotId: ipcDocument.id, pageIndex: 0, fieldCount: 5 });
  const ipcApply = await bridge.applyCorosActivityScreenLayout({ previewId: ipcPreview.id });
  check(() => assert.equal(ipcApply.document.pages[0].fieldCount, 5));
  const ipcRestored = await bridge.restoreCorosActivityScreens({ backupId: ipcManual.id });
  check(() => assert.equal(ipcRestored.verified, true));
  check(() => assert.deepEqual(ipcWatch.state.payload, ipcWatch.original));
  const ipcBackups = await bridge.getCorosActivityScreenBackups(); check(() => assert.equal(ipcBackups.length, 4));
  const ipcExport = await bridge.exportCorosActivityScreenBackup({ backupId: ipcManual.id });
  check(() => assert.equal(ipcExport.saved, true));
  const ipcExportFile = JSON.parse(await fs.readFile(exportedFile, "utf8"));
  check(() => assert.equal(ipcExportFile.payloadHex, ipcWatch.original.toString("hex")));
  cancelExport = true;
  const cancelledExport = await bridge.exportCorosActivityScreenBackup({ backupId: ipcManual.id });
  check(() => assert.equal(cancelledExport.saved, false));
  await rejects(bridge.readCorosActivityScreens("0"), /Choose an activity/);
  await rejects(bridge.previewCorosActivityScreenLayout({ snapshotId: ipcDocument.id, pageIndex: 0.5, fieldCount: 5 }), /page and layout/);
  await rejects(bridge.restoreCorosActivityScreens({ backupId: "" }), /Read or select/);
  await rejects(bridge.syncCorosActivityScreenBaseline(null), /activity-page action/);
  const ipcMethods = ["getCorosActivityScreenStatus", "listCorosActivityScreenSports", "readCorosActivityScreens", "getCorosActivityScreenBackups",
    "backupCorosActivityScreens", "syncCorosActivityScreenBaseline", "confirmCorosActivityScreenBaseline", "previewCorosActivityScreenLayout",
    "applyCorosActivityScreenLayout", "restoreCorosActivityScreens", "exportCorosActivityScreenBackup"];
  const ipcExchangeCount = ipcWatch.state.exchanges.length;
  packaged = true;
  for (const method of ipcMethods) await rejects(bridge[method]({}), /development builds/);
  packaged = false; caller = { sender: {}, senderFrame: mainFrame };
  for (const method of ipcMethods) await rejects(bridge[method]({}), /main window/);
  caller = { sender: mainSender, senderFrame: {} };
  for (const method of ipcMethods) await rejects(bridge[method]({}), /main window/);
  check(() => assert.equal(ipcWatch.state.exchanges.length, ipcExchangeCount, "rejected callers never reach the watch"));
  console.log(`${checks} activity-screen checks passed: exact backups/restores, failure/restart recovery, baseline gates, layouts, BLE serialization, and real preload/IPC routing and gates (simulated watch exchange).`);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
