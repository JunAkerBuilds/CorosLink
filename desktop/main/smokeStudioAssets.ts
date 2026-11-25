// `CLINK_SMOKE_STUDIO_ASSETS=1` (with CLINK_SMOKE): makes a face on COROS's SIMPLE template for PACE Pro and walks the
// official asset library and Google Fonts on it, against the real library and Google: the browser (first download,
// filters, a preview with frame stepping), an official image added, an official digit set on the hours, the Google
// tab and a Google font on the minutes, then the face reopened and a BIN saved. Shots are `studio-assets-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

export async function smokeStudioAssets(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(500);
    try { writeFileSync(path.join(folder, `studio-assets-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const click = (selector: string, text?: string) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ${text ? `b.textContent.includes(${JSON.stringify(text)})` : "true"}); el?.click(); return !!el; })()`);
  const type = (selector: string, value: string) => run(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!i) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  /** Waits until `code` is truthy in the page, up to `seconds`. */
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const say = (line: string) => log.push(`--- studio assets: ${line}`);
  window.webContents.session.on("will-download", (_event, item) => item.setSavePath(path.join(folder, item.getFilename())));

  await window.loadURL(`${origin}/studio`);
  await wait(1500);
  const made = String(await run(`fetch("/api/desktop/studio/projects", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify({ watch: "pace-pro", templateId: "2609181", name: "Assets smoke", design: { version: 1 } }) }).then((r) => r.json()).then((b) => b.project?.projectId ?? JSON.stringify(b))`));
  say(`project ${made}`);
  if (!/^[a-f0-9-]{36}$/i.test(made)) return;
  const face = `${origin}/studio/${made}`;
  const design = (pick: string) => run(`fetch("/api/desktop/studio/projects/${made}").then((r) => r.json()).then((b) => { const d = b.project.design; return JSON.stringify(${pick}); })`);
  await window.loadURL(face);
  say(`face open ${await until(`document.querySelector(".st-layer-pick")`, 30)}`);
  await wait(2500);

  // Add → Official: the first visit downloads the watch's library, with progress.
  await click(".st-left .st-tabs button", "Add");
  await wait(600);
  await shot("add-panel");
  say(`Add → From COROS faces ${await click('.st-lib [aria-label="Add an image from COROS faces"]')}`);
  await wait(250);
  say(`while loading: ${await run(`document.querySelector(".st-off-state")?.innerText.replace(/\\s+/g, " ") ?? "no progress shown"`)}`);
  await shot("browser-loading");
  say(`library ready ${await until(`document.querySelector(".st-off-card")`, 90)}: ${await run(`document.querySelector(".st-off-count")?.textContent ?? ""`)}`);
  await wait(2500);
  await shot("browser");
  say(`filters: ${await run(`[...document.querySelectorAll(".st-off-group")].map((g) => g.getAttribute("aria-label") + " [" + [...g.querySelectorAll(".st-off-option, .chip, .seg button")].map((b) => b.textContent).join(", ") + "]").join(" · ")`)}`);
  say(`status ${await run(`fetch("/api/desktop/studio/official?watch=pace-pro").then((r) => r.text())`)}`);
  // Weather: 41-state sets, to step through.
  say(`category Weather ${await click(".st-off-option", "Weather")}`);
  await wait(1500);
  say(`purpose Day ${await click(".st-off-option", "Day")}; ${await run(`document.querySelector(".st-off-count")?.textContent ?? ""`)}`);
  await wait(1500);
  await click(".st-off-card");
  say(`preview ${await until(`document.querySelector(".st-off-stage img")`, 30)}`);
  await click('.st-off-step [aria-label="Next frame"]'); await wait(150);
  await click('.st-off-step [aria-label="Next frame"]'); await wait(400);
  say(`stepping: ${await run(`document.querySelector(".st-off-step span")?.textContent`)}; button "${await run(`document.querySelector(".st-off-detail .btn, .st-off-detail button.st-wide")?.textContent`)}"`);
  await shot("browser-preview");
  say(`use the frame ${await click(".st-off-detail button.st-wide")}`);
  say(`browser closed ${await until(`!document.querySelector(".st-off")`, 15)}; toast "${await run(`document.querySelector(".st-toast")?.textContent ?? ""`)}"; selected ${await run(`(document.querySelector(".st-insp-head b")?.textContent ?? "nothing") + " (" + (document.querySelector(".st-insp-head small")?.textContent ?? "") + ")"`)}`);
  await wait(2500);
  await shot("image-added");
  say(`design sprites ${await design(`(d.designSprites ?? []).map((s) => [s.sourceWidth, s.sourceHeight, s.width, s.height, s.x, s.y, s.dataUrl.slice(0, 22)])`)}`);

  // An official digit set on the hours: font picker → PNG set → Official COROS font.
  await click(".st-left .st-tabs button", "Layers");
  await wait(500);
  say(`hours layer ${await click(".st-layer-pick", "Hour")}`);
  await wait(800);
  await click(".st-insp-body .st-pick");
  await wait(600);
  say(`PNG set ${await click(".st-fp-src button", "PNG set")}`);
  await wait(400);
  await shot("png-set");
  say(`Official COROS font ${await click(".st-fp-sheet .st-chip-btn", "Official COROS font")}`);
  say(`digit fonts ${await until(`document.querySelector(".st-off-card")`, 60)}: ${await run(`(document.querySelector(".st-off h2")?.textContent ?? "") + " · " + (document.querySelector(".st-off-count")?.textContent ?? "") + " · used as " + [...document.querySelectorAll('.st-off-group[aria-label="Used as"] [aria-pressed="true"]')].map((b) => b.textContent).join()`)}`);
  await wait(2500);
  await shot("official-fonts");
  await run(`document.querySelectorAll(".st-off-card")[1]?.click()`);
  say(`font preview ${await until(`document.querySelector(".st-off-stage img")`, 30)}`);
  await wait(400);
  await shot("official-font-preview");
  say(`use the font ${await click(".st-off-detail button.st-wide")}; closed ${await until(`!document.querySelector(".st-off")`, 20)}`);
  await wait(3000);
  await shot("official-digits-on-hours");
  say(`hours style ${await design(`(() => { const r = d.timeStyles?.hours?.rasterFont; return r ? { label: r.label, glyphs: r.glyphs, atlas: r.atlasSize, family: d.timeStyles.hours.fontFamily } : d.timeStyles?.hours ?? null; })()`)}`);

  // Google Fonts on the minutes: the Google tab, a search, a family applied.
  say(`minutes layer ${await click(".st-layer-pick", "Minute")}`);
  await wait(800);
  await click(".st-insp-body .st-pick");
  await wait(500);
  say(`Google tab ${await click(".st-fp-src button", "Google")}`);
  say(`list ${await until(`document.querySelector(".st-fp-row")`, 30)}`);
  say(`rows drawn in their fonts ${await until(`document.querySelectorAll(".st-fp-g[data-loaded]").length >= 4`, 30)}: ${await run(`[...document.querySelectorAll(".st-fp-row")].slice(0, 7).map((r) => r.querySelector(".st-fp-name").childNodes[0].textContent + " (" + (r.querySelector("small")?.textContent ?? "") + (r.querySelector(".st-fp-g[data-loaded]") ? ", drawn" : ", waiting") + ")").join(" | ")`)}`);
  await wait(800);
  await shot("google-tab");
  say(`list source ${await run(`fetch("/api/desktop/studio/fonts/google").then((r) => r.json()).then((b) => b.source + ", " + b.families.length + " families")`)}`);
  await type(".st-fp-sheet input[type=search]", "orbitron");
  say(`search ${await until(`document.querySelector(".st-fp-row")?.textContent.includes("Orbitron") && document.querySelector(".st-fp-g[data-loaded]")`, 20)}`);
  await wait(500);
  await shot("google-search");
  say(`pick Orbitron ${await click(".st-fp-row", "Orbitron")}`);
  say(`applied ${await until(`document.querySelector(".st-insp-body .st-pick-name b")?.textContent === "Orbitron"`, 30)}: ${await run(`document.querySelector(".st-insp-body .st-pick-name")?.innerText.replace(/\\s+/g, " ")`)}; weights offered ${await run(`[...document.querySelectorAll('.st-insp-body select[aria-label="Weight"] option')].map((o) => o.value).join(" ")`)}; in the page ${await run(`[...document.fonts].filter((f) => f.family === "Orbitron").map((f) => f.weight + " " + f.status).join(", ")`)}`);
  await wait(3500);
  await shot("google-applied");
  await click(".st-insp-body .st-pick");
  await wait(2000);
  say(`saved ${await run(`document.querySelector(".st-saved")?.textContent`)}; minutes ${await design(`d.timeStyles?.minutes ?? null`)}; snapshots ${await design(`(d.fontSnapshots ?? []).map((s) => s.family + " " + s.weight + " " + s.fontSize)`)}`);

  // The weather icon's official sets, where the face has one.
  if (await click(".st-layer-pick", "Weather") === true) { await wait(800); await shot("weather-sets"); }

  // Reopened: the Google font is fetched from this computer's cache and registered before the face draws.
  await window.loadURL(face);
  say(`reopened ${await until(`document.querySelector(".st-layer-pick")`, 30)}`);
  await wait(4000);
  say(`after reopening: Orbitron in the page ${await run(`[...document.fonts].filter((f) => f.family === "Orbitron").map((f) => f.weight + " " + f.status).join(", ") || "not registered"`)}; toast "${await run(`document.querySelector(".st-toast")?.textContent ?? ""`)}"; sprites ${await design(`(d.designSprites ?? []).length`)}; hours ${await design(`d.timeStyles?.hours?.rasterFont?.label ?? null`)}; minutes ${await design(`d.timeStyles?.minutes?.fontFamily ?? null`)}`);
  await shot("reopened");
  await click(".st-top button", "Download");
  await wait(300);
  say(`save BIN ${await click(".st-menu-down button", "Save BIN")}`);
  say(`BIN done ${await until(`document.querySelector(".st-toast")?.textContent.includes("BIN") || document.querySelector(".notice")`, 60)}: ${await run(`(document.querySelector(".st-toast")?.textContent ?? "") + " | " + (document.querySelector(".notice")?.textContent ?? "")`)}`);
  await wait(1500);
  await shot("bin-saved");
  say(`cache ${await run(`Promise.all(["/official?watch=pace-pro", "/fonts/google/family?name=Orbitron"].map((r) => fetch("/api/desktop/studio" + r).then((a) => a.json()))).then(([o, g]) => JSON.stringify({ library: [o.status.state, o.status.source, o.status.assetCount], orbitron: g.family?.faces?.length }))`)}`);
}
