import { beforeEach, describe, expect, it } from "vitest";
import type { LinkResponse, RecoveryResponse } from "../src/protocol";
import { isExpiredTunnel, rotatedPages, SWEEP_DELETE_LIMIT, SWEEP_LIST_REQUEST_LIMIT } from "../src/reaper";
import { createEnvironment, errorCode, Harness, type EnvironmentIdentity, type FakeTunnel } from "./helpers";

const MINUTE = 60 * 1000;
let harness: Harness;

async function setup(mode: "off" | "dry-run" | "enabled") {
  harness = await Harness.create({ RELAY_TUNNEL_CLEANUP_MODE: mode });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Links a desktop, optionally registers recovery, then makes its tunnel look idle. */
async function idleDesktop(
  options: { recovery?: boolean; state?: "down" | "inactive" | "healthy"; idleFor?: number } = {},
): Promise<{ desktop: EnvironmentIdentity; linked: LinkResponse; tunnel: FakeTunnel }> {
  const desktop = await createEnvironment();
  const linked = (await (await harness.link(desktop)).json()) as LinkResponse;
  if (options.recovery ?? true) {
    const recovery = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(recovery.status).toBe(200);
  }
  const tunnel = harness.cloudflare.tunnels.get(linked.tunnelId)!;
  const idleFor = options.idleFor ?? 10 * MINUTE;
  const state = options.state ?? "down";
  tunnel.status = state;
  tunnel.created_at = iso(harness.clock.now - idleFor - MINUTE);
  if (state === "inactive") tunnel.created_at = iso(harness.clock.now - idleFor);
  if (state === "down") tunnel.conns_inactive_at = iso(harness.clock.now - idleFor);
  return { desktop, linked, tunnel };
}

/** Seeds many recovery-registered idle allocations straight into D1 and the fake. */
async function seedIdleAllocations(count: number): Promise<void> {
  const db = harness.env.DB;
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < count; index += 1) {
    const hex = index.toString(16).padStart(16, "0");
    const environmentId = `env_bulk_${String(index).padStart(5, "0")}`;
    const tunnel = harness.cloudflare.seedTunnel({
      name: `clink-${hex}`,
      status: "down",
      conns_inactive_at: iso(harness.clock.now - 30 * MINUTE),
      created_at: iso(harness.clock.now - 24 * 60 * MINUTE),
    });
    statements.push(
      db
        .prepare(
          "INSERT INTO environment_links (user_id, environment_id, env_public_jwk, env_key_jkt, label, platform, created_at, updated_at) VALUES (?, ?, '{}', ?, 'Bulk', 'linux', 0, 0)",
        )
        .bind("bulk_user", environmentId, `kid_${index}`),
      db
        .prepare(
          `INSERT INTO allocations (user_id, environment_id, hostname, tunnel_name, status, generation, tunnel_id, configured_tunnel_id, origin_port, ready_at, recovery_registered_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ready', 3, ?, ?, 4000, 0, 0, 0, 0)`,
        )
        .bind("bulk_user", environmentId, `${hex}.tunnels.test`, `clink-${hex}`, tunnel.id, tunnel.id),
    );
  }
  for (let start = 0; start < statements.length; start += 100) {
    await db.batch(statements.slice(start, start + 100));
  }
}

describe("tunnel cleanup candidates", () => {
  it("matches same-stage tunnels down at least 5 minutes or never connected for an hour", () => {
    const now = Date.UTC(2026, 9, 16, 12);
    const tunnel = (overrides: Partial<FakeTunnel>) =>
      ({ id: "t", name: "clink-0123456789abcdef", status: "down", created_at: iso(now - 2 * 60 * MINUTE), ...overrides }) as FakeTunnel;
    const downCutoff = now - 5 * MINUTE;
    const inactiveCutoff = now - 60 * MINUTE;
    expect(isExpiredTunnel(tunnel({ conns_inactive_at: iso(now - 6 * MINUTE) }), "down", "production", downCutoff)).toBe(true);
    expect(isExpiredTunnel(tunnel({ conns_inactive_at: iso(now - 4 * MINUTE) }), "down", "production", downCutoff)).toBe(false);
    expect(isExpiredTunnel(tunnel({ status: "inactive" }), "inactive", "production", inactiveCutoff)).toBe(true);
    expect(
      isExpiredTunnel(tunnel({ status: "inactive", created_at: iso(now - 30 * MINUTE) }), "inactive", "production", inactiveCutoff),
    ).toBe(false);
    expect(isExpiredTunnel(tunnel({ status: "healthy" }), "down", "production", downCutoff)).toBe(false);
    // Another stage, a foreign name, or a deleted tunnel never match.
    expect(
      isExpiredTunnel(tunnel({ name: "clink-dev-0123456789abcdef", conns_inactive_at: iso(now - 6 * MINUTE) }), "down", "production", downCutoff),
    ).toBe(false);
    expect(
      isExpiredTunnel(tunnel({ name: "clink-dev-0123456789abcdef", conns_inactive_at: iso(now - 6 * MINUTE) }), "down", "dev", downCutoff),
    ).toBe(true);
    expect(isExpiredTunnel(tunnel({ name: "clink-my-homelab", conns_inactive_at: iso(now - 6 * MINUTE) }), "down", "production", downCutoff)).toBe(
      false,
    );
    expect(
      isExpiredTunnel(tunnel({ deleted_at: iso(now), conns_inactive_at: iso(now - 6 * MINUTE) }), "down", "production", downCutoff),
    ).toBe(false);
  });

  it("rotates the pages it reads after page 1", () => {
    expect(rotatedPages(undefined, 7, 4)).toEqual([2, 3, 4, 5]);
    expect(rotatedPages(100, 7, 4)).toEqual([]);
    expect(rotatedPages(1_000, 0, 4)).toEqual([2, 3, 4, 5]);
    expect(rotatedPages(1_000, 1, 4)).toEqual([3, 4, 5, 6]);
    expect(rotatedPages(1_000, 8, 4)).toEqual([10, 2, 3, 4]);
  });
});

