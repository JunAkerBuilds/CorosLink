// Isolated UI integration test: real preload, IPC, BLE owner and settings service;
// only the watch exchange and save dialog are simulated. No physical BLE is used.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { app, BrowserWindow, ipcMain } = require("electron");
const { registerCorosActivityScreenIpc } = require("../dist-electron/corosActivityScreenIpc");
const temporary = path.join(os.tmpdir(), `coros-activity-screens-ui-${process.pid}`);
app.setPath("userData", path.join(temporary, "user-data"));
app.on("window-all-closed", () => {});

function capturedPages() {
  return Buffer.concat([Buffer.from([0, 3]), ...[0x94, 0xa6, 0xb7].map((header, page) => {
    const bytes = Buffer.alloc(44); bytes[0] = header; bytes.writeUInt16LE(21, 2);
    for (let i = 0; i < 12; i++) bytes.writeUInt16LE((10 + page * 20 + i) << 6, 4 + i * 2);
    for (let i = 28; i < 44; i++) bytes[i] = page + i;
    return bytes;
  })]);
}
async function main() {
  await app.whenReady();
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const vite = await createServer({ root: path.resolve(__dirname, ".."), configFile: false, plugins: [react()],
    cacheDir: path.join(temporary, "vite"), server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  const webPreferences = { preload: path.resolve("dist-electron/preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true };
  const win = new BrowserWindow({ show: false, width: 1024, height: 1100, webPreferences });
  let otherWindow;
  const errors = [], writes = [], calls = [], original = capturedPages();
  let payload = Buffer.from(original), packaged = false, mismatch = false, held;
  const filename = path.resolve("dist-electron/corosNativeBleService.js"), nativeRequire = createRequire(filename), exports = {};
  vm.runInNewContext(await fs.readFile(filename, "utf8"), {
    exports, Buffer, process, clearTimeout, setTimeout,
    require(id) {
      if (id === "electron") return { app: { get isPackaged() { return packaged; }, getAppPath: () => process.cwd(), getPath: () => path.join(temporary, "user-data") }, safeStorage: { isEncryptionAvailable: () => true } };
      if (id === "./database") return { getSetting: () => undefined, setSetting: () => {} };
      return nativeRequire(id);
    }
  }, { filename });
  const native = new exports.CorosNativeBleService();
  native.state = { phase: "connected", transport: "corebluetooth", available: true, connected: true, encrypted: true, systemBind: "authenticated", channels: [],
    deviceName: "COROS PACE Pro TEST", deviceId: "fixture-watch", serialNumber: "fixture-serial", modelNumber: "COROS W332", firmwareRevision: "3.2008.0", authenticatedAt: 1 };
  native.controlCommand = async (opcode, sent) => {
    calls.push({ opcode, payload: Buffer.from(sent) });
    if (held) { const wait = held; held = null; await wait; }
    if (opcode === 0x9e) return sent[0] === 255 ? Buffer.from([0, 1, 64]) : Buffer.from(payload);
    assert.equal(opcode, 0x9f);
    const directory = path.join(temporary, "user-data", "activity-screen-backups");
    const journal = JSON.parse(await fs.readFile(path.join(directory, "pending-restore.json"), "utf8"));
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, `${journal.backupId}.json`), "utf8")).version, 1);
    writes.push(Buffer.from(sent)); payload = Buffer.from(sent);
    if (mismatch) payload[6] ^= 64;
    return Buffer.from([1]);
  };
  const exportPath = path.join(temporary, "export.json");
  registerCorosActivityScreenIpc({ ipc: ipcMain, isPackaged: () => packaged, api: native,
    owner(event) {
      if (BrowserWindow.fromWebContents(event.sender) !== win || event.senderFrame !== win.webContents.mainFrame) throw new Error("Use activity-screen sync from CorosLink's main window.");
      return win;
    }, saveDialog: async () => ({ canceled: false, filePath: exportPath }) });
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  ipcMain.handle("app:setLanguage", () => undefined);
  const js = expression => win.webContents.executeJavaScript(expression, true).catch(error => { throw new Error(`${expression}: ${error.message}`); });
  async function until(expression) {
    for (let i = 0; i < 100; i++) { if (await js(`!!(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error(`Timed out: ${expression}; renderer errors: ${errors.join("; ")}; body: ${await js("document.body.innerText")}`);
  }
  const button = label => `[...document.querySelectorAll('.activity-screens button')].find(button=>button.textContent.trim()===${JSON.stringify(label)})`;
  const click = label => js(`${button(label)}.click(); void 0`);
  const select = (label, value) => js(`(()=>{const select=document.querySelector('select[aria-label=${JSON.stringify(label)}]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(String(value))});
    select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const idle = () => until("document.querySelector('.activity-screens')?.getAttribute('aria-busy')==='false'");
  const experimentalDisabled = count => js(`document.querySelector('select[aria-label="Activity page field count"] option[value="${count}"]').disabled`);
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/coros-activity-screens.html`);
    await until("document.querySelector('.activity-screens')");
    await idle();
    assert.equal(calls.length, 0, "mount reads local recovery metadata only");
    await click("Read pages"); await until("document.querySelectorAll('.activity-screen-pages > button').length===3"); await idle();
    assert.equal(writes.length, 0, "discovery has no watch write");
    await js(`import('/src/i18n/locale.ts').then(module => module.setLanguage('zh-CN'))`);
    await until(`document.querySelector('#activity-screens-title').textContent === '活动数据页'`);
    assert.equal(await js(`document.querySelectorAll('.activity-screen-pages > button').length`), 3, 'language switch retains captured pages');
    assert.equal(writes.length, 0, 'language switch sends no watch writes');
    await js(`import('/src/i18n/locale.ts').then(module => module.setLanguage('en'))`);
    await until(`document.querySelector('#activity-screens-title').textContent === 'Activity screens'`);
    assert.equal(await js(`${button("Preview layout")}.disabled`), true);
    assert.equal(await experimentalDisabled(5), true); assert.equal(await experimentalDisabled(7), true);
    assert.equal(await experimentalDisabled(9), true);

    let release; held = new Promise(resolve => { release = resolve; });
    await click("Sync unchanged pages"); await until("document.querySelector('.activity-screens').getAttribute('aria-busy')==='true'");
    await click("Sync unchanged pages");
    release(); await until("document.querySelector('.activity-baseline-state')?.textContent==='Baseline read-back verified'"); await idle();
    assert.equal(writes.length, 1, "double click cannot write twice");
    assert.deepEqual(writes[0], original, "UI baseline sends the captured records unchanged");
    assert.equal(await experimentalDisabled(5), true, "read-back alone does not confirm the display");
    assert.equal(await experimentalDisabled(9), true);
    await click("I checked the watch — baseline matches"); await until("document.querySelector('.activity-baseline-state')?.textContent==='Baseline confirmed on watch'"); await idle();
    assert.equal(writes.length, 1, "human confirmation is read-only");
    assert.equal(await experimentalDisabled(5), false); assert.equal(await experimentalDisabled(7), false);
    assert.equal(await experimentalDisabled(9), false);
    await js(`activityFixture.api={...corosLink,getCorosActivityScreenStatus:async()=>{const status=await corosLink.getCorosActivityScreenStatus();return {...status,supportedFieldCounts:undefined};}};activityFixture.render();void 0`);
    await until("document.querySelector('.activity-screens').textContent.includes('Restart the development app to load nine-field sync support')");
    assert.equal(await experimentalDisabled(9), true, "legacy main process cannot offer the new nine-field write");
    await js("activityFixture.api=corosLink;activityFixture.render();void 0");
    await until("!document.querySelector('.activity-screens').textContent.includes('Restart the development app to load nine-field sync support')");
    assert.equal(await experimentalDisabled(9), false);
    const baselineBackupId = await js(`document.querySelector('select[aria-label="Activity-page backup"]').value`);

    for (const count of [5, 7, 9]) {
      if (count === 9) {
        await select("Activity-page backup", baselineBackupId); await click("Restore backup");
        await until("document.querySelector('.activity-baseline-state')?.textContent==='Baseline not verified'"); await idle();
        await click("Sync unchanged pages");
        await until("document.querySelector('.activity-baseline-state')?.textContent==='Baseline read-back verified'"); await idle();
        await click("I checked the watch — baseline matches");
        await until("document.querySelector('.activity-baseline-state')?.textContent==='Baseline confirmed on watch'"); await idle();
      }
      await select("Activity page field count", count); await click("Preview layout");
      await until(`document.querySelector('.activity-screen-preview')?.textContent.includes('${count} fields')`); await idle();
      const before = writes.length;
      assert.equal(await js("document.querySelectorAll('.activity-screen-preview .activity-dial-row span').length"), count - 1);
      await click("Sync preview"); await until(`document.querySelector('.activity-screen-pages > button')?.textContent.includes('${count} fields')`); await idle();
      assert.equal(writes.length, before + 1);
      assert.deepEqual(payload.subarray(46), original.subarray(46), "other pages are preserved");
    }
    await select("Activity-page backup", baselineBackupId); await click("Restore backup");
    await until("document.querySelector('.activity-baseline-state')?.textContent==='Baseline not verified'"); await idle();
    assert.deepEqual(payload, original, "restore through UI, preload, IPC and service is exact");
    assert.equal(await experimentalDisabled(7), true);
    assert.equal(await experimentalDisabled(9), true);
    await click("Export JSON"); await until("document.querySelector('.watch-link-note')?.textContent.includes('exported')"); await idle();
    assert.equal(JSON.parse(await fs.readFile(exportPath, "utf8")).payloadHex, original.toString("hex"));

    mismatch = true; await click("Sync unchanged pages");
    await until("document.querySelector('.activity-screen-recovery')"); await idle();
    assert.equal(await js("!!document.querySelector('.activity-screen-pages')"), false, "failed writes invalidate captured UI state");
    assert.match(await js("document.querySelector('.watch-link-note.is-error').textContent"), /read-back differs/);
    mismatch = false; await click("Restore interrupted sync");
    await until("!document.querySelector('.activity-screen-recovery') && document.querySelector('.activity-screen-pages')"); await idle();
    assert.deepEqual(payload, original);

    await js("activityFixture.snapshot={...activityFixture.snapshot,connected:false,phase:'disconnected',authenticatedAt:null}; activityFixture.render(); void 0");
    await until(`${button("Read pages")}.disabled && !document.querySelector('.activity-screen-pages')`);
    await js("activityFixture.api={};activityFixture.render();void 0");
    await until("document.querySelector('.activity-screens').textContent.includes('Restart the development app')");
    assert.equal(await js(`${button("Read pages")}.disabled`), true, "old preload cannot offer writes");

    // All eleven real handlers reject release builds, before reaching the watch.
    const beforeRelease = calls.length; packaged = true;
    for (const [method, argument] of [
      ["getCorosActivityScreenStatus"], ["listCorosActivityScreenSports"], ["readCorosActivityScreens", 0], ["getCorosActivityScreenBackups"],
      ["backupCorosActivityScreens", {}], ["syncCorosActivityScreenBaseline", {}], ["confirmCorosActivityScreenBaseline", {}],
      ["previewCorosActivityScreenLayout", {}], ["applyCorosActivityScreenLayout", {}], ["restoreCorosActivityScreens", {}], ["exportCorosActivityScreenBackup", {}]
    ]) {
      assert.match(await js(`corosLink.${method}(${argument === undefined ? "" : JSON.stringify(argument)}).then(()=>"unexpected success",error=>error.message)`), /development builds/);
    }
    assert.equal(calls.length, beforeRelease); packaged = false;
    otherWindow = new BrowserWindow({ show: false, webPreferences }); await otherWindow.loadURL("about:blank");
    assert.match(await otherWindow.webContents.executeJavaScript('corosLink.readCorosActivityScreens(0).then(()=>"unexpected success",error=>error.message)'), /main window/);
    await win.setSize(430, 1100); await js("activityFixture.api=corosLink;activityFixture.render();void 0");
    await until("document.querySelector('.activity-screen-backups')");
    assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"), true, "panel fits a narrow window");
    await fs.mkdir(path.resolve(".work/activity-screen-test"), { recursive: true });
    await fs.writeFile(path.resolve(".work/activity-screen-test/panel.png"), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    assert.deepEqual(await js("activityFixture.busy.every((value,index)=>value===(index%2===0))"), true);
    console.log("Activity-screen UI → real preload → IPC → BLE owner → settings service passed: unchanged baseline, human confirmation, 5/7/9 layouts, backup/restore, recovery, export, duplicate-click, reconnect, release and window gates.");
  } finally {
    otherWindow?.destroy(); win.destroy(); await vite.close(); await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
