// The Media page's calls to the main process (desktop/main/media/service.ts), at /api/desktop/media.
export interface WatchTrack {
  path: string; name: string; bytes: number; order: number; capital?: true;
  title: string | null; artist: string | null; album: string | null; secs: number | null;
}
export interface WatchStatus {
  connected: boolean; model?: string; volume?: string; totalBytes?: number; freeBytes?: number; musicBytes?: number; mapBytes?: number;
  tracks: WatchTrack[]; waiting?: string;
}
export interface LibraryTrack {
  id: string; file: string; title: string; artist: string | null; album: string | null; secs: number | null; bytes: number; addedAt: number;
  sentAs?: string; onWatch: string | null; source?: string;
}
export interface Job { book?: string; total: number; done: number; current: string | null; sentBytes: number; totalBytes: number; running: boolean; cancelled?: true; error?: string }
export interface MediaState { watch: WatchStatus; library: LibraryTrack[]; job: Job | null; ejected: boolean; downloading: number }

export class MediaProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** The page's sections. */
export const MEDIA_TABS = [
  { id: "library", label: "Library", built: true },
  { id: "youtube", label: "YouTube", built: true },
  { id: "ytmusic", label: "YouTube Music", built: true },
  { id: "spotify", label: "Spotify", built: true },
  { id: "apple", label: "Apple Music", built: true },
  { id: "podcasts", label: "Podcasts", built: true },
  { id: "books", label: "Audiobooks", built: true },
] as const;

const BASE = "/api/desktop/media";

async function parse<T>(answer: Response): Promise<T> {
  const body = (await answer.json().catch(() => ({}))) as T & { error?: { code: string; message: string } };
  if (!answer.ok || body.error) throw new MediaProblem(body.error?.message ?? "That didn't work.", body.error?.code ?? "problem");
  return body;
}

const post = <T>(route: string, body: object = {}) => fetch(`${BASE}${route}`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify(body),
}).then((a) => parse<T>(a));

export const readMedia = () => fetch(BASE, { cache: "no-store" }).then((a) => parse<MediaState>(a));
export const refreshMedia = () => post<MediaState>("/refresh");
export const sendToWatch = (ids: string[]) => post<MediaState>("/send", { ids });
export const cancelSend = () => post<MediaState>("/send/cancel");
export const dismissSend = () => post<MediaState>("/send/dismiss");
export const deleteFromLibrary = (ids: string[]) => post<MediaState>("/library/delete", { ids });
export const removeFromWatch = (paths: string[]) => post<MediaState>("/watch/remove", { paths });
export const fixExtension = (path: string) => post<MediaState>("/watch/fix", { path });
export const ejectWatch = () => post<MediaState>("/eject");
export const revealTrack = (id: string) => post<{ revealed: boolean }>("/library/reveal", { id });

/** Adds one file to the library: the bytes go to the main process as they are. */
export const importFile = (file: File) => fetch(`${BASE}/import?name=${encodeURIComponent(file.name)}`, {
  method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Clink-Hub": "1" }, body: file,
}).then((a) => parse<{ track: LibraryTrack }>(a));

/* ───────────── Music services and downloads ───────────── */

export type SourceName = "spotify" | "ytmusic" | "apple";
export interface SourceStatus { connected: boolean; account: string | null; clientId?: string | null; redirectUri?: string; unlocked?: boolean }
export interface Playlist { id: string; name: string; count: number | null; owner: string | null; artwork: string | null; followed?: boolean; locked?: boolean }
export interface JobLine { state: "waiting" | "working" | "done" | "failed" | "cancelled"; progress: number | null; error: string | null }
export interface Song { origin: string; title: string; artist: string; album: string | null; secs: number | null; artwork: string | null; inLibrary: boolean; job: JobLine | null }
export interface DownloadJob { id: string; source: string; title: string; artist: string | null; state: JobLine["state"]; progress: number | null; error?: string; note?: string; origin: string }
export interface Tools { ytDlp: boolean; ffmpeg: boolean }
export interface Show { id: string; title: string; author: string; artwork: string | null; episodes?: number; genre?: string | null }
export interface Episode {
  id: string; title: string; published: number | null; secs: number | null; bytes: number | null; inLibrary: boolean; job: JobLine | null;
  artwork: string | null; season: number | null; number: number | null;
  /** The audiobook split from it, when there is one. */
  book: { id: string; status: BookStatus; progress: number | null } | null;
}
export interface ShowDetail extends Show { episodes: number; page: Episode[]; offset: number; about: string | null }

