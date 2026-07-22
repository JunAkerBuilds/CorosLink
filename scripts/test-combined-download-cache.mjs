import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  combinedTrackCompletionMarker,
  createCombinedDownloadCacheKey,
  isReusableCombinedTrack,
  markCombinedTrackReusable,
  pruneCombinedDownloadCache,
  touchCombinedDownloadCache
} from "../dist-electron/combinedDownloadCache.js";

const inputs = [
  "ytsearch1:Artist Track official audio",
  "https://www.youtube.com/watch?v=abcdefghijk"
];
const key = createCombinedDownloadCacheKey("spotify:playlist-1", inputs);

assert.match(key, /^[a-f0-9]{64}$/);
assert.equal(
  createCombinedDownloadCacheKey("spotify:playlist-1", inputs),
  key,
  "the same playlist revision should get the same resume cache"
);
assert.notEqual(
  createCombinedDownloadCacheKey("spotify:playlist-2", inputs),
  key,
  "service-scoped playlist ids must not share caches"
);
assert.notEqual(
  createCombinedDownloadCacheKey("spotify:playlist-1", [...inputs, "new"]),
  key,
  "editing a playlist should create a fresh cache"
);

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "coroslink-combined-cache-test-")
);

try {
  const reusableTrack = path.join(root, "0000.mp3");
  const emptyTrack = path.join(root, "0001.mp3");
  fs.writeFileSync(reusableTrack, "mp3-data");
  fs.writeFileSync(emptyTrack, "");

  assert.equal(
    await isReusableCombinedTrack(reusableTrack),
    false,
    "an MP3 left mid-write must not be reused without its completion marker"
  );
  await markCombinedTrackReusable(reusableTrack);
  await markCombinedTrackReusable(emptyTrack);
  assert.equal(await isReusableCombinedTrack(reusableTrack), true);
  assert.equal(await isReusableCombinedTrack(emptyTrack), false);
  assert.equal(
    fs.existsSync(combinedTrackCompletionMarker(reusableTrack)),
    true
  );
  assert.equal(
    await isReusableCombinedTrack(path.join(root, "missing.mp3")),
    false
  );

  const now = Date.now();
  const oldKey = "old-cache";
  const recentKey = "recent-cache";
  const activeKey = "active-cache";
  const oldDirectory = path.join(root, oldKey);
  const recentDirectory = path.join(root, recentKey);
  const activeDirectory = path.join(root, activeKey);

  fs.mkdirSync(oldDirectory);
  fs.mkdirSync(recentDirectory);
  fs.mkdirSync(activeDirectory);
  const oldDate = new Date(now - 10_000);
  fs.utimesSync(oldDirectory, oldDate, oldDate);
  fs.utimesSync(activeDirectory, oldDate, oldDate);

  await pruneCombinedDownloadCache(
    root,
    new Set([activeKey]),
    now,
    5_000
  );

  assert.equal(fs.existsSync(oldDirectory), false, "expired caches are removed");
  assert.equal(fs.existsSync(recentDirectory), true, "recent caches are retained");
  assert.equal(fs.existsSync(activeDirectory), true, "active caches are retained");

  await touchCombinedDownloadCache(activeDirectory, new Date(now));
  assert.ok(fs.statSync(activeDirectory).mtimeMs >= now - 1);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("combined download cache tests passed");
