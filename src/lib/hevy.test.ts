import { describe, expect, it } from "vitest";
import {
  fullHevySync, hevyExerciseId, hevyExerciseNames, hevyGymId, hevyGymWorkout, historyStart, incrementalHevySync, isHevyStale, lastSyncedText,
  mergeGymLogs, needsFullSync, parseHevyEventsPage, parseHevyTemplatesPage, parseHevyWorkout, parseHevyWorkoutsPage, HEVY_STALE_MS,
  type HevyCache, type HevyEvent, type HevyReader, type HevyWorkout,
} from "./hevy";
import { dateToRef, refToMs, type NativeGymWorkout } from "@/data/sync/native";
import { durationSeconds, strengthFromItems, volumeKg, workingSets } from "@/data/sync/strength";

// Friday 20 November 2026.
const NOW = new Date(2026, 10, 20, 14, 10);
const iso = (d: Date) => d.toISOString();
const at = (month: number, day: number, hour = 18, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute);

/** A workout as Hevy's API sends it (api.hevyapp.com/docs), with the fields the apps read. */
const raw = (id: string, start: Date, minutes = 60, extra: Record<string, unknown> = {}) => ({
  id, title: "Push", description: "felt good", start_time: iso(start), end_time: iso(new Date(start.getTime() + minutes * 60_000)),
  updated_at: iso(start), created_at: iso(start),
  exercises: [
    {
      index: 1, title: "Pull Up (Assisted)", exercise_template_id: "ASSIST", superset_id: null, notes: "",
      sets: [{ index: 0, type: "normal", weight_kg: 20, reps: 8, distance_meters: null, duration_seconds: null, rpe: null }],
    },
    {
      index: 0, title: "Bench Press (Barbell)", exercise_template_id: "BENCH", superset_id: 2, notes: "pause reps",
      sets: [
        { index: 2, type: "failure", weight_kg: 82.5, reps: 3, distance_meters: null, duration_seconds: null, rpe: 9.5 },
        { index: 0, type: "warmup", weight_kg: 40, reps: 8, distance_meters: null, duration_seconds: null, rpe: null },
        { index: 1, type: "normal", weight_kg: 80.25, reps: 5, distance_meters: null, duration_seconds: null, rpe: 11 },
        { index: 3, type: "normal", weight_kg: null, reps: null, distance_meters: 400, duration_seconds: null, rpe: null },
      ],
    },
    { index: 2, title: "Plank", exercise_template_id: "PLANK", superset_id: null, notes: "", sets: [{ index: 0, type: "normal", weight_kg: null, reps: null, duration_seconds: 60.4 }] },
    { index: 3, title: "Row", exercise_template_id: "ROW", sets: [{ index: 0, type: "normal", weight_kg: null, reps: null, distance_meters: 2000, duration_seconds: null }] },
  ],
  ...extra,
});

const parsed = (id: string, start: Date, minutes = 60): HevyWorkout => parseHevyWorkout(raw(id, start, minutes))!;

