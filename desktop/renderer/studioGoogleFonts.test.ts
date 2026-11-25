// The Google tab's sums and the edit it writes: which weights a family has, the weight a layer takes with it, the
// search, which of a face's fonts are asked of Google when it opens, and what is said when they can't be loaded.
import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { attachWatchfaceFontSnapshots } from "../watchface/engine/watchfaceFontSnapshots";
import type { EditorLayer } from "../watchface/engine/watchfaceEditorModel";
import type { GoogleFamily } from "./studio";
import { setTypo, typographyOf } from "./studioEdits";
import { googleFamiliesToLoad, googlePreviewFamily, googleWeightFor, missingGoogleFontsMessage, nearestWeight, searchGoogleFonts, weightLabel, weightsFromFaces } from "./studioGoogleFonts";

const FAMILIES: GoogleFamily[] = [
  { family: "Roboto Mono", category: "Mono", weights: [100, 400, 700], italics: [400] },
  { family: "Oswald", category: "Sans", weights: [200, 300, 400, 500, 600, 700], italics: [], range: [200, 700] },
  { family: "Bebas Neue", category: "Display", weights: [400], italics: [] },
  { family: "Playfair Display", category: "Serif", weights: [400, 500, 600, 700, 800, 900], italics: [400] },
];
const hours: EditorLayer = {
  id: "hours", kind: "time", label: "Hour digits", timePartId: "hours", visible: true, canHide: true, present: true, bounds: null,
  capabilities: { position: true, color: true, scale: true, font: true, stroke: true, effects: true },
};

describe("a Google family's weights", () => {
  it("come from the faces it loaded: single weights and variable ranges, upright only", () => {
    expect(weightsFromFaces([{ weight: "400", style: "normal", file: "a" }, { weight: "700", style: "normal", file: "b" }, { weight: "900", style: "italic", file: "c" }])).toEqual([400, 700]);
    expect(weightsFromFaces([{ weight: "200 700", style: "normal", file: "a" }, { weight: "200 700", style: "normal", file: "b" }])).toEqual([200, 300, 400, 500, 600, 700]);
    expect(weightsFromFaces([{ weight: "100 1000", style: "normal", file: "a" }])).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(weightsFromFaces([{ weight: "400", style: "italic", file: "a" }])).toEqual([]);
  });

  it("are said in a row as the family has them", () => {
    expect(FAMILIES.map(weightLabel)).toEqual(["100 400 700", "200–700", "400", "400–900"]);
  });

  it("give a layer the nearest weight when the family lacks its own", () => {
    expect(nearestWeight([400], 700)).toBe(400);
    expect(nearestWeight([100, 400, 700], 600)).toBe(700);
    expect(nearestWeight([300, 500], 400)).toBe(500);
    expect(nearestWeight([], 600)).toBe(600);
    // Nothing is written when the family has the weight in use.
    expect(googleWeightFor([200, 300, 400, 500, 600, 700], [], 600)).toBeUndefined();
    expect(googleWeightFor([400], [400], undefined)).toBeUndefined();
    expect(googleWeightFor([400], [400], 800)).toBe(400);
    expect(googleWeightFor([], [100, 400, 700], 900)).toBe(700);
    expect(googleWeightFor([], [], 900)).toBeUndefined();
  });
});

describe("picking a Google font", () => {
  it("writes the family on the layer, drops its PNG set and snaps the weight", () => {
    const raster = { label: "Digits", dataUrl: "data:image/png;base64,AAAA", glyphs: "0123456789", columns: 10, tint: false, atlasSize: { width: 10, height: 1 } };
    const before = setTypo({ ...makeDefaultDesign(), fontWeight: 800 }, hours, { rasterFont: raster as never });
    const weight = googleWeightFor([400], [400], typographyOf(before, hours).fontWeight);
    const after = setTypo(before, hours, { fontFamily: "Bebas Neue", rasterFont: undefined, ...(weight ? { fontWeight: weight } : {}) });
    expect(after.timeStyles.hours).toMatchObject({ fontFamily: "Bebas Neue", fontWeight: 400 });
    expect(after.timeStyles.hours.rasterFont).toBeUndefined();
    expect(typographyOf(after, hours).fontWeight).toBe(400);
    // The face's own weight is left alone.
    expect(after.fontWeight).toBe(800);
  });

  it("searches names and kinds, keeping Google's order", () => {
    expect(searchGoogleFonts(FAMILIES, "").map((f) => f.family)).toEqual(["Roboto Mono", "Oswald", "Bebas Neue", "Playfair Display"]);
    expect(searchGoogleFonts(FAMILIES, "mono").map((f) => f.family)).toEqual(["Roboto Mono"]);
    expect(searchGoogleFonts(FAMILIES, "  DISPLAY ").map((f) => f.family)).toEqual(["Bebas Neue", "Playfair Display"]);
    expect(searchGoogleFonts(FAMILIES, "play serif").map((f) => f.family)).toEqual(["Playfair Display"]);
    expect(searchGoogleFonts(FAMILIES, "comic")).toEqual([]);
  });

  it("previews a row under its own name, so one weight never stands in on the face", () => {
    expect(googlePreviewFamily("Oswald")).toBe("st-g Oswald");
  });
});

describe("opening a face", () => {
  const design = () => {
    let d = { ...makeDefaultDesign(), fontFamily: "Oswald" };
    d = setTypo(d, hours, { fontFamily: "Bebas Neue" });
    return { ...d, modeDesigns: { aod: { ...makeDefaultDesign(), fontFamily: "Helvetica Neue" } } } as ReturnType<typeof makeDefaultDesign>;
  };

  it("asks for every family it names that this computer can't draw, always-on included, once each", () => {
    expect(googleFamiliesToLoad(design(), () => false).sort()).toEqual(["Bebas Neue", "Helvetica Neue", "Oswald"]);
    expect(googleFamiliesToLoad(design(), (family) => family === "Helvetica Neue").sort()).toEqual(["Bebas Neue", "Oswald"]);
    expect(googleFamiliesToLoad(design(), () => true)).toEqual([]);
    expect(googleFamiliesToLoad(makeDefaultDesign(), () => false)).toEqual([]);
  });

  it("says plainly what couldn't be loaded and what draws instead", () => {
    expect(missingGoogleFontsMessage(["Oswald"], () => true)).toBe("Oswald couldn't be loaded from Google Fonts. The face draws from its saved snapshot.");
    expect(missingGoogleFontsMessage(["Oswald", "Anton"], (f) => f === "Oswald")).toBe("Oswald and Anton couldn't be loaded from Google Fonts. Another font stands in until it can be.");
    expect(missingGoogleFontsMessage(["A", "B", "C", "D"], () => true)).toMatch(/^A, B and 2 more couldn't/);
  });

  it("keeps a saved face's snapshots out of the design that is saved without a page to draw them", async () => {
    // In the page, saving captures each named font afresh and a missing one keeps its loaded snapshot
    // (attachWatchfaceFontSnapshots); with no document there is nothing to capture, and nothing stale is written.
    const saved = await attachWatchfaceFontSnapshots({ ...design(), fontSnapshots: [] });
    expect("fontSnapshots" in saved).toBe(false);
  });
});
