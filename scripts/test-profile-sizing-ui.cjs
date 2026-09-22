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
  const ids = ['zones-heart', 'zones-distance', 'scores', 'race', 'effort'];
  const key = 'coroslink.training-dashboard.v1.sample';
  async function load(preset) {
    await js(`localStorage.setItem('${key}', JSON.stringify({version: 3, widgets: ${JSON.stringify(ids.map(id => ({ id, preset })))}})); void 0`);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button')`);
    await click('.training-hub-sample-button');
    await until(`document.querySelectorAll('[data-widget]').length === 5 && document.querySelectorAll('.training-zone-row').length > 0`);
    await new Promise(r => setTimeout(r, 350));
  }
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    for (const [size, height] of [['mini', 224], ['short', 320], ['standard', 448], ['tall', 592]]) {
      for (const columns of [3, 6, 12]) {
        await load(`${columns}-${size}`);
        const cards = await js(`Array.from(document.querySelectorAll('.panel[data-chart-size]')).map(el => ({name: el.className, height: el.getBoundingClientRect().height, overflow: el.scrollWidth-el.clientWidth, children:Array.from(el.children).map(c=>[c.className,c.getBoundingClientRect().height,getComputedStyle(c).minHeight])}))`);
        for (const card of cards) {
          assert.ok(card.overflow <= 1, `${columns}-${size} ${JSON.stringify(card)}`);
          assert.ok(card.height >= height - 1, `${columns}-${size} ${JSON.stringify(card)}`);
          if (size === 'mini' || (size === 'standard' && columns >= 6)) assert.ok(card.height <= height + 2, `${columns}-${size} ${JSON.stringify(card)}`);
        }
      }
    }
    await load('3-mini');
    await click('[data-widget="zones-heart"] details summary');
    assert.ok(await js(`document.querySelector('[data-widget="zones-heart"] .training-zone-table').getBoundingClientRect().height > 0`));
    await click('[data-widget="scores"] details summary');
    assert.ok(await js(`document.querySelector('[data-widget="scores"] .training-threshold-grid').getBoundingClientRect().height > 0`));
    await load('3-standard');
    await new Promise(r => setTimeout(r, 1100));
    assert.ok(await js(`Array.from(document.querySelectorAll('.training-zone-donut')).every(el => el.getBoundingClientRect().height >= 70 && el.querySelector('svg'))`), 'Donut charts have real dimensions and render');
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-profile-cards.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(430, 950);
    await new Promise(r => setTimeout(r, 500));
    assert.ok(await js(`Array.from(document.querySelectorAll('.panel[data-chart-size]')).every(el => el.scrollWidth <= el.clientWidth+1)`));
    assert.ok(await js(`(() => { const cards=Array.from(document.querySelectorAll('[data-widget]')).map(el=>el.getBoundingClientRect());return cards.every((r,i)=>cards.slice(0,i).every(o=>r.right<=o.left+1||o.right<=r.left+1||r.bottom<=o.top+1||o.bottom<=r.top+1)); })()`));
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/chart-sizing.html`);
    await until(`document.querySelector('.training-zone-body-empty')`);
    assert.ok(await js(`(() => {const card=document.querySelector('.training-zone-panel-rpe'); const body=card.querySelector('.training-zone-body-empty'); return Math.abs(card.getBoundingClientRect().height-224)<2 && body.clientWidth>card.clientWidth-30 && getComputedStyle(body).display==='flex';})()`), 'Empty RPE uses the full card width and compact height');
    assert.deepEqual(errors, []);
    console.log('Profile widgets: shared heights, compact layouts, breakdowns, narrow widths and packing passed.');
  } finally { win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
