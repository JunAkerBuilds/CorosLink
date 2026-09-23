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
