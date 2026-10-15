import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Offline tests for the keyless route engine: athlete BRouter profiles, the
// profile upload cache + fallbacks, route insights, the loop planner and the
// renderer's makeup callouts. brouter.de is never contacted; fetch is mocked.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (relative) =>
  import(`${pathToFileURL(path.join(repoRoot, relative)).href}?cacheBust=${Date.now()}`);

const profiles = await load("electron/routing/athleteProfiles.ts");
const insightsModule = await load("electron/routing/routeInsights.ts");
const planner = await load("electron/routing/loopPlanner.ts");
const brouter = await load("electron/routing/brouter.ts");
const makeupModel = await load("src/maps/routes/routeMakeupModel.ts");
const loopOptionsModel = await load("src/maps/routes/loopOptionsModel.ts");

// ---- athlete profiles ---------------------------------------------------------

/** Canonical lookup values per context; aliases after the first token are not valid in profiles. */
function parseLookups(text) {
  const contexts = { way: new Map(), node: new Map() };
  let current = null;
  for (const line of text.split("\n")) {
    const context = /^---context:(\w+)/.exec(line);
    if (context) {
      current = contexts[context[1]] ?? null;
      continue;
    }
    if (!current || !line.includes(";")) continue;
    const [key, rest] = line.split(";");
    const canonical = rest.trim().split(/\s+/)[1];
    if (!current.has(key)) current.set(key, new Set());
    if (canonical) current.get(key).add(canonical);
  }
  return contexts;
}

// Engine pseudo-tags that are valid in profiles but absent from lookups.dat.
const PSEUDO_TAGS = new Set(["reversedirection", "nodeaccessgranted"]);

function profileLookupErrors(profileText, lookups) {
  const errors = [];
  let context = null;
  profileText.split("\n").forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*/, "");
    const header = /^---context:(\w+)/.exec(line);
    if (header) {
      context = header[1];
      return;
    }
    if (context !== "way" && context !== "node") return;
    for (const [, key, values] of line.matchAll(/([A-Za-z_:][\w:]*)=([\w|:.;-]*)/g)) {
      if (PSEUDO_TAGS.has(key)) continue;
      const known = lookups[context].get(key);
      if (!known) {
        errors.push(`line ${index + 1}: unknown ${context} key "${key}"`);
        continue;
      }
      for (const value of values.split("|").filter(Boolean)) {
        if (!known.has(value)) errors.push(`line ${index + 1}: ${context} ${key}=${value} is not canonical`);
      }
    }
  });
  return errors;
}

const lookups = parseLookups(
  fs.readFileSync(path.join(repoRoot, "scripts", "fixtures", "brouter-lookups.dat"), "utf8")
);
const activities = ["running", "walking", "hiking", "cycling-road", "cycling-mountain"];
let profileCount = 0;
for (const activityType of activities) {
  for (const surface of ["road", "mixed", "trail"]) {
    for (const elevation of ["any", "flatter", "hilly"]) {
      for (const trimViaDetours of [true, false]) {
        const options = { activityType, surface, elevation, trimViaDetours };
        const text = profiles.buildAthleteProfile(options);
        assert.deepEqual(
          profileLookupErrors(text, lookups),
          [],
          `${profiles.athleteProfileKey(options)} uses tag values BRouter rejects`
        );
        for (const section of ["---context:global", "---context:way", "---context:node"]) {
          assert.ok(text.includes(section), `${section} missing`);
        }
        assert.match(text, /assign costfactor =/);
        assert.match(text, new RegExp(`assign correctMisplacedViaPoints = ${trimViaDetours}`));
        profileCount += 1;
      }
    }
  }
}
assert.equal(profileCount, 90);

