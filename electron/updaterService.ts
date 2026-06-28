import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdateSnapshot } from "./types";

let mainWindow: BrowserWindow | undefined;
let listenersRegistered = false;
let snapshot: AppUpdateSnapshot = {
  supported: false,
  currentVersion: app.getVersion(),
  status: "idle"
};

function isUpdaterEnabled(): boolean {
  return app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
}

function publishSnapshot(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:updateStatus", snapshot);
  }
}

function setSnapshot(next: Partial<AppUpdateSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  publishSnapshot();
}

export function getAppUpdateSnapshot(): AppUpdateSnapshot {
  return { ...snapshot };
}

function registerAutoUpdaterListeners(): void {
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setSnapshot({ status: "checking", error: undefined });
  });

  autoUpdater.on("update-available", (info) => {
    setSnapshot({
      status: "available",
      availableVersion: info.version,
      releaseNotes: formatReleaseNotes(info.releaseNotes),
      error: undefined
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setSnapshot({
      status: "not-available",
      availableVersion: info.version,
      error: undefined
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setSnapshot({
      status: "downloading",
      downloadPercent: progress.percent
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setSnapshot({
      status: "downloaded",
      availableVersion: info.version,
      downloadPercent: 100,
      error: undefined
    });
  });

  autoUpdater.on("error", (error) => {
    setSnapshot({
      status: "error",
      error: error.message
    });
  });
}

export function initializeAppUpdater(window: BrowserWindow): void {
  mainWindow = window;

  if (!isUpdaterEnabled()) {
    snapshot = {
      supported: false,
      currentVersion: app.getVersion(),
      status: "idle"
    };
    return;
  }

  snapshot = {
    supported: true,
    currentVersion: app.getVersion(),
    status: "idle"
  };

  registerAutoUpdaterListeners();
  publishSnapshot();

  setTimeout(() => {
    void checkForAppUpdates();
  }, 5000);
}

export async function checkForAppUpdates(): Promise<AppUpdateSnapshot> {
  if (!isUpdaterEnabled()) {
    return getAppUpdateSnapshot();
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not check for updates.";
    setSnapshot({ status: "error", error: message });
  }

  return getAppUpdateSnapshot();
}

export function quitAndInstallUpdate(): void {
  if (!isUpdaterEnabled() || snapshot.status !== "downloaded") {
    return;
  }

  autoUpdater.quitAndInstall();
}

function formatReleaseNotes(
  releaseNotes: string | Array<{ note?: string | null }> | null | undefined
): string | undefined {
  if (!releaseNotes) {
    return undefined;
  }

  if (typeof releaseNotes === "string") {
    return releaseNotes;
  }

  return releaseNotes
    .map((entry) => entry.note?.trim())
    .filter(Boolean)
    .join("\n\n");
}
