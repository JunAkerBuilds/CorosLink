import { t } from "../i18n/trainingLocale";
import type { StrengthSession } from "../../electron/types";
import { formatDurationSeconds } from "../training/formatters";

/** Where a gym session was logged: "Hevy", "Strava", or both. Brand names stay untranslated. */
export function externalWorkoutSource(session: StrengthSession): string {
  const ids = session.sourceIds;
  const hevy = session.source === "hevy" || Boolean(ids?.hevy);
  const strava = session.source === "strava" || Boolean(ids?.strava) || Boolean(session.strava);
  return [hevy && "Hevy", strava && "Strava"].filter(Boolean).join(" · ");
}

export function externalWorkoutName(session: StrengthSession): string {
  return session.name?.trim() || (session.sportName ? t(session.sportName) : t("Strength"));
}

export function externalWorkoutSeconds(session: StrengthSession): number {
  return session.detail.summary.durationSec || session.duration || 0;
}

/** "52:10 · 18 sets", the chip's second line. */
export function externalWorkoutStatsLine(session: StrengthSession): string {
  const seconds = externalWorkoutSeconds(session);
  const sets = session.detail.summary.sets;
  return [
    seconds ? formatDurationSeconds(seconds) : undefined,
    sets > 0 ? t("{{value1}} sets", { value1: String(sets) }) : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}
