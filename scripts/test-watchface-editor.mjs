import assert from "node:assert/strict";
import {
  WATCHFACE_EDITOR_HISTORY_LIMIT,
  beginWatchfaceEditorHistoryTransaction,
  cancelWatchfaceEditorHistoryTransaction,
  canRedoWatchfaceEditorHistory,
  canUndoWatchfaceEditorHistory,
  commitWatchfaceEditorHistoryTransaction,
  createWatchfaceEditorCheckpoint,
  createWatchfaceEditorHistory,
  createWatchfaceEditorSessionId,
  isWatchfaceEditorHistoryDirty,
  recordWatchfaceEditorHistory,
  redoWatchfaceEditorHistory,
  resetWatchfaceEditorHistory,
  undoWatchfaceEditorHistory,
  updateWatchfaceEditorHistoryTransaction
} from "../src/watchfaces/watchfaceEditorHistory.ts";
import {
  editorLayerAtPoint,
  rotatedCenterBounds,
  watchfaceEditorSelectionExists
} from "../src/watchfaces/watchfaceEditorGeometry.ts";
import {
  listWatchfaceEditorConfigAssets,
  watchfaceEditorControlBatteryIsListed,
  watchfaceEditorLayerIsListed
} from "../src/watchfaces/watchfaceEditorVisibility.ts";
import {
  duplicateWatchfaceDesignSprite,
  normalizeWatchfaceCrop,
  normalizeWatchfaceOpacity,
  normalizeWatchfaceRotation,
  normalizeWatchfaceSkew,
  normalizeWatchfaceTransformOrigin,
  reorderWatchfaceDesignSpriteLayer,
  resizeWatchfaceTransformGroup,
  resizeWatchfaceSprite,
  rotateWatchfaceTransformGroup,
  rotateWatchfaceSprite,
  watchfaceDesignSpriteName
} from "../src/watchfaces/watchfaceSpriteTransform.ts";
import {
  alignWatchfaceItems,
  distributeWatchfaceItems,
  expandWatchfaceGroupSelection,
  normalizeWatchfaceEditorGroups,
  syncLegacyWatchfaceGroups,
  watchfaceSelectionUnits
} from "../src/watchfaces/watchfaceEditorLayout.ts";
import {
  normalizeWatchfaceShadowEffect,
  resolveWatchfaceLayerEffects,
  watchfaceEffectPadding,
  watchfaceShadowMaskSpread
} from "../src/watchfaces/watchfaceEditorEffects.ts";
import { buildWatchfaceEffectPaddingOverrides } from "../src/watchfaces/watchfaceEffectPadding.ts";
import {
  moveWatchfaceArtworkLayer,
  reorderWatchfaceArtworkLayer,
  resolveWatchfaceArtworkLayerOrder
} from "../src/watchfaces/watchfaceArtworkLayers.ts";
import {
  DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES,
  WATCHFACE_PLACEMENT_STORAGE_KEY,
  backgroundElementSnapBounds,
  formatWatchfaceSnapStatus,
  normalizeWatchfacePlacementPreferences,
  readWatchfacePlacementPreferences,
  scaleWatchfaceBounds,
  snapWatchfaceBounds,
  translateWatchfaceBounds,
  watchfaceDesignThreshold,
  watchfaceSafeAreaBounds,
  writeWatchfacePlacementPreferences
} from "../src/watchfaces/watchfaceEditorSnapping.ts";
import {
  WATCHFACE_INSPECTOR_DEFAULT_OPEN,
  watchfaceInspectorSectionPlan
} from "../src/watchfaces/watchfaceInspectorSections.ts";
import {
  createWatchfaceStroke,
  migrateLegacyBackgroundElementStrokes,
  normalizeWatchfaceStroke,
  watchfaceStrokePadding
} from "../src/watchfaces/watchfaceEditorStrokes.ts";

assert.equal(WATCHFACE_EDITOR_HISTORY_LIMIT, 50);

const inspectorSectionFixtures = [
  ["background", {}, false, true, true, false, false],
  ["background", {}, false, true, true, true, false],
  ["time", {}, true, true, true, true, false],
  ["date", {}, true, true, true, true, false],
  ["weekday", {}, true, true, true, true, false],
  ["seconds", {}, true, true, true, true, false],
  ["separators", {}, true, true, false, true, true],
  ["battery", {}, true, true, true, true, false],
  ["batteryIcon", {}, true, false, true, true, false],
  ["controlBatteryIcon", {}, true, false, false, false, true],
  ["complication", {}, true, true, true, true, false],
  ["metric", {}, true, true, true, true, false],
  ["weather", {}, true, true, true, false, true],
  ["configAsset", {}, true, false, false, false, true],
  ["customSprite", {}, true, true, true, true, true],
  ["backgroundElement", { backgroundKind: "rect" }, true, true, true, true, true],
  ["backgroundElement", { backgroundKind: "ellipse" }, true, true, true, true, true],
  ["backgroundElement", { backgroundKind: "line" }, true, true, true, true, true],
  ["backgroundElement", { backgroundKind: "text" }, true, true, true, true, true]
];

