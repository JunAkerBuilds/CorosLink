// Must stay the first import: reads the persisted data mode and installs the
// network guards before any other module can open a connection.
import { networkPolicy } from "./privacy/bootstrap";
import { getWatchSettings, storeWatchSwitches, updateWatchSettings } from "./watchSettingsService";
import { chooseWeatherLocation, getWeatherLocation, searchWeatherPlaces, setWatchWeatherLocation, watchWeatherFile } from "./watchWeatherService";
import { getWatchProfile, storeWatchProfile, updateWatchProfile } from "./watchProfileService";
import { confineMainWindow, requireMainWindowSender } from "./mainWindowGuard";
import { LocalOnlyFeatureError } from "./privacy/remoteFeatures";
import { registerLocalOnlyMode } from "./privacy/localOnlyMain";
import { currentActivitySource, currentHealthSource, usingLocalSources } from "./localSync/activitySource";
import type { LocalDataService } from "./localSync/localDataService";
import { getCalendarWorkoutEvent, updateCalendarWorkoutEvent, syncEditedCalendarWorkout } from "./calendarWorkoutEventService";
import { initializeNativeLanguage, localizeDialogOptions, nativeText, setNativeLanguage } from "./localization";
import { listCalendarWorkoutEntries } from "./calendarWorkoutEventStorage";
import type { CalendarEventTiming, CalendarWorkoutEventRef } from "./calendarSyncTypes";
import { registerWorkoutAutomation } from "./workoutAutomation";
import { listWorkoutJournal, onWorkoutJournalChanged, rescheduleWorkoutWithNotes, saveWorkoutJournal } from "./workoutJournalService";
import type { WorkoutJournalSaveInput } from "./workoutJournalTypes";
import { onCoachActivityRenamed } from "./chatActivityTools";
import { app, BrowserWindow, dialog, nativeTheme, session, shell, ShareMenu } from "electron";
import { diagnosticIpcMain as ipcMain, initializeDiagnostics, observeDiagnosticWindow, recordDiagnosticNotice, registerDiagnosticStatus } from "./diagnosticsService";
import { corosAccountDiagnostics } from "./corosAccountDiagnostics";
import { googleCalendar, startGoogleCalendarSync, stopGoogleCalendarSync } from "./googleCalendarService";
import type { GoogleCalendarConfigInput } from "./googleCalendarTypes";
import { appleCalendar, startAppleCalendarSync, stopAppleCalendarSync } from "./appleCalendarService";
import type { AppleCalendarCredentials, CalendarSyncSettings } from "./calendarSyncTypes";
import type { OpenDialogOptions } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLocalFontFamilies } from "./fontService";
import { corosNativeBle } from "./corosNativeBleService";
import { registerCorosActivityScreenIpc } from "./corosActivityScreenIpc";
import { registerCorosWatchKeyBackupIpc } from "./corosWatchKeyBackupIpc";
import { resolveWifiMusicLibraryFiles } from "./corosWifiMusicLibrary";
import { getCorosWatchfaceCompiler } from "./corosWatchfaceCompiler";
import { getWatchfaceTarget } from "./watchfaceTargets";
import { isWebUrl } from "./externalLinks";
import { pathToFileURL } from "node:url";
import { registerWatchfaceAutomation } from "./watchfaceAutomation";
import { onWatchfaceRendererNavigation } from "./watchfaceRendererLifecycle";
import {
  clearDownloadTransferredByFileName,
  deleteDownload,
  getDownloadById,
  hasAvailableDownloadForUrl,
  getSetting,
  initializeDatabase,
  listDownloads,
  markDownloadTransferred,
  setSetting
} from "./database";
import {
  CoachSessionHub,
  createChatHistorySessionStore,
  createSqliteCoachEventStore,
  type CoachConfirmInput,
  type CoachSendInput
} from "./coachHub";
import { workoutEdits } from "./workoutEditRuntime";
import {
  CoachAttachmentError,
  MAX_COACH_UPLOADS_PER_MESSAGE,
  createCoachAttachmentStore,
  expandCoachAttachments,
  type CoachAttachmentStore
} from "./coachAttachments";
import type { ChatFileAttachment, CoachFileUpload } from "./types";
import { RemoteAccess } from "./remote/remoteAccess";
import { isAuthCallbackUrl } from "./remote/cloud/websiteAccount";
import { completeOnboarding, isOnboardingPending } from "./onboardingState";
import {
  downloadAudio,
  downloadCombinedTrack,
  getBinaryStatus
} from "./downloadService";
import {
  cancelJob,
  clearCompletedJobs,
  clearJob,
  clearTerminalJobsForUrl,
  enqueueDownloads,
  listJobs,
  setJobListener
} from "./downloadQueue";
import {
  getSpotifyConfig,
  getSpotifyStatus,
  listSpotifyPlaylists,
  listSpotifyPlaylistTracks,
  listSpotifySyncState,
  lockSpotifyFollowedPlaylists,
  loginSpotify,
  logoutSpotify,
  saveSpotifyConfig,
  syncSpotifyPlaylist,
  unlockSpotifyFollowedPlaylists
} from "./spotifyService";
import {
  cancelActivityBackup,
  clearActivityBackupPreview,
  getActivityBackupProgress,
  previewActivityBackup,
  setActivityBackupProgressListener,
  startActivityBackup
} from "./activityBackupService";
import { normalizeActivityBackupFilters } from "./activityBackupFilters";
import { getAppInfo, openAppStorageLocation } from "./appInfoService";
import {
  backfillFeelTypes,
  getActivityPaceBaselines,
  getRacePredictor,
  getRpeBackfillStatus,
  getRpeLoadByDay,
  getSportTypeMap,
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubStatus,
  checkTrainingHubSession,
  onTrainingHubSessionChange,
  getUpcomingWorkouts,
  listTrainingHubActivities,
  listLibraryWorkouts,
  duplicateLibraryWorkout,
  listWorkoutExercises,
  getWorkoutEditorContext,
  scheduleLibraryWorkout,
  createAndScheduleWorkout,
  createLibraryWorkout,
  copyScheduledWorkout,
  removeScheduledWorkout,
  getWorkoutForEdit,
  previewWorkoutEdit,
  saveWorkoutEdit,
  getWorkoutProgramDetail,
  loginTrainingHub,
  verifyTrainingHubTwoFactor,
  resendTrainingHubTwoFactorCode,
  cancelTrainingHubTwoFactor,
  logoutTrainingHub,
  reconnectTrainingHub,
  setScheduledWorkoutsChangedListener,
  uploadActivityFitToCoros,
  uploadTrainingPlan
} from "./trainingHubService";
import { syncStrengthHistory } from "./strengthHistoryService";
import {
  connectHevy,
  disconnectHevy,
  getHevyStatus,
  updateHevySettings
} from "./hevyService";
import {
  cancelStravaConnect,
  connectStrava,
  disconnectStrava,
  getStravaStatus,
  saveStravaConfig
} from "./stravaService";
import {
  addManualRace,
  clearStravaRaceData,
  dismissRaceSuggestion,
  getRaceOverview,
  importStravaRaces,
  listRaceActivityIds,
  markActivityAsRace,
  removeRace,
  unmarkActivityAsRace,
  updateRace
} from "./raceService";
import type { ManualRaceInput, RaceEditInput } from "./raceTypes";
import type {
  HevySettingsInput,
  StravaConfigInput,
  StrengthHistoryRequest,
  UnitSystem,
  WorkoutSport
} from "./types";
import {
  addTrainingPlanToCalendar,
  deleteCorosTrainingPlan,
  deleteLocalTrainingPlanAndCalendar,
  deleteTrainingLibraryWorkouts,
  getNativeTrainingPlan,
  getTrainingLibrarySnapshot,
  refreshTrainingActivityMatches,
  previewTrainingPlanCalendar,
  previewTrainingPlanCalendarRemoval,
  removeTrainingPlanFromCalendar,
  removeTrainingCollection,
  saveLocalTrainingPlan,
  saveManualActivityMatch,
  listManualActivityLinks,
  saveManualActivityLink,
  clearManualActivityLink,
  updateWorkoutMetadata,
  updateTrainingPlanMetadata,
  upsertTrainingCollection
} from "./trainingLibraryService";
import { normalizeUnitSystem } from "./unitSystem.js";
import {
  cacheCorosWatchfaceProjectPreview,
  createCorosWatchfaceArchive,
  convertCorosWatchfaceArchive,
  createCorosWatchfaceShareLink,
  duplicateCorosWatchfaceProject,
  describeCorosWatchfaceTemplate,
  downloadCorosWatchfaceTheme,
  exportCorosWatchfaceProject,
  exportCorosWatchfaceArchive,
  forgetCorosWatchKey,
  createCorosWatchKeyBackup,
  openCorosWatchKeyBackup,
  saveRestoredCorosWatchKey,
  getCorosBatteryReport,
  getCorosWatchfaceStatus,
  importCorosWatchfaceShareLink,
  listCorosPairedDevices,
  listCorosWatchfaceThemes,
  readCachedCorosWatchfaceThemes,
  loadCorosWatchfaceArtwork,
  loadCorosWatchfaceTemplateAssets,
  loadCorosWatchfaceTemplateConfigTexts,
  loadCorosWatchfaceProject,
  loginCorosWatchfaces,
  loginCorosWatchfacesWithSavedCredentials,
  logoutCorosWatchfaces,
  listCorosWatchfaceProjects,
  loadCorosWatchfaceProjectPreview,
  publishCorosWatchface,
  queryCorosGear,
  saveCorosGear,
  saveCorosWatchfaceProject,
  deleteCorosWatchfaceProject,
  selectCorosWatchfaceArchive
} from "./corosWatchfaceService";
import {
  ensureCorosOfficialAssetLibrary,
  getCorosOfficialAssetLibraryStatus,
  listCorosOfficialAssets,
  readCorosOfficialAssetFrames
} from "./corosOfficialAssetService";
import {
  cleanupCommunityWatchfaceImports,
  getCommunityWatchface,
  importCommunityWatchface,
  setCommunityWatchfaceAccountToken,
  listCommunityWatchfaces,
  parseCommunityWatchfaceDeepLink,
  setCommunityWatchfaceProgressListener
} from "./communityWatchfaceService";
import {
  getIntervalsStatus,
  connectIntervals,
  disconnectIntervals,
  listIntervalsActivities,
  downloadIntervalsFit,
  recordIntervalsImport,
  getRecentlyImportedIds,
  RECENT_IMPORT_WINDOW_MS
} from "./intervalsService";
import { isAlreadyOnCoros } from "./intervalsMatch";
import { buildManualTcx } from "./tcxBuilder";
import {
  cancelCorosMapDownload,
  cancelCorosMapInstall,
  clearCorosMapDownloadJob,
  deleteAllGeneratedRoutes,
  deleteCachedCorosMap,
  deleteGeneratedRoute,
  downloadCorosMapPackage,
  exportGeneratedRoute,
  generateRoute,
  replaceGeneratedRouteGeometry,
  geocodeRouteLocation,
  reverseGeocodeRouteLocation,
  getCorosMapInstallProgress,
  getCorosMapManifest,
  getRouteBuilderConfig,
  importRouteFromGpx,
  installCachedCorosMap,
  installCachedCorosMaps,
  listCachedCorosMaps,
  listCorosMapDownloadJobs,
  listGeneratedRoutes,
  getGeneratedRouteDetails,
  openCorosMapDownload,
  routeWaypoints,
  saveDrawnRoute,
  saveRouteBuilderConfig,
  searchRouteLocations,
  setCorosMapDownloadListener,
  setCorosMapInstallProgressListener,
  toCorosMapInstallIpcError,
  validateRouteApiKey
} from "./mapService";
import { startRouteShare, stopRouteShare } from "./routeShareServer";
import { startWatchfacePhoneSend, stopWatchfacePhoneSend } from "./watchfacePhoneSend";
import type {
  CombinedDownloadResult,
  CorosMapPackage,
  DownloadJob,
  DownloadQueueItem,
  DrawnRoutePayload,
  GenerateRouteRequest,
  RouteActivityType,
  RouteBuilderConfig,
  RouteGeometry,
  RouteWaypointRequest,
  SpotifyConfig,
  TrainingHubActivity,
  TrainingHubActivityFileType,
  TrainingHubExportResult,
  WatchConnectionSmokeOptionId,
  YouTubeMusicConfig,
  IntervalsActivityWithStatus,
  ManualActivityInput
} from "./types";
import type {
  CorosWatchfaceCreatorInput,
  CorosWatchfaceConversionInput,
  CorosWatchfaceExistingShareInput,
  CorosWatchfaceProjectExportInput,
  CorosWatchfaceArchiveExportInput,
  CorosWatchfaceAssetImageSaveInput,
  CorosWatchfaceArchiveFolderExportInput,
  CorosWatchfacePublishInput,
  CorosWatchfaceRasterFontFolder,
  CorosWatchfaceRegion,
  CorosWatchfaceTemplateAssetOptions,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceProjectListOptions,
  CorosWatchfaceThemeListInput,
  CorosOfficialAssetQuery,
  CorosBatteryQueryInput,
  CorosGearSaveInput,
  CorosBluetoothDeviceChoice,
  WatchTransferProgress
} from "./types";
import type { CommunityWatchfaceOpenRequest } from "./types";
import type { CoachChartPreview, FitIndexSyncOptions } from "./types";
import {
  deleteWatchTrack,
  getWatchConnectionSmokeOption,
  getWatchStatus,
  setWatchConnectionSmokeOption,
  transferFileToWatch
} from "./watchService";
import {
  AUDIOBOOK_EXTENSIONS,
  audiobookPartsOnWatch,
  cancelAudiobookConversion,
  deleteAudiobook,
  discardAudiobookDraft,
  getAudiobook,
  getAudiobookPartPaths,
  listAudiobooks,
  findAudiobookBySource,
  normalizeSplitOptions,
  prepareAudiobookDraft,
  startAudiobookImportFromDraft,
  startFreeAudiobookImport
} from "./audiobookService";
import {
  listPopularFreeAudiobooks,
  loadFreeAudiobook,
  searchFreeAudiobooks
} from "./freeAudiobooksService";
import type {
  Audiobook,
  AudiobookDraft,
  AudiobookProgress,
  AudiobookSplitOptions,
  AudiobookTransferResult
} from "./types";
import {
  configureYouTubeBrowserSession,
  registerYouTubeBrowserHandlers,
  resetYouTubeBrowserSession
} from "./youtubeBrowserService";
import {
  configureYouTubeMusicBrowserSession,
  registerYouTubeMusicBrowserHandlers,
  resetYouTubeMusicBrowserSession
} from "./youtubeMusicBrowserService";
import {
  downloadFromYouTubeBrowser,
  downloadMultipleFromYouTubeBrowser,
  getYouTubeHistory,
  saveYouTubeVisit
} from "./youtubeService";
import {
  logoutYouTubeMusic,
  getYouTubeMusicConfig,
  getYouTubeMusicStatus,
  loginYouTubeMusic,
  listYouTubeMusicLibrary,
  saveYouTubeMusicConfig,
  saveYouTubeMusicAuth,
  syncYouTubeMusicLibrary
} from "./youtubeMusicService";
import {
  fetchAppleMusicPlaylist,
  getAppleMusicStatus,
  listAppleMusicPlaylists,
  logoutAppleMusic,
  saveAppleMusicAuth,
  saveAppleMusicCapturedHeaders
} from "./appleMusicService";
import {
  configureAppleMusicBrowserSession,
  registerAppleMusicBrowserHandlers,
  resetAppleMusicBrowserSession
} from "./appleMusicBrowserService";
import {
  loadApplePodcast,
  searchApplePodcasts
} from "./applePodcastsService";
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getAppUpdateSnapshot,
  initializeAppUpdater,
  quitAndInstallUpdate,
  setUpdaterPreferences
} from "./updaterService";
import {
  cancelChat,
  createChatSessionForProvider,
  deleteChatSessionById,
  detectLocalChatServers,
  connectClaudeCode,
  connectGeminiCli,
  connectAntigravity,
  disconnectAntigravity,
  getAntigravityConnectionStatus,
  installAntigravity,
  removeAntigravity,
  testAntigravity,
  getClaudeCodeConnectionStatus,
  getGeminiCliConnectionStatus,
  recheckGeminiCliConnectionStatus,
  getChatAuthStatus,
  getChatSessionEntries,
  getChatSettings,
  getChatSettingsForWindow,
  listChatModelOptions,
  listChatSessionsForProvider,
  loginChat,
  logoutChat,
  saveChatSessionEntries,
  saveChatSettings,
  generateCoachSessionTitle,
  streamChat,
  testClaudeCodeConnection,
  testGeminiCliConnection,
  testLocalChatConnection,
  testOpenRouterConnection,
  uploadTrainingPlanDraft,
  confirmWorkoutDelete,
  confirmCoachCorosAction,
  type ChatStreamSink
} from "./chatService";
import {
  listPinnedCoachCharts,
  pinCoachChart,
  refreshPinnedCoachChart,
  unpinCoachChart
} from "./coachChartService";
import {
  cancelFitIndexSync,
  getFitIndexStatus,
  setFitIndexProgressListener,
  startFitIndexSync
} from "./fitIndexService";
import { buildBaseCoachInstructions } from "./chatCoachContext";
import {
  OPENROUTER_KEYS_URL,
  OPENROUTER_MODELS_URL
} from "./openRouterProvider";
import {
  hydratePlanDraftStoreFromDatabase,
  pruneDeleteRequestStore,
  prunePlanDraftStore
} from "./chatWorkoutTools";
import { getCorosMcpAccount } from "./corosMcpAccount";
import {
  connectCorosMcp,
  connectMcpServerWithCorosAccount,
  disconnectCorosMcp,
  getCorosMcpStatus,
  listCorosMcpTools,
  setCorosMcpAccountSource
} from "./corosMcpService";
import {
  corosMcpServerId,
  disconnectMcpServer,
  ensureAllMcpConnected,
  getMcpStatuses,
  onMcpConnectionChanged
} from "./mcpClientManager";
import {
  addMcpServer,
  getMcpServer,
  listMcpServers,
  removeMcpServer,
  setMcpBearer,
  updateMcpServer
} from "./mcpServersStore";
import type { HealthInsightKind } from "./healthInsightsTypes";
import type {
  ChatMessage,
  ChatProvider,
  ChatSettings,
  CorosTrainingPlanDraftInput,
  LocalChatConfig,
  OpenRouterConfig,
  PersistedChatEntry,
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  WorkoutEditRef
} from "./types";

