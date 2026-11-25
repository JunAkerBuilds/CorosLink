// The calendar against a fake COROS in memory (ported from CorosKit's HubMoveTests.swift and the schedule
// tests in TrainingHubWorkoutTests.swift). No request leaves the test.
import { describe, expect, it } from "vitest";
import type { HubWorkout } from "@/data/hub";
import { library, libraryProgram, moveDone, moveScheduled, moveStep, newMove, parseSchedule, resetForCreate, schedule, scheduled, scheduledOne, toPlanned, toSaved, update, remove, dayCode, dayOfCode } from "./calendar";
import { TrainingHub, type HubSession } from "./client";
import { HubExpired, HubMoveFailed } from "./errors";
import type { Json, JsonObject } from "./json";
import { buildProgram } from "./workout";

const session: HubSession = { accessToken: "t", userId: "u", regionId: "0", baseURL: "https://teamapi.coros.com" };
const monday = "2026-11-23", friday = "2026-11-27";

/** A COROS calendar in memory: schedule/query, schedule/update and program/calculate, as Training Hub answers them. */
class FakeCalendar {
  entries: { id: number; day: string; program: JsonObject }[] = [];
  maxId = 0;
  failRemovals = 0;
  loseAddAnswers = 0;
  expire = false;
  posts: { path: string; body: JsonObject }[] = [];

  add(id: number, name: string, day: string, program: JsonObject = { exercises: [], sportType: 1 }) {
    this.entries.push({ id, day, program: { ...program, idInPlan: String(id), name } });
    this.maxId = Math.max(this.maxId, id);
  }
  names(day: string) { return this.entries.filter((entry) => entry.day === day).map((entry) => String(entry.program.name)).sort(); }

  hub(): TrainingHub {
    return new TrainingHub(async (input, init) => {
      const url = new URL(String(input));
      if (url.host !== "teamapi.coros.com") throw new Error("unexpected host " + url.host);
      let status = 200;
      let data: Json = null;
      const body = init?.body ? JSON.parse(String(init.body)) as JsonObject : {};
      if (init?.method === "POST") this.posts.push({ path: url.pathname, body });
      if (this.expire) return Response.json({ result: "1019", message: "Login expired" });
      if (url.pathname === "/training/schedule/query") {
        const first = url.searchParams.get("startDate")!, last = url.searchParams.get("endDate")!;
        const found = this.entries.filter((entry) => entry.day >= first && entry.day <= last);
        data = {
          maxIdInPlan: this.maxId,
          entities: found.map((entry) => ({ idInPlan: String(entry.id), happenDay: entry.day, planId: "p", planProgramId: String(entry.id) })),
          programs: found.map((entry) => entry.program),
        };
      } else if (url.pathname === "/training/schedule/update") {
        const version = (body.versionObjects as JsonObject[])[0];
        if (version.status === 3) {
          if (this.failRemovals > 0) { this.failRemovals -= 1; status = 500; }
          else this.entries = this.entries.filter((entry) => String(entry.id) !== String(version.id));
        } else if (version.status === 2) {
          const entry = this.entries.find((candidate) => String(candidate.id) === String(version.id))!;
          entry.program = (body.programs as JsonObject[])[0];
        } else {
          const entity = (body.entities as JsonObject[])[0], program = (body.programs as JsonObject[])[0];
          const id = Number(entity.idInPlan);
          this.entries.push({ id, day: String(entity.happenDay), program });
          this.maxId = Math.max(this.maxId, id);
          if (this.loseAddAnswers > 0) { this.loseAddAnswers -= 1; status = 500; }
        }
      } else if (url.pathname === "/training/program/calculate") {
        data = { planDistance: 480000, planDuration: 1440, planTrainingLoad: 61, exerciseBarChart: [{ height: 1 }] };
      } else if (url.pathname === "/training/program/query") {
        data = [{ id: "501", name: "Tempo 5 km", sportType: 1, distance: 500000, duration: 1500 }, { name: "no id" }];
      } else if (url.pathname === "/training/program/detail") {
        data = url.searchParams.get("id") === "501" ? { ...buildProgram(tempo), id: "501" } : { id: "502", name: "Bare" };
      }
      return new Response(JSON.stringify({ result: "0000", data }), { status });
    });
  }
}

