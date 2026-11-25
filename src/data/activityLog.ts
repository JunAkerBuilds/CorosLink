"use client";
// Log activity: the chosen day as the calendar knows it, and the save. An activity logged here becomes a
// one-lap TCX file on the server and goes to the person's COROS account; nothing is kept in this browser.
import type { Loaded } from "@/data/core";
import { hubRequest, timezoneQuarters } from "@/data/hubRequest";
import { loadCalendar, type CalendarEntry } from "@/data/training";
import { isDayKey } from "@/lib/calendar";
import type { ManualActivity } from "@/lib/tcx";

export interface LogDay {
  today: string;
  /** The day being logged for: the one asked for, else today. */
  date: string;
  /** What the calendar already holds for that day. */
  planned: CalendarEntry[];
  recorded: CalendarEntry[];
}

/** The day's planned and recorded entries, from the same data the calendar shows. */
export async function loadActivityLog(asked: string | null): Promise<Loaded<LogDay>> {
  const calendar = await loadCalendar();
  const { today, entries } = calendar.data;
  const date = isDayKey(asked) ? asked : today;
  const onDay = entries.filter((entry) => entry.date === date);
  return {
    origin: calendar.origin,
    data: { today, date, planned: onDay.filter((entry) => entry.status === "planned"), recorded: onDay.filter((entry) => entry.status === "done") },
  };
}

/**
 * Sends a hand-entered activity to COROS. Needs the COROS sign-in: without it this throws
 * `HubSessionEndedError`, and for a COROS region whose upload isn't connected, `NotWiredError`.
 */
export async function logActivity(activity: ManualActivity): Promise<void> {
  await hubRequest<{ importId: string }>("activities", { method: "POST", body: { ...activity, timezone: timezoneQuarters() } });
}
