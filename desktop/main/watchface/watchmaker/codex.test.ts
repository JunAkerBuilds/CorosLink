// The Codex engine against a scripted `codex` program that speaks the app-server protocol over stdio and calls the
// watchmaker tools over the real MCP bridge, as the CLI does. Carried over from CorosLink's
// test-watchface-codex-cli.mjs: the thread's sandbox and MCP config, tool calls and their pictures, Codex's own items as
// steps, native images copied into the asset store, files imported only from Codex's folder, failure, cancellation
// and the folder removed afterwards.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetStore } from "../automation/assets";
import { codexAccount, runCodex } from "./codex";
import type { ToolResult, WatchmakerEvent, WatchmakerTools } from "./tools";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const temp = () => mkdtempSync(path.join(tmpdir(), "clink-codex-"));

/** The fake CLI: answers the handshake, then plays `scenario` once a turn starts. Writes what it saw to `report`. */
function fakeCodex(scenario: string, report: string): string {
  const file = path.join(temp(), "codex");
  writeFileSync(file, `#!${process.execPath}
const fs = require("node:fs");
const PNG = ${JSON.stringify(PNG.toString("base64"))};
const seen = { argv: process.argv.slice(2), cwd: process.cwd(), results: {} };
const save = () => fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify(seen));
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const note = (method, params) => out({ method, params });
let mcp, n = 0;
async function tool(name, args) {
  const r = await fetch(mcp.url, { method: "POST", headers: { Authorization: "Bearer " + process.env[mcp.bearer_token_env_var], "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) });
  return (await r.json()).result;
}
const say = (item, delta) => note("item/agentMessage/delta", { threadId: "th1", turnId: "tu1", itemId: item, delta });
const scenarios = {
  async work() {
    note("turn/started", { threadId: "th1", turn: { id: "tu1" } });
    say("m1", "Working on it.");
    seen.results.doc = await tool("get_document", {});
    seen.results.apply = await tool("apply_commands", { commands: [{ op: "noop" }] });
    seen.results.preview = await tool("render_preview", {});
    note("item/started", { item: { type: "commandExecution", id: "c1", command: "ls", status: "inProgress" } });
    note("item/completed", { item: { type: "commandExecution", id: "c1", command: "ls", status: "completed", exitCode: 0 } });
    note("item/started", { item: { type: "imageGeneration", id: "ig1", status: "inProgress" } });
    note("item/completed", { item: { type: "imageGeneration", id: "ig1", status: "completed", revisedPrompt: "A calm blue dial", result: PNG } });
    // Our own tool calls show up as items too; they aren't shown twice.
    note("item/started", { item: { type: "mcpToolCall", id: "t1", server: "watchmaker", tool: "get_generated_images", status: "inProgress" } });
    seen.results.generated = await tool("get_generated_images", {});
    fs.writeFileSync("made.png", Buffer.from(PNG, "base64"));
    seen.results.imported = await tool("import_file", { path: "made.png" });
    seen.results.outside = await tool("import_file", { path: ${JSON.stringify(path.join(tmpdir(), "elsewhere.png"))} });
    say("m2", "Done: blue.");
    save();
    note("turn/completed", { threadId: "th1", turn: { id: "tu1", status: "completed" } });
  },
  async hang() {
    note("turn/started", { threadId: "th1", turn: { id: "tu1" } });
    say("m1", "Thinking");
    save();
  },
  async fail() {
    note("turn/completed", { threadId: "th1", turn: { id: "tu1", status: "failed", error: { message: "You've hit your usage limit." } } });
  },
};
let buffer = "";
process.stdin.on("data", (d) => {
  buffer += d;
  const lines = buffer.split("\\n"); buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") out({ id: m.id, result: { userAgent: "fake" } });
    else if (m.method === "account/read") out({ id: m.id, result: { account: { type: "chatgpt", email: "a@example.com" }, requiresOpenaiAuth: true } });
    else if (m.method === "thread/start") { seen.thread = m.params; mcp = m.params.config["mcp_servers.watchmaker"]; out({ id: m.id, result: { thread: { id: "th1" } } }); }
    else if (m.method === "turn/start") { seen.turn = m.params; out({ id: m.id, result: { turn: { id: "tu1" } } }); save(); scenarios[${JSON.stringify(scenario)}]().catch((e) => { seen.error = String(e); save(); }); }
    else if (m.method === "turn/interrupt") { seen.interrupted = true; save(); out({ id: m.id, result: {} }); note("turn/completed", { threadId: "th1", turn: { id: "tu1", status: "interrupted" } }); }
  }
});
`);
  chmodSync(file, 0o755);
  return file;
}

/** Tools standing in for the editor: edits count, previews come back as pictures. */
function stubTools(assets: AssetStore): WatchmakerTools & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    defs: [
      { name: "get_document", description: "d", input_schema: { type: "object", properties: {}, required: [] } },
      { name: "apply_commands", description: "a", input_schema: { type: "object", properties: { commands: { type: "array" } }, required: ["commands"] } },
      { name: "render_preview", description: "r", input_schema: { type: "object", properties: {}, required: [] } },
    ],
    async run(name): Promise<ToolResult> {
      calls.push(name);
      if (name === "apply_commands") return { text: "{\"revision\":4}", edited: true };
      if (name === "render_preview") { const assetId = await assets.put(PNG); return { text: JSON.stringify({ assetId }), pictures: [{ assetId, why: "Preview" }] }; }
      return { text: "{\"revision\":3}" };
    },
    read: async () => ({}),
    session: () => null,
  };
}

