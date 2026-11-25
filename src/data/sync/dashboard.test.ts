import { describe, expect, it } from "vitest";
import { seedItems } from "@/data/sampleSeed";
import {
  buildDashboard, dayTotals, fitnessSeries, formScale, heatOf, hrvOf, latestActivity, latestStats, placeActivities, routeInBox, sportMix,
  streakOf, weeklyHours, weekMinutes, whenText, yearToDate, type DashboardItems,
} from "./dashboard";
import { calendarDayOf, dateToRef, type ActivityDetailBody, type NativeActivity, type NativeDayVitals, type NativeGymWorkout, type NativeSport, type SyncBodies } from "./native";

// Friday 20 November 2026, 14:10 local.
const NOW = new Date(2026, 10, 20, 14, 10);
const TODAY = "2026-11-20";

let n = 0;
const act = (day: string, sport: NativeSport, minutes: number, more: Partial<NativeActivity> = {}): NativeActivity => {
  const [y, m, d] = day.split("-").map(Number);
  return { id: `a${++n}`, name: "", sport, start: dateToRef(new Date(y, m - 1, d, 7, 30)), durationSeconds: minutes * 60, ...more };
};
const totalsOf = (list: NativeActivity[], days: NativeDayVitals[] = []) => dayTotals(placeActivities(list, NOW), days);

function seeded(): DashboardItems {
  const items = seedItems(NOW);
  const of = <C extends keyof SyncBodies>(c: C) => items.filter((i) => i.collection === c).map((i) => i.body as SyncBodies[C]);
  const activities = of("activity");
  const latest = latestActivity(activities, NOW);
  return {
    activities, days: of("health.day"), nights: of("health.night"), training: of("view.training")[0], planned: of("gym.planned"), routines: of("gym.routine"),
    latestDetail: items.find((i) => i.collection === "activity.detail" && i.id === latest?.id)?.body as ActivityDetailBody | undefined,
  };
}

describe("latest activity stats", () => {
  it("keeps the hundredths of a recorded time and reads pace per km for a run", () => {
    const run = act(TODAY, "run", 0, { distanceMeters: 8020, durationSeconds: 2293.75, averageHR: 158 });
    expect(latestStats(run)).toEqual([
      { label: "Distance", value: "8.02 km" },
      { label: "Time", value: "38:13.75" },
      { label: "Pace", value: "4:46 /km" }, // 2293.75 s / 8.02 km = 286.0 s
      { label: "Heart rate", value: "158 bpm" },
    ]);
  });
  it("reads a whole-second time without decimals, speed for a ride, metres and /100 m for a swim", () => {
    expect(latestStats(act(TODAY, "bike", 60, { distanceMeters: 24600 }))).toEqual([
      { label: "Distance", value: "24.60 km" }, { label: "Time", value: "1:00:00" }, { label: "Speed", value: "24.6 km/h" },
    ]);
    expect(latestStats(act(TODAY, "poolSwim", 0, { distanceMeters: 1500, durationSeconds: 1875 }))).toEqual([
      { label: "Distance", value: "1,500 m" }, { label: "Time", value: "31:15" }, { label: "Pace", value: "2:05 /100 m" },
    ]);
  });
  it("lists only what the activity holds", () => {
    expect(latestStats(act(TODAY, "strength", 45))).toEqual([{ label: "Time", value: "45:00" }]);
    expect(latestStats({ id: "x", name: "", sport: "other" })).toEqual([]);
  });
  it("says when it was", () => {
    expect(whenText(new Date(2026, 10, 20, 6, 42), NOW)).toBe("Today, 06:42");
    expect(whenText(new Date(2026, 10, 19, 18, 10), NOW)).toBe("Yesterday, 18:10");
    expect(whenText(new Date(2026, 10, 14, 8, 15), NOW)).toBe("Sat 14 Nov, 08:15");
  });
  it("leaves out activities that have no start or start after now", () => {
    const later = { ...act(TODAY, "run", 30), start: dateToRef(new Date(2026, 10, 20, 18, 0)) };
    expect(placeActivities([later, { id: "x", name: "", sport: "run" }], NOW)).toEqual([]);
  });
});

