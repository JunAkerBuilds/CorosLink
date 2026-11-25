import { describe, expect, it } from "vitest";
import {
  changeText, dateText, doneSetCount, durationSeconds, liftedRanges, liftNote, mainLifts, muscleRow, strengthFromItems,
  suggestionCard, topLine, volumeKg, weeksAgo, weekStart, workingSets, workoutRows, NOTHING_YET,
} from "./strength";
import { dateToRef, type NativeGymSet, type NativeGymWorkout, type ViewStrengthBody } from "./native";
import { seedItems } from "@/data/sampleSeed";

// Friday 20 November 2026. Its week starts Monday 16 November.
const NOW = new Date(2026, 10, 20, 14, 10);
const seed = seedItems(NOW);
const seedWorkouts = seed.filter((i) => i.collection === "gym.workout").map((i) => i.body as NativeGymWorkout);
const seedView = seed.find((i) => i.collection === "view.strength")!.body as ViewStrengthBody;

let n = 0;
const done = dateToRef(new Date(2026, 10, 17, 18, 30));
const set = (weightKg: number | undefined, reps: number | undefined, extra: Partial<NativeGymSet> = {}): NativeGymSet =>
  ({ id: `s${n++}`, kind: "normal", ...(weightKg != null ? { weightKg } : {}), ...(reps != null ? { reps } : {}), doneAt: done, ...extra });
/** A finished workout on a local day, with one exercise per [exerciseID, sets] pair. */
const workout = (day: Date, lines: [string, NativeGymSet[]][], minutes = 60, name = "Workout"): NativeGymWorkout => ({
  id: `w${n++}`, name, start: dateToRef(day), end: dateToRef(new Date(day.getTime() + minutes * 60_000)),
  entries: lines.map(([exerciseID, sets]) => ({ id: `e${n++}`, exerciseID, sets })),
});
const at = (month: number, day: number, hour = 18, year = 2026) => new Date(year, month - 1, day, hour);

describe("one workout", () => {
  const w = workout(at(11, 17), [
    ["bench", [set(40, 8, { kind: "warmUp" }), set(77.5, 5), set(77.5, 5), set(80, 3, { kind: "failure" }), { id: "x", kind: "normal", weightKg: 80, reps: 5 }]],
    ["pull-up", [set(undefined, 8), set(10, undefined)]],
    ["plank", [{ id: "p", kind: "normal", seconds: 60, doneAt: done }]],
  ], 52.5, "Upper body");

  it("counts working sets, done sets and volume as the phone does", () => {
    // Working: 77.5×5, 77.5×5, 80×3, reps only, weight only, plank. Not the warm-up, not the set never done.
    expect(workingSets(w)).toHaveLength(6);
    expect(doneSetCount(w)).toBe(7);
    expect(volumeKg(w)).toBe(77.5 * 5 + 77.5 * 5 + 80 * 3); // 1015: a missing weight or reps counts 0
    expect(durationSeconds(w)).toBe(3150);
    expect(durationSeconds({ ...w, end: undefined })).toBe(0);
    expect(volumeKg({ id: "e", start: 0 })).toBe(0);
  });

  it("writes the top line from the heaviest working set of the first exercises", () => {
    expect(topLine(w, { bench: "Bench press", plank: "Plank" })).toBe("Bench press 80 kg × 3 · pull-up 10 kg · Plank 60 s");
    expect(topLine(w, { bench: "Bench press" }, 1)).toBe("Bench press 80 kg × 3");
  });

  it("makes the table row", () => {
    expect(dateText(at(11, 17))).toBe("Tue 17 Nov");
    const older = workout(at(11, 3), [["bench", [set(75, 5)]]], 30, " ");
    const rows = workoutRows([older, w], { bench: "Bench press" });
    expect(rows.map((r) => r.date)).toEqual(["Tue 17 Nov", "Tue 3 Nov"]);
    expect(rows[0]).toMatchObject({ id: w.id, name: "Upper body", sets: 6, liftedKg: 1015, seconds: 3150 });
    expect(rows[1]).toMatchObject({ name: "Workout", top: "Bench press 75 kg × 5", sets: 1, liftedKg: 375, seconds: 1800 });
  });

  it("matches the seeded athlete's first workout, worked out by hand", () => {
    const first = [...seedWorkouts].sort((a, b) => a.start - b.start)[0];
    // Upper body at the starting weights; the last set of each lift has one more rep.
    // 72.5×21 + 65×33 + 47.5×16 + 10×19 + 14×31 + 27.5×37 = 1522.5 + 2145 + 760 + 190 + 434 + 1017.5 = 6069
    expect(first.name).toBe("Upper body");
    expect(volumeKg(first)).toBe(6069);
    expect(workingSets(first)).toHaveLength(20);
    expect(doneSetCount(first)).toBe(26); // six warm-ups
    expect(durationSeconds(first)).toBe(first.end! - first.start);
    const row = workoutRows(seedWorkouts, seedView.exerciseNames ?? {}).at(-1)!;
    expect(row.sets).toBe(20);
    expect(row.liftedKg).toBe(6069);
    expect(row.seconds).toBe(Math.round(first.end! - first.start));
    expect(row.top.split(" · ")).toHaveLength(3);
    expect(row.top).toContain("72.5 kg × 6");
  });
});

