const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const temporaryRoot = path.join(os.tmpdir(), `coroslink-automation-e2e-${process.pid}`);
app.setPath("userData", path.join(temporaryRoot, "user-data"));

async function until(read, accept, description) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (accept(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function solidPng(width, height, shade) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = shade; rgba[i + 1] = shade; rgba[i + 2] = shade; rgba[i + 3] = 255; }
  return nativeImage.createFromBitmap(rgba, { width, height }).toPNG();
}

async function main() {
  await fs.mkdir(temporaryRoot, { recursive: true });
  await app.whenReady();
  const { createServer } = await import("vite");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { initializeDatabase } = require("../dist-electron/database.js");
  const { createStoreZip } = require("../dist-electron/zipStore.js");
  const { registerWatchfaceAutomation } = require("../dist-electron/watchfaceAutomation.js");
  const service = require("../dist-electron/corosWatchfaceService.js");
  initializeDatabase(app.getPath("userData"));

  // These are the production preload/service IPC contracts used by the real
  // editor. The automation endpoint and broker are registered unchanged.
  const handlers = {
    // Keep account/keychain access outside this offline editing test.
    "watchfaces:getStatus": () => ({ authenticated: false, secureStorageAvailable: false, savedCredentialsAvailable: false, suggestedRegion: "us" }),
    "watchfaces:listProjects": () => service.listCorosWatchfaceProjects(),
    "watchfaces:saveProject": (_, input) => service.saveCorosWatchfaceProject(input),
    "watchfaces:loadProject": (_, id) => service.loadCorosWatchfaceProject(id),
    "watchfaces:describeTemplate": (_, id) => service.describeCorosWatchfaceTemplate(id),
    "watchfaces:loadTemplateAssets": (_, id, paths) => service.loadCorosWatchfaceTemplateAssets(id, paths),
    "watchfaces:loadTemplateConfigTexts": (_, id) => service.loadCorosWatchfaceTemplateConfigTexts(id),
    "watchfaces:createArchive": (_, input) => service.createCorosWatchfaceArchive(input),
    "watchfaces:cacheProjectPreview": (_, id, preview) => service.cacheCorosWatchfaceProjectPreview(id, preview),
    "watchfaces:listLocalFontFamilies": () => ["Arial", "Helvetica"]
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);

  const entries = [{ name: "info.json", data: Buffer.from(JSON.stringify({ o_template_id: 250601, o_diy_version: 1, o_wf_ver: 4 })) }, { name: "watchface_customize.png", data: solidPng(40, 40, 30) }];
  for (const resolution of [416, 800]) {
    const directory = `watchface_${resolution}x${resolution}`;
    const k = resolution / 800;
    const config = ["[watchface_id]=0", "[background_icon]=background.png"];
    for (const [index, part] of ["hour_high", "hour_low", "minute_high", "minute_low"].entries()) {
      config.push(`[time_${part}_pos]={${Math.round((220 + index * 90) * k)},${Math.round(240 * k)}}`, `[time_${part}_font]=01`);
    }
    config.push(`[battery_level_rect]={${Math.round(200*k)},${Math.round(420*k)},${Math.round(350*k)},${Math.round(480*k)},hcenter|vcenter}`, "[battery_level_font]=01");
    entries.push({ name: `${directory}/config.txt`, data: Buffer.from(config.join("\r\n")) }, { name: `${directory}/AODconfig.txt`, data: Buffer.from(config.join("\r\n")) }, { name: `${directory}/background.png`, data: solidPng(resolution, resolution, 0) }, { name: `${directory}/thmb.png`, data: solidPng(80, 80, 0) });
    for (let digit = 0; digit < 10; digit++) entries.push({ name: `${directory}/01/0${digit}.png`, data: solidPng(Math.round(60*k), Math.round(95*k), 50 + digit*20) });
  }
  const fixture = path.join(temporaryRoot, "starter.dat");
  const currentOnlyFixture = path.join(temporaryRoot, "current-only.dat");
  const imagePath = path.join(temporaryRoot, "artwork.png");
  await fs.writeFile(fixture, createStoreZip(entries));
  await fs.writeFile(currentOnlyFixture, createStoreZip(entries.filter((entry) => !entry.name.endsWith("/AODconfig.txt"))));
  await fs.writeFile(imagePath, solidPng(64, 64, 180));
  const rasterFolderPath = path.join(temporaryRoot, "custom-digits");
  await fs.mkdir(rasterFolderPath);
  for (let digit = 0; digit < 10; digit++) await fs.writeFile(path.join(rasterFolderPath, `0${digit}.png`), solidPng(40, 65, 50 + digit * 20));
  let window;
  let client;
  let vite;
  const automation = registerWatchfaceAutomation(() => window);
  const portReservation = require("node:net").createServer();
  await new Promise((resolve) => portReservation.listen(0, "127.0.0.1", resolve));
  const testPort = portReservation.address().port;
  await new Promise((resolve) => portReservation.close(resolve));
  const rendererErrors = [];
  let stage = "starting renderer";
  const watchdog = setTimeout(() => { console.error(`E2E stalled at: ${stage}`, rendererErrors); app.exit(1); }, 180_000);
  try {
    vite = await createServer({ root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false }, logLevel: "error" });
    await vite.listen();
    const address = vite.httpServer.address();
    window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(repoRoot, "dist-electron/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false } });
    window.webContents.on("console-message", (event) => { if (event.level === "error" && !event.message.includes("Content Security Policy")) rendererErrors.push(event.message); });
    await window.loadURL(`http://127.0.0.1:${address.port}/scripts/fixtures/watchface-automation.html`);
    stage = "enabling connection settings";
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".wf-automation-heading button:not(:disabled)"))'), Boolean, "connection settings");
    await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('.wf-automation-advanced input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${testPort}'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await window.webContents.executeJavaScript('document.querySelector(".wf-automation-heading button").click()');
    const status = await until(() => window.webContents.executeJavaScript("window.corosLink.getWatchfaceAutomationStatus()"), (value) => value.enabled, "enabled MCP server");
    assert.match(status.url, /^http:\/\/127\.0\.0\.1:/);
    window.showInactive();
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(temporaryRoot, "automation-settings.png"), (await window.webContents.capturePage()).toPNG());
    window.hide();
    stage = "connecting SDK client";
    client = new Client({ name: "coroslink-e2e", version: "1.0.0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(status.url), { requestInit: { headers: { Authorization: `Bearer ${status.token}` } } }));
    const rawTool = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 150_000 });
    const tool = async (name, args = {}) => {
      stage = name;
      if (name !== "get_document") console.log(`E2E: ${name}`);
      const response = await rawTool(name, args);
      const value = JSON.parse(response.content.find((part) => part.type === "text").text);
      assert.ok(!response.isError, `${name}: ${JSON.stringify(value)}`);
      return value;
    };
    await window.webContents.executeJavaScript(`window.addEventListener('unhandledrejection', event => console.error('Unhandled:', String(event.reason))); void 0;`);
    assert.equal((await tool("get_context")).editorOpen, false);
    const schema = await tool("get_schema");
    assert.ok(schema);
    const imported = await tool("import_archive", { path: fixture });
    const sourceArchive = imported.archive ?? imported;
    await tool("open", { archive: sourceArchive.archiveId, name: "Automation E2E", firmwareType: "COROS W332", watchModel: "pace-pro" });
    let document = await tool("get_document");
    const editorElement = await window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-editor"))');
    assert.equal(editorElement, true, "opening through MCP mounts the real editor");
    const image = await tool("import_asset", { path: imagePath });
    const rasterFolder = await tool("import_asset", { path: rasterFolderPath, kind: "raster_font_folder" });
    const changes = [
      { op: "import_raster_font", folder: rasterFolder, target: { kind: "time", id: "hours" }, tint: false },
      { op: "set", path: "/design/backgroundColor", value: "#0b1622" },
      { op: "set", path: "/design/artworkVisible", value: false },
      { op: "add_element", element: { id: "label", kind: "text", x: 400, y: 570, rotation: 0, text: "TRAIL", fontFamily: "Arial", fontSize: 44, color: "#ffb15d", weight: 700, align: "center" } },
      { op: "add_element", element: { id: "accent", kind: "rect", x: 280, y: 630, rotation: 0, width: 240, height: 8, cornerRadius: 4, fill: "#ffb15d" } },
      { op: "add_sprite", sprite: { id: "art", name: "Generated artwork", dataUrl: { assetId: image.assetId }, sourceWidth: 64, sourceHeight: 64, width: 64, height: 64, x: 360, y: 130, scale: 1, rotation: 0 } },
      { op: "update_element", id: "label", patch: { fontSize: 48, align: "left" } },
      { op: "place_layers", layerIds: ["bgel:label"], x: 400, y: 570 },
      { op: "align_layers", layerIds: ["bgel:accent"], alignment: "center-x", reference: { layerId: "bgel:label" } },
      { op: "place_layers", layerIds: ["sprite:art"], x: 400 },
      { op: "move_layer", id: "hours", dx: 8, dy: 6 }
    ];
    const identity = () => ({ sessionId: document.sessionId, baseRevision: document.revision });
    await tool("apply_commands", { ...identity(), commands: changes });
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.find((item) => item.id === "label").text, "TRAIL");
    assert.equal(document.design.designSprites.find((item) => item.id === "art").dataUrl.assetId, image.assetId);
    const placementBounds = (id) => document.capabilities.layers.find((layer) => layer.id === id).placement.bounds;
    assert.equal(document.capabilities.placement.width, 800);
    assert.equal(document.capabilities.placement.height, 800);
    const textBounds = placementBounds("bgel:label");
    assert.ok(Math.abs((textBounds.x0 + textBounds.x1) / 2 - 400) < 1e-6, "text is centered using fresh glyph metrics after resize");
    assert.ok(Math.abs((textBounds.y0 + textBounds.y1) / 2 - 570) < 1e-6, "middle baseline is corrected to ink center");
    assert.equal((placementBounds("bgel:accent").x0 + placementBounds("bgel:accent").x1) / 2, 400);
    assert.equal(document.design.designSprites[0].x, 400);
    assert.deepEqual(document.design.layoutOffsets.hours, { dx: 8, dy: 6 });
    const afterBatchRevision = document.revision;
    const invalid = await rawTool("apply_commands", { ...identity(), commands: [{ op: "set", path: "/design/backgroundColor", value: "#ff0000" }, { op: "set", path: "/design/nonexistentProperty", value: true }] });
    assert.equal(invalid.isError, true);
    document = await tool("get_document");
    assert.equal(document.revision, afterBatchRevision, "failed batches do not enter history");
    assert.equal(document.design.backgroundColor, "#0b1622", "failed batch leaves earlier operations unapplied");
    await tool("undo", identity());
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements?.length ?? 0, 0, "one undo removes the whole agent batch");
    await tool("redo", identity());
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.length, 2);
    // Exercise geometric spacing through the real external protocol, then undo
    // the temporary probes so the exported face remains the authored scene.
    await tool("apply_commands", { ...identity(), commands: [
      ...[40, 80, 20].map((width, i) => ({ op: "add_element", element: { id: `probe-${i}`, kind: "rect", x: 100 + i * 170, y: 180, width, height: 20, rotation: 0, cornerRadius: 0, fill: "#ffffff" } })),
      { op: "distribute_layers", layerIds: ["bgel:probe-0", "bgel:probe-1", "bgel:probe-2"], direction: "horizontal", gap: 24 },
      { op: "set", path: "/design/staticSeparators/colon", value: { enabled: true, x: 220, y: 330, size: 62, fontFamily: "Arial", color: "#00ff00" } },
      { op: "place_layers", layerIds: ["staticColon"], x: 400, y: 350 }

    ] });
    document = await tool("get_document");
    assert.equal(placementBounds("bgel:probe-1").x0 - placementBounds("bgel:probe-0").x1, 24);
    assert.equal(placementBounds("bgel:probe-2").x0 - placementBounds("bgel:probe-1").x1, 24);
    const colonBounds = placementBounds("staticColon");
    assert.ok(Math.abs((colonBounds.x0 + colonBounds.x1) / 2 - 400) < 1e-6);
    assert.ok(Math.abs((colonBounds.y0 + colonBounds.y1) / 2 - 350) < 1e-6);
    const colonPreview = await rawTool("render_preview", { sessionId: document.sessionId, mode: "current", resolution: 416 });
    assert.ok(!colonPreview.isError);
    const colonPng = colonPreview.content.find((part) => part.type === "image");
    await fs.writeFile(path.join(temporaryRoot, "separator-preview.png"), Buffer.from(colonPng.data, "base64"));
    const colonBitmap = nativeImage.createFromBuffer(Buffer.from(colonPng.data, "base64")).toBitmap();
    let colonX0 = Infinity, colonX1 = -Infinity, colonY0 = Infinity, colonY1 = -Infinity;
    for (let y = 0; y < 416; y++) for (let x = 0; x < 416; x++) {
      const i = (y * 416 + x) * 4;
      // Bitmap pixels retain the PNG color profile; identify green by channel
      // dominance so Display P3 and sRGB produce the same geometry assertion.
      if (colonBitmap[i + 1] > 160 && colonBitmap[i + 1] > colonBitmap[i] + 50 && colonBitmap[i + 1] > colonBitmap[i + 2] + 50) {
        colonX0 = Math.min(colonX0, x); colonX1 = Math.max(colonX1, x + 1);
        colonY0 = Math.min(colonY0, y); colonY1 = Math.max(colonY1, y + 1);
      }
    }
    assert.ok(Number.isFinite(colonX0), "custom separator paints in the rendered preview");
    assert.ok(Math.abs((colonX0 + colonX1) / 2 - 208) <= 1, "custom separator ink is horizontally centered");
    assert.ok(Math.abs((colonY0 + colonY1) / 2 - 182) <= 1, "custom separator ink is vertically centered");
    const beforeRejectedPlacement = document.revision;
    const rejectedPlacement = await rawTool("apply_commands", { ...identity(), commands: [
      { op: "set", path: "/projectName", value: "Must roll back" },
      { op: "place_layers", layerIds: ["bgel:probe-0"], x: -100, anchor: "left" }
    ] });
    assert.ok(rejectedPlacement.isError, "off-face placement is rejected");
    document = await tool("get_document");
    assert.equal(document.revision, beforeRejectedPlacement);
    assert.equal(document.project.name, "Automation E2E");
    await tool("undo", identity());
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.length, 2);
    const selected = await tool("select", { sessionId: document.sessionId, id: "bgel:label" });
    assert.equal(selected.view.selectedId, "bgel:label");
    await tool("set_view", { sessionId: document.sessionId, mode: "aod" });
    const changedResolution = await tool("set_view", { sessionId: document.sessionId, resolution: "watchface_416x416" });
    assert.equal(changedResolution.view.mode, "aod", "changing resolution preserves the current view mode");
    const activePreview = await tool("render_preview", { sessionId: document.sessionId, resolution: "watchface_416x416" });
    assert.equal(activePreview.mode, "aod");
    await tool("set_view", { sessionId: document.sessionId, mode: "current" });
    assert.ok(document.revision > afterBatchRevision, "undo/redo cannot reuse a stale revision");

    const stale = identity();
    await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('.watchface-editor-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Human and AI'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    document = await until(() => tool("get_document"), (value) => value.project.name === "Human and AI", "manual edit in the shared document");
    assert.ok((await rawTool("apply_commands", { ...stale, commands: [{ op: "set", path: "/design/backgroundColor", value: "#000000" }] })).isError, "manual changes invalidate stale agent commands");
    assert.ok((await rawTool("open", { archive: sourceArchive.archiveId, name: "Replacement" })).isError, "opening another face protects unsaved edits");

    const previewA = await rawTool("render_preview", { sessionId: document.sessionId, mode: "current", resolution: 416, scenario: { dateTime: "2026-09-12T10:28:00", values: { battery: "82" } } });
    assert.ok(!previewA.isError, JSON.stringify(previewA));
    const pngA = previewA.content.find((part) => part.type === "image");
    assert.ok(pngA, "MCP renders an image the AI can inspect");
    const previewB = await rawTool("render_preview", { sessionId: document.sessionId, mode: "current", resolution: 416, scenario: { dateTime: "2026-09-12T22:59:00", values: { battery: "9" } } });
    const pngB = previewB.content.find((part) => part.type === "image");
    assert.ok(pngB);
    assert.notEqual(crypto.createHash("sha256").update(pngA.data).digest("hex"), crypto.createHash("sha256").update(pngB.data).digest("hex"), "time/data scenarios change real preview pixels");
    await fs.writeFile(path.join(temporaryRoot, "face-preview.png"), Buffer.from(pngA.data, "base64"));
    const renderedTextBounds = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${pngA.data}`)}; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let y = 275; y < 316; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i] > 220 && pixels[i + 1] > 120 && pixels[i + 1] < 210 && pixels[i + 2] < 130) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
        }
      }
      return { x0, x1, y0, y1 };
    })()`);
    assert.ok(Number.isFinite(renderedTextBounds.x0), "the positioned text is present in real preview pixels");
    assert.ok(Math.abs((renderedTextBounds.x0 + renderedTextBounds.x1) / 2 - 208) <= 1, "rendered text is centered on the 416px face");
    assert.ok(Math.abs((renderedTextBounds.y0 + renderedTextBounds.y1) / 2 - 570 * 416 / 800) <= 1, "rendered ink matches the requested vertical center");
    await tool("apply_commands", { ...identity(), mode: "aod", commands: [{ op: "set", path: "/design/backgroundColor", value: "#000000" }] });
    document = await tool("get_document");
    assert.equal(document.design.backgroundColor, "#0b1622");
    assert.equal(document.design.modeDesigns.aod.backgroundColor, "#000000");
    const aod = await rawTool("render_preview", { sessionId: document.sessionId, mode: "aod", resolution: 416 });
    assert.ok(!aod.isError && aod.content.some((part) => part.type === "image"));
    assert.equal((await tool("validate", { sessionId: document.sessionId })).valid, true);
    const saved = await tool("save", identity());
    const project = saved.project;
    assert.ok(project.projectId);
    document = await tool("get_document");
    assert.equal(document.dirty, false);
    const exportPath = path.join(temporaryRoot, "editable.zip");
    await tool("export_project", { sessionId: document.sessionId, destinationPath: exportPath });
    const exported = await service.readCorosWatchfaceProjectPackage(exportPath);
    assert.equal(exported.manifest.design.backgroundElements.length, 2);
    assert.equal(exported.manifest.design.designSprites.length, 1);
    assert.ok(exported.manifest.design.timeStyles.hours.rasterFont.sprites, "imported digit font remains editable");
    assert.ok(exported.manifest.design.modeDesigns.aod);
    stage = "compiled export preview";
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-button").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".wf-export-popover"))'), Boolean, "export menu");
    await window.webContents.executeJavaScript('Array.from(document.querySelectorAll(".wf-export-popover button")).find(button => button.textContent.includes("Preview export")).click()');
    await until(() => window.webContents.executeJavaScript('document.querySelector(".wf-export-pixel-scroll img")?.naturalWidth'), (width) => width === 416, "compiled 416 pixel preview");
    const compiledSize = await window.webContents.executeJavaScript(`(() => {
      const image = document.querySelector('.wf-export-pixel-scroll img');
      return { width: image.width, height: image.height, cssWidth: image.getBoundingClientRect().width, cssHeight: image.getBoundingClientRect().height };
    })()`);
    assert.deepEqual(compiledSize, { width: 416, height: 416, cssWidth: 416, cssHeight: 416 }, "100% preview must not stretch or shrink exported pixels");
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const dialog = document.getElementById('wf-compiled-preview').getBoundingClientRect();
      const actions = document.querySelector('#wf-compiled-preview .wf-modal-actions').getBoundingClientRect();
      return actions.bottom <= dialog.bottom && actions.top >= dialog.top;
    })()`), "preview actions must remain visible inside a short viewport");
    window.showInactive();
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(temporaryRoot, "compiled-export-preview.png"), (await window.webContents.capturePage()).toPNG());
    window.hide();
    await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("#wf-compiled-preview button")).find(button => button.textContent === "Close").click()');
    document = await tool("get_document");
    assert.equal(document.dirty, false, "building a preview must not edit the saved design");
    const archiveResult = await tool("build_archive", identity());
    const archive = archiveResult.archive ?? archiveResult;
    const installablePath = path.join(temporaryRoot, "watch.zip");
    await tool("export_archive", { archiveId: archive.archiveId, destinationPath: installablePath });
    assert.ok((await fs.stat(installablePath)).size > 0);
    assert.ok((await rawTool("export_project", { sessionId: document.sessionId, destinationPath: exportPath })).isError, "exports do not silently overwrite files");
    // Hiding preserves editable layers and survives save, reopen and both exports.
    await tool("apply_commands", { ...identity(), commands: [
      { op: "group", id: "decoration", name: "Decoration", layerIds: ["bgel:label", "sprite:art"] },
      { op: "set_visibility", id: "group:decoration", visible: false },
      { op: "set_visibility", id: "hours", visible: false }
    ] });
    document = await tool("get_document");
    const assertHiddenLayers = () => {
      for (const id of ["bgel:label", "sprite:art", "hours"]) {
        const layer = document.capabilities.layers.find((layer) => layer.id === id);
        assert.equal(layer?.visible, false, `${id} is hidden and remains addressable`);
        assert.equal(layer?.locked, false, "hidden does not mean locked");
      }
      assert.equal(document.design.backgroundElements.length, 2);
      assert.equal(document.design.designSprites.length, 1);
    };
    assertHiddenLayers();
    await tool("undo", identity());
    document = await tool("get_document");
    assert.equal(document.capabilities.layers.find((layer) => layer.id === "hours").visible, true);
    await tool("redo", identity());
    document = await tool("get_document");
    assertHiddenLayers();
    const hiddenPreview = await rawTool("render_preview", { sessionId: document.sessionId, mode: "current", resolution: 416 });
    assert.ok(!hiddenPreview.isError);
    const hiddenPng = hiddenPreview.content.find((part) => part.type === "image");
    await fs.writeFile(path.join(temporaryRoot, "hidden-preview.png"), Buffer.from(hiddenPng.data, "base64"));
    const hiddenPixels = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(`data:image/png;base64,${hiddenPng.data}`)}; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 416; canvas.height = 416;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 416, 416).data;
      let labelPixels = 0, artworkPixels = 0;
      for (let y = 275; y < 316; y++) for (let x = 0; x < 416; x++) {
        const i = (y * 416 + x) * 4;
        if (pixels[i] > 220 && pixels[i + 1] > 120 && pixels[i + 1] < 210 && pixels[i + 2] < 130) labelPixels++;
      }
      for (let y = 52; y < 84; y++) for (let x = 192; x < 224; x++) {
        const i = (y * 416 + x) * 4;
        if (pixels[i] > 100 && pixels[i + 1] > 100 && pixels[i + 2] > 100) artworkPixels++;
      }
      return { labelPixels, artworkPixels };
    })()`);
    assert.deepEqual(hiddenPixels, { labelPixels: 0, artworkPixels: 0 }, "hidden text and artwork disappear from actual preview pixels");
    await tool("save", identity());
    document = await tool("get_document");
    await tool("open", { project: project.projectId });
    document = await tool("get_document");
    assertHiddenLayers();
    const hiddenExportPath = path.join(temporaryRoot, "hidden-editable.zip");
    await tool("export_project", { sessionId: document.sessionId, destinationPath: hiddenExportPath });
    const hiddenPackage = await service.readCorosWatchfaceProjectPackage(hiddenExportPath);
    assert.equal(hiddenPackage.manifest.design.designSprites[0].visible, false);
    assert.equal(hiddenPackage.manifest.design.backgroundElements.find((item) => item.id === "label").visible, false);
    assert.equal(hiddenPackage.manifest.design.layerVisibility.hours, false);
    const hiddenArchiveResult = await tool("build_archive", identity());
    const hiddenArchive = hiddenArchiveResult.archive ?? hiddenArchiveResult;
    const hiddenDetails = await service.describeCorosWatchfaceTemplate(hiddenArchive.archiveId);
    assert.ok(hiddenDetails.resolutions.every((resolution) => !resolution.config.time_hour_high_pos && !resolution.config.time_hour_low_pos), "hidden native hours are removed from every exported resolution");
    await tool("apply_commands", { ...identity(), commands: [
      { op: "set_visibility", id: "group:decoration", visible: true },
      { op: "set_visibility", id: "hours", visible: true }
    ] });
    document = await tool("get_document");
    for (const id of ["bgel:label", "sprite:art", "hours"]) assert.equal(document.capabilities.layers.find((layer) => layer.id === id)?.visible, true);
    await tool("save", identity());
    document = await tool("get_document");
    const duplicateResult = await tool("duplicate_project", { projectId: project.projectId });
    const duplicate = duplicateResult.project ?? duplicateResult;
    await tool("delete_project", { projectId: duplicate.projectId, confirmed: true });
    await tool("open", { project: project.projectId });
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.find((item) => item.id === "label").text, "TRAIL");
    await until(() => window.webContents.executeJavaScript(`(() => {
      return [...document.querySelectorAll('.watchface-editor canvas')].some(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i + 1] > 100 && pixels[i + 1] < 220 && pixels[i + 2] < 130 && pixels[i + 3] > 200) return true;
        return false;
      });
    })()`), Boolean, "restored artwork to paint in the visible editor");
    window.showInactive();
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const screenshot = await window.webContents.capturePage();
    window.hide();
    await fs.writeFile(path.join(temporaryRoot, "editor.png"), screenshot.toPNG());
    assert.deepEqual(rendererErrors, [], "renderer must complete without console errors");
    const activeDelete = await rawTool("delete_project", { projectId: project.projectId, confirmed: true });
    assert.ok(activeDelete.isError);
    assert.equal(JSON.parse(activeDelete.content[0].text).error.code, "ACTIVE_PROJECT");
    await tool("close", identity());
    assert.equal((await tool("get_context")).editorOpen, false);
    const reimported = await tool("import_archive", { path: exportPath });
    await tool("open", { archive: reimported.archiveId });
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.find(item => item.id === "label").text, "TRAIL", "portable editable package reimports its scene");
    await tool("apply_commands", { ...identity(), commands: [{ op: "set", path: "/projectName", value: "Imported edit" }] });
    document = await tool("get_document");
    assert.ok((await rawTool("close", identity())).isError, "close protects unsaved edits");
    await tool("close", { ...identity(), saveChanges: true });
    const listed = await tool("list_projects");
    const importedProject = listed.find(item => item.name === "Imported edit");
    assert.ok(importedProject, "close with save persists the document");
    await tool("open", { project: importedProject.projectId });
    document = await tool("get_document");
    const previousSession = document.sessionId;
    await tool("convert", { ...identity(), targetArchive: sourceArchive.archiveId, firmwareType: "COROS W336", watchModel: "pace-4" });
    document = await tool("get_document");
    assert.notEqual(document.sessionId, previousSession);
    assert.equal(document.target.watchModel, "pace-4");
    assert.equal(document.design.backgroundElements.find(item => item.id === "label").text, "TRAIL");
    await tool("close", { ...identity(), discardChanges: true });
    const currentOnly = await tool("import_archive", { path: currentOnlyFixture });
    await tool("open", { archive: currentOnly.archiveId });
    document = await tool("get_document");
    assert.equal(document.capabilities.aod, false);
    const currentOnlyRevision = document.revision;
    const unavailableMode = await rawTool("apply_commands", { ...identity(), mode: "aod", commands: [{ op: "place_layers", layerIds: ["hours"], x: 400 }] });
    assert.ok(unavailableMode.isError);
    assert.equal(JSON.parse(unavailableMode.content[0].text).error.code, "UNSUPPORTED_MODE");
    const unavailableOverride = await rawTool("apply_commands", { ...identity(), commands: [{ op: "set_mode_overrides", mode: "aod", overrides: {}, copyFrom: "current" }] });
    assert.ok(unavailableOverride.isError);
    document = await tool("get_document");
    assert.equal(document.revision, currentOnlyRevision);
    await tool("close", { ...identity(), discardChanges: true });
    await window.webContents.executeJavaScript("window.corosLink.configureWatchfaceAutomation({ enabled: false })");
    assert.equal((await window.webContents.executeJavaScript("window.corosLink.getWatchfaceAutomationStatus()")).enabled, false);
    await assert.rejects(fetch(status.url), "disabled endpoint stops accepting connections");
    await client.close();
    const restarted = await window.webContents.executeJavaScript(`window.corosLink.configureWatchfaceAutomation({ enabled: true, port: ${testPort} })`);
    assert.notEqual(restarted.token, status.token, "disable revokes the old token");
    const revoked = await fetch(restarted.url, { headers: { Authorization: `Bearer ${status.token}` } });
    assert.equal(revoked.status, 401);
    client = new Client({ name: "coroslink-e2e-reconnected", version: "1.0.0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(restarted.url), { requestInit: { headers: { Authorization: `Bearer ${restarted.token}` } } }));
    assert.equal((await tool("get_context")).editorOpen, false, "re-enable retains live hub readiness");
    await window.webContents.executeJavaScript("window.corosLink.configureWatchfaceAutomation({ enabled: false })");
    console.log(`Watch-face automation E2E passed: external MCP → preload/IPC → live editor → preview → save → editable ZIP → watch ZIP. Artifacts: ${temporaryRoot}`);
  } catch (error) {
    console.error(`E2E failed at ${stage}:`, error, rendererErrors);
    throw error;
  } finally {
    await client?.close().catch(() => undefined);
    await automation.stop();
    window?.destroy();
    await vite?.close();
    clearTimeout(watchdog);
  }
}

main().then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });
