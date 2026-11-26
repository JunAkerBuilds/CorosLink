"use client";
// Hevy in the browser. The API key is typed once on Connections and sent to this app's server, which checks it
// with Hevy and keeps it in a sealed httpOnly cookie: this code never sees it again.
//
// Where the workouts are kept: the last year of completed workouts, cut down to what Strength uses, in this
// browser's IndexedDB under the signed-in person's id (the same store the phone-sync copy uses, so signing out
// of C-LINK clears it). "Disconnect and erase cache" deletes that entry, the warm-up setting and the cookie.
// Nothing from Hevy is written to the synced store, so the phone and Coach don't see it.
//
// When they refresh: after connecting (the whole year), on "Sync now", and when Strength or Connections opens
// and the last read is more than 15 minutes old (only what changed, from Hevy's list of changes).
import { useSyncExternalStore } from "react";
import { HubError } from "@/data/hub";
import { hubRequest } from "@/data/hubRequest";
import { createStore, useStore } from "@/data/local/store";
import { syncView } from "@/data/sync";
import { idbGet, idbSet } from "@/data/sync/idb";
import type { NativeGymWorkout } from "@/data/sync/native";
import { t } from "@/lib/i18n";
import {
  fullHevySync, hevyExerciseNames, hevyGymWorkout, incrementalHevySync, isHevyStale, needsFullSync,
  type HevyCache, type HevyEventsPage, type HevyReader, type HevyTemplatesPage, type HevyWorkoutsPage,
} from "@/lib/hevy";

export interface HevyStatus { connected: boolean; userId?: string; name?: string; profileUrl?: string; mock?: true }

/** What Connections and Strength show of the connection. */
export interface HevyView {
  /** `checking` until this app's server has said whether a key is saved. */
  read: "checking" | "known" | "failed";
  status: HevyStatus | null;
  /** Why the status couldn't be read. */
  problem: string | null;
  syncing: boolean;
  /** Workouts or changes read so far in the running sync. */
  progress: number | null;
  /** Why the last sync failed; null when it worked or none has run. */
  syncProblem: string | null;
  /** When the cached workouts were last brought up to date (ms); null when nothing is cached. */
  lastSyncedAt: number | null;
  /** How many workouts are cached. */
  workouts: number | null;
  /** Goes up whenever the cached workouts or the warm-up setting change, so Strength reads them again. */
  revision: number;
}

