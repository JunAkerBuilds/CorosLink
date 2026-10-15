/**
 * Per-second activity channels from the COROS Training Hub detail payload.
 *
 * `/activity/detail/query` already ships everything a channel chart needs, so
 * no FIT download is involved: `frequencyList` is a 1 Hz sample list,
 * `pauseList` the timer stops, `lapList` the splits and workout steps, and
 * `zoneList` COROS's own time-in-zone totals. Units seen on PACE Pro payloads
 * (2026-10, metric account):
 *
 *   timestamp            epoch centiseconds
 *   distance             centimetres
 *   speed                s/km (run, walk), s/100 m (swim), km/h × 100 (bike)
 *   adjustedPace         s/km (grade-adjusted pace)
 *   heart, cadence       bpm, steps (or revolutions) per minute
 *   power                W
 *   cadenceLength        cm (stride length)
 *   groundTime           ms
 *   verticalVibration    mm (vertical oscillation)
 *   verticalStrideRatio  % × 10
 *   altitude, slope      m, %
 *   gpsLat, gpsLon       degrees × 1e7
 *
 * Kept free of React and app imports so `scripts/test-activity-streams.mjs`
 * can load it under Node's strip-types.
 */

export type StreamChannelKey =
  | "pace"
  | "gap"
  | "hr"
  | "cadence"
  | "power"
  | "stride"
  | "gct"
  | "vo"
  | "vr"
  | "elevation"
  | "grade";

/** Picker and lane order. */
export const STREAM_CHANNEL_ORDER: readonly StreamChannelKey[] = [
  "pace",
  "gap",
  "hr",
  "cadence",
  "power",
  "stride",
  "gct",
  "vo",
  "vr",
  "elevation",
  "grade"
];

/**
 * What the "pace" channel holds: s/km, s/100 m for swims, or km/h for rides.
 * Every other channel has one fixed unit (see the table above, after scaling).
 */
export type StreamSpeedKind = "pace" | "swimPace" | "speed";

export type StreamLapKind = "lap" | "warmup" | "work" | "recovery" | "cooldown";

export interface StreamLap {
  index: number;
  kind: StreamLapKind;
  /** Sample index range, inclusive. */
  from: number;
  to: number;
}

export interface StreamPause {
  /** Sample index the timer resumed at. */
  index: number;
  seconds: number;
}

export interface StreamZone {
  /** 0-based zone number as COROS sends it (shown as Z1…). */
  index: number;
  seconds: number;
  /** 0–1 share of the summed zone time. */
  share: number;
  /**
   * Zone entry bound and the next zone's bound, in channel units (bpm, s/km).
   * Undefined for the open-ended first and last zones.
   */
  start?: number;
  end?: number;
}

export interface StreamZoneDistribution {
  kind: "hr" | "pace";
  zones: StreamZone[];
}

export interface ActivityStreams {
  length: number;
  /** Moving seconds since the start, pauses removed. Non-decreasing. */
  t: Float64Array;
  /** Cumulative metres, forward-filled. Non-decreasing. */
  d: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Canonical units (see StreamSpeedKind for "pace"); NaN = no sample. */
  channels: Partial<Record<StreamChannelKey, Float64Array>>;
  speedKind: StreamSpeedKind;
  hasDistance: boolean;
  hasGps: boolean;
  /** True when laps carry warm-up / work / recovery / cool-down steps. */
  structured: boolean;
  laps: StreamLap[];
  pauses: StreamPause[];
  zones: { hr?: StreamZoneDistribution; pace?: StreamZoneDistribution };
}

export interface StreamParseOptions {
  cycling?: boolean;
  swim?: boolean;
}

type RawRecord = Record<string, unknown>;

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): RawRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : undefined;
}

function asRecords(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is RawRecord => item !== undefined)
    : [];
}

/** First index whose value is >= target in a non-decreasing array. */
export function lowerBound(values: Float64Array, target: number, from = 0, to = values.length - 1): number {
  let low = from;
  let high = to + 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.min(low, to);
}

/** Index whose value is closest to target in a non-decreasing array. */
export function nearestIndex(values: Float64Array, target: number, from = 0, to = values.length - 1): number {
  const index = lowerBound(values, target, from, to);
  if (index > from && Math.abs(values[index - 1]! - target) <= Math.abs(values[index]! - target)) {
    return index - 1;
  }
  return index;
}

interface PauseSpan {
  start: number;
  end: number;
  /** Paused centiseconds accumulated before this pause began. */
  before: number;
}

