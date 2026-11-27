// Synced items → the dashboard board. Pure: plain item bodies and `now` in, the screen's type out.
// Whatever the phone has not sent comes out null or empty; nothing here invents a number.
import type { Dashboard, FitnessSeries, HueName, Scale, TimeShare } from "@/data/training";
import { addDays, mondayOf, shortDay } from "@/lib/calendar";
import { loadHue, readinessHue, sleepHue } from "@/lib/feel";
import { clock, dayKey, signed, thousands } from "@/lib/format";
import { distance, distanceIn, distanceUnit, paceText, speedText, swimDistance, swimPaceText } from "@/lib/units";
import { language, locale, msg, t, tx } from "@/lib/i18n";
import { SPORT_FAMILY } from "./activities";
import { projectRoute, SPORT_TITLE } from "./geo";
import {
  calendarDayKey, refToDate,
  type ActivityDetailBody, type FeelCheckBody, type NativeActivity, type NativeDayVitals, type NativeGymWorkout, type NativeGymPlanned, type NativeGymRoutine, type NativeSleepNight,
  type NativeSport, type ViewTrainingBody,
} from "./native";

export interface DashboardItems {
  activities: readonly NativeActivity[];
  /** `activity.detail` of `latestActivity(activities, now)`, when the phone sent one. */
  latestDetail?: ActivityDetailBody;
  days: readonly NativeDayVitals[];
  nights: readonly NativeSleepNight[];
  training?: ViewTrainingBody;
  planned: readonly NativeGymPlanned[];
  routines: readonly NativeGymRoutine[];
  /** Today's feel check. */
  feel?: FeelCheckBody;
  /** Workouts from the phone's gym logger: they count toward the streak like the watch's activities. */
  gym?: readonly NativeGymWorkout[];
}

/* ───────────── Activities ───────────── */

const RUNNING: readonly NativeSport[] = ["run", "indoorRun", "trailRun", "track"];
const ON_FOOT: readonly NativeSport[] = [...RUNNING, "walk", "hike"];
const RIDING: readonly NativeSport[] = ["bike", "indoorBike"];
const SWIMMING: readonly NativeSport[] = ["poolSwim", "openWater"];

export const isRunning = (sport: NativeSport): boolean => RUNNING.includes(sport);

/** An activity placed on the local calendar. Ones without a start time cannot be placed and are left out. */
export interface Placed { a: NativeActivity; at: Date; day: string; minutes: number }

/** Activities that have started by `now`, newest first. */
export function placeActivities(activities: readonly NativeActivity[], now: Date): Placed[] {
  const out: Placed[] = [];
  for (const a of activities) {
    if (a.start == null || !Number.isFinite(a.start)) continue;
    const at = refToDate(a.start);
    if (at.getTime() > now.getTime()) continue;
    out.push({ a, at, day: dayKey(at), minutes: Math.max(0, a.durationSeconds ?? 0) / 60 });
  }
  return out.sort((x, y) => y.at.getTime() - x.at.getTime());
}

export function latestActivity(activities: readonly NativeActivity[], now: Date): NativeActivity | null {
  return placeActivities(activities, now)[0]?.a ?? null;
}

/** A recorded time, hundredths kept whenever the watch recorded them (38:13.75). */
export function timeText(seconds: number): string {
  return clock(seconds, Number.isInteger(seconds) ? 0 : 2);
}

/** Distance as the sport reads it: metres in the water, km elsewhere. */
export function distanceText(a: NativeActivity): string | null {
  if (!a.distanceMeters || a.distanceMeters <= 0) return null;
  return SWIMMING.includes(a.sport) ? swimDistance(a.distanceMeters) : distance(a.distanceMeters);
}

/** Average pace or speed, by sport. Null when the sport has neither or a number is missing. */
export function paceStat(a: NativeActivity): { label: string; value: string } | null {
  const m = a.distanceMeters, s = a.durationSeconds;
  if (!m || !s || m <= 0 || s <= 0) return null;
  if (ON_FOOT.includes(a.sport)) return { label: msg("Pace"), value: paceText(s / (m / 1000)) };
  if (RIDING.includes(a.sport) || a.sport === "ski") return { label: msg("Speed"), value: speedText(m / 1000 / (s / 3600)) };
  if (SWIMMING.includes(a.sport)) return { label: msg("Pace"), value: swimPaceText(s / (m / 100)) };
  if (a.sport === "row") return { label: msg("Pace"), value: `${clock(s / (m / 500))} /500 m` };
  return null;
}

