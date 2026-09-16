export interface CalendarChoice {
  id: string;
  name: string;
  primary: boolean;
}

export interface CalendarConnectionStatus {
  connected: boolean;
  accountEmail?: string;
  calendar?: CalendarChoice;
  autoSync: boolean;
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