const get = <T>(route: string) => fetch(`${BASE}${route}`, { cache: "no-store" }).then((a) => parse<T>(a));
const src = (name: SourceName) => `/source/${name}`;

export const readTools = () => get<Tools>("/tools");
export const readDownloads = () => get<{ jobs: DownloadJob[] }>("/downloads");
export const cancelDownloads = (ids?: string[]) => post<{ jobs: DownloadJob[] }>("/downloads/cancel", ids ? { ids } : {});
export const clearDownloads = () => post<{ jobs: DownloadJob[] }>("/downloads/clear");

export const sourceStatus = (name: SourceName) => get<SourceStatus>(src(name));
export const connectSource = (name: SourceName) => post<SourceStatus>(`${src(name)}/connect`);
export const disconnectSource = (name: SourceName) => post<SourceStatus>(`${src(name)}/disconnect`);
export const setSpotifyClient = (clientId: string) => post<SourceStatus>("/source/spotify/client", { clientId });
export const readPlaylists = (name: SourceName) => get<{ playlists: Playlist[] }>(`${src(name)}/playlists`);
export const readSongs = (name: SourceName, playlist: string) => get<{ songs: Song[]; combined: CombinedState }>(`${src(name)}/songs?playlist=${encodeURIComponent(playlist)}`);
export const songsState = (name: SourceName, playlist: string) => get<{ songs: Song[] | null; combined: CombinedState | null }>(`${src(name)}/state?playlist=${encodeURIComponent(playlist)}`);
export const downloadSongs = (name: SourceName, playlist: string, origins?: string[], toWatch = false) => post<{ queued: number }>(`${src(name)}/download`, { playlist, toWatch, ...(origins ? { origins } : {}) });
/** The playlist joined into one MP3. */
export const combineSongs = (name: SourceName, playlist: string, toWatch = false) => post<{ queued: number }>(`${src(name)}/combined`, { playlist, toWatch });
export const unlockSpotify = () => post<SourceStatus>("/source/spotify/unlock");
export const lockSpotify = () => post<SourceStatus>("/source/spotify/lock");

export const searchPodcasts = (q: string) => get<{ shows: Show[] }>(`/podcasts/search?q=${encodeURIComponent(q)}`);
export const readShow = (id: string, offset = 0) => get<{ show: ShowDetail }>(`/podcasts/show?id=${encodeURIComponent(id)}&offset=${offset}`);
export const downloadEpisode = (show: string, episode: string) => post<{ queued: number }>("/podcasts/download", { show, episode });

/* ───────────── YouTube ───────────── */

export type YouTubeKind = "video" | "playlist" | "search" | "youtube";
export interface YouTubeItem { id: string; title: string; channel: string | null; secs: number | null; inLibrary: boolean; job: JobLine | null }
export interface CombinedState { inLibrary: boolean; job: (JobLine & { note: string | null }) | null }
export interface YouTubeListing { key: string; kind: "search" | "playlist" | "video"; title: string; url: string | null; items: YouTubeItem[]; combined: CombinedState | null }
export interface YouTubeHistory { url: string; title: string; kind: YouTubeKind; visits: number; lastAt: number; downloadedAt: number | null }
export interface YouTubeBrowser { url: string; title: string; canBack: boolean; canForward: boolean; kind: YouTubeKind }

/** What the box was given, as an address YouTube can open: a link as it is, words as a YouTube search. */
export function addressFor(text: string): string {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(t)) return `https://${t}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(t)}`;
}