const job = (program: string, folder: string, signal = new AbortController().signal) => {
  const assets = new AssetStore(path.join(folder, "assets"));
  const tools = stubTools(assets);
  const events: WatchmakerEvent[] = [];
  return { assets, tools, events, run: () => runCodex({ program, instructions: "RULES", prompt: "Make it blue", pictures: [{ name: "ref.png", bytes: PNG }], tools, assets, emit: (e) => events.push(e), signal }) };
};

describe("Codex engine", () => {
  it("runs a turn in Codex's own harness with the watchmaker tools, and keeps its generated images", async () => {
    const folder = temp();
    const report = path.join(folder, "report.json");
    const { assets, tools, events, run } = job(fakeCodex("work", report), folder);
    const outcome = await run();
    expect(outcome).toEqual({ text: "Working on it.\n\nDone: blue.", edits: 1, stopped: false });
    const seen = JSON.parse(readFileSync(report, "utf8"));
    // The app-server over stdio, in a fresh folder, sandboxed to it, with network, native images and our MCP server.
    expect(seen.argv).toEqual(["app-server", "--listen", "stdio://"]);
    expect(seen.thread).toMatchObject({ cwd: seen.cwd, approvalPolicy: "never", sandbox: "workspace-write", ephemeral: true, developerInstructions: "RULES" });
    expect(seen.thread.config).toMatchObject({ "sandbox_workspace_write.network_access": true, "features.image_generation": true, "mcp_servers.watchmaker": { bearer_token_env_var: "CLINK_WATCHMAKER_TOKEN", required: true, default_tools_approval_mode: "approve" } });
    expect(seen.thread.config["mcp_servers.watchmaker"].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    // The message, with its picture attached and saved in the folder.
    expect(seen.turn.input[0].text).toMatch(/^Make it blue[\s\S]*1-ref\.png/);
    expect(seen.turn.input[1]).toEqual({ type: "localImage", path: path.join(seen.cwd, "1-ref.png") });
    // Tools ran against the face; a preview came back as a picture and a file.
    expect(tools.calls).toEqual(["get_document", "apply_commands", "render_preview"]);
    expect(seen.results.preview.content.map((c: { type: string }) => c.type)).toEqual(["text", "image"]);
    expect(seen.results.preview.content[0].text).toMatch(/Saved in your folder/);
    // Codex's native image is in the asset store, and its id is handed back.
    const generated = JSON.parse(seen.results.generated.content[0].text).images;
    expect(generated).toEqual([{ assetId: expect.stringMatching(/^img_/), width: 1, height: 1, prompt: "A calm blue dial" }]);
    expect((await assets.get(generated[0].assetId)).bytes.equals(PNG)).toBe(true);
    // Files come in only from Codex's own folder.
    expect(JSON.parse(seen.results.imported.content[0].text.split("\n")[0]).assetId).toMatch(/^img_/);
    expect(seen.results.outside.isError).toBe(true);
    // The chat saw its own steps, Codex's command and image, but not our tools twice.
    const steps = events.filter((e) => e.t === "step").map((e) => (e as { tool: string }).tool);
    expect(steps).toEqual(["get_document", "apply_commands", "render_preview", "codex_commandExecution", "codex_imageGeneration", "get_generated_images", "import_file", "import_file"]);
    expect(events.filter((e) => e.t === "picture").map((e) => (e as { why: string }).why)).toEqual(["Preview", "Generated image", "Imported image"]);
    expect(events.filter((e) => e.t === "step-done" && !e.ok)).toHaveLength(1);
    // The folder is gone.
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it("stops: interrupts the turn, ends the program and keeps what was said", async () => {
    const folder = temp();
    const report = path.join(folder, "report.json");
    const abort = new AbortController();
    const { events, run } = job(fakeCodex("hang", report), folder, abort.signal);
    const running = run();
    for (let i = 0; i < 100 && !events.some((e) => e.t === "text"); i++) await new Promise((r) => setTimeout(r, 30));
    abort.abort();
    await expect(running).resolves.toEqual({ text: "Thinking", edits: 0, stopped: true });
    expect(JSON.parse(readFileSync(report, "utf8")).interrupted).toBe(true);
  });

  it("says why a turn failed", async () => {
    const folder = temp();
    await expect(job(fakeCodex("fail", path.join(folder, "r.json")), folder).run()).rejects.toThrow(/usage limit/);
  });

  it("says when Codex can't start, and reads the sign-in", async () => {
    const folder = temp();
    await expect(job(path.join(folder, "missing-codex"), folder).run()).rejects.toThrow();
    expect(await codexAccount(fakeCodex("work", path.join(folder, "r.json")))).toEqual({ ready: true, account: "a@example.com" });
  });
});
