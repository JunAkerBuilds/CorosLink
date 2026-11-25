// The Media page's main-process side, answered at /api/desktop/media: the library on this computer, the watch as a
// USB drive, and sending tracks from one to the other. Nothing here talks to COROS, so Local-Only Mode has nothing
// to stop. Writes go to the watch one file at a time, in the order asked for, because the watch plays its music in
// the order the files were copied.
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Art, artPath } from "./art";
import { Audiobooks, type Book } from "./audiobooks";
import { BOOK_EXTENSIONS } from "./bookPlan";
import { LibriVox } from "./librivox";
import { findTool } from "./tools";
import { Library, type LibraryTrack } from "./library";
import { MusicServices, type ServicesHost } from "./services";
import { SourceProblem } from "./sources";
import { lowercaseMp3 } from "./mp3";
import { WatchDrive, WatchProblem, type WatchStatus, type WatchTrack } from "./watchDrive";

export interface Job {
  /** The audiobook being sent, when it's one. */
  book?: string;
  total: number;
  done: number;
  /** The title being copied now. */
  current: string | null;
  sentBytes: number;
  totalBytes: number;
  running: boolean;
  cancelled?: true;
  error?: string;
}

export interface MediaTrack extends LibraryTrack {
  /** Where it is on the watch (path in the Music folder), when it's there. */
  onWatch: string | null;
}

export interface MediaState { watch: WatchStatus; library: MediaTrack[]; job: Job | null; ejected: boolean; downloading: number }

/** Biggest file the page can add (the watch caps nothing smaller, and a longer MP3 than this isn't music). */
const MAX_UPLOAD = 512 * 1024 * 1024;
/** Left free on the watch so its own files (activities, logs) still have room. */
const HEADROOM = 50 * 1024 * 1024;

