#!/usr/bin/env node
// Turns a harvest of official COROS compiled faces into a browsable asset
// library: every bitmap set is decoded to PNG frames, deduplicated by pixel
// content, classified by the layout element(s) that reference it, and written
// with a sprite-strip preview, a per-set ZIP and an index.json for the website.
//
//   node --experimental-strip-types --import ./scripts/register-ts-ext.mjs \
//     scripts/build-coros-asset-library.mjs [harvest-dir] [output-dir]
//
// The harvest directory is produced by scripts/harvest-coros-official-assets.cjs
// (a catalog.json plus .bin files). Loose .bin files without a catalog also work.
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { encodeCorosRgbaPng } from "../electron/corosCompiledWatchface.ts";
import {
  classifyOfficialAsset, composeOfficialAssetStrip, extractOfficialFaceAssets, OFFICIAL_ASSET_CATEGORY_LABELS, officialFontRole
} from "../electron/corosOfficialAssetLibrary.ts";
import { createStoreZip } from "../electron/zipStore.ts";

const harvestRoot = path.resolve(process.argv[2] ?? "output/coros-official-faces");
const outputRoot = path.resolve(process.argv[3] ?? "output/coros-asset-library");
const CATEGORY_LABELS = OFFICIAL_ASSET_CATEGORY_LABELS;

async function loadFaces() {
  const catalog = await fs.readFile(path.join(harvestRoot, "catalog.json"), "utf8").then(JSON.parse).catch(() => null);
  if (catalog?.faces) return catalog.faces.filter((face) => /\.bin$/i.test(face.file));
  const faces = [];
  for (const entry of await fs.readdir(harvestRoot, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.bin$/i.test(entry.name)) {
      const file = path.relative(harvestRoot, path.join(entry.parentPath ?? entry.path, entry.name));
      faces.push({ id: file, name: entry.name.replace(/(-[0-9a-f]{8})?\.bin$/i, ""), file });
    }
  }
  return faces;
}

const assets = new Map(); // content hash → asset record
const faces = [];
const failures = [];
const assetsRoot = path.join(outputRoot, "assets");
await fs.mkdir(assetsRoot, { recursive: true });

// Frames and the strip are written the first time a set is seen so decoded
// RGBA never has to stay in memory across a thousand-face harvest.
async function writeFrames(id, width, height, frames) {
  const directory = path.join(assetsRoot, id);
  await fs.mkdir(directory, { recursive: true });
  let bytes = 0;
  for (const [frame, rgba] of frames.entries()) {
    const png = encodeCorosRgbaPng(width, height, rgba);
    bytes += png.length;
    await fs.writeFile(path.join(directory, `${String(frame).padStart(2, "0")}.png`), png);
  }
  const strip = composeOfficialAssetStrip(width, height, frames);
  await fs.writeFile(path.join(directory, "strip.png"), encodeCorosRgbaPng(strip.width, strip.height, strip.rgba));
  return { bytes, strip: { width: strip.width, height: strip.height } };
}

for (const face of await loadFaces()) {
  const bytes = await fs.readFile(path.join(harvestRoot, face.file)).catch(() => null);
  if (!bytes) { failures.push({ face: face.name, reason: "missing file" }); continue; }
  let extracted;
  try { extracted = extractOfficialFaceAssets(bytes); }
  catch (error) { failures.push({ face: face.name, reason: error.message }); continue; }
  failures.push(...extracted.failures.map((reason) => ({ face: face.name, reason })));

  const faceRecord = {
    id: String(face.id), name: face.name, model: face.model, modelLabel: face.modelLabel, firmwareType: face.firmwareType,
    display: face.display ?? extracted.display, screen: extracted.screen, category: face.category,
    preview: face.preview, assets: []
  };

  for (const set of extracted.sets) {
    let asset = assets.get(set.id);
    if (!asset) {
      asset = {
        id: set.id, width: set.width, height: set.height, frames: set.frameCount, encoding: set.encoding,
        elementIds: new Set(), configKeys: new Set(), screens: new Set(), displays: new Set(), usedBy: [],
        ...(await writeFrames(set.id, set.width, set.height, set.frames))
      };
      assets.set(set.id, asset);
    }
    for (const id of set.elementIds) asset.elementIds.add(id);
    for (const key of set.configKeys) asset.configKeys.add(key);
    asset.screens.add(extracted.screen); asset.displays.add(faceRecord.display);
    asset.usedBy.push({ face: faceRecord.id, name: face.name, model: face.modelLabel ?? face.firmwareType });
    faceRecord.assets.push({ asset: set.id, group: set.group, elements: set.elementIds });
  }
  faces.push(faceRecord);
  if (faces.length % 25 === 0) console.log(`${faces.length} faces, ${assets.size} unique assets`);
}

