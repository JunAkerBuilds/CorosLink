import type { FitActivity, FitLap } from "./fitActivity";
import {
  bestEfforts,
  computeSplits,
  decoupling,
  downsampleSeries,
  elevationGainLoss,
  normalizedPower,
  powerCurve,
  routeSignature,
  type BestEffort,
  type Decoupling,
  type FitSplit,
  type RouteSignature,
  type SeriesPoint
} from "./fitAnalytics";

export const FIT_SUMMARY_VERSION = 1;
const MILE_M = 1609.344;

/** Everything the coach tools need per activity, precomputed once at index time. */
export interface FitActivitySummary {
  version: number;
  activityId: string;
  /** COROS Training Hub sport type (100 run, 200 bike, …). */
  sportType: number;
  sportName?: string;
  name?: string;
  /** Unix seconds. */
  startTime: number;
  fitSport?: number;
  fitSubSport?: number;
  elapsedSec?: number;
  timerSec?: number;
  distanceM?: number;
  ascentM?: number;
  descentM?: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  avgCadence?: number;
  calories?: number;
  recordCount: number;
  hasGps: boolean;
  hasPower: boolean;
  hasHr: boolean;
  route?: RouteSignature;
  laps: FitLap[];
  splitsKm: FitSplit[];
  splitsMi: FitSplit[];
  powerCurve: Array<{ durationSec: number; watts: number; startT: number }>;
  bestEfforts: BestEffort[];
  decoupling?: Decoupling;
  series: SeriesPoint[];
}

export interface FitSummaryMeta {
  activityId: string;
  sportType: number;
  sportName?: string;
  name?: string;
  /** Unix seconds from the Training Hub listing; the FIT session wins when present. */
  startTime?: number;
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function summarizeFitActivity(
  activity: FitActivity,
  meta: FitSummaryMeta
): FitActivitySummary {
  const { records, session, laps } = activity;
  const total = records.length;
  const hasGps = ratio(records.filter((record) => record.lat !== undefined).length, total) > 0.5;
  const hasPower =
    ratio(records.filter((record) => record.power !== undefined && record.power > 0).length, total) >
    0.5;
  const hasHr = ratio(records.filter((record) => record.hr !== undefined).length, total) > 0.5;

  const gainLoss = elevationGainLoss(records.map((record) => record.alt));
  const last = records[records.length - 1];
  const distanceM =
    session?.distanceM ?? (last?.dist !== undefined ? last.dist : undefined);
  const timerSec = session?.timerSec ?? (last ? last.t : undefined);
  const avgSpeed =
    session?.avgSpeed ??
    (distanceM !== undefined && timerSec ? distanceM / timerSec : undefined);
  const maxOf = (key: "hr" | "power" | "speed"): number | undefined => {
    let best: number | undefined;
    for (const record of records) {
      const value = record[key];
      if (value !== undefined && (best === undefined || value > best)) best = value;
    }
    return best;
  };

  return {
    version: FIT_SUMMARY_VERSION,
    activityId: meta.activityId,
    sportType: meta.sportType,
    sportName: meta.sportName,
    name: meta.name,
    startTime: session?.startTs ?? meta.startTime ?? records[0]?.ts ?? 0,
    fitSport: session?.sport,
    fitSubSport: session?.subSport,
    elapsedSec: session?.elapsedSec,
    timerSec,
    distanceM,
    ascentM: session?.ascentM ?? gainLoss.gain,
    descentM: session?.descentM ?? gainLoss.loss,
    avgHr: session?.avgHr,
    maxHr: session?.maxHr ?? (hasHr ? maxOf("hr") : undefined),
    avgSpeed,
    maxSpeed: session?.maxSpeed ?? maxOf("speed"),
    avgPower: session?.avgPower,
    maxPower: session?.maxPower ?? (hasPower ? maxOf("power") : undefined),
    normalizedPower: session?.normalizedPower ?? (hasPower ? normalizedPower(records) : undefined),
    avgCadence: session?.avgCadence,
    calories: session?.calories,
    recordCount: total,
    hasGps,
    hasPower,
    hasHr,
    route: hasGps ? routeSignature(records) : undefined,
    laps,
    splitsKm: computeSplits(records, 1000),
    splitsMi: computeSplits(records, MILE_M),
    powerCurve: hasPower ? powerCurve(records) : [],
    bestEfforts: distanceM ? bestEfforts(records) : [],
    decoupling: decoupling(records),
    series: downsampleSeries(records)
  };
}
