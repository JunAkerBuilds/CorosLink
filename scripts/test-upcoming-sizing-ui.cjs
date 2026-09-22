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
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/upcoming-sizing.html`);
    await until(`document.querySelectorAll('.training-upcoming-today').length === 2`);
    for (const [size, count, height] of [['mini', 1, 224], ['short', 3, 320]]) {
      const selector = `.training-upcoming-panel[data-chart-size="${size}"]`;
      assert.equal(await js(`document.querySelectorAll('${selector} .training-upcoming-today, ${selector} .training-upcoming-row').length`), count);
      assert.ok(await js(`document.querySelector('${selector} .training-upcoming-today-icon') && document.querySelector('${selector} .training-upcoming-today-pill')`));
      const actual = await js(`document.querySelector('${selector}').getBoundingClientRect().height`);
      assert.ok(Math.abs(actual-height)<2, `${size}: ${actual}`);
      await click(`${selector} .upcoming-sized-more`);
      await until(`document.querySelectorAll('${selector} .training-upcoming-today, ${selector} .training-upcoming-row').length === 10`);
      await click(`${selector} .upcoming-sized-more`);
    }
    await new Promise(r => setTimeout(r, 800));
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-upcoming-compact.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(430, 950);
    await new Promise(r => setTimeout(r, 400));
    assert.ok(await js(`Array.from(document.querySelectorAll('.training-upcoming-panel')).every(el=>el.scrollWidth<=el.clientWidth+1)`));
    win.setSize(1800, 1100);
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    await until(`document.querySelector('.training-hub-sample-button')`);
    await js(`localStorage.setItem('coroslink.training-dashboard.v1.sample', JSON.stringify({version:3, widgets:[{id:'scores',preset:'3-standard'},{id:'race',preset:'3-standard'},{id:'effort',preset:'3-standard'},{id:'upcoming',preset:'3-short'}]})); void 0`);
    await click('.training-hub-sample-button');
    const aligned = `(() => {const cards=['scores','race','effort','upcoming'].map(id=>document.querySelector('[data-widget="'+id+'"]')); if(cards.some(card=>!card)) return false; const rects=cards.map(card=>card.getBoundingClientRect());return rects.every(r=>Math.abs(r.top-rects[0].top)<1 && Math.abs(r.bottom-rects[0].bottom)<1);})()`;
    await until(aligned);
    await click('.hub-dashboard-edit');
    await until(aligned);
    await click('.hub-dashboard-edit');
    assert.equal(await js(`document.querySelector('[data-widget="upcoming"]').dataset.preset`), '3-short');
    win.setSize(430,950);
    await until(`!document.querySelector('[data-widget="upcoming"]').style.getPropertyValue('--widget-aligned-height')`);
    win.setSize(1800,1100);
    await until(aligned);
    assert.deepEqual(errors, []);
    console.log('Upcoming compact previews preserve Today styling, expand all workouts, collapse and fit narrow widths.');
  } finally { win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
