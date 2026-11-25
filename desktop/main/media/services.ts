// The Media page's music services (Spotify, YouTube Music, Apple Music, Podcasts) and the downloads they start,
// answered under /api/desktop/media. The page only ever names a playlist, a song's id or an episode's id: what's
// downloaded, and from where, comes from the lists this process read itself.
import path from "node:path";
import type { Sealer } from "../secrets";
import { AppleMusic } from "./appleMusic";
import { artPath } from "./art";
import { combinedOrigin, combinedWork, ffmpegJoin, ytDlpTrack, type Combine } from "./combined";
import { Downloads, type Work } from "./downloads";
import type { Library } from "./library";
import { Podcasts } from "./podcasts";
import { SourceProblem, type MusicSource, type Song } from "./sources";
import { Spotify } from "./spotify";
import { findTool, progressOf, run, ytDlpArgs } from "./tools";
import { plain, ServiceVault } from "./vault";
import { WatchProblem } from "./watchDrive";
import { noWeb, type WebHost } from "./webHost";
import { YouTube } from "./youtube";
import { YouTubeMusic } from "./ytmusic";

export interface ServicesHost {
  web?: WebHost; sealer?: Sealer; appPath?: string; fetch?: typeof fetch;
  /** Shows a file in Finder (Explorer on Windows). */
  reveal?: (file: string) => void;
  /** Asks for audiobook files in the system's open dialog; their paths never reach the page. */
  chooseFiles?: (extensions: readonly string[]) => Promise<string[] | null>;
}

export class MusicServices {
  readonly downloads: Downloads;
  readonly podcasts: Podcasts;
  readonly sources: Record<"spotify" | "ytmusic" | "apple", MusicSource>;
  readonly spotify: Spotify;
  readonly youtube: YouTube;
  /** Each playlist's songs as last read, so a download is found by its id here. */
  private readonly songs = new Map<string, Song[]>();
  /** Each playlist's name as last listed, for its combined MP3. */
  private readonly names = new Map<string, string>();
  /** Combined-MP3 caches in use now. */
  private readonly combining = new Set<string>();

  /** The audiobook split from a podcast episode, if there is one (service.ts sets it). */
  bookOf: (show: string, episode: string) => { id: string; status: string; progress: number | null } | null = () => null;

  /** The services' settings and sign-ins (the move from CorosLink sets Spotify's Client ID). */
  readonly vault: ServiceVault;
  /** Songs to send to the watch as soon as they're downloaded (Spotify's "send to watch"). */
  private readonly toWatch = new Set<string>();

  constructor(
    private readonly data: string, private readonly library: Library, private readonly host: ServicesHost = {}, log: (line: string) => void = () => {},
    /** Sends a downloaded track to the watch (MediaService.queueSend). */
    send: (ids: string[]) => void = () => {},
  ) {
    const vault = this.vault = new ServiceVault(data, host.sealer ?? plain);
    const web = host.web ?? noWeb;
    this.downloads = new Downloads(library, path.join(data, "media", "downloading"), log, (track) => {
      if (track.origin && this.toWatch.delete(track.origin)) send([track.id]);
    });
    this.podcasts = new Podcasts(host.fetch ? (u, i) => host.fetch!(u, i) : undefined);
    this.spotify = new Spotify(vault, web, host.fetch ?? fetch);
    this.sources = { spotify: this.spotify, ytmusic: new YouTubeMusic(web), apple: new AppleMusic(vault, web) };
    this.youtube = new YouTube(library, this.downloads, { web, appPath: host.appPath, data });
  }

  tools() {
    return { ytDlp: !!findTool("yt-dlp", this.host.appPath), ffmpeg: !!findTool("ffmpeg", this.host.appPath) };
  }