const runProfile = profiles.buildAthleteProfile({
  activityType: "running",
  surface: "road",
  elevation: "flatter",
  trimViaDetours: true
});
// The parking-lot fix: parking aisles and driveways are priced far above streets.
assert.match(runProfile, /service=parking_aisle\|parking then 8/);
assert.match(runProfile, /service=driveway then 6/);
assert.match(runProfile, /service=drive-through then 25/);
assert.match(runProfile, /assign uphillcost = 40/);
assert.match(runProfile, /assign surface_pref = 0/);
assert.match(runProfile, /assign validForFoot = true/);
assert.match(
  profiles.buildAthleteProfile({ activityType: "cycling-road", surface: "road", elevation: "any", trimViaDetours: false }),
  /assign validForBikes = true/
);
assert.equal(profiles.defaultSurfaceForActivity("running"), "road");
assert.equal(profiles.defaultSurfaceForActivity("hiking"), "trail");
assert.equal(profiles.normalizeSurfacePreference("bogus", "cycling-mountain"), "trail");
assert.equal(profiles.normalizeSurfacePreference("mixed", "running"), "mixed");
assert.equal(profiles.normalizeElevationPreference(undefined), "any");

// ---- route insights -----------------------------------------------------------

const header = ["Longitude", "Latitude", "Elevation", "Distance", "CostPerKm", "ElevCost", "TurnCost", "NodeCost", "InitialCost", "WayTags", "NodeTags", "Time", "Energy"];
const row = (distance, tags) => ["0", "0", "0", String(distance), "1000", "0", "0", "0", "0", tags, "", "0", "0"];
const messages = [
  header,
  row(300, "highway=footway footway=sidewalk"),
  row(120, "highway=service service=parking_aisle"),
  row(400, "highway=path surface=dirt"),
  row(500, "highway=secondary sidewalk=both"),
  row(200, "highway=tertiary"),
  row(250, "highway=track tracktype=grade2"),
  row(80, "highway=residential")
];
const segments = insightsModule.parseBrouterSegments(messages);
assert.equal(segments.length, 7);
assert.deepEqual(segments[1].tags, { highway: "service", service: "parking_aisle" });
assert.equal(insightsModule.parseBrouterSegments("nope").length, 0);

const footInsights = insightsModule.buildRouteInsights(segments, [], false, "athlete");
assert.deepEqual(footInsights.wayTypes, {
  sidewalk: 800,
  parkingLot: 120,
  trail: 650,
  busyRoad: 200,
  quietStreet: 80
});
assert.deepEqual(footInsights.surfaces, { paved: 1200, natural: 400, gravel: 250 });
assert.equal(footInsights.profile, "athlete");

const bikeInsights = insightsModule.buildRouteInsights(segments, [], true, "athlete");
assert.equal(bikeInsights.wayTypes.busyRoad, 500, "secondary roads are main roads for bikes, sidewalk or not");
assert.equal(bikeInsights.wayTypes.quietStreet, 280, "tertiary roads count as minor roads for bikes");

// Out-and-back: the return leg retraces ~111 m of the outbound one.
const outAndBack = [
  { lat: 43.0, lon: -79.0 },
  { lat: 43.001, lon: -79.0 },
  { lat: 43.002, lon: -79.0 },
  { lat: 43.001, lon: -79.0 }
];
const retraced = insightsModule.retracedMeters(outAndBack);
assert.ok(retraced > 100 && retraced < 120, `expected ~111 m retraced, got ${retraced}`);
assert.equal(insightsModule.retracedMeters(outAndBack.slice(0, 3)), 0);

// ---- BRouter payload conversion ------------------------------------------------

const payload = (overrides = {}) => ({
  features: [
    {
      geometry: {
        coordinates: [
          [-79.0, 43.0, 100],
          [-79.0, 43.01, 130],
          [-79.01, 43.01, 90]
        ]
      },
      properties: {
        "track-length": "2100",
        "filtered ascend": "35",
        "total-time": "800",
        messages,
        ...overrides
      }
    }
  ]
});

