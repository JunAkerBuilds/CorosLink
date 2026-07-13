import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg || process.argv.length !== 4) {
  console.error(
    "Usage: npm run legacy614a:slender -- <MULTIDATA-ELEV-reference.bin> <output.bin>"
  );
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const {
  MULTIDATA_ELEV_416_PROFILE,
  SLENDER_MULTIDATA_416_PATCH,
  inspectLegacy614aCarrier,
  patchLegacy614aFeatures
} = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "legacy614a.js")).href}?cacheBust=${Date.now()}`
);

const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
if (inputPath === outputPath) {
  throw new Error("Choose a new output path; the public MULTIDATA reference must remain unmodified.");
}

const reference = await fs.readFile(inputPath);
const source = inspectLegacy614aCarrier(reference, MULTIDATA_ELEV_416_PROFILE);
const output = patchLegacy614aFeatures(
  reference,
  SLENDER_MULTIDATA_416_PATCH,
  MULTIDATA_ELEV_416_PROFILE
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, output, { flag: "wx" });

console.log(`Created SLENDER layout carrier: ${outputPath}`);
console.log(`Carrier identity preserved: ${source.watchFaceId} (${source.profileName})`);
console.log(
  `Weather ${source.weatherPosition.x},${source.weatherPosition.y} → ${SLENDER_MULTIDATA_416_PATCH.weatherPosition.x},${SLENDER_MULTIDATA_416_PATCH.weatherPosition.y}`
);
console.log(
  `Temperature ${source.temperatureRect.x0},${source.temperatureRect.y0},${source.temperatureRect.x1},${source.temperatureRect.y1} → ${SLENDER_MULTIDATA_416_PATCH.temperatureRect.x0},${SLENDER_MULTIDATA_416_PATCH.temperatureRect.y0},${SLENDER_MULTIDATA_416_PATCH.temperatureRect.x1},${SLENDER_MULTIDATA_416_PATCH.temperatureRect.y1}`
);
