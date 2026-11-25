import { fromSample, fromSynced, type Loaded } from "./core";
import { syncView } from "./sync";

export type EnergyEventKind = "sleep" | "workout" | "rest" | "stress" | "awake";
export type EnergyBandKind = Exclude<EnergyEventKind, "awake">;

export interface EnergyPoint {
  /** Minutes after midnight. */
  minute: number;
  /** 0…100. */
  level: number;
}

/** A stretch of the day shaded on the chart. */
export interface EnergyBand {
  kind: EnergyBandKind;
  from: number;
  to: number;
  /** What the hover readout calls it ("Morning tempo"). */
  label: string;
}

export interface EnergyEvent {
  kind: EnergyEventKind;
  name: string;
  detail: string;
  /** Energy added (positive) or used (negative). */
  delta: number;
  /** When it happened, as the step chart labels it ("07:42 – 08:20", "so far"). Defaults to the detail's first part. */
  when?: string;
}

export interface EnergyDay {
  /** YYYY-MM-DD. */
  date: string;
  /** Readings through the day, oldest first. On the current day they stop at "now". */
  points: EnergyPoint[];
  bands: EnergyBand[];
  events: EnergyEvent[];
  /** Minute of waking and the level then. Null when the day has no night before it. */
  woke: EnergyPoint | null;
  /** Lowest and highest level since waking. */
  low: number;
  high: number;
  /** Only on the current day: the latest reading, where the day is heading, and how fast it is being used. */
  now?: EnergyPoint;
  bedtime?: EnergyPoint;
  pace?: { label: string; direction: "down" | "up" | "flat" };
  note?: string;
  /** Only on the current day: Coach's one-line read of the day, next to the chart. */
  headline?: string;
  /** Last night's sleep, for the Charged card's sentence. */
  sleep?: { minutes: number; score: number };
  /** No full night read yet: the level hasn't settled. */
  learning?: boolean;
}

export interface EnergyData {
  /** Oldest first; the last one is the current day. */
  days: EnergyDay[];
}

export async function loadEnergy(): Promise<Loaded<EnergyData>> {
  const view = await syncView();
  if (view) {
    const { energyFromItems } = await import("./sync/energy");
    return fromSynced({ days: energyFromItems(view.all("energy.day"), view.all("health.night"), new Date()) });
  }
  const { sampleEnergy } = await import("./sample/energy");
  return fromSample(sampleEnergy);
}