let mainWindow: BrowserWindow | undefined;
let workoutAutomation: ReturnType<typeof registerWorkoutAutomation> | undefined;
// Owns every Coach conversation; the window (and later phones) are its clients.
let coachHub: CoachSessionHub | undefined;

function requireCoachHub(): CoachSessionHub {
  if (!coachHub) throw new Error("Coach is still starting. Try again in a moment.");
  return coachHub;
}

// The environment server phones (C-LINK) drive the Coach hub through.
let remoteAccess: RemoteAccess | undefined;
// Activities and health data held on this computer (watch sync, FIT imports, backups).
let localData: LocalDataService | undefined;

function requireRemoteAccess(): RemoteAccess {
  if (!remoteAccess) throw new Error("Remote access is still starting. Try again in a moment.");
  return remoteAccess;
}

// Files attached to Coach messages, one folder per conversation.
let coachAttachmentStore: CoachAttachmentStore | undefined;

function coachAttachments(): CoachAttachmentStore {
  coachAttachmentStore ??= createCoachAttachmentStore(
    path.join(app.getPath("userData"), "coach-attachments")
  );
  return coachAttachmentStore;
}

function createCoachHub(): CoachSessionHub {
  return new CoachSessionHub({
    // getChatSessionEntries also reconciles COROS review cards with their saves.
    sessions: createChatHistorySessionStore(undefined, { load: getChatSessionEntries }),
    events: createSqliteCoachEventStore(),
    stream: {
      start: async (sink, requestId, messages, unitSystem, provider, sessionId) => {
        const withFiles = await expandCoachAttachments(messages, (file) =>
          coachAttachments().load(sessionId, file.id)
        );
        return streamChat(sink, requestId, withFiles, unitSystem, { provider });
      },
      cancel: cancelChat
    },
    attachments: { removeSession: (sessionId) => coachAttachments().removeSession(sessionId) },
    actions: {
      confirmCorosAction: confirmCoachCorosAction,
      confirmWorkoutDelete,
      uploadPlanDraft: uploadTrainingPlanDraft,
      strengthEditStatus: (proposalId) => workoutEdits().status(proposalId),
      confirmStrengthEdit: (proposalId, reviewHash, selectedIds) =>
        workoutEdits().confirm(proposalId, reviewHash, selectedIds),
      cancelStrengthEdit: async (proposalId) => {
        await workoutEdits().tool("cancel_workout_edit", { proposalId }, "coach");
        return workoutEdits().status(proposalId);
      }
    },
    settings: getChatSettings,
    titler: generateCoachSessionTitle,
    unitSystem: {
      get: () => {
        const saved = getSetting("coach.unitSystem");
        return saved ? normalizeUnitSystem(saved) : undefined;
      },
      set: (value) => setSetting("coach.unitSystem", value)
    }
  });
}

/** `chat:send` streams (the Training Library generator) go to the window that asked. */
function windowChatSink(window: BrowserWindow | undefined): ChatStreamSink {
  return {
    send: (channel, payload) => {
      if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
    }
  };
}
let watchfaceAutomation: ReturnType<typeof registerWatchfaceAutomation> | undefined;
let rendererReady = false;
let pendingCommunityWatchfaceOpen: CommunityWatchfaceOpenRequest | undefined;
let pendingCorosBluetoothSelection:
  | {
      callback: (deviceId: string) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  | undefined;

const MAX_RASTER_FONT_SPRITE_FOLDER_BYTES = 12 * 1024 * 1024;
const MAX_SAVED_ASSET_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Matches --bg-base in styles.css; updated when the renderer theme changes. */
const DEFAULT_WINDOW_BACKGROUND = "#111315";
let currentWindowBackground = DEFAULT_WINDOW_BACKGROUND;

const TRAFFIC_LIGHT_WINDOWED = { x: 18, y: 18 };
const TRAFFIC_LIGHT_FULLSCREEN = { x: 16, y: 12 };

function applyWindowBackground(color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return;
  }

  currentWindowBackground = color;
  if (process.platform === "darwin") {
    // Match the native sidebar material to the app's selected theme.
    nativeTheme.themeSource = color === DEFAULT_WINDOW_BACKGROUND ? "dark" : "light";
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Fullscreen vibrancy can pick up the desktop tint across the exposed shell.
    // Keep native glass in windowed mode and use the theme color in fullscreen.
    const useNativeGlass = process.platform === "darwin" && !mainWindow.isFullScreen();
    if (process.platform === "darwin") {
      mainWindow.setVibrancy(useNativeGlass ? "sidebar" : null);
    }
    mainWindow.setBackgroundColor(useNativeGlass ? "#00000000" : color);
  }
}

function syncTrafficLightPosition(fullscreen: boolean): void {
  if (process.platform !== "darwin" || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setWindowButtonPosition(
    fullscreen ? TRAFFIC_LIGHT_FULLSCREEN : TRAFFIC_LIGHT_WINDOWED
  );
}

function notifyWindowFullscreen(fullscreen: boolean): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("window:fullscreenChanged", fullscreen);
  }
}

/** The folder holding the last face shared to an iPhone with AirDrop. */
let iphoneShareFolder: string | null = null;

// Turns an activity name into a filesystem-safe base name for export downloads.
function sanitizeExportFileName(name?: string): string {
  if (!name) {
    return "";
  }

  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function loadRasterFontSpriteFolder(
  folderPath: string
): Promise<CorosWatchfaceRasterFontFolder> {
  const sprites: CorosWatchfaceRasterFontFolder["sprites"] = [];
  let totalBytes = 0;

  async function walk(directoryPath: string, relativeDirectory = ""): Promise<void> {
    const entries = (await fs.promises.readdir(directoryPath, {
      withFileTypes: true
    })).sort((left, right) =>
      left.name.localeCompare(right.name, "en", {
        sensitivity: "base",
        numeric: true
      })
    );
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".png") {
        continue;
      }

      const image = await fs.promises.readFile(absolutePath);
      totalBytes += image.byteLength;
      if (totalBytes > MAX_RASTER_FONT_SPRITE_FOLDER_BYTES) {
        throw new Error("PNG sprite folders must be 12 MB or smaller.");
      }
      sprites.push({
        name: entry.name,
        relativePath,
        dataUrl: `data:image/png;base64,${image.toString("base64")}`,
        sizeBytes: image.byteLength
      });
    }
  }

  await walk(folderPath);
  if (sprites.length === 0) {
    throw new Error("The selected folder does not contain any PNG files.");
  }
  return { label: path.basename(folderPath), sprites };
}

function formatYyyymmddDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function pickLatestTrainingHubActivity(
  activities: TrainingHubActivity[]
): TrainingHubActivity | undefined {
  const validActivities = activities.filter(
    (activity) =>
      activity.activityId.trim().length > 0 &&
      Number.isFinite(activity.sportType)
  );
  if (validActivities.length === 0) {
    return undefined;
  }

  return validActivities.reduce((latest, activity) => {
    const latestStart = latest.startTime ?? Number.NEGATIVE_INFINITY;
    const activityStart = activity.startTime ?? Number.NEGATIVE_INFINITY;
    return activityStart > latestStart ? activity : latest;
  });
}

async function exportTrainingHubActivityFileToDisk(
  activity: TrainingHubActivity,
  fileType: TrainingHubActivityFileType,
  suggestedName?: string
): Promise<TrainingHubExportResult> {
  const { format, content } = await currentActivitySource().readActivityFile(
    activity.activityId,
    activity.sportType,
    fileType
  );

  const baseName =
    sanitizeExportFileName(suggestedName ?? activity.name) ||
    `activity-${activity.activityId}`;
  const defaultPath = `${baseName}.${format.extension}`;

  const saveOptions = {
    defaultPath,
    filters: [
      { name: `${format.label} file`, extensions: [format.extension] }
    ]
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, localizeDialogOptions(saveOptions))
      : await dialog.showSaveDialog(localizeDialogOptions(saveOptions));

  const metadata = {
    activityId: activity.activityId,
    activityName: activity.name,
    activityStartTime: activity.startTime,
    fileType,
    formatLabel: format.label
  };

  if (result.canceled || !result.filePath) {
    return { saved: false, ...metadata };
  }

  await fs.promises.writeFile(result.filePath, content);
  return { saved: true, filePath: result.filePath, ...metadata };
}

function getAppIconPath(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? ["icon.icns", "icon.png"]
      : process.platform === "win32"
        ? ["icon.ico", "icon.png"]
        : ["icon.png", "icon.icns"];

  for (const fileName of candidates) {
    const iconPath = path.join(__dirname, "../build", fileName);
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }

  return undefined;
}

function applyAppIcon(): void {
  const iconPath = getAppIconPath();
  if (!iconPath) {
    return;
  }

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(iconPath);
    } catch {
      // A bad/missing dock icon (e.g. in dev) must not abort app startup.
    }
  }
}

const ALLOWED_PERMISSIONS = new Set([
  "geolocation",
  // Lets the renderer copy text (e.g. the Spotify Redirect URI) via
  // navigator.clipboard.writeText.
  "clipboard-sanitized-write"
]);

function configureAppPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    }
  );

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );
}

function configureCorosBluetoothSelection(window: BrowserWindow): void {
  // Electron does not provide a built-in Web Bluetooth chooser. A PACE Pro
  // does not reliably advertise its full name, so the renderer receives the
  // nearby-device list and lets the user explicitly choose the watch.
  window.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    if (pendingCorosBluetoothSelection) {
      clearTimeout(pendingCorosBluetoothSelection.timeout);
    }
    const timeout = setTimeout(() => {
      const pending = pendingCorosBluetoothSelection;
      pendingCorosBluetoothSelection = undefined;
      pending?.callback("");
      if (!window.isDestroyed()) {
        window.webContents.send("watchfaces:bluetoothDevices", []);
      }
    }, 45_000);
    pendingCorosBluetoothSelection = { callback, timeout };
    const choices: CorosBluetoothDeviceChoice[] = devices.map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName
    }));
    window.webContents.send("watchfaces:bluetoothDevices", choices);
  });
}

function createWindow(): void {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: "CorosLink",
    ...(iconPath ? { icon: iconPath } : {}),
    backgroundColor: process.platform === "darwin" ? "#00000000" : DEFAULT_WINDOW_BACKGROUND,
    // Let the app's own header act as the title bar so the macOS traffic
    // lights sit directly on it instead of a separate OS chrome strip.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: "sidebar" as const,
          visualEffectState: "active" as const
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [
        ...(process.platform === "darwin" ? ["--coros-native-sidebar-glass"] : []),
        ...(networkPolicy.enforcing ? ["--coroslink-local-only"] : [])
      ],
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });

  observeDiagnosticWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  onWatchfaceRendererNavigation(mainWindow.webContents, () => {
    rendererReady = false;
    watchfaceAutomation?.resetRenderer();
  });
  mainWindow.on("closed", () => {
    rendererReady = false;
    watchfaceAutomation?.resetRenderer();
    mainWindow = undefined;
  });
  configureCorosBluetoothSelection(mainWindow);

  // macOS fullscreen exposes the window background in the title-bar inset;
  // re-apply after transitions so it stays in sync with the active theme.
  mainWindow.on("enter-full-screen", () => {
    applyWindowBackground(currentWindowBackground);
    syncTrafficLightPosition(true);
    notifyWindowFullscreen(true);
  });
  mainWindow.on("leave-full-screen", () => {
    applyWindowBackground(currentWindowBackground);
    syncTrafficLightPosition(false);
    notifyWindowFullscreen(false);
  });

  // The window stays on this page: a dropped file or link would otherwise get the whole preload API.
  const appPage = process.env.VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
  confineMainWindow(mainWindow.webContents, appPage, url => { void shell.openExternal(url); });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  initializeAppUpdater(mainWindow);
}

function deepLinkFromArguments(argumentsList: string[]): CommunityWatchfaceOpenRequest | null {
  for (const argument of argumentsList) {
    const request = parseCommunityWatchfaceDeepLink(argument);
    if (request) return request;
  }
  return null;
}

/** The watchfaces.coroslink.com sign-in coming back from the browser (remote access, away from home). */
function authCallbackFromArguments(argumentsList: string[]): string | null {
  return argumentsList.find((argument) => isAuthCallbackUrl(argument)) ?? null;
}

