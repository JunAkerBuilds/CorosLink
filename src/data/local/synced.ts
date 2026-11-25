"use client";
// A list kept as synced items in the store on this computer (desktop/main/localStore.ts), one item per entry, behind
// the same synchronous `Store` the screens already use (store.ts). Plans and workouts were kept in the page's own
// storage before; there they didn't reach backups or the phone and went if that storage was cleared.
import { canonical } from "@/data/sync/canonical";
import { peekItems, put, remove, subscribeSync, syncLoaded, syncRevision } from "@/data/sync/engine";
import type { Collection, SyncBodies } from "@/data/sync/native";
import type { Store } from "./store";

/** The store refuses a request with an item past 256 KB, and that would hold every edit after it. */
export const MAX_ITEM_CHARS = 250_000;

export interface SyncedBackend {
  loaded(): boolean;
  items(collection: Collection): { id: string; body: unknown }[];
  put(collection: Collection, id: string, body: unknown): void;
  remove(collection: Collection, id: string): void;
  subscribe(cb: () => void): () => void;
  revision(): number;
}

const engine: SyncedBackend = {
  loaded: syncLoaded,
  items: (c) => peekItems(c),
  put: (c, id, body) => put(c, id, body as SyncBodies[typeof c]),
  remove,
  subscribe: subscribeSync,
  revision: syncRevision,
};

export class TooLargeError extends Error {
  constructor(what: string) {
    super(`“${what}” is too large to save. Split it into smaller pieces.`);
    this.name = "TooLargeError";
  }
}

/**
 * `collection`'s items as a list. Setting the list writes what changed: new and edited entries are put, missing ones
 * removed. `clean` drops anything that isn't an entry. Writing before the store is loaded throws, like every edit.
 */
export function syncedList<T extends { id: string; name?: string }>(collection: Collection, clean: (list: unknown) => T[], backend: SyncedBackend = engine): Store<T[]> {
  let memo: { revision: number; list: T[] } | null = null;
  const read = (): T[] => {
    const revision = backend.revision();
    if (memo && memo.revision === revision) return memo.list;
    const list = clean(backend.items(collection).map((i) => i.body));
    memo = { revision, list };
    return list;
  };
  return {
    get: read,
    set(next) {
      const before = read();
      const after = clean(typeof next === "function" ? (next as (prev: T[]) => T[])(before) : next);
      const had = new Map(before.map((e) => [e.id, canonical(e)]));
      const keep = new Set(after.map((e) => e.id));
      for (const entry of after) {
        const text = canonical(entry);
        if (had.get(entry.id) === text) continue;
        if (text.length > MAX_ITEM_CHARS) throw new TooLargeError(entry.name ?? "This");
        backend.put(collection, entry.id, entry);
      }
      for (const id of had.keys()) if (!keep.has(id)) backend.remove(collection, id);
    },
    subscribe: backend.subscribe,
    hasSaved: () => backend.loaded() && read().length > 0,
    clear() { for (const entry of read()) backend.remove(collection, entry.id); },
  };
}
