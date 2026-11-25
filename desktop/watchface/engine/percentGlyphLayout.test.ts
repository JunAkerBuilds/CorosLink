import { describe, expect, it } from "vitest";
import { percentGlyphLayout } from "./watchfaceGlyphLayout";

describe("battery % picture", () => {
  it("leaves a full-size % as it is", () => {
    expect(percentGlyphLayout({ width: 30, height: 40 }, 40)).toEqual({ width: 30, height: 40, x: 0, y: 0 });
  });
  it("puts the gap on the left, where the watch meets the last digit", () => {
    expect(percentGlyphLayout({ width: 30, height: 40 }, 40, 6)).toEqual({ width: 36, height: 40, x: 6, y: 0 });
  });
  it("sits a smaller % at the top, middle or bottom of a digit-tall picture", () => {
    expect(percentGlyphLayout({ width: 15, height: 20 }, 40, 0, "top").y).toBe(0);
    expect(percentGlyphLayout({ width: 15, height: 20 }, 40, 0, "middle").y).toBe(10);
    expect(percentGlyphLayout({ width: 15, height: 20 }, 40, 0, "bottom")).toEqual({ width: 15, height: 40, x: 0, y: 20 });
  });
  it("grows past the digits when the % is bigger than them", () => {
    expect(percentGlyphLayout({ width: 45, height: 60 }, 40, 0, "bottom")).toEqual({ width: 45, height: 60, x: 0, y: 0 });
  });
});
