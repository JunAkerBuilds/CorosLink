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
  let authenticated = false;
  let conversionAuthError = null;
  let manualLoginAttempts = 0;
  let savedLoginAttempts = 0;
  let restoreCarrierAfterLogin = async () => {};
  const accountStatus = () => ({ authenticated, secureStorageAvailable: true, savedCredentialsAvailable: true, savedEmail: "saved@example.test", suggestedRegion: "us" });

  // These are the production preload/service IPC contracts used by the real
  // editor. The automation endpoint and broker are registered unchanged.
  const handlers = {
    // Keep account/keychain access outside this offline editing test.
    "watchfaces:getStatus": accountStatus,
    "watchfaces:listThemes": () => [],
    "watchfaces:login": async (_, email, password, region, remember) => {
      assert.equal(email, "conversion@example.test");
      assert.equal(password, "test-password");
      assert.equal(region, "eu");
      assert.equal(remember, true);
      manualLoginAttempts++;
      if (manualLoginAttempts === 1) throw new Error("The email or password is incorrect.");
      await restoreCarrierAfterLogin();
      authenticated = true;
      return accountStatus();
    },
    "watchfaces:loginSaved": (_, region) => {
      assert.equal(region, "eu");
      savedLoginAttempts++;
      conversionAuthError = null;
      authenticated = true;
      return accountStatus();
    },
    "watchfaces:listProjects": () => service.listCorosWatchfaceProjects(),
    "watchfaces:saveProject": (_, input) => service.saveCorosWatchfaceProject(input),
    "watchfaces:loadProject": (_, id) => service.loadCorosWatchfaceProject(id),
    "watchfaces:describeTemplate": (_, id) => service.describeCorosWatchfaceTemplate(id),
    "watchfaces:loadTemplateAssets": (_, id, paths) => service.loadCorosWatchfaceTemplateAssets(id, paths),
    "watchfaces:loadTemplateConfigTexts": (_, id) => service.loadCorosWatchfaceTemplateConfigTexts(id),
    "watchfaces:convertArchive": (_, input) => {
      if (conversionAuthError) throw new Error(conversionAuthError);
      return service.convertCorosWatchfaceArchive(input);
    },
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
  const carrierCache = path.join(app.getPath("userData"), "watchface-conversion-carriers");
  await fs.mkdir(carrierCache, { recursive: true });
  await fs.writeFile(path.join(carrierCache, "pace-4.zip"), createStoreZip(entries.map(entry => ({ ...entry, name: entry.name.replace("416x416", "390x390") }))));
  await fs.writeFile(path.join(carrierCache, "pace-pro.zip"), createStoreZip(entries));
  const mipCarrier = [...entries.filter(entry => !entry.name.startsWith("watchface_416x416/") && !entry.name.endsWith("/AODconfig.txt"))];
  for (const size of [240, 260, 280]) mipCarrier.push(...entries.filter(entry => entry.name.startsWith("watchface_416x416/") && !entry.name.endsWith("/AODconfig.txt")).map(entry => ({ ...entry, name: entry.name.replace("416x416", `${size}x${size}`) })));
  await fs.writeFile(path.join(carrierCache, "pace-3.zip"), createStoreZip(mipCarrier));
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
    assert.equal(schema.nativeData.fields.length,27);
    assert.equal(schema.nativeData.chartSources.length,12);
    assert.equal(schema.document.$defs.nativeDataStyle.properties.assets.properties.icon.additionalProperties.$ref,'#/$defs/pngImageValue');
    assert.equal(schema.document.$defs.weatherIndicator.properties.assets.properties.day.additionalProperties.$ref,'#/$defs/pngImageValue');
    const nativeDefaults=id=>schema.nativeData.fields.find(field=>field.id===id).defaults;
    assert.deepEqual(schema.nativeData.chartSources.find(source=>source.id==='chart_moon').components.find(part=>part.id==='states').stateIndices,Array.from({length:30},(_,i)=>String(i)));
    const imported = await tool("import_archive", { path: fixture });
    const sourceArchive = imported.archive ?? imported;
    await tool("open", { archive: sourceArchive.archiveId, name: "Automation E2E", firmwareType: "COROS W332", watchModel: "pace-pro" });
    let document = await tool("get_document");
    const editorElement = await window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-editor"))');
    assert.equal(editorElement, true, "opening through MCP mounts the real editor");
    // Simulation is view state: exercise its visible controls and MCP parity.
    const beforeSimulation = structuredClone(document);
    assert.equal(schema.simulation.editorOnly, true);
    await tool("select", {sessionId:document.sessionId, id:"hours"});
    await window.webContents.executeJavaScript("document.querySelector('.wf-placement-trigger').click()");
    const guidesWereVisible = await window.webContents.executeJavaScript(`(() => {
      const input=[...document.querySelectorAll('.wf-placement-popover label')].find(label=>label.textContent.includes('Show center and safe-area guides')).querySelector('input');
      const checked=input.checked;if(!checked)input.click();return checked;
    })()`);
    await window.webContents.executeJavaScript("document.querySelector('.wf-placement-trigger').click()");
    await window.webContents.executeJavaScript("document.querySelector('.wf-simulation-trigger').click()");
    await until(() => window.webContents.executeJavaScript("Boolean(document.querySelector('.wf-simulation-panel'))"), Boolean, "simulation panel");
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const panel=document.querySelector('.wf-simulation-panel').getBoundingClientRect();
      const stage=document.querySelector('.wf-stage').getBoundingClientRect();
      const placement=document.querySelector('.wf-placement-trigger').getBoundingClientRect();
      return panel.left>=stage.left && panel.right<=stage.right && placement.right<=stage.right && panel.bottom<=stage.bottom;
    })()`), "Simulation panel and Placement remain inside the stage when the toolbar wraps");
    await window.webContents.executeJavaScript("document.querySelector('.wf-simulation-enable input').click()");
    document = await tool("get_document");
    assert.equal(document.view.simulation.enabled, true);
    const setSimulationInput = async (label, value, select = false) => window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[aria-label="${label}"]');
      Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('${select ? 'change' : 'input'}', {bubbles:true}));
    })()`);
    await setSimulationInput("Simulation date", "2028-02-28");
    await setSimulationInput("Simulation time", "23:59:59");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.wf-simulation-panel button')].find(button => button.textContent === '+1 second').click()");
    document = await tool("get_document");
    assert.equal(document.view.simulation.dateTime, "2028-02-29T00:00:00", "Visible date/time controls roll into leap day");
    await setSimulationInput("Simulated battery (%)", "0");
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Simulated battery (%)"]').dispatchEvent(new FocusEvent('focusout', {bubbles:true}))`);
    document = await tool("get_document");
    assert.equal(document.view.simulation.values.battery, "0");
    const simulatedEmpty = await rawTool("render_preview", {sessionId: document.sessionId});
    await setSimulationInput("Simulation preset", "fullBattery", true);
    document = await tool("get_document");
    assert.equal(document.view.simulation.values.battery, "100");
    const simulatedFull = await rawTool("render_preview", {sessionId: document.sessionId});
    assert.notEqual(simulatedEmpty.content.find(part=>part.type==='image').data, simulatedFull.content.find(part=>part.type==='image').data, "Battery simulation changes the real preview");
    const explicitEmpty = await rawTool("render_preview", {sessionId: document.sessionId, scenario: {dateTime: document.view.simulation.dateTime, values:{battery:"0"}}});
    assert.equal(simulatedEmpty.content.find(part=>part.type==='image').data, explicitEmpty.content.find(part=>part.type==='image').data, "Explicit MCP scenarios override active simulation");
    await window.webContents.executeJavaScript("document.querySelector('.wf-simulation-panel details').open = true");
    for (const [label, value] of [["Simulated sensor temperature", "32"], ["Simulated current weather", "-8"]]) {
      await setSimulationInput(label, value);
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout', {bubbles:true}))`);
    }
    document = await tool("get_document");
    assert.equal(document.view.simulation.values.temperature, "32", "Weather input must not overwrite sensor temperature");
    assert.equal(document.view.simulation.values.weather_temp, "-8", "Weather temperature has its own simulation value");
    await setSimulationInput("Simulated sensor temperature", "30");
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Simulated sensor temperature"]').dispatchEvent(new FocusEvent('focusout', {bubbles:true}))`);
    document = await tool("get_document");
    assert.equal(document.view.simulation.values.weather_temp, "-8", "Sensor input must not overwrite weather temperature");
    await window.webContents.executeJavaScript("document.querySelector('.wf-simulation-panel details').open = false");
    await tool("set_view", {sessionId: document.sessionId, simulation:{enabled:true, playing:true, speed:1, dateTime:"2026-12-31T23:59:59"}});
    document = await until(() => tool("get_document"), value => value.view.simulation.dateTime.startsWith("2027-01-01"), "playback across new year");
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.wf-simulation-panel button')].find(button => button.textContent === 'Pause').click()");
    document = await tool("get_document");
    const pausedTime = document.view.simulation.dateTime;
    await window.webContents.executeJavaScript("new Promise(resolve=>setTimeout(resolve,1200))");
    document = await tool("get_document");
    assert.equal(document.view.simulation.dateTime, pausedTime, "Pause stops playback");
    assert.equal(document.revision, beforeSimulation.revision);
    assert.equal(document.dirty, beforeSimulation.dirty);
    assert.equal(document.canUndo, beforeSimulation.canUndo);
    assert.deepEqual(document.design, beforeSimulation.design, "Simulation never modifies the saved design");
    const invalidSimulation = await rawTool("set_view", {sessionId:document.sessionId, simulation:{dateTime:"2027-02-29T12:00:00"}});
    assert.ok(invalidSimulation.isError, "Invalid calendar dates are rejected through MCP");
    window.showInactive();
    await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const panelCaptureRect = await window.webContents.executeJavaScript(`(() => {
      const panel=document.querySelector('.wf-simulation-panel').getBoundingClientRect();
      // Exclude rounded corners/shadow; the interior must fully cover the canvas.
      return {x:Math.ceil(panel.x+16),y:Math.ceil(panel.y+16),width:Math.floor(panel.width-32),height:Math.floor(panel.height-32)};
    })()`);
    const withSelection = await window.webContents.capturePage(panelCaptureRect);
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const bar=document.querySelector('.wf-contextual-align-bar');
      const toolbar=document.querySelector('.wf-stage-toolbar');
      return !!bar && !!document.querySelector('.wf-stage-ruler') && Number(getComputedStyle(toolbar).zIndex)>Number(getComputedStyle(bar).zIndex) && bar.getBoundingClientRect().top>=toolbar.getBoundingClientRect().bottom;
    })()`), "Simulation toolbar sits above the active alignment toolbar");
    await window.webContents.executeJavaScript(`document.querySelectorAll('.watchface-preview-stack, .wf-contextual-align-bar').forEach(el=>el.style.visibility='hidden');new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const withoutSelection = await window.webContents.capturePage(panelCaptureRect);
    await fs.writeFile(path.join(temporaryRoot, "simulation-panel-with-guides.png"),withSelection.toPNG());
    await fs.writeFile(path.join(temporaryRoot, "simulation-panel-without-guides.png"),withoutSelection.toPNG());
    const beforePixels=withSelection.toBitmap(), afterPixels=withoutSelection.toBitmap();
    assert.equal(beforePixels.length, afterPixels.length);
    // GPU text antialiasing can shift a few channel levels when another layer hides.
    const maxDifference=beforePixels.reduce((max,value,index)=>Math.max(max,Math.abs(value-afterPixels[index])),0);
    assert.ok(maxDifference<=4, `Watch artwork, guides and selected outlines cannot paint through the simulation panel (max channel difference ${maxDifference})`);
    await window.webContents.executeJavaScript(`document.querySelectorAll('.watchface-preview-stack, .wf-contextual-align-bar').forEach(el=>el.style.removeProperty('visibility'));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(temporaryRoot, "simulation-panel.png"), (await window.webContents.capturePage()).toPNG());
    window.hide();
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.wf-simulation-panel button')].find(button => button.textContent === 'Reset simulation').click()");
    document = await tool("get_document");
    assert.equal(document.view.simulation.enabled, false);
    assert.equal(document.view.simulation.playing, false);
    assert.deepEqual(document.view.simulation.values, {});
    await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"Close simulation\"]').click()");
    await tool("select", {sessionId:document.sessionId, id:"background"});
    if (!guidesWereVisible) {
      await window.webContents.executeJavaScript("document.querySelector('.wf-placement-trigger').click()");
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('.wf-placement-popover label')].find(label=>label.textContent.includes('Show center and safe-area guides')).querySelector('input').click()`);
      await window.webContents.executeJavaScript("document.querySelector('.wf-placement-trigger').click()");
    }
    // Browse, search and dismiss the new Add picker before creating layers.
    await window.webContents.executeJavaScript("document.querySelector('.watchface-add-sprite').click()");
    await until(() => window.webContents.executeJavaScript(`document.querySelector('.wf-layer-picker').matches(':popover-open') && document.activeElement===document.querySelector('[aria-label="Search data fields"]')`), Boolean, "searchable Add picker");
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const r=document.querySelector('.wf-layer-picker').getBoundingClientRect();
      return r.left>=0&&r.right<=innerWidth&&r.top>=0&&Math.abs(r.bottom-(innerHeight-12))<=1;
    })()`), "All expands the Add picker to the available window height with a safe bottom margin");
    window.showInactive();
    await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(temporaryRoot, "add-menu.png"), (await window.webContents.capturePage()).toPNG());
    window.hide();
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.wf-layer-picker-filters button')].find(button=>button.textContent==='Charts').click()`);
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.wf-layer-picker-results [data-add-option]').length"),12,"Category filter shows every chart source");
    await until(() => window.webContents.executeJavaScript("document.querySelector('.wf-layer-picker').getBoundingClientRect().height<=581"), Boolean, "individual categories use a compact picker");
    await until(() => window.webContents.executeJavaScript(`(() => {
      const strip=document.querySelector('[role="tablist"][aria-label="Data categories"]');
      const selected=strip.querySelector('[role="tab"][aria-selected="true"]');
      const bounds=selected.getBoundingClientRect(), viewport=strip.getBoundingClientRect();
      return selected.textContent==='Charts' && bounds.left>=viewport.left-1 && bounds.right<=viewport.right+1 && document.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby')===selected.id;
    })()`), Boolean, "active chart tab scrolls into view");
    await window.webContents.executeJavaScript(`document.querySelector('[role="tab"][aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
    assert.equal(await window.webContents.executeJavaScript("document.activeElement.textContent"),"Astronomy","Arrow keys activate and focus adjacent tabs");
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.wf-layer-picker-results [data-add-option]').length"),2,"Astronomy lists sunrise/sunset progress and the chart solar angle");
    await window.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('[role=tab][aria-selected=true]').textContent"),"All");
    await until(() => window.webContents.executeJavaScript(`Math.abs(document.querySelector('.wf-layer-picker').getBoundingClientRect().bottom-(innerHeight-12))<=1`), Boolean, "returning to All expands the picker again");
    assert.equal(await window.webContents.executeJavaScript("document.activeElement.textContent"),"All","resizing the picker preserves keyboard focus on the selected tab");
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.wf-layer-picker-filters button')].find(button=>button.textContent==='All').click()`);
    await setSimulationInput("Search data fields", "sleep");
    assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('.wf-layer-picker-results [data-add-option]').length"),2);
    await setSimulationInput("Search data fields", "no-such-field");
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.wf-layer-picker-empty strong').textContent"),"No matching data fields");
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Search data fields"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.wf-layer-picker').matches(':popover-open')"),false);
    await window.webContents.executeJavaScript("document.querySelector('.watchface-add-sprite').click()");
    await window.webContents.executeJavaScript(`document.querySelector('.watchface-add-sprite').click()`);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.wf-layer-picker').matches(':popover-open')"),false,"Add button toggles the picker closed");
    // Exercise the visible Add menu, inspector and the native-data export path.
    const nativeIdentity = () => ({ sessionId: document.sessionId, baseRevision: document.revision });
    for (const value of ["weather_temp", "sleep_score", "week_tl", "sunriseset", "chart:chart_stress"]) {
      await window.webContents.executeJavaScript("document.querySelector('.watchface-add-sprite').click()");
      await until(() => window.webContents.executeJavaScript("Boolean(document.querySelector('.wf-layer-picker:popover-open'))"), Boolean, "native data menu");
      await window.webContents.executeJavaScript(`document.querySelector('[data-native-data="${value}"]').click()`);
      document = await tool("get_document");
      assert.equal(document.design.nativeData[value.split(":")[0]].enabled, true);
      assert.equal(document.view.selectedId, `native:${value.split(":")[0]}`);
    }
    const beforeExistingField = document.revision;
    await window.webContents.executeJavaScript("document.querySelector('.watchface-add-sprite').click()");
    await until(() => window.webContents.executeJavaScript("Boolean(document.querySelector('.wf-layer-picker:popover-open'))"), Boolean, "existing native fields");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-native-data="sleep_score"]').textContent.includes('On face')`), true);
    await setSimulationInput("Search data fields", "sleep score");
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Search data fields"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    document = await tool("get_document");
    assert.equal(document.revision,beforeExistingField,"Selecting an existing data field does not create an undo entry");
    assert.equal(document.view.selectedId,"native:sleep_score");
    await tool("apply_commands", { ...nativeIdentity(), commands: [
      {op:"place_layers",layerIds:["native:weather_temp"],x:180,y:500},
      {op:"set_visibility",id:"native:week_tl",visible:false}
    ] });
    document = await tool("get_document");
    assert.equal(document.design.nativeData.week_tl.enabled,false);
    assert.ok(document.capabilities.layers.find(layer=>layer.id==="native:weather_temp").placement.movable);
    await tool("undo",nativeIdentity());
    document = await tool("get_document");
    assert.equal(document.design.nativeData.week_tl.enabled,true);
    await tool("select",{sessionId:document.sessionId,id:"native:week_tl"});
    await until(()=>window.webContents.executeJavaScript(`Boolean(document.querySelector('input[aria-label="Label / symbol text"]'))`),Boolean,"native label editor");
    await window.webContents.executeJavaScript(`(() => { const input=document.querySelector('input[aria-label="Label / symbol text"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'LOAD'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    document=await tool("get_document");
    assert.equal(document.design.nativeData.week_tl.assetTexts.icon['0'],'LOAD','Typing replaces the generated TL label');
    const beforeColorDrag=document;
    const colorDragTiming=await window.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('input[aria-label="Default color"]');
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      const start=performance.now();
      for(let i=0;i<120;i++) { set.call(input,'#'+(0x102000+i).toString(16)); input.dispatchEvent(new Event('input',{bubbles:true})); }
      return performance.now()-start;
    })()`);
    document=await until(()=>tool('get_document'),value=>value.design.nativeData.week_tl.color==='#102077','settled color picker');
    console.log(`Color drag: 120 inputs, ${Math.round(colorDragTiming)} ms dispatch, ${document.revision-beforeColorDrag.revision} editor revisions`);
    assert.equal(document.revision-beforeColorDrag.revision,1,'A continuous color drag commits once instead of re-rendering the editor for every input');
    await tool('undo',nativeIdentity()); document=await tool('get_document');
    assert.equal(document.design.nativeData.week_tl.color,beforeColorDrag.design.nativeData.week_tl.color,'One undo restores the color before the drag');
    const setColorInput=(color,eventType='input')=>window.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('input[aria-label="Default color"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(color)});
      input.dispatchEvent(new Event(${JSON.stringify(eventType)},{bubbles:true}));
    })()`);
    await setColorInput('#abcdef');
    // Read after the timer, so this path verifies settling without an MCP flush.
    await window.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,220))');
    document=await tool('get_document');
    assert.equal(document.design.nativeData.week_tl.color,'#abcdef');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Default color"]').value`),'#abcdef');
    await setColorInput('#fedcba','change');
    document=await tool('get_document');
    const afterNativeChange=document.revision;
    assert.equal(document.design.nativeData.week_tl.color,'#fedcba','Native picker completion commits its final value');
    await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Default color"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true})); new Promise(resolve=>setTimeout(resolve,220))`);
    document=await tool('get_document');
    assert.equal(document.revision,afterNativeChange,'Blur and old timers do not create duplicate color commits');
    await tool('undo',nativeIdentity()); document=await tool('get_document');
    assert.equal(document.design.nativeData.week_tl.color,'#abcdef');
    await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Default color"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);
    document=await tool('get_document');
    assert.equal(document.design.nativeData.week_tl.color,'#abcdef','Blur after undo cannot restore a stale draft');
    await setColorInput('#112233');
    await tool('select',{sessionId:document.sessionId,id:'native:chart'});
    document=await tool('get_document');
    assert.equal(document.design.nativeData.week_tl.color,'#112233','Switching layers flushes the original color target');
    assert.equal(document.design.nativeData.chart.color,'#ffffff','Pending colors never leak onto a newly selected layer');
    await tool('select',{sessionId:document.sessionId,id:'native:week_tl'});
    await setColorInput('#445566');
    // A programmatic click has no pointerdown/blur; still flush before its action.
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Restore component defaults').click()`);
    document=await tool('get_document');
    assert.equal(document.design.nativeData.week_tl.color,'#445566','Other UI actions preserve a pending color');
    await tool('undo',nativeIdentity()); document=await tool('get_document');
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Restore component defaults').click()`);
    document=await tool("get_document");
    assert.equal(document.design.nativeData.week_tl.assetTexts?.icon,undefined,'Restoring a component removes its custom text');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Label / symbol text"]').value`),'TL');
    await tool("undo",nativeIdentity());
    document=await tool("get_document");
    assert.equal(document.design.nativeData.week_tl.assetTexts.icon['0'],'LOAD','Component reset is undoable');
    await tool("select",{sessionId:document.sessionId,id:"native:chart"});
    await window.webContents.executeJavaScript(`(() => { const select=document.querySelector('select[aria-label="Customize component"]'); select.value='plot'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(()=>window.webContents.executeJavaScript(`Boolean(document.querySelector('input[aria-label="Bar width"]'))`),Boolean,"graph controls");
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const type=document.querySelector('select[aria-label="Graph type"]');
      return !type.disabled && type.value==='bars' && [...type.options].map(option=>option.value).join()==='bars,curve';
    })()`),'Bar and line graphs are both offered in the inspector');
    await window.webContents.executeJavaScript(`(() => { const select=document.querySelector('select[aria-label="Graph type"]'); select.value='curve'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(()=>window.webContents.executeJavaScript(`Boolean(document.querySelector('input[aria-label="Line thickness"]') && document.querySelector('input[aria-label="Upper curve"]') && document.querySelector('input[aria-label="Lower curve"]'))`),Boolean,"line graph controls");
    document=await tool("get_document");
    assert.equal(document.design.nativeData.chart.chartStyle.previewType,'curve','Line graph preview is selectable');
    await window.webContents.executeJavaScript(`(() => { const select=document.querySelector('select[aria-label="Graph type"]'); select.value='bars'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(()=>window.webContents.executeJavaScript(`Boolean(document.querySelector('input[aria-label="Bar width"]'))`),Boolean,"bar graph controls");
    const graphToggleSize=await window.webContents.executeJavaScript(`(() => { const box=document.querySelector('input[aria-label="Show Graph"]').getBoundingClientRect(); return {width:box.width,height:box.height}; })()`);
    assert.ok(graphToggleSize.width<=20&&graphToggleSize.height<=20,'Graph visibility checkbox fits the inspector');
    await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Show Graph"]').click()`);
    document=await tool("get_document");
    assert.equal(document.design.nativeData.chart.parts.plot.enabled,false,'The graph can be hidden independently');
    await window.webContents.executeJavaScript(`document.querySelector('input[aria-label="Show Graph"]').click()`);
    await window.webContents.executeJavaScript(`(() => { const input=document.querySelector('input[aria-label="Bar width"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'6'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    document=await tool("get_document");
    assert.ok(document.design.nativeData.chart.chartStyle.barWidth>6,'Bar width converts displayed watch pixels to master pixels');
    const nativeOutput=await tool("build_archive",nativeIdentity());
    assert.equal((nativeOutput.archive??nativeOutput).watchFaceVersion,6);
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.writeFile('/tmp/coroslink-native-data-editor.png',(await window.webContents.capturePage()).toPNG());
    // Exercise the actual external MCP mutation path for all new controls.
    const nativeArtwork=await tool("import_asset",{path:imagePath});
    await tool("apply_commands",{...nativeIdentity(),commands:[
      {op:"set",path:"/design/nativeData/weather_humidity",value:{...nativeDefaults('weather_humidity'),x:60,y:80}},
      {op:"set",path:"/design/nativeData/today_run",value:{...nativeDefaults('today_run'),x:60,y:180}},
      {op:"set",path:"/design/nativeData/sleep_hrv_level",value:{...nativeDefaults('sleep_hrv_level'),x:60,y:280}},
      {op:"merge",path:"/design/nativeData/week_tl",value:{assetTexts:{icon:{'0':'MCP TL'}},assets:{icon:{'0':{assetId:nativeArtwork.assetId}}},parts:{icon:{width:90,height:48,color:'#ff0000'}}}},
      {op:"merge",path:"/design/nativeData/sunriseset",value:{assetTexts:{icon:{'0':'RISE','1':'SET'}},assets:{progress:{'0':{assetId:nativeArtwork.assetId}}}}},
      {op:"merge",path:"/design/nativeData/chart",value:{chartSource:'chart_stamina',parts:{plot:{enabled:true,width:300,height:100},mask:{enabled:true}},chartStyle:{lineWidth:7,upperColor:'#00ff00',lowerColor:'#ff00ff',selectedBarColor:'#ffff00',unselectedBarColor:'#0000ff',barWidth:12,barGap:6,previewType:'bars'},assets:{mask:{'0':{assetId:nativeArtwork.assetId}}}}},
      {op:"set",path:"/design/weatherIndicator",value:{enabled:true,x:500,y:100,scale:1,temperatureEnabled:true,assets:{day:{'0':{assetId:nativeArtwork.assetId}}}}}
    ]});
    document=await tool("get_document");
    const nativeEdited=document;
    assert.equal(document.design.nativeData.week_tl.assets.icon['0'].assetId,nativeArtwork.assetId,'Native artwork refs survive hydration and externalization');
    assert.equal(document.design.weatherIndicator.assets.day['0'].assetId,nativeArtwork.assetId);
    const graphParts=document.capabilities.layers.find(layer=>layer.id==='native:chart').nativeData.components;
    assert.equal(graphParts.find(part=>part.id==='plot').effectiveStyle.width,300);
    assert.equal(graphParts.find(part=>part.id==='decimal').positionEditable,false);
    assert.equal(document.capabilities.nativeData.fieldIds.length,27);
    const resource=await client.readResource({uri:document.capabilities.schemaResource});
    assert.equal(JSON.parse(resource.contents[0].text).nativeData.fields.length,27,'Advertised schema resource resolves');
    await tool("undo",nativeIdentity()); document=await tool("get_document");
    assert.equal(document.design.nativeData.today_run,undefined);
    await tool("redo",nativeIdentity()); document=await tool("get_document");
    assert.deepEqual(document.design,nativeEdited.design);
    await tool("apply_commands",{...nativeIdentity(),commands:[{op:'set_locked',id:'native:week_tl',locked:true}]});
    document=await tool("get_document");
    const lockedNativeRevision=document.revision;
    const lockedNativeEdit=await rawTool("apply_commands",{...nativeIdentity(),commands:[{op:'set',path:'/design/nativeData/week_tl/assetTexts/icon/0',value:'LOCKED'}]});
    assert.equal(lockedNativeEdit.isError,true);
    document=await tool("get_document"); assert.equal(document.revision,lockedNativeRevision);
    await tool("apply_commands",{...nativeIdentity(),commands:[{op:'set_locked',id:'native:week_tl',locked:false},{op:'unset',path:'/design/nativeData/week_tl/assets/icon'},{op:'unset',path:'/design/nativeData/week_tl/assetTexts/icon'}]});
    document=await tool("get_document");
    assert.equal(document.design.nativeData.week_tl.assets.icon,undefined,'MCP can restore generated artwork');
    await tool("apply_commands",{...nativeIdentity(),mode:'aod',commands:[{op:'set',path:'/design/nativeData',value:{week_tl:{...nativeDefaults('week_tl'),assetTexts:{icon:{'0':'AOD'}}}}}]});
    document=await tool("get_document");
    assert.equal(document.design.modeDesigns.aod.nativeData.week_tl.assetTexts.icon['0'],'AOD');
    assert.equal(document.design.nativeData.week_tl.assetTexts.icon,undefined,'AOD customization stays independent');
    await tool("set_view",{sessionId:document.sessionId,mode:'aod'});
    document=await tool("get_document");
    assert.equal(document.capabilities.layers.find(layer=>layer.id==='native:week_tl').nativeData.components[0].assetRole,'icon');
    await tool("render_preview",{sessionId:document.sessionId,mode:'aod'});
    await tool("set_view",{sessionId:document.sessionId,mode:'current'});
    await tool("render_preview",{sessionId:document.sessionId,mode:'current'});
    await tool("validate",{sessionId:document.sessionId});
    const mcpNativeArchive=await tool("build_archive",nativeIdentity());
    assert.equal((mcpNativeArchive.archive??mcpNativeArchive).watchFaceVersion,6);
    await tool("apply_commands",{...nativeIdentity(),mode:'aod',commands:[{op:'set',path:'/design/nativeData',value:{}}]});
    document=await tool("get_document");
    await tool("apply_commands",{...nativeIdentity(),commands:[{op:'unset',path:'/design/weatherIndicator'}]});
    document=await tool("get_document");
    await tool("apply_commands",{...nativeIdentity(),commands:[{op:"set",path:"/design/nativeData",value:{}}]});
    document = await tool("get_document");
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
    // A selection click near a snap target must never change the document.
    await tool("apply_commands", { ...identity(), commands: [
      { op: "add_element", element: { id: "click-probe", kind: "rect", x: 396, y: 350, width: 100, height: 40, rotation: 0, cornerRadius: 0, fill: "#ffffff" } }
    ] });
    document = await tool("get_document");
    const beforeClick = document;
    const canvasPointAt = (x, y) => window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.watchface-preview-overlay').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width * ${x} / 800), y: Math.round(rect.top + rect.height * ${y} / 800), width: rect.width };
    })()`);
    const pointerEvent = (type, point, modifiers = []) => window.webContents.sendInputEvent({ type, x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
    const paint = () => window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    let canvasPoint = await canvasPointAt(396, 350);
    pointerEvent("mouseDown", canvasPoint);
    pointerEvent("mouseUp", canvasPoint);
    document = await tool("get_document");
    assert.equal(document.view.selectedId, "bgel:click-probe", "click selects the shape");
    assert.deepEqual(document.design, beforeClick.design, "click near the center guide does not snap or move the shape");
    assert.equal(document.revision, beforeClick.revision, "selection does not create an undo entry");

    // The threshold uses screen pixels even after zooming, with or without snap.
    for (const zoom of ["100%", "Zoom out"]) {
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.wf-zoom-control button')).find(button => button.textContent === ${JSON.stringify(zoom)} || button.getAttribute('aria-label') === ${JSON.stringify(zoom)}).click()`);
      await paint();
      for (const modifiers of [[], ["alt"]]) {
        canvasPoint = await canvasPointAt(396, 350);
        pointerEvent("mouseDown", canvasPoint, modifiers);
        pointerEvent("mouseMove", { ...canvasPoint, x: canvasPoint.x + 2 }, modifiers);
        await paint();
        assert.notEqual(await window.webContents.executeJavaScript("document.querySelector('.watchface-preview-drag').style.visibility"), "visible", "click jitter does not start a drag preview");
        pointerEvent("mouseUp", { ...canvasPoint, x: canvasPoint.x + 2 }, modifiers);
        document = await tool("get_document");
        assert.deepEqual(document.design, beforeClick.design, "minor pointer jitter leaves all positions unchanged");
        assert.equal(document.revision, beforeClick.revision);
      }
    }

    canvasPoint = await canvasPointAt(396, 350);
    pointerEvent("mouseDown", canvasPoint);
    pointerEvent("mouseMove", { ...canvasPoint, y: canvasPoint.y + 20 });
    await paint();
    pointerEvent("mouseUp", { ...canvasPoint, y: canvasPoint.y + 20 });
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.find(item => item.id === "click-probe").x, 400, "intentional dragging still snaps to the center guide");
    await tool("undo", identity());
    document = await tool("get_document");
    assert.deepEqual(document.design, beforeClick.design, "one undo restores the entire drag");

    // A fast release still commits its final position without a pointermove.
    canvasPoint = await canvasPointAt(396, 350);
    pointerEvent("mouseDown", canvasPoint, ["alt"]);
    pointerEvent("mouseUp", { ...canvasPoint, x: canvasPoint.x + 20, y: canvasPoint.y + 16 }, ["alt"]);
    document = await tool("get_document");
    const draggedProbe = document.design.backgroundElements.find(item => item.id === "click-probe");
    assert.equal(draggedProbe.x, Math.round(396 + 20 * 800 / canvasPoint.width), "Alt-drag uses the final horizontal pointer displacement");
    assert.equal(draggedProbe.y, Math.round(350 + 16 * 800 / canvasPoint.width), "Alt-drag uses the final vertical pointer displacement");
    await tool("undo", identity());
    document = await tool("get_document");
    assert.deepEqual(document.design, beforeClick.design);
    await tool("undo", identity());
    document = await tool("get_document");
    assert.equal(document.design.backgroundElements.length, 2, "undo after selection removes the added shape");
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.wf-zoom-control button')).find(button => button.textContent === 'Fit').click()");
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
    const dialogRevision = document.revision;
    const dialogSession = document.sessionId;
    await window.webContents.executeJavaScript(`document.querySelector('.wf-export-button').click()`);
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".wf-export-popover .is-convert"))'), Boolean, "conversion menu");
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-popover .is-convert").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog"))'), Boolean, "watch-only conversion picker");
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".watchface-convert-dialog select").length'), 1);
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".watchface-template-browser").length'), 0);
    window.showInactive();
    await fs.writeFile(path.join(temporaryRoot, "watch-conversion.png"), (await window.webContents.capturePage()).toPNG());
    window.hide();
    await window.webContents.executeJavaScript(`document.querySelector('.watchface-convert-dialog .secondary-button').click()`);
    document = await tool("get_document");
    assert.equal(document.revision, dialogRevision, "cancelling conversion preserves edits and history");
    assert.equal(document.sessionId, dialogSession, "conversion picker keeps the original editor mounted");
    const previousSession = document.sessionId;
    const originalDesign = structuredClone(document.design);
    // Exercise the real service's missing-session error on a first-use cache miss.
    const pace4CarrierPath = path.join(carrierCache, "pace-4.zip");
    const pace4Carrier = await fs.readFile(pace4CarrierPath);
    await fs.unlink(pace4CarrierPath);
    restoreCarrierAfterLogin = () => fs.writeFile(pace4CarrierPath, pace4Carrier);
    await window.webContents.executeJavaScript(`document.querySelector('.wf-export-button').click()`);
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".wf-export-popover .is-convert"))'), Boolean, "conversion menu");
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-popover .is-convert").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog .primary-button"))'), Boolean, "convert button");
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog .primary-button").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog input[type=password]"))'), Boolean, "conversion sign-in dialog");
    assert.match(await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog").textContent'), /Sign in to download support for PACE 4/);
    assert.equal(await window.webContents.executeJavaScript('document.activeElement === document.querySelector(".watchface-convert-dialog select")'), true, "focus moves into sign-in");
    assert.equal(await window.webContents.executeJavaScript('(() => { const dialog = document.querySelector(".watchface-convert-dialog"); const back = dialog.querySelector(".watchface-modal-actions button"); return back.getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom; })()'), true, "sign-in actions fit in the dialog");
    window.showInactive();
    await fs.writeFile(path.join(temporaryRoot, "watch-conversion-sign-in.png"), (await window.webContents.capturePage()).toPNG());
    window.hide();
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog .watchface-modal-actions button").click()');
    assert.equal(await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog select").value'), "pace-4", "leaving sign-in preserves the selected watch");
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog .secondary-button").click()');
    document = await tool("get_document");
    assert.equal(document.sessionId, previousSession, "cancelling sign-in keeps the original editor");
    assert.equal(document.revision, dialogRevision);
    assert.deepEqual(document.design, originalDesign);
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-button").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".wf-export-popover .is-convert"))'), Boolean, "conversion menu after cancelled sign-in");
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-popover .is-convert").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog .primary-button"))'), Boolean, "convert button after cancelled sign-in");
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog .primary-button").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog input[type=password]"))'), Boolean, "sign-in after retrying conversion");
    await window.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('.watchface-convert-dialog form');
      for (const [type, value] of [['email', 'conversion@example.test'], ['password', 'test-password']]) {
        const input = form.querySelector('input[type=' + type + ']');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const region = form.querySelector('select');
      region.value = 'eu'; region.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog form").requestSubmit()');
    await until(() => window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog [role=alert]")?.textContent ?? ""'), text => text.includes("email or password is incorrect"), "inline login error");
    assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog input[type=password]"))'), true, "failed login keeps the sign-in form open");
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog form").requestSubmit()');
    await until(async () => { const response = await rawTool("get_context"); return JSON.parse(response.content.find(part => part.type === "text").text); }, result => typeof result.sessionId === "string" && result.sessionId !== previousSession && !result.busy, "converted editor");
    assert.equal(manualLoginAttempts, 2);
    document = await tool("get_document");
    assert.notEqual(document.sessionId, previousSession);
    assert.equal(document.target.watchModel, "pace-4");
    assert.equal(document.design.backgroundElements.find(item => item.id === "label").text, "TRAIL");
    assert.deepEqual(document.design, originalDesign, "conversion preserves all scene styles, assets, groups, offsets and data fields");
    await tool("render_preview", { sessionId: document.sessionId, mode: "current", resolution: 390 });
    await tool("render_preview", { sessionId: document.sessionId, mode: "aod", resolution: 390 });
    await tool("build_archive", identity());
    // A stale authenticated status must also open sign-in when COROS expires it.
    conversionAuthError = "Your COROS mobile session expired. Sign in again.";
    const beforeSavedLoginSession = document.sessionId;
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-button").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".wf-export-popover .is-convert"))'), Boolean, "MIP conversion menu");
    await window.webContents.executeJavaScript('document.querySelector(".wf-export-popover .is-convert").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog select"))'), Boolean, "MIP watch picker");
    await window.webContents.executeJavaScript(`(() => { const select = document.querySelector('.watchface-convert-dialog select'); select.value = 'pace-3'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog .primary-button").click()');
    await until(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".watchface-convert-dialog .watchface-saved-login button"))'), Boolean, "saved account sign-in");
    assert.match(await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog").textContent'), /download support for PACE 3/);
    await window.webContents.executeJavaScript('document.querySelector(".watchface-convert-dialog .watchface-saved-login button").click()');
    await until(async () => { const response = await rawTool("get_context"); return JSON.parse(response.content.find(part => part.type === "text").text); }, result => typeof result.sessionId === "string" && result.sessionId !== beforeSavedLoginSession && !result.busy, "conversion resumed after saved login");
    assert.equal(savedLoginAttempts, 1);
    document = await tool("get_document");
    assert.equal(document.capabilities.aod, false);
    assert.equal(document.target.watchModel, "pace-3");
    assert.deepEqual(document.design, originalDesign, "MIP retains the dormant AOD design");
    await tool("render_preview", { sessionId: document.sessionId, resolution: 240 });
    await tool("build_archive", identity());
    authenticated = false;
    await tool("convert", { ...identity(), watchModel: "pace-pro" });
    document = await tool("get_document");
    assert.equal(document.capabilities.aod, true);
    assert.deepEqual(document.design, originalDesign, "round trip restores the whole editable scene");
    await tool("save", identity());
    document = await tool("get_document");
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
