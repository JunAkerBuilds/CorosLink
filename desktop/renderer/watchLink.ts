// Local mode's watch (desktop/main/watch/service.ts) as the Watch page reads and drives it.
import { useEffect, useState, useSyncExternalStore } from "react";
import { language, locale, t } from "@/lib/i18n";

export type Region = "us" | "eu" | "sg" | "cn";
export interface Found { name: string; display: string; rssi?: number; connected?: boolean }
export interface WatchInfo { name: string; display: string; model?: string; firmware?: string; battery?: number; features?: string[] }
export interface LastSync { at: string; workouts: number; healthDays: number; nights: number; newActivities: number; applied: number; refused: number; problems: string[] }
export interface WatchStatus {
  localMode: boolean;
  /** Whether the watch helper is here (a Mac with it built). */
  available: boolean;
  bluetooth: string;
  keySaved: boolean;
  account: string | null;
  paired: { name: string; display: string; model?: string; pairedAt: string } | null;
  connected: WatchInfo | null;
  busy: null | "scanning" | "signingIn" | "connecting" | "syncing" | "installing";
  step: { step: string; percent?: number } | null;
  found: Found[];
  lastSync: LastSync | null;
  autoSyncMinutes: number;
  problem: string | null;
  onComputer: { activities: number; healthDays: number; nights: number } | null;
  weather: { latitude: number; longitude: number; city: string } | null;
  weatherSentAt: string | null;
}

export class WatchLinkProblem extends Error {}

/** Auto-sync choices, in hours; 0 is off. */
/** Auto-sync choices in minutes; 0 is off (main: watch/service.ts AUTO_SYNC_MINUTES). */
export const AUTO_SYNC = [0, 5, 10, 15, 30, 45, 60] as const;
export const autoSyncLabel = (m: number) => (m === 0 ? t("Off") : m < 60 ? t("Every {n} min", { n: m }) : t("Every hour"));

async function call(path: string, body?: object): Promise<WatchStatus> {
  const answer = await fetch(`/api/desktop/watch${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const parsed = (await answer.json().catch(() => ({}))) as WatchStatus & { error?: { message: string } };
  if (!answer.ok || parsed.error) throw new WatchLinkProblem(parsed.error?.message ?? t("That didn't work."));
  publish(parsed);
  return parsed;
}

// One status for every part of the page; whoever reads or changes it updates the rest.
let current: WatchStatus | null = null;
const listeners = new Set<() => void>();
function publish(next: WatchStatus) { current = next; for (const l of listeners) l(); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const readWatchLink = () => call("");
export const watchSignIn = (email: string, password: string, region: Region, takeOver = false) => call("/signin", { email, password, region, takeOver });
export const scanWatches = () => call("/scan", {});
export const pairWatch = (name: string) => call("/pair", { name });
export const syncWatch = () => call("/sync", {});
export const cancelWatch = () => call("/cancel", {});
export const disconnectWatch = () => call("/disconnect", {});
export const unpairWatch = () => call("/unpair", {});
export const forgetWatchKey = () => call("/forget-key", {});
export const setAutoSync = (minutes: number) => call("/autosync", { minutes });

/** The status, read now and again every few seconds (every second while the watch is busy). */
export function useWatchLink(): WatchStatus | null {
  const status = useSyncExternalStore(subscribe, () => current);
  const busy = !!status?.busy;
  useEffect(() => {
    let live = true;
    const read = () => { if (live) readWatchLink().catch(() => undefined); };
    read();
    const timer = setInterval(read, busy ? 1000 : 5000);
    return () => { live = false; clearInterval(timer); };
  }, [busy]);
  return status;
}

/** "just now", "12 min ago", "today 10:42", "24 Nov". */
export function whenSynced(iso: string, now = Date.now()): string {
  const at = Date.parse(iso), minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  const d = new Date(at), today = new Date(now);
  const tag = language() === "en" ? undefined : locale();
  const time = d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === today.toDateString()) return t("today at {time}", { time });
  return t("{date} at {time}", { date: d.toLocaleDateString(tag, { day: "numeric", month: "short" }), time });
}

/** What a sync step is called while it runs. */
export function stepLabel(step: { step: string; percent?: number } | null): string {
  const names: Record<string, string> = {
    searching: t("Looking for the watch"), reaching: t("Reaching the watch"), discovering: t("Connecting"), readingInfo: t("Connecting"),
    subscribing: t("Connecting"), signingIn: t("Signing in to the watch"), changes: t("Sending your changes"), steps: t("Reading today"),
    health: t("Reading health and sleep"), settings: t("Reading settings"), profile: t("Reading settings"), goals: t("Reading goals"),
    alarms: t("Reading alarms"), storage: t("Reading storage"), workouts: t("Reading workouts"), weather: t("Sending the weather"), face: t("Sending the face"),
  };
  if (!step) return t("Syncing");
  return names[step.step] ?? t("Syncing");
}

/** A tiny shared clock so "12 min ago" moves on. */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}

/* ── The watch's own settings (Local mode): read from and written to the watch, each answer what it kept. ── */

export interface WatchSwitch { key: string; value: number; values: Record<string, string>; edit?: number[] }
export type ZoneType = "maxHR" | "reserve" | "threshold";
export interface WatchProfile {
  maxHR: number; restingHR: number; thresholdHR: number; zoneType: ZoneType;
  /** ms per km. */
  thresholdPace: number; ftp: number; criticalPower: number;
  /** The five bounds between the six heart-rate zones the watch uses, bpm. */
  zones: number[];
}
/** Minutes after midnight. */
export interface SleepTimes { bedtime: number; wake: number }
export interface WatchOwnSettings { switches?: WatchSwitch[]; profile?: WatchProfile; sleep?: SleepTimes | null; problems?: string[] }

async function watchCall<T>(path: string, body?: object): Promise<T> {
  const answer = await fetch(`/api/desktop/watch${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const parsed = (await answer.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!answer.ok || parsed.error) throw new WatchLinkProblem(parsed.error?.message ?? t("That didn't work."));
  return parsed;
}

export const readWatchSettings = () => watchCall<WatchOwnSettings>("/settings");
export const setWatchSwitch = (key: string, value: number) => watchCall<{ switches: WatchSwitch[] }>("/setting", { key, value });
export const setWatchProfile = (edits: Partial<Pick<WatchProfile, "maxHR" | "restingHR" | "thresholdHR" | "thresholdPace" | "zoneType">>) =>
  watchCall<{ profile: WatchProfile }>("/profile", edits);
export const setSleepTimes = (times: SleepTimes) => watchCall<{ sleep: SleepTimes | null }>("/sleep", times);
export const ringWatch = () => watchCall<{ status: number }>("/ring", {});

/** The watch's face slots (Local mode), and putting one on screen. */
export interface WatchFaces { slots: { slot: number; faceId?: number }[]; shown: number | null; installed?: number }
export const readWatchFaces = () => watchCall<WatchFaces>("/faces");
export const showWatchFace = (slot: number, faceId: number) => watchCall<WatchFaces>("/faces/show", { slot, faceId });

/** Where the watch's weather is for, as Local mode keeps it. */
export interface WeatherPlace { latitude: number; longitude: number; city: string }
export const setWeatherPlace = (place: WeatherPlace | null) => call("/weather", { place });
export const sendWeatherNow = () => call("/weather/send", {});
export interface FoundPlace extends WeatherPlace { region: string }
export const findPlaces = (q: string) => watchCall<{ places: FoundPlace[] }>(`/places?q=${encodeURIComponent(q)}`).then((b) => b.places);