function parsePauses(raw: RawRecord): PauseSpan[] {
  const spans = asRecords(raw.pauseList)
    .map((pause) => {
      const start = toNumber(pause.startTimestamp);
      const end = toNumber(pause.endTimestamp);
      return start !== undefined && end !== undefined && end > start ? { start, end, before: 0 } : undefined;
    })
    .filter((span): span is PauseSpan => span !== undefined)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  for (const span of spans) {
    span.before = total;
    total += span.end - span.start;
  }
  return spans;
}

/** Moving seconds at an epoch-centisecond timestamp. */
function movingSecondsAt(timestamp: number, origin: number, pauses: PauseSpan[]): number {
  let low = 0;
  let high = pauses.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (pauses[mid]!.start <= timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const pause = pauses[low - 1];
  const paused = pause ? pause.before + Math.min(timestamp, pause.end) - pause.start : 0;
  return Math.max(0, (timestamp - origin - paused) / 100);
}

type SampleReader = (sample: RawRecord) => number;

function positive(value: unknown, scale = 1): number {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed / scale : Number.NaN;
}

function finite(value: unknown): number {
  return toNumber(value) ?? Number.NaN;
}

function channelReaders(speedKind: StreamSpeedKind): Record<StreamChannelKey, SampleReader> {
  return {
    // A stopped bike is a real 0 km/h; a stopped runner has no pace at all.
    pace: (sample) => {
      if (speedKind !== "speed") return positive(sample.speed);
      const value = toNumber(sample.speed);
      return value !== undefined && value >= 0 ? value / 100 : Number.NaN;
    },
    gap: (sample) => positive(sample.adjustedPace),
    hr: (sample) => positive(sample.heart),
    cadence: (sample) => positive(sample.cadence),
    // Zero watts is real (coasting, standing); a missing key is not.
    power: (sample) => {
      const value = toNumber(sample.power);
      return value !== undefined && value >= 0 ? value : Number.NaN;
    },
    stride: (sample) => positive(sample.cadenceLength, 100),
    gct: (sample) => positive(sample.groundTime),
    vo: (sample) => positive(sample.verticalVibration, 10),
    vr: (sample) => positive(sample.verticalStrideRatio, 10),
    elevation: (sample) => finite(sample.altitude),
    grade: (sample) => finite(sample.slope)
  };
}

function resolveSpeedKind(raw: RawRecord, options: StreamParseOptions): StreamSpeedKind {
  if (options.swim) {
    return "swimPace";
  }
  if (options.cycling) {
    return "speed";
  }
  // Other sports: COROS marks pace graphs "lower is better" (orderType 2).
  const speedGraph = asRecords(raw.graphList).find((graph) => graph.key === "speed");
  const orderType = toNumber(asRecord(speedGraph?.graphItem)?.orderType);
  return orderType === 0 ? "speed" : "pace";
}

/**
 * Standing still (traffic lights, the seconds either side of an auto-pause)
 * reads as pace tending to infinity. Blank those samples so the line breaks
 * instead of plunging to the floor and stretching the axis.
 */
function dropStoppedPace(values: Float64Array): void {
  const finiteValues = Array.from(values).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (finiteValues.length < 10) return;
  const median = finiteValues[Math.floor(finiteValues.length / 2)]!;
  const limit = Math.max(900, median * 2.5);
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]! > limit) values[index] = Number.NaN;
  }
}

/** Terrain is continuous: bridge missing altitude samples linearly (and hold at the ends). */
function fillElevationGaps(values: Float64Array): void {
  let previous = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]!)) continue;
    if (previous === -1) {
      values.fill(values[index]!, 0, index);
    } else if (index - previous > 1) {
      const from = values[previous]!;
      const step = (values[index]! - from) / (index - previous);
      for (let gap = previous + 1; gap < index; gap += 1) values[gap] = from + step * (gap - previous);
    }
    previous = index;
  }
  if (previous !== -1) values.fill(values[previous]!, previous + 1);
}

function isUsableChannel(key: StreamChannelKey, values: Float64Array): boolean {
  let count = 0;
  let nonZero = 0;
  for (const value of values) {
    if (Number.isFinite(value)) {
      count += 1;
      if (value !== 0) nonZero += 1;
    }
  }
  const minimum = Math.max(10, Math.floor(values.length * 0.05));
  // Elevation and grade can legitimately sit at zero all session.
  return count >= minimum && (key === "elevation" || key === "grade" || nonZero > 0);
}

