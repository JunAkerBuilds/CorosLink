// Compiles a final watch-face archive (DAT/ZIP) into the BIN a COROS watch installs, with the compiler moved from
// CorosLink (desktop/watchface/compiler). It runs in a worker thread (dist/main/watchfaceCompiler.cjs) so a big face
// never stalls the app, and in-process only if the worker can't start. Rewritten from CorosLink's
// corosWatchfaceCompiler.ts for this app: no Electron in here (the data folder is passed in) and the app's own ZIP
// reader instead of the unzipper package. Same checks, same names, so CorosLink's tests carry over.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { createStoreZip } from "../../watchface/zipStore";
import { readZip, unsafeZipPath } from "../../watchface/zipRead";
import { encodeWatchfaceFile, WATCHFACE_MAX_BYTES } from "../../watchface/corosBleWatchfaceProtocol";
import { compileWatchface, WatchfaceCompileError, type ArchiveFiles } from "../../watchface/compiler/compiler";
import type { WorkerRequest, WorkerResponse } from "../../watchface/compiler/worker";
import { WATCHFACE_TARGETS, watchfaceBinTarget, type WatchfaceBinTarget, type WatchfaceTarget } from "../../watchface/watchfaceTargets";
import type { WatchModelId } from "../../watchface/watchModels";
import { t } from "@/lib/i18n";

const MAX_ARCHIVE = 64 * 1024 * 1024;

export interface CorosWatchfaceCompilerStatus {
  available: boolean;
  busy: boolean;
  phase: "idle" | "starting" | "compiling" | "validating" | "ready" | "failed";
  detail: string;
}

export interface CompiledWatchfaceFile {
  filePath: string; bytes: number; faceId: number; durationMs: number; warnings: string[];
  /** The watch the BIN was built for. */
  model: WatchModelId;
}

/** Experimental image settings, off by default: full color on AMOLED, smooth edges on memory-in-pixel. */
export interface WatchfaceImageOptions { fullColor?: boolean; smoothEdges?: boolean }

/** Where the bundled worker sits beside the main process (scripts/build-main.mjs). */
export const COMPILER_WORKER = path.join(__dirname, "watchfaceCompiler.cjs");

function compileBuiltIn(files: ArchiveFiles, faceId: number, target: WatchfaceBinTarget, options: WatchfaceImageOptions, script: string): Promise<{ bin: Buffer; warnings: string[] }> {
  const { fullColor = false, smoothEdges = false } = options;
  const internal = (message: string) => new Error(t("The compiler hit an internal error: {reason}", { reason: message }));
  const inProcess = () => {
    try { return Promise.resolve(compileWatchface(files, { faceId, target, fullColor, smoothEdges })); }
    catch (error) { return Promise.reject(error instanceof WatchfaceCompileError ? error : internal(error instanceof Error ? error.message : String(error))); }
  };
  if (!fs.existsSync(script)) return inProcess();
  let worker: Worker;
  try { worker = new Worker(script); } catch { return inProcess(); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); action();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(t("The watch face took too long to compile.")))), 120_000);
    worker.once("message", (response: WorkerResponse) => finish(() => {
      if ("error" in response) reject(response.face ? new WatchfaceCompileError(response.error) : internal(response.error));
      else resolve({ bin: Buffer.from(response.bin.buffer, response.bin.byteOffset, response.bin.byteLength), warnings: response.warnings });
    }));
    worker.once("error", (error: NodeJS.ErrnoException) => finish(() => {
      if (error.code === "ERR_WORKER_OUT_OF_MEMORY") reject(new WatchfaceCompileError(t("The watch face is too large to compile. Use smaller images.")));
      else inProcess().then(resolve, reject);
    }));
    worker.once("exit", () => finish(() => reject(internal("the compiler stopped unexpectedly."))));
    worker.postMessage({ entries: [...files], faceId, target, fullColor, smoothEdges } satisfies WorkerRequest);
  });
}

