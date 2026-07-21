import crypto from "node:crypto";
import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorIntensity,
  RunWorkoutEditorNode,
  RunWorkoutEditorRepeatGroup,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  WorkoutEditRef,
  WorkoutEditorContext,
  WorkoutLthrZone
} from "./types";

const TOP_LEVEL_SORT_INTERVAL = 16_777_216;
const GROUP_CHILD_SORT_INTERVAL = 65_536;
const PACE_MULTIPLIER = 1_000;
const MILES_PER_KILOMETER = 0.621371192;
const LTHR_ZONE_LABELS = [
  "Recovery",
  "Aerobic Endurance",
  "Aerobic Power",
  "Threshold",
  "Anaerobic Endurance",
  "Anaerobic Power"
];

const EXERCISE_TYPE_TO_KIND: Record<number, RunWorkoutEditorStepKind> = {
  1: "warmup",
  2: "training",
  3: "cooldown",
  4: "rest"
};

const KIND_TO_EXERCISE_TYPE: Record<RunWorkoutEditorStepKind, number> = {
  warmup: 1,
  training: 2,
  cooldown: 3,
  rest: 4
};

export interface WorkoutEditSource {
  ref: WorkoutEditRef;
  program: Record<string, unknown>;
  entity?: Record<string, unknown>;
}

