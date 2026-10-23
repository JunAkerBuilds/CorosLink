import { activityHappenDay, linkCompletionPct, resolveActivityLinks, scheduledLinkKey } from "./activityLinks";
import { formatUpcomingWorkoutSport } from "./chatCoachContext";
import { corosSportName } from "./corosSportTypes";
import { formatDistanceValue } from "./unitSystem";
import type {
  ManualActivityLink,
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "./types";

// Planned versus done, per scheduled workout, for the Coach. It pairs a
// workout with an activity only when COROS linked them (the workout was
// started from the plan on the watch) or the athlete linked them in the
// calendar: the same rule the calendar uses. A same-day activity nobody linked
// is listed beside the day, never counted, so the Coach asks rather than guesses.

export type ComplianceStatus = "done" | "partial" | "over" | "missed" | "skipped" | "today" | "upcoming";

export interface ComplianceWorkout {
  date: string;
  name: string;
  sport?: string;
  status: ComplianceStatus;
  plan_id: string;
  id_in_plan: string;
  planned?: { load?: number; volume?: string; duration?: string };
  /** Done as a share of the plan: COROS's own rate, else training load. */
  completion_pct?: number;
  linked_by?: "coros" | "athlete";
  activity?: ComplianceActivity;
}

export interface ComplianceActivity {
  activity_id: string;
  sport_type: number;
  name?: string;
  sport?: string;
  distance?: string;
  duration?: string;
  load?: number;
  avg_hr?: number;
}

export interface PlanComplianceReport {
  range: { start_date: string; end_date: string };
  workouts: ComplianceWorkout[];
  /** Activities on a day with planned workouts that nobody linked to one. */
  unlinked_activities: Array<ComplianceActivity & { date: string }>;
  summary: {
    planned: number;
    done: number;
    partial: number;
    over: number;
    missed: number;
    skipped: number;
    remaining: number;
    /** Done, partial or over among the workouts already due, in percent. */
    completion_rate_pct?: number;
    planned_load?: number;
    completed_load?: number;
  };
}

const PARTIAL_BELOW_PCT = 75;
const OVER_ABOVE_PCT = 125;

function isoDay(day: string): string {
  return /^\d{8}$/.test(day) ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` : day;
}

function clock(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function plannedSeconds(entry: TrainingHubScheduledWorkoutEntry): number | undefined {
  for (const key of ["planDuration", "duration", "estimatedTime"]) {
    const value = Number(entry.rawProgram?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function plannedDistanceKm(volume: string | undefined): number | undefined {
  const match = volume?.trim().match(/^([\d.]+)\s*km$/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function describeActivity(activity: TrainingHubActivity, unitSystem: UnitSystem): ComplianceActivity {
  const swim = activity.sportType === 300 || activity.sportType === 301;
  return {
    activity_id: activity.activityId,
    sport_type: activity.sportType,
    ...(activity.name ? { name: activity.name } : {}),
    ...(corosSportName(activity.sportType, activity.sportName) ? { sport: corosSportName(activity.sportType, activity.sportName) } : {}),
    ...(activity.distance ? { distance: formatDistanceValue(activity.distance, unitSystem, { swim }) } : {}),
    ...(clock(activity.duration) ? { duration: clock(activity.duration) } : {}),
    ...(activity.trainingLoad !== undefined ? { load: activity.trainingLoad } : {}),
    ...(activity.avgHr ? { avg_hr: activity.avgHr } : {})
  };
}

export function buildPlanCompliance(input: {
  scheduled: TrainingHubScheduledWorkoutEntry[];
  activities: TrainingHubActivity[];
  manualLinks: ManualActivityLink[];
  startDay: string;
  endDay: string;
  today: string;
  unitSystem?: UnitSystem;
}): PlanComplianceReport {
  const unitSystem = input.unitSystem ?? "metric";
  const scheduled = input.scheduled
    .filter((entry) => entry.happenDay >= input.startDay && entry.happenDay <= input.endDay)
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay) || (left.sortNo ?? 0) - (right.sortNo ?? 0));
  const links = resolveActivityLinks(scheduled, input.activities, input.manualLinks);
  const manual = new Map(input.manualLinks.map((link) => [scheduledLinkKey(link), link]));
  const linked = new Set([...links.values()].map((link) => link.activity.activityId));

  const workouts = scheduled.map((entry): ComplianceWorkout => {
    const key = scheduledLinkKey(entry);
    const link = links.get(key);
    const duration = clock(plannedSeconds(entry));
    const planned = {
      ...(entry.trainingLoad ? { load: entry.trainingLoad } : {}),
      ...(entry.volume ? { volume: entry.volume } : {}),
      ...(duration ? { duration } : {})
    };
    const base = {
      date: isoDay(entry.happenDay),
      name: entry.name,
      ...(formatUpcomingWorkoutSport(entry.sportType) ? { sport: formatUpcomingWorkoutSport(entry.sportType) } : {}),
      plan_id: entry.planId,
      id_in_plan: entry.idInPlan,
      ...(Object.keys(planned).length ? { planned } : {})
    };
    if (link) {
      const pct = linkCompletionPct(entry, link, plannedDistanceKm(entry.volume));
      const status: ComplianceStatus =
        pct === undefined ? "done" : pct < PARTIAL_BELOW_PCT ? "partial" : pct > OVER_ABOVE_PCT ? "over" : "done";
      return {
        ...base,
        status,
        ...(pct !== undefined ? { completion_pct: pct } : {}),
        linked_by: link.source === "coros" ? "coros" : "athlete",
        activity: describeActivity(link.activity, unitSystem)
      };
    }
    // The athlete said in the calendar that nothing belongs to this workout.
    const declined = manual.has(key) && !manual.get(key)?.activityId;
    const status: ComplianceStatus =
      entry.happenDay > input.today
        ? "upcoming"
        : declined
          ? "skipped"
          : entry.happenDay === input.today
            ? "today"
            : "missed";
    return { ...base, status };
  });

  const plannedDays = new Set(scheduled.map((entry) => entry.happenDay));
  const unlinked = input.activities
    .filter((activity) => !linked.has(activity.activityId))
    .map((activity) => ({ activity, day: activityHappenDay(activity) }))
    .filter((item): item is { activity: TrainingHubActivity; day: string } =>
      item.day !== undefined && plannedDays.has(item.day) && item.day <= input.today
    )
    .map(({ activity, day }) => ({ date: isoDay(day), ...describeActivity(activity, unitSystem) }));

  const count = (status: ComplianceStatus) => workouts.filter((workout) => workout.status === status).length;
  const due = workouts.filter((workout) => workout.status !== "upcoming" && workout.status !== "today");
  const completed = due.filter((workout) => ["done", "partial", "over"].includes(workout.status));
  const sumLoad = (values: Array<number | undefined>) => {
    const known = values.filter((value): value is number => value !== undefined);
    return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0)) : undefined;
  };
  const plannedLoad = sumLoad(due.map((workout) => workout.planned?.load));
  const completedLoad = sumLoad(completed.map((workout) => workout.activity?.load));
  return {
    range: { start_date: isoDay(input.startDay), end_date: isoDay(input.endDay) },
    workouts,
    unlinked_activities: unlinked,
    summary: {
      planned: workouts.length,
      done: count("done"),
      partial: count("partial"),
      over: count("over"),
      missed: count("missed"),
      skipped: count("skipped"),
      remaining: count("upcoming") + count("today"),
      ...(due.length ? { completion_rate_pct: Math.round((completed.length / due.length) * 100) } : {}),
      ...(plannedLoad !== undefined ? { planned_load: plannedLoad } : {}),
      ...(completedLoad !== undefined ? { completed_load: completedLoad } : {})
    }
  };
}
