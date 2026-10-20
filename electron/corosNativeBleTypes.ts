export type CorosBleBackend = "system" | "usb";

export interface CorosNativeBleDeviceChoice {
  deviceId: string;
  deviceName: string;
  rssiDbm?: number;
  /** The watch CorosLink remembers (its Bluetooth identity matches), when several share a name. */
  remembered?: boolean;
}

export interface CorosNativeBleConnectOptions {
  pair?: boolean;
  backend?: CorosBleBackend;
  device?: CorosNativeBleDeviceChoice;
  /** "Connect anyway": trust the device that didn't match the remembered watch (asked for in the watch menu). */
  confirmIdentity?: boolean;
}

export interface CorosNativeBleChannel {
  name: "control" | "bulk" | "auxiliary";
  serviceUuid: string;
  notifyHandle?: number;
  writeHandle?: number;
  subscribed: boolean;
  notifications: number;
  receivedBytes: number;
  lastNotificationAt?: number;
}

/** Public device state; bond keys and COROS authentication bytes stay in main. */
export interface CorosNativeBleSnapshot {
  phase: "unavailable" | "idle" | "scanning" | "connecting" | "connected" | "disconnected" | "failed";
  backend?: CorosBleBackend;
  transport?: "corebluetooth" | "winrt" | "bluez" | "bumble";
  backends?: Array<{ id: CorosBleBackend; label: string; available: boolean }>;
  discoveredDevices?: CorosNativeBleDeviceChoice[];
  deviceId?: string;
  bluetoothState?: string;
  pairingManagedByOS?: boolean;
  maximumWriteBytes?: number;
  controlWrites?: number;
  watchEvents?: Array<{ id: number; receivedAt: number; kind: "media-control" | "call-rejected"; action?: number; value?: number }>;
  available: boolean;
  connected: boolean;
  encrypted: boolean;
  systemBind: "unavailable" | "not_authenticated" | "authenticating" | "authenticated" | "failed";
  authenticatedAt?: number;
  authenticationError?: string;
  /** A device with the remembered watch's name but another Bluetooth identity answered; nothing was sent to it. */
  identityMismatch?: boolean;
  channels: CorosNativeBleChannel[];
  deviceName?: string;
  watchAddress?: string;
  adapterAddress?: string;
  mtu?: number;
  rssiDbm?: number;
  hostToAdapterPackets?: number;
  adapterToHostPackets?: number;
  batteryPercent?: number;
  modelNumber?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
  softwareRevision?: string;
  manufacturerName?: string;
  /** The supported watch this is, from its model number or else its advertised name. */
  watchModel?: import("./watchModels").WatchModelId;
  watchModelSource?: "model-number" | "name";
  /** PACE Pro on firmware 3.2008.0, where every Bluetooth feature was checked; other watches are beta. */
  watchValidated?: boolean;
  updatedAt?: number;
  error?: string;
}

/** A pairing QR for C-LINK, the iPhone app. The image encodes the account key; nothing else here does. */
export interface CorosPhonePairingCode {
  qrDataUrl: string;
  issuedAt: number;
  expiresAt: number;
  /** Last digits of the COROS account ID. */
  account: string;
  deviceName?: string;
}
