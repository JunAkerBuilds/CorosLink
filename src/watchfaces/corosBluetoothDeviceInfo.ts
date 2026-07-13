const GENERIC_ACCESS_SERVICE_UUID = "00001800-0000-1000-8000-00805f9b34fb";
const DEVICE_INFORMATION_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
const BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
// Kept in step with the raw installer; this read-only module cannot import it
// because the standalone Node safety test loads TypeScript without Vite's
// extensionless-module resolver.
const COROS_CONTROL_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-77656c6f6f70";
const COROS_BULK_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const COROS_AUX_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-77757c7f7f70";

const DEVICE_NAME_CHARACTERISTIC_UUID = "00002a00-0000-1000-8000-00805f9b34fb";
const MODEL_NUMBER_CHARACTERISTIC_UUID = "00002a24-0000-1000-8000-00805f9b34fb";
const SERIAL_NUMBER_CHARACTERISTIC_UUID = "00002a25-0000-1000-8000-00805f9b34fb";
const FIRMWARE_REVISION_CHARACTERISTIC_UUID = "00002a26-0000-1000-8000-00805f9b34fb";
const HARDWARE_REVISION_CHARACTERISTIC_UUID = "00002a27-0000-1000-8000-00805f9b34fb";
const SOFTWARE_REVISION_CHARACTERISTIC_UUID = "00002a28-0000-1000-8000-00805f9b34fb";
const MANUFACTURER_NAME_CHARACTERISTIC_UUID = "00002a29-0000-1000-8000-00805f9b34fb";
const BATTERY_LEVEL_CHARACTERISTIC_UUID = "00002a19-0000-1000-8000-00805f9b34fb";

interface CorosGattCharacteristicProperties {
  broadcast?: boolean;
  indicate?: boolean;
  notify?: boolean;
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
}

interface CorosGattCharacteristic {
  uuid: string;
  properties: CorosGattCharacteristicProperties;
  readValue(): Promise<DataView>;
}

interface CorosGattService {
  getCharacteristic(uuid: string): Promise<CorosGattCharacteristic>;
  getCharacteristics(): Promise<CorosGattCharacteristic[]>;
}

interface CorosGattServer {
  connected: boolean;
  connect(): Promise<CorosGattServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<CorosGattService>;
}

interface CorosBluetoothDevice {
  name?: string;
  gatt?: CorosGattServer;
}

interface CorosWebBluetooth {
  requestDevice(options: {
    acceptAllDevices: true;
    optionalServices: string[];
  }): Promise<CorosBluetoothDevice>;
}

export type CorosGattCapability = "read" | "write" | "write without response" | "notify" | "indicate";

export interface CorosGattCharacteristicSnapshot {
  uuid: string;
  capabilities: CorosGattCapability[];
}

export interface CorosResolvedGattChannel {
  description: string;
  serviceHandleRange: string;
  watchToApp: {
    handle: string;
    access: string;
  };
  appToWatch: {
    handle: string;
    access: string;
  };
}

export interface CorosGattServiceSnapshot {
  uuid: string;
  label: string;
  available: boolean;
  error?: string;
  characteristics: CorosGattCharacteristicSnapshot[];
  resolvedChannel?: CorosResolvedGattChannel;
}

export interface CorosBluetoothDeviceSnapshot {
  deviceName: string;
  connected: boolean;
  updatedAt: number;
  deviceNameValue?: string;
  modelNumber?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
  softwareRevision?: string;
  manufacturerName?: string;
  batteryPercent?: number;
  services: CorosGattServiceSnapshot[];
}

interface ServiceDefinition {
  uuid: string;
  label: string;
  resolvedChannel?: CorosResolvedGattChannel;
}

