import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { getSetting, setSetting } from "./database";
import type { CorosBleBackend, CorosNativeBleConnectOptions, CorosNativeBleSnapshot } from "./corosNativeBleTypes";
import { CorosBleAccountAuth, type CorosAccountCredential } from "./corosBleAuth";
import { COROS_BLE_LOGIN_KEY_SETTING, createCorosLoginCredential, type CorosBleLoginKey } from "./corosBleLoginKey";
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
  }>();
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
      watchModel: recognized?.target.model, watchModelSource: recognized?.source, watchValidated: isValidatedWatch(this.state) };
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
          if (response.bondUpdate) {
            setSetting(BOND_SETTING, safeStorage.encryptString(JSON.stringify(response.bondUpdate)).toString("base64"));
            continue;
          }
          const request = this.pending.get(response.id);
          if (!request) continue;
          clearTimeout(request.timer);
          this.pending.delete(response.id);
          if (response.error) request.reject(new Error(response.error));
          else {
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
    // Framework stderr can contain keys. Keep only a recognized exception
    // class or native-crash marker; never retain or log the raw text.
    let failureKind: string | undefined;
    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk: string) => {
      const kinds = ["ModuleNotFoundError", "ImportError", "PermissionError", "FileNotFoundError", "RuntimeError"];
      failureKind = kinds.find(kind => chunk.includes(`${kind}:`)) ?? failureKind;
      if (chunk.includes("libusb") && /assertion|Assertion/.test(chunk)) failureKind = "libusb assertion";
    });
    worker.on("error", () => this.failWorker(worker, "Could not start the Bluetooth worker."));
    worker.on("close", (code, signal) => {
      const details = failureKind || signal || (typeof code === "number" ? `exit ${code}` : "unknown exit");
      this.failWorker(worker, `The Bluetooth worker stopped (${details}).`);
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

  private failWorker(worker: ChildProcessWithoutNullStreams, message: string): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    this.musicInventory = undefined;
    this.state = { ...this.state, phase: this.state.phase === "failed" ? "failed" : "disconnected", connected: false, encrypted: false,
      systemBind: this.state.systemBind === "unavailable" ? "unavailable" : "not_authenticated", authenticatedAt: undefined, watchEvents: undefined,
      channels: this.state.channels.map(channel => ({ ...channel, subscribed: false })) };
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }

  private send(operation: string, extra: Record<string, unknown> = {}): Promise<WorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("The Bluetooth worker is not running."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failWorker(worker, "The Bluetooth operation timed out. Keep the watch nearby and try again.");
        worker.kill();
      }, operation === "connect" ? 120_000 : operation === "scan" ? 65_000 : operation === "exchange" ? 20_000 : 50_000);
      this.pending.set(id, { resolve, reject, timer });
      worker.stdin.write(JSON.stringify({ id, operation, ...extra }) + "\n", error => {
        if (error) this.failWorker(worker, "Could not communicate with the Bluetooth worker.");
      });
    });
  }

  private async request(operation: string, extra: Record<string, unknown> = {}): Promise<CorosNativeBleSnapshot> {
    return (await this.send(operation, extra)).result;
  }

  async status(): Promise<CorosNativeBleSnapshot> {
    if (this.connecting || this.scanning) return { ...this.publicState(), phase: this.connecting ? "connecting" : "scanning" };
    if (this.activityScreenTask || this.wifiMusicTask || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask || this.musicInventoryTask || (this.musicDeleteTask && !this.musicConfirming)) return this.publicState();
    if (!this.worker) {
      const state = this.publicState();
      return { ...state, phase: state.available ? state.phase : "unavailable" };
    }
    this.polling ??= this.request("status").finally(() => { this.polling = undefined; });
    return this.polling;
  }

  connect(pair = false, options: CorosNativeBleConnectOptions = {}): Promise<CorosNativeBleSnapshot> {
    if (this.wifiMusicTask) return Promise.reject(new Error("Wait for audio sync to restore the watch settings before reconnecting."));
    if (this.activityScreenTask) return Promise.reject(new Error("Wait for the activity-page operation to finish before reconnecting."));
    if (this.musicInventoryTask || this.musicDeleteTask) return Promise.reject(new Error("Wait for the Bluetooth music operation to finish before reconnecting."));
    this.musicInventory = undefined;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.connectOnce(pair, options);
      if (this.state.connected && this.state.systemBind === "authenticated" && this.wifiMusic.hasPendingRestore()) {
        this.wifiMusicTask = this.wifiMusic.restore().finally(() => { this.wifiMusicTask = undefined; });
        await this.wifiMusicTask;
      }
      return this.publicState();
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async connectOnce(pair: boolean, options: CorosNativeBleConnectOptions): Promise<CorosNativeBleSnapshot> {
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
        this.state = { ...emptyState(), backend, phase: "connecting", available: true };
        this.startWorker(backend);
        await this.request("connect", { deviceName: target.deviceName, deviceId: target.deviceId });
        setSetting(DEVICE_SETTING, JSON.stringify({ deviceName: this.state.deviceName, deviceId: this.state.deviceId }));
        await this.authenticateSystem();
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
      const usbAuth = this.loadAuth((bond as { deviceName: string }).deviceName);
      this.state = { ...emptyState(), phase: "connecting", available: true };
      this.startWorker(backend);
      return await this.request("connect", { bond, pair, auth: usbAuth, transport: process.env.COROS_BLE_TRANSPORT || "usb:0b05:17cb!" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect the watch.";
      this.state = { ...this.state, phase: "failed", connected: false, encrypted: false, error: message };
      await this.stop();
      throw new Error(message);
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
      const account = new CorosBleAccountAuth(credential, this.state.deviceName ?? "");
      const base = account.initialPayload();
      const exchange = async (payload: Buffer, maximumWriteBytes: number) => {
        const reply = await this.send("exchange", { opcode: 0xa5, payload: payload.toString("base64"), maximumWriteBytes });
        if (typeof reply.payload !== "string") throw new Error("The watch did not return a COROS authentication response.");
        return Buffer.from(reply.payload, "base64");
      };
      const challenge = await exchange(base, 20);
      const authenticated = account.authenticatedPayload(base, challenge);
      const bound = await exchange(authenticated, Math.min(240, this.state.maximumWriteBytes ?? 20));
      if (bound.length !== 17 || (bound[0]! & 7) !== 1 || !this.state.connected) throw new Error("The watch rejected COROS authentication. Sign in with the account paired to this watch, then reconnect.");
      this.state = { ...this.state, systemBind: "authenticated", authenticatedAt: Date.now() };
    } catch (error) {
      this.state = { ...this.state, systemBind: "failed", authenticationError: error instanceof Error ? error.message : "COROS authentication did not complete." };
    }
  }

  scan(): Promise<CorosNativeBleSnapshot> {
    if (this.wifiMusicTask) return Promise.reject(new Error("Wait for audio sync and settings restoration before scanning."));
    if (this.activityScreenTask) return Promise.reject(new Error("Wait for the activity-page operation to finish before scanning."));
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      if (this.connecting) await this.connecting;
      if (this.state.connected) throw new Error("Disconnect the watch before scanning.");
      await this.stop();
      if (!this.backends()[0]!.available) throw new Error("System Bluetooth is not available in this build.");
      this.backendInUse = "system";
      this.state = { ...emptyState(), backend: "system", phase: "scanning" };
      this.startWorker("system");
      return await this.request("scan");
    })().finally(() => { this.scanning = undefined; });
    return this.scanning;
  }

  refresh(): Promise<CorosNativeBleSnapshot> {
    if (this.activityScreenTask || this.wifiMusicTask) return Promise.resolve(this.publicState());
    if (this.musicInventoryTask || this.musicDeleteTask) return Promise.reject(new Error("Wait for the Bluetooth music operation to finish before refreshing the connection."));
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
    if (this.activityScreenTask || this.musicDeleteTask || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask || this.mapStarting || this.connecting || this.scanning) {
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
    if (this.activityScreenTask || this.wifiMusicBusy || this.connecting || this.scanning || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask ||
        this.musicInventoryTask || this.musicDeleteTask || this.mapStarting) throw new Error("Wait for the current Bluetooth operation and settings restoration to finish.");
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
    if (this.activityScreenTask || this.wifiMusicTask || this.connecting || this.scanning || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask || this.musicInventoryTask || this.musicDeleteTask || this.mapStarting) {
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
    if (this.activityScreenTask || this.musicDeleteTask || this.musicInventoryTask || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask || this.mapStarting || this.connecting || this.scanning) {
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
    if (this.activityScreenTask || this.connecting || this.scanning || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask || this.musicInventoryTask || this.musicDeleteTask || this.mapStarting || this.pending.size) {
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
    if (this.activityScreenTask || this.wifiMusicBusy || this.connecting || this.scanning || this.routeTask || this.watchfaceTask ||
        this.watchfaceInventoryTask || this.musicInventoryTask || this.musicDeleteTask || this.mapStarting ||
        (this.pending.size && !this.polling && !this.mapPolling)) {
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
      if (!result.supported || !result.connected || !result.authenticated || this.activityScreenTask || this.wifiMusicBusy || this.routeTask || this.watchfaceTask || this.watchfaceInventoryTask || this.musicInventoryTask || this.musicDeleteTask) return result;
      const wifi = await this.controlCommand(0xb2, Buffer.from([5]));
      if (wifi.length !== 2 || wifi[0] !== 1) throw new Error("The watch returned an unsupported Wi-Fi status.");
      result.wifiStateCode = wifi[1];
      result.tasks = decodeWifiMapTasks(await this.controlCommand(0xb6, Buffer.from([0x0b, 0xff])));
      return result;
    })().finally(() => { this.mapPolling = undefined; });
    return this.mapPolling;
  }

  downloadWifiMap(previewId: string): Promise<{ taskId: string; status: CorosWifiMapStatus }> {
    if (this.wifiMusicBusy) throw new Error("Wait for Wi-Fi audio sync and settings restoration before downloading maps.");
    if (this.activityScreenTask) throw new Error("Wait for activity-page sync to finish before starting a map download.");
    if (this.musicInventoryTask || this.musicDeleteTask) throw new Error("Wait for the Bluetooth music operation to finish.");
    if (this.watchfaceTask || this.watchfaceInventoryTask) throw new Error("Wait for watch face sync to finish before starting a map download.");
    if (this.routeTask) throw new Error("Wait for route sync to finish before starting a map download.");
    if (this.mapStarting) throw new Error("A map download is already being prepared.");
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

  syncRoute(route: GeneratedRoute): Promise<CorosRouteSyncStatus> {
    if (this.wifiMusicBusy) return Promise.reject(new Error("Wait for Wi-Fi audio sync and settings restoration before syncing routes."));
    if (this.activityScreenTask) return Promise.reject(new Error("Wait for activity-page sync to finish before syncing a route."));
    if (this.musicInventoryTask || this.musicDeleteTask) return Promise.reject(new Error("Wait for the Bluetooth music operation to finish."));
    if (this.watchfaceTask || this.watchfaceInventoryTask) return Promise.reject(new Error("Wait for watch face sync to finish before syncing a route."));
    if (this.routeTask) return Promise.reject(new Error("A route sync is already running."));
    if (this.mapStarting) return Promise.reject(new Error("Wait for the map download to start before syncing a route."));
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
    if (this.activityScreenTask || this.watchfaceTask || this.routeTask || this.musicInventoryTask || this.musicDeleteTask || this.mapStarting || this.connecting || this.scanning) {
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
    if (this.activityScreenTask || this.watchfaceTask || this.watchfaceInventoryTask || this.musicInventoryTask || this.musicDeleteTask || this.routeTask || this.mapStarting || this.connecting || this.scanning) {
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
    if (this.worker) await this.request("disconnect");
    await this.stop();
    return this.publicState();
  }

  async stop(): Promise<void> {
    this.musicInventory = undefined;
    const worker = this.worker;
    if (!worker) return;
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