/** The second line of a recorded activity: 6.10 km · 33:48.25. */
export function activityDetail(a: NativeActivity): string {
  const parts: string[] = [];
  const d = distanceText(a);
  if (d) parts.push(d);
  if (a.durationSeconds && a.durationSeconds > 0) parts.push(timeText(a.durationSeconds));
  return parts.join(" · ");
}

/** The stats under the latest activity, only those the activity holds. Labels in English (the page picks them by name); translate where shown. */
export function latestStats(a: NativeActivity): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const d = distanceText(a);
  if (d) out.push({ label: msg("Distance"), value: d });
  if (a.durationSeconds && a.durationSeconds > 0) out.push({ label: msg("Time"), value: timeText(a.durationSeconds) });
  const p = paceStat(a);
  if (p) out.push(p);
  if (a.averageHR != null) out.push({ label: msg("Heart rate"), value: `${Math.round(a.averageHR)} bpm` });
  if (a.trainingLoad != null) out.push({ label: msg("Load"), value: String(Math.round(a.trainingLoad)) });
  if (a.calories != null && a.calories > 0) out.push({ label: msg("Calories"), value: `${thousands(Math.round(a.calories))} kcal` });
  return out;
}

/** Today's numbers, at most four: distance, time, pace and load; heart rate stands in when there is room. */
export function todayStats(a: NativeActivity): { label: string; value: string }[] {
  const all = latestStats(a).filter((s) => s.label !== "Calories");
  return (all.length > 4 ? all.filter((s) => s.label !== "Heart rate") : all).slice(0, 4).map((s) => ({ ...s, label: t(s.label) }));
}

/** Heart rate over an activity as a line and its fill in a `width` × `height` box. Null without at least two readings. */
export function heartInBox(streams: ActivityDetailBody["streams"], width = 280, height = 104, pad = 14): { line: string; area: string; low: number; high: number } | null {
  const hr = (streams?.hr ?? []).filter((v) => Number.isFinite(v) && v > 0);
  if (hr.length < 2) return null;
  // About one point every 3 px is plenty for a 280-wide drawing.
  const step = Math.max(1, Math.ceil(hr.length / (width / 3)));
  const values: number[] = [];
  for (let k = 0; k < hr.length; k += step) values.push(mean(hr.slice(k, k + step)));
  const low = Math.min(...hr), high = Math.max(...hr);
  // At least 60 bpm top to bottom, so a steady session reads as steady rather than stretched into spikes.
  const span = Math.max(60, high - low), floor = (low + high) / 2 - span / 2;
  const line = values.map((v, k) => `${k ? "L" : "M"}${((k * width) / (values.length - 1)).toFixed(1)} ${(pad + (1 - (v - floor) / span) * (height - pad * 2)).toFixed(1)}`).join("");
  return { line, area: `${line}L${width} ${height}L0 ${height}Z`, low: Math.round(low), high: Math.round(high) };
}

/** A route as a path inside a `width` × `height` box, with its two ends. Null when there is no usable route. */
export function routeInBox(route: ActivityDetailBody["route"], width = 280, height = 104, pad = 8): { path: string; start: [number, number]; end: [number, number] } | null {
  const points = projectRoute(route ?? [], width, height, pad);
  if (points.length < 2) return null;
  const first = points[0], last = points[points.length - 1];
  return { path: points.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join(""), start: [first.x, first.y], end: [last.x, last.y] };
}

/** Today, 06:42 · Yesterday, 18:10 · Sat 14 Nov, 08:15. */
export function whenText(at: Date, now: Date): string {
  const day = dayKey(at), today = dayKey(now);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const word = day === today ? t("Today") : day === addDays(today, -1) ? t("Yesterday") : shortDay(day, at.getFullYear() !== now.getFullYear());
  return `${word}, ${time}`;
}

function heartOf(h: ReturnType<typeof heartInBox>): NonNullable<Dashboard["latest"]>["heart"] {
  return h ? { line: h.line, area: h.area, label: t("Heart rate over the activity, {low} to {high} bpm", { low: h.low, high: h.high }) } : null;
}

