import { dateText, locale, msg, t, tx } from "@/lib/i18n";
import { dayLetter } from "@/data/sync/dashboard";
import { signed, thousands } from "@/lib/format";
import { distance, distanceIn, distanceUnit, imperial, paceText, swimDistance } from "@/lib/units";
import type { CalendarData, CalendarEntry, Dashboard, FitnessSeries, Sport, WeekTotals } from "@/data/training";

/**
 * A sample line written in metric ("8.02 km · 38:14", "5:30 /km", "1,500 m"), in the shown units. Metric comes back
 * as it is; imperial keeps the written number of decimals. Bare metres are a swim's.
 */
export function sampleUnits(text: string): string {
  if (!imperial()) return text;
  return text
    .replace(/(\d+):(\d\d) \/km\b/g, (_, m: string, s: string) => paceText(Number(m) * 60 + Number(s)))
    .replace(/(\d+(?:\.(\d+))?) km\b/g, (_, n: string, dec: string | undefined) => distance(Number(n) * 1000, dec?.length ?? 0))
    .replace(/(\d[\d,]*) m\b/g, (_, n: string) => swimDistance(Number(n.replace(/,/g, ""))));
}

/* ───────────── Dashboard ───────────── */

/** How one week's load falls on its seven days (the canvas pattern; it sums to 463). */
const DAY_PATTERN = [44, 46, 120, 62, 41, 54, 96];
const PATTERN_TOTAL = 463;

/**
 * Daily load from each week's total, then the usual 42-day and 7-day running averages,
 * eased so the last day lands on `end`. This is the canvas method.
 */
function runningAverages(weeks: readonly number[], seed: [number, number], end: [number, number]): { fitness: number[]; fatigue: number[] } {
  const n = weeks.length * 7;
  const fitness: number[] = [], fatigue: number[] = [];
  let c = seed[0], a = seed[1];
  for (let i = 0; i < n; i++) {
    const load = (DAY_PATTERN[i % 7] / PATTERN_TOTAL) * weeks[Math.floor(i / 7)];
    c += (load - c) / 42;
    a += (load - a) / 7;
    fitness.push(c);
    fatigue.push(a);
  }
  const dc = end[0] - fitness[n - 1], da = end[1] - fatigue[n - 1];
  for (let j = 0; j < n; j++) {
    fitness[j] += (dc * j) / (n - 1);
    fatigue[j] += (da * j) / (n - 1);
  }
  return { fitness, fatigue };
}

/** The 12 weeks on the canvas: planned totals drive the averages, the last bar is the week so far. */
const CANVAS_WEEKS = [310, 342, 365, 298, 388, 412, 440, 352, 455, 470, 454, 463];
const THIS_WEEK_SO_FAR = 253;

/** The 40 weeks before them: a steady build with every fourth week easier. */
const EARLIER_WEEKS = [
  228, 241, 255, 206, 246, 262, 275, 221, 258, 274, 289, 232, 268, 285, 301, 240, 262, 280, 296, 236,
  272, 290, 306, 248, 281, 299, 316, 252, 287, 305, 322, 258, 292, 310, 328, 262, 296, 315, 332, 270,
];

function yearSeries(): FitnessSeries {
  // The earlier stretch ends exactly where the canvas stretch starts (fitness 44, fatigue 46).
  const early = runningAverages(EARLIER_WEEKS, [31, 30], [44, 46]);
  const late = runningAverages(CANVAS_WEEKS, [44, 46], [54, 61]);
  return {
    start: "2025-11-21", // 364 days ending Thu 19 Nov 2026; the canvas stretch starts Fri 28 Aug 2026
    fitness: [...early.fitness, ...late.fitness],
    fatigue: [...early.fatigue, ...late.fatigue],
    weeklyLoad: [...EARLIER_WEEKS, ...CANVAS_WEEKS.slice(0, -1), THIS_WEEK_SO_FAR],
  };
}

