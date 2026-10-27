import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { createStoreZip } from "./zipStore";
import { encodeWatchfaceFile, WATCHFACE_MAX_BYTES } from "./corosBleWatchfaceProtocol";
import type { CorosWatchfaceCompilerStatus } from "./corosWatchfaceCompilerTypes";
import { compileWatchface, WatchfaceCompileError, type ArchiveFiles } from "./watchfaceCompiler/compiler";
import type { WorkerRequest, WorkerResponse } from "./watchfaceCompiler/worker";
import { WATCHFACE_TARGETS, watchfaceBinTarget, type WatchfaceBinTarget, type WatchfaceTarget } from "./watchfaceTargets";
import type { WatchModelId } from "./watchModels";

/**
 * CorosLink compiles every watch face with its own compiler (`watchfaceCompiler/`), on every
 * platform and for every watch. C-LINK on iPhone runs a Swift port of the same compiler.
 */
const MAX_ARCHIVE = 64 * 1024 * 1024;
interface ZipEntry { path: string; type: string; uncompressedSize: number; buffer(): Promise<Buffer> }
// Loaded when a face is compiled, not at app startup.
const loadUnzipper = () => require("unzipper") as { Open: {
  file(filename: string): Promise<{ files: ZipEntry[] }>;
} };
export interface CompiledWatchfaceFile {
  filePath: string; bytes: number; faceId: number; durationMs: number; warnings: string[];
  /** The watch the BIN was built for. */
  model: WatchModelId;
}

/**
 * Runs the compiler in a worker thread so a large face never stalls the main process. If the
 * worker cannot start, it compiles in-process. Faults in the compiler itself (rather than in the
 * face) are reported as internal errors.
 */
function compileBuiltIn(files: ArchiveFiles, faceId: number, target: WatchfaceBinTarget, fullColor = false): Promise<{ bin: Buffer; warnings: string[] }> {
  const internal = (message: string) => new Error(`The compiler hit an internal error: ${message}`);
  const inProcess = () => {
    try { return Promise.resolve(compileWatchface(files, { faceId, target, fullColor })); }
    catch (error) { return Promise.reject(error instanceof WatchfaceCompileError ? error : internal(error instanceof Error ? error.message : String(error))); }
  };
  // Packaged builds unpack the compiler from app.asar (see asarUnpack) so the worker can load it.
  const script = path.join(__dirname, "watchfaceCompiler", "worker.js").replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
  let worker: Worker;
  try { worker = new Worker(script); } catch { return inProcess(); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); action();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("The watch face took too long to compile."))), 120_000);
    worker.once("message", (response: WorkerResponse) => finish(() => {
      if ("error" in response) reject(response.face ? new WatchfaceCompileError(response.error) : internal(response.error));
      else resolve({ bin: Buffer.from(response.bin.buffer, response.bin.byteOffset, response.bin.byteLength), warnings: response.warnings });
    }));
    worker.once("error", (error: NodeJS.ErrnoException) => finish(() => {
      if (error.code === "ERR_WORKER_OUT_OF_MEMORY") reject(new WatchfaceCompileError("The watch face is too large to compile. Use smaller images."));
      else inProcess().then(resolve, reject);
    }));
    worker.once("exit", () => finish(() => reject(internal("the compiler stopped unexpectedly."))));
    worker.postMessage({ entries: [...files], faceId, target, fullColor } satisfies WorkerRequest);
  });
}

/**
 * Normalize one watch's resolution; reject project bundles and ZIP traversal. With `preferred`
 * the archive must have that watch's layout; without, the first supported watch whose layout it
 * has is used, PACE Pro first.
 */
