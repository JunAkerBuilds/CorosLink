import { getSetting, setSetting } from "./database";
import { CalendarWorkoutEventStore } from "./calendarWorkoutEventStore";
import { getTrainingHubStatus, getScheduledWorkoutRevision, listScheduledWorkoutEntries } from "./trainingHubService";

export const calendarWorkoutEvents = new CalendarWorkoutEventStore({ read: getSetting, write: setSetting });

export function calendarSourceUserId(): string | undefined {
  const status = getTrainingHubStatus();
  return status.authenticated ? status.userId : undefined;
}

export function calendarSourceRevision(): string | undefined {
  const userId = calendarSourceUserId();
  const localRevision = userId ? calendarWorkoutEvents.revision(userId) : undefined;
  const scheduleRevision = getScheduledWorkoutRevision();
  return localRevision ? JSON.stringify([scheduleRevision, localRevision]) : scheduleRevision;
}

export async function listCalendarWorkoutEntries(start: string, end: string) {
  const userId = calendarSourceUserId();
  const workouts = await listScheduledWorkoutEntries(start, end);
  if (!userId || userId !== calendarSourceUserId()) throw new Error("Your COROS account changed. Reopen the calendar and try again.");
  return calendarWorkoutEvents.apply(userId, workouts);
}
