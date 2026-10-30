// Map areas copied over the USB cable: choosing the transfer, the plug-in prompt, size and free space,
// a copy with its progress, both themes, French, and screenshots for review when COROSLINK_SHOTS names a directory.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), `coroslink-map-areas-${process.pid}`));
app.on('window-all-closed', () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let vite, win;
  const watchdog = setTimeout(() => { console.error('Map areas UI timed out'); app.exit(1); }, 120000);
  const shots = process.env.COROSLINK_SHOTS;
  const errors = [];
  try {
    vite = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', define: { global: 'globalThis' } });
    await vite.listen();
    win = new BrowserWindow({ show: false, width: 1280, height: 900 });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    async function until(code) {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (await js(code)) return; await wait(50); }
      throw new Error(`Timed out: ${code}\n${await js('document.body.innerText')}`);
    }
    const text = selector => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click(); void 0`);
    const shoot = async name => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      // The DevTools capture renders the current frame; capturePage on a hidden window can return the one before.
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) dbg.attach('1.3');
      await wait(250);
      const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    };
    // Nothing in the plan column is cut off or pokes out of it, and the plan's footer stays inside the card.
    const checkLayout = async label => {
      const result = await js(`(() => {
        const aside = document.querySelector('.wifi-maps-aside'), a = aside.getBoundingClientRect();
        const name = el => (typeof el.className === 'string' ? el.className : el.tagName) + ': ' + el.textContent.trim().slice(0, 50);
        return {
          outside: Array.from(aside.querySelectorAll('*')).filter(el => { const r = el.getBoundingClientRect(); return r.width > 1 && (r.right > a.right + 0.5 || r.left < a.left - 0.5); }).map(name),
          cut: Array.from(aside.querySelectorAll('strong, p, button, small, span')).filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(name),
          spill: Array.from(document.querySelector('.wifi-maps-plan-foot').children).filter(el => el.getBoundingClientRect().bottom > document.querySelector('.wifi-maps-plan').getBoundingClientRect().bottom + 0.5).map(name),
          overlap: (() => { const tasks = document.querySelector('.wifi-maps-tasks'); return Boolean(tasks) && document.querySelector('.wifi-maps-plan').getBoundingClientRect().bottom > tasks.getBoundingClientRect().top + 0.5; })()
        };
      })()`);
      assert.deepEqual(result.outside, [], `${label}: nothing sticks out of the plan`);
      assert.deepEqual(result.cut, [], `${label}: no text is cut off`);
      assert.deepEqual(result.spill, [], `${label}: the footer stays inside the plan card`);
      assert.equal(result.overlap, false, `${label}: the plan ends above "On your watch"`);
    };
    const usbRadio = '.wifi-maps-transfer-option:nth-child(2)';

    nativeTheme.themeSource = 'dark';
    const page = `http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/map-areas.html`;
    const plug = (freeBytes = 2500000000) => js(`window.setWatch({ connected: true, rootPath: '/Volumes/PACE 4', model: 'pace-4', freeBytes: ${freeBytes} }); void 0`);
    const checked = () => js(`document.querySelector('.wifi-maps-transfer-option[aria-checked=true]')?.textContent`);
    const keydown = key => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); void 0`);
    await win.loadURL(page);
    await until(`document.querySelector('.wifi-maps-transfer') !== null`);
    assert.equal(await checked(), 'Watch Wi-Fi', 'Wi-Fi stays the default without a watch or Local-Only Mode');
    assert.ok(await js(`document.querySelector('.wifi-maps-plan-mode .wifi-maps-transfer') !== null`), 'the switch heads the plan');

    // The switch is one radio group: one Tab stop, arrow keys change the choice and follow focus.
    assert.deepEqual(await js(`[...document.querySelectorAll('.wifi-maps-transfer-option')].map(b => b.tabIndex)`), [0, -1]);
    await js(`document.querySelector('.wifi-maps-transfer-option[aria-checked=true]').focus(); void 0`);
    await keydown('ArrowRight');
    await until(`document.querySelector('.wifi-maps-transfer-option[aria-checked=true]')?.textContent === 'USB cable'`);
    assert.equal(await js(`document.activeElement.textContent`), 'USB cable', 'focus follows the choice');
    assert.deepEqual(await js(`[...document.querySelectorAll('.wifi-maps-transfer-option')].map(b => b.tabIndex)`), [-1, 0]);

    // USB without a watch plugged in: no size check, the copy waits for the watch.
    await until(`document.querySelector('.wifi-maps-connect')?.textContent.includes('Plug in your watch')`);
    assert.equal(await text('.wifi-maps-link'), 'Not plugged in');
    assert.match(await text('.wifi-maps-lede'), /USB cable/);
    assert.equal(await js(`document.querySelector('.wifi-maps-download')`), null, 'nothing to copy to');
    assert.equal((await js('window.calls')).filter(call => call.operation === 'preview').length, 0, 'COROS isn\'t asked about sizes without a watch');
    assert.equal(await js(`document.querySelector('.wifi-maps-foot-note')`), null);
    await checkLayout('dark unplugged');
    await shoot('dark-usb-unplugged');

    // Plugged in: one size, and the free space (all of it still to copy).
    await plug();
    await until(`document.querySelector('.wifi-maps-space') !== null`);
    assert.equal(await text('.wifi-maps-link'), 'Plugged in');
    assert.deepEqual((await js('window.calls')).filter(call => call.operation === 'preview').at(-1).tiles, [{ x: 101, y: 60 }]);
    assert.equal(await text('.wifi-maps-size > span'), 'Size2 map files');
    assert.equal(await text('.wifi-maps-size strong'), '20 MB');
    assert.equal(await text('.wifi-maps-space'), '2.3 GB free on the watch');
    assert.equal(await js(`document.querySelector('.wifi-maps-download').disabled`), false);
    await checkLayout('dark plugged in');
    await shoot('dark-usb-ready');

    // Part of it on the watch already: what's left to copy.
    await js(`window.setPreview({ fileCount: 2, sizeBytes: 21286347, neededBytes: 2545762, freeBytes: 2400000000 }); void 0`);
    await plug(2400000000);
    await until(`document.querySelector('.wifi-maps-space')?.textContent === '2.4 MB to copy · 2.2 GB free on the watch'`);

    // More than the watch has free: the copy is refused before it starts.
    await js(`window.setPreview({ fileCount: 2, sizeBytes: 21286347, neededBytes: 21286347, freeBytes: 5000000 }); void 0`);
    await plug(5000000);
    await until(`document.querySelector('.wifi-maps-plan-foot .wifi-maps-size-error')?.textContent.includes('free up space')`);
    assert.equal(await js(`document.querySelector('.wifi-maps-download').disabled`), true);
    await checkLayout('dark too big');
    await shoot('dark-usb-too-big');

    // Areas already on the watch.
    await js(`window.setPreview({ fileCount: 2, sizeBytes: 21286347, neededBytes: 0, freeBytes: 2500000000 }); void 0`);
    await plug(2500000000);
    await until(`document.querySelector('.wifi-maps-space')?.textContent === 'These areas are already on the watch.'`);

    // A copy: the picker is locked, progress shows (no sizes before the files are listed), then the selection clears.
    await js(`window.setPreview({ fileCount: 2, sizeBytes: 21286347, neededBytes: 21286347, freeBytes: 2400000000 }); void 0`);
    await plug(2400000000);
    await until(`document.querySelector('.wifi-maps-space')?.textContent === '2.2 GB free on the watch'`);
    await click('.wifi-maps-download');
    await until(`window.calls.some(call => call.operation === 'install')`);
    const install = (await js('window.calls')).find(call => call.operation === 'install');
    assert.deepEqual(install.tiles, [{ x: 101, y: 60 }]);
    assert.equal(install.label, 'Ho Chi Minh City');
    assert.equal(await js(`document.querySelector('.wifi-maps-transfer-option').disabled`), true, 'the transfer can\'t change mid-copy');
    await checkLayout('dark copy starting');
    await js(`window.pushProgress({ active: true, phase: 'preparing', label: 'Ho Chi Minh City', copiedBytes: 0, totalBytes: 0, copiedFiles: 0, totalFiles: 0, progress: 0, updatedAt: new Date().toISOString() }); void 0`);
    await until(`document.querySelector('.map-install-progress')?.textContent.includes('Preparing…')`);
    assert.equal(await text('.map-install-progress small'), 'Ho Chi Minh City', 'no "0 B of 0 B" before the files are listed');
    assert.equal(await js(`document.querySelector('.map-install-progress [role=progressbar]').getAttribute('aria-valuenow')`), '0');
    await js(`window.pushProgress({ active: true, phase: 'downloading', label: 'Ho Chi Minh City', copiedBytes: 8000000, totalBytes: 21286347, copiedFiles: 0, totalFiles: 2, progress: 0.38, updatedAt: new Date().toISOString() }); void 0`);
    await until(`document.querySelector('.map-install-progress')?.textContent.includes('Downloading maps')`);
    assert.equal(await js(`document.querySelector('.wifi-maps-download')`), null, 'the progress takes the button\'s place');
    assert.equal(await text('.map-install-progress .secondary-button'), 'Cancel');
    await checkLayout('dark downloading');
    await shoot('dark-usb-downloading');
    await click('.map-install-progress .secondary-button');
    await until(`window.calls.some(call => call.operation === 'cancel')`);
    await js(`window.pushProgress({ active: false, phase: 'completed', label: 'Ho Chi Minh City', copiedBytes: 21286347, totalBytes: 21286347, copiedFiles: 2, totalFiles: 2, progress: 1, updatedAt: new Date().toISOString() }); window.finishCopy(); void 0`);
    await until(`document.querySelector('.wifi-maps-notice.is-success')?.textContent.includes('Ho Chi Minh City is on your watch')`);
    assert.equal(await js(`document.querySelectorAll('.wifi-maps-area').length`), 0, 'the copied areas are cleared');
    assert.equal(await js(`document.querySelector('.map-install-progress')`), null);

    // The USB choice is remembered. A failed copy says why; a cancelled one adds nothing to the progress panel's own message.
    await win.reload();
    await until(`document.querySelector('.wifi-maps-transfer-option[aria-checked=true]')?.textContent === 'USB cable'`);
    await plug(2400000000);
    await until(`document.querySelector('.wifi-maps-download')?.disabled === false`);
    await click('.wifi-maps-download');
    await until(`window.calls.some(call => call.operation === 'install')`);
    await js(`window.finishCopy('The watch disconnected while installing maps.'); void 0`);
    await until(`document.querySelector('.wifi-maps-notice.is-error')?.textContent.includes('disconnected')`);
    assert.equal(await js(`document.querySelectorAll('.wifi-maps-area').length`), 1, 'the areas stay chosen to try again');

    // That notice plus downloads left on the watch: the plan grows instead of covering "On your watch".
    await js(`localStorage.setItem('coroslink.wifiMaps.taskNames.v1', JSON.stringify({ GAO6Uadj: 'Ho Chi Minh City', FAILED01: 'Cần Thơ' }));
      window.setWifiTasks([{ id: 'GAO6Uadj', state: 'queued', statusCode: 2, downloadedBytes: 0, totalBytes: 21286347, errorCode: 0 },
        { id: 'FAILED01', state: 'failed', statusCode: 1, downloadedBytes: 4800000, totalBytes: 21286347, errorCode: 3 }]); void 0`);
    await until(`document.querySelectorAll('.wifi-maps-task').length === 2`);
    assert.equal(await js(`document.querySelector('.wifi-maps-download').disabled`), false, 'the watch\'s Wi-Fi status doesn\'t reset a USB size check');
    await checkLayout('dark notice with downloads');
    await shoot('dark-notice-with-downloads');

    await click('.wifi-maps-download');
    await until(`window.calls.filter(call => call.operation === 'install').length === 2`);
    await js(`window.finishCopy('Transfer cancelled.'); void 0`);
    await until(`document.querySelector('.wifi-maps-download')?.disabled === false`);
    assert.equal(await js(`document.querySelector('.wifi-maps-plan .wifi-maps-notice.is-error')`), null);

    // Downloads waiting on the watch can't be cancelled while it's plugged in; the list says so.
    const cancelButtons = () => js(`[...document.querySelectorAll('.wifi-maps-task-cancel')].map(b => [b.textContent, b.disabled, b.getAttribute('aria-label')])`);
    assert.equal(await text('.wifi-maps-task-note'), 'Unplug the watch to cancel a download.');
    assert.deepEqual(await cancelButtons(), [['Cancel', true, 'Cancel Ho Chi Minh City on the watch'], ['Remove', true, 'Remove Cần Thơ from the watch']]);
    await checkLayout('dark downloads while plugged in');
    await shoot('dark-wifi-tasks-plugged');
    await js(`window.setWatch(null); void 0`);
    await until(`document.querySelector('.wifi-maps-task-note') === null && document.querySelector('.wifi-maps-task-cancel')?.disabled === false`);
    // An error stays with its download.
    await js(`window.setRemoveError("Unplug the watch's USB cable, then cancel the download again."); void 0`);
    await click('.wifi-maps-task-cancel');
    await until(`document.querySelector('.wifi-maps-task .wifi-maps-notice.is-error')?.textContent.includes('Unplug')`);
    assert.equal(await js(`document.querySelectorAll('.wifi-maps-task')[0].querySelector('.wifi-maps-notice') !== null`), true, 'shown in that row');
    await checkLayout('dark cancel error');
    await js(`window.setRemoveError(); void 0`);
    await click('.wifi-maps-task-cancel');
    await until(`document.querySelectorAll('.wifi-maps-task').length === 1`);
    await click('.wifi-maps-task-cancel');
    await until(`document.querySelector('.wifi-maps-tasks') === null`);
    assert.deepEqual((await js('window.calls')).filter(call => call.operation === 'remove').map(call => call.id), ['GAO6Uadj', 'GAO6Uadj', 'FAILED01']);

    // Before any choice, USB is picked in Local-Only Mode and when a watch is plugged in.
    await js(`localStorage.removeItem('coroslink.selection.v1.maps.areaTransfer'); void 0`);
    await win.loadURL(`${page}?localOnly`);
    await until(`document.querySelector('.wifi-maps-transfer') !== null`);
    assert.equal(await checked(), 'USB cable', 'Local-Only Mode starts on USB');
    await js(`localStorage.removeItem('coroslink.selection.v1.maps.areaTransfer'); void 0`);
    await win.loadURL(`${page}?plugged`);
    await until(`document.querySelector('.wifi-maps-transfer') !== null`);
    assert.equal(await checked(), 'USB cable', 'a plugged-in watch starts on USB');
    // USB only by default: the drive dropping mid-copy keeps USB, the progress and Cancel.
    await until(`document.querySelector('.wifi-maps-download')?.disabled === false`);
    await click('.wifi-maps-download');
    await until(`window.calls.some(call => call.operation === 'install')`);
    await js(`window.pushProgress({ active: true, phase: 'downloading', label: 'Ho Chi Minh City', copiedBytes: 8000000, totalBytes: 21286347, copiedFiles: 0, totalFiles: 2, progress: 0.38, updatedAt: new Date().toISOString() }); void 0`);
    await js(`window.setWatch(null); void 0`);
    await until(`document.querySelector('.map-install-progress .secondary-button')?.textContent === 'Cancel'`);
    assert.equal(await checked(), 'USB cable', 'a copy keeps USB when the drive drops out');
    await js(`window.pushProgress({ active: false, phase: 'failed', label: 'Ho Chi Minh City', copiedBytes: 8000000, totalBytes: 21286347, copiedFiles: 0, totalFiles: 2, progress: 0.38, error: 'The watch disconnected while installing maps.', updatedAt: new Date().toISOString() });
      window.finishCopy('The watch disconnected while installing maps.'); void 0`);
    await until(`document.querySelector('.wifi-maps-notice.is-error')?.textContent.includes('disconnected')`);
    assert.equal(await checked(), 'USB cable', 'the copy pinned USB as the choice');
    await js(`window.setWatch({ connected: true, rootPath: '/Volumes/PACE 4', model: 'pace-4', freeBytes: 2500000000 }); void 0`);
    await click('.wifi-maps-transfer-option');
    assert.equal(await checked(), 'Watch Wi-Fi', 'a choice still wins');

    // Light theme, French and Chinese.
    await win.loadURL(`${page}?plugged`);
    nativeTheme.themeSource = 'light';
    await until(`document.querySelector('.wifi-maps-transfer') !== null`);
    await click('.wifi-maps-transfer-option:nth-child(2)');
    await js(`document.documentElement.dataset.theme = 'paper'; void 0`);
    await until(`document.querySelector('.wifi-maps-space') !== null`);
    await checkLayout('light plugged in');
    await shoot('light-usb-ready');
    await js(`window.setTestLanguage('fr'); void 0`);
    await until(`document.querySelector('.wifi-maps-download')?.textContent === 'Copier sur la montre'`);
    assert.equal(await checked(), 'Câble USB');
    assert.equal(await text('.wifi-maps-size small'), '2 fichiers de carte');
    await checkLayout('light French');
    await shoot('light-usb-ready-fr');
    await js(`window.setTestLanguage('zh-CN'); void 0`);
    await until(`document.querySelector('.wifi-maps-link')?.textContent === '已插入'`);
    assert.equal(await text('.wifi-maps-size small'), '2 个地图文件', 'no English plural glued on');
    assert.equal(await js(`document.querySelector('.wifi-maps-size > span').firstChild.textContent`), '大小', 'file size, not dimensions');
    await checkLayout('light Chinese');
    await shoot('light-usb-ready-zh');
    await js(`window.setTestLanguage('en'); void 0`);

    assert.deepEqual(errors.filter(message => !/tile\.openstreetmap|Failed to load resource/.test(message)), [], 'no console errors');
    console.log('Map areas UI passed: defaults (Wi-Fi, Local-Only and plugged-in USB), keyboard switch, plug-in prompt, size and free space, partial and too-big copies, progress phases and cancel, remembered choice, notices beside downloads, cancelling and removing Wi-Fi downloads (unplugged only), light and dark, French and Chinese.');
  } finally {
    clearTimeout(watchdog);
    win?.destroy();
    await vite?.close();
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
