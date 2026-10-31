// A watch swim's activity page: the swim card (pool length, lengths, strokes,
// SWOLF, stroke rate, water temperature), the lap table with stroke, strokes
// and SWOLF, rests, and the lengths view. The detail is built from a synthetic
// pool swim the way a sync builds it (decode → FIT → detail); run
// `npm run build:electron` first. COROSLINK_SWIM_DETAIL=<detail.json> renders
// that detail instead, for a look at a real swim (screenshot only).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temporaryRoot = path.join(os.tmpdir(), `coroslink-swim-detail-${process.pid}`);
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
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
async function syntheticDetail() {
  const { syntheticPoolSwim } = await load('scripts/fixtures/coros-sport-record-fixture.mjs');
  const { decodeCorosSportRecordFile } = await load('dist-electron/localSync/corosSportRecord.js');
  const { corosSessionToFit } = await load('dist-electron/localSync/syncPayloadDecoder.js');
  const { parseFitActivity } = await load('dist-electron/fitActivity.js');
  const { localFitActivityDetail } = await load('dist-electron/localSync/localActivityDetail.js');
  const [session] = decodeCorosSportRecordFile(syntheticPoolSwim().file).sessions;
  return localFitActivityDetail(parseFitActivity(corosSessionToFit(session)), {
    activityId: 'swim', name: 'Pool Swim', sportType: 300, source: 'watch-ble', provenance: 'watch', format: 'fit', sha256: '0'.repeat(64)
  });
}
async function yardDetail() {
  const { syntheticPoolSwimAtTheWall } = await load('scripts/fixtures/coros-sport-record-fixture.mjs');
  const { decodeCorosSportRecordFile } = await load('dist-electron/localSync/corosSportRecord.js');
  const { corosSessionToFit } = await load('dist-electron/localSync/syncPayloadDecoder.js');
  const { parseFitActivity } = await load('dist-electron/fitActivity.js');
  const { localFitActivityDetail } = await load('dist-electron/localSync/localActivityDetail.js');
  const [session] = decodeCorosSportRecordFile(syntheticPoolSwimAtTheWall().file).sessions;
  return localFitActivityDetail(parseFitActivity(corosSessionToFit(session)), {
    activityId: 'yards', name: 'Pool Swim', sportType: 300, source: 'watch-ble', provenance: 'watch', format: 'fit', sha256: '1'.repeat(64)
  });
}
async function main() {
  await app.whenReady();
  const real = process.env.COROSLINK_SWIM_DETAIL;
  const detail = real ? JSON.parse(await fs.readFile(real, 'utf8')) : await syntheticDetail();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let window, vite;
  const errors = [];
  const watchdog = setTimeout(() => app.exit(1), 90000);
  try {
    vite = await createServer({ root, configFile: false, plugins: [react()], cacheDir: path.join(temporaryRoot, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 1700, height: 1500, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_')) errors.push(event.message); });
    const js = code => window.webContents.executeJavaScript(code, true).catch(error => {
      throw new Error(`${error.message}\nScript: ${code}\nRenderer errors: ${errors.join('\n')}`);
    });
    const text = selector => js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), el => el.textContent.trim())`);
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/swim-detail.html`);
    await until(() => js('typeof window.setSwimDetail'), type => type === 'function', 'fixture');
    await js(`window.setSwimDetail(${JSON.stringify(detail)}); void 0`);
    await until(() => js(`document.querySelectorAll('.swim-showcase .training-laps-section tbody tr').length`), n => n > 0, 'lap table');
    // Let the window paint before capturing it.
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300))))');
    const shot = path.join(os.tmpdir(), 'coroslink-swim-detail.png');
    await fs.writeFile(shot, (await window.webContents.capturePage()).toPNG());
    if (real) {
      // The chart with the water temperature, and the laps with the aside switched to lengths.
      await js(`Array.from(document.querySelectorAll('.swim-showcase .activity-channels-chip')).find(b => b.textContent.includes('Water temperature'))?.click(); void 0`);
      await js(`Array.from(document.querySelectorAll('.swim-compact .training-laps-groups button')).find(b => b.textContent === 'Lengths')?.click(); document.querySelector('.swim-showcase .training-laps-section').scrollIntoView(); void 0`);
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300))))');
      const laps = path.join(os.tmpdir(), 'coroslink-swim-detail-laps.png');
      await fs.writeFile(laps, (await window.webContents.capturePage()).toPNG());
      console.log(`Swim detail screenshots: ${shot} ${laps}`);
      return;
    }

    if (process.env.SWIM_UI_DUMP) {
      for (const selector of ['.swim-showcase .activity-detail-stat', '.swim-showcase .activity-effect dl > div', '.swim-showcase .training-laps-section h3', '.swim-showcase .training-laps-section thead th', '.swim-showcase .training-laps-section tbody tr', '.swim-compact .training-laps-section thead th', '.swim-showcase .activity-detail-visuals']) console.log(selector, JSON.stringify(await text(selector)));
      return;
    }
    const stats = await text('.swim-showcase .activity-detail-stat');
    assert.deepEqual(stats, ['Duration2:30', 'Distance75m', 'Avg Pace2:40/100m', 'Swim time2:00', 'Avg HR107bpm', 'Max HR119bpm', 'Calories23kcal'], 'pace per 100 m, swim time, no elevation');
    assert.equal(await js(`document.querySelectorAll('.swim-showcase .activity-detail-visuals').length`), 0, 'no empty route or elevation for a pool swim');
    const card = await text('.swim-showcase .activity-effect dl > div');
    assert.deepEqual(card, [
      'Pool length25m', 'Lengths3', 'Strokes54', 'Avg SWOLF58', 'Best SWOLF56', 'Best pace2:40/100m', 'Avg stroke rate26spm', 'Max stroke rate30spm',
      'Distance per stroke1.39m', 'Water temperature29°C'
    ]);
    assert.deepEqual(await text('.swim-showcase .training-laps-section h3'), ['Intervals 2'], 'a pool swim\'s laps are its intervals; rests are not counted');
    assert.deepEqual(await text('.swim-showcase .training-laps-groups button'), ['Intervals', 'Lengths']);
    assert.ok((await text('.swim-showcase .activity-channels-chip')).includes('Water temperature'), 'water temperature can be charted');
    assert.deepEqual(await text('.swim-showcase .training-laps-section thead th'), ['#', 'Stroke', 'Lengths', 'Distance', 'Duration', 'Pace /100m', 'Strokes', 'SWOLF', 'Stroke rate', 'Avg HR', 'Max HR']);
    assert.deepEqual(await text('.swim-showcase .training-laps-section tbody tr'), [
      '1Mixed250 m1:202:40345725108119', 'Rest0:30101108', '2Backstroke125 m0:402:40206030112118'
    ], 'rests unnumbered, without the figures they don\'t have');
    assert.equal(await js(`document.querySelectorAll('.swim-showcase tr.is-rest').length`), 1, 'the rest row is marked');
    await js(`Array.from(document.querySelectorAll('.swim-showcase .training-laps-groups button')).find(b => b.textContent === 'Lengths').click(); void 0`);
    await until(() => text('.swim-showcase .training-laps-section tbody tr'), rows => rows.length === 4, 'lengths view');
    assert.deepEqual(await text('.swim-showcase .training-laps-section h3'), ['Lengths 3']);
    assert.deepEqual(await text('.swim-showcase .training-laps-section tbody tr'), [
      '1Freestyle25 m0:402:40165624105112', '2Breaststroke25 m0:402:40185827110119', 'Rest0:30101108',
      '3Backstroke25 m0:402:40206030112118'
    ]);
    // The calendar aside keeps six columns.
    assert.deepEqual(await text('.swim-compact .training-laps-section thead th'), ['#', 'Stroke', 'Duration', 'Distance', 'SWOLF', 'Avg HR']);
    // A narrow dialog keeps the essentials.
    await js(`document.querySelector('.swim-showcase .training-laps-section').style.width = '620px'; void 0`);
    await until(() => js(`Array.from(document.querySelectorAll('.swim-showcase thead th')).filter(th => getComputedStyle(th).display !== 'none').map(th => th.textContent)`),
      shown => shown.join() === '#,Stroke,Distance,Duration,Pace /100m,SWOLF,Avg HR', 'narrow swim table');
    assert.ok(await js(`(() => { const shell = document.querySelector('.swim-showcase .table-shell'); return shell.scrollWidth <= shell.clientWidth + 1; })()`), 'no sideways scroll when narrow');
    await js(`document.querySelector('.swim-showcase .training-laps-section').style.width = ''; void 0`);

    // A metre pool reads in metres whatever the app's units; the water temperature follows them.
    await js(`window.setTestUnits('imperial'); void 0`);
    await until(() => text('.swim-showcase .activity-effect dl > div'), items => items.includes('Water temperature84°F'), 'imperial temperature');
    assert.equal((await text('.swim-showcase .activity-effect dl > div'))[0], 'Pool length25m');
    assert.ok((await text('.swim-showcase .training-laps-section thead th')).includes('Pace /100m'));
    await js(`window.setTestUnits('metric'); window.setTestLanguage('fr'); void 0`);
    await until(() => text('.swim-showcase .training-laps-section thead th'), th => th[1] === 'Nage', 'French');
    assert.deepEqual(await text('.swim-showcase .training-laps-groups button'), ['Intervalles', 'Longueurs']);
    assert.deepEqual((await text('.swim-showcase .activity-effect dl > div')).slice(0, 4), ['Longueur du bassin25m', 'Longueurs3', 'Mouvements54', 'SWOLF moy.58']);
    assert.ok((await text('.swim-showcase .activity-detail-stat')).includes('Temps de nage2:00'));
    await js(`window.setTestLanguage('en'); void 0`);

    // The fastest interval is marked with its pace (and with its time in the aside); a rest never is.
    await js(`window.setSwimDetail(${JSON.stringify({ ...detail, lapGroups: detail.lapGroups.map((group, index) => (index === 0 ? { ...group, fastestLaps: [2] } : group)) })}); void 0`);
    await js(`Array.from(document.querySelectorAll('.swim-showcase .training-laps-groups button')).find(b => b.textContent === 'Intervals').click(); void 0`);
    await until(() => js(`document.querySelectorAll('.swim-showcase tr.is-fastest .training-lap-fastest').length`), n => n === 1, 'fastest interval');
    assert.match(await js(`document.querySelector('.swim-showcase tr.is-fastest').textContent`), /^2Backstroke.*2:40Fastest/);
    assert.match(await js(`document.querySelector('.swim-compact tr.is-fastest').textContent`), /0:40Fastest/);

    // A yard pool reads in yards, even with metric units.
    await js(`window.setSwimDetail(${JSON.stringify(await yardDetail())}); void 0`);
    await until(() => text('.swim-showcase .activity-effect dl > div'), items => items[0] === 'Pool length25yd', 'yard pool');
    assert.ok((await text('.swim-showcase .activity-detail-stat')).includes('Distance125yd'));
    assert.deepEqual(errors, []);
    console.log(`Swim detail UI passed: swim card, pace per 100 m and swim time, no empty route, intervals with stroke, strokes, SWOLF and stroke rate, unnumbered rests, the fastest marked, lengths view, water temperature chart, compact aside, narrow table, pool units, French. Screenshot: ${shot}`);
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite?.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; app.exit(1); });
