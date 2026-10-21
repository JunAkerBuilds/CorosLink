import type {
  ManualActivityLink,
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry
} from "./types";

// Which activity completed which scheduled workout, shared by the calendar
// (renderer) and the Training Library (main). Type-only imports keep it
// loadable by Node's strip-types test runner.
//
// There is no guessing: a workout pairs with an activity only when COROS
// linked them (`entity.sportData`, set when the workout was started from the
// plan on the watch) or the user linked them in CorosLink. Everything else
// stays apart, the way COROS's own calendar shows it.

export type ActivityLinkSource = "coros" | "manual";

export interface ResolvedActivityLink {
  activity: TrainingHubActivity;
  source: ActivityLinkSource;
}

export function scheduledLinkKey(entry: { planId: string; idInPlan: string }): string {
  return `${entry.planId}:${entry.idInPlan}`;
}

function startSeconds(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value > 10_000_000_000 ? Math.round(value / 1000) : value;
}

/** Local YYYYMMDD of an activity's start. */
export function activityHappenDay(activity: Pick<TrainingHubActivity, "startTime">): string | undefined {
  const seconds = startSeconds(activity.startTime);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function findCorosActivity(
  entry: TrainingHubScheduledWorkoutEntry,
  activities: TrainingHubActivity[]
): TrainingHubActivity | undefined {
  const link = entry.corosActivity;
  if (!link) return undefined;
  if (link.activityId) {
    const byId = activities.find((activity) => activity.activityId === link.activityId);
    if (byId) return byId;
  }
  const start = startSeconds(link.startTime);
  return start === undefined
    ? undefined
    : activities.find((activity) => {
        const candidate = startSeconds(activity.startTime);
        return candidate !== undefined && Math.abs(candidate - start) <= 1;
      });
}

/**
 * Pair each scheduled workout with the activity COROS or the user linked to
 * it, keyed by `scheduledLinkKey`. A manual link wins over COROS's, and a
 * manual link with no activity means "nothing belongs here" (it hides COROS's
 * link too). Manual links only count when the activity is on the workout's day,
 * so a workout moved to another day drops its old link. Each activity belongs
 * to at most one workout.
 */
export function resolveActivityLinks(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[],
  manualLinks: ManualActivityLink[] = []
): Map<string, ResolvedActivityLink> {
  const manualByKey = new Map(manualLinks.map((link) => [scheduledLinkKey(link), link]));
  const links = new Map<string, ResolvedActivityLink>();
  const used = new Set<string>();
  const decided = new Set<string>();

  for (const entry of scheduled) {
    const key = scheduledLinkKey(entry);
    const manual = manualByKey.get(key);
    if (!manual) continue;
    if (!manual.activityId) {
      decided.add(key);
      continue;
    }
    const activity = activities.find((candidate) => candidate.activityId === manual.activityId);
    if (!activity || used.has(activity.activityId) || activityHappenDay(activity) !== entry.happenDay) {
      continue;
    }
    links.set(key, { activity, source: "manual" });
    used.add(activity.activityId);
    decided.add(key);
  }

  for (const entry of scheduled) {
    const key = scheduledLinkKey(entry);
    if (decided.has(key)) continue;
    const activity = findCorosActivity(entry, activities);
    if (!activity || used.has(activity.activityId)) continue;
    links.set(key, { activity, source: "coros" });
    used.add(activity.activityId);
  }

  return links;
}

/** Percent of the plan done: COROS's own rate when it linked them, else load, else distance. */
export function linkCompletionPct(
  entry: TrainingHubScheduledWorkoutEntry,
  link: ResolvedActivityLink,
  plannedDistanceKm?: number
): number | undefined {
  const rate = entry.corosActivity?.completeRate;
  if (link.source === "coros" && rate !== undefined) {
    return Math.round(rate * 100);
  }
  const plannedLoad = entry.trainingLoad;
  if (plannedLoad && plannedLoad > 0 && link.activity.trainingLoad !== undefined) {
    return Math.round((link.activity.trainingLoad / plannedLoad) * 100);
  }
  if (plannedDistanceKm && plannedDistanceKm > 0 && link.activity.distance !== undefined) {
    return Math.round((link.activity.distance / 1000 / plannedDistanceKm) * 100);
  }
  return undefined;
}
