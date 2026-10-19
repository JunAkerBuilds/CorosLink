import { useSyncExternalStore } from "react";
import { PRIMARY_NAV_ITEMS, type PrimaryView } from "./primaryNav";

const HIDDEN_NAV_STORAGE_KEY = "coroslink.hiddenNavItems";

const EMPTY: ReadonlySet<PrimaryView> = new Set();
const listeners = new Set<() => void>();
let hiddenNavItems: ReadonlySet<PrimaryView> | null = null;

/** Overview is the fallback home and Settings is where hidden features come back. */
export function canHideNavItem(view: PrimaryView): boolean {
  return !PRIMARY_NAV_ITEMS.find((item) => item.id === view)?.alwaysVisible;
}

function readHiddenNavItems(): ReadonlySet<PrimaryView> {
  if (typeof window === "undefined") {
    return EMPTY;
  }

  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(HIDDEN_NAV_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(stored)) {
      return EMPTY;
    }
    // Drop ids from older builds and anything that may no longer be hidden.
    return new Set(
      PRIMARY_NAV_ITEMS.filter(
        (item) => stored.includes(item.id) && canHideNavItem(item.id),
      ).map((item) => item.id),
    );
  } catch {
    return EMPTY;
  }
}

export function getHiddenNavItems(): ReadonlySet<PrimaryView> {
  hiddenNavItems ??= readHiddenNavItems();
  return hiddenNavItems;
}

function writeHiddenNavItems(next: ReadonlySet<PrimaryView>): void {
  hiddenNavItems = next;
  try {
    window.localStorage.setItem(HIDDEN_NAV_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Ignore private-mode or locked-storage failures; the choice lasts this session.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setNavItemHidden(view: PrimaryView, hidden: boolean): void {
  const current = getHiddenNavItems();
  if (current.has(view) === hidden || (hidden && !canHideNavItem(view))) {
    return;
  }

  const next = new Set(current);
  if (hidden) {
    next.add(view);
  } else {
    next.delete(view);
  }
  writeHiddenNavItems(next);
}

export function showAllNavItems(): void {
  if (getHiddenNavItems().size > 0) {
    writeHiddenNavItems(EMPTY);
  }
}

function subscribeHiddenNavItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Features the user has hidden from the sidebar; shared by every subscriber. */
export function useHiddenNavItems(): ReadonlySet<PrimaryView> {
  return useSyncExternalStore(subscribeHiddenNavItems, getHiddenNavItems, () => EMPTY);
}
