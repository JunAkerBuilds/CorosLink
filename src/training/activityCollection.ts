import type { TrainingHubActivity } from "../../electron/types";
import { isCyclingSportType, isSwimSportType, resolveSportName } from "./sportTypes";

export type ActivityCategory = "all" | "run" | "ride" | "swim" | "walk" | "strength" | "other";
export type ActivitySort = "newest" | "oldest" | "distance" | "duration";

export function activityCategory(sport: number): Exclude<ActivityCategory, "all"> {
  if (sport >= 100 && sport <= 103) return "run";
  if (isCyclingSportType(sport)) return "ride";
  if (isSwimSportType(sport)) return "swim";
  if (sport === 900 || sport === 104) return "walk";
  if (sport === 402 || sport === 400) return "strength";
  return "other";
}

export function activityTimestamp(value?: number): number {
  return value && Number.isFinite(value) && value > 0
    ? value < 10_000_000_000 ? value * 1000 : value
    : 0;
}

export type LapPacing = "consistent" | "negative-split" | "positive-split";

/** Pacing story across timed laps: steady within ~4%, or faster/slower in the back half. */
export function lapPacing(laps: { distance?: number; duration?: number }[]): LapPacing | undefined {
  const paces = laps.filter(lap => lap.duration && lap.duration > 0 && lap.distance && lap.distance > 0)
    .map(lap => lap.duration! / lap.distance!);
  if (paces.length < 3) return undefined;
  const mean = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const spread = Math.sqrt(paces.reduce((sum, pace) => sum + (pace - mean) ** 2, 0) / paces.length) / mean;
  if (spread < 0.04) return "consistent";
  const half = Math.floor(paces.length / 2);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return average(paces.slice(-half)) < average(paces.slice(0, half)) ? "negative-split" : "positive-split";
}

export function selectActivities(
  activities: TrainingHubActivity[], category: ActivityCategory, query: string,
  sort: ActivitySort, sportNames: Map<number, string>
): TrainingHubActivity[] {
  const search = query.trim().toLocaleLowerCase();
  return activities.filter(activity =>
    (category === "all" || activityCategory(activity.sportType) === category) &&
    (!search || `${activity.name ?? ""} ${resolveSportName(activity, sportNames) ?? ""}`.toLocaleLowerCase().includes(search))
  ).sort((a, b) => {
    if (sort === "distance") return (b.distance ?? 0) - (a.distance ?? 0);
    if (sort === "duration") return (b.duration ?? 0) - (a.duration ?? 0);
    // Undated activities always follow dated activities.
    const aTime = activityTimestamp(a.startTime), bTime = activityTimestamp(b.startTime);
    if (!aTime || !bTime) return aTime ? -1 : bTime ? 1 : 0;
    return sort === "oldest" ? aTime - bTime : bTime - aTime;
  });
}

export function activityTotals(activities: TrainingHubActivity[]) {
  const sum = (key: "distance" | "duration" | "calories") => {
    const values = activities.map(activity => activity[key]).filter((value): value is number =>
      value !== undefined && Number.isFinite(value) && value >= 0);
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
  };
  // Running/walking pace is distance weighted; cycling and swimming use different units.
  const paced = activities.filter(activity =>
    ["run", "walk"].includes(activityCategory(activity.sportType)) &&
    Number.isFinite(activity.distance) && (activity.distance ?? 0) > 0 &&
    Number.isFinite(activity.duration) && (activity.duration ?? 0) > 0);
  const distance = paced.reduce((total, activity) => total + activity.distance!, 0);
  const duration = paced.reduce((total, activity) => total + activity.duration!, 0);
  return { count: activities.length, distance: sum("distance"), duration: sum("duration"),
    calories: sum("calories"), pace: distance > 0 ? duration / (distance / 1000) : undefined };
}

export function activityTimeline(activities: TrainingHubActivity[]) {
  const dated = activities.filter(activity => activityTimestamp(activity.startTime) > 0);
  const times = dated.map(activity => activityTimestamp(activity.startTime));
  const first = Math.min(...times), last = Math.max(...times);
  const buckets: TrainingHubActivity[][] = Array.from({ length: 10 }, () => []);
  for (const activity of dated) {
    const index = Math.min(9, Math.floor((activityTimestamp(activity.startTime) - first) / Math.max(1, last - first) * 10));
    buckets[index]!.push(activity);
  }
  return buckets.map(activityTotals);
}