describe("reading Hevy's JSON", () => {
  const w = parsed("b4c1e0a2-1111-4222-8333-944455556666", at(11, 17));

  it("keeps exercises and sets in Hevy's order, with full-precision weights", () => {
    expect(w.title).toBe("Push");
    expect(w.start).toBe(at(11, 17).getTime());
    expect(w.end).toBe(at(11, 17, 19).getTime());
    expect(w.exercises.map((e) => e.title)).toEqual(["Bench Press (Barbell)", "Pull Up (Assisted)", "Plank"]);
    expect(w.exercises[0]).toMatchObject({ templateId: "BENCH", supersetId: 2 });
    expect(w.exercises[0].sets).toEqual([
      { type: "warmup", weightKg: 40, reps: 8 },
      { type: "normal", weightKg: 80.25, reps: 5 }, // an RPE of 11 is not one
      { type: "failure", weightKg: 82.5, reps: 3, rpe: 9.5 },
    ]);
    expect(w.exercises[2].sets).toEqual([{ type: "normal", seconds: 60 }]);
  });

  it("leaves out sets with only a distance, exercises left empty, notes and descriptions", () => {
    expect(JSON.stringify(w)).not.toContain("Row");
    expect(JSON.stringify(w)).not.toContain("pause reps");
    expect(JSON.stringify(w)).not.toContain("felt good");
  });

  it("drops what can't be a workout", () => {
    expect(parseHevyWorkout(null)).toBeNull();
    expect(parseHevyWorkout({ ...raw("x", at(11, 17)), id: "" })).toBeNull();
    expect(parseHevyWorkout({ ...raw("x", at(11, 17)), start_time: "soon" })).toBeNull();
    expect(parseHevyWorkout({ ...raw("x", at(11, 17)), exercises: [] })).toBeNull();
    // An end before the start is no end.
    expect(parseHevyWorkout({ ...raw("x", at(11, 17)), end_time: iso(at(11, 16)) })!.end).toBeUndefined();
    expect(parseHevyWorkout({ ...raw("x", at(11, 17)), title: " " })!.title).toBe("Hevy workout");
  });

  it("reads a page of workouts, of changes and of templates", () => {
    const page = parseHevyWorkoutsPage({ page: 1, page_count: 4, workouts: [raw("a", at(11, 17)), { id: "broken" }, raw("b", at(11, 15))] }, 1);
    expect(page.workouts.map((x) => x.id)).toEqual(["a", "b"]);
    expect(page).toMatchObject({ seen: 3, pageCount: 4 });
    expect(parseHevyWorkoutsPage({}, 3)).toEqual({ workouts: [], seen: 0, pageCount: 3 });

    const events = parseHevyEventsPage({ page_count: 1, events: [
      { type: "updated", workout: raw("new", at(11, 19)) }, { type: "deleted", id: "gone", deleted_at: "x" }, { type: "updated", workout: { id: "bad" } },
    ] }, 1);
    expect(events.events.map((e) => e.deleted ?? e.updated.id)).toEqual(["new", "gone"]);
    expect(events.seen).toBe(3);

    const templates = parseHevyTemplatesPage({ page_count: 5, exercise_templates: [
      { id: "ASSIST", title: "Pull Up (Assisted)", type: "bodyweight_assisted_reps" }, { id: "BENCH", title: "Bench Press (Barbell)", type: "weight_reps" },
    ] }, 1);
    expect(templates).toEqual({ assisted: ["ASSIST"], seen: 2, pageCount: 5 });
  });
});

/** A reader over fixed workouts, ten a page newest first, that notes every request. */
function fixtureReader(workouts: HevyWorkout[], events: HevyEvent[] = [], assisted: string[] = ["ASSIST"]) {
  const asked: string[] = [];
  const sorted = [...workouts].sort((a, b) => b.start - a.start);
  const reader: HevyReader = {
    async workouts(page) {
      asked.push(`workouts ${page}`);
      const slice = sorted.slice((page - 1) * 10, page * 10);
      return { workouts: slice, seen: slice.length, pageCount: Math.max(1, Math.ceil(sorted.length / 10)) };
    },
    async events(since, page) {
      asked.push(`events ${since} ${page}`);
      const slice = events.slice((page - 1) * 10, page * 10);
      return { events: slice, seen: slice.length, pageCount: Math.max(1, Math.ceil(events.length / 10)) };
    },
    async templates(page) {
      asked.push(`templates ${page}`);
      return { assisted: page === 1 ? assisted : [], seen: page === 1 ? 2 : 0, pageCount: 1 };
    },
  };
  return { reader, asked };
}

const daysAgo = (days: number, hour = 18) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour);

