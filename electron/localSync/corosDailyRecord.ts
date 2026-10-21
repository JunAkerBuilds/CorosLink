import { COROS_MOBILE_EPOCH } from "./activityProtocol";
import { walkCorosRecords } from "./corosSportRecord";
import { decodeProtoFields, type ProtoValue } from "./syncPayloadDecoder";

/**
 * Decoder for the watch's daily-history file (SyncData file 5) as a PACE 4
 * (W336, V3.2008.0) writes it: all-day heart rate, steps and calories per
 * 5 minutes, stress, HRV and sleep. It uses the same pages and record headers
 * as the sport-record file (`walkCorosRecords`). Written for CorosLink from a
 * description of the format and checked against COROS's own decoding of a
 * two-day recording. Every heart-rate, segment, stress, HRV and
 * sleep value matches.
 *
 * Records used (all times are seconds since 2014-01-01 UTC unless noted):
 * - kind 0: u32 time, i8 time zone (15-minute units); applies to later records
 * - kind 1: u24 minute, u8 heart rate, u8 flags (bit 4: measured automatically)
 * - kind 10: u32 time, u8 heart rate: a one-off reading at an exact second
 * - kind 2: u24 start minute, u24 end minute, u8 active seconds,
 *           u32 (bits 0-19 calories × 4 in small calories, bits 20-31 steps)
 * - kind 4: u32 time, u8 sleep status (0xfa start, 1 awake, 3 light, 4 deep,
 *           5 REM, 0xfb/0xfd/0xff end)
 * - kind 8, first byte 4 (21 bytes): u32 time, i8 zone, u8 stress, …, u8 score at 9
 * - kind 8, first byte 3 (Health Check): u32 time, i8 zone, u8 heart rate, u8 HRV,
 *           u8 resting heart rate, u16 (bits 0-5 breathing rate, bits 6-12 SpO2),
 *           u8 stress, u8 stress level (low 3 bits)
 * - kind 8, first byte 1 (36 bytes): u32 time, i8 zone, then a bit field:
 *           status 0-2, RMSSD 3-31 (ms), LF 35-44, HF 45-54, heart rate × 1000
 *           55-71, breathing rate × 1000 73-89, SDNN, SD1, SD2 × 1000 (32 bits
 *           each from 90), confidence × 1000 (186-217)
 * - kind 13, protobuf field 1: {1 time, 2 workout start, 3 workout end,
 *           4 packed heart rate once a second for 2 minutes after the workout}
 * Other records (5-minute snapshots, watch-side sleep summaries, telemetry,
 * battery statistics) are ignored; see docs/local-only-mode.md.
 */

const KIND_ZONE = 0;
const KIND_HEART_RATE = 1;
const KIND_ACTIVITY = 2;
const KIND_SLEEP_STATUS = 4;
const KIND_MEASUREMENT = 8;
const KIND_SPOT_HEART_RATE = 10;
const KIND_WORKOUT_RECOVERY = 13;
const RECOVERY_SAMPLES = 120;
const MEASUREMENT_HRV = 1;
const MEASUREMENT_HEALTH_CHECK = 3;
const MEASUREMENT_STRESS = 4;

const SLEEP_START = 0xfa;
const SLEEP_END: ReadonlySet<number> = new Set([0xfb, 0xfd, 0xff]);
/** Watch sleep status → stage. */
const SLEEP_STAGE: Readonly<Record<number, SleepStage>> = { 1: "awake", 3: "light", 4: "deep", 5: "rem" };
/** Earliest plausible record time; smaller values in kind 4 are not sleep events. */
const MIN_DEVICE_TIME = 100_000_000;
/**
 * Longest sleep accepted. The file comes from a Bluetooth peer: a damaged or
 * forged end time could otherwise put one "sleep" across decades, and its
 * minute-by-minute heart-rate scan would hold the app for seconds per sleep.
 */
const MAX_SLEEP_SECONDS = 48 * 3600;

