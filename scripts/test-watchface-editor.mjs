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

console.log("watchface editor history tests passed");
