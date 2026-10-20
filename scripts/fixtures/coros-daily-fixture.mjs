// Synthetic PACE 4 daily-history files (SyncData file 5) for tests. The layout
// follows electron/localSync/corosDailyRecord.ts, which was validated against
// COROS's own decoding of a real two-day recording (not committed: it holds
// real heart-rate and sleep data).
import { DEVICE_EPOCH, pages, record } from "./coros-sport-record-fixture.mjs";

const u24 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
const device = (unix) => unix - DEVICE_EPOCH;
const minute = (unix) => Math.floor(device(unix) / 60);

export const zoneRecord = (unix, zoneQuarters) => record(0, Buffer.concat([u32(device(unix)), Buffer.from([zoneQuarters & 0xff])]));
export const heartRateRecord = (unix, bpm, flags = 0x10) => record(1, Buffer.concat([u24(minute(unix)), Buffer.from([bpm, flags])]));
export const activityRecord = (startUnix, endUnix, { steps, smallCalories, activeSeconds = 0 }) =>
  record(2, Buffer.concat([u24(minute(startUnix)), u24(minute(endUnix)), Buffer.from([activeSeconds]), u32(steps * 0x100000 + smallCalories * 4)]));
export const sleepStatusRecord = (unix, status) => record(4, Buffer.concat([u32(device(unix)), Buffer.from([status])]));
export function stressRecord(unix, zoneQuarters, stress, score) {
  const body = Buffer.alloc(21); body[0] = 4; body.writeUInt32LE(device(unix), 1); body.writeInt8(zoneQuarters, 5); body[6] = stress; body[9] = score;
  return record(8, body);
}
/** Kind 8/3: one Health Check. */
export function healthCheckRecord(unix, zoneQuarters, { heartRate, hrv, restingHeartRate = 55, breathingRate, spo2, stress, stressLevel }) {
  const body = Buffer.alloc(27); body[0] = 3; body.writeUInt32LE(device(unix), 1); body.writeInt8(zoneQuarters, 5);
  body[6] = heartRate; body[7] = hrv; body[8] = restingHeartRate; body.writeUInt16LE(breathingRate | (spo2 << 6), 9);
  body[11] = stress; body[12] = stressLevel;
  return record(8, body);
}
/** Kind 10: a one-off heart-rate reading at an exact second. */
export const spotHeartRateRecord = (unix, bpm) => record(10, Buffer.concat([u32(device(unix)), Buffer.from([bpm, 0, 0, 0, 0])]));
export function hrvRecord(unix, zoneQuarters, { status = 4, rmssd, heartRate, breathingRate, sdnn, confidence = 1 }) {
  const body = Buffer.alloc(36); body[0] = 1; body.writeUInt32LE(device(unix), 1); body.writeInt8(zoneQuarters, 5);
  let field = 0n;
  const put = (shift, width, value) => { field |= (BigInt(Math.round(value)) & ((1n << BigInt(width)) - 1n)) << BigInt(shift); };
  put(0, 3, status); put(3, 29, rmssd); put(55, 17, heartRate * 1000); put(73, 17, breathingRate * 1000); put(90, 32, sdnn * 1000); put(186, 32, confidence * 1000);
  for (let index = 0; index < 30; index++) body[6 + index] = Number((field >> BigInt(index * 8)) & 0xffn);
  return record(8, body);
}

const varint = (value) => { const out = []; let v = value; do { let byte = v % 128; v = Math.floor(v / 128); if (v) byte |= 128; out.push(byte); } while (v); return Buffer.from(out); };
const field = (number, value) => Buffer.isBuffer(value)
  ? Buffer.concat([varint(number * 8 + 2), varint(value.length), value])
  : Buffer.concat([varint(number * 8), varint(value)]);

/** Kind 13: heart rate once a second for two minutes after a workout. */
export function recoveryRecord(workoutStartUnix, workoutEndUnix, samples) {
  const curve = Buffer.concat([field(1, device(workoutEndUnix) + 121), field(2, device(workoutStartUnix)), field(3, device(workoutEndUnix)),
    field(4, Buffer.concat(samples.map(varint))), field(5, Buffer.concat(samples.map((_, i) => varint(1000 + i))))]);
  return record(13, field(1, curve));
}

