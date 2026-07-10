import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const formattersUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "formatters.ts")
);
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  formatHappenDayLabel,
  formatSleepNightLabel,
  isPersonalRecordVisible
} = await import(
  `${formattersUrl.href}?cacheBust=${Date.now()}`
);
const { buildTrendPoints, mergeSleepIntoTrendPoints } = await import(
  `${distUrl("trainingTrendUtils.js")}?cacheBust=${Date.now()}`
);

assert.equal(
  formatSleepNightLabel({
    happenDay: "20260707",
    sleepStart: "23:23",
    sleepEnd: "08:01"
  }),
  formatHappenDayLabel("20260707")
);

const trendPoints = mergeSleepIntoTrendPoints(
  buildTrendPoints([{ happenDay: "20260707" }, { happenDay: "20260708" }]),
  {
    mcpConnected: true,
    records: [
      {
        happenDay: "20260707",
        kind: "nap",
        totalMinutes: 45,
        completeness: "complete"
      },
      {
        happenDay: "20260707",
        kind: "main",
        totalMinutes: 388,
        score: 34,
        completeness: "complete"
      },
      {
        happenDay: "20260708",
        kind: "main",
        totalMinutes: 316,
        score: 71,
        completeness: "partial"
      }
    ]
  }
);

assert.equal(
  trendPoints.find((point) => point.date === "20260707")?.sleepMinutes,
  388
);
assert.equal(
  trendPoints.find((point) => point.date === "20260708")?.sleepMinutes,
  undefined
);

assert.equal(isPersonalRecordVisible({ type: 7, duration: 245 }), true);
assert.equal(isPersonalRecordVisible({ type: 6, duration: 769 }), true);
assert.equal(isPersonalRecordVisible({ type: 5, duration: 1309 }), true);
assert.equal(isPersonalRecordVisible({ type: 4, duration: 5127 }), true);
assert.equal(isPersonalRecordVisible({ type: 3, duration: 9759 }), false);
assert.equal(isPersonalRecordVisible({ type: 10, duration: 1268 }), false);
assert.equal(isPersonalRecordVisible({ type: 11, duration: 3995 }), false);
assert.equal(isPersonalRecordVisible({ type: 8, duration: 408 }), false);

console.log("training formatter tests passed");
