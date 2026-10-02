import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const bust = `?cacheBust=${Date.now()}`;

const { decodeFit, FIT_EPOCH_OFFSET_SECONDS, FIT_MSG } = await import(
  `${distUrl("fitDecoder.js")}${bust}`
);
const { parseFitActivity, timerSecondsAt } = await import(
  `${distUrl("fitActivity.js")}${bust}`
);
const {
  bestEfforts,
  computeSplits,
  decoupling,
  elevationGainLoss,
  normalizedPower,
  powerCurve,
  routeSignature,
  routeSimilarity,
  downsampleSeries
} = await import(`${distUrl("fitAnalytics.js")}${bust}`);
const { summarizeFitActivity } = await import(`${distUrl("fitSummary.js")}${bust}`);

// ----- Tiny FIT encoder (just enough to exercise the decoder) -----

const BASE = {
  enum: 0x00,
  uint8: 0x02,
  sint32: 0x85,
  uint16: 0x84,
  uint32: 0x86
};
const SIZE = { 0x00: 1, 0x02: 1, 0x85: 4, 0x84: 2, 0x86: 4 };

class FitWriter {
  constructor() {
    this.chunks = [];
  }
  push(bytes) {
    this.chunks.push(Uint8Array.from(bytes));
  }
  definition(local, globalNum, fields, { bigEndian = false, developer = [] } = {}) {
    const header = 0x40 | (developer.length ? 0x20 : 0) | local;
    const bytes = [header, 0, bigEndian ? 1 : 0];
    if (bigEndian) bytes.push((globalNum >> 8) & 0xff, globalNum & 0xff);
    else bytes.push(globalNum & 0xff, (globalNum >> 8) & 0xff);
    bytes.push(fields.length);
    for (const [num, base] of fields) bytes.push(num, SIZE[base], base);
    if (developer.length) {
      bytes.push(developer.length);
      for (const [num, size, index] of developer) bytes.push(num, size, index);
    }
    this.push(bytes);
    this[`def${local}`] = { fields, bigEndian, developer };
  }
  encode(value, base, bigEndian) {
    const size = SIZE[base];
    const buffer = new DataView(new ArrayBuffer(size));
    if (base === 0x85) buffer.setInt32(0, value, !bigEndian);
    else if (base === 0x86) buffer.setUint32(0, value, !bigEndian);
    else if (base === 0x84) buffer.setUint16(0, value, !bigEndian);
    else buffer.setUint8(0, value);
    return [...new Uint8Array(buffer.buffer)];
  }
  data(local, values, { compressedOffset } = {}) {
    const def = this[`def${local}`];
    const header =
      compressedOffset === undefined ? local : 0x80 | (local << 5) | (compressedOffset & 0x1f);
    const bytes = [header];
    def.fields.forEach(([, base], index) => {
      bytes.push(...this.encode(values[index], base, def.bigEndian));
    });
    for (const [, size] of def.developer) for (let i = 0; i < size; i += 1) bytes.push(0xaa);
    this.push(bytes);
  }
  finish() {
    const dataSize = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const header = new Uint8Array(14);
    header[0] = 14;
    header[1] = 0x20;
    header[2] = 0xa6;
    header[3] = 0x52;
    new DataView(header.buffer).setUint32(4, dataSize, true);
    header.set([0x2e, 0x46, 0x49, 0x54], 8);
    const out = new Uint8Array(14 + dataSize + 2);
    out.set(header, 0);
    let offset = 14;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

// ----- Synthetic activity: 1200 s of samples with a 60 s pause -----

const START = 1_783_262_048; // unix seconds
const fit = (unix) => unix - FIT_EPOCH_OFFSET_SECONDS;
const SPEED = 3; // m/s
const TOTAL = 1200;
const PAUSE_START = 300;
const PAUSE_END = 360;
const toSemicircles = (deg) => Math.round((deg * 2 ** 31) / 180);

const writer = new FitWriter();
writer.definition(0, FIT_MSG.FILE_ID, [
  [0, BASE.enum],
  [1, BASE.uint16],
  [2, BASE.uint16],
  [4, BASE.uint32]
]);
writer.data(0, [4, 294, 1, fit(START)]);

writer.definition(1, FIT_MSG.EVENT, [
  [253, BASE.uint32],
  [0, BASE.enum],
  [1, BASE.enum]
]);
// record with timestamp (local 2) and without (local 3, for compressed headers)
const RECORD_FIELDS = [
  [0, BASE.sint32], // lat
  [1, BASE.sint32], // lon
  [5, BASE.uint32], // distance cm
  [6, BASE.uint16], // speed mm/s
  [3, BASE.uint8], // hr
  [7, BASE.uint16], // power
  [2, BASE.uint16], // altitude (alt+500)*5
  [4, BASE.uint8] // cadence
];
writer.definition(2, FIT_MSG.RECORD, [[253, BASE.uint32], ...RECORD_FIELDS]);
writer.definition(3, FIT_MSG.RECORD, RECORD_FIELDS);

writer.data(1, [fit(START), 0, 0]); // timer start

let movingT = 0;
let lastFullTimestamp = null;
for (let second = 0; second < TOTAL; second += 1) {
  const ts = START + second;
  if (second === PAUSE_START) writer.data(1, [fit(ts), 0, 4]); // stop_all
  if (second === PAUSE_END) writer.data(1, [fit(ts), 0, 0]); // start
  const paused = second > PAUSE_START && second < PAUSE_END;
  if (!paused && second > PAUSE_START) movingT = second - (PAUSE_END - PAUSE_START);
  else if (!paused) movingT = second;

  const dist = paused ? PAUSE_START * SPEED : movingT * SPEED;
  const power = movingT >= 600 && movingT < 900 ? 300 : 200;
  const hr = movingT < 570 ? 140 : 150;
  const alt = movingT < 500 ? movingT / 10 : 50;
  const lat = 45 + (dist / 111320);
  const values = [
    toSemicircles(lat),
    toSemicircles(-75.5),
    Math.round(dist * 100),
    SPEED * 1000,
    hr,
    power,
    Math.round((alt + 500) * 5),
    85
  ];
  if (second >= TOTAL - 10 && lastFullTimestamp !== null) {
    // Compressed timestamp header: 5-bit offset relative to the last full stamp.
    writer.data(3, values, { compressedOffset: fit(ts) & 0x1f });
  } else {
    writer.data(2, [fit(ts), ...values]);
    lastFullTimestamp = fit(ts);
  }
}
writer.data(1, [fit(START + TOTAL - 1), 0, 4]);

writer.definition(4, FIT_MSG.LAP, [
  [253, BASE.uint32],
  [2, BASE.uint32],
  [8, BASE.uint32],
  [9, BASE.uint32],
  [15, BASE.uint8]
]);
writer.data(4, [fit(START + 400), fit(START), 340_000, 102_000, 140]);
writer.data(4, [fit(START + TOTAL - 1), fit(START + 400), 799_000, 239_700, 150]);

// Big-endian session with a developer field that must be skipped by size.
writer.definition(
  5,
  FIT_MSG.SESSION,
  [
    [253, BASE.uint32],
    [2, BASE.uint32],
    [5, BASE.enum],
    [8, BASE.uint32],
    [9, BASE.uint32],
    [16, BASE.uint8]
  ],
  { bigEndian: true, developer: [[0, 4, 0]] }
);
writer.data(5, [fit(START + TOTAL - 1), fit(START), 1, 1_140_000, 341_700, 145]);

const bytes = writer.finish();

// ----- decodeFit -----

const decoded = decodeFit(bytes);
const count = (globalNum) => decoded.messages.filter((m) => m.globalNum === globalNum).length;
assert.equal(count(FIT_MSG.FILE_ID), 1);
assert.equal(count(FIT_MSG.RECORD), TOTAL);
assert.equal(count(FIT_MSG.LAP), 2);
assert.equal(count(FIT_MSG.SESSION), 1);
assert.equal(count(FIT_MSG.EVENT), 4);

const session = decoded.messages.find((m) => m.globalNum === FIT_MSG.SESSION);
assert.equal(session.fields.get(5), 1, "big-endian enum");
assert.equal(session.fields.get(8), 1_140_000, "big-endian uint32 with developer bytes skipped");
assert.equal(session.fields.get(16), 145);

const records = decoded.messages.filter((m) => m.globalNum === FIT_MSG.RECORD);
const lastStamps = records.slice(-10).map((m) => m.fields.get(253));
assert.deepEqual(
  lastStamps,
  Array.from({ length: 10 }, (_, i) => fit(START + TOTAL - 10 + i)),
  "compressed timestamp headers reconstruct full timestamps"
);

// ----- parseFitActivity -----

const activity = parseFitActivity(bytes);
assert.equal(activity.session.sport, 1);
assert.equal(activity.session.timerSec, 1140);
assert.equal(activity.session.distanceM, 3417);
assert.equal(activity.laps.length, 2);
assert.equal(activity.laps[0].distanceM, 1020);
assert.equal(activity.activeWindows.length, 2, "two timer windows around the pause");
assert.equal(
  activity.records.length,
  TOTAL - (PAUSE_END - PAUSE_START - 1),
  "records inside the pause are dropped"
);
const resumed = activity.records.find((r) => r.ts === START + PAUSE_END);
assert.equal(resumed.t, PAUSE_START, "timer time excludes the pause");
assert.equal(activity.records[activity.records.length - 1].t, TOTAL - 1 - (PAUSE_END - PAUSE_START));
assert.equal(timerSecondsAt(activity.activeWindows, START + PAUSE_START + 30), PAUSE_START);
const mid = activity.records.find((r) => r.t === 100);
assert.ok(Math.abs(mid.lat - (45 + 300 / 111320)) < 1e-6, "semicircles → degrees");
assert.equal(mid.dist, 300);
assert.equal(mid.speed, 3);
assert.equal(mid.alt, 10);
assert.equal(mid.power, 200);

// ----- analytics -----

const curve = powerCurve(activity.records);
const at = (d) => curve.find((p) => p.durationSec === d)?.watts;
assert.equal(at(5), 300);
assert.equal(at(300), 300, "5-min best sits inside the 300 W block");
assert.equal(at(600), 250, "10-min best straddles the block");
assert.equal(at(1), 300);
assert.ok(normalizedPower(activity.records) > 200 && normalizedPower(activity.records) < 260);

const efforts = bestEfforts(activity.records);
const oneK = efforts.find((e) => e.distanceM === 1000);
assert.ok(Math.abs(oneK.seconds - 1000 / SPEED) < 1.5, `1 km effort ${oneK.seconds}s`);
assert.ok(!efforts.some((e) => e.distanceM === 5000), "distances beyond the activity are skipped");

const splits = computeSplits(activity.records, 1000);
assert.equal(splits.length, 4);
assert.equal(splits.filter((s) => !s.partial).length, 3);
assert.ok(Math.abs(splits[0].seconds - 333.3) < 1.5);
assert.equal(splits[0].avgHr, 140);
assert.ok(splits[0].elevGainM >= 28 && splits[0].elevGainM <= 34, `split 1 gain ${splits[0].elevGainM}`);
assert.equal(splits[3].partial, true);
assert.ok(splits[3].distanceM > 400 && splits[3].distanceM < 420);

const gain = elevationGainLoss(activity.records.map((r) => r.alt));
assert.ok(gain.gain >= 47 && gain.gain <= 51, `total gain ${gain.gain}`);
assert.equal(gain.loss, 0);

const drift = decoupling(activity.records);
assert.equal(drift.metric, "power");
assert.ok(drift.percent < 0, "second half has more power per beat here, so decoupling is negative");

const route = routeSignature(activity.records);
assert.equal(route.polyline.length, 64);
assert.equal(route.distanceM, 3417);
assert.equal(routeSimilarity(route, route), 1);
const shifted = {
  ...route,
  polyline: route.polyline.map(([lat, lon]) => [lat, lon + 0.02]) // ~1.5 km east
};
assert.equal(routeSimilarity(route, shifted), 0);
const reversed = { ...route, polyline: [...route.polyline].reverse() };
assert.equal(routeSimilarity(route, reversed), 1, "direction-agnostic");

const series = downsampleSeries(activity.records, 100);
assert.equal(series.length, 100);
assert.equal(series[series.length - 1].dist, 3417);

// ----- summary -----

const summary = summarizeFitActivity(activity, {
  activityId: "abc",
  sportType: 100,
  name: "Test run"
});
assert.equal(summary.startTime, START);
assert.equal(summary.hasGps, true);
assert.equal(summary.hasPower, true);
assert.equal(summary.hasHr, true);
assert.equal(summary.avgHr, 145);
assert.equal(summary.splitsKm.length, 4);
assert.equal(summary.splitsMi.length, 3);
assert.equal(summary.laps.length, 2);
assert.equal(summary.series.length, 400);
assert.ok(summary.powerCurve.length > 0 && summary.bestEfforts.length > 0);

// Truncated / non-FIT input fails loudly instead of returning garbage.
assert.throws(() => decodeFit(new Uint8Array(4)), /too small/);
assert.throws(() => decodeFit(new Uint8Array(20)), /header size|signature/);

console.log("test-fit-decoder: ok");
