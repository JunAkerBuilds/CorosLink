import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { autoUpdater, CancellationToken } from "electron-updater";
import { getSetting, setSetting } from "./database";
import type { AppUpdateSnapshot } from "./types";

const AUTO_CHECK_KEY = "updater.autoCheck";
const AUTO_DOWNLOAD_KEY = "updater.autoDownload";
const STARTUP_CHECK_DELAY_MS = 5000;

let mainWindow: BrowserWindow | undefined;
let listenersRegistered = false;
let staleUpdateCleanupStarted = false;
let startupCheckTimer: ReturnType<typeof setTimeout> | undefined;
let downloadRequestGeneration = 0;
/**
 * The one download in flight, if any. Every download starts through
 * downloadAppUpdate() so this token can always stop it.
 */
let activeDownload:
  | { cancellation: CancellationToken; finished: Promise<void> }
  | undefined;
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

function getUpdaterBaseCacheDir(): string {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Caches");
  }

  return process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache");
}

async function getUpdaterCacheDirName(): Promise<string> {
  try {
    const config = await fs.readFile(
      path.join(process.resourcesPath, "app-update.yml"),
      "utf8"
    );
    const match = config.match(/^updaterCacheDirName:\s*(\S+)\s*$/m);
    if (match) {
      return match[1];
    }
  } catch {
    // fall through to electron-updater's default
  }

  return app.getName();
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionNewerThanCurrent(version: [number, number, number]): boolean {
  const current = parseVersion(app.getVersion());
  if (!current) {
    return false;
  }

  for (let i = 0; i < 3; i++) {
    if (version[i] !== current[i]) {
      return version[i] > current[i];
    }
  }

  return false;
}

/**
 * electron-updater leaves the downloaded installer in the cache dir's
 * "pending" folder after the update is installed, and only clears it when
 * the next release starts downloading. On Windows that duplicates the
 * ~100MB installer already kept at the cache root as "installer.exe" for
 * differential downloads (which must be preserved). See issue #33.
 */
async function cleanupInstalledUpdateCache(): Promise<void> {
  try {
    const pendingDir = path.join(
      getUpdaterBaseCacheDir(),
      await getUpdaterCacheDirName(),
      "pending"
    );

    try {
      const raw = await fs.readFile(
        path.join(pendingDir, "update-info.json"),
        "utf8"
      );
      const fileName = (JSON.parse(raw) as { fileName?: unknown }).fileName;
      if (typeof fileName === "string") {
        const pendingVersion = parseVersion(fileName);
        if (pendingVersion && isVersionNewerThanCurrent(pendingVersion)) {
          // Downloaded but not installed yet — keep it.
          return;
        }
      }
    } catch {
      // No readable update-info.json: anything left here is an orphaned
      // partial download, safe to remove.
    }

    await fs.rm(pendingDir, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort; never block updater startup.
  }
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
  // electron-updater never starts a download by itself: the update-available
  // handler below does it only while "Download automatically" is on, and
  // through downloadAppUpdate() so switching it off can cancel the download.
  autoUpdater.autoDownload = false;
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

    if (snapshot.autoDownload) {
      void downloadAppUpdate();
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    setSnapshot({
      status: "not-available",
      availableVersion: info.version,
      error: undefined
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    // A cancelled download can still report one last chunk; it must not flip
    // the snapshot back to "downloading" after it was stopped.
    if (!activeDownload || activeDownload.cancellation.cancelled) {
      return;
    }

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

function clearScheduledUpdateCheck(): void {
  if (startupCheckTimer !== undefined) {
    clearTimeout(startupCheckTimer);
    startupCheckTimer = undefined;
  }
}

export function initializeAppUpdater(window: BrowserWindow): void {
  mainWindow = window;
  // Reopening the window on macOS runs this again; never stack a second
  // startup check on top of one that is still pending.
  clearScheduledUpdateCheck();

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

  // On a reopened window keep reporting what the updater is doing (a
  // download in progress, a downloaded update) instead of resetting to idle.
  snapshot = listenersRegistered
    ? { ...snapshot, autoCheck, autoDownload }
    : {
        supported: true,
        currentVersion: app.getVersion(),
        status: "idle",
        autoCheck,
        autoDownload
      };

  registerAutoUpdaterListeners();
  publishSnapshot();

  if (!staleUpdateCleanupStarted) {
    staleUpdateCleanupStarted = true;
    void cleanupInstalledUpdateCache();
  }

  if (autoCheck) {
    startupCheckTimer = setTimeout(() => {
      startupCheckTimer = undefined;
      void checkForAppUpdates();
    }, STARTUP_CHECK_DELAY_MS);
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

  const requestGeneration = downloadRequestGeneration;
  // A download that was just stopped may still be unwinding inside
  // electron-updater, which would hand a new request its cancelled promise.
  while (activeDownload?.cancellation.cancelled) {
    await activeDownload.finished;
  }

  // Switching downloads off also invalidates requests waiting for an earlier
  // cancellation. A later manual request still works with downloads disabled.
  if (
    requestGeneration !== downloadRequestGeneration ||
    activeDownload ||
    snapshot.status === "downloaded"
  ) {
    return getAppUpdateSnapshot();
  }

  const cancellation = new CancellationToken();
  setSnapshot({ status: "downloading", downloadPercent: 0, error: undefined });

  const finished = autoUpdater
    .downloadUpdate(cancellation)
    .then(
      () => undefined,
      (error: unknown) => {
        // A cancelled download already reset the snapshot, and
        // electron-updater removed the partial file itself.
        if (!cancellation.cancelled) {
          setSnapshot({ status: "error", error: formatUpdaterError(error) });
        }
      }
    )
    .finally(() => {
      if (activeDownload?.cancellation === cancellation) {
        activeDownload = undefined;
      }
    });
  activeDownload = { cancellation, finished };

  await finished;
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
    if (!prefs.autoCheck) {
      clearScheduledUpdateCheck();
    }
  }

  if (typeof prefs.autoDownload === "boolean") {
    setSetting(AUTO_DOWNLOAD_KEY, String(prefs.autoDownload));
    next.autoDownload = prefs.autoDownload;
    if (!prefs.autoDownload) {
      downloadRequestGeneration += 1;
    }

    // Off means off: stop a download already under way, including one the
    // user started. The update stays available to download on request.
    if (
      !prefs.autoDownload &&
      activeDownload &&
      !activeDownload.cancellation.cancelled
    ) {
      activeDownload.cancellation.cancel();
      next.status = "available";
      next.downloadPercent = undefined;
    }
  }

  setSnapshot(next);

  // Switching it on with an update already found fetches that update now,
  // as if the switch had been on when the update was found.
  if (
    prefs.autoDownload === true &&
    snapshot.status === "available" &&
    isUpdaterEnabled()
  ) {
    void downloadAppUpdate();
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
