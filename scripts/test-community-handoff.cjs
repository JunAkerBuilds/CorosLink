const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");

const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(os.tmpdir(), `coroslink-handoff-${process.pid}`);
app.setPath("userData", path.join(temporaryRoot, "user-data"));
app.on("window-all-closed", () => {});

async function until(read, accept, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await fs.mkdir(temporaryRoot, { recursive: true });
  await app.whenReady();
  const { createServer } = await import("vite");
  const { createStoreZip } = require("../dist-electron/zipStore.js");
  const service = require("../dist-electron/corosWatchfaceService.js");
  const { onWatchfaceRendererNavigation } = require("../dist-electron/watchfaceRendererLifecycle.js");
  const png = (size) => nativeImage.createFromBitmap(Buffer.alloc(size * size * 4, 255), { width: size, height: size }).toPNG();
  const archivePath = path.join(temporaryRoot, "fixture.dat");
  await fs.writeFile(archivePath, createStoreZip([
    { name: "info.json", data: Buffer.from(JSON.stringify({ o_template_id: 250601, o_diy_version: 1, o_wf_ver: 4 })) },
    { name: "watchface_customize.png", data: png(40) },
    { name: "watchface_416x416/config.txt", data: Buffer.from("[watchface_id]=0\r\n[background_icon]=background.png") },
    { name: "watchface_416x416/background.png", data: png(416) },
    { name: "watchface_416x416/thmb.png", data: png(80) }
  ]));
  const archive = await service.selectCorosWatchfaceArchive(archivePath);
  const imports = [];
  const importedModels = [];
  const requestedModels = [];
  const saves = [];
  let failSave = false;
  const face = (slug) => ({ slug, title: slug, models: ["PACE Pro"] });
  const handlers = {
    "watchfaces:getStatus": () => ({ authenticated: false, secureStorageAvailable: false, savedCredentialsAvailable: false, suggestedRegion: "us" }),
    "watchfaces:listProjects": () => [],
    "watchfaces:automation:setRendererReady": () => undefined,
    "watchfaces:listCommunity": () => ({ schemaVersion: 1, items: [], pagination: { page: 1, pageCount: 1, total: 0 }, facets: { models: [], styles: [] } }),
    "watchfaces:getCommunity": (_, slug, model) => { requestedModels.push(model); return face(slug); },
    "watchfaces:importCommunity": (_, slug, model) => { imports.push(slug); importedModels.push(model); return { face: face(slug), archive }; },
    "watchfaces:describeTemplate": (_, id) => service.describeCorosWatchfaceTemplate(id),
    "watchfaces:loadTemplateAssets": (_, id, paths) => service.loadCorosWatchfaceTemplateAssets(id, paths),
    "watchfaces:loadTemplateConfigTexts": (_, id) => service.loadCorosWatchfaceTemplateConfigTexts(id),
    "watchfaces:cacheProjectPreview": () => undefined,
    "watchfaces:listLocalFontFamilies": () => ["Arial"],
    "watchfaces:saveProject": (_, input) => {
      if (failSave) throw new Error("Fixture save failed");
      saves.push(input);
      return { ...input, projectId: "handoff-test", updatedAt: new Date().toISOString(), archive };
    }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  let vite;
  let window;
  const errors = [];
  let stage = "starting renderer";
  const watchdog = setTimeout(() => { console.error(`Handoff test stalled: ${stage}`, errors); app.exit(1); }, 90_000);
  try {
    vite = await createServer({ root, cacheDir: path.join(temporaryRoot, "vite-cache"), server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false }, logLevel: "error" });
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, "dist-electron/preload.js"), sandbox: false, contextIsolation: true, backgroundThrottling: false } });
    let rendererReady = false;
    let resets = 0;
    let loadingEvents = 0;
    window.webContents.on("did-start-loading", () => { loadingEvents += 1; });
    onWatchfaceRendererNavigation(window.webContents, () => { rendererReady = false; resets += 1; });
    window.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
    const js = (code) => window.webContents.executeJavaScript(code);
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/community-handoff.html`);
    await until(() => js('Boolean(document.querySelector(".watchfaces-view"))'), Boolean, "hub ready");
    rendererReady = true;
    const initialResets = resets;
    const initialLoadingEvents = loadingEvents;
    stage = "same-document navigation";
    await js('location.hash = "handoff-check"; void 0;');
    stage = "subframe navigation";
    await js(`new Promise(resolve => { const frame = document.createElement('iframe'); frame.onload = () => resolve(true); frame.src = 'data:text/html,<p>Subframe navigation</p>'; document.body.append(frame); })`);
    assert.equal(rendererReady, true, "hash and subframe loading keep the existing listener ready");
    assert.equal(resets, initialResets);
    assert.ok(loadingEvents > initialLoadingEvents, "the old loading listener would have incorrectly cleared readiness");
    const loaded = new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
    stage = "renderer reload";
    window.webContents.reload();
    await loaded;
    assert.equal(rendererReady, false, "a real page reload resets IPC readiness");
    assert.ok(resets > initialResets);
    await until(() => js('Boolean(document.querySelector(".watchfaces-view"))'), Boolean, "hub after reload");
    stage = "community requests";
    let sequence = 0;
    const open = (slug, model) => js(`window.dispatchEvent(new CustomEvent('test:community-open', {detail:${JSON.stringify({ slug, model, requestId: ++sequence })}})); void 0;`);
    const name = () => js('document.querySelector(".watchface-editor-name")?.value');
    const dialog = () => js('Boolean(document.querySelector("#wf-unsaved-title"))');
    const expectName = (value) => until(name, (actual) => actual === value, `editor ${value}`);
    const editName = (value) => js(`(() => { const input=document.querySelector('.watchface-editor-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    const choose = (label) => js(`Array.from(document.querySelectorAll('.wf-modal-actions button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click(); void 0;`);

    await open("first-face", "PACE 4"); await expectName("first-face");
    await until(() => js('Boolean(document.querySelector(".wf-save-state:not(.is-dirty)"))'), Boolean, "clean editor");
    await open("second-face"); await expectName("second-face");
    assert.equal(await dialog(), false, "a clean editor switches directly");

    await editName("My unsaved edits");
    await open("third-face"); await until(dialog, Boolean, "unsaved edits prompt");
    assert.equal(await name(), "My unsaved edits");
    assert.deepEqual(imports, ["first-face", "second-face"], "no import before a decision");
    await choose("Cancel"); await until(dialog, (value) => !value, "cancel closes prompt");
    await js('document.querySelector(".wf-back-button").click()');
    await until(dialog, Boolean, "manual Projects leave prompt");
    await choose("Discard");
    await until(() => js('Boolean(document.querySelector(".watchface-editor"))'), (value) => !value, "back at hub");
    assert.deepEqual(imports, ["first-face", "second-face"], "cancel clears queued handoff");

    await open("third-face"); await expectName("third-face");
    await editName("Keep these edits");
    await open("fourth-face"); await until(dialog, Boolean, "save prompt");
    failSave = true;
    await choose("Save");
    await until(() => js('document.body.innerText.includes("Fixture save failed")'), Boolean, "save failure visible");
    assert.equal(await name(), "Keep these edits");
    assert.equal(await dialog(), true, "save failure retains the editor and prompt");
    failSave = false;
    await choose("Save"); await expectName("fourth-face");
    assert.equal(saves.at(-1).name, "Keep these edits");

    await editName("Discard these edits");
    await open("fifth-face", "PACE 4"); await until(dialog, Boolean, "discard prompt");
    await choose("Discard"); await expectName("fifth-face");
    assert.deepEqual(imports, ["first-face", "second-face", "third-face", "fourth-face", "fifth-face"]);
    assert.deepEqual(importedModels, ["PACE 4", undefined, undefined, undefined, "PACE 4"], "selected model survives direct and queued handoffs");
    assert.equal(requestedModels[0], "PACE 4");
    assert.equal(requestedModels.at(-1), "PACE 4");
    assert.equal(errors.filter((error) => !error.includes("Fixture save failed")).length, 0, errors.join("\n"));
    console.log("Community handoff passed: renderer navigation, direct open, saved editor, unsaved edits, cancel, save failure, save, discard, exact import count.");
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite?.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
