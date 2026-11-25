// `CLINK_SMOKE_STUDIO_PERCENT=1` (with CLINK_SMOKE): the battery's "%" on COROS's SIMPLE template for PACE Pro. Picks the
// "%" layer, turns on its own colour, makes it smaller with a gap and sits it at the top, then saves a BIN so the export
// path draws it too. Shots are `studio-percent-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

export async function smokeStudioPercent(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(500);
    try { writeFileSync(path.join(folder, `studio-percent-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const click = (selector: string, text?: string) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ${text ? `b.textContent.includes(${JSON.stringify(text)})` : "true"}); el?.click(); return !!el; })()`);
  /** Moves an inspector slider and lets go, as a drag would. */
  const slide = (label: string, value: number) => run(`(() => { const i = document.querySelector('.st-insp-body input[type=range][aria-label=${JSON.stringify(label)}]'); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(String(value))}); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); return true; })()`);
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const say = (line: string) => log.push(`--- studio percent: ${line}`);
  window.webContents.session.on("will-download", (_event, item) => item.setSavePath(path.join(folder, item.getFilename())));

  await window.loadURL(`${origin}/studio`);
  await wait(1500);
  const made = String(await run(`fetch("/api/desktop/studio/projects", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify({ watch: "pace-pro", templateId: "2609181", name: "Percent smoke", design: { version: 1 } }) }).then((r) => r.json()).then((b) => b.project?.projectId ?? JSON.stringify(b))`));
  say(`project ${made}`);
  if (!/^[a-f0-9-]{36}$/i.test(made)) return;
  const design = (pick: string) => run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => { const d = b.project.design; return JSON.stringify(${pick}); })`);
  await window.loadURL(`${origin}/studio/${made}`);
  say(`face open ${await until(`document.querySelector(".st-layer-pick")`, 60)}`);
  await wait(2500);
  say(`% layer ${await click(".st-layer-pick", "Battery % sign")}`);
  await wait(800);
  await shot("selected");
  say(`panel: ${await run(`document.querySelector(".st-insp-body")?.innerText.replace(/\\s+/g, " ")`)}`);
  say(`own colour ${await click('.st-insp-body [aria-label="Same color as the digits"]')}`);
  await wait(400);
  say(`a colour swatch ${await run(`(() => { const d = [...document.querySelectorAll(".st-insp-body button.st-swatch-btn")]; d[7]?.click(); return d.length + " swatches, picked " + (d[7]?.title ?? "none"); })()`)}`);
  await wait(400);
  say(`size 55 ${await slide("Size", 55)}`);
  await wait(400);
  say(`gap 8 ${await slide("Gap", 8)}`);
  await wait(400);
  say(`top ${await click(".st-insp-body .seg button, .st-insp-body [role=radio], .st-insp-body button", "Top")}`);
  await wait(3000);
  await shot("styled");
  say(`saved look ${await design(`d.metricStyles?.battery ?? null`)}`);
  // The same look from the Battery data panel's "% sign" section.
  say(`battery data ${await click(".st-layer-pick", "Battery data")}`);
  await wait(800);
  say(`battery panel % sign: ${await run(`[...document.querySelectorAll(".st-fold")].find((f) => f.querySelector("summary")?.textContent.includes("% sign"))?.innerText.replace(/\\s+/g, " ") ?? "no section"`)}`);
  await run(`[...document.querySelectorAll(".st-fold")].find((f) => f.querySelector("summary")?.textContent.includes("% sign"))?.scrollIntoView()`);
  await shot("battery-data");
  await click(".st-top button", "Download");
  await wait(300);
  say(`save BIN ${await click(".st-menu-down button", "Save BIN")}`);
  say(`BIN done ${await until(`document.querySelector(".st-toast")?.textContent.includes("BIN") || document.querySelector(".notice")`, 90)}: ${await run(`(document.querySelector(".st-toast")?.textContent ?? "") + " | " + (document.querySelector(".notice")?.textContent ?? "")`)}`);
  await shot("bin");
}
