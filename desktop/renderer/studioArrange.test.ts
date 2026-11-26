import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { createBackgroundElement } from "../watchface/engine/watchfaceBackgroundElements";
import type { CorosWatchfaceDesignSprite } from "../watchface/types";
import { arrange, artworkPlace, duplicate, isArtwork } from "./studioArrange";

const sprite = (id: string): CorosWatchfaceDesignSprite => ({
  id, dataUrl: "data:image/png;base64,AA==", sourceWidth: 10, sourceHeight: 10, width: 10, height: 10, x: 100, y: 120, scale: 1, rotation: 0,
});

function face() {
  const rect = { ...createBackgroundElement("rect", { x: 300, y: 300 }, "Inter"), id: "r" };
  return { ...makeDefaultDesign(), designSprites: [sprite("a"), sprite("b")], backgroundElements: [rect], artworkLayerOrder: ["bgel:r", "sprite:a", "sprite:b"] };
}

describe("artwork order", () => {
  it("moves one step and to the front or back", () => {
    const d = face();
    expect(arrange(d, "sprite:a", "forward").artworkLayerOrder).toEqual(["bgel:r", "sprite:b", "sprite:a"]);
    expect(arrange(d, "sprite:a", "backward").artworkLayerOrder).toEqual(["sprite:a", "bgel:r", "sprite:b"]);
    expect(arrange(d, "bgel:r", "front").artworkLayerOrder).toEqual(["sprite:a", "sprite:b", "bgel:r"]);
    expect(arrange(d, "sprite:b", "back").artworkLayerOrder).toEqual(["sprite:b", "bgel:r", "sprite:a"]);
    expect(artworkPlace(d, "sprite:a")).toEqual({ index: 1, count: 3 });
  });

  it("leaves the design alone at an end, and for template layers", () => {
    const d = face();
    expect(arrange(d, "sprite:b", "forward")).toBe(d);
    expect(arrange(d, "bgel:r", "back")).toBe(d);
    expect(arrange(d, "hours", "forward")).toBe(d);
    expect(isArtwork("hours")).toBe(false);
    expect(isArtwork("sprite:a")).toBe(true);
  });
});

describe("duplicate", () => {
  it("copies an image just above it, offset", () => {
    const out = duplicate(face(), "sprite:a")!;
    expect(out.layerId).toBe("sprite:a-2");
    expect(out.design.artworkLayerOrder).toEqual(["bgel:r", "sprite:a", "sprite:a-2", "sprite:b"]);
    const copy = out.design.designSprites.find((s) => s.id === "a-2")!;
    expect([copy.x, copy.y]).toEqual([116, 136]);
    expect(duplicate(out.design, "sprite:a")!.layerId).toBe("sprite:a-3");
  });

  it("copies a shape, and refuses template layers", () => {
    const out = duplicate(face(), "bgel:r")!;
    expect(out.layerId).toBe("bgel:r-2");
    expect(out.design.backgroundElements).toHaveLength(2);
    expect(duplicate(face(), "hours")).toBeNull();
  });

  it("stops at the image limit", () => {
    const full = { ...face(), designSprites: Array.from({ length: 12 }, (_, i) => sprite(`s${i}`)) };
    expect(() => duplicate(full, "sprite:s0")).toThrow(/up to 12/);
  });
});
