// The Media library's rows: the tracks on this computer and the tracks only on the watch, in one list.
import type { LibraryTrack, WatchTrack } from "./media";

export interface Row {
  key: string;
  /** The library track, when the file is on this computer. */
  id?: string;
  /** Where it is on the watch, when it's there. */
  watchPath?: string;
  /** Place on the watch: what plays first. */
  order: number | null;
  title: string; artist: string; album: string;
  secs: number | null; bytes: number; addedAt: number | null;
  /** Where it came from (File, Spotify, Podcast…); null for a track only on the watch. */
  source: string | null;
  capital?: boolean;
}

export type Where = "all" | "watch" | "computer";
export type SortKey = "order" | "title" | "artist" | "album" | "secs" | "bytes" | "addedAt" | "source";

export function mediaRows(library: readonly LibraryTrack[], watch: readonly WatchTrack[]): Row[] {
  const byPath = new Map(watch.map((w) => [w.path, w]));
  const claimed = new Set<string>();
  const rows: Row[] = library.map((t) => {
    const w = t.onWatch ? byPath.get(t.onWatch) : undefined;
    if (w) claimed.add(w.path);
    return {
      key: `l:${t.id}`, id: t.id, watchPath: w?.path, order: w?.order ?? null, title: t.title, artist: t.artist ?? "", album: t.album ?? "",
      secs: t.secs, bytes: t.bytes, addedAt: t.addedAt, source: t.source ?? "File", capital: w?.capital,
    };
  });
  for (const w of watch) {
    if (claimed.has(w.path)) continue;
    rows.push({
      key: `w:${w.path}`, watchPath: w.path, order: w.order, title: w.title ?? w.name.replace(/\.mp3$/i, ""), artist: w.artist ?? "", album: w.album ?? "",
      secs: w.secs, bytes: w.bytes, addedAt: null, source: null, capital: w.capital,
    });
  }
  return rows;
}

export function filterRows(rows: readonly Row[], where: Where, query: string): Row[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (where === "all" || (where === "watch") === !!r.watchPath)
    && (!q || `${r.title} ${r.artist} ${r.album}`.toLowerCase().includes(q)));
}

/** Sorted by a column; rows without a value (not on the watch, never added here) go last either way. */
export function sortRows(rows: readonly Row[], key: SortKey, dir: 1 | -1): Row[] {
  return rows.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null || y == null) return x == null && y == null ? a.title.localeCompare(b.title) : x == null ? 1 : -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c * dir || a.title.localeCompare(b.title);
  });
}

export const clock = (secs: number | null): string => {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = Math.round(secs % 60);
  const pad = (v: number) => String(v).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export const megabytes = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;
export const gigabytes = (bytes: number): string => (bytes / 1e9).toFixed(2);
