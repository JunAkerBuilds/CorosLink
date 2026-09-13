import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serviceUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "mapService.js")
);

const {
  buildOrsDirectionsBody,
  buildRouteGpx,
  downloadCorosMapPackageToCache,
  geocodeRouteLocation,
  getCorosMapInstallProgress,
  inspectCorosMapFolder,
  installCorosMapFolder,
  parseRouteCoordinateInput,
  parseCorosMapManifest,
  setCorosMapInstallProgressListener
} = await import(`${serviceUrl.href}?cacheBust=${Date.now()}`);

const fixturePath = path.join(
  repoRoot,
  "scripts",
  "fixtures",
  "coros-map-manifest-v5.json"
);
const manifestFixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const manifest = parseCorosMapManifest(manifestFixture);

assert.equal(manifest.version, "5");
assert.equal(manifest.bundleVersion, "5.0.3");
assert.equal(manifest.packages.length, 4);
assert.equal(manifest.packages[0].title, "North America");
assert.equal(manifest.packages[0].type, "landscape");
assert.equal(
  manifest.packages[0].downloadUrl,
  "https://map-oss-us.coros.com/regionMap/v5/north-america_landscape_5.0.3.zip"
);
assert.equal(manifest.packages[2].title, "North America - 1");

const loopBody = buildOrsDirectionsBody(
  {
    startLocation: "Toronto",
    distanceKm: 5,
    mode: "loop",
    activityType: "hiking",
    surfacePreference: "trail",
    avoidHighways: true,
    elevationPreference: "flatter"
  },
  [-79.3832, 43.6532]
);

assert.deepEqual(loopBody.coordinates, [[-79.3832, 43.6532]]);
// Unlimited snapping radius avoids ORS "code 2010" routable-point failures.
assert.deepEqual(loopBody.radiuses, [-1]);
assert.equal(loopBody.elevation, true);
assert.equal(loopBody.instructions, false);
assert.equal(loopBody.options.round_trip.length, 5000);
// Foot activities ignore avoidHighways even when set.
assert.equal(loopBody.options.avoid_features, undefined);
assert.equal(
  loopBody.options.profile_params.weightings.steepness_difficulty,
  1
);

// A variationSeed produces a different round_trip seed for the same inputs.
const loopBodyShuffled = buildOrsDirectionsBody(
  {
    startLocation: "Toronto",
    distanceKm: 5,
    mode: "loop",
    activityType: "hiking",
    surfacePreference: "trail",
    avoidHighways: true,
    elevationPreference: "flatter",
    variationSeed: 42
  },
  [-79.3832, 43.6532]
);
assert.notEqual(
  loopBodyShuffled.options.round_trip.seed,
  loopBody.options.round_trip.seed
);

// Cycling activities honour avoidHighways via ORS avoid_features.
const cyclingBody = buildOrsDirectionsBody(
  {
    startLocation: "Toronto",
    destinationLocation: "Hamilton",
    distanceKm: 40,
    mode: "point-to-point",
    activityType: "cycling-road",
    surfacePreference: "road",
    avoidHighways: true,
    elevationPreference: "any"
  },
  [-79.3832, 43.6532],
  [-79.8711, 43.2557]
);
assert.deepEqual(cyclingBody.options.avoid_features, ["highways"]);

const pinnedStart = parseRouteCoordinateInput("43.65320, -79.38320");
assert.deepEqual(pinnedStart?.coordinates, [-79.3832, 43.6532]);
assert.equal(pinnedStart?.label, "Pinned 43.65320, -79.38320");
assert.equal(parseRouteCoordinateInput("191, -79.38320"), undefined);
assert.equal(parseRouteCoordinateInput("Toronto"), undefined);

const pinnedGeocode = await geocodeRouteLocation("43.65320, -79.38320");
assert.deepEqual(pinnedGeocode, {
  label: "Pinned 43.65320, -79.38320",
  lat: 43.6532,
  lon: -79.3832
});
await assert.rejects(
  () => geocodeRouteLocation(""),
  /Enter a location to find on the map/
);

const pointBody = buildOrsDirectionsBody(
  {
    startLocation: "Start",
    destinationLocation: "Finish",
    distanceKm: 10,
    mode: "point-to-point",
    activityType: "running",
    surfacePreference: "road",
    avoidHighways: false,
    elevationPreference: "any"
  },
  [-79, 43],
  [-80, 44]
);

