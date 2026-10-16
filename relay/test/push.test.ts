import { decodeJwt, decodeProtectedHeader } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityResponse } from "../src/protocol";
import { createEnvironment, errorCode, Harness, RELAY_ORIGIN, type EnvironmentIdentity } from "./helpers";

const PHONE_TOKEN = "a".repeat(64);
const IPAD_TOKEN = "b".repeat(64);

let harness: Harness;
let desktop: EnvironmentIdentity;

beforeEach(async () => {
  harness = await Harness.create();
  desktop = await createEnvironment();
  await harness.link(desktop);
});

async function register(token: string, environment: "sandbox" | "production", userId = "user_1") {
  return harness.fetch(
    new Request(`${RELAY_ORIGIN}/v1/devices`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await harness.userToken({ sub: userId, clientId: "c-link-ios" })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token, environment }),
    }),
  );
}

function activity(event: "replied" | "approval" = "replied", sessionId = "session_42") {
  return harness.signedPost(desktop, "/v1/activity", "environment.activity", {
    environmentId: desktop.environmentId,
    sessionId,
    event,
  });
}

describe("push", () => {
  it("registers devices and sends text-free Coach alerts to the linked user's devices", async () => {
    expect((await register(PHONE_TOKEN, "production")).status).toBe(200);
    expect((await register(IPAD_TOKEN, "sandbox")).status).toBe(200);
    await register("c".repeat(64), "production", "user_2");

    const response = await activity("approval");
    expect(response.status).toBe(200);
    expect((await response.json()) as ActivityResponse).toEqual({ sent: 2, failed: 0, removed: 0 });

    const hosts = Object.fromEntries(harness.apns.sent.map((sent) => [sent.token, sent.host]));
    expect(hosts).toEqual({ [PHONE_TOKEN]: "api.push.apple.com", [IPAD_TOKEN]: "api.sandbox.push.apple.com" });
    const [first] = harness.apns.sent;
    expect(first?.headers).toMatchObject({
      "apns-topic": "com.akerrules.clink",
      "apns-push-type": "alert",
      "apns-priority": "10",
    });
    expect(first?.body).toEqual({
      aps: { alert: { title: "Coach", body: "Coach needs your approval" }, sound: "default", "thread-id": "coach:session_42" },
      kind: "coach",
      sessionId: "session_42",
      environmentId: desktop.environmentId,
      event: "approval",
    });

    const bearer = first!.headers.authorization!.replace("bearer ", "");
    expect(decodeProtectedHeader(bearer)).toEqual({ alg: "ES256", kid: "APNSKEY123" });
    expect(decodeJwt(bearer)).toEqual({ iss: "TEAM123456", iat: harness.clock.seconds });
  });

  it("reuses the provider token for about 50 minutes", async () => {
    await register(PHONE_TOKEN, "production");
    await activity();
    harness.clock.advance(49 * 60 * 1000);
    await activity();
    harness.clock.advance(2 * 60 * 1000);
    await activity();
    const tokens = harness.apns.sent.map((sent) => sent.headers.authorization);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[2]).not.toBe(tokens[1]);
  });

  it("deletes tokens APNs reports as unregistered", async () => {
    await register(PHONE_TOKEN, "production");
    await register(IPAD_TOKEN, "production");
    harness.apns.respond(PHONE_TOKEN, { status: 410, reason: "Unregistered" });
    const body = (await (await activity()).json()) as ActivityResponse;
    expect(body).toEqual({ sent: 1, failed: 0, removed: 1 });
    const { results } = await harness.env.DB.prepare("SELECT token FROM push_devices").all<{ token: string }>();
    expect(results.map((row) => row.token)).toEqual([IPAD_TOKEN]);
  });

  it("keeps tokens on transient failures and retries once on an expired provider token", async () => {
    await register(PHONE_TOKEN, "production");
    harness.apns.respond(PHONE_TOKEN, { status: 503, reason: "ServiceUnavailable" });
    expect((await (await activity()).json()) as ActivityResponse).toEqual({ sent: 0, failed: 1, removed: 0 });
    harness.apns.respond(PHONE_TOKEN, { status: 403, reason: "ExpiredProviderToken" });
    expect((await (await activity()).json()) as ActivityResponse).toEqual({ sent: 1, failed: 0, removed: 0 });
  });

  it("moves a token to the account that registered it last", async () => {
    await register(PHONE_TOKEN, "production", "user_2");
    await register(PHONE_TOKEN, "production", "user_1");
    expect((await (await activity()).json()) as ActivityResponse).toMatchObject({ sent: 1 });
  });

  it("unregisters a device", async () => {
    await register(PHONE_TOKEN, "production");
    const response = await harness.fetch(
      new Request(`${RELAY_ORIGIN}/v1/devices`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${await harness.userToken({ clientId: "c-link-ios" })}` },
        body: JSON.stringify({ token: PHONE_TOKEN }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await (await activity()).json()) as ActivityResponse).toEqual({ sent: 0, failed: 0, removed: 0 });
  });

  it("validates registrations and events", async () => {
    expect((await register("not-a-token", "production")).status).toBe(400);
    expect((await register(PHONE_TOKEN, "staging" as "production")).status).toBe(400);
    const badEvent = await harness.signedPost(desktop, "/v1/activity", "environment.activity", {
      environmentId: desktop.environmentId,
      sessionId: "session_1",
      event: "message: here is your plan",
    });
    expect(badEvent.status).toBe(400);
  });

  it("answers not_configured without APNs credentials", async () => {
    harness = await Harness.create({ APNS_PRIVATE_KEY: "" });
    desktop = await createEnvironment();
    await harness.link(desktop);
    expect(await errorCode(await activity())).toBe("not_configured");
  });
});
