import { getLocale, t } from "../i18n/tools";
import type { WatchSyncProgress } from "../../electron/localSync/localDataTypes";

/** A part of a sync that didn't work: one short line each, and what the user can do about it. */
export interface SyncIssue {
  part: "health" | "calendar" | "satellite" | "activities";
  text: string;
  /** The watch holds a plan CorosLink didn't put there; replacing it needs the user's agreement. */
  foreignPlan?: boolean;
}

/** The time of an earlier sync: just the time today, else the weekday too. */
function syncTime(ms: number): string {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(getLocale(), sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** One line: "Synced · 2 new activities", with the time for a sync that ran in the background. */
export function syncHeadline(result: WatchSyncProgress, automaticAt?: number): string {
  const synced = automaticAt === undefined ? t("Synced") : t("Synced at {{p0}}", { p0: syncTime(automaticAt) });
  const found = !result.newActivities ? t("no new activities")
    : result.newActivities === 1 ? t("1 new activity")
    : t("{{p0}} new activities", { p0: result.newActivities });
  return `${synced} · ${found}`;
}

/** What didn't work, part by part. A calendar with nothing new to send is not an issue. */
export function syncIssues(result: WatchSyncProgress): SyncIssue[] {
  const issues: SyncIssue[] = [];
  if (result.health && !result.health.ok) issues.push({ part: "health", text: t("Health data wasn't read.") });
  const calendar = result.calendar;
  if (calendar?.foreignPlan) issues.push({ part: "calendar", text: t("The watch has a training plan from the COROS app."), foreignPlan: true });
  else if (calendar && !calendar.ok) issues.push({ part: "calendar", text: t("The training calendar wasn't sent.") });
  // Workouts the watch's calendar can't take were left off; the rest went.
  const skipped = calendar?.ok ? calendar.skipped : undefined;
  const zoneTargets = skipped?.zoneTargets ?? 0;
  if (zoneTargets) issues.push({ part: "calendar", text: zoneTargets === 1 ? t("1 workout wasn't put on the watch: it uses zone or % targets.")
    : t("{{p0}} workouts weren't put on the watch: they use zone or % targets.", { p0: zoneTargets }) });
  const others = (skipped?.invalid ?? 0) + (skipped?.perDay ?? 0) + (skipped?.fileSize ?? 0);
  if (others) issues.push({ part: "calendar", text: others === 1 ? t("1 workout wasn't put on the watch.") : t("{{p0}} workouts weren't put on the watch.", { p0: others }) });
  // A partial update (the main file went, a later one didn't) still updated the watch: a warning only when nothing was sent.
  if (result.satellite && !result.satellite.ok && !result.satellite.files) issues.push({ part: "satellite", text: t("GPS satellite data wasn't updated.") });
  if (result.undecodedPayloads) issues.push({ part: "activities", text: t("Some activities can't be shown yet.") });
  return issues;
}

/** A sync that stopped: what to do, without the transfer details (those stay in Diagnostics). */
export function syncFailure(error: string, automaticAt?: number): string {
  if (automaticAt !== undefined) return t("Automatic sync at {{p0}} didn't reach the watch.", { p0: syncTime(automaticAt) });
  if (/already running|watch sync to finish/i.test(error)) return t("A sync is already running.");
  // Another Bluetooth job (a watch face, music, a map) has the watch.
  if (/^Wait for /.test(error)) return t("The watch is busy. Try again in a moment.");
  return t("Sync stopped. Keep the watch close and try again.");
}
