import { describe, expect, it } from "vitest";
import { scaleForHeight } from "./studioSpotHeight";

describe("status image height", () => {
  it("finds the scale for a height, within limits", () => {
    expect(scaleForHeight(64, 1, 32)).toBe(0.5);
    expect(scaleForHeight(32, 0.5, 64)).toBe(1);
    expect(scaleForHeight(10, 1, 1000)).toBe(4);
    expect(scaleForHeight(64, 1, 1)).toBe(0.1);
  });
});