/** The sport's name in the app's language, "Workout" when the sport has none. */
const sportTitle = (sport: NativeSport): string => (SPORT_TITLE[sport] ? t(SPORT_TITLE[sport]) : t("Workout"));

/* ───────────── Days ───────────── */

export interface DayTotal { minutes: number; load: number; names: string[]; sports: NativeSport[] }

/**
 * What was done on each local day. A day's load is its activities' own training load; when none of that
 * day's activities carries one, the day's reading (`health.day.trainingLoad`) stands in.
 */
export function dayTotals(placed: readonly Placed[], days: readonly NativeDayVitals[]): Map<string, DayTotal> {
  const out = new Map<string, DayTotal>();
  const own = new Set<string>();
  // Oldest first, so names read in the order the day went.
  for (const p of [...placed].reverse()) {
    const total = out.get(p.day) ?? { minutes: 0, load: 0, names: [], sports: [] };
    total.minutes += p.minutes;
    if (p.a.trainingLoad != null) { total.load += p.a.trainingLoad; own.add(p.day); }
    total.names.push(p.a.name || sportTitle(p.a.sport));
    total.sports.push(p.a.sport);
    out.set(p.day, total);
  }
  for (const v of days) {
    const k = calendarDayKey(v.day), t = out.get(k);
    if (t && !own.has(k) && v.trainingLoad != null) t.load = v.trainingLoad;
  }
  return out;
}

const weekdayIndex = (day: string) => (new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8))).getDay() + 6) % 7;

/** Weeks in a row with something done (this week may still be empty), the longest such run, and days in a row. */
export function streakOf(activeDays: ReadonlySet<string>, today: string): Dashboard["streak"] {
  const weeks = new Set([...activeDays].map(mondayOf));
  const run = (has: (k: string) => boolean, from: string, step: number) => {
    let k = has(from) ? from : addDays(from, -step), n = 0;
    while (has(k)) { n++; k = addDays(k, -step); }
    return n;
  };
  let best = 0, current = 0, prev: string | null = null;
  for (const w of [...weeks].sort()) {
    current = prev != null && addDays(prev, 7) === w ? current + 1 : 1;
    best = Math.max(best, current);
    prev = w;
  }
  return { weeks: run((k) => weeks.has(k), mondayOf(today), 7), bestWeeks: best, daysInRow: run((k) => activeDays.has(k), today, 1) };
}

/**
 * The 53 weeks ending today, Monday first. Levels are quartiles of the loads of the trained days shown:
 * the lightest quarter is 1, the hardest 4. A trained day with no load at all is 1.
 */
export function heatOf(totals: ReadonlyMap<string, DayTotal>, today: string): Dashboard["heat"] {
  const start = addDays(mondayOf(today), -52 * 7);
  const count = 52 * 7 + weekdayIndex(today) + 1;
  const raw = Array.from({ length: count }, (_, n) => totals.get(addDays(start, n)));
  const loads = raw.flatMap((t) => (t && t.load > 0 ? [t.load] : [])).sort((a, b) => a - b);
  const cut = (p: number) => loads[Math.max(0, Math.ceil(p * loads.length) - 1)];
  const cuts = loads.length ? [cut(0.25), cut(0.5), cut(0.75)] : [];
  return {
    start,
    days: raw.map((t) => {
      if (!t) return { level: 0, minutes: 0, load: 0, what: "" };
      const level = t.load > 0 ? 1 + cuts.filter((c) => t.load > c).length : 1;
      return { level: level as 1 | 2 | 3 | 4, minutes: Math.round(t.minutes), load: Math.round(t.load), what: t.names.join(", ") };
    }),
  };
}

/** Hours per Monday week for `weeks` weeks, oldest first; the last one is this week so far. */
export function weeklyHours(totals: ReadonlyMap<string, DayTotal>, today: string, weeks = 12): number[] {
  const monday = mondayOf(today);
  return Array.from({ length: weeks }, (_, k) => {
    const from = addDays(monday, (k - weeks + 1) * 7);
    let minutes = 0;
    for (let d = 0; d < 7; d++) minutes += totals.get(addDays(from, d))?.minutes ?? 0;
    return Math.round((minutes / 60) * 100) / 100;
  });
}

