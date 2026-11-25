// Synced items → calendar entries and week totals. Pure: plain item bodies and `now` in.
import type { CalendarEntry, CalendarSport, WeekTotals } from "@/data/training";
import { mondayOf } from "@/lib/calendar";
import { activityDetail, dayTotals, isRunning, placeActivities } from "./dashboard";
import { SPORT_TITLE } from "./geo";
import { calendarDayKey, type NativeActivity, type NativeDayVitals, type NativeGymPlanned, type NativeGymRoutine, type NativeSport } from "./native";

/** Where each of the phone's sports sits on the calendar. Walks, hikes, skiing, rowing and multisport are "other", not runs. */
const CALENDAR_SPORT: Record<NativeSport, CalendarSport> = {
  run: "run", indoorRun: "run", trailRun: "run", track: "run",
  bike: "ride", indoorBike: "ride", poolSwim: "swim", openWater: "swim", strength: "strength", cardio: "strength",
  walk: "other", hike: "other", ski: "other", row: "other", multisport: "other", other: "other",
};

export const calendarSport = (sport: NativeSport): CalendarSport => CALENDAR_SPORT[sport] ?? "other";

/**
 * Recorded activities (done, each opening its page) and gym routines put on a day (planned), oldest first.
 * A plan whose day is missing is left out; one whose routine is not there is named "Gym workout".
 */
export function syncedEntries(
  activities: readonly NativeActivity[], planned: readonly NativeGymPlanned[], routines: readonly NativeGymRoutine[], now: Date,
): CalendarEntry[] {
  const done: CalendarEntry[] = placeActivities(activities, now).reverse().map((p) => ({
    id: `synced-${p.a.id}`,
    date: p.day,
    sport: calendarSport(p.a.sport),
    name: p.a.name || SPORT_TITLE[p.a.sport] || "Workout",
    detail: activityDetail(p.a),
    status: "done",
    source: "synced",
    activityId: p.a.id,
    metres: p.a.distanceMeters && p.a.distanceMeters > 0 ? p.a.distanceMeters : undefined,
    seconds: p.a.durationSeconds && p.a.durationSeconds > 0 ? p.a.durationSeconds : undefined,
    load: p.a.trainingLoad != null && p.a.trainingLoad > 0 ? Math.round(p.a.trainingLoad) : undefined,
    elevation: p.a.elevationGain != null && p.a.elevationGain > 0 ? p.a.elevationGain : undefined,
  }));
  const routineOf = new Map(routines.map((r) => [r.id, r]));
  const plans: CalendarEntry[] = planned
    .filter((p) => p.day && Number.isFinite(p.day.year) && Number.isFinite(p.day.month) && Number.isFinite(p.day.day))
    .map((p) => {
      const routine = routineOf.get(p.routineID);
      const count = routine?.entries?.length ?? 0;
      return {
        id: `synced-plan-${p.id}`,
        date: calendarDayKey(p.day),
        sport: "strength" as const,
        name: routine?.name || "Gym workout",
        detail: count ? `${count} ${count === 1 ? "exercise" : "exercises"}` : "",
        status: "planned" as const,
        source: "synced" as const,
        planned: p,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return [...done, ...plans];
}

/**
 * Totals of each Monday week that holds a recorded activity: time, running distance and load
 * (each activity's own training load; a day whose activities carry none takes the day's reading).
 */
export function syncedWeeks(activities: readonly NativeActivity[], days: readonly NativeDayVitals[], now: Date): WeekTotals[] {
  const placed = placeActivities(activities, now);
  const weeks = new Map<string, WeekTotals>();
  const week = (day: string) => {
    const monday = mondayOf(day);
    let w = weeks.get(monday);
    if (!w) weeks.set(monday, (w = { weekStart: monday, timeSeconds: 0, runMetres: 0, load: 0, plannedLoad: null }));
    return w;
  };
  for (const p of placed) {
    const w = week(p.day);
    w.timeSeconds = (w.timeSeconds ?? 0) + Math.max(0, p.a.durationSeconds ?? 0);
    if (isRunning(p.a.sport)) w.runMetres += Math.max(0, p.a.distanceMeters ?? 0);
  }
  for (const [day, total] of dayTotals(placed, days)) {
    const w = week(day);
    w.load = (w.load ?? 0) + total.load;
  }
  return [...weeks.values()].map((w) => ({ ...w, load: Math.round(w.load ?? 0) })).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}
