const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temp = path.join(os.tmpdir(), `coroslink-community-scroll-${process.pid}`);
app.setPath('userData', path.join(temp, 'user-data'));
app.on('window-all-closed', () => {});

async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const vite = await createServer({ root, cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error',
    plugins: [{ name: 'scroll-fixture', configureServer(server) {
      server.middlewares.use('/scroll-test', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="scroll" style="height:600px;overflow-y:auto"><div id="root" style="padding:24px"></div></div>');
      });
    } }] });
  let window;
  const watchdog = setTimeout(() => app.exit(1), 60000);
  try {
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 1100, height: 750,
      webPreferences: { backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await js(code)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out: ${label}`);
    };
    const settle = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    const scroll = () => js('document.querySelector("#scroll").scrollTop = document.querySelector("#scroll").scrollHeight; void 0');
    const cards = 'document.querySelectorAll(".watchface-community-card:not(.is-loading)")';
    const select = (index, value) => js(`(() => {
      const input = document.querySelectorAll('.watchface-community-tools select')[${index}];
      input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scroll-test`);
    await js("import('/scripts/fixtures/community-scroll.js').then(() => undefined)");
    await until('requests.length === 1', 'initial request');
    await js('respond(0, Array.from({length:12}, (_, i) => i), 26, 3)');
    await until(`${cards}.length === 12`, 'first page');
    await settle();
    assert.equal(await js('requests.length'), 1, 'Offscreen sentinel does not load the whole catalog');
    await js(`(() => { const input = document.querySelector('[aria-label="Watch type for Face 0"]'); input.value = 'PACE Pro'; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await scroll();
    await until('requests.length === 2', 'real scroll requests next page');
    await scroll(); await settle();
    assert.equal(await js('requests.length'), 2, 'Only one request may be in flight');
    assert.equal(await js(`${cards}.length`), 12, 'Existing cards remain during loading');
    assert.equal(await js('requests[1].query.page'), 2);
    await js('respond(1, Array.from({length:12}, (_, i) => i + 11), 26, 3)');
    await until(`${cards}.length === 23`, 'append without duplicate IDs');
    assert.equal(await js(`document.querySelector('[aria-label="Watch type for Face 0"]').value`), 'PACE Pro');
    await scroll();
    await until('requests.length === 3', 'third page request');
    await js('requests[2].reject(new Error("Offline fixture"))');
    await until('!!document.querySelector(".watchface-community-load-more [role=alert]")', 'inline error');
    await scroll(); await settle();
    assert.equal(await js('requests.length'), 3, 'Errors do not cause an automatic retry loop');
    assert.equal(await js(`${cards}.length`), 23);
    await js('document.querySelector(".watchface-community-load-more button").click()');
    await until('requests.length === 4', 'manual retry');
    assert.equal(await js('requests[3].query.page'), 3, 'Retry requests the failed page');
    await js('respond(3, [23,24,25], 26, 3)');
    await until(`${cards}.length === 26`, 'last page');
    await scroll(); await settle();
    assert.equal(await js('requests.length'), 4, 'No requests after the final page');
    assert.match(await js('document.querySelector(".watchface-community-load-more").textContent'), /seen all 26/);

    await select(2, 'title');
    await until('requests.length === 5', 'sort resets pagination');
    assert.equal(await js('requests[4].query.page'), 1);
    await js(`(() => {
      const input = document.querySelector('input[type="search"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'new search');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await until('requests.length === 6', 'debounced search');
    assert.deepEqual(await js('requests[5].query'), { q: 'new search', sort: 'title', page: 1, pageSize: 12 });
    await js('respond(5, [100], 1, 1)');
    await until(`${cards}.length === 1`, 'new search result');
    await js('respond(4, [200], 1, 1)'); await settle();
    assert.equal(await js('document.querySelector(".watchface-community-title").textContent'), 'Face 100', 'Late responses from old filters are ignored');
    await select(0, 'PACE Pro');
    await until('requests.length === 7', 'model reset');
    assert.equal(await js('requests[6].query.model'), 'PACE Pro');
    await js('respond(6, [101], 1, 1)');
    await until(`${cards}.length === 1`, 'model result');
    await select(1, 'minimal');
    await until('requests.length === 8', 'style reset');
    assert.equal(await js('requests[7].query.page'), 1);
    assert.equal(await js('requests[7].query.style'), 'minimal');
    await js('respond(7, [], 0, 1)');
    await until('document.body.textContent.includes("No faces match")', 'empty results');
    console.log('Community infinite scroll passed: real scrolling, append/deduplication, selection retention, failed-page retry, end of list, filter resets and stale responses.');
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
