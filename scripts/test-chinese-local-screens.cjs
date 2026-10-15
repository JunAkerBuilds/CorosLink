// Integrated French and Chinese coverage for the latest desktop screens.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), `coroslink-chinese-local-${process.pid}`));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], cacheDir: path.join(app.getPath('userData'), 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  const win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const watchdog = setTimeout(() => { console.error(errors); app.exit(1); }, 60000);
  async function until(code) {
    for (let i = 0; i < 160; i++) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(`Timed out: ${code}\n${await js('document.body.innerText')}\n${errors.join('\n')}`);
  }
  async function fill(selector, value) {
    await js(`{ const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await until(`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`);
  }
  async function capture(name) {
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await new Promise(resolve => setTimeout(resolve, 200));
    const filename = path.join(app.getPath('userData'), `${name}.png`);
    await fs.writeFile(filename, (await win.webContents.capturePage()).toPNG());
    console.log(`Localization review screenshot: ${filename}`);
  }
  try {
    await vite.listen();
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/chinese-local-screens.html`);
    const name = '.race-field input[type=text]';
    await until(`Boolean(document.querySelector(${JSON.stringify(name)}))`);
    await fill(name, 'Back $& 我的比赛');
    await js(`document.querySelector('.race-editor-surface').requestSubmit()`);
    await until(`document.querySelector('.race-editor-error') || document.querySelector('[role=alert]')`);
    await js(`switchLocalLanguage('fr')`);
    await until(`document.body.innerText.includes('Nom de la course')`);
    assert.equal(await js(`document.querySelector(${JSON.stringify(name)}).value`), 'Back $& 我的比赛');
    assert.match(await js(`document.querySelector('[role=alert]').textContent`), /temps d’arrivée/);
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.body.innerText.includes('比赛名称')`);
    assert.equal(await js(`document.querySelector(${JSON.stringify(name)}).value`), 'Back $& 我的比赛');
    assert.match(await js(`document.querySelector('[role=alert]').textContent`), /时间/);
    await fill('.race-field input[inputmode=numeric]', '22:11');
    await js(`document.querySelector('.race-editor-surface').requestSubmit()`);
    await until(`localScreenState.saves.length === 1`);
    assert.equal(await js('localScreenState.saves[0].name'), 'Back $& 我的比赛');
    assert.equal(await js('localScreenState.saves[0].distanceKey'), '5k');

    await js(`showLocalScreen('tour'); switchLocalLanguage('en')`);
    await until(`document.querySelectorAll('.onb-step').length === 9`);
    await js(`document.querySelectorAll('.onb-step')[3].click()`);
    await until(`document.querySelectorAll('.onb-step')[3].getAttribute('aria-current') === 'step'`);
    await js(`switchLocalLanguage('fr')`);
    await until(`document.querySelector('.onb-title')?.textContent.includes('Planifiez')`);
    assert.equal(await js(`document.querySelectorAll('.onb-step')[3].getAttribute('aria-current')`), 'step');
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.querySelector('.onb-title')?.textContent.includes('规划训练')`);
    assert.equal(await js(`document.querySelectorAll('.onb-step')[3].getAttribute('aria-current')`), 'step');

    await js(`showLocalScreen('route'); switchLocalLanguage('en')`);
    await until(`Boolean(document.querySelector('.route-makeup-toggle'))`);
    await js(`document.querySelector('.route-makeup-toggle').click()`);
    await until(`Boolean(document.querySelector('.route-makeup-popover'))`);
    await js(`switchLocalLanguage('fr')`);
    await until(`document.querySelector('.route-makeup-popover')?.textContent.includes('Chemins et sentiers')`);
    assert.equal(await js(`document.querySelector('.route-chip-group .is-active').textContent`), 'Mixte');
    assert.match(await js(`document.querySelector('.route-chip-group .is-active').title`), /Tout chemin praticable/);
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.querySelector('.route-makeup-popover') && !document.querySelector('.route-makeup-popover').textContent.includes('Route makeup')`);
    assert.equal(await js(`document.querySelector('.route-makeup-toggle').getAttribute('aria-expanded')`), 'true');
    assert.ok((await js(`document.querySelector('.route-makeup-popover').textContent`)).includes('小路与山径'));
    assert.equal(await js(`document.querySelector('.route-chip-group .is-active').textContent`), '混合');

    await js(`showLocalScreen('phone'); switchLocalLanguage('en')`);
    await until(`Boolean(document.querySelector('.wf-send-phone button'))`);
    await js(`[...document.querySelectorAll('.wf-send-phone button')].find(button => button.textContent === 'Show code').click()`);
    await until(`Boolean(document.querySelector('.wf-send-phone img'))`);
    const before = await js(`document.querySelector('.wf-send-phone img').src`);
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.querySelector('.wf-send-phone h3').textContent.includes('发送到 iPhone')`);
    await js(`switchLocalLanguage('fr')`);
    await until(`document.querySelector('.wf-send-phone h3').textContent.includes('Envoyer vers l’iPhone')`);
    assert.equal(await js(`document.querySelector('.wf-send-phone img').src`), before);
    assert.equal(await js('localScreenState.sends.length'), 1);
    assert.equal(await js('localScreenState.stops'), 0);
    assert.deepEqual(await js('localScreenState.sends[0]'), { archiveId: 'literal-archive-id', name: 'Back 我的表盘', firmwareType: 'COROS W332' });

    await js(`showLocalScreen('plaque')`);
    await until(`document.querySelector('.race-plaque-count')?.textContent === '1 course'`);
    assert.ok((await js(`document.querySelector('.race-plaque-foot').textContent`)).includes('Une pour l’instant'));
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.querySelector('.race-plaque-count')?.textContent === '1 场比赛'`);
    assert.ok((await js(`document.querySelector('.race-plaque-foot').textContent`)).includes('目前仅 1 场'));

    await js(`showLocalScreen('overview')`);
    for (const [language, readiness] of [['fr', 'État de forme'], ['zh-CN', '准备状态']]) {
      await js(`switchLocalLanguage(${JSON.stringify(language)})`);
      await until(`document.querySelector('.overview-briefing')?.textContent.includes(${JSON.stringify(readiness)})`);
      const overview = await js(`document.querySelector('.overview-briefing').innerText`);
      assert.doesNotMatch(overview, /Above baseline|On baseline|Below baseline|Baseline forming|First reading|First estimate|Running level|Recovery and overnight vitals|From your COROS calendar|If you raced today|Half Marathon| vs |Score \d|\{\{/);
      await capture(`overview-${language}`);
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('French and Chinese local screens passed: race drafts and feedback, literal save payload, onboarding chapter, route labels/tooltips, active phone QR, race captions and overview vitals.');
  } finally { clearTimeout(watchdog); win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
