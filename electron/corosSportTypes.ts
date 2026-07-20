import type { TrainingHubActivity, TrainingHubSportType } from "./types";

// Stable COROS activity sportType codes. API names take precedence when available.
// Verified against the COROS training hub API (see xballoy/coros-api sport-type.ts).
export const COROS_KNOWN_SPORT_TYPES: Readonly<Record<number, string>> = {
  98: "Custom Sport",
  100: "Run",
  101: "Indoor Run",
  102: "Trail Run",
  103: "Track Run",
  104: "Hike",
  105: "Mountain Climb",
  106: "Climb",
  200: "Bike",
  201: "Indoor Bike",
  202: "Road E-Bike",
  203: "Gravel Road Bike",
  204: "Mountain Bike",
  205: "Mountain E-Bike",
  299: "Helmet Bike",
  300: "Pool Swim",
  301: "Open Water Swim",
  400: "Gym Cardio",
  401: "GPS Cardio",
  402: "Strength",
  500: "Ski",
  501: "Snowboard",
  502: "XC Ski",
  503: "Ski Touring",
  700: "Rowing",
  701: "Indoor Rowing",
  702: "Whitewater",
  704: "Flatwater",
  705: "Windsurfing",
  706: "Speedsurfing",
  800: "Indoor Climb",
  801: "Bouldering",
  900: "Walk",
  901: "Jump Rope",
  902: "Climb Stairs",
  10000: "Triathlon",
  10001: "Multi Sport",
  10002: "Ski Touring",
  10003: "Multi-Pitch Climb",
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
