const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const temp = path.join(os.tmpdir(), `coros-compile-ui-${process.pid}`);
app.setPath("userData", path.join(temp, "user-data"));
app.on("window-all-closed", () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const vite = await createServer({ root: path.resolve(__dirname, ".."), configFile: false, plugins: [react()],
    cacheDir: path.join(temp, "vite"), server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  const win = new BrowserWindow({ show: false, width: 1100, height: 1000 });
  const errors = [];
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  const js = async expression => {
    try { return await win.webContents.executeJavaScript(expression, true); }
    catch (error) { throw Error(`${expression}: ${error.message}; ${errors.join('; ')}`); }
  };
  async function until(expression) {
    for (let i = 0; i < 100; i++) { if (await js(`!!(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error(`Timed out: ${expression}; ${errors.join('; ')}`);
  }
  const find = text => `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const saveBin = "document.querySelector('.wf-send-install button[aria-label=\"Save BIN\"]')";
  const click = text => js(`${find(text)}.click(); void 0`);
  const install = "document.querySelector('.wf-send-actions .wf-send-watch')";
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/watchface-compile.html`);

    // With a watch link the footer offers Send to watch; Save BIN moves into the install card.
    await until(`${saveBin} && !${saveBin}.disabled`);
    assert.equal(await js(`!!${find('Save BIN')}`), false, 'the footer has no Save BIN text button');
    assert.equal(await js(`${install}.textContent.trim()`), 'Send to watch');

    // Save BIN compiles once, then saves through an opaque token.
    await js(`${saveBin}.click(); void 0`); await js(`${saveBin}.click(); void 0`);
    await until('compileFixture.calls.length===1');
    // Compiled for the watch Studio built the archive for.
    assert.deepEqual(await js('compileFixture.calls[0]'), {archiveId:'fixture-archive', name:'Fixture face', firmwareType:'COROS W332', fullColor:false, smoothEdges:false});
    assert.equal(await js(`${find('Send to COROS')}.disabled`), true);
    assert.equal(await js(`${find('Close')}.disabled`), true, 'the dialog stays open while compiling');
    assert.equal(await js("document.querySelector('[role=dialog]').getAttribute('aria-busy')"), 'true');
    await js("compileFixture.pending.resolve({id:'compiled-token',source:'compiled',name:'Fixture face',faceId:1234,bytes:12345,compile:{durationMs:420,warnings:['icon/am.png is missing.']}}); void 0");
    await until('compileFixture.saved.length===1');
    await until("!!document.querySelector('.wf-send-install .watch-compile-warnings')");
    assert.match(await js("document.querySelector('.wf-send-install .watch-compile-warnings').textContent"), /1 element won't show as designed.*icon\/am\.png is missing/);
    assert.deepEqual(await js('compileFixture.saved'), ['compiled-token']);
    await until(`!${saveBin}.disabled`);
    await js(`${saveBin}.click(); void 0`);
    await until('compileFixture.saved.length===2');
    assert.equal(await js('compileFixture.calls.length'), 1, 'an unchanged face reuses its compiled BIN');

    // Previewing another resolution does not block compiling the PACE Pro layout.
    await js("(()=>{const select=document.querySelector('select[aria-label=Resolution]');select.value='watchface_800x800';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await until("document.querySelector('.wf-send-caption').textContent.includes('800')");
    assert.equal(await js(`${saveBin}.disabled`), false);

    // Install on watch: compile (reused) → send → verify, into the first empty slot.
    await until(`document.querySelectorAll('.wf-send-install .watch-slot').length===10 && !${install}.disabled`);
    assert.equal(await js(`${install}.textContent.trim()`), 'Send to watch');
    assert.equal(await js(`${install}.title`), 'Install in empty slot 2');
    assert.match(await js("document.querySelector('.wf-send-install').textContent"), /Installs into empty slot 2\./);
    await js(`${install}.click(); ${install}.click(); void 0`);
    await until('compileFixture.syncCalls.length===1');
    assert.deepEqual(await js('compileFixture.syncCalls[0]'), {id:'compiled-token', target:{inventoryId:'inventory', slot:1, replaceExisting:false}});
    assert.equal(await js('compileFixture.calls.length'), 1, 'install reuses the compiled BIN');
    assert.equal(await js(`${find('Close')}.disabled`), true, 'the dialog stays open while installing');
    await js("compileFixture.syncStatus={phase:'transferring',sentBytes:6000,totalBytes:12345}; void 0");
    await until("document.querySelector('.wf-send-install .watch-install-progress')?.textContent.includes('49%')");
    assert.equal(await js(`${install}.textContent.trim()`), 'Installing…');
    await js("compileFixture.syncPending.resolve({phase:'complete',sentBytes:12345,totalBytes:12345,watchSlot:1,verification:'inventory-id'}); void 0");
    await until("document.querySelector('.wf-send-install .watch-link-note')?.textContent.includes('Installed in slot 2')");
    assert.match(await js("document.querySelector('.wf-send-install small').textContent"), /^Compiled in 0\.4 s\. Sends over Bluetooth/);
    await until(`!${find('Close')}.disabled`);

    // A changed archive compiles again; a result from the old archive is rejected.
    await js("compileFixture.archiveId='changed-archive';compileFixture.render();void 0");
    await until("compileFixture.assetReads.includes('changed-archive')");
    await until(`!${saveBin}.disabled`);
    await js(`${saveBin}.click(); void 0`);
    await until('compileFixture.calls.length===2');
    await js("compileFixture.archiveId='third-archive';compileFixture.render();void 0");
    await until("compileFixture.assetReads.includes('third-archive')");
    await js("compileFixture.pending.resolve({id:'stale-token',name:'Old'});void 0");
    await until("document.body.textContent.includes('face changed while compiling')");
    assert.equal(await js('compileFixture.saved.includes("stale-token")'), false, 'stale archive result cannot be saved');

    // Compiler errors reach the dialog; a failed compile never starts a transfer.
    await until(`!${install}.disabled`);
    await js(`${install}.click(); void 0`);
    await until('compileFixture.calls.length===3');
    await js("compileFixture.pending.reject(new Error('Invalid PNG assets.'));void 0");
    await until("document.querySelector('.wf-send-install [role=alert]')?.textContent.includes('Invalid PNG assets.')");
    assert.equal(await js('compileFixture.syncCalls.length'), 1);

    // Without a 416 × 416 layout there is nothing to compile.
    await js("compileFixture.resolutions=[800];compileFixture.render();void 0");
    await until(`${saveBin}.disabled`);
    assert.match(await js(`${saveBin}.title`), /416/);

    // A disconnected watch offers Connect instead of slots.
    await js("compileFixture.resolutions=[416];compileFixture.connected=false;compileFixture.archiveId='offline';compileFixture.render();void 0");
    await until(`${find('Connect')}`);
    assert.equal(await js(`${install}.disabled`), true);
    await click('Connect');
    await until("document.querySelectorAll('.wf-send-install .watch-slot').length===10");
    assert.equal(await js('compileFixture.publishes'), 0, 'local compile, save and install do not publish to COROS');
    assert.deepEqual(errors, []);
    console.log('Studio Send to watch, Save BIN, BIN reuse, layout gating, compile-and-install with progress, stale-result rejection, errors and connect passed.');
  } finally { win.destroy(); await vite.close(); }
}
main().then(()=>app.exit(0), error=>{console.error(error);app.exit(1);});
