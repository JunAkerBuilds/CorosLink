// Synthetic PACE 4 sport-record files (SyncData file 14) for tests. The layout
// follows electron/localSync/corosSportRecord.ts; the decoder itself was
// validated against COROS's own decoding of a real recording, which is not
// committed because it contains a real GPS track.

export const DEVICE_EPOCH = 1_388_534_400;

class BitWriter {
  constructor() { this.bytes = []; this.bit = 0; }
  write(width, value) {
    for (let index = 0; index < width; index++) {
      if ((this.bit & 7) === 0) this.bytes.push(0);
      if (Math.floor(value / 2 ** index) % 2) this.bytes[this.bytes.length - 1] |= 1 << (this.bit & 7);
      this.bit += 1;
    }
  }
}

const bitLength = (value) => (value === 0 ? 1 : Math.floor(Math.log2(value)) + 1);
const zigzag = (delta) => (delta >= 0 ? delta * 2 : -delta * 2 - 1);

/**
 * Encodes samples as the watch's delta-pack. mode: "deltas" (1), "offset" (2), "step" (0, constant
 * step), "absolute" (3) or "raw" (3 with raw bytes). variable: bit 8 (variable width / base).
 */
export function encodeDeltaPack(values, { sizeShift = 0, mode = "deltas", variable = false, group = 0 } = {}) {
  const bits = new BitWriter();
  const writeNumber = (value) => { const width = bitLength(value); bits.write(6, width - 1); bits.write(width, value); };
  let flags = sizeShift | (group << 11);
  const size = 1 << sizeShift;
  if (mode === "raw") {
    flags |= 0x600 | 0x1fc;
    const raw = Buffer.alloc(values.length * size);
    values.forEach((value, index) => raw.writeUIntLE(value, index * size, size));
    return Buffer.concat([Buffer.from([flags & 0xff, flags >> 8, values.length]), raw]);
  }
  if (mode === "absolute") {
    const base = variable ? Math.min(...values) : 0;
    const width = Math.max(...values.map((value) => bitLength(value - base)));
    flags |= 0x600 | ((width - 1) << 2) | (variable ? 0x100 : 0);
    if (variable) writeNumber(base);
    for (const value of values) bits.write(width, value - base);
    return Buffer.concat([Buffer.from([flags & 0xff, flags >> 8, values.length]), Buffer.from(bits.bytes)]);
  }
  const deltas = values.slice(1).map((value, index) => zigzag(value - values[index]));
  if (mode === "step") {
    if (new Set(deltas).size > 1) throw new Error("step mode needs a constant step");
    writeNumber(values[0]);
    writeNumber(deltas[0] ?? 0);
    return Buffer.concat([Buffer.from([flags & 0xff, flags >> 8, values.length]), Buffer.from(bits.bytes)]);
  }
  const offset = mode === "offset" ? Math.min(...deltas) : 0;
  const stored = deltas.map((delta) => delta - offset);
  const width = variable ? 1 : Math.max(1, ...stored.map(bitLength));
  flags |= ((width - 1) << 2) | (mode === "offset" ? 0x400 : 0x200) | (variable ? 0x100 : 0);
  writeNumber(values[0]);
  if (mode === "offset") writeNumber(offset);
  if (variable) {
    // Largest extra width, with a 3-bit length prefix; each sample then flags whether it needs extra bits.
    const extras = stored.map((value) => Math.max(0, bitLength(value) - width));
    const maxExtra = Math.max(0, ...extras);
    const extraWidth = bitLength(maxExtra);
    bits.write(3, extraWidth - 1);
    bits.write(extraWidth, maxExtra);
    stored.forEach((value, index) => {
      if (extras[index] === 0) { bits.write(1, 0); bits.write(width, value); }
      else { bits.write(1, 1); bits.write(extraWidth, extras[index]); bits.write(width + extras[index], value); }
    });
  } else {
    for (const value of stored) bits.write(width, value);
  }
  return Buffer.concat([Buffer.from([flags & 0xff, flags >> 8, values.length]), Buffer.from(bits.bytes)]);
}

function header(kind, length) {
  if (kind < 8 && length < 16) return Buffer.from([(length << 4) | (kind << 1)]);
  const value = 1 | ((kind & 7) << 1) | (((kind >> 3) & 3) << 8) | ((length & 0xf) << 4) | (((length >> 4) & 0x3f) << 10);
  return Buffer.from([value & 0xff, value >> 8]);
}

