import type { TrainingHubScheduledWorkoutEntry } from "./types";
import type { CalendarSyncResult } from "./calendarSyncTypes";
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
): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CorosLink//Workout Sync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${timestamp}`,
    `LAST-MODIFIED:${timestamp}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTART;VALUE=DATE:${event.day}`,
    `DTEND;VALUE=DATE:${event.endDay}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    `X-COROSLINK-SOURCE:${event.source}`,
    `X-COROSLINK-KEY:${event.key}`,
    `X-COROSLINK-DAY:${event.day}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldCalendarLine)
    .join("\r\n");
}

export function parseAppleWorkout(
  data: string,
  source: string,
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
      params: params.join(";").toUpperCase(),
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
  // A changed event date/time is compared against the COROS day on the next sync.
  return {
    source,
    key,
    uid,
    day,
    endDay: properties.get("DTEND")?.params.includes("VALUE=DATE")
      ? get("DTEND")
      : "",
    summary: unescapeText(get("SUMMARY")),
    description: unescapeText(get("DESCRIPTION")),
    sequence,
    actualStart: properties.get("DTSTART")?.params.includes("VALUE=DATE")
      ? get("DTSTART")
      : "",
    cancelled: get("STATUS") === "CANCELLED",
  };
}

function matches(
  remote: AppleWorkoutEvent,
  desired: AppleWorkoutEvent,
): boolean {
  return (
    !remote.cancelled &&
    remote.actualStart === desired.day &&
    remote.day === desired.day &&
    remote.endDay === desired.endDay &&
    remote.summary === desired.summary &&
    remote.description === desired.description
  );
}

/** The DAV adapter also lets tests exercise real reconciliation without an iCloud account. */
export async function syncAppleWorkoutEvents(input: {
  userId: string;
  calendarId: string;
  startDay: string;
  endDay: string;
  workouts: TrainingHubScheduledWorkoutEntry[];
  dav: Pick<
    ICloudCalDav,
    "listEvents" | "getEvent" | "putEvent" | "deleteEvent"
  >;
}): Promise<CalendarSyncResult> {
  const { calendarId, userId, startDay, endDay, dav } = input;
  const source = calendarHash(userId);
  const desired = new Map<string, AppleWorkoutEvent>();
  for (const workout of input.workouts) {
    const data = workoutCalendarData(userId, workout);
    if (data.day >= startDay && data.day <= endDay)
      desired.set(data.key, {
        ...data,
        uid: appleWorkoutUid(source, data.key),
        sequence: 0,
      });
  }
  const existing = new Map<
    string,
    { resource: ICloudCalendarEvent; event: AppleWorkoutEvent }
  >();
  for (const resource of await dav.listEvents(calendarId, source)) {
    const event = parseAppleWorkout(resource.data, source);
    // User-created copies and foreign events never become managed resources.
    if (event && resource.href === appleWorkoutHref(calendarId, event.key))
      existing.set(event.key, { resource, event });
  }
  const result: CalendarSyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
  };
  for (const event of desired.values()) {
    let remote = existing.get(event.key);
    const href = appleWorkoutHref(calendarId, event.key);
    if (!remote) {
      try {
        await dav.putEvent(calendarId, href, serializeAppleWorkout(event));
        result.created++;
        continue;
      } catch (error) {
        if (!(error instanceof ICloudCalendarError) || error.status !== 412)
          throw error;
        // The previous insert may have completed before its response was lost.
        const resource = await dav.getEvent(calendarId, href);
        const parsed = parseAppleWorkout(resource.data, source);
        if (!parsed || parsed.uid !== event.uid)
          throw new Error(
            "An unrelated iCloud event uses this workout address. Sync stopped without changing it.",
          );
        remote = { resource, event: parsed };
      }
    }
    if (matches(remote.event, event)) {
      result.unchanged++;
      continue;
    }
    await dav.putEvent(
      calendarId,
      href,
      serializeAppleWorkout({ ...event, sequence: remote.event.sequence + 1 }),
      remote.resource.etag,
    );
    result.updated++;
  }
  // Never clean up after partial source reads, malformed remote responses, or failed upserts.
  for (const [key, remote] of existing) {
    if (
      desired.has(key) ||
      remote.event.day < startDay ||
      remote.event.day > endDay
    )
      continue;
    try {
      await dav.deleteEvent(calendarId, remote.resource);
    } catch (error) {
      if (
        !(error instanceof ICloudCalendarError) ||
        ![404, 410].includes(error.status)
      )
        throw error;
    }
    result.deleted++;
  }
  return result;
}
