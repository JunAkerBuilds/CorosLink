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

export type WatchModelId =
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
  | "apex-2-pro";

export type WatchConnectionSmokeOptionId =
  | "auto"
  | "none"
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
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

/**
 * Result pushed to the renderer when the embedded YouTube Music sign-in captures
 * credentials: the refreshed status on success, or a message if the ytmusicapi
 * setup failed (e.g. Python/ytmusicapi missing).
 */
export type YouTubeMusicAuthCapture =
  | { status: YouTubeMusicStatus; error?: undefined }
  | { status?: undefined; error: string };

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

/**
 * Which routing/geocoding backend the Route Studio uses.
 * - `keyless` (default): BRouter + Nominatim, no signup required.
 * - `ors`: OpenRouteService, requires a saved API key (power users).
 */
export type RouteBackend = "keyless" | "ors";

export interface RouteBuilderConfig {
  /** Optional OpenRouteService key; only used when `backend` is `ors`. */
  openRouteServiceApiKey: string;
  /** Selected routing backend. Absent is treated as `keyless`. */
  backend?: RouteBackend;
}

/** A single map waypoint the draw tool routes through. */
export interface RouteWaypoint {
  lat: number;
  lon: number;
}

/**
 * Request for the interactive draw tool. `snap` routes each leg along real
 * roads/trails (BRouter); otherwise legs are straight lines.
 */
export interface RouteWaypointRequest {
  waypoints: RouteWaypoint[];
  activityType: RouteActivityType;
  snap: boolean;
}

/** Geometry + stats for a routed path, without any persistence. */
export interface RouteGeometry {
  points: TrainingHubTrackPoint[];
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
}

/** Payload used to persist a finished drawn route. */
export interface DrawnRoutePayload {
  name?: string;
  waypoints: RouteWaypoint[];
  points: TrainingHubTrackPoint[];
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  activityType: RouteActivityType;
  /** True when the path returns to its start (a loop). */
  closed: boolean;
  snap: boolean;
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
  description?: string;
  artworkUrl?: string;
  url?: string;
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
  artworkUrl?: string;
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
  rememberCredentials?: boolean;
  email?: string;
}

// COROS `/activity/detail/download` file-type codes. Verified against the live
// teamapi.coros.com endpoint: 0=CSV, 1=GPX, 2=KML, 3=TCX, 4=FIT (5/6 are rejected).
export type TrainingHubActivityFileType = 0 | 1 | 2 | 3 | 4;

export interface TrainingHubExportFormat {
  fileType: TrainingHubActivityFileType;
  /** Short label shown in the UI, e.g. "GPX". */
  label: string;
  /** Lower-case file extension without a leading dot, e.g. "gpx". */
  extension: string;
  /** One-line hint describing what the format is good for. */
  description: string;
}

// Ordered for the export menu: the everyday formats first, raw data last.
export const TRAINING_HUB_EXPORT_FORMATS: readonly TrainingHubExportFormat[] = [
  {
    fileType: 4,
    label: "FIT",
    extension: "fit",
    description: "Original COROS activity file"
  },
  {
    fileType: 1,
    label: "GPX",
    extension: "gpx",
    description: "GPS track for GPX Studio, Plotaroute, sharing"
  },
  {
    fileType: 3,
    label: "TCX",
    extension: "tcx",
    description: "Training Center XML with heart rate & laps"
  },
  {
    fileType: 2,
    label: "KML",
    extension: "kml",
    description: "Route for Google Earth"
  },
  {
    fileType: 0,
    label: "CSV",
    extension: "csv",
    description: "Raw data points as a spreadsheet"
  }
];

export interface TrainingHubExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  /** Absolute path the file was written to, when saved. */
  filePath?: string;
  /** Activity metadata for convenience messages after a save dialog closes. */
  activityId?: string;
  activityName?: string;
  activityStartTime?: number;
  fileType?: TrainingHubActivityFileType;
  formatLabel?: string;
}

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

export interface TrainingHubActivitySeriesPoint {
  distance?: number;
  hr?: number;
  pace?: number;
  power?: number;
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
  series?: TrainingHubActivitySeriesPoint[];
  raw: Record<string, unknown>;
}

export interface TrainingHubScheduledExercise {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  targetType?: number;
  targetLabel?: string;
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
  exercises?: TrainingHubScheduledExercise[];
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
  /** When false, the app does not check for updates automatically on startup. */
  autoCheck: boolean;
  /** When false, available updates are not downloaded until the user asks. */
  autoDownload: boolean;
}

