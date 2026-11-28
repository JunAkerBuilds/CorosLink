// Cloudflare's tunnel connector, `cloudflared`, for "Reach from anywhere": finding one, downloading the pinned
// release (only when the athlete presses Download), and running `cloudflared tunnel run` for the tunnel the relay
// made. The connector token goes to the child in TUNNEL_TOKEN only (argv is readable by every user), and the child
// runs with its own empty HOME and config file, so the athlete's own ~/.cloudflared never leaks in. A pidfile lets
// the next launch stop a connector a crash left behind.
import { execFile, spawn as spawnProcess, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { gunzipSync } from "node:zlib";
import { t } from "@/lib/i18n";

// ----- The pinned release -----

export type Target = "darwin-arm64" | "darwin-amd64" | "windows-amd64" | "linux-amd64";

export interface Asset {
  target: Target;
  url: string;
  size: number;
  /** SHA-256 (hex) of the download. */
  sha256: string;
  /** The macOS builds are a .tgz holding one `cloudflared`. */
  tgz: boolean;
  /** SHA-256 (hex) of the binary itself. */
  binarySha256: string;
}

/**
 * cloudflared 2026.10.5, as CorosLink pins it: Cloudflare's "SHA256 Checksums" release notes for the binaries (for
 * macOS that is the binary inside the .tgz) and GitHub's asset digests for the macOS archives, checked 2026-10-27.
 */
export const CLOUDFLARED_VERSION = "2026.10.5";
/** Older builds trust eight compromised eMudhra intermediates (Cloudflare's notice of 2026-10-20). Applies to the athlete's own too. */
export const CLOUDFLARED_MIN_VERSION = "2026.10.3";
const RELEASE = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

export const ASSETS: Record<Target, Asset> = {
  "darwin-arm64": { target: "darwin-arm64", url: `${RELEASE}/cloudflared-darwin-arm64.tgz`, size: 19_840_425, tgz: true,
    sha256: "184c7d4f5f977348243a6d7ca8f6cf6073b9b2746cfe8c1fe15aa59e9a522bf0", binarySha256: "2b23964528ddcd641c1449275df8b5b51e3c7193b5257919846331bc5bc13b0f" },
  "darwin-amd64": { target: "darwin-amd64", url: `${RELEASE}/cloudflared-darwin-amd64.tgz`, size: 21_798_374, tgz: true,
    sha256: "6699392fed92367808c248c2d90bed66e49bbf66e1b4ee3e4141230f3f7391b3", binarySha256: "cb09afb9b4d0a4730de477ac710aebb6107568930a8345775629bf264f70c284" },
  "windows-amd64": { target: "windows-amd64", url: `${RELEASE}/cloudflared-windows-amd64.exe`, size: 55_343_328, tgz: false,
    sha256: "db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9", binarySha256: "db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9" },
  "linux-amd64": { target: "linux-amd64", url: `${RELEASE}/cloudflared-linux-amd64`, size: 40_263_303, tgz: false,
    sha256: "e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298", binarySha256: "e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298" },
};

/** The pinned build for this computer, or null when there is none (install cloudflared on PATH instead). */
export function targetFor(platform: NodeJS.Platform, arch: string): Target | null {
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : arch === "x64" ? "darwin-amd64" : null;
  if (platform === "win32") return arch === "x64" || arch === "arm64" ? "windows-amd64" : null; // Arm runs the x64 build
  if (platform === "linux") return arch === "x64" ? "linux-amd64" : null;
  return null;
}

const binaryName = (platform: NodeJS.Platform) => (platform === "win32" ? "cloudflared.exe" : "cloudflared");
export const managedPath = (dir: string, platform: NodeJS.Platform, version = CLOUDFLARED_VERSION) => path.join(dir, version, binaryName(platform));

// ----- Finding one -----

export type Source = "env" | "path" | "managed";
export interface Found { path: string; source: Source; version: string | null }

export const parseVersion = (output: string): string | null => /\bversion\s+(\d{4}\.\d{1,2}\.\d{1,3})\b/i.exec(output)?.[1] ?? null;

function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** A known version older than the minimum (one that doesn't say gets the benefit of the doubt). */
export const tooOld = (version: string | null) => version !== null && compareVersions(version, CLOUDFLARED_MIN_VERSION) < 0;

async function executable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await fs.promises.stat(file)).isFile()) return false;
    if (platform !== "win32") await fs.promises.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const hashFile = async (file: string) => createHash("sha256").update(await fs.promises.readFile(file)).digest("hex");
const verified = new Map<string, number>();