const converted = brouter.geometryFromBrouter(payload(), "athlete", "running");
assert.equal(converted.distanceMeters, 2100);
assert.equal(converted.ascentMeters, 35);
// Net change −10 m, so descent = ascent + start − end = 35 + 100 − 90.
assert.equal(converted.descentMeters, 45);
assert.equal(converted.insights.wayTypes.parkingLot, 120);
assert.throws(
  () => brouter.geometryFromBrouter({ features: [] }, "athlete", "running"),
  /No path was found/
);

// ---- routing client with mocked brouter.de -----------------------------------

function mockBrouter(handlers) {
  const calls = { uploads: 0, routes: [], fetches: 0 };
  const fetchImpl = async (input, init = {}) => {
    calls.fetches += 1;
    const url = new URL(String(input));
    if (init.method === "POST") {
      calls.uploads += 1;
      return handlers.upload(calls.uploads, init.body);
    }
    calls.routes.push(url.searchParams.get("profile"));
    return handlers.route(calls.routes.length, url);
  };
  return { calls, fetchImpl };
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (body, status) => new Response(body, { status });
const twoPoints = [
  { lat: 43.0, lon: -79.0 },
  { lat: 43.01, lon: -79.01 }
];
const runPrefs = brouter.resolveRoutePreferences("running");
assert.deepEqual(runPrefs, { activityType: "running", surface: "road", elevation: "any" });

{
  // One upload serves repeated requests with the same preferences.
  brouter.resetBrouterThrottleForTests();
  const registry = new brouter.BrouterProfileRegistry();
  const { calls, fetchImpl } = mockBrouter({
    upload: () => json({ profileid: "custom_100" }),
    route: () => json(payload())
  });
  const first = await brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl, registry });
  await brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl, registry });
  assert.equal(calls.uploads, 1);
  assert.deepEqual(calls.routes, ["custom_100", "custom_100"]);
  assert.equal(first.insights.profile, "athlete");
}

{
  // A pruned custom profile (bare 500) is re-uploaded and the route retried.
  brouter.resetBrouterThrottleForTests();
  const registry = new brouter.BrouterProfileRegistry();
  const { calls, fetchImpl } = mockBrouter({
    upload: (count) => json({ profileid: `custom_${count}` }),
    route: (count) => (count === 1 ? text("", 500) : json(payload()))
  });
  const geometry = await brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl, registry });
  assert.equal(calls.uploads, 2);
  assert.deepEqual(calls.routes, ["custom_1", "custom_2"]);
  assert.equal(geometry.insights.profile, "athlete");
}

{
  // A rejected profile falls back to BRouter's stock profile and is not retried for a while.
  brouter.resetBrouterThrottleForTests();
  const registry = new brouter.BrouterProfileRegistry();
  const { calls, fetchImpl } = mockBrouter({
    upload: () => json({ profileid: "custom_9", error: "Profile error: ParseException" }),
    route: () => json(payload())
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const geometry = await brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl, registry });
    assert.equal(geometry.insights.profile, "standard");
    await brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl, registry });
  } finally {
    console.warn = warn;
  }
  assert.equal(calls.uploads, 1, "failed uploads are cached briefly");
  assert.deepEqual(calls.routes, ["hiking-mountain", "hiking-mountain"]);
}

{
  // Unroutable points are reported as-is; the stock profile can't do better.
  brouter.resetBrouterThrottleForTests();
  const registry = new brouter.BrouterProfileRegistry();
  const { calls, fetchImpl } = mockBrouter({
    upload: () => json({ profileid: "custom_5" }),
    route: () => text("to-position not mapped in existing datafile", 400)
  });
  await assert.rejects(
    brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl, registry }),
    /No path was found near one of your points/
  );
  assert.deepEqual(calls.routes, ["custom_5"]);
}

