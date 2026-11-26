import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../../watchface/types";
import { templateImageOf, templateImageRole } from "./StudioTemplateImage";

const file = (path: string, width: number) => ({ path, width, height: width, size: 1 });
const details = {
  resolutions: [
    { directory: "watchface_416x416", width: 416, height: 416, config: { colon_icon: "colon.png" }, aodConfig: {}, icons: [file("watchface_416x416/colon.png", 10)], spriteFolders: [] },
    { directory: "watchface_800x800", width: 800, height: 800, config: { colon_icon: "colon.png" }, aodConfig: {}, icons: [file("watchface_800x800/colon.png", 20)], spriteFolders: [] },
  ],
} as unknown as CorosWatchfaceTemplateDetails;

describe("template image facts", () => {
  it("finds the image by its id, or by its key on the always-on screen", () => {
    expect(templateImageOf(details, "config:colon_icon")).toMatchObject({ configKey: "colon_icon", relativePath: "colon.png" });
    expect(templateImageOf(details, "aod:colon_icon")?.configKey).toBe("colon_icon");
    expect(templateImageOf(details, undefined)).toBeNull();
  });

  it("says what the watch does with it", () => {
    expect(templateImageRole("colon_icon")).toMatch(/between the hour and minute/);
    expect(templateImageRole("watchface_thmb_icon")).toMatch(/Not drawn/);
    expect(templateImageRole("control_hr_icon")).toMatch(/selectable slot/);
    expect(templateImageRole("background_icon")).toBeNull();
  });
});
