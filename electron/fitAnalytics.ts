import type { FitRecord } from "./fitActivity";

/** Standard durations (seconds) for a power / pace curve. */
export const POWER_CURVE_DURATIONS = [
  1, 5, 10, 15, 20, 30, 60, 120, 180, 300, 480, 600, 900, 1200, 1800, 2700,
  3600, 5400, 7200
] as const;

/** Standard distances (metres) for best-effort pace. */
export const BEST_EFFORT_DISTANCES = [
  400, 800, 1000, 1609.344, 3000, 5000, 10000, 15000, 21097.5, 30000, 42195
] as const;

export interface BestAverage {
  value: number;
  /** Timer second the window starts at. */
  startT: number;
  durationSec: number;
}

export interface BestEffort {
  distanceM: number;
  seconds: number;
  paceSecPerKm: number;
  startT: number;
}

export interface FitSplit {
  index: number;
  /** Metres covered by this split (equal to the split length unless partial). */
  distanceM: number;
  seconds: number;
  paceSecPerKm: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  avgCadence?: number;
  elevGainM: number;
  elevLossM: number;
  partial: boolean;
}

export interface Decoupling {
  metric: "pace" | "power";
  firstHalfRatio: number;
  secondHalfRatio: number;
  /** Positive = output per heartbeat fell in the second half (fatigue/heat). */
  percent: number;
}

export interface RouteSignature {
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  start: [number, number];
  end: [number, number];
  /** Evenly spaced (by distance) [lat, lon] samples. */
  polyline: Array<[number, number]>;
  distanceM: number;
}

export interface SeriesPoint {
  t: number;
  dist?: number;
  alt?: number;
  hr?: number;
  speed?: number;
  power?: number;
  cadence?: number;
}

type NumericKey = "hr" | "speed" | "power" | "cadence" | "alt";

const MAX_FILL_GAP_SEC = 3;

/**
 * Resample a record field onto a 1 Hz timer-time grid. Gaps up to
 * MAX_FILL_GAP_SEC are forward-filled; longer gaps stay NaN so they count as
 * missing coverage rather than zero effort.
 */
export function resampleByTimer(records: FitRecord[], key: NumericKey): Float64Array {
  if (records.length === 0) return new Float64Array(0);
  const length = Math.floor(records[records.length - 1].t) + 1;
  const samples = new Float64Array(length).fill(Number.NaN);
  for (const record of records) {
    const value = record[key];
    if (value === undefined) continue;
    const index = Math.floor(record.t);
    if (index >= 0 && index < length) samples[index] = value;
  }
  let lastValue = Number.NaN;
  let lastIndex = -Infinity;
  for (let index = 0; index < length; index += 1) {
    if (!Number.isNaN(samples[index])) {
      lastValue = samples[index];
      lastIndex = index;
    } else if (index - lastIndex <= MAX_FILL_GAP_SEC) {
      samples[index] = lastValue;
    }
  }
  return samples;
}

/** Best rolling average over `windowSec` with at least `minCoverage` real samples. */
export function bestAverage(
  samples: Float64Array,
  windowSec: number,
  minCoverage = 0.9
): BestAverage | null {
  const window = Math.round(windowSec);
  if (window <= 0 || samples.length < window) return null;
  let sum = 0;
  let missing = 0;
  for (let index = 0; index < window; index += 1) {
    if (Number.isNaN(samples[index])) missing += 1;
    else sum += samples[index];
  }
  let best: BestAverage | null = null;
  const consider = (start: number) => {
    const present = window - missing;
    if (present / window < minCoverage) return;
    const value = sum / present;
    if (!best || value > best.value) {
      best = { value, startT: start, durationSec: window };
    }
  };
  consider(0);
  for (let start = 1; start + window <= samples.length; start += 1) {
    const leaving = samples[start - 1];
    const entering = samples[start + window - 1];
    if (Number.isNaN(leaving)) missing -= 1;
    else sum -= leaving;
    if (Number.isNaN(entering)) missing += 1;
    else sum += entering;
    consider(start);
  }
  return best;
}

export function powerCurve(
  records: FitRecord[],
  durations: readonly number[] = POWER_CURVE_DURATIONS
): Array<{ durationSec: number; watts: number; startT: number }> {
  const samples = resampleByTimer(records, "power");
  if (samples.length === 0) return [];
  const curve: Array<{ durationSec: number; watts: number; startT: number }> = [];
  for (const duration of durations) {
    const best = bestAverage(samples, duration);
    if (best && best.value > 0) {
      curve.push({
        durationSec: duration,
        watts: Math.round(best.value),
        startT: best.startT
      });
    }
  }
  return curve;
}

