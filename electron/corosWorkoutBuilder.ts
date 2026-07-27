/**
 * Build COROS Training Hub workout payloads from AI-friendly step definitions.
 * Ported from reverse-engineered API behavior (see docs/coros-plan-write-api.md).
 */
import type {
  WorkoutEditorContext,
  WorkoutIntensityInput,
  WorkoutSport,
  WorkoutSportOptions
} from "./types";
import {
  CLIMB_SYSTEM_IDS,
  WORKOUT_SPORT_CAPABILITIES,
  encodeCorosIntensity,
  formatWorkoutIntensity,
  formatWorkoutSport,
  requiredWorkoutPbVersion,
  validateWorkoutIntensity,
  validateWorkoutSportOptions,
  workoutTargetsForStep,
  workoutSportType
} from "./workoutCapabilities";

export type RunStepKind =
  | "warmup"
  | "training"
  | "rest"
  | "cooldown"
  | "interval"
  | "sendOff";

// Mirrors COROS's targetType enum (from the traininghub web-app bundle):
// 1=manualEnd ("Open"), 2=time, 5=distance, 6=load ("Training Load").
export type RunTargetType =
  | "time"
  | "distance"
  | "load"
  | "hrRecovery"
  | "open"
  | "reps"
  | "elevationGain"
  | "routes";

export interface RunWorkoutStep {
  kind: RunStepKind;
  name?: string;
  target_type?: RunTargetType;
  target_distance_meters?: number;
  target_duration_seconds?: number;
  /** Training-load target (COROS targetType 6): a raw integer 0–999. */
  target_load?: number;
  /** Rest-only target: finish when heart rate falls to this absolute bpm. */
  target_hr_recovery_bpm?: number;
  target_reps?: number;
  target_elevation_gain_meters?: number;
  target_routes?: number;
  send_off_seconds?: number;
  intensity?: WorkoutIntensityInput;
  exercise_id?: string;
  exercise_name?: string;
  exercise_kind?: number;
  /** e.g. "5:30/km", "4:05-4:15/km", "8:00/mi" */
  pace?: string;
  intensity_type?: number;
  intensity_value?: number;
  intensity_value_extend?: number;
  intensity_display_unit?: number;
  /** COROS stores pace values as seconds/km multiplied by this value (1000). */
  intensity_multiplier?: number;
  intensity_custom?: number;
  hr_type?: number;
  is_intensity_percent?: boolean;
  intensity_percent?: number;
  intensity_percent_extend?: number;
  rest_type?: number;
  rest_value?: number;
  sets?: number;
  overview?: string;
  /** Raw COROS target value alternative */
  target_value?: number;
  target_display_unit?: number;
}

export interface RunWorkoutRepeatGroup {
  repeat: number;
  name?: string;
  steps: RunWorkoutStep[];
  rest_type?: number;
  rest_value?: number;
  overview?: string;
}

export type RunWorkoutStepInput = RunWorkoutStep | RunWorkoutRepeatGroup;

export interface PlanWorkoutEntry {
  /** Unique key within the plan draft */
  key: string;
  name: string;
  /** Omitted legacy drafts default to Run. */
  sport?: WorkoutSport;
  sport_options?: WorkoutSportOptions;
  /** Structured steps; omit for simple distance runs */
  steps?: RunWorkoutStepInput[];
  /** Shortcut for a single-segment easy run (km) */
  distance_km?: number;
  /** YYYYMMDD — when set, workout is scheduled on this date */
  schedule_date?: string;
  sort_no?: number;
  /** Save to COROS workout library (default true) */
  save_to_library?: boolean;
}

export interface CorosTrainingPlanDraft {
  name: string;
  workouts: PlanWorkoutEntry[];
}

export interface PlanDraftPreviewEntry {
  key: string;
  name: string;
  sport?: WorkoutSport;
  scheduleDate?: string;
  volume?: string;
  saveToLibrary: boolean;
  workoutType: string;
  stepsSummary?: string;
}

export interface PlanDraftPreview {
  draftId: string;
  name: string;
  summary: string;
  entries: PlanDraftPreviewEntry[];
  conflicts: string[];
  warnings: string[];
  uploadedAt?: number;
  uploadResult?: {
    workoutsScheduled: number;
    workoutsCreated: number;
  };
}

export interface PlanValidationResult {
  ok: boolean;
  errors: string[];
  draft?: CorosTrainingPlanDraft;
}

/** Data returned by COROS /training/program/calculate before a program is saved. */
export interface CorosWorkoutCalculation {
  planDistance?: string | number;
  planDuration?: number;
  planTrainingLoad?: number;
  planSets?: number;
  planPitch?: number;
  distanceDisplayUnit?: number;
  exerciseBarChart?: Record<string, unknown>[];
}

const DISTANCE_TARGET_TYPES = new Set([5]);
const TIME_TARGET_TYPES = new Set([2]);

// COROS targetDisplayUnit: 1=km, 2=m, 3=mi, 4=yd, 5=ft.
const COROS_DISTANCE_UNIT_KILOMETERS = 1;
const COROS_DISTANCE_UNIT_METERS = 2;
// COROS intensityDisplayUnit: 1=min/km, 2=min/mi.
const COROS_PACE_UNIT_PER_KILOMETER = 1;
const COROS_PACE_UNIT_PER_MILE = 2;
const COROS_PACE_MULTIPLIER = 1000;

