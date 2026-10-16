import { isManagedTunnelName, teardownAllocation, type RelayContext } from "./allocations";
import { CloudflareApiError, CloudflareClient, isNotFound, isRateLimited, type CloudflareTunnel } from "./cloudflare";
import {
  allocationKeyOf,
  listAllocationsByTunnelNames,
  updateAllocation,
  type AllocationWithLinkState,
} from "./db";
import { tunnelNamePrefix, type CleanupMode } from "./env";
import { log } from "./log";

/** Cloudflare must report a tunnel down this long before it is a candidate. */
export const DOWN_GRACE_MS = 5 * 60 * 1000;
/** A tunnel that never connected is usually a pairing in progress: give it an hour. */
export const INACTIVE_GRACE_MS = 60 * 60 * 1000;
export const SWEEP_PAGE_SIZE = 100;
export const SWEEP_LIST_REQUEST_LIMIT = 10;
export const SWEEP_DELETE_LIMIT = 100;
/** Stop starting work this long after the sweep starts, under the 2 minute budget. */
export const SWEEP_DEADLINE_MS = 110_000;
const SLOT_MS = 5 * 60 * 1000;

type CandidateStatus = "down" | "inactive";

export interface SweepResult {
  mode: CleanupMode;
  listRequests: number;
  scanned: number;
  wouldDelete: number;
  attempted: number;
  deleted: number;
  failed: number;
  skippedOrphan: number;
  skippedUnrecorded: number;
  skippedReplaced: number;
  skippedNoRecovery: number;
  skippedBusy: number;
  skippedReconnected: number;
  /** A recovery or link touched the allocation inside the grace period. */
  skippedRecent: number;
  /** Tunnels of revoked or re-keyed links, handed to teardown (recorded or not). */
  unlinked: number;
  truncated: boolean;
  rateLimited: boolean;
  deadlineReached: boolean;
  /** dry-run: the tunnel names that would be deleted (bounded). */
  candidates: string[];
}

function emptyResult(mode: CleanupMode): SweepResult {
  return {
    mode,
    listRequests: 0,
    scanned: 0,
    wouldDelete: 0,
    attempted: 0,
    deleted: 0,
    failed: 0,
    skippedOrphan: 0,
    skippedUnrecorded: 0,
    skippedReplaced: 0,
    skippedNoRecovery: 0,
    skippedBusy: 0,
    skippedReconnected: 0,
    skippedRecent: 0,
    unlinked: 0,
    truncated: false,
    rateLimited: false,
    deadlineReached: false,
    candidates: [],
  };
}

