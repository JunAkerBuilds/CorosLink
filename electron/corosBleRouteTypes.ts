export interface CorosRouteSyncStatus {
  phase: "idle" | "connecting" | "preparing" | "transferring" | "verifying" | "complete" | "cancelled" | "failed";
  routeId?: string;
  routeName?: string;
  sentBytes: number;
  totalBytes: number;
  pointCount?: number;
  watchSlot?: number;
  error?: string;
}
