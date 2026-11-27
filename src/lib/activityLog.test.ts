import { afterEach, describe, expect, it } from "vitest";
import { ALL_LOG_SPORTS, inferDistanceUnit, inferIcon, inferUploadSport, logActivityInput, logDistanceLabel, logDuration, logSport, logStart, SUGGESTED_LOG_SPORTS, visibleLogSports, type LogForm } from "./activityLog";
import { useUnitsNow } from "./units";

const form = (patch: Partial<LogForm> = {}): LogForm => ({ sportId: "suggested-run", date: "2026-11-18", time: "06:40", hours: "0", minutes: "42", distance: "8.20", calories: "571", avgHr: "148", ...patch });

describe("the activity types", () => {
  it("opens with the desktop's eight, in its order", () => {
    expect(SUGGESTED_LOG_SPORTS.map((s) => s.label)).toEqual(["Run", "Ride", "Walk", "Hike", "Swim", "Strength", "Yoga", "Other"]);
  });

  it("uploads only runs and rides under their own sport", () => {
    expect(SUGGESTED_LOG_SPORTS.map((s) => s.uploadSport)).toEqual(["run", "bike", "other", "other", "other", "other", "other", "other"]);
    expect(inferUploadSport("Indoor Bike")).toBe("bike");
    expect(inferUploadSport("Trail Run")).toBe("run");
    expect(inferUploadSport("Indoor Rowing")).toBe("other");
  });

  it("asks for metres for a swim, kilometres for moving sports and no distance for the rest", () => {
    expect(SUGGESTED_LOG_SPORTS.map((s) => s.distanceUnit)).toEqual(["km", "km", "km", "km", "m", "none", "none", "none"]);
    expect([inferDistanceUnit("Pool Swim"), inferDistanceUnit("Rowing"), inferDistanceUnit("XC Ski"), inferDistanceUnit("Gym Cardio"), inferDistanceUnit("Jump Rope")]).toEqual(["m", "km", "km", "none", "none"]);
  });

  it("draws a searched type with the nearest icon", () => {
    expect([inferIcon("Open Water Swim"), inferIcon("Mountain Bike"), inferIcon("Track Run"), inferIcon("Bouldering")]).toEqual(["swim", "ride", "run", "other"]);
  });

  it("lists each COROS type once, after the suggested ones", () => {
    const labels = ALL_LOG_SPORTS.map((s) => s.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(ALL_LOG_SPORTS.map((s) => s.id)).size).toBe(ALL_LOG_SPORTS.length);
    expect(ALL_LOG_SPORTS.slice(0, 8)).toEqual(SUGGESTED_LOG_SPORTS);
    expect(labels).not.toContain("all sports");
  });

  it("searches every type, at most 12 at a time", () => {
    expect(visibleLogSports("row", "suggested-run").map((s) => s.label)).toEqual(["Rowing", "Indoor Rowing"]);
    expect(visibleLogSports("  INDOOR bike ", "suggested-run").map((s) => s.label)).toEqual(["Indoor Bike"]);
    expect(visibleLogSports("zumba", "suggested-run")).toEqual([]);
    expect(visibleLogSports("i", "suggested-run").length).toBeLessThanOrEqual(12);
  });

  it("keeps a type picked through search in view once the search is closed", () => {
    expect(visibleLogSports("", "suggested-swim")).toHaveLength(8);
    expect(visibleLogSports("", "coros-rowing").map((s) => s.label)).toEqual(["Rowing", "Run", "Ride", "Walk", "Hike", "Swim", "Strength", "Yoga", "Other"]);
    expect(logSport("nothing-like-this").label).toBe("Run");
  });
});

describe("the form as an activity", () => {
  it("reads the board's run: local start, whole seconds, kilometres as metres", () => {
    expect(logActivityInput(form())).toEqual({ sport: "run", startTimeIso: new Date(2026, 10, 18, 6, 40).toISOString(), durationSec: 2520, distanceM: 8200, calories: 571, avgHr: 148 });
  });

  it("takes a swim's distance in metres and no distance for strength, yoga and other", () => {
    expect(logActivityInput(form({ sportId: "suggested-swim", distance: "1500" }))).toMatchObject({ sport: "other", distanceM: 1500 });
    expect(logActivityInput(form({ sportId: "suggested-strength" }))).toMatchObject({ sport: "other", distanceM: 0 });
    expect(logActivityInput(form({ sportId: "suggested-ride", distance: "41,37" }))).toMatchObject({ sport: "bike", distanceM: 41_370 });
  });

  it("leaves out what wasn't typed", () => {
    const sent = logActivityInput(form({ distance: "", calories: "", avgHr: "abc" }));
    expect(sent).toEqual({ sport: "run", startTimeIso: new Date(2026, 10, 18, 6, 40).toISOString(), durationSec: 2520, distanceM: 0 });
  });

  it("needs a duration and a start", () => {
    expect(logActivityInput(form({ hours: "", minutes: "" }))).toBeNull();
    expect(logActivityInput(form({ hours: "0", minutes: "0" }))).toBeNull();
    expect(logActivityInput(form({ time: "" }))).toBeNull();
    expect(logActivityInput(form({ time: "25:00" }))).toBeNull();
    expect(logDuration({ hours: "1", minutes: "5" })).toBe(3900);
    expect(logStart({ date: "2026-11-18", time: "23:59" })?.getHours()).toBe(23);
  });
});

describe("the form in imperial units", () => {
  afterEach(() => useUnitsNow("metric"));

  it("takes miles and yards and labels the field with them", () => {
    useUnitsNow("imperial");
    expect(logDistanceLabel("km")).toBe("mi");
    expect(logDistanceLabel("m")).toBe("yd");
    expect(logDistanceLabel("none")).toBe("");
    expect(logActivityInput(form({ distance: "5" }))).toMatchObject({ distanceM: 8047 });
    expect(logActivityInput(form({ sportId: "suggested-swim", distance: "1000" }))).toMatchObject({ distanceM: 914 });
  });

  it("labels metric as km and m", () => {
    expect(logDistanceLabel("km")).toBe("km");
    expect(logDistanceLabel("m")).toBe("m");
  });
});
