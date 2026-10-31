import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeDeltaPack, marker, pages, pauseRecord, record, resumeRecord, seriesRecord, startRecord, summaryRecord, syntheticOpenWaterSwim, syntheticPoolSwim, syntheticPoolSwimAtTheWall, syntheticRun } from "./fixtures/coros-sport-record-fixture.mjs";

// Decoder for the PACE 4 sport-record file (SyncData file 14) and the FIT
// writer that stores decoded activities. Runs against the compiled
// main-process modules (npm run build:electron first).
//
// COROSLINK_SPORT_RECORD_ORACLE=<dir> additionally checks a real recording:
// <dir>/raw-file14.bin against <dir>/coros-export.fit, the COROS app's own
// export of the same file. COROSLINK_SWIM_ORACLE=<dir> checks every swim in
// <dir>/raw-file14.bin against <dir>/coros-export-<start>.fit and .csv.
// Real recordings are never committed.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "dist-electron", file)).href);
const { decodeDeltaPack, decodeCorosSportRecordFile, walkCorosRecords, CorosSportRecordFormatError, MAX_SESSION_SECONDS } = await load("localSync/corosSportRecord.js");
const { fitCrc } = await load("localSync/fitWriter.js");
const { decodeSportSyncPayload, corosSessionToFit } = await load("localSync/syncPayloadDecoder.js");
const { corosSportTypeFromFit, fitSportFromCorosType, localFitActivityDetail } = await load("localSync/localActivityDetail.js");
const { parseFitActivity } = await load("fitActivity.js");

let passed = 0;
function test(name, body) {
  try {
    body();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}
const close = (actual, expected, tolerance, label) =>
  assert.ok(actual === expected || Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("delta-pack: every mode round-trips", () => {
  const cases = [
    [[100, 101, 100, 100, 97, 140], {}],
    [[100, 101, 100, 100, 97, 140, 20], { variable: true }],
    [[5, 9, 13, 17, 21], { mode: "step" }],
    [[300, 290, 310, 305], { sizeShift: 1, mode: "offset" }],
    [[3_000_000_000, 3_000_000_053, 2_999_999_990], { sizeShift: 2 }],
    [[7, 0, 255, 128], { mode: "absolute" }],
    [[700, 720, 710], { sizeShift: 1, mode: "absolute", variable: true }],
    [[1, 2, 250], { mode: "raw" }],
    [[65_000, 12], { sizeShift: 1, mode: "raw" }],
    [[42], {}]
  ];
  for (const [values, options] of cases) assert.deepEqual(decodeDeltaPack(encodeDeltaPack(values, options)), values, JSON.stringify(options));
});

test("delta-pack: a hand-built vector decodes as specified", () => {
  // flags 0x0204: 8-bit samples, width 2, mode 1 (deltas); count 4.
  // Bits (LSB first): 6-bit length-1 = 6, first = 100 (7 bits), then deltas +1, -1, 0 as 2-bit zigzag (2, 1, 0).
  const bits = [0, 1, 1, 0, 0, 0, /* 100 */ 0, 0, 1, 0, 0, 1, 1, /* +1 */ 0, 1, /* -1 */ 1, 0, /* 0 */ 0, 0];
  const bytes = [];
  bits.forEach((bit, index) => { if (index % 8 === 0) bytes.push(0); bytes[bytes.length - 1] |= bit << (index % 8); });
  assert.deepEqual(decodeDeltaPack(Buffer.from([0x04, 0x02, 4, ...bytes])), [100, 101, 100, 100]);
  assert.deepEqual(decodeDeltaPack(Buffer.from([0x04, 0x02, 0])), []);
  assert.throws(() => decodeDeltaPack(Buffer.from([0x04])), CorosSportRecordFormatError);
});

test("record headers: one- and two-byte forms, page markers and padding", () => {
  const file = pages([record(4, Buffer.from([7, 1, 2])), record(4, Buffer.alloc(59, 3)), record(8, Buffer.alloc(108, 1))]);
  assert.equal(file.length, 4096);
  const records = walkCorosRecords(file);
  assert.deepEqual(records.filter((r) => r.kind !== 0x1e).map((r) => [r.kind, r.body.length]), [[0x1f, 14], [4, 3], [4, 59], [8, 108]]);
  // Two-byte header layout as the watch writes it: c1 19 is kind 8, length 108.
  assert.deepEqual(walkCorosRecords(Buffer.concat([marker(1), Buffer.from([0xc1, 0x19]), Buffer.alloc(108)])).map((r) => r.kind), [0x1f, 8]);
});

test("not a sport-record file: rejected so the raw payload stays archived", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(4096, 0xff), Buffer.from("HF\u0000\u000e not this format at all, long enough")]) {
    assert.throws(() => decodeCorosSportRecordFile(bytes), CorosSportRecordFormatError);
  }
});

test("synthetic run: session, laps, pauses and every sample", () => {
  const { file, expected } = syntheticRun();
  assert.ok(file.length > 4096, "spans more than one page");
  const { sessions, incomplete } = decodeCorosSportRecordFile(file);
  assert.equal(incomplete, 0);
  assert.equal(sessions.length, 1);
  const session = sessions[0];
  for (const [key, value] of Object.entries(expected.session)) close(session[key], value, 1e-9, key);
  close(session.avgSpeed, 3, 1e-9, "avgSpeed");
  assert.deepEqual(session.activeWindows, expected.activeWindows);
  assert.equal(session.samples.length, 21);
  assert.ok(session.samples.every(({ ts }) => expected.activeWindows.some(([a, b]) => ts >= a && ts <= b)), "no samples while paused");
  const at = (ts) => session.samples.find((sample) => sample.ts === ts);
  const t0 = expected.t0;
  for (let i = 0; i < 30; i++) {
    const sample = at(t0 + 1 + i);
    if (!sample) continue;
    assert.equal(sample.hr, expected.hr[i]);
    close(sample.lat, expected.lat[i], 1e-12, "lat");
    close(sample.lon, expected.lon[i], 1e-12, "lon");
  }
  assert.equal(at(t0 + 4).dist, expected.dist[2]);
  assert.equal(at(t0 + 5).dist, (expected.dist[2] + expected.dist[3]) / 2, "distance interpolates linearly");
  close(at(t0 + 4).speed, expected.speed[2], 1e-12, "speed");
  assert.equal(at(t0 + 4).power, expected.power[2]);
  assert.equal(at(t0 + 5).power, Math.floor((expected.power[2] + expected.power[3]) / 2), "power takes the floored mean");
  assert.equal(at(t0 + 4).cadence, 85, "steps per minute are reported per leg");
  assert.equal(at(t0 + 8).alt, expected.alt[2], "altitude carries the session offset");
  assert.equal(at(t0 + 9).alt, Math.floor((expected.alt[2] + expected.alt[3]) / 2));
  assert.equal(session.laps.length, 2);
  assert.deepEqual(session.laps.map((lap) => [lap.index, lap.startTs, lap.elapsedSec, lap.timerSec, lap.distanceM, lap.calories]), [
    [1, t0, 15, 10, 40, 8], [2, t0 + 15, 15.75, 10, 20, 8]
  ]);
  assert.deepEqual(session.laps.map((lap) => [lap.avgHr, lap.maxHr, lap.avgCadence, lap.avgPower, lap.ascentM, lap.descentM]), [
    [130, 145, 84, 185, 2, 1], [150, 200, 86, 192, 2, 1]
  ]);
  close(session.laps[0].maxSpeed, 1000 / 320, 1e-9, "lap maxSpeed");
});

