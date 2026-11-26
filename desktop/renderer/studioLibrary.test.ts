import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { blankWatchfaceDesign } from "../watchface/engine/watchfaceBlankStart";
import { deriveEditorLayers } from "../watchface/engine/watchfaceEditorModel";
import { nativeDataBounds } from "../watchface/engine/nativeData";
import { chartPageFillers, chartSourceOf } from "../watchface/engine/chartReadouts";
import { NATIVE_DATA_BY_ID, NATIVE_DATA_FIELDS, nativeFieldKeys, nativeStatePositionKey } from "../watchface/watchfaceNativeCatalog";
import {
  addAnalogHands, addAnimation, addBatteryField, addChartPageField, addDatePart, addImage, addNativeField, addNegativeSign, addSeconds, addShape,
  addStatusField, canRemove, chartPagesOnFace, deleteLayer, freeSpot, HOUR_HAND_LAYER, imageLayerId, libraryItems, NEGATIVE_SIGN_LAYER, newImage, newShape,
  removeLayer, restoreTemplateLayer, searchLibrary, shapeLayerId, type LibraryContext,
} from "./studioLibrary";
import { faceLayers, groupOf, setVisible, type FaceSource } from "./studioFace";
import { isLocked, setLocked } from "./studioEdits";
import { deriveDesignDetails } from "../watchface/engine/watchfaceCompose";
import { resolveWatchfaceModeDesign } from "../watchface/engine/watchfaceDisplayModes";
import { panelOf } from "./studioEdits";

/** A small template: time, heart rate and the day, at 800 and 416. */
function template(): CorosWatchfaceTemplateDetails {
  const resolution = (width: number) => {
    const directory = `watchface_${width}x${width}`;
    const s = width / 800, at = (x: number, y: number) => `${Math.round(x * s)},${Math.round(y * s)}`;
    const files = (folder: string, n: number) => Array.from({ length: n }, (_, i) => ({ path: `${directory}/${folder}/${String(i).padStart(2, "0")}.png`, width: 18, height: 28 }));
    return {
      directory, width, height: width,
      config: {
        background_icon: "background.png",
        time_hour_high_pos: `{${at(150, 300)}}`, time_hour_low_pos: `{${at(250, 300)}}`,
        time_minute_high_pos: `{${at(450, 300)}}`, time_minute_low_pos: `{${at(550, 300)}}`,
        time_hour_high_font: "digits", time_hour_low_font: "digits", time_minute_high_font: "digits", time_minute_low_font: "digits",
        heartreate_level_rect: `{${at(100, 600)},${at(250, 650)},0}`, heartreate_level_font: "digits",
        english_date_day_rect: `{${at(500, 600)},${at(600, 650)},0}`, english_date_day_font: "digits",
        // Every DIY template declares the analog keys, usually blank.
        time_hour_icon: "", time_minute_icon: "", time_second_icon: "", time_center_polygon_icon2: "",
      },
      aodConfig: {},
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files: files("digits", 10) }],
      icons: [{ path: `${directory}/background.png`, width, height: width }],
    };
  };
  return { templateId: "library-test", resolutions: [resolution(800), resolution(416)] } as unknown as CorosWatchfaceTemplateDetails;
}

const details = template();
const face = { width: 800, height: 800 };
const ctxFor = (design: ReturnType<typeof makeDefaultDesign>): LibraryContext => ({ details, layers: deriveEditorLayers(details, design), face });
const blank = () => blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, details);

