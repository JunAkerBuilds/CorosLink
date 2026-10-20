import { useSyncExternalStore } from "react";

/**
 * Whether the app runs in Local-Only Mode, for views deep in the tree whose
 * wording changes with it (workouts saved on this computer instead of COROS).
 * App sets it from the data-mode status.
 */
let localOnly = Boolean(typeof window !== "undefined" && window.corosLink?.localOnlyAtLaunch);
const listeners = new Set<() => void>();

export function setLocalOnlyView(value: boolean) {
  if (value === localOnly) return;
  localOnly = value;
  for (const listener of listeners) listener();
}

export function useLocalOnlyView(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => localOnly
  );
}
