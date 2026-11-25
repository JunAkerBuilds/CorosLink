import { parentPort } from "node:worker_threads";
import { fitArchiveEntries, type ArchiveFitEntry, type ArchiveFitResult } from "./archiveFit";

export interface FitWorkerRequest { entries: ArchiveFitEntry[]; targetBytes: number }
export type FitWorkerResponse = ArchiveFitResult | { error: string };

/** Shrinks a face archive's images off the main thread (see `fitArchiveEntries`). */
parentPort?.on("message", (message: FitWorkerRequest) => {
  fitArchiveEntries(message.entries, message.targetBytes).then(
    result => parentPort!.postMessage(result satisfies FitWorkerResponse),
    error => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies FitWorkerResponse)
  );
});
