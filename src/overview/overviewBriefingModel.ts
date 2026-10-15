import { t, getLocale } from "../i18n/toolsLocale";
import type {
  TrainingHubActivity,
  TrainingHubSleepRecord,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import {
  filterUpcomingWorkoutsFromToday,
  getLocalHappenDayKey,
  happenDayFromTimestamp,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import { recoveryTone } from "../training/parsers";
import { scheduledSportFamily, WEEK_SPORT_FAMILY_META } from "../calendar/weekSportBreakdown";
import { sportColorCategory, type SportColorCategory } from "../training/sportColors";
import type { TrainingHubSnapshot } from "../training/types";

export type ReadinessTone = "low" | "mid" | "high" | "neutral";

export interface Readiness {
  tone: ReadinessTone;
  percent?: number;
  title: string;
  message: string;
  fullRecoveryHours?: number;
}

/** Recovery verdict, phrased around today's plan when there is one. */
export function buildReadiness(
  snapshot: TrainingHubSnapshot | null,
  today: TrainingHubUpcomingWorkout[]
): Readiness {
  const raw = snapshot?.summary.recoveryPct;
  const percent = raw !== undefined && Number.isFinite(raw) && raw > 0
    ? Math.min(100, Math.round(raw))
    : undefined;
  const tone = percent === undefined ? "neutral" : recoveryTone(percent);
  const hours = snapshot?.dashboard?.fullRecoveryHours;
  const fullRecoveryHours = hours !== undefined && Number.isFinite(hours) && hours > 0
    ? Math.round(hours)
    : undefined;
  const plan = today[0]?.name.trim();
  const easyPlan = plan !== undefined && inferUpcomingWorkoutCategory(plan) === "Easy";

  switch (tone) {
    case "high":
      return {
        tone, percent, fullRecoveryHours,
        title: t("Ready to push"),
        message: plan
          ? t("Recovery is strong. A good day for {{p0}}.", { p0: String(plan) })
          : t("Recovery is strong. You're cleared for a hard session.")
      };
    case "mid":
      return {
        tone, percent, fullRecoveryHours,
        title: t("Keep it steady"),
        message: plan
          ? easyPlan
            ? t("You're still recovering, so {{p0}} fits today.", { p0: String(plan) })
            : t("You're still recovering. Keep {{p0}} at a controlled effort.", { p0: String(plan) })
          : t("You're still recovering. Easy to moderate effort today.")
      };
    case "low":
      return {
        tone, percent, fullRecoveryHours,
        title: t("Recovery day"),
        message: plan
          ? easyPlan
            ? t("Recovery is low. Keep {{p0}} gentle, or take the day off.", { p0: String(plan) })
            : t("Recovery is low. Consider swapping {{p0}} for something easy.", { p0: String(plan) })
          : t("Recovery is low. Prioritise rest and sleep today.")
      };
    default:
      return {
        tone, percent, fullRecoveryHours,
        title: t("Waiting for a sync"),
        message: t("Sync your watch with the COROS app to see today's recovery.")
      };
  }
}

export interface TodayPlan {
  today: TrainingHubUpcomingWorkout[];
  next?: TrainingHubUpcomingWorkout;
  /** Sessions after today, soonest first. */
  later: TrainingHubUpcomingWorkout[];
  upcomingCount: number;
}

export function buildTodayPlan(
  workouts: TrainingHubUpcomingWorkout[],
  now = new Date()
): TodayPlan {
  const todayKey = getLocalHappenDayKey(now);
  const upcoming = filterUpcomingWorkoutsFromToday(workouts)
    .slice()
    .sort((a, b) => a.happenDay.localeCompare(b.happenDay) || (a.sortNo ?? 0) - (b.sortNo ?? 0));
  const later = upcoming.filter((workout) => workout.happenDay > todayKey);
  return {
    today: upcoming.filter((workout) => workout.happenDay === todayKey),
    next: later[0],
    later,
    upcomingCount: upcoming.length
  };
}

export interface WeekDay {
  happenDay: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  isFuture: boolean;
  load: number;
  sessions: number;
  sport?: SportColorCategory;
  plannedLoad: number;
  /** Colour of the day's first planned workout; planned codes are COROS program codes. */
  plannedSport?: SportColorCategory;
  planned: TrainingHubUpcomingWorkout[];
}

export interface WeekSummary {
  days: WeekDay[];
  load: number;
  sessions: number;
  /** Workouts still planned this week, on days with nothing recorded yet. */
  plannedSessions: number;
  previousLoad: number;
  /** Largest bar on the strip (done or planned), so bars share one scale. */
  peak: number;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Monday-first week: what's done (by sport) and what's still on the plan. */
export function buildWeekSummary(
  activities: TrainingHubActivity[],
  workouts: TrainingHubUpcomingWorkout[],
  now = new Date()
): WeekSummary {
  const todayKey = getLocalHappenDayKey(now);
  const monday = startOfWeek(now);
  const previousStart = getLocalHappenDayKey(addDays(monday, -7));
  const weekStart = getLocalHappenDayKey(monday);
  const byDay = new Map<string, { load: number; sessions: number; sportLoad: Map<SportColorCategory, number> }>();
  let previousLoad = 0;

  for (const activity of activities) {
    const day = happenDayFromTimestamp(activity.startTime);
    if (!day) continue;
    const load = Number.isFinite(activity.trainingLoad) ? Math.max(0, activity.trainingLoad ?? 0) : 0;
    if (day >= previousStart && day < weekStart) {
      previousLoad += load;
      continue;
    }
    const entry = byDay.get(day) ?? { load: 0, sessions: 0, sportLoad: new Map() };
    entry.load += load;
    entry.sessions += 1;
    const sport = sportColorCategory(activity.sportType);
    entry.sportLoad.set(sport, (entry.sportLoad.get(sport) ?? 0) + Math.max(load, 1));
    byDay.set(day, entry);
  }

  const days: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    const happenDay = getLocalHappenDayKey(date);
    const done = byDay.get(happenDay);
    const planned = happenDay >= todayKey
      ? workouts.filter((workout) => workout.happenDay === happenDay)
      : [];
    const sport = done
      ? [...done.sportLoad.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      : undefined;
    return {
      happenDay,
      weekday: new Intl.DateTimeFormat(getLocale(), { weekday: "narrow" }).format(date),
      dayOfMonth: date.getDate(),
      isToday: happenDay === todayKey,
      isFuture: happenDay > todayKey,
      load: Math.round(done?.load ?? 0),
      sessions: done?.sessions ?? 0,
      sport,
      plannedLoad: Math.round(planned.reduce((sum, workout) => sum + (workout.trainingLoad ?? 0), 0)),
      plannedSport: planned.length
        ? WEEK_SPORT_FAMILY_META[scheduledSportFamily(planned[0].sportType)].color
        : undefined,
      planned
    };
  });

  return {
    days,
    load: days.reduce((sum, day) => sum + day.load, 0),
    sessions: days.reduce((sum, day) => sum + day.sessions, 0),
    plannedSessions: days.reduce((sum, day) => sum + (day.sessions > 0 ? 0 : day.planned.length), 0),
    previousLoad: Math.round(previousLoad),
    peak: Math.max(1, ...days.map((day) => Math.max(day.load, day.plannedLoad)))
  };
}

export function latestActivity(activities: TrainingHubActivity[]): TrainingHubActivity | undefined {
  let latest: TrainingHubActivity | undefined;
  for (const activity of activities) {
    if ((activity.startTime ?? 0) > (latest?.startTime ?? 0)) latest = activity;
  }
  return latest;
}

/** The main night COROS filed under this morning, or the latest one before it. */
export function latestNight(records: TrainingHubSleepRecord[] | undefined): TrainingHubSleepRecord | undefined {
  return (records ?? [])
    .filter((record) => record.kind !== "nap" && (record.totalMinutes ?? 0) > 0)
    .sort((a, b) => a.happenDay.localeCompare(b.happenDay))
    .at(-1);
}

export interface VitalReading {
  value?: number;
  /** Change against the athlete's own reference (baseline or 7-day average). */
  delta?: number;
  /** The reference the delta is measured against, drawn through the trend. */
  reference?: number;
  history: number[];
}

/** One night's architecture for the stacked bars; stages are absent on partial records. */
export interface SleepNight {
  happenDay: string;
  total: number;
  deep?: number;
  rem?: number;
  light?: number;
}

export interface Vitals {
  /** False when COROS data access (MCP) is not connected, so sleep cannot load at all. */
  sleep: VitalReading & {
    score?: number;
    happenDay?: string;
    connected: boolean;
    deep?: number;
    rem?: number;
    light?: number;
    awake?: number;
    /** Main nights, oldest first, with stage minutes where COROS recorded them. */
    nights: SleepNight[];
  };
  hrv: VitalReading & { baseline?: number; nightsToBaseline?: number };
  rhr: VitalReading;
  vo2max: VitalReading & { level?: number };
}

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function recent(values: (number | undefined)[], count = 14): number[] {
  return values
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0)
    .slice(-count);
}

/** Main nights with a duration, oldest first, so the bars and the reading agree. */
function mainNights(records: TrainingHubSleepRecord[] | undefined, count = 14): SleepNight[] {
  return (records ?? [])
    .filter((record) => record.kind !== "nap" && (record.totalMinutes ?? 0) > 0)
    .sort((a, b) => a.happenDay.localeCompare(b.happenDay))
    .slice(-count)
    .map((record) => ({
      happenDay: record.happenDay,
      total: record.totalMinutes ?? 0,
      deep: record.deepMinutes,
      rem: record.remMinutes,
      light: record.lightMinutes
    }));
}

export function buildVitals(snapshot: TrainingHubSnapshot | null): Vitals {
  const points = snapshot?.trendPoints ?? [];
  const night = latestNight(snapshot?.sleep?.records);
  const nights = mainNights(snapshot?.sleep?.records);
  const sleepHistory = nights.length ? nights.map((entry) => entry.total) : recent(points.map((point) => point.sleepMinutes));
  // Last night against the week before it, once there are enough nights to call it a habit.
  const sleepPrior = sleepHistory.length >= 4 ? mean(sleepHistory.slice(-8, -1)) : undefined;
  const hrvSummary = snapshot?.dashboard?.sleepHrv;
  const wearDays = hrvSummary?.remainWearDays;
  const hrvHistory = recent(points.map((point) => point.avgSleepHrv));
  const hrv = hrvSummary?.avgSleepHrv ?? hrvHistory.at(-1);
  const baseline = hrvSummary?.sleepHrvBase
    ?? points.map((point) => point.sleepHrvBase).filter((value) => value !== undefined).at(-1);
  const days = snapshot?.dailyMetrics?.dayList ?? snapshot?.analytics?.dayList ?? [];
  const vo2History = recent([...days].sort((a, b) => a.happenDay.localeCompare(b.happenDay)).map((day) => day.vo2max), 30);
  const vo2 = vo2History.at(-1);
  const vo2Prior = vo2History.length > 7 ? vo2History.at(-8) : undefined;
  const level = snapshot?.racePredictor?.staminaLevel ?? snapshot?.summary.staminaLevel;

  // One series for the reading, its delta and its sparkline, so the three always agree.
  // Readings outside a resting range are COROS placeholders, not heart rates.
  const rhrSeries = points
    .map((point) => point.rhr)
    .filter((value): value is number => value !== undefined && value >= 25 && value <= 140);
  const rhr = rhrSeries.at(-1) ?? snapshot?.summary.latestRhr;
  const rhrPrior = mean(rhrSeries.slice(-8, -1));

  const rhrSteady = rhr !== undefined && rhrPrior !== undefined && rhrSeries.length >= 4;

  return {
    sleep: {
      value: night?.totalMinutes,
      score: night?.score,
      happenDay: night?.happenDay,
      connected: snapshot?.sleep?.mcpConnected !== false,
      deep: night?.deepMinutes,
      rem: night?.remMinutes,
      light: night?.lightMinutes,
      awake: night?.awakeMinutes,
      nights,
      delta: night?.totalMinutes !== undefined && sleepPrior !== undefined ? night.totalMinutes - sleepPrior : undefined,
      reference: sleepPrior,
      history: sleepHistory.length ? sleepHistory : recent([night?.totalMinutes])
    },
    hrv: {
      value: hrv,
      baseline,
      nightsToBaseline: wearDays !== undefined && Number.isFinite(wearDays) && wearDays > 0 ? Math.round(wearDays) : undefined,
      delta: hrv !== undefined && baseline !== undefined ? hrv - baseline : undefined,
      reference: baseline,
      history: hrvHistory
    },
    rhr: {
      value: rhr,
      delta: rhrSteady ? rhr - rhrPrior : undefined,
      reference: rhrSteady ? rhrPrior : undefined,
      history: rhrSeries.slice(-14)
    },
    vo2max: {
      value: vo2,
      delta: vo2 !== undefined && vo2Prior !== undefined ? Math.round((vo2 - vo2Prior) * 10) / 10 : undefined,
      level: level !== undefined && Number.isFinite(level) ? Math.round(level) : undefined,
      history: vo2History
    }
  };
}

/** One line under the greeting: the morning in a glance. */
export function buildBriefLine(
  readiness: Readiness,
  plan: TodayPlan,
  week: WeekSummary
): string | undefined {
  const parts: string[] = [];
  if (readiness.percent !== undefined) parts.push(t("Recovery {{percent}}%", { percent: readiness.percent }));
  if (plan.today.length === 1) parts.push(t("{{name}} on the plan", { name: plan.today[0]!.name.trim() }));
  else if (plan.today.length > 1) parts.push(t("{{count}} sessions on the plan", { count: plan.today.length }));
  else if (plan.next) parts.push(t("Rest day"));
  if (week.sessions > 0) {
    parts.push(t("{{count}} sessions this week", { count: week.sessions }));
  }
  return parts.length ? parts.join(" · ") : undefined;
}

export function formatSleepMinutes(minutes?: number): string {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return "–";
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, "0")}m`;
}

/** "Today", "Yesterday", weekday within the week, else a short date — plus the clock time. */
export function formatActivityWhen(startTime?: number, now = new Date()): string {
  if (!startTime || !Number.isFinite(startTime)) return "";
  const date = new Date(startTime < 10_000_000_000 ? startTime * 1000 : startTime);
  const day = getLocalHappenDayKey(date);
  const today = getLocalHappenDayKey(now);
  const yesterday = getLocalHappenDayKey(addDays(now, -1));
  const time = new Intl.DateTimeFormat(getLocale(), { hour: "numeric", minute: "2-digit" }).format(date);
  const elapsedDays = (now.getTime() - date.getTime()) / 86_400_000;
  const label = day === today
    ? t("Today")
    : day === yesterday
      ? t("Yesterday")
      : elapsedDays < 6
        ? new Intl.DateTimeFormat(getLocale(), { weekday: "long" }).format(date)
        : new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).format(date);
  return `${label} · ${time}`;
}
