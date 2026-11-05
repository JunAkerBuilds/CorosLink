import type { CoachReviewDraft } from "./coachReviewActions";
import type { CoachReviewItem, CoachReviewPreview } from "./coachReviewTypes";
import type { ClaudeCodePermissions, CorosMcpTool, UnitSystem } from "./types";
import { kilogramsToDisplayWeight, weightUnit } from "./unitSystem";

// The Coach's Hevy tools over Hevy's public API (the Strength tab's Pro API
// key): the exercise library, routines and folders, per-exercise history,
// logged workouts and body measurements. Reads answer at once; creating or
// changing a routine or a custom exercise stages a review card ("Save to
// Hevy"). Services come in as dependencies, so the tools test without Electron.

type JsonRecord = Record<string, unknown>;

export const CHAT_HEVY_TOOL_NAMES = [
  "hevy_search_exercises",
  "hevy_list_routines",
  "hevy_get_routine",
  "hevy_get_exercise_history",
  "hevy_list_workouts",
  "hevy_get_body_measurements",
  "hevy_save_routine",
  "hevy_create_custom_exercise"
] as const;

export type ChatHevyToolName = (typeof CHAT_HEVY_TOOL_NAMES)[number];

export function isChatHevyTool(name: string): name is ChatHevyToolName {
  return (CHAT_HEVY_TOOL_NAMES as readonly string[]).includes(name);
}

const HEVY_WRITES = new Set<string>(["hevy_save_routine", "hevy_create_custom_exercise"]);

/** Claude's switches: writes are planning, body measurements are health metrics, the rest is training history. */
export function claudeCanUseHevyTool(name: string, permissions: ClaudeCodePermissions): boolean {
  if (HEVY_WRITES.has(name)) return permissions.upcomingWorkouts;
  if (name === "hevy_get_body_measurements") return permissions.trainingMetrics;
  return permissions.recentActivities;
}

export const HEVY_EXERCISE_TYPES = [
  "weight_reps",
  "reps_only",
  "bodyweight_reps",
  "bodyweight_assisted_reps",
  "duration",
  "weight_duration",
  "distance_duration",
  "short_distance_weight"
] as const;
export const HEVY_MUSCLE_GROUPS = [
  "abdominals", "shoulders", "biceps", "triceps", "forearms", "quadriceps", "hamstrings", "calves", "glutes", "abductors",
  "adductors", "lats", "upper_back", "traps", "lower_back", "chest", "cardio", "neck", "full_body", "other"
] as const;
export const HEVY_EQUIPMENT = [
  "none", "barbell", "dumbbell", "kettlebell", "machine", "plate", "resistance_band", "suspension", "other"
] as const;
const SET_TYPES = ["warmup", "normal", "failure", "dropset"] as const;
const LB_TO_KG = 0.45359237;
const MAX_EXERCISES = 30;
const MAX_SETS = 20;

export interface HevyToolDependencies {
  unitSystem: UnitSystem;
  /** The exercise library (built-in and custom), cached; refresh refetches it. */
  templates: (refresh?: boolean) => Promise<Map<string, JsonRecord>>;
  template: (id: string) => Promise<JsonRecord | undefined>;
  /** Times each template was logged in the last year (Strength's Hevy sync), and when last. */
  usage: () => Map<string, { count: number; lastStart: number }>;
  routines: () => Promise<JsonRecord[]>;
  folders: () => Promise<JsonRecord[]>;
  routine: (id: string) => Promise<JsonRecord | undefined>;
  exerciseHistory: (templateId: string, startDate?: string) => Promise<JsonRecord[]>;
  workouts: (page: number, pageSize: number) => Promise<{ workouts: JsonRecord[]; pageCount: number }>;
  workout: (id: string) => Promise<JsonRecord | undefined>;
  bodyMeasurements: (limit: number) => Promise<JsonRecord[]>;
  stageReview: (draft: CoachReviewDraft) => CoachReviewPreview;
  onReview: (preview: CoachReviewPreview) => void;
  now?: () => Date;
}

/** What a staged "Save to Hevy" routine card carries to its executor. */
export interface HevyRoutineReviewPayload {
  mode: "create" | "update";
  routineId?: string;
  /** The routine's updated_at when the Coach read it; a newer one means someone edited it since. */
  expectedUpdatedAt?: string;
  newFolderTitle?: string;
  routine: JsonRecord;
}

export interface HevyExerciseReviewPayload {
  exercise: JsonRecord;
}

// ----- Tool definitions -----

const REVIEW_SUMMARY = {
  type: "string",
  description: "Short athlete-facing reason for the change, in plain language. No internal IDs."
} as const;

const SET_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: [...SET_TYPES], description: "Default normal." },
    weight_kg: { type: "number", minimum: 0, description: "Load in kilograms (for assisted exercises: the assistance)." },
    weight_lb: { type: "number", minimum: 0, description: "Load in pounds instead of weight_kg; converted for Hevy." },
    reps: { type: "integer", minimum: 0, maximum: 1000 },
    rep_range: {
      type: "object",
      properties: { start: { type: "integer", minimum: 1 }, end: { type: "integer", minimum: 1 } },
      required: ["start", "end"],
      description: "Target rep range, e.g. {start: 8, end: 12}, instead of fixed reps."
    },
    duration_seconds: { type: "integer", minimum: 0 },
    distance_meters: { type: "integer", minimum: 0 }
  }
} as const;

