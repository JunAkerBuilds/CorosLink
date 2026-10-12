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
}

export interface CorosBleMusicDeleteTarget {
  inventoryId: string;
  watchId: number;
  watchPath: string;
}

export interface CorosBleMusicDeleteResult {
  deleted: boolean;
  inventory: CorosBleMusicInventory;
}
