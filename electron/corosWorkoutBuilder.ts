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

export type RunTargetType = "time" | "distance";

export interface RunWorkoutStep {
  kind: RunStepKind;
  name?: string;
  target_type?: RunTargetType;
  target_distance_meters?: number;
  target_duration_seconds?: number;
  /** e.g. "5:30/km", "4:05-4:15/km", "8:00/mi" */
  pace?: string;
  intensity_type?: number;
  intensity_value?: number;
  intensity_value_extend?: number;
  intensity_display_unit?: number;
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

const DISTANCE_TARGET_TYPES = new Set([5]);
const TIME_TARGET_TYPES = new Set([2]);

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
  distance: "distance"
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
} {
  const trimmed = pace.trim();
  const isMiles = /\/mi\b/i.test(trimmed);
  const rangeMatch = trimmed.match(
    /(\d+):(\d{2})(?::(\d{2}))?\s*-\s*(\d+):(\d{2})(?::(\d{2}))?\s*\/\s*(km|mi)/i
  );
  const singleMatch = trimmed.match(
    /(\d+):(\d{2})(?::(\d{2}))?\s*\/\s*(km|mi)/i
  );

  const toSecondsPerKm = (min: number, sec: number, hr?: number): number => {
    let total = min * 60 + sec + (hr ?? 0);
    if (isMiles || (singleMatch && singleMatch[4]?.toLowerCase() === "mi")) {
      total = Math.round(total / 1.609344);
    }
    return total;
  };

  if (rangeMatch) {
    const lowMin = Number(rangeMatch[1]);
    const lowSec = Number(rangeMatch[2]);
    const lowHr = rangeMatch[3] ? Number(rangeMatch[3]) : undefined;
    const highMin = Number(rangeMatch[4]);
    const highSec = Number(rangeMatch[5]);
    const highHr = rangeMatch[6] ? Number(rangeMatch[6]) : undefined;
    return {
      intensity_type: 3,
      intensity_value: toSecondsPerKm(highMin, highSec, highHr),
      intensity_value_extend: toSecondsPerKm(lowMin, lowSec, lowHr),
      intensity_display_unit: 2
    };
  }

  if (singleMatch) {
    const min = Number(singleMatch[1]);
    const sec = Number(singleMatch[2]);
    const hr = singleMatch[3] ? Number(singleMatch[3]) : undefined;
    const value = toSecondsPerKm(min, sec, hr);
    return {
      intensity_type: 3,
      intensity_value: value,
      intensity_value_extend: value,
      intensity_display_unit: 2
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
    targetType =
      step.target_distance_meters !== undefined ? "distance" : "time";
  }

  if (targetType === "distance") {
    const meters = step.target_distance_meters ?? step.target_value;
    if (meters === undefined) {
      throw new Error("Distance steps require target_distance_meters.");
    }
    return {
      targetType: 5,
      targetValue: metersToCorosDistance(Number(meters)),
      targetDisplayUnit: step.target_display_unit ?? 3
    };
  }

  const seconds = step.target_duration_seconds ?? step.target_value;
  if (seconds === undefined) {
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

export function buildEasyRun(options: {
  name: string;
  distanceKm: number;
  sportType?: number;
}): Record<string, unknown> {
  const distance = metersToCorosDistance(options.distanceKm * 1000);
  return {
    name: options.name,
    sportType: options.sportType ?? 1,
    estimatedTime: 0,
    estimatedDistance: distance,
    distanceDisplayUnit: 3,
    estimatedType: 6,
    targetType: 5,
    targetValue: distance,
    simple: true,
    access: 1,
    exerciseNum: 0,
    totalSets: 0,
    exercises: [],
    distance
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
        targetDisplayUnit: groupTargetType === 5 ? 3 : 0,
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
    distanceDisplayUnit: 3,
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

  if (repeatSets > 0) {
    return `${repeatSets} set(s)`;
  }
  if (totalMeters > 0) {
    return `${(totalMeters / 1000).toFixed(2)} km`;
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
  const target =
    step.target_distance_meters !== undefined
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

    if (entry.schedule_date) {
      if (!/^\d{8}$/.test(entry.schedule_date)) {
        errors.push(
          `Workout "${entry.name}" schedule_date must be YYYYMMDD.`
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
