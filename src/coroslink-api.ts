import type { CalendarEventTiming, CalendarWorkoutEventRef, CalendarWorkoutEventSaveResult } from "../electron/calendarSyncTypes";
import type { ChatGptModelInfo } from "../electron/chatModels";
import type { StrengthEditPreview } from "../electron/workoutEditTypes";
import type { HealthInsightKind, HealthInsightResult } from "../electron/healthInsightsTypes";
import type { DiagnosticsSnapshot, RendererDiagnosticError } from "../electron/diagnosticsTypes";
import type { AppleCalendarCredentials, CalendarChoice, CalendarConnectionStatus, CalendarSyncResult, CalendarSyncSettings } from "../electron/calendarSyncTypes";
import type { WatchfaceAiChatSummary, WatchfaceAiEvent, WatchfaceAiMessage, WatchfaceAiOptions, WatchfaceAiSavedChat, WatchfaceAutomationRequest, WatchfaceAutomationResponse, WatchfaceAutomationStatus } from "../electron/watchfaceAutomationTypes";
import type { GoogleCalendarChoice, GoogleCalendarConfigInput, GoogleCalendarStatus, GoogleCalendarSyncResult } from "../electron/googleCalendarTypes";
import type {
  ActivityBackupProgress,
  BinaryStatus,
  CachedCorosMapPackage,
  CombinedDownloadProgressEvent,
  CombinedDownloadResult,
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
  GeneratedRoutePage,
  GpxImportSummary,
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
  HevySettingsInput,
  HevyStatus,
  StrengthHistory,
  StrengthHistoryRequest,
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
  TrainingHubLoginResult,
  TrainingHubUpcomingWorkout,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubLibraryWorkout,
  TrainingActivityMatch,
  TrainingCollection,
  TrainingLibraryDeleteRequest,
  TrainingLibrarySnapshot,
  TrainingPlanDocument,
  TrainingPlanCalendarMutationResult,
  TrainingPlanCalendarPreview,
  TrainingPlanDestination,
  TrainingPlanMetadataPatch,
  WorkoutMetadataPatch,
  UnitSystem,
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  WorkoutEditPreview,
  WorkoutEditRef,
  WorkoutEditSaveResult,
  WorkoutEditorContext,
  WorkoutEditorDocument,
  WorkoutExerciseOption,
  WorkoutSport,
  TransferResult,
  AppInfo,
  AppUpdateSnapshot,
  WatchConnectionSmokeOptionId,
  WatchStatus,
  WatchTransferProgress,
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
  ClaudeCodeConnectionTest,
  ClaudeCodeStatus,
  PersistedChatEntry,
  ChatStreamStart,
  ChatStreamToken,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamInfo,
  CoachCorosActionPreview,
  CoachChartPreview,
  FitIndexProgress,
  FitIndexStatus,
  FitIndexSyncOptions,
  PinnedCoachChart,
  LocalChatConfig,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConfig,
  OpenRouterConnectionTest,
  CorosMcpStatus,
  CorosMcpTool,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  CorosTrainingPlanDraftInput,
  UploadPlanResult,
  IntervalsStatus,
  IntervalsActivityWithStatus,
  DeleteWorkoutResult,
  ManualActivityInput
} from "../electron/types";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceProjectExportInput,
  CorosWatchfaceProjectExportResult,
  CorosWatchfaceArchiveExportInput,
  CorosWatchfaceArtwork,
  CorosWatchfaceCreatorInput,
  CorosWatchfaceConversionInput,
  CorosWatchfaceConversionResult,
  CorosWatchfaceExistingShareInput,
  CorosWatchfaceRasterFontFolder,
  CorosWatchfaceProject,
  CorosWatchfaceProjectSaveInput,
  CorosWatchfaceProjectSummary,
  CorosWatchfacePublishInput,
  CorosWatchfaceRegion,
  CorosWatchfaceShareImport,
  CorosWatchfaceShareLink,
  CorosWatchfaceStatus,
  CorosWatchfaceConfigTextFile,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeDownload,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceThemeListInput,
  CorosOfficialAssetFrames,
  CorosOfficialAssetLibraryStatus,
  CorosOfficialAssetPage,
  CorosOfficialAssetQuery,
  CorosBatteryQueryInput,
  CorosBatteryReport,
  CorosGearCatalog,
  CorosGearSaveInput,
  CorosPairedDevice,
  CorosBluetoothDeviceChoice,
  CommunityWatchface,
  CommunityWatchfaceCatalogPage,
  CommunityWatchfaceCatalogQuery,
  CommunityWatchfaceDownloadProgress,
  CommunityWatchfaceImport,
  CommunityWatchfaceOpenRequest
} from "../electron/types";

