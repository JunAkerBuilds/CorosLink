import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CoachModel, ModelRequest, ModelTurn, ToolCall } from "@/lib/coach/loop";
import { AssetStore } from "../automation/assets";
import { EditorBroker, EditorError } from "../automation/broker";
import { compactPictures, runWatchmaker, type WatchmakerEvent } from "./loop";
import { historyOf, latestReference, Watchmaker } from "./index";
import { compactDocument, watchmakerTools } from "./tools";
import type { ChatMessage } from "./chats";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const PROJECT = "11111111-2222-3333-4444-555555555555";
const temp = () => mkdtempSync(path.join(tmpdir(), "clink-watchmaker-"));

/** A model that answers from a script, one turn per call, and keeps what it was asked. */
function scripted(turns: ({ calls: Omit<ToolCall, "id">[]; text?: string } | { text: string })[], wait?: Promise<void>) {
  const asked: ModelRequest[] = [];
  let n = 0;
  const model: CoachModel = {
    async turn(request): Promise<ModelTurn> {
      asked.push({ ...request, messages: structuredClone(request.messages) });
      if (wait) await wait;
      if (request.signal?.aborted) throw new Error("aborted");
      const next = turns.shift() ?? { text: "Done." };
      const calls = "calls" in next ? next.calls.map((c) => ({ ...c, id: `c${++n}` })) : [];
      request.onText(next.text ?? "");
      return { content: { calls }, text: next.text ?? "", calls, stop: calls.length ? "tools" : "end", inputTokens: 1, outputTokens: 1 };
    },
  };
  return { model, asked };
}

/** A face in an editor page on the other end of the broker. */
function editorPage(broker: EditorBroker, options: { projectId?: string } = {}) {
  const state = { revision: 3, background: "#000000", applied: [] as unknown[] };
  const answer = (method: string, params: Record<string, unknown>): unknown => {
    const needRevision = ["apply_commands", "undo", "save"].includes(method);
    if (params.sessionId !== undefined && params.sessionId !== "s1") throw new EditorError("STALE_SESSION", "other session");
    if (needRevision && params.baseRevision !== state.revision) throw new EditorError("REVISION_CONFLICT", `revision ${String(params.baseRevision)} is stale`);
    switch (method) {
      case "get_document": return {
        sessionId: "s1", revision: state.revision, project: { projectId: options.projectId ?? PROJECT, name: "Face" }, view: { mode: "current", selectedIds: [] },
        capabilities: { aod: true, placement: { width: 800, height: 800 }, resolutions: [{ width: 800 }, { width: 416 }], layers: [{ id: "hours", kind: "time", label: "Hours", visible: true, placement: { bounds: { x: 1, y: 2, width: 3, height: 4 }, movable: true } }], assetContracts: [1, 2] },
        design: { backgroundColor: state.background, artwork: { dataUrl: PNG_URL } }, diagnostics: [{ severity: "warning", code: "w" }, { severity: "error", code: "e" }], canUndo: false,
      };
      case "apply_commands": state.revision++; state.applied.push(params.commands); return { sessionId: "s1", revision: state.revision, changedLayerIds: [] };
      case "undo": state.revision++; return { sessionId: "s1", revision: state.revision };
      case "render_preview": return { sessionId: "s1", revision: state.revision, mode: params.mode ?? "current", width: 800, dataUrl: PNG_URL };
      case "validate": return { valid: true, diagnostics: [] };
      default: throw new EditorError("METHOD_NOT_FOUND", method);
    }
  };
  const response = broker.open();
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buffer += value;
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!line) continue;
        const r = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
        try { broker.reply({ id: r.id, result: answer(r.method, r.params) }); } catch (e) { broker.reply({ id: r.id, error: { code: (e as EditorError).code, message: (e as Error).message } }); }
      }
    }
  })();
  return state;
}

