import { execFile, spawn as spawnProcess, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import zlib from "node:zlib";

/**
 * Cloudflare's tunnel connector, `cloudflared`, for the away-from-home route:
 * finding one, downloading the pinned release (only after the person agrees),
 * and running `cloudflared tunnel --no-autoupdate run` with the connector
 * token in TUNNEL_TOKEN (never in argv, where any process can read it).
 *
 * A cloudflared on PATH or at COROSLINK_CLOUDFLARED_PATH is the person's own
 * choice: it is never replaced or updated, but one older than
 * CLOUDFLARED_MIN_VERSION is passed over (see there).
 *
 * Intel Macs: Cloudflare stops publishing darwin-amd64 builds in 2027. The
 * pinned build keeps working; once newer pins have no Intel asset, Intel Macs
 * keep the local network route only.
 */

// ----- The pinned release -----

export type CloudflaredTarget = "darwin-arm64" | "darwin-amd64" | "windows-amd64" | "linux-amd64";

export interface CloudflaredAsset {
  target: CloudflaredTarget;
  url: string;
  /** Bytes of the download. */
  size: number;
  /** SHA-256 (hex) of the download. */
  sha256: string;
  /** The macOS builds are a .tgz holding one `cloudflared`. */
  archive: "tgz" | null;
  /** SHA-256 (hex) of the binary itself (the .tgz's member on macOS). */
  binarySha256: string;
}

/**
 * cloudflared 2026.10.5 (published 2026-10-27).
 *
 * Checksums come from the "SHA256 Checksums" list in Cloudflare's release
 * notes, https://github.com/cloudflare/cloudflared/releases/tag/2026.10.5.
 * For the two macOS .tgz files those notes list the hash of the `cloudflared`
 * binary inside the archive, not of the archive, so `binarySha256` is
 * Cloudflare's number and the archive's `sha256` is GitHub's published asset
 * digest (GET /repos/cloudflare/cloudflared/releases/tags/2026.10.5, `digest`).
 * Both were checked against the downloaded files on 2026-10-27. For Linux and
 * Windows the two sources agree.
 */
export const CLOUDFLARED_VERSION = "2026.10.5";
const RELEASE_BASE = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

/**
 * The oldest cloudflared CorosLink runs. Earlier builds still trust eight
 * eMudhra (emSign) intermediates with weak private keys (Cloudflare's notice
 * of 2026-10-20); 2026.10.2 dropped them, and 2026.10.3 fixed macOS builds not
 * installed with Homebrew. Applies to every source, the person's own included.
 */
export const CLOUDFLARED_MIN_VERSION = "2026.10.3";

export const CLOUDFLARED_ASSETS: Record<CloudflaredTarget, CloudflaredAsset> = {
  "darwin-arm64": {
    target: "darwin-arm64",
    url: `${RELEASE_BASE}/cloudflared-darwin-arm64.tgz`,
    size: 19_840_425,
    sha256: "184c7d4f5f977348243a6d7ca8f6cf6073b9b2746cfe8c1fe15aa59e9a522bf0",
    archive: "tgz",
    binarySha256: "2b23964528ddcd641c1449275df8b5b51e3c7193b5257919846331bc5bc13b0f"
  },
  "darwin-amd64": {
    target: "darwin-amd64",
    url: `${RELEASE_BASE}/cloudflared-darwin-amd64.tgz`,
    size: 21_798_374,
    sha256: "6699392fed92367808c248c2d90bed66e49bbf66e1b4ee3e4141230f3f7391b3",
    archive: "tgz",
    binarySha256: "cb09afb9b4d0a4730de477ac710aebb6107568930a8345775629bf264f70c284"
  },
  "windows-amd64": {
    target: "windows-amd64",
    url: `${RELEASE_BASE}/cloudflared-windows-amd64.exe`,
    size: 55_343_328,
    sha256: "db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9",
    archive: null,
    binarySha256: "db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9"
  },
  "linux-amd64": {
    target: "linux-amd64",
    url: `${RELEASE_BASE}/cloudflared-linux-amd64`,
    size: 40_263_303,
    sha256: "e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298",
    archive: null,
    binarySha256: "e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298"
  }
};

/** The pinned build for this computer, or null when Cloudflare has none we pin. */
export function cloudflaredTarget(platform: NodeJS.Platform, arch: string): CloudflaredTarget | null {
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : arch === "x64" ? "darwin-amd64" : null;
  // Windows on Arm runs the x64 build.
  if (platform === "win32") return arch === "x64" || arch === "arm64" ? "windows-amd64" : null;
  if (platform === "linux") return arch === "x64" ? "linux-amd64" : null;
  return null;
}

/** Intel Macs lose new cloudflared builds in 2027 (see the note at the top). */
export function isIntelMac(platform: NodeJS.Platform, arch: string): boolean {
  return platform === "darwin" && arch === "x64";
}

export function cloudflaredBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

export function managedCloudflaredPath(userDataDir: string, version: string, platform: NodeJS.Platform): string {
  return path.join(userDataDir, "cloudflared", version, cloudflaredBinaryName(platform));
}

// ----- Finding one -----

export type CloudflaredSource = "env" | "path" | "managed";

export interface ResolvedCloudflared {
  path: string;
  source: CloudflaredSource;
  /** Null when the person's own build doesn't say (`cloudflared --version`). */
  version: string | null;
  /** A downloaded build older than the pinned one: run it until the new one is in. */
  stale?: boolean;
}

export interface FindCloudflaredInput {
  env: NodeJS.ProcessEnv;
  userDataDir: string;
  platform: NodeJS.Platform;
  arch: string;
}

async function isExecutableFile(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(candidate);
    if (!stat.isFile()) return false;
    if (platform !== "win32") await fs.promises.access(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const verifiedManaged = new Map<string, number>();

async function fileSha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** `cloudflared version 2026.10.5 (built …)` → "2026.10.5"; null when it doesn't say. */
export function parseCloudflaredVersion(output: string): string | null {
  return /\bversion\s+(\d{4}\.\d{1,2}\.\d{1,3})\b/i.exec(output)?.[1] ?? null;
}

const probedVersions = new Map<string, { mtimeMs: number; version: string | null }>();

/** Asks the person's own cloudflared its version (again only after the file changes). */
async function probeVersion(binary: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const stat = await fs.promises.stat(binary);
  const cached = probedVersions.get(binary);
  if (cached?.mtimeMs === stat.mtimeMs) return cached.version;
  const output = await new Promise<string>((resolve) => {
    execFile(binary, ["--version"], { env, timeout: 10_000, windowsHide: true }, (_error, stdout, stderr) =>
      resolve(`${stdout ?? ""}\n${stderr ?? ""}`)
    );
  });
  const version = parseCloudflaredVersion(output);
  probedVersions.set(binary, { mtimeMs: stat.mtimeMs, version });
  return version;
}

/** A known version older than CLOUDFLARED_MIN_VERSION (one that doesn't say gets the benefit of the doubt). */
export function isVulnerableCloudflared(version: string | null): boolean {
  return version !== null && compareVersions(version, CLOUDFLARED_MIN_VERSION) < 0;
}

/**
 * The cloudflared to run: COROSLINK_CLOUDFLARED_PATH, then one on PATH, then
 * the downloaded pinned build (re-hashed once per launch), then an older
 * downloaded build. Builds older than CLOUDFLARED_MIN_VERSION are passed over
 * (an override that old is an error). Null means none: ask before downloading.
 */
export async function findCloudflared(input: FindCloudflaredInput): Promise<ResolvedCloudflared | null> {
  const override = input.env.COROSLINK_CLOUDFLARED_PATH?.trim();
  if (override) {
    if (!(await isExecutableFile(override, input.platform))) {
      throw new Error("COROSLINK_CLOUDFLARED_PATH doesn't point at a cloudflared CorosLink can run.");
    }
    const version = await probeVersion(override, input.env);
    if (isVulnerableCloudflared(version)) {
      throw new Error(
        `The cloudflared at COROSLINK_CLOUDFLARED_PATH is version ${version}, which trusts compromised certificates. Update it to ${CLOUDFLARED_MIN_VERSION} or later.`
      );
    }
    return { path: override, source: "env", version };
  }
  const name = cloudflaredBinaryName(input.platform);
  for (const directory of (input.env.PATH ?? input.env.Path ?? "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    if (!(await isExecutableFile(candidate, input.platform))) continue;
    const version = await probeVersion(candidate, input.env);
    // Too old to trust: fall through to the pinned build rather than run it.
    if (isVulnerableCloudflared(version)) continue;
    return { path: candidate, source: "path", version };
  }
  const target = cloudflaredTarget(input.platform, input.arch);
  const managed = managedCloudflaredPath(input.userDataDir, CLOUDFLARED_VERSION, input.platform);
  if (target && (await isExecutableFile(managed, input.platform))) {
    const stat = await fs.promises.stat(managed);
    if (verifiedManaged.get(managed) !== stat.mtimeMs) {
      if ((await fileSha256(managed)) !== CLOUDFLARED_ASSETS[target].binarySha256) {
        // Damaged or replaced: remove it, so it's downloaded again (with consent).
        await fs.promises.rm(managed, { force: true });
        return findOlderManaged(input);
      }
      verifiedManaged.set(managed, stat.mtimeMs);
    }
    return { path: managed, source: "managed", version: CLOUDFLARED_VERSION };
  }
  return findOlderManaged(input);
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

async function findOlderManaged(input: FindCloudflaredInput): Promise<ResolvedCloudflared | null> {
  let versions: string[];
  try {
    versions = await fs.promises.readdir(path.join(input.userDataDir, "cloudflared"));
  } catch {
    return null;
  }
  const older = versions
    .filter(
      (version) =>
        /^\d{4}\.\d{1,2}\.\d{1,3}$/.test(version) &&
        compareVersions(version, CLOUDFLARED_VERSION) < 0 &&
        !isVulnerableCloudflared(version)
    )
    .sort(compareVersions)
    .reverse();
  for (const version of older) {
    const candidate = managedCloudflaredPath(input.userDataDir, version, input.platform);
    if (await isExecutableFile(candidate, input.platform)) {
      return { path: candidate, source: "managed", version, stale: true };
    }
  }
  return null;
}

/** Deletes downloaded builds other than `keepVersion` (after a version swap). */
export async function pruneManagedCloudflared(userDataDir: string, keepVersion: string): Promise<void> {
  const root = path.join(userDataDir, "cloudflared");
  let entries: string[];
  try {
    entries = await fs.promises.readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry !== keepVersion && /^\d{4}\.\d{1,2}\.\d{1,3}$/.test(entry)) {
      await fs.promises.rm(path.join(root, entry), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// ----- Downloading the pinned build -----

/** As scripts/prepare-binaries.mjs: refuse anything that isn't the pinned bytes. */
export function verifySha256(buffer: Buffer, expected: string, label: string): void {
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actual !== expected) {
    throw new Error(`${label} failed SHA-256 verification (expected ${expected}, received ${actual}). CorosLink didn't install it.`);
  }
}

/** As scripts/prepare-binaries.mjs, plus a unique temp name and the executable bit set before the rename. */
export async function writeFileAtomic(destination: string, buffer: Buffer, mode = 0o755): Promise<void> {
  const tempFile = `${destination}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(tempFile, buffer, { mode });
    await fs.promises.chmod(tempFile, mode);
    await fs.promises.rename(tempFile, destination);
  } catch (error) {
    await fs.promises.rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** One regular file from a (ustar/pax/GNU) tar, by base name. */
export function extractTarMember(tar: Buffer, name: string): Buffer {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) break;
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    const entryName = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const dataStart = offset + 512;
    if ((type === "0" || type === "\0") && path.posix.basename(entryName) === name && !entryName.includes("..")) {
      if (dataStart + size > tar.length) break;
      return Buffer.from(tar.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`The cloudflared download doesn't contain ${name}.`);
}

export interface DownloadCloudflaredInput {
  asset: CloudflaredAsset;
  version: string;
  userDataDir: string;
  platform: NodeJS.Platform;
  fetch?: typeof fetch;
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Downloads the pinned build into userData/cloudflared/<version>/, checks its
 * SHA-256 (and the binary's, for a .tgz), and writes it atomically with the
 * executable bit set. Nothing reaches the final path unless every check passes.
 */
export async function downloadCloudflared(input: DownloadCloudflaredInput): Promise<string> {
  const fetchImpl = input.fetch ?? fetch;
  const label = `cloudflared ${input.version} (${input.asset.target})`;
  let response: Response;
  try {
    response = await fetchImpl(input.asset.url, {
      redirect: "follow",
      headers: { "User-Agent": "CorosLink" },
      ...(input.signal ? { signal: input.signal } : {})
    });
  } catch {
    throw new Error("Couldn't download Cloudflare's connector. Check your internet connection.");
  }
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't download Cloudflare's connector (${response.status}).`);
  }
  const limit = input.asset.size + 1024 * 1024;
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${label} is larger than expected. CorosLink didn't install it.`);
    }
    chunks.push(Buffer.from(value));
    input.onProgress?.(received, input.asset.size);
  }
  const download = Buffer.concat(chunks);
  verifySha256(download, input.asset.sha256, label);
  const binary = input.asset.archive === "tgz" ? extractTarMember(zlib.gunzipSync(download), "cloudflared") : download;
  verifySha256(binary, input.asset.binarySha256, label);
  const destination = managedCloudflaredPath(input.userDataDir, input.version, input.platform);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await writeFileAtomic(destination, binary, 0o755);
  return destination;
}

// ----- Whether this network lets it out -----

/**
 * cloudflared reaches Cloudflare's edge on port 7844 only (QUIC on UDP, and
 * its HTTP/2 fallback on TCP); there is no 443 route. School, office and
 * hotel networks often block 7844 and leave HTTPS open.
 */
export const TUNNEL_EDGE_PORT = 7844;
const TUNNEL_EDGE_HOSTS = ["region1.v2.argotunnel.com", "region2.v2.argotunnel.com"];

export interface EdgePortProbe {
  /** A TCP connection to the edge on 7844 went through. */
  tunnelPort: boolean;
  /** A TCP connection to the relay went through: this computer is online. */
  relay: boolean;
}

export interface ProbeEdgePortsInput {
  relay: { host: string; port: number };
  edgeHosts?: string[];
  edgePort?: number;
  timeoutMs?: number;
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (connected: boolean) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Opens (and at once closes) TCP connections to the edge on 7844 and to the
 * relay, both hosts CorosLink talks to anyway. The relay answering while the
 * edge doesn't means the network blocks the tunnel's port.
 */
export async function probeEdgePorts(input: ProbeEdgePortsInput): Promise<EdgePortProbe> {
  const timeoutMs = input.timeoutMs ?? 5_000;
  const edgePort = input.edgePort ?? TUNNEL_EDGE_PORT;
  const [edge, relay] = await Promise.all([
    Promise.all((input.edgeHosts ?? TUNNEL_EDGE_HOSTS).map((host) => canConnect(host, edgePort, timeoutMs))),
    canConnect(input.relay.host, input.relay.port, timeoutMs)
  ]);
  return { tunnelPort: edge.some(Boolean), relay };
}

// ----- Running it -----

export interface CloudflaredSpec {
  binary: string;
  /** The connector token. Goes to the child in TUNNEL_TOKEN only. */
  token: string;
  version: string | null;
}

export type ConnectorState = "stopped" | "starting" | "online" | "offline";

export interface ConnectorSnapshot {
  state: ConnectorState;
  /** Open connections to Cloudflare's edge (cloudflared keeps up to four). */
  connections: number;
  version: string | null;
  binary: string | null;
  /** Why it's offline, from cloudflared's own last words (token redacted). */
  message?: string;
  /** A newer connector is starting and will take over once it registers. */
  swapping: boolean;
}

export type CloudflaredSpawn = typeof spawnProcess;

export interface CloudflaredSupervisorOptions {
  spawn?: CloudflaredSpawn;
  env?: NodeJS.ProcessEnv;
  onChange?: (snapshot: ConnectorSnapshot) => void;
  /** cloudflared exited, or the edge keeps rejecting it: ask the relay to repair the tunnel. */
  onNeedsRecovery?: (reason: "exit" | "rejected") => void;
  /** A newer connector registered and the old one was stopped. */
  onSwapped?: (spec: CloudflaredSpec) => void;
  /** The running connector couldn't reach Cloudflare's edge (once per failed dial). */
  onEdgeUnreachable?: () => void;
  restartDelayMs?: (attempt: number) => number;
  rejectionLimit?: number;
  rejectionWindowMs?: number;
  now?: () => number;
}

const REGISTERED = /Registered tunnel connection/i;
const UNREGISTERED = /Unregistered tunnel connection|Connection terminated|Lost connection with the edge/i;
const REJECTED = /Unauthorized|Invalid tunnel secret|Tunnel not found|token is not valid|tunnel credentials/i;
/** A dial to the edge that got nowhere: QUIC timed out, or the HTTP/2 fallback couldn't connect. */
const EDGE_UNREACHABLE = /failed to dial to edge|Unable to establish connection with Cloudflare edge/i;

function redact(text: string, token: string): string {
  const clean = stripVTControlCharacters(text);
  return token ? clean.split(token).join("[token]") : clean;
}

/** One cloudflared process. */
class CloudflaredProcess {
  connections = 0;
  registered = false;
  exited = false;
  retired = false;
  tail = "";
  private buffer = "";
  private closing: Promise<void> | null = null;
  readonly child: ChildProcess;

  constructor(
    readonly spec: CloudflaredSpec,
    spawnImpl: CloudflaredSpawn,
    env: NodeJS.ProcessEnv,
    private readonly handlers: {
      line: (process: CloudflaredProcess, line: string) => void;
      exit: (process: CloudflaredProcess, code: number | null) => void;
    }
  ) {
    // The token rides in the environment only; argv is visible to every user.
    this.child = spawnImpl(spec.binary, ["tunnel", "--no-autoupdate", "run"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...env, TUNNEL_TOKEN: spec.token }
    });
    const read = (data: Buffer | string) => {
      this.buffer += data.toString();
      if (this.buffer.length > 64_000) this.buffer = this.buffer.slice(-16_000);
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) this.receive(line);
    };
    this.child.stdout?.on("data", read);
    this.child.stderr?.on("data", read);
    this.child.on("error", (error) => {
      this.tail = `Couldn't start cloudflared: ${error.message}`;
      this.finish(null);
    });
    this.child.on("exit", (code) => this.finish(code));
  }

  private receive(line: string): void {
    const clean = redact(line, this.spec.token).slice(0, 500);
    this.tail = clean;
    this.handlers.line(this, clean);
  }

  private finish(code: number | null): void {
    if (this.exited) return;
    if (this.buffer.trim()) this.receive(this.buffer);
    this.buffer = "";
    this.exited = true;
    this.connections = 0;
    this.handlers.exit(this, code);
  }

  /** As WatchfaceCodexCli.dispose: SIGTERM the process group, SIGKILL after a second (taskkill /T on Windows). */
  dispose(): Promise<void> {
    this.retired = true;
    return (this.closing ??= this.disposeInternal());
  }

  private async disposeInternal(): Promise<void> {
    const child = this.child;
    if (!child.pid || this.exited || child.exitCode !== null) return;
    const pid = child.pid;
    if (process.platform === "win32") {
      // Synchronous first, so a quitting app doesn't leave it running.
      try {
        child.kill();
      } catch {
        // Already exited.
      }
      await new Promise<void>((resolve) => execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => resolve()));
      return;
    }
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Already exited.
        }
      }
    };
    kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function sameSpec(left: CloudflaredSpec, right: CloudflaredSpec): boolean {
  return left.binary === right.binary && left.token === right.token;
}

/**
 * Keeps one connector running: restarts it with backoff when it exits, asks
 * for a recovery on exit or repeated rejections, and swaps connectors without
 * a gap (a new binary or token starts first; the old one stops only once the
 * new one has registered with Cloudflare).
 */
export class CloudflaredSupervisor {
  private current: CloudflaredProcess | null = null;
  private next: CloudflaredProcess | null = null;
  private spec: CloudflaredSpec | null = null;
  private stopped = true;
  private restartTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private rejections: number[] = [];
  private message: string | undefined;
  private readonly spawnImpl: CloudflaredSpawn;
  private readonly now: () => number;

  constructor(private readonly options: CloudflaredSupervisorOptions = {}) {
    this.spawnImpl = options.spawn ?? spawnProcess;
    this.now = options.now ?? Date.now;
  }

  snapshot(): ConnectorSnapshot {
    const current = this.current;
    let state: ConnectorState;
    if (!current) state = this.stopped ? "stopped" : "offline";
    else if (current.connections > 0) state = "online";
    else state = current.registered ? "offline" : "starting";
    return {
      state,
      connections: current?.connections ?? 0,
      version: (current?.spec ?? this.spec)?.version ?? null,
      binary: (current?.spec ?? this.spec)?.binary ?? null,
      ...(state !== "online" && this.message ? { message: this.message } : {}),
      swapping: Boolean(this.next)
    };
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** Starts the connector, or switches to a new binary or token without a gap. */
  run(spec: CloudflaredSpec): void {
    this.stopped = false;
    this.spec = spec;
    if (this.next && sameSpec(this.next.spec, spec)) return;
    if (this.current && !this.current.exited && sameSpec(this.current.spec, spec)) {
      // Asked for what's already running: drop a swap in progress.
      void this.next?.dispose();
      this.next = null;
      return this.changed();
    }
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (!this.current || this.current.exited) {
      this.current = this.launch(spec);
    } else {
      void this.next?.dispose();
      this.next = this.launch(spec);
    }
    this.changed();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const processes = [this.current, this.next].filter((item): item is CloudflaredProcess => Boolean(item));
    this.current = null;
    this.next = null;
    this.message = undefined;
    this.changed();
    await Promise.all(processes.map((item) => item.dispose()));
  }

  private launch(spec: CloudflaredSpec): CloudflaredProcess {
    return new CloudflaredProcess(spec, this.spawnImpl, this.options.env ?? process.env, {
      line: (item, line) => this.onLine(item, line),
      exit: (item, code) => this.onExit(item, code)
    });
  }

  private onLine(item: CloudflaredProcess, line: string): void {
    if (item.retired) return;
    if (REGISTERED.test(line)) {
      item.connections += 1;
      item.registered = true;
      this.attempts = 0;
      this.rejections = [];
      this.message = undefined;
      if (item === this.next) {
        const old = this.current;
        this.current = item;
        this.next = null;
        void old?.dispose();
        this.options.onSwapped?.(item.spec);
      }
      return this.changed();
    }
    if (UNREGISTERED.test(line)) {
      item.connections = Math.max(0, item.connections - 1);
      return this.changed();
    }
    if (EDGE_UNREACHABLE.test(line) && item === this.current) {
      this.options.onEdgeUnreachable?.();
      return;
    }
    if (REJECTED.test(line) && item === this.current) {
      const now = this.now();
      const window = this.options.rejectionWindowMs ?? 120_000;
      this.rejections = [...this.rejections.filter((at) => now - at < window), now];
      this.message = line;
      if (this.rejections.length >= (this.options.rejectionLimit ?? 3)) {
        this.rejections = [];
        this.options.onNeedsRecovery?.("rejected");
      }
      this.changed();
    }
  }

  private onExit(item: CloudflaredProcess, code: number | null): void {
    if (item.retired) return;
    if (item === this.next) {
      this.next = null;
      this.message = `The updated connector stopped before it connected (${code ?? "signal"}). ${item.tail}`.trim();
      return this.changed();
    }
    if (item !== this.current) return;
    this.current = null;
    this.message = `cloudflared stopped (${code ?? "signal"}). ${item.tail}`.trim();
    this.changed();
    if (this.stopped) return;
    this.options.onNeedsRecovery?.("exit");
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer || this.current) return;
    const delay = (this.options.restartDelayMs ?? ((attempt) => Math.min(60_000, 1_000 * 2 ** attempt)))(this.attempts);
    this.attempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopped || this.current || !this.spec) return;
      this.current = this.launch(this.spec);
      this.changed();
    }, delay);
    this.restartTimer.unref?.();
  }

  private changed(): void {
    this.options.onChange?.(this.snapshot());
  }
}
