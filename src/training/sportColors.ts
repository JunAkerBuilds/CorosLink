import type { TrainingHubActivity } from "../../electron/types";

export type SportColorCategory = "strength" | "trail" | "run" | "bike" | "other";

export const SPORT_COLOR_CATEGORIES: SportColorCategory[] = [
  "strength",
  "trail",
  "run",
  "bike",
  "other"
];

// Source of truth for the default palette. The :root --sport-* fallbacks in
// src/styles.css mirror these values; test:sport-colors asserts they match.
export const DEFAULT_SPORT_COLORS: Record<SportColorCategory, string> = {
  strength: "#e5484d",
  trail: "#4c8dff",
  run: "#2fbe91",
  bike: "#e6b800",
  other: "#7fd8cf"
};

export const SPORT_COLOR_LABELS: Record<SportColorCategory, string> = {
  strength: "Strength / Gym",
  trail: "Trail",
  run: "Running",
  bike: "Cycling",
  other: "Other"
};

const STORAGE_KEY = "coroslink.sportColors";
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Stable COROS sportType codes → color category; keep the codes in sync with
// electron/corosSportTypes.ts. Everything not listed (swim, triathlon, ski,
// rowing, climbing, walk, unknown codes) falls back to "other".
const SPORT_TYPE_CATEGORY: Record<number, SportColorCategory> = {
  100: "run", //      Run
  101: "run", //      Indoor Run
  102: "trail", //    Trail Run
  103: "run", //      Track Run
  104: "run", //      Treadmill Run
  200: "bike", //     Road Bike
  201: "bike", //     Indoor Bike
  202: "bike", //     E-Bike
  203: "bike", //     Gravel Bike
  204: "bike", //     Mountain Bike
  402: "strength", // Strength
  403: "strength", // Cardio (gym)
  700: "trail" //     Hiking
};

/**
 * Categorize an activity by its numeric COROS sportType code — names are
 * user-editable free text and unreliable. Unknown or missing codes → "other".
 */
export function sportColorCategory(
  sportType: number | undefined
): SportColorCategory {
  return (
    (sportType !== undefined ? SPORT_TYPE_CATEGORY[sportType] : undefined) ??
    "other"
  );
}

/** Parse a stored JSON blob, merging valid hex values over the defaults. */
export function parseSportColors(
  raw: string | null
): Record<SportColorCategory, string> {
  const result = { ...DEFAULT_SPORT_COLORS };
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const cat of SPORT_COLOR_CATEGORIES) {
      const value = parsed[cat];
      if (typeof value === "string" && HEX_RE.test(value)) {
        result[cat] = value;
      }
    }
  } catch {
    // malformed → defaults
  }
  return result;
}

export function readStoredSportColors(): Record<SportColorCategory, string> {
  const raw =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(STORAGE_KEY)
      : null;
  return parseSportColors(raw);
}

export function storeSportColors(
  colors: Record<SportColorCategory, string>
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // storage unavailable — ignore
  }
}

/** Set --sport-<cat> custom properties on the document root. */
export function applySportColors(
  colors: Record<SportColorCategory, string>
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cat of SPORT_COLOR_CATEGORIES) {
    root.style.setProperty(`--sport-${cat}`, colors[cat]);
  }
}

function dateToHappenDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/** Local-time YYYYMMDD for an epoch (seconds or ms), mirroring weeklyActivity. */
export function happenDayFromTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return dateToHappenDay(new Date(ms));
}

/**
 * Map each day (YYYYMMDD) to the sport color category of that day's activity
 * with the highest training load. Ties and missing/zero TL keep the first
 * activity seen for the day; an unknown sportType code resolves to "other".
 */
export function buildDominantSportByDay(
  activities: TrainingHubActivity[]
): Map<string, SportColorCategory> {
  const best = new Map<string, { load: number; category: SportColorCategory }>();

  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }

    const load =
      activity.trainingLoad !== undefined &&
      Number.isFinite(activity.trainingLoad)
        ? activity.trainingLoad
        : 0;
    const category = sportColorCategory(activity.sportType);
    const current = best.get(happenDay);

    // Strictly greater keeps the first activity on a tie (deterministic).
    if (!current || load > current.load) {
      best.set(happenDay, { load, category });
    }
  }

  const result = new Map<string, SportColorCategory>();
  for (const [happenDay, entry] of best) {
    result.set(happenDay, entry.category);
  }
  return result;
}

/**
 * Map each day (YYYYMMDD) to the distinct sport color categories done that day,
 * in canonical order. Multiple activities of the same category collapse to a
 * single entry (e.g. two bike rides → one "bike"). Used to split a day's cell
 * into equal slices, one per sport.
 */
export function buildSportCategoriesByDay(
  activities: TrainingHubActivity[]
): Map<string, Set<SportColorCategory>> {
  const byDay = new Map<string, Set<SportColorCategory>>();

  for (const activity of activities) {
    const happenDay = happenDayFromTimestamp(activity.startTime);
    if (!happenDay) {
      continue;
    }

    const category = sportColorCategory(activity.sportType);
    const set = byDay.get(happenDay) ?? new Set<SportColorCategory>();
    set.add(category);
    byDay.set(happenDay, set);
  }

  // Re-emit each set as canonically ordered for deterministic slice order.
  const result = new Map<string, Set<SportColorCategory>>();
  for (const [happenDay, set] of byDay) {
    result.set(
      happenDay,
      new Set(SPORT_COLOR_CATEGORIES.filter((cat) => set.has(cat)))
    );
  }
  return result;
}
