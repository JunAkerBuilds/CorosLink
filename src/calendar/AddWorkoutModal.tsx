import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertCircle,
  Bike,
  BookmarkPlus,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Copy,
  Dumbbell,
  Flag,
  Flame,
  Footprints,
  Grip,
  GripVertical,
  Hand,
  ListTree,
  Mountain,
  Pencil,
  PersonStanding,
  Plus,
  Repeat2,
  Route,
  Search,
  Snowflake,
  Timer,
  Trash2,
  Trophy,
  Waves,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type {
  ManualActivityInput,
  PlanWorkoutEntryInput,
  WorkoutCreateStep,
  RunWorkoutStepInput,
  TrainingHubLibraryWorkout,
  TrainingHubSportType,
  UnitSystem,
  WorkoutHeartRateBasis,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutIntensityInput,
  WorkoutSport
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown } from "../components/SelectDropdown";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  displayDistanceToMeters,
  distanceUnit,
  elevationToMeters,
  elevationUnit,
  swimDistanceToMeters,
  swimDistanceUnit
} from "../units/units";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../training/formatters";
import { dateFromKey } from "./dateUtils";
import { ExerciseCombobox, type ExerciseComboboxSelection } from "./ExerciseCombobox";
import { ExercisePreview } from "./ExercisePreview";
import {
  CLIMB_GRADES,
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  RUNNING_POWER_PRESETS,
  SWIM_STROKE_IDS,
  WORKOUT_SPORT_CAPABILITIES,
  WORKOUT_SPORTS,
  formatIntensityType,
  formatWorkoutSport,
  validateWorkoutIntensity,
  workoutIntensitiesForStep,
  workoutTargetsForStep
} from "../../electron/workoutCapabilities";

type AddTab = "quick" | "library" | "builder" | "activity";

type UploadSport = ManualActivityInput["sport"];
type ActivityDistanceUnit = "km" | "m" | "none";

const ADD_TAB_ITEMS: Record<AddTab, { label: string; Icon: LucideIcon }> = {
  quick: { label: "Quick training", Icon: Zap },
  library: { label: "From library", Icon: BookOpen },
  builder: { label: "Structured", Icon: ListTree },
  activity: { label: "Log activity", Icon: Activity }
};

const QUICK_DISTANCE_PRESETS = [5, 8, 10, 21.1] as const;

interface LogSportOption {
  id: string;
  label: string;
  uploadSport: UploadSport;
  distanceUnit: ActivityDistanceUnit;
  Icon: LucideIcon;
  sportType?: number;
}

const DEFAULT_LOG_SPORT_OPTION: LogSportOption = {
  id: "suggested-run",
  label: "Run",
  uploadSport: "run",
  distanceUnit: "km",
  Icon: Footprints
};

function quickWorkoutDuration(
  displayDistance: number,
  pace: string,
  unitSystem: UnitSystem
): string | null {
  const paceMatch = pace.trim().match(/^(\d+):([0-5]\d)(?:-(?:\d+):(?:[0-5]\d))?(?:\/(km|mi))?/i);
  if (!Number.isFinite(displayDistance) || displayDistance <= 0 || !paceMatch) {
    return null;
  }

  const paceSeconds = Number(paceMatch[1]) * 60 + Number(paceMatch[2]);
  const paceUnit = paceMatch[3]?.toLowerCase() ?? distanceUnit(unitSystem);
  const secondsPerKm = paceUnit === "mi" ? paceSeconds / 1.609344 : paceSeconds;
  const distanceKm = displayDistanceToMeters(displayDistance, unitSystem) / 1000;
  const totalMinutes = Math.round(distanceKm * secondsPerKm / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function isQuickPaceValid(pace: string): boolean {
  const value = pace.trim();
  return value === "" || /^\d+:[0-5]\d(?:-\d+:[0-5]\d)?(?:\/(?:km|mi))?$/i.test(value);
}

function normalizeQuickPace(pace: string, unitSystem: UnitSystem): string {
  const value = pace.trim();
  return /\/(?:km|mi)$/i.test(value)
    ? value
    : `${value}/${distanceUnit(unitSystem)}`;
}

const SUGGESTED_LOG_SPORT_OPTIONS: LogSportOption[] = [
  DEFAULT_LOG_SPORT_OPTION,
  { id: "suggested-ride", label: "Ride", uploadSport: "bike", distanceUnit: "km", Icon: Bike },
  { id: "suggested-walk", label: "Walk", uploadSport: "other", distanceUnit: "km", Icon: Footprints },
  { id: "suggested-hike", label: "Hike", uploadSport: "other", distanceUnit: "km", Icon: Mountain },
  { id: "suggested-swim", label: "Swim", uploadSport: "other", distanceUnit: "m", Icon: Waves },
  { id: "suggested-strength", label: "Strength", uploadSport: "other", distanceUnit: "none", Icon: Dumbbell },
  { id: "suggested-yoga", label: "Yoga", uploadSport: "other", distanceUnit: "none", Icon: PersonStanding },
  { id: "suggested-other", label: "Other", uploadSport: "other", distanceUnit: "none", Icon: Activity }
];

const RUN_TERMS = ["run", "running", "treadmill", "trail run", "track"];
const BIKE_TERMS = ["bike", "biking", "bicycle", "cycle", "cycling", "ride", "mtb", "gravel"];
const SWIM_TERMS = ["swim", "swimming"];
const WALK_TERMS = ["walk", "walking"];
const HIKE_TERMS = ["hike", "hiking", "trek", "trail"];
const ROW_TERMS = ["row", "rowing"];
const SKI_TERMS = ["ski", "skiing", "snowboard", "skate", "skating"];
const PADDLE_TERMS = ["kayak", "canoe", "paddle", "sup"];
const STATIONARY_TERMS = [
  "strength",
  "gym",
  "weight",
  "weights",
  "yoga",
  "pilates",
  "stretch",
  "mobility",
  "meditation",
  "cardio",
  "indoor",
  "fitness"
];

function normalizeSportLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesSportTerm(label: string, terms: string[]): boolean {
  return terms.some((term) => label.includes(term));
}

function inferUploadSport(label: string): UploadSport {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, BIKE_TERMS)) {
    return "bike";
  }
  if (includesSportTerm(normalized, RUN_TERMS)) {
    return "run";
  }
  return "other";
}

function inferDistanceUnit(label: string): ActivityDistanceUnit {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, SWIM_TERMS)) {
    return "m";
  }
  if (
    includesSportTerm(normalized, [
      ...RUN_TERMS,
      ...BIKE_TERMS,
      ...WALK_TERMS,
      ...HIKE_TERMS,
      ...ROW_TERMS,
      ...SKI_TERMS,
      ...PADDLE_TERMS
    ])
  ) {
    return "km";
  }
  if (includesSportTerm(normalized, STATIONARY_TERMS)) {
    return "none";
  }
  return "none";
}

function inferSportIcon(label: string): LucideIcon {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, SWIM_TERMS)) {
    return Waves;
  }
  if (includesSportTerm(normalized, BIKE_TERMS)) {
    return Bike;
  }
  if (includesSportTerm(normalized, ["strength", "gym", "weight", "weights"])) {
    return Dumbbell;
  }
  if (includesSportTerm(normalized, ["yoga", "pilates", "stretch", "mobility"])) {
    return PersonStanding;
  }
  if (includesSportTerm(normalized, [...RUN_TERMS, ...WALK_TERMS])) {
    return Footprints;
  }
  if (includesSportTerm(normalized, HIKE_TERMS)) {
    return Mountain;
  }
  return Activity;
}

function createCorosLogSportOption(sportType: TrainingHubSportType): LogSportOption {
  const label = sportType.sportName.trim() || `Sport ${sportType.sportType}`;
  return {
    id: `coros-${sportType.sportType}-${normalizeSportLabel(label).replace(/[^a-z0-9]+/g, "-")}`,
    label,
    uploadSport: inferUploadSport(label),
    distanceUnit: inferDistanceUnit(label),
    Icon: inferSportIcon(label),
    sportType: sportType.sportType
  };
}

function describeLogSportOption(option: LogSportOption): string {
  if (option.distanceUnit === "m") {
    return "meters";
  }
  if (option.distanceUnit === "km") {
    return "distance";
  }
  return "time only";
}

type BuilderKind = "warmup" | "training" | "intervals" | "rest" | "cooldown" | "sendOff";

interface BuilderRow {
  id: number;
  kind: BuilderKind;
  targetType: "distance" | "time" | "load" | "hrRecovery" | "open" | "reps" | "elevationGain" | "routes";
  distanceKm: string;
  timeMin: string;
  pace: string;
  // repeat groups only
  repeats: string;
  children?: BuilderRow[];
  sets: string;
  restSeconds: string;
  intensityType: Exclude<WorkoutIntensityInput["type"], "lthrPercent">;
  intensityLow: string;
  intensityHigh: string;
  intensityPreset: string;
  intensityBasis: WorkoutHeartRateBasis;
  intensityUnit: "kg" | "lb" | "km/h" | "mph" | "rpm" | "spm";
  exerciseName: string;
  exerciseId: string;
  exerciseKind?: number;
}

/**
 * Per-sport builder identity: an icon plus the user's (customizable) sport
 * color token. Categories mirror sportColorCategory() — run/trail/bike/
 * strength get their own hue, everything else falls back to "other".
 */
const BUILDER_SPORT_META: Record<WorkoutSport, { Icon: LucideIcon; colorVar: string }> = {
  run: { Icon: Footprints, colorVar: "var(--sport-run)" },
  bike: { Icon: Bike, colorVar: "var(--sport-bike)" },
  swim: { Icon: Waves, colorVar: "var(--sport-other)" },
  strength: { Icon: Dumbbell, colorVar: "var(--sport-strength)" },
  trailRun: { Icon: Mountain, colorVar: "var(--sport-trail)" },
  indoorClimb: { Icon: Grip, colorVar: "var(--sport-other)" },
  bouldering: { Icon: Hand, colorVar: "var(--sport-other)" },
  xcSki: { Icon: Snowflake, colorVar: "var(--sport-other)" },
  hyrox: { Icon: Trophy, colorVar: "var(--sport-strength)" }
};

/** Display metadata for each step kind; hues come from CSS per data-kind. */
const BUILDER_KIND_META: Record<BuilderKind, { label: string; Icon: LucideIcon }> = {
  warmup: { label: "Warm-up", Icon: Flame },
  training: { label: "Training", Icon: Zap },
  intervals: { label: "Repeat", Icon: Repeat2 },
  rest: { label: "Rest", Icon: Timer },
  cooldown: { label: "Cool-down", Icon: Snowflake },
  sendOff: { label: "Send-off", Icon: Flag }
};

/** Preferred ordering for the quick-add step chips. */
const BUILDER_ADD_KIND_ORDER: readonly BuilderKind[] = [
  "warmup",
  "training",
  "intervals",
  "rest",
  "cooldown",
  "sendOff"
];

interface AddWorkoutModalProps {
  api: CorosLinkApi;
  dateKey: string;
  sportTypes: TrainingHubSportType[];
  onClose: () => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
  onEditLibrary: (programId: string) => void;
  libraryOnly?: boolean;
}

let builderRowId = 0;

function emptyRow(kind: BuilderKind, sport: WorkoutSport = "run"): BuilderRow {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  const stepKind = kind === "intervals" ? "training" : kind;
  const targets = workoutTargetsForStep(sport, stepKind);
  const targetType = kind === "rest" && targets.includes("time")
    ? "time"
    : targets.includes("distance")
      ? "distance"
      : targets.includes("reps")
        ? "reps"
        : targets.includes("routes") ? "routes" : "time";
  builderRowId += 1;
  const row: BuilderRow = {
    id: builderRowId,
    kind,
    targetType,
    distanceKm: sport === "strength" && stepKind === "training" ? "10" : "",
    timeMin: kind === "rest" ? "2" : "",
    pace: "",
    repeats: "4",
    sets: sport === "strength" ? "4" : "1",
    restSeconds: sport === "strength" ? "60" : "0",
    intensityType: sport === "strength" && stepKind !== "training"
      ? "none"
      : capability.defaultIntensity.type === "lthrPercent" ? "heartRatePercent" : capability.defaultIntensity.type,
    intensityLow: capability.defaultIntensity.type === "climbGrade" && "relativeToOnsight" in capability.defaultIntensity
      ? String(capability.defaultIntensity.relativeToOnsight)
      : "",
    intensityHigh: "",
    intensityPreset: capability.defaultIntensity.type === "swimStroke"
      ? capability.defaultIntensity.stroke
      : capability.defaultIntensity.type === "weight"
        ? capability.defaultIntensity.mode
        : capability.defaultIntensity.type === "climbGrade"
          ? `relative:${capability.defaultIntensity.system}`
          : "",
    intensityBasis: "maxHr",
    intensityUnit: sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm",
    exerciseName: "",
    exerciseId: ""
  };
  return kind === "intervals"
    ? {
        ...row,
        children: [emptyRow("training", sport), emptyRow("rest", sport)]
      }
    : row;
}

function cloneBuilderRow(row: BuilderRow): BuilderRow {
  builderRowId += 1;
  return {
    ...row,
    id: builderRowId,
    children: row.children?.map(cloneBuilderRow)
  };
}

function changeBuilderRowKind(
  row: BuilderRow,
  kind: BuilderKind,
  sport: WorkoutSport
): BuilderRow {
  const stepKind = kind === "intervals" ? "training" : kind;
  const targets = workoutTargetsForStep(sport, stepKind, row.exerciseKind);
  const intensities = workoutIntensitiesForStep(sport, stepKind, row.exerciseKind);
  return {
    ...row,
    kind,
    targetType: targets.includes(row.targetType)
      ? row.targetType
      : targets[0] ?? "time",
    intensityType: intensities.includes(row.intensityType)
      ? row.intensityType
      : intensities[0] ?? "none",
    children: kind === "intervals"
      ? row.children?.length
        ? row.children
        : [emptyRow("training", sport), emptyRow("rest", sport)]
      : row.children
  };
}

