/**
 * Generated strength history for the developer view.
 *
 * The Strength page is only interesting once there is a body of work behind it,
 * which makes it awkward to iterate on when the connected account has no gym
 * sessions. This builds a plausible push/pull/legs history — real COROS
 * exercise codes, progressive overload on the main lifts, a mix of loaded and
 * bodyweight work — so every panel populates without touching the API.
 *
 * It is deterministic: the same window always produces the same history, so
 * the page does not reshuffle on every render.
 */

import type { StrengthExercise, StrengthSession, StrengthSet } from "../../electron/types";

/** Mulberry32 — small, fast, and stable across runs. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ExercisePlan {
  /** COROS catalogue code — resolved to a display name like any real session. */
  nameKey: string;
  sets: number;
  reps: number;
  /** Working weight at the start of the window, in kg. 0 = bodyweight. */
  baseWeightKg: number;
  /** Kilos added per week of training. */
  weeklyGainKg: number;
  /** Seconds under load per set. */
  workSec: number;
  restSec: number;
}

interface SessionTemplate {
  name: string;
  exercises: ExercisePlan[];
}

const PUSH: SessionTemplate = {
  name: "Upper Push",
  exercises: [
    { nameKey: "T1041", sets: 4, reps: 8, baseWeightKg: 70, weeklyGainKg: 0.6, workSec: 38, restSec: 150 },
    { nameKey: "T1042", sets: 3, reps: 10, baseWeightKg: 50, weeklyGainKg: 0.4, workSec: 40, restSec: 120 },
    { nameKey: "T1015", sets: 4, reps: 8, baseWeightKg: 40, weeklyGainKg: 0.35, workSec: 36, restSec: 120 },
    { nameKey: "T1017", sets: 3, reps: 14, baseWeightKg: 12, weeklyGainKg: 0.1, workSec: 45, restSec: 75 },
    { nameKey: "T1051", sets: 3, reps: 10, baseWeightKg: 0, weeklyGainKg: 0, workSec: 34, restSec: 90 },
    { nameKey: "T1025", sets: 3, reps: 12, baseWeightKg: 30, weeklyGainKg: 0.25, workSec: 38, restSec: 75 }
  ]
};

const PULL: SessionTemplate = {
  name: "Upper Pull",
  exercises: [
    { nameKey: "T1002", sets: 4, reps: 8, baseWeightKg: 0, weeklyGainKg: 0, workSec: 32, restSec: 150 },
    { nameKey: "T1054", sets: 4, reps: 8, baseWeightKg: 60, weeklyGainKg: 0.5, workSec: 36, restSec: 135 },
    { nameKey: "T1052", sets: 3, reps: 10, baseWeightKg: 55, weeklyGainKg: 0.45, workSec: 40, restSec: 105 },
    { nameKey: "T1020", sets: 3, reps: 14, baseWeightKg: 10, weeklyGainKg: 0.08, workSec: 42, restSec: 75 },
    { nameKey: "T1058", sets: 3, reps: 12, baseWeightKg: 60, weeklyGainKg: 0.5, workSec: 34, restSec: 90 },
    { nameKey: "T1021", sets: 3, reps: 12, baseWeightKg: 16, weeklyGainKg: 0.12, workSec: 38, restSec: 75 },
    { nameKey: "T1011", sets: 3, reps: 15, baseWeightKg: 20, weeklyGainKg: 0.1, workSec: 40, restSec: 60 }
  ]
};

const LEGS: SessionTemplate = {
  name: "Lower Body",
  exercises: [
    // T1120 is the catalogue's Warm Up lap, so the mobility path gets exercised.
    { nameKey: "T1120", sets: 1, reps: 1, baseWeightKg: 0, weeklyGainKg: 0, workSec: 420, restSec: 0 },
    { nameKey: "T1061", sets: 5, reps: 6, baseWeightKg: 95, weeklyGainKg: 0.9, workSec: 34, restSec: 180 },
    { nameKey: "T1067", sets: 3, reps: 5, baseWeightKg: 115, weeklyGainKg: 1.1, workSec: 28, restSec: 210 },
    { nameKey: "T1065", sets: 3, reps: 12, baseWeightKg: 140, weeklyGainKg: 1.4, workSec: 42, restSec: 120 },
    { nameKey: "T1289", sets: 3, reps: 10, baseWeightKg: 70, weeklyGainKg: 0.7, workSec: 36, restSec: 120 },
    { nameKey: "T1069", sets: 3, reps: 12, baseWeightKg: 40, weeklyGainKg: 0.3, workSec: 40, restSec: 90 },
    { nameKey: "T1115", sets: 3, reps: 15, baseWeightKg: 35, weeklyGainKg: 0.25, workSec: 42, restSec: 75 },
    { nameKey: "T1066", sets: 3, reps: 14, baseWeightKg: 45, weeklyGainKg: 0.35, workSec: 44, restSec: 75 },
    { nameKey: "T1070", sets: 4, reps: 16, baseWeightKg: 50, weeklyGainKg: 0.4, workSec: 40, restSec: 60 }
  ]
};

