const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, clipboard, ipcMain } = require("electron");

const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(os.tmpdir(), `coroslink-diagnostics-ui-${process.pid}`);
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
  const react = (await import("@vitejs/plugin-react")).default;
  const { initializeDiagnostics, handleDiagnosticIpc } = require("../dist-electron/diagnosticsService.js");
  const database = require("../dist-electron/database.js");
  const settings = new Map();
  database.getSetting = (key) => settings.get(key);
  database.setSetting = (key, value) => settings.set(key, value);
  const { loginCorosWatchfaces } = require("../dist-electron/corosWatchfaceService.js");
  let window;
  let vite;
  const originalFetch = globalThis.fetch;
  const originalClipboardWrite = clipboard.writeText;
  const oldClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  let clipboardChanged = false;
  const watchdog = setTimeout(() => app.exit(1), 90_000);
  try {
    initializeDiagnostics(() => window);
    const calendar = () => ({ connected: false, configured: true, autoSync: false });
    for (const [channel, handler] of Object.entries({
      "app:getInfo": () => ({ version: "0.1.test", platform: process.platform, arch: process.arch, electronVersion: process.versions.electron, nodeVersion: process.versions.node, chromeVersion: process.versions.chrome, storageLocations: [] }),
      "watchfaceAutomation:status": () => ({ enabled: false, running: false }),
      "appleCalendar:status": calendar,
      "googleCalendar:status": calendar
    })) ipcMain.handle(channel, handler);
    handleDiagnosticIpc("watchfaces:login", (_event, email, password, region) => loginCorosWatchfaces(email, password, region));
    vite = await createServer({ root, configFile: false, plugins: [react()], cacheDir: path.join(temporaryRoot, "vite-cache"), server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false }, logLevel: "error" });
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 1040, height: 920, webPreferences: { preload: path.join(root, "dist-electron/preload.js"), sandbox: false, contextIsolation: true, backgroundThrottling: false } });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const report = () => js('document.querySelector(".diagnostics-preview textarea")?.value');
    const click = (label) => js(`Array.from(document.querySelectorAll('.diagnostics-settings button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click(); void 0;`);
    const loaded = () => until(() => js('Boolean(document.querySelector(".diagnostics-settings button:not(:disabled)"))'), Boolean, "diagnostics ready");
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/diagnostics.html`);
    await loaded();
    assert.match(await report(), /No errors recorded/);
    assert.equal(await js('document.querySelector(".settings-view").lastElementChild.classList.contains("diagnostics-settings")'), true, "diagnostics is at the bottom of Settings");

    globalThis.fetch = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND apieu.coros.com"), { code: "ENOTFOUND", hostname: "apieu.coros.com" }) });
    };
    const loginError = await js('window.corosLink.loginCorosWatchfaces("private-input@example.com", "private-password", "eu").then(() => "unexpected success", error => error.message)');
    assert.match(loginError, /fetch failed/);
    globalThis.fetch = originalFetch;
    await click("Refresh");
    await until(report, (value) => value?.includes("ENOTFOUND"), "nested network error");
    assert.match(await report(), /https:\/\/apieu.coros.com\/coros\/user\/login/);
    assert.doesNotMatch(await report(), /private-input|private-password/);

    await js('window.dispatchEvent(new ErrorEvent("error", { error: new Error("Renderer failure for person@example.com") })); void 0;');
    await click("Refresh");
    await until(report, (value) => value?.includes("renderer:error"), "renderer error");
    assert.doesNotMatch(await report(), /person@example.com/);

    // A fresh page sees the same persisted errors through the real preload.
    const reloaded = new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
    window.webContents.reload();
    await reloaded;
    await loaded();
    await until(report, (value) => value?.includes("ENOTFOUND"), "logs after reload");
    await js('document.querySelector(".diagnostics-preview").open = true; document.querySelector(".diagnostics-settings").scrollIntoView(); void 0;');
    clipboardChanged = true;
    await click("Copy error report");
    await until(() => js('document.querySelector(".diagnostics-notice").textContent'), (value) => value.startsWith("Copied"), "clipboard copy");
    assert.equal(clipboard.readText(), await report(), "copied text matches the visible report");
    await js('document.querySelector(".diagnostics-preview").open = false; document.querySelector(".diagnostics-preview summary").click(); void 0;');
    assert.equal(await js('document.querySelector(".diagnostics-preview").open'), true, "report preview opens");
    window.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const imagePath = path.join(os.tmpdir(), "coroslink-diagnostics-settings.png");
    await fs.writeFile(imagePath, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());

    clipboard.writeText = () => { throw new Error("Clipboard unavailable"); };
    await click("Copy error report");
    await until(() => js('document.querySelector(".diagnostics-error")?.textContent'), (value) => value?.includes("select and copy"), "clipboard fallback");
    assert.match(await report(), /ENOTFOUND/);

    await click("Clear logs");
    await until(report, (value) => value?.includes("No errors recorded"), "clear logs");
    assert.equal((await js('window.corosLink.getDiagnostics()')).entryCount, 0);
    await assert.rejects(fs.access(path.join(app.getPath("userData"), "diagnostics", "errors.json")), /ENOENT/);
    console.log(`Diagnostics UI passed: Settings placement, real watchface IPC transport failure, renderer capture, reload, native clipboard, copy fallback, and persistent clear. Screenshot: ${imagePath}`);
  } finally {
    clearTimeout(watchdog);
    globalThis.fetch = originalFetch;
    clipboard.writeText = originalClipboardWrite;
    if (clipboardChanged) clipboard.write(oldClipboard);
    window?.destroy();
    await vite?.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
