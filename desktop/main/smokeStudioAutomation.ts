// `CLINK_SMOKE_STUDIO_AUTOMATION=1` (with CLINK_SMOKE): the watch-face MCP server against the real editor. Opens COROS's
// SIMPLE template for PACE Pro, turns automation on in Settings, takes the Codex configuration off the clipboard, then
// talks MCP over HTTP as an outside agent would: reads the face, recolours it and moves a layer in one step, draws a
// preview, checks contrast, validates, undoes and redoes, and is refused on a stale revision. Turns it off at the end.
// Shots are `studio-automation-*.png`; the drawn preview is `studio-automation-preview.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { clipboard, type BrowserWindow } from "electron";

export async function smokeStudioAutomation(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(500);
    try { writeFileSync(path.join(folder, `studio-automation-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const say = (line: string) => log.push(`--- studio automation: ${line}`);

  // Settings → External AI: on, then the Codex configuration onto the clipboard.
  await window.loadURL(`${origin}/settings/ai`);
  await wait(1500);
  say(`switch ${await run(`(() => { const s = document.querySelector('[aria-label="Watch-face MCP server"]'); s?.click(); return !!s; })()`)}`);
  await until(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Copy Codex configuration")`, 10);
  await run(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Copy Codex configuration")?.click()`);
  await wait(800);
  await shot("settings");
  const config = await clipboard.readText();
  const url = /url = "([^"]+)"/.exec(config)?.[1];
  const token = /Bearer ([\w-]+)/.exec(config)?.[1];
  say(`configuration ${url ?? "none"} token ${token ? "copied" : "missing"}`);
  if (!url || !token) return;

  let n = 0;
  const mcp = async (method: string, params: Record<string, unknown> = {}) => {
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
    return (await r.json()) as { result?: { content?: { type: string; text?: string; data?: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: unknown };
  };
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const answer = await mcp("tools/call", { name, arguments: args });
    const content = answer.result?.content ?? [];
    return { error: !!answer.result?.isError, json: JSON.parse(content[0]?.text ?? "null") as Record<string, unknown>, image: content.find((c) => c.type === "image")?.data };
  };
  say(`unauthorised ${(await fetch(url, { method: "POST", body: "{}" })).status}`);
  say(`initialize ${JSON.stringify((await mcp("initialize", { protocolVersion: "2025-06-18" })).result).slice(0, 120)}`);
  say(`tools ${(await mcp("tools/list")).result?.tools?.map((t) => t.name).join(", ")}`);
  say(`context before ${JSON.stringify((await tool("get_context")).json)}`);

  // A face to work on, opened in the editor.
  await window.loadURL(`${origin}/studio`);
  await wait(1500);
  const made = String(await run(`fetch("/api/desktop/studio/projects", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify({ watch: "pace-pro", templateId: "2609181", name: "Automation smoke", design: { version: 1 } }) }).then((r) => r.json()).then((b) => b.project?.projectId ?? JSON.stringify(b))`));
  say(`project ${made}`);
  if (!/^[a-f0-9-]{36}$/i.test(made)) return;
  say(`open ${JSON.stringify((await tool("open", { projectId: made })).json)}`);
  say(`face drawn ${await until(`document.querySelector(".st-layer-pick")`, 60)}`);
  await wait(2500);

  const doc = (await tool("get_document")).json as { sessionId: string; revision: number; capabilities: { layers: { id: string; label: string; kind: string; visible: boolean; placement: { movable: boolean } | null }[] } };
  const layers = doc.capabilities?.layers ?? [];
  say(`document session ${doc.sessionId} revision ${doc.revision}, ${layers.length} layers: ${layers.map((l) => `${l.id}${l.visible ? "" : "(hidden)"}`).join(" ")}`);
  const moving = layers.find((l) => l.visible && l.kind === "time" && l.placement?.movable) ?? layers.find((l) => l.visible && l.placement?.movable);
  const applied = await tool("apply_commands", {
    sessionId: doc.sessionId, baseRevision: doc.revision, label: "Smoke",
    commands: [{ op: "set", path: "/design/backgroundColor", value: "#0B3D91" }, ...(moving ? [{ op: "move_layer", id: moving.id, dx: 0, dy: -40 }] : [])],
  });
  say(`apply ${applied.error ? "refused" : "ok"} ${JSON.stringify(applied.json).slice(0, 300)}`);
  await wait(2500);
  await shot("applied");
  const revision = Number(applied.json.revision);
  const stale = await tool("apply_commands", { sessionId: doc.sessionId, baseRevision: doc.revision, commands: [{ op: "set", path: "/design/backgroundColor", value: "#FF0000" }] });
  say(`stale revision ${stale.error ? "refused" : "ACCEPTED"}: ${JSON.stringify(stale.json).slice(0, 160)}`);
  const preview = await tool("render_preview", { sessionId: doc.sessionId, resolution: 416 });
  say(`preview ${JSON.stringify(preview.json).slice(0, 200)}`);
  if (preview.image) writeFileSync(path.join(folder, "studio-automation-preview.png"), Buffer.from(preview.image, "base64"));
  const contrast = await tool("check_contrast", { sessionId: doc.sessionId });
  say(`contrast ${JSON.stringify((contrast.json.results as unknown[] | undefined)?.map((r) => { const x = r as Record<string, unknown>; return `${String(x.id)} ${String(x.ratio)} ${String(x.verdict)}`; }) ?? contrast.json)} skipped ${JSON.stringify(contrast.json.skipped)}`);
  const valid = await tool("validate", { sessionId: doc.sessionId });
  say(`validate ${JSON.stringify(valid.json).slice(0, 300)}`);
  const undone = await tool("undo", { sessionId: doc.sessionId, baseRevision: revision });
  await wait(2000);
  say(`undo ${JSON.stringify(undone.json)} background now ${await run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => b.project.design.backgroundColor)`)}`);
  await shot("undone");
  const redone = await tool("redo", { sessionId: doc.sessionId, baseRevision: Number(undone.json.revision) });
  say(`redo ${JSON.stringify(redone.json)}`);
  await wait(2000);
  say(`saved ${JSON.stringify((await tool("save", { sessionId: doc.sessionId, baseRevision: Number(redone.json.revision) })).json)}`);
  say(`after save, background ${await run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => b.project.design.backgroundColor)`)}`);
  await shot("redone");

  await window.loadURL(`${origin}/settings/ai`);
  await wait(1200);
  await run(`document.querySelector('[aria-label="Watch-face MCP server"]')?.click()`);
  await wait(800);
  say(`after off: ${(await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" }).then((r) => String(r.status), (e: unknown) => `unreachable (${String(e).slice(0, 40)})`))}`);
}
