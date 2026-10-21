// Toolbar watch menu: each connection state in both themes, a narrow window, French and Chinese,
// sync progress and results, keyboard use, and screenshots for review when COROSLINK_SHOTS names a directory.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), `coroslink-watch-menu-${process.pid}`));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let vite, win;
  const watchdog = setTimeout(() => { console.error('Watch menu UI timed out'); app.exit(1); }, 150000);
  const shots = process.env.COROSLINK_SHOTS;
  const errors = [];
  try {
    vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', define: { global: 'globalThis' } });
    await vite.listen();
    win = new BrowserWindow({ show: false, width: 1100, height: 1000 });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    async function until(code) {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (await js(code)) return; await wait(50); }
      throw new Error(`Timed out: ${code}\n${await js('document.body.innerText')}`);
    }
    const shoot = async name => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      // The panel can be taller than the window: grow the viewport to it, then capture the toolbar corner.
      const [width] = win.getContentSize();
      const box = await js(`(() => { const p = document.querySelector('.watch-menu-panel'); const r = (p ?? document.querySelector('.watch-menu')).getBoundingClientRect(); return { left: r.left, bottom: r.top + (p ? p.scrollHeight : r.height) }; })()`);
      const height = Math.max(Math.ceil(box.bottom + 24), 300);
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: Math.max(height, 1000), deviceScaleFactor: 1, mobile: false });
      await wait(250);
      const x = Math.max(0, Math.floor(box.left - 24));
      const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x, y: 0, width: width - x, height, scale: 1 } });
      await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
      fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    };
    const show = async name => { await js(`window.showScenario(${JSON.stringify(name)}); void 0`); await until(`document.querySelector('.watch-menu-panel') !== null`); await wait(150); };
    const openPage = async page => { await js(`document.querySelector('.watch-menu-row[data-page=${page}]').click(); void 0`); await until(`document.querySelector('.watch-menu-back') !== null`); await wait(100); };
    const text = selector => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    // Real key presses through the DevTools protocol, so :focus-visible and button activation behave as with a keyboard.
    const KEYS = { Enter: { code: 13, text: '\r' }, Tab: { code: 9 }, Escape: { code: 27 } };
    const key = async name => {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      const { code, text } = KEYS[name];
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
      await wait(120);
    };
    // Nothing in the panel is cut off or pokes out of it, and the panel stays on screen.
    const checkLayout = async label => {
      const result = await js(`(() => {
        const panel = document.querySelector('.watch-menu-panel');
        const p = panel.getBoundingClientRect();
        const name = el => (el.className && typeof el.className === 'string' ? el.className : el.tagName) + ': ' + el.textContent.trim().slice(0, 50);
        return {
          outside: Array.from(panel.querySelectorAll('*')).filter(el => { const r = el.getBoundingClientRect(); return r.width > 1 && (r.right > p.right + 0.5 || r.left < p.left - 0.5); }).map(name),
          cut: Array.from(panel.querySelectorAll('small, dt, dd, strong, p, button, select, .watch-menu-autosync-choice > span')).filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(name),
          sideways: panel.scrollWidth > panel.clientWidth + 1,
          offscreen: p.left < 0 || p.right > innerWidth,
          page: document.documentElement.scrollWidth > innerWidth
        };
      })()`);
      assert.deepEqual(result.outside, [], `${label}: nothing sticks out of the panel`);
      assert.deepEqual(result.cut, [], `${label}: no text is cut off`);
      assert.equal(result.sideways, false, `${label}: the panel doesn't scroll sideways`);
      assert.equal(result.offscreen, false, `${label}: the panel stays on screen`);
      assert.equal(result.page, false, `${label}: the page doesn't scroll sideways`);
    };

    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/watch-menu.html`);
    await until(`document.querySelector('.watch-menu-panel') !== null`);
    nativeTheme.themeSource = 'dark';
    const states = ['never-paired', 'offline', 'connecting', 'failed', 'connected', 'auto-on', 'auto-failed', 'sign-in', 'usb', 'identity-mismatch', 'auto-paused'];

    for (const theme of ['dark', 'light']) {
      if (theme === 'light') { nativeTheme.themeSource = 'light'; await js(`document.documentElement.dataset.theme = 'paper'; void 0`); await wait(200); }
      for (const name of states) {
        await show(name);
        await checkLayout(`${theme} ${name}`);
        await shoot(`${theme}-${name}`);
      }
      // Messages wait until the connection has finished setting up the watch.
      const messageRow = `document.querySelector('.watch-menu-row[data-page=message]').textContent`;
      await show('connected-setting-up');
      assert.match(await js(messageRow), /Needs a connected, supported COROS watch/, 'no messages while the connection is still setting up');
      await show('connected');
      assert.match(await js(messageRow), /Appears as a notification on the watch/);
      // The settings button beside refresh closes the menu and opens Watch settings.
      assert.equal(await js(`document.querySelector('.watch-menu-identity [aria-label="Watch settings"]').nextElementSibling.getAttribute('aria-label')`), 'Refresh battery and status');
      // Refresh and Sync look different, and Sync is the main button once the watch is connected.
      assert.deepEqual(await js(`(() => { const icon = el => el.querySelector('svg').getAttribute('class'); const refresh = document.querySelector('.watch-menu-identity [aria-label="Refresh battery and status"]'); const sync = document.querySelector('.watch-menu-sync-button'); return { refresh: /rotate-cw/.test(icon(refresh)), sync: /refresh-cw/.test(icon(sync)), primary: sync.classList.contains('primary-button') }; })()`),
        { refresh: true, sync: true, primary: true });
      assert.equal(await js(`document.querySelector('.watch-menu-sync-button + .watch-menu-hint, .watch-menu-autosync .watch-menu-hint')`), null, 'no permanent hint lines under Sync or auto-sync');
      await js(`window.mock.calls.length = 0; document.querySelector('.watch-menu-identity [aria-label="Watch settings"]').click(); void 0`);
      await until(`window.mock.calls.includes('settings:watch') && !document.querySelector('.watch-menu-panel')`);
      // Satellite data: when it runs out, in plain words; weather and clock read "—" with the watch away.
      await show('connected');
      await openPage('details');
      await checkLayout(`${theme} details`);
      const satellite = await js(`(() => { const row = Array.from(document.querySelectorAll('.watch-link-details dl > div')).find(div => div.querySelector('dt').textContent === 'Satellite data'); const dd = row.querySelector('dd'); return { text: dd.textContent, sub: dd.querySelector('.watch-menu-detail-sub')?.textContent, lines: Math.round(dd.getBoundingClientRect().height / parseFloat(getComputedStyle(dd).lineHeight || '16')), title: dd.title }; })()`);
      assert.match(satellite.text, /^Valid until \w+ \d+, 20\d\d, \d+:\d\d [AP]M$/, 'only when the data runs out');
      assert.equal(satellite.sub, undefined, 'no chip format or other sub-line while connected');
      assert.equal(satellite.title, '', 'no tooltip repeats text that is already shown in full');
      await shoot(`${theme}-details`);
      await show('connected-no-satellite');
      await openPage('details');
      await shoot(`${theme}-details-no-satellite`);
      // A bind reply that wasn't understood reads as no data; its bytes stay out of the menu.
      await show('connected-unknown-satellite');
      await openPage('details');
      assert.equal(await js(`Array.from(document.querySelectorAll('.watch-link-details dd')).at(-1).textContent`), '—');
      assert.equal(await js(`document.querySelector('.watch-menu-panel').textContent.includes('7f00ff13')`), false, 'no raw hex');
      await show('offline');
      await openPage('details');
      // With the watch away, rows that would only read "—" are left out (no weather instructions either).
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-link-details > dl > div')).map(div => div.querySelector('dt').textContent)`), ['Connection', 'COROS session', 'Satellite data'], 'only rows with something to say');
      assert.equal(await js(`Array.from(document.querySelectorAll('.watch-link-details > dl dd')).some(dd => dd.textContent === '—')`), false, 'no rows of dashes');
      assert.match(await js(`Array.from(document.querySelectorAll('.watch-link-details dd')).at(-1).textContent`), /^Valid until .+ [AP]Mas read at the last connection$/, 'satellite data from the last connection says so');
      assert.equal(await js(`document.querySelector('.watch-link-details > .watch-menu-hint')`), null, 'a saved watch key needs no sign-in hint');
      await shoot(`${theme}-details-offline`);

      // Syncing: the button reports how much of the activity file has been read, without moving anything.
      await show('connected');
      const before = await js(`document.querySelector('.watch-menu-list').getBoundingClientRect().top`);
      await js(`window.mock.calls.length = 0; document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`window.mock.calls.includes('sync')`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent === 'Syncing…'`);
      await shoot(`${theme}-syncing`);
      await js(`window.mock.progress({ state: 'reading', receivedBytes: 1_250_000, totalBytes: 4_100_000 }); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent === 'Syncing… 30%'`);
      assert.equal(await js(`document.querySelector('.watch-menu-sync-meter').style.width`), '30%');
      assert.equal(await js(`document.querySelector('.watch-menu-list').getBoundingClientRect().top`), before, 'progress does not move the menu');
      assert.equal(await js(`document.querySelector('.watch-menu-autosync input').disabled`), true, 'automatic sync waits while a sync runs');
      // Closing the menu mid-sync loses nothing: reopened, it still shows the sync.
      await js(`document.getElementById('outside').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); void 0`);
      await until(`document.querySelector('.watch-menu-panel') === null`);
      await js(`document.querySelector('.watch-menu-trigger').click(); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button')?.textContent === 'Syncing… 30%'`);
      await checkLayout(`${theme} syncing`);
      await shoot(`${theme}-syncing-progress`);
      // A sync that finished with the calendar refused: a warning, right under the Sync button.
      await js(`window.mock.finishSync({ newActivities: 2, health: { ok: true, latestReadingAt: Math.floor(Date.now() / 1000) - 600 }, calendar: { ok: false, workouts: 3, error: 'The watch did not list the training calendar after the transfer. Reconnect the watch and sync again; if it keeps happening, restart the watch.' }, satellite: { ok: true, segments: 4, coveredUntil: Date.now() + 6 * 86400000 } }); void 0`);
      await until(`document.querySelector('.watch-sync-result') !== null`);
      assert.equal(await js(`document.querySelector('.watch-menu-sync-meter')`), null, 'the meter goes when the sync ends');
      // One line for what worked, then one warning row for the part that didn't, right under the Sync button.
      assert.deepEqual(await js(`(() => { const box = document.querySelector('.watch-sync-result'); const rows = Array.from(box.querySelectorAll('.watch-menu-result')); return { rows: rows.map(row => [row.className.replace('watch-menu-result ', ''), row.textContent]), icons: rows.every(row => row.querySelector('svg')), role: box.getAttribute('role'), beforeAutoSync: Boolean(box.compareDocumentPosition(document.querySelector('.watch-menu-autosync')) & Node.DOCUMENT_POSITION_FOLLOWING), afterButton: box.previousElementSibling?.classList.contains('watch-menu-connect') }; })()`),
        { rows: [['is-success', 'Synced · 2 new activities'], ['is-warning', "The training calendar wasn't sent."]], icons: true, role: 'status', beforeAutoSync: true, afterButton: true });
      assert.doesNotMatch(await text('.watch-sync-result'), /transfer|restart|block/i, 'no log text');
      // The watch stays connected after a sync.
      assert.equal(await js(`window.mock.calls.includes('disconnect')`), false, 'the menu does not disconnect after a sync');
      assert.equal(await js(`Boolean(document.querySelector('.watch-menu-connect-button'))`), false, 'still connected: no Connect button');
      assert.equal(await js(`document.querySelector('.watch-menu-sync-button').textContent`), 'Sync watch now', 'ready for another sync');
      await checkLayout(`${theme} calendar error`);
      await shoot(`${theme}-sync-calendar-error`);
      // The result outlives the menu: closed and reopened, it is still there.
      await js(`document.querySelector('.watch-menu-trigger').click(); void 0`);
      await until(`document.querySelector('.watch-menu-panel') === null`);
      await js(`document.querySelector('.watch-menu-trigger').click(); void 0`);
      await until(`document.querySelector('.watch-sync-result .is-warning') !== null`);

      // Health, satellite data and the calendar each get their own row; a calendar with nothing new gets none.
      await show('connected');
      await js(`document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent === 'Syncing…'`);
      await js(`window.mock.finishSync({ newActivities: 0, undecodedPayloads: 1, health: { ok: false, error: 'Daily history read failed at block 3 of 9' }, calendar: { ok: true, workouts: 3, unchanged: true }, satellite: { ok: false, error: 'The satellite-data server had nothing for the coming days.' } }); void 0`);
      await until(`document.querySelector('.watch-sync-result') !== null`);
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-sync-result .watch-menu-result')).map(row => row.textContent)`),
        ['Synced · no new activities', "Health data wasn't read.", "GPS satellite data wasn't updated.", "Some activities can't be shown yet."]);
      await checkLayout(`${theme} partial`);
      await shoot(`${theme}-sync-partial`);

      // Workouts the watch calendar can't take: the sync worked, and a warning says which were left off.
      await show('connected');
      await js(`document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent === 'Syncing…'`);
      await js(`window.mock.finishSync({ newActivities: 0, health: { ok: true }, calendar: { ok: true, workouts: 5, listed: true, skipped: { zoneTargets: 2, perDay: 1 } } }); void 0`);
      await until(`document.querySelector('.watch-sync-result') !== null`);
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-sync-result .watch-menu-result')).map(row => [row.className.replace('watch-menu-result ', ''), row.textContent])`),
        [['is-success', 'Synced · no new activities'], ['is-warning', "2 workouts weren't put on the watch: they use zone or % targets."], ['is-warning', "1 workout wasn't put on the watch."]]);
      await checkLayout(`${theme} skipped`);
      await shoot(`${theme}-sync-skipped`);
      // Every workout left off and no CorosLink plan on the watch: nothing was written, and the row still says why.
      await show('connected');
      await js(`document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent === 'Syncing…'`);
      await js(`window.mock.finishSync({ newActivities: 0, health: { ok: true }, calendar: { ok: true, workouts: 0, unchanged: true, skipped: { zoneTargets: 1 } } }); void 0`);
      await until(`document.querySelector('.watch-sync-result') !== null`);
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-sync-result .watch-menu-result')).map(row => row.textContent)`),
        ['Synced · no new activities', "1 workout wasn't put on the watch: it uses zone or % targets."]);
      // Satellite data partly sent (the main file went, a later one failed): the watch was updated, so no warning.
      await show('connected');
      await js(`document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent === 'Syncing…'`);
      await js(`window.mock.finishSync({ newActivities: 0, health: { ok: true }, satellite: { ok: false, files: 1, coveredUntil: Date.now() + 6 * 86400000, error: 'The second file failed.' } }); void 0`);
      await until(`document.querySelector('.watch-sync-result') !== null`);
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-sync-result .watch-menu-result')).map(row => row.textContent)`), ['Synced · no new activities']);

      // A plan from the COROS app on the watch: replaced only after the user agrees, then synced again.
      await show('connected');
      await js(`window.mock.calls.length = 0; document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`window.mock.calls.includes('sync')`);
      await js(`window.mock.finishSync({ newActivities: 1, health: { ok: true }, calendar: { ok: false, foreignPlan: true } }); void 0`);
      await until(`document.querySelector('.watch-sync-result [data-part=calendar]') !== null`);
      assert.equal(await text('.watch-sync-result [data-part=calendar]'), 'The watch has a training plan from the COROS app.Replace it');
      await checkLayout(`${theme} foreign plan`);
      await shoot(`${theme}-sync-foreign-plan`);
      await js(`document.querySelector('.watch-sync-result [data-part=calendar] button').click(); void 0`);
      await until(`document.querySelector('.watch-sync-result [data-part=calendar]').textContent.startsWith("Replace the plan on the watch with CorosLink's calendar?")`);
      assert.equal(await js(`window.mock.calls.includes('allowPlan')`), false, 'nothing is allowed before the user confirms');
      await checkLayout(`${theme} foreign plan confirm`);
      await shoot(`${theme}-sync-foreign-plan-confirm`);
      await js(`Array.from(document.querySelectorAll('.watch-sync-result [data-part=calendar] button')).find(button => button.textContent === 'Replace').click(); void 0`);
      await until(`window.mock.calls.includes('allowPlan') && window.mock.calls.filter(call => call === 'sync').length === 2`);
      assert.ok(await js(`window.mock.calls.indexOf('allowPlan') < window.mock.calls.lastIndexOf('sync')`), 'allowed first, then synced');
      await js(`window.mock.finishSync({ newActivities: 0, health: { ok: true }, calendar: { ok: true, workouts: 4 } }); void 0`);
      await until(`document.querySelector('.watch-sync-result') !== null`);
      assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-sync-result .watch-menu-result')).map(row => row.textContent)`), ['Synced · no new activities']);
      // A sync that failed outright.
      await show('connected');
      await js(`window.mock.calls.length = 0; document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`window.mock.calls.includes('sync')`);
      await js(`window.mock.failSync('The watch stopped answering while reading activity records (block 12 of 48). Keep the watch close to this computer, wake it, and sync again; nothing already read is lost.'); void 0`);
      await until(`document.querySelector('.watch-menu-result.is-error') !== null`);
      assert.equal(await text('.watch-menu-result.is-error'), 'Sync stopped. Keep the watch close and try again.', 'a plain message, no block counts');
      await checkLayout(`${theme} sync failed`);
      await shoot(`${theme}-sync-failed`);
    }

    // Not connected: one main button. Local-Only Mode leads with Sync (it connects first), Connect only sits in the footer.
    const notConnected = () => js(`(() => { const box = document.querySelector('.watch-menu-connect'); return { buttons: Array.from(box.querySelectorAll('button')).map(button => [button.textContent, button.className.includes('primary-button'), button.disabled]), hint: box.querySelector('.watch-menu-hint')?.textContent ?? null, connectOnly: Boolean(document.querySelector('.watch-menu-connect-only')) }; })()`);
    await show('never-paired');
    const firstTime = 'First time? On the watch, open System → Pair Phone, then connect and accept the pairing prompt.';
    assert.deepEqual(await notConnected(), { buttons: [['Sync watch now', true, true]], hint: firstTime, connectOnly: true }, 'never paired: Sync waits for the sign-in, with the pairing hint');
    assert.equal(await js(`document.getElementById(document.querySelector('.watch-menu-sync-button').getAttribute('aria-describedby'))?.textContent`), 'Your watch only trusts CorosLink after you sign in with the COROS account it’s paired to.', 'the reason is the sign-in callout');
    for (const name of ['offline', 'auto-paused-mismatch']) {
      await show(name);
      assert.deepEqual(await notConnected(), { buttons: [['Sync watch now', true, false]], hint: null, connectOnly: true }, `${name}: one main button, no first-time hint`);
    }
    await show('connected-mode-offline');
    assert.deepEqual(await notConnected(), { buttons: [['Connect watch', true, false]], hint: null, connectOnly: false }, 'Connected Mode: Connect alone');

    // Automatic sync: a labelled switch, off by default; the interval (1, 3, 6 or 12 hours) shows once it's on.
    await show('connected');
    assert.deepEqual(await js(`(() => { const input = document.querySelector('.watch-menu-autosync input'); return { role: input.getAttribute('role'), checked: input.checked, label: document.getElementById(input.getAttribute('aria-labelledby')).textContent, select: Boolean(document.querySelector('.watch-menu-autosync select')) }; })()`),
      { role: 'switch', checked: false, label: 'Auto-sync', select: false });
    await js(`document.querySelector('.watch-menu-autosync input').click(); void 0`);
    await until(`window.mock.calls.includes('autoSync:{"enabled":true}')`);
    await until(`document.querySelector('.watch-menu-autosync select')?.disabled === false`);
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-menu-autosync option')).map(option => option.textContent)`), ['Every hour', 'Every 3 hours', 'Every 6 hours', 'Every 12 hours']);
    // A background sync's result shows with the others, with its time.
    await js(`window.mock.autoSyncListeners.forEach(listener => listener({ enabled: true, intervalHours: 3, lastAttemptAt: Date.now() - 1000, lastSuccessAt: Date.now(), lastResult: { newActivities: 3, calendar: { ok: false, foreignPlan: true } } })); void 0`);
    await until(`document.querySelector('.watch-sync-result') !== null`);
    assert.match(await text('.watch-sync-result .is-success'), /^Synced at \d+:\d\d [AP]M · 3 new activities$/);
    assert.ok(await js(`Boolean(document.querySelector('.watch-sync-result [data-part=calendar] button'))`), 'a background sync can ask about the plan too');
    await show('auto-failed');
    await until(`document.querySelector('.watch-sync-result .is-warning') !== null`);
    assert.match(await text('.watch-sync-result .is-warning'), /^Automatic sync at \d+:\d\d [AP]M didn't reach the watch\.$/);
    await show('auto-on');
    await until(`document.querySelector('.watch-sync-result .is-success') !== null`);
    assert.match(await text('.watch-sync-result .is-success'), /^Synced at .+ · no new activities$/);

    // Another device answered with the watch's name: one plain line, and nothing connects until the user says so.
    await show('identity-mismatch');
    assert.deepEqual(await js(`(() => { const box = document.querySelector('.watch-menu-callout.is-identity'); return { role: box.getAttribute('role'), text: box.querySelector('strong').textContent, extra: box.querySelectorAll('p').length, buttons: Array.from(box.querySelectorAll('button')).map(button => button.textContent) }; })()`),
      { role: 'alert', text: 'This doesn’t look like the watch you connected before.', extra: 0, buttons: ['Connect anyway', 'Cancel'] });
    assert.equal(await js(`window.mock.calls.some(call => call.startsWith('connect'))`), false, 'nothing connects before the user decides');
    assert.equal(await js(`document.querySelector('.watch-menu-connect, .watch-menu-connect-only')`), null, 'the callout is the only choice: no Connect or Sync beside it');
    await js(`window.mock.calls.length = 0; Array.from(document.querySelectorAll('.watch-menu-callout.is-identity button')).find(button => button.textContent === 'Connect anyway').click(); void 0`);
    await until(`window.mock.calls.includes('connect:confirm')`);
    assert.deepEqual(await js(`window.mock.calls`), ['connect:confirm'], 'Connect anyway confirms the new watch');
    await show('identity-mismatch');
    await js(`window.mock.calls.length = 0; Array.from(document.querySelectorAll('.watch-menu-callout.is-identity button')).find(button => button.textContent === 'Cancel').click(); void 0`);
    await until(`window.mock.calls.includes('disconnect') && !document.querySelector('.watch-menu-callout.is-identity')`);
    assert.equal(await js(`window.mock.calls.some(call => call.startsWith('connect'))`), false, 'Cancel connects nothing');
    // Background sync paused until the watch is connected from the menu: a Paused chip, the controls dimmed, and a warning row.
    await show('auto-paused');
    assert.equal(await text('.watch-menu-autosync-paused'), 'Auto-sync paused. Connect your watch to resume.');
    assert.deepEqual(await js(`(() => { const box = document.querySelector('.watch-menu-autosync'); const row = box.querySelector('.watch-menu-autosync-paused'); return { paused: box.classList.contains('is-paused'), chip: box.querySelector('.watch-menu-autosync-chip')?.textContent, warning: row.classList.contains('is-warning') && Boolean(row.querySelector('svg')), dimmed: Number(getComputedStyle(box.querySelector('.watch-setting-switch')).opacity) < 1 && Number(getComputedStyle(box.querySelector('select')).opacity) < 1 }; })()`),
      { paused: true, chip: 'Paused', warning: true, dimmed: true });
    await show('auto-paused-mismatch');
    assert.equal(await text('.watch-menu-autosync-paused'), 'Auto-sync paused: another device answered. Connect your watch to resume.');
    await show('auto-on');
    assert.equal(await js(`document.querySelector('.watch-menu-autosync-paused, .watch-menu-autosync-chip')`), null);
    assert.equal(await js(`document.querySelector('.watch-menu-autosync').classList.contains('is-paused')`), false);
    // Two devices with the same name: the remembered watch is the one chosen.
    await show('same-name');
    await js(`Array.from(document.querySelectorAll('.watch-menu-footer button')).find(button => button.textContent.includes('Choose a watch')).click(); void 0`);
    await until(`document.querySelectorAll('.watch-menu-devices input').length === 2`);
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.watch-menu-devices input')).map(input => [input.value, input.checked])`), [['other', false], ['pace4', true]]);

    // Another view asks for a sync (the empty Training Hub): the menu opens and starts it.
    await show('connected');
    await js(`document.querySelector('.watch-menu-trigger').click(); void 0`);
    await until(`document.querySelector('.watch-menu-panel') === null`);
    await js(`window.mock.calls.length = 0; window.requestSync(); void 0`);
    await until(`window.mock.calls.includes('sync') && document.querySelector('.watch-menu-sync-button')?.textContent === 'Syncing…'`);
    await js(`window.mock.finishSync({ newActivities: 2, health: { ok: true } }); void 0`);
    await until(`document.querySelector('.watch-sync-result') !== null`);

    // Keyboard: open from the trigger, Back returns to the row it came from, Escape closes and returns focus, Tab away closes.
    win.webContents.focus();
    await js(`document.querySelector('.watch-menu-trigger').click(); void 0`);
    await until(`document.querySelector('.watch-menu-panel') === null`);
    await js(`document.querySelector('.watch-menu-trigger').focus(); void 0`);
    await key('Enter');
    await until(`document.activeElement?.classList.contains('watch-menu-panel')`);
    assert.equal(await js(`document.querySelector('.watch-menu-trigger').getAttribute('aria-expanded')`), 'true');
    assert.equal(await js(`document.querySelector('.watch-menu-panel').getAttribute('aria-labelledby') === document.querySelector('.watch-menu-panel h2').id`), true);
    await key('Tab');
    await key('Tab');
    assert.ok(await js(`document.activeElement.matches(':focus-visible')`), 'keyboard focus is visible');
    await shoot('light-keyboard-focus');
    await openPage('details');
    assert.ok(await js(`document.activeElement.classList.contains('watch-menu-back')`), 'a sub-page focuses Back');
    await key('Enter');
    await until(`document.activeElement?.dataset.page === 'details'`);
    await key('Escape');
    await until(`document.querySelector('.watch-menu-panel') === null`);
    assert.ok(await js(`document.activeElement.classList.contains('watch-menu-trigger')`), 'Escape returns focus to the trigger');
    await key('Enter');
    await until(`document.querySelector('.watch-menu-panel') !== null`);
    await js(`document.getElementById('outside').focus(); void 0`);
    await until(`document.querySelector('.watch-menu-panel') === null`);
    await js(`window.showScenario('connected'); void 0`);
    await until(`document.querySelector('.watch-menu-panel') !== null`);

    // Narrow windows: the trigger keeps only its lamp, and the panel fits beside a 12 px margin.
    for (const width of [420, 340]) {
      win.setContentSize(width, 1000);
      await wait(300);
      for (const name of ['connected', 'never-paired', 'auto-failed', 'auto-on', 'identity-mismatch', 'auto-paused-mismatch']) {
        await show(name);
        await checkLayout(`narrow ${width} ${name}`);
        if (width === 420) await shoot(`light-narrow-${name}`);
      }
      await openPage('details');
      await checkLayout(`narrow ${width} details`);
      if (width === 420) await shoot('light-narrow-details');
    }

    // French and Chinese: longer words wrap; the interval moves under its label when it has to.
    for (const language of ['fr', 'zh-CN']) {
      await js(`window.setTestLanguage(${JSON.stringify(language)}); void 0`);
      win.setContentSize(1100, 1000);
      await wait(300);
      for (const name of ['never-paired', 'auto-on', 'connected', 'identity-mismatch', 'auto-paused-mismatch']) {
        await show(name);
        await checkLayout(`${language} ${name}`);
      }
      await show('identity-mismatch');
      await shoot(`${language}-identity-mismatch`);
      await show('auto-on');
      await until(`document.querySelector('.watch-sync-result') !== null`);
      await checkLayout(`${language} auto-on`);
      await shoot(`${language}-auto-on`);
      // A partial result and the plan question in this language.
      await show('connected');
      await js(`document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').disabled`);
      await js(`window.mock.finishSync({ newActivities: 2, health: { ok: false, error: 'x' }, calendar: { ok: false, foreignPlan: true } }); void 0`);
      await until(`document.querySelector('.watch-sync-result [data-part=calendar] button') !== null`);
      await js(`document.querySelector('.watch-sync-result [data-part=calendar] button').click(); void 0`);
      await checkLayout(`${language} result`);
      await shoot(`${language}-sync-result`);
      await show('connected');
      await js(`window.mock.calls.length = 0; document.querySelector('.watch-menu-sync-button').click(); void 0`);
      await until(`window.mock.calls.includes('sync')`);
      await js(`window.mock.progress({ state: 'reading', receivedBytes: 3_000_000, totalBytes: 4_000_000 }); void 0`);
      await until(`document.querySelector('.watch-menu-sync-button').textContent.includes('75')`);
      await checkLayout(`${language} syncing`);
      await shoot(`${language}-syncing`);
      await show('connected');
      await openPage('details');
      await checkLayout(`${language} details`);
      assert.equal(await js(`Array.from(document.querySelectorAll('.watch-link-details dd')).at(-1).querySelector('.watch-menu-detail-sub')`), null);
      await shoot(`${language}-details`);
      win.setContentSize(340, 1000);
      await wait(300);
      await show('never-paired');
      await checkLayout(`${language} narrow`);
      await shoot(`${language}-narrow-never-paired`);
    }
    await js(`window.setTestLanguage('en'); void 0`);
    assert.deepEqual(errors, [], 'no console errors');
    console.log('Watch menu UI: states in both themes, satellite data, sync progress and results (kept when the menu closes, partial, foreign plan), automatic sync, a watch that does not match the remembered one, sync requests, keyboard, narrow, French and Chinese passed.');
  } finally { clearTimeout(watchdog); win?.destroy(); await vite?.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
