import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "src", "overview", "activityVisitHeatmap.ts"));
const { getCachedVisitCentroid, loadActivityVisitCentroids, rememberActivityGeo } = await import(
  `${modUrl.href}?cacheBust=${Date.now()}`
);

const track = { points: [{ lat: 45.4, lon: -75.7 }, { lat: 45.41, lon: -75.71 }] };
const run = { activityId: "run-1", sportType: 100 };

// A lookup that throws (offline, aborted) is not an answer: nothing is cached,
// so the next load asks again and finds the place.
let calls = 0;
const failing = await loadActivityVisitCentroids([run], async () => {
  calls += 1;
  throw new Error("offline");
});
assert.deepEqual(failing, []);
assert.equal(getCachedVisitCentroid("run-1"), undefined);
const retried = await loadActivityVisitCentroids([run], async () => {
  calls += 1;
  return { laps: [], raw: {}, track };
});
assert.equal(calls, 2);
assert.equal(retried.length, 1);
assert.ok(Math.abs(retried[0].lat - 45.405) < 1e-9);

// A detail whose GPX fallback got no answer is not "no GPS" either.
assert.deepEqual(rememberActivityGeo("run-2", { laps: [], raw: {}, trackFetchFailed: true }), {
  centroid: null,
  route: null
});
assert.equal(getCachedVisitCentroid("run-2"), undefined);

// A real answer without a track is a confirmed miss and is cached.
rememberActivityGeo("indoor-1", { laps: [], raw: {} });
assert.equal(getCachedVisitCentroid("indoor-1"), null);

console.log("activity globe cache tests passed");