const tempo: HubWorkout = { name: "Tempo 5 km", sport: "run", description: "", blocks: [
  { repeats: null, steps: [{ kind: "training", target: "distance", meters: 5000, intensity: { kind: "pace", low: 255, high: 265 } }] }] };

function calendar(): FakeCalendar {
  const fake = new FakeCalendar();
  fake.add(7, "Tempo", "20261123");
  fake.add(8, "Long run", "20261127");
  return fake;
}

describe("reading the schedule", () => {
  it("parses entries and skips removed ones", () => {
    const entries = parseSchedule({ maxIdInPlan: 7, entities: [
      { happenDay: "20261118", idInPlan: "7", planId: "300", planProgramId: "7", sortNoInSchedule: 1 },
      { happenDay: "20261118", idInPlan: "6", planId: "300", planProgramId: "6", status: 3 }],
    programs: [{ idInPlan: "6", name: "Gone", sportType: 1 }, { idInPlan: "7", name: "Tempo", sportType: 1 }] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "Tempo", planId: "300", day: "2026-11-18", sportCode: 1 });
    expect(dayCode("2026-01-05")).toBe("20260105");
    expect(dayOfCode("2026115")).toBeNull();
  });

  it("orders by day, then by COROS's order within the day, and takes numeric IDs", () => {
    const entries = parseSchedule({ entities: [
      { happenDay: 20261119, idInPlan: 3, sortNoInSchedule: 1 },
      { happenDay: "20261118", idInPlan: 2, sortNoInSchedule: 2 },
      { happenDay: "20261118", idInPlan: 1, sortNoInSchedule: 1 }],
    programs: [{ idInPlan: 1, name: "A" }, { idInPlan: 2, name: "B" }, { idInPlan: 3, name: "C" }] });
    expect(entries.map((entry) => entry.name)).toEqual(["A", "B", "C"]);
    expect(entries.map((entry) => entry.idInPlan)).toEqual(["1", "2", "3"]);
  });

  it("gives the browser a plain planned workout, without COROS's rows", () => {
    const program = { ...buildProgram(tempo), idInPlan: "7" };
    const [entry] = parseSchedule({ entities: [{ happenDay: "20261118", idInPlan: "7", planId: "300", planProgramId: "9" }], programs: [program] });
    const planned = toPlanned(entry);
    expect(planned).toMatchObject({ day: "2026-11-18", idInPlan: "7", planId: "300", planProgramId: "9", name: "Tempo 5 km", sport: "run", sportCode: 1 });
    expect(planned.totals).toEqual({ seconds: 0, meters: 5000, sets: 0 });
    expect(planned.workout?.blocks[0].steps[0]).toMatchObject({ id: "1", target: "distance", meters: 5000, intensity: { kind: "pace", low: 255, high: 265 } });
    expect(JSON.stringify(planned)).not.toContain("intensityType");
    // A sport this app can't write still lists, to be moved or removed.
    const [other] = parseSchedule({ entities: [{ happenDay: "20261118", idInPlan: "8" }], programs: [{ idInPlan: "8", name: "Yoga", sportType: 77 }] });
    expect(toPlanned(other)).toMatchObject({ name: "Yoga", sport: null, sportCode: 77, workout: null, totals: null, load: null });
  });

  it("takes COROS's own distance (centimetres), time and load for a scheduled program over the steps' sums", () => {
    // 2 km warm-up by distance, 20 min by time: the steps alone know 2 km and 20:00, COROS knows the whole thing.
    const program = { ...buildProgram(tempo), idInPlan: "7", distance: 650_000, duration: 2_460, trainingLoad: 71.6 };
    const [entry] = parseSchedule({ entities: [{ happenDay: "20261118", idInPlan: "7" }], programs: [program] });
    expect(toPlanned(entry)).toMatchObject({ totals: { seconds: 2460, meters: 6500, sets: 0 }, load: 72 });
    // A program this app can't read still brings COROS's numbers, for the week totals.
    const [yoga] = parseSchedule({ entities: [{ happenDay: "20261118", idInPlan: "8" }], programs: [{ idInPlan: "8", name: "Yoga", sportType: 77, duration: 3600, trainingLoad: 30, sets: 1 }] });
    expect(toPlanned(yoga)).toMatchObject({ workout: null, totals: { seconds: 3600, meters: 0, sets: 0 }, load: 30 });
    // Zero, negative and junk numbers are no numbers.
    const [blank] = parseSchedule({ entities: [{ happenDay: "20261118", idInPlan: "9" }], programs: [{ idInPlan: "9", name: "?", sportType: 77, distance: -5, duration: "x", trainingLoad: 0 }] });
    expect(toPlanned(blank)).toMatchObject({ totals: null, load: null });
  });

  it("asks COROS for the range as YYYYMMDD", async () => {
    const fake = calendar();
    const found = await scheduled(fake.hub(), session, monday, friday);
    expect(found.workouts.map((entry) => entry.name)).toEqual(["Tempo", "Long run"]);
    expect(found.maxIdInPlan).toBe(8);
    await expect(scheduledOne(fake.hub(), session, "2026-11-24", "7", "Tempo")).rejects.toThrow("COROS has no workout on that day any more");
  });
});

