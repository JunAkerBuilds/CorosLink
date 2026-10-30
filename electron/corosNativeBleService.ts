import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { getSetting, setSetting } from "./database";
import type { CorosBleBackend, CorosNativeBleConnectOptions, CorosNativeBleSnapshot, CorosSyncCaptureEntry } from "./corosNativeBleTypes";
import { BIND_MESSAGES, BIND_REASON, BIND_STATUS, bindRefusalMessage, CorosBindReplyError, CorosBleAccountAuth, describeBindReply, formatCorosWatchKeyId, watchReportsKeyId, type CorosAccountCredential } from "./corosBleAuth";
import { recordDiagnosticError, recordDiagnosticNotice } from "./diagnosticsService";
import {
  IDENTITY_CONFIRM_MS, identityTag, normalizeIdentity, normalizeSerial, parsePinnedWatches, sameIdentity, sameSerial, WATCH_IDENTITY_SETTING,
  WatchIdentityError, watchIdentityProblem, type PinnedWatch, type WatchIdentityProblem
} from "./watchIdentity";
import { expectedError } from "./diagnosticsLog";
import { CorosBleOperationError, CorosBleTrace } from "./corosBleTrace";
import { COROS_BLE_LOGIN_KEY_SETTING, COROS_WATCH_KEY_CHECK_SETTING, corosBleLoginKeyId, createCorosLoginCredential, nextWatchKeyCheck, type CorosBleLoginKey } from "./corosBleLoginKey";
import { decodeWifiMapTasks, encodeWifiMapStart, encodeWifiTaskRemove, requireWifiDownloadReady, requireWifiTaskRemoved } from "./corosBleWifiProtocol";
import { createWifiMapTask, previewWifiMap } from "./corosWifiMapService";
import type { CorosWifiMapPreview, CorosWifiMapStatus } from "./corosWifiMapTypes";
import { decodeRouteInventory, encodeWatchRoute, encodeRouteBlockHeader, routeSlot, ROUTE_BLOCK_BYTES } from "./corosBleRouteProtocol";
import type { CorosRouteSyncStatus } from "./corosBleRouteTypes";
import type { GeneratedRoute } from "./types";
import { encodeNotificationFrames, type CorosNotificationInput } from "./corosBleNotificationProtocol";
import { createHash, randomUUID } from "node:crypto";
import { CorosActivityScreenService } from "./corosActivityScreenService";
import { decodeWatchfaceInventory, selectWatchfaceSlot, encodeWatchfaceFile, encodeWatchfaceBlockHeader, WATCHFACE_BLOCK_BYTES, WATCHFACE_MAX_BYTES } from "./corosBleWatchfaceProtocol";
import type { CorosDirectWatchfaceInventory, CorosDirectWatchfacePreview, CorosDirectWatchfaceStatus, CorosDirectWatchfaceTarget } from "./corosBleWatchfaceTypes";
import { decodeMusicInventoryPage, encodeMusicDeleteFile, encodeMusicDeleteHeader, requireMusicDeleteAcknowledgement } from "./corosBleMusicProtocol";
import type { CorosBleMusicInventory, CorosBleMusicDeleteTarget, CorosBleMusicDeleteResult, CorosBleMusicTrack } from "./corosBleMusicTypes";
import { CorosWifiMusicService } from "./corosWifiMusicService";
import { encodePhonePairingCode, PHONE_PAIRING_DISPLAY_MS } from "./corosBlePhonePairing";
import type { CorosPhonePairingCode } from "./corosNativeBleTypes";
import { assertReadableSyncFile, PEDOMETER_OPCODE } from "./localSync/activityProtocol";
import { decodeSettings, encodeSettings, encodeSettingsRequest, SETTING_SWITCH, SETTING_USB_ACCESS, SETTING_USER_INFO, SETTINGS_GET_OPCODE, SETTINGS_SET_OPCODE } from "./corosWatchProfile";
import { applyFwInfoGpsAssistance, decodeBindGpsAssistance, SETTING_FW_INFO, type WatchGpsAssistance } from "./corosWatchGpsAssist";
import { encodeCepTransfer, unixMsOfWatchHour, type CepFile } from "./corosWatchCep";
import { decodeSwitches, decodeSwitchWord, SETTING_SWITCH_EXT } from "./corosWatchSettings";
import { encodeSyncTime, nearLocalMidnight, requireWatchAcknowledgement, SYNC_TIME_OPCODE } from "./corosWatchCommands";
import { NOT_AVAILABLE_ON_WATCH, watchSupports, watchTakesSatelliteFormat, type WatchFeature } from "./localSync/watchSyncModels";
import type { WatchModelId } from "./watchModels";
import {
  CONFIG_TRAINING_OPCODE, decodeTrainingList, encodeProgramLite, encodeTrainingBlockHeader, encodeTrainingDeleteRequest,
  encodeTrainingListRequest, encodeWatchFile, LOCAL_PLAN_ID, TRAINING_BLOCK_BYTES, TRAINING_KIND, TRAINING_PLAN_FILE, TRAINING_PLAN_SYNC_FLAG,
  WEATHER_FILE, WORKOUT_FILE, WorkoutNotSendableError, workoutSlot,
  type WatchTrainingList
} from "./corosBleTrainingProtocol";
import type { CorosWifiMusicIdentity, CorosWifiMusicStatus } from "./corosWifiMusicTypes";
import { connectedWatchfaceTarget, isValidatedWatch, watchfaceBinTarget, watchfaceTargetHardware, watchfaceTargetsForMagic, type WatchfaceTarget } from "./watchfaceTargets";
import { qrCodeDataUrl } from "./qrCode";

const BOND_SETTING = "coros.ble.bond";
const AUTH_SETTING = "coros.ble.accountAuth";
const STATE_SETTING = "coros.ble.stateDirectory";
const BACKEND_SETTING = "coros.ble.backend";
const DEVICE_SETTING = "coros.ble.systemDevice";
interface WorkerResponse { result: CorosNativeBleSnapshot; payload?: string }
const emptyState = (): CorosNativeBleSnapshot => ({
  phase: "idle", available: false, connected: false, encrypted: false,
  systemBind: "unavailable", channels: []
});

/** Who asked for a connection: the user (watch menu), CorosLink for a task the user started, or background sync. */
type ConnectMode = "user" | "internal" | "background";

/** Everything that holds the watch link. busyWith() checks them all, so a new task can't be missed by one guard. */
type LinkTask = "wifiMusic" | "wifiMusicRestore" | "activityScreen" | "localSync" | "push" | "musicInventory" | "musicDelete" |
  "route" | "watchface" | "watchfaceInventory" | "mapStarting" | "mapRemoving" | "connecting" | "scanning" | "closing";

/** What the user is told when the watch is busy with a task (shown in the app as is). */
const BUSY_MESSAGE: Record<LinkTask, string> = {
  wifiMusic: "Wait for the audio sync over Wi-Fi to finish.",
  wifiMusicRestore: "Wait for CorosLink to restore the watch's settings after the audio sync.",
  activityScreen: "Wait for the activity screens to finish syncing.",
  localSync: "Wait for the watch sync to finish.",
  push: "Wait for the transfer to the watch to finish.",
  musicInventory: "Wait for CorosLink to finish with the music on the watch.",
  musicDelete: "Wait for CorosLink to finish with the music on the watch.",
  route: "Wait for the route to finish sending to the watch.",
  watchface: "Wait for the watch face to finish sending to the watch.",
  watchfaceInventory: "Wait for CorosLink to finish reading the watch faces on the watch.",
  mapStarting: "Wait for the map download to start.",
  mapRemoving: "Wait for the watch to cancel the map download.",
  connecting: "Wait for the watch to finish connecting.",
  scanning: "Wait for the Bluetooth scan to finish.",
  closing: "Wait for the watch to disconnect."
};

/**
 * How long Disconnect and quitting wait for a sync, transfer or settings write to finish before the
 * link is cut. A cut can leave the watch without its training plan until the next sync (the old one
 * is removed first) or a setting written without the app knowing.
 */
const FINISH_WATCH_WORK_MS = 30_000;

/** After an answer, requests the watch sent before it arrived (it asks every 5 s) aren't asked again. */
const USB_ACCESS_ANSWER_QUIET_MS = 6_000;
/** After Don't Allow, the watch isn't asked about again for as long as it waits after an Allow. */
const USB_ACCESS_DECLINE_QUIET_MS = 30_000;
/** How long an answer waits for a sync or transfer to free the link. */
const USB_ACCESS_WAIT_MS = 10 * 60_000;

