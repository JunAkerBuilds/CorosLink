// Convert in Send → File: which faces are rebuilt from their own layout, and what is said before and after.
import { describe, expect, it } from "vitest";
import { getWatchfaceTarget } from "../watchface/watchfaceTargets";
import { convertDetail, convertedNote, nativeLayout } from "./studioSend";

const watch = (model: string) => getWatchfaceTarget(model)!;
const tree = (size: number) => ({ directory: `watchface_${size}x${size}` }) as never;

describe("Convert", () => {
  it("rebuilds a face with no 800 px master (recovered, or made in the COROS app)", () => {
    expect(nativeLayout({ resolutions: [tree(416)] })).toBe(true);
    expect(nativeLayout({ resolutions: [tree(416), tree(800)] })).toBe(false);
  });

  it("says what the destination keeps", () => {
    expect(convertDetail(watch("apex-4"), false)).toMatch(/^From the 800 px master.*260 × 260, 42 and 46 mm\. MIP shows Current all the time/);
    expect(convertDetail(watch("pace-4"), true)).toMatch(/^Rebuilt from this face's own layout.*390 × 390\. Always-on stays separate/);
  });

  it("says what needs looking at after", () => {
    const plain = { rebuilt: false, generatedAod: false, noCorosTemplate: false };
    expect(convertedNote(watch("pace-4"), plain)).toBeNull();
    expect(convertedNote(watch("pace-pro"), { ...plain, generatedAod: true })).toMatch(/copy of Current/);
    expect(convertedNote(watch("nomad"), plain)).toMatch(/kept for AMOLED/);
    expect(convertedNote(watch("nomad"), { ...plain, rebuilt: true })).toBeNull();
    expect(convertedNote(watch("pace-4"), { ...plain, noCorosTemplate: true })).toMatch(/COROS app/);
  });
});
