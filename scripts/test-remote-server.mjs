import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  createDeviceKey,
  createFakeSecretBox,
  createHub,
  createProof,
  createRemoteDatabase,
  createSettings,
  jose,
  request,
  requireDist,
  sha256,
  tick,
  waitFor
} from "./remote-test-support.mjs";

// electron/remote/server.ts on an ephemeral port, with real WebSocket clients,
// a Coach hub driven by a fake provider, and the remote_* tables in an
// in-memory database. Modelled on test-watchface-automation-server.mjs.
// Run under Electron as Node (npm run test:remote).
const { RemoteServer, remoteLanAddresses, isTailscaleIPv4, planUploadOptions } = requireDist("./remote/server.js");
const { RemoteAuth } = requireDist("./remote/auth.js");
const { loadOrCreateRemoteIdentity } = requireDist("./remote/identity.js");
const { SAVED_COACH_EVENTS, applyCoachEvent, coachStateFromSnapshot } = requireDist("./remote/contract.js");
const { createCoachAttachmentStore } = requireDist("./coachAttachments.js");

const LAN = "192.168.77.5";
const TUNNEL = "env-test.tunnel.example";
const identity = loadOrCreateRemoteIdentity(createSettings(), createFakeSecretBox());
const db = createRemoteDatabase();
const auth = new RemoteAuth({ database: () => db });
const { hub, stream } = createHub();
let chatSettings = {
  provider: "claude-code",
  chatgpt: {},
  claudeCode: { model: "opus" },
  geminiCli: { model: "flash" },
  antigravity: {},
  openRouter: { model: "openrouter/auto" },
  local: { model: "llama3" }
};
let relayTrust = null;
const attachmentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remote-attachments-"));
const attachmentStore = createCoachAttachmentStore(attachmentRoot);
const portChanges = [];
let connectionChanges = 0;
// Training Hub's calendar for training.scheduledSteps: a run/walk in miles (paces COROS MCP drops)
// and a workout with a threshold-percentage step, which has no exact steps to give.
const mile = (seconds) => Math.round((seconds / 1.609344) * 1000);
const scheduleAsked = [];
const scheduledPrograms = async (startDay, endDay) => {
  scheduleAsked.push([startDay, endDay]);
  return [
    {
      happenDay: "20261029", idInPlan: "7", planId: "481333460374569066",
      program: {
        sportType: 1,
        exercises: [
          { id: "1", exerciseType: 1, targetType: 2, targetValue: 300, intensityType: 0, groupId: "0" },
          { id: "2", exerciseType: 2, isGroup: true, sets: 8, groupId: "0" },
          { id: "3", exerciseType: 2, targetType: 2, targetValue: 120, intensityType: 3, intensityValue: mile(570), intensityValueExtend: mile(600), intensityMultiplier: 1000, groupId: "2" },
          { id: "4", exerciseType: 4, targetType: 2, targetValue: 60, intensityType: 0, groupId: "2" },
          { id: "5", exerciseType: 3, targetType: 5, targetValue: 160934, intensityType: 2, intensityValue: 120, intensityValueExtend: 135, groupId: "0" }
        ]
      }
    },
    {
      happenDay: "20261031", idInPlan: "8",
      program: { sportType: 1, exercises: [{ id: "1", exerciseType: 2, targetType: 5, targetValue: 500000, intensityType: 3, isIntensityPercent: true, intensityPercent: 95000, groupId: "0" }] }
    },
    { happenDay: "20261101", idInPlan: "9", program: { sportType: 4, overview: "  Pull day: rows, pull-ups and curls.  ", exercises: [{ id: "1", exerciseType: 2, targetType: 3, targetValue: 10 }] } },
    // A pool swim by stroke, a gym session by exercise and weight, and a ride by % of FTP and speed.
    {
      happenDay: "20261102", idInPlan: "11",
      program: {
        sportType: 3,
        exercises: [
          { id: "1", exerciseType: 1, targetType: 5, targetValue: 20000, intensityType: 5, intensityValue: 1, groupId: "0" },
          { id: "2", exerciseType: 2, isGroup: true, sets: 4, groupId: "0" },
          { id: "3", exerciseType: 2, targetType: 5, targetValue: 10000, intensityType: 5, intensityValue: 2, groupId: "2" },
          { id: "4", exerciseType: 4, targetType: 2, targetValue: 20, groupId: "2" },
          { id: "5", exerciseType: 3, targetType: 5, targetValue: 10000, intensityType: 0, groupId: "0" }
        ]
      }
    },
    {
      happenDay: "20261103", idInPlan: "12",
      program: {
        sportType: 4,
        exercises: [
          { id: "1", exerciseType: 2, isGroup: true, sets: 3, groupId: "0" },
          { id: "2", name: "T1061", overview: "sid_strength_squats", exerciseType: 2, targetType: 3, targetValue: 10, intensityType: 1, intensityValue: 20, intensityValueExtend: 20, intensityDisplayUnit: 6, groupId: "1" },
          { id: "3", name: "T1100", overview: "sid_strength_push_ups", exerciseType: 2, targetType: 3, targetValue: 15, intensityType: 1, intensityCustom: 1, groupId: "1" },
          { id: "4", exerciseType: 4, targetType: 2, targetValue: 90, groupId: "1" }
        ]
      }
    },
    {
      happenDay: "20261104", idInPlan: "13",
      program: {
        sportType: 2,
        exercises: [
          { id: "1", exerciseType: 2, targetType: 2, targetValue: 1200, intensityType: 9, isIntensityPercent: true, intensityCustom: 3, intensityPercent: 88000, intensityPercentExtend: 94000, groupId: "0" },
          { id: "2", exerciseType: 3, targetType: 2, targetValue: 600, intensityType: 4, intensityValue: 2500, intensityValueExtend: 3000, groupId: "0" }
        ]
      }
    },
    // Runna's "Tempo 2-1" as Training Hub keeps it: each step's pace in its name, the pace target 0.
    {
      happenDay: "20261028", idInPlan: "10",
      program: {
        sportType: 1,
        overview: "sid_run_training",
        exercises: [
          { id: "1", name: "1.5km warm up", exerciseType: 1, targetType: 5, targetValue: 150000, intensityType: 0, groupId: "0" },
          { id: "2", name: "2km at 5:10/km", exerciseType: 2, targetType: 5, targetValue: 200000, intensityType: 3, intensityValue: 0, intensityValueExtend: 0, groupId: "0" },
          { id: "3", name: "120s rest", exerciseType: 4, targetType: 2, targetValue: 120, groupId: "0" },
          { id: "4", name: "Training", exerciseType: 2, targetType: 5, targetValue: 100000, intensityType: 3, intensityValue: 285, intensityValueExtend: 305, groupId: "0" },
          { id: "5", name: "sid_run_cool_down_dist", exerciseType: 3, targetType: 5, targetValue: 50000, groupId: "0" }
        ]
      }
    }
  ];
};

