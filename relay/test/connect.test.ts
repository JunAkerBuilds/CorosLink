import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/env";
import type { ConnectResponse, LinkResponse } from "../src/protocol";
import { relayJwks } from "../src/relayKey";
import {
  createEnvironment,
  dpopProof,
  errorCode,
  es256KeyPair,
  Harness,
  honestDesktop,
  RELAY_ORIGIN,
  thumbprint,
  type EnvironmentIdentity,
  type KeyPair,
} from "./helpers";

let harness: Harness;
let desktop: EnvironmentIdentity;
let linked: LinkResponse;
let phoneKey: KeyPair;
let relayPublicJwk: import("jose").JWK;

beforeEach(async () => {
  harness = await Harness.create();
  desktop = await createEnvironment();
  linked = (await (await harness.link(desktop)).json()) as LinkResponse;
  phoneKey = await es256KeyPair();
  relayPublicJwk = (await relayJwks(loadConfig(harness.env))).keys[0] as import("jose").JWK;
  harness.desktops.set(linked.hostname, honestDesktop(desktop, relayPublicJwk, harness.clock));
});

async function connect(
  options: {
    environmentId?: string;
    token?: string;
    proof?: string | null;
    proofInput?: Partial<Parameters<typeof dpopProof>[1]>;
    key?: KeyPair;
  } = {},
) {
  const environmentId = options.environmentId ?? desktop.environmentId;
  const token = options.token ?? (await harness.userToken({ clientId: "c-link-ios" }));
  const htu = `${RELAY_ORIGIN}/v1/environments/${environmentId}/connect`;
  const proof =
    options.proof === undefined
      ? await dpopProof(options.key ?? phoneKey, { htm: "POST", htu, accessToken: token, iat: harness.clock.seconds, ...options.proofInput })
      : options.proof;
  return harness.fetch(
    new Request(htu, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...(proof ? { DPoP: proof } : {}) },
    }),
  );
}

