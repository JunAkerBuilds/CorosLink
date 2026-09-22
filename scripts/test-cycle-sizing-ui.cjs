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
  const ids = ['cycle'];
  const key = 'coroslink.training-dashboard.v1.sample';
  async function load(preset) {
    await js(`localStorage.setItem('${key}', JSON.stringify({version: 3, widgets: ${JSON.stringify(ids.map(id => ({ id, preset })))}})); void 0`);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button')`);
    await click('.training-hub-sample-button');
    await until(`document.querySelector('[data-widget="cycle"] .health-cycle-toggle')`);
    await new Promise(r => setTimeout(r, 350));
  }
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    for (const [size, height] of [['mini',224], ['short',320]]) {
      for (const columns of [3,4,6,8,12]) {
        await load(`${columns}-${size}`);
        assert.ok(await js(`document.querySelector('.health-insight-body').hidden`), 'Cycle remains hidden by default');
        assert.equal(await js(`document.querySelectorAll('.health-insight-metrics > div').length`), 0);
        assert.ok(await js(`Math.abs(document.querySelector('.health-insight-card').getBoundingClientRect().height-${height}) < 2`));
        await click('.health-cycle-toggle');
        await until(`document.querySelectorAll('.health-insight-metrics > div').length === 3`);
        assert.ok(await js(`!document.querySelector('.health-insight-body').hidden`));
        assert.ok(await js(`Array.from(document.querySelectorAll('.health-insight-card, .health-insight-metrics > div')).every(el=>el.scrollWidth<=el.clientWidth+1)`));
        await click('.health-cycle-toggle');
        await until(`document.querySelector('.health-insight-body').hidden`);
      }
    }
    await load('3-mini');
    await click('.health-cycle-toggle');
    await until(`document.querySelectorAll('.health-insight-metrics > div').length === 3`);
    win.setSize(430,950);
    await new Promise(r=>setTimeout(r,400));
    assert.ok(await js(`document.querySelector('.health-insight-card').scrollWidth<=document.querySelector('.health-insight-card').clientWidth+1`));
    assert.deepEqual(errors,[]);
    console.log('Cycle compact widths, shared heights, reveal/hide controls and narrow content passed.');
  } finally { win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