{
  // Overload responses are retried; brouter.de throttling starts a fail-fast cooldown.
  brouter.resetBrouterThrottleForTests();
  const registry = new brouter.BrouterProfileRegistry();
  const flaky = mockBrouter({
    upload: () => json({ profileid: "custom_7" }),
    route: (count) => (count === 1 ? text("busy", 503) : json(payload()))
  });
  const geometry = await brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl: flaky.fetchImpl, registry });
  assert.equal(geometry.insights.profile, "athlete");
  assert.equal(flaky.calls.routes.length, 2);

  const throttled = mockBrouter({
    upload: () => json({ profileid: "custom_7" }),
    route: () => text("Please, retry later!", 403)
  });
  await assert.rejects(
    brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl: throttled.fetchImpl, registry }),
    /asking CorosLink to slow down/
  );
  const fetchesAfterThrottle = throttled.calls.fetches;
  await assert.rejects(
    brouter.routeViaBrouter(twoPoints, runPrefs, { fetchImpl: throttled.fetchImpl, registry }),
    brouter.BrouterRateLimitError
  );
  assert.equal(throttled.calls.fetches, fetchesAfterThrottle, "cooldown must not hit the server");
  brouter.resetBrouterThrottleForTests();
}

// ---- loop planner -------------------------------------------------------------

const start = { lat: 43.65, lon: -79.38 };
const shape = { bearing: 90, radiusMeters: 1000, clockwise: true, viaCount: 4 };
const loop = planner.loopWaypoints(start, shape);
assert.equal(loop.length, 6);
assert.deepEqual(loop[0], start);
assert.deepEqual(loop[loop.length - 1], start);
const center = planner.offsetPoint(start, 90, 1000);
for (const via of loop.slice(1, -1)) {
  const radius = brouter.haversineMeters(center, via);
  assert.ok(Math.abs(radius - 1000) < 5, `via should sit on the circle (got ${radius})`);
}
assert.notEqual(planner.bearingForSeed(1), planner.bearingForSeed(2));
assert.equal(planner.bearingForSeed(undefined), 0);

function perimeter(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += brouter.haversineMeters(points[index - 1], points[index]);
  }
  return total;
}

{
  // Fake router: roads add 40% detour; loops heading east cut through a mall lot.
  const requested = [];
  const result = await planner.planLoop({
    start,
    distanceMeters: 10_000,
    preferences: { activityType: "running", surface: "road", elevation: "any" },
    route: async (waypoints) => {
      requested.push(waypoints);
      const distance = Math.round(perimeter(waypoints) * 1.4);
      const vias = waypoints.slice(1, -1);
      const centroidLon = vias.reduce((sum, via) => sum + via.lon, 0) / vias.length;
      const eastward = centroidLon > start.lon + 0.001;
      return {
        points: waypoints,
        distanceMeters: distance,
        ascentMeters: 20,
        insights: {
          wayTypes: eastward ? { sidewalk: distance - 900, parkingLot: 900 } : { sidewalk: distance },
          surfaces: { paved: distance },
          retracedMeters: 0,
          profile: "athlete"
        }
      };
    }
  });
  assert.ok(Math.abs(result.geometry.distanceMeters - 10_000) / 10_000 <= 0.05, `loop off target: ${result.geometry.distanceMeters}`);
  assert.equal(result.geometry.insights.wayTypes.parkingLot, undefined, "the parking-lot candidate must lose");
  for (const alternative of result.alternatives) {
    assert.ok(Math.abs(alternative.distanceMeters - 10_000) / 10_000 <= 0.12, "runner-ups stay near the target");
  }
  assert.ok(requested.length >= 3 && requested.length <= 6, `unexpected request count ${requested.length}`);
}