assert.deepEqual(pointBody.coordinates, [
  [-79, 43],
  [-80, 44]
]);
assert.deepEqual(pointBody.radiuses, [-1, -1]);
assert.equal(pointBody.options, undefined);

const gpx = buildRouteGpx({
  id: "route-1",
  name: "5K <Loop>",
  createdAt: "2026-06-28T00:00:00.000Z",
  startLocation: "Start",
  distanceMeters: 5000,
  mode: "loop",
  activityType: "hiking",
  surfacePreference: "trail",
  avoidHighways: true,
  elevationPreference: "hilly",
  ascentMeters: 80,
  points: [
    { lat: 43.1, lon: -79.1, elevation: 100 },
    { lat: 43.2, lon: -79.2, elevation: 125 }
  ]
});

assert.match(gpx, /<name>5K &lt;Loop&gt;<\/name>/);
assert.match(gpx, /<trkpt lat="43.1" lon="-79.1"><ele>100<\/ele><\/trkpt>/);
// Navigable course route + summary description for COROS.
assert.match(gpx, /<rte>/);
assert.match(gpx, /<rtept lat="43.1" lon="-79.1"><ele>100<\/ele><\/rtept>/);
assert.match(gpx, /<desc>5.0 km · Hiking · loop · 80 m ascent<\/desc>/);

const cacheRoot = await fs.promises.mkdtemp(
  path.join(os.tmpdir(), "coroslink-map-cache-test-")
);
try {
  const payload = Buffer.from("tiny mocked coros map zip");
  const progressUpdates = [];
  const pkg = {
    ...manifest.packages[0],
    sizeBytes: payload.length
  };
  const abortController = new AbortController();
  const cached = await downloadCorosMapPackageToCache(pkg, {
    cacheDirectory: cacheRoot,
    signal: abortController.signal,
    fetchImpl: async (input, init) => {
      assert.equal(input, pkg.downloadUrl);
      assert.equal(init?.signal, abortController.signal);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(payload.subarray(0, 6));
            controller.enqueue(payload.subarray(6));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-length": String(payload.length)
          }
        }
      );
    },
    onProgress: (progress) => progressUpdates.push(progress)
  });

  assert.equal(cached.packageId, pkg.id);
  assert.equal(cached.title, pkg.title);
  assert.equal(cached.sizeBytes, payload.length);
  assert.equal(fs.readFileSync(cached.filePath, "utf8"), payload.toString());
  assert.equal(progressUpdates.at(-1)?.progress, 1);
} finally {
  await fs.promises.rm(cacheRoot, { recursive: true, force: true });
}

const tempRoot = await fs.promises.mkdtemp(
  path.join(os.tmpdir(), "coroslink-maps-test-")
);
const sourceRoot = path.join(tempRoot, "downloaded");
const sourceMap = path.join(sourceRoot, "map");
const watchRoot = path.join(tempRoot, "COROS PACE PRO");
const watchMap = path.join(watchRoot, "map");

try {
  await fs.promises.mkdir(path.join(sourceMap, "north-america"), {
    recursive: true
  });
  await fs.promises.writeFile(path.join(sourceMap, "index.dat"), "map-index");
  await fs.promises.writeFile(
    path.join(sourceMap, "north-america", "tile.dat"),
    "tile-data"
  );
  await fs.promises.mkdir(path.join(watchRoot, "Music"), { recursive: true });
  await fs.promises.mkdir(watchMap, { recursive: true });
  await fs.promises.writeFile(path.join(watchMap, "base.map"), "existing");

  const selection = await inspectCorosMapFolder(sourceRoot);
  assert.equal(selection.mapPath, sourceMap);
  assert.equal(selection.fileCount, 2);
  assert.equal(selection.sizeBytes, "map-index".length + "tile-data".length);

  process.env.COROS_WATCH_PATH = watchRoot;
  const installProgressUpdates = [];
  setCorosMapInstallProgressListener((progress) => {
    if (progress) {
      installProgressUpdates.push(progress);
    }
  });
  const result = await installCorosMapFolder(sourceRoot);

  assert.equal(result.installedPath, watchMap);
  assert.equal(fs.existsSync(path.join(watchMap, "base.map")), true);
  assert.equal(fs.existsSync(path.join(watchMap, "index.dat")), true);
  assert.equal(
    fs.existsSync(path.join(watchMap, "north-america", "tile.dat")),
    true
  );
  assert.equal(result.watch.connected, true);
  assert.equal(result.watch.mapPath, watchMap);
  assert.equal(result.watch.mapFileCount, 3);
  assert.equal(getCorosMapInstallProgress()?.phase, "completed");
  assert.equal(getCorosMapInstallProgress()?.progress, 1);
  assert.equal(
    installProgressUpdates.some((progress) => progress.phase === "copying"),
    true
  );
  assert.equal(installProgressUpdates.at(-1)?.phase, "completed");

  await assert.rejects(
    () => installCorosMapFolder(watchMap),
    /already on the watch/
  );
} finally {
  delete process.env.COROS_WATCH_PATH;
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
}

