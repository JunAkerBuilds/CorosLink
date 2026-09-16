const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(os.tmpdir(), `coroslink-route-pages-${process.pid}`);
app.setPath("userData", path.join(temporaryRoot, "user-data"));
app.on("window-all-closed", () => {});

async function until(read, accept, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const { build } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const database = require("../dist-electron/database.js");
  const service = require("../dist-electron/mapService.js");
  const db = database.initializeDatabase(app.getPath("userData"));
  const detailRequests = [];
  let failPage = false;
  let delayedId;
  let window;
  const originalOpen = dialog.showOpenDialog;
  const watchdog = setTimeout(() => app.exit(1), 90_000);
  try {
    for (let index = 0; index < 41; index += 1) {
      database.addGeneratedRoute(service.buildRouteFromGpxContent(
        '<gpx><trk><trkseg><trkpt lat="43.6" lon="-79.4"/><trkpt lat="43.62" lon="-79.42"/></trkseg></trk></gpx>',
        `Saved route ${index + 1}`, "running"
      ));
    }
    ipcMain.handle("maps:listGeneratedRoutes", (_event, offset) => {
      if (failPage) { failPage = false; throw new Error("Test page load failure"); }
      return service.listGeneratedRoutes(offset);
    });
    ipcMain.handle("maps:getGeneratedRoute", async (_event, id) => {
      detailRequests.push(id);
      const route = service.getGeneratedRouteDetails(id);
      if (id === delayedId) await new Promise(resolve => setTimeout(resolve, 200));
      return route;
    });
    ipcMain.handle("maps:deleteGeneratedRoute", (_event, id) => service.deleteGeneratedRoute(id));
    ipcMain.handle("maps:importRouteGpx", () => service.importRouteFromGpx());
    ipcMain.handle("maps:getRouteBuilderConfig", () => ({ backend: "keyless", openRouteServiceApiKey: "" }));
    ipcMain.handle("trainingHub:getActivityPaceBaselines", () => ({}));
    ipcMain.handle("maps:stopRouteShare", () => undefined);

    // Build a local fixture: no dev server, external requests, or real user data.
    const outDir = path.join(temporaryRoot, "dist");
    await build({ root, base: "./", configFile: false, plugins: [react()], logLevel: "error",
      build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(root, "scripts/fixtures/saved-routes.html") } }
    });
    window = new BrowserWindow({ show: false, width: 1100, height: 850,
      webPreferences: { preload: path.join(root, "dist-electron/preload.js"), sandbox: false, contextIsolation: true, backgroundThrottling: false }
    });
    window.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
    const js = code => window.webContents.executeJavaScript(code, true);
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click(); void 0;`);
    const pageText = () => js('document.querySelector(".route-drawer-pagination [role=status]")?.textContent');
    const page = async expected => {
      await until(pageText, value => value === expected, expected);
      assert.ok(await js('document.querySelectorAll(".route-drawer-list li").length <= 20'));
    };
    await window.loadFile(path.join(outDir, "scripts/fixtures/saved-routes.html"));
    await page("1–20 of 41");
    await until(() => detailRequests.length, value => value === 1, "initial preview");
    await click('.route-saved-toggle:not(.route-import-toggle)');
    assert.equal(await js('document.querySelector(".route-drawer-pagination button:first-child").disabled'), true);
    await click('.route-drawer-pagination button:last-child');
    await page("21–40 of 41");
    await click('.route-drawer-pagination button:last-child');
    await page("41–41 of 41");
    assert.equal(detailRequests.length, 1, "page changes must not load geometry");
    assert.equal(await js('document.querySelector(".route-drawer-pagination button:last-child").disabled'), true);
    await click('.route-card-main');
    await until(() => js('document.querySelector(".route-drawer").classList.contains("is-open")'), value => !value, "older route selection");
    assert.equal(detailRequests.length, 2);
    await click('.route-saved-toggle:not(.route-import-toggle)');
    assert.equal(await js('document.querySelectorAll(".route-drawer-list li.is-active").length'), 1);
    await click('.route-card-actions .danger');
    await click('.route-card-confirm-delete');
    await page("21–40 of 40");
    assert.equal(await js('document.querySelectorAll(".route-drawer-list li.is-active").length'), 0);
    assert.equal(await js('document.querySelector(".route-saved-toggle .badge").textContent'), "40");

    failPage = true;
    await click('.route-drawer-pagination button:first-child');
    await until(() => js('document.querySelector("[data-test=error]").textContent'), value => value.includes("Test page load failure"), "page error feedback");
    await page("21–40 of 40");
    await click('.route-drawer-pagination button:first-child');
    await page("1–20 of 40");

    // A slower prior selection cannot replace the newer preview.
    const summaries = service.listGeneratedRoutes().routes;
    delayedId = summaries[0].id;
    await js('const rows = document.querySelectorAll(".route-card-main"); rows[0].click(); rows[1].click(); void 0;');
    await until(() => js('document.querySelector(".route-drawer").classList.contains("is-open")'), value => !value, "latest selection");
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await js('document.querySelector(".route-drawer-list li.is-active .route-card-name").textContent'), summaries[1].name);

    const importPath = path.join(temporaryRoot, "import.gpx");
    await fs.writeFile(importPath, '<gpx><trk><trkseg><trkpt lat="43.6" lon="-79.4"/><trkpt lat="43.62" lon="-79.42"/></trkseg></trk></gpx>');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [importPath, importPath] });
    await click('.route-saved-toggle:not(.route-import-toggle)');
    await click('.route-drawer-pagination button:last-child');
    await page("21–40 of 40");
    await click('.route-import-toggle');
    await page("1–20 of 42");
    assert.equal(await js('document.querySelector(".route-saved-toggle .badge").textContent'), "42");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(await js(`(() => {
      const nav = document.querySelector('.route-drawer-pagination').getBoundingClientRect();
      const drawer = document.querySelector('.route-drawer').getBoundingClientRect();
      return nav.width > 0 && nav.height > 0 && nav.bottom <= drawer.bottom && nav.right <= innerWidth;
    })()`), "pagination controls remain visible below the scrolling list");
    const screenshot = path.join(os.tmpdir(), "coroslink-saved-routes-pagination.png");
    window.webContents.invalidate();
    await fs.writeFile(screenshot, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    console.log(`Saved-route UI passed: bounded DOM, all pages, lazy previews, deletion, failed page recovery, selection races, import refresh. Screenshot: ${screenshot}`);
  } finally {
    clearTimeout(watchdog);
    dialog.showOpenDialog = originalOpen;
    window?.destroy();
    db.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
