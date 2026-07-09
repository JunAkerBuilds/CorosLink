import type { TrainingHubActivity, TrainingHubSportType } from "./types";

// Stable COROS activity sportType codes. API names take precedence when available.
export const COROS_KNOWN_SPORT_TYPES: Readonly<Record<number, string>> = {
  100: "Run",
  101: "Indoor Run",
  102: "Trail Run",
  103: "Track Run",
  104: "Treadmill Run",
  200: "Road Bike",
  201: "Indoor Bike",
  202: "E-Bike",
  203: "Gravel Bike",
  204: "Mountain Bike",
  300: "Pool Swim",
  301: "Open Water Swim",
  400: "Triathlon",
  402: "Strength",
  403: "Cardio",
  500: "Ski",
  501: "Snowboard",
  600: "Rowing",
  700: "Hiking",
  800: "Climbing",
  900: "Walk",
  901: "Indoor Walk",
  65535: "All Sports"
};

export function corosSportName(
  sportType: number,
  explicitName?: string | null,
  lookup?: ReadonlyMap<number, string> | Readonly<Record<number, string>>
): string | undefined {
  const trimmed = explicitName?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (lookup) {
    const fromLookup =
      lookup instanceof Map
        ? lookup.get(sportType)
        : (lookup as Readonly<Record<number, string>>)[sportType];
    if (fromLookup?.trim()) {
      return fromLookup.trim();
    }
  }

  return COROS_KNOWN_SPORT_TYPES[sportType];
}

export function mergeSportTypeEntries(
  ...sources: TrainingHubSportType[][]
): TrainingHubSportType[] {
  const merged = new Map<number, string>();

  for (const [sportType, sportName] of Object.entries(COROS_KNOWN_SPORT_TYPES)) {
    merged.set(Number(sportType), sportName);
  }

  for (const source of sources) {
    for (const item of source) {
      if (item.sportType > 0 && item.sportName.trim()) {
        merged.set(item.sportType, item.sportName.trim());
      }
    }
  }

  return Array.from(merged.entries(), ([sportType, sportName]) => ({
    sportType,
    sportName
  })).sort((left, right) => left.sportType - right.sportType);
}

export function enrichActivitiesWithSportNames(
  activities: TrainingHubActivity[],
  lookup?: ReadonlyMap<number, string>
): TrainingHubActivity[] {
  return activities.map((activity) => {
    const sportName = corosSportName(
      activity.sportType,
      activity.sportName,
      lookup
    );

    if (!sportName || sportName === activity.sportName) {
      return activity;
    }

    return {
      ...activity,
      sportName
    };
  });
}
