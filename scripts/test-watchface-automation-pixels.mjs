import assert from "node:assert/strict";
import {
  analyzeLayerContrast,
  contrastRatio,
  parseWatchfaceHexColor,
  recolorPixels,
  samplePoint,
  sampleRegion,
  watchfaceArcSweepBox
} from "../src/watchfaces/watchfaceAutomationPixels.ts";

function frame(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3] ?? 255;
  }
  return data;
}

function paint(data, width, box, color) {
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const index = (y * width + x) * 4;
      data.set(color.length === 4 ? color : [...color, 255], index);
    }
  }
}

assert.equal(Math.round(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })), 21);
assert.equal(contrastRatio({ r: 90, g: 90, b: 90 }, { r: 90, g: 90, b: 90 }), 1);
assert.deepEqual(parseWatchfaceHexColor("#102040"), { r: 16, g: 32, b: 64 });
assert.equal(parseWatchfaceHexColor("red"), null);

// Renders a layer (a white 6x6 digit with a half-covered rim) over a backdrop.
function withDigit(backdrop, rimAlpha = 0.5) {
  const data = new Uint8ClampedArray(backdrop);
  for (let y = 4; y < 12; y += 1) {
    for (let x = 4; x < 12; x += 1) {
      const index = (y * 20 + x) * 4;
      const core = x >= 5 && x < 11 && y >= 5 && y < 11;
      const alpha = core ? 1 : rimAlpha;
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel] = Math.round(255 * alpha + backdrop[index + channel] * (1 - alpha));
      }
    }
  }
  return data;
}
function renders(behind) {
  const black = frame(20, 20, [0, 0, 0]);
  const white = frame(20, 20, [255, 255, 255]);
  return {
    width: 20,
    height: 20,
    behind,
    onBlack: { withLayer: withDigit(black), withoutLayer: black },
    onWhite: { withLayer: withDigit(white), withoutLayer: white }
  };
}
const whole = { x: 0, y: 0, width: 20, height: 20 };

// White digit on navy: probes find the glyph, its color and what's behind it.
const navyFace = frame(20, 20, [16, 32, 64]);
const navy = analyzeLayerContrast(renders(navyFace), whole);
assert.equal(navy.glyphColor, "#FFFFFF", "edge pixels don't dilute the text color");
assert.equal(navy.backgroundColor, "#102040");
assert.equal(navy.glyphPixels, 64, "half-covered rim pixels count as glyph");
assert.ok(navy.ratio > 14 && navy.worstRatio === navy.ratio);

// Half the digit crosses a white patch where it vanishes entirely. A plain
// with/without diff can't see those pixels; the probes still can.
const patchy = frame(20, 20, [16, 32, 64]);
paint(patchy, 20, { x: 4, y: 4, width: 4, height: 8 }, [255, 255, 255]);
const vanishing = analyzeLayerContrast(renders(patchy), whole);
assert.equal(vanishing.glyphPixels, 64);
assert.equal(vanishing.worstRatio, 1, "the invisible part sets the worst case");
assert.ok(vanishing.ratio < navy.ratio);
assert.equal(
  analyzeLayerContrast({ ...renders(navyFace), onBlack: { withLayer: navyFace, withoutLayer: navyFace }, onWhite: { withLayer: navyFace, withoutLayer: navyFace } }, whole),
  null,
  "a layer that draws nothing has no contrast to report"
);

// PARTICLES-style outlined digit: a white ring with a black fill. The fill
// blends into the black face by design; only the ring is ink.
function outlinedDigit(backdrop) {
  const data = new Uint8ClampedArray(backdrop);
  paint(data, 20, { x: 4, y: 4, width: 10, height: 10 }, [255, 255, 255]);
  paint(data, 20, { x: 5, y: 5, width: 8, height: 8 }, [0, 0, 0]);
  return data;
}
const blackPlate = frame(20, 20, [0, 0, 0]);
const whitePlate = frame(20, 20, [255, 255, 255]);
const outlined = analyzeLayerContrast({
  width: 20,
  height: 20,
  behind: blackPlate,
  onBlack: { withLayer: outlinedDigit(blackPlate), withoutLayer: blackPlate },
  onWhite: { withLayer: outlinedDigit(whitePlate), withoutLayer: whitePlate }
}, whole);
assert.equal(outlined.glyphColor, "#FFFFFF", "the dark fill is not averaged into the text color");
assert.equal(outlined.glyphPixels, 36);
assert.equal(outlined.inkShare, 0.36);
assert.equal(Math.round(outlined.worstRatio), 21);

// Always-on has no white backdrop: fall back to what visibly changes on black.
const blackFace = frame(20, 20, [0, 0, 0]);
const aod = analyzeLayerContrast({
  width: 20,
  height: 20,
  behind: blackFace,
  onBlack: { withLayer: withDigit(blackFace), withoutLayer: blackFace }
}, whole);
assert.equal(aod.glyphColor, "#FFFFFF");
assert.equal(aod.backgroundColor, "#000000");
assert.equal(Math.round(aod.ratio), 21);

// Sampling weights by alpha, so transparent padding doesn't read as black.
const sprite = frame(4, 2, [0, 0, 0, 0]);
paint(sprite, 4, { x: 0, y: 0, width: 2, height: 2 }, [255, 0, 0, 255]);
const sampled = sampleRegion(sprite, 4, 2, { x: 0, y: 0, width: 4, height: 2 }, 3);
assert.equal(sampled.average, "#FF0000");
assert.equal(sampled.coverage, 0.5);
assert.deepEqual(sampled.palette, [{ color: "#FF0000", share: 1 }]);
assert.deepEqual(samplePoint(sprite, 4, 2, { x: 3.7, y: 1.2 }), { x: 3, y: 1, color: "#000000", alpha: 0 });
assert.equal(samplePoint(sprite, 4, 2, { x: 4, y: 0 }), null);

// Recoloring keeps alpha; with `from` only near matches change.
const icon = frame(3, 1, [200, 10, 10, 128]);
icon.set([10, 200, 10, 255], 4);
icon.set([0, 0, 0, 0], 8);
assert.equal(recolorPixels(icon, { r: 0, g: 0, b: 0 }, { r: 210, g: 0, b: 0 }, 20), 1);
assert.deepEqual([...icon], [0, 0, 0, 128, 10, 200, 10, 255, 0, 0, 0, 0]);
assert.equal(recolorPixels(icon, { r: 1, g: 2, b: 3 }), 2, "without from, every visible pixel changes");

// PARTICLES' calorie arc runs along the bottom of the face (7:30 to 4:20).
const arcBox = watchfaceArcSweepBox({
  centerX: 208, centerY: 208, radiusX: 195, radiusY: 195,
  startAngle: -138, endAngle: -41, strokeWidth: 10
});
assert.ok(Math.abs(arcBox.y1 - 408) < 0.01, `bottom of the arc, got ${arcBox.y1}`);
assert.ok(arcBox.y0 > 330 && arcBox.y0 < 332, `top of the arc ends, got ${arcBox.y0}`);
assert.ok(arcBox.x0 > 57 && arcBox.x0 < 59 && arcBox.x1 > 359 && arcBox.x1 < 361);

console.log("watchface automation pixel tests passed");