export interface WorkoutDraftValidation {
  valid: boolean;
  errors: Record<string, string>;
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exerciseId(exercise: Record<string, unknown>): string | undefined {
  return exercise.id === null || exercise.id === undefined
    ? undefined
    : String(exercise.id);
}

function friendlyStepName(kind: RunWorkoutEditorStepKind): string {
  switch (kind) {
    case "warmup":
      return "Warm Up";
    case "cooldown":
      return "Cool Down";
    case "rest":
      return "Rest";
    default:
      return "Training";
  }
}

function parseTarget(
  exercise: Record<string, unknown>,
  kind: RunWorkoutEditorStepKind
): { target: RunWorkoutEditorTarget; reason?: string } {
  const targetType = numberValue(exercise.targetType) ?? 1;
  const targetValue = numberValue(exercise.targetValue) ?? 0;

  switch (targetType) {
    case 1:
      return { target: { type: "open" } };
    case 2:
      return { target: { type: "time", seconds: targetValue } };
    case 5:
      return { target: { type: "distance", meters: targetValue / 100 } };
    case 6:
      return { target: { type: "load", load: targetValue } };
    case 7:
      return kind === "rest"
        ? { target: { type: "hrRecovery", bpm: targetValue } }
        : {
            target: { type: "open" },
            reason: "HR Recovery is only editable on Rest steps."
          };
    default:
      return {
        target: { type: "open" },
        reason: `COROS target type ${targetType} is preserved but not editable.`
      };
  }
}

function parseIntensity(exercise: Record<string, unknown>): {
  intensity: RunWorkoutEditorIntensity;
  reason?: string;
} {
  const intensityType = numberValue(exercise.intensityType) ?? 0;
  const value = numberValue(exercise.intensityValue) ?? 0;
  const valueExtend = numberValue(exercise.intensityValueExtend) ?? value;

  if (intensityType === 0) {
    return { intensity: { type: "none" } };
  }

  if (intensityType === 3) {
    return {
      intensity: {
        type: "pace",
        lowSecondsPerKm: Math.min(value, valueExtend) / PACE_MULTIPLIER,
        highSecondsPerKm: Math.max(value, valueExtend) / PACE_MULTIPLIER,
        displayUnit: numberValue(exercise.intensityDisplayUnit) === 2 ? "mi" : "km"
      }
    };
  }

  if (intensityType === 2) {
    if (Boolean(exercise.isIntensityPercent)) {
      const low =
        numberValue(exercise.intensityPercent) ??
        numberValue(exercise.intensityValue) ??
        0;
      const high =
        numberValue(exercise.intensityPercentExtend) ??
        numberValue(exercise.intensityValueExtend) ??
        low;
      return {
        intensity: {
          type: "lthrPercent",
          lowPercent: Math.min(low, high),
          highPercent: Math.max(low, high)
        }
      };
    }

    return {
      intensity: {
        type: "heartRate",
        lowBpm: Math.min(value, valueExtend),
        highBpm: Math.max(value, valueExtend)
      }
    };
  }

  return {
    intensity: { type: "none" },
    reason: `COROS intensity type ${intensityType} is preserved but not editable.`
  };
}

function parseStep(exercise: Record<string, unknown>, index: number): RunWorkoutEditorStep {
  const exerciseType = numberValue(exercise.exerciseType) ?? 2;
  const kind = EXERCISE_TYPE_TO_KIND[exerciseType];
  const id = exerciseId(exercise);

  if (!kind) {
    return {
      id: `step-${id ?? index}`,
      ...(id ? { sourceExerciseId: id } : {}),
      nodeType: "step",
      kind: "training",
      name: String(exercise.name ?? "Unsupported step"),
      target: { type: "open" },
      intensity: { type: "none" },
      editable: false,
      unsupportedReason: `COROS exercise type ${exerciseType} is preserved but not editable.`
    };
  }

  const parsedTarget = parseTarget(exercise, kind);
  const parsedIntensity = parseIntensity(exercise);
  const reason = parsedTarget.reason ?? parsedIntensity.reason;
  const rawName = String(exercise.name ?? "").trim();
  const name = rawName && !/^T\d+$/i.test(rawName) ? rawName : friendlyStepName(kind);

  return {
    id: `step-${id ?? index}`,
    ...(id ? { sourceExerciseId: id } : {}),
    nodeType: "step",
    kind,
    name,
    target: parsedTarget.target,
    intensity: parsedIntensity.intensity,
    editable: !reason,
    ...(reason ? { unsupportedReason: reason } : {})
  };
}

export function corosProgramToWorkoutDraft(
  program: Record<string, unknown>
): RunWorkoutEditorDraft {
  const rawExercises = Array.isArray(program.exercises)
    ? (program.exercises.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
  const exercises = [...rawExercises].sort(
    (left, right) =>
      (numberValue(left.sortNo) ?? 0) - (numberValue(right.sortNo) ?? 0)
  );
  const groupedIds = new Set(
    exercises
      .filter((exercise) => Boolean(exercise.isGroup))
      .map((exercise) => exerciseId(exercise))
      .filter((id): id is string => Boolean(id))
  );
  const consumed = new Set<Record<string, unknown>>();
  const nodes: RunWorkoutEditorNode[] = [];

  exercises.forEach((exercise, index) => {
    if (consumed.has(exercise)) {
      return;
    }
    const id = exerciseId(exercise);
    if (Boolean(exercise.isGroup)) {
      const children = exercises.filter(
        (candidate) => !candidate.isGroup && String(candidate.groupId ?? "") === id
      );
      children.forEach((child) => consumed.add(child));
      const steps = children.map((child, childIndex) => parseStep(child, childIndex));
      const reason = steps.length === 0 ? "Empty COROS repeat group." : undefined;
      nodes.push({
        id: `group-${id ?? index}`,
        ...(id ? { sourceExerciseId: id } : {}),
        nodeType: "repeat",
        name: String(exercise.name ?? "Repeat"),
        repeat: Math.max(1, Math.min(99, Math.round(numberValue(exercise.sets) ?? 1))),
        steps,
        editable: !reason,
        ...(reason ? { unsupportedReason: reason } : {})
      });
      consumed.add(exercise);
      return;
    }

    const groupId = String(exercise.groupId ?? "");
    if (groupId && groupId !== "0" && groupedIds.has(groupId)) {
      return;
    }
    nodes.push(parseStep(exercise, index));
    consumed.add(exercise);
  });

  return {
    name: String(program.name ?? "Workout"),
    overview: String(program.overview ?? ""),
    sportType: 1,
    nodes
  };
}

function nextExerciseIdFactory(exercises: Record<string, unknown>[]): () => string {
  let maximum = 0n;
  for (const exercise of exercises) {
    const id = exerciseId(exercise);
    if (id && /^\d+$/.test(id)) {
      const parsed = BigInt(id);
      if (parsed > maximum) {
        maximum = parsed;
      }
    }
  }
  return () => String(++maximum);
}

function newExercise(id: string): Record<string, unknown> {
  return {
    id,
    access: 0,
    createTimestamp: 0,
    deleted: 0,
    equipment: [1],
    originId: "0",
    sourceId: "0",
    sourceUrl: "",
    videoUrl: "",
    sportType: 1,
    subType: 0,
    userId: 0,
    status: 1,
    isDefaultAdd: 0,
    part: [0]
  };
}

function defaultOverview(kind: RunWorkoutEditorStepKind, target: RunWorkoutEditorTarget): string {
  if (kind === "warmup") {
    return target.type === "distance" ? "sid_run_warm_up_dist" : "sid_run_warm_up";
  }
  if (kind === "cooldown") {
    return target.type === "distance" ? "sid_run_cool_down_dist" : "sid_run_cool_down";
  }
  if (kind === "rest") {
    return target.type === "distance" ? "sid_run_rest_dist" : "sid_run_rest";
  }
  return "sid_run_training";
}

function applyTarget(
  exercise: Record<string, unknown>,
  step: RunWorkoutEditorStep,
  context: WorkoutEditorContext
): void {
  exercise.targetDisplayUnit = 0;
  switch (step.target.type) {
    case "time":
      exercise.targetType = 2;
      exercise.targetValue = Math.round(step.target.seconds);
      break;
    case "distance":
      exercise.targetType = 5;
      exercise.targetValue = Math.round(step.target.meters * 100);
      exercise.targetDisplayUnit = context.distanceUnit === "imperial" ? 3 : 2;
      break;
    case "load":
      exercise.targetType = 6;
      exercise.targetValue = Math.round(step.target.load);
      break;
    case "hrRecovery":
      exercise.targetType = 7;
      exercise.targetValue = Math.round(step.target.bpm);
      break;
    case "open":
      exercise.targetType = 1;
      exercise.targetValue = 0;
      break;
  }
}

function applyIntensity(
  exercise: Record<string, unknown>,
  intensity: RunWorkoutEditorIntensity,
  context: WorkoutEditorContext
): void {
  Object.assign(exercise, {
    intensityType: 0,
    intensityValue: 0,
    intensityValueExtend: 0,
    intensityDisplayUnit: 0,
    intensityMultiplier: 0,
    intensityPercent: 0,
    intensityPercentExtend: 0,
    hrType: 3,
    isIntensityPercent: false
  });

  if (intensity.type === "pace") {
    exercise.intensityType = 3;
    exercise.intensityValue = Math.round(
      Math.min(intensity.lowSecondsPerKm, intensity.highSecondsPerKm) * PACE_MULTIPLIER
    );
    exercise.intensityValueExtend = Math.round(
      Math.max(intensity.lowSecondsPerKm, intensity.highSecondsPerKm) * PACE_MULTIPLIER
    );
    exercise.intensityDisplayUnit = intensity.displayUnit === "mi" ? 2 : 1;
    exercise.intensityMultiplier = PACE_MULTIPLIER;
    return;
  }

  if (intensity.type === "heartRate") {
    exercise.intensityType = 2;
    exercise.intensityValue = Math.round(Math.min(intensity.lowBpm, intensity.highBpm));
    exercise.intensityValueExtend = Math.round(Math.max(intensity.lowBpm, intensity.highBpm));
    return;
  }

  if (intensity.type === "lthrPercent") {
    const low = Math.min(intensity.lowPercent, intensity.highPercent);
    const high = Math.max(intensity.lowPercent, intensity.highPercent);
    exercise.intensityType = 2;
    exercise.isIntensityPercent = true;
    exercise.intensityPercent = low;
    exercise.intensityPercentExtend = high;
    // COROS derives the bpm preview from the athlete's LTHR zone data. The
    // persisted absolute fields remain zero for percentage-based HR targets.
    exercise.intensityValue = 0;
    exercise.intensityValueExtend = 0;
  }
}

function aggregateGroup(group: RunWorkoutEditorRepeatGroup): {
  targetType: number;
  targetValue: number;
  targetDisplayUnit: number;
} {
  const distance = group.steps.reduce(
    (sum, step) => sum + (step.target.type === "distance" ? step.target.meters * 100 : 0),
    0
  );
  const time = group.steps.reduce(
    (sum, step) => sum + (step.target.type === "time" ? step.target.seconds : 0),
    0
  );
  return distance > 0
    ? { targetType: 5, targetValue: Math.round(distance), targetDisplayUnit: 2 }
    : { targetType: 2, targetValue: Math.round(time), targetDisplayUnit: 0 };
}

export function workoutDraftToCorosProgram(
  sourceProgram: Record<string, unknown>,
  draft: RunWorkoutEditorDraft,
  context: WorkoutEditorContext
): Record<string, unknown> {
  const validation = validateWorkoutDraft(draft);
  if (!validation.valid) {
    throw new Error(Object.values(validation.errors)[0] ?? "Workout is invalid.");
  }

  const program = structuredClone(sourceProgram);
  const sourceExercises = Array.isArray(sourceProgram.exercises)
    ? (sourceProgram.exercises.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
  const byId = new Map(
    sourceExercises
      .map((exercise) => [exerciseId(exercise), exercise] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0]))
  );
  const allocateId = nextExerciseIdFactory(sourceExercises);
  const flattened: Record<string, unknown>[] = [];

  const buildStep = (
    step: RunWorkoutEditorStep,
    sortNo: number,
    groupId: string
  ): Record<string, unknown> => {
    const id = step.sourceExerciseId ?? allocateId();
    const source = step.sourceExerciseId ? byId.get(step.sourceExerciseId) : undefined;
    const exercise = source ? structuredClone(source) : newExercise(id);
    exercise.id = id;
    exercise.sortNo = sortNo;
    exercise.groupId = groupId;
    exercise.isGroup = false;

    if (!step.editable && source) {
      return exercise;
    }

    exercise.name = step.name.trim() || friendlyStepName(step.kind);
    exercise.exerciseType = KIND_TO_EXERCISE_TYPE[step.kind];
    exercise.sportType = 1;
    exercise.sets = 1;
    exercise.restType = step.kind === "rest" ? 3 : numberValue(exercise.restType) ?? 3;
    exercise.restValue = numberValue(exercise.restValue) ?? 0;
    exercise.overview = defaultOverview(step.kind, step.target);
    applyTarget(exercise, step, context);
    applyIntensity(exercise, step.intensity, context);
    return exercise;
  };

  draft.nodes.forEach((node, topIndex) => {
    const topSort = TOP_LEVEL_SORT_INTERVAL * (topIndex + 1);
    if (node.nodeType === "step") {
      flattened.push(buildStep(node, topSort, "0"));
      return;
    }

    const id = node.sourceExerciseId ?? allocateId();
    const source = node.sourceExerciseId ? byId.get(node.sourceExerciseId) : undefined;
    const group = source ? structuredClone(source) : newExercise(id);
    const aggregate = aggregateGroup(node);
    Object.assign(group, aggregate, {
      id,
      name: node.name.trim() || "Repeat",
      exerciseType: 0,
      sportType: 1,
      intensityType: 0,
      intensityValue: 0,
      intensityValueExtend: 0,
      intensityMultiplier: 0,
      groupId: "0",
      isGroup: true,
      sets: node.repeat,
      sortNo: topSort,
      restType: numberValue(group.restType) ?? 3,
      restValue: numberValue(group.restValue) ?? 0,
      overview: String(group.overview ?? "sid_run_training")
    });
    flattened.push(group);
    node.steps.forEach((step, childIndex) => {
      flattened.push(
        buildStep(step, topSort + GROUP_CHILD_SORT_INTERVAL * (childIndex + 1), id)
      );
    });
  });

  program.name = draft.name.trim();
  program.overview = draft.overview.trim();
  program.sportType = 1;
  program.simple = false;
  program.exercises = flattened;
  program.exerciseNum = flattened.length;
  program.totalSets = flattened.reduce(
    (total, exercise) => total + (exercise.isGroup ? Number(exercise.sets ?? 1) : 1),
    0
  );
  program.sets = program.totalSets;
  program.distanceDisplayUnit = context.distanceUnit === "imperial" ? 3 : 1;
  return program;
}

export function validateWorkoutDraft(draft: RunWorkoutEditorDraft): WorkoutDraftValidation {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) {
    errors.name = "Name is required.";
  } else if (draft.name.trim().length > 90) {
    errors.name = "Name must be 90 characters or fewer.";
  }
  if (draft.overview.length > 300) {
    errors.overview = "Description must be 300 characters or fewer.";
  }
  if (draft.nodes.length === 0) {
    errors.nodes = "Add at least one workout step.";
  }