const START: HevyView = { read: "checking", status: null, problem: null, syncing: false, progress: null, syncProblem: null, lastSyncedAt: null, workouts: null, revision: 0 };
let view: HevyView = START;
const listeners = new Set<() => void>();
function set(patch: Partial<HevyView>): void {
  view = { ...view, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useHevy(): HevyView {
  return useSyncExternalStore(subscribe, () => view, () => START);
}

/** "Include warm-up sets": off unless switched on, as on the desktop. Kept in this browser. */
const warmupsStore = createStore<boolean>("hevy.includeWarmups", false);
export const useHevyWarmups = (): boolean => useStore(warmupsStore, false) === true;
export function setHevyWarmups(on: boolean): void {
  warmupsStore.set(on);
  set({ revision: view.revision + 1 });
}

const said = (error: unknown): string => (error instanceof HubError ? error.message : "C-LINK couldn't finish that. Try again.");

/* ───────────── The cached workouts ───────────── */

const cacheKey = (viewerId: string): string => `hevy:v1:${viewerId}`;
/** The copy in memory, for a browser whose IndexedDB refuses. */
let memory: { viewerId: string; cache: HevyCache | null } | null = null;

async function viewerId(): Promise<string | null> {
  return (await syncView())?.viewer.id ?? null;
}

async function readCache(viewer: string): Promise<HevyCache | null> {
  if (memory?.viewerId === viewer) return memory.cache;
  const found = await idbGet<HevyCache>(cacheKey(viewer));
  const cache = found && found.v === 1 && Array.isArray(found.workouts) ? found : null;
  memory = { viewerId: viewer, cache };
  return cache;
}

async function writeCache(viewer: string, cache: HevyCache | null): Promise<void> {
  memory = { viewerId: viewer, cache };
  // IndexedDB has no delete in this app's helper: an erased cache is stored as null.
  await idbSet(cacheKey(viewer), cache);
  set({ lastSyncedAt: cache?.lastSyncedAt ?? null, workouts: cache ? cache.workouts.length : null, revision: view.revision + 1 });
}

/* ───────────── Reading from Hevy, through this app's server ───────────── */

/** Every answer says whose workouts they are: a key changed in another tab mid-sync stops the sync. */
function reader(userId: string): HevyReader {
  const check = <T extends { userId: string }>(answer: T): T => {
    if (answer.userId !== userId) throw new HubError("invalid", t("The Hevy connection changed while syncing. Sync again."));
    return answer;
  };
  return {
    workouts: async (page) => check(await hubRequest<HevyWorkoutsPage & { userId: string }>(`hevy/workouts?page=${page}`)),
    events: async (since, page) => check(await hubRequest<HevyEventsPage & { userId: string }>(`hevy/events?since=${encodeURIComponent(since)}&page=${page}`)),
    templates: async (page) => check(await hubRequest<HevyTemplatesPage & { userId: string }>(`hevy/templates?page=${page}`)),
  };
}

let running: Promise<void> | null = null;

async function sync(force: boolean): Promise<void> {
  const viewer = await viewerId();
  const status = view.status;
  if (!viewer || !status?.connected || !status.userId) return;
  let cache = await readCache(viewer);
  // Another Hevy account's workouts are never shown under this one.
  if (cache && cache.userId !== status.userId) { await writeCache(viewer, null); cache = null; }
  const now = new Date();
  const full = needsFullSync(cache, status.userId, now);
  if (!force && !full && !isHevyStale(cache, now.getTime())) return;
  set({ syncing: true, progress: null, syncProblem: null });
  try {
    const onProgress = (read: number) => set({ progress: read });
    const next = full || !cache
      ? await fullHevySync(reader(status.userId), status.userId, now, onProgress)
      : await incrementalHevySync(cache, reader(status.userId), now, onProgress);
    // Disconnected while the pages were coming in: nothing is kept.
    if (view.status?.connected && view.status.userId === status.userId) await writeCache(viewer, next);
    set({ syncing: false, progress: null });
  } catch (error) {
    set({ syncing: false, progress: null, syncProblem: said(error) });
    throw error;
  }
}

function runSync(force: boolean): Promise<void> {
  running ??= sync(force).finally(() => { running = null; });
  return running;
}

/** "Sync now": reads what changed in Hevy (the whole year when nothing is cached yet). Rejects with why it couldn't. */
export const syncHevyNow = (): Promise<void> => runSync(true);

let opening: Promise<void> | null = null;

/**
 * Called when Strength or Connections opens: asks this app's server whether a key is saved, shows what is
 * cached, and reads Hevy's changes when the cache is more than 15 minutes old. Never throws: what went wrong
 * is in the view (`problem`, `syncProblem`).
 */
export function openHevy(): Promise<void> {
  opening ??= (async () => {
    try {
      const status = await hubRequest<HevyStatus>("hevy");
      const viewer = await viewerId();
      let cache = viewer ? await readCache(viewer) : null;
      // The key is gone (it ran out, or was dropped elsewhere): what it fetched goes too.
      if (viewer && cache && !status.connected) { await writeCache(viewer, null); cache = null; }
      set({ read: "known", status, problem: null, lastSyncedAt: cache?.lastSyncedAt ?? null, workouts: cache ? cache.workouts.length : null });
      if (status.connected) await runSync(false).catch(() => {});
    } catch (error) {
      set({ read: view.status ? "known" : "failed", problem: said(error) });
    }
  })().finally(() => { opening = null; });
  return opening;
}

// Hevy was connected or disconnected on the phone or in another browser: ask again, once a screen has asked before.
if (typeof window !== "undefined") {
  window.addEventListener("clink:connections", (event) => {
    const ids = (event as CustomEvent<string[]>).detail;
    if (view.read !== "checking" && Array.isArray(ids) && ids.includes("hevy")) void openHevy();
  });
}

/** Checks the key with Hevy, saves it sealed on the server, then starts reading the last year. */
export async function connectHevy(apiKey: string): Promise<void> {
  const status = await hubRequest<HevyStatus>("hevy", { method: "POST", body: { apiKey: apiKey.trim() } });
  set({ read: "known", status, problem: null, syncProblem: null });
  void runSync(true).catch(() => {});
}

/** "Disconnect and erase cache": the sealed key, the cached workouts and the warm-up setting all go. */
export async function disconnectHevy(): Promise<void> {
  const status = await hubRequest<HevyStatus>("hevy", { method: "DELETE" });
  set({ read: "known", status, problem: null, syncProblem: null, syncing: false, progress: null });
  const viewer = await viewerId();
  if (viewer) await writeCache(viewer, null);
  else memory = null;
  warmupsStore.clear();
}

/* ───────────── For Strength ───────────── */

export interface HevyForStrength { workouts: NativeGymWorkout[]; names: Record<string, string> }

/** The cached Hevy workouts as gym-log workouts, or null when none are cached for this person. */
export async function hevyForStrength(viewer: string): Promise<HevyForStrength | null> {
  const cache = await readCache(viewer);
  if (!cache || !cache.workouts.length) return null;
  const assisted = new Set(cache.assisted), includeWarmups = warmupsStore.get() === true;
  return { workouts: cache.workouts.map((w) => hevyGymWorkout(w, assisted, includeWarmups)), names: hevyExerciseNames(cache.workouts) };
}
