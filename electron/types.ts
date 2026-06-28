export type BinaryName = "yt-dlp" | "ffmpeg";

export interface BinaryCheck {
  name: BinaryName;
  available: boolean;
  command?: string;
  source: "bundled" | "path" | "missing";
  version?: string;
  error?: string;
}

export interface BinaryStatus {
  ytDlp: BinaryCheck;
  ffmpeg: BinaryCheck;
}

export interface DriveCandidate {
  name: string;
  rootPath: string;
  musicPath?: string;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  reason: string;
}

export interface WatchTrack {
  name: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export type WatchModelId = "pace-pro" | "pace-4" | "pace-3" | "nomad";

export type WatchConnectionSmokeOptionId =
  | "auto"
  | "none"
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "nomad"
  | "unknown-pace"
  | "installer";

export interface WatchStatus {
  connected: boolean;
  checkedAt: string;
  name?: string;
  model?: WatchModelId;
  rootPath?: string;
  musicPath?: string;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  tracks: WatchTrack[];
  candidates: DriveCandidate[];
  error?: string;
}

export interface LocalTrack {
  id: string;
  url: string;
  title: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  transferredAt?: string;
}

export interface DownloadAudioResult {
  tracks: LocalTrack[];
  output: string[];
  warnings?: string[];
}

export type DownloadJobStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadActivityPhase =
  | "starting"
  | "downloading"
  | "converting"
  | "between_tracks"
  | "completed"
  | "failed";

export interface DownloadProgressUpdate {
  trackProgress?: number;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  phase?: DownloadActivityPhase;
  activity?: string;
  completedTrackIncrement?: number;
}

export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: DownloadJobStatus;
  progress: number;
  error?: string;
  tracks: LocalTrack[];
  createdAt: string;
  updatedAt: string;
  entryType?: "video" | "playlist";
  phase?: DownloadActivityPhase;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  trackProgress?: number;
  activity?: string;
  completedTrackCount?: number;
  warning?: string;
}

export type YouTubeHistoryEntryType =
  | "video"
  | "playlist"
  | "search"
  | "youtube";

export interface YouTubeHistoryEntry {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
  visits: number;
  lastVisitedAt: string;
  downloadedAt?: string;
}

export interface TransferResult {
  copiedTrack: WatchTrack;
  watch: WatchStatus;
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SpotifyStatus {
  configured: boolean;
  authenticated: boolean;
  redirectUri: string;
  displayName?: string;
  userId?: string;
  tokenExpiresAt?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  collaborative: boolean;
  public: boolean | null;
  totalTracks: number;
  snapshotId: string;
  syncable: boolean;
}

export interface SpotifyPlaylistTrack {
  spotifyTrackId: string;
  artistName: string;
  trackName: string;
  albumName?: string;
  durationMs?: number;
  addedAt?: string;
  filename: string;
  query: string;
}

export type SpotifySyncTrackStatus =
  | "queued"
  | "downloading"
  | "done"
  | "failed";

export interface SpotifySyncTrack {
  playlistId: string;
  spotifyTrackId: string;
  artistName: string;
  trackName: string;
  query: string;
  filename: string;
  status: SpotifySyncTrackStatus;
  localDownloadId?: string;
  filePath?: string;
  error?: string;
  updatedAt: string;
}

export interface SpotifySyncUpdate extends SpotifySyncTrack {}

export interface SpotifySyncResult {
  playlistId: string;
  tracks: SpotifySyncTrack[];
  completed: number;
  failed: number;
}

export interface TrainingHubStatus {
  authenticated: boolean;
  userId?: string;
  regionId?: string;
  baseUrl?: string;
}

export type TrainingHubActivityFileType = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TrainingHubActivity {
  activityId: string;
  name?: string;
  sportType: number;
  sportName?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  trainingLoad?: number;
  elevationGain?: number;
}

export interface TrainingHubDailyMetric {
  happenDay: string;
  trainingLoad?: number;
  rhr?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  tiredRateNew?: number;
  tiredRateStateNew?: number;
  trainingLoadRatio?: number;
  staminaLevel?: number;
  vo2max?: number;
  distance?: number;
  duration?: number;
}

export interface TrainingHubDailyMetrics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  raw?: Record<string, unknown>;
}

