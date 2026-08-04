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
const planWorkoutEditor = await import(distUrl("planWorkoutEditor.js"));
const chatWorkoutTools = await import(distUrl("chatWorkoutTools.js"));

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

const generationRequest = {
  goal: "Build durable mountain endurance",
  sports: ["run", "strength", "swim"],
  difficulty: "advanced",
  weeks: 2,
  sessionsPerWeek: 2,
  startDate: "2026-08-03",
  availableDayIndexes: [0, 2],
  maxSessionMinutes: 90,
  constraints: "Keep Wednesday joint-friendly."
};
const generatedDraft = {
  draftId: "typed-draft",
  name: "Mountain durability",
  summary: "Two focused weeks built from current recovery context.",
  conflicts: [],
  warnings: ["Review loads before saving."],
  entries: [
    {
      key: "w1-run",
      name: "Uphill repeats",
      scheduleDate: "20260803",
      saveToLibrary: false,
      workoutType: "run",
      source: {
        key: "w1-run",
        name: "Uphill repeats",
        sport: "run",
        schedule_date: "20260803",
        save_to_library: false,
        steps: [{
          repeat: 4,
          name: "Climbing set",
          steps: [{ kind: "training", name: "Uphill", target_type: "time", target_duration_seconds: 240, intensity: { type: "heartRatePercent", basis: "lthr", lowPercent: 92, highPercent: 98 } }, { kind: "rest", name: "Float down", target_type: "time", target_duration_seconds: 120, intensity: { type: "none" } }]
        }]
      }
    },
    {
      key: "w1-strength",
      name: "Trail strength",
      scheduleDate: "20260805",
      saveToLibrary: false,
      workoutType: "strength",
      source: {
        key: "w1-strength", name: "Trail strength", sport: "strength", schedule_date: "20260805",
        steps: [{ kind: "training", name: "Goblet squat", target_type: "reps", target_reps: 10, exercise_id: "squat-1", exercise_name: "Goblet Squat", exercise_kind: 3, intensity: { type: "weight", mode: "weight", value: 24, unit: "kg" } }]
      }
    },
    {
      key: "w2-run", name: "Steady trail", scheduleDate: "20260810", saveToLibrary: false, workoutType: "run",
      source: { key: "w2-run", name: "Steady trail", sport: "run", schedule_date: "20260810", steps: [{ kind: "training", target_type: "distance", target_distance_meters: 12_000, intensity: { type: "effortPace", lowSecondsPerKm: 330, highSecondsPerKm: 360, displayUnit: "km" } }] }
    },
    {
      key: "w2-swim", name: "Pool recovery", scheduleDate: "20260812", saveToLibrary: false, workoutType: "swim",
      source: { key: "w2-swim", name: "Pool recovery", sport: "swim", sport_options: { poolLength: { value: 25, unit: "m" } }, schedule_date: "20260812", steps: [{ kind: "sendOff", target_type: "distance", target_distance_meters: 100, send_off_seconds: 120, intensity: { type: "swimStroke", stroke: "freestyle" } }] }
    }
  ]
};
const generated = domain.trainingPlanFromDraftPreview(generatedDraft, generationRequest);
assert.equal(generated.source, "coach");
assert.equal(generated.weekCount, 2);
assert.equal(generated.entries.length, 4);
assert.equal(generated.entries[0].workout.steps[0].repeat, 4);
assert.deepEqual(generated.entries[1].workout.steps[0].intensity, { type: "weight", mode: "weight", value: 24, unit: "kg" });
assert.deepEqual(generated.entries[3].workout.sport_options, { poolLength: { value: 25, unit: "m" } });
assert.match(generated.notes, /Review loads/);
const tuesdayDraft = structuredClone(generatedDraft);
tuesdayDraft.draftId = "tuesday-start";
const tuesdayDates = ["20260804", "20260806", "20260811", "20260813"];
tuesdayDraft.entries.forEach((entry, index) => {
  entry.scheduleDate = tuesdayDates[index];
  entry.source.schedule_date = tuesdayDates[index];
});
const tuesdayPlan = domain.trainingPlanFromDraftPreview(tuesdayDraft, {
  ...generationRequest,
  startDate: "2026-08-04",
  availableDayIndexes: [1, 3]
});
assert.deepEqual(tuesdayPlan.entries.map((entry) => [entry.weekIndex, entry.dayIndex]), [[0, 0], [0, 2], [1, 0], [1, 2]]);
assert.throws(
  () => domain.trainingPlanFromDraftPreview(tuesdayDraft, { ...generationRequest, startDate: "2026-08-04" }),
  /unavailable day/i
);
const coachLibraryPlan = domain.trainingPlanFromCoachDraftPreview(generatedDraft);
assert.equal(coachLibraryPlan.source, "coach");
assert.equal(coachLibraryPlan.startDate, "2026-08-03");
assert.equal(coachLibraryPlan.entries[3].weekIndex, 1);
assert.deepEqual(coachLibraryPlan.entries[0].workout.steps, generatedDraft.entries[0].source.steps);
const undatedCoachPlan = domain.trainingPlanFromCoachDraftPreview({
  ...generatedDraft,
  draftId: "undated-coach",
  entries: [{ key: "holding", name: "Decide later", sport: "run", saveToLibrary: false, workoutType: "run", conflicts: [], warnings: [] }]
});
assert.equal(undatedCoachPlan.startDate, undefined);
assert.equal(undatedCoachPlan.entries[0].dayIndex, undefined);
assert.equal(undatedCoachPlan.entries[0].workout.name, "Decide later");
assert.throws(
  () => domain.trainingPlanFromDraftPreview({ ...generatedDraft, entries: generatedDraft.entries.slice(0, 3) }, generationRequest),
  /week 2 has 1 workouts/i
);

