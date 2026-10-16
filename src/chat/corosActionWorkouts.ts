import type {
  CoachCorosActionPreview,
  CoachCorosActionStep,
  CoachCorosActionWorkout,
  WorkoutSport
} from "../../electron/types";

const LEGACY_SPORTS: Record<string, WorkoutSport | undefined> = { Run: "run", Bike: "bike", "Trail run": "trailRun", "Rest day": undefined };
const LEGACY_KINDS: Record<string, CoachCorosActionStep["kind"]> = { "Warm-up": "warmup", Training: "training", Recovery: "recovery", "Cool-down": "cooldown" };

/** Parse a display target ("1.20 km", "400 m", "10 min", "20 s", "4:30") back into a bar magnitude. */
export function targetMagnitude(target: string): Pick<CoachCorosActionStep, "magnitude" | "magnitudeType"> {
  const text = target.trim();
  let match = /^([\d.]+)\s*(km|mi|m)$/.exec(text);
  if (match) {
    const value = Number(match[1]);
    const meters = match[2] === "km" ? value * 1000 : match[2] === "mi" ? value * 1609.344 : value;
    return { magnitude: meters, magnitudeType: "distance" };
  }
  match = /^(\d+)\s*min$/.exec(text);
  if (match) return { magnitude: Number(match[1]) * 60, magnitudeType: "time" };
  match = /^(\d+)\s*s$/.exec(text);
  if (match) return { magnitude: Number(match[1]), magnitudeType: "time" };
  match = /^(\d+):(\d{2})$/.exec(text);
  if (match) return { magnitude: Number(match[1]) * 60 + Number(match[2]), magnitudeType: "time" };
  return {};
}

function legacyStep(line: string): CoachCorosActionStep | undefined {
  const match = /^(Warm-up|Training|Recovery|Cool-down): (.+?)(?: · (.+))?$/.exec(line.trim());
  if (!match) return undefined;
  const intensity = match[3] && match[3] !== "No intensity target" ? match[3] : undefined;
  return { kind: LEGACY_KINDS[match[1]!], label: match[1]!, target: match[2]!, ...(intensity ? { intensity } : {}), ...targetMagnitude(match[2]!) };
}

/** Actions staged before structured workouts existed only kept summary lines; rebuild the structure from them. */
export function legacyWorkouts(details: string[]): CoachCorosActionWorkout[] {
  const workouts: CoachCorosActionWorkout[] = [];
  let current: CoachCorosActionWorkout | undefined;
  for (const line of details) {
    const header = /^(?:Day (\d+) · )?(Run|Bike|Rest day|Trail run) · (.+)$/.exec(line);
    if (header) {
      current = { name: header[3]!, sportLabel: header[2]!, steps: [], ...(LEGACY_SPORTS[header[2]!] ? { sport: LEGACY_SPORTS[header[2]!] } : {}), ...(header[1] ? { dayNo: Number(header[1]) - 1 } : {}) };
      workouts.push(current);
      continue;
    }
    if (!current) continue;
    const group = /^(\d+) × \((.+)\)$/.exec(line);
    if (group) {
      const steps = group[2]!.split("; ").map(legacyStep).filter((step): step is CoachCorosActionStep => Boolean(step));
      if (steps.length) current.steps.push({ repeats: Number(group[1]), steps });
      continue;
    }
    const step = legacyStep(line);
    if (step) current.steps.push(step);
    else if (!current.description && !current.steps.length) current.description = line;
  }
  return workouts;
}


/** The workouts behind a staged COROS action, rebuilt from summary lines for older entries. */
export function actionWorkouts(preview: CoachCorosActionPreview): CoachCorosActionWorkout[] {
  return preview.workouts ?? legacyWorkouts(preview.details);
}

/** What to call a staged COROS action in lists: the workout's own name, or the plan name. */
export function actionName(preview: CoachCorosActionPreview): string | undefined {
  const workouts = actionWorkouts(preview);
  if (preview.destination === "Training Plan") {
    // createTrainingPlan details lead with the plan name; fall back to the first workout.
    const first = preview.details[0]?.trim();
    if (first && !/^(?:Day \d+ · )?(?:Run|Bike|Rest day|Trail run) · /.test(first) && !/^Each changed day/.test(first)) return first;
  }
  return workouts[0]?.name;
}
