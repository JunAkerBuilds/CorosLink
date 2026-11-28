// Always-on digits and letters are cut at half coverage with no edge dither, as COROS cuts the bitmap digits in its
// own faces, so a stroke keeps its weight and its edge stays a clean stair step. Other sprites keep the softer cleanup.
import { describe, expect, it } from "vitest";
import { isWatchfaceAodGlyphLayer, sanitizeWatchfaceAodAlpha } from "./watchfaceStudio";

/** One row of alpha values, as RGBA pixels. */
const row = (alphas: number[]) => new Uint8ClampedArray(alphas.flatMap((a) => [255, 255, 255, a]));
const alphas = (pixels: Uint8ClampedArray) => Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]);

describe("always-on glyphs", () => {
  // An antialiased stroke: 2 px of ink with soft edges either side.
  const stroke = [0, 40, 127, 128, 255, 255, 200, 90, 0];

  it("are on at half coverage and off below, with nothing in between", () => {
    expect(alphas(sanitizeWatchfaceAodAlpha(row(stroke), stroke.length, 1, undefined, { glyph: true }))).toEqual([0, 0, 0, 255, 255, 255, 255, 0, 0]);
  });

  it("keep more of a stroke than the artwork cleanup does", () => {
    const glyph = alphas(sanitizeWatchfaceAodAlpha(row(stroke), stroke.length, 1, undefined, { glyph: true })).filter((a) => a === 255).length;
    const art = alphas(sanitizeWatchfaceAodAlpha(row(stroke), stroke.length, 1)).filter((a) => a === 255).length;
    expect(glyph).toBeGreaterThan(art);
  });

  it("still vanish when faded or decorated", () => {
    const faded = [0, 90, 128, 128, 90, 0];
    expect(alphas(sanitizeWatchfaceAodAlpha(row(faded), faded.length, 1, undefined, { glyph: true, keepCutoff: true }))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("are the time, date, reading and AM/PM layers, not icons or weather", () => {
    for (const id of ["hours", "minutes", "seconds", "autoTime", "weekday", "dateMonth", "dateDay", "ampm", "battery", "heartRate", "steps"]) expect(isWatchfaceAodGlyphLayer(id)).toBe(true);
    for (const id of ["batteryIcon", "controlBatteryIcon", "weather", "complication", "sprite", null, undefined]) expect(isWatchfaceAodGlyphLayer(id)).toBe(false);
  });
});
