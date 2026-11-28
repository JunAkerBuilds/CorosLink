import { describe, expect, it } from "vitest";
import { historyKey } from "./historyKeys";

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("back and forward shortcuts", () => {
  it("are ⌘[ and ⌘] on a Mac", () => {
    expect(historyKey(press("[", { metaKey: true }), true)).toBe("back");
    expect(historyKey(press("]", { metaKey: true }), true)).toBe("forward");
    expect(historyKey(press("[", {}), true)).toBeNull();
    // ⌥← moves by word in a text field: never taken on a Mac.
    expect(historyKey(press("ArrowLeft", { altKey: true }), true)).toBeNull();
  });
  it("are Alt+← and Alt+→ elsewhere", () => {
    expect(historyKey(press("ArrowLeft", { altKey: true }), false)).toBe("back");
    expect(historyKey(press("ArrowRight", { altKey: true }), false)).toBe("forward");
    expect(historyKey(press("ArrowLeft", { altKey: true, shiftKey: true }), false)).toBeNull();
    expect(historyKey(press("ArrowLeft", { ctrlKey: true }), false)).toBeNull();
  });
});
