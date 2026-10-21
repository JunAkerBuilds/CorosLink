import type { CalendarEventTiming, CalendarWorkoutEventRef, CalendarWorkoutEventSaveResult } from "../electron/calendarSyncTypes";
import type { CorosNativeBleSnapshot } from "../electron/corosNativeBleTypes";
import type { DataModeStatus, LocalOnlyActivationOptions, NetworkAccessReport } from "../electron/privacy/dataModeTypes";
import type { LocalBackupResult, LocalDataOverview, LocalImportResult, LocalRestoreResult, WatchSyncProbe, WatchSyncProgress } from "../electron/localSync/localDataTypes";
import type { ChatGptModelInfo, ChatModelOption } from "../electron/chatModels";
import type { StrengthEditPreview } from "../electron/workoutEditTypes";
import type { HealthInsightKind, HealthInsightResult } from "../electron/healthInsightsTypes";
import type { DiagnosticsSnapshot, RendererDiagnosticError } from "../electron/diagnosticsTypes";
import type { AppleCalendarCredentials, CalendarChoice, CalendarConnectionStatus, CalendarSyncResult, CalendarSyncSettings } from "../electron/calendarSyncTypes";
import type { WatchfaceAiChatSummary, WatchfaceAiEvent, WatchfaceAiMessage, WatchfaceAiOptions, WatchfaceAiSavedChat, WatchfaceAutomationRequest, WatchfaceAutomationResponse, WatchfaceAutomationStatus } from "../electron/watchfaceAutomationTypes";
import type { GoogleCalendarChoice, GoogleCalendarConfigInput, GoogleCalendarStatus, GoogleCalendarSyncResult } from "../electron/googleCalendarTypes";
import type { ManualRaceInput, RaceEditInput, RaceOverview, StravaRaceImportResult } from "../electron/raceTypes";
import type { WorkoutJournalEntry, WorkoutJournalSaveInput } from "../electron/workoutJournalTypes";
import type { CoachConfirmInput, CoachConfirmResult, CoachEventFrame, CoachSendInput, CoachSessionsChange, CoachSnapshot, CoachSubscribeResult } from "../electron/coachHub/coachContract";
import type { RemoteAccessStatus, RemotePairingCode } from "../electron/remote/contract";
import type {
  ActivityBackupFilters,
  ActivityBackupPreview,
  ActivityBackupProgress,
  Audiobook,
  AudiobookDraft,
  AudiobookProgress,
  AudiobookSplitOptions,
  AudiobookTransferResult,
  FreeAudiobook,
  FreeAudiobookDetail,
  BinaryStatus,
  CachedCorosMapPackage,
  CombinedDownloadProgressEvent,
  CombinedDownloadResult,
  CorosMapDownloadJob,
  CorosMapInstallResult,
  CorosMapInstallProgress,
  CorosMapManifest,
  CorosMapPackage,
  DownloadAudioResult,
  DownloadJob,
  DownloadQueueItem,
  DrawnRoutePayload,
  GenerateRouteRequest,
  GeneratedRoute,
  GeneratedRoutePage,
  GeneratedRouteResult,
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
  StravaConfigInput,
  StravaStatus,
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
  ManualActivityLink,
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
  CoachFileUpload,
  ChatSettings,
  ClaudeCodeConnectionTest,
  ClaudeCodeStatus,
  GeminiCliConnectionTest,
  GeminiCliStatus,
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
  PinCoachChartResult,
  PinnedCoachChart,
  LocalChatConfig,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConfig,
  OpenRouterConnectionTest,
  CorosMcpAccount,
  CorosMcpStatus,
  CorosMcpTool,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  CorosTrainingPlanDeleteResult,
  LocalTrainingPlanDeleteResult,
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
  CorosWatchfaceArchiveFolderExportInput,
  CorosWatchfaceExportFolder,
  CorosWatchfaceArtwork,
  CorosWatchfaceCreatorInput,
  CorosWatchfaceConversionInput,
  CorosWatchfaceConversionResult,
  CorosWatchfaceExistingShareInput,
  CorosWatchfaceRasterFontFolder,
  CorosWatchfaceProject,
  CorosWatchfaceProjectSaveInput,
  CorosWatchfaceProjectListOptions,
  CorosWatchfaceProjectSummary,
  CorosWatchfacePublishInput,
  CorosWatchfaceRegion,
  CorosWatchfaceShareImport,
  CorosWatchfaceShareLink,
  CorosWatchfaceStatus,
  CorosWatchfaceConfigTextFile,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateAssetOptions,
  CorosWatchfaceTemplateDetails,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeDownload,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceThemeCacheEntry,
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
  setLanguage: (language: "en" | "fr" | "pt" | "zh-CN") => Promise<void>;
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
  /** Asks to confirm, then removes the saved watch key; resolves with the status either way. */
  forgetCorosWatchKey?: () => Promise<CorosWatchfaceStatus>;
  /** Asks where to save, then writes the saved watch key encrypted with `passphrase`. */
  backupCorosWatchKey?: (passphrase: string) => Promise<import("../electron/types").CorosWatchKeyBackupResult>;
  /** Opens a native dialog to choose a watch key backup; the file stays in the main process. */
  chooseCorosWatchKeyBackup?: () => Promise<import("../electron/types").CorosWatchKeyBackupChoice>;
  /** Decrypts the chosen backup with `passphrase`; main confirms before replacing a different key. */
  restoreCorosWatchKey?: (passphrase: string) => Promise<import("../electron/types").CorosWatchKeyRestoreResult>;
  /** Forgets the chosen backup without restoring it. */
  cancelCorosWatchKeyRestore?: () => Promise<void>;
  listCorosPairedDevices: () => Promise<CorosPairedDevice[]>;
  selectCorosBluetoothDevice: (deviceId: string) => Promise<void>;
  getCorosNativeBleStatus: () => Promise<CorosNativeBleSnapshot>;
  connectCorosNativeBle: (input?: import("../electron/corosNativeBleTypes").CorosNativeBleConnectOptions) => Promise<CorosNativeBleSnapshot>;
  scanCorosNativeBle: () => Promise<CorosNativeBleSnapshot>;
  refreshCorosNativeBle: () => Promise<CorosNativeBleSnapshot>;
  getCorosActivityScreenStatus?: () => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenStatus>;
  listCorosActivityScreenSports?: () => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenSport[]>;
  readCorosActivityScreens?: (sportId: number) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenDocument>;
  getCorosActivityScreenBackups?: () => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenBackup[]>;
  backupCorosActivityScreens?: (input: { snapshotId: string }) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenBackup>;
  syncCorosActivityScreenBaseline?: (input: { snapshotId: string }) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenResult>;
  confirmCorosActivityScreenBaseline?: (input: { snapshotId: string }) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenDocument>;
  previewCorosActivityScreenLayout?: (input: { snapshotId: string; pageIndex: number; fieldCount: number }) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenPreview>;
  applyCorosActivityScreenLayout?: (input: { previewId: string }) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenResult>;
  restoreCorosActivityScreens?: (input: { backupId: string }) => Promise<import("../electron/corosActivityScreenTypes").CorosActivityScreenResult>;
  exportCorosActivityScreenBackup?: (input: { backupId: string }) => Promise<{ saved: boolean }>;
  getCorosMusicInventory: () => Promise<import("../electron/corosBleMusicTypes").CorosBleMusicInventory>;
  getCorosWifiMusicStatus: () => Promise<import("../electron/corosWifiMusicTypes").CorosWifiMusicStatus>;
  sendCorosMusicOverWifi: () => Promise<import("../electron/corosWifiMusicTypes").CorosWifiMusicStatus>;
  sendCorosLibraryMusicOverWifi: (ids: string[]) => Promise<import("../electron/corosWifiMusicTypes").CorosWifiMusicStatus>;
  importCorosWifiMusicBackup: () => Promise<import("../electron/corosWifiMusicTypes").CorosWifiMusicStatus>;
  cancelCorosWifiMusicSync: () => Promise<void>;
  restoreCorosWifiMusicSettings: () => Promise<import("../electron/corosWifiMusicTypes").CorosWifiMusicStatus>;
  deleteCorosMusicTrack: (target: import("../electron/corosBleMusicTypes").CorosBleMusicDeleteTarget) => Promise<import("../electron/corosBleMusicTypes").CorosBleMusicDeleteResult>;
  disconnectCorosNativeBle: () => Promise<CorosNativeBleSnapshot>;
  createCorosPhonePairingCode?: () => Promise<import("../electron/corosNativeBleTypes").CorosPhonePairingCode>;
  startCorosWatchfacePhoneSend?: (input: import("../electron/watchfacePhoneSendTypes").WatchfacePhoneSendInput) => Promise<import("../electron/watchfacePhoneSendTypes").WatchfacePhoneSend>;
  stopCorosWatchfacePhoneSend?: () => Promise<void>;
  /** macOS only: opens the share menu, with AirDrop, for the face as a .dat C-LINK opens. */
  airDropCorosWatchfaceToIphone?: (input: import("../electron/watchfacePhoneSendTypes").WatchfacePhoneSendInput) => Promise<void>;
  onCorosWatchfacePhoneSendStatus?: (callback: (status: import("../electron/watchfacePhoneSendTypes").WatchfacePhoneSendStatus) => void) => () => void;
  sendCorosNotification: (input: import("../electron/corosBleNotificationProtocol").CorosNotificationInput) => Promise<{ sent: true; fragments: number }>;
  chooseCorosDirectWatchface: () => Promise<import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfacePreview | null>;
  getCorosWatchfaceSyncStatus: () => Promise<import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfaceStatus>;
  getCorosWatchfaceSlots: () => Promise<import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfaceInventory>;
  syncCorosWatchface: (previewId: string, target?: import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfaceTarget) => Promise<import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfaceStatus>;
  cancelCorosWatchfaceSync: () => Promise<void>;
  getCorosWatchfaceCompilerStatus: () => Promise<import("../electron/corosWatchfaceCompilerTypes").CorosWatchfaceCompilerStatus>;
  compileCorosDirectWatchface: () => Promise<import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfacePreview | null>;
  compileCorosWatchfaceArchive: (input: { archiveId: string; name: string; firmwareType?: string }) => Promise<import("../electron/corosBleWatchfaceTypes").CorosDirectWatchfacePreview>;
  saveCorosCompiledWatchface: (previewId: string) => Promise<{ saved: boolean }>;
  getCorosWifiMapStatus: () => Promise<import("../electron/corosWifiMapTypes").CorosWifiMapStatus>;
  previewCorosWifiMap: (tiles: import("../electron/corosWifiMapTypes").CorosWifiMapTile[]) => Promise<import("../electron/corosWifiMapTypes").CorosWifiMapPreview>;
  downloadCorosWifiMap: (previewId: string) => Promise<{ taskId: string; status: import("../electron/corosWifiMapTypes").CorosWifiMapStatus }>;
  getCorosRouteSyncStatus: () => Promise<import("../electron/corosBleRouteTypes").CorosRouteSyncStatus>;
  syncCorosRoute: (routeId: string) => Promise<import("../electron/corosBleRouteTypes").CorosRouteSyncStatus>;
  getWatchProfile: () => Promise<import("../electron/watchProfileService").WatchProfileSummary | null>;
  updateWatchProfile: (edits: { maxHr?: number; restingHr?: number; thresholdHr?: number; hrZoneType?: number; thresholdPaceSecondsPerKm?: number }) => Promise<import("../electron/watchProfileService").WatchProfileSummary>;
  setWatchWeatherLocation: (location: { latitude: number; longitude: number; place?: string }) => Promise<void>;
  getWatchSettings: () => Promise<import("../electron/watchSettingsService").WatchSettingsSummary | null>;
  updateWatchSettings: (edits: Record<string, number>) => Promise<import("../electron/watchSettingsService").WatchSettingsSummary>;
  getWeatherLocation: () => Promise<import("../electron/watchWeatherService").WeatherLocation | null>;
  chooseWeatherLocation: (location: { latitude: number; longitude: number; place?: string } | null) => Promise<import("../electron/watchWeatherService").WeatherLocation | null>;
  searchWeatherPlaces: (query: string, language: string) => Promise<import("../electron/watchWeatherService").WeatherPlace[]>;
  sendWorkoutToWatch: (programId: string) => Promise<{ slot: number; bytes: number }>;
  cancelCorosRouteSync: () => Promise<void>;
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
  readCachedCorosWatchfaceThemes: (
    input: CorosWatchfaceThemeListInput
  ) => Promise<CorosWatchfaceThemeCacheEntry | null>;
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
  chooseCorosWatchfaceExportFolder: () => Promise<CorosWatchfaceExportFolder | null>;
  exportCorosWatchfaceArchiveToFolder: (
    input: CorosWatchfaceArchiveFolderExportInput
  ) => Promise<CorosWatchfaceProjectExportResult>;
  listCorosWatchfaceProjects: (
    options?: CorosWatchfaceProjectListOptions
  ) => Promise<CorosWatchfaceProjectSummary[]>;
  loadCorosWatchfaceProjectPreview: (projectId: string) => Promise<string | null>;
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
    paths: string[],
    options?: CorosWatchfaceTemplateAssetOptions
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
  listAudiobooks: () => Promise<Audiobook[]>;
  chooseAudiobookFiles: () => Promise<AudiobookDraft | null>;
  convertAudiobookDraft: (draftId: string, split: AudiobookSplitOptions) => Promise<Audiobook>;
  discardAudiobookDraft: (draftId: string) => Promise<void>;
  cancelAudiobookConversion: (id: string) => Promise<boolean>;
  deleteAudiobook: (id: string) => Promise<Audiobook[]>;
  transferAudiobook: (id: string) => Promise<AudiobookTransferResult>;
  removeAudiobookFromWatch: (id: string) => Promise<WatchStatus>;
  listPopularFreeAudiobooks: () => Promise<FreeAudiobook[]>;
  searchFreeAudiobooks: (query: string) => Promise<FreeAudiobook[]>;
  loadFreeAudiobook: (identifier: string) => Promise<FreeAudiobookDetail>;
  importFreeAudiobook: (identifier: string, split: AudiobookSplitOptions) => Promise<Audiobook>;
  onAudiobookProgress: (
    callback: (progress: AudiobookProgress) => void
  ) => () => void;
  onAudiobookUpdated: (callback: (book: Audiobook) => void) => () => void;
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
  unlockSpotifyFollowedPlaylists: () => Promise<SpotifyStatus>;
  lockSpotifyFollowedPlaylists: () => Promise<SpotifyStatus>;
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
  /** COROS ended the session (status signed out), or CorosLink renewed a dead one on its own. */
  onTrainingHubSessionChange?: (
    callback: (status: TrainingHubStatus) => void
  ) => () => void;
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
  deleteLocalTrainingPlan: (id: string, confirmed: boolean) => Promise<LocalTrainingPlanDeleteResult>;
  deleteCorosTrainingPlan: (
    remoteId: string,
    confirmed: boolean
  ) => Promise<CorosTrainingPlanDeleteResult>;
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
  listManualActivityLinks: (
    startDay: string,
    endDay: string
  ) => Promise<ManualActivityLink[]>;
  saveManualActivityLink: (
    entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan" | "happenDay" | "trainingLoad">,
    activity?: Pick<TrainingHubActivity, "activityId" | "duration" | "distance" | "trainingLoad">
  ) => Promise<ManualActivityLink>;
  clearManualActivityLink: (planId: string, idInPlan: string) => Promise<void>;
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
  copyScheduledWorkout: (
    entry: { planId: string; idInPlan: string; happenDay: string; rawProgram?: Record<string, unknown> },
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
    fileType?: TrainingHubActivityFileType,
    filters?: ActivityBackupFilters
  ) => Promise<ActivityBackupProgress>;
  previewActivityBackup: (
    filters?: ActivityBackupFilters
  ) => Promise<ActivityBackupPreview>;
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
  getStravaStatus: () => Promise<StravaStatus>;
  saveStravaConfig: (input: StravaConfigInput) => Promise<StravaStatus>;
  connectStrava: () => Promise<StravaStatus>;
  cancelStravaConnect: () => Promise<void>;
  disconnectStrava: () => Promise<void>;
  listWorkoutJournal: (startDay: string, endDay: string) => Promise<WorkoutJournalEntry[]>;
  /** Saves as the athlete; resolves null when the entry ended up empty and was removed. */
  saveWorkoutJournal: (input: WorkoutJournalSaveInput) => Promise<WorkoutJournalEntry | null>;
  onWorkoutJournalChanged: (callback: () => void) => () => void;
  /** Any schedule write (calendar, Training Library, Coach, automation) landed on COROS. */
  onScheduledWorkoutsChanged?: (callback: () => void) => () => void;
  getRaceOverview: () => Promise<RaceOverview>;
  listRaceActivityIds: () => Promise<string[]>;
  markActivityAsRace: (activity: TrainingHubActivity) => Promise<RaceOverview>;
  unmarkActivityAsRace: (activityId: string) => Promise<RaceOverview>;
  dismissRaceSuggestion: (activityId: string) => Promise<RaceOverview>;
  updateRace: (input: RaceEditInput) => Promise<RaceOverview>;
  removeRace: (raceId: string) => Promise<RaceOverview>;
  addManualRace: (input: ManualRaceInput) => Promise<RaceOverview>;
  importStravaRaces: (full?: boolean) => Promise<StravaRaceImportResult>;
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
  generateRoute: (request: GenerateRouteRequest) => Promise<GeneratedRouteResult>;
  replaceGeneratedRouteGeometry: (
    id: string,
    geometry: RouteGeometry
  ) => Promise<GeneratedRoute>;
  routeWaypoints: (request: RouteWaypointRequest) => Promise<RouteGeometry>;
  saveDrawnRoute: (payload: DrawnRoutePayload) => Promise<GeneratedRoute>;
  importRouteGpx: (
    activityType?: RouteActivityType
  ) => Promise<GpxImportSummary | null>;
  exportGeneratedRoute: (id: string) => Promise<string | null>;
  deleteGeneratedRoute: (id: string) => Promise<boolean>;
  deleteAllGeneratedRoutes: () => Promise<number>;
  startRouteShare: (id: string) => Promise<RouteShareSession>;
  stopRouteShare: () => Promise<void>;
  validateRouteApiKey: (apiKey: string) => Promise<RouteApiKeyValidation>;
  /** `rangeHours` limits the report to failures seen in that many recent hours. */
  getDiagnostics: (rangeHours?: number) => Promise<DiagnosticsSnapshot>;
  copyDiagnostics: (rangeHours?: number) => Promise<DiagnosticsSnapshot>;
  clearDiagnostics: () => Promise<DiagnosticsSnapshot>;
  reportRendererError: (error: RendererDiagnosticError) => void;
  getAppInfo: () => Promise<AppInfo>;
  isOnboardingPending: () => Promise<boolean>;
  completeOnboarding: () => Promise<void>;
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
  listChatModels: (provider: ChatProvider) => Promise<ChatModelOption[]>;
  getClaudeCodeStatus: () => Promise<ClaudeCodeStatus>;
  connectClaudeCode: () => Promise<ClaudeCodeStatus>;
  testClaudeCodeConnection: () => Promise<ClaudeCodeConnectionTest>;
  openClaudeCodeSetupGuide: () => Promise<void>;
  getGeminiCliStatus: () => Promise<GeminiCliStatus>;
  /** Like getGeminiCliStatus, but also retries a remembered sign-in refusal once. */
  recheckGeminiCli: () => Promise<GeminiCliStatus>;
  connectGeminiCli: () => Promise<GeminiCliStatus>;
  testGeminiCliConnection: () => Promise<GeminiCliConnectionTest>;
  openGeminiCliSetupGuide: (topic: "install" | "sign-in") => Promise<void>;
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
  getCorosMcpAccount: () => Promise<CorosMcpAccount>;
  disconnectMcpServer: (id: string) => Promise<void>;
  getMcpStatuses: () => Promise<McpServerStatus[]>;
  /** An MCP server connected or lost its connection. */
  onMcpConnectionChanged?: (
    callback: (change: { id: string; connected: boolean }) => void
  ) => () => void;
  setMcpBearer: (id: string, token: string) => Promise<void>;
  uploadTrainingPlanDraft: (
    draftId: string,
    unitSystem: UnitSystem,
    destination?: TrainingPlanDestination,
    scheduleDate?: string
  ) => Promise<UploadPlanResult>;
  confirmCorosAction: (requestId: string) => Promise<CoachCorosActionPreview>;
  confirmWorkoutDelete: (requestId: string) => Promise<DeleteWorkoutResult>;
  coachListSessions: (provider?: ChatProvider) => Promise<ChatSessionSummary[]>;
  coachGetSession: (sessionId: string) => Promise<CoachSnapshot>;
  coachCreateSession: (provider: ChatProvider) => Promise<ChatSessionSummary>;
  coachDeleteSession: (sessionId: string) => Promise<void>;
  coachDeleteAllSessions: (provider: ChatProvider) => Promise<number>;
  coachSubscribe: (
    sessionId: string,
    afterSeq: number
  ) => Promise<{ response: CoachSubscribeResult; replay: CoachEventFrame[] }>;
  coachUnsubscribe: (sessionId: string) => Promise<void>;
  coachSend: (input: CoachSendInput & { uploads?: CoachFileUpload[] }) => Promise<{ requestId: string }>;
  coachAttachmentPreview: (sessionId: string, attachmentId: string) => Promise<string | null>;
  coachOpenAttachment: (sessionId: string, attachmentId: string) => Promise<void>;
  coachCancel: (sessionId: string) => Promise<{ cancelled: boolean }>;
  coachConfirm: (input: CoachConfirmInput) => Promise<CoachConfirmResult>;
  coachBeginLocalTurn: (sessionId: string, clientMessageId: string, text: string) => Promise<{ requestId: string }>;
  coachFinishLocalTurn: (sessionId: string, requestId: string, reply: string) => Promise<void>;
  onCoachEvent: (callback: (frame: CoachEventFrame) => void) => () => void;
  onCoachSessionsChanged: (callback: (change: CoachSessionsChange) => void) => () => void;
  /** Coach's provider or model changed outside this window (a phone picked one). */
  onChatSettingsChanged: (callback: (settings: ChatSettings) => void) => () => void;
  getRemoteAccessStatus: () => Promise<RemoteAccessStatus>;
  setRemoteNetworkAccess: (enabled: boolean) => Promise<RemoteAccessStatus>;
  setRemoteKeepAwake: (enabled: boolean) => Promise<RemoteAccessStatus>;
  createRemotePairing: (input?: { viewOnly?: boolean }) => Promise<RemotePairingCode>;
  cancelRemotePairing: (id?: string) => Promise<RemoteAccessStatus>;
  revokeRemoteDevice: (id: string) => Promise<RemoteAccessStatus>;
  /** Away from home: sign in to watchfaces.coroslink.com in the browser. */
  cloudSignIn: () => Promise<RemoteAccessStatus>;
  cloudCancelSignIn: () => Promise<RemoteAccessStatus>;
  /** Signs out of watchfaces.coroslink.com and unlinks this computer. */
  cloudSignOut: () => Promise<RemoteAccessStatus>;
  /** "Link this computer"; `allowDownload` once the person agreed to download cloudflared. */
  setCloudLink: (input: { enabled: boolean; allowDownload?: boolean }) => Promise<RemoteAccessStatus>;
  cloudUnlink: () => Promise<RemoteAccessStatus>;
  onRemoteAccessStatus: (callback: (status: RemoteAccessStatus) => void) => () => void;
  getFitIndexStatus: () => Promise<FitIndexStatus>;
  startFitIndexSync: (options?: FitIndexSyncOptions) => Promise<FitIndexProgress>;
  cancelFitIndexSync: () => Promise<FitIndexProgress | null>;
  onFitIndexProgress: (callback: (progress: FitIndexProgress) => void) => () => void;
  listPinnedCoachCharts: () => Promise<PinnedCoachChart[]>;
  pinCoachChart: (preview: CoachChartPreview) => Promise<PinCoachChartResult>;
  unpinCoachChart: (id: string) => Promise<void>;
  refreshPinnedCoachChart: (id: string) => Promise<PinnedCoachChart | null>;
  setWindowBackground: (color: string) => Promise<void>;
  isWindowFullscreen: () => Promise<boolean>;
  onWindowFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
  // Local-Only Mode (Settings → Privacy).
  /** CorosLink started in Local-Only Mode (known before the first data-mode status arrives). */
  localOnlyAtLaunch?: boolean;
  getDataModeStatus: () => Promise<DataModeStatus>;
  activateLocalOnlyMode: (options: LocalOnlyActivationOptions) => Promise<DataModeStatus>;
  /** Asks for native confirmation, then saves Connected Mode and restarts CorosLink. */
  returnToConnectedMode: () => Promise<DataModeStatus>;
  getNetworkAccessReport: () => Promise<NetworkAccessReport>;
  clearNetworkAccessReport: () => Promise<NetworkAccessReport>;
  onDataModeChange: (callback: (status: DataModeStatus) => void) => () => void;
  getLocalDataOverview: () => Promise<LocalDataOverview>;
  importLocalFitFiles: (folder?: boolean) => Promise<LocalImportResult>;
  syncWatchLocally: () => Promise<WatchSyncProgress>;
  getWatchSyncProgress: () => Promise<WatchSyncProgress>;
  cancelWatchSync: () => Promise<WatchSyncProgress>;
  /**
   * The user agrees, once, that a sync may replace a training plan on the watch that CorosLink
   * didn't put there (a sync result's `calendar.foreignPlan`). Remembered; the next sync replaces it.
   */
  allowWatchPlanReplacement: () => Promise<void>;
  /** Whether that agreement is on (the watch section of Privacy & local data shows it as a switch). */
  getWatchPlanReplacement: () => Promise<boolean>;
  /** Turns the agreement on or off; off, the next sync asks again. Resolves with the setting now. */
  setWatchPlanReplacement: (allowed: boolean) => Promise<boolean>;
  readWatchDayTotals: () => Promise<unknown>;
  /** Developer test (COROSLINK_SYNC_CAPTURE=1): send satellite data to the watch now. */
  sendSatelliteDataNow?: () => Promise<NonNullable<WatchSyncProgress["satellite"]>>;
  /** Reads the first activity block without acknowledging it, then disconnects (developer capture mode). */
  probeWatchSync: (options?: { allBlocks?: boolean; selector?: number; fileIndex?: number }) => Promise<WatchSyncProbe>;
  getWatchAutoSync: () => Promise<import("../electron/watchAutoSyncService").WatchAutoSyncState>;
  setWatchAutoSync: (input: { enabled?: boolean; intervalHours?: number }) => Promise<import("../electron/watchAutoSyncService").WatchAutoSyncState>;
  onWatchAutoSyncChange: (callback: (state: import("../electron/watchAutoSyncService").WatchAutoSyncState) => void) => () => void;
  onWatchSyncProgress: (callback: (progress: WatchSyncProgress) => void) => () => void;
  exportLocalBackup: (passphrase?: string) => Promise<LocalBackupResult>;
  chooseLocalBackup: () => Promise<{ chosen: boolean; encrypted?: boolean }>;
  restoreLocalBackup: (passphrase?: string) => Promise<LocalRestoreResult>;
}

declare global {
  interface Window {
    corosLink?: CorosLinkApi;
  }
}

export {};