export function getChatHevyTools(options: { connected: boolean }): CorosMcpTool[] {
  if (!options.connected) return [];
  return [
    {
      name: "hevy_search_exercises",
      description:
        "Search the athlete's Hevy exercise library (Hevy's built-in exercises plus their custom ones) for exact exercise_template_id values. " +
        "Each result has its type (which set fields it logs), equipment, primary and secondary muscles, whether it is custom, and how often the " +
        "athlete logged it in the last year. Without a query it lists the athlete's most-logged exercises. Prefer an exercise the athlete already " +
        "logs over a near-duplicate. Hevy titles name the equipment in brackets, e.g. 'Bench Press (Barbell)', 'Lat Pulldown (Cable)'.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words in the title, e.g. 'romanian deadlift' or 'row cable'." },
          muscle_group: { type: "string", enum: [...HEVY_MUSCLE_GROUPS], description: "Primary or secondary muscle." },
          equipment: { type: "string", enum: [...HEVY_EQUIPMENT] },
          custom_only: { type: "boolean", description: "Only the athlete's custom exercises." },
          refresh: { type: "boolean", description: "Refetch the library first (after creating a custom exercise)." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 15." }
        }
      }
    },
    {
      name: "hevy_list_routines",
      description:
        "List the athlete's saved Hevy routines (reusable workout templates they start in the Hevy app), with their folders, exercises " +
        "and last change. Use it to find a routine_id before reading or changing one, and to see how the athlete's program is organised.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Only routines whose title contains this." },
          folder_id: { type: "integer", description: "Only routines in this folder." }
        }
      }
    },
    {
      name: "hevy_get_routine",
      description:
        "Read one Hevy routine in full: every exercise with its exercise_template_id, rest, notes and superset, and every set's type, load " +
        "(weight_kg plus the athlete's units), reps or rep range, duration and distance. Read it before hevy_save_routine changes it.",
      inputSchema: {
        type: "object",
        properties: { routine_id: { type: "string" } },
        required: ["routine_id"]
      }
    },
    {
      name: "hevy_get_exercise_history",
      description:
        "Every set the athlete logged in Hevy for one exercise, newest session first, live from Hevy: date, workout, load × reps, RPE, set " +
        "type, each session's top set and estimated one-rep max, and the best across the window. Use it to choose the next loads in a routine " +
        "or to answer how an exercise is progressing.",
      inputSchema: {
        type: "object",
        properties: {
          exercise_template_id: { type: "string" },
          days: { type: "integer", minimum: 7, maximum: 730, description: "Window in days. Default 180." },
          limit: { type: "integer", minimum: 1, maximum: 40, description: "Sessions to return. Default 12." }
        },
        required: ["exercise_template_id"]
      }
    },
    {
      name: "hevy_list_workouts",
      description:
        "The athlete's logged Hevy workouts, newest first, live from Hevy: title, date, duration, the routine it was started from, the athlete's " +
        "description, and every exercise with notes and sets (load × reps, RPE, warm-up/drop/failure sets). Pass workout_id for one workout.",
      inputSchema: {
        type: "object",
        properties: {
          workout_id: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 10, description: "Default 5." },
          page: { type: "integer", minimum: 1, description: "Older workouts, in pages of limit. Default 1." }
        }
      }
    },
    {
      name: "hevy_get_body_measurements",
      description:
        "Body measurements the athlete logged in Hevy, newest first: body weight, lean mass, body fat percent and circumferences (cm).",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 60, description: "Entries. Default 10." } }
      }
    },
    {
      name: "hevy_save_routine",
      description:
        "Prepare a review card that creates a Hevy routine, or replaces an existing one (routine_id). Nothing is saved until the athlete " +
        "clicks Save to Hevy. An update replaces the routine's whole content: read it with hevy_get_routine and send every exercise and set " +
        "to keep, changed or not, with unchanged notes. Use exact exercise_template_id values from hevy_search_exercises or the routine. " +
        "Fill the set fields the exercise type logs: weight_reps → weight + reps or rep_range; reps_only and bodyweight_reps → reps; " +
        "bodyweight_assisted_reps → weight is the assistance; duration → duration_seconds; weight_duration → weight + duration_seconds; " +
        "distance_duration → distance_meters and/or duration_seconds; short_distance_weight → distance_meters + weight. Exercises sharing a " +
        "superset_id are a superset. After awaiting_confirmation, describe the card and stop.",
      inputSchema: {
        type: "object",
        properties: {
          routine_id: { type: "string", description: "The routine to replace. Omit to create a new routine." },
          title: { type: "string", description: "Required for a new routine; an update keeps the current title when omitted." },
          notes: { type: "string", description: "Routine notes. An update keeps the current notes when omitted." },
          folder_id: { type: "integer", description: "New routines only: an existing folder from hevy_list_routines." },
          new_folder_title: { type: "string", description: "New routines only: create this folder and put the routine in it." },
          exercises: {
            type: "array",
            minItems: 1,
            maxItems: MAX_EXERCISES,
            items: {
              type: "object",
              properties: {
                exercise_template_id: { type: "string" },
                rest_seconds: { type: "integer", minimum: 0, maximum: 900 },
                notes: { type: "string", description: "Cues shown in Hevy under the exercise." },
                superset_id: { type: "integer", minimum: 0 },
                sets: { type: "array", minItems: 1, maxItems: MAX_SETS, items: SET_SCHEMA }
              },
              required: ["exercise_template_id", "sets"]
            }
          },
          review_summary: REVIEW_SUMMARY
        },
        required: ["exercises", "review_summary"]
      }
    },
    {
      name: "hevy_create_custom_exercise",
      description:
        "Prepare a review card that adds a custom exercise to the athlete's Hevy library, for a movement the library lacks. Search with " +
        "hevy_search_exercises first: never duplicate an existing exercise. Once the athlete approves, search again with refresh and " +
        "custom_only to get its exercise_template_id. After awaiting_confirmation, describe the card and stop.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Hevy style: the movement, then the equipment in brackets, e.g. 'Copenhagen Plank (Bodyweight)'." },
          exercise_type: { type: "string", enum: [...HEVY_EXERCISE_TYPES] },
          equipment: { type: "string", enum: [...HEVY_EQUIPMENT] },
          muscle_group: { type: "string", enum: [...HEVY_MUSCLE_GROUPS], description: "Primary muscle." },
          other_muscles: { type: "array", items: { type: "string", enum: [...HEVY_MUSCLE_GROUPS] } },
          review_summary: REVIEW_SUMMARY
        },
        required: ["title", "exercise_type", "equipment", "muscle_group", "review_summary"]
      }
    }
  ];
}