describe("ranges", () => {
  it("finds Monday-start weeks", () => {
    expect(weekStart(NOW)).toEqual(new Date(2026, 10, 16));
    expect(weekStart(new Date(2026, 10, 22, 23, 59))).toEqual(new Date(2026, 10, 16)); // Sunday belongs to the week before it ends
    expect(weeksAgo(at(11, 16, 0), NOW)).toBe(0);
    expect(weeksAgo(at(11, 15, 23), NOW)).toBe(1);
    expect(weeksAgo(at(10, 26), NOW)).toBe(3);
    expect(weeksAgo(at(10, 25), NOW)).toBe(4);
  });

  it("writes the change against the period before", () => {
    expect(changeText(5600, 5000)).toBe("+12%");
    expect(changeText(4500, 5000)).toBe("−10%");
    expect(changeText(5000, 5000)).toBe("0%");
    expect(changeText(5000, 0)).toBe("");
  });

  const ws = [
    workout(at(11, 17), [["bench", [set(100, 10)]]], 60), // this week: 1,000 kg
    workout(at(11, 16, 7), [["bench", [set(50, 10), set(50, 10, { kind: "warmUp" })]]], 30), // this week: 500 kg
    workout(at(11, 12), [["bench", [set(100, 5)]]], 45), // last week: 500 kg
    workout(at(10, 27), [["bench", [set(100, 20)]]], 60), // 3 weeks ago: 2,000 kg
    workout(at(10, 25), [["bench", [set(100, 25)]]], 60), // 4 weeks ago (Sunday): 2,500 kg, the period before "4 weeks"
    workout(at(9, 1), [["bench", [set(100, 10)]]], 60), // 11 weeks ago: 1,000 kg
    workout(at(8, 30), [["bench", [set(100, 30)]]], 60), // 12 weeks ago (Sunday 30 Aug): 3,000 kg
    workout(at(12, 5, 18, 2025), [["bench", [set(100, 40)]]], 120), // December 2025: 4,000 kg
    workout(at(11, 30, 18, 2025), [["bench", [set(100, 50)]]], 60), // November 2025: the year before
  ];
  const [four, twelve, year] = liftedRanges(ws, NOW);

  it("buckets 4 weeks ending with this one", () => {
    expect(four).toMatchObject({ key: "4w", per: "week", workouts: 4, sets: 4 });
    expect(four.totals).toEqual([2, 0, 0.5, 1.5]);
    expect(four.hours).toBe(3.25); // 60 + 30 + 45 + 60 minutes
    expect(four.change).toBe("+60%"); // 4,000 against 2,500
  });

  it("buckets 12 weeks", () => {
    expect(twelve.totals).toEqual([1, 0, 0, 0, 0, 0, 0, 2.5, 2, 0, 0.5, 1.5]);
    expect(twelve.workouts).toBe(6);
    expect(twelve.change).toBe("+150%"); // 7,500 against 3,000
  });

  it("buckets the year by calendar month", () => {
    expect(year.per).toBe("month");
    // Dec 2025 … Nov 2026
    expect(year.totals).toEqual([4, 0, 0, 0, 0, 0, 0, 0, 3, 1, 4.5, 2]);
    expect(year.workouts).toBe(8);
    expect(year.hours).toBe(8.25);
    expect(year.change).toBe("+190%"); // 14,500 against 5,000
  });

  it("has no change text when the period before is empty, and copes with no workouts", () => {
    expect(liftedRanges([ws[0]], NOW).map((r) => r.change)).toEqual(["", "", ""]);
    const empty = liftedRanges([], NOW);
    expect(empty.map((r) => r.totals.length)).toEqual([4, 12, 12]);
    expect(empty[0]).toMatchObject({ workouts: 0, sets: 0, hours: 0, change: "" });
  });

  it("puts every seeded workout of the last 12 weeks in the 12-week range", () => {
    const r = liftedRanges(seedWorkouts, NOW)[1];
    const inRange = seedWorkouts.filter((w) => { const b = weeksAgo(new Date((w.start + 978307200) * 1000), NOW); return b >= 0 && b < 12; });
    expect(r.workouts).toBe(inRange.length);
    expect(r.totals.reduce((a, b) => a + b, 0)).toBeCloseTo(inRange.reduce((a, w) => a + volumeKg(w), 0) / 1000, 6);
  });
});

