import { describe, expect, it } from "vitest";
import { animationOutcomeText, droppedFrames } from "./studioAnimationOutcome";

const fitted = (kept: number[], total: number) => ({ kind: "fitted" as const, total, kept, delays: kept.map(() => 100), capped: false, bytes: 32768, frames: [], x: 0, y: 0, scale: 1 });

describe("animation outcome", () => {
  it("says what the watch plays", () => {
    expect(animationOutcomeText(null, "PACE 3")).toMatch(/Checking/);
    expect(animationOutcomeText({ kind: "unsupported" }, "PACE 3")).toMatch(/doesn't play animations/);
    expect(animationOutcomeText(fitted([0, 2, 4], 6), "PACE 3")).toMatch(/plays 3/);
    expect(animationOutcomeText(fitted([0], 6), "PACE 3")).toMatch(/first frame only/);
    expect(animationOutcomeText(fitted([0, 1], 2), "PACE 3")).toMatch(/all 2 frames.*50%/);
    expect(animationOutcomeText({ kind: "plays" }, "VERTIX 4")).toMatch(/while the face is lit/);
  });

  it("dims the frames left out", () => {
    expect([...droppedFrames(fitted([0, 2, 4], 6), 6)]).toEqual([1, 3, 5]);
    expect([...droppedFrames({ kind: "tooLarge" }, 3)]).toEqual([0, 1, 2]);
    expect(droppedFrames({ kind: "plays" }, 3).size).toBe(0);
  });
});
