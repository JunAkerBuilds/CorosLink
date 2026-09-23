const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { app, BrowserWindow } = require('electron');
const temp = path.join(os.tmpdir(), `coroslink-chart-sizing-${process.pid}`);
app.setPath('userData', path.join(temp, 'user-data'));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await vite.listen();
  const win = new BrowserWindow({ show: false, width: 1800, height: 1200 });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_')) errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click(); void 0`);
  async function until(code) {
    for (let i = 0; i < 150; i++) { if (await js(code)) return; await new Promise(r => setTimeout(r, 100)); }
    throw Error(`Timed out: ${code}`);
  }
  const ids = ['stress', 'sleepHrv', 'trend-load', 'trend-rpe', 'trend-hrv', 'trend-sleep'];
  const key = 'coroslink.training-dashboard.v1.sample';
  async function load(preset) {
    await js(`localStorage.setItem('${key}', JSON.stringify({version: 3, widgets: ${JSON.stringify(ids.map(id => ({ id, preset })))}})); void 0`);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button')`);
    await click('.training-hub-sample-button');
    await until(`document.querySelectorAll('[data-widget]').length === 6 && document.querySelectorAll('.health-insight-chart').length === 2`);
    await new Promise(r => setTimeout(r, 350));
  }
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    if (!process.argv.includes('--states-only')) {
    for (const [size, height] of [['mini', 224], ['short', 320], ['standard', 448], ['tall', 592]]) {
      for (const columns of [3, 4, 6, 8, 12]) {
        await load(`${columns}-${size}`);
        const cards = await js(`Array.from(document.querySelectorAll('.panel[data-chart-size]')).map(el => ({ metric: el.dataset.metric || el.className, height: el.getBoundingClientRect().height, overflow: el.scrollWidth - el.clientWidth, plot: el.querySelector('.training-chart-shell, .health-insight-chart')?.getBoundingClientRect().height }))`);
        for (const card of cards) {
          assert.ok(card.overflow <= 1, `${columns}-${size}: ${JSON.stringify(card)}`);
          assert.ok(card.height >= height - 1, `${columns}-${size}: minimum height ${JSON.stringify(card)}`);
          assert.ok(card.height <= height + 2, `${columns}-${size}: compact alignment ${JSON.stringify(card)}`);
          if (card.plot) assert.ok(card.plot >= 76, `${columns}-${size}: useful plot height`);
        }
        if (columns === 4 && size === 'mini') await new Promise(r => setTimeout(r, 1000));
        if (columns === 4 && size === 'mini') await fs.writeFile(path.join(os.tmpdir(), 'coroslink-compact-charts.png'), (await win.webContents.capturePage()).toPNG());
      }
    }
    await load('4-mini');
    await click('[data-widget="sleepHrv"] .chart-card-details summary');
    assert.ok(await js(`document.querySelector('[data-widget="sleepHrv"] .chart-card-details').open`));
    assert.ok(await js(`document.querySelector('[data-widget="sleepHrv"] .health-insight-stats').getBoundingClientRect().height > 0`));
    await click('[data-widget="sleepHrv"] .chart-card-details summary');
    await click('.hub-dashboard-edit');
    await js(`document.querySelector('[data-widget="stress"] .hub-widget-resize').focus(); void 0`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    await until(`document.querySelector('[data-widget="stress"]').dataset.preset === '4-short'`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await until(`document.querySelector('[data-widget="stress"]').dataset.preset === '6-short'`);
    assert.equal(await js(`JSON.parse(localStorage.getItem('${key}')).widgets[0].preset`), '6-short');
    await click('.hub-dashboard-edit');
    win.setSize(430, 950);
    await new Promise(r => setTimeout(r, 400));
    assert.ok(await js(`Array.from(document.querySelectorAll('.panel[data-chart-size]')).every(el => el.scrollWidth <= el.clientWidth + 1)`), 'Narrow cards fit');
    assert.ok(await js(`(() => { const cards = Array.from(document.querySelectorAll('[data-widget]')).map(el => el.getBoundingClientRect()); return cards.every((r,i) => cards.slice(0,i).every(o => r.right <= o.left+1 || o.right <= r.left+1 || r.bottom <= o.top+1 || o.bottom <= r.top+1)); })()`), 'Cards do not overlap');
    }
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/chart-sizing.html`);
    await until(`document.querySelector('.health-insight-chart') && document.querySelectorAll('.training-chart-empty').length === 2`);
    assert.ok(await js(`Array.from(document.querySelectorAll('.panel[data-chart-size]')).every(el => Math.abs(el.getBoundingClientRect().height - 224) <= 2 && el.scrollWidth <= el.clientWidth + 1)`), JSON.stringify(await js(`Array.from(document.querySelectorAll('.panel[data-chart-size]')).map(el => ({class:el.className,height:el.getBoundingClientRect().height,overflow:el.scrollWidth-el.clientWidth}))`)));
    await js(`const seriesSelect = document.querySelector('select[aria-label="Chart"]'); seriesSelect.value = 'overnight'; seriesSelect.dispatchEvent(new Event('change', {bubbles: true})); void 0`);
    await until(`document.querySelector('.health-insight-chart').getAttribute('aria-label').startsWith('Overnight HRV')`);
    await click('.chart-card-details summary');
    assert.ok(await js(`document.querySelector('.health-insight-note').getBoundingClientRect().height > 0`), 'Compact report remains accessible');
    win.setSize(1200, 1000);
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/chart-sizing.html?standard`);
    await until(`document.querySelector('.health-insight-chart')`);
    const dimensions = await js(`(() => { const card = document.querySelector('.health-insight-sleepHrv'); return { height: card.getBoundingClientRect().height, plot: card.querySelector('.health-insight-chart').getBoundingClientRect().height }; })()`);
    assert.ok(Math.abs(dimensions.height - 448) <= 2 && dimensions.plot >= 150, JSON.stringify(dimensions));
    assert.equal(await js(`document.querySelectorAll('.health-insight-chips li').length`), 0, 'References are not duplicated as chips');
    assert.equal(await js(`document.querySelectorAll('.health-insight-legend span').length`), 2);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-hrv-cleanup.png'), (await win.webContents.capturePage()).toPNG());
    await click('.health-hrv-explanation summary');
    assert.ok(await js(`document.querySelector('.health-hrv-explanation').open`));
    assert.deepEqual(errors, []);
    console.log('All six charts: 20 size presets, compact height alignment, usable plots, details, keyboard resize, persistence and narrow layout passed.');
  } finally { win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
