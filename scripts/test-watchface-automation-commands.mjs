import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";
const [{
  WatchfaceAutomationCommandError,
  applyWatchfaceAutomationCommands
}] = await loadWatchfaceTestModules(["/src/watchfaces/watchfaceAutomationCommands.ts"]);

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const completePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XyT5WQAAAABJRU5ErkJggg==";
const details = { archiveId: "fixture", resolutions: [] };
const baseDesign = {
  version: 1,
  accentColor: "#51e0b5",
  backgroundColor: "#000000",
  artwork: null,
  artworkVisible: true,
  zoom: 1,
  fontFamily: "Arial",
  digitColor: "#ffffff",
  tintLabels: false,
  tintIcons: false,
  previewComplication: "",
  metricChanges: {},
  metricStyles: {},
  timeStyles: {},
  staticSeparators: {
    colon: { enabled: false, x: 400, y: 320, size: 64, color: "#ffffff" },
    dateSlash: { enabled: false, x: 400, y: 240, size: 48, color: "#ffffff" }
  },
  layoutOffsets: {},
  linkedLayerGroups: [],
  editorGroups: [],
  editorGuides: [],
  lockedLayerIds: [],
  layerVisibility: {},
  layerOpacities: {},
  layerColors: {},
  designSprites: [{
    id: "hero", name: "Hero", dataUrl: png,
    sourceWidth: 64, sourceHeight: 64, width: 64, height: 64,
    x: 100, y: 100, scale: 1, rotation: 0
  }],
  artworkLayerOrder: ["sprite:hero"],
  backgroundElements: [{
    id: "label", kind: "text", x: 200, y: 200, rotation: 0,
    text: "HELLO", fontFamily: "Arial", fontSize: 32,
    color: "#ffffff", weight: 700, align: "center"
  }]
};

function value() {
  return { projectName: "Fixture", design: structuredClone(baseDesign) };
}

function apply(commands, mode = "current", source = value()) {
  return applyWatchfaceAutomationCommands(source, commands, { details, mode });
}

function rejects(commands, code, source = value(), mode = "current") {
  assert.throws(
    () => apply(commands, mode, source),
    (error) => error instanceof WatchfaceAutomationCommandError &&
      error.diagnostics.some((item) => item.code === code)
  );
}

// Creating a supported field must work without a template slot or nativeData map.
const addYear = { op: "add_native_field", id: "date_year", x: 260, y: 420, style: { color: "#abcdef", parts: { value: { digitWidth: 18, width: 72 } } } };
const fresh = value();
const yearAdded = apply([addYear], "current", fresh);
assert.deepEqual(yearAdded.changedLayerIds, ["native:date_year"]);
assert.equal(fresh.design.nativeData, undefined, "commands leave the input untouched");
assert.equal(yearAdded.value.design.nativeData.date_year.enabled, true);
assert.equal(yearAdded.value.design.nativeData.date_year.scale, 1);
assert.equal(yearAdded.value.design.nativeData.date_year.color, "#abcdef");
assert.deepEqual(yearAdded.value.design.backgroundElements, fresh.design.backgroundElements, "live year is not a static text element");
const withStress = apply([{ op: "add_native_field", id: "stress", x: 40, y: 60 }], "current", yearAdded.value);
assert.deepEqual(withStress.value.design.nativeData.date_year, yearAdded.value.design.nativeData.date_year);
rejects([addYear], "id.duplicate", yearAdded.value);
rejects([{ ...addYear, id: "made_up_live_field" }], "native.field");
rejects([{ ...addYear, x: "260" }], "command.field");
rejects([{ ...addYear, style: { x: 42 } }], "command.field");
rejects([addYear], "layer.locked", { ...fresh, design: { ...fresh.design, lockedLayerIds: ["native:date_year"] } });
const before = JSON.stringify(fresh);
assert.throws(() => apply([addYear, { op: "add_native_field", id: "stress", x: 0, y: 0, style: { scale: -1 } }], "current", fresh), WatchfaceAutomationCommandError);
assert.equal(JSON.stringify(fresh), before, "a later invalid field rolls back the entire batch");
const aodYear = apply([addYear], "aod", fresh).value;
assert.equal(aodYear.design.nativeData, undefined, "adding an AOD year leaves Current untouched");
assert.equal(aodYear.design.modeDesigns.aod.nativeData.date_year.x, 260);


const solidFontStyles = apply([
  { op: "set", path: "/design/metricStyles/exercise", value: { scale: 0.55, solidAlpha: true } },
  { op: "set", path: "/design/dateStyles", value: { dateDay: { scale: 1, solidAlpha: true } } },
  { op: "set", path: "/design/selectableMetricStyle", value: { scale: 0.82, solidAlpha: true } }
]);
assert.equal(solidFontStyles.value.design.metricStyles.exercise.solidAlpha, true);
assert.equal(solidFontStyles.value.design.dateStyles.dateDay.solidAlpha, true);
assert.equal(solidFontStyles.value.design.selectableMetricStyle.solidAlpha, true);
assert.equal(baseDesign.metricStyles.exercise, undefined);

