import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { encodeWirelessAudioInventoryQuery, decodeWirelessAudioInventory } = require("../dist-electron/corosWirelessAudioProtocol.js");

assert.equal(encodeWirelessAudioInventoryQuery().toString("hex"), "0e0100000001000200ffff");
function record(id, subtype = 0, size = 1234) {
  const row = Buffer.alloc(18); row.writeUInt16LE(1); row.writeUInt16LE(14, 2);
  row.writeUInt16LE(subtype, 4); row.write(id, 6, 8, "ascii"); row.writeUInt32LE(size, 14); return row;
}
function reply(rows) {
  const header = Buffer.alloc(5); header[0] = 1; header.writeUInt32LE(rows.length, 1);
  return Buffer.concat([header, ...rows]);
}
assert.deepEqual(decodeWirelessAudioInventory(reply([])), []);
const valid = reply([record("ABCDEF01"), record("ABCDEF02", 1, 5678)]);
assert.deepEqual(decodeWirelessAudioInventory(valid), [
  { id: "ABCDEF01", destination: "podcasts", sizeBytes: 1234 },
  { id: "ABCDEF02", destination: "netease", sizeBytes: 5678 }
]);
for (const buffer of [Buffer.alloc(0), Buffer.from([1]), valid.subarray(0, -1), Buffer.concat([valid, Buffer.from([0])]), reply([record("ABCDEF01"), record("ABCDEF01")]), reply([record("ABCDEF03", 2)])])
  assert.throws(() => decodeWirelessAudioInventory(buffer), /invalid podcast inventory/);
for (const offset of [0, 5, 7, 11]) {
  const bad = Buffer.from(valid); bad[offset] = 255;
  assert.throws(() => decodeWirelessAudioInventory(bad), /invalid podcast inventory/);
}
const oversized = reply(Array.from({ length: 501 }, (_, i) => record(i.toString(16).padStart(8, "0"))));
assert.throws(() => decodeWirelessAudioInventory(oversized), /invalid podcast inventory/);
if (process.argv[2]) {
  const rows = decodeWirelessAudioInventory(fs.readFileSync(process.argv[2]));
  console.log(`Physical-watch capture decoded: ${rows.length} wireless audio files.`);
}
console.log("Wireless audio inventory: exact query, records, subtype separation, sizes, empty lists, malformed and duplicate records, ASCII and count bounds passed.");
