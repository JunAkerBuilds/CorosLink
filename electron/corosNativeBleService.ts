import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { getSetting, setSetting } from "./database";
import type { CorosBleBackend, CorosNativeBleConnectOptions, CorosNativeBleSnapshot } from "./corosNativeBleTypes";
import { BIND_MESSAGES, BIND_REASON, BIND_STATUS, bindRefusalMessage, CorosBindReplyError, CorosBleAccountAuth, describeBindReply, formatCorosWatchKeyId, watchReportsKeyId, type CorosAccountCredential } from "./corosBleAuth";
import { recordDiagnosticError, recordDiagnosticNotice } from "./diagnosticsService";
import {
  IDENTITY_CONFIRM_MS, identityTag, normalizeIdentity, parsePinnedWatches, sameIdentity, WATCH_IDENTITY_SETTING, WatchIdentityError,
  watchIdentityProblem, type PinnedWatch, type WatchIdentityProblem
} from "./watchIdentity";
import { expectedError } from "./diagnosticsLog";
import { CorosBleOperationError, CorosBleTrace } from "./corosBleTrace";
import { COROS_BLE_LOGIN_KEY_SETTING, COROS_WATCH_KEY_CHECK_SETTING, corosBleLoginKeyId, createCorosLoginCredential, nextWatchKeyCheck, type CorosBleLoginKey } from "./corosBleLoginKey";
import { decodeWifiMapTasks, encodeWifiMapStart, requireWifiDownloadReady } from "./corosBleWifiProtocol";
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
import QRCode from "qrcode";
import type { CorosWifiMusicIdentity, CorosWifiMusicStatus } from "./corosWifiMusicTypes";
import { connectedWatchfaceTarget, isValidatedWatch, watchfaceBinTarget, watchfaceTargetHardware, watchfaceTargetsForMagic, type WatchfaceTarget } from "./watchfaceTargets";

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
type LinkTask = "wifiMusic" | "wifiMusicRestore" | "activityScreen" | "musicInventory" | "musicDelete" |
  "route" | "watchface" | "watchfaceInventory" | "mapStarting" | "connecting" | "scanning";

