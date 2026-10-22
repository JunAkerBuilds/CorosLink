import assert from "node:assert/strict";
import { nativeComponentFontSize, nativeFontSizePart, nativeHasGlyphArt, nativePart, nativePartForFontSize, nativeScaleForFontSize, withNativeFont } from "../src/watchfaces/nativeDataParts.ts";

// A recovered weather field: the template's digit, sign and unit images, plus an icon.
const digits = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), `digit-${i}`]));
const recovered = {
  enabled: true, x: 584, y: 173, scale: 1, color: "#ffffff",
  parts: { value: { x: 0, y: 0, width: 83, height: 95, digitWidth: 42 }, icon: { enabled: true } },
  assets: { digits, unit: { 0: "degree" }, symbols: { 0: "minus" }, icon: { 0: "sun" } }
};
assert.ok(nativeHasGlyphArt(recovered), "Template digits count as glyph art");

// A layer font sets the glyph images aside so the font draws them; the icon stays a picture.
const futura = { ...recovered, ...withNativeFont(recovered, "Futura") };
assert.equal(futura.fontFamily, "Futura");
assert.deepEqual(futura.assets, { icon: { 0: "sun" } }, "Only the icon image still draws");
assert.deepEqual(futura.fontReplacedAssets, { digits, unit: { 0: "degree" }, symbols: { 0: "minus" } });
assert.equal(nativePart("weather_temp", futura, "value").fontFamily, "Futura");
assert.ok(nativeHasGlyphArt(futura), "Set-aside images still offer the template font");

// Another font keeps the originals aside; an image imported meanwhile wins and is set aside too.
const imported = { ...futura, assets: { ...futura.assets, digits: { 3: "my-three" } } };
const georgia = { ...imported, ...withNativeFont(imported, "Georgia") };
assert.equal(georgia.assets.digits, undefined, "The font draws over the imported digit as well");
assert.equal(georgia.fontReplacedAssets.digits[3], "my-three", "The newer import replaces the template's 3");
assert.equal(georgia.fontReplacedAssets.digits[4], "digit-4");

// The template font (empty family) brings every image back.
const restored = { ...futura, ...withNativeFont(futura, "") };
assert.equal(restored.fontFamily, undefined);
assert.deepEqual(restored.assets, recovered.assets, "Template images are back");
assert.equal(restored.fontReplacedAssets, undefined);

// A component font only touches that component's images.
const numberOnly = { ...recovered, ...withNativeFont(recovered, "Menlo", "value") };
assert.equal(numberOnly.parts.value.fontFamily, "Menlo");
assert.equal(numberOnly.parts.value.digitWidth, 42, "The component keeps its geometry");
assert.equal(numberOnly.fontFamily, undefined);
assert.deepEqual(Object.keys(numberOnly.assets).sort(), ["icon", "symbols", "unit"]);
assert.deepEqual(numberOnly.fontReplacedAssets, { digits });

// A layer font leaves a component with its own font alone, and clearing that
// component's font keeps its images aside while the layer font still draws it.
const both = { ...numberOnly, ...withNativeFont(numberOnly, "Futura") };
assert.deepEqual(both.fontReplacedAssets, { digits, unit: { 0: "degree" }, symbols: { 0: "minus" } });
const layerDraws = { ...both, ...withNativeFont(both, "", "value") };
assert.equal(layerDraws.parts.value.fontFamily, undefined);
assert.equal(layerDraws.assets.digits, undefined, "The layer font still draws the number");
const template = { ...layerDraws, ...withNativeFont(layerDraws, "") };
assert.deepEqual(template.assets, recovered.assets);

// A Studio-added field has no glyph images: picking a font only sets the family.
const added = { enabled: true, x: 444, y: 448, scale: 1, color: "#ffffff" };
assert.ok(!nativeHasGlyphArt(added));
assert.deepEqual(withNativeFont(added, "Futura"), { fontFamily: "Futura", parts: undefined, assets: undefined, fontReplacedAssets: undefined });

// Components take the layer's weight, style and spacing unless they set their own.
const shaped = { ...added, fontFamily: "Futura", fontWeight: 300, fontStyle: "italic", letterSpacing: 0.1, parts: { icon: { fontWeight: 800 } } };
assert.deepEqual(
  ["fontWeight", "fontStyle", "letterSpacing"].map(key => nativePart("weather_uv", shaped, "value")[key]),
  [300, "italic", 0.1]
);
assert.equal(nativePart("weather_uv", shaped, "icon").fontWeight, 800);
assert.equal(nativePart("weather_uv", added, "value").fontWeight, 400, "Regular when nothing is set");

// Font size: drawn text is 75% of its sprite's height, PNG digits their height, both times the layer scale.
assert.equal(nativeComponentFontSize("weather_uv", added, "value"), 36, "48 px sprite, scale 1");
assert.equal(nativeComponentFontSize("weather_temp", recovered, "value"), 95, "Template digits read as their height");
assert.equal(nativeComponentFontSize("weather_uv", { ...added, scale: 1.5 }, "value"), 54);
// Every layer has a Font size: its number's, or for a field without one, its state artwork's.
assert.equal(nativeFontSizePart("weather_uv", added), "value");
assert.equal(nativeFontSizePart("weather_direction", added), "states");
assert.equal(nativeScaleForFontSize("weather_direction", added, 72), 2);
// The layer's Font size is its scale; it stays within the scale's range.
assert.equal(nativeScaleForFontSize("weather_uv", added, 54), 1.5);
assert.equal(nativeScaleForFontSize("weather_uv", added, 1000), 4);
// A component's Font size resizes its box and keeps its shape.
assert.deepEqual(nativePartForFontSize("weather_uv", added, "icon", 54), { width: 54, height: 72 });
assert.deepEqual(nativePartForFontSize("weather_uv", added, "value", 18), { width: 48, height: 24, digitWidth: 12 });

console.log("native font tests passed");
