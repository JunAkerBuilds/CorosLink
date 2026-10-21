/** Local (non-cloud) activity and health data. Shared with the renderer as type-only imports. */

export type LocalActivitySource = "watch-ble" | "fit-import" | "restore";
/** Where the bytes originally came from, independent of how they reached this computer. */
export type LocalActivityProvenance = "watch" | "file" | "cloud-export";

export interface LocalActivityRecord {
  activityId: string;
  deviceId?: string;
  watchActivityId?: string;
  source: LocalActivitySource;
  provenance: LocalActivityProvenance;
  /** Path of the original file, relative to the local archive root. */
  filePath: string;
  /** Raw watch sync payload the record was decoded from. */
  payloadId?: number;
  format: "fit" | "coros-record";
  sha256: string;
  sizeBytes: number;
  /** verified: decoded and checksummed; undecoded: kept raw for a future decoder. */
  verification: "verified" | "undecoded" | "invalid";
  sportType: number;
  sportName?: string;
  name?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  movingTime?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  elevationGain?: number;
  originalName?: string;
  importedAt: string;
}

export interface LocalDevice {
  deviceId: string;
  name?: string;
  model?: string;
  firmware?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type LocalSyncRunKind = "activities" | "health-totals";
export type LocalSyncRunState = "running" | "done" | "failed" | "cancelled" | "interrupted";

export interface LocalSyncRun {
  id: number;
  deviceId?: string;
  kind: LocalSyncRunKind;
  startedAt: string;
  finishedAt?: string;
  state: LocalSyncRunState;
  receivedBytes: number;
  totalBytes?: number;
  newRecords: number;
  error?: string;
}

export interface LocalSyncCheckpoint {
  deviceId: string;
  fileIndex: number;
  selector: number;
  /** In-progress transfer file (archive-relative) holding `offsetBytes` verified bytes. */
  partialPath?: string;
  offsetBytes: number;
  totalBytes?: number;
  lastPayloadSha256?: string;
  lastCompleteAt?: string;
  updatedAt: string;
}

export type LocalHealthMetric =
  | "steps"
  | "distance"
  | "active_calories"
  | "active_time"
  | "resting_hr"
  | "hrv_rmssd"
  | "sleep_minutes"
  | "heart_rate"
  | "stress"
  | "breathing_rate"
  | "sleep_hrv";

export interface LocalHealthSample {
  deviceId: string;
  metric: LocalHealthMetric;
  /** Unix seconds (UTC). */
  ts: number;
  value: number;
  unit: string;
  validity?: "valid" | "partial" | "invalid";
  /** What produced the value, e.g. "ble:pedometer" or "restore". */
  source: string;
  provenance: LocalActivityProvenance;
  /** The watch's UTC offset when it recorded the value, when known. */
  utcOffsetMinutes?: number;
}

/** One sleep segment as the watch recorded it (start → end events). */
export interface LocalSleepSession {
  deviceId: string;
  /** Unix seconds, minute-rounded like the COROS app shows them. */
  startTs: number;
  endTs: number;
  /** Local day the sleep ends on, YYYYMMDD. */
  day: string;
  utcOffsetMinutes: number;
  totalMinutes: number;
  awakeMinutes: number;
  lightMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  awakeCount: number;
  minHr?: number;
  avgHr?: number;
  maxHr?: number;
  /** Stage ranges: seconds from `startTs`. */
  ranges: Array<{ offset: number; seconds: number; stage: "awake" | "light" | "deep" | "rem" }>;
  source: string;
}

/** Heart rate once a second for two minutes after a workout ended, from the watch's daily history. */
/** A Health Check taken on the watch. The watch's resting-HR setting it also records is not kept. */
export interface LocalHealthCheck {
  deviceId: string;
  /** Unix seconds (UTC). */
  ts: number;
  utcOffsetMinutes?: number;
  heartRate: number;
  hrvMs: number;
  breathingRate: number;
  spo2: number;
  stress: number;
  /** 1 Relaxed, 2 Low, 3 Medium, 4 High. */
  stressLevel: number;
  source: string;
}

export interface LocalWorkoutRecovery {
  deviceId: string;
  workoutStartTs: number;
  workoutEndTs: number;
  /** bpm; sample i is i + 1 seconds after the workout ended. */
  samples: number[];
  source: string;
}

export interface LocalHealthDay {
  /** Local calendar day, YYYYMMDD. */
  day: string;
  metrics: Partial<Record<LocalHealthMetric, { value: number; unit: string; method: string }>>;
}

/**
 * What a sync did with the training calendar:
 * - ok: sent (`listed` once the watch lists it), or `unchanged` (already on the watch, nothing written);
 * - error: not sent, or the watch didn't confirm it;
 * - foreignPlan: the watch holds a plan CorosLink didn't put there and the user hasn't allowed
 *   replacing it (allowWatchPlanReplacement); nothing on the watch was changed.
 * `skipped` (ok results only, absent when none): workouts in the window left off the watch, by reason.
 */
export interface WatchCalendarSkipped {
  /** Zone or percentage targets, which the watch can't resolve. */
  zoneTargets?: number;
  /** No steps, or a value the watch can't take. */
  invalid?: number;
  /** Past the watch's limit of workouts per day (11). */
  perDay?: number;
  /** Past the calendar file's size limit (later days drop first). */
  fileSize?: number;
}

export type WatchCalendarResult =
  | { ok: true; workouts: number; listed?: boolean; unchanged?: boolean; skipped?: WatchCalendarSkipped; error?: undefined; foreignPlan?: undefined }
  | { ok: false; error: string; foreignPlan?: undefined; workouts?: undefined }
  | { ok: false; foreignPlan: true; error?: undefined; workouts?: undefined };

export interface WatchSyncProgress {
  state: "idle" | "connecting" | "reading" | "saving" | "decoding" | "done" | "failed" | "cancelled";
  kind?: LocalSyncRunKind;
  receivedBytes: number;
  totalBytes?: number;
  newActivities: number;
  /** Records kept raw because no decoder recognises them yet. */
  undecodedPayloads: number;
  /** GPS assistance sent to the watch (Local-Only Mode): COROS files sent and when the main file runs out. */
  satellite?: { ok: boolean; files?: number; coveredUntil?: number; error?: string };
  /** The training calendar sent to the watch (Local-Only Mode); absent when there was nothing to send. */
  calendar?: WatchCalendarResult;
  /** The health-history part of a full sync ("Sync watch now"); absent on activity-only progress updates. */
  health?: {
    ok: boolean;
    /** Unix seconds of the newest heart-rate, stress or HRV reading the watch had. */
    latestReadingAt?: number;
    newSleeps?: number;
    error?: string;
  };
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface LocalDataOverview {
  activities: { total: number; fromWatch: number; imported: number };
  devices: LocalDevice[];
  lastActivitySync?: LocalSyncRun;
  lastHealthSync?: LocalSyncRun;
  recentRuns: LocalSyncRun[];
  storageBytes: number;
  watchKeySaved: boolean;
  watchConnected: boolean;
  watchName?: string;
  /** Watch sync is experimental until the PACE 4 protocol is confirmed on hardware. */
  watchSyncSupport: "experimental" | "unsupported";
  watchSyncUnsupportedReason?: string;
  healthDays: number;
  /** Developer protocol capture is on (COROSLINK_SYNC_CAPTURE=1). */
  captureEnabled: boolean;
  captureDirectory?: string;
}

/** Result of reading the first activity block without acknowledging it. */
export interface WatchSyncProbe {
  ok: boolean;
  /** Bytes the watch reports for the whole activity file. */
  totalBytes?: number;
  blockBytes?: number;
  /** First 64 bytes of the block, for recognising the format. */
  firstBytesHex?: string;
  looksLike?: "hf-container" | "fit" | "unknown";
  blocksRead?: number;
  bytesRead?: number;
  error?: string;
  captureFile?: string;
  /** Raw bytes read by the probe (developer capture only). */
  rawFile?: string;
}

export interface LocalImportResult {
  imported: number;
  duplicates: number;
  failed: Array<{ name: string; error: string }>;
  activityIds: string[];
}

export interface LocalBackupResult {
  saved: boolean;
  filePath?: string;
  activities?: number;
  healthSamples?: number;
  encrypted?: boolean;
}

export interface LocalRestoreResult {
  restored: boolean;
  activitiesAdded: number;
  activitiesSkipped: number;
  healthSamplesAdded: number;
  verifiedFiles: number;
}