const RUN_STEP_KIND_TO_EXERCISE_TYPE: Record<RunStepKind, number> = {
  warmup: 1,
  training: 2,
  interval: 2,
  cooldown: 3,
  rest: 4,
  sendOff: 2
};

const RUN_KIND_ALIASES: Record<string, RunStepKind> = {
  warmup: "warmup",
  "warm-up": "warmup",
  "warm up": "warmup",
  training: "training",
  train: "training",
  interval: "interval",
  rest: "rest",
  cooldown: "cooldown",
  "cool-down": "cooldown",
  "cool down": "cooldown",
  sendoff: "sendOff",
  "send-off": "sendOff",
  "send off": "sendOff"
};

const RUN_TARGET_ALIASES: Record<string, RunTargetType> = {
  time: "time",
  distance: "distance",
  load: "load",
  "training load": "load",
  training_load: "load",
  trainingload: "load",
  hrrecovery: "hrRecovery",
  "hr recovery": "hrRecovery",
  hr_recovery: "hrRecovery",
  open: "open",
  "manual end": "open",
  manual_end: "open",
  manualend: "open",
  reps: "reps",
  repetitions: "reps",
  count: "reps",
  elevationgain: "elevationGain",
  "elevation gain": "elevationGain",
  elevation_gain: "elevationGain",
  cumulativeclimb: "elevationGain",
  routes: "routes"
};

export function metersToCorosDistance(meters: number): number {
  return Math.round(meters * 100);
}

export function corosDistanceToMeters(value: number): number {
  return value / 100;
}

export function parsePace(pace: string): {
  intensity_type: number;
  intensity_value: number;
  intensity_value_extend: number;
  intensity_display_unit: number;
  intensity_multiplier: number;
} {
  const compact = pace.trim().replace(/\s+/g, "");
  const rangeMatch = compact.match(
    /^(\d+):([0-5]\d)(?:\/(km|mi))?-(\d+):([0-5]\d)\/(km|mi)$/i
  );
  const singleMatch = compact.match(/^(\d+):([0-5]\d)\/(km|mi)$/i);

  const toSecondsPerKm = (
    min: number,
    sec: number,
    unit: string
  ): number => {
    const total = min * 60 + sec;
    return unit.toLowerCase() === "mi" ? total / 1.609344 : total;
  };

  if (rangeMatch) {
    const firstUnit = rangeMatch[3]?.toLowerCase();
    const unit = rangeMatch[6]!.toLowerCase();
    if (firstUnit && firstUnit !== unit) {
      throw new Error(`Pace range must use one unit: ${pace}`);
    }
    const first = Math.round(
      toSecondsPerKm(Number(rangeMatch[1]), Number(rangeMatch[2]), unit) *
        COROS_PACE_MULTIPLIER
    );
    const second = Math.round(
      toSecondsPerKm(Number(rangeMatch[4]), Number(rangeMatch[5]), unit) *
        COROS_PACE_MULTIPLIER
    );
    return {
      intensity_type: 3,
      intensity_value: Math.min(first, second),
      intensity_value_extend: Math.max(first, second),
      intensity_display_unit:
        unit === "mi"
          ? COROS_PACE_UNIT_PER_MILE
          : COROS_PACE_UNIT_PER_KILOMETER,
      intensity_multiplier: COROS_PACE_MULTIPLIER
    };
  }

  if (singleMatch) {
    const unit = singleMatch[3]!.toLowerCase();
    const value = Math.round(
      toSecondsPerKm(Number(singleMatch[1]), Number(singleMatch[2]), unit) *
        COROS_PACE_MULTIPLIER
    );
    return {
      intensity_type: 3,
      intensity_value: value,
      intensity_value_extend: value,
      intensity_display_unit:
        unit === "mi"
          ? COROS_PACE_UNIT_PER_MILE
          : COROS_PACE_UNIT_PER_KILOMETER,
      intensity_multiplier: COROS_PACE_MULTIPLIER
    };
  }

  throw new Error(`Could not parse pace string: ${pace}`);
}

function normalizeRunStep(step: RunWorkoutStep): RunWorkoutStep {
  const normalized = { ...step };
  const hasLegacyIntensity = [
    step.pace,
    step.intensity_type,
    step.intensity_value,
    step.intensity_value_extend,
    step.intensity_display_unit,
    step.intensity_multiplier,
    step.intensity_custom,
    step.hr_type,
    step.is_intensity_percent,
    step.intensity_percent,
    step.intensity_percent_extend
  ].some((value) => value !== undefined);
  if (step.intensity && hasLegacyIntensity) {
    throw new Error("A step cannot contain both typed intensity and legacy raw COROS intensity fields.");
  }
  const kindKey = String(normalized.kind ?? "training")
    .trim()
    .toLowerCase();
  if (!(kindKey in RUN_KIND_ALIASES)) {
    throw new Error(`Unsupported run step kind: ${step.kind}`);
  }
  normalized.kind = RUN_KIND_ALIASES[kindKey]!;

  if (normalized.target_type) {
    const targetKey = normalized.target_type.trim().toLowerCase();
    if (!(targetKey in RUN_TARGET_ALIASES)) {
      throw new Error(`Unsupported target_type: ${normalized.target_type}`);
    }
    normalized.target_type = RUN_TARGET_ALIASES[targetKey];
  }

  if (normalized.pace) {
    const paceFields = parsePace(normalized.pace);
    normalized.intensity_type ??= paceFields.intensity_type;
    normalized.intensity_value ??= paceFields.intensity_value;
    normalized.intensity_value_extend ??= paceFields.intensity_value_extend;
    normalized.intensity_display_unit ??= paceFields.intensity_display_unit;
    normalized.intensity_multiplier ??= paceFields.intensity_multiplier;
  }

  return normalized;
}

