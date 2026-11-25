// A meal estimated from a sentence or a photo: the foods in it with a weight and their nutrients, for the athlete to
// check before anything is logged (portion size is where estimates go wrong). The instructions, the JSON asked for
// and its reading are the phones' (CorosKit MealEstimate.swift). Pure.
import type { LoggedFood, Nutrients } from "@/data/fuel";

/** What the AI is told about the job. `language` is the language food names come back in ("en-GB"). */
export const mealInstructions = (language: string): string =>
  "You estimate the food in a meal for an athlete's food log. List each food you can identify, with a realistic weight in grams for the portion " +
  "shown or described, and its energy (kcal), protein, carbohydrate, fat, fibre, total sugars and saturated fat in grams and its sodium and " +
  "cholesterol in milligrams for that weight. Count only what is visible or described; don't guess at hidden sauces or sides, and say so in the " +
  `note if it matters. Name foods plainly, in the language ${language}. If there is no food, return no items.`;

export function mealPrompt(text: string, hasPhoto: boolean): string {
  return [
    hasPhoto ? "The meal is in the attached photo." : "",
    text ? `The athlete describes it as: ${text}` : "",
    "",
    "Answer with only this JSON, no other text:",
    '{"items":[{"name":"…","grams":0,"kcal":0,"proteinG":0,"carbsG":0,"fatG":0,"fiberG":0,"sugarG":0,"saturatedFatG":0,"sodiumMg":0,"cholesterolMg":0}],"note":null}',
  ].filter((l, i) => l || i > 1).join("\n");
}

export interface MealEstimate { foods: LoggedFood[]; note: string | null }

/** "nan", "inf" or an absurd size count as missing. */
function number(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = typeof row[key] === "number" ? (row[key] as number) : typeof row[key] === "string" ? Number(row[key]) : NaN;
    if (Number.isFinite(v) && Math.abs(v) < 1_000_000) return v;
  }
  return null;
}

/**
 * The estimate in a reply that should be JSON but may come wrapped in prose or a code fence, as foods logged in
 * grams (nutrients per 100 g, so changing the grams scales them). Items without a name or with negative numbers are
 * dropped. Null when there is no estimate in it at all.
 */
export function parseMeal(reply: string, newId: () => string): MealEstimate | null {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let object: unknown;
  try { object = JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
  const rows = (object as { items?: unknown })?.items;
  if (!Array.isArray(rows)) return null;
  const foods: LoggedFood[] = [];
  for (const raw of rows.slice(0, 30)) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 80) : "";
    const kcal = number(row, "kcal", "calories");
    const grams = number(row, "grams", "g") ?? 100;
    const protein = number(row, "proteinG", "protein") ?? 0, carbs = number(row, "carbsG", "carbs") ?? 0, fat = number(row, "fatG", "fat") ?? 0;
    if (!name || kcal === null || kcal < 0 || grams <= 0 || protein < 0 || carbs < 0 || fat < 0) continue;
    const total: Nutrients = {
      kcal, protein, carbs, fat,
      fiber: Math.max(0, number(row, "fiberG", "fiber", "fibre") ?? 0),
      sugar: Math.max(0, number(row, "sugarG", "sugar", "sugars") ?? 0),
      satFat: Math.max(0, number(row, "saturatedFatG", "saturatedFat") ?? 0),
      sodium: Math.max(0, number(row, "sodiumMg", "sodium") ?? 0),
      cholesterol: Math.max(0, number(row, "cholesterolMg", "cholesterol") ?? 0),
    };
    const per = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, (v * 100) / grams])) as unknown as Nutrients;
    foods.push({ id: newId(), name, unit: "g", amount: Math.round(grams), per });
  }
  const note = (object as { note?: unknown }).note;
  return { foods, note: typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : null };
}
