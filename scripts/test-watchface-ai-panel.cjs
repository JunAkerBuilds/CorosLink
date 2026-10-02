// Real React panel with delayed persistence; no account or live editor access.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temp = path.join(os.tmpdir(), `coroslink-ai-panel-${process.pid}`);
app.setPath('userData', path.join(temp, 'user-data'));
app.on('window-all-closed', () => {});

async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  let window;
  const vite = await createServer({ root, configFile: false, cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
    plugins: [{ name: 'panel-fixture', configureServer(server) {
      server.middlewares.use('/panel-test', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<div id="root"></div>');
      });
    } }], esbuild: { jsx: 'automatic' } });
  try {
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await js(code)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out: ${label}`);
    };
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/panel-test`);
    await js(`import('/scripts/fixtures/watchface-ai-panel.js').then(() => undefined)`);
    await until('!!document.querySelector(".wf-ai-suggestions button")', 'panel ready');
    await js('document.querySelector(".wf-ai-suggestions button").click()');
    await until('requests.length === 1', 'first request');
    await js('complete()');
    await until('saves.length === 1', 'first delayed save');
    await js(`document.querySelector('[title="New chat"]').click()`);
    await until('!!document.querySelector(".wf-ai-suggestions button")', 'new chat');
    await js('release(0)');
    await js('document.querySelector(".wf-ai-suggestions button").click()');
    await until('requests.length === 2', 'second request');
    await js('complete()');
    await until('saves.length === 2', 'second delayed save');
    const ids = await js('saves.map(save => save.input.id)');
    assert.ok(ids[0] && ids[1]);
    assert.notEqual(ids[0], ids[1], 'A late save cannot make a new chat overwrite the old conversation');
    await js('release(1)');
    await js(`document.querySelector('[title="New chat"]').click()`);
    await until('!!document.querySelector(".wf-ai-suggestions button")', 'third chat');
    await js('document.querySelector(".wf-ai-suggestions button").click()');
    await until('requests.length === 3', 'third request');
    await js('panelRoot.unmount()');
    assert.deepEqual(await js('cancelled'), [await js('requests[2]')], 'Closing the editor cancels its active AI request');
    console.log('Watchmaker panel: delayed saves preserve chat identity; unmount cancels active edits.');
  } finally {
    window?.destroy();
    await vite.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
