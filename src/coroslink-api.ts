import type {
  ActivityBackupProgress,
  BinaryStatus,
  CachedCorosMapPackage,
  CorosMapDownloadJob,
  CorosMapInstallResult,
  CorosMapInstallProgress,
  CorosMapLocalSelection,
  CorosMapManifest,
  CorosMapPackage,
  DownloadAudioResult,
  DownloadJob,
  DownloadQueueItem,
  DrawnRoutePayload,
  GenerateRouteRequest,
  GeneratedRoute,
  LocalTrack,
  RouteActivityType,
  RouteApiKeyValidation,
  RouteBuilderConfig,
  RouteGeocodeResult,
  RouteGeometry,
  RouteWaypointRequest,
  ActivityPaceBaselines,
  RouteShareSession,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  SpotifySyncResult,
  SpotifySyncTrack,
  SpotifySyncUpdate,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubExportResult,
  TrainingHubAnalytics,
  TrainingHubDailyHealthSummary,
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubSleepSummary,
  TrainingHubRacePredictor,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubLibraryWorkout,
  PlanWorkoutEntryInput,
  TransferResult,
  AppInfo,
  AppUpdateSnapshot,
  WatchConnectionSmokeOptionId,
  WatchStatus,
  YouTubeHistoryEntry,
  YouTubeMusicAuthCapture,
  YouTubeMusicConfig,
  YouTubeMusicLibrary,
  YouTubeMusicStatus,
  YouTubeMusicSyncResult,
  AppleMusicPlaylist,
  AppleMusicStatus,
  ApplePodcastShow,
  ApplePodcastShowDetail,
  ChatAuthStatus,
  ChatMessage,
  ChatProvider,
  ChatSessionSummary,
  ChatSettings,
  PersistedChatEntry,
  ChatStreamStart,
  ChatStreamToken,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamInfo,
  LocalChatConfig,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  CorosMcpStatus,
  CorosMcpTool,
  CorosTrainingPlanDraftInput,
  UploadPlanResult,
  IntervalsStatus,
  IntervalsActivityWithStatus,
  DeleteWorkoutResult,
  ManualActivityInput
} from "../electron/types";

