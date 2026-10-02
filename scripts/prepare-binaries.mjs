import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const repoRoot = path.resolve(import.meta.dirname, "..");
const userAgent = "coroslink";
const BUNDLED_PYTHON_VERSION = "310";
// Every download is checked against these SHA-256 pins before it lands in
// bin/, so a swapped release asset stops the build. Bump versions with
// `npm run binaries:pin`, which rewrites both files.
const PINS_FILE = "scripts/bundled-binaries.lock.json";
const PYTHON_REQUIREMENTS_FILE = "scripts/bundled-python-requirements.txt";
const pins = JSON.parse(fs.readFileSync(path.join(repoRoot, PINS_FILE), "utf8"));

const options = parseArgs(process.argv.slice(2));
const targetPlatform = options.platform ?? process.platform;
const targetArch = options.arch ?? process.arch;
const targetKey = `${targetPlatform}-${targetArch}`;
const outputDir = path.join(repoRoot, "bin", targetKey);

const ytDlpAsset = resolveYtDlpAsset(targetPlatform, targetArch);
const ytDlpOutput = targetPlatform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const ffmpegOutput = targetPlatform === "win32" ? "ffmpeg.exe" : "ffmpeg";

await fs.promises.mkdir(outputDir, { recursive: true });

await downloadYtDlp(path.join(outputDir, ytDlpOutput), ytDlpAsset);
await copyFfmpeg(path.join(outputDir, ffmpegOutput), targetPlatform, targetArch);
await installPythonRuntime(
  path.join(outputDir, "python-runtime"),
  targetPlatform,
  targetArch
);
await installPythonPackages(path.join(outputDir, "python"));

console.log(`Prepared bundled binaries in ${path.relative(repoRoot, outputDir)}`);

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
    if (arg.startsWith("--platform=")) {
      parsed.platform = arg.slice("--platform=".length);
    } else if (arg.startsWith("--arch=")) {
      parsed.arch = arg.slice("--arch=".length);
    }

    return parsed;
  }, {});
}

function resolveYtDlpAsset(platform, arch) {
  if (platform === "darwin") {
    return "yt-dlp_macos";
  }

  if (platform === "win32") {
    if (arch === "arm64") {
      return "yt-dlp_arm64.exe";
    }

    if (arch === "ia32" || arch === "x32") {
      return "yt-dlp_x86.exe";
    }

    return "yt-dlp.exe";
  }

  if (platform === "linux") {
    if (arch === "arm64") {
      return "yt-dlp_linux_aarch64";
    }

    return "yt-dlp_linux";
  }

  throw new Error(`Unsupported yt-dlp platform: ${platform}-${arch}`);
}

