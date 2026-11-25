"use client";
import { useCallback, useEffect, useState } from "react";
import { useSyncRevision } from "@/data/sync/engine";

/**
 * Where a piece of data came from.
 * - "sample": the built-in sample athlete. Screens showing it must say so (OriginBadge).
 * - "browser": something the person logged or planned here, saved in this browser only.
 * - "coros": the person's own COROS account, through Training Hub.
 * - "synced": the person's own data, in the store on this computer: what the phone synced to it, and edits made here.
 */
export type Origin = "sample" | "browser" | "coros" | "synced";

export interface Loaded<T> {
  data: T;
  origin: Origin;
}

export const fromSample = <T,>(data: T): Loaded<T> => ({ data, origin: "sample" });
export const fromBrowser = <T,>(data: T): Loaded<T> => ({ data, origin: "browser" });
export const fromCoros = <T,>(data: T): Loaded<T> => ({ data, origin: "coros" });
export const fromSynced = <T,>(data: T): Loaded<T> => ({ data, origin: "synced" });

/** Thrown by a part of the data layer that has no server behind it yet. Never swallowed: the UI shows it. */
export class NotWiredError extends Error {
  constructor(public readonly feature: string, detail: string) {
    super(detail);
    this.name = "NotWiredError";
  }
}

export type LoadState<T> =
  | { status: "loading"; data?: undefined; origin?: undefined; error?: undefined }
  | { status: "ready"; data: T; origin: Origin; error?: undefined }
  | { status: "error"; data?: undefined; origin?: undefined; error: Error };

/**
 * Runs an async loader from the data layer and tracks its state. `key` re-runs it when it changes, and so does
 * every change to the synced items (a pull that brought something, an edit made here), without a loading flash.
 */
export function useLoaded<T>(loader: () => Promise<Loaded<T>>, key: string = ""): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const synced = useSyncRevision();
  useEffect(() => {
    let live = true;
    loader().then(
      (r) => { if (live) setState({ status: "ready", data: r.data, origin: r.origin }); },
      (e) => { if (live) setState({ status: "error", error: e instanceof Error ? e : new Error(String(e)) }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, synced]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** The sample athlete's "today". Sample screens are dated around it. */
export const SAMPLE_TODAY = new Date(2026, 10, 19);
