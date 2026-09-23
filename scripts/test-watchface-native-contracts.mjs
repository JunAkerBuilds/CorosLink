import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

const [automation, parts, catalog] = await loadWatchfaceTestModules([
  "/src/watchfaces/nativeDataAutomation.ts",
  "/src/watchfaces/nativeDataParts.ts",
  "/electron/watchfaceNativeCatalog.ts"
]);
const describe = (id, overrides = {}) => automation.describeNativeDataComponents(id, { ...parts.defaultNativeDataStyle(id), ...overrides });
const role = (id, name, overrides) => describe(id, overrides).find(part => part.assetRole === name);

// Cover every exported native field and every chart source, including sparse
// symbol keys and field-specific unit counts, against the inspector/exporter.
for (const entry of [
  ...catalog.NATIVE_DATA_FIELDS.map(field => ({ id: field.id })),
  ...catalog.NATIVE_CHART_SOURCES.map(source => ({ id: "chart", chartSource: source.id }))
]) {
  const style = { ...parts.defaultNativeDataStyle(entry.id), ...(entry.chartSource ? { chartSource: entry.chartSource } : {}) };
  const components = automation.describeNativeDataComponents(entry.id, style);
  assert.deepEqual(components.map(part => part.id), parts.nativeParts(entry.id, style));
  for (const part of components) {
    if (!part.assetRole) {
      assert.equal(part.spriteCount, 0);
      continue;
    }
    const expected = parts.nativeRoleIndices(entry.id, style, part.assetRole).map(String);
    assert.deepEqual(part.stateIndices, expected);
    assert.equal(part.spriteCount, expected.length);
    assert.deepEqual(part.states.map(state => state.index), expected);
    assert.ok(part.states.every(state => typeof state.meaning === "string" && state.meaning.length > 0));
    assert.equal(part.assetsPath, `/design/nativeData/${entry.id}/assets/${part.assetRole}`);
    assert.ok(part.requiredImageSize.width > 0 && part.requiredImageSize.height > 0);
  }
}

assert.deepEqual(role("stress", "digits").states.map(state => state.meaning), Array.from({ length: 10 }, (_, i) => `Digit ${i}`));
assert.deepEqual(role("sunriseset", "symbols").stateIndices, ["3"]);
assert.equal(role("sunriseset", "symbols").states[0].meaning, "Time colon");
assert.deepEqual(role("chart", "icon", { chartSource: "chart_moonrise" }).states.map(state => state.meaning), ["Moonrise", "Moonset"]);
assert.equal(role("chart", "icon", { chartSource: "chart_step" }).spriteCount, 1);
assert.deepEqual(role("weather_temp_min", "unit").states.map(state => state.meaning), ["Unit °C (metric)", "Unit °F (imperial)"]);
assert.deepEqual(role("today_swim", "unit").states.map(state => state.meaning), ["Unit m (metric)", "Unit yd (imperial)"]);
assert.deepEqual(role("today_elev", "unit").states.map(state => state.meaning), ["Unit m (metric)", "Unit ft (imperial)"]);
assert.equal(role("weather_temp", "unit").spriteCount, 1);
assert.equal(role("weather_uv", "states").states[5].meaning, "Extreme UV (11+)");
assert.equal(role("stamina", "states").states[10].meaning, "Stamina 100%");
assert.equal(role("sedentary", "states").states[6].meaning, "Inactive (dimmed)");
assert.ok(role("sleep_hrv_level", "states").states.every(state => state.meaningSource === "unknown"));
assert.equal(role("chart", "states", { chartSource: "chart_moon" }).spriteCount, 30);
const recovered = role("weather_direction", "states", { stateCount: 8 });
assert.equal(recovered.spriteCount, 8);
assert.ok(recovered.states.every(state => state.meaningSource === "unknown"), "do not apply a 16-direction mapping to an eight-frame recovered table");
assert.ok(role("stamina", "states", { stateCount: 12 }).states.every(state => state.meaningSource === "unknown"), "different template counts require inspection");
const custom = role("stress", "digits", { scale: 2, parts: { value: { width: 200, height: 50, digitWidth: 30 } }, assetTexts: { digits: { "0": "custom text" } }, assets: { digits: { "0": "asset-zero", "9": "asset-nine", "20": "invalid" } } });
assert.equal(custom.requiredImageSize.width, 60);
assert.equal(custom.requiredImageSize.height, 100);
assert.equal(custom.states[0].meaning, "Digit 0", "custom text never changes state semantics");
assert.deepEqual(custom.installedStateIndices, ["0", "9"]);
console.log("Native sprite contract tests passed for all fields and chart sources.");

assert.deepEqual(role("stamina", "states").verification.scenarios.map(sample => [sample.scenario.values.stamina, sample.expectedPreviewStateIndex]), [["0", "0"], ["50", "5"], ["100", "10"]]);
assert.deepEqual(role("weather_uv", "states").verification.scenarios.map(sample => [sample.scenario.values.weather_uv, sample.expectedPreviewStateIndex]), [["-1", "0"], ["6", "3"], ["11", "5"]]);
assert.deepEqual(role("chart", "states", { chartSource: "chart_moon" }).verification.scenarios.map(sample => sample.scenario.values.chart_moon), ["0", "15", "29"]);
assert.deepEqual(role("weather_direction", "states", { stateCount: 8 }).verification.scenarios.map(sample => sample.scenario.values.weather_direction), ["0", "4", "7"]);
assert.equal(role("weather_uv", "states", { stateCount: 8 }).verification.supported, false);
assert.equal(role("stamina", "states", { stateCount: 12 }).verification.supported, false);
assert.equal(role("sleep_hrv_level", "states").verification.scope, "editor-state-selection");
assert.match(role("sleep_hrv_level", "states").verification.note, /not firmware timing, health-category meaning/);