export const record = (kind, body) => Buffer.concat([header(kind, body.length), body]);
export const marker = (page) => record(0x1f, Buffer.from([0xa5, 0x5a, 0x00, 0x05, 0x01, page, 0, 0, 0, 0x04, 0x02, 0x11, 0, 0]));
const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xffff); return b; };
const i16 = (value) => { const b = Buffer.alloc(2); b.writeInt16LE(value); return b; };
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
const device = (unix) => unix - DEVICE_EPOCH;
const info = (subtype, ...parts) => record(4, Buffer.concat([Buffer.from([subtype]), ...parts]));

export function seriesRecord(channel, interval, startUnix, packed, { corruptChecksum = false } = {}) {
  const tail = Buffer.concat([Buffer.from([channel, interval]), u32(device(startUnix)), packed]);
  let sum = 0;
  for (const byte of tail) sum = (sum + byte) & 0xff;
  return record(8, Buffer.concat([Buffer.from([corruptChecksum ? (sum + 1) & 0xff : sum]), tail]));
}

export const startRecord = (unix, ms, deviceSport) => info(0, u32(device(unix)), Buffer.from([0x80, 0x1c]), u32(100_000), u16(0x0501), Buffer.from([0, deviceSport]), u16(ms), Buffer.alloc(15));
export const pauseRecord = (unix, ms) => info(1, u32(device(unix)), Buffer.from([0]), u32(ms), Buffer.alloc(16));
export const resumeRecord = (unix) => info(2, u32(device(unix)), Buffer.from([2, 3]), Buffer.alloc(8));

export function lapRecord(lap) {
  const body = Buffer.alloc(58);
  body.writeUInt32LE(device(lap.endUnix), 0);
  body.writeUInt16LE(lap.index, 4);
  body.writeUInt32LE(lap.timerCs, 6);
  body.writeUInt32LE(lap.distanceCm, 10);
  body.writeUInt32LE(lap.pauseCs ?? 0, 14);
  body.writeUInt32LE(lap.smallCalories, 18);
  body.writeUInt16LE(lap.bestPace, 24);
  body[26] = lap.avgHr; body[27] = lap.maxHr;
  body.writeUInt16LE(lap.ascent, 31); body.writeUInt16LE(lap.descent, 33);
  body[35] = lap.stepCadence;
  body[28] = lap.minHr ?? 0; body.writeInt8(lap.temperature ?? 0, 29); body[37] = lap.stepLengthCm ?? 0;
  return info(4, body);
}

/** Lap extension: power and running-dynamics averages (vertical ratio × 10, ground contact ms, oscillation in 1/16 mm). */
export const lapExtensionRecord = (index, { avgPower, maxPower, verticalRatioX10 = 0, groundTimeMs = 0, oscillation16 = 0 }) =>
  info(6, u16(index), u16(avgPower), u16(maxPower), u16(0), u16(verticalRatioX10), u16(groundTimeMs), u16(oscillation16), Buffer.alloc(44));

/**
 * Science summary part 2: the watch's training analysis, laid out like a PACE 4
 * (3.2008.0) record: recovery seconds @0x13, Base Fitness @0x19, Load Impact
 * @0x1b, VO₂ max @0x27, fatigue % (s16) @0x2d; byte 0x1d stays 0.
 */
export function trainingRecord(t) {
  const body = Buffer.alloc(57);
  body[0] = 2;
  body.writeUInt16LE(t.aerobicLoad, 1); body.writeUInt16LE(t.anaerobicLoad, 3);
  body.writeUInt16LE(t.lowLoad, 5); body.writeUInt16LE(t.midLoad, 7); body.writeUInt16LE(t.highLoad, 9);
  body[0xb] = t.focus; body[0xc] = t.aerobicEffect; body[0xd] = t.anaerobicEffect; body[0xe] = t.performance;
  body.writeUInt32LE(t.recovery, 0x13); body.writeUInt16LE(t.sevenDayLoad, 0x17);
  body.writeUInt16LE(t.recommendedLoadMin, 0x1e); body.writeUInt16LE(t.recommendedLoadMax, 0x20);
  body[0x27] = t.vo2max ?? 0;
  body.writeUInt16LE(t.baseFitness ?? 0, 0x19); body.writeUInt16LE(t.loadImpact ?? 0, 0x1b);
  body.writeInt16LE(t.fatigue ?? 0, 0x2d);
  return info(0x0f, body);
}