test("synthetic run: running dynamics, effort pace and the watch's training analysis", () => {
  const { file, expected } = syntheticRun();
  const session = decodeCorosSportRecordFile(file).sessions[0];
  const t0 = expected.t0;
  assert.deepEqual(session.dynamics, { groundTimeMs: 258, verticalOscillationMm: 80, verticalRatio: 7.6, stepLengthMm: 1000 }, "averages of the recorded samples; step length from the summary");
  assert.deepEqual([session.minHr, session.avgTemperature, session.totalStrides], [110, 24, 30]);
  assert.deepEqual(session.laps.map((lap) => [lap.minHr, lap.avgTemperature, lap.maxPower, lap.dynamics]), [
    [110, 24, 195, { groundTimeMs: 255, verticalOscillationMm: 80, verticalRatio: 7.6, stepLengthMm: 1010 }],
    [120, 25, 199, { groundTimeMs: undefined, verticalOscillationMm: undefined, verticalRatio: undefined, stepLengthMm: 990 }]
  ]);
  const at = (ts) => session.samples.find((sample) => sample.ts === ts);
  assert.deepEqual([at(t0 + 4).stepLength, at(t0 + 4).groundTime, at(t0 + 4).verticalOscillation, at(t0 + 4).verticalRatio], [1020, 252, 80, 7.7]);
  close(at(t0 + 4).effortSpeed, 724 / 360, 1e-12, "effort speed");
  close(at(t0 + 5).effortSpeed, 725 / 360, 1e-12, "effort speed interpolates linearly");
  assert.equal(at(t0 + 5).stepLength, 1010, "floored mean between samples");
  assert.equal(at(t0).groundTime, undefined, "0 means no measurement");
  assert.deepEqual(session.training, {
    aerobicLoad: 30, anaerobicLoad: 5, lowLoad: 20, midLoad: 12, highLoad: 3, trainingLoad: 35, focus: 3, aerobicEffect: 27, anaerobicEffect: 8,
    performance: 102, recovery: 7200, sevenDayLoad: 310, recommendedLoadMin: 200, recommendedLoadMax: 500, vo2max: 43,
    baseFitness: 48, loadImpact: 61, fatigue: 127
  });
});

test("science summary: Base Fitness, Load Impact and fatigue are left out until the watch has a Base Fitness", () => {
  // As on the user's first runs: Base Fitness and Load Impact 0, fatigue 0 (0 ÷ 0 on the watch).
  const fresh = decodeCorosSportRecordFile(syntheticRun({ balance: { baseFitness: 0, loadImpact: 0, fatigue: 0 } }).file).sessions[0];
  for (const key of ["baseFitness", "loadImpact", "fatigue"]) assert.equal(key in fresh.training, false, key);
  assert.equal(fresh.training.recovery, 7200, "recovery time is kept");
  const parsed = parseFitActivity(corosSessionToFit(fresh)).session.training;
  assert.deepEqual([parsed.baseFitness, parsed.loadImpact, parsed.fatigue, parsed.recovery], [undefined, undefined, undefined, 7200]);
  // Fatigue is signed; a Load Impact of 0 with a Base Fitness is a real 0.
  const rested = decodeCorosSportRecordFile(syntheticRun({ balance: { baseFitness: 52, loadImpact: 0, fatigue: 0 } }).file).sessions[0];
  assert.deepEqual([rested.training.baseFitness, rested.training.loadImpact, rested.training.fatigue], [52, 0, 0]);
});

test("science summary: no VO₂ max while the watch has none (byte 0x27 is 0)", () => {
  const session = decodeCorosSportRecordFile(syntheticRun({ vo2max: 0 }).file).sessions[0];
  assert.equal(session.training.trainingLoad, 35);
  assert.equal("vo2max" in session.training, false);
  assert.equal(parseFitActivity(corosSessionToFit(session)).session.training.vo2max, undefined);
});

test("FIT round trip keeps dynamics, effort pace and training analysis", () => {
  const session = decodeCorosSportRecordFile(syntheticRun().file).sessions[0];
  const parsed = parseFitActivity(corosSessionToFit(session));
  assert.deepEqual(parsed.session.training, {
    trainingLoad: 35, aerobicLoad: 30, anaerobicLoad: 5, aerobicEffect: 2.7, anaerobicEffect: 0.8, focus: 3, sevenDayLoad: 310, recommendedLoadMin: 200, recommendedLoadMax: 500,
    vo2max: 43, recovery: 7200, baseFitness: 48, loadImpact: 61, fatigue: 127
  });
  assert.deepEqual(parsed.session.dynamics, { verticalOscillationMm: 80, groundTimeMs: 258, verticalRatio: 7.6, stepLengthMm: 1000 });
  assert.deepEqual([parsed.session.minHr, parsed.session.avgTemperature, parsed.session.totalStrides], [110, 24, 30]);
  assert.deepEqual(parsed.laps.map((lap) => [lap.minHr, lap.avgTemperature, lap.maxPower, lap.dynamics?.groundTimeMs]), [[110, 24, 195, 255], [120, 25, 199, undefined]]);
  for (const record of parsed.records) {
    const sample = session.samples.find((s) => s.ts === record.ts);
    for (const key of ["stepLength", "groundTime", "verticalOscillation", "verticalRatio"]) assert.equal(record[key], sample[key], `${key} @${record.ts}`);
    if (sample.effortSpeed !== undefined) close(record.effortSpeed, sample.effortSpeed, 1e-6, "effort speed (float32)");
  }
});

test("synthetic run: a corrupt series record is skipped, not misread", () => {
  const { sessions } = decodeCorosSportRecordFile(syntheticRun({ corruptHeartRate: true }).file);
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].samples.every((sample) => sample.hr === undefined));
  assert.ok(sessions[0].samples.some((sample) => sample.lat !== undefined));
});

