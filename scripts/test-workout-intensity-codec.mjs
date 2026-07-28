import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const load = (name) => import(`${pathToFileURL(path.join(root, "dist-electron", name)).href}?${Date.now()}`);
const codec = await load("workoutCapabilities.js");
const builder = await load("corosWorkoutBuilder.js");
const editor = await load("corosWorkoutEditor.js");

const context = editor.parseWorkoutEditorContext({
  unit: 0,
  maxHr: 190,
  restingHr: 50,
  lthr: 175,
  thresholdPace: 240_000,
  ftp: 300,
  criticalPower: 350,
  poolLength: 2500,
  poolLengthUnit: 2
});

assert.equal(codec.decodeCorosPercent(91_000), 91);
assert.equal(codec.decodeCorosPercent(91), 91, "legacy unscaled percentages remain readable");
assert.equal(codec.encodeCorosPercent(91), 91_000);
assert.equal(context.maxHr, 190);
assert.equal(context.restingHr, 50);
assert.equal(context.lthrBpm, 175);
assert.equal(context.thresholdPaceSecondsPerKm, 240);
assert.equal(context.ftp, 300);
assert.equal(context.criticalPower, 350);
assert.deepEqual(context.defaultPoolLength, { value: 25, unit: "m" });
const yardContext = editor.parseWorkoutEditorContext(
  { poolLength: 2286, poolLengthUnit: 4 },
  "imperial"
);
assert.equal(Number(yardContext.defaultPoolLength.value.toFixed(2)), 25);
assert.equal(yardContext.defaultPoolLength.unit, "yd");
const imperialContext = editor.parseWorkoutEditorContext(
  { unit: 1, thresholdPace: 300_000 },
  "imperial"
);
assert.equal(imperialContext.distanceUnit, "imperial");
assert.equal(imperialContext.paceUnit, "mi");
assert.equal(imperialContext.thresholdPaceSecondsPerKm, 300);
const climbContext = editor.parseWorkoutEditorContext({
  climbConfig: [
    { sportType: 6, gradingSystem: 2 },
    { sportType: 7, gradingSystem: 8 }
  ]
});
assert.deepEqual(climbContext.climbSystems, { indoorClimb: "french", bouldering: "font" });
const customZoneContext = editor.parseWorkoutEditorContext({
  maxHr: 190,
  maxHrZone: [{ type: 2, label: "My Endurance", lowPercent: 65, highPercent: 72 }]
});
const customZone = codec.encodeCorosIntensity(
  { type: "heartRatePercent", basis: "maxHr", preset: "fatBurn" },
  customZoneContext
);
assert.equal(customZone.intensityCustom, 2);
assert.equal(customZone.intensityPercent, 65_000);
assert.equal(customZone.intensityPercentExtend, 72_000);
assert.equal(customZone.intensityValue, 124);
assert.equal(customZone.intensityValueExtend, 137);
const missingReference = codec.encodeCorosIntensity(
  { type: "ftpPercent", lowPercent: 90, highPercent: 100 },
  editor.parseWorkoutEditorContext({})
);
assert.equal(missingReference.intensityPercent, 90_000);
assert.equal(missingReference.intensityValue, 0);
assert.equal(context.zones.maxHr.length, 6);
assert.equal(context.zones.ftp.length, 7);
assert.deepEqual(
  Object.fromEntries(codec.WORKOUT_SPORTS.map((sport) => [sport, codec.WORKOUT_SPORT_CAPABILITIES[sport].pbVersion])),
  { run: 2, bike: 2, swim: 2, strength: 2, trailRun: 4, indoorClimb: 7, bouldering: 7, xcSki: 9, hyrox: 9 }
);

const exerciseMedia = codec.workoutExerciseMedia({
  thumbnailUrl: "https://s3.coros.com/source/exercise_img/0/cover-one.png",
  coverUrlArrStr: "https://s3.coros.com/source/exercise_img/0/cover-one.png,https://s3.coros.com/source/exercise_img/0/cover-two.png",
  videoUrlArrStr: "https://s3.coros.com/source/exercise_gif/0/video-one.mp4,https://s3.coros.com/source/exercise_gif/0/video-two.mp4",
  videoInfos: [{
    coverUrl: "https://s3.coros.com/source/exercise_img/0/cover-one.png",
    videoUrl: "https://s3.coros.com/source/exercise_gif/0/video-one.mp4"
  }]
});
assert.deepEqual(exerciseMedia, [
  {
    coverUrl: "https://s3.coros.com/source/exercise_img/0/cover-one.png",
    videoUrl: "https://s3.coros.com/source/exercise_gif/0/video-one.mp4"
  },
  {
    coverUrl: "https://s3.coros.com/source/exercise_img/0/cover-two.png",
    videoUrl: "https://s3.coros.com/source/exercise_gif/0/video-two.mp4"
  }
]);
assert.deepEqual(codec.workoutExerciseMedia({
  thumbnailUrl: "https://example.test/not-coros.png",
  videoUrlArrStr: "javascript:alert(1)"
}), []);