function handleAuthCallback(url: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  // Before startup there is no sign-in waiting for it, so there's nothing to finish.
  void remoteAccess?.handleAuthCallback(url).catch(() => undefined);
}

function handleCommunityWatchfaceOpen(request: CommunityWatchfaceOpenRequest): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (rendererReady) {
      mainWindow.webContents.send("watchfaces:communityOpenRequested", request);
      return;
    }
  }
  pendingCommunityWatchfaceOpen = request;
}

// `npm run dev` would otherwise end with "dev:electron exited with code 0" and
// concurrently stopping Vite, which reads like a build problem.
function exitForDevInstanceConflict(): void {
  let holder = "another CorosLink instance";
  try {
    const pid = /-(\d+)$/.exec(fs.readlinkSync(path.join(app.getPath("userData"), "SingletonLock")))?.[1];
    if (pid) holder = `CorosLink pid ${pid}`;
  } catch { /* lock link is macOS/Linux-only */ }
  console.error(`[dev] ${holder} already holds the single-instance lock. Quit it (kill, or kill -9 if it hangs), then rerun npm run dev.`);
  app.exit(1);
}

// A dev Electron outlives `npm run dev` when its launcher dies first, and the
// orphan keeps the single-instance lock, so every later dev launch bails out.
function quitWhenDevLauncherExits(): void {
  const launcherPid = process.ppid;
  if (app.isPackaged || launcherPid <= 1) return;
  const timer = setInterval(() => {
    if (process.ppid === launcherPid) return;
    clearInterval(timer);
    console.warn(`[dev] Launcher pid ${launcherPid} exited; quitting this orphaned instance.`);
    app.quit();
    // Orphans have ignored a graceful quit before; don't let one linger.
    setTimeout(() => app.exit(0), 5_000);
  }, 2_000);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  if (app.isPackaged) app.quit();
  else exitForDevInstanceConflict();
} else {
  quitWhenDevLauncherExits();
  const initialDeepLink = deepLinkFromArguments(process.argv);
  if (initialDeepLink) pendingCommunityWatchfaceOpen = initialDeepLink;
  app.on("second-instance", (_event, commandLine) => {
    const authCallback = authCallbackFromArguments(commandLine);
    const request = authCallback ? null : deepLinkFromArguments(commandLine);
    if (authCallback) handleAuthCallback(authCallback);
    else if (request) handleCommunityWatchfaceOpen(request);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (isAuthCallbackUrl(url)) {
      handleAuthCallback(url);
      return;
    }
    const request = parseCommunityWatchfaceDeepLink(url);
    if (request) handleCommunityWatchfaceOpen(request);
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  initializeDiagnostics(() => mainWindow);
  registerDiagnosticStatus(corosAccountDiagnostics);
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient("coroslink", process.execPath, [
      path.resolve(process.argv[1])
    ]);
  } else {
    app.setAsDefaultProtocolClient("coroslink");
  }
  configureAppPermissions();
  configureYouTubeBrowserSession();
  registerYouTubeBrowserHandlers();
  configureYouTubeMusicBrowserSession();
  // Saving runs the ytmusicapi Python bridge, so guard against overlapping runs
  // if several youtubei requests slip through before the first save finishes.
  let youtubeMusicCaptureInFlight = false;
  registerYouTubeMusicBrowserHandlers((headerBlock) => {
    if (youtubeMusicCaptureInFlight) {
      return;
    }
    youtubeMusicCaptureInFlight = true;
    void saveYouTubeMusicAuth(headerBlock)
      .then((status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("youtubeMusic:authCaptured", { status });
        }
      })
      .catch((error) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("youtubeMusic:authCaptured", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })
      .finally(() => {
        youtubeMusicCaptureInFlight = false;
      });
  });
  configureAppleMusicBrowserSession();
  registerAppleMusicBrowserHandlers((headers) => {
    // Fires on every amp-api call; only tell the renderer when the stored
    // credentials actually change (e.g. the media-user-token first appears).
    const { status, changed } = saveAppleMusicCapturedHeaders(headers);
    if (changed && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("appleMusic:authCaptured", status);
    }
  });
  initializeDatabase(app.getPath("userData"));
  // Local-Only Mode is known before anything below can upload to COROS.
  localData = registerLocalOnlyMode({ getWindow: () => mainWindow });
  initializeNativeLanguage();
  hydratePlanDraftStoreFromDatabase();
  prunePlanDraftStore();
  pruneDeleteRequestStore();
  coachHub = createCoachHub();
  remoteAccess = new RemoteAccess({
    hub: coachHub,
    settings: { get: getSetting, set: setSetting },
    defaultProvider: () => getChatSettings().provider,
    chatSettings: getChatSettings,
    // A model picked on the phone shows in the Coach window at once.
    saveChatSettings: (settings) => {
      const saved = saveChatSettings(settings);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("chat:settingsChanged", saved);
      return saved;
    },
    chatModels: listChatModelOptions,
    // Files a phone attaches land in the same store as the window's.
    attachments: {
      save: (sessionId, upload) => coachAttachments().save(sessionId, upload),
      get: (sessionId, id) => coachAttachments().summary(sessionId, id)
    }
  });
  // Opening one's own private face from the website: the catalog may ask with the account token.
  const account = remoteAccess.cloud.account;
  setCommunityWatchfaceAccountToken((origin) => account.tokenFor(origin));
  registerIpcHandlers();
  remoteAccess.initialize();
  watchfaceAutomation = registerWatchfaceAutomation(() => mainWindow);
  workoutAutomation = registerWorkoutAutomation(() => mainWindow, {
    // A strength review saved from its card updates the Coach entry for every client.
    onCoachEditChanged: (proposalId) => {
      void coachHub?.syncStrengthEdit(proposalId).catch(() => undefined);
    }
  });
  startGoogleCalendarSync();
  startAppleCalendarSync();
  setJobListener((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("youtube:jobsUpdate", jobs);
    }
  });
  setCorosMapDownloadListener((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("maps:downloadJobsUpdate", jobs);
    }
  });
  setCorosMapInstallProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("maps:installProgressUpdate", progress);
    }
  });
  setActivityBackupProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("trainingHub:backupProgress", progress);
    }
  });
  // Up next on Overview re-reads the schedule whenever any view changes it.
  setScheduledWorkoutsChangedListener(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("trainingHub:scheduleChanged");
    }
  });
  // Sleep and daily health load once COROS MCP connects, however it connected.
  onMcpConnectionChanged((id, connected) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // coros: the server COROS features use, which an athlete may have added under another id.
      mainWindow.webContents.send("mcp:connectionChanged", { id, connected, coros: id === corosMcpServerId() });
    }
  });
  // COROS ended the session (signed out), or a dead one was renewed from the saved login.
  onTrainingHubSessionChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("trainingHub:sessionChange", status);
    }
  });
  setFitIndexProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("fitIndex:progress", progress);
    }
  });
  setCommunityWatchfaceProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("watchfaces:communityDownloadProgress", progress);
    }
  });
  void cleanupCommunityWatchfaceImports();
  setCorosMcpAccountSource(getCorosMcpAccount);
  createWindow();
  void watchfaceAutomation.restore();
  void workoutAutomation.restore();
  applyAppIcon();

  // Silently restore previously-authorized MCP sessions (COROS + any other
  // configured servers), no browser popup.
  void ensureAllMcpConnected();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let wifiMusicQuitPending = false;
let wifiMusicQuitReady = false;
let watchWorkQuitPending = false;
let watchWorkQuitReady = false;
app.on("before-quit", event => {
  if (!wifiMusicQuitReady && corosNativeBle.isWifiMusicActive()) {
    event.preventDefault();
    if (!wifiMusicQuitPending) {
      wifiMusicQuitPending = true;
      // Bounded: an unfinished restore stays journaled and runs on the next connection.
      void Promise.race([corosNativeBle.finishWifiMusicBeforeQuit(), new Promise(resolve => setTimeout(resolve, 30_000))])
        .finally(() => { wifiMusicQuitReady = true; app.quit(); });
    }
    return;
  }
  // A sync, transfer or settings write to the watch finishes first (bounded): cut short, it can leave
  // the watch without its training plan until the next sync. A sync's reads stop at the next block.
  if (!watchWorkQuitReady && corosNativeBle.hasWatchWork()) {
    event.preventDefault();
    if (!watchWorkQuitPending) {
      watchWorkQuitPending = true;
      localData?.cancelSync();
      void corosNativeBle.finishBeforeQuit().catch(() => undefined)
        .finally(() => { watchWorkQuitReady = true; app.quit(); });
    }
    return;
  }
  coachHub?.shutdown();
  localData?.cancelSync();
  void remoteAccess?.stop();
  void corosNativeBle.stop();
  void watchfaceAutomation?.stop();
  void workoutAutomation?.stop();
  stopGoogleCalendarSync();
  stopAppleCalendarSync();
  stopRouteShare();
  stopWatchfacePhoneSend();
  if (iphoneShareFolder) fs.rmSync(iphoneShareFolder, { recursive: true, force: true });
});

