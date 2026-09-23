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
const { buildDraftTrainingPlanInputSchema, buildDraftWorkoutInputSchema } = await import(
  `${distUrl("workoutCapabilities.js")}?cacheBust=${Date.now()}`
);
const {
  buildTrainingPlanDestinationInput,
  buildTrainingPlanUploadInput,
  isChatWorkoutTool
} = await import(
  `${distUrl("chatWorkoutTools.js")}?cacheBust=${Date.now()}`
);
const {
  classifyWorkoutExerciseName,
  searchWorkoutExerciseCatalog
} = await import(`${distUrl("exerciseCatalogSearch.js")}?cacheBust=${Date.now()}`);

const strengthCatalog = [
  { originId: "1045", displayName: "Dumbbell Flys" },
  { originId: "1334", displayName: "Lateral Raise Machine" },
  { originId: "1337", displayName: "Shoulder Press Machine" },
  { originId: "1338", displayName: "Chest Press Machine" },
  { originId: "1341", displayName: "Triceps Pushdown Machine" },
  { originId: "1004", displayName: "Push Ups" },
  { originId: "1053", displayName: "Seated Cable Row" }
];

assert.equal(isChatWorkoutTool("search_coros_exercises"), true);
assert.equal(isChatWorkoutTool("draft_workout"), true);

