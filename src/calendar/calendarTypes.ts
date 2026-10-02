import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";

/** A scheduled workout matched (or not) to the completed activity on the same day. */
export interface PlannedActualPair {
  scheduled: TrainingHubScheduledWorkoutEntry;
  activity?: TrainingHubActivity;
  /** actual / planned, in percent (load first, then distance, then duration). */
  completionPct?: number;
}

export interface CalendarDay {
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  scheduled: TrainingHubScheduledWorkoutEntry[];
  activities: TrainingHubActivity[];
  metric?: TrainingHubDailyMetric;
  pairs: PlannedActualPair[];
  /** Activities not matched to any scheduled workout. */
  unplannedActivities: TrainingHubActivity[];
}

export interface WeeklyStats {
  actualLoad: number;
  plannedLoad: number;
  activityTimeSeconds: number;
  distanceMeters: number;
  plannedDistanceKm: number;
  elevationGain: number;
  /** staminaLevel — COROS "Base Fitness". */
  baseFitness?: number;
  /** tiredRateNew — COROS "Load Impact". */
  loadImpact?: number;
  /** trainingLoadRatio — acute:chronic style load ratio (~1.0 = steady). */
  loadRatio?: number;
  /** COROS recommended weekly training-load band. */
  recommendedLoadMin?: number;
  recommendedLoadMax?: number;
}

export interface CalendarWeek {
  /** dateKey of the week's Monday. */
  key: string;
  days: CalendarDay[];
  stats: WeeklyStats;
}

export type CalendarMode = "month" | "week";

export type CalendarSelection =
  | { kind: "scheduled"; day: CalendarDay; entry: TrainingHubScheduledWorkoutEntry }
  | { kind: "activity"; day: CalendarDay; activity: TrainingHubActivity };

export type CalendarClipboardEntry = Pick<
  TrainingHubScheduledWorkoutEntry,
  "planId" | "idInPlan" | "happenDay" | "name" | "rawProgram"
>;

/** Keep copied workout content independent of later edits, moves or deletion. */
export function createCalendarClipboardEntry(
  entry: TrainingHubScheduledWorkoutEntry
): CalendarClipboardEntry {
  return {
    planId: entry.planId,
    idInPlan: entry.idInPlan,
    happenDay: entry.happenDay,
    name: entry.name,
    ...(entry.rawProgram ? { rawProgram: structuredClone(entry.rawProgram) } : {})
  };
}

/** Stable identity for selecting scheduled occurrences across calendar cells. */
export function scheduledWorkoutKey(
  entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan">
): string {
  return JSON.stringify([entry.planId, entry.idInPlan]);
}
