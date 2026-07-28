import crypto from "node:crypto";
import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorIntensity,
  RunWorkoutEditorNode,
  RunWorkoutEditorRepeatGroup,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  UnitSystem,
  WorkoutEditRef,
  WorkoutEditorContext,
  WorkoutLthrZone,
  WorkoutSport,
  WorkoutZone
} from "./types";
import {
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  RUNNING_POWER_PRESETS,
  WORKOUT_SPORT_CAPABILITIES,
  decodeCorosIntensity,
  encodeCorosIntensity,
  requiredWorkoutPbVersion,
  validateWorkoutIntensity,
  validateWorkoutDraftShared,
  validateWorkoutTarget,
  workoutSportFromType,
  workoutSportType
} from "./workoutCapabilities";
import {
  POUNDS_PER_KILOGRAM,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  normalizeUnitSystem,
  speedUnit,
  weightUnit
} from "./unitSystem.js";

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
  4: "rest",
  5: "sendOff"
};

const KIND_TO_EXERCISE_TYPE: Record<RunWorkoutEditorStepKind, number> = {
  warmup: 1,
  training: 2,
  cooldown: 3,
  rest: 4,
  sendOff: 2
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

function originExerciseId(exercise: Record<string, unknown>): string | undefined {
  const value = exercise.originId;
  return value === null || value === undefined || String(value) === "0"
    ? undefined
    : String(value);
}

function friendlyStepName(kind: RunWorkoutEditorStepKind): string {
  switch (kind) {
    case "warmup":
      return "Warm Up";
    case "cooldown":
      return "Cool Down";
    case "rest":
      return "Rest";
    case "sendOff":
      return "Send-off";
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
    case 3:
      return { target: { type: "reps", count: Math.round(targetValue) } };
    case 8:
      return { target: { type: "elevationGain", meters: targetValue / 100 } };
    case 9:
      return { target: { type: "routes", count: Math.round(targetValue) } };
    default:
      return {
        target: { type: "open" },
        reason: `COROS target type ${targetType} is preserved but not editable.`
      };
  }
}

function parseIntensity(
  exercise: Record<string, unknown>,
  context?: WorkoutEditorContext
): {
  intensity: RunWorkoutEditorIntensity;
  reason?: string;
} {
  const parsed = decodeCorosIntensity(exercise);
  const intensity = parsed.intensity;
  if (!context) return parsed;
  if (intensity.type === "pace" || intensity.type === "effortPace") {
    return {
      ...parsed,
      intensity: { ...intensity, displayUnit: context.paceUnit }
    };
  }
  if (intensity.type === "speed") {
    const lowKmh = intensity.unit === "mph" ? intensity.low * 1.609344 : intensity.low;
    const highKmh = intensity.unit === "mph" ? intensity.high * 1.609344 : intensity.high;
    return {
      ...parsed,
      intensity: {
        ...intensity,
        low: kmhToDisplaySpeed(lowKmh, context.distanceUnit),
        high: kmhToDisplaySpeed(highKmh, context.distanceUnit),
        unit: speedUnit(context.distanceUnit)
      }
    };
  }
  if (intensity.type === "weight" && intensity.mode === "weight") {
    const kilograms = intensity.unit === "lb"
      ? intensity.value / POUNDS_PER_KILOGRAM
      : intensity.value;
    return {
      ...parsed,
      intensity: {
        ...intensity,
        value: kilogramsToDisplayWeight(kilograms, context.distanceUnit),
        unit: weightUnit(context.distanceUnit)
      }
    };
  }
  return parsed;
}

function parseStep(
  exercise: Record<string, unknown>,
  index: number,
  sport: WorkoutSport,
  context?: WorkoutEditorContext
): RunWorkoutEditorStep {
  const exerciseType = numberValue(exercise.exerciseType) ?? 2;
  const kind = sport === "swim" &&
    (exerciseType === 5 || (exerciseType === 2 && numberValue(exercise.subType) === 1))
    ? "sendOff"
    : EXERCISE_TYPE_TO_KIND[exerciseType];
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
      ...(originExerciseId(exercise) ? { exerciseId: originExerciseId(exercise) } : {}),
      ...(exercise.name ? { exerciseName: String(exercise.name) } : {}),
      ...(numberValue(exercise.exerciseKind) !== undefined
        ? { exerciseKind: numberValue(exercise.exerciseKind) }
        : {}),
      editable: false,
      unsupportedReason: `COROS exercise type ${exerciseType} is preserved but not editable.`
    };
  }

  const parsedTarget = parseTarget(exercise, kind);
  const parsedIntensity = parseIntensity(exercise, context);
  const reason = parsedTarget.reason ?? parsedIntensity.reason ??
    validateWorkoutTarget(sport, kind, parsedTarget.target, numberValue(exercise.exerciseKind)) ??
    validateWorkoutIntensity(sport, parsedIntensity.intensity, kind, numberValue(exercise.exerciseKind));
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
    ...(originExerciseId(exercise) ? { exerciseId: originExerciseId(exercise) } : {}),
    ...(rawName ? { exerciseName: rawName } : {}),
    ...(numberValue(exercise.exerciseKind) !== undefined
      ? { exerciseKind: numberValue(exercise.exerciseKind) }
      : {}),
    ...(numberValue(exercise.packageTime) !== undefined
      ? { sendOffSeconds: numberValue(exercise.packageTime) }
      : {}),
    editable: !reason,
    ...(reason ? { unsupportedReason: reason } : {})
  };
}