test("several activities, a repeated page and an unfinished recording", () => {
  const first = syntheticRun({ startUnix: 1_767_247_200 });
  const second = syntheticRun({ startUnix: 1_767_333_600, deviceSport: 4 });
  // Still being recorded: a start and some samples, no stop or summary yet.
  const unfinished = pages([startRecord(1_767_420_000, 0, 0), seriesRecord(0x02, 1, 1_767_420_001, encodeDeltaPack([100, 101]))]);
  const file = Buffer.concat([first.file, first.file.subarray(0, 4096), second.file, unfinished]);
  const { sessions, incomplete } = decodeCorosSportRecordFile(file);
  assert.deepEqual(sessions.map((s) => [s.startTs, s.sportType]), [[1_767_247_200, 100], [1_767_333_600, 200]]);
  assert.equal(incomplete, 1);
  assert.notEqual(sessions[0].watchActivityId, sessions[1].watchActivityId);
  assert.equal(sessions[1].avgCadence, undefined, "step cadence is only reported for runs");
});

// ----- damaged input: bounded work, and one bad record or activity never hides the others -----

const SUMMARY = { distanceCm: 6000, timerCs: 2000, smallCalories: 15_500, bestPace: 300, avgHr: 140, maxHr: 200, ascent: 4, descent: 2, altitudeOffset: -40, stepCadence: 170, maxStepCadence: 180, avgPower: 188 };
const T0 = 1_767_247_200;
/** Each case must finish well inside this, whatever the input (the unbounded decoder took seconds, then ran out of memory). */
const BUDGET_MS = 2000;
function timed(label, body) {
  const started = Date.now();
  const result = body();
  assert.ok(Date.now() - started < BUDGET_MS, `${label} took ${Date.now() - started} ms`);
  return result;
}

test("a damaged stop time (one flipped byte, 54 years late) sets that activity aside instead of exhausting memory", () => {
  const { file } = syntheticRun();
  const damaged = Buffer.from(file);
  assert.equal(damaged[4748], 0x16, "the stop record's time byte in the fixture");
  damaged[4748] = 0x7d;
  const decoded = timed("flipped byte", () => decodeCorosSportRecordFile(damaged));
  assert.deepEqual([decoded.sessions.length, decoded.rejected], [0, 1]);
  // Next to an intact activity in the same file, the intact one is still decoded.
  const { file: later } = syntheticRun({ startUnix: T0 + 86_400 });
  const both = timed("flipped byte + intact run", () => decodeCorosSportRecordFile(Buffer.concat([damaged, later])));
  assert.deepEqual([both.sessions.map((session) => session.startTs), both.rejected], [[T0 + 86_400], 1]);
  const payload = decodeSportSyncPayload(Buffer.concat([damaged, later]));
  assert.deepEqual([payload.records.length, payload.unrecognised], [1, 1]);
  assert.match(payload.notes, /1 activity set aside/);
});

test("a damaged stop time on the newest activity is set aside without hiding the older ones", () => {
  const hour = { ...SUMMARY, timerCs: 3600 * 100 };
  const run = (start) => [startRecord(start, 0, 0), pauseRecord(start + 3600, 0), summaryRecord(hour)];
  const good = [...run(T0), ...run(T0 + 86_400), ...run(T0 + 2 * 86_400)];
  for (const [label, stop] of [["54 years late", T0 + 3 * 86_400 + 54 * 365 * 86_400], ["before its start", T0 + 3 * 86_400 - 100]]) {
    const file = pages([...good, startRecord(T0 + 3 * 86_400, 0, 0), pauseRecord(stop, 0), summaryRecord(hour)]);
    const decoded = timed(label, () => decodeCorosSportRecordFile(file));
    assert.deepEqual([decoded.sessions.map((session) => session.startTs), decoded.rejected], [[T0, T0 + 86_400, T0 + 2 * 86_400], 1], label);
    const payload = decodeSportSyncPayload(file);
    assert.deepEqual([payload.records.length, payload.unrecognised], [3, 1], label);
    assert.match(payload.notes, /1 activity set aside/);
  }
});

test("a 36-hour activity (a 100-mile race) round-trips through the FIT file", () => {
  const span = 36 * 3600;
  const payload = decodeSportSyncPayload(pages([startRecord(T0, 0, 0), pauseRecord(T0 + span, 0), summaryRecord({ ...SUMMARY, timerCs: span * 100 })]));
  assert.deepEqual([payload.records.length, payload.unrecognised, payload.notes], [1, 0, undefined]);
  const [record] = payload.records;
  assert.deepEqual([record.headline.startTime, record.headline.endTime, record.headline.duration], [T0, T0 + span, span]);
  const parsed = parseFitActivity(new Uint8Array(record.fit));
  assert.equal(parsed.records.length, span + 1, "one record a second");
  assert.deepEqual([parsed.records[0].ts, parsed.records.at(-1).ts], [T0, T0 + span]);
});

test("implausible time windows are rejected; long plausible ones are kept", () => {
  const session = (stopUnix, extra = [], summary = SUMMARY) => timed(`stop ${stopUnix - T0}`, () => decodeCorosSportRecordFile(pages([startRecord(T0, 0, 0), ...extra, pauseRecord(stopUnix, 0), summaryRecord(summary)])));
  assert.equal(session(T0 - 100).rejected, 1, "a stop before the start");
  assert.equal(session(T0 + 30 * 86_400).rejected, 1, "30 days");
  assert.equal(session(T0 + MAX_SESSION_SECONDS + 1, [], { ...SUMMARY, timerCs: (MAX_SESSION_SECONDS + 1) * 100 }).rejected, 1, "beyond the longest activity, even with a matching timer");
  assert.equal(session(T0 + 3 * 86_400).rejected, 1, "three days of windows for a 20-second timer");
  // A window two days long inside a 20-second activity is implausible even though the stop is within the limit.
  assert.equal(session(T0 + 2 * 86_400 + 60, [pauseRecord(T0 + 10, 0), resumeRecord(T0 + 20)]).rejected, 1);
  // A resume shifted past the stop opens no window at all: only the seconds before the pause are sampled.
  assert.equal(session(T0 + 30, [pauseRecord(T0 + 10, 0), resumeRecord(T0 + 2 * 86_400)]).sessions[0].samples.length, 11);
  const zero = session(T0);
  assert.deepEqual([zero.sessions.length, zero.sessions[0].samples.length], [1, 1], "a zero-length activity is kept");
  // An ultra: 26 hours on the timer, 26 hours of windows.
  const ultra = session(T0 + 26 * 3600, [], { ...SUMMARY, timerCs: 26 * 3600 * 100 });
  assert.deepEqual([ultra.rejected, ultra.sessions[0].samples.length], [0, 26 * 3600 + 1]);
  // Auto-pause can stop the timer without a pause record: 10 hours of windows for a 2-hour timer is kept.
  assert.equal(session(T0 + 10 * 3600, [], { ...SUMMARY, timerCs: 2 * 3600 * 100 }).sessions.length, 1);
});

