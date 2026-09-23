import { randomUUID } from "node:crypto";
import { validateCalendarEventTiming } from "./calendarEventTiming";
import { calendarHash, isoCalendarDay, workoutCalendarData } from "./calendarSyncUtils";
import type { CalendarEventTiming, CalendarWorkoutEvent, CalendarWorkoutEventRef, CalendarWorkoutEventSaveResult, CalendarConnectionStatus } from "./calendarSyncTypes";
import type { TrainingHubScheduledWorkoutEntry } from "./types";

interface SavedEvents {
  revision?: string;
  events: Record<string, CalendarWorkoutEvent>;
}

export class CalendarWorkoutEventStore {
  constructor(private readonly storage: {
    read: (key: string) => string | undefined;
    write: (key: string, value: string) => void;
  }) {}

  private key(userId: string): string {
    return `calendar.workoutEvents.${calendarHash(userId)}`;
  }

  private read(userId: string): SavedEvents {
    const raw = this.storage.read(this.key(userId));
    return raw ? JSON.parse(raw) as SavedEvents : { events: {} };
  }

  private eventKey(ref: Pick<CalendarWorkoutEventRef, "planId" | "idInPlan">): string {
    return calendarHash(JSON.stringify([ref.planId, ref.idInPlan]));
  }

  get(ref: CalendarWorkoutEventRef): CalendarWorkoutEvent | undefined {
    return this.read(ref.userId).events[this.eventKey(ref)];
  }

  revision(userId: string): string | undefined {
    return this.read(userId).revision;
  }

  apply(userId: string, workouts: TrainingHubScheduledWorkoutEntry[]): TrainingHubScheduledWorkoutEntry[] {
    const state = this.read(userId);
    return workouts.map(workout => ({ ...workout, calendarEvent: state.events[this.eventKey(workout)] }));
  }

  save(ref: CalendarWorkoutEventRef, timing: CalendarEventTiming): CalendarWorkoutEvent {
    const event = { timing: validateCalendarEventTiming(timing), revision: randomUUID() };
    const state = this.read(ref.userId);
    state.events[this.eventKey(ref)] = event;
    state.revision = event.revision;
    this.storage.write(this.key(ref.userId), JSON.stringify(state));
    return event;
  }
}

export interface CalendarEventProvider {
  name: string;
  status: () => CalendarConnectionStatus;
  sync: (userId: string, day: string) => Promise<unknown>;
}

export function validateCalendarWorkoutRef(ref: CalendarWorkoutEventRef, userId: string | undefined): void {
  if (!ref || !userId || ref.userId !== userId) throw new Error("Your COROS account changed. Reopen the calendar and try again.");
  if (typeof ref.planId !== "string" || !ref.planId || typeof ref.idInPlan !== "string" || !ref.idInPlan)
    throw new Error("Choose a scheduled workout first.");
  isoCalendarDay(ref.happenDay);
}

export async function syncCalendarEventProviders(providers: CalendarEventProvider[], userId: string, day: string): Promise<{ synced: string[]; errors: string[] }> {
  const results = await Promise.all(providers.map(async provider => {
    try {
      const status = provider.status();
      if (!status.connected || !status.calendar) return {};
      if (!status.accountMatches) throw new Error("Reconnect this calendar to the current COROS account in Settings.");
      await provider.sync(userId, day);
      return { synced: provider.name };
    } catch (error) {
      return { error: `${provider.name}: ${error instanceof Error ? error.message : "Sync failed. Try again."}` };
    }
  }));
  return {
    synced: results.flatMap(result => result.synced ? [result.synced] : []),
    errors: results.flatMap(result => result.error ? [result.error] : []),
  };
}

export async function saveCalendarWorkoutEvent(input: { ref: CalendarWorkoutEventRef; timing: CalendarEventTiming }, dependencies: {
  store: CalendarWorkoutEventStore;
  userId: () => string | undefined;
  listWorkouts: (start: string, end: string) => Promise<TrainingHubScheduledWorkoutEntry[]>;
  providers: CalendarEventProvider[];
}): Promise<CalendarWorkoutEventSaveResult> {
  const { ref, timing } = input;
  validateCalendarWorkoutRef(ref, dependencies.userId());
  const validated = validateCalendarEventTiming(timing);
  const workouts = await dependencies.listWorkouts(ref.happenDay, ref.happenDay);
  validateCalendarWorkoutRef(ref, dependencies.userId());
  const workout = workouts.find(entry => entry.planId === ref.planId && entry.idInPlan === ref.idInPlan && entry.happenDay === ref.happenDay);
  if (!workout) throw new Error("This workout has moved or been removed. Reopen the calendar and try again.");
  workoutCalendarData(ref.userId, { ...workout, calendarEvent: undefined }, validated);
  const event = dependencies.store.save(ref, validated);
  // Keep the local save even when a provider is offline; subsequent sync retries it.
  return { event, ...await syncCalendarEventProviders(dependencies.providers, ref.userId, ref.happenDay) };
}
