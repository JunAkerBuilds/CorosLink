import {
  connectorToken,
  ensureEndpoint,
  requireTunnelConfig,
  teardownAllocation,
  cloudflare,
  type RelayContext,
} from "./allocations";
import { sendCoachAlert } from "./apns";
import { verifyDpopProof } from "./auth/dpop";
import { hasEnvironmentSignature, verifyEnvironmentRequest } from "./auth/environmentSignatures";
import { verifyUserToken } from "./auth/userTokens";
import { brokerConnect } from "./connect";
import { jwkThumbprint, parseEnvironmentPublicJwk } from "./crypto";
import {
  activateLink,
  allocationKeyOf,
  getActiveLink,
  getActiveLinkByKey,
  getAllocation,
  getCachedTunnelStatus,
  listActiveLinks,
  listAllocationsForLink,
  listPushDevices,
  putCachedTunnelStatus,
  registerPushDevice,
  revokeLink,
  unregisterPushDevice,
  type AllocationKey,
  type LinkKey,
  type AllocationRow,
  type LinkRow,
} from "./db";
import {
  asObject,
  json,
  readJsonBody,
  RelayError,
  requireOneOf,
  requirePort,
  requireString,
} from "./http";
import { log } from "./log";
import {
  ACTIVITY_EVENTS,
  ENVIRONMENT_ID_PATTERN,
  ENVIRONMENT_PLATFORMS,
  httpBaseUrlForHostname,
  MAX_LINKED_ENVIRONMENTS_PER_USER,
  SESSION_ID_PATTERN,
  WEBSITE_CLIENT_IDS,
  type ActivityResponse,
  type CloudflareTunnelStatus,
  type EnvironmentPublicJwk,
  type EnvironmentSummary,
  type LinkResponse,
  type ListEnvironmentsResponse,
  type RecoveryResponse,
  type UnlinkResponse,
} from "./protocol";
import { relayJwks } from "./relayKey";

const ANY_CLIENT = [WEBSITE_CLIENT_IDS.ios, WEBSITE_CLIENT_IDS.desktop] as const;
const TUNNEL_STATUS_TTL_MS = 30_000;
const LABEL_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;

/** The allocation of a link: its user, environment and current key. */
function linkedKey(link: LinkRow): AllocationKey {
  return { userId: link.user_id, environmentId: link.environment_id, kid: link.env_key_jkt };
}

/** Resolves an environment-signed call to the active link holding that key. */
async function linkForSignature(ctx: RelayContext, environmentId: string, kid: string) {
  const link = await getActiveLinkByKey(ctx.db, environmentId, kid);
  return link ? { jwk: JSON.parse(link.env_public_jwk) as EnvironmentPublicJwk, context: link } : null;
}

// --- POST /v1/environments/link ---------------------------------------------------

