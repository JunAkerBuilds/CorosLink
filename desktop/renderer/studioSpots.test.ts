import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { blankWatchfaceDesign } from "../watchface/engine/watchfaceBlankStart";
import { deriveEditorLayers } from "../watchface/engine/watchfaceEditorModel";
import { deriveDesignDetails } from "../watchface/engine/watchfaceCompose";
import { applyConfigOverridesToDetails, buildDisabledWatchfaceConfigAssetOverrides, parseConfigPos } from "../watchface/engine/watchfaceStudio";
import { addStatusField, libraryItems, type LibraryContext } from "./studioLibrary";
import { align, isLocked, nudge, setLocked, setSpotScale, setStrokes, strokesOf } from "./studioEdits";
import { movingWith, snapTargets } from "./studioDrag";
import {
  grouped, hiddenSpotKeys, rowOf, rowsOf, setVisible, spotActive, spotKeyOf, spotOf, spotPicked, spotsOf, type Design, type FaceSource,
} from "./studioFace";

/**
 * The status keys of two real templates, at 800 and 416: COROS's PACE Pro template 2609181 (Bluetooth off and Do Not
 * Disturb on, the other states blank) and, with `sleep`, the recovered community face "Cube" (a sleep-mode image at
 * the Do Not Disturb place). `slot` adds the on / off pairs some templates keep inside the selectable data slot.
 */
function template(extra: { sleep?: boolean; slot?: boolean } = {}): CorosWatchfaceTemplateDetails {
  const resolution = (width: number) => {
    const directory = `watchface_${width}x${width}`;
    const s = width / 800, at = (x: number, y: number) => `{${Math.round(x * s)},${Math.round(y * s)}}`;
    const icon = (name: string, w = 34, h = 48) => ({ path: `${directory}/icon/${name}.png`, width: Math.round(w * s), height: Math.round(h * s) });
    return {
      directory, width, height: width,
      config: {
        background_icon: "background.png",
        time_hour_high_pos: at(150, 300), time_hour_low_pos: at(250, 300), time_minute_high_pos: at(450, 300), time_minute_low_pos: at(550, 300),
        time_hour_high_font: "digits", time_hour_low_font: "digits", time_minute_high_font: "digits", time_minute_low_font: "digits",
        bluetooth_icon_pos: at(121, 593), bluetooth_on_icon: "", bluetooth_off_icon: "icon\\bt_on.png",
        no_disturb_icon_pos: at(182, 593), no_disturb_on_icon: "icon\\Do_not_disturb.png", no_disturb_off_icon: "",
        ...(extra.sleep ? { sleep_mode_icon: "icon\\sleep.png" } : {}),
        ...(extra.slot ? {
          rect_control1_pos: at(300, 500), control_bluetooth_icon_pos: at(10, 10),
          control_bluetooth_on_icon: "icon\\c_bt_on.png", control_bluetooth_off_icon: "icon\\c_bt_off.png",
        } : {}),
      },
      aodConfig: {},
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files: Array.from({ length: 10 }, (_, i) => ({ path: `${directory}/digits/0${i}.png`, width: 18, height: 28 })) }],
      icons: [{ path: `${directory}/background.png`, width, height: width }, icon("bt_on"), icon("Do_not_disturb", 44, 44), icon("sleep", 60, 40), icon("c_bt_on"), icon("c_bt_off")],
    };
  };
  return { templateId: "spots-test", resolutions: [resolution(800), resolution(416)] } as unknown as CorosWatchfaceTemplateDetails;
}

const face = { width: 800, height: 800 };
const art = (width = 40, height = 56) => ({ dataUrl: "data:image/png;base64,AA==", width, height });
const id = (key: string) => `configAsset:config:${key}`;
const sourceOf = (details: CorosWatchfaceTemplateDetails) => ({ details, baselines: {}, watch: {}, projectId: "p", loadAssets: async () => [] }) as unknown as FaceSource;

/** A face as the editor sees it: every layer, the ones on the face, its spots and its rows. */
function view(details: CorosWatchfaceTemplateDetails, design: Design, choice: Record<string, string> = {}) {
  const all = deriveEditorLayers(details, design);
  const spots = spotsOf(all);
  const rows = rowsOf(all.filter((l) => l.present || l.kind === "background"), spots, choice);
  const ctx: LibraryContext = { details, layers: all, face };
  const spot = (name: string) => spots.find((s) => s.id === name)!;
  const row = (name: string) => rows.find((r) => r.spot?.id === name)!;
  const at = (key: string) => all.find((l) => l.id === id(key))!;
  return { all, spots, rows, ctx, spot, row, at };
}
const corner = (b: { x0: number; y0: number } | null | undefined) => (b ? [b.x0, b.y0] : null);

