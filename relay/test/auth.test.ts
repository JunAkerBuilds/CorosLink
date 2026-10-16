import { beforeEach, describe, expect, it } from "vitest";
import type { LinkResponse } from "../src/protocol";
import {
  createEnvironment,
  errorCode,
  es256KeyPair,
  Harness,
  RELAY_ORIGIN,
  type EnvironmentIdentity,
} from "./helpers";

let harness: Harness;

beforeEach(async () => {
  harness = await Harness.create();
});

async function list(token: string) {
  return harness.fetch(new Request(`${RELAY_ORIGIN}/v1/environments`, { headers: { authorization: `Bearer ${token}` } }));
}

describe("website relay tokens", () => {
  it("accepts a valid token from either app", async () => {
    expect((await list(await harness.userToken({ clientId: "c-link-ios" }))).status).toBe(200);
    expect((await list(await harness.userToken({ clientId: "coroslink-desktop" }))).status).toBe(200);
  });

  it.each([
    ["the wrong audience", { aud: "relay-dev.coroslink.com" }],
    ["the wrong issuer", { iss: "https://evil.example" }],
    ["an unknown client", { clientId: "some-other-app" }],
  ])("refuses %s", async (_label, input) => {
    const response = await list(await harness.userToken(input));
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("invalid_token");
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("refuses an expired token, allowing 30 s of skew", async () => {
    const token = await harness.userToken({ iat: harness.clock.seconds - 600, exp: harness.clock.seconds - 1 });
    expect((await list(token)).status).toBe(200);
    harness.clock.advance(31_000);
    const response = await list(token);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/expired/u);
  });

  it("refuses a token living longer than 10 minutes", async () => {
    const token = await harness.userToken({ exp: harness.clock.seconds + 3600 });
    expect(await errorCode(await list(token))).toBe("invalid_token");
  });

  it("refuses a token signed by an unknown key, refetching the JWKS at most once per cooldown", async () => {
    const stranger = await es256KeyPair();
    const token = await harness.userToken({ kid: "rotated-key", signer: stranger });
    expect(await errorCode(await list(token))).toBe("invalid_token");
    expect(harness.jwksFetches).toBe(1);
    expect(await errorCode(await list(token))).toBe("invalid_token");
    expect(harness.jwksFetches).toBe(1);

    // After the cooldown a rotated key is picked up.
    harness.extraWebsiteKeys.push({ ...stranger.publicJwk, kid: "rotated-key" });
    harness.clock.advance(31_000);
    const fresh = await harness.userToken({ kid: "rotated-key", signer: stranger });
    expect((await list(fresh)).status).toBe(200);
    expect(harness.jwksFetches).toBe(2);
  });

  it("refuses a known kid with a forged signature", async () => {
    const forger = await es256KeyPair();
    const token = await harness.userToken({ signer: forger });
    expect(await errorCode(await list(token))).toBe("invalid_token");
  });

  it("rides out a website JWKS outage on recent keys without refetching on every request", async () => {
    expect((await list(await harness.userToken())).status).toBe(200);
    harness.jwksFailing = true;
    harness.clock.advance(11 * 60 * 1000);
    expect((await list(await harness.userToken())).status).toBe(200);
    expect(harness.jwksFetches).toBe(2);
    expect((await list(await harness.userToken())).status).toBe(200);
    expect(harness.jwksFetches).toBe(2); // within the 30 s cooldown
    // Keys older than an hour are no longer trusted.
    harness.clock.advance(50 * 60 * 1000);
    const stale = await list(await harness.userToken());
    expect(stale.status).toBe(502);
    expect(await errorCode(stale)).toBe("upstream_error");
  });

  it("caches the JWKS between requests", async () => {
    await list(await harness.userToken());
    await list(await harness.userToken());
    expect(harness.jwksFetches).toBe(1);
    harness.clock.advance(11 * 60 * 1000);
    await list(await harness.userToken());
    expect(harness.jwksFetches).toBe(2);
  });

  it("requires a token", async () => {
    const response = await harness.fetch(new Request(`${RELAY_ORIGIN}/v1/environments`));
    expect(response.status).toBe(401);
  });
});

describe("environment signatures", () => {
  let desktop: EnvironmentIdentity;
  let linked: LinkResponse;

  beforeEach(async () => {
    desktop = await createEnvironment();
    linked = (await (await harness.link(desktop)).json()) as LinkResponse;
  });

  const activity = (options: Parameters<Harness["signedPost"]>[4] = {}, body?: Record<string, unknown>) =>
    harness.signedPost(
      desktop,
      "/v1/activity",
      "environment.activity",
      body ?? { environmentId: desktop.environmentId, sessionId: "session_1", event: "replied" },
      options,
    );

  it("refuses a replayed nonce", async () => {
    const nonce = "fixed-nonce-0123456789abcdef";
    expect((await activity({ signatureOptions: { nonce } })).status).toBe(200);
    const replay = await activity({ signatureOptions: { nonce } });
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe("signature_replayed");
  });

  it("refuses a byte-for-byte replay of a whole request", async () => {
    const body = JSON.stringify({ environmentId: desktop.environmentId, tunnelId: linked.tunnelId, port: 47_831 });
    const { signEnvironmentRequest } = await import("./helpers");
    const signature = await signEnvironmentRequest(desktop, "environment.recovery", body, {}, harness.clock);
    const send = () =>
      harness.fetch(
        new Request(`${RELAY_ORIGIN}/v1/environments/recovery`, {
          method: "POST",
          headers: { "CorosLink-Environment-Signature": signature, "content-type": "application/json" },
          body,
        }),
      );
    expect((await send()).status).toBe(200);
    expect(await errorCode(await send())).toBe("signature_replayed");
  });

  it("refuses an iat outside ±60 s and reports the relay clock", async () => {
    const response = await activity({ signatureOptions: { iat: harness.clock.seconds - 61 } });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; details: { serverTime: number } } };
    expect(body.error.code).toBe("signature_stale");
    expect(body.error.details.serverTime).toBe(harness.clock.seconds);
    expect((await activity({ signatureOptions: { iat: harness.clock.seconds + 59 } })).status).toBe(200);
  });

  it("refuses a signature over a different body", async () => {
    const text = JSON.stringify({ environmentId: desktop.environmentId, sessionId: "session_1", event: "replied" });
    const { signEnvironmentRequest } = await import("./helpers");
    const signature = await signEnvironmentRequest(desktop, "environment.activity", text, {}, harness.clock);
    const response = await harness.fetch(
      new Request(`${RELAY_ORIGIN}/v1/activity`, {
        method: "POST",
        headers: { "CorosLink-Environment-Signature": signature },
        body: JSON.stringify({ environmentId: desktop.environmentId, sessionId: "session_2", event: "approval" }),
      }),
    );
    expect(await errorCode(response)).toBe("invalid_signature");
  });

  it("refuses a signature for another operation or audience", async () => {
    const wrongOp = await harness.signedPost(desktop, "/v1/activity", "environment.recovery", {
      environmentId: desktop.environmentId,
      sessionId: "session_1",
      event: "replied",
    });
    expect(await errorCode(wrongOp)).toBe("invalid_signature");
    expect(await errorCode(await activity({ signatureOptions: { aud: "https://relay-dev.coroslink.com" } }))).toBe(
      "invalid_signature",
    );
  });

  it("refuses a signature by another key presenting this desktop's kid", async () => {
    const response = await activity({ signatureOptions: { signer: await es256KeyPair() } });
    expect(await errorCode(response)).toBe("invalid_signature");
  });

  it("refuses an unknown kid as not linked", async () => {
    const response = await activity({ signatureOptions: { kid: "unknown-kid" } });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("environment_not_linked");
  });

  it("refuses bodies over 16 KiB", async () => {
    const response = await activity({}, {
      environmentId: desktop.environmentId,
      sessionId: "session_1",
      event: "replied",
      padding: "x".repeat(17 * 1024),
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
  });

  it("purges expired nonces in maintenance", async () => {
    await activity();
    harness.clock.advance(10 * 60 * 1000);
    const result = await harness.maintenance();
    expect(result.noncesPurged).toBeGreaterThanOrEqual(1);
  });
});

describe("routing", () => {
  it("answers health, 404 and 405 with JSON errors", async () => {
    const health = await harness.fetch(new Request(`${RELAY_ORIGIN}/health`));
    expect(await health.json()).toMatchObject({ service: "coroslink-relay", protocol: 1, tunnels: true, push: true, cleanupMode: "off" });
    const missing = await harness.fetch(new Request(`${RELAY_ORIGIN}/nope`));
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe("not_found");
    const wrongMethod = await harness.fetch(new Request(`${RELAY_ORIGIN}/v1/environments/link`));
    expect(wrongMethod.status).toBe(405);
  });
});
