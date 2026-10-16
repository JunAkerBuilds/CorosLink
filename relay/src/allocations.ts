import {
  CloudflareApiError,
  CloudflareClient,
  isNotFound,
  type CloudflareTunnel,
} from "./cloudflare";
import { sha256Hex } from "./crypto";
import {
  getAllocation,
  getLink,
  reserveAllocation,
  updateAllocation,
  type AllocationKey,
  type AllocationRow,
  type AllocationStatus,
} from "./db";
import { tunnelNamePrefix, type Deps, type RelayConfig, type TunnelConfig } from "./env";
import { RelayError } from "./http";
import { log } from "./log";
import { RECOVERY_MIN_INTERVAL_SECONDS } from "./protocol";

/** A cleanup or unlink claim younger than this blocks provisioning; an older one is abandoned. */
export const CLAIM_TTL_MS = 120_000;
const BUSY_RETRY_SECONDS = 15;

export interface RelayContext {
  config: RelayConfig;
  deps: Deps;
  db: D1Database;
  waitUntil: (promise: Promise<unknown>) => void;
}

export function requireTunnelConfig(config: RelayConfig): TunnelConfig {
  if (!config.tunnel) {
    throw new RelayError("not_configured", "Cloudflare Tunnel provisioning is not configured on this relay.");
  }
  return config.tunnel;
}

export function cloudflare(ctx: RelayContext): CloudflareClient {
  return new CloudflareClient(requireTunnelConfig(ctx.config), ctx.deps);
}

const STABLE_ID = /^[a-f0-9]{16}$/u;

/**
 * The hostname and tunnel name of a user/environment pair and its environment
 * key. Derived from a hash so they are stable for life and reveal no id. The
 * key is part of it so a relink with another key gets a new address instead of
 * taking over the one phones already use. The hostname is first-level under
 * the tunnel zone so the zone's free certificate covers it.
 */
export async function allocationNames(
  config: RelayConfig,
  zoneName: string,
  key: AllocationKey,
): Promise<{ hostname: string; tunnelName: string }> {
  const stableId = (
    await sha256Hex(`coroslink-relay:v1:${config.stage}:${key.userId}:${key.environmentId}:${key.kid}`)
  ).slice(0, 16);
  return { hostname: `${stableId}.${zoneName}`, tunnelName: `${tunnelNamePrefix(config.stage)}${stableId}` };
}

export function isManagedHostname(hostname: string, zoneName: string): boolean {
  const suffix = `.${zoneName}`;
  return hostname.endsWith(suffix) && STABLE_ID.test(hostname.slice(0, -suffix.length));
}

export function isManagedTunnelName(name: string, stage: string): boolean {
  const prefix = tunnelNamePrefix(stage);
  return name.startsWith(prefix) && STABLE_ID.test(name.slice(prefix.length));
}

function claimLost(): never {
  throw new RelayError("allocation_conflict", "Another change to this computer's tunnel happened at the same time. Retry.");
}

export function cloudflareFailure(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  if (error instanceof CloudflareApiError) {
    log("warn", "cloudflare_api_error", {
      operation: error.operation,
      status: error.status,
      codes: error.errors.map((entry) => String(entry.code ?? "")),
    });
    if (error.rateLimited) {
      return new RelayError("upstream_rate_limited", "Cloudflare is rate limiting the relay. Retry shortly.", {
        retryAfterSeconds: error.retryAfterSeconds ?? 30,
      });
    }
    return new RelayError("upstream_error", `Cloudflare ${error.operation} failed (${error.status}).`);
  }
  log("error", "unexpected_error", { reason: error instanceof Error ? error.message : "unknown" });
  return new RelayError("internal_error", "The relay hit an unexpected error.");
}

function isBusy(row: AllocationRow, now: number): boolean {
  return (
    (row.status === "reaping" || row.status === "deprovisioning") &&
    row.claimed_at !== null &&
    now - row.claimed_at < CLAIM_TTL_MS
  );
}

/** Finds a tunnel an earlier attempt created but never recorded, or creates it. */
async function adoptOrCreateTunnel(cf: CloudflareClient, name: string): Promise<CloudflareTunnel> {
  const findByName = async () =>
    (await cf.listTunnels({ name })).result.find((tunnel) => tunnel.name === name && !tunnel.deleted_at) ?? null;
  const existing = await findByName();
  if (existing) return existing;
  let created: CloudflareTunnel;
  try {
    created = await cf.createTunnel(name);
  } catch (error) {
    // A concurrent attempt may have created it between our list and create.
    if (error instanceof CloudflareApiError && !error.rateLimited) {
      const raced = await findByName();
      if (raced) return raced;
    }
    throw error;
  }
  if (typeof created?.id !== "string" || created.name !== name) {
    throw new CloudflareApiError("create-tunnel", 502, [{ message: "unexpected tunnel response" }]);
  }
  return created;
}

