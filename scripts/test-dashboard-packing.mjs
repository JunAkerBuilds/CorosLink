import assert from 'node:assert/strict';
import { packDashboard } from '../src/training/dashboardPacking.ts';
const items = [{ span: 3, height: 180 }, { span: 3, height: 180 }, { span: 6, height: 400 }, { span: 3, height: 180 }, { span: 3, height: 180 }];
const packed = packDashboard(items);
assert.deepEqual(packed.positions, [{ column: 0, top: 0 }, { column: 3, top: 0 }, { column: 6, top: 0 }, { column: 0, top: 196 }, { column: 3, top: 196 }]);
assert.equal(packed.height, 400);
assert.equal(packDashboard([]).height, 0);
assert.deepEqual(packDashboard([{ span: 12, height: 100 }, { span: 12, height: 200 }]).positions, [{ column: 0, top: 0 }, { column: 0, top: 116 }]);
console.log('Dashboard packing fills space beneath shorter cards without overlapping taller neighbors');

// Pixel-sized compact squares occupy fractional grid spans, including next to tall charts.
for (const gridWidth of [350, 800, 1400, 2200]) {
  const compact = 168 / ((gridWidth + 16) / 12);
  const mixed = [compact, compact, 6, 3, compact, 12, compact, 6, compact].map((span, index) => ({ span, height: index % 3 ? 152 : 400 }));
  const { positions } = packDashboard(mixed);
  positions.forEach((position, i) => {
    assert.ok(position.column >= 0 && position.column + mixed[i].span <= 12 + 1e-7, 'Cards stay within the grid');
    for (let j = 0; j < i; j++) {
      const prior = positions[j];
      assert.ok(position.column + mixed[i].span <= prior.column + 1e-7 || prior.column + mixed[j].span <= position.column + 1e-7 || position.top >= prior.top + mixed[j].height + 16 || prior.top >= position.top + mixed[i].height + 16, 'Mixed compact and grid cards never overlap');
    }
  });
  assert.equal(positions[1].column, compact, 'Compact cards fill the space immediately beside each other');
}
console.log('Compact cards preserve exact widths, spacing and collision-free packing');

// Saved row starts must stack under HR/Steps, not wait for the taller VO2 card.
const gapRegression = [
  { span: 6, height: 376 }, { span: 6, height: 376 },
  { span: 3, height: 152 }, { span: 3, height: 152 }, { span: 6, height: 320 },
  { span: 3, height: 152, startRow: true }, { span: 3, height: 152 }
];
const localRows = packDashboard(gapRegression);
assert.deepEqual(localRows.positions[5], { column: 0, top: 560 });
assert.deepEqual(localRows.positions[6], { column: 3, top: 560 });
assert.equal(localRows.positions[5].top - localRows.positions[2].top - 152, 16);
const bottomRows = packDashboard(gapRegression.map((item, i) => i === 5 ? { ...item, atBottom: true } : item));
assert.equal(bottomRows.positions[5].top, 728, 'An explicit bottom drop still clears the tallest card');
console.log('Saved local row starts fill the gap below short cards; explicit bottom drops stay at the bottom');
const compactRows = packDashboard([
  { span: 3, height: 376 }, { span: 6, height: 376 },
  { span: 1.5, height: 180, startRow: true }, { span: 1.5, height: 180 },
  { span: 1.5, height: 180, startRow: true }, { span: 1.5, height: 180 }
]);
assert.deepEqual(compactRows.positions.slice(2), [
  { column: 0, top: 392 }, { column: 1.5, top: 392 },
  { column: 0, top: 588 }, { column: 1.5, top: 588 }
], 'A local row stays together instead of filling unused space beside an earlier row');
