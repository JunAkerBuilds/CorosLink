import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

// Local-Only Mode's workout library and training calendar: the Training Hub
// functions the UI uses, answered by localSync/localTrainingBackend.ts with no
// COROS session and no network. Runs under Electron's Node (better-sqlite3).

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(`${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`);
const databaseModule = await load("database.js");
const hub = await load("trainingHubService.js");
const { createLocalDataTables } = await load("localSync/localDataSchema.js");
const { LocalTrainingBackend, estimateProgram } = await load("localSync/localTrainingBackend.js");
const { configureDataSources } = await load("localSync/activitySource.js");
const chatWorkoutTools = await load("chatWorkoutTools.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-local-training-"));
const db = databaseModule.initializeDatabase(root);
createLocalDataTables(db);
// The database holds health data: this user only, whatever the umask (the -wal and -shm files follow it).
if (process.platform !== "win32") {
  for (const file of ["coroslink.sqlite", "coroslink.sqlite-wal"]) assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600, file);
}
const backend = new LocalTrainingBackend(db);
hub.configureLocalTraining(() => backend);
const unused = { kind: "local" };
configureDataSources({ useLocal: () => true, localActivities: unused, cloudActivities: unused, localHealth: unused, cloudHealth: unused });
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("no network in Local-Only Mode"); };

let passed = 0;
async function test(name, body) {
  try { await body(); passed += 1; } catch (error) { console.error(`✗ ${name}`); throw error; }
}
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

const intervals = {
  key: "intervals", name: "5 × 1 km", sport: "run",
  steps: [
    { kind: "warmup", target_type: "time", target_duration_seconds: 600 },
    { repeat: 5, steps: [
      { kind: "training", target_type: "distance", target_distance_meters: 1000, intensity: { type: "pace", lowSecondsPerKm: 230, highSecondsPerKm: 240, displayUnit: "km" } },
      { kind: "rest", target_type: "time", target_duration_seconds: 90 }
    ] },
    { kind: "cooldown", target_type: "time", target_duration_seconds: 600 }
  ]
};

let programId;
await test("create a library workout locally", async () => {
  ({ programId } = await hub.createLibraryWorkout(intervals, "metric"));
  assert.match(programId, /^\d+$/);
  const workouts = await hub.listLibraryWorkouts();
  assert.deepEqual(workouts.map((workout) => [workout.id, workout.name]), [[programId, "5 × 1 km"]]);
  const stored = backend.program(programId);
  assert.equal(stored.estimatedTime ?? stored.duration, 600 + 5 * 90 + 600, "time from the steps");
  assert.equal(stored.distance ?? stored.estimatedDistance, 5 * 1000 * 100, "distance in centimeters");
});

let entry;
await test("schedule it, move it and edit it on the calendar", async () => {
  await hub.scheduleLibraryWorkout(programId, day(1));
  let entries = await hub.listScheduledWorkoutEntries(day(0), day(7));
  assert.equal(entries.length, 1);
  entry = entries[0];
  assert.deepEqual([entry.happenDay, entry.name, entry.programId === programId || entry.rawProgram.id === programId], [day(1), "5 × 1 km", true]);
  const moved = await hub.rescheduleScheduledWorkout(entry, day(3));
  entries = await hub.listScheduledWorkoutEntries(day(0), day(7));
  assert.deepEqual(entries.map((item) => item.happenDay), [day(3)], "moved, not duplicated");
  entry = entries[0];
  assert.equal(entry.idInPlan, moved.idInPlan);
  const ref = { kind: "scheduled", happenDay: entry.happenDay, planId: entry.planId, idInPlan: entry.idInPlan, planProgramId: entry.planProgramId };
  const document = await hub.getWorkoutForEdit(ref, "metric");
  assert.equal(document.canEdit, true);
  await hub.saveWorkoutEdit(ref, document.revision, { ...document.draft, name: "5 × 1 km (edited)" }, "metric");
  entries = await hub.listScheduledWorkoutEntries(day(0), day(7));
  assert.equal(entries[0].name, "5 × 1 km (edited)");
  assert.equal((await hub.listLibraryWorkouts())[0].name, "5 × 1 km", "editing a calendar entry leaves the library workout");
});

