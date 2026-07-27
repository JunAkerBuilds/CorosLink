import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildPlanPreview,
  buildWorkoutPayload,
  formatEntryStepsSummary,
  validatePlanDraft
} = await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);
const { buildDraftTrainingPlanInputSchema } = await import(
  `${distUrl("workoutCapabilities.js")}?cacheBust=${Date.now()}`
);

const draft = {
  name: "Test Week",
  workouts: [
    {
      key: "intervals",
      name: "400 Repeats",
      schedule_date: "20991201",
      steps: [
        {
          repeat: 6,
          steps: [
            {
              kind: "training",
              target_type: "distance",
              target_distance_meters: 400,
              pace: "4:30/km"
            },
            {
              kind: "rest",
              target_type: "time",
              target_duration_seconds: 90
            }
          ]
        }
      ]
    }
  ]
};

const validation = validatePlanDraft(draft, { todayDay: "20260101" });
assert.equal(validation.ok, true);

const stepsSummary = formatEntryStepsSummary(draft.workouts[0]);
assert.match(stepsSummary ?? "", /6x/);

const preview = buildPlanPreview("draft-test-1", draft);
assert.equal(preview.entries[0]?.sport, "run");
assert.equal(preview.entries[0]?.stepsSummary, stepsSummary);
assert.match(preview.entries[0]?.stepsSummary ?? "", /training/);

const schema = buildDraftTrainingPlanInputSchema();
const sportSchemas = schema.properties.workouts.items.oneOf;
assert.equal(sportSchemas.length, 9);
assert.deepEqual(
  new Set(sportSchemas.map((item) => item.properties.sport.const)),
  new Set(["run", "trailRun", "bike", "swim", "strength", "xcSki", "indoorClimb", "bouldering", "hyrox"])
);

// Representative typed result for: “Create a 5 km run at 135–145 bpm.”
const heartRateDraft = {
  name: "Heart Rate Plan",
  workouts: [
    {
      key: "steady-hr",
      name: "5 km at 135–145 bpm",
      sport: "run",
      steps: [
        {
          kind: "training",
          target_type: "distance",
          target_distance_meters: 5_000,
          intensity: { type: "heartRate", lowBpm: 135, highBpm: 145 }
        }
      ]
    }
  ]
};
assert.equal(validatePlanDraft(heartRateDraft, { todayDay: "20260101" }).ok, true);
const heartRatePreview = buildPlanPreview("draft-test-hr", heartRateDraft);
assert.equal(heartRatePreview.entries[0]?.sport, "run");
assert.match(heartRatePreview.entries[0]?.stepsSummary ?? "", /135–145 bpm/);
const heartRatePayload = buildWorkoutPayload(
  heartRateDraft.workouts[0].name,
  heartRateDraft.workouts[0].steps,
  "run"
);
assert.equal(heartRatePayload.exercises[0].intensityType, 2);
assert.equal(heartRatePayload.exercises[0].hrType, 2);
assert.equal(heartRatePayload.exercises[0].isIntensityPercent, false);
assert.equal(heartRatePayload.exercises[0].intensityCustom, 0);
assert.equal(heartRatePayload.exercises[0].intensityValue, 135);
assert.equal(heartRatePayload.exercises[0].intensityValueExtend, 145);

console.log("test-chat-workout-tools: ok");
