import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const gunzipAsync = promisify(gunzip);
const repoRoot = path.resolve(import.meta.dirname, "..");
const userAgent = "coros-desktop-app";
const PINNED_YT_DLP_VERSION = "2026.06.09";

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