describe("main lifts", () => {
  const N = null;
  it("writes the note from the weekly history", () => {
    expect(liftNote([N, N, N, N, N, N, N, N, N, N, 77.5, 80], 77.5)).toBe("New best, +2.5 kg");
    expect(liftNote([N, N, N, N, N, N, N, N, N, 80, 80, N], 77.5)).toBe("New best, +2.5 kg"); // last week still counts
    expect(liftNote([75, N, N, N, N, N, N, 80, 80, 80, 80, 80], 80)).toBe("Holding for 5 weeks");
    expect(liftNote([75, N, N, N, N, N, N, 80, N, N, N, 80], 80)).toBe("Holding for 5 weeks");
    expect(liftNote([77.5, 77.5, 80, 80, 80, 82.5, 82.5, 82.5, 85, 82.5, 80, 80], 85)).toBe("+2.5 kg in 12 weeks");
    expect(liftNote([N, N, 100, N, N, N, N, N, 95, N, N, N], 100)).toBe("−5 kg in 7 weeks");
    expect(liftNote([N, N, N, N, N, 60, N, N, N, N, N, N], null)).toBe(""); // one week only
    expect(liftNote([N, N, N, N, N, N, N, N, N, N, N, 60], null)).toBe(""); // first time: nothing to beat
    expect(liftNote([80, N, N, N, N, N, N, N, N, N, 82.5, 80], 82.5)).toBe(""); // back where it started, nothing to say
    expect(liftNote(new Array(12).fill(N), null)).toBe("");
  });

  const ws = [
    workout(at(11, 17), [["bench", [set(60, 5, { kind: "warmUp" }), set(80, 5), set(77.5, 5)]], ["squat", [set(100, 5)]], ["dip", [set(undefined, 12)]]]),
    workout(at(11, 10), [["bench", [set(77.5, 5)]], ["squat", [set(100, 5)]]]),
    workout(at(11, 11), [["bench", [set(75, 5)]]]),
    workout(at(10, 20), [["bench", [set(75, 5)]], ["row", [set(60, 8)]]]),
    workout(at(9, 1), [["squat", [set(100, 5)]]]),
    workout(at(8, 1), [["bench", [set(90, 1)]], ["curl", [set(20, 10)]]]), // 15 weeks ago
  ];
  const lifts = mainLifts(ws, { bench: "Bench press", squat: "Back squat" }, NOW);

  it("ranks by workouts in the last 12 weeks and names them", () => {
    // bench 4 workouts, squat 3, row 1. Dips have no weight; the curl is older than 12 weeks.
    expect(lifts.map((l) => l.name)).toEqual(["Bench press", "Back squat", "row"]);
    expect(mainLifts(ws, {}, NOW, 2).map((l) => l.name)).toEqual(["bench", "squat"]);
  });

  it("takes the best from every synced workout and the history from the last 12 weeks", () => {
    expect(lifts[0].bestKg).toBe(90); // the single from August
    expect(lifts[0].history).toEqual([75, 77.5, 80]); // weeks of 19 Oct, 9 Nov (the heavier of two workouts), 16 Nov
    expect(lifts[0].note).toBe("+5 kg in 5 weeks"); // not a new best: 90 came before
    expect(lifts[1].history).toEqual([100, 100, 100]);
    expect(lifts[1].note).toBe("Holding for 12 weeks"); // week of 31 Aug to this one
    expect(lifts[2]).toMatchObject({ bestKg: 60, history: [60], note: "" });
  });

  it("calls a new best only when it beats what came before", () => {
    const fresh = mainLifts(ws.slice(0, 5), {}, NOW)[0];
    expect(fresh.bestKg).toBe(80);
    expect(fresh.note).toBe("New best, +2.5 kg");
  });

  it("finds the seeded athlete's lifts", () => {
    const seeded = mainLifts(seedWorkouts, seedView.exerciseNames ?? {}, NOW);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.length).toBeLessThanOrEqual(4);
    // Bench press: 72.5 for two weeks from 12 Oct, 75 for two, 77.5 for the last two.
    const bench = seeded.find((l) => l.history[0] === 72.5)!;
    expect(bench).toMatchObject({ bestKg: 77.5, history: [72.5, 72.5, 75, 75, 77.5, 77.5], note: "+5 kg in 6 weeks" });
    for (const l of seeded) {
      expect(l.bestKg).toBeGreaterThanOrEqual(Math.max(...l.history));
      expect(l.history.length).toBeLessThanOrEqual(12);
    }
  });
});