export type SleepStage = "awake" | "light" | "deep" | "rem";

export interface DailyHeartRate {
  /** Unix seconds: the start of the minute, or the exact second of a one-off reading. */
  ts: number;
  bpm: number;
  /** False for readings taken on request, including every one-off (kind 10) reading. */
  automatic: boolean;
  utcOffsetMinutes: number;
}

export interface DailyActivitySlot {
  /** Local calendar day, YYYYMMDD. */
  day: string;
  /** Five-minute slot of the local day (0–287). */
  slot: number;
  steps: number;
  /** Small calories (1/1000 kcal). */
  calories: number;
  activeSeconds: number;
}

export interface DailyStress {
  ts: number;
  utcOffsetMinutes: number;
  stress: number;
  score: number;
}

export interface DailyHrv {
  ts: number;
  utcOffsetMinutes: number;
  status: number;
  rmssdMs: number;
  heartRate: number;
  breathingRate: number;
  sdnnMs: number;
  confidence: number;
}

/** One Health Check taken on the watch. */
export interface DailyHealthCheck {
  ts: number;
  utcOffsetMinutes: number;
  heartRate: number;
  hrvMs: number;
  /** The resting heart rate the watch's algorithms use: the COROS app's user-info value (0x8B), 55 until one is sent. Not measured. */
  restingHeartRate: number;
  breathingRate: number;
  spo2: number;
  stress: number;
  /** 1 Relaxed, 2 Low, 3 Medium, 4 High. */
  stressLevel: number;
}

export interface SleepRange {
  /** Seconds from the sleep's (minute-rounded) start. */
  offset: number;
  seconds: number;
  stage: SleepStage;
}

/** Heart rate once a second after a workout ends, as the watch measured it. */
export interface WorkoutRecovery {
  /** Unix seconds of the workout's start and end (the activity's own times). */
  workoutStart: number;
  workoutEnd: number;
  /** bpm; sample i is i + 1 seconds after the workout ended; 0 means no reading that second. */
  samples: number[];
}

export interface DailySleep {
  /** Unix seconds, rounded to the nearest minute like the COROS app shows them. */
  start: number;
  end: number;
  /** The watch's exact times. */
  startExact: number;
  endExact: number;
  utcOffsetMinutes: number;
  /** Local day the sleep ends on, YYYYMMDD. */
  day: string;
  totalMinutes: number;
  stageSeconds: Record<SleepStage, number>;
  stageMinutes: Record<SleepStage, number>;
  awakeCount: number;
  minHr?: number;
  maxHr?: number;
  avgHr?: number;
  ranges: SleepRange[];
}

export interface DailyDayTotals {
  day: string;
  steps: number;
  /** Kilocalories. */
  calories: number;
  /** True when the file's data for this day starts after local midnight. */
  partial: boolean;
}

export interface CorosDailyFile {
  heartRate: DailyHeartRate[];
  activity: DailyActivitySlot[];
  days: DailyDayTotals[];
  stress: DailyStress[];
  hrv: DailyHrv[];
  healthChecks: DailyHealthCheck[];
  sleeps: DailySleep[];
  /** Average RMSSD over the HRV readings taken during each night's sleep, floored, by day. */
  sleepHrv: Record<string, number>;
  recoveries: WorkoutRecovery[];
}

const unixTs = (deviceSeconds: number) => deviceSeconds + COROS_MOBILE_EPOCH;
const roundMinute = (ts: number) => Math.floor((ts + 30) / 60) * 60;
const u24 = (body: Buffer, offset: number) => body[offset]! | (body[offset + 1]! << 8) | (body[offset + 2]! << 16);

