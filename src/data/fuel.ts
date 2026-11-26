import { fromSample, fromSynced, type Loaded } from "@/data/core";
import { FUEL_SAMPLE } from "@/data/sample/fuel";
import { FOODS } from "@/data/sample/foods";
import { language, t } from "@/lib/i18n";
import { newUuid, put, remove, syncView } from "@/data/sync";
import { copyEntries, entryDay, fuelFromItems, nativeListFood, newEntry, withAmount, type FoodOrigin } from "@/data/sync/fuel";

/** Energy and nutrients. Grams, except kcal and the two in milligrams. */
export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  satFat: number;
  /** mg */
  sodium: number;
  /** mg */
  cholesterol: number;
}

export type MealKey = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_KEYS: readonly MealKey[] = ["breakfast", "lunch", "dinner", "snack"];

/** How an amount is counted: grams, millilitres (drinks), or whole servings. */
export type Unit = "g" | "ml" | "serving";

/** A food from the built-in list: values per 100 g, or per 100 ml when `liquid`. */
export interface FoodItem {
  id: string;
  name: string;
  liquid: boolean;
  per100: Nutrients;
}

/** A food as logged in a meal. `per` holds the values per 100 g/ml, or per one serving. */
export interface LoggedFood {
  id: string;
  name: string;
  unit: Unit;
  amount: number;
  per: Nutrients;
}

export type Meals = Record<MealKey, LoggedFood[]>;

export interface DayLog {
  /** YYYY-MM-DD */
  day: string;
  meals: Meals;
}

/**
 * Daily targets, in the same units as `Nutrients`. The last four are everyday upper limits; the phone app has one
 * only for saturated fat and sodium, so a signed-in day has no sugar or cholesterol number.
 */
export type Targets = Pick<Nutrients, "kcal" | "protein" | "carbs" | "fat" | "fiber"> & Partial<Pick<Nutrients, "sugar" | "satFat" | "sodium" | "cholesterol">>;

/** Calories burned in a day. Both need the watch. */
export interface DayBurn {
  resting: number;
  active: number;
}

export interface TrainingNote {
  title: string;
  detail: string;
}

export interface FuelData {
  /** The sample athlete's day the page opens on. */
  sampleDay: string;
  /** The usual day's targets. Null when signed in and Fuel isn't set up in the phone app yet. */
  targets: Targets | null;
  /** Signed in: the targets of each day the watch counted calories on (they grow with the day's active calories). */
  targetsByDay?: Record<string, Targets>;
  logs: Record<string, DayLog>;
  burn: Record<string, DayBurn>;
  /** Used for days the sample has no burn for. Null when signed in: a day the watch sent no calories for has no burn. */
  restingKcal: number | null;
  notes: Record<string, TrainingNote>;
  /** The next three come from the phone app only and are not synced: left out when signed in. */
  idea?: { day: string; meal: MealKey; food: LoggedFood };
  coach?: { day: string; text: string };
  tastes?: string;
  foods: readonly FoodItem[];
}

export async function loadFuel(): Promise<Loaded<FuelData>> {
  const view = await syncView();
  if (!view) return fromSample({ ...FUEL_SAMPLE, foods: FOODS });
  return fromSynced(fuelFromItems({
    entries: view.all("fuel.entry").map((i) => i.body),
    ownFoods: view.all("fuel.food").map((i) => i.body),
    profile: view.get("fuel.profile", "me"),
    bodyRestingKcal: view.get("view.body", "me")?.restingKcal,
    days: view.all("health.day").map((i) => i.body),
    builtIn: FOODS,
  }, new Date()));
}

// MARK: Logging when signed in. Each writes `fuel.entry` items; the screen re-reads through `loadFuel`.

/** Where a food added in the dialog came from: the list (by the food's id there) or typed in. */
export type AddedFrom = { from: "list"; foodId: string } | { from: "own" };

async function signedIn() {
  const view = await syncView();
  if (!view) throw new Error(t("C-LINK is still starting. Try again in a moment."));
  return view;
}

/** Logs a food on `day`. A food typed in by weight or volume is also kept as one of the person's own foods. */
export async function addSyncedFood(day: string, meal: MealKey, food: LoggedFood, added: AddedFrom | undefined): Promise<void> {
  const view = await signedIn();
  let origin: FoodOrigin = { from: "own" };
  if (added?.from === "list") {
    const own = view.get("fuel.food", added.foodId);
    const listed = FOODS.find((f) => f.id === added.foodId);
    if (own) origin = { from: "list", item: own };
    else if (listed) origin = { from: "list", item: nativeListFood(listed) };
  }
  const made = newEntry({ id: newUuid(), itemId: newUuid(), day, meal, food, origin, now: new Date() });
  if (made.food) put("fuel.food", made.food.id, made.food);
  put("fuel.entry", made.entry.id, made.entry);
}

export async function changeSyncedAmount(id: string, amount: number): Promise<void> {
  const view = await signedIn();
  const entry = view.get("fuel.entry", id);
  const next = entry ? withAmount(entry, amount) : null;
  if (next) put("fuel.entry", id, next);
}

export async function removeSyncedFood(id: string): Promise<void> {
  await signedIn();
  remove("fuel.entry", id);
}

/** Everything eaten on `from`, logged again on `to` ("Same as yesterday", "Copy to today"). */
export async function copySyncedDay(from: string, to: string): Promise<void> {
  const view = await signedIn();
  const entries = view.all("fuel.entry").map((i) => i.body).filter((e) => typeof e?.time === "number" && entryDay(e) === from);
  for (const e of copyEntries(entries, to, new Date(), newUuid)) put("fuel.entry", e.id, e);
}

export class MealEstimateError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "MealEstimateError"; }
}

/**
 * The foods in a meal, from a sentence, a photo (base64) or both, estimated by the AI. Nothing is logged: the athlete
 * checks the grams first. Throws MealEstimateError; `not_set_up` when there is no AI to ask.
 */
export async function estimateMeal(input: { text?: string; photo?: { mime: string; data: string } }): Promise<{ foods: LoggedFood[]; note: string | null }> {
  let response: Response;
  try {
    response = await fetch("/api/ai/meal", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" },
      body: JSON.stringify({ ...input, language: language() }),
    });
  } catch {
    throw new MealEstimateError("unreachable", t("The estimate couldn't be asked for. Check the connection."));
  }
  const body = (await response.json().catch(() => null)) as { foods?: LoggedFood[]; note?: string | null; error?: { code?: string; message?: string } } | null;
  if (response.ok && Array.isArray(body?.foods)) return { foods: body.foods, note: body.note ?? null };
  throw new MealEstimateError(body?.error?.code ?? `http_${response.status}`, body?.error?.message ?? t("The meal couldn't be estimated."));
}
