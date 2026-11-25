import { fromSample, fromSynced, type Loaded } from "./core";
import { syncView } from "./sync";

export type SleepStage = "awake" | "rem" | "light" | "deep";

export interface SleepSegment {
  stage: SleepStage;
  minutes: number;
}

export interface SleepNight {
  score: number | null;
  /** The watch's word for the score: "Good", "Fair"… Left out when nothing gives it. */
  rating?: string;
  /** Fell asleep, in minutes after midnight of the evening (22:58 = 1378). */
  startMinute: number | null;
  /** In order through the night. Empty when only the night's totals are known. */
  segments: SleepSegment[];
  /** Minutes the source gave as totals; used where there are no segments, and `asleep` in any case. */
  totals?: { awake?: number; rem?: number; light?: number; deep?: number; asleep?: number; inBed?: number };
  /** Average heart rate while asleep, bpm. */
  heartRateAsleep: number | null;
}

/** Names of the hue tokens in globals.css (`--h-<name>`). */
export type HealthHue = "cyan" | "rose" | "violet" | "coral" | "orange" | "mint" | "sky";

export interface MorningMeasure {
  name: string;
  /** Today's reading as shown, unit included. */
  today: string;
  /** Seven-day average as shown. */
  week: string;
  /** Where today sits between the 30-day lowest (0) and highest (100). Null when the 30 days hold one value only. */
  position: number | null;
  hue: HealthHue;
}

export type TrendFormat = "int" | "hours" | "thousands";

export interface TrendSeries {
  id: string;
  name: string;
  hue: HealthHue;
  /** Appended to the formatted value, leading space included (" ms"). */
  unit: string;
  format: TrendFormat;
  /** One reading per day, oldest first; the last one is `lastDay`. Null on a day without a reading. */
  values: (number | null)[];
}

export interface HealthData {
  /** YYYY-MM-DD of the newest reading. */
  lastDay: string;
  /** Energy right now, for the pill that opens the Energy page. */
  energyNow: number | null;
  /** The latest night; null when there is none. */
  night: SleepNight | null;
  morning: MorningMeasure[];
  trends: TrendSeries[];
}

export async function loadHealth(): Promise<Loaded<HealthData>> {
  const view = await syncView();
  if (view) {
    const { healthFromItems } = await import("./sync/health");
    return fromSynced(healthFromItems(view.all("health.day"), view.all("health.night"), view.all("energy.day"), new Date()));
  }
  const { sampleHealth } = await import("./sample/health");
  return fromSample(sampleHealth);
}
