import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import unzipper from "unzipper";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { createStoreZip } = await import(
  `${distUrl("zipStore.js")}?cacheBust=${Date.now()}`
);

const payload = Buffer.from("FIT-FILE-BYTES-éà-123");
const name = "abc123/Morning Ride.fit";
const zip = createStoreZip([{ name, data: payload }]);

assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304"); // local file header
const dir = await unzipper.Open.buffer(zip);
assert.equal(dir.files.length, 1);
assert.equal(dir.files[0].path, name);
const out = await dir.files[0].buffer();
assert.ok(out.equals(payload), "round-tripped bytes must match");

console.log("zip-store tests passed");
