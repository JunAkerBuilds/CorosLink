import { fromCoros, fromSample, fromSynced, type Loaded } from "@/data/core";
import { hubCalendar, hubSession, type HubCalendarDay, type HubSport, type HubWorkout } from "@/data/hub";
import type { NativeGymPlanned } from "@/data/sync/native";
import { clock, dayKey } from "@/lib/format";
import { distance } from "@/lib/units";
import { msg, t } from "@/lib/i18n";
import { corosWorkoutId } from "@/lib/hubWorkout";
import { sampleCalendar, sampleDashboardNow } from "@/data/sample/training";
import { syncedEntries, syncedWeeks } from "@/data/sync/calendar";
import { buildDashboard, latestActivity } from "@/data/sync/dashboard";
import { syncView } from "@/data/sync";
import { trainingOf } from "@/data/sync/trainingLocal";
import type { Sport } from "@/lib/workout";
import type { Sport as SportFamily } from "@/data/activities";

/** Sports the calendar and the workout builder know. Strength is the gym. */
export type { Sport } from "@/lib/workout";

/* ───────────── Dashboard ───────────── */

/** Hue tokens the dashboard paints with (`var(--h-<name>)`). */
export type HueName = "mint" | "cyan" | "rose" | "violet" | "blue" | "pink" | "gold" | "orange" | "yellow" | "coral" | "slate" | "lime";

/** Daily fitness and fatigue ending today, with the load of each 7-day block ending today. */
export interface FitnessSeries {
  /** Day of the first sample (YYYY-MM-DD). */
  start: string;
  fitness: number[];
  fatigue: number[];
  /** One value per 7 days of the series. The last one is this week so far. */
  weeklyLoad: number[];
}

export interface RacePrediction {
  name: string;
  seconds: number;
  paceSecPerKm: number;
  /** Change over the last four weeks, in seconds (negative is faster). Left out when it is not known. */
  deltaSeconds?: number;
}

/** A coloured scale with a marker on it: form, load ratio, VO2max. `marker` is 0 to 1 along it. */
export interface Scale {
  segments: { weight: number; hue: HueName }[];
  marker: number;
  labels: string[];
}

/** Widgets on the dashboard board, in board order. */
export const WIDGETS = [
  { key: "rings", name: msg("Readiness, sleep & load") },
  { key: "today", name: msg("Today") },
  { key: "latest", name: msg("Latest activity") },
  { key: "fitness", name: msg("Fitness & freshness") },
  { key: "load", name: msg("Training load") },
  { key: "streak", name: msg("Streak") },
  { key: "heat", name: msg("Training heat map") },
  { key: "goal", name: msg("Weekly goal") },
  { key: "volume", name: msg("Weekly volume") },
  { key: "year", name: msg("Year to date") },
  { key: "intensity", name: msg("Easy vs hard") },
  { key: "sleep", name: msg("Sleep, two weeks") },
  { key: "hrv", name: msg("HRV trend") },
  { key: "mix", name: msg("Sport mix") },
  { key: "thresholds", name: msg("Threshold & VO₂max") },
  { key: "bests", name: msg("Personal bests") },
  { key: "month", name: msg("This month") },
] as const;
export type WidgetKey = (typeof WIDGETS)[number]["key"];

/** Widgets only the phone fills (from its recordings and settings): with no phone, they stay off the board. */
export const PHONE_ONLY: readonly WidgetKey[] = ["intensity", "thresholds", "bests", "goal"];

/** A share of time: easy/moderate/hard or one sport. */
export interface TimeShare { label: string; hue: HueName; percent: number; minutes: number }

/**
 * The board. For a signed-in person every widget holds only what their phone sent: a widget is null (or its
 * list empty, its status left out) when its inputs are missing, and the page then shows one short empty line.
 */
