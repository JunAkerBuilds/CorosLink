// `CLINK_SMOKE_STUDIO_WATCHMAKER=1` (with CLINK_SMOKE): Watchmaker in the real editor. The smoke doesn't run Codex,
// so a scripted engine stands in (`smokeWatchmakerEngine`, used by main.ts only in this smoke): it plans, reads the
// face, recolours the background and moves the time up in one step, draws a preview, checks contrast and answers.
// Everything else is real: the panel, the stream, the tools, the broker, the editor's undo history and the saved chat.
// Shots are `studio-watchmaker-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { WatchmakerEngine } from "./watchface/watchmaker";
import { STEP_WORDS } from "./watchface/watchmaker/tools";
import { t } from "@/lib/i18n";

/** The stand-in engine: a fixed walk through the tools, finding the layer to move in the document it reads. */
export function smokeWatchmakerEngine(): WatchmakerEngine {
  return {
    status: async () => ({ ready: true, label: "Smoke · scripted" }),
    async run({ tools, emit, signal }) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let n = 0, edits = 0, text = "";
      const say = async (words: string) => { for (const word of words.split(/(?<= )/)) { emit({ t: "text", delta: word }); text += word; await wait(30); } };
      const call = async (name: string, input: unknown) => {
        const id = `s${++n}`;
        emit({ t: "step", id, tool: name, label: t(STEP_WORDS[name] ?? name) });
        await wait(300);
        const r = await tools.run(name, input, signal);
        emit({ t: "step-done", id, ok: !r.isError });
        if (r.edited) { edits++; emit({ t: "edit" }); }
        if (r.plan) emit({ t: "plan", items: r.plan });
        for (const p of r.pictures ?? []) emit({ t: "picture", assetId: p.assetId, why: p.why });
        return r;
      };
      const plan = (a: string, b: string, c: string) => call("update_plan", { items: [{ text: "Deep blue background", status: a }, { text: "Lift the time", status: b }, { text: "Check the preview and contrast", status: c }] });
      await say("I'll make the background deep blue and lift the time a little. ");
      await plan("doing", "pending", "pending");
      const doc = JSON.parse((await call("get_document", {})).text) as { capabilities: { layers: { id: string; kind: string; visible: boolean; movable: boolean }[] } };
      const time = doc.capabilities.layers.filter((l) => l.kind === "time" && l.visible && l.movable).map((l) => l.id);
      await call("apply_commands", { label: "Deep blue, time up", commands: [{ op: "set", path: "/design/backgroundColor", value: "#0B2A6F" }, ...time.map((id) => ({ op: "move_layer", id, dx: 0, dy: -30 }))] });
      await plan("done", "done", "doing");
      await call("render_preview", { resolution: 416 });
      await call("check_contrast", {});
      await plan("done", "done", "done");
      await say("\n\nThe background is deep blue now and the time sits a little higher. Every text layer passes the contrast check against the new background.");
      return { text, edits, stopped: signal.aborted };
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