/** What the user is told when the watch is busy with a task (shown in the app as is). */
const BUSY_MESSAGE: Record<LinkTask, string> = {
  wifiMusic: "Wait for the audio sync over Wi-Fi to finish.",
  wifiMusicRestore: "Wait for CorosLink to restore the watch's settings after the audio sync.",
  activityScreen: "Wait for the activity screens to finish syncing.",
  musicInventory: "Wait for CorosLink to finish with the music on the watch.",
  musicDelete: "Wait for CorosLink to finish with the music on the watch.",
  route: "Wait for the route to finish sending to the watch.",
  watchface: "Wait for the watch face to finish sending to the watch.",
  watchfaceInventory: "Wait for CorosLink to finish reading the watch faces on the watch.",
  mapStarting: "Wait for the map download to start.",
  connecting: "Wait for the watch to finish connecting.",
  scanning: "Wait for the Bluetooth scan to finish."
};

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
  private routeTask?: Promise<CorosRouteSyncStatus>;
  private routeCancelled = false;
  private notificationSequence = 0;
  private watchfaceTask?: Promise<CorosDirectWatchfaceStatus>;
  private watchfaceInventoryTask?: Promise<CorosDirectWatchfaceInventory>;
  private musicInventoryTask?: Promise<CorosBleMusicInventory>;
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
      musicInventory: () => this.musicInventoryTask,
      musicDelete: () => this.musicDeleteTask,
      route: () => this.routeTask,
      watchface: () => this.watchfaceTask,
      watchfaceInventory: () => this.watchfaceInventoryTask,
      mapStarting: () => this.mapStarting,
      connecting: () => this.connecting,
      scanning: () => this.scanning
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
              authenticationError: this.state.authenticationError
            } : {};
            this.state = { ...response.result, ...authenticated, backend, available: true };
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
    const qrDataUrl = await QRCode.toDataURL(code, { errorCorrectionLevel: "L", margin: 2, width: 520 });
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
    this.musicInventory = undefined;
    this.state = { ...this.state, phase: this.state.phase === "failed" ? "failed" : "disconnected", connected: false, encrypted: false,
      systemBind: this.state.systemBind === "unavailable" ? "unavailable" : "not_authenticated", authenticatedAt: undefined, watchEvents: undefined,
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

  connect(pair = false, options: CorosNativeBleConnectOptions = {}, mode: ConnectMode = "internal"): Promise<CorosNativeBleSnapshot> {
    // Transfers that connect on their own (routes) and an open connection a face or map
    // operation is using are left as they are: connecting then only reads the status.
    const busy = this.busyWith("wifiMusicRestore", "route", "watchface", "watchfaceInventory", "mapStarting", "connecting", "scanning");
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
          // With an identity to expect, the helper connects to that device only.
          await this.request("connect", { deviceName: target.deviceName, deviceId: target.deviceId, ...(expected.deviceId ? { pinnedId: expected.deviceId } : {}) });
        } catch (error) {
          const other = (error as { identityMismatch?: string }).identityMismatch;
          if (other) return await this.refuseIdentity("system", mode, other, target.deviceName);
          throw error;
        }
        // Checked again here, whatever the helper did, before the sign-in challenge is answered.
        if (expected.deviceId && !sameIdentity(this.state.deviceId, expected.deviceId)) {
          return await this.refuseIdentity("system", mode, this.state.deviceId ?? "", target.deviceName);
        }
        setSetting(DEVICE_SETTING, JSON.stringify({ deviceName: this.state.deviceName, deviceId: this.state.deviceId }));
        await this.authenticateSystem();
        if (this.state.systemBind === "authenticated") this.rememberIdentity("system", mode, this.state.deviceId, expected.confirmed);
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
      this.state = { ...this.state, systemBind: "authenticated", authenticatedAt: Date.now() };
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
    if (busy === "musicInventory" || busy === "musicDelete") return Promise.reject(new Error(BUSY_MESSAGE[busy]));
    if (busy) return Promise.resolve(this.publicState());
    return this.request("refresh");
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
      await this.disconnect().catch(() => undefined);
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
        if (started && !transportFinished && this.state.connected && cached.session === this.musicSession()) await this.disconnect().catch(() => undefined);
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

  routeSyncStatus(): CorosRouteSyncStatus { return { ...this.routeProgress }; }

  cancelRouteSync(): void { if (this.routeTask) this.routeCancelled = true; }

  /** A device that answered with the remembered name but another identity, until the user decides. */
  private pendingIdentity?: { backend: CorosBleBackend; deviceId: string; deviceName?: string; at: number };
  private identityListeners = new Set<() => void>();

  private pinnedWatch(backend: CorosBleBackend): PinnedWatch | undefined {
    return parsePinnedWatches(getSetting(WATCH_IDENTITY_SETTING))[backend];
  }

  /**
   * Which identity this connection must have. A "Connect anyway" for the device just refused trusts that one;
   * otherwise the remembered one, if any. A device the user chose that isn't it is refused before connecting.
   */
  private identityToExpect(backend: CorosBleBackend, mode: ConnectMode, confirm: boolean, chosen?: string):
    { deviceId?: string; refused?: string; confirmed?: boolean } {
    const pending = this.pendingIdentity?.backend === backend && Date.now() - this.pendingIdentity.at < IDENTITY_CONFIRM_MS ? this.pendingIdentity : undefined;
    // A background attempt leaves the question in the watch menu as it is.
    if (mode !== "background") this.pendingIdentity = undefined;
    const pinned = this.pinnedWatch(backend);
    if (mode === "background" && !pinned) throw expectedError(new WatchIdentityError("unpinned"));
    if (mode === "user" && confirm && pending) return { deviceId: pending.deviceId, confirmed: true };
    if (!pinned) return {};
    if (normalizeIdentity(chosen) && !sameIdentity(chosen, pinned.deviceId)) return { refused: normalizeIdentity(chosen) };
    return { deviceId: pinned.deviceId };
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
   * remembered watch included), or the new one the user confirmed. Background sync can then resume.
   */
  private rememberIdentity(backend: CorosBleBackend, mode: ConnectMode, deviceId: string | undefined, confirmed?: boolean): void {
    const identity = normalizeIdentity(deviceId);
    if (mode !== "user" || !identity) return;
    const pinned = this.pinnedWatch(backend);
    if (!pinned || (confirmed && !sameIdentity(pinned.deviceId, identity))) {
      const watch: PinnedWatch = {
        deviceId: identity, deviceName: this.state.deviceName, serialNumber: this.state.serialNumber || undefined,
        modelNumber: this.state.modelNumber || undefined, model: this.watchTarget()?.model, pinnedAt: Date.now()
      };
      setSetting(WATCH_IDENTITY_SETTING, JSON.stringify({ ...parsePinnedWatches(getSetting(WATCH_IDENTITY_SETTING)), [backend]: watch }));
      if (pinned) recordDiagnosticNotice("corosBle:identity", `The remembered watch's Bluetooth identity changed after the user confirmed it (${backend}, ${identityTag(pinned.deviceId)} to ${identityTag(identity)}).`, "warning");
      else recordDiagnosticNotice("corosBle:identity", `Remembered the watch's Bluetooth identity (${backend}, ${identityTag(identity)}).`, "info");
    } else if (!sameIdentity(pinned.deviceId, identity)) return;
    for (const listener of this.identityListeners) {
      try { listener(); } catch { /* a listener never affects the connection */ }
    }
  }

  /** Called after each connection the user made to the remembered watch (background sync resumes). */
  onWatchConfirmed(listener: () => void): () => void {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  /** A watch has been connected before over the computer's Bluetooth, so it can be found again by name. */
  hasRememberedWatch(): boolean {
    return Boolean(getSetting(DEVICE_SETTING));
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
        if (started) await this.disconnect().catch(() => this.stop());
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
        if (started) await this.disconnect().catch(() => this.stop());
        if (this.watchfaceCancelled) return this.watchfaceSyncStatus();
        throw error;
      }
    })().finally(() => { this.watchfaceTask = undefined; });
    return this.watchfaceTask;
  }

  async disconnect(): Promise<CorosNativeBleSnapshot> {
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

export const corosNativeBle = new CorosNativeBleService();
