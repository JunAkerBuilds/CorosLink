import type { UnitSystem } from "../../electron/types";
import {
  distanceUnit,
  elevationUnit,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  metersToDisplayDistance,
  metersToElevation,
  secondsPerKmToDisplayPace
} from "../units/units";

export function formatTrainingTimestamp(value?: number): string {
  if (!value) {
    return "Unknown";
  }

  const timestamp = value < 10_000_000_000 ? value * 1000 : value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function formatTrainingTableWhen(value?: number): string {
  if (!value) {
    return "—";
  }

  const timestamp = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();

  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatDurationSeconds(value?: number): string {
  if (!Number.isFinite(value) || !value) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
      2,
      "0"
    )}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDistanceMeters(
  value: number | undefined,
  unitSystem: UnitSystem,
  swim = false
): string {
  return formatDistanceValue(value, unitSystem, { swim });
}

export function formatElevationMeters(
  value: number | undefined,
  unitSystem: UnitSystem
): string {
  return formatElevationValue(value, unitSystem);
}

export function formatOptionalNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatPaceSecondsPerKm(
  value: number | undefined,
  unitSystem: UnitSystem
): string {
  return formatPaceValue(value, unitSystem);
}

export function formatCorosCompactPace(
  value: number | undefined,
  unitSystem: UnitSystem
): string {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return "";
  }

  const rounded = Math.round(secondsPerKmToDisplayPace(value, unitSystem));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}'${String(seconds).padStart(2, "0")}"`;
}

interface PaceZoneBoundary {
  index: number;
  pace?: number;
}

export function formatRunningFitnessPaceRange(
  minPace: number | undefined,
  maxPace: number | undefined,
  unitSystem: UnitSystem
): string | undefined {
  if (
    minPace !== undefined &&
    maxPace !== undefined &&
    Number.isFinite(minPace) &&
    Number.isFinite(maxPace)
  ) {
    return `${formatCorosCompactPace(minPace, unitSystem)} - ${formatCorosCompactPace(maxPace, unitSystem)}/${distanceUnit(unitSystem)}`;
  }

  if (maxPace !== undefined && Number.isFinite(maxPace)) {
    return `< ${formatCorosCompactPace(maxPace, unitSystem)}/${distanceUnit(unitSystem)}`;
  }

  return undefined;
}

const RUNNING_FITNESS_ZONE_SLOTS = {
  Endurance: 1,
  Threshold: 3,
  Speed: 4,
  Sprint: 5
} as const;

const RUNNING_FITNESS_ZONE_SLOTS_BY_COUNT: Record<
  number,
  Record<keyof typeof RUNNING_FITNESS_ZONE_SLOTS, number>
> = {
  6: {
    Endurance: 1,
    Threshold: 3,
    Speed: 4,
    Sprint: 5
  },
  5: {
    Endurance: 0,
    Threshold: 2,
    Speed: 3,
    Sprint: 4
  }
};

export function buildRunningFitnessPaceLabels(
  ltspZones: PaceZoneBoundary[],
  unitSystem: UnitSystem
): Partial<Record<keyof typeof RUNNING_FITNESS_ZONE_SLOTS, string>> {
  const zones = ltspZones
    .filter((zone) => zone.pace !== undefined && Number.isFinite(zone.pace))
    .sort((left, right) => left.index - right.index);

  const slotMap = RUNNING_FITNESS_ZONE_SLOTS_BY_COUNT[zones.length];

  if (!slotMap) {
    return {};
  }

  const labels: Partial<Record<keyof typeof RUNNING_FITNESS_ZONE_SLOTS, string>> =
    {};

  for (const [label, slotIndex] of Object.entries(slotMap)) {
    if (label === "Sprint") {
      const sprintZone = zones[slotIndex];

      if (sprintZone?.pace) {
        labels.Sprint = formatRunningFitnessPaceRange(undefined, sprintZone.pace, unitSystem);
      }

      continue;
    }

    const zone = zones[slotIndex];
    const fasterZone = zones[slotIndex + 1];

    if (!zone?.pace || !fasterZone?.pace) {
      continue;
    }

    const minPace =
      slotIndex + 1 === zones.length - 1
        ? fasterZone.pace
        : fasterZone.pace + 1;

    labels[label as keyof typeof RUNNING_FITNESS_ZONE_SLOTS] =
      formatRunningFitnessPaceRange(minPace, zone.pace, unitSystem);
  }

  return labels;
}

export function formatHappenDayLabel(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(year, month, day));
}

export function formatSleepNightLabel(record: {
  happenDay: string;
  sleepStart?: string;
  sleepEnd?: string;
}): string {
  return formatHappenDayLabel(record.happenDay);
}

