export interface CalendarChoice {
  id: string;
  name: string;
  primary: boolean;
}

export interface CalendarEventTiming {
  mode: "all-day" | "timed";
  startTime: string;
  endTime: string;
  timeZone: string;
}

export interface CalendarWorkoutEventRef {
  userId: string;
  planId: string;
  idInPlan: string;
  happenDay: string;
}

export interface CalendarWorkoutEvent {
  timing: CalendarEventTiming;
  revision: string;
}

export interface CalendarWorkoutEventSaveResult {
  event: CalendarWorkoutEvent;
  synced: string[];
  errors: string[];
}

export function defaultCalendarEventTiming(): CalendarEventTiming {
  return {
    mode: "all-day",
    startTime: "18:00",
    endTime: "19:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export interface CalendarConnectionStatus {
  connected: boolean;
  accountEmail?: string;
  calendar?: CalendarChoice;
  autoSync: boolean;
  eventTiming?: CalendarEventTiming;
  syncing: boolean;
  connecting: boolean;
  lastSyncedAt?: string;
  /** The schedule has changed since the last completed sync. */
  needsSync?: boolean;
  error?: string;
  accountMatches: boolean;
}

export interface CalendarSyncSettings {
  calendarId?: string;
  autoSync?: boolean;
  eventTiming?: CalendarEventTiming;
}

export interface CalendarSyncResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export interface AppleCalendarCredentials {
  email: string;
  appPassword: string;
}
