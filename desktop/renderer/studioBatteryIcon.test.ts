import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { layersOf, setVisible, type FaceSource } from "./studioFace";
import { addBatteryField } from "./studioLibrary";

/** A template with the clock and the fixed battery picture (a level folder at `battery_icon_pos`). */
function template(): CorosWatchfaceTemplateDetails {
  const directory = "watchface_466x466";
  const files = (folder: string, count: number, w: number, h: number) => Array.from({ length: count }, (_, i) => ({ path: `${directory}/${folder}/${String(i).padStart(2, "0")}.png`, width: w, height: h }));
  return {
    templateId: "battery-test",
    resolutions: [{
      directory, width: 466, height: 466,
      config: {
        background_icon: "background.png",
        time_hour_high_pos: "{100,200}", time_hour_high_font: "digits",
        battery_icon_dir: "battery", battery_icon_pos: "{90,130}",
      },
      aodConfig: {},
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files: files("digits", 10, 18, 28) }, { folder: "battery", kind: "state", aod: false, files: files("battery", 12, 44, 22) }],
      icons: [{ path: `${directory}/background.png`, width: 466, height: 466 }],
    }],
  } as unknown as CorosWatchfaceTemplateDetails;
}
const source = { details: template(), baselines: {}, watch: {}, projectId: "p", loadAssets: async () => [] } as unknown as FaceSource;
const battery = (design = makeDefaultDesign()) => layersOf(source, design, "current").find((l) => l.kind === "batteryIcon");

describe("Battery icon", () => {
  it("stays in Layers when hidden, in the same place, so its eye can bring it back", () => {
    const shown = battery()!;
    expect(shown).toMatchObject({ visible: true, present: true });
    const hidden = setVisible(makeDefaultDesign(), shown, false, source);
    const row = battery(hidden);
    expect(row).toMatchObject({ visible: false, present: true, bounds: shown.bounds });
    expect(battery(setVisible(hidden, row!, true, source))).toMatchObject({ visible: true, bounds: shown.bounds });
  });
});

describe("Battery icon Studio added", () => {
  it("stays in Layers when hidden", () => {
    const art = { dataUrl: "data:image/png;base64,AA==", width: 44, height: 22 };
    const bare = template();
    for (const r of bare.resolutions) { delete (r.config as Record<string, string>).battery_icon_dir; delete (r.config as Record<string, string>).battery_icon_pos; }
    const src = { ...source, details: bare } as FaceSource;
    const added = addBatteryField(makeDefaultDesign(), { "0": art, "5": art, "11": art });
    const row = layersOf(src, added, "current").find((l) => l.kind === "batteryIcon")!;
    expect(row).toMatchObject({ visible: true, present: true });
    const hidden = setVisible(added, row, false, src);
    const off = layersOf(src, hidden, "current").find((l) => l.kind === "batteryIcon")!;
    expect(off).toMatchObject({ visible: false, present: true, bounds: row.bounds });
    // Its eye brings it back as it was.
    expect(layersOf(src, setVisible(hidden, off, true, src), "current").find((l) => l.kind === "batteryIcon")).toMatchObject({ visible: true, bounds: row.bounds });
  });
});
