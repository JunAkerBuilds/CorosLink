import { describe, expect, it } from "vitest";
import { foodNutrients } from "@/lib/fuel";
import { mealPrompt, parseMeal } from "./meal";
import { cleanTitle } from "./title";

describe("Meal estimates", () => {
  it("reads the foods out of a fenced reply, per 100 g so changing the grams scales them", () => {
    let n = 0;
    const estimate = parseMeal('Here you go:\n```json\n{"items":[{"name":"Toast","grams":"60","kcal":160,"proteinG":5,"carbsG":30,"fatG":2},{"name":"","kcal":1},{"name":"Egg","grams":50,"kcal":-3}],"note":"Butter not counted"}\n```', () => `id${++n}`)!;
    expect(estimate.note).toBe("Butter not counted");
    expect(estimate.foods).toHaveLength(1);
    const [toast] = estimate.foods;
    expect(toast).toMatchObject({ id: "id1", name: "Toast", unit: "g", amount: 60 });
    expect(foodNutrients(toast).kcal).toBeCloseTo(160);
    expect(foodNutrients({ ...toast, amount: 120 }).protein).toBeCloseTo(10);
  });

  it("finds no estimate in a reply without JSON", () => {
    expect(parseMeal("I can't see any food.", () => "x")).toBeNull();
  });

  it("asks about the photo and the words it was given", () => {
    expect(mealPrompt("eggs", true)).toMatch(/^The meal is in the attached photo\.\nThe athlete describes it as: eggs\n\nAnswer with only this JSON/);
    expect(mealPrompt("eggs", false)).toMatch(/^The athlete describes it as: eggs\n/);
  });
});

describe("Conversation titles", () => {
  it("keeps the title alone", () => {
    expect(cleanTitle('Title: "Tempo week tweaks."\nMore text')).toBe("Tempo week tweaks");
    expect(cleanTitle("**Knee pain after long run**")).toBe("Knee pain after long run");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("x".repeat(60))).toHaveLength(49);
  });
});
