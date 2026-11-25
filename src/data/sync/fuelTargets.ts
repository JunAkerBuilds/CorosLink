// The phone's Fuel target maths (CorosKit Fuel/FuelTargets.swift and FuelLimit in Fuel/Nutrition.swift), ported
// line for line so the web shows the numbers the phone shows. One part is left out: the training day
// (FuelTrainingDay), which needs the COROS calendar the phone reads and the web has no synced copy of. Targets
// here are the phone's `training: nil` ones: "as they were before training days counted".
import type { NativeFuelGoal, NativeFuelProfile, NativeMacroTarget, NativeMacroUnit } from "./native";

export type FuelNutrient = "protein" | "carbs" | "fat" | "fiber";

/** Swift's `Double.rounded()`: to the nearest whole number, halves away from zero (JS rounds −2.5 to −2). */
export function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** kcal a day under or over what is burned. */
export const KCAL_OFFSET: Record<NativeFuelGoal, number> = { lose: -400, maintain: 0, custom: 0, gain: 250 };

export const CUSTOM_KCAL_RANGE: readonly [number, number] = [1000, 6000];
const PROTEIN_PER_KG = 1.6;
const FAT_SHARE = 0.3;
const FIBER_PER_1000_KCAL = 14;

/** Atwater energy per gram; fibre counts as part of the carbohydrate. */
const KCAL_PER_GRAM: Record<FuelNutrient, number> = { protein: 4, carbs: 4, fat: 9, fiber: 0 };

/** `FuelNutrient.range(_:)`. */
export function macroRange(nutrient: FuelNutrient, unit: NativeMacroUnit): readonly [number, number] {
  if (unit === "per1000Kcal") return [5, 40];
  if (nutrient === "protein") return unit === "grams" ? [20, 400] : unit === "perKg" ? [0.5, 4] : [5, 60];
  if (nutrient === "carbs") return unit === "grams" ? [0, 1200] : unit === "perKg" ? [0, 15] : [0, 85];
  if (nutrient === "fat") return unit === "grams" ? [10, 300] : unit === "perKg" ? [0.3, 3] : [10, 75];
  return [5, 100];
}

/** `FuelNutrient.step(_:)`. */
export function macroStep(nutrient: FuelNutrient, unit: NativeMacroUnit): number {
  if (unit === "perKg") return nutrient === "carbs" ? 0.5 : 0.1;
  if (unit === "percent" || unit === "per1000Kcal") return 1;
  return nutrient === "fiber" ? 1 : 5;
}

/** `FuelMacroTarget.snapped`: onto the nutrient's steps and into its range. */
export function snapped(value: number, nutrient: FuelNutrient, unit: NativeMacroUnit): number {
  const [lo, hi] = macroRange(nutrient, unit), step = macroStep(nutrient, unit);
  return clamp(roundHalfAway(value / step) * step, lo, hi);
}

/** `FuelMacroTarget.grams(_:kcal:weightKg:)`: grams a day for a day with `kcal` as its energy target. */
export function macroGrams(own: NativeMacroTarget, nutrient: FuelNutrient, kcal: number, weightKg: number): number {
  const value = snapped(own.value, nutrient, own.unit);
  switch (own.unit) {
    case "grams": return value;
    case "perKg": return value * weightKg;
    case "percent": return KCAL_PER_GRAM[nutrient] > 0 ? (kcal * value) / 100 / KCAL_PER_GRAM[nutrient] : 0;
    case "per1000Kcal": return (kcal / 1000) * value;
  }
}

/** Mifflin–St Jeor: 10 × kg + 6.25 × cm − 5 × years, then +5 for men, −161 for women, −78 when unspecified. */
export function restingKcal(profile: Pick<NativeFuelProfile, "weightKg" | "heightCm" | "age" | "sex">): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  const adjustment = profile.sex === "male" ? 5 : profile.sex === "female" ? -161 : -78;
  return roundHalfAway(base + adjustment);
}

/** `FuelProfile.customTarget`: the daily number for a custom goal, 2,000 kcal until one is chosen. */
export function customTarget(profile: Pick<NativeFuelProfile, "customKcal">): number {
  return clamp(profile.customKcal ?? 2000, CUSTOM_KCAL_RANGE[0], CUSTOM_KCAL_RANGE[1]);
}

/** A day's targets. Sugar and cholesterol have no limit on the phone, so they have none here. */
export interface FuelDayTargets {
  restingKcal: number;
  activeKcal: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  /** `FuelLimit.saturatedFat`: under 10% of the energy target. */
  saturatedFatG: number | null;
  /** `FuelLimit.sodium`: 2,300 mg. */
  sodiumMg: number;
}

/** `FuelTargets(profile:activeKcal:training: nil)` with the two everyday limits of `FuelLimit`. */
export function fuelTargets(profile: NativeFuelProfile, activeKcal: number): FuelDayTargets {
  const resting = restingKcal(profile);
  const active = Math.max(0, activeKcal);
  // Never below resting energy: a deficit comes out of what training adds, not out of the body's basics.
  const kcal = profile.goal === "custom" ? customTarget(profile) : Math.max(resting + active + (KCAL_OFFSET[profile.goal] ?? 0), resting);
  const own = profile.macros ?? {}, weight = profile.weightKg;
  const proteinG = own.protein ? macroGrams(own.protein, "protein", kcal, weight) : weight * PROTEIN_PER_KG;
  const fatG = own.fat ? macroGrams(own.fat, "fat", kcal, weight) : (kcal * FAT_SHARE) / 9;
  const carbsG = own.carbs ? macroGrams(own.carbs, "carbs", kcal, weight) : Math.max(0, (kcal - proteinG * 4 - fatG * 9) / 4);
  const fiberG = own.fiber ? macroGrams(own.fiber, "fiber", kcal, weight) : (kcal / 1000) * FIBER_PER_1000_KCAL;
  return {
    restingKcal: resting, activeKcal: active, kcal, proteinG, carbsG, fatG, fiberG,
    saturatedFatG: kcal > 0 ? (kcal * 0.1) / 9 : null, sodiumMg: 2300,
  };
}
