import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  WorkoutSport
} from "../../electron/types";
import {
  WORKOUT_SPORT_CAPABILITIES,
  workoutSportFromType
} from "../../electron/workoutCapabilities";
import { activityMovingSeconds } from "../../electron/activityTime";
import { parseUpcomingWorkoutDistanceKm } from "../training/formatters";
import type { SportColorCategory } from "../training/sportColors";
import { resolveSportName } from "../training/sportTypes";
import type { CalendarDay } from "./calendarTypes";

/**
 * Sport groups for the weekly breakdown. COROS's own calendar only breaks the
 * week down into Run and Bike; every activity type lands in one of these so the
 * per-sport rows add up to the week totals.
 */
export type WeekSportFamily =
  | "run"
  | "trail"
  | "hike"
  | "bike"
  | "swim"
  | "strength"
  | "cardio"
  | "walk"
  | "ski"
  | "water"
  | "climb"
  | "multisport"
  | "other";

// Declaration order is display order.
export const WEEK_SPORT_FAMILY_META: Record<
  WeekSportFamily,
  { label: string; color: SportColorCategory }
> = {
  run: { label: "Run", color: "run" },
  trail: { label: "Trail Run", color: "trail" },
  hike: { label: "Hike", color: "trail" },
  bike: { label: "Bike", color: "bike" },
  swim: { label: "Swim", color: "other" },
  strength: { label: "Strength", color: "strength" },
  cardio: { label: "Cardio", color: "strength" },
  walk: { label: "Walk", color: "other" },
  ski: { label: "Ski", color: "other" },
  water: { label: "Water Sports", color: "other" },
  climb: { label: "Climb", color: "other" },
  multisport: { label: "Multisport", color: "other" },
  other: { label: "Other", color: "other" }
};

const FAMILY_ORDER = Object.keys(WEEK_SPORT_FAMILY_META) as WeekSportFamily[];

// Completed activities carry COROS *activity* codes; keep in sync with
// electron/corosSportTypes.ts. Bike/ski/water families are matched by range below.
const ACTIVITY_SPORT_FAMILY: Record<number, WeekSportFamily> = {
  100: "run", //       Run
  101: "run", //       Indoor Run
  102: "trail", //     Trail Run
  103: "run", //       Track Run
  104: "hike", //      Hike
  105: "hike", //      Mountain Climb
  106: "climb", //     Climb
  300: "swim", //      Pool Swim
  301: "swim", //      Open Water Swim
  400: "cardio", //    Gym Cardio
  401: "cardio", //    GPS Cardio
  402: "strength", //  Strength
  800: "climb", //     Indoor Climb
  801: "climb", //     Bouldering
  900: "walk", //      Walk
  901: "cardio", //    Jump Rope
  902: "cardio", //    Climb Stairs
  10000: "multisport", // Triathlon
  10001: "multisport", // Multi Sport
  10002: "ski", //     Ski Touring
  10003: "climb" //    Multi-Pitch Climb
};

export function activitySportFamily(sportType: number | undefined): WeekSportFamily {
  if (sportType === undefined) {
    return "other";
  }
  const exact = ACTIVITY_SPORT_FAMILY[sportType];
  if (exact) {
    return exact;
  }
  if (sportType >= 200 && sportType <= 299) {
    return "bike";
  }
  if (sportType >= 500 && sportType <= 599) {
    return "ski";
  }
  if (sportType >= 700 && sportType <= 799) {
    return "water";
  }
  return "other";
}

// Scheduled workouts carry COROS *program* codes (1–9), not activity codes.
const PROGRAM_SPORT_FAMILY: Record<WorkoutSport, WeekSportFamily> = {
  run: "run",
  trailRun: "trail",
  bike: "bike",
  swim: "swim",
  strength: "strength",
  indoorClimb: "climb",
  bouldering: "climb",
  xcSki: "ski",
  hyrox: "other"
};

