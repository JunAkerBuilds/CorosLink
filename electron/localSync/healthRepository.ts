import type Database from "better-sqlite3";
import type { LocalHealthCheck, LocalHealthDay, LocalHealthMetric, LocalHealthSample, LocalSleepSession, LocalWorkoutRecovery } from "./localDataTypes";

/**
 * Normalised health measurements and per-day summaries. Samples keep their
 * original granularity and provenance; summaries are derived and record the
 * method used, so a locally computed value is never mistaken for a COROS
 * score.
 */

/** Local calendar day key (YYYYMMDD) for a unix-seconds timestamp. */
export function localDayKey(unixSeconds: number, utcOffsetMinutes?: number): string {
  const date = utcOffsetMinutes === undefined
    ? new Date(unixSeconds * 1000)
    : new Date((unixSeconds + utcOffsetMinutes * 60) * 1000);
  const year = utcOffsetMinutes === undefined ? date.getFullYear() : date.getUTCFullYear();
  const month = (utcOffsetMinutes === undefined ? date.getMonth() : date.getUTCMonth()) + 1;
  const day = utcOffsetMinutes === undefined ? date.getDate() : date.getUTCDate();
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

export class HealthRepository {
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {}

  insertSamples(samples: LocalHealthSample[]): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO local_health_samples
         (device_id, metric, ts, value, unit, validity, source, provenance, utc_offset_minutes, recorded_at)
       VALUES (@deviceId, @metric, @ts, @value, @unit, @validity, @source, @provenance, @utcOffsetMinutes, @recordedAt)`
    );
    const recordedAt = this.now().toISOString();
    let inserted = 0;
    this.db.transaction(() => {
      for (const sample of samples) {
        if (!Number.isFinite(sample.value) || !Number.isSafeInteger(sample.ts)) continue;
        inserted += insert.run({
          ...sample,
          validity: sample.validity ?? "valid",
          utcOffsetMinutes: sample.utcOffsetMinutes ?? null,
          recordedAt
        }).changes;
      }
    })();
    return inserted;
  }

  /**
   * Running day totals (steps, distance, calories, active time) only grow
   * during a day, so the day's value is the largest total the watch reported.
   */
  recordDayTotals(deviceId: string, day: string, totals: Partial<Record<LocalHealthMetric, { value: number; unit: string }>>): void {
    if (!/^\d{8}$/.test(day)) throw new Error("Invalid health day.");
    const upsert = this.db.prepare(
      `INSERT INTO local_health_summaries (day, metric, device_id, value, unit, method, computed_at)
       VALUES (@day, @metric, @deviceId, @value, @unit, 'watch-day-total', @computedAt)
       ON CONFLICT(day, metric, device_id) DO UPDATE SET
         value = MAX(local_health_summaries.value, excluded.value),
         unit = excluded.unit, computed_at = excluded.computed_at`
    );
    const computedAt = this.now().toISOString();
    this.db.transaction(() => {
      for (const [metric, total] of Object.entries(totals)) {
        if (!total || !Number.isFinite(total.value) || total.value < 0) continue;
        upsert.run({ day, metric, deviceId, value: total.value, unit: total.unit, computedAt });
      }
    })();
  }

  /** A derived per-day value that is replaced, not maximised, when recomputed (e.g. average sleep HRV). */
  recordDayValue(deviceId: string, day: string, metric: LocalHealthMetric, value: number, unit: string, method: string): void {
    if (!/^\d{8}$/.test(day)) throw new Error("Invalid health day.");
    if (!Number.isFinite(value)) return;
    this.db.prepare(
      `INSERT INTO local_health_summaries (day, metric, device_id, value, unit, method, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, metric, device_id) DO UPDATE SET value = excluded.value, unit = excluded.unit,
         method = excluded.method, computed_at = excluded.computed_at`
    ).run(day, metric, deviceId, value, unit, method, this.now().toISOString());
  }

  /** Sleep segments are final once the watch writes their end, so a re-read replaces the stored copy. */
  upsertSleeps(sessions: LocalSleepSession[], mode: "replace" | "keep-existing" = "replace"): number {
    const upsert = this.db.prepare(
      `INSERT OR ${mode === "replace" ? "REPLACE" : "IGNORE"} INTO local_sleep_sessions
         (device_id, start_ts, end_ts, day, utc_offset_minutes, total_minutes, awake_minutes, light_minutes, deep_minutes,
          rem_minutes, awake_count, min_hr, avg_hr, max_hr, ranges, source, recorded_at)
       VALUES (@deviceId, @startTs, @endTs, @day, @utcOffsetMinutes, @totalMinutes, @awakeMinutes, @lightMinutes, @deepMinutes,
          @remMinutes, @awakeCount, @minHr, @avgHr, @maxHr, @ranges, @source, @recordedAt)`
    );
    const exists = this.db.prepare("SELECT 1 FROM local_sleep_sessions WHERE device_id = ? AND start_ts = ?");
    const recordedAt = this.now().toISOString();
    let added = 0;
    this.db.transaction(() => {
      for (const session of sessions) {
        if (typeof session?.deviceId !== "string" || !/^\d{8}$/.test(session.day) || !(session.endTs > session.startTs) || !Array.isArray(session.ranges)) continue;
        if (!exists.get(session.deviceId, session.startTs)) added += 1;
        upsert.run({
          ...session, minHr: session.minHr ?? null, avgHr: session.avgHr ?? null, maxHr: session.maxHr ?? null,
          ranges: JSON.stringify(session.ranges), recordedAt
        });
      }
    })();
    return added;
  }

  /** Restore never overwrites what is already stored. */
  restoreSleeps(sessions: LocalSleepSession[]): number {
    return this.upsertSleeps(sessions, "keep-existing");
  }

  /** Sleep segments ending on the most recent `days` days that have any, newest day first. */
  listSleeps(days: number): LocalSleepSession[] {
    const limit = Math.min(Math.max(Math.trunc(days), 1), 3660);
    return (this.db.prepare(
      `SELECT * FROM local_sleep_sessions
       WHERE day IN (SELECT DISTINCT day FROM local_sleep_sessions ORDER BY day DESC LIMIT ?)
       ORDER BY day DESC, start_ts`
    ).all(limit) as Array<Record<string, unknown>>).map(sleepFromRow);
  }

  allSleeps(): LocalSleepSession[] {
    return (this.db.prepare("SELECT * FROM local_sleep_sessions ORDER BY start_ts").all() as Array<Record<string, unknown>>).map(sleepFromRow);
  }

  /** Recovery curves never change once written; the first copy is kept. Returns how many were new. */
  insertRecoveries(recoveries: LocalWorkoutRecovery[]): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO local_workout_recovery (device_id, workout_start_ts, workout_end_ts, samples, source, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const recordedAt = this.now().toISOString();
    let added = 0;
    this.db.transaction(() => {
      for (const recovery of recoveries) {
        if (typeof recovery?.deviceId !== "string" || !Number.isSafeInteger(recovery.workoutStartTs) || !(recovery.workoutEndTs > recovery.workoutStartTs)) continue;
        if (!Array.isArray(recovery.samples) || !recovery.samples.every((bpm) => Number.isFinite(bpm))) continue;
        added += insert.run(recovery.deviceId, recovery.workoutStartTs, recovery.workoutEndTs, JSON.stringify(recovery.samples), recovery.source, recordedAt).changes;
      }
    })();
    return added;
  }

  /** The recovery recorded after the workout that started at `startTs` (within a minute), if any. */
  findRecovery(startTs: number): LocalWorkoutRecovery | undefined {
    const row = this.db.prepare(
      "SELECT * FROM local_workout_recovery WHERE workout_start_ts BETWEEN ? AND ? ORDER BY ABS(workout_start_ts - ?) LIMIT 1"
    ).get(startTs - 60, startTs + 60, startTs) as Record<string, unknown> | undefined;
    return row ? recoveryFromRow(row) : undefined;
  }

  allRecoveries(): LocalWorkoutRecovery[] {
    return (this.db.prepare("SELECT * FROM local_workout_recovery ORDER BY workout_start_ts").all() as Array<Record<string, unknown>>).map(recoveryFromRow);
  }

  /** Health Checks never change once taken; the first copy is kept. Returns how many were new. */
  insertHealthChecks(checks: LocalHealthCheck[]): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO local_health_checks
         (device_id, ts, utc_offset_minutes, heart_rate, hrv_ms, breathing_rate, spo2, stress, stress_level, source, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const recordedAt = this.now().toISOString();
    const whole = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
    let added = 0;
    this.db.transaction(() => {
      for (const check of checks) {
        if (typeof check?.deviceId !== "string" || typeof check.source !== "string" || !Number.isSafeInteger(check.ts)) continue;
        if (![check.heartRate, check.hrvMs, check.breathingRate, check.spo2, check.stress, check.stressLevel].every(whole)) continue;
        added += insert.run(check.deviceId, check.ts, Number.isSafeInteger(check.utcOffsetMinutes) ? check.utcOffsetMinutes : null,
          check.heartRate, check.hrvMs, check.breathingRate, check.spo2, check.stress, check.stressLevel, check.source, recordedAt).changes;
      }
    })();
    return added;
  }

  /** Health Checks taken in [from, to] (unix seconds), oldest first. */
  listHealthChecks(from: number, to: number): LocalHealthCheck[] {
    return (this.db.prepare("SELECT * FROM local_health_checks WHERE ts BETWEEN ? AND ? ORDER BY ts")
      .all(from, to) as Array<Record<string, unknown>>).map(healthCheckFromRow);
  }

  allHealthChecks(): LocalHealthCheck[] {
    return (this.db.prepare("SELECT * FROM local_health_checks ORDER BY ts").all() as Array<Record<string, unknown>>).map(healthCheckFromRow);
  }

  /** Samples of one metric in [from, to] (unix seconds), oldest first. */
  listSamples(metric: LocalHealthMetric, from: number, to: number): LocalHealthSample[] {
    return (this.db.prepare(
      "SELECT * FROM local_health_samples WHERE metric = ? AND ts BETWEEN ? AND ? ORDER BY ts"
    ).all(metric, from, to) as Array<Record<string, unknown>>).map(sampleFromRow);
  }

  /** Summaries for the most recent `days` calendar days, newest first, merged across devices (max). */
  listDays(days: number): LocalHealthDay[] {
    const limit = Math.min(Math.max(Math.trunc(days), 1), 3660);
    const rows = this.db.prepare(
      `SELECT day, metric, MAX(value) AS value, unit, method FROM local_health_summaries
       WHERE day IN (SELECT DISTINCT day FROM local_health_summaries ORDER BY day DESC LIMIT ?)
       GROUP BY day, metric ORDER BY day DESC`
    ).all(limit) as Array<{ day: string; metric: LocalHealthMetric; value: number; unit: string; method: string }>;
    const byDay = new Map<string, LocalHealthDay>();
    for (const row of rows) {
      const entry = byDay.get(row.day) ?? { day: row.day, metrics: {} };
      entry.metrics[row.metric] = { value: row.value, unit: row.unit, method: row.method };
      byDay.set(row.day, entry);
    }
    return [...byDay.values()];
  }

  countDays(): number {
    return (this.db.prepare("SELECT COUNT(DISTINCT day) AS days FROM local_health_summaries").get() as { days: number }).days;
  }

  allSamples(): LocalHealthSample[] {
    return (this.db.prepare("SELECT * FROM local_health_samples ORDER BY ts").all() as Array<Record<string, unknown>>).map(sampleFromRow);
  }

  allSummaries(): Array<{ day: string; metric: LocalHealthMetric; deviceId: string; value: number; unit: string; method: string }> {
    return (this.db.prepare("SELECT * FROM local_health_summaries ORDER BY day, metric").all() as Array<Record<string, unknown>>).map(row => ({
      day: row.day as string,
      metric: row.metric as LocalHealthMetric,
      deviceId: row.device_id as string,
      value: row.value as number,
      unit: row.unit as string,
      method: row.method as string
    }));
  }

  restoreSummary(row: { day: string; metric: LocalHealthMetric; deviceId: string; value: number; unit: string; method: string }): boolean {
    return this.db.prepare(
      `INSERT OR IGNORE INTO local_health_summaries (day, metric, device_id, value, unit, method, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.day, row.metric, row.deviceId, row.value, row.unit, row.method, this.now().toISOString()).changes > 0;
  }
}

