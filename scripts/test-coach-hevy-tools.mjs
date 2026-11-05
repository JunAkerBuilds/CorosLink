import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The Coach's Hevy tools against the compiled dist-electron build, with Hevy's
// API faked through the tools' dependency object.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(`${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`);

const {
  CHAT_HEVY_TOOL_NAMES,
  buildHevyToolGuide,
  claudeCanUseHevyTool,
  describeHevySet,
  getChatHevyTools,
  handleChatHevyTool,
  isChatHevyTool,
  summarizeHevySets
} = await load("chatHevyTools.js");

// ----- Definitions, switches, guide -----
assert.deepEqual(getChatHevyTools({ connected: false }), [], "no Hevy tools without a connection");
const tools = getChatHevyTools({ connected: true });
assert.deepEqual(tools.map((tool) => tool.name), [...CHAT_HEVY_TOOL_NAMES]);
assert.ok(tools.every((tool) => isChatHevyTool(tool.name) && tool.description.length > 40));
assert.equal(isChatHevyTool("hevy__get_routines"), false, "the community MCP server's tools stay MCP tools");
const none = { recentActivities: false, upcomingWorkouts: false, trainingMetrics: false };
assert.equal(claudeCanUseHevyTool("hevy_save_routine", { ...none, recentActivities: true }), false);
assert.equal(claudeCanUseHevyTool("hevy_save_routine", { ...none, upcomingWorkouts: true }), true);
assert.equal(claudeCanUseHevyTool("hevy_get_body_measurements", { ...none, trainingMetrics: true }), true);
assert.equal(claudeCanUseHevyTool("hevy_list_workouts", { ...none, recentActivities: true }), true);
const guide = buildHevyToolGuide(CHAT_HEVY_TOOL_NAMES);
for (const pattern of [/exercise library/, /routines are reusable/, /Save to Hevy/, /replaces it/, /draft_workout/, /can't log, edit or delete workouts/]) {
  assert.match(guide, pattern);
}
assert.doesNotMatch(buildHevyToolGuide(["hevy_list_routines"]), /Save to Hevy/, "write rules only when writes are offered");
assert.equal(buildHevyToolGuide(["get_strength_history"]), "");

// ----- Set text -----
assert.equal(describeHevySet({ type: "normal", weight_kg: 80, reps: 8 }, "metric"), "80 kg × 8");
assert.equal(describeHevySet({ type: "warmup", weight_kg: 40, reps: 10 }, "metric"), "warm-up 40 kg × 10");
assert.equal(describeHevySet({ type: "normal", weight_kg: 102.06, rep_range: { start: 8, end: 10 } }, "imperial"), "225 lb × 8–10");
assert.equal(describeHevySet({ type: "normal", duration_seconds: 45 }, "metric"), "0:45");
assert.equal(describeHevySet({ set_type: "normal", weight_kg: 100, reps: 5, rpe: 8.5 }, "metric"), "100 kg × 5 · @RPE 8.5");
assert.equal(
  summarizeHevySets([{ type: "warmup", weight_kg: 40, reps: 10 }, ...Array(3).fill({ type: "normal", weight_kg: 80, reps: 8 })], "metric"),
  "warm-up 40 kg × 10, 3 × 80 kg × 8"
);

// ----- Fake Hevy -----
const templates = new Map([
  ["BENCH", { id: "BENCH", title: "Bench Press (Barbell)", type: "weight_reps", equipment: "barbell", primary_muscle_group: "chest", secondary_muscle_groups: ["triceps", "shoulders"] }],
  ["INCLINE", { id: "INCLINE", title: "Incline Bench Press (Dumbbell)", type: "weight_reps", equipment: "dumbbell", primary_muscle_group: "chest", secondary_muscle_groups: [] }],
  ["PLANK", { id: "PLANK", title: "Plank", type: "duration", equipment: "none", primary_muscle_group: "abdominals", secondary_muscle_groups: [] }],
  ["ROW", { id: "ROW", title: "Seated Cable Row - V Grip (Cable)", type: "weight_reps", equipment: "machine", primary_muscle_group: "upper_back", secondary_muscle_groups: ["biceps"] }],
  ["CUSTOM1", { id: "CUSTOM1", title: "Copenhagen Plank", type: "duration", equipment: "none", primary_muscle_group: "adductors", is_custom: true }]
]);
const routine = {
  id: "r1",
  title: "Push A",
  folder_id: 7,
  notes: "Week 1",
  updated_at: "2026-10-30T10:00:00Z",
  exercises: [
    { index: 0, title: "Bench Press (Barbell)", exercise_template_id: "BENCH", rest_seconds: 120, notes: "Pause first rep", superset_id: null,
      sets: [{ index: 0, type: "warmup", weight_kg: 40, reps: 10 }, { index: 1, type: "normal", weight_kg: 80, rep_range: { start: 6, end: 8 } }, { index: 2, type: "normal", weight_kg: 80, rep_range: { start: 6, end: 8 } }] },
    { index: 1, title: "Plank", exercise_template_id: "PLANK", rest_seconds: 60, sets: [{ index: 0, type: "normal", duration_seconds: 45 }] }
  ]
};
const staged = [];
const deps = {
  unitSystem: "metric",
  now: () => new Date("2026-11-02T12:00:00Z"),
  templates: async () => templates,
  template: async (id) => templates.get(id),
  usage: () => new Map([["BENCH", { count: 30, lastStart: Date.parse("2026-10-31T10:00:00Z") / 1000 }], ["ROW", { count: 4, lastStart: Date.parse("2026-10-01T10:00:00Z") / 1000 }]]),
  routines: async () => [routine, { id: "r2", title: "Pull A", folder_id: 7, updated_at: "2026-10-29T10:00:00Z", exercises: [] }],
  folders: async () => [{ id: 7, title: "PPL block" }],
  routine: async (id) => (id === "r1" ? structuredClone(routine) : undefined),
  exerciseHistory: async (id) => id !== "BENCH" ? [] : [
    { workout_id: "w1", workout_title: "Push", workout_start_time: "2026-10-31T10:00:00Z", set_type: "warmup", weight_kg: 60, reps: 5 },
    { workout_id: "w1", workout_title: "Push", workout_start_time: "2026-10-31T10:00:00Z", set_type: "normal", weight_kg: 82.5, reps: 7, rpe: 9 },
    { workout_id: "w0", workout_title: "Push", workout_start_time: "2026-10-24T10:00:00Z", set_type: "normal", weight_kg: 80, reps: 8 },
    { workout_id: "old", workout_title: "Push", workout_start_time: "2025-01-01T10:00:00Z", set_type: "normal", weight_kg: 100, reps: 5 }
  ],
  workouts: async (page, size) => ({
    pageCount: 3,
    workouts: page === 1 ? [{
      id: "w1", title: "Push", routine_id: "r1", description: "Felt strong", start_time: "2026-10-31T10:00:00Z", end_time: "2026-10-31T11:05:00Z",
      exercises: [{ title: "Bench Press (Barbell)", exercise_template_id: "BENCH", sets: [{ type: "warmup", weight_kg: 60, reps: 5 }, { type: "normal", weight_kg: 82.5, reps: 7, rpe: 9 }] }]
    }].slice(0, size) : []
  }),
  workout: async (id) => (id === "w1" ? { id: "w1", title: "Push", start_time: "2026-10-31T10:00:00Z", exercises: [] } : undefined),
  bodyMeasurements: async () => [{ date: "2026-10-01", weight_kg: 81 }, { date: "2026-10-28", weight_kg: 80.2, fat_percent: 14, waist: 82 }],
  stageReview: (draft) => {
    staged.push(draft);
    return { requestId: `req${staged.length}`, action: draft.action, title: draft.title, summary: draft.summary, items: draft.items, notes: draft.notes, createdAt: 0, state: "pending" };
  },
  onReview: () => {}
};
const run = async (name, args = {}, overrides = {}) => JSON.parse(await handleChatHevyTool(name, args, { ...deps, ...overrides }));

// ----- Reads -----
const search = await run("hevy_search_exercises", { query: "bench" });
assert.deepEqual(search.exercises.map((exercise) => exercise.exercise_template_id), ["BENCH", "INCLINE"], "logged exercises rank first");
assert.equal(search.exercises[0].logged_last_year, 30);
assert.equal((await run("hevy_search_exercises", { query: "row cable" })).exercises[0].exercise_template_id, "ROW", "words in any order");
assert.deepEqual((await run("hevy_search_exercises", {})).exercises.map((exercise) => exercise.exercise_template_id), ["BENCH", "ROW"], "no query lists what the athlete logs");
assert.deepEqual((await run("hevy_search_exercises", { custom_only: true })).exercises.map((exercise) => exercise.title), ["Copenhagen Plank"]);
assert.deepEqual((await run("hevy_search_exercises", { muscle_group: "triceps" })).exercises.map((exercise) => exercise.exercise_template_id), ["BENCH"]);
assert.match((await run("hevy_search_exercises", { query: "zercher" })).note, /No exercise matches/);

const listed = await run("hevy_list_routines");
assert.deepEqual(listed.folders, [{ folder_id: 7, title: "PPL block" }]);
assert.deepEqual(listed.routines[0], { routine_id: "r1", title: "Push A", folder_id: 7, folder: "PPL block", updated: "2026-10-30", exercises: ["Bench Press (Barbell) × 3", "Plank × 1"] });
assert.deepEqual((await run("hevy_list_routines", { query: "pull" })).routines.map((item) => item.routine_id), ["r2"]);

const read = await run("hevy_get_routine", { routine_id: "r1" });
assert.equal(read.exercises[0].summary, "warm-up 40 kg × 10, 2 × 80 kg × 6–8 · rest 2:00");
assert.deepEqual(read.exercises[0].sets[1], { type: "normal", weight_kg: 80, weight: "80 kg", rep_range: { start: 6, end: 8 } });
assert.equal(read.exercises[1].type, "duration");
assert.equal((await run("hevy_get_routine", { routine_id: "nope" })).error_code, "routine_not_found");

const history = await run("hevy_get_exercise_history", { exercise_template_id: "BENCH" });
assert.equal(history.sessions_logged, 2, "outside the window is left out");
assert.equal(history.sessions[0].top_set, "82.5 kg × 7 · @RPE 9", "warm-ups never count as the top set");
assert.equal(history.best_e1rm.value, "101.8 kg");
assert.equal((await run("hevy_get_exercise_history", { exercise_template_id: "PLANK" })).sessions_logged, 0);

const workouts = await run("hevy_list_workouts", { limit: 3 });
assert.equal(workouts.pages, 3);
assert.deepEqual(workouts.workouts[0], {
  workout_id: "w1", title: "Push", date: "2026-10-31", duration: "1:05:00", routine_id: "r1", description: "Felt strong", volume: "577.5 kg",
  exercises: [{ title: "Bench Press (Barbell)", exercise_template_id: "BENCH", sets: "warm-up 60 kg × 5, 82.5 kg × 7 · @RPE 9" }]
});
assert.equal((await run("hevy_list_workouts", { workout_id: "w1" })).workout.workout_id, "w1");
assert.equal((await run("hevy_list_workouts", { workout_id: "x" })).error_code, "workout_not_found");

const body = await run("hevy_get_body_measurements", {}, { unitSystem: "imperial" });
assert.deepEqual(body.measurements[0], { date: "2026-10-28", weight: "176.8 lb", fat_percent: 14, waist_cm: 82 }, "newest first, in the athlete's units");

// ----- Writes stage review cards -----
assert.equal((await run("hevy_save_routine", { title: "x", exercises: [{ exercise_template_id: "BENCH", sets: [{}] }] })).error_code, "review_summary_required");
assert.equal((await run("hevy_save_routine", { title: "x", review_summary: "x", exercises: [{ exercise_template_id: "NOPE", sets: [{}] }] })).error_code, "unknown_exercise");
assert.equal((await run("hevy_save_routine", { review_summary: "x", exercises: [{ exercise_template_id: "BENCH", sets: [{ reps: 5 }] }] })).error_code, "title_required");
assert.equal((await run("hevy_save_routine", { title: "x", review_summary: "x", exercises: [{ exercise_template_id: "BENCH", sets: [{ rep_range: { start: 10, end: 6 } }] }] })).error_code, "invalid_set");
assert.equal((await run("hevy_save_routine", { routine_id: "r1", folder_id: 7, review_summary: "x", exercises: [{ exercise_template_id: "BENCH", sets: [{ reps: 5 }] }] })).error_code, "folder_on_update");
assert.equal((await run("hevy_save_routine", { title: "x", folder_id: 99, review_summary: "x", exercises: [{ exercise_template_id: "BENCH", sets: [{ reps: 5 }] }] })).error_code, "folder_not_found");
assert.equal(staged.length, 0, "nothing staged from invalid input");

const created = await run("hevy_save_routine", {
  title: "Upper A",
  new_folder_title: "Hypertrophy block",
  review_summary: "A 4-day upper/lower split.",
  exercises: [
    { exercise_template_id: "BENCH", rest_seconds: 150, sets: [{ type: "warmup", weight_lb: 95, reps: 10 }, { weight_kg: 80, rep_range: { start: 6, end: 8 } }, { weight_kg: 80, rep_range: { start: 6, end: 8 } }] },
    { exercise_template_id: "PLANK", sets: [{ reps: 10 }] }
  ]
});
assert.equal(created.status, "awaiting_confirmation");
assert.match(created.action, /Save to Hevy/);
assert.deepEqual(created.warnings, ["Plank (duration) has sets without duration_seconds."]);
const createDraft = staged.at(-1);
assert.equal(createDraft.action, "saveHevyRoutine");
assert.deepEqual(createDraft.payload.newFolderTitle, "Hypertrophy block");
assert.equal(createDraft.payload.mode, "create");
assert.deepEqual(createDraft.payload.routine.exercises[0], {
  exercise_template_id: "BENCH", superset_id: null, rest_seconds: 150, notes: null,
  sets: [{ type: "warmup", weight_kg: 43.09, reps: 10 }, { type: "normal", weight_kg: 80, rep_range: { start: 6, end: 8 } }, { type: "normal", weight_kg: 80, rep_range: { start: 6, end: 8 } }]
}, "pounds become kilograms; a rep range replaces reps");
assert.deepEqual(createDraft.items.slice(0, 3).map((item) => [item.label, item.after]), [
  ["Routine", "Upper A"],
  ["Folder", "Hypertrophy block (new folder)"],
  ["1. Bench Press (Barbell)", "warm-up 43.1 kg × 10, 2 × 80 kg × 6–8 · rest 2:30"]
]);

const updated = await run("hevy_save_routine", {
  routine_id: "r1",
  review_summary: "Bench moves up after two sessions at the top of the range.",
  exercises: [
    { exercise_template_id: "BENCH", rest_seconds: 120, notes: "Pause first rep", sets: [{ type: "warmup", weight_kg: 40, reps: 10 }, { weight_kg: 82.5, rep_range: { start: 6, end: 8 } }, { weight_kg: 82.5, rep_range: { start: 6, end: 8 } }] }
  ]
});
assert.equal(updated.status, "awaiting_confirmation");
const updateDraft = staged.at(-1);
assert.deepEqual(updateDraft.payload, {
  mode: "update",
  routineId: "r1",
  expectedUpdatedAt: "2026-10-30T10:00:00Z",
  routine: updateDraft.payload.routine
});
assert.equal(updateDraft.payload.routine.title, "Push A", "an update keeps the title");
assert.equal(updateDraft.payload.routine.notes, "Week 1", "and the notes");
assert.equal("folder_id" in updateDraft.payload.routine, false, "an update never sends a folder");
assert.deepEqual(updateDraft.items.map((item) => [item.label, item.before, item.after]), [
  ["Routine", undefined, "Push A"],
  ["1. Bench Press (Barbell)", "warm-up 40 kg × 10, 2 × 80 kg × 6–8 · rest 2:00 · “Pause first rep”", "warm-up 40 kg × 10, 2 × 82.5 kg × 6–8 · rest 2:00 · “Pause first rep”"],
  ["Plank", "0:45 · rest 1:00", "Removed"]
], "the card shows what changes and what is dropped");
assert.match(updateDraft.notes[0], /Replaces this routine/);

assert.equal((await run("hevy_create_custom_exercise", { title: "plank", exercise_type: "duration", equipment: "none", muscle_group: "abdominals", review_summary: "x" })).error_code, "already_exists");
assert.equal((await run("hevy_create_custom_exercise", { title: "Nordic Curl", exercise_type: "bogus", equipment: "none", muscle_group: "hamstrings", review_summary: "x" })).error_code, "invalid_fields");
const exercise = await run("hevy_create_custom_exercise", {
  title: "Nordic Curl (Bodyweight)", exercise_type: "bodyweight_reps", equipment: "none", muscle_group: "hamstrings",
  other_muscles: ["glutes", "hamstrings", "bogus"], review_summary: "Hevy has no Nordic curl."
});
assert.equal(exercise.status, "awaiting_confirmation");
assert.deepEqual(staged.at(-1).payload, {
  exercise: { title: "Nordic Curl (Bodyweight)", exercise_type: "bodyweight_reps", equipment_category: "none", muscle_group: "hamstrings", other_muscles: ["glutes"] }
});

// ----- Failures reach the Coach as errors, not throws -----
const broken = await run("hevy_list_routines", {}, { routines: async () => { throw new Error("Hevy rejected the API key."); } });
assert.deepEqual(broken, { ok: false, error: "Hevy rejected the API key." });

console.log("Coach Hevy tools OK");