describe("changing the schedule", () => {
  it("renumbers a program for a new entry", () => {
    const reset = resetForCreate(buildProgram({ ...tempo, blocks: [
      { repeats: null, steps: [{ kind: "warmup", target: "time", seconds: 900, intensity: { kind: "none" } }] },
      { repeats: 6, steps: [{ kind: "training", target: "distance", meters: 800, intensity: { kind: "none" } }, { kind: "rest", target: "time", seconds: 90, intensity: { kind: "none" } }] },
      { repeats: null, steps: [{ kind: "cooldown", target: "open", intensity: { kind: "none" } }] }] }));
    const exercises = reset.exercises as JsonObject[];
    expect(exercises.map((row) => row.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(exercises[2].groupId).toBe("2");
    expect(reset.id).toBe("0");
  });

  it("adds a new workout with COROS's totals and the next idInPlan", async () => {
    const fake = calendar();
    const id = await schedule(fake.hub(), session, tempo, friday, {});
    expect(id).toBe("9");
    expect(fake.names("20261127")).toEqual(["Long run", "Tempo 5 km"]);
    const sent = fake.posts[fake.posts.length - 1];
    expect(sent.path).toBe("/training/schedule/update");
    expect(sent.body.versionObjects).toEqual([{ id: 9, status: 1 }]);
    expect(sent.body.pbVersion).toBe(2);
    expect((sent.body.entities as JsonObject[])[0]).toMatchObject({ happenDay: "20261127", idInPlan: 9, sortNoInSchedule: 2, exerciseBarChart: [{ height: 1 }] });
    expect((sent.body.programs as JsonObject[])[0]).toMatchObject({ idInPlan: 9, id: "0", distance: 480000, duration: 1440, trainingLoad: 61 });
  });

  it("edits a planned workout in place, on the program COROS has now", async () => {
    const fake = new FakeCalendar();
    fake.add(7, "Tempo 5 km", "20261123", { ...buildProgram(tempo), id: "880", planId: "p" });
    const hub = fake.hub();
    const planned = toPlanned((await scheduled(hub, session, monday, monday)).workouts[0]);
    const edited = JSON.parse(JSON.stringify(planned.workout)) as HubWorkout;
    edited.name = "Tempo 6 km";
    edited.blocks[0].steps[0].meters = 6000;
    await update(hub, session, planned, edited, {});
    const sent = fake.posts[fake.posts.length - 1].body;
    expect(sent.versionObjects).toEqual([{ id: "7", status: 2, planProgramId: "7", planId: "p" }]);
    expect((sent.entities as JsonObject[])[0]).toMatchObject({ idInPlan: "7", happenDay: "20261123" });
    const program = (sent.programs as JsonObject[])[0];
    expect(program).toMatchObject({ id: "880", name: "Tempo 6 km", idInPlan: "7" });
    expect((program.exercises as JsonObject[])[0]).toMatchObject({ id: 1, targetValue: 600_000 });
    expect(fake.names("20261123")).toEqual(["Tempo 6 km"]);
  });

  it("removes a planned workout", async () => {
    const fake = calendar();
    const hub = fake.hub();
    await remove(hub, session, await scheduledOne(hub, session, monday, "7", "Tempo"));
    expect(fake.names("20261123")).toEqual([]);
    expect(fake.posts[0].body.versionObjects).toEqual([{ id: "7", planProgramId: "7", planId: "p", status: 3 }]);
  });
});

describe("moving a planned workout", () => {
  it("copies, then removes", async () => {
    const fake = calendar();
    const move = await moveScheduled(fake.hub(), session, newMove(monday, friday, "Tempo", null));
    expect(fake.names("20261123")).toEqual([]);
    expect(fake.names("20261127")).toEqual(["Long run", "Tempo"]);
    expect(move.newIdInPlan).toBe("9");
    expect(moveDone(move)).toBe(true);
  });

  it("only removes on a retry after a failed removal", async () => {
    const fake = calendar();
    fake.failRemovals = 1;
    const failure = await moveScheduled(fake.hub(), session, newMove(monday, friday, "Tempo", "7")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HubMoveFailed);
    const progress = (failure as HubMoveFailed).move;
    expect(progress).toMatchObject({ newIdInPlan: "9", removed: false });
    expect(fake.names("20261127")).toEqual(["Long run", "Tempo"]);
    await moveScheduled(fake.hub(), session, progress);
    expect(fake.names("20261123")).toEqual([]);
    expect(fake.names("20261127")).toEqual(["Long run", "Tempo"]);
  });

  it("recognises a copy whose answer was lost", async () => {
    const fake = calendar();
    fake.loseAddAnswers = 1;
    const failure = await moveScheduled(fake.hub(), session, newMove(monday, friday, "Tempo", null)).catch((error: unknown) => error);
    const progress = (failure as HubMoveFailed).move;
    expect(progress.newIdInPlan).toBeNull();
    expect(progress.targetBefore).toEqual(["8"]);
    const move = await moveScheduled(fake.hub(), session, progress);
    expect(fake.names("20261127")).toEqual(["Long run", "Tempo"]);
    expect(fake.names("20261123")).toEqual([]);
    expect(move.newIdInPlan).toBe("9");
  });

  it("writes to COROS at most once a step", async () => {
    const fake = calendar();
    const hub = fake.hub();
    let move = newMove(monday, friday, "Tempo", "7");
    const writes: number[] = [];
    while (!moveDone(move)) {
      const before = fake.posts.length;
      move = await moveStep(hub, session, move);
      writes.push(fake.posts.length - before);
    }
    expect(writes).toEqual([0, 1, 1]);
  });

  it("does nothing for the same day, and can't move a workout COROS gave no steps for", async () => {
    const fake = calendar();
    expect(await moveScheduled(fake.hub(), session, newMove(monday, monday, "Tempo", "7"))).toMatchObject({ newIdInPlan: "7", removed: true });
    expect(fake.posts).toHaveLength(0);
    fake.add(10, "Bare", "20261123", { sportType: 1 });
    delete fake.entries[2].program.exercises;
    await expect(moveScheduled(fake.hub(), session, newMove(monday, friday, "Bare", "10"))).rejects.toThrow("COROS gave no steps for Bare");
  });

  it("carries an ended session out of a move", async () => {
    const fake = calendar();
    fake.expire = true;
    const failure = await moveScheduled(fake.hub(), session, newMove(monday, friday, "Tempo", "7")).catch((error: unknown) => error);
    expect((failure as HubMoveFailed).cause).toBeInstanceOf(HubExpired);
  });
});

describe("the saved-workout library", () => {
  it("lists summaries, with COROS's totals when the steps aren't listed", async () => {
    const saved = await library(new FakeCalendar().hub(), session);
    expect(saved).toEqual([{ id: "501", name: "Tempo 5 km", sportCode: 1, sport: "run", hasSteps: false, workout: null, totals: { seconds: 1500, meters: 5000, sets: 0 } }]);
  });

  it("reads one with its steps", async () => {
    const hub = new FakeCalendar().hub();
    const saved = await libraryProgram(hub, session, "501");
    expect(saved).toMatchObject({ id: "501", hasSteps: true, totals: { seconds: 0, meters: 5000, sets: 0 } });
    expect(saved.workout?.blocks[0].steps[0].meters).toBe(5000);
    await expect(libraryProgram(hub, session, "502")).rejects.toThrow("COROS gave no steps for that saved workout.");
    expect(toSaved({ name: "x" })).toBeNull();
  });
});