/** Minutes done from Monday to today. */
export function weekMinutes(totals: ReadonlyMap<string, DayTotal>, today: string): number {
  let minutes = 0;
  for (let k = mondayOf(today); k <= today; k = addDays(k, 1)) minutes += totals.get(k)?.minutes ?? 0;
  return Math.round(minutes);
}

/**
 * The phone's fitness and fatigue with the load of each of its 7-day blocks. The blocks are counted back from
 * the series' last day, so the oldest few days are dropped when its length is not a whole number of weeks.
 */
export function fitnessSeries(view: ViewTrainingBody["fitness"], totals: ReadonlyMap<string, DayTotal>): FitnessSeries | null {
  if (!view || !/^\d{4}-\d{2}-\d{2}$/.test(view.start ?? "")) return null;
  const n = Math.min(view.fitness?.length ?? 0, view.fatigue?.length ?? 0);
  const weeks = Math.floor(n / 7);
  if (weeks < 1) return null;
  const skip = n - weeks * 7;
  const start = addDays(view.start, skip);
  return {
    start,
    fitness: view.fitness.slice(skip, n),
    fatigue: view.fatigue.slice(skip, n),
    weeklyLoad: Array.from({ length: weeks }, (_, w) => {
      let load = 0;
      for (let d = 0; d < 7; d++) load += totals.get(addDays(start, w * 7 + d))?.load ?? 0;
      return Math.round(load);
    }),
  };
}

/** Cumulative running km on each day of this year up to today, and of all of last year when it holds a run. */
export function yearToDate(placed: readonly Placed[], now: Date): { thisYear: number[]; lastYear: number[]; km: number; lastYearByNowKm: number | null } {
  const year = now.getFullYear();
  const perDay = (y: number, days: number) => {
    const m = new Array<number>(days).fill(0);
    let any = false;
    for (const p of placed) {
      if (!isRunning(p.a.sport) || p.at.getFullYear() !== y || !p.a.distanceMeters) continue;
      const k = Math.round((new Date(y, p.at.getMonth(), p.at.getDate()).getTime() - new Date(y, 0, 1).getTime()) / 86_400_000);
      if (k < days) { m[k] += p.a.distanceMeters; any = true; }
    }
    let sum = 0;
    return { any, km: m.map((v) => (sum += v) / 1000) };
  };
  const dayOfYear = Math.round((new Date(year, now.getMonth(), now.getDate()).getTime() - new Date(year, 0, 1).getTime()) / 86_400_000) + 1;
  const thisYear = perDay(year, dayOfYear).km;
  const last = perDay(year - 1, Math.round((new Date(year, 0, 1).getTime() - new Date(year - 1, 0, 1).getTime()) / 86_400_000));
  const lastYear = last.any ? last.km : [];
  return { thisYear, lastYear, km: thisYear[thisYear.length - 1] ?? 0, lastYearByNowKm: lastYear.length ? lastYear[Math.min(dayOfYear, lastYear.length) - 1] : null };
}

const FAMILIES: { label: string; hue: HueName; sports: readonly NativeSport[] }[] = [
  { label: msg("Run"), hue: "mint", sports: RUNNING },
  { label: msg("Ride"), hue: "blue", sports: RIDING },
  { label: msg("Strength"), hue: "orange", sports: ["strength"] },
  { label: msg("Swim"), hue: "cyan", sports: SWIMMING },
  { label: msg("Walk & hike"), hue: "gold", sports: ["walk", "hike"] },
];