describe("route", () => {
  it("draws the seeded route inside the 280 × 104 box with 8 clear on every side", () => {
    const detail = seedItems(NOW).find((i) => i.collection === "activity.detail")!.body as ActivityDetailBody;
    const box = routeInBox(detail.route)!;
    expect(box.path.startsWith(`M${box.start[0]} ${box.start[1]}L`)).toBe(true);
    const numbers = box.path.split(/[ML ]/).filter(Boolean).map(Number);
    expect(numbers.length).toBe(detail.route!.length * 2);
    numbers.forEach((v, k) => {
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(k % 2 === 0 ? 272 : 96);
    });
  });
  it("is null without at least two points", () => {
    expect(routeInBox(undefined)).toBeNull();
    expect(routeInBox([[45.5, -73.5]])).toBeNull();
  });
});

describe("streak", () => {
  // This week (Mon 16 Nov) and the two before it, a week off, then four weeks in a row.
  const days = ["2026-11-20", "2026-11-19", "2026-11-18", "2026-11-10", "2026-11-03", "2026-10-20", "2026-10-13", "2026-10-06", "2026-09-29"];
  it("counts weeks in a row, the best run of weeks and days in a row", () => {
    expect(streakOf(new Set(days), TODAY)).toEqual({ weeks: 3, bestWeeks: 4, daysInRow: 3 });
  });
  it("does not break on a day or a week that has not been trained yet", () => {
    expect(streakOf(new Set(days.slice(1)), TODAY)).toEqual({ weeks: 3, bestWeeks: 4, daysInRow: 2 });
    expect(streakOf(new Set(days.slice(3)), TODAY)).toEqual({ weeks: 2, bestWeeks: 4, daysInRow: 0 });
    expect(streakOf(new Set(), TODAY)).toEqual({ weeks: 0, bestWeeks: 0, daysInRow: 0 });
  });
});

describe("streak with the gym logger", () => {
  it("counts a week trained only in the gym logger, as the phone does", () => {
    // Watch activities the weeks of 26 Oct and 9 Nov; the week between only has a logged gym workout.
    const items = { ...seeded(), activities: [act("2026-10-28", "run", 40), act("2026-11-11", "run", 40)], gym: [] as NativeGymWorkout[] };
    expect(buildDashboard({ ...items, gym: [] }, NOW).streak.weeks).toBe(1);
    const lifted: NativeGymWorkout = { id: "g1", name: "Legs", start: dateToRef(new Date(2026, 10, 4, 18, 0)) };
    expect(buildDashboard({ ...items, gym: [lifted] }, NOW).streak.weeks).toBe(3);
  });
});

describe("heat map", () => {
  it("covers 53 weeks from a Monday to today and levels days by quartile of load", () => {
    const heat = heatOf(totalsOf([
      act("2026-11-20", "run", 40, { trainingLoad: 40, name: "Tempo" }),
      act("2026-11-19", "run", 30, { trainingLoad: 30 }),
      act("2026-11-18", "bike", 20, { trainingLoad: 20 }),
      act("2026-11-17", "run", 10, { trainingLoad: 10 }),
      act("2026-11-16", "strength", 25),
    ]), TODAY);
    expect(heat.start).toBe("2025-11-17");
    expect(heat.days).toHaveLength(52 * 7 + 5);
    expect(heat.days.slice(-5).map((d) => d.level)).toEqual([1, 1, 2, 3, 4]);
    expect(heat.days[heat.days.length - 1]).toEqual({ level: 4, minutes: 40, load: 40, what: "Tempo" });
    expect(heat.days[heat.days.length - 4]).toEqual({ level: 1, minutes: 10, load: 10, what: "Run" });
    expect(heat.days[0]).toEqual({ level: 0, minutes: 0, load: 0, what: "" });
  });
  it("takes a day's load from the day's reading when its activities carry none", () => {
    const totals = totalsOf([act("2026-11-19", "run", 30)], [{ day: calendarDayOf("2026-11-19"), trainingLoad: 77 }, { day: calendarDayOf("2026-11-18"), trainingLoad: 50 }]);
    expect(totals.get("2026-11-19")?.load).toBe(77);
    expect(totals.has("2026-11-18")).toBe(false);
  });
});