const server = new RemoteServer({
  identity,
  auth,
  hub,
  descriptor: () => ({ name: "Test Mac", appVersion: "9.9.9", platform: "darwin" }),
  defaultProvider: () => "claude-code",
  chatSettings: () => chatSettings,
  saveChatSettings: (settings) => (chatSettings = settings),
  attachments: {
    save: (sessionId, upload) => attachmentStore.save(sessionId, upload),
    get: (sessionId, id) => attachmentStore.summary(sessionId, id)
  },
  scheduledPrograms,
  chatModels: async (provider) => (provider === "claude-code" ? [{ value: "", label: "Account default" }, { value: "opus", label: "Claude Opus 5.5" }] : []),
  port: 0,
  onPortChanged: (port) => portChanges.push(port),
  lanAddresses: () => [LAN],
  tunnelHostname: () => TUNNEL,
  relayTrust: () => relayTrust,
  onConnectionsChanged: () => {
    connectionChanges += 1;
  },
  pingIntervalMs: 60_000
});
await server.start();
const port = server.port;
assert.ok(port > 0);
const base = `http://127.0.0.1:${port}`;

// Each block gets its own rate-limit bucket (the forwarded address counts only from loopback).
let clientIp = 0;
const nextClient = () => ({ "CF-Connecting-IP": `198.51.100.${++clientIp}` });