/** The watch track a library track is, by the name it was sent as (or its own) and its size. */
export function findOnWatch(track: LibraryTrack, watch: readonly WatchTrack[]): WatchTrack | undefined {
  const names = [track.sentAs, lowercaseMp3(track.file)].filter(Boolean).map((n) => n!.toLowerCase());
  return watch.find((w) => w.bytes === track.bytes && names.includes(lowercaseMp3(w.name).toLowerCase()));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export class MediaService {
  readonly library: Library;
  private job: Job | null = null;
  private ejected = false;
  private readonly incoming: string;
  readonly services: MusicServices;
  private readonly art: Art;
  private readonly reveal: (file: string) => void;
  readonly books: Audiobooks;
  readonly librivox: LibriVox;
  private readonly chooseFiles: ServicesHost["chooseFiles"];

  constructor(data: string, readonly drive = new WatchDrive(), private readonly log: (line: string) => void = () => {}, host: ServicesHost = {}) {
    this.library = new Library(data);
    this.incoming = path.join(data, "media", "incoming");
    this.art = new Art(data, host.fetch);
    this.reveal = host.reveal ?? (() => {});
    this.services = new MusicServices(data, this.library, host, log, (ids) => this.queueSend(ids));
    this.chooseFiles = host.chooseFiles;
    this.librivox = new LibriVox(host.fetch ? (u, i) => host.fetch!(u, i) : undefined);
    this.books = new Audiobooks(data, {
      ffmpeg: () => findTool("ffmpeg", host.appPath), librivox: this.librivox, podcasts: this.services.podcasts, log,
      ...(host.fetch ? { get: (u: string, i?: RequestInit) => host.fetch!(u, i) } : {}),
    });
    this.services.bookOf = (show, episode) => {
      const b = this.books.bySource("podcast", `${show}:${episode}`);
      return b ? { id: b.id, status: b.status, progress: b.progress?.progress ?? null } : null;
    };
  }

  /** Downloads waiting to go to the watch, in the order they finished. */
  private pending: string[] = [];

  /**
   * Sends tracks to the watch as they're downloaded: after the send running now, and once the watch is plugged in if
   * it isn't. One send at a time, so the watch still gets files in order.
   */
  queueSend(ids: string[]): void {
    this.pending.push(...ids.filter((id) => !this.pending.includes(id)));
    void this.flush();
  }

  private flushing = false;
  private async flush(): Promise<void> {
    if (this.flushing || !this.pending.length || this.job?.running) return;
    this.flushing = true;
    try {
      const watch = await this.drive.status();
      if (!watch.connected || this.job?.running) return;
      const ids = this.pending.filter((id) => { const t = this.library.get(id); return t && !findOnWatch(t, watch.tracks); });
      this.pending = [];
      if (ids.length) await this.send(ids).catch((error) => this.log(`Media: sending downloads to the watch failed: ${String(error)}`));
    } finally {
      this.flushing = false;
    }
  }

  async state(): Promise<MediaState> {
    const watch = await this.drive.status();
    if (watch.connected) { this.ejected = false; void this.flush(); }
    const library = this.library.list().map((t) => ({ ...t, onWatch: findOnWatch(t, watch.tracks)?.path ?? null }));
    const downloading = this.services.downloads.list().filter((j) => j.state === "waiting" || j.state === "working").length;
    return { watch, library, job: this.job, ejected: this.ejected, downloading };
  }

  /** Sends library tracks to the watch, one after another in the order given; tracks already there are skipped. */
  async send(wanted: string[]): Promise<void> {
    if (this.job?.running) throw new WatchProblem("The watch is already being sent music.", "busy");
    const watch = await this.drive.status();
    if (!watch.connected) throw new WatchProblem("Plug in your watch first.", "noWatch");
    const tracks = wanted.map((id) => this.library.get(id)).filter((t): t is LibraryTrack => !!t && !findOnWatch(t, watch.tracks));
    if (!tracks.length) throw new WatchProblem("Those tracks are already on the watch.", "nothing");
    this.copy(watch.freeBytes, tracks.map((t) => ({ file: this.library.pathOf(t), name: t.file, title: t.title, bytes: t.bytes, done: (name: string) => this.library.markSent(t.id, name) })));
  }

  /**
   * Sends a book's parts still to play, first to last: the watch plays files in the order they were copied, across
   * Music and its folders. Parts before the resume point were listened to and aren't sent again.
   */
  async sendBook(id: string): Promise<{ copying: number; skipped: number }> {
    if (this.job?.running) throw new WatchProblem("The watch is already being sent music.", "busy");
    const watch = await this.drive.status();
    if (!watch.connected) throw new WatchProblem("Plug in your watch first.", "noWatch");
    const { book, parts } = this.books.toSend(id, watch.tracks);
    const toPlay = book.parts.filter((p) => p.index >= book.resume).length;
    if (parts.length) this.copy(watch.freeBytes, parts, id);
    return { copying: parts.length, skipped: toPlay - parts.length };
  }

  /** Starts copying files to the watch one at a time, in order. Checks there's room first. */
  private copy(free: number | undefined, items: { file: string; name: string; title: string; bytes: number; done?: (name: string) => void }[], book?: string): void {
    const totalBytes = items.reduce((a, t) => a + t.bytes, 0);
    if (free != null && totalBytes + HEADROOM > free) {
      const over = totalBytes + HEADROOM - free;
      throw new WatchProblem(`Not enough room on the watch: ${(over / 1e6).toFixed(1)} MB over.`, "full");
    }
    const job: Job = { ...(book ? { book } : {}), total: items.length, done: 0, current: null, sentBytes: 0, totalBytes, running: true };
    this.job = job;
    void (async () => {
      try {
        for (const t of items) {
          if (job.cancelled) break;
          job.current = t.title;
          const before = job.sentBytes;
          const name = await this.drive.copyIn(t.file, t.name, (copied) => { job.sentBytes = before + copied; });
          t.done?.(name);
          job.done++;
          job.sentBytes = before + t.bytes;
        }
      } catch (error) {
        job.error = error instanceof WatchProblem ? error.message : "The copy stopped. Check the cable and try again.";
        this.log(`Media: sending to the watch failed: ${String(error)}`);
      } finally {
        job.current = null;
        job.running = false;
        void this.flush();
      }
    })();
  }

  /** The Audiobooks section: every book, whether its parts are on the watch, and what's sending. */
  async booksState(): Promise<{ books: Book[]; watch: WatchStatus; job: Job | null; ffmpeg: boolean }> {
    const watch = await this.drive.status();
    const books = this.books.list(watch.tracks).map((b) => ({ ...b, source: b.source.kind === "file" ? b.source : { ...b.source, cover: artPath(b.source.cover) } }));
    return { books, watch, job: this.job, ffmpeg: this.services.tools().ffmpeg };
  }

  /** Routes under /books. */
  private async answerBooks(method: string, route: string, url: URL, body: Record<string, unknown>, request: Request): Promise<unknown | null> {
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    const split = (body.split && typeof body.split === "object" ? body.split : {}) as Record<string, unknown>;
    const asSplit = { mode: split.mode === "chapters" ? "chapters" as const : "minutes" as const, minutes: Number(split.minutes) };
    switch (`${method} ${route}`) {
      case "GET /books": return this.booksState();
      case "POST /books/choose": {
        if (!this.chooseFiles) throw new WatchProblem("Choosing files isn't available here.", "noDialog");
        const files = await this.chooseFiles(BOOK_EXTENSIONS);
        return { draft: files?.length ? await this.books.draft(files) : null };
      }
      case "POST /books/upload": return { file: !!(await this.books.upload(url.searchParams.get("group") ?? "", url.searchParams.get("name") ?? "", request.body, Number(request.headers.get("content-length") ?? 0))) };
      case "POST /books/uploaded": return { draft: await this.books.draftUploads(str("group")) };
      case "POST /books/discard": this.books.dropDraft(str("draft")); return { discarded: true };
      case "POST /books/convert": return { book: this.books.convert(str("draft"), asSplit) };
      case "POST /books/free": return { book: await this.books.addFree(str("id"), asSplit) };
      case "POST /books/episode": return { book: await this.books.addEpisode(str("show"), str("episode"), asSplit) };
      case "POST /books/cancel": this.books.cancel(str("id")); return this.booksState();
      case "POST /books/delete": {
        if (this.job?.running && this.job.book === str("id")) throw new WatchProblem("Wait for the send to finish, or stop it first.", "busy");
        await this.books.remove(str("id"));
        return this.booksState();
      }
      case "POST /books/send": return { ...(await this.sendBook(str("id"))), ...(await this.booksState()) };
      case "POST /books/unsend": {
        if (this.job?.running) throw new WatchProblem("Wait for the send to finish first.", "busy");
        const watch = await this.drive.status();
        if (!watch.connected) throw new WatchProblem("Plug in your watch first.", "noWatch");
        const removed = await this.drive.remove(this.books.onWatch(str("id"), watch.tracks).map((t) => t.path));
        return { removed, ...(await this.booksState()) };
      }
      case "POST /books/continue": {
        if (this.job?.running) throw new WatchProblem("Wait for the send to finish first.", "busy");
        const watch = await this.drive.status();
        if (!watch.connected) throw new WatchProblem("Plug in your watch first.", "noWatch");
        const earlier = this.books.continueFrom(str("id"), Number(body.part), watch.tracks);
        const removed = earlier.length ? await this.drive.remove(earlier.map((t) => t.path)) : 0;
        return { removed, ...(await this.booksState()) };
      }
      case "GET /free": {
        const q = url.searchParams.get("q") ?? "";
        const books = q.trim() ? await this.librivox.find(q) : await this.librivox.popular();
        const mine = this.books.list();
        return { books: books.map((b) => ({ ...b, cover: artPath(b.cover), added: mine.find((x) => x.source.kind === "librivox" && x.source.id === b.id && x.status !== "failed")?.id ?? null })) };
      }
      case "GET /free/book": {
        const b = await this.librivox.load(url.searchParams.get("id") ?? "");
        const added = this.books.bySource("librivox", b.id)?.id ?? null;
        return { book: { ...b, cover: artPath(b.cover), added, sections: b.sections.map(({ url: _u, sha1: _s, ...x }) => x) } };
      }
    }
    return null;
  }

  /** Writes an upload to a temporary file, then adds it to the library. */
  private async upload(request: Request, name: string): Promise<LibraryTrack> {
    if (!request.body) throw new WatchProblem("Nothing came with that file.", "empty");
    if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD) throw new WatchProblem("That file is too big for the watch.", "tooBig");
    await mkdir(this.incoming, { recursive: true });
    const temp = path.join(this.incoming, randomUUID());
    const out = createWriteStream(temp);
    let size = 0;
    try {
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_UPLOAD) throw new WatchProblem("That file is too big for the watch.", "tooBig");
        if (!out.write(value)) await once(out, "drain");
      }
      out.end();
      await once(out, "finish");
    } catch (error) {
      out.destroy();
      await rm(temp, { force: true });
      throw error;
    }
    return this.library.add(temp, name);
  }

  async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.slice("/api/desktop/media".length) || "/";
    if (request.method === "POST" && request.headers.get("x-clink-hub") !== "1") return problem("Not from this app.", "forbidden", 403);
    try {
      if (request.method === "GET" && route === "/art") return await this.art.answer(url.searchParams.get("u") ?? "");
      if (route === "/books/upload" && request.method === "POST") return json(await this.answerBooks("POST", route, url, {}, request));
      if (request.method === "POST" && route === "/import") {
        const track = await this.upload(request, url.searchParams.get("name") ?? "");
        return json({ track });
      }
      const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
      const book = route === "/books" || route.startsWith("/books/") || route === "/free" || route.startsWith("/free/") ? await this.answerBooks(request.method, route, url, body, request) : null;
      if (book !== null) return json(book);
      const served = await this.services.answer(request.method, route, url, body);
      if (served !== null) return json(served);
      switch (`${request.method} ${route}`) {
        case "GET /": return json(await this.state());
        case "POST /refresh": this.drive.invalidate(); return json(await this.state());
        case "POST /library/reveal": {
          const track = this.library.get(String(body.id ?? ""));
          if (!track) throw new WatchProblem("That track isn't in the library any more.", "missing");
          this.reveal(this.library.pathOf(track));
          return json({ revealed: true });
        }
        case "POST /library/delete": await this.library.remove(ids(body.ids)); return json(await this.state());
        case "POST /send": await this.send(ids(body.ids)); return json(await this.state());
        case "POST /send/cancel": if (this.job?.running) this.job.cancelled = true; return json(await this.state());
        case "POST /send/dismiss": if (!this.job?.running) this.job = null; return json(await this.state());
        case "POST /watch/remove": await this.drive.remove(ids(body.paths)); return json(await this.state());
        case "POST /watch/fix": await this.drive.fixExtension(String(body.path ?? "")); return json(await this.state());
        case "POST /eject": await this.drive.eject(); this.ejected = true; return json(await this.state());
        default: return problem("Not a media action.", "notFound", 404);
      }
    } catch (error) {
      if (error instanceof WatchProblem || error instanceof SourceProblem) return problem(error.message, error.code);
      this.log(`Media ${route} failed: ${String(error)}`);
      return problem("That didn't work.", "internal", 500);
    }
  }
}
