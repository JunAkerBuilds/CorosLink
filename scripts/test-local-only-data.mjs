import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

// Local data for Local-Only Mode: archive, repositories, FIT import, local
// sources, watch sync (fake watch), day totals and backups. Runs against the
// compiled main-process modules (npm run build:electron first).

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "dist-electron", file)).href);

const { createLocalDataTables } = await load("localSync/localDataSchema.js");
const { ActivityRepository } = await load("localSync/activityRepository.js");
const { HealthRepository } = await load("localSync/healthRepository.js");
const { LocalArchive } = await load("localSync/localArchive.js");
const { LocalActivitySource, LocalHealthDataSource } = await load("localSync/activitySource.js");
const { importFitFiles } = await load("localSync/fitImportService.js");
const { WatchActivityService, localDeviceId, watchSyncSupport, INTERRUPTED_DECODE } = await load("localSync/watchActivityService.js");
const { WatchHealthService, pedometerDay } = await load("localSync/watchHealthService.js");
const { exportLocalBackup, restoreLocalBackup } = await load("localSync/localBackupService.js");
const { decodeSportSyncPayload } = await load("localSync/syncPayloadDecoder.js");
const { pruneSupersededPayloads, nextOffsetAfterStoredCopy } = await load("localSync/payloadRetention.js");
const { LocalDataService } = await load("localSync/localDataService.js");
const { SyncCaptureLog, syncCaptureEnabled } = await load("localSync/syncCapture.js");
const protocol = await load("localSync/activityProtocol.js");
const { FIT_EPOCH_OFFSET_SECONDS, FIT_MSG } = await load("fitDecoder.js");
const { LocalTrainingMetrics } = await load("localSync/localTrainingMetrics.js");
const { corosSessionToFit } = await load("localSync/syncPayloadDecoder.js");
const { CorosSportRecordFormatError, decodeCorosSportRecordFile } = await load("localSync/corosSportRecord.js");
const { pages, startRecord, syntheticRun } = await import("./fixtures/coros-sport-record-fixture.mjs");
const { syntheticDaily } = await import("./fixtures/coros-daily-fixture.mjs");

/** The decoders' names as stored with each payload, and stand-ins for another decoder version's. */
const SPORT_DECODER = "coros-sport-record/v1";
const DAILY_DECODER = "coros-daily/v1";
const OTHER_SPORT_DECODER = "coros-sport-record/v0";
const OTHER_FAILED = `failed:${OTHER_SPORT_DECODER}`;

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

// ----- fixtures -----

const BASE = { enum: 0x00, uint8: 0x02, sint32: 0x85, uint16: 0x84, uint32: 0x86 };
const SIZE = { 0x00: 1, 0x02: 1, 0x85: 4, 0x84: 2, 0x86: 4 };