// Wide generic patches cover native/editor fields while retaining immutable input.
const original = value();
const patched = apply([
  { op: "set", path: "/projectName", value: "Automated" },
  { op: "merge", path: "/design", value: {
    archiveWatchFaceVersion: 4,
    stripBlankConfigKeys: true,
    fontStyle: "italic",
    letterSpacing: 0.04,
    separateAutoTime: true,
    controlBarometerMode: "directional"
  } },
  { op: "set", path: "/design/layerOpacities/sprite:hero", value: 0.5 }
]);
assert.equal(patched.value.projectName, "Automated");
assert.equal(patched.value.design.archiveWatchFaceVersion, 4);
assert.equal(patched.value.design.layerOpacities["sprite:hero"], 0.5);
assert.equal(original.projectName, "Fixture");
assert.equal(original.design.layerOpacities["sprite:hero"], undefined);

// A failed later command rolls back the entire batch and reports its index.
rejects([
  { op: "set", path: "/projectName", value: "Would leak" },
  { op: "set", path: "/design/noSuchField", value: true }
], "design.unknown_field", original);
assert.equal(original.projectName, "Fixture");

// Locks reject pointer and semantic edits until an explicit unlock command.
const locked = apply([{ op: "set_locked", id: "sprite:hero", locked: true }]).value;
rejects([{ op: "move_layer", id: "sprite:hero", dx: 5, dy: 2 }], "layer.locked", locked);
const unlockedMove = apply([
  { op: "set_locked", id: "sprite:hero", locked: false },
  { op: "move_layer", id: "sprite:hero", dx: 5, dy: 2 }
], "current", locked);
assert.equal(unlockedMove.value.design.designSprites[0].x, 105);

// Semantic add/group/duplicate/remove operations preserve references.
const organized = apply([
  { op: "add_element", element: {
    id: "box", kind: "rect", x: 400, y: 400, rotation: 0,
    width: 100, height: 80, cornerRadius: 8, fill: "#ff0000"
  } },
  { op: "group", id: "g1", name: "Artwork", layerIds: ["sprite:hero", "bgel:box"] },
  { op: "duplicate_element", id: "box", newId: "box-copy", offset: 10 },
  { op: "add_guide", guide: { id: "center", axis: "x", position: 400 } },
  { op: "update_guide", id: "center", patch: { position: 420 } }
]);
assert.deepEqual(organized.value.design.editorGroups[0].layerIds, ["sprite:hero", "bgel:box"]);
assert.equal(organized.value.design.backgroundElements.at(-1).x, 410);
assert.equal(organized.value.design.editorGuides[0].position, 420);
rejects([{ op: "remove_sprite", id: "missing" }], "layer.missing");

// AOD edits are isolated from Current and reset without corrupting root state.
const withAod = apply([{
  op: "set_mode_overrides", mode: "aod", copyFrom: "current",
  overrides: { backgroundColor: "#101010" }
}]).value;
const aodEdit = apply([{ op: "set", path: "/design/digitColor", value: "#222222" }], "aod", withAod).value;
assert.equal(aodEdit.design.digitColor, "#ffffff");
assert.equal(aodEdit.design.modeDesigns.aod.digitColor, "#222222");
const reset = apply([{ op: "set_mode_overrides", mode: "aod", overrides: null }], "aod", aodEdit).value;
assert.equal(reset.design.modeDesigns, undefined);
assert.equal(reset.design.digitColor, "#ffffff");

// Unsafe keys, non-finite geometry and malformed references are rejected.
rejects([{ op: "set", path: "/design/__proto__/polluted", value: true }], "pointer.dangerous");
rejects([{ op: "update_sprite", id: "hero", patch: { x: Number.POSITIVE_INFINITY } }], "number.nonfinite");
rejects([{ op: "set", path: "/design/artworkLayerOrder", value: ["sprite:missing"] }], "order.reference");
rejects([{ op: "update_sprite", id: "hero", patch: { mystery: true } }], "sprite.unknown_field");

const fontApplied = apply([{
  op: "import_raster_font",
  folder: { label: "Digits", sprites: [{ name: "00.png", relativePath: "00.png", dataUrl: completePng, sizeBytes: 70 }] },
  target: { kind: "time", id: "hours" },
  tint: true
}]);
assert.equal(fontApplied.value.design.timeStyles.hours.rasterFont.sprites["0"], completePng);
assert.equal(fontApplied.value.design.timeStyles.hours.rasterFont.tint, true);

