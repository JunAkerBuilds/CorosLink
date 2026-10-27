import type { UnitSystem } from "../../electron/types";
import { parsePersistedUnitSystem } from "../../electron/unitSystem";
import * as sharedUnits from "../../electron/unitSystem";
import { formatNumber } from "../i18n/locale";
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
  formatPaceValue,
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

// Keep the shared conversion rules and precision, while using the app's locale
// for display. Machine-readable values and pace clocks never pass through here.
function localizedUnitValue(value: string): string {
  return value.replace(/^(-?\d+)(?:\.(\d+))?(?= )/, (number, _integer, fraction: string | undefined) =>
    formatNumber(Number(number), {
      useGrouping: false,
      minimumFractionDigits: fraction?.length ?? 0,
      maximumFractionDigits: fraction?.length ?? 0,
    }));
}

export function formatDistanceValue(...args: Parameters<typeof sharedUnits.formatDistanceValue>): string {
  return localizedUnitValue(sharedUnits.formatDistanceValue(...args));
}
export function formatElevationValue(...args: Parameters<typeof sharedUnits.formatElevationValue>): string {
  return localizedUnitValue(sharedUnits.formatElevationValue(...args));
}
export function formatSpeedValue(...args: Parameters<typeof sharedUnits.formatSpeedValue>): string {
  return localizedUnitValue(sharedUnits.formatSpeedValue(...args));
}
export function formatWeightValue(...args: Parameters<typeof sharedUnits.formatWeightValue>): string {
  return localizedUnitValue(sharedUnits.formatWeightValue(...args));
}

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
