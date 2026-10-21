import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// CoachSessionHub against the compiled dist-electron build, with an in-memory
// transcript database (as in test-chat-history-store.mjs), an in-memory event
// store and a fake provider that writes chat:stream* events into the hub's sink.
//
// scripts/fixtures/coach-contract.json is a copy of C-LINK's shared vectors,
// CorosKit/Tests/CorosKitTests/Resources/coach-contract.json. When that checkout
// is next to this one, the copies must match.
const repoRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(repoRoot, "dist-electron", "main.js"));
const { CoachSessionHub, CoachHubError } = require("./coachHub/coachSessionHub.js");
const { createChatHistorySessionStore, createMemoryCoachEventStore } = require("./coachHub/coachStores.js");
const { applyCoachEvent, coachStateFromSnapshot, SAVED_COACH_EVENTS } = require("./coachHub/coachContract.js");
const { getChatSession } = require("./chatHistoryStore.js");
const { fromPersistedEntries, toWireMessages } = require("./chatTranscript.js");

const contract = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/coach-contract.json"), "utf8"));
const swiftVectors = path.resolve(repoRoot, "../C-LINK/CorosKit/Tests/CorosKitTests/Resources/coach-contract.json");
for (const candidate of [swiftVectors, "/Users/aker/Developer/C-LINK/CorosKit/Tests/CorosKitTests/Resources/coach-contract.json"]) {
  if (existsSync(candidate)) {
    assert.deepEqual(JSON.parse(readFileSync(candidate, "utf8")), contract, "coach-contract.json drifted from C-LINK's copy");
    break;
  }
}

function createMemoryDatabase() {
  const rows = new Map();
  return {
    rows,
    listSessions: (provider) =>
      [...rows.values()]
        .filter((row) => row.provider === provider)
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()),
    getSession: (id) => rows.get(id),
    insertSession(id, provider, title, messagesJson, createdAt, updatedAt) {
      rows.set(id, { id, provider, title, messages_json: messagesJson, created_at: createdAt, updated_at: updatedAt });
    },
    updateSession(id, title, messagesJson, updatedAt) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, title, messages_json: messagesJson, updated_at: updatedAt });
    },
    deleteSession: (id) => rows.delete(id)
  };
}

/** A provider the test drives by hand: each start() is a turn it can stream into. */
function createFakeStream() {
  const turns = [];
  const cancelled = [];
  return {
    turns,
    cancelled,
    start(sink, requestId, messages, unitSystem, provider, sessionId) {
      let resolve;
      const done = new Promise((settle) => { resolve = settle; });
      turns.push({
        requestId, messages, unitSystem, provider, sessionId, resolve,
        send: (channel, payload = {}) => sink.send(channel, { requestId, ...payload }),
        info: (payload) => sink.send("chat:streamInfo", { requestId, ...payload })
      });
      return done;
    },
    cancel(requestId) {
      cancelled.push(requestId);
      const turn = turns.find((candidate) => candidate.requestId === requestId);
      turn?.send("chat:streamDone", { fullText: "partial", finishReason: "cancelled" });
      turn?.resolve();
    }
  };
}

function createActions() {
  const calls = [];
  const strength = {
    proposalId: "11111111-1111-4111-8111-111111111111", reviewHash: "a".repeat(64), createdAt: 1, expiresAt: Date.now() + 3_600_000,
    origin: "coach", state: "awaiting_confirmation", scope: "Next week's strength", exclusions: [],
    items: [
      { id: "22222222-2222-4222-8222-222222222222", name: "Push", ref: { kind: "library", programId: "1" }, changes: [], state: "prepared" },
      { id: "33333333-3333-4333-8333-333333333333", name: "Pull", ref: { kind: "library", programId: "2" }, changes: [], state: "prepared" }
    ]
  };
  return {
    calls,
    strength,
    deleteFails: false,
    async confirmCorosAction(requestId) {
      calls.push(["corosAction", requestId]);
      return { ...corosPreview, requestId, state: "saved", message: "COROS accepted the change." };
    },
    async confirmWorkoutDelete(requestId) {
      calls.push(["workoutDelete", requestId]);
      if (this.deleteFails) throw new Error("COROS is unreachable.");
      return { removedFromSchedule: true, removedFromLibrary: false, message: "Removed Tempo from Sunday." };
    },
    async uploadPlanDraft(draftId, unitSystem, destination, scheduleDate) {
      calls.push(["planUpload", draftId, unitSystem, destination, scheduleDate]);
      return { planName: "Tempo", workoutsCreated: 0, workoutsScheduled: 1, destination, entries: [{ key: "w1", name: "Tempo", date: "20261018", scheduled: true, savedToLibrary: false }] };
    },
    async strengthEditStatus() { return structuredClone(strength); },
    async confirmStrengthEdit(proposalId, reviewHash, selectedIds) {
      calls.push(["strengthEdit", proposalId, reviewHash, selectedIds]);
      return { ...structuredClone(strength), state: "finished", items: strength.items.map((item) => ({ ...item, state: selectedIds.includes(item.id) ? "verified" : "cancelled" })) };
    },
    async cancelStrengthEdit() { return { ...structuredClone(strength), state: "cancelled" }; }
  };
}

