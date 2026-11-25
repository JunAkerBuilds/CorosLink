// `npm run release:version -- v0.2.0`: the release workflow's first step. Sets package.json's version from the tag,
// so the build, the file names (CorosLink-<version>-<arch>.dmg) and latest-mac.yml all carry the tag's version.
//
// The version must be above CorosLink's last release (0.1.83): CorosLink installs only a newer version, and that's
// how existing CorosLink users get C-LINK. A beta (v0.2.0-clink.1) is a GitHub prerelease: only CorosLink installs
// that opted in to C-LINK, and C-LINK betas, see it.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COROSLINK_LAST = [0, 1, 83];
const root = path.resolve(import.meta.dirname, "..");
const tag = process.argv[2] ?? "";
// A beta is `-clink.N`: CorosLink installs that opted in follow electron-updater's "clink" channel (docs/releases.md).
const m = /^v(\d+)\.(\d+)\.(\d+)(-clink\.\d+)?$/.exec(tag);
if (!m) {
  console.error(`"${tag}" isn't a release tag like v0.2.0, or a beta like v0.2.0-clink.1.`);
  process.exit(1);
}
const parts = m.slice(1, 4).map(Number);
const newer = parts[0] - COROSLINK_LAST[0] || parts[1] - COROSLINK_LAST[1] || parts[2] - COROSLINK_LAST[2];
if (newer <= 0) {
  console.error(`${tag} isn't above CorosLink's last release ${COROSLINK_LAST.join(".")}, so no CorosLink would update to it.`);
  process.exit(1);
}
const file = path.join(root, "package.json");
const pkg = JSON.parse(await readFile(file, "utf8"));
pkg.version = tag.slice(1);
// A beta's update file is clink-mac.yml (electron-builder only names it after the version for alpha/beta), so a beta
// published by mistake as a normal release still reaches nobody but the "clink" channel.
if (m[4]) pkg.build.publish = { ...pkg.build.publish, channel: "clink" };
else if (pkg.build.publish) delete pkg.build.publish.channel;
await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json version ${pkg.version}${m[4] ? ' (beta, channel "clink")' : ""}.`);