/** The canvas's seeded random numbers (Park–Miller), so the heat map and HRV draw the same every time. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
}
const rnd = seeded(7);

/** 53 weeks of days, Monday 17 Nov 2025 to Thursday 19 Nov 2026, coloured by how hard each was. */
function heatDays(): Dashboard["heat"]["days"] {
  const last = 52 * 7 + 3;
  const base = [1, 3, 2, 3, 0, 2, 4];
  const thisWeek: [number, number, string][] = [[58, 62, "Recovery ride"], [48, 41, "Strength"], [34, 54, "Easy run"], [38, 96, "Tempo run"]];
  const out: Dashboard["heat"]["days"] = [];
  for (let n = 0; n <= last; n++) {
    const r = rnd();
    let lv = base[n % 7];
    if (r < 0.16) lv = 0; else if (r < 0.34) lv = Math.max(0, lv - 1); else if (r > 0.9) lv = Math.min(4, lv + 1);
    let minutes = lv ? Math.round(18 + lv * 24 + rnd() * 18) : 0;
    let load = lv ? Math.round(minutes * (0.9 + lv * 0.28)) : 0;
    let what = "";
    if (n > last - 4) {
      [minutes, load, what] = thisWeek[n - (last - 3)];
      lv = load > 90 ? 4 : load > 55 ? 3 : 2;
    }
    out.push({ level: lv as 0 | 1 | 2 | 3 | 4, minutes, load, what });
  }
  return out;
}

/** Running total of km over `days` days, ending on `total`: the canvas's year-to-date curves. */
function cumulative(total: number, days: number, phase: number): number[] {
  const raw: number[] = [];
  let s = 0;
  for (let k = 0; k < days; k++) { s += 1 + 0.35 * Math.sin(k / 58 + phase) + 0.25 * Math.sin(k / 9); raw.push(s); }
  return raw.map((v) => (v / s) * total);
}

const HEAT = heatDays();

function hrvDays(): number[] {
  const out: number[] = [];
  for (let q = 0; q < 30; q++) out.push(57 + 3.5 * Math.sin(q / 4.2) + (rnd() - 0.5) * 5);
  out[27] = 58; out[28] = 60; out[29] = 62;
  return out;
}

