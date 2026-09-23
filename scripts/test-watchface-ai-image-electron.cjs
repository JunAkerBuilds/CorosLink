const assert = require("node:assert/strict");
const { app, nativeImage } = require("electron");
const { transformWatchfaceAiImage, compareWatchfaceRegions } = require("../dist-electron/watchfaceAiImage.js");

app.whenReady().then(() => {
  const width = 20, height = 16;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 4; y < 12; y++) for (let x = 5; x < 11; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 255;
  }
  const image = nativeImage.createFromBitmap(pixels, { width, height }).toDataURL();
  const glyph = { character: "0", setId: "clock" };
  const good = transformWatchfaceAiImage(image, { crop: { x: 3, y: 2, width: 10, height: 12 }, glyph, trim: false });
  assert.deepEqual(good.cropQuality.inkBounds, { x: 2, y: 2, width: 6, height: 8 });
  assert.deepEqual(good.cropQuality.padding, { left: 2, top: 2, right: 2, bottom: 2 });
  assert.equal(good.cropQuality.errors.length, 0);
  assert.deepEqual(nativeImage.createFromBuffer(Buffer.from(good.base64Png, "base64")).getSize(), { width: 10, height: 12 });
  const clipped = transformWatchfaceAiImage(image, { crop: { x: 7, y: 2, width: 6, height: 12 }, glyph, trim: true });
  assert.deepEqual(clipped.cropQuality.cutInkEdges, ["left"]);
  assert.ok(clipped.cropQuality.errors.some(error => /crosses/.test(error)), "trimming cannot conceal a cut through the original glyph");
  const blank = transformWatchfaceAiImage(image, { crop: { x: 15, y: 2, width: 3, height: 10 }, glyph });
  assert.ok(blank.cropQuality.errors.some(error => /blank/.test(error)));
  const space = transformWatchfaceAiImage(image, { crop: { x: 15, y: 2, width: 3, height: 10 }, glyph: { character: " ", setId: "labels" } });
  assert.equal(space.cropQuality.errors.length, 0);
  const outside = transformWatchfaceAiImage(image, { crop: { x: -2, y: 2, width: 16, height: 12 }, glyph });
  assert.ok(outside.cropQuality.errors.some(error => /outside/.test(error)));
  const distorted = transformWatchfaceAiImage(image, { crop: { x: 3, y: 2, width: 10, height: 12 }, width: 40, height: 12, glyph });
  assert.ok(distorted.cropQuality.warnings.some(warning => /aspect/.test(warning)));
  assert.ok(distorted.cropQuality.warnings.some(warning => /upscaled/.test(warning)));
  const face = (percent, centerOnly = false) => {
    const side = 100, pixels = Buffer.alloc(side * side * 4);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4, r = Math.hypot(x - 50, y - 50);
      pixels[i + 3] = 255;
      if (r > 37 && r < 45 && (centerOnly || percent === 100 || percent === 50 && x >= 50)) pixels[i + 1] = 255;
      if (centerOnly && x >= 45 && x < 55 && y >= 45 && y < 55) pixels[i + 1] = percent * 2.55;
    }
    return nativeImage.createFromBitmap(pixels, { width: side, height: side }).toDataURL();
  };
  const region = { x: 0, y: 0, width: 1, height: 1 };
  const compare = previews => compareWatchfaceRegions({ previews, region, dynamic: true, ring: true });
  assert.throws(() => compare([0, 50, 100].map(n => face(n, true))), /ring does not visibly change/, "a live center icon cannot satisfy a ring");
  assert.throws(() => compare([face(0), face(100), face(100)]), /ring does not visibly change/, "every sampled transition matters");
  const rings = compare([0, 50, 100].map(n => face(n)));
  assert.equal(rings.changedFractions.length, 3);
  assert.ok(rings.changedFractions.every(n => n > .02));
  assert.deepEqual(nativeImage.createFromDataURL(rings.imageDataUrl).getSize(), { width: 324, height: 100 });
  const typography = compareWatchfaceRegions({ previews: [face(100)], region: { x: .2, y: .3, width: .6, height: .4 }, reference: { dataUrl: face(100), region: { x: .3, y: .3, width: .4, height: .4 } }, dynamic: false, ring: false });
  assert.deepEqual(nativeImage.createFromDataURL(typography.imageDataUrl).getSize(), { width: 112, height: 40 }, "different glyph widths remain different on the comparison board");
  console.log("Reference crop and regional state checks passed: unchanged ring with live icon refused, duplicate transitions refused, real ring changes passed, typography aspect ratios preserved.");
  console.log("Electron PNG crop checks passed: real alpha bounds, clipping before trim, blank/space cells, padding and distortion.");
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
