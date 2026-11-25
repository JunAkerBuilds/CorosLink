import { describe, expect, it } from "vitest";
import { bandsOfDay, energyDayFromItem, energyFromItems, eventsOfDay, pointsOfDay } from "./energy";
import type { EnergyDayBody, NativeSleepNight } from "./native";
import { seedItems } from "@/data/sampleSeed";
import { energyRange, energyTotals } from "@/lib/health";

const NOW = new Date(2026, 10, 20, 14, 10);
const seed = seedItems(NOW);
const of = <B,>(collection: string) => seed.filter((i) => i.collection === collection).map((i) => ({ id: i.id, body: i.body as B }));
const items = of<EnergyDayBody>("energy.day"), nights = of<NativeSleepNight>("health.night");

const body: EnergyDayBody = {
  points: [{ minute: -60, level: 40 }, { minute: 60, level: 50 }, { minute: 400, level: 88.4 }, { minute: 600, level: 61 }, { minute: 900, level: 70 }],
  events: [
    { kind: "awake", startMinute: 400, endMinute: 480, change: -3.4 },
    { kind: "sleep", startMinute: -60, endMinute: 400, change: 48.4, sleepScore: 84 },
    { kind: "workout", startMinute: 480, endMinute: 525, change: -21.6, workoutName: "Morning tempo" },
    { kind: "awake", startMinute: 525, endMinute: 600, change: -2.4 },
    { kind: "rest", startMinute: 600, endMinute: 660, change: 9 },
    { kind: "stress", startMinute: 700, endMinute: 745, averageStress: 61 },
  ],
  bedtime: { minute: -60, level: 40 }, woke: { minute: 400, level: 88.4 },
  now: { minute: 900, level: 70 }, trend: "usingSlowly",
  projection: [{ minute: 900, level: 70 }, { minute: 1380, level: 46 }],
};

describe("energy day mapping", () => {
  it("cuts readings to the day, reading the level at midnight off the line", () => {
    expect(pointsOfDay(body.points!)).toEqual([
      { minute: 0, level: 45 }, { minute: 60, level: 50 }, { minute: 400, level: 88 }, { minute: 600, level: 61 }, { minute: 900, level: 70 },
    ]);
    expect(pointsOfDay([])).toEqual([]);
  });

  it("starts a night from the evening before at 00:00 and names workouts", () => {
    expect(bandsOfDay(body.events!)).toEqual([
      { kind: "sleep", from: 0, to: 400, label: "Sleep" },
      { kind: "workout", from: 480, to: 525, label: "Morning tempo" },
      { kind: "rest", from: 600, to: 660, label: "Rest" },
      { kind: "stress", from: 700, to: 745, label: "Stress" },
    ]);
  });

  it("lists events in order with time awake as one entry, and skips one without a change", () => {
    expect(eventsOfDay(body.events!, true)).toEqual([
      { kind: "sleep", name: "Sleep", detail: "23:00 – 06:40 · Score 84", delta: 48, when: "23:00 – 06:40" },
      { kind: "workout", name: "Morning tempo", detail: "08:00 – 08:45", delta: -22 },
      { kind: "rest", name: "Rest", detail: "10:00 – 11:00", delta: 9 },
      { kind: "awake", name: "Awake", detail: "The rest of the day so far", delta: -6, when: "so far" },
    ]);
    expect(eventsOfDay(body.events!, false).at(-1)).toEqual({ kind: "awake", name: "Awake", detail: "The rest of the day", delta: -6 });
  });

  it("builds the current day: low and high since waking, pace, projected bedtime, sleep", () => {
    const night: NativeSleepNight = { day: { year: 2026, month: 11, day: 20 }, totalMinutes: 447, score: 80 };
    const day = energyDayFromItem("2026-11-20", body, true, night)!;
    expect(day.woke).toEqual({ minute: 400, level: 88 });
    expect([day.low, day.high]).toEqual([61, 88]);
    expect(day.now).toEqual({ minute: 900, level: 70 });
    expect(day.pace).toEqual({ label: "Using slowly", direction: "down" });
    expect(day.bedtime).toEqual({ minute: 1380, level: 46 }); // the projection's end, not last night's bedtime
    expect(day.sleep).toEqual({ minutes: 447, score: 84 });
    expect(day.note).toBeUndefined();
    expect(day.headline).toBeUndefined();
    expect(day.learning).toBeUndefined();
  });

  it("drops now, pace and projection on a day that is over, and shades the next night's evening", () => {
    const next: EnergyDayBody = { events: [{ kind: "sleep", startMinute: -62, endMinute: 402, change: 41.5 }] };
    const day = energyDayFromItem("2026-11-19", { ...body, learning: true }, false, undefined, next)!;
    expect(day.now).toBeUndefined();
    expect(day.pace).toBeUndefined();
    expect(day.bedtime).toBeUndefined();
    expect(day.sleep).toBeUndefined();
    expect(day.learning).toBe(true);
    expect(day.bands.at(-1)).toEqual({ kind: "sleep", from: 1378, to: 1440, label: "Sleep" });
  });

  it("copes with what is missing", () => {
    expect(energyDayFromItem("2026-11-20", {}, true)).toBeNull();
    const bare = energyDayFromItem("2026-11-20", { points: [{ minute: 30, level: 52 }, { minute: 90, level: 49 }] }, true)!;
    expect(bare).toEqual({ date: "2026-11-20", points: [{ minute: 30, level: 52 }, { minute: 90, level: 49 }], bands: [], events: [], woke: null, low: 49, high: 52 });
    const steady = energyDayFromItem("2026-11-20", { woke: { minute: 400, level: 80 }, now: { minute: 500, level: 79 }, trend: "steady" }, true)!;
    expect(steady.pace).toEqual({ label: "Holding steady", direction: "flat" });
    expect([steady.low, steady.high]).toEqual([80, 80]);
    expect(steady.bedtime).toBeUndefined();
  });
});

