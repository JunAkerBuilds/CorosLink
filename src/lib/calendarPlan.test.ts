import { afterEach, describe, expect, it } from "vitest";
import { useUnitsNow } from "./units";
import {
  applyDraft, canCopy, canDropOn, canMove, completion, kmText, liveOps, metresText, netChanges, pairEntries, passes, planState, tone, weekNumbers,
  type DraftOp,
} from "./calendarPlan";

const plan = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, date, status: "planned" as const, sport: "run", name: "Easy run", source: "browser", browser: { workoutId: id }, ...extra });
const done = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, date, status: "done" as const, sport: "run", name: "Easy run", source: "synced", ...extra });

describe("draft", () => {
  const entries = [plan("a", "2026-11-22"), plan("b", "2026-11-24")];

  it("moves, copies and removes", () => {
    const ops: DraftOp[] = [
      { op: "move", id: "a", to: "2026-11-23" },
      { op: "copy", id: "b", to: "2026-11-26", key: "c1" },
      { op: "remove", id: "b" },
    ];
    const out = applyDraft(entries, ops);
    expect(out.map((e) => [e.id, e.date, e.pending ?? null])).toEqual([["a", "2026-11-23", "moved"], ["c1", "2026-11-26", "added"]]);
    expect(out[1].copyOf).toBe("b");
  });

  it("a move back to the first day is no change", () => {
    const ops: DraftOp[] = [{ op: "move", id: "a", to: "2026-11-23" }, { op: "move", id: "a", to: "2026-11-22" }];
    expect(applyDraft(entries, ops)[0].pending).toBeUndefined();
    expect(netChanges(entries, ops)).toEqual([]);
  });

  it("sums up what saving does, copies last and of the original", () => {
    const ops: DraftOp[] = [
      { op: "copy", id: "a", to: "2026-11-25", key: "c1" },
      { op: "copy", id: "c1", to: "2026-11-27", key: "c2" },
      { op: "move", id: "c1", to: "2026-11-28" },
      { op: "remove", id: "b" },
      { op: "copy", id: "a", to: "2026-11-29", key: "c3" },
      { op: "remove", id: "c3" },
    ];
    const net = netChanges(entries, ops);
    expect(net.map((n) => [n.kind, n.entry.id, "to" in n ? n.to : null])).toEqual([
      ["remove", "b", null], ["copy", "a", "2026-11-28"], ["copy", "a", "2026-11-27"],
    ]);
  });

  it("forgets ops for entries that are gone", () => {
    const ops: DraftOp[] = [{ op: "copy", id: "a", to: "2026-11-25", key: "c1" }, { op: "move", id: "c1", to: "2026-11-26" }, { op: "remove", id: "zzz" }];
    expect(liveOps(entries, ops)).toHaveLength(2);
    expect(liveOps([entries[1]], ops)).toHaveLength(0);
  });
});

describe("what may go where", () => {
  const today = "2026-11-21";
  it("moves only own plans from today on, copies past ones too", () => {
    expect(canMove(plan("a", "2026-11-21"), today)).toBe(true);
    expect(canMove(plan("a", "2026-11-20"), today)).toBe(false);
    expect(canCopy(plan("a", "2026-11-20"))).toBe(true);
    expect(canMove(done("d", "2026-11-22"), today)).toBe(false);
    expect(canMove(plan("s", "2026-11-22", { source: "sample", browser: undefined }), today)).toBe(false);
  });
  it("can't copy a COROS workout without steps it can write", () => {
    expect(canCopy(plan("c", "2026-11-22", { source: "coros", coros: { workout: null } }))).toBe(false);
    expect(canCopy(plan("c", "2026-11-22", { source: "coros", coros: { workout: {} } }))).toBe(true);
  });
  it("drops on today or later", () => {
    expect(canDropOn("2026-11-21", today)).toBe(true);
    expect(canDropOn("2026-11-20", today)).toBe(false);
  });
});

describe("done against planned", () => {
  it("pairs by name, then by sport and size, one each", () => {
    const entries = [
      plan("p1", "2026-11-19", { name: "Tempo run", metres: 8000 }),
      plan("p2", "2026-11-19", { name: "Strides", metres: 2000 }),
      done("d1", "2026-11-19", { name: "Morning run", metres: 2050 }),
      done("d2", "2026-11-19", { name: "Tempo Run ", metres: 8020 }),
      plan("p3", "2026-11-20", { metres: 6000 }),
    ];
    const p = pairEntries(entries);
    expect(p.doneBy.get("p1")).toBe("d2");
    expect(p.doneBy.get("p2")).toBe("d1");
    expect(p.percent.get("d2")).toBe(100);
    expect(p.percent.get("d1")).toBe(102);
    expect(planState(entries[4], p, "2026-11-21")).toBe("missed");
    expect(planState(entries[4], p, "2026-11-20")).toBe("today");
  });
  it("compares distance, then time, then load", () => {
    expect(completion({ metres: 8000 }, { metres: 5020 })).toBe(63);
    expect(completion({ seconds: 2700 }, { seconds: 2880 })).toBe(107);
    expect(completion({ load: 40 }, { load: 38 })).toBe(95);
    expect(completion({}, { metres: 100 })).toBeNull();
    expect([tone(96), tone(64), tone(20)]).toEqual(["complete", "partial", "missed"]);
  });
});

describe("filters and weeks", () => {
  it("filters by kind and sport", () => {
    expect(passes(done("d", "x"), { show: "planned", hidden: [] })).toBe(false);
    expect(passes(plan("p", "x"), { show: "all", hidden: ["run"] })).toBe(false);
    expect(passes(plan("p", "x"), { show: "planned", hidden: ["ride"] })).toBe(true);
  });
  it("counts a week: done against planned, overall and per sport", () => {
    const days = ["2026-11-16", "2026-11-17"];
    const entries = [
      plan("p", "2026-11-16", { load: 50, seconds: 2000, metres: 6000 }),
      done("d", "2026-11-16", { load: 48, seconds: 1800, metres: 6100, elevation: 40 }),
      plan("q", "2026-11-17", { sport: "strength", load: 40, seconds: 2700 }),
      plan("r", "2026-11-30", { load: 9 }),
    ];
    const w = weekNumbers(entries, days, pairEntries(entries));
    expect(w).toMatchObject({ planned: 2, done: 1, load: 48, plannedLoad: 90, seconds: 1800, plannedSeconds: 4700, metres: 6100, plannedMetres: 6000, elevation: 40 });
    expect(w.sports).toEqual([
      { sport: "run", load: 48, plannedLoad: 50, seconds: 1800, plannedSeconds: 2000, metres: 6100, plannedMetres: 6000 },
      { sport: "strength", load: 0, plannedLoad: 40, seconds: 0, plannedSeconds: 2700, metres: 0, plannedMetres: 0 },
    ]);
  });
});

describe("printing in imperial", () => {
  afterEach(() => useUnitsNow("metric"));
  it("prints miles to one decimal and swims in whole yards", () => {
    useUnitsNow("imperial");
    expect(kmText(8046.72)).toBe("5.0");
    expect(kmText(-5)).toBe("0.0");
    expect(metresText(1500)).toBe("1,640");
  });
});
