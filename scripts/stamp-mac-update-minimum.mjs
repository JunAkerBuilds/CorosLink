import { execFileSync } from "node:child_process";
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
 *
 * The minimum is read from the apps electron-builder just built: Electron 45
 * no longer downloads node_modules/electron/dist at install, so a clean CI
 * runner has no other copy of Electron's Info.plist. Run this after every
 * macOS build that writes latest-mac.yml (electron-builder's
 * afterAllArtifactBuild hook runs before the yml exists).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultReleaseDir = path.join(repoRoot, "release");

/**
 * Darwin release of each macOS version Electron has used as its floor. Apple
 * jumped from macOS 15 to 26 while Darwin went from 24 to 25, and a point
 * release like 13.3 is Darwin 22.4, so an unknown floor fails instead of
 * being guessed.
 */
const DARWIN_FOR_MACOS = {
  "11.0": "20.0.0",
  "12.0": "21.0.0",
  "13.0": "22.0.0",
  "14.0": "23.0.0",
  "15.0": "24.0.0",
  "26.0": "25.0.0"
};

export function darwinVersionForMacOS(macosVersion) {
  const parts = String(macosVersion).trim().split(".");
  const key = `${parts[0]}.${parts[1] ?? "0"}`;
  const darwin = parts.length <= 3 && (parts[2] ?? "0") === "0" ? DARWIN_FOR_MACOS[key] : undefined;
  if (!darwin) {
    throw new Error(`No Darwin version known for minimum macOS ${macosVersion}; add it to DARWIN_FOR_MACOS.`);
  }
  return darwin;
}

/** LSMinimumSystemVersion from an Info.plist, XML or binary. */
export function plistMinimumMacOS(infoPlist) {
  let xml = fs.readFileSync(infoPlist, "utf8");
  if (!xml.startsWith("<?xml") && process.platform === "darwin") {
    xml = execFileSync("plutil", ["-convert", "xml1", "-o", "-", infoPlist], { encoding: "utf8" });
  }
  const match = xml.match(/<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) throw new Error(`No LSMinimumSystemVersion in ${infoPlist}`);
  return match[1].trim();
}

/** The minimum macOS shared by every app in release/mac* (one per architecture). */
export function builtAppsMinimumMacOS(releaseDir = defaultReleaseDir) {
  const plists = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^mac(-|$)/.test(entry.name))
      .flatMap((entry) => fs.readdirSync(path.join(releaseDir, entry.name))
        .filter((name) => name.endsWith(".app"))
        .map((name) => path.join(releaseDir, entry.name, name, "Contents", "Info.plist")))
      .filter((plist) => fs.existsSync(plist))
    : [];
  if (plists.length === 0) throw new Error(`No built macOS app in ${releaseDir}/mac*`);
  const minimums = new Set(plists.map(plistMinimumMacOS));
  if (minimums.size !== 1) {
    throw new Error(`The built macOS apps disagree on their minimum macOS: ${[...minimums].join(", ")}`);
  }
  return [...minimums][0];
}

/** Sets minimumSystemVersion in latest-mac.yml, replacing every earlier value. */
export function stampMacUpdateMinimum(metadataPath, darwinVersion) {
  const contents = fs.readFileSync(metadataPath, "utf8");
  const withoutOld = contents.replace(/^minimumSystemVersion:.*\n?/gm, "");
  fs.writeFileSync(metadataPath, `${withoutOld.replace(/\n*$/, "\n")}minimumSystemVersion: ${darwinVersion}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // latest-mac.yml for a release, clink-mac.yml for a C-LINK beta (its version's prerelease id names the file).
    const feeds = fs.existsSync(defaultReleaseDir) ? fs.readdirSync(defaultReleaseDir).filter((name) => /^[a-z]+-mac\.yml$/.test(name)) : [];
    // `npm run dist` builds whatever platform it runs on; only a Mac build has a feed to stamp.
    if (feeds.length === 0) {
      if (process.argv.includes("--if-present")) process.exit(0);
      throw new Error(`No <channel>-mac.yml in ${defaultReleaseDir}`);
    }
    const macos = builtAppsMinimumMacOS();
    const darwin = darwinVersionForMacOS(macos);
    for (const feed of feeds) {
      stampMacUpdateMinimum(path.join(defaultReleaseDir, feed), darwin);
      console.log(`${feed}: minimumSystemVersion ${darwin} (macOS ${macos}).`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
