#!/usr/bin/env electron
// Downloads every official COROS watch face for each supported firmware type
// using the signed-in mobile session of the local CorosLink install. Runs
// under Electron because the session is stored with safeStorage.
//
//   npm run build:electron
//   electron scripts/harvest-coros-official-assets.cjs [output-directory]
//
// Output: <out>/<firmware>/<Name>-<id>.bin, <out>/<firmware>/<Name>-<id>.png
// (catalog preview) and <out>/catalog.json describing every face. Re-running
// skips faces already on disk.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const electron = require("electron");
const { app } = electron;

const root = path.resolve(__dirname, "..");
const outputRoot = path.resolve(process.argv[2] ?? path.join(root, "output", "coros-official-faces"));
const userData = process.env.COROSLINK_USER_DATA
  ?? path.join(os.homedir(), "Library", "Application Support", "coroslink");
// safeStorage keys the keychain entry by app name; match the dev instance.
app.setName(process.env.COROSLINK_APP_NAME ?? "coroslink");
app.setPath("userData", userData);
app.setPath("downloads", outputRoot);

const UNSAFE_FILENAME = /[\x00-\x1f\x7f/\\:*?"<>|]/g;
function safeName(name) {
  return name.replace(UNSAFE_FILENAME, "").trim().slice(0, 60) || "COROS watchface";
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function main() {
  await app.whenReady();
  const { initializeDatabase } = require("../dist-electron/database.js");
  initializeDatabase(userData);
  const service = require("../dist-electron/corosWatchfaceService.js");
  const { WATCHFACE_TARGETS } = require("../dist-electron/watchfaceTargets.js");
  const { getWatchfaceDeviceProfile } = require("../dist-electron/watchModels.js");
  await fs.mkdir(outputRoot, { recursive: true });

  const catalogPath = path.join(outputRoot, "catalog.json");
  const previous = await fs.readFile(catalogPath, "utf8").then(JSON.parse).catch(() => ({ faces: [] }));
  const done = new Map(previous.faces.map((face) => [`${face.firmwareType}/${face.id}`, face]));
  const faces = [];
  const save = () => fs.writeFile(catalogPath, JSON.stringify({ harvestedAt: new Date().toISOString(), faces }, null, 2));

  for (const target of WATCHFACE_TARGETS) {
    const profile = getWatchfaceDeviceProfile(target.model);
    let themes;
    try {
      themes = await service.listCorosWatchfaceThemes({
        firmwareType: target.firmwareType, language: "en-US", maxWatchFaceVersion: 5,
        catalog: "official", snCode: "x", modelVersion: profile?.modelVersion ?? ""
      });
    } catch (error) {
      console.error(`${target.label}: catalog failed: ${error.message}`);
      continue;
    }
    console.log(`${target.label} (${target.firmwareType}): ${themes.length} official faces`);
    const directory = path.join(outputRoot, target.firmwareType.replace(/\s+/g, "-"));
    await fs.mkdir(directory, { recursive: true });

    for (const theme of themes) {
      const id = theme.id ?? "unknown";
      const existing = done.get(`${target.firmwareType}/${id}`);
      if (existing && await exists(path.join(outputRoot, existing.file))) {
        faces.push(existing);
        continue;
      }
      if (!theme.packageUrl) {
        console.warn(`  ${theme.name}: no package URL`);
        continue;
      }
      const base = path.join(directory, `${safeName(theme.name)}-${id}`);
      try {
        const download = await service.downloadCorosWatchfaceTheme({
          packageUrl: theme.packageUrl, name: theme.name, firmwareType: target.firmwareType
        });
        if (!download.savedPath) throw new Error(download.message);
        const extension = path.extname(download.savedPath);
        await fs.rename(download.savedPath, `${base}${extension}`);
        let preview;
        if (theme.previewImageUrl) {
          try {
            const response = await fetch(theme.previewImageUrl);
            if (response.ok) {
              const previewExt = /\.(png|jpe?g|webp)(\?|$)/i.exec(theme.previewImageUrl)?.[1]?.toLowerCase() ?? "png";
              preview = `${path.relative(outputRoot, base)}.${previewExt}`;
              await fs.writeFile(path.join(outputRoot, preview), Buffer.from(await response.arrayBuffer()));
            }
          } catch {
            // Previews are optional.
          }
        }
        const face = {
          id, name: theme.name, category: theme.category, firmwareType: target.firmwareType,
          model: target.model, modelLabel: target.label, display: target.display,
          watchFaceVersion: theme.watchFaceVersion, packageUrl: theme.packageUrl,
          previewImageUrl: theme.previewImageUrl,
          file: `${path.relative(outputRoot, base)}${extension}`, preview, sizeBytes: download.sizeBytes
        };
        faces.push(face);
        console.log(`  ${theme.name} → ${face.file} (${download.sizeBytes} bytes)`);
      } catch (error) {
        console.error(`  ${theme.name}: ${error.message}`);
      }
      await save();
    }
  }
  await save();
  await fs.rm(path.join(outputRoot, "COROS watchfaces"), { recursive: true, force: true });
  console.log(`Saved ${faces.length} faces to ${outputRoot}`);
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