await test("edit the library workout, then remove everything", async () => {
  const ref = { kind: "library", programId };
  const document = await hub.getWorkoutForEdit(ref, "metric");
  await hub.saveWorkoutEdit(ref, document.revision, { ...document.draft, name: "Track 5 × 1 km" }, "metric");
  assert.equal((await hub.listLibraryWorkouts())[0].name, "Track 5 × 1 km");
  await hub.removeScheduledWorkout(entry);
  assert.deepEqual(await hub.listScheduledWorkoutEntries(day(0), day(7)), []);
  await hub.deleteWorkoutProgram(programId);
  assert.deepEqual(await hub.listLibraryWorkouts(), []);
});

await test("native COROS plans are refused; backups round-trip", async () => {
  await assert.rejects(hub.writeNativeTrainingPlanEndpoint("/training/plan/add", { body: {} }), /Local-Only Mode: COROS training plans live in the COROS cloud/);
  const { programId: kept } = await hub.createLibraryWorkout(intervals, "metric");
  await hub.scheduleLibraryWorkout(kept, day(2));
  const exported = backend.exportData();
  const other = new Database(":memory:");
  createLocalDataTables(other);
  const restored = new LocalTrainingBackend(other);
  assert.equal(restored.importData(exported), 2);
  assert.equal(restored.importData(exported), 0, "nothing twice");
  assert.deepEqual(restored.exportData(), exported);
});

await test("estimates: repeat groups, timed rest, distance in centimeters", async () => {
  assert.deepEqual(estimateProgram({ exercises: [
    { id: 1, isGroup: true, sets: 3, restType: 1, restValue: 60 },
    { id: 2, groupId: 1, targetType: 2, targetValue: 120, restType: 3 },
    { id: 3, groupId: 1, targetType: 5, targetValue: 40000, restType: 3 },
    { id: 4, groupId: 0, targetType: 2, targetValue: 300, restType: 1, restValue: 30 }
  ] }), { duration: 3 * 120 + 2 * 60 + 300 + 30, distance: 3 * 40000, sets: 4 });
});

await test("the Coach can draft a plan and put it on the local calendar", async () => {
  const names = chatWorkoutTools.getChatWorkoutTools().map((tool) => tool.name);
  for (const name of ["draft_workout", "draft_training_plan", "upload_training_plan", "list_scheduled_workouts"]) assert.ok(names.includes(name), name);
  assert.equal(names.includes("search_coros_exercises"), false, "COROS's exercise catalog needs a COROS session");
  let preview;
  const response = JSON.parse(await chatWorkoutTools.handleChatWorkoutTool("draft_training_plan", {
    name: "Coach week",
    workouts: [
      { ...intervals, key: "a", name: "Coach easy", schedule_date: day(4) },
      { ...intervals, key: "b", name: "Coach intervals", schedule_date: day(6) }
    ]
  }, { onPlanDraft: (draft) => { preview = draft; } }));
  assert.equal(response.ok, true);
  const before = (await hub.listScheduledWorkoutEntries(day(0), day(10))).length;
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "calendar");
  const after = await hub.listScheduledWorkoutEntries(day(0), day(10));
  assert.deepEqual(after.filter((entry) => entry.name.startsWith("Coach")).map((entry) => [entry.happenDay, entry.name]),
    [[day(4), "Coach easy"], [day(6), "Coach intervals"]]);
  assert.equal(after.length, before + 2);
});