export async function handleLink(request: Request, ctx: RelayContext): Promise<Response> {
  requireTunnelConfig(ctx.config);
  const user = await verifyUserToken(request, ctx.config, ctx.deps, [WEBSITE_CLIENT_IDS.desktop]);
  const signed = await verifyEnvironmentRequest(request, {
    config: ctx.config,
    deps: ctx.deps,
    db: ctx.db,
    op: "environment.link",
    // At link time the key comes from the body; the signature proves the desktop holds it.
    resolveKey: async (_environmentId, kid, body) => {
      const jwk = parseEnvironmentPublicJwk(body.publicJwk);
      if ((await jwkThumbprint(jwk)) !== kid) {
        throw new RelayError("invalid_signature", "The signature kid is not the thumbprint of publicJwk.");
      }
      return { jwk, context: jwk };
    },
  });
  const label = requireString(signed.body, "label", { max: 64, pattern: LABEL_PATTERN }).trim();
  const platform = requireOneOf(signed.body, "platform", ENVIRONMENT_PLATFORMS);
  const port = requirePort(signed.body);
  const key: AllocationKey = { userId: user.userId, environmentId: signed.environmentId, kid: signed.kid };

  // An active link keeps its key. Re-keying would let anyone holding the
  // user's desktop token slip their own key behind a computer the phones
  // already trust; a new key needs an explicit unlink, and then it gets a new
  // hostname of its own.
  const current = await getActiveLink(ctx.db, key);
  if (current && current.env_key_jkt !== key.kid) {
    throw new RelayError(
      "environment_key_mismatch",
      "This computer is linked with a different key. Unlink it first, then link again.",
    );
  }

  const others = (await listActiveLinks(ctx.db, user.userId)).filter(
    (link) => link.environment_id !== key.environmentId,
  );
  if (others.length >= MAX_LINKED_ENVIRONMENTS_PER_USER) {
    throw new RelayError(
      "link_limit_reached",
      `An account can link up to ${MAX_LINKED_ENVIRONMENTS_PER_USER} computers. Unlink one first.`,
    );
  }

  const superseded = await activateLink(ctx.db, {
    ...key,
    publicJwk: JSON.stringify(signed.context),
    kid: signed.kid,
    label,
    platform,
    now: ctx.deps.now(),
  });
  for (const previous of superseded) {
    // The desktop switched accounts; release the old account's tunnel in the background.
    ctx.waitUntil(teardownAllocation(ctx, { ...previous, kid: key.kid }));
  }

  const ensured = await ensureEndpoint(ctx, key, { port, mode: "link" });
  const token = await connectorToken(ctx, ensured.tunnelId);
  log("info", "environment_linked", {
    environmentId: key.environmentId,
    tunnelChanged: ensured.tunnelChanged,
    superseded: superseded.length,
  });
  const body: LinkResponse = {
    environmentId: key.environmentId,
    userId: key.userId,
    hostname: ensured.allocation.hostname,
    httpBaseUrl: httpBaseUrlForHostname(ensured.allocation.hostname),
    tunnelId: ensured.tunnelId,
    connectorToken: token,
    generation: ensured.allocation.generation,
    keyThumbprint: key.kid,
  };
  return json(body);
}

// --- POST /v1/environments/recovery ----------------------------------------------

export async function handleRecovery(request: Request, ctx: RelayContext): Promise<Response> {
  requireTunnelConfig(ctx.config);
  const signed = await verifyEnvironmentRequest(request, {
    config: ctx.config,
    deps: ctx.deps,
    db: ctx.db,
    op: "environment.recovery",
    resolveKey: (environmentId, kid) => linkForSignature(ctx, environmentId, kid),
  });
  const port = requirePort(signed.body);
  const reported = signed.body.tunnelId;
  if (reported !== null && reported !== undefined && typeof reported !== "string") {
    throw new RelayError("invalid_request", "tunnelId must be a string or null.");
  }
  const key = linkedKey(signed.context);
  const ensured = await ensureEndpoint(ctx, key, { port, mode: "recovery" });
  const needsToken = ensured.tunnelId !== reported;
  const action: RecoveryResponse["action"] = ensured.tunnelChanged
    ? "reprovisioned"
    : ensured.reconfigured
      ? "reconfigured"
      : "unchanged";
  log("info", "environment_recovery", { environmentId: key.environmentId, action, tokenIssued: needsToken });
  const body: RecoveryResponse = {
    environmentId: key.environmentId,
    hostname: ensured.allocation.hostname,
    httpBaseUrl: httpBaseUrlForHostname(ensured.allocation.hostname),
    tunnelId: ensured.tunnelId,
    generation: ensured.allocation.generation,
    action,
    ...(needsToken ? { connectorToken: await connectorToken(ctx, ensured.tunnelId) } : {}),
  };
  return json(body);
}

// --- POST /v1/environments/unlink -------------------------------------------------