describe("energyFromItems on the seed", () => {
  const days = energyFromItems(items, nights, NOW);

  it("has the seed's 14 days, oldest first, the last one still running", () => {
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-11-07");
    expect(days[13].date).toBe("2026-11-20");
    expect(days.slice(0, 13).every((d) => d.now == null && d.pace == null && d.bedtime == null)).toBe(true);
    const today = days[13], raw = items[13].body;
    expect(today.now).toEqual({ minute: 14 * 60 + 10, level: raw.now!.level });
    expect(today.pace).toEqual({ label: "Using slowly", direction: "down" });
    expect(today.bedtime).toEqual({ minute: 1370, level: raw.projection!.at(-1)!.level });
  });

  it("keeps every day inside 00:00…24:00 with its range since waking", () => {
    days.forEach((d, k) => {
      const raw = items[k].body;
      expect(d.points[0].minute).toBe(0);
      expect(d.points.every((p) => p.minute >= 0 && p.minute <= 1440)).toBe(true);
      expect(d.woke).toEqual(raw.woke);
      expect(energyRange(d.points, d.woke!.minute)).toEqual({ low: d.low, high: d.high });
      expect(d.high).toBeGreaterThanOrEqual(d.woke!.level);
      // The night started the evening before (negative minute): its band starts at midnight.
      const sleep = raw.events!.find((e) => e.kind === "sleep")!;
      expect(sleep.startMinute).toBeLessThan(0);
      expect(d.bands[0]).toEqual({ kind: "sleep", from: 0, to: sleep.endMinute, label: "Sleep" });
      expect(d.events[0].kind).toBe("sleep");
      expect(d.events[0].delta).toBe(Math.round(sleep.change!));
      expect(d.events.filter((e) => e.kind === "awake")).toHaveLength(1);
      const awake = raw.events!.filter((e) => e.kind === "awake").reduce((sum, e) => sum + e.change!, 0);
      expect(d.events.at(-1)!.delta).toBe(Math.round(awake));
      expect(energyTotals(d.events).charged).toBeGreaterThan(0);
      expect(d.sleep?.minutes).toBe(nights.find((n) => n.id === d.date)!.body.totalMinutes);
    });
    // Every day but the last is shaded for the night that follows it.
    for (const d of days.slice(0, 13)) expect(d.bands.at(-1)).toMatchObject({ kind: "sleep", to: 1440 });
  });
});
