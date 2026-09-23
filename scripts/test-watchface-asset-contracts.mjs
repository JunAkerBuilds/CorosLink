import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

const require = createRequire(import.meta.url);
const { focusWatchfaceDocument } = require("../dist-electron/watchfaceAiContext.js");
const [{ watchfaceAutomationAssetContracts }, { batteryPreviewStateIndex }, { parseWatchfacePreviewScenario }] = await loadWatchfaceTestModules([
  "/src/watchfaces/watchfaceAutomationAssetContracts.ts",
  "/src/watchfaces/watchfaceStudio.ts",
  "/src/watchfaces/watchfaceSimulation.ts"
]);
const folder = (name, count, width = 32, height = 16) => ({
  folder: name, kind: "state", aod: name.startsWith("a/"),
  // Deliberately non-numeric filenames: export keys are array indices.
  files: Array.from({ length: count }, (_, index) => ({ path: `master/${name}/frame-${20 + index}.png`, width, height }))
});
const template = {
  directory: "master", width: 800, height: 800,
  config: { battery_icon_dir: "fixed", control_battery_icon_dir: "selectable" }, aodConfig: {},
  spriteFolders: [folder("fixed", 12), folder("selectable", 4, 40, 20)], icons: []
};
const design = { configAssetOverrides: {} };
const contracts = watchfaceAutomationAssetContracts(template, design);
const [fixed, selectable] = contracts;
assert.equal(fixed.layerId, "batteryIcon");
assert.equal(selectable.layerId, "controlBatteryIcon");
assert.equal(fixed.kind, "state-sprites");
assert.equal(fixed.stateMappingKnown, true);
assert.deepEqual(fixed.states.map(state => state.meaning), ["Charging", "0%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"]);
assert.equal(selectable.stateMappingKnown, false);
assert.ok(selectable.states.every(state => state.meaning === null));
assert.deepEqual(contracts.find(contract => contract.id === "template:fixed").frames.map(frame => frame.meaning), fixed.states.map(state => state.meaning));
assert.equal(fixed.stateReplacementsPath, "/design/configAssetOverrides/config:battery_icon/stateReplacements");
assert.equal(selectable.stateReplacementsPath, "/design/configAssetOverrides/config:control_battery_icon/stateReplacements");
assert.equal(fixed.stateIndices.length, 12);
assert.equal(selectable.stateIndices.length, 4, "different slots retain their own exact template counts");
assert.deepEqual(fixed.stateIndices, Array.from({ length: 12 }, (_, index) => String(index)));
assert.equal(fixed.states[0].path, "master/fixed/frame-20.png");
assert.equal(fixed.states[11].replacementPath, `${fixed.stateReplacementsPath}/11`);
assert.deepEqual([selectable.states[0].width, selectable.states[0].height], [40, 20]);
assert.equal(selectable.verification.setup.tool, "set_view", "selecting the battery complication uses set_view rather than an invalid render_preview parameter");
for (const contract of contracts.filter(contract => contract.kind === "state-sprites")) {
  assert.equal(contract.templateKnown, true);
  assert.deepEqual(contract.verification.scenarios.map((entry) => entry.scenario.values.battery), ["0", "50", "100"]);
  for (const example of contract.verification.scenarios) {
    assert.doesNotThrow(() => parseWatchfacePreviewScenario(example.scenario));
    assert.equal(example.expectedPreviewStateIndex, String(batteryPreviewStateIndex(contract.stateIndices.length, Number(example.scenario.values.battery))));
  }
}
assert.deepEqual(fixed.verification.scenarios.map((entry) => entry.expectedPreviewStateIndex), ["1", "6", "11"], "COROS normal levels skip charging and include the full frame");
assert.deepEqual(selectable.verification.scenarios.map((entry) => entry.expectedPreviewStateIndex), ["0", "2", "3"]);

