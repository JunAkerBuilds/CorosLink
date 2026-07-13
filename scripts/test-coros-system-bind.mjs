import assert from "node:assert/strict";

const {
  COROS_SYSTEM_BIND_OPCODE,
  COROS_SYSTEM_BIND_AUTH_COMPRESSED_BYTES,
  COROS_SYSTEM_BIND_AUTH_METADATA,
  COROS_SYSTEM_BIND_PAYLOAD_BYTES,
  corosV2Checksum,
  createCorosAuthenticatedSystemBindPayload,
  createCorosSystemBindPayload,
  createCorosV2ControlFrames,
  crc32Mpeg2,
  decodeCorosV2ControlFrames,
  deriveCorosSystemBondId
} = await import("../src/watchfaces/corosSystemBind.ts");

// CRC-32/MPEG-2's public check value gives the hash implementation a stable
// vector that contains no account or capture data.
assert.equal(crc32Mpeg2(new TextEncoder().encode("123456789")), 0x0376e6e7);

// Account ID 1 is the LE u64 `01 00 ...`; the expected CRC is derived from
// the public algorithm, not a captured personal identifier.
assert.deepEqual([...deriveCorosSystemBondId("1")], [0x93, 0x67, 0xa5, 0x32]);
assert.throws(() => deriveCorosSystemBondId("not-a-number"), /decimal integer/);
assert.throws(() => deriveCorosSystemBondId("18446744073709551616"), /64-bit/);

const payload = createCorosSystemBindPayload({
  accountUserId: "1",
  utcSeconds: 0x12345678,
  timezoneQuarterHours: -16,
  language: 1,
  timeFormat: 1,
  metricInch: 1,
  activate: 0,
  defaultMap: 1,
  temperatureReserved: 2,
  customInfo: 7
});
assert.equal(payload.length, COROS_SYSTEM_BIND_PAYLOAD_BYTES);
assert.equal(payload[0], 1, "the captured client identifies itself as Android");
assert.deepEqual([...payload.subarray(1, 5)], [0x93, 0x67, 0xa5, 0x32]);
assert.deepEqual([...payload.subarray(5, 9)], [0x78, 0x56, 0x34, 0x12]);
assert.equal(payload[9], 0xf0);
assert.equal(payload[10], 1);
assert.equal(payload[11], 0x2b, "the display flags and temperature-reserved nibble share byte 11");
assert.deepEqual([...payload.subarray(12, 16)], [7, 0, 0, 0]);
assert.equal(payload[16], 0x80, "SystemBind uses the check-command flag");

const frames = createCorosV2ControlFrames(COROS_SYSTEM_BIND_OPCODE, payload);
assert.equal(frames.length, 1);
assert.equal(frames[0].length, 20);
assert.deepEqual([...frames[0].subarray(0, 2)], [0xa5, 0]);
assert.deepEqual([...frames[0].subarray(2, 19)], [...payload]);
assert.equal(frames[0][19], corosV2Checksum(payload));
const decodedBind = decodeCorosV2ControlFrames(frames);
assert.equal(decodedBind.opcode, COROS_SYSTEM_BIND_OPCODE);
assert.equal(decodedBind.checksumVerified, true);
assert.deepEqual([...decodedBind.payload], [...payload]);

const authenticatedPayload = createCorosAuthenticatedSystemBindPayload(
  {
    accountUserId: "1",
    utcSeconds: 0x12345678,
    timezoneQuarterHours: -16,
    language: 1,
    timeFormat: 1,
    metricInch: 1,
    activate: 0,
    defaultMap: 1,
    temperatureReserved: 2,
    customInfo: 7
  },
  { compressedData: Uint8Array.from({ length: COROS_SYSTEM_BIND_AUTH_COMPRESSED_BYTES }, (_, index) => index) }
);
assert.equal(authenticatedPayload.length, 293);
assert.deepEqual([...authenticatedPayload.subarray(0, 17)], [...payload]);
assert.deepEqual(
  [...authenticatedPayload.subarray(17, 17 + COROS_SYSTEM_BIND_AUTH_METADATA.length)],
  [...COROS_SYSTEM_BIND_AUTH_METADATA]
);
const authenticatedFrames = createCorosV2ControlFrames(COROS_SYSTEM_BIND_OPCODE, authenticatedPayload, {
  maximumWriteBytes: 240
});
assert.deepEqual(authenticatedFrames.map((frame) => frame.length), [240, 58]);
assert.deepEqual(authenticatedFrames.map((frame) => frame[1]), [1, 0]);
assert.deepEqual(
  [...decodeCorosV2ControlFrames(authenticatedFrames).payload],
  [...authenticatedPayload]
);
assert.throws(
  () => createCorosAuthenticatedSystemBindPayload(
    {
      accountUserId: "1",
      utcSeconds: 1,
      timezoneQuarterHours: 0,
      language: 1,
      timeFormat: 1,
      metricInch: 1,
      activate: 1,
      defaultMap: 1,
      temperatureReserved: 0,
      customInfo: 7
    },
    { compressedData: new Uint8Array(1) }
  ),
  /268 bytes/
);

const splitFrames = createCorosV2ControlFrames(0xa5, Uint8Array.from({ length: 40 }, (_, index) => index));
assert.deepEqual(splitFrames.map((frame) => frame.length), [20, 20, 7]);
assert.deepEqual(splitFrames.map((frame) => frame[1]), [2, 1, 0]);
assert.equal(splitFrames.at(-1)?.at(-1), corosV2Checksum(Uint8Array.from({ length: 40 }, (_, index) => index)));
const decodedSplit = decodeCorosV2ControlFrames(splitFrames);
assert.equal(decodedSplit.payload.length, 40);
assert.equal(decodedSplit.payload[39], 39);

const unchecked = createCorosV2ControlFrames(0xb0, Uint8Array.of(1, 2, 3), { includeChecksum: false });
assert.deepEqual([...unchecked[0]], [0xb0, 0, 1, 2, 3]);
assert.deepEqual(
  [...decodeCorosV2ControlFrames(unchecked, { includeChecksum: false }).payload],
  [1, 2, 3]
);
assert.throws(
  () => decodeCorosV2ControlFrames([splitFrames[0], Uint8Array.from([0xa5, 0, 1])]),
  /continuation count/
);
const corrupt = frames.map((frame) => frame.slice());
corrupt[0][19] ^= 0xff;
assert.throws(() => decodeCorosV2ControlFrames(corrupt), /checksum mismatch/);

assert.throws(
  () => createCorosSystemBindPayload({ ...{
    accountUserId: "1",
    utcSeconds: 1,
    timezoneQuarterHours: 0,
    language: 1,
    timeFormat: 1,
    metricInch: 1,
    activate: 1,
    defaultMap: 1,
    temperatureReserved: 0,
    customInfo: 7
  }, timezoneQuarterHours: 128 }),
  /signed 8-bit/
);

console.log("COROS SystemBind protocol primitive test passed");
