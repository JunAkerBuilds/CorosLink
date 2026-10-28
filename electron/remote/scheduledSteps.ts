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
  | { open: Record<string, never> };

export interface WireStep {
  kind: 1 | 2 | 3 | 4;
  target: WireTarget;
  metric?: 1 | 2 | 4;
  intensity?: { range: { low: number; high: number } };
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

/** Only sports whose steps are distances, times and paces: runs, rides and trail runs. */
const STEP_SPORTS = new Set([1, 2, 5]);

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

/**
 * One COROS exercise as a step. exerciseType 1 warm-up, 2 training, 3 cool-down,
 * 4 rest; targetType 1 open, 2 seconds, 5 centimetres, 8 ascent in centimetres;
 * intensityType 2 heart rate (bpm), 3 pace (seconds per km, `paceDivisor`),
 * 6 power (W); a target stored as 0 is none (a Runna step's pace is in its name).
 * A percentage, zone preset or any other intensity is left to the workout as a whole: null.
 */
export function wireStep(exercise: Record<string, unknown>): WireStep | null {
  const kind = ({ 1: 1, 2: 2, 3: 4, 4: 3 } as const)[num(exercise.exerciseType) as 1 | 2 | 3 | 4];
  if (!kind) return null;
  const value = num(exercise.targetValue);
  let target: WireTarget;
  switch (num(exercise.targetType)) {
    case 0:
    case 1: target = { open: {} }; break;
    case 2: if (value <= 0) return null; target = { time: { seconds: value } }; break;
    case 5: if (value <= 0) return null; target = { distance: { meters: value / 100 } }; break;
    case 8: if (value <= 0) return null; target = { ascent: { meters: value / 100 } }; break;
    default: return null;
  }
  const note = stepNote(exercise);
  const plain: WireStep = { kind, target, ...(note ? { note } : {}) };
  const type = num(exercise.intensityType);
  if (type === 0) return plain;
  if (exercise.isIntensityPercent === true || num(exercise.intensityCustom) !== 0) return null;
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
  return null;
}

/** Seconds per km a pace step can mean: 1:00 to 60:00 per km. */
const PACE_SECONDS = [60, 3600];

/**
 * What a pace's values are divided by to give seconds per km. COROS writes
 * milliseconds with `intensityMultiplier` 1000; Runna writes seconds (300 for
 * 5:00/km). The one that gives a pace a runner can hold wins; null when neither does.
 */
export function paceDivisor(low: number, high: number, multiplier: number): number | null {
  const fits = (divisor: number) => [low, high].every((value) => value / divisor >= PACE_SECONDS[0]! && value / divisor <= PACE_SECONDS[1]!);
  return [multiplier || 1000, 1].find(fits) ?? null;
}

/** A program's steps in order, a repeat group's members under it; null when one can't be shown exactly. */
export function wireBlocks(program: Record<string, unknown> | undefined): WireBlock[] | null {
  if (!program || !STEP_SPORTS.has(num(program.sportType))) return null;
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
      const members = exercises.filter((member) => member.isGroup !== true && groupOf(member) === id(exercise)).map(wireStep);
      if (!members.length || members.some((member) => member === null)) return null;
      blocks.push({ repeats: { times: Math.max(1, Math.round(num(exercise.sets))), steps: members as WireStep[] } });
    } else if (groupOf(exercise) === "0" || groupOf(exercise) === "" || !groups.has(groupOf(exercise))) {
      const step = wireStep(exercise);
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
