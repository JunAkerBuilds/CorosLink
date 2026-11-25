"use client";
// Import from intervals.icu. The API key is typed here once and sent to this app's server, which checks it
// with intervals.icu and keeps it in a sealed httpOnly cookie: this code never sees it again.
import { hubRequest, timezoneQuarters } from "@/data/hubRequest";
import { createStore } from "@/data/local/store";
import { DEFAULT_IMPORT_DAYS, filterRecentIds, RECENT_IMPORT_WINDOW_MS, type ImportDays, type IntervalsRow } from "@/lib/intervals";

export type { ImportDays, IntervalsRow } from "@/lib/intervals";

export interface IntervalsStatus { connected: boolean; athleteId?: string }

/** How far back the table looks, remembered in this browser. */
export const importDaysStore = createStore<number>("intervals.days", DEFAULT_IMPORT_DAYS);
export const saveImportDays = (days: ImportDays): void => importDaysStore.set(days);

/** When each activity was imported from this browser, so it isn't offered again while COROS is still reading it. */
const importedStore = createStore<Record<string, number>>("intervals.importedAt", {});

export const intervalsStatus = (): Promise<IntervalsStatus> => hubRequest<IntervalsStatus>("intervals");

export function connectIntervals(apiKey: string, athleteId: string): Promise<IntervalsStatus> {
  return hubRequest<IntervalsStatus>("intervals", { method: "POST", body: { apiKey: apiKey.trim(), athleteId: athleteId.trim() } });
}

export const disconnectIntervals = (): Promise<IntervalsStatus> => hubRequest<IntervalsStatus>("intervals", { method: "DELETE" });

/** The activities of the last `days` days, each marked "on COROS" when COROS has it or it was imported here in the last 14 days. */
export async function listIntervalsActivities(days: ImportDays): Promise<IntervalsRow[]> {
  const { activities } = await hubRequest<{ activities: IntervalsRow[] }>(`intervals/activities?days=${days}`);
  const saved = importedStore.get();
  const recent = new Set(filterRecentIds(typeof saved === "object" && saved !== null ? saved : {}, Date.now(), RECENT_IMPORT_WINDOW_MS));
  return activities.map((row) => (recent.has(row.intervalsId) ? { ...row, onCoros: true } : row));
}

/** Downloads the activity's file from intervals.icu and uploads it to COROS, both on the server. */
export async function importIntervalsActivity(row: Pick<IntervalsRow, "intervalsId" | "fileExt">): Promise<void> {
  await hubRequest<{ importId: string }>("intervals/import", { method: "POST", body: { id: row.intervalsId, fileExt: row.fileExt, timezone: timezoneQuarters() } });
  const now = Date.now();
  importedStore.set((prev) => {
    const kept = Object.fromEntries(filterRecentIds(prev ?? {}, now, RECENT_IMPORT_WINDOW_MS).map((id) => [id, prev[id]]));
    return { ...kept, [row.intervalsId]: now };
  });
}
