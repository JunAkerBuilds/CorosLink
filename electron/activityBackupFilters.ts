import type {
  ActivityBackupFilters,
  ActivityBackupPreview,
  TrainingHubActivity
} from "./types";

/**
 * Sport families offered by the backup filter. Codes come from
 * COROS_KNOWN_SPORT_TYPES; "other" catches every code not listed here so a
 * family filter can never silently drop a new or unknown sport.
 */
export const ACTIVITY_BACKUP_SPORT_GROUPS = [
  { id: "run", label: "Run", sportTypes: [100, 101, 102, 103] },
  { id: "bike", label: "Bike", sportTypes: [200, 201, 202, 203, 204, 205, 299] },
  { id: "swim", label: "Swim", sportTypes: [300, 301] },
  { id: "hike", label: "Hike & walk", sportTypes: [104, 105, 900] },
  { id: "strength", label: "Strength & gym", sportTypes: [400, 401, 402, 901, 902] },
  { id: "snow", label: "Snow", sportTypes: [500, 501, 502, 503, 10002] },
  { id: "water", label: "Water", sportTypes: [700, 701, 702, 704, 705, 706] },
  { id: "climb", label: "Climb", sportTypes: [106, 800, 801, 10003] },
  { id: "multisport", label: "Multisport", sportTypes: [10000, 10001] },
  { id: "other", label: "Other", sportTypes: [] }
] as const satisfies readonly {
  id: string;
  label: string;
  sportTypes: readonly number[];
}[];

export type ActivityBackupSportGroupId =
  (typeof ACTIVITY_BACKUP_SPORT_GROUPS)[number]["id"];

const GROUP_BY_SPORT_TYPE = new Map<number, ActivityBackupSportGroupId>(
  ACTIVITY_BACKUP_SPORT_GROUPS.flatMap((group) =>
    group.sportTypes.map((sportType) => [sportType, group.id] as const)
  )
);

export function activityBackupSportGroup(
  sportType: number
): ActivityBackupSportGroupId {
  return GROUP_BY_SPORT_TYPE.get(sportType) ?? "other";
}

/** "2026-06-14" → "20260614", the day format /activity/query expects. */
export function isoDayToHappenDay(isoDay: string): string {
  return isoDay.replace(/-/g, "");
}

/** Local calendar day of an activity start (seconds or milliseconds). */
function activityIsoDay(startTime?: number): string | undefined {
  if (!startTime || !Number.isFinite(startTime) || startTime <= 0) {
    return undefined;
  }
  const ms = startTime < 10_000_000_000 ? startTime * 1000 : startTime;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inRange(value: number | undefined, min?: number, max?: number): boolean {
  // A missing metric counts as zero: a strength session has no distance, so
  // it passes "under 5 km" and fails "over 5 km".
  const measured = value !== undefined && Number.isFinite(value) ? value : 0;
  return (min === undefined || measured >= min) && (max === undefined || measured <= max);
}

export function hasActiveBackupFilters(filters?: ActivityBackupFilters): boolean {
  if (!filters) {
    return false;
  }
  return Boolean(
    filters.sportGroups?.length ||
      filters.startDay ||
      filters.endDay ||
      filters.minDistanceMeters !== undefined ||
      filters.maxDistanceMeters !== undefined ||
      filters.minDurationSeconds !== undefined ||
      filters.maxDurationSeconds !== undefined
  );
}

export function activityMatchesBackupFilters(
  activity: TrainingHubActivity,
  filters?: ActivityBackupFilters
): boolean {
  if (!filters) {
    return true;
  }

  if (
    filters.sportGroups?.length &&
    !filters.sportGroups.includes(activityBackupSportGroup(activity.sportType))
  ) {
    return false;
  }

  if (filters.startDay || filters.endDay) {
    const day = activityIsoDay(activity.startTime);
    if (!day) {
      return false;
    }
    if (filters.startDay && day < filters.startDay) {
      return false;
    }
    if (filters.endDay && day > filters.endDay) {
      return false;
    }
  }

  return (
    inRange(activity.distance, filters.minDistanceMeters, filters.maxDistanceMeters) &&
    inRange(activity.duration, filters.minDurationSeconds, filters.maxDurationSeconds)
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_GROUP_IDS = new Set<string>(
  ACTIVITY_BACKUP_SPORT_GROUPS.map((group) => group.id)
);

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Drops malformed fields from renderer-supplied filters. */
export function normalizeActivityBackupFilters(
  raw: unknown
): ActivityBackupFilters | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const sportGroups = Array.isArray(input.sportGroups)
    ? input.sportGroups.filter(
        (id): id is string => typeof id === "string" && KNOWN_GROUP_IDS.has(id)
      )
    : [];
  const day = (value: unknown) =>
    typeof value === "string" && ISO_DAY.test(value) ? value : undefined;

  const filters: ActivityBackupFilters = {
    sportGroups: sportGroups.length ? sportGroups : undefined,
    startDay: day(input.startDay),
    endDay: day(input.endDay),
    minDistanceMeters: nonNegative(input.minDistanceMeters),
    maxDistanceMeters: nonNegative(input.maxDistanceMeters),
    minDurationSeconds: nonNegative(input.minDurationSeconds),
    maxDurationSeconds: nonNegative(input.maxDurationSeconds)
  };
  return hasActiveBackupFilters(filters) ? filters : undefined;
}

/**
 * Match totals for a filter set. Per-family counts ignore the family filter
 * itself, so each chip shows what selecting it would add.
 */
export function summarizeActivityBackup(
  activities: readonly TrainingHubActivity[],
  filters?: ActivityBackupFilters
): ActivityBackupPreview {
  const withoutSport: ActivityBackupFilters = { ...filters, sportGroups: undefined };
  const groupCounts: Record<string, number> = {};
  let matched = 0;
  let distanceMeters = 0;
  let durationSeconds = 0;

  for (const activity of activities) {
    if (!activityMatchesBackupFilters(activity, withoutSport)) {
      continue;
    }
    const group = activityBackupSportGroup(activity.sportType);
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
    if (filters?.sportGroups?.length && !filters.sportGroups.includes(group)) {
      continue;
    }
    matched += 1;
    distanceMeters += activity.distance && activity.distance > 0 ? activity.distance : 0;
    durationSeconds += activity.duration && activity.duration > 0 ? activity.duration : 0;
  }

  return {
    total: activities.length,
    matched,
    distanceMeters,
    durationSeconds,
    groupCounts
  };
}
