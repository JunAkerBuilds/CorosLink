import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "corosWorkoutEditor.js")
).href;

const {
  buildScheduledWorkoutEditRequest,
  corosProgramToWorkoutDraft,
  parseWorkoutEditorContext,
  runWorkoutEditPreview,
  runWorkoutEditWrite,
  validateWorkoutDraft,
  workoutDraftsMatch,
  workoutDraftToCorosProgram,
  workoutEditRevision
} = await import(`${moduleUrl}?cacheBust=${Date.now()}`);

const source = {
  id: "program-44",
  idInPlan: "91",
  name: "Full COROS Run",
  overview: "Keep this description",
  sportType: 1,
  version: 12,
  pbVersion: 7,
  sourceId: "source-program",
  unknownProgramField: { preserve: true },
  distance: "500000.00",
  duration: 2400,
  trainingLoad: 72,
  exercises: [
    {
      id: "70",
      name: "Warm Up",
      exerciseType: 1,
      sportType: 1,
      targetType: 2,
      targetValue: 600,
      targetDisplayUnit: 0,
      intensityType: 0,
      intensityValue: 0,
      intensityValueExtend: 0,
      sortNo: 16_777_216,
      sets: 1,
      groupId: "0",
      isGroup: false,
      originId: "warm-origin",
      unknownExerciseField: "warm-preserved"
    },
    {
      id: "71",
      name: "Repeat",
      exerciseType: 0,
      sportType: 1,
      targetType: 5,
      targetValue: 80000,
      sets: 4,
      sortNo: 33_554_432,
      groupId: "0",
      isGroup: true,
      sourceId: "group-source",
      unknownGroupField: 123
    },
    {
      id: "72",
      name: "Training",
      exerciseType: 2,
      sportType: 1,
      targetType: 5,
      targetValue: 80000,
      targetDisplayUnit: 2,
      intensityType: 3,
      intensityValue: 245000,
      intensityValueExtend: 255000,
      intensityDisplayUnit: 1,
      intensityMultiplier: 1000,
      sets: 1,
      sortNo: 33_619_968,
      groupId: "71",
      isGroup: false,
      sourceId: "pace-source",
      unknownPaceField: "preserve"
    },
    {
      id: "73",
      name: "Rest",
      exerciseType: 4,
      sportType: 1,
      targetType: 7,
      targetValue: 118,
      intensityType: 2,
      intensityValue: 120,
      intensityValueExtend: 135,
      hrType: 3,
      isIntensityPercent: false,
      sets: 1,
      sortNo: 33_685_504,
      groupId: "71",
      isGroup: false
    },
    {
      id: "74",
      name: "Threshold finish",
      exerciseType: 2,
      sportType: 1,
      targetType: 6,
      targetValue: 42,
      intensityType: 2,
      intensityValue: 159,
      intensityValueExtend: 166,
      intensityPercent: 91,
      intensityPercentExtend: 95,
      isIntensityPercent: true,
      hrType: 3,
      sets: 1,
      sortNo: 50_331_648,
      groupId: "0",
      isGroup: false
    },
    {
      id: "75",
      name: "Cool Down",
      exerciseType: 3,
      sportType: 1,
      targetType: 1,
      targetValue: 0,
      intensityType: 0,
      sets: 1,
      sortNo: 67_108_864,
      groupId: "0",
      isGroup: false
    },
    {
      id: "80",
      name: "Route-only field",
      exerciseType: 2,
      sportType: 1,
      targetType: 9,
      targetValue: 123,
      intensityType: 6,
      intensityValue: 250,
      sets: 1,
      sortNo: 83_886_080,
      groupId: "0",
      isGroup: false,
      futureCorosField: { untouched: true }
    }
  ]
};

const metricContext = parseWorkoutEditorContext({
  unit: 0,
  zoneData: {
    lthr: 175,
    lthrZone: [
      { index: 1, ratio: 0.78 },
      { index: 2, ratio: 0.85 },
      { index: 3, ratio: 0.91 },
      { index: 4, ratio: 0.96 },
      { index: 5, ratio: 1.01 },
      { index: 6, ratio: 1.06 }
    ]
  }
});

