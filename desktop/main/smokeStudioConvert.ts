// `CLINK_SMOKE_STUDIO_CONVERT=1` (with CLINK_SMOKE): the editor's Convert button, on a face made from
// COROS's SIMPLE template for PACE Pro (to APEX 4, from the 800 px master) and on that face's own BIN imported back
// (a recovered face, rebuilt from its own layout for PACE 4), which then opens. Shots are `studio-convert-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

export async function smokeStudioConvert(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(500);
    try { writeFileSync(path.join(folder, `studio-convert-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const click = (selector: string, text?: string) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ${text ? `b.textContent.includes(${JSON.stringify(text)})` : "true"}); el?.click(); return !!el; })()`);
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const say = (line: string) => log.push(`--- studio convert: ${line}`);
  const hub = `{ "X-Clink-Hub": "1" }`;

  /** Opens a face, then Convert, converts to `watch` and shots each step. */
  const convert = async (id: string, watch: string, tag: string) => {
    await window.loadURL(`${origin}/studio/${id}`);
    await until(`document.querySelector(".st-menu-wrap button")`, 20);
    await wait(4000);
    await shot(`${tag}-editor`);
    say(`${tag}: convert button ${await run(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Convert"); b?.click(); return !!b; })()`)}`);
    await until(`document.querySelector(".st-convert")`, 10);
    await wait(800);
    say(`${tag}: chip ${await run(`(() => { const b = [...document.querySelectorAll(".st-convert .chip")].find((c) => c.textContent === ${JSON.stringify(watch)}); b?.click(); return !!b; })()`)}`);
    await wait(500);
    say(`${tag}: says ${await run(`document.querySelector(".st-convert .st-small")?.textContent ?? "nothing"`)}`);
    await shot(`${tag}`);
    say(`${tag}: convert ${await click(".st-convert button", `Convert to ${watch}`)}`);
    const made = await until(`document.querySelector(".st-convert .st-send-row") || document.querySelector(".st-convert-dialog [role=alert]")`, 90);
    say(`${tag}: ${made ? "" : "timed out "}${await run(`[...document.querySelectorAll(".st-convert .st-send-row, .st-convert .st-note, .st-convert-dialog [role=alert]")].map((e) => e.textContent).join(" | ")`)}`);
    await shot(`${tag}-done`);
  };

  await window.loadURL(`${origin}/studio`);
  await wait(1500);
  const made = String(await run(`fetch("/api/desktop/studio/projects", { method: "POST", headers: { "Content-Type": "application/json", ...${hub} }, body: JSON.stringify({ watch: "pace-pro", templateId: "2609181", name: "Convert smoke", design: { version: 1 } }) }).then((r) => r.json()).then((b) => b.project?.projectId ?? JSON.stringify(b))`));
  say(`project ${made}`);
  if (!/^[a-f0-9-]{36}$/i.test(made)) return;
  await convert(made, "APEX 4", "master");

  // The face's own BIN, imported back: a face recovered from a compiled BIN, with only its 416 layout.
  const recovered = String(await run(`(async () => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 800;
    const x = c.getContext("2d"); x.fillStyle = "#14324a"; x.fillRect(0, 0, 800, 800);
    const bin = await fetch("/api/desktop/studio/projects/${made}/export/bin", { method: "POST", headers: { "Content-Type": "application/json", ...${hub} }, body: JSON.stringify({ backgroundDataUrl: c.toDataURL("image/png") }) });
    if (!bin.ok) return "bin " + await bin.text();
    const imported = await fetch("/api/desktop/studio/projects/import?name=" + encodeURIComponent("Recovered smoke"), { method: "POST", headers: ${hub}, body: await bin.arrayBuffer() }).then((r) => r.json());
    return imported.project?.projectId ?? JSON.stringify(imported);
  })()`));
  say(`recovered ${recovered}`);
  if (!/^[a-f0-9-]{36}$/i.test(recovered)) return;
  await convert(recovered, "PACE 4", "recovered");
  say(`open ${await click(".st-convert .st-send-row button", "Open")}`);
  await wait(6000);
  say(`opened ${await run(`location.pathname + " · " + (document.querySelector(".st-name")?.value ?? "") + " · " + (document.querySelector(".st-watch-chip")?.textContent ?? "") + " · send " + (document.querySelector(".st-convert-dialog") ? "open" : "closed")`)}`);
  await shot("recovered-opened");
}
