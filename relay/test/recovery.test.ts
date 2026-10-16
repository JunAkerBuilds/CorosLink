import { beforeEach, describe, expect, it } from "vitest";
import type { LinkResponse, RecoveryResponse } from "../src/protocol";
import { createEnvironment, errorCode, Harness, type EnvironmentIdentity } from "./helpers";

let harness: Harness;
let desktop: EnvironmentIdentity;
let linked: LinkResponse;

beforeEach(async () => {
  harness = await Harness.create();
  desktop = await createEnvironment();
  linked = (await (await harness.link(desktop, { port: 47_831 })).json()) as LinkResponse;
});

describe("POST /v1/environments/recovery", () => {
  it("registers recovery and leaves a healthy tunnel alone", async () => {
    harness.calls = [];
    const response = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as RecoveryResponse;
    expect(body).toMatchObject({ action: "unchanged", hostname: linked.hostname, tunnelId: linked.tunnelId });
    expect(body.connectorToken).toBeUndefined();
    // Only the existence check touched Cloudflare.
    expect(harness.cloudflareCalls().map((call) => call.method)).toEqual(["GET"]);

    const allocation = await harness.allocation("user_1", desktop.environmentId);
    expect(allocation?.recovery_registered_at).toBe(harness.clock.now);
    expect(allocation?.last_recovery_at).toBe(harness.clock.now);
  });

  it("updates the ingress when the port changed", async () => {
    const response = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 51_000 });
    const body = (await response.json()) as RecoveryResponse;
    expect(body.action).toBe("reconfigured");
    expect(body.tunnelId).toBe(linked.tunnelId);
    expect(harness.cloudflare.tunnels.get(linked.tunnelId)?.ingress?.[0]).toEqual({
      hostname: linked.hostname,
      service: "http://localhost:51000",
    });
    expect((await harness.allocation("user_1", desktop.environmentId))?.origin_port).toBe(51_000);
  });

  it("re-provisions a missing tunnel under the same allocation and hostname", async () => {
    harness.cloudflare.tunnels.get(linked.tunnelId)!.deleted_at = new Date(harness.clock.now).toISOString();
    const before = await harness.allocation("user_1", desktop.environmentId);

    const response = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as RecoveryResponse;
    expect(body.action).toBe("reprovisioned");
    expect(body.hostname).toBe(linked.hostname);
    expect(body.tunnelId).not.toBe(linked.tunnelId);
    expect(body.connectorToken).toBe(`connector-token-${body.tunnelId}`);
    expect(body.generation).toBeGreaterThan(before!.generation);

    // The DNS record was repointed, not recreated.
    const records = [...harness.cloudflare.dns.values()];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: before!.dns_record_id, name: linked.hostname, content: `${body.tunnelId}.cfargotunnel.com` });
    const tunnel = harness.cloudflare.tunnels.get(body.tunnelId);
    expect(tunnel?.name).toBe(before!.tunnel_name);
    expect(tunnel?.ingress?.[0]).toEqual({ hostname: linked.hostname, service: "http://localhost:47831" });
  });

  it("re-provisions after cleanup released the tunnel", async () => {
    await harness.env.DB.prepare(
      "UPDATE allocations SET status = 'released', tunnel_id = NULL, configured_tunnel_id = NULL, tunnel_released_at = ?",
    )
      .bind(harness.clock.now)
      .run();
    harness.cloudflare.tunnels.get(linked.tunnelId)!.deleted_at = new Date(harness.clock.now).toISOString();

    const body = (await (await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 })).json()) as RecoveryResponse;
    expect(body.action).toBe("reprovisioned");
    expect(body.hostname).toBe(linked.hostname);
    expect(body.connectorToken).toBeDefined();
    expect(await harness.allocation("user_1", desktop.environmentId)).toMatchObject({
      status: "ready",
      tunnel_id: body.tunnelId,
      tunnel_released_at: null,
    });
  });

  it("hands out the current connector token when the desktop holds a stale tunnel id", async () => {
    const body = (await (await harness.recovery(desktop, { tunnelId: "old-tunnel", port: 47_831 })).json()) as RecoveryResponse;
    expect(body.action).toBe("unchanged");
    expect(body.connectorToken).toBe(`connector-token-${linked.tunnelId}`);
  });

  it("runs at most once per two minutes per environment", async () => {
    expect((await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 })).status).toBe(200);
    harness.clock.advance(60_000);
    const limited = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("rate_limited");
    expect(limited.headers.get("retry-after")).toBe("60");
    harness.clock.advance(60_000);
    expect((await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 })).status).toBe(200);
  });

  it("waits while cleanup holds the allocation", async () => {
    await harness.env.DB.prepare("UPDATE allocations SET status = 'reaping', claimed_at = ?").bind(harness.clock.now).run();
    const busy = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(busy.status).toBe(503);
    expect(await errorCode(busy)).toBe("allocation_busy");
    // A busy answer does not use up the rate limit, and an abandoned claim expires.
    harness.clock.advance(121_000);
    expect((await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 })).status).toBe(200);
  });

  it("fails with allocation_conflict when another writer bumps the generation mid-way", async () => {
    harness.cloudflare.tunnels.get(linked.tunnelId)!.deleted_at = new Date(harness.clock.now).toISOString();
    harness.cloudflare.hooks.push({
      method: "POST",
      path: /\/cfd_tunnel$/u,
      once: true,
      run: async () => {
        await harness.env.DB.prepare("UPDATE allocations SET generation = generation + 1").run();
      },
    });
    const response = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("allocation_conflict");
  });

  it("is refused for an environment that is not linked", async () => {
    const stranger = await createEnvironment();
    const response = await harness.recovery(stranger, { tunnelId: null, port: 47_831 });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("environment_not_linked");
  });
});
