import fs from "node:fs";
import type Database from "better-sqlite3";
import { parseFitActivity, type FitTraining } from "../fitActivity";
import type { TrainingHubDailyMetric, TrainingHubDailyMetrics } from "../types";
import type { ActivityRepository } from "./activityRepository";
import type { HealthRepository } from "./healthRepository";
import type { LocalArchive } from "./localArchive";
import type { LocalActivityRecord } from "./localDataTypes";

/** The Training Hub's day key: the local calendar day, "YYYYMMDD". */
function happenDay(ts: number): string {
  const date = new Date(ts * 1000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

const PAGE = 1000;

/** The watch's own figures stored with one activity (see CorosTraining). */
interface WatchFigures {
  vo2max?: number;
  /** Seconds from the end of the activity until fully recovered. */
  recovery?: number;
  baseFitness?: number;
  loadImpact?: number;
  fatigue?: number;
}

/** What the watch's recovery countdown caps at: 120 h. */
const MAX_RECOVERY_SECONDS = 120 * 3600;

/**
 * Per-day training totals for Local-Only Mode, from what the watch recorded:
 * each activity's training load and the watch's own figures (VO₂ max,
 * recovery time, Base Fitness, Load Impact, fatigue), kept in the FIT file
 * CorosLink writes, plus distance, time and the nightly sleep HRV. Nothing is
 * estimated. A day the watch's daily history covers without any activity has
 * zero load, distance and time, as in COROS; days with no data at all (not
 * synced yet, watch not worn) are left out rather than shown as rest days.
 */
export class LocalTrainingMetrics {
  constructor(
    private readonly db: Database.Database,
    private readonly activities: ActivityRepository,
    private readonly health: HealthRepository,
    private readonly archive: LocalArchive
  ) {}

  /** The watch's training load and figures for an activity, read from its FIT file once per file version. */
  private training(record: LocalActivityRecord): { load?: number; figures: WatchFigures } {
    if (record.format !== "fit") return { figures: {} };
    const cached = this.db.prepare("SELECT sha256, training_load, watch_figures FROM local_activity_training WHERE activity_id = ?")
      .get(record.activityId) as { sha256: string; training_load: number | null; watch_figures: string } | undefined;
    if (cached?.sha256 === record.sha256) {
      return { load: cached.training_load ?? undefined, figures: JSON.parse(cached.watch_figures) as WatchFigures };
    }
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(this.archive.resolve(record.filePath));
    } catch {
      // A missing or unreadable file may come back (a restore); don't remember it as "no load".
      return { figures: {} };
    }
    let training: FitTraining | undefined;
    try {
      training = parseFitActivity(new Uint8Array(bytes)).session?.training;
    } catch {
      training = undefined;
    }
    const load = training?.trainingLoad;
    // Only the watch's own recordings: a FIT file from elsewhere may use the same names for other things.
    const figures: WatchFigures = record.provenance === "watch" && training ? {
      vo2max: training.vo2max, recovery: training.recovery,
      baseFitness: training.baseFitness, loadImpact: training.loadImpact, fatigue: training.fatigue
    } : {};
    this.db.prepare(
      `INSERT INTO local_activity_training (activity_id, sha256, training_load, watch_figures) VALUES (?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET sha256 = excluded.sha256, training_load = excluded.training_load, watch_figures = excluded.watch_figures`
    ).run(record.activityId, record.sha256, load ?? null, JSON.stringify(figures));
    return { load, figures: JSON.parse(JSON.stringify(figures)) as WatchFigures };
  }

  dailyMetrics(dateList: string[]): TrainingHubDailyMetrics {
    const wanted = new Set(dateList.filter(day => /^\d{8}$/.test(day)));
    const sorted = [...wanted].sort();
    const startDay = sorted[0];
    const endDay = sorted[sorted.length - 1];
    if (!startDay || !endDay) throw new Error("At least one date is required for daily metrics.");

    const byDay = new Map<string, TrainingHubDailyMetric>();
    const entry = (day: string) => {
      const existing = byDay.get(day);
      if (existing) return existing;
      const created: TrainingHubDailyMetric = { happenDay: day };
      byDay.set(day, created);
      return created;
    };
    const add = (value: number | undefined, current: number | undefined) =>
      value === undefined ? current : (current ?? 0) + value;

    const activityDays = new Set<string>();
    // Per day and figure: the time of the activity the value came from, so the day's last one wins.
    const figureAt = new Map<string, number>();
    const setFigure = (day: string, key: string, ts: number, apply: () => void) => {
      if (ts < (figureAt.get(`${day}:${key}`) ?? -Infinity)) return;
      figureAt.set(`${day}:${key}`, ts);
      apply();
    };
    for (let page = 1; ; page++) {
      const records = this.activities.listActivities({ page, size: PAGE, startDay, endDay });
      for (const record of records) {
        const ts = record.startTime ?? record.endTime;
        if (ts === undefined) continue;
        const day = happenDay(ts);
        if (!wanted.has(day)) continue;
        const metric = entry(day);
        activityDays.add(day);
        const { load, figures } = this.training(record);
        metric.trainingLoad = add(load, metric.trainingLoad);
        // Each figure as of the day's last activity that carries it. A ride carries the watch's separate
        // cycling VO₂ max, so rides are left out of VO₂ max.
        const ride = record.sportType >= 200 && record.sportType < 300;
        const { vo2max, recovery, baseFitness, loadImpact, fatigue } = figures;
        if (vo2max !== undefined && !ride) setFigure(day, "vo2max", ts, () => { metric.vo2max = vo2max; });
        const end = record.endTime;
        if (recovery !== undefined && end !== undefined) {
          setFigure(day, "recovery", ts, () => { metric.recoveredAt = end + Math.min(Math.max(recovery, 0), MAX_RECOVERY_SECONDS); });
        }
        if (baseFitness !== undefined) {
          setFigure(day, "balance", ts, () => Object.assign(metric, { baseFitness, loadImpact, fatigue }));
        }
        metric.distance = add(record.distance, metric.distance);
        metric.duration = add(record.movingTime ?? record.duration, metric.duration);
      }
      if (records.length < PAGE) break;
    }

    for (const day of this.health.listDays(wanted.size + 1)) {
      if (!wanted.has(day.day)) continue;
      const metric = entry(day.day);
      if (!activityDays.has(day.day)) Object.assign(metric, { trainingLoad: 0, distance: 0, duration: 0 });
      const hrv = day.metrics.sleep_hrv?.value;
      if (hrv !== undefined) metric.avgSleepHrv = hrv;
    }

    return { dayList: [...byDay.values()].sort((a, b) => a.happenDay.localeCompare(b.happenDay)), weekList: [] };
  }
}