await test("the Coach moves, swaps and reschedules calendar workouts behind one card each", async () => {
  const onDays = async () => (await hub.listScheduledWorkoutEntries(day(0), day(10)))
    .filter((entry) => entry.name.startsWith("Coach")).map((entry) => [entry.happenDay, entry.name]);
  const stage = async (tool, args) => {
    let card;
    const response = JSON.parse(await chatWorkoutTools.handleChatWorkoutTool(tool, args, { onWorkoutDelete: (preview) => { card = preview; } }));
    assert.equal(response.ok, true, response.error);
    assert.equal(card.action, "move");
    assert.deepEqual(await onDays(), before, "nothing changes until the card is approved");
    return card;
  };
  let before = await onDays();
  assert.deepEqual(before, [[day(4), "Coach easy"], [day(6), "Coach intervals"]]);

  let card = await stage("move_workout", { schedule_date: day(4), workout_name: "Coach easy", new_date: day(5) });
  assert.equal(card.newScheduleDate, `${day(5).slice(0, 4)}-${day(5).slice(4, 6)}-${day(5).slice(6)}`);
  await chatWorkoutTools.confirmWorkoutDeleteById(card.requestId);
  before = await onDays();
  assert.deepEqual(before, [[day(5), "Coach easy"], [day(6), "Coach intervals"]]);
  await assert.rejects(chatWorkoutTools.confirmWorkoutDeleteById(card.requestId), /already moved/);

  card = await stage("move_workout", { schedule_date: day(5), workout_name: "Coach easy", new_date: day(6), swap: true });
  assert.equal(card.swapWorkoutName, "Coach intervals");
  await chatWorkoutTools.confirmWorkoutDeleteById(card.requestId);
  before = await onDays();
  assert.deepEqual(before, [[day(5), "Coach intervals"], [day(6), "Coach easy"]]);

  const refused = async (changes, pattern) => {
    const response = JSON.parse(await chatWorkoutTools.handleChatWorkoutTool("reschedule_workouts", { changes }));
    assert.equal(response.ok, false);
    assert.match(response.error, pattern);
  };
  await refused([{ schedule_date: day(5), workout_name: "Coach intervals", new_date: day(7), remove: true }], /new_date to move it, or remove/);
  await refused([{ schedule_date: day(5), workout_name: "Coach intervals", new_date: day(-1) }], /before today/);
  await refused([
    { schedule_date: day(5), workout_name: "Coach intervals", new_date: day(7) },
    { schedule_date: day(5), workout_name: "Coach intervals", remove: true }
  ], /already in this card/);

  card = await stage("reschedule_workouts", { changes: [
    { schedule_date: day(5), workout_name: "Coach intervals", new_date: day(8) },
    { schedule_date: day(6), workout_name: "Coach easy", remove: true }
  ] });
  assert.equal(card.summary, "Move 1 workout and remove 1 workout");
  assert.deepEqual(card.changes.map((change) => [change.workoutName, Boolean(change.newScheduleDate)]), [["Coach intervals", true], ["Coach easy", false]]);
  const result = await chatWorkoutTools.confirmWorkoutDeleteById(card.requestId);
  assert.equal(result.message, "Moved 1 workout and removed 1 from the calendar.");
  assert.deepEqual(await onDays(), [[day(8), "Coach intervals"]]);
});

await test("automatic sync: off by default, then on schedule, idle-only, retrying sooner after a miss, leaving a user's connection up", async () => {
  const { WatchAutoSync, autoSyncState, setAutoSync, nextAutoSyncAt } = await load("watchAutoSyncService.js");
  assert.equal(autoSyncState().enabled, false, "off until the user turns it on");
  let now = Date.UTC(2026, 9, 19, 8);
  let idle = true;
  let reachable = false;
  let userConnected = false;
  let syncFails = false;
  const calls = [];
  const changes = [];
  const sync = new WatchAutoSync({
    active: () => true,
    idle: () => idle,
    ready: () => true,
    trusted: () => "ok",
    connected: () => userConnected,
    connect: async () => { calls.push("connect"); if (!reachable) throw new Error("No watch nearby."); return true; },
    sync: async () => { calls.push("sync"); if (syncFails) throw new Error("The watch returned invalid or incomplete records."); return { state: "done", receivedBytes: 0, newActivities: 2, undecodedPayloads: 0, calendar: { ok: true, workouts: 1 } }; },
    disconnect: async () => { calls.push("disconnect"); },
    onChange: (state) => changes.push(state)
  }, () => now);

  await sync.tick();
  assert.deepEqual(calls, [], "nothing while it is off");
  assert.throws(() => setAutoSync({ intervalHours: 2 }), /interval/);
  setAutoSync({ enabled: true, intervalHours: 3 });

  await sync.tick();
  assert.deepEqual(calls, ["connect", "disconnect"], "an unreachable watch is let go");
  assert.match(changes.at(-1).lastError, /No watch nearby/);
  assert.equal(nextAutoSyncAt(autoSyncState()), now + 30 * 60_000, "a miss retries in 30 minutes");

  reachable = true;
  now += 10 * 60_000;
  await sync.tick();
  assert.equal(calls.length, 2, "not before the retry time");
  now += 20 * 60_000;
  idle = false;
  await sync.tick();
  assert.equal(calls.length, 2, "never while Bluetooth is busy");
  idle = true;
  await sync.tick();
  assert.deepEqual(calls.slice(2), ["connect", "sync", "disconnect"], "a watch it connected itself is disconnected again");
  const state = autoSyncState();
  assert.deepEqual([state.lastSuccessAt, state.lastError, state.lastResult.newActivities, state.lastResult.calendar.workouts], [now, undefined, 2, 1]);
  assert.equal(nextAutoSyncAt(state), now + 3 * 3_600_000, "then every 3 hours");
  now += 3 * 3_600_000 - 1;
  await sync.tick();
  assert.equal(calls.length, 5);

  // The user connected the watch: the sync uses that connection and leaves it up, whether it works or not.
  userConnected = true;
  now += 1;
  await sync.tick();
  assert.deepEqual(calls.slice(5), ["sync"], "no connect and no disconnect");
  assert.equal(autoSyncState().lastSuccessAt, now);
  now += 3 * 3_600_000;
  syncFails = true;
  await sync.tick();
  assert.deepEqual(calls.slice(6), ["sync"], "a failed sync doesn't drop the user's connection");
  assert.match(autoSyncState().lastError, /invalid or incomplete/);
  setAutoSync({ enabled: false });
});