/**
 * One watch's layout from a final archive, ready to compile; project bundles and ZIP traversal are refused. With
 * `preferred` the archive must have that watch's layout; without, the first supported watch whose layout it has is
 * used, PACE Pro first. The face ID is stable for the same archive.
 */
export function prepareWatchfaceArchive(archive: Buffer, preferred?: WatchfaceTarget):
  { zip: Buffer; files: Map<string, Buffer>; faceId: number; target: WatchfaceTarget } {
  if (archive.length > MAX_ARCHIVE) throw new Error(t("Choose a final watch face DAT/ZIP smaller than 64 MB."));
  const all = readZip(archive);
  if (all.length > 15_000) throw new Error(t("The watch face archive has too many files."));
  let expanded = 0;
  for (const entry of all) {
    if (unsafeZipPath(entry.path)) throw new Error(t("The watch face archive contains an unsafe path."));
    expanded += entry.size;
    if (!Number.isSafeInteger(expanded) || expanded > 128 * 1024 * 1024) throw new Error(t("The expanded watch face archive is too large."));
  }
  const files = all.filter((entry) => !entry.directory && !entry.path.startsWith("__MACOSX/"));
  const manifests = files.filter((entry) => /(^|\/)info\.json$/.test(entry.path));
  if (manifests.length !== 1 || manifests[0].size > 65536) {
    throw new Error(t("Choose a final watch face DAT/ZIP with info.json. Editable project ZIPs must be exported as a final face first."));
  }
  const manifest = manifests[0];
  const prefix = manifest.path.slice(0, -"info.json".length);
  const entries = new Map(files.filter((entry) => entry.path.startsWith(prefix)).map((entry) => [entry.path.slice(prefix.length), entry]));
  const target = preferred ?? WATCHFACE_TARGETS.find((candidate) => entries.has(`${watchfaceBinTarget(candidate).layout}/config.txt`));
  if (!target) throw new Error(t("This archive has no layout for a supported watch (416 × 416 for PACE Pro, 260 × 260 for APEX 4, …). Convert or export it for your watch first."));
  const { layout, screen, label } = watchfaceBinTarget(target);
  if (!entries.has(`${layout}/config.txt`)) throw new Error(t("This archive needs a {size} {watch} layout. Convert or export it for {watch} first.", { size: `${screen} × ${screen}`, watch: label }));
  const info: unknown = JSON.parse(manifest.read().toString("utf8"));
  if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error(t("Invalid watch face manifest."));
  const fields = info as Record<string, unknown>;
  fields.m_app = layout;
  // COROS's LoadInfo calls strlen on m_preview unchecked; faces recovered from compiled BINs have none.
  if (typeof fields.m_preview !== "string") fields.m_preview = entries.has("watchface_customize.png") ? "watchface_customize.png" : "";
  const source: Array<{ name: string; data: Buffer }> = [{ name: "info.json", data: Buffer.from(JSON.stringify(fields)) }];
  for (const [name, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    if (name.startsWith(`${layout}/`) || name === "watchface_customize.png") source.push({ name, data: entry.read() });
  }
  const zip = createStoreZip(source);
  if (zip.length > MAX_ARCHIVE) throw new Error(t("The normalized watch face is too large."));
  // A stable local identifier, independent of COROS account and catalog IDs.
  const faceId = (createHash("sha256").update(zip).digest().readUInt32LE(0) & 0x3fffffff) | 0x40000000;
  return { zip, files: new Map(source.map((entry) => [entry.name, entry.data])), faceId, target };
}

/** `prepareWatchfaceArchive` for a file on disk, as CorosLink's callers and tests use it. */
export async function prepareLocalWatchfaceZip(filename: string, preferred?: WatchfaceTarget): Promise<ReturnType<typeof prepareWatchfaceArchive>> {
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE) throw new Error(t("Choose a final watch face DAT/ZIP smaller than 64 MB."));
  return prepareWatchfaceArchive(await fs.promises.readFile(filename), preferred);
}

export class CorosWatchfaceCompiler {
  private busy = false;
  private phase: CorosWatchfaceCompilerStatus["phase"] = "idle";
  private detail = "";
  private saved = new Map<string, { filename: string; expires: number }>();
  constructor(private readonly directory: string, private readonly worker = COMPILER_WORKER) {}

