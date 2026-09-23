import type { TrainingHubScheduledWorkoutEntry } from "./types";
import { createHash } from "node:crypto";
import type { CalendarEventTiming } from "./calendarSyncTypes";
import { calendarWallTime, validateCalendarEventTiming, type CalendarTimedEvent } from "./calendarEventTiming";

export const calendarHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export function workoutCalendarData(
  userId: string,
  workout: TrainingHubScheduledWorkoutEntry,
  settings?: CalendarEventTiming,
) {
  if (
    !workout.planId ||
    !workout.idInPlan ||
    typeof workout.name !== "string"
  ) {
    throw new Error(
      "A workout is missing its calendar identity. Calendar sync stopped.",
    );
  }
  const day = isoCalendarDay(workout.happenDay);
  const timing = validateCalendarEventTiming(workout.calendarEvent?.timing ?? settings);
  const timed: CalendarTimedEvent = {};
  if (timing.mode === "timed") {
    const start = calendarWallTime(day, timing.startTime, timing.timeZone);
    const endDay = timing.endTime <= timing.startTime ? isoCalendarDay(shiftCalendarDay(workout.happenDay, 1)) : day;
    const end = calendarWallTime(endDay, timing.endTime, timing.timeZone);
    if (end <= start) throw new Error("The event end time must be after its start time on this date. Choose times outside the daylight-saving clock change.");
    timed.startTime = new Date(start).toISOString();
    timed.endTime = new Date(end).toISOString();
    // Keep the existing key format so upgrading does not reset calendar edits.
    const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
    timed.timingKey = calendarHash(JSON.stringify([workout.happenDay, {
      mode: timing.mode, startTime: timing.startTime, timeZone: timing.timeZone,
      fallbackDurationMinutes: (minutes(timing.endTime) - minutes(timing.startTime) + 1440) % 1440 || 1440,
    }]));
    if (workout.calendarEvent) {
      // Each explicit save in CorosLink supersedes previous calendar edits,
      // even when the user saves the same times again.
      timed.timingKey = calendarHash(JSON.stringify([timed.timingKey, workout.calendarEvent.revision]));
    }
  }
  return {
    ...timed,
    source: calendarHash(userId),
    key: calendarHash(
      JSON.stringify([userId, workout.planId, workout.idInPlan]),
    ),
    day: workout.happenDay,
    endDay: shiftCalendarDay(workout.happenDay, 1),
    summary: workout.name || "Planned workout",
    description: [
      timing.mode === "timed"
        ? "Scheduled with CorosLink. Move or resize this event in your calendar to fit your schedule. Calendar edits do not update your COROS training plan. Changing timing defaults or the workout's planned date reapplies its time."
        : "Scheduled with CorosLink. Edit this workout in CorosLink to keep it in sync.",
      workout.volume,
      Number.isFinite(workout.trainingLoad)
        ? `Training load: ${workout.trainingLoad}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function isoCalendarDay(day: string): string {
  if (!/^\d{8}$/.test(day))
    throw new Error(
      "A workout has an invalid scheduled date. Calendar sync stopped.",
    );
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const date = new Date(`${iso}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  ) {
    throw new Error(
      "A workout has an invalid scheduled date. Calendar sync stopped.",
    );
  }
  return iso;
}

export function shiftCalendarDay(day: string, days: number): string {
  const date = new Date(`${isoCalendarDay(day)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function calendarSyncRange(now = new Date()): {
  startDay: string;
  endDay: string;
} {
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return {
    startDay: shiftCalendarDay(day, -7),
    endDay: shiftCalendarDay(day, 90),
  };
}

/** Stop waiting for shared COROS readers on cancellation, without allowing late results to cause writes. */
export function abortableCalendarRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Calendar sync cancelled."));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "COROS calendar took too long to respond. Try syncing again.",
        ),
      );
    }, 30_000);
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(read)
      .then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
  });
}

export async function readCalendarWorkouts(input: {
  userId: string;
  sourceUserId: () => string | undefined;
  listWorkouts: (
    start: string,
    end: string,
  ) => Promise<TrainingHubScheduledWorkoutEntry[]>;
  startDay: string;
  endDay: string;
  signal: AbortSignal;
}): Promise<TrainingHubScheduledWorkoutEntry[]> {
  const workouts: TrainingHubScheduledWorkoutEntry[] = [];
  for (let day = input.startDay; day <= input.endDay;) {
    input.signal.throwIfAborted();
    if (input.sourceUserId() !== input.userId)
      throw new Error("Your COROS account changed during sync. Try again.");
    const end = [shiftCalendarDay(day, 29), input.endDay].sort()[0];
    const start = day;
    const entries = await abortableCalendarRead(
      () => input.listWorkouts(start, end),
      input.signal,
    );
    if (!Array.isArray(entries))
      throw new Error(
        "COROS returned an invalid calendar response. Sync stopped.",
      );
    workouts.push(...entries);
    day = shiftCalendarDay(end, 1);
  }
  input.signal.throwIfAborted();
  if (input.sourceUserId() !== input.userId)
    throw new Error("Your COROS account changed during sync. Try again.");
  return workouts;
}
