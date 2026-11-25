// The watch's all-day history (SyncData file 5). A port of CorosKit's WatchData/DailyHistory.swift (CorosRecords
// and DailyHistory).
import { CorosError, u16, u32 } from "./bytes";
import { type ProtoField, fieldBytes, fieldInt32, fieldVarint, packedVarints, protoFields } from "./protobuf";
import { type CalendarDay, compareDays, dayKey, dayText, utcCalendarDay } from "./native";
import { COROS_EPOCH } from "./systemBind";

// MARK: Record walker (CorosRecords)

/** One record of a watch record file (SyncData 5 and 14). */
export interface CorosRecord { kind: number; body: Uint8Array }

const PAGE_BYTES = 4096;
/** Real files hold tens of thousands; millions of tiny forged ones would exhaust memory. */
const MAXIMUM_RECORDS = 1_000_000;
const PADDING = 0x1e;
const MARKER = 0x1f;

function recordHeader(file: Uint8Array, position: number): { kind: number; length: number; headerBytes: number } | undefined {
  const first = file[position];
  if ((first & 1) === 0) return { kind: (first & 0xf) >> 1, length: first >> 4, headerBytes: 1 };
  if (position + 2 > file.length) return undefined;
  const header = file[position] | (file[position + 1] << 8);
  return { kind: ((header & 0xf) >> 1) | ((header >> 5) & 0x18), length: ((header >> 4) & 0xf) | ((header >> 6) & 0xfff0), headerBytes: 2 };
}

function isMarker(file: Uint8Array, position: number): boolean {
  if (position + 4 > file.length) return false;
  const header = recordHeader(file, position);
  return !!header && header.headerBytes === 2 && header.kind === MARKER && header.length >= 5 && header.length < 15 &&
    file[position + 2] === 0xa5 && file[position + 3] === 0x5a;
}

/**
 * Every record after a block marker, as a PACE 4 writes them: 4 KB pages each opened by a marker (kind 0x1f, body
 * `a5 5a`, byte 4 the page's length unit); 1- or 2-byte headers; lengths × the unit except padding and markers.
 * Scanning resumes at the next page when a record doesn't fit.
 */
export function walkRecords(file: Uint8Array): CorosRecord[] {
  const records: CorosRecord[] = [];
  let position = 0, unit = 0, markers = 0;
  while (position < file.length) {
    if (unit === 0) {
      if (isMarker(file, position)) unit = -1;
      else { position += 1; continue; }
    }
    const header = recordHeader(file, position);
    if (!header) break;
    const length = header.kind === MARKER || header.kind === PADDING ? header.length : header.length * Math.max(unit, 0);
    const start = position + header.headerBytes;
    if (start + length > file.length) {
      unit = 0;
      position = (Math.trunc(position / PAGE_BYTES) + 1) * PAGE_BYTES;
      continue;
    }
    const body = file.subarray(start, start + length);
    if (header.kind === MARKER) {
      if (body.length < 5 || body[0] !== 0xa5 || body[1] !== 0x5a) { unit = 0; position += 1; continue; }
      unit = body[4];
      markers += 1;
    }
    if (length > 0) {
      if (records.length >= MAXIMUM_RECORDS) throw new CorosError("The watch's records are damaged.");
      records.push({ kind: header.kind, body });
    }
    position = start + length;
  }
  // An empty file is the watch with nothing to give (the COROS app just synced and it dropped every record).
  if (markers === 0 && file.length > 0) throw new CorosError("The watch's records are damaged.");
  return records;
}

const tryFields = (data: Uint8Array): ProtoField[] | undefined => { try { return protoFields(data); } catch { return undefined; } };
const firstField = (fields: ProtoField[], number: number): ProtoField | undefined => fields.find((f) => f.number === number);
const varintOf = (fields: ProtoField[], number: number): bigint | undefined => { const f = firstField(fields, number); return f ? fieldVarint(f) ?? undefined : undefined; };
const bytesOf = (fields: ProtoField[], number: number): Uint8Array | undefined => { const f = firstField(fields, number); return f ? fieldBytes(f) ?? undefined : undefined; };

// MARK: The daily history

export interface HeartRateReading {
  /** The start of the minute, or the exact second of a one-off reading. */
  time: Date;
  bpm: number;
  /** False for readings taken on request, including every one-off reading. */
  automatic: boolean;
  utcOffsetMinutes: number;
}

export interface StressReading {
  time: Date;
  utcOffsetMinutes: number;
  stress: number;
  /** The watch's band: 1 rest, 2 low, 3 medium, 4 high. */
  level: number;
}

export interface HRVReading { time: Date; utcOffsetMinutes: number; status: number; rmssd: number; heartRate: number; breathingRate: number }

export interface HealthCheckReading {
  time: Date;
  utcOffsetMinutes: number;
  heartRate: number;
  hrv: number;
  breathingRate: number;
  spo2: number;
  stress: number;
  /** 1 Relaxed, 2 Low, 3 Medium, 4 High. */
  stressLevel: number;
}

export type SleepStage = "awake" | "light" | "deep" | "rem";

export interface SleepRange {
  /** Seconds from the sleep's (minute-rounded) start. */
  offset: number;
  seconds: number;
  stage: SleepStage;
}

/** One sleep segment: the watch splits a night where you briefly wake up. */
export interface SleepSegment {
  /** Rounded to the nearest minute, as the COROS app shows them. */
  start: Date;
  end: Date;
  utcOffsetMinutes: number;
  /** The local day the sleep ends on. */
  day: CalendarDay;
  totalMinutes: number;
  stageMinutes: Partial<Record<SleepStage, number>>;
  awakeCount: number;
  minHR?: number;
  maxHR?: number;
  averageHR?: number;
  ranges: SleepRange[];
  /** The sleep score the watch shows, from the summary it wrote as this segment ended. */
  score?: number;
}

export const stageMinutes = (sleep: SleepSegment, stage: SleepStage): number => sleep.stageMinutes[stage] ?? 0;
export const asleepMinutes = (sleep: SleepSegment): number =>
  stageMinutes(sleep, "light") + stageMinutes(sleep, "deep") + stageMinutes(sleep, "rem");

export interface DayTotals {
  day: CalendarDay;
  steps: number;
  /** Active kilocalories. */
  calories: number;
  /** The file's data for this day starts after local midnight. */
  partial: boolean;
  /** Active time, which GetPedometer counts too. */
  activeSeconds: number;
}

/** The active calories of one activity record (five minutes or less). */
export interface CaloriesRecord { time: Date; /** 1/1000 kcal. */ smallCalories: number }

export interface Recovery {
  workoutStart: Date;
  workoutEnd: Date;
  /** bpm; sample i is i + 1 seconds after the workout ended; 0 means no reading that second. */
  samples: number[];
}

/** One per-feature counter in the battery record (CorosKit's BatteryUsage.Counter). */
export interface BatteryCounter { key: number; value: number; param?: number }

/** The battery as the watch logged it on the hour. */
export interface BatteryReading { time: Date; utcOffsetMinutes: number; percent: number; usage: BatteryCounter[] }

export interface DailyHistory {
  heartRate: HeartRateReading[];
  days: DayTotals[];
  /** Each activity record that burned calories, oldest first. */
  calories: CaloriesRecord[];
  stress: StressReading[];
  hrv: HRVReading[];
  healthChecks: HealthCheckReading[];
  sleeps: SleepSegment[];
  /** Average RMSSD over the HRV readings taken during each night's sleep, floored, by day (dayKey). */
  sleepHRV: Map<number, number>;
  recoveries: Recovery[];
  /** Oldest first. */
  battery: BatteryReading[];
}

export const emptyDailyHistory = (): DailyHistory => ({
  heartRate: [], days: [], calories: [], stress: [], hrv: [], healthChecks: [], sleeps: [], sleepHRV: new Map(), recoveries: [], battery: [],
});

const KIND_ZONE = 0, KIND_HEART_RATE = 1, KIND_ACTIVITY = 2, KIND_SLEEP_STATUS = 4, KIND_MEASUREMENT = 8;
const KIND_SPOT_HEART_RATE = 10, KIND_DEBUG = 11, KIND_WORKOUT_RECOVERY = 13, KIND_SLEEP_NIGHT = 15;
/** A kind-15 night: count, format, 4 reserved bytes, then the events. */
const SLEEP_NIGHT_HEADER = 6, SLEEP_EVENT_BYTES = 5;
/** The watch writes a night's summary a minute or two after the night ends. */
const SUMMARY_DELAY = 30 * 60;
const SLEEP_START = 0xfa;
const SLEEP_END = new Set([0xfb, 0xfd, 0xff]);
const SLEEP_STAGES: Record<number, SleepStage> = { 1: "awake", 3: "light", 4: "deep", 5: "rem" };
/** Earliest plausible record time; smaller values in kind 4 are not sleep events. */
const MINIMUM_DEVICE_TIME = 100_000_000;
/** A damaged or forged end time could otherwise put one sleep across decades. */
const MAXIMUM_SLEEP_SECONDS = 48 * 3600;

