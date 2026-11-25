/** Fuel sums. Pure: food amounts in, totals, what's left and petal counts out. */
import type { DayBurn, DayLog, FoodItem, LoggedFood, MealKey, Meals, Nutrients, Unit } from "@/data/fuel";
import { dayKey, parseDay } from "@/lib/format";

export const NUTRIENT_KEYS = ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "satFat", "sodium", "cholesterol"] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, satFat: 0, sodium: 0, cholesterol: 0 };

const MEALS: readonly MealKey[] = ["breakfast", "lunch", "dinner", "snack"];

/** Petals on the calorie dial, on a macro fan and on a meal tile's row. */
export const DIAL_PETALS = 36;
export const FAN_PETALS = 9;
export const ROW_PETALS = 8;

/** The amount `per` values are stated for: 100 g or 100 ml, or one serving. */
export function basisOf(unit: Unit): number {
  return unit === "serving" ? 1 : 100;
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = { ...ZERO };
  for (const k of NUTRIENT_KEYS) out[k] = a[k] + b[k];
  return out;
}

/** Values stated per `basis` (100 g/ml or one serving), scaled to `amount`. */
export function scaleNutrients(per: Nutrients, amount: number, basis = 100): Nutrients {
  const out = { ...ZERO };
  const f = basis > 0 && isFinite(amount) && amount > 0 ? amount / basis : 0;
  for (const k of NUTRIENT_KEYS) out[k] = per[k] * f;
  return out;
}

/** What a logged food holds at its amount. */
export function foodNutrients(food: LoggedFood): Nutrients {
  return scaleNutrients(food.per, food.amount, basisOf(food.unit));
}

export function mealTotals(foods: readonly LoggedFood[]): Nutrients {
  return foods.reduce((sum, f) => addNutrients(sum, foodNutrients(f)), ZERO);
}

export function dayTotals(log: DayLog): Nutrients {
  return MEALS.reduce((sum, m) => addNutrients(sum, mealTotals(log.meals[m])), ZERO);
}

export function foodCount(log: DayLog): number {
  return MEALS.reduce((n, m) => n + log.meals[m].length, 0);
}

/** Energy the macros account for: 4 kcal a gram of protein and carbs, 9 a gram of fat. */
export function kcalFromMacros(n: Pick<Nutrients, "protein" | "carbs" | "fat">): number {
  return 4 * n.protein + 4 * n.carbs + 9 * n.fat;
}

/**
 * Whether stated calories agree with the macros. Labels round and count fibre differently, so a food passes
 * within 20 kcal or 15%, whichever is larger.
 */
export function macroCheck(n: Pick<Nutrients, "kcal" | "protein" | "carbs" | "fat">): { fromMacros: number; diff: number; ok: boolean } {
  const fromMacros = kcalFromMacros(n);
  const diff = n.kcal - fromMacros;
  return { fromMacros, diff, ok: Math.abs(diff) <= Math.max(20, 0.15 * Math.max(n.kcal, fromMacros)) };
}

/** Each macro's share of the energy the macros account for, in percent. All zero when nothing is eaten. */
export function macroPercents(n: Pick<Nutrients, "protein" | "carbs" | "fat">): { protein: number; carbs: number; fat: number } {
  const total = kcalFromMacros(n);
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: (400 * n.protein) / total, carbs: (400 * n.carbs) / total, fat: (900 * n.fat) / total };
}

export interface Remaining {
  /** Target minus eaten; negative when over. */
  left: number;
  over: boolean;
  /** The size of the gap either way, for "62 g left" / "5 g over". */
  gap: number;
  /** Eaten as a share of the target, 0 and up (above 1 when over). */
  progress: number;
}

