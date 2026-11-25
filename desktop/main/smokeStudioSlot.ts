// `CLINK_SMOKE_STUDIO_SLOT=1` (with CLINK_SMOKE): the selectable data slot on a Start-blank PACE Pro face. Adds the slot
// from Add, switches types on and off, imports an icon for a type without one, steps the preview through the types (in
// the panel and in Simulate), shows a barometer trend, moves an icon, then reopens the face and saves its BIN. Shots
// are `studio-slot-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

export async function smokeStudioSlot(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(600);
    try { writeFileSync(path.join(folder, `studio-slot-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const click = (selector: string, text?: string) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ${text ? `b.textContent.includes(${JSON.stringify(text)})` : "true"}); el?.click(); return !!el; })()`);
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const say = (line: string) => log.push(`--- studio slot: ${line}`);
  const toast = () => run(`document.querySelector(".st-toast")?.textContent ?? ""`);
  const rows = () => run(`[...document.querySelectorAll(".st-sl-row")].map((r) => (r.hasAttribute("data-cur") ? ">" : "") + r.querySelector(".st-sl-copy").innerText.replace(/\\n/g, " / ") + (r.hasAttribute("data-on") ? " ON" : "")).join(" | ")`);
  const warnings = () => run(`[...document.querySelectorAll(".st-sl-why")].map((w) => w.innerText.replace(/\\s+/g, " ")).join(" || ") || "none"`);
  window.webContents.session.on("will-download", (_event, item) => item.setSavePath(path.join(folder, item.getFilename())));

  await window.loadURL(`${origin}/studio`);
  await wait(1500);
  const made = String(await run(`(async () => {
    const base = "/api/desktop/studio";
    const { templates } = await fetch(base + "/templates?watch=pace-pro").then((r) => r.json());
    const template = templates.find((t) => t.templateType === 1) ?? templates[0];
    const answer = await fetch(base + "/projects", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" },
      body: JSON.stringify({ watch: "pace-pro", templateId: template.id, blank: true, name: "Slot smoke", design: { version: 1 } }) }).then((r) => r.json());
    return answer.project?.projectId ?? "failed: " + JSON.stringify(answer);
  })()`));
  say(`project ${made}`);
  if (!/^[a-f0-9-]{36}$/i.test(made)) return;
  const design = (pick: string) => run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => { const d = b.project.design; return JSON.stringify(${pick}); })`);
  const saved = `({ on: d.controlComplicationEnabled, preview: d.previewComplication, offsets: d.controlIconOffsets, hidden: d.layerVisibility?.complication, icons: Object.keys(d.configAssetOverrides ?? {}).filter((k) => /control_/.test(k) && d.configAssetOverrides[k].replacement), removed: (d.removedLayerIds ?? []).includes("complication") })`;
  await window.loadURL(`${origin}/studio/${made}`);
  say(`face open ${await until(`document.querySelector(".st-layer-pick")`, 40)}`);
  await wait(2500);
  say(`before: ${await design(saved)}`);

  // Add → Selectable data.
  await click(".st-left .st-tabs button", "Add");
  await wait(700);
  say(`tile ${await run(`(() => { const t = document.querySelector('.st-lib [aria-label="Add Selectable data"]'); t?.scrollIntoView({ block: "center" }); return t ? "offered" : [...document.querySelectorAll(".st-lib .st-tile")].map((x) => x.getAttribute("aria-label")).filter((x) => /Select/.test(x ?? "")).join(",") || "missing"; })()`)}`);
  await shot("add");
  say(`add ${await click('.st-lib [aria-label="Add Selectable data"]')} → "${await toast()}", selected ${await run(`document.querySelector(".st-insp-head b")?.textContent ?? "nothing"`)}`);
  await wait(2500);
  say(`types: ${await rows()}`);
  say(`warnings: ${await warnings()}`);
  await shot("added");
  await click(".st-left .st-tabs button", "Add");
  await wait(500);
  say(`tile after: ${await run(`document.querySelector('.st-lib [aria-label="Select Selectable data"]') ? "ticked" : "not ticked"`)}; layer rows with control_ pieces: ${await run(`(() => { document.querySelectorAll(".st-left .st-tabs button")[0].click(); return 0; })()`)}`);
  await wait(500);
  say(`layers: ${await run(`[...document.querySelectorAll(".st-layer-pick")].map((b) => b.textContent).join(" | ")`)}`);

  // Types on and off.
  const flip = async (label: string) => say(`switch ${label}: ${await click(`.st-sl-row [aria-label="${label} on the watch's list"]`)}`);
  for (const label of ["Elevation", "Barometer", "Sunrise", "Battery"]) { await flip(label); await wait(900); }
  await flip("Steps");
  await wait(1500);
  say(`types: ${await rows()}`);
  say(`warnings: ${await warnings()}`);
  await shot("types");

  // An icon for the type that has none (a pink triangle drawn here).
  say(`preview Elevation ${await click('.st-sl-row [aria-label="Preview Elevation"]')}`);
  await wait(1500);
  await shot("no-icon");
  say(`import icon ${await run(`(async () => {
    const input = document.querySelector('.st-sl-pieces input[aria-label="Icon PNG"]');
    if (!input) return false;
    const c = document.createElement("canvas"); c.width = 48; c.height = 48;
    const x = c.getContext("2d"); x.fillStyle = "#ff6b9a"; x.beginPath(); x.moveTo(24, 4); x.lineTo(46, 44); x.lineTo(2, 44); x.closePath(); x.fill();
    const blob = await new Promise((done) => c.toBlob(done, "image/png"));
    const files = new DataTransfer(); files.items.add(new File([blob], "elevation.png", { type: "image/png" }));
    input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`)}`);
  await wait(2500);
  say(`types: ${await rows()}`);
  say(`warnings: ${await warnings()}`);
  await shot("icon");
  // Icon offset: the icon alone moves.
  say(`icon offset ${await run(`(() => { const i = document.querySelector('.st-sl-offset input[aria-label="X"]'); if (!i) return false; i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "-30"); i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return true; })()`)}`);
  await wait(2000);
  await shot("offset");

  // Stepping the preview through the types that are on.
  for (let i = 0; i < 5; i++) {
    await click('.st-sl-head [aria-label="Preview the next type"]');
    await wait(1800);
    const now = String(await run(`document.querySelector(".st-sl-row[data-cur] .st-sl-copy")?.innerText.split("\\n")[0] ?? "none"`));
    say(`step ${i + 1}: ${now}`);
    await shot(`step-${i + 1}-${now.toLowerCase().replace(/[^a-z]+/g, "-")}`);
  }
  // The barometer's trend images.
  say(`preview Barometer ${await click('.st-sl-row [aria-label="Preview Barometer"]')}`);
  await wait(1500);
  say(`trend Rising ${await click('[aria-label="Barometer trend shown"] button', "Rising")}`);
  await wait(1800);
  await shot("barometer-rising");
  say(`trend Falling ${await click('[aria-label="Barometer trend shown"] button', "Falling")}`);
  await wait(1800);
  await shot("barometer-falling");

  // Simulate: the slot's row, a step and a sample value.
  say(`simulate ${await click(".st-tools .chip", "Simulate")}`);
  await wait(1200);
  say(`sim row: ${await run(`document.querySelector('.st-sim [aria-label="Type the slot shows"]') ? [...document.querySelectorAll('.st-sim [aria-label="Type the slot shows"] option')].map((o) => o.textContent).join(", ") : "missing"`)}`);
  await click('.st-sim [aria-label="The next type"]');
  await wait(1200);
  say(`sim value ${await run(`(() => { const i = document.querySelector(".st-sim .st-sim-value"); if (!i) return "no field"; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "77"); i.dispatchEvent(new Event("input", { bubbles: true })); return i.getAttribute("aria-label"); })()`)}`);
  await wait(2000);
  await shot("simulate");
  await click(".st-tools .chip", "Simulate");

  // Saved, reopened, built.
  await wait(2500);
  say(`saved: ${await design(saved)}`);
  await window.loadURL(`${origin}/studio/${made}`);
  say(`reopened ${await until(`document.querySelector(".st-layer-pick")`, 40)}`);
  await wait(3000);
  say(`pick slot ${await click(".st-layer-pick", "Selectable data")}`);
  await wait(1500);
  say(`after reopening: ${await rows()}`);
  say(`after reopening, saved: ${await design(saved)}`);
  await shot("reopened");
  await click(".st-top button", "Download");
  await wait(300);
  say(`save BIN ${await click(".st-menu-down button", "Save BIN")}`);
  await wait(15000);
  say(`after BIN: ${await run(`(document.querySelector(".st-toast")?.textContent ?? "") + " | " + (document.querySelector(".notice")?.textContent ?? "")`)}`);
  // The config the watch gets: the archive's own, read back from the final ZIP's build.
  await click(".st-top button", "Download");
  await wait(300);
  say(`final ZIP ${await click(".st-menu-down button", "Final watch ZIP")}`);
  await wait(9000);
  say(`after ZIP: ${await toast()}`);
}