function sampleFromRow(row: Record<string, unknown>): LocalHealthSample {
  return {
    deviceId: row.device_id as string,
    metric: row.metric as LocalHealthMetric,
    ts: row.ts as number,
    value: row.value as number,
    unit: row.unit as string,
    validity: row.validity as LocalHealthSample["validity"],
    source: row.source as string,
    provenance: row.provenance as LocalHealthSample["provenance"],
    ...(row.utc_offset_minutes === null ? {} : { utcOffsetMinutes: row.utc_offset_minutes as number })
  };
}

function sleepFromRow(row: Record<string, unknown>): LocalSleepSession {
  const optional = (value: unknown) => (value === null || value === undefined ? undefined : (value as number));
  let ranges: LocalSleepSession["ranges"] = [];
  try { ranges = JSON.parse(row.ranges as string) as LocalSleepSession["ranges"]; } catch { ranges = []; }
  return {
    deviceId: row.device_id as string,
    startTs: row.start_ts as number,
    endTs: row.end_ts as number,
    day: row.day as string,
    utcOffsetMinutes: row.utc_offset_minutes as number,
    totalMinutes: row.total_minutes as number,
    awakeMinutes: row.awake_minutes as number,
    lightMinutes: row.light_minutes as number,
    deepMinutes: row.deep_minutes as number,
    remMinutes: row.rem_minutes as number,
    awakeCount: row.awake_count as number,
    minHr: optional(row.min_hr),
    avgHr: optional(row.avg_hr),
    maxHr: optional(row.max_hr),
    ranges,
    source: row.source as string
  };
}

function healthCheckFromRow(row: Record<string, unknown>): LocalHealthCheck {
  return {
    deviceId: row.device_id as string,
    ts: row.ts as number,
    ...(row.utc_offset_minutes === null ? {} : { utcOffsetMinutes: row.utc_offset_minutes as number }),
    heartRate: row.heart_rate as number,
    hrvMs: row.hrv_ms as number,
    breathingRate: row.breathing_rate as number,
    spo2: row.spo2 as number,
    stress: row.stress as number,
    stressLevel: row.stress_level as number,
    source: row.source as string
  };
}

function recoveryFromRow(row: Record<string, unknown>): LocalWorkoutRecovery {
  let samples: number[] = [];
  try { samples = JSON.parse(row.samples as string) as number[]; } catch { samples = []; }
  return {
    deviceId: row.device_id as string,
    workoutStartTs: row.workout_start_ts as number,
    workoutEndTs: row.workout_end_ts as number,
    samples,
    source: row.source as string
  };
}
