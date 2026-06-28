import { app, BrowserWindow, ipcMain, shell } from "electron";
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
  getDailyMetrics,
  getRacePredictor,
  getSportTypeMap,
  getTrainingAnalytics,
  getTrainingDashboard,
  getTrainingHubActivityDetail,
  getTrainingHubActivityFileUrl,
  getTrainingHubStatus,
  getUpcomingWorkouts,
  listTrainingHubActivities,
  loginTrainingHub,
  logoutTrainingHub
} from "./trainingHubService";
import type {
  DownloadJob,
  SpotifyConfig,
  TrainingHubActivity,
  TrainingHubActivityFileType,
  WatchConnectionSmokeOptionId
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
  downloadFromYouTubeBrowser,
  downloadMultipleFromYouTubeBrowser,
  getYouTubeHistory,
  saveYouTubeVisit
} from "./youtubeService";
import {
  checkForAppUpdates,
  getAppUpdateSnapshot,
  initializeAppUpdater,
  quitAndInstallUpdate
} from "./updaterService";

let mainWindow: BrowserWindow | undefined;

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
  configureYouTubeBrowserSession();
  registerYouTubeBrowserHandlers();
  initializeDatabase(app.getPath("userData"));
  registerIpcHandlers();
  setJobListener((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("youtube:jobsUpdate", jobs);
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
    (_event, items: Array<{ url: string; title?: string }>): DownloadJob[] =>
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
    (_event, email: string, password: string) =>
      loginTrainingHub(email, password)
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
    "trainingHub:getActivityFileUrl",
    (
      _event,
      activityId: string,
      sportType: number,
      fileType: TrainingHubActivityFileType
    ) => getTrainingHubActivityFileUrl(activityId, sportType, fileType)
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

  ipcMain.handle("trainingHub:getUpcomingWorkouts", (_event, days?: number) =>
    getUpcomingWorkouts(days)
  );

  ipcMain.handle("app:getUpdateStatus", () => getAppUpdateSnapshot());

  ipcMain.handle("app:checkForUpdates", () => checkForAppUpdates());

  ipcMain.handle("app:quitAndInstallUpdate", () => {
    quitAndInstallUpdate();
  });
}
