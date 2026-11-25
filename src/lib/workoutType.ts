// What kind of session a planned workout is (easy, long, tempo, intervals…), for telling them apart at a glance in
// the plan editor. Read from the name first (Coach and people name sessions the way they mean them), then from the
// steps (repeats are intervals, a long single effort is a long run) and the sport. Pure.
import type { BuilderDoc } from "@/lib/builder";

export type WorkoutType = "easy" | "long" | "tempo" | "intervals" | "speed" | "hills" | "recovery" | "race" | "strength" | "cross" | "other";

export const WORKOUT_TYPES: Record<WorkoutType, { label: string; hue: string }> = {
  easy: { label: "Easy", hue: "mint" },
  long: { label: "Long", hue: "blue" },
  tempo: { label: "Tempo", hue: "gold" },
  intervals: { label: "Intervals", hue: "coral" },
  speed: { label: "Speed", hue: "pink" },
  hills: { label: "Hills", hue: "violet" },
  recovery: { label: "Recovery", hue: "cyan" },
  race: { label: "Race", hue: "rose" },
  strength: { label: "Strength", hue: "orange" },
  cross: { label: "Cross", hue: "lime" },
  other: { label: "Workout", hue: "honey" },
};

/** The order the legend lists them in: from easiest to hardest, then the rest. */
export const TYPE_ORDER: readonly WorkoutType[] = ["recovery", "easy", "long", "tempo", "hills", "speed", "intervals", "race", "strength", "cross", "other"];

const NAMES: readonly [RegExp, WorkoutType][] = [
  [/\b(race|time trial|tt|parkrun)\b/i, "race"],
  [/\b(recovery|shake ?out|regen)\b/i, "recovery"],
  [/\b(vo2|interval)/i, "intervals"],
  [/\b(fartlek|speed|sprints?)\b/i, "speed"],
  [/\b(threshold|tempo|cruise|lactate|steady state|marathon pace|progression)\b/i, "tempo"],
  [/\bhills?\b/i, "hills"],
  [/\blong\b/i, "long"],
  [/\b(strength|gym|legs?|upper|lower|core|lift|squat|hyrox)\b/i, "strength"],
  [/^\s*strides\b/i, "speed"],
  // A named kind above wins; a plain "6 × 800 m" or "repeats" is an interval session.
  [/(\brepeats?\b|\breps\b|\btrack\b|\d+\s*[x×]\s*\d)/i, "intervals"],
  [/\b(easy|base|aerobic|zone ?2|z2|jog)\b/i, "easy"],
];

/** The type of one planned workout. */
export function workoutType(name: string | undefined, sport: string | undefined, doc?: BuilderDoc, minutes = 0): WorkoutType {
  if (sport === "strength" || sport === "hyrox") return "strength";
  if (sport === "bike" || sport === "swim" || sport === "xcSki" || sport === "indoorClimb" || sport === "bouldering") return "cross";
  for (const [re, type] of NAMES) if (name && re.test(name)) return type;
  if (doc?.items.some((i) => i.type === "repeat" && i.count > 1)) return "intervals";
  if (minutes >= 75) return "long";
  return sport === "run" || sport === "trailRun" ? "easy" : "other";
}
