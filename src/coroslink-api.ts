import type {
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
  GenerateRouteRequest,
  GeneratedRoute,
  LocalTrack,
  RouteApiKeyValidation,
  RouteBuilderConfig,
  RouteGeocodeResult,
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
  TrainingHubDailyMetrics,
  TrainingHubDashboard,
  TrainingHubRacePredictor,
  TrainingHubSportType,
  TrainingHubStatus,
  TrainingHubUpcomingWorkout,
  TransferResult,
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
  DeleteWorkoutResult
} from "../electron/types";

export interface CorosLinkApi {
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
  listTrainingHubActivities: (
    page: number,
    size: number
  ) => Promise<TrainingHubActivity[]>;
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
  getTrainingAnalytics: () => Promise<TrainingHubAnalytics>;
  getRacePredictor: () => Promise<TrainingHubRacePredictor>;
  getTrainingDashboard: () => Promise<TrainingHubDashboard>;
  getDailyMetrics: (dateList: string[]) => Promise<TrainingHubDailyMetrics>;
  getSportTypeMap: () => Promise<TrainingHubSportType[]>;
  getActivityPaceBaselines: () => Promise<ActivityPaceBaselines>;
  getUpcomingWorkouts: (days?: number) => Promise<TrainingHubUpcomingWorkout[]>;
  uploadTrainingPlan: (
    draft: CorosTrainingPlanDraftInput
  ) => Promise<UploadPlanResult>;
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
  openLocationServicesSettings: () => Promise<void>;
  getApproximateRouteLocation: () => Promise<RouteGeocodeResult>;
  geocodeRouteLocation: (query: string) => Promise<RouteGeocodeResult>;
  generateRoute: (request: GenerateRouteRequest) => Promise<GeneratedRoute>;
  exportGeneratedRoute: (id: string) => Promise<string | null>;
  deleteGeneratedRoute: (id: string) => Promise<boolean>;
  startRouteShare: (id: string) => Promise<RouteShareSession>;
  stopRouteShare: () => Promise<void>;
  validateRouteApiKey: (apiKey: string) => Promise<RouteApiKeyValidation>;
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
}

declare global {
  interface Window {
    corosLink?: CorosLinkApi;
  }
}

export {};