/**
 * Two local days in UTC+7: day 1 from 16:00 (so partial), a night of sleep
 * (two segments, with an awake event at the end instant) and HRV during it,
 * plus stress, activity and per-minute heart rate.
 */
export function syntheticDaily() {
  const zone = 28; // UTC+7
  const local = (y, mo, d, h, mi, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - 7 * 3600;
  const records = [zoneRecord(local(2026, 1, 1, 16, 0), zone)];
  const heart = [];
  for (let t = local(2026, 1, 1, 16, 0); t < local(2026, 1, 2, 10, 0); t += 60) {
    const bpm = 55 + ((t / 60) % 20);
    heart.push([t, bpm]);
    records.push(heartRateRecord(t, bpm));
  }
  records.push(activityRecord(local(2026, 1, 1, 16, 0), local(2026, 1, 1, 16, 5), { steps: 120, smallCalories: 9000, activeSeconds: 60 }));
  records.push(activityRecord(local(2026, 1, 1, 16, 5), local(2026, 1, 1, 16, 7), { steps: 30, smallCalories: 2000 }));
  records.push(activityRecord(local(2026, 1, 1, 16, 7), local(2026, 1, 1, 16, 10), { steps: 10, smallCalories: 1000 })); // same 5-minute slot
  records.push(activityRecord(local(2026, 1, 2, 9, 0), local(2026, 1, 2, 9, 5), { steps: 400, smallCalories: 30_500 }));
  records.push(stressRecord(local(2026, 1, 1, 18, 0), zone, 42, 2), stressRecord(local(2026, 1, 1, 18, 5), zone, 61, 3));
  // Night: 23:00:20 start → light 23:03:40 → deep 00:10:10 → REM 01:00:00 → awake 01:20:29 → light 01:22:31 → end 06:30:10 (+ awake at the end instant)
  const night = [
    [local(2026, 1, 1, 23, 0, 20), 0xfa], [local(2026, 1, 1, 23, 0, 20), 1], [local(2026, 1, 1, 23, 3, 40), 3], [local(2026, 1, 2, 0, 10, 10), 4],
    [local(2026, 1, 2, 1, 0, 0), 5], [local(2026, 1, 2, 1, 20, 29), 1], [local(2026, 1, 2, 1, 22, 31), 3], [local(2026, 1, 2, 6, 30, 10), 1], [local(2026, 1, 2, 6, 30, 10), 0xfb],
    // A second, short segment after waking up.
    [local(2026, 1, 2, 6, 40, 0), 0xfa], [local(2026, 1, 2, 6, 40, 0), 1], [local(2026, 1, 2, 6, 43, 0), 3], [local(2026, 1, 2, 7, 13, 0), 0xfb]
  ];
  for (const [t, status] of night) records.push(sleepStatusRecord(t, status));
  records.push(record(4, Buffer.from([3, 0, 0, 0, 0xe0]))); // a non-sleep kind-4 record, ignored
  const hrv = [[local(2026, 1, 2, 1, 0), 30], [local(2026, 1, 2, 3, 0), 41], [local(2026, 1, 2, 12, 0), 99]]; // the last is outside sleep
  for (const [t, rmssd] of hrv) records.push(hrvRecord(t, zone, { rmssd, heartRate: 58.25, breathingRate: 14.5, sdnn: 40.125, confidence: 0.95 }));
  // A Health Check, and a one-off heart-rate reading taken right after it.
  const healthCheck = { ts: local(2026, 1, 2, 9, 30, 33), heartRate: 72, hrv: 40, breathingRate: 13, spo2: 97, stress: 31, stressLevel: 2 };
  records.push(healthCheckRecord(healthCheck.ts, zone, healthCheck));
  const spot = [local(2026, 1, 2, 9, 32, 12), 80];
  records.push(spotHeartRateRecord(...spot));
  // Recovery after the synthetic run (scripts/fixtures/coros-sport-record-fixture.mjs starts it at 1_767_247_200, 30 s long).
  const recovery = Array.from({ length: 120 }, (_, i) => 150 - Math.floor(i / 4));
  recovery[59] = 0; // a second without a reading, as the watch writes it
  records.push(recoveryRecord(1_767_247_200, 1_767_247_230, recovery));
  records.push(recoveryRecord(1_767_247_200, 1_767_247_230, recovery.slice(0, 10))); // malformed: too few samples, ignored
  return { file: pages(records), heart, local, recovery, healthCheck, spot };
}
