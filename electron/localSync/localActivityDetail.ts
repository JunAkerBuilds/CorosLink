import { corosSportName } from "../corosSportTypes";
import type { FitActivity } from "../fitActivity";
import type { TrainingHubActivityDetail, TrainingHubActivityLap, TrainingHubActivitySeriesPoint, TrainingHubTrackPoint, TrainingHubTrainingEffect } from "../types";
import type { LocalActivityRecord } from "./localDataTypes";

/**
 * Turns a locally stored FIT file into the same shapes the Training Hub UI
 * renders for cloud activities. Only values present in the file are shown;
 * COROS cloud-only metrics (training load, EvoLab scores) stay undefined
 * rather than being estimated under COROS's name.
 */

const MAX_TRACK_POINTS = 2000;
const MAX_SERIES_POINTS = 600;

/** FIT sport/sub-sport → COROS sportType, so local activities group like cloud ones. */
export function corosSportTypeFromFit(sport?: number, subSport?: number): number {
  switch (sport) {
    case 1: return subSport === 1 ? 101 : subSport === 3 ? 102 : subSport === 4 ? 103 : 100;
    case 2: return subSport === 6 ? 201 : subSport === 8 ? 204 : subSport === 46 ? 203 : subSport === 28 ? 202 : 200;
    case 4: return subSport === 1 ? 101 : subSport === 6 ? 201 : subSport === 14 ? 701 : subSport === 16 ? 902 : 400;
    case 5: return subSport === 18 ? 301 : 300;
    case 10: return subSport === 20 ? 402 : 400;
    case 11: return 900;
    case 12: return 502;
    case 13: return 500;
    case 14: return 501;
    case 15: return subSport === 14 ? 701 : 700;
    case 17: return 104;
    case 31: return 106;
    default: return 98;
  }
}

/** COROS sportType → FIT sport/sub-sport; the inverse of `corosSportTypeFromFit` for every type it maps. */
export function fitSportFromCorosType(sportType: number): { sport: number; subSport?: number } {
  switch (sportType) {
    case 100: return { sport: 1 };
    case 101: return { sport: 1, subSport: 1 };
    case 102: return { sport: 1, subSport: 3 };
    case 103: return { sport: 1, subSport: 4 };
    case 104: return { sport: 17 };
    case 106: return { sport: 31 };
    case 200: return { sport: 2 };
    case 201: return { sport: 2, subSport: 6 };
    case 202: return { sport: 2, subSport: 28 };
    case 203: return { sport: 2, subSport: 46 };
    case 204: return { sport: 2, subSport: 8 };
    case 300: return { sport: 5, subSport: 17 };
    case 301: return { sport: 5, subSport: 18 };
    case 400: return { sport: 4 };
    case 402: return { sport: 10, subSport: 20 };
    case 500: return { sport: 13 };
    case 501: return { sport: 14 };
    case 502: return { sport: 12 };
    case 700: return { sport: 15 };
    case 701: return { sport: 15, subSport: 14 };
    case 900: return { sport: 11 };
    case 902: return { sport: 4, subSport: 16 };
    default: return { sport: 0 };
  }
}

function isRideSport(sportType: number): boolean {
  return sportType >= 200 && sportType < 300;
}

/** FIT stores running, walking and hiking cadence per leg; the Training Hub shows steps per minute, like COROS. */
function cadenceScale(activity: FitActivity): number {
  const sport = activity.session?.sport;
  return sport === 1 || sport === 11 || sport === 17 ? 2 : 1;
}

const FIT_SPORT_SWIM = 5;

/**
 * Per-second samples in the shape of the COROS Training Hub detail payload
 * (`frequencyList`, `pauseList`, `summary.startTimestamp`), so local
 * activities get the same channel charts as cloud ones. Units as
 * src/training/activityStreams.ts documents them.
 */