export interface Dashboard {
  today: string;
  /**
   * True when no phone has sent its training view, so fitness, load and readiness were worked out on this computer
   * and the widgets only the phone can fill (`PHONE_ONLY`) have nothing coming.
   */
  local?: boolean;
  /** Null when there is no Coach line to show (the web has no Coach for synced data yet). */
  coach: { text: string; nextLabel: string } | null;
  morning: {
    status?: string;
    /** A ring whose number is missing reads "—" with an empty ring. */
    rings: { label: string; value: string; fraction: number; hue: HueName }[];
    tiles: { label: string; value: string; unit?: string; trend: number[]; hue: HueName; note: string }[];
    /** Today's feel check (1 awful … 5 great) and its tags, when there is one. */
    feel?: { level: number; tags: string[] } | null;
  } | null;
  todayWorkout: {
    status: string;
    /** Null when nothing is done or planned today. */
    name: string | null;
    detail: string;
    /** The numbers under it: what was recorded when done, the session's size when planned. */
    stats: { label: string; value: string }[];
    /** With nothing done or planned today: the next session on the calendar this week or next, if any. */
    next: { name: string; when: string } | null;
    /**
     * Monday to Sunday of this week. "today" is today with something done; "none" is a day with nothing on it.
     * `current` marks today whatever its state (left out on the sample, where today is always "today").
     */
    week: { day: string; what: string; state: "done" | "today" | "planned" | "none"; current?: boolean }[];
  };
  latest: {
    activityId: string; name: string; when: string;
    /** "Run", "Pool swim"…, and its family for the icon. */
    sport: string; family: SportFamily;
    /** The route drawn in a 300 × 170 box. Null when the activity has no route. */
    routePath: string | null; routeStart: [number, number]; routeEnd: [number, number]; routeLabel: string;
    /** Heart rate over the activity as a line (and its fill) in a 300 × 56 box, when recorded. */
    heart: { line: string; area: string; label: string } | null;
    /** Every stat the activity holds (see `latestStats`): the card picks the headline three and the side ones. */
    stats: { label: string; value: string }[];
  } | null;
  fitness: { series: FitnessSeries; value: number; status?: string; scale: Scale } | null;
  load: { status?: string; ratio: string; scale: Scale; last7: number | null; usual: number | null } | null;
  streak: { weeks: number; bestWeeks: number; daysInRow: number };
  /** Every day of the last 53 weeks, Monday first, ending today. */
  heat: { start: string; days: { level: 0 | 1 | 2 | 3 | 4; minutes: number; load: number; what: string }[] };
  /** `plannedByTodayMinutes` is left out when there is no plan to measure against. */
  goal: { status?: string; doneMinutes: number; goalMinutes: number; plannedByTodayMinutes?: number } | null;
  /** Hours per week, oldest first; the last one is this week so far. */
  volume: { status?: string; hours: number[]; averageHours: number };
  /** Cumulative running km per day of the year. `lastYear` is empty when last year is not known. */
  year: { status?: string; km: number; thisYear: number[]; lastYear: number[]; lastYearByNowKm: number | null; label: string };
  /** `parts` is empty when time in zones is not known. */
  intensity: { status?: string; parts: TimeShare[] };
  /** Hours asleep per night, oldest first; the last is last night. */
  sleep: { nights: number[]; averageHours: number } | null;
  hrv: { status: string; days: number[]; usual: [number, number] } | null;
  mix: { parts: TimeShare[] };
  thresholds: { status?: string; vo2max: number | null; scale: Scale | null; paceSecPerKm: number | null; heartRate: number | null; races: RacePrediction[] } | null;
  bests: { name: string; seconds: number; date: string | null; isNew: boolean }[];
  /** Days of this month with something done, and days with something planned. */
  month: { month: string; done: number[]; planned: number[] };
}

/** The last `weeks` weeks of a series. */
export function sliceSeries(series: FitnessSeries, weeks: number): FitnessSeries {
  const total = series.weeklyLoad.length;
  const keep = Math.max(1, Math.min(total, weeks));
  const skipDays = (total - keep) * 7;
  const [y, m, d] = series.start.split("-").map(Number);
  const start = new Date(y, m - 1, d + skipDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    fitness: series.fitness.slice(skipDays),
    fatigue: series.fatigue.slice(skipDays),
    weeklyLoad: series.weeklyLoad.slice(total - keep),
  };
}

/**
 * The dashboard. Built from the items in the store on this computer (what the phone or the watch synced), and only
 * those; with no phone paired, fitness, load and readiness are worked out here (`trainingOf`). Otherwise the sample athlete.
 */
export async function loadDashboard(): Promise<Loaded<Dashboard>> {
  const view = await syncView();
  if (!view) return fromSample(sampleDashboardNow());
  const now = new Date();
  const activities = view.all("activity").map((i) => i.body);
  const latest = latestActivity(activities, now);
  const local = !view.get("view.training", "me");
  return fromSynced({ local, ...buildDashboard({
    activities,
    latestDetail: latest ? view.get("activity.detail", latest.id) : undefined,
    days: view.all("health.day").map((i) => i.body),
    nights: view.all("health.night").map((i) => i.body),
    training: trainingOf(view, now),
    planned: view.all("gym.planned").map((i) => i.body),
    routines: view.all("gym.routine").map((i) => i.body),
    feel: view.get("feel.check", dayKey(now)),
    gym: view.all("gym.workout").map((i) => i.body),
  }, now) });
}

/* ───────────── Calendar ───────────── */

/** The calendar's sports: the four it plans, and everything else it only shows (walks, hikes, skiing, rowing, climbing). */
export type CalendarSport = Sport | "other";

