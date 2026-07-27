import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Bike,
  BookmarkPlus,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Flame,
  Footprints,
  GripVertical,
  ListTree,
  Mountain,
  Pencil,
  PersonStanding,
  Plus,
  Repeat2,
  Search,
  Snowflake,
  Timer,
  Waves,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ManualActivityInput,
  PlanWorkoutEntryInput,
  RunWorkoutStepInput,
  TrainingHubLibraryWorkout,
  TrainingHubSportType,
  WorkoutHeartRateBasis,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutIntensityInput,
  WorkoutSport
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../training/formatters";
import { dateFromKey } from "./dateUtils";
import { ExerciseCombobox, type ExerciseComboboxSelection } from "./ExerciseCombobox";
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

function quickWorkoutDuration(distanceKm: number, pace: string): string | null {
  const paceMatch = pace.trim().match(/^(\d+):([0-5]\d)/);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !paceMatch) {
    return null;
  }

  const secondsPerKm = Number(paceMatch[1]) * 60 + Number(paceMatch[2]);
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

function normalizeQuickPace(pace: string): string {
  const value = pace.trim();
  return /\/(?:km|mi)$/i.test(value) ? value : `${value}/km`;
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
  // intervals only
  repeats: string;
  restMin: string;
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

interface AddWorkoutModalProps {
  api: CorosLinkApi;
  dateKey: string;
  sportTypes: TrainingHubSportType[];
  onClose: () => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
  onEditLibrary: (programId: string) => void;
}

let builderRowId = 0;

function emptyRow(kind: BuilderKind, sport: WorkoutSport = "run"): BuilderRow {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  const stepKind = kind === "intervals" ? "training" : kind;
  const targets = workoutTargetsForStep(sport, stepKind);
  const targetType = targets.includes("distance")
    ? "distance"
    : targets.includes("reps") ? "reps"
      : targets.includes("routes") ? "routes" : "time";
  builderRowId += 1;
  return {
    id: builderRowId,
    kind,
    targetType,
    distanceKm: "",
    timeMin: "",
    pace: "",
    repeats: "4",
    restMin: "2",
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

function rowIntensity(row: BuilderRow, sport: WorkoutSport): WorkoutIntensityInput {
  const low = Number(row.intensityLow);
  const high = Number(row.intensityHigh || row.intensityLow);
  const preset = row.intensityPreset;
  switch (row.intensityType) {
    case "heartRate": return { type: "heartRate", lowBpm: low, highBpm: high };
    case "heartRatePercent": return preset ? { type: "heartRatePercent", basis: row.intensityBasis, preset: preset as never } : { type: "heartRatePercent", basis: row.intensityBasis, lowPercent: low, highPercent: high };
    case "pace":
    case "effortPace": {
      const displayUnit = row.pace.includes("/mi") ? "mi" : "km";
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
  exerciseOptions: WorkoutExerciseOption[] = [],
  exercisesLoading = false
): string | undefined {
  const stepKind = row.kind === "intervals" ? "training" : row.kind;
  const targetValue = row.targetType === "time" ? row.timeMin : row.distanceKm;
  if (row.targetType !== "open" && !(Number(targetValue) > 0)) {
    return `Enter a valid ${builderTargetLabel(row.targetType, sport).toLocaleLowerCase()}.`;
  }
  if (row.kind === "intervals" && !(Number(row.repeats) > 0)) {
    return "Enter at least one repeat.";
  }
  if (sport === "strength" && stepKind === "training") {
    if (exercisesLoading) return "Wait for the COROS exercise catalog to finish loading.";
    if (exerciseOptions.length === 0) return "Reconnect COROS to load the exercise catalog.";
    if (!row.exerciseName.trim()) return "Select a COROS exercise for this Strength step.";
    if (!row.exerciseId) return "Choose an exact exercise from the COROS suggestions.";
  }
  if (sport === "hyrox" && row.exerciseName.trim() && !row.exerciseId) {
    return exerciseOptions.length === 0
      ? "Reconnect COROS to load the HYROX exercise catalog."
      : "Choose an exact exercise from the COROS suggestions.";
  }
  if ((row.intensityType === "pace" || row.intensityType === "effortPace") && !/^\d+:[0-5]\d(?:\/(?:km|mi))?-\d+:[0-5]\d(?:\/(?:km|mi))?$/i.test(row.pace.trim())) {
    return "Enter pace as a range, for example 4:30-4:45/km.";
  }
  const intensityError = validateWorkoutIntensity(
    sport,
    rowIntensity(row, sport),
    stepKind,
    row.exerciseKind
  );
  return intensityError;
}

function rowToSteps(row: BuilderRow, sport: WorkoutSport): RunWorkoutStepInput[] {
  const rawValue = Number(row.distanceKm);
  const target = row.targetType === "distance"
    ? { target_type: "distance" as const, target_distance_meters: Math.round(rawValue * (sport === "swim" ? 1 : 1000)) }
    : row.targetType === "time"
      ? { target_type: "time" as const, target_duration_seconds: Math.round(Number(row.timeMin) * 60) }
      : row.targetType === "load" ? { target_type: "load" as const, target_load: Math.round(rawValue) }
        : row.targetType === "hrRecovery" ? { target_type: "hrRecovery" as const, target_hr_recovery_bpm: Math.round(rawValue) }
          : row.targetType === "reps" ? { target_type: "reps" as const, target_reps: Math.round(rawValue) }
            : row.targetType === "elevationGain" ? { target_type: "elevationGain" as const, target_elevation_gain_meters: rawValue }
              : row.targetType === "routes" ? { target_type: "routes" as const, target_routes: Math.round(rawValue) }
                : { target_type: "open" as const };
  const intensity = { intensity: rowIntensity(row, sport) };
  const exercise = row.exerciseName.trim()
    ? {
        exercise_name: row.exerciseName.trim(),
        ...(row.exerciseId ? { exercise_id: row.exerciseId } : {}),
        ...(row.exerciseKind !== undefined ? { exercise_kind: row.exerciseKind } : {})
      }
    : {};

  if (row.kind === "intervals") {
    return [
      {
        repeat: Math.max(1, Math.round(Number(row.repeats) || 1)),
        steps: [
          { kind: "interval", ...target, ...intensity, ...exercise },
          {
            kind: "rest",
            target_duration_seconds: Math.max(
              10,
              Math.round(Number(row.restMin || "1") * 60)
            )
          }
        ]
      }
    ];
  }

  return [{ kind: row.kind, ...target, ...intensity, ...exercise }];
}

function rowIsValid(
  row: BuilderRow,
  sport: WorkoutSport = "run",
  exerciseOptions: WorkoutExerciseOption[] = [],
  exercisesLoading = false
): boolean {
  return builderRowValidationMessage(row, sport, exerciseOptions, exercisesLoading) === undefined;
}

function builderTargetLabel(target: BuilderRow["targetType"], sport: WorkoutSport): string {
  const labels: Record<BuilderRow["targetType"], string> = {
    distance: sport === "swim" ? "Distance (m)" : "Distance (km)",
    time: "Duration (min)",
    load: "Training Load",
    hrRecovery: "Return to heart rate (bpm)",
    open: "Manual end",
    reps: "Repetitions",
    elevationGain: "Elevation gain (m)",
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

function builderRowSummary(row: BuilderRow, sport: WorkoutSport): BuilderRowSummaryItem[] {
  const rawTarget = row.targetType === "time" ? row.timeMin.trim() : row.distanceKm.trim();
  const target = row.targetType === "open"
    ? "Manual"
    : row.targetType === "time"
      ? rawTarget ? `${rawTarget} min` : "Not set"
      : row.targetType === "distance"
        ? rawTarget ? `${rawTarget} ${sport === "swim" ? "m" : "km"}` : "Not set"
        : row.targetType === "load"
          ? rawTarget ? `${rawTarget} TL` : "Not set"
          : row.targetType === "hrRecovery"
            ? rawTarget ? `${rawTarget} bpm` : "Not set"
            : row.targetType === "reps"
              ? rawTarget ? `${rawTarget} reps` : "Not set"
              : row.targetType === "elevationGain"
                ? rawTarget ? `${rawTarget} m` : "Not set"
                : rawTarget ? `${rawTarget} routes` : "Not set";
  const details: BuilderRowSummaryItem[] = [
    { label: builderTargetTypeLabel(row.targetType), value: target },
    { label: "Intensity", value: builderIntensitySummary(row, sport) }
  ];
  if (row.exerciseName.trim()) {
    details.splice(1, 0, { label: "Exercise", value: row.exerciseName.trim() });
  }
  if (row.kind === "intervals") {
    details.push({
      label: "Recovery",
      value: Number(row.restMin) > 0 ? `${row.restMin} min` : "Not set"
    });
  }
  return details;
}

function BuilderIntensityFields({ row, sport, context, exerciseOptions, exercisesLoading, onChange }: { row: BuilderRow; sport: WorkoutSport; context?: WorkoutEditorContext; exerciseOptions: WorkoutExerciseOption[]; exercisesLoading: boolean; onChange: (update: Partial<BuilderRow>) => void }) {
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
  return <div className="calendar-builder-intensity-grid">
    {showExercise ? <div className="calendar-builder-control is-wide">
      <span>{sport === "strength" ? "Exercise" : "Exercise (optional for running steps)"}</span>
      <ExerciseCombobox
        value={row.exerciseName}
        selectedId={row.exerciseId}
        options={exerciseOptions}
        placeholder={sport === "strength" ? "Search and select a COROS exercise" : "Search HYROX exercises"}
        label={sport === "strength" ? "Exercise" : "HYROX exercise"}
        loading={exercisesLoading}
        onChange={selectExercise}
      />
      <small>{exercisesLoading ? "Loading COROS exercises..." : row.exerciseId ? "COROS exercise selected" : exerciseOptions.length === 0 ? "No exercises are available. Reconnect COROS and try again." : sport === "strength" ? "Required. Select an exact match from COROS." : "Leave empty for a running step."}</small>
    </div> : null}

    <label className="calendar-builder-control">
      <span>Intensity</span>
      <select value={row.intensityType} onChange={(event) => {
        const intensityType = event.target.value as BuilderRow["intensityType"];
        onChange({
          intensityType,
          intensityLow: intensityType === "heartRate" ? "135" : intensityType === "rpe" ? "5" : intensityType === "climbGrade" ? "0" : "80",
          intensityHigh: intensityType === "heartRate" ? "145" : "100",
          intensityPreset: intensityType === "swimStroke" ? "freestyle" : intensityType === "weight" ? "bodyweight" : intensityType === "climbGrade" ? `relative:${sport === "bouldering" ? "vScale" : "yds"}` : "",
          intensityUnit: intensityType === "weight" ? (context?.distanceUnit === "imperial" ? "lb" : "kg") : intensityType === "speed" ? (context?.distanceUnit === "imperial" ? "mph" : "km/h") : sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm"
        });
      }}>{intensityTypes.map((type) => <option key={type} value={type}>{formatIntensityType(type)}</option>)}</select>
    </label>

    {(row.intensityType === "pace" || row.intensityType === "effortPace") ? <label className="calendar-builder-control is-wide">
      <span>Pace range</span>
      <input type="text" value={row.pace} placeholder="4:30-4:45/km" onChange={(event) => onChange({ pace: event.target.value })} />
      <small>Enter fast-to-slow pace, including /km or /mi.</small>
    </label> : null}

    {row.intensityType === "heartRatePercent" ? <label className="calendar-builder-control">
      <span>Heart-rate basis</span>
      <select value={row.intensityBasis} onChange={(event) => onChange({ intensityBasis: event.target.value as WorkoutHeartRateBasis, intensityPreset: "" })}><option value="maxHr">% Max Heart Rate</option><option value="reserve">% Heart Rate Reserve</option><option value="lthr">% Lactate Threshold HR</option></select>
    </label> : null}

    {(percentType || (row.intensityType === "power" && sport !== "bike")) ? <label className="calendar-builder-control">
      <span>Zone</span>
      <select value={row.intensityPreset || "custom"} onChange={(event) => onChange({ intensityPreset: event.target.value === "custom" ? "" : event.target.value })}><option value="custom">Custom range</option>{presets.map((zone) => { const configured = presetZoneKey ? context?.zones[presetZoneKey]?.find((candidate) => candidate.id === zone.id || candidate.key === zone.preset) : undefined; return <option key={zone.id} value={zone.preset}>{configured?.label ?? zone.label}{configured ? ` · ${configured.lowPercent}-${configured.highPercent}%` : ""}</option>; })}</select>
    </label> : null}

    {(numericRange || (percentType && !row.intensityPreset)) ? <>
      <label className="calendar-builder-control"><span>Low ({numberUnit})</span><input type="number" value={row.intensityLow} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label>
      <label className="calendar-builder-control"><span>High ({numberUnit})</span><input type="number" value={row.intensityHigh} onChange={(event) => onChange({ intensityHigh: event.target.value })} /></label>
    </> : null}

    {row.intensityType === "speed" ? <label className="calendar-builder-control"><span>Speed unit</span><select value={row.intensityUnit === "mph" ? "mph" : "km/h"} onChange={(event) => onChange({ intensityUnit: event.target.value as BuilderRow["intensityUnit"] })}><option value="km/h">km/h</option><option value="mph">mph</option></select></label> : null}
    {row.intensityType === "cadence" ? <label className="calendar-builder-control"><span>Cadence unit</span><select value={row.intensityUnit === "spm" ? "spm" : "rpm"} onChange={(event) => onChange({ intensityUnit: event.target.value as BuilderRow["intensityUnit"] })}><option value="spm">steps/min</option><option value="rpm">revs/min</option></select></label> : null}
    {row.intensityType === "swimStroke" ? <label className="calendar-builder-control"><span>Stroke</span><select value={row.intensityPreset || "freestyle"} onChange={(event) => onChange({ intensityPreset: event.target.value })}>{Object.keys(SWIM_STROKE_IDS).map((stroke) => <option key={stroke} value={stroke}>{formatBuilderToken(stroke)}</option>)}</select></label> : null}

    {row.intensityType === "weight" ? <>
      <label className="calendar-builder-control"><span>Load type</span><select value={row.intensityPreset || "bodyweight"} onChange={(event) => onChange({ intensityPreset: event.target.value })}><option value="bodyweight">Bodyweight</option><option value="weight">Added weight</option></select></label>
      {row.intensityPreset === "weight" ? <><label className="calendar-builder-control"><span>Weight</span><input type="number" min="0" value={row.intensityLow} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label><label className="calendar-builder-control"><span>Weight unit</span><select value={row.intensityUnit === "lb" ? "lb" : "kg"} onChange={(event) => onChange({ intensityUnit: event.target.value as BuilderRow["intensityUnit"] })}><option value="kg">kg</option><option value="lb">lb</option></select></label></> : null}
    </> : null}

    {row.intensityType === "rpe" ? <label className="calendar-builder-control"><span>RPE</span><select value={row.intensityLow || "5"} onChange={(event) => onChange({ intensityLow: event.target.value })}>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}</select></label> : null}

    {row.intensityType === "climbGrade" ? <>
      <label className="calendar-builder-control"><span>Grade system</span><select value={climbSystem} onChange={(event) => onChange({ intensityPreset: `relative:${event.target.value}` })}>{Object.keys(CLIMB_SYSTEM_IDS).map((system) => <option key={system} value={system}>{formatBuilderToken(system)}</option>)}</select></label>
      <label className="calendar-builder-control"><span>Grade mode</span><select value={row.intensityPreset.startsWith("relative:") ? "relative" : "absolute"} onChange={(event) => onChange({ intensityPreset: event.target.value === "relative" ? `relative:${climbSystem}` : `${climbSystem}:${CLIMB_GRADES[climbSystem][0]}` })}><option value="relative">Relative to onsight</option><option value="absolute">Absolute grade</option></select></label>
      {row.intensityPreset.startsWith("relative:") ? <label className="calendar-builder-control"><span>Relative level</span><input type="number" min="-8" max="4" value={row.intensityLow || "0"} onChange={(event) => onChange({ intensityLow: event.target.value })} /></label> : <label className="calendar-builder-control"><span>Grade</span><select value={row.intensityPreset.split(":")[1]} onChange={(event) => onChange({ intensityPreset: `${climbSystem}:${event.target.value}` })}>{CLIMB_GRADES[climbSystem].map((grade) => <option key={grade}>{grade}</option>)}</select></label>}
    </> : null}

    {context ? <div className="calendar-builder-derived"><BuilderDerivedIntensityPreview intensity={rowIntensity(row, sport)} context={context} /></div> : null}
  </div>;
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
  onEditLibrary
}: AddWorkoutModalProps) {
  const reducedMotion = useReducedMotion();
  const todayKey = getLocalHappenDayKey();
  // Logging makes no sense for a day that hasn't happened yet, and COROS
  // rejects scheduling in the past — so each side of "today" gets the
  // tab set (and default tab) that can actually succeed.
  const canLogActivity = dateKey <= todayKey;
  const canSchedule = dateKey >= todayKey;
  const [tab, setTab] = useState<AddTab>(canSchedule ? "quick" : "activity");
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
  const [builderSave, setBuilderSave] = useState(true);
  const [rows, setRows] = useState<BuilderRow[]>([
    emptyRow("warmup"),
    emptyRow("training"),
    emptyRow("cooldown")
  ]);
  const [activeBuilderRowId, setActiveBuilderRowId] = useState<number | null>(rows[0]?.id ?? null);
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
    void api.getWorkoutEditorContext()
      .then((context) => {
        setBuilderContext(context);
        setBuilderPoolLength(String(Number(context.defaultPoolLength.value.toFixed(2))));
        setBuilderPoolUnit(context.defaultPoolLength.unit);
      })
      .catch(() => undefined);
  }, [api]);

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
  const activityDistanceLabel =
    selectedActivitySport.distanceUnit === "m" ? "Distance (m)" : "Distance (km)";
  const activityDistancePlaceholder =
    selectedActivitySport.distanceUnit === "m" ? "1500" : "0";

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
      const distanceKm = Number(quickDistanceKm);
      const rawPace = quickPace.trim();
      const pace = normalizeQuickPace(rawPace);
      const entry: PlanWorkoutEntryInput = rawPace
        ? {
            key: "calendar-quick",
            name,
            steps: [
              {
                kind: "training",
                target_distance_meters: Math.round(distanceKm * 1000),
                pace
              }
            ]
          }
        : { key: "calendar-quick", name, distance_km: distanceKm };
      await api.createAndScheduleWorkout(entry, dateKey, quickSave);
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
        sport: builderSport,
        ...((builderSport === "swim")
          ? { sport_options: { poolLength: { value: Number(builderPoolLength), unit: builderPoolUnit } } }
          : (builderSport === "indoorClimb" || builderSport === "bouldering")
            ? { sport_options: { gradingSystem: builderGradeSystem } }
            : {}),
        steps: rows.flatMap((row) => rowToSteps(row, builderSport))
      };
      await api.createAndScheduleWorkout(entry, dateKey, builderSave);
    }, `Scheduled "${builderName.trim() || "Structured Workout"}" on ${formatHappenDayLabel(dateKey)}.`);

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
          ? Math.round(Number(activityDistance) || 0)
          : selectedActivitySport.distanceUnit === "km"
            ? Math.round((Number(activityDistance) || 0) * 1000)
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
  const quickPaceLabel = quickPace.trim() ? normalizeQuickPace(quickPace) : "";
  const builderValid = rows.length > 0 && rows.every((row) =>
    rowIsValid(row, builderSport, builderExercises, builderExercisesLoading)
  );
  const activityValid =
    activityTime.trim() !== "" &&
    (Number(activityHours) || 0) * 60 + (Number(activityMinutes) || 0) > 0;
  const quickDuration = quickPaceValid ? quickWorkoutDuration(quickDistance, quickPace) : null;
  const availableTabs: AddTab[] = [
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

  return (
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
                {formatHappenDayLabel(dateKey)}
              </p>
              <h3 id="add-calendar-title">Add to calendar</h3>
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

          <div className="calendar-modal-tabs" role="tablist" aria-label="Add to calendar method">
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
                        aria-label="Distance in kilometres"
                        required
                      />
                      <span aria-hidden="true">km</span>
                    </span>
                    <span className="calendar-quick-presets" role="group" aria-label="Common distances">
                      {QUICK_DISTANCE_PRESETS.map((distance) => (
                        <button
                          key={distance}
                          type="button"
                          className={quickDistance === distance ? "is-active" : ""}
                          onClick={() => setQuickDistanceKm(String(distance))}
                        >
                          {distance} km
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
                        aria-label="Target pace per kilometre"
                        aria-invalid={!quickPaceValid}
                      />
                      <span aria-hidden="true">/km</span>
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
                    <dd>{quickDistanceValid ? `${quickDistance.toLocaleString()} km` : "-"}</dd>
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
                      {quickDistanceValid ? `${quickDistance.toLocaleString()} km` : "Set a distance"}
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
                        {quickDistance.toLocaleString()} km
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
                  <label className="calendar-field">
                    <span>Sport</span>
                    <select value={builderSport} onChange={(event) => {
                      const sport = event.target.value as WorkoutSport;
                      const nextRows = [emptyRow("warmup", sport), emptyRow("training", sport), emptyRow("cooldown", sport)];
                      setBuilderSport(sport);
                      setRows(nextRows);
                      setActiveBuilderRowId(nextRows[0]?.id ?? null);
                    }}>{WORKOUT_SPORTS.map((sport) => <option key={sport} value={sport}>{formatWorkoutSport(sport)}</option>)}</select>
                  </label>
                  {builderSport === "swim" ? <div className="calendar-field-row"><label className="calendar-field"><span>Pool length</span><input type="number" min="1" value={builderPoolLength} onChange={(event) => setBuilderPoolLength(event.target.value)} /></label><label className="calendar-field"><span>Unit</span><select value={builderPoolUnit} onChange={(event) => setBuilderPoolUnit(event.target.value as "m" | "yd")}><option value="m">m</option><option value="yd">yd</option></select></label></div> : null}
                  {(builderSport === "indoorClimb" || builderSport === "bouldering") ? <label className="calendar-field"><span>Grading system</span><select value={builderGradeSystem} onChange={(event) => setBuilderGradeSystem(event.target.value as keyof typeof CLIMB_SYSTEM_IDS)}>{Object.keys(CLIMB_SYSTEM_IDS).map((system) => <option key={system} value={system}>{formatBuilderToken(system)}</option>)}</select></label> : null}
                  <label className="calendar-field">
                    <span>Workout name</span>
                    <input
                      type="text"
                      value={builderName}
                      onChange={(event) => setBuilderName(event.target.value)}
                      placeholder={builderSport === "strength" ? "Full-body strength" : builderSport === "swim" ? "Pool endurance" : builderSport === "bike" ? "Threshold ride" : builderSport === "indoorClimb" || builderSport === "bouldering" ? "Climbing session" : builderSport === "hyrox" ? "HYROX mixed session" : "6 x 800 m"}
                    />
                  </label>
                  <label className={`calendar-builder-save-card ${builderSave ? "is-checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={builderSave}
                      onChange={(event) => setBuilderSave(event.target.checked)}
                    />
                    <BookmarkPlus size={19} aria-hidden="true" />
                    <span>
                      <strong>Save to library</strong>
                      <small>Keep this workout for reuse after scheduling.</small>
                    </span>
                  </label>
                </aside>

                <section className="calendar-builder-canvas" aria-labelledby="calendar-builder-steps-title">
                  <header className="calendar-builder-canvas-header">
                    <div>
                      <h4 id="calendar-builder-steps-title">Workout steps</h4>
                      <p>Drag steps to reorder. Select one to edit.</p>
                    </div>
                    <span className="calendar-builder-step-count">{rows.length} {rows.length === 1 ? "step" : "steps"}</span>
                  </header>
                  <span className="sr-only" role="status" aria-live="polite">{builderReorderMessage}</span>
                  <div className="calendar-builder-rows">
                {rows.map((row, index) => {
                  const validationMessage = builderRowValidationMessage(
                    row,
                    builderSport,
                    builderExercises,
                    builderExercisesLoading
                  );
                  const isActive = activeBuilderRowId === row.id;
                  const stepKind = row.kind === "intervals" ? "training" : row.kind;
                  const targetTypes = workoutTargetsForStep(builderSport, stepKind, row.exerciseKind);
                  const selectedExercise = row.exerciseId
                    ? builderExercises.find((exercise) => exercise.id === row.exerciseId)
                    : undefined;
                  const exercisePreviewUrl = selectedExercise?.media?.find((media) => media.coverUrl)?.coverUrl
                    ?? selectedExercise?.thumbnailUrl;
                  const StepIcon = row.kind === "warmup"
                    ? Flame
                    : row.kind === "cooldown"
                      ? Snowflake
                      : row.kind === "intervals"
                        ? Repeat2
                        : row.kind === "rest"
                          ? Timer
                          : builderSport === "strength"
                            ? Dumbbell
                            : Zap;
                  return <motion.section
                    layout
                    key={row.id}
                    draggable={rows.length > 1}
                    className={`calendar-builder-row ${isActive ? "is-active" : "is-collapsed"} ${exercisePreviewUrl ? "has-exercise-preview" : ""} ${validationMessage ? "has-error" : ""} ${draggedBuilderRowId === row.id ? "is-dragging" : ""} ${dropTargetBuilderRowId === row.id ? "is-drop-target" : ""}`}
                    data-step-kind={stepKind}
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
                      <div className="calendar-builder-reorder-controls" aria-label={`Reorder step ${index + 1}`}>
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
                            aria-label={`Move step ${index + 1} up`}
                            title="Move up"
                          >
                            <ChevronUp size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBuilderRowBy(row.id, 1)}
                            disabled={index === rows.length - 1}
                            aria-label={`Move step ${index + 1} down`}
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
                        onClick={() => setActiveBuilderRowId(row.id)}
                      >
                        <span className="calendar-builder-step-icon" aria-hidden="true">
                          <StepIcon size={15} />
                        </span>
                        <span className="calendar-builder-step-label">Step {index + 1}</span>
                        <strong id={`builder-step-${row.id}`}>{row.kind === "intervals" ? `${row.repeats || 0} repeats` : formatBuilderToken(row.kind)}</strong>
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
                          {builderRowSummary(row, builderSport).map((item) => (
                            <span className="calendar-builder-row-summary-item" key={item.label}>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </span>
                          ))}
                        </span>
                        <ChevronDown className={isActive ? "is-open" : ""} size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="ghost-button calendar-builder-remove"
                        onClick={() => {
                          const nextRows = rows.filter((candidate) => candidate.id !== row.id);
                          setRows(nextRows);
                          setActiveBuilderRowId((current) => current === row.id
                            ? nextRows[Math.min(index, nextRows.length - 1)]?.id ?? null
                            : current);
                        }}
                        disabled={rows.length === 1}
                        aria-label={`Remove step ${index + 1}`}
                      >
                        <X size={14} aria-hidden="true" /> <span>Remove</span>
                      </button>
                    </header>

                    <div
                      id={`builder-step-content-${row.id}`}
                      className="calendar-builder-row-content"
                      hidden={!isActive}
                    >
                      <div className="calendar-builder-primary-grid">
                      <label className="calendar-builder-control">
                        <span>Step type</span>
                        <select
                          value={row.kind}
                          onChange={(event) => {
                            const kind = event.target.value as BuilderKind;
                            const nextStepKind = kind === "intervals" ? "training" : kind;
                            const nextTargets = workoutTargetsForStep(builderSport, nextStepKind, row.exerciseKind);
                            const nextIntensities = workoutIntensitiesForStep(builderSport, nextStepKind, row.exerciseKind);
                            setRows((current) => current.map((candidate) => candidate.id === row.id ? {
                              ...candidate,
                              kind,
                              targetType: nextTargets.includes(candidate.targetType) ? candidate.targetType : nextTargets[0] ?? "time",
                              intensityType: nextIntensities.includes(candidate.intensityType) ? candidate.intensityType : nextIntensities[0] ?? "none"
                            } : candidate));
                          }}
                        >
                          {WORKOUT_SPORT_CAPABILITIES[builderSport].stepKinds.map((kind) => <option key={kind} value={kind}>{kind === "warmup" ? "Warm-up" : kind === "cooldown" ? "Cool-down" : kind === "training" ? "Training" : kind === "sendOff" ? "Send-off" : "Rest"}</option>)}
                          <option value="intervals">Intervals</option>
                        </select>
                      </label>

                      {row.kind === "intervals" ? <label className="calendar-builder-control">
                        <span>Repeats</span>
                        <input type="number" min="1" max="99" value={row.repeats} onChange={(event) => setRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, repeats: event.target.value } : candidate))} />
                      </label> : null}

                      <label className="calendar-builder-control">
                        <span>Target</span>
                        <select value={row.targetType} onChange={(event) => setRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, targetType: event.target.value as BuilderRow["targetType"] } : candidate))}>
                          {targetTypes.map((target) => <option key={target} value={target}>{builderTargetTypeLabel(target)}</option>)}
                        </select>
                      </label>

                      <label className="calendar-builder-control">
                        <span>{builderTargetLabel(row.targetType, builderSport)}</span>
                        {row.targetType === "open" ? <span className="calendar-builder-readonly-value">Ends when you press the lap button</span> : <input
                          type="number"
                          min={row.targetType === "hrRecovery" ? 30 : row.targetType === "elevationGain" ? 20 : row.targetType === "distance" ? 0.01 : 1}
                          max={row.targetType === "hrRecovery" ? 180 : row.targetType === "load" ? 999 : row.targetType === "routes" ? 20 : row.targetType === "reps" ? 500 : undefined}
                          step={row.targetType === "distance" ? "0.1" : "1"}
                          value={row.targetType === "time" ? row.timeMin : row.distanceKm}
                          placeholder={row.targetType === "distance" ? (builderSport === "swim" ? "100" : "0.8") : row.targetType === "hrRecovery" ? "120" : "10"}
                          onChange={(event) => setRows((current) => current.map((candidate) => candidate.id === row.id ? row.targetType === "time" ? { ...candidate, timeMin: event.target.value } : { ...candidate, distanceKm: event.target.value } : candidate))}
                        />}
                      </label>

                      {row.kind === "intervals" ? <label className="calendar-builder-control">
                        <span>Recovery between repeats (min)</span>
                        <input type="number" min="0" step="0.5" value={row.restMin} onChange={(event) => setRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, restMin: event.target.value } : candidate))} />
                      </label> : null}
                      </div>

                      <BuilderIntensityFields
                        row={row}
                        sport={builderSport}
                        context={builderContext}
                        exerciseOptions={builderExercises}
                        exercisesLoading={builderExercisesLoading}
                        onChange={(update) => setRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, ...update } : candidate))}
                      />
                      {validationMessage ? <p className="calendar-builder-error" role="alert">{validationMessage}</p> : null}
                    </div>
                  </motion.section>;
                })}
                  <button
                    type="button"
                    className="ghost-button calendar-builder-add"
                    onClick={() => {
                      const nextRow = emptyRow("training", builderSport);
                      setRows((current) => [...current, nextRow]);
                      setActiveBuilderRowId(nextRow.id);
                    }}
                  >
                    <Plus size={14} aria-hidden="true" /> Add step
                  </button>
                  </div>
                </section>
              </div>
              <footer className="calendar-modal-footer calendar-builder-footer">
                <label className="calendar-check calendar-builder-footer-save">
                  <input
                    type="checkbox"
                    checked={builderSave}
                    onChange={(event) => setBuilderSave(event.target.checked)}
                  />
                  Also save to workout library
                </label>
                <span className="calendar-builder-status">{rows.length} {rows.length === 1 ? "step" : "steps"} · {formatWorkoutSport(builderSport)}</span>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!builderValid || submitting}
                  onClick={() => void submitBuilder()}
                >
                  <CalendarPlus size={16} aria-hidden="true" />
                  {submitting ? "Scheduling…" : "Schedule workout"}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="calendar-modal-body calendar-activity-body">
              <div
                className="calendar-activity-sport-picker"
                role="group"
                aria-label="Activity type"
              >
                <label className="calendar-field calendar-sport-search">
                  <span>Activity type</span>
                  <span className="calendar-sport-search-control">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="text"
                      value={activitySportSearch}
                      onChange={(event) => setActivitySportSearch(event.target.value)}
                      placeholder="Search activity types"
                      disabled={submitting}
                    />
                  </span>
                </label>

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
              </div>

              <div className="calendar-field-row">
                <label className="calendar-field">
                  <span>Start time</span>
                  <input
                    type="time"
                    value={activityTime}
                    onChange={(event) => setActivityTime(event.target.value)}
                    disabled={submitting}
                  />
                </label>
                <label className="calendar-field">
                  <span>Hours</span>
                  <input
                    type="number"
                    min="0"
                    value={activityHours}
                    onChange={(event) => setActivityHours(event.target.value)}
                    placeholder="0"
                    disabled={submitting}
                  />
                </label>
                <label className="calendar-field">
                  <span>Minutes</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={activityMinutes}
                    onChange={(event) => setActivityMinutes(event.target.value)}
                    placeholder="45"
                    disabled={submitting}
                  />
                </label>
              </div>
              <div className="calendar-field-row">
                {showActivityDistance ? (
                  <label className="calendar-field">
                    <span>{activityDistanceLabel}</span>
                    <input
                      type="number"
                      min="0"
                      step={selectedActivitySport.distanceUnit === "m" ? "1" : "0.01"}
                      value={activityDistance}
                      onChange={(event) => setActivityDistance(event.target.value)}
                      placeholder={activityDistancePlaceholder}
                      disabled={submitting}
                    />
                  </label>
                ) : null}
                <label className="calendar-field">
                  <span>Calories (optional)</span>
                  <input
                    type="number"
                    min="0"
                    value={activityCalories}
                    onChange={(event) => setActivityCalories(event.target.value)}
                    placeholder="450"
                    disabled={submitting}
                  />
                </label>
                <label className="calendar-field">
                  <span>Avg HR (optional)</span>
                  <input
                    type="number"
                    min="0"
                    value={activityAvgHr}
                    onChange={(event) => setActivityAvgHr(event.target.value)}
                    placeholder="145"
                    disabled={submitting}
                  />
                </label>
              </div>
              <p className="calendar-activity-hint">
                Logs an activity that wasn&apos;t recorded by a device straight to
                your COROS account.
              </p>
              <footer className="calendar-modal-footer">
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
    </AnimatePresence>
  );
}
