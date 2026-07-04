import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildFitnessTrendPreview,
  buildHrZonePreview
} = await import(`${distUrl("chatAnalyticsTools.js")}?cacheBust=${Date.now()}`);
const { buildTrendPoints } = await import(
  `${distUrl("trainingTrendUtils.js")}?cacheBust=${Date.now()}`
);

const trendPoints = buildTrendPoints([
  {
    happenDay: "20260701",
    trainingLoad: 120,
    rhr: 48,
    avgSleepHrv: 62,
    sleepHrvBase: 58
  },
  {
    happenDay: "20260702",
    trainingLoad: 80,
    rhr: 49,
    avgSleepHrv: 60,
    sleepHrvBase: 58
  }
]);

const fitnessPreview = buildFitnessTrendPreview(trendPoints, "req-1");
assert.ok(fitnessPreview);
assert.equal(fitnessPreview.trendPoints.length, 2);
assert.equal(fitnessPreview.previewId, "fitness-trends:req-1");
assert.equal(buildFitnessTrendPreview([], "req-2"), null);

const zonePreview = buildHrZonePreview(
  {
    hrTrainingLoad: [
      { index: 1, ratio: 0.2, value: 100 },
      { index: 2, ratio: 0.3, value: 150 },
      { index: 3, ratio: 0.5, value: 250 }
    ],
    hrDistance: [],
    hrTime: []
  },
  [{ index: 1, hr: 130 }, { index: 2, hr: 150 }],
  "trainingLoad",
  "req-3"
);
assert.ok(zonePreview);
assert.equal(zonePreview.zones.length, 3);
assert.equal(zonePreview.metric, "trainingLoad");
assert.equal(
  buildHrZonePreview(
    { hrTrainingLoad: [], hrDistance: [], hrTime: [] },
    [],
    "time",
    "req-4"
  ),
  null
);

console.log("test-chat-analytics-tools: ok");
