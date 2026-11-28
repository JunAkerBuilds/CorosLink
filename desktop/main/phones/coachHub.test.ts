import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStore } from "../localStore";
import { CoachHub, type AskApi, type EventFrame } from "./coachHub";
import { conversationEntries } from "./coachEntries";

const lines = (...events: object[]) => new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), { headers: { "Content-Type": "application/x-ndjson" } });

function setUp(answer: (path: string, body: unknown) => Response | Promise<Response> = () => lines(
  { t: "text", delta: "Easy " }, { t: "text", delta: "day." },
  { t: "done", blocks: [{ kind: "text", text: "Easy day." }], suggestions: ["Why?"], sources: [], tokens: 10 },
)) {
  const store = new LocalStore(path.join(mkdtempSync(path.join(tmpdir(), "coach-hub-")), "clink.db"));
  const asked: { path: string; body: unknown }[] = [];
  const ask: AskApi = async (p, body) => { asked.push({ path: p, body }); return p === "/api/ai/title" ? Response.json({ title: "Rest day" }) : answer(p, body); };
  const hub = new CoachHub({ items: () => store, ask, provider: async () => "claude-code", pollMs: 60_000 });
  const frames: EventFrame[] = [];
  return { store, hub, asked, frames, client: { send: (f: EventFrame) => frames.push(f) } };
}

const settle = async (hub: CoachHub, id: string) => {
  for (let i = 0; i < 50 && (await hub.getSession(id)).activeTurn; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 5));
};

