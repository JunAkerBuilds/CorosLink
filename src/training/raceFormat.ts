import { t, getDateTimeFormat } from "../i18n/trainingLocale";
import type { RaceEntry } from "../../electron/raceTypes";
import type { UnitSystem } from "../../electron/types";
import { raceDistanceLabel } from "../../electron/raceModel";
import { formatDistanceValue } from "../units/units";

/** The race service keeps its reason strings independent of the UI language. */
export function formatRaceSuggestionReason(reason: string): string {
  const speedup = /^(\d+)% quicker than your usual pace$/.exec(reason);
  return speedup
    ? t("{{percent}}% quicker than your usual pace", { percent: speedup[1] })
    : t(reason);
}

/** "22:11" or "1:40:15"; tenths only when a chip time carries them. */
export function formatRaceTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const tenths = Math.round(seconds * 10) % 10;
  const whole = Math.floor(Math.round(seconds * 10) / 10);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
  return tenths ? `${clock}.${tenths}` : clock;
}

/** Signed gap between two results; "−0:06" is faster. Uses a true minus sign. */
export function formatRaceDelta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  const rounded = Math.round(Math.abs(seconds));
  if (rounded === 0) return "±0:00";
  return `${seconds < 0 ? "−" : "+"}${formatRaceTime(rounded)}`;
}

/**
 * Read a finish time typed as "22:11", "1:40:15", "22:11.4" or a bare number
 * of minutes ("45"). Returns seconds, or undefined when it is not a time.
 */
export function parseRaceTime(text: string): number | undefined {
  const value = text.trim().replace(/\s+/g, "");
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const minutes = Number(value);
    return minutes > 0 ? minutes * 60 : undefined;
  }
  const match = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!match) return undefined;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (seconds >= 60 || (match[1] !== undefined && minutes >= 60)) return undefined;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? Math.round(total * 10) / 10 : undefined;
}

/** "5K", "Half Marathon", or the measured length for an "other" race. */
export function formatRaceDistance(
  race: Pick<RaceEntry, "distanceKey" | "officialDistance">,
  unitSystem: UnitSystem
): string {
  return race.distanceKey === "other"
    ? formatDistanceValue(race.officialDistance, unitSystem)
    : t(raceDistanceLabel(race.distanceKey));
}

/** Epoch seconds → "Jul 1, 2026". */
export function formatRaceDate(epochSeconds: number): string {
  return getDateTimeFormat({
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(epochSeconds * 1000));
}

/** Epoch seconds → the `YYYY-MM-DD` a date input expects, in local time. */
export function toDateInputValue(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A date input's `YYYY-MM-DD` → local 9 AM epoch seconds, a typical start. */
export function fromDateInputValue(value: string): number | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : Math.floor(date.getTime() / 1000);
}
