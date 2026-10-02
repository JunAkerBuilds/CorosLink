import assert from "node:assert/strict";
import { activityCategory, activityTimeline, activityTimestamp, activityTotals, lapPacing, selectActivities } from "../src/training/activityCollection.ts";

const activities = [
  { activityId: "run", name: "Ottawa Run", sportType: 100, distance: 5000, duration: 1800, startTime: 1_800_000_000, calories: 300 },
  { activityId: "walk", name: "Evening walk", sportType: 900, distance: 1000, duration: 600, startTime: 1_800_000_001_000, calories: 0 },
  { activityId: "ride", name: "Road", sportType: 203, distance: 40000, duration: 3600, startTime: 1_800_000_002, calories: 800 },
  { activityId: "swim", name: "Pool", sportType: 300, distance: 1000, duration: 1500 },
  { activityId: "missing", sportType: 402 },
  { activityId: "invalid", sportType: 98, distance: NaN, duration: Infinity }
];
const names = new Map([[203, "Gravel Road Bike"]]);
assert.equal(activityTimestamp(1_800_000_000), 1_800_000_000_000);
assert.equal(activityTimestamp(1_800_000_000_000), 1_800_000_000_000);
assert.equal(activityTimestamp(NaN), 0);
assert.equal(activityCategory(102), "run");
assert.equal(activityCategory(205), "ride");
assert.equal(activityCategory(301), "swim");
assert.equal(activityCategory(104), "walk");
assert.equal(activityCategory(400), "strength");
assert.equal(activityCategory(10000), "other");
assert.deepEqual(selectActivities(activities, "all", " GRAVEL ", "newest", names).map(a => a.activityId), ["ride"]);
assert.deepEqual(selectActivities(activities, "run", "Ottawa", "newest", names).map(a => a.activityId), ["run"]);
assert.equal(selectActivities(activities, "all", "", "oldest", names)[0].activityId, "run");
assert.equal(selectActivities(activities, "all", "", "newest", names)[0].activityId, "ride");
assert.equal(selectActivities(activities.slice(0, 4), "all", "", "distance", names)[0].activityId, "ride");
assert.equal(activities[0].activityId, "run", "Sorting must not mutate the source list");
assert.deepEqual(activityTotals(activities), { count: 6, distance: 47000, duration: 7500, calories: 1100, pace: 400 });
assert.equal(activityTotals([activities[2], activities[3]]).pace, undefined, "Cycling/swimming cannot dilute running pace");
assert.equal(activityTotals([activities[4]]).distance, undefined, "Missing data isn't zero");
assert.equal(activityTotals([activities[1]]).calories, 0, "Recorded zero remains zero");
assert.equal(activityTimeline(activities).reduce((total, bucket) => total + bucket.count, 0), 3);
assert.equal(activityTimeline([]).length, 10);
console.log("Activity collection passed: filtering, sort, timestamp units, mixed-sport pace, missing data and chart buckets.");
assert.equal(lapPacing([{ distance: 1000, duration: 300 }, { distance: 1000, duration: 305 }]), undefined, "Needs three timed laps");
assert.equal(lapPacing([{ distance: 1000, duration: 300 }, { distance: 1000, duration: 304 }, { distance: 1000, duration: 298 }, { distance: 400, duration: 121 }]), "consistent");
assert.equal(lapPacing([{ distance: 1000, duration: 330 }, { distance: 1000, duration: 320 }, { distance: 1000, duration: 290 }, { distance: 1000, duration: 280 }]), "negative-split");
assert.equal(lapPacing([{ distance: 1000, duration: 280 }, { distance: 1000, duration: 290 }, { distance: 1000, duration: 330 }, { distance: 0, duration: 0 }]), "positive-split");
