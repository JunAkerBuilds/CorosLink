import { beforeEach, describe, expect, it } from "vitest";
import { liveActivityPlan } from "../src/apns";
import type { LiveActivityResponse, RegisterLiveActivityResponse } from "../src/protocol";
import { createEnvironment, errorCode, Harness, RELAY_ORIGIN, type EnvironmentIdentity } from "./helpers";

// ActivityKit push tokens are longer than device tokens.
const ACTIVITY = "a1".repeat(80);
const OTHER_ACTIVITY = "b2".repeat(80);
const TOPIC = "com.akerrules.clink.push-type.liveactivity";

let harness: Harness;
let desktop: EnvironmentIdentity;

beforeEach(async () => {
  harness = await Harness.create();
  desktop = await createEnvironment();
  await harness.link(desktop);
});

async function register(
  input: { token?: string; sessionId?: string; requestId?: string; environmentId?: string; userId?: string; clientId?: string } = {},
) {
  return harness.fetch(
    new Request(`${RELAY_ORIGIN}/v1/live-activities`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await harness.userToken({ sub: input.userId ?? "user_1", clientId: input.clientId ?? "c-link-ios" })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: input.token ?? ACTIVITY,
        environment: "sandbox",
        environmentId: input.environmentId ?? desktop.environmentId,
        sessionId: input.sessionId ?? "session_42",
        requestId: input.requestId ?? "req_1",
      }),
    }),
  );
}

function live(body: Record<string, unknown>) {
  return harness.signedPost(desktop, "/v1/activity/live", "environment.live", {
    environmentId: desktop.environmentId,
    sessionId: "session_42",
    requestId: "req_1",
    ...body,
  });
}

async function liveResult(body: Record<string, unknown>): Promise<LiveActivityResponse> {
  const response = await live(body);
  expect(response.status).toBe(200);
  return (await response.json()) as LiveActivityResponse;
}

async function rows() {
  const { results } = await harness.env.DB.prepare("SELECT token FROM live_activities").all<{ token: string }>();
  return results.map((row) => row.token);
}

