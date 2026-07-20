import type { TrainingHubSportType } from "../../electron/types";

// Keep in sync with electron/corosSportTypes.ts for renderer-side fallbacks.
const KNOWN_SPORT_NAMES: Record<number, string> = {
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
