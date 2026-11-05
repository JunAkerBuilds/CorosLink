import type { RaceDistanceKey, RaceLookupCandidate, RaceLookupEvent, RacePriority, RaceRegistration } from "../../electron/raceTypes";

/** What the race editor holds while the athlete types. */
export interface RaceDraft {
  kind: "result" | "upcoming";
  name: string;
  date: string;
  /** Blank until the athlete or the AI chooses one. */
  distanceKey: RaceDistanceKey | "";
  otherDistance: string;
  time: string;
  placing: string;
  priority: RacePriority | "";
  location: string;
  notes: string;
  registration: RaceRegistration | "";
  registrationDeadline: string;
  bibNumber: string;
  startTime: string;
  wave: string;
  bibPickupLocation: string;
  bibPickupDay: string;
  bibPickupHours: string;
  website: string;
}

/**
 * Fields the AI may fill: public facts about the race. Goal time, priority,
 * entry status, bib and wave belong to the athlete and are never among them.
 */
export const RACE_LOOKUP_FIELDS = [
  "name",
  "date",
  "distanceKey",
  "otherDistance",
  "location",
  "website",
  "registrationDeadline",
  "startTime",
  "bibPickupDay",
  "bibPickupHours",
  "bibPickupLocation",
  "notes"
] as const satisfies readonly (keyof RaceDraft)[];

export type RaceLookupField = (typeof RACE_LOOKUP_FIELDS)[number];

/** A fill the athlete can take back: the values it replaced, by field. */
export interface RaceLookupFill {
  draft: RaceDraft;
  /** Fields holding the AI's value. */
  filled: ReadonlySet<RaceLookupField>;
  /** What each filled field held before, for Undo. */
  previous: Partial<Record<RaceLookupField, string>>;
}

/** The event an athlete is most likely running: the one they already chose, else the AI's best match. */
export function preferredLookupEvent(
  events: readonly RaceLookupEvent[],
  draft: Pick<RaceDraft, "distanceKey">,
  filled: ReadonlySet<RaceLookupField>
): RaceLookupEvent | undefined {
  const chosen = draft.distanceKey && !filled.has("distanceKey")
    ? events.find((event) => event.distanceKey === draft.distanceKey)
    : undefined;
  return chosen ?? events[0];
}

/**
 * Puts a found race in the form. The name, date and distance follow the race
 * the athlete picked. Everything else only fills a blank or replaces an
 * earlier AI value, so what the athlete typed stays.
 */
export function applyRaceLookup(
  draft: RaceDraft,
  candidate: RaceLookupCandidate,
  event: RaceLookupEvent | undefined,
  filled: ReadonlySet<RaceLookupField>,
  otherDistanceText: (meters: number) => string
): RaceLookupFill {
  const next: RaceDraft = { ...draft };
  const nextFilled = new Set(filled);
  const previous: Partial<Record<RaceLookupField, string>> = {};

  const set = (field: RaceLookupField, value: string | undefined, always = false) => {
    if (!value) {
      // This race doesn't have it, so an earlier race's value must not linger as if it did.
      if (filled.has(field) && next[field]) {
        previous[field] = next[field];
        (next as unknown as Record<RaceLookupField, string>)[field] = "";
        nextFilled.delete(field);
      }
      return;
    }
    if (next[field] === value) return;
    if (!always && next[field].trim() && !filled.has(field)) return;
    previous[field] = next[field];
    (next as unknown as Record<RaceLookupField, string>)[field] = value;
    nextFilled.add(field);
  };

  set("name", candidate.name, true);
  set("date", candidate.raceDay, true);
  set("distanceKey", event?.distanceKey, true);
  set("otherDistance", event?.distanceKey === "other" ? otherDistanceText(event.distance) : undefined, true);
  set("startTime", event?.startTime);
  set("location", candidate.location);
  set("website", candidate.website);
  set("registrationDeadline", candidate.registrationDeadline);
  set("bibPickupDay", candidate.bibPickupDay);
  set("bibPickupHours", candidate.bibPickupHours);
  set("bibPickupLocation", candidate.bibPickupLocation);
  set("notes", candidate.courseNotes);

  return { draft: next, filled: nextFilled, previous };
}

/** Takes a fill back, leaving alone any field the athlete has edited since. */
export function undoRaceLookup(
  draft: RaceDraft,
  filled: ReadonlySet<RaceLookupField>,
  previous: Partial<Record<RaceLookupField, string>>
): { draft: RaceDraft; filled: ReadonlySet<RaceLookupField> } {
  const next: RaceDraft = { ...draft };
  const nextFilled = new Set(filled);
  for (const field of Object.keys(previous) as RaceLookupField[]) {
    if (!filled.has(field)) continue;
    (next as unknown as Record<RaceLookupField, string>)[field] = previous[field] ?? "";
    nextFilled.delete(field);
  }
  return { draft: next, filled: nextFilled };
}
