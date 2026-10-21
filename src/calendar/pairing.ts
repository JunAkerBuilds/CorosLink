import type {
  ManualActivityLink,
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import {
  linkCompletionPct,
  resolveActivityLinks,
  scheduledLinkKey
} from "../../electron/activityLinks";
import { activityMovingSeconds } from "../../electron/activityTime";
import { parseUpcomingWorkoutDistanceKm } from "../training/formatters";
import type { CalendarDay, PlannedActualPair, WeeklyStats } from "./calendarTypes";
import { buildWeekSportBreakdown, scheduledPlannedSeconds } from "./weekSportBreakdown";

/**
 * Pair scheduled workouts with the activities COROS or the user linked to
 * them — never by guessing (see electron/activityLinks.ts). Run it over the
 * whole visible range: COROS may credit an activity from another day.
 */
export function pairPlannedWithActual(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[],
  manualLinks: ManualActivityLink[] = []
): { pairs: PlannedActualPair[]; unplanned: TrainingHubActivity[] } {
  const links = resolveActivityLinks(scheduled, activities, manualLinks);
  const linked = new Set([...links.values()].map((link) => link.activity.activityId));

  const pairs = scheduled.map((entry): PlannedActualPair => {
    const link = links.get(scheduledLinkKey(entry));
    return link
      ? {
          scheduled: entry,
          activity: link.activity,
          linkSource: link.source,
          completionPct: linkCompletionPct(entry, link, parseUpcomingWorkoutDistanceKm(entry.volume) ?? undefined)
        }
      : { scheduled: entry };
  });

  return { pairs, unplanned: activities.filter((activity) => !linked.has(activity.activityId)) };
}

function lastDefined<T>(
  metrics: (TrainingHubDailyMetric | undefined)[],
  pick: (metric: TrainingHubDailyMetric) => T | undefined
): T | undefined {
  for (let i = metrics.length - 1; i >= 0; i -= 1) {
    const metric = metrics[i];
    if (!metric) {
      continue;
    }
    const value = pick(metric);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

export function computeWeeklyStats(days: CalendarDay[]): WeeklyStats {
  let actualLoad = 0;
  let plannedLoad = 0;
  let activityTimeSeconds = 0;
  let plannedTimeSeconds = 0;
  let distanceMeters = 0;
  let plannedDistanceKm = 0;
  let elevationGain = 0;

  for (const day of days) {
    for (const activity of day.activities) {
      actualLoad += activity.trainingLoad ?? 0;
      activityTimeSeconds += activityMovingSeconds(activity) ?? 0;
      distanceMeters += activity.distance ?? 0;
      elevationGain += activity.elevationGain ?? 0;
    }
    for (const entry of day.scheduled) {
      plannedLoad += entry.trainingLoad ?? 0;
      plannedTimeSeconds += scheduledPlannedSeconds(entry);
      plannedDistanceKm += parseUpcomingWorkoutDistanceKm(entry.volume) ?? 0;
    }
  }

  const metrics = days.map((day) => day.metric);
  return {
    actualLoad: Math.round(actualLoad),
    plannedLoad: Math.round(plannedLoad),
    activityTimeSeconds,
    plannedTimeSeconds,
    distanceMeters,
    plannedDistanceKm,
    elevationGain: Math.round(elevationGain),
    baseFitness: lastDefined(metrics, (metric) => metric.staminaLevel),
    loadImpact: lastDefined(metrics, (metric) => metric.tiredRateNew),
    loadRatio: lastDefined(metrics, (metric) => metric.trainingLoadRatio),
    sports: buildWeekSportBreakdown(days)
  };
}