describe("weeks", () => {
  const totals = totalsOf([
    act("2026-11-20", "run", 45.5), act("2026-11-16", "run", 30),
    act("2026-11-15", "bike", 60), act("2026-11-09", "run", 45),
  ]);
  it("adds up hours per Monday week, the last being this week so far", () => {
    const hours = weeklyHours(totals, TODAY);
    expect(hours).toHaveLength(12);
    expect(hours.slice(-3)).toEqual([0, 1.75, 1.26]); // 75.5 min = 1.2583 h
  });
  it("counts this week's minutes for the goal, Monday to today", () => {
    expect(weekMinutes(totals, TODAY)).toBe(76);
  });
  it("lines weekly load up with the fitness series' 7-day blocks, counted back from its last day", () => {
    const series = fitnessSeries(
      { start: "2026-11-05", fitness: Array.from({ length: 16 }, (_, k) => 40 + k), fatigue: Array.from({ length: 16 }, (_, k) => 50 + k) },
      totalsOf([
        act("2026-11-06", "run", 30, { trainingLoad: 99 }), // before the first whole block: dropped
        act("2026-11-10", "run", 30, { trainingLoad: 50 }), act("2026-11-13", "run", 30, { trainingLoad: 25 }),
        act("2026-11-14", "run", 30, { trainingLoad: 40 }), act("2026-11-20", "run", 30, { trainingLoad: 60 }),
      ]),
    )!;
    expect(series.start).toBe("2026-11-07");
    expect(series.fitness).toHaveLength(14);
    expect(series.fitness[0]).toBe(42);
    expect(series.fatigue[13]).toBe(65);
    expect(series.weeklyLoad).toEqual([75, 100]);
  });
  it("has no series without a start day or a whole week", () => {
    expect(fitnessSeries(undefined, new Map())).toBeNull();
    expect(fitnessSeries({ start: "2026-11-16", fitness: [1, 2, 3], fatigue: [1, 2, 3] }, new Map())).toBeNull();
  });
});

describe("year to date", () => {
  it("adds up running km per day of this year and of last year", () => {
    const y = yearToDate(placeActivities([
      act("2026-01-01", "run", 30, { distanceMeters: 5000 }), act("2026-11-20", "trailRun", 60, { distanceMeters: 10000 }),
      act("2026-06-01", "bike", 60, { distanceMeters: 30000 }),
      act("2025-11-20", "run", 40, { distanceMeters: 7000 }), act("2025-12-31", "run", 20, { distanceMeters: 3000 }),
    ], NOW), NOW);
    expect(y.thisYear).toHaveLength(324); // 20 November is day 324
    expect(y.thisYear[0]).toBe(5);
    expect(y.thisYear[322]).toBe(5);
    expect(y.km).toBe(15);
    expect(y.lastYear).toHaveLength(365);
    expect(y.lastYear[364]).toBe(10);
    expect(y.lastYearByNowKm).toBe(7);
  });
  it("leaves last year empty when it holds no run", () => {
    const y = yearToDate(placeActivities([act("2026-11-19", "run", 30, { distanceMeters: 6100 })], NOW), NOW);
    expect(y.km).toBe(6.1);
    expect(y.lastYear).toEqual([]);
    expect(y.lastYearByNowKm).toBeNull();
  });
});

