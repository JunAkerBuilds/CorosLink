import { defaultCalendarEventTiming, type CalendarEventTiming } from "./calendarSyncTypes";

export function validateCalendarEventTiming(input?: CalendarEventTiming | Omit<CalendarEventTiming, "endTime"> & { fallbackDurationMinutes: number }): CalendarEventTiming {
  if (input === undefined) return defaultCalendarEventTiming();
  // Migrate saved duration preferences to an explicit end time.
  let endTime = input && "endTime" in input ? input.endTime : undefined;
  if (input && endTime === undefined && "fallbackDurationMinutes" in input &&
      Number.isInteger(input.fallbackDurationMinutes) && input.fallbackDurationMinutes >= 1 &&
      input.fallbackDurationMinutes <= 1440 && typeof input.startTime === "string") {
    const [hours, minutes] = input.startTime.split(":").map(Number);
    const end = (hours * 60 + minutes + input.fallbackDurationMinutes) % 1440;
    endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  }
  if (!input || !["all-day", "timed"].includes(input.mode) ||
      typeof input.startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ||
      typeof endTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      typeof input.timeZone !== "string" || !input.timeZone || input.timeZone.length > 100 ||
      !endTime) {
    throw new Error("Choose an event type, valid start time and end time, and time zone.");
  }
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }); }
  catch { throw new Error("Choose a valid time zone, such as America/Toronto."); }
  return {
    mode: input.mode, startTime: input.startTime, endTime, timeZone: input.timeZone,
  };
}

/** Convert a wall time using the zone's offset on that date, not today's offset.
 * Ambiguous times use the first occurrence; missing times advance across the DST gap. */
export function calendarWallTime(day: string, time: string, timeZone: string): number {
  const wall = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const local = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  const offsets = new Set([-86400000, 0, 86400000].map(delta => local(wall + delta) - (wall + delta)));
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  const exact = candidates.find(instant => local(instant) === wall);
  const result = exact ?? candidates.filter(instant => local(instant) > wall)
    .sort((a, b) => local(a) - local(b))[0];
  if (!Number.isFinite(result)) throw new Error("Unable to determine the workout start time.");
  return result;
}

export interface CalendarTimedEvent {
  startTime?: string;
  endTime?: string;
  timingKey?: string;
}

/** Retain the user's calendar times until the source day or timing defaults change. */
export function reconcileCalendarTiming(remote: CalendarTimedEvent, desired: CalendarTimedEvent): CalendarTimedEvent {
  if (!desired.startTime || !desired.timingKey || remote.timingKey !== desired.timingKey ||
      !remote.startTime || !remote.endTime) return desired;
  const start = Date.parse(remote.startTime), end = Date.parse(remote.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return desired;
  return {
    ...desired,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
  };
}
