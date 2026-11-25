// `npm run dev`: the Vite server for the screens, the main process rebuilt on change, and Electron, restarted when
// the main process is rebuilt.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
// Local mode's Bluetooth helper (native/ble, clink-ble) is found only once built; build it when it's missing.
const ble = path.join(root, "native/ble/target/release", process.platform === "win32" ? "clink-ble.exe" : "clink-ble");
if (!existsSync(ble)) {
  console.log("Building the Bluetooth helper for Local mode (a few minutes, once)…");
  const made = spawnSync("cargo", ["build", "--release"], { cwd: path.join(root, "native/ble"), stdio: "inherit" });
  if (made.status !== 0) console.warn("The Bluetooth helper didn't build (is Rust installed?); Local mode can't pair a watch this run.");
}

const vite = await createServer({ configFile: path.join(root, "vite.config.mts") });
await vite.listen();

const build = spawn(process.execPath, [path.join(root, "scripts/build-main.mjs"), "--watch"], { stdio: "inherit" });
await new Promise((resolve) => setTimeout(resolve, 1500));

// The main process answers the screens' /api calls (Coach's cards among them) and only loads its code at launch, so
// a rebuilt dist/main means a stale app until it restarts. The screens hot-reload on their own; this restarts
// Electron when the main bundle changes. CLINK_NO_RESTART=1 keeps the window up and only says a restart is due.
let electron = null, restarting = false, due = null;
function launch() {
  electron = spawn(path.join(root, "node_modules/.bin/electron"), [
    // CLINK_INSPECT=9223 opens Chrome DevTools Protocol on that port, for looking at the window from outside.
    ...(process.env.CLINK_INSPECT ? [`--remote-debugging-port=${process.env.CLINK_INSPECT}`] : []),
    root,
  ], {
    stdio: "inherit",
    env: { ...process.env, CLINK_DEV_SERVER: "http://localhost:5174" },
  });
  electron.on("exit", async () => {
    if (restarting) { restarting = false; launch(); return; }
    watcher.close();
    build.kill();
    await vite.close();
    process.exit(0);
  });
}
// Several bundles are written per rebuild, so wait for the writing to settle before acting once.
const watcher = watch(path.join(root, "dist/main"), (_event, file) => {
  if (!file || !String(file).endsWith(".cjs") || !electron) return;
  clearTimeout(due);
  due = setTimeout(() => {
    if (restarting) return;
    if (process.env.CLINK_NO_RESTART) { console.log("[dev] The main process was rebuilt. Restart the app to load it."); return; }
    console.log("[dev] The main process was rebuilt: restarting the app.");
    restarting = true;
    electron.kill();
  }, 1200);
});
launch();
