import type {
  TrainingHubScheduledExercise,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "../../electron/types";
import {
  POUNDS_PER_KILOGRAM,
  formatDistanceValue,
  formatElevationValue,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  speedUnit,
  weightUnit
} from "../units/units";
import {
  decodeCorosIntensity,
  formatWorkoutIntensity
} from "../../electron/workoutCapabilities";

/**
 * View-model builder for the scheduled-workout detail panel. Prefers the raw
 * COROS program payload (step kinds, repeat groups, pace/HR intensity) and
 * falls back to the pre-parsed exercise list when the payload is missing.
 */

export type ScheduledStepKind =
  | "warmup"
  | "training"
  | "rest"
  | "cooldown"
  | "sendOff";

export interface ScheduledStepView {
  id: string;
  kind: ScheduledStepKind;
  name: string;
  /** Compact target text — "800 m", "10:00", "12 reps", "Open". */
  targetLabel?: string;
  /** Intensity text decoded from the raw payload — "140–150 bpm", "5:00–5:10/km". */
  intensityLabel?: string;
  /** Bar-chart magnitude: meters for distance targets, seconds for time. */
  magnitude?: number;
  magnitudeType?: "distance" | "time";
  /** Strength metadata. */
  sets?: number;
  reps?: number;
  weight?: number;
  weightUnit?: "kg" | "lb";
}

export interface ScheduledRepeatView {
  type: "repeat";
  id: string;
  name: string;
  repeat: number;
  steps: ScheduledStepView[];
  /** Aggregate magnitude of ONE repetition (dominant unit across children). */
  magnitude?: number;
  magnitudeType?: "distance" | "time";
}

export type ScheduledNodeView =
  | { type: "step"; step: ScheduledStepView }
  | ScheduledRepeatView;

export interface ScheduledStructureTotals {
  distanceMeters?: number;
  durationSeconds?: number;
  /** Leaf steps (repeat children counted once each). */
  stepCount: number;
  repeatGroups: number;
}

export interface ScheduledStructureView {
  nodes: ScheduledNodeView[];
  totals: ScheduledStructureTotals;
  /** Where the structure came from — raw COROS payload or parsed exercises. */
  source: "raw" | "parsed";
}

const EXERCISE_TYPE_TO_KIND: Record<number, ScheduledStepKind> = {
  1: "warmup",
  2: "training",
  3: "cooldown",
  4: "rest",
  5: "sendOff"
};

const FRIENDLY_KIND_NAME: Record<ScheduledStepKind, string> = {
  warmup: "Warm Up",
  training: "Training",
  rest: "Rest",
  cooldown: "Cool Down",
  sendOff: "Send-off"
};

function finiteNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function formatStepTimeLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatStepDistanceLabel(
  meters: number,
  unitSystem: UnitSystem,
  swim = false
): string {
  if (unitSystem === "imperial" || swim) {
    return formatDistanceValue(meters, unitSystem, {
      swim,
      digits: swim ? 0 : meters >= 16_093.44 ? 1 : 2
    });
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(km >= 10 ? 1 : 2)} km`;
}

interface ParsedTarget {
  label?: string;
  magnitude?: number;
  magnitudeType?: "distance" | "time";
}

/** Mirror of the editor's parseTarget — COROS schedule distances are centimeters. */
function parseRawTarget(
  exercise: Record<string, unknown>,
  kind: ScheduledStepKind,
  unitSystem: UnitSystem,
  swim: boolean
): ParsedTarget {
  const targetType = finiteNumber(exercise.targetType);
  const targetValue = finiteNumber(exercise.targetValue) ?? 0;

  switch (targetType) {
    case 1:
      return { label: "Open" };
    case 2:
      return targetValue > 0
        ? {
            label: formatStepTimeLabel(targetValue),
            magnitude: targetValue,
            magnitudeType: "time"
          }
        : { label: "Open" };
    case 3:
      return { label: `${Math.round(targetValue)} reps` };
    case 5: {
      const meters = targetValue / 100;
      return meters > 0
        ? {
            label: formatStepDistanceLabel(meters, unitSystem, swim),
            magnitude: meters,
            magnitudeType: "distance"
          }
        : { label: "Open" };
    }
    case 6:
      return { label: `${Math.round(targetValue)} TL` };
    case 7:
      return kind === "rest"
        ? { label: `Until ${Math.round(targetValue)} bpm` }
        : { label: `${Math.round(targetValue)} bpm` };
    case 8:
      return {
        label: `${formatElevationValue(targetValue / 100, unitSystem, "0")} gain`
      };
    case 9:
      return { label: `${Math.round(targetValue)} routes` };
    default:
      return {};
  }
}

interface DecodedIntensity {
  label?: string;
  weightValue?: number;
  weightUnit?: "kg" | "lb";
}

function decodeIntensity(
  exercise: Record<string, unknown>,
  unitSystem: UnitSystem
): DecodedIntensity {
  try {
    const { intensity } = decodeCorosIntensity(exercise);
    if (intensity.type === "none") {
      return {};
    }
    if (intensity.type === "pace" || intensity.type === "effortPace") {
      const formatted = formatWorkoutIntensity({
        ...intensity,
        displayUnit: unitSystem === "imperial" ? "mi" : "km"
      });
      return { label: formatted === "Not set" ? undefined : formatted };
    }
    if (intensity.type === "speed") {
      const lowKmh = intensity.unit === "mph" ? intensity.low * 1.609344 : intensity.low;
      const highKmh = intensity.unit === "mph" ? intensity.high * 1.609344 : intensity.high;
      const formatted = formatWorkoutIntensity({
        ...intensity,
        low: kmhToDisplaySpeed(lowKmh, unitSystem),
        high: kmhToDisplaySpeed(highKmh, unitSystem),
        unit: speedUnit(unitSystem)
      });
      return { label: formatted === "Not set" ? undefined : formatted };
    }
    if (intensity.type === "weight" && intensity.mode === "weight") {
      const weightValue = intensity.unit === "lb"
        ? intensity.value / POUNDS_PER_KILOGRAM
        : intensity.value;
      const displayWeight = kilogramsToDisplayWeight(weightValue, unitSystem);
      const formatted = formatWorkoutIntensity({
        ...intensity,
        value: Number(displayWeight.toFixed(1)),
        unit: weightUnit(unitSystem)
      });
      return {
        label: formatted === "Not set" ? undefined : formatted,
        weightValue,
        weightUnit: "kg"
      };
    }
    const formatted = formatWorkoutIntensity(intensity);
    const label = formatted === "Not set" ? undefined : formatted;
    return { label };
  } catch {
    return {};
  }
}

function friendlyStepName(rawName: string, kind: ScheduledStepKind): string {
  const trimmed = rawName.trim();
  // COROS template steps carry opaque names like "T3001" — swap in the kind.
  if (!trimmed || /^T\d+$/i.test(trimmed)) {
    return FRIENDLY_KIND_NAME[kind];
  }
  return trimmed;
}

function parseRawStep(
  exercise: Record<string, unknown>,
  index: number,
  unitSystem: UnitSystem,
  swim: boolean
): ScheduledStepView {
  const exerciseType = finiteNumber(exercise.exerciseType) ?? 2;
  const kind = EXERCISE_TYPE_TO_KIND[exerciseType] ?? "training";
  const target = parseRawTarget(exercise, kind, unitSystem, swim);
  const intensity = decodeIntensity(exercise, unitSystem);
  const id =
    exercise.id !== undefined ? String(exercise.id) : `step-${index}`;
  const targetType = finiteNumber(exercise.targetType);
  const targetValue = finiteNumber(exercise.targetValue) ?? 0;

  return {
    id,
    kind,
    name: friendlyStepName(String(exercise.name ?? ""), kind),
    targetLabel: target.label,
    intensityLabel: intensity.label,
    magnitude: target.magnitude,
    magnitudeType: target.magnitudeType,
    sets: finiteNumber(exercise.sets),
    reps: targetType === 3 && targetValue > 0 ? Math.round(targetValue) : undefined,
    weight: intensity.weightValue,
    weightUnit: intensity.weightUnit
  };
}

function dominantMagnitude(
  steps: ScheduledStepView[]
): Pick<ScheduledRepeatView, "magnitude" | "magnitudeType"> {
  const distance = steps
    .filter((step) => step.magnitudeType === "distance")
    .reduce((sum, step) => sum + (step.magnitude ?? 0), 0);
  const time = steps
    .filter((step) => step.magnitudeType === "time")
    .reduce((sum, step) => sum + (step.magnitude ?? 0), 0);
  if (distance > 0) {
    return { magnitude: distance, magnitudeType: "distance" };
  }
  if (time > 0) {
    return { magnitude: time, magnitudeType: "time" };
  }
  return {};
}

function buildFromRawProgram(
  program: Record<string, unknown>,
  unitSystem: UnitSystem,
  swim: boolean
): ScheduledNodeView[] {
  const rawExercises = Array.isArray(program.exercises)
    ? program.exercises
        .map(objectRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const exercises = [...rawExercises].sort(
    (left, right) =>
      (finiteNumber(left.sortNo) ?? 0) - (finiteNumber(right.sortNo) ?? 0)
  );

  const groupedIds = new Set(
    exercises
      .filter((exercise) => Boolean(exercise.isGroup))
      .map((exercise) => (exercise.id !== undefined ? String(exercise.id) : ""))
      .filter(Boolean)
  );
  const consumed = new Set<Record<string, unknown>>();
  const nodes: ScheduledNodeView[] = [];

  exercises.forEach((exercise, index) => {
    if (consumed.has(exercise)) {
      return;
    }
    const id = exercise.id !== undefined ? String(exercise.id) : "";

    if (Boolean(exercise.isGroup)) {
      const children = exercises.filter(
        (candidate) =>
          !candidate.isGroup && String(candidate.groupId ?? "") === id
      );
      children.forEach((child) => consumed.add(child));
      const steps = children.map((child, childIndex) =>
        parseRawStep(child, childIndex, unitSystem, swim)
      );
      const repeat = Math.max(
        1,
        Math.min(99, Math.round(finiteNumber(exercise.sets) ?? 1))
      );
      nodes.push({
        type: "repeat",
        id: id || `group-${index}`,
        name: String(exercise.name ?? "Repeat"),
        repeat,
        steps,
        ...dominantMagnitude(steps)
      });
      consumed.add(exercise);
      return;
    }

    const groupId = String(exercise.groupId ?? "");
    if (groupId && groupId !== "0" && groupedIds.has(groupId)) {
      return; // child consumed by its group
    }
    nodes.push({
      type: "step",
      step: parseRawStep(exercise, index, unitSystem, swim)
    });
    consumed.add(exercise);
  });

  return nodes;
}

/** Name-based kind guess for the pre-parsed fallback path. */
function classifyParsedExercise(name: string): ScheduledStepKind {
  const normalized = name.trim().toLowerCase();
  if (/warm[\s-]?up/.test(normalized)) {
    return "warmup";
  }
  if (/cool[\s-]?down/.test(normalized)) {
    return "cooldown";
  }
  if (/\b(rest|recover|recovery)\b/.test(normalized)) {
    return "rest";
  }
  return "training";
}

function magnitudeFromLabel(
  label?: string
): Pick<ScheduledStepView, "magnitude" | "magnitudeType"> {
  if (!label) {
    return {};
  }
  const kmMatch = label.match(/([\d.]+)\s*km/i);
  if (kmMatch) {
    const km = Number(kmMatch[1]);
    if (Number.isFinite(km) && km > 0) {
      return { magnitude: km * 1000, magnitudeType: "distance" };
    }
  }
  const mMatch = label.match(/([\d.]+)\s*m\b/i);
  if (mMatch && !/min|gain/i.test(label)) {
    const meters = Number(mMatch[1]);
    if (Number.isFinite(meters) && meters > 0) {
      return { magnitude: meters, magnitudeType: "distance" };
    }
  }
  const timeMatch = label.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1] ?? 0);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3]);
    const total = hours * 3600 + minutes * 60 + seconds;
    if (total > 0) {
      return { magnitude: total, magnitudeType: "time" };
    }
  }
  return {};
}

function buildFromParsedExercises(
  exercises: TrainingHubScheduledExercise[],
  unitSystem: UnitSystem,
  swim: boolean
): ScheduledNodeView[] {
  return exercises.map((exercise, index) => {
    const magnitude = magnitudeFromLabel(exercise.targetLabel);
    return {
      type: "step" as const,
      step: {
      id: `parsed-${index}`,
      kind: classifyParsedExercise(exercise.name),
      name: exercise.name,
      targetLabel:
        magnitude.magnitudeType === "distance" && magnitude.magnitude
          ? formatStepDistanceLabel(magnitude.magnitude, unitSystem, swim)
          : exercise.targetLabel,
      ...magnitude,
      sets: exercise.sets,
      reps: exercise.reps,
      weight: exercise.weight,
      weightUnit: exercise.weight !== undefined ? "kg" : undefined
      }
    };
  });
}

function computeTotals(nodes: ScheduledNodeView[]): ScheduledStructureTotals {
  let distanceMeters = 0;
  let durationSeconds = 0;
  let stepCount = 0;
  let repeatGroups = 0;

  const accumulate = (step: ScheduledStepView, factor: number) => {
    stepCount += 1;
    if (step.magnitudeType === "distance" && step.magnitude) {
      distanceMeters += step.magnitude * factor;
    } else if (step.magnitudeType === "time" && step.magnitude) {
      durationSeconds += step.magnitude * factor;
    }
  };

  for (const node of nodes) {
    if (node.type === "step") {
      accumulate(node.step, 1);
    } else {
      repeatGroups += 1;
      for (const step of node.steps) {
        accumulate(step, node.repeat);
      }
    }
  }

  return {
    distanceMeters: distanceMeters > 0 ? distanceMeters : undefined,
    durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
    stepCount,
    repeatGroups
  };
}

export function buildScheduledWorkoutView(
  entry: Pick<
    TrainingHubScheduledWorkoutEntry,
    "exercises" | "rawProgram" | "sportType"
  >,
  unitSystem: UnitSystem
): ScheduledStructureView {
  const rawProgram = objectRecord(entry.rawProgram);
  const hasRawExercises =
    rawProgram !== undefined &&
    Array.isArray(rawProgram.exercises) &&
    rawProgram.exercises.length > 0;

  const swim = Number(entry.sportType) === 3;
  const nodes = hasRawExercises
    ? buildFromRawProgram(rawProgram, unitSystem, swim)
    : buildFromParsedExercises(entry.exercises ?? [], unitSystem, swim);

  return {
    nodes,
    totals: computeTotals(nodes),
    source: hasRawExercises ? "raw" : "parsed"
  };
}
