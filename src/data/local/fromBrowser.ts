"use client";
// Plans and workouts used to be kept in the page's own storage (`clink.plans.v1`, `clink.workouts.v1`,
// `clink.workout-library.v1`). Once the store is loaded, whatever is still there moves into the store
// (synced.ts) and the old value is removed, so it's read once and never written again.
import { cleanPlans, planStore } from "./plans";
import type { Store, StorageLike } from "./store";
import { cleanWorkouts, libraryStore, workoutStore } from "./workouts";

type Entry = { id: string; name?: string };
interface Old { key: string; store: Store<Entry[]>; clean: (list: unknown) => Entry[]; same?: (a: Entry, b: Entry) => boolean }

const OLD: Old[] = [
  { key: "clink.plans.v1", store: planStore as unknown as Store<Entry[]>, clean: cleanPlans },
  { key: "clink.workouts.v1", store: workoutStore as unknown as Store<Entry[]>, clean: cleanWorkouts },
  // The library keeps one workout per name.
  { key: "clink.workout-library.v1", store: libraryStore as unknown as Store<Entry[]>, clean: (l) => (Array.isArray(l) ? cleanWorkouts(l.map((w) => ({ date: "", ...(w as object) }))) : []), same: (a, b) => a.name === b.name },
];

function pageStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** Moves what the page still keeps into the store. Returns how many entries moved. Call once the store is loaded. */
export function moveFromBrowser(storage: StorageLike | null = pageStorage()): number {
  if (!storage) return 0;
  let moved = 0;
  for (const old of OLD) {
    let raw: string | null = null;
    try { raw = storage.getItem(old.key); } catch { continue; }
    if (raw == null) continue;
    let list: unknown = [];
    try { list = JSON.parse(raw); } catch { /* unreadable: nothing to move */ }
    const entries = old.clean(list);
    const have = old.store.get();
    const fresh = entries.filter((e) => !have.some((h) => h.id === e.id || (old.same?.(h, e) ?? false)));
    // One that can't be saved (too large) leaves the old value where it is, for the next start.
    try { if (fresh.length) old.store.set((prev) => [...prev, ...fresh]); } catch { continue; }
    moved += fresh.length;
    try { storage.removeItem(old.key); } catch { /* left for the next start */ }
  }
  return moved;
}
