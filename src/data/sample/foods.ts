import type { FoodItem, Nutrients } from "@/data/fuel";

/** kcal, protein, carbs, fat, fiber, sugar, saturated fat (g), sodium, cholesterol (mg): per 100 g or 100 ml. */
type Row = [name: string, liquid: 0 | 1, kcal: number, protein: number, carbs: number, fat: number, fiber: number, sugar: number, satFat: number, sodium: number, cholesterol: number];

/** Common foods with typical label values, rounded as food tables print them. */
const ROWS: Row[] = [
  ["Oats, dry", 0, 379, 13.2, 67.7, 6.5, 10.1, 1, 1.1, 6, 0],
  ["Banana", 0, 89, 1.1, 22.8, 0.3, 2.6, 12.2, 0.1, 1, 0],
  ["Apple", 0, 52, 0.3, 13.8, 0.2, 2.4, 10.4, 0, 1, 0],
  ["Orange", 0, 47, 0.9, 11.8, 0.1, 2.4, 9.4, 0, 0, 0],
  ["Blueberries", 0, 57, 0.7, 14.5, 0.3, 2.4, 10, 0, 1, 0],
  ["Greek yoghurt, plain", 0, 97, 9, 3.9, 5, 0, 3.9, 3.2, 36, 13],
  ["Skyr, plain", 0, 63, 11, 4, 0.2, 0, 4, 0.1, 40, 5],
  ["Milk, semi-skimmed", 1, 50, 3.4, 4.8, 1.8, 0, 4.8, 1.1, 44, 8],
  ["Oat drink", 1, 46, 1, 6.7, 1.5, 0.8, 4, 0.2, 40, 0],
  ["Orange juice", 1, 45, 0.7, 10.4, 0.2, 0.2, 8.4, 0, 1, 0],
  ["Coffee, black", 1, 1, 0.1, 0, 0, 0, 0, 0, 2, 0],
  ["Sports drink", 1, 25, 0, 6.4, 0, 0, 5.3, 0, 41, 0],
  ["Cola", 1, 42, 0, 10.6, 0, 0, 10.6, 0, 4, 0],
  ["Egg, whole", 0, 143, 12.6, 0.7, 9.5, 0, 0.4, 3.1, 142, 372],
  ["Wholemeal bread", 0, 247, 13, 41, 3.4, 7, 6, 0.7, 450, 0],
  ["White bread", 0, 265, 9, 49, 3.2, 2.7, 5, 0.7, 490, 0],
  ["Butter", 0, 717, 0.9, 0.1, 81, 0, 0.1, 51, 643, 215],
  ["Peanut butter", 0, 588, 25, 20, 50, 6, 9, 10, 430, 0],
  ["Honey", 0, 304, 0.3, 82, 0, 0.2, 82, 0, 4, 0],
  ["Rice, cooked", 0, 130, 2.7, 28, 0.3, 0.4, 0.1, 0.1, 1, 0],
  ["Pasta, cooked", 0, 158, 5.8, 31, 0.9, 1.8, 0.6, 0.2, 1, 0],
  ["Potatoes, boiled", 0, 87, 1.9, 20, 0.1, 1.8, 0.9, 0, 5, 0],
  ["Sweet potato, baked", 0, 90, 2, 21, 0.2, 3.3, 6.5, 0, 36, 0],
  ["Quinoa, cooked", 0, 120, 4.4, 21.3, 1.9, 2.8, 0.9, 0.2, 7, 0],
  ["Chicken breast, cooked", 0, 165, 31, 0, 3.6, 0, 0, 1, 74, 85],
  ["Salmon, baked", 0, 206, 22, 0, 12.4, 0, 0, 2.5, 61, 63],
  ["Tuna, canned in water", 0, 116, 26, 0, 0.8, 0, 0, 0.2, 247, 42],
  ["Beef mince, cooked, 10% fat", 0, 217, 26, 0, 12, 0, 0, 4.7, 72, 85],
  ["Tofu, firm", 0, 144, 17, 3, 8.7, 2.3, 0.6, 1.3, 14, 0],
  ["Lentils, cooked", 0, 116, 9, 20, 0.4, 7.9, 1.8, 0.1, 2, 0],
  ["Chickpeas, cooked", 0, 164, 8.9, 27.4, 2.6, 7.6, 4.8, 0.3, 7, 0],
  ["Broccoli, cooked", 0, 35, 2.4, 7.2, 0.4, 3.3, 1.4, 0.1, 41, 0],
  ["Spinach, raw", 0, 23, 2.9, 3.6, 0.4, 2.2, 0.4, 0.1, 79, 0],
  ["Tomato", 0, 18, 0.9, 3.9, 0.2, 1.2, 2.6, 0, 5, 0],
  ["Avocado", 0, 160, 2, 8.5, 14.7, 6.7, 0.7, 2.1, 7, 0],
  ["Olive oil", 1, 884, 0, 0, 100, 0, 0, 13.8, 2, 0],
  ["Cheddar", 0, 403, 25, 1.3, 33, 0, 0.5, 21, 621, 105],
  ["Almonds", 0, 579, 21, 22, 50, 12.5, 4.4, 3.8, 1, 0],
  ["Mixed nuts", 0, 607, 20, 21, 54, 7, 4.3, 7.5, 5, 0],
  ["Dark chocolate, 70%", 0, 598, 7.8, 46, 43, 11, 24, 24, 20, 3],
  ["Protein bar", 0, 360, 36, 28, 12, 6, 4, 4, 380, 20],
  ["Energy gel", 0, 250, 0, 62, 0, 0, 25, 0, 125, 0],
  ["Salmon, potatoes and greens", 0, 144, 9, 11.6, 6.6, 1.6, 1.2, 1.3, 96, 26],
];

const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const FOODS: readonly FoodItem[] = ROWS.map(([name, liquid, kcal, protein, carbs, fat, fiber, sugar, satFat, sodium, cholesterol]) => {
  const per100: Nutrients = { kcal, protein, carbs, fat, fiber, sugar, satFat, sodium, cholesterol };
  return { id: id(name), name, liquid: liquid === 1, per100 };
});