const corosPreview = {
  requestId: "r1", title: "Review workout", summary: "45 min easy run", destination: "Calendar",
  date: "20261018", details: ["45:00 at zone 2"], createdAt: 1_792_140_000_000, state: "pending"
};
const workoutDraft = {
  draftId: "pd1", artifactType: "workout", name: "Tempo", summary: "A tempo run",
  entries: [{ key: "w1", name: "Tempo", sport: "run", saveToLibrary: true, workoutType: "Run", scheduleDate: "2026-10-18" }],
  conflicts: [], warnings: []
};
const coachChart = {
  previewId: "coach-chart:q:1",
  spec: { title: "HRV", days: 7, series: [{ label: "HRV", metric: "avgSleepHrv" }] },
  labels: ["Oct 1"], dates: ["20261001"],
  series: [{ key: "s0", label: "HRV", kind: "line", axis: "left", color: "hrv", dashed: false, metric: "avgSleepHrv", values: [61] }],
  resolvedAt: "2026-10-16T08:00:00.000Z", live: true
};
const prompt = {
  promptId: "p1", question: "How hard should Sunday be?", allowCustom: true,
  choices: [{ id: "c1", label: "Easy", response: "Keep Sunday easy." }, { id: "c2", label: "Tempo", response: "Make Sunday a tempo run." }]
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

function createHarness({ database = createMemoryDatabase(), events = createMemoryCoachEventStore(), visualizationsEnabled = true, maxRetainedEvents, titler, attachments } = {}) {
  const stream = createFakeStream();
  const actions = createActions();
  const settings = { visualizationsEnabled };
  const hub = new CoachSessionHub({
    sessions: createChatHistorySessionStore(database),
    events,
    stream,
    actions,
    settings: () => settings,
    ...(maxRetainedEvents ? { maxRetainedEvents } : {}),
    ...(titler ? { titler } : {}),
    ...(attachments ? { attachments } : {})
  });
  return { hub, stream, actions, settings, database, events };
}

function record(hub, sessionId, afterSeq) {
  const frames = [];
  const subscription = hub.subscribe(sessionId, afterSeq, (frame) => frames.push(frame));
  return { frames, subscription };
}

const shape = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : typeof value);
const vector = (event, predicate = () => true) => contract.events.find((frame) => frame.event === event && predicate(frame));

// ----- A full turn, seen identically by two subscribers -----
const main = createHarness();
const session = main.hub.createSession("claude-code");
const a = record(main.hub, session.id, 0);
const b = record(main.hub, session.id, 0);
assert.deepEqual(a.subscription.response, { mode: "replay" });
assert.deepEqual(a.subscription.replay, []);

const { requestId } = main.hub.send({ sessionId: session.id, clientMessageId: "m-1", text: "How did my long run go?", unitSystem: "imperial" });
const turn = main.stream.turns[0];
assert.equal(turn.requestId, requestId);
assert.equal(turn.provider, "claude-code", "the session's own provider runs the turn");
assert.equal(turn.unitSystem, "imperial");
assert.deepEqual(turn.messages, [{ role: "user", content: "How did my long run go?" }]);
// The same clientMessageId is the same send.
assert.deepEqual(main.hub.send({ sessionId: session.id, clientMessageId: "m-1", text: "How did my long run go?" }), { requestId });
assert.equal(main.stream.turns.length, 1);
assert.throws(() => main.hub.send({ sessionId: session.id, clientMessageId: "m-2", text: "Another" }), (error) => error.code === "busy");

