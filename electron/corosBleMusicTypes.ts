export interface CorosBleMusicTrack {
  name: string;
  watchPath: string;
  sizeBytes: number;
  /** Timestamp used by the watch's music index; kept as an ID, not an inferred date. */
  watchId: number;
}

export interface CorosBleMusicInventory {
  id: string;
  deviceName?: string;
  tracks: CorosBleMusicTrack[];
  checkedAt: number;
  wirelessTracks?: CorosWirelessAudioTrack[];
  wirelessError?: string;
  /** The NetEase list couldn't be read; podcasts and local MP3s are still complete. */
  neteaseError?: string;
}

export interface CorosWirelessAudioTrack {
  id: string;
  destination: "podcasts" | "netease";
  sizeBytes: number;
  /** Available for transfers whose original filename CorosLink saved locally. */
  name?: string;
  /** NetEase only: the playlist holding the song, and its name when CorosLink created it. */
  playlistId?: string;
  playlistName?: string;
}

export type CorosBleMusicDeleteTarget = {
  inventoryId: string;
  watchId: number;
  watchPath: string;
} | { inventoryId: string; destination: "podcasts"; id: string }
  /** Songs from one NetEase playlist; all of its songs removes the playlist. */
  | { inventoryId: string; destination: "netease"; playlistId: string; songIds: string[] };

export interface CorosBleMusicDeleteResult {
  deleted: boolean;
  inventory: CorosBleMusicInventory;
}

export interface CorosBleMusicDeleteAllResult {
  deletedCount: number;
  inventory?: CorosBleMusicInventory;
  error?: string;
}
