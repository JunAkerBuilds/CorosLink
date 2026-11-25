// Fuel from synced items: the phone's food log (`fuel.entry`), own foods (`fuel.food`), profile (`fuel.profile`)
// and the day's calories (`health.day`) into the Fuel screen's types, and the screen's edits back into native
// FoodEntry items the phone's decoder accepts. Pure: items and `now` in, values out.
import type { DayBurn, DayLog, FoodItem, FuelData, LoggedFood, MealKey, Nutrients, Targets } from "@/data/fuel";
import { fuelTargets, restingKcal } from "./fuelTargets";
import {
  calendarDayKey, dateToRef, refToDate,
  type NativeDayVitals, type NativeFoodEntry, type NativeFoodItem, type NativeFoodSource, type NativeFuelProfile, type NativeNutrition,
} from "./native";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MEALS: readonly MealKey[] = ["breakfast", "lunch", "dinner", "snack"];
const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);

// MARK: Nutrition

export function nutrientsOf(n: NativeNutrition | undefined): Nutrients {
  return {
    kcal: num(n?.kcal), protein: num(n?.proteinG), carbs: num(n?.carbsG), fat: num(n?.fatG), fiber: num(n?.fiberG),
    sugar: num(n?.sugarG), satFat: num(n?.saturatedFatG), sodium: num(n?.sodiumMg), cholesterol: num(n?.cholesterolMg),
  };
}

/** All nine keys, as the phone writes them. */
export function nativeNutrition(n: Nutrients): NativeNutrition {
  return {
    kcal: n.kcal, proteinG: n.protein, carbsG: n.carbs, fatG: n.fat, fiberG: n.fiber,
    sugarG: n.sugar, saturatedFatG: n.satFat, sodiumMg: n.sodium, cholesterolMg: n.cholesterol,
  };
}

// MARK: Entries → the screen

/** A food that is only its totals (the phone's quick add, or one item of an estimate): its amount isn't a weight. */
export function isTotals(item: Pick<NativeFoodItem, "id">): boolean {
  return item.id.startsWith("quick:") || item.id.startsWith("estimate:");
}

/** The weight the phone counts as one "serving" of a totals food: 100 unless the item says otherwise. */
function totalsServing(item: NativeFoodItem): number {
  const grams = item.servings?.[0]?.grams;
  return typeof grams === "number" && grams > 0 ? grams : 100;
}

/**
 * An entry as the screen lists it, under the entry's id. Grams or ml with the per-100 values, so the total is the
 * phone's `per100g × grams / 100`. A totals food shows as servings (its amount is not a real weight), which gives
 * the same total: `per100g × serving / 100` a serving, `grams / serving` servings.
 */
export function loggedFood(entry: NativeFoodEntry): LoggedFood {
  const per100 = nutrientsOf(entry.item.per100g);
  if (isTotals(entry.item)) {
    const serving = totalsServing(entry.item);
    const per = { ...per100 };
    for (const k of Object.keys(per) as (keyof Nutrients)[]) per[k] = (per100[k] * serving) / 100;
    return { id: entry.id, name: entry.item.name, unit: "serving", amount: num(entry.grams) / serving, per };
  }
  return { id: entry.id, name: entry.item.name, unit: entry.item.liquid ? "ml" : "g", amount: num(entry.grams), per: per100 };
}

/** The phone's `grams` for an amount typed on the screen for this entry. */
export function gramsFor(entry: NativeFoodEntry, amount: number): number {
  return isTotals(entry.item) ? amount * totalsServing(entry.item) : amount;
}

/** The local calendar day an entry was eaten on. */
export function entryDay(entry: Pick<NativeFoodEntry, "time">): string {
  return localDay(refToDate(entry.time));
}

/** Every day with something logged, each meal in the order it was eaten. */
export function dayLogs(entries: readonly NativeFoodEntry[]): Record<string, DayLog> {
  const out: Record<string, DayLog> = {};
  const sorted = entries.filter((e) => e && e.item && typeof e.time === "number").sort((a, b) => a.time - b.time);
  for (const e of sorted) {
    const day = entryDay(e);
    const log = (out[day] ??= { day, meals: { breakfast: [], lunch: [], dinner: [], snack: [] } });
    log.meals[MEALS.includes(e.meal) ? e.meal : "snack"].push(loggedFood(e));
  }
  return out;
}