const index = { generatedAt: new Date().toISOString(), categories: CATEGORY_LABELS, assets: [], faces: [] };
let written = 0;
for (const asset of assets.values()) {
  const elementIds = [...asset.elementIds].sort();
  const configKeys = [...asset.configKeys].sort();
  const category = classifyOfficialAsset(elementIds, configKeys);
  const role = category === "fonts" ? officialFontRole(elementIds) : undefined;
  const directory = path.join(assetsRoot, asset.id);
  const readme = [
    `COROS official watch-face asset ${asset.id}`, `Category: ${CATEGORY_LABELS[category]}${role ? ` (${role})` : ""}`,
    `Frame size: ${asset.width}x${asset.height}, ${asset.frames} frame(s)`,
    `Config keys: ${configKeys.join(", ") || "unknown"}`, `Elements: ${elementIds.join(", ") || "unreferenced"}`,
    `Used by: ${[...new Set(asset.usedBy.map((use) => `${use.name} (${use.model})`))].join(", ")}`,
    "", "Artwork © COROS. Extracted from official COROS watch faces for personal watch-face use."
  ].join("\n");
  const entries = [];
  for (let frame = 0; frame < asset.frames; frame++) {
    const file = `${String(frame).padStart(2, "0")}.png`;
    entries.push({ name: `${asset.id}/${file}`, data: await fs.readFile(path.join(directory, file)) });
  }
  entries.push({ name: `${asset.id}/README.txt`, data: Buffer.from(readme) });
  const zip = createStoreZip(entries);
  await fs.writeFile(path.join(directory, `${asset.id}.zip`), zip);
  index.assets.push({
    id: asset.id, category, ...(role ? { role } : {}), width: asset.width, height: asset.height, frames: asset.frames,
    encoding: asset.encoding, screens: [...asset.screens].sort((a, b) => a - b), displays: [...asset.displays].sort(),
    elements: elementIds, configKeys, bytes: asset.bytes, zipBytes: zip.length, strip: asset.strip, usedBy: asset.usedBy
  });
  written += 1;
  if (written % 250 === 0) console.log(`wrote ${written}/${assets.size} assets`);
}
index.faces = faces;
index.assets.sort((a, b) => a.category.localeCompare(b.category) || b.usedBy.length - a.usedBy.length || a.id.localeCompare(b.id));
await fs.writeFile(path.join(outputRoot, "index.json"), JSON.stringify(index));
// Compact copy for the website: rows are positional tuples (see
// Watchfaces/src/lib/asset-library.ts) so fifty thousand entries stay a few MB.
const library = {
  version: 1, generatedAt: index.generatedAt, categories: CATEGORY_LABELS, faceCount: faces.length,
  columns: ["id", "category", "role", "width", "height", "frames", "screens", "displays", "keys", "faces", "faceCount", "zipBytes", "stripWidth", "stripHeight"],
  rows: index.assets.map((asset) => {
    const names = [...new Set(asset.usedBy.map((use) => use.name))];
    return [asset.id, asset.category, asset.role ?? "", asset.width, asset.height, asset.frames, asset.screens, asset.displays,
      asset.configKeys.slice(0, 4), names.slice(0, 3), names.length, asset.zipBytes, asset.strip.width, asset.strip.height];
  })
};
await fs.writeFile(path.join(outputRoot, "library.json"), JSON.stringify(library));
await fs.writeFile(path.join(outputRoot, "failures.json"), JSON.stringify(failures, null, 2));

const byCategory = {};
for (const asset of index.assets) byCategory[asset.category] = (byCategory[asset.category] ?? 0) + 1;
console.log(`Faces: ${faces.length}, unique assets: ${index.assets.length}, failures: ${failures.length}`);
console.log(Object.entries(byCategory).map(([category, count]) => `  ${category}: ${count}`).join("\n"));
