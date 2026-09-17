export interface CalendarChoice {
  id: string;
  name: string;
  primary: boolean;
}

export interface CalendarEventTiming {
  mode: "all-day" | "timed";
  startTime: string;
  timeZone: string;
  fallbackDurationMinutes: number;
}

export function defaultCalendarEventTiming(): CalendarEventTiming {
  return {
    mode: "all-day",
    startTime: "18:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    fallbackDurationMinutes: 60,
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