assert.equal(metricContext.distanceUnit, "metric");
assert.equal(metricContext.paceUnit, "km");
assert.equal(metricContext.lthrBpm, 175);
assert.equal(metricContext.lthrZones[2]?.lowPercent, 91);
assert.equal(metricContext.lthrZones[2]?.lowBpm, 159);

const imperialContext = parseWorkoutEditorContext({
  unit: 1,
  zoneData: JSON.stringify({ lthr: 170, lthrZone: [] })
});
assert.equal(imperialContext.distanceUnit, "imperial");
assert.equal(imperialContext.paceUnit, "mi");

const draft = corosProgramToWorkoutDraft(source);
assert.equal(draft.name, source.name);
assert.equal(draft.nodes.length, 5);
assert.equal(draft.nodes[0]?.nodeType, "step");
assert.equal(draft.nodes[1]?.nodeType, "repeat");
assert.equal(draft.nodes[1]?.repeat, 4);
assert.equal(draft.nodes[1]?.steps.length, 2);
assert.deepEqual(draft.nodes[0]?.target, { type: "time", seconds: 600 });
assert.deepEqual(draft.nodes[1]?.steps[0]?.target, { type: "distance", meters: 800 });
assert.deepEqual(draft.nodes[1]?.steps[1]?.target, { type: "hrRecovery", bpm: 118 });
assert.deepEqual(draft.nodes[2]?.target, { type: "load", load: 42 });
assert.deepEqual(draft.nodes[3]?.target, { type: "open" });
assert.equal(draft.nodes[4]?.editable, false);

const roundTrip = workoutDraftToCorosProgram(source, draft, metricContext);
assert.equal(roundTrip.id, source.id);
assert.equal(roundTrip.version, source.version);
assert.equal(roundTrip.sourceId, source.sourceId);
assert.deepEqual(roundTrip.unknownProgramField, source.unknownProgramField);
assert.equal(roundTrip.exercises.find((item) => item.id === "70").unknownExerciseField, "warm-preserved");
assert.equal(roundTrip.exercises.find((item) => item.id === "71").unknownGroupField, 123);
assert.equal(roundTrip.exercises.find((item) => item.id === "72").unknownPaceField, "preserve");
assert.deepEqual(roundTrip.exercises.find((item) => item.id === "80").futureCorosField, { untouched: true });
assert.equal(roundTrip.exercises.find((item) => item.id === "72").targetValue, 80000);
assert.equal(roundTrip.exercises.find((item) => item.id === "72").intensityValue, 245000);
assert.equal(roundTrip.exercises.find((item) => item.id === "72").intensityMultiplier, 1000);
assert.equal(roundTrip.exercises.find((item) => item.id === "73").targetType, 7);
assert.equal(roundTrip.exercises.find((item) => item.id === "73").targetValue, 118);
assert.equal(roundTrip.exercises.find((item) => item.id === "74").intensityPercent, 91);
assert.equal(roundTrip.exercises.find((item) => item.id === "74").intensityPercentExtend, 95);
assert.equal(roundTrip.exercises.find((item) => item.id === "74").intensityValue, 0);
assert.equal(roundTrip.exercises.find((item) => item.id === "74").intensityValueExtend, 0);
assert.equal(workoutDraftsMatch(draft, roundTrip), true);

const withNewStep = structuredClone(draft);
withNewStep.nodes.push({
  id: "new-client-step",
  nodeType: "step",
  kind: "training",
  name: "New mile rep",
  target: { type: "distance", meters: 1609.344 },
  intensity: {
    type: "pace",
    lowSecondsPerKm: 300,
    highSecondsPerKm: 310,
    displayUnit: "mi"
  },
  editable: true
});
const imperialProgram = workoutDraftToCorosProgram(source, withNewStep, imperialContext);
const newExercise = imperialProgram.exercises.find((item) => item.name === "New mile rep");
assert.ok(BigInt(newExercise.id) > 80n);
assert.equal(newExercise.targetValue, 160934);
assert.equal(newExercise.targetDisplayUnit, 3);
assert.equal(newExercise.intensityDisplayUnit, 2);
assert.equal(newExercise.intensityMultiplier, 1000);