describe("sport mix", () => {
  it("shares out the last 28 days by time, the percentages adding up to 100", () => {
    const parts = sportMix(placeActivities([
      act("2026-11-20", "run", 20), act("2026-11-10", "indoorBike", 20), act("2026-10-24", "poolSwim", 20),
      act("2026-10-23", "strength", 300), // 28 days before today: outside
    ], NOW), TODAY);
    expect(parts).toEqual([
      { label: "Run", hue: "mint", percent: 34, minutes: 20 },
      { label: "Ride", hue: "blue", percent: 33, minutes: 20 },
      { label: "Swim", hue: "cyan", percent: 33, minutes: 20 },
    ]);
  });
  it("adds up to 100 for the seeded athlete, largest first", () => {
    const d = buildDashboard(seeded(), NOW);
    expect(d.mix.parts.reduce((t, p) => t + p.percent, 0)).toBe(100);
    expect(d.mix.parts[0].label).toBe("Run");
    expect(d.mix.parts.map((p) => p.percent)).toEqual([...d.mix.parts.map((p) => p.percent)].sort((a, b) => b - a));
  });
  it("is empty with nothing recorded", () => {
    expect(sportMix([], TODAY)).toEqual([]);
  });
});

describe("scales and ranges", () => {
  it("places form on the fresh-to-strained scale as the canvas does", () => {
    const scale = formScale(54, 61);
    expect(scale.marker).toBe(0.38);
    expect(scale.labels).toEqual(["Fresh", "Form −7", "Strained"]);
  });
  it("puts HRV against the mean ± one standard deviation of the last 60 days", () => {
    const days = [50, 60, 50, 60].map((hrv, k) => ({ day: calendarDayOf(`2026-11-${17 + k}`), hrv }));
    expect(hrvOf(days, TODAY)).toEqual({ status: "In range", days: [50, 60, 50, 60], usual: [50, 60] });
    expect(hrvOf([...days.slice(0, 3), { day: calendarDayOf(TODAY), hrv: 80 }], TODAY)?.status).toBe("Above range");
    expect(hrvOf(days.slice(0, 1), TODAY)).toBeNull();
  });
});

