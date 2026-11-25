import { describe, expect, it } from "vitest";
import { formatLapPace, metresAt } from "@/lib/activities";
import { seedItems } from "@/data/sampleSeed";
import {
  activitiesFromItems, activityFromNative, detailFromBody, distanceFromSpeed, localStart, matchGymWorkout, paceFromSpeed, recordsFor, ROUTE_BOX, SPORT_FAMILY,
  strengthFromGym, thresholdsFrom,
} from "./activities";
import { SPORT_TITLE } from "./geo";
import { dateToRef, type ActivityDetailBody, type NativeActivity, type NativeGymWorkout, type NativeSport } from "./native";

const NOW = new Date(2026, 10, 20, 14, 10);
const seed = seedItems(NOW);
const activityItems = seed.filter((i) => i.collection === "activity").map((i) => ({ id: i.id, body: i.body as NativeActivity }));
const details = new Map(seed.filter((i) => i.collection === "activity.detail").map((i) => [i.id, i.body as ActivityDetailBody]));
const list = activitiesFromItems(activityItems);
const native = (id: string) => activityItems.find((i) => i.id === id)!.body;

describe("activities table from synced items", () => {
  it("lists every seeded activity, newest first, at its local start", () => {
    expect(list).toHaveLength(activityItems.length);
    expect(list.every((a, k) => k === 0 || a.start <= list[k - 1].start)).toBe(true);
    expect(list.every((a) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.start))).toBe(true);
    // Wednesday 18 Nov 2026, 07:42 is the last Morning tempo before `NOW`.
    const tempo = list.find((a) => a.name === "Morning tempo")!;
    expect(tempo.start).toBe("2026-11-18T07:42");
    expect(localStart(dateToRef(new Date(2026, 0, 5, 6, 7, 59)))).toBe("2026-01-05T06:07");
  });

  it("copies the numbers the phone sent, untouched", () => {
    for (const a of list) {
      const n = native(a.id);
      expect(a.durationS).toBe(n.durationSeconds);
      expect(a.distanceM).toBe(n.distanceMeters ?? null);
      expect(a.avgHr).toBe(n.averageHR);
      expect(a.maxHr).toBe(n.maxHR);
      expect(a.load).toBe(n.trainingLoad);
      expect(a.elevationGainM).toBe(n.elevationGain ?? null);
      expect(a.cadence).toBe(n.averageCadence ?? null);
    }
    expect(list.find((a) => a.sport === "Strength")!.distanceM).toBeNull();
  });

  it("leaves what the phone did not send empty instead of zero", () => {
    const a = activityFromNative("1", { id: "1", name: "", sport: "trailRun", start: dateToRef(new Date(2026, 10, 1, 9, 5)), averageHR: 0 })!;
    expect(a).toEqual({
      id: "1", start: "2026-11-01T09:05", name: "Trail run", sport: "Run", sportName: "Trail run",
      distanceM: null, durationS: 0, avgHr: null, maxHr: null, elevationGainM: null, cadence: null, load: null,
    });
  });

  it("leaves out an activity without a start time", () => {
    expect(activityFromNative("2", { id: "2", name: "No clock", sport: "run" })).toBeNull();
    expect(activitiesFromItems([{ id: "2", body: { id: "2", name: "No clock", sport: "run" } }, activityItems[0]])).toHaveLength(1);
  });

  it("puts every sport in a family and keeps its exact name", () => {
    const expected: Record<NativeSport, [family: string, shown: string]> = {
      run: ["Run", "Run"], indoorRun: ["Run", "Indoor run"], trailRun: ["Run", "Trail run"], track: ["Run", "Track run"],
      walk: ["Run", "Walk"], hike: ["Run", "Hike"], bike: ["Ride", "Ride"], indoorBike: ["Ride", "Indoor ride"],
      poolSwim: ["Swim", "Pool swim"], openWater: ["Swim", "Open water"], strength: ["Strength", "Strength"],
      cardio: ["Other", "Cardio"], ski: ["Other", "Ski"], row: ["Other", "Row"], multisport: ["Other", "Multisport"], other: ["Other", "Workout"],
    };
    expect(Object.keys(SPORT_FAMILY).sort()).toEqual(Object.keys(SPORT_TITLE).sort());
    for (const sport of Object.keys(expected) as NativeSport[]) {
      const a = activityFromNative("x", { id: "x", name: "N", sport, start: 0 })!;
      expect([a.sport, a.sportName ?? a.sport]).toEqual(expected[sport]);
    }
    // A sport this build has never heard of still gets a row.
    expect(activityFromNative("x", { id: "x", name: "N", sport: "kite" as NativeSport, start: 0 })!.sport).toBe("Other");
  });
});

