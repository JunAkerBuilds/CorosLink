// Watch settings panels: layout at desktop, medium and narrow widths, editing and saving,
// empty, search, disconnected and error states, French and Chinese text, and keyboard use.
// Screenshots for review when COROSLINK_SHOTS names a directory.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), `coroslink-watch-settings-${process.pid}`));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let vite, win;
  const watchdog = setTimeout(() => { console.error('Watch settings UI timed out'); app.exit(1); }, 180000);
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
      throw new Error(`Timed out: ${code}`);
    }
    const theme = async name => {
      nativeTheme.themeSource = name === 'paper' ? 'light' : 'dark';
      await js(`${name === 'paper' ? `document.documentElement.dataset.theme = 'paper'` : `delete document.documentElement.dataset.theme`}; void 0`);
      await pause(150);
    };
    const size = async width => { win.setContentSize(width, 900); await pause(300); };
    // The whole page, not just what fits on the screen; `viewport` keeps the window height (for the sticky bar).
    const shoot = async (name, viewport = false) => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      if (!viewport) {
        // The app scrolls inside .content, so grow the viewport to the content instead.
        const [width] = win.getContentSize();
        const height = await js(`(() => { const c = document.querySelector('.content'); return Math.ceil(c.getBoundingClientRect().top + c.scrollHeight + 16); })()`);
        await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: Math.max(height, 400), deviceScaleFactor: 1, mobile: false });
        await pause(300);
      }
      const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
      if (!viewport) await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
      fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const base = `http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/watch-settings.html`;
    const open = async (query = '') => {
      await win.loadURL(`${base}${query ? `?${query}` : ''}`);
      await until(`document.querySelector('.watch-settings') !== null && document.querySelector('.settings-panel .settings-hint, .watch-panel-empty, .watch-zones') !== null`);
      await pause(200);
    };
    const row = label => `Array.from(document.querySelectorAll('.watch-setting-row')).find(row => row.querySelector('.watch-setting-label > span').textContent === ${JSON.stringify(label)})`;
    const setInput = (selector, value) => js(`{ const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); } void 0`);
    // The training profile saves through the same bar as Watch settings, shown only while there's something to save.
    const profileBar = `document.querySelector('.settings-view > .settings-panel:first-child .watch-settings-savebar')`;
    const profileSave = `${profileBar}?.querySelector('.primary-button')`;
    // Relative luminance contrast of two computed colours (rgb() or color(srgb …)).
    const contrast = async (a, b) => js(`(() => {
      const parse = text => { const n = text.match(/[\\d.]+/g).map(Number); return text.startsWith('color(') ? n.slice(0, 3) : n.slice(0, 3).map(v => v / 255); };
      const lum = c => { const [r, g, b] = c.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const [x, y] = [lum(parse(${a})), lum(parse(${b}))].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    })()`);
    const noOverflow = async label => {
      assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`), true, `no sideways page scrolling (${label})`);
      const wide = await js(`Array.from(document.querySelectorAll('.settings-panel *')).filter(el => el.getBoundingClientRect().right > el.closest('.settings-panel').getBoundingClientRect().right + 0.5).map(el => el.className || el.tagName).slice(0, 5)`);
      assert.deepEqual(wide, [], `nothing sticks out of a panel (${label})`);
    };

    await open();
    await until(`document.querySelectorAll('.watch-setting-row').length > 10`);
    await theme('dark');
    await shoot('dark-wide');
    // Each panel uses its full width: no settings grid squeezed into a side column.
    const widths = await js(`Array.from(document.querySelectorAll('.watch-settings-groups, .settings-fields')).map(el => el.getBoundingClientRect().width / el.closest('.panel').getBoundingClientRect().width)`);
    for (const ratio of widths) assert.ok(ratio > 0.85, `content spans the panel (${ratio.toFixed(2)})`);
    // The 12-hour clock is read as 12-hour.
    assert.match(await js(`${row('Time format')}.querySelector('[aria-checked=true]').textContent`), /12-hour/);
    // Segmented controls are one tab stop each, on the chosen value, and arrow keys move the choice.
    assert.equal(await js(`Array.from(document.querySelectorAll('[role=radiogroup]')).every(group => group.querySelectorAll('[tabindex="0"]').length === 1 && group.querySelector('[tabindex="0"]').getAttribute('aria-checked') === 'true')`), true, 'one tab stop per radiogroup');
    await js(`${row('Time format')}.querySelector('[aria-checked=true]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); void 0`);
    await until(`${row('Time format')}.querySelector('[aria-checked=true]').textContent === '24-hour'`);
    assert.equal(await js(`document.activeElement.textContent`), '24-hour', 'focus follows the arrow key');
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); void 0`);
    await until(`${row('Time format')}.querySelector('[aria-checked=true]').textContent === '12-hour' && document.querySelector('.watch-settings .watch-settings-savebar') === null`);
    // Every switch is a labelled switch; read-only values say where to change them.
    assert.equal(await js(`Array.from(document.querySelectorAll('.watch-setting-switch')).every(input => input.getAttribute('role') === 'switch' && input.getAttribute('aria-label'))`), true);
    assert.match(await js(`document.querySelector('.watch-setting-value.is-readonly .sr-only').textContent`), /Change this on the watch/);
    // Only confirmed meanings show: the unknown bit change is left out of Recent changes, there's no list of
    // raw values, and a touchscreen value the firmware doesn't name isn't shown.
    assert.match(await js(`document.querySelector('.watch-settings-more summary').textContent`), /Recent changes \(1\)/);
    assert.equal(await js(`document.querySelectorAll('.watch-settings-more').length`), 1);
    assert.equal(await js(`document.querySelector('.watch-settings-more summary .watch-settings-chevron') !== null`), true);
    assert.equal(await js(`Array.from(document.querySelectorAll('.watch-setting-row')).some(row => row.textContent.startsWith('Touchscreen'))`), false);
    // The profile saves only a change, checks it first, and previews the zones it moves.
    assert.equal(await js(`${profileBar}`), null, 'nothing to save yet: no save bar');
    await setInput('.settings-fields input', '50');
    await until(`${profileSave}?.disabled === false`);
    assert.deepEqual(await js(`Array.from(${profileBar}.querySelectorAll('button')).map(button => button.textContent)`), ['Discard', 'Save to watch']);
    await js(`${profileSave}.click(); void 0`);
    await until(`${profileBar}?.querySelector('[role=alert] .settings-error svg') != null`);
    assert.match(await js(`${profileBar}.querySelector('.settings-error').textContent`), /Max heart rate: enter a whole number from 100 to 240 bpm/);
    assert.equal(await js(`document.querySelector('.settings-fields input').getAttribute('aria-invalid')`), 'true');
    assert.equal(await js(`window.profileSaved.length`), 0);
    await js(`document.querySelector('.watch-zones-head select').value = '1'; document.querySelector('.watch-zones-head select').dispatchEvent(new Event('change', { bubbles: true })); void 0`);
    await setInput('.settings-fields input', '200');
    await until(`document.querySelector('.watch-zones-head h3 small') !== null && document.querySelector('.watch-zones dd').textContent.startsWith('100')`);
    await js(`${profileSave}.click(); void 0`);
    await until(`window.profileSaved.length === 1`);
    assert.deepEqual(await js(`window.profileSaved[0]`), { maxHr: 200, restingHr: 55, thresholdHr: 160, hrZoneType: 1, thresholdPaceSecondsPerKm: 285 });
    await until(`document.querySelector('.watch-zones-head h3 small') === null && ${profileBar}?.classList.contains('is-dirty') === false`);
    assert.equal(await js(`${profileBar}.querySelector('.watch-settings-saved').textContent`), 'Saved to your watch. Zones were updated to match.');
    // Discard puts back what the watch has.
    await setInput('.settings-fields input', '201');
    await until(`${profileBar}?.classList.contains('is-dirty') === true`);
    await js(`Array.from(${profileBar}.querySelectorAll('button')).find(button => button.textContent === 'Discard').click(); void 0`);
    await until(`document.querySelector('.settings-fields input').value === '200' && ${profileBar} === null`);
    // Edit and save.
    await js(`${row('Raise to wake')}.querySelectorAll('button')[2].click(); void 0`);
    await until(`document.querySelector('.watch-settings .watch-settings-savebar.is-dirty') !== null`);
    await shoot('dark-dirty');
    await js(`document.querySelector('.content').scrollTop = document.querySelector('.watch-settings').offsetTop; void 0`);
    await pause(150);
    // While scrolled up in the settings, the save bar stays in view.
    assert.equal(await js(`document.querySelector('.watch-settings .watch-settings-savebar').getBoundingClientRect().bottom <= document.querySelector('.content').getBoundingClientRect().bottom`), true, 'save bar sticks in view');
    await shoot('dark-dirty-sticky', true);
    await js(`document.querySelector('.watch-settings .watch-settings-savebar .primary-button').click(); void 0`);
    await until(`window.saved.length === 1`);
    assert.deepEqual(await js(`window.saved[0]`), { raiseToWake: 2 });
    await until(`document.querySelector('.watch-settings .watch-settings-saved') !== null`);
    await theme('paper');
    // The palest zone's edge still shows on paper.
    assert.ok(await contrast(`getComputedStyle(document.querySelector('.watch-zones div')).borderTopColor`, `getComputedStyle(document.querySelector('.watch-zones div')).backgroundColor`) >= 1.6, 'zone 1 visible on paper');
    await shoot('light-wide');
    await size(430);
    await noOverflow('430px');
    await shoot('light-narrow');
    await js(`document.querySelectorAll('.watch-settings-more').forEach(details => { details.open = true; }); void 0`);
    await noOverflow('430px, sections open');
    await shoot('light-narrow-open');
    await size(1100);
    await theme('dark');
    await shoot('dark-wide-open');

    // Nothing read from a watch yet.
    await size(1100);
    await open('profile=none&settings=none&weather=unknown');
    await theme('dark');
    assert.equal(await js(`document.querySelectorAll('.watch-panel-empty').length`), 2, 'profile and settings empty states');
    assert.equal(await js(`document.querySelector('.weather-location-current .is-unknown') !== null`), true, 'unknown weather place');
    await shoot('dark-empty');
    await theme('paper');
    await shoot('light-empty');
    // Connected but not read yet: the panels say so, not "connect your watch".
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-panel-empty')).map(el => el.textContent.trim())`), ['Reading your watch…', 'Reading your watch…']);
    // Away: connect from the watch menu. Connecting fills both panels without leaving Settings.
    await open('profile=none&settings=none&connected=0');
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-panel-empty')).map(el => el.textContent.trim())`),
      ['Connect your watch from the watch menu to read its profile.', 'Connect your watch from the watch menu to read its settings.']);
    await js(`window.connectWatch(); void 0`);
    await until(`Array.from(document.querySelectorAll('.watch-panel-empty')).every(el => el.textContent.trim() === 'Reading your watch…') && document.querySelectorAll('.watch-panel-empty').length === 2`);
    await until(`document.querySelectorAll('.watch-panel-empty').length === 0 && document.querySelectorAll('.watch-setting-row').length > 10 && document.querySelector('.watch-zones') !== null`);

    // Read from a watch whose firmware CorosLink hasn't checked: both panels say so, show nothing and offer nothing to change.
    await open('model=nomad');
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-panel-empty')).map(el => el.textContent.trim())`),
      ['Not available on this watch.', 'Not available on this watch.'], 'profile and settings locked');
    assert.equal(await js(`document.querySelectorAll('.watch-setting-row, .watch-zones, .settings-fields input').length`), 0, 'no values or controls');
    await shoot('dark-unsupported-model');
    await open('model=nomad&lang=fr');
    assert.equal(await js(`document.querySelector('.watch-panel-empty').textContent.trim()`), 'Non disponible sur cette montre.');
    // Memory-in-pixel watches (APEX 4, PACE 3): brightness, the always-on display and raise to wake in activities don't
    // apply, so those rows are left out (not locked); Night Mode shows read-only; everything else stays as on a PACE 4.
    const labels = () => js(`Array.from(document.querySelectorAll('.watch-setting-row .watch-setting-label > span')).map(span => span.textContent)`);
    await open('model=pace-4');
    await until(`document.querySelectorAll('.watch-setting-row').length > 10`);
    const pace4 = await labels();
    assert.ok(['Brightness', 'Always-on display', 'Raise to wake during activities'].every(label => pace4.includes(label)), 'PACE 4 keeps its display rows');
    assert.equal(pace4.includes('Night mode'), false, 'no Night Mode row on a PACE 4');
    for (const model of ['apex-4', 'pace-3']) {
      await open(`model=${model}&night=1`);
      await until(`document.querySelectorAll('.watch-setting-row').length > 10`);
      const shown = await labels();
      assert.deepEqual(shown.filter(label => ['Brightness', 'Always-on display', 'Always-on display in activities', 'Raise to wake during activities'].includes(label)), [], `${model}: display rows that don't apply are hidden`);
      assert.equal(await js(`document.querySelectorAll('.watch-panel-empty').length`), 0, `${model} not locked`);
      assert.equal(await js(`document.querySelectorAll('.settings-fields input:not([disabled])').length`), 4, `${model} profile editable`);
      assert.match(await js(`${row('Night mode')}.querySelector('.watch-setting-value.is-readonly').textContent`), /^On/, `${model}: Night Mode, read-only`);
      assert.ok(shown.includes('Temperature unit') && shown.includes('Raise to wake'), `${model}: other settings unchanged`);
      assert.deepEqual(pace4.filter(label => !shown.includes(label)), ['Brightness', 'Always-on display', 'Always-on display in activities', 'Raise to wake during activities'], `${model}: exactly those rows are gone`);
    }
    // The PACE 3 names its touchscreen modes differently from the PACE 4 and APEX 4.
    await open('model=pace-3&touch=4');
    assert.match(await js(`${row('Touchscreen')}.textContent`), /Navigation & activity screens/);
    await open('model=apex-4&touch=4');
    assert.match(await js(`${row('Touchscreen')}.textContent`), /Map & activity data/);
    await open('model=pace-3&touch=4&night=1&lang=fr');
    assert.match(await js(`${row('Mode nuit')}.textContent`), /Activé/);
    assert.match(await js(`${row('Écran tactile')}.textContent`), /Navigation et écrans d’activité/);
    // The PACE Pro and PACE 4 Pro use the PACE 4's settings record: everything stays editable.
    for (const model of ['pace-pro', 'pace-4-pro']) {
      await open(`model=${model}`);
      await until(`document.querySelectorAll('.watch-setting-row').length > 10`);
      assert.equal(await js(`document.querySelectorAll('.watch-panel-empty').length`), 0, `${model} not locked`);
      assert.equal(await js(`document.querySelectorAll('.settings-fields input:not([disabled])').length`), 4, `${model} profile editable`);
    }

    // Automatic weather location and place search.
    await open('weather=auto');
    await theme('paper');
    await setInput('.weather-location-row input[type=search]', 'Han');
    await until(`document.querySelectorAll('.weather-place-results li').length > 0`);
    assert.equal(await js(`document.querySelector('.weather-location-search .weather-place-results') !== null`), true, 'results sit under the search field');
    await shoot('light-search');
    await theme('dark');
    await shoot('dark-search');
    await setInput('.weather-location-row input[type=search]', 'zzq');
    await until(`document.querySelector('.weather-location-search [role=status]')?.textContent === 'No places found.'`);
    await shoot('dark-search-none');
    await setInput('.weather-location-row input[type=search]', 'Han');
    await until(`document.querySelectorAll('.weather-place-results li').length > 0`);
    await js(`document.querySelector('.weather-place-results button').click(); void 0`);
    await until(`document.querySelector('.weather-location-current strong').textContent === 'Hanoi' && document.querySelector('.weather-place-results') === null`);

    // Disconnected: changes stay pending, saving waits for the watch.
    await open('connected=0');
    await theme('paper');
    await js(`${row('Units')}.querySelectorAll('button')[1].click(); void 0`);
    await until(`document.querySelector('.watch-settings .watch-settings-savebar.is-dirty') !== null`);
    await pause(200);
    assert.equal(await js(`document.querySelector('.watch-settings .watch-settings-savebar .primary-button').disabled`), true, 'no saving while disconnected');
    assert.match(await js(`document.querySelector('.watch-settings .watch-settings-status').textContent`), /connect the watch to save/);
    await setInput('.settings-fields input', '193');
    await until(`${profileBar}?.querySelector('.watch-settings-status').textContent === 'Connect the watch to save these changes.'`);
    assert.equal(await js(`${profileSave}.disabled`), true, 'profile waits for the watch too');
    await shoot('light-disconnected');

    // A failed save.
    await open('failSave=1');
    await theme('dark');
    await js(`${row('Units')}.querySelectorAll('button')[1].click(); void 0`);
    await until(`document.querySelector('.watch-settings .watch-settings-savebar.is-dirty') !== null`);
    await js(`document.querySelector('.watch-settings .watch-settings-savebar .primary-button').click(); void 0`);
    await until(`document.querySelector('.watch-settings .watch-settings-savebar .settings-error') !== null`);
    // The error reads as the settings' names, without Electron's prefix, and the change stays to retry.
    const failure = await js(`document.querySelector('.watch-settings .watch-settings-savebar .settings-error').textContent`);
    assert.equal(failure, "The watch didn't keep Units, Raise to wake. Reconnect and try again.");
    assert.match(await js(`document.querySelector('.watch-settings .watch-settings-status').textContent`), /1 change not saved yet/);
    assert.equal(await js(`document.querySelector('.watch-settings .watch-settings-savebar.is-dirty .primary-button').disabled`), false);
    await shoot('dark-save-error');

    // Longer French and Chinese text at a medium and a narrow width.
    for (const lang of ['fr', 'zh-CN']) {
      await open(`lang=${lang}`);
      await theme('paper');
      await size(700);
      await noOverflow(`${lang} 700px`);
      // At a medium width the fields pair up and the zones stay one strip.
      assert.equal(await js(`new Set(Array.from(document.querySelectorAll('.watch-zones div')).map(el => Math.round(el.getBoundingClientRect().top))).size`), 1, `${lang} zones in one row`);
      assert.equal(await js(`new Set(Array.from(document.querySelectorAll('.settings-fields .settings-field')).map(el => Math.round(el.getBoundingClientRect().top))).size`), 2, `${lang} fields in two rows`);
      // The chosen place and the search field are the same height, side by side or stacked.
      assert.equal(await js(`Math.round(document.querySelector('.weather-location-current > div').getBoundingClientRect().height) === Math.round(document.querySelector('.weather-location-search input').getBoundingClientRect().height)`), true, `${lang} weather fields match`);
      await shoot(`light-medium-${lang}`);
      await theme('dark');
      await size(430);
      await noOverflow(`${lang} 430px`);
      // Switches never drop below their labels.
      assert.equal(await js(`Array.from(document.querySelectorAll('.watch-setting-switch')).every(input => { const label = input.closest('.watch-setting-row').querySelector('.watch-setting-label').getBoundingClientRect(); return input.getBoundingClientRect().top < label.bottom; })`), true, `${lang} switches beside labels`);
      await shoot(`dark-narrow-${lang}`);
      await size(1100);
    }
    // The Overview weather card: refresh and settings stacked in its corner; settings opens Weather location.
    await open('card=weather');
    await until(`document.querySelector('.overview-weather-temp') !== null`);
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.overview-weather-actions button')).map(b => b.getAttribute('aria-label'))`), ['Refresh weather', 'Weather settings']);
    assert.equal(await js(`(() => { const card = document.querySelector('.overview-weather').getBoundingClientRect(); const actions = document.querySelector('.overview-weather-actions').getBoundingClientRect(); return actions.bottom <= card.bottom && actions.right <= card.right; })()`), true, 'weather buttons stay inside the card');
    await js(`document.querySelector('.overview-weather-settings').focus(); document.querySelector('.content').scrollTop = 0; document.scrollingElement.scrollTop = 0; void 0`);
    await shoot('weather-card', true);
    await js(`document.querySelector('.overview-weather-settings').click(); void 0`);
    assert.deepEqual(await js(`window.openedSettings`), ['weather']);
    assert.deepEqual(errors, [], 'no console errors');
    console.log('Watch settings: locked for unchecked models, weather card settings link, full-width layout, 12-hour reading, keyboard segments, profile checks and preview, edit and save, sticky save bar, paper zone contrast, empty, search, disconnected, error, French and Chinese at medium and narrow widths passed.');
  } finally { clearTimeout(watchdog); win?.destroy(); await vite?.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