describe("keeping a year current", () => {
  it("reads the year page by page and stops at the first workout older than it", async () => {
    const workouts = [...Array(23).keys()].map((k) => parsed(`w${k}`, daysAgo(k * 20)));
    // w0…w18 are within 365 days (18 × 20 = 360); w19 is 380 days back.
    const { reader, asked } = fixtureReader(workouts);
    const progress: number[] = [];
    const cache = await fullHevySync(reader, "u-1", NOW, (n) => progress.push(n));
    expect(cache.workouts.map((w) => w.id)).toEqual([...Array(19).keys()].map((k) => `w${k}`));
    expect(asked).toEqual(["templates 1", "workouts 1", "workouts 2"]); // page 3 is never asked for
    expect(progress).toEqual([10, 19]);
    expect(cache).toMatchObject({ v: 1, userId: "u-1", assisted: ["ASSIST"], coverageSince: historyStart(NOW), cursor: NOW.toISOString() });
  });

  it("stops on an empty page even when Hevy's page count says more", async () => {
    const asked: number[] = [];
    const reader: HevyReader = {
      workouts: async (page) => { asked.push(page); return { workouts: page === 1 ? [parsed("a", daysAgo(1))] : [], seen: page === 1 ? 1 : 0, pageCount: 99 }; },
      events: async () => ({ events: [], seen: 0, pageCount: 1 }),
      templates: async () => ({ assisted: [], seen: 0, pageCount: 99 }),
    };
    expect((await fullHevySync(reader, "u-1", NOW)).workouts).toHaveLength(1);
    expect(asked).toEqual([1, 2]);
  });

  it("drops what Hevy no longer has when the year is read again", async () => {
    const first = await fullHevySync(fixtureReader([parsed("a", daysAgo(1)), parsed("b", daysAgo(2))]).reader, "u-1", NOW);
    expect(first.workouts).toHaveLength(2);
    const again = await fullHevySync(fixtureReader([parsed("a", daysAgo(1))]).reader, "u-1", NOW);
    expect(again.workouts.map((w) => w.id)).toEqual(["a"]);
  });

  const cache = (workouts: HevyWorkout[]): HevyCache =>
    ({ v: 1, userId: "u-1", workouts, assisted: ["ASSIST"], coverageSince: historyStart(daysAgo(3)), cursor: "2026-11-17T06:00:00.000Z", lastSyncedAt: daysAgo(3).getTime() });

  it("applies Hevy's changes oldest first, so the newest word on a workout stays", async () => {
    const edited = { ...parsed("a", daysAgo(4)), title: "Edited last" }, earlier = { ...parsed("a", daysAgo(4)), title: "Edited first" };
    // Hevy lists the newest change first.
    const { reader, asked } = fixtureReader([], [{ updated: edited }, { deleted: "b" }, { updated: earlier }, { updated: parsed("c", daysAgo(0)) }]);
    const next = await incrementalHevySync(cache([parsed("a", daysAgo(4)), parsed("b", daysAgo(6))]), reader, NOW);
    expect(next.workouts.map((w) => [w.id, w.title])).toEqual([["c", "Push"], ["a", "Edited last"]]);
    expect(asked).toEqual(["events 2026-11-17T06:00:00.000Z 1"]);
    expect(next.cursor).toBe(NOW.toISOString());
    expect(next.coverageSince).toBe(historyStart(daysAgo(3)));
  });

  it("lets a workout recreated after its deletion stay, and one deleted after an edit go", async () => {
    const kept = await incrementalHevySync(cache([]), fixtureReader([], [{ updated: parsed("a", daysAgo(1)) }, { deleted: "a" }]).reader, NOW);
    expect(kept.workouts.map((w) => w.id)).toEqual(["a"]);
    const gone = await incrementalHevySync(cache([parsed("a", daysAgo(1))]), fixtureReader([], [{ deleted: "a" }, { updated: parsed("a", daysAgo(1)) }]).reader, NOW);
    expect(gone.workouts).toEqual([]);
  });

  it("lets go of workouts that have left the year, cached or edited", async () => {
    const { reader } = fixtureReader([], [{ updated: parsed("moved", daysAgo(400)) }]);
    const next = await incrementalHevySync(cache([parsed("old", daysAgo(366)), parsed("moved", daysAgo(5)), parsed("fresh", daysAgo(2))]), reader, NOW);
    expect(next.workouts.map((w) => w.id)).toEqual(["fresh"]);
  });

  it("reads the assisted list again only for an exercise it hasn't seen", async () => {
    const seen = fixtureReader([], [{ updated: parsed("c", daysAgo(0)) }]);
    await incrementalHevySync(cache([parsed("a", daysAgo(4))]), seen.reader, NOW);
    expect(seen.asked.some((a) => a.startsWith("templates"))).toBe(false);
    const novel: HevyWorkout = { ...parsed("d", daysAgo(0)), exercises: [{ title: "Dip (Assisted)", templateId: "NEW", sets: [{ type: "normal", weightKg: 15, reps: 8 }] }] };
    const unseen = fixtureReader([], [{ updated: novel }], ["ASSIST", "NEW"]);
    const next = await incrementalHevySync(cache([parsed("a", daysAgo(4))]), unseen.reader, NOW);
    expect(unseen.asked).toContain("templates 1");
    expect(next.assisted).toEqual(["ASSIST", "NEW"]);
  });

  it("keeps the old cursor when a read fails part-way", async () => {
    const before = cache([parsed("a", daysAgo(4))]);
    const failing: HevyReader = { ...fixtureReader([]).reader, events: async () => { throw new Error("HTTP 500"); } };
    await expect(incrementalHevySync(before, failing, NOW)).rejects.toThrow("HTTP 500");
    expect(before.cursor).toBe("2026-11-17T06:00:00.000Z");
    expect(before.workouts).toHaveLength(1);
  });

  it("knows when only a full read will do, and when the cache is stale", () => {
    const good = cache([]);
    expect(needsFullSync(null, "u-1", NOW)).toBe(true);
    expect(needsFullSync(good, "u-1", NOW)).toBe(false);
    expect(needsFullSync(good, "someone-else", NOW)).toBe(true);
    expect(needsFullSync({ ...good, cursor: "" }, "u-1", NOW)).toBe(true);
    expect(needsFullSync({ ...good, coverageSince: NOW.getTime() }, "u-1", NOW)).toBe(true);
    expect(needsFullSync({ ...good, v: 2 as unknown as 1 }, "u-1", NOW)).toBe(true);
    expect(isHevyStale(null, NOW.getTime())).toBe(true);
    expect(isHevyStale({ ...good, lastSyncedAt: NOW.getTime() - HEVY_STALE_MS + 1 }, NOW.getTime())).toBe(false);
    expect(isHevyStale({ ...good, lastSyncedAt: NOW.getTime() - HEVY_STALE_MS - 1 }, NOW.getTime())).toBe(true);
  });
});

