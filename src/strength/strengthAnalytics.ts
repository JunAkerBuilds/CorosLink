/**
 * Aggregations behind the Strength view.
 *
 * Everything here is derived from cached COROS strength sessions: each set
 * carries reps, weight, work time and rest, and each exercise carries a name
 * that `resolveExerciseTargets` turns into weighted muscle activations. A set
 * is credited to a muscle in proportion to its activation share, so a bench
 * press adds a full set to the chest and a quarter-set to the triceps.
 */

import type { StrengthSession, UnitSystem } from "../../electron/types";
import { resolveExerciseName } from "../training/exerciseNames";
import { kilogramsToDisplayWeight, weightUnit } from "../units/units";
import { MUSCLES, resolveExerciseTargets, type MuscleId } from "./muscles";

/** What the body map shades muscles by. */
export type HeatMetric = "sets" | "volume" | "time";

export interface MuscleExerciseShare {
  name: string;
  sets: number;
}

/** One week of credited sets for a single muscle, for the detail sparkline. */
export interface MuscleWeekPoint {
  weekStart: number;
  label: string;
  sets: number;
}

export interface MuscleStat {
  muscle: MuscleId;
  /** Credited sets — fractional, because assistance work counts partially. */
  sets: number;
  reps: number;
  volumeKg: number;
  /**
   * Credited sets from exercises that log no external load. Volume is
   * reps × weight, so these contribute nothing to `volumeKg` — a muscle built
   * on dips and pull-ups reads far lighter than it trained, and the panel has
   * to be able to say so.
   */
  bodyweightSets: number;
  workSec: number;
  /** Sessions that trained this muscle at all. */
  sessions: number;
  /** Epoch seconds of the most recent session that trained it. */
  lastTrained?: number;
  topExercises: MuscleExerciseShare[];
  /** Credited sets per week, zero-filled and aligned with `weeks`. */
  weekly: MuscleWeekPoint[];
}

export interface ExercisePoint {
  at: number;
  e1rmKg: number;
  topWeightKg: number;
  volumeKg: number;
  sets: number;
}

export interface ExerciseStat {
  name: string;
  sessions: number;
  sets: number;
  reps: number;
  volumeKg: number;
  bestWeightKg: number;
  bestE1rmKg: number;
  bestE1rmAt?: number;
  lastPerformed?: number;
  /** Chronological, one entry per session the exercise appeared in. */
  history: ExercisePoint[];
  /** e1RM change from the first to the most recent loaded session, in kg. */
  e1rmTrendKg?: number;
  muscles: MuscleId[];
}

export interface WeekBucket {
  /** Epoch seconds of the Monday that starts the week. */
  weekStart: number;
  label: string;
  sessions: number;
  sets: number;
  volumeKg: number;
  trainingLoad: number;
  durationSec: number;
}

export interface StrengthSummaryStats {
  sessions: number;
  sets: number;
  reps: number;
  volumeKg: number;
  durationSec: number;
  trainingLoad: number;
  calories: number;
  avgSessionVolumeKg: number;
  /** Sessions per week across the window, for the cadence readout. */
  sessionsPerWeek: number;
  heaviestLift?: { name: string; weightKg: number; reps: number; at?: number };
  bestE1rm?: { name: string; e1rmKg: number; at?: number };
}

export interface PatternBalance {
  push: number;
  pull: number;
  legs: number;
  core: number;
}

export interface StrengthAnalytics {
  summary: StrengthSummaryStats;
  /** Every muscle, zero-filled, ordered as in MUSCLES. */
  muscles: MuscleStat[];
  muscleById: Record<MuscleId, MuscleStat>;
  /** Largest value across muscles per metric, used to normalise the heat map. */
  muscleMax: Record<HeatMetric, number>;
  exercises: ExerciseStat[];
  weeks: WeekBucket[];
  balance: PatternBalance;
  /** Credited sets that went to warm-ups, stretching or foam rolling. */
  mobilitySets: number;
  /** Sets whose exercise name has no muscle mapping. */
  unmappedSets: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Map a value against the busiest muscle onto a five-step intensity, shared by
 * the body map, the legend and the ranking list so one colour always means one
 * workload. Each level is a flat 20% band of the maximum — a curve here would
 * push most muscles into the top colours and flatten the very contrast the map
 * exists to show.
 */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) {
    return 0;
  }
  const ratio = Math.min(1, value / max);
  return Math.min(5, Math.max(1, Math.ceil(ratio * 5)));
}

