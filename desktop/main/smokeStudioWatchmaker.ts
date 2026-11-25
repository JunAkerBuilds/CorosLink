// `CLINK_SMOKE_STUDIO_WATCHMAKER=1` (with CLINK_SMOKE): Watchmaker in the real editor. An empty profile has no AI set
// up, so a scripted model stands in (`smokeWatchmakerModel`, used by main.ts only in this smoke): it reads the face,
// plans, recolours the background and moves the time up in one step, draws a preview, checks contrast and answers.
// Everything else is real: the panel, the stream, the broker, the editor's undo history and the saved chat.
// Shots are `studio-watchmaker-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { CoachModel, ModelTurn } from "@/lib/coach/loop";

/** The stand-in model: a fixed walk through the tools, reading the layer to move from the document it gets. */
export function smokeWatchmakerModel(): CoachModel {
  let n = 0;
  return {
    async turn(request): Promise<ModelTurn> {
      const say = async (text: string) => { for (const word of text.split(/(?<= )/)) { request.onText(word); await new Promise((r) => setTimeout(r, 30)); } };
      const tools = (calls: { name: string; input: unknown }[], text = ""): ModelTurn => ({ content: { calls }, text, calls: calls.map((c) => ({ ...c, id: `smoke${++n}` })), stop: "tools", inputTokens: 0, outputTokens: 0 });
      const results = request.messages.filter((m) => m.role === "user" && Array.isArray(m.content) && (m.content as { type?: string }[])[0]?.type === "tool_result").length;
      await new Promise((r) => setTimeout(r, 400));
      if (results === 0) {
        await say("I'll make the background deep blue and lift the time a little.");
        return tools([{ name: "update_plan", input: { items: [{ text: "Deep blue background", status: "doing" }, { text: "Lift the time", status: "pending" }, { text: "Check the preview and contrast", status: "pending" }] } }, { name: "get_document", input: {} }]);
      }
      if (results === 1) {
        const doc = /"layers":(\[.*?\]),"assetContracts"/.exec(request.context)?.[1] ?? "[]";
        const time = (JSON.parse(doc) as { id: string; kind: string; visible: boolean; movable: boolean }[]).filter((l) => l.kind === "time" && l.visible && l.movable).map((l) => l.id);
        return tools([{ name: "apply_commands", input: { label: "Deep blue, time up", commands: [{ op: "set", path: "/design/backgroundColor", value: "#0B2A6F" }, ...time.map((id) => ({ op: "move_layer", id, dx: 0, dy: -30 }))] } },
          { name: "update_plan", input: { items: [{ text: "Deep blue background", status: "done" }, { text: "Lift the time", status: "done" }, { text: "Check the preview and contrast", status: "doing" }] } }]);
      }
      if (results === 2) return tools([{ name: "render_preview", input: { resolution: 416 } }, { name: "check_contrast", input: {} }]);
      if (results === 3) return tools([{ name: "update_plan", input: { items: [{ text: "Deep blue background", status: "done" }, { text: "Lift the time", status: "done" }, { text: "Check the preview and contrast", status: "done" }] } }]);
      const text = "The background is deep blue now and the time sits a little higher. Every text layer passes the contrast check against the new background.";
      await say(text);
      return { content: text, text, calls: [], stop: "end", inputTokens: 0, outputTokens: 0 };
    },
  };
}

export async function smokeStudioWatchmaker(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(500);
    try { writeFileSync(path.join(folder, `studio-watchmaker-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const say = (line: string) => log.push(`--- studio watchmaker: ${line}`);

  await window.loadURL(`${origin}/studio`);
  await wait(1500);
  const made = String(await run(`fetch("/api/desktop/studio/projects", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify({ watch: "pace-pro", templateId: "2609181", name: "Watchmaker smoke", design: { version: 1 } }) }).then((r) => r.json()).then((b) => b.project?.projectId ?? JSON.stringify(b))`));
  say(`project ${made}`);
  if (!/^[a-f0-9-]{36}$/i.test(made)) return;
  await window.loadURL(`${origin}/studio/${made}`);
  say(`face drawn ${await until(`document.querySelector(".st-layer-pick")`, 60)}`);
  await wait(2000);
  say(`AI tab ${await run(`(() => { const b = [...document.querySelectorAll('.st-right .st-tabs button')].find((x) => x.textContent.includes("AI")); b?.click(); return !!b; })()`)}`);
  say(`panel ${await until(`document.querySelector(".st-wm textarea")`, 10)}`);
  await wait(800);
  await shot("empty");
  // A design reference pasted in: the face's own picture stands in for one.
  say(`attach ${await run(`(async () => {
    const blob = await fetch("/api/desktop/studio/projects/${made}/preview").then((r) => r.blob());
    const file = new File([blob], "reference.png", { type: "image/png" });
    const data = new DataTransfer(); data.items.add(file);
    document.querySelector(".st-wm textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    return blob.size;
  })()`)}`);
  await until(`document.querySelector(".st-wm-chip")`, 5);
  await run(`(() => { const t = document.querySelector(".st-wm textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Make it deep blue and lift the time a bit"); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await wait(300);
  await shot("draft");
  say(`send ${await run(`(() => { const b = document.querySelector(".st-wm-send"); b?.click(); return !!b; })()`)}`);
  await wait(1600);
  await shot("working");
  say(`finished ${await until(`!document.querySelector(".st-wm-send[data-stop]") && document.querySelector(".st-wm-note")`, 90)}`);
  await wait(2500);
  await shot("done");
  say(`chat: ${await run(`document.querySelector(".st-wm-scroll")?.innerText.replace(/\\s+/g, " ").slice(0, 700)`)}`);
  say(`saved face ${await run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => b.project.design.backgroundColor)`)}`);
  say(`chats ${await run(`fetch("/api/desktop/studio/watchmaker/chats?project=${made}").then((r) => r.text())`)}`);
  // One undo takes the whole step back.
  await run(`document.querySelector(".st-top [aria-label='Undo'], .st-top button[title^='Undo']")?.click()`);
  await wait(2000);
  say(`after undo ${await run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => b.project.design.backgroundColor ?? "template")`)}`);
  await shot("undone");
  // Reopened, the chat is still there.
  await window.loadURL(`${origin}/studio/${made}`);
  await until(`document.querySelector(".st-layer-pick")`, 60);
  await run(`[...document.querySelectorAll('.st-right .st-tabs button')].find((x) => x.textContent.includes("AI"))?.click()`);
  say(`reopened chat ${await until(`document.querySelectorAll(".st-wm-msg").length >= 2`, 10)}`);
  await run(`document.querySelector(".st-wm-title")?.click()`);
  await wait(500);
  await shot("chats");
}
