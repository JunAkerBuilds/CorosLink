import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyPlatform } from "./verify-release-artifacts.mjs";
import { builtAppsMinimumMacOS, darwinVersionForMacOS, stampMacUpdateMinimum } from "./stamp-mac-update-minimum.mjs";

assert.equal(darwinVersionForMacOS("13.0"), "22.0.0");
assert.equal(darwinVersionForMacOS("13"), "22.0.0");
assert.equal(darwinVersionForMacOS("12.0"), "21.0.0");
// macOS jumped from 15 to 26; Darwin went from 24 to 25.
assert.equal(darwinVersionForMacOS("15.0"), "24.0.0");
assert.equal(darwinVersionForMacOS("26.0"), "25.0.0");
// A point-release floor or an unknown version fails rather than being guessed.
assert.throws(() => darwinVersionForMacOS("13.3"), /No Darwin version known/);
assert.throws(() => darwinVersionForMacOS("27.0"), /No Darwin version known/);
assert.throws(() => darwinVersionForMacOS("10.15"), /No Darwin version known/);

const version = "1.2.3";
const logger = () => {};

function writeReleaseFile(releaseDir, name, contents = "") {
  fs.writeFileSync(path.join(releaseDir, name), contents);
}

function writeLatestYml(releaseDir, { pathName, fileUrl = pathName }) {
  writeReleaseFile(
    releaseDir,
    "latest.yml",
    [
      `version: ${version}`,
      "files:",
      `  - url: ${fileUrl}`,
      "    sha512: test-sha",
      "    size: 123",
      `path: ${pathName}`,
      "sha512: test-sha",
      "releaseDate: '2026-06-30T00:00:00.000Z'",
      ""
    ].join("\n")
  );
}

function withReleaseDir(callback) {
  const releaseDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "coroslink-release-test-")
  );

  try {
    callback(releaseDir);
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
}

withReleaseDir((releaseDir) => {
  const installer = `CorosLink-Setup-${version}.exe`;
  writeReleaseFile(releaseDir, installer);
  writeReleaseFile(releaseDir, `${installer}.blockmap`);
  writeLatestYml(releaseDir, { pathName: installer });

  verifyPlatform("windows", {
    releaseDir,
    expectedVersion: version,
    logger
  });
});

withReleaseDir((releaseDir) => {
  const publishedInstaller = `CorosLink.Setup.${version}.exe`;
  const metadataInstaller = `CorosLink-Setup-${version}.exe`;
  writeReleaseFile(releaseDir, publishedInstaller);
  writeReleaseFile(releaseDir, `${publishedInstaller}.blockmap`);
  writeLatestYml(releaseDir, { pathName: metadataInstaller });

  assert.throws(
    () =>
      verifyPlatform("windows", {
        releaseDir,
        expectedVersion: version,
        logger
      }),
    /references missing installer CorosLink-Setup-1\.2\.3\.exe/
  );
});

withReleaseDir((releaseDir) => {
  const pathInstaller = `CorosLink-Setup-${version}.exe`;
  const fileUrlInstaller = `CorosLink.Setup.${version}.exe`;
  writeReleaseFile(releaseDir, pathInstaller);
  writeReleaseFile(releaseDir, `${pathInstaller}.blockmap`);
  writeLatestYml(releaseDir, {
    pathName: pathInstaller,
    fileUrl: fileUrlInstaller
  });

  assert.throws(
    () =>
      verifyPlatform("windows", {
        releaseDir,
        expectedVersion: version,
        logger
      }),
    /path CorosLink-Setup-1\.2\.3\.exe does not match files\[0\]\.url CorosLink\.Setup\.1\.2\.3\.exe/
  );
});

