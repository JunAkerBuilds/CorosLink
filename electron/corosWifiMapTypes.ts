export interface CorosWifiMapTile { x: number; y: number }
export interface CorosWifiMapPreview {
  id: string;
  tiles: CorosWifiMapTile[];
  fileCount: number;
  sizeBytes: number;
}
export interface CorosWifiMapTask {
  id: string;
  state: "queued" | "downloading" | "complete" | "failed" | "unknown";
  statusCode: number;
  downloadedBytes: number;
  totalBytes: number;
  errorCode: number;
}
export interface CorosWifiMapStatus {
  supported: boolean;
  connected: boolean;
  authenticated: boolean;
  deviceName?: string;
  /** The connected watch's label ("APEX 4"), when CorosLink supports it. */
  watchLabel?: string;
  /** False on watches other than PACE Pro 3.2008.0, where map downloads are beta. */
  validated?: boolean;
  wifiStateCode?: number;
  tasks: CorosWifiMapTask[];
  updatedAt: number;
}
