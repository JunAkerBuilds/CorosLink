import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { opaqueBounds, clampCropRect, cropInkEdges, describeCropQuality } = require("../dist-electron/watchfaceAiImage.js");

function bitmap(width, height, opaque) {
  const pixels = new Uint8Array(width * height * 4);
  for (const [x, y, alpha = 255] of opaque) pixels[(y * width + x) * 4 + 3] = alpha;
  return pixels;
}

// A padded generation trims to exactly its visible pixels.
assert.deepEqual(
  opaqueBounds(bitmap(10, 6, [[2, 1], [7, 4], [5, 2]]), 10, 6),
  { x: 2, y: 1, width: 6, height: 4 }
);
assert.equal(opaqueBounds(bitmap(4, 3, []), 4, 3), null, "a blank image has nothing to keep");
assert.deepEqual(
  opaqueBounds(bitmap(4, 3, [[0, 0, 7], [3, 2, 8]]), 4, 3),
  { x: 3, y: 2, width: 1, height: 1 },
  "near-invisible fringe pixels don't widen the box"
);

// Crops clip to the image and reject a region that misses it.
assert.deepEqual(
  clampCropRect({ x: -5, y: 1, width: 10.4, height: 10 }, 4, 3),
  { x: 0, y: 1, width: 4, height: 2 }
);
assert.throws(() => clampCropRect({ x: 9, y: 0, width: 5, height: 5 }, 4, 3), /outside the 4x3 image/);
assert.throws(() => clampCropRect({ x: 0, y: 0, width: Number.NaN, height: 5 }, 4, 3), /numeric/);

const shape = bitmap(12, 8, Array.from({ length: 4 }, (_, y) => Array.from({ length: 3 }, (_, x) => [x + 4, y + 2])).flat());
assert.deepEqual(cropInkEdges(shape, 12, 8, { x: 3, y: 1, width: 5, height: 6 }), []);
assert.deepEqual(cropInkEdges(shape, 12, 8, { x: 4, y: 2, width: 2, height: 4 }), ["right"], "detect continuity outside a cut before trimming hides it");
assert.deepEqual(cropInkEdges(shape, 12, 8, { x: 4, y: 2, width: 3, height: 4 }), [], "a tight but complete glyph does not cross ink");
const info = { crop: { x: 3, y: 1, width: 5, height: 6 }, region: { x: 3, y: 1, width: 5, height: 6 }, width: 5, height: 6, inkBounds: { x: 1, y: 1, width: 3, height: 4 }, cutInkEdges: [], clamped: false, glyph: { character: "0", setId: "clock" } };
assert.deepEqual(describeCropQuality(info).padding, { left: 1, top: 1, right: 1, bottom: 1 });
assert.ok(describeCropQuality({ ...info, inkBounds: null }).errors.some(error => /blank/.test(error)));
assert.equal(describeCropQuality({ ...info, inkBounds: null, glyph: { character: " ", setId: "labels" } }).errors.length, 0, "intentional spacing glyphs may be blank");
assert.ok(describeCropQuality({ ...info, cutInkEdges: ["right"] }).errors.some(error => /crosses/.test(error)));
assert.equal(describeCropQuality({ ...info, glyph: undefined, cutInkEdges: ["right"] }).errors.length, 0, "cutting through artwork can be intentional for non-glyph crops");
assert.ok(describeCropQuality({ ...info, clamped: true }).errors.some(error => /outside/.test(error)));
assert.ok(describeCropQuality({ ...info, width: 10 }).warnings.some(warning => /aspect/.test(warning)));
assert.ok(describeCropQuality({ ...info, width: 10, height: 12 }).warnings.some(warning => /upscaled/.test(warning)));
console.log("Watchface AI image quality tests passed (clipped strokes, blank cells, margins, distortion and source pixels).");
