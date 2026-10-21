import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const streamsUrl = pathToFileURL(path.join(repoRoot, "src", "training", "activityStreams.ts"));
const {
  elevationChange,
  niceTicks,
  parseActivityStreams,
  parseActivityZones,
  smoothSeries,
  summarizeRange
} = await import(`${streamsUrl.href}?cacheBust=${Date.now()}`);

// Synthetic COROS detail payload in the units PACE Pro sends: centisecond
// timestamps, centimetre distance, s/km pace, mm oscillation, ‰ ratio.
const START = 178_000_000_000;
const PAUSE_AT = 300; // timer stops after sample 299 for 60 s
const PAUSE_CS = 6_000;

function runSample(index) {
  const stamp = START + index * 100 + (index >= PAUSE_AT ? PAUSE_CS : 0);
  const sample = {
    timestamp: stamp,
    distance: Math.round(index * 333.33),
    gpsLat: 453_900_000 + index * 10,
    gpsLon: -757_500_000 - index * 10,
    heart: 150,
    cadence: 170,
    cadenceLength: 110,
    groundTime: 260,
    verticalVibration: 92,
    verticalStrideRatio: 85,
    power: 230,
    adjustedPace: 295,
    speed: 300,
    altitude: 50 + Math.floor(index / 100) * 5,
    slope: 1
  };
  // Standing at the pause: COROS reports pace racing towards infinity.
  if (index >= PAUSE_AT - 2 && index < PAUSE_AT + 2) sample.speed = 3_000;
  // Barometer dropouts.
  if (index >= 120 && index < 130) delete sample.altitude;
  return sample;
}

const run = {
  summary: { startTimestamp: START, speedUnit: 3 },
  frequencyList: Array.from({ length: 600 }, (_, index) => runSample(index)),
  pauseList: [{ startTimestamp: START + PAUSE_AT * 100 - 50, endTimestamp: START + PAUSE_AT * 100 - 50 + PAUSE_CS, duration: PAUSE_CS, type: 0 }],
  lapList: [
    { type: 10, lapItemList: [0, 1, 2].map((lap) => ({ startTimestamp: START + lap * 20_000, endTimestamp: START + (lap + 1) * 20_000, exerciseType: 2 })) },
    {
      type: 2,
      lapItemList: [
        { startTimestamp: START, endTimestamp: START + 10_000, exerciseType: 1 },
        { startTimestamp: START + 10_000, endTimestamp: START + 25_000, exerciseType: 2 },
        { startTimestamp: START + 25_000, endTimestamp: START + 40_000 + PAUSE_CS, exerciseType: 4 },
        { startTimestamp: START + 40_000 + PAUSE_CS, endTimestamp: START + 60_000 + PAUSE_CS, exerciseType: 3 }
      ]
    },
    { type: -1, lapItemList: [{ startTimestamp: START, endTimestamp: START + 60_000 + PAUSE_CS }] }
  ],
  zoneList: [
    {
      type: 126,
      zoneType: 2,
      zoneItemList: [
        { zoneIndex: 0, leftScope: 137, rightScope: 159, second: 30 },
        { zoneIndex: 1, leftScope: 137, rightScope: 159, second: 90 },
        { zoneIndex: 2, leftScope: 160, rightScope: 174, second: 180 },
        { zoneIndex: 3, leftScope: 175, rightScope: 179, second: 0 },
        { zoneIndex: 4, leftScope: 180, rightScope: 190, second: 0 },
        { zoneIndex: 5, leftScope: 190, rightScope: 423, second: 0 }
      ]
    },
    {
      type: 130,
      zoneType: 0,
      zoneItemList: [
        { zoneIndex: 0, leftScope: 395_000, rightScope: 327_000, second: 100 },
        { zoneIndex: 1, leftScope: 395_000, rightScope: 327_000, second: 200 },
        { zoneIndex: 2, leftScope: 327_000, rightScope: 301_000, second: 0 }
      ]
    }
  ]
};

const streams = parseActivityStreams(run);
assert.ok(streams, "run payload parses");
assert.equal(streams.length, 600);
assert.equal(streams.speedKind, "pace");
assert.equal(streams.hasGps, true);
assert.equal(streams.hasDistance, true);

// Moving time drops the 60 s pause and stays non-decreasing.
assert.equal(streams.t[0], 0);
assert.ok(Math.abs(streams.t[599] - 599) < 1, `moving time ends near 599 s, got ${streams.t[599]}`);
for (let index = 1; index < streams.length; index += 1) {
  assert.ok(streams.t[index] >= streams.t[index - 1], "t is non-decreasing");
  assert.ok(streams.d[index] >= streams.d[index - 1], "d is non-decreasing");
}
assert.equal(streams.pauses.length, 1);
assert.equal(streams.pauses[0].seconds, 60);

// Units are scaled to canonical values.
assert.equal(streams.channels.pace[10], 300);
assert.equal(streams.channels.gap[10], 295);
assert.equal(streams.channels.stride[10], 1.1);
assert.equal(streams.channels.vo[10], 9.2);
assert.equal(streams.channels.vr[10], 8.5);
assert.ok(Math.abs(streams.lat[0] - 45.39) < 1e-9);

// Standing still blanks pace instead of plunging to 50 min/km.
assert.ok(Number.isNaN(streams.channels.pace[PAUSE_AT]), "stopped pace sample is a gap");
assert.equal(streams.channels.pace[PAUSE_AT + 5], 300);

// Missing altitude is bridged so the terrain area has no seams.
for (let index = 120; index < 130; index += 1) {
  assert.ok(Number.isFinite(streams.channels.elevation[index]), `elevation ${index} filled`);
}

