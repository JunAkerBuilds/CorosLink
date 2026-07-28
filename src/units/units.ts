import type { UnitSystem } from "../../electron/types";
import { parsePersistedUnitSystem } from "../../electron/unitSystem";
export { parsePersistedUnitSystem };
export {
  FEET_PER_METER,
  METERS_PER_MILE,
  METERS_PER_YARD,
  POUNDS_PER_KILOGRAM,
  displayDistanceToMeters,
  displayPaceToSecondsPerKm,
  displaySpeedToKmh,
  displayWeightToKilograms,
  distanceUnit,
  elevationToMeters,
  elevationUnit,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue,
  formatWeightValue,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  metersToSwimDistance,
  normalizeUnitSystem,
  secondsPerKmToDisplayPace,
  speedUnit,
  swimDistanceToMeters,
  swimDistanceUnit,
  weightUnit
} from "../../electron/unitSystem";
export type { UnitSystem } from "../../electron/types";

export const UNIT_SYSTEM_STORAGE_KEY = "coroslink.unitSystem";

export function readStoredUnitSystem(): UnitSystem {
  try {
    return parsePersistedUnitSystem(
      window.localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY)
    );
  } catch {
    return "metric";
  }
}

export function storeUnitSystem(unitSystem: UnitSystem): void {
  try {
    window.localStorage.setItem(UNIT_SYSTEM_STORAGE_KEY, unitSystem);
  } catch {
    // localStorage can be unavailable in restricted renderer environments.
  }
}