describe("Add → Live data", () => {
  it("offers every native field the catalog knows, min and max as one row, the chart as pages", () => {
    const keys = libraryItems(blank(), ctxFor(blank())).map((i) => i.key);
    for (const field of NATIVE_DATA_FIELDS) {
      if (field.kind === "chart" || field.id === "weather_temp_max") continue;
      expect(keys).toContain(`native:${field.id}`);
    }
    expect(keys).not.toContain("native:weather_temp_max");
    expect(keys.filter((k) => k.startsWith("chart:"))).toEqual(["chart:bars", "chart:sun", "chart:moon", "chart:daily-a", "chart:daily-b"]);
  });

  it("lists the template's hidden heart rate, and status images and a battery icon the template lacks", () => {
    const items = libraryItems(blank(), ctxFor(blank()));
    const heart = items.find((i) => i.key === "layer:heartRate")!;
    expect(heart).toMatchObject({ group: "health", added: false, icon: "heart" });
    expect(heart.bounds).toBeTruthy();
    expect(items.filter((i) => i.key.startsWith("status:")).map((i) => i.label)).toEqual(["Bluetooth", "Do Not Disturb"]);
    expect(items.find((i) => i.key === "battery")).toMatchObject({ group: "device", layerId: "batteryIcon" });
  });

  it("groups the rows like the design's library", () => {
    const by = Object.fromEntries(libraryItems(blank(), ctxFor(blank())).map((i) => [i.key, i.group]));
    expect(by).toMatchObject({
      "native:date_year": "time", "native:lunar_day": "time", "native:weather_temp": "weather", "native:sunriseset": "weather",
      "native:stress": "health", "native:week_run": "training", "chart:sun": "charts", "status:bluetooth_off_icon": "device",
    });
  });

  it("marks what is experimental, unconfirmed or unavailable, as CorosLink does", () => {
    const by = Object.fromEntries(libraryItems(blank(), ctxFor(blank())).map((i) => [i.key, i]));
    expect(by["native:weather_aqi"].tag).toBe("Not available");
    expect(by["chart:daily-a"].tag).toBe("Experimental");
    expect(by["native:stress"].tag).toBe("Not confirmed");
    // The lunar date only shows while the watch speaks Chinese; the tile says so.
    expect(by["native:lunar_day"].hint).toMatch(/Chinese/);
    expect(by["native:weather_temp"].tag).toBeUndefined();
  });

  it("searches by label, id and category", () => {
    const items = libraryItems(blank(), ctxFor(blank()));
    expect(searchLibrary(items, "heart").map((i) => i.key)).toContain("layer:heartRate");
    expect(searchLibrary(items, "tide").map((i) => i.key)).toEqual(["chart:bars"]);
    expect(searchLibrary(items, "low high").map((i) => i.key)).toEqual(["native:weather_temp_min"]);
    expect(searchLibrary(items, "zzz")).toEqual([]);
  });
});