const cases = [
  [{ type: "none" }, 0],
  [{ type: "heartRate", lowBpm: 135, highBpm: 145 }, 2],
  [{ type: "heartRatePercent", basis: "maxHr", preset: "fatBurn" }, 2],
  [{ type: "heartRatePercent", basis: "reserve", preset: "recovery" }, 2],
  [{ type: "heartRatePercent", basis: "lthr", lowPercent: 91, highPercent: 95 }, 2],
  [{ type: "pace", lowSecondsPerKm: 240, highSecondsPerKm: 260, displayUnit: "km" }, 3],
  [{ type: "effortPace", lowSecondsPerKm: 250, highSecondsPerKm: 270, displayUnit: "mi" }, 8],
  [{ type: "thresholdPacePercent", preset: "threshold" }, 3],
  [{ type: "effortPacePercent", lowPercent: 90, highPercent: 100 }, 8],
  [{ type: "ftpPercent", preset: "anaerobicPower" }, 9],
  [{ type: "power", lowWatts: 220, highWatts: 260 }, 6],
  [{ type: "power", preset: "interval" }, 6],
  [{ type: "speed", low: 10, high: 12, unit: "mph" }, 4],
  [{ type: "cadence", low: 80, high: 95, unit: "rpm" }, 7],
  [{ type: "swimStroke", stroke: "individualMedley" }, 5],
  [{ type: "weight", mode: "bodyweight" }, 1],
  [{ type: "weight", mode: "weight", value: 45, unit: "lb" }, 1],
  [{ type: "rpe", value: 8 }, 11],
  [{ type: "climbGrade", system: "french", relativeToOnsight: -2 }, 10],
  [{ type: "climbGrade", system: "vScale", absoluteGrade: "V6" }, 10]
];

for (const [intensity, intensityType] of cases) {
  const encoded = codec.encodeCorosIntensity(intensity, context);
  assert.equal(encoded.intensityType, intensityType, intensity.type);
  const decoded = codec.decodeCorosIntensity(encoded, context);
  assert.equal(decoded.reason, undefined, intensity.type);
  assert.equal(decoded.intensity.type, intensity.type, `${intensity.type} should round-trip`);
}

for (const [stroke, id] of Object.entries(codec.SWIM_STROKE_IDS)) {
  const encoded = codec.encodeCorosIntensity({ type: "swimStroke", stroke }, context);
  assert.equal(encoded.intensityValue, id, stroke);
  assert.equal(codec.decodeCorosIntensity(encoded).intensity.stroke, stroke);
}
for (const [system, id] of Object.entries(codec.CLIMB_SYSTEM_IDS)) {
  const encoded = codec.encodeCorosIntensity({ type: "climbGrade", system, relativeToOnsight: 0 });
  assert.equal(encoded.gradeSystem, id, system);
}
const metricSpeed = codec.encodeCorosIntensity({ type: "speed", low: 8, high: 12, unit: "km/h" });
assert.equal(metricSpeed.intensityValue, 800);
assert.equal(metricSpeed.intensityValueExtend, 1200);
assert.deepEqual(codec.decodeCorosIntensity(metricSpeed).intensity, { type: "speed", low: 8, high: 12, unit: "km/h" });
const yardSwim = builder.buildWorkoutPayload("yard pool", [{ kind: "training", target_type: "distance", target_distance_meters: 100, intensity: { type: "swimStroke", stroke: "freestyle" } }], "swim", { poolLength: { value: 25, unit: "yd" } });
assert.equal(yardSwim.poolLength, 2286);
assert.equal(yardSwim.poolLengthUnit, 4);
assert.equal(builder.buildWorkoutPayload("effort", [{ kind: "training", target_type: "time", target_duration_seconds: 60, intensity: { type: "effortPace", lowSecondsPerKm: 300, highSecondsPerKm: 320, displayUnit: "km" } }], "run").pbVersion, 3);
assert.equal(builder.buildWorkoutPayload("ftp", [{ kind: "training", target_type: "time", target_duration_seconds: 60, intensity: { type: "ftpPercent", preset: "threshold" } }], "bike").pbVersion, 6);
assert.equal(builder.buildWorkoutPayload("send off", [{ kind: "sendOff", target_type: "distance", target_distance_meters: 100, send_off_seconds: 120, intensity: { type: "swimStroke", stroke: "drills" } }], "swim").pbVersion, 8);