test("a damaged series record is skipped; its activity and the next one are kept", () => {
  // Raw mode claims 50 samples but carries 3 bytes (valid checksum), as in a QA reproduction; it must not cost the whole file.
  const short = seriesRecord(0x02, 1, T0 + 1, Buffer.from([0xfc, 0x07, 50, 1, 2, 3]));
  const { file } = syntheticRun({ startUnix: T0 + 3600 });
  const decoded = decodeCorosSportRecordFile(Buffer.concat([pages([startRecord(T0, 0, 0), short, pauseRecord(T0 + 30, 0), summaryRecord(SUMMARY)]), file]));
  assert.deepEqual([decoded.sessions.map((session) => session.startTs), decoded.skippedRecords, decoded.rejected], [[T0, T0 + 3600], 1, 0]);
  assert.equal(decoded.sessions[0].samples.some((sample) => sample.hr !== undefined), false, "nothing invented from the bad record");
  // 8-byte raw samples (size bits 3) are read as 64-bit values instead of throwing.
  assert.deepEqual(decodeDeltaPack(Buffer.from([0xff, 0x07, 2, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0])), [1, 2]);
});

test("fixed-seed fuzz: damaged files decode within the time budget or are refused as not a sport record", () => {
  const { file } = syntheticRun();
  let seed = 0x2f6b_1d3c;
  const random = () => { seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0; return seed / 2 ** 32; };
  let decoded = 0;
  for (let round = 0; round < 400; round++) {
    const damaged = Buffer.from(file);
    for (let flip = 0; flip < 1 + (round % 12); flip++) damaged[Math.floor(random() * damaged.length)] = Math.floor(random() * 256);
    try {
      const result = timed(`fuzz round ${round}`, () => decodeCorosSportRecordFile(damaged));
      for (const session of result.sessions) assert.ok(session.samples.length <= MAX_SESSION_SECONDS + 1);
      decoded += 1;
    } catch (error) {
      if (!(error instanceof CorosSportRecordFormatError)) throw new Error(`fuzz round ${round}: ${error.message}`);
    }
  }
  assert.ok(decoded > 300, `${decoded} of 400 damaged files still decoded`);
});

test("FIT writer: valid header and CRC, and CorosLink's parser reads it back", () => {
  const { file, expected } = syntheticRun();
  const session = decodeCorosSportRecordFile(file).sessions[0];
  const fit = corosSessionToFit(session);
  assert.equal(fit.toString("ascii", 8, 12), ".FIT");
  assert.equal(fit.readUInt32LE(4), fit.length - 16);
  assert.equal(fitCrc(fit.subarray(0, 12)), fit.readUInt16LE(12));
  assert.equal(fitCrc(fit), 0, "file CRC");
  assert.deepEqual(corosSessionToFit(session), fit, "deterministic");
  const parsed = parseFitActivity(fit);
  assert.equal(corosSportTypeFromFit(parsed.session.sport, parsed.session.subSport), 100);
  assert.equal(parsed.session.startTs, expected.t0);
  close(parsed.session.elapsedSec, 30.5, 1e-9, "elapsed");
  close(parsed.session.timerSec, 20, 1e-9, "timer");
  close(parsed.session.distanceM, 60, 1e-9, "distance");
  assert.deepEqual([parsed.session.avgHr, parsed.session.maxHr, parsed.session.calories, parsed.session.avgPower, parsed.session.ascentM, parsed.session.descentM], [140, 200, 16, 188, 4, 2]);
  assert.deepEqual(parsed.activeWindows, expected.activeWindows);
  assert.equal(parsed.records.length, session.samples.length);
  assert.equal(parsed.laps.length, 2);
  const withGps = parsed.records.filter((r) => r.lat !== undefined);
  assert.ok(withGps.length > 0);
  for (const r of withGps) {
    const sample = session.samples.find((s) => s.ts === r.ts);
    close(r.lat, sample.lat, 1e-6, "lat"); close(r.lon, sample.lon, 1e-6, "lon");
  }
});

test("payload decoder: sport records become FIT activities with the watch's sport type", () => {
  const { file } = syntheticRun({ deviceSport: 7 }); // mountain climb: FIT has no equivalent
  const decoded = decodeSportSyncPayload(file);
  assert.equal(decoded.decoder, "coros-sport-record/v2");
  assert.equal(decoded.records.length, 1);
  assert.equal(decoded.records[0].sportType, 105);
  assert.equal(decoded.records[0].headline.startTime, syntheticRun().expected.t0);
  assert.equal(parseFitActivity(decoded.records[0].fit).session.sport, 0);
});

test("sport mapping round-trips for every type FIT can express", () => {
  for (const sportType of [100, 101, 102, 103, 104, 106, 200, 201, 202, 203, 204, 300, 301, 400, 402, 500, 501, 502, 700, 701, 900, 902]) {
    const { sport, subSport } = fitSportFromCorosType(sportType);
    assert.equal(corosSportTypeFromFit(sport, subSport), sportType, String(sportType));
  }
});

/** sha256 of the synthetic run's FIT file as 0.1.69 writes it. */
const RUN_FIT_SHA256 = "27768875d9a3d4b939bcf6c4d5b8a8fe8232229e2209cd188b54af86f11d5160";
const FIT_FREESTYLE = 0;
const FIT_BACKSTROKE = 1;
const FIT_BREASTSTROKE = 2;
const FIT_MIXED = 5;
const localRecord = (sportType) => ({ activityId: "local", sportType, source: "watch-ble", provenance: "watch", format: "fit", sha256: "0".repeat(64) });

/**
 * What any reader may expect of a swim's FIT file: lengths in order without
 * overlapping, no length or lap with more timer than elapsed time, laps within
 * the session, and each lap's lengths inside it.
 */