for (const [mutate, code] of [
  [(design) => { design.metricStyles = null; }, "style.record"],
  [(design) => { design.rasterFont = null; }, "font.invalid"],
  [(design) => { design.layerStrokes = { "sprite:hero": [{ id: "bad" }] }; }, "boolean.invalid"],
  [(design) => { design.layerEffects = { "sprite:hero": { kind: "local", effects: [{ kind: "outer-shadow" }] } }; }, "string.invalid"],
  [(design) => { design.tintLabels = "yes"; }, "boolean.invalid"]
]) {
  const corrupt = value(); mutate(corrupt.design);
  // Errors the document already had don't block unrelated edits; they come
  // back as warnings so the caller can repair them.
  const edited = apply([{ op: "set", path: "/projectName", value: "Still invalid" }], "current", corrupt);
  assert.equal(edited.value.projectName, "Still invalid");
  assert.ok(
    edited.diagnostics.some((item) => item.severity === "warning" && item.code === `preexisting.${code}`),
    `pre-existing ${code} is reported as a warning`
  );
  assert.ok(!edited.diagnostics.some((item) => item.severity === "error"), `pre-existing ${code} is not an error`);
}

// A corrupt document still rejects errors a batch introduces.
{
  const corrupt = value(); corrupt.design.tintLabels = "yes";
  rejects([{ op: "set", path: "/design/accentColor", value: "not a color!" }], "color.invalid", corrupt);
}

// A stale imported AOD color (raw COROS 0x value) no longer locks the face,
// and the command that repairs it is accepted and clears the warning.
{
  const stale = value();
  stale.design.modeDesigns = { aod: { backgroundColor: "0x00000" } };
  const moved = apply([{ op: "set", path: "/design/backgroundElements/0/x", value: 210 }], "current", stale);
  assert.equal(moved.value.design.backgroundElements[0].x, 210);
  assert.ok(moved.diagnostics.some((item) => item.code === "preexisting.color.invalid"));
  const repaired = apply([{ op: "set_mode_overrides", mode: "aod", overrides: { backgroundColor: "#000000" } }], "current", stale);
  assert.equal(repaired.value.design.modeDesigns.aod.backgroundColor, "#000000");
  assert.ok(!repaired.diagnostics.some((item) => item.code.endsWith("color.invalid")));
}

const cssColors = apply([
  { op: "set", path: "/design/backgroundColor", value: "transparent" },
  { op: "set", path: "/design/accentColor", value: "rgba(12, 34, 56, 0.5)" }
]);
assert.equal(cssColors.value.design.backgroundColor, "transparent");
const blank = value(); blank.projectName = "";
assert.equal(apply([{ op: "set", path: "/projectName", value: "Repaired" }], "current", blank).value.projectName, "Repaired");

rejects([{ op: "replace_design", design: locked.design }], "layer.locked", locked);
rejects([{ op: "merge", path: "/design", value: { lockedLayerIds: [] } }], "pointer.protected");

// Native data participates in command discovery, locking and validation.
const nativeStyle = { enabled: true, x: 40, y: 60, scale: 1, color: "#ffffff" };
const nativeAdded = apply([{ op: "set", path: "/design/nativeData", value: { week_tl: nativeStyle } }]);
assert.deepEqual(nativeAdded.changedLayerIds, ["native:week_tl"]);
const nativeLocked = apply([{ op: "set_locked", id: "native:week_tl", locked: true }], "current", nativeAdded.value).value;
for (const command of [
  { op: "set", path: "/design/nativeData/week_tl/color", value: "#ff0000" },
  { op: "unset", path: "/design/nativeData/week_tl" },
  { op: "set", path: "/design/nativeData", value: {} },
  { op: "merge", path: "/design/nativeData", value: { week_tl: { ...nativeStyle, enabled: false } } }
]) rejects([command], "layer.locked", nativeLocked);
rejects([{ op: "set", path: "/design/nativeData/week_tl/color", value: "red" }], "native.color", nativeAdded.value);
rejects([{ op: "set", path: "/design/nativeData/unknown", value: nativeStyle }], "native.invalid", nativeAdded.value);
rejects([{ op: "set", path: "/design/nativeData/week_tl/assets", value: { icon: { "00": completePng } } }], "native.assets", nativeAdded.value);
const nativeCustomized = apply([{ op: "merge", path: "/design/nativeData/week_tl", value: {
  parts: { icon: { x: -120, y: -64, width: 80, color: "#00ff00" } }, assetTexts: { icon: { "0": "LOAD" } }, assets: { digits: { "0": completePng } }
} }], "current", nativeAdded.value);
assert.deepEqual(nativeCustomized.changedLayerIds, ["native:week_tl"]);
assert.equal(nativeCustomized.value.design.nativeData.week_tl.assetTexts.icon["0"], "LOAD");
assert.equal(nativeAdded.value.design.nativeData.week_tl.assetTexts, undefined);
assert.equal(nativeCustomized.value.design.nativeData.week_tl.parts.icon.x, -120);
assert.equal(nativeCustomized.value.design.nativeData.week_tl.parts.icon.y, -64);
assert.equal(nativeCustomized.value.design.nativeData.week_tl.x, nativeStyle.x);
assert.equal(nativeCustomized.value.design.nativeData.week_tl.y, nativeStyle.y);

console.log("watchface automation command tests passed");
