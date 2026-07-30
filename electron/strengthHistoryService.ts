import { listStoredStrengthSessions } from "./database";
import {
  getStoredHevyStrengthSessions,
  getHevyStatus,
  syncHevyStrengthHistory
} from "./hevyService";
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
  const corosConnected = getTrainingHubStatus().authenticated;
  const hevyConnected = getHevyStatus().connected;
  const warnings: string[] = [];

  let corosSessions: StrengthSession[] = [];
  let hevySessions: StrengthSession[] = [];
  let corosPending = 0;
  let corosFetched = 0;
  let hevyFetched = 0;

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

  return {
    sessions: selectStrengthSessions(source, corosSessions, hevySessions),
    pending: corosPending,
    fetched: corosFetched + hevyFetched,
    days,
    source,
    pendingBySource: { coros: corosPending, hevy: 0 },
    fetchedBySource: { coros: corosFetched, hevy: hevyFetched },
    ...(warnings.length > 0 ? { warnings } : {})
  };
}