  /** yt-dlp saving one song as an MP3. */
  private songWork(song: Song): Work {
    return async ({ dir, progress, signal }) => {
      const ytDlp = findTool("yt-dlp", this.host.appPath);
      if (!ytDlp) throw new Error("Downloading needs yt-dlp on this computer.");
      await run(ytDlp, ytDlpArgs(song.target, dir, findTool("ffmpeg", this.host.appPath)), (line) => {
        const p = progressOf(line);
        if (p != null) progress(p * 0.9);
      }, signal);
      return [{ file: path.join(dir, "audio.mp3"), name: `${song.artist ? `${song.artist} - ` : ""}${song.title}.mp3`.slice(0, 150), extra: { title: song.title, artist: song.artist || null, album: song.album, origin: song.origin } }];
    };
  }

  private source(name: string): MusicSource {
    const s = (this.sources as Record<string, MusicSource>)[name];
    if (!s) throw new SourceProblem("Not a music service.", "notFound");
    return s;
  }

  /** A playlist's songs, each with whether it's in the library or downloading, and its combined MP3. */
  private async listSongs(name: string, playlist: string) {
    const songs = await this.source(name).songs(playlist);
    this.songs.set(`${name}:${playlist}`, songs);
    return { songs: this.withState(songs), combined: this.combinedState(name, playlist) };
  }

  /** Whether the playlist's combined MP3 is in the library, and its latest job. */
  private combinedState(name: string, playlist: string) {
    const origin = combinedOrigin(`${name}:${playlist}`);
    const job = [...this.downloads.list()].reverse().find((j) => j.origin === origin);
    return { inLibrary: !!this.library.byOrigin(origin), job: job ? { state: job.state, progress: job.progress, error: job.error ?? null, note: job.note ?? null } : null };
  }

  private withState(songs: Song[]) {
    const jobs = this.downloads.list();
    return songs.map(({ target: _t, ...s }) => {
      const job = [...jobs].reverse().find((j) => j.origin === s.origin);
      return { ...s, artwork: artPath(s.artwork), inLibrary: !!this.library.byOrigin(s.origin), job: job ? { state: job.state, progress: job.progress, error: job.error ?? null } : null };
    });
  }

  private download(name: string, playlist: string, origins: string[] | null, toWatch = false) {
    if (!this.tools().ytDlp) throw new WatchProblem("Downloading needs yt-dlp on this computer.", "noYtDlp");
    const source = this.source(name);
    const songs = this.songs.get(`${name}:${playlist}`);
    if (!songs) throw new SourceProblem("Open the playlist again, then download.", "stale");
    let queued = 0;
    for (const song of songs) {
      if (origins && !origins.includes(song.origin)) continue;
      const work = this.songWork(song);
      const tagged: Work = async (job) => (await work(job)).map((f) => ({ ...f, extra: { ...f.extra, source: source.source } }));
      if (this.downloads.add({ source: source.source, title: song.title, artist: song.artist || null, origin: song.origin }, tagged)) {
        queued++;
        if (toWatch) this.toWatch.add(song.origin);
      }
    }
    return { queued };
  }

  /**
   * The playlist joined into one MP3, each song found as it would be downloaded alone. Asking again after some songs
   * failed fetches only those, and replaces it.
   */
  combined(name: string, playlist: string, toWatch = false, combine: Partial<Pick<Combine, "fetchTrack" | "join">> = {}) {
    if (!this.tools().ytDlp) throw new WatchProblem("Downloading needs yt-dlp on this computer.", "noYtDlp");
    const source = this.source(name);
    const songs = this.songs.get(`${name}:${playlist}`);
    if (!songs) throw new SourceProblem("Open the playlist again, then download.", "stale");
    const id = `${name}:${playlist}`;
    const title = this.names.get(id) ?? `${source.source} playlist`;
    const tool = (t: "yt-dlp" | "ffmpeg") => findTool(t, this.host.appPath);
    const work = combinedWork({
      id, name: title, source: source.source, active: this.combining,
      tracks: songs.map((s) => ({ input: s.target, title: s.artist ? `${s.artist} - ${s.title}` : s.title })),
      cacheRoot: path.join(this.data, "media", "combined-cache"),
      fetchTrack: combine.fetchTrack ?? ytDlpTrack(() => tool("yt-dlp"), () => tool("ffmpeg")),
      join: combine.join ?? ffmpegJoin(() => tool("ffmpeg")),
    });
    const origin = combinedOrigin(id);
    const queued = this.downloads.add({ source: source.source, title: `${title} (combined)`, artist: null, origin }, work, true);
    if (queued && toWatch) this.toWatch.add(origin);
    return { queued: queued ? 1 : 0 };
  }