turn.send("chat:streamStart");
turn.info({ kind: "context", snapshotIncluded: true, mcpEnabled: true });
turn.info({ kind: "thinking", delta: "Checking load" });
turn.info({ kind: "mcp", tool: "queryTrainingLoad", status: "call" });
turn.info({ kind: "coachChart", preview: coachChart });
turn.info({ kind: "corosAction", preview: corosPreview });
turn.info({ kind: "workoutDelete", preview: { requestId: "d1", target: "scheduled", workoutName: "Tempo", scheduleDate: "2026-10-19", summary: "Remove Tempo on Sunday" } });
turn.info({ kind: "planDraft", draft: workoutDraft });
turn.info({ kind: "workoutEdit", preview: main.actions.strength });
turn.info({ kind: "mcp", tool: "querySleep", status: "failed", message: "COROS training data was unavailable." });
turn.info({ kind: "coachPrompt", prompt });

// Mid-turn: the snapshot carries the answer so far, and replay from the
// turn's start rebuilds the same thing.
turn.send("chat:streamToken", { delta: "Load is " });
const midTurn = main.hub.getSession(session.id);
assert.deepEqual(midTurn.activeTurn, { requestId, text: "Load is ", thinking: "Checking load" });
const turnStarted = a.frames.find((frame) => frame.event === "turn.started");
const midReplay = main.hub.subscribe(session.id, turnStarted.seq, () => {});
assert.equal(midReplay.response.mode, "replay");
let rebuilt = { sessionId: session.id, session: midTurn.session, entries: [main.hub.getSession(session.id).entries[0]], cursor: turnStarted.seq, activeTurn: { requestId, text: "", thinking: "" } };
for (const frame of midReplay.replay) rebuilt = applyCoachEvent(rebuilt, frame);
assert.deepEqual(rebuilt.activeTurn, midTurn.activeTurn);
assert.deepEqual(rebuilt.entries, midTurn.entries);
midReplay.unsubscribe();

turn.send("chat:streamToken", { delta: "steady." });
turn.send("chat:streamDone", { fullText: "Load is steady." });
turn.resolve();
await tick();

assert.deepEqual(a.frames, b.frames, "every subscriber sees the same stream");
assert.deepEqual(a.frames.map((frame) => frame.seq), a.frames.map((_, index) => index + 1), "one counter per session");
assert.deepEqual(a.frames.map((frame) => frame.event), [
  "entry.appended", // the user's message
  "session.updated", // its title, from that message
  "turn.started",
  "turn.thinking",
  "turn.tool",
  "entry.appended", // chart
  "entry.appended", // COROS review
  "entry.appended", // delete card
  "entry.appended", // draft
  "entry.appended", // strength review
  "turn.tool", // failed
  "turn.delta",
  "turn.delta",
  "entry.appended", // tool notice
  "entry.appended", // answer
  "entry.appended", // question, after the answer
  "turn.completed"
]);

const final = main.hub.getSession(session.id);
assert.equal(final.activeTurn, null);
assert.deepEqual(final.entries.map((entry) => entry.kind), [
  "message", "coachChart", "corosAction", "workoutDelete", "planDraft", "workoutEdit", "toolNotice", "message", "coachPrompt"
]);
assert.deepEqual(final.entries[7], {
  kind: "message", role: "assistant", content: "Load is steady.",
  source: { snapshotIncluded: true, mcpEnabled: true, mcpUsed: true, mcpTools: ["queryTrainingLoad", "querySleep"], mcpError: "COROS training data was unavailable." },
  reasoningSummary: "Checking load"
});
for (const frame of a.frames.filter((frame) => frame.event === "entry.appended")) {
  assert.deepEqual(final.entries[frame.data.index], frame.data.entry, "index is the entry's place in the timeline");
}
// The window's old transcript rule: the chart came back normalized exactly as a reload reads it.
const persisted = fromPersistedEntries(getChatSession(session.id, main.database));
assert.deepEqual(persisted.map((entry) => entry.kind), [
  "message", "coachChart", "corosAction", "workoutDelete", "planDraft", "workoutEdit", "message", "message", "coachPrompt"
]);
assert.deepEqual(persisted.filter((entry, index) => final.entries[index].kind !== "toolNotice"), final.entries.filter((entry) => entry.kind !== "toolNotice"));
assert.equal(final.session.title, "How did my long run go?");