  const validateStep = (step: RunWorkoutEditorStep, path: string): void => {
    if (!step.editable) {
      return;
    }
    if (step.target.type === "time" && step.target.seconds <= 0) {
      errors[`${path}.target`] = "Time must be greater than zero.";
    }
    if (step.target.type === "distance" && step.target.meters <= 0) {
      errors[`${path}.target`] = "Distance must be greater than zero.";
    }
    if (
      step.target.type === "load" &&
      (!Number.isInteger(step.target.load) || step.target.load < 0 || step.target.load > 999)
    ) {
      errors[`${path}.target`] = "Training Load must be a whole number from 0 to 999.";
    }
    if (step.target.type === "hrRecovery") {
      if (step.kind !== "rest") {
        errors[`${path}.target`] = "HR Recovery is available only for Rest steps.";
      } else if (step.target.bpm < 30 || step.target.bpm > 250) {
        errors[`${path}.target`] = "HR Recovery must be from 30 to 250 bpm.";
      }
    }
    if (step.intensity.type === "pace") {
      if (
        step.intensity.lowSecondsPerKm <= 0 ||
        step.intensity.highSecondsPerKm <= 0 ||
        step.intensity.lowSecondsPerKm > step.intensity.highSecondsPerKm
      ) {
        errors[`${path}.intensity`] = "Enter a valid pace range.";
      }
    }
    if (step.intensity.type === "heartRate") {
      if (
        step.intensity.lowBpm < 30 ||
        step.intensity.highBpm > 250 ||
        step.intensity.lowBpm > step.intensity.highBpm
      ) {
        errors[`${path}.intensity`] = "Heart rate must be from 30 to 250 bpm.";
      }
    }
    if (step.intensity.type === "lthrPercent") {
      if (
        step.intensity.lowPercent < 1 ||
        step.intensity.highPercent > 200 ||
        step.intensity.lowPercent > step.intensity.highPercent
      ) {
        errors[`${path}.intensity`] = "LTHR percentage must be from 1 to 200%.";
      }
    }
  };

