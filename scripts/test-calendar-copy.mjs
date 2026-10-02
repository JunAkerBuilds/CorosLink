import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createCalendarClipboardEntry } from "../src/calendar/calendarTypes.ts";

const require = createRequire(import.meta.url);
const settings = new Map([
  ["trainingHub.accessToken", "test-token"],
  ["trainingHub.userId", "test-user"],
  ["trainingHub.regionId", "1"],
  ["trainingHub.baseUrl", "https://coros.invalid"]
]);
require.cache[require.resolve("../dist-electron/database.js")] = { exports: {
  getSetting: (key) => settings.get(key),
  setSetting: (key, value) => settings.set(key, value)
} };
const { copyScheduledWorkout, listScheduledWorkoutEntries, removeScheduledWorkout } =
  require("../dist-electron/trainingHubService.js");
const sourceDay = "20990101", targetDay = "20990102";
let maxId = 9;
const entities = [{ planId: "p", idInPlan: maxId, happenDay: sourceDay, sortNoInSchedule: 1 }];
const programs = [{ id: "run", idInPlan: maxId, name: "Original run", sportType: 1, pbVersion: 2,
  exercises: [{ name: "Run", targetValue: 500000 }], exerciseBarChart: [1, 2] }];
const queries = [], writes = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const request = new URL(url);
  assert.equal(request.origin, "https://coros.invalid");
  if (request.pathname === "/training/schedule/query") {
    const start = request.searchParams.get("startDate");
    const end = request.searchParams.get("endDate");
    queries.push(start);
    return { ok: true, json: async () => ({ result: "0000", data: {
      maxIdInPlan: maxId,
      entities: entities.filter((entry) => entry.happenDay >= start && entry.happenDay <= end),
      programs
    } }) };
  }
  assert.equal(request.pathname, "/training/schedule/update");
  assert.equal(options.method, "POST");
  const write = JSON.parse(options.body);
  writes.push(write);
  for (const version of write.versionObjects) {
    if (version.status === 3) {
      entities.find((entry) => String(entry.idInPlan) === String(version.id)).status = 3;
    } else {
      maxId = Math.max(maxId, Number(version.id));
      entities.push(...write.entities);
      programs.push(...write.programs);
    }
  }
  return { ok: true, json: async () => ({ result: "0000" }) };
};

try {
  const [source] = await listScheduledWorkoutEntries(sourceDay, sourceDay);
  const copied = createCalendarClipboardEntry(source);
  // An edit followed by deletion must leave the copied content usable.
  source.rawProgram.name = "Edited run";
  source.rawProgram.exercises[0].targetValue = 900000;
  await removeScheduledWorkout(source);
  const queriesBeforePaste = queries.length;
  await copyScheduledWorkout(copied, targetDay);
  await copyScheduledWorkout(copied, targetDay);
  assert.ok(queries.slice(queriesBeforePaste).every((day) => day === targetDay),
    "pasting a snapshot does not look up the deleted source");
  const pastes = writes.slice(1);
  assert.equal(pastes.length, 2);
  for (const paste of pastes) {
    assert.equal(paste.programs[0].name, "Original run");
    assert.equal(paste.programs[0].exercises[0].targetValue, 500000);
    assert.deepEqual(paste.entities[0].exerciseBarChart, [1, 2]);
    assert.equal(paste.entities[0].happenDay, targetDay);
  }
  assert.notEqual(pastes[0].programs[0].idInPlan, pastes[1].programs[0].idInPlan);
  assert.equal(copied.rawProgram.idInPlan, 9, "repeat pastes do not mutate the clipboard");

  // A drag carries identifiers, so it still resolves the live source.
  const [dragSource] = await listScheduledWorkoutEntries(targetDay, targetDay);
  await copyScheduledWorkout({ planId: dragSource.planId, idInPlan: dragSource.idInPlan,
    happenDay: dragSource.happenDay }, "20990103");
  assert.equal(writes.at(-1).programs[0].name, "Original run");
  await assert.rejects(copyScheduledWorkout(copied, "20000101"), /before today/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Calendar copy snapshots survive edits/deletion, repeat pastes and drag copies passed.");
