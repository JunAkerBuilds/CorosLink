import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteDownload, getDownloadById, initializeDatabase, listDownloads, markDownloadTransferred, clearDownloadTransferredByFileName } from "./database";
import { downloadAudio, getBinaryStatus } from "./downloadService";
import {
  cancelJob,
  clearCompletedJobs,
  clearJob,
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
  loginSpotify,
  logoutSpotify,
  saveSpotifyConfig,
  syncSpotifyPlaylist
} from "./spotifyService";
import {
  cancelActivityBackup,
  getActivityBackupProgress,
  setActivityBackupProgressListener,
  startActivityBackup
} from "./activityBackupService";
import {
  getActivityPaceBaselines,
  getDailyMetrics,
  getRacePredictor,
  getSportTypeMap,
  getTrainingAnalytics,
  getTrainingDashboard,
  fetchTrainingHubActivityFile,
  getTrainingHubActivityDetail,
  getTrainingHubStatus,
  getUpcomingWorkouts,
  listTrainingHubActivities,
  listScheduledWorkoutEntries,
  listLibraryWorkouts,
  scheduleLibraryWorkout,
  createAndScheduleWorkout,
  rescheduleScheduledWorkout,
  removeScheduledWorkout,
  loginTrainingHub,
  logoutTrainingHub,
  reconnectTrainingHub,
  uploadActivityFitToCoros,
  uploadTrainingPlan
} from "./trainingHubService";
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
  chooseCorosMapFolder,
  clearCorosMapDownloadJob,
  deleteCachedCorosMap,
  deleteGeneratedRoute,
  downloadCorosMapPackage,
  exportGeneratedRoute,
  generateRoute,
  geocodeRouteLocation,
  getApproximateRouteLocation,
  getCorosMapInstallProgress,
  getCorosMapManifest,
  getRouteBuilderConfig,
  importRouteFromGpx,
  installCachedCorosMap,
  installCachedCorosMaps,
  installCorosMapFolder,
  listCachedCorosMaps,
  listCorosMapDownloadJobs,
  listGeneratedRoutes,
  openCorosMapDownload,
  openLocationServicesSettings,
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
import type {
  CorosMapPackage,
  DownloadJob,
  DownloadQueueItem,
  DrawnRoutePayload,
  GenerateRouteRequest,
  RouteActivityType,
  RouteBuilderConfig,
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
import {
  deleteWatchTrack,
  getWatchConnectionSmokeOption,
  getWatchStatus,
  setWatchConnectionSmokeOption,
  transferFileToWatch
} from "./watchService";
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
  getChatAuthStatus,
  getChatSessionEntries,
  getChatSettings,
  listChatSessionsForProvider,
  loginChat,
  logoutChat,
  saveChatSessionEntries,
  saveChatSettings,
  streamChat,
  testLocalChatConnection,
  uploadTrainingPlanDraft,
  confirmWorkoutDelete
} from "./chatService";
import {
  hydratePlanDraftStoreFromDatabase,
  pruneDeleteRequestStore,
  prunePlanDraftStore
} from "./chatWorkoutTools";
import {
  connectCorosMcp,
  disconnectCorosMcp,
  ensureCorosMcpConnected,
  getCorosMcpStatus,
  listCorosMcpTools
} from "./corosMcpService";
import { getTrainingDailyHealthData } from "./dailyHealthDataService";
import { getTrainingSleepData } from "./sleepDataService";
import type {
  ChatMessage,
  ChatProvider,
  ChatSettings,
  CorosTrainingPlanDraftInput,
  LocalChatConfig,
  PersistedChatEntry,
  PlanWorkoutEntryInput
} from "./types";

let mainWindow: BrowserWindow | undefined;

/** Matches --bg-base in styles.css; updated when the renderer theme changes. */
const DEFAULT_WINDOW_BACKGROUND = "#05080b";
let currentWindowBackground = DEFAULT_WINDOW_BACKGROUND;

const TRAFFIC_LIGHT_WINDOWED = { x: 18, y: 18 };
const TRAFFIC_LIGHT_FULLSCREEN = { x: 16, y: 12 };

function applyWindowBackground(color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return;
  }

  currentWindowBackground = color;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(color);
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
  const { format, content } = await fetchTrainingHubActivityFile(
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
      ? await dialog.showSaveDialog(mainWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

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
    app.dock.setIcon(iconPath);
  }
}

function configureAppPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "geolocation");
    }
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === "geolocation"
  );
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
    backgroundColor: DEFAULT_WINDOW_BACKGROUND,
    // Let the app's own header act as the title bar so the macOS traffic
    // lights sit directly on it instead of a separate OS chrome strip.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 }
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  initializeAppUpdater(mainWindow);
}

app.whenReady().then(() => {
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
  hydratePlanDraftStoreFromDatabase();
  prunePlanDraftStore();
  pruneDeleteRequestStore();
  registerIpcHandlers();
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
  createWindow();
  applyAppIcon();

  // Silently restore a previous COROS MCP session (no browser popup).
  void ensureCorosMcpConnected();

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

app.on("before-quit", () => {
  stopRouteShare();
});

function registerIpcHandlers(): void {
  ipcMain.handle("window:setBackground", (_event, color: string) => {
    applyWindowBackground(color);
  });

  ipcMain.handle("window:isFullscreen", () => mainWindow?.isFullScreen() ?? false);

  ipcMain.handle("watch:getStatus", () => getWatchStatus());

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

    const copiedTrack = await transferFileToWatch(download.filePath);
    markDownloadTransferred(id);

    return {
      copiedTrack,
      watch: await getWatchStatus()
    };
  });

  ipcMain.handle("downloads:list", () => listDownloads());

  ipcMain.handle("downloads:downloadAudio", (_event, url: string) =>
    downloadAudio(url)
  );

  ipcMain.handle(
    "downloads:delete",
    (_event, id: string, removeFile: boolean) => {
      deleteDownload(id, removeFile);
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

  ipcMain.handle("chat:getSettings", () => getChatSettings());

  ipcMain.handle("chat:saveSettings", (_event, settings: ChatSettings) =>
    saveChatSettings(settings)
  );

  ipcMain.handle("chat:testLocalConnection", (_event, config?: LocalChatConfig) =>
    testLocalChatConnection(config)
  );

  ipcMain.handle("chat:detectLocalServers", (_event, apiKey?: string) =>
    detectLocalChatServers(apiKey)
  );

  ipcMain.handle("chat:login", () => loginChat(mainWindow));

  ipcMain.handle("chat:logout", () => logoutChat());

  // Kicks off streaming; assistant text is pushed via chat:stream* events.
  ipcMain.handle(
    "chat:send",
    (_event, requestId: string, messages: ChatMessage[]) =>
      streamChat(mainWindow, requestId, messages)
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
    (_event, sessionId: string, entries: PersistedChatEntry[]) =>
      saveChatSessionEntries(sessionId, entries)
  );

  ipcMain.handle("chat:deleteSession", (_event, sessionId: string) => {
    deleteChatSessionById(sessionId);
  });

  ipcMain.handle("chatMcp:getStatus", () => getCorosMcpStatus());

  ipcMain.handle("chatMcp:connect", () => connectCorosMcp(mainWindow));

  ipcMain.handle("chatMcp:disconnect", () => disconnectCorosMcp());

  ipcMain.handle("chatMcp:listTools", () => listCorosMcpTools());

  ipcMain.handle("chat:uploadPlanDraft", (_event, draftId: string) =>
    uploadTrainingPlanDraft(draftId)
  );

  ipcMain.handle("chat:confirmWorkoutDelete", (_event, requestId: string) =>
    confirmWorkoutDelete(requestId)
  );

  ipcMain.handle(
    "trainingHub:uploadTrainingPlan",
    (_event, draft: CorosTrainingPlanDraftInput) => uploadTrainingPlan(draft)
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

  ipcMain.handle("spotify:getConfig", () => getSpotifyConfig());

  ipcMain.handle("spotify:saveConfig", (_event, config: SpotifyConfig) =>
    saveSpotifyConfig(config)
  );

  ipcMain.handle("spotify:getStatus", () => getSpotifyStatus());

  ipcMain.handle("spotify:login", () => loginSpotify(mainWindow));

  ipcMain.handle("spotify:logout", () => logoutSpotify());

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

  ipcMain.handle("trainingHub:getStatus", () => getTrainingHubStatus());

  ipcMain.handle(
    "trainingHub:login",
    (_event, email: string, password: string, remember?: boolean) =>
      loginTrainingHub(email, password, remember)
  );

  ipcMain.handle("trainingHub:logout", () => logoutTrainingHub());

  ipcMain.handle("trainingHub:reconnect", () => reconnectTrainingHub());

  ipcMain.handle(
    "trainingHub:listActivities",
    (_event, page: number, size: number, startDay?: string, endDay?: string) =>
      listTrainingHubActivities(page, size, startDay, endDay)
  );

  ipcMain.handle(
    "trainingHub:listScheduledWorkouts",
    (_event, startDay: string, endDay: string) =>
      listScheduledWorkoutEntries(startDay, endDay)
  );

  ipcMain.handle("trainingHub:listLibraryWorkouts", () =>
    listLibraryWorkouts()
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
      saveToLibrary?: boolean
    ) => createAndScheduleWorkout(entry, happenDay, saveToLibrary)
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
    ) => rescheduleScheduledWorkout(entry, newHappenDay)
  );

  ipcMain.handle(
    "trainingHub:removeScheduledWorkout",
    (
      _event,
      entry: { planId: string; idInPlan: string; planProgramId?: string }
    ) => removeScheduledWorkout(entry)
  );

  ipcMain.handle(
    "trainingHub:getActivityDetail",
    (
      _event,
      activityId: string,
      sportType: number,
      listActivity?: TrainingHubActivity
    ) => getTrainingHubActivityDetail(activityId, sportType, listActivity)
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
        await listTrainingHubActivities(1, 50)
      );
      if (!latest) {
        throw new Error("No COROS activities were found to export.");
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
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    "trainingHub:startActivityBackup",
    (_event, folder: string, fileType: TrainingHubActivityFileType = 4) =>
      startActivityBackup(folder, fileType)
  );

  ipcMain.handle("trainingHub:cancelActivityBackup", () =>
    cancelActivityBackup()
  );

  ipcMain.handle("trainingHub:getActivityBackupProgress", () =>
    getActivityBackupProgress()
  );

  ipcMain.handle("trainingHub:getTrainingAnalytics", () =>
    getTrainingAnalytics()
  );

  ipcMain.handle("trainingHub:getRacePredictor", () => getRacePredictor());

  ipcMain.handle("trainingHub:getDashboard", () => getTrainingDashboard());

  ipcMain.handle("trainingHub:getDailyMetrics", (_event, dateList: string[]) =>
    getDailyMetrics(dateList)
  );

  ipcMain.handle("trainingHub:getSportTypeMap", () => getSportTypeMap());

  ipcMain.handle("trainingHub:getActivityPaceBaselines", () =>
    getActivityPaceBaselines()
  );

  ipcMain.handle("trainingHub:getUpcomingWorkouts", (_event, days?: number) =>
    getUpcomingWorkouts(days)
  );

  ipcMain.handle("trainingHub:getSleepData", (_event, days?: number) =>
    getTrainingSleepData(mainWindow, days ?? 7)
  );

  ipcMain.handle("trainingHub:getDailyHealthData", (_event, days?: number) =>
    getTrainingDailyHealthData(mainWindow, days ?? 1)
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

  ipcMain.handle("maps:chooseCorosMapFolder", () => chooseCorosMapFolder());

  ipcMain.handle("maps:installCorosMapFolder", async (_event, sourcePath: string) => {
    try {
      return await installCorosMapFolder(sourcePath);
    } catch (error) {
      throw toCorosMapInstallIpcError(error);
    }
  });

  ipcMain.handle("maps:getRouteBuilderConfig", () => getRouteBuilderConfig());

  ipcMain.handle(
    "maps:saveRouteBuilderConfig",
    (_event, config: RouteBuilderConfig) => saveRouteBuilderConfig(config)
  );

  ipcMain.handle("maps:listGeneratedRoutes", () => listGeneratedRoutes());

  ipcMain.handle("maps:openLocationServicesSettings", () =>
    openLocationServicesSettings()
  );

  ipcMain.handle("maps:getApproximateRouteLocation", () =>
    getApproximateRouteLocation()
  );

  ipcMain.handle("maps:geocodeRouteLocation", (_event, query: string) =>
    geocodeRouteLocation(query)
  );

  ipcMain.handle("maps:searchRouteLocations", (_event, query: string) =>
    searchRouteLocations(query)
  );

  ipcMain.handle("maps:generateRoute", (_event, request: GenerateRouteRequest) =>
    generateRoute(request)
  );

  ipcMain.handle(
    "maps:routeWaypoints",
    (_event, request: RouteWaypointRequest) => routeWaypoints(request)
  );

  ipcMain.handle(
    "maps:importRouteGpx",
    (_event, activityType?: RouteActivityType) =>
      importRouteFromGpx(activityType)
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
}