function streamPayload(activity: FitActivity, sportType: number): Record<string, unknown> {
  const ride = isRideSport(sportType);
  const swim = activity.session?.sport === FIT_SPORT_SWIM;
  const scale = cadenceScale(activity);
  const speedValue = (speed: number | undefined) => {
    if (speed === undefined) return undefined;
    if (ride) return Math.round(speed * 360);
    if (speed <= 0) return undefined;
    return round(swim ? 100 / speed : 1000 / speed, 1);
  };
  const frequencyList = activity.records.map(record => ({
    timestamp: record.ts * 100,
    ...(record.dist !== undefined ? { distance: Math.round(record.dist * 100) } : {}),
    ...(speedValue(record.speed) !== undefined ? { speed: speedValue(record.speed) } : {}),
    ...(record.effortSpeed !== undefined && record.effortSpeed > 0 ? { adjustedPace: round(1000 / record.effortSpeed, 1) } : {}),
    ...(record.hr !== undefined ? { heart: record.hr } : {}),
    ...(record.cadence !== undefined ? { cadence: record.cadence * scale } : {}),
    ...(record.power !== undefined ? { power: record.power } : {}),
    ...(record.stepLength !== undefined ? { cadenceLength: round(record.stepLength / 10, 1) } : {}),
    ...(record.groundTime !== undefined ? { groundTime: record.groundTime } : {}),
    ...(record.verticalOscillation !== undefined ? { verticalVibration: record.verticalOscillation } : {}),
    ...(record.verticalRatio !== undefined ? { verticalStrideRatio: round(record.verticalRatio * 10) } : {}),
    ...(record.alt !== undefined ? { altitude: record.alt } : {}),
    ...(record.lat !== undefined && record.lon !== undefined ? { gpsLat: Math.round(record.lat * 1e7), gpsLon: Math.round(record.lon * 1e7) } : {})
  }));
  const windows = activity.activeWindows;
  const pauseList = windows.slice(1).map(([start], index) => ({ startTimestamp: windows[index]![1] * 100, endTimestamp: start * 100 }));
  const start = activity.session?.startTs ?? activity.records[0]?.ts;
  return { frequencyList, pauseList, ...(start !== undefined ? { summary: { startTimestamp: start * 100 } } : {}) };
}

function round(value: number | undefined, digits = 0): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function paceSecondsPerKm(distanceM?: number, seconds?: number): number | undefined {
  if (!distanceM || !seconds || distanceM < 1) return undefined;
  return round(seconds / (distanceM / 1000), 1);
}

export interface FitHeadline {
  sportType: number;
  startTime?: number;
  endTime?: number;
  duration?: number;
  movingTime?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  elevationGain?: number;
}

/** List-level values, computed once at import and stored in SQLite. */
export function fitHeadline(activity: FitActivity): FitHeadline {
  const session = activity.session;
  const firstRecord = activity.records[0];
  const lastRecord = activity.records[activity.records.length - 1];
  const startTime = session?.startTs ?? firstRecord?.ts ?? activity.fileCreatedTs;
  const elapsed = session?.elapsedSec ?? (firstRecord && lastRecord ? lastRecord.ts - firstRecord.ts : undefined);
  const hrs = activity.records.map(record => record.hr).filter((value): value is number => value !== undefined && value > 0);
  return {
    sportType: corosSportTypeFromFit(session?.sport, session?.subSport),
    startTime,
    endTime: startTime !== undefined && elapsed !== undefined ? Math.round(startTime + elapsed) : lastRecord?.ts,
    duration: round(elapsed),
    movingTime: round(session?.timerSec ?? lastRecord?.t),
    distance: round(session?.distanceM ?? lastRecord?.dist, 1),
    avgHr: round(session?.avgHr ?? (hrs.length ? hrs.reduce((sum, value) => sum + value, 0) / hrs.length : undefined)),
    maxHr: round(session?.maxHr ?? (hrs.length ? hrs.reduce((high, hr) => Math.max(high, hr)) : undefined)),
    calories: round(session?.calories),
    elevationGain: round(session?.ascentM, 1)
  };
}

function trackPoints(activity: FitActivity): TrainingHubTrackPoint[] {
  const located = activity.records.filter(record => record.lat !== undefined && record.lon !== undefined);
  const stride = Math.max(1, Math.ceil(located.length / MAX_TRACK_POINTS));
  const points: TrainingHubTrackPoint[] = [];
  for (let index = 0; index < located.length; index += stride) {
    const record = located[index]!;
    points.push({ lat: record.lat, lon: record.lon, elevation: round(record.alt, 1), distance: round(record.dist, 1) });
  }
  const last = located[located.length - 1];
  if (last && points.length && (located.length - 1) % stride !== 0) {
    points.push({ lat: last.lat, lon: last.lon, elevation: round(last.alt, 1), distance: round(last.dist, 1) });
  }
  return points;
}

function seriesPoints(activity: FitActivity): TrainingHubActivitySeriesPoint[] {
  const records = activity.records;
  const bucketSize = Math.max(1, Math.ceil(records.length / MAX_SERIES_POINTS));
  const points: TrainingHubActivitySeriesPoint[] = [];
  const mean = (values: Array<number | undefined>) => {
    const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
    return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : undefined;
  };
  for (let start = 0; start < records.length; start += bucketSize) {
    const bucket = records.slice(start, start + bucketSize);
    const speed = mean(bucket.map(record => record.speed));
    const cadence = mean(bucket.map(record => record.cadence));
    points.push({
      distance: round(bucket[bucket.length - 1]!.dist, 1),
      hr: round(mean(bucket.map(record => record.hr))),
      pace: speed !== undefined && speed > 0.3 ? round(1000 / speed, 1) : undefined,
      power: round(mean(bucket.map(record => record.power))),
      cadence: round(cadence === undefined ? undefined : cadence * cadenceScale(activity))
    });
  }
  return points;
}

