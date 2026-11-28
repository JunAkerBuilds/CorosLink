import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/calendar";
import { buildDashboard } from "./dashboard";
import { calendarDayOf, dateToRef, type NativeActivity, type NativeDayVitals, type NativeSleepNight } from "./native";
import { band, effortOf, estimatedMaxHR, FITNESS_DAYS, fitnessOf, loadOf, loadStatus, localTraining, readinessOf, zoneWeight } from "./trainingLocal";

// Friday 20 November 2026, 14:10 local.
const NOW = new Date(2026, 10, 20, 14, 10);
const TODAY = "2026-11-20";

let n = 0;
const at = (day: string, hour = 7, minute = 30) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute);
};
const act = (day: string, minutes: number, more: Partial<NativeActivity> = {}): NativeActivity =>
  ({ id: `a${++n}`, name: "", sport: "run", start: dateToRef(at(day)), durationSeconds: minutes * 60, averageHR: 150, maxHR: 185, ...more });
const vitals = (day: string, more: Partial<NativeDayVitals>): NativeDayVitals => ({ day: calendarDayOf(day), ...more });
const night = (day: string, minutes: number, more: Partial<NativeSleepNight> = {}): NativeSleepNight => ({
  day: calendarDayOf(day), totalMinutes: minutes,
  bedtime: dateToRef(at(addDays(day, -1), 23, 0)), wakeTime: dateToRef(new Date(at(addDays(day, -1), 23, 0).getTime() + minutes * 60000)), ...more,
});
/** Every day from `days` back to today. */
const back = (days: number) => Array.from({ length: days }, (_, k) => addDays(TODAY, -(days - 1 - k)));

describe("fitness and freshness", () => {
  it("reads max heart rate from the workouts, past a lone spike", () => {
    expect(estimatedMaxHR([act(TODAY, 30, { maxHR: 186 }), act(TODAY, 30, { maxHR: 190 })])).toBe(190);
    expect(estimatedMaxHR([act(TODAY, 30, { maxHR: 186 }), act(TODAY, 30, { maxHR: 215 })])).toBe(186);
    expect(estimatedMaxHR([act(TODAY, 30, { maxHR: 90 })])).toBeNull();
  });

  it("scores a workout in Edwards' zones from its average", () => {
    expect(zoneWeight(90, 200)).toBe(0);
    expect(zoneWeight(150, 200)).toBe(3);
    expect(zoneWeight(185, 200)).toBe(5);
    expect(effortOf(act(TODAY, 60, { averageHR: 150 }), 200)).toBe(180);
    expect(effortOf(act(TODAY, 60, { averageHR: undefined }), 200)).toBeNull();
  });

  it("runs the 42- and 7-day averages from the first workout to today", () => {
    const f = fitnessOf([act(addDays(TODAY, -2), 60, { averageHR: 150, maxHR: 200 })], NOW)!;
    expect(f.start).toBe(addDays(TODAY, -2));
    expect(f.fitness).toEqual([4.3, 4.2, 4.1]);
    expect(f.fatigue).toEqual([25.7, 22, 18.9]);
  });

  it("keeps the last year and leaves future workouts out", () => {
    const f = fitnessOf([act(addDays(TODAY, -500), 60), act(addDays(TODAY, 2), 60)], NOW)!;
    expect(f.fitness).toHaveLength(FITNESS_DAYS);
    expect(f.start).toBe(addDays(TODAY, -(FITNESS_DAYS - 1)));
  });

  it("has nothing without heart rate", () => {
    expect(fitnessOf([act(TODAY, 60, { averageHR: undefined, maxHR: undefined })], NOW)).toBeUndefined();
  });
});

