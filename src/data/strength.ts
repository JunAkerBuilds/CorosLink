import { fromSample, fromSynced, NotWiredError, type Loaded } from "./core";
import { hevyForStrength } from "./hevy";
import { mergeGymLogs } from "@/lib/hevy";
import { SAMPLE_STRENGTH } from "./sample/strength";
import { syncView } from "./sync";
import { strengthFromItems } from "./sync/strength";

export type MuscleState = "ready" | "recovering" | "overdue";

export interface Muscle {
  name: string;
  /** "Ready", "Ready in 1 day", "Not trained in 16 days". */
  note: string;
  /** Fatigue left in the muscle, 0 to 100. */
  fatigue: number;
  state: MuscleState;
}

export type RangeKey = "4w" | "12w" | "year";

export interface LiftedRange {
  key: RangeKey;
  label: string;
  /** What one bar covers. */
  per: "week" | "month";
  /** Weight lifted per bar, in thousands of kg, oldest first. */
  totals: number[];
  /** Change against the period before, as shown: "+12%". Empty when the period before has nothing. */
  change: string;
  workouts: number;
  sets: number;
  hours: number;
}

export interface Lift {
  name: string;
  bestKg: number;
  note: string;
  /** Best set per week in kg, oldest first. From the phone: only the weeks the lift was done. */
  history: number[];
}

export interface GymWorkout {
  /** The workout's own id, when it came from the phone or from Hevy. */
  id?: string;
  /** Set when this browser read the workout from Hevy; the rest came from the phone. */
  source?: "hevy";
  date: string;
  name: string;
  top: string;
  sets: number;
  liftedKg: number;
  seconds: number;
}

export interface Suggestion {
  title: string;
  text: string;
  figureAlt: string;
}

export interface Strength {
  suggestion: Suggestion;
  muscles: Muscle[];
  ranges: LiftedRange[];
  lifts: Lift[];
  workouts: GymWorkout[];
}

export async function loadStrength(): Promise<Loaded<Strength>> {
  const view = await syncView();
  if (!view) return fromSample(SAMPLE_STRENGTH);
  const phone = view.all("gym.workout").map((i) => i.body);
  const strengthView = view.get("view.strength", "me");
  // Hevy workouts this browser has read join the phone's gym log, minus the ones the phone already holds.
  const hevy = await hevyForStrength(view.viewer.id);
  if (!hevy) return fromSynced(strengthFromItems(phone, strengthView, new Date()));
  const merged = mergeGymLogs(phone, hevy.workouts);
  return fromSynced(strengthFromItems(merged.workouts, strengthView, new Date(), { ids: merged.fromHevy, names: hevy.names }));
}

export type StrengthAction = "calendar" | "edit" | "hevy" | "routines" | "log";

const NOT_WIRED: Record<StrengthAction, string> = {
  calendar: "Adding the suggested workout to the calendar isn't connected on the web yet.",
  edit: "Editing the suggested workout isn't connected on the web yet.",
  hevy: "Sending a workout to Hevy isn't connected on the web: Hevy is read only here. Nothing was sent.",
  routines: "Routines aren't connected on the web yet.",
  log: "Logging a past gym workout isn't connected on the web yet.",
};

/** The gym logger, routines and Hevy live in the phone app for now: nothing on this page can save them. */
export async function strengthAction(action: StrengthAction): Promise<never> {
  throw new NotWiredError(`strength.${action}`, NOT_WIRED[action]);
}
