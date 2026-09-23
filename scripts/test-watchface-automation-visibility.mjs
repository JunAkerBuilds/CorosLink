import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

const [commandsModule, displayModesModule, editorModelModule, composeModule] =
  await loadWatchfaceTestModules([
    "/src/watchfaces/watchfaceAutomationCommands.ts",
    "/src/watchfaces/watchfaceDisplayModes.ts",
    "/src/watchfaces/watchfaceEditorModel.ts",
    "/src/watchfaces/watchfaceCompose.ts"
  ]);
const {
  WatchfaceAutomationCommandError,
  applyWatchfaceAutomationCommands
} = commandsModule;
const { resolveWatchfaceModeDesign } = displayModesModule;
const { deriveEditorLayers } = editorModelModule;
const { deriveDesignDetails } = composeModule;

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function files(directory, folder, count, width = 18, height = 28) {
  return Array.from({ length: count }, (_, index) => ({
    path: `${directory}/${folder}/${String(index).padStart(2, "0")}.png`,
    width,
    height
  }));
}

function resolution(width = 416) {
  const directory = `watchface_${width}x${width}`;
  return {
    directory,
    width,
    height: width,
    config: {
      background_icon: "background.png",
      time_hour_high_pos: "{70,80}",
      time_hour_high_font: "digits",
      time_hour_low_pos: "{90,80}",
      time_hour_low_font: "digits",
      time_minute_high_pos: "{140,80}",
      time_minute_high_font: "digits",
      time_minute_low_pos: "{160,80}",
      time_minute_low_font: "digits",
      heartreate_level_rect: "{35,250,95,280,0}",
      heartreate_level_font: "digits",
      battery_level_rect: "{170,250,230,280,0}",
      battery_level_font: "digits",
      battery_icon_pos: "{290,250}",
      battery_icon_dir: "battery",
      colon_icon: "icon\\colon.png",
      arc_cut_icon_pos: "{205,82}",
      weather_icon_pos: "{300,42}",
      weather_icon_dir: "weather",
      am_icon: "icon\\am.png",
      pm_icon: "icon\\pm.png",
      am_pm_icon_pos: "{220,85}",
      bluetooth_off_icon: "icon\\bluetooth-off.png"
    },
    aodConfig: {
      background_icon: "a/background.png",
      time_hour_high_pos: "{40,55}",
      time_hour_high_font: "digits",
      time_hour_low_pos: "{60,55}",
      time_hour_low_font: "digits",
      time_minute_high_pos: "{110,55}",
      time_minute_high_font: "digits",
      time_minute_low_pos: "{130,55}",
      time_minute_low_font: "digits",
      bluetooth_off_icon: "a/bluetooth-off.png"
    },
    spriteFolders: [
      { folder: "digits", kind: "digits", aod: false, files: files(directory, "digits", 10) },
      { folder: "battery", kind: "state", aod: false, files: files(directory, "battery", 10, 24, 12) },
      { folder: "weather", kind: "state", aod: false, files: files(directory, "weather", 41, 30, 30) }
    ],
    icons: [
      { path: `${directory}/background.png`, width, height: width },
      { path: `${directory}/a/background.png`, width, height: width },
      { path: `${directory}/icon/colon.png`, width: 8, height: 24 },
      { path: `${directory}/icon/am.png`, width: 20, height: 12 },
      { path: `${directory}/icon/pm.png`, width: 20, height: 12 },
      { path: `${directory}/icon/bluetooth-off.png`, width: 16, height: 16 },
      { path: `${directory}/a/bluetooth-off.png`, width: 16, height: 16 }
    ]
  };
}

const details = { archiveId: "visibility-native", resolutions: [resolution()] };

