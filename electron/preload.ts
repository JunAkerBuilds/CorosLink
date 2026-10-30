import type { CalendarEventTiming, CalendarWorkoutEventRef, CalendarWorkoutEventSaveResult } from "./calendarSyncTypes";
import type { ChatGptModelInfo, ChatModelOption } from "./chatModels";
import type { HealthInsightKind, HealthInsightResult } from "./healthInsightsTypes";
import { contextBridge, ipcRenderer } from "electron";
import type { DataModeStatus, LocalOnlyActivationOptions, NetworkAccessReport } from "./privacy/dataModeTypes";
import type { LocalBackupResult, LocalDataOverview, LocalImportResult, LocalRestoreResult, WatchSyncProbe, WatchSyncProgress } from "./localSync/localDataTypes";
import type { CorosNativeBleSnapshot } from "./corosNativeBleTypes";
import type { DiagnosticsSnapshot, RendererDiagnosticError } from "./diagnosticsTypes";
import type { WatchfaceAiChatSummary, WatchfaceAiEvent, WatchfaceAiMessage, WatchfaceAiOptions, WatchfaceAiSavedChat, WatchfaceAutomationRequest, WatchfaceAutomationResponse, WatchfaceAutomationStatus } from "./watchfaceAutomationTypes";
import type { AppleCalendarCredentials, CalendarChoice, CalendarConnectionStatus, CalendarSyncResult, CalendarSyncSettings } from "./calendarSyncTypes";
import type { GoogleCalendarChoice, GoogleCalendarConfigInput, GoogleCalendarStatus, GoogleCalendarSyncResult } from "./googleCalendarTypes";
import type { ManualRaceInput, RaceEditInput, RaceOverview, StravaRaceImportResult } from "./raceTypes";
import type { AthleteFact, AthleteFactCategory, AthleteMemoryChange } from "./athleteMemoryModel";
import type { WorkoutJournalEntry, WorkoutJournalSaveInput } from "./workoutJournalTypes";
import type { CoachConfirmInput, CoachConfirmResult, CoachEventFrame, CoachSendInput, CoachSessionsChange, CoachSnapshot, CoachSubscribeResult } from "./coachHub/coachContract";
import type { RemoteAccessStatus, RemotePairingCode } from "./remote/contract";
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
  StrengthSession,
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
  AntigravityConnectionTest,
  AntigravityStatus,
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
} from "./types";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceProjectExportInput,
  CorosWatchfaceProjectExportResult,
  CorosWatchfaceArchiveExportInput,
  CorosWatchfaceAssetImageSaveInput,
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
} from "./types";

