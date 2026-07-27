import type {
  RunWorkoutEditorStepKind,
  RunWorkoutEditorStep,
  RunWorkoutEditorTarget,
  RunWorkoutEditorDraft,
  WorkoutClimbSystem,
  WorkoutEditorContext,
  WorkoutFtpPreset,
  WorkoutHeartRateBasis,
  WorkoutHeartRatePreset,
  WorkoutIntensityInput,
  WorkoutExerciseMedia,
  WorkoutPacePreset,
  WorkoutRunningPowerPreset,
  WorkoutSport,
  WorkoutSwimStroke,
  WorkoutZone
} from "./types";

export type WorkoutIntensityType = Exclude<WorkoutIntensityInput["type"], "lthrPercent">;
export type WorkoutTargetType = RunWorkoutEditorTarget["type"];

export interface SportCapability {
  sport: WorkoutSport;
  sportType: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  label: string;
  pbVersion: number;
  referExercise: Readonly<Record<string, unknown>>;
  stepKinds: readonly RunWorkoutEditorStepKind[];
  targets: readonly WorkoutTargetType[];
  restTargets: readonly WorkoutTargetType[];
  intensities: readonly WorkoutIntensityType[];
  defaultIntensity: WorkoutIntensityInput;
  requiresExercise?: boolean;
  supportsPoolLength?: boolean;
  supportsGradingSystem?: boolean;
}

const STANDARD_KINDS = ["warmup", "training", "rest", "cooldown"] as const;
const ENDURANCE_TARGETS = ["time", "distance", "load", "open"] as const;
const ENDURANCE_REST_TARGETS = [
  "time",
  "distance",
  "load",
  "hrRecovery",
  "open"
] as const;
const RUN_INTENSITIES = [
  "none",
  "heartRate",
  "heartRatePercent",
  "thresholdPacePercent",
  "pace",
  "effortPacePercent",
  "effortPace",
  "power",
  "cadence"
] as const;

const HYROX_FUNCTIONAL_INTENSITIES: Readonly<Record<number, readonly WorkoutIntensityType[]>> = {
  1: ["cadence", "rpe", "none"],
  2: ["weight", "rpe"],
  3: ["weight", "rpe"],
  4: ["weight", "rpe"],
  5: ["cadence", "rpe", "none"],
  6: ["weight", "rpe"],
  7: ["weight", "rpe"],
  8: ["weight", "rpe"],
  11: ["weight", "rpe"]
};

const HYROX_FUNCTIONAL_TARGETS: Readonly<Record<number, readonly WorkoutTargetType[]>> = {
  1: ["distance", "time", "open"],
  2: ["distance", "time", "open"],
  3: ["distance", "time", "open"],
  4: ["distance", "reps", "time", "open"],
  5: ["distance", "time", "open"],
  6: ["distance", "time", "open"],
  7: ["distance", "time", "open"],
  8: ["reps", "time", "open"]
};