  status(): CorosWatchfaceCompilerStatus {
    return { available: true, busy: this.busy, phase: this.phase, detail: this.detail || t("Compiler ready.") };
  }

  /**
   * Compiles for `target` (the archive's first supported layout, PACE Pro first, when omitted). `fullColor` keeps
   * detailed images unquantized; a face that then outgrows a watch transfer is built with palettes instead, with a
   * warning. `smoothEdges` encodes memory-in-pixel soft edges (experimental).
   */
  async compile(filename: string, name: string, target?: WatchfaceTarget, options: WatchfaceImageOptions = {}): Promise<CompiledWatchfaceFile> {
    if (this.busy) throw new Error(t("Wait for the current watch face compilation to finish."));
    const job = randomUUID(), started = Date.now();
    this.busy = true; this.phase = "starting"; this.detail = t("Preparing watch face…");
    try {
      await this.pruneResults();
      const { files, faceId, target: built } = await prepareLocalWatchfaceZip(filename, target);
      this.phase = "compiling"; this.detail = t("Compiling watch face…");
      let { bin, warnings } = await compileBuiltIn(files, faceId, watchfaceBinTarget(built), options, this.worker);
      if (options.fullColor && bin.length > WATCHFACE_MAX_BYTES - 16) {
        const full = bin.length;
        ({ bin, warnings } = await compileBuiltIn(files, faceId, watchfaceBinTarget(built), { smoothEdges: options.smoothEdges }, this.worker));
        warnings.push(t("Full color made this face {mb} MB, over the {max} MB a watch accepts, so its images use 256-color palettes.", { mb: (full / 1048576).toFixed(1), max: (WATCHFACE_MAX_BYTES / 1048576).toFixed(1) }));
      }
      this.phase = "validating"; this.detail = t("Checking compiled BIN…");
      if (bin.toString("latin1", 0, 4) !== watchfaceBinTarget(built).magic) throw new Error(t("The compiler did not return a {watch} BIN.", { watch: built.label }));
      if (bin.length < 0x340 || bin.length > WATCHFACE_MAX_BYTES - 16) throw new Error(t("The compiler returned an unsupported BIN."));
      if (encodeWatchfaceFile(bin).faceId !== faceId) throw new Error(t("The compiled BIN did not match the requested face."));
      const outputDirectory = path.join(this.directory, "results", job);
      await fs.promises.mkdir(outputDirectory, { recursive: true });
      // eslint-disable-next-line no-control-regex
      const safeName = path.basename(name).replace(/[\u0000-\u001f<>:"|?*\\/]/g, "").replace(/\.(zip|dat|bin)$/i, "").slice(0, 80) || "Custom-watch-face";
      const filePath = path.join(outputDirectory, `${safeName}.bin`);
      await fs.promises.writeFile(filePath, bin, { mode: 0o600 });
      this.phase = "ready"; this.detail = t("BIN compiled and validated.");
      return { filePath, bytes: bin.length, faceId, durationMs: Date.now() - started, warnings, model: built.model };
    } catch (error) {
      this.phase = "failed"; this.detail = error instanceof Error ? error.message : t("Could not compile the watch face.");
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** Save BIN reaches a result for an hour (see remember); older results, including earlier sessions', are removed. */
  private async pruneResults(): Promise<void> {
    const root = path.join(this.directory, "results"), cutoff = Date.now() - 60 * 60_000;
    let names: string[];
    try { names = await fs.promises.readdir(root); } catch { return; }
    await Promise.all(names.map(async (name) => {
      const entry = path.join(root, name);
      try { if ((await fs.promises.stat(entry)).mtimeMs < cutoff) await fs.promises.rm(entry, { recursive: true, force: true }); } catch { /* gone already */ }
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
    if (!saved || saved.expires < Date.now()) throw new Error(t("Compile the watch face again before saving its BIN."));
    return saved.filename;
  }
}
