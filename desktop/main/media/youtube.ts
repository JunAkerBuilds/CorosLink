// YouTube: search, or paste a video or playlist link, and download the audio into the library as MP3s (one each, or a
// whole playlist joined into one). YouTube can also be browsed inside the Media page: a view of its own (sandboxed,
// its own session) laid over a slot the page keeps for it; this process reads where it is, and the page only steers
// it and says where the slot is. yt-dlp does the reading and the downloading.
// The page names only a listing this process read and ids in it, never what yt-dlp is given.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { combinedOrigin, combinedWork, ffmpegJoin, ytDlpTrack, type Combine } from "./combined";
import type { Downloads, Work } from "./downloads";
import type { Library } from "./library";
import { SourceProblem } from "./sources";
import { findTool, listArgs, progressOf, run, runJson, ytDlpArgs } from "./tools";
import type { Browser, BrowserView, Rect, WebHost } from "./webHost";
import { t } from "@/lib/i18n";

export const PARTITION = "persist:clink-youtube";
const HOME = "https://www.youtube.com/";
/** The most entries read from a playlist. */
export const MAX_ITEMS = 5000;
const SEARCH_RESULTS = 20;
const LIST_TIMEOUT = 60_000;
const PLAYLIST_TIMEOUT = 180_000;
const HISTORY_KEEP = 100;
const LISTINGS_KEEP = 20;

export type Kind = "video" | "playlist" | "search" | "youtube";

const hostOf = (u: URL) => u.hostname.replace(/^www\./i, "").toLowerCase();
const isYouTubeHost = (host: string) => host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
const ID = /^[\w-]{6,64}$/;
const LIST = /^[\w-]{2,64}$/;

/**
 * A YouTube address in its one plain form: youtu.be links and watch pages become watch?v=, a watch page in a playlist
 * becomes the playlist, a search keeps only its words. Anything not on YouTube is refused.
 */
export function normalize(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new SourceProblem(t("That isn't a YouTube link."), "notYouTube"); }
  const host = hostOf(u);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SourceProblem(t("That isn't a YouTube link."), "notYouTube");
  if (host === "youtu.be") {
    const v = u.pathname.split("/").filter(Boolean)[0] ?? "";
    if (ID.test(v)) return `https://www.youtube.com/watch?v=${v}`;
  }
  if (!isYouTubeHost(host)) throw new SourceProblem(t("That isn't a YouTube link."), "notYouTube");
  const v = u.searchParams.get("v") ?? "", list = u.searchParams.get("list") ?? "", q = u.searchParams.get("search_query");
  if ((u.pathname === "/playlist" || u.pathname === "/watch") && LIST.test(list)) return `https://www.youtube.com/playlist?list=${list}`;
  if (u.pathname === "/watch" && ID.test(v)) return `https://www.youtube.com/watch?v=${v}`;
  const short = /^\/(shorts|live)\/([\w-]{6,64})/.exec(u.pathname);
  if (short) return `https://www.youtube.com/watch?v=${short[2]}`;
  if (u.pathname === "/results" && q) return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  return `https://www.youtube.com${u.pathname === "/" ? "/" : u.pathname}`;
}

export function classify(url: string): Kind {
  try {
    const u = new URL(url);
    if (!isYouTubeHost(hostOf(u))) return "youtube";
    if (u.pathname === "/playlist" && u.searchParams.has("list")) return "playlist";
    if (u.pathname === "/watch" && u.searchParams.has("v")) return u.searchParams.has("list") ? "playlist" : "video";
    if (u.pathname === "/results") return "search";
  } catch { /* not an address */ }
  return "youtube";
}

/** Where the browsing window may go: YouTube, and Google's sign-in and consent pages. */
export function allowedInBrowser(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return isYouTubeHost(hostOf(u)) || host === "accounts.google.com" || host === "consent.google.com" || /^accounts\.google\.[a-z.]+$/.test(host);
  } catch {
    return false;
  }
}

export interface Item { id: string; title: string; channel: string | null; secs: number | null }
export interface Listing { key: string; kind: "search" | "playlist" | "video"; title: string; url: string | null; listId: string | null; items: Item[] }