export const WORKOUT_SPORT_CAPABILITIES: Readonly<Record<WorkoutSport, SportCapability>> = {
  run: {
    sport: "run",
    sportType: 1,
    label: "Run",
    pbVersion: 2,
    referExercise: { intensityType: 0, hrType: 0, valueType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: ENDURANCE_TARGETS,
    restTargets: ENDURANCE_REST_TARGETS,
    intensities: RUN_INTENSITIES,
    defaultIntensity: { type: "none" }
  },
  bike: {
    sport: "bike",
    sportType: 2,
    label: "Bike",
    pbVersion: 2,
    referExercise: { intensityType: 0, hrType: 0, valueType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: ENDURANCE_TARGETS,
    restTargets: ENDURANCE_REST_TARGETS,
    intensities: [
      "none",
      "heartRate",
      "heartRatePercent",
      "ftpPercent",
      "speed",
      "power",
      "cadence"
    ],
    defaultIntensity: { type: "none" }
  },
  swim: {
    sport: "swim",
    sportType: 3,
    label: "Pool Swim",
    pbVersion: 2,
    referExercise: { intensityType: 0, hrType: 0 },
    stepKinds: [...STANDARD_KINDS, "sendOff"],
    targets: ENDURANCE_TARGETS,
    restTargets: ENDURANCE_REST_TARGETS,
    intensities: ["none", "swimStroke"],
    defaultIntensity: { type: "swimStroke", stroke: "freestyle" },
    supportsPoolLength: true
  },
  strength: {
    sport: "strength",
    sportType: 4,
    label: "Strength",
    pbVersion: 2,
    referExercise: { intensityType: 0, hrType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: ["reps", "time", "open"],
    restTargets: ["time", "hrRecovery", "open"],
    intensities: ["none", "weight"],
    defaultIntensity: { type: "weight", mode: "bodyweight" },
    requiresExercise: true
  },
  trailRun: {
    sport: "trailRun",
    sportType: 5,
    label: "Trail Run",
    pbVersion: 4,
    referExercise: { intensityType: 0, hrType: 0, valueType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: [...ENDURANCE_TARGETS, "elevationGain"],
    restTargets: [...ENDURANCE_REST_TARGETS, "elevationGain"],
    intensities: RUN_INTENSITIES,
    defaultIntensity: { type: "none" }
  },
  indoorClimb: {
    sport: "indoorClimb",
    sportType: 6,
    label: "Indoor Climb",
    pbVersion: 7,
    referExercise: { intensityType: 10, hrType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: ["routes", "time", "open"],
    restTargets: ["routes", "time", "open"],
    intensities: ["climbGrade"],
    defaultIntensity: { type: "climbGrade", system: "yds", relativeToOnsight: 0 },
    supportsGradingSystem: true
  },
  bouldering: {
    sport: "bouldering",
    sportType: 7,
    label: "Bouldering",
    pbVersion: 7,
    referExercise: { intensityType: 10, hrType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: ["routes", "time", "open"],
    restTargets: ["routes", "time", "open"],
    intensities: ["climbGrade"],
    defaultIntensity: { type: "climbGrade", system: "vScale", relativeToOnsight: 0 },
    supportsGradingSystem: true
  },
  xcSki: {
    sport: "xcSki",
    sportType: 8,
    label: "XC Ski",
    pbVersion: 9,
    referExercise: { intensityType: 0, hrType: 0, valueType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: [...ENDURANCE_TARGETS, "elevationGain"],
    restTargets: [...ENDURANCE_REST_TARGETS, "elevationGain"],
    intensities: ["none", "heartRate", "heartRatePercent", "speed"],
    defaultIntensity: { type: "none" }
  },
  hyrox: {
    sport: "hyrox",
    sportType: 9,
    label: "HYROX",
    pbVersion: 9,
    referExercise: { intensityType: 0, hrType: 0, valueType: 0 },
    stepKinds: STANDARD_KINDS,
    targets: [...ENDURANCE_TARGETS, "reps"],
    restTargets: ["time", "hrRecovery", "open"],
    intensities: [...RUN_INTENSITIES, "weight", "rpe", "speed"],
    defaultIntensity: { type: "none" },
    requiresExercise: true
  }
};

export const WORKOUT_SPORTS = Object.keys(WORKOUT_SPORT_CAPABILITIES) as WorkoutSport[];

export interface WorkoutExerciseResolution {
  match?: Record<string, unknown>;
  candidates: string[];
}

function humanizeExerciseOverview(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.trim().replace(/^sid_[a-z]+_/i, "");
  if (normalized === value.trim()) return "";
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase())
    .trim();
}

export function workoutExerciseName(row: Record<string, unknown>): string {
  const codePattern = /^[TS]\d+$/i;
  for (const key of ["displayName", "exerciseName", "nameText", "name"]) {
    const value = row[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const humanizedName = humanizeExerciseOverview(value);
    if (humanizedName) return humanizedName;
    if (!codePattern.test(value.trim())) return value.trim();
  }
  const overviewName = humanizeExerciseOverview(row.overview);
  if (overviewName) return overviewName;
  const rawName = row.name;
  if (typeof rawName === "string" && rawName.trim()) return rawName.trim();
  return "";
}

export function workoutExerciseId(row: Record<string, unknown>): string | undefined {
  const value = row.originId ?? row.exerciseId ?? row.id;
  return value === undefined || value === null || String(value).trim() === ""
    ? undefined
    : String(value);
}

const COROS_EXERCISE_IMAGE_PREFIX = "/source/exercise_img/";
const COROS_EXERCISE_VIDEO_PREFIX = "/source/exercise_gif/";

function officialCorosExerciseMediaUrl(
  value: unknown,
  kind: "cover" | "video"
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "s3.coros.com") return undefined;
    const expectedPrefix = kind === "cover"
      ? COROS_EXERCISE_IMAGE_PREFIX
      : COROS_EXERCISE_VIDEO_PREFIX;
    if (!url.pathname.startsWith(expectedPrefix)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function mediaUrlList(value: unknown, kind: "cover" | "video"): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => officialCorosExerciseMediaUrl(entry, kind))
    .filter((entry): entry is string => Boolean(entry));
}

function videoInfoRows(value: unknown): Record<string, unknown>[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object"
    )
    : [];
}

export function workoutExerciseMedia(row: Record<string, unknown>): WorkoutExerciseMedia[] {
  const structured = videoInfoRows(row.videoInfos).flatMap((entry) => {
    const coverUrl = officialCorosExerciseMediaUrl(entry.coverUrl, "cover");
    const videoUrl = officialCorosExerciseMediaUrl(entry.videoUrl, "video");
    return coverUrl || videoUrl ? [{ ...(coverUrl ? { coverUrl } : {}), ...(videoUrl ? { videoUrl } : {}) }] : [];
  });
  const coverUrls = [...new Set([
    officialCorosExerciseMediaUrl(row.thumbnailUrl, "cover"),
    officialCorosExerciseMediaUrl(row.sourceUrl, "cover"),
    ...mediaUrlList(row.coverUrlArrStr, "cover")
  ].filter((entry): entry is string => Boolean(entry)))];
  const videoUrls = [...new Set([
    ...mediaUrlList(row.videoUrlArrStr, "video"),
    officialCorosExerciseMediaUrl(row.videoUrl, "video")
  ].filter((entry): entry is string => Boolean(entry)))];
  const merged = [...structured];
  const count = Math.max(coverUrls.length, videoUrls.length);
  for (let index = 0; index < count; index += 1) {
    const coverUrl = coverUrls[index];
    const videoUrl = videoUrls[index];
    if (coverUrl || videoUrl) merged.push({ ...(coverUrl ? { coverUrl } : {}), ...(videoUrl ? { videoUrl } : {}) });
  }
  return [...new Map(merged.map((entry) => [
    `${entry.coverUrl ?? ""}|${entry.videoUrl ?? ""}`,
    entry
  ])).values()];
}

export function resolveWorkoutExerciseName(
  catalog: readonly Record<string, unknown>[],
  requestedName: string
): WorkoutExerciseResolution {
  const normalize = (value: string): string => value.trim().toLocaleLowerCase();
  const query = normalize(requestedName);
  if (!query) return { candidates: [] };
  const exact = catalog.filter((row) => normalize(workoutExerciseName(row)) === query);
  const matches = exact.length
    ? exact
    : catalog.filter((row) => normalize(workoutExerciseName(row)).includes(query));
  const unique = [...new Map(
    matches.map((row) => [workoutExerciseId(row) ?? workoutExerciseName(row), row])
  ).values()];
  return {
    ...(unique.length === 1 ? { match: unique[0] } : {}),
    candidates: unique.slice(0, 8).map(workoutExerciseName).filter(Boolean)
  };
}

export function workoutSportFromType(value: unknown): WorkoutSport | undefined {
  const sportType = Number(value);
  return WORKOUT_SPORTS.find(
    (sport) => WORKOUT_SPORT_CAPABILITIES[sport].sportType === sportType
  );
}

export function workoutSportType(sport: WorkoutSport | undefined): SportCapability["sportType"] {
  return WORKOUT_SPORT_CAPABILITIES[sport ?? "run"].sportType;
}

export function requiredWorkoutPbVersion(
  sport: WorkoutSport,
  exercises: readonly Record<string, unknown>[],
  current = 0
): number {
  let version = Math.max(current, WORKOUT_SPORT_CAPABILITIES[sport].pbVersion);
  if (exercises.some((exercise) => finiteNumber(exercise.intensityType) === 8)) {
    version = Math.max(version, 3);
  }
  if (exercises.some((exercise) => [6, 7].includes(finiteNumber(exercise.intensityCustom) ?? 0))) {
    version = Math.max(version, 5);
  }
  if (exercises.some((exercise) => finiteNumber(exercise.intensityType) === 9)) {
    version = Math.max(version, 6);
  }
  if (
    sport === "swim" &&
    exercises.some((exercise) =>
      (finiteNumber(exercise.intensityType) === 5 && finiteNumber(exercise.intensityValue) === 6) ||
      finiteNumber(exercise.exerciseType) === 5 ||
      (finiteNumber(exercise.exerciseType) === 2 && finiteNumber(exercise.subType) === 1)
    )
  ) {
    version = Math.max(version, 8);
  }
  if (sport === "xcSki" || sport === "hyrox") version = Math.max(version, 9);
  return version;
}

export const HEART_RATE_PRESETS: Readonly<Record<
  WorkoutHeartRateBasis,
  readonly { preset: WorkoutHeartRatePreset; id: number; label: string; low: number; high: number }[]
>> = {
  maxHr: [
    { preset: "recovery", id: 6, label: "Recovery", low: 0, high: 50 },
    { preset: "warmUp", id: 1, label: "Warm Up", low: 51, high: 60 },
    { preset: "fatBurn", id: 2, label: "Fat Burn", low: 61, high: 70 },
    { preset: "aerobicEndurance", id: 3, label: "Aerobic Endurance", low: 71, high: 80 },
    { preset: "threshold", id: 4, label: "Threshold", low: 81, high: 90 },
    { preset: "anaerobic", id: 5, label: "Anaerobic", low: 91, high: 100 }
  ],
  reserve: [
    { preset: "recovery", id: 6, label: "Recovery", low: 0, high: 59 },
    { preset: "warmUp", id: 1, label: "Warm Up", low: 60, high: 74 },
    { preset: "fatBurn", id: 2, label: "Fat Burn", low: 75, high: 84 },
    { preset: "aerobicEndurance", id: 3, label: "Aerobic Endurance", low: 85, high: 88 },
    { preset: "threshold", id: 4, label: "Threshold", low: 89, high: 95 },
    { preset: "anaerobic", id: 5, label: "Anaerobic", low: 96, high: 100 }
  ],
  lthr: [
    { preset: "recovery", id: 6, label: "Recovery", low: 0, high: 80 },
    { preset: "warmUp", id: 1, label: "Warm Up", low: 81, high: 90 },
    { preset: "fatBurn", id: 2, label: "Fat Burn", low: 91, high: 95 },
    { preset: "aerobicEndurance", id: 3, label: "Aerobic Endurance", low: 96, high: 102 },
    { preset: "threshold", id: 4, label: "Threshold", low: 103, high: 106 },
    { preset: "anaerobic", id: 5, label: "Anaerobic", low: 107, high: 120 }
  ]
};

export const PACE_PRESETS: readonly {
  preset: WorkoutPacePreset;
  id: number;
  label: string;
  low: number;
  high: number;
}[] = [
  { preset: "recovery", id: 7, label: "Recovery", low: 0, high: 77 },
  { preset: "aerobicEndurance", id: 1, label: "Aerobic Endurance", low: 78, high: 87 },
  { preset: "aerobicPower", id: 2, label: "Aerobic Power", low: 88, high: 94 },
  { preset: "threshold", id: 3, label: "Threshold", low: 95, high: 108 },
  { preset: "anaerobicEndurance", id: 5, label: "Anaerobic Endurance", low: 109, high: 118 },
  { preset: "anaerobicPower", id: 6, label: "Anaerobic Power", low: 119, high: 200 }
];

export const FTP_PRESETS: readonly {
  preset: WorkoutFtpPreset;
  id: number;
  label: string;
  low: number;
  high: number;
}[] = [
  { preset: "recovery", id: 1, label: "Recovery", low: 0, high: 55 },
  { preset: "aerobicEndurance", id: 2, label: "Aerobic Endurance", low: 56, high: 75 },
  { preset: "aerobicPower", id: 3, label: "Aerobic Power", low: 76, high: 90 },
  { preset: "threshold", id: 4, label: "Threshold", low: 91, high: 105 },
  { preset: "anaerobicEndurance", id: 5, label: "Anaerobic Endurance", low: 106, high: 120 },
  { preset: "anaerobicPower", id: 6, label: "Anaerobic Power", low: 121, high: 150 },
  { preset: "sprint", id: 7, label: "Sprint", low: 151, high: 300 }
];

export const RUNNING_POWER_PRESETS: readonly {
  preset: WorkoutRunningPowerPreset;
  id: number;
  label: string;
  low: number;
  high: number;
}[] = [
  { preset: "easy", id: 1, label: "Easy", low: 65, high: 80 },
  { preset: "moderate", id: 2, label: "Moderate", low: 81, high: 90 },
  { preset: "threshold", id: 3, label: "Threshold", low: 91, high: 100 },
  { preset: "interval", id: 4, label: "Interval", low: 101, high: 115 },
  { preset: "repetition", id: 5, label: "Repetition", low: 116, high: 200 }
];

export const SWIM_STROKE_IDS: Readonly<Record<WorkoutSwimStroke, number>> = {
  notSet: 0,
  freestyle: 1,
  breaststroke: 2,
  backstroke: 3,
  butterfly: 4,
  drills: 6,
  individualMedley: 7,
  mix: 255
};

export const CLIMB_SYSTEM_IDS: Readonly<Record<WorkoutClimbSystem, number>> = {
  yds: 1,
  french: 2,
  vScale: 7,
  font: 8,
  uiaa: 9,
  ewbank: 10
};

export const CLIMB_GRADES: Readonly<Record<WorkoutClimbSystem, readonly string[]>> = {
  yds: [
    "5.6", "5.7", "5.8", "5.9", "5.10a", "5.10b", "5.10c", "5.10d",
    "5.11a", "5.11b", "5.11c", "5.11d", "5.12a", "5.12b", "5.12c", "5.12d",
    "5.13a", "5.13b", "5.13c", "5.13d", "5.14a", "5.14b", "5.14c", "5.14d", "5.15a"
  ],
  french: [
    "4a", "4b", "4c", "5a", "5b", "5c", "6a", "6a+", "6b", "6b+", "6c", "6c+",
    "7a", "7a+", "7b", "7b+", "7c", "7c+", "8a", "8a+", "8b", "8b+", "8c", "8c+",
    "9a", "9a+", "9b", "9b+"
  ],
  uiaa: ["IV", "V", "VI", "VI+", "VII-", "VII", "VII+", "VIII-", "VIII", "VIII+", "IX-", "IX", "IX+", "X-", "X", "X+", "XI-", "XI", "XI+", "XII-", "XII"],
  ewbank: Array.from({ length: 28 }, (_, index) => String(index + 12)),
  vScale: Array.from({ length: 18 }, (_, index) => `V${index}`),
  font: ["4", "4+", "5", "5+", "6A", "6A+", "6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+", "8C", "8C+", "9A"]
};

const HR_TYPE: Readonly<Record<WorkoutHeartRateBasis, number>> = {
  maxHr: 1,
  reserve: 2,
  lthr: 3
};

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function range(low: number, high: number): [number, number] {
  return [Math.min(low, high), Math.max(low, high)];
}

export function decodeCorosPercent(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  return Math.abs(number) > 500 ? number / 1_000 : number;
}

export function encodeCorosPercent(value: number): number {
  return Math.round(value * 1_000);
}

function contextZones(
  context: WorkoutEditorContext | undefined,
  key: keyof WorkoutEditorContext["zones"],
  fallback: readonly { id: number; label: string; low: number; high: number }[]
): WorkoutZone[] {
  const configured = context?.zones?.[key];
  if (configured?.length) return configured;
  return fallback.map((zone, index) => ({
    index: index + 1,
    id: zone.id,
    key: String(zone.id),
    label: zone.label,
    lowPercent: zone.low,
    highPercent: zone.high
  }));
}

function findZone(
  zones: readonly WorkoutZone[],
  id: number | undefined,
  preset: string | undefined
): WorkoutZone | undefined {
  return zones.find((zone) => zone.id === id || zone.key === preset || zone.label === preset);
}

function setPercentFields(
  result: Record<string, unknown>,
  low: number,
  high: number,
  reference?: number,
  reserveResting?: number
): void {
  const [minimum, maximum] = range(low, high);
  result.intensityPercent = encodeCorosPercent(minimum);
  result.intensityPercentExtend = encodeCorosPercent(maximum);
  if (reference) {
    if (reserveResting !== undefined) {
      const reserve = reference - reserveResting;
      result.intensityValue = Math.round(reserveResting + reserve * minimum / 100);
      result.intensityValueExtend = Math.round(reserveResting + reserve * maximum / 100);
    } else {
      result.intensityValue = Math.round(reference * minimum / 100);
      result.intensityValueExtend = Math.round(reference * maximum / 100);
    }
  }
}

export function encodeCorosIntensity(
  intensity: WorkoutIntensityInput,
  context?: WorkoutEditorContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    intensityType: 0,
    hrType: 0,
    isIntensityPercent: false,
    intensityCustom: 0,
    intensityValue: 0,
    intensityValueExtend: 0,
    intensityDisplayUnit: 0,
    intensityMultiplier: 0,
    intensityPercent: 0,
    intensityPercentExtend: 0
  };
  if (intensity.type === "none") return result;

  if (intensity.type === "heartRate") {
    const [low, high] = range(intensity.lowBpm, intensity.highBpm);
    return {
      ...result,
      intensityType: 2,
      // COROS uses 2 for absolute Heart Rate as well as HR Reserve. The percent
      // flag disambiguates the two modes. This is the issue #72 regression fix.
      hrType: 2,
      isIntensityPercent: false,
      intensityCustom: 0,
      intensityValue: Math.round(low),
      intensityValueExtend: Math.round(high)
    };
  }

  if (intensity.type === "heartRatePercent" || intensity.type === "lthrPercent") {
    const basis = intensity.type === "lthrPercent" ? "lthr" : intensity.basis;
    const definitions = HEART_RATE_PRESETS[basis];
    const zones = contextZones(context, basis, definitions);
    const preset = "preset" in intensity ? intensity.preset : undefined;
    const definition = definitions.find((entry) => entry.preset === preset);
    const selected = findZone(zones, intensity.zoneId ?? definition?.id, preset);
    const low = "lowPercent" in intensity && intensity.lowPercent !== undefined
      ? intensity.lowPercent
      : selected?.lowPercent ?? definition?.low ?? 0;
    const high = "highPercent" in intensity && intensity.highPercent !== undefined
      ? intensity.highPercent
      : selected?.highPercent ?? definition?.high ?? low;
    Object.assign(result, {
      intensityType: 2,
      hrType: HR_TYPE[basis],
      isIntensityPercent: true,
      intensityCustom: selected?.id ?? definition?.id ?? intensity.zoneId ?? 0
    });
    const reference = basis === "maxHr" ? context?.maxHr : basis === "lthr" ? context?.lthrBpm : context?.maxHr;
    setPercentFields(result, low, high, reference, basis === "reserve" ? context?.restingHr : undefined);
    return result;
  }

  if (intensity.type === "pace" || intensity.type === "effortPace") {
    const [low, high] = range(intensity.lowSecondsPerKm, intensity.highSecondsPerKm);
    return {
      ...result,
      intensityType: intensity.type === "pace" ? 3 : 8,
      intensityValue: Math.round(low * 1_000),
      intensityValueExtend: Math.round(high * 1_000),
      intensityDisplayUnit: intensity.displayUnit === "mi" ? 2 : 1,
      intensityMultiplier: 1_000
    };
  }

  if (intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent") {
    const definition = PACE_PRESETS.find((entry) => entry.preset === intensity.preset);
    const zones = contextZones(context, "thresholdPace", PACE_PRESETS);
    const selected = findZone(zones, intensity.zoneId ?? definition?.id, intensity.preset);
    const low = intensity.lowPercent ?? selected?.lowPercent ?? definition?.low ?? 0;
    const high = intensity.highPercent ?? selected?.highPercent ?? definition?.high ?? low;
    Object.assign(result, {
      intensityType: intensity.type === "thresholdPacePercent" ? 3 : 8,
      isIntensityPercent: true,
      intensityCustom: selected?.id ?? definition?.id ?? intensity.zoneId ?? 0
    });
    setPercentFields(result, low, high);
    if (context?.thresholdPaceSecondsPerKm) {
      // Faster pace has a smaller seconds/km value.
      result.intensityValue = Math.round(context.thresholdPaceSecondsPerKm * 100 / high * 1_000);
      result.intensityValueExtend = Math.round(context.thresholdPaceSecondsPerKm * 100 / low * 1_000);
      result.intensityMultiplier = 1_000;
      result.intensityDisplayUnit = context.paceUnit === "mi" ? 2 : 1;
    }
    return result;
  }

  if (intensity.type === "ftpPercent") {
    const definition = FTP_PRESETS.find((entry) => entry.preset === intensity.preset);
    const zones = contextZones(context, "ftp", FTP_PRESETS);
    const selected = findZone(zones, intensity.zoneId ?? definition?.id, intensity.preset);
    const low = intensity.lowPercent ?? selected?.lowPercent ?? definition?.low ?? 0;
    const high = intensity.highPercent ?? selected?.highPercent ?? definition?.high ?? low;
    Object.assign(result, {
      intensityType: 9,
      isIntensityPercent: true,
      intensityCustom: selected?.id ?? definition?.id ?? intensity.zoneId ?? 0
    });
    setPercentFields(result, low, high, context?.ftp);
    return result;
  }

  if (intensity.type === "power") {
    result.intensityType = 6;
    if (intensity.preset) {
      const definition = RUNNING_POWER_PRESETS.find((entry) => entry.preset === intensity.preset);
      const zones = contextZones(context, "runningPower", RUNNING_POWER_PRESETS);
      const selected = findZone(zones, intensity.zoneId ?? definition?.id, intensity.preset);
      result.intensityCustom = selected?.id ?? definition?.id ?? intensity.zoneId ?? 0;
      const low = selected?.lowPercent ?? definition?.low ?? 0;
      const high = selected?.highPercent ?? definition?.high ?? low;
      setPercentFields(result, low, high, context?.criticalPower);
    } else {
      const [low, high] = range(intensity.lowWatts, intensity.highWatts);
      result.intensityValue = Math.round(low);
      result.intensityValueExtend = Math.round(high);
    }
    return result;
  }

  if (intensity.type === "speed") {
    const toKmh = (value: number) => intensity.unit === "mph" ? value * 1.609344 : value;
    const [low, high] = range(toKmh(intensity.low), toKmh(intensity.high));
    return {
      ...result,
      intensityType: 4,
      intensityValue: Math.round(low * 100),
      intensityValueExtend: Math.round(high * 100),
      intensityDisplayUnit: intensity.unit === "mph" ? 5 : 4
    };
  }

  if (intensity.type === "cadence") {
    const [low, high] = range(intensity.low, intensity.high);
    return {
      ...result,
      intensityType: 7,
      intensityValue: Math.round(low),
      intensityValueExtend: Math.round(high),
      intensityPercent: encodeCorosPercent(low),
      intensityPercentExtend: encodeCorosPercent(high)
    };
  }

  if (intensity.type === "swimStroke") {
    return { ...result, intensityType: 5, intensityValue: SWIM_STROKE_IDS[intensity.stroke] };
  }

  if (intensity.type === "weight") {
    if (intensity.mode === "bodyweight") {
      return { ...result, intensityType: 1, intensityCustom: 1 };
    }
    const kg = intensity.unit === "lb" ? intensity.value / 2.2046226218 : intensity.value;
    return {
      ...result,
      intensityType: 1,
      intensityCustom: 0,
      intensityValue: Number(kg.toFixed(2)),
      intensityValueExtend: Number(kg.toFixed(2)),
      intensityDisplayUnit: intensity.unit === "lb" ? 7 : 6
    };
  }

  if (intensity.type === "rpe") {
    return { ...result, intensityType: 11, intensityValue: Math.round(intensity.value) };
  }

  const systemId = CLIMB_SYSTEM_IDS[intensity.system];
  if ("relativeToOnsight" in intensity && intensity.relativeToOnsight !== undefined) {
    return {
      ...result,
      intensityType: 10,
      gradeSystem: systemId,
      onsightGradeOffset: 32 + intensity.relativeToOnsight
    };
  }
  const gradeIndex = CLIMB_GRADES[intensity.system].indexOf(intensity.absoluteGrade);
  return {
    ...result,
    intensityType: 10,
    gradeSystem: systemId,
    onsightGradeOffset: 0,
    intensityValue: gradeIndex < 0 ? 0 : gradeIndex + 1
  };
}

function reverseKey<T extends string>(mapping: Readonly<Record<T, number>>, value: number): T | undefined {
  return (Object.keys(mapping) as T[]).find((key) => mapping[key] === value);
}

export function decodeCorosIntensity(
  exercise: Record<string, unknown>,
  context?: WorkoutEditorContext
): { intensity: WorkoutIntensityInput; reason?: string } {
  const type = finiteNumber(exercise.intensityType) ?? 0;
  const value = finiteNumber(exercise.intensityValue) ?? 0;
  const valueExtend = finiteNumber(exercise.intensityValueExtend) ?? value;
  const custom = finiteNumber(exercise.intensityCustom) ?? 0;
  const percentLow = decodeCorosPercent(exercise.intensityPercent) ?? decodeCorosPercent(value) ?? 0;
  const percentHigh = decodeCorosPercent(exercise.intensityPercentExtend) ?? decodeCorosPercent(valueExtend) ?? percentLow;
  if (type === 0) return { intensity: { type: "none" } };
  if (type === 1) {
    if (custom === 1) return { intensity: { type: "weight", mode: "bodyweight" } };
    const pounds = finiteNumber(exercise.intensityDisplayUnit) === 7;
    return {
      intensity: {
        type: "weight",
        mode: "weight",
        value: Number((pounds ? value * 2.2046226218 : value).toFixed(2)),
        unit: pounds ? "lb" : "kg"
      }
    };
  }
  if (type === 2) {
    if (!Boolean(exercise.isIntensityPercent)) {
      const [lowBpm, highBpm] = range(value, valueExtend);
      return { intensity: { type: "heartRate", lowBpm, highBpm } };
    }
    const basis: WorkoutHeartRateBasis = finiteNumber(exercise.hrType) === 1
      ? "maxHr"
      : finiteNumber(exercise.hrType) === 3 ? "lthr" : "reserve";
    const definition = HEART_RATE_PRESETS[basis].find((entry) => entry.id === custom);
    if (custom && definition) {
      return { intensity: { type: "heartRatePercent", basis, preset: definition.preset, zoneId: custom } };
    }
    const [lowPercent, highPercent] = range(percentLow, percentHigh);
    return { intensity: { type: "heartRatePercent", basis, lowPercent, highPercent } };
  }
  if (type === 3 || type === 8) {
    if (Boolean(exercise.isIntensityPercent)) {
      const definition = PACE_PRESETS.find((entry) => entry.id === custom);
      const intensityType = type === 3 ? "thresholdPacePercent" : "effortPacePercent";
      return definition && custom
        ? { intensity: { type: intensityType, preset: definition.preset, zoneId: custom } }
        : { intensity: { type: intensityType, lowPercent: Math.min(percentLow, percentHigh), highPercent: Math.max(percentLow, percentHigh) } };
    }
    const multiplier = finiteNumber(exercise.intensityMultiplier) || 1_000;
    const [lowSecondsPerKm, highSecondsPerKm] = range(value / multiplier, valueExtend / multiplier);
    return {
      intensity: {
        type: type === 3 ? "pace" : "effortPace",
        lowSecondsPerKm,
        highSecondsPerKm,
        displayUnit: finiteNumber(exercise.intensityDisplayUnit) === 2 ? "mi" : "km"
      }
    };
  }
  if (type === 4) {
    const mph = finiteNumber(exercise.intensityDisplayUnit) === 5;
    const [low, high] = range(value / 100, valueExtend / 100);
    return { intensity: { type: "speed", low: mph ? low / 1.609344 : low, high: mph ? high / 1.609344 : high, unit: mph ? "mph" : "km/h" } };
  }
  if (type === 5) {
    const stroke = reverseKey(SWIM_STROKE_IDS, value);
    return stroke
      ? { intensity: { type: "swimStroke", stroke } }
      : { intensity: { type: "none" }, reason: `Unknown COROS swim stroke ${value} is preserved but locked.` };
  }
  if (type === 6) {
    const definition = RUNNING_POWER_PRESETS.find((entry) => entry.id === custom);
    if (custom && definition) {
      return { intensity: { type: "power", preset: definition.preset, zoneId: custom } };
    }
    const [lowWatts, highWatts] = range(value, valueExtend);
    return { intensity: { type: "power", lowWatts, highWatts } };
  }
  if (type === 7) {
    const [low, high] = range(value, valueExtend);
    return { intensity: { type: "cadence", low, high, unit: "rpm" } };
  }
  if (type === 9) {
    const definition = FTP_PRESETS.find((entry) => entry.id === custom);
    return definition && custom
      ? { intensity: { type: "ftpPercent", preset: definition.preset, zoneId: custom } }
      : { intensity: { type: "ftpPercent", lowPercent: Math.min(percentLow, percentHigh), highPercent: Math.max(percentLow, percentHigh) } };
  }
  if (type === 10) {
    const system = reverseKey(CLIMB_SYSTEM_IDS, finiteNumber(exercise.gradeSystem) ?? 1) ?? "yds";
    const offset = finiteNumber(exercise.onsightGradeOffset) ?? 0;
    if (offset) return { intensity: { type: "climbGrade", system, relativeToOnsight: offset - 32 } };
    const grades = CLIMB_GRADES[system];
    const absoluteGrade = grades[Math.max(0, Math.round(value) - 1)];
    return absoluteGrade
      ? { intensity: { type: "climbGrade", system, absoluteGrade } }
      : { intensity: { type: "none" }, reason: `Unknown COROS ${system} grade ${value} is preserved but locked.` };
  }
  if (type === 11) return { intensity: { type: "rpe", value: Math.round(value || custom || 5) } };
  return { intensity: { type: "none" }, reason: `COROS intensity type ${type} is preserved but locked.` };
}

function validRange(low: number, high: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(low) && Number.isFinite(high) && low >= minimum && high <= maximum && low <= high;
}

export function validateWorkoutIntensity(
  sport: WorkoutSport,
  intensity: WorkoutIntensityInput,
  stepKind: RunWorkoutEditorStepKind = "training",
  exerciseKind?: number
): string | undefined {
  const normalizedType = intensity.type === "lthrPercent" ? "heartRatePercent" : intensity.type;
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  if (!capability) return `Unsupported workout sport "${String(sport)}".`;
  if (!workoutIntensitiesForStep(sport, stepKind, exerciseKind).includes(normalizedType)) {
    return `${formatWorkoutSport(sport)} does not support ${formatIntensityType(normalizedType)} intensity.`;
  }
  if (sport === "strength" && stepKind !== "training" && normalizedType !== "none") {
    return "Strength warm-up, rest, and cool-down steps do not accept intensity.";
  }
  if (intensity.type === "heartRatePercent") {
    if (!(intensity.basis in HEART_RATE_PRESETS)) return "Unsupported heart-rate percentage basis.";
    if (intensity.preset && !HEART_RATE_PRESETS[intensity.basis].some((entry) => entry.preset === intensity.preset)) {
      return `Unsupported ${intensity.basis} heart-rate preset.`;
    }
  }
  if (intensity.type === "heartRate" && !validRange(intensity.lowBpm, intensity.highBpm, 30, 250)) {
    return "Heart rate must be a range from 30 to 250 bpm.";
  }
  if (["heartRatePercent", "lthrPercent", "thresholdPacePercent", "effortPacePercent", "ftpPercent"].includes(intensity.type)) {
    const preset = "preset" in intensity && intensity.preset !== undefined;
    const custom = "lowPercent" in intensity && intensity.lowPercent !== undefined && intensity.highPercent !== undefined;
    if (preset === custom) return "Percentage intensity requires exactly one preset or custom percentage range.";
    if (custom && !validRange(intensity.lowPercent!, intensity.highPercent!, 1, 300)) {
      return "Percentage intensity must be a range from 1% to 300%.";
    }
  }
  if ((intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent") && intensity.preset && !PACE_PRESETS.some((entry) => entry.preset === intensity.preset)) {
    return "Unsupported pace preset.";
  }
  if (intensity.type === "ftpPercent" && intensity.preset && !FTP_PRESETS.some((entry) => entry.preset === intensity.preset)) {
    return "Unsupported FTP preset.";
  }
  if ((intensity.type === "pace" || intensity.type === "effortPace") && !validRange(intensity.lowSecondsPerKm, intensity.highSecondsPerKm, 1, 3_600)) {
    return "Pace must be a valid range.";
  }
  if (intensity.type === "power" && !intensity.preset && !validRange(intensity.lowWatts, intensity.highWatts, 0, 3_000)) {
    return "Power must be a range from 0 to 3000 watts.";
  }
  if (intensity.type === "power" && intensity.preset && !RUNNING_POWER_PRESETS.some((entry) => entry.preset === intensity.preset)) {
    return "Unsupported running-power preset.";
  }
  if ((intensity.type === "speed" || intensity.type === "cadence") && !validRange(intensity.low, intensity.high, 0, intensity.type === "speed" ? 200 : 300)) {
    return `${formatIntensityType(intensity.type)} is outside the supported range.`;
  }
  if (intensity.type === "weight" && intensity.mode === "weight" && (!Number.isFinite(intensity.value) || intensity.value < 0 || intensity.value > 2_000)) {
    return "Weight must be from 0 to 2000.";
  }
  if (intensity.type === "swimStroke" && !(intensity.stroke in SWIM_STROKE_IDS)) {
    return "Unsupported swim stroke.";
  }
  if (intensity.type === "rpe" && (!Number.isInteger(intensity.value) || intensity.value < 1 || intensity.value > 10)) {
    return "RPE must be a whole number from 1 to 10.";
  }
  if (intensity.type === "climbGrade") {
    if (!(intensity.system in CLIMB_SYSTEM_IDS)) return "Unsupported climbing grading system.";
    if (
      "relativeToOnsight" in intensity &&
      intensity.relativeToOnsight !== undefined &&
      (intensity.relativeToOnsight < -8 || intensity.relativeToOnsight > 4)
    ) {
      return "Relative climb grade must be from -8 through +4.";
    }
    if (
      "absoluteGrade" in intensity &&
      intensity.absoluteGrade !== undefined &&
      !CLIMB_GRADES[intensity.system].includes(intensity.absoluteGrade)
    ) {
      return `${intensity.absoluteGrade} is not a supported ${intensity.system} grade.`;
    }
  }
  return undefined;
}

export function validateWorkoutTarget(
  sport: WorkoutSport,
  stepKind: RunWorkoutEditorStepKind,
  target: RunWorkoutEditorTarget,
  exerciseKind?: number
): string | undefined {
  const targets = workoutTargetsForStep(sport, stepKind, exerciseKind);
  if (!targets.includes(target.type)) {
    return `${formatWorkoutSport(sport)} ${stepKind} steps do not support ${target.type}.`;
  }
  if (target.type === "time" && (!Number.isFinite(target.seconds) || target.seconds <= 0 || target.seconds > 86_399)) return "Time must be from 1 second to 23:59:59.";
  if (target.type === "distance" && (!Number.isFinite(target.meters) || target.meters <= 0)) return "Distance must be greater than zero.";
  if (target.type === "load" && (!Number.isInteger(target.load) || target.load < 0 || target.load > 999)) return "Training Load must be a whole number from 0 to 999.";
  if (target.type === "hrRecovery" && (stepKind !== "rest" || target.bpm < 30 || target.bpm > 180)) return "HR Recovery is available only for Rest and must be from 30 to 180 bpm.";
  if (target.type === "reps" && (!Number.isInteger(target.count) || target.count < 1 || target.count > 500)) return "Reps must be from 1 to 500.";
  if (target.type === "routes" && (!Number.isInteger(target.count) || target.count < 1 || target.count > 20)) return "Routes must be from 1 to 20.";
  if (target.type === "elevationGain" && (!Number.isFinite(target.meters) || target.meters < 20 || target.meters > 10_000)) return "Elevation gain must be from 20 to 10,000 meters.";
  return undefined;
}

export function workoutTargetsForStep(
  sport: WorkoutSport,
  stepKind: RunWorkoutEditorStepKind,
  exerciseKind?: number
): readonly WorkoutTargetType[] {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  if (sport === "strength" && stepKind !== "training") {
    return stepKind === "rest" ? capability.restTargets : ["time", "open"];
  }
  if (sport === "swim" && stepKind === "sendOff") return ["distance"];
  if (sport === "hyrox" && stepKind === "training" && exerciseKind && HYROX_FUNCTIONAL_TARGETS[exerciseKind]) {
    return HYROX_FUNCTIONAL_TARGETS[exerciseKind];
  }
  return stepKind === "rest" ? capability.restTargets : capability.targets;
}

export function workoutIntensitiesForStep(
  sport: WorkoutSport,
  stepKind: RunWorkoutEditorStepKind,
  exerciseKind?: number
): readonly WorkoutIntensityType[] {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  if (sport === "strength" && stepKind !== "training") return ["none"];
  if (sport === "hyrox" && stepKind === "training" && exerciseKind) {
    return HYROX_FUNCTIONAL_INTENSITIES[exerciseKind] ?? ["weight", "rpe"];
  }
  return capability.intensities;
}

export function validateWorkoutSportOptions(
  sport: WorkoutSport,
  options: RunWorkoutEditorDraft["sportOptions"]
): string[] {
  if (!options) return [];
  const errors: string[] = [];
  if (options.poolLength) {
    if (sport !== "swim") errors.push("Pool length is only supported for Pool Swim workouts.");
    if (!Number.isFinite(options.poolLength.value) || options.poolLength.value <= 0) {
      errors.push("Pool length must be greater than zero.");
    }
    if (options.poolLength.unit !== "m" && options.poolLength.unit !== "yd") {
      errors.push("Pool length unit must be meters or yards.");
    }
  }
  if (options.gradingSystem) {
    if (sport !== "indoorClimb" && sport !== "bouldering") {
      errors.push("Climbing grading system is only supported for climbing workouts.");
    }
    if (!(options.gradingSystem in CLIMB_SYSTEM_IDS)) {
      errors.push("Unsupported climbing grading system.");
    }
  }
  return errors;
}

export function validateWorkoutDraftShared(
  draft: RunWorkoutEditorDraft
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Name is required.";
  else if (draft.name.trim().length > 90) errors.name = "Name must be 90 characters or fewer.";
  if (draft.overview.length > 300) errors.overview = "Description must be 300 characters or fewer.";
  if (!draft.nodes.length) errors.nodes = "Add at least one workout step.";
  const capability = WORKOUT_SPORT_CAPABILITIES[draft.sport];
  if (!capability || capability.sportType !== draft.sportType) {
    errors.sport = "Workout sport and COROS sport type do not match.";
  }
  const optionErrors = validateWorkoutSportOptions(draft.sport, draft.sportOptions);
  if (optionErrors.length) errors.sportOptions = optionErrors.join(" ");
  if (!capability) return { valid: false, errors };
  const checkStep = (step: RunWorkoutEditorStep, path: string): void => {
    if (!step.editable) return;
    const targetError = validateWorkoutTarget(draft.sport, step.kind, step.target, step.exerciseKind);
    if (targetError) errors[`${path}.target`] = targetError;
    const intensityError = validateWorkoutIntensity(draft.sport, step.intensity, step.kind, step.exerciseKind);
    if (intensityError) errors[`${path}.intensity`] = intensityError;
    const needsExercise = draft.sport === "strength" ||
      (draft.sport === "hyrox" && step.exerciseKind !== undefined);
    if (needsExercise && step.kind === "training" && !step.exerciseId && !step.exerciseName) {
      errors[`${path}.exercise`] = `${capability.label} training steps require an exercise.`;
    }
  };
  draft.nodes.forEach((node, index) => {
    if (node.nodeType === "step") return checkStep(node, `nodes.${index}`);
    if (!Number.isInteger(node.repeat) || node.repeat < 1 || node.repeat > 99) errors[`nodes.${index}.repeat`] = "Repeat count must be from 1 to 99.";
    if (!node.steps.length) errors[`nodes.${index}.steps`] = "Repeat groups need at least one step.";
    node.steps.forEach((step, childIndex) => checkStep(step, `nodes.${index}.steps.${childIndex}`));
  });
  return { valid: Object.keys(errors).length === 0, errors };
}

export function formatWorkoutSport(sport: WorkoutSport): string {
  return WORKOUT_SPORT_CAPABILITIES[sport].label;
}

export function formatIntensityType(type: WorkoutIntensityType): string {
  const labels: Record<WorkoutIntensityType, string> = {
    none: "Not set",
    heartRate: "Heart Rate",
    heartRatePercent: "% Heart Rate",
    pace: "Pace",
    effortPace: "Effort Pace",
    thresholdPacePercent: "% Threshold Pace",
    effortPacePercent: "% Effort Pace",
    ftpPercent: "% FTP",
    power: "Power",
    speed: "Speed",
    cadence: "Cadence",
    swimStroke: "Stroke",
    weight: "Weight",
    rpe: "RPE",
    climbGrade: "Grade"
  };
  return labels[type];
}

export function formatWorkoutIntensity(intensity: WorkoutIntensityInput): string {
  if (intensity.type === "none") return "Not set";
  if (intensity.type === "heartRate") return `${intensity.lowBpm}–${intensity.highBpm} bpm`;
  if (intensity.type === "heartRatePercent") return intensity.preset
    ? `${intensity.preset} · % ${intensity.basis}`
    : `${intensity.lowPercent}–${intensity.highPercent}% ${intensity.basis}`;
  if (intensity.type === "lthrPercent") return `${intensity.lowPercent}–${intensity.highPercent}% LTHR`;
  if (intensity.type === "pace" || intensity.type === "effortPace") return `${formatPace(intensity.lowSecondsPerKm, intensity.displayUnit)}–${formatPace(intensity.highSecondsPerKm, intensity.displayUnit)}/${intensity.displayUnit}`;
  if (intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent" || intensity.type === "ftpPercent") return intensity.preset ? intensity.preset : `${intensity.lowPercent}–${intensity.highPercent}%`;
  if (intensity.type === "power") return intensity.preset ? intensity.preset : `${intensity.lowWatts}–${intensity.highWatts} W`;
  if (intensity.type === "speed" || intensity.type === "cadence") return `${intensity.low}–${intensity.high} ${intensity.unit}`;
  if (intensity.type === "swimStroke") return intensity.stroke;
  if (intensity.type === "weight") return intensity.mode === "bodyweight" ? "Bodyweight" : `${intensity.value} ${intensity.unit}`;
  if (intensity.type === "rpe") return `RPE ${intensity.value}`;
  return "relativeToOnsight" in intensity && intensity.relativeToOnsight !== undefined
    ? `${intensity.relativeToOnsight >= 0 ? "+" : ""}${intensity.relativeToOnsight} from onsight`
    : `${intensity.absoluteGrade} (${intensity.system})`;
}

function formatPace(secondsPerKm: number, unit: "km" | "mi"): string {
  const seconds = Math.round(unit === "mi" ? secondsPerKm / 0.621371192 : secondsPerKm);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** JSON Schema used by the MCP tool. Runtime validation still uses this registry. */
export function buildDraftTrainingPlanInputSchema(): Record<string, unknown> {
  const numberRange = (low: string, high: string, unit?: string) => ({
    type: "object",
    properties: {
      type: { type: "string" },
      [low]: { type: "number" },
      [high]: { type: "number" },
      ...(unit ? { [unit]: { type: "string" } } : {})
    },
    required: ["type", low, high, ...(unit ? [unit] : [])]
  });
  const percent = (type: string, presetValues: readonly string[], extra = {}) => ({
    oneOf: [
      {
        type: "object",
        properties: {
          type: { const: type },
          ...extra,
          preset: { type: "string", enum: presetValues }
        },
        required: ["type", ...Object.keys(extra), "preset"]
      },
      {
        type: "object",
        properties: {
          type: { const: type },
          ...extra,
          lowPercent: { type: "number", minimum: 1, maximum: 300 },
          highPercent: { type: "number", minimum: 1, maximum: 300 }
        },
        required: ["type", ...Object.keys(extra), "lowPercent", "highPercent"]
      }
    ]
  });
  const intensity = {
    oneOf: [
      { type: "object", properties: { type: { const: "none" } }, required: ["type"] },
      { ...numberRange("lowBpm", "highBpm"), properties: { ...numberRange("lowBpm", "highBpm").properties, type: { const: "heartRate" } } },
      {
        oneOf: (Object.keys(HEART_RATE_PRESETS) as WorkoutHeartRateBasis[]).flatMap((basis) => {
          const basisSchema = { basis: { const: basis } };
          const schema = percent(
            "heartRatePercent",
            HEART_RATE_PRESETS[basis].map((entry) => entry.preset),
            basisSchema
          );
          return schema.oneOf;
        })
      },
      {
        ...numberRange("lowSecondsPerKm", "highSecondsPerKm", "displayUnit"),
        properties: {
          ...numberRange("lowSecondsPerKm", "highSecondsPerKm", "displayUnit").properties,
          type: { const: "pace" },
          displayUnit: { type: "string", enum: ["km", "mi"] }
        }
      },
      {
        ...numberRange("lowSecondsPerKm", "highSecondsPerKm", "displayUnit"),
        properties: {
          ...numberRange("lowSecondsPerKm", "highSecondsPerKm", "displayUnit").properties,
          type: { const: "effortPace" },
          displayUnit: { type: "string", enum: ["km", "mi"] }
        }
      },
      percent("thresholdPacePercent", PACE_PRESETS.map((entry) => entry.preset)),
      percent("effortPacePercent", PACE_PRESETS.map((entry) => entry.preset)),
      percent("ftpPercent", FTP_PRESETS.map((entry) => entry.preset)),
      {
        oneOf: [
          { type: "object", properties: { type: { const: "power" }, lowWatts: { type: "number" }, highWatts: { type: "number" } }, required: ["type", "lowWatts", "highWatts"] },
          { type: "object", properties: { type: { const: "power" }, preset: { type: "string", enum: RUNNING_POWER_PRESETS.map((entry) => entry.preset) } }, required: ["type", "preset"] }
        ]
      },
      { type: "object", properties: { type: { const: "speed" }, low: { type: "number" }, high: { type: "number" }, unit: { type: "string", enum: ["km/h", "mph"] } }, required: ["type", "low", "high", "unit"] },
      { type: "object", properties: { type: { const: "cadence" }, low: { type: "number" }, high: { type: "number" }, unit: { type: "string", enum: ["spm", "rpm"] } }, required: ["type", "low", "high", "unit"] },
      { type: "object", properties: { type: { const: "swimStroke" }, stroke: { type: "string", enum: Object.keys(SWIM_STROKE_IDS) } }, required: ["type", "stroke"] },
      {
        oneOf: [
          { type: "object", properties: { type: { const: "weight" }, mode: { const: "bodyweight" } }, required: ["type", "mode"] },
          { type: "object", properties: { type: { const: "weight" }, mode: { const: "weight" }, value: { type: "number", minimum: 0 }, unit: { type: "string", enum: ["kg", "lb"] } }, required: ["type", "mode", "value", "unit"] }
        ]
      },
      { type: "object", properties: { type: { const: "rpe" }, value: { type: "integer", minimum: 1, maximum: 10 } }, required: ["type", "value"] },
      {
        oneOf: [
          { type: "object", properties: { type: { const: "climbGrade" }, system: { type: "string", enum: Object.keys(CLIMB_SYSTEM_IDS) }, relativeToOnsight: { type: "integer", minimum: -8, maximum: 4 } }, required: ["type", "system", "relativeToOnsight"] },
          { type: "object", properties: { type: { const: "climbGrade" }, system: { type: "string", enum: Object.keys(CLIMB_SYSTEM_IDS) }, absoluteGrade: { type: "string" } }, required: ["type", "system", "absoluteGrade"] }
        ]
      }
    ]
  };
  const step = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["warmup", "training", "interval", "rest", "cooldown", "sendOff"] },
      name: { type: "string" },
      target_type: { type: "string", enum: ["distance", "time", "load", "hrRecovery", "open", "reps", "elevationGain", "routes"] },
      target_distance_meters: { type: "number", exclusiveMinimum: 0 },
      target_duration_seconds: { type: "number", exclusiveMinimum: 0 },
      target_load: { type: "integer", minimum: 0, maximum: 999 },
      target_hr_recovery_bpm: { type: "integer", minimum: 30, maximum: 180 },
      target_reps: { type: "integer", minimum: 1, maximum: 500 },
      target_elevation_gain_meters: { type: "number", minimum: 20, maximum: 10000 },
      target_routes: { type: "integer", minimum: 1, maximum: 20 },
      send_off_seconds: { type: "integer", minimum: 1, maximum: 86399 },
      intensity,
      exercise_id: { type: "string" },
      exercise_name: { type: "string" },
      exercise_kind: { type: "integer" }
    },
    required: ["kind", "target_type"]
  };
  const intensityVariants = intensity.oneOf as Array<Record<string, unknown>>;
  const variantType = (variant: Record<string, unknown>): WorkoutIntensityType | undefined => {
    const directProperties = variant.properties as Record<string, { const?: string }> | undefined;
    const nested = variant.oneOf as Array<Record<string, unknown>> | undefined;
    const nestedProperties = nested?.[0]?.properties as Record<string, { const?: string }> | undefined;
    return (directProperties?.type?.const ?? nestedProperties?.type?.const) as WorkoutIntensityType | undefined;
  };
  const stepForSport = (sport: WorkoutSport) => {
    const capability = WORKOUT_SPORT_CAPABILITIES[sport];
    const kinds = [...capability.stepKinds];
    if (kinds.includes("training") && !kinds.includes("interval" as RunWorkoutEditorStepKind)) {
      kinds.push("interval" as RunWorkoutEditorStepKind);
    }
    const targets = [...new Set([...capability.targets, ...capability.restTargets])];
    return {
      ...step,
      properties: {
        ...step.properties,
        kind: { type: "string", enum: kinds },
        target_type: { type: "string", enum: targets },
        intensity: {
          oneOf: intensityVariants.filter((variant) => {
            const type = variantType(variant);
            return Boolean(type && capability.intensities.includes(type));
          })
        }
      }
    };
  };
  const workoutForSport = (sport: WorkoutSport) => {
    const capability = WORKOUT_SPORT_CAPABILITIES[sport];
    const sportStep = stepForSport(sport);
    return {
      type: "object",
      properties: {
        key: { type: "string" },
        name: { type: "string" },
        sport: { const: sport, ...(sport === "run" ? { default: "run" } : {}) },
        ...(capability.supportsPoolLength || capability.supportsGradingSystem
          ? {
              sport_options: {
                type: "object",
                properties: {
                  ...(capability.supportsPoolLength
                    ? { poolLength: { type: "object", properties: { value: { type: "number", exclusiveMinimum: 0 }, unit: { type: "string", enum: ["m", "yd"] } }, required: ["value", "unit"] } }
                    : {}),
                  ...(capability.supportsGradingSystem
                    ? { gradingSystem: { type: "string", enum: Object.keys(CLIMB_SYSTEM_IDS) } }
                    : {})
                }
              }
            }
          : {}),
        distance_km: { type: "number", exclusiveMinimum: 0, description: "Legacy Run/Trail Run shorthand; omit when using steps." },
        schedule_date: { type: "string", pattern: "^\\d{8}$" },
        sort_no: { type: "integer", minimum: 1 },
        save_to_library: { type: "boolean" },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            oneOf: [
              sportStep,
              { type: "object", properties: { repeat: { type: "integer", minimum: 1, maximum: 99 }, name: { type: "string" }, steps: { type: "array", minItems: 1, items: sportStep } }, required: ["repeat", "steps"] }
            ]
          }
        }
      },
      required: ["key", "name", ...(sport === "run" ? [] : ["sport"])]
    };
  };
  return {
    type: "object",
    properties: {
      name: { type: "string", description: "Plan name" },
      workouts: {
        type: "array",
        minItems: 1,
        items: { oneOf: WORKOUT_SPORTS.map(workoutForSport) }
      }
    },
    required: ["name", "workouts"]
  };
}
