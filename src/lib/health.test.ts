import { describe, expect, it } from "vitest";
import {
  bandAt, clockOfDay, dayLabel, dayMonth, dialArc, durationShort, energyAt, energyRange, energyTotals, hoursLong,
  lastDays, mean, scatter, gapLinePath, nightTotals, present, stageAt, stageSpans, stageTotals, trendScale, energySteps, lowestSinceWaking, shareWords,
} from "./health";
import { sampleHealth } from "@/data/sample/health";
import { sampleEnergy } from "@/data/sample/energy";

describe("dialArc", () => {
  it("matches the sleep dial on the canvas (r 93, score 84)", () => {
    const a = dialArc(93, 0.84);
    expect(a.circumference.toFixed(1)).toBe("584.3");
    expect(a.track.toFixed(1)).toBe("438.3");
    expect(a.value.toFixed(1)).toBe("368.1");
  });
  it("matches the energy gauge (r 98, level 64)", () => {
    const a = dialArc(98, 0.64);
    expect(a.circumference.toFixed(1)).toBe("615.8");
    expect(a.track.toFixed(1)).toBe("461.8");
    expect(a.value.toFixed(1)).toBe("295.6");
  });
  it("clamps the fill to the track", () => {
    expect(dialArc(50, 1.4).value).toBe(dialArc(50, 1).track);
    expect(dialArc(50, -1).value).toBe(0);
    expect(dialArc(50, NaN).value).toBe(0);
  });
});

describe("sleep stages", () => {
  const night = sampleHealth.night!;
  it("adds up to the numbers on the sleep panel", () => {
    const t = stageTotals(night.segments);
    expect(durationShort(t.deep)).toBe("1h 28m");
    expect(durationShort(t.light)).toBe("4h 28m");
    expect(durationShort(t.rem)).toBe("1h 46m");
    expect(durationShort(t.awake)).toBe("14m");
    expect(durationShort(t.asleep)).toBe("7h 42m");
    expect(clockOfDay(night.startMinute!)).toBe("22:58");
    expect(clockOfDay(night.startMinute! + t.inBed)).toBe("06:54");
  });
  it("is zero for an empty night", () => {
    expect(stageTotals([])).toEqual({ awake: 0, rem: 0, light: 0, deep: 0, asleep: 0, inBed: 0 });
    expect(stageAt([], 10)).toBeNull();
  });
  it("finds the stretch under a minute", () => {
    const spans = stageSpans(night.segments);
    expect(spans[1]).toEqual({ index: 1, stage: "deep", from: 20, to: 50 });
    expect(stageAt(night.segments, 0)?.index).toBe(0);
    expect(stageAt(night.segments, 20)?.index).toBe(1);
    expect(stageAt(night.segments, 49.9)?.stage).toBe("deep");
    expect(stageAt(night.segments, -5)?.index).toBe(0);
    expect(stageAt(night.segments, 9999)?.index).toBe(spans.length - 1);
  });
});

describe("labels", () => {
  it("formats durations and clock times", () => {
    expect(durationShort(60)).toBe("1h 00m");
    expect(hoursLong(7.7)).toBe("7 h 42 min");
    expect(hoursLong(6.9999)).toBe("7 h 00 min");
    expect(clockOfDay(0)).toBe("00:00");
    expect(clockOfDay(1440)).toBe("24:00");
    expect(clockOfDay(-62)).toBe("22:58");
    expect(clockOfDay(850)).toBe("14:10");
  });
  it("formats days without relying on the locale", () => {
    const d = new Date(2026, 10, 19);
    expect(dayLabel(d)).toBe("Thu 19 Nov");
    expect(dayMonth(new Date(2026, 9, 21))).toBe("21 Oct");
    expect(dayMonth(d, true)).toBe("19 Nov 2026");
  });
});

