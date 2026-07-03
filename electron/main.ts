import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import fs from "node:fs";
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
  loginTrainingHub,
  logoutTrainingHub
} from "./trainingHubService";
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
  installCachedCorosMap,
  installCachedCorosMaps,
  installCorosMapFolder,
  listCachedCorosMaps,
  listCorosMapDownloadJobs,
  listGeneratedRoutes,
  openCorosMapDownload,
  openLocationServicesSettings,
  saveRouteBuilderConfig,
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
  GenerateRouteRequest,
  RouteBuilderConfig,
  SpotifyConfig,
  TrainingHubActivity,
  TrainingHubActivityFileType,
  TrainingHubExportResult,
  WatchConnectionSmokeOptionId,
  YouTubeMusicConfig
} from "./types";
import {
  cleanupStaleSmokeFixtures,
  clearActiveSmokeFixtureSync,
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

let mainWindow: BrowserWindow | undefined;

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
    backgroundColor: "#0b0f0e",
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
  void cleanupStaleSmokeFixtures();
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
  createWindow();
  applyAppIcon();

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
  clearActiveSmokeFixtureSync();
});

function registerIpcHandlers(): void {
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

  ipcMain.handle(
    "trainingHub:listActivities",
    (_event, page: number, size: number) =>
      listTrainingHubActivities(page, size)
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
      const { format, content } = await fetchTrainingHubActivityFile(
        activityId,
        sportType,
        fileType
      );

      const baseName =
        sanitizeExportFileName(suggestedName) || `activity-${activityId}`;
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

      if (result.canceled || !result.filePath) {
        return { saved: false };
      }

      await fs.promises.writeFile(result.filePath, content);
      return { saved: true, filePath: result.filePath };
    }
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

  ipcMain.handle("maps:generateRoute", (_event, request: GenerateRouteRequest) =>
    generateRoute(request)
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
