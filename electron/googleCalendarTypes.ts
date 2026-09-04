import type {
  CalendarChoice,
  CalendarConnectionStatus,
  CalendarSyncResult,
} from "./calendarSyncTypes";
export interface GoogleCalendarConfigInput {
  clientId: string;
  clientSecret?: string;
}

export type GoogleCalendarChoice = CalendarChoice;

export interface GoogleCalendarStatus extends CalendarConnectionStatus {
  configured: boolean;
  clientId: string;
}

export type GoogleCalendarSyncResult = CalendarSyncResult;