describe("pace from speed", () => {
  it("is seconds per km on foot, per 100 m in the water and km/h on a bike", () => {
    expect(paceFromSpeed("Run", [4, 2.5])).toEqual([250, 400]);
    expect(paceFromSpeed("Swim", [0.8, 1.25])).toEqual([125, 80]);
    expect(paceFromSpeed("Ride", [10, 0])).toEqual([36, 0]);
    expect(paceFromSpeed("Strength", [1, 2])).toBeNull();
    expect(paceFromSpeed("Other", [1, 2])).toBeNull();
  });

  it("shows a stop as the slowest moving pace, never infinity", () => {
    expect(paceFromSpeed("Run", [4, 0, 2, 0.1])).toEqual([250, 500, 500, 500]);
    expect(paceFromSpeed("Run", [0, 0])).toBeNull();
  });

  it("adds speed up into distance and ends at the activity's own distance", () => {
    // 2 m/s for 10 s, then speeding up to 4 m/s over 10 s: 20 m + 30 m.
    expect(distanceFromSpeed([0, 10, 20], [2, 2, 4], null)).toEqual([0, 20, 50]);
    expect(distanceFromSpeed([0, 10, 20], [2, 2, 4], 100)).toEqual([0, 40, 100]);
    expect(distanceFromSpeed([0, 10], [0, 0], 100)).toBeNull();
  });
});