// ----- Frames match the shared vectors -----
for (const [event, ours] of [
  ["turn.started", a.frames.find((frame) => frame.event === "turn.started")],
  ["turn.thinking", a.frames.find((frame) => frame.event === "turn.thinking")],
  ["turn.tool", a.frames.find((frame) => frame.event === "turn.tool" && frame.data.status === "call")],
  ["turn.delta", a.frames.find((frame) => frame.event === "turn.delta")],
  ["entry.appended", a.frames.find((frame) => frame.event === "entry.appended")],
  ["turn.completed", a.frames.find((frame) => frame.event === "turn.completed")],
  ["session.updated", a.frames.find((frame) => frame.event === "session.updated")]
]) {
  const expected = vector(event);
  assert.ok(ours, event);
  assert.deepEqual(shape(ours), shape(expected), `${event} frame keys`);
  assert.deepEqual(shape(ours.data), shape(expected.data), `${event} data keys`);
  for (const key of Object.keys(expected.data)) {
    assert.equal(typeof ours.data[key], typeof expected.data[key], `${event}.${key}`);
  }
  if (event === "session.updated") assert.deepEqual(shape(ours.data.session), shape(expected.data.session));
  if (event === "entry.appended") assert.deepEqual(shape(ours.data.entry), shape({ kind: "", role: "", content: "" }));
}
const failedTool = a.frames.find((frame) => frame.event === "turn.tool" && frame.data.status === "failed");
assert.deepEqual(failedTool.data, { requestId, tool: "querySleep", status: "failed", message: "COROS training data was unavailable." });
assert.deepEqual(shape(final), shape(contract.snapshot), "snapshot keys");
assert.deepEqual(shape(final.session), shape(contract.snapshot.session), "snapshot session keys");
assert.ok(!Number.isNaN(Date.parse(final.session.createdAt)) && !Number.isNaN(Date.parse(final.session.updatedAt)));
// The client reducer reads the vectors the Swift side reads.
{
  let state = coachStateFromSnapshot(contract.snapshot);
  for (const frame of contract.events) {
    const next = applyCoachEvent(state, frame);
    assert.notEqual(next, "resync", frame.event);
    if (frame.event === "turn.delta") assert.equal(next.activeTurn.text.endsWith(frame.data.delta), true);
    if (frame.event === "turn.tool") assert.equal(next.activeTurn.tool, frame.data.tool);
    state = next;
  }
  assert.equal(state.cursor, 24);
  assert.equal(state.entries.length, 11);
  assert.equal(state.entries[3].preview.state, "saved");
  assert.equal(state.session.title, "Tempo week, adjusted");
  assert.equal(state.activeTurn, null);
}

// ----- Prompt answers resume the turn without a user bubble -----
const answer = main.hub.send({ sessionId: session.id, clientMessageId: "m-2", promptAnswer: { promptId: "p1", choiceId: "c1" } });
const answerTurn = main.stream.turns[1];
assert.equal(answerTurn.requestId, answer.requestId);
assert.equal(answerTurn.unitSystem, "imperial", "remote-style sends reuse the desktop's last units");
assert.deepEqual(answerTurn.messages.slice(-2), [
  { role: "assistant", content: "I need the athlete's answer before continuing:\nHow hard should Sunday be?\n- Easy\n- Tempo" },
  { role: "user", content: "Keep Sunday easy." }
]);
const answered = main.hub.getSession(session.id).entries[8];
assert.equal(answered.prompt.answer, "Keep Sunday easy.");
assert.equal(answered.prompt.selectedChoiceId, "c1");
assert.equal(typeof answered.prompt.answeredAt, "number");
assert.equal(main.hub.getSession(session.id).entries.length, 9, "an answer is not a new message");
assert.throws(
  () => main.hub.send({ sessionId: session.id, clientMessageId: "m-3", promptAnswer: { promptId: "p1", choiceId: "c2" } }),
  (error) => error.code === "busy"
);
// Cancelling drops the partial answer and offers the question again.
main.hub.cancel(session.id);
await tick();
assert.deepEqual(main.stream.cancelled, [answer.requestId]);
const restored = main.hub.getSession(session.id);
assert.equal(restored.activeTurn, null);
assert.deepEqual(restored.entries[8], { kind: "coachPrompt", prompt });
assert.equal(restored.entries.length, 9);
assert.equal(a.frames.at(-1).event, "turn.completed");
assert.deepEqual(a.frames.at(-2), { event: "entry.updated", sessionId: session.id, seq: a.frames.at(-2).seq, data: { index: 8, entry: { kind: "coachPrompt", prompt } } });

// Free text answers the newest open question; a failed turn offers it again.
const freeText = main.hub.send({ sessionId: session.id, clientMessageId: "m-4", text: "Something in between" });
assert.equal(main.hub.getSession(session.id).entries[8].prompt.answer, "Something in between");
main.stream.turns[2].send("chat:streamError", { message: "Claude Code is signed out.", authError: true });
await tick();
const failedFrame = a.frames.at(-1);
assert.deepEqual(failedFrame.data, { requestId: freeText.requestId, message: "Claude Code is signed out.", authError: true });
assert.deepEqual(shape(failedFrame.data), shape(vector("turn.failed").data));
assert.deepEqual(main.hub.getSession(session.id).entries[8], { kind: "coachPrompt", prompt });
assert.deepEqual(b.frames, a.frames);

