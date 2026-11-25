"use client";
import { useSyncExternalStore } from "react";

/**
 * A typed value saved in this browser (localStorage), shared live between components and tabs.
 * This is where desk logging lives until the phone-sync server exists: nothing here leaves the browser.
 */
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(cb: () => void): () => void;
  /** True once something has been saved under this key. */
  hasSaved(): boolean;
  clear(): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createStore<T>(key: string, initial: T, storage: () => StorageLike | null = browserStorage): Store<T> {
  const fullKey = `clink.${key}`;
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached: T = initial;

  const read = (): T => {
    const s = storage();
    if (!s) return cached;
    let raw: string | null = null;
    try { raw = s.getItem(fullKey); } catch { return cached; }
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (raw == null) { cached = initial; return cached; }
    try { cached = JSON.parse(raw) as T; } catch { cached = initial; }
    return cached;
  };

  const emit = () => listeners.forEach((l) => l());

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => { if (e.key === fullKey) emit(); });
  }

  return {
    get: read,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(read()) : next;
      const raw = JSON.stringify(value);
      cached = value;
      cachedRaw = raw;
      try { storage()?.setItem(fullKey, raw); } catch {}
      emit();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    hasSaved() {
      try { return storage()?.getItem(fullKey) != null; } catch { return false; }
    },
    clear() {
      cached = initial;
      cachedRaw = null;
      try { storage()?.removeItem(fullKey); } catch {}
      emit();
    },
  };
}

/** Live value of a store. Renders `initial` on the server and for the first client paint. */
export function useStore<T>(store: Store<T>, initial: T): T {
  return useSyncExternalStore(store.subscribe, store.get, () => initial);
}