const api = {
  setLanguage: (language: "en" | "es" | "fr" | "pt" | "zh-CN"): Promise<void> => ipcRenderer.invoke("app:setLanguage", language),
  getWorkoutAutomationStatus: () => ipcRenderer.invoke("workoutAutomation:status"),
  configureWorkoutAutomation: (input: { enabled: boolean; port?: number }) => ipcRenderer.invoke("workoutAutomation:configure", input),
  onWorkoutEditsChanged: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("workoutEdits:changed", listener);
    return () => ipcRenderer.removeListener("workoutEdits:changed", listener);
  },
  listWorkoutEdits: () => ipcRenderer.invoke("workoutEdits:list"),
  getWorkoutEditStatus: (proposalId: string) => ipcRenderer.invoke("workoutEdits:status", proposalId),
  cancelWorkoutEdit: (proposalId: string) => ipcRenderer.invoke("workoutEdits:cancel", proposalId),
  confirmWorkoutEdit: (input: { proposalId: string; reviewHash: string; selectedIds: string[] }) => ipcRenderer.invoke("workoutEdits:confirm", input),
  getWatchfaceAutomationStatus: (): Promise<WatchfaceAutomationStatus> => ipcRenderer.invoke("watchfaceAutomation:status"),
  configureWatchfaceAutomation: (input: { enabled: boolean; port?: number }): Promise<WatchfaceAutomationStatus> => ipcRenderer.invoke("watchfaceAutomation:configure", input),
  onWatchfaceAutomationActivate: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("watchfaceAutomation:activate", listener);
    return () => ipcRenderer.removeListener("watchfaceAutomation:activate", listener);
  },
  onWatchfaceAutomationRequest: (callback: (request: WatchfaceAutomationRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: WatchfaceAutomationRequest) => callback(request);
    ipcRenderer.on("watchfaceAutomation:request", listener);
    return () => ipcRenderer.removeListener("watchfaceAutomation:request", listener);
  },
  respondWatchfaceAutomation: (response: WatchfaceAutomationResponse): void => ipcRenderer.send("watchfaceAutomation:response", response),
  setWatchfaceAutomationReady: (scope: "hub" | "editor", ready: boolean): void => ipcRenderer.send("watchfaceAutomation:ready", scope, ready),
  sendWatchfaceAi: (requestId: string, messages: WatchfaceAiMessage[], options?: WatchfaceAiOptions): Promise<void> => ipcRenderer.invoke("watchfaceAi:send", requestId, messages, options ?? {}),
  cancelWatchfaceAi: (requestId: string): Promise<void> => ipcRenderer.invoke("watchfaceAi:cancel", requestId),
  listWatchfaceAiModels: (): Promise<ChatGptModelInfo[]> => ipcRenderer.invoke("watchfaceAi:models"),
  listWatchfaceAiChats: (projectKey: string): Promise<WatchfaceAiChatSummary[]> => ipcRenderer.invoke("watchfaceAi:listChats", projectKey),
  loadWatchfaceAiChat: (id: string): Promise<WatchfaceAiSavedChat> => ipcRenderer.invoke("watchfaceAi:loadChat", id),
  saveWatchfaceAiChat: (input: { id?: string; projectKey: string; title?: string; messages: unknown[] }): Promise<WatchfaceAiChatSummary> => ipcRenderer.invoke("watchfaceAi:saveChat", input),
  renameWatchfaceAiChat: (id: string, title: string): Promise<WatchfaceAiChatSummary> => ipcRenderer.invoke("watchfaceAi:renameChat", id, title),
  deleteWatchfaceAiChat: (id: string): Promise<void> => ipcRenderer.invoke("watchfaceAi:deleteChat", id),
  copyWatchfaceAiImage: (assetId: string): Promise<void> => ipcRenderer.invoke("watchfaceAi:copyImage", assetId),
  onWatchfaceAiEvent: (callback: (event: WatchfaceAiEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WatchfaceAiEvent) => callback(payload);
    ipcRenderer.on("watchfaceAi:event", listener);
    return () => ipcRenderer.removeListener("watchfaceAi:event", listener);
  },
  getAppleCalendarStatus: (): Promise<CalendarConnectionStatus> => ipcRenderer.invoke("appleCalendar:status"),
  connectAppleCalendar: (input: AppleCalendarCredentials): Promise<CalendarConnectionStatus> => ipcRenderer.invoke("appleCalendar:connect", input),
  cancelAppleCalendarConnect: (): Promise<void> => ipcRenderer.invoke("appleCalendar:cancelConnect"),
  disconnectAppleCalendar: (): Promise<CalendarConnectionStatus> => ipcRenderer.invoke("appleCalendar:disconnect"),
  listAppleCalendars: (): Promise<CalendarChoice[]> => ipcRenderer.invoke("appleCalendar:listCalendars"),
  getCalendarWorkoutEvent: (ref: CalendarWorkoutEventRef): Promise<CalendarEventTiming> => ipcRenderer.invoke("calendar:getWorkoutEvent", ref),
  updateCalendarWorkoutEvent: (input: { ref: CalendarWorkoutEventRef; timing: CalendarEventTiming }): Promise<CalendarWorkoutEventSaveResult> => ipcRenderer.invoke("calendar:updateWorkoutEvent", input),
  syncEditedCalendarWorkout: (ref: CalendarWorkoutEventRef): Promise<Pick<CalendarWorkoutEventSaveResult, "synced" | "errors">> => ipcRenderer.invoke("calendar:syncEditedWorkout", ref),
  updateAppleCalendarSettings: (input: CalendarSyncSettings): Promise<CalendarConnectionStatus> => ipcRenderer.invoke("appleCalendar:updateSettings", input),
  syncAppleCalendar: (): Promise<CalendarSyncResult> => ipcRenderer.invoke("appleCalendar:sync"),
  getGoogleCalendarStatus: (): Promise<GoogleCalendarStatus> => ipcRenderer.invoke("googleCalendar:status"),
  saveGoogleCalendarConfig: (input: GoogleCalendarConfigInput): Promise<GoogleCalendarStatus> => ipcRenderer.invoke("googleCalendar:saveConfig", input),
  connectGoogleCalendar: (): Promise<GoogleCalendarStatus> => ipcRenderer.invoke("googleCalendar:connect"),
  cancelGoogleCalendarConnect: (): Promise<void> => ipcRenderer.invoke("googleCalendar:cancelConnect"),
  disconnectGoogleCalendar: (): Promise<GoogleCalendarStatus> => ipcRenderer.invoke("googleCalendar:disconnect"),
  listGoogleCalendars: (): Promise<GoogleCalendarChoice[]> => ipcRenderer.invoke("googleCalendar:listCalendars"),
  updateGoogleCalendarSettings: (input: CalendarSyncSettings): Promise<GoogleCalendarStatus> => ipcRenderer.invoke("googleCalendar:updateSettings", input),
  syncGoogleCalendar: (): Promise<GoogleCalendarSyncResult> => ipcRenderer.invoke("googleCalendar:sync"),
  // Host OS, so the renderer can reserve space for the macOS traffic lights.
  platform: process.platform,
  nativeSidebarGlass: process.platform === "darwin" && process.argv.includes("--coros-native-sidebar-glass"),
  /** CorosLink started in Local-Only Mode (known before the first data-mode status arrives). */
  localOnlyAtLaunch: process.argv.includes("--coroslink-local-only"),
  getWatchStatus: (): Promise<WatchStatus> =>
    ipcRenderer.invoke("watch:getStatus"),
  getCorosWatchfaceStatus: (): Promise<CorosWatchfaceStatus> =>
    ipcRenderer.invoke("watchfaces:getStatus"),
  listLocalFontFamilies: (): Promise<string[]> =>
    ipcRenderer.invoke("watchfaces:listLocalFontFamilies"),
  loginCorosWatchfaces: (
    email: string,
    password: string,
    region: CorosWatchfaceRegion,
    remember: boolean
  ): Promise<CorosWatchfaceStatus> =>
    ipcRenderer.invoke("watchfaces:login", email, password, region, remember),
  loginCorosWatchfacesWithSavedCredentials: (
    region: CorosWatchfaceRegion
  ): Promise<CorosWatchfaceStatus> =>
    ipcRenderer.invoke("watchfaces:loginSaved", region),
  logoutCorosWatchfaces: (): Promise<CorosWatchfaceStatus> =>
    ipcRenderer.invoke("watchfaces:logout"),
  forgetCorosWatchKey: (): Promise<CorosWatchfaceStatus> =>
    ipcRenderer.invoke("watchfaces:forgetWatchKey"),
  // The passphrase goes to the main process once per operation; the key never comes back.
  backupCorosWatchKey: (passphrase: string): Promise<import("./types").CorosWatchKeyBackupResult> =>
    ipcRenderer.invoke("watchfaces:backupWatchKey", { passphrase }),
  chooseCorosWatchKeyBackup: (): Promise<import("./types").CorosWatchKeyBackupChoice> =>
    ipcRenderer.invoke("watchfaces:chooseWatchKeyBackup"),
  restoreCorosWatchKey: (passphrase: string): Promise<import("./types").CorosWatchKeyRestoreResult> =>
    ipcRenderer.invoke("watchfaces:restoreWatchKey", { passphrase }),
  cancelCorosWatchKeyRestore: (): Promise<void> =>
    ipcRenderer.invoke("watchfaces:cancelWatchKeyRestore"),
  listCorosPairedDevices: (): Promise<CorosPairedDevice[]> =>
    ipcRenderer.invoke("watchfaces:listPairedDevices"),
  selectCorosBluetoothDevice: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke("watchfaces:selectBluetoothDevice", deviceId),
  getCorosNativeBleStatus: (): Promise<CorosNativeBleSnapshot> => ipcRenderer.invoke("corosBle:status"),
  connectCorosNativeBle: (input?: import("./corosNativeBleTypes").CorosNativeBleConnectOptions): Promise<CorosNativeBleSnapshot> => ipcRenderer.invoke("corosBle:connect", input),
  scanCorosNativeBle: (): Promise<CorosNativeBleSnapshot> => ipcRenderer.invoke("corosBle:scan"),
  refreshCorosNativeBle: (): Promise<CorosNativeBleSnapshot> => ipcRenderer.invoke("corosBle:refresh"),
  getCorosActivityScreenStatus: (): Promise<import("./corosActivityScreenTypes").CorosActivityScreenStatus> => ipcRenderer.invoke("corosBle:activityScreenStatus"),
  listCorosActivityScreenSports: (): Promise<import("./corosActivityScreenTypes").CorosActivityScreenSport[]> => ipcRenderer.invoke("corosBle:activityScreenSports"),
  readCorosActivityScreens: (sportId: number): Promise<import("./corosActivityScreenTypes").CorosActivityScreenDocument> => ipcRenderer.invoke("corosBle:activityScreensRead", sportId),
  getCorosActivityScreenBackups: (): Promise<import("./corosActivityScreenTypes").CorosActivityScreenBackup[]> => ipcRenderer.invoke("corosBle:activityScreenBackups"),
  backupCorosActivityScreens: (input: { snapshotId: string }): Promise<import("./corosActivityScreenTypes").CorosActivityScreenBackup> => ipcRenderer.invoke("corosBle:activityScreensBackup", input),
  syncCorosActivityScreenBaseline: (input: { snapshotId: string }): Promise<import("./corosActivityScreenTypes").CorosActivityScreenResult> => ipcRenderer.invoke("corosBle:activityScreenBaselineSync", input),
  confirmCorosActivityScreenBaseline: (input: { snapshotId: string }): Promise<import("./corosActivityScreenTypes").CorosActivityScreenDocument> => ipcRenderer.invoke("corosBle:activityScreenBaselineConfirm", input),
  previewCorosActivityScreenLayout: (input: { snapshotId: string; pageIndex: number; fieldCount: number }): Promise<import("./corosActivityScreenTypes").CorosActivityScreenPreview> => ipcRenderer.invoke("corosBle:activityScreenPreview", input),
  applyCorosActivityScreenLayout: (input: { previewId: string }): Promise<import("./corosActivityScreenTypes").CorosActivityScreenResult> => ipcRenderer.invoke("corosBle:activityScreenApply", input),
  restoreCorosActivityScreens: (input: { backupId: string }): Promise<import("./corosActivityScreenTypes").CorosActivityScreenResult> => ipcRenderer.invoke("corosBle:activityScreensRestore", input),
  exportCorosActivityScreenBackup: (input: { backupId: string }): Promise<{ saved: boolean }> => ipcRenderer.invoke("corosBle:activityScreenBackupExport", input),
  getCorosMusicInventory: (): Promise<import("./corosBleMusicTypes").CorosBleMusicInventory> => ipcRenderer.invoke("corosBle:musicInventory"),
  getCorosWifiMusicStatus: (): Promise<import("./corosWifiMusicTypes").CorosWifiMusicStatus> => ipcRenderer.invoke("corosBle:wifiMusicStatus"),
  sendCorosMusicOverWifi: (): Promise<import("./corosWifiMusicTypes").CorosWifiMusicStatus> => ipcRenderer.invoke("corosBle:wifiMusicSend"),
  sendCorosLibraryMusicOverWifi: (ids: string[]): Promise<import("./corosWifiMusicTypes").CorosWifiMusicStatus> => ipcRenderer.invoke("corosBle:wifiMusicLibrarySend", ids),
  importCorosWifiMusicBackup: (): Promise<import("./corosWifiMusicTypes").CorosWifiMusicStatus> => ipcRenderer.invoke("corosBle:wifiMusicBackup"),
  cancelCorosWifiMusicSync: (): Promise<void> => ipcRenderer.invoke("corosBle:wifiMusicCancel"),
  restoreCorosWifiMusicSettings: (): Promise<import("./corosWifiMusicTypes").CorosWifiMusicStatus> => ipcRenderer.invoke("corosBle:wifiMusicRestore"),
  deleteCorosMusicTrack: (target: import("./corosBleMusicTypes").CorosBleMusicDeleteTarget): Promise<import("./corosBleMusicTypes").CorosBleMusicDeleteResult> => ipcRenderer.invoke("corosBle:deleteMusic", target),
  disconnectCorosNativeBle: (): Promise<CorosNativeBleSnapshot> => ipcRenderer.invoke("corosBle:disconnect"),
  createCorosPhonePairingCode: (): Promise<import("./corosNativeBleTypes").CorosPhonePairingCode> => ipcRenderer.invoke("corosBle:phonePairing"),
  startCorosWatchfacePhoneSend: (input: import("./watchfacePhoneSendTypes").WatchfacePhoneSendInput): Promise<import("./watchfacePhoneSendTypes").WatchfacePhoneSend> => ipcRenderer.invoke("watchfaces:phoneSendStart", input),
  stopCorosWatchfacePhoneSend: (): Promise<void> => ipcRenderer.invoke("watchfaces:phoneSendStop"),
  airDropCorosWatchfaceToIphone: (input: import("./watchfacePhoneSendTypes").WatchfacePhoneSendInput): Promise<void> => ipcRenderer.invoke("watchfaces:airDropToIphone", input),
  onCorosWatchfacePhoneSendStatus: (callback: (status: import("./watchfacePhoneSendTypes").WatchfacePhoneSendStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: import("./watchfacePhoneSendTypes").WatchfacePhoneSendStatus) => callback(status);
    ipcRenderer.on("watchfaces:phoneSendStatus", listener);
    return () => ipcRenderer.removeListener("watchfaces:phoneSendStatus", listener);
  },
  sendCorosNotification: (input: import("./corosBleNotificationProtocol").CorosNotificationInput): Promise<{ sent: true; fragments: number }> => ipcRenderer.invoke("corosBle:sendNotification", input),
  chooseCorosDirectWatchface: (): Promise<import("./corosBleWatchfaceTypes").CorosDirectWatchfacePreview | null> => ipcRenderer.invoke("corosBle:chooseWatchface"),
  getCorosWatchfaceSyncStatus: (): Promise<import("./corosBleWatchfaceTypes").CorosDirectWatchfaceStatus> => ipcRenderer.invoke("corosBle:watchfaceStatus"),
  getCorosWatchfaceSlots: (): Promise<import("./corosBleWatchfaceTypes").CorosDirectWatchfaceInventory> => ipcRenderer.invoke("corosBle:watchfaceSlots"),
  syncCorosWatchface: (previewId: string, target?: import("./corosBleWatchfaceTypes").CorosDirectWatchfaceTarget): Promise<import("./corosBleWatchfaceTypes").CorosDirectWatchfaceStatus> => ipcRenderer.invoke("corosBle:watchfaceSync", previewId, target),
  cancelCorosWatchfaceSync: (): Promise<void> => ipcRenderer.invoke("corosBle:watchfaceCancel"),
  getCorosWatchfaceCompilerStatus: (): Promise<import("./corosWatchfaceCompilerTypes").CorosWatchfaceCompilerStatus> => ipcRenderer.invoke("corosBle:compilerStatus"),
  compileCorosDirectWatchface: (options?: { fullColor?: boolean; smoothEdges?: boolean }): Promise<import("./corosBleWatchfaceTypes").CorosDirectWatchfacePreview | null> => ipcRenderer.invoke("corosBle:compileWatchface", options),
  compileCorosWatchfaceArchive: (input: { archiveId: string; name: string; firmwareType?: string; fullColor?: boolean; smoothEdges?: boolean }): Promise<import("./corosBleWatchfaceTypes").CorosDirectWatchfacePreview> => ipcRenderer.invoke("watchfaces:compileBin", input),
  saveCorosCompiledWatchface: (previewId: string): Promise<{ saved: boolean }> => ipcRenderer.invoke("corosBle:saveCompiledBin", previewId),
  getCorosWifiMapStatus: (): Promise<import("./corosWifiMapTypes").CorosWifiMapStatus> => ipcRenderer.invoke("corosBle:mapStatus"),
  previewCorosWifiMap: (tiles: import("./corosWifiMapTypes").CorosWifiMapTile[]): Promise<import("./corosWifiMapTypes").CorosWifiMapPreview> => ipcRenderer.invoke("corosBle:mapPreview", tiles),
  downloadCorosWifiMap: (previewId: string): Promise<{ taskId: string; status: import("./corosWifiMapTypes").CorosWifiMapStatus }> => ipcRenderer.invoke("corosBle:mapDownload", previewId),
  removeCorosWifiMapDownload: (taskId: string): Promise<import("./corosWifiMapTypes").CorosWifiMapStatus> => ipcRenderer.invoke("corosBle:mapRemove", taskId),
  previewCorosMapAreas: (tiles: import("./corosWifiMapTypes").CorosWifiMapTile[]): Promise<import("./corosWifiMapTypes").CorosMapAreaPreview> => ipcRenderer.invoke("maps:previewCorosMapAreas", tiles),
  installCorosMapAreas: (tiles: import("./corosWifiMapTypes").CorosWifiMapTile[], label: string): Promise<CorosMapInstallResult> => ipcRenderer.invoke("maps:installCorosMapAreas", tiles, label),
  getCorosRouteSyncStatus: (): Promise<import("./corosBleRouteTypes").CorosRouteSyncStatus> => ipcRenderer.invoke("corosBle:routeStatus"),
  syncCorosRoute: (routeId: string): Promise<import("./corosBleRouteTypes").CorosRouteSyncStatus> => ipcRenderer.invoke("corosBle:routeSync", routeId),
  getWatchProfile: (): Promise<import("./watchProfileService").WatchProfileSummary | null> => ipcRenderer.invoke("watch:getProfile"),
  updateWatchProfile: (edits: { maxHr?: number; restingHr?: number; thresholdHr?: number; hrZoneType?: number; thresholdPaceSecondsPerKm?: number }): Promise<import("./watchProfileService").WatchProfileSummary> => ipcRenderer.invoke("watch:updateProfile", edits),
  setWatchWeatherLocation: (location: { latitude: number; longitude: number; place?: string }): Promise<void> => ipcRenderer.invoke("watch:setWeatherLocation", location),
  getWatchSettings: (): Promise<import("./watchSettingsService").WatchSettingsSummary | null> => ipcRenderer.invoke("watch:getSettings"),
  updateWatchSettings: (edits: Record<string, number>): Promise<import("./watchSettingsService").WatchSettingsSummary> => ipcRenderer.invoke("watch:updateSettings", edits),
  getWeatherLocation: (): Promise<import("./watchWeatherService").WeatherLocation | null> => ipcRenderer.invoke("watch:getWeatherLocation"),
  chooseWeatherLocation: (location: { latitude: number; longitude: number; place?: string } | null): Promise<import("./watchWeatherService").WeatherLocation | null> =>
    ipcRenderer.invoke("watch:chooseWeatherLocation", location),
  searchWeatherPlaces: (query: string, language: string): Promise<import("./watchWeatherService").WeatherPlace[]> => ipcRenderer.invoke("watch:searchWeatherPlaces", query, language),
  sendWorkoutToWatch: (programId: string): Promise<{ slot: number; bytes: number }> => ipcRenderer.invoke("corosBle:sendWorkout", programId),
  cancelCorosRouteSync: (): Promise<void> => ipcRenderer.invoke("corosBle:routeCancel"),
  cancelCorosBluetoothDeviceSelection: (): Promise<void> =>
    ipcRenderer.invoke("watchfaces:cancelBluetoothDevice"),
  onCorosBluetoothDevices: (
    callback: (devices: CorosBluetoothDeviceChoice[]) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, devices: CorosBluetoothDeviceChoice[]) =>
      callback(devices);
    ipcRenderer.on("watchfaces:bluetoothDevices", listener);
    return () => ipcRenderer.removeListener("watchfaces:bluetoothDevices", listener);
  },
  getCorosBatteryReport: (
    input: CorosBatteryQueryInput
  ): Promise<CorosBatteryReport> => ipcRenderer.invoke("watchfaces:getBatteryReport", input),
  queryCorosGear: (): Promise<CorosGearCatalog> =>
    ipcRenderer.invoke("gear:query"),
  saveCorosGear: (input: CorosGearSaveInput): Promise<CorosGearCatalog> =>
    ipcRenderer.invoke("gear:save", input),
  listCorosWatchfaceThemes: (
    input: CorosWatchfaceThemeListInput
  ): Promise<CorosWatchfaceTheme[]> => ipcRenderer.invoke("watchfaces:listThemes", input),
  readCachedCorosWatchfaceThemes: (
    input: CorosWatchfaceThemeListInput
  ): Promise<CorosWatchfaceThemeCacheEntry | null> =>
    ipcRenderer.invoke("watchfaces:readCachedThemes", input),
  downloadCorosWatchfaceTheme: (
    input: CorosWatchfaceThemeDownloadInput
  ): Promise<CorosWatchfaceThemeDownload> =>
    ipcRenderer.invoke("watchfaces:downloadTheme", input),
  importCorosWatchfaceShareLink: (
    shareUrl: string
  ): Promise<CorosWatchfaceShareImport> =>
    ipcRenderer.invoke("watchfaces:importShareLink", shareUrl),
  ensureCorosOfficialAssetLibrary: (
    input: { firmwareType: string; rebuild?: boolean }
  ): Promise<CorosOfficialAssetLibraryStatus> =>
    ipcRenderer.invoke("watchfaces:officialAssets:ensure", input),
  getCorosOfficialAssetLibraryStatus: (
    input: { firmwareType: string }
  ): Promise<CorosOfficialAssetLibraryStatus> =>
    ipcRenderer.invoke("watchfaces:officialAssets:status", input),
  listCorosOfficialAssets: (
    input: CorosOfficialAssetQuery
  ): Promise<CorosOfficialAssetPage> =>
    ipcRenderer.invoke("watchfaces:officialAssets:list", input),
  readCorosOfficialAssetFrames: (
    input: { firmwareType: string; id: string }
  ): Promise<CorosOfficialAssetFrames> =>
    ipcRenderer.invoke("watchfaces:officialAssets:frames", input),
  listCommunityWatchfaces: (
    input: CommunityWatchfaceCatalogQuery
  ): Promise<CommunityWatchfaceCatalogPage> =>
    ipcRenderer.invoke("watchfaces:listCommunity", input),
  getCommunityWatchface: (slug: string, model?: string): Promise<CommunityWatchface> =>
    ipcRenderer.invoke("watchfaces:getCommunity", slug, model),
  importCommunityWatchface: (slug: string, model?: string): Promise<CommunityWatchfaceImport> =>
    ipcRenderer.invoke("watchfaces:importCommunity", slug, model),
  consumeCommunityWatchfaceOpenRequest:
    (): Promise<CommunityWatchfaceOpenRequest | null> =>
      ipcRenderer.invoke("watchfaces:consumeCommunityOpenRequest"),
  onCommunityWatchfaceOpenRequest: (
    callback: (request: CommunityWatchfaceOpenRequest) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: CommunityWatchfaceOpenRequest
    ) => callback(request);
    ipcRenderer.on("watchfaces:communityOpenRequested", listener);
    return () =>
      ipcRenderer.removeListener("watchfaces:communityOpenRequested", listener);
  },
  onCommunityWatchfaceDownloadProgress: (
    callback: (progress: CommunityWatchfaceDownloadProgress) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: CommunityWatchfaceDownloadProgress
    ) => callback(progress);
    ipcRenderer.on("watchfaces:communityDownloadProgress", listener);
    return () =>
      ipcRenderer.removeListener("watchfaces:communityDownloadProgress", listener);
  },
  chooseCorosWatchfaceArchive: (): Promise<CorosWatchfaceArchive | null> =>
    ipcRenderer.invoke("watchfaces:chooseArchive"),
  chooseCorosWatchfaceArtwork: (): Promise<CorosWatchfaceArtwork | null> =>
    ipcRenderer.invoke("watchfaces:chooseArtwork"),
  chooseCorosWatchfaceRasterFontFolder: (): Promise<CorosWatchfaceRasterFontFolder | null> =>
    ipcRenderer.invoke("watchfaces:chooseRasterFontFolder"),
  convertCorosWatchfaceArchive: (input: CorosWatchfaceConversionInput): Promise<CorosWatchfaceConversionResult> =>
    ipcRenderer.invoke("watchfaces:convertArchive", input),
  createCorosWatchfaceArchive: (
    input: CorosWatchfaceCreatorInput
  ): Promise<CorosWatchfaceArchive> =>
    ipcRenderer.invoke("watchfaces:createArchive", input),
  exportCorosWatchfaceProject: (
    input: CorosWatchfaceProjectExportInput
  ): Promise<CorosWatchfaceProjectExportResult> =>
    ipcRenderer.invoke("watchfaces:exportProject", input),
  exportCorosWatchfaceArchive: (
    input: CorosWatchfaceArchiveExportInput
  ): Promise<CorosWatchfaceProjectExportResult> =>
    ipcRenderer.invoke("watchfaces:exportArchive", input),
  saveCorosWatchfaceAssetImage: (
    input: CorosWatchfaceAssetImageSaveInput
  ): Promise<CorosWatchfaceProjectExportResult> =>
    ipcRenderer.invoke("watchfaces:saveAssetImage", input),
  chooseCorosWatchfaceExportFolder: (): Promise<CorosWatchfaceExportFolder | null> =>
    ipcRenderer.invoke("watchfaces:chooseExportFolder"),
  exportCorosWatchfaceArchiveToFolder: (
    input: CorosWatchfaceArchiveFolderExportInput
  ): Promise<CorosWatchfaceProjectExportResult> =>
    ipcRenderer.invoke("watchfaces:exportArchiveToFolder", input),
  listCorosWatchfaceProjects: (
    options?: CorosWatchfaceProjectListOptions
  ): Promise<CorosWatchfaceProjectSummary[]> =>
    ipcRenderer.invoke("watchfaces:listProjects", options),
  loadCorosWatchfaceProjectPreview: (projectId: string): Promise<string | null> =>
    ipcRenderer.invoke("watchfaces:loadProjectPreview", projectId),
  saveCorosWatchfaceProject: (
    input: CorosWatchfaceProjectSaveInput
  ): Promise<CorosWatchfaceProject> =>
    ipcRenderer.invoke("watchfaces:saveProject", input),
  loadCorosWatchfaceProject: (
    projectId: string
  ): Promise<CorosWatchfaceProject> =>
    ipcRenderer.invoke("watchfaces:loadProject", projectId),
  cacheCorosWatchfaceProjectPreview: (
    projectId: string,
    previewDataUrl: string
  ): Promise<void> =>
    ipcRenderer.invoke("watchfaces:cacheProjectPreview", projectId, previewDataUrl),
  duplicateCorosWatchfaceProject: (
    projectId: string
  ): Promise<CorosWatchfaceProject> =>
    ipcRenderer.invoke("watchfaces:duplicateProject", projectId),
  deleteCorosWatchfaceProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("watchfaces:deleteProject", projectId),
  describeCorosWatchfaceTemplate: (
    archiveId: string
  ): Promise<CorosWatchfaceTemplateDetails> =>
    ipcRenderer.invoke("watchfaces:describeTemplate", archiveId),
  loadCorosWatchfaceTemplateAssets: (
    archiveId: string,
    paths: string[],
    options?: CorosWatchfaceTemplateAssetOptions
  ): Promise<CorosWatchfaceTemplateAsset[]> =>
    ipcRenderer.invoke("watchfaces:loadTemplateAssets", archiveId, paths, options),
  loadCorosWatchfaceTemplateConfigTexts: (
    archiveId: string
  ): Promise<CorosWatchfaceConfigTextFile[]> =>
    ipcRenderer.invoke("watchfaces:loadTemplateConfigTexts", archiveId),
  publishCorosWatchface: (
    input: CorosWatchfacePublishInput
  ): Promise<CorosWatchfaceShareLink> =>
    ipcRenderer.invoke("watchfaces:publish", input),
  createCorosWatchfaceShareLink: (
    input: CorosWatchfaceExistingShareInput
  ): Promise<CorosWatchfaceShareLink> =>
    ipcRenderer.invoke("watchfaces:createShareLink", input),
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
  onWatchTransferProgress: (
    callback: (progress: WatchTransferProgress) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: WatchTransferProgress
    ) => {
      callback(progress);
    };
    ipcRenderer.on("watch:transferProgress", listener);
    return () =>
      ipcRenderer.removeListener("watch:transferProgress", listener);
  },
  listAudiobooks: (): Promise<Audiobook[]> => ipcRenderer.invoke("audiobooks:list"),
  chooseAudiobookFiles: (): Promise<AudiobookDraft | null> =>
    ipcRenderer.invoke("audiobooks:chooseFiles"),
  convertAudiobookDraft: (draftId: string, split: AudiobookSplitOptions): Promise<Audiobook> =>
    ipcRenderer.invoke("audiobooks:convertDraft", draftId, split),
  discardAudiobookDraft: (draftId: string): Promise<void> =>
    ipcRenderer.invoke("audiobooks:discardDraft", draftId),
  cancelAudiobookConversion: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("audiobooks:cancel", id),
  deleteAudiobook: (id: string): Promise<Audiobook[]> =>
    ipcRenderer.invoke("audiobooks:delete", id),
  transferAudiobook: (id: string): Promise<AudiobookTransferResult> =>
    ipcRenderer.invoke("audiobooks:transfer", id),
  removeAudiobookFromWatch: (id: string): Promise<WatchStatus> =>
    ipcRenderer.invoke("audiobooks:removeFromWatch", id),
  listPopularFreeAudiobooks: (): Promise<FreeAudiobook[]> =>
    ipcRenderer.invoke("freeAudiobooks:popular"),
  searchFreeAudiobooks: (query: string): Promise<FreeAudiobook[]> =>
    ipcRenderer.invoke("freeAudiobooks:search", query),
  loadFreeAudiobook: (identifier: string): Promise<FreeAudiobookDetail> =>
    ipcRenderer.invoke("freeAudiobooks:load", identifier),
  importFreeAudiobook: (
    identifier: string,
    split: AudiobookSplitOptions
  ): Promise<Audiobook> =>
    ipcRenderer.invoke("audiobooks:importFree", identifier, split),
  onAudiobookProgress: (
    callback: (progress: AudiobookProgress) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: AudiobookProgress
    ) => {
      callback(progress);
    };
    ipcRenderer.on("audiobooks:progress", listener);
    return () => ipcRenderer.removeListener("audiobooks:progress", listener);
  },
  onAudiobookUpdated: (callback: (book: Audiobook) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, book: Audiobook) => {
      callback(book);
    };
    ipcRenderer.on("audiobooks:updated", listener);
    return () => ipcRenderer.removeListener("audiobooks:updated", listener);
  },
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
  downloadCombinedPlaylist: (
    id: string,
    name: string,
    items: DownloadQueueItem[]
  ): Promise<CombinedDownloadResult> =>
    ipcRenderer.invoke("music:downloadCombined", id, name, items),
  onCombinedDownloadProgress: (
    callback: (update: CombinedDownloadProgressEvent) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: CombinedDownloadProgressEvent
    ) => {
      callback(update);
    };
    ipcRenderer.on("music:combinedProgress", listener);
    return () =>
      ipcRenderer.removeListener("music:combinedProgress", listener);
  },
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
  searchApplePodcasts: (query: string): Promise<ApplePodcastShow[]> =>
    ipcRenderer.invoke("applePodcasts:search", query),
  loadApplePodcast: (
    showIdOrUrl: string,
    offset = 0
  ): Promise<ApplePodcastShowDetail> =>
    ipcRenderer.invoke("applePodcasts:load", showIdOrUrl, offset),
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
  unlockSpotifyFollowedPlaylists: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:unlockFollowed"),
  lockSpotifyFollowedPlaylists: (): Promise<SpotifyStatus> =>
    ipcRenderer.invoke("spotify:lockFollowed"),
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
  onTrainingHubSessionChange: (
    callback: (status: TrainingHubStatus) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: TrainingHubStatus
    ) => {
      callback(status);
    };
    ipcRenderer.on("trainingHub:sessionChange", listener);
    return () =>
      ipcRenderer.removeListener("trainingHub:sessionChange", listener);
  },
  loginTrainingHub: (
    email: string,
    password: string,
    remember: boolean
  ): Promise<TrainingHubLoginResult> =>
    ipcRenderer.invoke("trainingHub:login", email, password, remember),
  verifyTrainingHubTwoFactor: (code: string): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:verify2fa", code),
  resendTrainingHubTwoFactorCode: (): Promise<void> =>
    ipcRenderer.invoke("trainingHub:resend2fa"),
  cancelTrainingHubTwoFactor: (): Promise<void> =>
    ipcRenderer.invoke("trainingHub:cancel2fa"),
  logoutTrainingHub: (): Promise<TrainingHubStatus> =>
    ipcRenderer.invoke("trainingHub:logout"),
  reconnectTrainingHub: (): Promise<TrainingHubLoginResult> =>
    ipcRenderer.invoke("trainingHub:reconnect"),
  listTrainingHubActivities: (
    page: number,
    size: number,
    startDay?: string,
    endDay?: string
  ): Promise<TrainingHubActivity[]> =>
    ipcRenderer.invoke("trainingHub:listActivities", page, size, startDay, endDay),
  listScheduledWorkouts: (
    startDay: string,
    endDay: string
  ): Promise<TrainingHubScheduledWorkoutEntry[]> =>
    ipcRenderer.invoke("trainingHub:listScheduledWorkouts", startDay, endDay),
  listLibraryWorkouts: (): Promise<TrainingHubLibraryWorkout[]> =>
    ipcRenderer.invoke("trainingHub:listLibraryWorkouts"),
  duplicateLibraryWorkout: (
    programId: string,
    name: string,
    targetSportType?: number
  ): Promise<TrainingHubLibraryWorkout> =>
    ipcRenderer.invoke(
      "trainingHub:duplicateLibraryWorkout",
      programId,
      name,
      targetSportType
    ),
  getTrainingLibrarySnapshot: (): Promise<TrainingLibrarySnapshot> =>
    ipcRenderer.invoke("trainingLibrary:snapshot"),
  getNativeTrainingPlan: (remoteId: string): Promise<TrainingPlanDocument> =>
    ipcRenderer.invoke("trainingLibrary:getNativePlan", remoteId),
  saveLocalTrainingPlan: (plan: TrainingPlanDocument): Promise<TrainingPlanDocument> =>
    ipcRenderer.invoke("trainingLibrary:savePlan", plan),
  updateTrainingPlanMetadata: (
    id: string,
    patch: TrainingPlanMetadataPatch
  ): Promise<TrainingPlanDocument> =>
    ipcRenderer.invoke("trainingLibrary:updatePlanMetadata", id, patch),
  deleteLocalTrainingPlan: (id: string, confirmed: boolean): Promise<LocalTrainingPlanDeleteResult> =>
    ipcRenderer.invoke("trainingLibrary:deletePlan", id, confirmed),
  deleteCorosTrainingPlan: (
    remoteId: string,
    confirmed: boolean
  ): Promise<CorosTrainingPlanDeleteResult> =>
    ipcRenderer.invoke("trainingLibrary:deleteCorosPlan", remoteId, confirmed),
  previewTrainingPlanCalendar: (planId: string, startDate: string, fromDate?: string): Promise<TrainingPlanCalendarPreview> =>
    ipcRenderer.invoke("trainingLibrary:previewPlanCalendar", planId, startDate, fromDate),
  addTrainingPlanToCalendar: (
    previewId: string,
    confirmed: boolean,
    unitSystem: UnitSystem
  ): Promise<TrainingPlanCalendarMutationResult> =>
    ipcRenderer.invoke("trainingLibrary:addPlanToCalendar", previewId, confirmed, unitSystem),
  previewTrainingPlanCalendarRemoval: (planId: string): Promise<TrainingPlanCalendarPreview> =>
    ipcRenderer.invoke("trainingLibrary:previewPlanCalendarRemoval", planId),
  removeTrainingPlanFromCalendar: (previewId: string, confirmed: boolean): Promise<TrainingPlanCalendarMutationResult> =>
    ipcRenderer.invoke("trainingLibrary:removePlanFromCalendar", previewId, confirmed),
  updateWorkoutMetadata: (
    programIds: string[],
    patch: WorkoutMetadataPatch
  ): Promise<void> =>
    ipcRenderer.invoke("trainingLibrary:updateWorkoutMetadata", programIds, patch),
  saveTrainingCollection: (
    collection: Pick<TrainingCollection, "id" | "name"> &
      Partial<Pick<TrainingCollection, "description" | "color">>
  ): Promise<TrainingCollection> =>
    ipcRenderer.invoke("trainingLibrary:saveCollection", collection),
  deleteTrainingCollection: (id: string, confirmed: boolean): Promise<void> =>
    ipcRenderer.invoke("trainingLibrary:deleteCollection", id, confirmed),
  deleteTrainingLibraryWorkouts: (
    request: TrainingLibraryDeleteRequest
  ): Promise<string[]> =>
    ipcRenderer.invoke("trainingLibrary:deleteWorkouts", request),
  refreshTrainingActivityMatches: (
    startDay: string,
    endDay: string
  ): Promise<TrainingActivityMatch[]> =>
    ipcRenderer.invoke("trainingLibrary:refreshMatches", startDay, endDay),
  saveManualActivityMatch: (
    match: TrainingActivityMatch
  ): Promise<TrainingActivityMatch> =>
    ipcRenderer.invoke("trainingLibrary:saveManualMatch", match),
  listManualActivityLinks: (
    startDay: string,
    endDay: string
  ): Promise<ManualActivityLink[]> =>
    ipcRenderer.invoke("trainingLibrary:listManualLinks", startDay, endDay),
  saveManualActivityLink: (
    entry: Pick<TrainingHubScheduledWorkoutEntry, "planId" | "idInPlan" | "happenDay" | "trainingLoad">,
    activity?: Pick<TrainingHubActivity, "activityId" | "duration" | "distance" | "trainingLoad">
  ): Promise<ManualActivityLink> =>
    ipcRenderer.invoke("trainingLibrary:saveManualLink", entry, activity),
  clearManualActivityLink: (planId: string, idInPlan: string): Promise<void> =>
    ipcRenderer.invoke("trainingLibrary:clearManualLink", planId, idInPlan),
  listWorkoutExercises: (sport: WorkoutSport): Promise<WorkoutExerciseOption[]> =>
    ipcRenderer.invoke("trainingHub:listWorkoutExercises", sport),
  getWorkoutEditorContext: (unitSystem: UnitSystem): Promise<WorkoutEditorContext> =>
    ipcRenderer.invoke("trainingHub:getWorkoutEditorContext", unitSystem),
  getWorkoutForEdit: (
    ref: WorkoutEditRef,
    unitSystem: UnitSystem
  ): Promise<WorkoutEditorDocument> =>
    ipcRenderer.invoke("trainingHub:getWorkoutForEdit", ref, unitSystem),
  previewWorkoutEdit: (
    ref: WorkoutEditRef,
    revision: string,
    draft: RunWorkoutEditorDraft,
    unitSystem: UnitSystem
  ): Promise<WorkoutEditPreview> =>
    ipcRenderer.invoke("trainingHub:previewWorkoutEdit", ref, revision, draft, unitSystem),
  saveWorkoutEdit: (
    ref: WorkoutEditRef,
    revision: string,
    draft: RunWorkoutEditorDraft,
    unitSystem: UnitSystem
  ): Promise<WorkoutEditSaveResult> =>
    ipcRenderer.invoke("trainingHub:saveWorkoutEdit", ref, revision, draft, unitSystem),
  scheduleLibraryWorkout: (
    programId: string,
    happenDay: string
  ): Promise<void> =>
    ipcRenderer.invoke("trainingHub:scheduleLibraryWorkout", programId, happenDay),
  createAndScheduleWorkout: (
    entry: PlanWorkoutEntryInput,
    happenDay: string,
    unitSystem: UnitSystem,
    saveToLibrary?: boolean
  ): Promise<{ programId?: string }> =>
    ipcRenderer.invoke(
      "trainingHub:createAndScheduleWorkout",
      entry,
      happenDay,
      unitSystem,
      saveToLibrary
    ),
  createLibraryWorkout: (
    entry: PlanWorkoutEntryInput,
    unitSystem: UnitSystem
  ): Promise<{ programId?: string }> =>
    ipcRenderer.invoke("trainingHub:createLibraryWorkout", entry, unitSystem),
  rescheduleWorkout: (
    entry: {
      planId: string;
      idInPlan: string;
      planProgramId?: string;
      happenDay: string;
    },
    newHappenDay: string
  ): Promise<void> =>
    ipcRenderer.invoke("trainingHub:rescheduleWorkout", entry, newHappenDay),
  copyScheduledWorkout: (
    entry: { planId: string; idInPlan: string; happenDay: string; rawProgram?: Record<string, unknown> },
    newHappenDay: string
  ): Promise<void> =>
    ipcRenderer.invoke("trainingHub:copyScheduledWorkout", entry, newHappenDay),
  removeScheduledWorkout: (entry: {
    planId: string;
    idInPlan: string;
    planProgramId?: string;
    pbVersion?: number;
  }): Promise<void> =>
    ipcRenderer.invoke("trainingHub:removeScheduledWorkout", entry),
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
  renameTrainingHubActivity: (activityId: string, name: string, startTime?: number): Promise<string> =>
    ipcRenderer.invoke("trainingHub:renameActivity", activityId, name, startTime),
  onTrainingHubActivityRenamed: (
    callback: (renamed: { activityId: string; name: string }) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, renamed: { activityId: string; name: string }) => callback(renamed);
    ipcRenderer.on("trainingHub:activityRenamed", listener);
    return () => ipcRenderer.removeListener("trainingHub:activityRenamed", listener);
  },
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
  chooseActivityBackupFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("trainingHub:chooseBackupFolder"),
  startActivityBackup: (
    folder: string,
    fileType: TrainingHubActivityFileType = 4,
    filters?: ActivityBackupFilters
  ): Promise<ActivityBackupProgress> =>
    ipcRenderer.invoke(
      "trainingHub:startActivityBackup",
      folder,
      fileType,
      filters
    ),
  previewActivityBackup: (
    filters?: ActivityBackupFilters
  ): Promise<ActivityBackupPreview> =>
    ipcRenderer.invoke("trainingHub:previewActivityBackup", filters),
  cancelActivityBackup: (): Promise<ActivityBackupProgress | null> =>
    ipcRenderer.invoke("trainingHub:cancelActivityBackup"),
  getActivityBackupProgress: (): Promise<ActivityBackupProgress | null> =>
    ipcRenderer.invoke("trainingHub:getActivityBackupProgress"),
  onActivityBackupProgress: (
    callback: (progress: ActivityBackupProgress) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: ActivityBackupProgress
    ) => {
      callback(progress);
    };
    ipcRenderer.on("trainingHub:backupProgress", listener);
    return () =>
      ipcRenderer.removeListener("trainingHub:backupProgress", listener);
  },
  onScheduledWorkoutsChanged: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("trainingHub:scheduleChanged", listener);
    return () => ipcRenderer.removeListener("trainingHub:scheduleChanged", listener);
  },
  getTrainingAnalytics: (): Promise<TrainingHubAnalytics> =>
    ipcRenderer.invoke("trainingHub:getTrainingAnalytics"),
  getRacePredictor: (): Promise<TrainingHubRacePredictor> =>
    ipcRenderer.invoke("trainingHub:getRacePredictor"),
  getTrainingDashboard: (): Promise<TrainingHubDashboard> =>
    ipcRenderer.invoke("trainingHub:getDashboard"),
  getDailyMetrics: (dateList: string[]): Promise<TrainingHubDailyMetrics> =>
    ipcRenderer.invoke("trainingHub:getDailyMetrics", dateList),
  syncStrengthHistory: (request?: StrengthHistoryRequest): Promise<StrengthHistory> =>
    ipcRenderer.invoke("trainingHub:syncStrengthHistory", request),
  listExternalWorkouts: (startDay: string, endDay: string): Promise<StrengthSession[]> =>
    ipcRenderer.invoke("calendar:listExternalWorkouts", startDay, endDay),
  getHevyStatus: (): Promise<HevyStatus> => ipcRenderer.invoke("hevy:getStatus"),
  connectHevy: (apiKey: string): Promise<HevyStatus> =>
    ipcRenderer.invoke("hevy:connect", apiKey),
  updateHevySettings: (input: HevySettingsInput): Promise<HevyStatus> =>
    ipcRenderer.invoke("hevy:updateSettings", input),
  disconnectHevy: (): Promise<void> => ipcRenderer.invoke("hevy:disconnect"),
  getStravaStatus: (): Promise<StravaStatus> => ipcRenderer.invoke("strava:getStatus"),
  saveStravaConfig: (input: StravaConfigInput): Promise<StravaStatus> =>
    ipcRenderer.invoke("strava:saveConfig", input),
  connectStrava: (): Promise<StravaStatus> => ipcRenderer.invoke("strava:connect"),
  cancelStravaConnect: (): Promise<void> => ipcRenderer.invoke("strava:cancelConnect"),
  disconnectStrava: (): Promise<void> => ipcRenderer.invoke("strava:disconnect"),
  listWorkoutJournal: (startDay: string, endDay: string): Promise<WorkoutJournalEntry[]> =>
    ipcRenderer.invoke("workoutJournal:list", startDay, endDay),
  saveWorkoutJournal: (input: WorkoutJournalSaveInput): Promise<WorkoutJournalEntry | null> =>
    ipcRenderer.invoke("workoutJournal:save", input),
  onWorkoutJournalChanged: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("workoutJournal:changed", listener);
    return () => ipcRenderer.removeListener("workoutJournal:changed", listener);
  },
  listAthleteFacts: (): Promise<AthleteFact[]> => ipcRenderer.invoke("coachMemory:list"),
  saveAthleteFact: (input: { id?: string; category: AthleteFactCategory; text: string }): Promise<AthleteMemoryChange> =>
    ipcRenderer.invoke("coachMemory:save", input),
  deleteAthleteFact: (factId: string): Promise<AthleteFact[]> => ipcRenderer.invoke("coachMemory:delete", factId),
  clearAthleteMemory: (): Promise<AthleteFact[]> => ipcRenderer.invoke("coachMemory:clear"),
  onAthleteMemoryChanged: (callback: (facts: AthleteFact[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, facts: AthleteFact[]) => callback(facts);
    ipcRenderer.on("coachMemory:changed", listener);
    return () => ipcRenderer.removeListener("coachMemory:changed", listener);
  },
  getRaceOverview: (): Promise<RaceOverview> => ipcRenderer.invoke("races:getOverview"),
  listRaceActivityIds: (): Promise<string[]> => ipcRenderer.invoke("races:listActivityIds"),
  markActivityAsRace: (activity: TrainingHubActivity): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:markActivity", activity),
  unmarkActivityAsRace: (activityId: string): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:unmarkActivity", activityId),
  dismissRaceSuggestion: (activityId: string): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:dismissSuggestion", activityId),
  updateRace: (input: RaceEditInput): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:update", input),
  removeRace: (raceId: string): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:remove", raceId),
  addManualRace: (input: ManualRaceInput): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:addManual", input),
  removeRaceTarget: (targetId: string): Promise<RaceOverview> =>
    ipcRenderer.invoke("races:removeTarget", targetId),
  onRacesChanged: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("races:changed", listener);
    return () => ipcRenderer.removeListener("races:changed", listener);
  },
  importStravaRaces: (full?: boolean): Promise<StravaRaceImportResult> =>
    ipcRenderer.invoke("races:importStrava", full),
  startRpeBackfill: (): Promise<void> =>
    ipcRenderer.invoke("trainingHub:startRpeBackfill"),
  getRpeBackfillStatus: (): Promise<{ pending: number; running: boolean }> =>
    ipcRenderer.invoke("trainingHub:getRpeBackfillStatus"),
  getRpeLoadByDay: (): Promise<Record<string, number>> =>
    ipcRenderer.invoke("trainingHub:getRpeLoadByDay"),
  getSportTypeMap: (): Promise<TrainingHubSportType[]> =>
    ipcRenderer.invoke("trainingHub:getSportTypeMap"),
  getActivityPaceBaselines: (): Promise<ActivityPaceBaselines> =>
    ipcRenderer.invoke("trainingHub:getActivityPaceBaselines"),
  getUpcomingWorkouts: (
    days?: number
  ): Promise<TrainingHubUpcomingWorkout[]> =>
    ipcRenderer.invoke("trainingHub:getUpcomingWorkouts", days),
  getTrainingSleepData: (days?: number): Promise<TrainingHubSleepSummary> =>
    ipcRenderer.invoke("trainingHub:getSleepData", days),
  getTrainingHealthInsight: (kind: HealthInsightKind, days?: number): Promise<HealthInsightResult> =>
    ipcRenderer.invoke("trainingHub:getHealthInsight", kind, days),
  getTrainingDailyHealthData: (
    days?: number
  ): Promise<TrainingHubDailyHealthSummary> =>
    ipcRenderer.invoke("trainingHub:getDailyHealthData", days),
  uploadTrainingPlan: (
    draft: CorosTrainingPlanDraftInput,
    unitSystem: UnitSystem
  ): Promise<UploadPlanResult> =>
    ipcRenderer.invoke("trainingHub:uploadTrainingPlan", draft, unitSystem),
  getIntervalsStatus: (): Promise<IntervalsStatus> =>
    ipcRenderer.invoke("intervals:getStatus"),
  connectIntervals: (
    apiKey: string,
    athleteId: string
  ): Promise<IntervalsStatus> =>
    ipcRenderer.invoke("intervals:connect", apiKey, athleteId),
  disconnectIntervals: (): Promise<void> =>
    ipcRenderer.invoke("intervals:disconnect"),
  listMissingIntervalsActivities: (
    daysBack: number
  ): Promise<IntervalsActivityWithStatus[]> =>
    ipcRenderer.invoke("intervals:listMissing", daysBack),
  importIntervalsActivity: (
    intervalsId: string,
    fileExt: "fit" | "tcx" | "unknown"
  ): Promise<{ importId: string }> =>
    ipcRenderer.invoke("intervals:import", intervalsId, fileExt),
  addManualActivityToCoros: (
    input: ManualActivityInput
  ): Promise<{ importId: string }> =>
    ipcRenderer.invoke("coros:addManualActivity", input),
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
  getRouteBuilderConfig: (): Promise<RouteBuilderConfig> =>
    ipcRenderer.invoke("maps:getRouteBuilderConfig"),
  saveRouteBuilderConfig: (
    config: RouteBuilderConfig
  ): Promise<RouteBuilderConfig> =>
    ipcRenderer.invoke("maps:saveRouteBuilderConfig", config),
  listGeneratedRoutes: (offset?: number): Promise<GeneratedRoutePage> =>
    ipcRenderer.invoke("maps:listGeneratedRoutes", offset),
  getGeneratedRoute: (id: string): Promise<GeneratedRoute | null> =>
    ipcRenderer.invoke("maps:getGeneratedRoute", id),
  geocodeRouteLocation: (query: string): Promise<RouteGeocodeResult> =>
    ipcRenderer.invoke("maps:geocodeRouteLocation", query),
  searchRouteLocations: (query: string): Promise<RouteGeocodeResult[]> =>
    ipcRenderer.invoke("maps:searchRouteLocations", query),
  reverseGeocodeRouteLocation: (
    lat: number,
    lon: number
  ): Promise<RouteGeocodeResult> =>
    ipcRenderer.invoke("maps:reverseGeocodeRouteLocation", lat, lon),
  generateRoute: (request: GenerateRouteRequest): Promise<GeneratedRouteResult> =>
    ipcRenderer.invoke("maps:generateRoute", request),
  replaceGeneratedRouteGeometry: (
    id: string,
    geometry: RouteGeometry
  ): Promise<GeneratedRoute> =>
    ipcRenderer.invoke("maps:replaceGeneratedRouteGeometry", id, geometry),
  routeWaypoints: (request: RouteWaypointRequest): Promise<RouteGeometry> =>
    ipcRenderer.invoke("maps:routeWaypoints", request),
  saveDrawnRoute: (payload: DrawnRoutePayload): Promise<GeneratedRoute> =>
    ipcRenderer.invoke("maps:saveDrawnRoute", payload),
  importRouteGpx: (
    activityType?: RouteActivityType
  ): Promise<GpxImportSummary | null> =>
    ipcRenderer.invoke("maps:importRouteGpx", activityType),
  exportGeneratedRoute: (id: string): Promise<string | null> =>
    ipcRenderer.invoke("maps:exportGeneratedRoute", id),
  deleteGeneratedRoute: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("maps:deleteGeneratedRoute", id),
  deleteAllGeneratedRoutes: (): Promise<number> =>
    ipcRenderer.invoke("maps:deleteAllGeneratedRoutes"),
  startRouteShare: (id: string): Promise<RouteShareSession> =>
    ipcRenderer.invoke("maps:startRouteShare", id),
  stopRouteShare: (): Promise<void> =>
    ipcRenderer.invoke("maps:stopRouteShare"),
  validateRouteApiKey: (apiKey: string): Promise<RouteApiKeyValidation> =>
    ipcRenderer.invoke("maps:validateRouteApiKey", apiKey),
  getDiagnostics: (rangeHours?: number): Promise<DiagnosticsSnapshot> => ipcRenderer.invoke("diagnostics:get", rangeHours),
  copyDiagnostics: (rangeHours?: number): Promise<DiagnosticsSnapshot> => ipcRenderer.invoke("diagnostics:copy", rangeHours),
  clearDiagnostics: (): Promise<DiagnosticsSnapshot> => ipcRenderer.invoke("diagnostics:clear"),
  reportRendererError: (error: RendererDiagnosticError): void => ipcRenderer.send("diagnostics:rendererError", error),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:getInfo"),
  isOnboardingPending: (): Promise<boolean> =>
    ipcRenderer.invoke("app:isOnboardingPending"),
  completeOnboarding: (): Promise<void> =>
    ipcRenderer.invoke("app:completeOnboarding"),
  openAppStorageLocation: (id: string): Promise<void> =>
    ipcRenderer.invoke("app:openStorageLocation", id),
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
  getBaseCoachInstructions: (): Promise<string> =>
    ipcRenderer.invoke("chat:getBaseCoachInstructions"),
  saveChatSettings: (settings: ChatSettings): Promise<ChatSettings> =>
    ipcRenderer.invoke("chat:saveSettings", settings),
  testLocalChatConnection: (
    config?: LocalChatConfig
  ): Promise<LocalChatConnectionTest> =>
    ipcRenderer.invoke("chat:testLocalConnection", config),
  detectLocalChatServers: (apiKey?: string): Promise<LocalChatDiscovery> =>
    ipcRenderer.invoke("chat:detectLocalServers", apiKey),
  testOpenRouterConnection: (
    config?: OpenRouterConfig
  ): Promise<OpenRouterConnectionTest> =>
    ipcRenderer.invoke("chat:testOpenRouterConnection", config),
  openOpenRouterKeys: (): Promise<void> =>
    ipcRenderer.invoke("chat:openOpenRouterKeys"),
  openOpenRouterModels: (): Promise<void> =>
    ipcRenderer.invoke("chat:openOpenRouterModels"),
  listChatModels: (provider: ChatProvider): Promise<ChatModelOption[]> =>
    ipcRenderer.invoke("chat:listModels", provider),
  getClaudeCodeStatus: (): Promise<ClaudeCodeStatus> =>
    ipcRenderer.invoke("chat:getClaudeCodeStatus"),
  connectClaudeCode: (): Promise<ClaudeCodeStatus> =>
    ipcRenderer.invoke("chat:connectClaudeCode"),
  testClaudeCodeConnection: (): Promise<ClaudeCodeConnectionTest> =>
    ipcRenderer.invoke("chat:testClaudeCodeConnection"),
  openClaudeCodeSetupGuide: (): Promise<void> =>
    ipcRenderer.invoke("chat:openClaudeCodeSetupGuide"),
  getGeminiCliStatus: (): Promise<GeminiCliStatus> =>
    ipcRenderer.invoke("chat:getGeminiCliStatus"),
  recheckGeminiCli: (): Promise<GeminiCliStatus> =>
    ipcRenderer.invoke("chat:recheckGeminiCli"),
  connectGeminiCli: (): Promise<GeminiCliStatus> =>
    ipcRenderer.invoke("chat:connectGeminiCli"),
  testGeminiCliConnection: (): Promise<GeminiCliConnectionTest> =>
    ipcRenderer.invoke("chat:testGeminiCliConnection"),
  openGeminiCliSetupGuide: (topic: "install" | "sign-in"): Promise<void> =>
    ipcRenderer.invoke("chat:openGeminiCliSetupGuide", topic),
  getAntigravityStatus: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:getAntigravityStatus"),
  installAntigravity: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:installAntigravity"),
  removeAntigravity: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:removeAntigravity"),
  connectAntigravity: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:connectAntigravity"),
  disconnectAntigravity: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:disconnectAntigravity"),
  recheckAntigravity: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:recheckAntigravity"),
  cancelAntigravitySignIn: (): Promise<AntigravityStatus> =>
    ipcRenderer.invoke("chat:cancelAntigravitySignIn"),
  reopenAntigravitySignIn: (): Promise<void> =>
    ipcRenderer.invoke("chat:reopenAntigravitySignIn"),
  testAntigravityConnection: (): Promise<AntigravityConnectionTest> =>
    ipcRenderer.invoke("chat:testAntigravityConnection"),
  openAntigravityGuide: (): Promise<void> =>
    ipcRenderer.invoke("chat:openAntigravityGuide"),
  loginChat: (): Promise<ChatAuthStatus> => ipcRenderer.invoke("chat:login"),
  logoutChat: (): Promise<ChatAuthStatus> => ipcRenderer.invoke("chat:logout"),
  // Fire-and-forget: assistant text arrives via the onChat* subscriptions.
  sendChat: (
    requestId: string,
    messages: ChatMessage[],
    unitSystem: UnitSystem
  ): Promise<void> => ipcRenderer.invoke("chat:send", requestId, messages, unitSystem),
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
  listMcpServers: (): Promise<McpServerConfig[]> =>
    ipcRenderer.invoke("mcp:listServers"),
  addMcpServer: (input: McpServerInput): Promise<McpServerConfig> =>
    ipcRenderer.invoke("mcp:addServer", input),
  updateMcpServer: (
    id: string,
    patch: Partial<McpServerInput>
  ): Promise<McpServerConfig> =>
    ipcRenderer.invoke("mcp:updateServer", id, patch),
  removeMcpServer: (id: string): Promise<void> =>
    ipcRenderer.invoke("mcp:removeServer", id),
  connectMcpServer: (id: string): Promise<McpServerStatus> =>
    ipcRenderer.invoke("mcp:connect", id),
  getCorosMcpAccount: (): Promise<CorosMcpAccount> =>
    ipcRenderer.invoke("mcp:corosAccount"),
  disconnectMcpServer: (id: string): Promise<void> =>
    ipcRenderer.invoke("mcp:disconnect", id),
  getMcpStatuses: (): Promise<McpServerStatus[]> =>
    ipcRenderer.invoke("mcp:statuses"),
  onMcpConnectionChanged: (
    callback: (change: { id: string; connected: boolean; coros: boolean }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      change: { id: string; connected: boolean; coros: boolean }
    ) => callback(change);
    ipcRenderer.on("mcp:connectionChanged", listener);
    return () => ipcRenderer.removeListener("mcp:connectionChanged", listener);
  },
  setMcpBearer: (id: string, token: string): Promise<void> =>
    ipcRenderer.invoke("mcp:setBearer", id, token),
  uploadTrainingPlanDraft: (
    draftId: string,
    unitSystem: UnitSystem,
    destination?: TrainingPlanDestination,
    scheduleDate?: string
  ): Promise<UploadPlanResult> =>
    ipcRenderer.invoke(
      "chat:uploadPlanDraft",
      draftId,
      unitSystem,
      destination,
      scheduleDate
    ),
  confirmCorosAction: (requestId: string): Promise<CoachCorosActionPreview> =>
    ipcRenderer.invoke("chat:confirmCorosAction", requestId),
  confirmWorkoutDelete: (requestId: string): Promise<DeleteWorkoutResult> =>
    ipcRenderer.invoke("chat:confirmWorkoutDelete", requestId),
  // Coach hub: conversations live in the main process; the window is a client.
  coachListSessions: (provider?: ChatProvider): Promise<ChatSessionSummary[]> =>
    ipcRenderer.invoke("coach:listSessions", provider),
  coachGetSession: (sessionId: string): Promise<CoachSnapshot> =>
    ipcRenderer.invoke("coach:getSession", sessionId),
  coachCreateSession: (provider: ChatProvider): Promise<ChatSessionSummary> =>
    ipcRenderer.invoke("coach:createSession", provider),
  coachDeleteSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("coach:deleteSession", sessionId),
  coachDeleteAllSessions: (provider: ChatProvider): Promise<number> =>
    ipcRenderer.invoke("coach:deleteAllSessions", provider),
  coachSubscribe: (
    sessionId: string,
    afterSeq: number
  ): Promise<{ response: CoachSubscribeResult; replay: CoachEventFrame[] }> =>
    ipcRenderer.invoke("coach:subscribe", sessionId, afterSeq),
  coachUnsubscribe: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("coach:unsubscribe", sessionId),
  coachSend: (input: CoachSendInput & { uploads?: CoachFileUpload[] }): Promise<{ requestId: string }> =>
    ipcRenderer.invoke("coach:send", input),
  coachAttachmentPreview: (sessionId: string, attachmentId: string): Promise<string | null> =>
    ipcRenderer.invoke("coach:attachmentPreview", sessionId, attachmentId),
  coachOpenAttachment: (sessionId: string, attachmentId: string): Promise<void> =>
    ipcRenderer.invoke("coach:openAttachment", sessionId, attachmentId),
  coachCancel: (sessionId: string): Promise<{ cancelled: boolean }> =>
    ipcRenderer.invoke("coach:cancel", sessionId),
  coachConfirm: (input: CoachConfirmInput): Promise<CoachConfirmResult> =>
    ipcRenderer.invoke("coach:confirm", input),
  coachBeginLocalTurn: (
    sessionId: string,
    clientMessageId: string,
    text: string
  ): Promise<{ requestId: string }> =>
    ipcRenderer.invoke("coach:beginLocalTurn", sessionId, clientMessageId, text),
  coachFinishLocalTurn: (sessionId: string, requestId: string, reply: string): Promise<void> =>
    ipcRenderer.invoke("coach:finishLocalTurn", sessionId, requestId, reply),
  onCoachEvent: (callback: (frame: CoachEventFrame) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: CoachEventFrame) => callback(frame);
    ipcRenderer.on("coach:event", listener);
    return () => ipcRenderer.removeListener("coach:event", listener);
  },
  onChatSettingsChanged: (callback: (settings: ChatSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: ChatSettings) => callback(settings);
    ipcRenderer.on("chat:settingsChanged", listener);
    return () => ipcRenderer.removeListener("chat:settingsChanged", listener);
  },
  onCoachSessionsChanged: (callback: (change: CoachSessionsChange) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, change: CoachSessionsChange) => callback(change);
    ipcRenderer.on("coach:sessions", listener);
    return () => ipcRenderer.removeListener("coach:sessions", listener);
  },
  // Remote access: the environment server C-LINK pairs with.
  getRemoteAccessStatus: (): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:getStatus"),
  setRemoteNetworkAccess: (enabled: boolean): Promise<RemoteAccessStatus> =>
    ipcRenderer.invoke("remote:setNetworkAccess", enabled),
  setRemoteKeepAwake: (enabled: boolean): Promise<RemoteAccessStatus> =>
    ipcRenderer.invoke("remote:setKeepAwake", enabled),
  createRemotePairing: (input?: { viewOnly?: boolean }): Promise<RemotePairingCode> =>
    ipcRenderer.invoke("remote:createPairing", input),
  cancelRemotePairing: (id?: string): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:cancelPairing", id),
  revokeRemoteDevice: (id: string): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:revokeDevice", id),
  cloudSignIn: (): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:cloudSignIn"),
  cloudCancelSignIn: (): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:cloudCancelSignIn"),
  cloudSignOut: (): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:cloudSignOut"),
  setCloudLink: (input: { enabled: boolean; allowDownload?: boolean }): Promise<RemoteAccessStatus> =>
    ipcRenderer.invoke("remote:setCloudLink", input),
  cloudUnlink: (): Promise<RemoteAccessStatus> => ipcRenderer.invoke("remote:cloudUnlink"),
  onRemoteAccessStatus: (callback: (status: RemoteAccessStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: RemoteAccessStatus) => callback(status);
    ipcRenderer.on("remote:status", listener);
    return () => ipcRenderer.removeListener("remote:status", listener);
  },
  getFitIndexStatus: (): Promise<FitIndexStatus> =>
    ipcRenderer.invoke("fitIndex:getStatus"),
  startFitIndexSync: (options?: FitIndexSyncOptions): Promise<FitIndexProgress> =>
    ipcRenderer.invoke("fitIndex:startSync", options),
  cancelFitIndexSync: (): Promise<FitIndexProgress | null> =>
    ipcRenderer.invoke("fitIndex:cancelSync"),
  onFitIndexProgress: (
    callback: (progress: FitIndexProgress) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: FitIndexProgress
    ) => {
      callback(progress);
    };
    ipcRenderer.on("fitIndex:progress", listener);
    return () => ipcRenderer.removeListener("fitIndex:progress", listener);
  },
  listPinnedCoachCharts: (): Promise<PinnedCoachChart[]> =>
    ipcRenderer.invoke("coachCharts:list"),
  pinCoachChart: (preview: CoachChartPreview): Promise<PinCoachChartResult> =>
    ipcRenderer.invoke("coachCharts:pin", preview),
  unpinCoachChart: (id: string): Promise<void> =>
    ipcRenderer.invoke("coachCharts:unpin", id),
  refreshPinnedCoachChart: (id: string): Promise<PinnedCoachChart | null> =>
    ipcRenderer.invoke("coachCharts:refresh", id),
  setWindowBackground: (color: string): Promise<void> =>
    ipcRenderer.invoke("window:setBackground", color),
  isWindowFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke("window:isFullscreen"),
  onWindowFullscreenChange: (
    callback: (fullscreen: boolean) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean) =>
      callback(fullscreen);
    ipcRenderer.on("window:fullscreenChanged", listener);
    return () => ipcRenderer.removeListener("window:fullscreenChanged", listener);
  },
  getDataModeStatus: (): Promise<DataModeStatus> => ipcRenderer.invoke("dataMode:getStatus"),
  activateLocalOnlyMode: (options: LocalOnlyActivationOptions): Promise<DataModeStatus> =>
    ipcRenderer.invoke("dataMode:activateLocalOnly", options),
  returnToConnectedMode: (): Promise<DataModeStatus> => ipcRenderer.invoke("dataMode:returnToConnected"),
  getNetworkAccessReport: (): Promise<NetworkAccessReport> => ipcRenderer.invoke("dataMode:getNetworkReport"),
  clearNetworkAccessReport: (): Promise<NetworkAccessReport> => ipcRenderer.invoke("dataMode:clearNetworkReport"),
  onDataModeChange: (callback: (status: DataModeStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: DataModeStatus) => callback(status);
    ipcRenderer.on("dataMode:changed", listener);
    return () => ipcRenderer.removeListener("dataMode:changed", listener);
  },
  getLocalDataOverview: (): Promise<LocalDataOverview> => ipcRenderer.invoke("localData:getOverview"),
  importLocalFitFiles: (folder?: boolean): Promise<LocalImportResult> => ipcRenderer.invoke("localData:importFitFiles", folder === true),
  syncWatchLocally: (): Promise<WatchSyncProgress> => ipcRenderer.invoke("localData:syncWatch"),
  getWatchSyncProgress: (): Promise<WatchSyncProgress> => ipcRenderer.invoke("localData:getSyncProgress"),
  cancelWatchSync: (): Promise<WatchSyncProgress> => ipcRenderer.invoke("localData:cancelSync"),
  allowWatchPlanReplacement: (): Promise<void> => ipcRenderer.invoke("localData:allowWatchPlanReplacement"),
  getWatchPlanReplacement: (): Promise<boolean> => ipcRenderer.invoke("localData:getWatchPlanReplacement"),
  setWatchPlanReplacement: (allowed: boolean): Promise<boolean> => ipcRenderer.invoke("localData:setWatchPlanReplacement", allowed),
  readWatchDayTotals: (): Promise<unknown> => ipcRenderer.invoke("localData:readDayTotals"),
  /** Developer test (COROSLINK_SYNC_CAPTURE=1): send satellite data to the watch now. */
  sendSatelliteDataNow: (): Promise<NonNullable<WatchSyncProgress["satellite"]>> => ipcRenderer.invoke("localData:sendSatelliteDataNow"),
  probeWatchSync: (options?: { allBlocks?: boolean; selector?: number; fileIndex?: number }): Promise<WatchSyncProbe> => ipcRenderer.invoke("localData:probeWatchSync", options),
  getWatchAutoSync: (): Promise<import("./watchAutoSyncService").WatchAutoSyncState> => ipcRenderer.invoke("watch:getAutoSync"),
  setWatchAutoSync: (input: { enabled?: boolean; intervalHours?: number }): Promise<import("./watchAutoSyncService").WatchAutoSyncState> =>
    ipcRenderer.invoke("watch:setAutoSync", input),
  onWatchAutoSyncChange: (callback: (state: import("./watchAutoSyncService").WatchAutoSyncState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: import("./watchAutoSyncService").WatchAutoSyncState) => callback(state);
    ipcRenderer.on("watch:autoSyncChanged", listener);
    return () => ipcRenderer.removeListener("watch:autoSyncChanged", listener);
  },
  onWatchSyncProgress: (callback: (progress: WatchSyncProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: WatchSyncProgress) => callback(progress);
    ipcRenderer.on("localData:syncProgress", listener);
    return () => ipcRenderer.removeListener("localData:syncProgress", listener);
  },
  exportLocalBackup: (passphrase?: string): Promise<LocalBackupResult> =>
    ipcRenderer.invoke("localData:exportBackup", { passphrase }),
  chooseLocalBackup: (): Promise<{ chosen: boolean; encrypted?: boolean }> => ipcRenderer.invoke("localData:chooseBackup"),
  restoreLocalBackup: (passphrase?: string): Promise<LocalRestoreResult> =>
    ipcRenderer.invoke("localData:restoreBackup", { passphrase })
};

contextBridge.exposeInMainWorld("corosLink", api);

export type CorosLinkApi = typeof api;
