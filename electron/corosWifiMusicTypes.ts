export type CorosWifiMusicPhase = "idle" | "choosing" | "preparing" | "downloading" | "restoring" | "complete" | "cancelled" | "failed" | "restore-required";

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
}

/** Main-process-only identity. Neither settings payloads nor account credentials cross IPC. */
export interface CorosWifiMusicIdentity {
  deviceName: string;
  serialNumber?: string;
  accountUserId: string;
}
