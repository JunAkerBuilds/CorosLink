const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const temporaryRoot = path.join(os.tmpdir(), `coroslink-resize-${process.pid}`);
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
    win = new BrowserWindow({ show: false, width: 1500, height: 1000 });
    win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_')) errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click(); void 0`);
    async function until(code, accept = Boolean) {
      const end = Date.now() + 20000;
      while (Date.now() < end) { const result = await js(code); if (accept(result)) return result; await new Promise(r => setTimeout(r, 75)); }
      throw new Error(`Timed out: ${code}; received ${JSON.stringify(await js(code))}`);
    }
    const count = `document.querySelectorAll('[data-widget]').length`;
    const saved = `JSON.parse(localStorage.getItem('coroslink.training-dashboard.v1.sample')).widgets`;
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await js(`localStorage.setItem('coroslink.training-dashboard.v1.sample', JSON.stringify({ version: 2, widgets: [
      { id: 'daily-steps', size: 3 }, { id: 'daily-calories', size: 3 }, { id: 'sleep', size: 6 },
      { id: 'recovery', size: 4 }, { id: 'fitness', size: 8 }, { id: 'trend-load', size: 6 }
    ] })); void 0`);
    await click('.training-hub-sample-button');
    await until(count, n => n === 6);
    await click('.hub-dashboard-edit');
    const storedPreset = id => `${saved}.find(w => w.id === '${id}').preset`;
    async function beginResize(id) {
      await js(`document.querySelector('[data-widget="${id}"]').scrollIntoView({ block: 'center', behavior: 'instant' }); void 0`);
      await new Promise(r => setTimeout(r, 300));
      const point = await js(`(() => { const r = document.querySelector('[data-widget="${id}"] .hub-widget-resize').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      await until(`document.querySelector('.hub-dashboard.is-resizing') !== null`);
      return point;
    }
    const unit = await js(`(document.querySelector('.hub-dashboard-grid').clientWidth + 16) / 12`);
    let start = await beginResize('daily-steps');
    let end = { x: Math.round(start.x + unit * 3), y: start.y + 96 };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === '6-tall');
    assert.equal(await js(storedPreset('daily-steps')), '3-standard', 'Preview does not save during the gesture');
    assert.ok(await js(`document.querySelector('.hub-resize-preview').textContent.includes('Release to apply')`));
    await new Promise(r => setTimeout(r, 300));
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-widget-resize-preview.png'), (await win.webContents.capturePage()).toPNG());
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await until(storedPreset('daily-steps'), p => p === '6-tall');
    await until(`document.querySelector('.hub-dashboard.is-resizing') === null`);
    start = await beginResize('daily-steps');
    end = { x: Math.round(start.x - unit * 3), y: start.y - 96 };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === '3-standard');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === '6-tall');
    assert.equal(await js(storedPreset('daily-steps')), '6-tall', 'Escape restores the committed shape');
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Undo').click(); void 0`);
    await until(storedPreset('daily-steps'), p => p === '3-standard');
    assert.ok(await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Undo').disabled`), 'One resize is one undo step');
    // A canceled pointer gesture must not leave resize mode or save its preview.
    start = await beginResize('daily-steps');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y + 96 });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === '3-tall');
    await js(`document.querySelector('[data-widget="daily-steps"] .hub-widget-resize').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })); void 0`);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', ...start });
    await until(`document.querySelector('.hub-dashboard.is-resizing') === null`);
    assert.equal(await js(storedPreset('daily-steps')), '3-standard');
    await js(`document.querySelector('[data-widget="daily-steps"] .hub-widget-resize').focus(); void 0`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    await until(storedPreset('daily-steps'), p => p === '3-tall');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await until(storedPreset('daily-steps'), p => p === '6-tall');
    // Verify actual shrinking commits too.
    start = await beginResize('daily-steps');
    end = { x: Math.round(start.x - unit * 3), y: start.y - 96 };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await new Promise(r => setTimeout(r, 300));
    await until(storedPreset('daily-steps'), p => p === '3-standard');
    // Touch uses the same corner handle, without initiating page scrolling.
    win.webContents.debugger.attach('1.3');
    const touchPoint = await js(`(() => { const r = document.querySelector('[data-widget="daily-steps"] .hub-widget-resize').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchPoint, id: 1 }] });
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x, y: touchPoint.y + 96, id: 1 }] });
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(storedPreset('daily-steps'), p => p === '3-tall');
    win.webContents.debugger.detach();
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(`document.querySelector('[data-widget="daily-steps"]')?.dataset.preset`, p => p === '3-tall');
    assert.equal(await js(`document.querySelectorAll('.hub-widget-resize').length`), 0, 'Normal view stays clean');
    win.setSize(430, 950);
    await new Promise(r => setTimeout(r, 500));
    assert.equal(await js(`${saved}.find(w => w.id === 'daily-steps').size`), 3, 'Narrow windows preserve desktop width');
    assert.ok(await js(`document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth`));
    await click('.hub-dashboard-edit');
    start = await beginResize('daily-steps');
    end = { x: start.x - 100, y: start.y - 96 };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await until(storedPreset('daily-steps'), p => p === '3-standard');
    assert.equal(await js(`${saved}.find(w => w.id === 'daily-steps').size`), 3);
    win.setSize(1500, 1000);
    await new Promise(r => setTimeout(r, 500));
    await js(`document.querySelector('main').scrollTop = 0; void 0`);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-widget-presets.png'), (await win.webContents.capturePage()).toPNG());
    // Drag into a true square, then confirm its proportions in edit, normal and narrow layouts.
    start = await beginResize('daily-steps');
    const squareDelta = await js(`(() => { const r = document.querySelector('[data-widget="daily-steps"] .hub-widget-content').getBoundingClientRect(); return Math.round(r.width - r.height); })()`);
    end = { x: start.x, y: start.y + squareDelta };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === '3-square');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await until(storedPreset('daily-steps'), p => p === '3-square');
    const squareError = `(() => { const r = document.querySelector('[data-widget="daily-steps"] .training-stat-card').getBoundingClientRect(); return Math.abs(r.width - r.height); })()`;
    await until(squareError, n => n <= 2);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-square-metric.png'), (await win.webContents.capturePage()).toPNG());
    await click('.hub-dashboard-edit');
    await until(squareError, n => n <= 2);
    win.setSize(430, 950);
    await until(squareError, n => n <= 2);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(`document.querySelector('[data-widget="daily-steps"]')?.dataset.preset`, p => p === '3-square');
    await until(squareError, n => n <= 2);
    // Shrink horizontally to the compact square: retain the standard height, remove spare width.
    win.setSize(1500, 1000);
    await new Promise(r => setTimeout(r, 500));
    await click('.hub-dashboard-edit');
    await js(`document.querySelector('[data-widget="daily-steps"] .hub-widget-resize').focus(); void 0`);
    while (await js(storedPreset('daily-steps')) !== '3-standard') {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
      await new Promise(r => setTimeout(r, 100));
    }
    const cardSize = id => `(() => { const r = document.querySelector('[data-widget="${id}"] .training-stat-card').getBoundingClientRect(); return { width: r.width, height: r.height }; })()`;
    const beforeCompact = await js(cardSize('daily-steps'));
    start = await beginResize('daily-steps');
    end = { x: Math.round(start.x - beforeCompact.width + 152), y: start.y };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === 'compact-square');
    assert.equal(await js(storedPreset('daily-steps')), '3-standard');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await until(storedPreset('daily-steps'), p => p === 'compact-square');
    const compactSize = await until(cardSize('daily-steps'), r => r.width >= 128 && r.width <= 200 && Math.abs(r.width - r.height) <= 2);
    assert.ok(Math.abs(compactSize.height - beforeCompact.height) <= 2, 'Horizontal shrinking preserves the metric height');
    assert.ok(compactSize.width < beforeCompact.width * .6, 'Width reduces substantially');
    // Keyboard resizing can leave and return to compact, and every metric can use it.
    await js(`document.querySelector('[data-widget="daily-steps"] .hub-widget-resize').focus(); void 0`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await until(storedPreset('daily-steps'), p => p === '3-standard');
    assert.ok(Math.abs((await js(cardSize('daily-steps'))).height - compactSize.height) <= 2, 'Horizontal widening preserves the compact height');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    await until(storedPreset('daily-steps'), p => p === 'compact-square');
    // A purely horizontal pointer gesture must preserve height during preview and after commit.
    const beforeWiden = await js(cardSize('daily-steps'));
    start = await beginResize('daily-steps');
    end = { x: Math.round(start.x + unit * 1.5), y: start.y };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    await until(`document.querySelector('[data-widget="daily-steps"]').dataset.preset`, p => p === '3-standard');
    assert.ok(Math.abs((await js(cardSize('daily-steps'))).height - beforeWiden.height) <= 2, 'Horizontal preview keeps its height');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
    await until(storedPreset('daily-steps'), p => p === '3-standard');
    assert.ok(Math.abs((await js(cardSize('daily-steps'))).height - beforeWiden.height) <= 2, 'Committed width keeps its height');
    await js(`document.querySelector('[data-widget="daily-steps"] .hub-widget-resize').focus(); void 0`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    await until(storedPreset('daily-steps'), p => p === 'compact-square');
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add widget').click(); void 0`);
    await click('[aria-label="Add Daily training load"]');
    await click('[aria-label="Add Resting heart rate"]');
    await click('[aria-label="Close widget library"]');
    for (const id of ['daily-calories', 'daily-load', 'daily-heart']) {
      await js(`document.querySelector('[data-widget="${id}"] .hub-widget-resize').focus(); void 0`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
      await until(cardSize(id), r => r.width >= 128 && r.width <= 200 && Math.abs(r.width - r.height) <= 2);
    }
    await click('.hub-dashboard-edit');
    await until(`document.querySelector('.hub-dashboard.is-editing') === null`);
    await until(cardSize('daily-steps'), r => r.width >= 128 && r.width <= 200 && Math.abs(r.width - r.height) <= 2);
    const assertPacked = async () => {
      await new Promise(r => setTimeout(r, 300));
      assert.ok(await js(`(() => {
        const cards = Array.from(document.querySelectorAll('[data-widget]')).map(card => card.getBoundingClientRect());
        return cards.every((card, i) => cards.slice(0, i).every(other => card.right <= other.left + 1 || other.right <= card.left + 1 || card.bottom <= other.top + 1 || other.bottom <= card.top + 1));
      })()`), 'Compact and full-size widgets do not overlap after packing');
    };
    await assertPacked();
    await js(`document.querySelector('[data-widget="daily-steps"]').scrollIntoView({ block: 'center', behavior: 'instant' }); void 0`);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-compact-square.png'), (await win.webContents.capturePage()).toPNG());
    assert.ok(await js(`Array.from(document.querySelectorAll('[data-compact="true"] .training-stat-card__summary')).every(summary => summary.scrollWidth <= summary.clientWidth && summary.scrollHeight <= summary.clientHeight)`), 'Compact content fits without clipping');
    await click('[data-widget="daily-steps"] summary');
    await until(`document.querySelector('[data-widget="daily-steps"] details').open`);
    await click('[data-widget="daily-steps"] summary');
    win.setSize(430, 950);
    await until(cardSize('daily-steps'), r => r.width >= 128 && r.width <= 200 && Math.abs(r.width - r.height) <= 2);
    await assertPacked();
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(`document.querySelector('[data-widget="daily-steps"]')?.dataset.preset`, p => p === 'compact-square');
    await until(cardSize('daily-steps'), r => r.width >= 128 && r.width <= 200 && Math.abs(r.width - r.height) <= 2);
    // Health check supports intermediate widths and proportions without clipping its readings.
    win.setSize(1800, 1100);
    for (const preset of ['3-mini', '4-mini', '6-mini', '4-standard', '6-short', '8-square', '6-portrait', '12-short']) {
      await js(`localStorage.setItem('coroslink.training-dashboard.v1.sample', JSON.stringify({ version: 3, widgets: [{ id: 'healthCheck', preset: '${preset}' }] })); void 0`);
      await win.reload();
      await until(`document.querySelector('.training-hub-sample-button') !== null`);
      await click('.training-hub-sample-button');
      await until(`document.querySelector('[data-widget="healthCheck"]')?.dataset.preset`, p => p === preset);
      await until(`document.querySelectorAll('.health-vital').length`, n => n === 5);
      await new Promise(r => setTimeout(r, 250));
      assert.ok(await js(`Array.from(document.querySelectorAll('.health-vital, .health-vital-head, .health-vital-value, .health-insight-card')).every(el => el.scrollWidth <= el.clientWidth + 1)`), `${preset}: health readings fit`);
      if (preset === '3-mini') {
        await fs.writeFile(path.join(os.tmpdir(), 'coroslink-health-mini-refined.png'), (await win.webContents.capturePage()).toPNG());
      }
      if (preset === '8-square' || preset === '6-portrait') {
        const rect = await js(`(() => { const r = document.querySelector('.health-insights').getBoundingClientRect(); return { width: r.width, height: r.height }; })()`);
        assert.ok(Math.abs(rect.height - rect.width / (preset === '8-square' ? 1 : .75)) < 2, `${preset}: proportional height`);
      }
    }
    await click('.hub-dashboard-edit');
    await js(`document.querySelector('[data-widget="healthCheck"] .hub-widget-resize').focus(); void 0`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    await until(storedPreset('healthCheck'), p => p === '8-short');
    win.setSize(430, 950);
    await new Promise(r => setTimeout(r, 300));
    assert.ok(await js(`document.querySelector('.health-insight-card').scrollWidth <= document.querySelector('.health-insight-card').clientWidth + 1`), 'Narrow health check fits');
    assert.deepEqual(errors, []);
    console.log('Corner resize checks passed: mouse, touch, shrink, preview, commit, Escape, pointer cancel, keyboard, one-step undo, reload and responsive layout.');
  } finally { clearTimeout(watchdog); win?.destroy(); await vite?.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