const baseDesign = {
  version: 1,
  accentColor: "#51e0b5",
  backgroundColor: "#000000",
  artwork: { dataUrl: png, width: 416, height: 416 },
  artworkVisible: true,
  zoom: 1,
  fontFamily: "Arial",
  digitColor: "#ffffff",
  tintLabels: false,
  tintIcons: false,
  previewComplication: "",
  metricChanges: { heartRate: true, battery: true },
  metricStyles: {
    heartRate: { color: "#fedcba", scale: 1.15 },
    battery: { color: "#abcdef", scale: 0.9 }
  },
  timeStyles: { hours: { color: "#123456", scale: 1.1 } },
  staticSeparators: {
    colon: { enabled: true, x: 208, y: 120, size: 24, color: "#f0f0f0" },
    dateSlash: { enabled: false, x: 208, y: 220, size: 20, color: "#ffffff" }
  },
  ampmIndicator: {
    enabled: true,
    x: 220,
    y: 85,
    scale: 1.2,
    color: "#aaaaaa",
    fontFamily: undefined
  },
  weatherIndicator: { enabled: true, x: 300, y: 42, scale: 1.1, color: undefined },
  layoutOffsets: { hours: { dx: 2, dy: 3 } },
  linkedLayerGroups: [],
  editorGroups: [{
    id: "native-and-authored",
    name: "Native and authored",
    layerIds: ["hours", "sprite:badge", "bgel:panel"]
  }],
  editorGuides: [],
  lockedLayerIds: [],
  layerVisibility: { hours: true, batteryIcon: true },
  layerOpacities: { hours: 0.8, "sprite:badge": 0.7 },
  layerColors: { hours: "#123456" },
  configAssetOverrides: {
    "config:battery_icon": { enabled: true },
    "config:colon_icon": { enabled: false },
    "config:bluetooth_off_icon": { enabled: true, scale: 1.25, nativeSize: true }
  },
  designSprites: [{
    id: "badge",
    name: "Badge",
    dataUrl: png,
    sourceWidth: 22,
    sourceHeight: 18,
    width: 22,
    height: 18,
    x: 60,
    y: 330,
    scale: 1.2,
    rotation: 14,
    visible: true
  }],
  artworkLayerOrder: ["sprite:badge", "bgel:panel"],
  backgroundElements: [{
    id: "panel",
    kind: "rect",
    x: 400,
    y: 640,
    rotation: 5,
    width: 180,
    height: 70,
    cornerRadius: 8,
    fill: "#334455",
    visible: true
  }]
};

function value(design = baseDesign) {
  return { projectName: "Visibility fixture", design: structuredClone(design) };
}

function apply(commands, source = value(), mode = "current") {
  return applyWatchfaceAutomationCommands(source, commands, { details, mode });
}

function activeDesign(result, mode = "current") {
  return resolveWatchfaceModeDesign(result.value.design, mode);
}

function editorLayer(design, id) {
  const found = deriveEditorLayers(details, design).find((layer) => layer.id === id);
  assert.ok(found, `Expected editor layer ${id}`);
  return found;
}

function renderedVisibility(design, id) {
  if (id.startsWith("bgel:")) {
    return design.backgroundElements.find(
      (element) => `bgel:${element.id}` === id
    )?.visible !== false;
  }
  return editorLayer(design, id).visible;
}

function previewConfig(design) {
  return deriveDesignDetails(details, design).previewDetails.resolutions[0].config;
}