function formatSleepClock(value?: string): string | undefined {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function formatSleepClockRange(
  sleepStart?: string,
  sleepEnd?: string
): string | undefined {
  const start = formatSleepClock(sleepStart);
  const end = formatSleepClock(sleepEnd);

  return start && end ? `${start} – ${end}` : undefined;
}

export function formatSignedDelta(value?: number, suffix = ""): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const rounded = Math.round(value * 10) / 10;
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded}${suffix}`;
}

export function recentTrainingHubDateList(days: number): string[] {
  return Array.from({ length: days }, (_value, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  });
}

export function getLocalHappenDayKey(referenceDate = new Date()): string {
  const year = referenceDate.getFullYear();
  const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const day = String(referenceDate.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function happenDayFromTimestamp(timestamp?: number): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return getLocalHappenDayKey(new Date(ms));
}

export function isUpcomingWorkoutScheduled(happenDay: string): boolean {
  return /^\d{8}$/.test(happenDay) && happenDay >= getLocalHappenDayKey();
}

export function filterUpcomingWorkoutsFromToday<
  T extends { happenDay: string }
>(workouts: T[]): T[] {
  return workouts.filter((workout) => isUpcomingWorkoutScheduled(workout.happenDay));
}

export function formatUpcomingWorkoutDate(happenDay: string): string {
  if (!/^\d{8}$/.test(happenDay)) {
    return happenDay;
  }

  const todayKey = getLocalHappenDayKey();

  if (happenDay === todayKey) {
    return "Today";
  }

  const year = Number(happenDay.slice(0, 4));
  const month = Number(happenDay.slice(4, 6)) - 1;
  const day = Number(happenDay.slice(6, 8));
  const date = new Date(year, month, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays > 0 && diffDays <= 6) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short"
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function isUpcomingWorkoutToday(happenDay: string): boolean {
  if (!/^\d{8}$/.test(happenDay)) {
    return false;
  }

  return happenDay === getLocalHappenDayKey();
}

export function formatUpcomingWorkoutLoad(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return `${Math.round(value)}TL`;
}

export function parseUpcomingWorkoutDistanceKm(
  volume?: string
): number | null {
  if (!volume) {
    return null;
  }

  const kmMatch = volume.match(/^([\d.]+)\s*km$/i);

  if (kmMatch) {
    const km = Number(kmMatch[1]);
    return Number.isFinite(km) ? km : null;
  }

  return null;
}

export function formatUpcomingWorkoutVolumeDisplay(
  volume: string | undefined,
  unitSystem: UnitSystem
): string {
  if (!volume) return "--";
  const km = volume.match(/^([\d.]+)\s*km$/i);
  if (km) {
    const meters = Number(km[1]) * 1000;
    if (Number.isFinite(meters)) {
      return formatDistanceValue(meters, unitSystem);
    }
  }
  const meters = volume.match(/^([\d.]+)\s*m$/i);
  if (meters) {
    const value = Number(meters[1]);
    if (Number.isFinite(value)) {
      return formatDistanceValue(value, unitSystem, { swim: true });
    }
  }
  return volume;
}

export function inferUpcomingWorkoutCategory(name: string): string {
  const normalized = name.trim().toLowerCase();

  if (!normalized) {
    return "Run";
  }

  if (/(race|marathon|half|10k|5k|parkrun)/.test(normalized)) {
    return "Race";
  }

  if (/(long run|long\b)/.test(normalized)) {
    return "Long";
  }

  if (/(easy|recovery|filler|rest|aerobic)/.test(normalized)) {
    return "Easy";
  }

  if (/(interval|repeat|400|800|track|fartlek|tempo|speed|taper|vo2|threshold)/.test(
    normalized
  )) {
    if (/(interval|repeat|400|800|track|fartlek|vo2)/.test(normalized)) {
      return "Intervals";
    }

    return "Speed";
  }

  return "Run";
}

export function formatUpcomingWorkoutStats(
  workouts: Array<{ volume?: string; trainingLoad?: number }>,
  unitSystem: UnitSystem
): string {
  const count = workouts.length;
  const workoutLabel = `${count} workout${count === 1 ? "" : "s"}`;

  const totalKm = workouts.reduce((sum, workout) => {
    const km = parseUpcomingWorkoutDistanceKm(workout.volume);
    return km === null ? sum : sum + km;
  }, 0);

  const totalLoad = workouts.reduce((sum, workout) => {
    if (workout.trainingLoad === undefined || !Number.isFinite(workout.trainingLoad)) {
      return sum;
    }

    return sum + workout.trainingLoad;
  }, 0);

  const parts = [workoutLabel];

  if (totalKm > 0) {
    const meters = totalKm * 1000;
    const displayed = metersToDisplayDistance(meters, unitSystem);
    const rounded = Math.abs(displayed - Math.round(displayed)) < 0.05
      ? Math.round(displayed)
      : Number(displayed.toFixed(1));
    parts.push(`${rounded} ${distanceUnit(unitSystem)}`);
  }

  if (totalLoad > 0) {
    parts.push(`${Math.round(totalLoad)} TL`);
  }

  return parts.join(" · ");
}

export function formatUpcomingWorkoutDetailLine(
  category: string,
  volume: string | undefined,
  trainingLoad: number | undefined,
  unitSystem: UnitSystem
): string {
  const volumeLabel = formatUpcomingWorkoutVolumeDisplay(volume, unitSystem);
  const loadLabel = formatUpcomingWorkoutLoad(trainingLoad);
  return `${category} · ${volumeLabel} · ${loadLabel}`;
}

export function formatUpcomingWorkoutRowStats(
  volume: string | undefined,
  trainingLoad: number | undefined,
  unitSystem: UnitSystem
): string | null {
  const volumeLabel = formatUpcomingWorkoutVolumeDisplay(volume, unitSystem);
  const loadLabel = formatUpcomingWorkoutLoad(trainingLoad);
  const parts: string[] = [];

  if (volumeLabel !== "--") {
    parts.push(volumeLabel);
  }

  if (loadLabel !== "--") {
    parts.push(loadLabel);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

const RECORD_TYPE_LONGEST_RUN = 101;
const RECORD_TYPE_ELEVATION_GAIN = 103;

const PERSONAL_RECORD_SLOT_TYPES = new Set([103, 2, 13]);

const PERSONAL_RECORD_VISIBLE_DISTANCE_TYPES = new Set([4, 5, 6, 7]);

const DISTANCE_PR_DISTANCE_METERS: Record<number, number> = {
  2: 21097.5,
  3: 15000,
  4: 10000,
  5: 5000,
  6: 3000,
  7: 1000,
  8: 1609,
  9: 3218,
  10: 4828.032,
  11: 8046.72,
  12: 16093.44,
  13: 42195
};

function derivePersonalRecordPaceFromDuration(
  type: number,
  duration?: number
): number | undefined {
  const knownDistance = DISTANCE_PR_DISTANCE_METERS[type];

  if (
    duration === undefined ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    knownDistance === undefined
  ) {
    return undefined;
  }

  return duration / (knownDistance / 1000);
}

function formatRecordDistanceHero(
  distanceMeters: number,
  unitSystem: UnitSystem
): string {
  return `${metersToDisplayDistance(distanceMeters, unitSystem).toFixed(2)}${distanceUnit(unitSystem)}`;
}

export function formatRecordDateShort(happenDay?: string): string {
  if (!happenDay || !/^\d{8}$/.test(happenDay)) {
    return happenDay ?? "—";
  }

  const year = Number(happenDay.slice(0, 4));
  const month = Number(happenDay.slice(4, 6)) - 1;
  const day = Number(happenDay.slice(6, 8));

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(year, month, day));
}

export function isPersonalRecordPopulated(record: {
  type: number;
  duration?: number;
  distance?: number;
  avgPace?: number;
}): boolean {
  if (record.type === RECORD_TYPE_LONGEST_RUN || record.type === RECORD_TYPE_ELEVATION_GAIN) {
    return record.distance !== undefined && record.distance > 0;
  }

  return record.duration !== undefined && record.duration > 0;
}

export function formatPersonalRecordHero(record: {
  type: number;
  duration?: number;
  distance?: number;
  avgPace?: number;
}, unitSystem: UnitSystem): string {
  if (PERSONAL_RECORD_SLOT_TYPES.has(record.type) && !isPersonalRecordPopulated(record)) {
    return "Not recorded";
  }

  if (record.type === RECORD_TYPE_LONGEST_RUN) {
    if (record.distance !== undefined && record.distance > 0) {
      return formatRecordDistanceHero(record.distance, unitSystem);
    }

    return "—";
  }

  if (record.type === RECORD_TYPE_ELEVATION_GAIN) {
    if (record.distance !== undefined && record.distance > 0) {
      return `${Math.round(metersToElevation(record.distance, unitSystem))}${elevationUnit(unitSystem)}`;
    }

    return "—";
  }

  if (record.duration !== undefined && record.duration > 0) {
    return formatDurationSeconds(record.duration);
  }

  return "—";
}

export function formatPersonalRecordMeta(record: {
  type: number;
  duration?: number;
  distance?: number;
  avgPace?: number;
}, unitSystem: UnitSystem): string | null {
  if (!isPersonalRecordPopulated(record)) {
    return null;
  }

  const paceSeconds =
    record.avgPace ?? derivePersonalRecordPaceFromDuration(record.type, record.duration);
  const pace = formatPaceSecondsPerKm(paceSeconds, unitSystem);
  return pace === "-" ? null : pace;
}

export function isPersonalRecordVisible(record: {
  type: number;
  duration?: number;
  distance?: number;
  avgPace?: number;
  happenDay?: string;
}): boolean {
  if (PERSONAL_RECORD_SLOT_TYPES.has(record.type)) {
    return true;
  }

  if (
    record.type === RECORD_TYPE_LONGEST_RUN ||
    record.type === RECORD_TYPE_ELEVATION_GAIN
  ) {
    return isPersonalRecordPopulated(record);
  }

  return (
    PERSONAL_RECORD_VISIBLE_DISTANCE_TYPES.has(record.type) &&
    isPersonalRecordPopulated(record)
  );
}
