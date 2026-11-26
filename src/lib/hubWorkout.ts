/** COROS calendar workouts in the builder: their entry IDs, and COROS targets in words. */
import type { HubIntensity, HubWorkout } from "@/data/hub";
import { msg, t } from "@/lib/i18n";

/** Which COROS calendar entry a builder workout came from, with the workout as COROS sent it. */
export interface CorosLink {
  day: string;
  idInPlan: string;
  name: string;
  original: HubWorkout;
}

const UNITS: Partial<Record<HubIntensity["kind"], string>> = { heartRate: "bpm", power: "W", speed: "km/h", cadence: "/min", weight: "kg" };
const NAMES: Partial<Record<HubIntensity["kind"], string>> = { heartRate: msg("Heart rate"), power: msg("Power"), speed: msg("Speed"), cadence: msg("Cadence"), weight: msg("Weight"), rpe: "RPE", stroke: msg("Stroke"), grade: msg("Grade"), bodyweight: msg("Bodyweight") };

/** A COROS target the builder can't edit, in words: "Heart rate 140–155 bpm". */
export function intensityLabel(i: HubIntensity): string {
  const known = NAMES[i.kind];
  const name = known ? t(known) : t("COROS target");
  if (i.kind === "stroke" && i.stroke) return t("Stroke: {stroke}", { stroke: i.stroke });
  if (i.low == null) return name;
  const range = i.high != null && i.high !== i.low ? `${i.low}–${i.high}` : `${i.low}`;
  const unit = UNITS[i.kind];
  return `${name} ${range}${unit ? ` ${unit}` : ""}`;
}

/** Builder ID of a COROS calendar entry, and back. */
export function corosWorkoutId(day: string, idInPlan: string): string {
  return `coros-${day}-${idInPlan}`;
}
export function parseCorosWorkoutId(id: string): { day: string; idInPlan: string } | null {
  const m = /^coros-(\d{4}-\d{2}-\d{2})-(.+)$/.exec(id);
  return m ? { day: m[1], idInPlan: m[2] } : null;
}
