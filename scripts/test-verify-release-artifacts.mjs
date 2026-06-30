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

console.log("release artifact verifier tests passed");
