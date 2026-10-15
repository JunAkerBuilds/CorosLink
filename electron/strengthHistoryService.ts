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
