import { useEffect, useSyncExternalStore } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import { ipcErrorText } from "../ipcErrorText";
import type { WatchSyncProgress } from "../../electron/localSync/localDataTypes";
import type { WatchAutoSyncState } from "../../electron/watchAutoSyncService";

/**
 * The watch sync as the whole window sees it: whether one is running, how far it got, and how the
 * last one ended. It lives outside the watch menu so closing the menu mid-sync loses nothing, and a
 * background (automatic) sync reports here too.
 */
export type LastWatchSync =
  | { ok: true; result: WatchSyncProgress; at: number; automatic: boolean }
  | { ok: false; error: string; at: number; automatic: boolean };

export interface WatchSyncView {
  /** A sync started from this window is running (it may still be connecting). */
  manual: boolean;
  /** Any sync is reading from the watch, including an automatic one. */
  reading: boolean;
  /** How much of the activity file has been read, while that is known. */
  percent: number | null;
  last: LastWatchSync | null;
}

const EMPTY: WatchSyncView = { manual: false, reading: false, percent: null, last: null };
let view: WatchSyncView = EMPTY;
const listeners = new Set<() => void>();

function update(next: Partial<WatchSyncView>): void {
  view = { ...view, ...next };
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A newer result replaces the shown one; an older one (an automatic run that started earlier) doesn't. */
function record(last: LastWatchSync): void {
  if (view.last && view.last.at > last.at) return;
  update({ last });
}

const ACTIVE = new Set<WatchSyncProgress["state"]>(["connecting", "reading", "saving", "decoding"]);

function onProgress(progress: WatchSyncProgress): void {
  const reading = ACTIVE.has(progress.state);
  const percent = progress.state === "reading" && progress.totalBytes
    ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : null;
  update({ reading, percent: reading ? percent : null });
}

/** The last automatic run, as a result: what it found, or that it didn't reach the watch. */
function onAutoSync(state: WatchAutoSyncState): void {
  // With automatic sync off, an old background result is no news.
  if (!state.enabled || state.lastAttemptAt === undefined) return;
  if (state.lastSuccessAt !== undefined && state.lastSuccessAt >= state.lastAttemptAt) {
    const result: WatchSyncProgress = { state: "done", receivedBytes: 0, undecodedPayloads: 0, ...state.lastResult, newActivities: state.lastResult?.newActivities ?? 0 };
    record({ ok: true, result, at: state.lastSuccessAt, automatic: true });
  } else {
    record({ ok: false, error: state.lastError ?? "", at: state.lastAttemptAt, automatic: true });
  }
}

let tracked: CorosLinkApi | null = null;
let trackers = 0;
let stopTracking: (() => void) | null = null;

/** Listens for sync progress and automatic-sync results while anything shows them. */
function track(api: CorosLinkApi): () => void {
  if (tracked !== api) {
    stopTracking?.();
    tracked = api;
    let live = true;
    const offProgress = typeof api.onWatchSyncProgress === "function" ? api.onWatchSyncProgress(onProgress) : () => undefined;
    const offAuto = typeof api.onWatchAutoSyncChange === "function" ? api.onWatchAutoSyncChange(onAutoSync) : () => undefined;
    if (typeof api.getWatchSyncProgress === "function") void api.getWatchSyncProgress().then(progress => { if (live) onProgress(progress); }).catch(() => undefined);
    if (typeof api.getWatchAutoSync === "function") void api.getWatchAutoSync().then(state => { if (live) onAutoSync(state); }).catch(() => undefined);
    stopTracking = () => { live = false; offProgress(); offAuto(); tracked = null; stopTracking = null; };
  }
  trackers += 1;
  return () => {
    trackers -= 1;
    if (trackers === 0) stopTracking?.();
  };
}

/** The window's watch sync; pass the API to keep it up to date while the component is mounted. */
export function useWatchSync(api?: CorosLinkApi): WatchSyncView {
  useEffect(() => (api ? track(api) : undefined), [api]);
  return useSyncExternalStore(subscribe, () => view);
}

/**
 * "Sync watch now": `connect` first when given (it resolves false when the watch needs the user, and
 * throws when it can't be reached; that error is the caller's to show). How the sync ended is kept
 * here, so it outlives whatever started it.
 */
export async function runWatchSync(api: CorosLinkApi, connect?: () => Promise<boolean>): Promise<void> {
  if (view.manual) return;
  update({ manual: true, percent: null });
  let last: LastWatchSync | null = null;
  try {
    if (connect && !await connect()) return;
    try {
      last = { ok: true, result: await api.syncWatchLocally(), at: Date.now(), automatic: false };
    } catch (error) {
      last = { ok: false, error: ipcErrorText(error), at: Date.now(), automatic: false };
    }
  } finally {
    update({ manual: false, reading: false, percent: null });
    if (last) record(last);
  }
}

