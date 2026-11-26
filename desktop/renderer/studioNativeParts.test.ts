import { describe, expect, it } from "vitest";
import type { CorosWatchfaceNativeDataStyle } from "../watchface/types";
import { nativeAssetText, nativeComponentFontSize, nativePart } from "../watchface/engine/nativeDataParts";
import {
  nativeOfficialConfigKey, nativeOfficialRequest, officialPictures, partCustomized, partHasOwnFont, pictureFit, withPart, withPartFont,
  withPartFontSize, withPictureText, withPictures, withoutPartChanges, withoutPartFont, withoutPicture,
} from "./studioNativeParts";

const base = (): CorosWatchfaceNativeDataStyle => ({ enabled: true, x: 0, y: 0, scale: 1, color: "#ffffff" });

describe("official sets per part", () => {
  it("asks for the key CorosLink binds each part to", () => {
    expect(nativeOfficialConfigKey("stamina", "states")).toBe("stamina_level_icon");
    expect(nativeOfficialConfigKey("stress", "states")).toBe("stress_level_icon");
    expect(nativeOfficialConfigKey("stress", "digits")).toBe("stress_font");
    expect(nativeOfficialConfigKey("date_year", "digits")).toBe("control_number_date_year_font");
    expect(nativeOfficialConfigKey("sleep_score", "icon")).toBe("sleep_score_icon");
    expect(nativeOfficialConfigKey("stress", "symbols")).toBeUndefined();
    expect(nativeOfficialConfigKey("nope", "digits")).toBeUndefined();
  });

  it("opens on a set for many pictures and an image for one", () => {
    expect(nativeOfficialRequest("stamina", base(), "states", "States")).toMatchObject({ mode: "sprites", configKey: "stamina_level_icon" });
    expect(nativeOfficialRequest("sleep_score", base(), "icon", "Icon")).toMatchObject({ mode: "image", configKey: "sleep_score_icon", title: "Official icon for Sleep score" });
  });

  it("fills pictures in order from a set, or one index from an image", () => {
    expect(officialPictures([0, 1, 2], ["a", "b"], 0)).toEqual({ 0: "a", 1: "b" });
    expect(officialPictures([0], ["a", "b"], 0, 1)).toEqual({ 0: "b" });
    expect(officialPictures([3], [], 3)).toEqual({});
  });
});

describe("one picture at a time", () => {
  it("replaces one picture and keeps the others", () => {
    const s = { ...base(), assets: { states: { 0: "x", 1: "y" } } };
    expect(withPictures(s, "states", { 1: "z" }).assets).toEqual({ states: { 0: "x", 1: "z" } });
  });

  it("removes one picture, and the role once it is empty", () => {
    const s = { ...base(), assets: { states: { 0: "x", 1: "y" }, icon: { 0: "i" } } };
    expect(withoutPicture(s, "states", 0).assets).toEqual({ states: { 1: "y" }, icon: { 0: "i" } });
    expect(withoutPicture({ ...base(), assets: { icon: { 0: "i" } } }, "icon", 0).assets).toBeUndefined();
  });

  it("changes a drawn picture's text, up to 32 characters", () => {
    const s = { ...base(), ...withPictureText(base(), "icon", 0, "LOAD") };
    expect(nativeAssetText("week_tl", s, "icon", 0)).toBe("LOAD");
    expect(withPictureText(base(), "icon", 0, "x".repeat(40)).assetTexts?.icon?.[0]).toHaveLength(32);
  });

  it("keeps a picture's longest side at 1024", () => {
    expect(pictureFit(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(pictureFit(40, 30)).toEqual({ width: 40, height: 30 });
  });
});

describe("part layout", () => {
  it("sets width, height and alignment on the part only", () => {
    const s = { ...base(), ...withPart(base(), "unit", { width: 50, align: "center" }) };
    expect(nativePart("stamina", s, "unit")).toMatchObject({ width: 50, align: "center" });
    expect(nativePart("stamina", s, "value").align).toBe("left");
  });

  it("sizes a part to a font size", () => {
    const s = { ...base(), ...withPartFontSize("stamina", base(), "unit", 60) };
    expect(Math.round(nativeComponentFontSize("stamina", s, "unit"))).toBe(60);
  });

  it("gives a part its own font and takes it back", () => {
    const own = { ...base(), ...withPartFont(base(), "unit", "Inter") };
    expect(own.parts?.unit?.fontFamily).toBe("Inter");
    expect(partHasOwnFont(own, "unit")).toBe(true);
    const styled = { ...own, ...withPart(own, "unit", { fontWeight: 700, fontStyle: "italic", color: "#ff0000" }) };
    const back = { ...styled, ...withoutPartFont(styled, "unit") };
    expect(partHasOwnFont(back, "unit")).toBe(false);
    expect(back.parts?.unit?.color).toBe("#ff0000");
  });

  it("an own font sets the part's template glyphs aside and back", () => {
    const s = { ...base(), assets: { digits: { 0: "d" } } };
    const own = { ...s, ...withPartFont(s, "value", "Inter") };
    expect(own.assets).toBeUndefined();
    expect(own.fontReplacedAssets?.digits).toEqual({ 0: "d" });
    const back = { ...own, ...withoutPartFont(own, "value") };
    expect(back.assets?.digits).toEqual({ 0: "d" });
  });
});

describe("reset this part", () => {
  it("drops the part's settings, pictures and texts and keeps the others", () => {
    const s: CorosWatchfaceNativeDataStyle = {
      ...base(), parts: { unit: { width: 70 }, icon: { x: 4 } }, assets: { unit: { 0: "u" }, icon: { 0: "i" } }, assetTexts: { unit: { 0: "KM" } },
    };
    expect(partCustomized(s, "unit", "unit")).toBe(true);
    const r = { ...s, ...withoutPartChanges(s, "unit", "unit") };
    expect(partCustomized(r, "unit", "unit")).toBe(false);
    expect(r.parts).toEqual({ icon: { x: 4 } });
    expect(r.assets).toEqual({ icon: { 0: "i" } });
    expect(r.assetTexts).toBeUndefined();
  });
});