const intensityFamilies = [
  { type: "none" },
  { type: "heartRate", lowBpm: 130, highBpm: 145 },
  { type: "heartRatePercent", basis: "reserve", preset: "aerobicEndurance", zoneId: 2 },
  { type: "heartRatePercent", basis: "maxHr", lowPercent: 70, highPercent: 80 },
  { type: "pace", lowSecondsPerKm: 270, highSecondsPerKm: 300, displayUnit: "km" },
  { type: "effortPace", lowSecondsPerKm: 285, highSecondsPerKm: 315, displayUnit: "mi" },
  { type: "thresholdPacePercent", preset: "threshold", zoneId: 4 },
  { type: "effortPacePercent", lowPercent: 88, highPercent: 96 },
  { type: "ftpPercent", preset: "aerobicPower", zoneId: 3 },
  { type: "power", lowWatts: 220, highWatts: 260 },
  { type: "power", preset: "interval", zoneId: 4 },
  { type: "speed", low: 10, high: 13, unit: "km/h" },
  { type: "cadence", low: 82, high: 92, unit: "rpm" },
  { type: "swimStroke", stroke: "individualMedley" },
  { type: "weight", mode: "bodyweight" },
  { type: "weight", mode: "weight", value: 50, unit: "lb" },
  { type: "rpe", value: 8 },
  { type: "climbGrade", system: "yds", relativeToOnsight: -1 },
  { type: "climbGrade", system: "font", absoluteGrade: "7A" },
  { type: "lthrPercent", lowPercent: 90, highPercent: 95, zoneId: 4 }
];
const targetSteps = [
  { kind: "training", name: "Time", target_type: "time", target_duration_seconds: 300 },
  { kind: "training", name: "Distance", target_type: "distance", target_distance_meters: 1_200 },
  { kind: "training", name: "Load", target_type: "load", target_load: 50 },
  { kind: "rest", name: "HR recovery", target_type: "hrRecovery", target_hr_recovery_bpm: 110 },
  { kind: "training", name: "Open", target_type: "open" },
  { kind: "training", name: "Reps", target_type: "reps", target_reps: 12, exercise_id: "exercise-1", exercise_name: "Squat", exercise_kind: 2 },
  { kind: "training", name: "Vert", target_type: "elevationGain", target_elevation_gain_meters: 400 },
  { kind: "training", name: "Routes", target_type: "routes", target_routes: 5 }
].map((step, index) => ({ ...step, intensity: intensityFamilies[index] }));
const remainingIntensitySteps = intensityFamilies.slice(targetSteps.length).map((intensity, index) => ({ kind: "training", name: `Intensity ${index}`, target_type: "time", target_duration_seconds: 60, intensity }));
const roundTripSource = {
  key: "typed-round-trip",
  name: "All typed controls",
  description: "Keep every target and intensity family.",
  sport: "swim",
  sport_options: { poolLength: { value: 25, unit: "yd" }, gradingSystem: "font" },
  schedule_date: "20260803",
  sort_no: 4,
  steps: [...targetSteps, { repeat: 3, name: "Typed repeat", steps: remainingIntensitySteps }]
};
const editorDraft = planWorkoutEditor.planWorkoutInputToEditorDraft(roundTripSource);
const roundTripped = planWorkoutEditor.editorDraftToPlanWorkoutInput(editorDraft, roundTripSource);
assert.equal(roundTripped.name, roundTripSource.name);
assert.deepEqual(roundTripped.sport_options, roundTripSource.sport_options);
assert.deepEqual(roundTripped.steps, roundTripSource.steps);
assert.equal(roundTripped.schedule_date, "20260803");
assert.equal(roundTripped.save_to_library, false);
const linkedEntry = { ...domain.planEntryFromWorkout({ key: "linked", name: "Linked source", sport: "strength" }, 0, 0, "remote-program"), plannedTrainingLoad: 80 };
const detachedEntry = planWorkoutEditor.replaceTrainingPlanEntryWorkout(linkedEntry, {
  key: "linked",
  name: "Edited plan copy",
  sport: "strength",
  steps: [{ kind: "training", name: "Deadlift", target_type: "reps", target_reps: 5, exercise_id: "deadlift-1", exercise_name: "Deadlift", exercise_kind: 4, intensity: { type: "weight", mode: "weight", value: 100, unit: "kg" } }]
});
assert.equal(detachedEntry.programId, undefined, "editing a linked workout detaches only the plan copy");
assert.equal(detachedEntry.plannedTrainingLoad, undefined);
assert.equal(linkedEntry.programId, "remote-program", "the linked source entry remains unchanged");
assert.equal(detachedEntry.workout.steps[0].exercise_id, "deadlift-1");
for (const specialistInput of [
  { key: "pool", name: "Pool", sport: "swim", sport_options: { poolLength: { value: 50, unit: "m" } }, steps: [{ kind: "sendOff", name: "100s", target_type: "distance", target_distance_meters: 100, send_off_seconds: 105, intensity: { type: "swimStroke", stroke: "butterfly" } }] },
  { key: "climb", name: "Boulders", sport: "bouldering", sport_options: { gradingSystem: "font" }, steps: [{ kind: "training", name: "Limit route", target_type: "routes", target_routes: 4, intensity: { type: "climbGrade", system: "font", absoluteGrade: "7B" } }] },
  { key: "strength", name: "Push", sport: "strength", steps: [{ kind: "training", name: "Bench Press", target_type: "reps", target_reps: 8, exercise_id: "bench-press", exercise_name: "Bench Press", sets: 4, rest_type: 1, rest_value: 90, overview: "Pause on the chest", intensity: { type: "weight", mode: "weight", value: 70, unit: "kg" } }] }
]) {
  const specialistDraft = planWorkoutEditor.planWorkoutInputToEditorDraft(specialistInput);
  assert.deepEqual(planWorkoutEditor.editorDraftToPlanWorkoutInput(specialistDraft, specialistInput).steps, specialistInput.steps);
  assert.deepEqual(planWorkoutEditor.editorDraftToPlanWorkoutInput(specialistDraft, specialistInput).sport_options, specialistInput.sport_options);
}

