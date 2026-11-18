import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Keeps auto-update from installing a build the Mac can't open.
 *
 * Each Electron major sets its own LSMinimumSystemVersion (Electron 44 dropped
 * macOS 12), and electron-builder copies it into the app but not into
 * latest-mac.yml. electron-updater skips an update whose minimumSystemVersion
 * is above os.release(), which on a Mac is the Darwin kernel version, not the
 * macOS version (macOS 13 is Darwin 22). So the yml gets the Darwin number.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronInfoPlist = path.join(
  repoRoot,
  "node_modules/electron/dist/Electron.app/Contents/Info.plist"
);

/** Darwin kernel version for a macOS version: macOS 11+ is Darwin major + 9. */
export function darwinVersionForMacOS(macosVersion) {
  const major = Number.parseInt(String(macosVersion).split(".")[0] ?? "", 10);
  if (!Number.isInteger(major) || major < 11) {
    throw new Error(`Unsupported minimum macOS version: ${macosVersion}`);
  }
  return `${major + 9}.0.0`;
}

/** The minimum macOS the installed Electron runs on, from its own Info.plist. */
export function electronMinimumMacOS(infoPlist = electronInfoPlist) {
  const xml = fs.existsSync(infoPlist) ? fs.readFileSync(infoPlist, "utf8") : "";
  const match = xml.match(/<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) throw new Error(`No LSMinimumSystemVersion in ${infoPlist}`);
  return match[1].trim();
}

/** Sets minimumSystemVersion in latest-mac.yml, replacing any earlier value. */
export function stampMacUpdateMinimum(metadataPath, darwinVersion) {
  const contents = fs.readFileSync(metadataPath, "utf8");
  const line = `minimumSystemVersion: ${darwinVersion}`;
  const next = /^minimumSystemVersion:.*$/m.test(contents)
    ? contents.replace(/^minimumSystemVersion:.*$/m, line)
    : `${contents.replace(/\n*$/, "\n")}${line}\n`;
  fs.writeFileSync(metadataPath, next);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const metadataPath = path.join(repoRoot, "release", "latest-mac.yml");
    const macos = electronMinimumMacOS();
    const darwin = darwinVersionForMacOS(macos);
    stampMacUpdateMinimum(metadataPath, darwin);
    console.log(`latest-mac.yml: minimumSystemVersion ${darwin} (macOS ${macos}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
