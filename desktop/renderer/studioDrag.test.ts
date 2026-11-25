import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import type { EditorLayer } from "../watchface/engine/watchfaceEditorModel";
import { dragKey, withoutLayers } from "./studioDrag";

const base = () => ({
  ...makeDefaultDesign(),
  staticSeparators: { colon: { enabled: true, x: 400, y: 300, size: 80, color: "#ffffff" }, dateSlash: { enabled: true, x: 0, y: 0, size: 20, color: "#ffffff" } },
  nativeData: { heart_rate: { enabled: true, x: 10, y: 10, scale: 1 }, steps: { enabled: true, x: 20, y: 20, scale: 1 } },
} as unknown as ReturnType<typeof makeDefaultDesign>);

function layer(partial: Partial<EditorLayer> & { id: string }): EditorLayer {
  return {
    kind: "time", label: partial.id, visible: true, canHide: true, present: true,
    bounds: { id: partial.id, label: partial.id, x0: 100, y0: 100, x1: 200, y1: 160 },
    capabilities: { position: true, color: true, scale: true, font: true },
    ...partial,
  };
}

describe("studio drag isolation", () => {
  it("takes only the dragged layers off the face, wherever the design keeps them", () => {
    const design = base();
    const out = withoutLayers(design, [
      layer({ id: "minutes", layoutGroupId: "minutes" }),
      layer({ id: "staticColon", staticSeparatorId: "colon" }),
      layer({ id: "native:heart_rate", nativeDataId: "heart_rate" }),
    ]);
    expect(out.layerVisibility?.minutes).toBe(false);
    expect(out.layerVisibility?.hours).toBeUndefined();
    expect(out.staticSeparators.colon.enabled).toBe(false);
    expect(out.staticSeparators.dateSlash.enabled).toBe(true);
    expect(out.nativeData?.heart_rate?.enabled).toBe(false);
    expect(out.nativeData?.steps?.enabled).toBe(true);
    // The design itself is left as it was.
    expect(design.staticSeparators.colon.enabled).toBe(true);
    expect(design.nativeData?.heart_rate?.enabled).toBe(true);
  });

  it("keys drag frames by the layers, whatever order they were picked in", () => {
    expect(dragKey(["b", "a"], "current", 800)).toBe(dragKey(["a", "b"], "current", 800));
    expect(dragKey(["a"], "current", 800)).not.toBe(dragKey(["a"], "aod", 800));
  });
});