describe("muscles", () => {
  const inHours = (h: number) => dateToRef(new Date(NOW.getTime() + h * 3_600_000));
  const row = (m: Partial<NonNullable<ViewStrengthBody["muscles"]>[number]>) => muscleRow({ name: "Lats", fatigue: 44, ...m }, NOW);

  it("is recovering while readyAt is ahead", () => {
    expect(row({ readyAt: inHours(26) })).toEqual({ name: "Lats", fatigue: 44, state: "recovering", note: "Ready in 1 day" });
    expect(row({ readyAt: inHours(60) }).note).toBe("Ready in 3 days"); // 2.5 days
    expect(row({ readyAt: inHours(6) }).note).toBe("Ready tonight"); // 20:10 today
    expect(row({ readyAt: inHours(2) }).note).toBe("Ready in 2 hours"); // 16:10
    expect(row({ readyAt: inHours(0.5) }).note).toBe("Ready in 1 hour");
    expect(row({ readyAt: inHours(20) }).note).toBe("Ready in 20 hours"); // tomorrow morning
  });

  it("is ready once readyAt has passed or is missing", () => {
    expect(row({ readyAt: inHours(-1), lastTrainedAt: inHours(-70) })).toMatchObject({ state: "ready", note: "Ready" });
    expect(row({})).toMatchObject({ state: "ready", note: "Ready" });
    expect(row({ fatigue: 12.6 }).fatigue).toBe(13);
  });

  it("is overdue from 14 days without training, up to 90", () => {
    expect(row({ lastTrainedAt: inHours(-13.9 * 24) }).state).toBe("ready");
    expect(row({ lastTrainedAt: inHours(-16 * 24) })).toMatchObject({ state: "overdue", note: "Not trained in 16 days" });
    expect(row({ lastTrainedAt: inHours(-90.5 * 24) })).toMatchObject({ state: "overdue", note: "Not trained in 90 days" });
    expect(row({ lastTrainedAt: inHours(-91 * 24) }).state).toBe("ready");
  });

  it("maps the seeded view", () => {
    const s = strengthFromItems(seedWorkouts, seedView, NOW);
    expect(s.muscles).toHaveLength(17);
    const by = Object.fromEntries(s.muscles.map((m) => [m.name, m]));
    expect(by.Biceps).toMatchObject({ state: "recovering", note: "Ready tonight", fatigue: 31 }); // 20:10
    expect(by.Lats).toMatchObject({ state: "recovering", note: "Ready in 1 day" }); // 26 hours
    expect(by["Upper back"]).toMatchObject({ state: "recovering", note: "Ready in 20 hours" });
    expect(by.Calves).toMatchObject({ state: "overdue", note: "Not trained in 16 days" });
    expect(by.Chest).toMatchObject({ state: "ready", note: "Ready" });
  });
});

describe("suggestion and the whole screen", () => {
  it("lists the suggested exercises and claims nothing else", () => {
    expect(suggestionCard(seedView.suggestion)).toMatchObject({
      title: "Push day", text: "4 exercises: Bench press, Overhead press, Triceps pushdown, Plank.",
    });
    expect(suggestionCard({ title: "Pull day" })).toMatchObject({ title: "Pull day", text: "" });
    expect(suggestionCard({ title: "Pull day", exercises: [{ name: "Barbell row" }] }).text).toBe("1 exercise: Barbell row.");
  });

  it("keeps the card's shell with one short line when there is no suggestion", () => {
    expect(suggestionCard(undefined)).toMatchObject({ title: "No suggestion yet", text: "" });
    expect(NOTHING_YET).toBe("Nothing from your phone yet");
  });

  it("is an honest empty screen with no gym items", () => {
    const s = strengthFromItems([], undefined, NOW);
    expect(s.muscles).toEqual([]);
    expect(s.lifts).toEqual([]);
    expect(s.workouts).toEqual([]);
    expect(s.ranges.every((r) => r.totals.every((v) => v === 0) && r.change === "")).toBe(true);
  });

  it("builds the seeded screen newest first", () => {
    const s = strengthFromItems(seedWorkouts, seedView, NOW);
    expect(s.workouts).toHaveLength(seedWorkouts.length);
    expect(s.workouts[0].id).toBe([...seedWorkouts].sort((a, b) => b.start - a.start)[0].id);
    expect(s.workouts[0].top).not.toContain("barbell-"); // names from exerciseNames, not ids
  });
});