const batchTempRoot = await fs.promises.mkdtemp(
  path.join(os.tmpdir(), "coroslink-maps-batch-test-")
);
const batchWatchRoot = path.join(batchTempRoot, "COROS PACE PRO");
const batchWatchMap = path.join(batchWatchRoot, "map");
const batchSources = [
  path.join(batchTempRoot, "package-a"),
  path.join(batchTempRoot, "package-b")
];

try {
  for (const [index, sourceRoot] of batchSources.entries()) {
    const sourceMap = path.join(sourceRoot, "map");
    const regionName = index === 0 ? "region-a" : "region-b";
    await fs.promises.mkdir(path.join(sourceMap, regionName), {
      recursive: true
    });
    await fs.promises.writeFile(
      path.join(sourceMap, "index.dat"),
      `index-${index}`
    );
    await fs.promises.writeFile(
      path.join(sourceMap, regionName, `tile-${index}.dat`),
      `tile-${index}`
    );
  }

  await fs.promises.mkdir(batchWatchMap, { recursive: true });
  process.env.COROS_WATCH_PATH = batchWatchRoot;

  const batchSelections = await Promise.all(
    batchSources.map((sourceRoot) => inspectCorosMapFolder(sourceRoot))
  );
  const batchTotalBytes = batchSelections.reduce(
    (sum, selection) => sum + selection.sizeBytes,
    0
  );
  const batchTotalFiles = batchSelections.reduce(
    (sum, selection) => sum + selection.fileCount,
    0
  );

  const batchProgressUpdates = [];
  setCorosMapInstallProgressListener((progress) => {
    if (progress) {
      batchProgressUpdates.push(progress);
    }
  });

  let copiedBytesOffset = 0;
  let copiedFilesOffset = 0;
  for (const [index, selection] of batchSelections.entries()) {
    await installCorosMapFolder(selection.sourcePath, {
      label: `${index + 1} of ${batchSelections.length}: package-${index}`,
      publishLifecycle: false,
      progressContext: {
        totalBytes: batchTotalBytes,
        totalFiles: batchTotalFiles,
        copiedBytesOffset,
        copiedFilesOffset
      }
    });
    copiedBytesOffset += selection.sizeBytes;
    copiedFilesOffset += selection.fileCount;
  }

  assert.equal(fs.existsSync(path.join(batchWatchMap, "index.dat")), true);
  assert.equal(
    fs.existsSync(path.join(batchWatchMap, "region-a", "tile-0.dat")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(batchWatchMap, "region-b", "tile-1.dat")),
    true
  );
  assert.equal(
    batchProgressUpdates.filter((progress) => progress.phase === "preparing")
      .length,
    0
  );
  assert.equal(
    batchProgressUpdates.filter((progress) => progress.phase === "completed")
      .length,
    0
  );
  assert.ok(batchProgressUpdates.some((progress) => progress.phase === "copying"));

  let lastCopyProgress = -1;
  for (const progress of batchProgressUpdates) {
    if (progress.phase !== "copying") {
      continue;
    }

    assert.ok(
      progress.progress + 1e-9 >= lastCopyProgress,
      "copy progress should not decrease during batch install"
    );
    lastCopyProgress = progress.progress;
  }

  assert.equal(lastCopyProgress, 1);
  assert.equal(getCorosMapInstallProgress()?.phase, "copying");
  assert.equal(getCorosMapInstallProgress()?.progress, 1);
} finally {
  delete process.env.COROS_WATCH_PATH;
  await fs.promises.rm(batchTempRoot, { recursive: true, force: true });
}

// ---- Keyless routing (BRouter helpers) ----
const brouterUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "routing", "brouter.js")
);
const {
  brouterProfileFor,
  haversineMeters,
  straightLineGeometry
} = await import(`${brouterUrl.href}?cacheBust=${Date.now()}`);

// Activity → profile mapping stays stable (used to pick BRouter profiles).
assert.equal(brouterProfileFor("hiking"), "hiking-mountain");
assert.equal(brouterProfileFor("cycling-road"), "fastbike");
assert.equal(brouterProfileFor("cycling-mountain"), "mtb");