function assertSwimFitConsistent(fit, label) {
  assert.equal(fitCrc(fit), 0, `${label}: file CRC`);
  const parsed = parseFitActivity(fit);
  const session = parsed.session;
  const sessionEnd = session.startTs + session.elapsedSec;
  parsed.lengths.forEach((length, index) => {
    assert.ok(length.timerSec <= length.elapsedSec + 0.01, `${label}: length ${index} timer ${length.timerSec} > elapsed ${length.elapsedSec}`);
    assert.ok(length.startTs <= length.endTs, `${label}: length ${index} ends before it starts`);
    if (index) assert.ok(length.startTs >= parsed.lengths[index - 1].endTs, `${label}: length ${index} overlaps the one before`);
  });
  parsed.laps.forEach((lap, index) => {
    assert.ok(lap.timerSec <= lap.elapsedSec + 0.01, `${label}: lap ${index} timer > elapsed`);
    assert.ok(lap.startTs >= session.startTs && lap.startTs + lap.elapsedSec <= sessionEnd + 1, `${label}: lap ${index} outside the session`);
    const swim = lap.swim;
    if (swim?.firstLength === undefined) return;
    assert.ok(swim.firstLength + swim.lengths <= parsed.lengths.length, `${label}: lap ${index} lengths out of range`);
    for (const length of parsed.lengths.slice(swim.firstLength, swim.firstLength + swim.lengths)) {
      assert.ok(length.startTs >= lap.startTs && length.endTs <= lap.startTs + lap.elapsedSec + 1, `${label}: lap ${index} length outside the lap`);
    }
  });
  return parsed;
}

test("synthetic pool swim: intervals, rests and lengths as the watch numbered them", () => {
  const { file, expected } = syntheticPoolSwim();
  const { t0 } = expected;
  const [session] = decodeCorosSportRecordFile(file).sessions;
  assert.equal(session.sportType, 300);
  assert.deepEqual(session.swimTotals, { poolLengthM: 25, poolLengthUnit: "m", activeLengths: 3, strokes: 54, avgSwolf: 58, bestSwolf: 56 });
  assert.deepEqual([session.avgCadence, session.maxCadence, session.avgSpeed, session.maxSpeed], [26, 30, 100 / 160, 100 / 160], "stroke rate; speeds from s/100 m");
  assert.deepEqual([session.ascentM, session.descentM, session.totalStrides], [undefined, undefined, undefined], "a swim's stroke bytes are not climb or steps");
  assert.deepEqual([session.elapsedSec, session.endTs - t0], [150, 150]);
  assert.deepEqual(session.laps.map((lap) => [lap.startTs - t0, lap.endTs - t0, lap.elapsedSec, lap.timerSec, lap.distanceM, lap.calories]), [
    [0, 80, 80, 80, 50, 14], [80, 110, 30, 30, 0, 3], [110, 150, 40, 40, 25, 7]
  ]);
  assert.deepEqual(session.laps.map((lap) => lap.swim), [
    { rest: false, stroke: FIT_MIXED, strokes: 34, swolf: 57, firstLength: 0, lengths: 2, activeLengths: 2 },
    { rest: true, firstLength: 2, lengths: 1, activeLengths: 0 },
    { rest: false, stroke: FIT_BACKSTROKE, strokes: 20, swolf: 60, firstLength: 3, lengths: 1, activeLengths: 1 }
  ]);
  assert.deepEqual(session.laps.map((lap) => [lap.avgCadence, lap.avgSpeed, lap.maxSpeed]), [[25, 0.625, 0.625], [undefined, undefined, undefined], [30, 0.625, 0.625]], "a lap's cadence is its stroke rate");
  assert.deepEqual(session.lengths.map((length) => [length.startTs - t0, length.endTs - t0, length.elapsedSec, length.timerSec, length.active, length.stroke, length.strokes, length.strokeRate, length.swolf]), [
    [0, 40, 40, 40, true, FIT_FREESTYLE, 16, 24, 56],
    [40, 80, 40, 40, true, FIT_BREASTSTROKE, 18, 27, 58],
    [80, 110, 30, 30, false, undefined, undefined, undefined, undefined],
    // Stamped 25 s after its interval closed: kept inside the interval it belongs to (interval count 1).
    [110, 150, 40, 40, true, FIT_BACKSTROKE, 20, 30, 60]
  ]);
  assert.deepEqual(session.lengths.map((length) => [length.calories, length.avgHr, length.maxHr]), [[6, 105, 112], [8, 110, 119], [3, 101, 108], [7, 112, 118]]);
  const at = (ts) => session.samples.find((sample) => sample.ts === ts);
  assert.equal(session.samples.length, 151);
  assert.deepEqual([at(t0 + 4).cadence, at(t0 + 5).cadence], [22, 22], "strokes per minute as recorded, not halved");
  assert.deepEqual([14, 15, 64, 65].map((s) => at(t0 + s).temperature), [29, 30, 30, 29], "water temperature: the nearer sample, the later one halfway");
  assert.deepEqual([at(t0 + 20).speed, at(t0 + 95).speed, at(t0 + 130).speed], [0.625, undefined, 0.625], "a length's speed, none while resting");
});

test("synthetic pool swim: FIT keeps strokes, SWOLF, lengths, pool length and water temperature", () => {
  const { file, expected } = syntheticPoolSwim();
  const [session] = decodeCorosSportRecordFile(file).sessions;
  const parsed = assertSwimFitConsistent(corosSessionToFit(session), "pool swim");
  assert.deepEqual([parsed.session.sport, parsed.session.subSport], [5, 17]);
  assert.deepEqual(parsed.session.swimTotals, { poolLengthM: 25, poolLengthUnit: "m", lengths: 4, activeLengths: 3, strokes: 54, avgSwolf: 58, bestSwolf: 56 });
  assert.deepEqual([parsed.session.avgCadence, parsed.session.maxCadence, parsed.session.ascentM, parsed.session.totalStrides], [26, 30, undefined, undefined]);
  close(parsed.session.maxSpeed, 0.625, 0.0005, "max speed");
  assert.deepEqual(parsed.laps.map((lap) => lap.swim), session.laps.map((lap) => lap.swim));
  assert.deepEqual(parsed.laps.map((lap) => lap.avgCadence), [25, undefined, 30]);
  assert.deepEqual(parsed.lengths.map((length) => [length.startTs - expected.t0, length.endTs - expected.t0, length.timerSec, length.active, length.stroke, length.strokes, length.strokeRate, length.swolf, length.calories, length.avgHr, length.maxHr]), [
    [0, 40, 40, true, FIT_FREESTYLE, 16, 24, 56, 6, 105, 112],
    [40, 80, 40, true, FIT_BREASTSTROKE, 18, 27, 58, 8, 110, 119],
    [80, 110, 30, false, undefined, undefined, undefined, undefined, 3, 101, 108],
    [110, 150, 40, true, FIT_BACKSTROKE, 20, 30, 60, 7, 112, 118]
  ]);
  for (const record of parsed.records) {
    const sample = session.samples.find((s) => s.ts === record.ts);
    assert.equal(record.temp, sample.temperature, `temperature @${record.ts}`);
    assert.equal(record.cadence, sample.cadence, `stroke rate @${record.ts}`);
  }

  const detail = localFitActivityDetail(parsed, localRecord(300));
  const stream = detail.raw.frequencyList;
  assert.deepEqual([14, 15].map((s) => stream.find((entry) => entry.timestamp === (expected.t0 + s) * 100).temperature), [29, 30], "water temperature in the chart's samples");
  assert.deepEqual(detail.swim, {
    poolLength: 25, poolLengthUnit: "m", lengths: 3, swimTime: 120, strokes: 54, avgStrokeRate: 26, maxStrokeRate: 30, avgSwolf: 58, bestSwolf: 56,
    strokeDistance: 1.39, avgPace: 160, bestPace: 160, waterTemperature: 29
  });
  assert.equal(detail.elevationGain, undefined);
  assert.deepEqual(detail.laps.map((lap) => [lap.rest ?? false, lap.stroke, lap.strokes, lap.strokeRate, lap.swolf, lap.lengths, lap.swimPace]), [
    [false, "mixed", 34, 25, 57, 2, 160], [true, undefined, undefined, undefined, undefined, undefined, undefined], [false, "backstroke", 20, 30, 60, 1, 160]
  ]);
  assert.deepEqual(detail.lapGroups.map((group) => group.kind), ["laps", "lengths"]);
  assert.deepEqual(detail.lapGroups[1].laps.map((row) => [row.index, row.distance, row.duration, row.rest ?? false, row.stroke, row.strokes, row.swolf, row.swimPace]), [
    [1, 25, 40, false, "freestyle", 16, 56, 160], [2, 25, 40, false, "breaststroke", 18, 58, 160],
    [3, 0, 30, true, undefined, undefined, undefined, undefined], [4, 25, 40, false, "backstroke", 20, 60, 160]
  ]);
});

