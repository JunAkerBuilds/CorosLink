// shrinkImage: the Lanczos-3 shrink that stands in for the Chromium resize CorosLink used (nativeImage "best"), and
// scaleImage left as the compiler's stand-in for COROS's own scaling.
import { describe, expect, it } from "vitest";
import type { RgbaImage } from "./png";
import { scaleImage, shrinkImage } from "./scale";

const image = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): RgbaImage => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const at = (img: RgbaImage, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe("shrinkImage", () => {
  it("keeps a flat colour exactly, at every watch size", () => {
    const flat = image(800, 800, () => [30, 120, 200, 255]);
    for (const size of [466, 416, 390, 280, 260, 240]) {
      const out = shrinkImage(flat, size, size);
      expect([out.width, out.height]).toEqual([size, size]);
      expect(new Set(Array.from({ length: size }, (_, i) => at(out, i, (i * 7) % size).join()))).toEqual(new Set(["30,120,200,255"]));
    }
  });

  it("doesn't bleed colour from transparent pixels into a sprite's edge", () => {
    // A red disc whose transparent surround is stored as green: no green may show at the edge.
    const sprite = image(80, 80, (x, y) => ((x - 40) ** 2 + (y - 40) ** 2 < 30 ** 2 ? [255, 0, 0, 255] : [0, 255, 0, 0]));
    const out = shrinkImage(sprite, 42, 42);
    for (let p = 0; p < out.data.length; p += 4) if (out.data[p + 3]! > 0) expect(out.data[p + 1]).toBe(0);
  });

  it("keeps an edge sharper than area averaging", () => {
    // Black | white at x = 400; at 240 px the edge falls mid-pixel. Count the in-between pixels on a row.
    const edge = image(800, 8, (x) => (x < 400 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const soft = (img: RgbaImage) => Array.from({ length: img.width }, (_, x) => at(img, x, 1)[0]!).filter((v) => v > 20 && v < 235).length;
    expect(soft(shrinkImage(edge, 240, 2))).toBeLessThanOrEqual(soft(scaleImage(edge, 240, 2)));
    expect(at(shrinkImage(edge, 240, 2), 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(shrinkImage(edge, 240, 2), 239, 0)).toEqual([255, 255, 255, 255]);
  });

  it("enlarges bilinearly, as CorosLink did after Chromium's upscale smeared small digits", () => {
    const digit = image(26, 40, (x, y) => (x > 5 && x < 20 && y > 5 && y < 34 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(shrinkImage(digit, 42, 64)).toEqual(scaleImage(digit, 42, 64));
    expect(shrinkImage(digit, 26, 40)).toBe(digit);
  });
});
