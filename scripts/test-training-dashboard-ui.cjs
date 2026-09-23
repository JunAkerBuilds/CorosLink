const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const temporaryRoot = path.join(os.tmpdir(), `coroslink-dashboard-${process.pid}`);
app.setPath('userData', path.join(temporaryRoot, 'user-data'));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let win, vite;
  const errors = [];
  const watchdog = setTimeout(() => app.exit(1), 120000);
  try {
    vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], cacheDir: path.join(temporaryRoot, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
    await vite.listen();
    win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_')) errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click(); void 0`);
    async function until(code, accept = Boolean) {
      const end = Date.now() + 20000;
      while (Date.now() < end) { const result = await js(code); if (accept(result)) return result; await new Promise(r => setTimeout(r, 75)); }
      throw new Error(`Timed out: ${code}`);
    }
    const count = `document.querySelectorAll('[data-widget]').length`;
    const saved = `JSON.parse(localStorage.getItem('coroslink.training-dashboard.v1.sample')).widgets`;
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await js(`localStorage.setItem('coroslink.training-dashboard.v1.sample', JSON.stringify({ version: 3, widgets: [
      { id: 'recovery', size: 3 }, { id: 'fitness', size: 6 }, { id: 'vo2', size: 3 },
      { id: 'daily-load', preset: 'compact-square', startRow: true }, { id: 'daily-heart', preset: 'compact-square' },
      { id: 'sleep', size: 6 }, { id: 'daily-calories', preset: 'compact-square', startRow: true }, { id: 'daily-steps', preset: 'compact-square' }
    ] })); void 0`);
    await click('.training-hub-sample-button');
    await until(count, n => n === 8);
    await click('.hub-dashboard-edit');
    assert.equal(await js(`document.querySelectorAll('.hub-widget-controls, .hub-widget-settings').length`), 0);
    assert.equal(await js(`getComputedStyle(document.querySelector('[data-widget]')).borderTopStyle`), 'none');
    assert.equal(await js(`document.querySelectorAll('.hub-widget-remove, .hub-widget-resize-corner').length`), 16);
    assert.ok(await js(`Array.from(document.querySelectorAll('.hub-widget-content')).every(el => el.inert)`));
    await new Promise(r => setTimeout(r, 700));
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-dashboard-clean-editor.png'), (await win.webContents.capturePage()).toPNG());
    const pointFor = (id, fraction = .5) => js(`(() => { const r = document.querySelector('[data-widget="${id}"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * ${fraction}) }; })()`);
    async function startDrag(id) {
      const p = await pointFor(id);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...p });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + 12, y: p.y });
      await until(`document.querySelector('[data-widget="${id}"].is-dragging') !== null`);
    }
    const move = p => win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    const release = p => win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...p });
    await startDrag('vo2');
    const top = await pointFor('recovery', .05);
    move(top);
    await until(`document.querySelector('.hub-drop-preview') !== null`);
    const destination = await js(`(() => { const p = document.querySelector('.hub-drop-preview'); return { top: p.style.top, left: p.style.left }; })()`);
    release(top);
    await until(`${saved}[0].id`, id => id === 'vo2');
    assert.deepEqual(await js(`(() => { const p = document.querySelector('[data-widget="vo2"]'); return { top: p.style.top, left: p.style.left }; })()`), destination);
    await until(`document.querySelector('.is-dragging[data-widget]') === null`);
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Undo').click(); void 0`);
    await until(`${saved}[0].id`, id => id === 'recovery');
    await new Promise(r => setTimeout(r, 250));
    await startDrag('vo2');
    move(await pointFor('recovery', .05));
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    release(top);
    await until(`document.querySelector('.is-dragging[data-widget]') === null`);
    assert.equal(await js(`${saved}[0].id`), 'recovery', 'Escape cancels without saving');
    // Touch moves the card from its body, using the same drop preview and persistence.
    win.webContents.debugger.attach('1.3');
    const touch = await pointFor('vo2');
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch, id: 1 }] });
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...top, id: 1 }] });
    await until(`document.querySelector('.hub-drop-preview') !== null`);
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(`${saved}[0].id`, id => id === 'vo2');
    win.webContents.debugger.detach();
    await click('[aria-label="Remove VO₂ max"]');
    await until(count, n => n === 7);
    assert.equal(await js(`document.querySelector('.is-dragging[data-widget]')`), null);
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Undo').click(); void 0`);
    await until(count, n => n === 8);
    await js(`document.querySelector('[data-widget="vo2"]').focus(); void 0`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['alt'] });
    await until(`${saved}[1].id`, id => id === 'vo2');
    await click('.hub-dashboard-edit');
    assert.ok(await js(`Array.from(document.querySelectorAll('.hub-widget-content')).every(el => !el.inert)`));
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(count, n => n === 8);
    assert.equal(await js(`${saved}[1].id`), 'vo2');
    win.setSize(430, 950);
    await new Promise(r => setTimeout(r, 400));
    await click('.hub-dashboard-edit');
    assert.ok(await js(`document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth`), 'No narrow-screen overflow');
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add widget').click(); void 0`);
    await click('[aria-label="Add Menstrual cycle"]');
    await until(count, n => n === 9);
    await click('[aria-label="Close widget library"]');
    while (await js(count)) { await click('[aria-label^="Remove "]'); await new Promise(r => setTimeout(r, 30)); }
    await until(`document.querySelector('.hub-dashboard-empty') !== null`);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(`document.querySelector('.hub-dashboard-empty') !== null`);
    assert.equal(await js(`localStorage.getItem('coroslink.training-dashboard.v1')`), null, 'Sample layout is separate');
    assert.deepEqual(errors, []);
    console.log('Dashboard UI checks passed: whole-card mouse/touch drag, cancel, keyboard reorder, remove, add, undo, persistence and responsive layout.');
  } finally { clearTimeout(watchdog); win?.destroy(); await vite?.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
