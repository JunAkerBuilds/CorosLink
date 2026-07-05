import { contextBridge, ipcRenderer } from "electron";
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
  DrawnRoutePayload,
  GenerateRouteRequest,
  GeneratedRoute,
  LocalTrack,
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
} from "./types";

const api = {
  getWatchStatus: (): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:getStatus"),
  getWatchConnectionSmokeOption: (): Promise<WatchConnectionSmokeOptionId> =>
    ipcRenderer.invoke("watch:getConnectionSmokeOption"),
  setWatchConnectionSmokeOption: (
    optionId: WatchConnectionSmokeOptionId
  ): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:setConnectionSmokeOption", optionId),
  deleteWatchTrack: (relativePath: string): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:deleteTrack", relativePath),
  transferLocalTrack: (id: string): Promise<TransferResult> =>
    ipcRenderer.invoke("watch:transferLocalTrack", id),
  listDownloads: (): Promise<LocalTrack[]> =>
    ipcRenderer.invoke("downloads:list"),
  downloadAudio: (url: string): Promise<DownloadAudioResult> =>
    ipcRenderer.invoke("downloads:downloadAudio", url),
  deleteDownload: (id: string, removeFile: boolean): Promise<LocalTrack[]> =>
    ipcRenderer.invoke("downloads:delete", id, removeFile),
  getBinaryStatus: (): Promise<BinaryStatus> =>
    ipcRenderer.invoke("binaries:getStatus"),
  listYouTubeHistory: (): Promise<YouTubeHistoryEntry[]> =>
    ipcRenderer.invoke("youtube:listHistory"),
  recordYouTubeVisit: (
    url: string,
    title?: string
  ): Promise<YouTubeHistoryEntry> =>
    ipcRenderer.invoke("youtube:recordVisit", url, title),
  downloadFromYouTubeBrowser: (
    url: string,
    title?: string
  ): Promise<DownloadAudioResult> =>
    ipcRenderer.invoke("youtube:download", url, title),
  downloadMultipleFromYouTubeBrowser: (
    items: Array<{ url: string; title?: string }>
  ): Promise<DownloadAudioResult> =>
    ipcRenderer.invoke("youtube:downloadMultiple", items),
  enqueueYouTubeDownloads: (
    items: DownloadQueueItem[]
  ): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:enqueueDownload", items),
  listYouTubeJobs: (): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:listJobs"),
  clearYouTubeJob: (id: string): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:clearJob", id),
  cancelYouTubeJob: (id: string): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:cancelJob", id),
  clearCompletedYouTubeJobs: (): Promise<DownloadJob[]> =>
    ipcRenderer.invoke("youtube:clearCompletedJobs"),
  onYouTubeJobsUpdate: (
    callback: (jobs: DownloadJob[]) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, jobs: DownloadJob[]) => {
      callback(jobs);
    };
    ipcRenderer.on("youtube:jobsUpdate", listener);
    return () => ipcRenderer.removeListener("youtube:jobsUpdate", listener);
  },
  resetYouTubeBrowserSession: (): Promise<void> =>
    ipcRenderer.invoke("youtube:resetSession"),
  getYouTubeMusicConfig: (): Promise<YouTubeMusicConfig> =>
    ipcRenderer.invoke("youtubeMusic:getConfig"),
  saveYouTubeMusicConfig: (
    config: YouTubeMusicConfig
  ): Promise<YouTubeMusicStatus> =>
    ipcRenderer.invoke("youtubeMusic:saveConfig", config),
  getYouTubeMusicStatus: (): Promise<YouTubeMusicStatus> =>
    ipcRenderer.invoke("youtubeMusic:getStatus"),
  saveYouTubeMusicAuth: (
    headersRaw: string
  ): Promise<YouTubeMusicStatus> =>
    ipcRenderer.invoke("youtubeMusic:saveAuth", headersRaw),
  loginYouTubeMusic: (): Promise<YouTubeMusicStatus> =>
    ipcRenderer.invoke("youtubeMusic:login"),
  logoutYouTubeMusic: (): Promise<YouTubeMusicStatus> =>
    ipcRenderer.invoke("youtubeMusic:logout"),
  resetYouTubeMusicBrowserSession: (): Promise<void> =>
    ipcRenderer.invoke("youtubeMusic:resetBrowserSession"),
  onYouTubeMusicAuthCaptured: (
    callback: (result: YouTubeMusicAuthCapture) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      result: YouTubeMusicAuthCapture
    ) => {
      callback(result);
    };
    ipcRenderer.on("youtubeMusic:authCaptured", listener);
    return () =>
      ipcRenderer.removeListener("youtubeMusic:authCaptured", listener);
  },
  listYouTubeMusicLibrary: (): Promise<YouTubeMusicLibrary> =>
    ipcRenderer.invoke("youtubeMusic:listLibrary"),
  syncYouTubeMusicLibrary: (): Promise<YouTubeMusicSyncResult> =>
    ipcRenderer.invoke("youtubeMusic:syncLibrary"),
  getAppleMusicStatus: (): Promise<AppleMusicStatus> =>
    ipcRenderer.invoke("appleMusic:getStatus"),
  saveAppleMusicAuth: (headersRaw: string): Promise<AppleMusicStatus> =>
    ipcRenderer.invoke("appleMusic:saveAuth", headersRaw),
  logoutAppleMusic: (): Promise<AppleMusicStatus> =>
    ipcRenderer.invoke("appleMusic:logout"),
  resetAppleMusicBrowserSession: (): Promise<void> =>
    ipcRenderer.invoke("appleMusic:resetBrowserSession"),
  onAppleMusicAuthCaptured: (
    callback: (status: AppleMusicStatus) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: AppleMusicStatus
    ) => {
      callback(status);
    };
    ipcRenderer.on("appleMusic:authCaptured", listener);
    return () =>
      ipcRenderer.removeListener("appleMusic:authCaptured", listener);
  },
  listAppleMusicPlaylists: (): Promise<AppleMusicPlaylist[]> =>
    ipcRenderer.invoke("appleMusic:listPlaylists"),
  fetchAppleMusicPlaylist: (playlist: string): Promise<AppleMusicPlaylist> =>
    ipcRenderer.invoke("appleMusic:fetchPlaylist", playlist),
  getSpotifyConfig: (): Promise<SpotifyConfig> =>
    ipcRenderer.invoke("spotify:getConfig"),
  saveSpotifyConfig: (config: SpotifyConfig): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:saveConfig", config),
  getSpotifyStatus: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:getStatus"),
  loginSpotify: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:login"),
  logoutSpotify: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:logout"),
  listSpotifyPlaylists: (): Promise<SpotifyPlaylist[]> =>
    ipcRenderer.invoke("spotify:listPlaylists"),
  listSpotifyPlaylistTracks: (
    playlistId: string
  ): Promise<SpotifyPlaylistTrack[]> =>
    ipcRenderer.invoke("spotify:listPlaylistTracks", playlistId),
  listSpotifySyncState: (playlistId: string): Promise<SpotifySyncTrack[]> =>
    ipcRenderer.invoke("spotify:listSyncState", playlistId),
  syncSpotifyPlaylist: (
    playlistId: string,
    autoTransfer: boolean
  ): Promise<SpotifySyncResult> =>
    ipcRenderer.invoke("spotify:syncPlaylist", playlistId, autoTransfer),
  onSpotifySyncUpdate: (
    callback: (update: SpotifySyncUpdate) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: SpotifySyncUpdate) => {
      callback(update);
    };
    ipcRenderer.on("spotify:syncUpdate", listener);
    return () => ipcRenderer.removeListener("spotify:syncUpdate", listener);
  },
  getTrainingHubStatus: (): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:getStatus"),
  loginTrainingHub: (
    email: string,
    password: string,
    remember: boolean
  ): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:login", email, password, remember),
  logoutTrainingHub: (): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:logout"),
  reconnectTrainingHub: (): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:reconnect"),
  listTrainingHubActivities: (
    page: number,
    size: number
  ): Promise<TrainingHubActivity[]> =>
    ipcRenderer.invoke("trainingHub:listActivities", page, size),
  getTrainingHubActivityDetail: (
    activityId: string,
    sportType: number,
    listActivity?: TrainingHubActivity
  ): Promise<TrainingHubActivityDetail> =>
    ipcRenderer.invoke(
      "trainingHub:getActivityDetail",
      activityId,
      sportType,
      listActivity
    ),
  exportTrainingHubActivityFile: (
    activityId: string,
    sportType: number,
    fileType: TrainingHubActivityFileType,
    suggestedName?: string
  ): Promise<TrainingHubExportResult> =>
    ipcRenderer.invoke(
      "trainingHub:exportActivityFile",
      activityId,
      sportType,
      fileType,
      suggestedName
    ),
  exportLatestTrainingHubActivityFile: (
    fileType: TrainingHubActivityFileType = 4
  ): Promise<TrainingHubExportResult> =>
    ipcRenderer.invoke("trainingHub:exportLatestActivityFile", fileType),
  getTrainingAnalytics: (): Promise<TrainingHubAnalytics> =>
    ipcRenderer.invoke("trainingHub:getTrainingAnalytics"),
  getRacePredictor: (): Promise<TrainingHubRacePredictor> =>
    ipcRenderer.invoke("trainingHub:getRacePredictor"),
  getTrainingDashboard: (): Promise<TrainingHubDashboard> =>
    ipcRenderer.invoke("trainingHub:getDashboard"),
  getDailyMetrics: (dateList: string[]): Promise<TrainingHubDailyMetrics> =>
    ipcRenderer.invoke("trainingHub:getDailyMetrics", dateList),
  getSportTypeMap: (): Promise<TrainingHubSportType[]> =>
    ipcRenderer.invoke("trainingHub:getSportTypeMap"),
  getActivityPaceBaselines: (): Promise<ActivityPaceBaselines> =>
    ipcRenderer.invoke("trainingHub:getActivityPaceBaselines"),
  getUpcomingWorkouts: (
    days?: number
  ): Promise<TrainingHubUpcomingWorkout[]> =>
    ipcRenderer.invoke("trainingHub:getUpcomingWorkouts", days),
  uploadTrainingPlan: (
    draft: CorosTrainingPlanDraftInput
  ): Promise<UploadPlanResult> =>
    ipcRenderer.invoke("trainingHub:uploadTrainingPlan", draft),
  getCorosMapManifest: (): Promise<CorosMapManifest> =>
    ipcRenderer.invoke("maps:getCorosManifest"),
  openCorosMapDownload: (downloadUrl: string): Promise<void> =>
    ipcRenderer.invoke("maps:openCorosDownload", downloadUrl),
  downloadCorosMapPackage: (
    pkg: CorosMapPackage
  ): Promise<CorosMapDownloadJob[]> =>
    ipcRenderer.invoke("maps:downloadCorosPackage", pkg),
  listCorosMapDownloadJobs: (): Promise<CorosMapDownloadJob[]> =>
    ipcRenderer.invoke("maps:listCorosMapDownloadJobs"),
  cancelCorosMapDownload: (id: string): Promise<CorosMapDownloadJob[]> =>
    ipcRenderer.invoke("maps:cancelCorosMapDownload", id),
  clearCorosMapDownloadJob: (id: string): Promise<CorosMapDownloadJob[]> =>
    ipcRenderer.invoke("maps:clearCorosMapDownloadJob", id),
  onCorosMapDownloadJobsUpdate: (
    callback: (jobs: CorosMapDownloadJob[]) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      jobs: CorosMapDownloadJob[]
    ) => {
      callback(jobs);
    };
    ipcRenderer.on("maps:downloadJobsUpdate", listener);
    return () =>
      ipcRenderer.removeListener("maps:downloadJobsUpdate", listener);
  },
  listCachedCorosMaps: (): Promise<CachedCorosMapPackage[]> =>
    ipcRenderer.invoke("maps:listCachedCorosMaps"),
  getCorosMapInstallProgress: (): Promise<CorosMapInstallProgress | null> =>
    ipcRenderer.invoke("maps:getCorosMapInstallProgress"),
  cancelCorosMapInstall: (): Promise<CorosMapInstallProgress | null> =>
    ipcRenderer.invoke("maps:cancelCorosMapInstall"),
  onCorosMapInstallProgressUpdate: (
    callback: (progress: CorosMapInstallProgress | null) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: CorosMapInstallProgress | null
    ) => {
      callback(progress);
    };
    ipcRenderer.on("maps:installProgressUpdate", listener);
    return () =>
      ipcRenderer.removeListener("maps:installProgressUpdate", listener);
  },
  installCachedCorosMap: (packageId: string): Promise<CorosMapInstallResult> =>
    ipcRenderer.invoke("maps:installCachedCorosMap", packageId),
  installCachedCorosMaps: (
    packageIds: string[]
  ): Promise<CorosMapInstallResult> =>
    ipcRenderer.invoke("maps:installCachedCorosMaps", packageIds),
  deleteCachedCorosMap: (
    packageId: string
  ): Promise<CachedCorosMapPackage[]> =>
    ipcRenderer.invoke("maps:deleteCachedCorosMap", packageId),
  chooseCorosMapFolder: (): Promise<CorosMapLocalSelection | undefined> =>
    ipcRenderer.invoke("maps:chooseCorosMapFolder"),
  installCorosMapFolder: (
    sourcePath: string
  ): Promise<CorosMapInstallResult> =>
    ipcRenderer.invoke("maps:installCorosMapFolder", sourcePath),
  getRouteBuilderConfig: (): Promise<RouteBuilderConfig> =>
    ipcRenderer.invoke("maps:getRouteBuilderConfig"),
  saveRouteBuilderConfig: (
    config: RouteBuilderConfig
  ): Promise<RouteBuilderConfig> =>
    ipcRenderer.invoke("maps:saveRouteBuilderConfig", config),
  listGeneratedRoutes: (): Promise<GeneratedRoute[]> =>
    ipcRenderer.invoke("maps:listGeneratedRoutes"),
  openLocationServicesSettings: (): Promise<void> =>
    ipcRenderer.invoke("maps:openLocationServicesSettings"),
  getApproximateRouteLocation: (): Promise<RouteGeocodeResult> =>
    ipcRenderer.invoke("maps:getApproximateRouteLocation"),
  geocodeRouteLocation: (query: string): Promise<RouteGeocodeResult> =>
    ipcRenderer.invoke("maps:geocodeRouteLocation", query),
  searchRouteLocations: (query: string): Promise<RouteGeocodeResult[]> =>
    ipcRenderer.invoke("maps:searchRouteLocations", query),
  generateRoute: (request: GenerateRouteRequest): Promise<GeneratedRoute> =>
    ipcRenderer.invoke("maps:generateRoute", request),
  routeWaypoints: (request: RouteWaypointRequest): Promise<RouteGeometry> =>
    ipcRenderer.invoke("maps:routeWaypoints", request),
  saveDrawnRoute: (payload: DrawnRoutePayload): Promise<GeneratedRoute> =>
    ipcRenderer.invoke("maps:saveDrawnRoute", payload),
  exportGeneratedRoute: (id: string): Promise<string | null> =>
    ipcRenderer.invoke("maps:exportGeneratedRoute", id),
  deleteGeneratedRoute: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("maps:deleteGeneratedRoute", id),
  startRouteShare: (id: string): Promise<RouteShareSession> =>
    ipcRenderer.invoke("maps:startRouteShare", id),
  stopRouteShare: (): Promise<void> =>
    ipcRenderer.invoke("maps:stopRouteShare"),
  validateRouteApiKey: (apiKey: string): Promise<RouteApiKeyValidation> =>
    ipcRenderer.invoke("maps:validateRouteApiKey", apiKey),
  getAppUpdateStatus: (): Promise<AppUpdateSnapshot> =>
    ipcRenderer.invoke("app:getUpdateStatus"),
  checkForAppUpdates: (): Promise<AppUpdateSnapshot> =>
    ipcRenderer.invoke("app:checkForUpdates"),
  downloadAppUpdate: (): Promise<AppUpdateSnapshot> =>
    ipcRenderer.invoke("app:downloadUpdate"),
  setUpdatePreferences: (prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }): Promise<AppUpdateSnapshot> =>
    ipcRenderer.invoke("app:setUpdatePreferences", prefs),
  quitAndInstallUpdate: (): Promise<void> =>
    ipcRenderer.invoke("app:quitAndInstallUpdate"),
  onAppUpdateStatus: (
    callback: (snapshot: AppUpdateSnapshot) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: AppUpdateSnapshot
    ) => {
      callback(snapshot);
    };
    ipcRenderer.on("app:updateStatus", listener);
    return () => ipcRenderer.removeListener("app:updateStatus", listener);
  },
  getChatAuthStatus: (): Promise<ChatAuthStatus> =>
    ipcRenderer.invoke("chat:getAuthStatus"),
  getChatSettings: (): Promise<ChatSettings> =>
    ipcRenderer.invoke("chat:getSettings"),
  saveChatSettings: (settings: ChatSettings): Promise<ChatSettings> =>
    ipcRenderer.invoke("chat:saveSettings", settings),
  testLocalChatConnection: (
    config?: LocalChatConfig
  ): Promise<LocalChatConnectionTest> =>
    ipcRenderer.invoke("chat:testLocalConnection", config),
  detectLocalChatServers: (apiKey?: string): Promise<LocalChatDiscovery> =>
    ipcRenderer.invoke("chat:detectLocalServers", apiKey),
  loginChat: (): Promise<ChatAuthStatus> => ipcRenderer.invoke("chat:login"),
  logoutChat: (): Promise<ChatAuthStatus> => ipcRenderer.invoke("chat:logout"),
  // Fire-and-forget: assistant text arrives via the onChat* subscriptions.
  sendChat: (requestId: string, messages: ChatMessage[]): Promise<void> =>
    ipcRenderer.invoke("chat:send", requestId, messages),
  cancelChat: (requestId: string): Promise<void> =>
    ipcRenderer.invoke("chat:cancel", requestId),
  listChatSessions: (provider: ChatProvider): Promise<ChatSessionSummary[]> =>
    ipcRenderer.invoke("chat:listSessions", provider),
  getChatSession: (sessionId: string): Promise<PersistedChatEntry[]> =>
    ipcRenderer.invoke("chat:getSession", sessionId),
  createChatSession: (provider: ChatProvider): Promise<ChatSessionSummary> =>
    ipcRenderer.invoke("chat:createSession", provider),
  saveChatSession: (
    sessionId: string,
    entries: PersistedChatEntry[]
  ): Promise<ChatSessionSummary | null> =>
    ipcRenderer.invoke("chat:saveSession", sessionId, entries),
  deleteChatSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("chat:deleteSession", sessionId),
  onChatStreamStart: (
    callback: (payload: ChatStreamStart) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamStart) =>
      callback(payload);
    ipcRenderer.on("chat:streamStart", listener);
    return () => ipcRenderer.removeListener("chat:streamStart", listener);
  },
  onChatStreamToken: (
    callback: (payload: ChatStreamToken) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamToken) =>
      callback(payload);
    ipcRenderer.on("chat:streamToken", listener);
    return () => ipcRenderer.removeListener("chat:streamToken", listener);
  },
  onChatStreamDone: (
    callback: (payload: ChatStreamDone) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamDone) =>
      callback(payload);
    ipcRenderer.on("chat:streamDone", listener);
    return () => ipcRenderer.removeListener("chat:streamDone", listener);
  },
  onChatStreamError: (
    callback: (payload: ChatStreamError) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamError) =>
      callback(payload);
    ipcRenderer.on("chat:streamError", listener);
    return () => ipcRenderer.removeListener("chat:streamError", listener);
  },
  onChatStreamInfo: (
    callback: (payload: ChatStreamInfo) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamInfo) =>
      callback(payload);
    ipcRenderer.on("chat:streamInfo", listener);
    return () => ipcRenderer.removeListener("chat:streamInfo", listener);
  },
  getCorosMcpStatus: (): Promise<CorosMcpStatus> =>
    ipcRenderer.invoke("chatMcp:getStatus"),
  connectCorosMcp: (): Promise<CorosMcpStatus> =>
    ipcRenderer.invoke("chatMcp:connect"),
  disconnectCorosMcp: (): Promise<CorosMcpStatus> =>
    ipcRenderer.invoke("chatMcp:disconnect"),
  listCorosMcpTools: (): Promise<CorosMcpTool[]> =>
    ipcRenderer.invoke("chatMcp:listTools"),
  uploadTrainingPlanDraft: (draftId: string): Promise<UploadPlanResult> =>
    ipcRenderer.invoke("chat:uploadPlanDraft", draftId),
  confirmWorkoutDelete: (requestId: string): Promise<DeleteWorkoutResult> =>
    ipcRenderer.invoke("chat:confirmWorkoutDelete", requestId)
};

contextBridge.exposeInMainWorld("corosLink", api);

export type CorosLinkApi = typeof api;