function resolveRunTarget(step: RunWorkoutStep): {
  targetType: number;
  targetValue: number;
  targetDisplayUnit: number;
} {
  let targetType = step.target_type;
  if (!targetType) {
    if (step.target_distance_meters !== undefined) {
      targetType = "distance";
    } else if (step.target_load !== undefined) {
      targetType = "load";
    } else {
      targetType = "time";
    }
  }

  if (targetType === "distance") {
    const meters = step.target_distance_meters ?? step.target_value;
    if (
      meters === undefined ||
      !Number.isFinite(Number(meters)) ||
      Number(meters) <= 0
    ) {
      throw new Error("Distance steps require target_distance_meters.");
    }
    return {
      targetType: 5,
      targetValue: metersToCorosDistance(Number(meters)),
      targetDisplayUnit:
        step.target_display_unit ?? COROS_DISTANCE_UNIT_METERS
    };
  }

  // "Open" / manual-end segment: run until the athlete presses lap. COROS stores
  // targetType 1 with no value (verified against the traininghub web-app bundle).
  if (targetType === "open") {
    return {
      targetType: 1,
      targetValue: 0,
      targetDisplayUnit: step.target_display_unit ?? 0
    };
  }

  // Training-load target: COROS stores the raw integer as targetValue (no unit
  // scaling — verified in the web-app bundle: targetValue = input, 0–999).
  if (targetType === "load") {
    const load = step.target_load ?? step.target_value;
    if (
      load === undefined ||
      !Number.isFinite(Number(load)) ||
      Number(load) < 0 ||
      Number(load) > 999
    ) {
      throw new Error("Load steps require target_load between 0 and 999.");
    }
    return {
      targetType: 6,
      targetValue: Math.round(Number(load)),
      targetDisplayUnit: step.target_display_unit ?? 0
    };
  }

  if (targetType === "hrRecovery") {
    if (step.kind !== "rest") {
      throw new Error("HR Recovery is only supported on Rest steps.");
    }
    const bpm = step.target_hr_recovery_bpm ?? step.target_value;
    if (
      bpm === undefined ||
      !Number.isFinite(Number(bpm)) ||
      Number(bpm) < 30 ||
      Number(bpm) > 180
    ) {
      throw new Error("HR Recovery steps require a target bpm from 30 to 180.");
    }
    return {
      targetType: 7,
      targetValue: Math.round(Number(bpm)),
      targetDisplayUnit: step.target_display_unit ?? 0
    };
  }

  if (targetType === "reps") {
    const count = step.target_reps ?? step.target_value;
    if (!Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 500) {
      throw new Error("Repetition targets require target_reps from 1 to 500.");
    }
    return { targetType: 3, targetValue: Math.round(Number(count)), targetDisplayUnit: 0 };
  }

  if (targetType === "elevationGain") {
    const meters = step.target_elevation_gain_meters ?? step.target_value;
    if (!Number.isFinite(Number(meters)) || Number(meters) < 20 || Number(meters) > 10_000) {
      throw new Error("Elevation gain targets require 20 to 10,000 meters.");
    }
    return {
      targetType: 8,
      targetValue: metersToCorosDistance(Number(meters)),
      targetDisplayUnit: step.target_display_unit ?? COROS_DISTANCE_UNIT_METERS
    };
  }

  if (targetType === "routes") {
    const count = step.target_routes ?? step.target_value;
    if (!Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 20) {
      throw new Error("Route targets require target_routes from 1 to 20.");
    }
    return { targetType: 9, targetValue: Math.round(Number(count)), targetDisplayUnit: 0 };
  }

  const seconds = step.target_duration_seconds ?? step.target_value;
  if (
    seconds === undefined ||
    !Number.isFinite(Number(seconds)) ||
    Number(seconds) <= 0
  ) {
    throw new Error("Time steps require target_duration_seconds.");
  }
  return {
    targetType: 2,
    targetValue: Math.round(Number(seconds)),
    targetDisplayUnit: step.target_display_unit ?? 0
  };
}