test("swim detail: the fastest interval and length are marked, and nothing when all are as fast", () => {
  const [session] = decodeCorosSportRecordFile(syntheticPoolSwim().file).sessions;
  const even = localFitActivityDetail(parseFitActivity(corosSessionToFit(session)), localRecord(300));
  assert.deepEqual(even.lapGroups.map((group) => group.fastestLaps), [[], []], "every length and interval at 2:40/100 m");
  // The second length swum in 30 s: the fastest length, in the first interval (its pace the watch's own, 2:00/100 m).
  const lengths = session.lengths.map((length, index) => (index === 1 ? { ...length, timerSec: 30, avgSpeed: 25 / 30 } : length));
  const laps = session.laps.map((lap, index) => (index === 0 ? { ...lap, avgSpeed: 100 / 120 } : lap));
  const detail = localFitActivityDetail(parseFitActivity(corosSessionToFit({ ...session, lengths, laps })), localRecord(300));
  assert.deepEqual(detail.lapGroups.map((group) => [group.kind, group.fastestLaps]), [["laps", [0]], ["lengths", [1]]]);
  const run = localFitActivityDetail(parseFitActivity(corosSessionToFit(decodeCorosSportRecordFile(syntheticRun().file).sessions[0])), localRecord(100));
  assert.equal(run.lapGroups, undefined, "only swims");
});

test("pool swim as real swims record it: pauses at the wall, an idle stretch, a doubled length, a yard pool", () => {
  const { file, expected } = syntheticPoolSwimAtTheWall();
  const { t0 } = expected;
  const [session] = decodeCorosSportRecordFile(file).sessions;
  assert.deepEqual(session.swimTotals, { poolLengthM: 22.86, poolLengthUnit: "yd", activeLengths: 5, strokes: 72, avgSwolf: 44, bestSwolf: 42 });
  assert.equal(session.laps.length, 1, "the unknown lap kind is ignored, not taken for an interval");
  assert.deepEqual([session.laps[0].startTs - t0, session.laps[0].elapsedSec, session.laps[0].timerSec, session.laps[0].swim.lengths, session.laps[0].swim.activeLengths], [0, 240, 145, 6, 5]);
  assert.deepEqual(session.lengths.map((length) => [length.startTs - t0, length.endTs - t0, length.timerSec, length.active]), [
    [0, 30, 30, true],
    // 2 s on the timer at the wall is turning, not idling; 20 s is an idle stretch where it happened.
    [61, 91, 30, true], [91, 111, 20, false], [111, 141, 30, true],
    // Recorded twice with one end time (the watch counts both): one after the other, no overlap.
    [170, 200, 30, true], [200, 230, 30, true]
  ]);
  assert.deepEqual([session.elapsedSec, session.endTs - t0], [240, 240], "the interval closed when the swim was saved, after the stop");
  const parsed = assertSwimFitConsistent(corosSessionToFit(session), "pool swim at the wall");
  assert.equal(parsed.session.swimTotals.poolLengthUnit, "yd");
  assert.equal(localFitActivityDetail(parsed, localRecord(300)).swim.poolLengthUnit, "yd");
});

test("synthetic pool swim: lengths no interval closed get a lap of their own, ending at the stop", () => {
  const { file, expected } = syntheticPoolSwim({ unclosed: true });
  const [session] = decodeCorosSportRecordFile(file).sessions;
  assert.equal(session.laps.length, 3);
  const last = session.laps[2];
  assert.deepEqual([last.startTs - expected.t0, last.endTs - expected.t0, last.distanceM, last.timerSec, last.swim], [
    110, 150, 25, 40, { rest: false, stroke: FIT_BACKSTROKE, strokes: 20, firstLength: 3, lengths: 1, activeLengths: 1 }
  ]);
  assert.deepEqual([session.lengths.length, session.lengths[3].startTs - expected.t0, session.lengths[3].endTs - expected.t0], [4, 110, 150]);
  assert.equal(session.elapsedSec, 150, "start to stop when the watch didn't close every lap");
  assertSwimFitConsistent(corosSessionToFit(session), "unclosed pool swim");
});

test("synthetic open-water swim: laps carry strokes and SWOLF; speeds per 100 m; no lengths or climb", () => {
  const { file, expected } = syntheticOpenWaterSwim();
  const [session] = decodeCorosSportRecordFile(file).sessions;
  assert.equal(session.sportType, 301);
  assert.deepEqual(session.swimTotals, { strokes: 40, avgSwolf: 65, bestSwolf: 65 }, "no pool length in open water");
  assert.equal(session.lengths, undefined);
  assert.deepEqual([session.maxSpeed, session.ascentM, session.avgCadence, session.maxCadence, session.elapsedSec], [100 / 90, undefined, 40, 44, 60]);
  assert.deepEqual(session.laps.map((lap) => [lap.startTs - expected.t0, lap.elapsedSec, lap.timerSec, lap.avgSpeed, lap.maxSpeed, lap.avgCadence, lap.swim]), [
    // Closed 10 s after the stop, when the swim was saved: it ends at the stop, with the swim.
    [0, 60, 60, 1, 100 / 90, 40, { rest: false, stroke: FIT_FREESTYLE, strokes: 40, swolf: 65 }]
  ]);
  const sample = session.samples.find((s) => s.ts === expected.t0 + 10);
  assert.deepEqual([sample.cadence, sample.speed], [18, 300 / 360]);
  const parsed = parseFitActivity(corosSessionToFit(session));
  assert.deepEqual(parsed.session.swimTotals, { strokes: 40, avgSwolf: 65, bestSwolf: 65 });
  assert.deepEqual(parsed.lengths, []);
  assert.deepEqual(parsed.laps[0].swim, { rest: false, stroke: FIT_FREESTYLE, strokes: 40, swolf: 65 });
});