// Device laps (type 2) win over km splits and carry workout steps.
assert.equal(streams.structured, true);
assert.deepEqual(streams.laps.map((lap) => lap.kind), ["warmup", "work", "recovery", "cooldown"]);
assert.equal(streams.laps[0].from, 0);
assert.equal(streams.laps[1].from, 100);
assert.equal(streams.laps[3].to, 599);

// Zones: COROS repeats zone 2's leftScope on zone 1; bounds come from the neighbours.
const hr = streams.zones.hr.zones;
assert.equal(hr.length, 6);
assert.equal(hr[0].start, undefined);
assert.equal(hr[0].end, 136);
assert.deepEqual([hr[1].start, hr[1].end], [137, 159]);
assert.deepEqual([hr[4].start, hr[4].end], [180, 189]);
assert.equal(hr[5].start, 190);
assert.equal(hr[5].end, undefined);
assert.ok(Math.abs(hr.reduce((sum, zone) => sum + zone.share, 0) - 1) < 1e-9);
const pace = streams.zones.pace.zones;
assert.deepEqual([pace[0].start, pace[0].end], [undefined, 395]);
assert.deepEqual([pace[1].start, pace[1].end], [395, 327]);
assert.deepEqual(parseActivityZones(run), streams.zones, "zones parse without samples too");

// Range summary: pace is distance over moving time.
const whole = summarizeRange(streams, 0, 599);
const expectedPace = (whole.seconds / whole.meters) * 1000;
assert.ok(Math.abs(whole.averages.pace - expectedPace) < 1e-9);
assert.equal(whole.averages.hr, 150);
assert.equal(whole.maxima.gap, 295);
assert.ok(Math.abs(whole.elevationGain - 25) < 1e-9, `gain 25 m, got ${whole.elevationGain}`);

// A programmed steady run tags every split "work": that is not a structured session.
const steady = parseActivityStreams({ ...run, lapList: [run.lapList[0]] });
assert.equal(steady.structured, false);
assert.deepEqual(steady.laps.map((lap) => lap.kind), ["lap", "lap", "lap"]);

// Bikes: km/h × 100, and a stopped bike is a real 0 km/h.
const ride = parseActivityStreams(
  {
    frequencyList: Array.from({ length: 100 }, (_, index) => ({
      timestamp: START + index * 100,
      distance: index * 500,
      heart: 120,
      speed: index >= 40 && index < 50 ? 0 : 1800
    }))
  },
  { cycling: true }
);
assert.equal(ride.speedKind, "speed");
assert.equal(ride.channels.pace[10], 18);
assert.equal(ride.channels.pace[45], 0);
assert.equal(ride.channels.power, undefined, "no power meter, no power channel");
assert.equal(ride.laps.length, 0);

assert.equal(parseActivityStreams({ frequencyList: [] }), null);
assert.equal(parseActivityStreams(undefined), null);

// Smoothing: centered window that skips gaps; pace averages as speed.
const t = Float64Array.from([0, 1, 2, 3, 4]);
assert.deepEqual(Array.from(smoothSeries(t, Float64Array.from([1, 2, 3, 4, 5]), 2)), [1.5, 2, 3, 4, 4.5]);
assert.deepEqual(Array.from(smoothSeries(t, Float64Array.from([1, Number.NaN, 3, 4, 5]), 2)), [1, 2, 3.5, 4, 4.5]);
const harmonic = smoothSeries(Float64Array.from([0, 1]), Float64Array.from([300, 600]), 4, true);
assert.ok(Math.abs(harmonic[0] - 400) < 1e-9, "300 and 600 s/km average to 400 s/km");

assert.deepEqual(niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
assert.deepEqual(niceTicks(250, 420, 3, [30, 60, 120]), [300, 360, 420]);
assert.deepEqual(elevationChange(Float64Array.from([10, 11, 10, 13, 13, 9]), 0, 5), { gain: 3, loss: 4 });

// Route distance markers follow the watch's distance, skip paused points
// (COROS distance 0 → undefined) and stay clear of the finish.
const markersUrl = pathToFileURL(path.join(repoRoot, "src", "training", "routeDistanceMarkers.ts"));
const { routeDistanceMarkers } = await import(`${markersUrl.href}?cacheBust=${Date.now()}`);
const along = (meters) => ({ lat: 45, lon: -75 + meters / 100000, distance: meters });
const pausedRun = [along(0), along(600), { lat: 45, lon: -74.9 }, along(1400), along(2500), along(3200)];
assert.deepEqual(
  routeDistanceMarkers(pausedRun, "metric").map((marker) => [marker.label, +marker.latLng[1].toFixed(5)]),
  [["1", -74.99], ["2", -74.98], ["3", -74.97]]
);
assert.deepEqual(routeDistanceMarkers([along(0), along(3010)], "metric").map((m) => m.label), ["1", "2"], "3 km sits on the finish");
assert.deepEqual(routeDistanceMarkers([along(0), along(5000)], "imperial").map((m) => m.label), ["1", "2", "3"]);
assert.deepEqual(routeDistanceMarkers([along(1500), along(3500)], "metric").map((m) => m.label), ["2", "3"], "late GPS lock");
const century = routeDistanceMarkers([along(0), along(100_500)], "metric").map((m) => m.label);
assert.equal(century[0], "5", "long rides step up so the map stays legible");
assert.equal(century.length, 20);
// No watch distance: measure the GPS path (0.01° of longitude at 45° N ≈ 787 m).
const unmeasured = routeDistanceMarkers(
  Array.from({ length: 6 }, (_, i) => ({ lat: 45, lon: -75 + i * 0.01 })),
  "metric"
);
assert.deepEqual(unmeasured.map((m) => m.label), ["1", "2", "3"]);
assert.deepEqual(routeDistanceMarkers([along(0)], "metric"), []);

console.log("activity streams: ok");