function defaultRunOverview(
  kind: RunStepKind,
  targetType: number,
  sport: WorkoutSport
): string {
  if (sport === "swim") {
    if (kind === "warmup" || kind === "sendOff") return "sid_poolswim_warm_up_dist";
    if (kind === "cooldown" || kind === "rest") return "sid_poolswim_cool_down_dist";
    return "sid_poolswim_dist_default";
  }
  if (sport === "bike") {
    if (kind === "warmup") return "sid_bike_warm_up_dist";
    if (kind === "cooldown" || kind === "rest") return "sid_bike_cool_down_dist";
    return "sid_bike_dist_speed";
  }
  if (sport === "strength") return "sid_strength_training";
  if (kind === "warmup") {
    return DISTANCE_TARGET_TYPES.has(targetType)
      ? "sid_run_warm_up_dist"
      : "sid_run_warm_up";
  }
  if (kind === "cooldown") {
    return DISTANCE_TARGET_TYPES.has(targetType)
      ? "sid_run_cool_down_dist"
      : "sid_run_cool_down";
  }
  if (kind === "rest") {
    return DISTANCE_TARGET_TYPES.has(targetType)
      ? "sid_run_rest_dist"
      : "sid_run_rest";
  }
  return "sid_run_training";
}

function buildRunExercise(
  step: RunWorkoutStep,
  exId: number,
  sortNo: number,
  groupId = "0",
  sport: WorkoutSport = "run",
  context?: WorkoutEditorContext
): { exercise: Record<string, unknown>; distance: number; time: number } {
  const normalized = normalizeRunStep(step);
  const { targetType, targetValue, targetDisplayUnit } =
    resolveRunTarget(normalized);
  const kind = normalized.kind ?? "training";
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  const editorKind = kind === "interval" ? "training" : kind;
  if (!capability.stepKinds.includes(editorKind)) {
    throw new Error(`${formatWorkoutSport(sport)} does not support ${kind} steps.`);
  }
  if (normalized.intensity) {
    const error = validateWorkoutIntensity(
      sport,
      normalized.intensity,
      editorKind,
      normalized.exercise_kind
    );
    if (error) throw new Error(error);
  }
  const targetNameByType: Partial<Record<number, RunTargetType>> = {
    1: "open",
    2: "time",
    3: "reps",
    5: "distance",
    6: "load",
    7: "hrRecovery",
    8: "elevationGain",
    9: "routes"
  };
  const resolvedTarget = targetNameByType[targetType];
  const allowedTargets = workoutTargetsForStep(sport, editorKind, normalized.exercise_kind);
  if (resolvedTarget && !allowedTargets.includes(resolvedTarget)) {
    throw new Error(`${formatWorkoutSport(sport)} ${kind} steps do not support ${resolvedTarget}.`);
  }
  if (
    (sport === "strength" || (sport === "hyrox" && normalized.exercise_kind !== undefined)) &&
    kind === "training" &&
    !normalized.exercise_id &&
    !normalized.exercise_name
  ) {
    throw new Error(`${capability.label} training steps require exercise_id or exercise_name.`);
  }
  const rawIntensity = normalized.intensity
    ? encodeCorosIntensity(normalized.intensity, context)
    : {
        intensityType: normalized.intensity_type ?? 0,
        intensityValue: normalized.intensity_value ?? 0,
        intensityValueExtend: normalized.intensity_value_extend ?? 0,
        intensityMultiplier: normalized.intensity_multiplier ?? 0,
        intensityDisplayUnit: normalized.intensity_display_unit ?? 0,
        hrType: normalized.hr_type ?? (normalized.intensity_type === 2 ? 2 : 0),
        isIntensityPercent: normalized.is_intensity_percent ?? false,
        intensityCustom: normalized.intensity_custom ?? 0,
        intensityPercent: normalized.intensity_percent ?? 0,
        intensityPercentExtend: normalized.intensity_percent_extend ?? 0
      };
  const functionalExercise = sport === "strength" ||
    (sport === "hyrox" && kind === "training" && Boolean(normalized.exercise_kind));

  const exercise: Record<string, unknown> = {
    id: exId,
    access: 0,
    createTimestamp: 0,
    defaultOrder: sortNo,
    deleted: 0,
    equipment: [1],
    isDefaultAdd: kind === "training" || kind === "interval" ? 1 : 0,
    part: [0],
    sourceId: "0",
    sourceUrl: "",
    status: 1,
    userId: 0,
    videoUrl: "",
    name:
      normalized.name ??
      normalized.exercise_name ??
      kind.replace("warmup", "Warm-up").replace("cooldown", "Cool-down"),
    exerciseType: RUN_STEP_KIND_TO_EXERCISE_TYPE[kind],
    sportType: capability.sportType,
    subType: kind === "sendOff"
      ? 1
      : sport === "hyrox" && kind === "training" && normalized.exercise_kind
        ? 2
        : 0,
    ...rawIntensity,
    targetType,
    targetValue,
    targetDisplayUnit,
    sets: normalized.sets ?? 1,
    sortNo,
    restType: normalized.rest_type ?? (functionalExercise ? 1 : 3),
    restValue: normalized.rest_value ?? (functionalExercise ? 60 : 0),
    groupId,
    isGroup: false,
    originId: "0",
    overview: normalized.overview ?? (functionalExercise
      ? "sid_strength_training"
      : defaultRunOverview(kind, targetType, sport)),
    ...(normalized.exercise_id ? { originId: normalized.exercise_id } : {}),
    ...(normalized.exercise_kind !== undefined
      ? { exerciseKind: normalized.exercise_kind }
      : {}),
    ...(sport === "hyrox" && kind === "training" && normalized.exercise_kind
      ? { hyroxTrainingMode: "strength" }
      : {}),
    ...(kind === "sendOff" || normalized.send_off_seconds !== undefined
      ? { packageTime: Math.round(normalized.send_off_seconds ?? 120) }
      : {})
  };

  return {
    exercise,
    distance: DISTANCE_TARGET_TYPES.has(targetType) ? targetValue : 0,
    time: TIME_TARGET_TYPES.has(targetType) ? targetValue : 0
  };
}

