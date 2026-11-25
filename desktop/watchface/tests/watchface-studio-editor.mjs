// Moved from CorosLink scripts/test-watchface-studio-editor.mjs (c2ff5110), paths pointed at desktop/watchface.
import assert from "node:assert/strict";
import { animationFrameAt, animationNextChange, animationProblem, buildAnimationOverrides, normalizeAnimationDelays, parseAnimationDelays, templateAnimationFiles, MAX_ANIMATION_FRAMES } from "../engine/watchfaceAnimation";
import { collectWatchfaceFaceColors, recolorWatchfaceFace } from "../engine/watchfaceFaceColors";
import { watchfaceLayerSampleValue } from "../engine/watchfaceLayerValues";
import {
  buildWatchThemeOverrides, compiledWatchTheme, effectiveWatchTheme, recolorWatchThemePixels, watchThemeSupport, watchThemeSwatch
} from "../engine/watchfaceThemeColor";

// --- Face colors -----------------------------------------------------------

const design = {
  digitColor: "#ffffff",
  accentColor: "#53cba1",
  layerColors: { "time:hours": "#f2b233", "time:minutes": "#F2B233", weekday: "not-a-color" },
  metricStyles: { steps: { scale: 1, color: "#8fb3cc" }, heartRate: { scale: 1 } },
  timeStyles: { hours: { scale: 1, color: "#f2b233" } },
  dateStyles: { weekday: { color: "#8FB3CC" } },
  nativeData: { weather_temp: { enabled: true, color: "#4aa3ff" } },
  selectableMetricStyle: { color: "#4aa3ff" },
  backgroundElements: [{ id: "a", kind: "rect", color: "#e9a6c4" }, { id: "b", kind: "line" }]
};

// Counted case-insensitively, most used first; template-wide defaults and bad values are left out.
assert.deepEqual(collectWatchfaceFaceColors(design), [
  { color: "#F2B233", uses: 3 },
  { color: "#4AA3FF", uses: 2 },
  { color: "#8FB3CC", uses: 2 },
  { color: "#E9A6C4", uses: 1 }
]);
assert.deepEqual(collectWatchfaceFaceColors({ digitColor: "#fff", accentColor: "#000" }), []);

// Recoloring swaps every part with that color and nothing else.
const recolored = recolorWatchfaceFace(design, "#f2b233", "#ff8a65");
assert.equal(recolored.layerColors["time:hours"], "#FF8A65");
assert.equal(recolored.layerColors["time:minutes"], "#FF8A65");
assert.equal(recolored.layerColors.weekday, "not-a-color");
assert.equal(recolored.timeStyles.hours.color, "#FF8A65");
assert.equal(recolored.metricStyles.steps.color, "#8fb3cc");
assert.equal(recolored.digitColor, "#ffffff");
assert.equal(design.layerColors["time:hours"], "#f2b233", "the input is not mutated");
assert.deepEqual(collectWatchfaceFaceColors(recolored)[0], { color: "#FF8A65", uses: 3 });

const blue = recolorWatchfaceFace(design, "#4AA3FF", "#000000");
assert.equal(blue.nativeData.weather_temp.color, "#000000");
assert.equal(blue.selectableMetricStyle.color, "#000000");
assert.equal(blue.metricStyles, design.metricStyles, "untouched records keep their identity");

const pink = recolorWatchfaceFace(design, "#e9a6c4", "#123456");
assert.equal(pink.backgroundElements[0].color, "#123456");
assert.equal(pink.backgroundElements[1], design.backgroundElements[1]);

// Same color, or an invalid one, is a no-op.
assert.equal(recolorWatchfaceFace(design, "#F2B233", "#f2b233"), design);
assert.equal(recolorWatchfaceFace(design, "#F2B233", "orange"), design);

// --- Layer values ------------------------------------------------------------

