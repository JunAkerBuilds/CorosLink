// The Audiobooks section's sums: the parts a split will make (shown before anything converts), their names, and
// lengths as people read them. The main process does the real split (desktop/main/media/bookPlan.ts); these match it.
import { createStore } from "@/data/local/store";
import type { Book, Chapter, Split } from "./media";

export const MIN_PART_MINUTES = 3;
export const MAX_PART_MINUTES = 180;
/** Converted parts are mono 64 kbps: 8 kB a second. */
export const BYTES_PER_SECOND = 8_000;
/** A last part shorter than this joins the one before it. */
const TINY_TAIL = 3;
/** A chapter part this long loses a lot when the watch forgets your place in it. */
export const LONG_PART = 30 * 60;

export const splitStore = createStore<Split>("media.books.split", { mode: "chapters", minutes: 10 });
export type BooksTab = "books" | "free";
export const booksTabStore = createStore<BooksTab>("media.books.tab", "books");

export const clampMinutes = (n: number) => (Number.isFinite(n) ? Math.min(Math.max(Math.round(n), MIN_PART_MINUTES), MAX_PART_MINUTES) : 10);

export interface PreviewPart { title: string | null; start: number; secs: number }

/** The parts a split makes: one per chapter, or equal parts (cut at pauses, so about this long). */
export function previewParts(chapters: readonly Chapter[], secs: number, split: Split): PreviewPart[] {
  if (split.mode === "chapters" && chapters.length > 1) return chapters.map((c) => ({ title: c.title, start: c.start, secs: c.secs }));
  const each = clampMinutes(split.minutes) * 60;
  if (!(secs > 0)) return [];
  const parts: PreviewPart[] = [];
  for (let start = 0; start < secs; start += each) parts.push({ title: null, start, secs: Math.min(each, secs - start) });
  const last = parts.at(-1);
  if (parts.length > 1 && last && last.secs < TINY_TAIL) { parts.pop(); parts[parts.length - 1].secs += last.secs; }
  return parts;
}

/** A book's title in a file name, as the main process makes it. */
export function fileStem(title: string): string {
  const stem = title.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).replace(/[\s.]+$/, "");
  return stem || "Audiobook";
}
export const partName = (stem: string, index: number, count: number) => `${String(index).padStart(Math.max(3, String(count).length), "0")} ${stem}.mp3`;

/** "11 h 35 min", "42 min", "35 s". */
export function length(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (!h) return `${m} min`;
  return m === 60 ? `${h + 1} h` : m ? `${h} h ${m} min` : `${h} h`;
}

/** "1:02:03" or "2:03". */
export function clockAt(secs: number): string {
  const s = Math.floor(Math.max(0, secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export const partsLabel = (n: number) => `${n} ${n === 1 ? "part" : "parts"}`;

/** "12 chapters" or "40 × 10 min". */
export function partsSummary(book: Pick<Book, "parts" | "split" | "note">): string {
  if (book.split.mode === "chapters" && !book.note) return `${book.parts.length} ${book.parts.length === 1 ? "chapter" : "chapters"}`;
  return `${book.parts.length} × ${book.split.minutes} min`;
}

/** Where each part starts in the book. */
export function partStarts(parts: readonly { secs: number }[]): number[] {
  let at = 0;
  return parts.map((p) => { const s = at; at += p.secs; return s; });
}

/** What a book's parts are doing on the watch, from the resume point. */
export function watchState(book: Pick<Book, "parts" | "resume" | "status">) {
  const toPlay = book.parts.filter((p) => p.index >= book.resume);
  const onWatch = toPlay.filter((p) => p.onWatch).length;
  const anyOnWatch = book.parts.some((p) => p.onWatch);
  return { toPlay: toPlay.length, onWatch, anyOnWatch, listened: book.parts.length - toPlay.length, all: book.status === "ready" && toPlay.length > 0 && onWatch === toPlay.length };
}

/**
 * Whether a part can be where listening continues. With parts on the watch you can only move forward through them (an
 * earlier part sent now would play after the rest); with none there, any part can be where the next send starts.
 */
export function canContinueFrom(book: Pick<Book, "parts" | "resume">, part: { index: number; onWatch: boolean }): boolean {
  const anyOnWatch = book.parts.some((p) => p.onWatch);
  return anyOnWatch ? part.onWatch && part.index > book.resume : part.index !== book.resume;
}
