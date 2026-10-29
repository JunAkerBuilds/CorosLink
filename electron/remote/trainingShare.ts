// What a paired phone reads from this computer's training data, beside
// planned steps (scheduledSteps.ts): the athlete's COROS activity notes
// (`training.activityNotes`), their COROS gear with its distances
// (`training.gear`), their races and target races (`training.races`), and a
// race recording's course (`training.raceRoute`). Every one is read-only.
//
// Activities are keyed by COROS's own activity ID (`labelId`), the same one
// the phone gets from COROS, so it can put each note on its own copy.

import type { CorosGear, CorosGearCatalog } from "../types";
import type { RaceEntry, RaceOverview, RaceTarget } from "../raceTypes";

/** The longest range one `training.activityNotes` call reads. */
export const ACTIVITY_NOTES_MAX_DAYS = 366;

export interface ActivityNoteSource {
  activityId: string;
  sportType: number;
  /** Epoch seconds. */
  startTime: number;
  note: string;
}

export interface ActivityNoteRow extends ActivityNoteSource {
  /** YYYY-MM-DD in this computer's time zone, as C-LINK's calendar days are written. */
  day: string;
}

export interface RemoteRaces {
  races: RaceEntry[];
  /** Races the athlete is training for, soonest first. */
  targets: RaceTarget[];
}

/**
 * `startDay`/`endDay` (YYYYMMDD, inclusive) as local epoch seconds
 * [since, until), or null when the range is malformed or too long.
 */
export function activityNotesRange(params: Record<string, unknown>): { since: number; until: number } | null {
  const { startDay, endDay } = params;
  if (typeof startDay !== "string" || typeof endDay !== "string" || !/^\d{8}$/.test(startDay) || !/^\d{8}$/.test(endDay)) return null;
  const local = (day: string, offset = 0) =>
    new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + offset);
  const start = local(startDay);
  const end = local(endDay, 1);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 1 || days > ACTIVITY_NOTES_MAX_DAYS) return null;
  return { since: Math.floor(start.getTime() / 1000), until: Math.floor(end.getTime() / 1000) };
}

function dayOf(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function activityNoteRows(notes: readonly ActivityNoteSource[]): ActivityNoteRow[] {
  return notes.map((note) => ({ ...note, day: dayOf(note.startTime) }));
}

/** COROS keeps each item's distance up to date as activities are added, edited or deleted; it's passed on as is. */
export function remoteGear(catalog: CorosGearCatalog): { gear: CorosGear[] } {
  return { gear: catalog.gear };
}

/** Races and targets; suggestions stay on the computer, where they're confirmed. */
export function remoteRaces(overview: RaceOverview): RemoteRaces {
  return { races: overview.races, targets: overview.targets ?? [] };
}
