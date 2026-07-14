export type SportColorCategory = "strength" | "trail" | "run" | "bike" | "other";

export const SPORT_COLOR_CATEGORIES: SportColorCategory[] = [
  "strength",
  "trail",
  "run",
  "bike",
  "other"
];

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

/**
 * Categorize an activity by its sport name. Trail and bike are checked before
 * run so "TrailRun"/"VirtualRide" don't fall into run. Matches FR + EN names.
 */
export function sportColorCategory(
  name: string | undefined
): SportColorCategory {
  const n = (name ?? "").toLowerCase();
  if (!n) return "other";
  if (/trail/.test(n)) return "trail";
  if (/(bike|cycl|ride|v[ée]lo|spin)/.test(n)) return "bike";
  if (/(run|jog|course|marathon|tempo|track|\d+\s?k\b)/.test(n)) return "run";
  if (/(muscu|weight|strength|gym|\bcore\b|workout|entra[iî]n)/.test(n)) {
    return "strength";
  }
  return "other";
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