export const readYouTube = () => get<{ history: YouTubeHistory[]; browser: YouTubeBrowser | null }>("/youtube");
export const searchYouTube = (q: string) => get<{ listing: YouTubeListing }>(`/youtube/search?q=${encodeURIComponent(q)}`);
export const openYouTube = (url: string) => post<{ listing: YouTubeListing }>("/youtube/open", { url });
export const youTubeListing = (key: string) => get<{ listing: YouTubeListing | null }>(`/youtube/listing?key=${encodeURIComponent(key)}`);
export const downloadYouTube = (key: string, ids?: string[]) => post<{ queued: number }>("/youtube/download", { key, ...(ids ? { ids } : {}) });
export const combineYouTube = (key: string) => post<{ queued: number }>("/youtube/combined", { key });
export const clearYouTubeHistory = () => post<{ history: YouTubeHistory[] }>("/youtube/history/clear");
export const openYouTubeBrowser = (url?: string) => post<{ browser: YouTubeBrowser | null }>("/youtube/browser/open", url ? { url } : {});
export const steerYouTubeBrowser = (to: "back" | "forward" | "reload") => post<{ browser: YouTubeBrowser | null }>("/youtube/browser/go", { to });
export const placeYouTubeBrowser = (rect: { x: number; y: number; width: number; height: number } | null) => post<{ browser: YouTubeBrowser | null }>("/youtube/browser/place", rect ?? {});
export const closeYouTubeBrowser = () => post<{ browser: null }>("/youtube/browser/close");
export const resetYouTubeBrowser = () => post<{ browser: null }>("/youtube/browser/reset");
export const takeFromYouTubeBrowser = () => post<{ listing: YouTubeListing }>("/youtube/browser/take");

/* ───────────── Audiobooks ───────────── */

export type SplitMode = "chapters" | "minutes";
export interface Split { mode: SplitMode; minutes: number }
export type BookStatus = "converting" | "ready" | "failed";
export interface BookPart { index: number; name: string; bytes: number; secs: number; chapter: string | null; onWatch: boolean }
export type BookSource = { kind: "file" } | { kind: "librivox" | "podcast"; id: string; page: string | null; cover: string | null };
export interface Book {
  id: string; title: string; author: string | null; createdAt: number; status: BookStatus; error: string | null; split: Split; source: BookSource;
  note: string | null; secs: number; parts: BookPart[]; resume: number; bytes: number; progress: { progress: number; message: string } | null;
}
export interface Chapter { title: string | null; start: number; secs: number }
export interface Draft { id: string; title: string; author: string | null; secs: number; files: number; chapterSource: "marks" | "files" | "none"; chapters: Chapter[] }
export interface BooksState { books: Book[]; watch: WatchStatus; job: Job | null; ffmpeg: boolean }
export interface FreeBook {
  id: string; title: string; author: string | null; language: string | null; secs: number | null; downloads: number | null; cover: string | null; page: string;
  /** The book in Your books made from it. */
  added: string | null;
}
export interface FreeSection { name: string; title: string; bytes: number | null; secs: number | null }
export interface FreeBookDetail extends FreeBook { about: string | null; sections: FreeSection[]; bytes: number }

export const readBooks = () => get<BooksState>("/books");
/** Opens the system's file dialog in the main process; the chosen paths stay there. */
export const chooseBook = () => post<{ draft: Draft | null }>("/books/choose");
/** Uploads files dropped on the page as one book, then reads them. */
export async function uploadBook(files: File[]): Promise<Draft> {
  const group = crypto.randomUUID();
  for (const f of files) {
    await fetch(`${BASE}/books/upload?group=${group}&name=${encodeURIComponent(f.name)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Clink-Hub": "1" }, body: f,
    }).then((a) => parse<{ file: boolean }>(a));
  }
  return (await post<{ draft: Draft }>("/books/uploaded", { group })).draft;
}
export const discardDraft = (draft: string) => post<{ discarded: boolean }>("/books/discard", { draft });
export const convertBook = (draft: string, split: Split) => post<{ book: Book }>("/books/convert", { draft, split });
export const addFreeBook = (id: string, split: Split) => post<{ book: Book }>("/books/free", { id, split });
export const splitEpisode = (show: string, episode: string, split: Split) => post<{ book: Book }>("/books/episode", { show, episode, split });
export const cancelBook = (id: string) => post<BooksState>("/books/cancel", { id });
export const deleteBook = (id: string) => post<BooksState>("/books/delete", { id });
export const sendBook = (id: string) => post<BooksState & { copying: number; skipped: number }>("/books/send", { id });
export const unsendBook = (id: string) => post<BooksState & { removed: number }>("/books/unsend", { id });
export const continueBook = (id: string, part: number) => post<BooksState & { removed: number }>("/books/continue", { id, part });
export const readFreeBooks = (q = "") => get<{ books: FreeBook[] }>(`/free${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
export const readFreeBook = (id: string) => get<{ book: FreeBookDetail }>(`/free/book?id=${encodeURIComponent(id)}`);
