import assert from "node:assert/strict";
import {
  formatRaceDelta,
  formatRaceDistance,
  formatRaceTime,
  fromDateInputValue,
  parseRaceTime,
  toDateInputValue
} from "../src/training/raceFormat.ts";

assert.equal(formatRaceTime(1331), "22:11");
assert.equal(formatRaceTime(6315), "1:45:15");
assert.equal(formatRaceTime(1331.4), "22:11.4");
assert.equal(formatRaceTime(59.96), "1:00");
assert.equal(formatRaceTime(undefined), "—");
assert.equal(formatRaceTime(0), "—");

assert.equal(formatRaceDelta(-71), "−1:11");
assert.equal(formatRaceDelta(20), "+0:20");
assert.equal(formatRaceDelta(0.3), "±0:00");
assert.equal(formatRaceDelta(undefined), "—");

assert.equal(parseRaceTime("22:11"), 1331);
assert.equal(parseRaceTime("1:40:15"), 6015);
assert.equal(parseRaceTime(" 22:11.4 "), 1331.4);
assert.equal(parseRaceTime("45"), 2700, "a bare number is minutes");
assert.equal(parseRaceTime("0:59"), 59);
assert.equal(parseRaceTime("22:61"), undefined);
assert.equal(parseRaceTime("1:61:00"), undefined);
assert.equal(parseRaceTime("abc"), undefined);
assert.equal(parseRaceTime(""), undefined);
assert.equal(parseRaceTime("0:00"), undefined);

assert.equal(formatRaceDistance({ distanceKey: "half", officialDistance: 21097.5 }, "metric"), "Half Marathon");
assert.equal(formatRaceDistance({ distanceKey: "other", officialDistance: 7000 }, "metric"), "7.00 km");
assert.equal(formatRaceDistance({ distanceKey: "other", officialDistance: 16093.44 }, "imperial"), "10.0 mi");

const epoch = fromDateInputValue("2026-07-01");
assert.equal(toDateInputValue(epoch), "2026-07-01");
assert.equal(new Date(epoch * 1000).getHours(), 9);
assert.equal(fromDateInputValue("July 1"), undefined);

console.log("race format tests passed");