describe("trend series", () => {
  it("keeps the canvas's last 30 days and its latest readings", () => {
    const hrv = sampleHealth.trends[0];
    const month = lastDays(hrv.values, 30);
    expect(month).toHaveLength(30);
    expect(month[29]).toBe(62);
    // First day of the canvas series: 56 + scatter(0, 1) * 9.
    expect(month[0]).toBeCloseTo(56 + scatter(0, 1) * 9, 10);
    expect(month[10]).toBeCloseTo(56 + 10 * 0.12 + scatter(10, 1) * 9, 10);
    expect(sampleHealth.trends.map((t) => t.values[t.values.length - 1])).toEqual([62, 48, 7.7, 28, 8412, 81]);
  });
  it("has a year of plausible readings for the longer ranges", () => {
    for (const t of sampleHealth.trends) {
      expect(t.values).toHaveLength(365);
      expect(t.values.every((v) => v != null && Number.isFinite(v) && v > 0)).toBe(true);
    }
    expect(lastDays([1, 2, 3], 7)).toEqual([1, 2, 3]);
  });
  it("pads the scale and averages", () => {
    expect(trendScale([10, 20])).toEqual([8.8, 21.2]);
    expect(trendScale([5, 5])).toEqual([4, 6]);
    expect(trendScale([])).toEqual([0, 1]);
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
  });
});

describe("energy", () => {
  const today = sampleEnergy.days[sampleEnergy.days.length - 1];
  it("sums charged and used as on the canvas", () => {
    const t = energyTotals(today.events);
    expect(t.charged).toBe(68);
    expect(t.used).toBe(33);
    expect(t.chargedBy).toEqual([{ kind: "sleep", amount: 52 }, { kind: "rest", amount: 16 }]);
    expect(t.usedBy).toEqual([{ kind: "workout", amount: 22 }, { kind: "stress", amount: 4 }, { kind: "awake", amount: 7 }]);
    expect(energyTotals([])).toEqual({ charged: 0, used: 0, chargedBy: [], usedBy: [] });
  });
  it("reads the level between readings", () => {
    expect(energyAt(today.points, 0)).toBe(40);
    expect(energyAt(today.points, 30)).toBe(43.5);
    expect(energyAt(today.points, 850)).toBe(64);
    expect(energyAt(today.points, 851)).toBeNull();
    expect(energyAt([], 10)).toBeNull();
    expect(energyAt([today.now!, today.bedtime!], today.bedtime!.minute)).toBe(38);
  });
  it("finds the low and high since waking", () => {
    expect(energyRange(today.points, today.woke!.minute)).toEqual({ low: today.low, high: today.high });
    expect(energyRange([], 0)).toBeNull();
  });
  it("finds the band under a minute", () => {
    expect(bandAt(today.bands, 480)?.label).toBe("Morning tempo");
    expect(bandAt(today.bands, 430)).toBeNull();
    expect(bandAt(today.bands, 1400)?.kind).toBe("sleep");
  });
  it("builds 30 consistent sample days ending in the canvas's week", () => {
    const { days } = sampleEnergy;
    expect(days).toHaveLength(30);
    expect(days.slice(-7).map((d) => [d.low, d.high, d.woke!.level])).toEqual(
      [[34, 78, 74], [30, 84, 80], [22, 70, 62], [41, 90, 88], [36, 82, 77], [38, 85, 83], [56, 81, 81]],
    );
    for (const d of days.slice(0, -1)) {
      expect(energyRange(d.points, d.woke!.minute)).toEqual({ low: d.low, high: d.high });
      for (let i = 1; i < d.points.length; i++) expect(d.points[i].minute).toBeGreaterThan(d.points[i - 1].minute);
      expect(d.points.every((p) => p.level >= 0 && p.level <= 100)).toBe(true);
      // What the day used after its peak is the fall from high to low.
      expect(energyTotals(d.events).used).toBe(d.high - d.low);
    }
    // Each night starts where the evening before left off.
    expect(days[29].points[0].level).toBe(days[28].points[days[28].points.length - 1].level);
  });
});