await test("weather location: a chosen place isn't replaced by the automatic one", async () => {
  const weather = await load("watchWeatherService.js");
  weather.setWatchWeatherLocation({ latitude: 10.776, longitude: 106.701, place: "VPN City" });
  assert.deepEqual(weather.getWeatherLocation(), { latitude: 10.78, longitude: 106.7, place: "VPN City", source: "automatic" }, "rounded to about 1 km");
  weather.chooseWeatherLocation({ latitude: 21.0285, longitude: 105.8542, place: "Hanoi" });
  weather.setWatchWeatherLocation({ latitude: 1.29, longitude: 103.85, place: "Singapore" });
  assert.deepEqual(weather.getWeatherLocation(), { latitude: 21.03, longitude: 105.85, place: "Hanoi", source: "chosen" }, "the Overview's lookup doesn't move a chosen place");
  assert.throws(() => weather.chooseWeatherLocation({ latitude: 91, longitude: 0 }), /Invalid/);
  weather.chooseWeatherLocation(null);
  assert.equal(weather.getWeatherLocation(), undefined, "back to automatic");
  weather.setWatchWeatherLocation({ latitude: 1.29, longitude: 103.85, place: "Singapore" });
  assert.equal(weather.getWeatherLocation().source, "automatic");

  let asked;
  const places = await weather.searchWeatherPlaces("Hanoi", "fr", async (url) => {
    asked = new URL(url);
    return new Response(JSON.stringify({ results: [
      { name: "Hanoi", latitude: 21.0245, longitude: 105.8412, admin1: "Hanoi", country: "Vietnam" },
      { name: "Broken" }
    ] }));
  });
  assert.equal(asked.hostname, "geocoding-api.open-meteo.com", "not a COROS service");
  assert.equal(asked.searchParams.get("language"), "fr");
  assert.deepEqual(places, [{ name: "Hanoi", latitude: 21.0245, longitude: 105.8412, detail: "Vietnam" }]);
  assert.deepEqual(await weather.searchWeatherPlaces("H", "en", () => assert.fail("too short to search")), []);
});