function moveBuilderRow(rows: BuilderRow[], sourceId: number, targetId: number): BuilderRow[] {
  const fromIndex = rows.findIndex((row) => row.id === sourceId);
  const toIndex = rows.findIndex((row) => row.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return rows;
  const nextRows = [...rows];
  const [movedRow] = nextRows.splice(fromIndex, 1);
  if (!movedRow) return rows;
  nextRows.splice(Math.min(toIndex, nextRows.length), 0, movedRow);
  return nextRows;
}

function paceSeconds(value: string, fallbackUnit: "km" | "mi" = "km"): number {
  const match = value.trim().match(/^(\d+):([0-5]\d)(?:\/(km|mi))?$/i);
  if (!match) return 0;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  const unit = (match[3]?.toLowerCase() ?? fallbackUnit) as "km" | "mi";
  return unit === "mi" ? seconds / 1.609344 : seconds;
}

function rowIntensity(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): WorkoutIntensityInput {
  const low = Number(row.intensityLow);
  const high = Number(row.intensityHigh || row.intensityLow);
  const preset = row.intensityPreset;
  switch (row.intensityType) {
    case "heartRate": return { type: "heartRate", lowBpm: low, highBpm: high };
    case "heartRatePercent": return preset ? { type: "heartRatePercent", basis: row.intensityBasis, preset: preset as never } : { type: "heartRatePercent", basis: row.intensityBasis, lowPercent: low, highPercent: high };
    case "pace":
    case "effortPace": {
      const displayUnit = row.pace.includes("/mi")
        ? "mi"
        : row.pace.includes("/km")
          ? "km"
          : distanceUnit(unitSystem);
      const [fast, slow] = row.pace.split("-").map((value) => paceSeconds(value, displayUnit));
      return { type: row.intensityType, lowSecondsPerKm: fast || 300, highSecondsPerKm: slow || fast || 300, displayUnit };
    }
    case "thresholdPacePercent":
    case "effortPacePercent": return preset ? { type: row.intensityType, preset: preset as never } as WorkoutIntensityInput : { type: row.intensityType, lowPercent: low, highPercent: high } as WorkoutIntensityInput;
    case "ftpPercent": return preset ? { type: "ftpPercent", preset: preset as never } : { type: "ftpPercent", lowPercent: low, highPercent: high };
    case "power": return preset && sport !== "bike" ? { type: "power", preset: preset as never } : { type: "power", lowWatts: low, highWatts: high };
    case "speed": return { type: "speed", low, high, unit: row.intensityUnit === "mph" ? "mph" : "km/h" };
    case "cadence": return { type: "cadence", low, high, unit: row.intensityUnit === "spm" ? "spm" : "rpm" };
    case "swimStroke": return { type: "swimStroke", stroke: (preset || "freestyle") as keyof typeof SWIM_STROKE_IDS };
    case "weight": return preset === "bodyweight" || !preset ? { type: "weight", mode: "bodyweight" } : { type: "weight", mode: "weight", value: low, unit: row.intensityUnit === "lb" ? "lb" : "kg" };
    case "rpe": return { type: "rpe", value: Math.round(low || 5) };
    case "climbGrade": return preset.startsWith("relative:") ? { type: "climbGrade", system: (preset.split(":")[1] || "yds") as keyof typeof CLIMB_SYSTEM_IDS, relativeToOnsight: Math.round(low || 0) } : { type: "climbGrade", system: (preset.split(":")[0] || "yds") as keyof typeof CLIMB_SYSTEM_IDS, absoluteGrade: preset.split(":")[1] || CLIMB_GRADES.yds[0]! };
    default: return { type: "none" };
  }
}

function builderRowValidationMessage(
  row: BuilderRow,
  sport: WorkoutSport,
  exerciseOptions: WorkoutExerciseOption[],
  exercisesLoading: boolean,
  unitSystem: UnitSystem
): string | undefined {
  if (row.kind === "intervals") {
    const repeatCount = Number(row.repeats);
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 99) {
      return "Enter between 1 and 99 repeats.";
    }
    if (!row.children?.length) {
      return "Add at least one step inside this repeat.";
    }
    for (const [index, child] of row.children.entries()) {
      if (child.kind === "intervals") {
        return `Sub-step ${index + 1}: nested repeats are not supported.`;
      }
      const message = builderRowValidationMessage(
        child,
        sport,
        exerciseOptions,
        exercisesLoading,
        unitSystem
      );
      if (message) return `Sub-step ${index + 1}: ${message}`;
    }
    return undefined;
  }

  const stepKind = row.kind;
  const targetValue = row.targetType === "time" ? row.timeMin : row.distanceKm;
  if (row.targetType !== "open" && !(Number(targetValue) > 0)) {
    return `Enter a valid ${builderTargetLabel(row.targetType, sport, unitSystem).toLocaleLowerCase()}.`;
  }
  if (sport === "strength" && stepKind === "training") {
    if (exercisesLoading) return "Wait for the COROS exercise catalog to finish loading.";
    if (exerciseOptions.length === 0) return "Reconnect COROS to load the exercise catalog.";
    if (!row.exerciseName.trim()) return "Select a COROS exercise for this Strength step.";
    if (!row.exerciseId) return "Choose an exact exercise from the COROS suggestions.";
    if (!Number.isInteger(Number(row.sets)) || Number(row.sets) < 1 || Number(row.sets) > 99) {
      return "Enter between 1 and 99 sets.";
    }
    if (!Number.isFinite(Number(row.restSeconds)) || Number(row.restSeconds) < 0 || Number(row.restSeconds) > 3600) {
      return "Enter rest between 0 and 3600 seconds.";
    }
  }
  // An empty added-weight field reads as 0 and would upload a 0 kg step, so
  // the load has to be stated once "added weight" is the chosen mode.
  if (row.intensityType === "weight"
    && row.intensityPreset === "weight"
    && !(Number(row.intensityLow) > 0)) {
    return `Enter the added weight in ${unitSystem === "imperial" ? "lb" : "kg"}.`;
  }
  if (sport === "hyrox" && row.exerciseName.trim() && !row.exerciseId) {
    return exerciseOptions.length === 0
      ? "Reconnect COROS to load the HYROX exercise catalog."
      : "Choose an exact exercise from the COROS suggestions.";
  }
  if ((row.intensityType === "pace" || row.intensityType === "effortPace") && !/^\d+:[0-5]\d(?:\/(?:km|mi))?-\d+:[0-5]\d(?:\/(?:km|mi))?$/i.test(row.pace.trim())) {
    return unitSystem === "imperial"
      ? "Enter pace as a range, for example 7:15-7:30/mi."
      : "Enter pace as a range, for example 4:30-4:45/km.";
  }
  const intensityError = validateWorkoutIntensity(
    sport,
    rowIntensity(row, sport, unitSystem),
    stepKind,
    row.exerciseKind
  );
  return intensityError;
}

function rowToStep(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem,
  insideRepeat = false
): WorkoutCreateStep {
  if (row.kind === "intervals") {
    throw new Error("Repeat groups cannot be nested inside another repeat group.");
  }
  const rawValue = Number(row.distanceKm);
  const target = row.targetType === "distance"
    ? {
        target_type: "distance" as const,
        target_distance_meters: Math.round(
          sport === "swim"
            ? swimDistanceToMeters(rawValue, unitSystem)
            : displayDistanceToMeters(rawValue, unitSystem)
        )
      }
    : row.targetType === "time"
      ? { target_type: "time" as const, target_duration_seconds: Math.round(Number(row.timeMin) * (sport === "strength" ? 1 : 60)) }
      : row.targetType === "load" ? { target_type: "load" as const, target_load: Math.round(rawValue) }
        : row.targetType === "hrRecovery" ? { target_type: "hrRecovery" as const, target_hr_recovery_bpm: Math.round(rawValue) }
          : row.targetType === "reps" ? { target_type: "reps" as const, target_reps: Math.round(rawValue) }
            : row.targetType === "elevationGain" ? { target_type: "elevationGain" as const, target_elevation_gain_meters: elevationToMeters(rawValue, unitSystem) }
              : row.targetType === "routes" ? { target_type: "routes" as const, target_routes: Math.round(rawValue) }
                : { target_type: "open" as const };
  const intensity = { intensity: rowIntensity(row, sport, unitSystem) };
  const exercise = row.exerciseName.trim()
    ? {
        exercise_name: row.exerciseName.trim(),
        ...(row.exerciseId ? { exercise_id: row.exerciseId } : {}),
        ...(row.exerciseKind !== undefined ? { exercise_kind: row.exerciseKind } : {})
      }
    : {};

  const strengthSetDetails = sport === "strength" && row.kind === "training"
    ? {
        sets: Math.max(1, Math.round(Number(row.sets) || 1)),
        rest_type: 1,
        rest_value: Math.max(0, Math.round(Number(row.restSeconds) || 0))
      }
    : {};
  return {
    kind: insideRepeat && row.kind === "training" ? "interval" : row.kind,
    ...target,
    ...intensity,
    ...exercise,
    ...strengthSetDetails
  };
}

function rowToSteps(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): RunWorkoutStepInput[] {
  if (row.kind === "intervals") {
    return [
      {
        repeat: Math.max(1, Math.round(Number(row.repeats) || 1)),
        name: "Repeat",
        steps: (row.children ?? []).map((child) =>
          rowToStep(child, sport, unitSystem, true)
        )
      }
    ];
  }
  return [rowToStep(row, sport, unitSystem)];
}

function rowIsValid(
  row: BuilderRow,
  sport: WorkoutSport,
  exerciseOptions: WorkoutExerciseOption[],
  exercisesLoading: boolean,
  unitSystem: UnitSystem
): boolean {
  return builderRowValidationMessage(
    row,
    sport,
    exerciseOptions,
    exercisesLoading,
    unitSystem
  ) === undefined;
}

function builderTargetLabel(
  target: BuilderRow["targetType"],
  sport: WorkoutSport,
  unitSystem: UnitSystem
): string {
  const labels: Record<BuilderRow["targetType"], string> = {
    distance: sport === "swim"
      ? `Distance (${swimDistanceUnit(unitSystem)})`
      : `Distance (${distanceUnit(unitSystem)})`,
    time: sport === "strength" ? "Duration (sec)" : "Duration (min)",
    load: "Training Load",
    hrRecovery: "Return to heart rate (bpm)",
    open: "Manual end",
    reps: "Repetitions",
    elevationGain: `Elevation gain (${elevationUnit(unitSystem)})`,
    routes: "Routes"
  };
  return labels[target];
}

function builderTargetTypeLabel(target: BuilderRow["targetType"]): string {
  const labels: Record<BuilderRow["targetType"], string> = {
    distance: "Distance",
    time: "Time",
    load: "Training Load",
    hrRecovery: "HR Recovery",
    open: "Open",
    reps: "Reps",
    elevationGain: "Elevation Gain",
    routes: "Routes"
  };
  return labels[target];
}

interface BuilderRowSummaryItem {
  label: string;
  value: string;
}

function builderSummaryRange(low: string, high: string, unit: string): string {
  const start = low.trim();
  const end = high.trim();
  if (!start) return "Not set";
  return `${end && end !== start ? `${start}-${end}` : start}${unit ? ` ${unit}` : ""}`;
}

function builderIntensitySummary(row: BuilderRow, sport: WorkoutSport): string {
  switch (row.intensityType) {
    case "none": return "Open";
    case "heartRate": return builderSummaryRange(row.intensityLow, row.intensityHigh, "bpm");
    case "heartRatePercent": {
      const preset = HEART_RATE_PRESETS[row.intensityBasis].find((zone) => zone.preset === row.intensityPreset);
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "%");
    }
    case "pace":
    case "effortPace": return row.pace.trim() || "Not set";
    case "thresholdPacePercent":
    case "effortPacePercent": {
      const preset = PACE_PRESETS.find((zone) => zone.preset === row.intensityPreset);
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "%");
    }
    case "ftpPercent": {
      const preset = FTP_PRESETS.find((zone) => zone.preset === row.intensityPreset);
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "% FTP");
    }
    case "power": {
      const preset = sport !== "bike"
        ? RUNNING_POWER_PRESETS.find((zone) => zone.preset === row.intensityPreset)
        : undefined;
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "W");
    }
    case "speed": return builderSummaryRange(row.intensityLow, row.intensityHigh, row.intensityUnit === "mph" ? "mph" : "km/h");
    case "cadence": return builderSummaryRange(row.intensityLow, row.intensityHigh, row.intensityUnit === "spm" ? "spm" : "rpm");
    case "swimStroke": return formatBuilderToken(row.intensityPreset || "freestyle");
    case "weight": return row.intensityPreset === "weight"
      ? builderSummaryRange(row.intensityLow, row.intensityLow, row.intensityUnit === "lb" ? "lb" : "kg")
      : "Bodyweight";
    case "rpe": return `RPE ${row.intensityLow || "5"}`;
    case "climbGrade": return row.intensityPreset.startsWith("relative:")
      ? `${row.intensityLow || "0"} from onsight`
      : row.intensityPreset.split(":")[1] || "Not set";
    default: return formatIntensityType(row.intensityType);
  }
}

