import { describe, expect, it } from "vitest";
import type { Measurement, OwnMeasurement } from "@/data/body";
import { BODY_SAMPLE } from "@/data/sample/body";
import {
  ageDifference, arcPoint, bmi, bmiBand, bodyAgeAngle, daysBetween, deleteMeasurement, goalProgress, isDay, leanMass,
  mergeMeasurements, monthlyAverages, nearestIndex, oneOrTwo, rangeStart, resample, saveMeasurement, series, shiftDay,
  spark, trend, weeksToGoal, weightDomain, within, xAt, yAt,
} from "./body";

const sample: Measurement[] = [
  { day: "2026-11-17", weightKg: 72.6 },
  { day: "2026-11-18", weightKg: 72.5, bodyFatPct: 15 },
  { day: "2026-11-19", weightKg: 72.4, bodyFatPct: 14.8 },
];
const own = (id: string, day: string, weightKg: number, bodyFatPct?: number): OwnMeasurement => ({ id, day, weightKg, ...(bodyFatPct == null ? {} : { bodyFatPct }) });

describe("days", () => {
  it("shifts and counts across months, years and clock changes", () => {
    expect(shiftDay("2026-11-19", -89)).toBe("2026-08-22");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-08-22", "2026-11-19")).toBe(89);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-11-19", "2026-11-18")).toBe(-1);
  });
  it("knows a real day from a mistyped one", () => {
    expect(isDay("2026-11-19")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "19/11/2026", "", "2026-1-9"]) expect(isDay(bad)).toBe(false);
  });
});