export function summaryRecord(summary) {
  const body = Buffer.alloc(58);
  body.writeUInt32LE(summary.distanceCm, 0);
  body.writeUInt32LE(summary.timerCs, 4);
  body.writeUInt16LE(1, 8);
  body.writeUInt32LE(summary.smallCalories, 10);
  body.writeUInt16LE(summary.bestPace, 16);
  body[22] = summary.avgHr; body[23] = summary.maxHr;
  body.writeUInt16LE(summary.ascent, 26); body.writeUInt16LE(summary.descent, 28);
  i16(summary.altitudeOffset).copy(body, 30);
  body[36] = summary.stepCadence; body[37] = summary.maxStepCadence;
  body.writeUInt16LE(summary.avgPower, 45);
  body[24] = summary.minHr ?? 0; body.writeInt8(summary.temperature ?? 0, 25);
  body.writeUInt16LE(summary.steps ?? 0, 39); body[43] = summary.stepLengthCm ?? 0;
  return info(5, body);
}

/** Splits records into 4 KB pages, each opened by a marker and closed with 0x1e padding. */
export function pages(records) {
  const out = [];
  let page = [marker(1)];
  let used = page[0].length;
  const close = () => {
    let free = 4096 - used;
    while (free > 0) {
      const length = Math.min(free - 2, 1023);
      if (length < 0) { page.push(Buffer.alloc(free, 0)); break; }
      const pad = record(0x1e, Buffer.alloc(length, 0xff));
      page.push(pad); free -= pad.length;
    }
    out.push(Buffer.concat(page));
  };
  for (const item of records) {
    if (used + item.length > 4096 - 2) { close(); page = [marker(out.length + 1)]; used = page[0].length; }
    page.push(item); used += item.length;
  }
  close();
  return Buffer.concat(out);
}

/**
 * A finished outdoor run: 30 s with one 10 s pause, two laps, GPS, heart rate,
 * distance, speed, cadence, power and altitude. Returns the file and what a
 * correct decoder must produce.
 */