assert.deepEqual(
  classifyWorkoutExerciseName("Chest Press Machine").equipment,
  ["machine"]
);
assert.deepEqual(
  classifyWorkoutExerciseName("Dumbbell Flys").targetMuscles,
  ["chest", "triceps", "shoulders"]
);
assert.equal(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    query: "machine chest press",
    limit: 3
  })[0]?.id,
  "1338"
);
assert.deepEqual(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    targetMuscles: ["chest"],
    equipment: ["machine"]
  }).map((entry) => entry.id),
  ["1338"]
);
assert.ok(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    targetMuscles: ["triceps"],
    equipment: ["machine"]
  }).some((entry) => entry.id === "1341")
);
assert.deepEqual(
  searchWorkoutExerciseCatalog(strengthCatalog, {
    movementPatterns: ["pull"],
    equipment: ["cable"]
  }).map((entry) => entry.id),
  ["1053"]
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

const workoutSchema = buildDraftWorkoutInputSchema();
const workoutSportSchemas = workoutSchema.properties.workout.oneOf;
assert.equal(workoutSportSchemas.length, 9);
assert.equal(workoutSchema.properties.calendar_date.pattern, "^\\d{8}$");
for (const sportSchema of workoutSportSchemas) {
  assert.equal("schedule_date" in sportSchema.properties, false);
  assert.equal("save_to_library" in sportSchema.properties, false);
  assert.equal("sort_no" in sportSchema.properties, false);
}

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
const oneOffPreview = buildPlanPreview("draft-one-off", heartRateDraft, {
  artifactType: "workout"
});
assert.equal(oneOffPreview.artifactType, "workout");
assert.doesNotMatch(oneOffPreview.summary, /none scheduled/);
assert.equal(oneOffPreview.warnings.length, 0);
const oneOffCalendarInput = buildTrainingPlanDestinationInput(
  heartRateDraft,
  "calendar",
  "2099-12-06"
);
assert.equal(oneOffCalendarInput.workouts[0].schedule_date, "20991206");
assert.equal(oneOffCalendarInput.workouts[0].save_to_library, false);
const oneOffLibraryInput = buildTrainingPlanDestinationInput(
  heartRateDraft,
  "workoutLibrary"
);
assert.equal(oneOffLibraryInput.workouts[0].schedule_date, undefined);
assert.equal(oneOffLibraryInput.workouts[0].save_to_library, true);
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

const mixedDraft = {
  name: "Mixed Training Week",
  workouts: [
    {
      key: "easy-run",
      name: "Easy Run",
      sport: "run",
      schedule_date: "20991202",
      steps: [
        {
          kind: "training",
          target_type: "time",
          target_duration_seconds: 2_400,
          intensity: { type: "heartRatePercent", basis: "maxHr", preset: "aerobicEndurance" }
        }
      ]
    },
    {
      key: "bike-threshold",
      name: "Bike Threshold",
      sport: "bike",
      schedule_date: "20991203",
      steps: [
        {
          kind: "training",
          target_type: "time",
          target_duration_seconds: 2_700,
          intensity: { type: "ftpPercent", preset: "threshold" }
        }
      ]
    },
    {
      key: "pool-technique",
      name: "Pool Technique",
      sport: "swim",
      sport_options: { poolLength: { value: 25, unit: "m" } },
      schedule_date: "20991204",
      steps: [
        {
          kind: "training",
          target_type: "distance",
          target_distance_meters: 1_500,
          intensity: { type: "swimStroke", stroke: "freestyle" }
        }
      ]
    },
    {
      key: "strength-session",
      name: "Full Body Strength",
      sport: "strength",
      schedule_date: "20991205",
      steps: [
        {
          kind: "training",
          target_type: "reps",
          target_reps: 10,
          exercise_name: "Squat",
          intensity: { type: "weight", mode: "bodyweight" }
        }
      ]
    }
  ]
};
assert.equal(validatePlanDraft(mixedDraft, { todayDay: "20260101" }).ok, true);
const mixedPreview = buildPlanPreview("draft-mixed", mixedDraft);
assert.equal(mixedPreview.entries.length, 4);
assert.match(mixedPreview.summary, /1 Run \/ 1 Bike \/ 1 Pool Swim \/ 1 Strength/);
assert.deepEqual(
  mixedPreview.entries.map((entry) => entry.sport),
  ["run", "bike", "swim", "strength"]
);
assert.deepEqual(
  mixedDraft.workouts.map((entry) =>
    buildWorkoutPayload(entry.name, entry.steps, entry.sport, entry.sport_options).sportType
  ),
  [1, 2, 3, 4]
);
const mixedUploadInput = buildTrainingPlanUploadInput(mixedDraft);
assert.deepEqual(
  mixedUploadInput.workouts.map((entry) => entry.sport),
  ["run", "bike", "swim", "strength"]
);
assert.deepEqual(mixedUploadInput.workouts[2].sport_options, {
  poolLength: { value: 25, unit: "m" }
});
assert.equal(mixedUploadInput.workouts[3].steps[0].target_type, "reps");

console.log("test-chat-workout-tools: ok");

// Strength aliases must resolve real catalog references before payload creation.
const { resolveTrainingPlanExercises } = await import(distUrl("trainingHubService.js"));
const { workoutExerciseId } = await import(distUrl("workoutCapabilities.js"));
assert.equal(workoutExerciseId({ originId: "0", id: "T123" }), "T123");
assert.equal(workoutExerciseId({ originId: 0, exerciseId: " T124 " }), "T124");
assert.equal(workoutExerciseId({ originId: "0", id: "0" }), undefined);
for (const kind of ["training", "interval", "train", " Training ", undefined]) {
  const draft = { name: "Strength regression", workouts: [{
    key: "strength", name: "Strength", sport: "strength", steps: [{
      kind, exercise_name: "Squat", target_type: "reps", target_reps: 10
    }, { repeat: 3, steps: [{ kind, exercise_name: "Squat", target_type: "reps", target_reps: 8 }] }]
  }] };
  let calls = 0;
  const resolved = await resolveTrainingPlanExercises(draft, async () => {
    calls++;
    return [{ id: "T123", originId: "0", name: "Squat" }];
  });
  assert.equal(calls, 1);
  assert.deepEqual(resolved.issues, []);
  assert.equal(draft.workouts[0].steps[0].exercise_id, undefined);
  const payload = buildWorkoutPayload("Strength", resolved.draft.workouts[0].steps, "strength");
  assert.deepEqual(payload.exercises.filter(x => !x.isGroup).map(x => x.originId), ["T123", "T123"]);
  for (const badReference of [{}, { exercise_id: "0" }, { exercise_name: "Unknown" }]) {
    const invalid = structuredClone(draft);
    invalid.workouts[0].steps = [{ kind, target_type: "reps", target_reps: 10, ...badReference }];
    const result = await resolveTrainingPlanExercises(invalid, async () => [{ id: "T123", name: "Squat" }]);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].reason, badReference.exercise_name ? "unavailable" : "missing");
    if (!badReference.exercise_name) {
      assert.match(result.issues[0].message, /require exercise_id or exercise_name/);
      assert.equal(result.issues[0].exerciseName, "");
    }
  }
}
assert.throws(() => buildWorkoutPayload("Strength", [{ kind: "interval", target_type: "reps", target_reps: 10 }], "strength"), /require exercise/);
const restOnly = await resolveTrainingPlanExercises({ name: "Rest", workouts: [{ key: "r", name: "Rest", sport: "strength", steps: [{ kind: "rest", target_type: "time", target_duration_seconds: 60 }] }] }, async () => { throw new Error("Rest must not query catalog"); });
assert.deepEqual(restOnly.issues, []);
const missingExercise = await resolveTrainingPlanExercises({ name: "Missing", workouts: [{ key: "m", name: "Strength", sport: "strength", steps: [{ kind: "training", target_type: "reps", target_reps: 10 }] }] }, async () => { throw new Error("Missing exercises must not query the catalog"); });
assert.equal(missingExercise.issues[0].reason, "missing");
console.log("Strength exercise resolution regression tests passed");

// Existing Strength edits use the local review service and respect Coach workout permissions.
const { handleChatWorkoutTool } = await import(distUrl("chatWorkoutTools.js"));
for (const name of ["find_editable_workouts", "read_workout_for_edit", "prepare_workout_edit", "prepare_exercise_load_update", "get_workout_edit_status", "cancel_workout_edit"]) {
  assert.equal(isChatWorkoutTool(name), true);
  const denied = JSON.parse(await handleChatWorkoutTool(name, {}, { allowUpcomingWorkouts: false }));
  assert.match(denied.error, /disabled/);
}
assert.equal(isChatWorkoutTool("confirm_workout_edit"), false);
console.log("Strength Coach tools: six review-only tools registered and permission-gated.");
