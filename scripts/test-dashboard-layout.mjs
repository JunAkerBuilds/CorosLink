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

// ensureDashboardWidget adds a missing widget once and leaves custom layouts alone otherwise.
const { ensureDashboardWidget } = await import('../src/training/dashboardLayout.ts');
const store = new Map();
const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
assert.equal(ensureDashboardWidget('coach', storage), true, 'coach is added to a fresh dashboard');
const added = parseLayout(store.get('coroslink.training-dashboard.v1'));
assert.deepEqual(added.slice(0, -1), defaultLayout(), 'the default widgets stay in place');
assert.equal(added.at(-1).id, 'coach');
assert.equal(added.at(-1).size, 12);
assert.equal(added.at(-1).startRow, true, 'the pinned charts panel starts its own row');
assert.equal(ensureDashboardWidget('coach', storage), false, 'a second call changes nothing');
assert.deepEqual(parseLayout(store.get('coroslink.training-dashboard.v1')), added);
store.set('coroslink.training-dashboard.v1', JSON.stringify({ version: 3, widgets: [defaultWidgetFor('sleep')] }));
assert.equal(ensureDashboardWidget('coach', storage), true);
assert.deepEqual(parseLayout(store.get('coroslink.training-dashboard.v1')).map(w => w.id), ['sleep', 'coach'], 'custom layouts keep their widgets');
function defaultWidgetFor(id) { return { id, size: 6, preset: '6-standard', title: '', days: 0, metrics: ['load', 'heart', 'steps', 'calories'] }; }
console.log('Dashboard widget auto-add checks passed');