describe("merging saved over sample", () => {
  it("keeps the sample when nothing is saved", () => {
    const merged = mergeMeasurements(sample, []);
    expect(merged.map((m) => m.day)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(merged.every((m) => !m.own)).toBe(true);
  });
  it("replaces the sample on the same day and sorts new days in", () => {
    const merged = mergeMeasurements(sample, [own("b", "2026-11-20", 72.1), own("a", "2026-11-18", 72.9), own("c", "2026-11-10", 73)]);
    expect(merged.map((m) => [m.day, m.weightKg, m.own])).toEqual([
      ["2026-11-10", 73, true], ["2026-11-17", 72.6, false], ["2026-11-18", 72.9, true], ["2026-11-19", 72.4, false], ["2026-11-20", 72.1, true],
    ]);
    expect(merged[2].bodyFatPct).toBeUndefined();
    expect(merged[2].id).toBe("a");
  });
  it("does not change what it was given", () => {
    const before = JSON.stringify(sample);
    mergeMeasurements(sample, [own("a", "2026-11-18", 80)]);
    expect(JSON.stringify(sample)).toBe(before);
  });
  it("saves one own measurement a day and deletes by id", () => {
    let list = saveMeasurement([], own("a", "2026-11-20", 72.1));
    list = saveMeasurement(list, own("b", "2026-11-12", 73));
    list = saveMeasurement(list, own("c", "2026-11-20", 72.0, 14.6));
    expect(list.map((m) => m.id)).toEqual(["b", "c"]);
    expect(deleteMeasurement(list, "b").map((m) => m.id)).toEqual(["c"]);
    expect(deleteMeasurement(list, "zzz")).toHaveLength(2);
    const merged = mergeMeasurements(sample, deleteMeasurement(list, "c"));
    expect(merged[merged.length - 1].day).toBe("2026-11-19");
  });
});

describe("derived numbers", () => {
  it("BMI, lean mass and the band, as on the canvas", () => {
    expect(bmi(72.4, 178).toFixed(1)).toBe("22.9");
    expect(bmi(73.7, 178).toFixed(1)).toBe("23.3");
    expect(bmi(70, 0)).toBe(0);
    expect(leanMass(72.4, 14.8).toFixed(1)).toBe("61.7");
    expect(leanMass(73.7, 15.7).toFixed(1)).toBe("62.1");
    expect(bmiBand(18.4)).toBe("Below healthy range");
    expect(bmiBand(18.5)).toBe("Healthy range");
    expect(bmiBand(24.99)).toBe("Healthy range");
    expect(bmiBand(25)).toBe("Above healthy range");
  });
  it("builds each metric's series", () => {
    expect(series(sample, "weight", 178).map((p) => p.value)).toEqual([72.6, 72.5, 72.4]);
    expect(series(sample, "bodyFat", 178)).toEqual([{ day: "2026-11-18", value: 15 }, { day: "2026-11-19", value: 14.8 }]);
    expect(series(sample, "lean", 178).map((p) => p.day)).toEqual(["2026-11-18", "2026-11-19"]);
    expect(series(sample, "lean", 178)[0].value).toBeCloseTo(61.625);
    expect(series(sample, "bmi", 178)[2].value).toBeCloseTo(22.851, 2);
  });
});

describe("ranges and trends", () => {
  const points = [
    { day: "2026-08-21", value: 74 }, { day: "2026-08-22", value: 73.7 }, { day: "2026-10-21", value: 73 }, { day: "2026-11-19", value: 72.4 }, { day: "2026-11-20", value: 72 },
  ];
  it("starts each range the right number of days back", () => {
    expect(rangeStart("1M", "2026-11-19")).toBe("2026-10-21");
    expect(rangeStart("3M", "2026-11-19")).toBe("2026-08-22");
    expect(rangeStart("1Y", "2026-11-19")).toBe("2025-11-20");
    expect(rangeStart("All", "2026-11-19")).toBeNull();
  });
  it("keeps the points inside a range, ends included", () => {
    expect(within(points, "2026-08-22", "2026-11-19").map((p) => p.value)).toEqual([73.7, 73, 72.4]);
    expect(within(points, null, "2026-11-19")).toHaveLength(4);
  });
  it("trend is last minus first", () => {
    expect(trend(within(points, "2026-08-22", "2026-11-19"))).toBeCloseTo(-1.3);
    expect(trend([{ day: "2026-01-01", value: 70 }])).toBeNull();
    expect(trend([])).toBeNull();
  });
  it("averages by calendar month", () => {
    const months = monthlyAverages([...points].reverse());
    expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-10", "2026-11"]);
    expect(months[0]).toEqual({ month: "2026-08", value: 73.85, count: 2 });
    expect(months[2].value).toBeCloseTo(72.2);
    expect(monthlyAverages([])).toEqual([]);
  });
  it("averages a long line down to a short one", () => {
    expect(resample([1, 2, 3], 14)).toEqual([1, 2, 3]);
    expect(resample([1, 3, 5, 7, 9, 11], 3)).toEqual([2, 6, 10]);
    expect(resample(Array.from({ length: 90 }, (_, i) => i), 14)).toHaveLength(14);
    expect(resample([4, 4, 4, 4, 4], 2)).toEqual([4, 4]);
  });
});

describe("the sample history", () => {
  const { measurements, profile, sampleDay } = BODY_SAMPLE;
  it("is ordered, one a day, ending on the sample day", () => {
    const days = measurements.map((m) => m.day);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
    expect(days[days.length - 1]).toBe(sampleDay);
  });
  it("gives the canvas's three-month numbers", () => {
    const from = rangeStart("3M", sampleDay);
    const weight = within(series(measurements, "weight", profile.heightCm!), from, sampleDay);
    expect(weight).toHaveLength(90);
    expect(weight[0]).toEqual({ day: "2026-08-22", value: 73.7 });
    expect(weight[89].value).toBe(72.4);
    expect(trend(weight)!.toFixed(1)).toBe("-1.3");
    expect(trend(within(series(measurements, "bodyFat", profile.heightCm!), from, sampleDay))!.toFixed(1)).toBe("-0.9");
    expect(trend(within(series(measurements, "lean", profile.heightCm!), from, sampleDay))!.toFixed(1)).toBe("-0.4");
    expect(weightDomain(weight.map((p) => p.value), profile.goalWeightKg!)).toEqual([70.5, 74.5]);
    expect(Math.round(goalProgress(73.7, 72.4, profile.goalWeightKg!) * 100)).toBe(48);
    expect(Math.round(weeksToGoal(72.4, profile.goalWeightKg!, trend(weight)!, 89)!)).toBe(14);
  });
});

describe("goal", () => {
  it("measures progress either way and clamps it", () => {
    expect(goalProgress(73.7, 72.4, 71)).toBeCloseTo(1.3 / 2.7);
    expect(goalProgress(60, 62, 64)).toBe(0.5);
    expect(goalProgress(73.7, 75, 71)).toBe(0);
    expect(goalProgress(73.7, 70, 71)).toBe(1);
    expect(goalProgress(71, 71, 71)).toBe(1);
    expect(goalProgress(71, 72, 71)).toBe(0);
  });
  it("estimates weeks only when the pace leads to the goal", () => {
    expect(weeksToGoal(72.4, 71, -1.3, 89)).toBeCloseTo(13.69, 1);
    expect(weeksToGoal(72.4, 71, 1.3, 89)).toBeNull();
    expect(weeksToGoal(71, 71, -1.3, 89)).toBeNull();
    expect(weeksToGoal(72.4, 71, 0, 89)).toBeNull();
    expect(weeksToGoal(72.4, 71, -1, 0)).toBeNull();
    expect(weeksToGoal(60, 62, 0.5, 7)).toBe(4);
  });
});

describe("body-age arc", () => {
  it("puts the person's age at the bottom and the ends five years either side", () => {
    expect(bodyAgeAngle(39, 39)).toBe(90);
    expect(bodyAgeAngle(34, 39)).toBe(165);
    expect(bodyAgeAngle(44, 39)).toBe(15);
    const [x, y] = arcPoint(90);
    expect(x).toBeCloseTo(179);
    expect(y).toBeCloseTo(291);
  });
  it("places 36.4 where the canvas draws it", () => {
    const [x, y] = arcPoint(bodyAgeAngle(36.4, 39));
    expect(x).toBeCloseTo(78.3, 1);
    expect(y).toBeCloseTo(255.3, 1);
  });
  it("clamps ages beyond the arc", () => {
    expect(bodyAgeAngle(20, 39)).toBe(165);
    expect(bodyAgeAngle(60, 39)).toBe(15);
  });
  it("words the difference to a tenth", () => {
    expect(ageDifference(36.4, 39)).toBe("2.6 years younger");
    expect(ageDifference(40, 39)).toBe("1.0 years older");
    expect(ageDifference(39.04, 39)).toBe("Same as your age");
  });
});

describe("chart geometry", () => {
  it("places values and days as the canvas does", () => {
    expect(yAt(71, 70.5, 74.5, 220)).toBeCloseTo(192.5);
    expect(yAt(74.5, 70.5, 74.5, 220)).toBe(0);
    expect(xAt("2026-08-22", "2026-08-22", "2026-11-19", 800)).toBe(0);
    expect(xAt("2026-11-19", "2026-08-22", "2026-11-19", 800)).toBe(800);
    expect(xAt("2026-08-23", "2026-08-22", "2026-11-19", 800)).toBeCloseTo(800 / 89);
    expect(xAt("2026-11-19", "2026-11-19", "2026-11-19", 800)).toBe(400);
  });
  it("picks a sensible axis", () => {
    expect(weightDomain([72.4, 73.8], 71)).toEqual([70.5, 74.5]);
    expect(weightDomain([80, 82], null)).toEqual([79.5, 82.5]);
    expect(weightDomain([], null)).toEqual([0, 1]);
  });
  it("finds the nearest point", () => {
    expect(nearestIndex([0, 100, 400, 800], 240)).toBe(1);
    expect(nearestIndex([0, 100, 400, 800], 260)).toBe(2);
    expect(nearestIndex([0, 100, 400, 800], -50)).toBe(0);
    expect(nearestIndex([0, 100, 400, 800], 9999)).toBe(3);
    expect(nearestIndex([], 5)).toBe(0);
  });
  it("draws small trend lines inside their padding", () => {
    const s = spark([1, 3, 2], 84, 44, 6)!;
    expect(s.line).toBe("M0.0 38.0 L42.0 6.0 L84.0 22.0");
    expect(s.area.endsWith("L84 44 L0 44 Z")).toBe(true);
    expect([s.endX, s.endY]).toEqual([84, 22]);
    expect(spark([], 84, 44, 6)).toBeNull();
    expect(spark([5], 84, 44, 6)!.line).toBe("M0.0 38.0 L84.0 38.0");
    expect(spark([5, 5], 84, 44, 6)!.endY).toBe(38);
  });
  it("prints scale numbers to one or two decimals", () => {
    expect(oneOrTwo(72.4)).toBe("72.4");
    expect(oneOrTwo(72.45)).toBe("72.45");
    expect(oneOrTwo(71)).toBe("71.0");
  });
});
