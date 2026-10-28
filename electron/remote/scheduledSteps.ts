// Planned workouts' steps and descriptions for a phone (`training.scheduledSteps`):
// COROS's own programs from Training Hub, in C-LINK's step shape. COROS MCP leaves out a
// workout whose paces aren't whole seconds per km (a plan in miles, a partner
// app's paces); Training Hub keeps them to the millisecond, so the phone can
// show those workouts whole.
//
// The shape is Swift's Codable of CorosKit's `TrainingSchedule.Block` and
// `TrainingSchedule.Step` (Android reads the same JSON):
//   {"step":{"_0":{"kind":2,"target":{"distance":{"meters":800}},"metric":2,"intensity":{"range":{"low":240,"high":250}}}}}
//   {"repeats":{"times":6,"steps":[…]}}
// A workout with any step C-LINK can't show exactly gets `steps: null`, never
// a step with its target left out.

import { decodeCorosPercent, paceDivisor, SWIM_STROKE_IDS, workoutExerciseName } from "../workoutCapabilities";

export interface ScheduledProgram {
  /** YYYYMMDD */
  happenDay: string;
  idInPlan?: string;
  planId?: string;
  program?: Record<string, unknown>;
}

export type WireTarget =
  | { distance: { meters: number } }
  | { time: { seconds: number } }
  | { ascent: { meters: number } }
  | { open: Record<string, never> }
  | { reps: { count: number } };

export interface WireStep {
  kind: 1 | 2 | 3 | 4;
  target: WireTarget;
  metric?: 1 | 2 | 3 | 4;
  intensity?: { range: { low: number; high: number } } | { percent: { low: number; high: number } };
  /** The coach's own name for the step, word for word ("2km at 5:10/km"). */
  note?: string;
}

export type WireBlock = { step: { _0: WireStep } } | { repeats: { times: number; steps: WireStep[] } };

export interface ScheduledStepsRow {
  /** YYYY-MM-DD, as C-LINK's calendar days are written. */
  day: string;
  idInPlan: string;
  planId?: string;
  steps: WireBlock[] | null;
  /** The workout's description as its coach wrote it (the program's `overview`), when it has one. */
  description?: string;
}

/** The longest range one call reads (two of COROS MCP's 28-day windows and a little). */
export const SCHEDULED_STEPS_MAX_DAYS = 62;

const num = (value: unknown): number => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

/** Sports whose steps name an exercise (a gym's squats, a HYROX station) rather than a distance or time. */
const EXERCISE_SPORTS = new Set([4, 9]);

const STROKE_NAMES: Readonly<Record<number, string>> = {
  [SWIM_STROKE_IDS.freestyle]: "Freestyle",
  [SWIM_STROKE_IDS.breaststroke]: "Breaststroke",
  [SWIM_STROKE_IDS.backstroke]: "Backstroke",
  [SWIM_STROKE_IDS.butterfly]: "Butterfly",
  [SWIM_STROKE_IDS.drills]: "Drills",
  [SWIM_STROKE_IDS.individualMedley]: "Individual medley",
  [SWIM_STROKE_IDS.mix]: "Mixed strokes"
};

/** COROS's `hrType` for a percentage of lactate threshold heart rate, the one threshold C-LINK names. */
const HR_TYPE_LTHR = 3;

/**
 * The step's name when a coach wrote one: Runna names each step with its pace
 * ("2km at 5:10/km") and stores the pace itself as 0. COROS's defaults
 * ("Training", "sid_run_training") and built-in name keys ("T1234") say nothing more.
 */
function stepNote(exercise: Record<string, unknown>): string | undefined {
  const name = typeof exercise.name === "string" ? exercise.name.trim() : "";
  if (!name || /^sid_/i.test(name) || /^T\d{4,9}$/.test(name)) return undefined;
  if (/^(warm[\s-]?up|training|cool[\s-]?down|rest|recovery|run|interval)$/i.test(name)) return undefined;
  return name.slice(0, 200);
}