for (const [
  kind,
  metadata,
  hasTransform,
  hasAppearance,
  hasStroke,
  hasEffects,
  hasAdvanced
] of inspectorSectionFixtures) {
  const plan = watchfaceInspectorSectionPlan({
    kind,
    ...metadata,
    hasTransform,
    hasAppearance,
    hasStroke,
    hasEffects,
    hasAdvanced
  });
  const expectedIds = [
    "layer",
    ...(hasTransform ? ["transform"] : []),
    ...(hasAppearance ? ["appearance"] : []),
    ...(hasStroke ? ["stroke"] : []),
    "specific",
    ...(hasEffects ? ["effects"] : []),
    ...(hasAdvanced ? ["advanced"] : [])
  ];
  assert.deepEqual(
    plan.map((section) => section.id),
    expectedIds,
    `${kind}${metadata.backgroundKind ? `:${metadata.backgroundKind}` : ""} uses the inspector section order`
  );
  assert.equal(
    plan.find((section) => section.id === "effects")?.defaultOpen,
    hasEffects ? false : undefined,
    "Effects starts collapsed and is absent when irrelevant"
  );
  assert.equal(
    plan.find((section) => section.id === "advanced")?.defaultOpen,
    hasAdvanced ? false : undefined,
    "Advanced starts collapsed and is absent when irrelevant"
  );
  for (const section of plan.filter(
    (candidate) => candidate.id !== "effects" && candidate.id !== "advanced"
  )) {
    assert.equal(section.defaultOpen, true, `${section.id} starts expanded`);
  }
}

assert.deepEqual(WATCHFACE_INSPECTOR_DEFAULT_OPEN, {
  layer: true,
  transform: true,
  appearance: true,
  stroke: true,
  specific: true,
  effects: false,
  advanced: false
});

const defaultStroke = createWatchfaceStroke("#2e05ff");
assert.equal(defaultStroke.paint.kind, "solid");
assert.equal(defaultStroke.paint.color, "#2e05ff");
assert.equal(defaultStroke.position, "outside");
assert.equal(defaultStroke.weight, 1);
assert.equal(defaultStroke.opacity, 1);
assert.equal(defaultStroke.enabled, true);

const normalizedGradientStroke = normalizeWatchfaceStroke({
  id: "",
  enabled: true,
  paint: {
    kind: "linear-gradient",
    from: "invalid",
    to: "#123456",
    angle: -90
  },
  opacity: 2,
  position: "center",
  weight: 500
});
assert.match(normalizedGradientStroke.id, /^stroke-/);
assert.deepEqual(normalizedGradientStroke.paint, {
  kind: "linear-gradient",
  from: "#51e0b5",
  to: "#123456",
  angle: 270
});
assert.equal(normalizedGradientStroke.opacity, 1);
assert.equal(normalizedGradientStroke.position, "center");
assert.equal(normalizedGradientStroke.weight, 64);

assert.deepEqual(
  watchfaceStrokePadding([
    { ...defaultStroke, weight: 10, position: "inside" },
    { ...defaultStroke, id: "center", weight: 9, position: "center" },
    { ...defaultStroke, id: "outside", weight: 7, position: "outside" }
  ], 0.5),
  { left: 4, top: 4, right: 4, bottom: 4 }
);

const legacyStrokeMigration = migrateLegacyBackgroundElementStrokes(
  [
    {
      id: "legacy",
      kind: "rect",
      x: 10,
      y: 20,
      rotation: 0,
      width: 100,
      height: 80,
      cornerRadius: 8,
      fill: "#000000",
      strokeColor: "#abcdef",
      strokeWidth: 6
    }
  ],
  undefined
);
assert.equal(legacyStrokeMigration.layerStrokes["bgel:legacy"].length, 1);
assert.equal(
  legacyStrokeMigration.layerStrokes["bgel:legacy"][0].position,
  "center"
);
assert.equal(
  legacyStrokeMigration.layerStrokes["bgel:legacy"][0].paint.color,
  "#abcdef"
);
assert.equal("strokeColor" in legacyStrokeMigration.elements[0], false);
assert.equal("strokeWidth" in legacyStrokeMigration.elements[0], false);

const importedImage = {
  id: "original",
  dataUrl: "data:image/png;base64,AA==",
  sourceWidth: 100,
  sourceHeight: 80,
  width: 100,
  height: 80,
  x: 200,
  y: 300,
  scale: 1.25,
  rotation: 25,
  opacity: 0.7,
  flipX: true,
  skewX: 12,
  aspectLocked: false,
  crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
  origin: { x: 0, y: 1 },
  visible: true,
  tintColor: "#51e0b5"
};
const duplicatedImage = duplicateWatchfaceDesignSprite(
  importedImage,
  "duplicate",
  { width: 800, height: 800 },
  16
);
assert.equal(duplicatedImage.id, "duplicate");
assert.equal(watchfaceDesignSpriteName(importedImage), "Imported sprite");
assert.equal(duplicatedImage.name, "Imported sprite copy");
assert.equal(duplicatedImage.x, 216);
assert.equal(duplicatedImage.y, 316);
assert.equal(duplicatedImage.rotation, importedImage.rotation);
assert.equal(duplicatedImage.tintColor, importedImage.tintColor);
assert.notEqual(duplicatedImage.crop, importedImage.crop);
duplicatedImage.crop.x = 0.4;
assert.equal(importedImage.crop.x, 0.1, "duplicate crop state must be independent");

