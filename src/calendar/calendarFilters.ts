import type { TrainingHubActivity } from "../../electron/types";
import type { CalendarDay, PlannedActualPair } from "./calendarTypes";
import {
  activitySportFamily,
  scheduledSportFamily,
  WEEK_SPORT_FAMILY_META,
  type WeekSportFamily
} from "./weekSportBreakdown";

/**
 * What the calendar shows. "planned" keeps every workout from the plan (done
 * or not) and drops freestyle activities; "completed" keeps every recorded
 * activity and drops plans nobody did yet.
 */
export type CalendarEntryKind = "all" | "planned" | "completed";

export interface CalendarFilter {
  kind: CalendarEntryKind;
  /** Hidden rather than shown, so a sport the user never saw stays visible. */
  hiddenSports: WeekSportFamily[];
}

export const CALENDAR_ENTRY_KINDS: readonly CalendarEntryKind[] = ["all", "planned", "completed"];

export const CALENDAR_SPORT_FAMILIES = Object.keys(WEEK_SPORT_FAMILY_META) as WeekSportFamily[];

export const DEFAULT_CALENDAR_FILTER: CalendarFilter = { kind: "all", hiddenSports: [] };

export function isCalendarFilter(value: unknown): value is CalendarFilter {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    CALENDAR_ENTRY_KINDS.includes(candidate.kind as CalendarEntryKind) &&
    Array.isArray(candidate.hiddenSports) &&
    candidate.hiddenSports.every((sport) => CALENDAR_SPORT_FAMILIES.includes(sport as WeekSportFamily)) &&
    new Set(candidate.hiddenSports).size === candidate.hiddenSports.length
  );
}

export function isCalendarFilterActive(filter: CalendarFilter): boolean {
  return filter.kind !== "all" || filter.hiddenSports.length > 0;
}

/** A pair counts as the sport that was done, else the sport that was planned. */
export function pairSportFamily(pair: PlannedActualPair): WeekSportFamily {
  return pair.activity
    ? activitySportFamily(pair.activity.sportType)
    : scheduledSportFamily(pair.scheduled.sportType);
}

export function activityFamily(activity: TrainingHubActivity): WeekSportFamily {
  return activitySportFamily(activity.sportType);
}

function keepsPair(pair: PlannedActualPair, kind: CalendarEntryKind): boolean {
  return kind !== "completed" || Boolean(pair.activity);
}

/**
 * The day with hidden entries left out of `pairs`, `unplannedActivities` and `externalWorkouts`
 * (what the calendar draws). `scheduled` and `activities` stay whole, so day
 * actions such as copy and the week totals still see everything.
 */
export function filterCalendarDay(day: CalendarDay, filter: CalendarFilter): CalendarDay {
  if (!isCalendarFilterActive(filter)) return day;
  const hidden = new Set(filter.hiddenSports);
  return {
    ...day,
    pairs: day.pairs.filter((pair) => keepsPair(pair, filter.kind) && !hidden.has(pairSportFamily(pair))),
    unplannedActivities:
      filter.kind === "planned"
        ? []
        : day.unplannedActivities.filter((activity) => !hidden.has(activityFamily(activity))),
    externalWorkouts:
      filter.kind === "planned"
        ? []
        : day.externalWorkouts.filter((session) => !hidden.has(activitySportFamily(session.sportType)))
  };
}

/** Entries per sport among `days` for the given kind, in display order. */
export function countCalendarSports(
  days: CalendarDay[],
  kind: CalendarEntryKind
): Array<{ family: WeekSportFamily; count: number }> {
  const counts = new Map<WeekSportFamily, number>();
  const add = (family: WeekSportFamily) => counts.set(family, (counts.get(family) ?? 0) + 1);
  for (const day of days) {
    for (const pair of day.pairs) if (keepsPair(pair, kind)) add(pairSportFamily(pair));
    if (kind !== "planned") {
      for (const activity of day.unplannedActivities) add(activityFamily(activity));
      for (const session of day.externalWorkouts) add(activitySportFamily(session.sportType));
    }
  }
  return CALENDAR_SPORT_FAMILIES.filter((family) => counts.has(family)).map((family) => ({
    family,
    count: counts.get(family)!
  }));
}

export function countCalendarEntries(days: CalendarDay[]): number {
  return days.reduce((total, day) => total + day.pairs.length + day.unplannedActivities.length + day.externalWorkouts.length, 0);
}
