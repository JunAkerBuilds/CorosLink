import assert from 'node:assert/strict';
import { defaultLayout, parseLayout, moveWidget } from '../src/training/dashboardLayout.ts';
const defaults = defaultLayout();
assert.deepEqual(parseLayout('broken'), defaults);
assert.deepEqual(parseLayout('{"version":99,"widgets":[]}'), defaults);
assert.deepEqual(parseLayout('{"version":1,"widgets":[]}'), []);
const saved = JSON.stringify({ version: 1, widgets: [{ id: 'sleep', size: 6, title: 'My sleep' }, { id: 'recovery', size: -1, metrics: ['steps', 'unknown'] }, { id: 'sleep' }, null, { id: 'unknown' }] });
const restored = parseLayout(saved);
assert.equal(restored.length, 3);
assert.equal(restored[0].title, 'My sleep');
assert.equal(restored[0].size, 6);
assert.equal(restored[1].size, 3);
assert.deepEqual(restored[1].metrics, ['steps']);
assert.deepEqual(moveWidget(restored, 'recovery', 0).map(w => w.id), ['recovery', 'sleep', 'daily-steps']);
assert.equal(restored[0].id, 'sleep');
assert.deepEqual(moveWidget(restored, 'sleep', -1), restored);
assert.deepEqual(parseLayout(JSON.stringify({ version: 2, widgets: defaults })), defaults);
console.log('Dashboard persistence and ordering checks passed');

const migrated = parseLayout(JSON.stringify({ version: 1, widgets: [
  { id: 'health', title: 'My health' }, { id: 'trends', days: 30 }, { id: 'zones' }, { id: 'sleep', size: 6 }
] }));
assert.deepEqual(migrated.map(w => w.id), ['stress', 'sleepHrv', 'healthCheck', 'cycle', 'trend-load', 'trend-rpe', 'trend-hrv', 'trend-sleep', 'zones-heart', 'zones-distance', 'sleep']);
assert.equal(migrated[0].title, 'My health');
assert.equal(migrated.find(w => w.id === 'trend-hrv').days, 30);
assert.equal(migrated.at(-1).size, 6);
assert.ok(!defaultLayout().some(w => w.id === 'cycle'), 'Cycle is opt-in in new layouts');
const withoutCycle = migrated.filter(w => w.id !== 'cycle');
assert.deepEqual(parseLayout(JSON.stringify({ version: 2, widgets: withoutCycle })), withoutCycle);
assert.deepEqual(parseLayout(JSON.stringify({ version: 1, widgets: [{ id: 'recovery', metrics: [] }] })).map(w => w.id), ['recovery']);
assert.deepEqual(parseLayout(JSON.stringify({ version: 2, widgets: [] })), []);
console.log('Individual widgets and legacy migration checks passed');
