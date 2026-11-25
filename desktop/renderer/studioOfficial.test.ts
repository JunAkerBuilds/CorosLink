// The edits a pick from the official COROS library writes (CorosLink's chooseSprite, chooseConfigAsset, the PNG-font
// folder import, chooseBatterySpriteFolder and chooseWeatherSpriteFolder, each with an official preset), and what each
// entry point asks the browser for.
import { describe, expect, it } from "vitest";
import { makeDefaultDesign, MAX_DESIGN_SPRITES } from "../watchface/engine/watchfaceBackground";
import { deriveEditorLayers, type EditorLayer } from "../watchface/engine/watchfaceEditorModel";
import { classifyRasterSpriteFolder } from "../watchface/engine/watchfaceRasterFolder";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import type { OfficialFrames } from "./studio";
import { assetOf, panelOf, replaceAsset, setBatteryStates } from "./studioEdits";
import {
  addOfficialImage, officialArtwork, officialBatteryRequest, officialBatteryStates, officialFolder, officialFontRequest, officialImageRequest, officialQuery,
  officialWeatherRequest, restoreWeatherSet, setWeatherSet, weatherSetCount,
} from "./studioOfficial";

const frames = (count: number, over: Partial<OfficialFrames> = {}): OfficialFrames => ({
  id: "a".repeat(16), category: "fonts", label: "Digit fonts from RIDGE", width: 30, height: 44,
  frames: Array.from({ length: count }, (_, i) => `data:image/png;base64,${Buffer.from(`frame-${i}`).toString("base64")}`), ...over,
});
function layer(partial: Partial<EditorLayer> & { id: string }): EditorLayer {
  return {
    kind: "time", label: partial.id, visible: true, canHide: true, present: true, bounds: null,
    capabilities: { position: true, color: true, scale: true, font: true, stroke: true, effects: true }, ...partial,
  };
}

describe("Add → Official", () => {
  it("puts the picked frame in the middle of the face, in front, at 1:1 on the watch", () => {
    const set = frames(3);
    const design = addOfficialImage(makeDefaultDesign(), officialArtwork(set, 2), { width: 800, height: 800 }, 800 / 416, "sprite-1");
    expect(design.designSprites).toHaveLength(1);
    expect(design.designSprites![0]).toMatchObject({
      id: "sprite-1", dataUrl: set.frames[2], sourceWidth: 30, sourceHeight: 44, width: 58, height: 85, x: 400, y: 400,
      scale: 1, rotation: 0, opacity: 1, visible: true, aspectLocked: true, crop: { x: 0, y: 0, width: 1, height: 1 }, origin: { x: 0.5, y: 0.5 }, tintColor: null,
    });
    expect(design.artworkLayerOrder).toEqual(["sprite:sprite-1"]);
    const two = addOfficialImage(design, officialArtwork(set), { width: 800, height: 800 }, 1, "sprite-2");
    expect(two.artworkLayerOrder).toEqual(["sprite:sprite-1", "sprite:sprite-2"]);
    expect(two.designSprites![1]).toMatchObject({ dataUrl: set.frames[0], width: 30, height: 44 });
  });

  it("is a layer the editor lists and can select", () => {
    const design = addOfficialImage(makeDefaultDesign(), officialArtwork(frames(1)), { width: 800, height: 800 }, 1, "sprite-1");
    const details = { templateId: "t", resolutions: [{ directory: "watchface_800x800", width: 800, height: 800, config: { background_icon: "background.png" }, aodConfig: {}, spriteFolders: [], icons: [] }] } as unknown as CorosWatchfaceTemplateDetails;
    const added = deriveEditorLayers(details, design).find((l) => l.spriteId === "sprite-1");
    expect(added).toMatchObject({ id: "sprite:sprite-1", visible: true });
    expect(panelOf(added!, design)).toBe("sprite");
  });

  it("refuses a thirteenth image and a frame the set doesn't have falls back to the first", () => {
    let design = makeDefaultDesign();
    for (let i = 0; i < MAX_DESIGN_SPRITES; i++) design = addOfficialImage(design, officialArtwork(frames(1)), { width: 800, height: 800 }, 1, `s${i}`);
    expect(() => addOfficialImage(design, officialArtwork(frames(1)), { width: 800, height: 800 }, 1, "more")).toThrow(/up to 12 images/);
    expect(officialArtwork(frames(2), 9).dataUrl).toBe(frames(2).frames[0]);
  });
});