export class CorosNativeBleService {
  private worker?: ChildProcessWithoutNullStreams;
  private state = emptyState();
  private sequence = 0;
  private buffer = "";
  private backendInUse?: CorosBleBackend;
  private pending = new Map<number, {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    operation: string;
    started: number;
    callSite: Error;
  }>();
  /** Recent Bluetooth events, attached to every BLE error for the diagnostics report. */
  private trace = new CorosBleTrace();
  private stopping?: ChildProcessWithoutNullStreams;
  private connecting?: Promise<CorosNativeBleSnapshot>;
  private polling?: Promise<CorosNativeBleSnapshot>;
  private scanning?: Promise<CorosNativeBleSnapshot>;
  private mapPolling?: Promise<CorosWifiMapStatus>;
  private mapStarting?: Promise<{ taskId: string; status: CorosWifiMapStatus }>;
  private mapRemoving?: Promise<void>;
  private routeTask?: Promise<CorosRouteSyncStatus>;
  /** Files and settings pushed like the phone app does: workouts, weather, calendar (CONFIG_TRAINING, SendFile 41/80/42). */
  private pushTask?: Promise<unknown>;
  private routeCancelled = false;
  private notificationSequence = 0;
  private watchfaceTask?: Promise<CorosDirectWatchfaceStatus>;
  private watchfaceInventoryTask?: Promise<CorosDirectWatchfaceInventory>;
  private musicInventoryTask?: Promise<CorosBleMusicInventory>;
  /** A local-data watch sync owns the link for its whole run (SyncData reads must not interleave). */
  private localSyncTask?: Promise<unknown>;
  private localSyncSessionKey?: string;
  /** Developer capture of local-sync frames; set only when COROSLINK_SYNC_CAPTURE is on. */
  private syncCapture?: (entry: CorosSyncCaptureEntry) => void;
  private musicDeleteTask?: Promise<CorosBleMusicDeleteResult>;
  private musicConfirming = false;
  private wifiMusicTask?: Promise<CorosWifiMusicStatus>;
  private activityScreenTask?: Promise<unknown>;
  private readonly activityScreens = new CorosActivityScreenService({
    enabled: () => !app.isPackaged,
    identity: () => {
      this.requireTransferSession();
      if (this.watchTarget()?.model !== "pace-pro") throw new Error("Development activity-screen sync currently supports PACE Pro only.");
      const name = this.state.deviceName ?? "PACE Pro";
      const deviceId = this.state.serialNumber || this.state.deviceId;
      const firmware = this.state.firmwareRevision || this.state.softwareRevision;
      if (!deviceId || !firmware) throw new Error("Refresh the watch connection to read its identity and firmware first.");
      return { key: createHash("sha256").update(JSON.stringify(["pace-pro", deviceId])).digest("hex"), name, model: "pace-pro", firmware };
    },
    session: () => JSON.stringify([this.musicSession(), this.state.firmwareRevision, this.state.softwareRevision]),
    exchange: (opcode, payload) => this.controlCommand(opcode, payload),
    directory: () => path.join(app.getPath("userData"), "activity-screen-backups")
  });
  private readonly wifiMusic = new CorosWifiMusicService({
    identity: () => this.wifiMusicIdentity(),
    // Checked on PACE Pro 3.2008.0 over Mac Bluetooth; other watches, Windows and Linux are open as beta.
    supported: () => this.backendInUse === "system" && Boolean(this.watchTarget()),
    exchange: (opcode, payload) => this.controlCommand(opcode, payload),
    reconnect: async identity => {
      if (this.state.connected && this.state.deviceName !== identity.deviceName) throw new Error("Reconnect the original watch to restore its settings.");
      const credential = this.loadAuth(identity.deviceName);
      if (credential?.accountUserId !== identity.accountUserId) throw new Error("Sign in with the original watch's COROS account to restore its settings.");
      if (this.state.connected && this.state.systemBind !== "authenticated") await this.stop();
      await this.connectOnce(false, { backend: "system", device: { deviceName: identity.deviceName, deviceId: "" } });
    },
    getSetting, setSetting,
    encrypt: value => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is required for Wi-Fi audio sync.");
      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt: value => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is required to restore watch settings.");
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    },
    temporaryDirectory: () => app.getPath("temp"),
  });
  private get wifiMusicBusy(): boolean { return Boolean(this.wifiMusicTask) || this.wifiMusic.hasPendingRestore(); }

  /** The first task holding the link, other than those in `except`; undefined when the link is free. */
  private busyWith(...except: LinkTask[]): LinkTask | undefined {
    const running: Record<LinkTask, () => unknown> = {
      wifiMusic: () => this.wifiMusicTask,
      wifiMusicRestore: () => this.wifiMusic.hasPendingRestore(),
      activityScreen: () => this.activityScreenTask,
      localSync: () => this.localSyncTask,
      push: () => this.pushTask,
      musicInventory: () => this.musicInventoryTask,
      musicDelete: () => this.musicDeleteTask,
      route: () => this.routeTask,
      watchface: () => this.watchfaceTask,
      watchfaceInventory: () => this.watchfaceInventoryTask,
      mapStarting: () => this.mapStarting,
      mapRemoving: () => this.mapRemoving,
      connecting: () => this.connecting,
      scanning: () => this.scanning,
      closing: () => this.closing || this.quitting
    };
    return (Object.keys(running) as LinkTask[]).find(task => !except.includes(task) && Boolean(running[task]()));
  }
  private musicInventory?: { inventory: CorosBleMusicInventory; session: string; expires: number };
  private watchfaceInventory?: { id: string; ids: number[]; device: string; expires: number };
  private watchfaceCancelled = false;
  /**
   * BINs ready to install, by preview ID. Several are kept so a compile in Studio's Send
   * dialog and one on the On watch tab don't invalidate each other.
   */
  private preparedWatchfaces = new Map<string, { preview: CorosDirectWatchfacePreview; file: Buffer; magic: string; expires: number }>();
  private lastPreparedWatchfaceId?: string;
  private watchfaceProgress: CorosDirectWatchfaceStatus = { phase: "idle", sentBytes: 0, totalBytes: 0 };
  private routeProgress: CorosRouteSyncStatus = { phase: "idle", sentBytes: 0, totalBytes: 0 };

  private paths() {
    const stateDirectory = process.env.COROS_BLE_STATE_DIR || getSetting(STATE_SETTING) ||
      path.join(app.getAppPath(), ".work", "ble-monitor");
    const script = app.isPackaged
      ? path.join(process.resourcesPath, "ble", "coros-native-ble.py")
      : path.join(app.getAppPath(), "scripts", "coros-native-ble.py");
    return { stateDirectory, script, python: path.join(stateDirectory, "venv", "bin", "python"),
      importFile: path.join(stateDirectory, "native-bond.json") };
  }

  private systemPaths() {
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const bin = path.join(root, "bin", `${process.platform}-${process.arch}`);
    return { binary: path.join(bin, "coros-corebluetooth"), packages: path.join(bin, "ble-python"),
      python: process.platform === "win32" ? path.join(bin, "python-runtime", "python.exe") : path.join(bin, "python-runtime", "bin", "python3"),
      script: path.join(root, app.isPackaged ? "ble" : "scripts", "coros-system-ble.py") };
  }

  private backends() {
    const files = this.systemPaths();
    const system = process.platform === "darwin" ? fs.existsSync(files.binary)
      : ["win32", "linux"].includes(process.platform) && fs.existsSync(files.python) && fs.existsSync(files.script) &&
        fs.existsSync(path.join(files.packages, "bleak", "__init__.py"));
    return [
      { id: "system" as const, label: process.platform === "darwin" ? "Mac Bluetooth" : process.platform === "win32" ? "Windows Bluetooth" : "System Bluetooth", available: system },
      { id: "usb" as const, label: "USB Bluetooth adapter", available: this.available() }
    ];
  }

  private currentBackend(): CorosBleBackend {
    if (this.backendInUse) return this.backendInUse;
    const saved = getSetting(BACKEND_SETTING);
    if (saved === "system" || saved === "usb") return saved;
    return this.backends()[0]!.available ? "system" : "usb";
  }

  private publicState(): CorosNativeBleSnapshot {
    const backend = this.currentBackend();
    const backends = this.backends();
    const recognized = connectedWatchfaceTarget(this.state);
    return { ...this.state, backend, backends, available: backends.find(item => item.id === backend)?.available ?? false,
      watchModel: recognized?.target.model, watchModelSource: recognized?.source, watchValidated: isValidatedWatch(this.state),
      identityMismatch: this.pendingIdentity && Date.now() - this.pendingIdentity.at < IDENTITY_CONFIRM_MS ? true : undefined };
  }

  /** The connected watch, when CorosLink supports it: by model number, else by advertised name. */
  private watchTarget(): WatchfaceTarget | undefined { return connectedWatchfaceTarget(this.state)?.target; }

  /** What to compile for when nothing else says: the watch that is connected now, if CorosLink supports it. */
  connectedWatchTarget(): WatchfaceTarget | undefined { return this.state.connected ? this.watchTarget() : undefined; }

  /** Ten padded slots is how CorosLink has always read PACE Pro; others report their own count. */
  private readWatchfaceInventory(payload: Buffer): number[] {
    return decodeWatchfaceInventory(payload, this.watchTarget()?.model === "pace-pro");
  }

  private available(): boolean {
    const files = this.paths();
    return fs.existsSync(files.python) && fs.existsSync(files.script) &&
      Boolean(getSetting(BOND_SETTING) || fs.existsSync(files.importFile));
  }

  private loadBond(): unknown {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS secure storage is required to retain the watch's Bluetooth bond.");
    }
    const files = this.paths();
    const saved = getSetting(BOND_SETTING);
    if (saved) return JSON.parse(safeStorage.decryptString(Buffer.from(saved, "base64")));
    const plaintext = fs.readFileSync(files.importFile, "utf8");
    const bond = JSON.parse(plaintext);
    if (!bond.keys?.ltk_central?.value || !bond.watchAddress || !bond.adapterAddress) {
      throw new Error("The imported watch bond is incomplete.");
    }
    setSetting(BOND_SETTING, safeStorage.encryptString(plaintext).toString("base64"));
    setSetting(STATE_SETTING, files.stateDirectory);
    // The one-time Android import is replaced by OS-encrypted storage.
    fs.unlinkSync(files.importFile);
    return bond;
  }

  private startWorker(backend: CorosBleBackend): void {
    if (this.worker) return;
    const { python, script } = this.paths();
    const system = this.systemPaths();
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" };
    // Inherited debugging capture settings must not record the saved bond.
    delete env.BUMBLE_SNOOPER;
    delete env.BUMBLE_LOGLEVEL;
    if (backend === "system" && process.platform !== "darwin") {
      env.PYTHONPATH = system.packages;
      delete env.PYTHONHOME;
    }
    const program = backend === "usb" ? python : process.platform === "darwin" ? system.binary : system.python;
    const args = backend === "usb" ? ["-u", script] : process.platform === "darwin" ? [] : ["-u", system.script];
    const worker = spawn(program, args, { env, stdio: "pipe" });
    this.trace.add("worker start", { backend, pid: worker.pid ?? 0 });
    this.backendInUse = backend;
    this.worker = worker;
    this.buffer = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      if (this.worker !== worker) return;
      this.buffer += chunk;
      if (this.buffer.length > 256_000) {
        this.failWorker(worker, "The Bluetooth worker returned an oversized response.");
        worker.kill();
        return;
      }
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const response = JSON.parse(line);
          if (response.ready) continue;
          if (typeof response.event === "string") {
            this.trace.add(`helper ${response.event}`, response.detail);
            // A drop with nothing waiting has no IPC error to carry the trail. Closing
            // the helper (quit, disconnect) ends the link on purpose: not a drop.
            if (response.event === "disconnected" && this.pending.size === 0 && this.stopping !== worker) {
              recordDiagnosticError("corosBle:link", this.bleError("The watch disconnected.", "link", response.detail));
            }
            // An answer can no longer reach the watch, so its question is withdrawn.
            if (response.event === "disconnected") this.usbAccess?.abort();
            if (response.event === "usb-access-request" || response.event === "usb-access-closed") {
              this.usbAccessEvent(response.event === "usb-access-request");
            }
            continue;
          }
          if (response.bondUpdate) {
            setSetting(BOND_SETTING, safeStorage.encryptString(JSON.stringify(response.bondUpdate)).toString("base64"));
            continue;
          }
          const request = this.pending.get(response.id);
          if (!request) continue;
          clearTimeout(request.timer);
          this.pending.delete(response.id);
          // Kept out of `detail`, which reaches the diagnostics log; frames can hold activity data.
          if (Array.isArray(response.capture)) {
            try {
              this.syncCapture?.({ operation: request.operation, ok: !response.error, ...(response.error ? { error: String(response.error) } : {}), frames: response.capture });
            } catch { /* capture never affects the operation */ }
          }
          const elapsedMs = Date.now() - request.started;
          if (response.error) {
            this.trace.add(`${request.operation} failed`, { elapsedMs, ...(response.detail && typeof response.detail === "object" ? response.detail : {}) });
            const failure = this.bleError(String(response.error), request.operation, response.detail, request.callSite, elapsedMs);
            // A same-named device that isn't the remembered watch (never connected to). Its identity stays out of `detail`.
            const other = normalizeIdentity(response.mismatch?.deviceId);
            request.reject(other ? Object.assign(expectedError(failure), { identityMismatch: other }) : failure);
          } else {
            if (request.operation !== "status") this.trace.add(`${request.operation} ok`, { elapsedMs, phase: response.result?.phase ?? "" });
            if (response.bond) {
              setSetting(BOND_SETTING, safeStorage.encryptString(JSON.stringify(response.bond)).toString("base64"));
            }
            const authenticated = backend === "system" && response.result.connected ? {
              systemBind: this.state.systemBind, authenticatedAt: this.state.authenticatedAt,
              authenticationError: this.state.authenticationError, clockSetAt: this.state.clockSetAt, weatherSentAt: this.state.weatherSentAt,
              weatherFailedAt: this.state.weatherFailedAt
            } : {};
            const gpsAssistance = this.state.gpsAssistance ? { gpsAssistance: this.state.gpsAssistance } : {};
            this.state = { ...response.result, ...authenticated, ...gpsAssistance, backend, available: true };
            request.resolve({ result: this.publicState(), payload: response.payload });
          }
        } catch {
          this.failWorker(worker, "The Bluetooth worker returned an invalid response.");
          worker.kill();
        }
      }
    });
    // Without a listener, a write the helper can no longer take (it exited, or
    // stdin was ended) is thrown as an uncaught exception in the main process.
    worker.stdin.on("error", error => {
      this.trace.add("worker stdin error", { code: (error as NodeJS.ErrnoException).code ?? error.name });
      this.failWorker(worker, "Could not communicate with the Bluetooth worker.");
    });
    // Framework stderr can contain keys. Keep only a recognized exception
    // class or native-crash marker; never retain or log the raw text.
    let failureKind: string | undefined;
    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk: string) => {
      const kinds = ["ModuleNotFoundError", "ImportError", "PermissionError", "FileNotFoundError", "RuntimeError"];
      failureKind = kinds.find(kind => chunk.includes(`${kind}:`)) ?? failureKind;
      if (chunk.includes("libusb") && /assertion|Assertion/.test(chunk)) failureKind = "libusb assertion";
      if (failureKind) this.trace.add("helper stderr", { kind: failureKind });
    });
    worker.on("error", error => {
      this.trace.add("worker spawn error", { code: (error as NodeJS.ErrnoException).code ?? error.name });
      this.failWorker(worker, "Could not start the Bluetooth worker.");
    });
    worker.on("close", (code, signal) => {
      const details = failureKind || signal || (typeof code === "number" ? `exit ${code}` : "unknown exit");
      this.trace.add("worker exit", { code: code ?? "", signal: signal ?? "", kind: failureKind ?? "" });
      const unexpected = this.stopping !== worker && this.worker === worker;
      if (unexpected && this.pending.size === 0) {
        recordDiagnosticError("corosBle:worker", this.bleError(`The Bluetooth worker stopped (${details}).`, "worker"));
      }
      // Requests cut short by a stop CorosLink asked for (quit, disconnect) are not failures to report.
      this.failWorker(worker, `The Bluetooth worker stopped (${details}).`, this.stopping === worker);
    });
  }

  private loadAuth(deviceName?: string): CorosAccountCredential | undefined {
    const loginKey = getSetting(COROS_BLE_LOGIN_KEY_SETTING);
    if (loginKey && !deviceName) return undefined;
    const saved = loginKey || getSetting(AUTH_SETTING);
    if (!saved) return undefined;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS secure storage is required to use the COROS account key.");
    }
    try {
      const credential = JSON.parse(safeStorage.decryptString(Buffer.from(saved, "base64")));
      return loginKey ? createCorosLoginCredential(credential as CorosBleLoginKey, deviceName!) : credential;
    } catch {
      throw new Error("The saved COROS account key could not be opened. Sign in to your COROS account again.");
    }
  }

  /**
   * The QR C-LINK (the iPhone app) scans to authenticate with the watch like this app.
   * The image carries the account key itself (the phone signs with it), so main only
   * hands it to the main window, and the display timeout does not limit a captured code.
   */
  async phonePairingCode(): Promise<CorosPhonePairingCode> {
    const saved = getSetting(COROS_BLE_LOGIN_KEY_SETTING);
    if (!saved) throw new Error("Sign in to your COROS account in Watch Faces first. CorosLink gets the watch key from that sign-in.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secure storage is required to use the COROS account key.");
    let key: CorosBleLoginKey;
    try { key = JSON.parse(safeStorage.decryptString(Buffer.from(saved, "base64"))) as CorosBleLoginKey; }
    catch { throw new Error("The saved COROS account key could not be opened. Sign in to your COROS account again."); }
    let deviceName: string | undefined;
    try { deviceName = (JSON.parse(getSetting(DEVICE_SETTING) ?? "{}") as { deviceName?: unknown }).deviceName as string | undefined; } catch { deviceName = undefined; }
    if (typeof deviceName !== "string" || !deviceName.startsWith("COROS")) deviceName = undefined;
    const issuedAt = Date.now();
    const code = encodePhonePairingCode(key, deviceName, issuedAt);
    // Low error correction keeps the code sparse; a screen doesn't smudge.
    const qrDataUrl = await qrCodeDataUrl(code, { errorCorrectionLevel: "L", margin: 2, width: 520 });
    return { qrDataUrl, issuedAt, expiresAt: issuedAt + PHONE_PAIRING_DISPLAY_MS, account: `•••• ${key.accountUserId.slice(-4)}`, deviceName };
  }

  /** A BLE error carrying the helper's failure site, the issuing call's stack and the recent trail. */
  private bleError(message: string, operation: string, helperDetail?: unknown, callSite?: Error, elapsedMs?: number): CorosBleOperationError {
    return new CorosBleOperationError(message, { operation, elapsedMs, backend: this.backendInUse, helperDetail, trace: this.trace.snapshot() }, callSite);
  }

  private failWorker(worker: ChildProcessWithoutNullStreams, message: string, deliberate = false): void {
    if (this.worker !== worker) return;
    this.trace.add(deliberate ? "worker closed" : "worker failed", { pending: this.pending.size, reason: message });
    this.worker = undefined;
    this.usbAccess?.abort();
    this.musicInventory = undefined;
    this.state = { ...this.state, phase: this.state.phase === "failed" ? "failed" : "disconnected", connected: false, encrypted: false,
      systemBind: this.state.systemBind === "unavailable" ? "unavailable" : "not_authenticated", authenticatedAt: undefined, clockSetAt: undefined, weatherSentAt: undefined, weatherFailedAt: undefined, watchEvents: undefined,
      channels: this.state.channels.map(channel => ({ ...channel, subscribed: false })) };
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      const error = this.bleError(message, request.operation, undefined, request.callSite, Date.now() - request.started);
      request.reject(deliberate ? expectedError(error) : error);
    }
    this.pending.clear();
  }

  private send(operation: string, extra: Record<string, unknown> = {}): Promise<WorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("The Bluetooth worker is not running."));
    // stop() has ended the helper's stdin; it is only waiting for the helper to exit.
    if (this.stopping === worker || worker.stdin.writableEnded) return Promise.reject(expectedError(new Error("The Bluetooth worker is stopping.")));
    const id = ++this.sequence;
    // Captured before the hop to the worker so the error names its caller.
    const callSite = new Error();
    // Results are traced per operation; only link-level requests note when they began.
    if (["connect", "scan", "disconnect"].includes(operation)) this.trace.add(`${operation} sent`);
    return new Promise((resolve, reject) => {
      const timeoutMs = operation === "connect" ? 120_000 : operation === "scan" ? 65_000 : operation === "exchange" ? 20_000 : 50_000;
      const timer = setTimeout(() => {
        this.trace.add(`${operation} timed out`, { timeoutMs });
        this.failWorker(worker, "The Bluetooth operation timed out. Keep the watch nearby and try again.");
        worker.kill();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, operation, started: Date.now(), callSite });
      worker.stdin.write(JSON.stringify({ id, operation, ...extra }) + "\n", error => {
        if (error) {
          this.trace.add("worker stdin error", { code: (error as NodeJS.ErrnoException).code ?? error.name });
          this.failWorker(worker, "Could not communicate with the Bluetooth worker.");
        }
      });
    });
  }

  private async request(operation: string, extra: Record<string, unknown> = {}): Promise<CorosNativeBleSnapshot> {
    return (await this.send(operation, extra)).result;
  }

  async status(): Promise<CorosNativeBleSnapshot> {
    if (this.connecting || this.scanning) return { ...this.publicState(), phase: this.connecting ? "connecting" : "scanning" };
    // A music delete waiting on the user's confirmation keeps the connection status live.
    if (this.busyWith("wifiMusicRestore", ...(this.musicConfirming ? ["musicDelete" as const] : []))) return this.publicState();
    // A helper being stopped (app quit, disconnect) takes no more requests; report what is known.
    if (!this.worker || this.stopping === this.worker) {
      const state = this.publicState();
      return { ...state, phase: state.available ? state.phase : "unavailable" };
    }
    this.polling ??= this.request("status").finally(() => { this.polling = undefined; });
    return this.polling;
  }

  /**
   * Connects for the user (the watch menu). Counted, so a background sync that was
   * connecting at the same moment leaves the connection up (watchAutoSyncService).
   */
  userConnect(pair = false, options: CorosNativeBleConnectOptions = {}): Promise<CorosNativeBleSnapshot> {
    this.userConnects += 1;
    return this.connect(pair, { backend: options.backend, device: options.device, confirmIdentity: options.confirmIdentity === true }, "user");
  }

  private userConnects = 0;

  /** How many times the user has asked to connect since CorosLink started. */
  userConnectCount(): number { return this.userConnects; }

  /**
   * Background sync's connection: only to the remembered watch's Bluetooth identity, never by name alone,
   * and never before one is remembered (watchIdentity.ts).
   */
  connectForBackgroundSync(): Promise<CorosNativeBleSnapshot> {
    if (!this.pinnedWatch("system")) return Promise.reject(expectedError(new WatchIdentityError("unpinned")));
    return this.connect(false, { backend: "system" }, "background");
  }

  connect(pair = false, options: CorosNativeBleConnectOptions = {}, mode: ConnectMode = "internal"): Promise<CorosNativeBleSnapshot> {
    // Transfers that connect on their own (pushes, routes) and an open connection a face or map
    // operation is using are left as they are: connecting then only reads the status.
    const busy = this.busyWith("wifiMusicRestore", "push", "route", "watchface", "watchfaceInventory", "mapStarting", "connecting", "scanning");
    if (busy) return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    this.musicInventory = undefined;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.connectOnce(pair, options, mode);
      if (this.state.connected && this.state.systemBind === "authenticated" && this.wifiMusic.hasPendingRestore()) {
        this.wifiMusicTask = this.wifiMusic.restore().finally(() => { this.wifiMusicTask = undefined; });
        await this.wifiMusicTask;
      }
      return this.publicState();
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async connectOnce(pair: boolean, options: CorosNativeBleConnectOptions, mode: ConnectMode = "internal"): Promise<CorosNativeBleSnapshot> {
    try {
      const backend = options.backend ?? this.currentBackend();
      if (backend !== "system" && backend !== "usb") throw new Error("Unsupported Bluetooth backend.");
      if (this.scanning) await this.scanning;
      if (this.state.connected && this.backendInUse === backend) return await this.request("status");
      if (!this.backends().find(item => item.id === backend)?.available) throw new Error("This Bluetooth backend has not been bundled or configured.");
      // Restart a worker left behind by a remote disconnect. Its USB handle
      // must be released before opening the adapter for another connection.
      if (this.worker) {
        await this.polling?.catch(() => {});
        await this.stop();
      }
      this.backendInUse = backend;
      setSetting(BACKEND_SETTING, backend);
      // Connecting only uses a previously saved account key. Obtaining one
      // requires an explicit COROS sign-in, even when credentials are saved.
      const auth = this.loadAuth();
      if (backend === "system") {
        const saved = getSetting(DEVICE_SETTING);
        const target = options.device ?? (saved ? JSON.parse(saved) : auth ? { deviceName: auth.deviceName } : undefined);
        if (!target || typeof target.deviceName !== "string" || !target.deviceName.startsWith("COROS") || target.deviceName.length > 128) {
          throw new Error("Find and select your COROS watch before connecting.");
        }
        // The remembered watch's identity is checked before anything is signed for or sent (watchIdentity.ts).
        const expected = this.identityToExpect("system", mode, options.confirmIdentity === true, options.device?.deviceId);
        if (expected.refused !== undefined) return await this.refuseIdentity("system", mode, expected.refused, target.deviceName);
        this.state = { ...emptyState(), backend, phase: "connecting", available: true };
        this.startWorker(backend);
        try {
          // With an identity to expect, the helper connects to that device only, or, when it doesn't show up,
          // reads the serial number of a same-named one and keeps it only if that is the remembered watch's.
          await this.request("connect", { deviceName: target.deviceName, deviceId: target.deviceId,
            ...(expected.deviceId ? { pinnedId: expected.deviceId, ...(expected.serialNumber ? { pinnedSerial: expected.serialNumber } : {}) } : {}) });
        } catch (error) {
          const other = (error as { identityMismatch?: string }).identityMismatch;
          if (other) return await this.refuseIdentity("system", mode, other, target.deviceName);
          throw error;
        }
        // Checked again here, whatever the helper did, before the sign-in challenge is answered. A new
        // identity is the remembered watch's only with its serial number (it rotated its address).
        const rotated = Boolean(expected.deviceId) && !sameIdentity(this.state.deviceId, expected.deviceId);
        if (rotated && !sameSerial(this.state.serialNumber, expected.serialNumber)) {
          return await this.refuseIdentity("system", mode, this.state.deviceId ?? "", target.deviceName);
        }
        setSetting(DEVICE_SETTING, JSON.stringify({ deviceName: this.state.deviceName, deviceId: this.state.deviceId }));
        await this.authenticateSystem();
        if (this.state.systemBind === "authenticated") this.rememberIdentity("system", mode, this.state.deviceId, expected.confirmed, rotated);
        // The watch's own 12/24-hour setting is read before the clock is set, so setting it keeps that format.
        const switches = await this.readProfileOnConnect();
        await this.setWatchClock(switches);
        await this.pushOnConnect();
        return this.publicState();
      }
      const { stateDirectory } = this.paths();
      const latestFile = path.join(stateDirectory, "latest-session.txt");
      if (fs.existsSync(latestFile)) {
        const latest = fs.readFileSync(latestFile, "utf8").trim();
        const statusFile = path.join(latest, "status.json");
        if (fs.existsSync(statusFile)) {
          const previous = JSON.parse(fs.readFileSync(statusFile, "utf8"));
          if (!["stopped", "failed"].includes(previous.phase) && previous.bridge_pid) {
            let bridgeRunning = false;
            try { process.kill(previous.bridge_pid, 0); bridgeRunning = true; } catch { /* stopped */ }
            if (bridgeRunning) throw new Error("Close the COROS emulator relay before connecting the USB adapter directly.");
          }
        }
      }
      const bond = this.loadBond();
      // The bond's key encrypts the link, so its watch address is this backend's identity. A new pairing replaces it.
      const bondIdentity = (bond as { watchAddress?: string }).watchAddress;
      const expected = pair ? { confirmed: true } : this.identityToExpect("usb", mode, options.confirmIdentity === true, bondIdentity);
      if ("refused" in expected && expected.refused !== undefined) return await this.refuseIdentity("usb", mode, expected.refused, (bond as { deviceName?: string }).deviceName);
      const usbAuth = this.loadAuth((bond as { deviceName: string }).deviceName);
      this.state = { ...emptyState(), phase: "connecting", available: true };
      this.startWorker(backend);
      const linked = await this.request("connect", { bond, pair, auth: usbAuth, transport: process.env.COROS_BLE_TRANSPORT || "usb:0b05:17cb!" });
      // The helper says what its sign-in learned about the key ("ok", "mismatch", "rejected").
      const keyCheck = (linked as { keyCheck?: unknown }).keyCheck;
      if (usbAuth && (keyCheck === "ok" || keyCheck === "mismatch" || keyCheck === "rejected")) {
        let keyId: string | undefined;
        try { keyId = corosBleLoginKeyId(usbAuth); } catch { keyId = undefined; }
        if (keyId) this.recordKeyCheck(keyCheck, keyId, linked.deviceName ?? (bond as { deviceName?: string }).deviceName);
      }
      if (linked.systemBind === "authenticated") {
        this.rememberIdentity("usb", mode, pair ? (this.loadBond() as { watchAddress?: string }).watchAddress : bondIdentity, expected.confirmed);
      }
      return linked;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect the watch.";
      this.state = { ...this.state, phase: "failed", connected: false, encrypted: false, error: message };
      this.trace.add("connect failed", { backend: this.backendInUse ?? "" });
      await this.stop();
      // Helper failures already carry their site and trail; checks made here get the trail too.
      throw error instanceof CorosBleOperationError || watchIdentityProblem(error) ? error
        : this.bleError(message, "connect", undefined, error instanceof Error ? error : undefined);
    }
  }

  /** Remembers, for Connection details, which watch last accepted or refused the saved key. Best effort. */
  private recordKeyCheck(outcome: "ok" | "mismatch" | "rejected", keyId: string, watch: string | undefined): void {
    try {
      setSetting(COROS_WATCH_KEY_CHECK_SETTING, nextWatchKeyCheck(getSetting(COROS_WATCH_KEY_CHECK_SETTING), outcome, watch || "COROS watch", keyId));
    } catch (error) {
      recordDiagnosticError("corosBle:keyCheck", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async authenticateSystem(): Promise<void> {
    this.state.systemBind = "authenticating";
    try {
      const credential = this.loadAuth(this.state.deviceName ?? "");
      if (!credential) {
        this.state = { ...this.state, systemBind: "unavailable",
          authenticationError: "Sign in to your COROS account in Watch Faces, then reconnect to authenticate your watch." };
        return;
      }
      // The PACE 4 always reports its key's checksum: 0000 there means it holds no key, and nothing is signed.
      const account = new CorosBleAccountAuth(credential, this.state.deviceName ?? "", { keyIdReported: watchReportsKeyId(this.watchTarget()?.model) });
      const base = account.initialPayload();
      const exchange = async (payload: Buffer, maximumWriteBytes: number) => {
        const reply = await this.send("exchange", { opcode: 0xa5, payload: payload.toString("base64"), maximumWriteBytes });
        if (typeof reply.payload !== "string") throw new Error("The watch did not return a COROS authentication response.");
        return Buffer.from(reply.payload, "base64");
      };
      const keyId = formatCorosWatchKeyId(account.keyId);
      const challenge = await exchange(base, 20);
      let authenticated: Buffer;
      try {
        authenticated = account.authenticatedPayload(base, challenge);
      } catch (error) {
        // Refused unsigned: the watch holds a different key, and signing would make it erase that one.
        if (error instanceof CorosBindReplyError && error.keyMismatch) this.recordKeyCheck("mismatch", keyId, this.state.deviceName);
        throw error;
      }
      const bound = await exchange(authenticated, Math.min(240, this.state.maximumWriteBytes ?? 20));
      if (bound.length !== 17 || (bound[0]! & 7) !== BIND_STATUS.success) {
        if (bound.length === 17 && (bound[0]! & 7) === BIND_STATUS.authFailed && bound[10] === BIND_REASON.signatureRejected) {
          this.recordKeyCheck("rejected", keyId, this.state.deviceName);
        }
        throw new CorosBindReplyError(bindRefusalMessage(bound), describeBindReply(bound));
      }
      if (!this.state.connected) throw new CorosBindReplyError(BIND_MESSAGES.rejected, describeBindReply(bound));
      // The reply also says which satellite data the watch takes and when its current data runs out.
      this.state = { ...this.state, systemBind: "authenticated", authenticatedAt: Date.now(), gpsAssistance: decodeBindGpsAssistance(bound) };
      this.recordKeyCheck("ok", keyId, this.state.deviceName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "COROS authentication did not complete.";
      this.state = { ...this.state, systemBind: "failed", authenticationError: message };
      // The card only shows the message. The report also names the watch and
      // what it replied, since only PACE Pro's replies have been checked.
      const watch = `${this.state.modelNumber || "unknown model"} ${this.state.softwareRevision || this.state.firmwareRevision || "unknown firmware"}`;
      const reply = error instanceof CorosBindReplyError ? `watch reply ${error.reply}` : "no watch reply decoded";
      this.trace.add("authenticate failed", { reply: error instanceof CorosBindReplyError ? error.reply : "" });
      recordDiagnosticError("corosBle:authenticate", Object.assign(new Error(`${message} [${watch}; ${reply}]`), {
        name: error instanceof Error ? error.name : "Error", stack: error instanceof Error ? error.stack : undefined,
        context: error instanceof CorosBleOperationError ? error.context : this.bleError(message, "authenticate").context
      }));
    }
  }

  /**
   * Sets the watch's clock and time zone from this computer, as the phone app
   * does on every connection. The message also carries the 12/24-hour format:
   * the watch's own setting, as read on this connection, so setting the clock
   * never changes it. When it can't be read, the clock isn't set on this
   * connection. Only on models whose firmware was checked: elsewhere bit 13 may
   * mean something else, and the computer's format may not be the watch's.
   * Best effort: a refusal is recorded and never fails the connection.
   */
  private async setWatchClock(switches?: Buffer): Promise<void> {
    if (!this.state.connected || this.state.systemBind !== "authenticated" || this.backendInUse !== "system") return;
    if (!watchSupports("clockFormat", this.watchTarget()?.model)) {
      this.trace.add("clock not set", { reason: "model not checked" });
      return;
    }
    try {
      const hour12 = hour12From(switches) ?? hour12From(await this.readSwitches().then(read => read.word, () => undefined));
      if (hour12 === undefined) {
        this.trace.add("clock not set", { reason: "12/24-hour format unknown" });
        recordDiagnosticNotice("corosBle:setClock", "The watch's 12/24-hour format couldn't be read, so its clock wasn't set on this connection.", "warning");
        return;
      }
      while (nearLocalMidnight(new Date())) await new Promise(resolve => setTimeout(resolve, 2_000));
      const reply = await this.send("exchange", { opcode: SYNC_TIME_OPCODE, payload: encodeSyncTime(new Date(), hour12).toString("base64"), maximumWriteBytes: 20 });
      requireWatchAcknowledgement(Buffer.from(typeof reply.payload === "string" ? reply.payload : "", "base64"), "time and time zone");
      this.state = { ...this.state, clockSetAt: Date.now() };
      this.trace.add("clock set", {});
    } catch (error) {
      this.trace.add("clock set failed", {});
      recordDiagnosticError("corosBle:setClock", error instanceof Error ? error : new Error(String(error)));
    }
  }

  scan(): Promise<CorosNativeBleSnapshot> {
    if (this.scanning) return this.scanning;
    const busy = this.busyWith("wifiMusicRestore", "connecting");
    if (busy) return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    this.scanning = (async () => {
      if (this.connecting) await this.connecting;
      if (this.state.connected) throw new Error("Disconnect the watch before scanning.");
      await this.stop();
      if (!this.backends()[0]!.available) throw new Error("System Bluetooth is not available in this build.");
      this.backendInUse = "system";
      this.state = { ...emptyState(), backend: "system", phase: "scanning" };
      this.startWorker("system");
      const found = await this.request("scan");
      const pinned = this.pinnedWatch("system");
      if (!pinned || !this.state.discoveredDevices) return found;
      this.state.discoveredDevices = this.state.discoveredDevices.map(device => ({ ...device, remembered: sameIdentity(device.deviceId, pinned.deviceId) }));
      return this.publicState();
    })().finally(() => { this.scanning = undefined; });
    return this.scanning;
  }

  refresh(): Promise<CorosNativeBleSnapshot> {
    const busy = this.busyWith("wifiMusicRestore");
    if (busy === "localSync" || busy === "musicInventory" || busy === "musicDelete") return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    if (busy) return Promise.resolve(this.publicState());
    return this.request("refresh");
  }

  /** Writes CorosLink has checked only against some watches' firmware (localSync/watchSyncModels.ts). */
  private requireWatchFeature(feature: WatchFeature): void {
    if (!watchSupports(feature, this.watchTarget()?.model)) throw new Error(NOT_AVAILABLE_ON_WATCH);
  }

  /** Validated on PACE Pro 3.2008.0; every other watch CorosLink recognizes is open as beta. */
  private requireTransferSession(): void {
    if (!this.state.connected || this.state.systemBind !== "authenticated") {
      throw new Error("Connect and authenticate your COROS watch before transferring maps, routes or watch faces.");
    }
    if (!this.watchTarget()) {
      throw new Error(`CorosLink doesn't support transfers to ${this.state.deviceName ?? "this watch"} (model ${this.state.modelNumber || "unknown"}) yet.`);
    }
  }

  listMusic(): Promise<CorosBleMusicInventory> {
    if (this.wifiMusicBusy) return Promise.reject(new Error("Wait for Wi-Fi audio sync and settings restoration before reading music."));
    if (this.musicInventoryTask) return this.musicInventoryTask;
    if (this.busyWith()) {
      return Promise.reject(new Error("Wait for the current Bluetooth operation to finish before reading music."));
    }
    this.musicInventoryTask = (async () => {
      await this.polling;
      await this.mapPolling;
      return this.readMusicInventory();
    })().finally(() => { this.musicInventoryTask = undefined; });
    return this.musicInventoryTask;
  }

  /**
   * Runs a local-data sync (activities or day totals) with exclusive use of the
   * link. Only read-only SyncData files and the step summary are reachable.
   */
  runLocalSync<T>(task: () => Promise<T>): Promise<T> {
    if (this.localSyncTask) return Promise.reject(new Error("A watch sync is already running."));
    const busy = this.busyWith();
    if (busy) return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    const run = (async () => {
      await this.polling;
      await this.mapPolling;
      this.requireMusicSession();
      this.localSyncSessionKey = this.musicSession();
      return task();
    })();
    const tracked = run.finally(() => { this.localSyncTask = undefined; this.localSyncSessionKey = undefined; });
    this.localSyncTask = tracked;
    return tracked;
  }

  isLocalSyncRunning(): boolean { return Boolean(this.localSyncTask); }

  /** Stops a local sync's reads at the next block (localDataService.cancelSync), so a disconnect doesn't wait for them. */
  private localSyncCancel?: () => void;

  setLocalSyncCancel(cancel: () => void): void {
    this.localSyncCancel = cancel;
  }

  /** From inside a local sync: closes the link now, without waiting for the sync (a block request that failed partway). */
  resetLinkInSync(): Promise<CorosNativeBleSnapshot> {
    return this.closeLink();
  }

  /** Once Disconnect or quitting has started, a sync starts nothing more on the watch. */
  private refuseWhileClosing(): void {
    if (this.closing || this.quitting) throw expectedError(new Error(BUSY_MESSAGE.closing));
  }

  setLocalSyncCapture(sink: ((entry: CorosSyncCaptureEntry) => void) | undefined): void {
    this.syncCapture = sink;
  }

  private captureFlag(): { capture?: true } {
    return this.syncCapture ? { capture: true } : {};
  }

  /** The connected, authenticated watch as local sync sees it (no serial number leaves this method). */
  localSyncWatch(): { serialOrName: string; name?: string; model?: WatchModelId; firmware?: string } | undefined {
    if (!this.state.connected || this.state.systemBind !== "authenticated" || this.backendInUse !== "system") return undefined;
    const serialOrName = this.state.serialNumber || this.state.watchAddress || this.state.deviceName;
    if (!serialOrName) return undefined;
    // The model is recognised in publicState(); the raw worker state never carries it.
    return { serialOrName, name: this.state.deviceName, model: connectedWatchfaceTarget(this.state)?.target.model, firmware: this.state.firmwareRevision ?? this.state.softwareRevision };
  }

  private requireLocalSyncSession(): void {
    if (!this.localSyncTask) throw new Error("Watch sync reads run only inside a local sync.");
    this.requireMusicSession();
    if (this.localSyncSessionKey !== this.musicSession()) throw new Error("The connected watch changed during sync. Sync again.");
  }

  /** One verified SyncData block, never acknowledged (no transport can). The worker replies [remaining u32][block]. */
  async readSyncFileBlock(fileIndex: number, offset: number, selector: number): Promise<{ block: Buffer; remaining: number }> {
    this.requireLocalSyncSession();
    this.refuseWhileClosing();
    assertReadableSyncFile(fileIndex);
    const response = await this.send("syncFileBlock", { fileIndex, offset, selector, ...this.captureFlag() });
    this.requireLocalSyncSession();
    if (typeof response.payload !== "string") throw new Error("The watch did not return the requested records.");
    const payload = Buffer.from(response.payload, "base64");
    if (payload.length < 5) throw new Error("The watch returned an empty record block.");
    return { remaining: payload.readUInt32LE(0), block: payload.subarray(4) };
  }

  /** The training plans the watch holds (CONFIG_TRAINING, kind plan), by id, inside a local sync. Read-only. */
  async listTrainingPlansInSync(): Promise<string[]> {
    this.requireLocalSyncSession();
    this.refuseWhileClosing();
    this.requireTransferSession();
    return (await this.readTrainingList(TRAINING_KIND.plan)).entries.map(entry => entry.id);
  }

  /**
   * Puts the training calendar on the watch (SendFile 42) inside a local sync and reports
   * whether the watch lists it afterwards. The watch keeps one plan, so the plan it holds is
   * removed first, as the app does, but only when the caller named it in `replace`: CorosLink's own, or one the user agreed to replace. Any
   * other plan stops the push before anything changes. A transfer that fails once blocks
   * have gone out is reset by disconnecting.
   */
  async sendTrainingPlanInSync(file: Buffer, replace: readonly string[]): Promise<{ listed: boolean }> {
    this.requireLocalSyncSession();
    this.refuseWhileClosing();
    this.requireTransferSession();
    this.requireWatchFeature("calendar");
    const before = await this.readTrainingList(TRAINING_KIND.plan);
    if (before.entries.some(entry => !replace.includes(entry.id))) throw new Error("The watch's training plan changed during the sync. Sync again.");
    if (before.entries.length) {
      const held = before.entries.map(entry => ({ id: entry.id, slot: 0 }));
      requireWatchAcknowledgement(await this.controlCommand(CONFIG_TRAINING_OPCODE, encodeTrainingDeleteRequest(TRAINING_KIND.plan, held)), "training calendar update");
    }
    let started = false;
    try {
      for (let offset = 0; offset < file.length; offset += TRAINING_BLOCK_BYTES) {
        this.requireLocalSyncSession();
        const block = file.subarray(offset, offset + TRAINING_BLOCK_BYTES);
        started = true;
        await this.send("dataFileBlock", { fileId: TRAINING_PLAN_FILE, header: encodeTrainingBlockHeader(TRAINING_PLAN_FILE, block, offset, file.length, TRAINING_PLAN_SYNC_FLAG).toString("base64"), block: block.toString("base64") });
      }
    } catch (error) {
      // The old plan is gone and the new one is half sent: reset the transfer, as other failed transfers do.
      if (started) await this.closeLink().catch(() => this.stop());
      recordDiagnosticError("corosBle:trainingCalendar", error instanceof Error ? error : new Error(String(error)));
      throw new Error("The training calendar didn't finish sending. Sync again to send it.");
    }
    // The watch parses the plan after the last block; give it a moment, as for a single workout.
    for (let attempt = 0; attempt < 4; attempt++) {
      const plans = await this.readTrainingList(TRAINING_KIND.plan);
      if (plans.entries.some(entry => entry.id === LOCAL_PLAN_ID.toString())) return { listed: true };
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const after = await this.readTrainingList(TRAINING_KIND.plan).catch(() => undefined);
    const describe = (list?: WatchTrainingList) => list ? `${list.entries.length}/${list.maxCount} [${list.entries.map(entry => `${entry.id}@${entry.slot}v${entry.version}`).join(",")}] max ${list.maxBytes} B` : "unreadable";
    recordDiagnosticError("corosBle:trainingCalendar", new Error(`The watch did not list the training calendar [file ${file.length} B; plans before ${describe(before)}; after ${describe(after)}]`));
    return { listed: false };
  }

  /** The watch's satellite data as read on this connection (bind reply, then settings type 13 once a sync has read it). */
  localSyncGpsAssistance(): WatchGpsAssistance | undefined {
    return this.state.connected ? this.state.gpsAssistance : undefined;
  }

  /**
   * Reads settings type 13 (FW_INFO) inside a local sync, as the app does after binding: which
   * satellite files the watch takes and the start of what it holds. Read-only. A reply without
   * satellite figures leaves the bind reply's in place.
   */
  async readGpsAssistanceInSync(): Promise<WatchGpsAssistance | undefined> {
    this.requireLocalSyncSession();
    this.refuseWhileClosing();
    this.requireTransferSession();
    const payload = decodeSettings(await this.controlCommand(SETTINGS_GET_OPCODE, encodeSettingsRequest([SETTING_FW_INFO]))).get(SETTING_FW_INFO);
    if (payload?.length) {
      const updated = applyFwInfoGpsAssistance(this.state.gpsAssistance, payload);
      if (updated) this.state = { ...this.state, gpsAssistance: updated };
    }
    return this.state.gpsAssistance;
  }

  /**
   * Sends one COROS satellite file (corosWatchCep.ts) inside a local sync, as the app does: the whole
   * file in an HF header, in 4 KB blocks, the start hour in every block header. Only a format checked
   * in this model's firmware (watchSyncModels.ts) is sent. A transfer that fails once blocks have gone
   * out is reset by disconnecting; the watch's CRC check keeps it from using a partial file.
   */
  async sendSatelliteFileInSync(file: CepFile): Promise<void> {
    this.requireLocalSyncSession();
    this.refuseWhileClosing();
    this.requireTransferSession();
    this.requireWatchFeature("satelliteData");
    if (!watchTakesSatelliteFormat(file.format, this.watchTarget()?.model)) throw new Error(NOT_AVAILABLE_ON_WATCH);
    const { fileId, bytes, extra } = encodeCepTransfer(file);
    let started = false;
    try {
      for (let offset = 0; offset < bytes.length; offset += TRAINING_BLOCK_BYTES) {
        this.requireLocalSyncSession();
        const block = bytes.subarray(offset, offset + TRAINING_BLOCK_BYTES);
        started = true;
        await this.send("dataFileBlock", { fileId, header: encodeTrainingBlockHeader(fileId, block, offset, bytes.length, extra).toString("base64"), block: block.toString("base64") });
      }
    } catch (error) {
      if (started) await this.closeLink().catch(() => this.stop());
      recordDiagnosticError("corosBle:satelliteData", error instanceof Error ? error : new Error(String(error)));
      throw new Error("The satellite data didn't finish sending. Sync again to send it.");
    }
    // What the watch now holds, until it reports its own figure: a later sync on this connection
    // sends this file again only if COROS has a newer one, and Connection details shows it.
    const assist = this.state.gpsAssistance;
    if (assist) {
      const sent = { ...assist.sent, [file.format]: file.startHour };
      const holds: Partial<WatchGpsAssistance> = file.format === "synaptics-rto"
        ? { eph: { fileType: assist.eph?.fileType ?? 0x10001, epoType: assist.eph?.epoType ?? 1, durationHours: assist.eph?.durationHours ?? file.hours, startHour: file.startHour } }
        : file.format === "elpo-ahead"
          ? { second: { durationHours: assist.second?.durationHours ?? file.hours, startHour: file.startHour } }
          : { startHour: file.startHour, durationHours: file.hours, validUntil: unixMsOfWatchHour(file.startHour + file.hours) };
      this.state = { ...this.state, gpsAssistance: { ...assist, ...holds, sent } };
    }
  }

  /** Today's running totals (GetPedometer, 0x90). */
  async readPedometer(payload: Buffer): Promise<Buffer> {
    this.requireLocalSyncSession();
    this.refuseWhileClosing();
    this.requireTransferSession();
    if (payload.length > 4) throw new Error("Invalid step summary request.");
    const response = await this.send("exchange", { opcode: PEDOMETER_OPCODE, payload: payload.toString("base64"), maximumWriteBytes: 20, ...this.captureFlag() });
    if (typeof response.payload !== "string") throw new Error("The watch did not answer the step summary request.");
    return Buffer.from(response.payload, "base64");
  }

  private requireMusicSession(): void {
    this.requireTransferSession();
    // The USB adapter worker only carries control exchanges and route blocks.
    if (this.backendInUse !== "system") {
      throw new Error("Bluetooth music needs this computer's Bluetooth, not the USB adapter.");
    }
  }

  private wifiMusicIdentity(): CorosWifiMusicIdentity {
    this.requireMusicSession();
    const credential = this.loadAuth(this.state.deviceName ?? "");
    if (!credential) throw new Error("Authenticate your watch before sending audio over Wi-Fi.");
    return { deviceName: this.state.deviceName!, serialNumber: this.state.serialNumber, accountUserId: credential.accountUserId };
  }

  private requireWifiMusicIdle(): void {
    if (this.busyWith()) throw new Error("Wait for the current Bluetooth operation and settings restoration to finish.");
    this.requireMusicSession();
  }

  wifiMusicStatus(): CorosWifiMusicStatus { return this.wifiMusic.status(); }

  sendMusicOverWifi(pickFiles: () => Promise<string[] | null>): Promise<CorosWifiMusicStatus> {
    this.requireWifiMusicIdle();
    this.wifiMusicTask = (async () => {
      await this.polling; await this.mapPolling;
      this.wifiMusic.choosing();
      const files = await pickFiles();
      return files?.length ? this.wifiMusic.send(files) : this.wifiMusic.selectionCancelled();
    })().catch(error => { if (!this.wifiMusic.hasPendingRestore()) this.wifiMusic.selectionCancelled(); throw error; })
      .finally(() => { this.wifiMusicTask = undefined; });
    return this.wifiMusicTask;
  }

  importWifiMusicBackup(pickFile: () => Promise<string | null>): Promise<CorosWifiMusicStatus> {
    this.requireWifiMusicIdle();
    this.wifiMusicTask = (async () => {
      await this.polling; await this.mapPolling;
      this.wifiMusic.choosing();
      const file = await pickFile();
      return file ? this.wifiMusic.importBackup(file) : this.wifiMusic.selectionCancelled();
    })().catch(error => { if (!this.wifiMusic.hasPendingRestore()) this.wifiMusic.selectionCancelled(); throw error; })
      .finally(() => { this.wifiMusicTask = undefined; });
    return this.wifiMusicTask;
  }

  restoreWifiMusicSettings(): Promise<CorosWifiMusicStatus> {
    if (this.busyWith("wifiMusicRestore")) {
      return Promise.reject(new Error("Wait for the current Bluetooth operation to finish."));
    }
    this.requireMusicSession();
    this.wifiMusicTask = (async () => { await this.polling; await this.mapPolling; return this.wifiMusic.restore(); })()
      .finally(() => { this.wifiMusicTask = undefined; });
    return this.wifiMusicTask;
  }

  cancelWifiMusicSync(): void { this.wifiMusic.cancel(); }
  isWifiMusicActive(): boolean { return Boolean(this.wifiMusicTask) && this.wifiMusic.status().phase !== "choosing"; }
  async finishWifiMusicBeforeQuit(): Promise<void> {
    this.wifiMusic.cancel();
    await this.wifiMusicTask?.catch(() => undefined);
  }

  private musicSession(): string {
    return JSON.stringify([this.backendInUse, this.state.deviceId, this.state.watchAddress,
      this.state.deviceName, this.state.serialNumber, this.state.authenticatedAt]);
  }

  private async readMusicInventory(): Promise<CorosBleMusicInventory> {
    this.requireMusicSession();
    this.musicInventory = undefined;
    const session = this.musicSession();
    const tracks: CorosBleMusicInventory["tracks"] = [];
    const ids = new Set<string>();
    try {
      for (let page = 0; page < 256; page++) {
        const response = await this.send("musicInventoryPage", { page });
        this.requireMusicSession();
        if (session !== this.musicSession()) throw new Error("The connected watch changed. Read its music again.");
        if (typeof response.payload !== "string") throw new Error("The watch did not return its music inventory.");
        const rows = decodeMusicInventoryPage(Buffer.from(response.payload, "base64"));
        if (rows.length > 20) throw new Error("The watch returned an unsupported music page.");
        for (const row of rows) {
          const key = JSON.stringify([row.watchId, row.name]);
          if (ids.has(key)) throw new Error("The watch's music library changed while reading. Read it again.");
          ids.add(key); tracks.push(row);
        }
        if (rows.length < 20) {
          const inventory = { id: randomUUID(), deviceName: this.state.deviceName, tracks, checkedAt: Date.now() };
          this.musicInventory = { inventory: { ...inventory, tracks: tracks.map(track => ({ ...track })) }, session, expires: inventory.checkedAt + 15 * 60_000 };
          return inventory;
        }
      }
      throw new Error("The watch's music library exceeds the supported listing size.");
    } catch (error) {
      // Release an interrupted SFT read before another transfer can start.
      await this.closeLink().catch(() => undefined);
      throw error;
    }
  }

  deleteMusic(target: CorosBleMusicDeleteTarget, confirm: (track: CorosBleMusicTrack) => Promise<boolean>): Promise<CorosBleMusicDeleteResult> {
    if (this.wifiMusicBusy) return Promise.reject(new Error("Wait for Wi-Fi audio sync and settings restoration before deleting music."));
    if (this.busyWith()) {
      return Promise.reject(new Error("Wait for the current Bluetooth operation to finish before deleting music."));
    }
    const cached = this.musicInventory;
    const selected = cached?.inventory.tracks.find(track => track.watchPath === target?.watchPath && track.watchId === target?.watchId);
    if (!cached || cached.inventory.id !== target?.inventoryId || cached.expires < Date.now() || cached.session !== this.musicSession() || !selected) {
      return Promise.reject(new Error("Read the watch's music again before deleting a track."));
    }
    this.musicDeleteTask = (async () => {
      let started = false;
      let transportFinished = false;
      const check = () => {
        this.requireMusicSession();
        if (cached.session !== this.musicSession()) throw new Error("The connected watch changed. Read its music again.");
      };
      try {
        await this.polling;
        await this.mapPolling;
        check();
        let confirmed: boolean;
        this.musicConfirming = true;
        try { confirmed = await confirm({ ...selected }); }
        finally { this.musicConfirming = false; }
        await this.polling;
        if (!confirmed) return { deleted: false, inventory: cached.inventory };
        check();
        if (cached.expires < Date.now()) throw new Error("The music list expired. Refresh it and choose the track again.");
        const before = await this.readMusicInventory();
        check();
        const track = before.tracks.find(row => row.watchPath === selected.watchPath && row.watchId === selected.watchId && row.sizeBytes === selected.sizeBytes);
        if (!track) throw new Error("This track changed on the watch. Refresh its music and choose it again.");
        const file = encodeMusicDeleteFile(track);
        this.musicInventory = undefined;
        started = true;
        const response = await this.send("musicDelete", { header: encodeMusicDeleteHeader(file).toString("base64"), block: file.toString("base64") });
        check();
        if (typeof response.payload !== "string") throw new Error("The watch did not confirm music deletion.");
        const reply = Buffer.from(response.payload, "base64");
        transportFinished = reply.length === 4 && reply[0] === 1 && reply[1] === 1 && reply[2] === 0;
        requireMusicDeleteAcknowledgement(reply);
        const after = await this.readMusicInventory();
        check();
        if (after.tracks.some(row => row.watchPath === track.watchPath)) throw new Error("The watch still lists this track. Refresh its music before trying again.");
        return { deleted: true, inventory: after };
      } catch (error) {
        this.musicInventory = undefined;
        if (started && !transportFinished && this.state.connected && cached.session === this.musicSession()) await this.closeLink().catch(() => undefined);
        throw error;
      }
    })().finally(() => { this.musicDeleteTask = undefined; });
    return this.musicDeleteTask;
  }

  async sendNotification(input: CorosNotificationInput): Promise<{ sent: true; fragments: number }> {
    if (this.wifiMusicBusy) throw new Error("Wait for Wi-Fi audio sync and settings restoration before sending a message.");
    // A periodic RSSI/status read can finish before a user-initiated send.
    // Keep the busy guard for transfers and other writes.
    if (this.polling) await this.polling;
    await this.mapPolling?.catch(() => {});
    if (this.busyWith() || this.pending.size) {
      throw new Error("Wait for the current Bluetooth operation to finish before sending a message.");
    }
    if (!this.state.connected || this.state.systemBind !== "authenticated") {
      throw new Error("Connect and authenticate your COROS watch before sending a message.");
    }
    if (!this.watchTarget()) {
      throw new Error(`CorosLink doesn't support messages on ${this.state.deviceName ?? "this watch"} yet.`);
    }
    if (this.backendInUse !== "system") {
      throw new Error("Notification messages need this computer's Bluetooth, not the USB adapter.");
    }
    const sequence = (this.notificationSequence + 1) & 127;
    const frames = encodeNotificationFrames(input, Math.min(20, this.state.maximumWriteBytes ?? 20), sequence);
    this.notificationSequence = sequence;
    await this.send("sendNotification", { frames: frames.map(frame => frame.toString("base64")) });
    return { sent: true, fragments: frames.length };
  }

  private async controlCommand(opcode: number, payload: Buffer): Promise<Buffer> {
    this.requireTransferSession();
    const response = await this.send("exchange", { opcode, payload: payload.toString("base64"), maximumWriteBytes: 20 });
    if (typeof response.payload !== "string") throw new Error("The watch did not answer the Bluetooth command.");
    return Buffer.from(response.payload, "base64");
  }

  private activityScreenOperation<T>(task: () => Promise<T> | T): Promise<T> {
    if (app.isPackaged) return Promise.reject(new Error("Activity-screen sync is available only in development builds."));
    if (this.busyWith() || (this.pending.size && !this.polling && !this.mapPolling)) {
      return Promise.reject(new Error("Wait for the current Bluetooth operation before working on activity pages."));
    }
    const operation = (async () => {
      await this.polling;
      await this.mapPolling;
      return task();
    })().finally(() => { this.activityScreenTask = undefined; });
    this.activityScreenTask = operation;
    return operation;
  }
  activityScreenStatus() { return this.activityScreens.status(); }
  activityScreenBackups() { return this.activityScreens.backups(); }
  exportActivityScreenBackup(id: string) { return this.activityScreens.exportBackup(id); }
  listActivityScreenSports() { return this.activityScreenOperation(() => this.activityScreens.sports()); }
  readActivityScreens(sportId: number) { return this.activityScreenOperation(() => this.activityScreens.read(sportId)); }
  backupActivityScreens(snapshotId: string) { return this.activityScreenOperation(() => this.activityScreens.backup(snapshotId)); }
  syncActivityScreenBaseline(snapshotId: string) { return this.activityScreenOperation(() => this.activityScreens.syncBaseline(snapshotId)); }
  confirmActivityScreenBaseline(snapshotId: string) { return this.activityScreenOperation(() => this.activityScreens.confirmBaseline(snapshotId)); }
  previewActivityScreenLayout(snapshotId: string, pageIndex: number, fieldCount: number) {
    return this.activityScreenOperation(() => this.activityScreens.preview(snapshotId, pageIndex, fieldCount));
  }
  applyActivityScreenLayout(previewId: string) { return this.activityScreenOperation(() => this.activityScreens.apply(previewId)); }
  restoreActivityScreens(backupId: string) { return this.activityScreenOperation(() => this.activityScreens.restore(backupId)); }

  async previewWifiMap(tiles: unknown): Promise<CorosWifiMapPreview> {
    this.requireTransferSession();
    // COROS packages map tiles per watch model.
    return previewWifiMap(tiles, watchfaceTargetHardware(this.watchTarget()!));
  }

  wifiMapStatus(): Promise<CorosWifiMapStatus> {
    this.mapPolling ??= (async () => {
      if (this.connecting) await this.connecting;
      // The list is read after a cancel, never alongside it.
      if (this.mapRemoving) await this.mapRemoving.catch(() => undefined);
      const state = this.publicState();
      const recognized = connectedWatchfaceTarget(state)?.target;
      const result: CorosWifiMapStatus = { supported: Boolean(recognized), watchLabel: recognized?.label, validated: isValidatedWatch(state),
        connected: state.connected, authenticated: state.systemBind === "authenticated", deviceName: state.deviceName,
        tasks: [], updatedAt: Date.now() };
      // A map download being started reads this status itself.
      if (!result.supported || !result.connected || !result.authenticated || this.busyWith("mapStarting", "connecting", "scanning")) return result;
      const wifi = await this.controlCommand(0xb2, Buffer.from([5]));
      if (wifi.length !== 2 || wifi[0] !== 1) throw new Error("The watch returned an unsupported Wi-Fi status.");
      result.wifiStateCode = wifi[1];
      result.tasks = decodeWifiMapTasks(await this.controlCommand(0xb6, Buffer.from([0x0b, 0xff])));
      return result;
    })().finally(() => { this.mapPolling = undefined; });
    return this.mapPolling;
  }

  downloadWifiMap(previewId: string): Promise<{ taskId: string; status: CorosWifiMapStatus }> {
    const busy = this.busyWith();
    if (busy === "mapStarting") throw new Error("A map download is already being prepared.");
    if (busy) throw new Error(BUSY_MESSAGE[busy]);
    this.mapStarting = (async () => {
      this.requireTransferSession();
      await this.mapPolling?.catch(() => {});
      requireWifiDownloadReady(await this.controlCommand(0xb6, Buffer.from([0x19])));
      const taskId = await createWifiMapTask(previewId, watchfaceTargetHardware(this.watchTarget()!));
      const accepted = await this.controlCommand(0xb6, encodeWifiMapStart(taskId));
      if (accepted.length !== 1 || accepted[0] !== 1) throw new Error("The watch rejected the map download request.");
      return { taskId, status: await this.wifiMapStatus() };
    })().finally(() => { this.mapStarting = undefined; });
    return this.mapStarting;
  }

  /** Takes a map download off the watch's list before (or while) it runs over Wi-Fi, then reads the list again. */
  removeWifiMapDownload(taskId: string): Promise<CorosWifiMapStatus> {
    const busy = this.busyWith();
    if (busy) return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    this.mapRemoving = (async () => {
      this.requireTransferSession();
      await this.mapPolling?.catch(() => {});
      requireWifiTaskRemoved(await this.controlCommand(0xb6, encodeWifiTaskRemove(taskId)));
    })().finally(() => { this.mapRemoving = undefined; });
    return this.mapRemoving.then(() => this.wifiMapStatus());
  }

  routeSyncStatus(): CorosRouteSyncStatus { return { ...this.routeProgress }; }

  cancelRouteSync(): void { if (this.routeTask) this.routeCancelled = true; }

  private pushOperation<T>(task: () => Promise<T>): Promise<T> {
    const busy = this.busyWith();
    if (busy) return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    const operation = (async () => {
      await this.mapPolling?.catch(() => {});
      await this.polling?.catch(() => {});
      if (!this.state.connected) await this.connect(false);
      this.requireTransferSession();
      return task();
    })().finally(() => { this.pushTask = undefined; });
    this.pushTask = operation;
    return operation;
  }

  /**
   * Sends one pushed file block by block. A transfer the watch broke off after
   * accepting data is reset by disconnecting; a refused first header leaves
   * nothing open on the watch, so the connection stays.
   */
  private async pushDataFile(fileId: number, file: Buffer, slot: number): Promise<void> {
    let accepted = 0;
    try {
      for (let offset = 0; offset < file.length; offset += TRAINING_BLOCK_BYTES) {
        this.requireTransferSession();
        const block = file.subarray(offset, offset + TRAINING_BLOCK_BYTES);
        await this.send("dataFileBlock", { fileId, header: encodeTrainingBlockHeader(fileId, block, offset, file.length, slot).toString("base64"), block: block.toString("base64") });
        accepted += 1;
      }
    } catch (error) {
      if (accepted > 0) await this.closeLink().catch(() => this.stop());
      throw error;
    }
  }

  /** Called after each authenticated connection (the clock is already set): weather, for one. */
  private connectedHook?: () => Promise<Buffer | undefined>;

  /**
   * Nothing is in progress, so a background sync can't interrupt the user. The watch may be
   * connected: the sync then uses that connection and leaves it up (watchAutoSyncService).
   */
  idleForBackgroundSync(): boolean {
    // A worker can outlive a remote disconnect; connect() restarts it.
    return this.pending.size === 0 && !this.busyWith("wifiMusicRestore");
  }

  /** A watch link is up (any backend); a background sync then leaves it connected. */
  isConnected(): boolean {
    return this.state.connected;
  }

  /** A device that answered with the remembered name but another identity, until the user decides. */
  private pendingIdentity?: { backend: CorosBleBackend; deviceId: string; deviceName?: string; at: number };
  private identityListeners = new Set<() => void>();

  private pinnedWatch(backend: CorosBleBackend): PinnedWatch | undefined {
    return parsePinnedWatches(getSetting(WATCH_IDENTITY_SETTING))[backend];
  }

  /**
   * Which identity this connection must have. A "Connect anyway" for the device just refused trusts that one;
   * otherwise the remembered one, if any, and its serial number. A device the user chose that isn't it is
   * refused before connecting.
   */
  private identityToExpect(backend: CorosBleBackend, mode: ConnectMode, confirm: boolean, chosen?: string):
    { deviceId?: string; serialNumber?: string; refused?: string; confirmed?: boolean } {
    const pending = this.pendingIdentity?.backend === backend && Date.now() - this.pendingIdentity.at < IDENTITY_CONFIRM_MS ? this.pendingIdentity : undefined;
    // A background attempt leaves the question in the watch menu as it is.
    if (mode !== "background") this.pendingIdentity = undefined;
    const pinned = this.pinnedWatch(backend);
    if (mode === "background" && !pinned) throw expectedError(new WatchIdentityError("unpinned"));
    if (mode === "user" && confirm && pending) return { deviceId: pending.deviceId, confirmed: true };
    if (!pinned) return {};
    if (normalizeIdentity(chosen) && !sameIdentity(chosen, pinned.deviceId)) return { refused: normalizeIdentity(chosen) };
    return { deviceId: pinned.deviceId, serialNumber: normalizeSerial(pinned.serialNumber) };
  }

  /**
   * Another device answered: nothing was signed for or sent, and the link is closed. The user is asked
   * in the watch menu; a background or app-started connection fails instead.
   */
  private async refuseIdentity(backend: CorosBleBackend, mode: ConnectMode, other: string, deviceName?: string): Promise<CorosNativeBleSnapshot> {
    const pinned = this.pinnedWatch(backend);
    recordDiagnosticNotice("corosBle:identity", `A device with the remembered watch's name has another Bluetooth identity (${backend}, ` +
      `remembered ${pinned ? identityTag(pinned.deviceId) : "none"}, found ${other ? identityTag(other) : "unknown"}). It was not authenticated.`, "warning");
    this.trace.add("identity mismatch", { backend, mode });
    await this.stop();
    this.state = { ...emptyState(), backend, phase: "disconnected", available: true };
    if (mode !== "background" && normalizeIdentity(other)) this.pendingIdentity = { backend, deviceId: normalizeIdentity(other)!, deviceName, at: Date.now() };
    if (mode !== "user" || !this.pendingIdentity) throw expectedError(new WatchIdentityError("mismatch"));
    return this.publicState();
  }

  /**
   * After the watch accepted a connection the user made: remember its identity the first time (an existing
   * remembered watch included), or the new one the user confirmed. Background sync can then resume. The
   * remembered watch under a new identity (`rotated`: its serial number matched) is followed on any connection.
   */
  private rememberIdentity(backend: CorosBleBackend, mode: ConnectMode, deviceId: string | undefined, confirmed?: boolean, rotated?: boolean): void {
    const identity = normalizeIdentity(deviceId);
    if (!identity) return;
    const pinned = this.pinnedWatch(backend);
    if (rotated && pinned) {
      this.savePinnedWatch(backend, { ...pinned, deviceId: identity });
      recordDiagnosticNotice("corosBle:identity", `The remembered watch came back with a new Bluetooth identity and the same serial number (${backend}, ${identityTag(pinned.deviceId)} to ${identityTag(identity)}).`, "info");
    } else if (mode !== "user") return;
    else if (!pinned || (confirmed && !sameIdentity(pinned.deviceId, identity))) {
      this.savePinnedWatch(backend, {
        deviceId: identity, deviceName: this.state.deviceName, serialNumber: this.state.serialNumber || undefined,
        modelNumber: this.state.modelNumber || undefined, model: this.watchTarget()?.model, pinnedAt: Date.now()
      });
      if (pinned) recordDiagnosticNotice("corosBle:identity", `The remembered watch's Bluetooth identity changed after the user confirmed it (${backend}, ${identityTag(pinned.deviceId)} to ${identityTag(identity)}).`, "warning");
      else recordDiagnosticNotice("corosBle:identity", `Remembered the watch's Bluetooth identity (${backend}, ${identityTag(identity)}).`, "info");
    } else if (!sameIdentity(pinned.deviceId, identity)) return;
    else if (!normalizeSerial(pinned.serialNumber) && normalizeSerial(this.state.serialNumber)) {
      // A serial number that couldn't be read when the watch was remembered.
      this.savePinnedWatch(backend, { ...pinned, serialNumber: this.state.serialNumber });
    }
    if (mode !== "user") return;
    for (const listener of this.identityListeners) {
      try { listener(); } catch { /* a listener never affects the connection */ }
    }
  }

  private savePinnedWatch(backend: CorosBleBackend, watch: PinnedWatch): void {
    setSetting(WATCH_IDENTITY_SETTING, JSON.stringify({ ...parsePinnedWatches(getSetting(WATCH_IDENTITY_SETTING)), [backend]: watch }));
  }

  /** Called after each connection the user made to the remembered watch (background sync resumes). */
  onWatchConfirmed(listener: () => void): () => void {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  /** Whether background sync may use the watch: one is remembered, and a connected one is that watch. */
  watchIdentityForBackgroundSync(): "ok" | WatchIdentityProblem {
    const pinned = this.pinnedWatch("system");
    if (!pinned) return "unpinned";
    if (this.state.connected && (this.backendInUse !== "system" || !sameIdentity(this.state.deviceId, pinned.deviceId))) return "mismatch";
    return "ok";
  }

  /** A watch has been connected before over the computer's Bluetooth, so it can be found again by name. */
  hasRememberedWatch(): boolean {
    return Boolean(getSetting(DEVICE_SETTING));
  }

  /** What to push on every connection, as the phone app does: the weather file, when there is one. */
  setConnectedPush(hook: () => Promise<Buffer | undefined>): void {
    this.connectedHook = hook;
  }

  /** Where the watch's training profile goes after each connection (watchProfileService). */
  private profileSink?: (profile: Buffer, model?: WatchModelId) => void;

  setProfileSink(sink: (profile: Buffer, model?: WatchModelId) => void): void {
    this.profileSink = sink;
  }

  /** The training profile (setting 10); the watch sends its system switches (setting 0) in the same reply. */
  private async readProfileReply(): Promise<Map<number, Buffer>> {
    return decodeSettings(await this.controlCommand(SETTINGS_GET_OPCODE, encodeSettingsRequest([SETTING_USER_INFO])));
  }

  private async readProfile(): Promise<Buffer> {
    const profile = (await this.readProfileReply()).get(SETTING_USER_INFO);
    if (!profile?.length) throw new Error("The watch did not return its training profile.");
    return profile;
  }

  /** Asks the user whether the watch may open its drive over USB (main shows the dialog). */
  private usbAccessPrompt?: (signal: AbortSignal) => Promise<boolean>;
  /**
   * The open question, from asking until the answer reaches the watch. Aborted when the
   * watch closes its prompt (cable out, or dismissed on the watch) or the link goes.
   */
  private usbAccess?: AbortController;
  /** Requests before this time aren't asked about: they were sent before the last answer arrived. */
  private usbAccessQuietUntil = 0;

  setUsbAccessPrompt(prompt: (signal: AbortSignal) => Promise<boolean>): void {
    this.usbAccessPrompt = prompt;
  }

  /**
   * A watch on 3.2008.0 firmware plugged into a computer keeps its drive closed and shows
   * "Open the COROS App to authorize". While that prompt is up it asks the connected app
   * every 5 s; the answer is setting 0x31, which opens the drive at once and spares the
   * watch from asking again for 30 s.
   */
  private usbAccessEvent(requested: boolean): void {
    if (!requested) { this.usbAccess?.abort(); return; }
    if (this.usbAccess || Date.now() < this.usbAccessQuietUntil || !this.usbAccessPrompt || !this.state.connected ||
        this.state.systemBind !== "authenticated" || !watchSupports("usbAccess", this.watchTarget()?.model)) return;
    const controller = new AbortController();
    this.usbAccess = controller;
    void (async () => {
      const allowed = await this.usbAccessPrompt!(controller.signal);
      // A sync or transfer holding the link finishes first; the watch keeps its prompt up meanwhile.
      if (!(await this.whenLinkFree(controller.signal))) return;
      await this.pushOperation(async () => requireWatchAcknowledgement(
        await this.controlCommand(SETTINGS_SET_OPCODE, encodeSettings([[SETTING_USB_ACCESS, Buffer.from([allowed ? 1 : 0])]])), "USB access answer"));
      // The watch closes its prompt on any answer. Requests already sent aren't asked again,
      // and after Don't Allow the watch isn't asked about for the 30 s it waits after an Allow.
      this.usbAccessQuietUntil = Date.now() + (allowed ? USB_ACCESS_ANSWER_QUIET_MS : USB_ACCESS_DECLINE_QUIET_MS);
    })().catch(error => recordDiagnosticError("corosBle:usbAccess", error instanceof Error ? error : new Error(String(error))))
      .finally(() => { if (this.usbAccess === controller) this.usbAccess = undefined; });
  }

  /** True once nothing holds the watch link; false if the question was withdrawn or the watch disconnected first. */
  private async whenLinkFree(signal: AbortSignal): Promise<boolean> {
    for (const started = Date.now(); ;) {
      if (signal.aborted || !this.state.connected) return false;
      if (!this.busyWith()) return true;
      if (Date.now() - started > USB_ACCESS_WAIT_MS) throw new Error("The watch stayed busy, so its USB access request wasn't answered.");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  /** Where the watch's system switches go after each connection (watchSettingsService). */
  private switchesSink?: (switches: Buffer, ext?: Buffer, model?: WatchModelId) => void;

  setSwitchesSink(sink: (switches: Buffer, ext?: Buffer, model?: WatchModelId) => void): void {
    this.switchesSink = sink;
  }

  /**
   * Reads the training profile and system switches (read-only), as the phone app reads
   * settings on connect. Returns the switches, which carry the watch's 12/24-hour format.
   * Only for models whose firmware was checked: others may not answer, and each
   * unanswered read would hold the connection until the helper gives up.
   */
  private async readProfileOnConnect(): Promise<Buffer | undefined> {
    if (!this.state.connected || this.state.systemBind !== "authenticated" || this.backendInUse !== "system") return undefined;
    const model = this.watchTarget()?.model;
    if (!(["profile", "settings", "clockFormat"] as const).some(feature => watchSupports(feature, model))) return undefined;
    const failed = (source: string, error: unknown) => { recordDiagnosticError(source, error instanceof Error ? error : new Error(String(error))); };
    let reply: Map<number, Buffer>;
    try { reply = await this.readProfileReply(); } catch (error) { failed("corosBle:readProfile", error); return undefined; }
    // Each part on its own: a profile that doesn't decode keeps the switches, and with them the watch's 12/24-hour format.
    try {
      const profile = reply.get(SETTING_USER_INFO);
      if (!profile?.length) throw new Error("The watch did not return its training profile.");
      this.profileSink?.(profile, model);
    } catch (error) { failed("corosBle:readProfile", error); }
    const switches = reply.get(SETTING_SWITCH);
    if (!switches?.length) return undefined;
    if (this.switchesSink) {
      try {
        // The extended switches (type 31) are a separate read; older watches don't send them.
        const ext = await this.controlCommand(SETTINGS_GET_OPCODE, encodeSettingsRequest([SETTING_SWITCH_EXT]))
          .then(answer => decodeSettings(answer).get(SETTING_SWITCH_EXT)).catch(() => undefined);
        this.switchesSink(switches, ext?.length ? ext : undefined, model);
      } catch (error) { failed("corosBle:readSettings", error); }
    }
    return switches;
  }

  /** The watch's training profile now (UserInfo protobuf). */
  readWatchProfile(): Promise<Buffer> {
    return this.pushOperation(() => this.readProfile());
  }

  /** Writes a training profile (SYSTEM_SETTINGS_SET, setting 10) and returns what the watch holds afterwards. */
  writeWatchProfile(profile: Buffer): Promise<Buffer> {
    return this.pushOperation(async () => {
      this.requireWatchFeature("profile");
      const stored = await this.writeThenRead("profile", () => this.controlCommand(SETTINGS_SET_OPCODE, encodeSettings([[SETTING_USER_INFO, profile]])), () => this.readProfile());
      this.profileSink?.(stored, this.watchTarget()?.model);
      return stored;
    });
  }

  /**
   * A settings write, then what the watch holds. A write whose reply didn't arrive may still have been
   * applied, so the watch is read before it is reported as failed; the caller compares what it holds.
   */
  private async writeThenRead<T>(what: string, write: () => Promise<unknown>, read: () => Promise<T>): Promise<T> {
    try {
      await write();
    } catch (error) {
      const stored = await read().catch(() => undefined);
      if (stored === undefined) throw error;
      recordDiagnosticNotice("corosBle:settingsWrite", `The watch didn't answer the ${what} write; what it holds was read back instead.`, "warning");
      return stored;
    }
    return read();
  }

  /** The system switches (type 0) and extended switches (type 31), as stored on the watch, with the watch's model (its fields differ by model). */
  private async readSwitches(): Promise<{ word: Buffer; ext?: Buffer; model?: WatchModelId }> {
    const reply = decodeSettings(await this.controlCommand(SETTINGS_GET_OPCODE, encodeSettingsRequest([SETTING_SWITCH_EXT])));
    const word = reply.get(SETTING_SWITCH);
    if (!word || word.length < 4) throw new Error("The watch did not return its settings.");
    const ext = reply.get(SETTING_SWITCH_EXT);
    const model = this.watchTarget()?.model;
    return { word, ...(ext && ext.length >= 8 ? { ext } : {}), ...(model ? { model } : {}) };
  }

  readWatchSwitches(): Promise<{ word: Buffer; ext?: Buffer; model?: WatchModelId }> {
    return this.pushOperation(() => this.readSwitches());
  }

  /** Writes the switch records (whole, as the app does), then reads them back. */
  writeWatchSwitches(word: Buffer, ext?: Buffer): Promise<{ word: Buffer; ext?: Buffer; model?: WatchModelId }> {
    return this.pushOperation(async () => {
      this.requireWatchFeature("settings");
      const settings: Array<[number, Buffer]> = [[SETTING_SWITCH, word]];
      if (ext) settings.push([SETTING_SWITCH_EXT, ext]);
      const stored = await this.writeThenRead("settings", () => this.controlCommand(SETTINGS_SET_OPCODE, encodeSettings(settings)), () => this.readSwitches());
      this.switchesSink?.(stored.word, stored.ext, this.watchTarget()?.model);
      return stored;
    });
  }

  private async pushOnConnect(): Promise<void> {
    // Sent only once a weather location is known (watchWeatherFile returns nothing otherwise).
    if (!this.connectedHook || !this.state.connected || this.state.systemBind !== "authenticated" || this.backendInUse !== "system") return;
    // Only watches whose weather decoder was checked against the file CorosLink builds.
    if (!watchSupports("weather", this.watchTarget()?.model)) return;
    try {
      const weather = await Promise.race([this.connectedHook(), new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 20_000))]);
      if (!weather) return;
      // One block (the encoder keeps it under TRAINING_BLOCK_BYTES), so a failure never leaves a
      // transfer half done and pushDataFile keeps the link. Not retried: the watch that didn't
      // answer a header once (15 s) didn't on the next connection either; the next one sends it.
      await this.pushDataFile(WEATHER_FILE, weather, 0);
      this.state = { ...this.state, weatherSentAt: Date.now(), weatherFailedAt: undefined };
      this.trace.add("weather sent", { bytes: weather.length });
    } catch (error) {
      // Weather is optional: the connection carries on without it.
      if (this.state.connected) this.state = { ...this.state, weatherFailedAt: Date.now() };
      this.trace.add("weather failed", {});
      recordDiagnosticError("corosBle:weather", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async readTrainingList(kind: number): Promise<WatchTrainingList> {
    return decodeTrainingList(await this.controlCommand(CONFIG_TRAINING_OPCODE, encodeTrainingListRequest(kind)));
  }

  /**
   * Sends one workout (a COROS program as the Training Library stores it) to the
   * watch's workout list, replacing an older copy of the same workout, and
   * checks the watch lists it afterwards.
   */
  sendWorkoutToWatch(program: Record<string, unknown>): Promise<{ slot: number; bytes: number }> {
    return this.pushOperation(async () => {
      this.requireWatchFeature("workouts");
      const programId = String(program.id ?? "");
      if (!/^\d+$/.test(programId)) throw new WorkoutNotSendableError("Save the workout before sending it to the watch.");
      const list = await this.readTrainingList(TRAINING_KIND.workouts);
      const slot = workoutSlot(list, programId);
      const file = encodeWatchFile(encodeProgramLite(program), WORKOUT_FILE, Number(program.createTimestamp) || 0);
      if (list.maxBytes && file.length > list.maxBytes) {
        throw new WorkoutNotSendableError("This workout is too long for the watch. Remove some steps, then send it again.");
      }
      await this.pushDataFile(WORKOUT_FILE, file, slot);
      for (let attempt = 0; attempt < 4; attempt++) {
        const after = await this.readTrainingList(TRAINING_KIND.workouts);
        if (after.entries.some(entry => entry.id === programId)) return { slot, bytes: file.length };
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error("The watch did not list the workout after the transfer. Reconnect and try again.");
    });
  }

  syncRoute(route: GeneratedRoute): Promise<CorosRouteSyncStatus> {
    const busy = this.busyWith();
    if (busy === "route") return Promise.reject(new Error("A route sync is already running."));
    if (busy) return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    this.routeCancelled = false;
    this.routeProgress = { phase: "connecting", routeId: route.id, routeName: route.name, sentBytes: 0, totalBytes: 0 };
    this.routeTask = (async () => {
      let started = false;
      try {
        await this.mapPolling?.catch(() => {});
        await this.polling?.catch(() => {});
        if (!this.state.connected) await this.connect(false);
        this.requireTransferSession();
        const checkCancelled = () => { if (this.routeCancelled) throw new Error("Route sync cancelled."); };
        checkCancelled();
        this.routeProgress.phase = "preparing";
        const encoded = encodeWatchRoute(route);
        const inventory = decodeRouteInventory(await this.controlCommand(0xaa, Buffer.from([0])));
        const slot = routeSlot(inventory, encoded.trackId);
        this.routeProgress = { ...this.routeProgress, routeName: encoded.watchName, totalBytes: encoded.file.length,
          pointCount: encoded.pointCount, watchSlot: slot };
        const existing = inventory.entries.find(entry => entry.trackId === encoded.trackId && entry.crc16 === encoded.crc16);
        if (existing) { this.routeProgress.sentBytes = encoded.file.length; this.routeProgress.phase = "complete"; return this.routeSyncStatus(); }
        this.routeProgress.phase = "transferring";
        for (let offset = 0; offset < encoded.file.length; offset += ROUTE_BLOCK_BYTES) {
          checkCancelled();
          this.requireTransferSession();
          const block = encoded.file.subarray(offset, offset + ROUTE_BLOCK_BYTES);
          const header = encodeRouteBlockHeader(block, offset, encoded.file.length, slot);
          started = true;
          await this.send("routeBlock",{ header: header.toString("base64"), block: block.toString("base64") });
          this.routeProgress.sentBytes = offset + block.length;
        }
        checkCancelled();
        this.routeProgress.phase = "verifying";
        for (let attempt = 0; attempt < 4; attempt++) {
          const after = decodeRouteInventory(await this.controlCommand(0xaa, Buffer.from([0])));
          const stored = after.entries.find(entry => entry.trackId === encoded.trackId && entry.crc16 === encoded.crc16);
          if (stored) { this.routeProgress.watchSlot = stored.slot; this.routeProgress.phase = "complete"; return this.routeSyncStatus(); }
          checkCancelled();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        throw new Error("The watch did not verify the synced route. Reconnect and try again.");
      } catch (error) {
        this.routeProgress = { ...this.routeProgress, phase: this.routeCancelled ? "cancelled" : "failed",
          error: this.routeCancelled ? undefined : error instanceof Error ? error.message : "Could not sync the route." };
        // Reset an interrupted SFT transfer before accepting another command.
        if (started) await this.closeLink().catch(() => this.stop());
        if (this.routeCancelled) return this.routeSyncStatus();
        throw error;
      }
    })().finally(() => { this.routeTask = undefined; });
    return this.routeTask;
  }

  async prepareWatchface(filename: string, compiled = false): Promise<CorosDirectWatchfacePreview> {
    if (this.wifiMusicBusy) throw new Error("Wait for Wi-Fi audio sync and settings restoration before preparing a watch face.");
    const stat = await fs.promises.stat(filename);
    if (!stat.isFile() || stat.size > WATCHFACE_MAX_BYTES - 16) throw new Error("Choose a compiled watch face BIN smaller than 3.2 MB.");
    const encoded = encodeWatchfaceFile(await fs.promises.readFile(filename));
    const fits = watchfaceTargetsForMagic(encoded.magic);
    const preview: CorosDirectWatchfacePreview = { id: randomUUID(), name: path.basename(filename), bytes: encoded.file.length, faceId: encoded.faceId,
      models: fits.map(target => target.model), ...(compiled ? { source: "compiled" as const } : {}) };
    this.preparedFace();
    this.preparedWatchfaces.set(preview.id, { preview, file: encoded.file, magic: encoded.magic, expires: Date.now() + 15 * 60_000 });
    // Each BIN is held in memory (up to 3.2 MB); keep the four most recent.
    while (this.preparedWatchfaces.size > 4) this.preparedWatchfaces.delete(this.preparedWatchfaces.keys().next().value!);
    this.lastPreparedWatchfaceId = preview.id;
    return { ...preview };
  }

  /** A prepared BIN that hasn't expired; expired ones are dropped on the way. */
  private preparedFace(id?: string) {
    const now = Date.now();
    for (const [key, entry] of this.preparedWatchfaces) if (entry.expires < now) this.preparedWatchfaces.delete(key);
    return id === undefined ? undefined : this.preparedWatchfaces.get(id);
  }

  watchfaceSyncStatus(): CorosDirectWatchfaceStatus { return { ...this.watchfaceProgress }; }
  cancelWatchfaceSync(): void { if (this.watchfaceTask) this.watchfaceCancelled = true; }

  private requireWatchfaceSession(): void {
    this.requireTransferSession();
    if (this.backendInUse !== "system") {
      throw new Error("Watch face sync needs this computer's Bluetooth, not the USB adapter.");
    }
  }

  /** The last check before anything is sent: the BIN must be built for this watch's screen. */
  private requireWatchfaceFits(magic: string): void {
    const watch = this.watchTarget()!;
    if (watchfaceBinTarget(watch).magic === magic) return;
    const built = watchfaceTargetsForMagic(magic)[0];
    throw new Error(`This face was built for ${built ? `a ${watchfaceBinTarget(built).screen} px ${built.label}` : "another watch"}, not your ${watch.label}. Compile it for this watch.`);
  }

  private watchfaceDevice(): string { return JSON.stringify([this.state.deviceId, this.state.deviceName]); }

  listWatchfaceSlots(): Promise<CorosDirectWatchfaceInventory> {
    if (this.wifiMusicBusy) return Promise.reject(new Error("Wait for Wi-Fi audio sync and settings restoration before reading watch faces."));
    if (this.watchfaceInventoryTask) return this.watchfaceInventoryTask;
    if (this.busyWith()) {
      return Promise.reject(new Error("Wait for the current Bluetooth transfer to finish before reading watch face slots."));
    }
    this.watchfaceInventoryTask = (async () => {
      await this.mapPolling?.catch(() => {});
      await this.polling?.catch(() => {});
      this.requireWatchfaceSession();
      const device = this.watchfaceDevice();
      const ids = this.readWatchfaceInventory(await this.controlCommand(0x96, Buffer.from([0])));
      if (device !== this.watchfaceDevice()) throw new Error("The connected watch changed. Refresh slots again.");
      const checkedAt = Date.now(), id = randomUUID();
      this.watchfaceInventory = { id, ids, device, expires: checkedAt + 15 * 60_000 };
      const prepared = this.preparedFace(this.lastPreparedWatchfaceId);
      return { id, checkedAt, slots: ids.map((faceId, slot) => ({ slot, faceId: faceId === 0xffffffff ? null : faceId })),
        prepared: prepared ? { ...prepared.preview } : undefined };
    })().finally(() => { this.watchfaceInventoryTask = undefined; });
    return this.watchfaceInventoryTask;
  }

  syncWatchface(previewId: string, target?: CorosDirectWatchfaceTarget): Promise<CorosDirectWatchfaceStatus> {
    if (this.wifiMusicBusy) return Promise.reject(new Error("Wait for Wi-Fi audio sync and settings restoration before installing a watch face."));
    if (this.busyWith()) {
      return Promise.reject(new Error("Wait for the current Bluetooth transfer to finish before syncing a watch face."));
    }
    const prepared = this.preparedFace(previewId);
    if (!prepared) {
      return Promise.reject(new Error("Choose the compiled watch face again before syncing."));
    }
    const inventory = this.watchfaceInventory;
    if (target && (!inventory || target.inventoryId !== inventory.id || inventory.expires < Date.now() || inventory.device !== this.watchfaceDevice() ||
      !Number.isInteger(target.slot) || target.slot < 0 || target.slot > 9 || typeof target.replaceExisting !== "boolean")) {
      return Promise.reject(new Error("Refresh watch face slots and choose the destination again."));
    }
    this.watchfaceCancelled = false;
    this.watchfaceProgress = { phase: "preparing", name: prepared.preview.name, sentBytes: 0, totalBytes: prepared.file.length };
    this.watchfaceTask = (async () => {
      let started = false;
      try {
        await this.mapPolling?.catch(() => {});
        await this.polling?.catch(() => {});
        this.requireWatchfaceSession();
        this.requireWatchfaceFits(prepared.magic);
        const device = this.watchfaceDevice();
        if (target && inventory?.device !== device) throw new Error("The connected watch changed. Refresh slots and choose the destination again.");
        const check = () => { if (this.watchfaceCancelled) throw new Error("Watch face sync cancelled."); this.requireWatchfaceSession();
          if (device !== this.watchfaceDevice()) throw new Error("The connected watch changed. Reconnect and refresh its slots."); };
        check();
        const ids = this.readWatchfaceInventory(await this.controlCommand(0x96, Buffer.from([0])));
        check();
        const slot = selectWatchfaceSlot(ids, target && inventory ? { slot: target.slot, expectedFaceId: inventory.ids[target.slot] === 0xffffffff ? null : inventory.ids[target.slot], replaceExisting: target.replaceExisting } : undefined);
        this.watchfaceInventory = undefined;
        this.watchfaceProgress = { ...this.watchfaceProgress, watchSlot: slot, phase: "transferring" };
        for (let offset = 0; offset < prepared.file.length; offset += WATCHFACE_BLOCK_BYTES) {
          check();
          const block = prepared.file.subarray(offset, offset + WATCHFACE_BLOCK_BYTES);
          started = true;
          await this.send("watchfaceBlock", { header: encodeWatchfaceBlockHeader(block, offset, prepared.file.length, slot).toString("base64"), block: block.toString("base64") });
          this.watchfaceProgress.sentBytes = offset + block.length;
        }
        this.watchfaceProgress.phase = "verifying";
        for (let attempt = 0; attempt < 8; attempt++) {
          check();
          const ids = this.readWatchfaceInventory(await this.controlCommand(0x96, Buffer.from([0])));
          if (ids[slot] === prepared.preview.faceId) {
            this.watchfaceProgress.phase = "complete";
            this.watchfaceProgress.verification = target && inventory?.ids[slot] === prepared.preview.faceId ? "transfer-acknowledged" : "inventory-id";
            return this.watchfaceSyncStatus();
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error("The watch did not confirm the new watch face in its inventory.");
      } catch (error) {
        this.watchfaceProgress = { ...this.watchfaceProgress, phase: this.watchfaceCancelled ? "cancelled" : "failed",
          error: this.watchfaceCancelled ? undefined : error instanceof Error ? error.message : "Could not sync the watch face." };
        if (started) await this.closeLink().catch(() => this.stop());
        if (this.watchfaceCancelled) return this.watchfaceSyncStatus();
        throw error;
      }
    })().finally(() => { this.watchfaceTask = undefined; });
    return this.watchfaceTask;
  }

  /** Disconnect has started: new work is refused while what is running finishes (FINISH_WATCH_WORK_MS). */
  private closing?: Promise<CorosNativeBleSnapshot>;
  /** The app is quitting: nothing new starts on the watch. */
  private quitting = false;

  /** A sync, transfer or settings write holds the link (quitting waits for it). */
  hasWatchWork(): boolean {
    return Boolean(this.pushTask || this.localSyncTask || this.routeTask || this.watchfaceTask);
  }

  /**
   * Lets a sync, transfer or settings write that is under way finish, up to `timeoutMs`; a sync's reads
   * stop at the next block and it starts no write after them. Never called from inside one of them.
   */
  private async finishWatchWork(timeoutMs: number): Promise<void> {
    const running = [this.pushTask, this.localSyncTask, this.routeTask, this.watchfaceTask].filter(task => task !== undefined);
    if (!running.length) return;
    if (this.localSyncTask) {
      try { this.localSyncCancel?.(); } catch { /* the wait below still applies */ }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([Promise.allSettled(running).then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    clearTimeout(timer);
    if (!finished) this.trace.add("watch work cut", { timeoutMs });
  }

  /** Before the app quits: nothing new starts, and what is under way finishes (bounded). Then stop(). */
  async finishBeforeQuit(timeoutMs = FINISH_WATCH_WORK_MS): Promise<void> {
    this.quitting = true;
    await this.finishWatchWork(timeoutMs);
  }

  /** Disconnect for the user (watch menu) and background sync: what is under way finishes first (bounded). */
  disconnect(): Promise<CorosNativeBleSnapshot> {
    this.closing ??= (async () => {
      await this.finishWatchWork(FINISH_WATCH_WORK_MS);
      return this.closeLink();
    })().finally(() => { this.closing = undefined; });
    return this.closing;
  }

  /** Closes the link now. Used from inside a task to reset a transfer that failed partway. */
  private async closeLink(): Promise<CorosNativeBleSnapshot> {
    if (this.activityScreenTask) await this.activityScreenTask.catch(() => undefined);
    if (this.wifiMusicTask) {
      this.wifiMusic.cancel();
      await this.wifiMusicTask.catch(() => undefined);
    }
    this.musicInventory = undefined;
    // Also the watch menu's Cancel for a device that didn't match the remembered watch.
    this.pendingIdentity = undefined;
    if (this.worker) await this.request("disconnect");
    await this.stop();
    return this.publicState();
  }

  async stop(): Promise<void> {
    this.musicInventory = undefined;
    const worker = this.worker;
    if (!worker) return;
    this.stopping = worker;
    this.trace.add("worker stop");
    worker.stdin.end();
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        // Detach it now: `close` may come much later, and until then
        // startWorker would keep handing requests to this dying helper.
        this.failWorker(worker, "The Bluetooth worker did not stop in time.");
        worker.kill("SIGKILL");
        resolve();
      }, 6_000);
      worker.once("close", () => { clearTimeout(timer); resolve(); });
    });
  }
}

/** The 12-hour switch (bit 13) in the watch's system switches, or undefined when they can't be read. */
function hour12From(switches: Buffer | undefined): boolean | undefined {
  if (!switches?.length) return undefined;
  try { return decodeSwitches(decodeSwitchWord(switches)).timeFormat === 1; } catch { return undefined; }
}

export const corosNativeBle = new CorosNativeBleService();
