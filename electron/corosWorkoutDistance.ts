import type { UnitSystem, WorkoutSport } from "./types";

/** COROS distance units: 1=km, 2=m, 3=mi, 4=yd. Values remain centimeters. */
export function corosDistanceTargetDisplayUnit(
  meters: number,
  sport: WorkoutSport,
  unitSystem: UnitSystem = "metric",
  preferredUnit?: number
): number {
  const unit = preferredUnit ?? (unitSystem === "imperial"
    ? sport === "swim" ? 4 : 3
    : 2);
  // Avoid the reported COROS iOS 1,000 m cap for land-distance targets
  // (issue #124). Swimming uses its own meter/yard target conventions.
  return sport !== "swim" && unit === 2 && meters > 1000 ? 1 : unit;
}
