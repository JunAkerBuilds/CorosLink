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
  mapPath?: string;
  mapSizeBytes?: number;
  mapFileCount?: number;
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
  mapPath?: string;
  mapSizeBytes?: number;
  mapFileCount?: number;
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
  entryType?: "video" | "playlist" | "search";
  query?: string;
  fileBaseName?: string;
  phase?: DownloadActivityPhase;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  trackProgress?: number;
  activity?: string;
  completedTrackCount?: number;
  warning?: string;
}

export type DownloadQueueItem =
  | {
      url: string;
      title?: string;
    }
  | {
      source: "search";
      query: string;
      title: string;
      sourceUrl: string;
      fileBaseName?: string;
    };

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

export interface YouTubeDataConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YouTubeDataStatus {
  configured: boolean;
  authenticated: boolean;
  redirectUri: string;
  displayName?: string;
  channelId?: string;
  tokenExpiresAt?: string;
}

export interface YouTubeDataPlaylist {
  id: string;
  title: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  totalItems: number;
}

export interface YouTubeDataPlaylistItem {
  id: string;
  playlistId: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  videoUrl: string;
}

export interface YouTubeMusicStatus {
  configured: boolean;
  pythonAvailable: boolean;
  ytmusicapiAvailable: boolean;
  authenticated: boolean;
  authMethod?: "headers" | "oauth";
  authUpdatedAt?: string;
  syncedAt?: string;
  songCount: number;
  albumCount: number;
  playlistCount: number;
  dependencyError?: string;
}

export interface YouTubeMusicConfig {
  clientId: string;
  clientSecret: string;
}

export interface YouTubeMusicSong {
  id: string;
  videoId?: string;
  songTitle: string;
  albumTitle?: string;
  artistName?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface YouTubeMusicAlbum {
  id: string;
  browseId?: string;
  playlistId?: string;
  albumTitle: string;
  artistName?: string;
  year?: string;
  thumbnailUrl?: string;
  songCount: number;
  songs: YouTubeMusicSong[];
}

export interface YouTubeMusicPlaylist {
  id: string;
  playlistId?: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  songCount: number;
  songs: YouTubeMusicSong[];
}

export interface YouTubeMusicLibrary {
  albums: YouTubeMusicAlbum[];
  songs: YouTubeMusicSong[];
  playlists: YouTubeMusicPlaylist[];
  syncedAt?: string;
}

export interface YouTubeMusicSyncResult extends YouTubeMusicLibrary {
  status: YouTubeMusicStatus;
}

export interface AppleMusicStatus {
  authenticated: boolean;
  hasUserToken: boolean;
  authUpdatedAt?: string;
}

export interface AppleMusicTrack {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  durationMs?: number;
  trackNumber?: number;
  isrc?: string;
  artworkUrl?: string;
  catalogUrl?: string;
}

export interface AppleMusicPlaylist {
  id: string;
  kind: "catalog" | "library";
  name: string;
  description?: string;
  curatorName?: string;
  lastModifiedAt?: string;
  artworkUrl?: string;
  url?: string;
  trackCount: number;
  tracks: AppleMusicTrack[];
}

export interface TransferResult {
  copiedTrack: WatchTrack;
  watch: WatchStatus;
}

export type CorosMapType = "landscape" | "topo";

export interface CorosMapPackage {
  id: string;
  region: string;
  parent: string;
  title: string;
  type: CorosMapType;
  sizeBytes: number;
  link: string;
  downloadUrl: string;
  version: string;
  bundleVersion?: string;
  updatedAt?: string;
}

export interface CorosMapManifest {
  version: string;
  bundleVersion?: string;
  updatedAt?: string;
  totalSizeBytes?: number;
  packages: CorosMapPackage[];
}

export type CorosMapDownloadStatus =
  | "queued"
  | "downloading"
  | "cached"
  | "failed"
  | "cancelled";

export interface CorosMapDownloadJob {
  id: string;
  packageId: string;
  title: string;
  region: string;
  type: CorosMapType;
  downloadUrl: string;
  sizeBytes: number;
  status: CorosMapDownloadStatus;
  progress: number;
  receivedBytes: number;
  filePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CachedCorosMapPackage {
  packageId: string;
  title: string;
  region: string;
  parent: string;
  type: CorosMapType;
  sizeBytes: number;
  downloadUrl: string;
  filePath: string;
  extractedPath?: string;
  downloadedAt: string;
}

export interface CorosMapLocalSelection {
  sourcePath: string;
  mapPath: string;
  sizeBytes: number;
  fileCount: number;
}

export interface CorosMapInstallResult extends CorosMapLocalSelection {
  installedPath: string;
  watch: WatchStatus;
}

export type CorosMapInstallPhase =
  | "preparing"
  | "copying"
  | "completed"
  | "failed"
  | "cancelled";

export interface CorosMapInstallProgress {
  active: boolean;
  phase: CorosMapInstallPhase;
  label: string;
  sourcePath?: string;
  installedPath?: string;
  copiedBytes: number;
  totalBytes: number;
  copiedFiles: number;
  totalFiles: number;
  progress: number;
  error?: string;
  updatedAt: string;
}

export type RouteMode = "loop" | "point-to-point";
export type RouteSurfacePreference = "road" | "trail";
export type RouteElevationPreference = "any" | "flatter" | "hilly";
export type RouteActivityType =
  | "walking"
  | "running"
  | "hiking"
  | "cycling-road"
  | "cycling-mountain";

export interface RouteBuilderConfig {
  openRouteServiceApiKey: string;
}

export interface RouteApiKeyValidation {
  status: "valid" | "invalid" | "quota" | "error" | "empty";
  message: string;
}

export interface ActivityPaceBaseline {
  /** Typical (median) pace in seconds per kilometre for a sport. */
  secondsPerKm: number;
  /** Number of stored activities the pace was derived from. */
  sampleSize: number;
}

/** Personal pace baselines keyed by route activity type (only sports with data). */
export type ActivityPaceBaselines = Partial<
  Record<RouteActivityType, ActivityPaceBaseline>
>;

export interface RouteShareSession {
  /** Full LAN URL the QR encodes; the phone fetches the GPX from here. */
  url: string;
  /** PNG data URL of the QR code for the share URL. */
  qrDataUrl: string;
  fileName: string;
  /** LAN IP the GPX is served from (shown for troubleshooting). */
  lanAddress: string;
  /** ISO timestamp when the share link auto-expires. */
  expiresAt: string;
}

export interface RouteGeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

export interface GenerateRouteRequest {
  startLocation: string;
  destinationLocation?: string;
  distanceKm: number;
  mode: RouteMode;
  activityType: RouteActivityType;
  surfacePreference: RouteSurfacePreference;
  avoidHighways: boolean;
  elevationPreference: RouteElevationPreference;
  /**
   * Optional nudge used only for loop routes. Changing it produces a different
   * loop for the same inputs (powers the "Regenerate" control). Absent keeps the
   * deterministic default behaviour.
   */
  variationSeed?: number;
}

export interface GeneratedRoute {
  id: string;
  name: string;
  createdAt: string;
  startLocation: string;
  destinationLocation?: string;
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  mode: RouteMode;
  activityType: RouteActivityType;
  surfacePreference: RouteSurfacePreference;
  avoidHighways: boolean;
  elevationPreference: RouteElevationPreference;
  points: TrainingHubTrackPoint[];
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  gpxPath?: string;
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
  /** macOS ad-hoc builds cannot self-install; user must open the release asset. */
  installMethod?: "restart" | "manual";
  manualInstallUrl?: string;
}
