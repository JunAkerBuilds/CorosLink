import { resolveExerciseName } from "./corosExerciseNames";
import { canonicalStrengthExerciseName } from "./hevyModel";
import {
  MUSCLE_BY_ID,
  resolveCorosExerciseTargets,
  resolveProviderMuscleTargets,
  type MuscleId
} from "./strengthMuscles";
import { kilogramsToDisplayWeight, weightUnit } from "./unitSystem";
import type { StrengthExercise, StrengthSession, UnitSystem } from "./types";

// What the athlete actually lifted, for progressive-overload advice: per
// exercise the loads, sets and reps, and an estimated one-rep max per session;
// per muscle the sets and volume, credited by the same activation rules as the
// Strength view's body map. Warm-up sets count toward neither.

const MAX_SESSIONS_PER_EXERCISE = 8;

export interface ExerciseSessionPoint {
  date: string;
  sets: number;
  top_set: string;
  /** Epley estimate from the session's best set; absent for bodyweight-only work. */
  e1rm?: string;
  volume?: string;
  avg_rpe?: number;
}

export interface ExerciseProgress {
  exercise: string;
  sessions: number;
  last_performed: string;
  sets: number;
  reps: number;
  volume?: string;
  best_set?: string;
  best_e1rm?: { value: string; date: string };
  /** First to last session's e1RM in the window, in percent. */
  e1rm_change_pct?: number;
  /** Newest last. */
  history: ExerciseSessionPoint[];
  muscles: string[];
}

export interface MuscleProgress {
  muscle: string;
  /** Work sets of exercises where this is a main muscle (the usual "hard sets" count). */
  sets: number;
  sets_per_week: number;
  /** Sets credited by activation share, as the Strength view's body map shades them. */
  weighted_sets: number;
  volume?: string;
  sessions: number;
}

export interface StrengthProgressReport {
  days: number;
  sessions: number;
  sources: string[];
  exercises: ExerciseProgress[];
  muscles: MuscleProgress[];
  /** Sets whose exercise CorosLink can't map to a muscle (custom or unnamed). */
  unmapped_sets: number;
}

/** Epley, as in the Strength view; one rep is already a max, past 15 reps it says nothing. */
export function estimateOneRepMaxKg(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0 || reps > 15) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

function exerciseName(exercise: StrengthExercise): string {
  const resolved = resolveExerciseName(exercise.nameKey, exercise.rawName);
  return /^[TS]\d/.test(resolved) ? "Unnamed exercise" : resolved;
}

/** Groups the same movement across sources: COROS's "Squats" and Hevy's "Squat (Barbell)". */
export function exerciseGroupKey(name: string): string {
  return canonicalStrengthExerciseName(name)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .join(" ");
}

function targets(exercise: StrengthExercise, name: string) {
  const named = resolveCorosExerciseTargets(exercise.nameKey, name);
  if (named.mobility || named.generic || named.activations.length > 0) return named;
  return resolveProviderMuscleTargets(exercise.primaryMuscleGroup, exercise.secondaryMuscleGroups);
}

