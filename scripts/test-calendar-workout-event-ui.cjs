const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(
  os.tmpdir(),
  `coroslink-calendar-workout-ui-${process.pid}`,
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
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/calendar-workout-event.html`);
    await until(`Boolean(document.querySelector('.calendar-chip-planned'))`, "calendar workout");
    await click("Morning run");
    await until(`Boolean(document.querySelector('.calendar-workout-event-head'))`, "event editor inside calendar");
    await click("Calendar event");
    await until(`Boolean(document.querySelector('.calendar-workout-event [role=radio]'))`, "expanded event editor");
    await click("Timed");
    await fill('input[name=startTime]', "07:30");
    await fill('input[name=endTime]', "08:15");
    await click("Save & sync");
    await until(`document.body.textContent.includes('Saved and updated Google Calendar and Apple Calendar')`, "automatic calendar sync");
    assert.deepEqual(await js("window.eventCalls[0].timing"),{mode:"timed",startTime:"07:30",endTime:"08:15",timeZone:"America/Toronto"});
    assert.equal(await js("window.eventCalls[0].ref.userId"),"u");
    await until(`document.querySelector('.calendar-chip-planned').textContent.includes('07:30–08:15')`, "saved time on calendar card");
    await until(`Math.abs(document.querySelector('.calendar-detail-panel').getBoundingClientRect().right - (window.innerWidth - 16)) < 1`, "detail panel animation settles");
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(temporaryRoot,"calendar-event-editor.png"),(await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('[aria-label="Close details"]').click()`);
    await until(`!document.querySelector('.calendar-workout-event')`, "closed editor");
    await click("Morning run");
    await until(`document.querySelector('input[name=startTime]')?.value === '07:30'`, "saved event reopens");
    await fill('input[name=endTime]', "");
    assert.equal(await js(`document.querySelector('.calendar-workout-event').checkValidity()`),false);
    await fill('input[name=endTime]', "08:45");
    await js("window.offline=true");
    await click("Save & sync");
    await until(`document.querySelector('[role=alert]')?.textContent.includes('Google Calendar: Offline')`, "partial provider failure");
    assert.equal(await js(`document.querySelector('input[name=endTime]').value`),"08:45");
    await js("window.offline=false");
    assert.equal(await js(`document.querySelector('.calendar-workout-event button[type=submit]').disabled`), false, "partial sync failure can be retried without changing event times");
    await click("Save & sync");
    await until(`window.eventCalls.length === 3 && !document.querySelector('[role=alert]')`, "retry failed provider sync");
    await click("All day");
    await click("Save & sync");
    await until(`window.eventCalls.length === 4 && document.querySelector('.calendar-chip-planned').textContent.includes('All day')`, "all-day event save");
    await js(`document.querySelector('[aria-label="Close details"]').click()`);
    await until(`!document.querySelector('.calendar-workout-event')`, "closed editor");
    await js(`{
      const chip=document.querySelector('.calendar-chip-planned');
      const transfer=new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      const target=Array.from(document.querySelectorAll('.calendar-day')).find(day=>!day.classList.contains('is-past')&&!day.classList.contains('is-today'));
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
    } void 0;`);
    await until(`window.syncCalls.length === 1`, "calendar drag automatically syncs");
    assert.equal(await js("window.errors.length"),0);
    console.log(`Calendar event editor passed: calendar entry point, explicit times, persistence, all-day, validation, partial sync failure and drag sync. Screenshot: ${temporaryRoot}/calendar-event-editor.png`);
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite?.close();
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