function probeVersion(binary: string): Promise<string | null> {
  return new Promise((resolve) => execFile(binary, ["--version"], { timeout: 10_000, windowsHide: true },
    (_error, stdout, stderr) => resolve(parseVersion(`${stdout ?? ""}\n${stderr ?? ""}`))));
}

export interface FindInput { dir: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; arch: string }

/**
 * The cloudflared to run: COROSLINK_CLOUDFLARED_PATH, then one on PATH, then the downloaded pinned build (hashed
 * again once per change). Builds older than the minimum are passed over; an override that old is an error. Null:
 * none here, so the athlete is offered the download.
 */
export async function findCloudflared(input: FindInput): Promise<Found | null> {
  const override = input.env.COROSLINK_CLOUDFLARED_PATH?.trim();
  if (override) {
    if (!(await executable(override, input.platform))) throw new Error(t("COROSLINK_CLOUDFLARED_PATH doesn't point at a cloudflared C-LINK can run."));
    const version = await probeVersion(override);
    if (tooOld(version)) throw new Error(t("The cloudflared at COROSLINK_CLOUDFLARED_PATH is version {version}. Update it to {min} or later.", { version: String(version), min: CLOUDFLARED_MIN_VERSION }));
    return { path: override, source: "env", version };
  }
  for (const folder of (input.env.PATH ?? input.env.Path ?? "").split(path.delimiter)) {
    if (!folder || !path.isAbsolute(folder)) continue;
    const candidate = path.join(folder, binaryName(input.platform));
    if (!(await executable(candidate, input.platform))) continue;
    const version = await probeVersion(candidate);
    if (!tooOld(version)) return { path: candidate, source: "path", version };
  }
  const target = targetFor(input.platform, input.arch);
  const managed = managedPath(input.dir, input.platform);
  if (!target || !(await executable(managed, input.platform))) return null;
  const { mtimeMs } = await fs.promises.stat(managed);
  if (verified.get(managed) !== mtimeMs) {
    if ((await hashFile(managed)) !== ASSETS[target].binarySha256) {
      await fs.promises.rm(managed, { force: true }); // damaged or replaced: offered for download again
      return null;
    }
    verified.set(managed, mtimeMs);
  }
  return { path: managed, source: "managed", version: CLOUDFLARED_VERSION };
}

// ----- Downloading the pinned build -----

function checkSha(data: Buffer, expected: string, label: string): void {
  if (createHash("sha256").update(data).digest("hex") !== expected) throw new Error(t("{label} failed its SHA-256 check. C-LINK didn't install it.", { label }));
}

/** One regular file from a ustar/pax/GNU tar, by base name. */
export function tarMember(tar: Buffer, name: string): Buffer {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) break;
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    const entry = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const start = offset + 512;
    if (type === "0" && path.posix.basename(entry) === name && !entry.includes("..") && start + size <= tar.length) return Buffer.from(tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(t("The cloudflared download doesn't contain {name}.", { name }));
}

export interface DownloadInput {
  dir: string;
  asset: Asset;
  platform: NodeJS.Platform;
  fetch?: typeof fetch;
  onProgress?: (fraction: number) => void;
}

/**
 * Downloads the pinned build into `<dir>/<version>/`, checks the download's and the binary's SHA-256, writes it
 * atomically with the executable bit set, and removes other downloaded versions. Nothing lands unless every check passes.
 */
export async function downloadCloudflared(input: DownloadInput): Promise<string> {
  const label = `cloudflared ${CLOUDFLARED_VERSION}`;
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch)(input.asset.url, { redirect: "follow", headers: { "User-Agent": "C-LINK" } });
  } catch {
    throw new Error(t("Couldn't download Cloudflare's connector. Check your internet connection."));
  }
  if (!response.ok || !response.body) throw new Error(t("Couldn't download Cloudflare's connector ({status}).", { status: response.status }));
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > input.asset.size + 1024 * 1024) {
      await reader.cancel().catch(() => {});
      throw new Error(t("{label} is larger than expected. C-LINK didn't install it.", { label }));
    }
    chunks.push(Buffer.from(value));
    input.onProgress?.(Math.min(1, received / input.asset.size));
  }
  const download = Buffer.concat(chunks);
  checkSha(download, input.asset.sha256, label);
  const binary = input.asset.tgz ? tarMember(gunzipSync(download), "cloudflared") : download;
  checkSha(binary, input.asset.binarySha256, label);
  const destination = managedPath(input.dir, input.platform);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(temp, binary, { mode: 0o755 });
    await fs.promises.chmod(temp, 0o755);
    await fs.promises.rename(temp, destination);
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
  for (const entry of await fs.promises.readdir(input.dir).catch(() => [] as string[])) {
    if (entry !== CLOUDFLARED_VERSION && /^\d{4}\.\d{1,2}\.\d{1,3}$/.test(entry)) await fs.promises.rm(path.join(input.dir, entry), { recursive: true, force: true }).catch(() => {});
  }
  return destination;
}

