"use client";
import { createStore } from "./store";
import { SAMPLE_PENDING } from "../sample/watch";
import { queueChange, undoChange, type Json, type PendingChange } from "@/lib/watch";

/**
 * Watch settings changed here, waiting for the phone app to carry them to the watch.
 * Until the sync server exists they only live in this browser.
 */
export const WATCH_PENDING_INITIAL: PendingChange[] = SAMPLE_PENDING;

export const watchPendingStore = createStore<PendingChange[]>("watch.pending.v1", WATCH_PENDING_INITIAL);

/** `original` is what the watch has now; going back to it removes the waiting change. */
export function setPending(key: string, original: Json, next: Json): void {
  watchPendingStore.set((q) => queueChange(q, key, original, next, Date.now()));
}

export function undoPending(key: string): void {
  watchPendingStore.set((q) => undoChange(q, key));
}

/** Drops every waiting change. (Not `clear()`: that would bring the sample's waiting alarm back.) */
export function discardPending(): void {
  watchPendingStore.set([]);
}

export function newAlarmId(): string {
  return `web-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
