// The sample athlete: what a phone would have uploaded for one athlete, generated around `now`, in the exact
// bodies of docs/sync-contract.md (dates as seconds since 2001, uppercase UUIDs, CalendarDay objects).
// Used by sample mode (desktop/main/devMode.ts, `npm run dev:sample`) and as the fixture for the mappers' tests.
// Self-contained on purpose (type imports only).
import type {
  BodyAlertBody, BodyIllnessBody,
  ActivityDetailBody, CalendarDay, EnergyDayBody, NativeActivity, NativeDayVitals, NativeFoodEntry, NativeFoodItem, NativeGymEntry,
  NativeGymRoutine, NativeGymWorkout, NativeMeal, NativeNutrition, NativeSleepNight, NativeSleepSpan, NativeSport, SyncBodies,
} from "./sync/native";

export interface SeedItem<C extends keyof SyncBodies = keyof SyncBodies> { collection: C; id: string; body: SyncBodies[C] }

const REF = 978_307_200;
const ref = (d: Date) => d.getTime() / 1000 - REF;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Repeatable noise, so the same day always seeds the same athlete. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(rnd: () => number): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(rnd() * 4)]}${hex(3)}-${hex(12)}`.toUpperCase();
}

const calDay = (d: Date): CalendarDay => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const EXERCISES: Record<string, string> = {
  "bench-press-barbell": "Bench press", "squat-barbell": "Squat", "deadlift-barbell": "Deadlift", "overhead-press-barbell": "Overhead press",
  "bent-over-row-barbell": "Barbell row", "pull-up": "Pull-up", "romanian-deadlift-barbell": "Romanian deadlift", "leg-press": "Leg press",
  "curl-dumbbell": "Dumbbell curl", "triceps-pushdown": "Triceps pushdown", "plank": "Plank", "calf-raise-standing": "Calf raise",
};

/** Everything, for the athlete as of `now` (local time). */
export function seedItems(now: Date = new Date()): SeedItem[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rnd = prng(today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate());
  const back = (days: number, h = 0, m = 0, s = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - days, h, m, s);
  const out: SeedItem[] = [];
  const add = <C extends keyof SyncBodies>(collection: C, id: string, body: SyncBodies[C]) => { out.push({ collection, id, body } as SeedItem); };

  /* Activities: nine weeks of a runner who also rides, lifts, swims and hikes. */
  type Plan = [dow: number, hour: number, minute: number, name: string, sport: NativeSport, code: number, km: number, paceOrKmh: number, hr: number];
  const WEEK: Plan[] = [
    [1, 18, 10, "Easy run", "run", 100, 6.1, 332, 138],
    [2, 12, 30, "Strength", "strength", 402, 0, 0, 112],
    [3, 7, 42, "Morning tempo", "run", 100, 8.02, 286, 158],
    [4, 17, 5, "Recovery ride", "bike", 200, 24.6, 25.4, 121],
    [5, 12, 15, "Strength", "strength", 402, 0, 0, 114],
    [6, 8, 15, "Long run", "run", 100, 18.04, 320, 149],
  ];
  const EXTRA: Plan[] = [
    [5, 10, 0, "Pool swim", "poolSwim", 300, 1.5, 125, 128],
    [0, 9, 20, "Ridge hike", "hike", 104, 11.3, 840, 118],
    [5, 18, 30, "Trail run", "trailRun", 102, 9.4, 371, 151],
    [4, 6, 50, "Treadmill", "indoorRun", 101, 5.0, 318, 141],
  ];
  const activities: NativeActivity[] = [];
  for (let d = 0; d < 63; d++) {
    const date = back(d);
    const week = Math.floor(d / 7);
    const plans = WEEK.filter((p) => p[0] === date.getDay());
    const extra = EXTRA[week % EXTRA.length];
    if (extra[0] === date.getDay() && week % 2 === 0) plans.push(extra);
    for (const [, hour, minute, name, sport, code, km, pace, hr] of plans) {
      const start = back(d, hour, minute, Math.floor(rnd() * 60));
      if (start.getTime() > now.getTime()) continue;
      const wobble = 1 + (rnd() - 0.5) * 0.06;
      const distance = km > 0 ? Math.round(km * 1000 * (1 + (rnd() - 0.5) * 0.08)) : undefined;
      const duration = sport === "strength" ? 2600 + rnd() * 500
        : sport === "bike" ? (distance! / 1000 / (pace * wobble)) * 3600
        : sport === "poolSwim" ? (distance! / 100) * pace * wobble
        : (distance! / 1000) * pace * wobble;
      const a: NativeActivity = {
        id: String(476_000_000_000_000 + Math.floor(start.getTime() / 1000)), name, sport, sportCode: code, start: ref(start),
        durationSeconds: r2(duration), averageHR: Math.round(hr + (rnd() - 0.5) * 6), maxHR: Math.round(hr + 13 + rnd() * 8),
        calories: Math.round((duration / 60) * (sport === "strength" ? 6.2 : sport === "hike" ? 7.5 : 11.4)),
        trainingLoad: Math.round((duration / 60) * (hr > 150 ? 2.5 : hr > 135 ? 1.6 : 0.95)),
      };
      if (distance != null) a.distanceMeters = distance;
      if (sport === "run" || sport === "trailRun" || sport === "hike" || sport === "bike") a.elevationGain = Math.round((distance! / 1000) * (sport === "hike" ? 62 : sport === "trailRun" ? 34 : sport === "bike" ? 6 : 8) * (0.7 + rnd() * 0.6));
      if (sport === "run" || sport === "trailRun" || sport === "indoorRun") { a.averageCadence = Math.round(166 + (340 - pace) * 0.12 + rnd() * 3); a.averagePower = Math.round(250 + (330 - pace) * 1.1); }
      if (sport === "bike") { a.averageCadence = Math.round(80 + rnd() * 6); a.averagePower = Math.round(150 + rnd() * 30); }
      activities.push(a);
    }
  }
  activities.sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  for (const a of activities) add("activity", a.id, a);

  const latestRun = activities.find((a) => a.sport === "run" && a.name === "Morning tempo") ?? activities.find((a) => a.sport === "run");
  const latestRide = activities.find((a) => a.sport === "bike");
  if (latestRun) add("activity.detail", latestRun.id, runDetail(latestRun, rnd));
  if (latestRide) add("activity.detail", latestRide.id, rideDetail(latestRide, rnd));
  // What a phone sends for a pool swim or a gym session: heart rate over time, and nothing else.
  for (const sport of ["poolSwim", "strength"] as const) {
    const latest = activities.find((x) => x.sport === sport);
    if (latest) add("activity.detail", latest.id, heartDetail(latest));
  }
  // The newest activity always has its recording, whichever it is, so the dashboard's Latest activity is never bare.
  // Its own random numbers, so the rest of the athlete stays the same.
  const newest = activities[0];
  if (newest && !out.some((x) => x.collection === "activity.detail" && x.id === newest.id)) {
    const own = prng(Number(newest.id.slice(-6)));
    const outdoors = newest.distanceMeters != null && (newest.sport === "run" || newest.sport === "trailRun" || newest.sport === "hike");
    add("activity.detail", newest.id, outdoors ? runDetail(newest, own) : newest.sport === "bike" ? rideDetail(newest, own) : heartDetail(newest));
  }

  /* Health: 60 days of readings and nights. The watch's own stage order for the last two weeks. */
  const loadByDay = new Map<string, { load: number; minutes: number }>();
  for (const a of activities) {
    const k = key(new Date(((a.start ?? 0) + REF) * 1000));
    const at = loadByDay.get(k) ?? { load: 0, minutes: 0 };
    loadByDay.set(k, { load: at.load + (a.trainingLoad ?? 0), minutes: at.minutes + (a.durationSeconds ?? 0) / 60 });
  }
  let acute = 78, chronic = 72;
  const vitals: NativeDayVitals[] = [];
  for (let d = 59; d >= 0; d--) {
    const date = back(d), k = key(date), trained = loadByDay.get(k);
    acute += ((trained?.load ?? 0) - acute) / 7;
    chronic += ((trained?.load ?? 0) - chronic) / 42;
    const partial = d === 0 ? (now.getHours() * 60 + now.getMinutes()) / 1440 : 1;
    const sleepMinutes = Math.round(432 + (rnd() - 0.5) * 110);
    const score = Math.max(52, Math.min(96, Math.round(62 + (sleepMinutes - 380) * 0.2 + (rnd() - 0.5) * 12)));
    const night = nightOf(date, sleepMinutes, score, d < 14, rnd);
    add("health.night", k, night);
    const v: NativeDayVitals = {
      day: calDay(date), steps: Math.round((6200 + rnd() * 6400 + (trained ? 3800 : 0)) * partial),
      calories: Math.round((1680 + (trained ? trained.minutes * 10.5 : 0) + rnd() * 320) * Math.max(partial, 0.3)),
      restingHR: Math.round(49 + (rnd() - 0.5) * 4 - (59 - d) * 0.015), averageHR: Math.round(63 + rnd() * 8),
      hrv: Math.round(57 + (59 - d) * 0.07 + (rnd() - 0.5) * 12), sleepMinutes: night.totalMinutes, sleepScore: night.score,
      stress: Math.round(30 + (rnd() - 0.5) * 16), exerciseMinutes: Math.round(trained?.minutes ?? rnd() * 12),
      acuteLoad: r1(acute * 7), chronicLoad: r1(chronic * 7), loadRatio: r2(acute / Math.max(chronic, 1)), loadComment: "Optimized",
    };
    if (trained) v.trainingLoad = Math.round(trained.load);
    vitals.push(v);
    add("health.day", k, v);
  }

  /* Body Alert: what the phone works out from the nights, the last two above the usual. Its own random numbers. */
  {
    let seed = 7;
    const own = () => { const v = Math.sin(++seed * 127.1) * 43758.5453; return v - Math.floor(v); };
    const nights: BodyAlertBody["nights"] = [];
    for (let d = 27; d >= 0; d--) {
      const date = back(d), off = d <= 1;
      const hr = off ? 57.1 + (1 - d) * 0.4 : 54 + (own() - 0.5) * 1.8, zHr = (hr - 54.2) / 1.1;
      const lnHrv = Math.log(off ? 66 : 70 + (own() - 0.5) * 10), br = off ? 15.3 : 14.6 + (own() - 0.5) * 0.5;
      const nightClass = off ? (d === 0 ? "strong" : "deviating") : zHr > 1 ? "deviating" : "normal";
      nights.push({
        day: calDay(date), state: d === 0 ? "strain" : d === 1 ? "watch" : "normal", nightClass,
        level: Math.round((nightClass === "strong" ? 4.4 : nightClass === "deviating" ? 2.8 : Math.max(0.3, 1 + zHr * 0.5)) * 100) / 100,
        signals: [
          { signal: "heart", channel: "sleepHR", value: hr, usual: 54.2, spread: 1.1, z: zHr },
          { signal: "hrv", channel: "lnRMSSD", value: lnHrv, usual: Math.log(70), spread: 0.09, z: (Math.log(70) - lnHrv) / 0.09 },
          { signal: "breathing", channel: "breathing", value: br, usual: 14.6, spread: 0.4, z: (br - 14.6) / 0.4 },
        ],
      });
    }
    add("body.alert", "me", { on: true, state: "strain", nightsLearned: 14, updatedAt: ref(now), nights } satisfies BodyAlertBody);
    add("body.illness", "me", { spells: [] } satisfies BodyIllnessBody);
  }

  /* Energy: two weeks, the last one still running. */
  for (let d = 13; d >= 0; d--) add("energy.day", key(back(d)), energyDay(back(d), d === 0 ? now : null, activities, rnd));

  /* Fuel: a profile, two own foods and a week of meals. */
  add("fuel.profile", "me", { weightKg: 72.4, heightCm: 178, age: 39, sex: "male", goal: "lose", usesWeighIns: false });
  const n = (kcal: number, proteinG: number, carbsG: number, fatG: number, fiberG = 0, sugarG = 0, saturatedFatG = 0, sodiumMg = 0, cholesterolMg = 0): NativeNutrition =>
    ({ kcal, proteinG, carbsG, fatG, fiberG, sugarG, saturatedFatG, sodiumMg, cholesterolMg });
  const granola: NativeFoodItem = { id: `custom:${uuid(rnd)}`, name: "Home granola", per100g: n(452, 11.5, 58, 18.2, 8.1, 16.4, 3.2, 12, 0), servings: [{ label: "bowl", grams: 60 }] };
  const shake: NativeFoodItem = { id: `custom:${uuid(rnd)}`, name: "Recovery shake", brand: "Kitchen", per100g: n(76, 6.1, 10.9, 0.9, 0.3, 9.1, 0.6, 64, 5), servings: [{ label: "bottle", grams: 330 }], liquid: true };
  add("fuel.food", granola.id, granola);
  add("fuel.food", shake.id, shake);
  const FOODS: Record<string, NativeFoodItem> = {
    oats: { id: "usda:173904", name: "Oats, dry", per100g: n(379, 13.2, 67.7, 6.5, 10.1, 1, 1.1, 6, 0), servings: [{ label: "1 cup", grams: 81 }] },
    banana: { id: "usda:173944", name: "Banana", per100g: n(89, 1.1, 22.8, 0.3, 2.6, 12.2, 0.1, 1, 0), servings: [{ label: "1 medium", grams: 118 }] },
    yoghurt: { id: "off:5201054017432", name: "Greek yoghurt, plain", brand: "Fage", barcode: "5201054017432", per100g: n(97, 9, 3.9, 5, 0, 3.9, 3.2, 36, 13), servings: [{ label: "1 pot", grams: 150 }] },
    milk: { id: "usda:746778", name: "Milk, semi-skimmed", per100g: n(50, 3.4, 4.8, 1.8, 0, 4.8, 1.1, 44, 8), servings: [{ label: "1 glass", grams: 250 }], liquid: true },
    rice: { id: "usda:168878", name: "Rice, cooked", per100g: n(130, 2.7, 28, 0.3, 0.4, 0.1, 0.1, 1, 0), servings: [{ label: "1 cup", grams: 158 }] },
    chicken: { id: "usda:171077", name: "Chicken breast, cooked", per100g: n(165, 31, 0, 3.6, 0, 0, 1, 74, 85), servings: [{ label: "1 breast", grams: 172 }] },
    salmon: { id: "usda:175168", name: "Salmon, baked", per100g: n(206, 22.1, 0, 12.4, 0, 0, 2.4, 61, 63), servings: [{ label: "1 fillet", grams: 154 }] },
    pasta: { id: "usda:168928", name: "Pasta, cooked", per100g: n(158, 5.8, 31, 0.9, 1.8, 0.6, 0.2, 1, 0), servings: [{ label: "1 cup", grams: 140 }] },
    apple: { id: "usda:171688", name: "Apple", per100g: n(52, 0.3, 13.8, 0.2, 2.4, 10.4, 0, 1, 0), servings: [{ label: "1 medium", grams: 182 }] },
    bread: { id: "usda:172688", name: "Wholemeal bread", per100g: n(247, 13, 41, 3.4, 7, 6, 0.7, 450, 0), servings: [{ label: "1 slice", grams: 32 }] },
    eggs: { id: "usda:171287", name: "Egg, whole", per100g: n(143, 12.6, 0.7, 9.5, 0, 0.4, 3.1, 142, 372), servings: [{ label: "1 large", grams: 50 }] },
    quick: { id: `quick:${uuid(rnd)}`, name: "Cafe lunch", per100g: n(640, 28, 71, 26, 6, 9, 8, 1100, 70), servings: [{ label: "", grams: 100 }] },
    granola, shake,
  };
  type Plate = [meal: NativeMeal, hour: number, food: keyof typeof FOODS, grams: number];
  const DAYS: Plate[][] = [
    [["breakfast", 7, "oats", 80], ["breakfast", 7, "banana", 118], ["breakfast", 7, "milk", 250], ["lunch", 12, "chicken", 170], ["lunch", 12, "rice", 240], ["dinner", 19, "salmon", 160], ["dinner", 19, "pasta", 220], ["snack", 15, "yoghurt", 150], ["snack", 16, "apple", 182]],
    [["breakfast", 8, "granola", 60], ["breakfast", 8, "yoghurt", 150], ["lunch", 13, "quick", 100], ["dinner", 19, "chicken", 200], ["dinner", 19, "pasta", 280], ["snack", 10, "shake", 330], ["snack", 21, "banana", 118]],
    [["breakfast", 7, "eggs", 150], ["breakfast", 7, "bread", 64], ["lunch", 12, "salmon", 154], ["lunch", 12, "rice", 200], ["dinner", 20, "pasta", 320], ["dinner", 20, "chicken", 120], ["snack", 16, "apple", 182], ["snack", 16, "milk", 300]],
  ];
  for (let d = 6; d >= 0; d--) {
    const plates = DAYS[d % DAYS.length].filter(([, hour]) => d > 0 || hour <= now.getHours());
    plates.forEach(([meal, hour, food, grams], i) => {
      const item = FOODS[food];
      const entry: NativeFoodEntry = {
        id: uuid(rnd), time: ref(back(d, hour, 5 + i * 3)), meal, item, grams,
        source: item.id.startsWith("off:") ? "barcode" : item.id.startsWith("usda:") ? "search" : "manual", version: 1,
      };
      add("fuel.entry", entry.id, entry);
    });
  }

  /* Gym: three routines and twelve finished workouts, weights creeping up. */
  const set = (kg: number | undefined, reps: number | undefined, doneAt?: Date, extra: { rpe?: number } = {}) =>
    ({ id: uuid(rnd), kind: "normal" as const, ...(kg != null ? { weightKg: kg } : {}), ...(reps != null ? { reps } : {}), ...(doneAt ? { doneAt: ref(doneAt) } : {}), ...extra });
  type Line = [exercise: string, kg: number, reps: number, sets: number];
  const ROUTINES: { name: string; folder?: string; lines: Line[] }[] = [
    { name: "Upper body", folder: "Strength block", lines: [["bench-press-barbell", 72.5, 5, 4], ["bent-over-row-barbell", 65, 8, 4], ["overhead-press-barbell", 47.5, 5, 3], ["pull-up", 10, 6, 3], ["curl-dumbbell", 14, 10, 3], ["triceps-pushdown", 27.5, 12, 3]] },
    { name: "Lower body", folder: "Strength block", lines: [["squat-barbell", 95, 5, 4], ["romanian-deadlift-barbell", 85, 8, 3], ["leg-press", 170, 10, 3], ["calf-raise-standing", 60, 12, 3], ["plank", 0, 0, 3]] },
    { name: "Deadlift day", lines: [["deadlift-barbell", 122.5, 3, 4], ["bent-over-row-barbell", 62.5, 8, 3], ["pull-up", 7.5, 6, 3], ["plank", 0, 0, 2]] },
  ];
  const routines: NativeGymRoutine[] = ROUTINES.map((r) => ({
    id: uuid(rnd), name: r.name, ...(r.folder ? { folder: r.folder } : {}), note: "", updated: ref(back(40, 9)),
    entries: r.lines.map(([exerciseID, kg, reps, sets]): NativeGymEntry => ({
      id: uuid(rnd), exerciseID, note: "", restSeconds: 120,
      sets: Array.from({ length: sets }, () => (exerciseID === "plank" ? { id: uuid(rnd), kind: "normal" as const, seconds: 60 } : set(kg, reps))),
    })),
  }));
  for (const r of routines) add("gym.routine", r.id, r);
  const strengthDays = activities.filter((a) => a.sport === "strength").slice(0, 12).reverse();
  strengthDays.forEach((a, i) => {
    const which = i % 4 === 3 ? 2 : i % 2;
    const r = ROUTINES[which], routine = routines[which];
    const start = new Date(((a.start ?? 0) + REF) * 1000);
    let at = start.getTime() + 4 * 60_000;
    const step = Math.floor(i / 2) * 2.5;
    const w: NativeGymWorkout = {
      id: uuid(rnd), name: r.name, start: ref(start), end: ref(new Date(start.getTime() + (a.durationSeconds ?? 2700) * 1000)), note: "",
      routineID: routine.id, suggested: false,
      entries: r.lines.map(([exerciseID, kg, reps, sets]): NativeGymEntry => {
        const weight = exerciseID === "pull-up" || kg === 0 ? kg : kg + (kg >= 90 ? step : step / 2 - ((step / 2) % 2.5));
        const done = () => new Date((at += 150_000 + Math.floor(rnd() * 40_000)));
        const list = exerciseID === "plank"
          ? Array.from({ length: sets }, () => ({ id: uuid(rnd), kind: "normal" as const, seconds: 60, doneAt: ref(done()) }))
          : [
            { ...set(Math.round(weight * 0.5 / 2.5) * 2.5, 8, done()), kind: "warmUp" as const },
            ...Array.from({ length: sets }, (_, k) => set(weight, k === sets - 1 ? reps + (i % 3 === 0 ? 1 : 0) : reps, done(), k === sets - 1 ? { rpe: 8.5 } : {})),
          ];
        return { id: uuid(rnd), exerciseID, note: "", restSeconds: 120, sets: list };
      }),
    };
    add("gym.workout", w.id, w);
  });
  add("gym.meta", "me", { folders: ["Strength block"], customExercises: [] });
  add("gym.planned", uuid(rnd), { id: "", routineID: routines[0].id, day: calDay(back(-1)) });
  add("gym.planned", uuid(rnd), { id: "", routineID: routines[1].id, day: calDay(back(-4)) });
  // Nothing done yet today (an early start): today has a session on the calendar instead.
  if (!activities.some((a) => key(new Date(((a.start ?? 0) + REF) * 1000)) === key(today))) {
    add("gym.planned", uuid(prng(today.getTime() / 1000)), { id: "", routineID: routines[2].id, day: calDay(today) });
  }
  for (const item of out) if (item.collection === "gym.planned") (item.body as { id: string }).id = item.id;

  /* Watch. */
  const todayVitals = vitals[vitals.length - 1];
  const battery: { at: number; percent: number }[] = [];
  let level = 100;
  for (let d = 20; d >= 0; d--) {
    level -= loadByDay.has(key(back(d))) ? 5 + Math.floor(rnd() * 4) : 2 + Math.floor(rnd() * 2);
    if (level < 22) level = 100;
    battery.push({ at: ref(back(d, 6, 58)), percent: level });
  }
  add("watch.state", "me", {
    name: "COROS PACE Pro", model: "PACE Pro", firmware: "3.2108.0", syncedAt: ref(new Date(now.getTime() - 42 * 60_000)),
    battery: { percent: level, readAt: ref(new Date(now.getTime() - 42 * 60_000)) },
    storage: { usedBytes: 11_200_000_000, totalBytes: 32_000_000_000 },
    goals: { calories: 600, exerciseMinutes: 45, steps: 10000 },
    today: { calories: Math.max(0, (todayVitals.calories ?? 0) - 1200), exerciseMinutes: todayVitals.exerciseMinutes ?? 0, steps: todayVitals.steps ?? 0 },
    alarms: [{ slot: 0, enabled: true, hour: 6, minute: 15, days: [1, 2, 3, 4, 5] }, { slot: 1, enabled: false, hour: 8, minute: 0, days: [6] }],
    alarmsReadAt: ref(new Date(now.getTime() - 42 * 60_000)), gpsMode: "all", gpsModes: ["standard", "all", "dual"], batteryHistory: battery,
  });

  /* Views the phone computes. */
  const fitness: number[] = [], fatigue: number[] = [];
  let fit = 41, fat = 38;
  for (let d = 181; d >= 0; d--) {
    const load = loadByDay.get(key(back(d)))?.load ?? (d > 62 ? [0, 70, 55, 0, 95, 0, 120][back(d).getDay()] * (0.7 + rnd() * 0.4) : 0);
    fit += (load - fit) / 42;
    fat += (load - fat) / 7;
    fitness.push(r1(fit));
    fatigue.push(r1(fat));
  }
  /* Sports: a pool swim every Monday morning (a day with a run already, so no streak changes) and more recordings, so Running, Riding and Swimming all have something to read.
     Kept apart from the weeks above (own number stream, not in the health or battery maths), so nothing there shifts. */
  const swims: NativeActivity[] = [];
  const rnd2 = prng(today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate() + 7);
  for (let d = 0; d < 63; d++) {
    const start = back(d, 6, 40, Math.floor(rnd2() * 60));
    if (start.getDay() !== 1 || start.getTime() > now.getTime()) continue;
    const distance = 1500 + 100 * Math.round(rnd2() * 11 + (63 - d) / 21);
    const duration = (distance / 100) * (124 - (63 - d) * 0.05) * (1 + (rnd2() - 0.5) * 0.04);
    swims.push({
      id: String(476_000_000_000_000 + Math.floor(start.getTime() / 1000)), name: "Morning swim", sport: "poolSwim", sportCode: 300, start: ref(start),
      distanceMeters: distance, durationSeconds: r2(duration), averageHR: Math.round(126 + rnd2() * 6), maxHR: Math.round(144 + rnd2() * 8),
      calories: Math.round((duration / 60) * 9.5), trainingLoad: Math.round((duration / 60) * 0.95),
    });
  }
  swims.sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  for (const a of swims) add("activity", a.id, a);
  // Recordings for the other rides (power and heart rate) and for the long runs (speed and heart rate), as a phone sends them.
  for (const a of activities) {
    if (a === latestRun || a === latestRide) continue;
    if (a.sport === "bike") add("activity.detail", a.id, steadyDetail(a, rnd2, true, now));
    else if (a.sport === "run" && (a.durationSeconds ?? 0) >= 3600) add("activity.detail", a.id, steadyDetail(a, rnd2, false, now));
  }

  const runs = activities.filter((a) => a.sport === "run");
  const best = (name: string, meters: number, seconds: number, k: number) => ({ name, meters, seconds, at: runs[k]?.start ?? ref(back(30)), sport: "run", activityId: runs[k]?.id ?? "" });
  add("view.training", "me", {
    fitness: { start: key(back(181)), fitness, fatigue },
    load: { acute: todayVitals.acuteLoad, chronic: todayVitals.chronicLoad, ratio: todayVitals.loadRatio, status: "Optimized", weekTotal: Math.round(acute * 7) },
    vo2max: 54.3, thresholdPaceSecPerKm: 268.4, thresholdHr: 168, maxHr: 189, ftp: 236,
    predictions: [{ name: "5K", meters: 5000, seconds: 1238.6 }, { name: "10K", meters: 10000, seconds: 2581.2 }, { name: "Half marathon", meters: 21097.5, seconds: 5712.9 }, { name: "Marathon", meters: 42195, seconds: 12004.3 }],
    bests: [best("1K", 1000, 231.84, 1), best("5K", 5000, 1251.37, 1), best("10K", 10000, 2634.05, 4), best("Half marathon", 21097.5, 5890.62, 9),
      ...([["50 m", 50, 41.82, 2], ["100 m", 100, 91.47, 2], ["200 m", 200, 198.36, 1], ["400 m", 400, 411.24, 0], ["800 m", 800, 862.63, 4]] as const)
        .map(([name, meters, seconds, k]) => ({ name, meters, seconds, at: swims[k]?.start ?? ref(back(30)), sport: "swim", activityId: swims[k]?.id ?? "" }))],
    weeklyGoalMinutes: 300, readiness: { score: 78, status: "Ready" }, computedAt: ref(new Date(now.getTime() - 42 * 60_000)),
  });
  const hoursAgo = (h: number) => ref(new Date(now.getTime() - h * 3_600_000));
  const muscle = (name: string, f: number, trainedH?: number, readyH?: number) =>
    ({ name, fatigue: f, ...(trainedH != null ? { lastTrainedAt: hoursAgo(trainedH) } : {}), ...(readyH != null ? { readyAt: hoursAgo(-readyH) } : {}) });
  add("view.strength", "me", {
    muscles: [
      muscle("Chest", 12, 70), muscle("Shoulders", 15, 70), muscle("Triceps", 14, 70), muscle("Biceps", 31, 46, 6), muscle("Forearms", 16, 46),
      muscle("Abs", 6, 120), muscle("Obliques", 4, 120), muscle("Traps", 18, 46), muscle("Lats", 44, 22, 26), muscle("Upper back", 38, 22, 20),
      muscle("Lower back", 11, 94), muscle("Glutes", 13, 94), muscle("Abductors", 7, 94), muscle("Quads", 19, 94), muscle("Hamstrings", 17, 94),
      muscle("Adductors", 5, 94), muscle("Calves", 0, 16 * 24),
    ],
    suggestion: { title: "Push day", exercises: [
      { name: "Bench press", sets: 4, reps: 5, weightKg: 77.5 }, { name: "Overhead press", sets: 3, reps: 5, weightKg: 50 },
      { name: "Triceps pushdown", sets: 3, reps: 12, weightKg: 30 }, { name: "Plank", sets: 3 },
    ] },
    exerciseNames: EXERCISES, computedAt: hoursAgo(0.7),
  });
  add("view.body", "me", { bodyAge: { value: 36.4, at: ref(back(3, 6)) }, restingKcal: 1647, weightKg: 72.4, weightAt: ref(back(1, 7, 10)), weightSource: "watch", computedAt: hoursAgo(0.7) });
  add("body.goals", "me", { goals: { weight: { target: 71, start: 73.7, startDate: ref(back(89, 8)), byDate: ref(back(-45)) } } });

  return out;
}

function nightOf(date: Date, minutes: number, score: number, withStages: boolean, rnd: () => number): NativeSleepNight {
  const awake = 8 + Math.floor(rnd() * 14);
  const deep = Math.round(minutes * (0.18 + rnd() * 0.05)), rem = Math.round(minutes * (0.2 + rnd() * 0.05)), light = minutes - deep - rem;
  const wake = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 30 + Math.floor(rnd() * 40));
  const bed = new Date(wake.getTime() - (minutes + awake) * 60_000);
  const night: NativeSleepNight = {
    day: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }, totalMinutes: minutes, score, nightScore: score,
    deepMinutes: deep, lightMinutes: light, remMinutes: rem, awakeMinutes: awake, bedtime: ref(bed), wakeTime: ref(wake),
    averageHR: Math.round(50 + rnd() * 5), details: [{ label: "Sleep Efficiency", value: `${Math.round((minutes / (minutes + awake)) * 100)}%` }],
  };
  if (!withStages) return night;
  // Five cycles of light → deep → light → REM, with the short wakes between them; the lengths add up to the totals.
  const stages: NativeSleepSpan[] = [];
  let at = bed.getTime();
  const span = (stage: NativeSleepSpan["stage"], m: number) => {
    if (m <= 0) return;
    stages.push({ start: ref(new Date(at)), end: ref(new Date(at + m * 60_000)), stage });
    at += m * 60_000;
  };
  const cycles = 5;
  let d = deep, r = rem, l = light, a = awake;
  for (let c = 0; c < cycles; c++) {
    const last = c === cycles - 1;
    const dl = last ? d : Math.round(deep * [0.34, 0.28, 0.2, 0.12, 0.06][c]);
    const rl = last ? r : Math.round(rem * [0.1, 0.16, 0.2, 0.26, 0.28][c]);
    const ll = last ? l : Math.round(light / cycles);
    const al = last ? 0 : Math.min(a, Math.round(awake / (cycles - 1)));
    span("light", Math.ceil(ll / 2)); span("deep", dl); span("light", Math.floor(ll / 2)); span("rem", rl); span("awake", al);
    d -= dl; r -= rl; l -= ll; a -= al;
  }
  if (a > 0) span("awake", a);
  night.stages = stages;
  night.wakeTime = ref(new Date(at));
  // Sleep stress: a reading every 5 minutes from falling asleep, lower in deep sleep, one restless stretch.
  // Its own random numbers, so the rest of the seed stays the same.
  let seed = date.getFullYear() * 400 + date.getMonth() * 32 + date.getDate();
  const own = () => { const v = Math.sin(++seed * 127.1) * 43758.5453; return v - Math.floor(v); };
  const base = { deep: 12, light: 20, rem: 28, awake: 46 } as const;
  const spike = bed.getTime() + (0.3 + own() * 0.5) * (at - bed.getTime());
  const readings: number[] = [];
  for (let t = bed.getTime(), i = 0; t < at; t += 300_000) {
    while (i < stages.length - 1 && ref(new Date(t)) >= stages[i].end) i++;
    const near = Math.max(0, 1 - Math.abs(t - spike) / 1_500_000);
    readings.push(Math.max(1, Math.min(99, Math.round(base[stages[i].stage] + (own() - 0.5) * 12 + near * 28))));
  }
  night.stress = { start: ref(bed), readings };
  // A nap now and then, the afternoon of the day the night ended.
  if (own() < 0.25) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 10 + Math.floor(own() * 40));
    const asleepMinutes = 20 + Math.floor(own() * 25);
    night.naps = [{ start: ref(start), end: ref(new Date(start.getTime() + (asleepMinutes + 4) * 60_000)), asleepMinutes, points: Math.min(5, Math.round(asleepMinutes / 9)) }];
  }
  return night;
}

function energyDay(date: Date, now: Date | null, activities: NativeActivity[], rnd: () => number): EnergyDayBody {
  const midnight = date.getTime();
  const minuteOf = (refSeconds: number) => Math.round(((refSeconds + REF) * 1000 - midnight) / 60_000);
  const bed = -75 + Math.floor(rnd() * 40), wake = 395 + Math.floor(rnd() * 40);
  const start = 30 + Math.floor(rnd() * 14), woke = 78 + Math.floor(rnd() * 14);
  const events: NonNullable<EnergyDayBody["events"]> = [{ kind: "sleep", startMinute: bed, endMinute: wake, change: woke - start, sleepScore: 70 + Math.floor(rnd() * 22) }];
  const points: { minute: number; level: number }[] = [];
  for (let m = bed; m <= wake; m += 60) points.push({ minute: m, level: Math.round(start + ((woke - start) * (m - bed)) / (wake - bed)) });
  points.push({ minute: wake, level: woke });
  const todays = activities
    .filter((a) => a.start != null && minuteOf(a.start) >= 0 && minuteOf(a.start) < 1440)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const end = now ? Math.round((now.getTime() - midnight) / 60_000) : 1440 + bed + 10;
  let level = woke, at = wake;
  const drift = (to: number) => {
    if (to <= at) return;
    const used = ((to - at) / 60) * 2.6;
    events.push({ kind: "awake", startMinute: at, endMinute: to, change: -r1(used) });
    level -= used; at = to;
    points.push({ minute: at, level: Math.max(5, Math.round(level)) });
  };
  for (const a of todays) {
    const from = minuteOf(a.start!), to = from + Math.round((a.durationSeconds ?? 0) / 60);
    if (from <= at || to > end) continue;
    drift(from);
    const used = Math.min(level - 8, (a.trainingLoad ?? 40) * 0.24);
    events.push({ kind: "workout", startMinute: from, endMinute: to, change: -r1(used), workoutName: a.name });
    level -= used; at = to;
    points.push({ minute: at, level: Math.round(level) });
    if (to + 100 < end) {
      drift(to + 40);
      const gained = 4 + rnd() * 5;
      events.push({ kind: "rest", startMinute: at, endMinute: at + 50, change: r1(gained) });
      level += gained; at += 50;
      points.push({ minute: at, level: Math.round(level) });
    }
  }
  if (at + 240 < end) {
    drift(at + 150);
    events.push({ kind: "stress", startMinute: at, endMinute: at + 45, change: -4.5, averageStress: 58 + Math.floor(rnd() * 14) });
    level -= 4.5; at += 45;
    points.push({ minute: at, level: Math.round(level) });
  }
  drift(end);
  // `bedtime` is last night's: when the night began and the level then.
  const body: EnergyDayBody = { points, events, bedtime: { minute: bed, level: start }, woke: { minute: wake, level: woke }, learning: false };
  if (now) {
    const bedtime = 1440 - 70;
    const projected = Math.max(5, Math.round(level - ((bedtime - end) / 60) * 2.6));
    body.now = { minute: end, level: Math.max(5, Math.round(level)) };
    body.trend = "usingSlowly";
    if (bedtime > end) body.projection = [{ minute: end, level: body.now.level }, { minute: bedtime, level: projected }];
  }
  return body;
}

/** Heart rate over time only, rising in bouts and falling between them. No random numbers, so the other seeds stay as they were. */
function heartDetail(a: NativeActivity): ActivityDetailBody {
  const seconds = a.durationSeconds ?? 2400, base = (a.averageHR ?? 120) - 6, N = 240;
  const x: number[] = [], hr: number[] = [];
  let h = base - 18;
  for (let i = 0; i < N; i++) {
    const t = (seconds * i) / (N - 1);
    const target = base + 14 * Math.sin(t / 55) + 6 * Math.sin(t / 17);
    h += (target - h) * 0.3;
    x.push(r1(t));
    hr.push(Math.round(h));
  }
  return { streams: { axis: "time", x, hr } };
}

/** A plain recording over time: heart rate that drifts up a little, speed, and power on a ride. Older rides are a touch weaker. */
function steadyDetail(a: NativeActivity, rnd: () => number, power: boolean, now: Date): ActivityDetailBody {
  const seconds = a.durationSeconds ?? 3600, total = a.distanceMeters ?? 10000, N = Math.max(120, Math.round(seconds / 10));
  const age = Math.max(0, (now.getTime() / 1000 - ((a.start ?? 0) + REF)) / 86400);
  const base = (a.averageHR ?? 130) - 3, drift = 0.02 + rnd() * 0.05, watts = 172 - age * 0.35 + rnd() * 10;
  const x: number[] = [], hr: number[] = [], speedMps: number[] = [], powerW: number[] = [];
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    x.push(Math.round(seconds * f));
    hr.push(Math.round(base * (1 - drift / 2 + drift * f) + 3 * Math.sin(i * 0.07) + rnd() * 2));
    speedMps.push(r2(total / seconds + Math.sin(i * 0.09) * 0.12 + (rnd() - 0.5) * 0.06));
    // A hard five minutes and a harder twenty in the middle of every ride.
    if (power) powerW.push(Math.round(watts * (f > 0.3 && f < 0.3 + 1200 / seconds ? 1.32 : f > 0.75 && f < 0.75 + 300 / seconds ? 1.62 : 0.86) + 22 * Math.sin(i * 0.13) + rnd() * 14 + (i % 97 === 5 ? 420 : 0)));
  }
  return { streams: power ? { axis: "time", x, hr, speedMps, powerW } : { axis: "time", x, hr, speedMps } };
}

/** A structured tempo run: per-km laps with hundredths, three workout steps, streams over distance, a looped route. */
function runDetail(a: NativeActivity, rnd: () => number): ActivityDetailBody {
  const total = a.distanceMeters ?? 8000, seconds = a.durationSeconds ?? 2300;
  const kms = Math.ceil(total / 1000);
  const shape = (k: number) => (k < 2 ? 1.07 : k >= kms - 2 ? 1.03 : 0.955);
  const weights = Array.from({ length: kms }, (_, k) => shape(k) * Math.min(1000, total - k * 1000));
  const sum = weights.reduce((s, w) => s + w, 0);
  const laps = weights.map((w, k) => {
    const distanceM = Math.min(1000, total - k * 1000), hard = shape(k) < 1;
    return {
      n: k + 1, distanceM, durationS: r2((seconds * w) / sum + (rnd() - 0.5) * 0.4), avgHr: hard ? 166 + Math.floor(rnd() * 5) : 140 + k * 3,
      maxHr: hard ? 172 + Math.floor(rnd() * 4) : 149 + k * 3, cadence: hard ? 177 : 169, elevationM: r1(2 + rnd() * 10),
    };
  });
  const group = (name: string, from: number, to: number, n: number) => {
    const part = laps.slice(from, to), time = part.reduce((s, l) => s + l.durationS, 0);
    return {
      n, name, distanceM: part.reduce((s, l) => s + l.distanceM, 0), durationS: r2(time),
      avgHr: Math.round(part.reduce((s, l) => s + l.avgHr * l.durationS, 0) / time), maxHr: Math.max(...part.map((l) => l.maxHr)),
      cadence: Math.round(part.reduce((s, l) => s + l.cadence * l.durationS, 0) / time), elevationM: r1(part.reduce((s, l) => s + l.elevationM, 0)),
    };
  };
  const N = 400;
  const x: number[] = [], speedMps: number[] = [], hr: number[] = [], elevationM: number[] = [], cadence: number[] = [];
  let h = 118;
  for (let i = 0; i < N; i++) {
    const at = (total * i) / (N - 1), k = Math.min(kms - 1, Math.floor(at / 1000)), lap = laps[k];
    x.push(r1(at));
    speedMps.push(r2(lap.distanceM / lap.durationS + Math.sin(i * 0.9) * 0.04 + (rnd() - 0.5) * 0.06));
    h += (lap.avgHr + 2 - h) * 0.08;
    hr.push(Math.round(h + Math.sin(i * 0.4) * 1.5));
    elevationM.push(r1(88 + 12 * Math.sin(i * 0.03) + 5 * Math.sin(i * 0.08)));
    cadence.push(Math.round(lap.cadence + Math.sin(i * 0.7) * 1.4));
  }
  const route: [number, number][] = [];
  for (let i = 0; i <= 300; i++) {
    const t = (i / 300) * Math.PI * 2;
    route.push([45.5017 + 0.0105 * Math.sin(t) + 0.0021 * Math.sin(3 * t), -73.5673 + 0.0168 * (1 - Math.cos(t)) + 0.0026 * Math.sin(2 * t)]);
  }
  const zoneShare = [0.06, 0.25, 0.17, 0.45, 0.07];
  const bounds = [124, 144, 158, 172];
  return {
    laps, steps: [group("Warm up", 0, 2, 1), group("Tempo", 2, kms - 2, 2), group("Cool down", kms - 2, kms, 3)],
    streams: { axis: "distance", x, speedMps, hr, elevationM, cadence },
    route,
    zones: zoneShare.map((share, i) => ({ zone: i + 1, fromBpm: i === 0 ? null : bounds[i - 1], toBpm: i === 4 ? null : bounds[i] - 1, seconds: Math.round(seconds * share) })),
  };
}

/** A ride recorded over time, with power and no workout steps. */
function rideDetail(a: NativeActivity, rnd: () => number): ActivityDetailBody {
  const total = a.distanceMeters ?? 24000, seconds = a.durationSeconds ?? 3400;
  const lapCount = Math.ceil(total / 5000);
  const laps = Array.from({ length: lapCount }, (_, k) => {
    const distanceM = Math.min(5000, total - k * 5000);
    return { n: k + 1, distanceM, durationS: r2((seconds * distanceM) / total + (rnd() - 0.5) * 6), avgHr: 118 + Math.floor(rnd() * 8), maxHr: 131 + Math.floor(rnd() * 8), cadence: 82 + Math.floor(rnd() * 5), elevationM: r1(10 + rnd() * 40) };
  });
  const N = 360;
  const x: number[] = [], speedMps: number[] = [], hr: number[] = [], elevationM: number[] = [], cadence: number[] = [], powerW: number[] = [];
  for (let i = 0; i < N; i++) {
    x.push(Math.round((seconds * i) / (N - 1)));
    speedMps.push(r2(total / seconds + Math.sin(i * 0.11) * 0.9 + (rnd() - 0.5) * 0.3));
    hr.push(Math.round(121 + 7 * Math.sin(i * 0.05) + rnd() * 2));
    elevationM.push(r1(64 + 22 * Math.sin(i * 0.035)));
    cadence.push(Math.round(84 + 4 * Math.sin(i * 0.2)));
    powerW.push(Math.round(158 + 40 * Math.sin(i * 0.11 + 1) + rnd() * 12));
  }
  const route: [number, number][] = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    route.push([45.48 + 0.07 * t + 0.008 * Math.sin(t * 9), -73.62 + 0.11 * Math.sin(t * Math.PI) + 0.004 * Math.sin(t * 20)]);
  }
  const bounds = [124, 144, 158, 172];
  const share = [0.52, 0.41, 0.07, 0, 0];
  return {
    laps, streams: { axis: "time", x, speedMps, hr, elevationM, cadence, powerW }, route,
    zones: share.map((s, i) => ({ zone: i + 1, fromBpm: i === 0 ? null : bounds[i - 1], toBpm: i === 4 ? null : bounds[i] - 1, seconds: Math.round(seconds * s) })),
  };
}
