// What the Media page does with drags, clicks and keys, kept apart from the screen so it's tested on its own:
// walking dropped folders, picking ranges of rows, and which service tabs show.
import { createStore } from "@/data/local/store";
import type { MEDIA_TABS } from "./media";

/** The part of a dropped file or folder (FileSystemEntry) the walk needs. */
export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (file: File) => void, fail?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: EntryLike[]) => void, fail?: (error: unknown) => void) => void };
}

/** Most files one drop brings in. */
export const MAX_DROPPED = 5000;

const hidden = (name: string) => name.startsWith(".");

/**
 * Every file in dropped files and folders, folders opened all the way down, sorted by path so a folder goes on the
 * watch in its own order. Hidden files (".DS_Store", "._Song.mp3") are left out.
 */
export async function walkEntries(entries: EntryLike[]): Promise<File[]> {
  const found: { path: string; file: File }[] = [];
  const visit = async (entry: EntryLike): Promise<void> => {
    if (found.length >= MAX_DROPPED || hidden(entry.name)) return;
    if (entry.isFile && entry.file) {
      const file = await new Promise<File | null>((ok) => entry.file!(ok, () => ok(null)));
      if (file) found.push({ path: entry.fullPath || entry.name, file });
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      // A reader hands over a folder in batches; an empty batch means it's done.
      for (;;) {
        const batch = await new Promise<EntryLike[]>((ok) => reader.readEntries(ok, () => ok([])));
        if (!batch.length) break;
        for (const child of batch) await visit(child);
      }
    }
  };
  for (const e of entries) await visit(e);
  return found.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })).map((f) => f.file);
}

/** The files of a drop: through its entries when the browser gives them (folders work then), else its plain file list. */
export async function droppedFiles(data: DataTransfer | null): Promise<File[]> {
  if (!data) return [];
  const entries = [...data.items].map((i) => (i.kind === "file" ? (i.webkitGetAsEntry() as unknown as EntryLike | null) : null)).filter((e): e is EntryLike => !!e);
  return entries.length ? walkEntries(entries) : [...data.files];
}

/** Files only MP3s get through; the rest are counted, so the page can say how many were left out. */
export function splitMp3s(files: File[]): { mp3s: File[]; skipped: number } {
  const mp3s = files.filter((f) => /\.mp3$/i.test(f.name));
  return { mp3s, skipped: files.length - mp3s.length };
}

/** A drag that carries files from Finder (not text, not the page's own rows). */
export const carriesFiles = (types: readonly string[] | undefined) => !!types?.includes("Files");

/** The page's own drag of library rows onto the watch. */
export const TRACKS_TYPE = "application/x-clink-tracks";

/**
 * The selection after a click: alone, toggled (⌘/Ctrl), or the range from the last plain click (Shift), all in the
 * order the rows are shown.
 */
export function clickSelect(order: readonly string[], picked: ReadonlySet<string>, anchor: string | null, key: string, mods: { shift?: boolean; toggle?: boolean }): { picked: Set<string>; anchor: string } {
  if (mods.shift && anchor && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(key)].sort((x, y) => x - y);
    const next = new Set(mods.toggle ? picked : []);
    for (const k of order.slice(a, b + 1)) next.add(k);
    return { picked: next, anchor };
  }
  if (mods.toggle) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { picked: next, anchor: key };
  }
  return { picked: new Set([key]), anchor: key };
}

/** The row an arrow key moves to (or extends the selection to, with Shift). */
export function stepSelect(order: readonly string[], picked: ReadonlySet<string>, anchor: string | null, focus: string | null, step: 1 | -1, shift: boolean): { picked: Set<string>; anchor: string; focus: string } | null {
  if (!order.length) return null;
  const from = focus && order.includes(focus) ? order.indexOf(focus) : step > 0 ? -1 : order.length;
  const to = order[Math.max(0, Math.min(order.length - 1, from + step))];
  if (shift && anchor && order.includes(anchor)) return { ...clickSelect(order, picked, anchor, to, { shift: true }), focus: to };
  return { picked: new Set([to]), anchor: to, focus: to };
}

/* ───────────── Service tabs ───────────── */

/** Service tabs the person hid (right-click a tab, or Settings → Sidebar → Media services). Library never hides. */
export const hiddenTabsStore = createStore<string[]>("media.hiddenTabs", []);

/** The Media page's section; Podcasts opens Audiobooks after splitting an episode. */
export type MediaTab = (typeof MEDIA_TABS)[number]["id"];
export const tabStore = createStore<MediaTab>("media.tab", "library");
export const ALWAYS_SHOWN_TAB = "library";

export function canHideTab(id: string): boolean { return id !== ALWAYS_SHOWN_TAB; }

/** The tabs to show: every one not hidden, and a hidden one while it's open. */
export function visibleTabs<T extends { id: string }>(tabs: readonly T[], hiddenIds: readonly string[], open: string): T[] {
  return tabs.filter((t) => !canHideTab(t.id) || !hiddenIds.includes(t.id) || t.id === open);
}