assert.deepEqual(
  ["recovery", "warmUp", "fatBurn", "aerobicEndurance", "threshold", "anaerobic"].map(
    (preset) => codec.encodeCorosIntensity({ type: "heartRatePercent", basis: "maxHr", preset }, context).intensityCustom
  ),
  [6, 1, 2, 3, 4, 5]
);
assert.equal(codec.encodeCorosIntensity({ type: "thresholdPacePercent", preset: "recovery" }, context).intensityCustom, 7);
assert.equal(codec.encodeCorosIntensity({ type: "effortPacePercent", preset: "anaerobicEndurance" }, context).intensityCustom, 5);
assert.deepEqual(
  codec.FTP_PRESETS.map(({ preset }) => codec.encodeCorosIntensity({ type: "ftpPercent", preset }, context).intensityCustom),
  [1, 2, 3, 4, 5, 6, 7]
);

// Issue #72: absolute bpm must not be serialized as % Max Heart Rate.
const issue72 = builder.buildWorkoutPayload("5 km HR", [{
  kind: "training",
  target_type: "distance",
  target_distance_meters: 5_000,
  intensity: { type: "heartRate", lowBpm: 135, highBpm: 145 }
}], "run", undefined, context);
const issue72Step = issue72.exercises[0];
assert.equal(issue72Step.targetType, 5);
assert.equal(issue72Step.targetValue, 500_000);
assert.equal(issue72Step.intensityType, 2);
assert.equal(issue72Step.hrType, 2);
assert.equal(issue72Step.isIntensityPercent, false);
assert.equal(issue72Step.intensityCustom, 0);
assert.equal(issue72Step.intensityValue, 135);
assert.equal(issue72Step.intensityValueExtend, 145);
const issue72Draft = editor.corosProgramToWorkoutDraft(issue72);
assert.deepEqual(issue72Draft.nodes[0].intensity, { type: "heartRate", lowBpm: 135, highBpm: 145 });

const sportFixtures = [
  ["run", { target_type: "time", target_duration_seconds: 600, intensity: { type: "pace", lowSecondsPerKm: 300, highSecondsPerKm: 320, displayUnit: "km" } }],
  ["trailRun", { target_type: "elevationGain", target_elevation_gain_meters: 500, intensity: { type: "effortPacePercent", preset: "aerobicEndurance" } }],
  ["bike", { target_type: "time", target_duration_seconds: 600, intensity: { type: "ftpPercent", preset: "threshold" } }],
  ["swim", { target_type: "distance", target_distance_meters: 100, intensity: { type: "swimStroke", stroke: "mix" } }],
  ["strength", { target_type: "reps", target_reps: 12, exercise_id: "T5067", intensity: { type: "weight", mode: "weight", value: 20, unit: "kg" } }],
  ["xcSki", { target_type: "distance", target_distance_meters: 1_000, intensity: { type: "speed", low: 15, high: 20, unit: "km/h" } }],
  ["indoorClimb", { target_type: "routes", target_routes: 4, intensity: { type: "climbGrade", system: "yds", relativeToOnsight: 0 } }],
  ["bouldering", { target_type: "routes", target_routes: 6, intensity: { type: "climbGrade", system: "vScale", absoluteGrade: "V5" } }],
  ["hyrox", { target_type: "reps", target_reps: 20, exercise_id: "sled-push", exercise_kind: 4, intensity: { type: "weight", mode: "weight", value: 75, unit: "kg" } }]
];
for (const [sport, values] of sportFixtures) {
  const program = builder.buildWorkoutPayload(`${sport} fixture`, [{ kind: "training", ...values }], sport, undefined, context);
  assert.equal(program.sportType, codec.WORKOUT_SPORT_CAPABILITIES[sport].sportType);
  assert.ok(program.pbVersion >= codec.WORKOUT_SPORT_CAPABILITIES[sport].pbVersion);
  const draft = editor.corosProgramToWorkoutDraft(program);
  assert.equal(draft.sport, sport);
  const written = editor.workoutDraftToCorosProgram(program, draft, context);
  assert.equal(written.sportType, program.sportType);
  assert.equal(editor.workoutDraftsMatch(draft, written), true, sport);
  if (sport === "hyrox") {
    assert.equal(program.exercises[0].subType, 2);
    assert.equal(program.exercises[0].hyroxTrainingMode, "strength");
  }
}