const legacyArtworkOrder = resolveWatchfaceArtworkLayerOrder({
  backgroundElements: [
    { id: "shape", kind: "rect" },
    { id: "caption", kind: "text" }
  ],
  designSprites: [{ id: "photo" }, { id: "badge" }]
});
assert.deepEqual(legacyArtworkOrder, [
  "bgel:shape",
  "bgel:caption",
  "sprite:photo",
  "sprite:badge"
]);
assert.deepEqual(
  reorderWatchfaceArtworkLayer(
    legacyArtworkOrder,
    "bgel:caption",
    "sprite:badge",
    "before"
  ),
  ["bgel:shape", "sprite:photo", "sprite:badge", "bgel:caption"],
  "created text can be moved above an imported image"
);
assert.deepEqual(
  moveWatchfaceArtworkLayer(
    ["bgel:shape", "sprite:photo", "bgel:caption"],
    "bgel:caption",
    "backward"
  ),
  ["bgel:shape", "bgel:caption", "sprite:photo"],
  "layer-order buttons move created artwork one step at a time"
);
assert.deepEqual(
  resolveWatchfaceArtworkLayerOrder({
    artworkLayerOrder: ["sprite:photo", "missing", "bgel:shape", "sprite:photo"],
    backgroundElements: [{ id: "shape", kind: "rect" }],
    designSprites: [{ id: "photo" }, { id: "new" }]
  }),
  ["sprite:photo", "bgel:shape", "sprite:new"],
  "stored order prunes removed ids, deduplicates, and appends new artwork"
);

const layerStack = [
  { ...importedImage, id: "back" },
  { ...importedImage, id: "middle" },
  { ...importedImage, id: "front" }
];
const movedBefore = reorderWatchfaceDesignSpriteLayer(
  layerStack,
  "middle",
  "front",
  "before"
);
assert.deepEqual(movedBefore.map((sprite) => sprite.id), ["back", "front", "middle"]);
assert.deepEqual(
  reorderWatchfaceDesignSpriteLayer(
    movedBefore,
    "middle",
    "front",
    "after"
  ).map((sprite) => sprite.id),
  ["back", "middle", "front"]
);
assert.equal(
  reorderWatchfaceDesignSpriteLayer(layerStack, "front", "middle", "before"),
  layerStack,
  "dropping in the current position leaves the stack unchanged"
);
assert.equal(
  reorderWatchfaceDesignSpriteLayer(layerStack, "missing", "front", "before"),
  layerStack,
  "missing layer leaves the stack unchanged"
);

let history = createWatchfaceEditorHistory({ x: 0, name: "Face" });
const sessionA = createWatchfaceEditorSessionId("project-a", "open-1");
const saved = createWatchfaceEditorCheckpoint(history, sessionA);

assert.equal(isWatchfaceEditorHistoryDirty(history, saved, sessionA), false);
assert.equal(canUndoWatchfaceEditorHistory(history), false);
assert.equal(canRedoWatchfaceEditorHistory(history), false);

history = recordWatchfaceEditorHistory(history, { x: 1, name: "Face" });
assert.equal(history.present.value.x, 1);
assert.equal(history.past.length, 1);
assert.equal(isWatchfaceEditorHistoryDirty(history, saved, sessionA), true);

history = undoWatchfaceEditorHistory(history);
assert.deepEqual(history.present.value, { x: 0, name: "Face" });
assert.equal(isWatchfaceEditorHistoryDirty(history, saved, sessionA), false);
assert.equal(canRedoWatchfaceEditorHistory(history), true);

history = redoWatchfaceEditorHistory(history);
assert.equal(history.present.value.x, 1);
assert.equal(canUndoWatchfaceEditorHistory(history), true);

// A new edit after undo discards the abandoned redo branch.
history = undoWatchfaceEditorHistory(history);
history = recordWatchfaceEditorHistory(history, { x: 2, name: "Face" });
assert.equal(history.future.length, 0);
assert.equal(canRedoWatchfaceEditorHistory(history), false);

// Many pointer updates become one undo entry and one new revision.
const beforeDrag = history;
history = beginWatchfaceEditorHistoryTransaction(history);
assert.equal(canRedoWatchfaceEditorHistory(history), false);
history = updateWatchfaceEditorHistoryTransaction(history, { x: 10, name: "Face" });
history = updateWatchfaceEditorHistoryTransaction(history, { x: 20, name: "Face" });
history = updateWatchfaceEditorHistoryTransaction(history, { x: 30, name: "Face" });
assert.equal(history.past.length, beforeDrag.past.length);
assert.equal(history.present.value.x, 30);
history = commitWatchfaceEditorHistoryTransaction(history);
assert.equal(history.past.length, beforeDrag.past.length + 1);
history = undoWatchfaceEditorHistory(history);
assert.equal(history.present.value.x, 2);
history = redoWatchfaceEditorHistory(history);
assert.equal(history.present.value.x, 30);

