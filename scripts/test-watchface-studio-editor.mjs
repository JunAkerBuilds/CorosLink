import assert from "node:assert/strict";
import { collectWatchfaceFaceColors, recolorWatchfaceFace } from "../src/watchfaces/watchfaceFaceColors.ts";
import { watchfaceLayerSampleValue } from "../src/watchfaces/watchfaceLayerValues.ts";

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

console.log("watchface studio editor helpers: ok");
