// The main window stays on CorosLink's own page, and the IPC that writes to the
// watch, local data or the data mode answers only that page: a dropped file or
// link (or any other navigation the page didn't ask for) would otherwise get
// the whole preload API. Nothing here touches the network: web links are
// handed to a stub instead of the browser. Run with:
//   npm run build:electron && electron scripts/test-security-electron.cjs
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain } = require("electron");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-security-electron-"));
app.setPath("userData", path.join(work, "profile"));
// Removed once this process has exited and Chromium has stopped writing to the profile.
spawn(process.execPath, ["-e", `
  const fs = require("node:fs");
  const timer = setInterval(() => {
    try { process.kill(${process.pid}, 0); return; } catch {}
    clearInterval(timer);
    try { fs.rmSync(${JSON.stringify(work)}, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }, 100);
  setTimeout(() => process.exit(0), 60000).unref();
`], { detached: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).unref();
const dist = (file) => path.join(__dirname, "..", "dist-electron", file);
const { confineMainWindow, isAppPageUrl, requireMainWindowSender } = require(dist("mainWindowGuard.js"));
const { registerCorosWatchKeyBackupIpc } = require(dist("corosWatchKeyBackupIpc.js"));

let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) console.error(error);
  else console.log("security electron: the main window can't be navigated away, and watch-write IPC answers only CorosLink's page");
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
setTimeout(() => finish(new Error("security electron: timed out")), 30_000).unref();

const page = (name, body) => {
  const file = path.join(work, name);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${name}</title><body>${body}</body>`);
  return file;
};
const preload = path.join(work, "preload.js");
fs.writeFileSync(preload, `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("probe", { write: () => ipcRenderer.invoke("probe:write"),
  backupKey: () => ipcRenderer.invoke("watchfaces:backupWatchKey", { passphrase: "correct horse battery" }),
  chooseKey: () => ipcRenderer.invoke("watchfaces:chooseWatchKeyBackup"),
  restoreKey: () => ipcRenderer.invoke("watchfaces:restoreWatchKey", { passphrase: "correct horse battery" }) });`);

app.whenReady().then(async () => {
  const index = page("index.html", "CorosLink");
  const dropped = page("dropped.html", "a file the user dropped on the window");
  const appPage = pathToFileURL(index).href;

  // The URL rule on its own.
  assert.equal(isAppPageUrl(`${appPage}?tab=watch#sync`, appPage), true);
  assert.equal(isAppPageUrl(pathToFileURL(dropped).href, appPage), false);
  assert.equal(isAppPageUrl("https://example.invalid/", appPage), false);
  assert.equal(isAppPageUrl("http://localhost:5173/settings", "http://localhost:5173/"), true);
  assert.equal(isAppPageUrl("http://localhost:5174/", "http://localhost:5173/"), false);
  assert.equal(isAppPageUrl("not a url", appPage), false);

  const webPreferences = { preload, contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true };
  const main = new BrowserWindow({ show: false, webPreferences });
  let current = main;
  ipcMain.handle("probe:write", (event) => {
    requireMainWindowSender(event, current, "refused");
    return "ok";
  });
  const opened = [];
  confineMainWindow(main.webContents, appPage, (url) => opened.push(url));
  await main.loadFile(index);
  const write = (window) => window.webContents.executeJavaScript("window.probe.write().then(() => 'ok', () => 'refused')");
  assert.equal(await write(main), "ok", "CorosLink's own page may write");

  // The watch key backup IPC uses the same sender check, before any dialog opens or the key is read.
  const keyCalls = [];
  registerCorosWatchKeyBackupIpc({
    ipc: ipcMain, owner: (event) => requireMainWindowSender(event, current, "refused"),
    service: {
      status: () => ({ watchKey: { keyId: "7EDA" } }),
      createBackup: async () => { keyCalls.push("createBackup"); return { data: Buffer.alloc(64), keyId: "7EDA" }; },
      openBackup: async () => { keyCalls.push("openBackup"); throw new Error("Wrong passphrase or damaged file."); },
      saveRestored: () => { keyCalls.push("saveRestored"); }
    },
    saveDialog: async () => { keyCalls.push("saveDialog"); return { canceled: true }; },
    openDialog: async () => { keyCalls.push("openDialog"); return { canceled: true, filePaths: [] }; },
    confirm: async () => { keyCalls.push("confirm"); return 0; },
    text: (source) => source, notice: () => keyCalls.push("notice")
  });
  const keyProbe = (window, call) => window.webContents.executeJavaScript(`window.probe.${call}().then(value => JSON.stringify(value), error => 'refused: ' + error.message)`);
  assert.equal(await keyProbe(main, "backupKey"), JSON.stringify({ saved: false }), "the main window may back up the key");
  assert.equal(await keyProbe(main, "chooseKey"), JSON.stringify({ chosen: false }));
  assert.deepEqual(keyCalls, ["saveDialog", "openDialog"]);

  // The page (or a drop, which Chromium turns into the same navigation) tries to leave.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
  await main.webContents.executeJavaScript(`location.href = ${JSON.stringify(pathToFileURL(dropped).href)}; true`);
  await settle();
  assert.equal(main.webContents.getURL(), appPage, "a local file never replaces the app");
  await main.webContents.executeJavaScript("location.href = 'https://example.invalid/upload'; true");
  await settle();
  assert.equal(main.webContents.getURL(), appPage, "a web page never replaces the app");
  assert.deepEqual(opened, ["https://example.invalid/upload"], "web links open in the browser instead; files don't open at all");
  assert.equal(await write(main), "ok");

  // A <webview> asking for Node and a preload (as an injected script could) gets neither.
  const guestPreload = path.join(work, "guest-preload.js");
  fs.writeFileSync(guestPreload, `require("electron").contextBridge.exposeInMainWorld("privileged", true);`);
  const attached = new Promise((resolve) => main.webContents.once("did-attach-webview", (_event, guest) => resolve(guest)));
  await main.webContents.executeJavaScript(`(() => {
    const view = document.createElement("webview");
    view.setAttribute("nodeintegration", "");
    view.setAttribute("webpreferences", "contextIsolation=no, nodeIntegration=yes");
    view.setAttribute("preload", ${JSON.stringify(pathToFileURL(guestPreload).href)});
    view.setAttribute("src", "data:text/html,<p>guest</p>");
    document.body.appendChild(view);
    return true;
  })()`);
  const guest = await attached;
  await new Promise((resolve) => guest.once("did-finish-load", resolve));
  assert.deepEqual(await guest.executeJavaScript("({ node: typeof require, process: typeof process, preload: typeof window.privileged })"),
    { node: "undefined", process: "undefined", preload: "undefined" });

  // Another window, or the main window showing anything but the app (as a navigation that got through would), is refused.
  const other = new BrowserWindow({ show: false, webPreferences });
  await other.loadFile(index);
  assert.equal(await write(other), "refused", "only the main window");
  for (const call of ["backupKey", "chooseKey", "restoreKey"]) assert.match(await keyProbe(other, call), /refused/, `watch key ${call} from another window`);
  current = other;
  await other.loadFile(dropped);
  assert.equal(await write(other), "refused", "only CorosLink's page in it");
  for (const call of ["backupKey", "chooseKey", "restoreKey"]) assert.match(await keyProbe(other, call), /refused/, `watch key ${call} from another page`);
  assert.deepEqual(keyCalls, ["saveDialog", "openDialog"], "a refused sender never reaches a dialog or the key");

  other.destroy();
  main.destroy();
}).then(() => finish(), finish);
