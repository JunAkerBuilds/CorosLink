// The "Log activity" form: the activity types offered, how each one is uploaded, and the form's values turned
// into the activity the server writes. Ported from the desktop app's Log activity tab (AddWorkoutModal.tsx).
import { msg, t } from "@/lib/i18n";
import type { ManualActivity, TcxSport } from "@/lib/tcx";
import { distanceFromInput, distanceUnit, swimFromInput, swimUnit } from "@/lib/units";

/** How a type's distance is typed: "km" a long distance (km or mi as shown), "m" a swim (m or yd), "none" none. */
export type LogDistanceUnit = "km" | "m" | "none";

/** The unit the distance field shows for a type: km or mi, m or yd; empty when the type has no distance. */
export function logDistanceLabel(unit: LogDistanceUnit): string {
  return unit === "km" ? distanceUnit() : unit === "m" ? swimUnit() : "";
}
export type LogIcon = "run" | "ride" | "walk" | "hike" | "swim" | "strength" | "yoga" | "other";

export interface LogSport {
  id: string;
  label: string;
  /** What the TCX file says: only runs and rides have a sport of their own. */
  uploadSport: TcxSport;
  distanceUnit: LogDistanceUnit;
  icon: LogIcon;
}

/** The eight types the form opens with. */
export const SUGGESTED_LOG_SPORTS: readonly LogSport[] = [
  { id: "suggested-run", label: msg("Run"), uploadSport: "run", distanceUnit: "km", icon: "run" },
  { id: "suggested-ride", label: msg("Ride"), uploadSport: "bike", distanceUnit: "km", icon: "ride" },
  { id: "suggested-walk", label: msg("Walk"), uploadSport: "other", distanceUnit: "km", icon: "walk" },
  { id: "suggested-hike", label: msg("Hike"), uploadSport: "other", distanceUnit: "km", icon: "hike" },
  { id: "suggested-swim", label: msg("Swim"), uploadSport: "other", distanceUnit: "m", icon: "swim" },
  { id: "suggested-strength", label: msg("Strength"), uploadSport: "other", distanceUnit: "none", icon: "strength" },
  { id: "suggested-yoga", label: msg("Yoga"), uploadSport: "other", distanceUnit: "none", icon: "yoga" },
  { id: "suggested-other", label: msg("Other"), uploadSport: "other", distanceUnit: "none", icon: "other" },
];

/** COROS's activity sport types by name (the desktop's COROS_KNOWN_SPORT_TYPES, without its "All Sports" filter). */
export const COROS_SPORT_NAMES: readonly string[] = [
  msg("Custom Sport"), msg("Run"), msg("Indoor Run"), msg("Trail Run"), msg("Track Run"), msg("Hike"), msg("Mountain Climb"), msg("Climb"), msg("Bike"), msg("Indoor Bike"), msg("Road E-Bike"),
  msg("Gravel Road Bike"), msg("Mountain Bike"), msg("Mountain E-Bike"), msg("Helmet Bike"), msg("Pool Swim"), msg("Open Water Swim"), msg("Gym Cardio"), msg("GPS Cardio"), msg("Strength"),
  msg("Ski"), msg("Snowboard"), msg("XC Ski"), msg("Ski Touring"), msg("Rowing"), msg("Indoor Rowing"), msg("Whitewater"), msg("Flatwater"), msg("Windsurfing"), msg("Speedsurfing"), msg("Indoor Climb"),
  msg("Bouldering"), msg("Walk"), msg("Jump Rope"), msg("Climb Stairs"), msg("Triathlon"), msg("Multi Sport"), msg("Multi-Pitch Climb"),
];

const RUN_TERMS = ["run", "running", "treadmill", "trail run", "track"];
const BIKE_TERMS = ["bike", "biking", "bicycle", "cycle", "cycling", "ride", "mtb", "gravel"];
const SWIM_TERMS = ["swim", "swimming"];
const WALK_TERMS = ["walk", "walking"];
const HIKE_TERMS = ["hike", "hiking", "trek", "trail"];
const ROW_TERMS = ["row", "rowing"];
const SKI_TERMS = ["ski", "skiing", "snowboard", "skate", "skating"];
const PADDLE_TERMS = ["kayak", "canoe", "paddle", "sup"];

const normal = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, " ");
const has = (label: string, terms: readonly string[]): boolean => terms.some((term) => label.includes(term));

