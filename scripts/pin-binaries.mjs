// `npm run binaries:pin`: rewrites scripts/binaries.lock.json from the SHA-256 digests GitHub records for each release
// asset, so nothing is downloaded. Review the diff before committing: a pin only proves the file is the one that was on
// the release when this ran.
//
//   npm run binaries:pin                              re-read the digests for the pinned versions
//   npm run binaries:pin -- --yt-dlp=latest           move yt-dlp to its latest release (or --yt-dlp=2026.09.01)
//   npm run binaries:pin -- --ffmpeg=b6.1.1           move ffmpeg to another ffmpeg-static release
//
// GITHUB_TOKEN, when set, is sent to raise GitHub's rate limit.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const lockPath = path.join(root, "scripts", "binaries.lock.json");
const pins = JSON.parse(await readFile(lockPath, "utf8"));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--(yt-dlp|ffmpeg)=(.+)$/.exec(a);
  if (!m) throw new Error(`Unknown argument ${a}`);
  return [m[1], m[2].trim()];
}));

async function github(endpoint) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "clink-desktop-build", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN?.trim()) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  const answer = await fetch(`https://api.github.com/${endpoint}`, { headers });
  if (!answer.ok) throw new Error(`GitHub ${endpoint}: ${answer.status}`);
  return answer.json();
}

/** The digest of each named asset of a release, keyed as the lock file keys them. */
async function digests(repo, tag, keys, assetName) {
  const release = await github(`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  const found = {};
  for (const key of keys) {
    const asset = release.assets.find((a) => a.name === assetName(key));
    if (!asset) throw new Error(`${repo} ${tag} has no ${assetName(key)}.`);
    if (!asset.digest?.startsWith("sha256:")) throw new Error(`${repo} ${tag} ${asset.name} has no SHA-256 digest.`);
    found[key] = asset.digest.slice("sha256:".length);
  }
  return found;
}

const ytDlp = args["yt-dlp"] === "latest" ? (await github("repos/yt-dlp/yt-dlp/releases/latest")).tag_name : args["yt-dlp"] ?? pins.ytDlp.version;
pins.ytDlp = { version: ytDlp, sha256: await digests("yt-dlp/yt-dlp", ytDlp, Object.keys(pins.ytDlp.sha256), (k) => k) };

const ffmpeg = args.ffmpeg ?? pins.ffmpeg.release;
pins.ffmpeg = { release: ffmpeg, sha256: await digests("eugeneware/ffmpeg-static", ffmpeg, Object.keys(pins.ffmpeg.sha256), (k) => `ffmpeg-${k}`) };

await writeFile(lockPath, `${JSON.stringify(pins, null, 2)}\n`);
console.log(`Pinned yt-dlp ${ytDlp} and ffmpeg ${ffmpeg} in ${path.relative(root, lockPath)}`);
