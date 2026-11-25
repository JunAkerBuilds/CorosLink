"use client";
// The screens' side of sync (docs/sync-contract.md section 3): the store on this computer the app is signed in to,
// a cached copy of its items, and the passes that keep it current. A pass pulls every page, then pushes the
// edits made here. Passes run on load, on focus, every 15 s while the tab is visible and right after an edit.
// Edits show at once and stay marked unsent until the server confirms them: nothing here reports a save it
// did not get.
import { useSyncExternalStore } from "react";
import { idbGet, idbSet } from "./idb";
import type { Collection, SyncBodies } from "./native";
import {
  applyEdit, applyPull, applyPushed, baseOf, batches, emptyState, visible, visibleOne,
  type PullPage, type PushResult, type SyncState, type Unsent,
} from "./state";

export interface Viewer { id: string; handle: string; displayName: string; avatarUrl: string | null }

export interface SyncStatus {
  /** `checking` until the session is known; `ended` when the store stopped taking the session. */
  account: "checking" | "signedOut" | "signedIn" | "ended";
  viewer: Viewer | null;
  syncing: boolean;
  /** When the last pass finished without an error (ms), or null before the first. */
  lastSyncedAt: number | null;
  /** Why the last pass failed, in words for the person; null when it worked. */
  error: string | null;
  /** Edits made here that have not reached the store. */
  unsent: number;
  /** Live items in the store, from its status. */
  serverItems: number | null;
}

export interface SyncItem<C extends Collection> { id: string; version: number; body: SyncBodies[C] }

/** A consistent read of the person's items, unsent edits included. */
export interface SyncView {
  viewer: Viewer;
  all<C extends Collection>(collection: C): SyncItem<C>[];
  get<C extends Collection>(collection: C, id: string): SyncBodies[C] | undefined;
}

export class SyncError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0) {
    super(message);
    this.name = "SyncError";
  }
}

const INTERVAL_MS = 15_000;
const SAVE_DELAY_MS = 400;

let status: SyncStatus = { account: "checking", viewer: null, syncing: false, lastSyncedAt: null, error: null, unsent: 0, serverItems: null };
let state: SyncState = emptyState();
let revision = 0;
let ready: Promise<void> | null = null;
let running: Promise<void> | null = null;
let again = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next, unsent: Object.keys(state.unsent).length };
  emit();
}

/** Screens re-read when this moves. */
function bump(): void {
  revision += 1;
  setStatus({});
}

const cacheKey = (viewer: Viewer) => `v1:${viewer.id}`;

function saveSoon(): void {
  const viewer = status.viewer;
  if (!viewer) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void idbSet(cacheKey(viewer), state); }, SAVE_DELAY_MS);
}

async function call<T>(path: string, init?: { method: "POST"; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? "GET", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(init ? { "X-Clink-Hub": "1" } : {}), ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new SyncError("unreachable", "C-LINK couldn't be reached. Try again.");
  }
  let payload: unknown = null;
  try { payload = await response.json(); } catch {}
  if (response.ok && payload && typeof payload === "object") return payload as T;
  const error = (payload as { error?: { code?: unknown; message?: unknown } | string; code?: unknown } | null);
  const inner = error && typeof error.error === "object" ? error.error : null;
  const code = String(inner?.code ?? error?.code ?? (typeof error?.error === "string" ? error.error : "") ?? "") || `http_${response.status}`;
  throw new SyncError(code, WORDS[code] ?? (typeof inner?.message === "string" ? inner.message : `Sync didn't work (${response.status}).`), response.status);
}

const WORDS: Record<string, string> = {
  SYNC_QUOTA: "The data on this computer is full. Nothing more can be saved until some of it is removed.",
  SYNC_TOO_LARGE: "That was too much to save at once.",
  INVALID_SYNC: "That change couldn't be saved.",
  unreachable: "C-LINK couldn't be reached. Try again.",
};

interface StatusAnswer { items: number; bytes: number; updatedAt: string | null; cursor: number }