function assertError(fn, code, commandIndex = 0) {
  assert.throws(
    fn,
    (error) => error instanceof WatchfaceAutomationCommandError &&
      error.diagnostics.some((item) =>
        item.code === code && item.commandIndex === commandIndex
      )
  );
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.equal(
  deriveEditorLayers(details, baseDesign).find(layer => layer.id === "temperature")?.label,
  "Sensor temperature",
  "sensor temperature stays available independently of weather temperature"
);
const legacyTemperatureDetails = structuredClone(details);
Object.assign(legacyTemperatureDetails.resolutions[0].config, {
  temperature_rect: "{35,300,95,328,0}",
  temperature_font: "digits"
});
assert.equal(
  deriveEditorLayers(legacyTemperatureDetails, baseDesign).find(layer => layer.id === "temperature")?.label,
  "Sensor temperature",
  "imported fixed temperature stays editable with a distinct label"
);
for (const enabled of [true, false]) {
  const savedLegacyDesign = { ...baseDesign, metricChanges: { ...baseDesign.metricChanges, temperature: enabled } };
  assert.equal(editorLayer(savedLegacyDesign, "temperature").visible, enabled, "saved legacy temperature remains recoverable, including when hidden");
}

// The command boundary also synchronizes legacy groups and materializes its
// optional global keys. Compare round trips with that canonical form.
const canonicalBaseDesign = activeDesign(apply([{
  op: "set_visibility", id: "hours", visible: true
}]));

// Each editor eye-button family uses its native storage location. Hiding and
// showing again preserves ids, styling, artwork, and every non-visibility field.
const cases = [
  ["hours", (design) => design.layerVisibility.hours, "hours"],
  ["heartRate", (design) => design.metricChanges.heartRate, "heartRate"],
  ["battery", (design) => design.metricChanges.battery, "battery"],
  ["batteryIcon", (design) => design.layerVisibility.batteryIcon, "batteryIcon"],
  ["staticColon", (design) => design.staticSeparators.colon.enabled, "staticColon"],
  ["ampm", (design) => design.ampmIndicator.enabled, "ampm"],
  ["weather", (design) => design.weatherIndicator.enabled, "weather"],
  [
    "configAsset:config:bluetooth_off_icon",
    (design) => design.configAssetOverrides["config:bluetooth_off_icon"].enabled,
    "configAsset:config:bluetooth_off_icon"
  ],
  ["sprite:badge", (design) => design.designSprites[0].visible, "sprite:badge"],
  ["bgel:panel", (design) => design.backgroundElements[0].visible, null],
  ["background", (design) => design.artworkVisible, "background"]
];

for (const [id, readVisibility, editorId] of cases) {
  const hidden = apply([{ op: "set_visibility", id, visible: false }]);
  const hiddenDesign = activeDesign(hidden);
  assert.equal(readVisibility(hiddenDesign), false, `${id} should use its editor visibility field`);
  if (editorId) {
    assert.equal(editorLayer(hiddenDesign, editorId).visible, false, `${id} editor visibility`);
  }
  assert.deepEqual(hidden.changedLayerIds, [id]);

  const shown = apply(
    [{ op: "set_visibility", id, visible: true }],
    hidden.value
  );
  const shownDesign = activeDesign(shown);
  assert.equal(readVisibility(shownDesign), true, `${id} should become visible again`);
  if (editorId) {
    assert.equal(editorLayer(shownDesign, editorId).visible, true, `${id} editor visibility restored`);
  }
  assert.deepEqual(
    jsonValue(shownDesign),
    jsonValue(canonicalBaseDesign),
    `${id} round trip must preserve the design`
  );
}

// Native visibility reaches preview/export config rather than only changing UI state.
const hiddenHours = activeDesign(apply([{
  op: "set_visibility", id: "hours", visible: false
}]));
assert.equal(previewConfig(hiddenHours).time_hour_high_pos, "");
assert.equal(previewConfig(hiddenHours).time_hour_low_pos, "");

const hiddenHeartRate = activeDesign(apply([{
  op: "set_visibility", id: "heartRate", visible: false
}]));
assert.equal(previewConfig(hiddenHeartRate).heartreate_level_rect, "");

const hiddenBatteryIcon = activeDesign(apply([{
  op: "set_visibility", id: "batteryIcon", visible: false
}]));
assert.equal(previewConfig(hiddenBatteryIcon).battery_icon_pos, undefined);
assert.equal(previewConfig(hiddenBatteryIcon).battery_icon_dir, undefined);

const hiddenConfigAsset = activeDesign(apply([{
  op: "set_visibility",
  id: "configAsset:config:bluetooth_off_icon",
  visible: false
}]));
assert.equal(previewConfig(hiddenConfigAsset).bluetooth_off_icon, undefined);

// Addressing one member of a group changes only that member.
const singleMember = activeDesign(apply([{
  op: "set_visibility", id: "hours", visible: false
}]));
assert.equal(editorLayer(singleMember, "hours").visible, false);
assert.equal(editorLayer(singleMember, "sprite:badge").visible, true);
assert.equal(renderedVisibility(singleMember, "bgel:panel"), true);

// The explicit group namespace applies the same eye-button action to every member.
const hiddenGroup = apply([{
  op: "set_visibility", id: "group:native-and-authored", visible: false
}]);
for (const id of ["hours", "sprite:badge", "bgel:panel"]) {
  assert.equal(renderedVisibility(activeDesign(hiddenGroup), id), false, `${id} hidden by group`);
}
assert.deepEqual(
  new Set(hiddenGroup.changedLayerIds),
  new Set(["hours", "sprite:badge", "bgel:panel"])
);
const shownGroup = apply([{
  op: "set_visibility", id: "group:native-and-authored", visible: true
}], hiddenGroup.value);
assert.deepEqual(jsonValue(activeDesign(shownGroup)), jsonValue(canonicalBaseDesign));

// Any locked member rejects the whole group edit, and an earlier command in
// the batch is rolled back without mutating the caller's input.
const lockedSource = value({
  ...baseDesign,
  lockedLayerIds: ["sprite:badge"]
});
const lockedSnapshot = structuredClone(lockedSource);
assertError(
  () => apply([
    { op: "set_visibility", id: "weather", visible: false },
    { op: "set_visibility", id: "group:native-and-authored", visible: false }
  ], lockedSource),
  "layer.locked",
  1
);
assert.deepEqual(lockedSource, lockedSnapshot);

// Unknown ids are rejected and remain a true no-op for caller-owned state.
const unknownSource = value();
const unknownSnapshot = structuredClone(unknownSource);
assertError(
  () => apply([{
    op: "set_visibility", id: "definitely-not-a-layer", visible: false
  }], unknownSource),
  "layer.missing"
);
assert.deepEqual(unknownSource, unknownSnapshot);

// Current and AOD have independent eye-button state.
const withAod = apply([{
  op: "set_mode_overrides",
  mode: "aod",
  copyFrom: "current",
  overrides: {}
}]).value;
const aodHidden = apply(
  [{ op: "set_visibility", id: "hours", visible: false }],
  withAod,
  "aod"
);
assert.equal(resolveWatchfaceModeDesign(aodHidden.value.design, "current").layerVisibility.hours, true);
assert.equal(resolveWatchfaceModeDesign(aodHidden.value.design, "aod").layerVisibility.hours, false);
assert.equal(editorLayer(resolveWatchfaceModeDesign(aodHidden.value.design, "current"), "hours").visible, true);
assert.equal(editorLayer(resolveWatchfaceModeDesign(aodHidden.value.design, "aod"), "hours").visible, false);

// The Studio date slash replaces a template slash in arc_cut_icon, but a face
// that uses arc_cut_icon as a progress mask (PARTICLES) keeps it.
const templateSlash = resolveWatchfaceModeDesign(
  apply([{ op: "set_visibility", id: "staticDateSlash", visible: true }]).value.design,
  "current"
);
assert.equal(templateSlash.staticSeparators.dateSlash.enabled, true);
assert.equal(templateSlash.configAssetOverrides["config:arc_cut_icon"]?.enabled, false);
const maskDetails = structuredClone(details);
Object.assign(maskDetails.resolutions[0].config, {
  arc_cut_icon: "icon\\mask.png",
  arc_cut_icon_pos: "{0,292}"
});
maskDetails.resolutions[0].icons.push({
  path: `${maskDetails.resolutions[0].directory}/icon/mask.png`,
  width: 416,
  height: 125
});
const maskSlash = resolveWatchfaceModeDesign(
  applyWatchfaceAutomationCommands(
    value(),
    [{ op: "set_visibility", id: "staticDateSlash", visible: true }],
    { details: maskDetails, mode: "current" }
  ).value.design,
  "current"
);
assert.equal(maskSlash.staticSeparators.dateSlash.enabled, true);
assert.notEqual(
  maskSlash.configAssetOverrides["config:arc_cut_icon"]?.enabled,
  false,
  "turning on the Studio date slash must not disable a progress mask"
);
assert.ok(
  deriveEditorLayers(maskDetails, maskSlash).some((layer) => layer.id === "arcCut"),
  "a progress mask gets its own Arc cut overlay layer"
);
// Without native size a replacement fills the template box; with it the
// selection (and place_layers) follow the replacement's own pixels.
const arcCutBounds = (override) => {
  const bounds = deriveEditorLayers(maskDetails, {
    ...maskSlash,
    configAssetOverrides: { ...maskSlash.configAssetOverrides, "config:arc_cut_icon": override }
  }).find((layer) => layer.id === "arcCut")?.bounds;
  return bounds && [bounds.x0, bounds.y0, bounds.x1, bounds.y1];
};
const compactOverlay = { dataUrl: png, width: 180, height: 24 };
assert.deepEqual(arcCutBounds({ enabled: true, replacement: compactOverlay }), [0, 292, 416, 417]);
assert.deepEqual(
  arcCutBounds({ enabled: true, nativeSize: true, scale: 1, replacement: compactOverlay }),
  [0, 292, 180, 316]
);

console.log("watchface automation visibility tests passed");