// COROS's default "run training" exercise template. These constants are lifted
// verbatim from the payload the official web app sends for a simple distance run
// (captured in t.coros.com.har → /training/schedule/update). A distance run must
// carry ONE real exercise like this — with exercises: [] COROS zeroes the stored
// program.distance and only keeps the target in program.targetValue, so the
// calendar reads back Volume "--".
const RUN_TRAINING_EXERCISE_ORIGIN_ID = "426109589008859136";
const RUN_TRAINING_EXERCISE_SOURCE_ID = "425868113867882497";
const RUN_TRAINING_EXERCISE_SOURCE_URL =
  "https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/e3611f19b15648338b0f229b2b1b1015.jpg";

export function buildEasyRun(options: {
  name: string;
  distanceKm: number;
  sportType?: number;
}): Record<string, unknown> {
  const distance = metersToCorosDistance(options.distanceKm * 1000);
  const sportType = options.sportType ?? 1;

  const exercise: Record<string, unknown> = {
    access: 0,
    createTimestamp: 1587381919,
    defaultOrder: 2,
    equipment: [1],
    exerciseType: 2,
    groupId: "",
    hrType: 0,
    id: 1,
    intensityCustom: 0,
    intensityDisplayUnit: 0,
    intensityMultiplier: 0,
    intensityPercent: 0,
    intensityPercentExtend: 0,
    intensityType: 0,
    intensityValue: 0,
    intensityValueExtend: 0,
    isDefaultAdd: 1,
    isGroup: false,
    isIntensityPercent: true,
    name: "T3001",
    originId: RUN_TRAINING_EXERCISE_ORIGIN_ID,
    overview: "sid_run_training",
    part: [0],
    restType: 3,
    restValue: 0,
    sets: 1,
    sortNo: 2,
    sourceId: "0",
    sourceUrl: "",
    sportType,
    subType: 0,
    targetDisplayUnit: 1,
    targetType: 5,
    targetValue: distance,
    userId: 0,
    videoUrl: ""
  };

  const barChartEntry: Record<string, unknown> = {
    exerciseId: "1",
    exerciseType: 2,
    height: 5,
    name: "T3001",
    targetType: 5,
    targetValue: distance,
    value: distance,
    width: 100,
    widthFill: 0
  };

  return {
    id: "0",
    name: options.name,
    sportType,
    subType: 0,
    totalSets: 1,
    sets: 1,
    // Program-level target fields are intentionally empty strings — the target
    // lives on the exercise. This matches the web app byte-for-byte.
    exerciseNum: "",
    targetType: "",
    targetValue: "",
    version: 0,
    simple: true,
    exercises: [exercise],
    access: 1,
    essence: 0,
    estimatedTime: 0,
    originEssence: 0,
    overview: "",
    type: 0,
    unit: 0,
    pbVersion: 2,
    sourceId: RUN_TRAINING_EXERCISE_SOURCE_ID,
    sourceUrl: RUN_TRAINING_EXERCISE_SOURCE_URL,
    referExercise: { intensityType: 0, hrType: 0, valueType: 0 },
    poolLengthId: 1,
    poolLength: 2500,
    poolLengthUnit: 2,
    distance: distance.toFixed(2),
    duration: 0,
    trainingLoad: 0,
    pitch: 0,
    exerciseBarChart: [barChartEntry],
    distanceDisplayUnit: 1
  };
}