export const sampleDashboard: Dashboard = {
  today: "2026-11-19",
  coach: {
    text: "Legs are fresh and HRV is up. A good day for the tempo you finished this morning; keep tomorrow easy.",
    nextLabel: "Tomorrow: Easy run, 6.0 km",
  },
  morning: {
    status: msg("Ready"),
    rings: [
      { label: "Readiness", value: "78", fraction: 0.78, hue: "yellow" },
      { label: "Sleep", value: "86", fraction: 0.86, hue: "violet" },
      { label: "Load", value: "1.12", fraction: 0.56, hue: "blue" },
    ],
    tiles: [
      { label: "HRV", value: "62", unit: "ms", trend: [56, 58, 55, 59, 57, 60, 62], hue: "cyan", note: "+4 ms" },
      { label: "Resting HR", value: "48", unit: "bpm", trend: [50, 49, 50, 49, 49, 48, 48], hue: "rose", note: "−1 bpm" },
      { label: "Time asleep", value: "7:42", trend: [7.1, 6.8, 7.4, 7.0, 7.3, 7.2, 7.7], hue: "violet", note: "+25 min" },
    ],
  },
  todayWorkout: {
    status: "Done",
    name: "Tempo run",
    detail: "Today, 06:42",
    stats: [
      { label: "Distance", value: "8.02 km" },
      { label: "Time", value: "38:14.25" },
      { label: "Pace", value: "4:46 /km" },
      { label: "Load", value: "96" },
    ],
    next: null,
    week: [
      { day: "M", what: "Ride", state: "done" },
      { day: "T", what: "Gym", state: "done" },
      { day: "W", what: "Easy", state: "done" },
      { day: "T", what: "Tempo", state: "today" },
      { day: "F", what: "Easy", state: "planned" },
      { day: "S", what: "Gym", state: "planned" },
      { day: "S", what: "Long", state: "planned" },
    ],
  },
  latest: {
    activityId: "2026-11-19-morning-tempo",
    name: "Tempo run",
    when: "Today, 06:42",
    sport: "Run",
    family: "Run",
    routePath: "M40 128C58 112 74 120 96 104S122 72 150 66S196 74 214 52S250 30 262 52S246 98 220 112S170 126 150 138",
    routeStart: [40, 128],
    routeEnd: [150, 138],
    routeLabel: "Route of this morning's tempo run, an out-and-back along the river",
    heart: {
      line: "M0.0 48.4L5.1 48.8L10.2 46.7L15.3 46.4L20.3 43.9L25.4 42.0L30.5 40.9L35.6 37.9L40.7 36.6L45.8 33.5L50.8 31.8L55.9 29.8L61.0 26.4L66.1 21.8L71.2 20.8L76.3 19.7L81.4 17.5L86.4 14.7L91.5 13.9L96.6 13.9L101.7 11.9L106.8 13.7L111.9 12.2L116.9 13.0L122.0 14.2L127.1 15.1L132.2 15.2L137.3 13.4L142.4 14.3L147.5 13.6L152.5 12.9L157.6 13.2L162.7 12.9L167.8 14.4L172.9 15.5L178.0 15.8L183.1 14.4L188.1 14.2L193.2 14.4L198.3 13.7L203.4 13.6L208.5 14.0L213.6 12.6L218.6 11.9L223.7 13.0L228.8 12.6L233.9 12.5L239.0 11.1L244.1 10.4L249.2 11.3L254.2 9.5L259.3 11.0L264.4 10.9L269.5 9.6L274.6 10.6L279.7 10.0L284.7 11.1L289.8 9.5L294.9 7.9L300.0 7.2",
      area: "M0.0 48.4L5.1 48.8L10.2 46.7L15.3 46.4L20.3 43.9L25.4 42.0L30.5 40.9L35.6 37.9L40.7 36.6L45.8 33.5L50.8 31.8L55.9 29.8L61.0 26.4L66.1 21.8L71.2 20.8L76.3 19.7L81.4 17.5L86.4 14.7L91.5 13.9L96.6 13.9L101.7 11.9L106.8 13.7L111.9 12.2L116.9 13.0L122.0 14.2L127.1 15.1L132.2 15.2L137.3 13.4L142.4 14.3L147.5 13.6L152.5 12.9L157.6 13.2L162.7 12.9L167.8 14.4L172.9 15.5L178.0 15.8L183.1 14.4L188.1 14.2L193.2 14.4L198.3 13.7L203.4 13.6L208.5 14.0L213.6 12.6L218.6 11.9L223.7 13.0L228.8 12.6L233.9 12.5L239.0 11.1L244.1 10.4L249.2 11.3L254.2 9.5L259.3 11.0L264.4 10.9L269.5 9.6L274.6 10.6L279.7 10.0L284.7 11.1L289.8 9.5L294.9 7.9L300.0 7.2L300 56L0 56Z",
      label: "Heart rate over the activity, 117 to 169 bpm",
    },
    stats: [
      { label: "Distance", value: "8.02 km" },
      { label: "Time", value: "38:15" },
      { label: "Pace", value: "4:46 /km" },
      { label: "Heart rate", value: "162 bpm" },
      { label: "Load", value: "96" },
      { label: "Calories", value: "612 kcal" },
    ],
  },
  fitness: {
    series: yearSeries(),
    value: 54,
    status: msg("Productive"),
    scale: {
      segments: [{ weight: 10, hue: "cyan" }, { weight: 15, hue: "mint" }, { weight: 15, hue: "blue" }, { weight: 10, hue: "gold" }, { weight: 10, hue: "rose" }],
      marker: 0.38,
      labels: ["Fresh", "Form −7", "Strained"],
    },
  },
  load: {
    status: "Optimal",
    ratio: "1.12",
    scale: {
      segments: [{ weight: 8, hue: "blue" }, { weight: 5, hue: "mint" }, { weight: 2, hue: "gold" }, { weight: 5, hue: "rose" }],
      marker: 0.56,
      labels: ["0", "0.8", "1.3", "2.0"],
    },
    last7: 412,
    usual: 368,
  },
  streak: { weeks: 12, bestWeeks: 19, daysInRow: 4 },
  heat: { start: "2025-11-17", days: HEAT },
  goal: { status: "On track", doneMinutes: 178, goalMinutes: 330, plannedByTodayMinutes: 168 },
  volume: { status: "Building", hours: [4.2, 4.6, 5.0, 3.9, 5.3, 5.6, 6.0, 4.7, 6.2, 6.4, 6.1, 2.97], averageHours: 5.33 },
  year: {
    status: "+212 km",
    km: 1842,
    thisYear: cumulative(1842, 323, 0.4),
    lastYear: cumulative(1795, 365, 1.6),
    lastYearByNowKm: 1630,
    label: "Running distance this year against last year: 1,842 km by 19 November, 212 km ahead",
  },
  intensity: {
    status: "Well balanced",
    parts: [
      { label: "Easy", hue: "mint", percent: 78, minutes: 552 },
      { label: "Moderate", hue: "gold", percent: 14, minutes: 99 },
      { label: "Hard", hue: "rose", percent: 8, minutes: 57 },
    ],
  },
  sleep: { nights: [7.1, 6.4, 7.6, 7.0, 6.8, 7.9, 8.2, 7.1, 6.8, 7.4, 7.0, 7.3, 7.2, 7.7], averageHours: 7.25 },
  hrv: { status: "In range", days: hrvDays(), usual: [52, 64] },
  mix: {
    parts: [
      { label: "Run", hue: "mint", percent: 52, minutes: 708 },
      { label: "Ride", hue: "blue", percent: 27, minutes: 370 },
      { label: "Strength", hue: "orange", percent: 17, minutes: 228 },
      { label: "Swim", hue: "cyan", percent: 4, minutes: 54 },
    ],
  },
  thresholds: {
    status: "Excellent",
    vo2max: 52,
    scale: {
      segments: [{ weight: 10, hue: "rose" }, { weight: 10, hue: "gold" }, { weight: 10, hue: "blue" }, { weight: 10, hue: "mint" }],
      marker: 0.55,
      labels: ["30", "40", "50", "60", "70"],
    },
    paceSecPerKm: 268,
    heartRate: 168,
    races: [
      { name: "5K", seconds: 1300, paceSecPerKm: 260, deltaSeconds: -12 },
      { name: "10K", seconds: 2712, paceSecPerKm: 271, deltaSeconds: -26 },
      { name: "Half marathon", seconds: 6005, paceSecPerKm: 285, deltaSeconds: -62 },
      { name: "Marathon", seconds: 12680, paceSecPerKm: 300, deltaSeconds: -135 },
    ],
  },
  bests: [
    { name: "1 km", seconds: 232.4, date: "2026-10-03", isNew: false },
    { name: "5 km", seconds: 1318.13, date: "2026-11-07", isNew: true },
    { name: "10 km", seconds: 2762.87, date: "2026-09-12", isNew: false },
    { name: "Half marathon", seconds: 6151.05, date: "2026-04-26", isNew: false },
  ],
  month: {
    month: "2026-11",
    done: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19],
    planned: [20, 21, 22, 24, 25, 26, 28, 29],
  },
};

