// What the three music services show the page: playlists, and a playlist's songs. A song is downloaded by finding
// it on YouTube (or, from YouTube Music, by its own video).
import type { Source } from "./library";

export interface Playlist {
  id: string; name: string; count: number | null; owner: string | null; artwork: string | null;
  /** Spotify: someone else's playlist the person only follows. */
  followed?: boolean;
  /** Spotify: followed, and not readable until followed playlists are unlocked. */
  locked?: boolean;
}
export interface Song {
  /** "spotify:…", "ytm:…", "apple:…": the library's origin key. */
  origin: string;
  title: string;
  artist: string;
  album: string | null;
  secs: number | null;
  /** The album cover, from the service's image host. */
  artwork?: string | null;
  /** What yt-dlp is given: a YouTube Music address, or a search. */
  target: string;
}
export interface SourceStatus {
  connected: boolean;
  /** Who's signed in, when the service says. */
  account: string | null;
  /** Spotify only: set up with the person's own Client ID. */
  clientId?: string | null;
  redirectUri?: string;
  /** Spotify only: followed playlists unlocked. */
  unlocked?: boolean;
}

export interface MusicSource {
  readonly source: Source;
  status(): Promise<SourceStatus>;
  connect(): Promise<SourceStatus>;
  disconnect(): Promise<SourceStatus>;
  playlists(): Promise<Playlist[]>;
  songs(playlistId: string): Promise<Song[]>;
}

/** The search yt-dlp runs for a song from Spotify or Apple Music: the artist and title, as an audio track. */
export const searchFor = (artist: string, title: string) => `${artist} - ${title} audio`;

/** "3:42" or "1:02:03" → seconds. */
export function clockSecs(text: string | null | undefined): number | null {
  if (!text || !/^\d+(:\d{1,2}){1,2}$/.test(text.trim())) return null;
  return text.trim().split(":").map(Number).reduce((a, n) => a * 60 + n, 0);
}

export class SourceProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