// ----- Confirmations land once and reach every client -----
const before = a.frames.length;
const coros = await main.hub.confirm({ sessionId: session.id, kind: "corosAction", id: "r1", decision: "confirm" });
assert.equal(coros.index, 2);
assert.equal(coros.entry.preview.state, "saved");
assert.deepEqual(a.frames.slice(before).map((frame) => [frame.event, frame.data.entry?.preview.state]), [["entry.updated", "saving"], ["entry.updated", "saved"]]);
assert.deepEqual(shape(a.frames.at(-1).data), shape(vector("entry.updated").data));
const again = await main.hub.confirm({ sessionId: session.id, kind: "corosAction", id: "r1", decision: "confirm" });
assert.equal(again.entry.preview.state, "saved");
assert.equal(main.actions.calls.filter(([kind]) => kind === "corosAction").length, 1, "approvals land once");
await assert.rejects(
  main.hub.confirm({ sessionId: session.id, kind: "workoutDelete", id: "d1", decision: "confirm" }, { kind: "remote", permissions: ["coach:read", "coach:operate"] }),
  (error) => error instanceof CoachHubError && error.code === "forbidden" && error.requiredPermission === "coach:approve" &&
    JSON.stringify(Object.keys(error.toJSON()).sort()) === JSON.stringify(Object.keys(contract.responses.forbidden.error).sort())
);
main.actions.deleteFails = true;
const failedDelete = await main.hub.confirm({ sessionId: session.id, kind: "workoutDelete", id: "d1", decision: "confirm" }, { kind: "remote", permissions: ["coach:approve"] });
assert.deepEqual([failedDelete.entry.preview.state, failedDelete.entry.preview.message], ["failed", "COROS is unreachable."]);
main.actions.deleteFails = false;
const deleted = await main.hub.confirm({ sessionId: session.id, kind: "workoutDelete", id: "d1", decision: "confirm" });
assert.deepEqual([deleted.entry.preview.state, deleted.entry.preview.message], ["deleted", "Removed Tempo from Sunday."]);
await main.hub.confirm({ sessionId: session.id, kind: "workoutDelete", id: "d1", decision: "confirm" });
assert.equal(main.actions.calls.filter(([kind]) => kind === "workoutDelete").length, 2);
await assert.rejects(main.hub.confirm({ sessionId: session.id, kind: "workoutDelete", id: "d1", decision: "cancel" }), (error) => error.code === "unsupported");
// A remote approval of a draft uses the card's defaults.
const uploaded = await main.hub.confirm({ sessionId: session.id, kind: "planUpload", id: "pd1", decision: "confirm" });
assert.deepEqual(main.actions.calls.find(([kind]) => kind === "planUpload"), ["planUpload", "pd1", "imperial", "calendar", "2026-10-18"]);
assert.equal(typeof uploaded.entry.draft.uploadedAt, "number");
assert.deepEqual(JSON.parse(JSON.stringify(uploaded.entry.draft.uploadResult)), { workoutsScheduled: 1, workoutsCreated: 0, destination: "calendar" });
await main.hub.confirm({ sessionId: session.id, kind: "planUpload", id: "pd1", decision: "confirm" });
assert.equal(main.actions.calls.filter(([kind]) => kind === "planUpload").length, 1);
await assert.rejects(
  main.hub.confirm({ sessionId: session.id, kind: "strengthEdit", id: main.actions.strength.proposalId, decision: "confirm", reviewHash: "stale" }),
  (error) => error.code === "conflict"
);
const strength = await main.hub.confirm({ sessionId: session.id, kind: "strengthEdit", id: main.actions.strength.proposalId, decision: "confirm", reviewHash: main.actions.strength.reviewHash });
assert.equal(strength.entry.preview.state, "finished");
assert.deepEqual(main.actions.calls.find(([kind]) => kind === "strengthEdit")[3], main.actions.strength.items.map((item) => item.id));
assert.deepEqual(b.frames, a.frames, "approvals made by one client show on the other");
// Persisted state carries the outcomes across reloads.
const saved = fromPersistedEntries(getChatSession(session.id, main.database));
assert.equal(saved[3].preview.state, "deleted");
assert.equal(saved[2].preview.state, "saved");
assert.equal(typeof saved[4].draft.uploadedAt, "number");
assert.ok(toWireMessages(saved).some((message) => message.content.startsWith("COROS action saved")));