{
  // Scoring: distance error, parking lots and busy roads all cost; hills reward "hilly".
  const base = { points: [], distanceMeters: 10_000, ascentMeters: 0, insights: { wayTypes: { sidewalk: 10_000 }, surfaces: { paved: 10_000 }, retracedMeters: 0, profile: "athlete" } };
  const prefs = { activityType: "running", surface: "road", elevation: "any" };
  const clean = planner.scoreLoop(base, 10_000, prefs);
  assert.ok(planner.scoreLoop({ ...base, distanceMeters: 12_000 }, 10_000, prefs) > clean);
  assert.ok(planner.scoreLoop({ ...base, insights: { ...base.insights, wayTypes: { sidewalk: 9_000, parkingLot: 1_000 } } }, 10_000, prefs) > clean);
  assert.ok(planner.scoreLoop({ ...base, insights: { ...base.insights, wayTypes: { sidewalk: 9_000, busyRoad: 1_000 } } }, 10_000, prefs) > clean);
  const hilly = { ...prefs, elevation: "hilly" };
  assert.ok(planner.scoreLoop({ ...base, ascentMeters: 250 }, 10_000, hilly) < planner.scoreLoop(base, 10_000, hilly));
  assert.ok(planner.scoreLoop({ ...base, ascentMeters: 250 }, 10_000, { ...prefs, elevation: "flatter" }) > clean);
}

// ---- spur detection ------------------------------------------------------------

/** Local metres → lat/lon around the planner test start. */
const at = (east, north) => ({
  lat: start.lat + north / 111_320,
  lon: start.lon + east / (111_320 * Math.cos((start.lat * Math.PI) / 180))
});
const line = (from, to, steps) =>
  Array.from({ length: steps + 1 }, (_, index) =>
    at(from[0] + ((to[0] - from[0]) * index) / steps, from[1] + ((to[1] - from[1]) * index) / steps)
  );

// Up one sidewalk, across, and back down the other (30 m apart): a 400 m spur.
const sidewalkSpur = [
  ...line([-300, 0], [0, 0], 6),
  ...line([0, 0], [200, 0], 8).slice(1),
  ...line([200, 0], [200, 30], 2).slice(1),
  ...line([200, 30], [0, 30], 8).slice(1),
  ...line([0, 30], [0, 300], 6).slice(1)
];
const spurs = planner.findSpurs(sidewalkSpur);
assert.equal(spurs.length, 1);
assert.ok(spurs[0].lengthMeters >= 400 && spurs[0].lengthMeters <= 470, `spur length ${spurs[0].lengthMeters}`);
assert.ok(brouter.haversineMeters(spurs[0].tip, at(200, 15)) < 40, "tip sits at the far end of the spur");

// A 300 m square block and a lollipop (shared stick + big loop) are not spurs.
const square = [
  ...line([0, 0], [300, 0], 6),
  ...line([300, 0], [300, 300], 6).slice(1),
  ...line([300, 300], [0, 300], 6).slice(1),
  ...line([0, 300], [0, 0], 6).slice(1)
];
assert.deepEqual(planner.findSpurs(square), []);
const lollipop = [
  ...line([0, -400], [0, 0], 8),
  ...square.slice(1),
  ...line([0, 0], [0, -400], 8).slice(1)
];
assert.deepEqual(planner.findSpurs(lollipop), []);

{
  // The planner drops the via behind a spur and keeps the cleaner reroute.
  let repairs = 0;
  let requests = 0;
  const result = await planner.planLoop({
    start,
    distanceMeters: 5_000,
    preferences: { activityType: "running", surface: "road", elevation: "any" },
    route: async (waypoints) => {
      const vias = waypoints.slice(1, -1);
      // Every full circle has a 520 m sidewalk spur behind its first via.
      const spurred = vias.length === 3;
      const distance = Math.round(perimeter(waypoints) * 1.25) + (spurred ? 520 : 0);
      requests += 1;
      if (!spurred) repairs += 1;
      const tip = vias[0];
      const offset = (east, north) => ({
        lat: tip.lat + north / 111_320,
        lon: tip.lon + east / (111_320 * Math.cos((tip.lat * Math.PI) / 180))
      });
      const points = spurred
        ? [start, offset(-250, 0), offset(0, 0), offset(0, 20), offset(-250, 20), ...vias.slice(1), start]
        : [start, ...vias, start];
      return {
        points,
        distanceMeters: distance,
        ascentMeters: 0,
        insights: { wayTypes: { sidewalk: distance }, surfaces: { paved: distance }, retracedMeters: 0, profile: "athlete" }
      };
    }
  });
  assert.ok(repairs >= 1, "reroutes without the offending via");
  assert.ok(requests <= 6, `loop planning stays within six requests (used ${requests})`);
  assert.equal(planner.findSpurs(result.geometry.points).length, 0, "the spur-free reroute wins");
}

