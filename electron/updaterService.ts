import { execFileSync } from "node:child_process";
import { app, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { getSetting, setSetting } from "./database";
import type { AppUpdateSnapshot } from "./types";

const AUTO_CHECK_KEY = "updater.autoCheck";
const AUTO_DOWNLOAD_KEY = "updater.autoDownload";

let mainWindow: BrowserWindow | undefined;
let listenersRegistered = false;
let snapshot: AppUpdateSnapshot = {
  supported: false,
  currentVersion: app.getVersion(),
  status: "idle",
  autoCheck: true,
  autoDownload: true
};

function readBooleanSetting(key: string, fallback: boolean): boolean {
  try {
    const value = getSetting(key);
    return value === undefined ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function isUpdaterEnabled(): boolean {
  return app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
}

function isMacAdHocSigned(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    const output = execFileSync(
      "codesign",
      ["-dv", process.execPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const combined = output.toString();

    return (
      combined.includes("Signature=adhoc") ||
      combined.includes("code has no resources but signature indicates they must be present")
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.message}\n${"stderr" in error ? String(error.stderr ?? "") : ""}`
        : String(error);

    return message.includes("Signature=adhoc");
  }
}

function getManualInstallUrl(version: string): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  if (process.platform === "darwin") {
    return `https://github.com/JunAkerBuilds/CorosLink/releases/download/v${version}/CorosLink-${version}-${arch}.dmg`;
  }

  if (process.platform === "win32") {
    return `https://github.com/JunAkerBuilds/CorosLink/releases/download/v${version}/CorosLink-Setup-${version}.exe`;
  }

  return `https://github.com/JunAkerBuilds/CorosLink/releases/download/v${version}/CorosLink-${version}.AppImage`;
}

function getReleasePageUrl(version?: string): string {
  if (!version) {
    return "https://github.com/JunAkerBuilds/CorosLink/releases/latest";
  }

  return `https://github.com/JunAkerBuilds/CorosLink/releases/tag/v${version}`;
}

function formatUpdaterError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Could not check for updates.";

  if (message.includes("404")) {
    const version = snapshot.availableVersion;
    const target = version
      ? `CorosLink ${version}`
      : "the latest CorosLink release";
    return `Update download failed. Download ${target} from GitHub: ${getReleasePageUrl(version)}`;
  }

  return message;
}

function resolveInstallDetails(
  version: string
): Pick<AppUpdateSnapshot, "installMethod" | "manualInstallUrl"> {
  if (process.platform === "darwin" && isMacAdHocSigned()) {
    return {
      installMethod: "manual",
      manualInstallUrl: getManualInstallUrl(version)
    };
  }

  return {
    installMethod: "restart",
    manualInstallUrl: undefined
  };
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
  // Applying an update is always an explicit choice from the update prompt or
  // update controls. In particular, choosing "Not now" must not silently
  // install the already-downloaded update when the app later quits.
  autoUpdater.autoInstallOnAppQuit = false;
  // Include notes for every release newer than the installed version so users
  // who skip one or more versions still see the complete changelog.
  autoUpdater.fullChangelog = true;

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
      error: undefined,
      ...resolveInstallDetails(info.version)
    });
  });

  autoUpdater.on("error", (error) => {
    setSnapshot({
      status: "error",
      error: formatUpdaterError(error)
    });
  });
}

export function initializeAppUpdater(window: BrowserWindow): void {
  mainWindow = window;

  const autoCheck = readBooleanSetting(AUTO_CHECK_KEY, true);
  const autoDownload = readBooleanSetting(AUTO_DOWNLOAD_KEY, true);

  if (!isUpdaterEnabled()) {
    snapshot = {
      supported: false,
      currentVersion: app.getVersion(),
      status: "idle",
      autoCheck,
      autoDownload
    };
    return;
  }

  snapshot = {
    supported: true,
    currentVersion: app.getVersion(),
    status: "idle",
    autoCheck,
    autoDownload
  };

  registerAutoUpdaterListeners();
  autoUpdater.autoDownload = autoDownload;
  publishSnapshot();

  if (autoCheck) {
    setTimeout(() => {
      void checkForAppUpdates();
    }, 5000);
  }
}

export async function checkForAppUpdates(): Promise<AppUpdateSnapshot> {
  if (!isUpdaterEnabled()) {
    return getAppUpdateSnapshot();
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setSnapshot({ status: "error", error: formatUpdaterError(error) });
  }

  return getAppUpdateSnapshot();
}

export async function downloadAppUpdate(): Promise<AppUpdateSnapshot> {
  if (!isUpdaterEnabled()) {
    return getAppUpdateSnapshot();
  }

  if (snapshot.status === "downloading" || snapshot.status === "downloaded") {
    return getAppUpdateSnapshot();
  }

  try {
    setSnapshot({ status: "downloading", downloadPercent: 0, error: undefined });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setSnapshot({ status: "error", error: formatUpdaterError(error) });
  }

  return getAppUpdateSnapshot();
}

export function setUpdaterPreferences(prefs: {
  autoCheck?: boolean;
  autoDownload?: boolean;
}): AppUpdateSnapshot {
  const next: Partial<AppUpdateSnapshot> = {};

  if (typeof prefs.autoCheck === "boolean") {
    setSetting(AUTO_CHECK_KEY, String(prefs.autoCheck));
    next.autoCheck = prefs.autoCheck;
  }

  if (typeof prefs.autoDownload === "boolean") {
    setSetting(AUTO_DOWNLOAD_KEY, String(prefs.autoDownload));
    next.autoDownload = prefs.autoDownload;
    if (isUpdaterEnabled()) {
      autoUpdater.autoDownload = prefs.autoDownload;
    }
  }

  setSnapshot(next);
  return getAppUpdateSnapshot();
}

export async function quitAndInstallUpdate(): Promise<{
  installMethod: "restart" | "manual";
}> {
  if (!isUpdaterEnabled()) {
    throw new Error("Updates are only available in the installed app.");
  }

  if (snapshot.status !== "downloaded" || !snapshot.availableVersion) {
    throw new Error(
      `Update is not ready to install yet (status: ${snapshot.status}).`
    );
  }

  if (snapshot.installMethod === "manual") {
    const url =
      snapshot.manualInstallUrl ??
      getManualInstallUrl(snapshot.availableVersion);
    await shell.openExternal(url);
    return { installMethod: "manual" };
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });

  return { installMethod: "restart" };
}

function formatReleaseNotes(
  releaseNotes:
    | string
    | Array<{ version?: string; note?: string | null }>
    | null
    | undefined
): string | undefined {
  if (!releaseNotes) {
    return undefined;
  }

  if (typeof releaseNotes === "string") {
    return releaseNotes;
  }

  const sections = releaseNotes.flatMap((entry) => {
    const note = entry.note?.trim();
    if (!note) {
      return [];
    }

    return entry.version
      ? [`## Version ${entry.version}\n\n${note}`]
      : [note];
  });

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