/* ───────────── Calendar ───────────── */

/** A recorded day. `activityId` is its page under Activities, for the days that list reaches back to. */
const done = (date: string, sport: Sport, name: string, detail: string, activityId?: string): CalendarEntry =>
  ({ id: `done-${date}`, date, sport, name, detail: sampleUnits(detail), status: "done", source: "sample", activityId });

/** A planned day. Its id doubles as the id of the sample workout it opens in the builder. */
const plan = (date: string, sport: Sport, name: string, detail: string, metres: number, load: number): CalendarEntry =>
  ({ id: `plan-${date}`, workoutId: `plan-${date}`, date, sport, name, detail: sampleUnits(detail), status: "planned", source: "sample", metres, load });

/** Six weeks from Mon 26 Oct 2026. Today is Thu 19 Nov; everything after it is planned. */
const ENTRIES: CalendarEntry[] = [
  done("2026-10-26", "ride", "Recovery ride", "22.4 km · 54:10"),
  done("2026-10-27", "strength", "Strength, upper", "46:30"),
  done("2026-10-28", "run", "Easy run", "6.02 km · 33:20"),
  done("2026-10-29", "run", "Tempo run", "7.01 km · 33:52"),
  done("2026-10-31", "swim", "Pool swim", "1,400 m · 29:40"),
  done("2026-11-01", "run", "Long run", "15.03 km · 1:21:05"),

  done("2026-11-02", "ride", "Recovery ride", "25.1 km · 59:30"),
  done("2026-11-03", "strength", "Strength, upper", "47:05", "2026-11-03-strength-upper-body"),
  done("2026-11-04", "run", "Easy run", "6.04 km · 33:30", "2026-11-04-easy-run"),
  done("2026-11-05", "run", "Tempo run", "8.00 km · 38:40", "2026-11-05-tempo-run"),
  done("2026-11-07", "strength", "Strength, lower", "46:20", "2026-11-07-strength-lower-body"),
  done("2026-11-08", "run", "Long run", "16.02 km · 1:26:10", "2026-11-08-long-run"),

  done("2026-11-10", "ride", "Hill ride", "38.2 km · 1:32:44", "2026-11-10-hill-ride"),
  done("2026-11-11", "strength", "Strength, lower", "44:52", "2026-11-11-strength-lower-body"),
  done("2026-11-12", "run", "Intervals, 6 × 800 m", "9.40 km · 46:31", "2026-11-12-intervals-6x800"),
  done("2026-11-13", "run", "Easy run", "5.02 km · 28:06", "2026-11-13-easy-run"),
  done("2026-11-14", "swim", "Pool swim", "1,500 m · 31:15", "2026-11-14-pool-swim"),
  done("2026-11-15", "run", "Long run", "18.04 km · 1:36:20", "2026-11-15-long-run"),

  done("2026-11-16", "ride", "Recovery ride", "24.6 km · 58:02", "2026-11-16-recovery-ride"),
  done("2026-11-17", "strength", "Strength, upper", "48:10", "2026-11-17-strength-upper-body"),
  done("2026-11-18", "run", "Easy run", "6.10 km · 33:48", "2026-11-18-easy-run"),
  done("2026-11-19", "run", "Morning tempo", "8.02 km · 38:14", "2026-11-19-morning-tempo"),
  plan("2026-11-20", "run", "Easy run", "6.0 km · 5:30 /km", 6000, 54),
  plan("2026-11-21", "strength", "Strength, lower", "6 exercises", 0, 44),
  plan("2026-11-22", "run", "Long run", "18.0 km · 5:20 /km", 18000, 112),

  plan("2026-11-23", "ride", "Recovery ride", "25 km", 25000, 62),
  plan("2026-11-24", "strength", "Strength, upper", "6 exercises", 0, 41),
  plan("2026-11-25", "run", "Easy run", "6.0 km", 6000, 54),
  plan("2026-11-26", "run", "Intervals, 5 × 1 km", "10.0 km", 10000, 110),
  plan("2026-11-28", "swim", "Pool swim", "1,500 m", 1500, 48),
  plan("2026-11-29", "run", "Long run", "20.0 km · 5:20 /km", 20000, 165),

  plan("2026-11-30", "ride", "Recovery ride", "25 km", 25000, 62),
  plan("2026-12-01", "strength", "Strength, upper", "6 exercises", 0, 41),
  plan("2026-12-02", "run", "Easy run", "6.0 km", 6000, 54),
  plan("2026-12-03", "run", "Tempo run", "9.0 km · 4:35 /km", 9000, 104),
  plan("2026-12-05", "strength", "Strength, lower", "6 exercises", 0, 44),
  plan("2026-12-06", "run", "Long run", "16.0 km", 16000, 135),
];

