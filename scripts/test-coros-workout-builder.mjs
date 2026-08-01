import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  applyWorkoutCalculation,
  buildEasyRun,
  buildIntervalWorkout,
  buildWorkoutPayload,
  formatEntryStepsSummary,
  buildRunWorkoutPayload,
  buildPlanPreview,
  metersToCorosDistance,
  parsePace,
  resetProgramForCreate,
  validatePlanDraft
} = await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);

const imperialContext = {
  distanceUnit: "imperial",
  paceUnit: "mi",
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "yd" },
  climbSystems: {}
};

assert.equal(metersToCorosDistance(7000), 700000);

const pace = parsePace("5:00/km");
assert.equal(pace.intensity_type, 3);
assert.equal(pace.intensity_value, 300000);
assert.equal(pace.intensity_value_extend, 300000);
assert.equal(pace.intensity_display_unit, 1);
assert.equal(pace.intensity_multiplier, 1000);

const milePace = parsePace("8:00/mi");
assert.equal(milePace.intensity_value, 298258);
assert.equal(milePace.intensity_display_unit, 2);

const paceRange = parsePace("4:05-4:15/km");
assert.equal(paceRange.intensity_value, 245000);
assert.equal(paceRange.intensity_value_extend, 255000);
assert.equal(paceRange.intensity_display_unit, 1);

const easy = buildEasyRun({ name: "7km Easy", distanceKm: 7 });
assert.equal(easy.name, "7km Easy");
assert.equal(easy.simple, true);
// A distance run must carry ONE real exercise carrying the distance target —
// mirroring the official web app. With exercises: [] COROS zeroes the stored
// program.distance and the calendar reads back Volume "--".
assert.equal(easy.distance, "700000.00");
assert.equal(Array.isArray(easy.exercises), true);
assert.equal(easy.exercises.length, 1);
const easyExercise = easy.exercises[0];
assert.equal(easyExercise.exerciseType, 2);
assert.equal(easyExercise.targetType, 5);
assert.equal(easyExercise.targetValue, 700000);
assert.equal(easyExercise.targetDisplayUnit, 1);
// Program-level target fields are empty strings; the target lives on the exercise.
assert.equal(easy.targetType, "");
assert.equal(easy.targetValue, "");
assert.equal(Array.isArray(easy.exerciseBarChart), true);
assert.equal(easy.exerciseBarChart[0].targetValue, 700000);

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
const intervalWork = intervals.exercises.find(
  (exercise) => exercise.exerciseType === 2 && exercise.targetValue === 40000
);
assert.equal(intervalWork.targetDisplayUnit, 2);
assert.equal(intervalWork.intensityValue, 270000);
assert.equal(intervalWork.intensityDisplayUnit, 1);
assert.equal(intervalWork.intensityMultiplier, 1000);

const imperialRun = buildWorkoutPayload(
  "Imperial run",
  [
    {
      kind: "training",
      target_type: "distance",
      target_distance_meters: 1609.344,
      intensity: {
        type: "pace",
        lowSecondsPerKm: 300,
        highSecondsPerKm: 300,
        displayUnit: "km"
      }
    },
    {
      kind: "training",
      target_type: "elevationGain",
      target_elevation_gain_meters: 100
    }
  ],
  "trailRun",
  undefined,
  imperialContext
);
assert.equal(imperialRun.distanceDisplayUnit, 3);
assert.equal(imperialRun.exercises[0].targetValue, 160934);
assert.equal(imperialRun.exercises[0].targetDisplayUnit, 3);
assert.equal(imperialRun.exercises[0].intensityValue, 300000);
assert.equal(imperialRun.exercises[0].intensityDisplayUnit, 2);
assert.equal(imperialRun.exercises[1].targetValue, 10000);
assert.equal(imperialRun.exercises[1].targetDisplayUnit, 5);

const imperialBike = buildWorkoutPayload(
  "Imperial bike",
  [{
    kind: "training",
    target_type: "time",
    target_duration_seconds: 600,
    intensity: { type: "speed", low: 16.09344, high: 32.18688, unit: "km/h" }
  }],
  "bike",
  undefined,
  imperialContext
);
assert.equal(imperialBike.exercises[0].intensityValue, 1609);
assert.equal(imperialBike.exercises[0].intensityValueExtend, 3219);
assert.equal(imperialBike.exercises[0].intensityDisplayUnit, 5);

