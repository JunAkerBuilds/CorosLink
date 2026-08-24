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
const PINNED_YT_DLP_VERSION = "2026.08.19";
const PINNED_YTMUSICAPI_VERSION = "1.12.1";
const BUNDLED_PYTHON_VERSION = "310";
// Self-contained CPython shipped with the app so users don't need Python
// installed. Sourced from astral-sh/python-build-standalone (relocatable,
// "install_only" flavor). Override the release tag with PYTHON_STANDALONE_TAG.
const BUNDLED_PYTHON_RUNTIME_VERSION = "3.11.13";
const PINNED_PYTHON_STANDALONE_TAG = "20250612";

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
  const version = await resolveYtDlpVersion();
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${assetName}`;

  await downloadFile(url, destination);
  await fs.promises.chmod(destination, 0o755);
  console.log(`Downloaded yt-dlp ${version} (${assetName})`);
}

async function resolveYtDlpVersion() {
  const requested = process.env.YT_DLP_VERSION?.trim();

  if (!requested || requested === PINNED_YT_DLP_VERSION) {
    return PINNED_YT_DLP_VERSION;
  }

  if (requested !== "latest") {
    return requested;
  }

  const releaseResponse = await fetch(
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
    { headers: githubApiHeaders() }
  );

  if (!releaseResponse.ok) {
    throw new Error(
      `Could not read yt-dlp release metadata: ${releaseResponse.status} ${releaseResponse.statusText}`
    );
  }

  const release = await releaseResponse.json();
  return release.tag_name;
}

function githubApiHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function copyFfmpeg(destination, platform, arch) {
  if (platform !== process.platform || arch !== process.arch) {
    await downloadFfmpegStatic(destination, platform, arch);
    return;
  }

  const ffmpegPath = require("ffmpeg-static");
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error("ffmpeg-static did not provide an executable path.");
  }

  await fs.promises.copyFile(ffmpegPath, destination);
  await fs.promises.chmod(destination, 0o755);
  console.log(`Copied ffmpeg-static binary from ${path.relative(repoRoot, ffmpegPath)}`);
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
    `ytmusicapi==${PINNED_YTMUSICAPI_VERSION}`
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
      `Vendored ytmusicapi ${PINNED_YTMUSICAPI_VERSION} in ${path.relative(repoRoot, destination)}${summary ? ` (${summary})` : ""}`
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
  const triple = resolvePythonStandaloneTriple(platform, arch);
  const tag = process.env.PYTHON_STANDALONE_TAG?.trim() || PINNED_PYTHON_STANDALONE_TAG;
  const assetName = `cpython-${BUNDLED_PYTHON_RUNTIME_VERSION}+${tag}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${assetName}`;

  const archive = await downloadBuffer(url);
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
    `Vendored CPython ${BUNDLED_PYTHON_RUNTIME_VERSION} (${triple}) in ${path.relative(
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

async function downloadFfmpegStatic(destination, platform, arch) {
  const packageMetadata = require("ffmpeg-static/package.json");
  const ffmpegMetadata = packageMetadata["ffmpeg-static"];
  const release =
    process.env[ffmpegMetadata["binary-release-tag-env-var"]] ??
    ffmpegMetadata["binary-release-tag"];
  const baseUrl =
    process.env[ffmpegMetadata["binaries-url-env-var"]] ??
    "https://github.com/eugeneware/ffmpeg-static/releases/download";
  const url = `${baseUrl}/${release}/${ffmpegMetadata["executable-base-name"]}-${platform}-${arch}.gz`;

  const compressed = await downloadBuffer(url);
  await fs.promises.writeFile(destination, await gunzipAsync(compressed));
  await fs.promises.chmod(destination, 0o755);
  console.log(`Downloaded ffmpeg-static ${release} (${platform}-${arch})`);
}

async function downloadFile(url, destination) {
  const buffer = await downloadBuffer(url);
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