const unix = (deviceSeconds: number): number => deviceSeconds + COROS_EPOCH;
const at = (unixSeconds: number): Date => new Date(unixSeconds * 1000);
const seconds = (date: Date): number => Math.trunc(date.getTime() / 1000);
const roundMinute = (ts: number): number => Math.floor((ts + 30) / 60) * 60;
const u24 = (body: Uint8Array, offset: number): number => body[offset] | (body[offset + 1] << 8) | (body[offset + 2] << 16);
const int8 = (body: Uint8Array, offset: number): number => (body[offset] << 24) >> 24;
/** An activity record's active time: a full five minutes doesn't fit the byte and wraps to 44. */
const activeSecondsOf = (byte: number): number => (byte === 44 ? 300 : byte);
/** CorosKit's WatchForecast.round: JavaScript's Math.round (halves up). */
export const forecastRound = (value: number): number => Math.floor(value + 0.5);

function local(ts: number, utcOffsetMinutes: number): { day: CalendarDay; minuteOfDay: number } {
  const date = new Date((ts + utcOffsetMinutes * 60) * 1000);
  return { day: utcCalendarDay(date), minuteOfDay: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

/** Reads `width` bits (≤ 32) at bit `shift` of a little-endian bit field. */
function bits(field: Uint8Array, shift: number, width: number): number {
  let value = 0;
  for (let index = 0; index < width; index++) {
    const bit = shift + index;
    if ((field[bit >> 3] >> (bit & 7)) & 1) value += 2 ** index;
  }
  return value;
}

interface SleepEvent { ts: number; status: number; zone: number }
interface SleepDraft { start: number; zone: number; stages: { ts: number; stage: SleepStage }[] }

/**
 * Decodes the daily history as CorosLink does (`corosDailyRecord.ts`): per-minute and one-off heart rate, five-minute
 * activity slots, sleep status events (kind 4, or kind 15 on firmware 3.2206), stress, Health Checks, HRV, workout
 * recovery curves, night summaries (11/4) and hourly battery records (11/7). Times are seconds since 2014 UTC.
 */
export function parseDailyHistory(file: Uint8Array): DailyHistory {
  const history = emptyDailyHistory();
  let zoneMinutes = 0;
  const minuteHeartRate: HeartRateReading[] = [];
  const spotHeartRate: HeartRateReading[] = [];
  const slots = new Map<string, { day: CalendarDay; steps: number; calories: number; activeSeconds: number }>();
  let fileStart: number | undefined;
  const sleepEvents: SleepEvent[] = [];
  const summaries: { ts: number; score?: number }[] = [];
  const recoveries = new Map<number, Recovery>();

  for (const { kind, body } of walkRecords(file)) {
    if (kind === KIND_ZONE && body.length >= 5) {
      zoneMinutes = int8(body, 4) * 15;
    } else if (kind === KIND_HEART_RATE && body.length >= 5) {
      const ts = unix(u24(body, 0) * 60);
      minuteHeartRate.push({ time: at(ts), bpm: body[3], automatic: (body[4] & 0x10) !== 0, utcOffsetMinutes: zoneMinutes });
      fileStart = Math.min(fileStart ?? ts, ts);
    } else if (kind === KIND_SPOT_HEART_RATE && body.length >= 5) {
      spotHeartRate.push({ time: at(unix(u32(body, 0))), bpm: body[4], automatic: false, utcOffsetMinutes: zoneMinutes });
    } else if (kind === KIND_ACTIVITY && body.length >= 11) {
      const start = unix(u24(body, 0) * 60);
      const packed = u32(body, 7);
      const { day, minuteOfDay } = local(start, zoneMinutes);
      const key = `${dayText(day)}:${Math.trunc(minuteOfDay / 5)}`;
      const slot = slots.get(key) ?? { day, steps: 0, calories: 0, activeSeconds: 0 };
      slot.calories += Math.trunc((packed & 0xfffff) / 4);
      slot.steps += packed >>> 20;
      slot.activeSeconds += activeSecondsOf(body[6]);
      slots.set(key, slot);
      if ((packed & 0xfffff) > 0) history.calories.push({ time: at(start), smallCalories: Math.trunc((packed & 0xfffff) / 4) });
      fileStart = Math.min(fileStart ?? start, start);
    } else if (kind === KIND_SLEEP_STATUS && body.length === 5 && u32(body, 0) >= MINIMUM_DEVICE_TIME) {
      sleepEvents.push({ ts: unix(u32(body, 0)), status: body[4], zone: zoneMinutes });
    } else if (kind === KIND_SLEEP_NIGHT && body.length >= SLEEP_NIGHT_HEADER) {
      const count = Math.min(body[0], Math.trunc((body.length - SLEEP_NIGHT_HEADER) / SLEEP_EVENT_BYTES));
      for (let index = 0; index < count; index++) {
        const offset = SLEEP_NIGHT_HEADER + index * SLEEP_EVENT_BYTES;
        if (u32(body, offset) < MINIMUM_DEVICE_TIME) continue;
        sleepEvents.push({ ts: unix(u32(body, offset)), status: body[offset + 4], zone: zoneMinutes });
      }
    } else if (kind === KIND_DEBUG && body[0] === 4 && body.length >= 50) {
      summaries.push({ ts: unix(u32(body, 1)), score: sleepScore(Array.from({ length: 10 }, (_, i) => u16(body, 30 + 2 * i) / 10)) });
    } else if (kind === KIND_DEBUG && body[0] === 7 && body.length >= 3) {
      const reading = batteryReading(body);
      if (reading) history.battery.push(reading);
    } else if (kind === KIND_WORKOUT_RECOVERY && body[0] === 0x0a) {
      const recovery = recoveryCurve(body);
      if (recovery) recoveries.set(seconds(recovery.workoutStart), recovery);
    } else if (kind === KIND_MEASUREMENT && body[0] === 4 && body.length === 21) {
      history.stress.push({ time: at(unix(u32(body, 1))), utcOffsetMinutes: int8(body, 5) * 15, stress: body[6], level: body[9] });
    } else if (kind === KIND_MEASUREMENT && body[0] === 3 && body.length >= 13) {
      const vitals = u16(body, 9);
      history.healthChecks.push({
        time: at(unix(u32(body, 1))), utcOffsetMinutes: int8(body, 5) * 15, heartRate: body[6], hrv: body[7],
        breathingRate: vitals & 0x3f, spo2: (vitals >> 6) & 0x7f, stress: body[11], stressLevel: body[12] & 7,
      });
    } else if (kind === KIND_MEASUREMENT && body[0] === 1 && body.length === 36) {
      const bitField = body.subarray(6);
      history.hrv.push({
        time: at(unix(u32(body, 1))), utcOffsetMinutes: int8(body, 5) * 15, status: bits(bitField, 0, 3), rmssd: bits(bitField, 3, 29),
        heartRate: bits(bitField, 55, 17) / 1000, breathingRate: bits(bitField, 73, 17) / 1000,
      });
    }
  }

  // Sleep, from the status events, the way the COROS app builds it.
  const bpmByMinute = new Map<number, number>();
  for (const reading of minuteHeartRate) bpmByMinute.set(seconds(reading.time), reading.bpm);
  let draft: SleepDraft | undefined;
  let last: { start: number; end: number } | undefined;
  const sleeps = history.sleeps;
  for (const event of sleepEvents) {
    if (event.status === SLEEP_START) {
      draft = { start: event.ts, zone: event.zone, stages: [] };
    } else if (draft && SLEEP_END.has(event.status)) {
      // One night at a time. A sleep from the same start or earlier that ends later is the watch writing that night
      // again after you fell back asleep, so it replaces it. Any other sleep overlapping the one before isn't real.
      const sleep = finishSleep(draft, event.ts, bpmByMinute);
      if (sleep) {
        if (draft.start >= (last?.end ?? -Infinity)) {
          sleeps.push(sleep);
          last = { start: draft.start, end: event.ts };
        } else if (last && draft.start <= last.start && event.ts > last.end) {
          sleeps[sleeps.length - 1] = sleep;
          last = { start: draft.start, end: event.ts };
        }
      }
      draft = undefined;
    } else if (draft && SLEEP_STAGES[event.status]) {
      draft.stages.push({ ts: event.ts, stage: SLEEP_STAGES[event.status] });
    }
  }
  // Each summary goes with the segment that ended just before it; a later one for the same segment wins. The copy
  // the watch repeats at the start of a new file follows no segment in it.
  for (const summary of summaries) {
    let index = -1;
    for (let i = sleeps.length - 1; i >= 0; i--) if (seconds(sleeps[i].end) - 60 <= summary.ts) { index = i; break; }
    if (index < 0 || summary.ts - seconds(sleeps[index].end) > SUMMARY_DELAY) continue;
    sleeps[index].score = summary.score;
  }

  // The file begins where the watch's history begins; only that first day can be partial.
  const first = fileStart === undefined ? undefined
    : local(fileStart, minuteHeartRate.find((r) => seconds(r.time) === fileStart)?.utcOffsetMinutes ?? zoneMinutes);
  const totals = new Map<number, { day: CalendarDay; steps: number; calories: number; activeSeconds: number }>();
  for (const slot of slots.values()) {
    const total = totals.get(dayKey(slot.day)) ?? { day: slot.day, steps: 0, calories: 0, activeSeconds: 0 };
    total.steps += slot.steps; total.calories += slot.calories; total.activeSeconds += slot.activeSeconds;
    totals.set(dayKey(slot.day), total);
  }
  history.days = [...totals.values()].map((total) => ({
    day: total.day, steps: total.steps, calories: forecastRound(total.calories / 1000),
    partial: first ? dayKey(first.day) === dayKey(total.day) && first.minuteOfDay > 0 : false, activeSeconds: total.activeSeconds,
  })).sort((a, b) => compareDays(a.day, b.day));
  history.calories.sort((a, b) => a.time.getTime() - b.time.getTime());

  // Each HRV reading's night by binary search (sleeps don't overlap and are in time order).
  const byNight = new Map<number, { sum: number; count: number }>();
  for (const reading of history.hrv) {
    if (reading.rmssd <= 0 || sleeps.length === 0) continue;
    const ts = reading.time.getTime();
    let low = 0, high = sleeps.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (sleeps[middle].start.getTime() <= ts) low = middle; else high = middle - 1;
    }
    const night = sleeps[low];
    if (ts < night.start.getTime() || ts > night.end.getTime()) continue;
    const entry = byNight.get(dayKey(night.day)) ?? { sum: 0, count: 0 };
    entry.sum += reading.rmssd; entry.count += 1;
    byNight.set(dayKey(night.day), entry);
  }
  for (const [key, { sum, count }] of byNight) history.sleepHRV.set(key, Math.trunc(sum / count));

  // One-off readings join after sleep is worked out, which uses the per-minute readings only.
  history.heartRate = [...minuteHeartRate, ...spotHeartRate];
  history.recoveries = [...recoveries.values()].sort((a, b) => a.workoutStart.getTime() - b.workoutStart.getTime());
  history.battery.sort((a, b) => a.time.getTime() - b.time.getTime());
  return history;
}

/** A kind 11/7 record: `07`, its u16 length, then a protobuf with the time (1), UTC offset in seconds (2), percent (3). */
function batteryReading(body: Uint8Array): BatteryReading | undefined {
  const length = u16(body, 1);
  if (3 + length > body.length) return undefined;
  const fields = tryFields(body.subarray(3, 3 + length));
  if (!fields) return undefined;
  const time = varintOf(fields, 1), percent = varintOf(fields, 3);
  if (time === undefined || time < BigInt(MINIMUM_DEVICE_TIME) || time > 0xffffffffn || percent === undefined || percent > 100n) return undefined;
  // Whole quarter hours at most ±18 h, as the zone records; anything else isn't an offset.
  const zone = firstField(fields, 2);
  const offset = (zone && fieldInt32(zone)) ?? 0;
  // Field 7: {1 key, 2 counter, 3 param}.
  const usage: BatteryCounter[] = [];
  for (const entry of fields.filter((f) => f.number === 7)) {
    const bytes = fieldBytes(entry), item = bytes && tryFields(bytes);
    if (!item) continue;
    const key = varintOf(item, 1), value = varintOf(item, 2);
    if (key === undefined || key > 0xffffn || value === undefined || value > 0xffffffffn) continue;
    const param = varintOf(item, 3);
    usage.push(param !== undefined && param <= 0xffffffffn ? { key: Number(key), value: Number(value), param: Number(param) } : { key: Number(key), value: Number(value) });
  }
  return {
    time: at(unix(Number(time))), utcOffsetMinutes: offset % 900 === 0 && Math.abs(offset) <= 18 * 3600 ? Math.trunc(offset / 60) : 0,
    percent: Number(percent), usage,
  };
}

function finishSleep(draft: SleepDraft, endExact: number, heartRate: Map<number, number>): SleepSegment | undefined {
  // A stage change at the end instant has no duration; COROS drops it too.
  const stages = draft.stages.filter((s) => s.ts < endExact);
  if (endExact <= draft.start || endExact - draft.start > MAXIMUM_SLEEP_SECONDS || stages.length === 0) return undefined;
  const start = roundMinute(draft.start), end = roundMinute(endExact);
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
  const rates: number[] = [];
  for (let t = start; t <= end; t += 60) { const bpm = heartRate.get(t); if (bpm !== undefined) rates.push(bpm); }
  return {
    start: at(start), end: at(end), utcOffsetMinutes: draft.zone, day: local(end, draft.zone).day, totalMinutes: Math.trunc((end - start) / 60),
    stageMinutes: {
      awake: forecastRound(stageSeconds.awake / 60), light: forecastRound(stageSeconds.light / 60),
      deep: forecastRound(stageSeconds.deep / 60), rem: forecastRound(stageSeconds.rem / 60),
    },
    awakeCount: ranges.filter((r) => r.stage === "awake").length,
    minHR: rates.length ? Math.min(...rates) : undefined,
    maxHR: rates.length ? Math.max(...rates) : undefined,
    // Floored, as COROS does (64.51 → 64).
    averageHR: rates.length ? Math.trunc(rates.reduce((a, b) => a + b, 0) / rates.length) : undefined,
    ranges,
  };
}

/**
 * The sleep score the watch shows, from its night summary's sub-scores A–J (0–100), combined as the firmware does
 * (PACE Pro W332 3.2008.0): parts (A + B) / 2, C, D, F, G, J; a 0 G or J is left out. Every part over 80: their
 * average. Otherwise the lowest part weighs more, by how low it is and which it is; the others share the rest.
 */
export function sleepScore(subScores: number[]): number | undefined {
  if (subScores.length < 10) return undefined;
  const s = subScores;
  const parts: (number | undefined)[] = [(s[0] + s[1]) / 2, s[2], s[3], s[5], s[6] > 0 ? s[6] : undefined, s[9] > 0 ? s[9] : undefined];
  const valid = parts.flatMap((value, index) => (value === undefined ? [] : [[index, value] as const]));
  if (valid.length < 2) return undefined;
  let minimum = valid[0];
  for (const entry of valid) if (entry[1] < minimum[1]) minimum = entry;
  const [lowest, low] = minimum;
  let weight: number | undefined;
  if (low > 80) weight = undefined;
  else if (lowest === 3 || lowest === 5) weight = low < 20 ? 0.5 : low < 60 ? 0.4 : 0.3;
  else if (lowest === 0 || lowest === 4) weight = low < 20 ? 0.4 : low < 60 ? 0.3 : 0.2;
  else weight = low < 20 ? 0.3 : low < 60 ? 0.2 : undefined;
  const total = valid.reduce((sum, entry) => sum + entry[1], 0);
  const score = weight !== undefined ? weight * low + (1 - weight) * (total - low) / (valid.length - 1) : total / valid.length;
  return Math.floor(score + 0.5);
}

/** Kind 13: heart rate once a second for the 2 minutes after a workout. */
function recoveryCurve(body: Uint8Array): Recovery | undefined {
  const outer = tryFields(body), message = outer && bytesOf(outer, 1);
  const curve = message && tryFields(message);
  if (!curve) return undefined;
  const start = varintOf(curve, 2), end = varintOf(curve, 3), packed = bytesOf(curve, 4);
  if (start === undefined || end === undefined || !packed || end <= start) return undefined;
  const samples = packedVarints(packed)?.map((v) => (v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v)));
  // 0 marks a second without a reading (the sensor briefly lost contact).
  if (!samples || samples.length !== 120 || !samples.every((v) => v === 0 || (v >= 25 && v <= 250))) return undefined;
  return { workoutStart: at(unix(Number(start))), workoutEnd: at(unix(Number(end))), samples };
}
