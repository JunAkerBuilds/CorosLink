import type {
  PlanWorkoutEntryInput,
  RunWorkoutCreateStep,
  RunWorkoutEditorDraft,
  RunWorkoutEditorNode,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  RunWorkoutStepInput,
  TrainingPlanEntry,
  WorkoutSport
} from "./types";
import { WORKOUT_SPORT_CAPABILITIES, workoutSportType } from "./workoutCapabilities";

let planEditorNodeCounter = 0;

function editorNodeId(prefix: string): string {
  planEditorNodeCounter += 1;
  return `${prefix}-plan-${planEditorNodeCounter}`;
}

function editorKind(kind: RunWorkoutCreateStep["kind"]): RunWorkoutEditorStepKind {
  return kind === "interval" ? "training" : kind;
}

function editorTarget(step: RunWorkoutCreateStep): RunWorkoutEditorTarget {
  switch (step.target_type) {
    case "distance":
      return { type: "distance", meters: Math.max(0, step.target_distance_meters ?? 0) };
    case "load":
      return { type: "load", load: Math.max(0, step.target_load ?? 0) };
    case "hrRecovery":
      return { type: "hrRecovery", bpm: Math.max(0, step.target_hr_recovery_bpm ?? 0) };
    case "open":
      return { type: "open" };
    case "reps":
      return { type: "reps", count: Math.max(0, step.target_reps ?? 0) };
    case "elevationGain":
      return { type: "elevationGain", meters: Math.max(0, step.target_elevation_gain_meters ?? 0) };
    case "routes":
      return { type: "routes", count: Math.max(0, step.target_routes ?? 0) };
    case "time":
    default:
      return { type: "time", seconds: Math.max(0, step.target_duration_seconds ?? 0) };
  }
}

function editorStep(step: RunWorkoutCreateStep, sport: WorkoutSport): RunWorkoutEditorStep {
  return {
    id: editorNodeId("step"),
    nodeType: "step",
    kind: editorKind(step.kind),
    name: step.name?.trim() || (step.kind === "interval" ? "Training" : step.kind),
    target: editorTarget(step),
    intensity: structuredClone(step.intensity ?? WORKOUT_SPORT_CAPABILITIES[sport].defaultIntensity),
    exerciseId: step.exercise_id,
    exerciseName: step.exercise_name,
    exerciseKind: step.exercise_kind,
    sets: sport === "strength" && (step.kind === "training" || step.kind === "interval")
      ? step.sets ?? 1
      : step.sets,
    restType: sport === "strength" && (step.kind === "training" || step.kind === "interval")
      ? step.rest_type ?? 1
      : step.rest_type,
    restValue: sport === "strength" && (step.kind === "training" || step.kind === "interval")
      ? step.rest_value ?? 60
      : step.rest_value,
    overview: step.overview,
    sendOffSeconds: step.send_off_seconds,
    editable: true
  };
}

function editorNodes(steps: RunWorkoutStepInput[], sport: WorkoutSport): RunWorkoutEditorNode[] {
  return steps.map((node) => {
    if ("repeat" in node) {
      return {
        id: editorNodeId("repeat"),
        nodeType: "repeat" as const,
        name: node.name?.trim() || "Repeat",
        repeat: Math.max(1, Math.round(node.repeat)),
        steps: node.steps.map((step) => editorStep(step, sport)),
        editable: true
      };
    }
    return editorStep(node, sport);
  });
}

export function planWorkoutInputToEditorDraft(input: PlanWorkoutEntryInput): RunWorkoutEditorDraft {
  const sport = input.sport ?? "run";
  const sourceSteps = input.steps?.length
    ? input.steps
    : input.distance_km
      ? [{
          kind: "training" as const,
          target_type: "distance" as const,
          target_distance_meters: input.distance_km * 1_000,
          intensity: structuredClone(WORKOUT_SPORT_CAPABILITIES[sport].defaultIntensity)
        }]
      : [];
  return {
    name: input.name,
    overview: input.description ?? "",
    sportType: workoutSportType(sport),
    sport,
    sportOptions: input.sport_options ? structuredClone(input.sport_options) : undefined,
    nodes: editorNodes(sourceSteps, sport)
  };
}

function inputTarget(target: RunWorkoutEditorTarget): Partial<RunWorkoutCreateStep> {
  switch (target.type) {
    case "distance":
      return { target_type: "distance", target_distance_meters: target.meters };
    case "load":
      return { target_type: "load", target_load: target.load };
    case "hrRecovery":
      return { target_type: "hrRecovery", target_hr_recovery_bpm: target.bpm };
    case "open":
      return { target_type: "open" };
    case "reps":
      return { target_type: "reps", target_reps: target.count };
    case "elevationGain":
      return { target_type: "elevationGain", target_elevation_gain_meters: target.meters };
    case "routes":
      return { target_type: "routes", target_routes: target.count };
    case "time":
      return { target_type: "time", target_duration_seconds: target.seconds };
  }
}

function inputStep(step: RunWorkoutEditorStep): RunWorkoutCreateStep {
  return {
    kind: step.kind,
    ...(step.name.trim() ? { name: step.name.trim() } : {}),
    ...inputTarget(step.target),
    intensity: structuredClone(step.intensity),
    ...(step.exerciseId?.trim() ? { exercise_id: step.exerciseId.trim() } : {}),
    ...(step.exerciseName?.trim() ? { exercise_name: step.exerciseName.trim() } : {}),
    ...(step.exerciseKind !== undefined ? { exercise_kind: step.exerciseKind } : {}),
    ...(step.sets !== undefined ? { sets: step.sets } : {}),
    ...(step.restType !== undefined ? { rest_type: step.restType } : {}),
    ...(step.restValue !== undefined ? { rest_value: step.restValue } : {}),
    ...(step.overview?.trim() ? { overview: step.overview.trim() } : {}),
    ...(step.sendOffSeconds !== undefined ? { send_off_seconds: step.sendOffSeconds } : {})
  };
}

export function editorDraftToPlanWorkoutInput(
  draft: RunWorkoutEditorDraft,
  previous: PlanWorkoutEntryInput
): PlanWorkoutEntryInput {
  return {
    key: previous.key,
    name: draft.name.trim(),
    description: draft.overview.trim() || undefined,
    sport: draft.sport,
    sport_options: draft.sportOptions ? structuredClone(draft.sportOptions) : undefined,
    steps: draft.nodes.map((node) =>
      node.nodeType === "repeat"
        ? {
            repeat: Math.max(1, Math.round(node.repeat)),
            name: node.name.trim() || undefined,
            steps: node.steps.map(inputStep)
          }
        : inputStep(node)
    ),
    schedule_date: previous.schedule_date,
    sort_no: previous.sort_no,
    save_to_library: false
  };
}

/** Replace a plan-owned workout copy without mutating its linked library source. */
export function replaceTrainingPlanEntryWorkout(
  entry: TrainingPlanEntry,
  workout: PlanWorkoutEntryInput
): TrainingPlanEntry {
  return {
    ...entry,
    title: workout.name,
    workout: structuredClone(workout),
    programId: undefined,
    plannedDurationSeconds: undefined,
    plannedDistanceMeters: undefined,
    plannedTrainingLoad: undefined,
    plannedStrengthSets: undefined
  };
}