export interface CalendarEntry {
  id: string;
  date: string;
  sport: CalendarSport;
  name: string;
  /** Second line, formatted (6.10 km · 33:48, 6 exercises). */
  detail: string;
  status: "done" | "planned";
  /** "browser" entries were planned at this desk and live in this browser only. */
  /** "synced" entries come from the store on this computer: activities and gym plans the phone sent. */
  source: "sample" | "browser" | "coros" | "synced";
  /** The recorded activity this entry opens, when it has a page. */
  activityId?: string;
  /** The workout this entry opens in the builder. */
  workoutId?: string;
  /** Distance, time and load: planned for a plan, recorded for a done entry. Used for week totals and how much of a plan was done. */
  metres?: number;
  seconds?: number;
  load?: number;
  /** Metres climbed, for a recorded activity. */
  elevation?: number;
  /** How to change a planned entry, by where it lives. Only one is set. */
  coros?: { idInPlan: string; name: string; workout: HubWorkout | null };
  browser?: { workoutId: string };
  planned?: NativeGymPlanned;
}

/** One week's totals as the account reports them. `weekStart` is the Monday. */
export interface WeekTotals {
  weekStart: string;
  /** Recorded time, or null when nothing is done yet. */
  timeSeconds: number | null;
  runMetres: number;
  /** Recorded load, or null when nothing is done yet. */
  load: number | null;
  /** Load of everything planned for the week, when the week still has plans. */
  plannedLoad: number | null;
}

export interface CalendarData {
  today: string;
  entries: CalendarEntry[];
  weeks: WeekTotals[];
  /** This week's fitness numbers, when the phone has worked them out. */
  now?: { baseFitness?: number; loadRatio?: number };
}

const HUB_SPORT: Record<HubSport, CalendarSport> = {
  run: "run", trailRun: "run", bike: "ride", swim: "swim", strength: "strength", hyrox: "strength", xcSki: "other", indoorClimb: "other", bouldering: "other",
};

/** The second line of a COROS planned workout: distance and time when COROS gives them, sets for strength. */
export function hubDetail(totals: { seconds: number; meters: number; sets: number } | null): string {
  if (!totals) return "";
  // A gym workout's seconds are only its timed steps, so its sets say more.
  if (totals.sets > 0) return totals.sets === 1 ? t("1 set") : t("{n} sets", { n: totals.sets });
  const parts: string[] = [];
  if (totals.meters > 0) parts.push(distance(totals.meters));
  if (totals.seconds > 0) parts.push(clock(totals.seconds));
  return parts.join(" · ");
}

/** COROS calendar days as calendar entries. Training Hub gives the plan only: recorded activities are not in it. */
export function hubEntries(days: readonly HubCalendarDay[]): CalendarEntry[] {
  return days.flatMap((d) =>
    d.workouts.map((w) => ({
      id: `coros-${d.day}-${w.idInPlan}`,
      date: d.day,
      // A COROS sport this app doesn't write (yoga, rowing…) is drawn as "other", never as a run.
      sport: w.sport ? HUB_SPORT[w.sport] ?? "other" : "other",
      name: w.name,
      detail: hubDetail(w.totals),
      status: "planned" as const,
      source: "coros" as const,
      metres: w.totals?.meters || undefined,
      seconds: w.totals?.seconds || undefined,
      load: w.load || undefined,
      coros: { idInPlan: w.idInPlan, name: w.name, workout: w.workout },
      // Only workouts whose steps this app can write open in the builder.
      workoutId: w.workout ? corosWorkoutId(d.day, w.idInPlan) : undefined,
    })),
  );
}

/**
 * The calendar.
 * - Signed in to COROS Training Hub: the person's own planned workouts (60 days back, 120 ahead).
 * - With the store on this computer: the activities and gym plans the phone synced, with each week's totals.
 * - Both: the COROS plan and the synced entries together. Neither: the sample athlete.
 * A Hub failure is thrown, never papered over with sample data.
 */
export async function loadCalendar(): Promise<Loaded<CalendarData>> {
  const [session, view] = await Promise.all([hubSession().catch(() => null), syncView()]);
  const hub = session?.state === "signedIn";
  if (!hub && !view) return fromSample(sampleCalendar);
  const now = new Date();
  const at = (offset: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  const planned = hub ? hubEntries((await hubCalendar(at(-60), at(120))).data) : [];
  if (!view) return fromCoros({ today: at(0), entries: planned, weeks: [] });
  const activities = view.all("activity").map((i) => i.body);
  const entries = syncedEntries(activities, view.all("gym.planned").map((i) => i.body), view.all("gym.routine").map((i) => i.body), now);
  // Base Fitness is the fitness line (the long-term average of daily load), as on the Dashboard; Load Ratio is its acute ÷ chronic.
  // The phone's, or this computer's own when no phone has synced one.
  const training = trainingOf(view, now);
  const fitness = training?.fitness?.fitness;
  const baseFitness = fitness?.length ? fitness[fitness.length - 1] : undefined;
  const loadRatio = training?.load?.ratio;
  const data: CalendarData = {
    today: at(0), entries: [...planned, ...entries], weeks: syncedWeeks(activities, view.all("health.day").map((i) => i.body), now),
    now: baseFitness != null || loadRatio != null ? { baseFitness, loadRatio } : undefined,
  };
  return hub ? fromCoros(data) : fromSynced(data);
}