const imperialStrength = buildWorkoutPayload(
  "Imperial strength",
  [{
    kind: "training",
    target_type: "reps",
    target_reps: 10,
    exercise_id: "T5067",
    intensity: { type: "weight", mode: "weight", value: 10, unit: "kg" }
  }],
  "strength",
  undefined,
  imperialContext
);
assert.equal(imperialStrength.exercises[0].intensityValue, 10);
assert.equal(imperialStrength.exercises[0].intensityDisplayUnit, 7);

const imperialSwim = buildWorkoutPayload(
  "Imperial swim",
  [{
    kind: "training",
    target_type: "distance",
    target_distance_meters: 91.44,
    intensity: { type: "swimStroke", stroke: "freestyle" }
  }],
  "swim",
  undefined,
  imperialContext
);
assert.equal(imperialSwim.poolLength, 2286);
assert.equal(imperialSwim.poolLengthUnit, 4);
assert.equal(imperialSwim.distanceDisplayUnit, 4);
assert.equal(imperialSwim.exercises[0].targetValue, 9144);
assert.equal(imperialSwim.exercises[0].targetDisplayUnit, 4);

assert.equal(
  formatEntryStepsSummary({
    key: "imperial-summary",
    name: "Imperial summary",
    sport: "run",
    steps: [{
      kind: "training",
      target_type: "distance",
      target_distance_meters: 1609.344,
      intensity: {
        type: "pace",
        lowSecondsPerKm: 300,
        highSecondsPerKm: 310,
        displayUnit: "km"
      }
    }]
  }, "imperial"),
  "training 1.00 mi @ 8:03–8:19/mi"
);
assert.equal(
  formatEntryStepsSummary({
    key: "imperial-bike-summary",
    name: "Imperial bike summary",
    sport: "bike",
    steps: [{
      kind: "training",
      target_type: "time",
      target_duration_seconds: 600,
      intensity: {
        type: "speed",
        low: 16.09344,
        high: 32.18688,
        unit: "km/h"
      }
    }]
  }, "imperial"),
  "training 10 min @ 10–20 mph"
);
assert.equal(
  formatEntryStepsSummary({
    key: "imperial-strength-summary",
    name: "Imperial strength summary",
    sport: "strength",
    steps: [{
      kind: "training",
      target_type: "reps",
      target_reps: 10,
      exercise_id: "T5067",
      intensity: { type: "weight", mode: "weight", value: 10, unit: "kg" }
    }]
  }, "imperial"),
  "training 10 reps @ 22 lb"
);

const payload = buildRunWorkoutPayload("Tempo 5k", [
  {
    kind: "training",
    target_type: "distance",
    target_distance_meters: 5000
  }
]);
assert.equal(payload.estimatedDistance, 500000);
assert.equal(payload.distanceDisplayUnit, 1);
assert.equal(payload.exercises[0].targetDisplayUnit, 2);

// Load target (COROS targetType 6): raw integer, no unit scaling.
const loadPayload = buildRunWorkoutPayload("Load Block", [
  { kind: "training", target_type: "load", target_load: 45 }
]);
const loadExercise = loadPayload.exercises[0];
assert.equal(loadExercise.targetType, 6);
assert.equal(loadExercise.targetValue, 45);
// A load step contributes no distance/time to the estimate.
assert.equal(loadPayload.estimatedDistance, 0);
assert.equal(loadPayload.estimatedTime, 0);

// Open / manual-end target (COROS targetType 1): run until lap, no value.
const openPayload = buildRunWorkoutPayload("Open Warmup", [
  { kind: "warmup", target_type: "open" }
]);
const openExercise = openPayload.exercises[0];
assert.equal(openExercise.targetType, 1);
assert.equal(openExercise.targetValue, 0);