function localParts(ts: number, utcOffsetMinutes: number): { day: string; minuteOfDay: number } {
  const date = new Date((ts + utcOffsetMinutes * 60) * 1000);
  const day = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return { day, minuteOfDay: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

function packedVarints(data: Buffer): number[] | undefined {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const byte of data) {
    value += (byte & 0x7f) * 2 ** shift;
    if (byte & 0x80) {
      shift += 7;
      if (shift > 28) return undefined;
    } else {
      values.push(value);
      value = 0;
      shift = 0;
    }
  }
  return shift === 0 ? values : undefined;
}

function workoutRecovery(body: Buffer): WorkoutRecovery | undefined {
  let outer: Map<number, ProtoValue[]>;
  let curve: Map<number, ProtoValue[]>;
  try {
    outer = decodeProtoFields(body);
    const message = outer.get(1)?.[0];
    if (!Buffer.isBuffer(message)) return undefined;
    curve = decodeProtoFields(message);
  } catch {
    return undefined;
  }
  const start = curve.get(2)?.[0];
  const end = curve.get(3)?.[0];
  const packed = curve.get(4)?.[0];
  if (typeof start !== "number" || typeof end !== "number" || !Buffer.isBuffer(packed) || end <= start) return undefined;
  const samples = packedVarints(packed);
  // 0 marks a second without a reading (the sensor briefly lost contact).
  if (!samples || samples.length !== RECOVERY_SAMPLES || samples.some((bpm) => bpm !== 0 && (bpm < 25 || bpm > 250))) return undefined;
  return { workoutStart: unixTs(start), workoutEnd: unixTs(end), samples };
}

/** Reads `width` bits (≤ 32) at bit `shift` of a little-endian bit field. */
function bits(field: Buffer, shift: number, width: number): number {
  let value = 0;
  for (let index = 0; index < width; index++) {
    const bit = shift + index;
    if ((field[bit >> 3]! >> (bit & 7)) & 1) value += 2 ** index;
  }
  return value;
}

interface SleepDraft {
  startExact: number;
  utcOffsetMinutes: number;
  stages: Array<{ ts: number; stage: SleepStage }>;
}

function finishSleep(draft: SleepDraft, endExact: number, heartRate: Map<number, number>): DailySleep | undefined {
  // A stage change at the end instant has no duration; COROS drops it too.
  const stages = draft.stages.filter((entry) => entry.ts < endExact);
  if (endExact <= draft.startExact || endExact - draft.startExact > MAX_SLEEP_SECONDS || stages.length === 0) return undefined;
  const start = roundMinute(draft.startExact);
  const end = roundMinute(endExact);
  const stageSeconds: Record<SleepStage, number> = { awake: 0, light: 0, deep: 0, rem: 0 };
  const ranges: SleepRange[] = [];
  stages.forEach((entry, index) => {
    const next = stages[index + 1];
    stageSeconds[entry.stage] += (next?.ts ?? endExact) - entry.ts;
    const offset = roundMinute(entry.ts) - start;
    ranges.push({ offset, seconds: (next ? roundMinute(next.ts) : end) - start - offset, stage: entry.stage });
  });
  // Awake time is what the rounded window leaves after the sleep stages.
  stageSeconds.awake = end - start - stageSeconds.light - stageSeconds.deep - stageSeconds.rem;
  const minutes = (seconds: number) => Math.round(seconds / 60);
  const rates: number[] = [];
  for (let ts = start; ts <= end; ts += 60) {
    const bpm = heartRate.get(ts);
    if (bpm !== undefined) rates.push(bpm);
  }
  return {
    start,
    end,
    startExact: draft.startExact,
    endExact,
    utcOffsetMinutes: draft.utcOffsetMinutes,
    day: localParts(end, draft.utcOffsetMinutes).day,
    totalMinutes: (end - start) / 60,
    stageSeconds,
    stageMinutes: { awake: minutes(stageSeconds.awake), light: minutes(stageSeconds.light), deep: minutes(stageSeconds.deep), rem: minutes(stageSeconds.rem) },
    awakeCount: ranges.filter((range) => range.stage === "awake").length,
    ...(rates.length
      // Floored, as COROS does (64.51 → 64).
      ? { minHr: rates.reduce((low, bpm) => Math.min(low, bpm)), maxHr: rates.reduce((high, bpm) => Math.max(high, bpm)), avgHr: Math.floor(rates.reduce((sum, bpm) => sum + bpm, 0) / rates.length) }
      : {}),
    ranges
  };
}

/** Decodes a daily-history file. Throws CorosSportRecordFormatError when the file has no block marker. */
export function decodeCorosDailyFile(file: Buffer): CorosDailyFile {
  const records = walkCorosRecords(file);
  let zoneMinutes = 0;
  const heartRate: DailyHeartRate[] = [];
  const spotHeartRate: DailyHeartRate[] = [];
  const healthChecks: DailyHealthCheck[] = [];
  const slots = new Map<string, DailyActivitySlot>();
  let fileStart: number | undefined;
  const stress: DailyStress[] = [];
  const hrv: DailyHrv[] = [];
  const sleepEvents: Array<{ ts: number; status: number; zone: number }> = [];
  const recoveries = new Map<number, WorkoutRecovery>();

  for (const { kind, body } of records) {
    if (kind === KIND_ZONE && body.length >= 5) {
      zoneMinutes = body.readInt8(4) * 15;
    } else if (kind === KIND_HEART_RATE && body.length >= 5) {
      const ts = unixTs(u24(body, 0) * 60);
      heartRate.push({ ts, bpm: body[3]!, automatic: (body[4]! & 0x10) !== 0, utcOffsetMinutes: zoneMinutes });
      fileStart = Math.min(fileStart ?? ts, ts);
    } else if (kind === KIND_SPOT_HEART_RATE && body.length >= 5) {
      spotHeartRate.push({ ts: unixTs(body.readUInt32LE(0)), bpm: body[4]!, automatic: false, utcOffsetMinutes: zoneMinutes });
    } else if (kind === KIND_ACTIVITY && body.length >= 11) {
      const start = unixTs(u24(body, 0) * 60);
      const packed = body.readUInt32LE(7);
      const { day, minuteOfDay } = localParts(start, zoneMinutes);
      const key = `${day}:${Math.floor(minuteOfDay / 5)}`;
      const slot = slots.get(key) ?? { day, slot: Math.floor(minuteOfDay / 5), steps: 0, calories: 0, activeSeconds: 0 };
      slot.calories += Math.floor((packed & 0xfffff) / 4);
      slot.steps += Math.floor(packed / 0x100000);
      slot.activeSeconds += body[6]!;
      slots.set(key, slot);
      fileStart = Math.min(fileStart ?? start, start);
    } else if (kind === KIND_SLEEP_STATUS && body.length === 5 && body.readUInt32LE(0) >= MIN_DEVICE_TIME) {
      sleepEvents.push({ ts: unixTs(body.readUInt32LE(0)), status: body[4]!, zone: zoneMinutes });
    } else if (kind === KIND_WORKOUT_RECOVERY && body[0] === 0x0a) {
      const recovery = workoutRecovery(body);
      if (recovery) recoveries.set(recovery.workoutStart, recovery);
    } else if (kind === KIND_MEASUREMENT && body[0] === MEASUREMENT_STRESS && body.length === 21) {
      stress.push({ ts: unixTs(body.readUInt32LE(1)), utcOffsetMinutes: body.readInt8(5) * 15, stress: body[6]!, score: body[9]! });
    } else if (kind === KIND_MEASUREMENT && body[0] === MEASUREMENT_HEALTH_CHECK && body.length >= 13) {
      const vitals = body.readUInt16LE(9);
      healthChecks.push({
        ts: unixTs(body.readUInt32LE(1)),
        utcOffsetMinutes: body.readInt8(5) * 15,
        heartRate: body[6]!,
        hrvMs: body[7]!,
        restingHeartRate: body[8]!,
        breathingRate: vitals & 0x3f,
        spo2: (vitals >> 6) & 0x7f,
        stress: body[11]!,
        stressLevel: body[12]! & 7
      });
    } else if (kind === KIND_MEASUREMENT && body[0] === MEASUREMENT_HRV && body.length === 36) {
      const field = body.subarray(6);
      hrv.push({
        ts: unixTs(body.readUInt32LE(1)),
        utcOffsetMinutes: body.readInt8(5) * 15,
        status: bits(field, 0, 3),
        rmssdMs: bits(field, 3, 29),
        heartRate: bits(field, 55, 17) / 1000,
        breathingRate: bits(field, 73, 17) / 1000,
        sdnnMs: bits(field, 90, 32) / 1000,
        confidence: bits(field, 186, 32) / 1000
      });
    }
  }

  const zoneAt = (ts: number) => heartRate.find((sample) => sample.ts === ts)?.utcOffsetMinutes ?? zoneMinutes;
  const bpmByMinute = new Map(heartRate.map((sample) => [sample.ts, sample.bpm]));
  const sleeps: DailySleep[] = [];
  let draft: SleepDraft | undefined;
  for (const event of sleepEvents) {
    if (event.status === SLEEP_START) {
      draft = { startExact: event.ts, utcOffsetMinutes: event.zone, stages: [] };
    } else if (draft && SLEEP_END.has(event.status)) {
      // One night at a time: a sleep overlapping the one before is not a real recording.
      const sleep = draft.startExact >= (sleeps.at(-1)?.endExact ?? -Infinity) ? finishSleep(draft, event.ts, bpmByMinute) : undefined;
      if (sleep) sleeps.push(sleep);
      draft = undefined;
    } else if (draft && SLEEP_STAGE[event.status]) {
      draft.stages.push({ ts: event.ts, stage: SLEEP_STAGE[event.status]! });
    }
  }

  const activity = [...slots.values()];
  // The file begins where the watch's history begins (after the last phone sync); only that first day can be partial.
  const first = fileStart === undefined ? undefined : localParts(fileStart, zoneAt(fileStart));
  // Grouped in one pass each (a file can hold years of days and readings).
  const totals = new Map<string, { steps: number; calories: number }>();
  for (const slot of activity) {
    const total = totals.get(slot.day) ?? { steps: 0, calories: 0 };
    total.steps += slot.steps;
    total.calories += slot.calories;
    totals.set(slot.day, total);
  }
  const days = [...totals].map(([day, total]) => ({
    day,
    steps: total.steps,
    calories: Math.round(total.calories / 1000),
    partial: first !== undefined && day === first.day && first.minuteOfDay > 0
  }));

  // Sleeps don't overlap and are in time order, so each reading's night is found by binary search.
  const hrvByDay = new Map<string, { sum: number; count: number }>();
  for (const reading of hrv) {
    if (reading.rmssdMs <= 0) continue;
    let low = 0;
    let high = sleeps.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (sleeps[middle]!.start <= reading.ts) low = middle;
      else high = middle - 1;
    }
    // Rounded windows of back-to-back sleeps can touch; a reading on the boundary counts once, for the later night.
    const night = sleeps[low];
    if (!night || reading.ts < night.start || reading.ts > night.end) continue;
    const entry = hrvByDay.get(night.day) ?? { sum: 0, count: 0 };
    entry.sum += reading.rmssdMs;
    entry.count += 1;
    hrvByDay.set(night.day, entry);
  }
  const sleepHrv: Record<string, number> = {};
  for (const [day, entry] of hrvByDay) sleepHrv[day] = Math.floor(entry.sum / entry.count);

  // One-off readings join the list after sleep is worked out, which uses the per-minute readings only.
  // A loop, not push(...spotHeartRate): a long history overflows the argument list.
  for (const reading of spotHeartRate) heartRate.push(reading);
  return { heartRate, activity, days, stress, hrv, healthChecks, sleeps, sleepHrv, recoveries: [...recoveries.values()] };
}
