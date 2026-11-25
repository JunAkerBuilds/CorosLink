import { describe, expect, it } from "vitest";
import { seedItems } from "@/data/sampleSeed";
import {
  against, bodyFromItems, bodyProfile, goalsWithWeight, measurementWrite, movedId, ownMeasurements, phoneWeight, profileWithEdit, profileWithWeight, readings, signalsAndStats,
} from "./body";
import {
  dateToRef, type BodyGoalsBody, type BodyMeasurementBody, type NativeDayVitals, type NativeFuelProfile, type ViewBodyBody, type ViewTrainingBody,
} from "./native";

const NOW = new Date(2026, 10, 20, 14, 10);
const seed = seedItems(NOW);
const one = <B,>(collection: string) => seed.find((i) => i.collection === collection)!.body as B;
const days = seed.filter((i) => i.collection === "health.day").map((i) => i.body as NativeDayVitals);
const view = one<ViewBodyBody>("view.body"), goals = one<BodyGoalsBody>("body.goals"), profile = one<NativeFuelProfile>("fuel.profile");
const training = one<ViewTrainingBody>("view.training");
const item = (id: string, day: string, weightKg: number, bodyFatPct?: number): { id: string; body: BodyMeasurementBody } =>
  ({ id, body: { day, weightKg, ...(bodyFatPct == null ? {} : { bodyFatPct }) } });
/** November 2026 days with a resting heart rate each. */
const hr = (pairs: [day: number, value: number | undefined][], month = 11): NativeDayVitals[] =>
  pairs.map(([day, restingHR]) => ({ day: { year: 2026, month, day }, ...(restingHR == null ? {} : { restingHR }) }));

describe("measurements", () => {
  it("lists the typed ones oldest first under their item ids and drops broken ones", () => {
    const list = ownMeasurements([item("B", "2026-11-18", 72.6, 14.9), item("A", "2026-11-02", 73.1), { id: "X", body: { day: "soon", weightKg: 70 } }]);
    expect(list).toEqual([{ id: "A", day: "2026-11-02", weightKg: 73.1 }, { id: "B", day: "2026-11-18", weightKg: 72.6, bodyFatPct: 14.9 }]);
  });
  it("puts the phone's one weight on the day it was taken", () => {
    expect(phoneWeight(view)).toEqual({ day: "2026-11-19", weightKg: 72.4 });
    expect(phoneWeight({ weightKg: 70 })).toBeNull();
    expect(phoneWeight({ weightAt: 0 })).toBeNull();
    expect(phoneWeight(undefined)).toBeNull();
  });
  it("replaces the measurement already on that day and clears doubles", () => {
    const items = [item("B", "2026-11-18", 72.6), item("A", "2026-11-18", 72.9), item("C", "2026-11-17", 73)];
    expect(measurementWrite(items, { day: "2026-11-18", weightKg: 72.45, bodyFatPct: 14.8 }, "NEW"))
      .toEqual({ id: "A", body: { day: "2026-11-18", weightKg: 72.45, bodyFatPct: 14.8 }, remove: ["B"] });
    expect(measurementWrite(items, { day: "2026-11-20", weightKg: 72.3 }, "NEW")).toEqual({ id: "NEW", body: { day: "2026-11-20", weightKg: 72.3 }, remove: [] });
  });
  it("moves a browser measurement under its own id, uppercase", () => {
    expect(movedId({ id: "0a1b2c3d-1111-4222-8333-444455556666" }, () => "NEW")).toBe("0A1B2C3D-1111-4222-8333-444455556666");
    expect(movedId({ id: "lq3x-8f2k" }, () => "NEW")).toBe("NEW");
  });
});

describe("profile", () => {
  it("reads height, age and goal from Fuel, the goal weight from the goals, resting energy from the phone", () => {
    expect(bodyProfile(profile, goals, view)).toEqual({ heightCm: 178, age: 39, goal: "lose", goalWeightKg: 71, restingKcal: 1647 });
    expect(bodyProfile({ ...profile, goal: "custom" }, undefined, undefined)).toEqual({ heightCm: 178, age: 39, goal: "custom", goalWeightKg: null, restingKcal: null });
    expect(bodyProfile(undefined, undefined, undefined)).toEqual({ heightCm: null, age: null, goal: null, goalWeightKg: null, restingKcal: null });
  });
  it("writes height and goal back with every other field kept", () => {
    const full: NativeFuelProfile = { ...profile, customKcal: 2300, macros: { protein: { unit: "perKg", value: 2 } } };
    expect(profileWithEdit(full, { heightCm: 179, goal: "maintain", goalWeightKg: 70 })).toEqual({ ...full, heightCm: 179, goal: "maintain" });
    expect(profileWithEdit(full, { heightCm: 178, goal: "lose" })).toBeNull();
    expect(profileWithEdit(full, {})).toBeNull();
  });
  it("puts the newest typed weight in the Fuel profile for the phones, not an older day's", () => {
    const full = { ...profile, weightKg: 70 };
    const typed = [item("A", "2026-11-18", 69.5)];
    expect(profileWithWeight(full, typed, { day: "2026-11-20", weightKg: 69.1 })).toEqual({ ...full, weightKg: 69.1 });
    expect(profileWithWeight(full, typed, { day: "2026-11-18", weightKg: 69.2 })).toEqual({ ...full, weightKg: 69.2 });
    expect(profileWithWeight(full, typed, { day: "2026-11-10", weightKg: 72 })).toBeNull();
    expect(profileWithWeight(full, [], { day: "2026-11-20", weightKg: 70 })).toBeNull();
  });
  it("sets a weight goal as the phone does: from the current weight, from now, keeping the date and other goals", () => {
    const fat = { target: 13, start: 15, startDate: 1 };
    const was: BodyGoalsBody = { goals: { ...goals.goals, bodyFat: fat } };
    expect(goalsWithWeight(was, 70, 72.4, NOW)).toEqual({
      goals: { bodyFat: fat, weight: { target: 70, start: 72.4, startDate: dateToRef(NOW), byDate: goals.goals.weight!.byDate } },
    });
    expect(goalsWithWeight(was, 71, 72.4, NOW)).toBeNull(); // unchanged target keeps its start
    expect(goalsWithWeight(undefined, 70, 72.4, NOW)).toEqual({ goals: { weight: { target: 70, start: 72.4, startDate: dateToRef(NOW) } } });
  });
});

