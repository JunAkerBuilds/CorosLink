import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import { corosNativeBle } from "../corosNativeBleService";
import { forgetCorosWatchKey, getCorosWatchfaceStatus, logoutCorosWatchfaces } from "../corosWatchfaceService";
import { deleteSettings, getSetting, requireDatabase, setSetting } from "../database";
import { requireMainWindowSender } from "../mainWindowGuard";
import { diagnosticIpcMain as ipcMain } from "../diagnosticsService";
import { indexFitFile } from "../fitIndexService";
import { localizeDialogOptions } from "../localization";
import { configureDataSources } from "../localSync/activitySource";
import { cloudActivitySource, cloudHealthSource } from "../localSync/cloudSources";
import { LocalArchive } from "../localSync/localArchive";
import { LocalDataService } from "../localSync/localDataService";
import { SyncCaptureLog, syncCaptureEnabled } from "../localSync/syncCapture";
import { COROS_MCP_SERVER_ID, isCorosMcpUrl } from "../corosMcpRegions";
import { disconnectMcpServer } from "../mcpClientManager";
import { listMcpServers } from "../mcpServersStore";
import { configureLocalTraining, logoutTrainingHub } from "../trainingHubService";
import { dataMode, networkPolicy } from "./bootstrap";
import { localAccountFromWatchProfile } from "../watchProfileService";
import { configureCepCache, cepSatelliteData } from "../watchCepService";
import { pushSatelliteData } from "../localSync/satelliteSync";
import { recordDiagnosticNotice } from "../diagnosticsService";
import { autoSyncState, setAutoSync, WatchAutoSync } from "../watchAutoSyncService";
import { EXPERIMENTAL_SYNC_MODELS } from "../localSync/watchSyncModels";
import type { DataModeStatus, LocalOnlyActivationOptions } from "./dataModeTypes";

/**
 * Main-process wiring for Local-Only Mode: credential clean-up for the
 * activation lifecycle, local data, and the IPC surface used by Settings →
 * Privacy. Registered right after the database opens.
 */

export interface LocalOnlyMainOptions {
  getWindow: () => BrowserWindow | undefined;
}

/** "allowed" once the user agreed to replace a training plan on the watch that CorosLink didn't put there. */
const PLAN_REPLACEMENT_SETTING = "watch.planReplacement";
/** The calendar last confirmed on each watch (content hash by local device id), so an unchanged one isn't resent. */
const SENT_CALENDAR_SETTING = "watch.sentCalendar";

/** Whether a sync may replace a training plan on the watch that CorosLink didn't put there. */
export function watchPlanReplacementAllowed(): boolean {
  return getSetting(PLAN_REPLACEMENT_SETTING) === "allowed";
}

/** Allows replacing such a plan, or asks again before the next one (false). Returns the setting now. */
export function setWatchPlanReplacement(allowed: boolean): boolean {
  if (allowed) setSetting(PLAN_REPLACEMENT_SETTING, "allowed");
  else deleteSettings([PLAN_REPLACEMENT_SETTING]);
  return watchPlanReplacementAllowed();
}