export function metricValue(stat: MuscleStat, metric: HeatMetric): number {
  if (metric === "volume") {
    return stat.volumeKg;
  }
  if (metric === "time") {
    return stat.workSec;
  }
  return stat.sets;
}

/**
 * Epley estimate; only meaningful for loaded sets in a sane rep range. A
 * single rep is already a max, so it is returned untouched rather than being
 * inflated by the formula's 1 + 1/30 term.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0 || reps > 15) {
    return 0;
  }
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

function startOfWeekMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  // getDay() is 0 on Sunday; shift so weeks start on Monday.
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function weekLabel(weekStartMs: number): string {
  return new Date(weekStartMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function emptyMuscleStat(muscle: MuscleId): MuscleStat {
  return {
    muscle,
    sets: 0,
    reps: 0,
    volumeKg: 0,
    bodyweightSets: 0,
    workSec: 0,
    sessions: 0,
    topExercises: [],
    weekly: []
  };
}

interface ExerciseAccumulator {
  name: string;
  sets: number;
  reps: number;
  volumeKg: number;
  bestWeightKg: number;
  bestE1rmKg: number;
  bestE1rmAt?: number;
  lastPerformed?: number;
  muscles: MuscleId[];
  bySession: Map<number, { e1rmKg: number; topWeightKg: number; volumeKg: number; sets: number }>;
}

/**
 * Resolve a display name for one exercise, falling back to the body region or
 * the raw key when COROS gives us an unmapped code.
 */
function exerciseDisplayName(nameKey: string, rawName: string | undefined): string {
  const resolved = resolveExerciseName(nameKey, rawName);
  return /^[TS]\d/.test(resolved) ? "Unnamed exercise" : resolved;
}