function registerIpcHandlers(): void {
  ipcMain.handle("app:setLanguage", (event, language: unknown) => {
    mainWindowSender(event, "language settings");
    setNativeLanguage(language);
  });
  ipcMain.handle("corosBle:status", () => corosNativeBle.status());
  // Connecting sets the watch's clock and sends weather; counted as the user's (see userConnect).
  ipcMain.handle("corosBle:connect", (event, input?: import("./corosNativeBleTypes").CorosNativeBleConnectOptions) => {
    mainWindowSender(event, "the watch connection");
    return corosNativeBle.userConnect(input?.pair === true, input);
  });
  ipcMain.handle("corosBle:scan", () => corosNativeBle.scan());
  ipcMain.handle("corosBle:refresh", () => corosNativeBle.refresh());
  // Bluetooth music (library reads, deletes, Wi-Fi send) isn't supported in release builds yet.
  const requireBleMusic = () => {
    if (app.isPackaged) throw new Error("Bluetooth music sync isn't available in this version of CorosLink.");
  };
  ipcMain.handle("corosBle:musicInventory", () => { requireBleMusic(); return corosNativeBle.listMusic(); });
  ipcMain.handle("corosBle:wifiMusicStatus", () => { requireBleMusic(); return corosNativeBle.wifiMusicStatus(); });
  /** The main window, when it (not a subframe or another window) sent the request. Every watch write checks it. */
  const mainWindowSender = (event: Electron.IpcMainInvokeEvent, action: string) =>
    requireMainWindowSender(event, mainWindow, `Use ${action} from CorosLink's main window.`);
  const audioOwner = (event: Electron.IpcMainInvokeEvent) => {
    requireBleMusic();
    return mainWindowSender(event, "audio sync");
  };
  registerCorosActivityScreenIpc({ ipc: ipcMain, isPackaged: () => app.isPackaged, api: corosNativeBle,
    owner: event => mainWindowSender(event, "activity-screen sync"), saveDialog: (owner, options) => dialog.showSaveDialog(owner, localizeDialogOptions(options)) });
  ipcMain.handle("corosBle:wifiMusicSend", event => {
    const owner = audioOwner(event);
    return corosNativeBle.sendMusicOverWifi(async () => {
      const result = await dialog.showOpenDialog(owner, localizeDialogOptions({ title: "Send MP3s to watch podcasts over Wi-Fi", properties: ["openFile", "multiSelections"],
        filters: [{ name: "MP3 audio", extensions: ["mp3"] }] }));
      return result.canceled ? null : result.filePaths;
    });
  });
  ipcMain.handle("corosBle:wifiMusicLibrarySend", (event, ids: unknown) => {
    audioOwner(event);
    return corosNativeBle.sendMusicOverWifi(async () => resolveWifiMusicLibraryFiles(ids, getDownloadById));
  });
  ipcMain.handle("corosBle:wifiMusicBackup", event => {
    const owner = audioOwner(event);
    return corosNativeBle.importWifiMusicBackup(async () => {
      const result = await dialog.showOpenDialog(owner, localizeDialogOptions({ title: "Choose a current watch download-settings backup", properties: ["openFile"],
        filters: [{ name: "CorosLink encrypted Wi-Fi settings", extensions: ["enc"] }] }));
      return result.canceled ? null : result.filePaths[0] ?? null;
    });
  });
  ipcMain.handle("corosBle:wifiMusicCancel", event => { audioOwner(event); corosNativeBle.cancelWifiMusicSync(); });
  ipcMain.handle("corosBle:wifiMusicRestore", event => { audioOwner(event); return corosNativeBle.restoreWifiMusicSettings(); });
  ipcMain.handle("corosBle:deleteMusic", (event, target: import("./corosBleMusicTypes").CorosBleMusicDeleteTarget) => {
    requireBleMusic();
    return corosNativeBle.deleteMusic(target, async track => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed()) return false;
      const result = await dialog.showMessageBox(owner, localizeDialogOptions({
        type: "warning", buttons: ["Cancel", "Delete from watch"], defaultId: 0, cancelId: 0,
        message: `Delete “${track.name}” from the watch?`,
        detail: "This removes the MP3 from your watch over Bluetooth. It cannot be undone. Your local library is kept.",
        noLink: true,
      }));
      return result.response === 1;
    });
  });
  ipcMain.handle("corosBle:disconnect", () => corosNativeBle.disconnect());
  // The QR carries the watch account key itself, so only the main window may ask for it.
  ipcMain.handle("corosBle:phonePairing", event => {
    mainWindowSender(event, "iPhone pairing");
    return corosNativeBle.phonePairingCode();
  });
  // Send to iPhone: Studio's final archive for C-LINK, over the local network (every platform)
  // or AirDrop (macOS). C-LINK adds it to My Faces and installs it on the watch from there.
  const phoneSendInput = (input: unknown) => {
    const value = input as { archiveId?: unknown; name?: unknown; firmwareType?: unknown } | null;
    if (!value || typeof value.archiveId !== "string" || typeof value.name !== "string") {
      throw new Error("Build the watch face before sending it to your iPhone.");
    }
    const target = typeof value.firmwareType === "string" ? getWatchfaceTarget(value.firmwareType) : undefined;
    return { archiveId: value.archiveId, name: value.name.trim().slice(0, 80) || "Custom watch face", model: target?.model };
  };
  ipcMain.handle("watchfaces:phoneSendStart", async (event, input: unknown) => {
    const owner = mainWindowSender(event, "Send to iPhone");
    const { archiveId, name, model } = phoneSendInput(input);
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coroslink-iphone-"));
    try {
      const filename = path.join(temporary, "face.zip");
      await exportCorosWatchfaceArchive(archiveId, filename);
      const data = await fs.promises.readFile(filename);
      return await startWatchfacePhoneSend({ data, name, model }, status => {
        if (!owner.isDestroyed()) owner.webContents.send("watchfaces:phoneSendStatus", status);
      });
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
  });
  ipcMain.handle("watchfaces:phoneSendStop", () => stopWatchfacePhoneSend());
  ipcMain.handle("watchfaces:airDropToIphone", async (event, input: unknown) => {
    const owner = mainWindowSender(event, "AirDrop");
    if (process.platform !== "darwin") throw new Error("AirDrop is only on macOS. Use Show code instead.");
    const { archiveId, name } = phoneSendInput(input);
    // AirDrop reads the file after the menu closes, so it stays until the next share or quit.
    if (iphoneShareFolder) await fs.promises.rm(iphoneShareFolder, { recursive: true, force: true });
    iphoneShareFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coroslink-airdrop-"));
    // .dat is the type C-LINK registers, so the iPhone offers to open it there.
    const filename = path.join(iphoneShareFolder, `${sanitizeExportFileName(name) || "CorosLink-watch-face"}.dat`);
    await exportCorosWatchfaceArchive(archiveId, filename);
    new ShareMenu({ filePaths: [filename] }).popup({ window: owner });
  });
  ipcMain.handle("watchfaces:forgetWatchKey", async event => {
    const owner = mainWindowSender(event, "watch key removal");
    const result = await dialog.showMessageBox(owner, localizeDialogOptions({
      type: "warning", buttons: ["Cancel", "Remove watch key"], defaultId: 0, cancelId: 0,
      message: "Remove the COROS watch key from this computer?",
      detail: "CorosLink won't authenticate with your watch again until you sign in to COROS. A watch that's connected now stays connected until you disconnect it. C-LINK keeps its own copy on your iPhone.",
      noLink: true,
    }));
    return result.response === 1 ? forgetCorosWatchKey() : getCorosWatchfaceStatus();
  });
  // A passphrase-protected copy of the watch key: the key stays here, the renderer sends only the passphrase.
  registerCorosWatchKeyBackupIpc({
    ipc: ipcMain, owner: event => mainWindowSender(event, "watch key backup"),
    service: { status: getCorosWatchfaceStatus, createBackup: createCorosWatchKeyBackup, openBackup: openCorosWatchKeyBackup, saveRestored: saveRestoredCorosWatchKey },
    saveDialog: (owner, options) => dialog.showSaveDialog(owner, localizeDialogOptions(options)),
    openDialog: (owner, options) => dialog.showOpenDialog(owner, localizeDialogOptions(options)),
    confirm: async (owner, options) => (await dialog.showMessageBox(owner, localizeDialogOptions(options))).response,
    text: nativeText,
    notice: message => recordDiagnosticNotice("watchKey:backup", message)
  });
  ipcMain.handle("corosBle:sendNotification", (event, input: import("./corosBleNotificationProtocol").CorosNotificationInput) => {
    mainWindowSender(event, "watch messages");
    return corosNativeBle.sendNotification(input);
  });
  ipcMain.handle("corosBle:chooseWatchface", async () => {
    const options: OpenDialogOptions = { title: "Choose a compiled COROS watch face", properties: ["openFile"],
      filters: [{ name: "Compiled watch face", extensions: ["bin"] }] };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options)) : await dialog.showOpenDialog(localizeDialogOptions(options));
    return result.canceled || !result.filePaths[0] ? null : corosNativeBle.prepareWatchface(result.filePaths[0]);
  });
  ipcMain.handle("corosBle:watchfaceStatus", () => corosNativeBle.watchfaceSyncStatus());
  ipcMain.handle("corosBle:watchfaceSlots", () => corosNativeBle.listWatchfaceSlots());
  ipcMain.handle("corosBle:watchfaceSync", (event, previewId: string, target?: import("./corosBleWatchfaceTypes").CorosDirectWatchfaceTarget) => {
    mainWindowSender(event, "watch face sync");
    return corosNativeBle.syncWatchface(previewId, target);
  });
  ipcMain.handle("corosBle:watchfaceCancel", () => corosNativeBle.cancelWatchfaceSync());
  ipcMain.handle("corosBle:compilerStatus", () => getCorosWatchfaceCompiler().status());
  ipcMain.handle("corosBle:compileWatchface", async () => {
    const options: OpenDialogOptions = { title: "Compile a custom watch face to BIN", properties: ["openFile"],
      filters: [{ name: "Final watch face DAT/ZIP", extensions: ["dat", "zip"] }] };
    const result = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options)) : await dialog.showOpenDialog(localizeDialogOptions(options));
    if (result.canceled || !result.filePaths[0]) return null;
    const compiler = getCorosWatchfaceCompiler();
    // For the connected watch; with none, the archive's first supported layout (PACE Pro first).
    const compiled = await compiler.compile(result.filePaths[0], path.basename(result.filePaths[0]), corosNativeBle.connectedWatchTarget());
    const preview = await corosNativeBle.prepareWatchface(compiled.filePath, true);
    compiler.remember(preview.id, compiled.filePath);
    return { ...preview, compile: { durationMs: compiled.durationMs, warnings: compiled.warnings } };
  });
  ipcMain.handle("watchfaces:compileBin", async (_event, input: { archiveId: string; name: string; firmwareType?: string }) => {
    if (!input || typeof input.archiveId !== "string" || typeof input.name !== "string") throw new Error("Build a final watch face archive before compiling.");
    // Studio builds the archive for one watch; compile that watch's layout.
    const target = typeof input.firmwareType === "string" ? getWatchfaceTarget(input.firmwareType) : undefined;
    if (input.firmwareType !== undefined && !target) throw new Error("CorosLink can't compile faces for this watch yet.");
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coroslink-compile-"));
    try {
      const filename = path.join(temporary, "source.dat");
      await exportCorosWatchfaceArchive(input.archiveId, filename);
      const compiler = getCorosWatchfaceCompiler();
      const compiled = await compiler.compile(filename, input.name, target);
      const preview = await corosNativeBle.prepareWatchface(compiled.filePath, true);
      compiler.remember(preview.id, compiled.filePath);
      return { ...preview, compile: { durationMs: compiled.durationMs, warnings: compiled.warnings } };
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
  });
  ipcMain.handle("corosBle:saveCompiledBin", async (_event, previewId: string) => {
    const filename = getCorosWatchfaceCompiler().fileForPreview(previewId);
    const options = { title: "Save compiled watch face BIN", defaultPath: path.basename(filename), filters: [{ name: "Compiled watch face BIN", extensions: ["bin"] }] };
    const result = mainWindow && !mainWindow.isDestroyed() ? await dialog.showSaveDialog(mainWindow, localizeDialogOptions(options)) : await dialog.showSaveDialog(localizeDialogOptions(options));
    if (result.canceled || !result.filePath) return { saved: false };
    const destination = result.filePath.toLowerCase().endsWith(".bin") ? result.filePath : result.filePath + ".bin";
    await fs.promises.copyFile(filename, destination);
    return { saved: true };
  });
  ipcMain.handle("corosBle:mapStatus", () => corosNativeBle.wifiMapStatus());
  ipcMain.handle("corosBle:mapPreview", (_event, tiles: unknown) => corosNativeBle.previewWifiMap(tiles));
  ipcMain.handle("corosBle:mapDownload", (event, previewId: string) => {
    mainWindowSender(event, "map downloads");
    return corosNativeBle.downloadWifiMap(previewId);
  });
  ipcMain.handle("corosBle:routeStatus", () => corosNativeBle.routeSyncStatus());
  ipcMain.handle("corosBle:routeCancel", () => corosNativeBle.cancelRouteSync());
  corosNativeBle.setConnectedPush(() => watchWeatherFile());
  corosNativeBle.setProfileSink((profile, model) => storeWatchProfile(profile, new Date(), model));
  corosNativeBle.setSwitchesSink((switches, ext, model) => storeWatchSwitches(switches, ext, new Date(), model));
  ipcMain.handle("watch:getProfile", () => getWatchProfile() ?? null);
  ipcMain.handle("watch:updateProfile", (event, edits: unknown) => {
    mainWindowSender(event, "watch settings");
    return updateWatchProfile(edits, {
      read: () => corosNativeBle.readWatchProfile(),
      write: profile => corosNativeBle.writeWatchProfile(profile)
    });
  });
  ipcMain.handle("watch:setWeatherLocation", (event, location: unknown) => {
    mainWindowSender(event, "the weather location");
    return setWatchWeatherLocation(location);
  });
  ipcMain.handle("watch:getWeatherLocation", () => getWeatherLocation() ?? null);
  ipcMain.handle("watch:getSettings", () => getWatchSettings() ?? null);
  ipcMain.handle("watch:updateSettings", (event, edits: unknown) => {
    mainWindowSender(event, "watch settings");
    return updateWatchSettings(edits, {
      read: () => corosNativeBle.readWatchSwitches(),
      write: (word, ext) => corosNativeBle.writeWatchSwitches(word, ext)
    });
  });
  ipcMain.handle("watch:chooseWeatherLocation", (event, location: unknown) => {
    mainWindowSender(event, "the weather location");
    return chooseWeatherLocation(location) ?? null;
  });
  ipcMain.handle("watch:searchWeatherPlaces", (event, query: unknown, language: unknown) => {
    mainWindowSender(event, "the weather location");
    return searchWeatherPlaces(query, typeof language === "string" ? language : "en");
  });
  ipcMain.handle("corosBle:sendWorkout", async (event, programId: unknown) => {
    mainWindowSender(event, "Send to watch");
    if (typeof programId !== "string" || !/^\d{1,20}$/.test(programId)) throw new Error("Invalid workout.");
    const program = await getWorkoutProgramDetail(programId);
    if (!program) throw new Error("The workout was not found.");
    return corosNativeBle.sendWorkoutToWatch(program);
  });
  ipcMain.handle("corosBle:routeSync", async (event, routeId: unknown) => {
    mainWindowSender(event, "route sync");
    if (typeof routeId !== "string" || routeId.length > 128) throw new Error("Invalid saved route.");
    const route = await getGeneratedRouteDetails(routeId);
    if (!route) throw new Error("The saved route was not found.");
    return corosNativeBle.syncRoute(route);
  });
  ipcMain.handle("calendar:getWorkoutEvent", (_event, ref: CalendarWorkoutEventRef) => getCalendarWorkoutEvent(ref));
  ipcMain.handle("calendar:updateWorkoutEvent", (_event, input: { ref: CalendarWorkoutEventRef; timing: CalendarEventTiming }) => updateCalendarWorkoutEvent(input));
  ipcMain.handle("calendar:syncEditedWorkout", (_event, ref: CalendarWorkoutEventRef) => syncEditedCalendarWorkout(ref));
  ipcMain.handle("appleCalendar:status", () => appleCalendar.status());
  ipcMain.handle("appleCalendar:connect", (_event, input: AppleCalendarCredentials) => appleCalendar.connect(input));
  ipcMain.handle("appleCalendar:cancelConnect", () => appleCalendar.cancelConnect());
  ipcMain.handle("appleCalendar:disconnect", () => appleCalendar.disconnect());
  ipcMain.handle("appleCalendar:listCalendars", () => appleCalendar.listCalendars());
  ipcMain.handle("appleCalendar:updateSettings", (_event, input: CalendarSyncSettings) => appleCalendar.updateSettings(input));
  ipcMain.handle("appleCalendar:sync", () => appleCalendar.sync());
  ipcMain.handle("googleCalendar:status", () => googleCalendar.status());
  ipcMain.handle("googleCalendar:saveConfig", (_event, input: GoogleCalendarConfigInput) => googleCalendar.saveConfig(input));
  ipcMain.handle("googleCalendar:connect", () => googleCalendar.connect());
  ipcMain.handle("googleCalendar:cancelConnect", () => googleCalendar.cancelConnect());
  ipcMain.handle("googleCalendar:disconnect", () => googleCalendar.disconnect());
  ipcMain.handle("googleCalendar:listCalendars", () => googleCalendar.listCalendars());
  ipcMain.handle("googleCalendar:updateSettings", (_event, input: CalendarSyncSettings) => googleCalendar.updateSettings(input));
  ipcMain.handle("googleCalendar:sync", () => googleCalendar.sync());

  ipcMain.handle("window:setBackground", (_event, color: string) => {
    applyWindowBackground(color);
  });

  ipcMain.handle("window:isFullscreen", () => mainWindow?.isFullScreen() ?? false);

  ipcMain.handle("watch:getStatus", () => getWatchStatus());

  ipcMain.handle("watchfaces:getStatus", () => getCorosWatchfaceStatus());

  // Font names are host-local metadata only. Glyph rendering remains in the
  // renderer, where they are baked into the watchface's PNG sprites.
  ipcMain.handle("watchfaces:listLocalFontFamilies", () => listLocalFontFamilies());

  ipcMain.handle(
    "watchfaces:login",
    (
      _event,
      email: string,
      password: string,
      region?: CorosWatchfaceRegion,
      remember?: boolean
    ) => loginCorosWatchfaces(email, password, region, remember)
  );

  ipcMain.handle(
    "watchfaces:loginSaved",
    (_event, region?: CorosWatchfaceRegion) =>
      loginCorosWatchfacesWithSavedCredentials(region)
  );

  ipcMain.handle("watchfaces:logout", () => logoutCorosWatchfaces());

  ipcMain.handle("watchfaces:listPairedDevices", () => listCorosPairedDevices());
  ipcMain.handle(
    "watchfaces:selectBluetoothDevice",
    (_event, deviceId: string) => {
      const pending = pendingCorosBluetoothSelection;
      pendingCorosBluetoothSelection = undefined;
      if (!pending) {
        throw new Error("There is no active Bluetooth device scan.");
      }
      clearTimeout(pending.timeout);
      pending.callback(deviceId);
    }
  );
  ipcMain.handle("watchfaces:cancelBluetoothDevice", () => {
    const pending = pendingCorosBluetoothSelection;
    pendingCorosBluetoothSelection = undefined;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.callback("");
    }
  });

  ipcMain.handle(
    "watchfaces:getBatteryReport",
    (_event, input: CorosBatteryQueryInput) => getCorosBatteryReport(input)
  );

  if (!app.isPackaged) {
    ipcMain.handle("gear:query", () => queryCorosGear());
    ipcMain.handle(
      "gear:save",
      (_event, input: CorosGearSaveInput) => saveCorosGear(input)
    );
  }

  ipcMain.handle(
    "watchfaces:listThemes",
    (_event, input: CorosWatchfaceThemeListInput) => listCorosWatchfaceThemes(input)
  );

  ipcMain.handle(
    "watchfaces:readCachedThemes",
    (_event, input: CorosWatchfaceThemeListInput) => readCachedCorosWatchfaceThemes(input)
  );

  ipcMain.handle(
    "watchfaces:downloadTheme",
    (_event, input: CorosWatchfaceThemeDownloadInput) =>
      downloadCorosWatchfaceTheme(input)
  );

  ipcMain.handle("watchfaces:importShareLink", (_event, shareUrl: string) =>
    importCorosWatchfaceShareLink(shareUrl)
  );

  ipcMain.handle("watchfaces:officialAssets:ensure", (_event, input: { firmwareType: string; rebuild?: boolean }) =>
    ensureCorosOfficialAssetLibrary(input)
  );
  ipcMain.handle("watchfaces:officialAssets:status", (_event, input: { firmwareType: string }) =>
    getCorosOfficialAssetLibraryStatus(input)
  );
  ipcMain.handle("watchfaces:officialAssets:list", (_event, input: CorosOfficialAssetQuery) =>
    listCorosOfficialAssets(input)
  );
  ipcMain.handle("watchfaces:officialAssets:frames", (_event, input: { firmwareType: string; id: string }) =>
    readCorosOfficialAssetFrames(input)
  );

  ipcMain.handle("watchfaces:listCommunity", (_event, input) =>
    listCommunityWatchfaces(input)
  );
  ipcMain.handle("watchfaces:getCommunity", (_event, slug: string, model?: string) =>
    getCommunityWatchface(slug, model)
  );
  ipcMain.handle("watchfaces:importCommunity", (_event, slug: string, model?: string) =>
    importCommunityWatchface(slug, model)
  );
  ipcMain.handle("watchfaces:consumeCommunityOpenRequest", () => {
    rendererReady = true;
    const request = pendingCommunityWatchfaceOpen ?? null;
    pendingCommunityWatchfaceOpen = undefined;
    return request;
  });

  ipcMain.handle("watchfaces:chooseArchive", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a COROS custom watchface archive",
      properties: ["openFile"],
      filters: [
        {
          name: "Watchface archive",
          extensions: ["zip", "dat"]
        }
      ]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options))
        : await dialog.showOpenDialog(localizeDialogOptions(options));
    const archivePath = result.filePaths[0];
    return result.canceled || !archivePath
      ? null
      : selectCorosWatchfaceArchive(archivePath);
  });

  ipcMain.handle("watchfaces:chooseArtwork", async () => {
    const options: OpenDialogOptions = {
      title: "Choose watchface artwork",
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"]
        }
      ]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options))
        : await dialog.showOpenDialog(localizeDialogOptions(options));
    const artworkPath = result.filePaths[0];
    return result.canceled || !artworkPath
      ? null
      : loadCorosWatchfaceArtwork(artworkPath);
  });

  ipcMain.handle("watchfaces:chooseRasterFontFolder", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a PNG watchface sprite folder",
      properties: ["openDirectory"]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options))
        : await dialog.showOpenDialog(localizeDialogOptions(options));
    const folderPath = result.filePaths[0];
    return result.canceled || !folderPath
      ? null
      : loadRasterFontSpriteFolder(folderPath);
  });

  ipcMain.handle("watchfaces:convertArchive", (_event, input: CorosWatchfaceConversionInput) =>
    convertCorosWatchfaceArchive(input)
  );
  ipcMain.handle(
    "watchfaces:createArchive",
    (_event, input: CorosWatchfaceCreatorInput) =>
      createCorosWatchfaceArchive(input)
  );
  ipcMain.handle(
    "watchfaces:exportProject",
    async (_event, input: CorosWatchfaceProjectExportInput) => {
      const baseName =
        sanitizeExportFileName(input?.name) || "CorosLink-watch-face";
      const saveOptions = {
        title: "Export editable watch face for website",
        defaultPath: `${baseName}.zip`,
        filters: [{ name: "Watch-face ZIP archive", extensions: ["zip"] }]
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, localizeDialogOptions(saveOptions))
          : await dialog.showSaveDialog(localizeDialogOptions(saveOptions));
      if (result.canceled || !result.filePath) {
        return { saved: false };
      }
      const destinationPath = result.filePath.toLowerCase().endsWith(".zip")
        ? result.filePath
        : `${result.filePath}.zip`;
      await exportCorosWatchfaceProject(input, destinationPath);
      return { saved: true, filePath: destinationPath };
    }
  );
  ipcMain.handle(
    "watchfaces:exportArchive",
    async (_event, input: CorosWatchfaceArchiveExportInput) => {
      if (!input || typeof input.archiveId !== "string") {
        throw new Error("Build a final watch-face archive before exporting it.");
      }
      const baseName =
        sanitizeExportFileName(input.name) || "CorosLink-watch-face";
      const saveOptions = {
        title: "Export final watch-face ZIP",
        defaultPath: `${baseName}.zip`,
        filters: [{ name: "Final watch-face ZIP", extensions: ["zip"] }]
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, localizeDialogOptions(saveOptions))
          : await dialog.showSaveDialog(localizeDialogOptions(saveOptions));
      if (result.canceled || !result.filePath) return { saved: false };
      const destinationPath = result.filePath.toLowerCase().endsWith(".zip")
        ? result.filePath
        : `${result.filePath}.zip`;
      await exportCorosWatchfaceArchive(input.archiveId, destinationPath);
      return { saved: true, filePath: destinationPath };
    }
  );
  // One Studio image (a template PNG or the user's replacement), saved so it
  // can be recolored and imported again. The renderer only supplies pixels.
  ipcMain.handle(
    "watchfaces:saveAssetImage",
    async (_event, input: CorosWatchfaceAssetImageSaveInput) => {
      const prefix = "data:image/png;base64,";
      if (typeof input?.dataUrl !== "string" || !input.dataUrl.startsWith(prefix)) {
        throw new Error("Only PNG images can be saved.");
      }
      const data = Buffer.from(input.dataUrl.slice(prefix.length), "base64");
      if (
        data.length > MAX_SAVED_ASSET_IMAGE_BYTES ||
        !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      ) {
        throw new Error("That image could not be saved.");
      }
      const baseName =
        sanitizeExportFileName(typeof input.name === "string" ? input.name : undefined) ||
        "watch-face-image";
      const saveOptions = {
        title: "Save watch-face image",
        defaultPath: `${baseName}.png`,
        filters: [{ name: "PNG image", extensions: ["png"] }]
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, localizeDialogOptions(saveOptions))
          : await dialog.showSaveDialog(localizeDialogOptions(saveOptions));
      if (result.canceled || !result.filePath) return { saved: false };
      const destinationPath = result.filePath.toLowerCase().endsWith(".png")
        ? result.filePath
        : `${result.filePath}.png`;
      await fs.promises.writeFile(destinationPath, data);
      return { saved: true, filePath: destinationPath };
    }
  );
  // Export for every watch: the renderer picks the folder once through this
  // dialog and only ever holds an opaque id, never a writable path.
  const exportFolders = new Map<string, string>();
  ipcMain.handle("watchfaces:chooseExportFolder", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a folder for the watch-face ZIPs",
      buttonLabel: "Export here",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options))
      : await dialog.showOpenDialog(localizeDialogOptions(options));
    const directory = result.canceled ? undefined : result.filePaths[0];
    if (!directory) return null;
    const folderId = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    exportFolders.set(folderId, directory);
    return { folderId, label: path.basename(directory) || directory };
  });
  ipcMain.handle(
    "watchfaces:exportArchiveToFolder",
    async (_event, input: CorosWatchfaceArchiveFolderExportInput) => {
      const directory = input && typeof input.folderId === "string" ? exportFolders.get(input.folderId) : undefined;
      if (!directory) throw new Error("Choose an export folder first.");
      if (typeof input.archiveId !== "string") throw new Error("Build a final watch-face archive before exporting it.");
      const baseName = sanitizeExportFileName(input.name) || "CorosLink-watch-face";
      let destinationPath = path.join(directory, `${baseName}.zip`);
      for (let copy = 2; fs.existsSync(destinationPath); copy++) {
        destinationPath = path.join(directory, `${baseName} ${copy}.zip`);
      }
      await exportCorosWatchfaceArchive(input.archiveId, destinationPath);
      return { saved: true, filePath: destinationPath };
    }
  );
  ipcMain.handle(
    "watchfaces:listProjects",
    (_event, options?: CorosWatchfaceProjectListOptions) =>
      listCorosWatchfaceProjects(options)
  );
  ipcMain.handle("watchfaces:loadProjectPreview", (_event, projectId: string) =>
    loadCorosWatchfaceProjectPreview(projectId)
  );
  ipcMain.handle("watchfaces:saveProject", (_event, input) =>
    saveCorosWatchfaceProject(input)
  );
  ipcMain.handle("watchfaces:loadProject", (_event, projectId: string) =>
    loadCorosWatchfaceProject(projectId)
  );
  ipcMain.handle(
    "watchfaces:cacheProjectPreview",
    (_event, projectId: string, previewDataUrl: string) =>
      cacheCorosWatchfaceProjectPreview(projectId, previewDataUrl)
  );
  ipcMain.handle("watchfaces:duplicateProject", (_event, projectId: string) =>
    duplicateCorosWatchfaceProject(projectId)
  );
  ipcMain.handle("watchfaces:deleteProject", (_event, projectId: string) =>
    deleteCorosWatchfaceProject(projectId)
  );

  ipcMain.handle(
    "watchfaces:describeTemplate",
    (_event, archiveId: string) => describeCorosWatchfaceTemplate(archiveId)
  );

  ipcMain.handle(
    "watchfaces:loadTemplateAssets",
    (_event, archiveId: string, paths: string[], options?: CorosWatchfaceTemplateAssetOptions) =>
      loadCorosWatchfaceTemplateAssets(archiveId, paths, options)
  );

  ipcMain.handle(
    "watchfaces:loadTemplateConfigTexts",
    (_event, archiveId: string) =>
      loadCorosWatchfaceTemplateConfigTexts(archiveId)
  );

  ipcMain.handle(
    "watchfaces:publish",
    (_event, input: CorosWatchfacePublishInput) => publishCorosWatchface(input)
  );

  ipcMain.handle(
    "watchfaces:createShareLink",
    (_event, input: CorosWatchfaceExistingShareInput) =>
      createCorosWatchfaceShareLink(input)
  );

  ipcMain.handle("watch:getConnectionSmokeOption", () =>
    getWatchConnectionSmokeOption()
  );

  ipcMain.handle(
    "watch:setConnectionSmokeOption",
    (_event, optionId: WatchConnectionSmokeOptionId) =>
      setWatchConnectionSmokeOption(optionId)
  );

  ipcMain.handle("watch:deleteTrack", async (_event, relativePath: string) => {
    await deleteWatchTrack(relativePath);
    clearDownloadTransferredByFileName(path.basename(relativePath));
    return getWatchStatus();
  });

  ipcMain.handle("watch:transferLocalTrack", async (_event, id: string) => {
    const download = getDownloadById(id);
    if (!download) {
      throw new Error("Local track was not found.");
    }

    const trackName = path.basename(download.filePath);
    const copiedTrack = await transferFileToWatch(
      download.filePath,
      ({ copiedBytes, totalBytes }) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        mainWindow.webContents.send("watch:transferProgress", {
          id,
          name: trackName,
          copiedBytes,
          totalBytes,
          progress: totalBytes > 0 ? Math.min(copiedBytes / totalBytes, 1) : 0
        } satisfies WatchTransferProgress);
      }
    );
    markDownloadTransferred(id);

    return {
      copiedTrack,
      watch: await getWatchStatus()
    };
  });

  registerAudiobookIpcHandlers();

  ipcMain.handle("downloads:list", () => listDownloads());

  ipcMain.handle("downloads:downloadAudio", (_event, url: string) =>
    downloadAudio(url)
  );

  ipcMain.handle(
    "downloads:delete",
    (_event, id: string, removeFile: boolean) => {
      const download = getDownloadById(id);
      deleteDownload(id, removeFile);

      if (download && !hasAvailableDownloadForUrl(download.url)) {
        clearTerminalJobsForUrl(download.url);
      }

      return listDownloads();
    }
  );

  ipcMain.handle("binaries:getStatus", () => getBinaryStatus());

  ipcMain.handle("youtube:listHistory", () => getYouTubeHistory());

  ipcMain.handle(
    "youtube:recordVisit",
    (_event, url: string, title?: string) => saveYouTubeVisit(url, title)
  );

  ipcMain.handle(
    "youtube:download",
    (_event, url: string, title?: string) =>
      downloadFromYouTubeBrowser(url, title)
  );

  ipcMain.handle("youtube:downloadMultiple", (_event, items) =>
    downloadMultipleFromYouTubeBrowser(items)
  );

  ipcMain.handle(
    "youtube:enqueueDownload",
    (_event, items: DownloadQueueItem[]): DownloadJob[] =>
      enqueueDownloads(items)
  );

  ipcMain.handle(
    "music:downloadCombined",
    (
      event,
      id: string,
      name: string,
      items: DownloadQueueItem[]
    ): Promise<CombinedDownloadResult> =>
      downloadCombinedTrack(id, name, items, (update) => {
        event.sender.send("music:combinedProgress", { id, ...update });
      })
  );

  ipcMain.handle("youtube:listJobs", (): DownloadJob[] => listJobs());

  ipcMain.handle("youtube:clearJob", (_event, id: string): DownloadJob[] =>
    clearJob(id)
  );

  ipcMain.handle("youtube:cancelJob", (_event, id: string): DownloadJob[] =>
    cancelJob(id)
  );

  ipcMain.handle("youtube:clearCompletedJobs", (): DownloadJob[] =>
    clearCompletedJobs()
  );

  ipcMain.handle("youtube:resetSession", () => resetYouTubeBrowserSession());

  ipcMain.handle("youtubeMusic:getConfig", () => getYouTubeMusicConfig());

  ipcMain.handle(
    "youtubeMusic:saveConfig",
    (_event, config: YouTubeMusicConfig) => saveYouTubeMusicConfig(config)
  );

  ipcMain.handle("youtubeMusic:getStatus", () => getYouTubeMusicStatus());

  ipcMain.handle("youtubeMusic:saveAuth", (_event, headersRaw: string) =>
    saveYouTubeMusicAuth(headersRaw)
  );

  ipcMain.handle("youtubeMusic:login", () => loginYouTubeMusic());

  ipcMain.handle("youtubeMusic:resetBrowserSession", () =>
    resetYouTubeMusicBrowserSession()
  );

  ipcMain.handle("youtubeMusic:logout", () => logoutYouTubeMusic());

  ipcMain.handle("youtubeMusic:listLibrary", () => listYouTubeMusicLibrary());

  ipcMain.handle("youtubeMusic:syncLibrary", () => syncYouTubeMusicLibrary());

  ipcMain.handle("chat:getAuthStatus", () => getChatAuthStatus());

  ipcMain.handle("chat:getSettings", () => getChatSettingsForWindow());

  ipcMain.handle("chat:getBaseCoachInstructions", () =>
    buildBaseCoachInstructions()
  );

  ipcMain.handle("chat:saveSettings", (_event, settings: ChatSettings) =>
    saveChatSettings(settings)
  );

  ipcMain.handle("chat:testLocalConnection", (_event, config?: LocalChatConfig) =>
    testLocalChatConnection(config)
  );

  ipcMain.handle("chat:detectLocalServers", (_event, apiKey?: string) =>
    detectLocalChatServers(apiKey)
  );

  ipcMain.handle(
    "chat:testOpenRouterConnection",
    (_event, config?: OpenRouterConfig) => testOpenRouterConnection(config)
  );

  ipcMain.handle("chat:openOpenRouterKeys", () =>
    shell.openExternal(OPENROUTER_KEYS_URL)
  );

  ipcMain.handle("chat:openOpenRouterModels", () =>
    shell.openExternal(OPENROUTER_MODELS_URL)
  );

  ipcMain.handle("chat:listModels", (_event, provider: ChatProvider) =>
    listChatModelOptions(provider)
  );

  ipcMain.handle("chat:getClaudeCodeStatus", () =>
    getClaudeCodeConnectionStatus()
  );

  ipcMain.handle("chat:connectClaudeCode", () => connectClaudeCode());

  ipcMain.handle("chat:testClaudeCodeConnection", () =>
    testClaudeCodeConnection()
  );

  ipcMain.handle("chat:openClaudeCodeSetupGuide", () =>
    shell.openExternal("https://code.claude.com/docs/en/quickstart")
  );

  ipcMain.handle("chat:getGeminiCliStatus", () =>
    getGeminiCliConnectionStatus()
  );

  ipcMain.handle("chat:recheckGeminiCli", () =>
    recheckGeminiCliConnectionStatus()
  );

  ipcMain.handle("chat:connectGeminiCli", () => connectGeminiCli());

  ipcMain.handle("chat:testGeminiCliConnection", () =>
    testGeminiCliConnection()
  );

  ipcMain.handle("chat:openGeminiCliSetupGuide", (_event, topic: unknown) =>
    shell.openExternal(
      topic === "install"
        ? "https://geminicli.com/docs/get-started/installation/"
        : "https://geminicli.com/docs/get-started/authentication/"
    )
  );

  ipcMain.handle("chat:getAntigravityStatus", () => getAntigravityConnectionStatus());

  ipcMain.handle("chat:installAntigravity", () => installAntigravity());

  ipcMain.handle("chat:removeAntigravity", () => removeAntigravity());

  ipcMain.handle("chat:connectAntigravity", () => connectAntigravity());

  ipcMain.handle("chat:disconnectAntigravity", () => disconnectAntigravity());

  ipcMain.handle("chat:testAntigravityConnection", () => testAntigravity());

  ipcMain.handle("chat:openAntigravityGuide", () =>
    shell.openExternal("https://antigravity.google/docs/plans")
  );

  ipcMain.handle("chat:login", () => loginChat(mainWindow));

  ipcMain.handle("chat:logout", () => logoutChat());

  // Kicks off streaming; assistant text is pushed via chat:stream* events.
  // Coach conversations use coach:send instead, which the hub owns.
  ipcMain.handle(
    "chat:send",
    (event, requestId: string, messages: ChatMessage[], unitSystem?: UnitSystem) =>
      streamChat(
        windowChatSink(BrowserWindow.fromWebContents(event.sender) ?? mainWindow),
        requestId,
        messages,
        normalizeUnitSystem(unitSystem)
      )
  );

  ipcMain.handle("chat:cancel", (_event, requestId: string) =>
    cancelChat(requestId)
  );

  ipcMain.handle("chat:listSessions", (_event, provider: ChatProvider) =>
    listChatSessionsForProvider(provider)
  );

  ipcMain.handle("chat:getSession", (_event, sessionId: string) =>
    getChatSessionEntries(sessionId)
  );

  ipcMain.handle("chat:createSession", (_event, provider: ChatProvider) =>
    createChatSessionForProvider(provider)
  );

  ipcMain.handle(
    "chat:saveSession",
    (_event, sessionId: string, entries: PersistedChatEntry[]) => {
      const summary = saveChatSessionEntries(sessionId, entries);
      coachHub?.invalidate(sessionId);
      return summary;
    }
  );

  ipcMain.handle("chat:deleteSession", (_event, sessionId: string) => {
    if (coachHub) coachHub.deleteSession(sessionId);
    else deleteChatSessionById(sessionId);
  });

  // ----- Coach hub: the window is one client among equals -----
  // One live subscription per window: the conversation it shows.
  const coachSubscriptions = new Map<number, { sessionId: string; unsubscribe: () => void }>();
  const dropCoachSubscription = (contentsId: number) => {
    coachSubscriptions.get(contentsId)?.unsubscribe();
    coachSubscriptions.delete(contentsId);
  };
  const watchedCoachClients = new Set<number>();
  requireCoachHub().onSessionsChanged((change) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("coach:sessions", change);
  });
  ipcMain.handle("coach:listSessions", (_event, provider?: ChatProvider) =>
    requireCoachHub().listSessions(provider)
  );
  ipcMain.handle("coach:getSession", (_event, sessionId: string) =>
    requireCoachHub().getSession(sessionId)
  );
  ipcMain.handle("coach:createSession", (_event, provider: ChatProvider) =>
    requireCoachHub().createSession(provider)
  );
  ipcMain.handle("coach:deleteSession", (_event, sessionId: string) => {
    requireCoachHub().deleteSession(sessionId);
  });
  ipcMain.handle("coach:deleteAllSessions", (_event, provider: ChatProvider) =>
    requireCoachHub().deleteAllSessions(provider)
  );
  ipcMain.handle("coach:subscribe", (event, sessionId: string, afterSeq: number) => {
    const contents = event.sender;
    dropCoachSubscription(contents.id);
    const subscription = requireCoachHub().subscribe(sessionId, afterSeq, (frame) => {
      if (!contents.isDestroyed()) contents.send("coach:event", frame);
    });
    coachSubscriptions.set(contents.id, { sessionId, unsubscribe: subscription.unsubscribe });
    if (!watchedCoachClients.has(contents.id)) {
      watchedCoachClients.add(contents.id);
      const contentsId = contents.id;
      contents.once("destroyed", () => {
        watchedCoachClients.delete(contentsId);
        dropCoachSubscription(contentsId);
      });
    }
    return { response: subscription.response, replay: subscription.replay };
  });
  ipcMain.handle("coach:unsubscribe", (event, sessionId: string) => {
    if (coachSubscriptions.get(event.sender.id)?.sessionId === sessionId) {
      dropCoachSubscription(event.sender.id);
    }
  });
  ipcMain.handle(
    "coach:send",
    async (event, input: CoachSendInput & { uploads?: CoachFileUpload[] }) => {
      // Files come only as uploads from the main window, stored before the hub
      // sees them; a `files` list the window made up is dropped.
      const { uploads, files: _ignored, ...message } = input;
      const files: ChatFileAttachment[] = [];
      if (Array.isArray(uploads) && uploads.length > 0) {
        mainWindowSender(event, "Coach attachments");
        if (uploads.length > MAX_COACH_UPLOADS_PER_MESSAGE) {
          throw new Error(`Attach up to ${MAX_COACH_UPLOADS_PER_MESSAGE} files at a time.`);
        }
        try {
          for (const upload of uploads) {
            files.push(await coachAttachments().save(message.sessionId, upload));
          }
        } catch (error) {
          await coachAttachments().remove(message.sessionId, files.map((file) => file.id));
          if (error instanceof CoachAttachmentError) throw new Error(error.message);
          throw error;
        }
      }
      try {
        return requireCoachHub().send({
          ...message,
          ...(files.length ? { files } : {}),
          unitSystem: message.unitSystem ? normalizeUnitSystem(message.unitSystem) : undefined
        });
      } catch (error) {
        if (files.length) {
          await coachAttachments().remove(message.sessionId, files.map((file) => file.id));
        }
        throw error;
      }
    }
  );
  ipcMain.handle("coach:attachmentPreview", (_event, sessionId: string, attachmentId: string) =>
    coachAttachments().preview(String(sessionId), String(attachmentId)).catch(() => null)
  );
  ipcMain.handle("coach:openAttachment", async (event, sessionId: string, attachmentId: string) => {
    mainWindowSender(event, "Coach attachments");
    const file = await coachAttachments()
      .originalPath(String(sessionId), String(attachmentId))
      .catch(() => null);
    if (!file) throw new Error("This file is no longer available.");
    const failure = await shell.openPath(file);
    if (failure) throw new Error(failure);
  });
  ipcMain.handle("coach:cancel", (_event, sessionId: string) =>
    requireCoachHub().cancel(sessionId)
  );
  // Approvals from the desktop come only from its own window; remote clients
  // reach the hub with their grant's permissions instead (CoachActor).
  ipcMain.handle("coach:confirm", (event, input: CoachConfirmInput) => {
    mainWindowSender(event, "Coach approvals");
    // Plans and deletes are served locally in Local-Only Mode; COROS actions and strength edits would write to COROS.
    if (networkPolicy.enforcing && input?.decision === "confirm" && (input.kind === "corosAction" || input.kind === "strengthEdit")) {
      throw new LocalOnlyFeatureError("Saving Coach changes to COROS");
    }
    return requireCoachHub().confirm({
      ...input,
      options: input.options
        ? {
            ...input.options,
            unitSystem: input.options.unitSystem ? normalizeUnitSystem(input.options.unitSystem) : undefined
          }
        : undefined
    });
  });
  ipcMain.handle(
    "coach:beginLocalTurn",
    (event, sessionId: string, clientMessageId: string, text: string) => {
      mainWindowSender(event, "Coach file exports");
      return requireCoachHub().beginLocalTurn(sessionId, clientMessageId, text);
    }
  );
  ipcMain.handle(
    "coach:finishLocalTurn",
    (event, sessionId: string, requestId: string, reply: string) => {
      mainWindowSender(event, "Coach file exports");
      requireCoachHub().finishLocalTurn(sessionId, requestId, reply);
    }
  );

  // Remote access: only the main window manages devices (access:write).
  requireRemoteAccess().onStatus((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("remote:status", status);
  });
  ipcMain.handle("remote:getStatus", (event) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().status();
  });
  ipcMain.handle("remote:setNetworkAccess", (event, enabled: unknown) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().setNetworkAccess(enabled === true);
  });
  ipcMain.handle("remote:setKeepAwake", (event, enabled: unknown) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().setKeepAwake(enabled === true);
  });
  ipcMain.handle("remote:createPairing", (event, input?: { viewOnly?: unknown }) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().createPairing({ viewOnly: input?.viewOnly === true });
  });
  ipcMain.handle("remote:cancelPairing", (event, id?: unknown) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().cancelPairing(typeof id === "string" ? id : undefined);
  });
  ipcMain.handle("remote:revokeDevice", (event, id: unknown) => {
    mainWindowSender(event, "Remote access");
    if (typeof id !== "string") throw new Error("Choose a device to remove.");
    return requireRemoteAccess().revokeDevice(id);
  });
  // Away from home: website sign-in, the relay link and Cloudflare's connector.
  ipcMain.handle("remote:cloudSignIn", (event) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().cloudSignIn();
  });
  ipcMain.handle("remote:cloudCancelSignIn", (event) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().cloudCancelSignIn();
  });
  ipcMain.handle("remote:cloudSignOut", (event) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().cloudSignOut();
  });
  ipcMain.handle("remote:setCloudLink", (event, input?: { enabled?: unknown; allowDownload?: unknown }) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().setCloudLink(input?.enabled === true, { allowDownload: input?.allowDownload === true });
  });
  ipcMain.handle("remote:cloudUnlink", (event) => {
    mainWindowSender(event, "Remote access");
    return requireRemoteAccess().cloudUnlink();
  });

  ipcMain.handle("chatMcp:getStatus", () => getCorosMcpStatus());

  ipcMain.handle("chatMcp:connect", () => connectCorosMcp(mainWindow));

  ipcMain.handle("chatMcp:disconnect", () => disconnectCorosMcp());

  ipcMain.handle("chatMcp:listTools", () => listCorosMcpTools());

  // Generic MCP server registry.
  ipcMain.handle("mcp:listServers", () => listMcpServers());
  ipcMain.handle("mcp:addServer", (_event, input) => addMcpServer(input));
  ipcMain.handle("mcp:updateServer", async (_event, id: string, patch) => {
    const existing = getMcpServer(id);
    if (!existing) {
      throw new Error(`Unknown MCP server "${id}".`);
    }
    const updated = updateMcpServer(id, patch);
    const connectionChanged =
      updated.url !== existing.url ||
      updated.transport !== existing.transport ||
      updated.authType !== existing.authType ||
      updated.scope !== existing.scope;
    if (!updated.enabled || connectionChanged) {
      await disconnectMcpServer(id, {
        clearAuthorization: connectionChanged
      });
    }
    return updated;
  });
  ipcMain.handle("mcp:removeServer", async (_event, id: string) => {
    const existing = getMcpServer(id);
    if (!existing) return;
    await disconnectMcpServer(id);
    removeMcpServer(id);
  });
  ipcMain.handle("mcp:connect", (_event, id: string) =>
    connectMcpServerWithCorosAccount(id, true, mainWindow)
  );
  ipcMain.handle("mcp:corosAccount", () => getCorosMcpAccount());
  ipcMain.handle("mcp:disconnect", async (_event, id: string) => {
    const server = getMcpServer(id);
    await disconnectMcpServer(id);
    if (server?.authType === "none") {
      updateMcpServer(id, { enabled: false });
    }
  });
  ipcMain.handle("mcp:statuses", () => getMcpStatuses());
  ipcMain.handle("mcp:setBearer", async (_event, id: string, token: string) => {
    setMcpBearer(id, token);
    await disconnectMcpServer(id, { clearAuthorization: false });
  });

  ipcMain.handle("chat:uploadPlanDraft", (_event, draftId: string, unitSystem?: UnitSystem, destination?: import("./types").TrainingPlanDestination, scheduleDate?: string) =>
    uploadTrainingPlanDraft(
      draftId,
      normalizeUnitSystem(unitSystem),
      destination,
      scheduleDate
    )
  );

  ipcMain.handle("chat:confirmCorosAction", (_event, requestId: string) => confirmCoachCorosAction(requestId));
  ipcMain.handle("chat:confirmWorkoutDelete", (_event, requestId: string) =>
    confirmWorkoutDelete(requestId)
  );

  ipcMain.handle("coachCharts:list", () => listPinnedCoachCharts());
  ipcMain.handle("coachCharts:pin", (_event, preview: CoachChartPreview) =>
    pinCoachChart(preview)
  );
  ipcMain.handle("coachCharts:unpin", (_event, id: string) => unpinCoachChart(id));
  ipcMain.handle("coachCharts:refresh", (_event, id: string) =>
    refreshPinnedCoachChart(id)
  );

  ipcMain.handle(
    "trainingHub:uploadTrainingPlan",
    (_event, draft: CorosTrainingPlanDraftInput, unitSystem?: UnitSystem) =>
      uploadTrainingPlan(draft, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle("appleMusic:getStatus", () => getAppleMusicStatus());

  ipcMain.handle("appleMusic:saveAuth", (_event, headersRaw: string) =>
    saveAppleMusicAuth(headersRaw)
  );

  ipcMain.handle("appleMusic:logout", () => logoutAppleMusic());

  ipcMain.handle("appleMusic:resetBrowserSession", () =>
    resetAppleMusicBrowserSession()
  );

  ipcMain.handle("appleMusic:listPlaylists", () => listAppleMusicPlaylists());

  ipcMain.handle("appleMusic:fetchPlaylist", (_event, playlist: string) =>
    fetchAppleMusicPlaylist(playlist)
  );

  ipcMain.handle("applePodcasts:search", (_event, query: string) =>
    searchApplePodcasts(query)
  );

  ipcMain.handle("applePodcasts:load", (_event, showIdOrUrl: string, offset?: number) =>
    loadApplePodcast(showIdOrUrl, offset)
  );

  ipcMain.handle("spotify:getConfig", () => getSpotifyConfig());

  ipcMain.handle("spotify:saveConfig", (_event, config: SpotifyConfig) =>
    saveSpotifyConfig(config)
  );

  ipcMain.handle("spotify:getStatus", () => getSpotifyStatus());

  ipcMain.handle("spotify:login", () => loginSpotify(mainWindow));

  ipcMain.handle("spotify:logout", () => logoutSpotify());

  ipcMain.handle("spotify:unlockFollowed", () =>
    unlockSpotifyFollowedPlaylists(mainWindow)
  );

  ipcMain.handle("spotify:lockFollowed", () => lockSpotifyFollowedPlaylists());

  ipcMain.handle("spotify:listPlaylists", () => listSpotifyPlaylists());

  ipcMain.handle("spotify:listPlaylistTracks", (_event, playlistId: string) =>
    listSpotifyPlaylistTracks(playlistId)
  );

  ipcMain.handle("spotify:listSyncState", (_event, playlistId: string) =>
    listSpotifySyncState(playlistId)
  );

  ipcMain.handle(
    "spotify:syncPlaylist",
    (event, playlistId: string, autoTransfer: boolean) =>
      syncSpotifyPlaylist(playlistId, autoTransfer, (update) => {
        event.sender.send("spotify:syncUpdate", update);
      })
  );

  ipcMain.handle("trainingHub:getStatus", () => {
    // A stored token isn't proof COROS still honours it; the answer arrives as trainingHub:sessionChange.
    void checkTrainingHubSession();
    return getTrainingHubStatus();
  });

  ipcMain.handle(
    "trainingHub:login",
    (_event, email: string, password: string, remember?: boolean) => {
      // The backup preview caches one account's listing.
      clearActivityBackupPreview();
      return loginTrainingHub(email, password, remember);
    }
  );

  ipcMain.handle("trainingHub:verify2fa", (_event, code: string) =>
    verifyTrainingHubTwoFactor(code)
  );

  ipcMain.handle("trainingHub:resend2fa", () =>
    resendTrainingHubTwoFactorCode()
  );

  ipcMain.handle("trainingHub:cancel2fa", () =>
    cancelTrainingHubTwoFactor()
  );

  ipcMain.handle("trainingHub:logout", () => {
    clearActivityBackupPreview();
    return logoutTrainingHub();
  });

  ipcMain.handle("trainingHub:reconnect", () => reconnectTrainingHub());

  ipcMain.handle(
    "trainingHub:listActivities",
    (_event, page: number, size: number, startDay?: string, endDay?: string) =>
      currentActivitySource().listActivities(page, size, startDay, endDay)
  );

  ipcMain.handle(
    "trainingHub:listScheduledWorkouts",
    (_event, startDay: string, endDay: string) =>
      listCalendarWorkoutEntries(startDay, endDay)
  );

  ipcMain.handle("trainingHub:listLibraryWorkouts", () =>
    listLibraryWorkouts()
  );
  ipcMain.handle(
    "trainingHub:duplicateLibraryWorkout",
    (_event, programId: string, name: string, targetSportType?: number) =>
      duplicateLibraryWorkout(programId, name, targetSportType)
  );

  ipcMain.handle("trainingLibrary:snapshot", () =>
    getTrainingLibrarySnapshot()
  );
  ipcMain.handle("trainingLibrary:getNativePlan", (_event, remoteId: string) =>
    getNativeTrainingPlan(remoteId)
  );
  ipcMain.handle("trainingLibrary:savePlan", (_event, plan) =>
    saveLocalTrainingPlan(plan)
  );
  ipcMain.handle("trainingLibrary:updatePlanMetadata", (_event, id, patch) =>
    updateTrainingPlanMetadata(id, patch)
  );
  ipcMain.handle(
    "trainingLibrary:deletePlan",
    (_event, id: string, confirmed: boolean) => deleteLocalTrainingPlanAndCalendar(id, confirmed)
  );
  ipcMain.handle(
    "trainingLibrary:deleteCorosPlan",
    (_event, remoteId: string, confirmed: boolean) =>
      deleteCorosTrainingPlan(remoteId, confirmed)
  );
  ipcMain.handle(
    "trainingLibrary:previewPlanCalendar",
    (_event, planId: string, startDate: string, fromDate?: string) => previewTrainingPlanCalendar(planId, startDate, fromDate)
  );
  ipcMain.handle(
    "trainingLibrary:addPlanToCalendar",
    (_event, previewId: string, confirmed: boolean, unitSystem?: UnitSystem) =>
      addTrainingPlanToCalendar(previewId, confirmed, normalizeUnitSystem(unitSystem))
  );
  ipcMain.handle(
    "trainingLibrary:previewPlanCalendarRemoval",
    (_event, planId: string) => previewTrainingPlanCalendarRemoval(planId)
  );
  ipcMain.handle(
    "trainingLibrary:removePlanFromCalendar",
    (_event, previewId: string, confirmed: boolean) => removeTrainingPlanFromCalendar(previewId, confirmed)
  );
  ipcMain.handle(
    "trainingLibrary:updateWorkoutMetadata",
    (_event, programIds, patch) => updateWorkoutMetadata(programIds, patch)
  );
  ipcMain.handle("trainingLibrary:saveCollection", (_event, collection) =>
    upsertTrainingCollection(collection)
  );
  ipcMain.handle(
    "trainingLibrary:deleteCollection",
    (_event, id: string, confirmed: boolean) => removeTrainingCollection(id, confirmed)
  );
  ipcMain.handle("trainingLibrary:deleteWorkouts", (_event, request) =>
    deleteTrainingLibraryWorkouts(request)
  );
  ipcMain.handle(
    "trainingLibrary:refreshMatches",
    (_event, startDay: string, endDay: string) =>
      refreshTrainingActivityMatches(startDay, endDay)
  );
  ipcMain.handle("trainingLibrary:saveManualMatch", (_event, match) =>
    saveManualActivityMatch(match)
  );
  ipcMain.handle(
    "trainingLibrary:listManualLinks",
    (_event, startDay: string, endDay: string) => listManualActivityLinks(startDay, endDay)
  );
  ipcMain.handle("trainingLibrary:saveManualLink", (_event, entry, activity) =>
    saveManualActivityLink(entry, activity)
  );
  ipcMain.handle(
    "trainingLibrary:clearManualLink",
    (_event, planId: string, idInPlan: string) => clearManualActivityLink(planId, idInPlan)
  );

  ipcMain.handle(
    "trainingHub:listWorkoutExercises",
    (_event, sport: WorkoutSport) => listWorkoutExercises(sport)
  );

  ipcMain.handle("trainingHub:getWorkoutEditorContext", (_event, unitSystem?: UnitSystem) =>
    getWorkoutEditorContext(normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:getWorkoutForEdit",
    (_event, ref: WorkoutEditRef, unitSystem?: UnitSystem) =>
      getWorkoutForEdit(ref, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:previewWorkoutEdit",
    (
      _event,
      ref: WorkoutEditRef,
      revision: string,
      draft: RunWorkoutEditorDraft,
      unitSystem?: UnitSystem
    ) => previewWorkoutEdit(ref, revision, draft, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:saveWorkoutEdit",
    (
      _event,
      ref: WorkoutEditRef,
      revision: string,
      draft: RunWorkoutEditorDraft,
      unitSystem?: UnitSystem
    ) => saveWorkoutEdit(ref, revision, draft, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:scheduleLibraryWorkout",
    (_event, programId: string, happenDay: string) =>
      scheduleLibraryWorkout(programId, happenDay)
  );

  ipcMain.handle(
    "trainingHub:createAndScheduleWorkout",
    (
      _event,
      entry: PlanWorkoutEntryInput,
      happenDay: string,
      unitSystem?: UnitSystem | boolean,
      saveToLibrary?: boolean
    ) =>
      createAndScheduleWorkout(
        entry,
        happenDay,
        typeof unitSystem === "boolean"
          ? unitSystem
          : normalizeUnitSystem(unitSystem),
        saveToLibrary
      )
  );

  ipcMain.handle(
    "trainingHub:createLibraryWorkout",
    (_event, entry: PlanWorkoutEntryInput, unitSystem?: UnitSystem) =>
      createLibraryWorkout(entry, normalizeUnitSystem(unitSystem))
  );

  ipcMain.handle(
    "trainingHub:rescheduleWorkout",
    (
      _event,
      entry: {
        planId: string;
        idInPlan: string;
        planProgramId?: string;
        happenDay: string;
      },
      newHappenDay: string
    ) => rescheduleWorkoutWithNotes(entry, newHappenDay)
  );

  ipcMain.handle(
    "trainingHub:copyScheduledWorkout",
    (
      _event,
      entry: { planId: string; idInPlan: string; happenDay: string; rawProgram?: Record<string, unknown> },
      newHappenDay: string
    ) => copyScheduledWorkout(entry, newHappenDay)
  );

  ipcMain.handle(
    "trainingHub:removeScheduledWorkout",
    (
      _event,
      entry: {
        planId: string;
        idInPlan: string;
        planProgramId?: string;
        pbVersion?: number;
      }
    ) => removeScheduledWorkout(entry)
  );

  ipcMain.handle(
    "trainingHub:getActivityDetail",
    (
      _event,
      activityId: string,
      sportType: number,
      listActivity?: TrainingHubActivity
    ) => currentActivitySource().getActivityDetail(activityId, sportType, listActivity)
  );

  // Every open view (Activities, Calendar, Overview) hears the new name.
  ipcMain.handle(
    "trainingHub:renameActivity",
    async (_event, activityId: string, name: string, startTime?: number): Promise<string> => {
      const saved = await currentActivitySource().renameActivity(activityId, name, startTime);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("trainingHub:activityRenamed", { activityId, name: saved });
      }
      return saved;
    }
  );

  ipcMain.handle(
    "trainingHub:exportActivityFile",
    async (
      _event,
      activityId: string,
      sportType: number,
      fileType: TrainingHubActivityFileType,
      suggestedName?: string
    ): Promise<TrainingHubExportResult> => {
      return exportTrainingHubActivityFileToDisk(
        { activityId, sportType },
        fileType,
        suggestedName
      );
    }
  );

  ipcMain.handle(
    "trainingHub:exportLatestActivityFile",
    async (
      _event,
      fileType: TrainingHubActivityFileType = 4
    ): Promise<TrainingHubExportResult> => {
      const latest = pickLatestTrainingHubActivity(
        await currentActivitySource().listActivities(1, 50)
      );
      if (!latest) {
        throw new Error(usingLocalSources() ? "No activities are stored on this computer yet." : "No COROS activities were found to export.");
      }
      return exportTrainingHubActivityFileToDisk(latest, fileType, latest.name);
    }
  );

  ipcMain.handle("trainingHub:chooseBackupFolder", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose a backup folder",
      properties: ["openDirectory", "createDirectory"]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options))
        : await dialog.showOpenDialog(localizeDialogOptions(options));
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "trainingHub:startActivityBackup",
    (
      _event,
      folder: string,
      fileType: TrainingHubActivityFileType = 4,
      filters?: unknown
    ) =>
      startActivityBackup(
        folder,
        fileType,
        normalizeActivityBackupFilters(filters)
      )
  );

  ipcMain.handle(
    "trainingHub:previewActivityBackup",
    (_event, filters?: unknown) =>
      previewActivityBackup(normalizeActivityBackupFilters(filters))
  );

  ipcMain.handle("trainingHub:cancelActivityBackup", () =>
    cancelActivityBackup()
  );

  ipcMain.handle("fitIndex:getStatus", () => getFitIndexStatus());
  ipcMain.handle("fitIndex:startSync", (_event, options?: FitIndexSyncOptions) =>
    startFitIndexSync(options ?? {})
  );
  ipcMain.handle("fitIndex:cancelSync", () => cancelFitIndexSync());

  ipcMain.handle("trainingHub:getActivityBackupProgress", () =>
    getActivityBackupProgress()
  );

  ipcMain.handle("trainingHub:getTrainingAnalytics", () =>
    getTrainingAnalytics()
  );

  ipcMain.handle("trainingHub:getRacePredictor", () => getRacePredictor());

  ipcMain.handle("trainingHub:startRpeBackfill", () => {
    void backfillFeelTypes();
  });
  ipcMain.handle("trainingHub:getRpeBackfillStatus", () =>
    getRpeBackfillStatus()
  );
  ipcMain.handle("trainingHub:getRpeLoadByDay", () => getRpeLoadByDay());

  ipcMain.handle("trainingHub:getDashboard", () => getTrainingDashboard());

  ipcMain.handle("trainingHub:getDailyMetrics", (_event, dateList: string[]) =>
    currentHealthSource().getDailyMetrics(dateList)
  );

  ipcMain.handle(
    "trainingHub:syncStrengthHistory",
    (_event, request?: StrengthHistoryRequest) => syncStrengthHistory(request)
  );

  ipcMain.handle("hevy:getStatus", () => getHevyStatus());
  ipcMain.handle("hevy:connect", (_event, apiKey: string) => connectHevy(apiKey));
  ipcMain.handle("hevy:updateSettings", (_event, input: HevySettingsInput) =>
    updateHevySettings(input)
  );
  ipcMain.handle("hevy:disconnect", () => disconnectHevy());

  ipcMain.handle("strava:getStatus", () => getStravaStatus());
  ipcMain.handle("strava:saveConfig", (_event, input: StravaConfigInput) =>
    saveStravaConfig(input)
  );
  ipcMain.handle("strava:connect", () => connectStrava());
  ipcMain.handle("strava:cancelConnect", () => cancelStravaConnect());
  ipcMain.handle("strava:disconnect", async () => {
    await disconnectStrava();
    clearStravaRaceData();
  });

  ipcMain.handle("workoutJournal:list", (_event, startDay: string, endDay: string) =>
    listWorkoutJournal(startDay, endDay)
  );
  ipcMain.handle("workoutJournal:save", (_event, input: WorkoutJournalSaveInput) =>
    saveWorkoutJournal(input, "athlete")
  );
  onWorkoutJournalChanged(() => {
    mainWindow?.webContents.send("workoutJournal:changed");
  });
  onCoachActivityRenamed((change) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("trainingHub:activityRenamed", change);
  });

  ipcMain.handle("races:getOverview", () => getRaceOverview());
  ipcMain.handle("races:listActivityIds", () => listRaceActivityIds());
  ipcMain.handle("races:markActivity", (_event, activity: TrainingHubActivity) =>
    markActivityAsRace(activity)
  );
  ipcMain.handle("races:unmarkActivity", (_event, activityId: string) =>
    unmarkActivityAsRace(activityId)
  );
  ipcMain.handle("races:dismissSuggestion", (_event, activityId: string) =>
    dismissRaceSuggestion(activityId)
  );
  ipcMain.handle("races:update", (_event, input: RaceEditInput) => updateRace(input));
  ipcMain.handle("races:remove", (_event, raceId: string) => removeRace(raceId));
  ipcMain.handle("races:addManual", (_event, input: ManualRaceInput) => addManualRace(input));
  ipcMain.handle("races:importStrava", (_event, full?: boolean) =>
    importStravaRaces(full === true)
  );

  ipcMain.handle("trainingHub:getSportTypeMap", () => getSportTypeMap());

  ipcMain.handle("trainingHub:getActivityPaceBaselines", async () =>
    usingLocalSources()
      ? getActivityPaceBaselines({ activities: await currentActivitySource().listActivities(1, 1000) })
      : getActivityPaceBaselines()
  );

  ipcMain.handle("trainingHub:getUpcomingWorkouts", (_event, days?: number) =>
    getUpcomingWorkouts(days)
  );

  ipcMain.handle("trainingHub:getSleepData", (_event, days?: number) =>
    currentHealthSource().getSleep(days ?? 7)
  );

  ipcMain.handle("trainingHub:getHealthInsight", (_event, kind: HealthInsightKind, days?: number) =>
    currentHealthSource().getInsight(kind, days ?? 7)
  );

  ipcMain.handle("trainingHub:getDailyHealthData", (_event, days?: number) =>
    currentHealthSource().getDailyHealth(days ?? 1)
  );

  ipcMain.handle("intervals:getStatus", () => getIntervalsStatus());

  ipcMain.handle("intervals:connect", (_event, apiKey: string, athleteId: string) =>
    connectIntervals(apiKey, athleteId)
  );

  ipcMain.handle("intervals:disconnect", () => disconnectIntervals());

  ipcMain.handle(
    "intervals:listMissing",
    async (_event, daysBack: number): Promise<IntervalsActivityWithStatus[]> => {
      const intervals = await listIntervalsActivities(daysBack);
      // Pull enough COROS activities to cover the SAME daysBack window used for
      // the intervals.icu query, not just the newest 200 — otherwise older
      // activities fall outside the compare set and are falsely reported as
      // "Missing". listTrainingHubActivities filters on startDay/endDay
      // (YYYYMMDD) and pages at `size` per call with no total count, so we
      // page through the window until a short page signals the end.
      // listIntervalsActivities computes its from/to bound in UTC
      // (toISOString), while formatYyyymmddDay/formatScheduleDay use local
      // calendar days (matching the COROS endpoint's convention). Pad the
      // COROS window by one extra day on each side so local/UTC boundary
      // drift can only widen the compare set (superset), never narrow it —
      // a superset can't cause a false "Missing".
      const toDay = formatYyyymmddDay(new Date(Date.now() + 86_400_000));
      const fromDay = formatYyyymmddDay(
        new Date(Date.now() - (daysBack + 1) * 86_400_000)
      );
      const corosRaw: TrainingHubActivity[] = [];
      const INTERVALS_MATCH_PAGE_SIZE = 100;
      const INTERVALS_MATCH_MAX_PAGES = 50;
      for (let page = 1; page <= INTERVALS_MATCH_MAX_PAGES; page += 1) {
        const pageActivities = await listTrainingHubActivities(
          page,
          INTERVALS_MATCH_PAGE_SIZE,
          fromDay,
          toDay
        );
        corosRaw.push(...pageActivities);
        if (pageActivities.length < INTERVALS_MATCH_PAGE_SIZE) {
          break;
        }
      }
      const coros = corosRaw.map((a) => ({
        startEpochMs: (a.startTime ?? 0) * 1000,
        movingSec: a.duration ?? 0,
        distanceM: a.distance ?? 0
      }));
      const recentlyImported = getRecentlyImportedIds(RECENT_IMPORT_WINDOW_MS);
      return intervals.map((a) => ({
        ...a,
        onCoros:
          isAlreadyOnCoros(
            {
              startEpochMs: a.startEpochMs,
              movingSec: a.movingSec,
              distanceM: a.distanceM
            },
            coros
          ) || recentlyImported.has(a.intervalsId)
      }));
    }
  );

  ipcMain.handle(
    "intervals:import",
    async (
      _event,
      intervalsId: string,
      fileExt: "fit" | "tcx" | "unknown"
    ): Promise<{ importId: string }> => {
      const tmpExt = fileExt === "tcx" ? "tcx" : "fit";
      const tmp = path.join(
        os.tmpdir(),
        `coroslink-intervals-${intervalsId}.${tmpExt}`
      );
      try {
        await downloadIntervalsFit(intervalsId, tmp);
        const result = await uploadActivityFitToCoros(tmp);
        recordIntervalsImport(intervalsId);
        return result;
      } finally {
        try {
          fs.rmSync(tmp);
        } catch {
          /* best effort */
        }
      }
    }
  );

  ipcMain.handle(
    "coros:addManualActivity",
    async (_event, input: ManualActivityInput): Promise<{ importId: string }> => {
      if (!Number.isFinite(input.durationSec) || !(input.durationSec > 0)) {
        throw new Error("Duration must be a finite number greater than 0.");
      }
      if (Number.isNaN(Date.parse(input.startTimeIso))) {
        throw new Error("Invalid start time.");
      }
      const toFiniteNonNegative = (value: unknown): number => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      const sanitized: ManualActivityInput = {
        ...input,
        distanceM: toFiniteNonNegative(input.distanceM),
        calories: toFiniteNonNegative(input.calories),
        avgHr:
          input.avgHr != null && Number.isFinite(Number(input.avgHr)) && Number(input.avgHr) > 0
            ? Number(input.avgHr)
            : undefined
      };
      const tcx = buildManualTcx(sanitized);
      const tmp = path.join(
        os.tmpdir(),
        `coroslink-manual-${Date.now()}.tcx`
      );
      fs.writeFileSync(tmp, tcx, "utf8");
      try {
        return await uploadActivityFitToCoros(tmp);
      } finally {
        try {
          fs.rmSync(tmp);
        } catch {
          /* best effort */
        }
      }
    }
  );

  ipcMain.handle("maps:getCorosManifest", () => getCorosMapManifest());

  ipcMain.handle("maps:openCorosDownload", (_event, downloadUrl: string) =>
    openCorosMapDownload(downloadUrl)
  );

  ipcMain.handle("maps:downloadCorosPackage", (_event, pkg: CorosMapPackage) =>
    downloadCorosMapPackage(pkg)
  );

  ipcMain.handle("maps:listCorosMapDownloadJobs", () =>
    listCorosMapDownloadJobs()
  );

  ipcMain.handle("maps:cancelCorosMapDownload", (_event, id: string) =>
    cancelCorosMapDownload(id)
  );

  ipcMain.handle("maps:clearCorosMapDownloadJob", (_event, id: string) =>
    clearCorosMapDownloadJob(id)
  );

  ipcMain.handle("maps:listCachedCorosMaps", () => listCachedCorosMaps());

  ipcMain.handle("maps:getCorosMapInstallProgress", () =>
    getCorosMapInstallProgress()
  );

  ipcMain.handle("maps:cancelCorosMapInstall", () => cancelCorosMapInstall());

  ipcMain.handle("maps:installCachedCorosMap", async (_event, packageId: string) => {
    try {
      return await installCachedCorosMap(packageId);
    } catch (error) {
      throw toCorosMapInstallIpcError(error);
    }
  });

  ipcMain.handle(
    "maps:installCachedCorosMaps",
    async (_event, packageIds: string[]) => {
      try {
        return await installCachedCorosMaps(packageIds);
      } catch (error) {
        throw toCorosMapInstallIpcError(error);
      }
    }
  );

  ipcMain.handle("maps:deleteCachedCorosMap", (_event, packageId: string) =>
    deleteCachedCorosMap(packageId)
  );

  ipcMain.handle("maps:getRouteBuilderConfig", () => getRouteBuilderConfig());

  ipcMain.handle(
    "maps:saveRouteBuilderConfig",
    (_event, config: RouteBuilderConfig) => saveRouteBuilderConfig(config)
  );

  ipcMain.handle("maps:listGeneratedRoutes", (_event, offset?: number) => listGeneratedRoutes(offset));
  ipcMain.handle("maps:getGeneratedRoute", (_event, id: string) => getGeneratedRouteDetails(id));

  ipcMain.handle("maps:geocodeRouteLocation", (_event, query: string) =>
    geocodeRouteLocation(query)
  );

  ipcMain.handle("maps:searchRouteLocations", (_event, query: string) =>
    searchRouteLocations(query)
  );

  ipcMain.handle(
    "maps:reverseGeocodeRouteLocation",
    (_event, lat: number, lon: number) => reverseGeocodeRouteLocation(lat, lon)
  );

  ipcMain.handle("maps:generateRoute", (_event, request: GenerateRouteRequest) =>
    generateRoute(request)
  );

  ipcMain.handle(
    "maps:replaceGeneratedRouteGeometry",
    (_event, id: string, geometry: RouteGeometry) =>
      replaceGeneratedRouteGeometry(id, geometry)
  );

  ipcMain.handle(
    "maps:routeWaypoints",
    (_event, request: RouteWaypointRequest) => routeWaypoints(request)
  );

  ipcMain.handle(
    "maps:importRouteGpx",
    (event, activityType?: RouteActivityType) =>
      importRouteFromGpx(
        activityType,
        BrowserWindow.fromWebContents(event.sender)
      )
  );

  ipcMain.handle("maps:saveDrawnRoute", (_event, payload: DrawnRoutePayload) =>
    saveDrawnRoute(payload)
  );

  ipcMain.handle("maps:exportGeneratedRoute", (_event, id: string) =>
    exportGeneratedRoute(id)
  );

  ipcMain.handle("maps:deleteGeneratedRoute", (_event, id: string) =>
    deleteGeneratedRoute(id)
  );

  ipcMain.handle("maps:deleteAllGeneratedRoutes", () =>
    deleteAllGeneratedRoutes()
  );

  ipcMain.handle("maps:validateRouteApiKey", (_event, apiKey: string) =>
    validateRouteApiKey(apiKey)
  );

  ipcMain.handle("maps:startRouteShare", (_event, id: string) =>
    startRouteShare(id)
  );

  ipcMain.handle("maps:stopRouteShare", () => stopRouteShare());

  ipcMain.handle("app:getUpdateStatus", () => getAppUpdateSnapshot());

  ipcMain.handle("app:checkForUpdates", () => checkForAppUpdates());

  ipcMain.handle("app:downloadUpdate", () => downloadAppUpdate());

  ipcMain.handle(
    "app:setUpdatePreferences",
    (_event, prefs: { autoCheck?: boolean; autoDownload?: boolean }) =>
      setUpdaterPreferences(prefs)
  );

  ipcMain.handle("app:quitAndInstallUpdate", () => quitAndInstallUpdate());

  ipcMain.handle("app:getInfo", () => getAppInfo());

  ipcMain.handle("app:isOnboardingPending", () => isOnboardingPending());

  ipcMain.handle("app:completeOnboarding", () => completeOnboarding());

  ipcMain.handle("app:openStorageLocation", (_event, id: string) =>
    openAppStorageLocation(id)
  );
}

function registerAudiobookIpcHandlers(): void {
  const sendProgress = (progress: AudiobookProgress): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("audiobooks:progress", progress);
    }
  };
  const sendUpdated = (book: Audiobook): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("audiobooks:updated", book);
    }
  };
  const watchTracks = async () => (await getWatchStatus()).tracks;
  // One watch operation at a time across all books. The watch plays files in
  // the order they were copied, so two transfers running together (a double
  // click, or two books) would interleave their parts.
  let watchOperation: { id: string; kind: "transfer" | "remove" } | undefined;
  const withWatchLock = async <T>(
    id: string,
    kind: "transfer" | "remove",
    run: () => Promise<T>
  ): Promise<T> => {
    if (watchOperation) {
      throw new Error(
        watchOperation.kind === "transfer"
          ? "Another audiobook is being copied to the watch. Wait for it to finish."
          : "An audiobook is being removed from the watch. Wait for it to finish."
      );
    }
    watchOperation = { id, kind };
    try {
      return await run();
    } finally {
      watchOperation = undefined;
    }
  };

  ipcMain.handle("audiobooks:list", async () => listAudiobooks(await watchTracks()));

  ipcMain.handle("freeAudiobooks:popular", () => listPopularFreeAudiobooks());

  ipcMain.handle("freeAudiobooks:search", (_event, query: string) =>
    searchFreeAudiobooks(String(query ?? ""))
  );

  ipcMain.handle("freeAudiobooks:load", (_event, identifier: string) =>
    loadFreeAudiobook(String(identifier ?? ""))
  );

  ipcMain.handle(
    "audiobooks:importFree",
    async (_event, identifier: string, split: AudiobookSplitOptions): Promise<Audiobook> => {
      // Re-resolve the recording here: download URLs and checksums come from
      // archive.org, never from the renderer.
      const detail = await loadFreeAudiobook(String(identifier ?? ""));
      const existing = findAudiobookBySource(detail.identifier);
      if (existing) {
        throw new Error(`"${existing.title}" is already in your audiobooks.`);
      }
      return startFreeAudiobookImport(
        detail,
        normalizeSplitOptions(split),
        sendProgress,
        sendUpdated
      );
    }
  );

  // Choosing files only reads them; nothing converts until the renderer
  // confirms the draft with a split.
  ipcMain.handle("audiobooks:chooseFiles", async (): Promise<AudiobookDraft | null> => {
    const options: OpenDialogOptions = {
      title: "Choose an audiobook (select several files to join them)",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audiobook", extensions: AUDIOBOOK_EXTENSIONS }]
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, localizeDialogOptions(options))
        : await dialog.showOpenDialog(localizeDialogOptions(options));
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return prepareAudiobookDraft(result.filePaths);
  });

  ipcMain.handle(
    "audiobooks:convertDraft",
    (_event, draftId: string, split: AudiobookSplitOptions): Audiobook =>
      startAudiobookImportFromDraft(
        String(draftId ?? ""),
        normalizeSplitOptions(split),
        sendProgress,
        sendUpdated
      )
  );

  ipcMain.handle("audiobooks:discardDraft", (_event, draftId: string) =>
    discardAudiobookDraft(String(draftId ?? ""))
  );

  ipcMain.handle("audiobooks:cancel", (_event, id: string) =>
    cancelAudiobookConversion(id)
  );

  ipcMain.handle("audiobooks:delete", async (_event, id: string) => {
    if (watchOperation?.id === id) {
      throw new Error("Wait for the watch to finish before deleting this book.");
    }
    deleteAudiobook(id);
    return listAudiobooks(await watchTracks());
  });

  ipcMain.handle(
    "audiobooks:transfer",
    (_event, id: string): Promise<AudiobookTransferResult> =>
      withWatchLock(id, "transfer", async () => {
        const status = await getWatchStatus();
        if (!status.connected) {
          throw new Error("No COROS watch is connected.");
        }
        const book = getAudiobook(id, status.tracks);
        if (!book || book.status !== "ready") {
          throw new Error("Audiobook is not ready to transfer.");
        }

        const partPaths = getAudiobookPartPaths(id);
        const pending = book.parts
          .map((part, offset) => ({ part, filePath: partPaths[offset] }))
          .filter(({ part }) => !part.onWatch);
        const pendingBytes = pending.reduce((total, { part }) => total + part.sizeBytes, 0);
        if (status.freeBytes !== undefined && pendingBytes > status.freeBytes) {
          throw new Error(
            `Not enough space on the watch: need ${Math.ceil(pendingBytes / 1_048_576)} MB, ` +
              `${Math.floor(status.freeBytes / 1_048_576)} MB free.`
          );
        }

        // The watch plays in transfer order, so copy strictly one part at a
        // time, in part order.
        let copiedBytes = 0;
        for (const [position, { part, filePath }] of pending.entries()) {
          await transferFileToWatch(filePath, (fileProgress) => {
            sendProgress({
              id,
              phase: "transferring",
              progress:
                pendingBytes > 0
                  ? Math.min((copiedBytes + fileProgress.copiedBytes) / pendingBytes, 1)
                  : 1,
              message: `Copying part ${position + 1} of ${pending.length}`
            });
          });
          copiedBytes += part.sizeBytes;
        }

        return {
          copied: pending.length,
          skipped: book.parts.length - pending.length,
          watch: await getWatchStatus()
        };
      })
  );

  ipcMain.handle("audiobooks:removeFromWatch", (_event, id: string) =>
    withWatchLock(id, "remove", async () => {
      const status = await getWatchStatus();
      const book = getAudiobook(id, status.tracks);
      if (!book) {
        throw new Error("Audiobook was not found.");
      }
      for (const track of audiobookPartsOnWatch(book, status.tracks)) {
        await deleteWatchTrack(track.relativePath);
      }
      return getWatchStatus();
    })
  );
}
