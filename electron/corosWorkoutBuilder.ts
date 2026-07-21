/**
 * Build COROS Training Hub workout payloads from AI-friendly step definitions.
 * Ported from reverse-engineered API behavior (see docs/coros-plan-write-api.md).
 */

export type RunStepKind =
  | "warmup"
  | "training"
  | "rest"
  | "cooldown"
  | "interval";

// Mirrors COROS's targetType enum (from the traininghub web-app bundle):
// 1=manualEnd ("Open"), 2=time, 5=distance, 6=load ("Training Load").
export type RunTargetType =
  | "time"
  | "distance"
  | "load"
  | "hrRecovery"
  | "open";

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
  /** e.g. "5:30/km", "4:05-4:15/km", "8:00/mi" */
  pace?: string;
  intensity_type?: number;
  intensity_value?: number;
  intensity_value_extend?: number;
  intensity_display_unit?: number;
  /** COROS stores pace values as seconds/km multiplied by this value (1000). */
  intensity_multiplier?: number;
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
  rest: 4
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
  "cool down": "cooldown"
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
  manualend: "open"
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
      Number(bpm) > 250
    ) {
      throw new Error("HR Recovery steps require a target bpm from 30 to 250.");
    }
    return {
      targetType: 7,
      targetValue: Math.round(Number(bpm)),
      targetDisplayUnit: step.target_display_unit ?? 0
    };
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

function defaultRunOverview(kind: RunStepKind, targetType: number): string {
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
  groupId = "0"
): { exercise: Record<string, unknown>; distance: number; time: number } {
  const normalized = normalizeRunStep(step);
  const { targetType, targetValue, targetDisplayUnit } =
    resolveRunTarget(normalized);
  const kind = normalized.kind ?? "training";

  const exercise: Record<string, unknown> = {
    id: exId,
    name:
      normalized.name ??
      kind.replace("warmup", "Warm-up").replace("cooldown", "Cool-down"),
    exerciseType: RUN_STEP_KIND_TO_EXERCISE_TYPE[kind],
    sportType: 1,
    intensityType: normalized.intensity_type ?? 0,
    intensityValue: normalized.intensity_value ?? 0,
    intensityValueExtend: normalized.intensity_value_extend ?? 0,
    intensityMultiplier: normalized.intensity_multiplier ?? 0,
    targetType,
    targetValue,
    targetDisplayUnit,
    intensityDisplayUnit: normalized.intensity_display_unit ?? 0,
    sets: normalized.sets ?? 1,
    sortNo,
    restType: normalized.rest_type ?? 3,
    restValue: normalized.rest_value ?? 0,
    groupId,
    isGroup: false,
    originId: "0",
    overview: normalized.overview ?? defaultRunOverview(kind, targetType),
    hrType: normalized.hr_type ?? 3,
    isIntensityPercent: normalized.is_intensity_percent ?? false
  };

  if (normalized.intensity_percent !== undefined) {
    exercise.intensityPercent = normalized.intensity_percent;
  }
  if (normalized.intensity_percent_extend !== undefined) {
    exercise.intensityPercentExtend = normalized.intensity_percent_extend;
  }

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

export function buildRunWorkoutPayload(
  name: string,
  steps: RunWorkoutStepInput[]
): Record<string, unknown> {
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
          String(groupId)
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
        sportType: 1,
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
        overview: step.overview ?? "sid_run_training"
      });
      exercises.push(...builtSubSteps);
      totalDistance += groupDistance * repeatCount;
      totalTime += groupTime * repeatCount;
    } else {
      topIndex += 1;
      exId += 1;
      const built = buildRunExercise(step, exId, 16777216 * topIndex);
      exercises.push(built.exercise);
      totalDistance += built.distance;
      totalTime += built.time;
    }
  }

  return {
    name,
    sportType: 1,
    estimatedTime: totalTime,
    estimatedDistance: totalDistance,
    distanceDisplayUnit: COROS_DISTANCE_UNIT_KILOMETERS,
    estimatedType: totalDistance > 0 ? 6 : 0,
    targetType: totalDistance > 0 ? 5 : 2,
    targetValue: totalDistance > 0 ? totalDistance : totalTime,
    simple: false,
    access: 1,
    exerciseNum: exercises.length,
    totalSets: exercises.length,
    exercises
  };
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
  entry: PlanWorkoutEntry
): Record<string, unknown> {
  if (entry.steps && entry.steps.length > 0) {
    return buildRunWorkoutPayload(entry.name, entry.steps);
  }
  if (entry.distance_km !== undefined && entry.distance_km > 0) {
    return buildEasyRun({ name: entry.name, distanceKm: entry.distance_km });
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
        : step.target_distance_meters !== undefined
          ? `${(step.target_distance_meters / 1000).toFixed(1)} km`
          : step.target_duration_seconds !== undefined
            ? `${Math.round(step.target_duration_seconds / 60)} min`
            : undefined;
  const pace = step.pace ? `@ ${step.pace}` : undefined;
  return [kind, target, pace].filter(Boolean).join(" ");
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
        buildRunWorkoutPayload(entry.name, entry.steps!);
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
