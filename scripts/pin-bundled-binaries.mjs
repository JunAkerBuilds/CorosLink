// Refreshes the SHA-256 pins that scripts/prepare-binaries.mjs checks every
// download against. Hashes come from the digests GitHub computes for each
// release asset, so re-pinning needs no local downloads. Review the diff: a
// pin only proves the asset is the one you looked at when you ran this.
//
//   npm run binaries:pin                          re-read digests for the current versions
//   npm run binaries:pin -- --yt-dlp=latest       bump yt-dlp (or --yt-dlp=2026.09.01)
//   npm run binaries:pin -- --python-release=20260101 --python-version=3.11.14
//   npm run binaries:pin -- --ytmusicapi=1.12.1   re-resolve the Python package lock
//
// ffmpeg follows the ffmpeg-static release installed in node_modules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const pinsPath = path.join(repoRoot, "scripts", "bundled-binaries.lock.json");
const requirementsPath = path.join(repoRoot, "scripts", "bundled-python-requirements.txt");
// Keep in sync with the pip flags in scripts/prepare-binaries.mjs.
const PIP_TARGET_ARGS = [
  "--only-binary=:all:",
  "--implementation",
  "py",
  "--abi",
  "none",
  "--platform",
  "any",
  "--python-version",
  "310"
];

const options = parseArgs(process.argv.slice(2));
const pins = JSON.parse(fs.readFileSync(pinsPath, "utf8"));

const ytDlpVersion =
  options["yt-dlp"] === "latest"
    ? (await githubJson("repos/yt-dlp/yt-dlp/releases/latest")).tag_name
    : options["yt-dlp"] ?? pins.ytDlp.version;
pins.ytDlp = {
  version: ytDlpVersion,
  sha256: await releaseDigests("yt-dlp/yt-dlp", ytDlpVersion, Object.keys(pins.ytDlp.sha256), (asset) => asset)
};

const ffmpegRelease = require("ffmpeg-static/package.json")["ffmpeg-static"]["binary-release-tag"];
pins.ffmpeg = {
  release: ffmpegRelease,
  // The uncompressed asset's digest matches the executable that both the
  // ffmpeg-static install script and prepare-binaries end up with.
  sha256: await releaseDigests(
    "eugeneware/ffmpeg-static",
    ffmpegRelease,
    Object.keys(pins.ffmpeg.sha256),
    (target) => `ffmpeg-${target}`
  )
};

const pythonVersion = options["python-version"] ?? pins.python.version;
const pythonRelease = options["python-release"] ?? pins.python.release;
pins.python = {
  version: pythonVersion,
  release: pythonRelease,
  sha256: await releaseDigests(
    "astral-sh/python-build-standalone",
    pythonRelease,
    Object.keys(pins.python.sha256),
    (triple) => `cpython-${pythonVersion}+${pythonRelease}-${triple}-install_only.tar.gz`
  )
};

fs.writeFileSync(pinsPath, `${JSON.stringify(pins, null, 2)}\n`);
console.log(
  `Pinned yt-dlp ${ytDlpVersion}, ffmpeg ${ffmpegRelease}, CPython ${pythonVersion}+${pythonRelease} in ${path.relative(repoRoot, pinsPath)}`
);

if (options.ytmusicapi) {
  await pinPythonPackages(options.ytmusicapi);
}

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    const match = arg.match(/^--(yt-dlp|python-release|python-version|ytmusicapi)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown argument ${arg}`);
    }
    parsed[match[1]] = match[2].trim();
  }
  return parsed;
}

async function githubJson(endpoint) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "coroslink",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com/${endpoint}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${endpoint}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function releaseDigests(repo, tag, keys, assetNameFor) {
  const release = await githubJson(`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  const digests = {};

  for (const key of keys) {
    const name = assetNameFor(key);
    const asset = release.assets.find((candidate) => candidate.name === name);
    if (!asset) {
      throw new Error(`${repo} ${tag} has no asset named ${name}`);
    }
    if (!asset.digest?.startsWith("sha256:")) {
      throw new Error(`${repo} ${tag} ${name} has no SHA-256 digest from GitHub`);
    }
    digests[key] = asset.digest.slice("sha256:".length);
  }

  return digests;
}

async function pinPythonPackages(ytmusicapiVersion) {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-pip-"));

  try {
    await execFileAsync(
      await findPython(),
      [
        "-m",
        "pip",
        "download",
        "--disable-pip-version-check",
        "--no-cache-dir",
        ...PIP_TARGET_ARGS,
        "--dest",
        downloadDir,
        `ytmusicapi==${ytmusicapiVersion}`
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const wheels = fs
      .readdirSync(downloadDir)
      .filter((file) => file.endsWith(".whl"))
      .map((file) => {
        const [distribution, version] = file.split("-");
        return {
          name: distribution.toLowerCase().replace(/[_.]+/g, "-"),
          version,
          sha256: createHash("sha256")
            .update(fs.readFileSync(path.join(downloadDir, file)))
            .digest("hex")
        };
      })
      // ytmusicapi first, then its dependencies alphabetically.
      .sort((a, b) =>
        a.name === "ytmusicapi" ? -1 : b.name === "ytmusicapi" ? 1 : a.name.localeCompare(b.name)
      );

    const header = fs
      .readFileSync(requirementsPath, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("#"));
    const entries = wheels.map(
      ({ name, version, sha256 }) => `${name}==${version} \\\n    --hash=sha256:${sha256}`
    );
    fs.writeFileSync(requirementsPath, `${[...header, ...entries].join("\n")}\n`);
    console.log(
      `Pinned ${wheels.map(({ name, version }) => `${name} ${version}`).join(", ")} in ${path.relative(repoRoot, requirementsPath)}`
    );
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

async function findPython() {
  for (const command of ["python3", "python"]) {
    try {
      await execFileAsync(command, ["--version"], { timeout: 5000 });
      return command;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("Python with pip is required to pin the ytmusicapi packages.");
}
