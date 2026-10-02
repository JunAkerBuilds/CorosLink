import type { TrainingHubScheduledWorkoutEntry } from "./types";
import type { CalendarEventTiming, CalendarSyncResult } from "./calendarSyncTypes";
import { calendarWallTime, reconcileCalendarTiming } from "./calendarEventTiming";
import {
  calendarHash,
  isoCalendarDay,
  workoutCalendarData,
} from "./calendarSyncUtils";
import {
  calendarResourceUrl,
  ICloudCalendarError,
  type ICloudCalDav,
  type ICloudCalendarEvent,
} from "./iCloudCalDav";

export type AppleWorkoutEvent = ReturnType<typeof workoutCalendarData> & {
  uid: string;
  sequence: number;
  actualStart?: string;
  cancelled?: boolean;
};
export const appleWorkoutUid = (source: string, key: string): string =>
  `coroslink-${source}-${key}@coroslink`;
export const appleWorkoutHref = (calendarId: string, key: string): string =>
  calendarResourceUrl(`coroslink-${key}.ics`, calendarId).href;

const escapeText = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
const unescapeText = (value: string): string =>
  value.replace(/\\([nN,;\\])/g, (_, char: string) =>
    /[nN]/.test(char) ? "\n" : char,
  );

/** RFC 5545 lines are limited to 75 UTF-8 octets, without splitting a code point. */
export function foldCalendarLine(line: string): string {
  let output = "",
    size = 0;
  for (const char of line) {
    const length = Buffer.byteLength(char, "utf8");
    if (size + length > 75) {
      output += "\r\n ";
      size = 1;
    }
    output += char;
    size += length;
  }
  return output;
}

export function serializeAppleWorkout(
  event: AppleWorkoutEvent,
  now = new Date(),
  previousData?: string,
): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const utc = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CorosLink//Workout Sync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${timestamp}`,
    `LAST-MODIFIED:${timestamp}`,
    `SEQUENCE:${event.sequence}`,
    ...(event.startTime && event.endTime ? [
      `DTSTART:${utc(event.startTime)}`, `DTEND:${utc(event.endTime)}`,
    ] : [`DTSTART;VALUE=DATE:${event.day}`, `DTEND;VALUE=DATE:${event.endDay}`]),
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    `X-COROSLINK-SOURCE:${event.source}`,
    `X-COROSLINK-KEY:${event.key}`,
    `X-COROSLINK-DAY:${event.day}`,
    ...(event.timingKey ? [
      `X-COROSLINK-TIMING:${event.timingKey}`,
    ] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  if (!previousData) return lines.map(foldCalendarLine).join("\r\n");
  // A DAV PUT replaces the whole resource. Keep user alarms, location, notes
  // on other properties, and timezone definitions when updating our fields.
  const owned = new Set(["DTSTAMP", "LAST-MODIFIED", "SEQUENCE", "DTSTART", "DTEND", "DURATION",
    "SUMMARY", "DESCRIPTION", "STATUS", "X-COROSLINK-SOURCE", "X-COROSLINK-KEY",
    "X-COROSLINK-DAY", "X-COROSLINK-TIMING", "X-COROSLINK-DURATION"]);
  const name = (line: string) => line.split(/[;:]/, 1)[0].toUpperCase();
  const replacement = lines.filter(line => owned.has(name(line)));
  let inEvent = false, depth = 0;
  const updated: string[] = [];
  for (const line of previousData.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (line === "END:VEVENT") {
      updated.push(...replacement);
      inEvent = false;
    }
    if (inEvent) {
      if (line.startsWith("BEGIN:")) depth++;
      if (!depth && owned.has(name(line))) continue;
      if (line.startsWith("END:")) depth--;
    }
    if (line === "BEGIN:VEVENT") inEvent = true;
    updated.push(line);
  }
  return updated.map(foldCalendarLine).join("\r\n");
}