const scenario = { dateTime: "2026-11-05T16:12:07", values: { steps: "12001" } };
const now = new Date(2000, 0, 1);
assert.equal(watchfaceLayerSampleValue({ kind: "time", timePartId: "hours", id: "h" }, scenario, now), "16");
assert.equal(watchfaceLayerSampleValue({ kind: "time", timePartId: "minutes", id: "m" }, scenario, now), "12");
assert.equal(watchfaceLayerSampleValue({ kind: "seconds", id: "s" }, scenario, now), "07");
assert.equal(watchfaceLayerSampleValue({ kind: "weekday", id: "w" }, scenario, now), "THU");
assert.equal(watchfaceLayerSampleValue({ kind: "date", layoutGroupId: "dateDay", id: "d" }, scenario, now), "5");
assert.equal(watchfaceLayerSampleValue({ kind: "date", layoutGroupId: "dateMonth", id: "mo" }, scenario, now), "", "month pictures may be words");
assert.equal(watchfaceLayerSampleValue({ kind: "metric", metricId: "steps", id: "st" }, scenario, now), "12001", "simulated values win");
assert.equal(watchfaceLayerSampleValue({ kind: "metric", metricId: "heartRate", id: "hr" }, scenario, now), "96");
assert.equal(watchfaceLayerSampleValue({ kind: "background", id: "bg" }, scenario, now), "");
// Without a scenario the clock follows the given time.
assert.equal(watchfaceLayerSampleValue({ kind: "time", timePartId: "hours", id: "h" }, undefined, new Date(2026, 0, 1, 9, 5)), "09");

// --- MIP theme color ---------------------------------------------------------

const tree = (width, config) => ({ directory: `watchface_${width}x${width}`, width, height: width, config, aodConfig: {}, spriteFolders: [], icons: [] });
const only = (resolution) => ({ archiveId: "a", resolutions: [resolution] });
// TWILIGHT's MIP header: theming on, starts on row 3.
assert.deepEqual(watchThemeSupport(only(tree(260, { watchface_theme_color_off: "0", watchface_default_theme_color: "3" }))), { templateDefault: 3 });
// DIY templates only declare theme_color_off; a missing key compiles as on, row 0.
assert.deepEqual(watchThemeSupport(only(tree(240, {}))), { templateDefault: 0 });
assert.equal(watchThemeSupport(only(tree(260, { watchface_theme_color_off: "1" }))), null, "theming off");
assert.equal(watchThemeSupport(only(tree(416, { watchface_theme_color_off: "0" }))), null, "AMOLED has no theme table");
const twilight = only(tree(260, { watchface_default_theme_color: "3" }));
assert.equal(effectiveWatchTheme(twilight, {}), 3);
assert.equal(effectiveWatchTheme(twilight, { watchThemeColor: 8 }), 8);
assert.equal(effectiveWatchTheme(twilight, { watchThemeColor: 14 }), 3, "out of range keeps the template's");
assert.equal(effectiveWatchTheme(only(tree(416, {})), { watchThemeColor: 8 }), null);
assert.equal(watchThemeSwatch(3), "#FFFF00");
assert.equal(watchThemeSwatch(0), "#FF0000");

// The picked row reaches every themed MIP tree, not the 800px master or an AMOLED tree.
const bundle = { archiveId: "b", resolutions: [tree(240, {}), tree(260, { watchface_theme_color_off: "1" }), tree(280, {}), tree(800, {}), tree(416, {})] };
assert.deepEqual(buildWatchThemeOverrides(bundle, { watchThemeColor: 9 }), [
  { path: "watchface_240x240/config.txt", values: { watchface_default_theme_color: "9" } },
  { path: "watchface_280x280/config.txt", values: { watchface_default_theme_color: "9" } }
]);
assert.deepEqual(buildWatchThemeOverrides(bundle, {}), [], "untouched keeps the template's");
assert.equal(compiledWatchTheme(260, { watchface_default_theme_color: "3" }), 3);
assert.equal(compiledWatchTheme(260, { watchface_theme_color_off: "1", watchface_default_theme_color: "3" }), null);
assert.equal(compiledWatchTheme(416, { watchface_default_theme_color: "3" }), null);

// Pixels that compile to the five reds take row 3 (yellow); everything else is untouched.
const pixels = new Uint8ClampedArray([
  255, 0, 0, 255, // #ff0000
  170, 0, 0, 255, // #aa0000
  85, 0, 0, 255, // #550000
  255, 85, 85, 255, // #ff5555
  255, 170, 170, 255, // #ffaaaa
  200, 10, 10, 128, // an anti-aliased edge that compiles to #aa0000
  255, 170, 0, 255, // the weather icon's orange stays
  255, 0, 0, 0 // transparent
]);
assert.equal(recolorWatchThemePixels(pixels, 3), true);
assert.deepEqual([...pixels], [
  255, 255, 0, 255,
  170, 170, 0, 255,
  85, 85, 0, 255,
  255, 255, 85, 255,
  255, 255, 170, 255,
  170, 170, 0, 128,
  255, 170, 0, 255,
  255, 0, 0, 0
]);
const red = new Uint8ClampedArray([255, 0, 0, 255]);
assert.equal(recolorWatchThemePixels(red, 0), false, "row 0 draws the face as stored");
assert.deepEqual([...red], [255, 0, 0, 255]);

