import assert from "node:assert/strict";

const {
  COROS_SFT_BLOCK_SIZE,
  COROS_SFT_PACKETS_PER_WINDOW,
  corosByteSum,
  crc16CcittFalse,
  createCorosRawWatchfaceEnvelope,
  createCorosSftDataWindows,
  createCorosSftStartCommand,
  createCorosSftStopCommand,
  inspectCorosRawWatchfaceBin,
  prepareCorosRawWatchfaceTransfer
} = await import("../src/watchfaces/corosRawWatchfaceTransfer.ts");

function makeLegacyBin(payloadBytes) {
  const bytes = new Uint8Array(0x12 + payloadBytes);
  bytes.set([0x36, 0x31, 0x34, 0x41], 0);
  const view = new DataView(bytes.buffer);
  view.setInt32(4, 1000000819, true);
  view.setUint32(8, payloadBytes, true);
  for (let index = 0; index < payloadBytes; index += 1) {
    bytes[0x12 + index] = (index * 31 + 17) & 0xff;
  }
  view.setUint16(12, crc16CcittFalse(bytes.subarray(0x12)), true);
  return bytes;
}

const raw = makeLegacyBin(20_000);
const metadata = inspectCorosRawWatchfaceBin(raw);
assert.equal(metadata.watchFaceId, 1000000819);
assert.equal(metadata.declaredPayloadBytes, 20_000);
assert.equal(metadata.payloadCrc16, crc16CcittFalse(raw.subarray(0x12)));
assert.equal(metadata.fullFileCrc16, crc16CcittFalse(raw));

const envelope = createCorosRawWatchfaceEnvelope(raw);
assert.deepEqual(
  [...envelope.subarray(0, 8)],
  [0x48, 0x46, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]
);
assert.equal(new DataView(envelope.buffer).getUint32(8, true), raw.length);
assert.equal(
  new DataView(envelope.buffer).getUint16(14, true),
  crc16CcittFalse(envelope.subarray(0, 14)),
  "the envelope tail must be the header CRC, not a captured nonce"
);

const transfer = prepareCorosRawWatchfaceTransfer(raw);
assert.equal(transfer.bytes.length, raw.length + 16);
assert.equal(transfer.blocks.length, 2);
assert.equal(transfer.blocks[0].bytes.length, COROS_SFT_BLOCK_SIZE);
assert.equal(transfer.blocks[1].bytes.length, transfer.bytes.length - COROS_SFT_BLOCK_SIZE);
assert.equal(transfer.blocks[0].remainingBytes, transfer.bytes.length);
assert.equal(transfer.blocks[0].crc16, crc16CcittFalse(transfer.blocks[0].bytes));
assert.equal(transfer.blocks[0].byteSum, corosByteSum(transfer.blocks[0].bytes));

const start = createCorosSftStartCommand(transfer.blocks[0]);
assert.equal(start.length, 21);
assert.deepEqual([...start.subarray(0, 4)], [0x78, 0x00, 0x08, 0x00]);
assert.equal(new DataView(start.buffer).getUint16(7, true), COROS_SFT_BLOCK_SIZE);
assert.equal(new DataView(start.buffer).getUint16(13, true), transfer.blocks[0].crc16);
assert.equal(start[15], transfer.blocks[0].byteSum);
assert.deepEqual([...start.subarray(16, 20)], [0x01, 0x00, 0x00, 0x03]);
assert.equal(start[20], corosByteSum(start.subarray(0, 20)) ^ 0x88);

const finalStart = createCorosSftStartCommand(transfer.blocks[1]);
assert.equal(
  new DataView(finalStart.buffer).getUint16(7, true),
  transfer.blocks[1].bytes.length,
  "the final SFT command must declare its short actual block length"
);

const windows = createCorosSftDataWindows(transfer.blocks[0]);
assert.equal(windows.length, 2, "a full 12,288-byte block is two 26-packet windows");
assert.equal(windows[0].length, COROS_SFT_PACKETS_PER_WINDOW);
assert.equal(windows[1].length, COROS_SFT_PACKETS_PER_WINDOW);
assert.equal(windows[0][0].bytes.length, 240);
assert.equal(windows[1].at(-1).bytes.length, 204);
assert.deepEqual([...windows[0][0].bytes.subarray(0, 3)], [0x78, 0, 0x08]);
assert.deepEqual([...windows[1][0].bytes.subarray(0, 3)], [0x78, 0, 0x08]);
assert.deepEqual([...createCorosSftStopCommand()], [0x78, 0x08, 0x00, 0x00, 0x01]);

const malformed = raw.slice();
malformed[0x12] ^= 0xff;
assert.throws(() => inspectCorosRawWatchfaceBin(malformed), /payload CRC is invalid/);
assert.throws(() => inspectCorosRawWatchfaceBin(new Uint8Array([1, 2, 3])), /smaller than/);
assert.throws(
  () => inspectCorosRawWatchfaceBin(Uint8Array.from([0x43, 0x4f, 0x4d, 0x50, ...raw])),
  /legacy 614A/
);

console.log("COROS raw watch-face transfer protocol test passed");
