import { describe, expect, it } from "vitest";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import type { EditorLayer } from "../watchface/engine/watchfaceEditorModel";
import {
  addShadow, addStroke, align, assetKey, canMove, distribute, nudge, panelOf, replaceAsset, restoreAsset, setLocked, isLocked, setStrokes,
  setTypo, shadowsOf, strokesOf, typoOf, isPercentLayer, percentOf, setPercent, resizeBy, canResize,
} from "./studioEdits";

const base = () => ({ ...makeDefaultDesign(), staticSeparators: { colon: { enabled: true, x: 400, y: 300, size: 80, color: "#ffffff" }, dateSlash: { enabled: false, x: 0, y: 0, size: 20, color: "#ffffff" } } });

function layer(partial: Partial<EditorLayer> & { id: string }): EditorLayer {
  return {
    kind: "time", label: partial.id, visible: true, canHide: true, present: true,
    bounds: { id: partial.id, label: partial.id, x0: 100, y0: 100, x1: 200, y1: 160 },
    capabilities: { position: true, color: true, scale: true, font: true, stroke: true, effects: true },
    ...partial,
  };
}

describe("studio inspector edits", () => {
  it("opens the panel each kind of layer needs", () => {
    const d = base();
    expect(panelOf(layer({ id: "hours", timePartId: "hours" }), d)).toBe("time");
    expect(panelOf(layer({ id: "heartRate", kind: "metric", metricId: "heartRate" }), d)).toBe("metric");
    expect(panelOf(layer({ id: "weekday", kind: "weekday" }), d)).toBe("date");
    expect(panelOf(layer({ id: "native:weather_temp", kind: "metric", nativeDataId: "weather_temp" }), d)).toBe("native");
    expect(panelOf(layer({ id: "native:chart", kind: "metric", nativeDataId: "chart" }), d)).toBe("chart");
    expect(panelOf(layer({ id: "configAsset:config:bt_icon", kind: "configAsset", configAssetId: "config:bt_icon" }), d)).toBe("image");
    expect(panelOf(layer({ id: "background", kind: "background" }), d)).toBe("background");
  });

  it("resizes from a canvas corner through whatever sizes the layer", () => {
    const d = base();
    const colon = layer({ id: "staticColon", kind: "separators", staticSeparatorId: "colon", capabilities: { position: true, color: true, scale: true, font: false } });
    expect(resizeBy(d, colon, 1.5, null)!.staticSeparators.colon.size).toBe(120);
    expect(canResize(d, colon, null)).toBe(true);
    expect(canResize(setLocked(d, colon, true), colon, null)).toBe(false);
    const shape = layer({ id: "el", kind: "configAsset", backgroundElementId: "r1" });
    const withRect = { ...d, backgroundElements: [{ id: "r1", kind: "rect" as const, x: 0, y: 0, rotation: 0, width: 100, height: 40, cornerRadius: 0, fill: "#fff" }] };
    expect(resizeBy(withRect, shape, 0.5, null)!.backgroundElements![0]).toMatchObject({ width: 50, height: 20 });
    expect(resizeBy(d, layer({ id: "x", kind: "configAsset" }), 2, null)).toBeNull();
  });

  it("resizes the template's own PNG weekday by its box", () => {
    const d = { ...base(), fontFamily: "", dateStyles: {} } as ReturnType<typeof base>;
    const files = Array.from({ length: 7 }, (_, i) => ({ path: `w/${i}.png`, width: 60, height: 24 }));
    const resolution = { config: { english_date_week_font: "w" }, spriteFolders: [{ folder: "w", kind: "week", files }] } as never;
    const weekday = layer({ id: "weekday", kind: "weekday" });
    const big = resizeBy(d, weekday, 1.5, resolution)!;
    expect(big.dateStyles?.weekday).toMatchObject({ width: 90, height: 36 });
    expect(canResize(d, weekday, resolution)).toBe(true);
  });

  it("moves a layer wherever the design keeps its place", () => {
    let d = base();
    const hours = layer({ id: "hours", timePartId: "hours", layoutGroupId: "hours" });
    d = nudge(nudge(d, hours, 4, -2), hours, 1, 1);
    expect(d.layoutOffsets.hours).toEqual({ dx: 5, dy: -1 });
    const colon = layer({ id: "staticColon", kind: "separators", staticSeparatorId: "colon", capabilities: { position: true, color: true, scale: true, font: false } });
    expect(canMove(colon)).toBe(true);
    expect(nudge(d, colon, 10, 0).staticSeparators.colon.x).toBe(410);
    const fixed = layer({ id: "x", kind: "configAsset", capabilities: { position: false, color: false, scale: false, font: false } });
    expect(canMove(fixed)).toBe(false);
    expect(nudge(d, fixed, 10, 10)).toBe(d);
  });

  it("aligns one layer to the face and several to each other", () => {
    const a = layer({ id: "a", layoutGroupId: "a", bounds: { id: "a", label: "a", x0: 100, y0: 100, x1: 200, y1: 160 } });
    const b = layer({ id: "b", layoutGroupId: "b", bounds: { id: "b", label: "b", x0: 300, y0: 400, x1: 340, y1: 420 } });
    expect(align(base(), [a], "centerX", 800).layoutOffsets.a).toEqual({ dx: 250, dy: 0 });
    const both = align(base(), [a, b], "left", 800);
    expect(both.layoutOffsets.a).toBeUndefined();
    expect(both.layoutOffsets.b).toEqual({ dx: -200, dy: 0 });
  });

  it("spaces three layers evenly", () => {
    const at = (id: string, x0: number) => layer({ id, layoutGroupId: id, bounds: { id, label: id, x0, y0: 0, x1: x0 + 20, y1: 20 } });
    const d = distribute(base(), [at("a", 0), at("b", 30), at("c", 100)], "x");
    expect(d.layoutOffsets.b).toEqual({ dx: 20, dy: 0 });
  });

  it("writes typography where CorosLink keeps it", () => {
    const hours = layer({ id: "hours", timePartId: "hours" });
    const d = setTypo(base(), hours, { fontWeight: 700, letterSpacing: 0.1 });
    expect(d.timeStyles.hours).toMatchObject({ scale: 1, fontWeight: 700, letterSpacing: 0.1 });
    expect(typoOf(d, hours)?.fontWeight).toBe(700);
    const metric = layer({ id: "steps", kind: "metric", metricId: "steps" });
    const sized = setTypo(setTypo(base(), metric, { fontSize: 40 }), metric, { fontSize: undefined });
    expect("fontSize" in sized.metricStyles.steps).toBe(false);
  });

  it("keeps stroke and shadow stacks per layer", () => {
    const hours = layer({ id: "hours", timePartId: "hours" });
    let d = addShadow(addStroke(base(), hours), hours);
    expect(strokesOf(d, hours)).toHaveLength(1);
    expect(shadowsOf(d, hours)[0]).toMatchObject({ kind: "outer-shadow", blur: 12, distance: 8 });
    d = setStrokes(d, hours, []);
    expect(d.layerStrokes?.hours).toBeUndefined();
  });

  it("a colon picture turns the drawn colon off, and restoring keeps visibility", () => {
    const colonImage = layer({ id: "configAsset:config:colon_icon", kind: "configAsset", configAssetId: "config:colon_icon" });
    expect(assetKey(colonImage)).toBe("config:colon_icon");
    let d = replaceAsset(base(), colonImage, { dataUrl: "data:image/png;base64,", width: 8, height: 40 });
    expect(d.staticSeparators.colon.enabled).toBe(false);
    d = restoreAsset(d, colonImage);
    expect(d.configAssetOverrides?.["config:colon_icon"]).toEqual({ enabled: true });
    expect(assetKey(layer({ id: "batteryIcon", kind: "batteryIcon" }))).toBe("config:battery_icon");
  });

  it("locks and unlocks", () => {
    const l = layer({ id: "hours" });
    const d = setLocked(base(), l, true);
    expect(isLocked(d, l)).toBe(true);
    expect(isLocked(setLocked(d, l, false), l)).toBe(false);
  });

  it("keeps the battery %'s look on the battery style and drops what follows the digits", () => {
    const percent = layer({ id: "configAsset:config:battery_level_percent_icon", kind: "configAsset", configAssetId: "config:battery_level_percent_icon" });
    expect(isPercentLayer(percent)).toBe(true);
    expect(isPercentLayer(layer({ id: "configAsset:aod:battery_level_percent_icon", kind: "configAsset", configAssetId: "aod:battery_level_percent_icon" }))).toBe(true);
    expect(isPercentLayer(layer({ id: "configAsset:config:bt_icon", kind: "configAsset", configAssetId: "config:bt_icon" }))).toBe(false);
    let d = setTypo(base(), layer({ id: "battery", kind: "metric", metricId: "battery" }), { color: "#ff0000" });
    d = setPercent(d, { color: "#00ff00", size: 0.6, gap: 6, align: "top" });
    expect(percentOf(d)).toEqual({ color: "#00ff00", size: 0.6, gap: 6, align: "top" });
    expect(d.metricStyles.battery?.color).toBe("#ff0000");
    d = setPercent(d, { color: undefined, size: 1, gap: 0, align: "middle" });
    expect(percentOf(d)).toEqual({});
    expect(d.metricStyles.battery).toEqual({ scale: 1, color: "#ff0000" });
  });
});
