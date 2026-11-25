import { describe, expect, it } from "vitest";
import type { PlanCard, WorkoutCard } from "@/data/coach";
import type { HubExercise, HubSavedWorkout, HubWorkout } from "@/data/hub";
import { seedItems } from "@/data/sampleSeed";
import { sharedSession } from "@/server/coach/hub";
import { buildProgram } from "@/server/hub/workout";
import { athleteItems, type Clock } from "./items";
import { blockNote, contextText } from "./prompt";
import { planEntries, profileText } from "./read";
import { parseRequest } from "./request";
import { runTool, type HubLoaders, type ToolContext } from "./tools";
import { describeHubWorkout, findExercise, parseWorkout, searchExercises, workoutCard } from "./workout";
import { raceLines, zoneLines, zonesFromHub, zonesFromPhone } from "./zones";

const NOW = new Date(2026, 10, 20, 14, 10);
const clock: Clock = { nowMs: NOW.getTime(), offsetMin: NOW.getTimezoneOffset() };
const items = athleteItems(seedItems(NOW));

const CATALOG: HubExercise[] = [
  { id: "11", name: "Barbell Back Squat", code: "T1101", overview: "sid_strength_barbell_back_squat" },
  { id: "12", name: "Goblet Squat", code: "T1301", overview: "sid_strength_goblet_squat" },
  { id: "13", name: "Romanian Deadlift", code: "T1410", overview: "sid_strength_romanian_deadlift" },
  { id: "14", name: "Walking Lunges", code: "T1502", overview: "sid_strength_walking_lunges" },
  { id: "15", name: "Plank", code: "T1700", overview: "sid_strength_plank" },
  { id: "99", name: "My cable thing" },
];
const TEMPO: HubWorkout = { name: "Tempo", sport: "run", description: "", blocks: [
  { repeats: null, steps: [{ id: "901", kind: "warmup", target: "time", seconds: 600, intensity: { kind: "none" } }] },
  { id: "77", repeats: 3, steps: [{ id: "902", kind: "training", target: "distance", meters: 2000, intensity: { kind: "heartRate", low: 160, high: 170 } }, { id: "903", kind: "rest", target: "open", intensity: { kind: "none" } }] },
] };
const LIBRARY: HubSavedWorkout[] = [{ id: "555", name: "5 × 1 km", sportCode: 1, sport: "run", hasSteps: true, workout: { ...TEMPO, name: "5 × 1 km" }, totals: { seconds: 600, meters: 6000, sets: 0 } }];
const hub = (over: Partial<HubLoaders> = {}): HubLoaders => ({ catalog: async () => CATALOG, library: async () => LIBRARY, libraryWorkout: async (id) => LIBRARY.find((w) => w.id === id) ?? { problem: "COROS has no saved workout with that id." }, ...over });
const HUB_DAYS = [{ day: "2026-11-24", workouts: [{ day: "2026-11-24", idInPlan: "7", planId: "", planProgramId: "", name: "Tempo", sportCode: 1, sport: "run" as const, workout: TEMPO, totals: { seconds: 600, meters: 6000, sets: 0 } }] }];
const BROWSER = [{ id: "w-1", name: "Hill reps", sport: "run" as const, date: "2026-11-23", repeatWeeks: 1, items: [{ type: "step" as const, id: "s1", kind: "work" as const, length: { type: "distance" as const, metres: 8000, unit: "km" as const }, target: { type: "pace" as const, fast: 300, slow: 320 } }], summary: { detail: "8.00 km · 45:00", metres: 8000, load: 88 }, savedAt: "" }];
const entries = planEntries(items, HUB_DAYS, BROWSER);
let n = 0;
const ctx = (loaders: HubLoaders | null = hub()): ToolContext => ({ items, clock, entries, hubNote: null, hub: loaders, browser: BROWSER, newId: () => `ID-${++n}`, asked: false });

const GYM = { name: "Legs", sport: "strength", blocks: [
  { steps: [{ kind: "warmup", target: "time", seconds: 300 }] },
  { steps: [{ kind: "training", target: "reps", count: 6, sets: 4, restSeconds: 150, exercise: "barbell back squat", intensity: { kind: "weight", low: 80 } }] },
  { steps: [{ kind: "training", target: "reps", count: 10, sets: 3, restSeconds: 90, exercise: "Walking Lunges", intensity: { kind: "bodyweight" } }] },
] };