// ----- Training Coach chatbot -----

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Optional assistant attribution metadata stored with a message. */
export interface PersistedChatSource {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

export interface PersistedChatMessageEntry {
  kind: "message";
  role: ChatRole;
  content: string;
  source?: PersistedChatSource;
}

export type ChatProvider = "chatgpt" | "local";

export interface LocalChatConfig {
  /** OpenAI-compatible API base URL, normalized to end in /v1. */
  baseUrl: string;
  /** Model id as listed by the local server, e.g. llama3.2 or qwen3:8b. */
  model: string;
  /** True when an encrypted API key is stored; token material is never returned. */
  hasApiKey: boolean;
  /** Optional token used only when saving/testing settings; never returned by get. */
  apiKey?: string;
  /** Set true when saving to remove any stored local API key. */
  clearApiKey?: boolean;
  /** Attach COROS MCP tools when the local endpoint accepts OpenAI-style tools. */
  toolsEnabled: boolean;
}

export interface ChatSettings {
  provider: ChatProvider;
  local: LocalChatConfig;
  sidebarOpen?: boolean;
  /** When false, hide activity/fitness/HR chart cards in the transcript. Default true. */
  visualizationsEnabled?: boolean;
}

export interface ChatSessionSummary {
  id: string;
  provider: ChatProvider;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

export interface LocalChatConnectionTest {
  ok: boolean;
  message: string;
  normalizedBaseUrl?: string;
  models?: string[];
}

export type LocalChatServerKind = "ollama" | "lmstudio";

export interface LocalChatServerCandidate {
  kind: LocalChatServerKind;
  label: string;
  baseUrl: string;
  ok: boolean;
  models: string[];
  message?: string;
}

export interface LocalChatDiscovery {
  servers: LocalChatServerCandidate[];
}

/** Sign-in state surfaced to the renderer; never includes token material. */
export interface ChatAuthStatus {
  signedIn: boolean;
  /** From the id_token, for display in the header when signed in. */
  email?: string;
  /** Access-token expiry (unix seconds), for debugging/telemetry only. */
  expiresAt?: number;
}

/**
 * OAuth token blob persisted encrypted via safeStorage. Mirrors the Codex
 * "Sign in with ChatGPT" token set. Kept in the main process only.
 */
export interface StoredChatToken {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  /** ChatGPT account id from the id_token's OpenAI auth claim. */
  account_id?: string;
  email?: string;
  /** Unix seconds: now + expires_in at the time of issue/refresh. */
  expires_at: number;
  token_type: string;
}

// ----- COROS MCP (Model Context Protocol) connection -----

export interface CorosMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface CorosMcpStatus {
  /** A live MCP client session is open. */
  connected: boolean;
  /** OAuth tokens are stored (can reconnect without a browser). */
  authorized: boolean;
  /** Tools discovered from the server. */
  tools: CorosMcpTool[];
}

// Streaming chat is push-based: `chat:send` kicks off the request and the
// assistant text arrives via these main->renderer events, correlated by
// requestId. Renderers must not await `chat:send` for content.
export interface ChatStreamStart {
  requestId: string;
}

export interface ChatStreamToken {
  requestId: string;
  delta: string;
}

export interface ChatStreamDone {
  requestId: string;
  fullText: string;
  finishReason?: string;
}

export interface ChatStreamError {
  requestId: string;
  message: string;
  /** True when the failure is an expired/invalid session (drop to login gate). */
  authError?: boolean;
}

/**
 * Diagnostic signal about where the answer's data is coming from: the static
 * training snapshot injected into `instructions`, and/or live COROS MCP tool
 * calls the model makes mid-stream.
 */
export type ChatStreamInfo =
  | {
      requestId: string;
      kind: "context";
      /** True when real COROS activity/metrics were injected as a snapshot. */
      snapshotIncluded: boolean;
      /** True when the COROS MCP tool was attached to the request. */
      mcpEnabled: boolean;
    }
  | {
      requestId: string;
      kind: "mcp";
      /** The MCP tool name, when known. */
      tool?: string;
      /** Raw event type, e.g. "response.mcp_call.completed". */
      status: string;
      message?: string;
    }
  | {
      requestId: string;
      kind: "planDraft";
      draft: PlanDraftPreview;
    }
  | {
      requestId: string;
      kind: "workoutDelete";
      preview: WorkoutDeletePreview;
    }
  | {
      requestId: string;
      kind: "activityVisual";
      preview: ActivityVisualPreview;
    }
  | {
      requestId: string;
      kind: "fitnessTrend";
      preview: FitnessTrendPreview;
    }
  | {
      requestId: string;
      kind: "hrZoneSummary";
      preview: HrZonePreview;
    };

// ----- Training plan upload (AI coach) -----

export interface TrainingTrendPoint {
  date: string;
  label: string;
  trainingLoad?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  rhr?: number;
}

export interface ActivityVisualLapPoint {
  index: number;
  avgHr?: number;
  maxHr?: number;
  distance?: number;
  duration?: number;
  pace?: number;
}

export interface ActivityVisualHrSection {
  chartKind: "series" | "laps";
  series?: TrainingHubActivitySeriesPoint[];
  laps?: ActivityVisualLapPoint[];
}

export interface ActivityVisualPreview {
  previewId: string;
  activityId: string;
  name?: string;
  startTime?: string;
  avgHr?: number;
  maxHr?: number;
  sections: {
    hr?: ActivityVisualHrSection;
    pace?: { series: TrainingHubActivitySeriesPoint[] };
    power?: { series: TrainingHubActivitySeriesPoint[] };
    elevation?: { points: TrainingHubTrackPoint[] };
    laps?: ActivityVisualLapPoint[];
  };
}

/** @deprecated Legacy persisted shape — migrated to ActivityVisualPreview */
export interface ActivityHrTrendLapPoint {
  index: number;
  avgHr?: number;
  maxHr?: number;
  distance?: number;
}

/** @deprecated Legacy persisted shape — migrated to ActivityVisualPreview */
export interface ActivityHrTrendPreview {
  previewId: string;
  activityId: string;
  name?: string;
  startTime?: string;
  avgHr?: number;
  maxHr?: number;
  chartKind: "series" | "laps";
  series?: TrainingHubActivitySeriesPoint[];
  laps?: ActivityHrTrendLapPoint[];
}

export interface FitnessTrendPreview {
  previewId: string;
  trendPoints: TrainingTrendPoint[];
}

export interface HrZoneEntry {
  index: number;
  label: string;
  percent: number;
  value: number;
}

export interface HrZonePreview {
  previewId: string;
  metric: "time" | "distance" | "trainingLoad";
  zones: HrZoneEntry[];
  lthrZones: TrainingHubThresholdZone[];
}

export interface PlanDraftPreviewEntry {
  key: string;
  name: string;
  scheduleDate?: string;
  volume?: string;
  saveToLibrary: boolean;
  workoutType: string;
  stepsSummary?: string;
}

export interface PlanDraftPreview {
  draftId: string;
  name: string;
  summary: string;
  entries: PlanDraftPreviewEntry[];
  conflicts: string[];
  warnings: string[];
  uploadedAt?: number;
  uploadResult?: {
    workoutsScheduled: number;
    workoutsCreated: number;
  };
}

export interface PlanWorkoutEntryInput {
  key: string;
  name: string;
  steps?: unknown[];
  distance_km?: number;
  schedule_date?: string;
  sort_no?: number;
  save_to_library?: boolean;
}

export interface CorosTrainingPlanDraftInput {
  name: string;
  workouts: PlanWorkoutEntryInput[];
}

export interface UploadPlanResultEntry {
  key: string;
  name: string;
  date?: string;
  programId?: string;
  scheduled: boolean;
  savedToLibrary: boolean;
}

export interface UploadPlanResult {
  planName: string;
  workoutsCreated: number;
  workoutsScheduled: number;
  entries: UploadPlanResultEntry[];
}

export interface TrainingHubScheduledWorkoutEntry {
  planId: string;
  idInPlan: string;
  planProgramId: string;
  happenDay: string;
  name: string;
  programId?: string;
  sortNo?: number;
  volume?: string;
  trainingLoad?: number;
  exercises?: TrainingHubScheduledExercise[];
}

export interface DeleteWorkoutResult {
  removedFromSchedule: boolean;
  removedFromLibrary: boolean;
  workoutName?: string;
  scheduleDate?: string;
  programId?: string;
  message: string;
}

export interface WorkoutDeletePreview {
  requestId: string;
  target: "scheduled" | "library" | "both";
  workoutName?: string;
  scheduleDate?: string;
  programId?: string;
  summary: string;
}

/** Persisted coach timeline entry (messages plus inline action cards). */
export type PersistedChatEntry =
  | PersistedChatMessageEntry
  | { kind: "planDraft"; draft: PlanDraftPreview }
  | { kind: "workoutDelete"; preview: WorkoutDeletePreview }
  | { kind: "activityVisual"; preview: ActivityVisualPreview }
  | { kind: "activityHrTrend"; preview: ActivityHrTrendPreview }
  | { kind: "fitnessTrend"; preview: FitnessTrendPreview }
  | { kind: "hrZoneSummary"; preview: HrZonePreview };
