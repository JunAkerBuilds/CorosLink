import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (name) =>
  import(`${pathToFileURL(path.join(repoRoot, "src", "training", name)).href}?cacheBust=${Date.now()}`);
const { summarizeSessionIntensity, heartRateZone, paceZone } = await load("sessionIntensity.ts");
const { trainingLabel, formatRepSize } = await load("trainingBenefit.ts");

// Zones as parseActivityZones leaves them: each zone's `start` is its floor
// (bpm) or its slow edge (s/km); pace is COROS's six named zones.
const HR_STARTS = [undefined, 120, 140, 155, 165, 175];
const PACE_STARTS = [undefined, 420, 360, 330, 300, 280];
const zoneList = (starts) => starts.map((start, index) => ({ index, seconds: 1, share: 1 / 6, start }));

/**
 * A 1 Hz run, built from segments of { seconds, pace (s/km), hr, kind? }.
 * Laps follow the segments when `kind` is given.
 */
function run(segments, { model = "reserve", namedPace = true } = {}) {
  const t = [];
  const d = [];
  const pace = [];
  const hr = [];
  const laps = [];
  let distance = 0;
  for (const segment of segments) {
    const from = t.length;
    for (let second = 0; second < segment.seconds; second += 1) {
      t.push(t.length);
      d.push(distance);
      pace.push(segment.pace);
      hr.push(segment.hr);
      distance += 1000 / segment.pace;
    }
    if (segment.kind) laps.push({ index: laps.length + 1, kind: segment.kind, from, to: t.length - 1 });
  }
  return {
    length: t.length,
    t: Float64Array.from(t),
    d: Float64Array.from(d),
    lat: new Float64Array(t.length).fill(Number.NaN),
    lon: new Float64Array(t.length).fill(Number.NaN),
    channels: { pace: Float64Array.from(pace), hr: Float64Array.from(hr) },
    speedKind: "pace",
    hasDistance: true,
    hasGps: false,
    structured: laps.some((lap) => lap.kind === "work") && new Set(laps.map((lap) => lap.kind)).size > 1,
    laps,
    pauses: [],
    zones: {
      hr: { kind: "hr", zones: zoneList(HR_STARTS), ...(model ? { model } : {}) },
      pace: { kind: "pace", zones: zoneList(PACE_STARTS), named: namedPace }
    }
  };
}

const label = (streams, sportType = 100, fallback) =>
  trainingLabel(sportType, summarizeSessionIntensity(streams, sportType), fallback);

// Bucketing: a zone's floor is inside it; pace is inside a zone up to its slow edge.
assert.equal(heartRateZone(zoneList(HR_STARTS), 119), 0);
assert.equal(heartRateZone(zoneList(HR_STARTS), 155), 3);
assert.equal(heartRateZone(zoneList(HR_STARTS), 200), 5);
assert.equal(paceZone(zoneList(PACE_STARTS), 430), 0);
assert.equal(paceZone(zoneList(PACE_STARTS), 330), 3);
assert.equal(paceZone(zoneList(PACE_STARTS), 250), 5);

// An easy hour: Aerobic, read on pace and heart rate together.
const easy = label(run([{ seconds: 3000, pace: 380, hr: 135 }]));
assert.equal(easy.label, "aerobic");
assert.equal(easy.basis.kind, "steady");
assert.equal(easy.basis.measure, "both");
assert.equal(easy.shape, undefined, "a 50-minute run has no shape");

// Thirty minutes at threshold after the warm-up.
assert.equal(label(run([{ seconds: 600, pace: 360, hr: 145 }, { seconds: 1800, pace: 315, hr: 160 }])).label, "threshold");

// A hot easy run: the pulse drifts into Threshold but the pace stays easy, so it is not a tempo run.
assert.equal(label(run([{ seconds: 3000, pace: 400, hr: 160 }])).label, "aerobic");
// The same pulse with no pace zones to check it against (a treadmill) reads on heart rate alone.
const treadmill = label(run([{ seconds: 3000, pace: 400, hr: 160 }]), 101);
assert.equal(treadmill.label, "threshold");
assert.equal(treadmill.basis.measure, "hr");

// Structured intervals: six 1 km reps at VO2 max pace with recoveries between.
const reps = [{ seconds: 600, pace: 380, hr: 135, kind: "warmup" }];
for (let rep = 0; rep < 6; rep += 1) {
  reps.push({ seconds: 285 + rep * 2, pace: 285 + rep * 2, hr: 168, kind: "work" });
  reps.push({ seconds: 120, pace: 480, hr: 140, kind: "recovery" });
}
reps.push({ seconds: 600, pace: 390, hr: 135, kind: "cooldown" });
const intervals = label(run(reps));
assert.equal(intervals.label, "vo2max");
assert.deepEqual(intervals.basis, { kind: "reps", count: 6, measure: "pace" });
assert.equal(intervals.shape.kind, "intervals");
assert.equal(intervals.shape.count, 6);
assert.equal(intervals.shape.size.unit, "meters", "each rep held to 1 km, not to a time");
assert.equal(formatRepSize(intervals.shape.size), "1 km");

// Too little read after the warm-up says nothing.
assert.equal(label(run([{ seconds: 780, pace: 380, hr: 135 }])), undefined);
// Under ten minutes is not a session.
assert.equal(label(run([{ seconds: 500, pace: 300, hr: 170 }])), undefined);
// A swim is not labelled.
assert.equal(summarizeSessionIntensity(run([{ seconds: 3000, pace: 380, hr: 135 }]), 300), undefined);

// A long easy run is named by its length.
const long = label(run([{ seconds: 100 * 60, pace: 380, hr: 135 }]));
assert.equal(long.label, "aerobic");
assert.deepEqual(long.shape, { kind: "long", ride: false });
// Exactly 90 minutes counts: the last sample stands for its own second.
assert.deepEqual(label(run([{ seconds: 90 * 60, pace: 380, hr: 135 }])).shape, { kind: "long", ride: false });

// The Max HR model's third zone is Fat Burn, still easy; on HR reserve it would be Aerobic Power.
const fatBurn = run([{ seconds: 3000, pace: 400, hr: 145 }], { model: "maxHr" });
assert.equal(label(fatBurn, 101).label, "aerobic");
assert.equal(label(run([{ seconds: 3000, pace: 400, hr: 145 }], { model: "reserve" }), 101).label, "tempo");
// A session that names no model uses the account's last known one.
assert.equal(label(run([{ seconds: 3000, pace: 400, hr: 145 }], { model: null }), 101, "maxHr").label, "aerobic");

// Strides: short reps that decide nothing keep their shape on an easy run.
const strides = trainingLabel(100, {
  version: 1,
  seconds: 2400,
  hr: [0, 1800, 0, 0, 0, 0],
  reps: Array.from({ length: 6 }, () => ({ seconds: 20, meters: 110, hrZone: 2, paceZone: 5 }))
});
assert.equal(strides.label, "aerobic");
assert.deepEqual(strides.shape, { kind: "strides", count: 6, size: { unit: "seconds", value: 20 } });
assert.equal(formatRepSize(strides.shape.size), "20″");
assert.equal(formatRepSize({ unit: "seconds", value: 90 }), "1′30″");
assert.equal(formatRepSize({ unit: "seconds", value: 480 }), "8′");
assert.equal(formatRepSize({ unit: "meters", value: 400 }), "400 m");
assert.equal(formatRepSize({ unit: "meters", value: 1600 }), "1.6 km");

console.log("training labels: ok");
