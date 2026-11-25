// The music library on this computer: MP3s kept in the app's data folder (media/library), with an index of what
// each one is. Only MP3s come in; every file is kept with a lowercase .mp3.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isMp3, lowercaseMp3, readMp3, safeName, withFile } from "./mp3";
import { freeName, WatchProblem } from "./watchDrive";

export interface LibraryTrack {
  id: string;
  /** The file's name in the library folder. */
  file: string;
  title: string;
  artist: string | null;
  album: string | null;
  secs: number | null;
  bytes: number;
  addedAt: number;
  /** The name it got on the watch when this app sent it there. */
  sentAs?: string;
  /** Where it came from: a file added here, or a service it was downloaded from. */
  source?: Source;
  /** The service's own id for it ("spotify:4uLU6hMC…", "podcast:<guid>#3"), so it's never downloaded twice. */
  origin?: string;
}

export type Source = "File" | "YouTube" | "Spotify" | "YouTube Music" | "Apple Music" | "Podcast";

/** What a download knows better than the file's own tags. */
export interface Extra {
  title?: string; artist?: string | null; album?: string | null; source?: Source; origin?: string;
  /** Takes the place of the track with the same origin (a combined MP3 made again with the tracks it missed). */
  replace?: true;
}

export class Library {
  readonly folder: string;
  private readonly index: string;
  private tracks: LibraryTrack[] = [];

  constructor(data: string) {
    this.folder = path.join(data, "media", "library");
    this.index = path.join(data, "media", "library.json");
    try {
      const saved = existsSync(this.index) ? (JSON.parse(readFileSync(this.index, "utf8")) as LibraryTrack[]) : [];
      this.tracks = Array.isArray(saved) ? saved.filter((t) => existsSync(path.join(this.folder, t.file))) : [];
    } catch {
      this.tracks = [];
    }
  }

  list(): LibraryTrack[] { return this.tracks.slice(); }
  get(id: string): LibraryTrack | undefined { return this.tracks.find((t) => t.id === id); }
  pathOf(t: LibraryTrack): string { return path.join(this.folder, t.file); }

  private save(): void {
    const temp = `${this.index}.tmp`;
    writeFileSync(temp, JSON.stringify(this.tracks));
    renameSync(temp, this.index);
  }

  /**
   * Adds a file that's already on disk (an upload written to a temporary file). It's moved into the library if it's
   * an MP3, and deleted either way.
   */
  async add(temp: string, name: string, extra: Extra = {}, now = Date.now()): Promise<LibraryTrack> {
    try {
      if (!/\.mp3$/i.test(name) || !(await withFile(temp, (read) => isMp3(read)))) {
        throw new WatchProblem("The watch plays MP3 files only.", "notMp3");
      }
      await mkdir(this.folder, { recursive: true });
      const file = await freeName(this.folder, lowercaseMp3(safeName(path.basename(name))));
      const meta = await withFile(temp, readMp3);
      await rename(temp, path.join(this.folder, file));
      const track: LibraryTrack = {
        id: randomUUID(), file, title: extra.title ?? meta.title ?? file.slice(0, -4), artist: extra.artist !== undefined ? extra.artist : meta.artist,
        album: extra.album !== undefined ? extra.album : meta.album, secs: meta.secs,
        bytes: (await stat(path.join(this.folder, file))).size, addedAt: now, source: extra.source ?? "File",
        ...(extra.origin ? { origin: extra.origin } : {}),
      };
      const old = extra.replace && extra.origin ? this.tracks.filter((t) => t.origin === extra.origin) : [];
      for (const t of old) await rm(this.pathOf(t), { force: true });
      this.tracks = this.tracks.filter((t) => !old.includes(t));
      this.tracks.push(track);
      this.save();
      return track;
    } finally {
      await rm(temp, { force: true });
    }
  }

  async remove(ids: string[]): Promise<number> {
    const gone = this.tracks.filter((t) => ids.includes(t.id));
    for (const t of gone) await rm(this.pathOf(t), { force: true });
    this.tracks = this.tracks.filter((t) => !ids.includes(t.id));
    this.save();
    return gone.length;
  }

  /** The track downloaded from this service id (or the first part of one cut into parts), if it's here. */
  byOrigin(origin: string): LibraryTrack | undefined {
    return this.tracks.find((t) => t.origin === origin || t.origin?.startsWith(`${origin}#`));
  }

  markSent(id: string, sentAs: string): void {
    const t = this.get(id);
    if (!t) return;
    t.sentAs = sentAs;
    this.save();
  }
}