const invalid = structuredClone(draft);
invalid.name = "";
invalid.nodes[1].repeat = 100;
invalid.nodes[1].steps[1].target = { type: "hrRecovery", bpm: 10 };
const invalidResult = validateWorkoutDraft(invalid);
assert.equal(invalidResult.valid, false);
assert.match(invalidResult.errors.name, /required/);
assert.match(invalidResult.errors["nodes.1.repeat"], /1 to 99/);
assert.match(invalidResult.errors["nodes.1.steps.1.target"], /30 to 250/);

const entity = {
  happenDay: "20991201",
  planId: "plan-1",
  idInPlan: "91",
  planProgramId: "91",
  status: 1,
  unknownEntityField: "preserved"
};
const scheduledRequest = buildScheduledWorkoutEditRequest(
  {
    kind: "scheduled",
    happenDay: "20991201",
    planId: "plan-1",
    idInPlan: "91",
    planProgramId: "91"
  },
  entity,
  roundTrip
);
assert.equal(scheduledRequest.versionObjects[0].status, 2);
assert.equal(scheduledRequest.versionObjects[0].planId, "plan-1");
assert.equal(scheduledRequest.entities[0].unknownEntityField, "preserved");
assert.equal(scheduledRequest.programs[0].version, 12);
assert.equal(scheduledRequest.pbVersion, 7);

const calls = [];
const endpointAdapter = {
  calculate: async (program) => {
    calls.push(["calculate", program]);
    return { ...program, distance: "900000.00", duration: 2700, trainingLoad: 88 };
  },
  updateLibrary: async (program) => { calls.push(["program/update", program]); },
  updateScheduled: async (request) => { calls.push(["schedule/update", request]); },
  estimateScheduled: async (request) => {
    calls.push(["program/estimate", request]);
    return { distance: 900000, duration: 2700, trainingLoad: 88 };
  }
};

const libraryRef = { kind: "library", programId: "program-44" };
await runWorkoutEditPreview(libraryRef, undefined, roundTrip, endpointAdapter);
await runWorkoutEditWrite(libraryRef, undefined, roundTrip, endpointAdapter);
assert.deepEqual(calls.map(([name]) => name), ["calculate", "calculate", "program/update"]);
assert.equal(calls[2][1].id, "program-44");
assert.equal(calls[2][1].version, 12);

calls.length = 0;
const scheduledRef = {
  kind: "scheduled",
  happenDay: "20991201",
  planId: "plan-1",
  idInPlan: "91",
  planProgramId: "91"
};
await runWorkoutEditPreview(scheduledRef, entity, roundTrip, endpointAdapter);
await runWorkoutEditWrite(scheduledRef, entity, roundTrip, endpointAdapter);
assert.deepEqual(calls.map(([name]) => name), [
  "program/estimate",
  "calculate",
  "schedule/update"
]);
assert.equal(calls[0][1].entity.unknownEntityField, "preserved");
assert.equal(calls[2][1].versionObjects[0].status, 2);
assert.equal(calls[2][1].programs[0].version, 12);

const failedCalls = [];
await assert.rejects(
  () => runWorkoutEditWrite(libraryRef, undefined, roundTrip, {
    ...endpointAdapter,
    calculate: async () => {
      failedCalls.push("calculate");
      throw new Error("calculation unavailable");
    },
    updateLibrary: async () => failedCalls.push("program/update")
  }),
  /calculation unavailable/
);
assert.deepEqual(failedCalls, ["calculate"]);

await assert.rejects(
  () => runWorkoutEditWrite(libraryRef, undefined, roundTrip, {
    ...endpointAdapter,
    updateLibrary: async () => { throw new Error("write rejected"); }
  }),
  /write rejected/
);

const mismatch = structuredClone(draft);
mismatch.name = "Different name";
assert.equal(workoutDraftsMatch(mismatch, roundTrip), false);

const revision = workoutEditRevision({
  ref: { kind: "library", programId: "program-44" },
  program: source
});
assert.match(revision, /^[a-f0-9]{64}$/);
assert.notEqual(
  revision,
  workoutEditRevision({
    ref: { kind: "library", programId: "program-44" },
    program: { ...source, version: 13 }
  })
);

console.log("COROS workout editor adapter and contract tests passed");