/** Planned duration in seconds, read the same way as the workout editor preview. */
export function scheduledPlannedSeconds(entry: TrainingHubScheduledWorkoutEntry): number {
  const program = entry.rawProgram;
  if (!program) {
    return 0;
  }
  for (const key of ["planDuration", "duration", "estimatedTime"]) {
    const value = Number(program[key]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

export interface WeekSportTotals {
  key: string;
  family: WeekSportFamily;
  label: string;
  color: SportColorCategory;
  actualLoad: number;
  plannedLoad: number;
  activityTimeSeconds: number;
  plannedTimeSeconds: number;
  distanceMeters: number;
  plannedDistanceKm: number;
}

const GENERIC_OTHER_KEY = `other:${WEEK_SPORT_FAMILY_META.other.label.toLowerCase()}`;

// Known families group under one row; anything else gets a row per sport name
// so unrecognized activity types (and HYROX plans) still show up by name.
function groupIdentity(
  family: WeekSportFamily,
  otherLabel: string | undefined
): { key: string; label: string } {
  if (family !== "other") {
    return { key: family, label: WEEK_SPORT_FAMILY_META[family].label };
  }
  const label = otherLabel?.trim() || WEEK_SPORT_FAMILY_META.other.label;
  return { key: `other:${label.toLowerCase()}`, label };
}

function activityGroup(activity: TrainingHubActivity) {
  const family = activitySportFamily(activity.sportType);
  return { family, ...groupIdentity(family, resolveSportName(activity)) };
}

/** Family of a scheduled workout, whose sportType is a COROS *program* code (1 = run, 2 = bike…). */
export function scheduledSportFamily(sportType: number | undefined): WeekSportFamily {
  const sport = workoutSportFromType(sportType);
  return sport ? PROGRAM_SPORT_FAMILY[sport] : activitySportFamily(sportType);
}

function scheduledGroup(entry: TrainingHubScheduledWorkoutEntry) {
  const sport = workoutSportFromType(entry.sportType);
  const family = scheduledSportFamily(entry.sportType);
  return {
    family,
    ...groupIdentity(family, sport ? WORKOUT_SPORT_CAPABILITIES[sport].label : undefined)
  };
}

/** Per-sport totals for a calendar week, in display order. */
export function buildWeekSportBreakdown(days: CalendarDay[]): WeekSportTotals[] {
  const groups = new Map<string, WeekSportTotals>();

  const groupFor = (identity: { key: string; label: string; family: WeekSportFamily }) => {
    let group = groups.get(identity.key);
    if (!group) {
      group = {
        ...identity,
        color: WEEK_SPORT_FAMILY_META[identity.family].color,
        actualLoad: 0,
        plannedLoad: 0,
        activityTimeSeconds: 0,
        plannedTimeSeconds: 0,
        distanceMeters: 0,
        plannedDistanceKm: 0
      };
      groups.set(identity.key, group);
    }
    return group;
  };

  for (const day of days) {
    for (const activity of day.activities) {
      const group = groupFor(activityGroup(activity));
      group.actualLoad += activity.trainingLoad ?? 0;
      group.activityTimeSeconds += activityMovingSeconds(activity) ?? 0;
      group.distanceMeters += activity.distance ?? 0;
    }
    for (const entry of day.scheduled) {
      const group = groupFor(scheduledGroup(entry));
      group.plannedLoad += entry.trainingLoad ?? 0;
      group.plannedTimeSeconds += scheduledPlannedSeconds(entry);
      group.plannedDistanceKm += parseUpcomingWorkoutDistanceKm(entry.volume) ?? 0;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      actualLoad: Math.round(group.actualLoad),
      plannedLoad: Math.round(group.plannedLoad)
    }))
    .sort(
      (left, right) =>
        FAMILY_ORDER.indexOf(left.family) - FAMILY_ORDER.indexOf(right.family) ||
        Number(left.key === GENERIC_OTHER_KEY) - Number(right.key === GENERIC_OTHER_KEY) ||
        left.label.localeCompare(right.label)
    );
}