describe("sweep modes", () => {
  it("off: never calls Cloudflare", async () => {
    await setup("off");
    await idleDesktop();
    harness.calls = [];
    const { sweep } = await harness.maintenance();
    expect(sweep).toMatchObject({ mode: "off", listRequests: 0, deleted: 0, wouldDelete: 0 });
    expect(harness.cloudflareCalls()).toEqual([]);
  });

  it("dry-run: counts and names candidates, deletes nothing", async () => {
    await setup("dry-run");
    const eligible = await idleDesktop();
    await idleDesktop({ state: "inactive", idleFor: 2 * 60 * MINUTE });
    await idleDesktop({ recovery: false });
    await idleDesktop({ state: "healthy" });
    await idleDesktop({ idleFor: 2 * MINUTE });
    harness.cloudflare.seedTunnel({
      name: "clink-ffffffffffffffff",
      status: "down",
      created_at: iso(harness.clock.now - 2 * 60 * MINUTE),
      conns_inactive_at: iso(harness.clock.now - 60 * MINUTE),
    });

    harness.calls = [];
    const { sweep } = await harness.maintenance();
    expect(sweep).toMatchObject({
      mode: "dry-run",
      scanned: 4,
      wouldDelete: 2,
      deleted: 0,
      attempted: 0,
      skippedNoRecovery: 1,
      skippedOrphan: 1,
    });
    expect(sweep.candidates).toContain(eligible.tunnel.name);
    expect(harness.cloudflareCalls().every((call) => call.method === "GET")).toBe(true);
    expect(harness.cloudflare.liveTunnels()).toHaveLength(6);
  });

  it("enabled: deletes only recovery-registered tunnels whose id the allocation records", async () => {
    await setup("enabled");
    const eligible = await idleDesktop();
    const never = await idleDesktop({ state: "inactive", idleFor: 2 * 60 * MINUTE });
    const legacy = await idleDesktop({ recovery: false });
    const orphan = harness.cloudflare.seedTunnel({
      name: "clink-ffffffffffffffff",
      status: "down",
      created_at: iso(harness.clock.now - 2 * 60 * MINUTE),
      conns_inactive_at: iso(harness.clock.now - 60 * MINUTE),
    });
    // An allocation that lost track of its tunnel id (a provision in flight).
    const unrecorded = await idleDesktop();
    await harness.env.DB.prepare("UPDATE allocations SET tunnel_id = NULL WHERE hostname = ?").bind(unrecorded.linked.hostname).run();
    // An allocation that already moved to a replacement tunnel with the same name.
    const replaced = await idleDesktop();
    const stale = harness.cloudflare.seedTunnel({
      name: replaced.tunnel.name,
      status: "down",
      created_at: iso(harness.clock.now - 2 * 60 * MINUTE),
      conns_inactive_at: iso(harness.clock.now - 60 * MINUTE),
    });
    replaced.tunnel.status = "healthy";

    const { sweep } = await harness.maintenance();
    expect(sweep).toMatchObject({
      mode: "enabled",
      wouldDelete: 2,
      attempted: 2,
      deleted: 2,
      skippedNoRecovery: 1,
      skippedOrphan: 1,
      skippedUnrecorded: 1,
      skippedReplaced: 1,
      failed: 0,
    });
    const live = new Set(harness.cloudflare.liveTunnels().map((tunnel) => tunnel.id));
    expect(live.has(eligible.tunnel.id)).toBe(false);
    expect(live.has(never.tunnel.id)).toBe(false);
    for (const kept of [legacy.tunnel.id, orphan.id, unrecorded.tunnel.id, stale.id, replaced.tunnel.id]) {
      expect(live.has(kept)).toBe(true);
    }

    // The allocation keeps its hostname and DNS record; recovery brings the tunnel back.
    const released = await harness.allocation("user_1", eligible.desktop.environmentId);
    expect(released).toMatchObject({ status: "released", tunnel_id: null, hostname: eligible.linked.hostname });
    expect(released?.dns_record_id).not.toBeNull();
    harness.clock.advance(3 * MINUTE);
    const recovered = (await (
      await harness.recovery(eligible.desktop, { tunnelId: eligible.linked.tunnelId, port: 47_831 })
    ).json()) as RecoveryResponse;
    expect(recovered).toMatchObject({ action: "reprovisioned", hostname: eligible.linked.hostname });
    expect(recovered.connectorToken).toBeDefined();
  });

  it("enabled: a host that reconnects mid-sweep wins", async () => {
    await setup("enabled");
    const { desktop, linked, tunnel } = await idleDesktop();
    harness.clock.advance(3 * MINUTE);
    let busy: Response | undefined;
    harness.cloudflare.hooks.push({
      method: "GET",
      path: new RegExp(`/cfd_tunnel/${linked.tunnelId}$`, "u"),
      once: true,
      run: async () => {
        // While the reaper holds the claim, recovery waits instead of racing it...
        busy = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
        // ...and the connector comes back before the delete.
        tunnel.status = "healthy";
      },
    });
    const { sweep } = await harness.maintenance();
    expect(await errorCode(busy!)).toBe("allocation_busy");
    expect(sweep).toMatchObject({ deleted: 0, skippedReconnected: 1 });
    expect(harness.cloudflare.liveTunnels().map((entry) => entry.id)).toContain(tunnel.id);
    expect((await harness.allocation("user_1", desktop.environmentId))?.status).toBe("ready");
  });
});

