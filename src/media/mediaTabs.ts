import { useSyncExternalStore, type ComponentType } from "react";
import { BookOpen, Link, ListMusic, Music, Podcast } from "lucide-react";
import { AppleBrandIcon, YouTubeMusicBrandIcon } from "./brandIcons";

export type MediaTab =
  | "library"
  | "youtube"
  | "youtube-music"
  | "spotify"
  | "apple-music"
  | "apple-podcasts"
  | "audiobooks";

export interface MediaTabItem {
  id: MediaTab;
  /** English source string; translated with t() where shown. */
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Cannot be hidden: Library is where every service's downloads land. */
  alwaysVisible?: boolean;
}

export const MEDIA_TAB_ITEMS: readonly MediaTabItem[] = [
  { id: "library", label: "Library", icon: Music, alwaysVisible: true },
  { id: "youtube", label: "YouTube Browser", icon: Link },
  { id: "youtube-music", label: "YouTube Music", icon: YouTubeMusicBrandIcon },
  { id: "spotify", label: "Spotify", icon: ListMusic },
  { id: "apple-music", label: "Apple Music", icon: AppleBrandIcon },
  { id: "apple-podcasts", label: "Apple Podcasts", icon: Podcast },
  { id: "audiobooks", label: "Audiobooks", icon: BookOpen },
];

export const MEDIA_TAB_IDS = MEDIA_TAB_ITEMS.map((item) => item.id);

const HIDDEN_MEDIA_TABS_STORAGE_KEY = "coroslink.hiddenMediaTabs";

const EMPTY: ReadonlySet<MediaTab> = new Set();
const listeners = new Set<() => void>();
let hiddenMediaTabs: ReadonlySet<MediaTab> | null = null;

export function canHideMediaTab(tab: MediaTab): boolean {
  return !MEDIA_TAB_ITEMS.find((item) => item.id === tab)?.alwaysVisible;
}

function readHiddenMediaTabs(): ReadonlySet<MediaTab> {
  if (typeof window === "undefined") {
    return EMPTY;
  }

  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(HIDDEN_MEDIA_TABS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(stored)) {
      return EMPTY;
    }
    // Drop ids from older builds and anything that may no longer be hidden.
    return new Set(
      MEDIA_TAB_IDS.filter((id) => stored.includes(id) && canHideMediaTab(id)),
    );
  } catch {
    return EMPTY;
  }
}

export function getHiddenMediaTabs(): ReadonlySet<MediaTab> {
  hiddenMediaTabs ??= readHiddenMediaTabs();
  return hiddenMediaTabs;
}

function writeHiddenMediaTabs(next: ReadonlySet<MediaTab>): void {
  hiddenMediaTabs = next;
  try {
    window.localStorage.setItem(HIDDEN_MEDIA_TABS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Ignore private-mode or locked-storage failures; the choice lasts this session.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function setMediaTabHidden(tab: MediaTab, hidden: boolean): void {
  const current = getHiddenMediaTabs();
  if (current.has(tab) === hidden || (hidden && !canHideMediaTab(tab))) {
    return;
  }

  const next = new Set(current);
  if (hidden) {
    next.add(tab);
  } else {
    next.delete(tab);
  }
  writeHiddenMediaTabs(next);
}

export function showAllMediaTabs(): void {
  if (getHiddenMediaTabs().size > 0) {
    writeHiddenMediaTabs(EMPTY);
  }
}

function subscribeHiddenMediaTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Media services the user has hidden from the Media tab bar. */
export function useHiddenMediaTabs(): ReadonlySet<MediaTab> {
  return useSyncExternalStore(subscribeHiddenMediaTabs, getHiddenMediaTabs, () => EMPTY);
}