// ----- Whether this network lets it out -----

/** cloudflared reaches Cloudflare's edge on port 7844 only; school, office and hotel networks often block it. */
const EDGE = { hosts: ["region1.v2.argotunnel.com", "region2.v2.argotunnel.com"], port: 7844 };

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** True when the relay answers but the edge's port doesn't: this network blocks the tunnel. */
export async function edgePortBlocked(relay: { host: string; port: number }, timeoutMs = 5_000): Promise<boolean> {
  const [edge, online] = await Promise.all([
    Promise.all(EDGE.hosts.map((host) => canConnect(host, EDGE.port, timeoutMs))),
    canConnect(relay.host, relay.port, timeoutMs),
  ]);
  return online && !edge.some(Boolean);
}

// ----- Running it -----

export type ConnectorState = "stopped" | "starting" | "online" | "offline";
export interface ConnectorSnapshot { state: ConnectorState; connections: number; message?: string }

const REGISTERED = /Registered tunnel connection/i;
const UNREGISTERED = /Unregistered tunnel connection|Connection terminated|Lost connection with the edge/i;
const REJECTED = /Unauthorized|Invalid tunnel secret|Tunnel not found|token is not valid|tunnel credentials/i;
const EDGE_UNREACHABLE = /failed to dial to edge|Unable to establish connection with Cloudflare edge/i;

/** What the child sees of the environment: enough to run, the token, and a HOME of its own. */
function childEnv(env: NodeJS.ProcessEnv, home: string, token: string): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "TMPDIR", "LANG"]) if (env[name]) kept[name] = env[name];
  return { ...kept, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, TUNNEL_TOKEN: token, NO_AUTOUPDATE: "true" };
}

/** The command line of process `pid`, or null when it isn't running. */
function commandLine(pid: number): Promise<string | null> {
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") return Promise.resolve(null); }
  return new Promise((resolve) => {
    const done = (error: Error | null, stdout: string) => resolve(error ? null : stdout.trim() || null);
    if (process.platform === "win32") {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { timeout: 10_000, windowsHide: true }, done);
    } else {
      execFile("ps", ["-o", "command=", "-p", String(pid)], { timeout: 5_000 }, done);
    }
  });
}

export interface ConnectorOptions {
  /** Holds the pidfile and the child's empty HOME and config. */
  dir: string;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnProcess;
  onChange?: () => void;
  /** cloudflared exited, or the edge keeps refusing it: ask the relay to repair the tunnel. */
  onNeedsRecovery?: (reason: "exit" | "rejected") => void;
  /** A dial to Cloudflare's edge got nowhere. */
  onEdgeUnreachable?: () => void;
  restartDelayMs?: (attempt: number) => number;
  now?: () => number;
}

/** Keeps one cloudflared running: restarts it with backoff when it exits, and asks for recovery when it should. */
export class Connector {
  private child: ChildProcess | null = null;
  private spec: { binary: string; token: string } | null = null;
  private readonly connections = new Set<string>();
  private registered = false;
  private stopped = true;
  private message: string | undefined;
  private restartTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private rejections: number[] = [];
  private readonly pidFile: string;
  private readonly home: string;
  private readonly config: string;
  private readonly killOnExit = () => { try { this.child?.kill("SIGKILL"); } catch { /* gone */ } };

  constructor(private readonly options: ConnectorOptions) {
    this.pidFile = path.join(options.dir, "cloudflared.pid");
    this.home = path.join(options.dir, "home");
    this.config = path.join(this.home, "config.yml");
  }

  get running(): boolean { return !this.stopped; }

  snapshot(): ConnectorSnapshot {
    const state: ConnectorState = this.stopped ? "stopped" : !this.child ? "offline" : this.connections.size ? "online" : this.registered ? "offline" : "starting";
    return { state, connections: this.connections.size, ...(state !== "online" && this.message ? { message: this.message } : {}) };
  }