describe("sweep bounds", () => {
  it("deletes at most 100 tunnels and reads at most 10 list pages", async () => {
    await setup("enabled");
    await seedIdleAllocations(650);
    const { sweep } = await harness.maintenance();
    expect(sweep.listRequests).toBeLessThanOrEqual(SWEEP_LIST_REQUEST_LIMIT);
    expect(sweep.listRequests).toBe(6); // 5 pages of down tunnels, 1 (empty) of inactive ones
    expect(sweep.deleted).toBe(SWEEP_DELETE_LIMIT);
    expect(sweep.attempted).toBe(SWEEP_DELETE_LIMIT);
    expect(sweep.truncated).toBe(true);
    expect(harness.callsTo("DELETE", /\/cfd_tunnel\/[^/]+$/u)).toHaveLength(SWEEP_DELETE_LIMIT);
  });

  it("starts each sweep further along the candidate list", async () => {
    await setup("dry-run");
    await seedIdleAllocations(150);
    const first = (await harness.maintenance()).sweep.candidates;
    harness.clock.advance(5 * MINUTE);
    const second = (await harness.maintenance()).sweep.candidates;
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
    expect(second[0]).not.toBe(first[0]);
  });

  it("stops on a Cloudflare 429 and releases the claim", async () => {
    await setup("enabled");
    await seedIdleAllocations(5);
    harness.cloudflare.failNext("DELETE", /\/cfd_tunnel\/[^/]+$/u, 429);
    const { sweep } = await harness.maintenance();
    expect(sweep).toMatchObject({ attempted: 1, deleted: 0, failed: 1, rateLimited: true, truncated: true });
    expect(harness.callsTo("DELETE", /\/cfd_tunnel\/[^/]+$/u)).toHaveLength(1);
    const { results } = await harness.env.DB.prepare("SELECT status FROM allocations").all<{ status: string }>();
    expect(results.every((row) => row.status === "ready")).toBe(true);
  });

  it("stops listing on a 429", async () => {
    await setup("enabled");
    await seedIdleAllocations(5);
    harness.cloudflare.failNext("GET", /\/cfd_tunnel$/u, 429);
    const { sweep } = await harness.maintenance();
    expect(sweep).toMatchObject({ listRequests: 1, deleted: 0, rateLimited: true });
  });

  it("stops starting work at the two-minute deadline", async () => {
    await setup("enabled");
    await seedIdleAllocations(20);
    harness.cloudflare.hooks.push({
      method: "DELETE",
      path: /\/cfd_tunnel\/[^/]+$/u,
      run: () => harness.clock.advance(30_000),
    });
    const { sweep } = await harness.maintenance();
    expect(sweep.deadlineReached).toBe(true);
    expect(sweep.deleted).toBe(4); // 0, 30, 60, 90 s started; 120 s is past the deadline
  });
});