/** yt-dlp's JSON for a search, a playlist or a video, as items. Live streams and entries without an id are left out. */
export function readListing(json: unknown): { title: string; items: Item[] } {
  const d = (json ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(d.entries) ? (d.entries as Record<string, unknown>[]) : [d];
  const items: Item[] = [];
  for (const e of raw) {
    const id = typeof e?.id === "string" ? e.id : "";
    if (!ID.test(id) || e.live_status === "is_live" || e.live_status === "is_upcoming") continue;
    if (items.some((i) => i.id === id)) continue;
    const title = typeof e.title === "string" ? e.title : "";
    if (!title || title === "[Private video]" || title === "[Deleted video]") continue;
    const channel = typeof e.channel === "string" ? e.channel : typeof e.uploader === "string" ? e.uploader : null;
    items.push({ id, title, channel, secs: typeof e.duration === "number" && Number.isFinite(e.duration) ? Math.round(e.duration) : null });
    if (items.length >= MAX_ITEMS) break;
  }
  return { title: typeof d.title === "string" ? d.title : "", items };
}

/** yt-dlp's last error, said plainly when it's one people meet. */
export function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("sign in to confirm") || m.includes("not a bot")) return t("YouTube wants a sign-in for this one. Try again later.");
  if (m.includes("private video") || m.includes("members-only") || m.includes("playlist is private")) return t("That's private or members-only.");
  if (m.includes("video unavailable") || m.includes("does not exist")) return t("That video isn't available.");
  if (m.includes("ffmpeg") || m.includes("postprocessing")) return t("The audio couldn't be turned into an MP3.");
  if (m.includes("max-filesize") || m.includes("larger than max")) return t("That's too long to download.");
  return message.slice(0, 300);
}

/** The page's slot for YouTube, when it's a sensible rectangle; anything else hides it. */
export function slot(body: Record<string, unknown>): Rect | null {
  const n = (k: string) => (typeof body[k] === "number" && Number.isFinite(body[k]) ? (body[k] as number) : NaN);
  const r = { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
  if (Object.values(r).some((v) => Number.isNaN(v) || Math.abs(v) > 20_000) || r.width < 40 || r.height < 40) return null;
  return r;
}

export interface HistoryEntry { url: string; title: string; kind: Kind; visits: number; lastAt: number; downloadedAt: number | null }

/** Videos, playlists and searches opened here, newest first; downloaded ones are marked. */
export class History {
  private entries: HistoryEntry[] = [];
  constructor(private readonly file: string) {
    try {
      const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as HistoryEntry[]) : [];
      this.entries = Array.isArray(saved) ? saved.filter((e) => typeof e?.url === "string") : [];
    } catch { this.entries = []; }
  }

  list(): HistoryEntry[] {
    return this.entries.slice().sort((a, b) => Math.max(b.lastAt, b.downloadedAt ?? 0) - Math.max(a.lastAt, a.downloadedAt ?? 0));
  }

  private save(): void {
    this.entries = this.list().slice(0, HISTORY_KEEP);
    const temp = `${this.file}.tmp`;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(temp, JSON.stringify(this.entries));
    renameSync(temp, this.file);
  }

  private upsert(url: string, title: string, now: number): HistoryEntry {
    const clean = title.replace(/\s+-\s+YouTube$/i, "").replace(/\s+/g, " ").trim();
    let e = this.entries.find((x) => x.url === url);
    if (!e) { e = { url, title: clean || "YouTube", kind: classify(url), visits: 0, lastAt: now, downloadedAt: null }; this.entries.push(e); }
    if (clean) e.title = clean;
    return e;
  }

  visit(url: string, title: string, now = Date.now()): void {
    const kind = classify(url);
    if (kind === "youtube") return;
    const e = this.upsert(url, title, now);
    e.visits++;
    e.lastAt = now;
    this.save();
  }

  downloaded(url: string, title: string, now = Date.now()): void {
    this.upsert(url, title, now).downloadedAt = now;
    this.save();
  }

  clear(): void { this.entries = []; this.save(); }
}

