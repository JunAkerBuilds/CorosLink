import assert from 'node:assert/strict';
import { sizePresets, nearestSizePreset, sizePresetHeight, sizePresetWidth } from '../src/training/widgetSizing.ts';
import { parseLayout, defaultWidget, widgetPresets } from '../src/training/dashboardLayout.ts';
const presets = sizePresets('daily-steps', [3, 4, 6]);
const choices = presets.map(preset => ({ preset, width: sizePresetWidth(preset, 1184), height: sizePresetHeight(preset, sizePresetWidth(preset, 1184)) }));
assert.equal(nearestSizePreset(choices, 284, 152, '3-standard').id, '3-standard');
assert.equal(nearestSizePreset(choices, 284, 248, '3-standard').id, '3-tall');
assert.equal(nearestSizePreset(choices, 584, 248, '3-standard').id, '6-tall');
assert.equal(nearestSizePreset(choices, -100, -100, '3-standard').id, 'compact-square');
assert.equal(nearestSizePreset(choices, 10000, 10000, '3-standard').id, '6-square');
assert.equal(nearestSizePreset(choices, 335, 152, '3-standard').id, '3-standard', 'Snap boundary has a dead band');
const migrated = parseLayout(JSON.stringify({ version: 2, widgets: [{ id: 'daily-steps', size: 12 }, { id: 'recovery', size: 4, title: 'Ready' }] }));
assert.equal(migrated[0].size, 6, 'Oversized old metric tiles migrate to a supported shape');
assert.equal(migrated[0].preset, '6-standard');
assert.equal(migrated[1].title, 'Ready');
const saved = { ...defaultWidget('sleep'), size: 6, preset: '6-tall' };
assert.deepEqual(parseLayout(JSON.stringify({ version: 3, widgets: [saved] })), [saved]);
assert.equal(parseLayout(JSON.stringify({ version: 3, widgets: [{ ...saved, preset: '100-tall' }] }))[0].preset, '6-standard');
assert.ok(widgetPresets('heatmap').some(preset => preset.expanded), 'Full-width widgets can change height');
console.log('Widget shape selection, boundaries, migration and persistence passed');

for (const gridWidth of [430, 1184, 1500, 1800]) {
  const compact = presets.find(preset => preset.id === 'compact-square');
  const compactWidth = sizePresetWidth(compact, gridWidth);
  for (const preset of presets.filter(preset => preset.matchCompactHeight)) {
    assert.equal(sizePresetHeight(preset, sizePresetWidth(preset, gridWidth), gridWidth), compactWidth + (preset.expanded ? 96 : 0), 'Metric width changes keep the compact height baseline');
  }
}

for (const id of ['daily-calories', 'daily-steps', 'daily-load', 'daily-heart']) {
  const square = widgetPresets(id).find(preset => preset.id === '3-square');
  assert.ok(square, `${id} supports square`);
  assert.equal(sizePresetHeight(square, 350), 350);
  const widget = { ...defaultWidget(id), preset: square.id, size: square.columns };
  assert.deepEqual(parseLayout(JSON.stringify({ version: 3, widgets: [widget] })), [widget]);
}
assert.equal(nearestSizePreset(choices, 284, 284, '3-tall').id, '3-square');
console.log('Square metric presets snap and persist');

for (const id of ['daily-calories', 'daily-steps', 'daily-load', 'daily-heart']) {
  const compact = widgetPresets(id).find(preset => preset.id === 'compact-square');
  assert.ok(compact);
  for (const width of [350, 800]) {
    assert.equal(sizePresetWidth(compact, width), 152);
    assert.equal(sizePresetWidth(compact, width, 18), 170, 'Editing chrome is outside the square');
  }
  for (const width of [1184, 1400, 1600, 2200]) {
    const small = widgetPresets(id).find(preset => preset.id === '3-standard');
    assert.ok(Math.abs(sizePresetWidth(compact, width) * 2 + 16 - sizePresetWidth(small, width)) < .001, 'Two compact squares align with a small card');
    assert.equal(sizePresetWidth(compact, width, 18), sizePresetWidth(compact, width), 'Editor wrappers stay on the same grid');
  }
  const widget = { ...defaultWidget(id), preset: compact.id, size: compact.columns };
  assert.deepEqual(parseLayout(JSON.stringify({ version: 3, widgets: [widget] })), [widget]);
}
assert.equal(nearestSizePreset(choices, 152, 152, '3-standard').id, 'compact-square', 'Horizontal shrink reaches a compact square without adding height');
console.log('Compact square widths and persistence passed');

// Intermediate windows must reflow small saved presets before their content gets squeezed.
for (const width of [851, 900, 1024, 1150]) {
  for (const id of ['healthCheck', 'recovery', 'vo2', 'trend-load', 'scores', 'race', 'upcoming']) {
    const small = widgetPresets(id).find(preset => preset.columns === 3);
    assert.equal(sizePresetWidth(small, width), (width - 16) / 2, `${id} uses half the available width`);
  }
  const compact = presets.find(preset => preset.id === 'compact-square');
  assert.ok(Math.abs(2 * sizePresetWidth(compact, width) + 16 - (width - 16) / 2) < .001,
    'Compact pairs align with a reflowed panel');
  const wide = widgetPresets('stress').find(preset => preset.columns === 8);
  assert.equal(sizePresetWidth(wide, width), width, 'Wide charts use the full row');
}

for (const preset of widgetPresets('healthCheck')) {
  const widget = { ...defaultWidget('healthCheck'), size: preset.columns, preset: preset.id };
  assert.deepEqual(parseLayout(JSON.stringify({ version: 3, widgets: [widget] })), [widget]);
  if (preset.aspectRatio) assert.equal(sizePresetHeight(preset, 960), 960 / preset.aspectRatio);
}
console.log('Health check proportions and saved sizes passed');

for (const id of ['stress', 'sleepHrv', 'trend-load', 'trend-rpe', 'trend-hrv', 'trend-sleep', 'zones-heart', 'zones-distance', 'scores', 'race', 'effort', 'upcoming', 'cycle']) {
  const presets = widgetPresets(id);
  assert.equal(presets.length, 20);
  for (const preset of presets) {
    const widget = { ...defaultWidget(id), size: preset.columns, preset: preset.id };
    assert.deepEqual(parseLayout(JSON.stringify({ version: 3, widgets: [widget] })), [widget]);
    const choices = presets.map(p => ({ preset: p, width: sizePresetWidth(p, 1500), height: sizePresetHeight(p, sizePresetWidth(p, 1500)) }));
    assert.equal(nearestSizePreset(choices, sizePresetWidth(preset, 1500), preset.minHeight, '6-standard').id, preset.id);
  }
}
console.log('All chart sizes snap and persist across shared height tiers');
