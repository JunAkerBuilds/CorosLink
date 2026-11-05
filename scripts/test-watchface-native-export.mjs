import assert from "node:assert/strict";
import { keepNativeOwnedKeys } from "../src/watchfaces/nativeData.ts";
import { validateWatchfaceAutomationDocument } from "../src/watchfaces/watchfaceAutomationSchema.ts";

const DELETE = "__COROSLINK_DELETE_CONFIG_KEY__";
// The editor's last pass re-deletes every hidden template image. On the
// SIMPLE project, Start blank had hidden the template's degree and minus.
const hidden = [
  { path: "watchface_800x800/config.txt", values: { weather_dgree_icon: DELETE, weather_negasign_icon: DELETE, bluetooth_on_icon: DELETE } },
  { path: "watchface_416x416/config.txt", values: { weather_dgree_icon: DELETE, weather_negasign_icon: DELETE } }
];
const style = { enabled: true, x: 584, y: 173, scale: 1, color: "#ffffff" };

// Current weather draws its own "°" and minus there, so they stay.
assert.deepEqual(keepNativeOwnedKeys(hidden, { weather_temp: style }), [
  { path: "watchface_800x800/config.txt", values: { bluetooth_on_icon: DELETE } }
], "Only the unrelated hidden icon is still deleted");

// Without the field, or with it switched off, the hidden images go as before.
assert.deepEqual(keepNativeOwnedKeys(hidden, {}), hidden);
assert.deepEqual(keepNativeOwnedKeys(hidden, { weather_temp: { ...style, enabled: false } }), hidden);

// Minimum and maximum own the shared minus, unit and separator; catalog keys count too.
const minMax = [{ path: "watchface_800x800/config.txt", values: {
  weather_temp_max_min_negasign_icon: DELETE, weather_temp_separator_icon: DELETE, weather_uv_icon: DELETE, weather_dgree_icon: DELETE
} }];
assert.deepEqual(keepNativeOwnedKeys(minMax, { weather_temp_min: style, weather_uv: style }), [
  { path: "watchface_800x800/config.txt", values: { weather_dgree_icon: DELETE } }
], "Current weather's own degree is not min/max's to keep");

// Temperature faults a normal preview cannot show.
const weatherCodes = (design) => validateWatchfaceAutomationDocument({ projectName: "T", design: { version: 1, ...design } })
  .map(item => item.code).filter(code => code.startsWith("weather."));
const png = "data:image/png;base64,AA==";
const temp = (extra) => ({ nativeData: { weather_temp: { ...style, ...extra } } });
assert.deepEqual(weatherCodes(temp({})), [], "Default plain degree and minus are fine");
assert.deepEqual(weatherCodes(temp({ parts: { symbols: { enabled: false } } })), ["weather.minus_missing"]);
assert.deepEqual(weatherCodes(temp({ parts: { unit: { enabled: false } } })), ["weather.unit_missing"]);
assert.deepEqual(weatherCodes(temp({ assets: { unit: { 0: png } }, assetTexts: { unit: { 0: "°C" } } })), ["weather.unit_one_letter"]);
assert.deepEqual(weatherCodes(temp({ assets: { unit: { 0: png } } })), ["weather.unit_check_art"]);
assert.deepEqual(weatherCodes(temp({ assets: { unit: { 0: png, 1: png } }, assetTexts: { unit: { 0: "°C" } } })), []);
assert.deepEqual(weatherCodes({ weatherIndicator: { enabled: true, x: 0, y: 0, scale: 1 }, configAssetOverrides: {
  "config:weather_negasign_icon": { enabled: false }, "config:weather_dgree_icon": { enabled: false } } }), ["weather.minus_missing", "weather.unit_missing"]);
assert.deepEqual(weatherCodes({ weatherIndicator: { enabled: true, x: 0, y: 0, scale: 1 }, nativeData: { weather_temp: style }, configAssetOverrides: {
  "config:weather_negasign_icon": { enabled: false } } }), [], "A native temperature writes its own minus");

console.log("native export tests passed");
