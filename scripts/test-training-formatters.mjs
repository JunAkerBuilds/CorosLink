import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const formattersUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "formatters.ts")
);
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { formatHappenDayLabel, formatSleepNightLabel } = await import(
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

console.log("training formatter tests passed");