  draft.nodes.forEach((node, index) => {
    if (node.nodeType === "step") {
      validateStep(node, `nodes.${index}`);
      return;
    }
    if (!Number.isInteger(node.repeat) || node.repeat < 1 || node.repeat > 99) {
      errors[`nodes.${index}.repeat`] = "Repeat count must be from 1 to 99.";
    }
    if (node.steps.length === 0) {
      errors[`nodes.${index}.steps`] = "Repeat groups need at least one step.";
    }
    node.steps.forEach((step, childIndex) =>
      validateStep(step, `nodes.${index}.steps.${childIndex}`)
    );
  });
  return { valid: Object.keys(errors).length === 0, errors };
}

export function workoutEditRevision(source: WorkoutEditSource): string {
  const programVersion = {
    id: source.program.id,
    idInPlan: source.program.idInPlan,
    version: source.program.version,
    pbVersion: source.program.pbVersion,
    updateTimestamp: source.program.updateTimestamp,
    modifyTimestamp: source.program.modifyTimestamp
  };
  const entityVersion = source.entity
    ? {
        planId: source.entity.planId,
        idInPlan: source.entity.idInPlan,
        planProgramId: source.entity.planProgramId,
        happenDay: source.entity.happenDay,
        version: source.entity.version,
        pbVersion: source.entity.pbVersion,
        updateTimestamp: source.entity.updateTimestamp,
        modifyTimestamp: source.entity.modifyTimestamp
      }
    : undefined;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ ref: source.ref, programVersion, entityVersion }))
    .digest("hex");
}