/** "Squats @ 20 kg", "Push-ups" for bodyweight: a gym step's exercise and its weight, as C-LINK shows it. */
function exerciseNote(exercise: Record<string, unknown>, sportType: number): string | undefined {
  const name = EXERCISE_SPORTS.has(sportType) ? workoutExerciseName(exercise) : "";
  const named = name && !/^[TS]\d+$/i.test(name) && !/^sid_/i.test(name) ? name.slice(0, 200) : stepNote(exercise);
  if (num(exercise.intensityType) !== 1 || num(exercise.intensityCustom) === 1) return named;
  const kg = num(exercise.intensityValue);
  if (kg <= 0) return named;
  const pounds = num(exercise.intensityDisplayUnit) === 7;
  const weight = `${Number((pounds ? kg * 2.2046226218 : kg).toFixed(1))} ${pounds ? "lb" : "kg"}`;
  return named ? `${named} @ ${weight}` : weight;
}

/**
 * One COROS exercise as a step. exerciseType 1 warm-up, 2 training, 3 cool-down,
 * 4 rest; targetType 1 open, 2 seconds, 3 reps, 5 centimetres, 8 ascent in centimetres;
 * intensityType 1 weight (kg, in the note), 2 heart rate (bpm, or % of LTHR),
 * 3 pace (seconds per km, `paceDivisor`, or % of threshold pace), 4 speed (km/h × 100,
 * a ride's), 5 swim stroke (in the note), 6 power (W), 9 % of FTP; a target stored as 0
 * is none (a Runna step's pace is in its name). Any other intensity, or a percentage of
 * something C-LINK can't name, is left to the workout as a whole: null.
 */
export function wireStep(exercise: Record<string, unknown>, sportType = 1): WireStep | null {
  const kind = ({ 1: 1, 2: 2, 3: 4, 4: 3 } as const)[num(exercise.exerciseType) as 1 | 2 | 3 | 4];
  if (!kind) return null;
  const value = num(exercise.targetValue);
  let target: WireTarget;
  switch (num(exercise.targetType)) {
    case 0:
    case 1: target = { open: {} }; break;
    case 2: if (value <= 0) return null; target = { time: { seconds: value } }; break;
    case 3: if (value <= 0) return null; target = { reps: { count: Math.round(value) } }; break;
    case 5: if (value <= 0) return null; target = { distance: { meters: value / 100 } }; break;
    case 8: if (value <= 0) return null; target = { ascent: { meters: value / 100 } }; break;
    default: return null;
  }
  const type = num(exercise.intensityType);
  const stroke = type === 5 ? STROKE_NAMES[num(exercise.intensityValue)] : undefined;
  const note = exerciseNote(exercise, sportType) ?? stroke;
  const plain: WireStep = { kind, target, ...(note ? { note } : {}) };
  if (type === 0 || type === 1 || (type === 5 && num(exercise.intensityValue) === 0)) return plain;
  if (type === 5) return stroke ? plain : null;
  if (exercise.isIntensityPercent === true) {
    const metric = type === 3 ? 3 : type === 9 ? 4 : type === 2 && num(exercise.hrType) === HR_TYPE_LTHR ? 1 : undefined;
    const lowPercent = decodeCorosPercent(exercise.intensityPercent) ?? 0;
    const highPercent = decodeCorosPercent(exercise.intensityPercentExtend) || lowPercent;
    if (!metric || lowPercent <= 0) return null;
    return { ...plain, metric, intensity: { percent: { low: Math.min(lowPercent, highPercent), high: Math.max(lowPercent, highPercent) } } };
  }
  if (num(exercise.intensityCustom) !== 0) return null;
  const low = num(exercise.intensityValue);
  const high = num(exercise.intensityValueExtend) || low;
  if (low === 0 && high === 0 && [2, 3, 6].includes(type)) return plain;
  if (low <= 0) return null;
  const range = (divisor: number) => ({ range: { low: Math.min(low, high) / divisor, high: Math.max(low, high) / divisor } });
  if (type === 2) return { ...plain, metric: 1, intensity: range(1) };
  if (type === 3) {
    const divisor = paceDivisor(low, high, num(exercise.intensityMultiplier));
    return divisor ? { ...plain, metric: 2, intensity: range(divisor) } : null;
  }
  if (type === 6) return { ...plain, metric: 4, intensity: range(1) };
  // A ride's speed as the pace C-LINK shows back as km/h: seconds per km, the faster end low.
  if (type === 4 && sportType === 2) {
    const [slow, fast] = [Math.min(low, high) / 100, Math.max(low, high) / 100];
    return { ...plain, metric: 2, intensity: { range: { low: 3600 / fast, high: 3600 / slow } } };
  }
  return null;
}