/** Share of time per sport family over the 28 days ending today, largest first. Percentages add up to 100. */
export function sportMix(placed: readonly Placed[], today: string): TimeShare[] {
  const from = addDays(today, -27);
  const minutes = new Map<string, number>();
  for (const p of placed) {
    if (p.day < from || p.day > today || p.minutes <= 0) continue;
    const label = FAMILIES.find((f) => f.sports.includes(p.a.sport))?.label ?? msg("Other");
    minutes.set(label, (minutes.get(label) ?? 0) + p.minutes);
  }
  const total = [...minutes.values()].reduce((t, v) => t + v, 0);
  if (total <= 0) return [];
  const parts = [...minutes].map(([label, m]) => ({ label, hue: FAMILIES.find((f) => f.label === label)?.hue ?? ("violet" as HueName), minutes: Math.round(m), exact: (m / total) * 100 }))
    .sort((a, b) => b.exact - a.exact);
  // Largest remainders take the points rounding down leaves over.
  const floors = parts.map((p) => Math.floor(p.exact));
  let left = 100 - floors.reduce((t, v) => t + v, 0);
  const order = parts.map((p, k) => [p.exact - floors[k], k] as const).sort((a, b) => b[0] - a[0]);
  for (const [, k] of order) { if (left <= 0) break; floors[k]++; left--; }
  return parts.map((p, k) => ({ label: tx("sport", p.label), hue: p.hue, percent: floors[k], minutes: p.minutes }));
}

/* ───────────── Health ───────────── */

