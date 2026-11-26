// Free classics: LibriVox's volunteer recordings, all public domain and all in the Internet Archive's `librivoxaudio`
// collection. archive.org's search ranks them by downloads and matches any words, which LibriVox's own API can't.
// The page only ever names a recording's identifier: every download address comes from archive.org's own listing, read
// here, and each file must match the size and SHA-1 that listing gives before ffmpeg reads it.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { WatchProblem } from "./watchDrive";
import { t } from "@/lib/i18n";

export interface FreeBook {
  id: string; title: string; author: string | null; language: string | null; secs: number | null; downloads: number | null;
  cover: string; page: string;
}
export interface FreeSection { name: string; title: string; url: string; bytes: number | null; secs: number | null; sha1: string | null }
export interface FreeBookDetail extends FreeBook { about: string | null; sections: FreeSection[]; bytes: number }

const BASE = "https://archive.org";
const COLLECTION = "librivoxaudio";
const RESULTS = 36;
const POPULAR_TTL = 6 * 60 * 60_000;
/** Parts are re-encoded to 64 kbps mono anyway, so the smallest MP3 saves download time. */
const FORMATS = ["64Kbps MP3", "VBR MP3", "128Kbps MP3", "MP3"];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_SECTION = 1024 ** 3;
const MAX_REDIRECTS = 5;
/** A section download gives up when nothing arrives for this long. */
const STALL_MS = 60_000;

type Get = (url: string, init?: RequestInit) => Promise<Response>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : Array.isArray(v) ? text(v[0]) : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(text).filter(Boolean);
const positive = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** "65:06", "10:17:59" or plain seconds. */
export function parseClock(value: string): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return positive(value);
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return positive(parts.reduce((a, p) => a * 60 + p, 0));
}

/** Only https on archive.org and its servers, redirects included. */
export function isArchiveUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && (url.hostname === "archive.org" || url.hostname.endsWith(".archive.org"));
  } catch {
    return false;
  }
}

export function htmlToText(html: string): string | null {
  const out = html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, c: string) => String.fromCodePoint(Number(c))).replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return out || null;
}

const LANGUAGES: Record<string, string> = {
  eng: "English", ger: "German", deu: "German", fre: "French", fra: "French", spa: "Spanish", ita: "Italian", dut: "Dutch", nld: "Dutch",
  por: "Portuguese", rus: "Russian", chi: "Chinese", zho: "Chinese", jpn: "Japanese", lat: "Latin", pol: "Polish", gre: "Greek", ell: "Greek",
  swe: "Swedish", fin: "Finnish", heb: "Hebrew", dan: "Danish", nor: "Norwegian",
};

/** "Alice's Adventures…, by Lewis Carroll" → "Alice's Adventures…". */
const bookTitle = (t: string) => t.replace(/,\s+by\s+[^,]+$/i, "").replace(/\s+/g, " ").trim();
/** "01 - A Scandal in Bohemia" → "A Scandal in Bohemia": the part list numbers them already. */
const sectionTitle = (t: string) => t.replace(/^\d+\s*[-–.:]\s*/, "").replace(/\s+/g, " ").trim();
const safeFile = (name: string) => name.toLowerCase().endsWith(".mp3") && !name.startsWith("/") && !name.includes("\\") && !name.split("/").some((s) => s === "" || s === "." || s === "..");

function toBook(doc: Record<string, unknown>): FreeBook | null {
  const id = text(doc.identifier), title = bookTitle(text(doc.title));
  if (!ID.test(id) || !title) return null;
  const language = list(doc.language)[0];
  return {
    id, title, author: list(doc.creator).join(", ") || null, language: language ? LANGUAGES[language.toLowerCase()] ?? language : null,
    secs: parseClock(text(doc.runtime)), downloads: positive(doc.downloads),
    cover: `${BASE}/services/img/${encodeURIComponent(id)}`, page: `${BASE}/details/${encodeURIComponent(id)}`,
  };
}

export class LibriVox {
  private popularCache: { at: number; books: FreeBook[] } | null = null;

  constructor(private readonly get: Get = (url, init) => fetch(url, init)) {}

