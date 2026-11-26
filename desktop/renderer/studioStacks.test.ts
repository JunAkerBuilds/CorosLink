import { describe, expect, it } from "vitest";
import { createWatchfaceShadowEffect } from "../watchface/engine/watchfaceEditorEffects";
import { duplicateShadow, moveInStack, strokePaint } from "./studioStacks";

describe("stroke and shadow stacks", () => {
  it("moves one step and stops at the ends", () => {
    expect(moveInStack(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveInStack(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    const list = ["a", "b"];
    expect(moveInStack(list, 0, -1)).toBe(list);
    expect(moveInStack(list, 1, 1)).toBe(list);
  });

  it("switches paint without losing the colour", () => {
    expect(strokePaint({ kind: "solid", color: "#ff0000" }, "linear-gradient")).toMatchObject({ kind: "linear-gradient", from: "#ff0000" });
    expect(strokePaint({ kind: "linear-gradient", from: "#00ff00", to: "#0000ff", angle: 45 }, "solid")).toEqual({ kind: "solid", color: "#00ff00" });
    const same = { kind: "solid" as const, color: "#fff" };
    expect(strokePaint(same, "solid")).toBe(same);
  });

  it("duplicates a shadow with its own id, right after it", () => {
    const a = { ...createWatchfaceShadowEffect("outer-shadow"), blur: 9 }, b = createWatchfaceShadowEffect("inner-shadow");
    const out = duplicateShadow([a, b], 0);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ blur: 9, kind: "outer-shadow" });
    expect(out[1]!.id).not.toBe(a.id);
    expect(out[2]).toBe(b);
  });
});