// ----- Replay from a cursor, and snapshots when it is too old -----
let fromSnapshot = coachStateFromSnapshot(midTurn); // taken while the first turn streamed
const resume = main.hub.subscribe(session.id, midTurn.cursor, () => {});
assert.deepEqual(resume.response, { mode: "replay" });
assert.ok(resume.replay.every((frame) => SAVED_COACH_EVENTS.has(frame.event)), "finished turns keep only saved events");
for (const frame of resume.replay) fromSnapshot = applyCoachEvent(fromSnapshot, frame);
const now = main.hub.getSession(session.id);
assert.deepEqual(fromSnapshot.entries, now.entries);
assert.equal(fromSnapshot.cursor, now.cursor);
assert.equal(fromSnapshot.activeTurn, null);
resume.unsubscribe();
assert.equal(main.hub.subscribe(session.id, now.cursor + 5, () => {}).response.mode, "snapshot", "a cursor from the future gets a snapshot");

const small = createHarness({ maxRetainedEvents: 3 });
const smallSession = small.hub.createSession("chatgpt");
for (let index = 0; index < 3; index += 1) {
  small.hub.send({ sessionId: smallSession.id, clientMessageId: `s-${index}`, text: `Question ${index}` });
  small.stream.turns[index].send("chat:streamDone", { fullText: `Answer ${index}` });
}
const old = small.hub.subscribe(smallSession.id, 1, () => {});
assert.equal(old.response.mode, "snapshot");
assert.equal(old.response.snapshot.cursor, small.hub.getSession(smallSession.id).cursor);
assert.equal(old.response.snapshot.entries.length, 6);
assert.equal(small.hub.subscribe(smallSession.id, small.hub.getSession(smallSession.id).cursor - 1, () => {}).response.mode, "replay");

// Visual cards follow the "show charts" setting; Coach charts always show.
const quiet = createHarness({ visualizationsEnabled: false });
const quietSession = quiet.hub.createSession("local");
quiet.hub.send({ sessionId: quietSession.id, clientMessageId: "v-1", text: "Charts?" });
quiet.stream.turns[0].info({ kind: "fitnessTrend", preview: { previewId: "f1", points: [], title: "Fitness" } });
quiet.stream.turns[0].info({ kind: "coachChart", preview: coachChart });
quiet.stream.turns[0].send("chat:streamDone", { fullText: "" });
assert.deepEqual(quiet.hub.getSession(quietSession.id).entries.map((entry) => entry.kind), ["message", "coachChart"]);

// ----- Restarts -----
// A second hub on the same stores sees the same session, cursor and sends.
const restarted = createHarness({ database: main.database, events: main.events });
const reloaded = restarted.hub.getSession(session.id);
// Tool notices are saved as assistant messages (as before the hub), in the same place.
const asSaved = (entries) => entries.map((entry) => entry.kind === "toolNotice" ? { kind: "message", role: "assistant", content: entry.message } : entry);
assert.deepEqual(reloaded.entries, asSaved(now.entries));
assert.equal(reloaded.cursor, now.cursor);
assert.deepEqual(restarted.hub.subscribe(session.id, now.cursor, () => {}).response, { mode: "replay" });
assert.deepEqual(restarted.hub.send({ sessionId: session.id, clientMessageId: "m-1", text: "How did my long run go?" }), { requestId }, "clientMessageId survives a restart");
assert.equal(restarted.stream.turns.length, 0);
const replayAfterRestart = restarted.hub.subscribe(session.id, midTurn.cursor, () => {});
assert.equal(replayAfterRestart.response.mode, "replay");
assert.deepEqual(replayAfterRestart.replay.map((frame) => frame.seq), resume.replay.map((frame) => frame.seq));