async function ensureCname(
  cf: CloudflareClient,
  hostname: string,
  tunnelId: string,
  recordedId: string | null,
): Promise<string> {
  const content = `${tunnelId}.cfargotunnel.com`;
  if (recordedId) {
    try {
      await cf.updateCnameRecord(recordedId, hostname, tunnelId);
      return recordedId;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  const adopt = async () => {
    const [record] = await cf.listCnameRecords(hostname);
    if (!record) return null;
    if (record.content !== content || record.proxied !== true) {
      await cf.updateCnameRecord(record.id, hostname, tunnelId);
    }
    return record.id;
  };
  const existing = await adopt();
  if (existing) return existing;
  try {
    return (await cf.createCnameRecord(hostname, tunnelId)).id;
  } catch (error) {
    if (error instanceof CloudflareApiError && !error.rateLimited) {
      const raced = await adopt();
      if (raced) return raced;
    }
    throw error;
  }
}

export interface EnsureEndpointResult {
  allocation: AllocationRow;
  tunnelId: string;
  /** The tunnel id changed (created, or replaced a missing one). */
  tunnelChanged: boolean;
  reconfigured: boolean;
}

/**
 * Brings the allocation to `ready` for `port`: tunnel, ingress, DNS. Each
 * external step is checkpointed with a generation-guarded write, so a retry
 * after a partial failure resumes instead of starting over, and a concurrent
 * writer makes this attempt stop with allocation_conflict.
 */
export async function ensureEndpoint(
  ctx: RelayContext,
  key: AllocationKey,
  input: { port: number; mode: "link" | "recovery" },
): Promise<EnsureEndpointResult> {
  const tunnelConfig = requireTunnelConfig(ctx.config);
  const cf = cloudflare(ctx);
  const now = ctx.deps.now();
  const names = await allocationNames(ctx.config, tunnelConfig.zoneName, key);
  const reserved = await reserveAllocation(ctx.db, { ...key, ...names, now });

  if (isBusy(reserved, now)) {
    throw new RelayError("allocation_busy", "The relay is cleaning up this computer's tunnel. Retry shortly.", {
      retryAfterSeconds: BUSY_RETRY_SECONDS,
    });
  }
  if (
    input.mode === "recovery" &&
    reserved.last_recovery_at !== null &&
    now - reserved.last_recovery_at < RECOVERY_MIN_INTERVAL_SECONDS * 1000
  ) {
    throw new RelayError("rate_limited", "Recovery runs at most once every two minutes.", {
      retryAfterSeconds: (reserved.last_recovery_at + RECOVERY_MIN_INTERVAL_SECONDS * 1000 - now) / 1000,
    });
  }

  const state: AllocationRow = { ...reserved };
  const write = async (fields: Partial<AllocationRow>) => {
    const next = await updateAllocation(ctx.db, key, state.generation, fields, ctx.deps.now());
    if (next === null) claimLost();
    Object.assign(state, fields, { generation: next });
  };

  // Taking the row bumps the generation, which invalidates any stale claim
  // a crashed cleanup left behind. A recovery call also registers recovery.
  await write({
    status: state.status === "ready" ? "ready" : "provisioning",
    claimed_at: null,
    ...(input.mode === "recovery" ? { recovery_registered_at: state.recovery_registered_at ?? now } : {}),
  });

  try {
    let tunnel: CloudflareTunnel | null = null;
    if (state.tunnel_id) {
      try {
        const recorded = await cf.getTunnel(state.tunnel_id);
        if (!recorded.deleted_at) tunnel = recorded;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    const previousTunnelId = state.tunnel_id;
    if (!tunnel) {
      tunnel = await adoptOrCreateTunnel(cf, state.tunnel_name);
      await write({ tunnel_id: tunnel.id, status: "provisioning", tunnel_released_at: null });
    }

    let reconfigured = false;
    if (state.configured_tunnel_id !== tunnel.id || state.origin_port !== input.port) {
      await cf.putTunnelConfiguration(tunnel.id, state.hostname, input.port);
      await write({ configured_tunnel_id: tunnel.id, origin_port: input.port });
      reconfigured = true;
    }

    if (state.dns_record_id === null || state.dns_tunnel_id !== tunnel.id) {
      const recordId = await ensureCname(cf, state.hostname, tunnel.id, state.dns_record_id);
      await write({ dns_record_id: recordId, dns_tunnel_id: tunnel.id });
    }

    // The recovery window starts only once a recovery succeeded, so a
    // Cloudflare failure part way can be retried after its Retry-After.
    if (state.status !== "ready" || input.mode === "recovery") {
      await write({
        status: "ready",
        ready_at: state.ready_at ?? ctx.deps.now(),
        ...(input.mode === "recovery" ? { last_recovery_at: now } : {}),
      });
    }

    return { allocation: state, tunnelId: tunnel.id, tunnelChanged: tunnel.id !== previousTunnelId, reconfigured };
  } catch (error) {
    throw cloudflareFailure(error);
  }
}

export async function connectorToken(ctx: RelayContext, tunnelId: string): Promise<string> {
  try {
    return await cloudflare(ctx).getTunnelToken(tunnelId);
  } catch (error) {
    throw cloudflareFailure(error);
  }
}

export type TeardownOutcome = "complete" | "pending" | "skipped";

/**
 * Deletes the DNS record and tunnel of an allocation whose link was revoked
 * (or re-keyed). The caller must have committed the revocation first. The
 * allocation is claimed at its current generation and every step re-checks
 * the claim, so a relink that took the row over wins. Besides the recorded
 * ids it deletes any live tunnel with the allocation's name and any CNAME at
 * its hostname, which catches a resource a cancelled or racing provision
 * created but never recorded. The hostname stays reserved.
 */
export async function teardownAllocation(
  ctx: RelayContext,
  key: AllocationKey,
  report: { rateLimited: boolean } = { rateLimited: false },
): Promise<TeardownOutcome> {
  if (!ctx.config.tunnel) return "pending";
  const cf = cloudflare(ctx);
  const now = ctx.deps.now();
  const row = await getAllocation(ctx.db, key);
  if (!row) return "complete";
  if (isBusy(row, now)) return "pending";

  // Restoring a claim never leaves a cleanup status behind without its claim.
  const previousStatus: AllocationStatus =
    row.status === "reaping" || row.status === "deprovisioning" ? "provisioning" : row.status;
  let generation = await updateAllocation(ctx.db, key, row.generation, { status: "deprovisioning", claimed_at: now }, now);
  if (generation === null) return "pending";

  const link = await getLink(ctx.db, key);
  if (link && link.revoked_at === null && link.env_key_jkt === key.kid) {
    // Relinked between the revocation and our claim: the allocation is theirs.
    await updateAllocation(ctx.db, key, generation, { status: previousStatus, claimed_at: null }, ctx.deps.now());
    return "skipped";
  }

  const held = async () => {
    const current = await getAllocation(ctx.db, key);
    return current?.generation === generation;
  };

  try {
    if (row.dns_record_id) {
      try {
        await cf.deleteDnsRecord(row.dns_record_id);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      generation = await updateAllocation(ctx.db, key, generation, { dns_record_id: null, dns_tunnel_id: null }, ctx.deps.now());
      if (generation === null) return "pending";
    }
    const named = (await cf.listTunnels({ name: row.tunnel_name })).result.filter(
      (tunnel) => tunnel.name === row.tunnel_name && !tunnel.deleted_at,
    );
    const tunnelIds = new Set([...(row.tunnel_id ? [row.tunnel_id] : []), ...named.map((tunnel) => tunnel.id)]);
    for (const tunnelId of tunnelIds) {
      if (!(await held())) return "pending";
      // Unlink disconnects a running connector; Cloudflare refuses to delete a tunnel with live connections.
      try {
        await cf.deleteTunnelConnections(tunnelId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      try {
        await cf.deleteTunnel(tunnelId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    for (const record of await cf.listCnameRecords(row.hostname)) {
      if (!(await held())) return "pending";
      try {
        await cf.deleteDnsRecord(record.id);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    const released = await updateAllocation(
      ctx.db,
      key,
      generation,
      {
        status: "released",
        tunnel_id: null,
        configured_tunnel_id: null,
        origin_port: null,
        claimed_at: null,
        tunnel_released_at: ctx.deps.now(),
      },
      ctx.deps.now(),
    );
    return released === null ? "pending" : "complete";
  } catch (error) {
    // The claim stays; it ages out after CLAIM_TTL_MS and the cron retries.
    if (error instanceof CloudflareApiError && error.rateLimited) report.rateLimited = true;
    log("warn", "teardown_failed", {
      environmentId: key.environmentId,
      reason: error instanceof CloudflareApiError ? `${error.operation}:${error.status}` : "unknown",
    });
    return "pending";
  }
}
