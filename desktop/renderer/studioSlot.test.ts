import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { blankWatchfaceDesign } from "../watchface/engine/watchfaceBlankStart";
import { deriveEditorLayers } from "../watchface/engine/watchfaceEditorModel";
import { deriveDesignDetails } from "../watchface/engine/watchfaceCompose";
import { detailsForCompositionMode, parseConfigPos } from "../watchface/engine/watchfaceStudio";
import { applyCorosWatchfaceConfigOverrides, stripBlankCorosWatchfaceConfigKeys } from "../watchface/archive/config";
import { addSlotField, libraryItems, type LibraryContext } from "./studioLibrary";
import { nudge, panelOf, replaceAsset, restoreAsset, setAsset, setBatteryStates, setScale } from "./studioEdits";
import { rowOf, rowsOf, setVisible, spotsOf, type Design, type EditorLayer, type FaceSource } from "./studioFace";
import {
  barometerPieces, iconOffsetOf, isSlotPart, nextSlotPreview, setIconOffset, setSlotPreview, setSlotType, setValueTint, showSlot, SLOT_STARTER, slotListed,
  SLOT_LABEL, slotImagePaths, slotOnFace, slotPreview, slotSelector, slotShared, slotTypes, valueTintOf,
} from "./studioSlot";

/**
 * A template at 800 and 416 shaped like COROS's editable ones. With `slot` it has the selectable slot: heart rate and
 * steps with icons, sunrise as hours and minutes round the shared colon, a battery choice with its level pictures and
 * the slot's Bluetooth pair, a floors group the template declares but leaves empty, and (with `aod`) heart rate on the
 * always-on screen (`"bare"`: an always-on screen with only the clock). Without, it has only the clock.
 */
function template(extra: { slot?: boolean; aod?: boolean | "bare"; blankIcon?: boolean; noBatteryArt?: boolean } = {}): CorosWatchfaceTemplateDetails {
  const resolution = (width: number) => {
    const directory = `watchface_${width}x${width}`;
    const s = width / 800, n = (v: number) => Math.round(v * s);
    const at = (x: number, y: number) => `{${n(x)},${n(y)}}`;
    const rect = (x0: number, y0: number, x1: number, y1: number) => `{${n(x0)},${n(y0)},${n(x1)},${n(y1)},hcenter|vcenter}`;
    const files = (folder: string, count: number, w = 18, h = 28) => Array.from({ length: count }, (_, i) => ({ path: `${directory}/${folder}/${String(i).padStart(2, "0")}.png`, width: n(w), height: n(h) }));
    const icon = (name: string, w = 40, h = 40) => ({ path: `${directory}/icon/${name}.png`, width: n(w), height: n(h) });
    const heart = { control_hr_icon: "icon\\hr.png", control_hr_icon_pos: at(0, 0), control_hr_rect: rect(50, 0, 200, 40), control_hr_font: "digits", control_hr_font_color: "" };
    return {
      directory, width, height: width,
      config: {
        background_icon: "background.png",
        time_hour_high_pos: at(150, 300), time_hour_low_pos: at(250, 300), time_minute_high_pos: at(450, 300), time_minute_low_pos: at(550, 300),
        time_hour_high_font: "digits", time_hour_low_font: "digits", time_minute_high_font: "digits", time_minute_low_font: "digits",
        ...(extra.slot ? {
          rect_control1_pos: at(300, 560), ...heart,
          control_step_icon: extra.blankIcon ? "" : "icon\\step.png", control_step_icon_pos: at(0, 0), control_step_rect: rect(50, 0, 200, 40), control_step_font: "digits",
          control_sunrise_icon: "icon\\sunrise.png", control_sunrise_icon_pos: at(0, 0), control_sunrise_hour_rect: rect(50, 0, 110, 40), control_sunrise_minute_rect: rect(130, 0, 200, 40), control_sunrise_font: "digits",
          control_colon_icon: "icon\\colon.png", control_negative_sign_icon: "icon\\minus.png",
          control_battery_icon_dir: "battery", control_battery_icon_pos: at(0, 0), control_battery_level_rect: rect(50, 0, 200, 40), control_battery_level_font: "digits",
          control_bluetooth_icon_pos: at(210, 0), control_bluetooth_on_icon: "icon\\c_bt_on.png", control_bluetooth_off_icon: "icon\\c_bt_off.png",
          control_floor_rect: "", control_floor_font: "",
        } : {}),
      },
      aodConfig: extra.aod ? { bg_color: "#000000", time_hour_high_pos: at(150, 300), time_hour_high_font: "digits", ...(extra.aod === true ? { rect_control1_pos: at(300, 560), ...heart } : {}) } : {},
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files: files("digits", 10) }, ...(extra.noBatteryArt ? [] : [{ folder: "battery", kind: "state", aod: false, files: files("battery", 12, 40, 24) }])],
      icons: [{ path: `${directory}/background.png`, width, height: width }, icon("hr"), icon("step"), icon("sunrise"), icon("colon", 8, 28), icon("minus", 12, 4), icon("c_bt_on"), icon("c_bt_off")],
    };
  };
  return { templateId: "slot-test", resolutions: [resolution(800), resolution(416)] } as unknown as CorosWatchfaceTemplateDetails;
}