export function syntheticRun({ startUnix = 1_767_247_200, deviceSport = 0, corruptHeartRate = false, vo2max = 43,
  recovery = 7200, balance = { baseFitness: 48, loadImpact: 61, fatigue: 127 } } = {}) {
  const t0 = startUnix;
  const hr = Array.from({ length: 30 }, (_, i) => 120 + ((i * 7) % 23));
  hr[12] = 200; // a jump wider than the base width, for the variable-width path
  const lat = Array.from({ length: 30 }, (_, i) => 108_057_578 + i * 37 - (i % 3) * 11);
  const lonDeg = Array.from({ length: 30 }, (_, i) => -1_221_531_002 + i * 53);
  const lon = lonDeg.map((value) => value >>> 0);
  const dist = Array.from({ length: 16 }, (_, i) => i * 4);
  const speed = Array.from({ length: 16 }, (_, i) => 700 + (i % 4) * 10);
  const cadence = Array.from({ length: 16 }, () => 170);
  const power = Array.from({ length: 16 }, (_, i) => 180 + i);
  const alt = Array.from({ length: 8 }, (_, i) => 52 - (i >> 1));
  const stepLength = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : 100 + (i % 3)));
  const effort = Array.from({ length: 16 }, (_, i) => 720 + i * 2);
  const groundTime = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : 250 + i));
  const oscillation = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : 80 + (i % 2)));
  const ratio = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : 75 + (i % 4)));
  const records = [
    startRecord(t0, 250, deviceSport),
    seriesRecord(0x02, 1, t0 + 1, encodeDeltaPack(hr, { variable: true }), { corruptChecksum: corruptHeartRate }),
    seriesRecord(0x28, 1, t0 + 1, encodeDeltaPack(lon, { sizeShift: 2, group: 0 })),
    seriesRecord(0x28, 1, t0 + 1, encodeDeltaPack(lat, { sizeShift: 2, mode: "offset", group: 1 })),
    seriesRecord(0x07, 2, t0, encodeDeltaPack(dist, { sizeShift: 2, mode: "step" })),
    seriesRecord(0x06, 2, t0, encodeDeltaPack(speed, { sizeShift: 1, mode: "absolute", variable: true })),
    seriesRecord(0x00, 2, t0, encodeDeltaPack(cadence, { mode: "raw" })),
    seriesRecord(0x08, 2, t0, encodeDeltaPack(power, { sizeShift: 1 })),
    seriesRecord(0x05, 4, t0, encodeDeltaPack(alt, { mode: "absolute" })),
    seriesRecord(0x01, 2, t0, encodeDeltaPack(stepLength)),
    seriesRecord(0x11, 2, t0, encodeDeltaPack(effort, { sizeShift: 1 })),
    seriesRecord(0x26, 2, t0, encodeDeltaPack(Array.from({ length: 16 }, () => 1), { group: 0 })),
    seriesRecord(0x26, 2, t0, encodeDeltaPack(groundTime, { sizeShift: 1, group: 1 })),
    seriesRecord(0x26, 2, t0, encodeDeltaPack(oscillation, { sizeShift: 1, group: 3 })),
    seriesRecord(0x26, 2, t0, encodeDeltaPack(ratio, { sizeShift: 1, group: 4 })),
    seriesRecord(0x22, 1, t0, encodeDeltaPack([1, 2, 3])), // an unknown channel is ignored
    // Firmware log lines (kind 5), ignored by the decoder; enough of them to push the session onto a second page.
    ...Array.from({ length: 70 }, (_, i) => record(5, Buffer.concat([Buffer.from([7]), u32(device(t0 + 5)), Buffer.from(`ALGO[10]:log line ${String(i).padStart(30, "0")}\r\n\0`)]))),
    pauseRecord(t0 + 10, 500),
    resumeRecord(t0 + 20),
    lapRecord({ index: 1, endUnix: t0 + 15, timerCs: 1000, distanceCm: 4000, smallCalories: 8000, bestPace: 320, avgHr: 130, maxHr: 145, ascent: 2, descent: 1, stepCadence: 168, minHr: 110, temperature: 24, stepLengthCm: 101 }),
    lapExtensionRecord(1, { avgPower: 185, maxPower: 195, verticalRatioX10: 76, groundTimeMs: 255, oscillation16: 1288 }),
    pauseRecord(t0 + 30, 750),
    lapRecord({ index: 2, endUnix: t0 + 30, timerCs: 1000, distanceCm: 2000, smallCalories: 7500, bestPace: 300, avgHr: 150, maxHr: 200, ascent: 2, descent: 1, stepCadence: 172, minHr: 120, temperature: 25, stepLengthCm: 99 }),
    lapExtensionRecord(2, { avgPower: 192, maxPower: 199 }),
    trainingRecord({ aerobicLoad: 30, anaerobicLoad: 5, lowLoad: 20, midLoad: 12, highLoad: 3, focus: 3, aerobicEffect: 27, anaerobicEffect: 8, performance: 102, recovery, sevenDayLoad: 310, recommendedLoadMin: 200, recommendedLoadMax: 500, vo2max, ...balance }),
    summaryRecord({ distanceCm: 6000, timerCs: 2000, smallCalories: 15_500, bestPace: 300, avgHr: 140, maxHr: 200, ascent: 4, descent: 2, altitudeOffset: -40, stepCadence: 170, maxStepCadence: 180, avgPower: 188, minHr: 110, temperature: 24, steps: 61, stepLengthCm: 100 })
  ];
  return {
    file: pages(records),
    expected: {
      t0, hr, lat: lat.map((v) => v / 1e7), lon: lonDeg.map((v) => v / 1e7), dist, speed: speed.map((v) => v / 360), power, alt: alt.map((v) => v - 40),
      stepLength, effort, groundTime, oscillation, ratio,
      activeWindows: [[t0, t0 + 10], [t0 + 21, t0 + 30]],
      session: {
        sportType: 100, startTs: t0, endTs: t0 + 30, elapsedSec: 30.5, timerSec: 20, distanceM: 60, calories: 16,
        maxSpeed: 1000 / 300, avgHr: 140, maxHr: 200, avgCadence: 85, maxCadence: 90, avgPower: 188, ascentM: 4, descentM: 2
      }
    }
  };
}