function localDate(epochSeconds: number | undefined): string {
  if (epochSeconds === undefined) return "unknown";
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface ExerciseAccumulator {
  name: string;
  sessions: Map<string, { date: string; at: number; sets: number; reps: number; volumeKg: number; topWeightKg: number; topReps: number; e1rmKg: number; rpe: number[] }>;
  sets: number;
  reps: number;
  volumeKg: number;
  bestWeightKg: number;
  bestReps: number;
  bestE1rmKg: number;
  bestE1rmDate?: string;
  muscles: Set<MuscleId>;
}

export function buildStrengthProgress(
  sessions: StrengthSession[],
  options: { days: number; unitSystem?: UnitSystem; exercise?: string; limit?: number }
): StrengthProgressReport {
  const unitSystem = options.unitSystem ?? "metric";
  // Loads to the half kilogram (or pound), totals to the whole one.
  const weight = (kg: number) => {
    const shown = kilogramsToDisplayWeight(kg, unitSystem);
    const rounded = shown >= 1000 ? Math.round(shown) : Math.round(shown * 2) / 2;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${weightUnit(unitSystem)}`;
  };
  const filter = options.exercise ? exerciseGroupKey(options.exercise) : "";
  const exercises = new Map<string, ExerciseAccumulator>();
  const muscles = new Map<MuscleId, { sets: number; weightedSets: number; volumeKg: number; sessions: Set<string> }>();
  const sources = new Set<string>();
  let unmappedSets = 0;

  const ordered = [...sessions].sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
  for (const session of ordered) {
    sources.add(session.source ?? "coros");
    const date = localDate(session.startTime);
    for (const exercise of session.detail.exercises) {
      const name = exerciseName(exercise);
      const key = exerciseGroupKey(name);
      const work = exercise.entries.filter((set) => set.type !== "warmup" && set.reps > 0);
      if (!work.length) continue;
      const credit = targets(exercise, name);
      if (!credit.activations.length && !credit.mobility) unmappedSets += work.length;
      // The movement's main muscles: secondary ones are credited at under half a primary's share.
      const top = Math.max(0, ...credit.activations.map((activation) => activation.share));
      for (const activation of credit.activations) {
        const muscle = muscles.get(activation.muscle) ?? { sets: 0, weightedSets: 0, volumeKg: 0, sessions: new Set<string>() };
        if (activation.share >= top * 0.6) muscle.sets += work.length;
        muscle.weightedSets += work.length * activation.share;
        muscle.volumeKg += work.reduce((sum, set) => sum + set.reps * set.weightKg, 0) * activation.share;
        muscle.sessions.add(session.activityId);
        muscles.set(activation.muscle, muscle);
      }
      if (filter && !key.includes(filter)) continue;

      const entry: ExerciseAccumulator = exercises.get(key) ?? {
        name,
        sessions: new Map(),
        sets: 0,
        reps: 0,
        volumeKg: 0,
        bestWeightKg: 0,
        bestReps: 0,
        bestE1rmKg: 0,
        muscles: new Set<MuscleId>()
      };
      for (const activation of credit.activations) if (activation.share >= top * 0.6) entry.muscles.add(activation.muscle);
      const point = entry.sessions.get(session.activityId) ?? {
        date, at: session.startTime ?? 0, sets: 0, reps: 0, volumeKg: 0, topWeightKg: 0, topReps: 0, e1rmKg: 0, rpe: []
      };
      for (const set of work) {
        point.sets += 1;
        point.reps += set.reps;
        point.volumeKg += set.reps * set.weightKg;
        if (set.weightKg > point.topWeightKg || (set.weightKg === point.topWeightKg && set.reps > point.topReps)) {
          point.topWeightKg = set.weightKg;
          point.topReps = set.reps;
        }
        point.e1rmKg = Math.max(point.e1rmKg, estimateOneRepMaxKg(set.weightKg, set.reps));
        if (set.rpe !== undefined) point.rpe.push(set.rpe);
        if (set.weightKg > entry.bestWeightKg || (set.weightKg === entry.bestWeightKg && set.reps > entry.bestReps)) {
          entry.bestWeightKg = set.weightKg;
          entry.bestReps = set.reps;
        }
      }
      entry.sessions.set(session.activityId, point);
      entry.sets += work.length;
      entry.reps += work.reduce((sum, set) => sum + set.reps, 0);
      entry.volumeKg += work.reduce((sum, set) => sum + set.reps * set.weightKg, 0);
      if (point.e1rmKg > entry.bestE1rmKg) {
        entry.bestE1rmKg = point.e1rmKg;
        entry.bestE1rmDate = date;
      }
      exercises.set(key, entry);
    }
  }

  const topSet = (weightKg: number, reps: number) => (weightKg > 0 ? `${reps} × ${weight(weightKg)}` : `${reps} reps`);
  const weeks = Math.max(1, options.days / 7);
  const exerciseRows = [...exercises.values()]
    .map((entry): ExerciseProgress & { rank: number } => {
      const points = [...entry.sessions.values()].sort((left, right) => left.at - right.at);
      const loaded = points.filter((point) => point.e1rmKg > 0);
      const first = loaded[0]?.e1rmKg;
      const last = loaded.at(-1)?.e1rmKg;
      return {
        exercise: entry.name,
        sessions: points.length,
        last_performed: points.at(-1)?.date ?? "unknown",
        sets: entry.sets,
        reps: entry.reps,
        ...(entry.volumeKg > 0 ? { volume: weight(entry.volumeKg) } : {}),
        ...(entry.bestReps ? { best_set: topSet(entry.bestWeightKg, entry.bestReps) } : {}),
        ...(entry.bestE1rmKg > 0 && entry.bestE1rmDate ? { best_e1rm: { value: weight(entry.bestE1rmKg), date: entry.bestE1rmDate } } : {}),
        ...(first && last && loaded.length > 1 ? { e1rm_change_pct: Math.round(((last - first) / first) * 1000) / 10 } : {}),
        history: points.slice(-MAX_SESSIONS_PER_EXERCISE).map((point) => ({
          date: point.date,
          sets: point.sets,
          top_set: topSet(point.topWeightKg, point.topReps),
          ...(point.e1rmKg > 0 ? { e1rm: weight(point.e1rmKg) } : {}),
          ...(point.volumeKg > 0 ? { volume: weight(point.volumeKg) } : {}),
          ...(point.rpe.length ? { avg_rpe: Math.round((point.rpe.reduce((sum, value) => sum + value, 0) / point.rpe.length) * 10) / 10 } : {})
        })),
        muscles: [...entry.muscles].map((muscle) => MUSCLE_BY_ID[muscle].label),
        rank: points.length * 1000 + entry.sets
      };
    })
    .sort((left, right) => right.rank - left.rank)
    .slice(0, Math.max(1, Math.min(40, options.limit ?? 15)))
    .map(({ rank: _rank, ...row }) => row);

  const muscleRows = [...muscles.entries()]
    .filter(([, stat]) => stat.weightedSets >= 0.5)
    .sort((left, right) => right[1].sets - left[1].sets || right[1].weightedSets - left[1].weightedSets)
    .map(([muscle, stat]): MuscleProgress => ({
      muscle: MUSCLE_BY_ID[muscle].label,
      sets: stat.sets,
      sets_per_week: Math.round((stat.sets / weeks) * 10) / 10,
      weighted_sets: Math.round(stat.weightedSets * 10) / 10,
      ...(stat.volumeKg > 0 ? { volume: weight(stat.volumeKg) } : {}),
      sessions: stat.sessions.size
    }));

  return {
    days: options.days,
    sessions: sessions.length,
    sources: [...sources].sort(),
    exercises: exerciseRows,
    muscles: muscleRows,
    unmapped_sets: Math.round(unmappedSets)
  };
}