// Haversine sanity: ~1.11 km per 0.01° of latitude.
const latDegreeMeters = haversineMeters(
  { lat: 43.0, lon: -79.0 },
  { lat: 43.01, lon: -79.0 }
);
assert.ok(
  Math.abs(latDegreeMeters - 1112) < 40,
  `expected ~1112 m, got ${latDegreeMeters}`
);

// Freehand geometry is computed locally (no network) from the raw waypoints.
const freehand = straightLineGeometry([
  { lat: 43.0, lon: -79.0 },
  { lat: 43.01, lon: -79.0 },
  { lat: 43.02, lon: -79.0 }
]);
assert.equal(freehand.points.length, 3);
assert.ok(Math.abs(freehand.distanceMeters - 2 * latDegreeMeters) < 80);
assert.equal(freehand.ascentMeters, undefined);

// ---- GPX import ----
const { parseGpxRoute, buildRouteFromGpxContent, readGpxRouteFiles } =
  await import(`${serviceUrl.href}?gpxImport=${Date.now()}`);

const loopGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Strava" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Harbour &amp; Park Loop</name></metadata>
  <trk>
    <name>Harbour &amp; Park Loop</name>
    <trkseg>
      <trkpt lat="43.6400" lon="-79.3800"><ele>80</ele></trkpt>
      <trkpt lat="43.6500" lon="-79.3800"><ele>95.5</ele></trkpt>
      <trkpt lat="43.6500" lon="-79.3900"><ele>90</ele></trkpt>
      <trkpt lat="43.6400" lon="-79.3800"><ele>80</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const parsedLoop = parseGpxRoute(loopGpx);
assert.equal(parsedLoop.name, "Harbour & Park Loop");
assert.equal(parsedLoop.points.length, 4);
assert.equal(parsedLoop.points[1].elevation, 95.5);

const loopRoute = buildRouteFromGpxContent(loopGpx, "fallback", "running");
assert.equal(loopRoute.name, "Harbour & Park Loop");
assert.equal(loopRoute.mode, "loop");
assert.equal(loopRoute.activityType, "running");
assert.ok(loopRoute.distanceMeters > 2500 && loopRoute.distanceMeters < 4500);
assert.equal(loopRoute.ascentMeters, 16);
assert.equal(loopRoute.descentMeters, 16);
assert.ok(loopRoute.bounds);

// Planned courses that only carry <rtept> (and self-closing points) still load,
// and an open track becomes a point-to-point route named after the file.
const courseGpx = `<gpx version="1.1">
  <rte>
    <rtept lat='43.60' lon='-79.40'/>
    <rtept lat='43.62' lon='-79.40'/>
    <rtept lat='43.64' lon='-79.42'/>
  </rte>
</gpx>`;
const courseRoute = buildRouteFromGpxContent(courseGpx, "sunday-course", "cycling-road");
assert.equal(courseRoute.name, "sunday-course");
assert.equal(courseRoute.mode, "point-to-point");
assert.equal(courseRoute.points.length, 3);
assert.equal(courseRoute.ascentMeters, undefined);

assert.throws(
  () => buildRouteFromGpxContent("<gpx></gpx>", "empty", "running"),
  /No track or route points/
);

// ---- Multi-file GPX import (issue #5): a bad file among good ones must not
// abort the batch, and every file's outcome is reported back. ----
const batchDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-gpx-batch-"));
try {
  const goodPathA = path.join(batchDir, "monday.gpx");
  const goodPathB = path.join(batchDir, "tuesday.gpx");
  const badPath = path.join(batchDir, "corrupt.gpx");
  fs.writeFileSync(goodPathA, loopGpx);
  fs.writeFileSync(goodPathB, courseGpx);
  fs.writeFileSync(badPath, "<gpx></gpx>");

  const { parsed, failures } = await readGpxRouteFiles(
    [goodPathA, goodPathB, badPath],
    "running"
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].fileName, "monday.gpx");
  assert.equal(parsed[0].route.name, "Harbour & Park Loop");
  assert.equal(parsed[1].fileName, "tuesday.gpx");
  assert.equal(parsed[1].route.mode, "point-to-point");

  assert.equal(failures.length, 1);
  assert.equal(failures[0].fileName, "corrupt.gpx");
  assert.match(failures[0].message, /No track or route points/);
} finally {
  fs.rmSync(batchDir, { recursive: true, force: true });
}

console.log("Maps service tests passed.");
