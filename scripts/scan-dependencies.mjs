// Checks everything CorosLink ships against the OSV vulnerability database and
// exits non-zero on any finding:
//   - package-lock.json, dev dependencies included: Electron and ffmpeg-static
//     are devDependencies but end up inside the app
//   - the vendored Python packages (scripts/bundled-python-requirements.txt)
//   - the bundled executables, through a CycloneDX SBOM generated from
//     scripts/bundled-binaries.lock.json. yt-dlp maps onto its PyPI advisories;
//     OSV has no feed for ffmpeg or CPython builds, so it lists those as
//     unscannable and they still need watching by hand.
//
// Needs osv-scanner on PATH (brew install osv-scanner). CI installs a pinned build.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pins = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "scripts", "bundled-binaries.lock.json"), "utf8")
);
const ffmpegVersion = pins.ffmpeg.release.replace(/^b/, "");

const sbomDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-sbom-"));
// OSV-Scanner only recognises CycloneDX files by the .cdx.json suffix.
const sbomPath = path.join(sbomDir, "bundled-binaries.cdx.json");
fs.writeFileSync(
  sbomPath,
  JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    components: [
      {
        type: "application",
        name: "yt-dlp",
        version: pins.ytDlp.version,
        purl: `pkg:pypi/yt-dlp@${pins.ytDlp.version}`
      },
      {
        type: "application",
        name: "ffmpeg",
        version: ffmpegVersion,
        purl: `pkg:generic/ffmpeg@${ffmpegVersion}`
      },
      {
        type: "application",
        name: "cpython",
        version: pins.python.version,
        purl: `pkg:generic/cpython@${pins.python.version}`
      }
    ]
  })
);

try {
  const result = spawnSync(
    "osv-scanner",
    [
      "scan",
      "source",
      "--lockfile=package-lock.json",
      "--lockfile=requirements.txt:scripts/bundled-python-requirements.txt",
      `--lockfile=${sbomPath}`
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(sbomDir, { recursive: true, force: true });
}