/** A ride is checked first, so "Indoor Bike" is never a run. */
export function inferUploadSport(label: string): TcxSport {
  const text = normal(label);
  return has(text, BIKE_TERMS) ? "bike" : has(text, RUN_TERMS) ? "run" : "other";
}

export function inferDistanceUnit(label: string): LogDistanceUnit {
  const text = normal(label);
  if (has(text, SWIM_TERMS)) return "m";
  return has(text, [...RUN_TERMS, ...BIKE_TERMS, ...WALK_TERMS, ...HIKE_TERMS, ...ROW_TERMS, ...SKI_TERMS, ...PADDLE_TERMS]) ? "km" : "none";
}

export function inferIcon(label: string): LogIcon {
  const text = normal(label);
  if (has(text, SWIM_TERMS)) return "swim";
  if (has(text, BIKE_TERMS)) return "ride";
  if (has(text, ["strength", "gym", "weight", "weights"])) return "strength";
  if (has(text, ["yoga", "pilates", "stretch", "mobility"])) return "yoga";
  if (has(text, RUN_TERMS)) return "run";
  if (has(text, WALK_TERMS)) return "walk";
  if (has(text, HIKE_TERMS)) return "hike";
  return "other";
}

/** One catalog: the eight suggested types, then every COROS sport type whose name isn't already there. */
export const ALL_LOG_SPORTS: readonly LogSport[] = (() => {
  const seen = new Set(SUGGESTED_LOG_SPORTS.map((s) => normal(s.label)));
  const out = [...SUGGESTED_LOG_SPORTS];
  for (const label of COROS_SPORT_NAMES) {
    const key = normal(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `coros-${key.replace(/[^a-z0-9]+/g, "-")}`, label, uploadSport: inferUploadSport(label), distanceUnit: inferDistanceUnit(label), icon: inferIcon(label) });
  }
  return out;
})();

export const logSport = (id: string): LogSport => ALL_LOG_SPORTS.find((s) => s.id === id) ?? SUGGESTED_LOG_SPORTS[0];

/**
 * The types to show: with a search, up to 12 matches from the whole catalog; without, the eight suggested ones,
 * led by the chosen type when it was picked through search.
 */
export function visibleLogSports(search: string, selectedId: string): LogSport[] {
  const query = normal(search);
  if (query) return ALL_LOG_SPORTS.filter((s) => normal(s.label).includes(query) || normal(t(s.label)).includes(query)).slice(0, 12);
  const selected = logSport(selectedId);
  return SUGGESTED_LOG_SPORTS.some((s) => s.id === selected.id) ? [...SUGGESTED_LOG_SPORTS] : [selected, ...SUGGESTED_LOG_SPORTS];
}

export interface LogForm {
  sportId: string;
  /** The day, YYYY-MM-DD, and the start as the time field gives it (HH:MM). Both local. */
  date: string;
  time: string;
  hours: string;
  minutes: string;
  distance: string;
  calories: string;
  avgHr: string;
}

const amount = (text: string): number => {
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Whole seconds of the hours and minutes typed; 0 when there is no duration yet. */
export function logDuration(form: Pick<LogForm, "hours" | "minutes">): number {
  return Math.round(amount(form.hours) * 3600 + amount(form.minutes) * 60);
}

/** The local start of the activity, or null while the time field is empty or wrong. */
export function logStart(form: Pick<LogForm, "date" | "time">): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date), time = /^(\d{1,2}):(\d{2})/.exec(form.time.trim());
  if (!day || !time) return null;
  const hour = Number(time[1]), minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute, 0, 0);
}

/** The activity to send, or null while the form has no start or no duration. Distance is typed in km or mi, or m or yd for a swim. */
export function logActivityInput(form: LogForm): ManualActivity | null {
  const start = logStart(form), durationSec = logDuration(form);
  if (!start || durationSec <= 0) return null;
  const sport = logSport(form.sportId);
  const typed = amount(form.distance);
  const distanceM = sport.distanceUnit === "m" ? Math.round(swimFromInput(typed)) : sport.distanceUnit === "km" ? Math.round(distanceFromInput(typed)) : 0;
  const calories = amount(form.calories), avgHr = amount(form.avgHr);
  return { sport: sport.uploadSport, startTimeIso: start.toISOString(), durationSec, distanceM, ...(calories > 0 ? { calories } : {}), ...(avgHr > 0 ? { avgHr } : {}) };
}