export interface CorosLinkApi {
  getWorkoutAutomationStatus: () => Promise<WatchfaceAutomationStatus>;
  configureWorkoutAutomation: (input: { enabled: boolean; port?: number }) => Promise<WatchfaceAutomationStatus>;
  onWorkoutEditsChanged: (callback: () => void) => () => void;
  listWorkoutEdits: () => Promise<StrengthEditPreview[]>;
  getWorkoutEditStatus: (proposalId: string) => Promise<StrengthEditPreview>;
  cancelWorkoutEdit: (proposalId: string) => Promise<StrengthEditPreview>;
  confirmWorkoutEdit: (input: { proposalId: string; reviewHash: string; selectedIds: string[] }) => Promise<StrengthEditPreview>;
  getWatchfaceAutomationStatus: () => Promise<WatchfaceAutomationStatus>;
  configureWatchfaceAutomation: (input: { enabled: boolean; port?: number }) => Promise<WatchfaceAutomationStatus>;
  onWatchfaceAutomationActivate: (callback: () => void) => () => void;
  onWatchfaceAutomationRequest: (callback: (request: WatchfaceAutomationRequest) => void) => () => void;
  respondWatchfaceAutomation: (response: WatchfaceAutomationResponse) => void;
  setWatchfaceAutomationReady: (scope: "hub" | "editor", ready: boolean) => void;
  sendWatchfaceAi: (requestId: string, messages: WatchfaceAiMessage[], options?: WatchfaceAiOptions) => Promise<void>;
  cancelWatchfaceAi: (requestId: string) => Promise<void>;
  listWatchfaceAiModels: () => Promise<ChatGptModelInfo[]>;
  listWatchfaceAiChats: (projectKey: string) => Promise<WatchfaceAiChatSummary[]>;
  loadWatchfaceAiChat: (id: string) => Promise<WatchfaceAiSavedChat>;
  saveWatchfaceAiChat: (input: { id?: string; projectKey: string; title?: string; messages: unknown[] }) => Promise<WatchfaceAiChatSummary>;
  renameWatchfaceAiChat: (id: string, title: string) => Promise<WatchfaceAiChatSummary>;
  deleteWatchfaceAiChat: (id: string) => Promise<void>;
  copyWatchfaceAiImage: (assetId: string) => Promise<void>;
  onWatchfaceAiEvent: (callback: (event: WatchfaceAiEvent) => void) => () => void;
  getAppleCalendarStatus: () => Promise<CalendarConnectionStatus>;
  connectAppleCalendar: (input: AppleCalendarCredentials) => Promise<CalendarConnectionStatus>;
  cancelAppleCalendarConnect: () => Promise<void>;
  disconnectAppleCalendar: () => Promise<CalendarConnectionStatus>;
  listAppleCalendars: () => Promise<CalendarChoice[]>;
  getCalendarWorkoutEvent: (ref: CalendarWorkoutEventRef) => Promise<CalendarEventTiming>;
  updateCalendarWorkoutEvent: (input: { ref: CalendarWorkoutEventRef; timing: CalendarEventTiming }) => Promise<CalendarWorkoutEventSaveResult>;
  syncEditedCalendarWorkout: (ref: CalendarWorkoutEventRef) => Promise<Pick<CalendarWorkoutEventSaveResult, "synced" | "errors">>;
  updateAppleCalendarSettings: (input: CalendarSyncSettings) => Promise<CalendarConnectionStatus>;
  syncAppleCalendar: () => Promise<CalendarSyncResult>;
  getGoogleCalendarStatus: () => Promise<GoogleCalendarStatus>;
  saveGoogleCalendarConfig: (input: GoogleCalendarConfigInput) => Promise<GoogleCalendarStatus>;
  connectGoogleCalendar: () => Promise<GoogleCalendarStatus>;
  cancelGoogleCalendarConnect: () => Promise<void>;
  disconnectGoogleCalendar: () => Promise<GoogleCalendarStatus>;
  listGoogleCalendars: () => Promise<GoogleCalendarChoice[]>;
  updateGoogleCalendarSettings: (input: CalendarSyncSettings) => Promise<GoogleCalendarStatus>;
  syncGoogleCalendar: () => Promise<GoogleCalendarSyncResult>;
  platform: string;
  /** Available only when the native window was created with sidebar vibrancy. */
  nativeSidebarGlass?: boolean;
  getWatchStatus: () => Promise<WatchStatus>;
  getCorosWatchfaceStatus: () => Promise<CorosWatchfaceStatus>;
  /** Font families installed on this computer, for local watchface rasterization. */
  listLocalFontFamilies: () => Promise<string[]>;
  loginCorosWatchfaces: (
    email: string,
    password: string,
    region: CorosWatchfaceRegion,
    remember: boolean
  ) => Promise<CorosWatchfaceStatus>;
  loginCorosWatchfacesWithSavedCredentials: (
    region: CorosWatchfaceRegion
  ) => Promise<CorosWatchfaceStatus>;
  logoutCorosWatchfaces: () => Promise<CorosWatchfaceStatus>;
  listCorosPairedDevices: () => Promise<CorosPairedDevice[]>;
  selectCorosBluetoothDevice: (deviceId: string) => Promise<void>;
  cancelCorosBluetoothDeviceSelection: () => Promise<void>;
  onCorosBluetoothDevices: (
    callback: (devices: CorosBluetoothDeviceChoice[]) => void
  ) => () => void;
  getCorosBatteryReport: (
    input: CorosBatteryQueryInput
  ) => Promise<CorosBatteryReport>;
  queryCorosGear: () => Promise<CorosGearCatalog>;
  saveCorosGear: (input: CorosGearSaveInput) => Promise<CorosGearCatalog>;
  listCorosWatchfaceThemes: (
    input: CorosWatchfaceThemeListInput
  ) => Promise<CorosWatchfaceTheme[]>;
  downloadCorosWatchfaceTheme: (
    input: CorosWatchfaceThemeDownloadInput
  ) => Promise<CorosWatchfaceThemeDownload>;
  importCorosWatchfaceShareLink: (
    shareUrl: string
  ) => Promise<CorosWatchfaceShareImport>;
  ensureCorosOfficialAssetLibrary: (
    input: { firmwareType: string; rebuild?: boolean }
  ) => Promise<CorosOfficialAssetLibraryStatus>;
  getCorosOfficialAssetLibraryStatus: (
    input: { firmwareType: string }
  ) => Promise<CorosOfficialAssetLibraryStatus>;
  listCorosOfficialAssets: (
    input: CorosOfficialAssetQuery
  ) => Promise<CorosOfficialAssetPage>;
  readCorosOfficialAssetFrames: (
    input: { firmwareType: string; id: string }
  ) => Promise<CorosOfficialAssetFrames>;
  listCommunityWatchfaces: (
    input: CommunityWatchfaceCatalogQuery
  ) => Promise<CommunityWatchfaceCatalogPage>;
  getCommunityWatchface: (slug: string, model?: string) => Promise<CommunityWatchface>;
  importCommunityWatchface: (slug: string, model?: string) => Promise<CommunityWatchfaceImport>;
  consumeCommunityWatchfaceOpenRequest: () =>
    Promise<CommunityWatchfaceOpenRequest | null>;
  onCommunityWatchfaceOpenRequest: (
    callback: (request: CommunityWatchfaceOpenRequest) => void
  ) => () => void;
  onCommunityWatchfaceDownloadProgress: (
    callback: (progress: CommunityWatchfaceDownloadProgress) => void
  ) => () => void;
  chooseCorosWatchfaceArchive: () => Promise<CorosWatchfaceArchive | null>;
  chooseCorosWatchfaceArtwork: () => Promise<CorosWatchfaceArtwork | null>;
  chooseCorosWatchfaceRasterFontFolder: () => Promise<CorosWatchfaceRasterFontFolder | null>;
  convertCorosWatchfaceArchive: (input: CorosWatchfaceConversionInput) => Promise<CorosWatchfaceConversionResult>;
  createCorosWatchfaceArchive: (
    input: CorosWatchfaceCreatorInput
  ) => Promise<CorosWatchfaceArchive>;
  exportCorosWatchfaceProject: (
    input: CorosWatchfaceProjectExportInput
  ) => Promise<CorosWatchfaceProjectExportResult>;
  exportCorosWatchfaceArchive: (
    input: CorosWatchfaceArchiveExportInput
  ) => Promise<CorosWatchfaceProjectExportResult>;
  listCorosWatchfaceProjects: () => Promise<CorosWatchfaceProjectSummary[]>;
  saveCorosWatchfaceProject: (
    input: CorosWatchfaceProjectSaveInput
  ) => Promise<CorosWatchfaceProject>;
  loadCorosWatchfaceProject: (
    projectId: string
  ) => Promise<CorosWatchfaceProject>;
  cacheCorosWatchfaceProjectPreview: (
    projectId: string,
    previewDataUrl: string
  ) => Promise<void>;
  duplicateCorosWatchfaceProject: (
    projectId: string
  ) => Promise<CorosWatchfaceProject>;
  deleteCorosWatchfaceProject: (projectId: string) => Promise<void>;
  describeCorosWatchfaceTemplate: (
    archiveId: string
  ) => Promise<CorosWatchfaceTemplateDetails>;
  loadCorosWatchfaceTemplateAssets: (
    archiveId: string,
    paths: string[]
  ) => Promise<CorosWatchfaceTemplateAsset[]>;
  loadCorosWatchfaceTemplateConfigTexts: (
    archiveId: string
  ) => Promise<CorosWatchfaceConfigTextFile[]>;
  publishCorosWatchface: (
    input: CorosWatchfacePublishInput
  ) => Promise<CorosWatchfaceShareLink>;
  createCorosWatchfaceShareLink: (
    input: CorosWatchfaceExistingShareInput
  ) => Promise<CorosWatchfaceShareLink>;
  getWatchConnectionSmokeOption: () => Promise<WatchConnectionSmokeOptionId>;
  setWatchConnectionSmokeOption: (
    optionId: WatchConnectionSmokeOptionId
  ) => Promise<WatchStatus>;
  deleteWatchTrack: (relativePath: string) => Promise<WatchStatus>;
  transferLocalTrack: (id: string) => Promise<TransferResult>;
  onWatchTransferProgress: (
    callback: (progress: WatchTransferProgress) => void
  ) => () => void;
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
  downloadCombinedPlaylist: (
    id: string,
    name: string,
    items: DownloadQueueItem[]
  ) => Promise<CombinedDownloadResult>;
  onCombinedDownloadProgress: (
    callback: (update: CombinedDownloadProgressEvent) => void
  ) => () => void;
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
    showIdOrUrl: string,
    offset?: number
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
  ) => Promise<TrainingHubLoginResult>;
  verifyTrainingHubTwoFactor: (code: string) => Promise<TrainingHubStatus>;
  resendTrainingHubTwoFactorCode: () => Promise<void>;
  cancelTrainingHubTwoFactor: () => Promise<void>;
  logoutTrainingHub: () => Promise<TrainingHubStatus>;
  reconnectTrainingHub: () => Promise<TrainingHubLoginResult>;
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
  duplicateLibraryWorkout: (
    programId: string,
    name: string,
    targetSportType?: number
  ) => Promise<TrainingHubLibraryWorkout>;
  getTrainingLibrarySnapshot: () => Promise<TrainingLibrarySnapshot>;
  getNativeTrainingPlan: (remoteId: string) => Promise<TrainingPlanDocument>;
  saveLocalTrainingPlan: (plan: TrainingPlanDocument) => Promise<TrainingPlanDocument>;
  updateTrainingPlanMetadata: (
    id: string,
    patch: TrainingPlanMetadataPatch
  ) => Promise<TrainingPlanDocument>;
  deleteLocalTrainingPlan: (id: string, confirmed: boolean) => Promise<void>;
  previewTrainingPlanCalendar: (planId: string, startDate: string) => Promise<TrainingPlanCalendarPreview>;
  addTrainingPlanToCalendar: (
    previewId: string,
    confirmed: boolean,
    unitSystem: UnitSystem
  ) => Promise<TrainingPlanCalendarMutationResult>;
  previewTrainingPlanCalendarRemoval: (planId: string) => Promise<TrainingPlanCalendarPreview>;
  removeTrainingPlanFromCalendar: (previewId: string, confirmed: boolean) => Promise<TrainingPlanCalendarMutationResult>;
  updateWorkoutMetadata: (
    programIds: string[],
    patch: WorkoutMetadataPatch
  ) => Promise<void>;
  saveTrainingCollection: (
    collection: Pick<TrainingCollection, "id" | "name"> &
      Partial<Pick<TrainingCollection, "description" | "color">>
  ) => Promise<TrainingCollection>;
  deleteTrainingCollection: (id: string, confirmed: boolean) => Promise<void>;
  deleteTrainingLibraryWorkouts: (
    request: TrainingLibraryDeleteRequest
  ) => Promise<string[]>;
  refreshTrainingActivityMatches: (
    startDay: string,
    endDay: string
  ) => Promise<TrainingActivityMatch[]>;
  saveManualActivityMatch: (
    match: TrainingActivityMatch
  ) => Promise<TrainingActivityMatch>;
  listWorkoutExercises: (sport: WorkoutSport) => Promise<WorkoutExerciseOption[]>;
  getWorkoutEditorContext: (unitSystem: UnitSystem) => Promise<WorkoutEditorContext>;
  getWorkoutForEdit: (
    ref: WorkoutEditRef,
    unitSystem: UnitSystem
  ) => Promise<WorkoutEditorDocument>;
  previewWorkoutEdit: (
    ref: WorkoutEditRef,
    revision: string,
    draft: RunWorkoutEditorDraft,
    unitSystem: UnitSystem
  ) => Promise<WorkoutEditPreview>;
  saveWorkoutEdit: (
    ref: WorkoutEditRef,
    revision: string,
    draft: RunWorkoutEditorDraft,
    unitSystem: UnitSystem
  ) => Promise<WorkoutEditSaveResult>;
  scheduleLibraryWorkout: (
    programId: string,
    happenDay: string
  ) => Promise<void>;
  createAndScheduleWorkout: (
    entry: PlanWorkoutEntryInput,
    happenDay: string,
    unitSystem: UnitSystem,
    saveToLibrary?: boolean
  ) => Promise<{ programId?: string }>;
  createLibraryWorkout: (
    entry: PlanWorkoutEntryInput,
    unitSystem: UnitSystem
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
    pbVersion?: number;
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
  syncStrengthHistory: (request?: StrengthHistoryRequest) => Promise<StrengthHistory>;
  getHevyStatus: () => Promise<HevyStatus>;
  connectHevy: (apiKey: string) => Promise<HevyStatus>;
  updateHevySettings: (input: HevySettingsInput) => Promise<HevyStatus>;
  disconnectHevy: () => Promise<void>;
  startRpeBackfill: () => Promise<void>;
  getRpeBackfillStatus: () => Promise<{ pending: number; running: boolean }>;
  getRpeLoadByDay: () => Promise<Record<string, number>>;
  getSportTypeMap: () => Promise<TrainingHubSportType[]>;
  getActivityPaceBaselines: () => Promise<ActivityPaceBaselines>;
  getUpcomingWorkouts: (days?: number) => Promise<TrainingHubUpcomingWorkout[]>;
  getTrainingSleepData: (days?: number) => Promise<TrainingHubSleepSummary>;
  getTrainingHealthInsight: (kind: HealthInsightKind, days?: number) => Promise<HealthInsightResult>;
  getTrainingDailyHealthData: (
    days?: number
  ) => Promise<TrainingHubDailyHealthSummary>;
  uploadTrainingPlan: (
    draft: CorosTrainingPlanDraftInput,
    unitSystem: UnitSystem
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
  listGeneratedRoutes: (offset?: number) => Promise<GeneratedRoutePage>;
  getGeneratedRoute: (id: string) => Promise<GeneratedRoute | null>;
  geocodeRouteLocation: (query: string) => Promise<RouteGeocodeResult>;
  searchRouteLocations: (query: string) => Promise<RouteGeocodeResult[]>;
  reverseGeocodeRouteLocation: (
    lat: number,
    lon: number
  ) => Promise<RouteGeocodeResult>;
  generateRoute: (request: GenerateRouteRequest) => Promise<GeneratedRoute>;
  routeWaypoints: (request: RouteWaypointRequest) => Promise<RouteGeometry>;
  saveDrawnRoute: (payload: DrawnRoutePayload) => Promise<GeneratedRoute>;
  importRouteGpx: (
    activityType?: RouteActivityType
  ) => Promise<GpxImportSummary | null>;
  exportGeneratedRoute: (id: string) => Promise<string | null>;
  deleteGeneratedRoute: (id: string) => Promise<boolean>;
  startRouteShare: (id: string) => Promise<RouteShareSession>;
  stopRouteShare: () => Promise<void>;
  validateRouteApiKey: (apiKey: string) => Promise<RouteApiKeyValidation>;
  getDiagnostics: () => Promise<DiagnosticsSnapshot>;
  copyDiagnostics: () => Promise<DiagnosticsSnapshot>;
  clearDiagnostics: () => Promise<DiagnosticsSnapshot>;
  reportRendererError: (error: RendererDiagnosticError) => void;
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
  getBaseCoachInstructions: () => Promise<string>;
  saveChatSettings: (settings: ChatSettings) => Promise<ChatSettings>;
  testLocalChatConnection: (
    config?: LocalChatConfig
  ) => Promise<LocalChatConnectionTest>;
  detectLocalChatServers: (apiKey?: string) => Promise<LocalChatDiscovery>;
  testOpenRouterConnection: (
    config?: OpenRouterConfig
  ) => Promise<OpenRouterConnectionTest>;
  openOpenRouterKeys: () => Promise<void>;
  openOpenRouterModels: () => Promise<void>;
  getClaudeCodeStatus: () => Promise<ClaudeCodeStatus>;
  connectClaudeCode: () => Promise<ClaudeCodeStatus>;
  testClaudeCodeConnection: () => Promise<ClaudeCodeConnectionTest>;
  openClaudeCodeSetupGuide: () => Promise<void>;
  loginChat: () => Promise<ChatAuthStatus>;
  logoutChat: () => Promise<ChatAuthStatus>;
  sendChat: (
    requestId: string,
    messages: ChatMessage[],
    unitSystem: UnitSystem
  ) => Promise<void>;
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
  listMcpServers: () => Promise<McpServerConfig[]>;
  addMcpServer: (input: McpServerInput) => Promise<McpServerConfig>;
  updateMcpServer: (
    id: string,
    patch: Partial<McpServerInput>
  ) => Promise<McpServerConfig>;
  removeMcpServer: (id: string) => Promise<void>;
  connectMcpServer: (id: string) => Promise<McpServerStatus>;
  disconnectMcpServer: (id: string) => Promise<void>;
  getMcpStatuses: () => Promise<McpServerStatus[]>;
  setMcpBearer: (id: string, token: string) => Promise<void>;
  uploadTrainingPlanDraft: (
    draftId: string,
    unitSystem: UnitSystem,
    destination?: TrainingPlanDestination,
    scheduleDate?: string
  ) => Promise<UploadPlanResult>;
  confirmCorosAction: (requestId: string) => Promise<CoachCorosActionPreview>;
  confirmWorkoutDelete: (requestId: string) => Promise<DeleteWorkoutResult>;
  getFitIndexStatus: () => Promise<FitIndexStatus>;
  startFitIndexSync: (options?: FitIndexSyncOptions) => Promise<FitIndexProgress>;
  cancelFitIndexSync: () => Promise<FitIndexProgress | null>;
  onFitIndexProgress: (callback: (progress: FitIndexProgress) => void) => () => void;
  listPinnedCoachCharts: () => Promise<PinnedCoachChart[]>;
  pinCoachChart: (preview: CoachChartPreview) => Promise<PinnedCoachChart>;
  unpinCoachChart: (id: string) => Promise<void>;
  refreshPinnedCoachChart: (id: string) => Promise<PinnedCoachChart | null>;
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
