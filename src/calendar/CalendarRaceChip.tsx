import { t, useLanguage } from "../i18n/training";
import { CalendarClock, Flag, Ticket, type LucideIcon } from "lucide-react";
import { raceDistanceLabel } from "../../electron/raceModel";
import type { RaceTarget } from "../../electron/raceTypes";
import type { UnitSystem } from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue } from "../units/units";
import { formatRaceStartTime } from "../training/raceFormat";
import type { CalendarRaceEvent } from "./calendarTypes";
import "./calendarRaces.css";

const EVENT_ICONS: Record<CalendarRaceEvent["kind"], LucideIcon> = {
  race: Flag,
  pickup: Ticket,
  deadline: CalendarClock
};

function raceDistance(race: RaceTarget, unitSystem: UnitSystem): string {
  return race.distanceKey === "other" ? formatDistanceValue(race.distance, unitSystem) : t(raceDistanceLabel(race.distanceKey));
}

/** What a race date says on the calendar: the race itself, or what is due before it. */
function raceEventCopy(event: CalendarRaceEvent, unitSystem: UnitSystem): { title: string; meta: string; time?: string } {
  const { race } = event;
  if (event.kind === "pickup") {
    return {
      title: t("Bib pickup"),
      meta: [race.name, race.bibPickupLocation].filter(Boolean).join(" · "),
      time: race.bibPickupHours
    };
  }
  if (event.kind === "deadline") {
    return { title: t("Registration closes"), meta: race.name };
  }
  return {
    title: race.name,
    meta: [raceDistance(race, unitSystem), race.bibNumber ? t("Bib {{p0}}", { p0: race.bibNumber }) : undefined, race.wave]
      .filter(Boolean)
      .join(" · "),
    time: race.startTime ? formatRaceStartTime(race.startTime) : undefined
  };
}

function eventLabel(event: CalendarRaceEvent, copy: { title: string; meta: string; time?: string }): string {
  return [copy.title, copy.meta, copy.time].filter(Boolean).join(" · ");
}

/** A race, bib pickup or entry deadline in a month/week day cell. */
export function CalendarRaceChip({
  event,
  disabled,
  onOpen
}: {
  event: CalendarRaceEvent;
  disabled: boolean;
  onOpen: (race: RaceTarget) => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const copy = raceEventCopy(event, unitSystem);
  const Icon = EVENT_ICONS[event.kind];
  return (
    <button
      type="button"
      className={`calendar-chip calendar-chip-race is-${event.kind}`}
      disabled={disabled}
      title={eventLabel(event, copy)}
      onClick={() => onOpen(event.race)}
    >
      <span className="calendar-chip-title">
        <Icon size={12} strokeWidth={2.3} aria-hidden="true" />
        <span className="calendar-chip-name">{copy.title}</span>
      </span>
      {copy.meta ? <span className="calendar-chip-meta">{copy.meta}</span> : null}
      {copy.time ? <span className="calendar-chip-meta">{copy.time}</span> : null}
    </button>
  );
}

/** The same date as an agenda row. */
export function CalendarRaceAgendaEntry({
  event,
  disabled,
  onOpen
}: {
  event: CalendarRaceEvent;
  disabled: boolean;
  onOpen: (race: RaceTarget) => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const copy = raceEventCopy(event, unitSystem);
  const Icon = EVENT_ICONS[event.kind];
  const status = event.kind === "race"
    ? event.race.registration === "registered" ? t("Registered") : t("Race day")
    : event.kind === "pickup" ? t("Pickup") : t("Deadline");
  return (
    <button
      type="button"
      className={`calendar-agenda-entry calendar-agenda-race is-${event.kind}`}
      disabled={disabled}
      title={eventLabel(event, copy)}
      onClick={() => onOpen(event.race)}
    >
      <span className="calendar-agenda-glyph" aria-hidden="true">
        <Icon size={16} strokeWidth={2.1} />
      </span>
      <span className="calendar-agenda-main">
        <span className="calendar-agenda-title">
          <span className="calendar-agenda-name">{copy.title}</span>
        </span>
        {copy.meta ? <span className="calendar-agenda-meta">{copy.meta}</span> : null}
      </span>
      <span className="calendar-agenda-aside">
        <span className="calendar-agenda-status calendar-agenda-race-status">{status}</span>
        {copy.time ? <span className="calendar-agenda-time">{copy.time}</span> : null}
      </span>
    </button>
  );
}