export interface YouTubeHost {
  web: WebHost; appPath?: string; data: string;
  /** Stand-ins for the tools (tests): where a tool is, and yt-dlp's JSON for a listing. */
  find?: (name: "yt-dlp" | "ffmpeg") => string | null;
  list?: (bin: string, args: string[], ms: number) => Promise<unknown>;
}

export class YouTube {
  readonly history: History;
  private readonly listings = new Map<string, Listing>();
  private browser: Browser | null = null;
  private readonly active = new Set<string>();
  private readonly tool = (name: "yt-dlp" | "ffmpeg") => (this.host.find ? this.host.find(name) : findTool(name, this.host.appPath));

  constructor(private readonly library: Library, private readonly downloads: Downloads, private readonly host: YouTubeHost) {
    this.history = new History(path.join(host.data, "media", "youtube-history.json"));
  }

  private keep(listing: Listing): Listing {
    this.listings.delete(listing.key);
    this.listings.set(listing.key, listing);
    while (this.listings.size > LISTINGS_KEEP) this.listings.delete(this.listings.keys().next().value!);
    return listing;
  }

  private ytDlp(): string {
    const bin = this.tool("yt-dlp");
    if (!bin) throw new SourceProblem(t("Downloading needs yt-dlp on this computer."), "noYtDlp");
    return bin;
  }

  private async read(input: string, limit: number, ms: number): Promise<{ title: string; items: Item[] }> {
    try {
      return readListing(await (this.host.list ?? runJson)(this.ytDlp(), listArgs(input, limit), ms));
    } catch (error) {
      if (error instanceof SourceProblem) throw error;
      throw new SourceProblem(explain(error instanceof Error ? error.message : String(error)), "youtube");
    }
  }

