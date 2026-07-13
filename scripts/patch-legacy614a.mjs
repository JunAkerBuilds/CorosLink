import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const [, , inputArg, outputArg, xArg, yArg, ...optionArgs] = process.argv;
let profileName = "multidata";
let preserveFileCrc = false;
const rectArgs = [];
for (let index = 0; index < optionArgs.length; index += 1) {
  const value = optionArgs[index];
  if (value === "--profile") {
    profileName = optionArgs[++index];
  } else if (value === "--preserve-file-crc") {
    preserveFileCrc = true;
  } else {
    rectArgs.push(value);
  }
}
if (
  !inputArg ||
  !outputArg ||
  xArg === undefined ||
  yArg === undefined ||
  ![0, 4].includes(rectArgs.length) ||
  !["multidata", "block3"].includes(profileName)
) {
  console.error(
    "Usage: npm run legacy614a:patch -- <reference.bin> <output.bin> <weather-x> <weather-y> [temp-x0 temp-y0 temp-x1 temp-y1] [--profile multidata|block3] [--preserve-file-crc]"
  );
  process.exit(1);
}

const numeric = (value, label) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a whole number.`);
  }
  return parsed;
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const { BLOCK3_416_PROFILE, MULTIDATA_ELEV_416_PROFILE, patchLegacy614aFeatures } = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "legacy614a.js")).href}?cacheBust=${Date.now()}`
);
const profile = profileName === "block3" ? BLOCK3_416_PROFILE : MULTIDATA_ELEV_416_PROFILE;
const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
if (inputPath === outputPath) {
  throw new Error("Choose a new output path; the reference BIN must remain unmodified.");
}

const patch = {
  weatherPosition: { x: numeric(xArg, "Weather x"), y: numeric(yArg, "Weather y") },
  ...(preserveFileCrc ? { preserveReferenceFileCrc: true } : {}),
  ...(rectArgs.length === 4
    ? {
        temperatureRect: {
          x0: numeric(rectArgs[0], "Temperature x0"),
          y0: numeric(rectArgs[1], "Temperature y0"),
          x1: numeric(rectArgs[2], "Temperature x1"),
          y1: numeric(rectArgs[3], "Temperature y1")
        }
      }
    : {})
};
const reference = await fs.readFile(inputPath);
const output = patchLegacy614aFeatures(reference, patch, profile);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, output, { flag: "wx" });
console.log(`Created guarded legacy carrier BIN (ID ${profile.watchFaceId} preserved): ${outputPath}`);
