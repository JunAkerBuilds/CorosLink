// Audiobooks: books on this computer (media/audiobooks/<id>, a book.json and its parts), converted from a DRM-free file,
// a LibriVox recording or a podcast episode into short mono MP3 parts (bookPlan.ts says why). Sending them, removing
// them and "I'm here" happen in service.ts, which owns the watch; this file says which files those are.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  chaptersOf, cleanTitle, fileStem, isBookFile, normalizeSplit, parseProbe, partName, PAUSE_DB, PAUSE_SECONDS, pauseCollector,
  pauseCuts, planSegments, samePart, sortFiles, titleFromFiles, type Chapter, type Probe, type Split,
} from "./bookPlan";
import type { LibriVox } from "./librivox";
import type { Podcasts } from "./podcasts";
import { WatchProblem, type WatchTrack } from "./watchDrive";

export interface BookPart { index: number; name: string; bytes: number; secs: number; chapter: string | null }
export type BookSource = { kind: "file" } | { kind: "librivox" | "podcast"; id: string; page: string | null; cover: string | null };
export type BookStatus = "converting" | "ready" | "failed";

interface Manifest {
  version: 1; id: string; title: string; author: string | null; createdAt: number; status: BookStatus; error: string | null;
  split: Split; source: BookSource; note: string | null; secs: number; parts: BookPart[];
  /** The first part still to play: the ones before it were listened to, came off the watch and are never sent again. */
  resume: number;
}

export interface Progress { progress: number; message: string }
export interface Book extends Omit<Manifest, "version" | "parts"> {
  parts: (BookPart & { onWatch: boolean })[];
  bytes: number;
  progress: Progress | null;
}

/** A file or files read but not converted yet: the page shows its length and chapters before the split is chosen. */
export interface Draft { id: string; title: string; author: string | null; secs: number; files: number; chapterSource: "marks" | "files" | "none"; chapters: Chapter[] }

/** Only local files, and only the demuxers of the formats offered: a ".m4b" can't be an ffmpeg playlist reaching other files or URLs. */
const INPUT_GUARD = ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,mp3,aac,flac,ogg,wav,asf,matroska,webm"];
const DRAFT_TTL = 60 * 60_000;
/** About three seconds at 64 kbps: a last part this small joins the one before it. */
const TINY_TAIL = 24_000;
const PAUSE_SHARE = 0.2;
const CONVERT_END = 0.95;
const MAX_EPISODE = 1024 ** 3;
const MAX_UPLOAD = 4 * 1024 ** 3;
const STALL_MS = 60_000;
const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface BooksHost {
  ffmpeg: () => string | null;
  librivox: LibriVox;
  podcasts: Podcasts;
  get?: (url: string, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}

const clockOf = (s: number) => { const t = Math.floor(s); return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

/** Runs ffmpeg, handing over each line; resolves with its exit code and the last lines (it prints to stderr). */
function ffmpegRun(bin: string, args: string[], onLine?: (line: string) => void, signal?: AbortSignal): Promise<{ code: number | null; lines: string[] }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Cancelled.")); return; }
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal });
    const lines: string[] = [];
    const rest = { out: "", err: "" };
    const feed = (k: keyof typeof rest) => (chunk: Buffer) => {
      const parts = `${rest[k]}${chunk.toString("utf8")}`.split(/\r\n|\n|\r/);
      rest[k] = parts.pop() ?? "";
      for (const p of parts) {
        if (!p.trim()) continue;
        onLine?.(p.trim());
        lines.push(p);
        if (lines.length > 400) lines.shift();
      }
    };
    child.stdout.on("data", feed("out"));
    child.stderr.on("data", feed("err"));
    child.on("error", (e) => reject(signal?.aborted ? new Error("Cancelled.") : e));
    child.on("close", (code) => {
      for (const r of [rest.out, rest.err]) if (r.trim()) lines.push(r);
      resolve({ code, lines });
    });
  });
}