test("an imported pool swim without SWOLF gets it from its lengths; another sport's laps get no swim figures", () => {
  const { file } = syntheticPoolSwim();
  const [session] = decodeCorosSportRecordFile(file).sessions;
  // As a file from another app: no SWOLF anywhere.
  const bare = {
    ...session,
    swimTotals: { ...session.swimTotals, avgSwolf: undefined, bestSwolf: undefined },
    laps: session.laps.map((lap) => ({ ...lap, swim: lap.swim && { ...lap.swim, swolf: undefined } })),
    lengths: session.lengths.map((length) => ({ ...length, swolf: undefined }))
  };
  const parsed = parseFitActivity(corosSessionToFit(bare));
  assert.deepEqual(parsed.lengths.map((length) => length.swolf), [56, 58, undefined, 60], "seconds plus strokes");
  assert.deepEqual(parsed.laps.map((lap) => lap.swim.swolf), [57, undefined, 60]);
  assert.equal(parsed.session.swimTotals.avgSwolf, 58);
  const run = decodeCorosSportRecordFile(syntheticRun().file).sessions[0];
  const asRun = parseFitActivity(corosSessionToFit({ ...run, laps: run.laps.map((lap) => ({ ...lap, swim: { rest: true, strokes: 9 } })) }));
  assert.ok(asRun.laps.every((lap) => lap.swim === undefined));
});

test("a run's FIT file is unchanged by swim decoding", () => {
  const { file } = syntheticRun();
  const fit = corosSessionToFit(decodeCorosSportRecordFile(file).sessions[0]);
  // The run decoder's output as released; a change here changes every stored run.
  assert.equal(createHash("sha256").update(fit).digest("hex"), RUN_FIT_SHA256);
});

const oracle = process.env.COROSLINK_SPORT_RECORD_ORACLE;
if (oracle) {
  test("real recording: matches the COROS app's own export", () => {
    const { sessions } = decodeCorosSportRecordFile(fs.readFileSync(path.join(oracle, "raw-file14.bin")));
    assert.equal(sessions.length, 1);
    const ours = parseFitActivity(corosSessionToFit(sessions[0]));
    const reference = parseFitActivity(fs.readFileSync(path.join(oracle, "coros-export.fit")));
    for (const [key, value] of Object.entries(reference.session)) {
      // Objects are compared below; training is not in COROS's FIT export (checked against its fitness index instead).
      if (key === "subSport" || value === undefined || (value !== null && typeof value === "object")) continue;
      // CorosLink also writes FIT's fractional cadence (the watch's half step); COROS's export has only the whole number.
      const mine = key.endsWith("Cadence") ? Math.floor(ours.session[key]) : ours.session[key];
      close(mine, value, key.endsWith("Speed") ? 0.0025 : 0, `session.${key}`);
    }
    assert.equal(ours.laps.length, reference.laps.length);
    reference.laps.forEach((lap, index) => {
      for (const [key, value] of Object.entries(lap)) {
        // CorosLink also writes values COROS's export leaves out (lap max power); compare what COROS has.
        if (value === undefined || (value !== null && typeof value === "object")) continue;
        const mine = key.endsWith("Cadence") ? Math.floor(ours.laps[index][key]) : ours.laps[index][key];
        close(mine, value, key.endsWith("Speed") ? 0.0025 : 0, `lap.${key}`);
      }
    });
    assert.deepEqual(ours.activeWindows, reference.activeWindows);
    assert.equal(ours.records.length, reference.records.length);
    for (const key of ["minHr", "avgTemperature", "totalStrides"]) assert.equal(ours.session[key], reference.session[key], `session.${key}`);
    assert.deepEqual(ours.session.dynamics, reference.session.dynamics, "session running dynamics");
    reference.laps.forEach((lap, index) => {
      for (const key of ["minHr", "avgTemperature"]) assert.equal(ours.laps[index][key], lap[key], `lap.${key}`);
      assert.deepEqual(ours.laps[index].dynamics, lap.dynamics, "lap running dynamics");
    });
    // The watch's training analysis is not in COROS's FIT export; compare with COROS's decoded fitness-index item.
    const index = JSON.parse(fs.readFileSync(path.join(oracle, "coros-fitness-index.json"), "utf8"));
    assert.deepEqual({ ...sessions[0].training }, index);
    const byTs = new Map(ours.records.map((r) => [r.ts, r]));
    // COROS converts with floor(degrees × 11930465), a rounded semicircles-per-degree constant (the exact value is
    // 2^31/180 = 11930464.71), which shifts positions by up to ~0.5 m. Applying that same formula to the watch's own
    // 1e-7° values must reproduce COROS's coordinates exactly, which shows the decoded values are identical.
    const corosSemicircles = (degrees) => {
      const product = BigInt(Math.round(degrees * 1e7)) * 11_930_465n;
      const quotient = product / 10_000_000n;
      return Number(product < 0n && quotient * 10_000_000n !== product ? quotient - 1n : quotient);
    };
    const toSemicircles = (degrees) => Math.round((degrees * 2 ** 31) / 180);
    let positions = 0;
    for (const sample of sessions[0].samples) {
      const ref = reference.records.find((r) => r.ts === sample.ts);
      if (sample.lat === undefined || ref?.lat === undefined) continue;
      assert.equal(corosSemicircles(sample.lat), toSemicircles(ref.lat), `lat @${sample.ts}`);
      assert.equal(corosSemicircles(sample.lon), toSemicircles(ref.lon), `lon @${sample.ts}`);
      positions += 1;
    }
    assert.ok(positions > 500, `${positions} positions compared`);
    for (const ref of reference.records) {
      const mine = byTs.get(ref.ts);
      for (const key of ["hr", "alt", "dist", "cadence", "power"]) if (ref[key] !== undefined && mine?.[key] !== undefined) assert.equal(mine[key], ref[key], `${key} @${ref.ts}`);
      for (const key of ["stepLength", "groundTime", "verticalOscillation", "verticalRatio"]) {
        // COROS writes 0 where the watch measured nothing; CorosLink leaves the field out.
        if (ref[key] !== undefined && ref[key] !== 0) assert.equal(mine?.[key], ref[key], `${key} @${ref.ts}`);
      }
      // COROS truncates effort pace to 0.001 m/s; CorosLink keeps the watch's value.
      if (ref.effortSpeed !== undefined && mine?.effortSpeed !== undefined) close(mine.effortSpeed, ref.effortSpeed, 0.0025, `effortSpeed @${ref.ts}`);
      if (ref.speed !== undefined && mine?.speed !== undefined) close(mine.speed, ref.speed, 0.0025, `speed @${ref.ts}`);
      // CorosLink keeps the watch's values; FIT storage rounds them to the nearest semicircle (≤ 0.5 cm).
      const watch = sessions[0].samples.find((sample) => sample.ts === ref.ts);
      if (watch?.lat !== undefined && mine?.lat !== undefined) { close(mine.lat, watch.lat, 4.2e-8, "lat"); close(mine.lon, watch.lon, 4.2e-8, "lon"); }
    }
  });
}

