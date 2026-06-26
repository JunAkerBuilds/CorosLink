import { syncReleaseVersion } from "./sync-release-version.mjs";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: npm run release:prepare -- v0.1.3");
  process.exit(1);
}

const version = tag.replace(/^v/i, "");
syncReleaseVersion({ fromTag: tag, sync: true });

console.log(`Prepared ${version} in package.json and package-lock.json.`);
console.log(`Next: git commit -am "chore: release v${version}" && git tag ${tag} && git push origin main ${tag}`);