export function buildWorkoutPayload(
  name: string,
  steps: RunWorkoutStepInput[],
  sport: WorkoutSport = "run",
  sportOptions?: WorkoutSportOptions,
  context?: WorkoutEditorContext
): Record<string, unknown> {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  if (!capability) throw new Error(`Unsupported workout sport "${String(sport)}".`);
  const sportOptionErrors = validateWorkoutSportOptions(sport, sportOptions);
  if (sportOptionErrors.length) throw new Error(sportOptionErrors.join(" "));
  const gradingSystem = sport === "indoorClimb" || sport === "bouldering"
    ? sportOptions?.gradingSystem ?? context?.climbSystems[sport] ?? (sport === "bouldering" ? "vScale" : "yds")
    : undefined;
  const exercises: Record<string, unknown>[] = [];
  let topIndex = 0;
  let exId = 0;
  let totalDistance = 0;
  let totalTime = 0;

  for (const step of steps) {
    if ("repeat" in step) {
      topIndex += 1;
      exId += 1;
      const groupSort = 16777216 * topIndex;
      const groupId = exId;
      const repeatCount = step.repeat;
      const subSteps = step.steps ?? [];
      if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 99) {
        throw new Error("Repeat groups require repeat between 1 and 99.");
      }
      if (subSteps.length === 0) {
        throw new Error("Repeat groups require at least one step.");
      }
      let groupDistance = 0;
      let groupTime = 0;
      const builtSubSteps: Record<string, unknown>[] = [];

      for (let j = 0; j < subSteps.length; j++) {
        exId += 1;
        const built = buildRunExercise(
          subSteps[j]!,
          exId,
          groupSort + 65536 * (j + 1),
          String(groupId),
          sport,
          context
        );
        builtSubSteps.push(built.exercise);
        groupDistance += built.distance;
        groupTime += built.time;
      }

      const groupTargetType = groupDistance > 0 ? 5 : 2;
      const groupTargetValue = groupDistance > 0 ? groupDistance : groupTime;

      exercises.push({
        id: groupId,
        name: step.name ?? "Interval Group",
        exerciseType: 0,
        sportType: capability.sportType,
        intensityType: 0,
        intensityValue: 0,
        targetType: groupTargetType,
        targetValue: groupTargetValue,
        targetDisplayUnit:
          groupTargetType === 5 ? COROS_DISTANCE_UNIT_METERS : 0,
        sets: repeatCount,
        sortNo: groupSort,
        restType: step.rest_type ?? 3,
        restValue: step.rest_value ?? 0,
        groupId: "0",
        isGroup: true,
        originId: "0",
        overview: step.overview ?? defaultRunOverview("training", groupTargetType, sport)
      });
      exercises.push(...builtSubSteps);
      totalDistance += groupDistance * repeatCount;
      totalTime += groupTime * repeatCount;
    } else {
      topIndex += 1;
      exId += 1;
      const built = buildRunExercise(
        step,
        exId,
        16777216 * topIndex,
        "0",
        sport,
        context
      );
      exercises.push(built.exercise);
      totalDistance += built.distance;
      totalTime += built.time;
    }
  }

  return {
    id: "0",
    idInPlan: "0",
    authorId: "0",
    userId: "0",
    createTimestamp: 0,
    deleted: 0,
    status: 1,
    version: 0,
    name,
    sportType: capability.sportType,
    subType: 65535,
    pbVersion: requiredWorkoutPbVersion(sport, exercises),
    referExercise: {
      ...capability.referExercise,
      ...(gradingSystem
        ? { gradeSystem: CLIMB_SYSTEM_IDS[gradingSystem] }
        : {})
    },
    ...(sport === "swim"
      ? {
          poolLengthId: 0,
          poolLength: Math.round(
            (sportOptions?.poolLength?.value ?? context?.defaultPoolLength.value ?? 25) *
            ((sportOptions?.poolLength?.unit ?? context?.defaultPoolLength.unit ?? "m") === "yd" ? 0.9144 : 1) *
            100
          ),
          poolLengthUnit: (sportOptions?.poolLength?.unit ?? context?.defaultPoolLength.unit ?? "m") === "yd" ? 4 : 2
        }
      : {}),
    ...((sport === "indoorClimb" || sport === "bouldering")
      ? { gradeSystemVersion: 1 }
      : {}),
    estimatedTime: totalTime,
    estimatedDistance: totalDistance,
    distanceDisplayUnit: COROS_DISTANCE_UNIT_KILOMETERS,
    estimatedType: totalDistance > 0 ? 6 : 0,
    targetType: totalDistance > 0 ? 5 : 2,
    targetValue: totalDistance > 0 ? totalDistance : totalTime,
    simple: false,
    access: 1,
    essence: 0,
    originEssence: 0,
    overview: "",
    type: 0,
    unit: 0,
    exerciseNum: exercises.length,
    totalSets: exercises.length,
    exercises
  };
}

/** @deprecated Prefer buildWorkoutPayload with an explicit sport. */
export function buildRunWorkoutPayload(
  name: string,
  steps: RunWorkoutStepInput[]
): Record<string, unknown> {
  return buildWorkoutPayload(name, steps, "run");
}

export function buildIntervalWorkout(options: {
  name: string;
  warmup?: RunWorkoutStep;
  repeats: number;
  work: RunWorkoutStep;
  rest: RunWorkoutStep;
  cooldown?: RunWorkoutStep;
}): Record<string, unknown> {
  const steps: RunWorkoutStepInput[] = [];
  if (options.warmup) {
    steps.push({ ...options.warmup, kind: "warmup" });
  }
  steps.push({
    repeat: options.repeats,
    name: "Main Set",
    steps: [
      { ...options.work, kind: options.work.kind ?? "training" },
      { ...options.rest, kind: "rest" }
    ]
  });
  if (options.cooldown) {
    steps.push({ ...options.cooldown, kind: "cooldown" });
  }
  return buildRunWorkoutPayload(options.name, steps);
}

export function buildWorkoutPayloadFromEntry(
  entry: PlanWorkoutEntry,
  context?: WorkoutEditorContext
): Record<string, unknown> {
  const sport = entry.sport ?? "run";
  if (entry.steps && entry.steps.length > 0) {
    return buildWorkoutPayload(entry.name, entry.steps, sport, entry.sport_options, context);
  }
  if (entry.distance_km !== undefined && entry.distance_km > 0) {
    if (sport !== "run" && sport !== "trailRun") {
      throw new Error(`distance_km shorthand is only available for Run and Trail Run, not ${formatWorkoutSport(sport)}.`);
    }
    return buildEasyRun({
      name: entry.name,
      distanceKm: entry.distance_km,
      sportType: workoutSportType(sport)
    });
  }
  throw new Error(
    `Workout "${entry.name}" needs steps or distance_km.`
  );
}

