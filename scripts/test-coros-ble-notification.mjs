import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { encodeNotificationFrames } = require("../dist-electron/corosBleNotificationProtocol.js");
const message = { title: "CorosLink", body: "Test value: 123" };
const expected = [
  "79038100116f72672e636f726f736c696e6b2e61",
  "7902017070100a436f726f734c696e6b00201054",
  "7901016573742076616c75653a20313233003001",
  "79000100"
];
assert.deepEqual(encodeNotificationFrames(message).map(frame => frame.toString("hex")), expected,
  "must match the packet already verified through original W332 firmware instructions");
const single = encodeNotificationFrames(message, 64, 127);
assert.equal(single.length, 1);
assert.deepEqual([...single[0].subarray(0, 3)], [0x79, 0, 0xff]);
const unicode = encodeNotificationFrames({ title: "Temperature", body: "21 °C\nSensor A" });
const payload = Buffer.concat(unicode.map(frame => frame.subarray(3)));
assert.ok(payload.includes(Buffer.from("21 °C\nSensor A\0")));
assert.equal(payload.at(-1), 0, "ends in ordinary event0, with no command checksum");
assert.throws(() => encodeNotificationFrames({ title: "é".repeat(16), body: "test" }), /UTF-8 bytes/);
assert.throws(() => encodeNotificationFrames({ title: "Test", body: "a".repeat(512) }), /UTF-8 bytes/);
assert.throws(() => encodeNotificationFrames({ title: "Test", body: "a\0b" }), /null/);
assert.throws(() => encodeNotificationFrames(message, 3), /frame size/);
assert.throws(() => encodeNotificationFrames({ ...message, appId: "appé" }), /ASCII/);
console.log("Notification packets match the native firmware fixture; UTF-8 limits and framing checks passed.");
