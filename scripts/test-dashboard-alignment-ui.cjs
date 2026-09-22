const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const temporaryRoot = path.join(os.tmpdir(), `coroslink-alignment-${process.pid}`);
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
      throw new Error(`Timed out: ${code}; rectangles: ${JSON.stringify(await js(`Array.from(document.querySelectorAll('[data-widget]')).map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.widget, top: r.top, height: r.height, left: r.left, aligned: el.style.getPropertyValue('--widget-aligned-height') }; })`))}`);
    }
    const count = `document.querySelectorAll('[data-widget]').length`;
    const saved = `JSON.parse(localStorage.getItem('coroslink.training-dashboard.v1.sample')).widgets`;
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/training-dashboard.html`);
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await js(`localStorage.setItem('coroslink.training-dashboard.v1.sample', JSON.stringify({ version: 3, widgets: [
      { id: 'recovery', size: 3 }, { id: 'fitness', size: 6 }, { id: 'vo2', size: 3 },
      { id: 'daily-heart', preset: 'compact-square', startRow: true }, { id: 'daily-steps', preset: 'compact-square' },
      { id: 'sleep', size: 6 }, { id: 'healthCheck', preset: '3-mini' },
      { id: 'daily-calories', preset: 'compact-square', startRow: true }, { id: 'daily-load', preset: 'compact-square' }
    ] })); void 0`);
    await click('.training-hub-sample-button');
    await until(count, n => n === 9);
    const aligned = `(() => {
      const rect = id => document.querySelector('[data-widget="' + id + '"]').getBoundingClientRect();
      const recovery = rect('recovery'), fitness = rect('fitness'), heart = rect('daily-heart'), steps = rect('daily-steps'), calories = rect('daily-calories'), load = rect('daily-load');
      const near = (a,b) => Math.abs(a-b) < 1;
      const panels = ['recovery', 'fitness', 'vo2'].map(id => document.querySelector('[data-widget="' + id + '"] .hub-widget-content > .panel').getBoundingClientRect());
      const health = document.querySelector('[data-widget="healthCheck"] .health-insight-card').getBoundingClientRect();
      const sleep = rect('sleep');
      const metricsFit = [...document.querySelectorAll('[data-compact]')].every(wrapper => {
        const outer = wrapper.getBoundingClientRect();
        const card = wrapper.querySelector('.training-stat-card').getBoundingClientRect();
        return card.left >= outer.left - 1 && card.right <= outer.right + 1
          && card.top >= outer.top - 1 && card.bottom <= outer.bottom + 1;
      });
      return metricsFit && sleep.height >= panels[0].height && near(health.top, sleep.top) && near(health.bottom, sleep.bottom) && panels.every(panel => near(panel.height, panels[0].height))
        && near(rect('vo2').bottom, recovery.bottom)
        && near(recovery.bottom, fitness.bottom) && near(heart.left, recovery.left) && near(steps.right, recovery.right)
        && near(heart.top, steps.top) && near(calories.top, load.top) && near(heart.left, calories.left) && near(steps.right, load.right)
        && near(calories.bottom, Math.max(sleep.bottom, heart.top + 152 * 2 + 16))
        && near(heart.top, recovery.bottom + 16) && near(calories.top, heart.bottom + 16);
    })()`;
    for (const width of [1350, 1500, 1800]) {
      win.setSize(width, 1000);
      await until(aligned);
      await click('.hub-dashboard-edit');
      await until(aligned);
      await click('.hub-dashboard-edit');
      await until(aligned);
      if (width === 1350) {
        await js(`document.querySelector('main').scrollTop = 350; void 0`);
        await fs.writeFile(path.join(os.tmpdir(), 'coroslink-adaptive-metrics.png'), (await win.webContents.capturePage()).toPNG());
        await js(`document.querySelector('main').scrollTop = 0; void 0`);
      }
    }
    await new Promise(r => setTimeout(r, 250));
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-dashboard-aligned.png'), (await win.webContents.capturePage()).toPNG());
    for (const width of [1200, 950, 430]) {
      win.setSize(width, 950);
      await new Promise(r => setTimeout(r, 350));
      assert.ok(await js(`(() => {
        const cards = [...document.querySelectorAll('[data-widget]')].map(card => card.getBoundingClientRect());
        return cards.every((a,i) => cards.slice(i+1).every(b => a.right <= b.left+1 || b.right <= a.left+1 || a.bottom <= b.top+1 || b.bottom <= a.top+1))
          && [...document.querySelectorAll('[data-compact]')].every(wrapper => {
            const card = wrapper.querySelector('.training-stat-card');
            const outer = wrapper.getBoundingClientRect(), inner = card.getBoundingClientRect();
            return inner.left >= outer.left - 1 && inner.right <= outer.right + 1
              && (wrapper.style.getPropertyValue('--compact-adaptive-height') || Math.abs(card.clientWidth - card.clientHeight) <= 2);
          });
      })()`), 'Responsive cards stay within their wrappers and remain square when not aligned to a neighbor');
    }
    // Reproduce the reported gap using the existing saved row flag, without resetting the layout.
    win.setSize(1800, 1100);
    await js(`localStorage.setItem('coroslink.training-dashboard.v1.sample', JSON.stringify({ version: 3, widgets: [
      { id: 'recovery', size: 6 }, { id: 'fitness', size: 6 },
      { id: 'daily-heart', size: 3 }, { id: 'daily-steps', size: 3 }, { id: 'vo2', size: 6 },
      { id: 'daily-load', size: 3, startRow: true }, { id: 'daily-calories', size: 3 }
    ] })); void 0`);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(count, n => n === 7);
    const noGap = `(() => {
      const rect = id => document.querySelector('[data-widget="' + id + '"]').getBoundingClientRect();
      const heart = rect('daily-heart'), steps = rect('daily-steps'), load = rect('daily-load'), calories = rect('daily-calories'), vo2 = rect('vo2');
      return Math.abs(load.top - heart.bottom - 16) < 1 && Math.abs(calories.top - steps.bottom - 16) < 1
        && Math.abs(load.left - heart.left) < 1 && Math.abs(calories.left - steps.left) < 1 && load.top < vo2.bottom;
    })()`;
    await until(noGap);
    await click('.hub-dashboard-edit');
    await until(noGap);
    await click('.hub-dashboard-edit');
    await until(noGap);
    await new Promise(r => setTimeout(r, 200));
    await fs.writeFile(path.join(os.tmpdir(), 'coroslink-dashboard-gap-fixed.png'), (await win.webContents.capturePage()).toPNG());
    // The default layout previously squeezed Health Check into a tall single column
    // just above the mobile breakpoint, leaving a large hole before the heatmap.
    await js(`localStorage.removeItem('coroslink.training-dashboard.v1.sample'); void 0`);
    await win.reload();
    await until(`document.querySelector('.training-hub-sample-button') !== null`);
    await click('.training-hub-sample-button');
    await until(count, n => n === 22);
    for (const width of [920, 1000, 1150, 430, 1500]) {
      win.setSize(width, 1000);
      await new Promise(r => setTimeout(r, 400));
      assert.ok(await js(`(() => {
        const grid = document.querySelector('.hub-dashboard-grid').getBoundingClientRect();
        const cards = [...document.querySelectorAll('[data-widget]')].map(card => card.getBoundingClientRect());
        return cards.every((a,i) => a.left >= grid.left - 1 && a.right <= grid.right + 1
          && cards.slice(i+1).every(b => a.right <= b.left+1 || b.right <= a.left+1 || a.bottom <= b.top+1 || b.bottom <= a.top+1));
      })()`), 'Default cards stay inside the dashboard without overlapping');
      if (width >= 920 && width <= 1150) {
        assert.ok(await js(`(() => {
          const rect = id => document.querySelector('[data-widget="' + id + '"]').getBoundingClientRect();
          const grid = document.querySelector('.hub-dashboard-grid').clientWidth;
          const health = document.querySelector('[data-widget="healthCheck"] .health-vitals');
          return ['healthCheck', 'vo2', 'trend-load', 'scores', 'race', 'upcoming'].every(id => Math.abs(rect(id).width - (grid - 16) / 2) < 1)
            && health.children[0].getBoundingClientRect().top === health.children[1].getBoundingClientRect().top;
        })()`), 'Intermediate layouts give detailed panels half a row and keep health readings side by side');
      }
      if (width === 1000) await fs.writeFile(path.join(os.tmpdir(), 'coroslink-dashboard-responsive.png'), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log('Dashboard alignment passed: shared panel baseline, paired squares, 2 × 2 spacing, edit mode and responsive layout.');
  } finally { clearTimeout(watchdog); win?.destroy(); await vite?.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
