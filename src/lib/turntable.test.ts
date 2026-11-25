import { describe, expect, it } from "vitest";
import { angleOfFrame, frameFromAngle, frameFromDrag, frameFromHover, stripPosition, wrapFrame } from "./turntable";

describe("wrapFrame", () => {
  it("keeps frames in range", () => {
    expect(wrapFrame(0, 12)).toBe(0);
    expect(wrapFrame(11, 12)).toBe(11);
  });
  it("wraps past either end", () => {
    expect(wrapFrame(12, 12)).toBe(0);
    expect(wrapFrame(13, 12)).toBe(1);
    expect(wrapFrame(-1, 12)).toBe(11);
    expect(wrapFrame(-25, 12)).toBe(11);
  });
  it("is safe with no frames", () => {
    expect(wrapFrame(3, 0)).toBe(0);
  });
});

describe("frameFromHover", () => {
  it("maps the pointer's place across the figure to a view", () => {
    expect(frameFromHover(0, 176, 12)).toBe(0);
    expect(frameFromHover(88, 176, 12)).toBe(6);
    expect(frameFromHover(175, 176, 12)).toBe(11);
  });
  it("clamps outside the figure and never wraps", () => {
    expect(frameFromHover(-20, 176, 12)).toBe(0);
    expect(frameFromHover(176, 176, 12)).toBe(11);
    expect(frameFromHover(900, 176, 12)).toBe(11);
  });
  it("is safe before the figure has a width", () => {
    expect(frameFromHover(10, 0, 12)).toBe(0);
  });
});

describe("frameFromDrag", () => {
  it("turns one view per step of distance", () => {
    expect(frameFromDrag(0, 0, 16, 12)).toBe(0);
    expect(frameFromDrag(0, 16, 16, 12)).toBe(1);
    expect(frameFromDrag(0, 47, 16, 12)).toBe(3);
    expect(frameFromDrag(4, -32, 16, 12)).toBe(2);
  });
  it("wraps round in both directions", () => {
    expect(frameFromDrag(10, 48, 16, 12)).toBe(1);
    expect(frameFromDrag(1, -48, 16, 12)).toBe(10);
    expect(frameFromDrag(0, 16 * 12 * 3, 16, 12)).toBe(0);
  });
  it("stays put with a bad step size", () => {
    expect(frameFromDrag(5, 100, 0, 12)).toBe(5);
  });
});

describe("angles", () => {
  it("finds the nearest view to an angle", () => {
    expect(frameFromAngle(0, 12)).toBe(0);
    expect(frameFromAngle(30, 12)).toBe(1);
    expect(frameFromAngle(44, 12)).toBe(1);
    expect(frameFromAngle(46, 12)).toBe(2);
    expect(frameFromAngle(360, 12)).toBe(0);
    expect(frameFromAngle(-30, 12)).toBe(11);
    expect(frameFromAngle(750, 12)).toBe(1);
  });
  it("gives the angle a view shows", () => {
    expect(angleOfFrame(0, 12)).toBe(0);
    expect(angleOfFrame(3, 12)).toBe(90);
    expect(angleOfFrame(-1, 12)).toBe(330);
  });
});

describe("stripPosition", () => {
  it("spreads the views across the strip", () => {
    expect(stripPosition(0, 12)).toBe("0.0000%");
    expect(stripPosition(11, 12)).toBe("100.0000%");
    expect(stripPosition(1, 12)).toBe("9.0909%");
    expect(stripPosition(12, 12)).toBe("0.0000%");
  });
});
