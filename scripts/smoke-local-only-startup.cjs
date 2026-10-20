// Starts the real app (dist-electron/main.js + the built renderer) in
// Local-Only Mode with a throwaway profile, opens every sidebar section and
// Settings, and fails if anything tried to upload to COROS. Other services
// (fonts, map tiles, weather) load normally, so this needs a network.
//   npm run build && electron scripts/smoke-local-only-startup.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-local-only-smoke-"));
app.setPath("userData", profile);
fs.mkdirSync(path.join(profile, "privacy"), { recursive: true });
fs.writeFileSync(path.join(profile, "privacy", "data-mode.json"), JSON.stringify({
  version: 1, mode: "local_only", allowLan: false, changedAt: new Date().toISOString()
}));

const dist = path.join(__dirname, "..", "dist-electron");
require(path.join(dist, "main.js"));
const { networkPolicy, dataMode } = require(path.join(dist, "privacy", "bootstrap.js"));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  await app.whenReady();
  let window;
  for (let tries = 0; tries < 100 && !window; tries++) {
    window = BrowserWindow.getAllWindows()[0];
    if (!window) await delay(100);
  }
  if (!window) throw new Error("The main window did not open.");
  if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
  await delay(4000);
  const js = (code) => window.webContents.executeJavaScript(code);

  const sections = await js(`[...document.querySelectorAll(".app-sidebar-nav button")].map((button) => button.textContent.trim())`);
  for (let index = 0; index < sections.length; index++) {
    await js(`document.querySelectorAll(".app-sidebar-nav button")[${index}]?.click()`);
    await delay(2500);
  }
  await js(`document.querySelector(".app-toolbar-settings")?.click()`);
  await delay(2500);
  const privacyPanel = await js(`Boolean(document.querySelector(".privacy-settings"))`);
  const indicator = await js(`Boolean(document.querySelector(".app-privacy-indicator"))`);
  // With COROSLINK_SYNC_CAPTURE=1 the developer capture controls must show (they load with the overview).
  await delay(1000);
  const capturePanel = await js(`Boolean(document.querySelector(".privacy-capture"))`);
  if (capturePanel !== (process.env.COROSLINK_SYNC_CAPTURE === "1")) throw new Error("The developer capture controls do not match COROSLINK_SYNC_CAPTURE.");

  // The renderer bridge reaches local data end to end.
  const bridge = await js(`(async () => {
    const api = window.corosLink;
    const overview = await api.getLocalDataOverview();
    const activities = await api.listTrainingHubActivities(1, 20);
    const report = await api.getNetworkAccessReport();
    const health = await api.getTrainingDailyHealthData(7);
    let upload;
    try { await api.saveCorosGear({}); upload = "sent"; } catch (error) { upload = String(error.message).includes("Local-Only Mode:") ? "refused" : String(error); }
    return { localOnlyAtLaunch: api.localOnlyAtLaunch, activities: activities.length, total: overview.activities.total, reportMode: report.status.mode, healthConnected: health.mcpConnected, upload };
  })()`);
  console.log(JSON.stringify(bridge));
  if (!bridge.localOnlyAtLaunch || bridge.reportMode !== "local_only" || bridge.upload !== "refused") throw new Error("The renderer bridge did not behave as Local-Only Mode.");

  const status = dataMode.status();
  const attempts = networkPolicy.recentAttempts();
  console.log(JSON.stringify({ sections, privacyPanel, indicator, status: { mode: status.mode, phase: status.phase, enforcing: status.enforcing }, attempts }, null, 2));
  if (!status.enforcing || status.mode !== "local_only") throw new Error("Local-Only Mode was not active at startup.");
  if (!privacyPanel || !indicator) throw new Error("The privacy panel or the Local-Only indicator is missing.");
  if (attempts.length) throw new Error(`${attempts.length} upload(s) to COROS were attempted; nothing should try to upload in Local-Only Mode.`);
}

run().then(
  () => { console.log("local-only startup smoke: no uploads to COROS attempted"); app.exit(0); },
  (error) => { console.error(error); app.exit(1); }
).finally(() => fs.rmSync(profile, { recursive: true, force: true }));
