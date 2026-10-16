import { CLAIM_TTL_MS, teardownAllocation, type RelayContext } from "./allocations";
import { purgeExpiredNonces } from "./auth/replay";
import { allocationKeyOf, listPendingTeardowns, pruneTunnelStatusCache } from "./db";
import { defaultDeps, loadConfig, type Deps, type Env } from "./env";
import { errorResponse, RelayError } from "./http";
import { log } from "./log";
import { sweepIdleTunnels, type SweepResult } from "./reaper";
import {
  handleActivity,
  handleConnect,
  handleHealth,
  handleJwks,
  handleLink,
  handleListEnvironments,
  handleRecovery,
  handleRegisterDevice,
  handleUnlink,
  handleUnregisterDevice,
} from "./routes";

export type { Env } from "./env";

type Handler = (request: Request, ctx: RelayContext, params: string[]) => Promise<Response>;

const ROUTES: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: "GET", pattern: /^\/health$/u, handler: (_request, ctx) => handleHealth(ctx) },
  { method: "GET", pattern: /^\/\.well-known\/jwks\.json$/u, handler: (_request, ctx) => handleJwks(ctx) },
  { method: "POST", pattern: /^\/v1\/environments\/link$/u, handler: handleLink },
  { method: "POST", pattern: /^\/v1\/environments\/recovery$/u, handler: handleRecovery },
  { method: "POST", pattern: /^\/v1\/environments\/unlink$/u, handler: handleUnlink },
  { method: "GET", pattern: /^\/v1\/environments$/u, handler: handleListEnvironments },
  {
    method: "POST",
    pattern: /^\/v1\/environments\/([^/]+)\/connect$/u,
    handler: (request, ctx, params) => handleConnect(request, ctx, params[0]!),
  },
  { method: "POST", pattern: /^\/v1\/devices$/u, handler: handleRegisterDevice },
  { method: "DELETE", pattern: /^\/v1\/devices$/u, handler: handleUnregisterDevice },
  { method: "POST", pattern: /^\/v1\/activity$/u, handler: handleActivity },
];

export async function handleRequest(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
  deps: Deps = defaultDeps(),
): Promise<Response> {
  const url = new URL(request.url);
  const ctx: RelayContext = {
    config: loadConfig(env),
    deps,
    db: env.DB,
    waitUntil: (promise) => executionContext.waitUntil(promise),
  };
  try {
    let pathMatched = false;
    for (const route of ROUTES) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;
      return await route.handler(request, ctx, match.slice(1).map((part) => decodeURIComponent(part)));
    }
    throw pathMatched
      ? new RelayError("method_not_allowed", "Method not allowed.")
      : new RelayError("not_found", "Not found.");
  } catch (error) {
    if (error instanceof RelayError) {
      return errorResponse(error);
    }
    log("error", "unhandled_error", {
      path: url.pathname,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(new RelayError("internal_error", "The relay hit an unexpected error."));
  }
}

export interface MaintenanceResult {
  noncesPurged: number;
  teardownsAttempted: number;
  teardownsCompleted: number;
  sweep: SweepResult;
}

const TEARDOWN_RETRY_LIMIT = 10;

/** The 5-minute cron: purge replay guards, retry failed unlink teardowns, reap idle tunnels. */
export async function runMaintenance(env: Env, deps: Deps = defaultDeps()): Promise<MaintenanceResult> {
  const ctx: RelayContext = {
    config: loadConfig(env),
    deps,
    db: env.DB,
    waitUntil: () => undefined,
  };
  const now = deps.now();
  const noncesPurged = await purgeExpiredNonces(env.DB, now);
  await pruneTunnelStatusCache(env.DB, now - 24 * 60 * 60 * 1000);

  let teardownsAttempted = 0;
  let teardownsCompleted = 0;
  if (ctx.config.tunnel) {
    for (const row of await listPendingTeardowns(env.DB, now - CLAIM_TTL_MS, TEARDOWN_RETRY_LIMIT)) {
      teardownsAttempted += 1;
      const outcome = await teardownAllocation(ctx, allocationKeyOf(row));
      if (outcome === "complete") teardownsCompleted += 1;
    }
  }

  const sweep = await sweepIdleTunnels(ctx, ctx.config.cleanupMode);
  const { candidates, ...counters } = sweep;
  log("info", "maintenance", {
    noncesPurged,
    teardownsAttempted,
    teardownsCompleted,
    ...counters,
    ...(sweep.mode === "dry-run" ? { candidates } : {}),
  });
  return { noncesPurged, teardownsAttempted, teardownsCompleted, sweep };
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runMaintenance(env).catch((error: unknown) => {
        log("error", "maintenance_failed", { reason: error instanceof Error ? error.message : "unknown" });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
