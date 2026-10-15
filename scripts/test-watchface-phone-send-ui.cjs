const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const temp = path.join(os.tmpdir(), `coros-phone-send-ui-${process.pid}`);
app.setPath("userData", path.join(temp, "user-data"));
app.on("window-all-closed", () => {});
// Optional: a folder to save screenshots of the card into (light and dark).
const screenshots = process.env.PHONE_SEND_SCREENSHOTS;
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
  const card = "document.querySelector('.wf-send-phone')";
  const find = text => `Array.from(${card}?.querySelectorAll('button') ?? []).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = text => js(`${find(text)}.click(); void 0`);
  const text = () => js(`${card}.textContent`);
  const emit = status => js(`compileFixture.emitPhoneStatus(${JSON.stringify(status)}); void 0`);
  const shot = async name => {
    if (!screenshots) return;
    fs.mkdirSync(screenshots, { recursive: true });
    await js(`${card}.scrollIntoView({block:'center'}); void 0`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const rect = await js(`(()=>{const r=document.querySelector('.wf-send-panel').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(Math.min(r.height,1000-r.y))}})()`);
    fs.writeFileSync(path.join(screenshots, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/watchface-compile.html`);
    await until(`${find('Show code')} && !${find('Show code')}.disabled`);
    assert.match(await js(`${card}.querySelector('h3').textContent`), /Send to iPhone/);
    assert.ok(await js(`!!${find('AirDrop')}`), "macOS offers AirDrop");
    await shot("1-card-light");

    // Show code: the archive Studio built, the name typed in the dialog, and the watch it was built for.
    await click('Show code');
    await until(`${card}.querySelector('img')`);
    assert.deepEqual(await js('compileFixture.phoneSends[0]'), { archiveId: 'fixture-archive', name: 'Fixture face', firmwareType: 'COROS W332' });
    assert.match(await js(`${card}.querySelector('img').src`), /^data:image\/png;base64,/);
    assert.match(await text(), /Scan with the iPhone Camera, or in C-LINK: My Faces → \+ → Scan code from CorosLink/);
    assert.match(await text(), /Personal Hotspot/);
    assert.match(await text(), /Expires in (10:00|9:5\d)/);
    await shot("2-code-light");

    // Main pushes progress; a status for another code is ignored.
    await emit({ active: true, sending: true, received: 0, expiresAt: await js('compileFixture.phoneExpiresAt') });
    await until(`${card}.textContent.includes('Sending to your iPhone')`);
    await emit({ active: true, sending: false, received: 1, expiresAt: 1 });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(await text(), /Sending to your iPhone/, "a status for an older code doesn't change this one");
    await emit({ active: true, sending: false, received: 1, expiresAt: await js('compileFixture.phoneExpiresAt') });
    await until(`${card}.textContent.includes('On your iPhone. Install it from C-LINK')`);
    await shot("3-received-light");

    // Copy link puts the coroslink:// link on the clipboard.
    await js("Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async t=>{window.copiedLink=t}}); void 0");
    await click('Copy link');
    await until(`${find('Copied')}`);
    assert.match(await js('window.copiedLink'), /^coroslink:\/\/face\/1\?/);

    // Renaming the face ends the code: it carries the old name.
    const stops = await js('compileFixture.phoneStops');
    await js(`(()=>{const input=document.querySelector('.wf-send-name input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Renamed face');
      input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`${find('Show code')}`);
    assert.equal(await js('compileFixture.phoneStops'), stops + 1);
    await click('Show code');
    await until('compileFixture.phoneSends.length===2');
    assert.equal(await js('compileFixture.phoneSends[1].name'), 'Renamed face');
    await until(`${find('Hide code')}`);

    // Hide code stops serving; main stopping (expiry, another code) hides it too.
    await click('Hide code');
    await until(`${find('Show code')}`);
    assert.equal(await js('compileFixture.phoneStops'), stops + 2);
    await click('Show code');
    await until(`${find('Hide code')}`);
    await emit({ active: false, sending: false, received: 0, expiresAt: await js('compileFixture.phoneExpiresAt') });
    await until(`${find('Show code')}`);
    await js('compileFixture.phoneSendTtlMs = 1200; void 0');
    await click('Show code');
    await until(`${find('Hide code')}`);
    await until(`${find('Show code')}`);

    // AirDrop hands the same archive to the share menu.
    await click('AirDrop');
    await until('compileFixture.airDrops.length===1');
    assert.deepEqual(await js('compileFixture.airDrops[0]'), { archiveId: 'fixture-archive', name: 'Renamed face', firmwareType: 'COROS W332' });

    // Errors from main are shown without the IPC wrapper.
    await js("compileFixture.phoneSendError = \"This computer isn't on a local network. Join the same Wi-Fi as your iPhone, or your iPhone's Personal Hotspot, and try again.\"; void 0");
    await click('Show code');
    await until(`${card}.querySelector('[role=alert]')`);
    assert.equal(await js(`${card}.querySelector('[role=alert]').textContent`),
      "This computer isn't on a local network. Join the same Wi-Fi as your iPhone, or your iPhone's Personal Hotspot, and try again.");
    await js("compileFixture.phoneSendError = null; void 0");

    // Windows and Linux: Wi-Fi only.
    await js("compileFixture.platform='win32'; compileFixture.render(); void 0");
    await until(`!${find('AirDrop')}`);
    assert.match(await text(), /Sends over your Wi-Fi network/);
    await shot("4-windows-light");

    // Dark theme, for the screenshots.
    if (screenshots) {
      await js("compileFixture.platform='darwin'; document.documentElement.dataset.theme='dark'; compileFixture.phoneSendTtlMs=600000; compileFixture.render(); void 0");
      await click('Show code');
      await until(`${card}.querySelector('img')`);
      await shot("5-code-dark");
      await click('Hide code');
      await until(`${find('Show code')}`);
    }

    // Closing the dialog stops serving the face.
    await click('Show code');
    await until(`${find('Hide code')}`);
    const before = await js('compileFixture.phoneStops');
    await js('compileFixture.unmount(); void 0');
    await until(`compileFixture.phoneStops===${before + 1}`);

    assert.deepEqual(errors, []);
    console.log('Studio Send to iPhone: code, status, copy, rename, hide, expiry, AirDrop, errors, Windows/Linux and close passed.');
  } finally { win.destroy(); await vite.close(); }
}
main().then(()=>app.exit(0), error=>{console.error(error);app.exit(1);});