const face = { width: 800, height: 800 };
const art = (width = 40, height = 40) => ({ dataUrl: "data:image/png;base64,AA==", width, height });
const sourceOf = (details: CorosWatchfaceTemplateDetails) => ({ details, baselines: {}, watch: {}, projectId: "p", loadAssets: async () => [] }) as unknown as FaceSource;
const blank = (details: CorosWatchfaceTemplateDetails) => blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, details);

/** A face as the editor sees it on Current. */
function view(details: CorosWatchfaceTemplateDetails, design: Design) {
  const all = deriveEditorLayers(details, design);
  const listed = all.filter((l) => l.present || l.kind === "background" || slotListed(l, design));
  const rows = rowsOf(listed, spotsOf(all));
  const ctx: LibraryContext = { details, layers: all, face };
  const types = slotTypes(details, design, "current", all);
  const type = (id: string) => types.find((t) => t.id === id)!;
  const slot = all.find((l) => l.kind === "complication")!;
  return { all, rows, ctx, types, type, slot, selector: slotSelector(details, design, types), item: libraryItems(design, ctx).find((i) => i.key === "slot") };
}
/** The config the build writes, per resolution, with disabled types' keys taken out. */
const built = (details: CorosWatchfaceTemplateDetails, design: Design) => deriveDesignDetails(details, design).previewDetails.resolutions.map((r) => r.config);
const controlKeys = (config: Record<string, string>, prefix: string) => Object.keys(config).filter((k) => k.startsWith(`control_${prefix}_`));
const on = (types: { id: string; on: boolean }[]) => types.filter((t) => t.on).map((t) => t.id);