export class Audiobooks {
  readonly root: string;
  private readonly drafts = new Map<string, { files: string[]; names: string[]; at: number; temp: string | null }>();
  private readonly running = new Map<string, AbortController>();
  private readonly progress = new Map<string, Progress>();
  private readonly log: (line: string) => void;
  private readonly get: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(data: string, private readonly host: BooksHost) {
    this.root = path.join(data, "media", "audiobooks");
    this.log = host.log ?? (() => {});
    this.get = host.get ?? ((u, i) => fetch(u, i));
    // Uploads from a session that ended are only conversion input.
    rmSync(path.join(this.root, ".uploads"), { recursive: true, force: true });
  }

  private dir(id: string): string {
    if (!BOOK_ID.test(id)) throw new WatchProblem("That book isn't here any more.", "missing");
    return path.join(this.root, id);
  }

  private read(id: string): Manifest | null {
    try {
      const m = JSON.parse(readFileSync(path.join(this.dir(id), "book.json"), "utf8")) as Manifest;
      return m.version === 1 && m.id === id ? m : null;
    } catch {
      return null;
    }
  }

  private need(id: string): Manifest {
    const m = this.read(id);
    if (!m) throw new WatchProblem("That book isn't here any more.", "missing");
    return m;
  }

  private write(m: Manifest): void {
    const file = path.join(this.dir(m.id), "book.json");
    if (!existsSync(path.dirname(file))) return;
    writeFileSync(`${file}.tmp`, JSON.stringify(m, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  private toBook(m: Manifest, watch: readonly WatchTrack[]): Book {
    const parts = m.parts.map((p) => ({ ...p, onWatch: watch.some((t) => samePart(p.name, t.name)) }));
    const { version: _v, ...rest } = m;
    return { ...rest, resume: this.resumeOf(m), parts, bytes: parts.reduce((a, p) => a + p.bytes, 0), progress: this.progress.get(m.id) ?? null };
  }

  private resumeOf(m: Manifest): number {
    return m.parts.some((p) => p.index === m.resume) ? m.resume : 1;
  }

  /** Every book, newest first. A conversion this process isn't running was cut off by a restart: it failed. */
  list(watch: readonly WatchTrack[] = []): Book[] {
    if (!existsSync(this.root)) return [];
    const books: Book[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !BOOK_ID.test(entry.name)) continue;
      const m = this.read(entry.name);
      if (!m) continue;
      if (m.status === "converting" && !this.running.has(m.id)) {
        m.status = "failed";
        m.error = "The conversion was cut off when the app closed. Delete it and try again.";
        this.write(m);
      }
      books.push(this.toBook(m, watch));
    }
    return books.sort((a, b) => b.createdAt - a.createdAt);
  }

  book(id: string, watch: readonly WatchTrack[] = []): Book {
    return this.toBook(this.need(id), watch);
  }

  /** Whether a converting job is running (the page polls faster then). */
  get busy(): boolean { return this.running.size > 0; }

  /** The book made from this LibriVox recording or podcast episode, unless it failed. */
  bySource(kind: "librivox" | "podcast", id: string): Book | undefined {
    return this.list().find((b) => b.source.kind === kind && b.source.id === id && b.status !== "failed");
  }

  /* ───────────── Drafts ───────────── */

  private ffmpeg(): string {
    const bin = this.host.ffmpeg();
    if (!bin) throw new WatchProblem("Converting books needs ffmpeg on this computer.", "noFfmpeg");
    return bin;
  }

  private async probe(file: string): Promise<Probe> {
    if (!path.isAbsolute(file) || !isBookFile(file)) throw new WatchProblem("Only audio files on this computer can be converted.", "notAudio");
    const { lines } = await ffmpegRun(this.ffmpeg(), ["-hide_banner", ...INPUT_GUARD, "-i", file]);
    try { return parseProbe(lines); } catch (error) { throw new WatchProblem(`${path.basename(file)}: ${(error as Error).message}`, "unreadable"); }
  }

  /** Reads chosen files (paths on this computer) without converting them. Only the draft's id goes to the page. */
  async draft(files: string[], names: string[] = files, temp: string | null = null): Promise<Draft> {
    const named0 = new Map(files.map((f, i) => [f, names[i] ?? f]));
    const usable = files.filter((f) => isBookFile(named0.get(f)!) && isBookFile(f));
    if (!usable.length) throw new WatchProblem("Choose a DRM-free audiobook: .m4b, .m4a, .mp3 or similar.", "notAudio");
    const byName = new Map(usable.map((f) => [named0.get(f)!, f]));
    const named = sortFiles([...byName.keys()]);
    const sorted = named.map((n) => byName.get(n)!);
    const probes: Probe[] = [];
    for (const f of sorted) probes.push(await this.probe(f));
    const tags = probes[0]?.tags ?? {};
    const secs = probes.reduce((a, p) => a + p.secs, 0);
    const chapters = chaptersOf(probes, named, secs);
    const now = Date.now();
    for (const [id, d] of this.drafts) if (now - d.at > DRAFT_TTL) this.dropDraft(id);
    const id = randomUUID();
    this.drafts.set(id, { files: sorted, names: named, at: now, temp });
    return {
      id, title: cleanTitle(tags.album || (sorted.length === 1 ? tags.title : "") || titleFromFiles(sorted, named)),
      author: tags.album_artist || tags.artist || tags.author || null, secs, files: sorted.length,
      chapterSource: chapters.length < 2 ? "none" : probes.some((p) => p.chapters.length) ? "marks" : "files", chapters,
    };
  }

  /** An upload (a file dropped on the page) saved for a draft; `group` gathers the files of one book. */
  async upload(group: string, name: string, body: ReadableStream<Uint8Array> | null, length: number): Promise<string> {
    if (!/^[\w-]{8,64}$/.test(group)) throw new WatchProblem("That upload wasn't recognised.", "problem");
    if (!body) throw new WatchProblem("Nothing came with that file.", "empty");
    if (!isBookFile(name)) throw new WatchProblem("Choose a DRM-free audiobook: .m4b, .m4a, .mp3 or similar.", "notAudio");
    if (length > MAX_UPLOAD) throw new WatchProblem("That file is too big.", "tooBig");
    const folder = path.join(this.root, ".uploads", group);
    await mkdir(folder, { recursive: true });
    const n = readdirSync(folder).length;
    const file = path.join(folder, `${String(n + 1).padStart(4, "0")}${path.extname(name).toLowerCase()}`);
    writeFileSync(`${file}.name`, path.basename(name));
    const out = createWriteStream(file);
    let size = 0;
    try {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_UPLOAD) throw new WatchProblem("That file is too big.", "tooBig");
        if (!out.write(value)) await once(out, "drain");
      }
      out.end();
      await once(out, "finish");
    } catch (error) {
      out.destroy();
      await rm(file, { force: true });
      throw error;
    }
    return file;
  }