function inactiveSince(tunnel: CloudflareTunnel, status: CandidateStatus): number | null {
  const since = status === "down" ? tunnel.conns_inactive_at : tunnel.created_at;
  if (typeof since !== "string") return null;
  const parsed = Date.parse(since);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A same-stage tunnel Cloudflare reports `status` for since before `cutoff`. */
export function isExpiredTunnel(
  tunnel: CloudflareTunnel,
  status: CandidateStatus,
  stage: string,
  cutoff: number,
): boolean {
  if (typeof tunnel.id !== "string" || typeof tunnel.name !== "string") return false;
  if (tunnel.deleted_at || tunnel.status !== status || !isManagedTunnelName(tunnel.name, stage)) return false;
  const since = inactiveSince(tunnel, status);
  return since !== null && since <= cutoff;
}

/**
 * The later pages to read after page 1, rotated by `slot` so successive sweeps
 * cover a long list instead of rereading its head.
 */
export function rotatedPages(totalCount: number | undefined, slot: number, limit: number): number[] {
  if (limit <= 0) return [];
  if (totalCount === undefined) return Array.from({ length: limit }, (_, index) => index + 2);
  const laterPages = Math.max(0, Math.ceil(totalCount / SWEEP_PAGE_SIZE) - 1);
  if (laterPages === 0) return [];
  const count = Math.min(limit, laterPages);
  const start = slot % laterPages;
  return Array.from({ length: count }, (_, index) => 2 + ((start + index) % laterPages));
}

/**
 * Deletes idle tunnels to stay inside Cloudflare's included tunnel count.
 * Only tunnels whose allocation registered recovery and still records that
 * tunnel id are touched; orphans are counted and left for a manual sweep.
 * Bounded by SWEEP_LIST_REQUEST_LIMIT list calls, SWEEP_DELETE_LIMIT
 * deletions and SWEEP_DEADLINE_MS, and it stops on a Cloudflare 429.
 */
export async function sweepIdleTunnels(ctx: RelayContext, mode: CleanupMode): Promise<SweepResult> {
  const result = emptyResult(mode);
  const tunnelConfig = ctx.config.tunnel;
  if (mode === "off" || !tunnelConfig) return result;
  const cf = new CloudflareClient(tunnelConfig, ctx.deps);
  const stage = ctx.config.stage;
  const startedAt = ctx.deps.now();
  const pastDeadline = () => {
    if (ctx.deps.now() - startedAt >= SWEEP_DEADLINE_MS) {
      result.deadlineReached = true;
      result.truncated = true;
      return true;
    }
    return false;
  };
  const slot = Math.floor(startedAt / SLOT_MS);
  const cutoffs: Record<CandidateStatus, number> = {
    down: startedAt - DOWN_GRACE_MS,
    inactive: startedAt - INACTIVE_GRACE_MS,
  };

  const expired: Array<{ tunnel: CloudflareTunnel; status: CandidateStatus }> = [];
  const perStatusLimit = Math.floor(SWEEP_LIST_REQUEST_LIMIT / 2);
  list: for (const status of ["down", "inactive"] as const) {
    const cutoffIso = new Date(cutoffs[status]).toISOString();
    const listPage = (page: number) => {
      result.listRequests += 1;
      return cf.listTunnels({
        includePrefix: tunnelNamePrefix(stage),
        status,
        existedAt: cutoffIso,
        ...(status === "down" ? { wasInactiveAt: cutoffIso } : {}),
        page,
        perPage: SWEEP_PAGE_SIZE,
      });
    };
    const responses: CloudflareTunnel[][] = [];
    try {
      if (pastDeadline()) break;
      const first = await listPage(1);
      responses.push(first.result);
      const totalCount = first.resultInfo?.total_count;
      const pages = rotatedPages(totalCount, slot, perStatusLimit - 1);
      for (const page of pages) {
        if (pastDeadline()) break list;
        const next = await listPage(page);
        responses.push(next.result);
        if (totalCount === undefined && next.result.length < SWEEP_PAGE_SIZE) break;
      }
      const pageCount = totalCount === undefined ? undefined : Math.ceil(totalCount / SWEEP_PAGE_SIZE);
      if (
        (pageCount !== undefined && pageCount > responses.length) ||
        (pageCount === undefined && responses.at(-1)?.length === SWEEP_PAGE_SIZE)
      ) {
        result.truncated = true;
      }
    } catch (error) {
      if (isRateLimited(error)) {
        result.rateLimited = true;
        result.truncated = true;
        break;
      }
      throw error;
    } finally {
      for (const page of responses) {
        for (const tunnel of page) {
          if (isExpiredTunnel(tunnel, status, stage, cutoffs[status])) expired.push({ tunnel, status });
        }
      }
    }
  }

  const unique = [...new Map(expired.map((entry) => [entry.tunnel.id, entry])).values()];
  // Start each sweep one budget further along, so a block of deletes that keep
  // failing cannot starve the candidates after them.
  const offset = unique.length === 0 ? 0 : (slot * SWEEP_DELETE_LIMIT) % unique.length;
  const rotated = [...unique.slice(offset), ...unique.slice(0, offset)];
  result.scanned = rotated.length;

  const allocations = await listAllocationsByTunnelNames(
    ctx.db,
    rotated.map(({ tunnel }) => tunnel.name),
  );
  const byName = new Map(allocations.map((row) => [row.tunnel_name, row]));

  const candidates: Candidate[] = [];
  const unlinkedSeen = new Set<string>();
  for (const { tunnel, status } of rotated) {
    const row = byName.get(tunnel.name);
    if (!row) {
      // No row to claim: a relink that adopts the tunnel by name could race a delete.
      result.skippedOrphan += 1;
      continue;
    }
    let kind: Candidate["kind"] = "idle";
    if (!row.link_active) {
      // Unlinked or re-keyed: nobody can reach this tunnel any more, recorded
      // or not (a provision cancelled mid-way leaves it unrecorded). Teardown
      // claims the row and deletes everything under its name.
      const allocation = `${row.user_id}\u0000${row.environment_id}\u0000${row.env_key_jkt}`;
      if (unlinkedSeen.has(allocation)) continue;
      unlinkedSeen.add(allocation);
      kind = "unlinked";
    } else {
      if (row.tunnel_id === null) {
        result.skippedUnrecorded += 1;
        continue;
      }
      if (row.tunnel_id !== tunnel.id) {
        result.skippedReplaced += 1;
        continue;
      }
      if (row.recovery_registered_at === null) {
        // This host cannot replace a deleted tunnel by itself.
        result.skippedNoRecovery += 1;
        continue;
      }
      if (row.status !== "ready" && row.status !== "provisioning") {
        result.skippedBusy += 1;
        continue;
      }
      if (row.updated_at > startedAt - DOWN_GRACE_MS) {
        // A recovery or link just vouched for this tunnel; give its connector time to come up.
        result.skippedRecent += 1;
        continue;
      }
    }
    result.wouldDelete += 1;
    if (mode === "dry-run") {
      if (result.candidates.length < SWEEP_DELETE_LIMIT) result.candidates.push(tunnel.name);
      continue;
    }
    if (candidates.length >= SWEEP_DELETE_LIMIT) {
      result.truncated = true;
      break;
    }
    candidates.push({ row, tunnel, status, kind });
  }

  for (const candidate of candidates) {
    if (result.rateLimited || pastDeadline()) break;
    if (candidate.kind === "unlinked") {
      await reapUnlinked(ctx, candidate, result);
    } else {
      await reapOne(ctx, cf, candidate, cutoffs[candidate.status], result);
    }
  }
  return result;
}

interface Candidate {
  row: AllocationWithLinkState;
  tunnel: CloudflareTunnel;
  status: CandidateStatus;
  kind: "idle" | "unlinked";
}

async function reapUnlinked(ctx: RelayContext, candidate: Candidate, result: SweepResult): Promise<void> {
  result.attempted += 1;
  result.unlinked += 1;
  const report = { rateLimited: false };
  const outcome = await teardownAllocation(ctx, allocationKeyOf(candidate.row), report);
  if (outcome === "complete") {
    result.deleted += 1;
    log("info", "reaper_deleted_unlinked_tunnel", { tunnelName: candidate.row.tunnel_name });
  } else if (outcome === "pending") {
    result.failed += 1;
  }
  if (report.rateLimited) {
    result.rateLimited = true;
    result.truncated = true;
  }
}

async function reapOne(
  ctx: RelayContext,
  cf: CloudflareClient,
  candidate: Candidate,
  cutoff: number,
  result: SweepResult,
): Promise<void> {
  const { row, tunnel, status } = candidate;
  const key = allocationKeyOf(row);
  const claimedAt = ctx.deps.now();
  // Claim at the generation we read. A recovery or relink since then bumped
  // it, and the host that came back wins.
  const claimed = await updateAllocation(
    ctx.db,
    key,
    row.generation,
    { status: "reaping", claimed_at: claimedAt },
    claimedAt,
    { tunnelId: tunnel.id, statusIn: ["ready", "provisioning"] },
  );
  if (claimed === null) {
    result.skippedReconnected += 1;
    return;
  }
  const release = () =>
    updateAllocation(ctx.db, key, claimed, { status: row.status, claimed_at: null }, ctx.deps.now());
  let remoteDeleted = false;

  try {
    let current: CloudflareTunnel | null = null;
    try {
      current = await cf.getTunnel(tunnel.id);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (current && !current.deleted_at) {
      if (!isExpiredTunnel(current, status, ctx.config.stage, cutoff)) {
        await release();
        result.skippedReconnected += 1;
        return;
      }
      result.attempted += 1;
      try {
        await cf.deleteTunnel(tunnel.id);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    remoteDeleted = true;
    // The DNS record stays: recovery points it at the replacement tunnel, so
    // the hostname phones know keeps working.
    const finished = await updateAllocation(
      ctx.db,
      key,
      claimed,
      {
        status: "released",
        tunnel_id: null,
        configured_tunnel_id: null,
        claimed_at: null,
        tunnel_released_at: ctx.deps.now(),
      },
      ctx.deps.now(),
    );
    if (finished === null) {
      log("warn", "reaper_claim_lost_after_delete", { tunnelName: row.tunnel_name });
    }
    result.deleted += 1;
    log("info", "reaper_deleted_tunnel", { tunnelName: row.tunnel_name, status });
  } catch (error) {
    result.failed += 1;
    // Once the tunnel is gone, never point the row back at it: leave the claim
    // to age out, and the next recovery re-provisions.
    if (!remoteDeleted) await release();
    if (isRateLimited(error)) {
      result.rateLimited = true;
      result.truncated = true;
    }
    log("warn", "reaper_delete_failed", {
      tunnelName: row.tunnel_name,
      reason: error instanceof CloudflareApiError ? `${error.operation}:${error.status}` : "unknown",
    });
  }
}
