// Watchmaker's view of the native sprite animation (/design/animation, compiled
// header 0x312): schema, validator, placement, visibility, the component
// contract and the Current-only rule, through the same command layer the AI uses.
import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

const [commandsModule, placementModule, displayModesModule, schemaModule, contractsModule] = await loadWatchfaceTestModules([
  "/src/watchfaces/watchfaceAutomationCommands.ts",
  "/src/watchfaces/watchfaceAutomationPlacement.ts",
  "/src/watchfaces/watchfaceDisplayModes.ts",
  "/src/watchfaces/watchfaceAutomationSchema.ts",
  "/src/watchfaces/watchfaceAutomationAssetContracts.ts"
]);
const { WatchfaceAutomationCommandError, applyWatchfaceAutomationCommands } = commandsModule;
const { resolveWatchfacePlacementScene } = placementModule;
const { resolveWatchfaceModeDesign } = displayModesModule;
const { getWatchfaceAutomationSchema, WATCHFACE_AUTOMATION_DOCUMENT_JSON_SCHEMA } = schemaModule;
const { watchfaceAutomationAssetContracts } = contractsModule;

/** A PNG data URL whose IHDR declares width × height (the validator reads only the header). */
function pngOf(width, height, format = "png") {
  if (format !== "png") return `data:image/jpeg;base64,${Buffer.from("not a png").toString("base64")}`;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const chunk = Buffer.concat([Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.alloc(4)]);
  return `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk, Buffer.alloc(16)]).toString("base64")}`;
}

const directory = "watchface_390x390";
const details = { archiveId: "animation", resolutions: [{
  directory, width: 390, height: 390,
  config: { background_icon: "background.png", time_hour_high_pos: "{60,260}", time_hour_high_font: "digits" },
  aodConfig: { background_icon: "background.png", time_hour_high_pos: "{60,260}", time_hour_high_font: "digits" },
  spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files: Array.from({ length: 10 }, (_, d) => ({ path: `${directory}/digits/0${d}.png`, width: 20, height: 30 })) }],
  icons: [{ path: `${directory}/background.png`, width: 390, height: 390 }]
}] };
const baseDesign = {
  version: 1, accentColor: "#51e0b5", backgroundColor: "#000000", artwork: null, artworkVisible: true, zoom: 1,
  fontFamily: "Arial", digitColor: "#ffffff", tintLabels: false, tintIcons: false, previewComplication: "",
  metricChanges: {}, metricStyles: {}, timeStyles: {},
  staticSeparators: { colon: { enabled: false, x: 195, y: 280, size: 20, color: "#ffffff" }, dateSlash: { enabled: false, x: 195, y: 250, size: 20, color: "#ffffff" } },
  layoutOffsets: {}, linkedLayerGroups: [], editorGroups: [], editorGuides: [], lockedLayerIds: [],
  layerVisibility: {}, layerOpacities: {}, layerColors: {}, designSprites: [], artworkLayerOrder: [], backgroundElements: []
};
const source = (design = baseDesign) => ({ projectName: "Animation fixture", design: structuredClone(design) });
const apply = (commands, from = source(), mode = "current") => applyWatchfaceAutomationCommands(from, commands, { details, mode });
const rejects = (commands, code, from = source(), mode = "current") => assert.throws(() => apply(commands, from, mode),
  (error) => error instanceof WatchfaceAutomationCommandError && error.diagnostics.some((item) => item.code === code),
  `expected ${code}`);
const animation = (overrides = {}) => ({
  enabled: true, x: 0, y: 31, width: 376, height: 340,
  frames: Array.from({ length: 10 }, () => pngOf(376, 340)), delays: Array(10).fill(100), ...overrides
});

// The schema tells the model what an animation is.
const schema = getWatchfaceAutomationSchema();
const defs = schema.$defs ?? WATCHFACE_AUTOMATION_DOCUMENT_JSON_SCHEMA.$defs;
assert.ok(defs.animation, "the document schema defines animation");
assert.equal(defs.animation.properties.frames.maxItems, 44);
assert.match(defs.animation.description, /Current only/);
assert.ok(WATCHFACE_AUTOMATION_DOCUMENT_JSON_SCHEMA.properties.design.properties.animation, "design accepts animation");