const LAP_KINDS: Record<number, StreamLapKind> = {
  1: "warmup",
  2: "work",
  3: "cooldown",
  4: "recovery"
};

function parseLaps(
  raw: RawRecord,
  t: Float64Array,
  origin: number,
  pauses: PauseSpan[]
): { laps: StreamLap[]; structured: boolean } {
  const groups = asRecords(raw.lapList)
    .filter((group) => toNumber(group.type) !== -1)
    .map((group) => ({
      type: toNumber(group.type),
      items: asRecords(group.lapItemList).filter(
        (item) => toNumber(item.startTimestamp) !== undefined && toNumber(item.endTimestamp) !== undefined
      )
    }))
    .filter((group) => group.items.length >= 2);
  // Device laps (type 2) carry workout steps; otherwise take the densest split set.
  const chosen =
    groups.find((group) => group.type === 2) ??
    [...groups].sort((left, right) => right.items.length - left.items.length)[0];
  if (!chosen || t.length === 0) {
    return { laps: [], structured: false };
  }

  // A programmed steady run tags every split "work"; only mixed steps make a structured session.
  const stepKinds = new Set(chosen.items.map((item) => LAP_KINDS[toNumber(item.exerciseType) ?? 0] ?? "lap"));
  const structured = stepKinds.has("work") && stepKinds.size > 1;
  const laps: StreamLap[] = [];
  for (const item of chosen.items) {
    const startT = movingSecondsAt(toNumber(item.startTimestamp)!, origin, pauses);
    const endT = movingSecondsAt(toNumber(item.endTimestamp)!, origin, pauses);
    const from = lowerBound(t, startT);
    let to = lowerBound(t, endT);
    if (t[to]! > endT && to > from) to -= 1;
    if (to <= from) continue;
    laps.push({
      index: laps.length + 1,
      kind: structured ? LAP_KINDS[toNumber(item.exerciseType) ?? 0] ?? "lap" : "lap",
      from,
      to
    });
  }
  return { laps: laps.length >= 2 ? laps : [], structured: structured && laps.length >= 2 };
}

function parseZones(raw: RawRecord, speedKind: StreamSpeedKind): ActivityStreams["zones"] {
  const zones: ActivityStreams["zones"] = {};
  for (const group of asRecords(raw.zoneList)) {
    const type = toNumber(group.type);
    const kind = type === 126 ? "hr" : type === 130 && speedKind === "pace" ? "pace" : undefined;
    if (!kind) continue;
    const items = asRecords(group.zoneItemList)
      .map((item) => ({
        index: toNumber(item.zoneIndex) ?? 0,
        seconds: Math.max(0, toNumber(item.second) ?? 0),
        left: toNumber(item.leftScope)
      }))
      .sort((left, right) => left.index - right.index);
    const total = items.reduce((sum, item) => sum + item.seconds, 0);
    if (items.length < 2 || total <= 0) continue;
    // COROS repeats zone 2's leftScope on zone 1, so each zone's real bounds are
    // its own leftScope (from zone 2 on) and the next zone's leftScope.
    const scale = kind === "pace" ? 1000 : 1;
    const bound = (value: number | undefined) => (value === undefined ? undefined : value / scale);
    zones[kind] = {
      kind,
      zones: items.map((item, position) => {
        const next = items[position + 1];
        const nextStart = bound(next?.left);
        return {
          index: item.index,
          seconds: item.seconds,
          share: item.seconds / total,
          start: position === 0 ? undefined : bound(item.left),
          end: next ? (kind === "hr" && nextStart !== undefined ? nextStart - 1 : nextStart) : undefined
        };
      })
    };
  }
  return zones;
}

/** COROS's own time-in-zone totals; present even when the samples are not. */
export function parseActivityZones(
  raw: Record<string, unknown> | undefined,
  options: StreamParseOptions = {}
): ActivityStreams["zones"] {
  return raw ? parseZones(raw, resolveSpeedKind(raw, options)) : {};
}

