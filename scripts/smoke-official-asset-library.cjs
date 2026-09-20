#!/usr/bin/env electron
// Builds the in-app official asset library for one watch using the local
// CorosLink install's signed-in session, then lists a page and reads one set.
//
//   npm run build:electron
//   electron scripts/smoke-official-asset-library.cjs ["COROS W336"]
//
// Uses the real user-data directory (the cache the app itself will reuse).
// Set COROSLINK_ASSET_LIBRARY_URL to exercise the hosted source.
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const firmwareType = process.argv[2] ?? "COROS W336";
const userData = process.env.COROSLINK_USER_DATA
  ?? path.join(os.homedir(), "Library", "Application Support", "coroslink");
// safeStorage keys the keychain entry by app name; match the dev instance.
app.setName(process.env.COROSLINK_APP_NAME ?? "coroslink");
app.setPath("userData", userData);

async function main() {
  await app.whenReady();
  require("../dist-electron/database.js").initializeDatabase(userData);
  const service = require("../dist-electron/corosOfficialAssetService.js");
  const started = Date.now();
  let status = service.ensureCorosOfficialAssetLibrary({ firmwareType });
  while (status.state === "building") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = service.getCorosOfficialAssetLibraryStatus({ firmwareType });
    process.stdout.write(`\r${status.facesDone}/${status.facesTotal} faces, ${status.assetCount} assets`);
  }
  console.log(`\n${status.state} in ${((Date.now() - started) / 1000).toFixed(1)}s${status.message ? `: ${status.message}` : ""}`);
  if (status.state !== "ready") throw new Error(status.message ?? "library not ready");

  console.log(`source: ${JSON.parse(require("node:fs").readFileSync(path.join(userData, "official-asset-library", firmwareType.replace(/[^A-Za-z0-9]+/g, "-"), "library.json"), "utf8")).source ?? "local"}`);
  const fonts = await service.listCorosOfficialAssets({ firmwareType, category: "fonts", role: "time", pageSize: 3 });
  console.log(`fonts/time: ${fonts.total} sets; categories: ${fonts.categories.map((c) => `${c.id}=${c.count}`).join(" ")}`);
  console.log(`roles: ${fonts.roles.map((r) => `${r.id}=${r.count}`).join(" ")}`);
  const first = fonts.assets[0];
  if (!first) throw new Error("no time fonts");
  console.log(`first: ${first.id} ${first.width}x${first.height} x${first.frames} from ${first.faces.join(", ")} strip=${first.strip.dataUrl.length} chars`);
  const frames = await service.readCorosOfficialAssetFrames({ firmwareType, id: first.id });
  console.log(`frames: ${frames.frames.length}, label "${frames.label}"`);
  const battery = await service.listCorosOfficialAssets({ firmwareType, category: "battery", frames: "multi", pageSize: 1 });
  console.log(`battery multi-frame sets: ${battery.total}`);
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
