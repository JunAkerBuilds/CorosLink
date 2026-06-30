import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultReleaseDir = path.join(repoRoot, "release");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const defaultExpectedVersion = packageJson.version;

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
    // AppImage blockmaps are embedded in the file, not written as *.AppImage.blockmap.
    blockmapPatterns: []
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

function listReleaseFiles(releaseDir) {
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

function cleanYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readYamlField(contents, field) {
  const match = contents.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return match ? cleanYamlScalar(match[1]) : undefined;
}

function readFirstFileUrl(contents) {
  const filesIndex = contents.search(/^files:\s*$/m);
  if (filesIndex === -1) {
    return undefined;
  }

  const filesBlock = contents.slice(filesIndex);
  const inlineMatch = filesBlock.match(/^\s*-\s+url:\s*(.+)$/m);
  if (inlineMatch) {
    return cleanYamlScalar(inlineMatch[1]);
  }

  const nestedMatch = filesBlock.match(/^\s*url:\s*(.+)$/m);
  return nestedMatch ? cleanYamlScalar(nestedMatch[1]) : undefined;
}

function verifyWindowsMetadataReferences(metadataFile, contents, files, errors) {
  const metadataPath = readYamlField(contents, "path");
  const firstFileUrl = readFirstFileUrl(contents);

  if (!metadataPath) {
    errors.push(`${metadataFile} missing path`);
  }

  if (!firstFileUrl) {
    errors.push(`${metadataFile} missing files[0].url`);
  }

  if (metadataPath && firstFileUrl && metadataPath !== firstFileUrl) {
    errors.push(
      `${metadataFile} path ${metadataPath} does not match files[0].url ${firstFileUrl}`
    );
  }

  const referencedInstaller = metadataPath ?? firstFileUrl;
  if (!referencedInstaller) {
    return;
  }

  if (!/\.exe$/i.test(referencedInstaller)) {
    errors.push(`${metadataFile} references non-exe installer ${referencedInstaller}`);
  }

  if (!files.includes(referencedInstaller)) {
    errors.push(`${metadataFile} references missing installer ${referencedInstaller}`);
  }

  const blockmap = `${referencedInstaller}.blockmap`;
  if (!files.includes(blockmap)) {
    errors.push(`${metadataFile} references missing blockmap ${blockmap}`);
  }
}

function readMetadata(metadataPath) {
  const contents = fs.readFileSync(metadataPath, "utf8");
  const match = readYamlField(contents, "version");
  if (!match) {
    throw new Error(`Could not read version from ${path.basename(metadataPath)}`);
  }
  return {
    contents,
    version: match
  };
}

export function verifyPlatform(platform, options = {}) {
  const check = PLATFORM_CHECKS[platform];
  if (!check) {
    throw new Error(
      `Unknown platform ${platform}. Expected one of: ${Object.keys(PLATFORM_CHECKS).join(", ")}`
    );
  }

  const releaseDir = options.releaseDir ?? defaultReleaseDir;
  const expectedVersion = options.expectedVersion ?? defaultExpectedVersion;
  const logger = options.logger ?? console.log;
  const files = listReleaseFiles(releaseDir);
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
    const metadata = readMetadata(metadataPath);
    const metadataVersion = metadata.version;
    if (metadataVersion !== expectedVersion) {
      errors.push(
        `${check.metadataFile} version ${metadataVersion} does not match package.json ${expectedVersion}`
      );
    }

    if (platform === "windows") {
      verifyWindowsMetadataReferences(
        check.metadataFile,
        metadata.contents,
        files,
        errors
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `${check.label} release artifacts failed verification:\n- ${errors.join("\n- ")}`
    );
  }

  logger(
    `${check.label} release artifacts verified for v${expectedVersion}.`
  );
  logger(`Found: ${files.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyPlatform(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
