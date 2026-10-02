import {
  calendarHash as hash,
  isoCalendarDay,
  workoutCalendarData,
} from "./calendarSyncUtils";
export {
  calendarSyncRange,
  isoCalendarDay,
  shiftCalendarDay,
} from "./calendarSyncUtils";
import type { TrainingHubScheduledWorkoutEntry } from "./types";
import type { GoogleCalendarSyncResult } from "./googleCalendarTypes";
import type { CalendarEventTiming } from "./calendarSyncTypes";
import { calendarWallTime, reconcileCalendarTiming } from "./calendarEventTiming";

export interface GoogleWorkoutEvent {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type CalendarRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export const calendarPath = (calendarId: string) =>
  `/calendars/${encodeURIComponent(calendarId)}/events`;
export function workoutGoogleEvent(
  userId: string,
  workout: TrainingHubScheduledWorkoutEntry,
  settings?: CalendarEventTiming,
): GoogleWorkoutEvent {
  const data = workoutCalendarData(userId, workout, settings);
  return {
    id: `cl${data.key}`,
    summary: data.summary,
    description: data.description,
    start: data.startTime ? { dateTime: data.startTime } : { date: isoCalendarDay(data.day) },
    end: data.endTime ? { dateTime: data.endTime } : { date: isoCalendarDay(data.endDay) },
    extendedProperties: {
      private: {
        corosLinkSource: data.source,
        corosLinkKey: data.key,
        corosLinkDay: data.day,
        ...(data.timingKey ? {
          corosLinkTiming: data.timingKey,
        } : {}),
      },
    },
  };
}

function googleEventTime(value: GoogleWorkoutEvent["start"]): string | undefined {
  if (!value?.dateTime) return undefined;
  const text = value.dateTime;
  const instant = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? Date.parse(text)
    : value.timeZone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
      ? calendarWallTime(text.slice(0, 10), text.slice(11), value.timeZone) : NaN;
  return Number.isFinite(instant) ? new Date(instant).toISOString() : undefined;
}

function keepCalendarTime(remote: GoogleWorkoutEvent, desired: GoogleWorkoutEvent): GoogleWorkoutEvent {
  const timing = (event: GoogleWorkoutEvent) => ({
    startTime: googleEventTime(event.start), endTime: googleEventTime(event.end),
    timingKey: event.extendedProperties?.private?.corosLinkTiming,
  });
  const resolved = reconcileCalendarTiming(timing(remote), timing(desired));
  return resolved.startTime ? { ...desired, start: { dateTime: resolved.startTime }, end: { dateTime: resolved.endTime } } : desired;
}

const sameDate = (a: GoogleWorkoutEvent["start"], b: GoogleWorkoutEvent["start"]) =>
  b?.dateTime ? Boolean(googleEventTime(a)) && googleEventTime(a) === googleEventTime(b)
    : a?.date === b?.date && !a?.dateTime;

function matches(
  remote: GoogleWorkoutEvent,
  desired: GoogleWorkoutEvent,
): boolean {
  return (
    remote.summary === desired.summary &&
    remote.description === desired.description &&
    sameDate(remote.start, desired.start) &&
    sameDate(remote.end, desired.end) &&
    (remote.extendedProperties?.private?.corosLinkTiming || undefined) === desired.extendedProperties?.private?.corosLinkTiming &&
    remote.extendedProperties?.private?.corosLinkDay ===
      desired.extendedProperties?.private?.corosLinkDay
  );
}

/** Reconcile only app-owned events; fetch and validate the whole source before any writes. */
export async function syncWorkoutEvents(input: {
  userId: string;
  calendarId: string;
  startDay: string;
  endDay: string;
  workouts: TrainingHubScheduledWorkoutEntry[];
  eventTiming?: CalendarEventTiming;
  request: CalendarRequest;
}): Promise<GoogleCalendarSyncResult> {
  const { userId, calendarId, startDay, endDay, workouts, request } = input;
  const desired = new Map<string, GoogleWorkoutEvent>();
  for (const workout of workouts) {
    const event = workoutGoogleEvent(userId, workout, input.eventTiming);
    if (workout.happenDay >= startDay && workout.happenDay <= endDay)
      desired.set(event.id, event);
  }
  const source = hash(userId);
  const base = calendarPath(calendarId);
  const existing = new Map<string, GoogleWorkoutEvent>();
  const seenPages = new Set<string>();
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `corosLinkSource=${source}`,
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await request<{
      items?: GoogleWorkoutEvent[];
      nextPageToken?: string;
    }>(`${base}?${params}`);
    if (page.items !== undefined && !Array.isArray(page.items))
      throw new Error("Google returned an invalid calendar response.");
    for (const event of page.items ?? []) {
      if (
        event.status !== "cancelled" &&
        event.extendedProperties?.private?.corosLinkSource === source &&
        event.extendedProperties.private.corosLinkKey &&
        event.id === `cl${event.extendedProperties.private.corosLinkKey}`
      ) {
        existing.set(event.id, event);
      }
    }
    pageToken = page.nextPageToken ?? "";
    if (pageToken && seenPages.has(pageToken))
      throw new Error("Google repeated a calendar page. Try syncing again.");
    seenPages.add(pageToken);
  } while (pageToken);

  const result = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
  for (const event of desired.values()) {
    let remote = existing.get(event.id);
    if (!remote) {
      try {
        await request(base, "POST", { ...event, transparency: "transparent" });
        result.created++;
        continue;
      } catch (error) {
        if (!(error instanceof GoogleCalendarApiError) || error.status !== 409)
          throw error;
        // An earlier insert may have succeeded before its response was lost.
        remote = await request<GoogleWorkoutEvent>(`${base}/${event.id}`);
        if (
          remote.extendedProperties?.private?.corosLinkSource !== source ||
          remote.extendedProperties?.private?.corosLinkKey !==
            event.extendedProperties?.private?.corosLinkKey
        ) {
          throw new Error(
            "A Google event conflicts with this workout. Sync stopped without changing that event.",
          );
        }
      }
    }
    const resolved = remote.status === "cancelled" ? event : keepCalendarTime(remote, event);
    if (matches(remote, resolved) && remote.status !== "cancelled")
      result.unchanged++;
    else {
      await request(`${base}/${encodeURIComponent(remote.id)}`, "PATCH", {
        summary: event.summary,
        description: event.description,
        status: "confirmed",
        start: { date: null, dateTime: null, timeZone: null, ...resolved.start },
        end: { date: null, dateTime: null, timeZone: null, ...resolved.end },
        extendedProperties: { private: {
          ...remote.extendedProperties?.private,
          corosLinkTiming: null, corosLinkDuration: null,
          ...event.extendedProperties?.private,
        } },
      });
      result.updated++;
    }
  }

  // Preserve past history and unrelated events, including other COROS accounts.
  // Removal runs only after every source read and upsert has succeeded.
  for (const remote of existing.values()) {
    const day = remote.extendedProperties!.private!.corosLinkDay;
    if (!day || day < startDay || day > endDay || desired.has(remote.id))
      continue;
    try {
      await request(`${base}/${encodeURIComponent(remote.id)}`, "DELETE");
    } catch (error) {
      if (
        !(error instanceof GoogleCalendarApiError) ||
        ![404, 410].includes(error.status)
      )
        throw error;
    }
    result.deleted++;
  }
  return result;
}