describe("Add → Selectable data", () => {
  it("brings the template's slot back on a Start-blank face, with the template's types, and ticks the row", () => {
    const details = template({ slot: true });
    let design = blank(details);
    let v = view(details, design);
    expect(v.item).toMatchObject({ label: SLOT_LABEL, added: false, layerId: "complication", group: "activity" });
    expect(v.item?.bounds).toBeTruthy(); // the drop spot where the template keeps it
    expect(slotOnFace(v.all)).toBe(false);
    // One row for the slot in Add: never the engine's layer row, never its icons (the slot's Bluetooth pair is a spot of its own).
    const keys = libraryItems(design, v.ctx).map((i) => i.key);
    expect(keys.filter((k) => /complication|control_(?!bluetooth)/.test(k))).toEqual([]);

    design = addSlotField(design, v.ctx);
    v = view(details, design);
    expect(slotOnFace(v.all)).toBe(true);
    expect(v.item).toMatchObject({ added: true });
    // Start blank had switched the battery choice off; the rest are the template's.
    expect(on(v.types)).toEqual(["heartRate", "steps", "sunrise"]);
    expect(design.previewComplication).toBe("heartRate");
    expect(design.removedLayerIds).not.toContain("complication");
    expect(design.layoutOffsets?.complication).toBeUndefined(); // where the template has it
  });

  it("makes a slot on a template without one: three types to start, the keys in every size, where it is dropped", () => {
    const details = template();
    let design = blank(details);
    let v = view(details, design);
    expect(v.slot.present).toBe(false);
    expect(v.item).toMatchObject({ added: false });
    design = addSlotField(design, v.ctx, { x: 400, y: 650 });
    v = view(details, design);
    expect(on(v.types)).toEqual(SLOT_STARTER);
    expect(v.types.filter((t) => t.on).every((t) => !t.inTemplate)).toBe(true);
    expect(slotOnFace(v.all)).toBe(true);
    const b = v.slot.bounds!;
    expect([Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]).toEqual([400, 650]);
    for (const config of built(details, design)) {
      expect(parseConfigPos(config.rect_control1_pos)).not.toBeNull();
      for (const prefix of ["hr", "step", "kcal"]) {
        expect(config[`control_${prefix}_rect`]).toMatch(/^\{-?\d+,-?\d+,-?\d+,-?\d+,/);
        expect(config[`control_${prefix}_font`]).toBe("digits");
      }
      expect(controlKeys(config, "sunrise")).toEqual([]);
    }
    // Clear of what is on the face when it isn't dropped: the hours sit where Studio's slot would not.
    const placed = addSlotField(blank(details), view(details, blank(details)).ctx);
    expect(view(details, placed).slot.bounds).toBeTruthy();
  });

  it("builds: every key a type needs can be written into a template that never declared it", () => {
    for (const details of [template(), template({ slot: true })]) {
      let design = showSlot(blank(details), details, "current");
      for (const type of view(details, design).types) design = setSlotType(design, details, "current", type.id, true);
      design = replaceAsset(design, view(details, design).type("elevation").iconLayer!, art());
      design = setIconOffset(setIconOffset(design, "battery", 6, 0), "elevation", -30, 0);
      details.resolutions.forEach((resolution, i) => {
        const before = resolution.config, after = built(details, design)[i];
        const text = Object.entries(before).map(([k, value]) => `[${k}]=${value}`).join("\r\n");
        const changed = Object.fromEntries(Object.entries(after).filter(([k, value]) => before[k] !== value));
        const out = applyCorosWatchfaceConfigOverrides(text, changed);
        for (const key of ["rect_control1_pos", "control_battery_icon_pos", "control_battery_level_rect", "control_sunset_hour_rect", "control_temperature_rect", "control_barometer_up_icon", "control_elevation_icon_pos"]) {
          expect(out, key).toMatch(new RegExp(`\\[${key}\\]=\\S`));
        }
      });
    }
  });

  it("is offered in always-on only where the template has the slot there", () => {
    const withAod = detailsForCompositionMode(template({ slot: true, aod: true }), "aod");
    const without = detailsForCompositionMode(template({ slot: true, aod: "bare" }), "aod");
    const item = (details: CorosWatchfaceTemplateDetails) => libraryItems(makeDefaultDesign(), { details, layers: deriveEditorLayers(details, makeDefaultDesign()), face, mode: "aod" }).find((i) => i.key === "slot");
    expect(item(withAod)).toMatchObject({ added: true });
    expect(item(without)).toBeUndefined();
  });
});

describe("The slot's data types", () => {
  it("lists every type with what the face has for it", () => {
    const details = template({ slot: true });
    const v = view(details, makeDefaultDesign());
    expect(v.types.map((t) => t.id)).toEqual(["heartRate", "steps", "calories", "floors", "elevation", "barometer", "exercise", "sunrise", "sunset", "battery", "temperature"]);
    expect(on(v.types)).toEqual(["heartRate", "steps", "sunrise", "battery"]);
    expect(v.type("heartRate")).toMatchObject({ inTemplate: true, icon: "template", iconKey: "control_hr_icon", canOffset: true, blocked: null });
    expect(v.type("heartRate").iconPath).toBe("watchface_800x800/icon/hr.png");
    expect(v.type("battery")).toMatchObject({ icon: "states", iconKey: null });
    expect(v.type("sunrise")).toMatchObject({ split: true, sample: "6:30" });
    expect(v.type("calories")).toMatchObject({ on: false, inTemplate: false });
    expect(v.type("temperature").label).toBe("Sensor temperature");
    expect(v.type("temperature").note).toMatch(/Current weather/);
    // The date is a choice only where the template declares it.
    expect(v.types.some((t) => t.id === "date")).toBe(false);
  });

  it("turns a type on: the preview shows it and the build writes its keys in every size", () => {
    const details = template({ slot: true });
    const design = setSlotType(makeDefaultDesign(), details, "current", "calories", true);
    expect(design.controlComplicationEnabled).toEqual({ calories: true });
    expect(design.previewComplication).toBe("calories");
    expect(view(details, design).type("calories")).toMatchObject({ on: true, inTemplate: false });
    for (const config of built(details, design)) {
      expect(config.control_kcal_rect).toBe(config.control_hr_rect);
      expect(config.control_kcal_font).toBe("digits");
    }
  });

  it("turns a type off: every key of its group is gone, and the preview moves to one that is on", () => {
    const details = template({ slot: true });
    let design = setSlotPreview(makeDefaultDesign(), "sunrise");
    design = setSlotType(design, details, "current", "sunrise", false);
    expect(design.previewComplication).toBe("heartRate");
    for (const config of built(details, design)) expect(controlKeys(config, "sunrise")).toEqual([]);
    // Turning off a type that isn't previewed leaves the preview alone.
    expect(setSlotType(design, details, "current", "steps", false).previewComplication).toBe("heartRate");
  });

  it("turns the battery choice off with the keys the watch couples to it, and keeps the older flag", () => {
    const details = template({ slot: true });
    const design = setSlotType(makeDefaultDesign(), details, "current", "battery", false);
    expect(design.controlBatteryEnabled).toBe(false);
    for (const config of built(details, design)) {
      expect(controlKeys(config, "battery")).toEqual([]);
      expect(controlKeys(config, "bluetooth")).toEqual([]);
    }
  });

  it("writes the sensor temperature with its own minus sign, apart from the weather temperature", () => {
    const details = template({ slot: true });
    const design = setSlotType(makeDefaultDesign(), details, "current", "temperature", true);
    expect(design.metricStyles?.temperature).toEqual({ scale: 1 });
    expect(design.nativeData?.weather_temp).toBeUndefined();
    for (const config of built(details, design)) {
      expect(config.control_temperature_rect).toBeTruthy();
      expect(config.control_temperature_font).toBeTruthy();
      expect(config.control_temperature_negative_sign_icon).toBe("icon\\minus.png");
      expect(Object.keys(config).filter((k) => k.startsWith("weather_temp"))).toEqual([]);
    }
  });

  it("writes the barometer's direction branch only: three trend images, two value boxes and a decimal point", () => {
    const details = template({ slot: true });
    const design = setSlotType(makeDefaultDesign(), details, "current", "barometer", true);
    for (const config of built(details, design)) {
      for (const key of ["control_barometer_down_icon", "control_barometer_flat_icon", "control_barometer_up_icon", "control_barometer_integer_rect",
        "control_barometer_decimal_rect", "control_barometer_font", "control_barometer_icon_pos", "control_point_icon"]) expect(config[key], key).toBeTruthy();
      // COROS's compiler aborts on the static branch.
      expect(config.control_barometer_icon).toBeUndefined();
      expect(config.control_barometer_rect).toBeUndefined();
    }
    const v = view(details, design);
    expect(v.type("barometer")).toMatchObject({ on: true, icon: "trend" });
    const pieces = barometerPieces(v.all);
    expect(pieces.trends.map((t) => [t.id, t.label])).toEqual([["down", "Falling"], ["flat", "Steady"], ["up", "Rising"]]);
    expect(pieces.point?.key).toBe("control_point_icon");
    // One trend replaced: the other two stay Studio's arrows.
    const mine = replaceAsset(design, pieces.trends[2].layer, art());
    expect(mine.configAssetOverrides?.["config:control_barometer_up_icon"]?.replacement).toEqual(art());
    expect(mine.configAssetOverrides?.["config:control_barometer_down_icon"]).toBeUndefined();
  });

  it("shows a hidden slot again when a type is switched on", () => {
    const details = template({ slot: true });
    const hidden = blank(details);
    const design = setSlotType(hidden, details, "current", "steps", true);
    expect(design.layerVisibility?.complication).toBeUndefined();
    expect(slotOnFace(view(details, design).all)).toBe(true);
  });

  it("in always-on, only switches the types the always-on config carries", () => {
    const details = detailsForCompositionMode(template({ slot: true, aod: true }), "aod");
    const design = makeDefaultDesign();
    const types = slotTypes(details, design, "aod", deriveEditorLayers(details, design));
    expect(on(types)).toEqual(["heartRate"]);
    expect(types.find((t) => t.id === "steps")).toMatchObject({ on: false, blocked: "Not on this template's always-on screen" });
    expect(types.find((t) => t.id === "heartRate")?.blocked).toBeNull();
    const off = setSlotType(design, details, "aod", "heartRate", false);
    expect(on(slotTypes(details, off, "aod", deriveEditorLayers(details, off)))).toEqual([]);
    expect(showSlot(off, details, "aod").controlComplicationEnabled).toEqual({ heartRate: true });
  });
});

describe("A type's icon", () => {
  it("replaces, hides and restores the template's icon", () => {
    const details = template({ slot: true });
    let design = makeDefaultDesign();
    const layer = view(details, design).type("heartRate").iconLayer!;
    expect(layer.configAssetId).toBe("config:control_hr_icon");
    design = replaceAsset(design, layer, art(48, 48));
    expect(view(details, design).type("heartRate").icon).toBe("custom");
    expect(design.configAssetOverrides?.["config:control_hr_icon"]).toEqual({ enabled: true, replacement: art(48, 48) });
    design = setAsset(design, layer, { enabled: false });
    expect(view(details, design).type("heartRate").icon).toBe("hidden");
    design = restoreAsset(setAsset(design, layer, { enabled: true }), layer);
    expect(view(details, design).type("heartRate")).toMatchObject({ icon: "template", iconPath: "watchface_800x800/icon/hr.png" });
  });

  it("imports an icon for a type the template has none for, and warns until it has one", () => {
    const details = template({ slot: true });
    let design = setSlotType(makeDefaultDesign(), details, "current", "elevation", true);
    let v = view(details, design);
    expect(v.type("elevation")).toMatchObject({ on: true, icon: "none", canOffset: false });
    expect(v.selector.warnings.find((w) => w.kind === "noIcon")).toMatchObject({ ids: ["elevation"] });
    const layer = v.type("elevation").iconLayer!;
    expect(layer.configAssetId).toBe("config:control_elevation_icon");
    design = replaceAsset(design, layer, art());
    v = view(details, design);
    expect(v.type("elevation")).toMatchObject({ icon: "custom", canOffset: true });
    expect(v.selector.warnings.some((w) => w.kind === "noIcon")).toBe(false);
    for (const config of built(details, design)) {
      expect(config.control_elevation_icon).toBeTruthy();
      expect(parseConfigPos(config.control_elevation_icon_pos)).not.toBeNull();
    }
    // Taking the picture out again takes its key with it.
    design = restoreAsset(design, layer);
    expect(view(details, design).type("elevation").icon).toBe("none");
    for (const config of built(details, design)) expect(config.control_elevation_icon ?? "").toBe("");
  });

  it("moves the icon alone: the value stays, the offset scales with the watch", () => {
    const details = template({ slot: true });
    const design = setIconOffset(makeDefaultDesign(), "heartRate", -24, 8);
    expect(iconOffsetOf(design, "heartRate")).toEqual({ dx: -24, dy: 8 });
    const [large, small] = built(details, design);
    const [before, beforeSmall] = built(details, makeDefaultDesign());
    expect(parseConfigPos(large.control_hr_icon_pos)).toEqual({ x: -24, y: 8 });
    expect(parseConfigPos(small.control_hr_icon_pos)).toEqual({ x: Math.round(-24 * 0.52), y: Math.round(8 * 0.52) });
    expect(large.control_hr_rect).toBe(before.control_hr_rect);
    expect(small.control_hr_rect).toBe(beforeSmall.control_hr_rect);
    expect(large.control_step_icon_pos).toBe(before.control_step_icon_pos);
    // Back to nothing leaves nothing behind; a locked slot doesn't move.
    expect(setIconOffset(design, "heartRate", 0, 0).controlIconOffsets).toEqual({});
    expect(setIconOffset({ ...design, lockedLayerIds: ["complication"] }, "heartRate", 5, 5)).toMatchObject({ controlIconOffsets: { heartRate: { dx: -24, dy: 8 } } });
  });

  it("moving the slot moves icon and value together, by its one origin", () => {
    const details = template({ slot: true });
    const v = view(details, makeDefaultDesign());
    const moved = nudge(makeDefaultDesign(), v.slot as EditorLayer, 40, -20);
    const [large] = built(details, moved), [before] = built(details, makeDefaultDesign());
    expect(parseConfigPos(large.rect_control1_pos)).toEqual({ x: 340, y: 540 });
    expect(large.control_hr_icon_pos).toBe(before.control_hr_icon_pos);
    expect(large.control_hr_rect).toBe(before.control_hr_rect);
  });
});

describe("What every type shares", () => {
  it("tints the values, and clears the tint back to the face's colour", () => {
    const tinted = setValueTint(makeDefaultDesign(), "#53cba1");
    expect(tinted.selectableMetricStyle).toEqual({ scale: 1, color: "#53cba1" });
    expect(valueTintOf(tinted)).toBe("#53cba1");
    const cleared = setValueTint({ ...tinted, selectableMetricStyle: { ...tinted.selectableMetricStyle!, fontFamily: "Arial" } }, undefined);
    expect(cleared.selectableMetricStyle).toEqual({ scale: 1, fontFamily: "Arial" });
    expect(setValueTint(makeDefaultDesign(), undefined)).toEqual(makeDefaultDesign());
  });

  it("has the colon and the minus sign as pieces of the slot, replaceable and hideable", () => {
    const details = template({ slot: true });
    const v = view(details, makeDefaultDesign());
    const shared = slotShared(v.all);
    expect(shared.map((p) => p.key)).toEqual(["control_colon_icon", "control_negative_sign_icon"]);
    const design = setAsset(replaceAsset(makeDefaultDesign(), shared[0].layer, art(8, 28)), shared[1].layer, { enabled: false });
    expect(design.configAssetOverrides).toMatchObject({ "config:control_colon_icon": { enabled: true, replacement: art(8, 28) }, "config:control_negative_sign_icon": { enabled: false } });
    expect(slotShared(view(template(), makeDefaultDesign()).all)).toEqual([]);
    // Thumbnails come from the template's own files; a replaced or missing picture has no path.
    expect(slotImagePaths(details, makeDefaultDesign(), ["control_colon_icon", "control_negative_sign_icon", "control_point_icon"]))
      .toEqual({ control_colon_icon: "watchface_800x800/icon/colon.png", control_negative_sign_icon: "watchface_800x800/icon/minus.png" });
  });

  it("opens the slot's own panel, where the digits' font, size and spacing are", () => {
    const details = template({ slot: true });
    const v = view(details, makeDefaultDesign());
    expect(panelOf(v.slot as EditorLayer, makeDefaultDesign())).toBe("selectable");
    expect(v.slot.capabilities).toMatchObject({ position: true, color: true });
  });
});

describe("The battery choice", () => {
  it("takes its own level pictures and size, apart from the fixed battery icon", () => {
    const details = template({ slot: true });
    const v = view(details, makeDefaultDesign());
    const battery = v.all.find((l) => l.kind === "controlBatteryIcon")!;
    const states = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), art(44, 24)]));
    let design = setBatteryStates(makeDefaultDesign(), battery as EditorLayer, states);
    design = setScale(design, battery as EditorLayer, 1.5);
    expect(design.configAssetOverrides?.["config:control_battery_icon"]).toMatchObject({ enabled: true, ownSize: true, scale: 1.5 });
    expect(Object.keys(design.configAssetOverrides?.["config:control_battery_icon"]?.stateReplacements ?? {})).toHaveLength(12);
    expect(design.configAssetOverrides?.["config:battery_icon"]).toBeUndefined();
    expect(design.layerVisibility?.batteryIcon).toBeUndefined();
    for (const config of built(details, design)) expect(config.control_battery_icon_dir).toBe("cl_control_battery_icon");
    expect(restoreAsset(design, battery as EditorLayer).configAssetOverrides?.["config:control_battery_icon"]).toEqual({ enabled: true });
    // Its picture moves like any type's icon.
    const [large] = built(details, setIconOffset(design, "battery", 10, 0));
    expect(parseConfigPos(large.control_battery_icon_pos)).toEqual({ x: 10, y: 0 });
  });

  it("says when a face has the battery choice with nothing to draw beside the value", () => {
    const details = template({ noBatteryArt: true });
    const design = setSlotType(showSlot(blank(details), details, "current"), details, "current", "battery", true);
    const v = view(details, design);
    expect(v.type("battery")).toMatchObject({ on: true, icon: "none" });
    expect(v.selector.warnings.find((w) => w.kind === "noIcon")?.ids).toContain("battery");
    for (const config of built(details, design)) expect(config.control_battery_icon_dir).toBeUndefined();
    // A template that keeps battery pictures lends them to a slot Studio makes.
    const lent = template();
    expect(view(lent, setSlotType(showSlot(blank(lent), lent, "current"), lent, "current", "battery", true)).type("battery").icon).toBe("states");
  });
});

