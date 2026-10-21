// Settings → Privacy & local data: both modes, the mode choice as a keyboard radio group whose chosen
// card stays at full strength, the Local-Only confirmation, messages under the button that caused them,
// sync results, Connected Mode hiding what it can't show, both themes, a narrow window, French,
// Portuguese and Chinese. Screenshots for review when COROSLINK_SHOTS names a directory.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), `coroslink-privacy-settings-${process.pid}`));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let vite, win;
  const watchdog = setTimeout(() => { console.error('Privacy settings UI timed out'); app.exit(1); }, 150000);
  const shots = process.env.COROSLINK_SHOTS;
  try {
    vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', define: { global: 'globalThis' } });
    await vite.listen();
    win = new BrowserWindow({ show: false, width: 1100, height: 900 });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const pause = ms => new Promise(r => setTimeout(r, ms));
    async function until(code) {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (await js(code)) return; await pause(50); }
      throw new Error(`Timed out: ${code}\n${await js('document.body.innerText')}`);
    }
    const theme = async name => {
      nativeTheme.themeSource = name === 'paper' ? 'light' : 'dark';
      await js(`${name === 'paper' ? `document.documentElement.dataset.theme = 'paper'` : `delete document.documentElement.dataset.theme`}; void 0`);
      await pause(150);
    };
    const size = async width => { win.setContentSize(width, 900); await pause(300); };
    const shoot = async name => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      const [width] = win.getContentSize();
      const height = await js(`(() => { const c = document.querySelector('.content'); return Math.ceil(c.getBoundingClientRect().top + c.scrollHeight + 16); })()`);
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: Math.max(height, 400), deviceScaleFactor: 1, mobile: false });
      await pause(300);
      const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
      await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
      fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const base = `http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/privacy-settings.html`;
    const open = async (query = '') => {
      await win.loadURL(`${base}${query ? `?${query}` : ''}`);
      await until(`document.querySelector('.privacy-modes [aria-checked=true]') !== null && !document.body.textContent.includes('Loading…')`);
      await pause(200);
    };
    // Relative luminance contrast of two computed colours (rgb() or color(srgb …)); a translucent background is laid on the panel's.
    const contrastOf = selector => js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const parse = text => { const n = text.match(/[\\d.]+/g).map(Number); const rgb = text.startsWith('color(') ? n.slice(0, 3) : n.slice(0, 3).map(v => v / 255); return [...rgb, n[3] ?? 1]; };
      const background = node => { const layers = []; for (; node; node = node.parentElement) { const c = parse(getComputedStyle(node).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } return layers.reverse().reduce((under, c) => under.map((v, i) => c[i] * c[3] + v * (1 - c[3])), [0, 0, 0]); };
      const lum = c => { const [r, g, b] = c.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fg = parse(getComputedStyle(el).color); const opacity = Number(getComputedStyle(el.closest('button') ?? el).opacity);
      const bg = background(el);
      const text = fg.slice(0, 3).map((v, i) => v * fg[3] * opacity + bg[i] * (1 - fg[3] * opacity));
      const [x, y] = [lum(text), lum(bg)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    })()`);
    const noOverflow = async label => {
      assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`), true, `no sideways page scrolling (${label})`);
      const wide = await js(`Array.from(document.querySelectorAll('.privacy-settings *')).filter(el => el.getBoundingClientRect().right > document.querySelector('.privacy-settings').getBoundingClientRect().right + 0.5).map(el => el.className || el.tagName).slice(0, 5)`);
      assert.deepEqual(wide, [], `nothing sticks out of the panel (${label})`);
    };
    const mode = label => `Array.from(document.querySelectorAll('.privacy-modes [role=radio]')).find(card => card.querySelector('strong').textContent === ${JSON.stringify(label)})`;
    const section = title => `Array.from(document.querySelectorAll('.privacy-section')).find(s => s.querySelector('h3, summary')?.textContent.includes(${JSON.stringify(title)}))`;
    const key = name => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true })); void 0`);

    // Local-Only Mode: the chosen card is the strong one, focusable, and its words pass contrast.
    for (const name of ['dark', 'paper']) {
      await open();
      await theme(name);
      assert.deepEqual(await js(`(() => { const card = ${mode('Local-Only Mode')}; return { checked: card.getAttribute('aria-checked'), disabled: card.disabled, tab: card.tabIndex, opacity: getComputedStyle(card).opacity }; })()`),
        { checked: 'true', disabled: false, tab: 0, opacity: '1' }, `${name}: the chosen mode is not dimmed or disabled`);
      assert.equal(await js(`${mode('Connected Mode')}.tabIndex`), -1, 'one tab stop in the group');
      for (const part of ['strong', 'small']) {
        const ratio = await contrastOf(`.privacy-modes .is-active ${part}`);
        assert.ok(ratio >= 4.5, `${name}: chosen mode ${part} contrast ${ratio.toFixed(2)}`);
      }
      assert.equal(await js(`${mode('Local-Only Mode')}.querySelector('small').textContent`), 'Nothing is uploaded to COROS.');
      // The heading matches the panels around it.
      assert.equal(await js(`document.querySelector('.privacy-settings > .settings-units-heading h2').textContent`), 'Privacy & local data');
      await shoot(`${name}-local`);
    }

    // Keyboard: arrow keys move the choice; leaving Local-Only asks in the native dialog (mocked).
    await open();
    await theme('dark');
    await js(`${mode('Local-Only Mode')}.focus(); void 0`);
    await key('ArrowLeft');
    await until(`window.mock.calls.includes('connected')`);
    assert.equal(await js(`document.activeElement === ${mode('Connected Mode')}`), true, 'focus follows the arrow key');
    // Clicking the chosen card does nothing.
    await js(`window.mock.calls.length = 0; ${mode('Local-Only Mode')}.click(); void 0`);
    await pause(200);
    assert.deepEqual(await js(`window.mock.calls`), []);

    // Replacing a COROS-app plan: a switch in the watch section, off until the user agrees; off asks again.
    const planSwitch = `${section('Watch and local data')}.querySelector('.privacy-switch input[role=switch]')`;
    await until(`${planSwitch} !== null`);
    assert.deepEqual(await js(`(() => { const input = ${planSwitch}; return { label: input.closest('label').querySelector('span').firstChild.textContent, checked: input.checked }; })()`),
      { label: 'Replace COROS-app plans on the watch', checked: false });
    await js(`${planSwitch}.click(); void 0`);
    await until(`window.mock.calls.includes('planReplacement:true') && ${planSwitch}.checked`);
    await js(`${planSwitch}.click(); void 0`);
    await until(`window.mock.calls.includes('planReplacement:false') && !${planSwitch}.checked`);
    // The backup passphrase has a visible label.
    assert.equal(await js(`(() => { const label = document.querySelector('label[for=privacy-passphrase]'); return label && label.offsetWidth > 1 ? label.textContent : null; })()`), 'Passphrase (optional)');

    // Messages sit under the button that caused them, with an icon.
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Sync watch now').click(); void 0`);
    await until(`window.mock.calls.includes('sync')`);
    await js(`window.mock.progress({ receivedBytes: 300000, totalBytes: 1000000 }); void 0`);
    await until(`document.querySelector('.privacy-sync-button').textContent === 'Syncing… 30%'`);
    await shoot('dark-syncing');
    await js(`window.mock.failSync('The watch stopped answering while reading activity records (block 12 of 48).'); void 0`);
    await until(`${section('Watch and local data')}.querySelector('.watch-menu-result.is-error') !== null`);
    assert.equal(await js(`${section('Watch and local data')}.querySelector('.watch-menu-result.is-error').textContent`), 'Sync stopped. Keep the watch close and try again.');
    assert.equal(await js(`Boolean(${section('Watch and local data')}.querySelector('.watch-menu-result.is-error svg'))`), true, 'an icon, not only colour');
    await shoot('dark-sync-error');
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Sync watch now').click(); void 0`);
    await until(`window.mock.calls.filter(c => c === 'sync').length === 2`);
    await js(`window.mock.finishSync({ newActivities: 2, health: { ok: true }, calendar: { ok: false, foreignPlan: true } }); void 0`);
    await until(`${section('Watch and local data')}.querySelector('.watch-sync-result [data-part=calendar] button') !== null`);
    assert.equal(await js(`${section('Watch and local data')}.querySelector('.watch-sync-result .is-success').textContent`), 'Synced · 2 new activities');
    // Agreeing in the sync result turns the switch on (and syncs again).
    await js(`${section('Watch and local data')}.querySelector('.watch-sync-result [data-part=calendar] button').click(); void 0`);
    await js(`Array.from(${section('Watch and local data')}.querySelectorAll('.watch-sync-result [data-part=calendar] button')).find(b => b.textContent === 'Replace').click(); void 0`);
    await until(`window.mock.calls.includes('allowPlan') && window.mock.calls.filter(c => c === 'sync').length === 3`);
    await js(`window.mock.finishSync({ newActivities: 2, health: { ok: true }, calendar: { ok: true, workouts: 4 } }); void 0`);
    await until(`${planSwitch}.checked`);
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Import FIT files').click(); void 0`);
    await until(`window.mock.calls.includes('import')`);
    await until(`${section('Watch and local data')}.querySelector('.privacy-actions + .watch-menu-result.is-success') !== null`);
    assert.equal(await js(`${section('Watch and local data')}.querySelector('.privacy-actions + .watch-menu-result.is-success').textContent`), '4 activities imported · Already here: 2', 'no "(s)" plurals');
    assert.equal(await js(`Array.from(document.querySelectorAll('.privacy-actions')).filter(a => a.closest('.privacy-section') === ${section('Watch and local data')}).at(-1).nextElementSibling.textContent`), '4 activities imported · Already here: 2', 'right under the import buttons');
    await shoot('dark-import');
    // Backup: a short passphrase says why Export waits; the result shows in the Backup section.
    await js(`{ const input = document.querySelector('.privacy-passphrase'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'abc'); input.dispatchEvent(new Event('input', { bubbles: true })); } void 0`);
    await until(`document.getElementById('privacy-passphrase-rule')?.textContent === 'At least 8 characters'`);
    assert.equal(await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Export backup').disabled`), true);
    await js(`{ const input = document.querySelector('.privacy-passphrase'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'correct horse'); input.dispatchEvent(new Event('input', { bubbles: true })); } void 0`);
    await js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Export backup').click(); void 0`);
    await until(`${section('Backup')}.querySelector('.watch-menu-result.is-success')?.textContent === 'Backup saved.'`);
    assert.equal(await js(`${section('Watch and local data')}.querySelector('.privacy-actions + .watch-menu-result')`), null, 'the import message goes when another action runs');
    // Blocked uploads: a count, a chevron, Clear with an icon.
    assert.equal(await js(`document.querySelector('.privacy-report summary').textContent`), 'Blocked uploads to COROS · 3');
    await js(`document.querySelector('.privacy-report').open = true; void 0`);
    await until(`document.querySelectorAll('.privacy-attempts tbody tr').length === 2`);
    assert.equal(await js(`Boolean(Array.from(document.querySelectorAll('.privacy-report button')).find(b => b.textContent.trim() === 'Clear').querySelector('svg'))`), true);
    await shoot('dark-report');
    await theme('paper');
    await shoot('paper-report');

    // Turning Local-Only Mode on: a confirmation that says what stops.
    await open('mode=connected');
    await theme('dark');
    assert.equal(await js(`${section('Watch and local data')} ?? null`), null, 'Connected Mode offers no sync or imports it could not show');
    assert.equal(await js(`document.querySelector('.privacy-report')`), null, 'nothing is blocked in Connected Mode');
    await js(`${mode('Connected Mode')}.focus(); void 0`);
    await key('ArrowRight');
    await until(`document.querySelector('.privacy-confirm') !== null`);
    assert.match(await js(`document.querySelector('.privacy-confirm').textContent`), /Without COROS, Strava and TrainingPeaks stop receiving your activities, and the watch gets no firmware updates\./);
    assert.match(await js(`document.querySelector('.privacy-confirm').textContent`), /Local-Only Mode starts empty: .*Your COROS workouts, calendar and activities stay in your COROS account/, 'why it starts empty');
    await shoot('dark-confirm');
    await js(`document.querySelector('.privacy-confirm .primary-button').click(); void 0`);
    await until(`window.mock.calls.some(call => call.startsWith('local:'))`);
    await theme('paper');
    await shoot('paper-connected');

    // Degraded, and long translations at a narrow width.
    await open('state=degraded');
    assert.equal(await js(`document.querySelector('.privacy-settings .settings-units-heading p:not(.eyebrow)').textContent`), 'Local-Only Mode is on, but part of turning it on failed.');
    assert.equal(await js(`document.querySelector('.privacy-failures').textContent.trim()`), 'Saved credentials: The keychain could not be opened.');
    await theme('dark');
    await shoot('dark-degraded');
    for (const lang of ['fr', 'pt', 'zh-CN']) {
      await open(`lang=${lang}`);
      await theme(lang === 'pt' ? 'paper' : 'dark');
      await size(430);
      await noOverflow(`${lang} 430px`);
      await shoot(`narrow-${lang}`);
      await size(1100);
      await noOverflow(`${lang} 1100px`);
      await shoot(`wide-${lang}`);
    }
    assert.deepEqual(errors, [], 'no console errors');
    console.log('Privacy settings UI: chosen mode at full strength and contrast, keyboard radio group, confirmation copy, messages by their buttons, sync results, Connected Mode, both themes, narrow French, Portuguese and Chinese passed.');
  } finally { clearTimeout(watchdog); win?.destroy(); await vite?.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