describe("adding to a blank face", () => {
  it("puts a native field on the face where nothing else is, and lists it as on the face", () => {
    const design = blank();
    const ctx = ctxFor(design);
    const next = addNativeField(design, "stress", ctx);
    expect(next.nativeData?.stress?.enabled).toBe(true);
    const box = nativeDataBounds("stress", next.nativeData!)!;
    const r = 400 * 0.9;
    for (const [x, y] of [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]]) expect(Math.hypot(x - 400, y - 400)).toBeLessThanOrEqual(r + 1);
    expect(libraryItems(next, ctxFor(next)).find((i) => i.key === "native:stress")?.added).toBe(true);
    const layer = deriveEditorLayers(details, next).find((l) => l.id === "native:stress")!;
    expect(layer.visible).toBe(true);
    expect(groupOf(layer)).toBe("health");
  });

  it("hides and shows an added field the way the engine does", () => {
    const design = addNativeField(blank(), "stress", ctxFor(blank()));
    const layer = deriveEditorLayers(details, design).find((l) => l.id === "native:stress")!;
    const source = { details } as FaceSource;
    const hidden = setVisible(design, layer, false, source);
    expect(hidden.nativeData?.stress?.enabled).toBe(false);
    expect(deriveEditorLayers(details, hidden).find((l) => l.id === "native:stress")?.visible).toBe(false);
    expect(setVisible(hidden, layer, true, source).nativeData?.stress?.enabled).toBe(true);
    // Without the template at hand too.
    expect(setVisible(design, layer, false).nativeData?.stress?.enabled).toBe(false);
  });

  it("places a dropped field centred on the drop point", () => {
    const next = addNativeField(blank(), "sleep_score", ctxFor(blank()), { x: 400, y: 200 });
    const box = nativeDataBounds("sleep_score", next.nativeData!)!;
    expect(Math.round((box.x0 + box.x1) / 2)).toBeCloseTo(400, -1);
    expect(Math.round((box.y0 + box.y1) / 2)).toBeCloseTo(200, -1);
  });

  it("keeps a second field clear of the first", () => {
    let design = addNativeField(blank(), "stress", ctxFor(blank()));
    design = addNativeField(design, "stamina", ctxFor(design));
    const a = nativeDataBounds("stress", design.nativeData!)!, b = nativeDataBounds("stamina", design.nativeData!)!;
    expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
  });

  it("adds minimum and maximum temperature together: the watch draws neither alone", () => {
    const next = addNativeField(blank(), "weather_temp_min", ctxFor(blank()));
    expect(next.nativeData?.weather_temp_min?.enabled).toBe(true);
    expect(next.nativeData?.weather_temp_max?.enabled).toBe(true);
  });

  it("current weather takes the weather icon's temperature over", () => {
    const design = { ...blank(), weatherIndicator: { enabled: true, x: 0, y: 0, scale: 1, temperatureEnabled: true } };
    expect(addNativeField(design, "weather_temp", ctxFor(design)).weatherIndicator?.temperatureEnabled).toBe(false);
  });

  it("brings back a template layer Start blank removed", () => {
    const design = blank();
    expect(design.removedLayerIds).toContain("heartRate");
    const heart = deriveEditorLayers(details, design).find((l) => l.id === "heartRate")!;
    const next = restoreTemplateLayer(design, heart, details, "current", { x: 400, y: 500 });
    expect(next.removedLayerIds).not.toContain("heartRate");
    const shown = deriveEditorLayers(details, next).find((l) => l.id === "heartRate")!;
    expect(shown.visible).toBe(true);
    expect(Math.round((shown.bounds!.y0 + shown.bounds!.y1) / 2)).toBe(500);
  });

  it("adds a status image with Studio's artwork inside the dial", () => {
    const art = { dataUrl: "data:image/png;base64,AA==", width: 40, height: 56 };
    const next = addStatusField(blank(), "bluetooth_off_icon", art, ctxFor(blank()), undefined, () => ({ x: 144, y: 176 }));
    expect(next.configAssetOverrides?.["config:bluetooth_off_icon"]).toMatchObject({ enabled: true, replacement: art });
    const layer = deriveEditorLayers(details, next).find((l) => l.id === "configAsset:config:bluetooth_off_icon")!;
    expect(layer.present).toBe(true);
    const b = layer.bounds!;
    for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y1]]) expect(Math.hypot(x - 400, y - 400)).toBeLessThanOrEqual(400);
    expect(libraryItems(next, ctxFor(next)).some((i) => i.key === "status:bluetooth_off_icon")).toBe(false);
  });

  it("moves a new status image off data the template's fallback spot would cover", () => {
    const art = { dataUrl: "data:image/png;base64,AA==", width: 40, height: 56 };
    const design = blank();
    const plain = addStatusField(design, "bluetooth_off_icon", art, ctxFor(design));
    const at = deriveEditorLayers(details, plain).find((l) => l.id === "configAsset:config:bluetooth_off_icon")!.bounds!;
    // A field right where the fallback puts it.
    const covered = { ...design, nativeData: { stress: { enabled: true, x: at.x0, y: at.y0, scale: 1, color: "#ffffff" } } };
    const moved = addStatusField(covered, "bluetooth_off_icon", art, ctxFor(covered), undefined, () => ({ x: 144, y: 176 }));
    const b = deriveEditorLayers(details, moved).find((l) => l.id === "configAsset:config:bluetooth_off_icon")!.bounds!;
    expect([b.x0, b.y0]).toEqual([144, 176]);
  });

  it("adds a twelve-state battery icon to a template without one", () => {
    const states = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), { dataUrl: "data:image/png;base64,AA==", width: 60, height: 30 }]));
    const next = addBatteryField(blank(), states);
    expect(Object.keys(next.configAssetOverrides?.["config:battery_icon"]?.stateReplacements ?? {})).toHaveLength(12);
    expect(next.layerVisibility?.batteryIcon).toBe(true);
    expect(libraryItems(next, ctxFor(next)).some((i) => i.key === "battery")).toBe(false);
  });
});

