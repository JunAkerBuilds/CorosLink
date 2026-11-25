// Downloads into the library: songs from Spotify, YouTube Music and Apple Music (found on YouTube by yt-dlp) and
// podcast episodes (from the publisher's feed). Three at a time; each lands in the library as an MP3, and one that's
// already there (same service id) isn't downloaded again.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { Extra, Library, LibraryTrack, Source } from "./library";

export type JobState = "waiting" | "working" | "done" | "failed" | "cancelled";

export interface DownloadJob {
  id: string;
  source: Source;
  title: string;
  artist: string | null;
  state: JobState;
  /** 0–1 while working, when the tool says. */
  progress: number | null;
  error?: string;
  /** Said about a finished job (a combined MP3 that left some tracks out). */
  note?: string;
  /** The service id, so the page can tell which of a playlist's songs are here. */
  origin: string;
}

/** What a job does in its own temporary folder: hands back the MP3s to add, with what they are. */
export type Work = (job: { dir: string; progress: (p: number) => void; note: (text: string) => void; signal: AbortSignal }) => Promise<{ file: string; name: string; extra: Extra }[]>;

const AT_ONCE = 3;
const KEEP = 200;

export class Downloads {
  private jobs: (DownloadJob & { work: Work; abort: AbortController })[] = [];
  private running = 0;

  constructor(
    private readonly library: Library, private readonly temp: string, private readonly log: (line: string) => void = () => {},
    /** Called with each track as it lands in the library. */
    private readonly added: (track: LibraryTrack) => void = () => {},
  ) {}

  list(): DownloadJob[] {
    return this.jobs.map(({ work: _w, abort: _a, ...job }) => job);
  }

  /**
   * Queues a download unless the library has it or it's already queued. Returns whether it was queued. `again`
   * queues it even when the library has it (the result takes its place).
   */
  add(job: { source: Source; title: string; artist: string | null; origin: string }, work: Work, again = false): boolean {
    if (!again && this.library.byOrigin(job.origin)) return false;
    if (this.jobs.some((j) => j.origin === job.origin && (j.state === "waiting" || j.state === "working"))) return false;
    this.jobs.push({ ...job, id: randomUUID(), state: "waiting", progress: null, work, abort: new AbortController() });
    if (this.jobs.length > KEEP) this.jobs = this.jobs.filter((j, i) => i >= this.jobs.length - KEEP || j.state === "waiting" || j.state === "working");
    this.next();
    return true;
  }

  cancel(ids: string[] | "all"): void {
    for (const j of this.jobs) {
      if ((ids === "all" || ids.includes(j.id)) && (j.state === "waiting" || j.state === "working")) {
        j.abort.abort();
        if (j.state === "waiting") j.state = "cancelled";
      }
    }
  }

  /** Forgets finished jobs. */
  clear(): void {
    this.jobs = this.jobs.filter((j) => j.state === "waiting" || j.state === "working");
  }

  /** Resolves when nothing is waiting or working (tests). */
  async idle(): Promise<void> {
    while (this.jobs.some((j) => j.state === "waiting" || j.state === "working")) await new Promise((r) => setTimeout(r, 10));
  }

  private next(): void {
    while (this.running < AT_ONCE) {
      const job = this.jobs.find((j) => j.state === "waiting");
      if (!job) return;
      job.state = "working";
      this.running++;
      void this.start(job).finally(() => { this.running--; this.next(); });
    }
  }

  private async start(job: DownloadJob & { work: Work; abort: AbortController }): Promise<void> {
    await mkdir(this.temp, { recursive: true });
    const dir = await mkdtemp(path.join(this.temp, "job-"));
    try {
      const files = await job.work({ dir, progress: (p) => { job.progress = p; }, note: (text) => { job.note = text; }, signal: job.abort.signal });
      for (const f of files) {
        if (job.abort.signal.aborted) break;
        if (f.extra.origin && !f.extra.replace && this.library.byOrigin(f.extra.origin)) continue;
        this.added(await this.library.add(f.file, f.name, f.extra));
      }
      job.state = job.abort.signal.aborted ? "cancelled" : "done";
      job.progress = job.state === "done" ? 1 : job.progress;
    } catch (error) {
      if (job.abort.signal.aborted) job.state = "cancelled";
      else {
        job.state = "failed";
        job.error = error instanceof Error ? error.message.slice(0, 300) : String(error);
        this.log(`Media: download of ${job.origin} failed: ${job.error}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
