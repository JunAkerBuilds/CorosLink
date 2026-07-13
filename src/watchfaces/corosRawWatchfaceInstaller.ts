import {
  COROS_SFT_DATA_INDEX,
  createCorosSftDataWindows,
  createCorosSftStartCommand,
  prepareCorosRawWatchfaceTransfer,
  type CorosRawWatchfaceTransfer
} from "./corosRawWatchfaceTransfer";

// The PACE Pro exposes three Nordic-UART-like services. SFT_8 control uses
// the first service; the bulk image packets use the second.
export const COROS_CONTROL_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-77656c6f6f70";
export const COROS_CONTROL_WRITE_UUID = "6e400002-b5a3-f393-e0a9-77656c6f6f70";
export const COROS_CONTROL_NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-77656c6f6f70";
export const COROS_BULK_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const COROS_BULK_WRITE_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const COROS_BULK_NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
export const COROS_AUX_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-77757c7f7f70";
export const COROS_AUX_NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-77757c7f7f70";

const START_RESPONSE_TIMEOUT_MS = 7_000;
const BLOCK_RESPONSE_TIMEOUT_MS = 12_000;

interface CorosGattCharacteristic {
  startNotifications(): Promise<unknown>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: EventListener): void;
  removeEventListener(type: "characteristicvaluechanged", listener: EventListener): void;
}

interface CorosGattService {
  getCharacteristic(uuid: string): Promise<CorosGattCharacteristic>;
}

interface CorosGattServer {
  connected: boolean;
  connect(): Promise<CorosGattServer>;
  getPrimaryService(uuid: string): Promise<CorosGattService>;
  disconnect(): void;
}

interface CorosBluetoothDevice {
  name?: string;
  gatt?: CorosGattServer;
}

interface CorosWebBluetooth {
  requestDevice(
    options:
      | {
          acceptAllDevices: true;
          optionalServices: string[];
        }
      | {
          filters: Array<{ namePrefix?: string; services?: string[] }>;
          optionalServices: string[];
        }
  ): Promise<CorosBluetoothDevice>;
}

export interface CorosRawWatchfaceInstallProgress {
  completedBytes: number;
  totalBytes: number;
  fraction: number;
  blockIndex: number;
  blockCount: number;
}

export interface CorosRawWatchfaceInstallResult {
  deviceName: string;
  watchFaceId: number;
  transferredBytes: number;
  blockCount: number;
}

class NotificationQueue {
  private readonly values: Uint8Array[] = [];
  private wake?: () => void;

  push(value: Uint8Array): void {
    this.values.push(value);
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async waitFor(
    predicate: (value: Uint8Array) => boolean,
    timeoutMs: number,
    description: string
  ): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.values.findIndex(predicate);
      if (index >= 0) {
        return this.values.splice(index, 1)[0]!;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Timed out waiting for " + description + ".");
      }

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (this.wake === wake) this.wake = undefined;
          reject(new Error("Timed out waiting for " + description + "."));
        }, remaining);
        const wake = () => {
          window.clearTimeout(timer);
          resolve();
        };
        this.wake = wake;
      });
    }
  }
}

function notificationBytes(event: Event): Uint8Array {
  const value = (event.target as { value?: DataView } | null)?.value;
  if (!value) {
    throw new Error("COROS sent a notification without a value.");
  }
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

async function writeWithoutResponse(
  characteristic: CorosGattCharacteristic,
  bytes: Uint8Array
): Promise<void> {
  // A fresh ArrayBuffer satisfies Chromium's BufferSource typing (and avoids
  // passing a view backed by a SharedArrayBuffer through Web Bluetooth).
  const value = new Uint8Array(bytes.length);
  value.set(bytes);
  // Chromium's current API is writeValueWithoutResponse. The fallback keeps
  // this usable on older Electron/Chromium versions during development.
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(value);
    return;
  }
  if (characteristic.writeValue) {
    await characteristic.writeValue(value);
    return;
  }
  throw new Error("The connected Bluetooth adapter cannot write GATT values.");
}

export class CorosRawWatchfaceInstaller {
  private readonly controlNotifications = new NotificationQueue();
  private readonly bulkNotifications = new NotificationQueue();
  private readonly onControlNotification: EventListener;
  private readonly onBulkNotification: EventListener;

  private constructor(
    private readonly device: CorosBluetoothDevice,
    private readonly controlWrite: CorosGattCharacteristic,
    private readonly bulkWrite: CorosGattCharacteristic,
    private readonly controlNotify: CorosGattCharacteristic,
    private readonly bulkNotify: CorosGattCharacteristic,
    private readonly auxNotify: CorosGattCharacteristic
  ) {
    this.onControlNotification = (event) => this.controlNotifications.push(notificationBytes(event));
    this.onBulkNotification = (event) => this.bulkNotifications.push(notificationBytes(event));
  }

