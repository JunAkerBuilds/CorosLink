import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const {
  efficiencyProfile,
  efficiencyVerdict,
  effectiveVo2max,
  oxygenCost,
  readRunEfficiency,
  efficiencyTrend,
  runEfficiencyCurve,
  runEfficiencySteps,
  sportHasRunEfficiency
} = await import(`${pathToFileURL(path.join(repoRoot, "src", "training", "runEfficiency.ts")).href}?cacheBust=${Date.now()}`);

/** A 1 Hz run on moving time: `at(second)` gives { pace (s/km), hr, cadence }. */
function run(seconds, at) {
  const t = new Float64Array(seconds);
  const pace = new Float64Array(seconds);
  const hr = new Float64Array(seconds);
  const cadence = new Float64Array(seconds);
  for (let second = 0; second < seconds; second += 1) {
    const sample = at(second);
    t[second] = second;
    pace[second] = sample.pace;
    hr[second] = sample.hr;
    cadence[second] = sample.cadence ?? 172;
  }
  return {
    length: seconds,
    t,
    d: new Float64Array(seconds),
    lat: new Float64Array(seconds),
    lon: new Float64Array(seconds),
    channels: { pace, hr, cadence },
    speedKind: "pace",
    hasDistance: true,
    hasGps: false,
    structured: false,
    laps: [],
    pauses: [],
    zones: {}
  };
}

const profile = efficiencyProfile(190, 50);
assert.ok(profile);
assert.equal(efficiencyProfile(190, 160), undefined, "a reserve under 40 bpm is no profile");
assert.equal(efficiencyProfile(undefined, 50), undefined);
assert.ok(sportHasRunEfficiency(100) && sportHasRunEfficiency(103));
assert.ok(!sportHasRunEfficiency(101) && !sportHasRunEfficiency(102), "treadmill and trail runs are left out");

// Daniels & Gilbert at 200 m/min (5:00/km).
assert.ok(Math.abs(oxygenCost(200) - 36.0116) < 1e-3);
// 150 bpm on 50/190 is 71% of the reserve.
const expected = 3.5 + (oxygenCost(200) - 3.5) / ((150 - 50) / 140);
assert.ok(Math.abs(effectiveVo2max(200, 150, profile) - expected) < 1e-9);
assert.equal(effectiveVo2max(200, 100, profile), undefined, "under 40% of the reserve is too easy to read");
assert.equal(effectiveVo2max(200, 195, profile), undefined, "above the maximum says the profile is out of date");

// A steady hour reads from minute 10 to near the end.
const steadyHour = run(3600, () => ({ pace: 300, hr: 150 }));
const steps = runEfficiencySteps(steadyHour);
assert.equal(steps[0].reason, "warmUp");
assert.ok(steps.some((step) => step.reading), "a steady hour has readings");
assert.equal(steps.at(-1).reason, "end", "the last minute or so cannot see the heart's response");
const firstRead = steps.find((step) => step.reading);
assert.equal(firstRead.t, 600);
assert.deepEqual(firstRead.reading, [600, 200, 150]);

// A walk (cadence under 140) is not read as running slowly.
const walking = runEfficiencySteps(run(1800, () => ({ pace: 700, hr: 120, cadence: 110 })));
assert.ok(walking.filter((step) => step.t >= 600 && step.reason !== "end").every((step) => step.reason === "walking"));

// Surging every minute is never steady enough to read.
const surging = runEfficiencySteps(run(2400, (second) => ({ pace: Math.floor(second / 60) % 2 ? 250 : 350, hr: 160 })));
assert.ok(!surging.some((step) => step.reading));
assert.ok(surging.some((step) => step.reason === "paceChanging"));