export async function handleUnlink(request: Request, ctx: RelayContext): Promise<Response> {
  let key: LinkKey;
  if (hasEnvironmentSignature(request) && !request.headers.has("authorization")) {
    const signed = await verifyEnvironmentRequest(request, {
      config: ctx.config,
      deps: ctx.deps,
      db: ctx.db,
      op: "environment.unlink",
      resolveKey: (environmentId, kid) => linkForSignature(ctx, environmentId, kid),
    });
    key = linkedKey(signed.context);
  } else {
    const user = await verifyUserToken(request, ctx.config, ctx.deps, ANY_CLIENT);
    const body = asObject((await readJsonBody(request)).value);
    const environmentId = requireString(body, "environmentId", { pattern: ENVIRONMENT_ID_PATTERN, max: 64 });
    key = { userId: user.userId, environmentId };
  }

  // Revocation commits before any teardown: if Cloudflare or the database
  // fails below, the link is already unusable, never half-alive.
  const revoked = await revokeLink(ctx.db, key, ctx.deps.now());
  const allocations = await listAllocationsForLink(ctx.db, key);
  if (!revoked && allocations.length === 0) {
    throw new RelayError("environment_not_linked", "This computer is not linked to your account.");
  }
  // Every key this pair was ever linked with, not only the current one.
  let outcome: "complete" | "pending" = "complete";
  for (const allocation of allocations) {
    if ((await teardownAllocation(ctx, allocationKeyOf(allocation))) === "pending") outcome = "pending";
  }
  log("info", "environment_unlinked", { environmentId: key.environmentId, teardown: outcome });
  const body: UnlinkResponse = {
    environmentId: key.environmentId,
    unlinked: true,
    teardown: outcome,
  };
  return json(body);
}

// --- GET /v1/environments -------------------------------------------------------------

async function tunnelStatus(ctx: RelayContext, tunnelId: string): Promise<CloudflareTunnelStatus | null> {
  const now = ctx.deps.now();
  const cached = await getCachedTunnelStatus(ctx.db, tunnelId);
  if (cached && now - cached.checked_at < TUNNEL_STATUS_TTL_MS) {
    return cached.status as CloudflareTunnelStatus;
  }
  try {
    const tunnel = await cloudflare(ctx).getTunnel(tunnelId);
    const status: CloudflareTunnelStatus = tunnel.deleted_at ? "down" : (tunnel.status ?? "inactive");
    await putCachedTunnelStatus(ctx.db, tunnelId, status, now);
    return status;
  } catch {
    return cached ? (cached.status as CloudflareTunnelStatus) : null;
  }
}

async function summarize(ctx: RelayContext, link: LinkRow, allocation: AllocationRow | null): Promise<EnvironmentSummary> {
  const base = {
    environmentId: link.environment_id,
    keyThumbprint: link.env_key_jkt,
    label: link.label,
    platform: link.platform,
    hostname: allocation?.hostname ?? null,
    httpBaseUrl: allocation ? httpBaseUrlForHostname(allocation.hostname) : null,
    linkedAt: new Date(link.created_at).toISOString(),
  };
  if (!allocation || allocation.status === "provisioning") {
    return { ...base, status: "provisioning", tunnelStatus: null };
  }
  if (allocation.status === "released" || !allocation.tunnel_id) {
    return { ...base, status: "offline", tunnelStatus: null, offlineReason: "tunnel_released" };
  }
  if (allocation.status !== "ready") {
    return { ...base, status: "offline", tunnelStatus: null, offlineReason: "busy" };
  }
  const status = ctx.config.tunnel ? await tunnelStatus(ctx, allocation.tunnel_id) : null;
  return {
    ...base,
    status: status === null ? "unknown" : status === "healthy" || status === "degraded" ? "online" : "offline",
    tunnelStatus: status,
  };
}

export async function handleListEnvironments(request: Request, ctx: RelayContext): Promise<Response> {
  const user = await verifyUserToken(request, ctx.config, ctx.deps, ANY_CLIENT);
  const links = await listActiveLinks(ctx.db, user.userId);
  const environments = await Promise.all(
    links.map(async (link) => summarize(ctx, link, await getAllocation(ctx.db, linkedKey(link)))),
  );
  const body: ListEnvironmentsResponse = { environments };
  return json(body);
}

