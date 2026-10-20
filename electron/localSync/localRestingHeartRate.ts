import type { LocalSleepSession } from "./localDataTypes";
import { sleepDays, type SleepNight } from "./localHealthViews";

/**
 * CorosLink's resting heart rate, from the watch's own heart-rate readings:
 * the lowest 30-minute average during the night's main sleep, filed under the
 * morning you wake up (as Garmin and others describe "lowest 30-minute
 * average"; COROS's own value comes from its server and isn't in the watch's
 * sync data). Rules:
 * - the main sleep as the Training Hub shows it: the night's segments, from
 *   the first one's start to the last one's end, naps left out; at least 3 h
 *   asleep (light, deep and REM), else the day has no value;
 * - the per-minute readings of the watch that recorded the night (one-off
 *   readings, at an exact second, are left out), 30–220 bpm;
 * - a reading at least 10 bpm below the median of the 5 readings on each side
 *   is an optical dropout and is left out;
 * - a 30-minute window counts when it holds at least 80% of the readings the
 *   night's own interval gives it (24 of 30 at one a minute); the lowest
 *   window average, rounded, is the value.
 * With two watches worn the same night, the one with more sleep wins.
 */

export interface HeartRateReading {
  /** Unix seconds. */
  ts: number;
  bpm: number;
}

const WINDOW_SECONDS = 30 * 60;
const MIN_COVERAGE = 0.8;
const MIN_ASLEEP_MINUTES = 180;
const MIN_BPM = 30;
const MAX_BPM = 220;
const DIP_BPM = 10;
const DIP_NEIGHBOURS = 5;

const asleepMinutes = (night: SleepNight) =>
  night.segments.reduce((sum, segment) => sum + segment.lightMinutes + segment.deepMinutes + segment.remMinutes, 0);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The night's resting heart rate in bpm, or undefined when the night or its readings don't allow one. */
export function nightlyRestingHeartRate(night: SleepNight, readings: HeartRateReading[]): number | undefined {
  if (asleepMinutes(night) < MIN_ASLEEP_MINUTES) return undefined;
  const byMinute = new Map<number, number>();
  for (const { ts, bpm } of readings) {
    if (ts % 60 === 0 && ts >= night.startTs && ts <= night.endTs && bpm >= MIN_BPM && bpm <= MAX_BPM) byMinute.set(ts, bpm);
  }
  const plausible = [...byMinute].sort(([a], [b]) => a - b);
  if (plausible.length < 2) return undefined;
  const kept = plausible.filter(([, bpm], index) => {
    const neighbours = [
      ...plausible.slice(Math.max(0, index - DIP_NEIGHBOURS), index),
      ...plausible.slice(index + 1, index + 1 + DIP_NEIGHBOURS)
    ].map(([, value]) => value);
    return neighbours.length < 4 || bpm > median(neighbours) - DIP_BPM;
  });
  // The night's reading interval (whole minutes): a watch set to measure less often still gets a value.
  const gaps = plausible.slice(1).map(([ts], index) => ts - plausible[index]![0]);
  const interval = Math.max(60, Math.round(median(gaps) / 60) * 60);
  const needed = Math.ceil(Math.max(1, Math.floor(WINDOW_SECONDS / interval)) * MIN_COVERAGE);
  let lowest: number | undefined;
  let end = 0;
  let sum = 0;
  for (let start = 0; start < kept.length; start++) {
    const from = kept[start]![0];
    // The window ends inside the night (its last minute no later than the night's end).
    if (from + WINDOW_SECONDS - 60 > night.endTs) break;
    while (end < kept.length && kept[end]![0] < from + WINDOW_SECONDS) sum += kept[end++]![1];
    const count = end - start;
    if (count >= needed && (lowest === undefined || sum / count < lowest)) lowest = sum / count;
    sum -= kept[start]![1];
  }
  return lowest === undefined ? undefined : Math.round(lowest);
}

/** Resting heart rate by wake-up day (YYYYMMDD) for the given sleep segments; `readings` lists one watch's per-minute heart rate in [from, to]. */
export function restingHeartRateByDay(
  sessions: LocalSleepSession[],
  readings: (deviceId: string, from: number, to: number) => HeartRateReading[]
): Map<string, number> {
  const byDevice = new Map<string, LocalSleepSession[]>();
  for (const session of sessions) byDevice.set(session.deviceId, [...(byDevice.get(session.deviceId) ?? []), session]);
  const best = new Map<string, { value: number; asleep: number }>();
  for (const [deviceId, deviceSessions] of byDevice) {
    for (const { night } of sleepDays(deviceSessions)) {
      if (!night) continue;
      const asleep = asleepMinutes(night);
      if (asleep < MIN_ASLEEP_MINUTES || asleep <= (best.get(night.day)?.asleep ?? -1)) continue;
      const value = nightlyRestingHeartRate(night, readings(deviceId, night.startTs, night.endTs));
      if (value !== undefined) best.set(night.day, { value, asleep });
    }
  }
  return new Map([...best].map(([day, { value }]) => [day, value]));
}