/** How to work with Hevy, for the tools on offer. */
export function buildHevyToolGuide(toolNames: Iterable<string>): string {
  const names = new Set(toolNames);
  if (![...names].some(isChatHevyTool)) return "";
  const lines = [
    "## Hevy",
    "The athlete logs gym training in Hevy, connected through Hevy's API. Hevy's model: the exercise library holds exercise templates " +
      "(each with an id and a type that decides which set fields it logs); routines are reusable workout templates, grouped in folders, " +
      "that the athlete starts in the Hevy app; workouts are what they actually logged, with sets typed normal, warmup, dropset or failure " +
      "and an optional RPE (6–10). Hevy stores loads in kilograms; use weight_lb when the athlete thinks in pounds. Rep ranges " +
      "(e.g. 8–12) are how Hevy prescribes double progression.",
    "When the athlete asks about their lifting, Hevy routines or their gym program, read Hevy first: hevy_list_routines and hevy_get_routine " +
      "for the program, hevy_list_workouts for recent sessions, hevy_get_exercise_history for one lift's progression. get_strength_history " +
      "merges Hevy with COROS and Strava for trends, from the Strength tab's last sync; the hevy_ tools are live."
  ];
  if (names.has("hevy_save_routine")) {
    lines.push(
      "To build or change a routine: look up each exercise with hevy_search_exercises (prefer ones the athlete already logs) and set loads " +
        "from their logged history (hevy_get_exercise_history), not guesses; leave a load out when there is no history and say so. " +
        "Changing a routine replaces it, so start from hevy_get_routine and keep every exercise, set and note the athlete didn't ask to change. " +
        "A new routine needs a title; put a program's routines in one folder (new_folder_title once, then its folder_id). " +
        "A Hevy routine is not on the watch: a strength session for the COROS watch is a COROS workout (draft_workout), so ask which the athlete wants when it's unclear."
    );
  }
  const writes = ["hevy_save_routine", "hevy_create_custom_exercise"].filter((name) => names.has(name));
  if (writes.length) {
    lines.push(
      `${writes.join(" and ")} only prepare a review card: describe it and wait for the athlete to click Save to Hevy; never say it was ` +
        "saved before the card reports it. Through Hevy's API the Coach can't log, edit or delete workouts, delete routines or folders, " +
        "or move a routine to another folder; say so instead of trying. A free Hevy account has a routine limit, and Hevy's error says so."
    );
  }
  return lines.join("\n");
}

// ----- Handlers -----