// --- POST /v1/environments/:id/connect ------------------------------------------------

export async function handleConnect(request: Request, ctx: RelayContext, environmentId: string): Promise<Response> {
  if (!ENVIRONMENT_ID_PATTERN.test(environmentId)) {
    throw new RelayError("invalid_request", "The environment id has an invalid format.");
  }
  const user = await verifyUserToken(request, ctx.config, ctx.deps, [WEBSITE_CLIENT_IDS.ios]);
  const { jkt } = await verifyDpopProof(request, {
    htu: `${ctx.config.origin}/v1/environments/${environmentId}/connect`,
    accessToken: user.token,
    db: ctx.db,
    deps: ctx.deps,
  });
  return json(await brokerConnect(ctx, { userId: user.userId, environmentId, jkt }));
}

// --- devices ----------------------------------------------------------------------------

const APNS_TOKEN_PATTERN = /^[0-9a-fA-F]{64,200}$/u;

export async function handleRegisterDevice(request: Request, ctx: RelayContext): Promise<Response> {
  const user = await verifyUserToken(request, ctx.config, ctx.deps, [WEBSITE_CLIENT_IDS.ios]);
  const body = asObject((await readJsonBody(request)).value);
  const token = requireString(body, "token", { pattern: APNS_TOKEN_PATTERN, min: 64, max: 200 }).toLowerCase();
  const environment = requireOneOf(body, "environment", ["sandbox", "production"] as const);
  await registerPushDevice(ctx.db, { token, userId: user.userId, environment, now: ctx.deps.now() });
  return json({ registered: true });
}

export async function handleUnregisterDevice(request: Request, ctx: RelayContext): Promise<Response> {
  const user = await verifyUserToken(request, ctx.config, ctx.deps, ANY_CLIENT);
  const body = asObject((await readJsonBody(request)).value);
  const token = requireString(body, "token", { pattern: APNS_TOKEN_PATTERN, min: 64, max: 200 }).toLowerCase();
  await unregisterPushDevice(ctx.db, user.userId, token);
  return json({ unregistered: true });
}

// --- POST /v1/activity -------------------------------------------------------------------

export async function handleActivity(request: Request, ctx: RelayContext): Promise<Response> {
  const signed = await verifyEnvironmentRequest(request, {
    config: ctx.config,
    deps: ctx.deps,
    db: ctx.db,
    op: "environment.activity",
    resolveKey: (environmentId, kid) => linkForSignature(ctx, environmentId, kid),
  });
  const sessionId = requireString(signed.body, "sessionId", { pattern: SESSION_ID_PATTERN, max: 128 });
  const event = requireOneOf(signed.body, "event", ACTIVITY_EVENTS);
  if (!ctx.config.apns) {
    throw new RelayError("not_configured", "Push is not configured on this relay.");
  }
  const devices = await listPushDevices(ctx.db, signed.context.user_id);
  const result: ActivityResponse = await sendCoachAlert(ctx.config.apns, ctx.deps, ctx.db, devices, {
    environmentId: signed.environmentId,
    sessionId,
    event,
  });
  log("info", "activity_pushed", { environmentId: signed.environmentId, event, ...result });
  return json(result);
}

// --- GET /.well-known/jwks.json ----------------------------------------------------------

export async function handleJwks(ctx: RelayContext): Promise<Response> {
  return json(await relayJwks(ctx.config), 200, { "cache-control": "public, max-age=300" });
}

export async function handleHealth(ctx: RelayContext): Promise<Response> {
  return json({
    service: "coroslink-relay",
    stage: ctx.config.stage,
    protocol: 1,
    tunnels: ctx.config.tunnel !== null,
    push: ctx.config.apns !== null,
    cleanupMode: ctx.config.cleanupMode,
  });
}