describe("chart pages", () => {
  it("a chart started from the sun page draws a line, not the barometer bars", () => {
    const next = addChartPageField(blank(), "sun", ctxFor(blank()));
    const chart = next.nativeData!.chart!;
    expect(chartSourceOf(chart)).toBe("chart_sunrise");
    expect(chart.chartStyle?.barWidth).toBe(0);
    expect(chartPagesOnFace(next, details)).toEqual(["sun"]);
  });

  it("a daily page brings all three of its readouts, which the firmware needs to keep the page", () => {
    const next = addChartPageField(blank(), "daily-b", ctxFor(blank()));
    const chart = next.nativeData!.chart!;
    const sources = [chartSourceOf(chart), ...Object.keys(chart.readouts ?? {})];
    expect(sources.sort()).toEqual(["chart_heart_rate", "chart_kcal", "chart_step"]);
    expect(chartPageFillers(sources)).toEqual([]);
  });

  it("more pages join the one chart", () => {
    let design = addChartPageField(blank(), "daily-a", ctxFor(blank()));
    design = addChartPageField(design, "moon", ctxFor(design));
    design = addChartPageField(design, "bars", ctxFor(design));
    expect(chartPagesOnFace(design, details)).toEqual(["barometer", "tide", "moon", "daily-a"]);
    const items = libraryItems(design, ctxFor(design));
    expect(items.filter((i) => i.key.startsWith("chart:") && i.added).map((i) => i.key).sort()).toEqual(["chart:bars", "chart:daily-a", "chart:moon"]);
  });

  it("a page the face took off comes back when added", () => {
    let design = addChartPageField(blank(), "sun", ctxFor(blank()));
    design = { ...design, chartPageModes: { sun: "removed" } };
    expect(chartPagesOnFace(design, details)).toEqual([]);
    design = addChartPageField(design, "sun", ctxFor(design));
    expect(design.chartPageModes).toBeUndefined();
  });
});

describe("firmware rules the library relies on (CorosLink's Must not regress)", () => {
  it("stress art is placed by stress_level_icon_pos", () => {
    const stress = NATIVE_DATA_BY_ID.get("stress")!;
    expect(nativeStatePositionKey(stress)).toBe("stress_level_icon_pos");
    expect(nativeFieldKeys(stress)).toContain("stress_level_icon_pos");
    expect(nativeFieldKeys(stress)).not.toContain("stress_level_pos");
  });

  it("the lunar date writes only the Chinese tables, Simplified and Traditional", () => {
    for (const id of ["lunar_year", "lunar_month", "lunar_day"]) {
      const keys = nativeFieldKeys(NATIVE_DATA_BY_ID.get(id)!);
      expect(keys.every((k) => /^chinese_(tw_)?lunar_/.test(k))).toBe(true);
      expect(keys.some((k) => k.startsWith("chinese_tw_lunar_"))).toBe(true);
    }
  });

  it("the barometer field is the native one, never the selectable control's static branch", () => {
    expect(nativeFieldKeys(NATIVE_DATA_BY_ID.get("baro")!).some((k) => k.startsWith("control_barometer"))).toBe(false);
  });
});

describe("freeSpot", () => {
  it("is the middle of an empty face, and clear of what's there", () => {
    expect(freeSpot({ width: 100, height: 50 }, face, [])).toEqual({ x: 350, y: 375 });
    const spot = freeSpot({ width: 100, height: 50 }, face, [{ x0: 300, y0: 300, x1: 500, y1: 500 }]);
    expect(spot.x + 100 <= 300 || spot.x >= 500 || spot.y + 50 <= 300 || spot.y >= 500).toBe(true);
  });
});

// ───── Building a face up from Start blank: artwork, time and date parts, the negative sign, an animation ─────

const png = (width: number, height: number) => ({ dataUrl: "data:image/png;base64,AA==", width, height });
/** The library as the editor sets it up: the face's own layers (shapes included), the display and the watch's width. */
const built = (design: ReturnType<typeof blank>, mode: "current" | "aod" = "current"): LibraryContext => ({ details, layers: faceLayers(details, design), face, mode, watchWidth: 416 });
const layerOf = (design: ReturnType<typeof blank>, id: string) => faceLayers(details, design).find((l) => l.id === id);
const source = { details } as FaceSource;
/** What the archive build reads for the 800 tree: the template's config with the design's own keys. */
const exported = (design: ReturnType<typeof blank>) => deriveDesignDetails(details, design).previewDetails.resolutions[0].config;
const hands = () => ({ time_hour_icon: png(800, 800), time_minute_icon: png(800, 800), time_second_icon: png(800, 800), time_center_polygon_icon2: png(800, 800) });
/** Hidden with the eye and shown again, the way the Layers panel does it. */
function hidesAndShows(design: ReturnType<typeof blank>, id: string) {
  const hidden = setVisible(design, layerOf(design, id)!, false, source);
  expect(layerOf(hidden, id)?.visible).toBe(false);
  expect(layerOf(setVisible(hidden, layerOf(hidden, id)!, true, source), id)?.visible).toBe(true);
  return hidden;
}