describe("Images that share a place on the watch are one spot", () => {
  it("lists one Bluetooth row and one Do Not Disturb row on a template, with their states inside", () => {
    const details = template({ sleep: true });
    const v = view(details, makeDefaultDesign());
    expect(v.spots.map((s) => [s.id, s.label])).toEqual([["bluetoothStatus", "Bluetooth"], ["doNotDisturbStatus", "Do Not Disturb"]]);
    expect(v.spot("bluetoothStatus").states.map((s) => [s.label, s.layer.present])).toEqual([["On", false], ["Off", true], ["Airplane mode", false]]);
    expect(v.spot("doNotDisturbStatus").states.map((s) => [s.label, s.layer.present])).toEqual([["On", true], ["Off", false], ["Sleep mode", true]]);
    // One row each, under the spot's name, in Status; none of the images is a row of its own.
    const status = grouped(v.rows).find((g) => g.id === "device")!.layers;
    expect(status.map((l) => l.label)).toEqual(expect.arrayContaining(["Bluetooth", "Do Not Disturb"]));
    expect(v.rows.filter((r) => r.spot)).toHaveLength(2);
    expect(v.rows.filter((r) => !r.spot && spotKeyOf(r.id))).toEqual([]);
    // The row is the state the watch shows first, and any of the spot's images leads back to it.
    expect(v.row("doNotDisturbStatus").id).toBe(id("no_disturb_on_icon"));
    expect(rowOf(v.rows, id("sleep_mode_icon"))).toBe(v.row("doNotDisturbStatus"));
    expect(spotOf(v.spots, id("sleep_mode_icon"))?.id).toBe("doNotDisturbStatus");
  });

  it("groups the on / off pair inside the selectable data slot too", () => {
    const v = view(template({ slot: true }), makeDefaultDesign());
    const slot = v.spots.find((s) => s.id === "bluetoothOff");
    expect(slot?.states.map((s) => s.label)).toEqual(["On", "Off"]);
    expect(slot?.canAdd).toBe(false);
  });

  it("has no spots on a Start-blank face until a status image is added, then one row however many states", () => {
    const details = template();
    let design = blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, details);
    expect(view(details, design).rows.filter((r) => r.spot && r.visible)).toEqual([]);
    for (const key of ["bluetooth_off_icon", "bluetooth_on_icon", "airplane_icon"]) {
      design = addStatusField(design, key, art(), view(details, design).ctx, undefined, () => ({ x: 144, y: 176 }));
    }
    const v = view(details, design);
    const rows = v.rows.filter((r) => r.spot?.id === "bluetoothStatus");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Bluetooth", visible: true });
    expect(v.spot("bluetoothStatus").states.map((s) => s.layer.present && s.layer.visible)).toEqual([true, true, true]);
    // Every state sits at the spot's one corner.
    const corners = v.spot("bluetoothStatus").states.map((s) => corner(s.layer.bounds));
    expect(new Set(corners.map(String)).size).toBe(1);
  });

  it("offers one Add tile per indicator, airplane and sleep mode inside them", () => {
    const details = template({ sleep: true });
    const design = makeDefaultDesign();
    const device = (d: Design) => libraryItems(d, view(details, d).ctx).filter((i) => i.group === "device" && /Bluetooth|Disturb|Airplane|Sleep/.test(i.label));
    expect(device(design).map((i) => [i.label, i.added])).toEqual([["Bluetooth", true], ["Do Not Disturb", true]]);
    expect(device(design).map((i) => i.icons)).toEqual([["bt", "btOff", "plane"], ["moon", "moonOff", "bed"]]);
    // Hidden with the eye, each comes back from its one tile.
    const hidden = setVisible(design, view(details, design).row("doNotDisturbStatus"), false, sourceOf(details));
    expect(device(hidden).map((i) => [i.label, i.added])).toEqual([["Bluetooth", true], ["Do Not Disturb", false]]);
    // A Start-blank face offers two, not four.
    const blank = blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, details);
    expect(device(blank).map((i) => [i.label, i.added])).toEqual([["Bluetooth", false], ["Do Not Disturb", false]]);
  });

  it("adds a state into a spot that has been moved, where the spot is", () => {
    const details = template();
    let design = makeDefaultDesign();
    design = nudge(design, view(details, design).row("bluetoothStatus"), 200, -300);
    const before = corner(view(details, design).row("bluetoothStatus").bounds);
    design = addStatusField(design, "airplane_icon", art(), view(details, design).ctx, undefined, () => ({ x: 5, y: 5 }));
    const v = view(details, design, { bluetoothStatus: "airplane_icon" });
    expect(corner(v.at("airplane_icon").bounds)).toEqual(before);
    expect(v.row("bluetoothStatus").id).toBe(id("airplane_icon"));
  });

  it("moves every state with one edit: drag, nudge and align", () => {
    const details = template({ sleep: true });
    const start = makeDefaultDesign();
    const v = view(details, start);
    const row = v.row("doNotDisturbStatus");
    const moved = nudge(start, row, 30, -12);
    const after = view(details, moved);
    for (const key of ["no_disturb_on_icon", "sleep_mode_icon"]) {
      expect(corner(after.at(key).bounds)).toEqual([v.at(key).bounds!.x0 + 30, v.at(key).bounds!.y0 - 12]);
    }
    // One offset for the spot: one undo step, nothing per image.
    expect(moved.layoutOffsets).toEqual({ ...start.layoutOffsets, doNotDisturbStatus: { dx: 30, dy: -12 } });
    // A drag lifts the other states with the row, and they aren't snap targets of their own.
    const lifted = movingWith(sourceOf(details), start, "current", [row]).map((l) => l.id);
    expect(lifted).toEqual(expect.arrayContaining([id("no_disturb_on_icon"), id("sleep_mode_icon")]));
    expect(snapTargets(v.rows, new Set([row.id])).filter((t) => spotKeyOf(t.id)?.spot === "doNotDisturbStatus")).toEqual([]);
    expect(snapTargets(v.rows, new Set()).filter((t) => spotKeyOf(t.id))).toHaveLength(2);
    // Align to the face's left edge takes all of them.
    const left = view(details, align(start, [row], "left", 800));
    expect(left.at("no_disturb_on_icon").bounds!.x0).toBe(0);
    expect(left.at("sleep_mode_icon").bounds!.x0).toBe(0);
  });

  it("hides, shows and locks the whole spot from its row", () => {
    const details = template({ sleep: true });
    const source = sourceOf(details);
    const start = makeDefaultDesign();
    const row = view(details, start).row("doNotDisturbStatus");
    const hidden = setVisible(start, row, false, source, "current");
    const h = view(details, hidden);
    expect(h.spot("doNotDisturbStatus").states.filter((s) => s.layer.present).map((s) => s.layer.visible)).toEqual([false, false]);
    expect(h.row("doNotDisturbStatus")).toMatchObject({ visible: false, present: true });
    expect(hidden.configAssetOverrides).toMatchObject({ "config:no_disturb_on_icon": { enabled: false }, "config:sleep_mode_icon": { enabled: false } });
    const shown = view(details, setVisible(hidden, h.row("doNotDisturbStatus"), true, source, "current"));
    expect(shown.row("doNotDisturbStatus").visible).toBe(true);
    expect(shown.spot("doNotDisturbStatus").states.filter((s) => s.layer.present).every((s) => s.layer.visible)).toBe(true);

    const locked = setLocked(start, row, true);
    expect(locked.lockedLayerIds).toEqual(expect.arrayContaining([id("no_disturb_on_icon"), id("no_disturb_off_icon"), id("sleep_mode_icon")]));
    // Locked whichever state is showing.
    expect(isLocked(locked, view(details, locked, { doNotDisturbStatus: "sleep_mode_icon" }).row("doNotDisturbStatus"))).toBe(true);
    expect(setLocked(locked, row, false).lockedLayerIds).toEqual([]);
  });

  it("switches one state off on its own, and the row follows the state picked", () => {
    const details = template({ sleep: true });
    const source = sourceOf(details);
    const start = makeDefaultDesign();
    const v = view(details, start);
    const off = setVisible(start, v.at("sleep_mode_icon"), false, source, "current");
    const o = view(details, off, { doNotDisturbStatus: "sleep_mode_icon" });
    expect(o.at("no_disturb_on_icon").visible).toBe(true);
    expect(o.at("sleep_mode_icon").visible).toBe(false);
    // Still one visible row; its box falls back to a state that shows, so it can be picked on the watch.
    expect(o.row("doNotDisturbStatus")).toMatchObject({ visible: true, id: id("sleep_mode_icon") });
    expect(o.row("doNotDisturbStatus").bounds).toBeTruthy();

    // The preview draws one state per spot: the picked one, else the first the face shows.
    expect(spotActive(v.spot("doNotDisturbStatus")).key).toBe("no_disturb_on_icon");
    expect(spotActive(v.spot("doNotDisturbStatus"), { doNotDisturbStatus: "sleep_mode_icon" }).key).toBe("sleep_mode_icon");
    // A state the face has no image for falls back on the watch, and the inspector still opens it (to add one).
    expect(spotActive(v.spot("doNotDisturbStatus"), { doNotDisturbStatus: "no_disturb_off_icon" }).key).toBe("no_disturb_on_icon");
    expect(spotPicked(v.spot("doNotDisturbStatus"), { doNotDisturbStatus: "no_disturb_off_icon" }).key).toBe("no_disturb_off_icon");
    const hiddenKeys = hiddenSpotKeys(v.spots, { doNotDisturbStatus: "sleep_mode_icon" });
    expect(hiddenKeys).toEqual(expect.arrayContaining(["no_disturb_on_icon", "no_disturb_off_icon", "bluetooth_on_icon", "airplane_icon"]));
    expect(hiddenKeys).not.toContain("sleep_mode_icon");
    expect(hiddenKeys).not.toContain("bluetooth_off_icon");
  });

  it("keeps one size and one look for the spot", () => {
    const details = template({ sleep: true });
    const start = makeDefaultDesign();
    const row = view(details, start).row("doNotDisturbStatus");
    const sized = setSpotScale(start, row, 1.5);
    expect(sized.configAssetOverrides).toMatchObject({ "config:no_disturb_on_icon": { scale: 1.5 }, "config:sleep_mode_icon": { scale: 1.5 } });
    expect(sized.configAssetOverrides?.["config:no_disturb_off_icon"]).toBeUndefined();
    const stroke = [{ id: "s", enabled: true, color: "#000000", width: 2, opacity: 1, position: "outside" }] as never;
    const stroked = setStrokes(start, row, stroke);
    expect(Object.keys(stroked.layerStrokes ?? {})).toEqual(["doNotDisturbStatus"]);
    expect(strokesOf(stroked, view(details, stroked, { doNotDisturbStatus: "sleep_mode_icon" }).row("doNotDisturbStatus"))).toHaveLength(1);
  });

  it("builds a config with every state's image at the one position key, in every resolution", () => {
    const details = template({ sleep: true });
    let design = makeDefaultDesign();
    design = addStatusField(design, "bluetooth_on_icon", art(), view(details, design).ctx);
    design = nudge(design, view(details, design).row("bluetoothStatus"), 80, -40);
    design = nudge(design, view(details, design).row("doNotDisturbStatus"), -16, 24);
    const built = deriveDesignDetails(details, design).previewDetails;
    for (const resolution of built.resolutions) {
      const before = details.resolutions.find((r) => r.directory === resolution.directory)!;
      const s = resolution.width / 800;
      const was = { bt: parseConfigPos(before.config.bluetooth_icon_pos)!, dnd: parseConfigPos(before.config.no_disturb_icon_pos)! };
      expect(parseConfigPos(resolution.config.bluetooth_icon_pos)).toEqual({ x: was.bt.x + Math.round(80 * s), y: was.bt.y + Math.round(-40 * s) });
      expect(parseConfigPos(resolution.config.no_disturb_icon_pos)).toEqual({ x: was.dnd.x + Math.round(-16 * s), y: was.dnd.y + Math.round(24 * s) });
      // The images stay where the template keeps them: no position of their own, both still set.
      expect(resolution.config.bluetooth_off_icon).toBe(before.config.bluetooth_off_icon);
      expect(resolution.config.no_disturb_on_icon).toBe(before.config.no_disturb_on_icon);
      expect(resolution.config.sleep_mode_icon).toBe(before.config.sleep_mode_icon);
      expect(Object.keys(resolution.config).filter((k) => /^(airplane|sleep_mode|bluetooth_(on|off))_icon_pos$/.test(k))).toEqual([]);
    }
    // Hiding the spot blanks its images and leaves the shared position alone.
    const hidden = setVisible(design, view(details, design).row("doNotDisturbStatus"), false, sourceOf(details), "current");
    const off = applyConfigOverridesToDetails(deriveDesignDetails(details, hidden).previewDetails, buildDisabledWatchfaceConfigAssetOverrides(details, hidden.configAssetOverrides ?? {}));
    for (const resolution of off.resolutions) {
      expect(resolution.config.no_disturb_on_icon ?? "").toBe("");
      expect(resolution.config.sleep_mode_icon ?? "").toBe("");
      expect(resolution.config.bluetooth_off_icon).toBeTruthy();
    }
  });

  it("opens a face saved before spots the same: nothing about a spot is in the design", () => {
    const details = template({ sleep: true });
    const saved: Design = { ...makeDefaultDesign(), layoutOffsets: { bluetoothStatus: { dx: 12, dy: 0 } }, lockedLayerIds: [id("bluetooth_off_icon")],
      configAssetOverrides: { "config:sleep_mode_icon": { enabled: false } } };
    const v = view(details, saved);
    expect(JSON.stringify(saved)).not.toMatch(/spot/i);
    expect(isLocked(saved, v.row("bluetoothStatus"))).toBe(true);
    expect(v.row("doNotDisturbStatus").visible).toBe(true);
    expect(v.at("sleep_mode_icon").visible).toBe(false);
    expect(corner(v.row("bluetoothStatus").bounds)).toEqual([121 + 12, 593]);
  });
});
