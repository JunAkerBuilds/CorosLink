const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
app.setPath("userData", path.join(os.tmpdir(), `coroslink-status-test-${process.pid}`));

async function statusFixtures() {
  const studio = await import("/src/watchfaces/watchfaceStudio.ts");
  const { composeWatchfaceReplacements, deriveDesignDetails } = await import("/src/watchfaces/watchfaceCompose.ts");
  const { makeDefaultDesign } = await import("/src/watchfaces/watchfaceBackground.ts");
  const { finalizeWatchfaceStatusIcons } = await import("/src/watchfaces/watchfaceStatusExport.ts");
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const png = (size, color) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    return { dataUrl: canvas.toDataURL(), width: size, height: size };
  };
  const assets = new Map();
  const details = { archiveId: "status-regression", resolutions: [800, 416].map(size => {
    const directory = `watchface_${size}x${size}`;
    const icon = { path: `${directory}/status.png`, ...png(12, "#0000ff") };
    assets.set(icon.path, icon);
    return { directory, width: size, height: size,
      config: { bluetooth_icon_pos: size === 800 ? "{121,593}" : "{63,308}",
        no_disturb_icon_pos: size === 800 ? "{182,593}" : "{94,308}",
        bluetooth_off_icon: "status.png", no_disturb_on_icon: "status.png" },
      aodConfig: {}, icons: [icon], spriteFolders: [] };
  }) };
  const load = async paths => paths.map(p => assets.get(p)).filter(Boolean);
  const results = [];
  for (const oversized of [false, true]) {
    const design = { ...makeDefaultDesign(), configAssetOverrides: {
      "config:bluetooth_off_icon": { enabled: false },
      "config:no_disturb_on_icon": { enabled: false },
      "config:airplane_icon": { replacement: png(oversized ? 1200 : 24, "#ff0000"), nativeSize: !oversized, scale: oversized ? 0.1 : 1 },
      "config:sleep_mode_icon": { replacement: png(oversized ? 1200 : 24, "#00ff00"), nativeSize: !oversized, scale: oversized ? 0.1 : 1 }
    }, layoutOffsets: oversized
      ? { bluetoothStatus: { dx: -641, dy: -800 }, doNotDisturbStatus: { dx: -270, dy: -497 } }
      : { bluetoothStatus: { dx: 20, dy: -100 }, doNotDisturbStatus: { dx: 100, dy: -200 } } };
    const before = JSON.stringify(design);
    const composition = await composeWatchfaceReplacements(details, design, load);
    const result = await finalizeWatchfaceStatusIcons(details, composition.assetReplacements,
      studio.mergeConfigOverrides(composition.configOverrides,
        studio.buildDisabledWatchfaceConfigAssetOverrides(details, design.configAssetOverrides)), load);
    if (JSON.stringify(design) !== before) throw new Error("export mutated the authored design");
    const exported = studio.applyConfigOverridesToDetails(details, result.configOverrides);
    const preview = deriveDesignDetails(details, design).previewDetails;
    const replacements = new Map(result.assetReplacements.map(asset => [asset.path, asset]));
    for (const resolution of exported.resolutions) {
      const config = resolution.config;
      const width = resolution.width;
      const previewResolution = preview.resolutions.find(r => r.width === width);
      const beforeCanvas = document.createElement("canvas");
      beforeCanvas.width = beforeCanvas.height = width;
      await studio.drawStudioPreview(beforeCanvas, png(width, "#000000").dataUrl,
        { ...details, resolutions: [previewResolution] },
        { fontFamily: "", digitColor: "#ffffff", accentColor: "#ffffff", tintLabels: false, tintIcons: false,
          previewComplication: "heartRate", configAssetOverrides: design.configAssetOverrides,
          nativeSpriteResolutionScale: width / 800 }, load);
      const afterCanvas = document.createElement("canvas");
      afterCanvas.width = afterCanvas.height = width;
      const context = afterCanvas.getContext("2d");
      context.fillStyle = "#000000";
      context.fillRect(0, 0, width, width);
      for (const [key, position] of [["airplane_icon", "bluetooth_icon_pos"], ["sleep_mode_icon", "no_disturb_icon_pos"]]) {
        const assetPath = `${resolution.directory}/${config[key].replaceAll("\\", "/")}`;
        const asset = replacements.get(assetPath) ?? assets.get(assetPath);
        const [x, y] = config[position].match(/-?\d+/g).map(Number);
        context.drawImage(await studio.loadStudioImage(asset.dataUrl), x, y);
      }
      const bounds = canvas => {
        const pixels = canvas.getContext("2d").getImageData(0, 0, width, width).data;
        return [0, 1].map(channel => {
          let x0 = width, y0 = width, x1 = -1, y1 = -1;
          for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            if (pixels[at + channel] > pixels[at + 1 - channel] + 100) {
              x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
            }
          }
          return [x0, y0, x1, y1];
        });
      };
      results.push({ oversized, width, config, previewBounds: bounds(beforeCanvas), exportedBounds: bounds(afterCanvas),
        files: [...assets.values(), ...result.assetReplacements].filter(a => a.path.startsWith(`${resolution.directory}/`)) });
    }
  }
  // Existing mode icons also need companions, independently in every tree.
  const mixed = { ...details, resolutions: details.resolutions.map(r => {
    const modes = { airplane_icon: "status.png", sleep_mode_icon: "status.png",
      bluetooth_icon_pos: "{30,40}", no_disturb_icon_pos: "{230,40}" };
    return { ...r, config: { ...(r.width === 800 ? r.config : {}), ...modes }, aodConfig: modes };
  }) };
  const mixedExport = await finalizeWatchfaceStatusIcons(mixed, [], [], load);
  const mixedDetails = studio.applyConfigOverridesToDetails(mixed, mixedExport.configOverrides);
  check(mixedDetails.resolutions[0].config.bluetooth_off_icon === "status.png", "retain visible master Bluetooth artwork");
  check(mixedDetails.resolutions[0].config.no_disturb_on_icon === "status.png", "retain visible master DND artwork");
  check(Boolean(mixedDetails.resolutions[1].config.bluetooth_off_icon), "a master companion cannot supply the smaller resolution's position");
  for (const r of mixedDetails.resolutions) {
    check(Boolean(r.aodConfig.bluetooth_off_icon && r.aodConfig.no_disturb_off_icon), "AOD needs its own companions");
  }
  for (const asset of mixedExport.assetReplacements) {
    const image = await studio.loadStudioImage(asset.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    check(image.naturalWidth === 1 && image.naturalHeight === 1 && context.getImageData(0, 0, 1, 1).data[3] === 0, "companions must stay invisible");
  }
  const repeated = await finalizeWatchfaceStatusIcons(mixed, mixedExport.assetReplacements, mixedExport.configOverrides, load);
  check(JSON.stringify(repeated) === JSON.stringify(mixedExport), "finalization must be idempotent");
  const disabled = await finalizeWatchfaceStatusIcons({ ...mixed, resolutions: [mixed.resolutions[1]] }, [],
    ["config", "AODconfig"].map(name => ({ path: `watchface_416x416/${name}.txt`, values: {
      airplane_icon: "__COROSLINK_DELETE_CONFIG_KEY__", sleep_mode_icon: "__COROSLINK_DELETE_CONFIG_KEY__"
    } })), load);
  check(disabled.assetReplacements.length === 0, "disabled mode icons must not synthesize companions");
  const shared = { ...details, resolutions: [{ ...details.resolutions[1], config: {
    ...details.resolutions[1].config, bluetooth_icon_pos: "{-5,40}", airplane_icon: "status.png"
  } }] };
  const sharedExport = await finalizeWatchfaceStatusIcons(shared, [], [], load);
  const sharedConfig = studio.applyConfigOverridesToDetails(shared, sharedExport.configOverrides).resolutions[0].config;
  check(sharedConfig.no_disturb_on_icon === "status.png", "clipping Bluetooth must not change DND's shared source PNG");
  check(sharedExport.assetReplacements.every(a => a.path !== "watchface_416x416/status.png"), "clipping must isolate shared artwork");
  for (const asset of sharedExport.assetReplacements) {
    const image = await studio.loadStudioImage(asset.dataUrl);
    check(image.naturalWidth === 7 && image.naturalHeight === 12, "clip the same five columns from both Bluetooth states");
  }
  return results;
}