export interface CorosLinkApi {
  platform: string;
  getWatchStatus: () => Promise<WatchStatus>;
  getWatchConnectionSmokeOption: () => Promise<WatchConnectionSmokeOptionId>;
  setWatchConnectionSmokeOption: (
    optionId: WatchConnectionSmokeOptionId
  ) => Promise<WatchStatus>;
  deleteWatchTrack: (relativePath: string) => Promise<WatchStatus>;
  transferLocalTrack: (id: string) => Promise<TransferResult>;
  listDownloads: () => Promise<LocalTrack[]>;
  downloadAudio: (url: string) => Promise<DownloadAudioResult>;
  deleteDownload: (id: string, removeFile: boolean) => Promise<LocalTrack[]>;
  getBinaryStatus: () => Promise<BinaryStatus>;
  listYouTubeHistory: () => Promise<YouTubeHistoryEntry[]>;
  recordYouTubeVisit: (
    url: string,
    title?: string
  ) => Promise<YouTubeHistoryEntry>;
  downloadFromYouTubeBrowser: (
    url: string,
    title?: string
  ) => Promise<DownloadAudioResult>;
  downloadMultipleFromYouTubeBrowser: (
    items: Array<{ url: string; title?: string }>
  ) => Promise<DownloadAudioResult>;
  enqueueYouTubeDownloads: (
    items: DownloadQueueItem[]
  ) => Promise<DownloadJob[]>;
  listYouTubeJobs: () => Promise<DownloadJob[]>;
  clearYouTubeJob: (id: string) => Promise<DownloadJob[]>;
  cancelYouTubeJob: (id: string) => Promise<DownloadJob[]>;
  clearCompletedYouTubeJobs: () => Promise<DownloadJob[]>;
  onYouTubeJobsUpdate: (
    callback: (jobs: DownloadJob[]) => void
  ) => () => void;
  resetYouTubeBrowserSession: () => Promise<void>;
  getYouTubeMusicConfig: () => Promise<YouTubeMusicConfig>;
  saveYouTubeMusicConfig: (
    config: YouTubeMusicConfig
  ) => Promise<YouTubeMusicStatus>;
  getYouTubeMusicStatus: () => Promise<YouTubeMusicStatus>;
  saveYouTubeMusicAuth: (headersRaw: string) => Promise<YouTubeMusicStatus>;
  loginYouTubeMusic: () => Promise<YouTubeMusicStatus>;
  logoutYouTubeMusic: () => Promise<YouTubeMusicStatus>;
  resetYouTubeMusicBrowserSession: () => Promise<void>;
  onYouTubeMusicAuthCaptured: (
    callback: (result: YouTubeMusicAuthCapture) => void
  ) => () => void;
  listYouTubeMusicLibrary: () => Promise<YouTubeMusicLibrary>;
  syncYouTubeMusicLibrary: () => Promise<YouTubeMusicSyncResult>;
  getAppleMusicStatus: () => Promise<AppleMusicStatus>;
  saveAppleMusicAuth: (headersRaw: string) => Promise<AppleMusicStatus>;
  logoutAppleMusic: () => Promise<AppleMusicStatus>;
  resetAppleMusicBrowserSession: () => Promise<void>;
  onAppleMusicAuthCaptured: (
    callback: (status: AppleMusicStatus) => void
  ) => () => void;
  listAppleMusicPlaylists: () => Promise<AppleMusicPlaylist[]>;
  fetchAppleMusicPlaylist: (playlist: string) => Promise<AppleMusicPlaylist>;
  searchApplePodcasts: (query: string) => Promise<ApplePodcastShow[]>;
  loadApplePodcast: (
    showIdOrUrl: string
  ) => Promise<ApplePodcastShowDetail>;
  getSpotifyConfig: () => Promise<SpotifyConfig>;
  saveSpotifyConfig: (config: SpotifyConfig) => Promise<SpotifyStatus>;
  getSpotifyStatus: () => Promise<SpotifyStatus>;
  loginSpotify: () => Promise<SpotifyStatus>;
  logoutSpotify: () => Promise<SpotifyStatus>;
  listSpotifyPlaylists: () => Promise<SpotifyPlaylist[]>;
  listSpotifyPlaylistTracks: (
    playlistId: string
  ) => Promise<SpotifyPlaylistTrack[]>;
  listSpotifySyncState: (playlistId: string) => Promise<SpotifySyncTrack[]>;
  syncSpotifyPlaylist: (
    playlistId: string,
    autoTransfer: boolean
  ) => Promise<SpotifySyncResult>;
  onSpotifySyncUpdate: (
    callback: (update: SpotifySyncUpdate) => void
  ) => () => void;
  getTrainingHubStatus: () => Promise<TrainingHubStatus>;
  loginTrainingHub: (
    email: string,
    password: string,
    remember: boolean
  ) => Promise<TrainingHubStatus>;
  logoutTrainingHub: () => Promise<TrainingHubStatus>;
  reconnectTrainingHub: () => Promise<TrainingHubStatus>;
  listTrainingHubActivities: (
    page: number,
    size: number,
    startDay?: string,
    endDay?: string
  ) => Promise<TrainingHubActivity[]>;
  listScheduledWorkouts: (
    startDay: string,
    endDay: string
  ) => Promise<TrainingHubScheduledWorkoutEntry[]>;
  listLibraryWorkouts: () => Promise<TrainingHubLibraryWorkout[]>;
  scheduleLibraryWorkout: (
    programId: string,
    happenDay: string
  ) => Promise<void>;
  createAndScheduleWorkout: (
    entry: PlanWorkoutEntryInput,
    happenDay: string,
    saveToLibrary?: boolean
  ) => Promise<{ programId?: string }>;
  rescheduleWorkout: (
    entry: {
      planId: string;
      idInPlan: string;
      planProgramId?: string;
      happenDay: string;
    },
    newHappenDay: string
  ) => Promise<void>;
  removeScheduledWorkout: (entry: {
    planId: string;
    idInPlan: string;
    planProgramId?: string;
  }) => Promise<void>;
  getTrainingHubActivityDetail: (
    activityId: string,
    sportType: number,
    listActivity?: TrainingHubActivity
  ) => Promise<TrainingHubActivityDetail>;
  exportTrainingHubActivityFile: (
    activityId: string,
    sportType: number,
    fileType: TrainingHubActivityFileType,
    suggestedName?: string
  ) => Promise<TrainingHubExportResult>;
  exportLatestTrainingHubActivityFile: (
    fileType?: TrainingHubActivityFileType
  ) => Promise<TrainingHubExportResult>;
  chooseActivityBackupFolder: () => Promise<string | null>;
  startActivityBackup: (
    folder: string,
    fileType?: TrainingHubActivityFileType
  ) => Promise<ActivityBackupProgress>;
  cancelActivityBackup: () => Promise<ActivityBackupProgress | null>;
  getActivityBackupProgress: () => Promise<ActivityBackupProgress | null>;
  onActivityBackupProgress: (
    callback: (progress: ActivityBackupProgress) => void
  ) => () => void;
  getTrainingAnalytics: () => Promise<TrainingHubAnalytics>;
  getRacePredictor: () => Promise<TrainingHubRacePredictor>;
  getTrainingDashboard: () => Promise<TrainingHubDashboard>;
  getDailyMetrics: (dateList: string[]) => Promise<TrainingHubDailyMetrics>;
  getSportTypeMap: () => Promise<TrainingHubSportType[]>;
  getActivityPaceBaselines: () => Promise<ActivityPaceBaselines>;
  getUpcomingWorkouts: (days?: number) => Promise<TrainingHubUpcomingWorkout[]>;
  getTrainingSleepData: (days?: number) => Promise<TrainingHubSleepSummary>;
  getTrainingDailyHealthData: (
    days?: number
  ) => Promise<TrainingHubDailyHealthSummary>;
  uploadTrainingPlan: (
    draft: CorosTrainingPlanDraftInput
  ) => Promise<UploadPlanResult>;
  getIntervalsStatus: () => Promise<IntervalsStatus>;
  connectIntervals: (apiKey: string, athleteId: string) => Promise<IntervalsStatus>;
  disconnectIntervals: () => Promise<void>;
  listMissingIntervalsActivities: (
    daysBack: number
  ) => Promise<IntervalsActivityWithStatus[]>;
  importIntervalsActivity: (
    intervalsId: string,
    fileExt: "fit" | "tcx" | "unknown"
  ) => Promise<{ importId: string }>;
  addManualActivityToCoros: (
    input: ManualActivityInput
  ) => Promise<{ importId: string }>;
  getCorosMapManifest: () => Promise<CorosMapManifest>;
  openCorosMapDownload: (downloadUrl: string) => Promise<void>;
  downloadCorosMapPackage: (
    pkg: CorosMapPackage
  ) => Promise<CorosMapDownloadJob[]>;
  listCorosMapDownloadJobs: () => Promise<CorosMapDownloadJob[]>;
  cancelCorosMapDownload: (id: string) => Promise<CorosMapDownloadJob[]>;
  clearCorosMapDownloadJob: (id: string) => Promise<CorosMapDownloadJob[]>;
  onCorosMapDownloadJobsUpdate: (
    callback: (jobs: CorosMapDownloadJob[]) => void
  ) => () => void;
  listCachedCorosMaps: () => Promise<CachedCorosMapPackage[]>;
  getCorosMapInstallProgress: () => Promise<CorosMapInstallProgress | null>;
  cancelCorosMapInstall: () => Promise<CorosMapInstallProgress | null>;
  onCorosMapInstallProgressUpdate: (
    callback: (progress: CorosMapInstallProgress | null) => void
  ) => () => void;
  installCachedCorosMap: (packageId: string) => Promise<CorosMapInstallResult>;
  installCachedCorosMaps: (
    packageIds: string[]
  ) => Promise<CorosMapInstallResult>;
  deleteCachedCorosMap: (
    packageId: string
  ) => Promise<CachedCorosMapPackage[]>;
  chooseCorosMapFolder: () => Promise<CorosMapLocalSelection | undefined>;
  installCorosMapFolder: (
    sourcePath: string
  ) => Promise<CorosMapInstallResult>;
  getRouteBuilderConfig: () => Promise<RouteBuilderConfig>;
  saveRouteBuilderConfig: (
    config: RouteBuilderConfig
  ) => Promise<RouteBuilderConfig>;
  listGeneratedRoutes: () => Promise<GeneratedRoute[]>;
  geocodeRouteLocation: (query: string) => Promise<RouteGeocodeResult>;
  searchRouteLocations: (query: string) => Promise<RouteGeocodeResult[]>;
  generateRoute: (request: GenerateRouteRequest) => Promise<GeneratedRoute>;
  routeWaypoints: (request: RouteWaypointRequest) => Promise<RouteGeometry>;
  saveDrawnRoute: (payload: DrawnRoutePayload) => Promise<GeneratedRoute>;
  importRouteGpx: (
    activityType?: RouteActivityType
  ) => Promise<GeneratedRoute | null>;
  exportGeneratedRoute: (id: string) => Promise<string | null>;
  deleteGeneratedRoute: (id: string) => Promise<boolean>;
  startRouteShare: (id: string) => Promise<RouteShareSession>;
  stopRouteShare: () => Promise<void>;
  validateRouteApiKey: (apiKey: string) => Promise<RouteApiKeyValidation>;
  getAppInfo: () => Promise<AppInfo>;
  openAppStorageLocation: (id: string) => Promise<void>;
  getAppUpdateStatus: () => Promise<AppUpdateSnapshot>;
  checkForAppUpdates: () => Promise<AppUpdateSnapshot>;
  downloadAppUpdate: () => Promise<AppUpdateSnapshot>;
  setUpdatePreferences: (prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) => Promise<AppUpdateSnapshot>;
  quitAndInstallUpdate: () => Promise<{ installMethod: "restart" | "manual" }>;
  onAppUpdateStatus: (
    callback: (snapshot: AppUpdateSnapshot) => void
  ) => () => void;
  getChatAuthStatus: () => Promise<ChatAuthStatus>;
  getChatSettings: () => Promise<ChatSettings>;
  saveChatSettings: (settings: ChatSettings) => Promise<ChatSettings>;
  testLocalChatConnection: (
    config?: LocalChatConfig
  ) => Promise<LocalChatConnectionTest>;
  detectLocalChatServers: (apiKey?: string) => Promise<LocalChatDiscovery>;
  loginChat: () => Promise<ChatAuthStatus>;
  logoutChat: () => Promise<ChatAuthStatus>;
  sendChat: (requestId: string, messages: ChatMessage[]) => Promise<void>;
  cancelChat: (requestId: string) => Promise<void>;
  listChatSessions: (provider: ChatProvider) => Promise<ChatSessionSummary[]>;
  getChatSession: (sessionId: string) => Promise<PersistedChatEntry[]>;
  createChatSession: (provider: ChatProvider) => Promise<ChatSessionSummary>;
  saveChatSession: (
    sessionId: string,
    entries: PersistedChatEntry[]
  ) => Promise<ChatSessionSummary | null>;
  deleteChatSession: (sessionId: string) => Promise<void>;
  onChatStreamStart: (callback: (payload: ChatStreamStart) => void) => () => void;
  onChatStreamToken: (callback: (payload: ChatStreamToken) => void) => () => void;
  onChatStreamDone: (callback: (payload: ChatStreamDone) => void) => () => void;
  onChatStreamError: (callback: (payload: ChatStreamError) => void) => () => void;
  onChatStreamInfo: (callback: (payload: ChatStreamInfo) => void) => () => void;
  getCorosMcpStatus: () => Promise<CorosMcpStatus>;
  connectCorosMcp: () => Promise<CorosMcpStatus>;
  disconnectCorosMcp: () => Promise<CorosMcpStatus>;
  listCorosMcpTools: () => Promise<CorosMcpTool[]>;
  uploadTrainingPlanDraft: (draftId: string) => Promise<UploadPlanResult>;
  confirmWorkoutDelete: (requestId: string) => Promise<DeleteWorkoutResult>;
  setWindowBackground: (color: string) => Promise<void>;
  isWindowFullscreen: () => Promise<boolean>;
  onWindowFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
}

declare global {
  interface Window {
    corosLink?: CorosLinkApi;
  }
}

export {};
