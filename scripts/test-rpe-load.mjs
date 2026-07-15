import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "rpeLoad.ts"));
const { feelTypeToCr10, sessionSrpe, dailyRpeLoad } = await import(
  `${modUrl.href}?c=${Date.now()}`
);

// feelType → CR10 (level × 2); invalid/unrated → undefined.
assert.equal(feelTypeToCr10(1), 2);
assert.equal(feelTypeToCr10(3), 6);
assert.equal(feelTypeToCr10(5), 10);
assert.equal(feelTypeToCr10(0), undefined);
assert.equal(feelTypeToCr10(undefined), undefined);
assert.equal(feelTypeToCr10(null), undefined);
assert.equal(feelTypeToCr10(6), undefined);
assert.equal(feelTypeToCr10(2.5), undefined);

// sessionSrpe = CR10 × minutes; 0 when unrated or no duration.
assert.equal(sessionSrpe(4, 45 * 60), 360); // "difficile" 45 min → 8 × 45
assert.equal(sessionSrpe(1, 60 * 60), 120); // "très léger" 60 min → 2 × 60
assert.equal(sessionSrpe(0, 60 * 60), 0); // unrated
assert.equal(sessionSrpe(5, 0), 0); // no duration
assert.equal(sessionSrpe(3, undefined), 0);

// dailyRpeLoad: sum rated sessions per local day; unrated excluded.
const noonMs = new Date(2026, 6, 14, 12, 0, 0).getTime();
const nextDay9 = new Date(2026, 6, 15, 9, 0, 0).getTime();
const load = dailyRpeLoad([
  // Same day: strength (4, 45min → 360) + run (2, 30min → 4×30=120) = 480.
  { startTime: noonMs, duration: 45 * 60, feelType: 4 },
  { startTime: noonMs, duration: 30 * 60, feelType: 2 },
  // Unrated bike same day → contributes nothing.
  { startTime: noonMs, duration: 60 * 60, feelType: 0 },
  // Next day: single rated walk (1, 20min → 2×20 = 40).
  { startTime: nextDay9, duration: 20 * 60, feelType: 1 },
  // Day with only an unrated session → absent from the map.
  { startTime: new Date(2026, 6, 16, 9).getTime(), duration: 40 * 60, feelType: null }
]);
assert.equal(load.get("20260714"), 480);
assert.equal(load.get("20260715"), 40);
assert.equal(load.has("20260716"), false);
assert.equal(load.size, 2);

// Seconds vs ms epochs both bucket to the same local day.
const secLoad = dailyRpeLoad([
  { startTime: Math.floor(noonMs / 1000), duration: 45 * 60, feelType: 4 }
]);
assert.equal(secLoad.get("20260714"), 360);

console.log("rpe-load tests passed");
