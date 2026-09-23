const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temporaryRoot = path.join(os.tmpdir(), `coroslink-activities-${process.pid}`);
app.setPath('userData', path.join(temporaryRoot, 'user-data'));
app.on('window-all-closed', () => {});
async function until(read, accept, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let window, vite;
  const errors = [];
  const watchdog = setTimeout(() => app.exit(1), 90000);
  try {
    vite = await createServer({ root, configFile: false, plugins: [react()], cacheDir: path.join(temporaryRoot, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 1556, height: 1000, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_')) errors.push(event.message); });
    const js = code => window.webContents.executeJavaScript(code, true).catch(error => {
      throw new Error(`${error.message}\nScript: ${code}\nRenderer errors: ${errors.join('\n')}`);
    });
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click(); void 0`);
    const count = selector => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const cards = () => count('.activity-card');
    const input = value => js(`(() => { const input = document.querySelector('input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-activities.html`);
    await until(cards, n => n === 9, 'grid');
    await until(() => count('.has-route'), n => n >= 6, 'GPS previews');
    await until(() => count('.activity-card-map .leaflet-tile-loaded'), n => n > 0, 'map tiles');
    assert.equal(await js(`getComputedStyle(document.querySelector('.activities-card-grid')).gridTemplateColumns.split(' ').length`), 4);
    assert.ok(await js('window.activitiesTest.maxActive <= 3'), 'Bound route fetch concurrency');
    assert.equal(await js(`document.querySelector('.activities-summary strong').textContent`), '9');
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-activities-desktop.png'), (await window.webContents.capturePage()).toPNG());
    await click('.activities-sport-filters .activity-sport-swim');
    await until(cards, n => n === 1, 'swim filter');
    assert.match(await js(`document.querySelector('.activity-card-primary').textContent`), /14:50 \/100m/);
    await js(`window.setTestUnits('imperial'); void 0`);
    await until(() => js(`document.querySelector('.activity-card-primary').textContent`), value => value.includes('/100yd'), 'swim imperial pace');
    await js(`window.setTestUnits('metric'); void 0`);
    await click('.activities-sport-filters .activity-sport-all');
    await input('hamilton');
    await until(cards, n => n === 1, 'search');
    await js(`localStorage.setItem('coroslink.selection.v1.training.activityRoute.baseLayer', JSON.stringify('light')); void 0`);
    await click('.activity-card-body');
    await until(() => count('dialog[open]'), n => n === 1, 'detail dialog');
    assert.match(await js(`document.querySelector('dialog').textContent`), /Hamilton Run/);
    await click('.activity-route-expand');
    await until(() => count('dialog .activity-route-modal-backdrop'), n => n === 1, 'expanded route within modal');
    await until(() => count('dialog .activity-route-modal-map .activity-route-base-tile img.leaflet-tile'), n => n > 0, 'expanded street tiles');
    assert.ok(await js(`Array.from(document.querySelectorAll('dialog .activity-route-base-tile img.leaflet-tile')).every(tile => new URL(tile.src).hostname.endsWith('.tile.openstreetmap.org'))`), 'Detail and expanded maps use the same OpenStreetMap provider as previews');
    assert.ok(await js(`Array.from(document.querySelectorAll('dialog .activity-route-map-canvas')).every(map => map.classList.contains('is-dark-street'))`), 'Detail and expanded maps share the dark street styling');
    await click('dialog [aria-label="Change base map"]');
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('dialog .route-basemap-option > strong'), el => el.textContent)`), ['Street', 'Outdoors', 'Topo', 'Satellite', 'Hiking routes', 'Cycle routes', 'MTB routes']);
    // Fake key only: cancel CARTO requests so this verifies URL construction without using a real account.
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*.basemaps.cartocdn.com/*'] }, (_details, callback) => callback({ cancel: true }));
    await js(`window.corosLink = { getRouteBuilderConfig: async () => ({ cartoApiKey: 'test-carto-key' }) }; window.dispatchEvent(new Event('coroslink:carto-settings-changed')); void 0`);
    await until(() => js(`Array.from(document.querySelectorAll('dialog .route-basemap-option > strong')).some(el => el.textContent === 'Light')`), Boolean, 'CARTO layers enabled');
    await js(`Array.from(document.querySelectorAll('dialog .route-basemap-option')).find(el => el.querySelector('strong')?.textContent === 'Light').click(); void 0`);
    await until(() => js(`Array.from(document.querySelectorAll('dialog .activity-route-base-tile img.leaflet-tile')).some(tile => tile.src.includes('cartocdn.com') && new URL(tile.src).searchParams.get('key') === 'test-carto-key')`), Boolean, 'CARTO key on tile URL');
    await js(`window.corosLink = undefined; window.dispatchEvent(new Event('coroslink:carto-settings-changed')); void 0`);
    await until(() => js(`Array.from(document.querySelectorAll('dialog .activity-route-base-tile img.leaflet-tile')).every(tile => new URL(tile.src).hostname.endsWith('.tile.openstreetmap.org'))`), Boolean, 'key removal falls back to OSM');
    await click('[aria-label="Close expanded map"]');
    // Wait for the native close event before reopening: removing [open] happens
    // earlier, and a queued close event can otherwise close the next dialog.
    await js(`new Promise(resolve => {
      document.querySelector('dialog[open]').addEventListener('close', () => resolve(true), { once: true });
      document.querySelector('[aria-label="Close activity details"]').click();
    })`);
    await until(() => count('dialog[open]'), n => n === 0, 'close detail');
    await js(`localStorage.setItem('coroslink.selection.v1.training.activityRoute.baseLayer', JSON.stringify('dark')); void 0`);
    await click('.activity-card-body');
    await until(() => count('dialog .activity-route-base-tile img.leaflet-tile'), n => n > 0, 'saved dark layer falls back');
    assert.ok(await js(`Array.from(document.querySelectorAll('dialog .activity-route-base-tile img.leaflet-tile')).every(tile => new URL(tile.src).hostname.endsWith('.tile.openstreetmap.org'))`), 'Previously saved Dark uses OpenStreetMap');
    await click('[aria-label="Close activity details"]');
    await click('.activity-card-menu');
    await until(() => count('[role="menuitem"]'), n => n > 0, 'export menu');
    await click('[role="menuitem"]');
    assert.equal(await js('window.activitiesTest.exports.length'), 1);
    await input('nothing-matches');
    await until(() => count('.activities-empty'), n => n === 1, 'empty state');
    await click('.activities-empty button');
    await until(cards, n => n === 9, 'reset filters');
    await click('[aria-label="List view"]');
    await until(() => count('.activities-list-view tbody tr'), n => n === 9, 'list view');
    await until(() => count('.activities-detail-sidebar'), n => n === 1, 'table sidebar');
    assert.ok(await js(`(() => {
      const summary = document.querySelector('.activities-detail-sidebar').getBoundingClientRect();
      const table = document.querySelector('.activities-list-view').getBoundingClientRect();
      return summary.left > table.right && summary.width <= 928 && Math.abs(summary.top - table.top) < 2;
    })()`), 'Selected activity details are compact and on the right');
    await js(`new Promise(resolve => setTimeout(resolve, 250))`);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-activities-table.png'), (await window.webContents.capturePage()).toPNG());
    await click('.training-activity-export button');
    await until(() => count('[role="menuitem"]'), n => n > 0, 'table export menu');
    assert.equal(await count('dialog[open]'), 0, 'Export does not open activity');
    await click('[role="menuitem"]');
    assert.equal(await js('window.activitiesTest.exports.length'), 2);
    await js(`document.querySelector('.training-table-row').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); void 0`);
    await until(() => js(`document.querySelector('.activities-detail-sidebar h2').textContent`), name => name === 'Ottawa Run', 'keyboard table details');
    assert.equal(await count('dialog[open]'), 0, 'Table details do not open a modal');
    await click('.training-table-row:nth-child(2)');
    await until(() => js(`document.querySelector('.activities-detail-sidebar h2').textContent`), name => name === 'Open Water', 'select another row with sidebar open');
    await click('.activities-detail-sidebar .training-export-button');
    await until(() => count('[role="menuitem"]'), n => n > 0, 'sidebar export');
    await click('[role="menuitem"]');
    assert.equal(await js('window.activitiesTest.exports.length'), 3);
    await click('.activities-detail-sidebar .activity-route-expand');
    await until(() => count('.activity-route-modal-backdrop'), n => n === 1, 'sidebar expanded map');
    await click('[aria-label="Close expanded map"]');
    window.setSize(430, 950);
    await until(() => js(`getComputedStyle(document.querySelector('.activities-results')).gridTemplateColumns.split(' ').length`), n => n === 1, 'table stacks on narrow screens');
    assert.ok(await js(`document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth`), 'Table does not overflow narrow page');
    await js(`window.setTestTheme('paper'); void 0`);
    await until(() => js('document.documentElement.dataset.theme'), theme => theme === 'paper', 'paper table');
    await js(`new Promise(resolve => setTimeout(resolve, 250))`);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-activities-table-mobile.png'), (await window.webContents.capturePage()).toPNG());
    await js(`window.setTestTheme('dark'); void 0`);
    window.setSize(1556, 1000);

    await click('.activities-detail-sidebar [aria-label="Close activity details"]');
    await until(() => count('.activities-detail-sidebar'), n => n === 0, 'close sidebar');
    await click('[aria-label="Calendar view"]');
    await until(() => count('.activities-calendar-day button'), n => n === 9, 'calendar view');
    await click('[aria-label="Previous month"]');
    await until(() => count('.activities-calendar-day button'), n => n === 0, 'calendar month navigation');
    await click('[aria-label="Grid view"]');
    await until(cards, n => n === 9, 'return to grid');
    await js(`document.querySelector('main').scrollTop = 1000; void 0`);
    await until(() => js(`document.querySelector('.activities-browser').textContent`), value => value.includes('Route preview unavailable'), 'failed route fallback');
    assert.match(await js(`document.querySelector('.activities-browser').textContent`), /No GPS track recorded/);
    window.setSize(780, 1000);
    await until(() => js(`getComputedStyle(document.querySelector('.activities-card-grid')).gridTemplateColumns.split(' ').length`), n => n === 2, 'two columns');
    window.setSize(430, 950);
    await until(() => js(`getComputedStyle(document.querySelector('.activities-card-grid')).gridTemplateColumns.split(' ').length`), n => n === 1, 'one column');
    const overflow = await js(`({ width: document.querySelector('main').clientWidth, scrollWidth: document.querySelector('main').scrollWidth, wide: [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > innerWidth).map(el => ({ class: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).slice(0, 12) })`);
    assert.ok(overflow.scrollWidth <= overflow.width, `No narrow horizontal overflow: ${JSON.stringify(overflow)}`);
    await js(`document.querySelector('main').scrollTop = 0; window.setTestTheme('paper'); void 0`);
    await until(() => js('document.documentElement.dataset.theme'), theme => theme === 'paper', 'paper theme');
    await js(`new Promise(resolve => setTimeout(resolve, 800))`);
    await js(`document.querySelector('main').scrollTop = 0; void 0`);
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-activities-mobile.png'), (await window.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, [], 'No renderer errors');
    console.log('Activities UI passed: grid, real GPS previews, bounded requests, filters, search, units, details, expanded map, export, empty/error states, list/calendar, responsive layouts and paper theme.');
    console.log(`Screenshots: ${path.join(os.tmpdir(), 'coroslink-activities-desktop.png')} and ${path.join(os.tmpdir(), 'coroslink-activities-mobile.png')}`);
  } finally {
    clearTimeout(watchdog); window?.destroy(); await vite?.close(); await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
