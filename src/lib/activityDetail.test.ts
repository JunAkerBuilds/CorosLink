import { afterEach, describe, expect, it } from "vitest";
import type { Activity, Lap, Streams, SwimData, SwimLength, StrengthExercise } from "@/data/activities";
import { SAMPLE_ACTIVITIES, SAMPLE_THRESHOLDS, sampleActivityDetail } from "@/data/sample/activities";
import {
  decoupling, decouplingTitle, effortFromAverage, effortIndex, exerciseOneRepMax, fastestIndex, findClimbs, flatMetres, gradeFactor, groupRows, harderThan,
  hrZoneOf, hrZoneRange, hrZonesFromThreshold, lapsAreAutomatic, muscleLevel, muscleWork, normalizedPower, oneRepMax, pacingFinding, paceZoneOf, paceZoneRange,
  powerNumbers, powerZoneOf, powerZoneRange, relativeEffort, rowsFromLaps, sessionNumbers, showsGap, splitsFromTrack, swimNumbers, swimSets, swimSetText,
  thresholdPaceSentence, thresholdPercent, timedSets, timeInZones, topSetIndex, totalRow, trackOf, valueAt, weekShare, workoutKind, zoneShares,
  rowPace,
} from "./activityDetail";
import { MILE_M, useUnitsNow } from "./units";

const cs = (s: number) => Math.round(s * 100);
const lap = (n: number, distanceM: number | null, durationS: number, more: Partial<Lap> = {}): Lap => ({ n, distanceM, durationS, avgHr: null, maxHr: null, cadence: null, elevationM: null, ...more });

/** A flat 5 km at an even 5:00 /km, one sample every 100 m, heart rate 150. */
function evenRun(metres = 5000, elevation?: (m: number) => number): Streams {
  const x = Array.from({ length: metres / 100 + 1 }, (_, i) => i * 100);
  return { axis: "distance", x, pace: x.map(() => 300), hr: x.map(() => 150), elevation: elevation ? x.map(elevation) : null, cadence: x.map(() => 170) };
}