describe("training load", () => {
  it("takes the watch's reading from the last two days", () => {
    const load = loadOf([act(TODAY, 30, { trainingLoad: 80 })], [vitals(addDays(TODAY, -1), { acuteLoad: 60, chronicLoad: 50, loadRatio: 1.2, loadComment: "Optimized" })], NOW);
    expect(load).toEqual({ acute: 60, chronic: 50, ratio: 1.2, status: "Optimized", weekTotal: 80 });
  });

  it("works it out from six weeks of workouts otherwise", () => {
    const steady = back(60).map((d) => act(d, 45, { trainingLoad: 50 }));
    // The watch's reading is five days old: too old to stand.
    const load = loadOf(steady, [vitals(addDays(TODAY, -5), { acuteLoad: 10, chronicLoad: 10 })], NOW)!;
    expect(load).toEqual({ acute: 50, chronic: 50, ratio: 1, status: "Optimized", weekTotal: 350 });
  });

  it("says nothing with under six weeks of history", () => {
    expect(loadOf(back(20).map((d) => act(d, 45, { trainingLoad: 50 })), [], NOW)).toBeUndefined();
  });

  it("names the ratio in COROS's words", () => {
    expect([0.5, 0.9, 1.1, 1.4, 1.8].map(loadStatus)).toEqual(["Decreasing", "Maintaining", "Optimized", "Performance", "Excessive"]);
  });
});

describe("readiness", () => {
  const days = back(30).map((d, k) => vitals(d, { hrv: 60 + (k % 3), restingHR: 50 }));
  const nights = back(10).map((d) => night(d, 480, { score: 80 }));

  it("scores a usual day from HRV, sleep and resting heart rate", () => {
    const r = readinessOf(days, nights, undefined, NOW)!;
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.status).toBe(band(r.score));
  });

  it("is held down by a short night", () => {
    const short = [...nights.slice(0, -1), night(TODAY, 240, { score: 40 })];
    expect(readinessOf(days, short, undefined, NOW)!.score).toBeLessThanOrEqual(64);
  });

  it("moves with today's feel check", () => {
    const usual = readinessOf(days, nights, undefined, NOW)!.score;
    const feel = { day: calendarDayOf(TODAY), feel: 1, tags: [] };
    expect(readinessOf(days, nights, feel, NOW)!.score).toBe(usual - 12);
    expect(readinessOf(days, nights, { ...feel, feel: 3, tags: ["unwell"] }, NOW)!.score).toBe(40);
  });

  it("needs HRV or last night among at least two parts", () => {
    expect(readinessOf([], [night(TODAY, 480)], undefined, NOW)).toBeUndefined();
    expect(readinessOf(days.slice(-3), [], undefined, NOW)).toBeUndefined();
  });
});

describe("the dashboard with no phone", () => {
  it("fills fitness, load and readiness from the computer's own items", () => {
    const activities = back(60).map((d) => act(d, 45, { trainingLoad: 50 }));
    const items = { activities, days: back(30).map((d) => vitals(d, { hrv: 60, restingHR: 50 })), nights: back(10).map((d) => night(d, 480, { score: 80 })) };
    const training = localTraining(items, NOW);
    const board = buildDashboard({ ...items, training, planned: [], routines: [] }, NOW);
    expect(board.fitness?.value).toBeGreaterThan(0);
    expect(board.load?.ratio).toBe(training!.load!.ratio!.toFixed(2));
    expect(board.morning?.rings.map((r) => r.value).every((v) => v !== "—")).toBe(true);
    expect(board.morning?.status).toBe(training!.readiness!.status);
  });

  it("is nothing when the computer has nothing", () => {
    expect(localTraining({ activities: [], days: [], nights: [] }, NOW)).toBeUndefined();
  });
});

describe("Coach with no phone", () => {
  it("reads the computer's training view, and the phone's once one has synced", async () => {
    const { athleteItems } = await import("@/lib/coach/items");
    const rows = [
      ...back(60).map((d, k) => ({ collection: "activity", id: `c${k}`, body: act(d, 45, { trainingLoad: 50 }) })),
      ...back(30).map((d) => ({ collection: "health.day", id: d, body: vitals(d, { hrv: 60, restingHR: 50 }) })),
      ...back(10).map((d) => ({ collection: "health.night", id: d, body: night(d, 480, { score: 80 }) })),
    ];
    const local = athleteItems(rows, NOW).training;
    expect(local?.load?.ratio).toBe(1);
    expect(local?.readiness?.score).toBeGreaterThan(0);
    expect(local?.fitness?.fitness.length).toBe(60);
    const phone = { vo2max: 52 };
    expect(athleteItems([...rows, { collection: "view.training", id: "me", body: phone }], NOW).training).toEqual(phone);
  });
});
