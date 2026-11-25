import { describe, expect, it } from "vitest";
import { seedItems } from "@/data/sampleSeed";
import { calendarSport, syncedEntries, syncedWeeks } from "./calendar";
import { calendarDayOf, dateToRef, type NativeActivity, type NativeGymPlanned, type NativeGymRoutine, type SyncBodies } from "./native";

// Friday 20 November 2026, 14:10 local.
const NOW = new Date(2026, 10, 20, 14, 10);
const at = (d: number, h: number, m: number) => dateToRef(new Date(2026, 10, d, h, m));

const ACTIVITIES: NativeActivity[] = [
  { id: "476000000000001", name: "Easy run", sport: "run", start: at(18, 18, 10), distanceMeters: 6100, durationSeconds: 2028, trainingLoad: 54 },
  { id: "476000000000002", name: "Morning tempo", sport: "run", start: at(19, 7, 42), distanceMeters: 8020, durationSeconds: 2293.75, trainingLoad: 96 },
  { id: "476000000000003", name: "", sport: "indoorBike", start: at(19, 18, 0), distanceMeters: 24600, durationSeconds: 3482 },
  { id: "476000000000004", name: "Strength", sport: "strength", start: at(15, 12, 30), durationSeconds: 2890, trainingLoad: 41 },
  { id: "476000000000005", name: "Ridge hike", sport: "hike", start: at(15, 9, 20), distanceMeters: 11300, durationSeconds: 9492 },
  { id: "476000000000006", name: "Later today", sport: "run", start: at(20, 18, 0), distanceMeters: 5000, durationSeconds: 1500 },
  { id: "476000000000007", name: "No start", sport: "run" },
];
const ROUTINES: NativeGymRoutine[] = [{ id: "R1", name: "Upper body", entries: [{ id: "e1", exerciseID: "pull-up" }, { id: "e2", exerciseID: "barbell-row" }] }];
const PLANNED: NativeGymPlanned[] = [
  { id: "P2", routineID: "GONE", day: calendarDayOf("2026-11-24") },
  { id: "P1", routineID: "R1", day: calendarDayOf("2026-11-21") },
];

describe("synced calendar entries", () => {
  const entries = syncedEntries(ACTIVITIES, PLANNED, ROUTINES, NOW);

  it("turns each recorded activity into a done entry on its local day, opening its page", () => {
    expect(entries.filter((e) => e.status === "done")).toMatchObject([
      { id: "synced-476000000000005", date: "2026-11-15", sport: "other", name: "Ridge hike", detail: "11.30 km · 2:38:12", status: "done", source: "synced", activityId: "476000000000005" },
      { id: "synced-476000000000004", date: "2026-11-15", sport: "strength", name: "Strength", detail: "48:10", status: "done", source: "synced", activityId: "476000000000004" },
      { id: "synced-476000000000001", date: "2026-11-18", sport: "run", name: "Easy run", detail: "6.10 km · 33:48", status: "done", source: "synced", activityId: "476000000000001" },
      { id: "synced-476000000000002", date: "2026-11-19", sport: "run", name: "Morning tempo", detail: "8.02 km · 38:13.75", status: "done", source: "synced", activityId: "476000000000002" },
      { id: "synced-476000000000003", date: "2026-11-19", sport: "ride", name: "Indoor ride", detail: "24.60 km · 58:02", status: "done", source: "synced", activityId: "476000000000003" },
    ]);
  });

  it("puts gym plans on their day under the routine's name", () => {
    expect(entries.filter((e) => e.status === "planned")).toMatchObject([
      { id: "synced-plan-P1", date: "2026-11-21", sport: "strength", name: "Upper body", detail: "2 exercises", status: "planned", source: "synced", planned: { id: "P1" } },
      { id: "synced-plan-P2", date: "2026-11-24", sport: "strength", name: "Gym workout", detail: "", status: "planned", source: "synced", planned: { id: "P2" } },
    ]);
  });

  it("carries a done entry's distance and time, for how much of a plan it did", () => {
    expect(entries.find((e) => e.id === "synced-476000000000001")).toMatchObject({ metres: expect.any(Number), seconds: expect.any(Number) });
  });

  it("maps every one of the phone's sports: runs are runs, and walks, hikes, skiing and rowing are not", () => {
    const all = ["run", "indoorRun", "trailRun", "track", "walk", "hike", "bike", "indoorBike", "poolSwim", "openWater",
      "strength", "cardio", "ski", "row", "multisport", "other"] as const;
    expect(Object.fromEntries(all.map((s) => [s, calendarSport(s)]))).toEqual({
      run: "run", indoorRun: "run", trailRun: "run", track: "run", walk: "other", hike: "other", bike: "ride", indoorBike: "ride",
      poolSwim: "swim", openWater: "swim", strength: "strength", cardio: "strength", ski: "other", row: "other", multisport: "other", other: "other",
    });
    // A sport a newer phone sends that this build doesn't know yet.
    expect(calendarSport("kayak" as never)).toBe("other");
  });

  it("reads the seeded athlete: one entry per started activity, the two gym plans by routine name", () => {
    const items = seedItems(NOW);
    const of = <C extends keyof SyncBodies>(c: C) => items.filter((i) => i.collection === c).map((i) => i.body as SyncBodies[C]);
    const seeded = syncedEntries(of("activity"), of("gym.planned"), of("gym.routine"), NOW);
    const done = seeded.filter((e) => e.status === "done");
    expect(done).toHaveLength(of("activity").length);
    expect(done.filter((e) => e.date === "2026-11-20").map((e) => e.name)).toEqual(["Pool swim", "Strength"]);
    expect(done.find((e) => e.name === "Pool swim")).toMatchObject({ sport: "swim", detail: expect.stringMatching(/^1,\d{3} m · \d\d:\d\d(\.\d\d)?$/) });
    expect(done.find((e) => e.date === "2026-11-18")).toMatchObject({ name: "Morning tempo", detail: expect.stringMatching(/^\d\.\d\d km · \d\d:\d\d(\.\d\d)?$/) });
    expect(seeded.filter((e) => e.status === "planned").map((e) => [e.date, e.name, e.detail])).toEqual([
      ["2026-11-21", "Upper body", "6 exercises"], ["2026-11-24", "Lower body", "5 exercises"],
    ]);
  });
});

describe("synced week totals", () => {
  it("adds up time, running distance and load per Monday week", () => {
    // 15 Nov is a Sunday (week of 9 Nov); 18 and 19 Nov are in the week of 16 Nov.
    expect(syncedWeeks(ACTIVITIES, [], NOW)).toEqual([
      { weekStart: "2026-11-09", timeSeconds: 2890 + 9492, runMetres: 0, load: 41, plannedLoad: null },
      { weekStart: "2026-11-16", timeSeconds: 2028 + 2293.75 + 3482, runMetres: 14120, load: 150, plannedLoad: null },
    ]);
  });
  it("takes a day's load from the day's reading when no activity of that day carries one", () => {
    const hike = [ACTIVITIES[4]];
    expect(syncedWeeks(hike, [{ day: calendarDayOf("2026-11-15"), trainingLoad: 88 }], NOW)[0].load).toBe(88);
  });
  it("has no week without an activity", () => {
    expect(syncedWeeks([], [{ day: calendarDayOf("2026-11-15"), trainingLoad: 88 }], NOW)).toEqual([]);
  });
});
