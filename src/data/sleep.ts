import { fromSample, fromSynced, type Loaded } from "./core";
import type { SleepNight } from "./health";
import { addDays } from "@/lib/health";
import { syncView } from "./sync";

/** A daytime nap. `startMinute` is after midnight of the day the night ended. */
export interface SleepNap {
  startMinute: number;
  minutes: number;
  /** Points the nap added to the day's score, when the source says. */
  points: number | null;
}

/**
 * One night for the Sleep pages, as the phone's Sleep page knows it. It is a Health `SleepNight` (score, start,
 * stages, totals, heart rate asleep) plus what the night, week, month and year pages add.
 */
export interface SleepRecord extends SleepNight {
  /** YYYY-MM-DD of the day the night ended. */
  day: string;
  /** The night's own score before naps were added; null when the source gives none. */
  nightScore: number | null;
  naps: SleepNap[];
  /** Overnight HRV, ms. */
  hrv: number | null;
  /** Resting heart rate of the day, bpm. */
  restingHR: number | null;
  /**
   * Sleep stress: one reading per 5 minutes from `startOffset` minutes after falling asleep, 0 where the watch
   * took none. Null when the night has no readings.
   */
  stress: { startOffset: number; readings: number[] } | null;
  /** What was done the day before: workout names, [] for a rest day, null when not known. */
  dayBefore: string[] | null;
}

export interface SleepData {
  /** YYYY-MM-DD of today. Nights end on or before it. */
  today: string;
  /** Oldest first. */
  nights: SleepRecord[];
  /** The watch's sleep schedule, minutes after midnight, when the phone has sent it. */
  schedule?: { bedtime: number; wake: number } | null;
  /** Tomorrow's first planned workout, by name. */
  tomorrow?: string | null;
}

export async function loadSleep(): Promise<Loaded<SleepData>> {
  const view = await syncView();
  if (view) {
    const { sleepFromItems, plannedOn } = await import("./sync/sleep");
    const now = new Date();
    return fromSynced({
      ...sleepFromItems(view.all("health.night"), view.all("health.day"), view.all("activity"), now),
      schedule: view.get("watch.state", "me")?.sleepSchedule ?? null,
      tomorrow: plannedOn(view.all("gym.planned").map((i) => i.body), view.all("gym.routine").map((i) => i.body), addDays(now, 1)),
    });
  }
  const { sampleSleep } = await import("./sample/sleep");
  return fromSample(sampleSleep());
}