/** A program's steps in order, a repeat group's members under it; null when one can't be shown exactly. */
export function wireBlocks(program: Record<string, unknown> | undefined): WireBlock[] | null {
  if (!program) return null;
  const sportType = num(program.sportType) || 1;
  const exercises = Array.isArray(program.exercises)
    ? (program.exercises as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  if (!exercises.length) return null;
  const id = (exercise: Record<string, unknown>) => String(exercise.id ?? "");
  const groupOf = (exercise: Record<string, unknown>) => String(exercise.groupId ?? "0");
  const groups = new Set(exercises.filter((exercise) => exercise.isGroup === true).map(id));
  const blocks: WireBlock[] = [];
  for (const exercise of exercises) {
    if (exercise.isGroup === true) {
      const members = exercises.filter((member) => member.isGroup !== true && groupOf(member) === id(exercise)).map((member) => wireStep(member, sportType));
      if (!members.length || members.some((member) => member === null)) return null;
      blocks.push({ repeats: { times: Math.max(1, Math.round(num(exercise.sets))), steps: members as WireStep[] } });
    } else if (groupOf(exercise) === "0" || groupOf(exercise) === "" || !groups.has(groupOf(exercise))) {
      const step = wireStep(exercise, sportType);
      if (!step) return null;
      blocks.push({ step: { _0: step } });
    }
  }
  return blocks.length ? blocks : null;
}

/** `{startDay, endDay}` as YYYYMMDD, at most `SCHEDULED_STEPS_MAX_DAYS` apart; null when invalid. */
export function scheduledStepsRange(params: Record<string, unknown>): { startDay: string; endDay: string } | null {
  const { startDay, endDay } = params;
  if (typeof startDay !== "string" || typeof endDay !== "string" || !/^\d{8}$/.test(startDay) || !/^\d{8}$/.test(endDay)) return null;
  const date = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  const days = (date(endDay) - date(startDay)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 && days < SCHEDULED_STEPS_MAX_DAYS ? { startDay, endDay } : null;
}

/** A program's own description: its `overview`, without COROS's built-in `sid_` keys. */
export function programDescription(program: Record<string, unknown> | undefined): string | undefined {
  const text = typeof program?.overview === "string" ? program.overview.trim() : "";
  return text && !/^sid_\w+$/.test(text) ? text.slice(0, 4000) : undefined;
}

export function scheduledStepsRows(programs: ScheduledProgram[]): ScheduledStepsRow[] {
  return programs
    .filter((entry) => /^\d{8}$/.test(entry.happenDay) && entry.idInPlan)
    .map((entry) => ({
      day: `${entry.happenDay.slice(0, 4)}-${entry.happenDay.slice(4, 6)}-${entry.happenDay.slice(6, 8)}`,
      idInPlan: entry.idInPlan!,
      ...(entry.planId ? { planId: entry.planId } : {}),
      steps: wireBlocks(entry.program),
      ...(programDescription(entry.program) ? { description: programDescription(entry.program) } : {})
    }));
}