describe("Watchmaker loop", () => {
  it("runs tool calls round by round, counts edits and shows pictures to a model that can see them", async () => {
    const { model, asked } = scripted([
      { text: "Making it blue.", calls: [{ name: "apply_commands", input: {} }, { name: "render_preview", input: {} }] },
      { text: "The background is blue now." },
    ]);
    const events: WatchmakerEvent[] = [];
    const outcome = await runWatchmaker({
      model, rules: "r", context: "c", messages: [{ role: "user", content: "Blue please" }], tools: [],
      runTool: async (name) => (name === "apply_commands" ? { text: "{}", edited: true } : { text: "{}", pictures: [{ assetId: "img_a", why: "Preview" }] }),
      picture: async (id) => ({ name: id, mime: "image/png", kind: "image", data: "AA==" }), seesPictures: true, emit: (e) => events.push(e),
    });
    expect(outcome).toMatchObject({ edits: 1, rounds: 2, stopped: false, text: "Making it blue.\n\nThe background is blue now." });
    expect(events.filter((e) => e.t === "step").map((e) => (e as { label: string }).label)).toEqual(["Editing the face", "Drawing a preview"]);
    expect(events.some((e) => e.t === "picture")).toBe(true);
    // Second round: tool results, then the picture as its own message.
    const second = asked[1].messages;
    expect((second[2].content as { type: string }[])[0].type).toBe("tool_result");
    expect(second[3]).toEqual({ role: "assistant", content: "I'll look at the pictures." });
    expect((second[4].content as { type: string }[]).map((p) => p.type)).toEqual(["text", "file"]);
  });

  it("gives an agent provider only the tool text", async () => {
    const { model, asked } = scripted([{ calls: [{ name: "render_preview", input: {} }] }, { text: "Ok" }]);
    await runWatchmaker({
      model, rules: "", context: "", messages: [{ role: "user", content: "Look" }], tools: [],
      runTool: async () => ({ text: "{}", pictures: [{ assetId: "img_a", why: "Preview" }] }), picture: async () => ({ name: "a", mime: "image/png", kind: "image", data: "" }),
      seesPictures: false, emit: () => undefined,
    });
    expect(asked[1].messages).toHaveLength(3);
  });

  it("keeps only the newest pictures", () => {
    const pictures = (n: number) => ({ role: "user" as const, content: [{ type: "text", text: `Pictures from the tools above, in order: ${n}` }, { type: "file", file: { name: "a", mime: "image/png", kind: "image", data: "" } }] });
    const kept = compactPictures([pictures(1), pictures(2), pictures(3)]);
    expect(typeof kept[0].content).toBe("string");
    expect(Array.isArray(kept[1].content)).toBe(true);
    expect(Array.isArray(kept[2].content)).toBe(true);
  });

  it("stops when asked, mid-way", async () => {
    let release!: () => void;
    const { model } = scripted([{ calls: [{ name: "apply_commands", input: {} }] }], new Promise((r) => { release = r; }));
    const abort = new AbortController();
    const running = runWatchmaker({ model, rules: "", context: "", messages: [{ role: "user", content: "x" }], tools: [], runTool: async () => ({ text: "{}" }), picture: async () => null, seesPictures: true, emit: () => undefined, signal: abort.signal });
    abort.abort();
    release();
    await expect(running).resolves.toMatchObject({ stopped: true, edits: 0 });
  });
});

describe("Watchmaker tools", () => {
  it("keeps the session and revision itself, and says what to do on a conflict", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 500 });
    const page = editorPage(broker);
    const tools = watchmakerTools({ broker, assets: new AssetStore(temp()), makeImage: null, projectId: PROJECT });
    expect(tools.defs.some((d) => d.name === "generate_image")).toBe(false);
    expect((await tools.run("apply_commands", { commands: [{}] })).isError).toBe(true);
    const doc = JSON.parse((await tools.run("get_document", {})).text);
    expect(doc).toMatchObject({ revision: 3, capabilities: { resolutions: [800, 416], layers: [{ id: "hours", box: { x: 1 } }] } });
    expect(doc.diagnostics[0].severity).toBe("error");
    expect(doc.design).toBeUndefined();
    const full = JSON.parse((await tools.run("get_document", { full: true })).text);
    expect(full.design.artwork.dataUrl).toEqual({ assetId: expect.stringMatching(/^img_/) });
    const applied = await tools.run("apply_commands", { commands: [{ op: "set", path: "/design/backgroundColor", value: "#123456" }] });
    expect(applied).toMatchObject({ edited: true });
    expect(tools.session()).toEqual({ sessionId: "s1", revision: 4 });
    // The person edits meanwhile.
    page.revision = 9;
    const stale = await tools.run("apply_commands", { commands: [{}] });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/REVISION_CONFLICT.*call get_document/);
    await tools.run("get_document", {});
    expect((await tools.run("undo", {})).edited).toBe(true);
    const preview = await tools.run("render_preview", {});
    expect(preview.pictures?.[0].assetId).toMatch(/^img_/);
    expect((await tools.run("update_plan", { items: [{ text: "Recolour", status: "doing" }, { text: "" }] })).plan).toEqual([{ text: "Recolour", status: "doing" }]);
  });

  it("refuses a face that isn't the one the chat belongs to", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 500 });
    editorPage(broker, { projectId: "99999999-2222-3333-4444-555555555555" });
    const tools = watchmakerTools({ broker, assets: new AssetStore(temp()), makeImage: null, projectId: PROJECT });
    expect((await tools.run("get_document", {})).text).toMatch(/NO_OPEN_PROJECT/);
  });

  it("compacts a document", () => {
    expect(compactDocument({ capabilities: { assetContracts: [1, 2, 3] } }).capabilities).toMatchObject({ assetContracts: expect.stringMatching(/^3 contracts/) });
  });
});