function formatScheduleDate(day: string): string {
  if (!/^\d{8}$/.test(day)) {
    return day;
  }
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

function isValidScheduleDay(day: string): boolean {
  if (!/^\d{8}$/.test(day)) {
    return false;
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6));
  const date = Number(day.slice(6, 8));
  const parsed = new Date(year, month - 1, date);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === date
  );
}

function formatEntryVolume(entry: PlanWorkoutEntry): string | undefined {
  if (entry.distance_km !== undefined && entry.distance_km > 0) {
    return `${entry.distance_km.toFixed(2)} km`;
  }
  if (!entry.steps || entry.steps.length === 0) {
    return undefined;
  }
  let totalMeters = 0;
  let repeatSets = 0;

  for (const step of entry.steps) {
    if ("repeat" in step) {
      repeatSets += step.repeat;
      for (const sub of step.steps) {
        if (sub.target_distance_meters) {
          totalMeters += sub.target_distance_meters * step.repeat;
        }
      }
    } else if (step.target_distance_meters) {
      totalMeters += step.target_distance_meters;
    }
  }

  if (totalMeters > 0) {
    return `${(totalMeters / 1000).toFixed(2)} km`;
  }
  if (repeatSets > 0) {
    return `${repeatSets} set(s)`;
  }
  return undefined;
}

function inferWorkoutType(entry: PlanWorkoutEntry): string {
  if (entry.steps?.some((step) => "repeat" in step)) {
    return "intervals";
  }
  if (entry.distance_km !== undefined) {
    return "easy";
  }
  return "structured";
}