describe("COROS's exercise list", () => {
  it("finds exercises by the words asked for, closest names first", () => {
    expect(searchExercises(CATALOG, "squats, lunge").map((e) => e.name)).toEqual(["Goblet Squat", "Walking Lunges", "Barbell Back Squat"]);
    expect(searchExercises(CATALOG, "bench")).toEqual([]);
    expect(searchExercises(CATALOG, "  ")).toEqual([]);
  });
  it("takes an exact name, case and punctuation forgiven, never a near one", () => {
    expect(findExercise(CATALOG, "barbell back-squat")?.id).toBe("11");
    expect(findExercise(CATALOG, "Back Squat")).toBeNull();
  });
  it("answers the search tool from the list, or says Training Hub isn't connected", async () => {
    const found = (await runTool("search_exercises", { query: "deadlift, plank" }, ctx())).text;
    expect(found.split("\n")[0]).toBe("COROS exercises: Plank; Romanian Deadlift");
    expect(found).toMatch(/In their own gym log: /);
    expect((await runTool("search_exercises", { query: "squat" }, ctx(null))).text).toMatch(/isn't connected.*plain exercise names/);
    expect((await runTool("search_exercises", { query: "squat" }, ctx(hub({ catalog: async () => ({ problem: "COROS couldn't be reached." }) })))).text).toMatch(/couldn't be read: COROS couldn't be reached/);
  });
});

describe("workouts for every sport", () => {
  it("writes a strength workout with COROS's own exercises, so it can go to COROS and the watch", () => {
    const made = parseWorkout(GYM, "2026-11-22", "w-g", CATALOG);
    if ("error" in made) throw new Error(made.error);
    expect(made.hub?.blocks[1].steps[0]).toMatchObject({ target: "reps", count: 6, sets: 4, restSeconds: 150, exercise: CATALOG[0], intensity: { kind: "weight", low: 80 } });
    expect(made.workout?.items[1]).toMatchObject({ label: "Barbell Back Squat · 4 × 6 · 80 kg" });
    // What COROS is sent: its own code as the name, grams, and the exercise's own description code.
    const rows = (buildProgram(made.hub!).exercises as Record<string, unknown>[]);
    expect(rows[1]).toMatchObject({ originId: "11", name: "T1101", overview: "sid_strength_barbell_back_squat", intensityValue: 80_000, sets: 4, restValue: 150 });
  });
  it("names the closest exercises when one isn't in the list", () => {
    expect(parseWorkout({ ...GYM, blocks: [{ steps: [{ kind: "training", target: "reps", count: 5, exercise: "Back Squat" }] }] }, "2026-11-22", "w", CATALOG))
      .toEqual({ error: "COROS has no exercise “Back Squat”. Closest: Barbell Back Squat; Goblet Squat. Use a name from search_exercises exactly as it is written." });
  });
  it("keeps a workout only COROS can hold as a COROS workout, with no browser copy", () => {
    const made = parseWorkout({ name: "Fartlek", sport: "trailRun", blocks: [
      { steps: [{ kind: "warmup", target: "open" }] },
      { repeats: 6, steps: [{ kind: "training", target: "elevationGain", meters: 80, intensity: { kind: "heartRate", low: 165, high: 175 } }, { kind: "rest", target: "hrRecovery", bpm: 120 }] },
    ] }, "2026-11-22", "w-t");
    if ("error" in made) throw new Error(made.error);
    expect(made.workout).toBeNull();
    expect(made.hub?.sport).toBe("trailRun");
    const card = workoutCard(made, null, { id: "c", date: "2026-11-22" });
    expect(card.workout).toBeUndefined();
    expect(card.steps.map((s) => [s.name, s.length, s.target])).toEqual([["Warm up", "open", ""], ["6 × Work", "+80 m", "Heart rate 165–175 bpm"], ["6 × Rest", "until 120 bpm", ""]]);
    expect(parseWorkout({ name: "Boulders", sport: "bouldering", gradeSystem: "vScale", blocks: [{ steps: [{ kind: "training", target: "routes", count: 5, intensity: { kind: "grade", grade: "V4" } }] }] }, "2026-11-22", "w")).toMatchObject({ workout: null, hub: { sport: "bouldering", gradeSystem: "vScale" } });
  });
  it("reads a COROS workout back step by step", () => {
    expect(describeHubWorkout(TEMPO)).toBe('"Tempo" · run\n1. warmup: warmup · 10:00\n2. 3 × repeat:\n   - training: training · 2.00 km · Heart rate 160–170 bpm\n   - rest: rest · open');
  });
});

describe("creating, changing and saved workouts through the tools", () => {
  it("puts a strength workout on a card that can go to COROS when Training Hub is read, and to the browser when not", async () => {
    const withHub = await runTool("propose_workout", { date: "2026-11-22", workout: GYM }, ctx());
    expect(withHub.text).toMatch(/^awaiting_confirmation/);
    expect((withHub.block as WorkoutCard).hub?.sport).toBe("strength");
    const without = await runTool("propose_workout", { date: "2026-11-22", workout: { ...GYM, blocks: [{ steps: [{ kind: "training", target: "reps", count: 5, sets: 3, exercise: "Back squat" }] }] } }, ctx(null));
    expect((without.block as WorkoutCard).hub).toBeUndefined();
    expect(without.text).toMatch(/saved on this computer's calendar/);
  });
  it("puts a saved COROS workout on the card exactly as saved, and a routine on C-LINK's calendar", async () => {
    const saved = await runTool("propose_workout", { date: "2026-11-25", saved_workout: "coros-555" }, ctx());
    expect(saved.block).toMatchObject({ kind: "workout", title: "5 × 1 km", saved: { id: "555", name: "5 × 1 km" }, hub: LIBRARY[0].workout });
    const routine = items.routines[0];
    const planned = await runTool("propose_workout", { date: "2026-11-25", saved_workout: `routine-${routine.id}` }, ctx());
    expect((planned.block as PlanCard).ops).toEqual([expect.objectContaining({ op: "add_routine", routineId: routine.id, day: "2026-11-25" })]);
    expect(await runTool("propose_workout", { date: "2026-11-25", saved_workout: "coros-1" }, ctx())).toMatchObject({ isError: true });
    expect(await runTool("propose_workout", { date: "2026-11-25" }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/No workout/) });
  });
  it("lists and reads saved workouts from both places", async () => {
    const list = (await runTool("list_saved_workouts", {}, ctx())).text;
    expect(list).toMatch(/saved_workout routine-/);
    expect(list).toContain("coros-555 · 5 × 1 km · run · 6.00 km, 10 min");
    expect((await runTool("list_saved_workouts", {}, ctx(null))).text).toMatch(/COROS workout library isn't listed/);
    expect((await runTool("read_saved_workout", { workout: "coros-555" }, ctx())).text).toMatch(/^# Saved workout coros-555, COROS library\n"5 × 1 km" · run/);
    expect((await runTool("read_saved_workout", { workout: `routine-${items.routines[0].id}` }, ctx())).text).toMatch(/C-LINK gym routine/);
  });
  it("reads a planned workout from COROS or the browser before it is changed", async () => {
    expect((await runTool("read_workout", { entry: "coros-2026-11-24-7" }, ctx())).text).toMatch(/^Planned on 2026-11-24 \[entry coros-2026-11-24-7\], COROS calendar:\n"Tempo"/);
    expect((await runTool("read_workout", { date: "2026-11-23", name: "Hill reps" }, ctx())).text).toContain("1. Work · 8.00 km · 5:00 to 5:20 /km");
    expect(await runTool("read_workout", { date: "2026-11-23", name: "Hills" }, ctx())).toMatchObject({ isError: true });
  });
  it("proposes a change as a card that keeps the workout as it was, for Undo", async () => {
    const shorter = { name: "Tempo, shorter", sport: "run", blocks: [{ repeats: 2, steps: [{ kind: "training", target: "distance", meters: 2000, intensity: { kind: "heartRate", low: 160, high: 170 } }, { kind: "rest", target: "time", seconds: 120 }] }] };
    const r = await runTool("propose_workout_change", { entry: "coros-2026-11-24-7", workout: shorter, note: "One block fewer." }, ctx());
    const card = r.block as WorkoutCard;
    expect(r.text).toMatch(/^awaiting_confirmation/);
    expect(card).toMatchObject({ kind: "workout", title: "Tempo, shorter", date: "2026-11-24", replaces: { id: "coros-2026-11-24-7", name: "Tempo", coros: { idInPlan: "7", workout: TEMPO } } });
    expect(card.added).toBeUndefined();
    expect(blockNote(card)).toBe("[Proposed changing “Tempo” on 2026-11-24 to “Tempo, shorter”: waiting for the athlete]");
    const gymEntry = entries.find((e) => e.planned)!;
    expect(await runTool("propose_workout_change", { entry: gymEntry.id, workout: shorter }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/can't be rewritten here/) });
    expect(await runTool("propose_workout_change", { entry: "browser-w-1", workout: { name: "Open", sport: "run", blocks: [{ steps: [{ kind: "training", target: "open" }] }] } }, ctx())).toMatchObject({ isError: true });
  });
  it("lays a multi-workout plan out as one card, each workout on its day", async () => {
    const r = await runTool("propose_training_plan", { name: "Back in", overview: "Easy first.", start_date: "2026-11-23", workouts: [
      { day: 1, workout: { name: "Easy", sport: "run", blocks: [{ steps: [{ kind: "training", target: "distance", meters: 6000 }] }] } },
      { day: 3, workout: GYM }, { day: 5, saved_workout: `routine-${items.routines[0].id}` },
    ] }, ctx());
    const card = r.block as PlanCard;
    expect(card.title).toBe("Back in");
    expect(card.ops!.map((o) => [o.op, "day" in o ? o.day : ""])).toEqual([["add_workout", "2026-11-23"], ["add_workout", "2026-11-25"], ["add_routine", "2026-11-27"]]);
    expect(card.rows.map((row) => row.day)).toEqual(["Mon 23 Nov", "Wed 25 Nov", "Fri 27 Nov"]);
    expect(card.rows[0].proposed).toContainEqual({ name: "Easy", hue: "mint", changed: true });
    expect(await runTool("propose_training_plan", { name: "x", start_date: "2026-11-23", workouts: [{ workout: GYM }] }, ctx())).toMatchObject({ isError: true, text: "Error: Workout 1 needs its day (1 is start_date)." });
    expect(await runTool("propose_training_plan", { name: "x", start_date: "2026-11-23", workouts: Array.from({ length: 29 }, (_, i) => ({ day: i + 1, workout: GYM })) }, ctx())).toMatchObject({ isError: true });
  });
});

describe("zones and the goal race", () => {
  const DASH = { summaryInfo: { lthr: 168, ltsp: 262, rhr: 46, lthrZone: [{ index: 0, hr: 114, pace: 410, ratio: 68 }, { index: 1, hr: 136, pace: 340, ratio: 81 }, { index: 2, hr: 151, pace: 300, ratio: 90 }, { index: 3, hr: 160, pace: 275, ratio: 95 }, { index: 4, hr: 168, pace: 262, ratio: 100 }, { index: 5, hr: 178, pace: 240, ratio: 106 }] } };
  it("reads COROS's own zones from Training Hub", () => {
    const z = zonesFromHub(DASH, { zoneData: JSON.stringify({ maxHr: 189, ftp: 250 }) })!;
    expect(z).toMatchObject({ source: "coros", thresholdHr: 168, maxHr: 189, restingHr: 46, thresholdPaceSecPerKm: 262, ftp: 250 });
    expect(z.hr[0]).toEqual({ zone: 1, fromBpm: 114, toBpm: 135 });
    expect(z.hr[5]).toEqual({ zone: 6, fromBpm: 178, toBpm: null });
    expect(z.pace[0]).toEqual({ zone: 1, fromSecPerKm: 410, toSecPerKm: 340 });
    expect(zoneLines(z)[0]).toBe("Heart rate zones (from COROS Training Hub, by threshold heart rate): Z1 114–135 bpm, Z2 136–150 bpm, Z3 151–159 bpm, Z4 160–167 bpm, Z5 168–177 bpm, Z6 178 and above bpm");
    expect(zoneLines(z)[1]).toMatch(/^Pace zones .*Z1 6:50–5:40 \/km.*Z6 4:00 \/km and faster$/);
  });
  it("gives nothing rather than guess when COROS sends no zones", () => {
    expect(zonesFromHub({}, {})).toBeNull();
    expect(zonesFromHub(undefined, "nope")).toBeNull();
    expect(zonesFromHub({ summaryInfo: { lthrZone: [{ hr: 9999 }, { hr: 2 }, { hr: 1 }] } }, undefined)).toBeNull();
  });
  it("prefers the zones set on the watch when the phone sends them, and lists goal races still ahead", () => {
    const view = { hrZones: { basis: "maxHr" as const, zones: [{ zone: 2, fromBpm: 130, toBpm: 145 }, { zone: 1, fromBpm: null, toBpm: 129 }] }, goalRaces: [{ name: "Old 10K", day: "2026-05-01" }, { name: "Spring Half", day: "2027-04-11", distanceMeters: 21097.5, goalSeconds: 5880 }] };
    expect(zoneLines(zonesFromPhone(view))).toEqual(["Heart rate zones (set on the watch, by max heart rate): Z1 below 129 bpm, Z2 130–145 bpm"]);
    expect(raceLines(view, "2026-11-20")).toEqual(["Spring Half · Sun 11 Apr 2027 · 21.1 km · goal 1:38:00"]);
    const withView = athleteItems([...seedItems(NOW).filter((i) => i.collection !== "view.training"), { collection: "view.training", id: "me", body: view }]);
    const text = profileText(withView, clock, zonesFromHub(DASH, undefined));
    expect(text).toContain("set on the watch");
    expect(text).not.toContain("from COROS Training Hub");
    expect(text).toContain("Races they're training for: Spring Half");
  });
  it("tells Coach to ask only while there is no source", () => {
    expect(profileText(items, clock)).toMatch(/Heart rate zone boundaries: not available.*Ask the athlete/);
    expect(profileText(items, clock)).toMatch(/Goal race: the phone hasn't sent one/);
    const text = contextText(items, clock, entries, null, zonesFromHub(DASH, undefined));
    expect(text).toContain("Heart rate zones (from COROS Training Hub");
    expect(text).not.toContain("Heart rate zone boundaries: not available");
  });
});

describe("the shared Training Hub session", () => {
  const body = { accessToken: "tok", userId: "42", regionId: "2", baseURL: "https://teameuapi.coros.com", email: "a@b.c" };
  it("is taken from the account's items only when whole and on a COROS host", () => {
    expect(sharedSession([{ collection: "hub.session", id: "me", body }])).toEqual({ accessToken: "tok", userId: "42", regionId: "2", baseURL: "https://teameuapi.coros.com" });
    expect(sharedSession([{ collection: "hub.session", id: "me", body: { ...body, baseURL: "https://evil.example" } }])).toBeNull();
    expect(sharedSession([{ collection: "hub.session", id: "other", body }])).toBeNull();
    expect(sharedSession([])).toBeNull();
  });
  it("never reaches what the tools and the model read", () => {
    const withSession = athleteItems([...seedItems(NOW), { collection: "hub.session", id: "me", body }]);
    expect(JSON.stringify(withSession)).not.toContain("tok");
    expect(contextText(withSession, clock, entries, null)).not.toContain("teameuapi");
  });
  it("keeps a browser workout's steps only where they are whole", () => {
    const r = parseRequest({ text: "Hi", browserWorkouts: [{ id: "w-1", name: "Hills", sport: "run", date: "2026-11-23", items: [BROWSER[0].items[0], { type: "step", kind: "work" }, { type: "repeat", id: "b", count: 500, steps: [BROWSER[0].items[0], "x"] }] }] }, 0, () => null)!;
    expect(r.browser[0].items).toEqual([BROWSER[0].items[0], { type: "repeat", id: "b", count: 99, steps: [BROWSER[0].items[0]] }]);
  });
});