// Create, place, move, hide, retime and remove, as Watchmaker would.
let result = apply([{ op: "set", path: "/design/animation", value: animation() }]);
let design = result.value.design;
assert.equal(design.animation.frames.length, 10);
const scene = resolveWatchfacePlacementScene(details, design, "current");
const layer = scene.layers.find((item) => item.id === "animation");
assert.deepEqual([layer.bounds.x0, layer.bounds.y0, layer.bounds.x1, layer.bounds.y1, layer.movable, layer.movementKey], [0, 31, 376, 371, true, "animation"]);
result = apply([{ op: "move_layer", id: "animation", dx: 7, dy: -4 }], result.value);
assert.deepEqual([result.value.design.animation.x, result.value.design.animation.y], [7, 27], "move_layer moves the animation");
result = apply([{ op: "set_visibility", id: "animation", visible: false }], result.value);
assert.equal(result.value.design.animation.enabled, false, "set_visibility hides it");
result = apply([{ op: "set", path: "/design/animation/delays", value: [70, 125, 260, 100, 100, 100, 100, 100, 100, 40] }], result.value);
assert.deepEqual(result.value.design.animation.delays.slice(0, 3), [70, 125, 260], "per-frame retiming");
result = apply([{ op: "unset", path: "/design/animation" }], result.value);
assert.equal(result.value.design.animation, undefined, "unset removes it");

// The validator mirrors the compiler's limits before anything is exported.
rejects([{ op: "set", path: "/design/animation", value: animation({ width: 300 }) }], "animation.size");
rejects([{ op: "set", path: "/design/animation", value: animation({ frames: [pngOf(376, 340), pngOf(370, 340)], delays: [100, 100] }) }], "animation.frame_size");
rejects([{ op: "set", path: "/design/animation", value: animation({ delays: [100] }) }], "animation.delays");
rejects([{ op: "set", path: "/design/animation", value: animation({ frames: Array(45).fill(pngOf(376, 340)), delays: Array(45).fill(100) }) }], "animation.frame_limit");
rejects([{ op: "set", path: "/design/animation", value: animation({ delays: [0, ...Array(9).fill(100)] }) }], "number.invalid");
rejects([{ op: "set", path: "/design/animation", value: animation({ frames: [pngOf(1, 1, "jpeg")], delays: [100] }) }], "animation.png");
rejects([{ op: "set", path: "/design/animation", value: animation({ frames: [], delays: [] }) }], "animation.frames");
rejects([{ op: "set", path: "/design/animation", value: { ...animation(), scale: 2 } }], "object.unknown_field");

// Always-on never animates: an AOD edit cannot carry one, and its overrides cannot smuggle one in.
assert.throws(() => apply([{ op: "set", path: "/design/animation", value: animation() }], source(), "aod"),
  (error) => error instanceof WatchfaceAutomationCommandError && error.diagnostics.some((item) => item.code === "animation.current_only"),
  "AOD rejects an animation");

assert.throws(() => apply([{ op: "set_mode_overrides", mode: "aod", overrides: { animation: animation() } }]),
  (error) => error instanceof WatchfaceAutomationCommandError && error.diagnostics.some((item) => item.code === "design.unknown_field" && /animation/.test(item.path ?? "")),
  "AOD overrides reject an animation");

// The component contract tells the model whether one exists and how to make one.
const empty = watchfaceAutomationAssetContracts(details.resolutions[0], baseDesign, "current").find((item) => item.layerId === "animation");
assert.deepEqual([empty.kind, empty.present, empty.maxFrames, empty.designPath], ["frame-sequence", false, 44, "/design/animation"]);
assert.match(empty.create, /\/design\/animation/);
const filled = watchfaceAutomationAssetContracts(details.resolutions[0], { ...baseDesign, animation: animation() }, "current").find((item) => item.layerId === "animation");
assert.deepEqual([filled.present, filled.frameCount, filled.frameSize, filled.position, filled.delaysMs.length], [true, 10, { width: 376, height: 340 }, { x: 0, y: 31 }, 10]);
assert.equal(watchfaceAutomationAssetContracts(details.resolutions[0], resolveWatchfaceModeDesign(baseDesign, "aod"), "aod").some((item) => item.layerId === "animation"), false,
  "no animation contract in always-on");

console.log("watchface automation animation tests passed");
