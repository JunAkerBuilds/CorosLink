// Local-Only Mode cards for the watch's own figures: VO₂ max, the recovery-time countdown (injected clock), and
// Base Fitness / Load Impact / fatigue; then the Overview's readiness card built on the same recovery time.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const temp = path.join(os.tmpdir(), `coroslink-watch-figures-${process.pid}`);
app.setPath('userData', path.join(temp, 'user-data'));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await vite.listen();
  const win = new BrowserWindow({ show: false, width: 800, height: 2400 });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('ERR_')) errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  async function until(code) {
    for (let i = 0; i < 150; i++) { if (await js(code)) return; await new Promise(r => setTimeout(r, 100)); }
    throw Error(`Timed out: ${code}`);
  }
  const text = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/watch-figures-local.html`);
    await until(`document.querySelectorAll('.vo2-widget-panel').length === 3 && document.querySelectorAll('.training-ring-panel').length === 4`);

    // VO₂ max
    // The card keeps its title; where the figure comes from is a small line under it.
    assert.equal(await text('#with .vo2-widget-panel h2'), 'Running engine');
    assert.equal(await text('#with .vo2-widget-panel .card-source-note'), 'From your watch');
    assert.equal(await text('#with .vo2-gauge-value'), '43', "the watch's latest figure");
    assert.equal(await text('#without .vo2-gauge-value'), '-', 'no figure before the watch has one');
    assert.equal(await js(`document.querySelector('#without .vo2-gauge-needle')`), null, 'no needle reading as the minimum');
    assert.equal(await text('#cloud .vo2-widget-panel h2'), 'Running engine', 'COROS account data keeps its title');
    assert.equal(await js(`document.querySelector('#cloud .card-source-note')`), null);
    assert.ok(!(await text('#with')).includes('Not available'));

    // Recovery: 14 h left at 08:00 for 22:00, counted down from the (injected) clock and never negative.
    const recovering = () => js(`[document.querySelector('#recovering .storage-ring-label strong').textContent, document.querySelector('#recovering .training-ring-message').textContent]`);
    assert.deepEqual(await recovering(), ['14 h', 'Recovered in 14 h']);
    const setClock = async (iso, expected) => {
      await js(`window.setWatchClock(${Date.parse(iso)}); void 0`);
      await until(`document.querySelector('#recovering .storage-ring-label strong').textContent === ${JSON.stringify(expected[0])}`);
      assert.deepEqual(await recovering(), expected, iso);
    };
    await setClock('2026-10-19T21:50:00Z', ['1 h', 'Recovered in 1 h']);
    await setClock('2026-10-19T22:00:00Z', ['Recovered', 'From your watch']);
    await setClock('2026-10-21T09:00:00Z', ['Recovered', 'From your watch']);
    assert.equal(await text('#no-recovery .storage-ring-label strong'), '–');
    assert.equal(await text('#no-recovery .training-ring-message'), 'No data yet.');
    assert.equal(await js(`document.querySelector('#no-recovery .storage-ring').getAttribute('aria-label')`), 'No data yet.', 'not "0% recovery"');
    // "Waiting" on paper: at least 4.5:1 against the card.
    await js(`document.documentElement.dataset.theme = 'paper'; void 0`);
    await new Promise(r => setTimeout(r, 200));
    const waitingContrast = await js(`(() => {
      const el = document.querySelector('#no-recovery .storage-ring-label span');
      const parse = text => { const n = text.match(/[\\d.]+/g).map(Number); const rgb = text.startsWith('color(') ? n.slice(0, 3) : n.slice(0, 3).map(v => v / 255); return [...rgb, n[3] ?? 1]; };
      const layers = []; for (let node = el; node; node = node.parentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      const bg = layers.reverse().reduce((under, c) => under.map((v, i) => c[i] * c[3] + v * (1 - c[3])), [1, 1, 1]);
      const fg = parse(getComputedStyle(el).color); const text = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const lum = c => { const [r, g, b] = c.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const [x, y] = [lum(text), lum(bg)].sort((p, q) => q - p); return { label: el.textContent, ratio: (x + 0.05) / (y + 0.05) };
    })()`);
    assert.equal(waitingContrast.label, 'Waiting');
    assert.ok(waitingContrast.ratio >= 4.5, `paper "Waiting" contrast ${waitingContrast.ratio.toFixed(2)}`);
    await js(`delete document.documentElement.dataset.theme; void 0`);
    assert.ok(!(await text('#no-recovery')).includes('Not available'), 'no Local-Only "not available" state');
    assert.equal(await text('#cloud-recovery .storage-ring-label strong'), '82%', "COROS's recovery % wins when there is one");

    // Base Fitness, Load Impact, fatigue
    const grid = (id) => js(`Array.from(document.querySelectorAll('#${id} .training-threshold-grid > div')).map(d => [d.querySelector('span').textContent, d.querySelector('strong').textContent])`);
    const balance = await grid('balance');
    assert.deepEqual(balance.slice(0, 3), [['Base Fitness', '50'], ['Load Impact', '72'], ['Fatigue', '144%']]);
    assert.equal(balance[3][0], 'Updated');
    assert.equal(await text('#no-balance .training-empty-state'), 'No data yet.', 'one line before the watch has figures');
    assert.equal(await js(`document.querySelectorAll('#no-balance .training-threshold-grid').length`), 0);
    assert.deepEqual([await text('#balance h2'), await text('#balance .card-source-note')], ['Fitness and fatigue', 'From your watch']);
    await setClock('2026-10-19T08:00:00Z', ['14 h', 'Recovered in 14 h']);
    assert.equal(await text('#days-recovery .storage-ring-label strong'), '14 h', 'the summary takes the latest day with a recovery time');
    assert.deepEqual((await grid('days-balance')).slice(0, 3), [['Base Fitness', '41'], ['Load Impact', '33'], ['Fatigue', '80%']]);
    assert.deepEqual(errors, []);

    // Overview readiness: the watch's recovery time, or a sync in CorosLink, never the COROS app.
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/overview-local.html`);
    await until(`document.querySelectorAll('.overview-readiness').length === 3`);
    const readiness = (id) => js(`[document.querySelector('#${id} .overview-readiness-copy h2').textContent, document.querySelector('#${id} .overview-readiness-copy p').textContent, document.querySelector('#${id} .overview-ring-label strong').textContent]`);
    assert.deepEqual(await readiness('recovering'), ['Recovering · 14 h left', "You're still recovering. Easy to moderate effort today.", '14h']);
    assert.equal(await js(`document.querySelector('#recovering .overview-ring').getAttribute('aria-label')`), 'Recovered in 14 h');
    assert.deepEqual((await readiness('recovered')).slice(0, 2), ['Recovered', "Your watch counts you as fully recovered. You're cleared for a hard session."]);
    assert.deepEqual(await readiness('empty'), ['Waiting for a sync', "Sync your watch to see today's recovery.", '–']);
    assert.equal(await js(`document.querySelectorAll('.overview-readiness-sync').length`), 1, 'only the card without watch data offers a sync');
    assert.equal(await js(`document.querySelector('#empty .overview-readiness-sync').textContent`), 'Sync watch now');
    await js(`document.querySelector('#empty .overview-readiness-sync').click(); void 0`);
    assert.equal(await js(`window.overviewCalls.sync`), 1);
    assert.equal(await text('#empty .overview-today .overview-card-sub'), 'From your calendar');
    assert.ok(!(await text('main')).includes('COROS app'));
    // Connected Mode keeps the COROS wording.
    await js(`window.setLocalOnly(false); void 0`);
    await until(`document.querySelector('#empty .overview-readiness-copy p').textContent.includes('COROS app')`);
    assert.equal(await js(`document.querySelectorAll('.overview-readiness-sync').length`), 0);
    assert.equal(await text('#recovering .overview-readiness-copy h2'), 'Waiting for a sync');
    assert.equal(await text('#empty .overview-today .overview-card-sub'), 'From your COROS calendar');
    assert.deepEqual(errors, []);
    console.log('Watch figures (Local-Only Mode): VO2 max, recovery countdown, Base Fitness / Load Impact / fatigue, Overview readiness');
  } finally {
    await vite.close();
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