async function pass(): Promise<void> {
  const viewer = status.viewer;
  if (!viewer) return;
  setStatus({ syncing: true });
  try {
    const remote = await call<StatusAnswer>("/api/sync/status");
    if (status.viewer?.id !== viewer.id) return;
    let changed = false;
    if (remote.cursor < state.cursor) {
      // The store was wiped (or restored from a backup): forget what was cached and read it all again from 0.
      state = { ...emptyState(), unsent: state.unsent };
      changed = true;
    }
    while (remote.cursor > state.cursor) {
      const page = await call<PullPage>(`/api/sync?since=${state.cursor}&limit=500`);
      if (status.viewer?.id !== viewer.id) return;
      if (page.cursor < state.cursor) {
        // The same from a GET: a cursor lower than the saved one means the store was wiped meanwhile.
        state = { ...emptyState(), unsent: state.unsent };
        changed = true;
        continue;
      }
      if (page.hub) window.dispatchEvent(new Event("clink:hub"));
      if (page.connections?.length) window.dispatchEvent(new CustomEvent("clink:connections", { detail: page.connections }));
      const before = state.cursor;
      const applied = applyPull(state, page);
      state = applied.state;
      changed = changed || applied.changed;
      if (!page.more || state.cursor === before) break;
    }
    const waiting = Object.values(state.unsent);
    for (const batch of batches(waiting)) {
      const answer = await call<{ results: PushResult[] }>("/api/sync", {
        method: "POST",
        body: { changes: batch.map((e) => {
          const base = baseOf(state, e);
          return e.deleted ? { collection: e.collection, id: e.id, deleted: true, base } : { collection: e.collection, id: e.id, body: e.body, base };
        }) },
      });
      if (status.viewer?.id !== viewer.id) return;
      state = applyPushed(state, batch, answer.results ?? []);
      // Changed elsewhere since this browser read it: another pass reads that change, merges and sends again.
      if (answer.results?.some((r) => r.conflict)) again = true;
    }
    if (changed) revision += 1;
    saveSoon();
    setStatus({ syncing: false, error: null, lastSyncedAt: Date.now(), serverItems: waiting.length ? null : remote.items });
    if (waiting.length) void call<StatusAnswer>("/api/sync/status").then((s) => setStatus({ serverItems: s.items }), () => {});
  } catch (error) {
    if (error instanceof SyncError && error.status === 401) {
      // The store refused the session (its token changed); the route already dropped the cookie.
      state = emptyState();
      revision += 1;
      setStatus({ account: "ended", viewer: null, syncing: false, error: null });
      return;
    }
    setStatus({ syncing: false, error: error instanceof SyncError ? error.message : "Sync didn't work." });
    throw error;
  }
}

/** Runs one pass now, or right after the one in flight. Resolves when the data is as fresh as it gets. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  const run = pass().finally(() => {
    running = null;
    if (again) { again = false; void syncNow().catch(() => {}); }
  });
  running = run;
  return run;
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const quiet = () => { if (status.account === "signedIn" && document.visibilityState === "visible") void syncNow().catch(() => {}); };
  window.addEventListener("focus", quiet);
  document.addEventListener("visibilitychange", quiet);
  window.setInterval(quiet, INTERVAL_MS);
  window.addEventListener("online", quiet);
}

async function boot(): Promise<void> {
  const session = await call<{ viewer: Viewer | null }>("/api/account/session");
  if (!session.viewer) {
    setStatus({ account: status.account === "ended" ? "ended" : "signedOut", viewer: null });
    return;
  }
  const cached = await idbGet<SyncState>(cacheKey(session.viewer));
  state = cached && typeof cached.cursor === "number" && cached.items && cached.unsent ? cached : emptyState();
  status = { ...status, account: "signedIn", viewer: session.viewer };
  bump();
  start();
  // With a cached copy the screens draw at once and the pass freshens them; without one they wait for it.
  if (state.cursor > 0) void syncNow().catch(() => {});
  else await syncNow();
}

function ensureReady(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!ready) {
    ready = boot().catch((error) => {
      ready = null;
      // Not "signedOut": a failed check is not a missing session.
      if (status.account === "checking") setStatus({ error: error instanceof SyncError ? error.message : "C-LINK couldn't be reached." });
      throw error;
    });
  }
  return ready;
}

/** Under a minute, as the phone's `isBlip`: never listed, totalled or counted. */
export const isShortActivity = (a: { durationSeconds?: number }): boolean => a.durationSeconds != null && a.durationSeconds < 60;