function laps(activity: FitActivity, sportType: number): TrainingHubActivityLap[] {
  const scale = cadenceScale(activity);
  return activity.laps.map((lap, index) => {
    const duration = lap.timerSec ?? lap.elapsedSec;
    return {
      index: index + 1,
      distance: round(lap.distanceM, 1),
      duration: round(duration),
      avgHr: round(lap.avgHr),
      maxHr: round(lap.maxHr),
      pace: isRideSport(sportType) ? undefined : paceSecondsPerKm(lap.distanceM, duration),
      elevationGain: round(lap.ascentM, 1),
      avgPower: lap.avgPower && lap.avgPower > 0 ? round(lap.avgPower) : undefined,
      maxPower: lap.maxPower && lap.maxPower > 0 ? round(lap.maxPower) : undefined,
      avgCadence: lap.avgCadence && lap.avgCadence > 0 ? round(lap.avgCadence * scale) : undefined
    };
  });
}

function trainingEffect(activity: FitActivity): TrainingHubTrainingEffect | undefined {
  const training = activity.session?.training;
  if (!training) return undefined;
  const effect: TrainingHubTrainingEffect = {
    aerobic: training.aerobicEffect,
    anaerobic: training.anaerobicEffect,
    focus: training.focus && training.focus > 0 ? training.focus : undefined,
    aerobicLoad: training.aerobicLoad,
    anaerobicLoad: training.anaerobicLoad,
    sevenDayLoad: training.sevenDayLoad,
    recommendedLoadMin: training.recommendedLoadMin && training.recommendedLoadMin > 0 ? training.recommendedLoadMin : undefined,
    recommendedLoadMax: training.recommendedLoadMax && training.recommendedLoadMax > 0 ? training.recommendedLoadMax : undefined
  };
  return Object.values(effect).some(value => value !== undefined) ? effect : undefined;
}

export function localFitActivityDetail(activity: FitActivity, record: LocalActivityRecord): TrainingHubActivityDetail {
  const headline = fitHeadline(activity);
  const session = activity.session;
  const track = trackPoints(activity);
  const scale = cadenceScale(activity);
  const effect = trainingEffect(activity);
  const dynamics = session?.dynamics;
  return {
    activityId: record.activityId,
    name: record.name,
    sportType: record.sportType,
    sportName: record.sportName ?? corosSportName(record.sportType),
    startTime: headline.startTime,
    duration: headline.duration,
    movingTime: headline.movingTime,
    distance: headline.distance,
    avgHr: headline.avgHr,
    maxHr: headline.maxHr,
    calories: headline.calories,
    elevationGain: headline.elevationGain,
    avgPower: session?.avgPower && session.avgPower > 0 ? round(session.avgPower) : undefined,
    maxPower: session?.maxPower && session.maxPower > 0 ? round(session.maxPower) : undefined,
    normalizedPower: session?.normalizedPower && session.normalizedPower > 0 ? round(session.normalizedPower) : undefined,
    avgCadence: session?.avgCadence && session.avgCadence > 0 ? round(session.avgCadence * scale) : undefined,
    maxCadence: session?.maxCadence && session.maxCadence > 0 ? round(session.maxCadence * scale) : undefined,
    ...(session?.training?.trainingLoad !== undefined ? { trainingLoad: session.training.trainingLoad } : {}),
    ...(effect ? { trainingEffect: effect } : {}),
    ...(dynamics ? { runningDynamics: { ...dynamics } } : {}),
    ...(session?.minHr !== undefined ? { minHr: session.minHr } : {}),
    ...(session?.avgTemperature !== undefined ? { avgTemperature: session.avgTemperature } : {}),
    laps: laps(activity, record.sportType),
    ...(track.length >= 2 ? { track: { points: track } } : {}),
    series: seriesPoints(activity),
    raw: {
      localSource: record.source,
      provenance: record.provenance,
      format: record.format,
      sha256: record.sha256,
      cloudOnlyMetricsUnavailable: true,
      ...streamPayload(activity, record.sportType)
    }
  };
}

/** A record kept raw (no decoder yet) still opens, showing what the sync header told us. */
export function localUndecodedActivityDetail(record: LocalActivityRecord): TrainingHubActivityDetail {
  return {
    activityId: record.activityId,
    name: record.name,
    sportType: record.sportType,
    sportName: record.sportName ?? corosSportName(record.sportType),
    startTime: record.startTime,
    duration: record.duration,
    movingTime: record.movingTime,
    distance: record.distance,
    avgHr: record.avgHr,
    maxHr: record.maxHr,
    calories: record.calories,
    elevationGain: record.elevationGain,
    laps: [],
    raw: {
      localSource: record.source,
      provenance: record.provenance,
      format: record.format,
      verification: record.verification,
      sha256: record.sha256,
      cloudOnlyMetricsUnavailable: true
    }
  };
}
