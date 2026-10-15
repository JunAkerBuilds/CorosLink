import type { TrainingHubActivity } from "./types";

/** Standard race distances a result is filed under; "other" carries its own length. */
export type RaceDistanceKey =
  | "1mi"
  | "5k"
  | "10k"
  | "15k"
  | "10mi"
  | "half"
  | "marathon"
  | "50k"
  | "other";

/** Where the race's activity came from. Manual races have no recording. */
export type RaceSource = "coros" | "strava" | "manual";

/** Training in the weeks before a race, so two races can be compared on preparation. */
export interface RaceBuildUp {
  weeks: number;
  runs: number;
  /** Meters run in the window. */
  distance: number;
  /** Meters, the longest single run in the window. */
  longestRun?: number;
  /** False when synced history starts inside the window, so the totals undercount. */
  complete: boolean;
}

export interface RaceEntry {
  raceId: string;
  source: RaceSource;
  corosActivityId?: string;
  stravaActivityId?: string;
  /** Strava brand rules require Strava data to link back with "View on Strava". */
  stravaUrl?: string;
  /** The event name the athlete entered, else the activity name. */
  name: string;
  /** The recording's own name, when it differs from the event name. */
  activityName?: string;
  /** Epoch seconds. */
  startTime: number;
  /** COROS sport code (100 Run, 102 Trail Run, 103 Track Run). */
  sportType?: number;
  distanceKey: RaceDistanceKey;
  /** True when the athlete chose the distance instead of it being detected. */
  distanceIsManual: boolean;
  /** Meters the result counts as: the official course length. */
  officialDistance: number;
  /** Seconds: the chip time when entered, else the recorded elapsed time. */
  officialTime: number;
  officialTimeIsManual: boolean;
  /** Meters the watch measured. */
  recordedDistance?: number;
  /** Seconds the watch measured, pauses included. */
  recordedTime?: number;
  avgHr?: number;
  elevationGain?: number;
  /** Free text such as "48th of 912 · 6th M30–34". */
  placing?: string;
  notes?: string;
  buildUp?: RaceBuildUp;
}

export interface RaceSuggestion {
  activity: TrainingHubActivity;
  distanceKey: RaceDistanceKey;
  /** Short, human reasons, for example "Named like a race". */
  reasons: string[];
}

export interface RaceStravaState {
  connected: boolean;
  /** ISO timestamp of the last finished import. */
  lastImportedAt?: string;
  /** Strava-only races whose data was cleared when Strava was disconnected. */
  hiddenRaces: number;
}

export interface RaceOverview {
  races: RaceEntry[];
  suggestions: RaceSuggestion[];
  strava: RaceStravaState;
}

/** A field set to `null` clears the athlete's value and falls back to the recording. */
export interface RaceEditInput {
  raceId: string;
  name?: string | null;
  distanceKey?: RaceDistanceKey | null;
  officialDistance?: number | null;
  officialTime?: number | null;
  placing?: string | null;
  notes?: string | null;
}

export interface ManualRaceInput {
  name: string;
  /** Epoch seconds. */
  startTime: number;
  distanceKey: RaceDistanceKey;
  /** Meters; required when `distanceKey` is "other". */
  officialDistance?: number;
  officialTime: number;
  placing?: string;
  notes?: string;
}

export interface StravaRaceImportResult {
  /** Strava activities read during the import. */
  scanned: number;
  /** Runs marked "Race" among them. */
  found: number;
  /** True when only activities since the previous import were read. */
  incremental: boolean;
  /** Races new to CorosLink. */
  added: number;
  /** Strava races that were already a COROS recording here. */
  matched: number;
  overview: RaceOverview;
}