  /** The uploads of one group, read as a draft. */
  draftUploads(group: string): Promise<Draft> {
    if (!/^[\w-]{8,64}$/.test(group)) throw new WatchProblem("That upload wasn't recognised.", "problem");
    const folder = path.join(this.root, ".uploads", group);
    const files = existsSync(folder) ? readdirSync(folder).filter((n) => !n.endsWith(".name")).map((n) => path.join(folder, n)) : [];
    if (!files.length) throw new WatchProblem("Nothing was uploaded.", "empty");
    const names = files.map((f) => { try { return readFileSync(`${f}.name`, "utf8"); } catch { return path.basename(f); } });
    return this.draft(files, names, folder).catch((error) => { rmSync(folder, { recursive: true, force: true }); throw error; });
  }

  dropDraft(id: string): void {
    const d = this.drafts.get(id);
    if (d?.temp) rmSync(d.temp, { recursive: true, force: true });
    this.drafts.delete(id);
  }

  /** Converts a draft. Each draft converts once. */
  convert(draftId: string, split: Partial<Split>): Book {
    const d = this.drafts.get(draftId);
    if (!d || Date.now() - d.at > DRAFT_TTL) { this.dropDraft(draftId); throw new WatchProblem("That import expired. Choose the file again.", "expired"); }
    this.drafts.delete(draftId);
    const m = this.create(titleFromFiles(d.names), split, { kind: "file" });
    return this.launch(m, async (signal) => {
      try { await this.encode(m, d.files, d.names, [], signal); } finally { if (d.temp) rmSync(d.temp, { recursive: true, force: true }); }
    });
  }

