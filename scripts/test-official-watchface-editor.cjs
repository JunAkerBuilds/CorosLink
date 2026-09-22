const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { PNG } = require("pngjs");
const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;
const root = path.resolve(__dirname, "..");
const temp = path.join(os.tmpdir(), `coroslink-official-editor-${process.pid}`);
app.setPath("userData", path.join(temp, "user-data"));
app.setPath("downloads", temp);
// This offline test never reads or writes the user's login/keychain.
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === "electron") return { ...electron, safeStorage: { isEncryptionAvailable: () => false } };
  return load.call(this, id, ...args);
};

function fixture() {
  const headers = Buffer.alloc(0x1164 * 2);
  for (const base of [0, 0x1164]) {
    headers.write("614A", base); headers.writeUInt16LE(0x1164, base + 0x138); headers[base + 0x13a] = 4;
    headers.writeUInt32LE(42, base + 4);
    for (const offset of [0x1b0, 0x1be, 0x1cc, 0x1da]) {
      headers.writeInt32LE(60 + (offset - 0x1b0) * 2, base + offset); headers.writeInt32LE(base ? 270 : 100, base + offset + 4);
      headers.writeUInt32LE(headers.length, base + offset + 8);
    }
  }
  headers.writeUInt32LE(0x1164, 0x322);
  const palette = Buffer.alloc(1024); palette.set([200, 40, 10, 255], 64); palette.set([3, 70, 110, 128], 4);
  const decoded = Buffer.concat([Buffer.from([1, 16]), palette]);
  const encoded = Buffer.from([...decoded].flatMap(n => n >= 0xc0 ? [0xc1, n] : [n]));
  const bitmap = Buffer.alloc(14 + 10 * 4);
  bitmap.writeUInt16LE(2); bitmap.writeUInt16LE(1, 2); bitmap.writeUInt16LE(0x2002, 4); bitmap[6] = 10; bitmap[7] = 1;
  for (let i = 0; i < 10; i++) bitmap.writeUInt32LE(encoded.length * (i + 1), 14 + i * 4);
  return Buffer.concat([headers, bitmap, ...Array(10).fill(encoded)]);
}

