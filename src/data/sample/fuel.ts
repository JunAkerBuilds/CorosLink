import type { DayBurn, DayLog, FuelData, LoggedFood, MealKey, Nutrients, Unit } from "@/data/fuel";

/** One sample dish as logged: its amount (none = one serving) and what that amount holds. */
interface Dish {
  name: string;
  unit: Unit;
  amount: number;
  /** kcal, protein, carbs, fat, fiber, sugar, saturated fat, sodium mg, cholesterol mg */
  n: [number, number, number, number, number, number, number, number, number];
}

const DISHES = {
  oats: { name: "Oats with banana", unit: "serving", amount: 1, n: [320, 10, 50, 7, 7, 9, 1, 10, 0] },
  yoghurt: { name: "Greek yoghurt", unit: "g", amount: 150, n: [140, 14, 6, 7, 0, 5, 4, 55, 20] },
  coffee: { name: "Coffee with milk", unit: "ml", amount: 250, n: [60, 3, 5, 3, 0, 5, 2, 45, 10] },
  bowl: { name: "Chicken rice bowl", unit: "serving", amount: 1, n: [620, 42, 52, 29, 5, 3, 5, 980, 150] },
  apple: { name: "Apple", unit: "serving", amount: 1, n: [95, 0, 24, 0, 4, 10, 0, 0, 0] },
  juice: { name: "Orange juice", unit: "ml", amount: 100, n: [45, 1, 9, 0, 0, 4, 0, 0, 0] },
  bar: { name: "Protein bar", unit: "serving", amount: 1, n: [180, 18, 14, 6, 3, 2, 2, 190, 10] },
  toast: { name: "Toast with eggs", unit: "serving", amount: 1, n: [430, 24, 34, 22, 5, 4, 6, 620, 372] },
  pasta: { name: "Pasta bolognese", unit: "serving", amount: 1, n: [750, 38, 88, 26, 7, 11, 9, 890, 85] },
  banana: { name: "Banana", unit: "serving", amount: 1, n: [105, 1, 27, 0, 3, 14, 0, 1, 0] },
  sandwich: { name: "Tuna sandwich", unit: "serving", amount: 1, n: [530, 34, 52, 20, 6, 6, 4, 940, 55] },
  salmon: { name: "Salmon, potatoes and greens", unit: "serving", amount: 1, n: [720, 45, 58, 33, 8, 6, 6.5, 480, 130] },
  pudding: { name: "Rice pudding", unit: "serving", amount: 1, n: [215, 6, 36, 5, 0, 18, 3, 90, 15] },
  shake: { name: "Recovery shake", unit: "ml", amount: 330, n: [250, 20, 36, 3, 1, 30, 2, 210, 15] },
  nuts: { name: "Mixed nuts", unit: "g", amount: 30, n: [180, 6, 6, 16, 2, 1, 2, 2, 0] },
  chocolate: { name: "Dark chocolate", unit: "g", amount: 20, n: [110, 2, 9, 8, 2, 5, 5, 4, 1] },
  soup: { name: "Lentil soup with bread", unit: "serving", amount: 1, n: [480, 24, 74, 9, 15, 8, 2, 860, 0] },
  stirfry: { name: "Chicken stir-fry with rice", unit: "serving", amount: 1, n: [690, 44, 82, 19, 6, 12, 3.5, 1040, 110] },
  salad: { name: "Side salad", unit: "serving", amount: 1, n: [150, 3, 9, 12, 3, 5, 2, 210, 5] },
} satisfies Record<string, Dish>;

type DishKey = keyof typeof DISHES;

function logged(day: string, meal: MealKey, index: number, key: DishKey, times = 1): LoggedFood {
  const d: Dish = DISHES[key];
  const basis = d.unit === "serving" ? 1 : 100;
  const [kcal, protein, carbs, fat, fiber, sugar, satFat, sodium, cholesterol] = d.n.map((v) => (v * basis) / d.amount);
  const per: Nutrients = { kcal, protein, carbs, fat, fiber, sugar, satFat, sodium, cholesterol };
  return { id: `sample-${day}-${meal}-${index}`, name: d.name, unit: d.unit, amount: d.amount * times, per };
}

type Plate = DishKey | [DishKey, number];

function dayLog(day: string, breakfast: Plate[], lunch: Plate[], dinner: Plate[], snack: Plate[]): DayLog {
  const meal = (key: MealKey, plates: Plate[]) =>
    plates.map((p, i) => (Array.isArray(p) ? logged(day, key, i, p[0], p[1]) : logged(day, key, i, p)));
  return { day, meals: { breakfast: meal("breakfast", breakfast), lunch: meal("lunch", lunch), dinner: meal("dinner", dinner), snack: meal("snack", snack) } };
}

const SAMPLE_DAY = "2026-11-19";

/** The week on the "Eaten and burned" chart: 2,380 · 2,510 · 2,290 · 2,620 · 2,440 · 2,350 · 1,460 kcal eaten. */
const LOGS: DayLog[] = [
  dayLog("2026-11-13", ["toast", "coffee"], ["bowl", "apple"], ["pasta"], ["banana", "bar", "yoghurt"]),
  dayLog("2026-11-14", ["oats", ["juice", 2]], ["sandwich", "apple"], ["salmon", "pudding"], ["shake", "nuts", "chocolate"]),
  dayLog("2026-11-15", ["toast", "coffee"], ["soup", "yoghurt"], ["stirfry"], ["bar", "banana", "apple", "chocolate"]),
  dayLog("2026-11-16", ["oats", "yoghurt", "coffee"], ["bowl", "juice"], ["pasta", "salad"], ["shake", "nuts", "banana"]),
  dayLog("2026-11-17", ["toast", ["juice", 2]], ["sandwich", "apple"], ["salmon", "salad"], ["bar", "yoghurt", "banana"]),
  dayLog("2026-11-18", ["oats", "coffee"], ["soup", "apple"], ["stirfry", "pudding"], ["shake", "nuts", "coffee"]),
  dayLog(SAMPLE_DAY, ["oats", "yoghurt", "coffee"], ["bowl", "apple", "juice"], [], ["bar"]),
];

const RESTING = 1720;
const BURNED: [string, number][] = [
  ["2026-11-13", 2480], ["2026-11-14", 2390], ["2026-11-15", 2610], ["2026-11-16", 2420],
  ["2026-11-17", 2890], ["2026-11-18", 2300], [SAMPLE_DAY, 2140],
];

export const FUEL_SAMPLE: Omit<FuelData, "foods"> = {
  sampleDay: SAMPLE_DAY,
  targets: { kcal: 2450, protein: 150, carbs: 320, fat: 75, fiber: 34, sugar: 60, satFat: 24, sodium: 2300, cholesterol: 300 },
  logs: Object.fromEntries(LOGS.map((l) => [l.day, l])),
  burn: Object.fromEntries(BURNED.map(([day, total]): [string, DayBurn] => [day, { resting: RESTING, active: total - RESTING }])),
  restingKcal: RESTING,
  notes: { [SAMPLE_DAY]: { title: "Tempo run today", detail: "Carbs up to 6.0 g per kg" } },
  idea: { day: SAMPLE_DAY, meal: "dinner", food: logged(SAMPLE_DAY, "dinner", 0, "salmon") },
  coach: {
    day: SAMPLE_DAY,
    text: "You're 160 g short on carbs with Saturday's long run two days out. A carb-heavy dinner tonight keeps tomorrow easy.",
  },
  tastes: "No pork · likes spicy",
};