  /** Starts the connector, or restarts it with a new binary or token. A leftover one from a crash is stopped first. */
  async run(binary: string, token: string): Promise<void> {
    if (!this.stopped && this.child && this.spec?.binary === binary && this.spec.token === token) return;
    this.stopped = false;
    this.spec = { binary, token };
    this.clearRestart();
    await this.end();
    await this.killLeftover();
    await fs.promises.mkdir(this.home, { recursive: true });
    await fs.promises.writeFile(this.config, "no-autoupdate: true\n");
    if (this.stopped || this.spec.binary !== binary || this.spec.token !== token) return;
    this.launch();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearRestart();
    this.message = undefined;
    await this.end();
    this.changed();
  }

  /** Stops a cloudflared this computer started before a crash: only one whose command line names our config. */
  private async killLeftover(): Promise<void> {
    let pid: number;
    try { pid = Number((JSON.parse(await fs.promises.readFile(this.pidFile, "utf8")) as { pid?: unknown }).pid); } catch { return; }
    const command = Number.isInteger(pid) && pid > 0 ? await commandLine(pid) : null;
    if (command?.includes(this.config)) {
      try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
      for (let i = 0; i < 20 && (await commandLine(pid)); i++) await new Promise((r) => setTimeout(r, 100));
      try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    }
    await fs.promises.rm(this.pidFile, { force: true });
  }

  private launch(): void {
    const { binary, token } = this.spec!;
    const redact = (text: string) => stripVTControlCharacters(text).split(token).join("[token]").slice(0, 500);
    const child = (this.options.spawn ?? spawnProcess)(binary, ["tunnel", "--no-autoupdate", "--config", this.config, "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: this.home,
      env: childEnv(this.options.env ?? process.env, this.home, token),
    });
    this.child = child;
    this.connections.clear();
    this.registered = false;
    process.once("exit", this.killOnExit);
    try { if (child.pid) fs.writeFileSync(this.pidFile, JSON.stringify({ pid: child.pid }), { mode: 0o600 }); } catch { /* the next launch just can't clean up after a crash */ }
    let buffer = "";
    let tail = "";
    const read = (data: Buffer) => {
      buffer += data.toString();
      if (buffer.length > 64_000) buffer = buffer.slice(-16_000);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) { tail = redact(line); this.line(child, stripVTControlCharacters(line), tail); }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    let exited = false;
    const exit = (code: number | null, error?: Error) => {
      if (exited) return;
      exited = true;
      if (buffer.trim()) tail = redact(buffer);
      process.removeListener("exit", this.killOnExit);
      if (child !== this.child) return;
      this.child = null;
      this.connections.clear();
      void fs.promises.rm(this.pidFile, { force: true }).catch(() => {});
      this.message = error ? t("Couldn't start cloudflared: {error}", { error: error.message }) : `${t("cloudflared stopped ({code}).", { code: code ?? "signal" })} ${tail}`.trim();
      this.changed();
      if (this.stopped) return;
      this.options.onNeedsRecovery?.("exit");
      this.scheduleRestart();
    };
    child.on("error", (error) => exit(null, error));
    child.on("exit", (code) => exit(code));
    this.changed();
  }

  /** One line of output: `line` to read, `shown` (the token taken out) to keep as the message. */
  private line(child: ChildProcess, line: string, shown: string): void {
    if (child !== this.child) return;
    const index = /connIndex=(\d+)/.exec(line)?.[1] ?? "?";
    if (REGISTERED.test(line)) {
      this.connections.add(index);
      this.registered = true;
      this.attempts = 0;
      this.rejections = [];
      this.message = undefined;
      return this.changed();
    }
    if (UNREGISTERED.test(line)) {
      if (!this.connections.delete(index) && index === "?") this.connections.clear();
      return this.changed();
    }
    if (EDGE_UNREACHABLE.test(line)) return this.options.onEdgeUnreachable?.();
    if (REJECTED.test(line)) {
      const now = (this.options.now ?? Date.now)();
      this.rejections = [...this.rejections.filter((at) => now - at < 120_000), now];
      this.message = shown;
      if (this.rejections.length >= 3) {
        this.rejections = [];
        this.options.onNeedsRecovery?.("rejected");
      }
      this.changed();
    }
  }

  /** Stops the child: SIGTERM, then SIGKILL after two seconds. */
  private async end(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.connections.clear();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 2_000);
    await gone;
    clearTimeout(timer);
    await fs.promises.rm(this.pidFile, { force: true }).catch(() => {});
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer || this.child) return;
    const delay = (this.options.restartDelayMs ?? ((n) => Math.min(60_000, 1_000 * 2 ** n)))(this.attempts++);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopped && !this.child && this.spec) this.launch();
    }, delay);
    this.restartTimer.unref?.();
  }

  private clearRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private changed(): void { this.options.onChange?.(); }
}
