import type { HealthInsightKind, HealthInsightResult } from "../healthInsightsTypes";
import type { TrainingHubHeartRateRecovery, TrainingHubSleepRecord } from "../types";
import type { LocalHealthCheck, LocalHealthDay, LocalHealthSample, LocalSleepSession, LocalWorkoutRecovery } from "./localDataTypes";

/** The watch's stress levels 1–4, named as COROS names them. */
const STRESS_LEVELS = ["Relaxed", "Low", "Medium", "High"];

/**
 * Training Hub shapes from health data read off the watch. Values come from
 * the watch's own records; COROS-computed scores (sleep score, HRV status,
 * recovery) are left undefined rather than estimated.
 */

const FIVE_MINUTES = 300;

function clock(ts: number, utcOffsetMinutes: number): string {
  const date = new Date((ts + utcOffsetMinutes * 60) * 1000);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function localHour(ts: number, utcOffsetMinutes: number): number {
  return new Date((ts + utcOffsetMinutes * 60) * 1000).getUTCHours();
}

const percent = (minutes: number, of: number) => (of > 0 ? Math.round((minutes / of) * 1000) / 10 : undefined);

/** Same rule the cloud records use: a daytime sleep of up to 2.5 hours is a nap. */
function isNap(session: LocalSleepSession): boolean {
  const hour = localHour(session.startTs, session.utcOffsetMinutes);
  return hour >= 10 && hour <= 18 && session.totalMinutes <= 150;
}

function weightedHr(sessions: LocalSleepSession[]): number | undefined {
  const rated = sessions.filter((session) => session.avgHr !== undefined && session.totalMinutes > 0);
  const minutes = rated.reduce((sum, session) => sum + session.totalMinutes, 0);
  return minutes > 0 ? Math.round(rated.reduce((sum, session) => sum + session.avgHr! * session.totalMinutes, 0) / minutes) : undefined;
}

/** A night's main sleep: the watch's segments (it splits a night where you briefly wake up), naps left out. */
export interface SleepNight {
  /** The local day the night ends on (the morning you wake up), YYYYMMDD. */
  day: string;
  /** Oldest first. */
  segments: LocalSleepSession[];
  /** From the first segment's start to the last one's end. */
  startTs: number;
  endTs: number;
}

/** Each day's main night (when it has one) and naps, newest day first. */
export function sleepDays(sessions: LocalSleepSession[]): Array<{ day: string; night?: SleepNight; naps: LocalSleepSession[] }> {
  const byDay = new Map<string, LocalSleepSession[]>();
  for (const session of sessions) byDay.set(session.day, [...(byDay.get(session.day) ?? []), session]);
  return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, daySessions]) => {
    const ordered = [...daySessions].sort((a, b) => a.startTs - b.startTs);
    const segments = ordered.filter((session) => !isNap(session));
    const night = segments.length ? { day, segments, startTs: segments[0]!.startTs, endTs: segments[segments.length - 1]!.endTs } : undefined;
    return { day, ...(night ? { night } : {}), naps: ordered.filter(isNap) };
  });
}

/**
 * One main record per night plus separate naps. The window runs from the
 * first segment's start to the last one's end; time between segments counts
 * as awake.
 */
export function sleepRecordsFromSessions(sessions: LocalSleepSession[]): TrainingHubSleepRecord[] {
  const records: TrainingHubSleepRecord[] = [];
  for (const { day, night: main, naps } of sleepDays(sessions)) {
    if (main) {
      const night = main.segments;
      const first = night[0]!;
      const last = night[night.length - 1]!;
      const windowMinutes = Math.round((main.endTs - main.startTs) / 60);
      const deepMinutes = night.reduce((sum, session) => sum + session.deepMinutes, 0);
      const lightMinutes = night.reduce((sum, session) => sum + session.lightMinutes, 0);
      const remMinutes = night.reduce((sum, session) => sum + session.remMinutes, 0);
      const totalMinutes = deepMinutes + lightMinutes + remMinutes;
      const awakeMinutes = Math.max(0, windowMinutes - totalMinutes);
      const longAwake = night.reduce((count, session) => count + session.ranges.filter((range) => range.stage === "awake" && range.seconds >= FIVE_MINUTES).length, 0)
        + night.slice(1).filter((session, index) => session.startTs - night[index]!.endTs >= FIVE_MINUTES).length;
      records.push({
        happenDay: day,
        kind: "main",
        completeness: "complete",
        totalMinutes,
        deepMinutes,
        lightMinutes,
        remMinutes,
        awakeMinutes,
        deepPercent: percent(deepMinutes, windowMinutes),
        lightPercent: percent(lightMinutes, windowMinutes),
        remPercent: percent(remMinutes, windowMinutes),
        awakePercent: percent(awakeMinutes, windowMinutes),
        awakeCountOverFiveMinutes: longAwake,
        windowMinutes,
        avgHr: weightedHr(night),
        sleepStart: clock(first.startTs, first.utcOffsetMinutes),
        sleepEnd: clock(last.endTs, last.utcOffsetMinutes)
      });
    }
    for (const nap of naps) {
      const asleep = nap.deepMinutes + nap.lightMinutes + nap.remMinutes;
      records.push({
        happenDay: day,
        kind: "nap",
        completeness: "complete",
        totalMinutes: asleep,
        deepMinutes: nap.deepMinutes,
        lightMinutes: nap.lightMinutes,
        remMinutes: nap.remMinutes,
        awakeMinutes: nap.totalMinutes - asleep,
        windowMinutes: nap.totalMinutes,
        napMinutes: asleep,
        napStart: clock(nap.startTs, nap.utcOffsetMinutes),
        napEnd: clock(nap.endTs, nap.utcOffsetMinutes),
        avgHr: nap.avgHr,
        sleepStart: clock(nap.startTs, nap.utcOffsetMinutes),
        sleepEnd: clock(nap.endTs, nap.utcOffsetMinutes)
      });
    }
  }
  return records;
}

