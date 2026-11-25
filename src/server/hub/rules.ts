// What a COROS workout may hold, ported from HubWorkout.swift (`Sport.targets`, `Sport.intensities`, `problem`,
// the totals). Pure and free of Node imports, so the browser's workout builder uses the same rules the server
// checks with (re-exported from `@/data/hub`).
import type {
  HubClimbSystem, HubIntensityKind, HubSport, HubStepKind, HubStepTarget, HubTotals, HubWorkout, HubWorkoutStep,
} from "@/data/hub";

export const HUB_SPORTS: readonly HubSport[] = ["run", "trailRun", "bike", "swim", "strength", "hyrox", "xcSki", "indoorClimb", "bouldering"];

/** COROS's training-course sport code. */
export const SPORT_CODE: Record<HubSport, number> = {
  run: 1, bike: 2, swim: 3, strength: 4, trailRun: 5, indoorClimb: 6, bouldering: 7, xcSki: 8, hyrox: 9,
};

export function sportOfCode(code: number | undefined): HubSport | null {
  return HUB_SPORTS.find((sport) => SPORT_CODE[sport] === code) ?? null;
}

/** Strength steps, and HYROX stations, are exercises from COROS's catalog. */
export const usesExercises = (sport: HubSport): boolean => sport === "strength" || sport === "hyrox";
export const isClimb = (sport: HubSport): boolean => sport === "indoorClimb" || sport === "bouldering";
export const defaultGradeSystem = (sport: HubSport): HubClimbSystem => (sport === "bouldering" ? "vScale" : "yds");

/** Climbing grade systems with COROS's IDs. */
export const CLIMB_SYSTEM_ID: Record<HubClimbSystem, number> = { yds: 1, french: 2, vScale: 7, font: 8, uiaa: 9, ewbank: 10 };

/** The grades of each climbing system, easiest first, as COROS numbers them from 1. */
export const HUB_CLIMB_GRADES: Record<HubClimbSystem, readonly string[]> = {
  yds: ["5.6", "5.7", "5.8", "5.9", "5.10a", "5.10b", "5.10c", "5.10d", "5.11a", "5.11b", "5.11c", "5.11d", "5.12a", "5.12b",
    "5.12c", "5.12d", "5.13a", "5.13b", "5.13c", "5.13d", "5.14a", "5.14b", "5.14c", "5.14d", "5.15a"],
  french: ["4a", "4b", "4c", "5a", "5b", "5c", "6a", "6a+", "6b", "6b+", "6c", "6c+", "7a", "7a+", "7b", "7b+", "7c", "7c+",
    "8a", "8a+", "8b", "8b+", "8c", "8c+", "9a", "9a+", "9b", "9b+"],
  uiaa: ["IV", "V", "VI", "VI+", "VII-", "VII", "VII+", "VIII-", "VIII", "VIII+", "IX-", "IX", "IX+", "X-", "X", "X+",
    "XI-", "XI", "XI+", "XII-", "XII"],
  ewbank: Array.from({ length: 28 }, (_, i) => String(12 + i)),
  vScale: Array.from({ length: 18 }, (_, i) => `V${i}`),
  font: ["4", "4+", "5", "5+", "6A", "6A+", "6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+",
    "8B", "8B+", "8C", "8C+", "9A"],
};

/** The targets a step can end on. `exerciseKind` is a HYROX station's kind. */
export function hubTargetsFor(sport: HubSport, kind: HubStepKind, exerciseKind?: number): HubStepTarget[] {
  const endurance: HubStepTarget[] = ["time", "distance", "load", "open"];
  const enduranceRest: HubStepTarget[] = ["time", "distance", "load", "hrRecovery", "open"];
  switch (sport) {
    case "run": case "bike": case "swim":
      return kind === "rest" ? enduranceRest : endurance;
    case "trailRun": case "xcSki":
      return [...(kind === "rest" ? enduranceRest : endurance), "elevationGain"];
    case "strength":
      if (kind === "training") return ["reps", "time", "open"];
      if (kind === "rest") return ["time", "hrRecovery", "open"];
      return ["time", "open"];
    case "indoorClimb": case "bouldering":
      return ["routes", "time", "open"];
    case "hyrox":
      if (kind === "rest") return ["time", "hrRecovery", "open"];
      if (kind === "training" && exerciseKind !== undefined && exerciseKind > 0) {
        if (exerciseKind === 4) return ["distance", "reps", "time", "open"];
        if (exerciseKind === 8) return ["reps", "time", "open"];
        return ["distance", "time", "open"];
      }
      return [...endurance, "reps"];
  }
}

/** The intensities a step can carry. */
export function hubIntensitiesFor(sport: HubSport, kind: HubStepKind, exerciseKind?: number): HubIntensityKind[] {
  const running: HubIntensityKind[] = ["none", "heartRate", "pace", "power", "cadence"];
  switch (sport) {
    case "run": case "trailRun": return running;
    case "bike": return ["none", "heartRate", "power", "speed", "cadence"];
    case "swim": return ["none", "stroke"];
    case "strength": return kind === "training" ? ["none", "bodyweight", "weight"] : ["none"];
    case "indoorClimb": case "bouldering": return ["grade"];
    case "xcSki": return ["none", "heartRate", "speed"];
    case "hyrox":
      if (kind === "training" && exerciseKind !== undefined && exerciseKind > 0) {
        return exerciseKind === 1 || exerciseKind === 5 ? ["cadence", "rpe", "none"] : ["weight", "bodyweight", "rpe"];
      }
      return [...running, "weight", "rpe", "speed"];
  }
}