// With no history, the run's own COROS VO2max anchors the scale.
const day = 86_400;
const now = 1_790_000_000;
const lone = { activityId: "lone", startTime: now, seconds: 3600, curve: runEfficiencyCurve(steadyHour, 52) };
const loneReading = readRunEfficiency(lone, [lone], profile);
assert.ok(Math.abs(loneReading.value - 52) < 1e-9);
assert.equal(loneReading.scaled, true);
assert.equal(loneReading.verdict, undefined, "no usual without three runs before it");
assert.equal(loneReading.baselineRuns, 0);
assert.ok(loneReading.points.length > 50, "the run's readings come back for its chart");
assert.ok(loneReading.points.every((point) => Math.abs(point.value - 52) < 1e-6), "on the same scale as its figure");

// Four usual runs in the six weeks before; then the same heart rate buys a faster pace.
const usual = [1, 2, 3, 4].map((week) => ({
  activityId: `usual-${week}`,
  startTime: now - week * 7 * day,
  seconds: 3600,
  curve: runEfficiencyCurve(steadyHour, 52)
}));
const faster = {
  activityId: "faster",
  startTime: now,
  seconds: 3600,
  curve: runEfficiencyCurve(run(3600, () => ({ pace: 285, hr: 150 })), 52)
};
const reading = readRunEfficiency(faster, [...usual, faster], profile);
assert.equal(reading.verdict, "better");
assert.ok(reading.change > 3, `faster at the same heart rate reads as better, got ${reading.change}`);
assert.equal(reading.baselineRuns, 4);
assert.ok(Math.abs(reading.usual - 52) < 1e-6, "the usual run reads as COROS's VO2max");
assert.ok(reading.value > 52);
assert.ok(reading.durability, "an hour-long run says how it held to the end");
assert.ok(Math.abs(reading.durability.change) < 1, "a steady run holds its level");

// A run older than six weeks is not part of the usual.
const stale = usual.map((entry) => ({ ...entry, startTime: entry.startTime - 60 * day }));
assert.equal(readRunEfficiency(faster, [...stale, faster], profile).verdict, undefined);

// The trend reads each run in the period against the weeks before it.
const trend = efficiencyTrend([...usual, faster], profile, now - day);
assert.equal(trend.length, 1);
assert.equal(trend[0].activityId, "faster");
assert.equal(trend[0].verdict, "better");

// The verdict reads the change as it is shown: 2.99% is "+3%", so better.
assert.equal(efficiencyVerdict(1.0299, 1), "better");
assert.equal(efficiencyVerdict(1.0249, 1), "usual");
assert.equal(efficiencyVerdict(0.97, 1), "worse");

console.log("run efficiency: ok");

// ----- The shared history sweep -----
const { fillEfficiencyHistory } = await import(
  `${pathToFileURL(path.join(repoRoot, "src", "training", "activityInsights.ts")).href}?cacheBust=${Date.now()}`
);
const sweepRuns = ["run-1", "run-2", "run-3"].map((activityId) => ({ activityId, sportType: 100, startTime: 1_700_000_000 }));
const read = [];
const loadDetail = async (activity) => {
  read.push(activity.activityId);
  throw new Error("no detail in this test");
};

// A widget mounted twice in a row (React's development double mount): the
// first mount stops, the second joins the sweep and it reads every run.
let firstStopped = false;
void fillEfficiencyHistory(sweepRuns, loadDetail, undefined, () => firstStopped);
firstStopped = true;
const progress = [];
await fillEfficiencyHistory(sweepRuns, loadDetail, (done, total) => progress.push([done, total]), () => false);
assert.deepEqual(read, ["run-1", "run-2", "run-3"], "each run is read once");
assert.deepEqual(progress.at(-1), [3, 3]);

// Once every caller stops, the runs nobody wants any more are left for later.
read.length = 0;
let stopped = false;
const abandoned = fillEfficiencyHistory(sweepRuns, loadDetail, undefined, () => stopped);
stopped = true;
await abandoned;
assert.deepEqual(read, ["run-1"], "only the run already being read");

console.log("efficiency sweep: ok");
