import { beforeEach, describe, expect, it } from "vitest";
import type { LinkResponse, UnlinkResponse } from "../src/protocol";
import { createEnvironment, errorCode, Harness, RELAY_ORIGIN, type EnvironmentIdentity } from "./helpers";

let harness: Harness;
let desktop: EnvironmentIdentity;
let linked: LinkResponse;

beforeEach(async () => {
  harness = await Harness.create();
  desktop = await createEnvironment();
  linked = (await (await harness.link(desktop)).json()) as LinkResponse;
});

async function userUnlink(environmentId = desktop.environmentId, clientId: "c-link-ios" | "coroslink-desktop" = "c-link-ios") {
  return harness.fetch(
    new Request(`${RELAY_ORIGIN}/v1/environments/unlink`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await harness.userToken({ clientId })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ environmentId }),
    }),
  );
}

describe("POST /v1/environments/unlink", () => {
  it("revokes the link, then deletes the DNS record and tunnel, keeping the hostname reserved", async () => {
    const revokedAtFirstDelete: Array<number | null | undefined> = [];
    harness.cloudflare.hooks.push({
      method: "DELETE",
      path: /./u,
      run: async () => {
        revokedAtFirstDelete.push((await harness.linkRow("user_1", desktop.environmentId))?.revoked_at);
      },
    });
    const response = await userUnlink();
    // The revocation was committed before the first external delete.
    expect(revokedAtFirstDelete[0]).toBe(harness.clock.now);
    expect(response.status).toBe(200);
    expect((await response.json()) as UnlinkResponse).toEqual({
      environmentId: desktop.environmentId,
      unlinked: true,
      teardown: "complete",
    });
    expect((await harness.linkRow("user_1", desktop.environmentId))?.revoked_at).toBe(harness.clock.now);
    expect(harness.cloudflare.liveTunnels()).toHaveLength(0);
    expect(harness.cloudflare.dns.size).toBe(0);
    expect(await harness.allocation("user_1", desktop.environmentId)).toMatchObject({
      status: "released",
      hostname: linked.hostname,
      tunnel_id: null,
      dns_record_id: null,
    });

    // The connector is disconnected before the tunnel is deleted.
    const teardown = harness
      .cloudflareCalls()
      .filter((call) => call.method === "DELETE")
      .map((call) => new URL(call.url).pathname.split("/").slice(-2).join("/"));
    expect(teardown).toEqual([
      expect.stringMatching(/^dns_records\//u),
      `${linked.tunnelId}/connections`,
      `cfd_tunnel/${linked.tunnelId}`,
    ]);
  });

  it("commits the revocation even when teardown fails, and the cron finishes it", async () => {
    harness.cloudflare.failNext("DELETE", /\/cfd_tunnel\/[^/]+$/u, 500);
    const response = await userUnlink();
    expect(((await response.json()) as UnlinkResponse).teardown).toBe("pending");

    // Revoked first: the link is unusable although its tunnel still exists.
    expect((await harness.linkRow("user_1", desktop.environmentId))?.revoked_at).not.toBeNull();
    expect(harness.cloudflare.liveTunnels()).toHaveLength(1);
    const pending = await harness.allocation("user_1", desktop.environmentId);
    expect(pending).toMatchObject({ status: "deprovisioning", dns_record_id: null, tunnel_id: linked.tunnelId });

    // The claim blocks a fresh retry, then ages out.
    let result = await harness.maintenance();
    expect(result.teardownsAttempted).toBe(0);
    harness.clock.advance(121_000);
    result = await harness.maintenance();
    expect(result).toMatchObject({ teardownsAttempted: 1, teardownsCompleted: 1 });
    expect(harness.cloudflare.liveTunnels()).toHaveLength(0);
    expect((await harness.allocation("user_1", desktop.environmentId))?.status).toBe("released");
  });

  it("aborts the teardown when a relink takes the allocation over mid-way", async () => {
    harness.cloudflare.hooks.push({
      method: "DELETE",
      path: /\/dns_records\//u,
      once: true,
      run: async () => {
        // A relink lands while the DNS delete is in flight.
        await harness.env.DB.prepare("UPDATE environment_links SET revoked_at = NULL").run();
        await harness.env.DB.prepare("UPDATE allocations SET generation = generation + 1, status = 'provisioning', claimed_at = NULL").run();
      },
    });
    const response = await userUnlink();
    expect(((await response.json()) as UnlinkResponse).teardown).toBe("pending");
    // The tunnel the relink now owns was not deleted.
    expect(harness.cloudflare.liveTunnels().map((tunnel) => tunnel.id)).toEqual([linked.tunnelId]);
  });

  it("accepts an environment-signed unlink from the desktop", async () => {
    const response = await harness.signedPost(desktop, "/v1/environments/unlink", "environment.unlink", {
      environmentId: desktop.environmentId,
    });
    expect(response.status).toBe(200);
    expect((await harness.linkRow("user_1", desktop.environmentId))?.revoked_at).not.toBeNull();
    // Signed calls for an unlinked desktop are refused afterwards.
    const again = await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    expect(await errorCode(again)).toBe("environment_not_linked");
  });

  it("is idempotent and 404s for computers never linked", async () => {
    await userUnlink();
    const again = await userUnlink();
    expect(again.status).toBe(200);
    expect(((await again.json()) as UnlinkResponse).teardown).toBe("complete");
    const never = await userUnlink("env_never_linked_1");
    expect(never.status).toBe(404);
  });

  it("relinking after unlink reuses the hostname with a new tunnel", async () => {
    await userUnlink();
    const relinked = (await (await harness.link(desktop)).json()) as LinkResponse;
    expect(relinked.hostname).toBe(linked.hostname);
    expect(relinked.tunnelId).not.toBe(linked.tunnelId);
    expect(harness.cloudflare.liveTunnels()).toHaveLength(1);
    expect(harness.cloudflare.dns.size).toBe(1);
  });
});

describe("GET /v1/environments", () => {
  it("lists linked computers with online status from Cloudflare, cached briefly", async () => {
    const token = await harness.userToken({ clientId: "c-link-ios" });
    let { status, body } = await harness.getJson<{ environments: Array<Record<string, unknown>> }>("/v1/environments", token);
    expect(status).toBe(200);
    expect(body.environments).toEqual([
      expect.objectContaining({
        environmentId: desktop.environmentId,
        label: "Aker's MacBook",
        platform: "darwin",
        hostname: linked.hostname,
        status: "offline",
        tunnelStatus: "inactive",
      }),
    ]);

    harness.cloudflare.tunnels.get(linked.tunnelId)!.status = "healthy";
    ({ body } = await harness.getJson("/v1/environments", token));
    expect(body.environments[0]?.status).toBe("offline"); // cached
    harness.clock.advance(31_000);
    ({ body } = await harness.getJson("/v1/environments", token));
    expect(body.environments[0]).toMatchObject({ status: "online", tunnelStatus: "healthy" });
  });

  it("does not list other users' or revoked links", async () => {
    await userUnlink();
    const other = await createEnvironment();
    await harness.link(other, { userId: "user_2" });
    const { body } = await harness.getJson<{ environments: unknown[] }>("/v1/environments", await harness.userToken());
    expect(body.environments).toEqual([]);
  });
});
