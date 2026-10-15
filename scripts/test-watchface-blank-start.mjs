import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

const [blankModule, backgroundModule, displayModesModule, editorModelModule, visibilityModule, studioModule] =
  await loadWatchfaceTestModules([
    "/src/watchfaces/watchfaceBlankStart.ts",
    "/src/watchfaces/watchfaceBackground.ts",
    "/src/watchfaces/watchfaceDisplayModes.ts",
    "/src/watchfaces/watchfaceEditorModel.ts",
    "/src/watchfaces/watchfaceAutomationVisibility.ts",
    "/src/watchfaces/watchfaceStudio.ts"
  ]);
const { blankWatchfaceDesign, isBlankRemovableLayer, pickScratchBaseTheme, restoreWatchfaceTemplateTime } = blankModule;
const { makeDefaultDesign } = backgroundModule;
const { materializeLegacyAodDesign, resolveWatchfaceModeDesign, writeWatchfaceModeDesign } = displayModesModule;
const { deriveEditorLayers } = editorModelModule;
const { setWatchfaceAutomationVisibility } = visibilityModule;
const { detailsForCompositionMode } = studioModule;

function files(directory, folder, count, width = 18, height = 28) {
  return Array.from({ length: count }, (_, index) => ({
    path: `${directory}/${folder}/${String(index).padStart(2, "0")}.png`,
    width,
    height
  }));
}

/** A template tree; `extra` adds keys only this watch size lays out. */
function resolution(width, { stacked = false, colon = true, extra = {} } = {}) {
  const directory = `watchface_${width}x${width}`;
  const scale = width / 800;
  const at = (x, y) => `{${Math.round(x * scale)},${Math.round(y * scale)}}`;
  const time = stacked
    ? {
        time_hour_high_pos: at(300, 150), time_hour_low_pos: at(400, 150),
        time_minute_high_pos: at(300, 400), time_minute_low_pos: at(400, 400)
      }
    : {
        time_hour_high_pos: at(150, 300), time_hour_low_pos: at(250, 300),
        time_minute_high_pos: at(450, 300), time_minute_low_pos: at(550, 300)
      };
  return {
    directory,
    width,
    height: width,
    config: {
      background_icon: "background.png",
      ...time,
      time_hour_high_font: "digits",
      time_hour_low_font: "digits",
      time_minute_high_font: "digits",
      time_minute_low_font: "digits",
      heartreate_level_rect: `{${at(100, 600).slice(1, -1)},${at(250, 650).slice(1, -1)},0}`,
      heartreate_level_font: "digits",
      english_date_day_rect: `{${at(500, 600).slice(1, -1)},${at(600, 650).slice(1, -1)},0}`,
      english_date_day_font: "digits",
      colon_icon: colon ? "icon\\colon.png" : "",
      ...extra
    },
    aodConfig: {
      background_icon: "a/background.png",
      ...time,
      time_hour_high_font: "digits",
      time_hour_low_font: "digits",
      time_minute_high_font: "digits",
      time_minute_low_font: "digits",
      colon_icon: colon ? "icon\\colon.png" : ""
    },
    spriteFolders: [
      { folder: "digits", kind: "digits", aod: false, files: files(directory, "digits", 10) },
      { folder: "battery", kind: "state", aod: false, files: files(directory, "battery", 10, 24, 12) }
    ],
    icons: [
      { path: `${directory}/background.png`, width, height: width },
      { path: `${directory}/a/background.png`, width, height: width },
      { path: `${directory}/icon/colon.png`, width: 8, height: 24 }
    ]
  };
}

function template(options = {}, smallExtra = {}) {
  return {
    templateId: "blank-start-test",
    resolutions: [resolution(800, options), resolution(240, { ...options, extra: smallExtra })]
  };
}

/** The starting design the editor builds for a template with an AOD. */
function starter(details, nativeData = {}) {
  const base = { ...makeDefaultDesign(), artwork: { dataUrl: "data:image/png;base64,AA==", width: 800, height: 800 }, nativeData };
  return { ...base, modeDesigns: { aod: materializeLegacyAodDesign(base, null) } };
}

/** The editor's layer list for one mode (it never lists AOD-scoped config assets). */
function modeLayers(design, details, mode) {
  return deriveEditorLayers(detailsForCompositionMode(details, mode), resolveWatchfaceModeDesign(design, mode))
    .filter((layer) => !layer.configAssetId?.startsWith("aod:"));
}

function visibleRemovable(design, details, mode) {
  return modeLayers(design, details, mode)
    .filter((layer) => layer.visible && isBlankRemovableLayer(layer))
    .map((layer) => layer.id);
}

// Blank start empties both modes and keeps every layer re-addable.
{
  const details = template();
  const blank = blankWatchfaceDesign(starter(details), details);
  assert.deepEqual(visibleRemovable(blank, details, "current"), []);
  assert.deepEqual(visibleRemovable(blank, details, "aod"), []);
  assert.equal(blank.artwork, null);
  assert.equal(blank.backgroundColor, "#000000");
  for (const id of ["hours", "minutes", "heartRate", "dateDay"]) {
    assert.ok(blank.removedLayerIds.includes(id), `${id} is listed as removed`);
  }
  const aod = resolveWatchfaceModeDesign(blank, "aod");
  assert.equal(aod.artwork, null);
  assert.ok(aod.removedLayerIds.includes("hours"));
  assert.equal(blank.modeDesigns.aod.backgroundEdited, true, "AOD background is re-rendered on export");
}