// MARK: Foods

/** The built-in list is not the phone's USDA database, so its foods go to the phone under "web:<slug>". */
export const WEB_FOOD_PREFIX = "web:";

/** A food of the built-in list as a native FoodItem. */
export function nativeListFood(food: FoodItem): NativeFoodItem {
  const item: NativeFoodItem = { id: `${WEB_FOOD_PREFIX}${food.id}`, name: food.name, per100g: nativeNutrition(food.per100), servings: [] };
  if (food.liquid) item.liquid = true;
  return item;
}

/** The dialog's food list: the built-in foods, then the person's own (`fuel.food`, ids "custom:…"). */
export function foodList(builtIn: readonly FoodItem[], own: readonly NativeFoodItem[]): FoodItem[] {
  const mine = own
    .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
    .map((f): FoodItem => ({ id: f.id, name: f.name, liquid: f.liquid === true, per100: nutrientsOf(f.per100g) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...builtIn, ...mine];
}

// MARK: The screen → entries

const MEAL_CLOCK: Record<MealKey, [hour: number, minute: number]> = { breakfast: [8, 0], lunch: [12, 30], snack: [15, 30], dinner: [19, 0] };

/** When a food added on `day` was eaten: now for today, else the meal's usual hour that day. Never after now. */
export function entryTime(day: string, meal: MealKey, now: Date): Date {
  if (day === localDay(now)) return now;
  const [y, m, d] = day.split("-").map(Number);
  const [hour, minute] = MEAL_CLOCK[meal];
  const at = new Date(y, m - 1, d, hour, minute, 0);
  return at.getTime() > now.getTime() ? now : at;
}

/** Where a food added on the screen came from. */
export type FoodOrigin =
  /** Picked from the dialog's list: the native item it stands for (a built-in food or one of the person's own). */
  | { from: "list"; item: NativeFoodItem }
  /** Typed in with its own numbers. */
  | { from: "own" };

export interface NewEntry {
  entry: NativeFoodEntry;
  /** An own food to keep (`fuel.food`), when the person typed one in by weight or volume. */
  food?: NativeFoodItem;
}

/**
 * A food added on the screen as a native FoodEntry. A list food keeps its item and logs the grams or ml typed. Typed-in
 * numbers per 100 g/ml make an own food ("custom:<UUID>", its serving the amount logged). Typed-in numbers per serving
 * have no weight: they are stored as the phone stores totals ("quick:<UUID>", a 100 g "serving", 100 g × the count),
 * so the phone shows the same calories.
 */
export function newEntry(args: { id: string; itemId: string; day: string; meal: MealKey; food: LoggedFood; origin: FoodOrigin; now: Date }): NewEntry {
  const { id, itemId, day, meal, food, origin, now } = args;
  const base = { id, time: dateToRef(entryTime(day, meal, now)), meal, version: 1 };
  if (origin.from === "list" && food.unit !== "serving") {
    const source: NativeFoodSource = origin.item.id.startsWith("custom:") ? "manual" : "search";
    return { entry: { ...base, item: origin.item, grams: food.amount, source } };
  }
  if (food.unit === "serving") {
    const item: NativeFoodItem = { id: `quick:${itemId}`, name: food.name, per100g: nativeNutrition(food.per), servings: [{ label: "", grams: 100 }] };
    return { entry: { ...base, item, grams: 100 * food.amount, source: "manual" } };
  }
  const item: NativeFoodItem = { id: `custom:${itemId}`, name: food.name, per100g: nativeNutrition(food.per), servings: [{ label: "", grams: food.amount }] };
  if (food.unit === "ml") item.liquid = true;
  return { entry: { ...base, item, grams: food.amount, source: "manual" }, food: item };
}

/** An entry with a new amount, one version on. Everything else stays as the phone wrote it. Null when the amount isn't above zero. */
export function withAmount(entry: NativeFoodEntry, amount: number): NativeFoodEntry | null {
  if (!(amount > 0) || !isFinite(amount)) return null;
  return { ...entry, grams: gramsFor(entry, amount), version: num(entry.version) + 1 };
}

/**
 * `entries` eaten again on `day` (FoodEntry.copies in FoodLog.swift): the same foods, amounts and meals, each at its
 * own time of day but never later than `now`. Those that would be later are logged in the seconds just before now,
 * one second apart in their order.
 */
export function copyEntries(entries: readonly NativeFoodEntry[], day: string, now: Date, newId: () => string): NativeFoodEntry[] {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const latest = Math.max(now.getTime(), start.getTime());
  const times = [...entries].sort((a, b) => a.time - b.time).map((entry) => {
    const clock = refToDate(entry.time);
    return { entry, at: new Date(y, m - 1, d, clock.getHours(), clock.getMinutes(), clock.getSeconds()).getTime() };
  });
  const late = times.filter((t) => t.at > latest).length;
  let lateIndex = 0;
  return times.map(({ entry, at }) => {
    let time = at;
    if (at > latest) {
      time = Math.max(start.getTime(), latest + (lateIndex - late) * 1000);
      lateIndex += 1;
    }
    return { id: newId(), time: dateToRef(new Date(time)), meal: entry.meal, item: entry.item, grams: entry.grams, source: entry.source, version: 1 };
  });
}

// MARK: Targets and burn

/** Whether a synced profile holds the numbers the targets need. */
export function usableProfile(profile: NativeFuelProfile | undefined): profile is NativeFuelProfile {
  return profile != null && profile.weightKg > 0 && profile.heightCm > 0 && typeof profile.age === "number" && isFinite(profile.age);
}

/** The phone's targets for a day with `activeKcal`, in the screen's units. Sugar and cholesterol have no limit on the phone. */
export function targetsFor(profile: NativeFuelProfile, activeKcal: number): Targets {
  const t = fuelTargets(profile, activeKcal);
  return { kcal: t.kcal, protein: t.proteinG, carbs: t.carbsG, fat: t.fatG, fiber: t.fiberG, satFat: t.saturatedFatG ?? undefined, sodium: t.sodiumMg };
}

/**
 * A day's calories split as Fuel's targets count them: `resting` for the whole day, and what the watch counted
 * above it as active (never below zero). Only for days the watch counted calories on.
 */
export function dayBurns(days: readonly NativeDayVitals[], resting: number): Record<string, DayBurn> {
  const out: Record<string, DayBurn> = {};
  for (const v of days) {
    if (!v?.day || typeof v.calories !== "number" || !isFinite(v.calories)) continue;
    out[calendarDayKey(v.day)] = { resting, active: Math.max(0, v.calories - resting) };
  }
  return out;
}

export interface FuelItems {
  entries: readonly NativeFoodEntry[];
  ownFoods: readonly NativeFoodItem[];
  profile: NativeFuelProfile | undefined;
  /** kcal a day at rest from `view.body`, used for the burn split only when there is no profile to work it out from. */
  bodyRestingKcal: number | undefined;
  days: readonly NativeDayVitals[];
  builtIn: readonly FoodItem[];
}

/** The Fuel screen from synced items. Nothing here comes from the sample athlete. */
export function fuelFromItems(items: FuelItems, now: Date): FuelData {
  const profile = usableProfile(items.profile) ? items.profile : undefined;
  const resting = profile ? restingKcal(profile) : typeof items.bodyRestingKcal === "number" ? Math.round(items.bodyRestingKcal) : null;
  const burn = resting == null ? {} : dayBurns(items.days, resting);
  const targetsByDay: Record<string, Targets> = {};
  if (profile) for (const [day, b] of Object.entries(burn)) targetsByDay[day] = targetsFor(profile, b.active);
  return {
    sampleDay: localDay(now),
    targets: profile ? targetsFor(profile, 0) : null,
    targetsByDay,
    logs: dayLogs(items.entries),
    burn,
    restingKcal: null,
    notes: {},
    foods: foodList(items.builtIn, items.ownFoods),
  };
}
