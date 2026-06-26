import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const lockfilePath = path.join(repoRoot, "package-lock.json");

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {
    fromTag: process.env.GITHUB_REF_NAME ?? process.env.RELEASE_TAG ?? "",
    sync: false,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sync") {
      args.sync = true;
      continue;
    }
    if (arg === "--check") {
      args.check = true;
      continue;
    }
    if (arg === "--from-tag") {
      args.fromTag = argv[index + 1] ?? "";
      index += 1;
    }
  }

  return args;
}

function normalizeTag(tag) {
  return tag.replace(/^v/i, "");
}

function resolveReleaseVersion(fromTag) {
  if (!fromTag) {
    return null;
  }

  if (!/^v?\d+\.\d+\.\d+/i.test(fromTag)) {
    return null;
  }

  const version = normalizeTag(fromTag);
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Release tag "${fromTag}" is not a valid semver version.`);
  }

  return version;
}

function syncVersion(version) {
  const packageJson = readJson(packageJsonPath);
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson);

  if (fs.existsSync(lockfilePath)) {
    const lockfile = readJson(lockfilePath);
    lockfile.version = version;
    if (lockfile.packages?.[""]) {
      lockfile.packages[""].version = version;
    }
    writeJson(lockfilePath, lockfile);
  }

  console.log(`Synced release version to ${version}.`);
}

export function syncReleaseVersion(options = {}) {
  const args = {
    ...parseArgs([]),
    ...options,
  };
  const releaseVersion = resolveReleaseVersion(args.fromTag);
  const packageJson = readJson(packageJsonPath);
  const currentVersion = packageJson.version;

  if (!releaseVersion) {
    console.log(
      `No release tag provided; keeping package.json version ${currentVersion}.`
    );
    return currentVersion;
  }

  if (args.check && currentVersion !== releaseVersion) {
    throw new Error(
      `Version mismatch: package.json is ${currentVersion} but release tag is v${releaseVersion}. ` +
        `Run "npm run release:prepare -- v${releaseVersion}" before tagging.`
    );
  }

  if (args.sync || currentVersion !== releaseVersion) {
    syncVersion(releaseVersion);
    return releaseVersion;
  }

  console.log(`Release version already set to ${currentVersion}.`);
  return currentVersion;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    syncReleaseVersion(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