try {
  // ----- Descriptor and the Host allowlist -----
  {
    const descriptor = await request(port, { path: "/v1/descriptor" });
    assert.equal(descriptor.status, 200);
    assert.deepEqual(descriptor.json, {
      environmentId: identity.environmentId,
      name: "Test Mac",
      platform: "darwin",
      appVersion: "9.9.9",
      protocol: 1,
      capabilities: ["coach", "coach.planOptions", "coach.files", "training.steps"],
      keyThumbprint: identity.kid
    });
    assert.equal(identity.kid, await jose.calculateJwkThumbprint(identity.publicJwk, "sha256"), "RFC 7638 thumbprint");
    assert.equal(descriptor.headers["cache-control"], "no-store");
    assert.equal((await request(port, { path: "/v1/descriptor", headers: { Host: `localhost:${port}` } })).status, 200);

    const refused = async (headers, label) => {
      const response = await request(port, { path: "/v1/descriptor", headers });
      assert.equal(response.status, 403, label);
      assert.equal(response.json.error.code, "host_not_allowed", label);
    };
    await refused({ Host: "attacker.example" }, "a rebinding Host");
    await refused({ Host: `attacker.example:${port}` }, "a rebinding Host with the port");
    await refused({ Host: `127.0.0.1:${port + 1}` }, "another port");
    await refused({ Host: `${LAN}:${port}` }, "a LAN address with Network access off");
    await refused({ Origin: "https://attacker.example" }, "a web page");
    assert.equal(
      (await request(port, { path: "/v1/descriptor", headers: { Origin: `http://127.0.0.1:${port}` } })).status,
      200,
      "a same-origin Origin is fine"
    );
    // cloudflared forwards the tunnel hostname from loopback.
    assert.equal((await request(port, { path: "/v1/descriptor", headers: { Host: TUNNEL } })).status, 200);
    await refused({ Host: `${TUNNEL}:8443` }, "the tunnel hostname on another port");

    await server.setNetworkAccess(true);
    assert.equal(server.port, port, "rebinding keeps the port");
    assert.equal((await request(port, { path: "/v1/descriptor", headers: { Host: `${LAN}:${port}` } })).status, 200);
    await refused({ Host: `192.168.77.6:${port}` }, "an address this computer doesn't have");

    const wrongVersion = await request(port, { path: "/v2/descriptor" });
    assert.equal(wrongVersion.status, 426);
    assert.equal(wrongVersion.json.error.code, "incompatible");
    assert.equal((await request(port, { path: "/v1/nothing" })).status, 404);
    const wrongMethod = await request(port, { method: "POST", path: "/v1/descriptor", body: {} });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.allow, "GET, HEAD");
    assert.equal((await request(port, { path: "/v1/ws" })).status, 400, "the socket path wants an upgrade");
  }

  // ----- Pairing over HTTP -----
  const pair = async (key, { label = "Test iPhone", permissions, viewOnly = false, host, proto, headers = nextClient() } = {}) => {
    const code = auth.createPairing(viewOnly ? ["coach:read"] : undefined);
    const hostHeader = host ?? `127.0.0.1:${port}`;
    const url = `${proto ?? "http"}://${hostHeader}/v1/auth/pair`;
    return request(port, {
      method: "POST",
      path: "/v1/auth/pair",
      headers: {
        Host: hostHeader,
        DPoP: await createProof(key, { url }),
        ...(proto ? { "X-Forwarded-Proto": proto } : {}),
        ...headers
      },
      body: { secret: code.secret, label, ...(permissions ? { permissions } : {}) }
    });
  };
  const authed = async (key, token, { method = "POST", path, body = method === "POST" ? {} : undefined, host = `127.0.0.1:${port}`, headers = {} }) =>
    request(port, {
      method,
      path,
      headers: {
        Host: host,
        Authorization: `DPoP ${token}`,
        DPoP: await createProof(key, { method, url: `http://${host}${path}`, token }),
        ...headers
      },
      body
    });
  const ticketFor = async (key, token) => {
    const response = await authed(key, token, { path: "/v1/auth/ws-ticket" });
    assert.equal(response.status, 200, response.text);
    return response.json.ticket;
  };

  const phoneA = await createDeviceKey();
  const phoneB = await createDeviceKey();
  const viewer = await createDeviceKey();

  const paired = await pair(phoneA, { label: "Phone A" });
  assert.equal(paired.status, 200, paired.text);
  assert.match(paired.json.sessionToken, /^rcs_/);
  assert.deepEqual(paired.json.permissions, ["coach:read", "coach:operate", "coach:approve"]);
  assert.ok(Date.parse(paired.json.expiresAt) > Date.now());
  const tokenA = paired.json.sessionToken;
  const tokenB = (await pair(phoneB, { label: "Phone B", host: `${LAN}:${port}` })).json.sessionToken;
  assert.ok(tokenB, "pairs on a LAN address");
  const tokenViewer = (await pair(viewer, { label: "Viewer", viewOnly: true })).json.sessionToken;

  {
    // Through the tunnel, the proof names https and the tunnel host.
    const tunnelPhone = await createDeviceKey();
    const viaTunnel = await pair(tunnelPhone, { host: TUNNEL, proto: "https" });
    assert.equal(viaTunnel.status, 200, viaTunnel.text);
    // A proof for http when cloudflared says https doesn't match.
    const code = auth.createPairing();
    const mismatch = await request(port, {
      method: "POST",
      path: "/v1/auth/pair",
      headers: {
        Host: TUNNEL,
        "X-Forwarded-Proto": "https",
        DPoP: await createProof(tunnelPhone, { url: `http://${TUNNEL}/v1/auth/pair` }),
        ...nextClient()
      },
      body: { secret: code.secret, label: "x" }
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.json.error.code, "invalid_dpop_proof");
    // A used secret is a 401, which C-LINK reads as "this code expired".
    const usedCode = auth.createPairing();
    const usedHeaders = nextClient();
    const firstUse = await request(port, {
      method: "POST",
      path: "/v1/auth/pair",
      headers: { DPoP: await createProof(tunnelPhone, { url: `${base}/v1/auth/pair` }), ...usedHeaders },
      body: { secret: usedCode.secret, label: "x" }
    });
    assert.equal(firstUse.status, 200);
    const secondUse = await request(port, {
      method: "POST",
      path: "/v1/auth/pair",
      headers: { DPoP: await createProof(tunnelPhone, { url: `${base}/v1/auth/pair` }), ...usedHeaders },
      body: { secret: usedCode.secret, label: "x" }
    });
    assert.equal(secondUse.status, 401);
    assert.equal(secondUse.json.error.code, "invalid_grant");
    // No proof at all.
    const noProof = await request(port, { method: "POST", path: "/v1/auth/pair", headers: nextClient(), body: { secret: auth.createPairing().secret } });
    assert.equal(noProof.status, 400);
    assert.equal(noProof.json.error.code, "invalid_dpop_proof");
    // A body over 64 KB.
    const huge = await request(port, {
      method: "POST",
      path: "/v1/auth/pair",
      headers: nextClient(),
      body: { secret: "x".repeat(70 * 1024) }
    });
    assert.equal(huge.status, 413);
    assert.equal(huge.json.error.code, "too_large");
  }

  {
    // Session-bound requests: DPoP only, from the bound key, with ath.
    const bearer = await request(port, {
      method: "POST",
      path: "/v1/auth/ws-ticket",
      headers: { Authorization: `Bearer ${tokenA}`, DPoP: await createProof(phoneA, { url: `${base}/v1/auth/ws-ticket`, token: tokenA }) },
      body: {}
    });
    assert.equal(bearer.status, 401, "a bearer token is never accepted");
    assert.match(bearer.headers["www-authenticate"], /^DPoP/);
    const stolen = await authed(phoneB, tokenA, { path: "/v1/auth/ws-ticket" });
    assert.equal(stolen.status, 401, "a token with another device's proof");
    const noAth = await request(port, {
      method: "POST",
      path: "/v1/auth/ws-ticket",
      headers: { Authorization: `DPoP ${tokenA}`, DPoP: await createProof(phoneA, { url: `${base}/v1/auth/ws-ticket` }) },
      body: {}
    });
    assert.equal(noAth.status, 400);
    assert.equal(noAth.json.error.code, "invalid_dpop_proof");
    // The proof is single use: replaying the whole request fails.
    const proof = await createProof(phoneA, { url: `${base}/v1/auth/ws-ticket`, token: tokenA });
    const replayHeaders = { Authorization: `DPoP ${tokenA}`, DPoP: proof };
    assert.equal((await request(port, { method: "POST", path: "/v1/auth/ws-ticket", headers: replayHeaders, body: {} })).status, 200);
    assert.equal((await request(port, { method: "POST", path: "/v1/auth/ws-ticket", headers: replayHeaders, body: {} })).status, 400);
    // Device management is the desktop window's alone.
    const list = await authed(phoneA, tokenA, { method: "GET", path: "/v1/auth/sessions" });
    assert.equal(list.status, 403);
    assert.equal(list.json.error.code, "forbidden");
    assert.equal(list.json.error.requiredPermission, "access:write");
    const revokeOther = await authed(phoneA, tokenA, { method: "DELETE", path: `/v1/auth/sessions/${crypto.randomUUID()}` });
    assert.equal(revokeOther.status, 403);
  }

  // ----- WebSocket: two clients and the hub see the same events -----

  const sockets = [];
  const connect = async (key, token, ticket) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?ticket=${ticket ?? (await ticketFor(key, token))}`);
    sockets.push(ws);
    const client = { ws, frames: [], events: [], pending: new Map(), nextId: 1, closed: null };
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      client.frames.push(frame);
      if (frame.event) client.events.push(frame);
      else client.pending.get(frame.id)?.(frame);
    });
    ws.on("close", (code, reason) => {
      client.closed = { code, reason: reason.toString() };
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    client.call = (method, params = {}) =>
      new Promise((resolve) => {
        const id = client.nextId++;
        client.pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    return client;
  };
  const upgradeStatus = (ticket) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?ticket=${ticket}`);
      ws.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      ws.on("open", () => {
        ws.close();
        resolve(101);
      });
      ws.on("error", () => undefined);
    });

  const connectionsBefore = connectionChanges;
  const a = await connect(phoneA, tokenA);
  const b = await connect(phoneB, tokenB);
  await waitFor(() => server.connectedSessionIds().size === 2, { message: "two connected devices" });
  assert.ok(connectionChanges >= connectionsBefore + 2);

  {
    // Tickets: single use, and only real ones.
    const ticket = await ticketFor(phoneA, tokenA);
    assert.equal(await upgradeStatus(ticket), 101);
    assert.equal(await upgradeStatus(ticket), 401, "a ticket opens one socket");
    assert.equal(await upgradeStatus(`wst_${"A".repeat(43)}`), 401);
  }

  const created = await a.call("coach.createSession");
  assert.ok(created.result.session.id, JSON.stringify(created));
  assert.equal(created.result.session.provider, "claude-code", "the desktop's provider");
  const sessionId = created.result.session.id;
  const listed = await b.call("coach.listSessions");
  assert.deepEqual(listed.result.sessions.map((row) => row.id), [sessionId]);
  assert.deepEqual(Object.keys(listed.result.sessions[0]).sort(), ["createdAt", "id", "messageCount", "preview", "provider", "title", "updatedAt"]);

  const subscribedA = await a.call("coach.subscribe", { sessionId, afterSeq: 0 });
  const subscribedB = await b.call("coach.subscribe", { sessionId });
  assert.equal(subscribedB.result.mode, "snapshot", "no cursor: a snapshot");
  const windowFrames = [];
  const windowSubscription = hub.subscribe(sessionId, 0, (frame) => windowFrames.push(frame));
  let stateB = coachStateFromSnapshot(subscribedB.result.snapshot);
  assert.ok(["replay", "snapshot"].includes(subscribedA.result.mode));

  const sent = await a.call("coach.send", { sessionId, clientMessageId: "m-1", text: "How was my run?" });
  const { requestId } = sent.result;
  assert.ok(requestId, JSON.stringify(sent));
  assert.deepEqual((await a.call("coach.send", { sessionId, clientMessageId: "m-1", text: "How was my run?" })).result, { requestId }, "idempotent");
  assert.equal(stream.turns.length, 1);
  const turn = stream.turns[0];
  turn.send("chat:streamStart");
  turn.send("chat:streamToken", { delta: "Steady " });
  turn.send("chat:streamToken", { delta: "effort." });
  turn.send("chat:streamDone", { fullText: "Steady effort." });
  turn.resolve();
  await waitFor(() => a.events.some((frame) => frame.event === "turn.completed") && b.events.some((frame) => frame.event === "turn.completed"), {
    message: "turn.completed on both phones"
  });
  await tick();
  assert.deepEqual(a.events, windowFrames, "phone A and the window see the same events");
  assert.deepEqual(b.events, windowFrames, "phone B and the window see the same events");
  assert.deepEqual(
    windowFrames.filter((frame) => frame.event === "turn.delta").map((frame) => frame.data.delta),
    ["Steady ", "effort."]
  );
  for (const frame of b.events) {
    const next = applyCoachEvent(stateB, frame);
    assert.notEqual(next, "resync");
    stateB = next;
  }
  assert.deepEqual(stateB.entries, hub.getSession(sessionId).entries, "B's state rebuilt from events matches the hub");
  assert.equal(stateB.cursor, hub.getSession(sessionId).cursor);

  // getSession and environment.info.
  const snapshot = await b.call("coach.getSession", { sessionId });
  assert.deepEqual(snapshot.result.entries, hub.getSession(sessionId).entries);
  assert.deepEqual((await a.call("environment.info")).result, { lanRoutes: [{ host: LAN, port }] });

  // ----- Resume from a cursor -----
  {
    const cursor = stateB.cursor;
    b.ws.close();
    await waitFor(() => b.closed !== null, { message: "B closed" });
    await a.call("coach.send", { sessionId, clientMessageId: "m-2", text: "And tomorrow?" });
    const second = stream.turns[1];
    second.send("chat:streamToken", { delta: "Rest." });
    second.send("chat:streamDone", { fullText: "Rest." });
    second.resolve();
    await waitFor(() => a.events.filter((frame) => frame.event === "turn.completed").length === 2, { message: "second turn" });

    const resumed = await connect(phoneB, tokenB);
    const answer = await resumed.call("coach.subscribe", { sessionId, afterSeq: cursor });
    assert.deepEqual(answer.result, { mode: "replay" });
    await waitFor(() => resumed.events.some((frame) => frame.event === "turn.completed"), { message: "replayed turn" });
    const expected = a.events.filter((frame) => frame.seq > cursor && SAVED_COACH_EVENTS.has(frame.event));
    assert.deepEqual(resumed.events, expected, "replay is the saved events after the cursor, in order");
    let state = stateB;
    for (const frame of resumed.events) state = applyCoachEvent(state, frame);
    assert.deepEqual(state.entries, hub.getSession(sessionId).entries, "resumed state matches");
    // The replay arrives after the answer, before anything else.
    const answerAt = resumed.frames.findIndex((frame) => frame.id !== undefined && frame.result?.mode === "replay");
    assert.ok(resumed.frames.slice(0, answerAt).every((frame) => !frame.event));

    // A cursor the server can't replay from gets a snapshot.
    const ahead = await resumed.call("coach.subscribe", { sessionId, afterSeq: 1_000_000 });
    assert.equal(ahead.result.mode, "snapshot");
    assert.equal(ahead.result.snapshot.cursor, hub.getSession(sessionId).cursor);
    assert.equal((await resumed.call("coach.unsubscribe", { sessionId })).result !== undefined, true);
    resumed.ws.close();
  }

  // ----- Scopes, errors and frames -----
  {
    const view = await connect(viewer, tokenViewer);
    assert.ok((await view.call("coach.listSessions")).result.sessions);
    const send = await view.call("coach.send", { sessionId, clientMessageId: "v-1", text: "hi" });
    assert.deepEqual(send.error, {
      code: "forbidden",
      message: "This device can view Coach but not send messages.",
      requiredPermission: "coach:operate"
    });
    const confirm = await view.call("coach.confirm", { sessionId, kind: "strengthEdit", id: "se1", decision: "confirm", reviewHash: "h" });
    assert.equal(confirm.error.code, "forbidden");
    assert.equal(confirm.error.requiredPermission, "coach:approve");
    assert.equal((await view.call("coach.createSession")).error.requiredPermission, "coach:operate");
    assert.equal((await view.call("coach.deleteSession", { sessionId })).error.requiredPermission, "coach:operate");

    // Provider and model: readable by anyone, changed with coach:operate, and shown to every client.
    const catalog = (await view.call("coach.getModels")).result;
    assert.equal(catalog.provider, "claude-code");
    assert.deepEqual(catalog.providers.map((row) => row.id), ["chatgpt", "claude-code", "gemini-cli", "antigravity", "openrouter", "local"]);
    assert.equal(catalog.providers[1].model, "opus");
    assert.deepEqual(catalog.providers[1].models.map((row) => row.value), ["", "opus"], "the live Claude list");
    assert.ok(catalog.providers[0].models.length > 1, "ChatGPT falls back to the static list");
    assert.equal(catalog.providers[2].label, "Gemini");
    assert.equal(catalog.providers[2].model, "flash");
    assert.ok(catalog.providers[2].models.some((row) => row.value === "flash"), "Gemini falls back to its aliases");
    assert.equal(catalog.providers[3].label, "Antigravity");
    assert.deepEqual(catalog.providers[3].models, [{ value: "", label: "Default" }], "Antigravity offers the account default until signed in");
    assert.deepEqual(catalog.providers[5].models, [{ value: "llama3", label: "llama3" }]);
    assert.equal((await view.call("coach.setModel", { provider: "chatgpt", model: "gpt-5.5" })).error.requiredPermission, "coach:operate");
    assert.equal((await a.call("coach.setModel", { provider: "nope" })).error.code, "invalid");
    const changed = (await a.call("coach.setModel", { provider: "chatgpt", model: "gpt-5.5" })).result;
    assert.equal(changed.provider, "chatgpt");
    assert.equal(chatSettings.provider, "chatgpt");
    assert.equal(chatSettings.chatgpt.model, "gpt-5.5");
    assert.equal(chatSettings.claudeCode.model, "opus", "other providers keep their model");
    assert.equal((await a.call("coach.setModel", { provider: "gemini-cli", model: "pro" })).result.provider, "gemini-cli");
    assert.equal(chatSettings.geminiCli.model, "pro");
    assert.equal((await a.call("coach.setModel", { provider: "claude-code", model: "" })).result.providers[1].model, "", "account default");
    assert.equal((await a.call("coach.setModel", { provider: "claude-code", model: "opus" })).result.provider, "claude-code");

    // Planned workouts' exact steps, readable with coach:read, in C-LINK's step shape.
    const planned = (await view.call("training.scheduledSteps", { startDay: "20261026", endDay: "20261129" })).result.workouts;
    assert.deepEqual(scheduleAsked.at(-1), ["20261026", "20261129"]);
    assert.deepEqual(planned.map((row) => [row.day, row.idInPlan]), [["2026-10-29", "7"], ["2026-10-31", "8"], ["2026-11-01", "9"], ["2026-11-02", "11"], ["2026-11-03", "12"], ["2026-11-04", "13"], ["2026-10-28", "10"]]);
    assert.deepEqual(planned[3].steps, [
      { step: { _0: { kind: 1, target: { distance: { meters: 200 } }, note: "Freestyle" } } },
      { repeats: { times: 4, steps: [
        { kind: 2, target: { distance: { meters: 100 } }, note: "Breaststroke" },
        { kind: 3, target: { time: { seconds: 20 } } }
      ] } },
      { step: { _0: { kind: 4, target: { distance: { meters: 100 } } } } }
    ], "a swim's strokes are its steps' notes");
    assert.deepEqual(planned[4].steps, [
      { repeats: { times: 3, steps: [
        { kind: 2, target: { reps: { count: 10 } }, note: "Squats @ 20 kg" },
        { kind: 2, target: { reps: { count: 15 } }, note: "Push Ups" },
        { kind: 3, target: { time: { seconds: 90 } } }
      ] } }
    ], "a gym session names each exercise, its weight and reps");
    assert.deepEqual(planned[5].steps, [
      { step: { _0: { kind: 2, target: { time: { seconds: 1200 } }, metric: 4, intensity: { percent: { low: 88, high: 94 } } } } },
      { step: { _0: { kind: 4, target: { time: { seconds: 600 } }, metric: 2, intensity: { range: { low: 120, high: 144 } } } } }
    ], "a ride's % of FTP is power against threshold, its speed a pace C-LINK shows as km/h");
    assert.deepEqual(planned[6].steps, [
      { step: { _0: { kind: 1, target: { distance: { meters: 1500 } }, note: "1.5km warm up" } } },
      { step: { _0: { kind: 2, target: { distance: { meters: 2000 } }, note: "2km at 5:10/km" } } },
      { step: { _0: { kind: 3, target: { time: { seconds: 120 } }, note: "120s rest" } } },
      { step: { _0: { kind: 2, target: { distance: { meters: 1000 } }, metric: 2, intensity: { range: { low: 285, high: 305 } } } } },
      { step: { _0: { kind: 4, target: { distance: { meters: 500 } } } } }
    ], "a pace stored as 0 is no target; Runna's paces are seconds per km; the coach's step names are kept, COROS's defaults aren't");
    assert.equal(planned[0].planId, "481333460374569066");
    assert.deepEqual(planned[0].steps, [
      { step: { _0: { kind: 1, target: { time: { seconds: 300 } } } } },
      { repeats: { times: 8, steps: [
        { kind: 2, target: { time: { seconds: 120 } }, metric: 2, intensity: { range: { low: 354.182, high: 372.823 } } },
        { kind: 3, target: { time: { seconds: 60 } } }
      ] } },
      { step: { _0: { kind: 4, target: { distance: { meters: 1609.34 } }, metric: 1, intensity: { range: { low: 120, high: 135 } } } } }
    ], "walks are rests, the cool-down stays one, mile paces to the millisecond");
    assert.deepEqual(planned[1].steps, [
      { step: { _0: { kind: 2, target: { distance: { meters: 5000 } }, metric: 3, intensity: { percent: { low: 95, high: 95 } } } } }
    ], "a percentage of threshold pace is the coach's exact step");
    assert.deepEqual(planned[2].steps, [{ step: { _0: { kind: 2, target: { reps: { count: 10 } } } } }], "an unnamed exercise is still its reps");
    assert.equal(planned[2].description, "Pull day: rows, pull-ups and curls.", "every workout with a description sends it");
    assert.equal(planned[0].description, undefined);
    assert.equal(planned[6].description, undefined, "COROS's built-in keys aren't a description");
    assert.equal((await view.call("training.scheduledSteps", { startDay: "20261026", endDay: "20270101" })).error.code, "invalid", "at most 62 days");
    assert.equal((await view.call("training.scheduledSteps", { startDay: "2026-10-26", endDay: "20261029" })).error.code, "invalid");
    assert.equal((await view.call("training.scheduledSteps", { startDay: "20261030", endDay: "20261029" })).error.code, "invalid");

    // Deleting from the phone removes the conversation for every client, subscribed or not.
    const doomed = (await a.call("coach.createSession")).result.session.id;
    await a.call("coach.subscribe", { sessionId: doomed });
    assert.deepEqual((await a.call("coach.deleteSession", { sessionId: doomed })).result, {});
    assert.ok(!(await view.call("coach.listSessions")).result.sessions.some((row) => row.id === doomed), "gone for the other client");
    assert.equal((await view.call("coach.getSession", { sessionId: doomed })).error.code, "not_found");
    assert.equal(stream.turns.length, 2, "nothing ran");

    assert.equal((await a.call("coach.nothing")).error.code, "unsupported");
    assert.equal((await a.call("coach.getSession", { sessionId: "missing" })).error.code, "not_found");
    assert.equal((await a.call("coach.send", { sessionId })).error.code, "invalid");
    assert.equal((await a.call("coach.confirm", { sessionId, kind: "other", id: "x", decision: "confirm" })).error.code, "invalid");
    const notFound = await a.call("coach.confirm", { sessionId, kind: "corosAction", id: "x", decision: "confirm" });
    assert.equal(notFound.error.code, "not_found");

    // A phone's workout card picks the day; other kinds and other choices stay the card's defaults.
    const confirmed = [];
    const realConfirm = hub.confirm;
    hub.confirm = async (input) => { confirmed.push(input); return { index: 0, entry: { kind: "toolNotice", message: "ok" } }; };
    try {
      await a.call("coach.confirm", { sessionId, kind: "planUpload", id: "d1", decision: "confirm", options: { destination: "calendar", scheduleDate: "2026-10-28" } });
      await a.call("coach.confirm", { sessionId, kind: "planUpload", id: "d2", decision: "confirm", options: { scheduleDate: "20261029" } });
      await a.call("coach.confirm", { sessionId, kind: "planUpload", id: "d3", decision: "confirm" });
      await a.call("coach.confirm", { sessionId, kind: "corosAction", id: "c1", decision: "confirm", options: { destination: "calendar" } });
      assert.deepEqual(confirmed.map((input) => input.options), [
        { destination: "calendar", scheduleDate: "2026-10-28" },
        { destination: "calendar", scheduleDate: "2026-10-29" },
        undefined,
        undefined
      ]);
      const bad = await a.call("coach.confirm", { sessionId, kind: "planUpload", id: "d4", decision: "confirm", options: { destination: "localPlan" } });
      assert.equal(bad.error.code, "invalid");
      assert.equal(confirmed.length, 4, "a refused option never reaches the hub");
    } finally {
      hub.confirm = realConfirm;
    }
    assert.equal(planUploadOptions(undefined), undefined);
    assert.deepEqual(planUploadOptions({ destination: "workoutLibrary" }), { destination: "workoutLibrary" });
    assert.throws(() => planUploadOptions({ scheduleDate: "2026-02-30" }), /YYYY-MM-DD/);
    assert.throws(() => planUploadOptions({ destination: "workoutLibrary", scheduleDate: "2026-10-28" }), /no day/);
    view.ws.send("not json");
    await waitFor(() => view.frames.some((frame) => frame.id === null), { message: "an error for a bad frame" });
    view.ws.close();
  }

  // ----- Files a phone attaches -----
  {
    // A 1×1 JPEG's first bytes are enough for the store's type check.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");
    const upload = (key, token, body) => authed(key, token, { path: "/v1/coach/attachments", body });
    const image = await upload(phoneA, tokenA, {
      sessionId,
      name: "Photo.jpg",
      mimeType: "image/jpeg",
      kind: "image",
      original: jpeg,
      images: [{ mimeType: "image/jpeg", data: jpeg, width: 1, height: 1 }]
    });
    assert.equal(image.status, 200, image.text);
    assert.equal(image.json.attachment.name, "Photo.jpg");
    assert.equal(image.json.attachment.kind, "image");
    const plan = await upload(phoneA, tokenA, {
      sessionId,
      name: "plan.md",
      mimeType: "text/markdown",
      kind: "document",
      original: Buffer.from("# Week 1\nEasy runs").toString("base64"),
      text: "# Week 1\nEasy runs"
    });
    assert.equal(plan.status, 200, plan.text);
    assert.equal(plan.json.attachment.textChars, 18);

    const refused = await upload(phoneA, tokenA, { sessionId, name: "tool.exe", mimeType: "application/x", kind: "document", original: jpeg, text: "x" });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.message, "tool.exe is not a supported file.", "the store's own words");
    assert.equal((await upload(phoneA, tokenA, { sessionId, name: "a.md", mimeType: "text/markdown", kind: "document", original: "not base64!", text: "x" })).status, 400);
    assert.equal((await upload(phoneA, tokenA, { sessionId: "missing", name: "a.md", mimeType: "text/markdown", kind: "document", original: jpeg, text: "x" })).status, 404);
    const viewOnly = await upload(viewer, tokenViewer, { sessionId, name: "a.md", mimeType: "text/markdown", kind: "document", original: jpeg, text: "x" });
    assert.equal(viewOnly.status, 403, "view-only devices can't attach");

    const c = await connect(phoneA, tokenA);
    const ids = [image.json.attachment.id, plan.json.attachment.id];
    const sent = await c.call("coach.send", { sessionId, clientMessageId: "f-1", text: "", files: ids });
    assert.ok(sent.result?.requestId, JSON.stringify(sent));
    const entry = hub.getSession(sessionId).entries.findLast((candidate) => candidate.kind === "message" && candidate.role === "user");
    assert.deepEqual(entry.files.map((file) => file.name), ["Photo.jpg", "plan.md"], "a message may be only files");
    const turn = stream.turns.at(-1);
    turn.send("chat:streamDone", { fullText: "Nice plan." });
    turn.resolve();

    assert.equal((await c.call("coach.send", { sessionId, clientMessageId: "f-2", text: "hi", files: ["gone"] })).error.code, "invalid");
    assert.equal((await c.call("coach.send", { sessionId, clientMessageId: "f-3", text: "hi", files: "x" })).error.code, "invalid");
    c.ws.close();
  }

  // ----- Revocation closes sockets; the session is gone -----
  {
    assert.equal(a.closed, null);
    const sessionA = auth.listSessions().find((entry) => entry.label === "Phone A");
    assert.equal(auth.revokeSession(sessionA.id), true);
    await waitFor(() => a.closed !== null, { message: "A's socket closed" });
    assert.equal(a.closed.code, 4401);
    const afterRevoke = await authed(phoneA, tokenA, { path: "/v1/auth/ws-ticket" });
    assert.equal(afterRevoke.status, 401);
    assert.equal(afterRevoke.json.error.code, "invalid_token");

    // A device ends its own session.
    const b2 = await connect(phoneB, tokenB);
    const signOut = await authed(phoneB, tokenB, { method: "DELETE", path: "/v1/auth/session" });
    assert.equal(signOut.status, 204);
    await waitFor(() => b2.closed !== null, { message: "B's socket closed" });
    assert.equal((await authed(phoneB, tokenB, { path: "/v1/auth/ws-ticket" })).status, 401);
  }

  // ----- Rate limits on /v1/auth/* -----
  {
    const key = await createDeviceKey();
    const headers = { "CF-Connecting-IP": "203.0.113.9" };
    let limited;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      limited = await request(port, {
        method: "POST",
        path: "/v1/auth/pair",
        headers: { ...headers, DPoP: await createProof(key, { url: `${base}/v1/auth/pair` }) },
        body: { secret: "x".repeat(43), label: "x" }
      });
    }
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, "rate_limited");
    assert.ok(Number(limited.headers["retry-after"]) > 0);
    // Another address isn't affected.
    const fresh = await request(port, {
      method: "POST",
      path: "/v1/auth/pair",
      headers: { ...nextClient(), DPoP: await createProof(key, { url: `${base}/v1/auth/pair` }) },
      body: { secret: "x".repeat(43), label: "x" }
    });
    assert.equal(fresh.status, 401);
  }

  // ----- Relay mint -----
  {
    const phone = await createDeviceKey();
    const relay = await jose.generateKeyPair("ES256", { extractable: true });
    const relayJwk = { ...(await jose.exportJWK(relay.publicKey)), kid: "relay-key-1", alg: "ES256" };
    const issuer = "https://relay.coroslink.com";
    const mintRequest = async (claims = {}, header = {}) => {
      const now = Math.floor(Date.now() / 1000);
      return new jose.SignJWT({
        environmentId: identity.environmentId,
        userId: "user-1",
        jkt: phone.jkt,
        nonce: crypto.randomBytes(32).toString("base64url"),
        ...claims
      })
        .setProtectedHeader({ alg: "ES256", typ: "coroslink-relay-mint+jwt", kid: "relay-key-1", ...header })
        .setIssuer(issuer)
        .setAudience(`coroslink-env:${identity.environmentId}`)
        .setIssuedAt(now)
        .setExpirationTime(now + 120)
        .sign(relay.privateKey);
    };
    const mint = async (body) =>
      request(port, { method: "POST", path: "/v1/relay/mint", headers: { Host: TUNNEL, "X-Forwarded-Proto": "https" }, body });

    const unlinked = await mint({ request: await mintRequest() });
    assert.equal(unlinked.status, 404, "no pinned relay key: nothing to mint");
    assert.equal(unlinked.json.error.code, "not_linked");

    relayTrust = { issuer, userId: "user-1", keys: [relayJwk] };
    const signed = await mintRequest();
    const minted = await mint({ request: signed });
    assert.equal(minted.status, 200, minted.text);
    const { credential, expiresAt, proof } = minted.json;
    // Verify as the relay does (relay/src/connect.ts).
    const header = jose.decodeProtectedHeader(proof);
    assert.deepEqual(header, { alg: "ES256", typ: "coroslink-env-mint+jws", kid: identity.kid });
    const verified = await jose.compactVerify(proof, await jose.importJWK(identity.publicJwk, "ES256"));
    const claims = JSON.parse(new TextDecoder().decode(verified.payload));
    const nonce = jose.decodeJwt(signed).nonce;
    assert.deepEqual(Object.keys(claims).sort(), ["credentialSha256", "environmentId", "exp", "iat", "jkt", "nonce"]);
    assert.equal(claims.environmentId, identity.environmentId);
    assert.equal(claims.nonce, nonce);
    assert.equal(claims.jkt, phone.jkt);
    assert.equal(claims.credentialSha256, sha256(credential));
    assert.equal(claims.exp, Math.floor(Date.parse(expiresAt) / 1000));
    assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 5);
    assert.ok(Date.parse(expiresAt) - Date.now() <= 120_000 && Date.parse(expiresAt) > Date.now());

    // The same request again is a replay.
    const replayed = await mint({ request: signed });
    assert.equal(replayed.status, 401);
    assert.equal(replayed.json.error.code, "replayed");

    // Refusals: another account, another computer, another key, wrong typ.
    const otherRelay = await jose.generateKeyPair("ES256");
    const forged = await new jose.SignJWT({ environmentId: identity.environmentId, userId: "user-1", jkt: phone.jkt, nonce: "n".repeat(32) })
      .setProtectedHeader({ alg: "ES256", typ: "coroslink-relay-mint+jwt", kid: "relay-key-1" })
      .setIssuer(issuer)
      .setAudience(`coroslink-env:${identity.environmentId}`)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(otherRelay.privateKey);
    for (const [name, body] of [
      ["another user", { request: await mintRequest({ userId: "user-2" }) }],
      ["another environment", { request: await mintRequest({ environmentId: "AAAAAAAAAAAAAAAAAAAAAA" }) }],
      ["an unknown kid", { request: await mintRequest({}, { kid: "relay-key-9" }) }],
      ["another typ", { request: await mintRequest({}, { typ: "JWT" }) }],
      ["a forged signature", { request: forged }],
      ["a bad jkt", { request: await mintRequest({ jkt: "short" }) }]
    ]) {
      const refused = await mint(body);
      assert.equal(refused.status, 401, name);
      assert.equal(refused.json.error.code, "invalid_signature", name);
    }
    assert.equal((await mint({})).status, 400);

    // The phone spends the credential through the tunnel with its own key.
    const bootstrapUrl = `https://${TUNNEL}/v1/auth/bootstrap`;
    const stranger = await createDeviceKey();
    const wrongKey = await request(port, {
      method: "POST",
      path: "/v1/auth/bootstrap",
      headers: { Host: TUNNEL, "X-Forwarded-Proto": "https", DPoP: await createProof(stranger, { url: bootstrapUrl }), ...nextClient() },
      body: { credential }
    });
    assert.equal(wrongKey.status, 401, "bound to the phone's key");
    const bootstrapped = await request(port, {
      method: "POST",
      path: "/v1/auth/bootstrap",
      headers: { Host: TUNNEL, "X-Forwarded-Proto": "https", DPoP: await createProof(phone, { url: bootstrapUrl }), ...nextClient() },
      body: { credential }
    });
    assert.equal(bootstrapped.status, 200, bootstrapped.text);
    assert.deepEqual(bootstrapped.json.permissions, ["coach:read", "coach:operate", "coach:approve"]);
    const again = await request(port, {
      method: "POST",
      path: "/v1/auth/bootstrap",
      headers: { Host: TUNNEL, "X-Forwarded-Proto": "https", DPoP: await createProof(phone, { url: bootstrapUrl }), ...nextClient() },
      body: { credential }
    });
    assert.equal(again.status, 401, "one use");
  }

  // ----- Ports and addresses -----
  {
    // A saved port that's taken: the server moves and reports the new one.
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const taken = blocker.address().port;
    const moved = [];
    const second = new RemoteServer({
      identity,
      auth,
      hub,
      descriptor: () => ({ name: "Second", appVersion: "1" }),
      defaultProvider: () => "local",
      port: taken,
      onPortChanged: (value) => moved.push(value)
    });
    await second.start();
    assert.notEqual(second.port, taken);
    assert.deepEqual(moved, [second.port]);
    await second.stop();
    blocker.close();
    assert.deepEqual(portChanges, [port], "the first server saved its picked port once");

    assert.deepEqual(
      remoteLanAddresses({
        en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
        utun4: [{ address: "100.101.2.3", family: "IPv4", internal: false }],
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        en5: [{ address: "203.0.113.4", family: "IPv4", internal: false }]
      }),
      ["192.168.1.20", "100.101.2.3"],
      "private addresses, then Tailscale"
    );
    assert.equal(isTailscaleIPv4("100.64.0.1"), true);
    assert.equal(isTailscaleIPv4("100.128.0.1"), false);
  }

  // Network access off: back to loopback only, every socket closed.
  await server.setNetworkAccess(false);
  assert.equal((await request(port, { path: "/v1/descriptor", headers: { Host: `${LAN}:${port}` } })).status, 403);
  assert.deepEqual(server.environmentInfo(), { lanRoutes: [] });
  windowSubscription.unsubscribe();
} finally {
  await server.stop();
}

console.log("remote server tests passed");