const CORE: SessionTemplate = {
  name: "Core & Conditioning",
  exercises: [
    { nameKey: "T1010", sets: 3, reps: 1, baseWeightKg: 0, weeklyGainKg: 0, workSec: 70, restSec: 60 },
    { nameKey: "T1032", sets: 3, reps: 12, baseWeightKg: 0, weeklyGainKg: 0, workSec: 36, restSec: 75 },
    { nameKey: "T1076", sets: 3, reps: 24, baseWeightKg: 0, weeklyGainKg: 0, workSec: 48, restSec: 60 },
    { nameKey: "T1011", sets: 3, reps: 15, baseWeightKg: 18, weeklyGainKg: 0.08, workSec: 40, restSec: 60 },
    { nameKey: "T1049", sets: 3, reps: 12, baseWeightKg: 24, weeklyGainKg: 0.15, workSec: 38, restSec: 75 }
  ]
};

// Four-session rotation, so a typical week lands push / pull / legs plus a
// core day and the split drifts across weeks the way real training does.
const ROTATION = [PUSH, PULL, LEGS, CORE, PUSH, LEGS, PULL];

/** Training days of the week, Monday-indexed: Mon, Tue, Thu, Sat. */
const TRAINING_WEEKDAYS = [0, 1, 3, 5];

const MS_PER_DAY = 86_400_000;

function roundToPlate(weightKg: number): number {
  return Math.round(weightKg * 2) / 2;
}

function buildExercise(
  plan: ExercisePlan,
  weekIndex: number,
  random: () => number
): StrengthExercise {
  const progressed = plan.baseWeightKg + plan.weeklyGainKg * weekIndex;
  // A little session-to-session noise so trends are not perfectly straight.
  const working =
    plan.baseWeightKg > 0
      ? roundToPlate(progressed * (0.97 + random() * 0.06))
      : 0;

  const entries: StrengthSet[] = [];
  for (let set = 0; set < plan.sets; set += 1) {
    // Reps drift down and weight creeps up across a straight-set block.
    const fatigue = set >= plan.sets - 1 && plan.reps > 6 ? 2 : 0;
    const reps = Math.max(1, plan.reps - fatigue + (random() < 0.25 ? 1 : 0));
    const weightKg =
      working > 0 ? roundToPlate(working * (set === 0 ? 0.92 : 1)) : 0;
    const workSec = Math.round(plan.workSec * (0.9 + random() * 0.2));
    entries.push({
      reps,
      weightKg,
      workSec,
      restSec: plan.restSec,
      calories: Math.max(3, Math.round(workSec * 0.22 + reps * 0.4))
    });
  }

  return {
    nameKey: plan.nameKey,
    sets: entries.length,
    totalReps: entries.reduce((total, entry) => total + entry.reps, 0),
    entries
  };
}

/**
 * A believable strength history covering the last `days`, newest first — the
 * same ordering `listStoredStrengthSessions` returns.
 */
export function buildSampleStrengthSessions(days: number): StrengthSession[] {
  const random = createRandom(0x5f3a21 + days);
  const sessions: StrengthSession[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today.getTime() - days * MS_PER_DAY);
  // Start counting from the Monday on or before the window opens.
  const firstMonday = new Date(windowStart);
  firstMonday.setDate(firstMonday.getDate() - ((firstMonday.getDay() + 6) % 7));

  const weekCount = Math.ceil((today.getTime() - firstMonday.getTime()) / (7 * MS_PER_DAY));
  let rotationIndex = 0;

  for (let week = 0; week < weekCount; week += 1) {
    for (const weekday of TRAINING_WEEKDAYS) {
      const day = new Date(firstMonday);
      day.setDate(day.getDate() + week * 7 + weekday);
      if (day < windowStart || day > today) {
        continue;
      }

      // Skip roughly one session in eight — travel, illness, life.
      if (random() < 0.12) {
        rotationIndex += 1;
        continue;
      }

      const template = ROTATION[rotationIndex % ROTATION.length];
      rotationIndex += 1;

      // Land the session mid-evening.
      day.setHours(18, Math.floor(random() * 50), 0, 0);
      const startTime = Math.floor(day.getTime() / 1000);

      const exercises = template.exercises.map((plan) =>
        buildExercise(plan, week, random)
      );

      const sets = exercises.reduce((total, exercise) => total + exercise.sets, 0);
      const totalReps = exercises.reduce(
        (total, exercise) => total + exercise.totalReps,
        0
      );
      const totalWeightKg = exercises.reduce(
        (total, exercise) =>
          total +
          exercise.entries.reduce(
            (sum, entry) => sum + entry.reps * entry.weightKg,
            0
          ),
        0
      );
      const durationSec = exercises.reduce(
        (total, exercise) =>
          total +
          exercise.entries.reduce(
            (sum, entry) => sum + entry.workSec + entry.restSec,
            0
          ),
        0
      );
      const calories = exercises.reduce(
        (total, exercise) =>
          total + exercise.entries.reduce((sum, entry) => sum + entry.calories, 0),
        0
      );
      const avgHr = 112 + Math.round(random() * 14);

      sessions.push({
        activityId: `sample-${startTime}`,
        sportType: 402,
        name: template.name,
        sportName: "Strength",
        startTime,
        duration: durationSec,
        calories,
        avgHr,
        maxHr: avgHr + 28 + Math.round(random() * 12),
        trainingLoad: Math.round(durationSec / 60 + sets * 1.6),
        detail: {
          summary: {
            sets,
            totalReps,
            totalWeightKg: Math.round(totalWeightKg),
            exercises: exercises.length,
            calories,
            durationSec,
            avgHr,
            maxHr: avgHr + 28,
            trainingLoad: Math.round(durationSec / 60 + sets * 1.6),
            aerobicEffect: 2.1 + random() * 0.9,
            anaerobicEffect: 1.4 + random() * 1.2
          },
          exercises
        }
      });
    }
  }

  return sessions.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
}