export interface TrainingHubSportStatistic {
  sportType?: number;
  sportName?: string;
  distance?: number;
  duration?: number;
  count?: number;
  trainingLoad?: number;
}

export interface TrainingHubZoneDistributionEntry {
  index: number;
  ratio?: number;
  value?: number;
}

export interface TrainingHubZoneDistributions {
  hrTrainingLoad: TrainingHubZoneDistributionEntry[];
  hrDistance: TrainingHubZoneDistributionEntry[];
  hrTime: TrainingHubZoneDistributionEntry[];
  distanceFrequency: TrainingHubZoneDistributionEntry[];
  distanceTrainingLoad: TrainingHubZoneDistributionEntry[];
  distanceTime: TrainingHubZoneDistributionEntry[];
}

export interface TrainingHubAnalytics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  sportStatistics: TrainingHubSportStatistic[];
  zoneDistributions: TrainingHubZoneDistributions;
  raw?: Record<string, unknown>;
}

export interface TrainingHubRaceScore {
  distance?: number;
  distanceLabel?: string;
  predictSeconds?: number;
  avgPace?: number;
  score?: number;
  raw?: Record<string, unknown>;
}

export interface TrainingHubRacePredictor {
  staminaLevel?: number;
  recoveryPct?: number;
  aerobicEnduranceScore?: number;
  lactateThresholdCapacityScore?: number;
  anaerobicEnduranceScore?: number;
  anaerobicCapacityScore?: number;
  lthr?: number;
  ltsp?: number;
  runScoreList: TrainingHubRaceScore[];
  raw?: Record<string, unknown>;
}

export interface TrainingHubActivityLap {
  index: number;
  distance?: number;
  duration?: number;
  avgHr?: number;
  maxHr?: number;
  pace?: number;
  elevationGain?: number;
}

export interface TrainingHubTrackPoint {
  lat?: number;
  lon?: number;
  elevation?: number;
  distance?: number;
}

export interface TrainingHubActivityTrack {
  points: TrainingHubTrackPoint[];
}

export interface TrainingHubActivityDetail {
  activityId?: string;
  name?: string;
  sportType?: number;
  startTime?: number;
  duration?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  elevationGain?: number;
  trainingLoad?: number;
  laps: TrainingHubActivityLap[];
  track?: TrainingHubActivityTrack;
  raw: Record<string, unknown>;
}

export interface TrainingHubSportType {
  sportType: number;
  sportName: string;
}

export interface TrainingHubUpcomingWorkout {
  happenDay: string;
  name: string;
  volume?: string;
  trainingLoad?: number;
  sportType?: number;
  sortNo?: number;
}

export interface TrainingHubThresholdZone {
  index: number;
  hr?: number;
  pace?: number;
  ratio?: number;
}

export interface TrainingHubPersonalRecord {
  type: number;
  label: string;
  name?: string;
  distance?: number;
  duration?: number;
  avgPace?: number;
  happenDay?: string;
  activityId?: string;
  /** Raw COROS record `type` before alias resolution (used when deduping). */
  apiType?: number;
}

export interface TrainingHubPersonalRecordGroup {
  type: number;
  label: string;
  records: TrainingHubPersonalRecord[];
}

export interface TrainingHubSleepHrvReading {
  happenDay: string;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
}

export interface TrainingHubSleepHrvSummary {
  happenDay?: string;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  remainWearDays?: number;
  recentReadings: TrainingHubSleepHrvReading[];
}

export interface TrainingHubDashboard {
  racePredictor: TrainingHubRacePredictor;
  rhr?: number;
  recoveryPct?: number;
  recoveryState?: number;
  fullRecoveryHours?: number;
  fitnessMaxHr?: number;
  runningLevelHr?: number;
  lthrZones: TrainingHubThresholdZone[];
  ltspZones: TrainingHubThresholdZone[];
  personalRecords: TrainingHubPersonalRecordGroup[];
  sleepHrv?: TrainingHubSleepHrvSummary;
  sportDataCount?: number;
  raw?: Record<string, unknown>;
}

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdateSnapshot {
  supported: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  availableVersion?: string;
  downloadPercent?: number;
  releaseNotes?: string;
  error?: string;
}