// Cancelling a transaction restores its exact committed snapshot.
const beforeCancelledDrag = history;
history = updateWatchfaceEditorHistoryTransaction(history, { x: 99, name: "Face" });
history = cancelWatchfaceEditorHistoryTransaction(history);
assert.deepEqual(history, beforeCancelledDrag);

// Callers can supply structural equality so a gesture ending at its starting
// value does not create an undo entry despite using fresh immutable objects.
const equalPosition = (left, right) => left.x === right.x && left.name === right.name;
const beforeNoopDrag = history;
history = updateWatchfaceEditorHistoryTransaction(history, { x: 31, name: "Face" });
history = updateWatchfaceEditorHistoryTransaction(history, { x: 30, name: "Face" });
history = commitWatchfaceEditorHistoryTransaction(history, equalPosition);
assert.deepEqual(history, beforeNoopDrag);

// Retain exactly 50 undo points; the oldest retained value is 10 after 60 edits.
let capped = createWatchfaceEditorHistory(0);
for (let value = 1; value <= 60; value += 1) {
  capped = recordWatchfaceEditorHistory(capped, value);
}
assert.equal(capped.past.length, 50);
for (let count = 0; count < 50; count += 1) {
  capped = undoWatchfaceEditorHistory(capped);
}
assert.equal(capped.present.value, 10);
assert.equal(canUndoWatchfaceEditorHistory(capped), false);
assert.equal(capped.future.length, 50);

// Source changes reset both values and history and never reuse a session ID.
const sessionASecondOpen = createWatchfaceEditorSessionId("project-a", "open-2");
const sessionB = createWatchfaceEditorSessionId("project-b", "open-1");
assert.notEqual(sessionASecondOpen, sessionA);
assert.notEqual(sessionB, sessionA);
assert.equal(isWatchfaceEditorHistoryDirty(history, saved, sessionB), true);

const reset = resetWatchfaceEditorHistory(
  { x: 7, name: "Other face" },
  history
);
assert.deepEqual(reset.present.value, { x: 7, name: "Other face" });
assert.equal(reset.past.length, 0);
assert.equal(reset.future.length, 0);
assert.equal(reset.present.revision, 0);
assert.equal(reset.limit, history.limit);
const resetCheckpoint = createWatchfaceEditorCheckpoint(reset, sessionB);
assert.equal(isWatchfaceEditorHistoryDirty(reset, resetCheckpoint, sessionB), false);

// Geometry stays rotation-aware, ignores hidden layers, and picks the smallest
// overlapping target before falling back to the background.
assert.deepEqual(rotatedCenterBounds(400, 400, 20, 40, 90), {
  x0: 380,
  y0: 390,
  x1: 420,
  y1: 410
});
const editorLayers = [
  { id: "large", kind: "customSprite", visible: true, bounds: { x0: 350, y0: 350, x1: 450, y1: 450 } },
  { id: "small", kind: "customSprite", visible: true, bounds: { x0: 380, y0: 390, x1: 420, y1: 410 } },
  { id: "hidden", kind: "customSprite", visible: false, bounds: { x0: 395, y0: 395, x1: 405, y1: 405 } },
  { id: "background", kind: "background", visible: true, bounds: { x0: 0, y0: 0, x1: 800, y1: 800 } }
];
assert.equal(editorLayerAtPoint(editorLayers, 400, 400)?.id, "small");
assert.equal(editorLayerAtPoint(editorLayers, 10, 10)?.id, "background");
assert.equal(
  watchfaceEditorSelectionExists("bgel:text-1", editorLayers, [{ id: "text-1" }]),
  true,
  "freeform text sub-layers must remain selected while their inspector is open"
);
assert.equal(
  watchfaceEditorSelectionExists("bgel:removed", editorLayers, [{ id: "text-1" }]),
  false,
  "removed background elements should fall back to a live editor layer"
);

const configAssetDetails = {
  archiveId: "editor-layer-fixture",
  resolutions: [{
    directory: "800",
    width: 800,
    height: 800,
    config: {
      bluetooth_on_icon: "bluetooth-on.png"
    },
    aodConfig: {},
    icons: [{
      path: "800/bluetooth-on.png",
      width: 24,
      height: 24
    }],
    spriteFolders: []
  }]
};
const hiddenConfigAssetDetails = {
  ...configAssetDetails,
  resolutions: configAssetDetails.resolutions.map((resolution) => ({
    ...resolution,
    config: {}
  }))
};
assert.deepEqual(
  listWatchfaceEditorConfigAssets(
    configAssetDetails,
    hiddenConfigAssetDetails
  ).map((reference) => reference.id),
  ["config:bluetooth_on_icon"],
  "hidden config assets must retain their source reference in the layer panel"
);