  /** Answers a route under /api/desktop/media, or null when it isn't one of these. */
  async answer(method: string, route: string, url: URL, body: Record<string, unknown>): Promise<unknown | null> {
    const q = (k: string) => url.searchParams.get(k) ?? "";
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    let m: RegExpExecArray | null;
    if (route === "/youtube" || route.startsWith("/youtube/")) return this.youtube.answer(method, route, url, body);
    if (method === "GET" && route === "/tools") return this.tools();
    if (method === "GET" && route === "/downloads") return { jobs: this.downloads.list() };
    if (method === "POST" && route === "/downloads/cancel") { this.downloads.cancel(Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : "all"); return { jobs: this.downloads.list() }; }
    if (method === "POST" && route === "/downloads/clear") { this.downloads.clear(); return { jobs: this.downloads.list() }; }
    if (method === "GET" && route === "/podcasts/search") return { shows: (await this.podcasts.search(q("q"))).map((s) => ({ ...s, artwork: artPath(s.artwork) })) };
    if (method === "GET" && route === "/podcasts/show") {
      const show = await this.podcasts.show(q("id"), Math.max(0, Number(q("offset")) || 0));
      const jobs = this.downloads.list();
      return {
        show: {
          ...show, feed: undefined, artwork: artPath(show.artwork), page: show.page.map(({ url: _u, ...e }) => {
            const prefix = `podcast:${show.id}:${e.id}`;
            const inLibrary = !!this.library.list().find((t) => t.origin?.startsWith(prefix));
            const job = [...jobs].reverse().find((j) => j.origin.startsWith(prefix));
            return { ...e, artwork: artPath(e.artwork), inLibrary, job: job ? { state: job.state, progress: job.progress, error: job.error ?? null } : null, book: this.bookOf(show.id, e.id) };
          }),
        },
      };
    }
    if (method === "POST" && route === "/podcasts/download") {
      const ep = await this.podcasts.episode(str("show"), str("episode"), () => findTool("ffmpeg", this.host.appPath));
      return { queued: this.downloads.add({ source: "Podcast", title: ep.title, artist: ep.artist, origin: ep.origin }, ep.work) ? 1 : 0 };
    }
    if ((m = /^\/source\/(spotify|ytmusic|apple)(\/[a-z]+)?$/.exec(route))) {
      const [, name, action = ""] = m;
      const source = this.source(name);
      switch (`${method} ${action}`) {
        case "GET ": return source.status();
        case "POST /connect": return source.connect();
        case "POST /disconnect": return source.disconnect();
        case "POST /client": if (name !== "spotify") break; return this.spotify.setClientId(str("clientId"));
        case "POST /unlock": if (name !== "spotify") break; return this.spotify.unlock();
        case "POST /lock": if (name !== "spotify") break; return this.spotify.lock();
        case "GET /playlists": {
          const playlists = await source.playlists();
          for (const p of playlists) this.names.set(`${name}:${p.id}`, p.name);
          return { playlists: playlists.map((p) => ({ ...p, artwork: artPath(p.artwork) })) };
        }
        case "GET /songs": return this.listSongs(name, q("playlist"));
        case "GET /state": {
          const songs = this.songs.get(`${name}:${q("playlist")}`);
          return songs ? { songs: this.withState(songs), combined: this.combinedState(name, q("playlist")) } : { songs: null, combined: null };
        }
        case "POST /combined": return this.combined(name, str("playlist"), body.toWatch === true);
        case "POST /download": return this.download(name, str("playlist"), Array.isArray(body.origins) ? body.origins.filter((x): x is string => typeof x === "string") : null, body.toWatch === true);
      }
    }
    return null;
  }
}
