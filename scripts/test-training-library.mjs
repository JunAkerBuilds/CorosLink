import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

const domain = await import(distUrl("trainingPlanDomain.js"));
const adapter = await import(distUrl("corosTrainingPlanAdapter.js"));
const databaseModule = await import(distUrl("database.js"));
const library = await import(distUrl("trainingLibraryService.js"));

const makeWorkout = (name, load, seconds = 1_800) => ({
  key: name.toLowerCase().replaceAll(" ", "-"),
  name,
  sport: "run",
  steps: [
    {
      kind: "training",
      target_type: "time",
      target_duration_seconds: seconds,
      target_load: load,
      intensity: { type: "heartRate", lowBpm: 135, highBpm: 145 }
    }
  ]
});

const first = domain.createTrainingPlan("Build", "local");
first.weekCount = 2;
first.startDate = "2026-08-03";
first.phases = [{ id: "base", name: "Base", kind: "base", startWeek: 1, endWeek: 2 }];
first.entries = [
  domain.planEntryFromWorkout(makeWorkout("Easy", 40), 0, 0),
  domain.planEntryFromWorkout(makeWorkout("Threshold", 80, 2_700), 1, 2),
  domain.planEntryFromWorkout(makeWorkout("Double", 20), 1, 2)
];

const shifted = domain.shiftTrainingPlan(first, "2026-08-10");
assert.equal(shifted.startDate, "2026-08-10");
assert.equal(shifted.entries[0].workout.schedule_date, "2026-08-10");
assert.equal(shifted.entries[1].workout.schedule_date, "2026-08-19");

const duplicated = domain.duplicateTrainingPlanWeek(first, 0);
assert.equal(duplicated.weekCount, 3);
assert.equal(duplicated.entries.filter((entry) => entry.weekIndex === 1).length, 1);
assert.notEqual(duplicated.entries[0].id, duplicated.entries.at(-1).id);

const recovery = domain.insertRecoveryWeek(first, 0);
assert.equal(recovery.weekCount, 3);
assert.equal(recovery.entries.filter((entry) => entry.weekIndex === 1).length, 0);
assert.equal(recovery.phases.some((phase) => phase.kind === "recovery"), true);

const reordered = domain.reorderTrainingPlanWeek(first, 0, 1);
assert.equal(reordered.entries[0].weekIndex, 1);
assert.equal(reordered.phases.length, 1, "week reordering preserves phase metadata");

const summary = domain.summarizeTrainingPlan(first);
assert.equal(summary.workouts, 3);
assert.equal(summary.trainingLoad, 140);
assert.equal(summary.conflictCount, 1);
assert.equal(
  domain.validateTrainingPlan({ ...first, name: "" }).some((issue) => issue.path === "name"),
  true
);

const second = structuredClone(first);
second.id = "plan:second";
second.name = "Lower load";
second.entries = [domain.planEntryFromWorkout(makeWorkout("Easy", 20), 0, 0)];
const comparison = domain.compareTrainingPlans([first, second]);
assert.deepEqual(comparison.sharedWorkoutNames, ["Easy"]);
assert.equal(comparison.summaries.length, 2);
assert.equal(comparison.insights.some((insight) => insight.includes("more estimated training load")), true);

const rawNative = {
  id: "remote-1",
  name: "Native Build",
  overview: "Preserve this plan",
  totalDay: 14,
  version: 7,
  unknownFutureField: { keep: true },
  entities: [
    { idInPlan: "entry-1", planProgramId: "pp-1", dayNo: 0, happenDay: "20260803" }
  ],
  programs: [
    {
      id: "program-1",
      idInPlan: "entry-1",
      planProgramId: "pp-1",
      name: "Native Run",
      sportType: 1,
      duration: 2_400,
      distance: 6_000,
      trainingLoad: 55,
      totalSets: 3,
      opaqueProgramField: "round-trip"
    }
  ],
  weekStages: [{ weekNo: 1, stage: "Base", planTrainingLoad: 55 }]
};
const native = adapter.parseNativeCorosPlan(rawNative, "2026-07-29T00:00:00.000Z");
assert.equal(native.remoteId, "remote-1");
assert.equal(native.programs[0].planTrainingLoad, 55);
assert.equal(native.programs[0].planDuration, 2_400);
assert.equal(native.programs[0].planDistance, 6_000);
assert.equal(native.programs[0].planSets, 3);
assert.equal(native.rawPayload.unknownFutureField.keep, true);
assert.equal(native.sportTypes[0], 1);

const day = new Date(2099, 11, 1, 12, 0, 0).valueOf();
const scheduled = [
  { planId: "schedule", idInPlan: "one", planProgramId: "pp", happenDay: "20991201", name: "Easy", sportType: 1, trainingLoad: 40 },
  { planId: "schedule", idInPlan: "two", planProgramId: "pp2", happenDay: "20991202", name: "Restored", sportType: 1, trainingLoad: 30 }
];
const activities = [
  { activityId: "activity-1", name: "Easy", sportType: 1, startTime: day, duration: 1_800, distance: 5_000, trainingLoad: 38 }
];
const matches = library.buildTrainingActivityMatches(scheduled, activities, [], "20991202");
assert.equal(matches[0].status, "completed");
assert.equal(matches[0].activityId, "activity-1");
assert.equal(matches[0].confidence >= 0.9, true);
assert.equal(matches[1].status, "upcoming");
const manual = library.buildTrainingActivityMatches(
  scheduled,
  activities,
  [{ ...matches[1], status: "skipped", manual: true }],
  "21000101"
);
assert.equal(manual[1].status, "skipped");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-training-library-"));
const legacyPath = path.join(tempRoot, "coros-desktop.sqlite");
const legacy = new Database(legacyPath);
legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("preserved", "yes");
legacy.close();

const db = databaseModule.initializeDatabase(tempRoot);
assert.equal(fs.existsSync(path.join(tempRoot, "coroslink.sqlite")), true);
assert.equal(db.prepare("SELECT value FROM app_settings WHERE key = ?").get("preserved").value, "yes");
const expectedTables = [
  "training_plans",
  "training_workout_metadata",
  "training_collections",
  "training_plan_workout_links",
  "training_activity_matches"
];
const tableNames = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
);
for (const table of expectedTables) assert.equal(tableNames.has(table), true, `${table} was migrated`);

databaseModule.saveTrainingPlanDocument(first, rawNative);
assert.equal(databaseModule.getTrainingPlanDocument(first.id).name, "Build");
assert.equal(databaseModule.getNativePlanRawPayload(first.id).unknownFutureField.keep, true);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM training_plan_workout_links WHERE plan_id = ?").get(first.id).count, 3);

assert.throws(() => library.deleteLocalTrainingPlan(first.id, false), /confirmation/i);
assert.throws(() => library.removeTrainingCollection("collection", false), /confirmation/i);
await assert.rejects(
  library.deleteTrainingLibraryWorkouts({ programIds: ["remote"], confirmed: false }),
  /confirmation/i
);
assert.equal(library.getNativePlanWriteCapabilities().create, false);

db.close();
fs.rmSync(tempRoot, { recursive: true, force: true });

console.log("test-training-library: ok");