const explicitlyHiddenAodMetric = {
  id: "steps",
  kind: "metric",
  label: "Steps",
  layoutGroupId: "steps",
  metricId: "steps",
  visible: false,
  canHide: true,
  present: false,
  bounds: null,
  capabilities: {}
};
assert.equal(
  watchfaceEditorLayerIsListed(explicitlyHiddenAodMetric, "aod", {
    metricChanges: { steps: false }
  }),
  true,
  "an explicitly hidden AOD component must remain available to show again"
);

assert.equal(
  watchfaceEditorControlBatteryIsListed(false, false, false, undefined),
  true,
  "a selectable battery added by the editor must stay in the panel when hidden"
);

// Image transform handles preserve the opposite corner, work in local rotated
// axes, and leave aspect-ratio locking to the caller's modifier key.
assert.deepEqual(
  resizeWatchfaceSprite(
    { x: 100, y: 100, width: 40, height: 20, rotation: 0 },
    "se",
    20,
    10
  ),
  { x: 110, y: 105, width: 60, height: 30, rotation: 0 }
);
const rotatedResize = resizeWatchfaceSprite(
  { x: 100, y: 100, width: 40, height: 20, rotation: 90 },
  "se",
  -10,
  20
);
assert.equal(Math.round(rotatedResize.x), 95);
assert.equal(Math.round(rotatedResize.y), 110);
assert.equal(Math.round(rotatedResize.width), 60);
assert.equal(Math.round(rotatedResize.height), 30);
assert.deepEqual(
  resizeWatchfaceSprite(
    { x: 100, y: 100, width: 40, height: 20, rotation: 0 },
    "se",
    20,
    2,
    true
  ),
  { x: 110, y: 105, width: 60, height: 30, rotation: 0 }
);
assert.deepEqual(
  rotateWatchfaceSprite(
    { x: 100, y: 100, width: 40, height: 20, rotation: 350 },
    { x: 100, y: 80 },
    { x: 120, y: 100 }
  ),
  { rotation: 80, rotationDelta: 90 }
);
assert.equal(normalizeWatchfaceRotation(-10), 350);
assert.deepEqual(
  resizeWatchfaceSprite(
    { x: 100, y: 100, width: 40, height: 20, rotation: 0 },
    "e",
    12,
    50
  ),
  { x: 106, y: 100, width: 52, height: 20, rotation: 0 }
);
assert.deepEqual(
  resizeWatchfaceSprite(
    { x: 100, y: 100, width: 40, height: 20, rotation: 0 },
    "n",
    30,
    -10,
    true,
    true
  ),
  { x: 100, y: 100, width: 80, height: 40, rotation: 0 }
);
const originRotation = rotateWatchfaceSprite(
  { x: 100, y: 100, width: 40, height: 20, rotation: 0 },
  { x: 80, y: 80 },
  { x: 100, y: 100 },
  { x: 0, y: 0 },
  15
);
assert.equal(originRotation.rotation, 120);
assert.equal(Math.round(originRotation.x), 61);
assert.equal(Math.round(originRotation.y), 102);
const normalizedCrop = normalizeWatchfaceCrop({ x: -1, y: 0.9, width: 3, height: 3 });
assert.deepEqual(
  { x: normalizedCrop.x, y: normalizedCrop.y, width: normalizedCrop.width },
  { x: 0, y: 0.9, width: 1 }
);
assert.ok(Math.abs(normalizedCrop.height - 0.1) < 1e-9);
assert.equal(normalizeWatchfaceOpacity(1.4), 1);
assert.equal(normalizeWatchfaceSkew(-120), -80);
assert.deepEqual(normalizeWatchfaceTransformOrigin({ x: 2, y: -1 }), { x: 1, y: 0 });
const skewBounds = rotatedCenterBounds(100, 100, 40, 20, 0, 45, 0);
assert.equal(Math.round(skewBounds.x1 - skewBounds.x0), 60);
const groupItems = [
  { id: "left", x: 25, y: 50, width: 20, height: 10, rotation: 0 },
  { id: "right", x: 75, y: 50, width: 20, height: 10, rotation: 30 }
];
assert.deepEqual(
  resizeWatchfaceTransformGroup(
    groupItems,
    { x: 50, y: 50, width: 100, height: 50, rotation: 0 },
    { x: 60, y: 60, width: 200, height: 100, rotation: 0 }
  ),
  [
    { id: "left", x: 10, y: 60, width: 40, height: 20, rotation: 0 },
    { id: "right", x: 110, y: 60, width: 40, height: 20, rotation: 30 }
  ]
);
const rotatedGroup = rotateWatchfaceTransformGroup(groupItems, { x: 50, y: 50 }, 90);
assert.equal(Math.round(rotatedGroup[0].x), 50);
assert.equal(Math.round(rotatedGroup[0].y), 25);
assert.equal(rotatedGroup[0].rotation, 90);
assert.equal(Math.round(rotatedGroup[1].x), 50);
assert.equal(Math.round(rotatedGroup[1].y), 75);
assert.equal(rotatedGroup[1].rotation, 120);

