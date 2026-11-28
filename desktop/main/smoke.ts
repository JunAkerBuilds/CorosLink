// `CLINK_SMOKE=<folder>`: opens each screen in turn, saves a screenshot of it and every console error, then quits.
// For checking the app without someone at the window.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import { isLang } from "@/lib/i18n";
import { smokeStudioAssets } from "./smokeStudioAssets";
import { smokeStudioPercent } from "./smokeStudioPercent";
import { smokeStudioConvert } from "./smokeStudioConvert";
import { smokeStudioAutomation } from "./smokeStudioAutomation";
import { smokeStudioWatchmaker } from "./smokeStudioWatchmaker";
import { smokeActivityScreens } from "./smokeActivityScreens";
import { smokeStudioSlot } from "./smokeStudioSlot";
import { smokeStudioCompare } from "./smokeStudioCompare";

const SCREENS = ["/", "/calendar", "/calendar?view=list", "/activities", "/health", "/health/sleep", "/fuel", "/body", "/strength", "/coach", "/watch", "/media", "/connect", "/calendar/new", "/calendar/plans", "/studio", "/setup"];

export async function runSmoke(window: BrowserWindow, origin: string, folder: string): Promise<void> {
  mkdirSync(folder, { recursive: true });
  // A window behind others stops painting, and its screenshots come back stale: keep it drawing.
  window.webContents.setBackgroundThrottling(false);
  const log: string[] = [];
  window.webContents.on("console-message", (event) => {
    if (event.level === "error" || event.level === "warning") log.push(`[${event.level}] ${event.message}`);
  });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // CLINK_SMOKE_SCREENS="/studio,/studio/<id>" opens just those, for checking one part of the app.
  const screens = process.env.CLINK_SMOKE_SCREENS ? process.env.CLINK_SMOKE_SCREENS.split(",").filter((x) => x.startsWith("/")) : SCREENS;
  // "/studio/blank" makes a Start-blank face on the PACE Pro's first digital template (as the home page does) and
  // opens that, so building a face up from nothing can be checked in an empty user-data folder.
  if (screens.includes("/studio/blank")) {
    await window.loadURL(origin + "/studio");
    await wait(1500);
    const made: unknown = await window.webContents.executeJavaScript(`(async () => {
      const base = "/api/desktop/studio";
      const { templates } = await fetch(base + "/templates?watch=pace-pro").then((r) => r.json());
      const template = templates.find((t) => t.templateType === 1) ?? templates[0];
      const answer = await fetch(base + "/projects", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" },
        body: JSON.stringify({ watch: "pace-pro", templateId: template.id, blank: true, name: "Blank face", design: { version: 1 } }) }).then((r) => r.json());
      return answer.project?.projectId ?? "failed: " + JSON.stringify(answer);
    })()`).catch((e: unknown) => `failed: ${String(e)}`);
    log.push(`--- studio blank: ${String(made)}`);
    screens.splice(screens.indexOf("/studio/blank"), 1, ...(/^[a-f0-9-]{36}$/i.test(String(made)) ? [`/studio/${String(made)}`] : []));
  }
  const capture = async (file: string) => {
    // A window behind others can hand back an old frame: ask for a fresh one first.
    window.webContents.invalidate();
    await wait(400);
    try { writeFileSync(path.join(folder, file), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  // CLINK_SMOKE_THEME=light|dark shows every screen in that look.
  const theme = process.env.CLINK_SMOKE_THEME;
  if (theme === "light" || theme === "dark") {
    await window.loadURL(origin + "/");
    await window.webContents.executeJavaScript(`localStorage.setItem("clink.theme", ${JSON.stringify(theme)})`).catch(() => {});
  }
  // CLINK_SMOKE_LANG=es|de|pt-BR|pt-PT|zh-Hans shows every screen in that language (src/lib/i18n/load.ts reads it at each load).
  const lang = process.env.CLINK_SMOKE_LANG;
  if (isLang(lang)) {
    await window.loadURL(origin + "/");
    await window.webContents.executeJavaScript(`localStorage.setItem("clink.language", ${JSON.stringify(JSON.stringify(lang))})`).catch(() => {});
  }
  // CLINK_SMOKE_MCP=1 adds the fixture MCP server (scripts/mcp-fixture.mjs) with one tool on; CLINK_SMOKE_COACH="…"
  // then asks Coach that question and logs the tools it used and its answer.
  if (process.env.CLINK_SMOKE_MCP) {
    await window.loadURL(origin + "/coach");
    await wait(1000);
    const fixture = path.join(app.getAppPath(), "scripts", "mcp-fixture.mjs");
    log.push(`--- mcp: ${String(await window.webContents.executeJavaScript(`(async () => {
      const post = (a, b) => fetch("/api/desktop/mcp" + a, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
      const added = await post("/add", { name: "Fixture", transport: "stdio", command: "node", args: [${JSON.stringify(fixture)}] });
      const s = added.servers.find((x) => x.id === added.added);
      if (!s) return "add failed: " + JSON.stringify(added);
      const after = await post("/tools", { id: s.id, tool: "pace_from_speed", on: true });
      return JSON.stringify(after.servers.map((x) => ({ name: x.name, state: x.state, error: x.error, on: x.tools.filter((t) => t.on).map((t) => t.as), tools: x.tools.length })));
    })()`).catch((e: unknown) => `failed: ${String(e)}`))}`);
  }
  if (process.env.CLINK_SMOKE_COACH) {
    await window.loadURL(origin + "/coach");
    await wait(1000);
    log.push(`--- coach: ${String(await window.webContents.executeJavaScript(`(async () => {
      const r = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify({ text: ${JSON.stringify(process.env.CLINK_SMOKE_COACH)}, history: [], offsetMin: -new Date().getTimezoneOffset() }) });
      const lines = (await r.text()).split("\\n").filter(Boolean).map((l) => JSON.parse(l));
      const done = lines.find((e) => e.t === "done"), error = lines.find((e) => e.t === "error"), steps = lines.filter((e) => e.t === "working").pop();
      return JSON.stringify({ status: r.status, steps: steps?.card.steps.map((s) => s.text), sources: done?.sources, text: done?.blocks.filter((b) => b.kind === "text").map((b) => b.text).join(" "), error });
    })()`).catch((e: unknown) => `failed: ${String(e)}`))}`);
  }
  for (const screen of screens) {
    log.push(`--- ${screen}`);
    // "/welcome/move/run": the move from CorosLink in its three stages: pick, copying, done. Point CLINK_COROSLINK_DIR
    // at a CorosLink folder (and CLINK_MOVE_PACE_MS at a pause) to see the copy part-way.
    if (screen === "/welcome/move/run") {
      await window.loadURL(origin + "/welcome/move");
      await wait(3000);
      await capture("welcome-move.png");
      await window.webContents.executeJavaScript(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Bring it over"))?.click()`).catch(() => {});
      await wait(1500);
      await capture("welcome-move-copying.png");
      for (let i = 0; i < 120; i++) {
        if (await window.webContents.executeJavaScript(`!!document.querySelector('.mx[data-stage="done"]')`).catch(() => false)) break;
        await wait(500);
      }
      await wait(800);
      await capture("welcome-move-done.png");
      log.push(`move: ${await window.webContents.executeJavaScript(`document.querySelector(".mx-bar-text")?.textContent ?? "no bar"`).catch(() => "failed")}`);
      continue;
    }
    // "/updates": the account menu's Updates popover as it is (a development build has no updater), then Developer → Update
    // prompt's made-up update: the prompt, downloading, ready, and the popover with the dots. Turns developer mode on.
    if (screen === "/updates") {
      const js = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
      await window.loadURL(origin + "/");
      await wait(3000);
      await js(`document.querySelector(".avatar")?.click()`);
      await wait(300);
      await js(`document.querySelector(".upd-row")?.click()`);
      await wait(600);
      await capture("updates.png");
      log.push(`updates: ${String(await js(`document.querySelector(".upd-pop")?.innerText ?? "no popover"`))}`);
      await js(`fetch("/api/desktop/developer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ devMode: true }) })`);
      await window.loadURL(origin + "/developer");
      await wait(3000);
      await js(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Preview")?.click()`);
      await wait(1500);
      await capture("updates-prompt.png");
      await js(`[...document.querySelectorAll(".upd-prompt button")].find((b) => b.textContent.includes("Download"))?.click()`);
      await wait(1000);
      await capture("updates-prompt-downloading.png");
      await wait(2000);
      await capture("updates-prompt-ready.png");
      await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await wait(400);
      log.push(`updates prompt closed: ${String(await js(`!document.querySelector(".upd-prompt")`))}`);
      await js(`document.querySelector(".avatar")?.click()`);
      await wait(300);
      await js(`document.querySelector(".upd-row")?.click()`);
      await wait(600);
      await capture("updates-ready.png");
      continue;
    }
    await window.loadURL(origin + screen);
    await wait(3000);
    const name = screen.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "dashboard";
    await capture(`${name}.png`);
    log.push(`title: ${window.webContents.getTitle()}  url: ${window.webContents.getURL()}`);
    // Media › Audiobooks: the shelf with a book's parts open, Free classics (reaches archive.org), one recording and
    // its convert dialog, closed again without converting.
    if (screen === "/media") {
      const js = (code: string) => window.webContents.executeJavaScript(code).catch(() => {});
      await js(`document.querySelector('[data-tab="books"]')?.click()`);
      await wait(1500);
      await capture("media-books.png");
      await js(`document.querySelector('[aria-label^="Show parts of"]')?.click()`);
      await wait(500);
      await capture("media-books-parts.png");
      await js(`[...document.querySelectorAll('.bk-bar .seg button')].find((b) => b.textContent.includes("Free classics"))?.click()`);
      await wait(5000);
      await capture("media-free.png");
      log.push(`--- free classics: ${String(await js(`document.querySelectorAll(".bk-tile").length + " books"`))}`);
      await js(`document.querySelector('.bk-tile')?.click()`);
      await wait(4000);
      await capture("media-free-book.png");
      await js(`[...document.querySelectorAll('.bk-detail button')].find((b) => b.textContent.includes("Download and convert"))?.click()`);
      await wait(800);
      await capture("media-convert.png");
      await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await js(`[...document.querySelectorAll('.bk-bar .seg button')].find((b) => b.textContent.includes("Your books"))?.click()`);
    }
    // Studio's home: each tab too (Templates, then Community, which reach COROS and the community catalog).
    if (screen === "/studio") {
      for (const tab of ["Templates", "Community", "My faces"]) {
        await window.webContents.executeJavaScript(`[...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes(${JSON.stringify(tab)}))?.click()`).catch(() => {});
        await wait(tab === "My faces" ? 500 : 5000);
        if (tab !== "My faces") await capture(`studio-${tab.toLowerCase()}.png`);
        if (tab === "Templates") {
          await window.webContents.executeJavaScript(`[...document.querySelectorAll('[aria-label="Faces from"] button')].find((b) => b.textContent === "Official")?.click()`).catch(() => {});
          await wait(1500);
          await capture("studio-official.png");
        }
      }
      await window.webContents.executeJavaScript(`document.querySelector(".st-account-chip")?.click()`).catch(() => {});
      await wait(800);
      await capture("studio-account.png");
      log.push(`--- studio account: ${await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"]')?.textContent ?? "no dialog"`).catch(() => "failed")}`);
    }
  }
  // Studio, when a face was asked for: colour the minutes on their own, reopen the face, then Save BIN. Downloads land
  // in the smoke folder instead of asking where.
  const face = screens.find((x) => /^\/studio\/[a-f0-9-]{36}$/i.test(x));
  if (face) {
    window.webContents.session.on("will-download", (_event, item) => item.setSavePath(path.join(folder, item.getFilename())));
    const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
    const click = (selector: string, text?: string) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => ${text ? `b.textContent.includes(${JSON.stringify(text)})` : "true"}); el?.click(); return !!el; })()`);
    await window.loadURL(origin + face);
    await wait(4000);
    log.push(`--- studio: pick minutes ${await click(".st-layer-pick", "Minute digits")}`);
    await wait(500);
    log.push(`--- studio: colour ${await click('.st-insp [aria-label="Colour #ff6b9a"]')}`);
    await wait(3000);
    // The inspector as the design has it: a time layer, a live-data layer, nothing selected and Face, in each display.
    const shot = async (file: string) => { try { writeFileSync(path.join(folder, file), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); } };
    const openFolds = () => Promise.resolve();
    for (const display of ["Current", "Always-on"]) {
      const tag = display === "Current" ? "current" : "aod";
      if (display === "Always-on" && !(await click(".st-tools button", "Always-on"))) { log.push("--- studio: no always-on"); break; }
      await wait(1500);
      log.push(`--- studio ${tag}: time layer ${await click(".st-layer-pick", "Minute") || await click(".st-layer-pick", "Time")}`);
      await wait(800); await openFolds(); await wait(300); await shot(`studio-insp-${tag}-time.png`);
      // The font picker open on the time layer, then searched and moved through from the keyboard.
      if (tag === "current") {
        log.push(`--- studio: more actions ${await click('.st-insp-head [aria-label="More actions"]')}`);
        await wait(500); await wait(800); await shot("studio-insp-menu.png");
        log.push(`--- studio: menu box ${await run(`(() => { const m = document.querySelector(".st-insp-head [role=menu]"); if (!m) return "none"; const r = m.getBoundingClientRect(), c = getComputedStyle(m); return [Math.round(r.width), Math.round(r.height), c.backgroundColor, c.position, c.zIndex].join(" "); })()`)}`);
        await click('.st-insp-head [aria-label="More actions"]');
        await wait(300);
        log.push(`--- studio: font picker ${await click(".st-insp-body .st-pick")}`);
        await wait(1500); await wait(800); await shot("studio-font.png");
        await run(`(() => { const i = document.querySelector('.st-fp-sheet input'); if (!i) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "mono"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await wait(600);
        await run(`document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`);
        await wait(400); await wait(800); await shot("studio-font-search.png");
        log.push(`--- studio: font picker shows ${await run(`[...document.querySelectorAll(".st-fp-row")].map((r) => r.textContent).slice(0, 8).join(" | ")`)}`);
        await run(`document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        await wait(400);
        log.push(`--- studio: after Escape, picker ${await run(`document.querySelector(".st-fp-sheet") ? "open" : "closed"`)}, layer ${await run(`document.querySelector(".st-insp-head b")?.textContent ?? "none"`)}`);
      }
      log.push(`--- studio ${tag}: inspector shows ${await run(`document.querySelector(".st-insp-head b")?.textContent ?? "nothing"`)}`);
      log.push(`--- studio ${tag}: live data ${await click(".st-layer-pick", "Temperature") || await click(".st-layer-pick", "Battery data")}`);
      await wait(800); await openFolds(); await wait(300); await shot(`studio-insp-${tag}-data.png`);
      await run(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await wait(800); await shot(`studio-insp-${tag}-none.png`);
      await click(".st-right .st-tabs button", "Face");
      await wait(800); await shot(`studio-insp-${tag}-face.png`);
      if (tag === "current") { await click(".st-insp .st-pick"); await wait(1500); await wait(800); await shot("studio-font-face.png"); await click(".st-insp .st-pick"); }
      await click(".st-right .st-tabs button", "Layer");
    }
    // Add → Live data: the library, a search, then heart rate, steps, a weather field, a training field, a chart page
    // and a status indicator put on the face (each tile selects its layer once it's there).
    await click(".st-tools button", "Current");
    await wait(1200);
    await click(".st-left .st-tabs button", "Add");
    await wait(800); await shot("studio-add.png");
    await run(`(() => { const i = document.querySelector('.st-lib input[type="search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "tide"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await wait(500); window.webContents.invalidate(); await wait(400); await shot("studio-add-search.png");
    await run(`(() => { const i = document.querySelector('.st-lib input[type="search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    // Add → Artwork, time and date: what builds a blank face up. The image goes in through the tile's own file input
    // (a pink disc drawn here), the rest by their tiles. Rows a face already has (or can't take) log false.
    for (const label of ["Text", "Rectangle", "Image", "Seconds", "Analog hands", "Weekday"]) {
      let found: unknown = false;
      for (let tries = 0; tries < 3 && found !== true; tries++) {
        await click(".st-left .st-tabs button", "Add");
        await wait(500);
        found = label !== "Image" ? await click(`.st-lib [aria-label="Add ${label}"]`) : await run(`(async () => {
          const input = document.querySelector('.st-lib input[aria-label="Image file"]');
          if (!input) return false;
          const c = document.createElement("canvas"); c.width = 96; c.height = 96;
          const x = c.getContext("2d"); x.fillStyle = "#ff6b9a"; x.beginPath(); x.arc(48, 48, 44, 0, 7); x.fill();
          const blob = await new Promise((done) => c.toBlob(done, "image/png"));
          const files = new DataTransfer(); files.items.add(new File([blob], "smoke.png", { type: "image/png" }));
          input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()`);
      }
      await wait(1500);
      log.push(`--- studio add ${label}: ${found} → ${await run(`document.querySelector(".st-toast")?.textContent ?? ""`)}, selected ${await run(`document.querySelector(".st-insp-head b")?.textContent ?? "nothing"`)}`);
      if (found === true) { window.webContents.invalidate(); await wait(400); await shot(`studio-built-${label.toLowerCase().replace(/ /g, "-")}.png`); }
    }
    const builtUp = `fetch("/api/desktop/studio/projects${face.slice(7)}").then((r) => r.json()).then((b) => { const d = b.project.design; return JSON.stringify({ shapes: (d.backgroundElements ?? []).map((e) => e.kind), images: (d.designSprites ?? []).length, order: (d.artworkLayerOrder ?? []).length, seconds: d.addSeconds, weekday: d.addWeekday, hands: Object.keys(d.configAssetOverrides ?? {}).filter((k) => /time_(hour|minute|second)_icon|center_polygon/.test(k)), aodHands: Object.keys(d.modeDesigns?.aod?.configAssetOverrides ?? {}).filter((k) => /time_(hour|minute|second)_icon|center_polygon/.test(k)) }); })`;
    await wait(1500);
    log.push(`--- studio: built up ${await run(builtUp)}`);
    for (const label of ["Heart rate", "Steps", "Weather data", "Weekly training load", "Daily activity", "Bluetooth", "Do Not Disturb"]) {
      let found: unknown = false;
      for (let tries = 0; tries < 8 && found !== true; tries++) {
        await click(".st-left .st-tabs button", "Add");
        await wait(500);
        // A chart page is picked behind the one Chart entry.
        if (label === "Daily activity") { await click(".st-ch-card"); await wait(500); if (tries === 0) { window.webContents.invalidate(); await wait(400); await shot("studio-chart-pick.png"); } }
        found = await click(label === "Daily activity" ? `.st-ch-pick [aria-label="Add ${label}"]` : `.st-lib [aria-label="Add ${label}"]`);
      }
      await wait(1500);
      log.push(`--- studio add ${label}: ${found} → ${await run(`document.querySelector(".st-toast")?.textContent ?? ""`)}`);
    }
    window.webContents.invalidate(); await wait(400); await shot("studio-added.png");
    // A live-data part edited on its own (StudioNativePart.tsx): weekly load's states, one picked, then its icon with
    // an own font.
    await click(".st-left .st-tabs button", "Layers"); await wait(800);
    log.push(`--- studio parts: layer ${await click(".st-layer-pick", "Weekly training load")}`); await wait(800);
    log.push(`--- studio parts: states ${await click('.st-insp [aria-label="Part"] button', "States")}; show ${await click('.st-insp [aria-label="Show States"][aria-checked="false"]')}`); await wait(1200);
    log.push(`--- studio parts: pick 03 ${await click(".st-insp .st-np-cell", "03")}`); await wait(600);
    const partControls = `[...document.querySelectorAll(".st-insp .st-np-actions button, .st-insp .st-num span, .st-insp .st-np-reset")].map((b) => b.textContent).join(" | ")`;
    log.push(`--- studio parts: controls ${await run(partControls)}`);
    await run(`document.querySelector(".st-insp .st-np-grid")?.scrollIntoView({ block: "start" })`);
    window.webContents.invalidate(); await wait(400); await shot("studio-parts-states.png");
    log.push(`--- studio parts: icon ${await click('.st-insp [aria-label="Part"] button', "Icon")}; own font ${await click('.st-insp [aria-label="Icon own font"]')}`); await wait(1200);
    log.push(`--- studio parts: icon controls ${await run(partControls)}`);
    await run(`document.querySelector(".st-insp .st-np-grid")?.scrollIntoView({ block: "start" })`);
    window.webContents.invalidate(); await wait(400); await shot("studio-parts-icon.png");
    // The chart's pages (studioCharts.ts): the list as Daily activity left it, the Sun page looked at before it's
    // on, added, then the preview stepped the way the watch's Back button goes.
    await click(".st-left .st-tabs button", "Layers");
    await wait(1200);
    const pages = () => run(`[...document.querySelectorAll(".st-ch-pg")].map((r) => (r.querySelector(".st-ch-num").textContent || "-") + " " + r.querySelector(".st-ch-pg-main span:nth-of-type(2)").textContent + (r.querySelector(".st-ch-pg-tag") ? "*" : "")).join(" | ")`);
    log.push(`--- studio chart: layer ${await run(`(() => { const b = [...document.querySelectorAll(".st-layer-pick")].find((x) => /chart/i.test(x.textContent)); b?.click(); return b?.textContent ?? "none"; })()`)}`);
    await wait(1200); window.webContents.invalidate(); await wait(400); await shot("studio-chart-pages.png");
    log.push(`--- studio chart: pages ${await pages()}`);
    log.push(`--- studio chart: look at Sun ${await click(".st-ch-pg-main", "Sun")}`);
    await wait(600); window.webContents.invalidate(); await wait(400); await shot("studio-chart-try.png");
    log.push(`--- studio chart: add it ${await click(".st-ch-add")}`);
    await wait(2500);
    log.push(`--- studio chart: pages ${await pages()}`);
    window.webContents.invalidate(); await wait(400); await shot("studio-chart-added.png");
    log.push(`--- studio chart: Back ${await click(".st-ch-back")}`);
    await wait(2500);
    log.push(`--- studio chart: pages ${await pages()}`);
    window.webContents.invalidate(); await wait(400); await shot("studio-chart-back.png");
    // A readout on every page: stress leaves Daily stats for the Stress field, then goes back; sunrise can't.
    // Calories becomes the face's own number in the readout's digit art, its icon an image layer; then back on its page.
    log.push(`--- studio chart pin: calories ${await click('.st-ch-ro [aria-label="Show Calories on every page"]')}`);
    await wait(3000);
    log.push(`--- studio chart pin: calories rows ${await run(`[...document.querySelectorAll(".st-ch-ro")].map((r) => r.textContent).join(" | ")`)}; layers ${await run(`[...document.querySelectorAll(".st-layer-pick")].map((b) => b.textContent).filter((t) => /calor/i.test(t)).join(" | ")`)}`);
    window.webContents.invalidate(); await wait(400); await shot("studio-chart-pinned-number.png");
    await click(".st-ch-putback"); await wait(2000);
    await click(".st-ch-pg-main", "Daily stats"); await wait(600); await click(".st-ch-add"); await wait(2500);
    log.push(`--- studio chart pin: stress ${await click('.st-ch-ro [aria-label="Show Stress on every page"]')}`);
    await wait(2500);
    log.push(`--- studio chart pin: every page ${await run(`[...document.querySelectorAll(".st-ch-putback")].map((b) => b.textContent).join(" | ")`)}; rows ${await run(`[...document.querySelectorAll(".st-ch-ro")].map((r) => r.textContent).join(" | ")`)}`);
    window.webContents.invalidate(); await wait(400); await shot("studio-chart-pinned.png");
    log.push(`--- studio chart pin: put back ${await click(".st-ch-putback")}`);
    await wait(2500);
    log.push(`--- studio chart pin: every page now ${await run(`document.querySelectorAll(".st-ch-putback").length`)}`);
    await click(".st-ch-pg-main", "Sun"); await wait(1500);
    await click('.st-ch-ro [aria-label="Show Sunrise and sunset on every page"]'); await wait(500);
    log.push(`--- studio chart pin: sunrise ${await run(`[...document.querySelectorAll(".st-ch-why")].map((p) => p.textContent).join(" | ")`)}`);
    // The pages strip under the watch and the Back button on its bezel, with another layer selected.
    await click(".st-layer-pick", "Weather data");
    await wait(800);
    log.push(`--- studio chart strip: ${await run(`[...document.querySelectorAll(".st-ch-chip")].map((c) => c.textContent + (c.getAttribute("aria-pressed") === "true" ? "*" : "")).join(" | ")`)}; chip Sun ${await click(".st-ch-chip", "Sun")}`);
    await wait(2500);
    log.push(`--- studio chart strip: ${await run(`[...document.querySelectorAll(".st-ch-chip")].map((c) => c.textContent + (c.getAttribute("aria-pressed") === "true" ? "*" : "")).join(" | ")`)}; bezel Back ${await click(".st-ch-backbtn")}`);
    await wait(2500);
    log.push(`--- studio chart strip: ${await run(`[...document.querySelectorAll(".st-ch-chip")].map((c) => c.textContent + (c.getAttribute("aria-pressed") === "true" ? "*" : "")).join(" | ")`)}, inspector ${await run(`document.querySelector(".st-insp-head b")?.textContent ?? "none"`)}`);
    window.webContents.invalidate(); await wait(400); await shot("studio-chart-strip.png");
    await click(".st-left .st-tabs button", "Add");
    await wait(600);
    log.push(`--- studio: boxes on the watch ${await run(`[...document.querySelectorAll(".st-hit")].map((b) => b.getAttribute("aria-label").replace("Select ", "") + " " + [b.style.left, b.style.top, b.style.width].map((v) => Math.round(parseFloat(v))).join(",")).join(" | ")`)}`);
    await click(".st-left .st-tabs button", "Layers");
    await wait(2500);
    log.push(`--- studio: live data on the face ${await run(`fetch("/api/desktop/studio/projects${face.slice(7)}").then((r) => r.json()).then((b) => JSON.stringify({ native: Object.entries(b.project.design.nativeData ?? {}).filter(([, v]) => v.enabled).map(([k]) => k), metrics: b.project.design.metricChanges, status: Object.keys(b.project.design.configAssetOverrides ?? {}).filter((k) => /bluetooth|disturb|airplane|battery/.test(k)).map((k) => k + (b.project.design.configAssetOverrides[k].replacement ? " (Studio art)" : "")) }))`)}`);
    // Shared spots (studioFace.ts): Bluetooth's on, off and airplane images are one row and one box. The row picked,
    // each state shown from the inspector (one the face lacks gets Studio's image), the simulation's switch, then the
    // whole spot hidden and shown from its row.
    log.push(`--- studio spot: status rows ${await run(`[...document.querySelectorAll('[aria-label="Status"] .st-layer-pick')].map((b) => [...b.querySelectorAll("span")].map((x) => x.textContent).join(" / ")).join(" | ")`)}`);
    log.push(`--- studio spot: pick ${await click(".st-layer-pick", "Bluetooth")}`);
    await wait(1200); await shot("studio-spot-layers.png");
    const spotState = () => run(`JSON.stringify({ boxes: [...document.querySelectorAll(".st-hit")].filter((b) => /Bluetooth|Airplane/.test(b.getAttribute("aria-label"))).map((b) => b.getAttribute("aria-label")), tag: document.querySelector(".st-sel span")?.textContent ?? "", head: document.querySelector(".st-insp-head")?.textContent ?? "", states: [...document.querySelectorAll('.st-insp-body [role="group"] button')].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")), actions: [...document.querySelectorAll(".st-insp-body .st-chip-btn, .st-insp-body .st-row > span")].map((b) => b.textContent) })`);
    log.push(`--- studio spot: selected ${await spotState()}`);
    for (const state of ["On", "Off", "Airplane mode"]) {
      log.push(`--- studio spot: state ${state} ${await click('.st-insp-body [role="group"] button', state)}`);
      await wait(1200);
      if (await click(".st-insp-body .st-chip-btn", "Add image")) { log.push(`--- studio spot: added an image for ${state}`); await wait(1500); }
      log.push(`--- studio spot: ${state} ${await spotState()}`);
      window.webContents.invalidate(); await wait(300); await shot(`studio-spot-state-${state.toLowerCase().replace(/[^a-z]+/g, "-")}.png`);
    }
    await click(".st-tools .chip", "Simulate");
    await wait(600);
    log.push(`--- studio spot: simulation ${await run(`[...document.querySelectorAll(".st-sim .st-range")].map((l) => l.querySelector("span")?.textContent + ": " + [...l.querySelectorAll('[role="group"] button')].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join("/")).join(" | ")`)}`);
    log.push(`--- studio spot: simulate Off ${await click('.st-sim [aria-label="Bluetooth state"] button', "Off")}`);
    await wait(1200); window.webContents.invalidate(); await wait(300); await shot("studio-spot-sim.png");
    log.push(`--- studio spot: after the simulation ${await spotState()}`);
    await click(".st-tools .chip", "Simulate");
    log.push(`--- studio spot: hide ${await click('[aria-label="Hide Bluetooth"]')}`);
    await wait(2500);
    const spotSaved = () => run(`fetch("/api/desktop/studio/projects${face.slice(7)}").then((r) => r.json()).then((b) => JSON.stringify({ images: Object.fromEntries(Object.entries(b.project.design.configAssetOverrides ?? {}).filter(([k]) => /bluetooth|airplane|disturb|sleep_mode/.test(k)).map(([k, v]) => [k.slice(7), v.enabled !== false])), offsets: Object.fromEntries(Object.entries(b.project.design.layoutOffsets ?? {}).filter(([k]) => /Status/.test(k))), spotKeys: JSON.stringify(b.project.design).match(/"spot[^"]*"/g) }))`);
    log.push(`--- studio spot: hidden ${await spotSaved()}, boxes ${await run(`[...document.querySelectorAll(".st-hit")].filter((b) => /Bluetooth|Airplane/.test(b.getAttribute("aria-label"))).length`)}`);
    await shot("studio-spot-hidden.png");
    log.push(`--- studio spot: show ${await click('[aria-label="Show Bluetooth"]')}`);
    await wait(2500);
    log.push(`--- studio spot: shown ${await spotSaved()}`);
    await run(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await wait(500);
    // Dragging on the watch, by real mouse input: each kind of layer, then two together. Shots mid-drag, just after the
    // drop and once the face is redrawn; the artwork must be in one place in all three (studioDrag.ts). Undone after.
    // Then snapping (studioSnap.ts): each kind dropped 3 px off another layer's left edge, which it should snap to
    // (to what the layers draw, so the line may land on a near edge or centre instead), with the pink line showing.
    // Last, equal spacing: the weekday dropped in line after the minutes and the hour, 3 px off the gap between them.
    const drags: { labels: string[]; dx: number; dy: number; to?: string; between?: [string, string] }[] = [
      { labels: ["Weekday"], dx: -90, dy: -70 }, { labels: ["Minute"], dx: 60, dy: 40 }, { labels: ["Weather data"], dx: -50, dy: 60 },
      { labels: ["Bluetooth"], dx: 40, dy: -40 }, { labels: ["Steps", "Weekly training load"], dx: 30, dy: -60 },
      { labels: ["Minute"], to: "Weekday", dx: 0, dy: 50 }, { labels: ["Weekday"], to: "Weather data", dx: 0, dy: 40 },
      { labels: ["Weather data"], to: "Steps", dx: 0, dy: -30 }, { labels: ["Bluetooth"], to: "Heart rate", dx: 0, dy: 30 },
      { labels: ["Steps", "Weekly training load"], to: "Minute", dx: 0, dy: 20 },
      { labels: ["Weekday"], between: ["Minute", "Hour"], dx: 0, dy: 0 },
    ];
    for (const [n, d] of drags.entries()) {
      const others = [...(d.to ? [d.to] : []), ...(d.between ?? [])];
      const rects = await run(`JSON.stringify(${JSON.stringify([...d.labels, ...others])}.map((t) => { const b = [...document.querySelectorAll(".st-hit")].find((h) => h.getAttribute("aria-label").startsWith("Select " + t)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right }; }))`);
      const all = JSON.parse(String(rects)) as ({ x: number; y: number; left: number; right: number } | null)[];
      const at = all.slice(0, d.labels.length);
      if (all.some((p) => !p)) { log.push(`--- studio drag ${d.labels.join(" + ")}${d.to ? ` to ${d.to}` : ""}: not on the face`); continue; }
      // Snap cases: the moving boxes' left edge to 3 px right of the target's.
      if (d.to) d.dx = all[d.labels.length]!.left + 3 - Math.min(...at.map((p) => p!.left));
      if (d.between) {
        const [a, b] = all.slice(d.labels.length) as { x: number; y: number; left: number; right: number }[];
        const [first, second] = a.left < b.left ? [a, b] : [b, a];
        d.dx = second.right + (second.left - first.right) + 3 - at[0]!.left; d.dy = second.y - at[0]!.y;
      }
      const tag = `studio-${d.to || d.between ? "snap" : "drag"}-${n}-${[...d.labels, ...(d.to ? ["to", d.to] : []), ...(d.between ? ["after", ...d.between] : [])].join("-").toLowerCase().replace(/[^a-z]+/g, "-")}`;
      const mouse = (type: "mouseDown" | "mouseUp" | "mouseMove", x: number, y: number, shift = false) =>
        window.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, modifiers: shift ? ["shift"] : [] });
      // The others are shift-clicked into the selection first; the drag starts on the first.
      for (const p of at.slice(1)) { mouse("mouseDown", p!.x, p!.y, true); mouse("mouseUp", p!.x, p!.y, true); await wait(150); }
      const { x, y } = at[0]!;
      if (at.length > 1) { mouse("mouseDown", x, y, true); mouse("mouseUp", x, y, true); await wait(150); }
      mouse("mouseMove", x, y); mouse("mouseDown", x, y);
      await wait(1500); // the drag frames, composed once the layer is selected
      for (let i = 1; i <= 10; i++) { mouse("mouseMove", x + (d.dx * i) / 10, y + (d.dy * i) / 10); await wait(30); }
      await wait(300);
      log.push(`--- studio drag ${d.labels.join(" + ")}: mid-drag ${await run(`(document.querySelector(".st-drag-sprite") ? "sprite" : "no sprite") + ", " + (document.querySelector(".st-drag-base") ? "base" : "no base") + ", tag " + (document.querySelector(".st-sel span")?.textContent ?? "")`)}`);
      if (d.to || d.between) log.push(`--- studio snap ${d.labels.join(" + ")} ${d.to ? `to ${d.to}` : `after ${d.between!.join(" and ")}`}: lines ${await run(`[...document.querySelectorAll(".st-snap")].map((l) => (l.style.width === "1px" ? "x " + l.style.left : "y " + l.style.top)).join(", ") || "none"`)}; gaps ${await run(`[...document.querySelectorAll(".st-gap")].map((g) => g.dataset.axis + " " + g.textContent + (g.dataset.equal ? " equal" : "")).join(", ") || "none"`)}; outlined ${await run(`document.querySelectorAll(".st-snap-to").length`)}`);
      window.webContents.invalidate(); await shot(`${tag}-a-mid.png`);
      mouse("mouseUp", x + d.dx, y + d.dy);
      await wait(16);
      log.push(`--- studio drag ${d.labels.join(" + ")}: after drop ${await run(`document.querySelector(".st-drag-sprite") ? "held" : "face"`)}`);
      window.webContents.invalidate(); await shot(`${tag}-b-drop.png`);
      await wait(2000);
      log.push(`--- studio drag ${d.labels.join(" + ")}: settled ${await run(`(document.querySelector(".st-drag-sprite") ? "still held" : "face") + ", tag " + (document.querySelector(".st-sel span")?.textContent ?? "")`)}`);
      window.webContents.invalidate();
      await shot(`${tag}-c-after.png`);
      for (let i = 0; i < 40 && String(await run(`!!document.querySelector(".st-drag-sprite")`)) === "true"; i++) await wait(250);
      log.push(`--- studio drag: released ${await run(`document.querySelector(".st-drag-sprite") ? "no" : "yes"`)}`);
      await click('[aria-label="Undo"]');
      await run(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await wait(1500);
    }
    // Every layer the face has, one by one: the inspector each kind opens, its top and its end.
    await click(".st-tools button", "Current");
    await wait(1200);
    const count = Number(await run(`document.querySelectorAll(".st-layer-pick").length`)) || 0;
    for (let i = 0; i < Math.min(count, 40); i++) {
      const label = await run(`(() => { const b = document.querySelectorAll(".st-layer-pick")[${i}]; b?.click(); return b?.textContent ?? ""; })()`);
      await wait(700);
      log.push(`--- studio layer ${i}: ${label} → ${await run(`document.querySelector(".st-insp-head small")?.textContent ?? "nothing"`)}`);
      await run(`document.querySelector(".st-right").scrollTop = 0`);
      await shot(`studio-layer-${String(i).padStart(2, "0")}-a.png`);
      if (Number(await run(`(() => { const r = document.querySelector(".st-right"); return r.scrollHeight - r.clientHeight; })()`)) > 8) {
        await run(`document.querySelector(".st-right").scrollTop = 1e6`);
        await wait(200); await shot(`studio-layer-${String(i).padStart(2, "0")}-b.png`);
      }
    }
    await wait(1500);
    await window.loadURL(origin + face);
    await wait(4000);
    log.push(`--- studio: after reopening ${await run(`fetch("/api/desktop/studio/projects${face.slice(7)}").then((r) => r.json()).then((b) => JSON.stringify({ timeStyles: b.project.design.timeStyles, native: Object.entries(b.project.design.nativeData ?? {}).filter(([, v]) => v.enabled).map(([k]) => k) }))`)}`);
    log.push(`--- studio: built up, after reopening ${await run(builtUp)}`);
    log.push(`--- studio spot: after reopening ${await run(`fetch("/api/desktop/studio/projects${face.slice(7)}").then((r) => r.json()).then((b) => JSON.stringify(Object.fromEntries(Object.entries(b.project.design.configAssetOverrides ?? {}).filter(([k]) => /bluetooth|airplane|disturb|sleep_mode/.test(k)).map(([k, v]) => [k.slice(7), v.enabled !== false]))))`)}, rows ${await run(`[...document.querySelectorAll('[aria-label="Status"] .st-layer-pick')].map((b) => [...b.querySelectorAll("span")].map((x) => x.textContent).join(" / ")).join(" | ")`)}`);
    try { writeFileSync(path.join(folder, "studio-reopened.png"), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
    await click(".st-top button", "Download");
    await wait(300);
    log.push(`--- studio: save BIN ${await click(".st-menu-down button", "Save BIN")}`);
    await wait(15000);
    log.push(`--- studio: after BIN ${await run(`(document.querySelector(".st-toast")?.textContent ?? "") + " | " + (document.querySelector(".notice")?.textContent ?? "")`)}`);
    // Send: each tab as the design has it, the compiled preview and its checks, and the iPhone code.
    log.push(`--- studio: send ${await click(".st-top button", "Send")}`);
    await wait(12000);
    await capture("studio-send-watch.png");
    log.push(`--- studio send: ${await run(`document.querySelector(".st-send")?.innerText.replace(/\\s+/g, " ").slice(0, 600) ?? "no dialog"`)}`);
    log.push(`--- studio send: iPhone ${await click(".st-send-nowatch button", "Send to iPhone")}`);
    await wait(2500);
    await capture("studio-send-iphone.png");
    log.push(`--- studio send: iPhone link ${await run(`fetch("/api/desktop/studio/phone").then((r) => r.text())`)}`);
    for (const tab of ["COROS app", "File"]) {
      await click(".st-send .st-dialog-head button", tab);
      await wait(1200);
      await capture(`studio-send-${tab === "File" ? "file" : "app"}.png`);
    }
  }
  // Studio's official asset library and Google Fonts, against the real ones (smokeStudioAssets.ts).
  if (process.env.CLINK_SMOKE_STUDIO_ASSETS) await smokeStudioAssets(window, origin, folder, log);
  // Convert for another watch, from the 800 px master and for a recovered face (smokeStudioConvert.ts).
  if (process.env.CLINK_SMOKE_STUDIO_CONVERT) await smokeStudioConvert(window, origin, folder, log);
  // The battery's "%" look on the SIMPLE template (smokeStudioPercent.ts).
  if (process.env.CLINK_SMOKE_STUDIO_PERCENT) await smokeStudioPercent(window, origin, folder, log);
  // The selectable data slot on a Start-blank face (smokeStudioSlot.ts).
  if (process.env.CLINK_SMOKE_STUDIO_SLOT) await smokeStudioSlot(window, origin, folder, log);
  // Every layer's inspector on one saved face, to compare with CorosLink (smokeStudioCompare.ts).
  if (process.env.CLINK_SMOKE_STUDIO_COMPARE) await smokeStudioCompare(window, origin, folder, log);
  // The watch-face MCP server against the open editor (smokeStudioAutomation.ts).
  if (process.env.CLINK_SMOKE_STUDIO_AUTOMATION) await smokeStudioAutomation(window, origin, folder, log);
  // Watchmaker in the editor, with a scripted model (smokeStudioWatchmaker.ts).
  if (process.env.CLINK_SMOKE_STUDIO_WATCHMAKER) await smokeStudioWatchmaker(window, origin, folder, log);
  // Developer → Activity screens with a simulated PACE Pro (smokeActivityScreens.ts).
  if (process.env.CLINK_SMOKE_ACTIVITY_SCREENS) await smokeActivityScreens(window, origin, folder, log);
  // Connections with a pairing code up.
  await window.loadURL(`${origin}/connect`);
  await wait(2000);
  await window.webContents.executeJavaScript(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Pair a phone")?.click()`);
  await wait(1500);
  try { writeFileSync(path.join(folder, "connect-pairing.png"), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  const link = await window.webContents.executeJavaScript(`fetch("/api/desktop/phones").then((r) => r.json()).then((s) => JSON.stringify(s))`);
  log.push(`--- phones: ${link}`);
  // What a phone on the network sees: the descriptor at this computer's LAN address.
  const status = JSON.parse(link) as { addresses: string[]; port: number };
  if (status.addresses[0]) {
    const seen = await fetch(`http://${status.addresses[0]}:${status.port}/v1/descriptor`).then((r) => r.text(), (e: unknown) => String(e));
    log.push(`--- descriptor over the LAN: ${seen}`);
  }

  // A write through the page, the way a screen saves: same-site POST to /api/sync.
  const wrote = await window.webContents.executeJavaScript(`fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" },
    body: JSON.stringify({ changes: [{ collection: "feel.check", id: "2026-11-21", body: { day: { year: 2026, month: 11, day: 21 }, feel: 4, tags: [] } }] }) }).then((r) => r.status + " " + r.statusText)`);
  log.push(`--- write: ${wrote}`);
  writeFileSync(path.join(folder, "console.txt"), log.join("\n"));
  app.quit();
}