/** The reading at `index`, or the nearest one within five seconds when that second has none (0). */
function readingNear(samples: number[], index: number): number | undefined {
  for (let distance = 0; distance <= 5; distance++) {
    for (const candidate of [index - distance, index + distance]) {
      const bpm = samples[candidate];
      if (bpm !== undefined && bpm > 0) return bpm;
    }
  }
  return undefined;
}

/** Drops after one and two minutes from the watch's 1 Hz recovery curve (120 samples; 0 = no reading). */
export function heartRateRecoveryFrom(recovery: LocalWorkoutRecovery): TrainingHubHeartRateRecovery | undefined {
  const samples = recovery.samples.slice(0, 120);
  if (samples.length < 120) return undefined;
  const startBpm = readingNear(samples, 0);
  const oneMinuteBpm = readingNear(samples, 59);
  const twoMinuteBpm = readingNear(samples, 119);
  if (startBpm === undefined || oneMinuteBpm === undefined || twoMinuteBpm === undefined) return undefined;
  return { startBpm, oneMinuteBpm, twoMinuteBpm, dropOneMinute: startBpm - oneMinuteBpm, dropTwoMinutes: startBpm - twoMinuteBpm, samples };
}

const isoDay = (day: string) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;

/** Insights the watch's own data can answer; everything else stays a COROS cloud feature. */
export function localHealthInsight(
  kind: HealthInsightKind,
  days: number,
  data: { days: LocalHealthDay[]; stress: LocalHealthSample[]; healthChecks?: LocalHealthCheck[] }
): HealthInsightResult {
  const base = { kind, days, fetchedAt: new Date().toISOString() };
  if (kind === "sleepHrv") {
    const points = data.days
      .filter((day) => day.metrics.sleep_hrv)
      .map((day) => ({ time: isoDay(day.day), value: day.metrics.sleep_hrv!.value }))
      .reverse();
    if (!points.length) return { ...base, status: "empty", metrics: [], series: [], message: "No data yet." };
    // Same keys as the COROS reading ("average": each night's average, filed under the day you woke up),
    // so the Sleep HRV card looks the same in both modes. Baseline, normal range and assessment stay out.
    return {
      ...base,
      status: "ready",
      metrics: [{ key: "average", label: "Nightly average", value: points[points.length - 1]!.value, unit: "ms" }],
      series: [{ key: "average", label: "Nightly average", unit: "ms", points }],
      message: "Your watch's average HRV (RMSSD) during sleep. HRV baseline, normal range and status are calculated by COROS and aren't available in Local-Only Mode."
    };
  }
  if (kind === "stress") {
    const points = data.stress.map((sample) => ({ time: new Date(sample.ts * 1000).toISOString(), value: sample.value }));
    if (!points.length) return { ...base, status: "empty", metrics: [], series: [], message: "No data yet." };
    // The card already shows the latest reading and the period's average, low and high from the series.
    return {
      ...base,
      status: "ready",
      metrics: [{ key: "stress", label: "Stress", value: points[points.length - 1]!.value }],
      series: [{ key: "stress", label: "Stress", points }]
    };
  }
  if (kind === "healthCheck") {
    const checks = data.healthChecks ?? [];
    const latest = checks[checks.length - 1];
    if (!latest) return { ...base, status: "empty", metrics: [], series: [], message: "No data yet." };
    // The same keys as the COROS reading, so the card shows its vital tiles. The watch's resting-HR setting stays out.
    const vitals = [
      { key: "heartRate", label: "Heart rate", unit: "bpm", value: (check: LocalHealthCheck) => check.heartRate },
      { key: "hrv", label: "HRV", unit: "ms", value: (check: LocalHealthCheck) => check.hrvMs },
      { key: "stress", label: "Stress", unit: undefined, value: (check: LocalHealthCheck) => check.stress },
      { key: "respiratoryRate", label: "Respiratory rate", unit: "breaths/min", value: (check: LocalHealthCheck) => check.breathingRate },
      { key: "spo2", label: "Blood oxygen", unit: "%", value: (check: LocalHealthCheck) => check.spo2 }
    ];
    const level = STRESS_LEVELS[latest.stressLevel - 1];
    return {
      ...base,
      status: "ready",
      metrics: [
        ...vitals.map((vital) => ({ key: vital.key, label: vital.label, value: vital.value(latest), ...(vital.unit ? { unit: vital.unit } : {}) })),
        ...(level ? [{ key: "level", label: "Stress level", value: level }] : [])
      ],
      series: vitals.map((vital) => ({
        key: vital.key,
        label: vital.label,
        ...(vital.unit ? { unit: vital.unit } : {}),
        points: checks.map((check) => ({ time: new Date(check.ts * 1000).toISOString(), value: vital.value(check) }))
      }))
    };
  }
  return {
    ...base,
    status: "unavailable",
    metrics: [],
    series: [],
    message: "Not available in Local-Only Mode."
  };
}