describe("live activities", () => {
  it("pushes a turn's phases, then its end, as text-free ActivityKit pushes", async () => {
    expect((await (await register()).json()) as RegisterLiveActivityResponse).toEqual({ registered: true, ended: false });

    expect(await liveResult({ event: "update", phase: "thinking", words: 0 })).toEqual({ sent: 1, failed: 0, removed: 0, skipped: 0 });
    const [first] = harness.apns.sent;
    expect(first?.host).toBe("api.sandbox.push.apple.com");
    expect(first?.token).toBe(ACTIVITY);
    expect(first?.headers).toMatchObject({ "apns-topic": TOPIC, "apns-push-type": "liveactivity", "apns-priority": "10" });
    expect(first?.body).toEqual({
      aps: {
        timestamp: harness.clock.seconds,
        event: "update",
        "content-state": { phase: "thinking", words: 0 },
        "stale-date": harness.clock.seconds + 20 * 60,
      },
    });

    // A phase change inside the minute goes at priority 5.
    harness.clock.advance(6_000);
    await liveResult({ event: "update", phase: "usingTool", words: 0 });
    expect(harness.apns.sent[1]?.headers["apns-priority"]).toBe("5");

    // Within five seconds of the last push: held back.
    harness.clock.advance(2_000);
    expect(await liveResult({ event: "update", phase: "writing", words: 4 })).toMatchObject({ sent: 0, skipped: 1 });

    // A minute after the last priority 10 push, a phase change gets 10 again; word counts stay at 5.
    harness.clock.advance(60_000);
    await liveResult({ event: "update", phase: "writing", words: 120 });
    expect(harness.apns.sent[2]?.headers["apns-priority"]).toBe("10");
    harness.clock.advance(30_000);
    await liveResult({ event: "update", phase: "writing", words: 300 });
    expect(harness.apns.sent[3]?.headers["apns-priority"]).toBe("5");
    expect(harness.apns.sent[3]?.body).toMatchObject({ aps: { "content-state": { phase: "writing", words: 300 } } });

    // The end always goes, at once and at 10, and the registration goes with it.
    harness.clock.advance(1_000);
    expect(await liveResult({ event: "end", phase: "replied", words: 320 })).toEqual({ sent: 1, failed: 0, removed: 0, skipped: 0 });
    const end = harness.apns.sent[4];
    expect(end?.headers["apns-priority"]).toBe("10");
    expect(end?.body).toEqual({
      aps: {
        timestamp: harness.clock.seconds,
        event: "end",
        "content-state": { phase: "replied", words: 320 },
        "dismissal-date": harness.clock.seconds + 15 * 60,
      },
    });
    expect(await rows()).toEqual([]);
    expect(await liveResult({ event: "update", phase: "writing", words: 330 })).toMatchObject({ sent: 0 });

    const timestamps = harness.apns.sent.map((sent) => (sent.body as { aps: { timestamp: number } }).aps.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("never forwards anything but the phase and the word count", async () => {
    await register();
    await liveResult({ event: "update", phase: "usingTool", words: 0, tool: "get_secret_knee_scan", text: "A secret answer" });
    const [sent] = harness.apns.sent;
    expect(sent?.body).toEqual({ aps: expect.objectContaining({ "content-state": { phase: "usingTool", words: 0 } }) });
    expect(JSON.stringify(sent?.body)).not.toMatch(/secret/i);
  });

  it("only reaches activities following that turn on that account", async () => {
    const stranger = await createEnvironment();
    await harness.link(stranger, { userId: "user_2" });
    await register();
    await register({ token: OTHER_ACTIVITY, requestId: "req_0" });
    await register({ token: "c3".repeat(80), sessionId: "session_7" });
    expect(await errorCode(await register({ token: "d4".repeat(80), environmentId: stranger.environmentId }))).toBe(
      "environment_not_linked",
    );

    expect(await liveResult({ event: "update", phase: "thinking", words: 0 })).toMatchObject({ sent: 1 });
    expect(harness.apns.sent.map((sent) => sent.token)).toEqual([ACTIVITY]);

    // Another account's computer reports the same ids: nothing reaches this account's activities.
    const foreign = await harness.signedPost(stranger, "/v1/activity/live", "environment.live", {
      environmentId: stranger.environmentId,
      sessionId: "session_42",
      requestId: "req_1",
      event: "end",
      phase: "failed",
      words: 0,
    });
    expect(((await foreign.json()) as LiveActivityResponse).sent).toBe(0);
    expect(harness.apns.sent).toHaveLength(1);
  });

  it("ends an activity that registers after its turn ended", async () => {
    expect(await liveResult({ event: "end", phase: "needsYou", words: 80 })).toEqual({ sent: 0, failed: 0, removed: 0, skipped: 0 });
    harness.clock.advance(3_000);
    expect((await (await register()).json()) as RegisterLiveActivityResponse).toEqual({ registered: true, ended: true });
    expect(harness.apns.sent[0]?.body).toMatchObject({
      aps: { event: "end", "content-state": { phase: "needsYou", words: 80 } },
    });
    expect(await rows()).toEqual([]);

    // Another turn of the session is still followed normally.
    expect((await (await register({ token: OTHER_ACTIVITY, requestId: "req_2" })).json()) as RegisterLiveActivityResponse).toEqual({
      registered: true,
      ended: false,
    });
    // An hour later the end is forgotten.
    harness.clock.advance(61 * 60 * 1000);
    expect(((await (await register()).json()) as RegisterLiveActivityResponse).ended).toBe(false);
  });

  it("drops dead tokens and keeps tokens on transient failures", async () => {
    await register();
    await register({ token: OTHER_ACTIVITY });
    harness.apns.respond(ACTIVITY, { status: 410, reason: "Unregistered" });
    harness.apns.respond(OTHER_ACTIVITY, { status: 503, reason: "ServiceUnavailable" });
    expect(await liveResult({ event: "update", phase: "thinking", words: 0 })).toEqual({ sent: 0, failed: 1, removed: 1, skipped: 0 });
    expect(await rows()).toEqual([OTHER_ACTIVITY]);
    // A failed push doesn't count against the throttle.
    harness.clock.advance(1_000);
    expect(await liveResult({ event: "update", phase: "thinking", words: 0 })).toMatchObject({ sent: 1, skipped: 0 });
  });

  it("forgets a token ActivityKit replaced", async () => {
    await register();
    const response = await harness.fetch(
      new Request(`${RELAY_ORIGIN}/v1/live-activities`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${await harness.userToken({ clientId: "c-link-ios" })}` },
        body: JSON.stringify({ token: ACTIVITY }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it("validates registrations and reports", async () => {
    expect((await register({ token: "not-hex" })).status).toBe(400);
    expect((await register({ requestId: "has spaces" })).status).toBe(400);
    expect(await errorCode(await register({ clientId: "coroslink-desktop" }))).toBe("client_not_allowed");
    expect((await live({ event: "update", phase: "replied", words: 0 })).status).toBe(400);
    expect((await live({ event: "end", phase: "writing", words: 0 })).status).toBe(400);
    expect((await live({ event: "update", phase: "writing", words: -1 })).status).toBe(400);
    expect((await live({ event: "update", phase: "writing", words: 1.5 })).status).toBe(400);
    expect((await live({ event: "update", phase: "writing", words: "12" })).status).toBe(400);
    // Signed for the alert endpoint: refused here.
    const wrongOp = await harness.signedPost(desktop, "/v1/activity/live", "environment.activity", {
      environmentId: desktop.environmentId,
      sessionId: "session_42",
      requestId: "req_1",
      event: "update",
      phase: "thinking",
      words: 0,
    });
    expect(await errorCode(wrongOp)).toBe("invalid_signature");
  });

  it("purges expired registrations and old turn ends", async () => {
    await register();
    await liveResult({ event: "end", phase: "failed", words: 0 });
    await register({ token: OTHER_ACTIVITY, requestId: "req_2" });
    harness.clock.advance(8 * 60 * 60 * 1000);
    expect((await harness.maintenance()).liveActivitiesPurged).toBe(2);
    expect(await rows()).toEqual([]);
  });

  it("answers not_configured without APNs credentials", async () => {
    harness = await Harness.create({ APNS_PRIVATE_KEY: "" });
    desktop = await createEnvironment();
    await harness.link(desktop);
    expect(await errorCode(await live({ event: "update", phase: "thinking", words: 0 }))).toBe("not_configured");
  });
});

describe("the push budget", () => {
  const fresh = { last_phase: null, last_sent_at: null, last_high_priority_at: null, last_timestamp: null };

  it("sends the first update at 10 and keeps timestamps increasing", () => {
    expect(liveActivityPlan(fresh, { event: "update", phase: "thinking", words: 0 }, 1_000_000)).toEqual({
      send: true,
      priority: 10,
      timestamp: 1_000,
    });
    // Two pushes in one second still get increasing timestamps.
    const history = { last_phase: "thinking", last_sent_at: 1_000_000, last_high_priority_at: 1_000_000, last_timestamp: 1_000 };
    expect(liveActivityPlan(history, { event: "end", phase: "replied", words: 0 }, 1_000_400)).toEqual({
      send: true,
      priority: 10,
      timestamp: 1_001,
    });
  });
});