(async () => {
  let vite, window;
  let exitCode = 0;
  try {
    await app.whenReady();
    const { createServer } = await import("vite");
    vite = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false }, logLevel: "error",
      plugins: [{ name: "status-test", configureServer(server) {
        server.middlewares.use("/__status_test", (_, res) => { res.setHeader("Content-Type", "text/html"); res.end("<html><body></body></html>"); });
      } }] });
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__status_test`);
    const cases = await window.webContents.executeJavaScript(`(${statusFixtures.toString()})()`);
    const { compileWatchface } = require("../dist-electron/watchfaceCompiler/compiler.js");
    for (const fixture of cases) {
      const label = `${fixture.width}px ${fixture.oversized ? "oversized" : "native"} artwork`;
      assert.ok(fixture.config.bluetooth_off_icon, `${label}: hidden Bluetooth needs a transparent position companion`);
      assert.ok(fixture.config.no_disturb_off_icon, `${label}: hidden DND needs a transparent position companion`);
      assert.equal(fixture.config.no_disturb_on_icon, undefined, "hidden DND artwork must stay hidden");
      assert.deepEqual(fixture.exportedBounds, fixture.previewBounds, `${label}: visible artwork must remain where Studio draws it`);
      assert.notDeepEqual(fixture.previewBounds[0], fixture.previewBounds[1], "the two icons must move independently");
      for (const key of ["bluetooth_icon_pos", "no_disturb_icon_pos"]) {
        assert.doesNotMatch(fixture.config[key], /-/, `${label}: the compiler must not receive negative positions`);
      }
      if (fixture.width !== 416) continue;
      const files = new Map(fixture.files.map(a => [a.path, Buffer.from(a.dataUrl.split(",")[1], "base64")]));
      files.set("info.json", Buffer.from("{}"));
      files.set("watchface_416x416/config.txt", Buffer.from(Object.entries(fixture.config).map(([k, v]) => `[${k}]=${v}`).join("\n")));
      const { bin, warnings } = compileWatchface(files, { faceId: 1 });
      assert.deepEqual(warnings, [], `${label}: status export compiles without missing images or negative coordinates`);
      for (const [key, offset, icon] of [["bluetooth_icon_pos", 0x26, 0x56], ["no_disturb_icon_pos", 0x42, 0x52]]) {
        assert.deepEqual([bin.readInt32LE(offset), bin.readInt32LE(offset + 4)], fixture.config[key].match(/\d+/g).map(Number), `${label}: firmware position survives compilation`);
        assert.ok(bin.readUInt32LE(icon), `${label}: mode icon survives compilation`);
      }
    }
    console.log("Status icons: independent positions, hidden companions, preview/export pixels and compiled coordinates passed.");
  } catch (error) { console.error(error); exitCode = 1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
