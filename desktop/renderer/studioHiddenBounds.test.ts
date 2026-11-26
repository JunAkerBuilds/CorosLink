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
});
