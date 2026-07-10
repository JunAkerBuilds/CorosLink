import type {
  StrengthDetail,
  StrengthExercise,
  StrengthSet,
  StrengthSummary
} from "./types";

const REST_MARKER_KEY = "S3618";

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function getLapItems(raw: Record<string, unknown>): Record<string, unknown>[] {
  const lapList = raw.lapList;
  if (!Array.isArray(lapList) || lapList.length === 0) {
    return [];
  }
  const first = lapList[0];
  if (!first || typeof first !== "object") {
    return [];
  }
  const items = (first as Record<string, unknown>).lapItemList;
  return Array.isArray(items)
    ? (items.filter((i) => i && typeof i === "object") as Record<string, unknown>[])
    : [];
}

/** Group lap items by exerciseIndex, in first-seen order. */
function groupByExerciseIndex(
  items: Record<string, unknown>[]
): Record<string, unknown>[][] {
  const order: number[] = [];
  const groups = new Map<number, Record<string, unknown>[]>();
  for (const item of items) {
    const idx = num(item.exerciseIndex) ?? -1;
    if (!groups.has(idx)) {
      groups.set(idx, []);
      order.push(idx);
    }
    groups.get(idx)!.push(item);
  }
  return order.map((idx) => groups.get(idx)!);
}

function buildExercise(
  group: Record<string, unknown>[]
): StrengthExercise | undefined {
  // Drop section-rest marker laps entirely.
  const laps = group.filter((l) => l.exerciseNameKey !== REST_MARKER_KEY);
  if (laps.length === 0) {
    return undefined;
  }

  const nameKey =
    (laps.find((l) => typeof l.exerciseNameKey === "string")
      ?.exerciseNameKey as string | undefined) ?? "";
  const rawNameValue = laps.find((l) => typeof l.name === "string")?.name;
  const rawName = typeof rawNameValue === "string" ? rawNameValue : undefined;

  const aggregate = laps.find((l) => (num(l.sets) ?? 0) > 0);

  const entries: StrengthSet[] = [];
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    const reps = num(lap.reps) ?? 0;
    const sets = num(lap.sets) ?? 0;
    if (reps <= 0 || sets > 0) {
      continue; // rest laps (reps 0) and the aggregate lap (sets > 0) are not work sets
    }
    const next = laps[i + 1];
    const nextIsRest =
      next && (num(next.reps) ?? 0) === 0 && (num(next.sets) ?? 0) === 0;
    entries.push({
      reps,
      weightKg: round((num(lap.weight) ?? 0) / 1000, 2),
      workSec: round((num(lap.time) ?? 0) / 100, 2),
      restSec: nextIsRest ? round((num(next!.time) ?? 0) / 100, 2) : 0,
      calories: Math.round((num(lap.calories) ?? 0) / 1000)
    });
  }

  const sets = aggregate
    ? num(aggregate.sets) ?? entries.length
    : entries.length;
  const totalReps = aggregate
    ? num(aggregate.reps) ?? entries.reduce((s, e) => s + e.reps, 0)
    : entries.reduce((s, e) => s + e.reps, 0);

  return { nameKey, rawName, sets, totalReps, entries };
}

function parseSummary(raw: Record<string, unknown>): StrengthSummary {
  const s =
    raw.summary && typeof raw.summary === "object"
      ? (raw.summary as Record<string, unknown>)
      : raw;
  const durationCs = num(s.totalTime) ?? num(s.workoutTime) ?? 0;
  return {
    sets: num(s.sets) ?? 0,
    totalReps: num(s.totalReps) ?? 0,
    totalWeightKg: round((num(s.totalWeight) ?? 0) / 1000, 0),
    exercises: num(s.exercises) ?? 0,
    calories: Math.round((num(s.calories) ?? 0) / 1000),
    durationSec: Math.round(durationCs / 100),
    avgHr: num(s.avgHr),
    maxHr: num(s.maxHr),
    trainingLoad: num(s.trainingLoad),
    aerobicEffect: num(s.aerobicEffect),
    anaerobicEffect: num(s.anaerobicEffect)
  };
}

/**
 * Build a StrengthDetail from a raw /activity/detail/query payload.
 * Returns undefined when the payload has no strength exercise breakdown.
 */
export function parseStrengthDetail(
  raw: Record<string, unknown>
): StrengthDetail | undefined {
  const items = getLapItems(raw);
  const hasExerciseData = items.some(
    (i) => typeof i.exerciseNameKey === "string" && i.exerciseNameKey
  );
  if (!hasExerciseData) {
    return undefined;
  }
  const exercises = groupByExerciseIndex(items)
    .map(buildExercise)
    .filter((e): e is StrengthExercise => e !== undefined && e.entries.length > 0);
  if (exercises.length === 0) {
    return undefined;
  }
  return { summary: parseSummary(raw), exercises };
}