export async function prepareLocalWatchfaceZip(filename: string, preferred?: WatchfaceTarget):
  Promise<{ zip: Buffer; files: Map<string, Buffer>; faceId: number; target: WatchfaceTarget }> {
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE) throw new Error("Choose a final watch face DAT/ZIP smaller than 64 MB.");
  const directory = await loadUnzipper().Open.file(filename);
  if (directory.files.length > 8192) throw new Error("The watch face archive has too many files.");
  let expanded = 0;
  for (const entry of directory.files) {
    const name = entry.path;
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /[\u0000-\u001f]/.test(name) || /^[a-z]:/i.test(name)) {
      throw new Error("The watch face archive contains an unsafe path.");
    }
    expanded += entry.uncompressedSize;
    if (!Number.isSafeInteger(expanded) || expanded > 128 * 1024 * 1024) throw new Error("The expanded watch face archive is too large.");
  }
  const files = directory.files.filter(entry => entry.type === "File" && !entry.path.startsWith("__MACOSX/"));
  const manifests = files.filter(entry => /(^|\/)info\.json$/.test(entry.path));
  if (manifests.length !== 1 || manifests[0]!.uncompressedSize > 65536) {
    throw new Error("Choose a final watch face DAT/ZIP with info.json. Editable project ZIPs must be exported as a final face first.");
  }
  const manifest = manifests[0]!;
  const prefix = manifest.path.slice(0, -"info.json".length);
  const entries = new Map(files.filter(entry => entry.path.startsWith(prefix)).map(entry => [entry.path.slice(prefix.length), entry]));
  const target = preferred ?? WATCHFACE_TARGETS.find(candidate => entries.has(`${watchfaceBinTarget(candidate).layout}/config.txt`));
  if (!target) throw new Error("This archive has no layout for a supported watch (416 × 416 for PACE Pro, 260 × 260 for APEX 4, …). Convert or export it for your watch first.");
  const { layout, screen, label } = watchfaceBinTarget(target);
  if (!entries.has(`${layout}/config.txt`)) throw new Error(`This archive needs a ${screen} × ${screen} ${label} layout. Convert or export it for ${label} first.`);
  const info = JSON.parse((await manifest.buffer()).toString("utf8"));
  if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("Invalid watch face manifest.");
  info.m_app = layout;
  // COROS's LoadInfo calls strlen on m_preview unchecked; faces recovered from
  // compiled BINs have none, which crashes the compiler on any platform.
  if (typeof info.m_preview !== "string") info.m_preview = entries.has("watchface_customize.png") ? "watchface_customize.png" : "";
  const source: Array<{ name: string; data: Buffer }> = [{ name: "info.json", data: Buffer.from(JSON.stringify(info)) }];
  for (const [name, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    if (name.startsWith(`${layout}/`) || name === "watchface_customize.png") {
      const data = await entry.buffer();
      if (data.length !== entry.uncompressedSize) throw new Error("The watch face archive contains a truncated file.");
      source.push({ name, data });
    }
  }
  const zip = createStoreZip(source);
  if (zip.length > MAX_ARCHIVE) throw new Error("The normalized watch face is too large.");
  // Stable local identifier, independent of COROS account/catalog IDs.
  const faceId = (createHash("sha256").update(zip).digest().readUInt32LE(0) & 0x3fffffff) | 0x40000000;
  return { zip, files: new Map(source.map(entry => [entry.name, entry.data])), faceId, target };
}

export class CorosWatchfaceCompiler {
  private busy = false;
  private phase: CorosWatchfaceCompilerStatus["phase"] = "idle";
  private detail = "";
  private saved = new Map<string, { filename: string; expires: number }>();
  constructor(private readonly directory: string) {}

  status(): CorosWatchfaceCompilerStatus {
    return { available: true, busy: this.busy, phase: this.phase, detail: this.detail || "Compiler ready." };
  }