withReleaseDir((releaseDir) => {
  const macVersion = "1.2.3";
  const files = [
    `CorosLink-${macVersion}-arm64.dmg`,
    `CorosLink-${macVersion}-x64.dmg`,
    `CorosLink-${macVersion}-arm64.zip`,
    `CorosLink-${macVersion}-x64.zip`
  ];

  for (const file of files) {
    writeReleaseFile(releaseDir, file);
    writeReleaseFile(releaseDir, `${file}.blockmap`);
  }

  const feed = (urls, extra = []) => writeReleaseFile(
    releaseDir,
    "latest-mac.yml",
    [
      `version: ${macVersion}`,
      "files:",
      ...urls.flatMap((url) => [`  - url: ${url}`, "    sha512: test-sha", "    size: 123"]),
      "releaseDate: '2026-06-30T00:00:00.000Z'",
      ...extra,
      ""
    ].join("\n")
  );
  const metadataPath = path.join(releaseDir, "latest-mac.yml");
  const verifyMac = (options = { expectedMacMinimum: "22.0.0" }) =>
    verifyPlatform("macos", { releaseDir, expectedVersion: macVersion, logger, ...options });
  const allFiles = files.map((file) => file);

  // DMGs alone: the Mac updater downloads the ZIP for its architecture.
  feed(files.filter((file) => file.endsWith(".dmg")), ["minimumSystemVersion: 22.0.0"]);
  assert.throws(() => verifyMac(), /lists no arm64 ZIP[\s\S]*lists no x64 ZIP/);
  feed(allFiles.filter((file) => !file.includes("x64.zip")), ["minimumSystemVersion: 22.0.0"]);
  assert.throws(() => verifyMac(), /lists no x64 ZIP/);

  // A yml without the minimum would let macOS 12 auto-update into Electron 45.
  feed(allFiles);
  assert.throws(() => verifyMac(), /minimumSystemVersion missing does not match the built apps' 22\.0\.0/);
  // Two keys: the updater's YAML parser rejects the whole feed.
  feed(allFiles, ["minimumSystemVersion: 22.0.0", "minimumSystemVersion: 21.0.0"]);
  assert.throws(() => verifyMac(), /2 minimumSystemVersion lines/);
  stampMacUpdateMinimum(metadataPath, "22.0.0");
  assert.equal(fs.readFileSync(metadataPath, "utf8").match(/^minimumSystemVersion:/gm)?.length, 1, "stamping leaves one line");
  verifyMac();

  // By default the floor comes from the built apps' own Info.plist.
  const writeApp = (dir, minimum) => {
    const contents = path.join(releaseDir, dir, "CorosLink.app", "Contents");
    fs.mkdirSync(contents, { recursive: true });
    fs.writeFileSync(path.join(contents, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n\t<key>LSMinimumSystemVersion</key>\n\t<string>${minimum}</string>\n</dict></plist>\n`);
  };
  assert.throws(() => verifyMac({}), /No built macOS app/);
  writeApp("mac-arm64", "13.0");
  writeApp("mac", "13.0");
  assert.equal(builtAppsMinimumMacOS(releaseDir), "13.0");
  verifyMac({});
  writeApp("mac", "14.0");
  assert.throws(() => builtAppsMinimumMacOS(releaseDir), /disagree on their minimum macOS: 13\.0, 14\.0|disagree on their minimum macOS: 14\.0, 13\.0/);
  assert.throws(() => verifyMac({}), /disagree/);
});

function writeLatestLinuxYml(releaseDir, urls) {
  writeReleaseFile(
    releaseDir,
    "latest-linux.yml",
    [
      `version: ${version}`,
      "files:",
      ...urls.flatMap((url) => [`  - url: ${url}`, "    sha512: test-sha", "    size: 123"]),
      `path: ${urls[0]}`,
      "sha512: test-sha",
      "releaseDate: '2026-06-30T00:00:00.000Z'",
      ""
    ].join("\n")
  );
}

withReleaseDir((releaseDir) => {
  const appImage = `CorosLink-${version}.AppImage`;
  const deb = `CorosLink-${version}.deb`;
  writeReleaseFile(releaseDir, appImage);
  writeReleaseFile(releaseDir, deb);
  writeLatestLinuxYml(releaseDir, [appImage, deb]);

  verifyPlatform("linux", { releaseDir, expectedVersion: version, logger });
});

withReleaseDir((releaseDir) => {
  const appImage = `CorosLink-${version}.AppImage`;
  writeReleaseFile(releaseDir, appImage);
  writeLatestLinuxYml(releaseDir, [appImage]);

  assert.throws(
    () => verifyPlatform("linux", { releaseDir, expectedVersion: version, logger }),
    /missing installer matching \/\\\.deb\$\/i/
  );
});

withReleaseDir((releaseDir) => {
  // A deb install downloads the deb, so latest-linux.yml has to name it.
  const appImage = `CorosLink-${version}.AppImage`;
  const deb = `CorosLink-${version}.deb`;
  writeReleaseFile(releaseDir, appImage);
  writeReleaseFile(releaseDir, deb);
  writeLatestLinuxYml(releaseDir, [appImage]);

  assert.throws(
    () => verifyPlatform("linux", { releaseDir, expectedVersion: version, logger }),
    /latest-linux\.yml does not list CorosLink-1\.2\.3\.deb/
  );
});

console.log("release artifact verifier tests passed");
