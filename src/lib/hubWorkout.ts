/**
 * Turns a COROS Training Hub workout into the builder's steps and back.
 * Going back keeps everything COROS knows that the builder doesn't show: each step read from COROS keeps its
 * ID, and the original step is the base that the builder's edits are laid over.
 */
import type { HubIntensity, HubSport, HubStepKind, HubWorkout, HubWorkoutBlock, HubWorkoutStep } from "@/data/hub";
import type { RepeatBlock, Sport, StepKind, StepTarget, WorkoutItem, WorkoutStep } from "@/lib/workout";

/** Which COROS calendar entry a builder workout came from, with the workout as COROS sent it. */
export interface CorosLink {
  day: string;
  idInPlan: string;
  name: string;
  original: HubWorkout;
}

const FROM_SPORT: Partial<Record<HubSport, Sport>> = { run: "run", trailRun: "run", bike: "ride", swim: "swim" };
const TO_SPORT: Partial<Record<Sport, HubSport>> = { run: "run", ride: "bike", swim: "swim" };

const STEP_PREFIX = "cs-";
const BLOCK_PREFIX = "cb-";

const UNITS: Partial<Record<HubIntensity["kind"], string>> = { heartRate: "bpm", power: "W", speed: "km/h", cadence: "/min", weight: "kg" };
const NAMES: Partial<Record<HubIntensity["kind"], string>> = { heartRate: "Heart rate", power: "Power", speed: "Speed", cadence: "Cadence", weight: "Weight", rpe: "RPE", stroke: "Stroke", grade: "Grade", bodyweight: "Bodyweight" };

/** A COROS target the builder can't edit, in words: "Heart rate 140–155 bpm". */
export function intensityLabel(i: HubIntensity): string {
  const name = NAMES[i.kind] ?? "COROS target";
  if (i.kind === "stroke" && i.stroke) return `Stroke: ${i.stroke}`;
  if (i.low == null) return name;
  const range = i.high != null && i.high !== i.low ? `${i.low}–${i.high}` : `${i.low}`;
  const unit = UNITS[i.kind];
  return `${name} ${range}${unit ? ` ${unit}` : ""}`;
}

function targetOf(i: HubIntensity): StepTarget {
  if (i.kind === "none") return { type: "none" };
  if (i.kind === "pace" && i.low != null && i.low > 0) return { type: "pace", fast: i.low, slow: i.high != null && i.high >= i.low ? i.high : i.low };
  return { type: "kept", label: intensityLabel(i) };
}

function kindOf(step: HubWorkoutStep): StepKind {
  if (step.kind === "warmup") return "warmup";
  if (step.kind === "cooldown") return "cooldown";
  if (step.kind === "training") return "work";
  return step.target === "distance" || step.intensity.kind !== "none" ? "recovery" : "rest";
}

function stepOf(step: HubWorkoutStep, id: string): WorkoutStep | null {
  if (step.exercise || (step.sets ?? 0) > 0) return null;
  const base = { type: "step" as const, id, kind: kindOf(step), target: targetOf(step.intensity) };
  if (step.target === "time" && (step.seconds ?? 0) > 0) return { ...base, length: { type: "time", seconds: step.seconds! } };
  if (step.target === "distance" && (step.meters ?? 0) > 0) {
    return { ...base, length: { type: "distance", metres: step.meters!, unit: step.meters! < 1000 || step.meters! % 100 !== 0 ? "m" : "km" } };
  }
  return null;
}

/**
 * A COROS workout as builder steps, or null when the builder can't hold it faithfully: a sport it doesn't
 * know, a gym exercise, or a step that ends on something other than time or distance.
 */