describe("Watchmaker chats", () => {
  const user = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: text, role: "user", at: "", text, ...extra });
  it("carries the earlier conversation as text and remembers the design reference", () => {
    const messages: ChatMessage[] = [
      user("Like this", { attachments: [{ assetId: "img_ref", use: "reference" }] }),
      { id: "a", role: "assistant", at: "", text: "Done", edits: 2, pictures: [{ assetId: "img_p", why: "Preview" }] },
      user("Broken?", { attachments: [{ assetId: "img_bug", use: "screenshot" }] }),
    ];
    const history = historyOf(messages);
    expect(history[0].content).toMatch(/design reference img_ref/);
    expect(history[1].content).toMatch(/Applied 2 steps.*img_p/s);
    expect(latestReference(messages)?.assetId).toBe("img_ref");
  });
});

describe("Watchmaker service", () => {
  const read = async (response: Response) => {
    const lines = (await response.text()).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    return lines;
  };
  const post = (route: string, body: unknown) => new Request(`clink://app/api/desktop/studio/watchmaker${route}`, { method: "POST", headers: { "x-clink-hub": "1" }, body: JSON.stringify(body) });

  it("answers a message as a stream, edits the face, and saves the chat with the face", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 500 });
    const page = editorPage(broker);
    const folder = temp();
    const { model, asked } = scripted([{ text: "On it.", calls: [{ name: "apply_commands", input: { commands: [{ op: "noop" }] } }] }, { text: "Blue now." }]);
    const service = new Watchmaker({ broker, assets: new AssetStore(path.join(folder, "assets")), projectsDir: path.join(folder, "projects"), model: async () => ({ model, label: "Test · m", provider: "anthropic" }), imageMaker: async () => null });
    const events = await read((await service.answer(post("/send", { project: PROJECT, text: "Make it blue", attachments: [{ dataUrl: PNG_URL, use: "reference" }] })))!);
    expect(events[0]).toMatchObject({ t: "start", chat: { title: "Make it blue" } });
    expect(events.map((e) => e.t)).toEqual(expect.arrayContaining(["text", "step", "step-done", "edit", "done"]));
    const done = events.at(-1) as { message: ChatMessage; chat: { id: string } };
    expect(done.message).toMatchObject({ text: "On it.\n\nBlue now.", edits: 1, by: "Test · m" });
    expect(page.applied).toEqual([[{ op: "noop" }]]);
    // The model saw the face's document, the reference and the face as pictures.
    const first = asked[0];
    expect(first.context).toMatch(/"revision":3/);
    expect((first.messages[0].content as { type: string }[]).filter((p) => p.type === "file")).toHaveLength(2);
    // Saved with the face, and listed.
    const list = await (await service.answer(new Request(`clink://app/api/desktop/studio/watchmaker/chats?project=${PROJECT}`)))!.json() as { chats: { id: string; messages: number }[] };
    expect(list.chats).toEqual([expect.objectContaining({ id: done.chat.id, messages: 2 })]);
    // A follow-up carries the conversation.
    await read((await service.answer(post("/send", { project: PROJECT, chatId: done.chat.id, text: "Darker" })))!);
    expect(asked.at(-1)!.messages[0].content).toMatch(/Make it blue/);
    const removed = await (await service.answer(post(`/chats/${done.chat.id}/delete`, { project: PROJECT })))!.json() as { chats: unknown[] };
    expect(removed.chats).toEqual([]);
  });

  it("says when no AI is set up, refuses another page's request, and stops a run", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 500 });
    editorPage(broker);
    const folder = temp();
    const none = new Watchmaker({ broker, assets: new AssetStore(folder), projectsDir: folder, model: async () => null, imageMaker: async () => null });
    expect((await none.answer(post("/send", { project: PROJECT, text: "Hi" })))!.status).toBe(400);
    expect((await none.answer(new Request("clink://app/api/desktop/studio/watchmaker/send", { method: "POST", body: "{}" })))!.status).toBe(403);

    let release!: () => void;
    const { model } = scripted([{ calls: [{ name: "validate", input: {} }] }], new Promise((r) => { release = r; }));
    const service = new Watchmaker({ broker, assets: new AssetStore(folder), projectsDir: folder, model: async () => ({ model, label: "x", provider: "claude-code" }), imageMaker: async () => null });
    const running = (await service.answer(post("/send", { project: PROJECT, text: "Go" })))!;
    const reading = read(running);
    await new Promise((r) => setTimeout(r, 50));
    expect((await service.answer(post("/send", { project: PROJECT, text: "Again" })))!.status).toBe(409);
    expect(await (await service.answer(post("/stop", { project: PROJECT })))!.json()).toEqual({ stopped: true });
    release();
    const done = (await reading).at(-1) as { message: ChatMessage };
    expect(done.message.stopped).toBe(true);
  });
});