const calendarPlan = structuredClone(generated);
calendarPlan.startDate = "2099-08-03";
calendarPlan.entries = calendarPlan.entries.slice(0, 2).map((entry, index) => ({ ...entry, weekIndex: 0, dayIndex: index * 2 }));
const projection = library.buildTrainingPlanCalendarProjection(calendarPlan, "2099-08-03", [
  { planId: "other", idInPlan: "existing", planProgramId: "other-program", happenDay: "20990803", name: "Existing run" }
], "20990101");
assert.equal(projection.entries.length, 2);
assert.equal(projection.entries[1].happenDay, "20990805");
assert.equal(projection.conflicts[0].existing[0].name, "Existing run");
const holdingPlan = structuredClone(calendarPlan);
holdingPlan.entries[0].dayIndex = undefined;
assert.match(library.buildTrainingPlanCalendarProjection(holdingPlan, "2099-08-03", [], "20990101").blockers[0], /holding area/i);
const anyDayProjection = library.buildTrainingPlanCalendarProjection(calendarPlan, "2099-08-04", [], "20990101");
assert.equal(anyDayProjection.startDate, "2099-08-04");
assert.deepEqual(anyDayProjection.entries.map((entry) => entry.happenDay), ["20990804", "20990806"]);
const revisionBefore = domain.trainingPlanCalendarRevision(calendarPlan);
calendarPlan.entries[0].title = "Edited after install";
assert.notEqual(domain.trainingPlanCalendarRevision(calendarPlan), revisionBefore);