function normalizedDraft(draft: RunWorkoutEditorDraft): unknown {
  const normalizeIntensity = (intensity: RunWorkoutEditorIntensity): unknown =>
    intensity.type === "lthrPercent"
      ? {
          type: intensity.type,
          lowPercent: intensity.lowPercent,
          highPercent: intensity.highPercent
        }
      : intensity;
  return {
    name: draft.name.trim(),
    overview: draft.overview.trim(),
    nodes: draft.nodes.map((node) =>
      node.nodeType === "step"
        ? {
            nodeType: node.nodeType,
            kind: node.kind,
            name: node.name.trim(),
            target: node.target,
            intensity: normalizeIntensity(node.intensity),
            editable: node.editable
          }
        : {
            nodeType: node.nodeType,
            name: node.name.trim(),
            repeat: node.repeat,
            steps: node.steps.map((step) => ({
              kind: step.kind,
              name: step.name.trim(),
              target: step.target,
              intensity: normalizeIntensity(step.intensity),
              editable: step.editable
            }))
          }
    )
  };
}

export function workoutDraftsMatch(
  expected: RunWorkoutEditorDraft,
  actualProgram: Record<string, unknown>
): boolean {
  return JSON.stringify(normalizedDraft(expected)) ===
    JSON.stringify(normalizedDraft(corosProgramToWorkoutDraft(actualProgram)));
}

