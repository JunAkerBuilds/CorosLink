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

// Local-Only Mode keeps its own layout without the COROS-only widgets, and never rewrites the saved one.
const { localDefaultLayout, parseLocalLayout, isCorosOnlyWidget, localDashboardStorageKey, dashboardStorageKey } = await import('../src/training/dashboardLayout.ts');
assert.equal(localDashboardStorageKey, `${dashboardStorageKey}.local`);
const localDefaults = localDefaultLayout();
assert.ok(localDefaults.length > 0 && !localDefaults.some(w => isCorosOnlyWidget(w.id)), 'the Local-Only default has only cards the watch can fill');
assert.deepEqual(localDefaults.slice(0, 2).map(w => w.id), ['sleep', 'healthCheck'], 'watch readings lead');
assert.deepEqual(parseLocalLayout(null, null), localDefaults, 'no saved layout: the Local-Only default');
assert.deepEqual(parseLocalLayout(null, JSON.stringify({ version: 3, widgets: defaultLayout() })), localDefaults, 'an unchanged default starts from the Local-Only default');
assert.deepEqual(parseLocalLayout(null, JSON.stringify({ version: 3, widgets: [...defaultLayout(), { ...defaultWidgetFor('coach'), size: 12, preset: '12-standard', startRow: true }] })).map(w => w.id),
  [...localDefaults.map(w => w.id), 'coach'], 'a pinned chart panel is kept');
assert.deepEqual(parseLocalLayout(null, JSON.stringify({ version: 3, widgets: ['stress', 'scores', 'sleep', 'race'].map(defaultWidgetFor) })).map(w => w.id),
  ['stress', 'sleep'], 'a custom layout keeps its order without the COROS-only widgets');
assert.deepEqual(parseLocalLayout(null, JSON.stringify({ version: 3, widgets: ['scores', 'race'].map(defaultWidgetFor) })), localDefaults, 'nothing left: the Local-Only default');
for (const id of ['vo2', 'recovery', 'load-balance']) {
  assert.ok(!isCorosOnlyWidget(id) && localDefaults.some(w => w.id === id), `${id} comes from the watch's activities`);
}
assert.deepEqual(parseLocalLayout(JSON.stringify({ version: 3, widgets: ['recovery'].map(defaultWidgetFor) }), null).map(w => w.id), ['recovery'], 'a saved Local-Only layout is used as is, including widgets added back');
assert.deepEqual(parseLocalLayout('broken', null), localDefaults);
const localStore = new Map([[dashboardStorageKey, JSON.stringify({ version: 3, widgets: [defaultWidgetFor('sleep')] })], [localDashboardStorageKey, JSON.stringify({ version: 3, widgets: [defaultWidgetFor('stress')] })]]);
const localStorageStub = { getItem: key => localStore.get(key) ?? null, setItem: (key, value) => localStore.set(key, value) };
assert.equal(ensureDashboardWidget('coach', localStorageStub), true);
assert.deepEqual(parseLayout(localStore.get(dashboardStorageKey)).map(w => w.id), ['sleep', 'coach']);
assert.deepEqual(parseLayout(localStore.get(localDashboardStorageKey)).map(w => w.id), ['stress', 'coach'], 'a saved Local-Only layout gets the pinned charts too');
assert.equal(ensureDashboardWidget('coach', localStorageStub), false);
console.log('Local-Only dashboard layout checks passed');