describe("the board", () => {
  it("is honest empties when the phone has sent nothing", () => {
    const d = buildDashboard({ activities: [], days: [], nights: [], planned: [], routines: [] }, NOW);
    expect(d.today).toBe(TODAY);
    expect([d.coach, d.morning, d.latest, d.fitness, d.load, d.goal, d.sleep, d.hrv, d.thresholds]).toEqual(Array(9).fill(null));
    expect(d.todayWorkout.name).toBeNull();
    expect(d.todayWorkout.week.map((w) => w.state)).toEqual(Array(7).fill("none"));
    expect(d.todayWorkout.week[4].current).toBe(true);
    expect(d.streak).toEqual({ weeks: 0, bestWeeks: 0, daysInRow: 0 });
    expect(d.heat.days.every((x) => x.level === 0)).toBe(true);
    expect([d.intensity.parts, d.mix.parts, d.bests, d.year.lastYear, d.month.done, d.month.planned]).toEqual(Array(6).fill([]));
    expect(d.year.km).toBe(0);
    expect(d.volume.hours).toEqual(Array(12).fill(0));
  });

  it("builds every widget from the seeded items", () => {
    const items = seeded();
    const d = buildDashboard(items, NOW);
    const t = items.training!;

    expect(d.coach).toBeNull();
    expect(d.morning?.status).toBe("Ready");
    expect(d.morning?.rings.map((r) => [r.label, r.value])).toEqual([
      ["Readiness", "78"],
      ["Sleep", String(items.nights.find((x) => x.day.month === 11 && x.day.day === 20)!.score)],
      ["Load", t.load!.ratio!.toFixed(2)],
    ]);
    expect(d.morning?.rings[0].fraction).toBe(0.78);
    expect(d.morning?.tiles.map((x) => x.label)).toEqual(["HRV", "Resting HR", "Time asleep"]);
    expect(d.morning?.tiles[0].trend).toHaveLength(7);

    // Friday: a pool swim at 10:00 and strength at 12:15 are done; the long run is tomorrow.
    expect(d.latest?.name).toBe("Strength");
    expect(d.latest?.when).toBe("Today, 12:15");
    expect(d.latest?.routePath).toBeNull();
    // No route on a gym session; its heart rate still is.
    expect(d.latest?.heart?.line).toMatch(/^M0\.0 [\d.]+L/);
    expect(d.latest?.heart?.label).toMatch(/^Heart rate over the activity, \d+ to \d+ bpm$/);
    expect(d.latest).toMatchObject({ sport: "Strength", family: "Strength" });
    expect(d.latest?.stats.map((s) => s.label)).toEqual(["Time", "Heart rate", "Load", "Calories"]);
    expect(d.latest?.stats[0].value).toMatch(/^\d+:\d\d(\.\d\d)?$/);
    expect(d.todayWorkout.status).toBe("Done");
    expect(d.todayWorkout.name).toBe("Strength");
    expect(d.todayWorkout.detail).toBe("Today, 12:15");
    expect(d.todayWorkout.stats.map((s) => s.label)).toEqual(["Time", "Heart rate", "Load"]);
    expect(d.todayWorkout.next).toBeNull();
    expect(d.todayWorkout.week.map((w) => [w.what, w.state])).toEqual([
      ["Run", "done"], ["Strength", "done"], ["Run", "done"], ["Ride", "done"], ["Strength", "today"], ["Upper body", "planned"], ["", "none"],
    ]);

    expect(d.fitness?.series.fitness).toHaveLength(182);
    expect(d.fitness?.series.weeklyLoad).toHaveLength(26);
    const lastWeek = items.activities.filter((a) => a.start! >= dateToRef(new Date(2026, 10, 14))).reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
    expect(d.fitness?.series.weeklyLoad[25]).toBe(lastWeek);
    expect(d.fitness?.value).toBe(Math.round(t.fitness!.fitness[181]));
    expect(d.load?.ratio).toBe(t.load!.ratio!.toFixed(2));
    expect(d.load?.status).toBe("Optimized");
    expect(d.load?.last7).toBe(Math.round(t.load!.acute!));

    expect(d.streak.weeks).toBe(10); // nine full weeks of the seed span ten Monday weeks
    expect(d.streak.daysInRow).toBe(5);
    expect(d.goal?.goalMinutes).toBe(300);
    const weekSeconds = items.activities.filter((a) => a.start! >= dateToRef(new Date(2026, 10, 16))).reduce((s, a) => s + a.durationSeconds!, 0);
    expect(d.goal?.doneMinutes).toBe(Math.round(weekSeconds / 60));
    expect(d.goal?.plannedByTodayMinutes).toBeUndefined();
    expect(d.volume.hours[11]).toBe(Math.round((weekSeconds / 3600) * 100) / 100);

    expect(d.intensity.parts).toEqual([]);
    expect(d.sleep?.nights).toHaveLength(14);
    expect(d.hrv?.days).toHaveLength(30);
    expect(d.thresholds).toMatchObject({ vo2max: 54.3, paceSecPerKm: 268.4, heartRate: 168 });
    expect(d.thresholds?.races[0]).toEqual({ name: "5K", seconds: 1238.6, paceSecPerKm: 1238.6 / 5 });
    // The running bests come first; the seed's swim bests follow them.
    expect(d.bests.slice(0, 4).map((b) => [b.name, b.seconds])).toEqual([["1K", 231.84], ["5K", 1251.37], ["10K", 2634.05], ["Half marathon", 5890.62]]);
    expect(d.bests[0]).toMatchObject({ date: "2026-11-16", isNew: true }); // the second-newest run: Monday's easy run
    expect(d.bests[3].isNew).toBe(false);
    expect(d.month).toMatchObject({ month: "2026-11", planned: [21, 24] });
    expect(d.month.done).toContain(20);
    expect(d.month.done).not.toContain(8); // Sundays are rest days unless the hike falls on one
  });

  it("draws the latest activity's route when its detail is there", () => {
    const items = seeded();
    const tempo = items.activities.find((a) => a.name === "Morning tempo")!;
    const detail = seedItems(NOW).find((i) => i.collection === "activity.detail" && i.id === tempo.id)!.body as ActivityDetailBody;
    const d = buildDashboard({ ...items, activities: [tempo], latestDetail: detail }, NOW);
    expect(d.latest?.activityId).toBe(tempo.id);
    expect(d.latest?.routePath).toMatch(/^M[\d.]+ [\d.]+L/);
    // Inside the 300 × 170 map, clear of its edges.
    for (const [x, y] of [d.latest!.routeStart, d.latest!.routeEnd]) {
      expect(x).toBeGreaterThanOrEqual(26); expect(x).toBeLessThanOrEqual(274);
      expect(y).toBeGreaterThanOrEqual(26); expect(y).toBeLessThanOrEqual(144);
    }
    expect(d.latest).toMatchObject({ sport: "Run", family: "Run" });
    // The heart trace goes with the route now, under the numbers.
    expect(d.latest?.heart === null || /^M0\.0 [\d.]+L/.test(d.latest!.heart.line)).toBe(true);
    expect(d.latest?.stats.map((s) => s.label)).toEqual(["Distance", "Time", "Pace", "Heart rate", "Load", "Calories"]);
    expect(d.latest?.stats[1].value).toMatch(/^\d\d:\d\d\.\d\d$/);
  });

  it("shows today's planned session, or the next one on a rest day", () => {
    const items = seeded();
    const before = items.activities.filter((a) => a.start! < dateToRef(new Date(2026, 10, 20)));
    const upper = items.routines.find((r) => r.name === "Upper body")!;
    const planned = { id: "P", routineID: upper.id, day: calendarDayOf(TODAY) };
    const gym: NativeGymWorkout[] = [{ id: "G", name: "Upper body", routineID: upper.id, start: dateToRef(new Date(2026, 10, 12, 12, 0)), entries: [] }];
    const p = buildDashboard({ ...items, activities: before, planned: [planned], gym }, NOW).todayWorkout;
    expect([p.status, p.name, p.detail]).toEqual(["Planned", "Upper body", "Strength block"]);
    expect(p.stats).toEqual([{ label: "Exercises", value: "6" }, { label: "Sets", value: "20" }, { label: "Last done", value: "Thu 12 Nov" }]);

    const rest = buildDashboard({ ...items, activities: before }, NOW).todayWorkout;
    expect(rest.name).toBeNull();
    expect(rest.next).toEqual({ name: "Upper body", when: "Tomorrow" });
  });
});

describe("the sample athlete", () => {
  it("always has today on the board, however early it is", () => {
    const early = new Date(2026, 10, 25, 0, 50); // a Wednesday, before the 07:42 tempo run
    const items = seedItems(early);
    const of = <C extends keyof SyncBodies>(c: C) => items.filter((i) => i.collection === c).map((i) => i.body as SyncBodies[C]);
    const activities = of("activity"), latest = latestActivity(activities, early)!;
    const d = buildDashboard({
      activities, days: of("health.day"), nights: of("health.night"), training: of("view.training")[0], planned: of("gym.planned"), routines: of("gym.routine"),
      latestDetail: items.find((i) => i.collection === "activity.detail" && i.id === latest.id)?.body as ActivityDetailBody,
    }, early);
    expect(d.todayWorkout).toMatchObject({ status: "Planned", name: "Deadlift day" });
    expect(d.latest?.when).toMatch(/^Yesterday/);
    expect(d.latest?.routePath ?? d.latest?.heart?.line).toBeTruthy();
  });
});