export function remaining(target: number, eaten: number): Remaining {
  const left = target - eaten;
  return { left, over: left < 0, gap: Math.abs(left), progress: target > 0 ? eaten / target : 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Petals lit for `progress` of a target. Once anything is eaten at least one petal is lit; at or over the
 * target every petal is.
 */
export function petalsLit(progress: number, started: boolean, count: number): number {
  if (!started) return 0;
  return clamp(Math.round(clamp(progress, 0, 1) * count), 1, count);
}

export interface Dial {
  /** Petals lit clockwise from the top, 0…36. */
  filled: number;
  /** The last petals of the ring that stand for what moving added to the day (drawn green while unlit). */
  moved: number;
  over: boolean;
  count: number;
}

/** The calorie dial: eaten against the target, with the active-calorie share marked at the end of the ring. */
export function dial(eatenKcal: number, targetKcal: number, activeKcal: number, count = DIAL_PETALS): Dial {
  const r = remaining(targetKcal, eatenKcal);
  const moved = targetKcal > 0 ? Math.round(clamp(activeKcal / targetKcal, 0, 0.6) * count) : 0;
  return { filled: petalsLit(r.progress, eatenKcal >= 0.5, count), moved, over: Math.round(r.left) < 0, count };
}

/** Rounds halves to the even neighbour, so the four meal shares add back up to the day's target. */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const diff = v - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}

export const MEAL_SHARE: Record<MealKey, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };

/** A meal's share of the day's energy target, to the nearest 5 kcal. */
export function mealTargetKcal(meal: MealKey, dayTarget: number): number {
  if (!(dayTarget > 0)) return 0;
  return roundHalfEven((dayTarget * MEAL_SHARE[meal]) / 5) * 5;
}

export function burnedKcal(burn: DayBurn): number {
  return burn.resting + burn.active;
}

// MARK: Days

export function shiftDay(day: string, delta: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

/** The `count` days ending on `day`, oldest first. */
export function daysEnding(day: string, count: number): string[] {
  return Array.from({ length: count }, (_, k) => shiftDay(day, k - (count - 1)));
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// MARK: Editing a day (each returns a new log)

export function emptyDay(day: string): DayLog {
  return { day, meals: { breakfast: [], lunch: [], dinner: [], snack: [] } };
}

function withMeal(log: DayLog, meal: MealKey, foods: LoggedFood[]): DayLog {
  const meals: Meals = { ...log.meals, [meal]: foods };
  return { ...log, meals };
}

export function addFood(log: DayLog, meal: MealKey, food: LoggedFood): DayLog {
  return withMeal(log, meal, [...log.meals[meal], food]);
}

export function removeFood(log: DayLog, meal: MealKey, id: string): DayLog {
  return withMeal(log, meal, log.meals[meal].filter((f) => f.id !== id));
}

/** Changes a logged food's amount. An amount that isn't above zero leaves the log as it was. */
export function changeAmount(log: DayLog, meal: MealKey, id: string, amount: number): DayLog {
  if (!(amount > 0) || !isFinite(amount)) return log;
  return withMeal(log, meal, log.meals[meal].map((f) => (f.id === id ? { ...f, amount } : f)));
}

/** Adds every food of `from` to the same meals of `into`, each under a fresh id. */
export function copyFoods(from: DayLog, into: DayLog, newId: () => string): DayLog {
  const meals = { ...into.meals };
  for (const m of MEALS) meals[m] = [...into.meals[m], ...from.meals[m].map((f) => ({ ...f, id: newId() }))];
  return { ...into, meals };
}

/** A food from the built-in list, logged at `amount` grams or millilitres. */
export function logFood(item: FoodItem, amount: number, id: string): LoggedFood {
  return { id, name: item.name, unit: item.liquid ? "ml" : "g", amount, per: { ...item.per100 } };
}

// MARK: Words

/** Foods whose name holds every word typed, names that start with the query first. */
export function searchFoods(foods: readonly FoodItem[], query: string): FoodItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...foods];
  const first = words.join(" ");
  return foods
    .filter((f) => { const name = f.name.toLowerCase(); return words.every((w) => name.includes(w)); })
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(first)) - Number(a.name.toLowerCase().startsWith(first)));
}

/** A number with up to `decimals` places and no trailing zeros: 88, 12.5, 6.25. Thousands grouped. */
export function trim(value: number, decimals = 1): string {
  const scale = 10 ** decimals;
  const rounded = Math.round(value * scale) / scale;
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** "Greek yoghurt, 150 g", "Coffee with milk, 250 ml", "Apple", "Apple × 2". */
export function foodLabel(food: Pick<LoggedFood, "name" | "unit" | "amount">): string {
  if (food.unit === "serving") return food.amount === 1 ? food.name : `${food.name} × ${trim(food.amount, 2)}`;
  return `${food.name}, ${trim(food.amount, 2)} ${food.unit}`;
}

/** Reads a typed number ("72,4" or "72.4"). Null for anything that isn't a number of zero or more. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const v = Number(t);
  return isFinite(v) && v >= 0 ? v : null;
}