  static async connect(): Promise<CorosRawWatchfaceInstaller> {
    const bluetooth = (navigator as Navigator & { bluetooth?: CorosWebBluetooth }).bluetooth;
    if (!bluetooth) {
      throw new Error("Web Bluetooth is unavailable in this CorosLink build.");
    }

    const device = await bluetooth.requestDevice({
      // The watch does not consistently advertise its complete local name or
      // proprietary services. Electron shows the nearby-device list in our
      // own picker, then the GATT service checks below verify the choice.
      acceptAllDevices: true,
      optionalServices: [
        COROS_CONTROL_SERVICE_UUID,
        COROS_BULK_SERVICE_UUID,
        COROS_AUX_SERVICE_UUID
      ]
    });
    const server = device.gatt;
    if (!server) {
      throw new Error("The selected COROS device does not expose a GATT server.");
    }

    try {
      const connected = server.connected ? server : await server.connect();
      const controlService = await connected.getPrimaryService(COROS_CONTROL_SERVICE_UUID);
      const bulkService = await connected.getPrimaryService(COROS_BULK_SERVICE_UUID);
      const auxService = await connected.getPrimaryService(COROS_AUX_SERVICE_UUID);
      const installer = new CorosRawWatchfaceInstaller(
        device,
        await controlService.getCharacteristic(COROS_CONTROL_WRITE_UUID),
        await bulkService.getCharacteristic(COROS_BULK_WRITE_UUID),
        await controlService.getCharacteristic(COROS_CONTROL_NOTIFY_UUID),
        await bulkService.getCharacteristic(COROS_BULK_NOTIFY_UUID),
        await auxService.getCharacteristic(COROS_AUX_NOTIFY_UUID)
      );
      installer.controlNotify.addEventListener("characteristicvaluechanged", installer.onControlNotification);
      installer.bulkNotify.addEventListener("characteristicvaluechanged", installer.onBulkNotification);
      await Promise.all([
        installer.controlNotify.startNotifications(),
        installer.bulkNotify.startNotifications(),
        // The official client subscribes to all three proprietary COROS
        // notification channels before its protected traffic starts.
        installer.auxNotify.startNotifications()
      ]);
      return installer;
    } catch (error) {
      // Do not strand a connected watch when a later discovery or
      // notification setup step fails; otherwise it may stop advertising for
      // the next picker attempt.
      server.disconnect();
      throw error;
    }
  }

  get deviceName(): string {
    return this.device.name?.trim() || "COROS watch";
  }

  async install(
    rawBin: Uint8Array,
    onProgress?: (progress: CorosRawWatchfaceInstallProgress) => void
  ): Promise<CorosRawWatchfaceInstallResult> {
    const transfer = prepareCorosRawWatchfaceTransfer(rawBin);
    for (const [blockIndex, block] of transfer.blocks.entries()) {
      await this.sendBlock(block, transfer, blockIndex, onProgress);
    }

    // 0x7808000001 is the captured Transaction stop code. The Android app
    // reports it locally after the final acknowledgement; it does not perform
    // another characteristic write. Reaching this point is the equivalent
    // terminal condition.
    return {
      deviceName: this.deviceName,
      watchFaceId: transfer.bin.watchFaceId,
      transferredBytes: transfer.bytes.length,
      blockCount: transfer.blocks.length
    };
  }

  disconnect(): void {
    this.controlNotify.removeEventListener("characteristicvaluechanged", this.onControlNotification);
    this.bulkNotify.removeEventListener("characteristicvaluechanged", this.onBulkNotification);
    this.device.gatt?.disconnect();
  }

  private async sendBlock(
    block: CorosRawWatchfaceTransfer["blocks"][number],
    transfer: CorosRawWatchfaceTransfer,
    blockIndex: number,
    onProgress?: (progress: CorosRawWatchfaceInstallProgress) => void
  ): Promise<void> {
    let ready = false;
    for (let attempt = 0; attempt < 2 && !ready; attempt += 1) {
      await writeWithoutResponse(this.controlWrite, createCorosSftStartCommand(block));
      let response: Uint8Array;
      try {
        response = await this.controlNotifications.waitFor(
          (value) => startsWith(value, [0x78, 0x00, 0x00]),
          START_RESPONSE_TIMEOUT_MS,
          "the watch to accept the next SFT block"
        );
      } catch (error) {
        if (blockIndex === 0) {
          throw new Error(
            "The watch did not acknowledge SFT. It requires the per-watch COROS SystemBind authentication session before direct transfer; that challenge-response is not implemented yet."
          );
        }
        throw error;
      }
      ready = startsWith(response, [0x78, 0x00, 0x00, 0x01, 0xf0, 0x1a, 0x01, 0x03, 0x0f]);
    }
    if (!ready) {
      throw new Error("The watch rejected the SFT block start request.");
    }

    const windows = createCorosSftDataWindows(block);
    for (const [windowIndex, window] of windows.entries()) {
      for (const packet of window) {
        if (packet.bytes[2] !== COROS_SFT_DATA_INDEX) {
          throw new Error("Generated an invalid COROS bulk packet.");
        }
        await writeWithoutResponse(this.bulkWrite, packet.bytes);
      }
      if (windowIndex < windows.length - 1) {
        await this.bulkNotifications.waitFor(
          (value) => startsWith(value, [0x78, 0x00]),
          BLOCK_RESPONSE_TIMEOUT_MS,
          "the watch to acknowledge the SFT packet window"
        );
      }
    }

    await this.controlNotifications.waitFor(
      (value) => startsWith(value, [0x78, 0x00, 0x01, 0x01, COROS_SFT_DATA_INDEX]),
      BLOCK_RESPONSE_TIMEOUT_MS,
      "the watch to verify the SFT block"
    );

    const completedBytes = block.offset + block.bytes.length;
    onProgress?.({
      completedBytes,
      totalBytes: transfer.bytes.length,
      fraction: completedBytes / transfer.bytes.length,
      blockIndex,
      blockCount: transfer.blocks.length
    });
  }
}
