import { DAILY_DATA_FILE, decodePedometer, PEDOMETER_OPCODE, SYNC_MAX_FILE_BYTES, type PedometerTotals } from "./activityProtocol";
import { decodeCorosDailyFile } from "./corosDailyRecord";
import type { HealthRepository } from "./healthRepository";
import { localDayKey } from "./healthRepository";
import type { LocalHealthSample } from "./localDataTypes";
import { nextOffsetAfterStoredCopy } from "./payloadRetention";
import type { WatchIdentity } from "./watchActivityService";

/**
 * Daily health from the watch over Bluetooth:
 * - today's running totals (`GetPedometer`, 0x90: steps, distance, active
 *   calories and active time);
 * - the daily-history file (SyncData file 5): per-minute heart rate, steps and
 *   calories per 5 minutes, stress, HRV and sleep, decoded by
 *   `corosDailyRecord.ts`. It is read by offset and never acknowledged, so the
 *   watch keeps it for the phone app (verified on a PACE 4, V3.2008.0).
 */

export interface WatchHealthTransport {
  identity(): WatchIdentity | undefined;
  /** One control exchange: opcode + payload, returns the reply payload. */
  exchange(opcode: number, payload: Buffer): Promise<Buffer>;
  /** One verified SyncData block, never acknowledged. */
  readSyncBlock(fileIndex: number, offset: number, selector: number): Promise<{ block: Buffer; remaining: number }>;
}

export interface DailyHistoryImport {
  heartRateSamples: number;
  stressSamples: number;
  hrvSamples: number;
  newSleeps: number;
  newRecoveries: number;
  newHealthChecks: number;
  days: string[];
  /** Unix seconds of the newest heart-rate, stress, HRV or Health Check reading in the file. */
  latestReadingAt?: number;
}

export interface WatchHealthReading {
  day: string;
  totals: PedometerTotals;
  readAt: number;
}

/** The watch reports month/day only; pick the year that puts that date closest to now. */
export function pedometerDay(totals: PedometerTotals, now: Date): string {
  if (!totals.month || !totals.day) return localDayKey(Math.floor(now.getTime() / 1000));
  let best = now.getFullYear();
  let bestDistance = Infinity;
  for (const year of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const distance = Math.abs(new Date(year, totals.month - 1, totals.day).getTime() - now.getTime());
    if (distance < bestDistance) { best = year; bestDistance = distance; }
  }
  return `${best}${String(totals.month).padStart(2, "0")}${String(totals.day).padStart(2, "0")}`;
}