describe("POST /v1/environments/:id/connect", () => {
  it("asks the desktop to mint a credential bound to the phone key and returns it", async () => {
    const seen: string[] = [];
    harness.desktops.set(linked.hostname, honestDesktop(desktop, relayPublicJwk, harness.clock, { seen }));
    const log = vi.spyOn(console, "log");
    const response = await connect();
    expect(response.status).toBe(200);
    const body = (await response.json()) as ConnectResponse;
    expect(body).toMatchObject({ environmentId: desktop.environmentId, hostname: linked.hostname, httpBaseUrl: `https://${linked.hostname}` });
    expect(body.credential).toMatch(/^cred-/u);
    expect(seen).toHaveLength(1);

    const mint = harness.calls.find((call) => call.url === `https://${linked.hostname}/v1/relay/mint`);
    expect(mint).toMatchObject({ method: "POST", redirect: "manual" });
    // The credential never reaches logs or the database.
    expect(log.mock.calls.flat().join("\n")).not.toContain(body.credential);
    const dump = await harness.env.DB.prepare("SELECT * FROM nonces").all();
    expect(JSON.stringify(dump.results)).not.toContain(body.credential);
    log.mockRestore();
  });

  it("returns the key thumbprint the mint answer was verified with", async () => {
    const body = (await (await connect()).json()) as ConnectResponse;
    expect(body.keyThumbprint).toBe(desktop.kid);
  });

  it("hands nothing over when the computer is unlinked while it mints", async () => {
    const honest = honestDesktop(desktop, relayPublicJwk, harness.clock);
    harness.desktops.set(linked.hostname, async (request) => {
      await harness.env.DB.prepare("UPDATE environment_links SET revoked_at = 1").run();
      return honest(request);
    });
    const response = await connect();
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("environment_not_linked");
  });

  it("binds the mint request to the DPoP key thumbprint", async () => {
    let requestedJkt = "";
    const honest = honestDesktop(desktop, relayPublicJwk, harness.clock, {
      tamper: (response) => {
        requestedJkt = String(response.proof.jkt);
      },
    });
    harness.desktops.set(linked.hostname, honest);
    expect((await connect()).status).toBe(200);
    expect(requestedJkt).toBe(await thumbprint(phoneKey));
  });

  it.each([
    ["a tampered credential", (r: { credential: string }) => void (r.credential = `${r.credential}x`)],
    ["the wrong jkt", (r: { proof: Record<string, unknown> }) => void (r.proof.jkt = "someone-elses-key")],
    ["the wrong nonce", (r: { proof: Record<string, unknown> }) => void (r.proof.nonce = "replayed-nonce-0000000000")],
    ["a different environment id", (r: { proof: Record<string, unknown> }) => void (r.proof.environmentId = "env_other_0001")],
    ["a mismatched expiry", (r: { proof: Record<string, unknown> }) => void (r.proof.exp = Number(r.proof.exp) + 60)],
    ["a stale proof", (r: { proof: Record<string, unknown> }) => void (r.proof.iat = Number(r.proof.iat) - 600)],
  ])("refuses a response with %s", async (_label, tamper) => {
    harness.desktops.set(
      linked.hostname,
      honestDesktop(desktop, relayPublicJwk, harness.clock, { tamper: tamper as never }),
    );
    const response = await connect();
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("environment_response_invalid");
  });

  it("refuses a response signed by another key behind the tunnel", async () => {
    harness.desktops.set(
      linked.hostname,
      honestDesktop(desktop, relayPublicJwk, harness.clock, { signer: await es256KeyPair() }),
    );
    const response = await connect();
    expect(await errorCode(response)).toBe("environment_response_invalid");
  });

  it("refuses an oversized response without buffering it", async () => {
    harness.desktops.set(linked.hostname, async () => new Response("x".repeat(70 * 1024), { status: 200 }));
    expect(await errorCode(await connect())).toBe("environment_response_invalid");
  });

  it("refuses redirects instead of following them", async () => {
    harness.desktops.set(linked.hostname, async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/v1/relay/mint" } }),
    );
    const response = await connect();
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("environment_redirect_refused");
    expect(harness.calls.some((call) => call.url.startsWith("https://evil.example"))).toBe(false);
  });

  it("reports a desktop that refuses or is offline", async () => {
    harness.desktops.set(linked.hostname, async () => new Response("{}", { status: 401 }));
    expect(await errorCode(await connect())).toBe("environment_refused");
    harness.desktops.delete(linked.hostname);
    expect(await errorCode(await connect())).toBe("environment_unreachable");
    harness.desktops.set(linked.hostname, async () => new Response("<html>1033</html>", { status: 530 }));
    expect(await errorCode(await connect())).toBe("environment_unreachable");
  });

  it("needs an active link for this user", async () => {
    const otherUser = await connect({ token: await harness.userToken({ sub: "user_2", clientId: "c-link-ios" }) });
    expect(otherUser.status).toBe(404);
    expect(await errorCode(otherUser)).toBe("environment_not_linked");
  });

  it("needs a ready allocation", async () => {
    await harness.env.DB.prepare("UPDATE allocations SET status = 'released', tunnel_id = NULL").run();
    expect(await errorCode(await connect())).toBe("environment_not_ready");
  });

  it("is for the phone app only", async () => {
    const response = await connect({ token: await harness.userToken({ clientId: "coroslink-desktop" }) });
    expect(response.status).toBe(403);
  });

  describe("DPoP proof", () => {
    it("is required", async () => {
      expect(await errorCode(await connect({ proof: null }))).toBe("invalid_signature");
    });

    it("must name this request's method and URL", async () => {
      expect(await errorCode(await connect({ proofInput: { htm: "GET" } }))).toBe("invalid_signature");
      expect(
        await errorCode(await connect({ proofInput: { htu: `${RELAY_ORIGIN}/v1/environments/env_other_0001/connect` } })),
      ).toBe("invalid_signature");
    });

    it("must be bound to the presented token", async () => {
      expect(await errorCode(await connect({ proofInput: { ath: "not-the-token-hash" } }))).toBe("invalid_signature");
    });

    it("must be fresh", async () => {
      expect(await errorCode(await connect({ proofInput: { iat: harness.clock.seconds - 120 } }))).toBe("signature_stale");
    });

    it("cannot be replayed", async () => {
      const token = await harness.userToken({ clientId: "c-link-ios" });
      const proof = await dpopProof(phoneKey, {
        htm: "POST",
        htu: `${RELAY_ORIGIN}/v1/environments/${desktop.environmentId}/connect`,
        accessToken: token,
        iat: harness.clock.seconds,
      });
      expect((await connect({ token, proof })).status).toBe(200);
      const replay = await connect({ token, proof });
      expect(replay.status).toBe(401);
      expect(await errorCode(replay)).toBe("signature_replayed");
    });
  });
});

describe("GET /.well-known/jwks.json", () => {
  it("publishes the relay's public signing key only", async () => {
    const response = await harness.fetch(new Request(`${RELAY_ORIGIN}/.well-known/jwks.json`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toEqual([
      { kty: "EC", crv: "P-256", x: harness.relayKey.publicJwk.x, y: harness.relayKey.publicJwk.y, kid: "relay-test-1", alg: "ES256", use: "sig" },
    ]);
  });

  it("adds extra keys for rotation", async () => {
    const next = await es256KeyPair();
    harness = await Harness.create({
      RELAY_EXTRA_JWKS: JSON.stringify([{ ...next.publicJwk, kid: "relay-test-2" }, { kty: "EC", crv: "P-256", d: "secret", kid: "bad" }]),
    });
    const body = (await (await harness.fetch(new Request(`${RELAY_ORIGIN}/.well-known/jwks.json`))).json()) as {
      keys: Array<{ kid: string }>;
    };
    expect(body.keys.map((key) => key.kid)).toEqual(["relay-test-1", "relay-test-2"]);
  });
});
