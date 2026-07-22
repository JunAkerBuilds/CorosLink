import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const COMBINED_DOWNLOAD_CACHE_VERSION = 1;
export const COMBINED_DOWNLOAD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Includes both the service-scoped playlist id and the resolved download
 * inputs. Retrying the same playlist reuses completed tracks, while edits to
 * the playlist automatically move the operation to a fresh cache directory.
 */
export function createCombinedDownloadCacheKey(
  id: string,
  inputs: string[]
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: COMBINED_DOWNLOAD_CACHE_VERSION,
        id,
        inputs
      })
    )
    .digest("hex");
}

export function combinedTrackCompletionMarker(filePath: string): string {
  return `${filePath}.complete`;
}

/**
 * The marker is written only after yt-dlp exits and the MP3 is detected. This
 * prevents a non-empty but partially written file left by a crash from being
 * mistaken for a completed track on the next launch.
 */
export async function markCombinedTrackReusable(
  filePath: string
): Promise<void> {
  await fs.promises.writeFile(
    combinedTrackCompletionMarker(filePath),
    "complete\n",
    "utf8"
  );
}

export async function isReusableCombinedTrack(
  filePath: string
): Promise<boolean> {
  try {
    const [stat] = await Promise.all([
      fs.promises.stat(filePath),
      fs.promises.access(combinedTrackCompletionMarker(filePath))
    ]);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function touchCombinedDownloadCache(
  directory: string,
  now = new Date()
): Promise<void> {
  await fs.promises.utimes(directory, now, now).catch(() => {});
}

/** Removes abandoned caches without touching combines active in this process. */
export async function pruneCombinedDownloadCache(
  rootDirectory: string,
  activeKeys: ReadonlySet<string>,
  now = Date.now(),
  maxAgeMs = COMBINED_DOWNLOAD_CACHE_MAX_AGE_MS
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rootDirectory, {
      withFileTypes: true
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || activeKeys.has(entry.name)) {
        return;
      }

      const directory = path.join(rootDirectory, entry.name);
      try {
        const stat = await fs.promises.stat(directory);
        if (now - stat.mtimeMs <= maxAgeMs) {
          return;
        }
        await fs.promises.rm(directory, { recursive: true, force: true });
      } catch {
        // Cache cleanup is best-effort and must never block a download.
      }
    })
  );
}
