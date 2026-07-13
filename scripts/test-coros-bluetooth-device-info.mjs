import assert from "node:assert/strict";

const requested = [];
const readRequests = [];
let disconnects = 0;

function textValue(value) {
  return new TextEncoder().encode(value).buffer;
}

function characteristic(uuid, value, properties = { read: true }) {
  return {
    uuid,
    properties,
    async readValue() {
      readRequests.push(uuid);
      const buffer = value instanceof ArrayBuffer ? value : textValue(value);
      return new DataView(buffer);
    }
  };
}

function service(characteristics) {
  return {
    async getCharacteristics() {
      return characteristics;
    },
    async getCharacteristic(uuid) {
      const result = characteristics.find((candidate) => candidate.uuid === uuid);
      if (!result) throw new Error("Characteristic not found");
      return result;
    }
  };
}

const genericAccess = service([
  characteristic("00002a00-0000-1000-8000-00805f9b34fb", "PACE Pro")
]);
const deviceInformation = service([
  characteristic("00002a24-0000-1000-8000-00805f9b34fb", "W332"),
  characteristic("00002a25-0000-1000-8000-00805f9b34fb", "serial-123"),
  characteristic("00002a26-0000-1000-8000-00805f9b34fb", "3.1708.0"),
  characteristic("00002a29-0000-1000-8000-00805f9b34fb", "COROS")
]);
const battery = service([
  characteristic("00002a19-0000-1000-8000-00805f9b34fb", Uint8Array.of(87).buffer)
]);
function proprietaryService(serviceUuid) {
  return service([
    characteristic(serviceUuid.replace("0001", "0003"), "must not be read", { read: true, notify: true }),
    characteristic(serviceUuid.replace("0001", "0002"), "must not be read", { writeWithoutResponse: true })
  ]);
}

const control = proprietaryService("6e400001-b5a3-f393-e0a9-77656c6f6f70");
const bulk = proprietaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
const auxiliary = proprietaryService("6e400001-b5a3-f393-e0a9-77757c7f7f70");
const services = new Map([
  ["00001800-0000-1000-8000-00805f9b34fb", genericAccess],
  ["0000180a-0000-1000-8000-00805f9b34fb", deviceInformation],
  ["0000180f-0000-1000-8000-00805f9b34fb", battery],
  ["6e400001-b5a3-f393-e0a9-77656c6f6f70", control],
  ["6e400001-b5a3-f393-e0a9-e50e24dcca9e", bulk],
  ["6e400001-b5a3-f393-e0a9-77757c7f7f70", auxiliary]
]);
const server = {
  connected: false,
  async connect() {
    this.connected = true;
    return this;
  },
  disconnect() {
    this.connected = false;
    disconnects += 1;
  },
  async getPrimaryService(uuid) {
    const result = services.get(uuid);
    if (!result) throw new Error("Service not found");
    return result;
  }
};

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    bluetooth: {
      async requestDevice(options) {
        requested.push(options);
        return { name: "PACE Pro", gatt: server };
      }
    }
  }
});

const { CorosBluetoothDeviceInfoSession } = await import(
  "../src/watchfaces/corosBluetoothDeviceInfo.ts"
);
const session = await CorosBluetoothDeviceInfoSession.connect();

assert.equal(requested.length, 1);
assert.equal(requested[0].acceptAllDevices, true);
assert.equal(requested[0].optionalServices.length, 6);
assert.equal(session.snapshot.deviceName, "PACE Pro");
assert.equal(session.snapshot.modelNumber, "W332");
assert.equal(session.snapshot.serialNumber, "serial-123");
assert.equal(session.snapshot.firmwareRevision, "3.1708.0");
assert.equal(session.snapshot.manufacturerName, "COROS");
assert.equal(session.snapshot.batteryPercent, 87);
assert.equal(session.snapshot.services.filter((entry) => entry.available).length, 6);
assert.deepEqual(
  session.snapshot.services
    .flatMap((entry) => entry.resolvedChannel?.serviceHandleRange ?? [])
    .sort(),
  ["0x0014-0x0019", "0x001A-0x001F", "0x0020-0x0025"],
  "matching COROS services should expose the verified PACE Pro handle map"
);
const refreshedSnapshot = await session.refresh();
assert.equal(refreshedSnapshot.batteryPercent, 87);
assert.equal(
  readRequests.filter((uuid) => uuid === "00002a19-0000-1000-8000-00805f9b34fb").length,
  2,
  "refresh must reread only the standard Battery Service"
);
assert.equal(
  readRequests.some((uuid) => uuid.startsWith("6e400")),
  false,
  "read-only inspection must never read a proprietary COROS characteristic"
);
session.disconnect();
assert.equal(disconnects, 1);

console.log("COROS read-only device information test passed");
