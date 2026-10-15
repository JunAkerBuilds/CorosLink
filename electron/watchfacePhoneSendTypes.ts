/** Studio's Send to iPhone: a face served on the local network for C-LINK (see watchfacePhoneSend.ts). */
export interface WatchfacePhoneSend {
  /** `coroslink://face/1?…`, also shown as the QR code. */
  link: string;
  qrDataUrl: string;
  name: string;
  size: number;
  hosts: string[];
  expiresAt: number;
}

export interface WatchfacePhoneSendStatus {
  active: boolean;
  /** A phone is downloading the face now. */
  sending: boolean;
  /** Completed downloads of the current code. */
  received: number;
  /** Identifies the code this status is for. */
  expiresAt?: number;
}

export interface WatchfacePhoneSendInput {
  archiveId: string;
  name: string;
  /** The watch Studio built the archive for, so C-LINK files it under that watch. */
  firmwareType?: string;
}