const overrides = watchfaceAutomationAssetContracts(template, { configAssetOverrides: {
  "config:battery_icon": { replacement: { dataUrl: "data:image/png;base64,PRIVATE", width: 1000, height: 500 }, stateReplacements: { "10": {}, "2": {}, "0": {} } }
} });
assert.equal(overrides[0].hasStaticReplacement, true);
assert.deepEqual(overrides[0].installedStateIndices, ["0", "2", "10"]);
assert.match(overrides[0].replacementWarning, /static/);
assert.equal(overrides[0].stateIndices.length, 12, "partial replacements cannot reduce the required template inventory");
assert.ok(!JSON.stringify(overrides).includes("PRIVATE"), "capabilities never copy PNG payloads");

const unknown = watchfaceAutomationAssetContracts(null, { configAssetOverrides: { "config:battery_icon": { stateReplacements: { "0": {}, "1": {} } } } });
assert.equal(unknown[0].templateKnown, false);
assert.deepEqual(unknown[0].stateIndices, [], "missing template cannot invent a ten- or twelve-state requirement");
assert.deepEqual(unknown[0].installedStateIndices, ["0", "1"]);
assert.equal(unknown[0].verification.scenarios[0].expectedPreviewStateIndex, null);

const aod = watchfaceAutomationAssetContracts({ ...template,
  directory: "small", width: 416, height: 416,
  config: { battery_icon_dir: "a\\fixed" }, spriteFolders: [folder("a/fixed", 6), folder("a/battery", 3)]
}, design, "aod");
assert.equal(aod[0].templateFolder, "a/fixed");
assert.equal(aod[1].templateFolder, "a/battery", "selectable fallback matches the renderer's AOD battery folder");
assert.equal(aod[0].stateReplacementsPath, "/design/modeDesigns/aod/configAssetOverrides/config:battery_icon/stateReplacements");
assert.equal(aod[0].editStateReplacementsPath, "/design/configAssetOverrides/config:battery_icon/stateReplacements");
assert.equal(aod[0].referenceFrame.width, 416);

const isolated = watchfaceAutomationAssetContracts({ ...template, config: {}, spriteFolders: [folder("cl_battery_icon", 7)] }, design);
assert.equal(isolated[0].stateIndices.length, 7, "fixed export fallback retains actual state count");
assert.equal(isolated[1].templateKnown, false, "fixed fallback does not bleed into selectable battery");
const compact = focusWatchfaceDocument({ design, capabilities: { assetContracts: contracts, nativeResolutions: [template] } });
assert.deepEqual(compact.capabilities.assetContracts, contracts, "focused AI document retains state contracts after removing large native sprite catalogs");