export class WatchHealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly transport: WatchHealthTransport,
    private readonly now: () => Date = () => new Date()
  ) {}

  async readDayTotals(): Promise<WatchHealthReading> {
    const identity = this.transport.identity();
    if (!identity) throw new Error("Connect and authenticate your watch first.");
    // Like CorosLink's other control reads (0x96, 0xAA), the request carries one 0x00 byte.
    // The PACE 4 answers an empty 0x90 with opcode 0x0D instead (captured 2026-10-18, V3.2008.0).
    const totals = decodePedometer(await this.transport.exchange(PEDOMETER_OPCODE, Buffer.from([0])));
    const readAt = this.now();
    const day = pedometerDay(totals, readAt);
    const ts = Math.floor(readAt.getTime() / 1000);
    const source = "ble:pedometer";
    const samples = [
      { metric: "steps" as const, value: totals.steps, unit: "count" },
      { metric: "distance" as const, value: totals.distanceMeters, unit: "m" },
      { metric: "active_calories" as const, value: totals.calories, unit: "kcal" },
      ...(totals.activeSeconds !== undefined ? [{ metric: "active_time" as const, value: totals.activeSeconds, unit: "s" }] : [])
    ];
    this.repository.insertSamples(samples.map(sample => ({
      ...sample, deviceId: identity.deviceId, ts, source, provenance: "watch" as const,
      utcOffsetMinutes: -readAt.getTimezoneOffset()
    })));
    this.repository.recordDayTotals(identity.deviceId, day, Object.fromEntries(samples.map(sample => [sample.metric, { value: sample.value, unit: sample.unit }])));
    return { day, totals, readAt: readAt.getTime() };
  }

  /**
   * Reads the daily-history file by offset, without acknowledging anything.
   * With `stored`, the copy kept from an earlier sync, only what the watch
   * added since is read, once its first block and the stored copy's last page
   * are confirmed unchanged; otherwise the whole file is read.
   */
  async readDailyFile(stored?: Buffer): Promise<Buffer> {
    if (!this.transport.identity()) throw new Error("Connect and authenticate your watch first.");
    let blocks: Buffer[] = [];
    let offset = 0;
    let total: number | undefined;
    let known = stored?.length ? stored : undefined;
    do {
      const { block, remaining } = await this.transport.readSyncBlock(DAILY_DATA_FILE, offset, 0);
      // The watch appends while it records; existing bytes stay put, so read up to the length first reported.
      total ??= offset + remaining;
      if (block.length === 0 || offset + remaining < total || total > SYNC_MAX_FILE_BYTES) throw new Error("The watch's daily history changed while it was being read. Sync again.");
      let next = offset + block.length;
      if (known) {
        const plan = nextOffsetAfterStoredCopy(known, block, offset, total);
        if (plan === "mismatch") {
          // Not the file stored last time (it shrank or was rewritten): read all of it.
          known = undefined;
          if (offset !== 0) { blocks = []; offset = 0; continue; }
        } else {
          if (plan > next) {
            // Skip to the stored copy's last page: the bytes before it are the stored ones.
            blocks = [known.subarray(0, plan)];
            next = plan;
          } else {
            blocks.push(block);
          }
          if (offset + block.length >= known.length) known = undefined;
          offset = next;
          continue;
        }
      }
      blocks.push(block);
      offset = next;
    } while (offset < total);
    return Buffer.concat(blocks).subarray(0, total);
  }

  /** Decodes a daily-history file and stores what it holds; repeated imports add nothing twice. */
  importDailyFile(deviceId: string, file: Buffer): DailyHistoryImport {
    const daily = decodeCorosDailyFile(file);
    const source = "ble:daily";
    const sample = (metric: LocalHealthSample["metric"], ts: number, value: number, unit: string, utcOffsetMinutes: number): LocalHealthSample =>
      ({ deviceId, metric, ts, value, unit, source, provenance: "watch", utcOffsetMinutes });
    const heartRateSamples = this.repository.insertSamples(daily.heartRate.filter((s) => s.bpm > 0).map((s) => sample("heart_rate", s.ts, s.bpm, "bpm", s.utcOffsetMinutes)));
    const stressSamples = this.repository.insertSamples(daily.stress.map((s) => sample("stress", s.ts, s.stress, "score", s.utcOffsetMinutes)));
    const valid = daily.hrv.filter((h) => h.rmssdMs > 0);
    const hrvSamples = this.repository.insertSamples([
      ...valid.map((h) => sample("hrv_rmssd", h.ts, h.rmssdMs, "ms", h.utcOffsetMinutes)),
      ...valid.filter((h) => h.breathingRate > 0).map((h) => sample("breathing_rate", h.ts, h.breathingRate, "/min", h.utcOffsetMinutes))
    ]);
    for (const day of daily.days) {
      // Day totals only grow, so a partial first day never lowers a fuller total read earlier.
      this.repository.recordDayTotals(deviceId, day.day, { steps: { value: day.steps, unit: "count" }, active_calories: { value: day.calories, unit: "kcal" } });
    }
    for (const [day, hrv] of Object.entries(daily.sleepHrv)) this.repository.recordDayValue(deviceId, day, "sleep_hrv", hrv, "ms", "watch-sleep-average");
    const newSleeps = this.repository.upsertSleeps(daily.sleeps.map((sleep) => ({
      deviceId, startTs: sleep.start, endTs: sleep.end, day: sleep.day, utcOffsetMinutes: sleep.utcOffsetMinutes, totalMinutes: sleep.totalMinutes,
      awakeMinutes: sleep.stageMinutes.awake, lightMinutes: sleep.stageMinutes.light, deepMinutes: sleep.stageMinutes.deep, remMinutes: sleep.stageMinutes.rem,
      awakeCount: sleep.awakeCount, minHr: sleep.minHr, avgHr: sleep.avgHr, maxHr: sleep.maxHr, ranges: sleep.ranges, source
    })));
    const newRecoveries = this.repository.insertRecoveries(daily.recoveries.map((recovery) => ({
      deviceId, workoutStartTs: recovery.workoutStart, workoutEndTs: recovery.workoutEnd, samples: recovery.samples, source
    })));
    const newHealthChecks = this.repository.insertHealthChecks(daily.healthChecks.map(({ restingHeartRate: _setting, ...check }) => ({ deviceId, ...check, source })));
    const stamps = [...daily.heartRate.filter((s) => s.bpm > 0), ...daily.stress, ...valid, ...daily.healthChecks].map((reading) => reading.ts);
    return {
      heartRateSamples, stressSamples, hrvSamples, newSleeps, newRecoveries, newHealthChecks, days: daily.days.map((day) => day.day),
      // A loop, not Math.max(...stamps): months of per-minute readings overflow the argument list.
      ...(stamps.length ? { latestReadingAt: stamps.reduce((latest, ts) => (ts > latest ? ts : latest), -Infinity) } : {})
    };
  }
}
