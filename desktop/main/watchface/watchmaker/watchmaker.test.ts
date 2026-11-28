import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetStore } from "../automation/assets";
import { EditorBroker, EditorError } from "../automation/broker";
import { historyOf, latestReference, Watchmaker, type EngineJob, type WatchmakerEngine } from "./index";
import { compactDocument, watchmakerTools } from "./tools";
import type { ChatMessage } from "./chats";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const PROJECT = "11111111-2222-3333-4444-555555555555";
const temp = () => mkdtempSync(path.join(tmpdir(), "clink-watchmaker-"));

/** An engine that calls the tools it is told to, says its words, and keeps the jobs it was given. */
function scriptedEngine(steps: { tool?: { name: string; input: unknown }; say?: string }[], wait?: Promise<void>, ready = true) {
  const jobs: EngineJob[] = [];
  const engine: WatchmakerEngine = {
    status: async () => (ready ? { ready: true, label: "Codex CLI", account: "a@example.com" } : { ready: false, label: "Codex CLI", problem: "Run codex login in a terminal first." }),
    async run(job) {
      jobs.push(job);
      if (wait) await wait;
      let text = "", edits = 0, n = 0;
      for (const s of steps) {
        if (job.signal.aborted) return { text, edits, stopped: true };
        if (s.say) { text += s.say; job.emit({ t: "text", delta: s.say }); }
        if (s.tool) {
          const id = `s${++n}`;
          job.emit({ t: "step", id, tool: s.tool.name, label: s.tool.name });
          const r = await job.tools.run(s.tool.name, s.tool.input, job.signal);
          job.emit({ t: "step-done", id, ok: !r.isError });
          if (r.edited) { edits++; job.emit({ t: "edit" }); }
        }
      }
      return { text, edits, stopped: job.signal.aborted };
    },
  };
  return { engine, jobs };
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

describe("Watchmaker tools", () => {
  it("keeps the session and revision itself, and says what to do on a conflict", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 500 });
    const page = editorPage(broker);
    const tools = watchmakerTools({ broker, assets: new AssetStore(temp()), projectId: PROJECT });
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
    const tools = watchmakerTools({ broker, assets: new AssetStore(temp()), projectId: PROJECT });
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
    expect(history).toMatch(/^Person: Like this\n\(Attached: design reference img_ref\)/);
    expect(history).toMatch(/Watchmaker: Done\n\(Applied 2 steps.*img_p/s);
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
    const { engine, jobs } = scriptedEngine([{ say: "On it.", tool: { name: "apply_commands", input: { commands: [{ op: "noop" }] } } }, { say: " Blue now." }]);
    const service = new Watchmaker({ broker, assets: new AssetStore(path.join(folder, "assets")), projectsDir: path.join(folder, "projects"), engine });
    const events = await read((await service.answer(post("/send", { project: PROJECT, text: "Make it blue", attachments: [{ dataUrl: PNG_URL, use: "reference" }] })))!);
    expect(events[0]).toMatchObject({ t: "start", chat: { title: "Make it blue" } });
    expect(events.map((e) => e.t)).toEqual(expect.arrayContaining(["text", "step", "step-done", "edit", "done"]));
    const done = events.at(-1) as { message: ChatMessage; chat: { id: string } };
    expect(done.message).toMatchObject({ text: "On it. Blue now.", edits: 1, by: "Codex CLI" });
    expect(page.applied).toEqual([[{ op: "noop" }]]);
    // Codex got the rules, the face's document, the request, the reference and the face as pictures.
    const first = jobs[0];
    expect(first.instructions).toMatch(/running as the Codex CLI/);
    expect(first.prompt).toMatch(/The open face:\n.*"revision":3/);
    expect(first.prompt).toMatch(/The person now asks:\n\nMake it blue/);
    expect(first.pictures).toHaveLength(2);
    // Saved with the face, and listed.
    const list = await (await service.answer(new Request(`clink://app/api/desktop/studio/watchmaker/chats?project=${PROJECT}`)))!.json() as { chats: { id: string; messages: number }[] };
    expect(list.chats).toEqual([expect.objectContaining({ id: done.chat.id, messages: 2 })]);
    // A follow-up carries the conversation and the earlier reference.
    await read((await service.answer(post("/send", { project: PROJECT, chatId: done.chat.id, text: "Darker" })))!);
    expect(jobs.at(-1)!.prompt).toMatch(/The conversation so far:\n\nPerson: Make it blue/);
    expect(jobs.at(-1)!.prompt).toMatch(/Design reference from earlier img_/);
    const removed = await (await service.answer(post(`/chats/${done.chat.id}/delete`, { project: PROJECT })))!.json() as { chats: unknown[] };
    expect(removed.chats).toEqual([]);
  });

  it("says when Codex isn't ready, refuses another page's request, and stops a run", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 500 });
    editorPage(broker);
    const folder = temp();
    const none = new Watchmaker({ broker, assets: new AssetStore(folder), projectsDir: folder, engine: scriptedEngine([], undefined, false).engine });
    const refused = (await none.answer(post("/send", { project: PROJECT, text: "Hi" })))!;
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ message: /codex login/ });
    expect(await (await none.answer(new Request("clink://app/api/desktop/studio/watchmaker")))!.json()).toMatchObject({ ready: false, label: "Codex CLI", running: [] });
    expect((await none.answer(new Request("clink://app/api/desktop/studio/watchmaker/send", { method: "POST", body: "{}" })))!.status).toBe(403);

    let release!: () => void;
    const { engine } = scriptedEngine([{ tool: { name: "validate", input: {} } }], new Promise((r) => { release = r; }));
    const service = new Watchmaker({ broker, assets: new AssetStore(folder), projectsDir: folder, engine });
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