  /* ───────────── LibriVox and podcasts ───────────── */

  /** Downloads a LibriVox recording's sections, then converts them like a multi-file book: one chapter per section. */
  async addFree(id: string, split: Partial<Split>): Promise<Book> {
    const had = this.bySource("librivox", id);
    if (had) return had;
    const detail = await this.host.librivox.load(id);
    const m = this.create(cleanTitle(detail.title), split, { kind: "librivox", id: detail.id, page: detail.page, cover: detail.cover });
    m.author = detail.author;
    m.secs = detail.secs ?? 0;
    this.write(m);
    return this.launch(m, async (signal) => {
      const folder = path.join(this.dir(m.id), ".download");
      rmSync(folder, { recursive: true, force: true });
      mkdirSync(folder, { recursive: true });
      try {
        const known = detail.sections.every((s) => s.bytes) ? detail.bytes : 0;
        const files: string[] = [];
        let done = 0;
        for (const [i, s] of detail.sections.entries()) {
          const target = path.join(folder, `${String(i + 1).padStart(4, "0")}.mp3`);
          const say = (got: number) => this.report(m.id, 0.3 * Math.min(1, known ? (done + got) / known : (i + (s.bytes ? got / s.bytes : 0)) / detail.sections.length), `Downloading section ${i + 1} of ${detail.sections.length}`);
          say(0);
          done += await this.host.librivox.download(s, target, signal, say);
          files.push(target);
        }
        await this.encode(m, files, files, detail.sections.map((s) => s.title), signal, 0.3);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });
  }

  /** Downloads one episode from the show's own feed and splits it like a book. */
  async addEpisode(show: string, episode: string, split: Partial<Split>): Promise<Book> {
    const ep = await this.host.podcasts.find(show, episode);
    const source = `${show}:${episode}`;
    const had = this.bySource("podcast", source);
    if (had) return had;
    const m = this.create(cleanTitle(ep.title), { ...split, mode: "minutes" }, { kind: "podcast", id: source, page: `https://podcasts.apple.com/podcast/id${show}`, cover: ep.artwork });
    m.author = ep.show;
    m.secs = ep.secs ?? 0;
    this.write(m);
    return this.launch(m, async (signal) => {
      const folder = path.join(this.dir(m.id), ".download");
      rmSync(folder, { recursive: true, force: true });
      mkdirSync(folder, { recursive: true });
      try {
        const ext = path.extname(new URL(ep.url).pathname).slice(1).toLowerCase();
        const file = path.join(folder, `episode.${isBookFile(`x.${ext}`) ? ext : "mp3"}`);
        await this.fetchEpisode(ep.url, file, ep.bytes, signal, (f) => this.report(m.id, 0.3 * f, "Downloading the episode"));
        await this.encode(m, [file], [file], [], signal, 0.3);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });
  }

  /** Streams an episode to disk. Feeds send audio through redirects and CDNs, so any http(s) host is allowed; ffmpeg's guard still reads audio only. */
  private async fetchEpisode(url: string, target: string, expected: number | null, signal: AbortSignal, onShare: (f: number) => void): Promise<void> {
    const stall = new AbortController();
    let timer = setTimeout(() => stall.abort(), STALL_MS);
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), STALL_MS); };
    const out = createWriteStream(target);
    try {
      const answer = await this.get(url, { signal: AbortSignal.any([signal, stall.signal]) });
      if (!/^https?:$/.test(new URL(answer.url || url).protocol)) throw new Error("The episode's download left http(s), so it was stopped.");
      if (!answer.ok || !answer.body) throw new Error(`The episode didn't download (${answer.status}).`);
      const declared = Number(answer.headers.get("content-length"));
      if (declared > MAX_EPISODE) { await answer.body.cancel(); throw new Error("That episode is over 1 GB, so it was stopped."); }
      const total = declared > 0 ? declared : expected ?? 0;
      let got = 0;
      const reader = answer.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        got += value.length;
        if (got > MAX_EPISODE) throw new Error("That episode is over 1 GB, so it was stopped.");
        if (!out.write(value)) await once(out, "drain");
        if (total) onShare(Math.min(1, got / total));
      }
      out.end();
      await once(out, "finish");
      if (!got) throw new Error("The episode's download was empty.");
    } catch (error) {
      out.destroy();
      if (stall.signal.aborted && !signal.aborted) throw new Error("The download stalled. Try again.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ───────────── Converting ───────────── */

  private create(title: string, split: Partial<Split>, source: BookSource): Manifest {
    const m: Manifest = {
      version: 1, id: randomUUID(), title, author: null, createdAt: Date.now(), status: "converting", error: null,
      split: normalizeSplit(split), source, note: null, secs: 0, parts: [], resume: 1,
    };
    mkdirSync(this.dir(m.id), { recursive: true });
    this.write(m);
    return m;
  }

  /** Starts the work in the background; the book says "converting" until it's ready or failed. */
  private launch(m: Manifest, work: (signal: AbortSignal) => Promise<void>): Book {
    const abort = new AbortController();
    this.running.set(m.id, abort);
    this.report(m.id, 0, "Starting");
    void work(abort.signal)
      .then(() => { m.status = "ready"; m.error = null; })
      .catch((error: unknown) => {
        m.status = "failed";
        m.error = abort.signal.aborted ? "Cancelled." : error instanceof Error ? error.message.slice(0, 400) : String(error);
        if (!abort.signal.aborted) this.log(`Audiobooks: ${m.title} failed: ${m.error}`);
        m.parts = [];
        if (existsSync(this.dir(m.id))) for (const n of readdirSync(this.dir(m.id))) if (n.toLowerCase().endsWith(".mp3")) rmSync(path.join(this.dir(m.id), n), { force: true });
      })
      .finally(() => {
        this.running.delete(m.id);
        this.progress.delete(m.id);
        rmSync(path.join(this.dir(m.id), ".work"), { recursive: true, force: true });
        this.write(m);
      });
    return this.toBook(m, []);
  }

  private report(id: string, progress: number, message: string): void {
    this.progress.set(id, { progress: Math.min(Math.max(progress, 0), 1), message });
  }

  private async ff(args: string[], signal: AbortSignal, onLine?: (line: string) => void): Promise<void> {
    const { code, lines } = await ffmpegRun(this.ffmpeg(), args, onLine, signal);
    if (signal.aborted) throw new Error("Cancelled.");
    if (code !== 0) {
      const tail = lines.filter((l) => !l.includes("=")).slice(-3).join(" ").trim();
      throw new Error(`ffmpeg couldn't convert it${tail ? `: ${tail}` : ""}.`.slice(0, 400));
    }
  }

  /** Joined files go through the concat filter (no path is ever written into an ffmpeg script), resampled to match. */
  private static join(count: number): string {
    const n = Array.from({ length: count }, (_, i) => i);
    return `${n.map((i) => `[${i}:a:0]aresample=44100,aformat=channel_layouts=mono[a${i}]`).join(";")};${n.map((i) => `[a${i}]`).join("")}concat=n=${count}:v=0:a=1[book]`;
  }

  /**
   * One encode pass through the whole book, cut by ffmpeg's segment muxer into mono 64 kbps parts, then each part
   * tagged (stream copy) and measured. Equal parts first find the pauses, so each part ends at one.
   */
  private async encode(m: Manifest, files: string[], names: string[], titles: string[], signal: AbortSignal, start = 0): Promise<void> {
    const span = 1 - start;
    const say = (p: number, message: string) => this.report(m.id, start + span * p, message);
    say(0, "Reading the book");
    const probes: Probe[] = [];
    for (const f of files) { if (signal.aborted) throw new Error("Cancelled."); probes.push(await this.probe(f)); }
    const tags = probes[0]?.tags ?? {};
    if (m.source.kind === "file") {
      // A joined book's first file is titled after its first chapter, so only one file's title names the book.
      m.title = cleanTitle(tags.album || (files.length === 1 ? tags.title : "") || m.title);
      m.author = tags.album_artist || tags.artist || tags.author || null;
    }
    m.secs = probes.reduce((a, p) => a + p.secs, 0);
    this.write(m);

    const plan = planSegments(m.split, probes, names, m.secs, titles);
    m.note = plan.note;
    const work = path.join(this.dir(m.id), ".work");
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const inputs = files.flatMap((f) => [...INPUT_GUARD, "-i", f]);
    const joined = files.length > 1;
    const map = joined ? ["-filter_complex", Audiobooks.join(files.length), "-map", "[book]"] : ["-map", "0:a:0"];

    let segments = plan.args;
    let from = 0;
    if (plan.partSecs) {
      from = PAUSE_SHARE;
      const detect = `silencedetect=noise=${PAUSE_DB}dB:d=${PAUSE_SECONDS}`;
      const graph = joined ? ["-filter_complex", `${Audiobooks.join(files.length)};[book]${detect}[quiet]`, "-map", "[quiet]"] : ["-map", "0:a:0", "-af", `aformat=channel_layouts=mono,${detect}`];
      const pauses = pauseCollector();
      await this.ff(["-hide_banner", "-nostats", ...inputs, ...graph, "-vn", "-progress", "pipe:1", "-f", "null", "-"], signal, (line) => {
        const t = /^out_time_us=(\d+)$/.exec(line);
        if (t) say((Math.min(Number(t[1]) / 1e6 / Math.max(m.secs, 1), 1)) * PAUSE_SHARE, "Finding pauses between sentences");
        else pauses.push(line);
      });
      const cuts = pauseCuts(m.secs, plan.partSecs, pauses.finish(m.secs));
      if (cuts.length) segments = ["-segment_times", cuts.join(",")];
    }

    await this.ff([
      "-hide_banner", "-nostats", "-y", ...inputs, ...map, "-vn", "-map_metadata", "-1", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k",
      "-f", "segment", ...segments, "-segment_format", "mp3", "-reset_timestamps", "1", "-progress", "pipe:1", path.join(work, "segment_%05d.mp3"),
    ], signal, (line) => {
      const t = /^out_time_us=(\d+)$/.exec(line);
      if (t && m.secs > 0) {
        const secs = Number(t[1]) / 1e6;
        say(from + Math.min(secs / m.secs, 1) * (CONVERT_END - from), `Converting ${clockOf(secs)} of ${clockOf(m.secs)}`);
      }
    });

    const list = readdirSync(work).filter((n) => /^segment_\d+\.mp3$/.test(n)).sort();
    if (!list.length) throw new Error("ffmpeg made no audio. Is it a DRM-free audiobook?");
    await this.foldTail(work, list, signal);

    const stem = fileStem(m.title);
    const parts: BookPart[] = [];
    for (const [i, seg] of list.entries()) {
      const index = i + 1;
      const name = partName(stem, index, list.length);
      const target = path.join(this.dir(m.id), name);
      const chapter = plan.titles[i] ?? null;
      const tag: Record<string, string> = { title: `${name.split(" ")[0]} ${chapter ?? m.title}`, album: m.title, track: `${index}/${list.length}`, genre: "Audiobook" };
      if (m.author) { tag.artist = m.author; tag.album_artist = m.author; }
      // Stream copy rewrites the tags and the Xing header (an accurate length per part) without encoding again.
      await this.ff(["-hide_banner", "-nostats", "-y", ...INPUT_GUARD, "-i", path.join(work, seg), "-map", "0:a", "-c", "copy", "-map_metadata", "-1", "-id3v2_version", "3",
        ...Object.entries(tag).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]), target], signal);
      parts.push({ index, name, bytes: statSync(target).size, secs: (await this.probe(target)).secs, chapter });
      say(CONVERT_END + (index / list.length) * (1 - CONVERT_END), `Tagging part ${index} of ${list.length}`);
    }
    m.parts = parts;
  }

  /** Encoder padding can leave a last segment a fraction of a second long; it joins the part before it. */
  private async foldTail(work: string, list: string[], signal: AbortSignal): Promise<void> {
    if (list.length < 2) return;
    const tail = path.join(work, list[list.length - 1]);
    if (statSync(tail).size >= TINY_TAIL) return;
    const prev = path.join(work, list[list.length - 2]);
    const joined = path.join(work, "joined.mp3");
    const listFile = path.join(work, "concat.txt");
    // Both are this conversion's own segments.
    writeFileSync(listFile, `${[prev, tail].map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")}\n`);
    await this.ff(["-hide_banner", "-nostats", "-y", "-protocol_whitelist", "file", "-format_whitelist", "concat,mp3", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined], signal);
    renameSync(joined, prev);
    rmSync(tail);
    list.pop();
  }

  cancel(id: string): void {
    this.running.get(id)?.abort();
  }

  async remove(id: string): Promise<void> {
    this.cancel(id);
    this.progress.delete(id);
    await rm(this.dir(id), { recursive: true, force: true });
  }

  /* ───────────── The watch ───────────── */

  /** The parts still to send, in play order: from the resume point, not already on the watch. */
  toSend(id: string, watch: readonly WatchTrack[]): { book: Book; parts: { file: string; name: string; bytes: number; title: string }[] } {
    const m = this.need(id);
    if (m.status !== "ready") throw new WatchProblem("That book isn't ready yet.", "notReady");
    const book = this.toBook(m, watch);
    const parts = book.parts.filter((p) => p.index >= book.resume && !p.onWatch)
      .map((p) => ({ file: path.join(this.dir(id), p.name), name: p.name, bytes: p.bytes, title: `${book.title} · part ${p.index}` }));
    return { book, parts };
  }

  /** The watch files that are this book's parts. */
  onWatch(id: string, watch: readonly WatchTrack[]): WatchTrack[] {
    const m = this.need(id);
    return watch.filter((t) => m.parts.some((p) => samePart(p.name, t.name)));
  }

  /**
   * "I'm here" (or "Start here" with nothing on the watch): later sends start at this part. Returns the watch files of
   * the parts before it, which come off the watch so whatever is sent next plays after this book.
   */
  continueFrom(id: string, index: number, watch: readonly WatchTrack[]): WatchTrack[] {
    const m = this.need(id);
    if (m.status !== "ready") throw new WatchProblem("That book isn't ready yet.", "notReady");
    const at = Math.round(Number(index));
    if (!m.parts.some((p) => p.index === at)) throw new WatchProblem("That part isn't in this book.", "missing");
    m.resume = at;
    this.write(m);
    const earlier = m.parts.filter((p) => p.index < at);
    return watch.filter((t) => earlier.some((p) => samePart(p.name, t.name)));
  }
}
