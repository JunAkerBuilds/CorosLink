export type CorosWifiMusicPhase = "idle" | "choosing" | "preparing" | "waiting" | "downloading" | "restoring" | "complete" | "cancelled" | "failed" | "restore-required";

/** Files per watch download task. The firmware sizes its record array from d_count and has no count cap;
 *  the list is served in pages that fit its 4 KB page buffer (see corosWifiMusicServer). */
export const WIFI_MUSIC_BATCH_FILES = 100;
/** Bytes per task, so a NetEase batch finishes well inside the relay lookup's 35-minute lifetime. */
export const WIFI_MUSIC_BATCH_BYTES = 256 * 1024 * 1024;
/** What relays deployed before 2026-11-01 accept per NetEase lookup; batches shrink to this if the relay refuses more. */
export const WIFI_AUDIO_LOOKUP_LEGACY_FILES = 20;
export const WIFI_MUSIC_MAX_FILES = 500;

export interface CorosWifiMusicOptions {
  destination: "podcasts" | "netease";
  playlistName?: string;
  /** An existing NetEase playlist to add to; the watch creates one with this ID if it's gone. */
  playlistId?: string;
}

/** A NetEase playlist CorosLink created on this watch, by the name it was given. */
export interface CorosNeteasePlaylistLabel { id: string; name: string; /** Last time CorosLink added songs to it (epoch ms). */ updatedAt?: number }

export const NETEASE_MAX_PLAYLISTS = 10;
export const NETEASE_MAX_SONGS = 500;

/** A playlist name the watch can show: trimmed, no control characters, at most 63 UTF-8 bytes. */
export function validateNeteasePlaylistName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || /[\x00-\x1f\x7f]/.test(name) || new TextEncoder().encode(name).length > 63)
    throw new Error("Enter a playlist name (up to 63 UTF-8 bytes).");
  return name;
}

export function validateNeteasePlaylistId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-F0-9]{8}$/.test(value)) throw new Error("Choose a playlist on the watch.");
  return value;
}

/** Validate IPC input before opening a picker, starting a server or writing settings. */
export function validateWifiMusicOptions(value: unknown): CorosWifiMusicOptions {
  if (value === undefined) return { destination: "podcasts" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose an audio destination.");
  const input = value as Record<string, unknown>;
  if (input.destination !== "podcasts" && input.destination !== "netease") throw new Error("Choose an audio destination.");
  if (input.destination === "podcasts") return { destination: "podcasts" };
  const playlistName = validateNeteasePlaylistName(input.playlistName);
  if (input.playlistId === undefined) return { destination: "netease", playlistName };
  return { destination: "netease", playlistName, playlistId: validateNeteasePlaylistId(input.playlistId) };
}

export interface CorosWifiMusicStatus {
  supported: boolean;
  ready: boolean;
  backupSavedAt?: number;
  phase: CorosWifiMusicPhase;
  deviceName?: string;
  fileName?: string;
  completedFiles: number;
  totalFiles: number;
  downloadedBytes: number;
  totalBytes: number;
  restorePending: boolean;
  error?: string;
  destination?: CorosWifiMusicOptions["destination"];
  playlistName?: string;
  /** NetEase: the playlist this queue adds to; a new playlist's ID is known once its first batch starts. */
  playlistId?: string;
  batchIndex?: number;
  batchCount?: number;
  /** "screen": between batches the watch holds its download-finished screen until a button is pressed. */
  waitingFor?: "screen";
}

/** Main-process-only identity. Neither settings payloads nor account credentials cross IPC. */
export interface CorosWifiMusicIdentity {
  deviceName: string;
  serialNumber?: string;
  accountUserId: string;
}