/** One reading per day for the `span` days ending today, oldest first, days without one left out. */
function recent<T>(items: readonly T[], dayOf: (t: T) => string, pick: (t: T) => number | undefined, today: string, span: number): { day: string; value: number }[] {
  const from = addDays(today, 1 - span);
  const out: { day: string; value: number }[] = [];
  for (const t of items) {
    const day = dayOf(t), value = pick(t);
    if (day >= from && day <= today && value != null && Number.isFinite(value)) out.push({ day, value });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

const vitalDay = (v: NativeDayVitals) => calendarDayKey(v.day);

/** Minutes asleep per night: the night's own record, else the day's reading. */
function sleepMinutes(days: readonly NativeDayVitals[], nights: readonly NativeSleepNight[], today: string, span: number): { day: string; value: number }[] {
  const byDay = new Map(recent(days, vitalDay, (v) => v.sleepMinutes, today, span).map((x) => [x.day, x.value]));
  for (const x of recent(nights, (n) => calendarDayKey(n.day), (n) => n.totalMinutes, today, span)) byDay.set(x.day, x.value);
  return [...byDay].map(([day, value]) => ({ day, value })).filter((x) => x.value > 0).sort((a, b) => (a.day < b.day ? -1 : 1));
}

const mean = (v: readonly number[]) => v.reduce((t, x) => t + x, 0) / v.length;

/** A morning tile: the latest reading, the last seven as its trend, and how it differs from the average of those before it. */
function tile(label: string, hue: HueName, readings: readonly { value: number }[], show: (v: number) => string, unit: string | undefined, note: (delta: number) => string): NonNullable<Dashboard["morning"]>["tiles"][number] | null {
  const trend = readings.slice(-7).map((r) => r.value);
  if (!trend.length) return null;
  const latest = trend[trend.length - 1];
  const before = trend.slice(0, -1);
  return { label, value: show(latest), unit, trend, hue, note: before.length ? note(latest - mean(before)) : "" };
}

/** HRV for the 30 days ending today against the usual range: mean ± one standard deviation of the last 60 days. */
export function hrvOf(days: readonly NativeDayVitals[], today: string): Dashboard["hrv"] {
  const shown = recent(days, vitalDay, (v) => v.hrv, today, 30).map((x) => x.value);
  const base = recent(days, vitalDay, (v) => v.hrv, today, 60).map((x) => x.value);
  if (shown.length < 2) return null;
  const m = mean(base), sd = Math.sqrt(mean(base.map((v) => (v - m) ** 2)));
  const usual: [number, number] = [Math.round(m - sd), Math.round(m + sd)];
  const latest = shown[shown.length - 1];
  return { status: latest < usual[0] ? t("Below range") : latest > usual[1] ? t("Above range") : t("In range"), days: shown, usual };
}

/* ───────────── Scales ───────────── */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The form scale of the board: form as a share of fitness, from +10 % (fresh) on the left to −50 % (strained)
 * on the right. This reproduces the canvas marker (fitness 54, fatigue 61 → 0.38).
 */
export function formScale(fitness: number, fatigue: number): Scale {
  const form = fitness - fatigue;
  const percent = fitness > 0 ? (form / fitness) * 100 : 0;
  return {
    segments: [{ weight: 10, hue: "cyan" }, { weight: 15, hue: "mint" }, { weight: 15, hue: "blue" }, { weight: 10, hue: "gold" }, { weight: 10, hue: "rose" }],
    marker: Math.round(clamp01((10 - percent) / 60) * 100) / 100,
    labels: [t("Fresh"), t("Form {value}", { value: signed(Math.round(form)) }), t("Strained")],
  };
}

const LOAD_SEGMENTS: Scale["segments"] = [{ weight: 8, hue: "blue" }, { weight: 5, hue: "mint" }, { weight: 2, hue: "gold" }, { weight: 5, hue: "rose" }];
const VO2_SEGMENTS: Scale["segments"] = [{ weight: 10, hue: "rose" }, { weight: 10, hue: "gold" }, { weight: 10, hue: "blue" }, { weight: 10, hue: "mint" }];

/* ───────────── The board ───────────── */

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Day `k` of the week (0 is Monday) as one letter, in the app's language. */
export const dayLetter = (k: number): string =>
  language() === "en" ? DAY_LETTERS[k] : new Intl.DateTimeFormat(locale(), { weekday: "narrow" }).format(new Date(2026, 10, 16 + k));

export function buildDashboard(items: DashboardItems, now: Date): Dashboard {
  const today = dayKey(now);
  const placed = placeActivities(items.activities, now);
  const totals = dayTotals(placed, items.days);
  const tb = items.training;
  const routineName = new Map(items.routines.map((r) => [r.id, r]));
  const plannedOn = new Map<string, NativeGymPlanned>();
  for (const p of items.planned) if (p.day) plannedOn.set(calendarDayKey(p.day), p);

  /* This morning. */
  const ratio = tb?.load?.ratio ?? (tb?.load?.acute != null && tb.load.chronic ? tb.load.acute / tb.load.chronic : undefined);
  const sleepScore = [
    ...recent(items.days, vitalDay, (v) => v.sleepScore, today, 14),
    ...recent(items.nights, (n) => calendarDayKey(n.day), (n) => n.score, today, 14),
  ].sort((a, b) => (a.day < b.day ? -1 : 1)).pop()?.value;
  const ring = (label: string, hue: HueName, value: string | null, fraction: number) => ({ label, hue, value: value ?? "—", fraction: value == null ? 0 : clamp01(fraction) });
  const readiness = tb?.readiness?.score;
  const slept = sleepMinutes(items.days, items.nights, today, 14);
  const tiles = [
    tile("HRV", "cyan", recent(items.days, vitalDay, (v) => v.hrv, today, 14), (v) => String(Math.round(v)), "ms", (d) => `${signed(Math.round(d))} ms`),
    tile(t("Resting HR"), "rose", recent(items.days, vitalDay, (v) => v.restingHR, today, 14), (v) => String(Math.round(v)), "bpm", (d) => `${signed(Math.round(d))} bpm`),
    tile(t("Time asleep"), "violet", slept.map((x) => ({ value: x.value / 60 })), (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; }, undefined, (d) => `${signed(Math.round(d * 60))} min`),
  ].filter((x) => x != null);
  const morning: Dashboard["morning"] = readiness == null && sleepScore == null && ratio == null && tiles.length === 0 ? null : {
    status: tb?.readiness?.status,
    rings: [
      ring(t("Readiness"), readiness != null ? readinessHue(readiness) : "mint", readiness != null ? String(Math.round(readiness)) : null, (readiness ?? 0) / 100),
      ring(t("Sleep"), sleepScore != null ? sleepHue(sleepScore) : "violet", sleepScore != null ? String(Math.round(sleepScore)) : null, (sleepScore ?? 0) / 100),
      ring(t("Load"), loadHue(tb?.load?.status), ratio != null ? ratio.toFixed(2) : null, (ratio ?? 0) / 2),
    ],
    tiles,
    feel: items.feel && items.feel.feel >= 1 && items.feel.feel <= 5 ? { level: items.feel.feel, tags: Array.isArray(items.feel.tags) ? items.feel.tags : [] } : null,
  };

  /* Today and the week strip. */
  const monday = mondayOf(today);
  const week: Dashboard["todayWorkout"]["week"] = DAY_LETTERS.map((_, k) => {
    const day = addDays(monday, k), done = totals.get(day), plan = day >= today ? plannedOn.get(day) : undefined;
    const current = day === today ? { current: true } : {};
    if (done) return { day: dayLetter(k), what: sportTitle(done.sports[done.sports.length - 1]), state: day === today ? "today" : "done", ...current };
    if (plan) return { day: dayLetter(k), what: routineName.get(plan.routineID)?.name || t("Gym"), state: "planned", ...current };
    return { day: dayLetter(k), what: "", state: "none", ...current };
  });
  const doneToday = placed.find((p) => p.day === today)?.a;
  const planToday = plannedOn.get(today);
  const doneTodayAt = placed.find((p) => p.day === today)?.at;
  let todayWorkout: Dashboard["todayWorkout"] = { status: "", name: null, detail: "", stats: [], next: null, week };
  if (doneToday) {
    todayWorkout = { status: msg("Done"), name: doneToday.name || sportTitle(doneToday.sport), detail: doneTodayAt ? whenText(doneTodayAt, now) : "", stats: todayStats(doneToday), next: null, week };
  } else if (planToday) {
    const routine = routineName.get(planToday.routineID);
    const entries = routine?.entries ?? [];
    const sets = entries.reduce((n, e) => n + (e.sets ?? []).filter((x) => x.kind !== "warmUp").length, 0);
    const last = (items.gym ?? []).filter((w) => w.routineID === planToday.routineID && w.start != null && dayKey(refToDate(w.start)) < today)
      .sort((x, y) => (y.start ?? 0) - (x.start ?? 0))[0];
    const stats = [
      ...(entries.length ? [{ label: t("Exercises"), value: String(entries.length) }] : []),
      ...(sets ? [{ label: t("Sets"), value: String(sets) }] : []),
      ...(last?.start != null ? [{ label: t("Last done"), value: shortDay(dayKey(refToDate(last.start))) }] : []),
    ];
    todayWorkout = { status: msg("Planned"), name: routine?.name || t("Gym workout"), detail: routine?.folder ?? "", stats, next: null, week };
  } else {
    const ahead = [...plannedOn.keys()].filter((k) => k > today && k <= addDays(today, 14)).sort()[0];
    if (ahead) {
      const routine = routineName.get(plannedOn.get(ahead)!.routineID);
      todayWorkout = { ...todayWorkout, next: { name: routine?.name || t("Gym workout"), when: ahead === addDays(today, 1) ? t("Tomorrow") : shortDay(ahead) } };
    }
  }

  /* Latest activity. */
  const newest = placed[0];
  // The card's map is 300 × 170 with room round the route for the chips on top; its heart trace is 300 × 56.
  const route = newest ? routeInBox(items.latestDetail?.route, 300, 170, 26) : null;
  const latest: Dashboard["latest"] = newest ? {
    activityId: newest.a.id,
    name: newest.a.name || sportTitle(newest.a.sport),
    when: whenText(newest.at, now),
    sport: t(SPORT_TITLE[newest.a.sport] ?? SPORT_TITLE.other),
    family: SPORT_FAMILY[newest.a.sport] ?? "Other",
    routePath: route?.path ?? null,
    routeStart: route?.start ?? [0, 0],
    routeEnd: route?.end ?? [0, 0],
    routeLabel: t("Route of {name}", { name: newest.a.name || sportTitle(newest.a.sport) }),
    heart: heartOf(heartInBox(items.latestDetail?.streams, 300, 56, 4)),
    stats: latestStats(newest.a),
  } : null;

  /* Fitness and load. */
  const series = fitnessSeries(tb?.fitness, totals);
  const fitNow = series ? series.fitness[series.fitness.length - 1] : 0, fatNow = series ? series.fatigue[series.fatigue.length - 1] : 0;
  const fitness: Dashboard["fitness"] = series ? { series, value: Math.round(fitNow), scale: formScale(fitNow, fatNow) } : null;
  const round = (v: number | undefined) => (v != null && Number.isFinite(v) ? Math.round(v) : null);
  const load: Dashboard["load"] = ratio == null ? null : {
    status: tb?.load?.status, ratio: ratio.toFixed(2),
    scale: { segments: LOAD_SEGMENTS, marker: clamp01(ratio / 2), labels: ["0", "0.8", "1.3", "2.0"] },
    last7: round(tb?.load?.acute ?? tb?.load?.weekTotal), usual: round(tb?.load?.chronic),
  };

  /* Volume, year, mix. */
  const hours = weeklyHours(totals, today);
  const pastHours = hours.slice(0, -1);
  const year = yearToDate(placed, now);
  // In the shown unit (km or mi); the series stay in km.
  const shown = (km: number) => distanceIn(km * 1000);
  const ahead = year.lastYearByNowKm != null ? Math.round(shown(year.km)) - Math.round(shown(year.lastYearByNowKm)) : null;
  const yearText = (km: number) => `${thousands(shown(km))} ${distanceUnit()}`;
  const dayWords = shortDay(today).split(" ").slice(1).join(" ");

  /* Thresholds and bests. */
  const races = (tb?.predictions ?? []).filter((p) => p.meters > 0 && p.seconds > 0)
    .map((p) => ({ name: p.name, seconds: p.seconds, paceSecPerKm: p.seconds / (p.meters / 1000) }));
  const thresholds: Dashboard["thresholds"] = tb?.vo2max == null && tb?.thresholdPaceSecPerKm == null && tb?.thresholdHr == null && races.length === 0 ? null : {
    vo2max: tb?.vo2max ?? null,
    scale: tb?.vo2max != null ? { segments: VO2_SEGMENTS, marker: clamp01((tb.vo2max - 30) / 40), labels: ["30", "40", "50", "60", "70"] } : null,
    paceSecPerKm: tb?.thresholdPaceSecPerKm ?? null,
    heartRate: tb?.thresholdHr ?? null,
    races,
  };
  const newSince = addDays(today, -14);
  const bests: Dashboard["bests"] = (tb?.bests ?? []).filter((b) => b.seconds > 0).map((b) => {
    const date = b.at != null ? dayKey(refToDate(b.at)) : null;
    return { name: b.name, seconds: b.seconds, date, isNew: date != null && date >= newSince && date <= today };
  });

  /* This month. */
  const month = today.slice(0, 7);
  const doneDays = [...new Set(placed.filter((p) => p.day.startsWith(month)).map((p) => Number(p.day.slice(8))))].sort((a, b) => a - b);
  const plannedDays = [...plannedOn.keys()].filter((k) => k.startsWith(month) && k >= today).map((k) => Number(k.slice(8)))
    .filter((d) => !doneDays.includes(d)).sort((a, b) => a - b);

  const nights = slept.map((x) => x.value / 60);
  const goalMinutes = tb?.weeklyGoalMinutes;

  return {
    today,
    coach: null,
    morning,
    todayWorkout,
    latest,
    fitness,
    load,
    // A day trained counts whether the watch recorded it or it was logged in the gym logger only.
    streak: streakOf(new Set([...totals.keys(), ...(items.gym ?? []).map((w) => dayKey(refToDate(w.start))).filter((d) => d <= today)]), today),
    heat: heatOf(totals, today),
    goal: goalMinutes != null && goalMinutes > 0 ? { doneMinutes: weekMinutes(totals, today), goalMinutes } : null,
    volume: { hours, averageHours: pastHours.length ? Math.round(mean(pastHours) * 100) / 100 : 0 },
    year: {
      status: ahead != null ? `${signed(ahead)} ${distanceUnit()}` : undefined,
      km: year.km, thisYear: year.thisYear, lastYear: year.lastYear, lastYearByNowKm: year.lastYearByNowKm,
      label: ahead == null ? t("Running distance this year: {distance} by {day}", { distance: yearText(year.km), day: dayWords })
        : ahead < 0 ? t("Running distance this year against last year: {distance} by {day}, {by} behind", { distance: yearText(year.km), day: dayWords, by: `${thousands(Math.abs(ahead))} ${distanceUnit()}` })
        : t("Running distance this year against last year: {distance} by {day}, {by} ahead", { distance: yearText(year.km), day: dayWords, by: `${thousands(Math.abs(ahead))} ${distanceUnit()}` }),
    },
    intensity: { parts: [] },
    sleep: nights.length ? { nights, averageHours: mean(nights) } : null,
    hrv: hrvOf(items.days, today),
    mix: { parts: sportMix(placed, today) },
    thresholds,
    bests,
    month: { month, done: doneDays, planned: plannedDays },
  };
}