  /**
   * Compiles for `target` (the archive's first supported layout, PACE Pro first, when omitted).
   * `fullColor` keeps detailed images unquantized; a face that then outgrows a watch transfer
   * is built with palettes instead, with a warning.
   */
  async compile(filename: string, name: string, target?: WatchfaceTarget, options: { fullColor?: boolean } = {}): Promise<CompiledWatchfaceFile> {
    if (this.busy) throw new Error("Wait for the current watch face compilation to finish.");
    const job = randomUUID(), started = Date.now();
    this.busy = true; this.phase = "starting"; this.detail = "Preparing watch face…";
    try {
      await this.pruneResults();
      const { files, faceId, target: built } = await prepareLocalWatchfaceZip(filename, target);
      this.phase = "compiling"; this.detail = "Compiling watch face…";
      let { bin, warnings } = await compileBuiltIn(files, faceId, watchfaceBinTarget(built), options.fullColor);
      if (options.fullColor && bin.length > WATCHFACE_MAX_BYTES - 16) {
        const full = bin.length;
        ({ bin, warnings } = await compileBuiltIn(files, faceId, watchfaceBinTarget(built)));
        warnings.push(`Full color made this face ${(full / 1048576).toFixed(1)} MB, over the ${(WATCHFACE_MAX_BYTES / 1048576).toFixed(1)} MB a watch accepts, so its images use 256-color palettes.`);
      }
      this.phase = "validating"; this.detail = "Checking compiled BIN…";
      if (bin.toString("latin1", 0, 4) !== watchfaceBinTarget(built).magic) throw new Error(`The compiler did not return a ${built.label} BIN.`);
      if (bin.length < 0x340 || bin.length > WATCHFACE_MAX_BYTES - 16) throw new Error("The compiler returned an unsupported BIN.");
      if (encodeWatchfaceFile(bin).faceId !== faceId) throw new Error("The compiled BIN did not match the requested face.");
      const outputDirectory = path.join(this.directory, "results", job);
      await fs.promises.mkdir(outputDirectory, { recursive: true });
      const safeName = path.basename(name).replace(/[\u0000-\u001f<>:"|?*\\/]/g, "").replace(/\.(zip|dat|bin)$/i, "").slice(0, 80) || "Custom-watch-face";
      const filePath = path.join(outputDirectory, safeName + ".bin");
      await fs.promises.writeFile(filePath, bin, { mode: 0o600 });
      this.phase = "ready"; this.detail = "BIN compiled and validated.";
      return { filePath, bytes: bin.length, faceId, durationMs: Date.now() - started, warnings, model: built.model };
    } catch (error) {
      this.phase = "failed"; this.detail = error instanceof Error ? error.message : "Could not compile the watch face.";
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** Save BIN reaches a result for an hour (see remember); older results, including earlier sessions', are unreachable. */
  private async pruneResults(): Promise<void> {
    const root = path.join(this.directory, "results"), cutoff = Date.now() - 60 * 60_000;
    let names: string[];
    try { names = await fs.promises.readdir(root); } catch { return; }
    await Promise.all(names.map(async name => {
      const entry = path.join(root, name);
      try { if ((await fs.promises.stat(entry)).mtimeMs < cutoff) await fs.promises.rm(entry, { recursive: true, force: true }); } catch {}
    }));
  }

  remember(previewId: string, filename: string): void {
    this.saved.set(previewId, { filename, expires: Date.now() + 60 * 60_000 });
    while (this.saved.size > 8) {
      const [oldest, evicted] = this.saved.entries().next().value!;
      this.saved.delete(oldest);
      void fs.promises.rm(path.dirname(evicted.filename), { recursive: true, force: true }).catch(() => {});
    }
  }
  fileForPreview(previewId: string): string {
    const saved = this.saved.get(previewId);
    if (!saved || saved.expires < Date.now()) throw new Error("Compile the watch face again before saving its BIN.");
    return saved.filename;
  }
}
let instance: CorosWatchfaceCompiler | undefined;
export function getCorosWatchfaceCompiler(): CorosWatchfaceCompiler {
  return instance ??= new CorosWatchfaceCompiler(path.join(app.getPath("userData"), "watchface-compiler"));
}