function builderRowSummary(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): BuilderRowSummaryItem[] {
  if (row.kind === "intervals") {
    const children = row.children ?? [];
    return [
      {
        label: "Sequence",
        value: children.length
          ? children.map((child) => BUILDER_KIND_META[child.kind].label).join(" + ")
          : "No steps"
      },
      {
        label: "Inside",
        value: `${children.length} ${children.length === 1 ? "step" : "steps"}`
      }
    ];
  }
  const rawTarget = row.targetType === "time" ? row.timeMin.trim() : row.distanceKm.trim();
  const target = row.targetType === "open"
    ? "Manual"
    : row.targetType === "time"
      ? rawTarget ? `${rawTarget} ${sport === "strength" ? "sec" : "min"}` : "Not set"
      : row.targetType === "distance"
        ? rawTarget
          ? `${rawTarget} ${sport === "swim" ? swimDistanceUnit(unitSystem) : distanceUnit(unitSystem)}`
          : "Not set"
        : row.targetType === "load"
          ? rawTarget ? `${rawTarget} TL` : "Not set"
          : row.targetType === "hrRecovery"
            ? rawTarget ? `${rawTarget} bpm` : "Not set"
            : row.targetType === "reps"
              ? rawTarget ? `${rawTarget} reps` : "Not set"
              : row.targetType === "elevationGain"
                ? rawTarget ? `${rawTarget} ${elevationUnit(unitSystem)}` : "Not set"
                : rawTarget ? `${rawTarget} routes` : "Not set";
  const details: BuilderRowSummaryItem[] = [
    { label: builderTargetTypeLabel(row.targetType), value: target },
    { label: "Intensity", value: builderIntensitySummary(row, sport) }
  ];
  if (row.exerciseName.trim()) {
    details.splice(1, 0, { label: "Exercise", value: row.exerciseName.trim() });
  }
  if (sport === "strength" && row.kind === "training") {
    details.push({ label: "Sets", value: row.sets || "Not set" });
    details.push({ label: "Rest", value: `${row.restSeconds || "0"} sec` });
  }
  return details;
}

interface BuilderWorkoutTotals {
  minutes: number;
  /** Distance in the unit the sport logs (km, or m for pool swims). */
  distance: number;
  distanceUnit: "land" | "swim";
}

/**
 * Best-effort estimate of the workout's moving time and distance. Targets
 * that can't be converted (load, HR recovery, reps, routes, open steps) are
 * skipped — the footer presents these as estimates, never promises.
 */
function builderWorkoutTotals(rows: BuilderRow[], sport: WorkoutSport): BuilderWorkoutTotals {
  let minutes = 0;
  let distance = 0;
  const addRow = (row: BuilderRow, multiplier = 1) => {
    if (row.kind === "intervals") {
      const repeats = Math.max(1, Number(row.repeats) || 1);
      for (const child of row.children ?? []) {
        addRow(child, multiplier * repeats);
      }
      return;
    }
    if (row.targetType === "time") {
      const value = Number(row.timeMin) || 0;
      if (sport === "strength") {
        // Strength time targets are per set, in seconds, with rest between.
        const sets = row.kind === "training" ? Math.max(1, Number(row.sets) || 1) : 1;
        const restSec = row.kind === "training" ? Number(row.restSeconds) || 0 : 0;
        minutes += multiplier * (sets * value + Math.max(0, sets - 1) * restSec) / 60;
      } else {
        minutes += multiplier * value;
      }
    }
    if (row.targetType === "distance") {
      distance += multiplier * (Number(row.distanceKm) || 0);
    }
  };
  for (const row of rows) {
    addRow(row);
  }
  return { minutes, distance, distanceUnit: sport === "swim" ? "swim" : "land" };
}

function builderStructureCounts(rows: BuilderRow[]): {
  steps: number;
  repeatGroups: number;
} {
  return rows.reduce(
    (totals, row) => {
      if (row.kind === "intervals") {
        totals.repeatGroups += 1;
        totals.steps += row.children?.length ?? 0;
      } else {
        totals.steps += 1;
      }
      return totals;
    },
    { steps: 0, repeatGroups: 0 }
  );
}

function formatBuilderMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) {
    return `${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatBuilderDistance(
  distance: number,
  unit: "land" | "swim",
  unitSystem: UnitSystem
): string {
  if (unit === "swim") {
    return `${Math.round(distance).toLocaleString()} ${swimDistanceUnit(unitSystem)}`;
  }
  const rounded = Math.round(distance * 10) / 10;
  return `${rounded.toLocaleString()} ${distanceUnit(unitSystem)}`;
}

function BuilderIntensityFields({ row, sport, context, exerciseOptions, exercisesLoading, onChange }: { row: BuilderRow; sport: WorkoutSport; context?: WorkoutEditorContext; exerciseOptions: WorkoutExerciseOption[]; exercisesLoading: boolean; onChange: (update: Partial<BuilderRow>) => void }) {
  const { unitSystem } = useUnitSystem();
  const stepKind = row.kind === "intervals" ? "training" : row.kind;
  const intensityTypes = workoutIntensitiesForStep(sport, stepKind, row.exerciseKind);
  const numericRange = ["heartRate", "speed", "cadence"].includes(row.intensityType) ||
    (row.intensityType === "power" && !row.intensityPreset);
  const percentType = ["heartRatePercent", "thresholdPacePercent", "effortPacePercent", "ftpPercent"].includes(row.intensityType);
  const presets = row.intensityType === "heartRatePercent"
    ? HEART_RATE_PRESETS[row.intensityBasis]
    : row.intensityType === "ftpPercent" ? FTP_PRESETS
      : row.intensityType === "thresholdPacePercent" || row.intensityType === "effortPacePercent" ? PACE_PRESETS
        : row.intensityType === "power" && sport !== "bike" ? RUNNING_POWER_PRESETS : [];
  const presetZoneKey: keyof WorkoutEditorContext["zones"] | undefined = row.intensityType === "heartRatePercent"
    ? row.intensityBasis
    : row.intensityType === "ftpPercent" ? "ftp"
      : row.intensityType === "thresholdPacePercent" || row.intensityType === "effortPacePercent" ? "thresholdPace"
        : row.intensityType === "power" ? "runningPower" : undefined;
  const climbParts = row.intensityPreset.split(":");
  const rawClimbSystem = row.intensityPreset.startsWith("relative:") ? climbParts[1] : climbParts[0];
  const climbSystem = (rawClimbSystem || (sport === "bouldering" ? "vScale" : "yds")) as keyof typeof CLIMB_SYSTEM_IDS;
  const showExercise = (sport === "strength" || sport === "hyrox") && row.kind !== "warmup" && row.kind !== "cooldown";
  const numberUnit = row.intensityType === "heartRate" ? "bpm"
    : row.intensityType === "speed" ? (row.intensityUnit === "mph" ? "mph" : "km/h")
      : row.intensityType === "cadence" ? (row.intensityUnit === "spm" ? "spm" : "rpm")
        : row.intensityType === "power" ? "W" : "%";
  const selectExercise = (selection: ExerciseComboboxSelection) => {
    const match = selection.id
      ? exerciseOptions.find((option) => option.id === selection.id)
      : undefined;
    const update: Partial<BuilderRow> = {
      exerciseName: selection.name,
      exerciseId: selection.id ?? "",
      exerciseKind: selection.exerciseKind
    };
    if (sport === "hyrox" && match?.exerciseKind) {
      const targets = workoutTargetsForStep(sport, stepKind, match.exerciseKind);
      if (!targets.includes(row.targetType)) update.targetType = targets[0] ?? "time";
      const intensities = workoutIntensitiesForStep(sport, stepKind, match.exerciseKind);
      if (!intensities.includes(row.intensityType)) {
        const next = intensities[0] ?? "none";
        Object.assign(update, {
          intensityType: next,
          intensityLow: next === "rpe" ? "5" : "80",
          intensityHigh: "100",
          intensityPreset: next === "weight" ? "bodyweight" : ""
        });
      }
    }
    onChange(update);
  };
  const intensityControls = <>
    <label className="calendar-builder-control">
      <span>Intensity</span>
      <SelectDropdown<BuilderRow["intensityType"]>
        label="Intensity"
        value={row.intensityType}
        options={intensityTypes.map((type) => ({ value: type, label: formatIntensityType(type) }))}
        portal
        onChange={(intensityType) => {
        onChange({
          intensityType,
          intensityLow: intensityType === "heartRate" ? "135" : intensityType === "rpe" ? "5" : intensityType === "climbGrade" ? "0" : "80",
          intensityHigh: intensityType === "heartRate" ? "145" : "100",
          intensityPreset: intensityType === "swimStroke" ? "freestyle" : intensityType === "weight" ? "bodyweight" : intensityType === "climbGrade" ? `relative:${sport === "bouldering" ? "vScale" : "yds"}` : "",
          intensityUnit: intensityType === "weight" ? (unitSystem === "imperial" ? "lb" : "kg") : intensityType === "speed" ? (unitSystem === "imperial" ? "mph" : "km/h") : sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm"
        });
      }} />
    </label>

    {(row.intensityType === "pace" || row.intensityType === "effortPace") ? <label className="calendar-builder-control is-wide">
      <span>Pace range</span>
      <input
        type="text"
        value={row.pace}
        placeholder={unitSystem === "imperial" ? "7:15-7:30/mi" : "4:30-4:45/km"}
        onChange={(event) => onChange({ pace: event.target.value })}
      />
      <small>Enter fast-to-slow pace, including /km or /mi.</small>
    </label> : null}

    {row.intensityType === "heartRatePercent" ? <label className="calendar-builder-control">
      <span>Heart-rate basis</span>
      <SelectDropdown<WorkoutHeartRateBasis>
        label="Heart-rate basis"
        value={row.intensityBasis}
        options={[
          { value: "maxHr", label: "% Max Heart Rate" },
          { value: "reserve", label: "% Heart Rate Reserve" },
          { value: "lthr", label: "% Lactate Threshold HR" }
        ]}
        portal
        onChange={(intensityBasis) => onChange({ intensityBasis, intensityPreset: "" })}
      />
    </label> : null}

    {(percentType || (row.intensityType === "power" && sport !== "bike")) ? <label className="calendar-builder-control">
      <span>Zone</span>
      <SelectDropdown
        label="Intensity zone"
        value={row.intensityPreset || "custom"}
        options={[
          { value: "custom", label: "Custom range" },
          ...presets.map((zone) => {
            const configured = presetZoneKey
              ? context?.zones[presetZoneKey]?.find((candidate) => candidate.id === zone.id || candidate.key === zone.preset)
              : undefined;
            return {
              value: zone.preset,
              label: `${configured?.label ?? zone.label}${configured ? ` · ${configured.lowPercent}-${configured.highPercent}%` : ""}`
            };
          })
        ]}
        portal
        onChange={(intensityPreset) => onChange({ intensityPreset: intensityPreset === "custom" ? "" : intensityPreset })}
      />
    </label> : null}

    {(numericRange || (percentType && !row.intensityPreset)) ? <>
      <label className="calendar-builder-control"><span>Low ({numberUnit})</span><input type="number" value={row.intensityLow} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label>
      <label className="calendar-builder-control"><span>High ({numberUnit})</span><input type="number" value={row.intensityHigh} onChange={(event) => onChange({ intensityHigh: event.target.value })} /></label>
    </> : null}

    {row.intensityType === "speed" ? <label className="calendar-builder-control"><span>Speed unit</span><span className="calendar-builder-readonly-value">{unitSystem === "imperial" ? "mph" : "km/h"}</span></label> : null}
    {row.intensityType === "cadence" ? <label className="calendar-builder-control"><span>Cadence unit</span><SelectDropdown label="Cadence unit" value={row.intensityUnit === "spm" ? "spm" : "rpm"} options={[{ value: "spm", label: "steps/min" }, { value: "rpm", label: "revs/min" }]} portal onChange={(intensityUnit) => onChange({ intensityUnit })} /></label> : null}
    {row.intensityType === "swimStroke" ? <label className="calendar-builder-control"><span>Stroke</span><SelectDropdown label="Swim stroke" value={row.intensityPreset || "freestyle"} options={Object.keys(SWIM_STROKE_IDS).map((stroke) => ({ value: stroke, label: formatBuilderToken(stroke) }))} portal onChange={(intensityPreset) => onChange({ intensityPreset })} /></label> : null}

    {row.intensityType === "weight" ? <>
      <label className="calendar-builder-control"><span>Load type</span><SelectDropdown label="Load type" value={row.intensityPreset || "bodyweight"} options={[{ value: "bodyweight", label: "Bodyweight" }, { value: "weight", label: "Added weight" }]} portal onChange={(intensityPreset) => onChange({ intensityPreset })} /></label>
      {row.intensityPreset === "weight" ? <><label className="calendar-builder-control"><span>Weight ({unitSystem === "imperial" ? "lb" : "kg"})</span><input type="number" min="0" value={row.intensityLow} onChange={(event) => onChange({ intensityLow: event.target.value, intensityUnit: unitSystem === "imperial" ? "lb" : "kg" })} /></label></> : null}
    </> : null}

    {row.intensityType === "rpe" ? <label className="calendar-builder-control"><span>RPE</span><SelectDropdown label="RPE" value={row.intensityLow || "5"} options={Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => ({ value, label: value }))} portal onChange={(intensityLow) => onChange({ intensityLow })} /></label> : null}

    {row.intensityType === "climbGrade" ? <>
      <label className="calendar-builder-control"><span>Grade system</span><SelectDropdown label="Grade system" value={climbSystem} options={(Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>).map((system) => ({ value: system, label: formatBuilderToken(system) }))} portal onChange={(system) => onChange({ intensityPreset: `relative:${system}` })} /></label>
      <label className="calendar-builder-control"><span>Grade mode</span><SelectDropdown label="Grade mode" value={row.intensityPreset.startsWith("relative:") ? "relative" : "absolute"} options={[{ value: "relative", label: "Relative to onsight" }, { value: "absolute", label: "Absolute grade" }]} portal onChange={(mode) => onChange({ intensityPreset: mode === "relative" ? `relative:${climbSystem}` : `${climbSystem}:${CLIMB_GRADES[climbSystem][0]}` })} /></label>
      {row.intensityPreset.startsWith("relative:") ? <label className="calendar-builder-control"><span>Relative level</span><input type="number" min="-8" max="4" value={row.intensityLow || "0"} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label> : <label className="calendar-builder-control"><span>Grade</span><SelectDropdown label="Climbing grade" value={row.intensityPreset.split(":")[1] ?? CLIMB_GRADES[climbSystem][0]} options={CLIMB_GRADES[climbSystem].map((grade) => ({ value: grade, label: grade }))} portal onChange={(grade) => onChange({ intensityPreset: `${climbSystem}:${grade}` })} /></label>}
    </> : null}

    {context ? <div className="calendar-builder-derived"><BuilderDerivedIntensityPreview intensity={rowIntensity(row, sport, unitSystem)} context={context} /></div> : null}
  </>;
  const exerciseStatus = exercisesLoading
    ? "Loading COROS exercises..."
    : row.exerciseId
      ? "Selected from your COROS exercise library."
      : exerciseOptions.length === 0
        ? "No exercises are available. Reconnect COROS and try again."
        : sport === "strength"
          ? "Choose an exact COROS exercise to continue."
          : "Optional for running steps.";

  return <div className={`calendar-builder-intensity-grid ${showExercise ? "has-exercise-workspace" : ""}`}>
    {showExercise ? <div className="calendar-builder-control calendar-builder-exercise-workspace is-wide">
      <span>{sport === "strength" ? "Exercise" : "Exercise (optional for running steps)"}</span>
      <ExerciseCombobox
        value={row.exerciseName}
        selectedId={row.exerciseId}
        options={exerciseOptions}
        placeholder={sport === "strength" ? "Search and select a COROS exercise" : "Search HYROX exercises"}
        label={sport === "strength" ? "Exercise" : "HYROX exercise"}
        loading={exercisesLoading}
        details={<div className="calendar-builder-exercise-details">
          <div className={`calendar-builder-exercise-status ${row.exerciseId ? "is-selected" : ""}`}>
            <strong>{row.exerciseId ? "Exercise selected" : sport === "strength" ? "Exercise required" : "Exercise optional"}</strong>
            <span>{exerciseStatus}</span>
          </div>
          <div className="calendar-builder-exercise-fields">{intensityControls}</div>
        </div>}
        onChange={selectExercise}
      />
    </div> : intensityControls}
  </div>;
}

/** Rest lengths lifters actually reach for; anything else goes in the field. */
const STRENGTH_REST_PRESETS = [30, 45, 60, 90, 120] as const;

/** Rest chips read as one clock format so they scan as a single scale. */
function formatRestChip(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatStrengthClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} min` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** How the load slot is set, folding the intensity type and its mode into one. */
type StrengthLoadMode = "bodyweight" | "added" | "unspecified";

function strengthLoadMode(row: BuilderRow): StrengthLoadMode {
  if (row.intensityType === "none") return "unspecified";
  return row.intensityPreset === "weight" ? "added" : "bodyweight";
}

/**
 * A strength set is written the way lifters write it — sets × work @ load,
 * then rest — so the editor is that line rather than a column of look-alike
 * fields. Everything COROS accepts for a Strength training step (reps or
 * seconds or a manual end, bodyweight or added load, sets, rest) lives here.
 */
function BuilderStrengthStepFields({
  row,
  exerciseOptions,
  exercisesLoading,
  allowedKinds,
  kindLabel,
  validationMessage,
  onChange,
  onKindChange
}: {
  row: BuilderRow;
  exerciseOptions: WorkoutExerciseOption[];
  exercisesLoading: boolean;
  allowedKinds: readonly BuilderKind[];
  kindLabel: string;
  validationMessage?: string;
  onChange: (update: Partial<BuilderRow>) => void;
  onKindChange: (kind: BuilderKind) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const targetTypes = workoutTargetsForStep("strength", "training", row.exerciseKind);
  const selectedExercise = row.exerciseId
    ? exerciseOptions.find((option) => option.id === row.exerciseId)
    : undefined;
  const loadMode = strengthLoadMode(row);
  const weightUnit = unitSystem === "imperial" ? "lb" : "kg";
  const restSeconds = Number(row.restSeconds);
  const sets = Number(row.sets);
  const perSet = row.targetType === "time" ? Number(row.timeMin) : Number(row.distanceKm);

  const measureLabels: Partial<Record<BuilderRow["targetType"], string>> = {
    reps: "reps",
    time: "seconds",
    open: "to lap button"
  };

  // Only worth saying once the sets multiply into something you can't read
  // straight off the line above.
  const restTotal = Number.isFinite(restSeconds) && sets > 1
    ? Math.max(0, restSeconds) * (sets - 1)
    : 0;
  const readout = !(sets > 1)
    ? undefined
    : row.targetType === "reps" && perSet > 0
      ? `${sets * perSet} reps in total${restTotal > 0 ? `, ${formatStrengthClock(restTotal)} resting` : ""}`
      : row.targetType === "time" && perSet > 0
        ? `About ${formatStrengthClock(sets * perSet + restTotal)} in total`
        : row.targetType === "open" && restTotal > 0
          ? `${formatStrengthClock(restTotal)} resting in total`
          : undefined;

  const changeMeasure = (targetType: BuilderRow["targetType"]) => {
    if (targetType === row.targetType) return;
    const update: Partial<BuilderRow> = { targetType };
    // Seed the field the new measure reads from so the step stays valid.
    if (targetType === "reps" && !(Number(row.distanceKm) > 0)) update.distanceKm = "10";
    if (targetType === "time" && !(Number(row.timeMin) > 0)) update.timeMin = "30";
    onChange(update);
  };

  const changeLoadMode = (mode: StrengthLoadMode) => {
    if (mode === "unspecified") {
      onChange({ intensityType: "none", intensityPreset: "" });
      return;
    }
    if (mode === "bodyweight") {
      onChange({ intensityType: "weight", intensityPreset: "bodyweight" });
      return;
    }
    onChange({
      intensityType: "weight",
      intensityPreset: "weight",
      intensityUnit: weightUnit,
      intensityLow: Number(row.intensityLow) > 0 ? row.intensityLow : ""
    });
  };

  return (
    <div className="calendar-builder-row-content strength-step">
      <div className="strength-step-form">
        <label className="calendar-builder-control strength-step-kind">
          <span>{kindLabel}</span>
          <SelectDropdown<BuilderKind>
            label={kindLabel ?? "Step type"}
            value={row.kind}
            options={allowedKinds.map((kind) => ({
              value: kind,
              label: BUILDER_KIND_META[kind].label
            }))}
            portal
            onChange={onKindChange}
          />
        </label>

        <section className="strength-block">
          <h4>Movement</h4>
          <ExerciseCombobox
            value={row.exerciseName}
            selectedId={row.exerciseId}
            options={exerciseOptions}
            placeholder="Search the COROS exercise library"
            label="Exercise"
            loading={exercisesLoading}
            hidePreview
            onChange={(selection) => onChange({
              exerciseName: selection.name,
              exerciseId: selection.id ?? "",
              exerciseKind: selection.exerciseKind
            })}
          />
          {exercisesLoading ? (
            <p className="strength-block-note">Loading the COROS exercise library.</p>
          ) : exerciseOptions.length === 0 ? (
            <p className="strength-block-note">No exercises loaded. Reconnect COROS to get the library.</p>
          ) : !row.exerciseId ? (
            <p className="strength-block-note">Pick one exercise from the list. The watch needs an exact match.</p>
          ) : null}
        </section>

        <section className="strength-block">
          <h4>Prescription</h4>
          <div className="set-line">
            <label className="set-line-cell">
              <span>Sets</span>
              <input
                type="number"
                min="1"
                max="99"
                value={row.sets}
                onChange={(event) => onChange({ sets: event.target.value })}
              />
            </label>

            <span className="set-line-operator" aria-hidden="true">×</span>

            <div className="set-line-cell">
              <span>Per set</span>
              <div className="set-line-compound">
                {row.targetType === "open" ? (
                  <span className="set-line-open">Ends on the lap button</span>
                ) : (
                  <input
                    type="number"
                    min="1"
                    max={row.targetType === "reps" ? 500 : undefined}
                    aria-label={row.targetType === "reps" ? "Repetitions per set" : "Seconds per set"}
                    value={row.targetType === "time" ? row.timeMin : row.distanceKm}
                    placeholder={row.targetType === "time" ? "30" : "10"}
                    onChange={(event) => onChange(
                      row.targetType === "time"
                        ? { timeMin: event.target.value }
                        : { distanceKm: event.target.value }
                    )}
                  />
                )}
                <SelectDropdown<BuilderRow["targetType"]>
                  className="set-line-select"
                  label="Measure each set by"
                  value={row.targetType}
                  options={targetTypes.map((target) => ({
                    value: target,
                    label: measureLabels[target] ?? builderTargetTypeLabel(target)
                  }))}
                  portal
                  onChange={changeMeasure}
                />
              </div>
            </div>

            <span className="set-line-operator" aria-hidden="true">@</span>

            <div className="set-line-cell is-load">
              <span>Load</span>
              <div className="set-line-compound">
                <SelectDropdown<StrengthLoadMode>
                  className="set-line-select"
                  label="Load"
                  value={loadMode}
                  options={[
                    { value: "bodyweight", label: "Bodyweight" },
                    { value: "added", label: "Added weight" },
                    { value: "unspecified", label: "Not set" }
                  ]}
                  portal
                  onChange={changeLoadMode}
                />
                {loadMode === "added" ? (
                  <span className="set-line-weight">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      aria-label={`Weight in ${weightUnit}`}
                      placeholder="20"
                      value={row.intensityLow}
                      onChange={(event) => onChange({
                        intensityLow: event.target.value,
                        intensityUnit: weightUnit
                      })}
                    />
                    <em>{weightUnit}</em>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {readout ? <p className="set-line-readout">{readout}</p> : null}
        </section>

        <section className="strength-block">
          <h4>Rest between sets</h4>
          <div className="rest-picker">
            {STRENGTH_REST_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={restSeconds === preset ? "is-selected" : ""}
                aria-pressed={restSeconds === preset}
                onClick={() => onChange({ restSeconds: String(preset) })}
              >
                {formatRestChip(preset)}
              </button>
            ))}
            <label className="rest-picker-custom">
              <input
                type="number"
                min="0"
                max="3600"
                step="5"
                aria-label="Rest between sets in seconds"
                value={row.restSeconds}
                onChange={(event) => onChange({ restSeconds: event.target.value })}
              />
              <em>sec</em>
            </label>
          </div>
        </section>

        {validationMessage ? (
          <p className="calendar-builder-error" role="alert">
            <AlertCircle size={13} aria-hidden="true" />
            <span>{validationMessage}</span>
          </p>
        ) : null}
      </div>

      {selectedExercise ? (
        <aside className="strength-step-aside">
          <ExercisePreview
            option={selectedExercise}
            name={row.exerciseName}
            showTargets
          />
        </aside>
      ) : null}
    </div>
  );
}

function BuilderStepFields({
  row,
  sport,
  context,
  exerciseOptions,
  exercisesLoading,
  allowedKinds,
  kindLabel = "Step type",
  onChange,
  onKindChange
}: {
  row: BuilderRow;
  sport: WorkoutSport;
  context?: WorkoutEditorContext;
  exerciseOptions: WorkoutExerciseOption[];
  exercisesLoading: boolean;
  allowedKinds: readonly BuilderKind[];
  kindLabel?: string;
  onChange: (update: Partial<BuilderRow>) => void;
  onKindChange: (kind: BuilderKind) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const stepKind = row.kind === "intervals" ? "training" : row.kind;
  const targetTypes = workoutTargetsForStep(sport, stepKind, row.exerciseKind);
  const usesExerciseWorkspace = (sport === "strength" || sport === "hyrox")
    && row.kind !== "warmup"
    && row.kind !== "cooldown";
  const validationMessage = builderRowValidationMessage(
    row,
    sport,
    exerciseOptions,
    exercisesLoading,
    unitSystem
  );

  if (sport === "strength" && row.kind === "training") {
    return (
      <BuilderStrengthStepFields
        row={row}
        exerciseOptions={exerciseOptions}
        exercisesLoading={exercisesLoading}
        allowedKinds={allowedKinds}
        kindLabel={kindLabel}
        validationMessage={validationMessage}
        onChange={onChange}
        onKindChange={onKindChange}
      />
    );
  }

  return (
    <div className={`calendar-builder-row-content ${usesExerciseWorkspace ? "has-exercise-workspace" : ""}`}>
      <div className="calendar-builder-primary-grid">
        <label className="calendar-builder-control">
          <span>{kindLabel}</span>
          <SelectDropdown<BuilderKind>
            label={kindLabel ?? "Step type"}
            value={row.kind}
            options={allowedKinds.map((kind) => ({
              value: kind,
              label: BUILDER_KIND_META[kind].label
            }))}
            portal
            onChange={onKindChange}
          />
        </label>

        <label className="calendar-builder-control">
          <span>{sport === "strength" && row.kind === "training" ? "Measure by" : "Target"}</span>
          <SelectDropdown<BuilderRow["targetType"]>
            label={sport === "strength" && row.kind === "training" ? "Measure by" : "Target"}
            value={row.targetType}
            options={targetTypes.map((target) => ({
              value: target,
              label: builderTargetTypeLabel(target)
            }))}
            portal
            onChange={(targetType) => onChange({ targetType })}
          />
        </label>

        <label className="calendar-builder-control">
          <span>{builderTargetLabel(row.targetType, sport, unitSystem)}</span>
          {row.targetType === "open" ? (
            <span className="calendar-builder-readonly-value">Ends when you press the lap button</span>
          ) : (
            <input
              type="number"
              min={row.targetType === "hrRecovery" ? 30 : row.targetType === "elevationGain" ? 20 : row.targetType === "distance" ? 0.01 : 1}
              max={row.targetType === "hrRecovery" ? 180 : row.targetType === "load" ? 999 : row.targetType === "routes" ? 20 : row.targetType === "reps" ? 500 : undefined}
              step={row.targetType === "distance" ? "0.1" : "1"}
              value={row.targetType === "time" ? row.timeMin : row.distanceKm}
              placeholder={row.targetType === "distance" ? (sport === "swim" ? "100" : "0.8") : row.targetType === "hrRecovery" ? "120" : sport === "strength" && row.targetType === "time" ? "30" : "10"}
              onChange={(event) => onChange(
                row.targetType === "time"
                  ? { timeMin: event.target.value }
                  : { distanceKm: event.target.value }
              )}
            />
          )}
        </label>

        {sport === "strength" && row.kind === "training" ? (
          <>
            <label className="calendar-builder-control">
              <span>Sets</span>
              <input
                type="number"
                min="1"
                max="99"
                value={row.sets}
                onChange={(event) => onChange({ sets: event.target.value })}
              />
            </label>
            <label className="calendar-builder-control">
              <span>Rest between sets (sec)</span>
              <input
                type="number"
                min="0"
                max="3600"
                step="5"
                value={row.restSeconds}
                onChange={(event) => onChange({ restSeconds: event.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>

      <BuilderIntensityFields
        row={row}
        sport={sport}
        context={context}
        exerciseOptions={exerciseOptions}
        exercisesLoading={exercisesLoading}
        onChange={onChange}
      />
      {validationMessage ? (
        <p className="calendar-builder-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          <span>{validationMessage}</span>
        </p>
      ) : null}
    </div>
  );
}

function BuilderRepeatFields({
  row,
  sport,
  context,
  exerciseOptions,
  exercisesLoading,
  activeChildId,
  reducedMotion,
  onChange,
  onActiveChildChange
}: {
  row: BuilderRow;
  sport: WorkoutSport;
  context?: WorkoutEditorContext;
  exerciseOptions: WorkoutExerciseOption[];
  exercisesLoading: boolean;
  activeChildId: number | null;
  reducedMotion: boolean | null;
  onChange: (update: Partial<BuilderRow>) => void;
  onActiveChildChange: (id: number | null) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const children = row.children ?? [];
  const childKinds = WORKOUT_SPORT_CAPABILITIES[sport].stepKinds as readonly BuilderKind[];
  const repeatCount = Number(row.repeats) || 0;
  const repeatError = !Number.isInteger(Number(row.repeats))
    || Number(row.repeats) < 1
    || Number(row.repeats) > 99
    ? "Enter between 1 and 99 repeats."
    : children.length === 0
      ? "Add at least one step inside this repeat."
      : undefined;
  const updateChild = (childId: number, update: Partial<BuilderRow>) => {
    onChange({
      children: children.map((child) =>
        child.id === childId ? { ...child, ...update } : child
      )
    });
  };
  const changeChildKind = (childId: number, kind: BuilderKind) => {
    onChange({
      children: children.map((child) =>
        child.id === childId
          ? changeBuilderRowKind(child, kind, sport)
          : child
      )
    });
  };
  const moveChild = (childId: number, direction: -1 | 1) => {
    const index = children.findIndex((child) => child.id === childId);
    const target = children[index + direction];
    if (index < 0 || !target) return;
    onChange({ children: moveBuilderRow(children, childId, target.id) });
  };

  return (
    <div className="calendar-builder-repeat">
      <div className="calendar-builder-repeat-settings">
        <div className="calendar-builder-repeat-copy">
          <Repeat2 size={15} aria-hidden="true" />
          <span>
            <strong>Repeat sequence</strong>
            <small>Every sub-step below runs in order, then the sequence starts again.</small>
          </span>
        </div>
        <div className="calendar-builder-repeat-count">
          <span>Times</span>
          <button
            type="button"
            onClick={() => onChange({ repeats: String(Math.max(1, repeatCount - 1)) })}
            disabled={repeatCount <= 1}
            aria-label="Decrease repeat count"
          >
            −
          </button>
          <input
            type="number"
            min="1"
            max="99"
            aria-label="Repeat count"
            value={row.repeats}
            onChange={(event) => onChange({ repeats: event.target.value })}
          />
          <button
            type="button"
            onClick={() => onChange({ repeats: String(Math.min(99, repeatCount + 1)) })}
            disabled={repeatCount >= 99}
            aria-label="Increase repeat count"
          >
            +
          </button>
        </div>
      </div>
      {repeatError ? (
        <p className="calendar-builder-error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          <span>{repeatError}</span>
        </p>
      ) : null}

      <div className="calendar-builder-repeat-children">
        {children.map((child, childIndex) => {
          const isActive = activeChildId === child.id;
          const ChildIcon = child.kind === "training" && sport === "strength"
            ? Dumbbell
            : BUILDER_KIND_META[child.kind].Icon;
          const childError = builderRowValidationMessage(
            child,
            sport,
            exerciseOptions,
            exercisesLoading,
            unitSystem
          );
          return (
            <motion.section
              key={child.id}
              layout={reducedMotion ? false : "position"}
              className={`calendar-builder-repeat-child ${isActive ? "is-active" : "is-collapsed"} ${childError ? "has-error" : ""}`}
              data-builder-kind={child.kind}
            >
              <header className="calendar-builder-repeat-child-header">
                <span className="calendar-builder-repeat-child-index" aria-hidden="true">{childIndex + 1}</span>
                <button
                  type="button"
                  className="calendar-builder-repeat-child-toggle"
                  aria-expanded={isActive}
                  aria-controls={`builder-repeat-child-${child.id}`}
                  onClick={() => onActiveChildChange(isActive ? null : child.id)}
                >
                  <span className="calendar-builder-step-icon" aria-hidden="true">
                    <ChildIcon size={14} />
                  </span>
                  <span>
                    <small>Sub-step {childIndex + 1}</small>
                    <strong>{BUILDER_KIND_META[child.kind].label}</strong>
                  </span>
                  {!isActive ? (
                    <span className="calendar-builder-repeat-child-summary">
                      {builderRowSummary(
                        child,
                        sport,
                        unitSystem
                      ).map((item) => item.value).join(", ")}
                    </span>
                  ) : null}
                  <ChevronDown className={isActive ? "is-open" : ""} size={15} aria-hidden="true" />
                </button>
                <div className="calendar-builder-repeat-child-actions">
                  <button type="button" onClick={() => moveChild(child.id, -1)} disabled={childIndex === 0} aria-label={`Move sub-step ${childIndex + 1} up`} title="Move up"><ChevronUp size={13} aria-hidden="true" /></button>
                  <button type="button" onClick={() => moveChild(child.id, 1)} disabled={childIndex === children.length - 1} aria-label={`Move sub-step ${childIndex + 1} down`} title="Move down"><ChevronDown size={13} aria-hidden="true" /></button>
                  <button
                    type="button"
                    onClick={() => {
                      const duplicate = cloneBuilderRow(child);
                      onChange({
                        children: [
                          ...children.slice(0, childIndex + 1),
                          duplicate,
                          ...children.slice(childIndex + 1)
                        ]
                      });
                      onActiveChildChange(duplicate.id);
                    }}
                    aria-label={`Duplicate sub-step ${childIndex + 1}`}
                    title="Duplicate sub-step"
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="is-delete"
                    onClick={() => {
                      const nextChildren = children.filter((candidate) => candidate.id !== child.id);
                      onChange({ children: nextChildren });
                      if (isActive) {
                        onActiveChildChange(nextChildren[Math.min(childIndex, nextChildren.length - 1)]?.id ?? null);
                      }
                    }}
                    disabled={children.length === 1}
                    aria-label={`Delete sub-step ${childIndex + 1}`}
                    title={children.length === 1 ? "A repeat needs at least one sub-step" : "Delete sub-step"}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <AnimatePresence initial={false}>
                {isActive ? (
                  <motion.div
                    id={`builder-repeat-child-${child.id}`}
                    className="calendar-builder-repeat-child-reveal"
                    initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
                    exit={{ height: 0, opacity: 0, overflow: "hidden" }}
                    transition={reducedMotion ? { duration: 0 } : {
                      height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
                      opacity: { duration: 0.12, ease: "easeOut" }
                    }}
                  >
                    <BuilderStepFields
                      row={child}
                      sport={sport}
                      context={context}
                      exerciseOptions={exerciseOptions}
                      exercisesLoading={exercisesLoading}
                      allowedKinds={childKinds}
                      kindLabel="Sub-step type"
                      onChange={(update) => updateChild(child.id, update)}
                      onKindChange={(kind) => changeChildKind(child.id, kind)}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.section>
          );
        })}
      </div>

      <div className="calendar-builder-repeat-add" role="group" aria-label="Add a sub-step to repeat">
        <span><Plus size={12} aria-hidden="true" /> Add sub-step</span>
        <div>
          {childKinds.map((kind) => {
            const meta = BUILDER_KIND_META[kind];
            const KindIcon = kind === "training" && sport === "strength" ? Dumbbell : meta.Icon;
            return (
              <button
                key={kind}
                type="button"
                data-kind={kind}
                onClick={() => {
                  const child = emptyRow(kind, sport);
                  onChange({ children: [...children, child] });
                  onActiveChildChange(child.id);
                }}
              >
                <KindIcon size={12} aria-hidden="true" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatBuilderToken(value: string): string {
  const formatted = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
    .replace("Yds", "YDS")
    .replace("Uiaa", "UIAA");
  return formatted === "Warmup" ? "Warm-up" : formatted === "Cooldown" ? "Cool-down" : formatted;
}

function BuilderDerivedIntensityPreview({ intensity, context }: { intensity: WorkoutIntensityInput; context: WorkoutEditorContext }) {
  const configuredZone = (key: keyof WorkoutEditorContext["zones"], preset: string | undefined, id: number | undefined) =>
    context.zones[key]?.find((zone) => zone.id === id || zone.key === preset || zone.label === preset);
  const clock = (secondsPerKm: number) => {
    const seconds = Math.round(secondsPerKm * (context.paceUnit === "mi" ? 1.609344 : 1));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/${context.paceUnit}`;
  };
  if (intensity.type === "heartRatePercent") {
    const fallback = HEART_RATE_PRESETS[intensity.basis].find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone(intensity.basis, intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = intensity.lowPercent ?? zone?.lowPercent ?? fallback?.low;
    const high = intensity.highPercent ?? zone?.highPercent ?? fallback?.high;
    const reference = intensity.basis === "lthr" ? context.lthrBpm : context.maxHr;
    if (low !== undefined && high !== undefined && reference) {
      const derive = (percent: number) => intensity.basis === "reserve" && context.restingHr
        ? context.restingHr + (reference - context.restingHr) * percent / 100
        : reference * percent / 100;
      return <span className="workout-control-hint">Derived: {Math.round(derive(low))}-{Math.round(derive(high))} bpm</span>;
    }
  }
  if (intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent") {
    const fallback = PACE_PRESETS.find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone("thresholdPace", intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = intensity.lowPercent ?? zone?.lowPercent ?? fallback?.low;
    const high = intensity.highPercent ?? zone?.highPercent ?? fallback?.high;
    if (low && high && context.thresholdPaceSecondsPerKm) {
      return <span className="workout-control-hint">Derived: {clock(context.thresholdPaceSecondsPerKm * 100 / high)} to {clock(context.thresholdPaceSecondsPerKm * 100 / low)}</span>;
    }
  }
  if (intensity.type === "ftpPercent") {
    const fallback = FTP_PRESETS.find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone("ftp", intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = intensity.lowPercent ?? zone?.lowPercent ?? fallback?.low;
    const high = intensity.highPercent ?? zone?.highPercent ?? fallback?.high;
    if (low !== undefined && high !== undefined && context.ftp) {
      return <span className="workout-control-hint">Derived: {Math.round(context.ftp * low / 100)}-{Math.round(context.ftp * high / 100)} W</span>;
    }
  }
  if (intensity.type === "power" && intensity.preset && context.criticalPower) {
    const fallback = RUNNING_POWER_PRESETS.find((zone) => zone.preset === intensity.preset);
    const zone = configuredZone("runningPower", intensity.preset, intensity.zoneId ?? fallback?.id);
    const low = zone?.lowPercent ?? fallback?.low;
    const high = zone?.highPercent ?? fallback?.high;
    if (low !== undefined && high !== undefined) {
      return <span className="workout-control-hint">Derived: {Math.round(context.criticalPower * low / 100)}-{Math.round(context.criticalPower * high / 100)} W</span>;
    }
  }
  return null;
}

export function AddWorkoutModal({
  api,
  dateKey,
  sportTypes,
  onClose,
  onScheduled,
  onError,
  onEditLibrary,
  libraryOnly = false
}: AddWorkoutModalProps) {
  const { unitSystem } = useUnitSystem();
  const reducedMotion = useReducedMotion();
  const todayKey = getLocalHappenDayKey();
  // Logging makes no sense for a day that hasn't happened yet, and COROS
  // rejects scheduling in the past — so each side of "today" gets the
  // tab set (and default tab) that can actually succeed.
  const canLogActivity = !libraryOnly && dateKey <= todayKey;
  const canSchedule = dateKey >= todayKey;
  const [tab, setTab] = useState<AddTab>(libraryOnly ? "builder" : canSchedule ? "quick" : "activity");
  const [submitting, setSubmitting] = useState(false);

  // Quick training
  const [quickName, setQuickName] = useState("");
  const [quickDistanceKm, setQuickDistanceKm] = useState("");
  const [quickPace, setQuickPace] = useState("");
  const [quickSave, setQuickSave] = useState(false);

  // Library
  const [library, setLibrary] = useState<TrainingHubLibraryWorkout[] | null>(null);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  // Log activity
  const [activitySportId, setActivitySportId] = useState(DEFAULT_LOG_SPORT_OPTION.id);
  const [activitySportSearch, setActivitySportSearch] = useState("");
  const [activitySportSearchOpen, setActivitySportSearchOpen] = useState(false);
  const [activityTime, setActivityTime] = useState(() =>
    dateKey === todayKey
      ? new Date(Date.now() - 3_600_000).toTimeString().slice(0, 5)
      : "12:00"
  );
  const [activityHours, setActivityHours] = useState("");
  const [activityMinutes, setActivityMinutes] = useState("");
  const [activityDistance, setActivityDistance] = useState("");
  const [activityCalories, setActivityCalories] = useState("");
  const [activityAvgHr, setActivityAvgHr] = useState("");

  // Builder
  const [builderSport, setBuilderSport] = useState<WorkoutSport>("run");
  const [builderPoolLength, setBuilderPoolLength] = useState("25");
  const [builderPoolUnit, setBuilderPoolUnit] = useState<"m" | "yd">("m");
  const [builderGradeSystem, setBuilderGradeSystem] = useState<keyof typeof CLIMB_SYSTEM_IDS>("yds");
  const [builderExercises, setBuilderExercises] = useState<WorkoutExerciseOption[]>([]);
  const [builderExercisesLoading, setBuilderExercisesLoading] = useState(false);
  const [builderContext, setBuilderContext] = useState<WorkoutEditorContext>();
  const [builderName, setBuilderName] = useState("");
  const [builderDescription, setBuilderDescription] = useState("");
  const [builderSave, setBuilderSave] = useState(true);
  const [rows, setRows] = useState<BuilderRow[]>([
    emptyRow("warmup"),
    emptyRow("training"),
    emptyRow("cooldown")
  ]);
  const [activeBuilderRowId, setActiveBuilderRowId] = useState<number | null>(rows[0]?.id ?? null);
  const [activeBuilderChildId, setActiveBuilderChildId] = useState<number | null>(null);
  const [draggedBuilderRowId, setDraggedBuilderRowId] = useState<number | null>(null);
  const [dropTargetBuilderRowId, setDropTargetBuilderRowId] = useState<number | null>(null);
  const [builderReorderMessage, setBuilderReorderMessage] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  useEffect(() => {
    void api.getWorkoutEditorContext(unitSystem)
      .then((context) => {
        setBuilderContext(context);
        setBuilderPoolLength(String(Number(context.defaultPoolLength.value.toFixed(2))));
        setBuilderPoolUnit(context.defaultPoolLength.unit);
      })
      .catch(() => undefined);
  }, [api, unitSystem]);

  useEffect(() => {
    if (tab !== "library" || library !== null) {
      return;
    }
    void api
      .listLibraryWorkouts()
      .then(setLibrary)
      .catch((cause: unknown) => {
        setLibrary([]);
        onError(cause instanceof Error ? cause.message : String(cause));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (builderSport !== "strength" && builderSport !== "hyrox") {
      setBuilderExercises([]);
      setBuilderExercisesLoading(false);
      return;
    }
    let active = true;
    setBuilderExercisesLoading(true);
    void api.listWorkoutExercises(builderSport)
      .then((options) => { if (active) setBuilderExercises(options); })
      .catch(() => { if (active) setBuilderExercises([]); })
      .finally(() => { if (active) setBuilderExercisesLoading(false); });
    return () => { active = false; };
  }, [api, builderSport]);

  useEffect(() => {
    if ((builderSport === "indoorClimb" || builderSport === "bouldering") && builderContext?.climbSystems[builderSport]) {
      setBuilderGradeSystem(builderContext.climbSystems[builderSport]!);
    }
  }, [builderContext, builderSport]);

  const filteredLibrary = useMemo(() => {
    const query = libraryFilter.trim().toLowerCase();
    const items = library ?? [];
    if (!query) {
      return items;
    }
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [library, libraryFilter]);

  const corosSportOptions = useMemo(() => {
    const seen = new Set<string>();
    return sportTypes
      .map(createCorosLogSportOption)
      .filter((option) => {
        const key = normalizeSportLabel(option.label);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [sportTypes]);

  // One catalog: curated options first (stable defaults), then every COROS
  // sport type that doesn't duplicate a curated label.
  const combinedSportOptions = useMemo(() => {
    const seen = new Set<string>();
    const combined: LogSportOption[] = [];
    for (const option of [...SUGGESTED_LOG_SPORT_OPTIONS, ...corosSportOptions]) {
      const key = normalizeSportLabel(option.label);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      combined.push(option);
    }
    return combined;
  }, [corosSportOptions]);

  const selectedActivitySport =
    combinedSportOptions.find((option) => option.id === activitySportId) ??
    DEFAULT_LOG_SPORT_OPTION;

  const visibleSportOptions = useMemo(() => {
    const query = normalizeSportLabel(activitySportSearch);
    if (query) {
      return combinedSportOptions
        .filter((option) => normalizeSportLabel(option.label).includes(query))
        .slice(0, 12);
    }

    const defaults = combinedSportOptions.slice(
      0,
      SUGGESTED_LOG_SPORT_OPTIONS.length
    );
    // Keep a selection made through search visible after the query is cleared.
    if (!defaults.some((option) => option.id === selectedActivitySport.id)) {
      return [selectedActivitySport, ...defaults];
    }
    return defaults;
  }, [activitySportSearch, combinedSportOptions, selectedActivitySport]);

  const showActivityDistance = selectedActivitySport.distanceUnit !== "none";
  const activityDistanceUnit =
    selectedActivitySport.distanceUnit === "m"
      ? swimDistanceUnit(unitSystem)
      : distanceUnit(unitSystem);

  const run = async (action: () => Promise<void>, successMessage: string) => {
    setSubmitting(true);
    try {
      await action();
      onScheduled(successMessage);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuick = () =>
    run(async () => {
      const name = quickName.trim() || "Quick Run";
      const distanceMeters = displayDistanceToMeters(
        Number(quickDistanceKm),
        unitSystem
      );
      const rawPace = quickPace.trim();
      const pace = normalizeQuickPace(rawPace, unitSystem);
      const entry: PlanWorkoutEntryInput = rawPace
        ? {
            key: "calendar-quick",
            name,
            steps: [
              {
                kind: "training",
                target_distance_meters: Math.round(distanceMeters),
                pace
              }
            ]
          }
        : { key: "calendar-quick", name, distance_km: distanceMeters / 1000 };
      await api.createAndScheduleWorkout(entry, dateKey, unitSystem, quickSave);
    }, `Scheduled "${quickName.trim() || "Quick Run"}" on ${formatHappenDayLabel(dateKey)}.`);

  const submitLibrary = () =>
    run(async () => {
      if (!selectedProgramId) {
        throw new Error("Pick a workout from your library first.");
      }
      await api.scheduleLibraryWorkout(selectedProgramId, dateKey);
    }, `Workout scheduled on ${formatHappenDayLabel(dateKey)}.`);

  const submitBuilder = () =>
    run(async () => {
      const entry: PlanWorkoutEntryInput = {
        key: "calendar-builder",
        name: builderName.trim() || "Structured Workout",
        ...(builderDescription.trim() ? { description: builderDescription.trim() } : {}),
        sport: builderSport,
        ...((builderSport === "swim")
          ? { sport_options: { poolLength: { value: Number(builderPoolLength), unit: builderPoolUnit } } }
          : (builderSport === "indoorClimb" || builderSport === "bouldering")
            ? { sport_options: { gradingSystem: builderGradeSystem } }
            : {}),
        steps: rows.flatMap((row) => rowToSteps(row, builderSport, unitSystem))
      };
      if (libraryOnly) {
        await api.createLibraryWorkout(entry, unitSystem);
      } else {
        await api.createAndScheduleWorkout(entry, dateKey, unitSystem, builderSave);
      }
    }, libraryOnly
      ? `Saved "${builderName.trim() || "Structured Workout"}" to the Workout Library.`
      : `Scheduled "${builderName.trim() || "Structured Workout"}" on ${formatHappenDayLabel(dateKey)}.`);

  const submitActivity = () =>
    run(async () => {
      const [hourPart, minutePart] = activityTime.split(":").map(Number);
      const start = dateFromKey(dateKey);
      start.setHours(hourPart || 0, minutePart || 0, 0, 0);
      const durationSec = Math.round(
        (Number(activityHours) || 0) * 3600 + (Number(activityMinutes) || 0) * 60
      );
      const calories = Number(activityCalories);
      const avgHr = Number(activityAvgHr);
      const distanceM =
        selectedActivitySport.distanceUnit === "m"
          ? Math.round(
              swimDistanceToMeters(Number(activityDistance) || 0, unitSystem)
            )
          : selectedActivitySport.distanceUnit === "km"
            ? Math.round(
                displayDistanceToMeters(Number(activityDistance) || 0, unitSystem)
              )
            : 0;
      const input: ManualActivityInput = {
        sport: selectedActivitySport.uploadSport,
        startTimeIso: start.toISOString(),
        durationSec,
        distanceM,
        ...(calories > 0 ? { calories } : {}),
        ...(avgHr > 0 ? { avgHr } : {})
      };
      await api.addManualActivityToCoros(input);
    }, `Activity logged on ${formatHappenDayLabel(dateKey)}. COROS may take a moment to show it.`);

  const quickDistance = Number(quickDistanceKm);
  const quickDistanceValid = Number.isFinite(quickDistance) && quickDistance > 0;
  const quickPaceValid = isQuickPaceValid(quickPace);
  const quickValid = quickDistanceValid && quickPaceValid;
  const quickPaceLabel = quickPace.trim()
    ? normalizeQuickPace(quickPace, unitSystem)
    : "";
  const builderValid = rows.length > 0 && rows.every((row) =>
    rowIsValid(
      row,
      builderSport,
      builderExercises,
      builderExercisesLoading,
      unitSystem
    )
  );
  const builderSportMeta = BUILDER_SPORT_META[builderSport];
  const builderTotals = useMemo(() => builderWorkoutTotals(rows, builderSport), [rows, builderSport]);
  const builderStructure = useMemo(() => builderStructureCounts(rows), [rows]);
  const builderStepKinds = useMemo<BuilderKind[]>(() => {
    const supported = WORKOUT_SPORT_CAPABILITIES[builderSport].stepKinds;
    return BUILDER_ADD_KIND_ORDER.filter((kind) =>
      kind === "intervals"
        ? builderSport !== "strength"
        : (supported as readonly BuilderKind[]).includes(kind)
    );
  }, [builderSport]);
  const activityValid =
    activityTime.trim() !== "" &&
    (Number(activityHours) || 0) * 60 + (Number(activityMinutes) || 0) > 0;
  const quickDuration = quickPaceValid
    ? quickWorkoutDuration(quickDistance, quickPace, unitSystem)
    : null;
  const availableTabs: AddTab[] = libraryOnly ? ["builder"] : [
    ...(canSchedule ? (["quick", "library", "builder"] as AddTab[]) : []),
    ...(canLogActivity ? (["activity"] as AddTab[]) : [])
  ];

  const reorderBuilderRow = (sourceId: number, targetId: number) => {
    const sourceRow = rows.find((row) => row.id === sourceId);
    const nextRows = moveBuilderRow(rows, sourceId, targetId);
    if (!sourceRow || nextRows === rows) return;
    setRows(nextRows);
    const nextIndex = nextRows.findIndex((row) => row.id === sourceId);
    setBuilderReorderMessage(`${formatBuilderToken(sourceRow.kind)} moved to step ${nextIndex + 1}.`);
  };

  const moveBuilderRowBy = (rowId: number, direction: -1 | 1) => {
    const currentIndex = rows.findIndex((row) => row.id === rowId);
    const targetIndex = currentIndex + direction;
    const targetRow = rows[targetIndex];
    if (currentIndex < 0 || !targetRow) return;
    reorderBuilderRow(rowId, targetRow.id);
  };

  const selectBuilderSport = (sport: WorkoutSport) => {
    // Re-selecting the active sport must not wipe the steps being built.
    if (sport === builderSport) return;
    const nextRows = sport === "strength"
      ? [emptyRow("training", sport)]
      : [emptyRow("warmup", sport), emptyRow("training", sport), emptyRow("cooldown", sport)];
    setBuilderSport(sport);
    setRows(nextRows);
    setActiveBuilderRowId(nextRows[0]?.id ?? null);
    setActiveBuilderChildId(null);
  };

  const addBuilderStep = (kind: BuilderKind) => {
    const nextRow = emptyRow(kind, builderSport);
    setRows((current) => [...current, nextRow]);
    setActiveBuilderRowId(nextRow.id);
    setActiveBuilderChildId(nextRow.children?.[0]?.id ?? null);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="calendar-modal-backdrop"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className={`calendar-modal calendar-modal-workspace calendar-modal-${tab} panel`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-calendar-title"
          style={tab === "builder"
            ? { "--builder-sport": builderSportMeta.colorVar } as CSSProperties
            : undefined}
          initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 18, scale: 0.98 }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 30 }}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="calendar-modal-header">
            <div>
              <p className="calendar-modal-date">
                <CalendarDays size={13} aria-hidden="true" />
                {libraryOnly ? "Reusable workout" : formatHappenDayLabel(dateKey)}
              </p>
              <h3 id="add-calendar-title">{libraryOnly ? "Create library workout" : "Add to calendar"}</h3>
            </div>
            <button
              type="button"
              className="ghost-button calendar-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="calendar-modal-tabs" role="tablist" aria-label={libraryOnly ? "Workout creation method" : "Add to calendar method"}>
            {availableTabs.map((id) => {
              const { label, Icon } = ADD_TAB_ITEMS[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`calendar-modal-tab ${tab === id ? "is-active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>

          {tab === "quick" ? (
            <form
              className="calendar-modal-body calendar-quick-body"
              onSubmit={(event) => {
                event.preventDefault();
                if (quickValid && !submitting) void submitQuick();
              }}
            >
              <div className="calendar-quick-settings">
                <div className="calendar-quick-intro">
                  <h4>Workout settings</h4>
                  <p>Set the basics for a simple distance workout.</p>
                </div>

                <div className="calendar-quick-fields">
                  <label className="calendar-field calendar-quick-name">
                    <span className="calendar-field-label">
                      <span>Workout name</span>
                      <small>Optional</small>
                    </span>
                    <input
                      type="text"
                      value={quickName}
                      onChange={(event) => setQuickName(event.target.value)}
                      placeholder="Easy run"
                    />
                  </label>

                  <label className="calendar-field">
                    <span className="calendar-field-label">
                      <span>Distance</span>
                      <small>Required</small>
                    </span>
                    <span className="calendar-quick-input">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        inputMode="decimal"
                        value={quickDistanceKm}
                        onChange={(event) => setQuickDistanceKm(event.target.value)}
                        placeholder="8.0"
                        aria-label={`Distance in ${unitSystem === "imperial" ? "miles" : "kilometres"}`}
                        required
                      />
                      <span aria-hidden="true">{distanceUnit(unitSystem)}</span>
                    </span>
                    <span className="calendar-quick-presets" role="group" aria-label="Common distances">
                      {QUICK_DISTANCE_PRESETS.map((distance) => (
                        <button
                          key={distance}
                          type="button"
                          className={quickDistance === distance ? "is-active" : ""}
                          onClick={() => setQuickDistanceKm(String(distance))}
                        >
                          {distance} {distanceUnit(unitSystem)}
                        </button>
                      ))}
                    </span>
                  </label>

                  <label className="calendar-field">
                    <span className="calendar-field-label">
                      <span>Target pace</span>
                      <small>Optional</small>
                    </span>
                    <span className={`calendar-quick-input ${quickPaceValid ? "" : "has-error"}`}>
                      <input
                        type="text"
                        value={quickPace}
                        onChange={(event) => setQuickPace(event.target.value)}
                        placeholder="5:30"
                        aria-label={`Target pace per ${unitSystem === "imperial" ? "mile" : "kilometre"}`}
                        aria-invalid={!quickPaceValid}
                      />
                      <span aria-hidden="true">/{distanceUnit(unitSystem)}</span>
                    </span>
                    <small className={`calendar-field-help ${quickPaceValid ? "" : "is-error"}`}>
                      {quickPaceValid
                        ? "Use minutes and seconds, for example 5:30."
                        : "Enter pace as minutes:seconds, for example 5:30."}
                    </small>
                  </label>
                </div>

                <label className={`calendar-quick-save ${quickSave ? "is-checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={quickSave}
                    onChange={(event) => setQuickSave(event.target.checked)}
                  />
                  <BookmarkPlus size={18} aria-hidden="true" />
                  <span>
                    <strong>Save to workout library</strong>
                    <small>Keep a reusable copy after scheduling.</small>
                  </span>
                </label>
              </div>

              <section className="calendar-quick-preview" aria-labelledby="calendar-quick-preview-title" aria-live="polite">
                <header className="calendar-quick-preview-header">
                  <div>
                    <h4 id="calendar-quick-preview-title">Workout preview</h4>
                    <p>{formatHappenDayLabel(dateKey)}</p>
                  </div>
                  <span className={quickValid ? "is-ready" : ""}>
                    {quickValid ? "Ready" : "In progress"}
                  </span>
                </header>

                <div className="calendar-quick-preview-title">
                  <span aria-hidden="true"><Footprints size={20} /></span>
                  <div>
                    <strong>{quickName.trim() || "Quick Run"}</strong>
                    <small>Distance workout</small>
                  </div>
                </div>

                <dl className="calendar-quick-preview-metrics">
                  <div>
                    <dt>Distance</dt>
                    <dd>{quickDistanceValid ? `${quickDistance.toLocaleString()} ${distanceUnit(unitSystem)}` : "-"}</dd>
                  </div>
                  <div>
                    <dt>Target pace</dt>
                    <dd>{quickPaceLabel && quickPaceValid ? quickPaceLabel : "Open"}</dd>
                  </div>
                  <div>
                    <dt>Estimated time</dt>
                    <dd>{quickDuration ?? "-"}</dd>
                  </div>
                </dl>

                <div className="calendar-quick-preview-step">
                  <span aria-hidden="true">1</span>
                  <div>
                    <strong>Run</strong>
                    <small>
                      {quickDistanceValid ? `${quickDistance.toLocaleString()} ${distanceUnit(unitSystem)}` : "Set a distance"}
                      {quickPaceLabel && quickPaceValid ? ` at ${quickPaceLabel}` : " at open pace"}
                    </small>
                  </div>
                </div>
              </section>

              <footer className="calendar-modal-footer">
                <div className="calendar-quick-summary" aria-live="polite">
                  {quickDistanceValid && quickPaceValid ? (
                    <>
                      <span>Workout total</span>
                      <strong>
                        {quickDistance.toLocaleString()} {distanceUnit(unitSystem)}
                        {quickDuration ? `, about ${quickDuration}` : ""}
                      </strong>
                    </>
                  ) : !quickDistanceValid ? (
                    <span>Enter a distance to enable scheduling.</span>
                  ) : (
                    <span>Correct the pace format to continue.</span>
                  )}
                </div>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!quickValid || submitting}
                >
                  <CalendarPlus size={16} aria-hidden="true" />
                  {submitting ? "Scheduling…" : "Schedule workout"}
                </button>
              </footer>
            </form>
          ) : null}

          {tab === "library" ? (
            <div className="calendar-modal-body calendar-library-body">
              <label className="calendar-field">
                <span>Search</span>
                <input
                  type="text"
                  value={libraryFilter}
                  onChange={(event) => setLibraryFilter(event.target.value)}
                  placeholder="Filter workouts…"
                />
              </label>
              <div className="calendar-library-list">
                {library === null ? (
                  <p className="calendar-detail-empty">Loading library…</p>
                ) : filteredLibrary.length === 0 ? (
                  <p className="calendar-detail-empty">No workouts in your library.</p>
                ) : (
                  filteredLibrary.map((item) => (
                    <div key={item.id} className={`calendar-library-item-row ${selectedProgramId === item.id ? "is-selected" : ""}`}>
                      <button
                        type="button"
                        className="calendar-library-item"
                        onClick={() => setSelectedProgramId(item.id)}
                      >
                        <span className="calendar-chip-name">{item.name}</span>
                        <span className="calendar-chip-meta">
                          {[item.volume, item.trainingLoad !== undefined ? `${Math.round(item.trainingLoad)} TL` : null]
                            .filter(Boolean)
                            .join(" · ") || "No calculated totals"}
                        </span>
                      </button>
                      {item.sportType && item.sportType >= 1 && item.sportType <= 9 ? (
                        <button type="button" className="ghost-button calendar-library-edit" onClick={() => onEditLibrary(item.id)}>
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </button>
                      ) : (
                        <span className="calendar-library-readonly">View only</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <footer className="calendar-modal-footer">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!selectedProgramId || submitting}
                  onClick={() => void submitLibrary()}
                >
                  {submitting ? "Scheduling…" : "Schedule"}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "builder" ? (
            <div className="calendar-modal-body calendar-builder-body">
              <div className="calendar-builder-workspace">
                <aside className="calendar-builder-settings" aria-label="Workout settings">
                  <div className="calendar-builder-settings-copy">
                    <h4>Workout settings</h4>
                    <p>Set the basics for your workout.</p>
                  </div>
                  <div className="calendar-builder-sport-field">
                    <span className="calendar-builder-field-label" id="calendar-builder-sport-label">Sport</span>
                    <div
                      className="calendar-builder-sport-grid"
                      role="group"
                      aria-labelledby="calendar-builder-sport-label"
                    >
                      {WORKOUT_SPORTS.map((sport) => {
                        const meta = BUILDER_SPORT_META[sport];
                        const selected = sport === builderSport;
                        return (
                          <button
                            key={sport}
                            type="button"
                            aria-pressed={selected}
                            className={`calendar-builder-sport-chip ${selected ? "is-active" : ""}`}
                            style={{ "--chip-sport": meta.colorVar } as CSSProperties}
                            onClick={() => selectBuilderSport(sport)}
                          >
                            <meta.Icon size={16} aria-hidden="true" />
                            <span>{formatWorkoutSport(sport)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {builderSport === "swim" ? <div className="calendar-field-row"><label className="calendar-field"><span>Pool length ({swimDistanceUnit(unitSystem)})</span><input type="number" min="1" value={builderPoolLength} onChange={(event) => { setBuilderPoolLength(event.target.value); setBuilderPoolUnit(unitSystem === "imperial" ? "yd" : "m"); }} /></label></div> : null}
                  {(builderSport === "indoorClimb" || builderSport === "bouldering") ? <label className="calendar-field"><span>Grading system</span><SelectDropdown label="Grading system" value={builderGradeSystem} options={(Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>).map((system) => ({ value: system, label: formatBuilderToken(system) }))} portal onChange={setBuilderGradeSystem} /></label> : null}
                  <label className="calendar-field">
                    <span className="calendar-field-label">
                      <span>Workout name</span>
                      <small>Optional</small>
                    </span>
                    <input
                      type="text"
                      value={builderName}
                      onChange={(event) => setBuilderName(event.target.value)}
                      placeholder={builderSport === "strength" ? "Full-body strength" : builderSport === "swim" ? "Pool endurance" : builderSport === "bike" ? "Threshold ride" : builderSport === "indoorClimb" || builderSport === "bouldering" ? "Climbing session" : builderSport === "hyrox" ? "HYROX mixed session" : "6 x 800 m"}
                    />
                  </label>
                  <label className="calendar-field calendar-builder-description">
                    <span className="calendar-field-label">
                      <span>Description</span>
                      <small id="calendar-builder-description-count">{builderDescription.length} / 300</small>
                    </span>
                    <textarea
                      value={builderDescription}
                      maxLength={300}
                      rows={4}
                      onChange={(event) => setBuilderDescription(event.target.value)}
                      aria-describedby="calendar-builder-description-count"
                      placeholder="Add coaching notes or the goal of this workout"
                    />
                  </label>
                  {!libraryOnly ? <label className={`calendar-builder-save-card ${builderSave ? "is-checked" : ""}`}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={builderSave}
                      onChange={(event) => setBuilderSave(event.target.checked)}
                      aria-describedby="calendar-builder-save-help"
                    />
                    <span className="calendar-builder-save-icon" aria-hidden="true">
                      <BookmarkPlus size={17} />
                    </span>
                    <span className="calendar-builder-save-copy">
                      <strong>Save to library</strong>
                      <small id="calendar-builder-save-help">Keep a reusable copy after scheduling.</small>
                    </span>
                    <span className="calendar-builder-save-switch" aria-hidden="true">
                      <span />
                    </span>
                  </label> : null}
                </aside>

                <section className="calendar-builder-canvas" aria-labelledby="calendar-builder-steps-title">
                  <header className="calendar-builder-canvas-header">
                    <div>
                      <h4 id="calendar-builder-steps-title">Workout steps</h4>
                      <p>Repeat groups contain their own ordered sub-steps.</p>
                    </div>
                    <span className="calendar-builder-step-count">
                      {builderStructure.steps} {builderStructure.steps === 1 ? "step" : "steps"}
                      {builderStructure.repeatGroups > 0
                        ? `, ${builderStructure.repeatGroups} ${builderStructure.repeatGroups === 1 ? "repeat" : "repeats"}`
                        : ""}
                    </span>
                  </header>
                  <span className="sr-only" role="status" aria-live="polite">{builderReorderMessage}</span>
                  <div className="calendar-builder-rows">
                {rows.map((row, index) => {
                  const validationMessage = builderRowValidationMessage(
                    row,
                    builderSport,
                    builderExercises,
                    builderExercisesLoading,
                    unitSystem
                  );
                  const isActive = activeBuilderRowId === row.id;
                  const stepKind = row.kind === "intervals" ? "training" : row.kind;
                  const selectedExercise = row.exerciseId
                    ? builderExercises.find((exercise) => exercise.id === row.exerciseId)
                    : undefined;
                  const exercisePreviewUrl = selectedExercise?.media?.find((media) => media.coverUrl)?.coverUrl
                    ?? selectedExercise?.thumbnailUrl;
                  const StepIcon = row.kind === "training" && builderSport === "strength"
                    ? Dumbbell
                    : BUILDER_KIND_META[row.kind].Icon;
                  return <motion.section
                    key={row.id}
                    layout={reducedMotion ? false : "position"}
                    draggable={rows.length > 1}
                    className={`calendar-builder-row ${isActive ? "is-active" : "is-collapsed"} ${exercisePreviewUrl ? "has-exercise-preview" : ""} ${validationMessage ? "has-error" : ""} ${draggedBuilderRowId === row.id ? "is-dragging" : ""} ${dropTargetBuilderRowId === row.id ? "is-drop-target" : ""}`}
                    data-step-kind={stepKind}
                    data-builder-kind={row.kind}
                    aria-labelledby={`builder-step-${row.id}`}
                    onFocusCapture={(event) => {
                      if (!(event.target as HTMLElement).closest(".calendar-builder-reorder-controls")) {
                        setActiveBuilderRowId(row.id);
                      }
                    }}
                    onDragStartCapture={(event) => {
                      if (!(event.target as HTMLElement).closest(".calendar-builder-drag-handle")) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/calendar-builder-row", String(row.id));
                      setDraggedBuilderRowId(row.id);
                      setDropTargetBuilderRowId(null);
                    }}
                    onDragEnd={() => {
                      setDraggedBuilderRowId(null);
                      setDropTargetBuilderRowId(null);
                    }}
                    onDragEnter={(event) => {
                      if (draggedBuilderRowId !== null && draggedBuilderRowId !== row.id) {
                        event.preventDefault();
                        setDropTargetBuilderRowId(row.id);
                      }
                    }}
                    onDragOver={(event) => {
                      if (draggedBuilderRowId !== null && draggedBuilderRowId !== row.id) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId = Number(event.dataTransfer.getData("text/calendar-builder-row")) || draggedBuilderRowId;
                      if (sourceId !== null) reorderBuilderRow(sourceId, row.id);
                      setDraggedBuilderRowId(null);
                      setDropTargetBuilderRowId(null);
                    }}
                  >
                    <header className="calendar-builder-row-header">
                      <div className="calendar-builder-reorder-controls" aria-label={`Reorder block ${index + 1}`}>
                        <span
                          className="calendar-builder-drag-handle"
                          draggable={rows.length > 1}
                          title="Drag to reorder"
                        >
                          <GripVertical size={16} aria-hidden="true" />
                        </span>
                        <span className="calendar-builder-order-buttons">
                          <button
                            type="button"
                            onClick={() => moveBuilderRowBy(row.id, -1)}
                            disabled={index === 0}
                            aria-label={`Move block ${index + 1} up`}
                            title="Move up"
                          >
                            <ChevronUp size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBuilderRowBy(row.id, 1)}
                            disabled={index === rows.length - 1}
                            aria-label={`Move block ${index + 1} down`}
                            title="Move down"
                          >
                            <ChevronDown size={13} aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                      <button
                        type="button"
                        className="calendar-builder-row-toggle"
                        aria-expanded={isActive}
                        aria-controls={`builder-step-content-${row.id}`}
                        aria-label={`${isActive ? "Collapse" : "Expand"} ${row.kind === "intervals" ? "repeat group" : "step"} ${index + 1}: ${BUILDER_KIND_META[row.kind].label}`}
                        onClick={() => setActiveBuilderRowId(isActive ? null : row.id)}
                      >
                        <span className="calendar-builder-step-icon" aria-hidden="true">
                          <StepIcon size={15} />
                        </span>
                        <span className="calendar-builder-step-label">{row.kind === "intervals" ? "Repeat" : "Step"} {index + 1}</span>
                        <strong id={`builder-step-${row.id}`}>{row.kind === "intervals" ? `Repeat ${row.repeats || 0} times` : BUILDER_KIND_META[row.kind].label}</strong>
                        {!isActive && exercisePreviewUrl ? (
                          <span className="calendar-builder-row-thumbnail" aria-hidden="true">
                            <img
                              src={exercisePreviewUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              onError={(event) => { event.currentTarget.hidden = true; }}
                            />
                          </span>
                        ) : null}
                        <span className="calendar-builder-row-summary" aria-label="Step summary">
                          {builderRowSummary(row, builderSport, unitSystem).map((item) => (
                            <span className="calendar-builder-row-summary-item" key={item.label}>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </span>
                          ))}
                        </span>
                        <ChevronDown className={isActive ? "is-open" : ""} size={16} aria-hidden="true" />
                      </button>
                      <div className="calendar-builder-row-actions">
                        <button
                          type="button"
                          className="ghost-button calendar-builder-row-action calendar-builder-duplicate"
                          onClick={() => {
                            const duplicate = cloneBuilderRow(row);
                            setRows((current) => [
                              ...current.slice(0, index + 1),
                              duplicate,
                              ...current.slice(index + 1)
                            ]);
                            setActiveBuilderRowId(duplicate.id);
                            setActiveBuilderChildId(duplicate.children?.[0]?.id ?? null);
                          }}
                          aria-label={`Duplicate ${row.kind === "intervals" ? "repeat group" : "step"} ${index + 1}`}
                          title={row.kind === "intervals" ? "Duplicate repeat group" : "Duplicate step"}
                        >
                          <Copy size={14} aria-hidden="true" /> <span>Duplicate</span>
                        </button>
                        <button
                          type="button"
                          className="ghost-button calendar-builder-row-action calendar-builder-delete"
                          onClick={() => {
                            const nextRows = rows.filter((candidate) => candidate.id !== row.id);
                            setRows(nextRows);
                            if (row.children?.some((child) => child.id === activeBuilderChildId)) {
                              setActiveBuilderChildId(null);
                            }
                            setActiveBuilderRowId((current) => current === row.id
                              ? nextRows[Math.min(index, nextRows.length - 1)]?.id ?? null
                              : current);
                          }}
                          disabled={rows.length === 1}
                          aria-label={`Delete ${row.kind === "intervals" ? "repeat group" : "step"} ${index + 1}`}
                          title={rows.length === 1 ? "A workout needs at least one block" : row.kind === "intervals" ? "Delete repeat group" : "Delete step"}
                        >
                          <Trash2 size={14} aria-hidden="true" /> <span>Delete</span>
                        </button>
                      </div>
                    </header>

                    <AnimatePresence initial={false}>
                    {isActive ? <motion.div
                      key={`builder-step-content-${row.id}`}
                      className="calendar-builder-row-reveal"
                      initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                      animate={{
                        height: "auto",
                        opacity: 1,
                        transitionEnd: { overflow: "visible" }
                      }}
                      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
                      transition={reducedMotion ? { duration: 0 } : {
                        height: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
                        opacity: { duration: 0.14, ease: "easeOut" }
                      }}
                    >
                    <div id={`builder-step-content-${row.id}`}>
                      {row.kind === "intervals" ? (
                        <BuilderRepeatFields
                          row={row}
                          sport={builderSport}
                          context={builderContext}
                          exerciseOptions={builderExercises}
                          exercisesLoading={builderExercisesLoading}
                          activeChildId={activeBuilderChildId}
                          reducedMotion={reducedMotion}
                          onActiveChildChange={setActiveBuilderChildId}
                          onChange={(update) => setRows((current) => current.map((candidate) =>
                            candidate.id === row.id ? { ...candidate, ...update } : candidate
                          ))}
                        />
                      ) : (
                        <BuilderStepFields
                          row={row}
                          sport={builderSport}
                          context={builderContext}
                          exerciseOptions={builderExercises}
                          exercisesLoading={builderExercisesLoading}
                          allowedKinds={builderStepKinds}
                          onChange={(update) => setRows((current) => current.map((candidate) =>
                            candidate.id === row.id ? { ...candidate, ...update } : candidate
                          ))}
                          onKindChange={(kind) => {
                            const nextRow = changeBuilderRowKind(row, kind, builderSport);
                            setRows((current) => current.map((candidate) =>
                              candidate.id === row.id ? nextRow : candidate
                            ));
                            setActiveBuilderChildId(
                              kind === "intervals" ? nextRow.children?.[0]?.id ?? null : null
                            );
                          }}
                        />
                      )}
                    </div>
                    </motion.div> : null}
                    </AnimatePresence>
                  </motion.section>;
                })}
                  <div className="calendar-builder-add-bar" role="group" aria-label="Add a workout block">
                    <span className="calendar-builder-add-label">
                      <Plus size={12} aria-hidden="true" /> Add block
                    </span>
                    <div className="calendar-builder-add-chips">
                      {builderStepKinds.map((kind) => {
                        const meta = BUILDER_KIND_META[kind];
                        const KindIcon = kind === "training" && builderSport === "strength" ? Dumbbell : meta.Icon;
                        return (
                          <button
                            key={kind}
                            type="button"
                            data-kind={kind}
                            className="calendar-builder-add-chip"
                            onClick={() => addBuilderStep(kind)}
                          >
                            <KindIcon size={12} aria-hidden="true" />
                            <span>{meta.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  </div>
                </section>
              </div>
              <footer className="calendar-modal-footer calendar-builder-footer">
                {!libraryOnly ? <label className="calendar-check calendar-builder-footer-save">
                  <input
                    type="checkbox"
                    checked={builderSave}
                    onChange={(event) => setBuilderSave(event.target.checked)}
                  />
                  Also save to workout library
                </label> : null}
                <span className="calendar-builder-totals">
                  <span className="calendar-builder-total">
                    <ListTree size={11} aria-hidden="true" />
                    {builderStructure.steps} {builderStructure.steps === 1 ? "step" : "steps"}
                    {builderStructure.repeatGroups > 0
                      ? `, ${builderStructure.repeatGroups} ${builderStructure.repeatGroups === 1 ? "repeat" : "repeats"}`
                      : ""}
                  </span>
                  {builderTotals.minutes >= 1 ? (
                    <span className="calendar-builder-total" title="Estimated moving time">
                      <Timer size={11} aria-hidden="true" />
                      ≈{formatBuilderMinutes(builderTotals.minutes)}
                    </span>
                  ) : null}
                  {builderTotals.distance > 0 ? (
                    <span className="calendar-builder-total" title="Total distance">
                      <Route size={11} aria-hidden="true" />
                      {formatBuilderDistance(
                        builderTotals.distance,
                        builderTotals.distanceUnit,
                        unitSystem
                      )}
                    </span>
                  ) : null}
                  <span className="calendar-builder-total calendar-builder-total-sport">
                    <builderSportMeta.Icon size={11} aria-hidden="true" />
                    {formatWorkoutSport(builderSport)}
                  </span>
                </span>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!builderValid || submitting}
                  onClick={() => void submitBuilder()}
                >
                  {libraryOnly ? <BookmarkPlus size={16} aria-hidden="true" /> : <CalendarPlus size={16} aria-hidden="true" />}
                  {submitting ? (libraryOnly ? "Saving…" : "Scheduling…") : (libraryOnly ? "Save workout" : "Schedule workout")}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="calendar-modal-body calendar-activity-body">
              <section
                className="calendar-activity-section calendar-activity-sport-picker"
                role="group"
                aria-label="Activity type"
              >
                <div className="calendar-activity-section-head">
                  <h4>Activity type</h4>
                  <button
                    type="button"
                    className="calendar-activity-search-toggle"
                    aria-expanded={activitySportSearchOpen}
                    disabled={submitting}
                    onClick={() => {
                      setActivitySportSearchOpen((open) => {
                        if (open) setActivitySportSearch("");
                        return !open;
                      });
                    }}
                  >
                    <Search size={12} aria-hidden="true" />
                    {activitySportSearchOpen ? "Hide search" : "Search all types"}
                  </button>
                </div>

                {activitySportSearchOpen ? (
                  <span className="calendar-sport-search-control">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="text"
                      aria-label="Search activity types"
                      value={activitySportSearch}
                      onChange={(event) => setActivitySportSearch(event.target.value)}
                      placeholder="Rowing, pilates, indoor bike…"
                      disabled={submitting}
                      autoFocus
                    />
                  </span>
                ) : null}

                {visibleSportOptions.length === 0 ? (
                  <p className="calendar-activity-hint">
                    No activity types match that search.
                  </p>
                ) : (
                  <div className="calendar-sport-grid">
                    {visibleSportOptions.map((option) => {
                      const Icon = option.Icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selectedActivitySport.id === option.id}
                          className={`calendar-sport-card ${selectedActivitySport.id === option.id ? "is-active" : ""}`}
                          onClick={() => setActivitySportId(option.id)}
                          disabled={submitting}
                          title={describeLogSportOption(option)}
                        >
                          <Icon size={14} aria-hidden="true" />
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="calendar-activity-section">
                <h4>When and how long</h4>
                <div className="calendar-field-row">
                  <label className="calendar-field">
                    <span>Started at</span>
                    <input
                      type="time"
                      value={activityTime}
                      onChange={(event) => setActivityTime(event.target.value)}
                      disabled={submitting}
                    />
                  </label>
                  <div className="calendar-field">
                    <span>Duration</span>
                    <div className="calendar-duration-control">
                      <span className="calendar-duration-part">
                        <input
                          type="number"
                          min="0"
                          max="23"
                          aria-label="Duration, hours"
                          value={activityHours}
                          onChange={(event) => setActivityHours(event.target.value)}
                          placeholder="0"
                          disabled={submitting}
                        />
                        <em>h</em>
                      </span>
                      <span className="calendar-duration-part">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          aria-label="Duration, minutes"
                          value={activityMinutes}
                          onChange={(event) => setActivityMinutes(event.target.value)}
                          placeholder="0"
                          disabled={submitting}
                        />
                        <em>m</em>
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Everything below is recalled rather than measured, so the
                  heading says so once instead of tagging each field. */}
              <section className="calendar-activity-section">
                <h4>If you know them</h4>
                <div className="calendar-field-row">
                  {showActivityDistance ? (
                    <label className="calendar-field">
                      <span>Distance</span>
                      <span className="calendar-unit-control">
                        <input
                          type="number"
                          min="0"
                          step={selectedActivitySport.distanceUnit === "m" ? "1" : "0.01"}
                          value={activityDistance}
                          onChange={(event) => setActivityDistance(event.target.value)}
                          placeholder="—"
                          disabled={submitting}
                        />
                        <em>{activityDistanceUnit}</em>
                      </span>
                    </label>
                  ) : null}
                  <label className="calendar-field">
                    <span>Calories</span>
                    <span className="calendar-unit-control">
                      <input
                        type="number"
                        min="0"
                        value={activityCalories}
                        onChange={(event) => setActivityCalories(event.target.value)}
                        placeholder="—"
                        disabled={submitting}
                      />
                      <em>kcal</em>
                    </span>
                  </label>
                  <label className="calendar-field">
                    <span>Average heart rate</span>
                    <span className="calendar-unit-control">
                      <input
                        type="number"
                        min="0"
                        value={activityAvgHr}
                        onChange={(event) => setActivityAvgHr(event.target.value)}
                        placeholder="—"
                        disabled={submitting}
                      />
                      <em>bpm</em>
                    </span>
                  </label>
                </div>
              </section>

              <footer className="calendar-modal-footer calendar-activity-footer">
                <p className="calendar-activity-hint">
                  {activityValid
                    ? "Goes straight to your COROS account."
                    : "Add a duration to log this activity."}
                </p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!activityValid || submitting}
                  onClick={() => void submitActivity()}
                >
                  {submitting ? "Adding…" : "Add to COROS"}
                </button>
              </footer>
            </div>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