// A conversation saved before the hub has no events: cursor 0 is not enough.
const legacyDatabase = createMemoryDatabase();
legacyDatabase.insertSession("legacy", "chatgpt", "Old chat", JSON.stringify([{ kind: "message", role: "user", content: "Hi" }]), "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
const legacy = createHarness({ database: legacyDatabase });
assert.equal(legacy.hub.subscribe("legacy", 0, () => {}).response.mode, "snapshot");
assert.equal(legacy.hub.getSession("legacy").cursor, 1);

// A turn cut off by a crash is closed on the next launch, its question offered again.
const crashed = createHarness();
const crashedSession = crashed.hub.createSession("openrouter");
crashed.hub.send({ sessionId: crashedSession.id, clientMessageId: "c-1", text: "Plan Sunday" });
crashed.stream.turns[0].info({ kind: "coachPrompt", prompt });
crashed.stream.turns[0].send("chat:streamDone", { fullText: "One question first." });
crashed.hub.send({ sessionId: crashedSession.id, clientMessageId: "c-2", promptAnswer: { promptId: "p1", text: "Hard" } });
crashed.stream.turns[1].send("chat:streamToken", { delta: "Hard it is" });
const seenBeforeCrash = crashed.hub.getSession(crashedSession.id).cursor;
const relaunched = createHarness({ database: crashed.database, events: crashed.events });
const recovered = relaunched.hub.getSession(crashedSession.id);
assert.equal(recovered.activeTurn, null);
assert.deepEqual(recovered.entries.at(-1), { kind: "coachPrompt", prompt });
assert.ok(recovered.cursor > seenBeforeCrash + 1000, "numbering jumps past live events nobody saved");
assert.equal(relaunched.hub.subscribe(crashedSession.id, seenBeforeCrash, () => {}).response.mode, "snapshot");
const lastSaved = crashed.events.list(crashedSession.id, 0).at(-1);
assert.equal(lastSaved.kind, "turn.failed");

// Quitting ends turns as failed, so the next launch has nothing to recover.
const quitting = createHarness();
const quitSession = quitting.hub.createSession("chatgpt");
quitting.hub.send({ sessionId: quitSession.id, clientMessageId: "q-1", text: "Long question" });
quitting.hub.shutdown();
assert.equal(quitting.events.list(quitSession.id, 0).at(-1).kind, "turn.failed");
assert.throws(() => quitting.hub.send({ sessionId: quitSession.id, clientMessageId: "q-2", text: "More" }), (error) => error.code === "unsupported");

// The desktop's local reply (FIT export) is an ordinary turn to other clients.
const local = createHarness();
const localSession = local.hub.createSession("chatgpt");
const localFrames = record(local.hub, localSession.id, 0).frames;
const localTurn = local.hub.beginLocalTurn(localSession.id, "l-1", "Download my latest activity FIT file");
assert.equal(local.hub.getSession(localSession.id).activeTurn.requestId, localTurn.requestId);
local.hub.finishLocalTurn(localSession.id, localTurn.requestId, "Saved the latest activity FIT file.");
assert.deepEqual(localFrames.map((frame) => frame.event), ["entry.appended", "session.updated", "turn.started", "entry.appended", "turn.completed"]);
assert.equal(local.stream.turns.length, 0);

// Deleting a session ends its turn and forgets it.
local.hub.send({ sessionId: localSession.id, clientMessageId: "l-2", text: "Another" });
local.hub.deleteSession(localSession.id);
assert.deepEqual(local.stream.cancelled, [local.stream.turns[0].requestId]);
assert.throws(() => local.hub.getSession(localSession.id), (error) => error.code === "not_found");
assert.deepEqual(local.events.list(localSession.id, 0), []);

// Clearing a provider's chats deletes each one, running turns included, and leaves other providers alone.
const clearing = createHarness();
const clearChanges = [];
clearing.hub.onSessionsChanged((change) => clearChanges.push(change));
const clearA = clearing.hub.createSession("chatgpt");
const clearB = clearing.hub.createSession("chatgpt");
const keptSession = clearing.hub.createSession("claude-code");
clearing.hub.send({ sessionId: clearA.id, clientMessageId: "c-1", text: "Still thinking" });
clearChanges.length = 0;
assert.equal(clearing.hub.deleteAllSessions("chatgpt"), 2);
assert.deepEqual(clearing.stream.cancelled, [clearing.stream.turns[0].requestId]);
assert.deepEqual(clearing.hub.listSessions("chatgpt"), []);
assert.deepEqual(clearing.hub.listSessions("claude-code").map((summary) => summary.id), [keptSession.id]);
assert.deepEqual(
  clearChanges.map((change) => [change.kind, change.sessionId]).sort(),
  [["delete", clearA.id], ["delete", clearB.id]].sort()
);
assert.equal(clearing.hub.deleteAllSessions("chatgpt"), 0);

// After the first answer the provider names the conversation; later answers leave it.
const titleCalls = [];
const named = createHarness({ titler: async (provider, question, answer) => { titleCalls.push([provider, question, answer]); return "Long run review"; } });
const namedSession = named.hub.createSession("openrouter");
const namedFrames = record(named.hub, namedSession.id, 0).frames;
named.hub.send({ sessionId: namedSession.id, clientMessageId: "n-1", text: "How did my long run go?" });
named.stream.turns[0].send("chat:streamDone", { fullText: "Steady, with a strong finish." });
named.stream.turns[0].resolve();
await tick();
await tick();
assert.deepEqual(titleCalls, [["openrouter", "How did my long run go?", "Steady, with a strong finish."]]);
assert.equal(named.hub.getSession(namedSession.id).session.title, "Long run review");
assert.equal(named.hub.listSessions("openrouter")[0].title, "Long run review", "the new title is saved");
assert.equal(namedFrames.filter((frame) => frame.event === "session.updated").at(-1).data.session.title, "Long run review");
named.hub.send({ sessionId: namedSession.id, clientMessageId: "n-2", text: "And my tempo?" });
named.stream.turns[1].send("chat:streamDone", { fullText: "Right on pace." });
named.stream.turns[1].resolve();
await tick();
assert.equal(titleCalls.length, 1);

// A message may be only files. They reach the provider with the conversation's
// id, survive a reload, and leave with the conversation.
const removedAttachments = [];
const filed = createHarness({ attachments: { removeSession: (sessionId) => { removedAttachments.push(sessionId); } } });
const planFile = {
  id: "8f8c8d6e-0000-4000-8000-000000000001", name: "Marathon plan.pdf", kind: "document",
  mimeType: "application/pdf", sizeBytes: 52_000, pageCount: 6, textChars: 9_000
};
const photo = {
  id: "8f8c8d6e-0000-4000-8000-000000000002", name: "Track session.jpg", kind: "image",
  mimeType: "image/jpeg", sizeBytes: 210_000, width: 1568, height: 1176
};
const filedSession = filed.hub.createSession("claude-code");
assert.throws(() => filed.hub.send({ sessionId: filedSession.id, clientMessageId: "f-0", text: "  " }), (error) => error.code === "invalid");
filed.hub.send({ sessionId: filedSession.id, clientMessageId: "f-1", files: [planFile] });
assert.equal(filed.stream.turns[0].sessionId, filedSession.id);
assert.deepEqual(filed.stream.turns[0].messages, [{ role: "user", content: "", files: [planFile] }]);
assert.deepEqual(filed.hub.getSession(filedSession.id).entries[0], { kind: "message", role: "user", content: "", files: [planFile] });
assert.equal(filed.hub.listSessions("claude-code")[0].title, "Marathon plan.pdf", "a files-only question is titled by its file");
filed.stream.turns[0].send("chat:streamInfo", { kind: "coachPrompt", prompt });
filed.stream.turns[0].send("chat:streamDone", { fullText: "Six weeks of build. When do you want to start?" });
filed.stream.turns[0].resolve();
await tick();
// Files sent while a question is open are their own request, not its answer.
filed.hub.send({ sessionId: filedSession.id, clientMessageId: "f-2", text: "Here is last week too", files: [photo] });
const openPrompt = filed.hub.getSession(filedSession.id).entries.find((entry) => entry.kind === "coachPrompt");
assert.equal(openPrompt.prompt.answeredAt, undefined);
assert.deepEqual(filed.stream.turns[1].messages.at(-1), { role: "user", content: "Here is last week too", files: [photo] });
filed.stream.turns[1].send("chat:streamDone", { fullText: "Looks good." });
filed.stream.turns[1].resolve();
await tick();
const reloadedFiles = createHarness({ database: filed.database });
assert.deepEqual(
  reloadedFiles.hub.getSession(filedSession.id).entries.filter((entry) => entry.files).map((entry) => entry.files),
  [[planFile], [photo]],
  "file summaries are saved with the transcript"
);
// A summary without an id or a known kind is dropped when the transcript is read back.
const filedRow = filed.database.rows.get(filedSession.id);
const forged = JSON.parse(filedRow.messages_json);
forged[0].files.push({ name: "run.exe", kind: "program", mimeType: "application/octet-stream" });
filed.database.rows.set(filedSession.id, { ...filedRow, messages_json: JSON.stringify(forged) });
assert.deepEqual(fromPersistedEntries(getChatSession(filedSession.id, filed.database))[0].files, [planFile]);
filed.hub.deleteSession(filedSession.id);
await tick();
assert.deepEqual(removedAttachments, [filedSession.id]);

console.log("coach hub tests passed (shared stream, replay/snapshot, idempotent sends, approvals, restarts, contract shapes, AI titles, files)");
