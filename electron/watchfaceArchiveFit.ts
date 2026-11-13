import path from "node:path";
import { Worker } from "node:worker_threads";
import type { CorosWatchfaceArchiveSizeFit } from "./types";
import {
  ARCHIVE_FIT_TARGET_BYTES,
  ARCHIVE_FIT_TRIGGER_BYTES,
  fitArchiveEntries,
  type ArchiveFitEntry,
  type ArchiveFitResult
} from "./watchfaceCompiler/archiveFit";
import type { FitWorkerRequest, FitWorkerResponse } from "./watchfaceCompiler/fitWorker";
import { createStoreZip } from "./zipStore";

export { ARCHIVE_FIT_TARGET_BYTES, ARCHIVE_FIT_TRIGGER_BYTES };

interface UnzipperModule {
  Open: { buffer(data: Buffer): Promise<{ files: Array<{ path: string; type: string; buffer(): Promise<Buffer> }> }> };
}

/** Runs `fitArchiveEntries` in a worker thread; in-process if the worker cannot start. */
function fitInWorker(entries: ArchiveFitEntry[], targetBytes: number): Promise<ArchiveFitResult> {
  // Packaged builds unpack the compiler folder from app.asar (see asarUnpack) so the worker can load it.
  const script = path.join(__dirname, "watchfaceCompiler", "fitWorker.js").replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
  let worker: Worker;
  try { worker = new Worker(script); } catch { return fitArchiveEntries(entries, targetBytes); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); action();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Compressing the watch face took too long."))), 180_000);
    worker.once("message", (response: FitWorkerResponse) => finish(() => {
      if ("error" in response) reject(new Error(response.error));
      else resolve(response);
    }));
    worker.once("error", (error: NodeJS.ErrnoException) => finish(() => {
      if (error.code === "ERR_WORKER_OUT_OF_MEMORY") reject(new Error("The watch face is too large to compress."));
      else fitArchiveEntries(entries, targetBytes).then(resolve, reject);
    }));
    worker.once("exit", () => finish(() => reject(new Error("Compressing the watch face stopped unexpectedly."))));
    worker.postMessage({ entries, targetBytes } satisfies FitWorkerRequest);
  });
}

/**
 * A final face archive as it should leave CorosLink: over `triggerBytes` (10 MB) its images are
 * compressed toward `targetBytes` (8 MB), losslessly first and then just as far as needed (see
 * `fitArchiveEntries`); smaller archives, and any the pass cannot shrink, come back untouched.
 */
export async function fitWatchfaceArchiveSize(
  archive: Buffer,
  { triggerBytes = ARCHIVE_FIT_TRIGGER_BYTES, targetBytes = ARCHIVE_FIT_TARGET_BYTES } = {}
): Promise<{ bytes: Buffer; fit?: CorosWatchfaceArchiveSizeFit }> {
  if (archive.length <= triggerBytes) return { bytes: archive };
  const unzipper = require("unzipper") as UnzipperModule;
  const entries = await Promise.all((await unzipper.Open.buffer(archive)).files
    .filter(entry => entry.type === "File")
    .map(async entry => ({ name: entry.path, data: await entry.buffer() })));
  const { entries: fitted, stats } = await fitInWorker(entries, targetBytes);
  const bytes = createStoreZip(fitted.map(entry => ({
    name: entry.name,
    data: Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength)
  })));
  if (bytes.length >= archive.length) return { bytes: archive };
  return { bytes, fit: { originalBytes: archive.length, bytes: bytes.length, ...stats } };
}
