import type {
  StrengthExercise,
  StrengthSession,
  StrengthSet,
  StrengthSetType
} from "./types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegative(value: unknown): number {
  return Math.max(0, finite(value) ?? 0);
}

function isoEpochSeconds(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
}

function setType(value: unknown): StrengthSetType {
  return value === "warmup" ||
    value === "dropset" ||
    value === "failure" ||
    value === "normal"
    ? value
    : "normal";
}

/**
 * Cross-provider exercise identity. Hevy writes equipment as a suffix while
 * COROS usually prefixes dumbbell movements and treats a barbell as default.
 */
export function canonicalStrengthExerciseName(value: string): string {
  let normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const equipment = normalized.match(/\s*\((barbell|dumbbell|machine)\)\s*$/)?.[1];
  if (equipment) {
    normalized = normalized.replace(/\s*\((barbell|dumbbell|machine)\)\s*$/, "").trim();
  }
  if (equipment === "dumbbell" && !normalized.startsWith("dumbbell ")) {
    normalized = `dumbbell ${normalized}`;
  } else if (equipment === "machine" && !normalized.includes("machine")) {
    normalized = `${normalized} machine`;
  }
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

export function hevyWorkoutId(raw: JsonRecord): string | undefined {
  return stringValue(raw.id);
}

export function hevyWorkoutStartTime(raw: JsonRecord): number | undefined {
  return isoEpochSeconds(raw.start_time);
}

function normalizeSet(raw: JsonRecord, exerciseType: string | undefined): StrengthSet {
  const rawWeight = nonNegative(raw.weight_kg);
  // Assisted weight is assistance, not load lifted. Other bodyweight variants
  // may carry explicit added weight, which is safe to preserve as external load.
  const weightKg = exerciseType === "bodyweight_assisted_reps" ? 0 : rawWeight;
  const rpeValue = finite(raw.rpe);
  return {
    reps: nonNegative(raw.reps),
    weightKg,
    workSec: nonNegative(raw.duration_seconds),
    restSec: 0,
    calories: 0,
    type: setType(raw.type),
    ...(rpeValue !== undefined && rpeValue >= 0 && rpeValue <= 10
      ? { rpe: rpeValue }
      : {})
  };
}

function normalizeExercise(
  raw: JsonRecord,
  templates: Map<string, JsonRecord>,
  includeWarmups: boolean
): StrengthExercise | undefined {
  const templateId = stringValue(raw.exercise_template_id);
  const template = templateId ? templates.get(templateId) : undefined;
  const title = stringValue(raw.title) ?? stringValue(template?.title) ?? "Unnamed exercise";
  const exerciseType = stringValue(template?.type);
  const rawSets = Array.isArray(raw.sets) ? raw.sets : [];
  const entries = rawSets
    .map(record)
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .sort((left, right) => (finite(left.index) ?? 0) - (finite(right.index) ?? 0))
    .filter((entry) => includeWarmups || setType(entry.type) !== "warmup")
    .map((entry) => normalizeSet(entry, exerciseType));

  if (entries.length === 0) return undefined;
  const secondary = Array.isArray(template?.secondary_muscle_groups)
    ? template.secondary_muscle_groups
        .map(stringValue)
        .filter((value): value is string => Boolean(value))
    : undefined;
  return {
    nameKey: title,
    rawName: title,
    externalId: templateId,
    exerciseType,
    primaryMuscleGroup: stringValue(template?.primary_muscle_group),
    secondaryMuscleGroups: secondary,
    sets: entries.length,
    totalReps: entries.reduce((sum, entry) => sum + entry.reps, 0),
    entries
  };
}

/** Convert a raw Hevy workout into the provider-neutral Strength model. */
export function normalizeHevyWorkout(
  raw: JsonRecord,
  templates: Map<string, JsonRecord>,
  includeWarmups: boolean
): StrengthSession | undefined {
  const id = hevyWorkoutId(raw);
  const startTime = hevyWorkoutStartTime(raw);
  if (!id || startTime === undefined) return undefined;

  const exercises = (Array.isArray(raw.exercises) ? raw.exercises : [])
    .map(record)
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .sort((left, right) => (finite(left.index) ?? 0) - (finite(right.index) ?? 0))
    .map((exercise) => normalizeExercise(exercise, templates, includeWarmups))
    .filter((exercise): exercise is StrengthExercise => Boolean(exercise));
  if (exercises.length === 0) return undefined;

  const endTime = isoEpochSeconds(raw.end_time);
  const durationSec = endTime === undefined ? 0 : Math.max(0, endTime - startTime);
  const sets = exercises.reduce((sum, exercise) => sum + exercise.entries.length, 0);
  const totalReps = exercises.reduce((sum, exercise) => sum + exercise.totalReps, 0);
  const totalWeightKg = exercises.reduce(
    (total, exercise) =>
      total +
      exercise.entries.reduce(
        (exerciseTotal, entry) => exerciseTotal + entry.reps * entry.weightKg,
        0
      ),
    0
  );

  return {
    activityId: `hevy:${id}`,
    source: "hevy",
    sourceIds: { hevy: id },
    sportType: 402,
    sportName: "Strength",
    name: stringValue(raw.title) ?? "Hevy workout",
    startTime,
    duration: durationSec,
    detail: {
      summary: {
        sets,
        totalReps,
        totalWeightKg,
        exercises: exercises.length,
        calories: 0,
        durationSec
      },
      exercises
    }
  };
}