export function fromHub(workout: HubWorkout): { sport: Sport; items: WorkoutItem[] } | null {
  const sport = FROM_SPORT[workout.sport];
  if (!sport || workout.blocks.length === 0) return null;
  let fresh = 0;
  const idFor = (prefix: string, id: string | undefined) => (id ? `${prefix}${id}` : `cn-${fresh++}`);
  const items: WorkoutItem[] = [];
  for (const block of workout.blocks) {
    const steps: WorkoutStep[] = [];
    for (const s of block.steps) {
      const step = stepOf(s, idFor(STEP_PREFIX, s.id));
      if (!step) return null;
      steps.push(step);
    }
    if (block.repeats == null) {
      if (steps.length !== 1) return null;
      items.push(steps[0]);
    } else {
      if (steps.length === 0 || block.repeats < 1) return null;
      items.push({ type: "repeat", id: idFor(BLOCK_PREFIX, block.id), count: block.repeats, steps });
    }
  }
  return { sport, items };
}

const HUB_KIND: Record<StepKind, HubStepKind> = { warmup: "warmup", work: "training", recovery: "rest", rest: "rest", cooldown: "cooldown" };

/**
 * Builder steps as a COROS workout, laid over `original` when the workout came from COROS.
 * Heart rate zones are refused: the zones on this page are the sample athlete's, not the person's own.
 */
export function toHub(name: string, sport: Sport, items: readonly WorkoutItem[], original?: HubWorkout): { workout: HubWorkout } | { problem: string } {
  const sameSport = original && FROM_SPORT[original.sport] === sport;
  const hubSport = sameSport ? original.sport : TO_SPORT[sport];
  if (!hubSport) return { problem: "Gym workouts can't be saved to COROS from here yet: they need exercises from COROS's list." };

  const steps = new Map<string, HubWorkoutStep>();
  const single = new Map<string, HubWorkoutBlock>();
  for (const block of original?.blocks ?? []) {
    for (const s of block.steps) if (s.id) steps.set(s.id, s);
    if (block.repeats == null && block.steps[0]?.id) single.set(block.steps[0].id, block);
  }

  let problem: string | null = null;
  const convert = (step: WorkoutStep): HubWorkoutStep => {
    const from = step.id.startsWith(STEP_PREFIX) ? steps.get(step.id.slice(STEP_PREFIX.length)) : undefined;
    let intensity: HubIntensity;
    if (step.target.type === "none") intensity = { kind: "none" };
    else if (step.target.type === "pace") intensity = { kind: "pace", low: step.target.fast, high: step.target.slow };
    else if (step.target.type === "kept" && from) intensity = from.intensity;
    else {
      problem = "Heart rate zone targets can't be saved to COROS from here yet, because your own zones aren't known on this page. Use a pace target or no target.";
      intensity = { kind: "none" };
    }
    const kind = from && kindOf(from) === step.kind ? from.kind : HUB_KIND[step.kind];
    const out: HubWorkoutStep = { ...(from ?? {}), kind, target: step.length.type, intensity };
    delete out.seconds; delete out.meters;
    if (step.length.type === "time") out.seconds = Math.round(step.length.seconds);
    else out.meters = Math.round(step.length.metres);
    return out;
  };

  const blocks: HubWorkoutBlock[] = items.map((item) => {
    if (item.type === "step") {
      const was = item.id.startsWith(STEP_PREFIX) ? single.get(item.id.slice(STEP_PREFIX.length)) : undefined;
      return { ...(was?.id ? { id: was.id } : {}), repeats: null, steps: [convert(item)] };
    }
    const block = item as RepeatBlock;
    const id = block.id.startsWith(BLOCK_PREFIX) ? block.id.slice(BLOCK_PREFIX.length) : undefined;
    return { ...(id ? { id } : {}), repeats: block.count, steps: block.steps.map(convert) };
  });
  if (problem) return { problem };
  if (blocks.length === 0) return { problem: "Add at least one step." };
  return { workout: { ...(original ?? { description: "" }), name, sport: hubSport, blocks } };
}

/** Builder ID of a COROS calendar entry, and back. */
export function corosWorkoutId(day: string, idInPlan: string): string {
  return `coros-${day}-${idInPlan}`;
}
export function parseCorosWorkoutId(id: string): { day: string; idInPlan: string } | null {
  const m = /^coros-(\d{4}-\d{2}-\d{2})-(.+)$/.exec(id);
  return m ? { day: m[1], idInPlan: m[2] } : null;
}
