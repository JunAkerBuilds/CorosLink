import { describe, expect, it } from "vitest";
import { healthFromItems, measureMaths, nightFromItem } from "./health";
import { dateToRef, type EnergyDayBody, type NativeDayVitals, type NativeSleepNight } from "./native";
import { seedItems } from "@/data/sampleSeed";
import { clockOfDay, nightTotals, stageTotals } from "@/lib/health";

const NOW = new Date(2026, 10, 20, 14, 10);
const seed = seedItems(NOW);
const of = <B,>(collection: string) => seed.filter((i) => i.collection === collection).map((i) => ({ id: i.id, body: i.body as B }));
const days = of<NativeDayVitals>("health.day"), nights = of<NativeSleepNight>("health.night"), energy = of<EnergyDayBody>("energy.day");
const cal = (d: Date) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });

describe("nightFromItem", () => {
  it("turns ordered stages into segments that add up to the night", () => {
    const at = (h: number, m: number) => dateToRef(new Date(2026, 10, h >= 12 ? 19 : 20, h, m));
    const night = nightFromItem({
      day: cal(NOW), totalMinutes: 440, score: 84, averageHR: 51, bedtime: at(22, 58), wakeTime: at(6, 30),
      // Out of order on purpose.
      stages: [
        { start: at(23, 30), end: at(0, 45), stage: "deep" },
        { start: at(22, 58), end: at(23, 30), stage: "light" },
        { start: at(0, 45), end: at(0, 57), stage: "awake" },
        { start: at(0, 57), end: at(6, 30), stage: "rem" },
      ],
    });
    expect(night.segments).toEqual([
      { stage: "light", minutes: 32 }, { stage: "deep", minutes: 75 }, { stage: "awake", minutes: 12 }, { stage: "rem", minutes: 333 },
    ]);
    expect(night.startMinute).toBe(22 * 60 + 58);
    expect(stageTotals(night.segments).inBed).toBe(452); // 22:58 → 06:30
    expect(clockOfDay(night.startMinute! + nightTotals(night).inBed!)).toBe("06:30");
    expect(nightTotals(night).asleep).toBe(440);
    expect(night.score).toBe(84);
    expect(night.heartRateAsleep).toBe(51);
    expect(night.rating).toBeUndefined();
  });

  it("keeps a totals-only night without segments", () => {
    const night = nightFromItem({ day: cal(NOW), totalMinutes: 420, deepMinutes: 80, lightMinutes: 250, remMinutes: 90 });
    expect(night.segments).toEqual([]);
    expect(night.startMinute).toBeNull();
    expect(night.score).toBeNull();
    expect(nightTotals(night)).toEqual({ awake: null, rem: 90, light: 250, deep: 80, asleep: 420, inBed: null });
  });

  it("maps the seed's latest night: stages sum to bedtime → wake time", () => {
    const latest = nights[nights.length - 1].body;
    const night = nightFromItem(latest);
    const t = stageTotals(night.segments);
    expect(t.asleep).toBe(latest.totalMinutes);
    expect(t.awake).toBe(latest.awakeMinutes);
    expect(t.inBed).toBeCloseTo((latest.wakeTime! - latest.bedtime!) / 60, 6);
  });
});

describe("measureMaths", () => {
  it("averages the last seven days and places today in the 30-day range", () => {
    // 40 days: ten old days at 100 (outside the 30-day window), then 20…49, with the last one set to 41.
    const values: (number | null)[] = [...Array(10).fill(100), ...Array.from({ length: 30 }, (_, k) => 20 + k)];
    values[39] = 41;
    // Last seven: 43, 44, 45, 46, 47, 48, 41 → 314 / 7. Range of the last 30: 20…48 → (41 − 20) / 28 = 75%.
    expect(measureMaths(values)).toEqual({ today: 41, week: 314 / 7, position: 75 });
  });
  it("skips empty days, and has no position without a range", () => {
    expect(measureMaths([50, null, null, 60, null, 58])).toEqual({ today: 58, week: 56, position: 80 });
    expect(measureMaths([null, 62])).toEqual({ today: 62, week: 62, position: null });
    expect(measureMaths([61, null])).toBeNull();
    expect(measureMaths([])).toBeNull();
  });
});

describe("healthFromItems", () => {
  it("builds the page from the seed", () => {
    const h = healthFromItems(days, nights, energy, NOW);
    expect(h.lastDay).toBe("2026-11-20");
    const today = energy[energy.length - 1].body;
    expect(h.energyNow).toBe(today.now!.level);
    expect(h.morning.map((m) => m.name)).toEqual(["HRV", "Resting heart rate", "Sleep", "Stress", "Sleep score", "Energy on waking"]);
    const v = days[days.length - 1].body;
    expect(h.morning[0].today).toBe(`${v.hrv} ms`);
    expect(h.morning[1].today).toBe(`${v.restingHR} bpm`);
    const m = nights[nights.length - 1].body.totalMinutes!;
    expect(h.morning[2].today).toBe(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`);
    expect(h.trends.map((t) => t.id)).toEqual(["hrv", "rhr", "sleep", "stress", "steps", "energy"]);
    for (const t of h.trends) expect(t.values).toHaveLength(60);
    expect(h.trends[4].values[59]).toBe(v.steps);
    // Energy goes back 14 days only: empty before that, the waking level after.
    const waking = h.trends[5].values;
    expect(waking.slice(0, 46).every((x) => x == null)).toBe(true);
    expect(waking[59]).toBe(today.woke!.level);
  });

  it("leaves a missing day empty in every series", () => {
    const day = (d: number, body: Partial<NativeDayVitals>) => ({ id: `2026-11-${d}`, body: { day: { year: 2026, month: 11, day: d }, ...body } });
    const h = healthFromItems([day(16, { hrv: 60, steps: 9000 }), day(17, { hrv: 64 }), day(20, { hrv: 58, steps: 4000 })],
      [{ id: "2026-11-17", body: { day: { year: 2026, month: 11, day: 17 }, totalMinutes: 450 } }], [], NOW);
    const by = Object.fromEntries(h.trends.map((t) => [t.id, t.values]));
    expect(by.hrv).toEqual([60, 64, null, null, 58]);
    expect(by.steps).toEqual([9000, null, null, null, 4000]);
    expect(by.sleep).toEqual([null, 7.5, null, null, null]);
    expect(Object.keys(by)).toEqual(["hrv", "sleep", "steps"]);
    // HRV today 58, week mean of 60, 64, 58, range 58…64 → 0%. No sleep reading today: no Sleep row.
    expect(h.morning).toEqual([{ name: "HRV", today: "58 ms", week: "61", position: 0, hue: "cyan" }]);
    expect(h.energyNow).toBeNull();
  });

  it("is an honest empty with no items, and drops a stale 'now'", () => {
    expect(healthFromItems([], [], [], NOW)).toEqual({ lastDay: "2026-11-20", energyNow: null, night: null, morning: [], trends: [] });
    const stale = healthFromItems([], [], [{ id: "2026-11-19", body: { now: { minute: 900, level: 57 }, woke: { minute: 400, level: 80 } } }], NOW);
    expect(stale.energyNow).toBeNull();
    expect(stale.trends.map((t) => [t.id, t.values])).toEqual([["energy", [80]]]);
  });
});
