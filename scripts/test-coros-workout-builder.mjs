import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildEasyRun,
  buildIntervalWorkout,
  buildRunWorkoutPayload,
  buildPlanPreview,
  metersToCorosDistance,
  parsePace,
  resetProgramForCreate,
  validatePlanDraft
} = await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);

assert.equal(metersToCorosDistance(7000), 700000);

const pace = parsePace("5:00/km");
assert.equal(pace.intensity_type, 3);
assert.equal(pace.intensity_value, 300);
assert.equal(pace.intensity_display_unit, 2);

const easy = buildEasyRun({ name: "7km Easy", distanceKm: 7 });
assert.equal(easy.name, "7km Easy");
assert.equal(easy.distance, 700000);
assert.equal(easy.simple, true);

const intervals = buildIntervalWorkout({
  name: "Rolling 400s",
  warmup: {
    kind: "warmup",
    target_type: "distance",
    target_distance_meters: 2000
  },
  repeats: 6,
  work: {
    kind: "training",
    target_type: "distance",
    target_distance_meters: 400,
    pace: "4:30/km"
  },
  rest: {
    kind: "rest",
    target_type: "time",
    target_duration_seconds: 90
  },
  cooldown: {
    kind: "cooldown",
    target_type: "distance",
    target_distance_meters: 1500
  }
});
assert.equal(intervals.name, "Rolling 400s");
assert.equal(intervals.sportType, 1);
assert.ok(Array.isArray(intervals.exercises));
assert.ok((intervals.exercises).length > 2);

const payload = buildRunWorkoutPayload("Tempo 5k", [
  {
    kind: "training",
    target_type: "distance",
    target_distance_meters: 5000
  }
]);
assert.equal(payload.estimatedDistance, 500000);

const valid = validatePlanDraft({
  name: "Test Week",
  workouts: [
    {
      key: "easy-mon",
      name: "Easy Run",
      distance_km: 7,
      schedule_date: "20991201"
    },
    {
      key: "interval-thu",
      name: "Intervals",
      steps: [
        {
          repeat: 4,
          steps: [
            {
              kind: "training",
              target_type: "distance",
              target_distance_meters: 1000
            },
            {
              kind: "rest",
              target_type: "time",
              target_duration_seconds: 120
            }
          ]
        }
      ],
      schedule_date: "20991204"
    }
  ]
});
assert.equal(valid.ok, true);

const invalid = validatePlanDraft({
  name: "",
  workouts: []
});
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.length > 0);

const preview = buildPlanPreview("draft-1", {
  name: "Test Week",
  workouts: [
    {
      key: "easy-mon",
      name: "Easy Run",
      distance_km: 7,
      schedule_date: "20991201"
    }
  ]
});
assert.equal(preview.draftId, "draft-1");
assert.equal(preview.entries.length, 1);
assert.equal(preview.entries[0]?.volume, "7.00 km");

const reset = resetProgramForCreate({
  id: "old",
  idInPlan: "99",
  name: "Test",
  exercises: [{ id: 5, groupId: "0" }]
});
assert.equal(reset.id, "0");
assert.equal((reset.exercises)[0]?.id, "1");

console.log("coros workout builder tests passed");