{
  // With the request budget nearly spent, only the first round is routed.
  let requests = 0;
  const routed = new Set();
  const plan = await planner.planLoop({
    start,
    distanceMeters: 10_000,
    preferences: { activityType: "running", surface: "road", elevation: "any" },
    availableRequests: () => 2,
    route: async (waypoints) => {
      requests += 1;
      const distance = Math.round(perimeter(waypoints) * 1.6);
      const geometry = { points: waypoints, distanceMeters: distance, insights: { wayTypes: { sidewalk: distance }, surfaces: { paved: distance }, retracedMeters: 0, profile: "athlete" } };
      routed.add(geometry);
      return geometry;
    }
  });
  assert.equal(requests, 3, "no improvement requests without budget");
  assert.ok(plan.alternatives.every((alternative) => routed.has(alternative)), "runner-ups are loops already routed");
}

// ---- loop alternatives ---------------------------------------------------------

/** Closed square ring of `size` metres with its south-west corner at (east, north). */
const ring = (east, north, size, steps = 6) => [
  ...line([east, north], [east + size, north], steps),
  ...line([east + size, north], [east + size, north + size], steps).slice(1),
  ...line([east + size, north + size], [east, north + size], steps).slice(1),
  ...line([east, north + size], [east, north], steps).slice(1)
];
const block = ring(0, 0, 300);
assert.ok(planner.sharedGeometryShare(block, block) > 0.99, "a loop shares all of itself");
assert.ok(
  planner.sharedGeometryShare(ring(0, 15, 300), block) > 0.95,
  "the same streets on the opposite sidewalk count as shared"
);
const sideways = planner.sharedGeometryShare(ring(150, 0, 300), block);
assert.ok(sideways > 0.2 && sideways < 0.35, `half-overlapping blocks share ~1/4 (got ${sideways})`);
assert.equal(planner.sharedGeometryShare(ring(2_000, 0, 300), block), 0);
// Sparse vertices (one per corner) are resampled, not judged by vertex count.
assert.ok(planner.sharedGeometryShare(ring(0, 0, 300, 1), block) > 0.99);

{
  const cleanInsights = (distance) => ({ wayTypes: { sidewalk: distance }, surfaces: { paved: distance }, retracedMeters: 0, profile: "athlete" });
  const option = (points, distanceMeters, score) => ({ geometry: { points, distanceMeters, insights: cleanInsights(distanceMeters) }, score });
  const winner = option(ring(0, 0, 1_250), 5_000, 0);
  const twin = option(ring(0, 20, 1_250), 5_050, 0.1);
  const west = option(ring(-1_250, 0, 1_250), 5_200, 0.3);
  const tooLong = option(ring(0, -1_250, 1_250), 5_800, 0.4);
  const tooRough = option(ring(1_250, 0, 1_250), 5_000, 2.1);
  const westTwin = option(ring(-1_250, 10, 1_250), 4_900, 0.5);
  const south = option(ring(-600, -1_250, 1_250), 4_700, 0.9);
  const picked = planner.pickAlternatives([winner, twin, west, tooLong, tooRough, westTwin, south], 5_000);
  assert.deepEqual(
    picked,
    [west.geometry, south.geometry],
    "skips near-duplicates (of the winner or each other), off-target and clearly worse loops"
  );
  assert.deepEqual(planner.pickAlternatives([winner], 5_000), []);
  assert.deepEqual(planner.pickAlternatives([], 5_000), []);
}

