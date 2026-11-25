import { describe, expect, it } from "vitest";
import { customTarget, fuelTargets, macroGrams, restingKcal, roundHalfAway, snapped } from "./fuelTargets";
import type { NativeFuelProfile } from "./native";

const man: NativeFuelProfile = { weightKg: 72.4, heightCm: 178, age: 39, sex: "male", goal: "lose" };

describe("roundHalfAway", () => {
  it("rounds halves away from zero, as Swift's rounded() does", () => {
    expect(roundHalfAway(1646.5)).toBe(1647);
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3); // Math.round gives −2
    expect(roundHalfAway(-2.4)).toBe(-2);
    expect(roundHalfAway(0)).toBe(0);
  });
});

describe("restingKcal (Mifflin–St Jeor)", () => {
  it("adds 5 for men", () => {
    // 724 + 1112.5 − 195 + 5 = 1646.5 → 1647
    expect(restingKcal(man)).toBe(1647);
  });
  it("takes 161 off for women", () => {
    // 600 + 1031.25 − 150 − 161 = 1320.25 → 1320
    expect(restingKcal({ weightKg: 60, heightCm: 165, age: 30, sex: "female" })).toBe(1320);
  });
  it("takes the midpoint when unspecified", () => {
    // 700 + 1093.75 − 175 − 78 = 1540.75 → 1541
    expect(restingKcal({ weightKg: 70, heightCm: 175, age: 35, sex: "unspecified" })).toBe(1541);
  });
});

describe("fuelTargets", () => {
  it("lose: 400 under what is burned, protein 1.6 g/kg, fat 30%, carbs the rest, fibre 14 g per 1,000 kcal", () => {
    const t = fuelTargets(man, 600);
    expect(t.restingKcal).toBe(1647);
    expect(t.kcal).toBe(1847); // 1647 + 600 − 400
    expect(t.proteinG).toBeCloseTo(115.84, 10); // 72.4 × 1.6
    expect(t.fatG).toBeCloseTo(61.5667, 4); // 1847 × 0.3 / 9
    expect(t.carbsG).toBeCloseTo(207.385, 3); // (1847 − 463.36 − 554.1) / 4
    expect(t.fiberG).toBeCloseTo(25.858, 3);
    expect(t.saturatedFatG).toBeCloseTo(20.5222, 4); // 10% of energy
    expect(t.sodiumMg).toBe(2300);
  });
  it("never goes below resting energy", () => {
    expect(fuelTargets(man, 0).kcal).toBe(1647);
    expect(fuelTargets(man, 250).kcal).toBe(1647);
    expect(fuelTargets(man, -90).activeKcal).toBe(0);
  });
  it("maintain and gain", () => {
    const woman: NativeFuelProfile = { weightKg: 60, heightCm: 165, age: 30, sex: "female", goal: "maintain" };
    expect(fuelTargets(woman, 480).kcal).toBe(1800);
    expect(fuelTargets({ ...woman, goal: "gain" }, 480).kcal).toBe(2050);
  });
  it("a custom goal stays at the chosen number all day, clamped to 1,000…6,000", () => {
    const own: NativeFuelProfile = { ...man, goal: "custom", customKcal: 2500 };
    expect(fuelTargets(own, 0).kcal).toBe(2500);
    expect(fuelTargets(own, 900).kcal).toBe(2500);
    expect(customTarget({})).toBe(2000);
    expect(customTarget({ customKcal: 800 })).toBe(1000);
    expect(customTarget({ customKcal: 9000 })).toBe(6000);
    // 2500 kcal: fat 83.33 g, carbs (2500 − 463.36 − 750) / 4
    expect(fuelTargets(own, 0).carbsG).toBeCloseTo(321.66, 10);
  });
  it("takes the person's own macro targets in each unit", () => {
    const own: NativeFuelProfile = {
      ...man, goal: "custom", customKcal: 2400,
      macros: { protein: { unit: "perKg", value: 2 }, fat: { unit: "percent", value: 25 }, carbs: { unit: "grams", value: 300 }, fiber: { unit: "per1000Kcal", value: 12 } },
    };
    const t = fuelTargets(own, 0);
    expect(t.proteinG).toBeCloseTo(144.8, 10); // 2 × 72.4
    expect(t.fatG).toBeCloseTo(66.6667, 4); // 2400 × 25% / 9
    expect(t.carbsG).toBe(300);
    expect(t.fiberG).toBeCloseTo(28.8, 10); // 2.4 × 12
  });
  it("lets unset carbs fill what own protein and fat leave", () => {
    const t = fuelTargets({ ...man, goal: "custom", customKcal: 2000, macros: { protein: { unit: "grams", value: 150 }, fat: { unit: "grams", value: 70 } } }, 0);
    expect(t.carbsG).toBe((2000 - 600 - 630) / 4);
  });
});

describe("snapped and macroGrams", () => {
  it("snaps onto the nutrient's steps and into its range", () => {
    expect(snapped(152, "protein", "grams")).toBe(150); // 5 g steps
    expect(snapped(152.5, "protein", "grams")).toBe(155); // 30.5 steps → 31
    expect(snapped(5, "protein", "grams")).toBe(20);
    expect(snapped(900, "protein", "grams")).toBe(400);
    expect(snapped(1.84, "protein", "perKg")).toBeCloseTo(1.8, 10);
    expect(snapped(6.3, "carbs", "perKg")).toBe(6.5); // 0.5 steps
    expect(snapped(27.4, "fiber", "grams")).toBe(27); // 1 g steps
    expect(snapped(90, "fat", "percent")).toBe(75);
    expect(snapped(2, "fiber", "per1000Kcal")).toBe(5);
  });
  it("turns each unit into grams", () => {
    expect(macroGrams({ unit: "percent", value: 20 }, "protein", 2000, 70)).toBe(100);
    expect(macroGrams({ unit: "percent", value: 30 }, "fat", 1800, 70)).toBe(60);
    expect(macroGrams({ unit: "perKg", value: 5 }, "carbs", 2000, 70)).toBe(350);
    expect(macroGrams({ unit: "per1000Kcal", value: 14 }, "fiber", 2500, 70)).toBe(35);
    expect(macroGrams({ unit: "grams", value: 33 }, "fiber", 2500, 70)).toBe(33);
  });
});
