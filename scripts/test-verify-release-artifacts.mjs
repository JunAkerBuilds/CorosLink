import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyPlatform } from "./verify-release-artifacts.mjs";

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

  writeReleaseFile(
    releaseDir,
    "latest-mac.yml",
    [
      `version: ${macVersion}`,
      "files:",
      `  - url: CorosLink-${macVersion}-arm64.dmg`,
      "    sha512: test-sha",
      "    size: 123",
      `  - url: CorosLink-${macVersion}-x64.dmg`,
      "    sha512: test-sha",
      "    size: 123",
      "releaseDate: '2026-06-30T00:00:00.000Z'",
      ""
    ].join("\n")
  );

  verifyPlatform("macos", {
    releaseDir,
    expectedVersion: macVersion,
    logger
  });
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