function failure(error_code: string, action: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error_code, action, ...extra });
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function searchKey(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function localDate(iso: unknown): string | undefined {
  const time = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return undefined;
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clock(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatHevyWeight(kilograms: number, unitSystem: UnitSystem): string {
  const value = Math.round(kilogramsToDisplayWeight(kilograms, unitSystem) * 10) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${weightUnit(unitSystem)}`;
}

/** One set as the athlete reads it: "warm-up 60 kg × 8", "80 kg × 8–10", "0:45", "400 m · 1:30". */
export function describeHevySet(set: JsonRecord, unitSystem: UnitSystem): string {
  const weight = finite(set.weight_kg);
  const reps = finite(set.reps);
  const range = record(set.rep_range);
  const rangeStart = finite(range?.start);
  const rangeEnd = finite(range?.end);
  const repText = rangeStart !== undefined && rangeEnd !== undefined && rangeEnd !== rangeStart
    ? `${rangeStart}–${rangeEnd}`
    : rangeStart !== undefined
      ? String(rangeStart)
      : reps !== undefined
        ? String(reps)
        : undefined;
  const parts: string[] = [];
  const load = weight !== undefined && weight > 0 ? formatHevyWeight(weight, unitSystem) : undefined;
  if (load && repText) parts.push(`${load} × ${repText}`);
  else if (repText) parts.push(`${repText} reps`);
  else if (load) parts.push(load);
  const distance = finite(set.distance_meters);
  if (distance !== undefined && distance > 0) parts.push(`${distance} m`);
  const duration = finite(set.duration_seconds);
  if (duration !== undefined && duration > 0) parts.push(clock(duration));
  const rpe = finite(set.rpe);
  if (rpe !== undefined) parts.push(`@RPE ${rpe}`);
  const body = parts.join(" · ") || "empty set";
  const type = set.type ?? set.set_type;
  const prefix = type === "warmup" ? "warm-up " : type === "dropset" ? "drop " : type === "failure" ? "to failure " : "";
  return `${prefix}${body}`;
}

/** Sets in order with identical neighbours collapsed: "warm-up 40 kg × 10, 3 × 80 kg × 8–10". */
export function summarizeHevySets(sets: JsonRecord[], unitSystem: UnitSystem): string {
  const runs: Array<{ text: string; count: number }> = [];
  for (const set of sets) {
    const description = describeHevySet(set, unitSystem);
    const last = runs[runs.length - 1];
    if (last?.text === description) last.count += 1;
    else runs.push({ text: description, count: 1 });
  }
  return runs.map((run) => (run.count > 1 ? `${run.count} × ${run.text}` : run.text)).join(", ");
}

function exerciseSummary(exercise: JsonRecord, unitSystem: UnitSystem): string {
  const rest = finite(exercise.rest_seconds);
  const superset = finite(exercise.superset_id);
  return [
    summarizeHevySets(records(exercise.sets), unitSystem) || "no sets",
    rest !== undefined && rest > 0 ? `rest ${clock(rest)}` : undefined,
    superset !== undefined ? `superset ${superset + 1}` : undefined
  ].filter(Boolean).join(" · ");
}

function estimateOneRepMaxKg(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0 || reps > 15) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export async function handleChatHevyTool(
  name: ChatHevyToolName,
  args: Record<string, unknown>,
  deps: HevyToolDependencies
): Promise<string> {
  try {
    switch (name) {
      case "hevy_search_exercises": return await searchExercises(args, deps);
      case "hevy_list_routines": return await listRoutines(args, deps);
      case "hevy_get_routine": return await getRoutine(args, deps);
      case "hevy_get_exercise_history": return await exerciseHistory(args, deps);
      case "hevy_list_workouts": return await listWorkouts(args, deps);
      case "hevy_get_body_measurements": return await bodyMeasurements(args, deps);
      case "hevy_save_routine": return await saveRoutine(args, deps);
      case "hevy_create_custom_exercise": return await createCustomExercise(args, deps);
    }
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Hevy is unavailable right now." });
  }
}

function templateView(id: string, template: JsonRecord, usage?: { count: number; lastStart: number }) {
  const secondary = Array.isArray(template.secondary_muscle_groups) ? template.secondary_muscle_groups.filter((m) => typeof m === "string") : [];
  return {
    exercise_template_id: id,
    title: text(template.title) ?? "Unnamed exercise",
    type: text(template.type),
    equipment: text(template.equipment),
    primary_muscle: text(template.primary_muscle_group),
    ...(secondary.length ? { secondary_muscles: secondary } : {}),
    ...(template.is_custom === true ? { custom: true } : {}),
    ...(usage ? { logged_last_year: usage.count, last_logged: localDate(new Date(usage.lastStart * 1000).toISOString()) } : {})
  };
}

async function searchExercises(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const templates = await deps.templates(args.refresh === true);
  const usage = deps.usage();
  const query = text(args.query) ? searchKey(String(args.query)) : "";
  const tokens = query ? query.split(" ") : [];
  const muscle = text(args.muscle_group);
  const equipment = text(args.equipment);
  const limit = integer(args.limit, 15, 1, 50);
  const matches: Array<{ id: string; template: JsonRecord; score: number }> = [];
  for (const [id, template] of templates) {
    const title = searchKey(text(template.title) ?? "");
    if (tokens.length && !tokens.every((token) => title.split(" ").some((word) => word.startsWith(token)))) continue;
    if (args.custom_only === true && template.is_custom !== true) continue;
    if (equipment && template.equipment !== equipment) continue;
    if (muscle && template.primary_muscle_group !== muscle &&
      !(Array.isArray(template.secondary_muscle_groups) && template.secondary_muscle_groups.includes(muscle))) continue;
    const logged = usage.get(id)?.count ?? 0;
    // Exact title, then what the athlete logs, then titles that start with the query, then shorter titles.
    const score = (title === query && query ? 10_000 : 0) + Math.min(logged, 500) * 10 +
      (query && title.startsWith(query) ? 50 : 0) - title.length / 100;
    if (!tokens.length && logged === 0 && !muscle && !equipment && args.custom_only !== true) continue;
    matches.push({ id, template, score });
  }
  matches.sort((left, right) => right.score - left.score);
  return JSON.stringify({
    ok: true,
    library_size: templates.size,
    matches: matches.length,
    exercises: matches.slice(0, limit).map((match) => templateView(match.id, match.template, usage.get(match.id))),
    ...(matches.length === 0
      ? { note: tokens.length ? "No exercise matches. Try fewer or different words (Hevy names e.g. 'Squat (Barbell)'), or refresh after adding a custom exercise." : "No exercises logged in the last year; pass a query." }
      : {})
  });
}

async function folderNames(deps: HevyToolDependencies): Promise<Map<number, string>> {
  const folders = await deps.folders().catch(() => []);
  return new Map(folders.flatMap((folder) => {
    const id = finite(folder.id);
    return id === undefined ? [] : [[id, text(folder.title) ?? "Folder"] as [number, string]];
  }));
}

async function listRoutines(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const [routines, folders] = await Promise.all([deps.routines(), folderNames(deps)]);
  const query = text(args.query) ? searchKey(String(args.query)) : "";
  const folderId = finite(args.folder_id);
  const selected = routines.filter((routine) =>
    (!query || searchKey(text(routine.title) ?? "").includes(query)) &&
    (folderId === undefined || finite(routine.folder_id) === folderId));
  return JSON.stringify({
    ok: true,
    folders: [...folders].map(([id, title]) => ({ folder_id: id, title })),
    total: routines.length,
    routines: selected.map((routine) => {
      const folder = finite(routine.folder_id);
      return {
        routine_id: text(routine.id),
        title: text(routine.title),
        ...(folder !== undefined ? { folder_id: folder, folder: folders.get(folder) } : {}),
        updated: localDate(routine.updated_at),
        exercises: records(routine.exercises).map((exercise) => `${text(exercise.title) ?? "Exercise"} × ${records(exercise.sets).length}`)
      };
    }),
    ...(routines.length === 0 ? { note: "The athlete has no saved Hevy routines yet." } : {})
  });
}

async function getRoutine(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const id = text(args.routine_id);
  if (!id) return failure("routine_id_required", "Pass a routine_id from hevy_list_routines.");
  const routine = await deps.routine(id);
  if (!routine) return failure("routine_not_found", "No routine with this id. List routines again with hevy_list_routines.");
  const folders = await folderNames(deps);
  const templates = await deps.templates().catch(() => new Map<string, JsonRecord>());
  const folder = finite(routine.folder_id);
  const { unitSystem } = deps;
  return JSON.stringify({
    ok: true,
    routine_id: text(routine.id) ?? id,
    title: text(routine.title),
    ...(folder !== undefined ? { folder_id: folder, folder: folders.get(folder) } : {}),
    ...(text(routine.notes) ? { notes: text(routine.notes) } : {}),
    updated_at: text(routine.updated_at),
    exercises: records(routine.exercises).map((exercise) => {
      const templateId = text(exercise.exercise_template_id);
      const template = templateId ? templates.get(templateId) : undefined;
      return {
        exercise_template_id: templateId,
        title: text(exercise.title) ?? text(template?.title),
        ...(text(template?.type) ? { type: text(template?.type) } : {}),
        ...(finite(exercise.rest_seconds) !== undefined ? { rest_seconds: finite(exercise.rest_seconds) } : {}),
        ...(text(exercise.notes) ? { notes: text(exercise.notes) } : {}),
        ...(finite(exercise.superset_id) !== undefined ? { superset_id: finite(exercise.superset_id) } : {}),
        summary: exerciseSummary(exercise, unitSystem),
        sets: records(exercise.sets).map((set) => {
          const range = record(set.rep_range);
          const weight = finite(set.weight_kg);
          return {
            type: text(set.type) ?? "normal",
            ...(weight !== undefined ? { weight_kg: weight, weight: formatHevyWeight(weight, unitSystem) } : {}),
            ...(finite(set.reps) !== undefined ? { reps: finite(set.reps) } : {}),
            ...(range && finite(range.start) !== undefined ? { rep_range: { start: finite(range.start), end: finite(range.end) ?? finite(range.start) } } : {}),
            ...(finite(set.duration_seconds) !== undefined ? { duration_seconds: finite(set.duration_seconds) } : {}),
            ...(finite(set.distance_meters) !== undefined ? { distance_meters: finite(set.distance_meters) } : {})
          };
        })
      };
    })
  });
}

async function exerciseHistory(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const id = text(args.exercise_template_id);
  if (!id) return failure("exercise_template_id_required", "Pass an exercise_template_id from hevy_search_exercises.");
  const days = integer(args.days, 180, 7, 730);
  const limit = integer(args.limit, 12, 1, 40);
  const now = deps.now?.() ?? new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  const [entries, template] = await Promise.all([deps.exerciseHistory(id, start.toISOString()), deps.template(id).catch(() => undefined)]);
  const { unitSystem } = deps;
  const sessions = new Map<string, { date?: string; start: number; workout?: string; sets: JsonRecord[] }>();
  for (const entry of entries) {
    const workoutId = text(entry.workout_id) ?? "unknown";
    const startTime = Date.parse(String(entry.workout_start_time ?? ""));
    if (Number.isFinite(startTime) && startTime < start.getTime()) continue;
    const session = sessions.get(workoutId) ?? {
      date: localDate(entry.workout_start_time),
      start: Number.isFinite(startTime) ? startTime : 0,
      workout: text(entry.workout_title),
      sets: []
    };
    session.sets.push(entry);
    sessions.set(workoutId, session);
  }
  let best: { kg: number; date?: string; set: string } | undefined;
  const ordered = [...sessions.values()].sort((left, right) => right.start - left.start);
  const view = ordered.map((session) => {
    let top: { kg: number; set: JsonRecord } | undefined;
    for (const set of session.sets) {
      if (set.set_type === "warmup") continue;
      const e1rm = estimateOneRepMaxKg(finite(set.weight_kg) ?? 0, finite(set.reps) ?? 0);
      if (e1rm > (top?.kg ?? 0)) top = { kg: e1rm, set };
    }
    if (top && top.kg > (best?.kg ?? 0)) best = { kg: top.kg, date: session.date, set: describeHevySet(top.set, unitSystem) };
    return {
      date: session.date,
      workout: session.workout,
      sets: summarizeHevySets(session.sets, unitSystem),
      ...(top ? { top_set: describeHevySet(top.set, unitSystem), e1rm: formatHevyWeight(top.kg, unitSystem) } : {})
    };
  });
  return JSON.stringify({
    ok: true,
    exercise: text(template?.title) ?? id,
    ...(text(template?.type) ? { type: text(template?.type) } : {}),
    window_days: days,
    sessions_logged: ordered.length,
    ...(best ? { best_e1rm: { value: formatHevyWeight(best.kg, unitSystem), date: best.date, set: best.set } } : {}),
    sessions: view.slice(0, limit),
    ...(ordered.length === 0 ? { note: `No sets logged for this exercise in the last ${days} days.` } : {})
  });
}

function workoutView(workout: JsonRecord, unitSystem: UnitSystem) {
  const start = Date.parse(String(workout.start_time ?? ""));
  const end = Date.parse(String(workout.end_time ?? ""));
  const exercises = records(workout.exercises);
  let volume = 0;
  for (const exercise of exercises) {
    for (const set of records(exercise.sets)) {
      if (set.type !== "warmup") volume += (finite(set.weight_kg) ?? 0) * (finite(set.reps) ?? 0);
    }
  }
  return {
    workout_id: text(workout.id),
    title: text(workout.title),
    date: localDate(workout.start_time),
    ...(Number.isFinite(start) && Number.isFinite(end) && end > start ? { duration: clock((end - start) / 1000) } : {}),
    ...(text(workout.routine_id) ? { routine_id: text(workout.routine_id) } : {}),
    ...(text(workout.description) ? { description: text(workout.description) } : {}),
    ...(volume > 0 ? { volume: formatHevyWeight(volume, unitSystem) } : {}),
    exercises: exercises.map((exercise) => ({
      title: text(exercise.title),
      exercise_template_id: text(exercise.exercise_template_id),
      ...(text(exercise.notes) ? { notes: text(exercise.notes) } : {}),
      ...(finite(exercise.superset_id) !== undefined ? { superset_id: finite(exercise.superset_id) } : {}),
      sets: summarizeHevySets(records(exercise.sets), unitSystem)
    }))
  };
}

async function listWorkouts(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const id = text(args.workout_id);
  if (id) {
    const workout = await deps.workout(id);
    if (!workout) return failure("workout_not_found", "No Hevy workout with this id.");
    return JSON.stringify({ ok: true, workout: workoutView(workout, deps.unitSystem) });
  }
  const limit = integer(args.limit, 5, 1, 10);
  const page = integer(args.page, 1, 1, 1000);
  const { workouts, pageCount } = await deps.workouts(page, limit);
  return JSON.stringify({
    ok: true,
    page,
    pages: pageCount,
    workouts: workouts.map((workout) => workoutView(workout, deps.unitSystem)),
    ...(workouts.length === 0 ? { note: page > 1 ? "No older workouts." : "No workouts logged in Hevy yet." } : {})
  });
}

const MEASUREMENT_FIELDS: Array<[string, string]> = [
  ["lean_mass_kg", "lean_mass"], ["fat_percent", "fat_percent"], ["neck_cm", "neck_cm"], ["shoulder_cm", "shoulder_cm"],
  ["chest_cm", "chest_cm"], ["left_bicep_cm", "left_bicep_cm"], ["right_bicep_cm", "right_bicep_cm"],
  ["left_forearm_cm", "left_forearm_cm"], ["right_forearm_cm", "right_forearm_cm"], ["abdomen", "abdomen_cm"],
  ["waist", "waist_cm"], ["hips", "hips_cm"], ["left_thigh", "left_thigh_cm"], ["right_thigh", "right_thigh_cm"],
  ["left_calf", "left_calf_cm"], ["right_calf", "right_calf_cm"]
];

async function bodyMeasurements(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const limit = integer(args.limit, 10, 1, 60);
  const entries = (await deps.bodyMeasurements(limit))
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
  return JSON.stringify({
    ok: true,
    measurements: entries.slice(0, limit).map((entry) => {
      const view: JsonRecord = { date: text(entry.date) };
      const weight = finite(entry.weight_kg);
      if (weight !== undefined) view.weight = formatHevyWeight(weight, deps.unitSystem);
      for (const [field, label] of MEASUREMENT_FIELDS) {
        const value = finite(entry[field]);
        if (value === undefined) continue;
        view[label] = field === "lean_mass_kg" ? formatHevyWeight(value, deps.unitSystem) : value;
      }
      return view;
    }),
    ...(entries.length === 0 ? { note: "No body measurements logged in Hevy." } : {})
  });
}

// ----- Writes (review cards) -----

function awaiting(preview: CoachReviewPreview): string {
  return JSON.stringify({
    status: "awaiting_confirmation",
    preview: { title: preview.title, summary: preview.summary, items: preview.items, ...(preview.notes ? { notes: preview.notes } : {}) },
    action: "The review card is ready. Describe it briefly and wait for the athlete to click Save to Hevy. Nothing has changed in Hevy yet."
  });
}

const REP_TYPES = new Set(["weight_reps", "reps_only", "bodyweight_reps", "bodyweight_assisted_reps"]);

/** A set as Hevy's routine API takes it, or an error for the Coach. */
function normalizeSet(raw: JsonRecord, where: string): { set: JsonRecord } | { error: string } {
  const type = SET_TYPES.includes(raw.type as (typeof SET_TYPES)[number]) ? raw.type : "normal";
  const kg = finite(raw.weight_kg);
  const lb = finite(raw.weight_lb);
  if ((kg !== undefined && kg < 0) || (lb !== undefined && lb < 0)) return { error: `${where}: weight can't be negative.` };
  const weight = kg ?? (lb !== undefined ? Math.round(lb * LB_TO_KG * 100) / 100 : undefined);
  const reps = finite(raw.reps);
  const range = record(raw.rep_range);
  const start = finite(range?.start);
  const end = finite(range?.end) ?? start;
  if (range && (start === undefined || end === undefined || start < 1 || end < start)) {
    return { error: `${where}: rep_range needs start ≥ 1 and end ≥ start.` };
  }
  const set: JsonRecord = { type };
  if (weight !== undefined) set.weight_kg = weight;
  if (start !== undefined && end !== undefined) set.rep_range = { start: Math.round(start), end: Math.round(end) };
  else if (reps !== undefined) set.reps = Math.max(0, Math.round(reps));
  const duration = finite(raw.duration_seconds);
  if (duration !== undefined) set.duration_seconds = Math.max(0, Math.round(duration));
  const distance = finite(raw.distance_meters);
  if (distance !== undefined) set.distance_meters = Math.max(0, Math.round(distance));
  return { set };
}

/** Fields the exercise's type logs but the set leaves empty, as advice for the Coach. */
function setFieldWarnings(title: string, type: string | undefined, sets: JsonRecord[]): string[] {
  if (!type) return [];
  const missing = (field: (set: JsonRecord) => boolean) => sets.some((set) => set.type !== "warmup" && !field(set));
  const hasReps = (set: JsonRecord) => set.reps !== undefined || set.rep_range !== undefined;
  if (REP_TYPES.has(type) && missing(hasReps)) return [`${title} (${type}) has sets without reps or a rep range.`];
  if ((type === "duration" || type === "weight_duration") && missing((set) => set.duration_seconds !== undefined)) {
    return [`${title} (${type}) has sets without duration_seconds.`];
  }
  if (type === "distance_duration" && missing((set) => set.distance_meters !== undefined || set.duration_seconds !== undefined)) {
    return [`${title} (${type}) has sets without a distance or duration.`];
  }
  if (type === "short_distance_weight" && missing((set) => set.distance_meters !== undefined)) {
    return [`${title} (${type}) has sets without distance_meters.`];
  }
  return [];
}

async function saveRoutine(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const summary = text(args.review_summary);
  if (!summary) return failure("review_summary_required", "Add a plain-language review_summary.");
  const routineId = text(args.routine_id);
  const rawExercises = records(args.exercises);
  if (rawExercises.length === 0) return failure("exercises_required", "Pass at least one exercise with its sets.");
  if (rawExercises.length > MAX_EXERCISES) return failure("too_many_exercises", `A routine takes at most ${MAX_EXERCISES} exercises.`);

  const existing = routineId ? await deps.routine(routineId) : undefined;
  if (routineId && !existing) return failure("routine_not_found", "No routine with this id. List routines again with hevy_list_routines.");
  if (routineId && (args.folder_id !== undefined || text(args.new_folder_title))) {
    return failure("folder_on_update", "Hevy's API can't move an existing routine to another folder. Leave folder_id and new_folder_title out of an update.");
  }
  const title = text(args.title) ?? text(existing?.title);
  if (!title) return failure("title_required", "A new routine needs a title.");

  const { unitSystem } = deps;
  const exercises: JsonRecord[] = [];
  const titles: string[] = [];
  const warnings: string[] = [];
  for (const [index, raw] of rawExercises.entries()) {
    const templateId = text(raw.exercise_template_id);
    if (!templateId) return failure("exercise_template_id_required", `Exercise ${index + 1} has no exercise_template_id.`);
    const template = await deps.template(templateId);
    if (!template) {
      return failure("unknown_exercise", `Exercise ${index + 1}: Hevy has no exercise ${templateId}. Find the exact id with hevy_search_exercises.`);
    }
    const exerciseTitle = text(template.title) ?? templateId;
    const rawSets = records(raw.sets);
    if (rawSets.length === 0 || rawSets.length > MAX_SETS) {
      return failure("invalid_sets", `${exerciseTitle} needs between 1 and ${MAX_SETS} sets.`);
    }
    const sets: JsonRecord[] = [];
    for (const [setIndex, rawSet] of rawSets.entries()) {
      const normalized = normalizeSet(rawSet, `${exerciseTitle} set ${setIndex + 1}`);
      if ("error" in normalized) return failure("invalid_set", normalized.error);
      sets.push(normalized.set);
    }
    warnings.push(...setFieldWarnings(exerciseTitle, text(template.type), sets));
    const rest = finite(raw.rest_seconds);
    const superset = finite(raw.superset_id);
    exercises.push({
      exercise_template_id: templateId,
      superset_id: superset === undefined ? null : Math.round(superset),
      rest_seconds: rest === undefined ? null : Math.max(0, Math.round(rest)),
      notes: text(raw.notes) ?? null,
      sets
    });
    titles.push(exerciseTitle);
  }

  const notes = args.notes === undefined ? text(existing?.notes) : text(args.notes);
  const folderId = finite(args.folder_id);
  const newFolderTitle = text(args.new_folder_title);
  let folderLabel: string | undefined;
  if (!routineId && folderId !== undefined) {
    const folders = await folderNames(deps);
    folderLabel = folders.get(folderId);
    if (!folderLabel) return failure("folder_not_found", "No folder with this id. Use hevy_list_routines for folder ids, or new_folder_title.");
  }

  const items: CoachReviewItem[] = [];
  const previousTitle = text(existing?.title);
  items.push(previousTitle && previousTitle !== title ? { label: "Routine", before: previousTitle, after: title } : { label: "Routine", after: title });
  if (!routineId && (folderLabel || newFolderTitle)) {
    items.push({ label: "Folder", after: folderLabel ?? `${newFolderTitle} (new folder)` });
  }
  const previousNotes = text(existing?.notes);
  if (notes !== previousNotes && (notes || previousNotes)) {
    items.push({ label: "Notes", ...(previousNotes ? { before: previousNotes } : {}), after: notes ?? "No notes" });
  }
  // Pair each exercise with the first unused old one on the same template, so moves and edits both read clearly.
  const oldExercises = records(existing?.exercises);
  const used = new Set<number>();
  for (const [index, exercise] of exercises.entries()) {
    const oldIndex = oldExercises.findIndex((old, position) => !used.has(position) && old.exercise_template_id === exercise.exercise_template_id);
    if (oldIndex >= 0) used.add(oldIndex);
    const after = exerciseSummary(exercise, unitSystem) + (exercise.notes ? ` · “${exercise.notes}”` : "");
    const before = oldIndex >= 0
      ? exerciseSummary(oldExercises[oldIndex], unitSystem) + (text(oldExercises[oldIndex].notes) ? ` · “${text(oldExercises[oldIndex].notes)}”` : "")
      : undefined;
    items.push({ label: `${index + 1}. ${titles[index]}`, ...(existing ? { before: before ?? "Not in the routine" } : {}), after });
  }
  oldExercises.forEach((old, position) => {
    if (!used.has(position)) {
      items.push({ label: text(old.title) ?? "Exercise", before: exerciseSummary(old, unitSystem), after: "Removed" });
    }
  });

  const routine: JsonRecord = { title, notes: notes ?? "", exercises };
  if (!routineId && folderId !== undefined) routine.folder_id = folderId;
  if (!routineId && folderId === undefined && !newFolderTitle) routine.folder_id = null;
  const payload: HevyRoutineReviewPayload = {
    mode: routineId ? "update" : "create",
    ...(routineId ? { routineId, expectedUpdatedAt: text(existing?.updated_at) } : {}),
    ...(!routineId && newFolderTitle && folderId === undefined ? { newFolderTitle } : {}),
    routine
  };
  const preview = deps.stageReview({
    action: "saveHevyRoutine",
    title: routineId ? "Update Hevy routine" : "New Hevy routine",
    summary,
    items,
    notes: [
      routineId
        ? "Replaces this routine in Hevy with what is shown here. Workouts already logged don't change."
        : "Saved to your Hevy account; start it from Workout in the Hevy app.",
      ...(newFolderTitle && !routineId && folderId === undefined ? [`Creates the folder “${newFolderTitle}”.`] : [])
    ],
    payload
  });
  deps.onReview(preview);
  const result = JSON.parse(awaiting(preview)) as JsonRecord;
  return JSON.stringify(warnings.length ? { ...result, warnings } : result);
}

async function createCustomExercise(args: Record<string, unknown>, deps: HevyToolDependencies): Promise<string> {
  const summary = text(args.review_summary);
  if (!summary) return failure("review_summary_required", "Add a plain-language review_summary.");
  const title = text(args.title);
  if (!title) return failure("title_required", "Name the exercise.");
  const type = HEVY_EXERCISE_TYPES.find((value) => value === args.exercise_type);
  const equipment = HEVY_EQUIPMENT.find((value) => value === args.equipment);
  const muscle = HEVY_MUSCLE_GROUPS.find((value) => value === args.muscle_group);
  if (!type || !equipment || !muscle) {
    return failure("invalid_fields", "Pass exercise_type, equipment and muscle_group from the listed values.");
  }
  const others = Array.isArray(args.other_muscles)
    ? [...new Set(args.other_muscles.filter((value): value is (typeof HEVY_MUSCLE_GROUPS)[number] =>
      HEVY_MUSCLE_GROUPS.includes(value as (typeof HEVY_MUSCLE_GROUPS)[number]) && value !== muscle))]
    : [];
  const templates = await deps.templates();
  const key = searchKey(title);
  const duplicate = [...templates].find(([, template]) => searchKey(text(template.title) ?? "") === key);
  if (duplicate) {
    return failure("already_exists", "The Hevy library already has this exercise; use its id.", {
      exercise: templateView(duplicate[0], duplicate[1])
    });
  }
  const label = (value: string) => value.replace(/_/g, " ");
  const preview = deps.stageReview({
    action: "createHevyExercise",
    title: "New Hevy exercise",
    summary,
    items: [
      { label: "Exercise", after: title },
      { label: "Logs", after: label(type) },
      { label: "Equipment", after: label(equipment) },
      { label: "Muscles", after: [label(muscle), ...others.map(label)].join(", ") }
    ],
    notes: ["Added to your custom exercises in Hevy."],
    payload: {
      exercise: { title, exercise_type: type, equipment_category: equipment, muscle_group: muscle, other_muscles: others }
    } satisfies HevyExerciseReviewPayload
  });
  deps.onReview(preview);
  return awaiting(preview);
}