export function corosProgramToWorkoutDraft(
  program: Record<string, unknown>,
  context?: WorkoutEditorContext
): RunWorkoutEditorDraft {
  const sport = workoutSportFromType(program.sportType) ?? "run";
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
      const steps = children.map((child, childIndex) =>
        parseStep(child, childIndex, sport, context)
      );
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
    nodes.push(parseStep(exercise, index, sport, context));
    consumed.add(exercise);
  });

  const gradingSystem = Object.entries(CLIMB_SYSTEM_IDS).find(
    ([, value]) => value === numberValue((objectValue(program.referExercise) ?? {}).gradeSystem)
  )?.[0] as WorkoutEditorContext["climbSystems"]["indoorClimb"] | undefined;
  const poolRaw = numberValue(program.poolLength);
  const poolUnit = context
    ? context.defaultPoolLength.unit
    : [3, 4].includes(numberValue(program.poolLengthUnit) ?? 0) ? "yd" : "m";
  return {
    name: String(program.name ?? "Workout"),
    overview: String(program.overview ?? ""),
    sportType: workoutSportType(sport),
    sport,
    ...((sport === "swim" || sport === "indoorClimb" || sport === "bouldering")
      ? {
          sportOptions: {
            ...(sport === "swim" && poolRaw
              ? {
                  poolLength: {
                    value: poolRaw / 100 / (poolUnit === "yd" ? 0.9144 : 1),
                    unit: poolUnit
                  }
                }
              : {}),
            ...(gradingSystem ? { gradingSystem } : {})
          }
        }
      : {}),
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

function newExercise(id: string, sport: WorkoutSport): Record<string, unknown> {
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
    sportType: workoutSportType(sport),
    subType: 0,
    userId: 0,
    status: 1,
    isDefaultAdd: 0,
    part: [0]
  };
}

function defaultOverview(
  sport: WorkoutSport,
  kind: RunWorkoutEditorStepKind,
  target: RunWorkoutEditorTarget
): string {
  if (sport === "swim") {
    if (kind === "warmup" || kind === "sendOff") return "sid_poolswim_warm_up_dist";
    if (kind === "cooldown") return "sid_poolswim_cool_down_dist";
    if (kind === "rest") return "sid_poolswim_cool_down_dist";
    return "sid_poolswim_dist_default";
  }
  if (sport === "bike") {
    if (kind === "warmup") return "sid_bike_warm_up_dist";
    if (kind === "cooldown") return "sid_bike_cool_down_dist";
    if (kind === "rest") return "sid_bike_cool_down_dist";
    return "sid_bike_dist_speed";
  }
  if (sport === "strength") return "sid_strength_training";
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
  context: WorkoutEditorContext,
  sport: WorkoutSport
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
      exercise.targetDisplayUnit = sport === "swim"
        ? context.distanceUnit === "imperial" ? 4 : 2
        : context.distanceUnit === "imperial" ? 3 : 2;
      break;
    case "load":
      exercise.targetType = 6;
      exercise.targetValue = Math.round(step.target.load);
      break;
    case "hrRecovery":
      exercise.targetType = 7;
      exercise.targetValue = Math.round(step.target.bpm);
      break;
    case "reps":
      exercise.targetType = 3;
      exercise.targetValue = Math.round(step.target.count);
      break;
    case "elevationGain":
      exercise.targetType = 8;
      exercise.targetValue = Math.round(step.target.meters * 100);
      exercise.targetDisplayUnit = context.distanceUnit === "imperial" ? 5 : 2;
      break;
    case "routes":
      exercise.targetType = 9;
      exercise.targetValue = Math.round(step.target.count);
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
  Object.assign(exercise, encodeCorosIntensity(intensity, context));
}

