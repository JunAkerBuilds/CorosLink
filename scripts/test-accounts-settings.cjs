const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(
  os.tmpdir(),
  `coroslink-accounts-ui-${process.pid}`,
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
    await window.loadURL(
      `http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/accounts-settings.html`,
    );
    await until(
      `Boolean(document.querySelector('.settings-account-entry'))`,
      "Settings entry",
    );
    assert.equal(
      await js(`Boolean(document.querySelector('.accounts-screen'))`),
      false,
    );
    await click("Account settings");
    await until(
      `document.body.textContent.includes('runner@example.com') && !document.body.textContent.includes('Checking…')`,
      "connection status",
    );
    assert.deepEqual(
      await js(
        `Array.from(document.querySelectorAll('.accounts-navigation button span'), e => e.textContent)`,
      ),
      [
        "All connections",
        "COROS Account",
        "Media",
        "Maps",
        "Strength",
        "Coach / AI",
        "Calendar",
      ],
    );
    assert.match(
      await js(
        `Array.from(document.querySelectorAll('.account-card')).find(e => e.textContent.includes('Apple Music')).textContent`,
      ),
      /Status unavailable/,
    );
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await fs.writeFile(
      path.join(temporaryRoot, "accounts.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    for (const [label, destination] of [
      ["COROSYour", "training"],
      ["YouTube", "youtube"],
      ["YouTube Music", "youtube-music"],
      ["Spotify", "spotify"],
      ["Apple Music", "apple-music"],
      ["Hevy", "strength"],
      ["AI providers", "coach"],
    ]) {
      await js(
        `document.querySelector('.account-card-${destination}').click(); void 0;`,
      );
      assert.equal(await js("window.destination"), destination);
    }
    await js(
      `Array.from(document.querySelectorAll('.accounts-navigation button')).find(b => b.textContent === 'Media').click(); void 0;`,
    );
    assert.equal(
      await js(`document.querySelectorAll('.account-card').length`),
      4,
    );
    assert.equal(
      await js(`Boolean(document.querySelector('.account-card-google'))`),
      false,
    );
    await js(
      `Array.from(document.querySelectorAll('.accounts-navigation button')).find(b => b.textContent === 'Calendar').click(); void 0;`,
    );
    assert.equal(
      await js(`document.querySelectorAll('.account-card').length`),
      2,
    );
    await click("Apple Calendar");
    await until(
      `Boolean(document.querySelector('input[type=email]'))`,
      "Apple setup",
    );
    assert.equal(
      await js(`document.querySelector('input[type=email]').value`),
      "",
    );
    await fill("input[type=email]", "different@example.com");
    await new Promise((resolve) => setTimeout(resolve, 3100));
    assert.equal(
      await js(`document.querySelector('input[type=email]').value`),
      "different@example.com",
      "status polling preserves edits",
    );
    await click("Use COROS email");
    assert.equal(
      await js(`document.querySelector('input[type=email]').value`),
      "runner@example.com",
    );
    await fill("input[type=password]", "app-password");
    await js(`document.querySelector('form').requestSubmit(); void 0;`);
    await until(`Boolean(window.appleCredentials)`, "Apple connect");
    assert.deepEqual(await js(`window.appleCredentials`), {
      email: "runner@example.com",
      appPassword: "app-password",
    });
    await click("All accounts");
    await click("Google Calendar");
    await until(
      `document.querySelector('.calendar-provider-tabs [aria-pressed=true]')?.textContent.includes('Google Calendar')`,
      "Google selected",
    );
    await click("All accounts");
    await click("All connections");
    await click("OpenRouteService");
    await until(
      `Boolean(document.querySelector('select'))`,
      "routing settings",
    );
    await fill("select", "ors");
    await fill("input[type=password]", "invalid-key");
    await click("Save settings");
    await until(
      `document.body.textContent.includes('Invalid API key')`,
      "invalid key feedback",
    );
    assert.equal(await js("window.saves"), 0, "invalid key is not persisted");
    await fill("input[type=password]", "valid-key");
    await click("Save settings");
    await until(
      `document.body.textContent.includes('Routing settings saved.')`,
      "save confirmation",
    );
    assert.equal(await js("window.saves"), 1);
    await click("All accounts");
    window.setSize(440, 1100);
    await until(`window.innerWidth === 440`, "narrow viewport");
    assert.equal(
      await js(`document.documentElement.scrollWidth <= window.innerWidth`),
      true,
      "no horizontal overflow",
    );
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await fs.writeFile(
      path.join(temporaryRoot, "accounts-narrow.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await js(
      `document.querySelector('.accounts-screen > button').click(); void 0;`,
    );
    await until(
      `Boolean(document.querySelector('.settings-account-entry'))`,
      "Back to Settings",
    );
    console.log(
      `Account setup UI passed: destinations, partial failure, email reuse, polling, calendar selection, route validation, narrow layout. Screenshots: ${temporaryRoot}`,
    );
  } finally {
    window?.destroy();
    await vite?.close();
    clearTimeout(watchdog);
  }
}
main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