// --- Native sprite animation ------------------------------------------------

// The frame comes from elapsed time over the cumulative delays (no drift from late ticks).
assert.deepEqual([0, 69, 70, 194, 195, 454, 455, 524].map(t => animationFrameAt([70, 125, 260, 70], t)), [0, 0, 1, 1, 2, 2, 3, 3]);
assert.equal(animationFrameAt([70, 125, 260, 70], 525 * 3 + 80), 1, "loops");
assert.equal(animationFrameAt([], 500), 0);
assert.deepEqual([0, 69, 70, 450, 524].map(t => animationNextChange([70, 125, 260, 70], t)), [70, 1, 125, 5, 1], "the timer waits for the next frame boundary");
assert.deepEqual(normalizeAnimationDelays([120], 3), [120, 120, 120], "one delay fills every frame");
assert.deepEqual(normalizeAnimationDelays([0, 70000, 55.4, 80], 3), [1, 65535, 55], "clamped, rounded and cut to the frame count");
assert.deepEqual(parseAnimationDelays("100, 100,70"), [100, 100, 70]);
assert.equal(parseAnimationDelays("100,-1"), null);
const animation = { enabled: true, x: 0, y: 31, width: 376, height: 340, frames: Array(10).fill("data:image/png;base64,"), delays: Array(10).fill(100) };
assert.equal(animationProblem(animation), null);
assert.match(animationProblem({ ...animation, frames: Array(MAX_ANIMATION_FRAMES + 1).fill(""), delays: Array(MAX_ANIMATION_FRAMES + 1).fill(100) }), /at most 44/);
assert.match(animationProblem({ ...animation, delays: [100] }), /one delay per frame/);
assert.match(animationProblem(animation, [{ width: 4, height: 4 }, { width: 5, height: 4 }]), /must be 4 × 4/);
assert.equal(animationProblem({ ...animation, enabled: false, frames: [] }), null, "a turned-off animation never blocks export");
// Current gets the keys scaled per tree from the design's (preview) resolution, the 800px
// master when there is one; AOD loses them; the folder is named by frame count.
const animatedFace = { archiveId: "n", resolutions: [{ ...tree(390, {}), aodConfig: { watchface_id: "41" } }, tree(800, {})] };
assert.deepEqual(buildAnimationOverrides(animatedFace, animation), [
  { path: "watchface_390x390/config.txt", values: { cl_animation_pos: "{0,15}", cl_animation_dir: "cl_animation_10", cl_animation_delays_ms: "100,100,100,100,100,100,100,100,100,100" } },
  { path: "watchface_390x390/AODconfig.txt", values: { cl_animation_pos: "__COROSLINK_DELETE_CONFIG_KEY__", cl_animation_dir: "__COROSLINK_DELETE_CONFIG_KEY__", cl_animation_delays_ms: "__COROSLINK_DELETE_CONFIG_KEY__" } },
  { path: "watchface_800x800/config.txt", values: { cl_animation_pos: "{0,31}", cl_animation_dir: "cl_animation_10", cl_animation_delays_ms: "100,100,100,100,100,100,100,100,100,100" } }
]);
assert.deepEqual(buildAnimationOverrides(animatedFace, { ...animation, enabled: false })[0].values.cl_animation_dir, "__COROSLINK_DELETE_CONFIG_KEY__", "turning it off removes the record");
assert.deepEqual(buildAnimationOverrides(animatedFace, undefined), [], "old projects leave the template's keys alone");
// Frames are listed in the compiler's bytewise order.
const recoveredTree = { ...tree(390, { cl_animation_dir: "recovered\\group-22" }), spriteFolders: [{ folder: "recovered/group-22", files: ["10", "02", "01"].map(n => ({ path: `watchface_390x390/recovered/group-22/${n}.png`, width: 4, height: 4 })) }] };
assert.deepEqual(templateAnimationFiles(only(recoveredTree)).map(f => f.path.slice(-6)), ["01.png", "02.png", "10.png"]);

console.log("watchface studio editor helpers: ok");
