import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

const [commandsModule, placementModule, displayModesModule, schemaModule, studioModule, composeModule] =
  await loadWatchfaceTestModules([
    "/src/watchfaces/watchfaceAutomationCommands.ts",
    "/src/watchfaces/watchfaceAutomationPlacement.ts",
    "/src/watchfaces/watchfaceDisplayModes.ts",
    "/src/watchfaces/watchfaceAutomationSchema.ts",
    "/src/watchfaces/watchfaceStudio.ts",
    "/src/watchfaces/watchfaceCompose.ts"
  ]);
const {
  WatchfaceAutomationCommandError,
  applyWatchfaceAutomationCommands
} = commandsModule;
const { resolveWatchfacePlacementScene } = placementModule;
const { resolveWatchfaceModeDesign } = displayModesModule;
const { getWatchfaceAutomationSchema } = schemaModule;

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function digitFiles(width, height, directory, folder = "digits") {
  return Array.from({ length: 10 }, (_, digit) => ({
    path: `${directory}/${folder}/${String(digit).padStart(2, "0")}.png`,
    width,
    height
  }));
}

function resolution(width) {
  const directory = `watchface_${width}x${width}`;
  return {
    directory,
    width,
    height: width,
    config: {
      background_icon: "background.png",
      time_hour_high_pos: "{60,100}",
      time_hour_high_font: "digits",
      time_hour_low_pos: "{80,100}",
      time_hour_low_font: "digits",
      time_minute_high_pos: "{140,100}",
      time_minute_high_font: "digits",
      time_minute_low_pos: "{160,100}",
      time_minute_low_font: "digits",
      colon_icon: "icon\\colon.png",
      weather_icon_pos: "{300,40}",
      weather_icon_dir: "weather"
    },
    aodConfig: {
      background_icon: "a/background.png",
      time_hour_high_pos: "{40,60}",
      time_hour_high_font: "digits",
      time_hour_low_pos: "{60,60}",
      time_hour_low_font: "digits"
    },
    spriteFolders: [
      {
        folder: "digits",
        kind: "digits",
        aod: false,
        files: digitFiles(20, 30, directory)
      },
      {
        folder: "weather",
        kind: "state",
        aod: false,
        files: Array.from({ length: 41 }, (_, index) => ({
          path: `${directory}/weather/${String(index).padStart(2, "0")}.png`,
          width: 32,
          height: 32
        }))
      }
    ],
    icons: [
      { path: `${directory}/background.png`, width, height: width },
      { path: `${directory}/a/background.png`, width, height: width },
      { path: `${directory}/icon/colon.png`, width: 10, height: 24 }
    ]
  };
}

const details416 = { archiveId: "placement-416", resolutions: [resolution(416)] };

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
    colon: { enabled: true, x: 208, y: 150, size: 20, color: "#ffffff" },
    dateSlash: { enabled: false, x: 208, y: 250, size: 20, color: "#ffffff" }
  },
  weatherIndicator: { enabled: true, x: 300, y: 40, scale: 1 },
  layoutOffsets: {},
  linkedLayerGroups: [],
  editorGroups: [],
  editorGuides: [],
  lockedLayerIds: [],
  layerVisibility: {},
  layerOpacities: {},
  layerColors: {},
  designSprites: [
    {
      id: "small", name: "Small", dataUrl: png,
      sourceWidth: 20, sourceHeight: 20, width: 20, height: 20,
      x: 50, y: 300, scale: 1, rotation: 0
    },
    {
      id: "medium", name: "Medium", dataUrl: png,
      sourceWidth: 40, sourceHeight: 20, width: 40, height: 20,
      x: 200, y: 300, scale: 1, rotation: 0
    },
    {
      id: "large", name: "Large", dataUrl: png,
      sourceWidth: 60, sourceHeight: 20, width: 60, height: 20,
      x: 350, y: 300, scale: 1, rotation: 0
    }
  ],
  artworkLayerOrder: ["sprite:small", "sprite:medium", "sprite:large"],
  backgroundElements: [{
    id: "box", kind: "rect", x: 400, y: 400, rotation: 0,
    width: 100, height: 60, cornerRadius: 0, fill: "#ff0000"
  }]
};