describe("Energy steps and words", () => {
  const events = [
    { kind: "sleep" as const, name: "Sleep", detail: "22:58 – 06:54 · Score 84", delta: 52 },
    { kind: "workout" as const, name: "Morning tempo", detail: "07:42 – 08:20 · 8.02 km", delta: -22 },
    { kind: "rest" as const, name: "Rest", detail: "09:30 – 11:00", delta: 11 },
    { kind: "stress" as const, name: "Stress", detail: "11:30 – 12:15", delta: -4 },
    { kind: "rest" as const, name: "Rest", detail: "12:40 – 13:40", delta: 5 },
    { kind: "awake" as const, name: "Awake", detail: "The rest of the day so far", delta: -7, when: "so far" },
  ];

  it("works the bedtime level back from now so the steps add up", () => {
    const steps = energySteps(events, 64, { name: "Now", when: "14:10" });
    expect(steps).toHaveLength(8);
    expect(steps[0]).toEqual({ kind: "end", name: "Bedtime", when: "22:58", from: 29, to: 29 });
    expect(steps[1]).toMatchObject({ name: "Sleep", when: "22:58 – 06:54", from: 29, to: 81 });
    expect(steps[2]).toMatchObject({ when: "07:42 – 08:20", from: 81, to: 59 });
    expect(steps[6]).toMatchObject({ when: "so far", from: 71, to: 64 });
    expect(steps[7]).toEqual({ kind: "end", name: "Now", when: "14:10", from: 64, to: 64 });
  });

  it("finds the lowest reading after waking", () => {
    const points = [{ minute: 0, level: 40 }, { minute: 414, level: 81 }, { minute: 570, level: 56 }, { minute: 850, level: 64 }];
    expect(lowestSinceWaking(points, 414)).toEqual({ minute: 570, level: 56 });
  });

  it("names shares in plain words", () => {
    expect(shareWords(52 / 68)).toBe("three quarters");
    expect(shareWords(22 / 33)).toBe("two thirds");
    expect(shareWords(0.5)).toBe("half");
    expect(shareWords(0.97)).toBe("nearly all");
  });
});

describe("series with empty days", () => {
  it("breaks the line at a gap and dots a lone reading", () => {
    expect(gapLinePath([0, 10, null, 5, null, null, 10], 60, 100, 0, 10)).toBe("M0.0 100.0 L10.0 0.0 M30.0 50.0 h0 M60.0 0.0 h0");
    expect(gapLinePath([null, null], 10, 100, 0, 1)).toBe("");
    expect(present([1, null, 3])).toEqual([1, 3]);
  });
});

describe("nightTotals", () => {
  it("sums segments, keeping the source's own asleep figure", () => {
    const segments = [{ stage: "light" as const, minutes: 30 }, { stage: "awake" as const, minutes: 5 }, { stage: "deep" as const, minutes: 20 }];
    const base = { score: 80, startMinute: 1380, heartRateAsleep: 50 };
    expect(nightTotals({ ...base, segments })).toEqual({ awake: 5, rem: 0, light: 30, deep: 20, asleep: 50, inBed: 55 });
    expect(nightTotals({ ...base, segments, totals: { asleep: 49 } }).asleep).toBe(49);
  });
  it("uses the given totals when there are no segments, and nothing else", () => {
    const base = { score: null, startMinute: null, heartRateAsleep: null, segments: [] };
    expect(nightTotals({ ...base, totals: { deep: 80, light: 250, rem: 90, awake: 12, asleep: 420, inBed: 432 } }))
      .toEqual({ awake: 12, rem: 90, light: 250, deep: 80, asleep: 420, inBed: 432 });
    expect(nightTotals({ ...base, totals: { asleep: 400 } })).toEqual({ awake: null, rem: null, light: null, deep: null, asleep: 400, inBed: null });
    expect(nightTotals(base)).toEqual({ awake: null, rem: null, light: null, deep: null, asleep: null, inBed: null });
  });
});
