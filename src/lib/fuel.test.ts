import { describe, expect, it } from "vitest";
import type { DayLog, LoggedFood, Nutrients } from "@/data/fuel";
import { FUEL_SAMPLE } from "@/data/sample/fuel";
import { FOODS } from "@/data/sample/foods";
import {
  addFood, addNutrients, basisOf, burnedKcal, changeAmount, copyFoods, dayTotals, daysEnding, dial, emptyDay, foodCount,
  foodLabel, foodNutrients, kcalFromMacros, logFood, macroCheck, macroPercents, mealTargetKcal, mealTotals, mean,
  parseAmount, petalsLit, remaining, removeFood, scaleNutrients, searchFoods, shiftDay, trim, ZERO,
} from "./fuel";

const n = (over: Partial<Nutrients>): Nutrients => ({ ...ZERO, ...over });
const food = (id: string, over: Partial<LoggedFood> = {}): LoggedFood => ({
  id, name: "Rice", unit: "g", amount: 100, per: n({ kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }), ...over,
});

describe("scaling", () => {
  it("scales per-100 values to an amount", () => {
    const got = scaleNutrients(n({ kcal: 97, protein: 9, sodium: 36 }), 150);
    expect(got.kcal).toBeCloseTo(145.5);
    expect(got.protein).toBeCloseTo(13.5);
    expect(got.sodium).toBeCloseTo(54);
    expect(got.fat).toBe(0);
  });
  it("scales servings on a basis of one", () => {
    expect(basisOf("serving")).toBe(1);
    expect(basisOf("g")).toBe(100);
    expect(basisOf("ml")).toBe(100);
    expect(foodNutrients(food("a", { unit: "serving", amount: 2, per: n({ kcal: 95 }) })).kcal).toBe(190);
  });
  it("gives nothing for zero, negative or broken amounts", () => {
    for (const amount of [0, -5, NaN, Infinity]) expect(scaleNutrients(n({ kcal: 100 }), amount)).toEqual(ZERO);
    expect(scaleNutrients(n({ kcal: 100 }), 50, 0)).toEqual(ZERO);
  });
  it("adds every nutrient", () => {
    expect(addNutrients(n({ kcal: 1, sugar: 2 }), n({ kcal: 3, cholesterol: 4 }))).toEqual(n({ kcal: 4, sugar: 2, cholesterol: 4 }));
  });
});