function value(design = baseDesign) {
  return { projectName: "Placement fixture", design: structuredClone(design) };
}

function apply(commands, source = value(), mode = "current", details = details416) {
  return applyWatchfaceAutomationCommands(source, commands, { details, mode });
}

function activeDesign(result, mode = "current") {
  return resolveWatchfaceModeDesign(result.value.design, mode);
}

function sceneFor(design, mode = "current", details = details416) {
  return resolveWatchfacePlacementScene(details, design, mode);
}

function layer(scene, id) {
  const found = scene.layers.find((candidate) => candidate.id === id);
  assert.ok(found, `Expected placement layer ${id}`);
  assert.ok(found.bounds, `Expected bounds for ${id}`);
  return found;
}

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message}: expected ${expected}, received ${actual}`
  );
}

function anchor(bounds, name) {
  const horizontal = name.endsWith("left") || name === "left"
    ? bounds.x0
    : name.endsWith("right") || name === "right"
      ? bounds.x1
      : (bounds.x0 + bounds.x1) / 2;
  const vertical = name.startsWith("top") || name === "top"
    ? bounds.y0
    : name.startsWith("bottom") || name === "bottom"
      ? bounds.y1
      : (bounds.y0 + bounds.y1) / 2;
  return { x: horizontal, y: vertical };
}

// Tool discovery exposes complete strict schemas for every placement command.
const commandVariants = getWatchfaceAutomationSchema().commands.items.oneOf;
const commandSchema = (op) => commandVariants.find(
  (candidate) => candidate.properties?.op?.const === op
);
const placeSchema = commandSchema("place_layers");
assert.ok(placeSchema);
assert.deepEqual(placeSchema.anyOf, [{ required: ["x"] }, { required: ["y"] }]);
assert.deepEqual(placeSchema.properties.anchor.enum, [
  "top-left", "top", "top-right", "left", "center", "right",
  "bottom-left", "bottom", "bottom-right"
]);
for (const op of ["place_layers", "align_layers", "distribute_layers"]) {
  const schema = commandSchema(op);
  assert.ok(schema, `Expected get_schema command definition for ${op}`);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.layerIds.minItems, 1);
  assert.equal(schema.properties.layerIds.maxItems, 200);
  assert.equal(schema.properties.layerIds.uniqueItems, true);
}
const alignSchema = commandSchema("align_layers");
assert.deepEqual(alignSchema.properties.alignment.enum, [
  "left", "center-x", "right", "top", "center-y", "bottom"
]);
assert.deepEqual(
  alignSchema.properties.reference.anyOf[1],
  {
    type: "object",
    additionalProperties: false,
    required: ["layerId"],
    properties: { layerId: { type: "string", minLength: 1 } }
  }
);
assert.equal(commandSchema("distribute_layers").properties.gap.minimum, 0);

// A 416-only template is the placement frame; bgel raw 800-space geometry is scaled.
const initialScene = sceneFor(baseDesign);
assert.deepEqual({ width: initialScene.width, height: initialScene.height }, { width: 416, height: 416 });
assert.deepEqual(layer(initialScene, "hours").bounds, { x0: 60, y0: 100, x1: 100, y1: 130 });
assert.deepEqual(layer(initialScene, "bgel:box").bounds, {
  x0: 182,
  y0: 192.4,
  x1: 234,
  y1: 223.6
});

// Every anchor places the rotation-aware union anchor at the requested point.
for (const name of [
  "top-left", "top", "top-right", "left", "center", "right",
  "bottom-left", "bottom", "bottom-right"
]) {
  const placed = apply([{
    op: "place_layers", layerIds: ["bgel:box"], x: 208, y: 208, anchor: name
  }]);
  const positioned = anchor(layer(sceneFor(activeDesign(placed)), "bgel:box").bounds, name);
  close(positioned.x, 208, `${name} x anchor`);
  close(positioned.y, 208, `${name} y anchor`);
}

// Mixed native, freeform and sprite selection moves as one rigid union.
const mixedBefore = sceneFor(baseDesign);
const mixedBounds = ["hours", "bgel:box", "sprite:small"].map((id) => layer(mixedBefore, id).bounds);
const mixedCenter = {
  x: (Math.min(...mixedBounds.map((bounds) => bounds.x0)) + Math.max(...mixedBounds.map((bounds) => bounds.x1))) / 2,
  y: (Math.min(...mixedBounds.map((bounds) => bounds.y0)) + Math.max(...mixedBounds.map((bounds) => bounds.y1))) / 2
};
const mixed = apply([{
  op: "place_layers", layerIds: ["hours", "bgel:box", "sprite:small"],
  x: mixedCenter.x + 10, y: mixedCenter.y - 8
}]);
const mixedDesign = activeDesign(mixed);
assert.deepEqual(mixedDesign.layoutOffsets.hours, { dx: 10, dy: -8 });
close(mixedDesign.backgroundElements[0].x, 400 + 10 * 800 / 416, "bgel master-to-raw x");
close(mixedDesign.backgroundElements[0].y, 400 - 8 * 800 / 416, "bgel master-to-raw y");
assert.deepEqual(
  { x: mixedDesign.designSprites[0].x, y: mixedDesign.designSprites[0].y },
  { x: 60, y: 292 }
);

// Earlier add/resize commands affect bounds used by a later align in the same batch.
const recomputed = apply([
  { op: "add_element", element: {
    id: "resized", kind: "rect", x: 100, y: 100, rotation: 0,
    width: 20, height: 40, cornerRadius: 0, fill: "#00ff00"
  } },
  { op: "update_element", id: "resized", patch: { width: 200 } },
  { op: "align_layers", layerIds: ["bgel:resized"], alignment: "right" }
]);
assert.equal(activeDesign(recomputed).backgroundElements.at(-1).x, 700);
close(layer(sceneFor(activeDesign(recomputed)), "bgel:resized").bounds.x1, 416, "resized right edge");

// A reference layer stays fixed while another physical unit aligns to it.
const referenced = apply([{
  op: "align_layers",
  layerIds: ["sprite:small"],
  alignment: "center-x",
  reference: { layerId: "bgel:box" }
}]);
assert.equal(activeDesign(referenced).designSprites[0].x, 208);
assert.equal(activeDesign(referenced).backgroundElements[0].x, 400);
assert.throws(
  () => apply([{
    op: "align_layers",
    layerIds: ["sprite:small"],
    alignment: "left",
    reference: { layerId: "sprite:small" }
  }]),
  (error) => error instanceof WatchfaceAutomationCommandError &&
    error.diagnostics.some(({ code }) => code === "placement.reference")
);
assert.throws(
  () => apply([{
    op: "align_layers",
    layerIds: ["sprite:small"],
    alignment: ["left"]
  }]),
  (error) => error instanceof WatchfaceAutomationCommandError &&
    error.diagnostics.some(({ code }) => code === "command.field")
);

// Equal distribution fixes both endpoints and uses edge gaps across varied widths.
const equal = apply([{
  op: "distribute_layers",
  layerIds: ["sprite:large", "sprite:small", "sprite:medium"],
  direction: "horizontal"
}]);
const equalSprites = Object.fromEntries(activeDesign(equal).designSprites.map((item) => [item.id, item]));
assert.equal(equalSprites.small.x, 50);
assert.equal(equalSprites.medium.x, 190);
assert.equal(equalSprites.large.x, 350);
const equalScene = sceneFor(activeDesign(equal));
const equalLayers = ["sprite:small", "sprite:medium", "sprite:large"].map((id) => layer(equalScene, id).bounds);
close(equalLayers[1].x0 - equalLayers[0].x1, 110, "first equal edge gap");
close(equalLayers[2].x0 - equalLayers[1].x1, 110, "second equal edge gap");

// Explicit gaps sort spatially, keep the first spatial item fixed, and pack forward.
const exact = apply([{
  op: "distribute_layers",
  layerIds: ["sprite:large", "sprite:medium", "sprite:small"],
  direction: "horizontal",
  gap: 15
}]);
const exactSprites = Object.fromEntries(activeDesign(exact).designSprites.map((item) => [item.id, item]));
assert.deepEqual(
  { small: exactSprites.small.x, medium: exactSprites.medium.x, large: exactSprites.large.x },
  { small: 50, medium: 95, large: 160 }
);

// An editor group is rigid, and locking any member blocks movement through another.
const groupedSource = value({
  ...baseDesign,
  editorGroups: [{ id: "pair", name: "Pair", layerIds: ["sprite:small", "sprite:medium"] }]
});
const grouped = apply([{ op: "move_layer", id: "sprite:small", dx: 12.5, dy: -4 }], groupedSource);
const groupedSprites = activeDesign(grouped).designSprites;
assert.deepEqual(
  groupedSprites.slice(0, 2).map(({ x, y }) => ({ x, y })),
  [{ x: 62.5, y: 296 }, { x: 212.5, y: 296 }]
);
const lockedGroup = value({
  ...baseDesign,
  editorGroups: [{ id: "pair", name: "Pair", layerIds: ["sprite:small", "sprite:medium"] }],
  lockedLayerIds: ["sprite:medium"]
});
assert.throws(
  () => apply([{ op: "move_layer", id: "sprite:small", dx: 1, dy: 0 }], lockedGroup),
  (error) => error instanceof WatchfaceAutomationCommandError &&
    error.diagnostics.some(({ code }) => code === "layer.locked" || code === "placement.unsupported")
);

// A mixed rigid group adopts the native member's achieved integer delta once.
const mixedGroupDesign = {
  ...baseDesign,
  editorGroups: [{
    id: "mixed",
    name: "Mixed",
    layerIds: ["hours", "sprite:small", "bgel:box"]
  }]
};
const mixedGroupBefore = sceneFor(mixedGroupDesign);
const mixedGroup = apply(
  [{ op: "move_layer", id: "sprite:small", dx: 4.6, dy: -3.6 }],
  value(mixedGroupDesign)
);
const mixedGroupAfterDesign = activeDesign(mixedGroup);
const mixedGroupAfter = sceneFor(mixedGroupAfterDesign);
assert.deepEqual(mixedGroupAfterDesign.layoutOffsets.hours, { dx: 5, dy: -4 });
assert.deepEqual(
  {
    x: mixedGroupAfterDesign.designSprites[0].x,
    y: mixedGroupAfterDesign.designSprites[0].y
  },
  { x: 55, y: 296 }
);
close(mixedGroupAfterDesign.backgroundElements[0].x, 400 + 5 * 800 / 416, "mixed group bgel x");
close(mixedGroupAfterDesign.backgroundElements[0].y, 400 - 4 * 800 / 416, "mixed group bgel y");
for (const id of ["hours", "sprite:small", "bgel:box"]) {
  const before = layer(mixedGroupBefore, id).bounds;
  const after = layer(mixedGroupAfter, id).bounds;
  close(after.x0 - before.x0, 5, `${id} shared quantized x delta`);
  close(after.y0 - before.y0, -4, `${id} shared quantized y delta`);
}

// Native geometry uses its shared layout key and quantizes offsets once.
const aliasScene = sceneFor(baseDesign);
assert.equal(layer(aliasScene, "hours").movementKey, "layout:hours");
const nativeMoved = apply([{ op: "move_layer", id: "hours", dx: 4.6, dy: 3.4 }]);
assert.deepEqual(activeDesign(nativeMoved).layoutOffsets.hours, { dx: 5, dy: 3 });
assert.deepEqual(layer(sceneFor(activeDesign(nativeMoved)), "hours").bounds, {
  x0: 65, y0: 103, x1: 105, y1: 133
});

// Direct firmware-backed mappings remain editable through the placement reducer.
const mapped = apply([
  { op: "move_layer", id: "staticColon", dx: 7, dy: 9 },
  { op: "move_layer", id: "weather", dx: -10, dy: 6 }
]);
assert.deepEqual(
  { x: activeDesign(mapped).staticSeparators.colon.x, y: activeDesign(mapped).staticSeparators.colon.y },
  { x: 215, y: 159 }
);
assert.deepEqual(
  { x: activeDesign(mapped).weatherIndicator.x, y: activeDesign(mapped).weatherIndicator.y },
  { x: 290, y: 46 }
);

// Moving an active template weather layer materializes its implicit default style.
const implicitWeatherDesign = structuredClone(baseDesign);
delete implicitWeatherDesign.weatherIndicator;
const implicitWeather = apply(
  [{ op: "move_layer", id: "weather", dx: -12, dy: 7 }],
  value(implicitWeatherDesign)
);
assert.deepEqual(activeDesign(implicitWeather).weatherIndicator, {
  enabled: true,
  x: 288,
  y: 47,
  scale: 1
});

// Analog hand aliases share one pivot. Clipped hand artwork may move while the
// pivot remains on-canvas, and locking one alias locks the physical unit.
const analogResolution = resolution(416);
Object.assign(analogResolution.config, {
  time_center_pos: "{208,208}",
  time_hour_icon: "icon\\analog-hour.png",
  time_minute_icon: "icon\\analog-minute.png"
});
analogResolution.icons.push(
  { path: `${analogResolution.directory}/icon/analog-hour.png`, width: 500, height: 500 },
  { path: `${analogResolution.directory}/icon/analog-minute.png`, width: 480, height: 480 }
);
const analogDetails = { archiveId: "analog-placement", resolutions: [analogResolution] };
const analogBefore = sceneFor(baseDesign, "current", analogDetails);
const hourAlias = "configAsset:config:time_hour_icon";
const minuteAlias = "configAsset:config:time_minute_icon";
assert.equal(layer(analogBefore, hourAlias).movementKey, "layout:analogCenter");
assert.equal(layer(analogBefore, minuteAlias).movementKey, "layout:analogCenter");
assert.ok(layer(analogBefore, hourAlias).bounds.y0 < 0 || layer(analogBefore, hourAlias).bounds.y1 > 416);
const analogMoved = apply(
  [{ op: "move_layer", id: hourAlias, dx: 6.4, dy: -3.6 }],
  value(),
  "current",
  analogDetails
);
assert.deepEqual(activeDesign(analogMoved).layoutOffsets.analogCenter, { dx: 6, dy: -4 });
const analogAfter = sceneFor(activeDesign(analogMoved), "current", analogDetails);
for (const id of [hourAlias, minuteAlias]) {
  close(layer(analogAfter, id).bounds.x0 - layer(analogBefore, id).bounds.x0, 6, `${id} alias x`);
  close(layer(analogAfter, id).bounds.y0 - layer(analogBefore, id).bounds.y0, -4, `${id} alias y`);
}
assert.throws(
  () => apply(
    [{ op: "move_layer", id: hourAlias, dx: 209, dy: 0 }],
    value(),
    "current",
    analogDetails
  ),
  (error) => error instanceof WatchfaceAutomationCommandError &&
    error.diagnostics.some(({ code }) => code === "placement.out_of_bounds")
);
const lockedAnalogDesign = { ...baseDesign, lockedLayerIds: [minuteAlias] };
assert.throws(
  () => apply(
    [{ op: "move_layer", id: hourAlias, dx: 1, dy: 0 }],
    value(lockedAnalogDesign),
    "current",
    analogDetails
  ),
  (error) => error instanceof WatchfaceAutomationCommandError &&
    error.diagnostics.some(({ code }) => code === "placement.unsupported" || code === "layer.locked")
);

// A failed later placement rolls back the whole batch and leaves caller input untouched.
const atomicSource = value();
assert.throws(
  () => apply([
    { op: "move_layer", id: "sprite:small", dx: 10, dy: 0 },
    { op: "place_layers", layerIds: ["sprite:large"], x: 500, anchor: "left" }
  ], atomicSource),
  (error) => error instanceof WatchfaceAutomationCommandError &&
    error.diagnostics.some(({ code, commandIndex }) => code === "placement.out_of_bounds" && commandIndex === 1)
);
assert.equal(atomicSource.design.designSprites[0].x, 50);

// AOD placement writes only the independent AOD design.
const withAod = apply([{
  op: "set_mode_overrides", mode: "aod", copyFrom: "current", overrides: {
    backgroundElements: structuredClone(baseDesign.backgroundElements),
    artworkLayerOrder: ["bgel:box"]
  }
}]).value;
const aodMoved = apply(
  [{ op: "move_layer", id: "bgel:box", dx: 13, dy: 5 }],
  withAod,
  "aod"
);
assert.equal(aodMoved.value.design.backgroundElements[0].x, 400);
close(
  aodMoved.value.design.modeDesigns.aod.backgroundElements[0].x,
  400 + 13 * 800 / 416,
  "AOD bgel x"
);
close(
  aodMoved.value.design.modeDesigns.aod.backgroundElements[0].y,
  400 + 5 * 800 / 416,
  "AOD bgel y"
);

// Regression: a full-face arc mask was mistaken for a slash when date rows
// were far apart, then became arcCut after those rows moved. Its offset was
// silently ignored and its replacement remained stuck at (0,0).
const arcDetails = { archiveId: "arc-placement", resolutions: [416, 800].map((width) => {
  const result = resolution(width);
  result.config.arc_cut_icon = "background.png";
  result.config.arc_cut_icon_pos = "{0,0}";
  result.config.english_date_month_rect = `{${Math.round(width * .43)},${Math.round(width * .15)},${Math.round(width * .53)},${Math.round(width * .19)},left|vcenter}`;
  result.config.english_date_day_rect = `{${Math.round(width * .73)},${Math.round(width * .75)},${Math.round(width * .81)},${Math.round(width * .84)},left|vcenter}`;
  return result;
}) };
const arcDesign = {
  ...structuredClone(baseDesign),
  staticSeparators: { colon: { ...baseDesign.staticSeparators.colon, enabled: false }, dateSlash: { ...baseDesign.staticSeparators.dateSlash, enabled: false } },
  configAssetOverrides: { "config:arc_cut_icon": {
    enabled: true, nativeSize: true, scale: .1,
    replacement: { dataUrl: png, width: 1983, height: 793 }
  } },
  layoutOffsets: { dateMonth: { dx: 59, dy: 38 }, dateDay: { dx: -266, dy: -458 }, arcCut: { dx: 168, dy: 600 } }
};
const arcScene = sceneFor(arcDesign, "current", arcDetails);
assert.deepEqual(layer(arcScene, "arcCut").bounds, { x0: 168, y0: 600, x1: 366, y1: 679 });
assert.equal(arcScene.layers.some((candidate) => candidate.id === "separators"), false);
const arcMoved = apply([{ op: "place_layers", layerIds: ["arcCut"], anchor: "top-left", x: 300, y: 500 }], value(arcDesign), "current", arcDetails);
assert.deepEqual(layer(sceneFor(activeDesign(arcMoved), "current", arcDetails), "arcCut").bounds, { x0: 300, y0: 500, x1: 498, y1: 579 });
const arcDerived = composeModule.deriveDesignDetails(arcDetails, activeDesign(arcMoved));
assert.deepEqual(arcDerived.previewDetails.resolutions.map((r) => r.config.arc_cut_icon_pos), ["{156,260}", "{300,500}"], "movement reaches each exported resolution's config");
const arcLimits = studioModule.computeLayoutOffsetLimits(arcDerived.styledMetricDetails.resolutions[1], { configAssetOverrides: arcDesign.configAssetOverrides });
assert.equal(arcLimits.arcCut.maxDx, 602, "replacement-sized mask can move across the face");
assert.equal(arcLimits.arcCut.maxDy, 721);

// A real slash keeps its identity even when moved away from the date row.
const slashDetails = structuredClone(arcDetails);
for (const r of slashDetails.resolutions) {
  r.config.english_date_day_rect = r.config.english_date_month_rect;
  r.config.arc_cut_icon = "slash.png";
  r.config.arc_cut_icon_pos = `{${Math.round(r.width * .47)},${Math.round(r.width * .15)}}`;
  r.icons.push({ path: `${r.directory}/slash.png`, width: 8, height: 16 });
}
const slashMoved = studioModule.applyLayoutToDetails(slashDetails, { separators: { dx: -200, dy: 300 } });
assert.equal(studioModule.watchfaceArcCutRole(slashMoved.resolutions[1]), "dateSlash");
assert.ok(studioModule.computeLayoutGroupBounds(slashMoved.resolutions[1]).some((box) => box.id === "separators"));
assert.equal(studioModule.buildLayerVisibilityOverrides(slashMoved, { separators: false })[1].values.arc_cut_icon, "");

console.log("watchface automation placement tests passed");