/** Minimal FIT encoder: one run (or swim) with two laps and GPS records. */
function buildFit({ start = 1_790_000_000, sport = 1, subSport = 0, seconds = 600, speed = 3, hr = 150, gps = true } = {}) {
  const chunks = [];
  const defs = {};
  const define = (local, globalNum, fields) => {
    chunks.push(Uint8Array.from([0x40 | local, 0, 0, globalNum & 255, globalNum >> 8, fields.length, ...fields.flatMap(([num, base]) => [num, SIZE[base], base])]));
    defs[local] = fields;
  };
  const data = (local, values) => {
    const bytes = [local];
    defs[local].forEach(([, base], index) => {
      const view = new DataView(new ArrayBuffer(SIZE[base]));
      if (base === 0x85) view.setInt32(0, values[index], true);
      else if (base === 0x86) view.setUint32(0, values[index], true);
      else if (base === 0x84) view.setUint16(0, values[index], true);
      else view.setUint8(0, values[index]);
      bytes.push(...new Uint8Array(view.buffer));
    });
    chunks.push(Uint8Array.from(bytes));
  };
  const fit = (unix) => unix - FIT_EPOCH_OFFSET_SECONDS;
  define(0, FIT_MSG.FILE_ID, [[0, BASE.enum], [1, BASE.uint16], [2, BASE.uint16], [4, BASE.uint32]]);
  data(0, [4, 294, 1, fit(start)]);
  define(1, FIT_MSG.RECORD, [[253, BASE.uint32], [0, BASE.sint32], [1, BASE.sint32], [5, BASE.uint32], [6, BASE.uint16], [3, BASE.uint8], [2, BASE.uint16]]);
  for (let t = 0; t <= seconds; t += 5) {
    const lat = gps ? Math.round(((47.6 + t * 1e-5) * 2 ** 31) / 180) : 0x7fffffff;
    const lon = gps ? Math.round(((-122.3 + t * 1e-5) * 2 ** 31) / 180) : 0x7fffffff;
    data(1, [fit(start + t), lat, lon, Math.round(t * speed * 100), speed * 1000, hr + (t % 7), (20 + 500) * 5]);
  }
  define(2, FIT_MSG.LAP, [[2, BASE.uint32], [7, BASE.uint32], [8, BASE.uint32], [9, BASE.uint32], [15, BASE.uint8], [16, BASE.uint8], [21, BASE.uint16]]);
  const half = seconds / 2;
  data(2, [fit(start), half * 1000, half * 1000, Math.round(half * speed * 100), hr, hr + 6, 5]);
  data(2, [fit(start + half), half * 1000, half * 1000, Math.round(half * speed * 100), hr + 1, hr + 6, 7]);
  define(3, FIT_MSG.SESSION, [[2, BASE.uint32], [5, BASE.enum], [6, BASE.enum], [7, BASE.uint32], [8, BASE.uint32], [9, BASE.uint32], [11, BASE.uint16], [16, BASE.uint8], [17, BASE.uint8], [22, BASE.uint16]]);
  data(3, [fit(start), sport, subSport, seconds * 1000, seconds * 1000, Math.round(seconds * speed * 100), 420, hr + 3, hr + 6, 12]);
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(14 + size + 2);
  out.set([14, 0x20, 0xa6, 0x52], 0);
  new DataView(out.buffer).setUint32(4, size, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8);
  let offset = 14;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return Buffer.from(out);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-local-data-"));
function freshStore(name) {
  const db = new Database(":memory:");
  createLocalDataTables(db);
  const archive = new LocalArchive(path.join(root, name, "local-archive"));
  return { db, archive, activities: new ActivityRepository(db), health: new HealthRepository(db) };
}

/** Two finished runs, then one still being recorded (kept for a later sync): five 4 KiB pages. */
const PAYLOAD_START = 1_792_000_000;
const payload = Buffer.concat([
  syntheticRun({ startUnix: PAYLOAD_START }).file, syntheticRun({ startUnix: PAYLOAD_START + 86_400 }).file,
  pages([startRecord(PAYLOAD_START + 2 * 86_400, 0, 0)])
]);
assert.ok(payload.length > 3 * 4096, "fixture spans several blocks");

try {
  // ----- protocol codec -----

  await test("sync reads are read-only and never acknowledge; block cursors are bounded", () => {
    // The request itself is encoded by the transports, checked against scripts/fixtures/coros-sync-file-vectors.json (test:coros-ble-activity).
    assert.doesNotThrow(() => protocol.assertReadableSyncFile(protocol.SPORT_RECORD_FILE));
    assert.doesNotThrow(() => protocol.assertReadableSyncFile(protocol.DAILY_DATA_FILE), "daily file can be read");
    assert.throws(() => protocol.assertReadableSyncFile(93), /read-only/);
    assert.throws(() => protocol.assertReadableSyncFile(0x14), /read-only/);
    // Never acknowledge: there is no 0x7D encoder or acknowledge list to call.
    for (const name of ["encodeSyncFileAck", "isSyncFileAckReply", "assertAcknowledgeableSyncFile", "ACKNOWLEDGEABLE_SYNC_FILES", "SYNC_ACK_OPCODE"]) assert.equal(name in protocol, false, name);
    const cursor = new protocol.SyncFileCursor();
    assert.equal(cursor.accept(Buffer.alloc(100), 250), 0);
    assert.equal(cursor.accept(Buffer.alloc(100), 150), 100);
    assert.throws(() => cursor.accept(Buffer.alloc(10), 999), (error) => error instanceof protocol.SyncFileChangedError);
    assert.equal(cursor.accept(Buffer.alloc(50), 50), 200);
    assert.equal(cursor.complete, true);
    assert.throws(() => new protocol.SyncFileCursor().accept(Buffer.alloc(12_289), 20_000), /does not fit/);
  });

  await test("pedometer replies decode with plausibility checks", () => {
    // Laid out as a PACE 4 (W336, V3.2008.0) sends it; the figures are made up.
    const captured = Buffer.from("e110000090d00300f0490200580200000a120000", "hex");
    assert.deepEqual(protocol.decodePedometer(captured), { steps: 4321, distanceMeters: 2500, calories: 150, activeSeconds: 600, month: 10, day: 18 });
    assert.deepEqual(protocol.decodePedometer(captured.subarray(0, 12)), { steps: 4321, distanceMeters: 2500, calories: 150 });
    assert.throws(() => protocol.decodePedometer(captured.subarray(0, 11)));
    const absurd = Buffer.from(captured); absurd.writeInt32LE(-5, 0);
    assert.throws(() => protocol.decodePedometer(absurd));
    assert.equal(pedometerDay({ steps: 1, distanceMeters: 0, calories: 0, month: 12, day: 31 }, new Date(2027, 0, 1, 0, 5)), "20261231");
    assert.equal(pedometerDay({ steps: 1, distanceMeters: 0, calories: 0, month: 10, day: 18 }, new Date(2026, 9, 18, 9)), "20261018");
  });

  await test("the sync payload decoder reads sport-record files and refuses anything else", () => {
    const decoded = decodeSportSyncPayload(payload);
    assert.deepEqual([decoded.records.length, decoded.unrecognised], [2, 1], "two finished activities, one still being recorded");
    assert.ok(decoded.records.every((record) => record.fit.length > 0 && record.headline.startTime > 0));
    assert.throws(() => decodeSportSyncPayload(Buffer.alloc(4096, 0x5a)), CorosSportRecordFormatError);
    assert.throws(() => decodeSportSyncPayload(Buffer.from("not a record file at all, but long enough to read")), CorosSportRecordFormatError);
  });

  // ----- archive -----

  await test("archive refuses paths outside its root and writes atomically", async () => {
    const { archive } = freshStore("archive");
    for (const bad of ["../escape.fit", "/etc/passwd", "", "fit/../../x", "a\0b"]) assert.throws(() => archive.resolve(bad));
    const stored = await archive.storeContent("fit", Buffer.from("hello"), "fit");
    assert.match(stored.relativePath, /^fit\/[0-9a-f]{2}\/[0-9a-f]{64}\.fit$/);
    assert.deepEqual(await archive.storeContent("fit", Buffer.from("hello"), "fit"), stored);
    const directory = path.dirname(archive.resolve(stored.relativePath));
    assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")), []);
    if (process.platform !== "win32") assert.equal(fs.statSync(archive.resolve(stored.relativePath)).mode & 0o777, 0o600);
  });

  // ----- FIT import and local source -----

  const imports = freshStore("imports");
  const importDir = path.join(root, "fit-files");
  fs.mkdirSync(path.join(importDir, "nested"), { recursive: true });
  const runFile = path.join(importDir, "Lunch run.fit");
  fs.writeFileSync(runFile, buildFit({ start: 1_790_000_000 }));
  fs.writeFileSync(path.join(importDir, "nested", "2026-09-01_Pool Swim_481234567.fit"), buildFit({ start: 1_789_000_000, sport: 5, subSport: 17, speed: 1, gps: false }));
  fs.writeFileSync(path.join(importDir, "notes.txt"), "not a fit file");
  fs.writeFileSync(path.join(importDir, "broken.fit"), Buffer.from("definitely not FIT"));
  const indexed = [];
  const importDeps = { repository: imports.activities, archive: imports.archive, indexSummary: async (file, meta) => indexed.push({ file, meta }) };

  await test("FIT import validates, deduplicates and records provenance", async () => {
    const first = await importFitFiles(importDeps, [importDir]);
    assert.equal(first.imported, 2);
    assert.equal(first.duplicates, 0);
    assert.deepEqual(first.failed.map((failure) => failure.name), ["broken.fit"]);
    assert.equal(indexed.length, 2);
    const again = await importFitFiles(importDeps, [runFile, importDir]);
    assert.equal(again.imported, 0);
    assert.equal(again.duplicates, 3, "the same bytes are never stored twice");
    const all = imports.activities.allActivities();
    assert.deepEqual(all.map((activity) => [activity.sportType, activity.provenance, activity.name]), [
      [100, "file", "Lunch run"],
      [300, "cloud-export", "Pool Swim"]
    ]);
    assert.equal(all[0].distance, 1800);
    assert.equal(all[0].avgHr, 153);
    assert.equal(imports.activities.countActivities().total, 2);
  });

  const localSource = new LocalActivitySource(imports.activities, imports.archive);

  await test("the local activity source lists, details and exports without the cloud", async () => {
    const list = await localSource.listActivities(1, 50);
    assert.equal(list.length, 2);
    assert.equal(list[0].sportName, "Run");
    const swimDate = new Date(1_789_000_000 * 1000);
    const swimDay = `${swimDate.getFullYear()}${String(swimDate.getMonth() + 1).padStart(2, "0")}${String(swimDate.getDate()).padStart(2, "0")}`;
    const filtered = await localSource.listActivities(1, 50, swimDay, swimDay);
    assert.deepEqual(filtered.map((activity) => activity.sportType), [300]);
    const detail = await localSource.getActivityDetail(list[0].activityId, list[0].sportType);
    assert.equal(detail.laps.length, 2);
    assert.equal(detail.laps[0].pace, 333.3);
    assert.ok(detail.track.points.length > 100);
    assert.ok(detail.series.length > 10 && detail.series.length <= 600);
    assert.equal(detail.raw.cloudOnlyMetricsUnavailable, true);
    assert.equal(detail.trainingLoad, undefined, "no invented COROS metrics");
    const swim = await localSource.getActivityDetail(list[1].activityId, list[1].sportType);
    assert.equal(swim.track, undefined);
    assert.equal(swim.laps.length, 2);
    const fit = await localSource.readActivityFile(list[0].activityId, 100, 4);
    assert.deepEqual(fit.content, fs.readFileSync(runFile));
    const gpx = await localSource.readActivityFile(list[0].activityId, 100, 1);
    assert.match(gpx.content.toString(), /<trkpt lat="47\.6000000" lon="-122\.3000000">/);
    await assert.rejects(localSource.readActivityFile(list[1].activityId, 300, 1), /no GPS track/);
    await assert.rejects(localSource.getActivityDetail("123456789", 100), /Local-Only Mode: This activity isn't stored/);
  });

  // ----- watch sync -----

  function fakeWatch(initial, options = {}) {
    const state = { content: initial, requests: [], released: 0, failAt: options.failAt, model: options.model ?? "pace-4", onRead: undefined };
    let archiveForCheck;
    const transport = {
      identity: () => ({ deviceId: localDeviceId("SERIAL-1"), name: "PACE 4", model: state.model, firmware: "V3.2008.0" }),
      async readSyncBlock(fileIndex, offset, selector) {
        assert.equal(fileIndex, 14);
        assert.equal(selector, 0);
        // Each block before this offset is already durable in the partial file before the next request.
        if (offset > 0 && archiveForCheck) {
          const partial = fs.readdirSync(path.join(archiveForCheck.root, "partial")).find((name) => name.endsWith(".part"));
          assert.ok(fs.statSync(path.join(archiveForCheck.root, "partial", partial)).size >= offset, `block before ${offset} not stored`);
        }
        state.requests.push(offset);
        state.onRead?.();
        if (state.failAt !== undefined && state.requests.length === state.failAt) {
          state.failAt = undefined;
          throw new Error("The watch disconnected while sending its records.");
        }
        return { block: state.content.subarray(offset, offset + 4096), remaining: state.content.length - offset };
      },
      // No ackSyncBlock: sync is read-only and never acknowledges a block.
      async release() { state.released += 1; }
    };
    return { state, transport, attach: (archive) => { archiveForCheck = archive; } };
  }

  const watchStore = freshStore("watch");

  await test("watch sync is read-only: stores every block, decodes, never acknowledges, and keeps the watch connected", async () => {
    const watch = fakeWatch(payload);
    watch.attach(watchStore.archive);
    const progress = [];
    const service = new WatchActivityService({ repository: watchStore.activities, archive: watchStore.archive, transport: watch.transport, onProgress: (p) => progress.push(p.state) });
    const result = await service.sync();
    assert.equal(result.state, "done");
    assert.equal(result.newActivities, 2);
    assert.equal(result.undecodedPayloads, 1);
    assert.equal(watch.state.requests.length, Math.ceil(payload.length / 4096));
    assert.equal(watch.state.released, 0, "a finished read leaves nothing to close: no disconnect");
    const payloads = watchStore.activities.listPayloads();
    assert.equal(payloads.length, 1);
    assert.deepEqual(fs.readFileSync(watchStore.archive.resolve(payloads[0].filePath)), payload, "raw payload archived unchanged");
    const activities = watchStore.activities.allActivities();
    assert.deepEqual(activities.map((a) => [a.provenance, a.format, a.verification]), [["watch", "fit", "verified"], ["watch", "fit", "verified"]]);
    assert.ok(progress.includes("reading") && progress.at(-1) === "done");
    const run = watchStore.activities.recentRuns(1)[0];
    assert.equal(run.state, "done");
    assert.equal(run.newRecords, 2);
  });

  await test("repeating a sync never duplicates records", async () => {
    const watch = fakeWatch(payload);
    watch.attach(watchStore.archive);
    const service = new WatchActivityService({ repository: watchStore.activities, archive: watchStore.archive, transport: watch.transport });
    const result = await service.sync();
    assert.equal(result.newActivities, 0);
    assert.equal(watchStore.activities.countActivities().total, 2);
    assert.equal(watchStore.activities.listPayloads().length, 1);
  });

  await test("watch sync decodes the PACE 4 sport-record file into FIT activities", async () => {
    const store = freshStore("sport-record");
    const { file, expected } = syntheticRun();
    const watch = fakeWatch(file);
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    const result = await service.sync();
    assert.equal(result.newActivities, 1);
    assert.equal(result.undecodedPayloads, 0);
    assert.equal(store.activities.listPayloads()[0].decoder, SPORT_DECODER);
    const [activity] = store.activities.allActivities();
    assert.deepEqual([activity.format, activity.verification, activity.sportType, activity.startTime, activity.distance, activity.avgHr],
      ["fit", "verified", 100, expected.t0, 60, 140]);
    const localSource = new LocalActivitySource(store.activities, store.archive);
    const detail = await localSource.getActivityDetail(activity.activityId, 100);
    assert.equal(detail.laps.length, 2);
    assert.ok(detail.track.points.length > 0);
    assert.equal((await service.sync()).newActivities, 0, "re-reading the same file adds nothing");
  });

  await test("payloads another decoder version couldn't decode are decoded at startup", async () => {
    const store = freshStore("redecode");
    const { file } = syntheticRun();
    const stored = await store.archive.storeContent("watch-sync", file, "bin");
    const id = store.activities.insertPayload({ deviceId: localDeviceId("SERIAL-1"), fileIndex: 14, selector: 0, filePath: stored.relativePath, sha256: stored.sha256, sizeBytes: file.length }).id;
    store.activities.recordPayloadDecode(id, OTHER_FAILED, 0, "Not a COROS sport-record file.");
    const tampered = await store.archive.storeContent("watch-sync", Buffer.concat([file, Buffer.from([1])]), "bin");
    const tamperedId = store.activities.insertPayload({ deviceId: localDeviceId("SERIAL-1"), fileIndex: 14, selector: 0, filePath: tampered.relativePath, sha256: stored.sha256.replace(/^./, (c) => (c === "0" ? "1" : "0")), sizeBytes: file.length + 1 }).id;
    store.activities.recordPayloadDecode(tamperedId, OTHER_FAILED, 0, "Not a COROS sport-record file.");
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: fakeWatch(file).transport });
    assert.equal(await service.redecodeArchivedPayloads(), 1, "only the payload whose hash still matches");
    assert.deepEqual(store.activities.listPayloads().map((p) => p.decoder), [SPORT_DECODER, OTHER_FAILED]);
    assert.equal(await service.redecodeArchivedPayloads(), 0);
    assert.equal(store.activities.countActivities().fromWatch, 1);
  });

  await test("activities decoded by another decoder version get the current decoder's FIT file at startup", async () => {
    const store = freshStore("redecode-replace");
    const { file } = syntheticRun();
    const watch = fakeWatch(file);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    await service.sync();
    const [original] = store.activities.allActivities();
    // An activity stored by another decoder version: a different FIT file (no dynamics or training) and decoder name.
    const { writeFitActivity } = await load("localSync/fitWriter.js");
    const oldFit = writeFitActivity({ sport: 1, startTs: original.startTime, endTs: original.endTime, activeWindows: [[original.startTime, original.endTime]], laps: [], samples: [], createdTs: original.endTime });
    const oldStored = await store.archive.storeContent("fit", oldFit, "fit");
    store.activities.replaceActivityFile(original.activityId, { filePath: oldStored.relativePath, sha256: oldStored.sha256, sizeBytes: oldStored.sizeBytes });
    store.db.prepare("UPDATE local_sync_payloads SET decoder = ?").run(OTHER_SPORT_DECODER);

    assert.equal(await service.redecodeArchivedPayloads(), 0, "no new activity");
    const [upgraded] = store.activities.allActivities();
    assert.equal(upgraded.activityId, original.activityId);
    assert.equal(upgraded.sha256, original.sha256, "back to the current decoder's file");
    assert.equal(fs.existsSync(store.archive.resolve(oldStored.relativePath)), false, "the replaced file is removed");
    assert.equal(store.activities.listPayloads()[0].decoder, SPORT_DECODER);

    const detail = await new LocalActivitySource(store.activities, store.archive).getActivityDetail(upgraded.activityId, 100);
    assert.equal(detail.trainingLoad, 35);
    assert.deepEqual(detail.trainingEffect, { aerobic: 2.7, anaerobic: 0.8, focus: 3, aerobicLoad: 30, anaerobicLoad: 5, sevenDayLoad: 310, recommendedLoadMin: 200, recommendedLoadMax: 500 });
    assert.deepEqual(detail.runningDynamics, { verticalOscillationMm: 80, groundTimeMs: 258, verticalRatio: 7.6, stepLengthMm: 1000 });
    assert.equal(detail.avgCadence, 170, "steps per minute, like COROS shows runs");
    assert.equal(detail.maxCadence, 180);
    const frequencyList = detail.raw.frequencyList;
    assert.equal(frequencyList.length, 21);
    const sample = frequencyList.find((entry) => entry.timestamp === (original.startTime + 4) * 100);
    assert.deepEqual([sample.groundTime, sample.verticalVibration, sample.verticalStrideRatio, sample.cadenceLength, sample.cadence], [252, 80, 77, 102, 170]);
    assert.equal(sample.adjustedPace, Math.round((1000 / (724 / 360)) * 10) / 10);
    assert.deepEqual(detail.raw.pauseList, [{ startTimestamp: (original.startTime + 10) * 100, endTimestamp: (original.startTime + 21) * 100 }]);
  });

  await test("an interrupted sync resumes from the last durable block", async () => {
    const store = freshStore("resume");
    const watch = fakeWatch(payload, { failAt: 3 });
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    await assert.rejects(service.sync(), /disconnected/);
    assert.equal(watch.state.released, 1, "a block request that failed partway disconnects, to stop the rest of the block");
    const checkpoint = store.activities.getCheckpoint(localDeviceId("SERIAL-1"), 14, 0);
    assert.equal(checkpoint.offsetBytes, 8192);
    assert.equal(store.activities.recentRuns(1)[0].state, "failed");
    watch.state.requests = [];
    const result = await service.sync();
    assert.equal(watch.state.requests[0], 8192, "resumed at the durable offset");
    assert.equal(result.newActivities, 2);
    assert.deepEqual(fs.readFileSync(store.archive.resolve(store.activities.listPayloads()[0].filePath)), payload);
  });

  await test("a watch file that changed while interrupted restarts from zero", async () => {
    const store = freshStore("changed");
    const watch = fakeWatch(payload, { failAt: 2 });
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    await assert.rejects(service.sync());
    const grown = Buffer.concat([payload, syntheticRun({ startUnix: PAYLOAD_START + 3 * 86_400 }).file]);
    watch.state.content = grown;
    watch.state.requests = [];
    const result = await service.sync();
    assert.deepEqual(watch.state.requests.slice(0, 2), [4096, 0]);
    assert.equal(result.newActivities, 3);
    assert.deepEqual(fs.readFileSync(store.archive.resolve(store.activities.listPayloads()[0].filePath)), grown);
  });

  await test("a payload whose import failed is imported on the next sync", async () => {
    const store = freshStore("retry");
    const watch = fakeWatch(payload);
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    const storeContent = store.archive.storeContent.bind(store.archive);
    let failures = 1;
    store.archive.storeContent = async (...args) => {
      if (failures-- > 0) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      return storeContent(...args);
    };
    await assert.rejects(service.sync(), /ENOSPC/);
    assert.equal(store.activities.countActivities().total, 0);
    const result = await service.sync();
    assert.equal(result.newActivities, 2, "the unchanged watch file is imported rather than skipped");
  });

  await test("cancelling stops at a block boundary and keeps saved blocks", async () => {
    const store = freshStore("cancel");
    const watch = fakeWatch(payload);
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    watch.state.onRead = () => { if (watch.state.requests.length === 2) service.cancel(); };
    await assert.rejects(service.sync(), /cancelled/);
    assert.equal(watch.state.released, 0, "a cancel between blocks keeps the watch connected");
    assert.equal(store.activities.getCheckpoint(localDeviceId("SERIAL-1"), 14, 0).offsetBytes, 8192, "the block in flight is kept");
    assert.equal(store.activities.recentRuns(1)[0].state, "cancelled");
  });

  // ----- damaged payloads and storage growth -----

  /** Three activities in one file (6 pages): the stored copy's last page starts well after the first block. */
  const runs = (count, from = 0) => Buffer.concat(Array.from({ length: count }, (_, index) => syntheticRun({ startUnix: 1_767_247_200 + (from + index) * 86_400 }).file));

  await test("an activity with damaged times is set aside; the others import, and the payload isn't retried every launch", async () => {
    const store = freshStore("damaged");
    const damaged = Buffer.from(syntheticRun().file);
    damaged[4748] = 0x7d; // the stop time, about 54 years after the start (QA reproduction)
    const file = Buffer.concat([damaged, runs(1, 1)]);
    const watch = fakeWatch(file);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    const result = await service.sync();
    assert.deepEqual([result.state, result.newActivities, result.undecodedPayloads], ["done", 1, 1]);
    const [payloadRow] = store.activities.listPayloads();
    assert.equal(payloadRow.decoder, SPORT_DECODER);
    assert.match(payloadRow.decodeError, /1 activity set aside/);
    assert.deepEqual(fs.readFileSync(store.archive.resolve(payloadRow.filePath)), file, "the raw payload stays archived for a later decoder");
    assert.equal((await service.sync()).newActivities, 0);

    // A payload no decoder version reads: recorded once with its error, then left alone until the decoder version changes.
    const unreadable = Buffer.alloc(4096, 0x5a);
    const stored = await store.archive.storeContent("watch-sync", unreadable, "bin");
    const id = store.activities.insertPayload({ deviceId: localDeviceId("SERIAL-1"), fileIndex: 14, selector: 0, filePath: stored.relativePath, sha256: stored.sha256, sizeBytes: unreadable.length }).id;
    store.activities.recordPayloadDecode(id, OTHER_FAILED, 0, "marker");
    await service.redecodeArchivedPayloads();
    const failed = () => store.activities.listPayloads().find((payload) => payload.id === id);
    assert.deepEqual([failed().decoder, failed().decodeError], [`failed:${SPORT_DECODER}`, "Not a COROS sport-record file."], "another decoder version tries again");
    store.activities.recordPayloadDecode(id, `failed:${SPORT_DECODER}`, 0, "marker");
    await service.redecodeArchivedPayloads();
    assert.equal(failed().decodeError, "marker", "not tried again by the same decoder version");
    assert.ok(fs.existsSync(store.archive.resolve(failed().filePath)), "kept archived");
  });

  await test("a payload whose decoding never finished (the app crashed or hung) isn't decoded again, at launch or by a sync", async () => {
    const store = freshStore("interrupted");
    const deviceId = localDeviceId("SERIAL-1");
    const file = runs(2);
    const watch = fakeWatch(file);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    // What a process that died while decoding leaves: the payload stored and marked, the checkpoint not moved on.
    const stored = await store.archive.storeContent("watch-sync", file, "bin");
    const id = store.activities.insertPayload({ deviceId, fileIndex: 14, selector: 0, filePath: stored.relativePath, sha256: stored.sha256, sizeBytes: file.length }).id;
    store.activities.recordPayloadDecode(id, `failed:${SPORT_DECODER}`, 0, INTERRUPTED_DECODE);
    const row = (rowId = id) => store.activities.listPayloads().find((payload) => payload.id === rowId);
    assert.equal(await service.redecodeArchivedPayloads(), 0, "the next launch leaves it for another decoder version");
    const result = await service.sync();
    assert.deepEqual([result.state, result.newActivities, result.undecodedPayloads], ["done", 0, 1], "nor does the next sync decode it");
    assert.deepEqual([row().decoder, row().decodeError], [`failed:${SPORT_DECODER}`, INTERRUPTED_DECODE]);
    assert.equal(store.activities.getCheckpoint(deviceId, 14, 0).lastPayloadSha256, stored.sha256, "the checkpoint moves on");
    assert.equal((await service.sync()).newActivities, 0);
    assert.equal(store.activities.listPayloads().length, 1);

    // A failure while storing the activities (not while decoding) puts the earlier state back, so it is tried again.
    const other = runs(1, 5);
    const otherStored = await store.archive.storeContent("watch-sync", other, "bin");
    const otherId = store.activities.insertPayload({ deviceId, fileIndex: 14, selector: 0, filePath: otherStored.relativePath, sha256: otherStored.sha256, sizeBytes: other.length }).id;
    store.activities.recordPayloadDecode(otherId, OTHER_FAILED, 0, "marker");
    const full = Object.create(store.archive, { storeContent: { value: async () => { throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }); } } });
    await assert.rejects(new WatchActivityService({ repository: store.activities, archive: full, transport: watch.transport }).redecodeArchivedPayloads(), /ENOSPC/);
    assert.deepEqual([row(otherId).decoder, row(otherId).decodeError], [OTHER_FAILED, "marker"]);
    assert.equal(await service.redecodeArchivedPayloads(), 1);
    assert.equal(row(otherId).decoder, SPORT_DECODER);
  });

  await test("an undecodable watch file is kept once however often it grows, and isn't decoded again while unchanged", async () => {
    const store = freshStore("undecodable-growth");
    const watch = fakeWatch(Buffer.alloc(4096, 0x5a));
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    for (let round = 1; round <= 5; round++) {
      const result = await service.sync();
      assert.deepEqual([result.state, result.newActivities, result.undecodedPayloads], ["done", 0, 1]);
      if (round < 5) watch.state.content = Buffer.concat([watch.state.content, Buffer.alloc(4096, 0x5a + round)]);
    }
    const rows = store.activities.listPayloads();
    assert.deepEqual(rows.map((row) => [row.sizeBytes, row.decoder]), [[5 * 4096, `failed:${SPORT_DECODER}`]], "one copy: the newest, which holds the older ones");
    assert.deepEqual(fs.readFileSync(store.archive.resolve(rows[0].filePath)), watch.state.content, "the raw bytes stay archived");
    assert.equal(fs.readdirSync(path.join(store.archive.root, "watch-sync"), { recursive: true }).filter((name) => name.endsWith(".bin")).length, 1);

    // The daily-history file: the same rules.
    const db = new Database(":memory:");
    createLocalDataTables(db);
    let daily = Buffer.alloc(4096, 0x5a);
    const health = new LocalDataService({
      database: db, userDataPath: path.join(root, "daily-undecodable"),
      link: {
        watch: () => ({ serialOrName: "SERIAL-1", name: "PACE 4", model: "pace-4", firmware: "V3.2008.0" }),
        runExclusive: (task) => task(),
        readSyncBlock: async (fileIndex, offset) => fileIndex === 14
          ? { block: Buffer.from(payload.subarray(offset, offset + 4096)), remaining: payload.length - offset }
          : { block: daily.subarray(offset, offset + 4096), remaining: daily.length - offset },
        readPedometer: async () => Buffer.from("e110000090d00300f0490200580200000a120000", "hex"),
        disconnect: async () => undefined,
        watchKeySaved: () => true
      }
    });
    let decodes = 0;
    const record = health.activities.recordPayloadDecode.bind(health.activities);
    health.activities.recordPayloadDecode = (...args) => { if (args[3] === INTERRUPTED_DECODE) decodes += 1; return record(...args); };
    for (let round = 1; round <= 4; round++) {
      assert.equal((await health.syncWatch()).health.ok, false);
      daily = Buffer.concat([daily, Buffer.alloc(4096, 0x5a + round)]);
    }
    const dailyRows = () => health.activities.listPayloads().filter((row) => row.fileIndex === 5);
    assert.deepEqual(dailyRows().map((row) => [row.sizeBytes, row.decoder]), [[4 * 4096, `failed:${DAILY_DECODER}`]]);
    daily = daily.subarray(0, 4 * 4096);
    decodes = 0;
    const again = await health.syncWatch();
    assert.equal(again.health.ok, false);
    assert.equal(again.health.error, dailyRows()[0].decodeError, "the stored error is reported");
    assert.equal(decodes, 0, "the unchanged daily file isn't decoded again");
    assert.equal(dailyRows().length, 1);
  });

  await test("activity file: an unchanged watch file reads two blocks and stores nothing new", async () => {
    const store = freshStore("incremental");
    const file = runs(3);
    assert.equal(file.length, 6 * 4096);
    const watch = fakeWatch(file);
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    assert.equal((await service.sync()).newActivities, 3);
    assert.equal(watch.state.requests.length, 6, "the first sync reads everything");
    watch.state.requests = [];
    for (let round = 0; round < 3; round++) assert.equal((await service.sync()).newActivities, 0);
    assert.deepEqual(watch.state.requests, [0, 20_480, 0, 20_480, 0, 20_480], "the first block and the stored copy's last page, nothing else");
    assert.equal(store.activities.listPayloads().length, 1);
    assert.equal(fs.readdirSync(path.join(store.archive.root, "watch-sync"), { recursive: true }).filter((name) => name.endsWith(".bin")).length, 1);
  });

  await test("activity file: appended data is read from the stored copy's last page, and the superseded copy is removed", async () => {
    const store = freshStore("appended");
    const watch = fakeWatch(runs(3));
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    await service.sync();
    const [first] = store.activities.listPayloads();
    watch.state.content = runs(4);
    watch.state.requests = [];
    const result = await service.sync();
    assert.equal(result.newActivities, 1);
    assert.deepEqual(watch.state.requests, [0, 20_480, 24_576, 28_672], "only the last stored page and the new pages");
    const payloads = store.activities.listPayloads();
    assert.equal(payloads.length, 1, "the older copy, a prefix of the new one, is removed");
    assert.deepEqual(fs.readFileSync(store.archive.resolve(payloads[0].filePath)), runs(4), "the stored file is byte-identical to the watch's");
    assert.equal(fs.existsSync(store.archive.resolve(first.filePath)), false);
    assert.ok(store.activities.allActivities().every((activity) => activity.payloadId === payloads[0].id), "activities point at the copy that remains");
    assert.equal(store.activities.countActivities().fromWatch, 4);

    // Rewritten by the COROS app (an older activity acknowledged away): read in full, and the old copy, no prefix of it, is kept.
    watch.state.content = runs(3, 1);
    watch.state.requests = [];
    assert.equal((await service.sync()).newActivities, 0);
    assert.deepEqual(watch.state.requests, [0, 4096, 8192, 12_288, 16_384, 20_480], "the first block differs: everything is read");
    assert.equal(store.activities.listPayloads().length, 2);
    // Shrunk to less than the stored copy: also a full read.
    watch.state.content = runs(1, 1);
    watch.state.requests = [];
    await service.sync();
    assert.deepEqual(watch.state.requests, [0, 4096]);
  });

  await test("activity file: a stored copy whose last page changed is re-read in full, and an interrupted incremental read resumes", async () => {
    const store = freshStore("tail-changed");
    const original = runs(3);
    const watch = fakeWatch(original);
    watch.attach(store.archive);
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    await service.sync();
    const changed = Buffer.concat([original.subarray(0, 21_000), Buffer.alloc(original.length - 21_000, 0xee), runs(1, 5)]);
    watch.state.content = changed;
    watch.state.requests = [];
    await service.sync();
    assert.deepEqual(watch.state.requests.slice(0, 3), [0, 20_480, 0], "the last page differs: start over from 0");
    assert.deepEqual(fs.readFileSync(store.archive.resolve(store.activities.listPayloads().at(-1).filePath)), changed);

    watch.state.content = Buffer.concat([changed, runs(2, 6)]);
    watch.state.requests = [];
    watch.state.failAt = 3;
    await assert.rejects(service.sync(), /disconnected/);
    assert.deepEqual(watch.state.requests, [0, 28_672, 32_768], "incremental, then cut off at the first new block");
    watch.state.requests = [];
    await service.sync();
    assert.deepEqual(watch.state.requests, [32_768, 36_864, 40_960, 45_056], "resumed at the durable offset of the incremental read");
    assert.deepEqual(fs.readFileSync(store.archive.resolve(store.activities.listPayloads().at(-1).filePath)), watch.state.content);
  });

  await test("daily history: unchanged syncs store nothing, appended data reads only the new pages, superseded copies are removed", async () => {
    const db = new Database(":memory:");
    createLocalDataTables(db);
    const day = syntheticDaily().file;
    let content = Buffer.concat([day, day]); // 4 pages; decoding the repeat adds nothing
    const reads = [];
    const service = new LocalDataService({
      database: db, userDataPath: path.join(root, "daily-growth"),
      link: {
        watch: () => ({ serialOrName: "SERIAL-1", name: "PACE 4", model: "pace-4", firmware: "V3.2008.0" }),
        runExclusive: (task) => task(),
        readSyncBlock: async (fileIndex, offset) => {
          if (fileIndex === 14) return { block: Buffer.from(syntheticRun().file.subarray(offset, offset + 4096)), remaining: 8192 - offset };
          reads.push(offset);
          return { block: content.subarray(offset, offset + 4096), remaining: content.length - offset };
        },
        readPedometer: async () => Buffer.from("e110000090d00300f0490200580200000a120000", "hex"),
        disconnect: async () => undefined,
        watchKeySaved: () => true
      }
    });
    const dailyPayloads = () => service.activities.listPayloads().filter((payload) => payload.fileIndex === 5);
    const archived = () => fs.readdirSync(path.join(service.archive.root, "watch-sync"), { recursive: true }).filter((name) => name.endsWith(".bin")).length;
    assert.equal((await service.syncWatch()).health.ok, true);
    assert.deepEqual(reads, [0, 4096, 8192, 12_288]);
    const files = archived();
    for (let round = 0; round < 3; round++) {
      reads.length = 0;
      assert.equal((await service.syncWatch()).health.ok, true);
      assert.deepEqual(reads, [0, 12_288], "first block and the stored copy's last page");
    }
    assert.deepEqual([dailyPayloads().length, archived()], [1, files], "repeated syncs with unchanged data store nothing new");

    // The watch recorded more: only the stored copy's last page and what follows are read; one copy remains.
    content = Buffer.concat([content, Buffer.alloc(5000, 0xff)]);
    reads.length = 0;
    assert.equal((await service.syncWatch()).health.ok, true);
    assert.deepEqual(reads, [0, 12_288, 16_384, 20_480]);
    const [kept] = dailyPayloads();
    assert.equal(dailyPayloads().length, 1);
    assert.deepEqual(fs.readFileSync(service.archive.resolve(kept.filePath)), content);
    assert.equal(archived(), files, "the superseded copy's file is removed too");
  });

  await test("pruning keeps referenced copies, copies no current decoder read, copies that aren't a prefix, and failed copies only once", async () => {
    const store = freshStore("prune");
    const deviceId = "dev-prune";
    const add = async (bytes, decoder) => {
      const stored = await store.archive.storeContent("watch-sync", bytes, "bin");
      const { id } = store.activities.insertPayload({ deviceId, fileIndex: 14, selector: 0, filePath: stored.relativePath, sha256: stored.sha256, sizeBytes: bytes.length });
      if (decoder) store.activities.recordPayloadDecode(id, decoder, 0);
      return { id, filePath: stored.relativePath };
    };
    const current = (decoder) => decoder === "current";
    const deps = { repository: store.activities, archive: store.archive };
    const older = await add(Buffer.from("aaaa"), "current");
    const unrelated = await add(Buffer.from("zzzzzz"), "current");
    const newest = await add(Buffer.from("aaaabbbb"), "failed:current");
    const ids = () => store.activities.listPayloads().map((payload) => payload.id).sort();
    assert.deepEqual(await pruneSupersededPayloads(deps, deviceId, 14, current), { removed: 0, freedBytes: 0 }, "an undecoded copy supersedes nothing");
    store.activities.recordPayloadDecode(newest.id, "current", 1);
    store.activities.insertActivity({ activityId: "summary", deviceId, watchActivityId: "w", source: "watch-ble", provenance: "watch", filePath: older.filePath, payloadId: older.id,
      format: "coros-record", sha256: "1".repeat(64), sizeBytes: 0, verification: "undecoded", sportType: 100 });
    assert.equal((await pruneSupersededPayloads(deps, deviceId, 14, current)).removed, 0, "a file an activity points at is kept");
    store.db.prepare("UPDATE local_activity_files SET file_path = 'fit/00/x.fit'").run();
    assert.deepEqual(await pruneSupersededPayloads(deps, deviceId, 14, current), { removed: 1, freedBytes: 4 });
    assert.deepEqual(ids(), [unrelated.id, newest.id].sort(), "the unrelated copy (no prefix) stays");
    assert.equal(store.activities.getActivity("summary").payloadId, newest.id);
    assert.equal(fs.existsSync(store.archive.resolve(older.filePath)), false);
    // A copy the current decoder failed on supersedes only a smaller prefix that failed the same way.
    const decodedSmall = await add(Buffer.from("cc"), "current");
    const otherFailure = await add(Buffer.from("ccc"), "failed:older");
    const failedSmall = await add(Buffer.from("cccc"), "failed:current");
    const failedLarge = await add(Buffer.from("cccccc"), "failed:current");
    assert.deepEqual(await pruneSupersededPayloads(deps, deviceId, 14, current), { removed: 1, freedBytes: 4 });
    assert.deepEqual(ids(), [unrelated.id, newest.id, decodedSmall.id, otherFailure.id, failedLarge.id].sort(), "a decoded copy and another failure stay");
    assert.equal(fs.existsSync(store.archive.resolve(failedSmall.filePath)), false);
    assert.equal(nextOffsetAfterStoredCopy(Buffer.from("abc"), Buffer.from("abd"), 0, 10), "mismatch");
    assert.equal(nextOffsetAfterStoredCopy(Buffer.alloc(9000), Buffer.alloc(4096), 0, 8000), "mismatch", "the file shrank");
    assert.equal(nextOffsetAfterStoredCopy(Buffer.alloc(9000), Buffer.alloc(4096), 0, 9000), 8192);
  });

  await test("backups and restore work with the pruned layout, and restored payloads re-decode when the decoder version changes", async () => {
    const source = freshStore("pruned-backup");
    const watch = fakeWatch(runs(3));
    const service = new WatchActivityService({ repository: source.activities, archive: source.archive, transport: watch.transport });
    await service.sync();
    watch.state.content = runs(4);
    await service.sync();
    assert.equal(source.activities.listPayloads().length, 1);
    const file = path.join(root, "pruned.zip");
    await exportLocalBackup({ repository: source.activities, health: source.health, archive: source.archive }, file);
    const target = freshStore("pruned-restore");
    const restored = await restoreLocalBackup({ repository: target.activities, health: target.health, archive: target.archive }, file);
    assert.deepEqual([restored.activitiesAdded, restored.verifiedFiles], [4, 5]);
    const [payloadRow] = target.activities.listPayloads();
    assert.ok(target.activities.allActivities().every((activity) => activity.payloadId === payloadRow.id));
    target.db.prepare("UPDATE local_sync_payloads SET decoder = ?").run(OTHER_SPORT_DECODER);
    const again = new WatchActivityService({ repository: target.activities, archive: target.archive, transport: fakeWatch(runs(4)).transport });
    assert.equal(await again.redecodeArchivedPayloads(), 0);
    assert.equal(target.activities.listPayloads()[0].decoder, SPORT_DECODER);
  });

  await test("watch sync is limited to tested models", async () => {
    assert.equal(watchSyncSupport("pace-4").supported, true);
    // The PACE 4 Pro and PACE Pro 3.2008.0 firmware write and serve the record files with the PACE 4's code.
    assert.equal(watchSyncSupport("pace-4-pro").supported, true);
    assert.equal(watchSyncSupport("pace-pro").supported, true);
    // So do the APEX 4 (same code) and the PACE 3 (same source on a PSoC 6: identical log lines and record descriptors).
    assert.equal(watchSyncSupport("apex-4").supported, true);
    assert.equal(watchSyncSupport("pace-3").supported, true);
    assert.equal(watchSyncSupport("nomad").supported, false);
    assert.equal(watchSyncSupport("apex-2").supported, false);
    assert.equal(watchSyncSupport(undefined).supported, false);
    const store = freshStore("model");
    const watch = fakeWatch(payload, { model: "vertix-2" });
    const service = new WatchActivityService({ repository: store.activities, archive: store.archive, transport: watch.transport });
    await assert.rejects(service.sync(), /isn't available for this watch model/);
    assert.deepEqual(watch.state.requests, []);
  });

  await test("the probe reads one block, never acknowledges, keeps the watch connected and captures without the serial", async () => {
    const db = new Database(":memory:");
    createLocalDataTables(db);
    const calls = [];
    const captureDir = path.join(root, "probe-captures");
    const capture = new SyncCaptureLog(captureDir, { appVersion: "test" });
    const service = new LocalDataService({
      database: db, userDataPath: path.join(root, "probe-user"), capture,
      link: {
        watch: () => ({ serialOrName: "SERIAL-SECRET-123", name: "PACE 4 NAME-SECRET", model: "pace-4", firmware: "V3.2008.0" }),
        runExclusive: (task) => task(),
        readSyncBlock: async (...args) => { calls.push(["read", ...args]); return { block: payload.subarray(0, 4096), remaining: payload.length }; },
        readPedometer: async () => Buffer.alloc(0),
        disconnect: async () => { calls.push(["disconnect"]); },
        watchKeySaved: () => true
      }
    });
    const probe = await service.probeWatchSync();
    assert.deepEqual(calls, [["read", 14, 0, 0]], "no disconnect after stopping between blocks");
    assert.equal(probe.ok, true);
    assert.equal(probe.totalBytes, payload.length);
    assert.equal(probe.blockBytes, 4096);
    assert.equal(probe.looksLike, "unknown", "the sport-record file is neither a FIT file nor an HF container");
    assert.equal(probe.firstBytesHex, payload.subarray(0, 64).toString("hex"));
    const lines = fs.readFileSync(probe.captureFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.type), ["session", "probe-start", "probe-end"]);
    assert.deepEqual(lines[1].watch, { model: "pace-4", firmware: "V3.2008.0" });
    assert.equal(fs.readFileSync(probe.captureFile, "utf8").includes("SERIAL-SECRET"), false);
    assert.equal(fs.readFileSync(probe.captureFile, "utf8").includes("NAME-SECRET"), false, "nor the per-device Bluetooth name");
    if (process.platform !== "win32") assert.equal(fs.statSync(probe.captureFile).mode & 0o777, 0o600);
    assert.equal((await service.overview()).captureEnabled, true);
    assert.equal(syncCaptureEnabled({ COROSLINK_SYNC_CAPTURE: "1" }), true);
    assert.equal(syncCaptureEnabled({}), false);
    // A block request that fails partway disconnects, to stop a block the watch may still be sending.
    calls.length = 0;
    const failing = new LocalDataService({
      database: db, userDataPath: path.join(root, "probe-user"),
      link: {
        watch: () => ({ serialOrName: "SERIAL-1", name: "PACE 4", model: "pace-4", firmware: "V3.2008.0" }),
        runExclusive: (task) => task(),
        readSyncBlock: async (...args) => { calls.push(["read", ...args]); throw new Error("The watch returned invalid or incomplete records."); },
        readPedometer: async () => Buffer.alloc(0),
        disconnect: async () => { calls.push(["disconnect"]); },
        watchKeySaved: () => true
      }
    });
    assert.equal((await failing.probeWatchSync()).ok, false);
    assert.deepEqual(calls, [["read", 14, 0, 0], ["disconnect"]]);
  });

  // ----- day totals -----

  await test("the watch's figures per day: VO₂ max (rides carry the cycling one), recovery time, Base Fitness, Load Impact and fatigue", async () => {
    const db = new Database(":memory:");
    createLocalDataTables(db);
    const dir = fs.mkdtempSync(path.join(root, "vo2-"));
    const day = 1_767_247_200;
    const none = { baseFitness: 0, loadImpact: 0, fatigue: 0 };
    const records = [
      { id: "morning-run", startUnix: day, deviceSport: 0, vo2max: 43, recovery: 3600, balance: { baseFitness: 48, loadImpact: 61, fatigue: 127 } },
      { id: "noon-ride", startUnix: day + 3 * 3600, deviceSport: 4, vo2max: 51, recovery: 20_000, balance: { baseFitness: 49, loadImpact: 70, fatigue: 143 } },
      // More than the watch's 120 h countdown: capped like the watch does.
      { id: "evening-run", startUnix: day + 6 * 3600, deviceSport: 0, vo2max: 44, recovery: 200 * 3600, balance: { baseFitness: 50, loadImpact: 72, fatigue: 144 } },
      { id: "next-day-first-run", startUnix: day + 86_400, deviceSport: 0, vo2max: 0, recovery: 0, balance: none },
      // A FIT file imported from elsewhere may use the same field names: never taken as the watch's.
      { id: "imported", startUnix: day + 86_400 + 3600, deviceSport: 0, vo2max: 60, recovery: 9999, balance: { baseFitness: 90, loadImpact: 10, fatigue: 11 }, provenance: "file" }
    ].map(({ id, provenance = "watch", ...options }) => {
      const session = decodeCorosSportRecordFile(syntheticRun(options).file).sessions[0];
      const fit = corosSessionToFit(session);
      fs.writeFileSync(path.join(dir, `${id}.fit`), fit);
      return { activityId: id, provenance, format: "fit", filePath: `${id}.fit`, sha256: crypto.createHash("sha256").update(fit).digest("hex"),
        sportType: session.sportType, startTime: session.startTs, endTime: session.endTs, distance: session.distanceM, duration: session.elapsedSec };
    });
    assert.deepEqual(records.map((record) => record.sportType), [100, 200, 100, 100, 100]);
    const metrics = new LocalTrainingMetrics(db,
      { listActivities: ({ page }) => (page === 1 ? records : []) },
      { listDays: () => [] },
      { resolve: (file) => path.join(dir, file) });
    const dayOf = (ts) => { const date = new Date(ts * 1000); return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`; };
    const pick = ({ happenDay, vo2max, recoveredAt, baseFitness, loadImpact, fatigue }) => ({ happenDay, vo2max, recoveredAt, baseFitness, loadImpact, fatigue });
    for (let pass = 0; pass < 2; pass++) {
      // The second pass reads the cache.
      const { dayList } = metrics.dailyMetrics([dayOf(day), dayOf(day + 86_400)]);
      assert.deepEqual(dayList.map(pick), [
        { happenDay: dayOf(day), vo2max: 44, recoveredAt: records[2].endTime + 120 * 3600, baseFitness: 50, loadImpact: 72, fatigue: 144 },
        { happenDay: dayOf(day + 86_400), vo2max: undefined, recoveredAt: records[3].endTime, baseFitness: undefined, loadImpact: undefined, fatigue: undefined }
      ], `pass ${pass}: each figure from the day's last activity; the ride's cycling VO₂ max and the imported file left out`);
    }
  });

  await test("watch sync reads the daily history (never acknowledged) and serves sleep, HRV and stress locally", async () => {
    const db = new Database(":memory:");
    createLocalDataTables(db);
    const { file: daily } = syntheticDaily();
    const { file: sport } = syntheticRun();
    const calls = [];
    let dailyReads = 0;
    // Exclusive like the real link: a second sync while one runs is refused.
    let exclusive = false;
    const service = new LocalDataService({
      database: db, userDataPath: path.join(root, "daily-user"),
      link: {
        watch: () => ({ serialOrName: "SERIAL-1", name: "PACE 4", model: "pace-4", firmware: "V3.2008.0" }),
        runExclusive: async (task) => {
          if (exclusive) throw new Error("A watch sync is already running.");
          exclusive = true;
          try { return await task(); } finally { exclusive = false; }
        },
        readSyncBlock: async (fileIndex, offset) => {
          calls.push([fileIndex, offset]);
          if (fileIndex === 14) return { block: sport.subarray(offset, offset + 4096), remaining: sport.length - offset };
          // The watch keeps appending while it records: later headers report a longer file.
          const grown = Buffer.concat([daily, dailyReads++ > 0 ? Buffer.alloc(4096, 0xff) : Buffer.alloc(0)]);
          return { block: grown.subarray(offset, offset + 4096), remaining: grown.length - offset };
        },
        readPedometer: async () => Buffer.from("e110000090d00300f0490200580200000a120000", "hex"),
        disconnect: async () => { calls.push(["disconnect"]); },
        watchKeySaved: () => true,
        listTrainingPlans: async () => [],
        sendTrainingPlan: async (file) => { calls.push(["calendar", file.subarray(0, 4).toString("latin1")]); return { listed: true }; }
      },
      pushTrainingCalendar: () => true
    });
    // A workout planned for tomorrow goes onto the watch's calendar during the sync.
    const tomorrow = new Date(Date.now() + 86_400_000);
    const happenDay = Number(`${tomorrow.getFullYear()}${String(tomorrow.getMonth() + 1).padStart(2, "0")}${String(tomorrow.getDate()).padStart(2, "0")}`);
    service.trainingBackend.request("/training/schedule/update", { body: {
      entities: [{ happenDay, idInPlan: 1, sortNoInSchedule: 1 }],
      programs: [{ id: "9", name: "Easy", sportType: 1, exercises: [{ id: 1, name: "Run", targetType: 2, targetValue: 1800, exerciseType: 2 }] }],
      versionObjects: [{ id: 1, status: 1 }]
    } });
    const synced = await service.syncWatch();
    assert.deepEqual(synced.calendar, { ok: true, workouts: 1, listed: true });
    const calendarCall = calls.findIndex((call) => call[0] === "calendar");
    assert.deepEqual(calls[calendarCall], ["calendar", "HF\0*"], "an HF file of type 42, the training plan");
    assert.ok(calendarCall > calls.findLastIndex((call) => call[0] === 14), "after the reads, so a failed write can't cost them");
    assert.equal(synced.health.ok, true);
    assert.equal(synced.health.newSleeps, 2);
    const { local } = syntheticDaily();
    assert.equal(synced.health.latestReadingAt, local(2026, 1, 2, 12, 0), "the newest reading of any kind (here an HRV reading)");
    const dailyOffsets = calls.filter((call) => call[0] === 5).map((call) => call[1]);
    assert.deepEqual(dailyOffsets, Array.from({ length: daily.length / 4096 }, (_, index) => index * 4096), "read up to the length first reported");
    assert.equal(calls.some((call) => call[0] === "disconnect"), false, "the watch stays connected after the sync");
    const payloads = service.activities.listPayloads();
    assert.deepEqual(payloads.map((p) => [p.fileIndex, p.decoder]).sort(), [[14, SPORT_DECODER], [5, DAILY_DECODER]].sort());
    const heart = service.health.listSamples("heart_rate", 0, 2 ** 31);
    assert.equal(heart.length, 18 * 60 + 1, "every minute, plus one one-off reading");
    assert.ok(heart.every((sample) => sample.source === "ble:daily" && sample.provenance === "watch" && sample.utcOffsetMinutes === 420));
    assert.equal(service.health.listSamples("stress", 0, 2 ** 31).length, 2);
    assert.equal(service.health.listSamples("hrv_rmssd", 0, 2 ** 31).length, 3);

    const sleep = await service.healthSource.getSleep(7);
    assert.equal(sleep.records.length, 1, "the night's two segments make one main record");
    const night = sleep.latest;
    assert.deepEqual([night.happenDay, night.kind, night.sleepStart, night.sleepEnd, night.windowMinutes], ["20260102", "main", "23:00", "07:13", 493]);
    assert.equal(night.deepMinutes + night.lightMinutes + night.remMinutes, night.totalMinutes);
    assert.equal(night.totalMinutes + night.awakeMinutes, night.windowMinutes, "time between segments counts as awake");
    assert.equal(night.score, undefined, "no invented sleep score");
    const hrv = await service.healthSource.getInsight("sleepHrv", 7);
    assert.equal(hrv.status, "ready");
    assert.deepEqual(hrv.series[0].points, [{ time: "2026-01-02", value: 35 }]);
    const stress = await service.healthSource.getInsight("stress", 36_500);
    assert.equal(stress.status, "ready");
    assert.equal((await service.healthSource.getInsight("cycle", 7)).status, "unavailable");
    const check = await service.healthSource.getInsight("healthCheck", 36_500);
    assert.equal(check.status, "ready");
    assert.deepEqual(Object.fromEntries(check.metrics.map((metric) => [metric.key, metric.value])),
      { heartRate: 72, hrv: 40, stress: 31, respiratoryRate: 13, spo2: 97, level: "Low" }, "the watch's resting-HR setting is left out");
    assert.deepEqual(check.series.map((series) => [series.key, series.points.length]),
      [["heartRate", 1], ["hrv", 1], ["stress", 1], ["respiratoryRate", 1], ["spo2", 1]]);
    assert.equal(service.health.allHealthChecks().length, 1);
    const run = service.activities.allActivities()[0];
    const runDetail = await service.activitySource.getActivityDetail(run.activityId, run.sportType);
    assert.equal(runDetail.heartRateRecovery.startBpm, 150);
    // Second 60 has no reading (0); the nearest reading (second 59) is used.
    assert.deepEqual([runDetail.heartRateRecovery.dropOneMinute, runDetail.heartRateRecovery.dropTwoMinutes], [150 - 136, 150 - 121]);
    assert.equal(runDetail.heartRateRecovery.samples.length, 120);
    const days = await service.healthSource.getDailyHealth(7);
    assert.ok(days.records.some((record) => record.happenDay === "20260102" && record.steps === 400));
    // Per-day training totals: the watch's training load for the run, its distance and time, and the night's sleep HRV.
    const runDate = new Date(run.startTime * 1000);
    const runDay = `${runDate.getFullYear()}${String(runDate.getMonth() + 1).padStart(2, "0")}${String(runDate.getDate()).padStart(2, "0")}`;
    const metrics = await service.healthSource.getDailyMetrics([runDay, "20260102", "20250101"]);
    const runMetric = metrics.dayList.find((day) => day.happenDay === runDay);
    assert.equal(runMetric.trainingLoad, 35, "low + mid + high load from the watch's analysis");
    assert.equal(runMetric.vo2max, 43, "the watch's VO₂ max stored with the run");
    assert.equal(runMetric.recoveredAt, run.endTime + 7200, "fully recovered 2 h after the run ended");
    assert.deepEqual([runMetric.baseFitness, runMetric.loadImpact, runMetric.fatigue], [48, 61, 127]);
    assert.equal(metrics.dayList.find((day) => day.happenDay === "20260102").vo2max, undefined, "no VO₂ max on a day without an activity");
    assert.equal(runMetric.distance, run.distance);
    assert.ok(runMetric.duration > 0);
    assert.equal(metrics.dayList.find((day) => day.happenDay === "20260102").avgSleepHrv, 35);
    // A day the watch's history covers without activities is a rest day (zero, as in COROS); a day without any data is left out.
    const restDay = metrics.dayList.find((day) => day.happenDay === "20260102");
    assert.deepEqual([restDay.trainingLoad, restDay.distance, restDay.duration], [0, 0, 0]);
    assert.equal(metrics.dayList.some((day) => day.happenDay === "20250101"), false, "no invented rest day without data");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM local_activity_training").get().n, 1, "the FIT file is read once and cached");
    await service.healthSource.getDailyMetrics([runDay]);
    const cachedRow = db.prepare("SELECT training_load, watch_figures FROM local_activity_training").get();
    assert.deepEqual([cachedRow.training_load, JSON.parse(cachedRow.watch_figures)],
      [35, { vo2max: 43, recovery: 7200, baseFitness: 48, loadImpact: 61, fatigue: 127 }]);

    // A daily payload read by another decoder version is re-imported at startup, adding what this one decodes.
    db.prepare("DELETE FROM local_workout_recovery").run();
    db.prepare("UPDATE local_sync_payloads SET decoder = 'coros-daily/v0' WHERE file_index = 5").run();
    await service.redecodeArchivedPayloads();
    assert.equal(service.health.allRecoveries().length, 1);
    assert.equal(service.activities.listPayloads().find((p) => p.fileIndex === 5).decoder, DAILY_DECODER);

    // A second sync of the same daily history adds nothing twice (each sync also takes a new step-counter reading).
    const dailySamples = () => service.health.allSamples().filter((sample) => sample.source === "ble:daily").length;
    const before = dailySamples();
    dailyReads = 0;
    calls.length = 0;
    const second = service.syncWatch();
    await assert.rejects(service.syncWatch(), /already running/, "one sync at a time");
    assert.equal((await second).state, "done", "a second sync right after the first works over the same connection");
    assert.equal(dailySamples(), before);
    assert.equal(service.health.allSleeps().length, 2);
    assert.deepEqual([calls.find((call) => call[0] === 5), calls.find((call) => call[0] === 14)], [[5, 0], [14, 0]], "both files are read again from the start");
    assert.equal(calls.some((call) => call[0] === "disconnect"), false, "still no disconnect");
  });

  await test("sleep sessions and Health Checks survive a backup round trip without overwriting", async () => {
    const source = freshStore("sleep-backup-source");
    const watchHealth = new WatchHealthService(source.health, { identity: () => ({ deviceId: "dev-x" }), exchange: async () => Buffer.alloc(0), readSyncBlock: async () => ({ block: Buffer.alloc(0), remaining: 0 }) });
    watchHealth.importDailyFile("dev-x", syntheticDaily().file);
    const file = path.join(root, "sleep-backup.coroslink-backup");
    await exportLocalBackup({ repository: source.activities, health: source.health, archive: source.archive }, file);
    const target = freshStore("sleep-backup-target");
    await restoreLocalBackup({ repository: target.activities, health: target.health, archive: target.archive }, file);
    assert.deepEqual(target.health.allSleeps(), source.health.allSleeps());
    assert.equal(target.health.restoreSleeps(source.health.allSleeps()), 0);
    assert.equal(source.health.allHealthChecks().length, 1);
    assert.deepEqual(target.health.allHealthChecks(), source.health.allHealthChecks());
    assert.equal(target.health.insertHealthChecks(source.health.allHealthChecks()), 0);
  });

  await test("day totals are stored with provenance and only grow within a day", async () => {
    const store = freshStore("health");
    const reply = (steps) => {
      const body = Buffer.alloc(20);
      body.writeInt32LE(steps, 0); body.writeInt32LE(steps * 75, 4); body.writeInt32LE(steps * 40, 8); body.writeInt32LE(1800, 12); body[16] = 10; body[17] = 18;
      return body;
    };
    let steps = 5000;
    const service = new WatchHealthService(store.health, {
      identity: () => ({ deviceId: "dev-test" }),
      exchange: async (opcode, payloadBytes) => { assert.equal(opcode, 0x90); assert.equal(payloadBytes.toString("hex"), "00"); return reply(steps); }
    }, () => new Date(2026, 9, 18, 12));
    assert.equal((await service.readDayTotals()).day, "20261018");
    steps = 4000; // a stale or partial read never lowers the day's total
    await service.readDayTotals();
    const days = store.health.listDays(7);
    assert.equal(days[0].metrics.steps.value, 5000);
    assert.equal(days[0].metrics.distance.value, 3750);
    assert.equal(days[0].metrics.steps.method, "watch-day-total");
    assert.equal(store.health.allSamples().every((sample) => sample.provenance === "watch" && sample.source === "ble:pedometer"), true);
    const daily = await new LocalHealthDataSource(store.health).getDailyHealth(7);
    assert.deepEqual(daily.latest, { happenDay: "20261018", steps: 5000, calories: 200 });
    // Stress comes from the watch's daily history once read; cloud-computed insights stay unavailable.
    assert.equal((await new LocalHealthDataSource(store.health).getInsight("stress", 7)).status, "empty");
    assert.equal((await new LocalHealthDataSource(store.health).getInsight("healthCheck", 7)).status, "empty");
  });

  // ----- backups -----

  await test("backups round-trip, verify hashes and never include credentials", async () => {
    imports.health.insertSamples([{ deviceId: "dev-test", metric: "steps", ts: 1_792_300_000, value: 9000, unit: "count", source: "ble:pedometer", provenance: "watch" }]);
    imports.health.recordDayTotals("dev-test", "20261018", { steps: { value: 9000, unit: "count" } });
    const file = path.join(root, "backup.zip");
    const exported = await exportLocalBackup({ repository: imports.activities, health: imports.health, archive: imports.archive, appVersion: "test" }, file);
    assert.equal(exported.activities, 2);
    const zip = fs.readFileSync(file).toString("latin1");
    assert.ok(zip.includes("manifest.json") && zip.includes("data/activities.json"));
    assert.equal(/coros\.ble|loginAuth|password|token/i.test(zip), false, "no credentials or settings in the backup");

    const target = freshStore("restore");
    const restored = await restoreLocalBackup({ repository: target.activities, health: target.health, archive: target.archive }, file);
    assert.deepEqual([restored.activitiesAdded, restored.activitiesSkipped, restored.verifiedFiles, restored.healthSamplesAdded], [2, 0, 2, 1]);
    assert.deepEqual(target.activities.allActivities().map((a) => a.sha256), imports.activities.allActivities().map((a) => a.sha256));
    assert.equal(target.health.listDays(1)[0].metrics.steps.value, 9000);
    const detail = await new LocalActivitySource(target.activities, target.archive).getActivityDetail(target.activities.allActivities()[0].activityId);
    assert.equal(detail.laps.length, 2, "a restored database opens offline");
    const again = await restoreLocalBackup({ repository: target.activities, health: target.health, archive: target.archive }, file);
    assert.equal(again.activitiesAdded, 0);

    const tampered = Buffer.from(fs.readFileSync(file));
    const fitAt = tampered.indexOf(Buffer.from(".FIT")) + 20;
    tampered[fitAt] ^= 0xff;
    fs.writeFileSync(path.join(root, "tampered.zip"), tampered);
    await assert.rejects(restoreLocalBackup({ repository: freshStore("t").activities, health: freshStore("t2").health, archive: freshStore("t3").archive }, path.join(root, "tampered.zip")), /damaged|checksum/);
  });

  await test("restore skips FIT rows whose hash does not match their file", async () => {
    const source = freshStore("tamper-source");
    await importFitFiles({ repository: source.activities, archive: source.archive }, [runFile]);
    source.db.prepare("UPDATE local_activity_files SET sha256 = ?").run("0".repeat(64));
    const file = path.join(root, "tampered-rows.zip");
    await exportLocalBackup({ repository: source.activities, health: source.health, archive: source.archive }, file);
    const target = freshStore("tamper-target");
    const restored = await restoreLocalBackup({ repository: target.activities, health: target.health, archive: target.archive }, file);
    assert.deepEqual([restored.activitiesAdded, restored.activitiesSkipped], [0, 1]);
  });

  await test("encrypted backups need the right passphrase", async () => {
    const file = path.join(root, "backup.clbackup");
    await exportLocalBackup({ repository: imports.activities, health: imports.health, archive: imports.archive }, file, { passphrase: "correct horse battery" });
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 8).toString("latin1"), "CLBKENC1");
    assert.equal(bytes.includes(Buffer.from("manifest.json")), false, "nothing readable without the passphrase");
    const target = freshStore("encrypted");
    const deps = { repository: target.activities, health: target.health, archive: target.archive };
    await assert.rejects(restoreLocalBackup(deps, file), /encrypted/);
    await assert.rejects(restoreLocalBackup(deps, file, { passphrase: "wrong passphrase" }), /passphrase is wrong/);
    assert.equal(target.activities.countActivities().total, 0);
    const restored = await restoreLocalBackup(deps, file, { passphrase: "correct horse battery" });
    assert.equal(restored.activitiesAdded, 2);
    assert.deepEqual(fs.readdirSync(target.archive.partialDirectory()), [], "the decrypted temp file is removed");
    await assert.rejects(exportLocalBackup({ repository: imports.activities, health: imports.health, archive: imports.archive }, path.join(root, "x.clbackup"), { passphrase: "short" }), /at least 8/);

    // A restore the app never finished (killed mid-way) leaves its decrypted copy; the next start removes it, and nothing else.
    const userDataPath = path.join(root, "unfinished-restore");
    const partial = path.join(userDataPath, "local-archive", "partial");
    fs.mkdirSync(partial, { recursive: true });
    fs.writeFileSync(path.join(partial, `restore-${crypto.randomUUID()}.zip`), "plaintext backup");
    fs.writeFileSync(path.join(partial, "dev-0123-14-0.part"), "a sync in progress");
    const database = new Database(":memory:");
    createLocalDataTables(database);
    new LocalDataService({ database, userDataPath, link: { watch: () => undefined } });
    assert.deepEqual(fs.readdirSync(partial), ["dev-0123-14-0.part"]);
  });

  // ----- downloaded data: satellite-data cache and place search -----

  await test("satellite data follows what the watch reports: newer COROS files only, once per connection, checked formats only", async () => {
    const { pushSatelliteData } = await load("localSync/satelliteSync.js");
    const { CEP_FILES, parseCepFile, watchHour } = await load("corosWatchCep.js");
    const { applyFwInfoGpsAssistance, decodeBindGpsAssistance } = await load("corosWatchGpsAssist.js");
    const { REPORTS, elpoFile, synapticsFile } = await import("./satellite-fixtures.mjs");
    const now = Date.now();
    const today = watchHour(now) - 2;
    const server = { 61: elpoFile(today, 72), 62: elpoFile(today), 63: elpoFile(today + 72, 72), 82: synapticsFile(today * 3600 + 5), 81: synapticsFile(today * 3600 + 5, 4, 3) };
    // A watch like the BLE service: what it reports, and what it holds once a file is sent (and that it was sent on this connection).
    const watch = (model, report) => {
      let assist = applyFwInfoGpsAssistance(decodeBindGpsAssistance(report.bind), report.settings);
      const sent = [], downloads = [];
      const link = {
        model: () => model,
        readAssistance: async () => assist,
        sendFile: async (file) => {
          sent.push([file.serverType, file.startHour]);
          assist = { ...assist, sent: { ...assist.sent, [file.format]: file.startHour }, ...(file.format === "synaptics-rto" ? { eph: { ...assist.eph, startHour: file.startHour } } : file.format === "elpo-ahead" ? { second: { ...assist.second, startHour: file.startHour } } : { startHour: file.startHour }) };
        }
      };
      const sources = { cepFile: async (spec) => { downloads.push(spec.serverType); return parseCepFile(server[spec.serverType], spec); } };
      return { link, sources, sent, downloads, report: (next) => { assist = { ...applyFwInfoGpsAssistance(decodeBindGpsAssistance(next.bind), next.settings), sent: assist.sent }; } };
    };

    // The user's PACE 4 reporting ELPO with yesterday's file: today's 6-day file goes in file 13, once.
    const pace4 = watch("pace-4", REPORTS.elpo(today - 24));
    const first = await pushSatelliteData(pace4.link, pace4.sources, { now });
    assert.deepEqual([first.ok, first.files, first.coveredUntil], [true, 1, (1_388_534_400 + (today + 144) * 3600) * 1000]);
    assert.deepEqual(pace4.sent, [[62, today]]);
    assert.equal(await pushSatelliteData(pace4.link, pace4.sources, { now }), undefined, "a second sync on the same connection sends nothing");
    // Even if the watch still reports its old data (it didn't take the file), the same file isn't sent again on this connection.
    pace4.report(REPORTS.elpo(today - 24));
    assert.equal(await pushSatelliteData(pace4.link, pace4.sources, { now }), undefined);
    assert.equal(pace4.sent.length, 1);
    // The developer test sends it again on request.
    assert.deepEqual(await pushSatelliteData(pace4.link, pace4.sources, { now, force: true }), { ok: true, files: 1, coveredUntil: first.coveredUntil });
    assert.equal(pace4.sent.length, 2);

    // A watch that already holds today's file gets nothing; nor does one whose newest COROS file has run out, even when forced.
    const current = watch("pace-4-pro", REPORTS.elpo(today));
    assert.equal(await pushSatelliteData(current.link, current.sources, { now }), undefined);
    assert.deepEqual(current.sent, []);
    const late = watch("pace-4-pro", REPORTS.elpo(today - 300));
    assert.equal(await pushSatelliteData(late.link, late.sources, { now: now + 200 * 3_600_000, force: true }), undefined, "expired data is never sent");
    assert.deepEqual(late.sent, []);

    // PACE 3: 72 hours in file 13, then the 96 hours after in file 68 (each compared with its own start).
    const pace3 = watch("pace-3", REPORTS.elpoTwoFiles(today - 24, today + 48));
    assert.equal((await pushSatelliteData(pace3.link, pace3.sources, { now })).files, 2);
    assert.deepEqual(pace3.sent, [[61, today], [63, today + 72]]);

    // LTO watches: RTO (file 70) first, then LTO (file 13); only what is newer than the watch's.
    const pacePro = watch("pace-pro", REPORTS.lto(today, today - 3));
    assert.deepEqual(await pushSatelliteData(pacePro.link, pacePro.sources, { now }), { ok: true, files: 1 }, "only the ephemeris is newer");
    assert.deepEqual(pacePro.sent, [[81, today]]);
    const apex4 = watch("apex-4", REPORTS.lto(today - 30, today - 3));
    assert.equal((await pushSatelliteData(apex4.link, apex4.sources, { now })).files, 2);
    assert.deepEqual(apex4.sent.map(([type]) => type), [81, 82]);

    // A format not checked for the model is refused before anything is downloaded or sent.
    for (const [model, report] of [["pace-4-pro", REPORTS.lto(0, 0)], ["pace-3", REPORTS.lto(0, 0)], ["pace-pro", REPORTS.elpo(0)], ["apex-4", REPORTS.elpo(0)],
      ["pace-4", REPORTS.epo()], ["nomad", REPORTS.elpo(0)], [undefined, REPORTS.lto(0, 0)]]) {
      const other = watch(model, report);
      assert.equal(await pushSatelliteData(other.link, other.sources, { now, force: true }), undefined, `${model}`);
      assert.deepEqual([other.sent, other.downloads], [[], []], `${model}: nothing downloaded or sent`);
    }
    // The bind reply alone (type 13 unread) names no receiver: nothing is sent.
    const bindOnly = watch("pace-4", REPORTS.elpo(today - 24));
    bindOnly.link.readAssistance = async () => decodeBindGpsAssistance(REPORTS.elpo(today - 24).bind);
    assert.equal(await pushSatelliteData(bindOnly.link, bindOnly.sources, { now }), undefined);
    assert.deepEqual(bindOnly.downloads, []);
  });

  await test("the COROS satellite-file cache is written atomically and a mismatched or damaged pair is discarded, never sent", async () => {
    const cep = await load("watchCepService.js");
    const { CEP_FILES, watchHour } = await load("corosWatchCep.js");
    const { elpoFile, synapticsFile } = await import("./satellite-fixtures.mjs");
    const today = watchHour(Date.now()) - 1;
    let files = { 62: elpoFile(today), 81: synapticsFile(today * 3600 + 9, 4, 3) };
    const md5 = (bytes) => crypto.createHash("md5").update(bytes).digest("hex");
    let lists = 0, downloads = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).startsWith("https://epo.coros.com/cep/query")) {
        lists += 1;
        return new Response(JSON.stringify({ data: Object.entries(files).map(([type, bytes]) => ({ type: Number(type), md5: md5(bytes), timestamp: bytes.readUInt32LE(0) + 1_388_534_400, url: `https://s3.coros.com/cep_v5/${type}.DAT` })) }));
      }
      downloads += 1;
      return new Response(files[Number(String(url).match(/(\d+)\.DAT$/)[1])]);
    };
    const directory = path.join(root, "cep-user");
    const cacheDir = path.join(directory, "satellite-data");
    try {
      cep.configureCepCache(directory);
      const [elpo, rto] = await Promise.all([cep.cepSatelliteData(CEP_FILES[62]), cep.cepSatelliteData(CEP_FILES[81])]);
      assert.deepEqual([elpo.startHour, rto.serverType, lists, downloads], [today, 81, 1, 2], "one list for the files a sync needs together");
      assert.deepEqual(fs.readdirSync(cacheDir).sort(), ["cep-62.bin", "cep-62.json", "cep-81.bin", "cep-81.json"], "no temp files left behind");
      const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, "cep-62.json"), "utf8"));
      assert.deepEqual([meta.serverType, meta.startSeconds, meta.bytes, meta.md5], [62, today * 3600, files[62].length, md5(files[62])]);

      cep.configureCepCache(directory);
      assert.equal((await cep.cepSatelliteData(CEP_FILES[62])).startHour, today);
      assert.equal(downloads, 2, "a valid cached pair is used without a download");

      // Other data under the description (a crash between the two renames): discarded and downloaded again.
      const bin = path.join(cacheDir, "cep-62.bin");
      fs.writeFileSync(bin, elpoFile(today - 24));
      cep.configureCepCache(directory);
      assert.equal((await cep.cepSatelliteData(CEP_FILES[62])).startHour, today);
      assert.equal(downloads, 3);
      assert.deepEqual(fs.readFileSync(bin), files[62]);
      // A file that matches its description but fails the format check (a record stamped with another hour).
      const stamped = Buffer.from(files[62]); stamped.writeUIntLE(7, 16 + 72, 3);
      fs.writeFileSync(bin, stamped);
      fs.writeFileSync(path.join(cacheDir, "cep-62.json"), JSON.stringify({ ...meta, md5: md5(stamped) }));
      cep.configureCepCache(directory);
      await cep.cepSatelliteData(CEP_FILES[62]);
      assert.equal(downloads, 4, "refused, downloaded again");
      // A description naming another type.
      fs.writeFileSync(path.join(cacheDir, "cep-62.json"), JSON.stringify({ ...meta, serverType: 61 }));
      cep.configureCepCache(directory);
      await cep.cepSatelliteData(CEP_FILES[62]);
      assert.equal(downloads, 5);
      // A fetch time in the future isn't fresh forever.
      fs.writeFileSync(path.join(cacheDir, "cep-62.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(cacheDir, "cep-62.json"), "utf8")), fetchedAt: Date.now() + 30 * 86_400_000 }));
      cep.configureCepCache(directory);
      await cep.cepSatelliteData(CEP_FILES[62]);
      assert.equal(downloads, 6);

      // Offline: a copy that hasn't run out still serves; a damaged one is never sent.
      fs.writeFileSync(path.join(cacheDir, "cep-62.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(cacheDir, "cep-62.json"), "utf8")), fetchedAt: Date.now() - 7 * 3_600_000 }));
      globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
      cep.configureCepCache(directory);
      assert.equal((await cep.cepSatelliteData(CEP_FILES[62])).startHour, today, "an older copy still helps while it is valid");
      fs.writeFileSync(path.join(cacheDir, "cep-81.json"), "{not json");
      cep.configureCepCache(directory);
      await assert.rejects(cep.cepSatelliteData(CEP_FILES[81]), /fetch failed/);
      assert.equal(fs.existsSync(path.join(cacheDir, "cep-81.bin")), false, "the damaged pair is deleted");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("the developer satellite test needs the capture flag and Local-Only Mode, and forces one push inside the sync lock", async () => {
    const make = (options) => {
      const db = new Database(":memory:");
      createLocalDataTables(db);
      const calls = [];
      const service = new LocalDataService({
        database: db, userDataPath: path.join(root, `satellite-test-${crypto.randomUUID()}`),
        link: {
          watch: () => ({ serialOrName: "SERIAL-1", name: "PACE 4", model: "pace-4", firmware: "V3.2008.0" }),
          runExclusive: async (task) => { calls.push("lock"); return task(); },
          sendSatelliteData: async (input) => { calls.push(["send", input]); return options.result; }
        },
        ...options.service
      });
      return { service, calls };
    };
    const off = make({ service: { pushSatelliteData: () => true } });
    await assert.rejects(off.service.sendSatelliteDataNow(), /Developer tools are off/);
    assert.deepEqual(off.calls, []);
    const connected = make({ service: { capture: { write() {} }, pushSatelliteData: () => false } });
    await assert.rejects(connected.service.sendSatelliteDataNow(), /only in Local-Only Mode/);
    assert.deepEqual(connected.calls, []);
    const on = make({ service: { capture: { write() {} }, pushSatelliteData: () => true }, result: { ok: true, files: 1 } });
    assert.deepEqual(await on.service.sendSatelliteDataNow(), { ok: true, files: 1 });
    assert.deepEqual(on.calls, ["lock", ["send", { force: true }]]);
    const nothing = make({ service: { capture: { write() {} }, pushSatelliteData: () => true }, result: undefined });
    assert.deepEqual(await nothing.service.sendSatelliteDataNow(), { ok: false, error: "Not available on this watch." });
    // A normal sync never forces (pushSatelliteData's own rule decides).
  });

  await test("place search results are bounded and checked", async () => {
    const weather = await load("watchWeatherService.js");
    const answer = (body) => async () => new Response(JSON.stringify(body));
    const many = Array.from({ length: 50 }, (_, index) => ({ name: `Place ${index}`, latitude: 10, longitude: 20, country: "Somewhere" }));
    assert.equal((await weather.searchWeatherPlaces("Place", "en", answer({ results: many }))).length, 8, "at most what was asked for");
    const places = await weather.searchWeatherPlaces("Odd", "en", answer({ results: [
      { name: "North", latitude: 91, longitude: 0 },
      { name: "East", latitude: 0, longitude: -180.5 },
      { name: "NaN", latitude: Number.NaN, longitude: 0 },
      { name: "", latitude: 1, longitude: 1 },
      { name: { text: "object" }, latitude: 1, longitude: 1 },
      { name: `${"Long".repeat(100)}\u0000`, latitude: -90, longitude: 180, admin1: "\u0007Region", country: "😀".repeat(100) },
      null
    ] }));
    assert.equal(places.length, 1);
    assert.deepEqual([places[0].name.length, places[0].latitude, places[0].longitude], [80, -90, 180]);
    assert.equal(places[0].detail, `Region, ${"😀".repeat(80)}`, "control characters dropped, emoji never split");
    assert.deepEqual(await weather.searchWeatherPlaces("Odd", "en", answer({ results: "nope" })), []);
    assert.deepEqual(await weather.searchWeatherPlaces("Odd", "en", answer(null)), []);
  });

  await test("an interrupted run is marked on the next launch", () => {
    const db = new Database(path.join(root, "runs.sqlite"));
    createLocalDataTables(db);
    new ActivityRepository(db).startRun("activities", "dev");
    db.close();
    const reopened = new Database(path.join(root, "runs.sqlite"));
    createLocalDataTables(reopened);
    assert.equal(new ActivityRepository(reopened).recentRuns(1)[0].state, "interrupted");
    reopened.close();
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`local-only data: ${passed} checks passed`);