// Native fields stay as switched-off entries, so export clears template keys.
{
  const details = template();
  const blank = blankWatchfaceDesign(
    starter(details, { week_run: { enabled: true, x: 100, y: 100, scale: 1 } }),
    details
  );
  assert.equal(blank.nativeData.week_run?.enabled, false);
  assert.ok(blank.removedLayerIds.includes("native:week_run"));
}

// A group only a watch-size tree lays out is hidden; the analog center is kept.
{
  const details = template({}, { battery_icon_pos: "{20,120}", battery_icon_dir: "battery", time_center_pos: "{120,120}" });
  const blank = blankWatchfaceDesign(starter(details), details);
  assert.equal(blank.layerVisibility.batteryIcon, false);
  assert.notEqual(blank.layerVisibility.analogCenter, false);
}

// Add the time: digits and the template's own colon, side by side.
{
  const details = template();
  const blank = blankWatchfaceDesign(starter(details), details);
  const current = restoreWatchfaceTemplateTime(resolveWatchfaceModeDesign(blank, "current"), details, "current");
  const layers = deriveEditorLayers(details, current);
  assert.ok(layers.find((layer) => layer.id === "hours").visible);
  assert.ok(layers.find((layer) => layer.id === "minutes").visible);
  assert.equal(current.configAssetOverrides["config:colon_icon"]?.enabled, true);
  assert.equal(current.staticSeparators.colon.enabled, false);
  assert.ok(!current.removedLayerIds.includes("hours"));
  assert.ok(current.removedLayerIds.includes("heartRate"), "only the time comes back");
}

// Without a template colon image, the Studio colon sits between the digits.
{
  const details = template({ colon: false });
  const blank = blankWatchfaceDesign(starter(details), details);
  const current = restoreWatchfaceTemplateTime(resolveWatchfaceModeDesign(blank, "current"), details, "current", { tint: "#ffffff" });
  assert.equal(current.staticSeparators.colon.enabled, true);
  assert.ok(current.staticSeparators.colon.x > 250 && current.staticSeparators.colon.x < 450);
  assert.equal(current.timeStyles.hours.color, "#ffffff", "tint colors the digits");
}

// Stacked hours over minutes get no colon at all.
{
  const details = template({ stacked: true });
  const blank = blankWatchfaceDesign(starter(details), details);
  const current = restoreWatchfaceTemplateTime(resolveWatchfaceModeDesign(blank, "current"), details, "current");
  assert.notEqual(current.configAssetOverrides["config:colon_icon"]?.enabled, true);
  assert.equal(current.staticSeparators.colon.enabled, false);
  const noColon = template({ stacked: true, colon: false });
  const noColonCurrent = restoreWatchfaceTemplateTime(
    resolveWatchfaceModeDesign(blankWatchfaceDesign(starter(noColon), noColon), "current"), noColon, "current"
  );
  assert.equal(noColonCurrent.staticSeparators.colon.enabled, false);
}

// AOD restores only what was deleted, never parts hidden with the eye.
{
  const details = template();
  let design = blankWatchfaceDesign(starter(details), details);
  const aod = resolveWatchfaceModeDesign(design, "aod");
  design = writeWatchfaceModeDesign(design, "aod", {
    ...aod,
    removedLayerIds: aod.removedLayerIds.filter((id) => id !== "minutes")
  });
  const restored = restoreWatchfaceTemplateTime(resolveWatchfaceModeDesign(design, "aod"), details, "aod", { removedOnly: true });
  const layers = deriveEditorLayers(detailsForCompositionMode(details, "aod"), restored);
  assert.ok(layers.find((layer) => layer.id === "hours").visible);
  assert.ok(!layers.find((layer) => layer.id === "minutes").visible);
}

// Showing a deleted layer through automation adds it back to the Layers list.
{
  const details = template();
  const blank = blankWatchfaceDesign(starter(details), details);
  const shown = setWatchfaceAutomationVisibility(blank, details, "current", "heartRate", true);
  assert.ok(!shown.removedLayerIds.includes("heartRate"));
}

// Start from scratch builds on the first digital template that downloads.
{
  const pkg = (id) => `https://example.com/${id}.zip`;
  const pointer = { name: "POINTER", templateType: 2, packageUrl: pkg("pointer") };
  const listed = { name: "LISTED", templateType: 1 };
  const simple = { name: "SIMPLE", templateType: 1, packageUrl: pkg("simple") };
  assert.equal(pickScratchBaseTheme([pointer, listed, simple]), simple);
  assert.equal(pickScratchBaseTheme([pointer]), pointer);
  assert.equal(pickScratchBaseTheme([listed]), undefined);
  assert.equal(pickScratchBaseTheme([]), undefined);
}

console.log("watchface blank start tests passed");