export function parseAppleWorkout(
  data: string,
  source: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): AppleWorkoutEvent | undefined {
  const lines = data.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const properties = new Map<string, { params: string; value: string }>();
  let inEvent = false,
    nested = 0,
    events = 0,
    malformed = false;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      events++;
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith("BEGIN:")) {
      nested++;
      continue;
    }
    if (line.startsWith("END:")) {
      nested--;
      continue;
    }
    if (nested) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const [name, ...params] = line.slice(0, colon).split(";");
    const key = name.toUpperCase();
    if (properties.has(key)) malformed = true;
    properties.set(key, {
      params: params.join(";"),
      value: line.slice(colon + 1),
    });
  }
  const get = (name: string) => properties.get(name)?.value ?? "";
  const uid = get("UID");
  if (!uid.startsWith(`coroslink-${source}-`)) return undefined;
  const key = get("X-COROSLINK-KEY");
  if (
    !lines.includes("BEGIN:VCALENDAR") ||
    !lines.includes("END:VCALENDAR") ||
    events !== 1 ||
    inEvent ||
    nested ||
    malformed ||
    get("X-COROSLINK-SOURCE") !== source ||
    !/^[a-f0-9]{64}$/.test(key) ||
    uid !== appleWorkoutUid(source, key)
  ) {
    throw new Error(
      "An iCloud workout has invalid sync metadata. Sync stopped without changing it.",
    );
  }
  if (
    properties.has("RRULE") ||
    properties.has("RDATE") ||
    properties.has("RECURRENCE-ID")
  ) {
    throw new Error(
      "A synced iCloud workout was changed into a repeating event. Remove its recurrence before syncing again.",
    );
  }
  const day = get("X-COROSLINK-DAY");
  isoCalendarDay(day);
  const sequence = Number(get("SEQUENCE") || "0");
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence >= 2_147_483_647
  )
    throw new Error("An iCloud event has an invalid revision.");
  const isDate = (name: string) => /(?:^|;)VALUE=DATE(?:;|$)/i.test(properties.get(name)?.params ?? "");
  const dateTime = (name: string): string | undefined => {
    if (isDate(name)) return undefined;
    const value = get(name);
    if (!value) return undefined;
    if (!/^\d{8}T(?:[01]\d|2[0-3])[0-5]\d[0-5]\dZ?$/.test(value))
      throw new Error("An iCloud workout has an invalid event time.");
    const date = isoCalendarDay(value.slice(0, 8));
    const time = `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
    const zone = /(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i.exec(properties.get(name)?.params ?? "");
    return new Date(value.endsWith("Z") ? Date.parse(`${date}T${time}Z`)
      : calendarWallTime(date, time, zone?.[1] ?? zone?.[2] ?? timeZone)).toISOString();
  };
  const startTime = dateTime("DTSTART");
  let endTime = dateTime("DTEND");
  if (startTime && properties.has("DURATION")) {
    const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(get("DURATION"));
    const seconds = duration ? Number(duration[1] || 0) * 3600 + Number(duration[2] || 0) * 60 + Number(duration[3] || 0) : 0;
    if (endTime || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 7 * 86400)
      throw new Error("An iCloud workout has an unsupported duration. Set its end time in Apple Calendar before syncing.");
    endTime = new Date(Date.parse(startTime) + seconds * 1000).toISOString();
  }
  return {
    source,
    key,
    uid,
    day,
    endDay: isDate("DTEND")
      ? get("DTEND")
      : "",
    summary: unescapeText(get("SUMMARY")),
    description: unescapeText(get("DESCRIPTION")),
    sequence,
    actualStart: isDate("DTSTART")
      ? get("DTSTART")
      : "",
    cancelled: get("STATUS") === "CANCELLED",
    startTime,
    endTime,
    timingKey: get("X-COROSLINK-TIMING") || undefined,
  };
}

function matches(
  remote: AppleWorkoutEvent,
  desired: AppleWorkoutEvent,
): boolean {
  return (
    !remote.cancelled &&
    (desired.startTime ? remote.startTime === desired.startTime && remote.endTime === desired.endTime
      : remote.actualStart === desired.day && remote.endDay === desired.endDay) &&
    remote.timingKey === desired.timingKey &&
    remote.day === desired.day &&
    remote.summary === desired.summary &&
    remote.description === desired.description
  );
}

type RemoteWorkout = {
  resource: ICloudCalendarEvent;
  event: AppleWorkoutEvent;
};
const MAX_CONFLICT_RETRIES = 2;
const isMissingEvent = (error: unknown): boolean =>
  error instanceof ICloudCalendarError && [404, 410].includes(error.status);

/** The DAV adapter also lets tests exercise real reconciliation without an iCloud account. */
export async function syncAppleWorkoutEvents(input: {
  userId: string;
  calendarId: string;
  startDay: string;
  endDay: string;
  workouts: TrainingHubScheduledWorkoutEntry[];
  eventTiming?: CalendarEventTiming;
  dav: Pick<
    ICloudCalDav,
    "listEvents" | "getEvent" | "putEvent" | "deleteEvent"
  >;
}): Promise<CalendarSyncResult> {
  const { calendarId, userId, startDay, endDay, dav } = input;
  const source = calendarHash(userId);
  const desired = new Map<string, AppleWorkoutEvent>();
  for (const workout of input.workouts) {
    const data = workoutCalendarData(userId, workout, input.eventTiming);
    if (data.day >= startDay && data.day <= endDay)
      desired.set(data.key, {
        ...data,
        uid: appleWorkoutUid(source, data.key),
        sequence: 0,
      });
  }
  const existing = new Map<string, RemoteWorkout>();
  for (const resource of await dav.listEvents(calendarId, source)) {
    const event = parseAppleWorkout(resource.data, source, input.eventTiming?.timeZone);
    // User-created copies and foreign events never become managed resources.
    if (event && resource.href === appleWorkoutHref(calendarId, event.key))
      existing.set(event.key, { resource, event });
  }
  const readCurrentWorkout = async (
    key: string,
  ): Promise<RemoteWorkout | undefined> => {
    let resource: ICloudCalendarEvent;
    try {
      resource = await dav.getEvent(
        calendarId,
        appleWorkoutHref(calendarId, key),
      );
    } catch (error) {
      if (isMissingEvent(error)) return undefined;
      throw error;
    }
    const event = parseAppleWorkout(resource.data, source, input.eventTiming?.timeZone);
    if (!event || event.uid !== appleWorkoutUid(source, key))
      throw new Error(
        "An unrelated iCloud event uses this workout address. Sync stopped without changing it.",
      );
    return { resource, event };
  };
  const result: CalendarSyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
  };
  for (const event of desired.values()) {
    let remote = existing.get(event.key);
    const href = appleWorkoutHref(calendarId, event.key);
    for (let conflicts = 0; ; conflicts++) {
      const resolved = remote && !remote.event.cancelled
        ? { ...event, ...reconcileCalendarTiming(remote.event, event) } : event;
      if (remote && matches(remote.event, resolved)) {
        result.unchanged++;
        break;
      }
      try {
        await dav.putEvent(
          calendarId,
          href,
          serializeAppleWorkout({
            ...resolved,
            sequence: remote ? remote.event.sequence + 1 : 0,
          }, new Date(), remote?.resource.data),
          remote?.resource.etag,
        );
        if (remote) result.updated++;
        else result.created++;
        break;
      } catch (error) {
        if (
          !(error instanceof ICloudCalendarError) ||
          error.status !== 412 ||
          conflicts >= MAX_CONFLICT_RETRIES
        )
          throw error;
        // Another writer or a lost insert response can invalidate our snapshot.
        // Recheck ownership and content before retrying with the current ETag.
        remote = await readCurrentWorkout(event.key);
      }
    }
  }
  // Never clean up after partial source reads, malformed remote responses, or failed upserts.
  for (const [key, listed] of existing) {
    if (desired.has(key)) continue;
    let remote: RemoteWorkout | undefined = listed;
    for (let conflicts = 0; ; conflicts++) {
      if (!remote) {
        result.deleted++;
        break;
      }
      if (remote.event.day < startDay || remote.event.day > endDay)
        break;
      try {
        await dav.deleteEvent(calendarId, remote.resource);
        result.deleted++;
        break;
      } catch (error) {
        if (isMissingEvent(error)) {
          result.deleted++;
          break;
        }
        if (
          !(error instanceof ICloudCalendarError) ||
          error.status !== 412 ||
          conflicts >= MAX_CONFLICT_RETRIES
        )
          throw error;
        remote = await readCurrentWorkout(key);
      }
    }
  }
  return result;
}
