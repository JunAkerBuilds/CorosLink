import { describe, expect, it } from "vitest";
import { allocationNames, isManagedHostname, isManagedTunnelName } from "../src/allocations";
import { loadConfig } from "../src/env";
import type { ConnectResponse, LinkResponse } from "../src/protocol";
import { relayJwks } from "../src/relayKey";
import { createEnvironment, dpopProof, es256KeyPair, Harness, honestDesktop, RELAY_ORIGIN } from "./helpers";

// Production and relay-dev share this one zone.
const ZONE = "coroslinkrelay.com";
const MINUTE = 60 * 1000;
const STAGES = ["production", "dev"] as const;

async function stageHarness(stage: (typeof STAGES)[number], mode: "off" | "enabled" = "off") {
  return Harness.create({ RELAY_STAGE: stage, TUNNEL_ZONE_NAME: ZONE, RELAY_TUNNEL_CLEANUP_MODE: mode });
}

describe("stages sharing one tunnel zone", () => {
  it("never give dev and production the same hostname or tunnel name", async () => {
    const harness = await stageHarness("production");
    const production = loadConfig({ ...harness.env, RELAY_STAGE: "production" });
    const dev = loadConfig({ ...harness.env, RELAY_STAGE: "dev" });
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      // The same user, environment and key in both stages: the worst case.
      const key = { userId: `user_${index}`, environmentId: `env_${index}_desktop`, kid: `kid_${index}` };
      const prod = await allocationNames(production, ZONE, key);
      const staged = await allocationNames(dev, ZONE, key);

      expect(prod.hostname).toMatch(/^[a-f0-9]{16}\.coroslinkrelay\.com$/u);
      expect(staged.hostname).toMatch(/^dev-[a-f0-9]{16}\.coroslinkrelay\.com$/u);
      expect(prod.tunnelName).toMatch(/^clink-[a-f0-9]{16}$/u);
      expect(staged.tunnelName).toMatch(/^clink-dev-[a-f0-9]{16}$/u);
      // One label under the zone, as the phone requires.
      for (const hostname of [prod.hostname, staged.hostname]) {
        expect(hostname.slice(0, -`.${ZONE}`.length)).not.toContain(".");
      }

      // Each stage recognises only its own names.
      expect(isManagedHostname(prod.hostname, ZONE, "production")).toBe(true);
      expect(isManagedHostname(prod.hostname, ZONE, "dev")).toBe(false);
      expect(isManagedHostname(staged.hostname, ZONE, "dev")).toBe(true);
      expect(isManagedHostname(staged.hostname, ZONE, "production")).toBe(false);
      expect(isManagedTunnelName(prod.tunnelName, "dev")).toBe(false);
      expect(isManagedTunnelName(staged.tunnelName, "production")).toBe(false);

      for (const name of [prod.hostname, staged.hostname, prod.tunnelName, staged.tunnelName]) {
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }
  });

  it("refuses hostnames with extra labels or from another zone", () => {
    expect(isManagedHostname("0123456789abcdef.coroslinkrelay.com", ZONE, "production")).toBe(true);
    expect(isManagedHostname("a.0123456789abcdef.coroslinkrelay.com", ZONE, "production")).toBe(false);
    expect(isManagedHostname("0123456789abcdef.coroslink.com", ZONE, "production")).toBe(false);
    expect(isManagedHostname("dev-0123456789abcdef.coroslinkrelay.com", ZONE, "production")).toBe(false);
  });

  it("disables tunnels for a stage name that cannot be part of a DNS label", async () => {
    const harness = await stageHarness("production");
    expect(loadConfig({ ...harness.env, RELAY_STAGE: "Dev Stage" }).tunnel).toBeNull();
    expect(loadConfig({ ...harness.env, RELAY_STAGE: "dev" }).tunnel).not.toBeNull();
  });

  it("links and connects on dev with stage-prefixed names", async () => {
    const harness = await stageHarness("dev");
    const desktop = await createEnvironment();
    const linked = (await (await harness.link(desktop)).json()) as LinkResponse;
    expect(linked.hostname).toMatch(/^dev-[a-f0-9]{16}\.coroslinkrelay\.com$/u);
    expect(harness.cloudflare.tunnels.get(linked.tunnelId)?.name).toMatch(/^clink-dev-[a-f0-9]{16}$/u);

    const relayKey = (await relayJwks(loadConfig(harness.env))).keys[0] as import("jose").JWK;
    harness.desktops.set(linked.hostname, honestDesktop(desktop, relayKey, harness.clock));
    const phone = await es256KeyPair();
    const token = await harness.userToken({ clientId: "c-link-ios" });
    const htu = `${RELAY_ORIGIN}/v1/environments/${desktop.environmentId}/connect`;
    const response = await harness.fetch(
      new Request(htu, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          DPoP: await dpopProof(phone, { htm: "POST", htu, accessToken: token, iat: harness.clock.seconds }),
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as ConnectResponse).hostname).toBe(linked.hostname);
  });

  it.each(STAGES)("%s cleanup never touches the other stage's tunnels", async (stage) => {
    const other = stage === "production" ? "dev" : "production";
    const harness = await stageHarness(stage, "enabled");

    // This stage's own idle, recovery-registered tunnel.
    const desktop = await createEnvironment();
    const linked = (await (await harness.link(desktop)).json()) as LinkResponse;
    await harness.recovery(desktop, { tunnelId: linked.tunnelId, port: 47_831 });
    const own = harness.cloudflare.tunnels.get(linked.tunnelId)!;
    Object.assign(own, {
      status: "down",
      created_at: new Date(harness.clock.now - 3 * 60 * MINUTE).toISOString(),
      conns_inactive_at: new Date(harness.clock.now - 60 * MINUTE).toISOString(),
    });

    // The other stage's tunnel in the same account, idle for hours. Even a row
    // for it in this stage's database (which cannot happen) must not matter.
    const foreignNames = await allocationNames(
      loadConfig({ ...harness.env, RELAY_STAGE: other }),
      ZONE,
      { userId: "user_1", environmentId: desktop.environmentId, kid: desktop.kid },
    );
    const foreign = harness.cloudflare.seedTunnel({
      name: foreignNames.tunnelName,
      status: "down",
      created_at: new Date(harness.clock.now - 3 * 60 * MINUTE).toISOString(),
      conns_inactive_at: new Date(harness.clock.now - 60 * MINUTE).toISOString(),
    });
    await harness.env.DB.prepare(
      `INSERT INTO allocations (user_id, environment_id, env_key_jkt, hostname, tunnel_name, status, generation, tunnel_id, recovery_registered_at, created_at, updated_at)
       VALUES ('user_1', ?, 'foreign-kid', ?, ?, 'ready', 1, ?, 0, 0, 0)`,
    )
      .bind(desktop.environmentId, foreignNames.hostname, foreignNames.tunnelName, foreign.id)
      .run();

    harness.clock.advance(6 * MINUTE);
    const { sweep } = await harness.maintenance();
    expect(sweep).toMatchObject({ scanned: 1, deleted: 1 });
    const live = harness.cloudflare.liveTunnels().map((tunnel) => tunnel.id);
    expect(live).toContain(foreign.id);
    expect(live).not.toContain(own.id);
    expect(harness.callsTo("DELETE", new RegExp(foreign.id, "u"))).toEqual([]);
  });
});
