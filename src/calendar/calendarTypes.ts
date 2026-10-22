import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import type { ActivityLinkSource } from "../../electron/activityLinks";
import type { WorkoutJournalEntry } from "../../electron/workoutJournalTypes";
import type { WeekSportTotals } from "./weekSportBreakdown";

/** A scheduled workout and the activity COROS or the user linked to it, if any. */
export interface PlannedActualPair {
  scheduled: TrainingHubScheduledWorkoutEntry;
  activity?: TrainingHubActivity;
  /** Who linked them: COROS (started from the plan) or the user in CorosLink. */
  linkSource?: ActivityLinkSource;
  /** actual / planned, in percent (COROS's rate, else load, else distance). */
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
  /** Activities not linked to any scheduled workout. */
  unplannedActivities: TrainingHubActivity[];
  /** Briefs and debriefs saved for this day's workouts. */
  journal?: WorkoutJournalEntry[];
}

export interface WeeklyStats {
  actualLoad: number;
  plannedLoad: number;
  activityTimeSeconds: number;
  plannedTimeSeconds: number;
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
  /** Every sport done or planned this week, in display order. */
  sports: WeekSportTotals[];
}

export interface CalendarWeek {
  /** dateKey of the week's Monday. */
  key: string;
  days: CalendarDay[];
  stats: WeeklyStats;
}

export type CalendarMode = "month" | "week" | "agenda";

/** The grid layouts; the agenda lists the same month instead. */
export type CalendarGridMode = Exclude<CalendarMode, "agenda">;

/** Another view asking the calendar to show a day, optionally with one planned workout open. */
export interface CalendarNavigationRequest {
  happenDay: string;
  workout?: Pick<TrainingHubScheduledWorkoutEntry, "name" | "sortNo"> &
    Partial<Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan">>;
  requestId: number;
}

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