describe("Preview data", () => {
  it("draws the saved type while it is on, else the first that is", () => {
    const details = template({ slot: true });
    const v = view(details, setSlotPreview(makeDefaultDesign(), "sunrise"));
    expect(slotPreview(v.types, setSlotPreview(makeDefaultDesign(), "sunrise"))).toBe("sunrise");
    expect(slotPreview(v.types, setSlotPreview(makeDefaultDesign(), "calories"))).toBe("heartRate"); // off: not previewed
    expect(slotPreview([], makeDefaultDesign())).toBe("");
    expect(setSlotPreview(makeDefaultDesign(), "temperature").metricStyles?.temperature).toEqual({ scale: 1 });
  });

  it("steps round the types that are on, forward and back", () => {
    const v = view(template({ slot: true }), makeDefaultDesign());
    const seen: string[] = [];
    let at: string = "heartRate";
    for (let i = 0; i < 4; i += 1) { at = nextSlotPreview(v.types, at); seen.push(at); }
    expect(seen).toEqual(["steps", "sunrise", "battery", "heartRate"]);
    expect(nextSlotPreview(v.types, "heartRate", -1)).toBe("battery");
    expect(nextSlotPreview(v.types, "calories")).toBe("heartRate"); // from a type that is off: the first
    expect(nextSlotPreview([], "heartRate")).toBe("");
  });
});

