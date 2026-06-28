import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(repoRoot, "release");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const expectedVersion = packageJson.version;

const PLATFORM_CHECKS = {
  macos: {
    label: "macOS",
    metadataFile: "latest-mac.yml",
    requiredPatterns: [/\.dmg$/i, /\.zip$/i],
    blockmapPatterns: [/\.dmg\.blockmap$/i, /\.zip\.blockmap$/i]
  },
  windows: {
    label: "Windows",
    metadataFile: "latest.yml",
    requiredPatterns: [/\.exe$/i],
    blockmapPatterns: [/\.exe\.blockmap$/i]
  },
  linux: {
    label: "Linux",
    metadataFile: "latest-linux.yml",
    requiredPatterns: [/\.AppImage$/i],
    blockmapPatterns: [/\.AppImage\.blockmap$/i]
  }
};

function parseArgs(argv) {
  const platform = argv[0]?.trim().toLowerCase();
  if (!platform || !PLATFORM_CHECKS[platform]) {
    throw new Error(
      `Usage: node scripts/verify-release-artifacts.mjs <macos|windows|linux>`
    );
  }
  return platform;
}

function listReleaseFiles() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release directory not found: ${releaseDir}`);
  }

  return fs.readdirSync(releaseDir).filter((entry) => {
    const fullPath = path.join(releaseDir, entry);
    return fs.statSync(fullPath).isFile();
  });
}

function matchesAny(name, patterns) {
  return patterns.some((pattern) => pattern.test(name));
}

function readMetadataVersion(metadataPath) {
  const contents = fs.readFileSync(metadataPath, "utf8");
  const match = contents.match(/^version:\s*(.+)$/m);
  if (!match) {
    throw new Error(`Could not read version from ${path.basename(metadataPath)}`);
  }
  return match[1].trim();
}

function verifyPlatform(platform) {
  const check = PLATFORM_CHECKS[platform];
  const files = listReleaseFiles();
  const errors = [];

  for (const pattern of check.requiredPatterns) {
    if (!files.some((file) => pattern.test(file))) {
      errors.push(`missing installer matching ${pattern}`);
    }
  }

  for (const pattern of check.blockmapPatterns) {
    if (!files.some((file) => pattern.test(file))) {
      errors.push(`missing blockmap matching ${pattern}`);
    }
  }

  const metadataPath = path.join(releaseDir, check.metadataFile);
  if (!fs.existsSync(metadataPath)) {
    errors.push(`missing ${check.metadataFile}`);
  } else {
    const metadataVersion = readMetadataVersion(metadataPath);
    if (metadataVersion !== expectedVersion) {
      errors.push(
        `${check.metadataFile} version ${metadataVersion} does not match package.json ${expectedVersion}`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `${check.label} release artifacts failed verification:\n- ${errors.join("\n- ")}`
    );
  }

  console.log(
    `${check.label} release artifacts verified for v${expectedVersion}.`
  );
  console.log(`Found: ${files.join(", ")}`);
}

try {
  verifyPlatform(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
