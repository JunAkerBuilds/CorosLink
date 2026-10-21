import assert from "node:assert/strict";
import { keepNativeOwnedKeys } from "../src/watchfaces/nativeData.ts";

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

console.log("native export tests passed");