describe("Coach for phones", () => {
  it("answers a phone's question, saves it as the Coach page does, and numbers every event", async () => {
    const { store, hub, asked, frames, client } = setUp();
    const { session } = await hub.createSession();
    expect((await hub.listSessions()).map((s) => s.id)).toEqual([session.id]);
    const sub = await hub.subscribe(client, session.id, null);
    expect(sub).toMatchObject({ mode: "snapshot", snapshot: { entries: [], activeTurn: null } });
    const start = sub.mode === "snapshot" ? sub.snapshot.cursor : 0;

    const { requestId } = await hub.send({ sessionId: session.id, clientMessageId: "m1", text: "How hard today?" });
    await settle(hub, session.id);

    // One numbering, no gaps, from the snapshot's cursor.
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => start + i + 1));
    expect(frames.map((f) => f.event)).toEqual(expect.arrayContaining(["entry.appended", "turn.started", "turn.delta", "turn.completed"]));
    expect(frames.find((f) => f.event === "turn.started")!.data).toEqual({ requestId });

    // Saved in the page's own format, so the Coach page shows it.
    expect(store.get("coach.message", `${session.id}.0000`)).toMatchObject({ conversationId: session.id, n: 0, message: { from: "you", text: "How hard today?" } });
    expect(store.get("coach.message", `${session.id}.0001`)).toMatchObject({ n: 1, message: { from: "coach", blocks: [{ kind: "text", text: "Easy day." }] } });
    expect(store.get("coach.conversation", session.id)).toMatchObject({ suggestions: ["Why?"] });
    expect((await hub.getSession(session.id)).entries).toEqual([
      { kind: "message", role: "user", content: "How hard today?" },
      { kind: "message", role: "assistant", content: "Easy day." },
    ]);
    expect(asked[0]).toMatchObject({ path: "/api/coach", body: { text: "How hard today?", history: [] } });
    // The AI names a new conversation, as on the page.
    expect(store.get("coach.conversation", session.id)?.title).toBe("Rest day");
  });

  it("runs a resent message once and refuses a second question while answering", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { hub } = setUp(async () => { await gate; return lines({ t: "done", blocks: [{ kind: "text", text: "Ok" }], suggestions: [], sources: [], tokens: 1 }); });
    const { session } = await hub.createSession();
    const first = await hub.send({ sessionId: session.id, clientMessageId: "same", text: "Hi" });
    expect(await hub.send({ sessionId: session.id, clientMessageId: "same", text: "Hi" })).toEqual(first);
    await expect(hub.send({ sessionId: session.id, clientMessageId: "other", text: "Again" })).rejects.toMatchObject({ code: "busy" });
    release();
    await settle(hub, session.id);
  });

  it("replays what a phone missed, and gives a snapshot for a cursor it no longer has", async () => {
    const { hub, client } = setUp();
    const { session } = await hub.createSession();
    const snap = await hub.subscribe(client, session.id, null);
    const cursor = snap.mode === "snapshot" ? snap.snapshot.cursor : -1;
    await hub.send({ sessionId: session.id, clientMessageId: "a", text: "Hi" });
    await settle(hub, session.id);
    const missed: EventFrame[] = [];
    expect(await hub.subscribe({ send: (f) => missed.push(f) }, session.id, cursor)).toEqual({ mode: "replay" });
    await new Promise((r) => setTimeout(r, 1));
    expect(missed[0].seq).toBe(cursor + 1);
    expect(await hub.subscribe(client, session.id, 5)).toMatchObject({ mode: "snapshot" });
  });

  it("passes on what the Coach page wrote, and starts the phone over when something was taken away", async () => {
    const { store, hub, frames, client } = setUp();
    const { session } = await hub.createSession();
    await hub.send({ sessionId: session.id, clientMessageId: "a", text: "Hi" });
    await settle(hub, session.id);
    await hub.subscribe(client, session.id, null);
    store.write([{ collection: "coach.message", id: `${session.id}.0002`, body: { conversationId: session.id, n: 2, at: 0, message: { id: "x", from: "you", text: "From the page" } } }]);
    await hub.check();
    expect(frames.at(-1)).toMatchObject({ event: "entry.appended", data: { index: 2, entry: { role: "user", content: "From the page" } } });

    const before = frames.at(-1)!.seq;
    store.write([{ collection: "coach.message", id: `${session.id}.0002`, deleted: true }]);
    await hub.check();
    // A skipped number: C-LINK asks for everything after its cursor, which is a snapshot now.
    expect(frames.at(-1)!.seq).toBe(before + 2);
    expect(await hub.subscribe(client, session.id, before)).toMatchObject({ mode: "snapshot", snapshot: { entries: [{ role: "user" }, { role: "assistant" }] } });
  });

  it("answers Coach's question with the choice's words and marks it answered", async () => {
    const { store, hub } = setUp();
    const id = "C1";
    store.write([
      { collection: "coach.conversation", id, body: { title: "Plan", startedAt: 0, updatedAt: 0 } },
      { collection: "coach.message", id: `${id}.0000`, body: { conversationId: id, n: 0, at: 0, message: { id: "q", from: "coach", blocks: [{ kind: "question", id: "Q1", title: "Which day?", options: [{ id: "sat", title: "Saturday", detail: "" }] }] } } },
    ]);
    expect((await hub.getSession(id)).entries[0]).toMatchObject({ kind: "coachPrompt", prompt: { promptId: "Q1", question: "Which day?", choices: [{ id: "sat", label: "Saturday" }] } });
    await hub.send({ sessionId: id, clientMessageId: "p", promptAnswer: { promptId: "Q1", choiceId: "sat" } });
    await settle(hub, id);
    expect(store.get("coach.message", `${id}.0001`)).toMatchObject({ message: { from: "you", text: "Saturday" } });
    expect((await hub.getSession(id)).entries[0]).toMatchObject({ prompt: { answer: "Saturday" } });
  });

  it("saves a failed answer as the page does, and says so", async () => {
    const { hub, frames, client, store } = setUp(() => lines({ t: "text", delta: "Hal" }, { t: "error", code: "model", message: "The AI refused." }));
    const { session } = await hub.createSession();
    await hub.subscribe(client, session.id, null);
    await hub.send({ sessionId: session.id, clientMessageId: "a", text: "Hi" });
    await settle(hub, session.id);
    expect(frames.at(-1)).toMatchObject({ event: "turn.failed", data: { message: "The AI refused." } });
    expect(store.get("coach.message", `${session.id}.0001`)).toMatchObject({ message: { blocks: [{ kind: "text", text: "Hal" }, { kind: "failed", text: "The AI refused." }] } });
  });

  it("deletes a conversation for every device", async () => {
    const { hub, store } = setUp();
    const { session } = await hub.createSession();
    await hub.send({ sessionId: session.id, clientMessageId: "a", text: "Hi" });
    await settle(hub, session.id);
    await hub.deleteSession(session.id);
    expect(store.get("coach.conversation", session.id)).toBeUndefined();
    expect(store.list("coach.message")).toHaveLength(0);
    await expect(hub.getSession(session.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("a conversation as the phone reads it", () => {
  it("keeps words, questions and notes, and lists cards by title", () => {
    expect(conversationEntries([
      { id: "1", from: "you", text: "Look", files: ["plan.pdf"] },
      { id: "2", from: "coach", blocks: [
        { kind: "text", text: "First." }, { kind: "text", text: "Second." },
        { kind: "workout", id: "w", eyebrow: "Tomorrow", title: "Easy 8 km" },
        { kind: "note", id: "n", note: "remembered", text: "Knee is sore" },
        { kind: "working", id: "k", title: "Reading", steps: [] },
      ] },
      { nonsense: true },
    ])).toEqual([
      { kind: "message", role: "user", content: "Look", attachment: { label: "plan.pdf" } },
      { kind: "message", role: "assistant", content: "First.\n\nSecond." },
      { kind: "coachChart", preview: { title: "Tomorrow · Easy 8 km" } },
      { kind: "toolNotice", message: "Knee is sore" },
    ]);
  });
});