describe("a Hevy workout as a gym-log workout", () => {
  const w = parsed("b4c1e0a2-1111-4222-8333-944455556666", at(11, 17), 50);
  const assisted = new Set(["ASSIST"]);

  it("is counted by the Strength maths without warm-ups by default", () => {
    const gym = hevyGymWorkout(w, assisted, false);
    expect(gym.id).toBe("B4C1E0A2-1111-4222-8333-944455556666");
    expect(gym.name).toBe("Push");
    expect(durationSeconds(gym)).toBe(3000);
    expect(gym.entries!.map((e) => e.exerciseID)).toEqual(["hevy:BENCH", "hevy:ASSIST", "hevy:PLANK"]);
    expect(gym.entries![0].sets!.map((s) => s.kind)).toEqual(["warmUp", "normal", "failure"]);
    expect(gym.entries![0].superset).toBe(2);
    // Working sets: 80.25×5, 82.5×3, the assisted pull-ups and the plank. Not the warm-up.
    expect(workingSets(gym)).toHaveLength(4);
    expect(volumeKg(gym)).toBe(80.25 * 5 + 82.5 * 3); // 648.75: the 20 kg of assistance is not weight lifted
    expect(gym.entries![0].sets![2].rpe).toBe(9.5);
    expect(gym.entries![2].sets![0].seconds).toBe(60);
  });

  it("counts warm-ups in sets, volume and records when the switch is on", () => {
    const gym = hevyGymWorkout(w, assisted, true);
    expect(gym.entries![0].sets!.map((s) => s.kind)).toEqual(["normal", "normal", "failure"]);
    expect(workingSets(gym)).toHaveLength(5);
    expect(volumeKg(gym)).toBe(40 * 8 + 80.25 * 5 + 82.5 * 3); // 968.75
  });

  it("carries no weight for an assisted exercise, and keeps it when the exercise isn't known to be one", () => {
    expect(hevyGymWorkout(w, assisted, false).entries![1].sets![0]).not.toHaveProperty("weightKg");
    expect(hevyGymWorkout(w, new Set(), false).entries![1].sets![0].weightKg).toBe(20);
  });

  it("marks every set done, spread evenly over the workout as the phone does", () => {
    const gym = hevyGymWorkout(w, assisted, false);
    const times = gym.entries!.flatMap((e) => e.sets!.map((s) => refToMs(s.doneAt!)));
    // Five sets over 50 minutes: one every 10 minutes, the last at the end.
    expect(times.map((t) => Math.round((t - w.start) / 60_000))).toEqual([10, 20, 30, 40, 50]);
    const open = hevyGymWorkout({ ...w, end: undefined }, assisted, false);
    expect(open.end).toBeUndefined();
    expect(durationSeconds(open)).toBe(0);
  });

  it("names its exercises as Hevy does, by template so the same exercise is one lift", () => {
    expect(hevyExerciseId({ title: "Bench Press (Barbell)", templateId: "BENCH" })).toBe("hevy:BENCH");
    expect(hevyExerciseId({ title: "My Own Lift" })).toBe("hevy:my own lift");
    const renamed: HevyWorkout = { ...parsed("later", at(11, 19)), exercises: [{ title: "Bench Press - Paused (Barbell)", templateId: "BENCH", sets: [{ type: "normal", weightKg: 60, reps: 5 }] }] };
    expect(hevyExerciseNames([renamed, w])).toMatchObject({ "hevy:BENCH": "Bench Press - Paused (Barbell)", "hevy:PLANK": "Plank" });
  });
});