describe("activity page from synced items", () => {
  const run = list.find((a) => a.name === "Morning tempo")!;
  const runBody = details.get(run.id)!;
  const runDetail = detailFromBody(run, runBody);
  const ride = list.find((a) => a.sport === "Ride" && details.has(a.id))!;
  const rideBody = details.get(ride.id)!;
  const rideDetail = detailFromBody(ride, rideBody);

  it("seeds a run and a ride with their recordings, and a swim and a gym session with heart rate only", () => {
    // Besides these four, the other rides and the long runs carry a plain recording for the Sports pages.
    expect(details.size).toBeGreaterThan(4);
    const heartOnly = [...details.values()].filter((d) => !d.laps && !d.route && !d.streams?.speedMps);
    expect(heartOnly).toHaveLength(2);
    for (const d of heartOnly) expect(Object.keys(d.streams!).sort()).toEqual(["axis", "hr", "x"]);
    expect(runBody.streams!.axis).toBe("distance");
    expect(rideBody.streams!.axis).toBe("time");
  });

  it("keeps lap times to the hundredth", () => {
    expect(runDetail.laps).toHaveLength(runBody.laps!.length);
    expect(runDetail.laps.map((l) => l.durationS)).toEqual(runBody.laps!.map((l) => l.durationS));
    expect(runDetail.laps.map((l) => l.distanceM)).toEqual(runBody.laps!.map((l) => l.distanceM));
    expect(runDetail.laps.some((l) => Math.round(l.durationS * 100) % 100 !== 0)).toBe(true);
    const first = runDetail.laps[0];
    expect(formatLapPace("Run", first)).toMatch(/^\d:\d\d\.\d\d$/);
    expect(runDetail.laps.map((l) => l.n)).toEqual(runDetail.laps.map((_, k) => k + 1));
  });

  it("carries the workout steps and their names", () => {
    expect(runDetail.steps!.map((s) => s.name)).toEqual(["Warm up", "Tempo", "Cool down"]);
    expect(runDetail.steps!.reduce((s, l) => s + (l.distanceM ?? 0), 0)).toBe(run.distanceM);
    expect(rideDetail.steps).toBeNull();
    expect(detailFromBody(run, { ...runBody, steps: [] }).steps).toBeNull();
  });

  it("turns the run's speed into seconds per km, sample for sample", () => {
    const s = runDetail.streams!, speed = runBody.streams!.speedMps!;
    expect(s.axis).toBe("distance");
    expect(s.x).toEqual(runBody.streams!.x);
    expect(s.pace).toHaveLength(s.x.length);
    expect(s.pace![0]).toBe(1000 / speed[0]);
    expect(s.pace![200]).toBe(1000 / speed[200]);
    expect(s.hr).toEqual(runBody.streams!.hr);
    expect(s.elevation).toEqual(runBody.streams!.elevationM);
    expect(s.cadence).toEqual(runBody.streams!.cadence);
    expect(s.distance).toBeUndefined();
  });

  it("draws every stream inside its scale", () => {
    for (const d of [runDetail, rideDetail]) {
      const s = d.streams!, sc = d.scales!;
      const inside = (values: number[] | null, scale: [number, number] | null) => values != null && scale != null && values.every((v) => v >= scale[0] && v <= scale[1]);
      expect(inside(s.pace, sc.pace)).toBe(true);
      expect(inside(s.hr, sc.hr)).toBe(true);
      expect(inside(s.elevation, sc.elevation)).toBe(true);
    }
    // The run's elevation runs from about 71 to 105 m: the chart starts just under it, not at sea level.
    expect(runDetail.scales!.elevation![0]).toBeGreaterThan(50);
  });

  it("projects the route into the drawing box and ends it at the activity's distance", () => {
    for (const d of [runDetail, rideDetail]) {
      const r = d.route!;
      expect(r.length).toBeGreaterThan(100);
      expect(r.every((p) => p.x >= ROUTE_BOX.pad - 0.1 && p.x <= ROUTE_BOX.width - ROUTE_BOX.pad + 0.1 && p.y >= ROUTE_BOX.pad - 0.1 && p.y <= ROUTE_BOX.height - ROUTE_BOX.pad + 0.1)).toBe(true);
      expect(r[0].d).toBe(0);
      expect(r[r.length - 1].d).toBeCloseTo(d.activity.distanceM!, 1);
      expect(r.every((p, k) => k === 0 || p.d >= r[k - 1].d)).toBe(true);
      // Each point keeps where it is on Earth, for the real map.
      expect(r.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))).toBe(true);
    }
  });

  it("reads the ride over time, with speed in km/h and metres worked out for the route", () => {
    const s = rideDetail.streams!, speed = rideBody.streams!.speedMps!;
    expect(s.axis).toBe("time");
    expect(s.pace![0]).toBeCloseTo(speed[0] * 3.6, 10);
    expect(s.pace![100]).toBeCloseTo(speed[100] * 3.6, 10);
    expect(s.distance).toHaveLength(s.x.length);
    expect(s.distance![0]).toBe(0);
    expect(s.distance![s.x.length - 1]).toBeCloseTo(ride.distanceM!, 6);
    expect(metresAt(s, s.x[s.x.length - 1])).toBeCloseTo(ride.distanceM!, 6);
    expect(metresAt(s, (s.x[10] + s.x[11]) / 2)).toBeCloseTo((s.distance![10] + s.distance![11]) / 2, 6);
    expect(metresAt(runDetail.streams!, 1234)).toBe(1234);
  });

  it("copies the heart rate zones", () => {
    expect(runDetail.zones).toEqual(runBody.zones);
    expect(runDetail.zones).toHaveLength(5);
  });

  it("shows only the summary when the recording has not been read", () => {
    const other = list.find((a) => !details.has(a.id))!;
    expect(detailFromBody(other, undefined)).toEqual({ activity: other, laps: [], steps: null, streams: null, scales: null, route: null, zones: [] });
  });

  it("copes with a recording that holds almost nothing", () => {
    expect(detailFromBody(run, {})).toEqual({ activity: run, laps: [], steps: null, streams: null, scales: null, route: null, zones: [] });
    // Heart rate only: no pace or elevation chart, and no scale for them.
    const hrOnly = detailFromBody(run, { streams: { axis: "time", x: [0, 10, 20], hr: [100, 110, 120] }, laps: [{ n: 1, durationS: 20.25 }] });
    expect(hrOnly.streams).toMatchObject({ axis: "time", pace: null, hr: [100, 110, 120], elevation: null, cadence: null });
    expect(hrOnly.scales).toEqual({ pace: null, hr: [90, 130], elevation: null });
    expect(hrOnly.laps).toEqual([{ n: 1, distanceM: null, durationS: 20.25, avgHr: null, maxHr: null, cadence: null, elevationM: null }]);
    // No heart rate: the pace chart still draws.
    const noHr = detailFromBody(run, { streams: { axis: "distance", x: [0, 100, 200], speedMps: [4, 4, 5] } });
    expect(noHr.streams!.hr).toBeNull();
    expect(noHr.scales!.hr).toBeNull();
    expect(noHr.streams!.pace).toEqual([250, 250, 200]);
    // A stream shorter than the axis is not drawn.
    expect(detailFromBody(run, { streams: { axis: "distance", x: [0, 100, 200], hr: [100, 110] } }).streams).toBeNull();
  });
});

