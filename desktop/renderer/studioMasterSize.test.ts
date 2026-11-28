// Layer boxes are measured in the mode's master and the editor maps them to the screen with it. A template whose
// always-on settings exist only at the watch's size (the PACE Pro's 2609181: 416 px AODconfig, no 800 one) has its
// always-on boxes in 416 px; mapped with the current face's 800 they sat at half their place and size.
import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { masterSize, type FaceSource } from "./studioFace";

const resolution = (width: number, aodConfig: Record<string, string>) =>
  ({ directory: `watchface_${width}x${width}`, width, height: width, config: { time_minute_high_pos: "{1,1}" }, aodConfig, icons: [], spriteFolders: [] });
const source = (details: unknown) => ({ details: details as CorosWatchfaceTemplateDetails }) as unknown as FaceSource;

describe("the editor's master size", () => {
  it("is the always-on layout's own size when only the watch's size has one", () => {
    const pacePro = source({ archiveId: "2609181", resolutions: [resolution(800, {}), resolution(416, { time_minute_high_pos: "{219,173}" })] });
    expect(masterSize(pacePro)).toBe(800);
    expect(masterSize(pacePro, "current")).toBe(800);
    expect(masterSize(pacePro, "aod")).toBe(416);
  });

  it("stays the 800 master when the always-on layout has one too", () => {
    const both = source({ archiveId: "t", resolutions: [resolution(800, { a: "1" }), resolution(416, { a: "1" })] });
    expect(masterSize(both, "aod")).toBe(800);
  });

  it("follows the current face for a template without always-on", () => {
    expect(masterSize(source({ archiveId: "t", resolutions: [resolution(800, {}), resolution(416, {})] }), "aod")).toBe(800);
  });
});
