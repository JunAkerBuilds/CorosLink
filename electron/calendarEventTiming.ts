import type { TrainingHubScheduledWorkoutEntry } from "./types";
import { defaultCalendarEventTiming, type CalendarEventTiming } from "./calendarSyncTypes";

export function validateCalendarEventTiming(input?: CalendarEventTiming): CalendarEventTiming {
  if (input === undefined) return defaultCalendarEventTiming();
  if (!input || !["all-day", "timed"].includes(input.mode) ||
      typeof input.startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ||
      typeof input.timeZone !== "string" || !input.timeZone || input.timeZone.length > 100 ||
      !Number.isInteger(input.fallbackDurationMinutes) ||
      input.fallbackDurationMinutes < 1 || input.fallbackDurationMinutes > 1440) {
    throw new Error("Choose an event format, valid start time, time zone, and fallback duration from 1 to 1440 minutes.");
  }
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }); }
  catch { throw new Error("Choose a valid time zone, such as America/Toronto."); }
  return {
    mode: input.mode, startTime: input.startTime, timeZone: input.timeZone,
    fallbackDurationMinutes: input.fallbackDurationMinutes,
  };
}

/** Convert a wall time using the zone's offset on that date, not today's offset.
 * Ambiguous times use the first occurrence; missing times advance across the DST gap. */
export function calendarWallTime(day: string, time: string, timeZone: string): number {
  const wall = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const local = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  const offsets = new Set([-86400000, 0, 86400000].map(delta => local(wall + delta) - (wall + delta)));
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  const exact = candidates.find(instant => local(instant) === wall);
  const result = exact ?? candidates.filter(instant => local(instant) > wall)
    .sort((a, b) => local(a) - local(b))[0];
  if (!Number.isFinite(result)) throw new Error("Unable to determine the workout start time.");
  return result;
}

const positiveSeconds = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 7 * 86400 ? seconds : undefined;
};

/** Prefer COROS's complete estimate. Never mistake only the timed recovery
 * steps in a distance/open-ended workout for its total duration. */
export function expectedWorkoutSeconds(workout: TrainingHubScheduledWorkoutEntry): number | undefined {
  const program = workout.rawProgram;
  if (!program) return undefined;
  for (const key of ["planDuration", "duration"]) {
    const seconds = positiveSeconds(program[key]);
    if (seconds) return seconds;
  }
  const exercises = Array.isArray(program.exercises) ? program.exercises : [];
  if (!exercises.length) return positiveSeconds(program.estimatedTime) ??
    (Number(program.targetType) === 2 ? positiveSeconds(program.targetValue) : undefined);
  if (exercises.some(step => !step || typeof step !== "object")) return undefined;
  const steps = exercises as Record<string, unknown>[];
  const groups = new Map(steps.filter(step => step.isGroup).map(step => [String(step.id), step]));
  const leaves = steps.filter(step => !step.isGroup);
  if (!leaves.length || [...groups.values()].some(group =>
    !leaves.some(step => String(step.groupId) === String(group.id)))) return undefined;
  let total = 0;
  for (const step of leaves) {
    const seconds = Number(step.targetType) === 2 ? positiveSeconds(step.targetValue) : undefined;
    if (!seconds) return undefined;
    const group = groups.get(String(step.groupId));
    if (step.groupId && String(step.groupId) !== "0" && !group) return undefined;
    const repeats = Number(group?.sets ?? step.sets ?? 1);
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 99) return undefined;
    total += seconds * repeats;
  }
  return positiveSeconds(total);
}

export interface CalendarTimedEvent {
  startTime?: string;
  endTime?: string;
  timingKey?: string;
  durationSeconds?: number;
}

/** Retain calendar moves/resizes until the source day or timing defaults change.
 * Updated workout estimates resize only events the user has not resized. */
export function reconcileCalendarTiming(remote: CalendarTimedEvent, desired: CalendarTimedEvent): CalendarTimedEvent {
  if (!desired.startTime || !desired.timingKey || remote.timingKey !== desired.timingKey ||
      !remote.startTime || !remote.endTime) return desired;
  const start = Date.parse(remote.startTime), end = Date.parse(remote.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return desired;
  return {
    ...desired,
    startTime: new Date(start).toISOString(),
    endTime: new Date(remote.durationSeconds && desired.durationSeconds &&
      end - start === remote.durationSeconds * 1000
        ? start + desired.durationSeconds * 1000 : end).toISOString(),
  };
}