describe("effort and zones", () => {
  it("cuts the five heart-rate zones from threshold", () => {
    const z = hrZonesFromThreshold(168);
    expect(z.map((x) => x.fromBpm)).toEqual([null, 136, 151, 158, 168]);
    expect(z.map((x) => x.toBpm)).toEqual([135, 150, 157, 167, null]);
    expect(z.map(hrZoneRange)).toEqual(["under 136 bpm", "136–151 bpm", "151–158 bpm", "158–168 bpm", "168+ bpm"]);
    expect([120, 136, 150.9, 158, 167, 168, 200].map((b) => hrZoneOf(z, b))).toEqual([0, 1, 1, 3, 3, 4, 4]);
  });

  it("names the effort from percent of threshold", () => {
    expect(thresholdPercent(158, 168)).toBeCloseTo(94.05, 2);
    expect(thresholdPercent(null, 168)).toBeNull();
    expect([60, 80.9, 81, 89.9, 90, 93.9, 94, 99.9, 100, 112].map(effortIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("puts paces and watts in their zones", () => {
    expect([360, 354.75, 320, 300, 280, 275, 274.9].map((p) => paceZoneOf(p, 275))).toEqual([0, 0, 1, 2, 3, 3, 4]);
    expect([0, 1, 2, 3, 4].map((i) => paceZoneRange(i, 275))).toEqual(["slower than 5:55 /km", "5:14–5:55 /km", "4:52–5:14 /km", "4:35–4:52 /km", "faster than 4:35 /km"]);
    expect([100, 134.75, 135, 245, 258, 400].map((w) => powerZoneOf(w, 245))).toEqual([0, 0, 1, 3, 4, 6]);
    expect([0, 1, 6].map((i) => powerZoneRange(i, 245))).toEqual(["under 135 W", "135–184 W", "368+ W"]);
  });

  it("adds zone time up to the whole, skipping what it is told to", () => {
    const hr = [100, 140, 140, 160, 170, 20];
    const dt = [10, 20, 30, 40, 50, 60];
    const z = hrZonesFromThreshold(168);
    const t = timeInZones(hr, dt, (v) => hrZoneOf(z, v), 5, (v) => v <= 30);
    expect(t).toEqual([10, 50, 0, 40, 50]);
    expect(t.reduce((s, v) => s + v, 0)).toBe(150);
    const shares = zoneShares(t.map((seconds) => ({ seconds })));
    expect(shares.total).toBe(150);
    expect(shares.main).toBe(1);
    expect(shares.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
  });

  it("says how far off threshold pace a run was", () => {
    expect(thresholdPaceSentence(286, 275)).toBe("11 s/km slower than your threshold pace of 4:35 /km.");
    expect(thresholdPaceSentence(274, 275)).toBe("Right at your threshold pace of 4:35 /km.");
    expect(thresholdPaceSentence(200, 275)).toBe("1:15/km faster than your threshold pace of 4:35 /km.");
    expect(thresholdPaceSentence(null, 275)).toBeNull();
  });
});

describe("track and splits", () => {
  it("gives a distance recording a clock that ends on the activity's time", () => {
    const t = trackOf(evenRun(), "Run", 1503.5);
    expect(t.time[0]).toBe(0);
    expect(t.time[t.n - 1]).toBeCloseTo(1503.5, 6);
    expect(t.dt.reduce((s, v) => s + v, 0)).toBeCloseTo(1503.5, 6);
    expect(valueAt(t.dist as number[], t.time, 2500)).toBeCloseTo(751.75, 6);
  });

  it("cuts splits whose times and distances add up to the whole", () => {
    const streams = evenRun(5300);
    const track = trackOf(streams, "Run", 1590);
    const rows = splitsFromTrack(track, streams, "Run", 1000);
    expect(rows.map((r) => r.label)).toEqual(["1", "2", "3", "4", "5", "0.3"]);
    expect(rows.map((r) => r.partial)).toEqual([false, false, false, false, false, true]);
    expect(rows.reduce((s, r) => s + r.distanceM, 0)).toBe(5300);
    expect(rows.reduce((s, r) => s + r.durationS, 0)).toBeCloseTo(1590, 6);
    const total = totalRow(rows, "Total");
    expect(cs(total.durationS)).toBe(159000);
    expect(total.distanceM).toBe(5300);
    expect(total.avgHr).toBeCloseTo(150, 6);
    expect(Math.round(rows[0].strideM! * 100)).toBe(118); // 3.33 m/s at 170 steps a minute
  });

  it("joins kilometre rows into longer splits without losing a hundredth", () => {
    const tempo = sampleActivityDetail(SAMPLE_ACTIVITIES[0].id)!;
    const track = trackOf(tempo.streams!, "Run", tempo.activity.durationS);
    const rows = rowsFromLaps(tempo.laps, track, tempo.streams, "Run", 1000);
    expect(rows.map((r) => cs(r.durationS))).toEqual(tempo.laps.map((l) => cs(l.durationS)));
    expect(rows[0]).toMatchObject({ avgHr: 138, maxHr: 147, cadence: 168, strideM: 1.16, groundContactMs: 252, verticalOscCm: 9.4, powerW: 248, ascentM: 9, descentM: 4 });
    const five = groupRows(rows, 5, 1000);
    expect(five.map((r) => r.label)).toEqual(["5", "8.02"]);
    expect(five.map((r) => r.partial)).toEqual([false, true]);
    expect(five.reduce((s, r) => s + cs(r.durationS), 0)).toBe(cs(tempo.activity.durationS));
    const total = totalRow(rows, "Total");
    expect(cs(total.durationS)).toBe(229452);
    expect(total.ascentM).toBe(64);
    expect(total.descentM).toBe(60);
    expect(total.maxHr).toBe(172);
    expect(fastestIndex(rows)).toBe(5);
    expect(fastestIndex(rows.slice(0, 1))).toBe(-1);
  });

  it("tells the watch's automatic laps from pressed ones", () => {
    expect(lapsAreAutomatic([lap(1, 1000, 300), lap(2, 1000, 300), lap(3, 420, 130)])).toBe(true);
    expect(lapsAreAutomatic([lap(1, 1609, 480), lap(2, 800, 240)])).toBe(true);
    expect(lapsAreAutomatic([lap(1, 2000, 600), lap(2, 4000, 1100), lap(3, 2020, 590)])).toBe(false);
    expect(lapsAreAutomatic([lap(1, 5000, 700), lap(2, 5000, 700)])).toBe(false);
  });
});

describe("grade-adjusted pace", () => {
  it("costs nothing on the flat, more uphill, less (to a floor) downhill", () => {
    expect(gradeFactor(0)).toBeCloseTo(1, 9);
    expect(gradeFactor(0.1)).toBeGreaterThan(1.6);
    expect(gradeFactor(-0.1)).toBeLessThan(1);
    expect(gradeFactor(-0.2)).toBe(0.8);
    expect(gradeFactor(0.9)).toBe(gradeFactor(0.45));
  });

  it("makes a climb worth more flat metres and shows the column only when it matters", () => {
    const flat = evenRun(3000, () => 50), hill = evenRun(3000, (m) => 50 + m * 0.05);
    expect(flatMetres(flat.x, flat.elevation!, 0, 3000)).toBeCloseTo(3000, 6);
    expect(flatMetres(hill.x, hill.elevation!, 0, 3000)).toBeCloseTo(3000 * gradeFactor(0.05), 3);
    const rowsFlat = splitsFromTrack(trackOf(flat, "Run", 900), flat, "Run", 1000);
    const rowsHill = splitsFromTrack(trackOf(hill, "Run", 900), hill, "Run", 1000);
    expect(rowsFlat[0].gapS).toBeCloseTo(300, 3);
    expect(rowsHill[0].gapS).toBeCloseTo(300 / gradeFactor(0.05), 3);
    expect(showsGap(rowsFlat)).toBe(false);
    expect(showsGap(rowsHill)).toBe(true);
    expect(totalRow(rowsHill, "Total").gapS).toBeCloseTo(300 / gradeFactor(0.05), 3);
  });
});

describe("findings", () => {
  const base = { laps: [] as Lap[], movingS: 3000, thresholdHr: 168 };
  const kind = (hr: number, sport: Activity["sport"] = "Run", movingS = 3000) => {
    const values = Array.from({ length: 50 }, () => hr);
    return workoutKind({ ...base, sport, movingS, hr: values, dt: values.map(() => movingS / 50), avgHr: hr });
  };

  it("names the workout from where the heart rate sat", () => {
    expect(kind(170)).toBe("Hard effort");
    expect(kind(160)).toBe("Threshold");
    expect(kind(154)).toBe("Tempo");
    expect(kind(140)).toBe("Easy");
    expect(kind(140, "Run", 80 * 60)).toBe("Long");
    expect(kind(140, "Ride", 80 * 60)).toBe("Easy");
    expect(kind(125, "Run", 1800)).toBe("Recovery");
    expect(kind(150, "Swim")).toBeNull();
    expect(workoutKind({ ...base, sport: "Run", hr: null, dt: [], avgHr: 150 })).toBeNull();
    const reps = [lap(1, 800, 180), lap(2, 400, 150), lap(3, 800, 181), lap(4, 400, 152), lap(5, 800, 179)];
    expect(workoutKind({ ...base, sport: "Run", laps: reps, hr: null, dt: [], avgHr: null })).toBe("Intervals");
  });

  it("reads drift only from a long enough steady stretch", () => {
    const n = 200, time = Array.from({ length: n }, (_, i) => i * 15);
    const track = { n, time, dist: null, dt: time.map(() => 15), speed: null };
    const speed = time.map(() => 3.5);
    expect(decoupling(track, speed, time.map(() => 150))).toBeCloseTo(0, 9);
    const drifting = decoupling(track, speed, time.map((t) => (t < 1650 ? 150 : 165)))!;
    expect(drifting).toBeCloseTo((1 - 150 / 165) * 100, 1);
    expect(decouplingTitle(drifting)).toBe("Some drift: 9.1%");
    expect(decouplingTitle(-3)).toBe("Got more efficient as it went (3.0%)");
    expect(decouplingTitle(3.14)).toBe("Held steady: 3.1% drift");
    expect(decouplingTitle(12)).toBe("Large drift: 12.0%");
    const short = { ...track, n: 60, time: time.slice(0, 60), dt: time.slice(0, 60).map(() => 15) };
    expect(decoupling(short, speed.slice(0, 60), time.slice(0, 60).map(() => 150))).toBeNull();
  });

  it("words the pacing of the two halves", () => {
    expect(pacingFinding(-0.4)).toEqual({ title: "Even pacing", note: "Second half 0.4% faster" });
    expect(pacingFinding(-4)).toEqual({ title: "Negative split", note: "Second half 4.0% faster" });
    expect(pacingFinding(3.5).title).toBe("Slight fade");
    expect(pacingFinding(8)).toEqual({ title: "Positive split", note: "Second half 8.0% slower" });
  });
});

describe("ride power and climbs", () => {
  it("normalises steady power to itself and surges above the average", () => {
    const time = Array.from({ length: 601 }, (_, i) => i);
    expect(normalizedPower(time, time.map(() => 200))).toBeCloseTo(200, 6);
    const surging = time.map((t) => (Math.floor(t / 60) % 2 ? 300 : 100));
    const np = normalizedPower(time, surging)!;
    expect(np).toBeGreaterThan(215);
    expect(normalizedPower(time.slice(0, 20), surging.slice(0, 20))).toBeNull();
    const track = { n: time.length, time, dist: null, dt: time.map((_, i) => (i === 0 || i === 600 ? 0.5 : 1)), speed: null };
    const steady = powerNumbers(track, time.map(() => 245), 245);
    expect(steady.intensity).toBeCloseTo(1, 6);
    expect(steady.variability).toBeCloseTo(1, 6);
    // Ten minutes at threshold is a sixth of the 100 an hour would score.
    expect(steady.stress).toBeCloseTo(100 / 6, 4);
    expect(powerNumbers(track, surging, null).intensity).toBeNull();
  });

  it("finds the three hills of the sample ride and nothing on the flat", () => {
    const ride = sampleActivityDetail("2026-11-10-hill-ride")!;
    const climbs = findClimbs(trackOf(ride.streams!, "Ride", ride.activity.durationS), ride.streams!);
    expect(climbs).toHaveLength(3);
    for (const c of climbs) {
      expect(c.gainM).toBeGreaterThanOrEqual(80);
      expect(c.grade).toBeGreaterThanOrEqual(0.03);
      expect(c.toM - c.fromM).toBeGreaterThanOrEqual(500);
      expect(c.powerW).toBeGreaterThan(172);
    }
    const flat = evenRun(5000, () => 40);
    expect(findClimbs(trackOf(flat, "Run", 1500), flat)).toEqual([]);
  });
});

describe("relative effort and the week", () => {
  const all = SAMPLE_ACTIVITIES;
  it("weighs heart rate by how near the maximum it was", () => {
    expect(effortFromAverage(3600, 90, 186)).toBe(0);
    expect(effortFromAverage(3600, 158, 186)).toBe(240);
    expect(effortFromAverage(1800, 180, 186)).toBe(150);
  });

  it("ranks an effort against the same kind of workout in the 90 days before", () => {
    const tempo = all[0];
    const score = effortFromAverage(tempo.durationS, tempo.avgHr!, 186);
    const pct = harderThan(score, tempo, all, 186)!;
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
    // Two swims are not enough to compare a third against.
    const swim = all.find((a) => a.sport === "Swim")!;
    expect(harderThan(50, swim, all, 186)).toBeNull();
    expect(relativeEffort({ activity: tempo, streams: null, all, maxHr: 186 })).toMatchObject({ score: Math.round(score), harderThanPct: pct, basis: "From average heart rate" });
    expect(relativeEffort({ activity: tempo, streams: null, all, maxHr: null })).toBeNull();
  });

  it("scores strength from its sets when that says more, and does not rank it", () => {
    const lift = sampleActivityDetail("2026-11-17-strength-upper-body")!;
    const effort = relativeEffort({ activity: lift.activity, streams: null, all, maxHr: 186, exercises: lift.extras!.strength!.exercises })!;
    expect(effort.basis).toBe("From your sets");
    expect(effort.harderThanPct).toBeNull();
    const sets = lift.extras!.strength!.exercises.flatMap((ex) => ex.sets);
    const first = Math.min(...sets.map((x) => x.endS! - x.seconds!)), last = Math.max(...sets.map((x) => x.endS!));
    expect(first).toBe(336);
    expect(effort.score).toBe(Math.round(((last - first) / 60) * 3));
  });

  it("places an activity in its Monday-to-Sunday week", () => {
    const tempo = all[0]; // Thursday 19 November
    const week = weekShare(tempo, all)!;
    expect(week).toMatchObject({ index: 4, count: 4 });
    const mates = all.filter((a) => a.start >= "2026-11-16" && a.start < "2026-11-23");
    expect(week.time).toBeCloseTo(tempo.durationS / mates.reduce((s, a) => s + a.durationS, 0), 9);
    expect(week.load).toBeCloseTo(96 / mates.reduce((s, a) => s + (a.load ?? 0), 0), 9);
    expect(weekShare({ ...tempo, id: "elsewhere" }, all)).toBeNull();
  });
});

describe("swim", () => {
  const len = (stroke: SwimLength["stroke"], seconds: number, strokes: number | null, restAfterS = 0): SwimLength => ({ stroke, seconds, strokes, restAfterS });
  const pool: SwimData = {
    poolM: 25,
    lengths: [
      len("Freestyle", 30, 14), len("Freestyle", 30, 14), len("Freestyle", 30, 14), len("Freestyle", 30, 14, 30),
      len("Freestyle", 25, 15), len("Freestyle", 27, 15, 20), len("Freestyle", 26, 15), len("Freestyle", 26, 15, 20), len("Freestyle", 25, 16), len("Freestyle", 27, 16, 12),
      len("Breaststroke", 35, 10), len("Backstroke", 33, null),
    ],
  };

  it("adds up the swim's own numbers", () => {
    const n = swimNumbers(pool);
    expect(n).toMatchObject({ lengths: 12, distanceM: 300, activeS: 344, restS: 82 });
    expect(n.paceS).toBeCloseTo((344 / 300) * 100, 9);
    expect(n.swolf).toBeCloseTo((311 + 158) / 11, 9);
    expect(n.strokesPerLength).toBeCloseTo(158 / 11, 9);
    expect(n.strokeRate).toBeCloseTo((158 / 311) * 60, 9);
    expect(n.perStrokeM).toBeCloseTo((11 * 25) / 158, 9);
    expect(n.mix.map((m) => [m.stroke, m.distanceM])).toEqual([["Freestyle", 250], ["Breaststroke", 25], ["Backstroke", 25]]);
    expect(n.mix.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 9);
  });

  it("finds the sets from the rests at the wall", () => {
    const sets = swimSets(pool);
    expect(sets.map((s) => [s.reps.length, s.distanceM, s.stroke])).toEqual([[1, 100, "Freestyle"], [3, 50, "Freestyle"], [1, 50, "mixed"]]);
    expect(sets.reduce((s, x) => s + x.seconds, 0)).toBe(344);
    expect(sets[1].intervalS).toBe(70);
    expect(sets[1].avgRestS).toBe(20);
    expect(swimSetText(sets[0])).toEqual({ title: "100 m freestyle", detail: "4 lengths · 2:00 /100 m" });
    expect(swimSetText(sets[1])).toEqual({ title: "3 × 50 m freestyle on 1:10", detail: "Average 0:52, rest 0:20" });
    expect(swimSetText(sets[2]).title).toBe("50 m mixed strokes");
  });

  it("reads the sample swim as the canvas lists it", () => {
    const swim = sampleActivityDetail("2026-11-14-pool-swim")!.extras!.swim!;
    const n = swimNumbers(swim);
    expect(n).toMatchObject({ lengths: 60, distanceM: 1500, restS: 195 });
    expect(cs(n.activeS)).toBe(168000);
    const sets = swimSets(swim);
    expect(sets.map((s) => swimSetText(s).title)).toEqual(["300 m freestyle", "8 × 100 m freestyle on 2:05", "4 × 50 m breaststroke on 1:15", "200 m mixed strokes"]);
  });
});

describe("strength", () => {
  const set = (weightKg: number | null, reps: number | null, seconds: number | null = null, endS: number | null = null, warmUp?: boolean) => ({ weightKg, reps, seconds, endS, ...(warmUp ? { warmUp } : {}) });

  it("estimates a one-rep max the way the phone does", () => {
    expect(oneRepMax(100, 1)).toBe(100);
    expect(oneRepMax(77.5, 5)).toBeCloseTo(90.4167, 4);
    expect(oneRepMax(60, 13)).toBeNull();
    expect(oneRepMax(0, 5)).toBeNull();
    expect(exerciseOneRepMax({ name: "Bench press", sets: [set(72.5, 6), set(77.5, 5)] })).toBe(90.5);
    expect(exerciseOneRepMax({ name: "Bench press", sets: [set(100, 1)] })).toBeNull();
    expect(exerciseOneRepMax({ name: "Pull-up", bodyweight: true, sets: [set(10, 6)] })).toBeNull();
  });

  it("stars the top set only when another did less", () => {
    expect(topSetIndex([set(72.5, 6), set(77.5, 5), set(72.5, 6)])).toBe(0);
    expect(topSetIndex([set(70, 8), set(70, 8), set(70, 8)])).toBe(-1);
    expect(topSetIndex([set(null, 10), set(null, 12)])).toBe(1);
    expect(topSetIndex([set(80, 5)])).toBe(-1);
  });

  it("never stars a warm-up set", () => {
    expect(topSetIndex([set(87.5, 6, null, null, true), set(135, 3), set(130, 3)])).toBe(1);
    expect(topSetIndex([set(87.5, 6, null, null, true), set(135, 3)])).toBe(1);
  });

  it("adds up the session, leaving warm-ups out", () => {
    const ex: StrengthExercise[] = [
      { name: "Squat", sets: [set(50, 8, 30, 100, true), set(100, 5, 40, 300), set(100, 5, 40, 500)] },
      { name: "Row", sets: [set(60, 8, 30, 700)] },
    ];
    const n = sessionNumbers(ex);
    expect(n).toMatchObject({ sets: 3, exercises: 2, reps: 18, volumeKg: 1480, workS: 110, restS: 330, avgRestS: 165 });
    expect(n.density).toBeCloseTo(110 / 440, 9);
    expect(timedSets(ex).map((s) => s.restS)).toEqual([160, 170, null]);
    // Sets logged on the phone carry only the moment they were ticked off: no time under load, so no rest either.
    const logged = sessionNumbers([{ name: "Squat", sets: [set(100, 5, null, 300), set(100, 5, null, 500)] }]);
    expect(logged).toMatchObject({ sets: 2, volumeKg: 1000, workS: null, restS: null, density: null, avgRestS: null });
  });

  it("matches the sample session's numbers on the canvas", () => {
    const session = sampleActivityDetail("2026-11-17-strength-upper-body")!.extras!.strength!;
    expect(sessionNumbers(session.exercises)).toMatchObject({ sets: 18, exercises: 6, reps: 123, workS: 684 });
    expect(session.exercises.map(exerciseOneRepMax)).toEqual([90.5, 88.5, 58.5, null, 53.5, 21.5]);
  });

  it("counts muscles in effective sets", () => {
    const work = muscleWork([
      { workingSets: 4, muscles: [["chest", 1], ["triceps", 0.5], ["shoulders", 0.5]] },
      { workingSets: 3, muscles: [["shoulders", 1], ["triceps", 0.5]] },
      { workingSets: 0, muscles: [["calves", 1]] },
    ]);
    expect(work).toEqual([{ name: "shoulders", sets: 5 }, { name: "chest", sets: 4 }, { name: "triceps", sets: 3.5 }]);
    expect([8, 5.5, 3.5, 1.75, 0.2, 0].map(muscleLevel)).toEqual(["Hammered", "Hard", "Solid", "Moderate", "Light", null]);
  });
});

describe("the sample athlete's marks", () => {
  it("are the ones the canvas quotes", () => {
    expect(SAMPLE_THRESHOLDS).toMatchObject({ hr: 168, paceSPerKm: 275, ftp: 245 });
    const tempo = sampleActivityDetail(SAMPLE_ACTIVITIES[0].id)!;
    expect(Math.round(thresholdPercent(tempo.activity.avgHr, tempo.thresholds?.hr)!)).toBe(94);
    expect(tempo.zones.reduce((s, z) => s + cs(z.seconds), 0)).toBe(cs(tempo.activity.durationS));
  });
});

describe("imperial units", () => {
  afterEach(() => useUnitsNow("metric"));

  it("says paces and zones per mile", () => {
    useUnitsNow("imperial");
    expect(thresholdPaceSentence(286, 275)).toBe("18 s/mi slower than your threshold pace of 7:23 /mi.");
    expect(thresholdPaceSentence(274, 275)).toBe("Right at your threshold pace of 7:23 /mi.");
    expect(thresholdPaceSentence(200, 275)).toBe("2:01/mi faster than your threshold pace of 7:23 /mi.");
    expect(paceZoneRange(0, 275)).toBe("slower than 9:31 /mi");
    expect(paceZoneRange(4, 275)).toBe("faster than 7:23 /mi");
    expect(rowPace("Run", { distanceM: 1000, durationS: 300 })).toBe("8:03");
    expect(rowPace("Ride", { distanceM: 10000, durationS: 1200 })).toBe("18.6");
  });

  it("cuts and labels splits by the mile", () => {
    useUnitsNow("imperial");
    const streams = evenRun(5300);
    const rows = splitsFromTrack(trackOf(streams, "Run", 1590), streams, "Run", MILE_M);
    expect(rows.map((r) => r.label)).toEqual(["1", "2", "3", "0.29"]);
    expect(groupRows(rows, 2, MILE_M).map((r) => r.label)).toEqual(["2", "3.29"]);
  });

  it("names swim sets in yards", () => {
    useUnitsNow("imperial");
    const sets = swimSets(sampleActivityDetail("2026-11-14-pool-swim")!.extras!.swim!);
    expect(swimSetText(sets[1]).title).toBe("8 × 109 yd freestyle on 2:05");
    expect(swimSetText(sets[0]).detail).toMatch(/ \/100 yd$/);
  });
});