/** Coggan normalized power: 30 s rolling mean, fourth-power average, fourth root. */
export function normalizedPower(records: FitRecord[]): number | undefined {
  const samples = resampleByTimer(records, "power");
  if (samples.length < 30) return undefined;
  let sum = 0;
  let count = 0;
  let rolling = 0;
  let rollingCount = 0;
  const window = 30;
  for (let index = 0; index < samples.length; index += 1) {
    const entering = Number.isNaN(samples[index]) ? 0 : samples[index];
    rolling += entering;
    rollingCount += 1;
    if (index >= window) {
      const leaving = Number.isNaN(samples[index - window]) ? 0 : samples[index - window];
      rolling -= leaving;
      rollingCount -= 1;
    }
    if (index >= window - 1) {
      const mean = rolling / rollingCount;
      sum += mean ** 4;
      count += 1;
    }
  }
  if (count === 0) return undefined;
  const value = Math.round((sum / count) ** 0.25);
  return value > 0 ? value : undefined;
}

/** Records with a cumulative distance, kept monotonic. */
function distanceTrack(records: FitRecord[]): Array<{ t: number; d: number; ts: number }> {
  const track: Array<{ t: number; d: number; ts: number }> = [];
  let last = -Infinity;
  for (const record of records) {
    if (record.dist === undefined || record.dist < last) continue;
    last = record.dist;
    track.push({ t: record.t, d: record.dist, ts: record.ts });
  }
  return track;
}

/** Timer seconds at which cumulative distance `target` is reached (interpolated). */
export function timeAtDistance(records: FitRecord[], target: number): number | null {
  const track = distanceTrack(records);
  if (track.length === 0 || target > track[track.length - 1].d) return null;
  if (target <= track[0].d) return track[0].t;
  for (let index = 1; index < track.length; index += 1) {
    const prev = track[index - 1];
    const next = track[index];
    if (next.d >= target) {
      const span = next.d - prev.d;
      const ratio = span > 0 ? (target - prev.d) / span : 1;
      return prev.t + (next.t - prev.t) * ratio;
    }
  }
  return null;
}

/** Fastest time to cover each distance anywhere inside the activity. */
export function bestEfforts(
  records: FitRecord[],
  distances: readonly number[] = BEST_EFFORT_DISTANCES
): BestEffort[] {
  const track = distanceTrack(records);
  if (track.length < 2) return [];
  const total = track[track.length - 1].d - track[0].d;
  const efforts: BestEffort[] = [];

  for (const distance of distances) {
    if (distance > total) continue;
    let best: BestEffort | null = null;
    let j = 0;
    for (let i = 0; i < track.length; i += 1) {
      const startD = track[i].d;
      const targetD = startD + distance;
      while (j < track.length && track[j].d < targetD) j += 1;
      if (j >= track.length) break;
      const prev = track[j - 1] ?? track[j];
      const next = track[j];
      const span = next.d - prev.d;
      const ratio = span > 0 ? (targetD - prev.d) / span : 1;
      const endT = prev.t + (next.t - prev.t) * ratio;
      const seconds = endT - track[i].t;
      if (seconds > 0 && (!best || seconds < best.seconds)) {
        best = {
          distanceM: distance,
          seconds,
          paceSecPerKm: (seconds / distance) * 1000,
          startT: track[i].t
        };
      }
    }
    if (best) {
      efforts.push({
        ...best,
        seconds: Math.round(best.seconds * 10) / 10,
        paceSecPerKm: Math.round(best.paceSecPerKm * 10) / 10
      });
    }
  }
  return efforts;
}

/** Smooth altitude with a small moving average before counting gain/loss. */
function smoothAltitude(records: FitRecord[], radius = 2): Array<number | undefined> {
  const values = records.map((record) => record.alt);
  return values.map((_value, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = values[index + offset];
      if (sample !== undefined) {
        sum += sample;
        count += 1;
      }
    }
    return count > 0 ? sum / count : undefined;
  });
}