await test("watch settings: each read records which settings changed on the watch", async () => {
  const settings = await load("watchSettingsService.js");
  const word = (value) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes; };
  const ext = (low, high) => { const bytes = Buffer.alloc(8); bytes.writeUInt32LE(low >>> 0, 0); bytes.writeUInt32LE(high >>> 0, 4); return bytes; };
  settings.storeWatchSwitches(word(0x0e2d2085), ext(0, 0), new Date("2026-10-19T10:00:00Z"), "pace-pro");
  assert.deepEqual(settings.getWatchSettings().changes, [], "nothing to compare on the first read");
  // Raise to wake from All day (1) to Off (2), and an extended bit no known field covers (bit 2).
  settings.storeWatchSwitches(word((0x0e2d2085 & ~0x600000) | 0x400000), ext(1 << 2, 0), new Date("2026-10-19T10:05:00Z"), "pace-pro");
  const changes = settings.getWatchSettings().changes;
  assert.deepEqual(changes.map((change) => [change.field, change.from, change.to]), [["raiseToWake", 1, 2], ["bit2", 0, 1]]);
  assert.equal(settings.getWatchSettings().values.raiseToWake, 2);
  // A read without the extended switches keeps the last ones read from the same model.
  settings.storeWatchSwitches(word((0x0e2d2085 & ~0x600000) | 0x400000), undefined, new Date("2026-10-19T10:10:00Z"), "pace-pro");
  assert.deepEqual([settings.getWatchSettings().model, settings.getWatchSettings().extRaw, settings.getWatchSettings().changes.length], ["pace-pro", ext(1 << 2, 0).toString("hex"), 2]);
  // Each read names the watch it came from; a read from another model is not compared with the last one.
  settings.storeWatchSwitches(word(0), undefined, new Date("2026-10-19T10:15:00Z"), "pace-3");
  const other = settings.getWatchSettings();
  assert.deepEqual([other.model, other.changes.length, other.extRaw], ["pace-3", 0, undefined], "nothing carried over from the PACE Pro");
  // Nor is a read from a watch CorosLink doesn't recognise.
  settings.storeWatchSwitches(word(0x0e2d2085), undefined, new Date("2026-10-19T10:20:00Z"));
  assert.deepEqual([settings.getWatchSettings().model, settings.getWatchSettings().changes.length], [undefined, 0]);
});

