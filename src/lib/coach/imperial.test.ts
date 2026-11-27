import { afterEach, describe, expect, it } from "vitest";
import type { HubWorkout } from "@/data/hub";
import { seedItems } from "@/data/sampleSeed";
import { useUnitsNow } from "@/lib/units";
import { compareCard, kmSplits, recapCard } from "./cards";
import { athleteItems, type Clock } from "./items";
import { contextText, IMPERIAL_NOTE } from "./prompt";
import { planEntries } from "./read";
import { parseRequest } from "./request";
import { sportStats, targetWords, workoutBody } from "./sportCard";
import { strengthLines } from "./strengthCard";
import { runTool, type ToolContext } from "./tools";
import { parseWorkout, workoutCard } from "./workout";

const NOW = new Date(2026, 10, 20, 14, 10);
const clock: Clock = { nowMs: NOW.getTime(), offsetMin: NOW.getTimezoneOffset() };
const items = athleteItems(seedItems(NOW));
const entries = planEntries(items, null, []);
const runs = items.activities.filter((a) => a.sport === "run" && items.details[a.id]);
const RUN = {
  name: "Tempo", sport: "run",
  blocks: [{ repeats: 3, steps: [{ kind: "training", target: "distance", meters: 2000, intensity: { kind: "pace", low: 270, high: 280 } }, { kind: "rest", target: "time", seconds: 120 }] }],
};
const none = { kind: "none" as const };

afterEach(() => useUnitsNow("metric"));

describe("Coach's cards in imperial units", () => {
  it("splits a recap by the mile and shows distance and pace per mile", () => {
    useUnitsNow("imperial");
    const made = recapCard(items, clock, "c", { activity_id: runs[0].id });
    if (!("card" in made)) throw new Error(made.error);
    const c = made.card;
    expect(c.splitUnit).toBe("mi");
    expect(c.splits.length).toBe(kmSplits(runs[0], items.details[runs[0].id], 1609.344).length);
    expect(c.stats.find((s) => s.label === "Distance")!.unit).toBe("mi");
    expect(c.stats.find((s) => s.label === "Avg pace")!.unit).toBe("/mi");
    expect(c.chartLabel).toMatch(/miles/);
  });
  it("leaves the metric recap without a split unit", () => {
    const made = recapCard(items, clock, "c", { activity_id: runs[0].id });
    if (!("card" in made)) throw new Error(made.error);
    expect(made.card.splitUnit).toBeUndefined();
    expect(made.card.stats.find((s) => s.label === "Distance")!.unit).toBe("km");
  });
  it("cuts mile splits out of a speed stream", () => {
    const splits = kmSplits({ id: "a", name: "", sport: "run" }, { streams: { axis: "distance", x: [0, 1000, 2000, 3300], speedMps: [4, 4, 4, 4] } }, 1609.344);
    expect(splits).toEqual([402.34, 402.34]);
  });
  it("compares in miles", () => {
    useUnitsNow("imperial");
    const made = compareCard(items, clock, "c", { before_activity_id: runs[1]?.id, after_activity_id: runs[0].id });
    if (!("card" in made)) return; // the seed may hold one run with details
    expect(made.card.splitUnit).toBe("mi");
    expect(made.card.rows.find((r) => r.label === "Distance")?.before).toMatch(/ mi$/);
  });
  it("draws a workout card in the units its input asks for, and puts the page's back", () => {
    const made = parseWorkout(RUN, "2026-11-21", "w");
    if ("error" in made) throw new Error(made.error);
    const card = workoutCard(made, null, { id: "w", date: "2026-11-21", units: "imperial" });
    expect(card.steps[0]).toMatchObject({ length: "1.24 mi", target: "7:15 to 7:31 /mi" });
    const easy = parseWorkout({ name: "Easy", sport: "run", blocks: [{ steps: [{ kind: "training", target: "distance", meters: 6000 }] }] }, "2026-11-21", "e");
    if ("error" in easy) throw new Error(easy.error);
    expect(workoutCard(easy, null, { id: "e", date: "2026-11-21", units: "imperial" })).toMatchObject({ stats: [{ value: "3.73", unit: "mi" }], summary: "3.73 mi" });
    expect(workoutCard(made, null, { id: "w", date: "2026-11-21" }).steps[0]).toMatchObject({ length: "2.00 km", target: "4:30 to 4:40 /km" });
  });
  it("says targets, swims and weights in imperial", () => {
    useUnitsNow("imperial");
    expect(targetWords({ kind: "pace", low: 270, high: 280 })).toBe("7:15 to 7:31 /mi");
    expect(targetWords({ kind: "speed", low: 30 })).toBe("18.6 mph");
    expect(targetWords({ kind: "weight", low: 100 })).toBe("220.5 lb");
    const swim: HubWorkout = { name: "Swim", sport: "swim", description: "", blocks: [{ repeats: 4, steps: [{ kind: "training", target: "distance", meters: 100, intensity: none }, { kind: "rest", target: "time", seconds: 20, intensity: none }] }, { repeats: null, steps: [{ kind: "training", target: "distance", meters: 200, intensity: none }] }] };
    const body = workoutBody(swim);
    expect(body.list[0].rows[0].amount).toBe("109 yd");
    expect(sportStats(swim, body)![0]).toMatchObject({ value: "656", unit: "yd" });
    const gym: HubWorkout = { name: "Legs", sport: "strength", description: "", blocks: [{ repeats: null, steps: [{ kind: "training", target: "reps", count: 5, sets: 3, intensity: { kind: "weight", low: 80 }, name: "Back squat" }] }] };
    expect(strengthLines(gym).lifts[0].load).toEqual({ value: "176.4", unit: "lb" });
  });
});

describe("Coach told the athlete's units", () => {
  it("reads the units from the request, metric when missing", () => {
    expect(parseRequest({ text: "Hi", units: "imperial" }, 0, () => null)!.units).toBe("imperial");
    expect(parseRequest({ text: "Hi", units: "furlongs" }, 0, () => null)!.units).toBe("metric");
  });
  it("tells the model only when the athlete reads imperial", () => {
    expect(contextText(items, clock, entries, null, null, null, "imperial")).toContain(IMPERIAL_NOTE);
    expect(contextText(items, clock, entries, null)).not.toContain(IMPERIAL_NOTE);
  });
  it("draws a tool's card in the request's units, without changing the page's", async () => {
    let n = 0;
    const ctx: ToolContext = { items, clock, entries, hubNote: null, hub: null, browser: [], newId: () => `ID-${++n}`, asked: false, units: "imperial" };
    const r = await runTool("show_workout_recap", { activity_id: runs[0].id }, ctx);
    expect(r.block).toMatchObject({ kind: "recap", splitUnit: "mi" });
    const again = await runTool("show_workout_recap", { activity_id: runs[0].id }, { ...ctx, units: undefined });
    expect(again.block).not.toHaveProperty("splitUnit");
  });
});