describe("official sets in place of the template's", () => {
  it("replaces a template image with a frame", () => {
    const bluetooth = layer({ id: "configAsset:config:bluetooth_on_icon", kind: "configAsset", configAssetId: "config:bluetooth_on_icon" });
    const set = frames(1, { width: 24, height: 24 });
    const design = replaceAsset(makeDefaultDesign(), bluetooth, officialArtwork(set));
    expect(assetOf(design, bluetooth)).toEqual({ enabled: true, replacement: { dataUrl: set.frames[0], width: 24, height: 24 } });
  });

  it("is a digit set the PNG font import takes: 00.png to 09.png, in the watch's order", () => {
    const folder = officialFolder(frames(10));
    expect(folder.label).toBe("Digit fonts from RIDGE");
    expect(folder.sprites.map((s) => s.name)).toEqual(["00.png", "01.png", "02.png", "03.png", "04.png", "05.png", "06.png", "07.png", "08.png", "09.png"]);
    expect(folder.sprites[3]).toMatchObject({ relativePath: "03.png", dataUrl: frames(10).frames[3], sizeBytes: 7 });
    const classified = classifyRasterSpriteFolder(folder);
    expect(classified.importedDigitCount).toBe(10);
    expect([...classified.digitSprites.keys()].sort().join("")).toBe("0123456789");
    // Seven labels for the weekday, as numbered sprites.
    expect(classifyRasterSpriteFolder(officialFolder(frames(7)), "weekday").importedWeekdayCount).toBe(7);
  });

  it("gives the battery icon its states: charging, empty, then the tens", () => {
    const battery = layer({ id: "batteryIcon", kind: "batteryIcon" });
    const set = frames(12, { category: "battery", width: 40, height: 20 });
    const design = setBatteryStates(makeDefaultDesign(), battery, officialBatteryStates(set));
    const override = assetOf(design, battery)!;
    expect(Object.keys(override.stateReplacements!)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(override.stateReplacements!["11"]).toEqual({ dataUrl: set.frames[11], width: 40, height: 20 });
    expect(override).toMatchObject({ enabled: true, ownSize: true });
    expect(design.layerVisibility?.batteryIcon).toBe(true);
    expect(() => officialBatteryStates(frames(1))).toThrow(/each battery level/);
  });

  it("replaces the weather icon's day, night or temperature set and restores it", () => {
    const base = { ...makeDefaultDesign(), weatherIndicator: { enabled: true, x: 120, y: 80, scale: 1.5, color: "#53cba1" } };
    const day = frames(41, { category: "weather", width: 60, height: 60 });
    let design = setWeatherSet(base, "day", day);
    expect(design.weatherIndicator).toMatchObject({ enabled: true, x: 120, y: 80, scale: 1.5, color: "#53cba1" });
    expect(Object.keys(design.weatherIndicator!.assets!.day!)).toHaveLength(41);
    expect(design.weatherIndicator!.assets!.day!["40"]).toBe(day.frames[40]);
    design = setWeatherSet(design, "digits", frames(10));
    expect([weatherSetCount(design, "day"), weatherSetCount(design, "night"), weatherSetCount(design, "digits")]).toEqual([41, 0, 10]);
    // A set that fits fewer states leaves the rest built in; one with too many is refused.
    expect(weatherSetCount(setWeatherSet(base, "night", frames(30)), "night")).toBe(30);
    expect(() => setWeatherSet(base, "digits", frames(41))).toThrow(/digits takes 10/);
    design = restoreWeatherSet(design, "day");
    expect(design.weatherIndicator!.assets).toEqual({ digits: expect.any(Object) });
    expect(restoreWeatherSet(base, "day")).toBe(base);
    // A face whose template has no weather icon yet gets one switched on.
    expect(setWeatherSet(makeDefaultDesign(), "day", day).weatherIndicator).toMatchObject({ enabled: true, x: 0, y: 0, scale: 1 });
  });
});

describe("what each entry point asks the browser for", () => {
  it("Add → Official browses everything", () => {
    expect(officialQuery({ mode: "image", title: "Official COROS artwork" })).toEqual({});
  });

  it("a PNG font asks for digit sets used as the layer's kind, or the labels a date part needs", () => {
    const hours = layer({ id: "hours", timePartId: "hours", label: "Hour digits" });
    expect(officialFontRequest(hours, "time", "layer")).toEqual({ mode: "font", title: "Official font for Hour digits", role: "time", frameCount: 10 });
    expect(officialQuery(officialFontRequest(hours, "time", "layer"))).toEqual({ category: "fonts", role: "time", frameCount: 10 });
    expect(officialFontRequest(layer({ id: "weekday", kind: "weekday" }), "date", "layer")).toMatchObject({ title: "Official weekday labels", role: "date", frameCount: 7 });
    expect(officialFontRequest(layer({ id: "dateMonth", kind: "date" }), "date", "layer")).toMatchObject({ frameCount: 12 });
    expect(officialFontRequest(layer({ id: "dateDay", kind: "date" }), "date", "layer")).toMatchObject({ role: "date", frameCount: 10 });
    expect(officialFontRequest(layer({ id: "battery", kind: "metric", metricId: "battery" }), "metric", "layer").role).toBe("battery");
    expect(officialFontRequest(layer({ id: "temperature", kind: "metric", metricId: "temperature" }), "metric", "layer").role).toBe("weather");
    expect(officialFontRequest(layer({ id: "steps", kind: "metric", metricId: "steps" }), "metric", "layer").role).toBeUndefined();
    // For the whole face it's the time's digits, whatever layer it was opened from.
    expect(officialFontRequest(layer({ id: "weekday", kind: "weekday" }), "date", "face")).toEqual({ mode: "font", title: "Official COROS fonts", role: "time", frameCount: 10 });
  });

  it("a template image opens on its own category", () => {
    const request = officialImageRequest(layer({ id: "configAsset:config:bluetooth_on_icon", kind: "configAsset", configAssetId: "config:bluetooth_on_icon", label: "Bluetooth on" }));
    expect(request).toEqual({ mode: "image", title: "Official image for Bluetooth on", category: "status" });
    expect(officialImageRequest(layer({ id: "x", kind: "configAsset", configAssetId: "aod:config:time_hour_icon", label: "Hour hand" })).category).toBe("clock");
    expect(officialImageRequest(layer({ id: "x", kind: "configAsset", configAssetId: "config:mystery", label: "Mystery" }))).toEqual({ mode: "image", title: "Official image for Mystery" });
  });

  it("battery and weather ask for whole sets with the right number of states", () => {
    expect(officialQuery(officialBatteryRequest())).toEqual({ category: "battery", frames: "multi" });
    expect(officialQuery(officialWeatherRequest("day"))).toEqual({ category: "weather", frameCount: 41, configKey: "weather_icon_dir", frames: "multi" });
    expect(officialQuery(officialWeatherRequest("night"))).toEqual({ category: "weather", frameCount: 41, configKey: "weather_dark_icon_dir", frames: "multi" });
    expect(officialQuery(officialWeatherRequest("digits"))).toEqual({ category: "fonts", role: "weather", frameCount: 10, configKey: "weather_temp_font", frames: "multi" });
  });
});