describe("What the wearer gets", () => {
  it("lists the types that are on and complete, as the build writes them", () => {
    const details = template({ slot: true });
    const design = setSlotType(setSlotType(makeDefaultDesign(), details, "current", "calories", true), details, "current", "sunrise", false);
    expect(view(details, design).selector.listed.map((t) => t.label)).toEqual(["Heart rate", "Steps", "Calories", "Battery"]);
  });

  it("never leaves an empty control group: a type that is off loses the blank keys its template declared", () => {
    const details = template({ slot: true });
    // The template declares floors with nothing in it: off (as it opens), the keys are deleted, not left blank.
    for (const design of [makeDefaultDesign(), blank(details), showSlot(blank(details), details, "current")]) {
      for (const config of built(details, design)) {
        expect(controlKeys(config, "floor")).toEqual([]);
        expect(Object.entries(config).filter(([k, value]) => k.startsWith("control_") && !k.endsWith("_font_color") && !value.trim())).toEqual([]);
      }
      expect(view(details, design).selector.warnings.some((w) => w.kind === "blank")).toBe(false);
    }
    // On, it gets real keys.
    const floors = setSlotType(makeDefaultDesign(), details, "current", "floors", true);
    for (const config of built(details, floors)) {
      expect(config.control_floor_rect).toMatch(/^\{\d+,/);
      expect(config.control_floor_font).toBe("digits");
    }
    // And with everything off there is no control key left at all.
    let none = makeDefaultDesign();
    for (const id of ["heartRate", "steps", "sunrise", "battery"] as const) none = setSlotType(none, details, "current", id, false);
    for (const config of built(details, none)) expect(Object.keys(config).filter((k) => /^control_(?!colon|negative)/.test(k))).toEqual([]);
    expect(view(details, none).selector.warnings.map((w) => w.kind)).toEqual(["empty"]);
  });

  it("warns about a key the template leaves empty on a type that is on, until blank keys are stripped", () => {
    const details = template({ slot: true, blankIcon: true });
    const v = view(details, makeDefaultDesign());
    expect(v.type("steps")).toMatchObject({ on: true, icon: "none" });
    expect(v.selector.warnings.find((w) => w.kind === "blank")).toMatchObject({ ids: ["steps"] });
    expect(v.selector.warnings.find((w) => w.kind === "blank")?.text).toMatch(/^Steps has an empty key/);
    // Found in the smaller watch tree too, and never for the empty keys templates ship outside the types.
    const small = template({ slot: true });
    small.resolutions[1].config.control_hr_icon = "";
    small.resolutions[1].config.control_percent_icon = "";
    expect(view(small, makeDefaultDesign()).selector.warnings.find((w) => w.kind === "blank")).toMatchObject({ ids: ["heartRate"] });
    const stripped = { ...makeDefaultDesign(), stripBlankConfigKeys: true };
    expect(slotSelector(details, stripped, v.types).warnings.some((w) => w.kind === "blank")).toBe(false);
    // What stripping does to the file: the empty declaration is gone, the rest of the group stays.
    const text = Object.entries(built(details, makeDefaultDesign())[0]).map(([k, value]) => `[${k}]=${value}`).join("\n");
    const out = stripBlankCorosWatchfaceConfigKeys(text);
    expect(out).not.toMatch(/\[control_step_icon\]=/);
    expect(out).toMatch(/\[control_step_rect\]=\{/);
  });
});

describe("Layers and older faces", () => {
  it("keeps the slot's icons, colon, minus and battery pictures out of the layer list, and leads their ids to the slot", () => {
    const details = template({ slot: true });
    const v = view(details, setSlotType(makeDefaultDesign(), details, "current", "barometer", true));
    expect(v.rows.filter((r) => isSlotPart(r))).toEqual([]);
    expect(v.rows.filter((r) => r.kind === "complication").map((r) => r.label)).toEqual([SLOT_LABEL]);
    // The data-slot Bluetooth pair is still its own spot.
    expect(v.rows.some((r) => r.spot?.id === "bluetoothOff")).toBe(true);
    for (const id of ["configAsset:config:control_hr_icon", "configAsset:config:control_barometer_up_icon", "configAsset:config:control_colon_icon", "controlBatteryIcon"]) {
      expect(rowOf(v.rows, id)?.id, id).toBe("complication");
    }
    expect(rowOf(v.rows, "configAsset:config:control_bluetooth_on_icon")?.spot?.id).toBe("bluetoothOff");
  });

  it("stays listed with every type off, so its panel can turn one back on; hidden from Add's point of view", () => {
    const details = template({ slot: true });
    let design = makeDefaultDesign();
    for (const id of ["heartRate", "steps", "sunrise", "battery"] as const) design = setSlotType(design, details, "current", id, false);
    const v = view(details, design);
    expect(v.slot.present).toBe(false);
    expect(v.rows.find((r) => r.kind === "complication")).toMatchObject({ visible: false });
    expect(v.item).toMatchObject({ added: false });
    // A face that never had the slot doesn't list it.
    expect(view(template(), blank(template())).rows.some((r) => r.kind === "complication")).toBe(false);
  });

  it("hides and shows the slot from its row without touching its types", () => {
    const details = template({ slot: true });
    const v = view(details, makeDefaultDesign());
    const hidden = setVisible(makeDefaultDesign(), v.slot as EditorLayer, false, sourceOf(details));
    expect(hidden.layerVisibility?.complication).toBe(false);
    expect(hidden.controlComplicationEnabled ?? {}).toEqual({});
    expect(on(view(details, hidden).types)).toEqual(["heartRate", "steps", "sunrise", "battery"]);
    expect(slotOnFace(view(details, hidden).all)).toBe(false);
  });

  it("opens a face saved by an older Studio or CorosLink the same", () => {
    const details = template({ slot: true });
    const saved: Design = { ...makeDefaultDesign(), controlBatteryEnabled: false, controlSunriseEnabled: false, previewComplication: "steps",
      controlIconOffsets: { steps: { dx: 4, dy: 0 } }, configAssetOverrides: { "config:control_hr_icon": { enabled: true, replacement: art() } } };
    const v = view(details, saved);
    expect(on(v.types)).toEqual(["heartRate", "steps"]);
    expect(slotPreview(v.types, saved)).toBe("steps");
    expect(v.type("heartRate").icon).toBe("custom");
    expect(iconOffsetOf(saved, "steps")).toEqual({ dx: 4, dy: 0 });
    for (const config of built(details, saved)) { expect(controlKeys(config, "battery")).toEqual([]); expect(controlKeys(config, "sunrise")).toEqual([]); }
    // Reading the slot changes nothing in the design; a new switch wins over the old flag.
    expect(JSON.stringify(saved)).toBe(JSON.stringify({ ...saved }));
    expect(on(view(details, setSlotType(saved, details, "current", "sunrise", true)).types)).toEqual(["heartRate", "steps", "sunrise"]);
  });
});
