import assert from 'node:assert/strict';
import { dashboardDropTarget } from '../src/training/dashboardDrop.ts';
import { defaultWidget, moveWidget, parseLayout } from '../src/training/dashboardLayout.ts';
import { packDashboard } from '../src/training/dashboardPacking.ts';

const cards = [
  { id: 'daily-steps', left: 0, top: 0, right: 152, bottom: 152 },
  { id: 'sleep', left: 168, top: 0, right: 600, bottom: 400 },
  { id: 'daily-load', left: 0, top: 168, right: 152, bottom: 320 }
];
assert.equal(dashboardDropTarget(cards, 'daily-steps', 60, 60), null, 'Dropping back on the source cancels');
assert.deepEqual(dashboardDropTarget(cards, 'daily-steps', 76, 310), { index: 2, startRow: true, anchor: 'daily-load' }, 'The lower edge inserts after a lower card');
assert.deepEqual(dashboardDropTarget(cards, 'daily-steps', 76, 175), { index: 1, startRow: false, anchor: 'daily-load' }, 'The upper edge inserts before a lower card');
assert.deepEqual(dashboardDropTarget(cards, 'daily-load', 76, 8), { index: 0, startRow: false, anchor: 'daily-steps' }, 'Upward moves still work');
assert.deepEqual(dashboardDropTarget(cards, 'daily-steps', 80, 416), { index: 2, startRow: true, atBottom: true }, 'Empty space below the layout appends');
assert.deepEqual(dashboardDropTarget(cards, 'daily-steps', 605, 200), { index: 1, startRow: false, anchor: 'sleep' }, 'Side drops stay in the row');
const layout = cards.map(card => defaultWidget(card.id));
const moved = moveWidget(layout, 'daily-steps', 2, true, true);
assert.equal(moved.at(-1).id, 'daily-steps');
assert.equal(moved.at(-1).startRow, true);
assert.deepEqual(parseLayout(JSON.stringify({ version: 3, widgets: moved })), moved, 'Bottom placement survives reload');
assert.equal(moveWidget(moved, 'daily-steps', 0)[0].startRow, undefined, 'Moving back inline releases the row break');
assert.equal(moveWidget(moved, 'daily-steps', 2, true, true), moved, 'Repeated drops do not create extra undo entries');
const packed = packDashboard([{ span: 6, height: 400 }, { span: 3, height: 152 }, { span: 1.5, height: 152, startRow: true, atBottom: true }]);
assert.deepEqual(packed.positions[2], { column: 0, top: 416 }, 'A bottom drop cannot rise into a shorter column');
console.log('Downward, upward, side and bottom drops, row placement and persistence passed');