const WEEKS: WeekTotals[] = [
  { weekStart: "2026-10-26", timeSeconds: 4 * 3600 + 32 * 60, runMetres: 28100, load: 455, plannedLoad: null },
  { weekStart: "2026-11-02", timeSeconds: 5 * 3600 + 5 * 60, runMetres: 30100, load: 470, plannedLoad: null },
  { weekStart: "2026-11-09", timeSeconds: 5 * 3600 + 20 * 60, runMetres: 32500, load: 454, plannedLoad: null },
  { weekStart: "2026-11-16", timeSeconds: 2 * 3600 + 58 * 60, runMetres: 14100, load: 253, plannedLoad: 463 },
  { weekStart: "2026-11-23", timeSeconds: null, runMetres: 36000, load: null, plannedLoad: 480 },
  { weekStart: "2026-11-30", timeSeconds: null, runMetres: 31000, load: null, plannedLoad: 440 },
];

export const sampleCalendar: CalendarData = { today: "2026-11-19", entries: ENTRIES, weeks: WEEKS, now: { baseFitness: 52, loadRatio: 1.08 } };

/** The sample board in the app's language: the words above, translated now (the athlete's own names stay). */
export function sampleDashboardNow(): Dashboard {
  const d = sampleDashboard;
  const today = (time: string) => `${t("Today")}, ${time}`;
  const what: Record<string, string> = { Ride: tx("sport", "Ride"), Gym: t("Gym"), Easy: t("Easy"), Tempo: t("Tempo"), Long: t("Long") };
  const intensity: Record<string, string> = { Easy: t("Easy"), Moderate: t("Moderate"), Hard: t("Hard") };
  const yearDay = dateText(new Date(2026, 10, 19), locale("en-GB"), { day: "numeric", month: "long" });
  const shown = (km: number) => Math.round(distanceIn(km * 1000));
  const ahead = shown(d.year.km) - shown(d.year.lastYearByNowKm ?? 0);
  return {
    ...d,
    coach: d.coach && {
      text: t("Legs are fresh and HRV is up. A good day for the tempo you finished this morning; keep tomorrow easy."),
      nextLabel: t("Tomorrow: {workout}, {distance}", { workout: t("Easy run"), distance: sampleUnits("6.0 km") }),
    },
    morning: d.morning && {
      ...d.morning,
      rings: d.morning.rings.map((r) => ({ ...r, label: t(r.label) })),
      tiles: d.morning.tiles.map((x) => ({ ...x, label: t(x.label) })),
    },
    todayWorkout: {
      ...d.todayWorkout, detail: today("06:42"),
      stats: d.todayWorkout.stats.map((s) => ({ ...s, label: t(s.label), value: sampleUnits(s.value) })),
      week: d.todayWorkout.week.map((w, k) => ({ ...w, day: dayLetter(k), what: what[w.what] ?? w.what })),
    },
    latest: d.latest && {
      ...d.latest, when: today("06:42"), sport: tx("sport", d.latest.sport),
      routeLabel: t("Route of this morning's tempo run, an out-and-back along the river"),
      heart: d.latest.heart && { ...d.latest.heart, label: t("Heart rate over the activity, {low} to {high} bpm", { low: 117, high: 169 }) },
      stats: d.latest.stats.map((s) => ({ ...s, value: sampleUnits(s.value) })),
    },
    fitness: d.fitness && { ...d.fitness, scale: { ...d.fitness.scale, labels: [t("Fresh"), t("Form {value}", { value: "−7" }), t("Strained")] } },
    goal: d.goal && { ...d.goal, status: t("On track") },
    volume: { ...d.volume, status: d.volume.status && t("Building") },
    year: {
      ...d.year, status: `${signed(ahead)} ${distanceUnit()}`,
      label: t("Running distance this year against last year: {distance} by {day}, {by} ahead", { distance: `${thousands(shown(d.year.km))} ${distanceUnit()}`, day: yearDay, by: `${ahead} ${distanceUnit()}` }),
    },
    intensity: { ...d.intensity, status: d.intensity.status && t("Well balanced"), parts: d.intensity.parts.map((p) => ({ ...p, label: intensity[p.label] ?? p.label })) },
    hrv: d.hrv && { ...d.hrv, status: t("In range") },
    mix: { ...d.mix, parts: d.mix.parts.map((p) => ({ ...p, label: tx("sport", p.label) })) },
  };
}
