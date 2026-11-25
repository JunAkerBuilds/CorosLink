// `npm run binaries:prepare`: puts the pinned yt-dlp and ffmpeg in bin/<platform>-<arch>, where the app finds them
// (desktop/main/media/tools.ts). Each file is checked against its SHA-256 in scripts/binaries.lock.json before it's
// kept, and a file that's already there and matches isn't fetched again. A mismatch stops with an error.
//
//   node scripts/prepare-binaries.mjs                       this computer's platform
//   node scripts/prepare-binaries.mjs --platform=win32 --arch=x64
//   node scripts/prepare-binaries.mjs --from=<folder>       copy from a folder instead of downloading (still checked)
//
// yt-dlp comes from its GitHub release, ffmpeg from ffmpeg-static's (a static GPL build). The binaries aren't
// committed: bin/ is ignored, except its README.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const LOCK = "scripts/binaries.lock.json";
const pins = JSON.parse(await readFile(path.join(root, LOCK), "utf8"));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--(platform|arch|from)=(.+)$/.exec(a);
  if (!m) throw new Error(`Unknown argument ${a}`);
  return [m[1], m[2]];
}));
const platform = args.platform ?? process.platform;
const arch = args.arch ?? process.arch;
const key = `${platform}-${arch}`;
const out = path.join(root, "bin", key);
const exe = (name) => (platform === "win32" ? `${name}.exe` : name);

/** yt-dlp's release asset for a platform. */
function ytDlpAsset() {
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "win32") return arch === "arm64" ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
  if (platform === "linux") return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  throw new Error(`No yt-dlp for ${key}.`);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function pinned(group, name) {
  const hash = pins[group]?.sha256?.[name];
  if (!hash) throw new Error(`${LOCK} pins no ${group} for ${name}. Run npm run binaries:pin after adding it.`);
  return hash;
}

async function download(url) {
  const answer = await fetch(url, { redirect: "follow", headers: { "User-Agent": "clink-desktop-build" } });
  if (!answer.ok) throw new Error(`Couldn't download ${url}: ${answer.status}`);
  return Buffer.from(await answer.arrayBuffer());
}

/** Puts one verified file at bin/<key>/<file>, from --from or the URL, unless it's already there. */
async function prepare({ label, file, expected, url }) {
  const dest = path.join(out, file);
  if (existsSync(dest) && sha256(await readFile(dest)) === expected) {
    console.log(`${label}: already here and verified`);
    return;
  }
  const local = args.from ? path.join(args.from, file) : null;
  const bytes = local && existsSync(local) ? await readFile(local) : await download(url);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${label} failed its SHA-256 check.\n  expected ${expected}\n  got      ${actual}\nNot keeping it. If the release changed on purpose, re-pin with npm run binaries:pin and review the diff.`);
  }
  await mkdir(out, { recursive: true });
  const temp = `${dest}.tmp`;
  await writeFile(temp, bytes);
  await chmod(temp, 0o755);
  await rename(temp, dest).catch(async (error) => { await rm(temp, { force: true }); throw error; });
  console.log(`${label}: ${local && existsSync(local) ? `copied from ${local}` : "downloaded"}, verified`);
}

const asset = ytDlpAsset();
await prepare({
  label: `yt-dlp ${pins.ytDlp.version} (${asset})`,
  file: exe("yt-dlp"),
  expected: pinned("ytDlp", asset),
  url: `https://github.com/yt-dlp/yt-dlp/releases/download/${pins.ytDlp.version}/${asset}`,
});
await prepare({
  label: `ffmpeg ${pins.ffmpeg.release} (${key})`,
  file: exe("ffmpeg"),
  expected: pinned("ffmpeg", key),
  // The uncompressed asset: its digest is the executable's.
  url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${pins.ffmpeg.release}/ffmpeg-${key}`,
});
console.log(`Binaries ready in ${path.relative(root, out)}`);