const swimOracle = process.env.COROSLINK_SWIM_ORACLE;
if (swimOracle) {
  test("real swims: match the COROS app's own exports", () => {
    const { sessions } = decodeCorosSportRecordFile(fs.readFileSync(path.join(swimOracle, "raw-file14.bin")));
    const swims = sessions.filter((session) => session.swimTotals);
    assert.ok(swims.length >= 2, `${swims.length} swims`);
    // COROS writes 0 where a rest has no speed, cadence or strokes; CorosLink leaves them out.
    const same = (mine, theirs, label, tolerance = 0) => {
      if (theirs === undefined || (theirs === 0 && mine === undefined)) return;
      close(mine, theirs, tolerance, label);
    };
    for (const session of swims) {
      const base = path.join(swimOracle, `coros-export-${session.startTs}`);
      const reference = parseFitActivity(fs.readFileSync(`${base}.fit`));
      const ours = assertSwimFitConsistent(corosSessionToFit(session), session.watchActivityId);
      const id = session.watchActivityId;
      for (const [key, value] of Object.entries(reference.session)) {
        if (key === "subSport" || value === null || typeof value === "object") continue;
        same(ours.session[key], value, `${id} session.${key}`, key.endsWith("Speed") ? 0.0025 : 0);
      }
      assert.equal(ours.session.swimTotals?.poolLengthM, reference.session.swimTotals?.poolLengthM, `${id} pool length`);
      assert.equal(ours.laps.length, reference.laps.length, `${id} laps`);
      reference.laps.forEach((lap, index) => {
        const mine = ours.laps[index];
        for (const [key, value] of Object.entries(lap)) {
          // COROS's lap start times follow its export's timeline, which packs lengths back to back.
          if (key === "startTs" || key === "index" || value === null || typeof value === "object") continue;
          // An open-water lap the watch closed when the swim was saved ends at the stop, with the swim.
          if (key === "elapsedSec" && !session.lengths) {
            close(mine.elapsedSec, Math.min(value, ours.session.elapsedSec), 0.01, `${id} lap ${index}.elapsedSec`);
            continue;
          }
          same(mine[key], value, `${id} lap ${index}.${key}`, key.endsWith("Speed") ? 0.0025 : 0);
        }
        for (const key of ["stroke", "strokes", "activeLengths"]) same(mine.swim?.[key], lap.swim?.[key], `${id} lap ${index}.swim.${key}`);
      });
      // COROS puts interval time outside any length in one idle length at the interval's end; CorosLink puts it where the timer ran.
      // (A length the watch records twice can make them add up to more than the interval.)
      ours.laps.forEach((lap, index) => {
        if (lap.swim?.firstLength === undefined || lap.swim.rest) return;
        const timers = ours.lengths.slice(lap.swim.firstLength, lap.swim.firstLength + lap.swim.lengths).reduce((total, length) => total + length.timerSec, 0);
        assert.ok(lap.timerSec - timers < 5 * (lap.swim.activeLengths + 1), `${id} lap ${index}: ${Math.round(lap.timerSec - timers)} s of the lap is in no length`);
      });
      const mineActive = ours.lengths.filter((length) => length.active);
      const theirsActive = reference.lengths.filter((length) => length.active);
      assert.equal(mineActive.length, theirsActive.length, `${id} lengths`);
      theirsActive.forEach((length, index) => {
        const mine = mineActive[index];
        for (const key of ["timerSec", "strokes", "stroke", "strokeRate"]) assert.equal(mine[key], length[key], `${id} length ${index}.${key}`);
        close(mine.avgSpeed, length.avgSpeed, 0.0025, `${id} length ${index}.avgSpeed`);
        // COROS's FIT floors a length's calories; its own table and lap totals round them, like CorosLink.
        close(mine.calories, length.calories, 1, `${id} length ${index}.calories`);
        // SWOLF is the length's time plus its strokes.
        assert.equal(mine.swolf, Math.round(mine.timerSec + mine.strokes), `${id} length ${index}.swolf`);
      });
      const idle = new Set(reference.lengths.filter((length) => !length.active).map((length) => length.timerSec));
      for (const rest of ours.laps.filter((lap) => lap.swim?.rest)) assert.ok(idle.has(rest.timerSec), `${id} rest of ${rest.timerSec} s`);
      // COROS's table: the summary row's average SWOLF and total strokes.
      const rows = fs.readFileSync(`${base}.csv`, "utf8").trim().split(/\r?\n/).map((line) => line.slice(1, -1).split('","'));
      const column = (name) => rows[0].indexOf(name);
      const summary = rows.find((row) => row[0] === "Summary");
      assert.equal(ours.session.swimTotals.avgSwolf, Number(summary[column("Avg SWOLF")]), `${id} average SWOLF`);
      assert.equal(ours.session.swimTotals.strokes, Number(summary[column("Total Strokes")]), `${id} strokes`);
      const byTs = new Map(ours.records.map((record) => [record.ts, record]));
      let temperatures = 0;
      for (const ref of reference.records) {
        const mine = byTs.get(ref.ts);
        if (ref.hr !== undefined && mine?.hr !== undefined) assert.equal(mine.hr, ref.hr, `${id} hr @${ref.ts}`);
        if (ref.temp !== undefined && mine?.temp !== undefined) { assert.equal(mine.temp, ref.temp, `${id} water temperature @${ref.ts}`); temperatures += 1; }
      }
      assert.ok(temperatures > 10, `${id}: ${temperatures} temperatures compared`);
    }
  });
}

console.log(`coros sport record: ${passed} checks passed${oracle ? " (including the real recording)" : ""}${swimOracle ? " (including the real swims)" : ""}`);
