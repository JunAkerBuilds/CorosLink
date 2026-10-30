import { listStoredStrengthSessions } from "./database";
import {
  getStoredHevyStrengthSessions,
  getHevyStatus,
  syncHevyStrengthHistory
} from "./hevyService";
import {
  getStoredStravaStrengthSessions,
  getStravaStatus,
  syncStravaStrengthHistory
} from "./stravaService";
import { selectStrengthSessions } from "./strengthSessionMerge";
import {
  getTrainingHubStatus,
  syncStrengthHistory as syncCorosStrengthHistory
} from "./trainingHubService";
import type {
  StrengthHistory,
  StrengthHistoryRequest,
  StrengthSession
} from "./types";

function windowStartEpochSeconds(days: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return Math.floor(start.getTime() / 1000);
}
function errorMessage(provider: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${provider} refresh failed: ${detail}`;
}

export async function syncStrengthHistory(
  request: StrengthHistoryRequest = {}
): Promise<StrengthHistory> {
  const days = Math.max(1, Math.min(365, Math.round(request.days ?? 90)));
  const source = request.source ?? "combined";
  const wantsCoros = source === "combined" || source === "coros";
  const wantsHevy = source === "combined" || source === "hevy";
  const wantsStrava = source === "combined" || source === "strava";
  const corosConnected = getTrainingHubStatus().authenticated;
  const hevyConnected = getHevyStatus().connected;
  const stravaConnected = getStravaStatus().connected;
  const warnings: string[] = [];
  const notices: string[] = [];

  let corosSessions: StrengthSession[] = [];
  let hevySessions: StrengthSession[] = [];
  let stravaSessions: StrengthSession[] = [];
  let corosPending = 0;
  let corosFetched = 0;
  let hevyFetched = 0;
  let stravaPending = 0;
  let stravaFetched = 0;

  if (wantsCoros && corosConnected) {
    try {
      const result = await syncCorosStrengthHistory(days, request.force ?? false);
      corosSessions = result.sessions;
      corosPending = result.pending;
      corosFetched = result.fetched;
    } catch (error) {
      warnings.push(errorMessage("COROS", error));
      corosSessions = listStoredStrengthSessions(windowStartEpochSeconds(days));
    }
  }

  if (wantsHevy && hevyConnected) {
    try {
      const result = await syncHevyStrengthHistory(days, request.force ?? false);
      hevySessions = result.sessions;
      hevyFetched = result.fetched;
    } catch (error) {
      warnings.push(errorMessage("Hevy", error));
      hevySessions = getStoredHevyStrengthSessions(days);
    }
  }

  if (wantsStrava && stravaConnected) {
    try {
      const result = await syncStravaStrengthHistory(days, request.force ?? false);
      stravaSessions = result.sessions;
      stravaPending = result.pending;
      stravaFetched = result.fetched;
      if (result.notice) notices.push(result.notice);
    } catch (error) {
      warnings.push(errorMessage("Strava", error));
      stravaSessions = getStoredStravaStrengthSessions(days);
    }
  }

  return {
    sessions: selectStrengthSessions(source, corosSessions, hevySessions, stravaSessions),
    pending: corosPending + stravaPending,
    fetched: corosFetched + hevyFetched + stravaFetched,
    days,
    source,
    pendingBySource: { coros: corosPending, hevy: 0, strava: stravaPending },
    fetchedBySource: { coros: corosFetched, hevy: hevyFetched, strava: stravaFetched },
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(notices.length > 0 ? { notices } : {})
  };
}

/** Calendar paging must not re-sync on every month flip. */
const CALENDAR_SYNC_INTERVAL_MS = 5 * 60_000;
const calendarSynced = {
  hevy: { at: 0, days: 0 },
  strava: { at: 0, days: 0 }
};

function localDayStartEpochSeconds(dayKey: string): number | undefined {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(dayKey);
  if (!match) return undefined;
  return Math.floor(
    new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() / 1000
  );
}

async function calendarProviderSessions(
  provider: "hevy" | "strava",
  days: number
): Promise<StrengthSession[]> {
  const synced = calendarSynced[provider];
  const fresh = Date.now() - synced.at < CALENDAR_SYNC_INTERVAL_MS && synced.days >= days;
  const stored = () =>
    provider === "hevy" ? getStoredHevyStrengthSessions(days) : getStoredStravaStrengthSessions(days);
  if (fresh) return stored();
  try {
    const result =
      provider === "hevy"
        ? await syncHevyStrengthHistory(days, false)
        : await syncStravaStrengthHistory(days, false);
    calendarSynced[provider] = { at: Date.now(), days };
    return result.sessions;
  } catch {
    return stored();
  }
}

/**
 * Hevy and Strava gym sessions between two local days (inclusive, YYYYMMDD
 * or YYYY-MM-DD) that COROS did not record itself, for the calendar.
 * Sessions matched to a COROS activity are dropped: the calendar already
 * shows that activity.
 */
export async function listCalendarStrengthSessions(
  startDay: string,
  endDay: string
): Promise<StrengthSession[]> {
  const hevyConnected = getHevyStatus().connected;
  const stravaConnected = getStravaStatus().connected;
  const rangeStart = localDayStartEpochSeconds(startDay);
  const rangeEndDay = localDayStartEpochSeconds(endDay);
  if ((!hevyConnected && !stravaConnected) || rangeStart === undefined || rangeEndDay === undefined) {
    return [];
  }
  // Workouts only exist up to today; look back far enough to cover the range.
  const days = Math.ceil((windowStartEpochSeconds(0) - rangeStart) / 86_400);
  if (days < 0) return [];
  const windowDays = Math.max(1, Math.min(365, days));

  const [hevySessions, stravaSessions] = await Promise.all([
    hevyConnected ? calendarProviderSessions("hevy", windowDays) : Promise.resolve([]),
    stravaConnected ? calendarProviderSessions("strava", windowDays) : Promise.resolve([])
  ]);
  const corosSessions = listStoredStrengthSessions(windowStartEpochSeconds(windowDays));
  const rangeEnd = rangeEndDay + 86_400;
  return selectStrengthSessions("combined", corosSessions, hevySessions, stravaSessions)
    .filter((session) => session.source !== "coros" && !session.sourceIds?.coros)
    .filter(
      (session) =>
        session.startTime !== undefined &&
        session.startTime >= rangeStart &&
        session.startTime < rangeEnd
    )
    .sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0));
}
