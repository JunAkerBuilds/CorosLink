// A recovered official face converted to another watch is an ordinary
// editable archive that still carries the face's own weather icons and
// native-data sprites. Opening it must hydrate those, as recovery does,
// instead of substituting the editor's generated weather defaults.
import assert from "node:assert/strict";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";

// weatherAssets globs its bundled icons, so load through Vite like the app.
const [{ recoverWatchfaceDesign }, { getWeatherCapability }] = await loadWatchfaceTestModules([
  "/src/watchfaces/recoveredWatchfaceDesign.ts", "/src/watchfaces/weatherAssets.ts"
]);

const directory = "watchface_390x390";
const folder = (name, count, width, height) => ({
  folder: name, kind: "digits",
  files: Array.from({ length: count }, (_, index) => ({ path: `${directory}/${name}/${String(index).padStart(2, "0")}.png`, width, height }))
});
const converted = {
  archiveId: "converted-pace-4",
  resolutions: [{
    directory, width: 390, height: 390, aodConfig: {},
    config: {
      bg_color: "0x000000",
      weather_icon_dir: "studio\\current_weather_h364ld",
      weather_icon_pos: "{238,107}",
      weather_dark_icon_dir: "studio\\current_weather2_1rwxv2",
      weather_temp_font: "studio\\current_cl_nd_weather_temp_d_1le3zm",
      weather_temp_rect: "{283,114,316,141,left|vcenter}",
      weather_negasign_icon: "studio\\current_00_wnq9an\\00.png",
      weather_dgree_icon: "studio\\current_00_itnvt5\\00.png"
    },
    spriteFolders: [
      folder("studio/current_weather_h364ld", 41, 39, 39),
      folder("studio/current_weather2_1rwxv2", 41, 39, 39),
      folder("studio/current_cl_nd_weather_temp_d_1le3zm", 10, 17, 26)
    ],
    icons: [
      { path: `${directory}/studio/current_00_wnq9an/00.png`, width: 13, height: 26 },
      { path: `${directory}/studio/current_00_itnvt5/00.png`, width: 16, height: 26 }
    ]
  }]
};
const requested = [];
const loadAssets = async (paths) => { requested.push(...paths); return paths.map(path => ({ path, dataUrl: `data:image/png;base64,${Buffer.from(path).toString("base64")}`, width: 1, height: 1 })); };

const hydrated = await recoverWatchfaceDesign(converted, loadAssets);
const weather = hydrated.weatherIndicator;
assert.equal(weather.enabled, true);
assert.deepEqual([weather.x, weather.y], [238, 107], "The icon keeps the converted position");
assert.equal(weather.temperatureEnabled, false, "The temperature keeps its own recovered geometry");
assert.equal(Object.keys(weather.assets.day).length, 41);
assert.equal(Object.keys(weather.assets.night).length, 41);
assert.equal(weather.assets.day["0"], `data:image/png;base64,${Buffer.from(`${directory}/studio/current_weather_h364ld/00.png`).toString("base64")}`, "The face's own sun replaces the generated default");
const capability = getWeatherCapability(converted);
assert.equal(Math.round(capability.size.width * weather.scale), 39, "The icon exports at its authored size");
const temperature = hydrated.nativeData.weather_temp;
assert.equal(temperature.enabled, true);
assert.deepEqual([temperature.x, temperature.y], [283, 114]);
assert.equal(temperature.parts.value.width, 33);
assert.equal(temperature.parts.unit.enabled, true);
assert.equal(temperature.parts.symbols.enabled, true);
assert.equal(hydrated.backgroundColor, "#000000");

// An ordinary DIY template without its own weather art yields nothing to
// hydrate, so the editor keeps its generated defaults for it.
const plain = { archiveId: "plain", resolutions: [{ directory: "watchface_416x416", width: 416, height: 416, aodConfig: {}, config: { background_icon: "background.png" }, spriteFolders: [], icons: [] }] };
const untouched = await recoverWatchfaceDesign(plain, loadAssets);
assert.equal(untouched.weatherIndicator.assets, undefined);
assert.deepEqual(untouched.nativeData, {});
console.log("Recovered watch-face hydration tests passed");

const withYear = structuredClone(plain);
withYear.resolutions[0].directory = directory;
Object.assign(withYear.resolutions[0].config, {
  control_number_date_year_rect: "{40,60,136,108,left|vcenter}",
  control_number_date_year_font: "year_digits"
});
withYear.resolutions[0].spriteFolders = [folder("year_digits", 10, 24, 48)];
const recoveredYear = (await recoverWatchfaceDesign(withYear, loadAssets)).nativeData.date_year;
assert.deepEqual([recoveredYear.x, recoveredYear.y], [40, 60]);
assert.equal(recoveredYear.parts.value.width, 96);
assert.equal(recoveredYear.parts.value.digitWidth, 24);
assert.equal(recoveredYear.parts.icon.enabled, false);
assert.equal(Object.keys(recoveredYear.assets.digits).length, 10, "reopening keeps the full native year font");