/** Whether a step names a catalog exercise (a strength exercise, or a HYROX station). */
export function isFunctional(step: HubWorkoutStep, sport: HubSport): boolean {
  return step.kind === "training" && (sport === "strength" || (sport === "hyrox" && (step.exercise?.kind ?? 0) > 0));
}

const within = (value: number | undefined, low: number, high: number, fallback: number): boolean => {
  const v = value ?? fallback;
  return v >= low && v <= high;
};

/**
 * What stops COROS taking this workout, in words for the athlete; null when it's fine.
 * `hasSource(step)` says a step was read from COROS (a strength step read from COROS may lack a catalog exercise).
 */
export function hubWorkoutProblem(workout: HubWorkout, hasSource: (step: HubWorkoutStep) => boolean = (step) => step.id !== undefined): string | null {
  if (workout.name.trim() === "") return "Give the workout a name.";
  if (workout.blocks.length === 0) return "Add at least one step.";
  for (const block of workout.blocks) {
    const isRepeat = block.repeats !== null && block.repeats !== undefined;
    if (isRepeat && !(Number.isInteger(block.repeats) && block.repeats! >= 1 && block.repeats! <= 99)) return "Repeats go from 1 to 99.";
    if (block.steps.length === 0) return "A repeat needs at least one step.";
    if (!isRepeat && block.steps.length !== 1) return "A step on its own holds one step.";
    for (const step of block.steps) {
      const problem = stepProblem(workout, step, hasSource(step));
      if (problem) return problem;
    }
  }
  return null;
}

function stepProblem(workout: HubWorkout, step: HubWorkoutStep, hasSource: boolean): string | null {
  const sport = workout.sport;
  if (sport === "strength" && step.kind === "training" && !step.exercise && !hasSource) return "Pick an exercise for each strength step.";
  if (!hubTargetsFor(sport, step.kind, step.exercise?.kind).includes(step.target)) return "A step ends on something this sport doesn't support.";
  switch (step.target) {
    case "time": if (!within(step.seconds, 1, 86_399, 0)) return "Each time step needs a duration."; break;
    case "distance": if (!((step.meters ?? 0) > 0)) return "Each distance step needs a distance."; break;
    case "open": break;
    case "reps": if (!within(step.count, 1, 500, 0)) return "Reps go from 1 to 500."; break;
    case "routes": if (!within(step.count, 1, 20, 0)) return "Routes go from 1 to 20."; break;
    case "load": if (!within(step.load, 0, 999, -1)) return "Training load goes from 0 to 999."; break;
    case "hrRecovery": if (!within(step.bpm, 30, 180, 0)) return "HR recovery goes from 30 to 180 bpm."; break;
    case "elevationGain": if (!within(step.meters, 20, 10_000, 0)) return "Elevation gain goes from 20 to 10,000 m."; break;
  }
  if (step.sets !== undefined && !within(step.sets, 1, 99, 0)) return "Sets go from 1 to 99.";
  const intensity = step.intensity;
  if (intensity.kind !== "kept" && !hubIntensitiesFor(sport, step.kind, step.exercise?.kind).includes(intensity.kind)) {
    return "That target isn't available for this step.";
  }
  switch (intensity.kind) {
    case "none": case "kept": case "bodyweight": break;
    case "stroke": if (!intensity.stroke) return "Pick a stroke."; break;
    case "weight": if (!within(intensity.low, 0, 2000, -1)) return "Weight goes from 0 to 2000 kg."; break;
    case "rpe": if (!within(intensity.low, 1, 10, 0)) return "RPE goes from 1 to 10."; break;
    case "grade":
      if (intensity.gradeOffset !== undefined) {
        if (!within(intensity.gradeOffset, -8, 4, 0)) return "Relative grades go from −8 to +4.";
      } else if (!HUB_CLIMB_GRADES[workout.gradeSystem ?? defaultGradeSystem(sport)].includes(intensity.grade ?? "")) {
        return "Pick a grade.";
      }
      break;
    case "heartRate": case "pace": case "power": case "speed": case "cadence": {
      const { low, high } = intensity;
      if (low === undefined || high === undefined || !(low > 0) || !(high > 0)) return "Each target needs both ends of its range.";
      if (intensity.kind === "heartRate" && (low < 30 || low > 250 || high < 30 || high > 250)) return "Heart rate targets go from 30 to 250 bpm.";
      if (intensity.kind === "pace" && (low < 60 || low > 3600 || high < 60 || high > 3600)) return "Paces go from 1:00 to 60:00 per km.";
    }
  }
  return null;
}

/** Planned time, distance and strength sets, counting repeats. Open steps add nothing. */
export function hubTotals(workout: HubWorkout): HubTotals {
  let seconds = 0, meters = 0, sets = 0;
  for (const block of workout.blocks) {
    const times = block.repeats ?? 1;
    for (const step of block.steps) {
      if (step.target === "time") seconds += times * (step.seconds ?? 0);
      if (step.target === "distance") meters += times * (step.meters ?? 0);
      if (isFunctional(step, workout.sport)) sets += times * (step.sets ?? 1);
    }
  }
  return { seconds, meters, sets };
}
