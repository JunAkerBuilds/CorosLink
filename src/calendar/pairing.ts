import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import { parseUpcomingWorkoutDistanceKm } from "../training/formatters";
import type { CalendarDay, PlannedActualPair, WeeklyStats } from "./calendarTypes";

type SportBucket = "run" | "bike" | "swim" | "walk" | "strength" | "other";

function bucketFromName(name?: string): SportBucket | undefined {
  const normalized = (name ?? "").toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/(run|jog|track|marathon|5k|10k|tempo|interval)/.test(normalized)) {
    return "run";
  }
  if (/(ride|bike|cycl|spin)/.test(normalized)) {
    return "bike";
  }
  if (/swim/.test(normalized)) {
    return "swim";
  }
  if (/(walk|hike)/.test(normalized)) {
    return "walk";
  }
  if (/(strength|gym|weight|core)/.test(normalized)) {
    return "strength";
  }
  return "other";
}

function sportsCompatible(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity
): boolean {
  const plannedBucket = bucketFromName(scheduled.name);
  const actualBucket = bucketFromName(activity.sportName ?? activity.name);
  if (!plannedBucket || !actualBucket) {
    return true;
  }
  if (plannedBucket === "other" || actualBucket === "other") {
    return true;
  }
  // Walks often record what was planned as an easy run/recovery; keep those pairable.
  if (
    (plannedBucket === "run" && actualBucket === "walk") ||
    (plannedBucket === "walk" && actualBucket === "run")
  ) {
    return true;
  }
  return plannedBucket === actualBucket;
}

function completionPct(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity
): number | undefined {
  const plannedLoad = scheduled.trainingLoad;
  if (plannedLoad && plannedLoad > 0 && activity.trainingLoad !== undefined) {
    return Math.round((activity.trainingLoad / plannedLoad) * 100);
  }
  const plannedKm = parseUpcomingWorkoutDistanceKm(scheduled.volume);
  if (plannedKm && plannedKm > 0 && activity.distance !== undefined) {
    return Math.round((activity.distance / 1000 / plannedKm) * 100);
  }
  return undefined;
}

function matchScore(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity
): number {
  const plannedLoad = scheduled.trainingLoad;
  if (plannedLoad && plannedLoad > 0 && activity.trainingLoad !== undefined) {
    return Math.abs(activity.trainingLoad - plannedLoad) / plannedLoad;
  }
  const plannedKm = parseUpcomingWorkoutDistanceKm(scheduled.volume);
  if (plannedKm && plannedKm > 0 && activity.distance !== undefined) {
    return Math.abs(activity.distance / 1000 - plannedKm) / plannedKm;
  }
  return 1;
}

/**
 * Greedy per-day matching of scheduled workouts to completed activities.
 * Each activity is consumed by at most one scheduled workout.
 */
export function pairPlannedWithActual(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[]
): { pairs: PlannedActualPair[]; unplanned: TrainingHubActivity[] } {
  const remaining = [...activities];
  const pairs: PlannedActualPair[] = [];

  for (const entry of scheduled) {
    const candidates = remaining
      .filter((activity) => sportsCompatible(entry, activity))
      .sort((left, right) => matchScore(entry, left) - matchScore(entry, right));
    const best = candidates[0];

    if (best) {
      remaining.splice(remaining.indexOf(best), 1);
      pairs.push({
        scheduled: entry,
        activity: best,
        completionPct: completionPct(entry, best)
      });
    } else {
      pairs.push({ scheduled: entry });
    }
  }

  return { pairs, unplanned: remaining };
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
  let distanceMeters = 0;
  let plannedDistanceKm = 0;
  let elevationGain = 0;

  for (const day of days) {
    for (const activity of day.activities) {
      actualLoad += activity.trainingLoad ?? 0;
      activityTimeSeconds += activity.duration ?? 0;
      distanceMeters += activity.distance ?? 0;
      elevationGain += activity.elevationGain ?? 0;
    }
    for (const entry of day.scheduled) {
      plannedLoad += entry.trainingLoad ?? 0;
      plannedDistanceKm += parseUpcomingWorkoutDistanceKm(entry.volume) ?? 0;
    }
  }

  const metrics = days.map((day) => day.metric);
  return {
    actualLoad: Math.round(actualLoad),
    plannedLoad: Math.round(plannedLoad),
    activityTimeSeconds,
    distanceMeters,
    plannedDistanceKm,
    elevationGain: Math.round(elevationGain),
    baseFitness: lastDefined(metrics, (metric) => metric.staminaLevel),
    loadImpact: lastDefined(metrics, (metric) => metric.tiredRateNew),
    loadRatio: lastDefined(metrics, (metric) => metric.trainingLoadRatio)
  };
}