// A real component inventory mixes fonts, conditional state sets, single PNGs
// and firmware-drawn graphs; an image job must not flatten them into one PNG.
const completeTemplate = { ...template,
  config: { ...template.config, english_date_week_font: "week", english_date_month_font: "month",
    time_hour_icon: "icon/hour.png", am_icon: "icon/am.png", pm_icon: "icon/pm.png" },
  spriteFolders: [...template.spriteFolders, { ...folder("week", 7), kind: "week" }, { ...folder("month", 12), kind: "month" }],
  icons: [{ path: "master/icon/hour.png", width: 12, height: 150 }]
};
const completeDesign = { ...design, nativeData: {
  sunriseset: { enabled: true, x: 0, y: 0, scale: 1, color: "#ffffff" },
  weather_direction: { enabled: true, x: 0, y: 0, scale: 1, color: "#ffffff", stateCount: 8 },
  chart: { enabled: true, x: 0, y: 0, scale: 1, color: "#ffffff", chartSource: "chart_moon" }
} };
const inventory = watchfaceAutomationAssetContracts(completeTemplate, completeDesign);
const component = id => { const match = inventory.find(c => c.id === id); assert.ok(match, `Missing contract ${id}`); return match; };
assert.deepEqual(component("typography:weekday").orderedValues, ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
assert.deepEqual(component("typography:dateMonth").orderedValues, ["DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV"]);
assert.equal(component("template:month").frames[0].meaning, "DEC");
assert.equal(component("template:fixed").frames[0].meaning, "Charging", "battery folder inventory includes COROS meanings");
assert.equal(component("template:selectable").frames[0].meaning, null, "nonstandard states must not inherit digit meanings");
assert.equal(component("template:fixed").frames[0].file, "frame-20.png", "preserve importer array order instead of parsing file numbers");
assert.equal(component("typography:control").editRasterFontPath, "/design/selectableMetricStyle/rasterFont");
assert.equal(component("typography:hours").spriteCount, 10);
assert.equal(component("weather:day").spriteCount, 41);
assert.deepEqual(component("weather:night").stateIndices, component("weather:day").stateIndices);
assert.equal(component("weather:day").orderedValues, null, "condition names cannot be guessed from numeric indices");
assert.deepEqual(component("weather:symbols").orderedValues, ["minus", "degree"]);
assert.deepEqual(component("weather:units").orderedValues, ["°C", "°F"]);
for (const set of ["day", "night"]) {
  const contract = component(`weather:${set}`);
  assert.equal(contract.enabled, false, "absent weather style cannot verify installed states as visible");
  assert.deepEqual(contract.verification.scenarios.map(sample => sample.expectedPreviewStateIndex), ["0", "20", "40"]);
  for (const sample of contract.verification.scenarios) {
    assert.doesNotThrow(() => parseWatchfacePreviewScenario(sample.scenario));
    assert.equal(sample.scenario.weather.night, set === "night");
  }
}
assert.equal(component("weather:units").verification.supported, false, "the preview cannot select alternate firmware units");
assert.deepEqual(component("native:sunriseset:symbols").stateIndices, ["3"], "a sparse colon key must not be renumbered to zero");
assert.equal(component("native:weather_direction:states").spriteCount, 8, "recovered state count overrides catalog's 16-state default");
assert.equal(component("native:chart:states").spriteCount, 30);
assert.equal(component("native:chart:plot").spriteCount, 0);
assert.equal(component("kcalProgress").spriteCount, 0);
assert.equal(component("config:time_hour_icon").kind, "rotating-sprite");
assert.equal(component("config:time_hour_icon").spriteCount, 1);
assert.deepEqual(component("config:time_hour_icon").sourceSize, { width: 12, height: 150 });
assert.equal(component("config:time_hour_icon").editReplacementPath, "/design/configAssetOverrides/config:time_hour_icon/replacement");
assert.equal(component("ampm").templateKnown, true);
assert.equal(component("separator:colon").spriteCount, 0);
const modeContracts = watchfaceAutomationAssetContracts(completeTemplate, completeDesign, "aod");
for (const [id, documentKey, editKey] of [
  ["typography:control", "rasterFontPath", "editRasterFontPath"],
  ["weather:day", "assetsPath", "editAssetsPath"],
  ["native:sunriseset:symbols", "assetsPath", "editAssetsPath"],
  ["config:time_hour_icon", "replacementPath", "editReplacementPath"]
]) {
  const contract = modeContracts.find(c => c.id === id);
  assert.equal(contract[documentKey], contract[editKey].replace(/^\/design/, "/design/modeDesigns/aod"));
}
const numericMonth = watchfaceAutomationAssetContracts(completeTemplate, { ...design, dateStyles: { dateMonth: { monthFormat: "digits" } } });
assert.equal(numericMonth.find(c => c.id === "typography:dateMonth").spriteCount, 10);
console.log("Watchmaker component contracts passed: template counts/order, calendar fonts, weather sets, native roles, single images, drawn progress, active-mode paths and compact context.");

const disabledStates = watchfaceAutomationAssetContracts(null, { nativeData: {
  stamina: { enabled: true, x: 0, y: 0, scale: 1, parts: { states: { enabled: false } } }
} }).find(c => c.id === "native:stamina:states");
assert.equal(disabledStates.enabled, false, "disabled subcomponents cannot claim live state verification");
const hiddenWind = watchfaceAutomationAssetContracts(null, { nativeData: {
  chart: { enabled: true, x: 200, y: 400, scale: 1, chartSource: "chart_stress" },
  weather_direction: { enabled: true, x: 0, y: 0, scale: 1 },
  weather_wind: { enabled: true, x: 0, y: 0, scale: 1 },
  weather_temp_min: { enabled: true, x: 0, y: 0, scale: 1 }
} }).find(c => c.id === "native:weather_direction:states");
assert.equal(hiddenWind.hiddenByChartGroup, true);
assert.equal(hiddenWind.enabled, false, "a hidden chart-group component is not being previewed");