describe("what the other items add to an activity", () => {
  const REF = 800_000_000;
  const lift: NativeActivity = { id: "L", name: "Strength", sport: "strength", start: REF, durationSeconds: 2700, averageHR: 112, maxHR: 140 };
  const workout = (id: string, start: number, end: number, entries: NativeGymWorkout["entries"] = []): NativeGymWorkout => ({ id, start, end, entries });
  const done = (weightKg: number, reps: number, at: number, kind: "normal" | "warmUp" = "normal") => ({ id: `s${at}`, kind, weightKg, reps, doneAt: REF + at });

  it("pairs a strength activity with the gym log that overlaps it most", () => {
    const logs = [workout("yesterday", REF - 86_400, REF - 84_000), workout("late", REF + 2500, REF + 5000), workout("this", REF + 120, REF + 2600)];
    expect(matchGymWorkout(lift, logs)?.id).toBe("this");
    expect(matchGymWorkout(lift, [logs[0]])).toBeNull();
    // Started four minutes after the watch stopped: still the same session.
    expect(matchGymWorkout(lift, [workout("after", REF + 2700 + 240, REF + 2700 + 900)])?.id).toBe("after");
    expect(matchGymWorkout({ ...lift, sport: "run" }, logs)).toBeNull();
  });

  it("turns the log into exercises, with muscles from the app's own table", () => {
    const log = workout("this", REF, REF + 2600, [
      { id: "e1", exerciseID: "bench-press-barbell", sets: [done(40, 8, 200, "warmUp"), done(72.5, 5, 400), done(72.5, 5, 600), { id: "x", kind: "normal", weightKg: 72.5, reps: 5 }] },
      { id: "e2", exerciseID: "pull-up", sets: [done(7.5, 6, 900)] },
      { id: "e3", exerciseID: "plank", sets: [{ id: "p", kind: "normal", seconds: 60, doneAt: REF + 1200 }] },
    ]);
    const session = strengthFromGym(log, REF, { "bench-press-barbell": "Bench press", "pull-up": "Pull-up" })!;
    expect(session.exercises.map((e) => [e.name, e.sets.length, e.bodyweight ?? false])).toEqual([["Bench press", 3, false], ["Pull-up", 1, true], ["Plank", 1, false]]);
    expect(session.exercises[0].sets[0]).toEqual({ weightKg: 40, reps: 8, seconds: null, endS: 200, warmUp: true });
    expect(session.exercises[2].sets[0]).toEqual({ weightKg: null, reps: null, seconds: 60, endS: 1200 });
    // Two working bench sets, one pull-up set, one plank: chest 2, lats 1, abs 1, triceps 2 × 0.5, …
    const by = Object.fromEntries(session.muscles!.map((m) => [m.name, m.sets]));
    expect(by).toMatchObject({ Chest: 2, Lats: 1, Abs: 1, Triceps: 1, "Upper back": 0.5 });
    expect(session.figure).toBeUndefined();
  });

  it("lists no muscles when an exercise is not in the table, and no session for a log with nothing done", () => {
    const own = workout("this", REF, REF + 2600, [{ id: "e1", exerciseID: "my-own-lift", sets: [done(50, 5, 300)] }, { id: "e2", exerciseID: "pull-up", sets: [done(0, 8, 600)] }]);
    const session = strengthFromGym(own, REF, {})!;
    expect(session.exercises[0].name).toBe("My own lift");
    expect(session.muscles).toBeUndefined();
    expect(strengthFromGym(workout("empty", REF, REF + 10, [{ id: "e", exerciseID: "plank", sets: [{ id: "p", kind: "normal", seconds: 60 }] }]), REF, {})).toBeNull();
  });

  it("adds thresholds, the week, records and effort without inventing the rest", () => {
    const row = activityFromNative("R", { id: "R", name: "Tempo", sport: "run", start: REF, distanceMeters: 8000, durationSeconds: 2300, averageHR: 158, maxHR: 172, calories: 512, averagePower: 286, trainingLoad: 96 })!;
    expect(row).toMatchObject({ calories: 512, avgPowerW: 286 });
    const training = { thresholdHr: 168, maxHr: 186, thresholdPaceSecPerKm: 275, ftp: 0, bests: [{ name: "5K", meters: 5000, seconds: 1251.37, activityId: "R" }, { name: "10K", meters: 10000, seconds: 2634.05, activityId: "other" }] };
    expect(thresholdsFrom(training)).toEqual({ hr: 168, maxHr: 186, paceSPerKm: 275 });
    expect(recordsFor("R", training)).toEqual([{ what: "5K", rank: "Personal best", value: "20:51.37", pace: "4:10 /km", best: true }]);
    const detail = detailFromBody(row, undefined, { all: [row], training });
    expect(detail.thresholds).toEqual({ hr: 168, maxHr: 186, paceSPerKm: 275 });
    expect(detail.week).toEqual({ index: 1, count: 1, time: 1, load: 1 });
    expect(detail.extras?.records).toHaveLength(1);
    expect(detail.extras?.relativeEffort).toMatchObject({ basis: "From average heart rate", harderThanPct: null });
    for (const key of ["summary", "weather", "journal", "gear", "swim", "strength", "elapsedS", "watchTempC"] as const) expect(detail.extras?.[key]).toBeUndefined();
    expect(detailFromBody(row, undefined)).toEqual({ activity: row, laps: [], steps: null, streams: null, scales: null, route: null, zones: [] });
  });

  it("keeps the power stream", () => {
    const row = activityFromNative("B", { id: "B", name: "Ride", sport: "bike", start: REF, distanceMeters: 20000, durationSeconds: 3000 })!;
    const detail = detailFromBody(row, { streams: { axis: "time", x: [0, 10, 20, 30], speedMps: [6, 7, 7, 6], powerW: [150, 180, 175, 160] } });
    expect(detail.streams?.power).toEqual([150, 180, 175, 160]);
  });
});
