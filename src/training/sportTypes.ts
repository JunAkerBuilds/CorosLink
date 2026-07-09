import type { TrainingHubSportType } from "../../electron/types";

// Keep in sync with electron/corosSportTypes.ts for renderer-side fallbacks.
const KNOWN_SPORT_NAMES: Record<number, string> = {
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

export function resolveSportName(
  activity: {
    sportType?: number;
    sportName?: string;
  },
  sportTypes: TrainingHubSportType[] | Map<number, string> = []
): string | undefined {
  if (activity.sportName?.trim()) {
    return activity.sportName.trim();
  }

  const sportType = activity.sportType;
  if (sportType === undefined) {
    return undefined;
  }

  const lookup =
    sportTypes instanceof Map
      ? sportTypes
      : new Map(sportTypes.map((item) => [item.sportType, item.sportName]));

  const fromMap = lookup.get(sportType)?.trim();
  if (fromMap) {
    return fromMap;
  }

  return KNOWN_SPORT_NAMES[sportType];
}