export function buildStrengthAnalytics(
  sessions: StrengthSession[],
  windowDays: number
): StrengthAnalytics {
  const muscleById = Object.fromEntries(
    MUSCLES.map((muscle) => [muscle.id, emptyMuscleStat(muscle.id)])
  ) as Record<MuscleId, MuscleStat>;
  // Per-muscle exercise credit, resolved into topExercises at the end.
  const muscleExercises = new Map<MuscleId, Map<string, number>>();
  const muscleSessionIds = new Map<MuscleId, Set<string>>();
  // Credited sets per muscle per week (keyed by the week's start in ms).
  const muscleWeeks = new Map<MuscleId, Map<number, number>>();
  const exercises = new Map<string, ExerciseAccumulator>();
  const weeks = new Map<number, WeekBucket>();
  const balance: PatternBalance = { push: 0, pull: 0, legs: 0, core: 0 };

  let totalSets = 0;
  let totalReps = 0;
  let totalVolumeKg = 0;
  let totalDurationSec = 0;
  let totalTrainingLoad = 0;
  let totalCalories = 0;
  let mobilitySets = 0;
  let unmappedSets = 0;
  let heaviestLift: StrengthSummaryStats["heaviestLift"];
  let bestE1rm: StrengthSummaryStats["bestE1rm"];

  for (const session of sessions) {
    const at = session.startTime;
    const summary = session.detail.summary;
    totalDurationSec += summary.durationSec || session.duration || 0;
    totalTrainingLoad += session.trainingLoad ?? summary.trainingLoad ?? 0;
    totalCalories += session.calories ?? summary.calories ?? 0;

    const weekKey = at ? startOfWeekMs(at * 1000) : undefined;
    if (weekKey !== undefined && !weeks.has(weekKey)) {
      weeks.set(weekKey, {
        weekStart: Math.floor(weekKey / 1000),
        label: weekLabel(weekKey),
        sessions: 0,
        sets: 0,
        volumeKg: 0,
        trainingLoad: 0,
        durationSec: 0
      });
    }
    const week = weekKey !== undefined ? weeks.get(weekKey) : undefined;
    if (week) {
      week.sessions += 1;
      week.trainingLoad += session.trainingLoad ?? summary.trainingLoad ?? 0;
      week.durationSec += summary.durationSec || session.duration || 0;
    }

    for (const exercise of session.detail.exercises) {
      const name = exerciseDisplayName(exercise.nameKey, exercise.rawName);
      const targets = resolveExerciseTargets(name);
      const setCount = exercise.entries.length;

      let exerciseReps = 0;
      let exerciseVolumeKg = 0;
      let exerciseWorkSec = 0;
      let topWeightKg = 0;
      let topWeightReps = 0;
      let bestSetE1rm = 0;

      for (const entry of exercise.entries) {
        exerciseReps += entry.reps;
        exerciseVolumeKg += entry.reps * entry.weightKg;
        exerciseWorkSec += entry.workSec;
        if (entry.weightKg > topWeightKg) {
          topWeightKg = entry.weightKg;
          topWeightReps = entry.reps;
        }
        bestSetE1rm = Math.max(bestSetE1rm, estimateOneRepMax(entry.weightKg, entry.reps));
      }

      totalSets += setCount;
      totalReps += exerciseReps;
      totalVolumeKg += exerciseVolumeKg;
      if (week) {
        week.sets += setCount;
        week.volumeKg += exerciseVolumeKg;
      }

      if (targets.mobility) {
        mobilitySets += setCount;
        continue;
      }
      if (targets.activations.length === 0) {
        unmappedSets += setCount;
        continue;
      }

      if (topWeightKg > (heaviestLift?.weightKg ?? 0)) {
        heaviestLift = { name, weightKg: topWeightKg, reps: topWeightReps, at };
      }
      if (bestSetE1rm > (bestE1rm?.e1rmKg ?? 0)) {
        bestE1rm = { name, e1rmKg: bestSetE1rm, at };
      }

      // ---- Per-exercise history ----
      const accumulator: ExerciseAccumulator = exercises.get(name) ?? {
        name,
        sets: 0,
        reps: 0,
        volumeKg: 0,
        bestWeightKg: 0,
        bestE1rmKg: 0,
        muscles: targets.activations
          .filter((activation) => activation.share >= 0.25)
          .map((activation) => activation.muscle),
        bySession: new Map()
      };
      accumulator.sets += setCount;
      accumulator.reps += exerciseReps;
      accumulator.volumeKg += exerciseVolumeKg;
      accumulator.bestWeightKg = Math.max(accumulator.bestWeightKg, topWeightKg);
      if (bestSetE1rm > accumulator.bestE1rmKg) {
        accumulator.bestE1rmKg = bestSetE1rm;
        accumulator.bestE1rmAt = at;
      }
      if (at !== undefined && at > (accumulator.lastPerformed ?? 0)) {
        accumulator.lastPerformed = at;
      }
      if (at !== undefined) {
        // A superset can list the same exercise twice in one session; merge.
        const point = accumulator.bySession.get(at) ?? {
          e1rmKg: 0,
          topWeightKg: 0,
          volumeKg: 0,
          sets: 0
        };
        point.e1rmKg = Math.max(point.e1rmKg, bestSetE1rm);
        point.topWeightKg = Math.max(point.topWeightKg, topWeightKg);
        point.volumeKg += exerciseVolumeKg;
        point.sets += setCount;
        accumulator.bySession.set(at, point);
      }
      exercises.set(name, accumulator);

      // ---- Muscle credit ----
      for (const activation of targets.activations) {
        const stat = muscleById[activation.muscle];
        stat.sets += setCount * activation.share;
        stat.reps += exerciseReps * activation.share;
        stat.volumeKg += exerciseVolumeKg * activation.share;
        if (exerciseVolumeKg <= 0) {
          stat.bodyweightSets += setCount * activation.share;
        }
        stat.workSec += exerciseWorkSec * activation.share;
        if (at !== undefined && at > (stat.lastTrained ?? 0)) {
          stat.lastTrained = at;
        }

        const sessionIds =
          muscleSessionIds.get(activation.muscle) ?? new Set<string>();
        sessionIds.add(session.activityId);
        muscleSessionIds.set(activation.muscle, sessionIds);

        if (weekKey !== undefined) {
          const byWeek = muscleWeeks.get(activation.muscle) ?? new Map<number, number>();
          byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + setCount * activation.share);
          muscleWeeks.set(activation.muscle, byWeek);
        }

        const byExercise =
          muscleExercises.get(activation.muscle) ?? new Map<string, number>();
        byExercise.set(name, (byExercise.get(name) ?? 0) + setCount * activation.share);
        muscleExercises.set(activation.muscle, byExercise);

        const pattern = MUSCLES.find((m) => m.id === activation.muscle)?.pattern;
        if (pattern) {
          balance[pattern] += setCount * activation.share;
        }
      }
    }
  }

  const weekList = [...weeks.values()].sort((a, b) => a.weekStart - b.weekStart);

  for (const muscle of MUSCLES) {
    const stat = muscleById[muscle.id];
    stat.sessions = muscleSessionIds.get(muscle.id)?.size ?? 0;
    stat.topExercises = [...(muscleExercises.get(muscle.id)?.entries() ?? [])]
      .map(([name, sets]) => ({ name, sets }))
      .sort((a, b) => b.sets - a.sets)
      .slice(0, 5);
    const byWeek = muscleWeeks.get(muscle.id);
    stat.weekly = weekList.map((week) => ({
      weekStart: week.weekStart,
      label: week.label,
      sets: byWeek?.get(week.weekStart * 1000) ?? 0
    }));
  }

  const muscleList = MUSCLES.map((muscle) => muscleById[muscle.id]);
  const muscleMax: Record<HeatMetric, number> = {
    sets: Math.max(0, ...muscleList.map((stat) => stat.sets)),
    volume: Math.max(0, ...muscleList.map((stat) => stat.volumeKg)),
    time: Math.max(0, ...muscleList.map((stat) => stat.workSec))
  };

  const exerciseStats: ExerciseStat[] = [...exercises.values()]
    .map((accumulator) => {
      const history = [...accumulator.bySession.entries()]
        .map(([at, point]) => ({ at, ...point }))
        .sort((a, b) => a.at - b.at);
      const loaded = history.filter((point) => point.e1rmKg > 0);
      const e1rmTrendKg =
        loaded.length >= 2
          ? loaded[loaded.length - 1].e1rmKg - loaded[0].e1rmKg
          : undefined;
      return {
        name: accumulator.name,
        sessions: accumulator.bySession.size,
        sets: accumulator.sets,
        reps: accumulator.reps,
        volumeKg: accumulator.volumeKg,
        bestWeightKg: accumulator.bestWeightKg,
        bestE1rmKg: accumulator.bestE1rmKg,
        bestE1rmAt: accumulator.bestE1rmAt,
        lastPerformed: accumulator.lastPerformed,
        history,
        e1rmTrendKg,
        muscles: accumulator.muscles
      };
    })
    .sort((a, b) => b.sets - a.sets);

  const weeksInWindow = Math.max(1, windowDays / 7);

  return {
    summary: {
      sessions: sessions.length,
      sets: totalSets,
      reps: totalReps,
      volumeKg: totalVolumeKg,
      durationSec: totalDurationSec,
      trainingLoad: totalTrainingLoad,
      calories: totalCalories,
      avgSessionVolumeKg: sessions.length > 0 ? totalVolumeKg / sessions.length : 0,
      sessionsPerWeek: sessions.length / weeksInWindow,
      heaviestLift,
      bestE1rm
    },
    muscles: muscleList,
    muscleById,
    muscleMax,
    exercises: exerciseStats,
    weeks: weekList,
    balance,
    mobilitySets,
    unmappedSets
  };
}

/** Whole days since `timestamp`, or undefined when it never happened. */
export function daysSince(timestamp?: number): number | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = new Date(timestamp * 1000);
  then.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / MS_PER_DAY));
}

export function formatDaysSince(timestamp?: number): string {
  const days = daysSince(timestamp);
  if (days === undefined) {
    return "Not trained";
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  return `${days} days ago`;
}

export function formatVolumeKg(
  value: number,
  unitSystem: UnitSystem
): string {
  if (unitSystem === "metric" && value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}t`;
  }
  return `${Math.round(kilogramsToDisplayWeight(value, unitSystem)).toLocaleString()} ${weightUnit(unitSystem)}`;
}

export function formatWeightKg(
  value: number,
  unitSystem: UnitSystem
): string {
  const display = kilogramsToDisplayWeight(value, unitSystem);
  return `${Number.isInteger(display) ? display : display.toFixed(1)} ${weightUnit(unitSystem)}`;
}

export function formatSets(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}
