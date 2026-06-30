import { execFileSync } from "node:child_process";
import { app, BrowserWindow, shell } from "electron";
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
    setSnapshot({ status: "error", error: formatUpdaterError(error) });
  }

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