describe("Add → Artwork, time and date on a blank face", () => {
  it("offers artwork first, the parts Studio makes, the negative sign and an animation", () => {
    const items = libraryItems(blank(), built(blank()));
    expect(items.slice(0, 5).map((i) => i.label)).toEqual(["Image", "Text", "Rectangle", "Ellipse", "Line"]);
    expect(items.slice(0, 5).every((i) => i.repeat && !i.added)).toBe(true);
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by["time:seconds"]).toMatchObject({ group: "time", added: false, layerId: "seconds" });
    expect(by["time:analog"]).toMatchObject({ group: "time", added: false, layerId: HOUR_HAND_LAYER });
    // The template draws the day itself, so only the weekday and the month are Studio's to add.
    expect(Object.keys(by).filter((k) => k.startsWith("date:"))).toEqual(["date:weekday", "date:dateMonth"]);
    expect(by.sign).toMatchObject({ group: "device", label: "Negative sign" });
    expect(by.animation).toMatchObject({ group: "device", label: "Animation" });
    expect(searchLibrary(items, "circle").map((i) => i.key)).toEqual(["art:ellipse"]);
    expect(searchLibrary(items, "hands").map((i) => i.key)).toEqual(["time:analog"]);
  });

  it("always-on gets artwork and hands, but no Studio seconds, date parts or animation", () => {
    const keys = libraryItems(blank(), built(blank(), "aod")).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["art:text", "time:analog", "sign"]));
    expect(keys.filter((k) => k === "time:seconds" || k.startsWith("date:") || k === "animation")).toEqual([]);
  });

  it.each(["text", "rect", "ellipse", "line"] as const)("adds a %s in the middle, selectable, with its own inspector", (kind) => {
    const design = blank();
    const shape = newShape(design, kind, built(design));
    const next = addShape(design, shape);
    const layer = layerOf(next, shapeLayerId(shape.id))!;
    expect(layer).toMatchObject({ kind: "backgroundElement", present: true, visible: true });
    expect(groupOf(layer)).toBe("basic");
    expect(panelOf(layer, next)).toBe(kind === "text" ? "text" : "shape");
    const b = layer.bounds!;
    expect(Math.abs((b.x0 + b.x1) / 2 - 400)).toBeLessThanOrEqual(kind === "line" ? 100 : 60);
    expect(Math.abs((b.y0 + b.y1) / 2 - 400)).toBeLessThanOrEqual(60);
    expect(next.artworkLayerOrder?.at(-1)).toBe(layer.id);
    // The undo step can run twice: the same shape goes on once.
    expect(addShape(next, shape).backgroundElements).toHaveLength(1);
    expect(design.backgroundElements ?? []).toHaveLength(0);
    hidesAndShows(next, layer.id);
    // Each click adds another one: the row is never ticked.
    expect(libraryItems(next, built(next)).find((i) => i.key === `art:${kind}`)?.added).toBe(false);
  });

  it("puts a second shape clear of the first, and a dropped one where it lands", () => {
    let design = blank();
    const first = newShape(design, "rect", built(design));
    design = addShape(design, first);
    const second = newShape(design, "rect", built(design));
    design = addShape(design, second);
    const a = layerOf(design, shapeLayerId(first.id))!.bounds!, b = layerOf(design, shapeLayerId(second.id))!.bounds!;
    expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
    const dropped = newShape(design, "ellipse", built(design), { x: 600, y: 250 });
    expect([dropped.x, dropped.y]).toEqual([600, 250]);
  });

  it("adds an image one pixel per watch pixel, front of the artwork, and fits a big one to the face", () => {
    const design = blank();
    const sprite = newImage(design, png(104, 52), "pic", built(design));
    const next = addImage(design, sprite);
    // 104 watch pixels on a 416 watch are 200 on the 800 master.
    expect(sprite).toMatchObject({ sourceWidth: 104, width: 200, height: 100, scale: 1, x: 400, y: 400 });
    const layer = layerOf(next, imageLayerId("pic"))!;
    expect(layer).toMatchObject({ kind: "customSprite", visible: true });
    expect(panelOf(layer, next)).toBe("sprite");
    expect(next.artworkLayerOrder).toEqual(["sprite:pic"]);
    expect(addImage(next, sprite).designSprites).toHaveLength(1);
    hidesAndShows(next, layer.id);
    const big = newImage(design, png(1600, 1200), "big", built(design));
    expect(big.width * big.scale).toBeCloseTo(800);
    const at = newImage(design, png(104, 52), "at", built(design), { x: 300, y: 600 });
    expect([at.x, at.y]).toEqual([300, 600]);
  });

  it("refuses a thirteenth image", () => {
    let design = blank();
    for (let i = 0; i < 12; i++) design = addImage(design, newImage(design, png(10, 10), `p${i}`, built(design), { x: 400, y: 400 }));
    expect(() => newImage(design, png(10, 10), "p12", built(design))).toThrow(/12/);
  });

  it("lists artwork in paint order, front first, above the background", () => {
    let design = blank();
    const rect = newShape(design, "rect", built(design));
    design = addShape(design, rect);
    design = addImage(design, newImage(design, png(10, 10), "pic", built(design)));
    const text = newShape(design, "text", built(design));
    design = addShape(design, text);
    const ids = faceLayers(details, design).map((l) => l.id);
    expect(ids.slice(-4)).toEqual([shapeLayerId(text.id), "sprite:pic", shapeLayerId(rect.id), "background"]);
  });

  it("removes artwork for good; template layers only hide", () => {
    let design = blank();
    const rect = newShape(design, "rect", built(design));
    design = addImage(addShape(design, rect), newImage(design, png(10, 10), "pic", built(design)));
    for (const id of [shapeLayerId(rect.id), "sprite:pic"]) {
      const layer = layerOf(design, id)!;
      expect(canRemove(design, layer, built(design))).toBe(true);
      design = removeLayer(design, layer, built(design));
      expect(layerOf(design, id)).toBeUndefined();
    }
    expect(design.artworkLayerOrder).toEqual([]);
    expect(canRemove(design, layerOf(design, "hours")!, built(design))).toBe(false);
  });

  // CorosLink must-not-regress: Delete unlocks a locked layer it deletes; template parts don't delete.
  it("deletes artwork and unlocks it on the way", () => {
    let design = blank();
    const rect = newShape(design, "rect", built(design));
    design = addShape(design, rect);
    const layer = layerOf(design, shapeLayerId(rect.id))!;
    design = setLocked(design, layer, true);
    expect(isLocked(design, layer)).toBe(true);
    const next = deleteLayer(design, layer, built(design));
    expect(layerOf(next, shapeLayerId(rect.id))).toBeUndefined();
    expect(next.lockedLayerIds).not.toContain(layer.id);
  });

  it("deletes live data from Add, minimum and maximum together", () => {
    let design = addNativeField(blank(), "sleep_score", built(blank()));
    design = addNativeField(design, "weather_temp_min", built(design));
    const sleep = layerOf(design, "native:sleep_score")!;
    expect(canRemove(design, sleep, built(design))).toBe(true);
    design = deleteLayer(setLocked(design, sleep, true), sleep, built(design));
    expect(layerOf(design, "native:sleep_score")).toBeUndefined();
    expect(design.lockedLayerIds ?? []).not.toContain("native:sleep_score");
    design = deleteLayer(design, layerOf(design, "native:weather_temp_max")!, built(design));
    expect(design.nativeData?.weather_temp_min).toBeUndefined();
    expect(design.nativeData?.weather_temp_max).toBeUndefined();
  });

  it("leaves a template part to its eye", () => {
    const design = setLocked(blank(), layerOf(blank(), "hours")!, true);
    expect(deleteLayer(design, layerOf(design, "hours")!, built(design))).toBe(design);
  });

  it("adds seconds from the minute digits, at half size, under the minutes", () => {
    const design = blank();
    const next = addSeconds(design, built(design));
    expect(next).toMatchObject({ addSeconds: true, timeStyles: { seconds: { scale: 0.5 } } });
    const layer = layerOf(next, "seconds")!;
    expect(layer).toMatchObject({ kind: "seconds", present: true, visible: true, timePartId: "seconds" });
    expect(groupOf(layer)).toBe("time");
    expect(panelOf(layer, next)).toBe("time");
    expect(exported(next)).toMatchObject({ time_second_high_font: "digits", time_second_low_font: "digits" });
    expect(exported(next).time_second_high_pos).toMatch(/^\{\d+,\d+\}$/);
    expect(exported(design).time_second_high_pos).toBeUndefined();
    expect(libraryItems(next, built(next)).find((i) => i.key === "time:seconds")?.added).toBe(true);
    // No second row for the same layer once it is hidden.
    const hidden = hidesAndShows(next, "seconds");
    const rows = libraryItems(hidden, built(hidden)).filter((i) => i.layerId === "seconds");
    expect(rows.map((i) => [i.key, i.added])).toEqual([["time:seconds", false]]);
    // Adding again brings hidden seconds back where they were.
    expect(layerOf(addSeconds(hidden, built(hidden)), "seconds")?.bounds).toEqual(layer.bounds);
  });

  it("drops seconds where they land, and Remove seconds takes them off", () => {
    const design = blank();
    const next = addSeconds(design, built(design), { x: 400, y: 600 });
    const b = layerOf(next, "seconds")!.bounds!;
    expect([Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]).toEqual([400, 600]);
    expect(canRemove(next, layerOf(next, "seconds")!, built(next))).toBe(true);
    const removed = removeLayer(next, layerOf(next, "seconds")!, built(next));
    expect(removed).toMatchObject({ addSeconds: false });
    expect(removed.timeStyles?.seconds).toBeUndefined();
    expect(removed.layoutOffsets?.seconds).toBeUndefined();
    expect(layerOf(removed, "seconds")?.present ?? false).toBe(false);
    expect(exported(removed).time_second_high_pos).toBeUndefined();
  });

  it("adds a weekday drawn from a font and a month from the template's digits", () => {
    let design = blank();
    design = addDatePart(design, "weekday", built(design));
    design = addDatePart(design, "dateMonth", built(design));
    expect(design).toMatchObject({ addWeekday: true, addDateMonth: true, dateStyles: { weekday: { fontFamily: "Arial", nativeSize: true } } });
    for (const id of ["weekday", "dateMonth"]) {
      const layer = layerOf(design, id)!;
      expect(layer).toMatchObject({ present: true, visible: true });
      expect(groupOf(layer)).toBe("time");
      expect(panelOf(layer, design)).toBe("date");
    }
    expect(exported(design).english_date_week_rect).toBeTruthy();
    expect(exported(design).english_date_month_font).toBe("digits");
    const a = layerOf(design, "weekday")!.bounds!, b = layerOf(design, "dateMonth")!.bounds!;
    expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
    expect(libraryItems(design, built(design)).filter((i) => i.key.startsWith("date:")).map((i) => i.added)).toEqual([true, true]);
    const hidden = hidesAndShows(design, "weekday");
    expect(libraryItems(hidden, built(hidden)).filter((i) => i.layerId === "weekday").map((i) => [i.key, i.added])).toEqual([["date:weekday", false]]);
    const removed = removeLayer(design, layerOf(design, "weekday")!, built(design));
    expect(removed.addWeekday).toBe(false);
    expect(exported(removed).english_date_week_rect).toBeUndefined();
  });

  it("keeps a face font for the weekday, and never adds a part the template draws itself", () => {
    const design = { ...blank(), fontFamily: "Avenir Next" };
    expect(addDatePart(design, "weekday", built(design)).dateStyles?.weekday?.fontFamily).toBe("Avenir Next");
    expect(addDatePart(design, "dateDay", built(design))).toBe(design);
    expect(addSeconds(design, built(design, "aod"))).toBe(design);
  });

  it("adds four analog hands with Studio's artwork; always-on gets no second hand", () => {
    const root = { ...blank(), modeDesigns: { aod: { ...blank(), backgroundColor: "#000000" } } } as ReturnType<typeof blank>;
    const next = addAnalogHands(root, "current", details, hands);
    const current = resolveWatchfaceModeDesign(next, "current"), aod = resolveWatchfaceModeDesign(next, "aod");
    expect(Object.keys(current.configAssetOverrides ?? {}).sort()).toEqual(["config:time_center_polygon_icon2", "config:time_hour_icon", "config:time_minute_icon", "config:time_second_icon"]);
    expect(Object.keys(aod.configAssetOverrides ?? {}).sort()).toEqual(["config:time_center_polygon_icon2", "config:time_hour_icon", "config:time_minute_icon"]);
    const hour = layerOf(current, HOUR_HAND_LAYER)!;
    expect(hour).toMatchObject({ kind: "configAsset", present: true, visible: true });
    expect(panelOf(hour, current)).toBe("image");
    expect(exported(current).time_hour_icon).toMatch(/\.png$/);
    expect(exported(current).time_second_icon).toMatch(/\.png$/);
    expect(libraryItems(current, built(current)).find((i) => i.key === "time:analog")?.added).toBe(true);
    // Hidden, the hand leaves the face and the row adds it again with the same artwork.
    const hidden = setVisible(current, hour, false, source);
    expect(libraryItems(hidden, built(hidden)).find((i) => i.key === "time:analog")?.added).toBe(true);
    const noMinute = setVisible(hidden, layerOf(hidden, "configAsset:config:time_minute_icon")!, false, source);
    expect(libraryItems(noMinute, built(noMinute)).find((i) => i.key === "time:analog")?.added).toBe(false);
    const again = addAnalogHands(noMinute, "current", details, () => { throw new Error("kept artwork is not drawn again"); }).configAssetOverrides!;
    expect(again["config:time_hour_icon"]).toMatchObject({ enabled: true, replacement: hands().time_hour_icon });
  });

  it("adds hands to always-on alone when that is the display being edited", () => {
    const root = { ...blank(), modeDesigns: { aod: { ...blank() } } } as ReturnType<typeof blank>;
    const next = addAnalogHands(root, "aod", details, hands);
    expect(resolveWatchfaceModeDesign(next, "current").configAssetOverrides?.["config:time_hour_icon"]).toBeUndefined();
    expect(resolveWatchfaceModeDesign(next, "aod").configAssetOverrides?.["config:time_hour_icon"]?.enabled).toBe(true);
  });

  it("adds a negative sign to a template without one", () => {
    const design = blank();
    const next = addNegativeSign(design, png(14, 6));
    expect(layerOf(next, NEGATIVE_SIGN_LAYER)).toMatchObject({ present: true, visible: true });
    expect(exported(next).negative_sign_icon).toMatch(/\.png$/);
    expect(libraryItems(next, built(next)).some((i) => i.key === "sign")).toBe(false);
    hidesAndShows(next, NEGATIVE_SIGN_LAYER);
  });

  it("adds an animation centred on the face, one delay a frame, and offers it once", () => {
    const design = blank();
    const next = addAnimation(design, { frames: ["a", "b", "c"], width: 200, height: 100 }, built(design));
    expect(next.animation).toMatchObject({ enabled: true, x: 300, y: 350, width: 200, height: 100, delays: [100, 100, 100] });
    const layer = layerOf(next, "animation")!;
    expect(layer).toMatchObject({ kind: "animation", present: true, visible: true });
    expect(panelOf(layer, next)).toBe("animation");
    expect(libraryItems(next, built(next)).some((i) => i.key === "animation")).toBe(false);
    hidesAndShows(next, "animation");
    expect(addAnimation(design, { frames: ["a"], width: 200, height: 100 }, built(design), { x: 500, y: 500 }).animation).toMatchObject({ x: 400, y: 450 });
    expect(addAnimation(design, { frames: [], width: 0, height: 0 }, built(design))).toBe(design);
  });

  it("leaves the design it started from untouched, so every add is one undo step", () => {
    const design = blank();
    const before = JSON.stringify(design);
    const ctx = built(design);
    addSeconds(design, ctx); addDatePart(design, "weekday", ctx); addShape(design, newShape(design, "text", ctx));
    addImage(design, newImage(design, png(10, 10), "pic", ctx)); addAnalogHands(design, "current", details, hands);
    addNegativeSign(design, png(14, 6)); addAnimation(design, { frames: ["a"], width: 10, height: 10 }, ctx);
    expect(JSON.stringify(design)).toBe(before);
  });

  it("a face built up from blank exports every part's config together", () => {
    let design = blank();
    design = addShape(design, newShape(design, "text", built(design)));
    design = addShape(design, newShape(design, "rect", built(design)));
    design = addImage(design, newImage(design, png(104, 52), "pic", built(design)));
    design = addSeconds(design, built(design));
    design = addAnalogHands(design, "current", details, hands);
    design = addDatePart(design, "weekday", built(design));
    const config = exported(design);
    for (const key of ["time_second_high_pos", "time_second_low_pos", "english_date_week_rect", "time_hour_icon", "time_minute_icon", "time_second_icon", "time_center_polygon_icon2"]) expect(config[key]).toBeTruthy();
    const shown = faceLayers(details, design).filter((l) => l.present && l.visible).map((l) => l.kind);
    expect(shown).toEqual(expect.arrayContaining(["seconds", "weekday", "configAsset", "customSprite", "backgroundElement", "background"]));
  });
});
