import fs from "node:fs";
import path from "node:path";
import { corosSportName } from "../corosSportTypes";
import { parseFitActivity } from "../fitActivity";
import type { ActivityRepository } from "./activityRepository";
import type { LocalArchive } from "./localArchive";
import { MAX_ARCHIVE_FILE_BYTES, sha256Hex } from "./localArchive";
import { fitHeadline } from "./localActivityDetail";
import type { LocalActivityProvenance, LocalImportResult } from "./localDataTypes";

/**
 * Imports FIT files from disk into the local archive. Nothing is uploaded and
 * nothing is looked up online: the file is validated by decoding it, stored
 * content-addressed, and listed from SQLite.
 */

const MAX_FILES_PER_IMPORT = 5000;
const MAX_FOLDER_DEPTH = 6;
/** activityBackupService names files `YYYY-MM-DD_<name>_<cloudActivityId>.fit`. */
const CLOUD_BACKUP_NAME = /^\d{4}-\d{2}-\d{2}_(.+)_(\d{6,})$/;

export interface FitImportDependencies {
  repository: ActivityRepository;
  archive: LocalArchive;
  /** Optional: also index the summary for analytics (fit_index). Failures are non-fatal. */
  indexSummary?: (absolutePath: string, meta: { activityId: string; sportType: number; sportName?: string; name?: string; startTime?: number }) => Promise<unknown>;
}

/** Expands chosen files and folders into a bounded list of .fit paths. */
async function collectFitFiles(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  const visit = async (target: string, depth: number): Promise<void> => {
    if (found.length >= MAX_FILES_PER_IMPORT) return;
    let stat: fs.Stats;
    try { stat = await fs.promises.lstat(target); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (path.extname(target).toLowerCase() === ".fit") found.push(target);
      return;
    }
    if (!stat.isDirectory() || depth > MAX_FOLDER_DEPTH) return;
    const entries = await fs.promises.readdir(target);
    for (const entry of entries.sort()) {
      if (entry.startsWith(".")) continue;
      await visit(path.join(target, entry), depth + 1);
    }
  };
  for (const target of paths) await visit(target, 0);
  return found;
}

function describeName(filePath: string): { name?: string; provenance: LocalActivityProvenance } {
  const base = path.basename(filePath, path.extname(filePath));
  const cloudBackup = CLOUD_BACKUP_NAME.exec(base);
  if (cloudBackup) return { name: cloudBackup[1]!.replace(/_/g, " ").trim() || undefined, provenance: "cloud-export" };
  return { name: base.slice(0, 120) || undefined, provenance: "file" };
}

async function importFitFile(dependencies: FitImportDependencies, filePath: string): Promise<{ inserted: boolean; activityId: string }> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error("Not a file.");
  if (stat.size > MAX_ARCHIVE_FILE_BYTES) throw new Error("The file is too large for a FIT activity.");
  const bytes = new Uint8Array(await fs.promises.readFile(filePath));
  // Decoding validates the header, CRC and records; a non-activity FIT has no records.
  const activity = parseFitActivity(bytes);
  if (!activity.session && activity.records.length === 0) throw new Error("The FIT file has no activity session or records.");
  const sha256 = sha256Hex(bytes);
  const activityId = `local-${sha256.slice(0, 24)}`;
  const existing = dependencies.repository.getActivity(activityId);
  if (existing) return { inserted: false, activityId };

  const stored = await dependencies.archive.storeContent("fit", bytes, "fit");
  const headline = fitHeadline(activity);
  const { name, provenance } = describeName(filePath);
  const sportName = corosSportName(headline.sportType);
  const result = dependencies.repository.insertActivity({
    activityId,
    source: "fit-import",
    provenance,
    filePath: stored.relativePath,
    format: "fit",
    sha256,
    sizeBytes: stored.sizeBytes,
    verification: "verified",
    sportType: headline.sportType,
    sportName,
    name: name ?? sportName,
    startTime: headline.startTime,
    endTime: headline.endTime,
    duration: headline.duration,
    movingTime: headline.movingTime,
    distance: headline.distance,
    avgHr: headline.avgHr,
    maxHr: headline.maxHr,
    calories: headline.calories,
    elevationGain: headline.elevationGain,
    originalName: path.basename(filePath).slice(0, 255)
  });
  if (result.inserted && dependencies.indexSummary) {
    await dependencies.indexSummary(dependencies.archive.resolve(stored.relativePath), {
      activityId, sportType: headline.sportType, sportName, name: name ?? sportName, startTime: headline.startTime
    }).catch(() => undefined);
  }
  return result;
}

export async function importFitFiles(dependencies: FitImportDependencies, paths: string[]): Promise<LocalImportResult> {
  const files = await collectFitFiles(paths);
  const result: LocalImportResult = { imported: 0, duplicates: 0, failed: [], activityIds: [] };
  for (const file of files) {
    try {
      const outcome = await importFitFile(dependencies, file);
      if (outcome.inserted) {
        result.imported += 1;
        result.activityIds.push(outcome.activityId);
      } else {
        result.duplicates += 1;
      }
    } catch (error) {
      result.failed.push({ name: path.basename(file), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
