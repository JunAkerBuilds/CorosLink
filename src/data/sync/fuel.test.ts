import { describe, expect, it } from "vitest";
import { FOODS } from "@/data/sample/foods";
import { dayTotals, foodNutrients } from "@/lib/fuel";
import { seedItems } from "@/data/sampleSeed";
import {
  copyEntries, dayBurns, dayLogs, entryDay, entryTime, foodList, fuelFromItems, loggedFood, nativeListFood, newEntry, targetsFor, withAmount,
} from "./fuel";
import { dateToRef, refToDate, type NativeDayVitals, type NativeFoodEntry, type NativeFoodItem, type NativeFuelProfile } from "./native";

const NOW = new Date(2026, 10, 20, 14, 10);
const seed = seedItems(NOW);
const of = <B,>(collection: string) => seed.filter((i) => i.collection === collection).map((i) => i.body as B);
const entries = of<NativeFoodEntry>("fuel.entry"), ownFoods = of<NativeFoodItem>("fuel.food"), days = of<NativeDayVitals>("health.day");
const profile = of<NativeFuelProfile>("fuel.profile")[0];
const NINE = ["carbsG", "cholesterolMg", "fatG", "fiberG", "kcal", "proteinG", "saturatedFatG", "sodiumMg", "sugarG"];
const phoneKcal = (e: NativeFoodEntry) => (e.item.per100g.kcal * e.grams) / 100;

describe("entries → the screen", () => {
  it("shows a liquid in ml with the phone's calories", () => {
    const shake = entries.find((e) => e.item.name === "Recovery shake")!;
    const food = loggedFood(shake);
    expect(food).toMatchObject({ id: shake.id, unit: "ml", amount: 330 });
    expect(foodNutrients(food).kcal).toBeCloseTo(250.8, 10); // 76 × 330 / 100
  });
  it("shows a quick add as servings with the phone's calories", () => {
    const quick = entries.find((e) => e.item.id.startsWith("quick:"))!;
    const food = loggedFood(quick);
    expect(food).toMatchObject({ unit: "serving", amount: 1 });
    expect(food.per.kcal).toBe(640);
    expect(foodNutrients(loggedFood({ ...quick, grams: 150 })).kcal).toBe(960);
  });
  it("gives every entry the phone's total", () => {
    for (const e of entries) expect(foodNutrients(loggedFood(e)).kcal).toBeCloseTo(phoneKcal(e), 9);
  });
  it("groups by the local day of the time and by meal, in the order eaten", () => {
    const at = (d: number, h: number, m = 0) => dateToRef(new Date(2026, 10, d, h, m));
    const item = entries[0].item;
    const mk = (id: string, time: number, meal: NativeFoodEntry["meal"]): NativeFoodEntry => ({ id, time, meal, item, grams: 100, source: "search", version: 1 });
    const logs = dayLogs([mk("C", at(20, 0, 5), "snack"), mk("B", at(19, 23, 55), "snack"), mk("A", at(19, 7), "breakfast"), mk("D", at(19, 22), "snack")]);
    expect(Object.keys(logs).sort()).toEqual(["2026-11-19", "2026-11-20"]);
    expect(logs["2026-11-19"].meals.snack.map((f) => f.id)).toEqual(["D", "B"]);
    expect(logs["2026-11-19"].meals.breakfast.map((f) => f.id)).toEqual(["A"]);
    expect(logs["2026-11-20"].meals.snack.map((f) => f.id)).toEqual(["C"]);
  });
  it("adds a seeded day up to the phone's sum", () => {
    const day = "2026-11-19";
    const sum = entries.filter((e) => entryDay(e) === day).reduce((s, e) => s + phoneKcal(e), 0);
    expect(sum).toBeGreaterThan(0);
    expect(dayTotals(dayLogs(entries)[day]).kcal).toBeCloseTo(sum, 6);
  });
});