  /** Words are searched; a link is opened. */
  async search(q: string): Promise<Listing> {
    const words = q.trim().slice(0, 200);
    if (!words) throw new SourceProblem(t("Type something to search for."), "empty");
    if (/^https?:\/\//i.test(words) || /^(www\.)?(youtube\.com|youtu\.be)\//i.test(words)) return this.open(words.startsWith("http") ? words : `https://${words}`);
    const found = await this.read(`ytsearch${SEARCH_RESULTS}:${words}`, SEARCH_RESULTS, LIST_TIMEOUT);
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(words)}`;
    this.history.visit(url, words);
    return this.keep({ key: `search:${words}`, kind: "search", title: words, url, listId: null, items: found.items });
  }

  /** A video or playlist link, read by yt-dlp. */
  async open(raw: string): Promise<Listing> {
    const url = normalize(raw);
    const kind = classify(url);
    if (kind === "search") return this.search(new URL(url).searchParams.get("search_query") ?? "");
    if (kind !== "video" && kind !== "playlist") throw new SourceProblem(t("Open a video or a playlist."), "notVideo");
    const found = await this.read(url, kind === "playlist" ? MAX_ITEMS : 1, kind === "playlist" ? PLAYLIST_TIMEOUT : LIST_TIMEOUT);
    const title = found.title || found.items[0]?.title || "YouTube";
    this.history.visit(url, title);
    const listId = kind === "playlist" ? new URL(url).searchParams.get("list") : null;
    return this.keep({ key: url, kind, title, url, listId, items: found.items });
  }

  private listing(key: string): Listing {
    const l = this.listings.get(key);
    if (!l) throw new SourceProblem(t("Search or open the link again, then download."), "stale");
    return l;
  }

  /** One video saved as an MP3. */
  private videoWork(item: Item): Work {
    return async ({ dir, progress, signal }) => {
      try {
        await run(this.ytDlp(), ytDlpArgs(`https://www.youtube.com/watch?v=${item.id}`, dir, this.tool("ffmpeg")), (line) => {
          const p = progressOf(line);
          if (p != null) progress(p * 0.95);
        }, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(explain(error instanceof Error ? error.message : String(error)));
      }
      // Without a title (a tile that didn't show one), the MP3's own tags name it: yt-dlp writes them.
      return [{ file: path.join(dir, "audio.mp3"), name: `${item.title || item.id}.mp3`.slice(0, 150), extra: { ...(item.title ? { title: item.title } : {}), ...(item.channel ? { artist: item.channel } : {}), album: null, source: "YouTube", origin: `yt:${item.id}` } }];
    };
  }

  download(key: string, ids: string[] | null): { queued: number } {
    this.ytDlp();
    const l = this.listing(key);
    let queued = 0;
    for (const item of l.items) {
      if (ids && !ids.includes(item.id)) continue;
      if (!this.downloads.add({ source: "YouTube", title: item.title, artist: item.channel, origin: `yt:${item.id}` }, this.videoWork(item))) continue;
      queued++;
      // From a search, it's the video that was downloaded, not the search.
      if (l.kind === "search") this.history.downloaded(`https://www.youtube.com/watch?v=${item.id}`, item.title);
    }
    if (queued && l.url && l.kind !== "search") this.history.downloaded(l.url, l.title);
    return { queued };
  }

  /** A playlist joined into one MP3. Asking again after some tracks failed fetches only those, and replaces it. */
  combined(key: string, combine: Partial<Pick<Combine, "fetchTrack" | "join">> = {}): { queued: number } {
    this.ytDlp();
    const l = this.listing(key);
    if (l.kind !== "playlist" || !l.listId) throw new SourceProblem(t("Only a playlist can be combined."), "notPlaylist");
    const id = `yt:${l.listId}`;
    const work = combinedWork({
      id, name: l.title, source: "YouTube", active: this.active,
      tracks: l.items.map((i) => ({ input: `https://www.youtube.com/watch?v=${i.id}`, title: i.title })),
      cacheRoot: path.join(this.host.data, "media", "combined-cache"),
      fetchTrack: combine.fetchTrack ?? ytDlpTrack(() => this.tool("yt-dlp"), () => this.tool("ffmpeg")),
      join: combine.join ?? ffmpegJoin(() => this.tool("ffmpeg")),
    });
    const queued = this.downloads.add({ source: "YouTube", title: t("{title} (combined)", { title: l.title }), artist: null, origin: combinedOrigin(id) }, work, true);
    if (queued && l.url) this.history.downloaded(l.url, l.title);
    return { queued: queued ? 1 : 0 };
  }

  /** A listing with whether each item is in the library or downloading. */
  shown(l: Listing) {
    const jobs = this.downloads.list();
    const jobOf = (origin: string) => {
      const j = [...jobs].reverse().find((x) => x.origin === origin);
      return j ? { state: j.state, progress: j.progress, error: j.error ?? null, note: j.note ?? null } : null;
    };
    const combined = l.kind === "playlist" && l.listId ? combinedOrigin(`yt:${l.listId}`) : null;
    return {
      key: l.key, kind: l.kind, title: l.title, url: l.url,
      items: l.items.map((i) => ({ ...i, inLibrary: !!this.library.byOrigin(`yt:${i.id}`), job: jobOf(`yt:${i.id}`) })),
      combined: combined ? { inLibrary: !!this.library.byOrigin(combined), job: jobOf(combined) } : null,
    };
  }

  /* ───────────── YouTube in the page ───────────── */

  private view(): (BrowserView & { kind: Kind }) | null {
    const v = this.browser?.view() ?? null;
    return v ? { ...v, kind: classify(v.url) } : null;
  }

  /** Where YouTube was when it was last open, so closing it while out of sight loses nothing. */
  private lastUrl = HOME;

  openBrowser(raw?: string): ReturnType<YouTube["view"]> {
    const url = raw ? normalize(raw) : this.lastUrl;
    if (this.browser?.view()) { if (raw) this.browser.go({ url }); return this.view(); }
    if (!this.host.web.browse) throw new SourceProblem(t("Browsing YouTube isn't available here."), "noBrowser");
    this.browser = this.host.web.browse({
      url, partition: PARTITION, title: "YouTube", allow: allowedInBrowser,
      visited: (v) => {
        if (allowedInBrowser(v.url) && isYouTubeHost(hostOf(new URL(v.url)))) this.lastUrl = v.url;
        try { this.history.visit(normalize(v.url), v.title); } catch { /* not a YouTube page */ }
      },
      closed: () => { this.browser = null; },
      download: (id, title) => this.fromButton(id, title),
      known: () => this.library.list().flatMap((t) => (t.origin?.startsWith("yt:") || t.origin?.startsWith("ytm:") ? [t.origin.split(":")[1]] : [])),
    });
    return this.view();
  }

  /** Videos queued from their buttons, whose buttons follow the download until it's done. */
  private readonly watched = new Set<string>();
  private watching: ReturnType<typeof setInterval> | null = null;

  /** A video's "Download" button in YouTube: queue it, and keep its button saying how it's going. */
  fromButton(id: string, title: string): string {
    const item: Item = { id, title, channel: null, secs: null };
    let state: string;
    if (this.library.byOrigin(`yt:${id}`)) state = "done";
    else if (!this.tool("yt-dlp")) state = "failed";
    else {
      this.downloads.add({ source: "YouTube", title: item.title || t("YouTube video"), artist: null, origin: `yt:${id}` }, this.videoWork(item));
      this.history.downloaded(`https://www.youtube.com/watch?v=${id}`, item.title);
      state = "queued";
      this.watched.add(id);
      this.watching ??= setInterval(() => this.follow(), 1000);
    }
    this.browser?.mark(id, state);
    return state;
  }

  private follow(): void {
    const jobs = this.downloads.list();
    for (const id of [...this.watched]) {
      const job = [...jobs].reverse().find((j) => j.origin === `yt:${id}`);
      const state = !job ? (this.library.byOrigin(`yt:${id}`) ? "done" : "failed") : job.state === "waiting" ? "queued" : job.state === "cancelled" ? "failed" : job.state;
      this.browser?.mark(id, state);
      if (state === "done" || state === "failed") this.watched.delete(id);
    }
    if (!this.watched.size && this.watching) { clearInterval(this.watching); this.watching = null; }
  }

  go(to: "back" | "forward" | "reload"): ReturnType<YouTube["view"]> {
    this.browser?.go(to);
    return this.view();
  }

  /** Reads what the window shows now, so it can be downloaded. */
  async fromBrowser(): Promise<Listing> {
    const v = this.browser?.view();
    if (!v) throw new SourceProblem(t("Open YouTube first."), "noBrowser");
    return this.open(v.url);
  }

  /** Signs out of YouTube in the window and forgets its cookies and cache. */
  async resetBrowser(): Promise<null> {
    this.browser?.close();
    this.browser = null;
    this.lastUrl = HOME;
    await this.host.web.clear(PARTITION);
    return null;
  }

  /** Answers a route under /api/desktop/media/youtube, or null. */
  async answer(method: string, route: string, url: URL, body: Record<string, unknown>): Promise<unknown | null> {
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    switch (`${method} ${route}`) {
      case "GET /youtube": return { history: this.history.list(), browser: this.view() };
      case "GET /youtube/search": return { listing: this.shown(await this.search(url.searchParams.get("q") ?? "")) };
      case "POST /youtube/open": return { listing: this.shown(await this.open(str("url"))) };
      case "GET /youtube/listing": { const l = this.listings.get(url.searchParams.get("key") ?? ""); return { listing: l ? this.shown(l) : null }; }
      case "POST /youtube/download": return this.download(str("key"), Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null);
      case "POST /youtube/combined": return this.combined(str("key"));
      case "POST /youtube/history/clear": this.history.clear(); return { history: [] };
      case "POST /youtube/browser/open": return { browser: this.openBrowser(str("url") || undefined) };
      case "POST /youtube/browser/go": { const to = str("to"); if (to !== "back" && to !== "forward" && to !== "reload") break; return { browser: this.go(to) }; }
      case "POST /youtube/browser/place": this.browser?.place(slot(body)); return { browser: this.view() };
      case "POST /youtube/browser/close": this.browser?.close(); this.browser = null; return { browser: null };
      case "POST /youtube/browser/reset": return { browser: await this.resetBrowser() };
      case "POST /youtube/browser/take": return { listing: this.shown(await this.fromBrowser()) };
    }
    return null;
  }
}
