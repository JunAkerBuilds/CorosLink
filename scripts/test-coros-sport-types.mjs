import assert from "node:assert/strict";
import {
  corosSportName,
  enrichActivitiesWithSportNames,
  isIndoorCorosSport,
  mergeSportTypeEntries
} from "../dist-electron/corosSportTypes.js";

assert.equal(corosSportName(100), "Run");
assert.equal(corosSportName(900), "Walk");
assert.equal(corosSportName(102), "Trail Run");
assert.equal(corosSportName(100, "Morning Run"), "Morning Run");

// Indoor sports skip the GPX track fallback; outdoor ones keep it.
for (const indoor of [101, 201, 300, 400, 402, 701, 800, 801]) assert.equal(isIndoorCorosSport(indoor), true, String(indoor));
for (const outdoor of [100, 102, 200, 301, 900]) assert.equal(isIndoorCorosSport(outdoor), false, String(outdoor));
assert.equal(isIndoorCorosSport(undefined), false);

const merged = mergeSportTypeEntries([
  { sportType: 100, sportName: "Outdoor Run" },
  { sportType: 999, sportName: "Custom Sport" }
]);

assert.equal(
  merged.find((item) => item.sportType === 100)?.sportName,
  "Outdoor Run"
);
assert.equal(
  merged.find((item) => item.sportType === 900)?.sportName,
  "Walk"
);
assert.equal(
  merged.find((item) => item.sportType === 999)?.sportName,
  "Custom Sport"
);

const enriched = enrichActivitiesWithSportNames([
  { activityId: "1", sportType: 100 },
  { activityId: "2", sportType: 900, sportName: "Dog Walk" }
]);

assert.equal(enriched[0]?.sportName, "Run");
assert.equal(enriched[1]?.sportName, "Dog Walk");

console.log("COROS sport type resolver tests passed.");