const layoutItems = [
  { id: "a", bounds: { x0: 0, y0: 0, x1: 10, y1: 10 } },
  { id: "b", bounds: { x0: 20, y0: 20, x1: 40, y1: 30 } },
  { id: "c", bounds: { x0: 70, y0: 40, x1: 80, y1: 50 } }
];
assert.deepEqual(alignWatchfaceItems(layoutItems.slice(0, 2), "left"), {
  a: { dx: 0, dy: 0 },
  b: { dx: -20, dy: 0 }
});
assert.deepEqual(distributeWatchfaceItems(layoutItems, "horizontal"), {
  a: { dx: 0, dy: 0 },
  b: { dx: 10, dy: 0 },
  c: { dx: 0, dy: 0 }
});
const legacyDesign = syncLegacyWatchfaceGroups({
  version: 1,
  linkedLayerGroups: [["a", "b"], ["b", "c"]]
});
assert.deepEqual(legacyDesign.linkedLayerGroups, [["a", "b"]]);
assert.equal(normalizeWatchfaceEditorGroups(undefined, [["a", "b"]])[0]?.name, "Group 1");
const atomicGroups = [{ id: "group-a", name: "A", layerIds: ["a", "b"] }];
assert.deepEqual(expandWatchfaceGroupSelection(atomicGroups, ["a", "c"]), ["a", "b", "c"]);
assert.deepEqual(watchfaceSelectionUnits(atomicGroups, ["b", "c"]), [
  { id: "group:group-a", layerIds: ["a", "b"] },
  { id: "layer:c", layerIds: ["c"] }
]);

const normalizedShadow = normalizeWatchfaceShadowEffect({
  id: "shadow",
  kind: "outer-shadow",
  enabled: true,
  color: "invalid",
  opacity: 2,
  blur: 100,
  spread: -100,
  distance: 200,
  angle: 725
});
assert.deepEqual(
  { color: normalizedShadow.color, opacity: normalizedShadow.opacity, blur: normalizedShadow.blur, spread: normalizedShadow.spread, distance: normalizedShadow.distance, angle: normalizedShadow.angle },
  { color: "#000000", opacity: 1, blur: 64, spread: -32, distance: 128, angle: 5 }
);
const padding = watchfaceEffectPadding([{ ...normalizedShadow, blur: 10, spread: 2, distance: 10, angle: 0 }]);
assert.deepEqual(padding, { left: 12, top: 22, right: 32, bottom: 22 });
assert.equal(watchfaceShadowMaskSpread({ ...normalizedShadow, spread: 8 }, 0.5), 4);
assert.equal(watchfaceShadowMaskSpread({ ...normalizedShadow, spread: 8 }, 0.5, true), -4);
assert.equal(resolveWatchfaceLayerEffects({
  effectStyles: [{ id: "raised", name: "Raised", effects: [normalizedShadow] }],
  layerEffects: { steps: { kind: "style", styleId: "raised" } }
}, "steps").length, 1);
const scopedEffects = {
  effectStyles: [],
  layerEffects: {
    steps: { kind: "local", effects: [{ ...normalizedShadow, id: "current" }] },
    "aod:steps": { kind: "local", effects: [{ ...normalizedShadow, id: "aod", opacity: 0.2 }] }
  }
};
assert.equal(resolveWatchfaceLayerEffects(scopedEffects, "steps", "current")[0].id, "current");
assert.equal(resolveWatchfaceLayerEffects(scopedEffects, "steps", "aod")[0].id, "aod");
const paddingDetails = {
  archiveId: "fixture",
  resolutions: [800, 416, 260, 240].map((width) => ({
    directory: String(width),
    width,
    height: width,
    config: {
      steps_rect: "{100,100,140,120}",
      time_hour_high_pos: "{200,80}",
      time_hour_low_pos: "{230,80}",
      battery_icon_pos: "{50,60}",
      control_step_rect: "{10,20,40,50}",
      am_pm_icon_pos: "{300,120}",
      weather_icon_pos: "{500,160}"
    }
  }))
};
const paddingByResolution = new Map([
  ["800", new Map([["steps", { left: 16, top: 12, right: 20, bottom: 24 }], ["hours", { left: 16, top: 12, right: 20, bottom: 24 }], ["batteryIcon", { left: 16, top: 12, right: 20, bottom: 24 }], ["complication", { left: 16, top: 12, right: 20, bottom: 24 }], ["ampm", { left: 16, top: 12, right: 20, bottom: 24 }], ["weather", { left: 16, top: 12, right: 20, bottom: 24 }]])],
  ["416", new Map([["steps", { left: 8, top: 6, right: 10, bottom: 12 }]])],
  ["260", new Map([["steps", { left: 5, top: 4, right: 7, bottom: 8 }]])],
  ["240", new Map([["steps", { left: 5, top: 4, right: 6, bottom: 7 }]])]
]);
const paddingOverrides = buildWatchfaceEffectPaddingOverrides(
  paddingDetails,
  paddingByResolution
);
assert.equal(paddingOverrides.length, 4);
assert.equal(paddingOverrides[0].values.steps_rect, "{84,88,160,144}");
assert.equal(paddingOverrides[0].values.time_hour_high_pos, "{184,68}");
assert.equal(paddingOverrides[0].values.battery_icon_pos, "{34,48}");
assert.equal(paddingOverrides[0].values.control_step_rect, "{-6,8,60,74}");
assert.equal(paddingOverrides[0].values.am_pm_icon_pos, "{284,108}");
assert.equal(paddingOverrides[0].values.weather_icon_pos, "{484,148}");
assert.equal(paddingOverrides[1].values.steps_rect, "{92,94,150,132}");
assert.equal(paddingOverrides[2].values.steps_rect, "{95,96,147,128}");
assert.equal(paddingOverrides[3].values.steps_rect, "{95,96,146,127}");

