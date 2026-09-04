import type { TrainingHubScheduledWorkoutEntry } from "./types";
import { createHash } from "node:crypto";

export const calendarHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export function workoutCalendarData(
  userId: string,
  workout: TrainingHubScheduledWorkoutEntry,
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
  isoCalendarDay(workout.happenDay);
  return {
    source: calendarHash(userId),
    key: calendarHash(
      JSON.stringify([userId, workout.planId, workout.idInPlan]),
    ),
    day: workout.happenDay,
    endDay: shiftCalendarDay(workout.happenDay, 1),
    summary: workout.name || "Planned workout",
    description: [
      "Scheduled with CorosLink. Edit this workout in CorosLink to keep it in sync.",
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