describe("totals", () => {
  it("sums a meal and a day", () => {
    const log: DayLog = { day: "2026-11-19", meals: { breakfast: [food("a"), food("b", { amount: 50 })], lunch: [], dinner: [food("c", { amount: 200 })], snack: [] } };
    expect(mealTotals(log.meals.breakfast).kcal).toBeCloseTo(195);
    expect(mealTotals([])).toEqual(ZERO);
    expect(dayTotals(log).kcal).toBeCloseTo(455);
    expect(dayTotals(log).carbs).toBeCloseTo(98);
    expect(foodCount(log)).toBe(3);
  });

  it("the sample day adds up to the numbers on the canvas", () => {
    const log = FUEL_SAMPLE.logs[FUEL_SAMPLE.sampleDay];
    const t = dayTotals(log);
    const rounded = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
    expect(rounded).toEqual({ kcal: 1460, protein: 88, carbs: 160, fat: 52, fiber: 19, sugar: 38, satFat: 14, sodium: 1280, cholesterol: 190 });
    expect(Math.round(mealTotals(log.meals.breakfast).kcal)).toBe(520);
    expect(Math.round(mealTotals(log.meals.lunch).kcal)).toBe(760);
    expect(mealTotals(log.meals.dinner).kcal).toBe(0);
    expect(Math.round(mealTotals(log.meals.snack).kcal)).toBe(180);
    expect(kcalFromMacros(t)).toBeCloseTo(1460);
  });

  it("the sample week matches the chart and its average", () => {
    const days = daysEnding(FUEL_SAMPLE.sampleDay, 7);
    const eaten = days.map((d) => Math.round(dayTotals(FUEL_SAMPLE.logs[d]).kcal));
    expect(eaten).toEqual([2380, 2510, 2290, 2620, 2440, 2350, 1460]);
    expect(Math.round(mean(eaten))).toBe(2293);
    expect(days.map((d) => burnedKcal(FUEL_SAMPLE.burn[d]))).toEqual([2480, 2390, 2610, 2420, 2890, 2300, 2140]);
    expect(FUEL_SAMPLE.burn[FUEL_SAMPLE.sampleDay]).toEqual({ resting: 1720, active: 420 });
  });

  it("sample food ids are unique", () => {
    const ids = Object.values(FUEL_SAMPLE.logs).flatMap((l) => Object.values(l.meals).flat().map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("macros", () => {
  it("counts 4, 4 and 9 kcal a gram", () => {
    expect(kcalFromMacros({ protein: 10, carbs: 20, fat: 5 })).toBe(165);
  });
  it("accepts label rounding and flags numbers that cannot be right", () => {
    expect(macroCheck({ kcal: 165, protein: 10, carbs: 20, fat: 5 })).toEqual({ fromMacros: 165, diff: 0, ok: true });
    expect(macroCheck({ kcal: 180, protein: 10, carbs: 20, fat: 5 }).ok).toBe(true);
    expect(macroCheck({ kcal: 300, protein: 10, carbs: 20, fat: 5 }).ok).toBe(false);
    expect(macroCheck({ kcal: 20, protein: 0, carbs: 0, fat: 0 }).ok).toBe(true);
    expect(macroCheck({ kcal: 600, protein: 40, carbs: 60, fat: 30 }).ok).toBe(true);
    expect(macroCheck({ kcal: 100, protein: 40, carbs: 60, fat: 30 }).diff).toBe(-570);
  });
  it("splits energy into percents that add to 100", () => {
    const p = macroPercents({ protein: 88, carbs: 160, fat: 52 });
    expect(p.protein + p.carbs + p.fat).toBeCloseTo(100);
    expect(p.protein).toBeCloseTo((352 / 1460) * 100);
    expect(p.fat).toBeCloseTo((468 / 1460) * 100);
    expect(macroPercents({ protein: 0, carbs: 0, fat: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });
  it("says what is left or over", () => {
    expect(remaining(2450, 1460)).toEqual({ left: 990, over: false, gap: 990, progress: 1460 / 2450 });
    expect(remaining(150, 88).gap).toBe(62);
    expect(remaining(75, 80)).toMatchObject({ left: -5, over: true, gap: 5 });
    expect(remaining(100, 100)).toMatchObject({ left: 0, over: false, progress: 1 });
    expect(remaining(0, 50).progress).toBe(0);
  });
});

describe("petals", () => {
  it("lights the dial as on the canvas: 21 of 36, six green for moving", () => {
    expect(dial(1460, 2450, 420)).toEqual({ filled: 21, moved: 6, over: false, count: 36 });
  });
  it("lights nothing before food and at least one petal after", () => {
    expect(dial(0, 2450, 0).filled).toBe(0);
    expect(dial(0.2, 2450, 0).filled).toBe(0);
    expect(dial(10, 2450, 0).filled).toBe(1);
  });
  it("fills the ring at the target and marks over-target", () => {
    expect(dial(2450, 2450, 420)).toMatchObject({ filled: 36, over: false });
    expect(dial(2450.4, 2450, 420).over).toBe(false);
    expect(dial(2451, 2450, 420)).toMatchObject({ filled: 36, over: true });
    expect(dial(9000, 2450, 420)).toMatchObject({ filled: 36, over: true });
  });
  it("caps the moved share at 60% and survives a zero target", () => {
    expect(dial(100, 1000, 5000).moved).toBe(22);
    expect(dial(100, 0, 300)).toEqual({ filled: 1, moved: 0, over: true, count: 36 });
    expect(dial(0, 0, 0).over).toBe(false);
  });
  it("lights macro fans and meal rows as on the canvas", () => {
    expect(petalsLit(88 / 150, true, 9)).toBe(5);
    expect(petalsLit(160 / 320, true, 9)).toBe(5);
    expect(petalsLit(52 / 75, true, 9)).toBe(6);
    expect(petalsLit(19 / 34, true, 9)).toBe(5);
    expect(petalsLit(520 / 610, true, 8)).toBe(7);
    expect(petalsLit(760 / 860, true, 8)).toBe(7);
    expect(petalsLit(180 / 245, true, 8)).toBe(6);
    expect(petalsLit(0, false, 8)).toBe(0);
    expect(petalsLit(0.01, true, 8)).toBe(1);
    expect(petalsLit(3, true, 8)).toBe(8);
    expect(petalsLit(-1, true, 8)).toBe(1);
  });
  it("shares the day's target between meals to the nearest 5 kcal", () => {
    const shares = (["breakfast", "lunch", "dinner", "snack"] as const).map((m) => mealTargetKcal(m, 2450));
    expect(shares).toEqual([610, 860, 735, 245]);
    expect(shares.reduce((a, b) => a + b)).toBe(2450);
    expect(mealTargetKcal("lunch", 2000)).toBe(700);
    expect(mealTargetKcal("lunch", 0)).toBe(0);
  });
});

describe("days", () => {
  it("moves across month and year ends", () => {
    expect(shiftDay("2026-11-19", -1)).toBe("2026-11-18");
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("lists the days ending on a day, oldest first", () => {
    expect(daysEnding("2026-11-02", 4)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysEnding("2026-11-19", 30)).toHaveLength(30);
  });
  it("averages", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 6])).toBe(3);
  });
});

describe("editing a day", () => {
  const base = addFood(addFood(emptyDay("2026-11-19"), "breakfast", food("a")), "lunch", food("b"));
  it("adds without touching the log it was given", () => {
    const next = addFood(base, "breakfast", food("c"));
    expect(next.meals.breakfast.map((f) => f.id)).toEqual(["a", "c"]);
    expect(base.meals.breakfast).toHaveLength(1);
    expect(next.meals.lunch).toBe(base.meals.lunch);
  });
  it("removes by id, in that meal only", () => {
    expect(removeFood(base, "breakfast", "a").meals.breakfast).toEqual([]);
    expect(removeFood(base, "lunch", "a").meals.breakfast).toHaveLength(1);
  });
  it("changes an amount and the totals follow", () => {
    const next = changeAmount(base, "breakfast", "a", 250);
    expect(mealTotals(next.meals.breakfast).kcal).toBeCloseTo(325);
    expect(changeAmount(base, "breakfast", "a", 0)).toBe(base);
    expect(changeAmount(base, "breakfast", "a", NaN)).toBe(base);
  });
  it("copies a day's foods under new ids", () => {
    let k = 0;
    const next = copyFoods(base, addFood(emptyDay("2026-11-20"), "breakfast", food("x")), () => `new-${k++}`);
    expect(next.day).toBe("2026-11-20");
    expect(next.meals.breakfast.map((f) => f.id)).toEqual(["x", "new-0"]);
    expect(next.meals.lunch.map((f) => f.id)).toEqual(["new-1"]);
    expect(dayTotals(next).kcal).toBeCloseTo(390);
  });
  it("logs a listed food in grams or millilitres", () => {
    const milk = FOODS.find((f) => f.id === "milk-semi-skimmed")!;
    const entry = logFood(milk, 200, "id1");
    expect(entry.unit).toBe("ml");
    expect(foodNutrients(entry).kcal).toBe(100);
    expect(logFood(FOODS.find((f) => f.id === "banana")!, 120, "id2").unit).toBe("g");
  });
});

describe("the food list", () => {
  it("has about forty foods with unique ids and believable energy", () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      expect(f.per100.satFat, f.name).toBeLessThanOrEqual(f.per100.fat);
      expect(f.per100.sugar, f.name).toBeLessThanOrEqual(f.per100.carbs + 0.01);
      expect(Math.abs(f.per100.kcal - kcalFromMacros(f.per100)), f.name).toBeLessThanOrEqual(Math.max(25, 0.2 * f.per100.kcal));
    }
  });
  it("searches by every word, names starting with the query first", () => {
    expect(searchFoods(FOODS, "")).toHaveLength(FOODS.length);
    expect(searchFoods(FOODS, "  rice ").map((f) => f.name)).toEqual(["Rice, cooked"]);
    expect(searchFoods(FOODS, "cooked chicken").map((f) => f.name)).toEqual(["Chicken breast, cooked"]);
    expect(searchFoods(FOODS, "oat")[0].name).toBe("Oats, dry");
    expect(searchFoods(FOODS, "zzz")).toEqual([]);
  });
});

describe("words", () => {
  it("trims trailing zeros and groups thousands", () => {
    expect(trim(88)).toBe("88");
    expect(trim(12.46)).toBe("12.5");
    expect(trim(6.25, 2)).toBe("6.25");
    expect(trim(1280)).toBe("1,280");
    expect(trim(-0.01)).toBe("0");
    expect(trim(139.99999999)).toBe("140");
  });
  it("labels foods with their amount", () => {
    expect(foodLabel({ name: "Greek yoghurt", unit: "g", amount: 150 })).toBe("Greek yoghurt, 150 g");
    expect(foodLabel({ name: "Coffee with milk", unit: "ml", amount: 250 })).toBe("Coffee with milk, 250 ml");
    expect(foodLabel({ name: "Apple", unit: "serving", amount: 1 })).toBe("Apple");
    expect(foodLabel({ name: "Apple", unit: "serving", amount: 1.5 })).toBe("Apple × 1.5");
  });
  it("reads typed amounts", () => {
    expect(parseAmount("150")).toBe(150);
    expect(parseAmount(" 72,4 ")).toBe(72.4);
    expect(parseAmount(".5")).toBe(0.5);
    expect(parseAmount("0")).toBe(0);
    for (const bad of ["", ".", "abc", "-3", "1e3", "1.2.3"]) expect(parseAmount(bad)).toBeNull();
  });
});