describe("the screen → entries", () => {
  const rice = FOODS.find((f) => !f.liquid)!;
  const add = (over: Partial<Parameters<typeof newEntry>[0]>) => newEntry({
    id: "E-1", itemId: "I-1", day: "2026-11-20", meal: "lunch", now: NOW, origin: { from: "own" },
    food: { id: "x", name: "Soup", unit: "serving", amount: 1.5, per: { kcal: 320, protein: 12, carbs: 40, fat: 11, fiber: 4, sugar: 6, satFat: 3, sodium: 800, cholesterol: 20 } },
    ...over,
  });

  it("stores typed servings as the phone stores totals, with the same calories", () => {
    const { entry, food } = add({});
    expect(food).toBeUndefined();
    expect(entry).toMatchObject({ id: "E-1", meal: "lunch", source: "manual", version: 1, grams: 150, time: dateToRef(NOW) });
    expect(entry.item).toMatchObject({ id: "quick:I-1", name: "Soup", servings: [{ label: "", grams: 100 }] });
    expect("liquid" in entry.item).toBe(false);
    expect(Object.keys(entry.item.per100g).sort()).toEqual(NINE);
    expect(phoneKcal(entry)).toBe(480); // 1.5 servings of 320
    expect(loggedFood(entry)).toMatchObject({ id: "E-1", unit: "serving", amount: 1.5, per: { kcal: 320, sodium: 800 } });
  });
  it("logs a list food under a stable web id, in grams", () => {
    const item = nativeListFood(rice);
    const { entry, food } = add({ origin: { from: "list", item }, food: { id: "x", name: rice.name, unit: "g", amount: 180, per: rice.per100 } });
    expect(food).toBeUndefined();
    expect(entry.item.id).toBe(`web:${rice.id}`);
    expect(entry).toMatchObject({ source: "search", grams: 180 });
    expect(entry.item.servings).toEqual([]);
    expect(Object.keys(entry.item.per100g).sort()).toEqual(NINE);
    expect(phoneKcal(entry)).toBeCloseTo((rice.per100.kcal * 180) / 100, 10);
  });
  it("marks only ml foods as liquid", () => {
    const milk = FOODS.find((f) => f.liquid)!;
    expect(nativeListFood(milk).liquid).toBe(true);
    expect("liquid" in nativeListFood(rice)).toBe(false);
  });
  it("logs one of the person's own foods as it is, typed in by hand", () => {
    const shake = ownFoods.find((f) => f.liquid)!;
    const { entry } = add({ origin: { from: "list", item: shake }, food: { id: "x", name: shake.name, unit: "ml", amount: 250, per: foodList([], [shake])[0].per100 } });
    expect(entry.item).toBe(shake);
    expect(entry).toMatchObject({ source: "manual", grams: 250 });
  });
  it("keeps a food typed in per 100 ml as an own food", () => {
    const { entry, food } = add({ food: { id: "x", name: "Oat drink", unit: "ml", amount: 200, per: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5, fiber: 0.8, sugar: 4, satFat: 0.2, sodium: 40, cholesterol: 0 } } });
    expect(food).toBe(entry.item);
    expect(entry.item).toMatchObject({ id: "custom:I-1", liquid: true, servings: [{ label: "", grams: 200 }] });
    expect(entry).toMatchObject({ source: "manual", grams: 200 });
    expect(phoneKcal(entry)).toBe(92);
  });
  it("times a food added to another day at the meal's hour, never in the future", () => {
    expect(entryTime("2026-11-20", "dinner", NOW)).toEqual(NOW);
    expect(entryTime("2026-11-18", "dinner", NOW)).toEqual(new Date(2026, 10, 18, 19, 0));
    expect(entryTime("2026-11-18", "breakfast", NOW)).toEqual(new Date(2026, 10, 18, 8, 0));
    expect(entryTime("2026-11-21", "dinner", NOW)).toEqual(NOW);
  });
  it("bumps the version on an edit and keeps every native field", () => {
    const yoghurt = entries.find((e) => e.item.barcode != null)!;
    const next = withAmount(yoghurt, 200)!;
    expect(next).toEqual({ ...yoghurt, grams: 200, version: yoghurt.version + 1 });
    expect(next.item).toBe(yoghurt.item); // brand, barcode, servings untouched
    expect(withAmount(next, 175)!.version).toBe(yoghurt.version + 2);
    expect(withAmount(yoghurt, 0)).toBeNull();
    const quick = entries.find((e) => e.item.id.startsWith("quick:"))!;
    expect(withAmount(quick, 2)!.grams).toBe(200); // two servings of a 100 g "serving"
  });
  it("copies a day as the phone does: same clock times, never after now", () => {
    const at = (h: number, m = 0) => dateToRef(new Date(2026, 10, 19, h, m));
    const item = entries[0].item;
    const mk = (id: string, time: number, meal: NativeFoodEntry["meal"]): NativeFoodEntry => ({ id, time, meal, item, grams: 120, source: "barcode", version: 4 });
    let n = 0;
    const out = copyEntries([mk("D", at(19, 30), "dinner"), mk("A", at(7, 5), "breakfast"), mk("S", at(16), "snack")], "2026-11-20", NOW, () => `NEW-${++n}`);
    expect(out.map((e) => e.id)).toEqual(["NEW-1", "NEW-2", "NEW-3"]);
    expect(out.map((e) => e.meal)).toEqual(["breakfast", "snack", "dinner"]);
    expect(refToDate(out[0].time)).toEqual(new Date(2026, 10, 20, 7, 5));
    // The two later than 14:10 are logged two and one seconds before now.
    expect(refToDate(out[1].time)).toEqual(new Date(NOW.getTime() - 2000));
    expect(refToDate(out[2].time)).toEqual(new Date(NOW.getTime() - 1000));
    expect(out.every((e) => e.version === 1 && e.grams === 120 && e.source === "barcode" && e.item === item)).toBe(true);
  });
});

