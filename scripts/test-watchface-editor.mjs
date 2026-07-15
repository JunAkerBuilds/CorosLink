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
  rotatedCenterBounds
} from "../src/watchfaces/watchfaceEditorGeometry.ts";
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

assert.equal(WATCHFACE_EDITOR_HISTORY_LIMIT, 50);

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
assert.deepEqual(outsideThreshold, { dx: 0, dy: 0, guides: [] });

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

console.log("watchface editor history tests passed");