/** Gain/loss with a hysteresis threshold so barometer noise does not accumulate. */
export function elevationGainLoss(
  altitudes: Array<number | undefined>,
  thresholdM = 3
): { gain: number; loss: number } {
  let reference: number | undefined;
  let gain = 0;
  let loss = 0;
  for (const alt of altitudes) {
    if (alt === undefined) continue;
    if (reference === undefined) {
      reference = alt;
      continue;
    }
    const delta = alt - reference;
    if (delta >= thresholdM) {
      gain += delta;
      reference = alt;
    } else if (delta <= -thresholdM) {
      loss -= delta;
      reference = alt;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Per-distance splits (km or mile) with HR, power, cadence, and elevation. */
export function computeSplits(records: FitRecord[], splitM: number): FitSplit[] {
  const smoothed = smoothAltitude(records);
  const splits: FitSplit[] = [];
  let splitStartT = records[0]?.t ?? 0;
  let splitStartD = records[0]?.dist ?? 0;
  let boundary = splitStartD + splitM;
  let bucket: number[] = [];
  let hrs: number[] = [];
  let powers: number[] = [];
  let cadences: number[] = [];
  let altitudes: Array<number | undefined> = [];
  let prev: FitRecord | undefined;

  const flush = (endT: number, endD: number, partial: boolean) => {
    const distance = endD - splitStartD;
    const seconds = endT - splitStartT;
    if (distance <= 0 || seconds <= 0) return;
    const { gain, loss } = elevationGainLoss(altitudes);
    splits.push({
      index: splits.length + 1,
      distanceM: Math.round(distance),
      seconds: Math.round(seconds * 10) / 10,
      paceSecPerKm: Math.round(((seconds / distance) * 1000) * 10) / 10,
      avgHr: mean(hrs) !== undefined ? Math.round(mean(hrs) as number) : undefined,
      maxHr: hrs.length ? Math.max(...hrs) : undefined,
      avgPower: mean(powers) !== undefined ? Math.round(mean(powers) as number) : undefined,
      avgCadence:
        mean(cadences) !== undefined ? Math.round(mean(cadences) as number) : undefined,
      elevGainM: gain,
      elevLossM: loss,
      partial
    });
    bucket = [];
    hrs = [];
    powers = [];
    cadences = [];
    altitudes = [];
  };

  records.forEach((record, index) => {
    if (record.dist === undefined) return;
    while (record.dist >= boundary && prev && prev.dist !== undefined) {
      const span = record.dist - prev.dist;
      const ratio = span > 0 ? (boundary - prev.dist) / span : 1;
      const crossT = prev.t + (record.t - prev.t) * ratio;
      flush(crossT, boundary, false);
      splitStartT = crossT;
      splitStartD = boundary;
      boundary += splitM;
    }
    bucket.push(record.t);
    if (record.hr !== undefined) hrs.push(record.hr);
    if (record.power !== undefined) powers.push(record.power);
    if (record.cadence !== undefined) cadences.push(record.cadence);
    altitudes.push(smoothed[index]);
    prev = record;
  });

  if (prev && prev.dist !== undefined && prev.dist - splitStartD >= splitM * 0.05) {
    flush(prev.t, prev.dist, true);
  }
  return splits;
}

/** Aerobic decoupling (Pa:HR or Pw:HR) between the two halves of moving time. */
export function decoupling(records: FitRecord[]): Decoupling | undefined {
  const usable = records.filter(
    (record) =>
      record.hr !== undefined &&
      record.hr > 0 &&
      ((record.power !== undefined && record.power > 0) ||
        (record.speed !== undefined && record.speed > 0))
  );
  if (usable.length < 600) return undefined; // need ~10 min of data
  const powerCount = usable.filter((record) => record.power !== undefined).length;
  const metric: Decoupling["metric"] =
    powerCount / usable.length > 0.8 ? "power" : "pace";
  const midT = (usable[0].t + usable[usable.length - 1].t) / 2;
  const half = (predicate: (record: FitRecord) => boolean) => {
    const part = usable.filter(predicate);
    const output = mean(
      part
        .map((record) => (metric === "power" ? record.power : record.speed))
        .filter((value): value is number => value !== undefined)
    );
    const hr = mean(part.map((record) => record.hr as number));
    return output !== undefined && hr ? output / hr : undefined;
  };
  const first = half((record) => record.t < midT);
  const second = half((record) => record.t >= midT);
  if (first === undefined || second === undefined || first <= 0) return undefined;
  return {
    metric,
    firstHalfRatio: Math.round(first * 10000) / 10000,
    secondHalfRatio: Math.round(second * 10000) / 10000,
    percent: Math.round(((first - second) / first) * 1000) / 10
  };
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** Compact GPS fingerprint used to find repeat routes. */
export function routeSignature(
  records: FitRecord[],
  samples = 64
): RouteSignature | undefined {
  const gps = records.filter(
    (record) => record.lat !== undefined && record.lon !== undefined
  );
  if (gps.length < 10) return undefined;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const record of gps) {
    minLat = Math.min(minLat, record.lat as number);
    maxLat = Math.max(maxLat, record.lat as number);
    minLon = Math.min(minLon, record.lon as number);
    maxLon = Math.max(maxLon, record.lon as number);
  }
  // Sample evenly by cumulative distance when available, else by index.
  const withDist = gps.filter((record) => record.dist !== undefined);
  const polyline: Array<[number, number]> = [];
  if (withDist.length >= 10) {
    const startD = withDist[0].dist as number;
    const endD = withDist[withDist.length - 1].dist as number;
    const span = endD - startD;
    let cursor = 0;
    for (let index = 0; index < samples; index += 1) {
      const target = startD + (span * index) / (samples - 1);
      while (cursor < withDist.length - 1 && (withDist[cursor].dist as number) < target) {
        cursor += 1;
      }
      polyline.push([withDist[cursor].lat as number, withDist[cursor].lon as number]);
    }
  } else {
    for (let index = 0; index < samples; index += 1) {
      const record = gps[Math.round(((gps.length - 1) * index) / (samples - 1))];
      polyline.push([record.lat as number, record.lon as number]);
    }
  }
  const last = gps[gps.length - 1];
  return {
    bbox: { minLat, maxLat, minLon, maxLon },
    start: [gps[0].lat as number, gps[0].lon as number],
    end: [last.lat as number, last.lon as number],
    polyline,
    distanceM: Math.round(
      (withDist.length
        ? (withDist[withDist.length - 1].dist as number) - (withDist[0].dist as number)
        : 0)
    )
  };
}

/**
 * 0..1 similarity between two route signatures: mean distance between
 * corresponding polyline samples (either direction), penalised when the
 * total distances differ by more than a quarter.
 */
export function routeSimilarity(a: RouteSignature, b: RouteSignature): number {
  const count = Math.min(a.polyline.length, b.polyline.length);
  if (count < 4) return 0;
  const meanDistance = (reversed: boolean) => {
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const [lat1, lon1] = a.polyline[index];
      const [lat2, lon2] = b.polyline[reversed ? count - 1 - index : index];
      total += haversineMeters(lat1, lon1, lat2, lon2);
    }
    return total / count;
  };
  const best = Math.min(meanDistance(false), meanDistance(true));
  let score = Math.max(0, 1 - best / 400);
  const longer = Math.max(a.distanceM, b.distanceM);
  const shorter = Math.min(a.distanceM, b.distanceM);
  if (longer > 0 && shorter / longer < 0.75) score *= 0.5;
  return Math.round(score * 100) / 100;
}

/** Bucket-average records onto at most `maxPoints` timer-time samples. */
export function downsampleSeries(records: FitRecord[], maxPoints = 400): SeriesPoint[] {
  if (records.length === 0) return [];
  if (records.length <= maxPoints) {
    return records.map((record) => ({
      t: Math.round(record.t),
      dist: record.dist !== undefined ? Math.round(record.dist) : undefined,
      alt: record.alt !== undefined ? Math.round(record.alt * 10) / 10 : undefined,
      hr: record.hr,
      speed: record.speed !== undefined ? Math.round(record.speed * 100) / 100 : undefined,
      power: record.power,
      cadence: record.cadence
    }));
  }
  const bucketSize = records.length / maxPoints;
  const points: SeriesPoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const start = Math.floor(index * bucketSize);
    const end = Math.min(records.length, Math.floor((index + 1) * bucketSize));
    const bucket = records.slice(start, end);
    if (bucket.length === 0) continue;
    const last = bucket[bucket.length - 1];
    const avg = (key: NumericKey) =>
      mean(bucket.map((record) => record[key]).filter((value): value is number => value !== undefined));
    const hr = avg("hr");
    const speed = avg("speed");
    const power = avg("power");
    const cadence = avg("cadence");
    points.push({
      t: Math.round(last.t),
      dist: last.dist !== undefined ? Math.round(last.dist) : undefined,
      alt: last.alt !== undefined ? Math.round(last.alt * 10) / 10 : undefined,
      hr: hr !== undefined ? Math.round(hr) : undefined,
      speed: speed !== undefined ? Math.round(speed * 100) / 100 : undefined,
      power: power !== undefined ? Math.round(power) : undefined,
      cadence: cadence !== undefined ? Math.round(cadence) : undefined
    });
  }
  return points;
}
