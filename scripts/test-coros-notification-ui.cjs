const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { app, BrowserWindow } = require("electron");
const temp = path.join(os.tmpdir(), `coros-notification-ui-${process.pid}`);
app.setPath("userData", path.join(temp, "user-data"));
app.on("window-all-closed", () => {});
async function main() {
  await app.whenReady();
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const vite = await createServer({ root: path.resolve(__dirname, ".."), configFile: false, plugins: [react()],
    cacheDir: path.join(temp, "vite"), server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
  await vite.listen();
  const win = new BrowserWindow({ show: false, width: 1000, height: 950 });
  const errors = [];
  const js = async expression => {
    try { return await win.webContents.executeJavaScript(expression, true); }
    catch (error) { throw Error(`${expression}: ${error.message}; renderer errors: ${errors.join('; ')}`); }
  };
  win.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  async function until(expression) {
    for (let i = 0; i < 100; i++) { if (await js(`!!(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error(`Timed out: ${expression}`);
  }
  async function type(value) {
    await js(`(()=>{const input=document.querySelector('#coros-notification-message');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  // On watch buttons by visible label or aria-label; menu rows and buttons by text.
  const button = label => `[...document.querySelectorAll('.watch-link button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})`;
  const menuButton = text => `[...document.querySelectorAll('.watch-menu-panel button')].find(b=>b.textContent.includes(${JSON.stringify(text)}))`;
  const install = `document.querySelector('.watch-install-actions .primary-button')`;
  const click = label => js(`${button(label)}.click(); void 0`);
  const clickMenu = text => js(`${menuButton(text)}.click(); void 0`);
  const trigger = "document.querySelector('.watch-menu-trigger')";
  const openMenu = async () => {
    if (!await js("!!document.querySelector('.watch-menu-panel')")) await js(`${trigger}.click(); void 0`);
    await until("document.querySelector('.watch-menu-panel')");
  };
  const page = async text => {
    await openMenu();
    if (await js("!!document.querySelector('.watch-menu-back')")) { await js("document.querySelector('.watch-menu-back').click(); void 0"); await until("document.querySelector('.watch-menu-row')"); }
    await clickMenu(text); await until("document.querySelector('.watch-menu-back')");
  };
  const send = ".watch-link-composer button[type=submit]";
  const submit = () => js("document.querySelector('.watch-link-composer').requestSubmit(); void 0");
  const faces = ".watch-faces";
  try {
    await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/coros-notification.html`);
    await until("document.querySelector('.watch-on-watch') && document.querySelector('.watch-menu-trigger')");
    await until(`${trigger}.textContent.includes('Connected')`);
    assert.match(await js(`${trigger}.textContent`), /PACE Pro TEST/, "the toolbar names the watch without the COROS prefix");
    assert.equal(await js("document.querySelector('.watch-on-watch .watch-link-state').textContent"), "Connected");
    assert.equal(await js("!!document.querySelector('.watch-menu-panel')"), false, "the menu starts closed");

    // Toolbar menu: home rows, Escape, and the message composer.
    await openMenu();
    assert.equal(await js(`${trigger}.getAttribute('aria-expanded')`), "true");
    assert.deepEqual(await js("[...document.querySelectorAll('.watch-menu-row strong')].map(e=>e.textContent)"),
      ["Watch faces", "Send a message", "iPhone app", "Connection details"]);
    assert.equal(await js("!!document.querySelector('.watch-menu-connect-button')"), false, "a connected watch offers no Connect button");
    await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); void 0");
    await until("!document.querySelector('.watch-menu-panel')");
    assert.equal(await js(`document.activeElement === ${trigger}`), true, "Escape returns focus to the trigger");
    await page("Send a message");
    assert.equal(await js(`document.querySelector('${send}').disabled`), true);
    await type("   ");
    await submit();
    assert.equal(await js("notificationFixture.calls.length"), 0, "empty messages never submit");
    await type("Temperature: 21 °C\nSensor ready");
    await until(`!document.querySelector('${send}').disabled`);
    await submit();
    await until("notificationFixture.calls.length === 1");
    assert.deepEqual(await js("notificationFixture.calls[0]"), { title: "CorosLink", body: "Temperature: 21 °C\nSensor ready" });
    assert.equal(await js(`document.querySelector('${send}').disabled`), true);
    await submit();
    assert.equal(await js("notificationFixture.calls.length"), 1, "pending send cannot submit twice");
    await js("notificationFixture.pending.resolve({sent:true,fragments:4}); void 0");
    await until("document.querySelector('.watch-link-composer [role=status]')");
    assert.equal(await js("document.querySelector('#coros-notification-message').value"), "Temperature: 21 °C\nSensor ready");
    await type("Another message");
    await submit();
    await until("notificationFixture.calls.length === 2");
    await js("notificationFixture.pending.reject(new Error('The watch is disconnected.')); void 0");
    await until("document.querySelector('.watch-link-composer [role=alert]')?.textContent.includes('disconnected')");
    assert.equal(await js("document.querySelector('#coros-notification-message').value"), "Another message");
    await type("😀".repeat(130));
    await until("document.querySelector('#coros-notification-message').getAttribute('aria-invalid') === 'true'");
    assert.equal(await js(`document.querySelector('${send}').disabled`), true);
    await submit();
    assert.equal(await js("notificationFixture.calls.length"), 2, "UTF-8 overflow never reaches the sender");

    await page("Connection details");
    assert.equal(await js("document.querySelector('.watch-link-events')?.textContent.includes('Media command 2, value 1')"), true);
    await js("document.querySelector('.watch-menu-back').click(); void 0");
    await until("document.querySelector('.watch-menu-row')");
    await clickMenu("Watch faces");
    await until("!document.querySelector('.watch-menu-panel')");
    assert.deepEqual(await js("notificationFixture.navigations"), ["watch"], "Watch faces opens the On watch tab");

    // On watch: slots, compiling and installs.
    await until("document.querySelectorAll('.watch-slot').length === 10");
    assert.equal(await js(`${install}.disabled`), true, 'choose a compiled BIN first');
    await click("Choose BIN");
    await until(`document.querySelector('${faces} .watch-source')?.textContent.includes('test-face.bin')`);
    await until(`!${install}.disabled`);
    assert.equal(await js(`${install}.textContent.trim()`), "Install in slot 2");
    await js(`${install}.click(); ${install}.click(); void 0`);
    await until("notificationFixture.faceCalls.length === 1");
    assert.equal(await js(`${button("Choose BIN")}.disabled`), true);
    await js("notificationFixture.faceStatus={phase:'transferring',sentBytes:6008,totalBytes:12016}; void 0");
    await until(`document.querySelector('${faces} .watch-install-progress')?.textContent.includes('50%')`);
    await js("notificationFixture.facePending.resolve({phase:'complete',sentBytes:12016,totalBytes:12016,watchSlot:1}); void 0");
    await until(`document.querySelector('${faces} .watch-link-note[role=status]')?.textContent.includes('slot 2')`);
    await until(`!${install}.disabled`);
    await js(`${install}.click(); void 0`);
    await until("notificationFixture.faceCalls.length === 2");
    await js("notificationFixture.facePending.reject(new Error('All watch face slots are occupied.')); void 0");
    await until(`document.querySelector('${faces} [role=alert]')?.textContent.includes('occupied')`);
    await until(`!${install}.disabled`);
    await js(`${install}.click(); void 0`);
    await until("notificationFixture.faceCalls.length === 3");
    await click("Cancel");
    await until(`document.querySelector('${faces} .watch-link-note[role=status]')?.textContent.includes('cancelled')`);
    assert.deepEqual(await js('notificationFixture.faceCalls'), ['local-preview','local-preview','local-preview']);
    assert.equal(await js('notificationFixture.faceTargets[0].slot'), 1);
    assert.equal(await js('notificationFixture.faceTargets[0].replaceExisting'), false, 'empty slot needs no replacement');
    await until(`!${button("Refresh slots")}.disabled`);
    await js(`notificationFixture.faceIds=Array.from({length:10},(_,i)=>1001+i); ${button("Refresh slots")}.click(); void 0`);
    await until(`document.querySelector('.watch-faces-head')?.textContent.includes('10 of 10 in use')`);
    assert.equal(await js("document.querySelectorAll('.watch-slots input:checked').length"), 0, 'full inventory never chooses a replacement automatically');
    assert.equal(await js(`${install}.disabled`), true);
    await js("document.querySelector('.watch-slots input[value=\"6\"]').click(); void 0");
    await until(`!${install}.disabled`);
    assert.equal(await js(`${install}.textContent.trim()`), 'Replace slot 7');
    assert.equal(await js("document.querySelector('.watch-install-destination').textContent.includes('face ID 1007 in slot 7')"), true);
    await js(`${install}.click(); void 0`);
    await until("notificationFixture.faceCalls.length === 4");
    assert.equal(await js('notificationFixture.faceTargets[3].slot'), 6);
    assert.equal(await js('notificationFixture.faceTargets[3].replaceExisting'), true);
    assert.equal(await js("document.querySelector('.watch-slots input[value=\"2\"]').matches(':disabled')"), true, 'lock selection while transferring');
    assert.equal(await js(`${install}.textContent.trim()`), 'Installing…');
    await js("notificationFixture.faceIds[6]=12345;notificationFixture.facePending.resolve({phase:'complete',sentBytes:12016,totalBytes:12016,watchSlot:6,verification:'inventory-id'}); void 0");
    await until(`document.querySelector('${faces} .watch-link-note[role=status]')?.textContent.includes('slot 7')`);
    await until("document.querySelector('.watch-slot:nth-of-type(7)').textContent.includes('12345')");
    assert.equal(await js("document.querySelectorAll('.watch-slots input:checked').length"), 0, 'replacement selection resets after sync');
    await js("document.querySelector('.watch-slots input[value=\"6\"]').click(); void 0");
    await until(`!${install}.disabled`);
    await js(`${install}.click(); void 0`);
    await until("notificationFixture.faceCalls.length === 5");
    await js("notificationFixture.facePending.resolve({phase:'complete',sentBytes:12016,totalBytes:12016,watchSlot:6,verification:'transfer-acknowledged'}); void 0");
    await until(`document.querySelector('${faces} .watch-link-note[role=status]')?.textContent.includes('face ID is unchanged')`);
    await until(`!${button("Refresh slots")}.disabled`);
    await js(`notificationFixture.inventoryError='The watch is disconnected.';${button("Refresh slots")}.click(); void 0`);
    await until(`document.querySelector('${faces} [role=alert]')?.textContent.includes('disconnected')`);
    assert.equal(await js("document.querySelectorAll('.watch-slot').length"), 0, 'failed read cannot reuse a stale selection');
    assert.equal(await js(`${install}.disabled`), true);
    await js(`notificationFixture.inventoryError=null;${button("Refresh slots")}.click(); void 0`);
    await until("document.querySelectorAll('.watch-slot').length === 10");
    assert.ok(await js('notificationFixture.inventoryReads < 20'), 'automatic refresh does not loop');
    await until(`!${button("Compile DAT/ZIP")}.disabled`);
    await js(`${button("Compile DAT/ZIP")}.click(); ${button("Compile DAT/ZIP")}.click(); void 0`);
    await until('notificationFixture.compilerCalls === 1');
    await until(`document.querySelector('${faces} .watch-source')?.textContent.includes('Compiling watch face…')`);
    await js("notificationFixture.compilerStatus={available:true,busy:false,phase:'ready',detail:'BIN ready.',engine:'typescript'}; notificationFixture.compilerPending.resolve({id:'compiled-preview',name:'Custom',bytes:64000,faceId:123456,source:'compiled',compile:{engine:'typescript',durationMs:380,warnings:['a.png is missing.','b.png is missing.','c.png is missing.','d.png is missing.']}}); void 0");
    await until(`document.querySelector('${faces} .watch-source')?.textContent.includes('Compiled in 0.4 s')`);
    assert.equal(await js(`document.querySelectorAll('${faces} .watch-compile-warnings li').length`), 4, 'three warnings and a count of the rest');
    assert.match(await js(`document.querySelector('${faces} .watch-compile-warnings').textContent`), /4 elements won't show as designed.*And 1 more\./);
    await until(`${button("Save BIN")} && !${button("Save BIN")}.disabled`);
    await click("Save BIN");
    await until("notificationFixture.savedBins.length === 1");
    assert.deepEqual(await js('notificationFixture.savedBins'), ['compiled-preview'], 'BIN save uses a token rather than a renderer file path');
    await until(`!${button("Compile DAT/ZIP")}.disabled`);
    await click("Compile DAT/ZIP");
    await until('notificationFixture.compilerCalls === 2');
    await js("notificationFixture.compilerStatus={available:true,busy:false,phase:'failed',detail:'Invalid assets.'};notificationFixture.compilerPending.reject(new Error('Invalid PNG assets.')); void 0");
    await until(`document.querySelector('${faces} [role=alert]')?.textContent.includes('Invalid PNG')`);
    assert.equal(await js(`document.querySelector('${faces} .watch-source').textContent.includes('Custom')`), true, 'a compile failure preserves the previous valid BIN');
    await fs.mkdir(path.resolve(".work/notification-test"), { recursive: true });
    await fs.writeFile(path.resolve(".work/notification-test/message-box.png"), (await win.webContents.capturePage()).toPNG());
    win.setSize(430, 950);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await js("(p=>p.scrollWidth<=p.clientWidth&&p.getBoundingClientRect().right<=innerWidth)(document.querySelector('.watch-on-watch'))"), true, "On watch fits narrow widths");
    win.setSize(1000, 950);

    // Disconnected: the menu leads with Connect; installs and messages are gated.
    await js("Object.assign(notificationFixture.state,{phase:'idle',connected:false,systemBind:'not_authenticated'}); notificationFixture.render(); void 0");
    await until("document.querySelector('.watch-on-watch .watch-link-state')?.textContent === 'Not connected'");
    await until(`${trigger}.textContent.includes('Offline')`);
    await click("Choose BIN");
    await until(`document.querySelector('${faces} .watch-source')?.textContent.includes('test-face.bin')`);
    assert.equal(await js(`${install}.disabled`), true, 'disconnected watch cannot sync');
    await click("Connect watch");
    // Local-Only Mode: one main button, Sync (it connects first); Connect only sits in the footer.
    await until("document.querySelector('.watch-menu-connect-only') && document.querySelector('.watch-menu-sync-button')");
    assert.equal(await js("!!document.querySelector('.watch-menu-connect-button')"), false, "no second big button");
    await page("Send a message");
    await until("document.querySelector('#coros-notification-help')?.textContent.includes('Connect and authenticate')");
    await type("Should stay local"); await submit();
    assert.equal(await js("notificationFixture.calls.length"), 2, "disconnected state cannot submit");

    // One button connects: an unknown watch is found and, alone nearby, connected.
    await js("notificationFixture.remembered=false; notificationFixture.nearby=[{deviceId:'only',deviceName:'COROS PACE Pro 1A2B'}]; void 0");
    await js("document.querySelector('.watch-menu-back').click(); void 0");
    await until("document.querySelector('.watch-menu-connect-only')");
    await js("document.querySelector('.watch-menu-connect-only').click(); void 0");
    await until(`${trigger}.textContent.includes('Connected')`);
    assert.equal(await js("notificationFixture.scans"), 1);
    assert.deepEqual(await js("notificationFixture.connectCalls.map(c=>c.device?.deviceId ?? null)"), [null, "only"], "tries the remembered watch, then the one nearby");
    assert.equal(await js("!!document.querySelector('.watch-menu-devices')"), false, "a single watch needs no choice");

    // Several watches: choose one, then connect to it.
    await clickMenu("Disconnect");
    await until("document.querySelector('.watch-menu-connect-only')");
    await js("notificationFixture.connectCalls=[]; notificationFixture.nearby=[{deviceId:'a',deviceName:'COROS PACE Pro 2F1A'},{deviceId:'b',deviceName:'COROS PACE 4 81C2'}]; void 0");
    await js("document.querySelector('.watch-menu-connect-only').click(); void 0");
    await until("document.querySelectorAll('.watch-menu-devices label').length === 2");
    assert.equal(await js("document.querySelector('.watch-menu-connect-only').disabled"), true, "choose a watch before connecting");
    assert.equal(await js("document.querySelector('.watch-menu-sync-button').disabled"), true, "or syncing");
    await js("[...document.querySelectorAll('.watch-menu-devices input')][1].click(); void 0");
    await until("document.querySelector('.watch-menu-connect-only').textContent.includes('COROS PACE 4')");
    await js("document.querySelector('.watch-menu-connect-only').click(); void 0");
    await until(`${trigger}.textContent.includes('Connected')`);
    assert.deepEqual(await js("notificationFixture.connectCalls.map(c=>c.device?.deviceId ?? null)"), [null, "b"]);
    assert.equal(await js("notificationFixture.connectCalls.every(c=>c.backend==='system')"), true, "connecting always uses the computer's Bluetooth");
    assert.equal(await js("document.querySelector('.watch-menu-panel').textContent.includes('Mac Bluetooth')"), false);

    // Sync from the watch menu: offered while connected, and the watch stays connected afterwards.
    await openMenu();
    await until("document.querySelector('.watch-menu-sync-button')");
    assert.equal(await js("!!document.querySelector('.watch-menu-connect-only')"), false);
    const connectsBeforeSync = await js("notificationFixture.connectCalls.length");
    await js("document.querySelector('.watch-menu-sync-button').click(); void 0");
    await until("document.querySelector('.watch-menu-panel .watch-sync-result')?.textContent.includes('1 new activity')");
    const summary = await js("document.querySelector('.watch-menu-panel .watch-sync-result').textContent");
    assert.equal(summary, "Synced · 1 new activity", "one line when everything worked");
    assert.equal(await js("notificationFixture.syncCalls"), 1);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await js("!!document.querySelector('.watch-menu-connect-only')"), false, "still connected after the sync");
    assert.ok((await js(`${trigger}.textContent`)).includes('Connected'));
    // A second sync right away uses the same connection.
    await js("document.querySelector('.watch-menu-sync-button').click(); void 0");
    await until("notificationFixture.syncCalls === 2");
    assert.equal(await js("notificationFixture.connectCalls.length"), connectsBeforeSync, "no reconnect between syncs");
    // A watch that went away: Sync is the one main button and connects it first.
    await js("Object.assign(notificationFixture.state, { phase: 'idle', connected: false, systemBind: 'not_authenticated' }); void 0");
    await until("document.querySelector('.watch-menu-connect-only') && document.querySelector('.watch-menu-sync-button')");
    assert.equal(await js("document.querySelector('.watch-menu-sync-button').classList.contains('primary-button')"), true, "Sync leads");
    // (With several watches nearby and none remembered, Sync first lists them, like Connect; here the watch is remembered.)
    await js("notificationFixture.remembered = true; void 0");
    const connectsBefore = await js("notificationFixture.connectCalls.length");
    await js("document.querySelector('.watch-menu-sync-button').click(); void 0");
    await until("notificationFixture.syncCalls === 3");
    assert.equal(await js("notificationFixture.connectCalls.length"), connectsBefore + 1, "a disconnected watch is connected before syncing");
    await until(`${trigger}.textContent.includes('Connected')`);
    assert.equal(await js("!!document.querySelector('.watch-menu-connect-only')"), false, "and stays connected after the sync");

    // Rejected sign-in: the watch shows connected, the menu asks for COROS sign-in.
    await js("Object.assign(notificationFixture.state,{systemBind:'failed',authenticationError:'The watch rejected COROS authentication.'}); void 0");
    await until(`${trigger}.textContent.includes('Auth failed')`);
    await until("document.querySelector('.watch-on-watch .watch-link-state')?.textContent === 'Authentication failed'");
    await until("document.querySelector('.watch-menu-callout')?.textContent.includes('rejected COROS authentication')");
    await page("Send a message");
    await type("Requires authentication"); await submit();
    assert.equal(await js("notificationFixture.calls.length"), 2, "unauthenticated state cannot submit");
    await js("document.querySelector('.watch-menu-back').click(); void 0");
    await until("document.querySelector('.watch-menu-callout')");
    await js("document.querySelector('.watch-menu-callout button').click(); void 0");
    await until("!document.querySelector('.watch-menu-panel')");
    assert.deepEqual(await js("notificationFixture.navigations"), ["watch", "sign-in"]);

    // Connection details: the saved watch key survives sign-out and has its own Remove button.
    await page("Connection details");
    const keySection = "document.querySelector('.watch-link-key')";
    // The last connection found a different key on the watch: that leads, not "It doesn't expire".
    await until(`${keySection}?.querySelector('[role=alert]')`);
    assert.equal(await js(`${keySection}.textContent.includes('It doesn’t expire')`), false, "no reassurance above the problem");
    assert.equal(await js(`${keySection}.querySelector('h3').nextElementSibling.getAttribute('role')`), "alert", "the problem comes first");
    // Four rows: the masked account, saved time (unknown for a 0.1.57 key), last use and the key ID the watch reports.
    assert.deepEqual(await js(`[...${keySection}.querySelectorAll('dt')].map(x=>x.textContent)`), ["Account", "Saved", "Last used", "Key ID"]);
    const keyRows = await js(`[...${keySection}.querySelectorAll('dd')].map(x=>x.textContent)`);
    assert.equal(keyRows[0], "ru•••@example.com");
    assert.equal(keyRows[1], "Unknown");
    assert.match(keyRows[2], /^COROS PACE 4 · .*2026/);
    assert.equal(keyRows[3], "3F1A");
    assert.equal(await js(`${keySection}.textContent.includes('It stops working if you pair or reset your watch in the COROS app.')`), false, "no general hint beside the problem");
    // Say what happened, with a way to sign in again.
    const keyProblem = `${keySection}.querySelector('[role=alert]')`;
    assert.match(await js(`${keyProblem}.textContent`), /has a different key .*Sign in to COROS again/);
    assert.equal(await js(`[...${keyProblem}.querySelectorAll('button')].some(b=>b.textContent==='Sign in')`), true);
    const keyButtons = () => js(`[...${keySection}.querySelectorAll('.watch-link-key-actions button')].map(b=>b.textContent.trim())`);
    const keyButton = text => `[...${keySection}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    const fill = (selector, value) => js(`(()=>{const input=${keySection}.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const labelled = text => js(`(()=>{const label=[...${keySection}.querySelectorAll('label')].find(l=>l.textContent===${JSON.stringify(text)});
      const input=label&&document.getElementById(label.htmlFor);return input?input.type+':'+(label.offsetWidth>1):null;})()`);
    assert.deepEqual(await keyButtons(), ["Back up watch key", "Restore watch key…", "Remove watch key"]);

    // Back up: the passphrase twice, each with a visible label; too short or different can't be sent.
    await js(`${keyButton("Back up watch key")}.click(); void 0`);
    await until(`${keySection}.querySelector('form')`);
    assert.equal(await labelled("Passphrase"), "password:true", "the passphrase field has a visible label");
    assert.equal(await labelled("Repeat passphrase"), "password:true");
    assert.match(await js(`${keySection}.querySelector('form').textContent`), /anyone with both can sign in to your watch\. The passphrase can’t be recovered\./);
    const save = `${keySection}.querySelector('form button[type=submit]')`;
    assert.equal(await js(`${save}.disabled`), true);
    await fill("input[autocomplete=new-password]", "short");
    await until(`${keySection}.querySelector('input[aria-invalid=true]')`);
    assert.equal(await js(`${save}.disabled`), true, "under 8 characters");
    assert.match(await js(`${keySection}.querySelector('form').textContent`), /At least 8 characters/);
    await fill("form input:nth-of-type(1)", "correct horse battery");
    await fill("form input:nth-of-type(2)", "correct horse batter");
    await until(`${keySection}.textContent.includes('The passphrases don’t match.')`);
    assert.equal(await js(`${save}.disabled`), true, "the passphrases differ");
    await fill("form input:nth-of-type(2)", "correct horse battery");
    await until(`!${save}.disabled`);
    await js(`${keySection}.querySelector('form').requestSubmit(); void 0`);
    await until(`${keySection}.textContent.includes('Watch key backup saved.')`);
    assert.deepEqual(await js("notificationFixture.backupCalls"), ["correct horse battery"], "the passphrase is sent once");
    assert.equal(await js(`!!${keySection}.querySelector('form')`), false, "the form closes");
    assert.equal(await js(`[...document.querySelectorAll('input[type=password]')].some(i=>i.value)`), false, "no passphrase is left in the page");

    // Cancel a backup: nothing is sent.
    await js(`${keyButton("Back up watch key")}.click(); void 0`);
    await until(`${keySection}.querySelector('form')`);
    await fill("form input:nth-of-type(1)", "abandoned passphrase");
    await js(`${keyButton("Cancel")}.click(); void 0`);
    await until(`!${keySection}.querySelector('form')`);
    assert.equal(await js("notificationFixture.backupCalls.length"), 1);

    await js(`${keyButton("Remove watch key")}.click(); void 0`);
    await until(`${keySection}.textContent.includes('Not saved')`);
    assert.equal(await js(`${keySection}.querySelectorAll('dt').length`), 0, "no rows once the key is removed");
    assert.equal(await js("notificationFixture.forgetCalls"), 1);
    assert.deepEqual(await keyButtons(), ["Restore watch key…"], "nothing left to remove or back up; a backup can still be restored");

    // Restore: main's file dialog first, then the passphrase. A wrong one says so plainly and can be retried.
    await js(`${keyButton("Restore watch key…")}.click(); void 0`);
    await until(`${keySection}.querySelector('form')`);
    assert.equal(await js("notificationFixture.chooseCalls"), 1);
    assert.equal(await labelled("Backup passphrase"), "password:true");
    await fill("form input", "wrong passphrase");
    await js(`${keySection}.querySelector('form').requestSubmit(); void 0`);
    await until(`${keySection}.querySelector('[role=alert]')?.textContent === 'Wrong passphrase or damaged file.'`);
    assert.equal(await js(`${keySection}.querySelector('form input').value`), "", "the passphrase is cleared after each try");
    assert.equal(await js(`!!${keySection}.querySelector('form')`), true, "and the form stays for another try");
    await fill("form input", "correct horse battery");
    await js(`${keySection}.querySelector('form').requestSubmit(); void 0`);
    await until(`${keySection}.textContent.includes('Watch key restored.')`);
    await until(`${keySection}.querySelectorAll('dt').length === 4`);
    assert.equal(await js(`${keySection}.querySelectorAll('dt').length`), 4, "the restored key's details are shown");
    assert.deepEqual(await js("notificationFixture.restoreCalls"), ["wrong passphrase", "correct horse battery"]);
    // The same key again: just say so.
    await js(`${keyButton("Restore watch key…")}.click(); void 0`);
    await until(`${keySection}.querySelector('form')`);
    await fill("form input", "correct horse battery");
    await js(`${keySection}.querySelector('form').requestSubmit(); void 0`);
    await until(`${keySection}.textContent.includes('This watch key is already saved.')`);
    // Choosing no file opens no form; cancelling one tells main to drop the chosen file.
    await js("notificationFixture.backupChosen = false; void 0");
    await js(`${keyButton("Restore watch key…")}.click(); void 0`);
    await until("notificationFixture.chooseCalls === 3");
    assert.equal(await js(`!!${keySection}.querySelector('form')`), false);
    await js("notificationFixture.backupChosen = true; void 0");
    await js(`${keyButton("Restore watch key…")}.click(); void 0`);
    await until(`${keySection}.querySelector('form')`);
    await js(`${keyButton("Cancel")}.click(); void 0`);
    await until("notificationFixture.cancelRestoreCalls === 1");
    assert.deepEqual(errors, []);
    console.log("Watch menu (connect, choose a watch, sync, messages, details, watch key backup, restore and removal, sign-in), On watch installs, cancellation, error recovery, connection gating and narrow layout passed.");
  } finally { win.destroy(); await vite.close(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
