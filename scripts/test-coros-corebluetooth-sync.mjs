import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The CoreBluetooth helper's read-only SyncData receivers against the golden vectors
// shared with electron/localSync/activityProtocol.ts and scripts/coros_ble_activity.py.
if (process.platform !== "darwin") {
  console.log("Swift CoreBluetooth sync checks require macOS.");
  process.exit(0);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const vectors = JSON.parse(await fs.readFile(path.join(repoRoot, "scripts/fixtures/coros-sync-file-vectors.json"), "utf8"));
const source = await fs.readFile(path.join(repoRoot, "native/corebluetooth/main.swift"), "utf8");
const functions = source.slice(source.indexOf("func decodeWatchInteraction("), source.indexOf("\nlet worker = BluetoothWorker()"));
assert.ok(functions.includes("final class CorosSyncBlockReceiver"));
// Never acknowledge: the sync receivers never send 0x7D (it moves the watch's sync pointer), and the helper refuses any operation it doesn't know.
const syncCode = source.slice(source.indexOf("let readOnlySyncFiles"), source.indexOf("// A music delete completes"));
assert.ok(syncCode.includes("final class CorosSyncBlockReceiver"));
assert.equal(/0x7d/i.test(syncCode), false, "no 0x7D in the sync receivers");
assert.match(source, /default: fail\("Unsupported Bluetooth operation\."\)/);
assert.equal("acks" in vectors, false, "no acknowledgement vectors");

const data = (hex) => `Data([${[...Buffer.from(hex, "hex")].join(",")}])`;
const frames = (list) => `[${list.map(data).join(", ")}]`;

const checks = [];
for (const vector of vectors.requests) {
  checks.push(`
do {
  let receiver = CorosSyncBlockReceiver(fileIndex: ${vector.fileIndex}, offset: ${vector.offset}, selector: ${vector.selector}, now: ${vector.now}, utcOffset: ${vector.utcOffsetSeconds})!
  expect(receiver.requestFrames() == ${frames(vector.frames)}, "request frames offset ${vector.offset}")
}`);
}
const block = vectors.block;
checks.push(`
do {
  let receiver = CorosSyncBlockReceiver(fileIndex: ${block.fileIndex}, offset: ${block.offset}, selector: 0, now: 0, utcOffset: 0)!
  var windows = 0
  var payload: Data?
  for frame in ${frames(block.headerFrames)} {
    let result = try! receiver.accept(frame, control: true)
    if !result.frames.isEmpty { expect(result.bulk && result.frames[0] == ${data(block.windowRequest)}, "window request"); windows += 1 }
  }
  for frame in ${frames(block.bulkFrames)} {
    let result = try! receiver.accept(frame, control: false)
    if !result.frames.isEmpty { windows += 1 }
    if let value = result.payload { payload = value }
  }
  expect(windows == ${block.expectedWindowRequests}, "window count")
  expect(payload == ${data(block.expectedPayload)}, "block payload")

  let corrupt = CorosSyncBlockReceiver(fileIndex: 14, offset: 0, selector: 0, now: 0, utcOffset: 0)!
  for frame in ${frames(block.headerFrames)} { _ = try! corrupt.accept(frame, control: true) }
  var last = ${data(block.bulkFrames.at(-1))}
  last[last.count - 1] ^= 1
  _ = try! corrupt.accept(${data(block.bulkFrames[0])}, control: false)
  _ = try! corrupt.accept(${data(block.bulkFrames[1])}, control: false)
  expect((try? corrupt.accept(last, control: false)) == nil, "reject a corrupted block")
}
expect(CorosSyncBlockReceiver(fileIndex: 93, offset: 0, selector: 0) == nil, "music file is not a sync file")
expect(CorosSyncBlockReceiver(fileIndex: 8, offset: 0, selector: 0) == nil, "watch-face file is not a sync file")
expect(CorosSyncBlockReceiver(fileIndex: 14, offset: -1, selector: 0) == nil, "negative offset")
expect(CorosSyncBlockReceiver(fileIndex: 5, offset: 0, selector: 0) != nil, "daily file can be read")`);

const swift = `import Foundation
${functions}
func expect(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
${checks.join("\n")}
print("ok")
`;

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "coros-swift-sync-"));
try {
  const file = path.join(directory, "check.swift");
  await fs.writeFile(file, swift);
  const output = execFileSync("/usr/bin/swift", [file], { cwd: directory, encoding: "utf8" }).trim();
  assert.equal(output.split("\n").at(-1), "ok");
  console.log("CoreBluetooth sync receivers match the shared vectors.");
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