/** Parse the detail payload; null when it has no usable per-second samples. */
export function parseActivityStreams(
  raw: Record<string, unknown> | undefined,
  options: StreamParseOptions = {}
): ActivityStreams | null {
  if (!raw) return null;
  const samples = asRecords(raw.frequencyList);
  if (samples.length < 10) return null;

  const length = samples.length;
  const speedKind = resolveSpeedKind(raw, options);
  const pauses = parsePauses(raw);
  const firstStamp = toNumber(samples[0]!.timestamp);
  const summaryStart = toNumber(asRecord(raw.summary)?.startTimestamp);
  // The summary start is the timer start; trust it only when it sits just before the first sample.
  const origin =
    firstStamp === undefined
      ? 0
      : summaryStart !== undefined && summaryStart <= firstStamp && firstStamp - summaryStart < 360_000
        ? summaryStart
        : firstStamp;

  const t = new Float64Array(length);
  const d = new Float64Array(length);
  const lat = new Float64Array(length);
  const lon = new Float64Array(length);
  const readers = channelReaders(speedKind);
  const columns = Object.fromEntries(
    STREAM_CHANNEL_ORDER.map((key) => [key, new Float64Array(length)])
  ) as Record<StreamChannelKey, Float64Array>;

  let lastDistance = 0;
  let gpsCount = 0;
  for (let index = 0; index < length; index += 1) {
    const sample = samples[index]!;
    const stamp = toNumber(sample.timestamp);
    const moving = stamp === undefined || firstStamp === undefined ? index : movingSecondsAt(stamp, origin, pauses);
    t[index] = index > 0 ? Math.max(moving, t[index - 1]!) : moving;

    const distance = toNumber(sample.distance);
    if (distance !== undefined && distance >= 0) {
      lastDistance = Math.max(lastDistance, distance / 100);
    }
    d[index] = lastDistance;

    const latitude = toNumber(sample.gpsLat);
    const longitude = toNumber(sample.gpsLon);
    if (latitude && longitude && Math.abs(latitude) <= 900_000_000 && Math.abs(longitude) <= 1_800_000_000) {
      lat[index] = latitude / 1e7;
      lon[index] = longitude / 1e7;
      gpsCount += 1;
    } else {
      lat[index] = Number.NaN;
      lon[index] = Number.NaN;
    }

    for (const key of STREAM_CHANNEL_ORDER) {
      columns[key][index] = readers[key](sample);
    }
  }

  if (speedKind !== "speed") {
    dropStoppedPace(columns.pace);
  }
  dropStoppedPace(columns.gap);
  const channels: ActivityStreams["channels"] = {};
  for (const key of STREAM_CHANNEL_ORDER) {
    if (isUsableChannel(key, columns[key])) {
      channels[key] = columns[key];
    }
  }
  if (channels.elevation) fillElevationGaps(channels.elevation);
  if (Object.keys(channels).length === 0) return null;

  const { laps, structured } = parseLaps(raw, t, origin, pauses);
  const streamPauses: StreamPause[] = [];
  for (const pause of pauses) {
    const resumedAt = movingSecondsAt(pause.end, origin, pauses);
    const index = lowerBound(t, resumedAt);
    if (index > 0 && index < length - 1) {
      streamPauses.push({ index, seconds: (pause.end - pause.start) / 100 });
    }
  }

  return {
    length,
    t,
    d,
    lat,
    lon,
    channels,
    speedKind,
    hasDistance: lastDistance > 50,
    hasGps: gpsCount >= 2,
    structured,
    laps,
    pauses: streamPauses,
    zones: parseZones(raw, speedKind)
  };
}

/**
 * Centered moving average over `windowSeconds` of moving time, skipping gaps.
 * `inverse` averages in the reciprocal domain, so pace smooths as speed does
 * (a 20 s stop does not drag a 4:30 /km stretch out to 9:00).
 */
export function smoothSeries(
  t: Float64Array,
  values: Float64Array,
  windowSeconds: number,
  inverse = false
): Float64Array {
  if (windowSeconds <= 0) return values;
  const length = values.length;
  const result = new Float64Array(length);
  const half = windowSeconds / 2;
  let head = 0;
  let tail = 0;
  let sum = 0;
  let count = 0;
  const contribution = (value: number) => (inverse ? 1 / value : value);
  for (let index = 0; index < length; index += 1) {
    const centre = t[index]!;
    while (head < length && t[head]! <= centre + half) {
      const value = values[head]!;
      if (Number.isFinite(value) && (!inverse || value > 0)) {
        sum += contribution(value);
        count += 1;
      }
      head += 1;
    }
    while (tail < head && t[tail]! < centre - half) {
      const value = values[tail]!;
      if (Number.isFinite(value) && (!inverse || value > 0)) {
        sum -= contribution(value);
        count -= 1;
      }
      tail += 1;
    }
    result[index] = count > 0 ? (inverse ? count / sum : sum / count) : Number.NaN;
  }
  return result;
}