// Placement preferences are editor-only, tolerate invalid storage, and clamp
// adjustable values without changing their opt-in defaults.
assert.deepEqual(
  normalizeWatchfacePlacementPreferences(null),
  DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES
);
assert.deepEqual(
  normalizeWatchfacePlacementPreferences({
    snapEnabled: true,
    guidesVisible: true,
    gridVisible: true,
    gridStep: 7,
    safeAreaInsetPercent: 99
  }),
  {
    snapEnabled: true,
    guidesVisible: true,
    gridVisible: true,
    gridStep: 8,
    safeAreaInsetPercent: 25
  }
);
const placementStorage = new Map();
const storageAdapter = {
  getItem: (key) => placementStorage.get(key) ?? null,
  setItem: (key, value) => placementStorage.set(key, value)
};
assert.deepEqual(
  readWatchfacePlacementPreferences(storageAdapter),
  DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES
);
writeWatchfacePlacementPreferences(storageAdapter, {
  ...DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES,
  snapEnabled: true,
  gridStep: 16
});
assert.equal(
  JSON.parse(placementStorage.get(WATCHFACE_PLACEMENT_STORAGE_KEY)).gridStep,
  16
);
assert.equal(readWatchfacePlacementPreferences(storageAdapter).snapEnabled, true);
placementStorage.set(WATCHFACE_PLACEMENT_STORAGE_KEY, "not-json");
assert.deepEqual(
  readWatchfacePlacementPreferences(storageAdapter),
  DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES
);

assert.deepEqual(watchfaceSafeAreaBounds(800, 800, 0), {
  x0: 0,
  y0: 0,
  x1: 800,
  y1: 800
});
assert.deepEqual(watchfaceSafeAreaBounds(800, 800, 10), {
  x0: 80,
  y0: 80,
  x1: 720,
  y1: 720
});
assert.deepEqual(watchfaceSafeAreaBounds(800, 800, 25), {
  x0: 200,
  y0: 200,
  x1: 600,
  y1: 600
});
assert.equal(watchfaceDesignThreshold(6, 800, 400), 12);
assert.equal(watchfaceDesignThreshold(6, 800, 0), 0);
assert.deepEqual(
  translateWatchfaceBounds({ x0: 10, y0: 20, x1: 30, y1: 40 }, 5, -10),
  { x0: 15, y0: 10, x1: 35, y1: 30 }
);
assert.deepEqual(
  scaleWatchfaceBounds({ x0: 10, y0: 20, x1: 30, y1: 40 }, 2, 3),
  { x0: 20, y0: 60, x1: 60, y1: 120 }
);
assert.deepEqual(
  backgroundElementSnapBounds({
    id: "line",
    kind: "line",
    x: 100,
    y: 100,
    dx: 40,
    dy: 0,
    rotation: 90,
    color: "#ffffff",
    strokeWidth: 4
  }),
  { x0: 98, y0: 98, x1: 102, y1: 142 }
);

