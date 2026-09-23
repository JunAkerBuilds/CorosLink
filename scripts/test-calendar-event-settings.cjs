const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(
  os.tmpdir(),
  `coroslink-calendar-events-ui-${process.pid}`,
);
app.setPath("userData", path.join(temporaryRoot, "user-data"));
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  let vite, window;
  const watchdog = setTimeout(() => app.exit(1), 60000);
  try {
    vite = await createServer({
      root,
      configFile: false,
      plugins: [react()],
      cacheDir: path.join(temporaryRoot, "vite-cache"),
      server: { host: "127.0.0.1", port: 0, hmr: false },
      logLevel: "error",
    });
    await vite.listen();
    window = new BrowserWindow({
      show: false,
      width: 1320,
      height: 1000,
      webPreferences: { contextIsolation: true, backgroundThrottling: false },
    });
    const js = (code) => window.webContents.executeJavaScript(code, true);
    async function until(code, label) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`Timed out: ${label}`);
    }
    const click = (label) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(label)})).click(); void 0;`,
      );
    const fill = (selector, value) =>
      js(
        `{ const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); } void 0;`,
      );
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/calendar-event-settings.html`);
    await until(`Boolean(document.querySelector('.calendar-event-timing select'))`, "event settings");
    const format = ".calendar-event-timing select";
    assert.equal(await js(`document.querySelector('${format}').value`), "all-day");
    assert.equal(await js(`Boolean(document.querySelector('input[type=time]'))`), false);
    await fill(format, "timed");
    await until(`Boolean(document.querySelector('input[type=time]'))`, "timed inputs");
    await fill("input[type=time]", "07:30");
    await fill(".calendar-event-time-fields label:last-child input", "08:15");
    await fill(".calendar-event-timing input[type=text]", "Europe/Paris");
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert.equal(await js(`document.querySelector('input[type=time]').value`), "07:30", "polling preserves draft");
    await fs.writeFile(path.join(temporaryRoot,"timed-settings.png"), (await window.webContents.capturePage()).toPNG());
    await click("Save event preferences");
    await until(`window.syncCalls.length === 1 && document.body.textContent.includes('Event preferences saved')`, "save and sync");
    assert.deepEqual(await js("window.settingsCalls"), [{provider:"google",input:{eventTiming:{mode:"timed",startTime:"07:30",endTime:"08:15",timeZone:"Europe/Paris"}}}]);
    assert.equal(await js(`document.querySelector('.calendar-event-timing button[type=submit]').disabled`),true);
    await click("Apple Calendar");
    await until(`document.querySelector('${format}')?.value === 'all-day'`, "independent Apple preferences");
    await fill(format, "timed");
    await fill("input[type=time]", "19:15");
    assert.equal(await js(`document.body.textContent.includes('End time is on the following day')`), true);
    assert.equal(await js(`Boolean(document.querySelector('input[type=number]'))`), false);
    await js("window.rejectSettings = true");
    await click("Save event preferences");
    await until(`document.body.textContent.includes('Unable to save preferences')`, "save error");
    assert.equal(await js(`document.querySelector('input[type=time]').value`), "19:15");
    assert.equal(await js("window.syncCalls.length"),1,"failed preferences do not sync");
    await js("window.rejectSettings = false");
    await click("Save event preferences");
    await until(`window.syncCalls.length === 2 && document.querySelector('.calendar-event-timing button[type=submit]').disabled`, "retry saved");
    await fill(".calendar-event-time-fields label:last-child input", "");
    assert.equal(await js(`document.querySelector('.calendar-event-timing').checkValidity()`),false);
    await click("Cancel");
    assert.equal(await js(`document.querySelector('.calendar-event-time-fields label:last-child input').value`),"19:00");
    window.setSize(420,1000);
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert.equal(await js(`document.documentElement.scrollWidth <= window.innerWidth`),true,"narrow layout fits");
    await fs.writeFile(path.join(temporaryRoot,"timed-settings-narrow.png"), (await window.webContents.capturePage()).toPNG());
    await click("Google Calendar");
    await until(`document.querySelector('input[type=time]')?.value === '07:30'`, "preferences persist after provider switch");
    console.log(`Calendar event settings passed: save/sync, polling, provider isolation, validation, errors, persistence and narrow layout. Screenshots: ${temporaryRoot}`);
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite?.close();
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