function view(viewer: Viewer): SyncView {
  const snapshot = state;
  return {
    viewer,
    all: <C extends Collection>(collection: C) =>
      visible(snapshot, collection)
        // Phones before 2026-11-24 synced 10–59-second activities; they're left out here as the phone now leaves them out.
        .filter((i) => collection !== "activity" || !isShortActivity(i.body as SyncBodies["activity"]))
        .map((i) => ({ id: i.id, version: i.version, body: i.body as SyncBodies[C] })),
    get: <C extends Collection>(collection: C, id: string) => visibleOne(snapshot, collection, id)?.body as SyncBodies[C] | undefined,
  };
}

/**
 * The signed-in person's items, or null when nobody is signed in (loaders then keep the sample athlete).
 * Waits for the first pull on a fresh browser; throws when that pull fails and nothing is cached.
 */
export async function syncView(): Promise<SyncView | null> {
  if (typeof window === "undefined") return null;
  try {
    await ensureReady();
  } catch (error) {
    if (!status.viewer) {
      throw error;
    }
    throw new SyncError("first_pull", `The data on this computer couldn't be read. ${error instanceof Error ? error.message : ""}`.trim());
  }
  return status.viewer ? view(status.viewer) : null;
}

function edit(change: Omit<Unsent, "at">): void {
  if (!status.viewer) throw new SyncError("signed_out", "C-LINK is still starting. Try again in a moment.");
  state = applyEdit(state, { ...change, at: Date.now() + Math.random() });
  saveSoon();
  bump();
  void syncNow().catch(() => {});
}

/** Saves an item: shown at once, sent right away, retried by the next passes until the store has it. */
export function put<C extends Collection>(collection: C, id: string, body: SyncBodies[C]): void {
  edit({ collection, id, body });
}

export function remove(collection: Collection, id: string): void {
  edit({ collection, id, deleted: true });
}

const SERVER_STATUS: SyncStatus = { ...status };

/** The account and sync state, for the shell and the connect page. */
export function useSyncStatus(): SyncStatus {
  const value = useSyncExternalStore(subscribe, () => status, () => SERVER_STATUS);
  if (typeof window !== "undefined" && !ready) void ensureReady().catch(() => {});
  return value;
}

/** A number that moves whenever the items a screen reads may have changed. `useLoaded` re-runs loaders on it. */
export function useSyncRevision(): number {
  return useSyncExternalStore(subscribe, () => revision, () => 0);
}

const NONE: never[] = [];
const memo = new Map<string, { revision: number; items: unknown[] }>();

/** Live items of one collection; empty while signed out or before the first pull. */
export function useSyncItems<C extends Collection>(collection: C): SyncItem<C>[] {
  const read = (): SyncItem<C>[] => {
    if (!status.viewer) return NONE;
    const hit = memo.get(collection);
    if (hit && hit.revision === revision) return hit.items as SyncItem<C>[];
    const items = view(status.viewer).all(collection);
    memo.set(collection, { revision, items });
    return items;
  };
  const items = useSyncExternalStore(subscribe, read, () => NONE as SyncItem<C>[]);
  if (typeof window !== "undefined" && !ready) void ensureReady().catch(() => {});
  return items;
}

/** Whether the store's items are here to read (signed in, cache or first pull loaded). */
export const syncLoaded = (): boolean => !!status.viewer;

/** Items of one collection right now, without waiting; empty until loaded. For stores that keep a synchronous API (src/data/local/synced.ts). */
export function peekItems<C extends Collection>(collection: C): SyncItem<C>[] {
  return status.viewer ? view(status.viewer).all(collection) : (NONE as SyncItem<C>[]);
}

/** Calls `cb` whenever items may have changed; starts sync if it isn't yet. */
export function subscribeSync(cb: () => void): () => void {
  if (typeof window !== "undefined" && !ready) void ensureReady().catch(() => {});
  return subscribe(cb);
}

export const syncRevision = (): number => revision;

/** For tests and the dev console. */
export function syncDebug(): { state: SyncState; status: SyncStatus } {
  return { state, status };
}
