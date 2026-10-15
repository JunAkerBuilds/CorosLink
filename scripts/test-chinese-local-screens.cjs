// Run after applying the localization-only patch to the newer local screens.
const assert = require('node:assert/strict');
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
  const win = new BrowserWindow({ show: false, width: 1440, height: 1100 });
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
  try {
    await vite.listen();
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/chinese-local-screens.html`);
    const name = '.race-field input[type=text]';
    await until(`Boolean(document.querySelector(${JSON.stringify(name)}))`);
    await fill(name, 'Back $& 我的比赛');
    await js(`document.querySelector('.race-editor-surface').requestSubmit()`);
    await until(`document.querySelector('.race-editor-error') || document.querySelector('[role=alert]')`);
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
    await until(`document.querySelectorAll('.onb-step').length === 8`);
    await js(`document.querySelectorAll('.onb-step')[2].click()`);
    await until(`document.querySelectorAll('.onb-step')[2].getAttribute('aria-current') === 'step'`);
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.documentElement.lang === 'zh-CN' && !document.querySelector('.onb-title')?.textContent.includes('Plan the')`);
    assert.equal(await js(`document.querySelectorAll('.onb-step')[2].getAttribute('aria-current')`), 'step');

    await js(`showLocalScreen('route'); switchLocalLanguage('en')`);
    await until(`Boolean(document.querySelector('.route-makeup-toggle'))`);
    await js(`document.querySelector('.route-makeup-toggle').click()`);
    await until(`Boolean(document.querySelector('.route-makeup-popover'))`);
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.querySelector('.route-makeup-popover') && !document.querySelector('.route-makeup-popover').textContent.includes('Route makeup')`);
    assert.equal(await js(`document.querySelector('.route-makeup-toggle').getAttribute('aria-expanded')`), 'true');

    await js(`showLocalScreen('phone'); switchLocalLanguage('en')`);
    await until(`Boolean(document.querySelector('.wf-send-phone button'))`);
    await js(`[...document.querySelectorAll('.wf-send-phone button')].find(button => button.textContent === 'Show code').click()`);
    await until(`Boolean(document.querySelector('.wf-send-phone img'))`);
    const before = await js(`document.querySelector('.wf-send-phone img').src`);
    await js(`switchLocalLanguage('zh-CN')`);
    await until(`document.querySelector('.wf-send-phone h3').textContent.includes('发送到 iPhone')`);
    assert.equal(await js(`document.querySelector('.wf-send-phone img').src`), before);
    assert.equal(await js('localScreenState.sends.length'), 1);
    assert.equal(await js('localScreenState.stops'), 0);
    assert.deepEqual(await js('localScreenState.sends[0]'), { archiveId: 'literal-archive-id', name: 'Back 我的表盘', firmwareType: 'COROS W332' });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Chinese local screens passed: race drafts and feedback, literal save payload, onboarding chapter, open route breakdown and active phone QR survive live switching.');
  } finally { clearTimeout(watchdog); win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