withYear.resolutions[0].config.rect_control1_pos = "{100,200}";
const offsetYear = (await recoverWatchfaceDesign(withYear, loadAssets)).nativeData.date_year;
assert.deepEqual([offsetYear.x, offsetYear.y], [140, 260], "Native year recovers its absolute position from the control origin");
assert.equal(offsetYear.parts.value.x, 0);
assert.equal(offsetYear.parts.value.y, 0);

// Stress level artwork sits at the firmware's stress_level_icon_pos, not the
// ${id}_level_pos stamina and UV use, and keeps every frame.
const withStress = structuredClone(plain);
withStress.resolutions[0].directory = directory;
Object.assign(withStress.resolutions[0].config, {
  stress_rect: "{100,200,172,248,left|vcenter}",
  stress_font: "stress_digits",
  stress_level_icon_pos: "{60,190}",
  stress_level_icon: "stress_levels"
});
withStress.resolutions[0].spriteFolders = [folder("stress_digits", 10, 18, 48), folder("stress_levels", 5, 32, 32)];
const recoveredStress = (await recoverWatchfaceDesign(withStress, loadAssets)).nativeData.stress;
assert.deepEqual([recoveredStress.x, recoveredStress.y], [60, 190], "The group starts at the level artwork");
assert.deepEqual(recoveredStress.parts.states, { enabled: true, width: 32, height: 32, x: 0, y: 0 });
assert.deepEqual([recoveredStress.parts.value.x, recoveredStress.parts.value.y], [40, 10]);
assert.equal(recoveredStress.stateCount, 5);
assert.equal(Object.keys(recoveredStress.assets.states).length, 5, "Every stress frame is kept");

// Level artwork alone, with no number, still recovers.
delete withStress.resolutions[0].config.stress_rect;
const stressArtOnly = (await recoverWatchfaceDesign(withStress, loadAssets)).nativeData.stress;
assert.deepEqual([stressArtOnly.x, stressArtOnly.y], [60, 190]);
assert.equal(stressArtOnly.parts.value.enabled, false);
assert.equal(stressArtOnly.parts.states.enabled, true);
console.log("Recovered stress level artwork tests passed");

// Weekly-load and AQI level artwork sit at their own ${id}_level_pos keys and keep every frame.
const withLevels = structuredClone(plain);
withLevels.resolutions[0].directory = directory;
Object.assign(withLevels.resolutions[0].config, {
  week_tl_level_pos: "{30,40}", week_tl_level_icon: "load_levels",
  weather_aqi_level_pos: "{30,140}", weather_aqi_level_icon: "aqi_levels"
});
withLevels.resolutions[0].spriteFolders = [folder("load_levels", 7, 32, 24), folder("aqi_levels", 7, 40, 28)];
const recoveredLevels = (await recoverWatchfaceDesign(withLevels, loadAssets)).nativeData;
assert.deepEqual([recoveredLevels.week_tl.x, recoveredLevels.week_tl.y, recoveredLevels.week_tl.stateCount], [30, 40, 7]);
assert.equal(Object.keys(recoveredLevels.week_tl.assets.states).length, 7, "Every weekly-load frame is kept");
assert.deepEqual(recoveredLevels.week_tl.parts.states, { enabled: true, width: 32, height: 24, x: 0, y: 0 });
assert.deepEqual([recoveredLevels.weather_aqi.x, recoveredLevels.weather_aqi.y, recoveredLevels.weather_aqi.stateCount], [30, 140, 7]);
assert.equal(recoveredLevels.weather_aqi.parts.value.enabled, false, "AQI artwork recovers without a number");

// The lunar date is placed by the rectangle the watch lays its reading out in.
const withLunar = structuredClone(plain);
withLunar.resolutions[0].directory = directory;
Object.assign(withLunar.resolutions[0].config, {
  chinese_lunar_year_rect: "{20,30,152,78,left|vcenter}", chinese_lunar_year_icon_dir: "lunar_year",
  chinese_lunar_day_rect: "{20,120,108,168,left|vcenter}", chinese_lunar_day_icon_dir: "lunar_day"
});
withLunar.resolutions[0].spriteFolders = [folder("lunar_year", 23, 44, 48), folder("lunar_day", 30, 88, 48)];
const recoveredLunar = (await recoverWatchfaceDesign(withLunar, loadAssets)).nativeData;
assert.deepEqual([recoveredLunar.lunar_year.x, recoveredLunar.lunar_year.y, recoveredLunar.lunar_year.stateCount], [20, 30, 23], "The year table starts at its rectangle");
assert.deepEqual(recoveredLunar.lunar_year.parts.states, { enabled: true, x: 0, y: 0, width: 44, height: 48 });
assert.equal(Object.keys(recoveredLunar.lunar_day.assets.states).length, 30, "Every lunar day frame is kept");
assert.equal(recoveredLunar.lunar_month, undefined, "A table the face lacks is not invented");
console.log("Recovered weekly-load, AQI and lunar artwork tests passed");
