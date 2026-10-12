import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { encodeWatchfaceFile, encodeWatchfaceBlockHeader, decodeWatchfaceInventory, emptyWatchfaceSlot, selectWatchfaceSlot } = require("../dist-electron/corosBleWatchfaceProtocol.js");
const { crc16Ccitt } = require("../dist-electron/corosBleRouteProtocol.js");
export function fixtureFace() {
  const body = Buffer.alloc(12_000);
  body.write("614A"); body.writeUInt32LE(12345, 4); body.writeUInt32LE(body.length - 18, 8);
  body.writeUInt16LE(0x340, 0x138); body.writeUInt16LE(crc16Ccitt(body.subarray(18)), 12);
  return body;
}
const body = fixtureFace();
const { file, faceId } = encodeWatchfaceFile(body);
assert.equal(faceId, 12345); assert.equal(file.readUInt16LE(14), crc16Ccitt(file.subarray(0, 14)));
assert.equal(file.readUInt16LE(12), crc16Ccitt(body)); assert.equal(file[3], 8);
for (const size of [20, 40]) {
  const inventory = Buffer.alloc(size, 0xff); inventory.writeUInt32LE(27, 0);
  const ids = decodeWatchfaceInventory(inventory); assert.equal(ids.length, 10); assert.equal(emptyWatchfaceSlot(ids), 1);
}
assert.throws(() => emptyWatchfaceSlot(Array(10).fill(1)), /occupied/);
assert.equal(selectWatchfaceSlot(Array(10).fill(1), {slot: 4, expectedFaceId: 1, replaceExisting: true}), 4);
assert.equal(selectWatchfaceSlot(Array(10).fill(0xffffffff), {slot: 7, expectedFaceId: null, replaceExisting: false}), 7);
assert.throws(() => selectWatchfaceSlot(Array(10).fill(1), {slot: 4, expectedFaceId: 1, replaceExisting: false}), /replacement/);
assert.throws(() => selectWatchfaceSlot(Array(10).fill(2), {slot: 4, expectedFaceId: 1, replaceExisting: true}), /changed/);
assert.throws(() => selectWatchfaceSlot(Array(10).fill(1), {slot: 4, expectedFaceId: null, replaceExisting: false}), /changed/);
assert.throws(() => selectWatchfaceSlot(Array(10).fill(1), {slot: 10, expectedFaceId: 1, replaceExisting: true}), /valid/);
assert.throws(() => decodeWatchfaceInventory(Buffer.alloc(21)), /unsupported/);
for (const [offset, value] of [[0, 0], [8, 0], [12, 0], [0x139, 0xff], [0x500, 1]]) {
  const bad = Buffer.from(body); bad[offset] = value;
  assert.throws(() => encodeWatchfaceFile(bad));
}
assert.throws(() => encodeWatchfaceFile(Buffer.from("PK")), /compiled/);
for (let offset = 0; offset < file.length; offset += 4096) {
  const block = file.subarray(offset, offset + 4096), h = encodeWatchfaceBlockHeader(block, offset, file.length, 9);
  assert.deepEqual(Array.from(h.subarray(0, 3)), [0x78, 0, 8]);
  assert.equal(h.readUInt32LE(3), offset); assert.equal(h.readUInt16LE(7), block.length);
  assert.equal(h.readUInt16LE(13), crc16Ccitt(block)); assert.equal(h[16], 9);
  assert.equal(h[20], h.subarray(2, 20).reduce((sum, b) => (sum + b) & 255, 0));
}
assert.throws(() => encodeWatchfaceBlockHeader(Buffer.alloc(4097), 0, 5000, 0));
assert.throws(() => encodeWatchfaceBlockHeader(Buffer.alloc(2), 0, 2, 10));
console.log("Compiled watch face validation, inventory, empty-slot selection and SFT framing passed.");