async function downloadYtDlp(destination, assetName) {
  const { version } = pins.ytDlp;
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${assetName}`;
  const label = `yt-dlp ${version} (${assetName})`;

  const binary = await downloadBuffer(url);
  verifySha256(binary, pinnedSha256("ytDlp", assetName, label), label);
  await writeFileAtomic(destination, binary);
  await fs.promises.chmod(destination, 0o755);
  console.log(`Downloaded and verified ${label}`);
}

async function copyFfmpeg(destination, platform, arch) {
  const { release } = pins.ffmpeg;
  const packageRelease =
    require("ffmpeg-static/package.json")["ffmpeg-static"]["binary-release-tag"];
  if (packageRelease !== release) {
    throw new Error(
      `ffmpeg-static now ships ${packageRelease} but ${PINS_FILE} pins ${release}. Run npm run binaries:pin to re-pin ffmpeg.`
    );
  }

  const label = `ffmpeg ${release} (${platform}-${arch})`;
  const expectedSha256 = pinnedSha256("ffmpeg", `${platform}-${arch}`, label);
  let binary;
  let source;

  if (platform !== process.platform || arch !== process.arch) {
    binary = await downloadFfmpegStatic(release, platform, arch);
    source = "downloaded";
  } else {
    const ffmpegPath = require("ffmpeg-static");
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      throw new Error("ffmpeg-static did not provide an executable path.");
    }

    binary = await fs.promises.readFile(ffmpegPath);
    source = `copied from ${path.relative(repoRoot, ffmpegPath)}`;
  }

  verifySha256(binary, expectedSha256, label);
  await writeFileAtomic(destination, binary);
  await fs.promises.chmod(destination, 0o755);
  console.log(`Verified ${label}, ${source}`);
}

async function installPythonPackages(destination) {
  const python = await findPythonCommand();
  if (!python) {
    throw new Error(
      "Python 3.10+ is required to vendor ytmusicapi. Install Python and rerun npm run binaries:prepare."
    );
  }

  await fs.promises.rm(destination, { recursive: true, force: true });
  await fs.promises.mkdir(destination, { recursive: true });

  const args = [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--upgrade",
    "--ignore-installed",
    "--no-compile",
    "--target",
    destination,
    "--only-binary=:all:",
    "--implementation",
    "py",
    "--abi",
    "none",
    "--platform",
    "any",
    "--python-version",
    BUNDLED_PYTHON_VERSION,
    "--require-hashes",
    "--requirement",
    path.join(repoRoot, PYTHON_REQUIREMENTS_FILE)
  ];

  try {
    const { stdout } = await execFileAsync(python, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PIP_ROOT_USER_ACTION: "ignore"
      },
      maxBuffer: 10 * 1024 * 1024
    });
    const summary = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3)
      .join(" ");
    console.log(
      `Vendored hash-pinned ytmusicapi packages in ${path.relative(repoRoot, destination)}${summary ? ` (${summary})` : ""}`
    );
  } catch (error) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    const detail = stderr ? `\n${stderr}` : "";
    throw new Error(`Could not vendor ytmusicapi with pip.${detail}`);
  }
}

async function installPythonRuntime(destination, platform, arch) {
  // Self-contained CPython shipped with the app so users don't need Python
  // installed. Sourced from astral-sh/python-build-standalone (relocatable,
  // "install_only" flavor).
  const triple = resolvePythonStandaloneTriple(platform, arch);
  const { version, release } = pins.python;
  const assetName = `cpython-${version}+${release}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${assetName}`;

  const archive = await downloadBuffer(url);
  verifySha256(archive, pinnedSha256("python", triple, assetName), assetName);
  const parentDir = path.dirname(destination);
  const extractRoot = path.join(parentDir, ".python-runtime-tmp");

  await fs.promises.rm(destination, { recursive: true, force: true });
  await fs.promises.rm(extractRoot, { recursive: true, force: true });
  await fs.promises.mkdir(extractRoot, { recursive: true });

  const archivePath = path.join(parentDir, ".python-runtime.tar.gz");
  await fs.promises.writeFile(archivePath, archive);

  try {
    // The archive extracts to a top-level "python/" directory. Use the system
    // tar (macOS/Linux, and bsdtar on Windows 10+) to preserve executable bits.
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractRoot]);
    await fs.promises.rename(path.join(extractRoot, "python"), destination);
  } finally {
    await fs.promises.rm(archivePath, { force: true });
    await fs.promises.rm(extractRoot, { recursive: true, force: true });
  }

  console.log(
    `Vendored verified CPython ${version} (${triple}) in ${path.relative(
      repoRoot,
      destination
    )}`
  );
}

function resolvePythonStandaloneTriple(platform, arch) {
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }

  if (platform === "win32") {
    return "x86_64-pc-windows-msvc";
  }

  if (platform === "linux") {
    return arch === "arm64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
  }

  throw new Error(`Unsupported Python runtime platform: ${platform}-${arch}`);
}

async function findPythonCommand() {
  for (const command of ["python3", "python"]) {
    try {
      const { stdout } = await execFileAsync(
        command,
        [
          "-c",
          "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        ],
        { timeout: 5000 }
      );
      const [major, minor] = stdout.trim().split(".").map(Number);
      if (major > 3 || (major === 3 && minor >= 10)) {
        return command;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

async function downloadFfmpegStatic(release, platform, arch) {
  const ffmpegMetadata = require("ffmpeg-static/package.json")["ffmpeg-static"];
  const baseUrl =
    process.env[ffmpegMetadata["binaries-url-env-var"]] ??
    "https://github.com/eugeneware/ffmpeg-static/releases/download";
  const url = `${baseUrl}/${release}/${ffmpegMetadata["executable-base-name"]}-${platform}-${arch}.gz`;

  // The pin covers the decompressed executable, which is also what the
  // ffmpeg-static install script leaves in node_modules.
  return gunzipAsync(await downloadBuffer(url));
}

function pinnedSha256(group, key, label) {
  const expected = pins[group]?.sha256?.[key];
  if (!expected) {
    throw new Error(
      `No SHA-256 pinned for ${label} in ${PINS_FILE}. Add "${key}" under ${group}.sha256 and run npm run binaries:pin to fill in its hash.`
    );
  }

  return expected;
}

function verifySha256(buffer, expected, label) {
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${label} failed SHA-256 verification.\n  expected ${expected}\n  received ${actual}\nRefusing to bundle it. If the upstream asset changed on purpose, re-pin with npm run binaries:pin.`
    );
  }
}

async function writeFileAtomic(destination, buffer) {
  const tempFile = `${destination}.tmp`;
  await fs.promises.writeFile(tempFile, buffer);
  await fs.promises.rename(tempFile, destination);
}

async function downloadBuffer(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": userAgent }
  });

  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url}: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
