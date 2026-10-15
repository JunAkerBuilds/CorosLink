import {
  formatWorkoutSport as sourceWorkoutSport,
  formatIntensityType as sourceIntensityType
} from "../../electron/workoutCapabilities";
import { t } from "../i18n/trainingLocale";

// Translate presentation labels at read time; protocol values and capabilities stay stable.
export function formatWorkoutSport(...args: Parameters<typeof sourceWorkoutSport>): string {
  return t(sourceWorkoutSport(...args));
}

export function formatIntensityType(...args: Parameters<typeof sourceIntensityType>): string {
  return t(sourceIntensityType(...args));
}
