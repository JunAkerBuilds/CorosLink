import { cepFileIsNewer, unixMsOfWatchHour, watchHour, type CepFile, type CepSpec } from "../corosWatchCep";
import { satelliteFilesFor, type WatchGpsAssistance } from "../corosWatchGpsAssist";
import type { WatchModelId } from "../watchModels";
import type { WatchSyncProgress } from "./localDataTypes";

/** The watch side of a satellite-data push, inside a local sync. */
export interface SatelliteLink {
  model(): WatchModelId | undefined;
  /** What the watch reports (settings type 13, else the bind reply). */
  readAssistance(): Promise<WatchGpsAssistance | undefined>;
  sendFile(file: CepFile): Promise<void>;
}

/** Where the files come from (the cache in watchCepService.ts). */
export interface SatelliteSources {
  cepFile(spec: CepSpec): Promise<CepFile>;
}

/**
 * Tops up the watch's GPS assistance, as the COROS app does for its receiver.
 *
 * COROS files (ELPO, LTO, RTO): each file the watch takes, in the app's order, is
 * sent when COROS has one that starts later than the data the watch holds in
 * that slot and hasn't run out; it replaces that data whole.
 * A file already sent on this connection is not sent again. `force` (developer
 * test) skips the "newer" and "already sent" checks, never the format and model
 * checks, and never sends a file that has run out.
 *
 * Each file stands on its own: one that can't be downloaded or sent doesn't keep the others
 * from the watch (offline, a cached LTO still goes when the RTO has run out). The result is
 * then not ok, with the files that were sent and the first failure.
 *
 * Undefined when there is nothing to send or the watch takes nothing CorosLink sends.
 */
export async function pushSatelliteData(link: SatelliteLink, sources: SatelliteSources, options: { force?: boolean; now?: number } = {}): Promise<WatchSyncProgress["satellite"] | undefined> {
  const now = options.now ?? Date.now();
  const assist = await link.readAssistance();
  const model = link.model();
  const planned = satelliteFilesFor(assist, model);
  if (!planned.length) return undefined;
  const nowHour = watchHour(now);
  let files = 0;
  let coveredUntil: number | undefined;
  let failure: string | undefined;
  for (const { spec, watchStartHour } of planned) {
    try {
      const file = await sources.cepFile(spec);
      if (file.startHour + file.hours <= nowHour) continue;
      if (!options.force) {
        const sent = assist?.sent?.[spec.format];
        if (sent !== undefined && sent >= file.startHour) continue;
        if (!cepFileIsNewer(watchStartHour, file, nowHour)) continue;
      }
      await link.sendFile(file);
      files++;
      // The main file says how long the watch is covered (the ephemeris lasts hours; the second ELPO file continues the first).
      if (spec.fileId === 13) coveredUntil = unixMsOfWatchHour(file.startHour + file.hours);
    } catch (error) {
      failure ??= error instanceof Error ? error.message : String(error);
    }
  }
  const covered = coveredUntil !== undefined ? { coveredUntil } : {};
  if (failure !== undefined) return { ok: false, files, ...covered, error: failure };
  return files ? { ok: true, files, ...covered } : undefined;
}