{
  // Clean grid: the three first-round shapes are distinct loops, so both runner-ups are offered.
  const routed = new Set();
  let requests = 0;
  const plan = await planner.planLoop({
    start,
    distanceMeters: 8_000,
    preferences: { activityType: "running", surface: "road", elevation: "any" },
    route: async (waypoints) => {
      requests += 1;
      const distance = Math.round(perimeter(waypoints) * 1.25);
      const geometry = { points: waypoints, distanceMeters: distance, ascentMeters: 30, insights: { wayTypes: { sidewalk: distance }, surfaces: { paved: distance }, retracedMeters: 0, profile: "athlete" } };
      routed.add(geometry);
      return geometry;
    }
  });
  assert.equal(plan.alternatives.length, 2);
  assert.ok(requests <= 6, `alternatives cost no extra requests (used ${requests})`);
  const offered = [plan.geometry, ...plan.alternatives];
  assert.ok(offered.every((geometry) => routed.has(geometry)));
  for (const [index, geometry] of offered.entries()) {
    assert.ok(Math.abs(geometry.distanceMeters - 8_000) / 8_000 <= 0.12);
    for (const other of offered.slice(index + 1)) {
      assert.ok(planner.sharedGeometryShare(geometry.points, other.points) < 0.7, "offered loops differ");
    }
  }
}

{
  // Two of the three directions snap onto the same road loop: offer it once.
  const north = { points: ring(-600, 0, 1_250), distanceMeters: 5_000, ascentMeters: 10, insights: { wayTypes: { sidewalk: 5_000 }, surfaces: { paved: 5_000 }, retracedMeters: 0, profile: "athlete" } };
  const southPoints = ring(-600, -1_250, 1_250);
  const plan = await planner.planLoop({
    start: at(0, 0),
    distanceMeters: 5_000,
    preferences: { activityType: "running", surface: "road", elevation: "any" },
    route: async (waypoints) => {
      const vias = waypoints.slice(1, -1);
      const centroidLat = vias.reduce((sum, via) => sum + via.lat, 0) / vias.length;
      // Fresh objects each time, as a real router would return.
      return centroidLat > start.lat
        ? { ...north }
        : { points: [...southPoints], distanceMeters: 5_100, ascentMeters: 10, insights: { wayTypes: { sidewalk: 5_100 }, surfaces: { paved: 5_100 }, retracedMeters: 0, profile: "athlete" } };
    }
  });
  assert.equal(plan.geometry.distanceMeters, 5_000, "the on-target north loop wins");
  assert.equal(plan.alternatives.length, 1, "the duplicate south loop is offered once");
  assert.equal(plan.alternatives[0].distanceMeters, 5_100);
}

await assert.rejects(
  planner.planLoop({
    start,
    distanceMeters: 5_000,
    preferences: { activityType: "running", surface: "road", elevation: "any" },
    route: async () => {
      throw new Error("No path was found near one of your points.");
    }
  }),
  /No path was found/
);

// ---- renderer makeup callouts ---------------------------------------------------

const metres = (value) => `${Math.round(value)} m`;
const dirty = makeupModel.summarizeRouteMakeup(
  {
    wayTypes: { sidewalk: 4_000, parkingLot: 300, busyRoad: 400, path: 300 },
    surfaces: { paved: 5_000 },
    retracedMeters: 0,
    profile: "athlete"
  },
  "running",
  metres
);
assert.deepEqual(dirty.callouts.map((callout) => callout.tone), ["warning", "warning"]);
assert.match(dirty.callouts[0].text, /300 m in parking lots/);
assert.equal(dirty.wayRows[0].id, "sidewalk");
assert.equal(Math.round(dirty.carFreeShare * 100), 86);

const clean = makeupModel.summarizeRouteMakeup(
  { wayTypes: { path: 5_000 }, surfaces: { paved: 4_000, gravel: 1_000 }, retracedMeters: 0, profile: "athlete" },
  "running",
  metres
);
assert.deepEqual(clean.callouts.map((callout) => callout.tone), ["good"]);
assert.equal(Math.round(clean.pavedShare * 100), 80);