  private async json<T>(url: string, what: string): Promise<T> {
    let answer: Response;
    try {
      answer = await this.get(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new WatchProblem(t("{service} couldn't be reached. Check the connection and try again.", { service: what }), "librivox");
    }
    if (!answer.ok) throw new WatchProblem(t("{service} didn't answer ({status}). Try again in a moment.", { service: what, status: answer.status }), "librivox");
    try { return (await answer.json()) as T; } catch { throw new WatchProblem(t("{service} sent something unreadable.", { service: what }), "librivox"); }
  }

  private async search(q: string): Promise<FreeBook[]> {
    const url = new URL("/advancedsearch.php", BASE);
    url.searchParams.set("q", q);
    for (const f of ["identifier", "title", "creator", "downloads", "runtime", "language"]) url.searchParams.append("fl[]", f);
    url.searchParams.append("sort[]", "downloads desc");
    url.searchParams.set("rows", String(RESULTS));
    url.searchParams.set("output", "json");
    const data = await this.json<{ response?: { docs?: Record<string, unknown>[] } }>(url.href, "LibriVox");
    return (data.response?.docs ?? []).map(toBook).filter((b): b is FreeBook => !!b);
  }

  /** The most downloaded recordings: the shelf before anything is searched. */
  async popular(now = Date.now()): Promise<FreeBook[]> {
    if (this.popularCache && now - this.popularCache.at < POPULAR_TTL) return this.popularCache.books;
    const books = await this.search(`collection:${COLLECTION} AND mediatype:audio`);
    this.popularCache = { at: now, books };
    return books;
  }

  /** Recordings whose title or author has every word ("austen pride" finds Pride and Prejudice). */
  async find(query: string): Promise<FreeBook[]> {
    const words = query.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return this.popular();
    const clauses = words.map((w) => { const e = w.replace(/["\\]/g, ""); return `(title:"${e}" OR creator:"${e}")`; });
    return this.search(`collection:${COLLECTION} AND mediatype:audio AND ${clauses.join(" AND ")}`);
  }

  /** One recording with its MP3 sections in play order. Called again at import, so addresses never come from the page. */
  async load(id: string): Promise<FreeBookDetail> {
    if (!ID.test(id)) throw new WatchProblem(t("That isn't a LibriVox recording."), "notFound");
    const data = await this.json<{ metadata?: Record<string, unknown>; files?: Record<string, unknown>[] }>(`${BASE}/metadata/${encodeURIComponent(id)}`, "LibriVox");
    const meta = data.metadata ?? {};
    if (!list(meta.collection).includes(COLLECTION)) throw new WatchProblem(t("That isn't a LibriVox recording."), "notFound");
    const files = data.files ?? [];
    const format = FORMATS.find((f) => files.some((x) => x.format === f));
    const sections = format ? files
      .filter((f) => f.format === format && typeof f.name === "string" && safeFile(f.name))
      .map((f) => {
        const name = f.name as string;
        const sha1 = text(f.sha1).toLowerCase();
        return {
          name, title: sectionTitle(text(f.title)) || (name.split("/").pop() ?? name).replace(/\.[^.]+$/, ""),
          url: `${BASE}/download/${encodeURIComponent(id)}/${name.split("/").map(encodeURIComponent).join("/")}`,
          bytes: positive(f.size), secs: parseClock(text(f.length)), sha1: /^[0-9a-f]{40}$/.test(sha1) ? sha1 : null,
          track: positive(text(f.track).split("/")[0]),
        };
      })
      .sort((a, b) => (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(({ track: _t, ...s }) => s) : [];
    if (!sections.length) throw new WatchProblem(t("This recording has no MP3s to download."), "noAudio");
    const book = toBook({ identifier: id, title: meta.title, creator: meta.creator, runtime: meta.runtime, language: meta.language });
    if (!book) throw new WatchProblem(t("LibriVox sent an incomplete record for that book."), "librivox");
    return {
      ...book,
      secs: book.secs ?? (sections.every((s) => s.secs) ? sections.reduce((a, s) => a + (s.secs ?? 0), 0) : null),
      about: htmlToText(text(meta.description))?.slice(0, 1200) ?? null,
      sections, bytes: sections.reduce((a, s) => a + (s.bytes ?? 0), 0),
    };
  }

  /**
   * Streams one section to `target`. Every redirect stays on archive.org over https, and the file must match the
   * size and SHA-1 archive.org lists. Returns its size.
   */
  async download(section: Pick<FreeSection, "url" | "bytes" | "sha1">, target: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<number> {
    const stall = new AbortController();
    let timer = setTimeout(() => stall.abort(), STALL_MS);
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), STALL_MS); };
    const both = AbortSignal.any([signal, stall.signal]);
    try {
      let url = section.url;
      let answer: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!isArchiveUrl(url)) throw new Error(t("The download left archive.org, so it was stopped."));
        answer = await this.get(url, { redirect: "manual", signal: both });
        const location = answer.headers.get("location");
        if (answer.status >= 300 && answer.status < 400 && location) {
          await answer.body?.cancel();
          url = new URL(location, url).href;
          answer = null;
          touch();
          continue;
        }
        break;
      }
      if (!answer) throw new Error(t("The download redirected too many times."));
      if (!answer.ok || !answer.body) throw new Error(t("A section didn't download ({status}).", { status: answer.status }));
      if (Number(answer.headers.get("content-length")) > MAX_SECTION) { await answer.body.cancel(); throw new Error(t("A section is bigger than LibriVox said, so it was stopped.")); }
      const hash = createHash("sha1");
      const out = createWriteStream(target);
      let bytes = 0;
      try {
        const reader = answer.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          bytes += value.length;
          if (bytes > MAX_SECTION) throw new Error(t("A section is bigger than LibriVox said, so it was stopped."));
          hash.update(value);
          if (!out.write(value)) await once(out, "drain");
          onBytes(bytes);
        }
        out.end();
        await once(out, "finish");
      } catch (error) {
        out.destroy();
        throw error;
      }
      if (section.bytes && bytes !== section.bytes) throw new Error(t("A section downloaded incompletely. Try again."));
      if (section.sha1 && hash.digest("hex") !== section.sha1) throw new Error(t("A section failed its checksum. Try again."));
      return bytes;
    } catch (error) {
      if (stall.signal.aborted && !signal.aborted) throw new Error(t("The download stalled. Try again."));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
