// Offline regression: changing desktop language must preserve unsaved calendar/workout forms.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(os.tmpdir(), `coroslink-language-drafts-${process.pid}`);
app.setPath("userData", path.join(temporaryRoot, "user-data"));
app.on("window-all-closed", () => {});

async function main() {
  await app.whenReady();
  const { createServer } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  let vite, window;
  const watchdog = setTimeout(() => app.exit(1), 60_000);
  try {
    vite = await createServer({
      root, configFile: false, plugins: [react()], logLevel: "error",
      cacheDir: path.join(temporaryRoot, "vite-cache"),
      optimizeDeps: {
        include: ["react", "react-dom/client", "react/jsx-runtime", "motion/react", "lucide-react"],
        entries: ["scripts/fixtures/calendar-language-drafts.html"]
      },
      server: { host: "127.0.0.1", port: 0, hmr: false }
    });
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code, true);
    async function until(code, label) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await js(code)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out: ${label}`);
    }
    async function fill(selector, value) {
      await js(`{ const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
      await until(`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`, "input updated");
    }
    async function switchLanguage(language, translatedText) {
      await js(`switchLanguage(${JSON.stringify(language)})`);
      await until(`document.body.textContent.includes(${JSON.stringify(translatedText)})`, "language changed");
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/calendar-language-drafts.html`);
    const workoutName = ".workout-editor-basics input[maxlength]";
    await until(`!!document.querySelector(${JSON.stringify(workoutName)})`, "workout loaded");
    await fill(workoutName, "My unsaved workout");
    await switchLanguage("fr", "Modifier");
    assert.equal(await js(`document.querySelector(${JSON.stringify(workoutName)}).value`), "My unsaved workout", "French switch preserves the edited workout");
    assert.equal(await js("editorLoads"), 1, "language changes do not reload the source workout");
    await switchLanguage("en", "Edit");
    assert.equal(await js(`document.querySelector(${JSON.stringify(workoutName)}).value`), "My unsaved workout");

    await js("showCalendar()");
    const clientId = '.calendar-connection-setup input:not([type="password"])';
    await until(`!!document.querySelector(${JSON.stringify(clientId)})`, "Google setup loaded");
    await fill(clientId, "unsaved-client-id");
    await switchLanguage("fr", "Synchronisation");
    assert.equal(await js(`document.querySelector(${JSON.stringify(clientId)}).value`), "unsaved-client-id", "French switch preserves the OAuth client ID");
    await switchLanguage("en", "Calendar sync");
    assert.equal(await js(`document.querySelector(${JSON.stringify(clientId)}).value`), "unsaved-client-id");

    await js(`[...document.querySelectorAll('.calendar-provider-tabs button')].find(button => button.textContent.includes('Apple')).click()`);
    const email = '.calendar-connection-setup input[type="email"]';
    await until(`!!document.querySelector(${JSON.stringify(email)})`, "Apple setup loaded");
    await fill(email, "unsaved@example.com");
    await switchLanguage("fr", "Synchronisation");
    assert.equal(await js(`document.querySelector(${JSON.stringify(email)}).value`), "unsaved@example.com", "French switch preserves the Apple email");
    console.log("Calendar language drafts passed: workout edits, OAuth client ID, and Apple email survive live language changes.");
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    await vite?.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