await test("watch settings: changes are written whole, read back and checked", async () => {
  const settings = await load("watchSettingsService.js");
  let watch = { word: Buffer.from([0x85, 0x20, 0x2d, 0x0e]), ext: Buffer.alloc(8) };
  settings.storeWatchSwitches(watch.word, watch.ext, new Date(), "pace-4");
  const writes = [];
  const link = {
    read: async () => ({ word: Buffer.from(watch.word), ext: Buffer.from(watch.ext) }),
    write: async (word, ext) => { writes.push({ word, ext }); watch = { word: Buffer.from(word), ext: ext ? Buffer.from(ext) : watch.ext }; settings.storeWatchSwitches(watch.word, watch.ext, new Date(), "pace-4"); return link.read(); }
  };
  const result = await settings.updateWatchSettings({ doNotDisturb: 1, alwaysOnDaily: 1 }, link);
  assert.deepEqual([result.values.doNotDisturb, result.ext.alwaysOnDaily], [1, 1]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].word.readUInt32LE(0), (0x0e2d2085 | 1 << 17) >>> 0, "only the edited bit changes");
  await assert.rejects(settings.updateWatchSettings({}, link), /No settings/);
  // A watch that ignores the write.
  const stubborn = { read: link.read, write: async () => link.read() };
  await assert.rejects(settings.updateWatchSettings({ units: 1 }, stubborn), /didn't keep units/);
  // The firmware keeps its own temperature unit (ext bits 54-55) once it has one: only the extended record is
  // written, the watch reads back the old unit, and the save is reported as failed, never shown as saved.
  const before = settings.getWatchSettings();
  let extWrites = 0;
  const keepsUnit = {
    read: link.read,
    write: async (word, ext) => {
      assert.ok(ext, "a pressure-unit change writes the extended record");
      extWrites += 1;
      const kept = Buffer.from(ext); kept[2] = (kept[2] & 0xfe) | (watch.ext[2] & 0x01);
      watch = { word: Buffer.from(word), ext: kept }; settings.storeWatchSwitches(watch.word, watch.ext, new Date(), "pace-4"); return link.read();
    }
  };
  // A setting the watch ignores is reported, not shown as saved.
  assert.equal(before.ext.pressureUnit, 0);
  await assert.rejects(settings.updateWatchSettings({ pressureUnit: 1 }, keepsUnit), /didn't keep pressureUnit/);
  assert.equal(extWrites, 1);
  assert.equal(settings.getWatchSettings().ext.pressureUnit, 0, "the stored record shows what the watch kept");
  // Accepted when the watch keeps it.
  assert.equal((await settings.updateWatchSettings({ pressureUnit: 1 }, link)).ext.pressureUnit, 1);
  assert.equal(writes.at(-1).ext.readBigUInt64LE(0) >> 16n & 1n, 1n);
  // The temperature unit is read only: the PACE 4 keeps its own when it's written.
  await assert.rejects(settings.updateWatchSettings({ temperatureUnit: 1 }, link), /can't make this change/);
});

await test("watch settings: each model's own fields (memory-in-pixel APEX 4 and PACE 3)", async () => {
  const settings = await load("watchSettingsService.js");
  const word = Buffer.from([0x85, 0x20, 0x2d, 0x0e]);
  const ext = (low, high) => { const bytes = Buffer.alloc(8); bytes.writeUInt32LE(low >>> 0, 0); bytes.writeUInt32LE(high >>> 0, 4); return bytes; };
  for (const model of ["apex-4", "pace-3"]) {
    // Night Mode off, brightness High; then Night Mode on and brightness Max (a field this model doesn't use).
    settings.storeWatchSwitches(word, ext(0, 1 << 18), new Date("2026-10-20T10:00:00Z"), model);
    assert.equal("brightness" in settings.getWatchSettings().ext, false, `${model}: no brightness`);
    settings.storeWatchSwitches(word, ext(1 << 28, 2 << 18), new Date("2026-10-20T10:05:00Z"), model);
    const summary = settings.getWatchSettings();
    assert.equal(summary.ext.nightMode, 1);
    assert.deepEqual(summary.changes.slice(0, 3).map(change => [change.field, change.from, change.to]), [["nightMode", 0, 1], ["bit50", 1, 0], ["bit51", 0, 1]], `${model}: the change log uses the model's fields`);
    // Edits use the connected model's fields: brightness isn't written to it.
    let watch = { word: Buffer.from(word), ext: ext(1 << 28, 0) };
    const writes = [];
    const link = {
      read: async () => ({ word: Buffer.from(watch.word), ext: Buffer.from(watch.ext), model }),
      write: async (w, e) => { writes.push(e); watch = { word: Buffer.from(w), ext: e ? Buffer.from(e) : watch.ext }; settings.storeWatchSwitches(watch.word, watch.ext, new Date(), model); return link.read(); }
    };
    await assert.rejects(settings.updateWatchSettings({ brightness: 2 }, link), /can't make this change/);
    await assert.rejects(settings.updateWatchSettings({ alwaysOnDaily: 1 }, link), /can't make this change/);
    assert.equal(writes.length, 0, "nothing written");
    const saved = await settings.updateWatchSettings({ pressureUnit: 1 }, link);
    assert.deepEqual([saved.ext.pressureUnit, saved.ext.nightMode, saved.model], [1, 1, model]);
  }
  // The same bits on a PACE 4: brightness is a field there, bit 28 a raw bit.
  settings.storeWatchSwitches(word, ext(0, 1 << 18), new Date("2026-10-20T11:00:00Z"), "pace-4");
  settings.storeWatchSwitches(word, ext(1 << 28, 2 << 18), new Date("2026-10-20T11:05:00Z"), "pace-4");
  assert.deepEqual(settings.getWatchSettings().changes.slice(0, 2).map(change => [change.field, change.from, change.to]), [["brightness", 1, 2], ["bit28", 0, 1]]);
});

await test("training calendar on the watch: only CorosLink's plan is replaced, an unchanged or empty calendar writes nothing", async () => {
  const { LocalDataService } = await load("localSync/localDataService.js");
  const harness = (database, plans) => {
    const watch = { plans: [...plans] };
    const sends = [];
    const memory = { consent: false, sent: {} };
    let failNext = false;
    const service = new LocalDataService({
      database, userDataPath: fs.mkdtempSync(path.join(root, "calendar-")),
      pushTrainingCalendar: () => true,
      watchCalendar: {
        replaceForeignPlan: () => memory.consent,
        lastSent: (deviceId) => memory.sent[deviceId],
        recordSent: (deviceId, hash) => { memory.sent[deviceId] = hash; }
      },
      link: {
        watch: () => ({ serialOrName: "SERIAL-1", name: "PACE 4", model: "pace-4", firmware: "V3.2008.0" }),
        runExclusive: (task) => task(),
        readSyncBlock: async () => { throw new Error("not used"); },
        readPedometer: async () => Buffer.alloc(0),
        disconnect: async () => undefined,
        watchKeySaved: () => true,
        listTrainingPlans: async () => [...watch.plans],
        sendTrainingPlan: async (file, replace) => {
          sends.push([...replace]);
          if (failNext) { failNext = false; watch.plans = []; throw new Error("The training calendar didn't finish sending. Sync again to send it."); }
          watch.plans = ["1"];
          return { listed: true };
        }
      }
    });
    return { push: () => service.pushTrainingCalendarInSession(), watch, sends, memory, fail: () => { failNext = true; } };
  };

  // This computer's calendar has workouts in the window (from the tests above).
  assert.ok((await hub.listScheduledWorkoutEntries(day(0), day(10))).length > 0);
  const coros = harness(db, ["4242424242"]);
  assert.deepEqual(await coros.push(), { ok: false, foreignPlan: true }, "a COROS-app plan is left alone");
  assert.deepEqual([coros.sends, coros.watch.plans], [[], ["4242424242"]], "nothing written without consent");
  coros.memory.consent = true;
  const sent = await coros.push();
  assert.deepEqual([sent.ok, sent.listed, sent.workouts > 0], [true, true, true], "replaced once the user agreed");
  assert.deepEqual(coros.sends, [["4242424242"]], "the foreign plan is named for removal only then");
  assert.deepEqual(await coros.push(), { ok: true, workouts: sent.workouts, unchanged: true }, "unchanged: nothing written");
  assert.equal(coros.sends.length, 1);
  coros.watch.plans = [];
  assert.equal((await coros.push()).listed, true, "sent again when the watch no longer holds it");
  assert.deepEqual(coros.sends.at(-1), [], "nothing to remove");
  // A transfer that fails partway is reported, and the next sync sends it again.
  coros.memory.sent = {};
  coros.watch.plans = ["1"];
  coros.fail();
  const failed = await coros.push();
  assert.equal(failed.ok, false);
  assert.match(failed.error, /didn't finish sending/);
  assert.equal((await coros.push()).listed, true);

  // An empty calendar: nothing is sent, unless an earlier CorosLink plan needs clearing.
  const empty = new Database(":memory:");
  createLocalDataTables(empty);
  for (const plans of [[], ["4242424242"]]) {
    const watch = harness(empty, plans);
    assert.equal(await watch.push(), undefined, `nothing to send (${plans.join(",") || "no plan"})`);
    assert.deepEqual(watch.sends, []);
  }
  const ours = harness(empty, ["1"]);
  assert.deepEqual(await ours.push(), { ok: true, workouts: 0, listed: true }, "CorosLink's own old plan is cleared");
  assert.deepEqual(ours.sends, [["1"]]);

  // Workouts the watch can't take are reported with the result, by reason, even when nothing else is sent.
  const zoned = new Database(":memory:");
  createLocalDataTables(zoned);
  const zone = { id: "900", name: "Zone 2 run", sportType: 1, exercises: [{ id: 1, name: "Z2", targetType: 2, targetValue: 1800, intensityType: 2, intensityCustom: 2 }] };
  new LocalTrainingBackend(zoned).importData({ programs: [zone], schedule: [{ idInPlan: 7, happenDay: day(1), program: zone }] });
  const onlyZoned = harness(zoned, []);
  assert.deepEqual(await onlyZoned.push(), { ok: true, workouts: 0, unchanged: true, skipped: { zoneTargets: 1 } }, "nothing written, and it says why");
  assert.deepEqual(onlyZoned.sends, []);
  const easy = { ...zone, id: "901", name: "Easy run", exercises: [{ id: 1, name: "Easy", targetType: 2, targetValue: 1800 }] };
  new LocalTrainingBackend(zoned).importData({ programs: [easy], schedule: [{ idInPlan: 8, happenDay: day(1), program: easy }] });
  const mixed = harness(zoned, []);
  assert.deepEqual(await mixed.push(), { ok: true, workouts: 1, listed: true, skipped: { zoneTargets: 1 } });
  assert.deepEqual(await mixed.push(), { ok: true, workouts: 1, unchanged: true, skipped: { zoneTargets: 1 } }, "and again when unchanged");
});

await test("automatic sync keeps a connection the user asked for while it was connecting", async () => {
  const { WatchAutoSync, setAutoSync } = await load("watchAutoSyncService.js");
  setAutoSync({ enabled: true, intervalHours: 1 });
  let userConnects = 0;
  const calls = [];
  const sync = new WatchAutoSync({
    active: () => true, idle: () => true, ready: () => true, trusted: () => "ok", connected: () => false,
    userConnects: () => userConnects,
    // The user clicks Connect while this connection is under way (they share it).
    connect: async () => { calls.push("connect"); userConnects += 1; return true; },
    sync: async () => { calls.push("sync"); return { state: "done", receivedBytes: 0, newActivities: 0, undecodedPayloads: 0 }; },
    disconnect: async () => { calls.push("disconnect"); },
    onChange: () => undefined
  }, () => Date.UTC(2030, 0, 1));
  await sync.tick();
  assert.deepEqual(calls, ["connect", "sync"], "no disconnect");
  setAutoSync({ enabled: false });
});

await test("automatic sync connects only to the remembered watch identity, else pauses until a manual connection", async () => {
  const { WatchAutoSync, autoSyncState, setAutoSync } = await load("watchAutoSyncService.js");
  const { WatchIdentityError } = await load("watchIdentity.js");
  setAutoSync({ enabled: true, intervalHours: 1 });
  let now = Date.UTC(2031, 0, 1);
  let trust = "unpinned";
  let answer = "watch";
  const calls = [];
  const changes = [];
  const sync = new WatchAutoSync({
    active: () => true, idle: () => true, ready: () => true, connected: () => false,
    trusted: () => trust,
    // The service refuses another device before authenticating; here that is the identity error.
    connect: async () => { calls.push("connect"); if (answer !== "watch") throw new WatchIdentityError("mismatch"); return true; },
    sync: async () => { calls.push("sync"); return { state: "done", receivedBytes: 0, newActivities: 0, undecodedPayloads: 0 }; },
    disconnect: async () => { calls.push("disconnect"); },
    onChange: (state) => changes.push(state)
  }, () => now);
  // No identity remembered yet (an existing user's remembered watch included): no connection at all.
  const attempted = autoSyncState().lastAttemptAt;
  await sync.tick();
  assert.deepEqual(calls, [], "nothing connects or authenticates");
  assert.deepEqual([autoSyncState().paused, autoSyncState().pausedAt, autoSyncState().lastAttemptAt], ["unpinned", now, attempted]);
  assert.equal(changes.at(-1).paused, "unpinned", "the menu hears about the pause");
  now += 2 * 3_600_000;
  trust = "ok";
  await sync.tick();
  assert.deepEqual(calls, [], "stays paused, even once a watch is remembered, until the user connects");
  // The user connects from the watch menu: the pause clears and the next check syncs.
  sync.resume();
  assert.equal(autoSyncState().paused, undefined);
  await sync.tick();
  assert.deepEqual(calls, ["connect", "sync", "disconnect"]);
  // Another device answers with the watch's name: refused before authenticating, paused, nothing to disconnect.
  now += 2 * 3_600_000;
  answer = "other";
  await sync.tick();
  assert.deepEqual(calls.slice(3), ["connect"], "no sync and no disconnect after a refused device");
  assert.equal(autoSyncState().paused, "mismatch");
  assert.equal(autoSyncState().lastError, undefined, "a pause is not a failed attempt");
  now += 2 * 3_600_000;
  await sync.tick();
  assert.equal(calls.length, 4, "paused");
  // A connected watch that isn't the remembered one isn't synced either.
  sync.resume();
  trust = "mismatch";
  await sync.tick();
  assert.equal(calls.length, 4);
  assert.equal(autoSyncState().paused, "mismatch");
  sync.resume();
  setAutoSync({ enabled: false });
});

await test("main.js loads the privacy bootstrap before anything else", () => {
  const main = fs.readFileSync(path.join(repoRoot, "dist-electron", "main.js"), "utf8");
  const first = /require\("([^"]+)"\)/.exec(main);
  assert.equal(first?.[1], "./privacy/bootstrap");
});

globalThis.fetch = realFetch;
console.log(`local training: ${passed} checks passed`);
