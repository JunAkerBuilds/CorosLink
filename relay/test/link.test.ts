import { beforeEach, describe, expect, it } from "vitest";
import type { LinkResponse } from "../src/protocol";
import { createEnvironment, errorCode, Harness, ZONE_NAME, type EnvironmentIdentity } from "./helpers";

let harness: Harness;
let desktop: EnvironmentIdentity;

beforeEach(async () => {
  harness = await Harness.create();
  desktop = await createEnvironment();
});

describe("POST /v1/environments/link", () => {
  it("creates the tunnel, ingress and DNS record, then returns the hostname and connector token", async () => {
    const response = await harness.link(desktop, { port: 47_831 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as LinkResponse;

    expect(body.hostname).toMatch(new RegExp(`^[a-f0-9]{16}\\.${ZONE_NAME.replace(".", "\\.")}$`));
    expect(body.httpBaseUrl).toBe(`https://${body.hostname}`);
    expect(body.userId).toBe("user_1");
    expect(body.connectorToken).toBe(`connector-token-${body.tunnelId}`);

    const [tunnel] = harness.cloudflare.liveTunnels();
    expect(tunnel?.id).toBe(body.tunnelId);
    expect(tunnel?.name).toBe(`clink-${body.hostname.split(".")[0]}`);
    expect(tunnel?.ingress).toEqual([
      { hostname: body.hostname, service: "http://localhost:47831" },
      { service: "http_status:404" },
    ]);
    const records = [...harness.cloudflare.dns.values()];
    expect(records).toEqual([
      expect.objectContaining({ type: "CNAME", name: body.hostname, content: `${body.tunnelId}.cfargotunnel.com`, proxied: true }),
    ]);

    const allocation = await harness.allocation("user_1", desktop.environmentId);
    expect(allocation).toMatchObject({
      status: "ready",
      tunnel_id: body.tunnelId,
      configured_tunnel_id: body.tunnelId,
      origin_port: 47_831,
      dns_tunnel_id: body.tunnelId,
      recovery_registered_at: null,
    });
    expect(allocation?.generation).toBe(body.generation);
    // reserve, take, tunnel, ingress, dns, ready
    expect(body.generation).toBeGreaterThanOrEqual(4);

    const link = await harness.linkRow("user_1", desktop.environmentId);
    expect(link).toMatchObject({ env_key_jkt: desktop.kid, label: "Aker's MacBook", platform: "darwin", revoked_at: null });
    expect(JSON.parse(link!.env_public_jwk)).toEqual(desktop.publicJwk);
  });

  it("resumes after a partial failure without recreating finished steps", async () => {
    harness.cloudflare.failNext("POST", /\/dns_records$/u, 500);
    const failed = await harness.link(desktop);
    expect(failed.status).toBe(502);
    expect(await errorCode(failed)).toBe("upstream_error");

    const partial = await harness.allocation("user_1", desktop.environmentId);
    expect(partial).toMatchObject({ status: "provisioning", dns_record_id: null });
    expect(partial?.tunnel_id).toBeTruthy();
    expect(partial?.configured_tunnel_id).toBe(partial?.tunnel_id);

    harness.calls = [];
    const retried = await harness.link(desktop);
    expect(retried.status).toBe(200);
    const body = (await retried.json()) as LinkResponse;

    expect(body.tunnelId).toBe(partial?.tunnel_id);
    expect(harness.callsTo("POST", /\/cfd_tunnel$/u)).toHaveLength(0);
    expect(harness.callsTo("PUT", /\/configurations$/u)).toHaveLength(0);
    expect(harness.callsTo("POST", /\/dns_records$/u)).toHaveLength(1);
    expect(harness.cloudflare.liveTunnels()).toHaveLength(1);
    expect((await harness.allocation("user_1", desktop.environmentId))?.status).toBe("ready");
  });

  it("adopts a tunnel an earlier attempt created but never recorded", async () => {
    // The first attempt dies after Cloudflare created the tunnel: simulate by
    // failing the create response while the tunnel exists.
    const first = await harness.link(desktop);
    const { hostname, tunnelId } = (await first.json()) as LinkResponse;
    await harness.env.DB.prepare(
      "UPDATE allocations SET tunnel_id = NULL, configured_tunnel_id = NULL, dns_tunnel_id = NULL, status = 'provisioning'",
    ).run();

    harness.calls = [];
    const retried = await harness.link(desktop);
    const body = (await retried.json()) as LinkResponse;
    expect(body).toMatchObject({ hostname, tunnelId });
    expect(harness.callsTo("POST", /\/cfd_tunnel$/u)).toHaveLength(0);
    expect(harness.cloudflare.liveTunnels()).toHaveLength(1);
    expect(harness.cloudflare.dns.size).toBe(1);
  });

  it("is idempotent and keeps the hostname for the user/environment pair", async () => {
    const first = (await (await harness.link(desktop)).json()) as LinkResponse;
    const second = (await (await harness.link(desktop, { port: 50_000 })).json()) as LinkResponse;
    expect(second.hostname).toBe(first.hostname);
    expect(second.tunnelId).toBe(first.tunnelId);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(harness.cloudflare.liveTunnels()[0]?.ingress?.[0]?.service).toBe("http://localhost:50000");

    const otherUser = (await (await harness.link(desktop, { userId: "user_2" })).json()) as LinkResponse;
    expect(otherUser.hostname).not.toBe(first.hostname);
  });

  it("revokes the earlier account's link when the same desktop key links under another account", async () => {
    await harness.link(desktop, { userId: "user_1" });
    const response = await harness.link(desktop, { userId: "user_2" });
    expect(response.status).toBe(200);

    expect((await harness.linkRow("user_1", desktop.environmentId))?.revoked_at).not.toBeNull();
    expect((await harness.linkRow("user_2", desktop.environmentId))?.revoked_at).toBeNull();
    // The old account's tunnel is torn down in the background; its hostname stays reserved.
    const old = await harness.allocation("user_1", desktop.environmentId);
    expect(old).toMatchObject({ status: "released", tunnel_id: null, dns_record_id: null });
    expect(harness.cloudflare.liveTunnels()).toHaveLength(1);
  });

  it("lets a different key link the same environment id only as a separate link", async () => {
    const impostor = await createEnvironment(desktop.environmentId);
    await harness.link(desktop, { userId: "user_1" });
    const response = await harness.link(impostor, { userId: "user_attacker" });
    expect(response.status).toBe(200);
    // The real link is untouched.
    expect((await harness.linkRow("user_1", desktop.environmentId))?.revoked_at).toBeNull();
  });

  it("caps how many computers one account links, each being a paid tunnel", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await harness.link(await createEnvironment())).status).toBe(200);
    }
    const eleventh = await harness.link(await createEnvironment());
    expect(eleventh.status).toBe(409);
    expect(await errorCode(eleventh)).toBe("link_limit_reached");
    expect(harness.cloudflare.liveTunnels()).toHaveLength(10);
  });

  it("requires a desktop relay token", async () => {
    const response = await harness.signedPost(
      desktop,
      "/v1/environments/link",
      "environment.link",
      { environmentId: desktop.environmentId, publicJwk: desktop.publicJwk, label: "Mac", platform: "darwin", port: 1234 },
      { userToken: await harness.userToken({ clientId: "c-link-ios" }) },
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("client_not_allowed");
  });

  it("refuses a signature whose kid is not the thumbprint of the submitted key", async () => {
    const other = await createEnvironment();
    const response = await harness.signedPost(
      desktop,
      "/v1/environments/link",
      "environment.link",
      { environmentId: desktop.environmentId, publicJwk: other.publicJwk, label: "Mac", platform: "darwin", port: 1234 },
      { userToken: await harness.userToken() },
    );
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("invalid_signature");
  });

  it("refuses private key material", async () => {
    const response = await harness.signedPost(
      desktop,
      "/v1/environments/link",
      "environment.link",
      {
        environmentId: desktop.environmentId,
        publicJwk: { ...desktop.publicJwk, d: "private" },
        label: "Mac",
        platform: "darwin",
        port: 1234,
      },
      { userToken: await harness.userToken() },
    );
    expect(response.status).toBe(400);
  });

  it("answers not_configured when the tunnel zone is not set", async () => {
    harness = await Harness.create({ TUNNEL_ZONE_ID: "" });
    const response = await harness.link(desktop);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("not_configured");
  });

  it("surfaces Cloudflare rate limits as retryable", async () => {
    harness.cloudflare.failNext("GET", /\/cfd_tunnel$/u, 429);
    const response = await harness.link(desktop);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("upstream_rate_limited");
    expect(response.headers.get("retry-after")).toBe("30");
  });
});
