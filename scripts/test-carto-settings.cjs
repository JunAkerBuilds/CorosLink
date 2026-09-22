const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(
  os.tmpdir(),
  `coroslink-carto-settings-${process.pid}`,
);
app.setPath("userData", path.join(temporaryRoot, "user-data"));
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  let vite, window;
  const watchdog = setTimeout(() => app.exit(1), 60000);
  try {
    vite = await createServer({
      root,
      configFile: false,
      plugins: [react()],
      cacheDir: path.join(temporaryRoot, "vite-cache"),
      server: { host: "127.0.0.1", port: 0, hmr: false },
      logLevel: "error",
    });
    await vite.listen();
    window = new BrowserWindow({
      show: false,
      width: 1320,
      height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    async function until(code, label) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`Timed out: ${label}`);
    }
    const click = (label) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(label)})).click(); void 0;`,
      );
    const fill = (selector, value) =>
      js(
        `{ const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); } void 0;`,
      );
    // Never send test credentials or tile traffic to real map providers.
    window.webContents.session.webRequest.onBeforeRequest({ urls: ["https://*/*"] }, (_details, callback) => callback({ cancel: true }));
    const url = `http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/carto-settings.html`;
    await window.loadURL(url);
    await until(`Boolean(document.querySelector('input[type=password]')) && Boolean(window.light)`, "settings mounted");
    const initial = await js(`light._url`);
    assert.equal(await js(`readCartoApiKey()`), "");
    await fill('input[type=password]', ' test&key=123 ');
    await click("Save key");
    await until(`document.body.textContent.includes('Key saved')`, "key saved");
    assert.equal(await js(`light._url`), initial + '?key=test%26key%3D123');
    assert.match(await js(`dark._url`), /key=test%26key%3D123$/);
    assert.equal(await js(`street._url.includes('key=')`), false);
    assert.equal(await js(`document.querySelector('.leaflet-control-attribution').textContent.includes('CARTO')`), true);
    assert.equal(await js(`withCartoApiKey('https://basemaps.cartocdn.com.evil.test/tile', 'secret')`), 'https://basemaps.cartocdn.com.evil.test/tile');
    assert.equal(await js(`withCartoApiKey('https://basemaps.cartocdn.com/tile?x=1', 'a b')`), 'https://basemaps.cartocdn.com/tile?x=1&key=a%20b');
    // Removing a layer unsubscribes; adding it again picks up current storage.
    await js(`map.removeLayer(dark); void 0`);
    await click("Remove key");
    await until(`light._url === ${JSON.stringify(initial)}`, "live removal");
    assert.match(await js(`dark._url`), /key=/);
    await js(`dark.addTo(map); void 0`);
    assert.equal(await js(`dark._url.includes('key=')`), false);
    await fill('input[type=password]', 'persisted-test-key');
    await click("Save key");
    await until(`readCartoApiKey() === 'persisted-test-key'`, "persisted");
    await window.loadURL(url);
    await until(`document.querySelector('input')?.value === 'persisted-test-key'`, "reload persistence");
    assert.match(await js(`light._url`), /key=persisted-test-key$/);
    // Storage failures must be visible and must not change existing requests.
    await js(`Storage.prototype.setItem = function() { throw new Error('unavailable'); }; void 0`);
    await fill('input[type=password]', 'different-test-key');
    await click("Save key");
    await until(`Boolean(document.querySelector('[role=alert]'))`, "storage error");
    assert.match(await js(`light._url`), /key=persisted-test-key$/);
    assert.equal(await js(`Boolean(document.querySelector('[role=status]'))`), false);
    window.setSize(420, 1000);
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal(await js(`document.documentElement.scrollWidth <= window.innerWidth`), true);
    await fs.writeFile(path.join(temporaryRoot, 'carto-settings.png'), (await window.webContents.capturePage()).toPNG());
    console.log(`CARTO settings passed: save/remove, persistence, live tile refresh, provider isolation, attribution, layer cleanup, storage failure, narrow layout. Screenshot: ${temporaryRoot}/carto-settings.png`);
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite?.close();
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