describe("nightly readings", () => {
  it("keeps days with a value, in order, up to today", () => {
    const list = readings(hr([[20, 47], [18, 49], [19, undefined], [21, 50]]), (v) => v.restingHR, "2026-11-20");
    expect(list).toEqual([{ day: "2026-11-18", value: 49 }, { day: "2026-11-20", value: 47 }]);
  });
  it("compares the latest with the mean of the 30 days before it", () => {
    // Oct 20 is 31 days before Nov 20: outside. Oct 21 … Nov 19 are the 30 days.
    const list = readings([...hr([[20, 60], [21, 52], [30, 50]], 10), ...hr([[10, 48], [19, 50], [20, 47]])], (v) => v.restingHR, "2026-11-20");
    const a = against(list)!;
    expect(a.latest).toBe(47);
    expect(a.usual).toBe(50); // (52 + 50 + 48 + 50) / 4
    expect(a.change30).toBe(-3); // 47 − 50: Oct 30 is the first reading of the 30 days ending on Nov 20 (Oct 22 on)
    expect(a.values).toEqual([60, 52, 50, 48, 50, 47]);
  });
  it("gives the last 14 values and no usual from one reading", () => {
    const many = readings(hr(Array.from({ length: 20 }, (_, k): [number, number] => [k + 1, 40 + k])), (v) => v.restingHR, "2026-11-20");
    expect(against(many)!.values).toEqual(Array.from({ length: 14 }, (_, k) => 46 + k));
    expect(against(readings(hr([[20, 47]]), (v) => v.restingHR, "2026-11-20"))).toEqual({ latest: 47, usual: null, change30: null, values: [47] });
    expect(against([])).toBeNull();
  });
  it("words the signals and tiles", () => {
    const list: NativeDayVitals[] = [
      { day: { year: 2026, month: 11, day: 17 }, restingHR: 50, hrv: 56 },
      { day: { year: 2026, month: 11, day: 18 }, restingHR: 48, hrv: 60 },
      { day: { year: 2026, month: 11, day: 19 }, restingHR: 49, hrv: 61.5 },
    ];
    const { signals, stats } = signalsAndStats(list, { vo2max: 54.3 }, "2026-11-20");
    expect(signals).toEqual([
      { name: "Resting heart rate", hue: "rose", values: [50, 48, 49], detail: "49 bpm · Usual 49", pill: "Usual" },
      { name: "HRV", hue: "cyan", values: [56, 60, 61.5], detail: "61.5 ms · Usual 58", pill: "+4 ms" }, // 61.5 − 58 = 3.5 → 4
    ]);
    expect(stats).toEqual([
      { name: "Resting HR", value: "49", unit: "bpm", hue: "rose", values: [50, 48, 49], note: "−1 in 30 days" },
      { name: "HRV", value: "61.5", unit: "ms", hue: "cyan", values: [56, 60, 61.5], note: "+6 in 30 days" }, // 5.5 → 6
      { name: "VO2max", value: "54.3", unit: "ml/kg/min", note: "", hue: "blue", values: [] },
    ]);
    expect(signalsAndStats([], undefined, "2026-11-20")).toEqual({ signals: [], stats: [] });
  });
});

describe("bodyFromItems", () => {
  it("builds the screen from the seed with nothing from the sample", () => {
    const data = bodyFromItems({ view, goals, profile, measurements: [item("A", "2026-11-12", 72.9)], days, training }, NOW);
    expect(data.bodyAge).toEqual({ value: 36.4, asOf: "2026-11-17" });
    expect(data.headline).toBeUndefined();
    expect(data.advice).toBeUndefined();
    expect(data.measurements).toEqual([{ day: "2026-11-19", weightKg: 72.4 }]);
    expect(data.own).toEqual([{ id: "A", day: "2026-11-12", weightKg: 72.9 }]);
    expect(data.signals.map((s) => s.name)).toEqual(["Resting heart rate", "HRV"]);
    expect(data.stats.map((s) => s.name)).toEqual(["Resting HR", "HRV", "VO2max"]);
    expect(data.signals[0].values).toHaveLength(14);
    expect(data.stats[2].value).toBe(String(training.vo2max));
  });
  it("is an honest empty with no items", () => {
    const data = bodyFromItems({ view: undefined, goals: undefined, profile: undefined, measurements: [], days: [], training: undefined }, NOW);
    expect(data).toMatchObject({ bodyAge: null, signals: [], stats: [], measurements: [], own: [] });
  });
});