describe("the same workout from the phone and from Hevy", () => {
  const phoneWorkout = (id: string, start: Date, minutes: number | null, extra: Partial<NativeGymWorkout> = {}): NativeGymWorkout => ({
    id, name: "From the phone", start: dateToRef(start), ...(minutes != null ? { end: dateToRef(new Date(start.getTime() + minutes * 60_000)) } : {}),
    entries: [{ id: `${id}-e`, exerciseID: "bench", sets: [{ id: `${id}-s`, kind: "normal", weightKg: 85, reps: 5, doneAt: dateToRef(start) }] }], ...extra,
  });
  const hevy = (id: string, start: Date, minutes = 60) => hevyGymWorkout(parsed(id, start, minutes), new Set(["ASSIST"]), false);
  const ID = "b4c1e0a2-1111-4222-8333-944455556666";

  it("shows the phone's copy of a workout the phone imported from Hevy, edits included", () => {
    const imported = phoneWorkout(hevyGymId(ID), at(11, 17), 60, { editedAt: dateToRef(at(11, 18)) });
    const merged = mergeGymLogs([imported], [hevy(ID, at(11, 17))]);
    expect(merged.workouts).toEqual([imported]);
    expect(merged.fromHevy.size).toBe(0);
    expect(merged.leftOut).toBe(1);
    // Even when the athlete moved it to another day on the phone: the id decides.
    const moved = phoneWorkout(hevyGymId(ID), at(11, 10), 60);
    expect(mergeGymLogs([moved], [hevy(ID, at(11, 17))]).workouts).toEqual([moved]);
  });

  it("leaves out a Hevy workout that overlaps one logged in C-LINK", () => {
    const logged = phoneWorkout("AAAA", at(11, 17, 18, 10), 20);
    expect(mergeGymLogs([logged], [hevy(ID, at(11, 17))]).workouts).toEqual([logged]);
    // Touching ends don't overlap; a later session the same day is its own workout.
    const before = phoneWorkout("BBBB", at(11, 17, 17), 60);
    const merged = mergeGymLogs([before], [hevy(ID, at(11, 17))]);
    expect(merged.workouts).toHaveLength(2);
    expect([...merged.fromHevy]).toEqual([hevyGymId(ID)]);
  });

  it("takes a phone workout with no end as its start alone", () => {
    expect(mergeGymLogs([phoneWorkout("CCCC", at(11, 17, 18, 30), null)], [hevy(ID, at(11, 17))]).leftOut).toBe(1);
    expect(mergeGymLogs([phoneWorkout("DDDD", at(11, 17, 19, 30), null)], [hevy(ID, at(11, 17))]).leftOut).toBe(0);
  });

  it("keeps two Hevy workouts of the same day both", () => {
    const merged = mergeGymLogs([], [hevy("a", at(11, 17, 7)), hevy("b", at(11, 17, 18))]);
    expect(merged.workouts).toHaveLength(2);
    expect(merged.leftOut).toBe(0);
  });

  it("feeds the Strength screen once: totals, lifts and marked rows", () => {
    const phone = [phoneWorkout(hevyGymId(ID), at(11, 17), 60), phoneWorkout("EEEE", at(11, 12), 45)];
    const fromHevy = [hevy(ID, at(11, 17)), hevy("f00d", at(11, 19), 50)];
    const merged = mergeGymLogs(phone, fromHevy);
    const strength = strengthFromItems(merged.workouts, { exerciseNames: { bench: "Bench press" } }, NOW,
      { ids: merged.fromHevy, names: hevyExerciseNames([parsed("f00d", at(11, 19), 50)]) });
    expect(strength.workouts.map((r) => [r.date, r.name, r.source])).toEqual([
      ["Thu 19 Nov", "Push", "hevy"], ["Tue 17 Nov", "From the phone", undefined], ["Thu 12 Nov", "From the phone", undefined],
    ]);
    expect(strength.workouts[0]).toMatchObject({ top: "Bench Press (Barbell) 82.5 kg × 3 · Pull Up (Assisted) × 8 · Plank 60 s", sets: 4, liftedKg: 649, seconds: 3000 });
    const fourWeeks = strength.ranges.find((r) => r.key === "4w")!;
    // 85×5 twice from the phone plus 648.75 from Hevy; the duplicate of 17 Nov is counted once.
    expect(fourWeeks.totals.reduce((a, b) => a + b, 0) * 1000).toBeCloseTo(425 + 425 + 648.75, 6);
    expect(fourWeeks.workouts).toBe(3);
    expect(strength.lifts.map((l) => [l.name, l.bestKg])).toEqual([["Bench press", 85], ["Bench Press (Barbell)", 82.5]]);
    // Muscles and the suggestion stay the phone's: Hevy adds nothing there.
    expect(strength.muscles).toEqual([]);
    expect(strength.suggestion.title).toBe("No suggestion yet");
  });
});

describe("last synced", () => {
  it("is worded as on the canvas", () => {
    expect(lastSyncedText(null, NOW)).toBe("Never");
    expect(lastSyncedText(at(11, 20, 7, 12).getTime(), NOW)).toBe("Today at 07:12");
    expect(lastSyncedText(at(11, 19, 21, 40).getTime(), NOW)).toBe("Yesterday at 21:40");
    expect(lastSyncedText(at(11, 3, 9, 5).getTime(), NOW)).toBe("3 Nov at 09:05");
    expect(lastSyncedText(at(12, 30, 9, 5, 2025).getTime(), NOW)).toBe("30 Dec 2025 at 09:05");
  });
});