function parseZoneData(account: Record<string, unknown>): Record<string, unknown> {
  const raw = account.zoneData;
  if (typeof raw === "string") {
    try {
      return objectValue(JSON.parse(raw)) ?? {};
    } catch {
      return {};
    }
  }
  return objectValue(raw) ?? {};
}

export function parseWorkoutEditorContext(
  account: Record<string, unknown>
): WorkoutEditorContext {
  const zoneData = parseZoneData(account);
  const lthrBpm = numberValue(zoneData.lthr ?? account.lthr);
  const rawZones = Array.isArray(zoneData.lthrZone)
    ? zoneData.lthrZone
    : Array.isArray(account.lthrZone)
      ? account.lthrZone
      : [];
  const parsed = rawZones
    .map((item, arrayIndex) => {
      const zone = objectValue(item);
      if (!zone) {
        return undefined;
      }
      const index = Math.round(numberValue(zone.index) ?? arrayIndex + 1);
      const ratio = numberValue(zone.ratio);
      const hr = numberValue(zone.hr);
      return { index, ratio, hr };
    })
    .filter((zone): zone is { index: number; ratio: number | undefined; hr: number | undefined } => Boolean(zone))
    .sort((left, right) => left.index - right.index);
  const lthrZones: WorkoutLthrZone[] = parsed.map((zone, index) => {
    const next = parsed[index + 1];
    const lowPercent = zone.ratio !== undefined
      ? Math.round(zone.ratio <= 2 ? zone.ratio * 100 : zone.ratio)
      : lthrBpm && zone.hr
        ? Math.round((zone.hr / lthrBpm) * 100)
        : 0;
    const nextPercent = next?.ratio !== undefined
      ? Math.round(next.ratio <= 2 ? next.ratio * 100 : next.ratio)
      : lthrBpm && next?.hr
        ? Math.round((next.hr / lthrBpm) * 100)
        : undefined;
    const highPercent = nextPercent !== undefined
      ? Math.max(lowPercent, nextPercent - 1)
      : Math.max(lowPercent, 120);
    return {
      index: zone.index,
      label: LTHR_ZONE_LABELS[index] ?? `Zone ${zone.index}`,
      lowPercent,
      highPercent,
      ...(lthrBpm ? {
        lowBpm: Math.round((lthrBpm * lowPercent) / 100),
        highBpm: Math.round((lthrBpm * highPercent) / 100)
      } : {})
    };
  }).filter((zone) => zone.lowPercent > 0);
  const unit = numberValue(account.unit ?? zoneData.unit) ?? 0;
  const imperial = unit === 1 || unit === 3;
  return {
    distanceUnit: imperial ? "imperial" : "metric",
    paceUnit: imperial ? "mi" : "km",
    ...(lthrBpm ? { lthrBpm: Math.round(lthrBpm) } : {}),
    lthrZones
  };
}