function aggregateGroup(
  group: RunWorkoutEditorRepeatGroup,
  context: WorkoutEditorContext,
  sport: WorkoutSport
): {
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
    ? {
        targetType: 5,
        targetValue: Math.round(distance),
        targetDisplayUnit: sport === "swim"
          ? context.distanceUnit === "imperial" ? 4 : 2
          : context.distanceUnit === "imperial" ? 3 : 2
      }
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
    const exercise = source ? structuredClone(source) : newExercise(id, draft.sport);
    exercise.id = id;
    exercise.sortNo = sortNo;
    exercise.groupId = groupId;
    exercise.isGroup = false;

    if (!step.editable && source) {
      return exercise;
    }

    exercise.name = step.name.trim() || friendlyStepName(step.kind);
    exercise.exerciseType = KIND_TO_EXERCISE_TYPE[step.kind];
    exercise.subType = step.kind === "sendOff"
      ? 1
      : draft.sport === "hyrox" && step.kind === "training" && step.exerciseKind
        ? 2
        : 0;
    exercise.sportType = draft.sportType;
    if (step.exerciseId) exercise.originId = step.exerciseId;
    if (step.exerciseKind !== undefined) exercise.exerciseKind = step.exerciseKind;
    if (draft.sport === "hyrox" && step.kind === "training" && step.exerciseKind) {
      exercise.hyroxTrainingMode = "strength";
    } else if (draft.sport === "hyrox") {
      delete exercise.hyroxTrainingMode;
      exercise.exerciseKind = 0;
    }
    if (step.sendOffSeconds !== undefined) exercise.packageTime = Math.round(step.sendOffSeconds);
    exercise.sets = 1;
    exercise.restType = step.kind === "rest" ? 3 : numberValue(exercise.restType) ?? 3;
    exercise.restValue = numberValue(exercise.restValue) ?? 0;
    exercise.overview = defaultOverview(draft.sport, step.kind, step.target);
    applyTarget(exercise, step, context, draft.sport);
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
    const group = source ? structuredClone(source) : newExercise(id, draft.sport);
    const aggregate = aggregateGroup(node, context, draft.sport);
    Object.assign(group, aggregate, {
      id,
      name: node.name.trim() || "Repeat",
      exerciseType: 0,
      sportType: draft.sportType,
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
      overview: String(group.overview ?? defaultOverview(draft.sport, "training", { type: "open" }))
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
  program.sportType = draft.sportType;
  program.pbVersion = requiredWorkoutPbVersion(
    draft.sport,
    flattened,
    numberValue(program.pbVersion) ?? 0
  );
  const gradingSystem = draft.sport === "indoorClimb" || draft.sport === "bouldering"
    ? draft.sportOptions?.gradingSystem ?? context.climbSystems[draft.sport] ?? (draft.sport === "bouldering" ? "vScale" : "yds")
    : undefined;
  program.referExercise = {
    ...WORKOUT_SPORT_CAPABILITIES[draft.sport].referExercise,
    ...(objectValue(program.referExercise) ?? {}),
    ...(gradingSystem
      ? { gradeSystem: CLIMB_SYSTEM_IDS[gradingSystem] }
      : {})
  };
  const poolLength = draft.sport === "swim"
    ? draft.sportOptions?.poolLength ?? context.defaultPoolLength
    : undefined;
  if (poolLength) {
    program.poolLength = Math.round(poolLength.value * (poolLength.unit === "yd" ? 0.9144 : 1) * 100);
    program.poolLengthUnit = poolLength.unit === "yd" ? 4 : 2;
    program.poolLengthId = 0;
  }
  if (gradingSystem) program.gradeSystemVersion = numberValue(program.gradeSystemVersion) ?? 1;
  program.simple = false;
  program.exercises = flattened;
  program.exerciseNum = flattened.length;
  program.totalSets = flattened.reduce(
    (total, exercise) => total + (exercise.isGroup ? Number(exercise.sets ?? 1) : 1),
    0
  );
  program.sets = program.totalSets;
  program.distanceDisplayUnit = draft.sport === "swim"
    ? context.distanceUnit === "imperial" ? 4 : 2
    : context.distanceUnit === "imperial" ? 3 : 1;
  return program;
}

export function validateWorkoutDraft(draft: RunWorkoutEditorDraft): WorkoutDraftValidation {
  return validateWorkoutDraftShared(draft);
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
    sport: draft.sport,
    sportType: draft.sportType,
    sportOptions: draft.sportOptions,
    nodes: draft.nodes.map((node) =>
      node.nodeType === "step"
        ? {
            nodeType: node.nodeType,
            kind: node.kind,
            name: node.name.trim(),
            target: node.target,
            intensity: normalizeIntensity(node.intensity),
            exerciseId: node.exerciseId,
            exerciseKind: node.exerciseKind,
            sendOffSeconds: node.sendOffSeconds,
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
              exerciseId: step.exerciseId,
              exerciseKind: step.exerciseKind,
              sendOffSeconds: step.sendOffSeconds,
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
  account: Record<string, unknown>,
  unitSystem?: UnitSystem
): WorkoutEditorContext {
  const zoneData = parseZoneData(account);
  const firstNumber = (...values: unknown[]): number | undefined => {
    for (const value of values) {
      const parsed = numberValue(value);
      if (parsed !== undefined && parsed > 0) return parsed;
    }
    return undefined;
  };
  const maxHr = firstNumber(zoneData.maxHr, zoneData.maxHeartRate, account.maxHr, account.maxHeartRate);
  const restingHr = firstNumber(zoneData.restingHr, zoneData.restHr, account.restingHr, account.restHr);
  const lthrBpm = firstNumber(zoneData.lthr, zoneData.thresholdHr, account.lthr, account.thresholdHr);
  const rawThresholdPace = firstNumber(
    zoneData.thresholdPace,
    zoneData.thresholdPaceSeconds,
    account.thresholdPace,
    account.thresholdPaceSeconds
  );
  const thresholdPaceSecondsPerKm = rawThresholdPace && rawThresholdPace > 10_000
    ? rawThresholdPace / 1_000
    : rawThresholdPace;
  const ftp = firstNumber(zoneData.ftp, zoneData.cycleFtp, account.ftp, account.cycleFtp);
  const criticalPower = firstNumber(
    zoneData.criticalPower,
    zoneData.runCriticalPower,
    account.criticalPower,
    account.runCriticalPower
  );

  type ZoneDefinition = { id: number; label: string; low: number; high: number; preset?: string };
  const zoneArray = (...keys: string[]): unknown[] => {
    for (const key of keys) {
      if (Array.isArray(zoneData[key])) return zoneData[key] as unknown[];
      if (Array.isArray(account[key])) return account[key] as unknown[];
    }
    return [];
  };
  const configuredZones = (
    raw: unknown[],
    defaults: readonly ZoneDefinition[],
    reference?: number,
    reserveRest?: number
  ): WorkoutZone[] => {
    if (!raw.length) {
      return defaults.map((zone, index) => {
        const absolute = reference
          ? reserveRest !== undefined
            ? {
                lowBpm: Math.round(reserveRest + (reference - reserveRest) * zone.low / 100),
                highBpm: Math.round(reserveRest + (reference - reserveRest) * zone.high / 100)
              }
            : {
                lowBpm: Math.round(reference * zone.low / 100),
                highBpm: Math.round(reference * zone.high / 100)
              }
          : {};
        return {
          index: index + 1,
          id: zone.id,
          key: zone.preset ?? String(zone.id),
          label: zone.label,
          lowPercent: zone.low,
          highPercent: zone.high,
          ...absolute
        };
      });
    }
    const parsed = raw.map((item, arrayIndex) => {
      const zone = objectValue(item) ?? {};
      const fallback = defaults[arrayIndex] ?? defaults[defaults.length - 1]!;
      const ratio = numberValue(zone.ratio ?? zone.lowRatio ?? zone.percent ?? zone.lowPercent);
      const directHigh = numberValue(zone.highRatio ?? zone.highPercent);
      const absolute = numberValue(zone.hr ?? zone.value ?? zone.low);
      const lowPercent = ratio !== undefined
        ? Math.round(ratio <= 2 ? ratio * 100 : ratio)
        : reference && absolute !== undefined
          ? Math.round(
              reserveRest !== undefined
                ? ((absolute - reserveRest) / (reference - reserveRest)) * 100
                : (absolute / reference) * 100
            )
          : fallback.low;
      return {
        index: Math.round(numberValue(zone.index) ?? arrayIndex + 1),
        id: Math.round(numberValue(zone.type ?? zone.zoneType ?? zone.id) ?? fallback.id),
        key: String(zone.key ?? fallback.preset ?? fallback.id),
        label: String(zone.label ?? fallback.label),
        lowPercent,
        directHigh: directHigh !== undefined ? Math.round(directHigh <= 2 ? directHigh * 100 : directHigh) : undefined,
        absolute
      };
    }).sort((left, right) => left.index - right.index);
    return parsed.map((zone, index) => {
      const next = parsed[index + 1];
      const highPercent = zone.directHigh ?? (next ? Math.max(zone.lowPercent, next.lowPercent - 1) : defaults[index]?.high ?? zone.lowPercent);
      const lowBpm = zone.absolute ?? (reference
        ? Math.round(reserveRest !== undefined
          ? reserveRest + (reference - reserveRest) * zone.lowPercent / 100
          : reference * zone.lowPercent / 100)
        : undefined);
      const highBpm = reference
        ? Math.round(reserveRest !== undefined
          ? reserveRest + (reference - reserveRest) * highPercent / 100
          : reference * highPercent / 100)
        : undefined;
      return {
        index: zone.index,
        id: zone.id,
        key: zone.key,
        label: zone.label,
        lowPercent: zone.lowPercent,
        highPercent,
        ...(lowBpm !== undefined ? { lowBpm: Math.round(lowBpm) } : {}),
        ...(highBpm !== undefined ? { highBpm } : {})
      };
    });
  };

  const hrDefinitions = (basis: "maxHr" | "reserve" | "lthr"): ZoneDefinition[] =>
    HEART_RATE_PRESETS[basis].map((zone) => ({ ...zone, preset: zone.preset }));
  const paceDefinitions = PACE_PRESETS.map((zone) => ({ ...zone, preset: zone.preset }));
  const ftpDefinitions = FTP_PRESETS.map((zone) => ({ ...zone, preset: zone.preset }));
  const powerDefinitions = RUNNING_POWER_PRESETS.map((zone) => ({ ...zone, preset: zone.preset }));
  const zones: WorkoutEditorContext["zones"] = {
    maxHr: configuredZones(zoneArray("maxHrZone", "maxHrZones", "heartRateZone"), hrDefinitions("maxHr"), maxHr),
    reserve: configuredZones(zoneArray("rhrZone", "hrrZone", "reserveZone"), hrDefinitions("reserve"), maxHr, restingHr),
    lthr: configuredZones(zoneArray("lthrZone", "lthrZones", "thresholdHrZone"), hrDefinitions("lthr"), lthrBpm),
    thresholdPace: configuredZones(zoneArray("thresholdPaceZone", "paceZone"), paceDefinitions),
    ftp: configuredZones(zoneArray("ftpZone", "cyclePowerZone"), ftpDefinitions),
    runningPower: configuredZones(zoneArray("criticalPowerZone", "runPowerZone"), powerDefinitions)
  };
  const lthrZones: WorkoutLthrZone[] = zones.lthr ?? [];
  const selectedUnitSystem = normalizeUnitSystem(unitSystem);
  const imperial = selectedUnitSystem === "imperial";
  const poolLengthUnit = imperial ? "yd" : "m";
  const poolLengthRaw = firstNumber(account.poolLength, zoneData.poolLength);
  const poolLengthMeters = poolLengthRaw
    ? (poolLengthRaw > 200 ? poolLengthRaw / 100 : poolLengthRaw)
    : 25;
  const poolLength = poolLengthMeters / (poolLengthUnit === "yd" ? 0.9144 : 1);
  const climbConfigs = Array.isArray(account.climbConfig)
    ? account.climbConfig
    : Array.isArray(zoneData.climbConfig) ? zoneData.climbConfig : [];
  const climbSystems: WorkoutEditorContext["climbSystems"] = {};
  for (const item of climbConfigs) {
    const config = objectValue(item);
    if (!config) continue;
    const sport = workoutSportFromType(config.sportType);
    const systemId = numberValue(config.gradingSystem ?? config.gradeSystem);
    const system = (Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>)
      .find((key) => CLIMB_SYSTEM_IDS[key] === systemId);
    if ((sport === "indoorClimb" || sport === "bouldering") && system) {
      climbSystems[sport] = system;
    }
  }
  return {
    distanceUnit: imperial ? "imperial" : "metric",
    paceUnit: imperial ? "mi" : "km",
    ...(lthrBpm ? { lthrBpm: Math.round(lthrBpm) } : {}),
    ...(maxHr ? { maxHr: Math.round(maxHr) } : {}),
    ...(restingHr ? { restingHr: Math.round(restingHr) } : {}),
    ...(thresholdPaceSecondsPerKm ? { thresholdPaceSecondsPerKm } : {}),
    ...(ftp ? { ftp: Math.round(ftp) } : {}),
    ...(criticalPower ? { criticalPower: Math.round(criticalPower) } : {}),
    zones,
    lthrZones,
    defaultPoolLength: { value: poolLength, unit: poolLengthUnit },
    climbSystems
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
