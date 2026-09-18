#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chartConfigValues, decodeCorosLayout, formatConfigPos, formatConfigRect, readLayoutHeaders } from "./lib/coros-bin-layout.mjs";
import { renderLayoutPreviews } from "./render-coros-layout.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/decompile-coros-watchface-layout.mjs <watchface.bin> <new-output-directory>");
  process.exit(1);
}
const inputPath = path.resolve(input);
const outputPath = path.resolve(output);
const bytes = await fs.readFile(inputPath);
readLayoutHeaders(bytes); // Validate before producing any files.
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(outputPath); // Never silently overwrite a previous recovery.
const extractionPath = path.join(outputPath, "extracted");
const extractor = fileURLToPath(new URL("./extract-coros-watchface-bin.mjs", import.meta.url));
execFileSync(process.execPath, [extractor, inputPath, extractionPath], { stdio: "inherit" });
const manifest = JSON.parse(await fs.readFile(path.join(extractionPath, "manifest.json"), "utf8"));
const layout = decodeCorosLayout(bytes, manifest.blocks);
layout.source = { originalPath: inputPath, preservedFile: "source.bin", size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex") };
await fs.writeFile(path.join(outputPath, "source.bin"), bytes);

// Standard numbered filenames let the editor recognize digit and state sets.
// Names are generated; no original source filenames survive in this format.
const resolution = "watchface_416x416";
layout.assets = [];
for (const block of manifest.blocks) {
  const folder = `assets/group-${String(block.index).padStart(2, "0")}`;
  await fs.mkdir(path.join(outputPath, resolution, folder), { recursive: true });
  const files = [];
  for (const [index, frame] of block.files.entries()) {
    const file = `${resolution}/${folder}/${String(index).padStart(2, "0")}.png`;
    await fs.copyFile(path.join(extractionPath, frame.file), path.join(outputPath, file));
    files.push(file);
  }
  layout.assets.push({ index: block.index, pointer: Number(block.offset), width: block.width, height: block.height,
    frameCount: block.frameCount, folder, files });
}

function draftConfig(mode) {
  const values = new Map([
    ["watchface_id", String(mode.id)],
    ["watchface_theme_color_off", String(Number(mode.themeColorOff))],
    ["watchface_point_layer", String(mode.pointLayer)],
    ["watchface_time_format", String(mode.timeFormat)]
  ]);
  const formatPos = formatConfigPos, formatRect = formatConfigRect;
  let controls = false, chart = false;
  for (const element of mode.elements) {
    if (!element.active || !element.config || element.asset?.group == null) continue;
    const asset = layout.assets.find((a) => a.index === element.asset.group);
    if (element.config.position) values.set(element.config.position, formatPos(element.position));
    if (element.config.rect) values.set(element.config.rect, formatRect(element.rect));
    // Fonts/state tables use directories; individual icons use PNG paths.
    // COROS config values use backslash separators; forward slashes compile to blank elements.
    const folder = asset.folder.replace(/\//g, "\\");
    values.set(element.config.asset, asset.frameCount > 1 ? folder : `${folder}\\00.png`);
    controls ||= Boolean(element.control);
    chart ||= element.config.asset.startsWith("chart_");
  }
  if (controls) values.set("rect_control1_pos", formatPos(mode.controlOrigin));
  if (chart) for (const [key, value] of chartConfigValues(mode.chart)) values.set(key, value);
  if (mode.pointerCenter) values.set("time_center_pos", formatPos(mode.pointerCenter));
  return [
    "// PARTIAL RECOVERY: inspect layout.json and README.md before compiling.",
    "// Combined date, unrecognized records and theme/runtime behavior are not reconstructed.",
    "// Positions and rectangles below come from the binary; asset names are generated.",
    ...[...values].map(([key, value]) => `[${key}]=${value}`), ""
  ].join("\n");
}
for (const mode of layout.modes) {
  await fs.writeFile(path.join(outputPath, resolution, mode.mode === "aod" ? "AODconfig.txt" : "config.txt"), draftConfig(mode));
  await fs.writeFile(path.join(outputPath, `layout-${mode.mode}.bin`), Buffer.from(mode.rawHeaderHex, "hex"));
}
await fs.writeFile(path.join(outputPath, "layout.json"), `${JSON.stringify(layout, null, 2)}\n`);
await renderLayoutPreviews(layout, outputPath);
const count = layout.modes.map((m) => `${m.mode}: ${m.elements.filter((e) => e.active && e.kind !== "resource").length} positioned records`).join("; ");
await fs.writeFile(path.join(outputPath, "README.md"), `# ${path.basename(inputPath)} — partial layout recovery

${count}. ${manifest.bitmapGroups} image groups / ${manifest.bitmapFrames} frames retained.

- layout.json contains decoded positions, rectangles, alignment flags, absolute pointer locations, asset links and unresolved bitmap references. Combined month/day formatting is explicitly marked as inferred.
- preview-normal.png and preview-aod.png (when present) are reconstructions from those records and extracted assets, using sample values. They are not the embedded catalog thumbnail and are not firmware screenshots.
- preview-samples.json lists every chosen sample, plus which layers the preview rendered or skipped. Theme recoloring, exact firmware clipping, state mapping and layer ordering still need device verification.
- ${resolution}/config.txt and AODconfig.txt are partial native config drafts. They omit the combined date and unknown records. They have not been validated by a compile/install round trip; use them as recovery starting points.
- ${resolution}/assets/ contains the extracted images with standard numbered names.
- source.bin is an exact copy of the input (SHA-256: ${layout.source.sha256}). The per-mode layout .bin files and rawHeaderHex preserve every header byte.
- extracted/ retains the original extraction manifest and PNGs.

Edit numeric geometry in layout.json, then regenerate previews:

    node scripts/render-coros-layout.mjs "${path.join(outputPath, "layout.json")}"

The JSON and config drafts are separate outputs; editing one does not update the other.

## Decoder limits

${layout.limitations.map((s) => `- ${s}`).join("\n")}
${layout.warnings.map((s) => `- ${s}`).join("\n")}
`);
console.log(`Recovered ${count}. Results: ${outputPath}`);