export function paceSecondsForDisplay(secondsPerKm: number, unit: "km" | "mi"): number {
  return unit === "mi" ? secondsPerKm / MILES_PER_KILOMETER : secondsPerKm;
}

export function displayPaceToSecondsPerKm(seconds: number, unit: "km" | "mi"): number {
  return unit === "mi" ? seconds * MILES_PER_KILOMETER : seconds;
}

export function buildScheduledWorkoutEditRequest(
  ref: Extract<WorkoutEditRef, { kind: "scheduled" }>,
  entity: Record<string, unknown>,
  program: Record<string, unknown>
): Record<string, unknown> {
  return {
    entities: [structuredClone(entity)],
    programs: [structuredClone(program)],
    versionObjects: [
      {
        id: ref.idInPlan,
        status: 2,
        planProgramId: ref.planProgramId,
        planId: ref.planId
      }
    ],
    pbVersion: numberValue(program.pbVersion) ?? 2
  };
}

export interface WorkoutEditEndpointAdapter<TCalculation, TEstimate = unknown> {
  calculate: (program: Record<string, unknown>) => Promise<TCalculation>;
  updateLibrary: (program: TCalculation) => Promise<void>;
  updateScheduled: (request: Record<string, unknown>) => Promise<void>;
  estimateScheduled: (request: {
    entity: Record<string, unknown>;
    program: Record<string, unknown>;
  }) => Promise<TEstimate>;
}

export async function runWorkoutEditPreview<TCalculation, TEstimate>(
  ref: WorkoutEditRef,
  entity: Record<string, unknown> | undefined,
  program: Record<string, unknown>,
  adapter: WorkoutEditEndpointAdapter<TCalculation, TEstimate>
): Promise<TCalculation | TEstimate> {
  if (ref.kind === "library") {
    return adapter.calculate(program);
  }
  if (!entity) {
    throw new Error("Scheduled workout entity is missing.");
  }
  return adapter.estimateScheduled({ entity, program });
}

export async function runWorkoutEditWrite<TCalculation extends Record<string, unknown>>(
  ref: WorkoutEditRef,
  entity: Record<string, unknown> | undefined,
  program: Record<string, unknown>,
  adapter: WorkoutEditEndpointAdapter<TCalculation>
): Promise<TCalculation> {
  const calculated = await adapter.calculate(program);
  if (ref.kind === "library") {
    await adapter.updateLibrary(calculated);
    return calculated;
  }
  if (!entity) {
    throw new Error("Scheduled workout entity is missing.");
  }
  await adapter.updateScheduled(
    buildScheduledWorkoutEditRequest(ref, entity, calculated)
  );
  return calculated;
}
