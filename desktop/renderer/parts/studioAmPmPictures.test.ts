import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../../watchface/engine/watchfaceBackground";
import { resetAmPmPictures, setAmPmPicture } from "./StudioAmPmPictures";

const art = (n: number) => ({ dataUrl: `data:image/png;base64,${n}`, width: 20 + n, height: 10 });

describe("AM and PM pictures", () => {
  it("replaces each on its own, over the lettering, and resets both", () => {
    const base = { ...makeDefaultDesign(), ampmIndicator: { enabled: true, x: 10, y: 10, scale: 1, fontFamily: "Inter" } };
    const am = setAmPmPicture(base, "AM", art(1));
    expect(am.ampmIndicator?.fontFamily).toBeUndefined();
    expect(am.ampmIndicator?.rasterFont?.sprites).toEqual({ AM: art(1).dataUrl });
    const both = setAmPmPicture(am, "PM", art(2));
    expect(both.ampmIndicator?.rasterFont?.sprites).toEqual({ AM: art(1).dataUrl, PM: art(2).dataUrl });
    expect(both.ampmIndicator?.rasterFont?.spriteSizes?.PM).toEqual({ width: 22, height: 10 });
    expect(resetAmPmPictures(both).ampmIndicator?.rasterFont).toBeUndefined();
    const none = { ...makeDefaultDesign(), ampmIndicator: undefined };
    expect(setAmPmPicture(none, "AM", art(1))).toBe(none);
  });
});
