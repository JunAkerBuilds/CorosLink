import type { CalendarConnectionStatus } from "../../electron/calendarSyncTypes";

export function calendarSyncButtonState(
  statuses: CalendarConnectionStatus[] | null,
  syncing = false,
): "syncing" | "synced" | "pending" {
  const connections = statuses?.filter((status) => status.connected || status.calendar) ?? [];
  if (syncing || connections.some((status) => status.syncing)) return "syncing";
  if (connections.length > 0 && connections.every((status) =>
    status.connected && status.calendar && status.accountMatches &&
    status.lastSyncedAt && !status.needsSync && !status.error && !status.connecting
  )) return "synced";
  return "pending";
}
