import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { deriveEditorLayers } from "../watchface/engine/watchfaceEditorModel";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";

const details = { archiveId: "t", resolutions: [{ directory: "watchface_800x800", width: 800, height: 800, config: {}, aodConfig: {}, icons: [], spriteFolders: [] }] } as unknown as CorosWatchfaceTemplateDetails;

describe("hidden layers keep their box", () => {
  it("so a hidden colon or date slash can still be placed and aligned", () => {
    const design = { ...makeDefaultDesign(), staticSeparators: {
      colon: { enabled: false, x: 400, y: 300, size: 80, color: "#ffffff" },
      dateSlash: { enabled: false, x: 200, y: 500, size: 40, color: "#ffffff" },
    } };
    const layers = deriveEditorLayers(details, design);
    for (const id of ["staticColon", "staticDateSlash"]) {
      const layer = layers.find((l) => l.id === id)!;
      expect(layer.visible).toBe(false);
      expect(layer.bounds).not.toBeNull();
    }
  });

  it("so hidden battery data or a hidden metric stays in the list with its eye", () => {
    const directory = "watchface_416x416";
    const digits = Array.from({ length: 10 }, (_, i) => ({ path: `${directory}/digits/0${i}.png`, width: 18, height: 28 }));
    const metrics = { archiveId: "m", resolutions: [{ directory, width: 416, height: 416, aodConfig: {}, icons: [],
      config: { battery_level_rect: "{170,250,230,280,0}", battery_level_font: "digits", heartreate_level_rect: "{35,250,95,280,0}", heartreate_level_font: "digits" },
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files: digits }] }] } as unknown as CorosWatchfaceTemplateDetails;
    const shown = deriveEditorLayers(metrics, makeDefaultDesign());
    const hidden = deriveEditorLayers(metrics, { ...makeDefaultDesign(), metricChanges: { battery: false, heartRate: false } });
    for (const id of ["battery", "heartRate"]) {
      const before = shown.find((l) => l.id === id)!, after = hidden.find((l) => l.id === id)!;
      expect(before.present).toBe(true);
      expect(after.visible).toBe(false);
      expect(after.present).toBe(true);
      expect(after.bounds).toEqual(before.bounds);
    }
  });
});
