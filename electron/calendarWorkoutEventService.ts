import { appleCalendar } from "./appleCalendarService";
import { googleCalendar } from "./googleCalendarService";
import { defaultCalendarEventTiming, type CalendarEventTiming, type CalendarWorkoutEventRef } from "./calendarSyncTypes";
import { calendarSourceUserId, calendarWorkoutEvents, listCalendarWorkoutEntries } from "./calendarWorkoutEventStorage";
import { saveCalendarWorkoutEvent, syncCalendarEventProviders, validateCalendarWorkoutRef } from "./calendarWorkoutEventStore";

const providers = [
  { name: "Google Calendar", status: () => googleCalendar.status(), sync: (userId: string, day: string) => googleCalendar.syncAfterCurrentOperation(userId, day) },
  { name: "Apple Calendar", status: () => appleCalendar.status(), sync: (userId: string, day: string) => appleCalendar.syncAfterCurrentOperation(userId, day) },
];

export function getCalendarWorkoutEvent(ref: CalendarWorkoutEventRef) {
  validateCalendarWorkoutRef(ref, calendarSourceUserId());
  const saved = calendarWorkoutEvents.get(ref);
  if (saved) return saved.timing;
  for (const provider of providers) {
    try {
      const status = provider.status();
      if (status.connected && status.calendar && status.accountMatches && status.eventTiming) return status.eventTiming;
    } catch { /* Local editing remains available if credentials cannot be unlocked. */ }
  }
  return defaultCalendarEventTiming();
}

export function updateCalendarWorkoutEvent(input: { ref: CalendarWorkoutEventRef; timing: CalendarEventTiming }) {
  return saveCalendarWorkoutEvent(input, {
    store: calendarWorkoutEvents, userId: calendarSourceUserId,
    listWorkouts: listCalendarWorkoutEntries, providers,
  });
}

export function syncEditedCalendarWorkout(ref: CalendarWorkoutEventRef) {
  validateCalendarWorkoutRef(ref, calendarSourceUserId());
  return syncCalendarEventProviders(providers, ref.userId, ref.happenDay);
}