// Web Bluetooth exposes service and characteristic UUIDs, but intentionally
// hides ATT handles. These ranges were verified passively from this PACE Pro's
// live GATT discovery. They are shown only when the matching COROS UART-style
// characteristic pair is actually exposed by the selected watch.
const RESOLVED_PACE_PRO_CHANNELS = {
  control: {
    description: "COROS control messages",
    serviceHandleRange: "0x0014-0x0019",
    watchToApp: { handle: "0x0016", access: "notify" },
    appToWatch: { handle: "0x0019", access: "write without response" }
  },
  bulk: {
    description: "COROS bulk transfer channel",
    serviceHandleRange: "0x001A-0x001F",
    watchToApp: { handle: "0x001C", access: "notify" },
    appToWatch: { handle: "0x001F", access: "write without response" }
  },
  auxiliary: {
    description: "COROS auxiliary channel",
    serviceHandleRange: "0x0020-0x0025",
    watchToApp: { handle: "0x0022", access: "notify" },
    appToWatch: { handle: "0x0025", access: "write without response" }
  }
} as const satisfies Record<string, CorosResolvedGattChannel>;

const SERVICE_DEFINITIONS: readonly ServiceDefinition[] = [
  { uuid: GENERIC_ACCESS_SERVICE_UUID, label: "Generic Access" },
  { uuid: DEVICE_INFORMATION_SERVICE_UUID, label: "Device Information" },
  { uuid: BATTERY_SERVICE_UUID, label: "Battery" },
  {
    uuid: COROS_CONTROL_SERVICE_UUID,
    label: "COROS control",
    resolvedChannel: RESOLVED_PACE_PRO_CHANNELS.control
  },
  {
    uuid: COROS_BULK_SERVICE_UUID,
    label: "COROS bulk",
    resolvedChannel: RESOLVED_PACE_PRO_CHANNELS.bulk
  },
  {
    uuid: COROS_AUX_SERVICE_UUID,
    label: "COROS auxiliary",
    resolvedChannel: RESOLVED_PACE_PRO_CHANNELS.auxiliary
  }
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function capabilities(properties: CorosGattCharacteristicProperties): CorosGattCapability[] {
  const result: CorosGattCapability[] = [];
  if (properties.read) result.push("read");
  if (properties.write) result.push("write");
  if (properties.writeWithoutResponse) result.push("write without response");
  if (properties.notify) result.push("notify");
  if (properties.indicate) result.push("indicate");
  return result;
}

function decodeText(value: DataView): string {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextDecoder().decode(bytes).replace(/\0+$/u, "").trim();
}

async function inspectService(
  server: CorosGattServer,
  definition: ServiceDefinition
): Promise<{ service?: CorosGattService; snapshot: CorosGattServiceSnapshot }> {
  try {
    const service = await server.getPrimaryService(definition.uuid);
    const characteristics = await service.getCharacteristics();
    const characteristicSnapshots = characteristics.map((characteristic) => ({
      uuid: characteristic.uuid,
      capabilities: capabilities(characteristic.properties)
    }));
    const characteristicUuids = new Set(characteristicSnapshots.map((characteristic) => characteristic.uuid));
    const hasCorosChannelPair = characteristicUuids.has(
      definition.uuid.replace("0001", "0003")
    ) && characteristicUuids.has(definition.uuid.replace("0001", "0002"));
    return {
      service,
      snapshot: {
        uuid: definition.uuid,
        label: definition.label,
        available: true,
        characteristics: characteristicSnapshots,
        resolvedChannel: hasCorosChannelPair ? definition.resolvedChannel : undefined
      }
    };
  } catch (error) {
    return {
      snapshot: {
        uuid: definition.uuid,
        label: definition.label,
        available: false,
        error: errorMessage(error),
        characteristics: []
      }
    };
  }
}

async function readTextCharacteristic(
  service: CorosGattService | undefined,
  characteristicUuid: string
): Promise<string | undefined> {
  if (!service) return undefined;
  try {
    const characteristic = await service.getCharacteristic(characteristicUuid);
    if (!characteristic.properties.read) return undefined;
    return decodeText(await characteristic.readValue());
  } catch {
    return undefined;
  }
}

async function readBatteryLevel(service: CorosGattService | undefined): Promise<number | undefined> {
  if (!service) return undefined;
  try {
    const characteristic = await service.getCharacteristic(BATTERY_LEVEL_CHARACTERISTIC_UUID);
    if (!characteristic.properties.read) return undefined;
    const value = await characteristic.readValue();
    const percent = value.getUint8(0);
    return percent <= 100 ? percent : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A read-only GATT session. It intentionally never calls proprietary read,
 * write, or notification APIs: only standard Device Information, Generic
 * Access, and Battery characteristics are read when the watch exposes them.
 */
export class CorosBluetoothDeviceInfoSession {
  private readonly device: CorosBluetoothDevice;
  snapshot: CorosBluetoothDeviceSnapshot;

  private constructor(device: CorosBluetoothDevice, snapshot: CorosBluetoothDeviceSnapshot) {
    this.device = device;
    this.snapshot = snapshot;
  }

  get deviceName(): string {
    return this.snapshot.deviceName;
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }

  /** Refreshes only the standard Battery Service value. */
  async refresh(): Promise<CorosBluetoothDeviceSnapshot> {
    const server = this.device.gatt;
    if (!server?.connected) {
      this.snapshot = { ...this.snapshot, connected: false };
      throw new Error("The read-only Bluetooth connection is no longer active.");
    }

    try {
      const batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
      const batteryPercent = await readBatteryLevel(batteryService);
      this.snapshot = {
        ...this.snapshot,
        connected: server.connected,
        batteryPercent,
        updatedAt: Date.now()
      };
      return this.snapshot;
    } catch (error) {
      this.snapshot = { ...this.snapshot, connected: server.connected };
      throw new Error(`Could not refresh the standard battery value: ${errorMessage(error)}`);
    }
  }

  static async connect(): Promise<CorosBluetoothDeviceInfoSession> {
    const bluetooth = (navigator as Navigator & { bluetooth?: CorosWebBluetooth }).bluetooth;
    if (!bluetooth) {
      throw new Error("Web Bluetooth is unavailable in this CorosLink build.");
    }
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICE_DEFINITIONS.map((service) => service.uuid)
    });
    const server = device.gatt;
    if (!server) throw new Error("The selected device does not expose a GATT server.");

    try {
      const connected = server.connected ? server : await server.connect();
      const inspected = await Promise.all(
        SERVICE_DEFINITIONS.map((definition) => inspectService(connected, definition))
      );
      const services = new Map(
        inspected.map(({ snapshot, service }) => [snapshot.uuid, service] as const)
      );
      const snapshot: CorosBluetoothDeviceSnapshot = {
        deviceName: device.name || "Unnamed Bluetooth device",
        connected: connected.connected,
        updatedAt: Date.now(),
        deviceNameValue: await readTextCharacteristic(
          services.get(GENERIC_ACCESS_SERVICE_UUID),
          DEVICE_NAME_CHARACTERISTIC_UUID
        ),
        modelNumber: await readTextCharacteristic(
          services.get(DEVICE_INFORMATION_SERVICE_UUID),
          MODEL_NUMBER_CHARACTERISTIC_UUID
        ),
        serialNumber: await readTextCharacteristic(
          services.get(DEVICE_INFORMATION_SERVICE_UUID),
          SERIAL_NUMBER_CHARACTERISTIC_UUID
        ),
        firmwareRevision: await readTextCharacteristic(
          services.get(DEVICE_INFORMATION_SERVICE_UUID),
          FIRMWARE_REVISION_CHARACTERISTIC_UUID
        ),
        hardwareRevision: await readTextCharacteristic(
          services.get(DEVICE_INFORMATION_SERVICE_UUID),
          HARDWARE_REVISION_CHARACTERISTIC_UUID
        ),
        softwareRevision: await readTextCharacteristic(
          services.get(DEVICE_INFORMATION_SERVICE_UUID),
          SOFTWARE_REVISION_CHARACTERISTIC_UUID
        ),
        manufacturerName: await readTextCharacteristic(
          services.get(DEVICE_INFORMATION_SERVICE_UUID),
          MANUFACTURER_NAME_CHARACTERISTIC_UUID
        ),
        batteryPercent: await readBatteryLevel(services.get(BATTERY_SERVICE_UUID)),
        services: inspected.map(({ snapshot: serviceSnapshot }) => serviceSnapshot)
      };
      return new CorosBluetoothDeviceInfoSession(device, snapshot);
    } catch (error) {
      server.disconnect();
      throw error;
    }
  }
}
