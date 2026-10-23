// Where the Coach's data comes from and how fresh it is, so it can say "that
// run hasn't reached COROS yet" instead of deciding it never happened. Pure:
// the runtime gathers the inputs.

export interface CoachDataStatusInput {
  now: Date;
  localOnly: boolean;
  trainingHub: { signedIn: boolean; sessionExpired?: boolean };
  /** Absent when no COROS MCP server is configured. */
  corosMcp?: { connected: boolean; authenticated: boolean; error?: string };
  /** The newest activity the current source (COROS cloud, or this computer in Local-Only Mode) has. */
  newestActivity?: { startTime: number; name?: string; sport?: string };
  newestActivityError?: string;
  watch: {
    connected: boolean;
    name?: string;
    /** ISO time of the last Bluetooth connection: the watch profile is read on each one. */
    lastConnectedAt?: string;
  };
  /** Local-Only Mode's watch syncs. */
  localSync?: { lastActivitySyncAt?: string; lastHealthSyncAt?: string };
  syncErrors: Array<{ at: string; source: string; message: string; code?: string; count?: number }>;
}

export interface CoachDataStatus {
  checked_at: string;
  data_mode: "local-only" | "connected";
  activity_source: string;
  training_hub: string;
  coros_mcp: string;
  watch: string;
  newest_activity?: string;
  last_watch_sync?: string;
  recent_sync_errors: Array<{ when: string; where: string; message: string; repeats?: number }>;
  guidance: string;
}

function ago(iso: string | number | undefined, now: Date): string | undefined {
  const time = typeof iso === "number" ? iso * 1000 : iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return undefined;
  const minutes = Math.max(0, Math.round((now.getTime() - time) / 60_000));
  const when = new Date(time);
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ` +
    `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const relative = minutes < 2 ? "just now"
    : minutes < 90 ? `${minutes} min ago`
      : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago`
        : `${Math.round(minutes / 1440)} days ago`;
  return `${stamp} (${relative})`;
}

function sourceLabel(source: string): string {
  if (/^trainingHub/i.test(source)) return "Training Hub";
  if (/^(mcp|corosMcp)/i.test(source)) return "COROS MCP";
  if (/^(corosBle|watch|localData)/i.test(source)) return "Watch";
  if (/^(calendar|googleCalendar|appleCalendar)/i.test(source)) return "Calendar sync";
  if (/^strava/i.test(source)) return "Strava";
  if (/^hevy/i.test(source)) return "Hevy";
  if (/^intervals/i.test(source)) return "Intervals.icu";
  if (/^(fitIndex|activityBackup)/i.test(source)) return "Activity files";
  return source.split(":")[0] ?? source;
}

export function buildCoachDataStatus(input: CoachDataStatusInput): CoachDataStatus {
  const { now } = input;
  const trainingHub = input.trainingHub.signedIn
    ? "signed in"
    : input.trainingHub.sessionExpired ? "signed out: the COROS session expired, so the athlete needs to sign in again" : "not signed in";
  const corosMcp = !input.corosMcp
    ? "not set up"
    : input.corosMcp.connected ? "connected"
      : input.corosMcp.authenticated ? `not connected${input.corosMcp.error ? ` (${input.corosMcp.error})` : ""}` : "not signed in";
  const watch = input.watch.connected
    ? `connected${input.watch.name ? ` (${input.watch.name})` : ""}`
    : `not connected${input.watch.lastConnectedAt ? `; last connected ${ago(input.watch.lastConnectedAt, now)}` : ""}`;
  const newest = input.newestActivity
    ? [ago(input.newestActivity.startTime, now), input.newestActivity.sport, input.newestActivity.name].filter(Boolean).join(" · ")
    : input.newestActivityError ? `unavailable (${input.newestActivityError})` : "none found";
  const lastWatchSync = input.localOnly ? ago(input.localSync?.lastActivitySyncAt, now) ?? "never" : undefined;

  const guidance = input.localOnly
    ? "Local-Only Mode: activities reach CorosLink only when the watch syncs over Bluetooth (Sync watch now in the watch menu). " +
      "An activity the athlete mentions that is newer than the newest one here has not synced yet; ask them to sync the watch, don't conclude it didn't happen."
    : !input.trainingHub.signedIn
      ? "Training Hub is signed out, so recent activities can't be read. Ask the athlete to sign in to COROS in CorosLink before judging what they did."
      : "Connected Mode: activities come from the COROS cloud after the watch syncs to the COROS phone app. " +
        "An activity newer than the newest one listed here has not reached COROS yet; suggest opening the COROS app to sync, don't conclude it didn't happen.";

  return {
    checked_at: ago(now.toISOString(), now) ?? now.toISOString(),
    data_mode: input.localOnly ? "local-only" : "connected",
    activity_source: input.localOnly ? "this computer (watch syncs and imported FIT files)" : "COROS Training Hub (cloud)",
    training_hub: trainingHub,
    coros_mcp: corosMcp,
    watch,
    newest_activity: newest,
    ...(lastWatchSync ? { last_watch_sync: lastWatchSync } : {}),
    recent_sync_errors: input.syncErrors
      .slice()
      .reverse()
      .map((error) => ({
        when: ago(error.at, now) ?? error.at,
        where: sourceLabel(error.source),
        message: error.message,
        ...(error.count && error.count > 1 ? { repeats: error.count } : {})
      })),
    guidance
  };
}

/** Two lines for the Coach's context on every turn; get_athlete_context has the rest. */
export function formatDataStatusForContext(status: CoachDataStatus): string {
  const parts = [
    `Data mode: ${status.data_mode}`,
    `newest activity: ${status.newest_activity ?? "none found"}`,
    status.last_watch_sync ? `last watch sync: ${status.last_watch_sync}` : `Training Hub: ${status.training_hub}`,
    `watch: ${status.watch}`
  ];
  const errors = status.recent_sync_errors.length
    ? ` ${status.recent_sync_errors.length} recent sync error${status.recent_sync_errors.length === 1 ? "" : "s"} (latest: ${status.recent_sync_errors[0]!.where}: ${status.recent_sync_errors[0]!.message}).`
    : "";
  return `${parts.join("; ")}.${errors}\n${status.guidance}`;
}