const strengthSetPayload = builder.buildWorkoutPayload(
  "Strength set details",
  [{
    kind: "training",
    target_type: "time",
    target_duration_seconds: 30,
    exercise_id: "T5067",
    sets: 4,
    rest_type: 1,
    rest_value: 60,
    intensity: { type: "weight", mode: "bodyweight" }
  }],
  "strength",
  undefined,
  context,
  "Explosive running drills"
);
assert.equal(strengthSetPayload.overview, "Explosive running drills");
assert.equal(strengthSetPayload.exercises[0].sets, 4);
assert.equal(strengthSetPayload.exercises[0].restType, 1);
assert.equal(strengthSetPayload.exercises[0].restValue, 60);
assert.equal(strengthSetPayload.exercises[0].targetValue, 30);

assert.throws(() => builder.buildWorkoutPayload("bad ftp", [{ kind: "training", target_type: "time", target_duration_seconds: 60, intensity: { type: "ftpPercent", preset: "threshold" } }], "run"), /does not support/);
assert.throws(() => builder.buildWorkoutPayload("bad stroke", [{ kind: "training", target_type: "time", target_duration_seconds: 60, intensity: { type: "swimStroke", stroke: "freestyle" } }], "bike"), /does not support/);
assert.throws(() => builder.buildWorkoutPayload("bad recovery", [{ kind: "training", target_type: "hrRecovery", target_hr_recovery_bpm: 120, intensity: { type: "none" } }], "run"), /Rest/);
assert.throws(() => builder.buildWorkoutPayload("bad hyrox function", [{ kind: "training", target_type: "reps", target_reps: 10, exercise_id: "sled", exercise_kind: 4, intensity: { type: "pace", lowSecondsPerKm: 300, highSecondsPerKm: 320, displayUnit: "km" } }], "hyrox"), /does not support/);
assert.throws(() => builder.buildWorkoutPayload("duplicate", [{ kind: "training", target_type: "time", target_duration_seconds: 60, pace: "5:00\/km", intensity: { type: "heartRate", lowBpm: 130, highBpm: 140 } }], "run"), /both typed intensity and legacy/);

const schema = codec.buildDraftTrainingPlanInputSchema();
const workoutSchemas = schema.properties.workouts.items.oneOf;
assert.deepEqual(
  workoutSchemas.map((workout) => workout.properties.sport.const).sort(),
  [...codec.WORKOUT_SPORTS].sort()
);
const bikeSchema = workoutSchemas.find((workout) => workout.properties.sport.const === "bike");
const bikeStepSchema = bikeSchema.properties.steps.items.oneOf[0];
assert.match(JSON.stringify(bikeStepSchema.properties.intensity), /ftpPercent/);
assert.doesNotMatch(JSON.stringify(bikeStepSchema.properties.intensity), /swimStroke/);
assert.ok(JSON.stringify(schema).includes("heartRatePercent"));
assert.ok(JSON.stringify(schema).includes("climbGrade"));

assert.throws(
  () => builder.buildWorkoutPayload("bad options", [{ kind: "training", target_type: "time", target_duration_seconds: 60, intensity: { type: "none" } }], "run", { poolLength: { value: 25, unit: "m" } }),
  /only supported for Pool Swim/
);
assert.equal(
  codec.validateWorkoutIntensity("indoorClimb", { type: "climbGrade", system: "unknown", absoluteGrade: "V1" }),
  "Unsupported climbing grading system."
);
const exerciseCatalog = [
  { originId: "1", displayName: "Back Squat" },
  { originId: "2", displayName: "Front Squat" },
  { originId: "3", displayName: "Deadlift" }
];
assert.equal(codec.resolveWorkoutExerciseName(exerciseCatalog, "Deadlift").match.originId, "3");
assert.deepEqual(
  codec.resolveWorkoutExerciseName(exerciseCatalog, "squat").candidates,
  ["Back Squat", "Front Squat"]
);
const pulldownCatalog = [
  { originId: "1052", displayName: "Seated Lat Pulldowns" },
  { originId: "1342", displayName: "Lat Pulldowns" },
  { originId: "1350", displayName: "Single Arm Lat Pulldown" }
];
assert.equal(
  codec.resolveWorkoutExerciseName(pulldownCatalog, "Lat Pulldown").match.originId,
  "1342"
);
assert.equal(
  codec.resolveWorkoutExerciseName(pulldownCatalog, "Lat Pull Downs").match.originId,
  "1342"
);
assert.equal(
  codec.workoutExerciseName({ name: "T1024", overview: "sid_exercise_preacher_curls" }),
  "Preacher Curls"
);
assert.equal(
  codec.workoutExerciseName({ name: "My custom carry" }),
  "My custom carry"
);
assert.equal(
  codec.resolveWorkoutExerciseName(
    [{ originId: "1024", name: "T1024", overview: "sid_exercise_preacher_curls" }],
    "Preacher Curls"
  ).match.originId,
  "1024"
);

console.log("sport-aware COROS intensity codec tests passed");