const recoveryPayload = buildRunWorkoutPayload("HR Recovery", [
  {
    kind: "rest",
    target_type: "hrRecovery",
    target_hr_recovery_bpm: 118
  }
]);
assert.equal(recoveryPayload.exercises[0].targetType, 7);
assert.equal(recoveryPayload.exercises[0].targetValue, 118);
assert.throws(
  () => buildRunWorkoutPayload("Invalid HR Recovery", [
    {
      kind: "training",
      target_type: "hrRecovery",
      target_hr_recovery_bpm: 118
    }
  ]),
  /only supported on Rest/
);

const calculated = applyWorkoutCalculation(payload, {
  planDistance: "500000.00",
  planDuration: 1500,
  planTrainingLoad: 42,
  planSets: 1,
  planPitch: 0,
  distanceDisplayUnit: 1,
  exerciseBarChart: [{ exerciseId: "1", targetValue: 500000 }]
});
assert.equal(calculated.distance, "500000.00");
assert.equal(calculated.duration, 1500);
assert.equal(calculated.trainingLoad, 42);
assert.equal(calculated.sets, 1);
assert.equal(calculated.totalSets, 1);
assert.equal(calculated.distanceDisplayUnit, 1);
assert.equal(calculated.exerciseBarChart[0].targetValue, 500000);

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

const invalidDestination = validatePlanDraft({
  name: "No-op plan",
  workouts: [
    {
      key: "no-op",
      name: "Nowhere",
      distance_km: 5,
      save_to_library: false
    }
  ]
});
assert.equal(invalidDestination.ok, false);
assert.match(invalidDestination.errors.join(" "), /scheduled or saved/);

const invalidDate = validatePlanDraft({
  name: "Bad date",
  workouts: [
    {
      key: "bad-date",
      name: "Impossible day",
      distance_km: 5,
      schedule_date: "20990231"
    }
  ]
});
assert.equal(invalidDate.ok, false);
assert.match(invalidDate.errors.join(" "), /valid YYYYMMDD/);

const invalidRepeat = validatePlanDraft({
  name: "Bad repeat",
  workouts: [
    {
      key: "bad-repeat",
      name: "Zero repeats",
      steps: [
        {
          repeat: 0,
          steps: [
            {
              kind: "training",
              target_type: "distance",
              target_distance_meters: 400
            }
          ]
        }
      ]
    }
  ]
});
assert.equal(invalidRepeat.ok, false);
assert.match(invalidRepeat.errors.join(" "), /repeat between 1 and 99/);

assert.throws(() => parsePace("4:70/km"), /Could not parse pace/);

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
assert.ok(preview.entries[0]?.source);

const imperialPreview = buildPlanPreview("draft-imperial", {
  name: "Imperial Week",
  workouts: [
    {
      key: "five-mile-run",
      name: "Five mile run",
      distance_km: 8.04672,
      schedule_date: "20991201"
    },
    {
      key: "hundred-yard-swim",
      name: "Hundred yard swim",
      sport: "swim",
      steps: [{
        kind: "training",
        target_type: "distance",
        target_distance_meters: 91.44
      }],
      schedule_date: "20991202"
    }
  ]
}, { unitSystem: "imperial" });
assert.equal(imperialPreview.entries[0]?.volume, "5.00 mi");
assert.equal(imperialPreview.entries[1]?.volume, "100 yd");
assert.ok(imperialPreview.entries.every((entry) => entry.source));

const strengthPreview = buildPlanPreview("draft-strength", {
  name: "Push plan",
  workouts: [{
    key: "push",
    name: "Push day",
    sport: "strength",
    steps: [{
      kind: "training",
      exercise_id: "bench-press",
      exercise_name: "Bench Press",
      target_type: "reps",
      target_reps: 8,
      sets: 4,
      rest_type: 1,
      rest_value: 90,
      intensity: { type: "weight", mode: "weight", value: 70, unit: "kg" }
    }]
  }]
});
assert.equal(strengthPreview.entries[0]?.volume, "4 sets");
assert.equal(
  strengthPreview.entries[0]?.stepsSummary,
  "Bench Press 4 × 8 reps @ 70 kg (90 sec rest)"
);

const reset = resetProgramForCreate({
  id: "old",
  idInPlan: "99",
  name: "Test",
  exercises: [{ id: 5, groupId: "0" }]
});
assert.equal(reset.id, "0");
assert.equal((reset.exercises)[0]?.id, "1");

console.log("coros workout builder tests passed");