const rawNative = {
  id: "remote-1",
  name: "Native Build",
  overview: "Preserve this plan",
  totalDay: 14,
  version: 7,
  unknownFutureField: { keep: true },
  entities: [
    { id: "native-entity-1", idInPlan: "entry-1", planProgramId: "pp-1", dayNo: 0, happenDay: "20260803" }
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
assert.equal(native.entities[0].id, "native-entity-1");

const duplicateNative = adapter.parseNativeCorosPlan({
  id: "remote-duplicates",
  name: "Native duplicate identities",
  totalDay: 7,
  entities: [
    { id: "occurrence-a", idInPlan: "shared", planProgramId: "pp-shared", dayNo: 0, happenDay: "20260803" },
    { id: "occurrence-b", idInPlan: "shared", planProgramId: "pp-shared", dayNo: 1, happenDay: "20260804" },
    { id: "occurrence-b", idInPlan: "shared", planProgramId: "pp-shared", dayNo: 1, happenDay: "20260804" },
    { idInPlan: "shared", planProgramId: "pp-shared", dayNo: 2, happenDay: "20260805" },
    { id: "raw-unique", idInPlan: "unique", planProgramId: "pp-unique", dayNo: 3, happenDay: "20260806" }
  ],
  programs: [
    { id: "program-shared", idInPlan: "shared", planProgramId: "pp-shared", name: "Repeated run", sportType: 1 },
    { id: "program-unique", idInPlan: "unique", planProgramId: "pp-unique", name: "Unique run", sportType: 1 }
  ]
});
assert.equal(duplicateNative.entities.length, 5, "the lossless adapter retains exact duplicate source rows");

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

let groupedDraftPreview;
const groupedDraftResponse = JSON.parse(await chatWorkoutTools.handleChatWorkoutTool(
  "draft_training_plan",
  {
    name: "Grouped Coach Plan",
    workouts: [
      { ...makeWorkout("Easy Monday", 35), schedule_date: "20990803" },
      { ...makeWorkout("Steady Wednesday", 45), schedule_date: "20990805" }
    ]
  },
  {
    allowUpcomingWorkouts: false,
    onPlanDraft: (preview) => { groupedDraftPreview = preview; }
  }
));
assert.equal(groupedDraftResponse.ok, true);
const groupedSaveResult = await chatWorkoutTools.uploadPlanDraftById(
  groupedDraftPreview.draftId,
  "metric",
  "localPlan"
);
assert.equal(groupedSaveResult.destination, "localPlan");
assert.equal(groupedSaveResult.groupedPlanCreated, true);
assert.deepEqual(groupedSaveResult.remoteWrites, []);
const persistedGroupedPlan = databaseModule.getTrainingPlanDocument(groupedSaveResult.localPlanId);
assert.equal(persistedGroupedPlan.name, "Grouped Coach Plan");
assert.equal(persistedGroupedPlan.source, "coach");
assert.equal(persistedGroupedPlan.entries.length, 2);

const duplicateNativeDocument = library.nativePlanToDocument(duplicateNative);
assert.equal(duplicateNativeDocument.entries.length, 4, "exact duplicate native entities are collapsed");
assert.equal(
  new Set(duplicateNativeDocument.entries.map((entry) => entry.id)).size,
  duplicateNativeDocument.entries.length,
  "duplicate idInPlan values receive unique local entry IDs"
);
assert.equal(
  duplicateNativeDocument.entries.some((entry) => entry.id === "coros:remote-duplicates:entity:occurrence-a"),
  true,
  "the raw COROS occurrence ID disambiguates reused idInPlan values"
);
assert.equal(
  duplicateNativeDocument.entries.some((entry) => entry.id.startsWith("coros:remote-duplicates:occurrence:shared:")),
  true,
  "a stable fingerprint disambiguates occurrences without a raw ID"
);
assert.equal(
  duplicateNativeDocument.entries.some((entry) => entry.id === "coros:remote-duplicates:unique"),
  true,
  "non-colliding plans retain their legacy local identity"
);
databaseModule.saveTrainingPlanDocument(duplicateNativeDocument, duplicateNative.rawPayload);
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM training_plan_workout_links WHERE plan_id = ?").get(duplicateNativeDocument.id).count,
  4
);

const invalidDuplicateDocument = structuredClone(first);
invalidDuplicateDocument.id = "plan:duplicate-entry-guard";
invalidDuplicateDocument.entries[1].id = invalidDuplicateDocument.entries[0].id;
assert.throws(
  () => databaseModule.saveTrainingPlanDocument(invalidDuplicateDocument),
  /contains duplicate entry IDs/i,
  "persistence rejects inconsistent documents with an actionable error"
);

databaseModule.saveTrainingPlanDocument(first, rawNative);
assert.equal(databaseModule.getTrainingPlanDocument(first.id).name, "Build");
assert.equal(databaseModule.getNativePlanRawPayload(first.id).unknownFutureField.keep, true);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM training_plan_workout_links WHERE plan_id = ?").get(first.id).count, 3);

const installedPlan = structuredClone(calendarPlan);
installedPlan.id = "plan:installed-test";
installedPlan.calendarInstalls = [{
  id: "install-1",
  startDate: "2099-08-03",
  planRevision: domain.trainingPlanCalendarRevision(installedPlan),
  state: "active",
  lastOperation: "install",
  occurrences: [{
    planEntryId: installedPlan.entries[0].id,
    happenDay: "20990803",
    schedulePlanId: "owned-schedule",
    scheduleIdInPlan: "owned-occurrence",
    planProgramId: "owned-program",
    createdAt: "2099-08-03T12:00:00.000Z"
  }],
  failures: [],
  createdAt: "2099-08-03T12:00:00.000Z",
  updatedAt: "2099-08-03T12:00:00.000Z"
}];
databaseModule.saveTrainingPlanDocument(installedPlan);
assert.equal(domain.activeTrainingPlanCalendarInstall(installedPlan, "20990101").id, "install-1");
assert.match(library.buildTrainingPlanCalendarProjection(installedPlan, "2099-08-03", [], "20990101").blockers[0], /already has an active/i);
assert.throws(() => library.deleteLocalTrainingPlan(installedPlan.id, true), /future calendar workouts/i);

let mockCalendar = [];
let mockIdentity = 0;
const writeOrder = [];
const embeddedUnitSystems = [];
const appendMockOccurrence = (name, happenDay) => {
  mockIdentity += 1;
  mockCalendar.push({
    planId: `owned-plan-${mockIdentity}`,
    idInPlan: `owned-id-${mockIdentity}`,
    planProgramId: `owned-program-${mockIdentity}`,
    happenDay,
    name
  });
};
library.setTrainingPlanCalendarAdapterForTests({
  listScheduled: async (startDay, endDay) => mockCalendar.filter((entry) => entry.happenDay >= startDay && entry.happenDay <= endDay),
  scheduleLibrary: async (_programId, happenDay) => {
    writeOrder.push(`library:${happenDay}`);
    appendMockOccurrence("Uphill repeats", happenDay);
  },
  createAndSchedule: async (entry, happenDay, unitSystem, saveToLibrary) => {
    writeOrder.push(`embedded:${happenDay}`);
    embeddedUnitSystems.push(unitSystem);
    assert.equal(saveToLibrary, false, "plan installs keep embedded workouts out of the library");
    appendMockOccurrence(entry.name, happenDay);
    return {};
  },
  removeScheduled: async (entry) => {
    writeOrder.push(`remove:${entry.planId}:${entry.idInPlan}`);
    mockCalendar = mockCalendar.filter((candidate) => !(candidate.planId === entry.planId && candidate.idInPlan === entry.idInPlan));
  }
});
const mutationPlan = structuredClone(generated);
mutationPlan.id = "plan:mutation-test";
mutationPlan.startDate = "2099-08-03";
mutationPlan.weekCount = 1;
mutationPlan.entries = mutationPlan.entries.slice(0, 2).map((entry, index) => ({ ...entry, weekIndex: 0, dayIndex: index * 2 }));
mutationPlan.entries[0].programId = "linked-library-program";
mutationPlan.entries[0].workout = { key: "linked", name: "Uphill repeats", sport: "run", save_to_library: false };
mutationPlan.calendarInstalls = [];
databaseModule.saveTrainingPlanDocument(mutationPlan);
mockCalendar.push({ planId: "preexisting", idInPlan: "morning", planProgramId: "morning-program", happenDay: "20990803", name: "Morning recovery" });
const installPreview = await library.previewTrainingPlanCalendar(mutationPlan.id, "2099-08-03");
assert.equal(installPreview.conflicts[0].existing[0].name, "Morning recovery");
const installResult = await library.addTrainingPlanToCalendar(installPreview.previewId, true, "imperial");
assert.deepEqual(writeOrder.slice(0, 2), ["library:20990803", "embedded:20990805"], "calendar writes remain serialized in plan order");
assert.deepEqual(embeddedUnitSystems, ["imperial"], "only embedded workouts are rebuilt with the selected units");
assert.equal(installResult.scheduledCount, 2);
assert.equal(installResult.failures.length, 0);
assert.equal(installResult.plan.calendarInstalls[0].occurrences.length, 2);
assert.equal(installResult.plan.calendarInstalls[0].occurrences[0].scheduleIdInPlan, "owned-id-1");
assert.equal(mockCalendar.some((entry) => entry.planId === "preexisting"), true, "confirmed conflicts are kept alongside the plan");
const duplicatePreview = await library.previewTrainingPlanCalendar(mutationPlan.id, "2099-08-03");
assert.match(duplicatePreview.blockers[0], /already has an active/i);

const installedMutationPlan = databaseModule.getTrainingPlanDocument(mutationPlan.id);
installedMutationPlan.calendarInstalls[0].occurrences.push({ planEntryId: installedMutationPlan.entries[0].id, happenDay: "20200101", schedulePlanId: "past-owned", scheduleIdInPlan: "past-id", planProgramId: "past-program", createdAt: "2020-01-01T12:00:00.000Z" });
databaseModule.saveTrainingPlanDocument(installedMutationPlan);
mockCalendar.push({ planId: "past-owned", idInPlan: "past-id", planProgramId: "past-program", happenDay: "20200101", name: "Past completed workout" });
mockCalendar = mockCalendar.filter((entry) => !(entry.planId === "owned-plan-1" && entry.idInPlan === "owned-id-1"));
mockCalendar.push({ planId: "unrelated", idInPlan: "same-name", planProgramId: "unrelated-program", happenDay: "20990803", name: "Uphill repeats" });
const removalPreview = await library.previewTrainingPlanCalendarRemoval(mutationPlan.id);
const removalResult = await library.removeTrainingPlanFromCalendar(removalPreview.previewId, true);
assert.equal(removalResult.removedCount, 1, "already-absent owned occurrences are handled idempotently");
assert.equal(mockCalendar.some((entry) => entry.planId === "unrelated" && entry.idInPlan === "same-name"), true, "same-name unrelated workouts are preserved");
assert.equal(mockCalendar.some((entry) => entry.planId === "past-owned"), true, "past owned workouts are preserved");
assert.equal(databaseModule.getTrainingPlanDocument(mutationPlan.id).calendarInstalls[0].state, "removed");

const stalePlan = structuredClone(mutationPlan);
stalePlan.id = "plan:stale-preview";
stalePlan.calendarInstalls = [];
databaseModule.saveTrainingPlanDocument(stalePlan);
const stalePreview = await library.previewTrainingPlanCalendar(stalePlan.id, "2099-08-03");
mockCalendar.push({ planId: "calendar-change", idInPlan: "new", planProgramId: "new-program", happenDay: "20990805", name: "Changed elsewhere" });
await assert.rejects(library.addTrainingPlanToCalendar(stalePreview.previewId, true, "imperial"), /calendar changed/i);
const revisionStalePlan = structuredClone(stalePlan);
revisionStalePlan.id = "plan:revision-stale-preview";
databaseModule.saveTrainingPlanDocument(revisionStalePlan);
const revisionStalePreview = await library.previewTrainingPlanCalendar(revisionStalePlan.id, "2099-08-03");
revisionStalePlan.entries[0].title = "Changed after preview";
databaseModule.saveTrainingPlanDocument(revisionStalePlan);
await assert.rejects(library.addTrainingPlanToCalendar(revisionStalePreview.previewId, true, "imperial"), /plan changed/i);

mockCalendar = [];
const partialPlan = structuredClone(generated);
partialPlan.id = "plan:partial-install";
partialPlan.startDate = "2099-08-03";
partialPlan.weekCount = 1;
partialPlan.entries = partialPlan.entries.slice(0, 2).map((entry, index) => ({ ...entry, weekIndex: 0, dayIndex: index * 2, programId: undefined }));
partialPlan.calendarInstalls = [];
databaseModule.saveTrainingPlanDocument(partialPlan);
library.setTrainingPlanCalendarAdapterForTests({
  listScheduled: async (startDay, endDay) => mockCalendar.filter((entry) => entry.happenDay >= startDay && entry.happenDay <= endDay),
  createAndSchedule: async (entry, happenDay, unitSystem) => {
    assert.equal(unitSystem, "metric", "metric plan installs preserve the selected units");
    if (entry.name === "Trail strength") throw new Error("mock write failure");
    appendMockOccurrence(entry.name, happenDay);
    return {};
  },
  removeScheduled: async (entry) => {
    mockCalendar = mockCalendar.filter((candidate) => !(candidate.planId === entry.planId && candidate.idInPlan === entry.idInPlan));
  }
});
const partialPreview = await library.previewTrainingPlanCalendar(partialPlan.id, "2099-08-03");
const partialResult = await library.addTrainingPlanToCalendar(partialPreview.previewId, true, "metric");
assert.equal(partialResult.scheduledCount, 1);
assert.equal(partialResult.failures.length, 1);
assert.equal(partialResult.plan.calendarInstalls[0].state, "partial");
assert.equal(partialResult.plan.calendarInstalls[0].occurrences.length, 1, "successful writes persist during a partial install");
const partialRemovalPreview = await library.previewTrainingPlanCalendarRemoval(partialPlan.id);
const partialRemoval = await library.removeTrainingPlanFromCalendar(partialRemovalPreview.previewId, true);
assert.equal(partialRemoval.removedCount, 1, "known occurrences remain removable after a partial install");
assert.equal(partialRemoval.failures.some((failure) => failure.writeMayHaveSucceeded), true, "unverified writes remain recorded instead of being retried by name");
library.setTrainingPlanCalendarAdapterForTests();

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