/** Quantile-trimmed [low, high] of the finite values in [from, to]. */
export function robustExtent(
  values: Float64Array,
  from: number,
  to: number,
  lowQuantile = 0.01,
  highQuantile = 0.99
): [number, number] | null {
  const picked: number[] = [];
  for (let index = from; index <= to; index += 1) {
    const value = values[index]!;
    if (Number.isFinite(value)) picked.push(value);
  }
  if (picked.length === 0) return null;
  picked.sort((left, right) => left - right);
  const at = (quantile: number) =>
    picked[Math.min(picked.length - 1, Math.max(0, Math.round(quantile * (picked.length - 1))))]!;
  return [at(lowQuantile), at(highQuantile)];
}

const DEFAULT_STEPS = [1, 2, 2.5, 5, 10];

/**
 * "Nice" tick values covering [min, max]. `steps` lists allowed step sizes
 * (e.g. clock-friendly seconds); otherwise 1/2/2.5/5 × 10^n.
 */
export function niceTicks(min: number, max: number, target: number, steps?: readonly number[]): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || target < 1) {
    return Number.isFinite(min) ? [min] : [];
  }
  const raw = (max - min) / target;
  let step: number;
  if (steps?.length) {
    step = steps.find((candidate) => candidate >= raw) ?? steps[steps.length - 1]!;
    while ((max - min) / step > target * 2.5) step *= 2;
  } else {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    step = (DEFAULT_STEPS.find((candidate) => candidate * magnitude >= raw) ?? 10) * magnitude;
  }
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let value = first; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

export interface StreamRangeSummary {
  from: number;
  to: number;
  seconds: number;
  meters: number;
  /** Range averages in canonical units ("pace" honours speedKind). */
  averages: Partial<Record<StreamChannelKey, number>>;
  maxima: Partial<Record<StreamChannelKey, number>>;
  elevationGain?: number;
  elevationLoss?: number;
}

/** Ascent and descent with a hysteresis band, so 1 m barometer jitter does not count as climbing. */
export function elevationChange(
  values: Float64Array,
  from: number,
  to: number,
  threshold = 2
): { gain: number; loss: number } | null {
  let reference = Number.NaN;
  let gain = 0;
  let loss = 0;
  for (let index = from; index <= to; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    if (!Number.isFinite(reference)) {
      reference = value;
    } else if (value - reference >= threshold) {
      gain += value - reference;
      reference = value;
    } else if (reference - value >= threshold) {
      loss += reference - value;
      reference = value;
    }
  }
  return Number.isFinite(reference) ? { gain, loss } : null;
}

const PACE_LIKE = new Set<StreamChannelKey>(["pace", "gap"]);

/** Averages and peaks over the sample range [from, to] (raw, unsmoothed samples). */
export function summarizeRange(streams: ActivityStreams, from: number, to: number): StreamRangeSummary {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(streams.length - 1, Math.max(from, to));
  const seconds = streams.t[end]! - streams.t[start]!;
  const meters = streams.d[end]! - streams.d[start]!;
  const averages: StreamRangeSummary["averages"] = {};
  const maxima: StreamRangeSummary["maxima"] = {};

  for (const key of STREAM_CHANNEL_ORDER) {
    const values = streams.channels[key];
    if (!values) continue;
    const paceLike = PACE_LIKE.has(key) && (key === "gap" || streams.speedKind !== "speed");
    let sum = 0;
    let count = 0;
    let peak = Number.NaN;
    for (let index = start; index <= end; index += 1) {
      const value = values[index]!;
      if (!Number.isFinite(value)) continue;
      if (paceLike) {
        if (value <= 0) continue;
        sum += 1 / value;
        if (!(value >= peak)) peak = value; // fastest = lowest pace
      } else {
        sum += value;
        if (!(value <= peak)) peak = value;
      }
      count += 1;
    }
    if (count === 0) continue;
    averages[key] = paceLike ? count / sum : sum / count;
    maxima[key] = peak;
  }

  // Whole-range pace is distance over moving time, which is what the watch reports.
  if (streams.channels.pace && streams.hasDistance && meters > 0 && seconds > 0) {
    averages.pace =
      streams.speedKind === "speed"
        ? (meters / seconds) * 3.6
        : streams.speedKind === "swimPace"
          ? (seconds / meters) * 100
          : (seconds / meters) * 1000;
  }

  const elevation = streams.channels.elevation
    ? elevationChange(streams.channels.elevation, start, end)
    : null;
  return {
    from: start,
    to: end,
    seconds,
    meters,
    averages,
    maxima,
    elevationGain: elevation?.gain,
    elevationLoss: elevation?.loss
  };
}