const fallback = makeupModel.summarizeRouteMakeup(
  { wayTypes: { quietStreet: 5_000 }, surfaces: { paved: 5_000 }, retracedMeters: 0, profile: "standard" },
  "cycling-road",
  metres
);
assert.deepEqual(fallback.callouts.map((callout) => callout.text), ["Standard routing"]);
assert.equal(fallback.wayRows[0].label, "Minor road");
assert.equal(makeupModel.formatShare(0.004), "<1%");

// ---- loop option cards ------------------------------------------------------------

{
  const geometry = (points, distanceMeters, ascentMeters, wayTypes, surfaces) => ({
    points,
    distanceMeters,
    ascentMeters,
    insights: { wayTypes, surfaces, retracedMeters: 0, profile: "athlete" }
  });
  // Rotates a closed ring so it starts (and ends) at its index-th point.
  const startAt = (points, index) => [...points.slice(index), ...points.slice(1, index + 1)];
  const best = geometry(ring(0, 0, 1_250), 5_000, 60, { sidewalk: 3_000, quietStreet: 2_000 }, { paved: 5_000 });
  const greener = geometry(startAt(ring(-1_250, 0, 1_250), 6), 5_100, 64, { path: 4_500, quietStreet: 500 }, { paved: 4_000, gravel: 1_100 });
  const flatter = geometry(startAt(ring(0, -1_250, 1_250), 18), 4_900, 20, { sidewalk: 3_000, quietStreet: 1_900 }, { paved: 4_900 });
  const { cards, surfaceLabel } = loopOptionsModel.buildLoopOptionCards([best, greener, flatter], "running", "road");
  assert.equal(surfaceLabel, "paved");
  assert.deepEqual(cards.map((card) => card.label), ["Best match", "More car-free", "Flatter"]);
  assert.equal(Math.round(cards[0].carFreeShare * 100), 60);
  assert.equal(Math.round(cards[1].surfaceShare * 100), 78);
  for (const card of cards) {
    assert.match(card.shapePath, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+$/);
    assert.ok(card.start.x >= 0 && card.start.x <= loopOptionsModel.LOOP_SHAPE_WIDTH);
    assert.ok(card.start.y >= 0 && card.start.y <= loopOptionsModel.LOOP_SHAPE_HEIGHT);
  }
  // Each loop is centred in its card, at one scale sized to the biggest loop.
  const shapeBox = (path) => {
    const numbers = path.match(/[\d.]+/g).map(Number);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const box = shapeBox(cards[0].shapePath);
  assert.ok(Math.abs(box.minY - (loopOptionsModel.LOOP_SHAPE_HEIGHT - box.maxY)) < 0.5, "centred vertically");
  assert.ok(Math.abs(box.minX - (loopOptionsModel.LOOP_SHAPE_WIDTH - box.maxX)) < 0.5, "centred horizontally");
  const half = loopOptionsModel.buildLoopOptionCards(
    [best, geometry(ring(0, 0, 625), 2_500, 0, { sidewalk: 2_500 }, { paved: 2_500 })],
    "running",
    "road"
  ).cards.map((card) => shapeBox(card.shapePath));
  const halfRatio = (half[1].maxY - half[1].minY) / (half[0].maxY - half[0].minY);
  assert.ok(Math.abs(halfRatio - 0.5) < 0.03, `a loop half the size draws half as big (got ${halfRatio})`);
  // Same streets, same numbers: nothing to call out beyond the streets themselves.
  assert.equal(loopOptionsModel.buildLoopOptionCards([best, { ...best }], "running", "road").cards[1].label, "Other streets");

  const trail = loopOptionsModel.buildLoopOptionCards([greener, { ...best, insights: undefined }], "hiking", "trail");
  assert.equal(trail.surfaceLabel, "unpaved");
  assert.equal(Math.round(trail.cards[0].surfaceShare * 100), 22);
  assert.equal(trail.cards[1].carFreeShare, undefined, "no breakdown, no made-up share");
}

console.log("Route engine tests passed.");
