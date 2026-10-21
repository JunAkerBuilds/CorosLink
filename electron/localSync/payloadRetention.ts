import fs from "node:fs";
import type { ActivityRepository, LocalSyncPayload } from "./activityRepository";
import type { LocalArchive } from "./localArchive";
import { sha256Hex } from "./localArchive";

/**
 * Keeping one copy of a watch file that only grows, and reading only what it
 * gained since the last sync.
 *
 * CorosLink never acknowledges, so the watch serves its activity file (14)
 * and daily-history file (5) from the same starting point on every sync, with
 * new records appended at the end (checked on a PACE 4, V3.2008.0: every
 * stored copy of both files is a byte-for-byte prefix of the next one). Two
 * consequences:
 * - a sync can start from the copy stored last time and request only the
 *   bytes after it, once the watch's first block and the stored copy's last
 *   page are confirmed unchanged. Anything else (the file shrank or was
 *   rewritten, for example after the COROS app synced) falls back to a full
 *   read;
 * - an older stored copy whose bytes are the start of a newer, decoded copy
 *   holds nothing the newer one doesn't, so it is removed. So is one whose
 *   bytes start a newer copy that the same decoder version failed on, as the
 *   older one did: a file the decoder can't read is kept once, not once per
 *   sync. A copy that isn't such a prefix, one still referenced by an
 *   activity, and every other copy a current decoder hasn't decoded, are kept.
 */

/** Page size of the watch's record files; the last page of a stored copy is always re-read. */
const SYNC_PAGE_BYTES = 4096;

/**
 * Where to read next when an earlier copy of the file is stored (`stored`),
 * after the watch sent `block` at `blockOffset` in a file of `total` bytes:
 * "mismatch" when the watch's bytes differ from the stored copy (or the file
 * shrank), so the whole file must be read; otherwise the next offset, which
 * skips to the stored copy's last page when the block ends before it.
 */
export function nextOffsetAfterStoredCopy(stored: Uint8Array, block: Uint8Array, blockOffset: number, total: number): number | "mismatch" {
  if (total < stored.length) return "mismatch";
  const overlapEnd = Math.min(stored.length, blockOffset + block.length);
  if (overlapEnd > blockOffset && !Buffer.from(block.buffer, block.byteOffset, overlapEnd - blockOffset).equals(Buffer.from(stored.buffer, stored.byteOffset + blockOffset, overlapEnd - blockOffset))) {
    return "mismatch";
  }
  const end = blockOffset + block.length;
  const lastPage = stored.length > 0 ? Math.floor((stored.length - 1) / SYNC_PAGE_BYTES) * SYNC_PAGE_BYTES : 0;
  return end < lastPage ? lastPage : end;
}

export interface RetentionDependencies {
  repository: ActivityRepository;
  archive: LocalArchive;
}

async function readVerified(archive: LocalArchive, payload: LocalSyncPayload): Promise<Buffer | undefined> {
  try {
    const bytes = await fs.promises.readFile(archive.resolve(payload.filePath));
    return sha256Hex(bytes) === payload.sha256 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** The stored bytes of a payload, checked against its hash; undefined when missing or damaged. */
export async function readStoredPayload(dependencies: RetentionDependencies, payload: LocalSyncPayload | undefined): Promise<Buffer | undefined> {
  return payload ? readVerified(dependencies.archive, payload) : undefined;
}

/**
 * Removes stored copies of one watch file that a newer, decoded copy fully
 * contains (see above). `isCurrent` says whether a payload's decoder is the
 * current one; such a payload can supersede any other, and a failed one only
 * a copy with the same failure. Never throws.
 */
export async function pruneSupersededPayloads(
  dependencies: RetentionDependencies,
  deviceId: string,
  fileIndex: number,
  isCurrent: (decoder: string | undefined) => boolean
): Promise<{ removed: number; freedBytes: number }> {
  const { repository, archive } = dependencies;
  let removed = 0;
  let freedBytes = 0;
  try {
    const payloads = repository.listPayloads().filter((payload) => payload.deviceId === deviceId && payload.fileIndex === fileIndex);
    const failed = (payload: LocalSyncPayload) => payload.decoder?.startsWith("failed:") === true;
    // Both copies' bytes stay on disk: the removed one is the start of the one kept.
    const supersedes = (keeper: LocalSyncPayload, candidate: LocalSyncPayload) =>
      isCurrent(keeper.decoder) || (failed(keeper) && keeper.decoder === candidate.decoder);
    const keepers = payloads.filter((payload) => isCurrent(payload.decoder) || failed(payload)).sort((a, b) => b.sizeBytes - a.sizeBytes || b.id - a.id);
    if (!keepers.length) return { removed, freedBytes };
    const keeperBytes = new Map<number, Buffer | undefined>();
    const bytesOf = async (payload: LocalSyncPayload) => {
      if (!keeperBytes.has(payload.id)) keeperBytes.set(payload.id, await readVerified(archive, payload));
      return keeperBytes.get(payload.id);
    };
    const gone = new Set<number>();
    for (const candidate of payloads) {
      if (repository.isFileReferencedByActivity(candidate.filePath)) continue;
      const larger = keepers.filter((keeper) => keeper.id !== candidate.id && !gone.has(keeper.id) && keeper.sizeBytes > candidate.sizeBytes && supersedes(keeper, candidate));
      if (!larger.length) continue;
      const bytes = await readVerified(archive, candidate);
      if (!bytes) continue;
      for (const keeper of larger) {
        const newer = await bytesOf(keeper);
        if (!newer || !newer.subarray(0, bytes.length).equals(bytes)) continue;
        repository.removeSupersededPayload(candidate.id, keeper.id);
        gone.add(candidate.id);
        if (!repository.isFileReferenced(candidate.filePath)) await fs.promises.rm(archive.resolve(candidate.filePath), { force: true });
        removed += 1;
        freedBytes += bytes.length;
        break;
      }
    }
  } catch {
    // Pruning only saves space; a failure leaves every copy in place.
  }
  return { removed, freedBytes };
}