describe("targets and burn", () => {
  it("splits a day's calories into the profile's resting and what is above it", () => {
    const cal = (day: number, calories?: number): NativeDayVitals => ({ day: { year: 2026, month: 11, day }, ...(calories == null ? {} : { calories }) });
    expect(dayBurns([cal(18, 2480), cal(19, 1500), cal(20)], 1647)).toEqual({
      "2026-11-18": { resting: 1647, active: 833 },
      "2026-11-19": { resting: 1647, active: 0 },
    });
  });
  it("gives the phone's limits and leaves sugar and cholesterol out", () => {
    const t = targetsFor(profile, 833); // 1647 + 833 − 400
    expect(t.kcal).toBe(2080);
    expect(t.sodium).toBe(2300);
    expect(t.satFat).toBeCloseTo(23.1111, 4);
    expect(t.sugar).toBeUndefined();
    expect(t.cholesterol).toBeUndefined();
  });
  it("builds the screen from the seed with per-day targets and nothing from the sample", () => {
    const data = fuelFromItems({ entries, ownFoods, profile, bodyRestingKcal: 1694, days, builtIn: FOODS }, NOW);
    expect(data.sampleDay).toBe("2026-11-20");
    expect(data.targets!.kcal).toBe(1647);
    expect(data.restingKcal).toBeNull();
    expect(data.notes).toEqual({});
    expect(data.idea).toBeUndefined();
    expect(data.coach).toBeUndefined();
    expect(data.tastes).toBeUndefined();
    const withCalories = days.filter((d) => typeof d.calories === "number");
    expect(Object.keys(data.burn)).toHaveLength(withCalories.length);
    for (const [day, b] of Object.entries(data.burn)) {
      expect(b.resting).toBe(1647);
      expect(data.targetsByDay![day].kcal).toBe(Math.max(1647, 1647 + b.active - 400));
    }
    expect(data.foods.slice(0, FOODS.length)).toEqual(FOODS);
    expect(data.foods.slice(FOODS.length).map((f) => f.name)).toEqual(["Home granola", "Recovery shake"]);
    expect(data.foods.at(-1)).toMatchObject({ liquid: true, per100: { kcal: 76 } });
  });
  it("has no targets without a profile, but still the log", () => {
    const data = fuelFromItems({ entries, ownFoods: [], profile: undefined, bodyRestingKcal: undefined, days, builtIn: FOODS }, NOW);
    expect(data.targets).toBeNull();
    expect(data.burn).toEqual({});
    expect(Object.keys(data.logs).length).toBeGreaterThan(0);
  });
});