const centerSnap = snapWatchfaceBounds({
  movingBounds: { x0: 351, y0: 350, x1: 451, y1: 450 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 2,
  safeAreaInsetPercent: 10,
  targets: []
});
assert.equal(centerSnap.dx, -1);
assert.equal(centerSnap.dy, 0);
assert.deepEqual(centerSnap.guides.map((guide) => guide.kind), [
  "face-center",
  "face-center"
]);
assert.equal(formatWatchfaceSnapStatus(centerSnap.guides), "Snapped to face center");

const safeAndLayerSnap = snapWatchfaceBounds({
  movingId: "moving",
  movingBounds: { x0: 83, y0: 500, x1: 183, y1: 550 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 4,
  safeAreaInsetPercent: 10,
  targets: [
    {
      id: "moving",
      label: "Moving",
      bounds: { x0: 82, y0: 498, x1: 182, y1: 548 }
    },
    {
      id: "hidden",
      label: "Hidden",
      visible: false,
      bounds: { x0: 80, y0: 498, x1: 180, y1: 548 }
    },
    {
      id: "steps",
      label: "Steps",
      bounds: { x0: 300, y0: 553, x1: 360, y1: 603 }
    }
  ]
});
assert.equal(safeAndLayerSnap.dx, -3);
assert.equal(safeAndLayerSnap.dy, 3);
assert.deepEqual(safeAndLayerSnap.guides.map((guide) => guide.kind), [
  "safe-area",
  "layer"
]);
assert.equal(
  formatWatchfaceSnapStatus(safeAndLayerSnap.guides),
  "Snapped to safe area + Aligned with Steps"
);

const gridSnap = snapWatchfaceBounds({
  movingBounds: { x0: 207, y0: 259, x1: 247, y1: 299 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  targets: [],
  gridStep: 16,
  gridLabel: "8 px"
});
assert.equal(gridSnap.dx, 1);
assert.equal(gridSnap.dy, -3);
assert.deepEqual(gridSnap.guides.map((guide) => guide.kind), ["grid", "grid"]);
assert.equal(formatWatchfaceSnapStatus(gridSnap.guides), "Snapped to 8 px grid");

const outsideThreshold = snapWatchfaceBounds({
  movingBounds: { x0: 346, y0: 100, x1: 446, y1: 150 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  targets: []
});
assert.deepEqual(outsideThreshold, { dx: 0, dy: 0, guides: [], measurements: [] });

// Equal-distance candidates honor semantic priority over layer and grid lines.
const prioritySnap = snapWatchfaceBounds({
  movingBounds: { x0: 353, y0: 200, x1: 453, y1: 250 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  targets: [
    {
      id: "layer",
      label: "Layer",
      bounds: { x0: 400, y0: 500, x1: 460, y1: 550 }
    }
  ]
});
assert.equal(prioritySnap.guides[0]?.kind, "face-center");

const safeAreaPrioritySnap = snapWatchfaceBounds({
  movingBounds: { x0: 83, y0: 200, x1: 123, y1: 240 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  targets: [
    {
      id: "layer",
      label: "Layer",
      bounds: { x0: 86, y0: 500, x1: 126, y1: 540 }
    }
  ]
});
assert.equal(safeAreaPrioritySnap.guides[0]?.kind, "safe-area");

const layerPrioritySnap = snapWatchfaceBounds({
  movingBounds: { x0: 211, y0: 101, x1: 251, y1: 141 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  gridStep: 16,
  targets: [
    {
      id: "layer",
      label: "Layer",
      bounds: { x0: 214, y0: 500, x1: 254, y1: 540 }
    }
  ]
});
assert.equal(layerPrioritySnap.guides[0]?.kind, "layer");

const faceEdgeSnap = snapWatchfaceBounds({
  movingBounds: { x0: 2, y0: 100, x1: 42, y1: 140 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  targets: []
});
assert.equal(faceEdgeSnap.dx, -2);
assert.equal(faceEdgeSnap.guides[0]?.kind, "face-edge");

const projectGuideSnap = snapWatchfaceBounds({
  movingBounds: { x0: 198, y0: 100, x1: 238, y1: 140 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  safeAreaInsetPercent: 10,
  targets: [],
  guides: [{ id: "guide", axis: "x", position: 200 }]
});
assert.equal(projectGuideSnap.dx, 2);
assert.equal(projectGuideSnap.guides[0]?.kind, "guide");

const heldGuide = snapWatchfaceBounds({
  movingBounds: { x0: 204, y0: 100, x1: 244, y1: 140 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 3,
  releaseThreshold: 5,
  safeAreaInsetPercent: 10,
  targets: [],
  guides: [{ id: "guide", axis: "x", position: 200 }],
  retainedGuides: projectGuideSnap.guides
});
assert.equal(heldGuide.dx, -4);
assert.equal(heldGuide.guides[0]?.targetId, "guide");

const spacingSnap = snapWatchfaceBounds({
  movingBounds: { x0: 41, y0: 100, x1: 51, y1: 110 },
  faceWidth: 800,
  faceHeight: 800,
  threshold: 2,
  safeAreaInsetPercent: 10,
  targets: [
    { id: "left", label: "Left", bounds: { x0: 20, y0: 100, x1: 30, y1: 110 } },
    { id: "right", label: "Right", bounds: { x0: 60, y0: 100, x1: 70, y1: 110 } }
  ]
});
assert.equal(spacingSnap.dx, -1);
assert.equal(spacingSnap.guides[0]?.kind, "spacing");
assert.ok(spacingSnap.measurements.some((measurement) => measurement.label === "10 px"));

// Representative 20-layer snap fixture stays comfortably inside one frame.
const performanceTargets = Array.from({ length: 20 }, (_, index) => ({
  id: `layer-${index}`,
  label: `Layer ${index}`,
  bounds: {
    x0: 20 + (index % 5) * 140,
    y0: 20 + Math.floor(index / 5) * 180,
    x1: 70 + (index % 5) * 140,
    y1: 70 + Math.floor(index / 5) * 180
  }
}));
const interactionDurations = [];
for (let index = 0; index < 250; index += 1) {
  const started = performance.now();
  snapWatchfaceBounds({
    movingBounds: { x0: 300 + (index % 9), y0: 300, x1: 380 + (index % 9), y1: 360 },
    faceWidth: 800,
    faceHeight: 800,
    threshold: 6,
    safeAreaInsetPercent: 10,
    targets: performanceTargets,
    gridStep: 8
  });
  interactionDurations.push(performance.now() - started);
}
interactionDurations.sort((left, right) => left - right);
assert.ok(interactionDurations[Math.floor(interactionDurations.length * 0.95)] < 16.7);

console.log("watchface editor history tests passed");