function sentCalendars(): Record<string, string> {
  try {
    const value = JSON.parse(getSetting(SENT_CALENDAR_SETTING) || "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
  } catch {
    return {};
  }
}

/**
 * The optional credential clean-up on activation. User-started uploads are
 * refused at the IPC gate and any upload already in flight is aborted by the
 * fetch guard.
 */
function registerCredentialActions(): void {
  dataMode.setCredentialActions({
    forgetCloudSession: async () => {
      logoutTrainingHub();
      logoutCorosWatchfaces();
      // The built-in COROS server, and any COROS endpoint the athlete added by hand.
      const corosIds = new Set([COROS_MCP_SERVER_ID]);
      for (const server of listMcpServers()) if (isCorosMcpUrl(server.url)) corosIds.add(server.id);
      await Promise.all([...corosIds].map((id) =>
        disconnectMcpServer(id, { clearAuthorization: true }).catch(() => undefined)
      ));
    },
    forgetWatchKey: () => { forgetCorosWatchKey(); }
  });
}

function confirmOptions(options: { message: string; detail: string; confirm: string; danger?: boolean }): Electron.MessageBoxOptions {
  return localizeDialogOptions({
    type: options.danger ? "warning" : "question",
    buttons: ["Cancel", options.confirm],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: options.message,
    detail: options.detail
  });
}

export function registerLocalOnlyMode(options: LocalOnlyMainOptions): LocalDataService {

  const send = (channel: string, payload: unknown) => {
    const window = options.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  // Developer protocol capture for testing watch sync on real hardware (off by default).
  let capture: SyncCaptureLog | undefined;
  if (syncCaptureEnabled()) {
    const directory = path.join(LocalArchive.forUserData(app.getPath("userData")).root, "captures");
    const log = new SyncCaptureLog(directory, { appVersion: app.getVersion(), platform: process.platform, arch: process.arch });
    corosNativeBle.setLocalSyncCapture(entry => {
      const watch = corosNativeBle.localSyncWatch();
      log.write({ type: "transport", ...entry, watch: watch ? { model: watch.model, firmware: watch.firmware } : null });
    });
    capture = log;
    console.warn(`[sync-capture] Recording watch-sync frames to ${directory}`);
  }

  configureCepCache(app.getPath("userData"));
  const localData = new LocalDataService({
    capture,
    database: requireDatabase(),
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
    link: {
      watch: () => corosNativeBle.localSyncWatch(),
      runExclusive: task => corosNativeBle.runLocalSync(task),
      readSyncBlock: (fileIndex, offset, selector) => corosNativeBle.readSyncFileBlock(fileIndex, offset, selector),
      readPedometer: payload => corosNativeBle.readPedometer(payload),
      // Used from inside the sync, to reset a block request that failed partway: it doesn't wait for the sync.
      disconnect: () => corosNativeBle.resetLinkInSync(),
      watchKeySaved: () => getCorosWatchfaceStatus().watchAuthenticationAvailable === true,
      listTrainingPlans: () => corosNativeBle.listTrainingPlansInSync(),
      sendTrainingPlan: (file, replace) => corosNativeBle.sendTrainingPlanInSync(file, replace),
      // What the watch takes (settings type 13) decides the file; formats not checked for the model are never sent (satelliteSync.ts).
      sendSatelliteData: options => pushSatelliteData({
        model: () => corosNativeBle.localSyncWatch()?.model,
        readAssistance: async () => {
          const assist = await corosNativeBle.readGpsAssistanceInSync().catch(() => corosNativeBle.localSyncGpsAssistance());
          // Developer capture: the raw bytes, so the type and chip bits can be checked against what each model is known to report.
          if (capture && assist) recordDiagnosticNotice("corosBle:satelliteData", `bind 11-14 ${assist.raw || "-"}; settings 13 ${assist.settingsRaw ?? "-"}`);
          return assist;
        },
        sendFile: file => corosNativeBle.sendSatelliteFileInSync(file)
      }, { cepFile: cepSatelliteData }, options)
    },
    // In Connected Mode the COROS app keeps the watch's calendar; Local-Only Mode sends this computer's.
    pushTrainingCalendar: () => networkPolicy.enforcing,
    watchCalendar: {
      replaceForeignPlan: () => watchPlanReplacementAllowed(),
      lastSent: deviceId => sentCalendars()[deviceId],
      recordSent: (deviceId, contentHash) => setSetting(SENT_CALENDAR_SETTING, JSON.stringify({ ...sentCalendars(), [deviceId]: contentHash }))
    },
    pushSatelliteData: () => networkPolicy.enforcing,
    accountProfile: () => localAccountFromWatchProfile(),
    indexSummary: (absolutePath, meta) => indexFitFile(absolutePath, meta),
    onSyncProgress: progress => send("localData:syncProgress", progress)
  });

  // Disconnect and quitting stop a sync's reads at the next block, then wait for what it is writing.
  corosNativeBle.setLocalSyncCancel(() => { localData.cancelSync(); });

  configureDataSources({
    useLocal: () => networkPolicy.enforcing,
    localActivities: localData.activitySource,
    cloudActivities: cloudActivitySource,
    localHealth: localData.healthSource,
    cloudHealth: cloudHealthSource
  });

  // Workouts and the training calendar stay on this computer while Local-Only Mode is on.
  configureLocalTraining(() => networkPolicy.enforcing ? localData.trainingBackend : undefined);

  registerCredentialActions();

  // Background sync with the watch last used (off until turned on in the watch menu).
  const autoSync = new WatchAutoSync({
    active: () => networkPolicy.enforcing,
    idle: () => corosNativeBle.idleForBackgroundSync(),
    ready: () => corosNativeBle.hasRememberedWatch() && getCorosWatchfaceStatus().watchAuthenticationAvailable === true,
    // Only the watch whose Bluetooth identity a connection from the watch menu remembered.
    trusted: () => corosNativeBle.watchIdentityForBackgroundSync(),
    connected: () => corosNativeBle.isConnected(),
    userConnects: () => corosNativeBle.userConnectCount(),
    connect: async () => {
      const watch = await corosNativeBle.connectForBackgroundSync();
      return watch.connected && watch.systemBind === "authenticated" && (!watch.watchModel || EXPERIMENTAL_SYNC_MODELS.has(watch.watchModel));
    },
    sync: () => localData.syncWatch(),
    disconnect: () => corosNativeBle.disconnect(),
    onChange: state => send("watch:autoSyncChanged", state)
  });
  autoSync.start();
  corosNativeBle.onWatchConfirmed(() => autoSync.resume());
  app.once("before-quit", () => autoSync.stop());

  // Payloads synced before their format could be decoded become activities now, without reconnecting the watch.
  void localData.redecodeArchivedPayloads()
    .then(added => { if (added > 0) send("localData:syncProgress", localData.syncProgress()); })
    .catch(() => undefined);

  // Coalesce status pushes: a page full of blocked map tiles must not flood the renderer.
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let latest: DataModeStatus | undefined;
  dataMode.onChange(status => {
    latest = status;
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      if (latest) send("dataMode:changed", latest);
    }, 250);
  });

  const mainWindowOnly = (event: Electron.IpcMainInvokeEvent, action: string): BrowserWindow =>
    requireMainWindowSender(event, options.getWindow(), `${action} is only available in the CorosLink window.`);

  ipcMain.handle("dataMode:getStatus", () => dataMode.status());
  ipcMain.handle("dataMode:getNetworkReport", event => {
    mainWindowOnly(event, "The network report");
    return dataMode.report();
  });
  ipcMain.handle("dataMode:clearNetworkReport", event => {
    mainWindowOnly(event, "The network report");
    networkPolicy.clearAttempts();
    return dataMode.report();
  });
  ipcMain.handle("dataMode:activateLocalOnly", (event, input?: { retainWatchKey?: unknown; forgetCloudSession?: unknown }) => {
    mainWindowOnly(event, "Local-Only Mode");
    const activation: LocalOnlyActivationOptions = {
      retainWatchKey: input?.retainWatchKey !== false,
      forgetCloudSession: input?.forgetCloudSession === true
    };
    return dataMode.activateLocalOnly(activation);
  });
  ipcMain.handle("dataMode:returnToConnected", async event => {
    const window = mainWindowOnly(event, "Connected Mode");
    const answer = await dialog.showMessageBox(window, confirmOptions({
      message: "Switch to Connected Mode and restart CorosLink?",
      detail: "CorosLink will be able to send data to COROS again: workouts, plans, schedules, gear, watch faces and activity imports. Your local activities stay on this computer.",
      confirm: "Switch and restart",
      danger: true
    }));
    return answer.response === 1 ? dataMode.returnToConnected() : dataMode.status();
  });
  ipcMain.handle("localData:getOverview", () => localData.overview());
  ipcMain.handle("localData:getSyncProgress", () => localData.syncProgress());
  ipcMain.handle("localData:syncWatch", event => {
    mainWindowOnly(event, "Watch sync");
    return localData.syncWatch();
  });
  ipcMain.handle("watch:getAutoSync", () => autoSyncState());
  ipcMain.handle("watch:setAutoSync", (event, input?: { enabled?: unknown; intervalHours?: unknown }) => {
    mainWindowOnly(event, "Automatic sync");
    const state = setAutoSync(input ?? {});
    // Turning it on syncs soon rather than at the next five-minute check.
    if (state.enabled) void autoSync.tick();
    return state;
  });
  // The user agreed to replace a training plan on the watch that CorosLink didn't put there (asked once).
  ipcMain.handle("localData:allowWatchPlanReplacement", event => {
    mainWindowOnly(event, "Watch sync");
    setWatchPlanReplacement(true);
  });
  ipcMain.handle("localData:getWatchPlanReplacement", event => {
    mainWindowOnly(event, "Watch sync");
    return watchPlanReplacementAllowed();
  });
  // Turned off again: the next sync asks before replacing such a plan.
  ipcMain.handle("localData:setWatchPlanReplacement", (event, allowed: unknown) => {
    mainWindowOnly(event, "Watch sync");
    if (typeof allowed !== "boolean") throw new Error("Invalid watch plan setting.");
    return setWatchPlanReplacement(allowed);
  });
  ipcMain.handle("localData:cancelSync", event => {
    mainWindowOnly(event, "Watch sync");
    return localData.cancelSync();
  });
  ipcMain.handle("localData:probeWatchSync", (event, input?: { allBlocks?: unknown; selector?: unknown; fileIndex?: unknown }) => {
    mainWindowOnly(event, "Watch sync");
    return localData.probeWatchSync({
      allBlocks: input?.allBlocks === true,
      selector: typeof input?.selector === "number" ? input.selector : 0,
      fileIndex: typeof input?.fileIndex === "number" ? input.fileIndex : undefined
    });
  });
  ipcMain.handle("localData:readDayTotals", event => {
    mainWindowOnly(event, "Watch sync");
    return localData.readDayTotals();
  });
  // Developer test (COROSLINK_SYNC_CAPTURE=1 only, refused otherwise): send satellite data now.
  ipcMain.handle("localData:sendSatelliteDataNow", event => {
    mainWindowOnly(event, "Watch sync");
    return localData.sendSatelliteDataNow();
  });
  ipcMain.handle("localData:importFitFiles", async (event, folder?: unknown) => {
    const window = mainWindowOnly(event, "FIT import");
    const result = await dialog.showOpenDialog(window, localizeDialogOptions({
      title: folder === true ? "Choose a folder of FIT files" : "Choose FIT files",
      properties: folder === true ? ["openDirectory"] : ["openFile", "multiSelections"],
      ...(folder === true ? {} : { filters: [{ name: "FIT activity", extensions: ["fit", "FIT"] }] })
    }));
    if (result.canceled || result.filePaths.length === 0) return { imported: 0, duplicates: 0, failed: [], activityIds: [] };
    return localData.importFitFiles(result.filePaths);
  });
  ipcMain.handle("localData:exportBackup", async (event, input?: { passphrase?: unknown }) => {
    const window = mainWindowOnly(event, "Backup");
    const passphrase = typeof input?.passphrase === "string" && input.passphrase ? input.passphrase : undefined;
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(window, localizeDialogOptions({
      title: "Save CorosLink backup",
      defaultPath: `coroslink-local-backup-${date}.${passphrase ? "clbackup" : "zip"}`,
      filters: passphrase ? [{ name: "Encrypted CorosLink backup", extensions: ["clbackup"] }] : [{ name: "CorosLink backup", extensions: ["zip"] }]
    }));
    if (result.canceled || !result.filePath) return { saved: false };
    return localData.exportBackup(result.filePath, passphrase);
  });
  let chosenBackup: string | undefined;
  ipcMain.handle("localData:chooseBackup", async event => {
    const window = mainWindowOnly(event, "Restore");
    const result = await dialog.showOpenDialog(window, localizeDialogOptions({
      title: "Choose a CorosLink backup",
      properties: ["openFile"],
      filters: [{ name: "CorosLink backup", extensions: ["zip", "clbackup"] }]
    }));
    chosenBackup = result.canceled ? undefined : result.filePaths[0];
    if (!chosenBackup) return { chosen: false };
    return { chosen: true, encrypted: await localData.backupNeedsPassphrase(chosenBackup) };
  });
  ipcMain.handle("localData:restoreBackup", (event, input?: { passphrase?: unknown }) => {
    mainWindowOnly(event, "Restore");
    // Only the file the user picked in the native dialog; the renderer never names a path.
    if (!chosenBackup) throw new Error("Choose a backup to restore first.");
    const passphrase = typeof input?.passphrase === "string" && input.passphrase ? input.passphrase : undefined;
    return localData.restoreBackup(chosenBackup, passphrase);
  });

  return localData;
}