export function formatEntryStepsSummary(entry: PlanWorkoutEntry): string | undefined {
  if (!entry.steps || entry.steps.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  for (const step of entry.steps) {
    if ("repeat" in step) {
      const subParts = step.steps.map((sub) => formatRunStepSummary(sub)).filter(Boolean);
      parts.push(`${step.repeat}x (${subParts.join(", ")})`);
      continue;
    }
    const summary = formatRunStepSummary(step);
    if (summary) {
      parts.push(summary);
    }
  }

  return parts.length > 0 ? parts.join(" → ") : undefined;
}

function formatRunStepSummary(step: RunWorkoutStep): string | undefined {
  const kind = step.kind ?? "training";
  const targetType =
    step.target_type ??
    (step.target_distance_meters !== undefined
      ? "distance"
      : step.target_load !== undefined
        ? "load"
        : "time");
  const target =
    targetType === "open"
      ? "open"
      : targetType === "load" && step.target_load !== undefined
        ? `load ${step.target_load}`
        : targetType === "reps" && step.target_reps !== undefined
          ? `${step.target_reps} reps`
          : targetType === "routes" && step.target_routes !== undefined
            ? `${step.target_routes} routes`
            : targetType === "elevationGain" && step.target_elevation_gain_meters !== undefined
              ? `${step.target_elevation_gain_meters} m gain`
        : step.target_distance_meters !== undefined
          ? `${(step.target_distance_meters / 1000).toFixed(1)} km`
          : step.target_duration_seconds !== undefined
            ? `${Math.round(step.target_duration_seconds / 60)} min`
            : undefined;
  const intensity = step.intensity
    ? `@ ${formatWorkoutIntensity(step.intensity)}`
    : step.pace ? `@ ${step.pace}` : undefined;
  return [kind, target, intensity].filter(Boolean).join(" ");
}

export function validatePlanDraft(
  draft: CorosTrainingPlanDraft,
  options?: { todayDay?: string; existingSchedule?: Map<string, string[]> }
): PlanValidationResult {
  const errors: string[] = [];
  const todayDay =
    options?.todayDay ?? formatScheduleDay(new Date());

  if (!draft.name?.trim()) {
    errors.push("Plan name is required.");
  }
  if (!Array.isArray(draft.workouts) || draft.workouts.length === 0) {
    errors.push("At least one workout is required.");
  }

  const keys = new Set<string>();
  for (const entry of draft.workouts ?? []) {
    const sport = entry.sport ?? "run";
    if (!(sport in WORKOUT_SPORT_CAPABILITIES)) {
      errors.push(`Workout "${entry.name || entry.key}" has unsupported sport "${String(entry.sport)}".`);
      continue;
    }
    if (!entry.key?.trim()) {
      errors.push("Each workout needs a unique key.");
      continue;
    }
    if (keys.has(entry.key)) {
      errors.push(`Duplicate workout key: ${entry.key}`);
    }
    keys.add(entry.key);

    if (!entry.name?.trim()) {
      errors.push(`Workout ${entry.key} needs a name.`);
    }

    const hasSteps = Array.isArray(entry.steps) && entry.steps.length > 0;
    const hasDistance = entry.distance_km !== undefined && entry.distance_km > 0;
    if (!hasSteps && !hasDistance) {
      errors.push(
        `Workout "${entry.name || entry.key}" needs steps or distance_km.`
      );
    }
    if (hasSteps && hasDistance) {
      errors.push(
        `Workout "${entry.name || entry.key}" must use steps or distance_km, not both.`
      );
    }
    if (!entry.schedule_date && entry.save_to_library === false) {
      errors.push(
        `Workout "${entry.name || entry.key}" must be scheduled or saved to the library.`
      );
    }
    if (
      entry.sort_no !== undefined &&
      (!Number.isInteger(entry.sort_no) || entry.sort_no < 1)
    ) {
      errors.push(`Workout "${entry.name}" sort_no must be a positive integer.`);
    }

    if (entry.schedule_date) {
      if (!isValidScheduleDay(entry.schedule_date)) {
        errors.push(
          `Workout "${entry.name}" schedule_date must be a valid YYYYMMDD date.`
        );
      } else if (entry.schedule_date < todayDay) {
        errors.push(
          `Workout "${entry.name}" cannot be scheduled in the past (${entry.schedule_date}).`
        );
      }
    }

    if (hasSteps) {
      try {
        buildWorkoutPayload(entry.name, entry.steps!, sport, entry.sport_options);
      } catch (caught) {
        errors.push(
          `Workout "${entry.name}": ${caught instanceof Error ? caught.message : String(caught)}`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: [], draft };
}

export function formatScheduleDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function buildPlanPreview(
  draftId: string,
  draft: CorosTrainingPlanDraft,
  options?: {
    existingSchedule?: Map<string, string[]>;
    scheduleConflicts?: string[];
  }
): PlanDraftPreview {
  const entries: PlanDraftPreviewEntry[] = draft.workouts.map((entry) => ({
    key: entry.key,
    name: entry.name,
    sport: entry.sport ?? "run",
    scheduleDate: entry.schedule_date
      ? formatScheduleDate(entry.schedule_date)
      : undefined,
    volume: formatEntryVolume(entry),
    saveToLibrary: entry.save_to_library !== false,
    workoutType: inferWorkoutType(entry),
    stepsSummary: formatEntryStepsSummary(entry)
  }));

  const scheduled = draft.workouts.filter((entry) => entry.schedule_date);
  const libraryOnly = draft.workouts.filter(
    (entry) => !entry.schedule_date && entry.save_to_library !== false
  );

  const summaryParts = [
    `${draft.workouts.length} workout${draft.workouts.length === 1 ? "" : "s"}`,
    scheduled.length > 0
      ? `${scheduled.length} scheduled`
      : "none scheduled",
    libraryOnly.length > 0
      ? `${libraryOnly.length} library-only`
      : undefined
  ].filter(Boolean);

  const warnings: string[] = [];
  if (scheduled.length === 0) {
    warnings.push(
      "No workouts have schedule_date set — they will only be saved to your COROS library."
    );
  }

  return {
    draftId,
    name: draft.name,
    summary: summaryParts.join(" · "),
    entries,
    conflicts: options?.scheduleConflicts ?? [],
    warnings
  };
}

/**
 * Apply the server-computed fields that the official Training Hub writes back
 * into a program before calling /training/program/add or /schedule/update.
 */
export function applyWorkoutCalculation(
  workout: Record<string, unknown>,
  calculation: CorosWorkoutCalculation
): Record<string, unknown> {
  const payload = structuredClone(workout);

  if (calculation.planDistance !== undefined) {
    payload.distance = calculation.planDistance;
  }
  if (calculation.planDuration !== undefined) {
    payload.duration = calculation.planDuration;
  }
  if (calculation.planTrainingLoad !== undefined) {
    payload.trainingLoad = calculation.planTrainingLoad;
  }
  if (calculation.planSets !== undefined) {
    payload.sets = calculation.planSets;
    payload.totalSets = calculation.planSets;
  }
  if (calculation.planPitch !== undefined) {
    payload.pitch = calculation.planPitch;
  }
  if (calculation.distanceDisplayUnit !== undefined) {
    payload.distanceDisplayUnit = calculation.distanceDisplayUnit;
  }
  if (Array.isArray(calculation.exerciseBarChart)) {
    payload.exerciseBarChart = structuredClone(calculation.exerciseBarChart);
  }

  return payload;
}

export function resetProgramForCreate(
  workout: Record<string, unknown>
): Record<string, unknown> {
  const payload = structuredClone(workout);
  delete payload.exerciseBarChart;
  delete payload.officalConfig;
  payload.id = "0";
  payload.idInPlan = "0";
  payload.authorId = "0";
  payload.userId = "0";
  payload.createTimestamp = 0;
  payload.deleted = 0;
  payload.status = 1;
  payload.version = 0;
  payload.star = 0;
  payload.nickname = "";

  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const idMap = new Map<string, string>();

  exercises.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const ex = item as Record<string, unknown>;
    const oldId = String(ex.id ?? index + 1);
    const newId = String(index + 1);
    idMap.set(oldId, newId);
    ex.id = newId;
    ex.programId = "0";
    ex.userId = 0;
    ex.createTimestamp = 0;
    ex.deleted = 0;
    ex.status = 1;
    ex.defaultOrder = index;
  });

  for (const item of exercises) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const ex = item as Record<string, unknown>;
    const groupId = String(ex.groupId ?? "0");
    ex.groupId = idMap.get(groupId) ?? groupId;
  }

  payload.exercises = exercises;
  return payload;
}