async function main() {
  await app.whenReady(); await fs.mkdir(temp, { recursive: true });
  const { recoverCompiledCorosWatchface } = require("../dist-electron/corosCompiledWatchface.js");
  const unzipper = require("unzipper");
  const recoveredFixture = recoverCompiledCorosWatchface(fixture(), "Fixture", "90071992547409931");
  const zip = await unzipper.Open.buffer(recoveredFixture.zip);
  const entry = n => zip.files.find(f => f.path === n).buffer();
  assert.deepEqual(PNG.sync.read(await entry("watchface_416x416/recovered/group-00/00.png")).data,
    Buffer.from([200, 40, 10, 255, 3, 70, 110, 128]), "palette transpose and straight alpha survive the production PNG encoder");
  assert.deepEqual(await entry("recovery/source.bin"), fixture());
  assert.match((await entry("watchface_416x416/AODconfig.txt")).toString(), /\{60,270\}/);
  const recoveredInfo = JSON.parse((await entry("info.json")).toString());
  assert.equal(recoveredInfo.o_template_id, "90071992547409931");
  // The website validator requires the DIY manifest fields official templates carry.
  assert.equal(recoveredInfo.m_app, "watchface_416x416");
  assert.equal(recoveredInfo.m_preview, "watchface_customize.png");
  assert.throws(() => recoverCompiledCorosWatchface(Buffer.from("unknown"), "bad"), /cannot be opened/);
  const malformed = fixture(); malformed.writeUInt32LE(10, 0x322);
  assert.throws(() => recoverCompiledCorosWatchface(malformed, "bad"), /cannot be opened/);

  const source = process.argv[2] ? await fs.readFile(process.argv[2]) : fixture();
  // The magic is the screen size reversed plus a variant letter (614A = 416px AMOLED, 062R = 260px MIP).
  const nativeSize = Number([...source.toString("latin1", 0, 3)].reverse().join(""));
  const sourceName = process.argv[2] ? path.basename(process.argv[2], ".bin").replace(/-[a-f0-9]{8}$/i, "") : "Fixture";
  const { initializeDatabase } = require("../dist-electron/database.js");
  initializeDatabase(app.getPath("userData"));
  const service = require("../dist-electron/corosWatchfaceService.js");
  const { createStoreZip } = require("../dist-electron/zipStore.js");
  const carrierEntries = [
    { name: "info.json", data: Buffer.from('{"m_name":"STANDARD","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_default_language":"en","o_template_id":90071992547409933,"o_diy_version":1,"o_wf_ver":0}') },
    { name: "watchface_customize.png", data: PNG.sync.write({ width: 800, height: 800, data: Buffer.alloc(800 * 800 * 4) }) }
  ];
  for (const size of [416, 800]) {
    const png = PNG.sync.write({ width: size, height: size, data: Buffer.alloc(size * size * 4) });
    carrierEntries.push({ name: `watchface_${size}x${size}/background.png`, data: png },
      { name: `watchface_${size}x${size}/thmb.png`, data: PNG.sync.write({ width: 160, height: 160, data: Buffer.alloc(160 * 160 * 4) }) },
      { name: `watchface_${size}x${size}/config.txt`, data: Buffer.from('[watchface_id]=0x00000029\n[background_icon]=background.png\n') });
  }
  const cache = path.join(app.getPath("userData"), "watchface-conversion-carriers");
  await fs.mkdir(cache, { recursive: true }); await fs.writeFile(path.join(cache, "pace-pro.zip"), createStoreZip(carrierEntries));
  const publishRequests = []; let rejectPublish = false;
  const packageUrl = "https://fixture.test/planet.bin", unsupportedUrl = "https://fixture.test/unsupported.bin";
  global.fetch = async (url, options) => {
    url = String(url);
    const route = new URL(url).pathname;
    if (route.endsWith("/user/login")) return new Response(JSON.stringify({ result: "0000", data: { accessToken: "offline-test-token" } }));
    if (route.endsWith("/watchFaceTemplateUserCustom/saveOrUpdateV2")) {
      publishRequests.push(options.body);
      return new Response(rejectPublish ? '{"result":"1001","message":"Parameter input error"}' : '{"result":"0000","data":{"watchFaceTemplateId":90071992547409935}}');
    }
    if (route.endsWith("/watchface/share/createLink")) {
      assert.match(options.body, /"srcWatchFaceTemplateId":90071992547409933/);
      assert.match(options.body, /"watchFaceTemplateId":90071992547409935/);
      return new Response(JSON.stringify({ result: "0000", data: { url: "https://faq.coros.com/share/watchface?test=1" } }));
    }
    if (route.endsWith("/watchface/getWatchFaceThemeList") || route.endsWith("/watchfaceTemplate/query")) return new Response(JSON.stringify({ result: "0000", data: [
      { name: sourceName, watchFaceId: "90071992547409931", watchFaceUrl: packageUrl, firmwareType: "COROS W332" },
      { name: "UNSUPPORTED", watchFaceId: "90071992547409932", watchFaceUrl: unsupportedUrl, firmwareType: "COROS W332" }
    ] }));
    if (url === packageUrl || url === unsupportedUrl) {
      await new Promise(resolve => setTimeout(resolve, 120));
      return new Response(url === packageUrl ? source : Buffer.from("unsupported binary"), { headers: { "content-type": "application/octet-stream" } });
    }
    throw new Error(`Unexpected offline test request: ${url}`);
  };
  await service.loginCorosWatchfaces("test@example.test", "test", "us", false);
  const requests = [];
  const handlers = {
    "watchfaces:getStatus": () => service.getCorosWatchfaceStatus(),
    "watchfaces:listThemes": (_, input) => service.listCorosWatchfaceThemes(input),
    "watchfaces:downloadTheme": async (_, input) => { requests.push(input); return service.downloadCorosWatchfaceTheme(input); },
    "watchfaces:listProjects": () => service.listCorosWatchfaceProjects(),
    "watchfaces:describeTemplate": (_, id) => service.describeCorosWatchfaceTemplate(id),
    "watchfaces:loadTemplateAssets": (_, id, paths) => service.loadCorosWatchfaceTemplateAssets(id, paths),
    "watchfaces:loadTemplateConfigTexts": (_, id) => service.loadCorosWatchfaceTemplateConfigTexts(id),
    "watchfaces:listLocalFontFamilies": () => ["Arial", "Helvetica"],
    "watchfaces:queryPairedDevices": () => [],
    "watchfaces:saveProject": (_, input) => service.saveCorosWatchfaceProject(input),
    "watchfaces:createArchive": (_, input) => service.createCorosWatchfaceArchive(input),
    "watchfaces:loadProject": (_, id) => service.loadCorosWatchfaceProject(id),
    "watchfaces:cacheProjectPreview": (_, id, png) => service.cacheCorosWatchfaceProjectPreview(id, png)
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  const { createServer } = await import("vite");
  const vite = await createServer({ root, cacheDir: path.join(temp, "vite-cache"), server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false }, logLevel: "error" });
  let win;
  const watchdog = setTimeout(() => { console.error("Official editor test timed out"); app.exit(1); }, 90_000);
  try {
    await vite.listen();
    win = new BrowserWindow({ show: false, width: 1440, height: 1050, webPreferences: { preload: path.join(root, "dist-electron/preload.js"), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async (code, accept = Boolean) => {
      for (let n = 0; n < 300; n++) { const value = await js(code); if (accept(value)) return value; await new Promise(r => setTimeout(r, 30)); }
      throw new Error(`Timed out: ${code}\n${await js('document.body.innerText')}`);
    };
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/watchface-official-import.html`);
    await until('Boolean(document.querySelector("#watchface-templates-tab"))');
    await js('document.querySelector("#watchface-templates-tab").click()');
    await until('Boolean(document.querySelector("#watchface-template-catalog"))');
    await js(`(() => { const s=document.querySelector('#watchface-template-catalog'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'official'); s.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.watchface-template-controls').requestSubmit(); })()`);
    await until('document.querySelectorAll(".watchface-template-card").length === 2');
    // A submit in the same tick as the catalog change can use the prior state.
    await js('document.querySelector(".watchface-template-controls").requestSubmit()');
    await until('[...document.querySelectorAll(".watchface-template-card button")].some(b=>b.textContent === "Open in editor" && !b.disabled)');
    assert.deepEqual(await js('[...document.querySelector(".watchface-template-card").querySelectorAll("button")].map(b=>b.textContent)'), ["Download", "Open in editor"]);
    await js('document.querySelector(".watchface-template-card button").click()');
    await until('!document.querySelector(".watchface-template-card button").disabled');
    assert.equal(requests[0].openInEditor, undefined);
    assert.equal(await js('Boolean(document.querySelector(".watchface-editor"))'), false, "Download must stay in the catalog");
    assert((await fs.readdir(path.join(temp, "COROS watchfaces"))).some(n => n.endsWith(".bin")));
    await js('document.querySelectorAll(".watchface-template-card")[1].querySelectorAll("button")[1].click()');
    await until('document.body.innerText.includes("cannot be opened in the editor yet")');
    assert.equal(await js('Boolean(document.querySelector(".watchface-editor"))'), false);
    await until('!document.querySelector(".watchface-template-card button").disabled');
    await js('document.querySelector(".watchface-template-card button").scrollIntoView({block:"center"})');
    await new Promise(r => setTimeout(r, 150));
    await fs.writeFile(path.join(temp, "official-actions.png"), (await win.webContents.capturePage()).toPNG());
    await js('document.querySelector(".watchface-template-card").querySelectorAll("button")[1].click()');
    await until('document.body.innerText.includes("Opening…")');
    assert(await js('[...document.querySelectorAll(".watchface-template-card button")].every(b=>b.disabled)'));
    await until('Boolean(document.querySelector(".watchface-editor"))');
    assert.equal(requests.at(-1).openInEditor, true);
    const getDoc = `import('/src/watchfaces/watchfaceAutomation.ts').then(m=>m.getWatchfaceAutomationEditor()?.request('get_document',{}))`;
    const doc = await until(getDoc, value => value?.capabilities?.layers?.length > 0);
    assert(doc.capabilities.layers.some(layer => layer.id === "hours"), "Recovered clock is editable, not a flattened thumbnail");
    const request = (method, params) => js(`import('/src/watchfaces/watchfaceAutomation.ts').then(m=>m.getWatchfaceAutomationEditor().request(${JSON.stringify(method)},${JSON.stringify(params)}))`);
    const faceId = source.readUInt32LE(4);
    if (faceId === 1000001120 && doc.design.nativeData?.stamina?.assets?.states) { // PLANET
      assert(doc.capabilities.layers.some(layer => layer.id === "dateMonth"), "Combined month becomes an editable date layer");
      assert(doc.capabilities.layers.some(layer => layer.id === "dateDay"), "Combined day becomes an editable date layer");
      const stamina = doc.design.nativeData.stamina;
      assert.equal(Object.keys(stamina.assets.states).length, 11);
      assert.equal(stamina.x + stamina.parts.states.x, 15);
      assert.equal(stamina.y + stamina.parts.states.y, 229);
      // Match the user's PLANET comparison: its clock colon is already baked
      // into the background, and the selectable footer is showing sunset.
      await request("apply_commands", { sessionId: doc.sessionId, baseRevision: doc.revision, commands: [
        { op: "set", path: "/design/configAssetOverrides/config:colon_icon", value: { enabled: false } },
        { op: "set", path: "/design/previewComplication", value: "sunset" }
      ] });
      Object.assign(doc, await request("get_document", {}));
      const scenario = { dateTime: "2023-04-17T06:23:35", values: { battery: "100", stamina: "100", weather_temp: "27", heartRate: "68", exercise: "00:00", sunset: "19:23" }, weather: { condition: 0, night: false } };
      const render = async sample => PNG.sync.read(Buffer.from((await request("render_preview", { sessionId: doc.sessionId, mode: "current", resolution: 416, size: 416, scenario: sample })).dataUrl.split(",")[1], "base64"));
      const full = await render(scenario);
      const empty = await render({ ...scenario, dateTime: "2023-05-18T06:23:35", values: { ...scenario.values, stamina: "0" } });
      const crop = (png, x, y, w, h) => Buffer.concat(Array.from({ length: h }, (_, row) => png.data.subarray(((y + row) * png.width + x) * 4, ((y + row) * png.width + x + w) * 4)));
      assert.notDeepEqual(crop(full, 15, 280, 70, 65), crop(empty, 15, 280, 70, 65), "Stamina arc changes with the percentage, independently of its number");
      assert.notDeepEqual(crop(full, 160, 46, 95, 27), crop(empty, 160, 46, 95, 27), "Recovered date follows the calendar");
      const percent = crop(full, 390, 207, 19, 20);
      assert(percent.some((v, i) => i % 4 === 0 && v > 70 && percent[i + 1] === v && percent[i + 2] === v), "Battery percent image renders after the value, outside its digit rectangle");
      await fs.writeFile(path.join(temp, "planet-full.png"), PNG.sync.write(full));
      await fs.writeFile(path.join(temp, "planet-empty.png"), PNG.sync.write(empty));
      const built = await request("build_archive", { sessionId: doc.sessionId, baseRevision: doc.revision });
      const details = await service.describeCorosWatchfaceTemplate(built.archive.archiveId);
      const config = details.resolutions.find(r => r.width === 416).config;
      assert.match(config.stamina_level_pos, /15,229/);
      assert(config.stamina_level_icon, "Stamina states survive export");
      assert(config.english_date_month_font && config.english_date_day_font, "Date fonts survive export");
    }
    if (doc.design.nativeData?.week_elev) {
      for (const id of ["weather_humidity", "weather_rainfall", "today_elev", "week_elev"]) assert(doc.design.nativeData[id]?.enabled, `${id} is recovered as an editable layer`);
      assert.equal(doc.design.nativeData.week_elev.parts.value.digitWidth, 23);
      assert.equal(Object.keys(doc.design.nativeData.week_elev.assets.unit).length, 2, "Both elevation unit images survive discovery");
      const config = doc.advanced.configTextBaselines["watchface_416x416/config.txt"];
      assert.match(config, /\[arc_cut_icon\]=recovered\\group-23\\00.png/, "Recovered references use COROS's backslash separators");
      assert.match(config, /\[control_exercise_hour_rect\]/);
      await request("apply_commands", { sessionId: doc.sessionId, baseRevision: doc.revision, commands: [
        { op: "set", path: "/design/configAssetOverrides/config:colon_icon", value: { enabled: false } },
        { op: "set", path: "/design/previewComplication", value: "exercise" }
      ] });
      Object.assign(doc, await request("get_document", {}));
      const scenario = { dateTime: "2022-06-20T01:23:23", values: { weather_humidity: "60", weather_rainfall: "50", weather_temp: "20", today_elev: "4365", week_elev: "28360", battery: "30", heartRate: "68", exercise: "00:00" }, weather: { condition: 1, night: false } };
      const render = async value => Buffer.from((await request("render_preview", { sessionId: doc.sessionId, mode: "current", resolution: 416, size: 416, scenario: value })).dataUrl.split(",")[1], "base64");
      const preview = await render(scenario), changed = await render({ ...scenario, values: { ...scenario.values, week_elev: "28369" } });
      const crop = data => { const p = PNG.sync.read(data); return Buffer.concat(Array.from({length:33}, (_,y)=>p.data.subarray(((360+y)*416+218)*4,((360+y)*416+242)*4))); };
      assert.notDeepEqual(crop(preview), crop(changed), "The fifth weekly digit renders and responds to simulation");
      await fs.writeFile(path.join(temp, "multidata-reference.png"), preview);
      const built = await request("build_archive", { sessionId: doc.sessionId, baseRevision: doc.revision });
      const exported = await service.describeCorosWatchfaceTemplate(built.archive.archiveId);
      const resolution = exported.resolutions.find(r=>r.width===416);
      await fs.writeFile(path.join(temp, "exported-details.json"), JSON.stringify(exported, null, 2));
      assert.equal(resolution.spriteFolders.find(f=>f.folder===resolution.config.week_elev_font.replace(/\\/g,"/")).files[0].width, 23, "Export preserves original digit size independently of rectangle width");
      assert.match(resolution.config.week_elev_rect, /128,360,240,393,right\|vcenter/);
      assert(resolution.config.weather_rainfall_percent_icon && resolution.config.weather_humidity_percent_icon);
      assert(resolution.config.today_elev_unit_icon && resolution.config.week_elev_unit_icon);
    }
    const rendered = [];
    const hasAod = source.readUInt16LE(0x138) >= 0x326 && source.readUInt32LE(0x322) !== 0;
    for (const mode of hasAod ? ["current", "aod"] : ["current"]) {
      const preview = await request("render_preview", { sessionId: doc.sessionId, mode, resolution: nativeSize, size: nativeSize });
      const png = Buffer.from(preview.dataUrl.split(",")[1], "base64");
      assert.equal(PNG.sync.read(png).width, nativeSize);
      await fs.writeFile(path.join(temp, `${mode}.png`), png);
      rendered.push(png);
    }
    if (hasAod) assert.notDeepEqual(rendered[0], rendered[1], "Current and AOD use distinct recovered layouts");
    else assert.equal(doc.capabilities.layers.some(layer => layer.id === "hours"), true, "MIP faces have no AOD but keep an editable clock");
    const validation = await request("validate", { sessionId: doc.sessionId });
    assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
    const finalBuild = await request("build_archive", { sessionId: doc.sessionId, baseRevision: doc.revision });
    assert.equal(finalBuild.archive.resolutionProfile, "amoled-416-800");
    assert.equal(finalBuild.archive.sourceTemplateId, "90071992547409933");
    assert(!finalBuild.archive.recoveredFromCompiled);
    const exportPath = path.join(temp, "exported-face.zip");
    await service.exportCorosWatchfaceArchive(finalBuild.archive.archiveId, exportPath);
    const exportedBytes = await fs.readFile(exportPath);
    const exportedZip = await unzipper.Open.buffer(exportedBytes);
    const files = new Map(exportedZip.files.map(e => [e.path, e]));
    assert.equal(PNG.sync.read(await files.get("watchface_customize.png").buffer()).width, 800, "DIY preview uses the carrier's authoring size, not the compiled catalog thumbnail");
    assert(![...files.keys()].some(n => /\.bin$|^recovery\//.test(n)), "Do not upload the original compiled face or recovery reports");
    for (const size of [416, 800]) {
      for (const mode of ["config.txt", "AODconfig.txt"]) {
        const config = (await files.get(`watchface_${size}x${size}/${mode}`).buffer()).toString();
        assert.match(config, /\[watchface_id\]=0x00000029/);
        assert.match(config, /\[watchface_thmb_icon\]=thmb.png/);
        // Every nonblank asset path must resolve inside its own resolution tree.
        for (const value of Object.values(service.parseCorosWatchfaceConfig(config))) {
          const relative = value.replaceAll("\\", "/");
          assert(!value.includes("/"), `${value} must use backslash separators like COROS templates`);
          if (/\.png$|^studio\/|^recovered\//.test(relative)) assert([...files.keys()].some(n => n === `watchface_${size}x${size}/${relative}` || n.startsWith(`watchface_${size}x${size}/${relative}/`)), relative);
        }
      }
      assert.equal(PNG.sync.read(await files.get(`watchface_${size}x${size}/background.png`).buffer()).width, size);
      assert.equal(PNG.sync.read(await files.get(`watchface_${size}x${size}/thmb.png`).buffer()).width, 160);
    }
    const publish = archiveId => service.publishCorosWatchface({ archiveId, name: sourceName, firmwareType: "COROS W332", backgroundImageId: 13 });
    await assert.rejects(() => publish(doc.archive.archiveId), /editor recovery archive/);
    assert.equal(publishRequests.length, 0, "Unprepared official IDs never reach COROS");
    await publish(finalBuild.archive.archiveId);
    const form = publishRequests.at(-1);
    assert.match(form.get("jsonParameter"), /"srcWatchFaceTemplateId":90071992547409933/);
    assert.equal(JSON.parse(form.get("jsonParameter")).firmwareType, "COROS W332");
    assert.deepEqual(Buffer.from(await form.get("watchFaceTemplateUserCustomZipFile").arrayBuffer()), exportedBytes, "File export and COROS upload use the same verified archive");
    rejectPublish = true;
    await assert.rejects(() => publish(finalBuild.archive.archiveId), /Parameter input error.*COROS 1001/);
    const saved = await request("save", { sessionId: doc.sessionId, baseRevision: doc.revision });
    assert(saved.project?.projectId, "Recovered face can be saved as an editable project");
    const reopened = await service.loadCorosWatchfaceProject(saved.project.projectId);
    assert(reopened.archive.recoveredFromCompiled);
    const hasWeather = source.readUInt16LE(0x138) >= 0xc9a && source.readUInt32LE(0xc52) !== 0;
    if (process.argv[2] && !hasWeather) {
      // Older/MIP faces stop before the weather block: the clock, date, battery
      // and selectable control must still round-trip through a saved project.
      assert.equal(reopened.design.weatherIndicator?.enabled ?? false, false);
      assert(reopened.design.nativeData === undefined || !Object.values(reopened.design.nativeData).some(style => style.enabled), "No weather layers are invented");
      // This offline carrier targets PACE Pro, so a 260px MIP layout is scaled to its 416px tree.
      const exportedConfig = service.parseCorosWatchfaceConfig((await files.get("watchface_416x416/config.txt").buffer()).toString());
      if (nativeSize === 260) {
        const scale = 416 / 260;
        assert.equal(exportedConfig.time_hour_high_pos, `{${Math.round(source.readInt32LE(0x1b0) * scale)},${Math.round(source.readInt32LE(0x1b4) * scale)}}`, "MIP clock scales from its native position");
        assert.match(exportedConfig.time_hour_high_font, /^recovered\\group-\d\d$/);
        assert.match(exportedConfig.control_hr_rect ?? "", /^\{/, "Selectable heart rate survives export");
        assert.equal(exportedConfig.weather_icon_dir, undefined, "No weather keys are invented for a header without a weather block");
      }
    }
    if (process.argv[2] && hasWeather) {
      assert(Object.keys(reopened.design.weatherIndicator.assets.day).length > 0, "Original weather assets survive saving");
      assert.equal(reopened.design.weatherIndicator.temperatureEnabled, false);
      assert(reopened.design.nativeData.weather_temp, "Temperature is recovered");
      assert.equal(reopened.design.modeDesigns.aod.weatherIndicator.enabled, false);
      if (source.readUInt16LE(0x138) === 0x11a0) {
        const wind = reopened.design.nativeData.weather_wind;
        assert(wind.enabled);
        assert.equal(wind.x + wind.parts.icon.x, source.readInt32LE(0xc6c), "Wind icon keeps its original position left of the value");
        assert.equal(wind.x + wind.parts.value.x, source.readInt16LE(0xc78));
        assert(wind.parts.icon.x >= 0 && wind.parts.value.x >= 0);
        assert(reopened.design.nativeData.weather_temp_min.enabled && reopened.design.nativeData.weather_temp_max.enabled, "Min/max temperature alternatives stay enabled so the general chart group keeps them");
        const direction = reopened.design.nativeData.weather_direction;
        assert(direction?.enabled, "Wind direction state artwork is recovered");
        assert.deepEqual([direction.x, direction.y], [source.readInt32LE(0xc86), source.readInt32LE(0xc8a)]);
        assert.equal(direction.stateCount, 8, "NOMAD's eight compass points are kept, not padded to the catalog default");
        assert.equal(Object.keys(direction.assets.states).length, 8);
        const chart = reopened.design.nativeData.chart;
        assert.equal(chart?.chartSource, "chart_sunrise", "The sun chart group from the catalog thumbnail is the starting readout");
        assert.deepEqual([chart.x + chart.parts.plot.x, chart.y + chart.parts.plot.y, chart.parts.plot.width, chart.parts.plot.height], [source.readInt16LE(0xdd0), source.readInt16LE(0xdd2), source.readInt16LE(0xdd4) - source.readInt16LE(0xdd0), source.readInt16LE(0xdd6) - source.readInt16LE(0xdd2)]);
        assert(chart.parts.background.enabled && chart.assets.background[0], "Original graph backdrop survives");
        assert(chart.parts.noDataMask.enabled && chart.assets.noDataMask[0]);
        assert.deepEqual([chart.x + chart.parts.icon.x, chart.y + chart.parts.icon.y], [source.readInt32LE(0xe68), source.readInt32LE(0xe6c)]);
        assert.equal(Object.keys(chart.assets.icon).length, 2, "Sunrise and sunset icons are both retained");
        assert.equal(chart.x + chart.parts.value.x, source.readInt16LE(0xe78));
        assert.equal(chart.parts.value.digitWidth, 23);
        assert.equal(chart.chartStyle.lineWidth, source[0xe66]);
        assert.equal(chart.chartStyle.previewType, "curve", "Sun-path groups preview as a line graph");
        assert.equal(chart.chartStyle.unselectedBarColor, "#555555");
        const angle = reopened.design.nativeData.chart_sun_angle;
        assert(angle?.enabled, "Solar angle readout is recovered as an editable layer");
        assert.equal(angle.x + angle.parts.icon.x, source.readInt32LE(0xe9c));
        assert.equal(angle.x + angle.parts.value.x, source.readInt16LE(0xea8));
        assert(angle.parts.unit.enabled && angle.assets.unit[0], "Chart degree artwork is the solar angle's unit");
        assert(reopened.design.nativeData.weather_temp.enabled, "The temperature stays enabled; the preview hides it only while the chart is on the sun group");
        const exportedConfig = service.parseCorosWatchfaceConfig((await files.get("watchface_416x416/config.txt").buffer()).toString());
        for (const language of ["germany", "spanish", "french", "polish", "portugal", "italian", "japanese", "thai", "chinese_tw"]) {
          assert.match(exportedConfig[`${language}_date_week_font`] ?? "", /^recovered\\group-\d\d$/, `${language} weekday table is exported`);
        }
        assert(exportedConfig.chart_tide_rect && exportedConfig.chart_stress_rect && exportedConfig.chart_baro_font && exportedConfig.chart_item3_bg, "Other chart groups' readouts survive export");
        assert(exportedConfig.weather_temp_rect && exportedConfig.weather_temp_min_rect && exportedConfig.chart_sun_angle_rect, "Slot-sharing alternatives all export");
        assert.equal(exportedConfig.time_second_icon, "recovered\\group-16\\00.png", "The bezel chevron exports as the seconds hand");
        assert.equal(exportedConfig.time_center_pos, "{207,207}");
        assert.equal(exportedConfig.fish_pointer_icon, undefined, "No stray fish pointer without a fishing display");
      } else {
        assert(reopened.design.nativeData.weather_temp.enabled);
      }
      if (source.readUInt32LE(0x1062) && source.readUInt16LE(0x138) >= 0x1074) {
        // RUBY HORIZON: extended-status barometer column, UV level artwork and
        // an icon-less AQI value declared over the UV column.
        const baro = reopened.design.nativeData.baro;
        assert(baro?.enabled && baro.parts.icon.enabled, "Barometer readout and icon are recovered");
        assert.deepEqual([baro.x + baro.parts.icon.x, baro.y + baro.parts.icon.y, baro.x + baro.parts.value.x], [source.readInt32LE(0x105a), source.readInt32LE(0x105e), source.readInt16LE(0x1066)]);
        assert(reopened.design.nativeData.weather_uv?.enabled && reopened.design.nativeData.weather_uv.parts.states.enabled, "UV level artwork is recovered");
        assert.equal(reopened.design.nativeData.weather_aqi?.enabled, false, "The icon-less AQI alternative over the UV column starts disabled");
      }
      if (source.readUInt32LE(0x3e)) {
        // DASHBOARD: WFStatusInfo.sedentary ring and a level-only UV arc.
        const sedentary = reopened.design.nativeData.sedentary;
        assert(sedentary?.enabled, "Sedentary reminder states are recovered");
        assert.deepEqual([sedentary.x, sedentary.y, sedentary.stateCount, Object.keys(sedentary.assets.states).length], [source.readInt32LE(0x36), source.readInt32LE(0x3a), 7, 7]);
        const uv = reopened.design.nativeData.weather_uv;
        assert(uv?.enabled && uv.parts.states.enabled && uv.parts.value.enabled === false, "UV level artwork imports without a numeric readout");
        assert.deepEqual([uv.x + uv.parts.states.x, uv.y + uv.parts.states.y, uv.stateCount ?? Object.keys(uv.assets.states).length], [source.readInt32LE(0xd1c), source.readInt32LE(0xd20), 6]);
        const exportedConfig = service.parseCorosWatchfaceConfig((await files.get("watchface_416x416/config.txt").buffer()).toString());
        assert(exportedConfig.sedentary_icon_dir && exportedConfig.sedentary_icon_pos && exportedConfig.weather_uv_level_icon && exportedConfig.weather_uv_level_pos, "Sedentary and UV level artwork export");
        assert.equal(exportedConfig.weather_uv_rect, undefined, "No numeric UV rectangle is invented");
      }
    }
    await until('document.querySelectorAll(".watchface-editor canvas").length > 0');
    for (const [width, height] of [[1180, 780], [1440, 950], [1920, 1080]]) {
      win.setSize(width, height);
      await new Promise(r => setTimeout(r, 200));
      const layout = await js(`(() => {
        const stage = document.querySelector('.wf-stage').getBoundingClientRect();
        const dial = document.querySelector('.watchface-editor-device').getBoundingClientRect();
        const toolbar = document.querySelector('.wf-stage-toolbar').getBoundingClientRect();
        const controls = [...document.querySelectorAll('.wf-stage-toolbar button, .wf-stage-toolbar select')]
          .map(el => el.getBoundingClientRect()).filter(rect => rect.width && rect.height);
        return {
          dialFits: dial.left >= stage.left && dial.right <= stage.right && dial.top >= stage.top && dial.bottom <= toolbar.top,
          controlsFit: controls.every(rect => rect.left >= toolbar.left && rect.right <= toolbar.right + 1),
          controlsOverlap: controls.some((a, i) => controls.slice(i + 1).some(b =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))
        };
      })()`);
      assert(layout.dialFits, `Fit preview stays above controls and inside stage at ${width}×${height}`);
      assert(layout.controlsFit, `Preview controls stay inside toolbar at ${width}×${height}`);
      assert(!layout.controlsOverlap, `Preview controls do not overlap at ${width}×${height}`);
    }
    win.setSize(1440, 1050);
    await new Promise(r => setTimeout(r, 500));
    await fs.writeFile(path.join(temp, "editor.png"), (await win.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(temp, "document.json"), JSON.stringify(doc, null, 2));
    console.log(`Official editor (${sourceName}): palette/alpha, source retention, real service download/open, editable clock/date, Current/AOD rendering, stamina/battery recovery, archive validation and project save passed. Artifacts: ${temp}`);
  } finally { clearTimeout(watchdog); win?.destroy(); await vite.close(); }
}
main().then(() => app.exit(0)).catch(e => { console.error(e); app.exit(1); });
