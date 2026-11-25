// The calendar's numbers, pinned: days across time zones and clock changes, week totals, planned against done,
// links set by hand, and the edges of each sport.
import { afterAll, describe, expect, it } from "vitest";
import { calendarSport, syncedEntries, syncedWeeks } from "@/data/sync/calendar";
import { dateToRef, type NativeActivity, type NativeDayVitals } from "@/data/sync/native";
import { hubEntries, type CalendarEntry } from "@/data/training";
import { km } from "@/lib/format";
import { addDays, mondayOf, monthWeeks, occurrences, weekDays } from "@/lib/calendar";
import {
  completion, doneOfPlanned, dropOnDay, kmText, linkOptions, linkPair, metresText, pairEntries, planState, weekNumbers, withLink, withoutLink, type Link,
} from "@/lib/calendarPlan";

const ZONES = ["America/New_York", "Europe/London", "Australia/Sydney", "Asia/Kolkata", "Pacific/Auckland", "UTC"] as const;
const startZone = process.env.TZ;
afterAll(() => { process.env.TZ = startZone; });

const entry = (e: Partial<CalendarEntry> & Pick<CalendarEntry, "id" | "date" | "status">): CalendarEntry =>
  ({ sport: "run", name: e.id, detail: "", source: "synced", ...e });

/* ───────────── Days ───────────── */

describe.each(ZONES)("days in %s", (zone) => {
  process.env.TZ = zone;

  it("steps over the clock changes a day at a time", () => {
    process.env.TZ = zone;
    // US, Europe and New Zealand / Australia changes in 2026, both ways.
    for (const [from, to] of [["2026-03-07", "2026-03-09"], ["2026-03-28", "2026-03-30"], ["2026-10-24", "2026-10-26"], ["2026-10-31", "2026-11-02"], ["2026-04-04", "2026-04-06"], ["2026-09-26", "2026-09-28"]]) {
      expect(addDays(from, 2)).toBe(to);
      expect(addDays(to, -2)).toBe(from);
    }
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("finds the Monday of a week that holds a clock change", () => {
    process.env.TZ = zone;
    expect(mondayOf("2026-03-08")).toBe("2026-03-02");
    expect(mondayOf("2026-03-29")).toBe("2026-03-23");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(weekDays("2026-10-26")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("lays out every month of 2026 the same in any zone: whole weeks from Monday, each day once", () => {
    process.env.TZ = zone;
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, "0")}`;
      const days = monthWeeks(month).flat();
      for (let i = 1; i < days.length; i++) expect(addDays(days[i - 1], 1)).toBe(days[i]);
      expect(days.filter((d) => d.startsWith(month))).toHaveLength(new Date(Date.UTC(2026, m, 0)).getUTCDate());
    }
  });

  it("repeats a workout on the same weekday across a clock change", () => {
    process.env.TZ = zone;
    expect(occurrences("2026-10-20", 3)).toEqual(["2026-10-20", "2026-10-27", "2026-11-03"]);
  });

  it("puts an activity on the local day it started, up to the last minute before midnight", () => {
    process.env.TZ = zone;
    const at = (y: number, mo: number, d: number, h: number, mi: number) => dateToRef(new Date(y, mo - 1, d, h, mi));
    const list: NativeActivity[] = [
      { id: "late", name: "Late", sport: "run", start: at(2026, 3, 7, 23, 59), durationSeconds: 1800, distanceMeters: 5000 },
      { id: "early", name: "Early", sport: "run", start: at(2026, 3, 8, 0, 1), durationSeconds: 1800, distanceMeters: 5000 },
      // The night the clocks go back in Europe and the US.
      { id: "back", name: "Back", sport: "run", start: at(2026, 10, 25, 23, 30), durationSeconds: 600 },
      { id: "sunday", name: "Sunday", sport: "run", start: at(2026, 11, 1, 23, 50), durationSeconds: 3600, distanceMeters: 10000, trainingLoad: 80 },
      { id: "monday", name: "Monday", sport: "run", start: at(2026, 11, 2, 0, 10), durationSeconds: 3600, distanceMeters: 10000, trainingLoad: 70 },
    ];
    const now = new Date(2026, 11, 1);
    const days = Object.fromEntries(syncedEntries(list, [], [], now).map((e) => [e.activityId, e.date]));
    expect(days).toEqual({ late: "2026-03-07", early: "2026-03-08", back: "2026-10-25", sunday: "2026-11-01", monday: "2026-11-02" });
    // Sunday's run closes the week of 26 October; Monday's opens the next one.
    const weeks = syncedWeeks(list, [], now);
    expect(weeks.find((w) => w.weekStart === "2026-10-26")).toMatchObject({ timeSeconds: 3600, runMetres: 10000, load: 80 });
    expect(weeks.find((w) => w.weekStart === "2026-11-02")).toMatchObject({ timeSeconds: 3600, runMetres: 10000, load: 70 });
  });
});

/* ───────────── Sports ───────────── */

describe("sports", () => {
  it("draws COROS's sports this app doesn't plan as other, not as runs, and keeps COROS's planned load", () => {
    const w = (sport: string | null, idInPlan: string) => ({
      day: "2026-11-24", idInPlan, planId: "", planProgramId: "", name: idInPlan, sportCode: null, sport: sport as never, workout: null,
      totals: { seconds: 3600, meters: 0, sets: 0 }, load: 42,
    });
    const entries = hubEntries([{ day: "2026-11-24", workouts: [w("run", "a"), w("trailRun", "b"), w("bike", "c"), w("hyrox", "d"), w("xcSki", "e"), w("bouldering", "f"), w(null, "g")] }]);
    expect(entries.map((e) => e.sport)).toEqual(["run", "run", "ride", "strength", "other", "other", "other"]);
    expect(entries[0]).toMatchObject({ seconds: 3600, load: 42, detail: "1:00:00" });
  });

  it("counts a hike in the week's distance and time, but under Other, not Run", () => {
    const hike = entry({ id: "h", date: "2026-11-15", status: "done", sport: calendarSport("hike"), metres: 11300, seconds: 9492, load: 90, elevation: 700 });
    const run = entry({ id: "r", date: "2026-11-14", status: "done", sport: calendarSport("trailRun"), metres: 9400, seconds: 3488, load: 120 });
    const n = weekNumbers([hike, run], weekDays("2026-11-09"), pairEntries([hike, run]));
    expect(n).toMatchObject({ load: 210, seconds: 12980, metres: 20700, elevation: 700 });
    expect(n.sports.map((s) => [s.sport, s.metres, s.load])).toEqual([["run", 9400, 120], ["other", 11300, 90]]);
  });

  it("prints swims in whole metres and everything else in km to one decimal", () => {
    expect(metresText(1499.6)).toBe("1,500");
    expect(metresText(-3)).toBe("0");
    expect(kmText(24_649)).toBe("24.6");
    expect(kmText(24_650)).toBe("24.7");
    expect(doneOfPlanned(1500, 2000, metresText, " m")).toBe("1,500 / 2,000 m");
    expect(doneOfPlanned(0, 8000, kmText, " km")).toBe("0.0 / 8.0 km");
    expect(doneOfPlanned(6100, 0, kmText, " km")).toBe("6.1 km");
    expect(doneOfPlanned(0, 0, kmText, " km")).toBe("--");
    // The chips' own distances round half up on whole metres too.
    expect(km(5005)).toBe("5.01 km");
    expect(km(24_650, 1)).toBe("24.7 km");
    expect(km(6100)).toBe("6.10 km");
    expect(km(0)).toBe("0.00 km");
  });
});

/* ───────────── Week totals ───────────── */

describe("week totals", () => {
  const days = weekDays("2026-11-16");
  const list = [
    entry({ id: "p1", date: "2026-11-16", status: "planned", name: "Easy run", metres: 6000, seconds: 2000, load: 50 }),
    entry({ id: "d1", date: "2026-11-16", status: "done", name: "Easy run", metres: 6100, seconds: 2028, load: 54 }),
    entry({ id: "p2", date: "2026-11-18", status: "planned", name: "Tempo", metres: 8000, load: 90 }),
    entry({ id: "p3", date: "2026-11-21", status: "planned", sport: "swim", name: "Pool", metres: 2000, seconds: 2400, load: 40 }),
    entry({ id: "d3", date: "2026-11-21", status: "done", sport: "swim", name: "Pool swim", metres: 1500, seconds: 1900.5, load: 31 }),
    entry({ id: "dx", date: "2026-11-23", status: "done", name: "Next week", metres: 5000, seconds: 1500, load: 40 }),
  ];
  const pairing = pairEntries(list);

  it("adds done against everything planned, done or not, and leaves other weeks out", () => {
    const n = weekNumbers(list, days, pairing);
    expect(n).toMatchObject({ load: 85, plannedLoad: 180, seconds: 3928.5, plannedSeconds: 4400, metres: 7600, plannedMetres: 16000, planned: 3, done: 2 });
    expect(n.sports.map((s) => s.sport)).toEqual(["run", "swim"]);
    const total = n.sports.reduce((t, s) => ({ load: t.load + s.load, plannedLoad: t.plannedLoad + s.plannedLoad }), { load: 0, plannedLoad: 0 });
    expect(total).toEqual({ load: n.load, plannedLoad: n.plannedLoad });
  });

  it("takes the account's week load when a day's reading adds load its activities didn't carry", () => {
    expect(weekNumbers(list, days, pairing, 140).load).toBe(140);
    // Never less than what the entries add up to, and nothing when the account has no number.
    expect(weekNumbers(list, days, pairing, 10).load).toBe(85);
    expect(weekNumbers(list, days, pairing, null).load).toBe(85);
  });

  it("matches the account's week load to the Dashboard's day readings", () => {
    const day = (d: number) => ({ year: 2026, month: 11, day: d });
    const acts: NativeActivity[] = [
      { id: "a", name: "Walk", sport: "walk", start: dateToRef(new Date(2026, 10, 17, 9)), durationSeconds: 3000 },
      { id: "b", name: "Run", sport: "run", start: dateToRef(new Date(2026, 10, 18, 9)), durationSeconds: 3000, distanceMeters: 10000, trainingLoad: 100 },
    ];
    const vitals: NativeDayVitals[] = [{ day: day(17), trainingLoad: 35 }, { day: day(18), trainingLoad: 999 }];
    // The walk's day takes its reading (35); the run's day keeps the run's own load, not the reading.
    expect(syncedWeeks(acts, vitals, new Date(2026, 10, 22))).toEqual([{ weekStart: "2026-11-16", timeSeconds: 6000, runMetres: 10000, load: 135, plannedLoad: null }]);
  });
});

/* ───────────── Planned against done ───────────── */

describe("planned against done", () => {
  it("never pairs across days on its own, and never one activity with two plans", () => {
    const list = [
      entry({ id: "p1", date: "2026-11-17", status: "planned", name: "Easy" }),
      entry({ id: "p2", date: "2026-11-17", status: "planned", name: "Easy" }),
      entry({ id: "d1", date: "2026-11-17", status: "done", name: "Easy" }),
      entry({ id: "d2", date: "2026-11-18", status: "done", name: "Easy" }),
    ];
    const p = pairEntries(list);
    expect([...p.doneBy]).toEqual([["p1", "d1"]]);
    expect(planState(list[1], p, "2026-11-19")).toBe("missed");
    expect(planState(list[1], p, "2026-11-17")).toBe("today");
    expect(planState(list[1], p, "2026-11-16")).toBe("upcoming");
  });

  it("doesn't pair a ride with a planned run unless the names match", () => {
    const list = [
      entry({ id: "p", date: "2026-11-17", status: "planned", name: "Intervals", sport: "run" }),
      entry({ id: "d", date: "2026-11-17", status: "done", name: "Commute", sport: "ride" }),
    ];
    expect(pairEntries(list).doneBy.size).toBe(0);
  });

  it("compares distance, then time, then load, and nothing that is zero", () => {
    expect(completion({ metres: 8000, seconds: 2400 }, { metres: 6000, seconds: 2400 })).toBe(75);
    expect(completion({ metres: 8000 }, { seconds: 2400 })).toBeNull();
    expect(completion({ seconds: 3600 }, { seconds: 3960, metres: 9000 })).toBe(110);
    expect(completion({ load: 0, seconds: 0 }, { load: 50 })).toBeNull();
    expect(completion({ load: 60 }, { load: 59.7 })).toBe(100);
  });

  it("follows links set by hand: across days, and kept apart when unlinked", () => {
    const list = [
      entry({ id: "tue", date: "2026-11-17", status: "planned", name: "Tempo", metres: 8000 }),
      entry({ id: "wed", date: "2026-11-18", status: "done", name: "Morning run", metres: 8020 }),
      entry({ id: "wed-plan", date: "2026-11-18", status: "planned", name: "Easy", metres: 6000 }),
    ];
    // On its own, Wednesday's run does Wednesday's plan.
    expect([...pairEntries(list).doneBy]).toEqual([["wed-plan", "wed"]]);
    // Linked by hand, it did Tuesday's tempo, and Wednesday's plan is left for something else.
    let links: Link[] = withLink([], "tue", "wed");
    const linked = pairEntries(list, links);
    expect([...linked.doneBy]).toEqual([["tue", "wed"]]);
    expect(linked.percent.get("wed")).toBe(100);
    // Unlinked: neither the hand link nor the automatic one comes back.
    links = withoutLink(links, "tue", "wed");
    links = withoutLink(links, "wed-plan", "wed");
    expect(pairEntries(list, links).doneBy.size).toBe(0);
    // A link to an entry that is gone does nothing.
    expect([...pairEntries(list, withLink([], "gone", "wed")).doneBy]).toEqual([["wed-plan", "wed"]]);
    // Linking again replaces what either side had.
    expect(withLink(withLink([], "tue", "wed"), "wed-plan", "wed")).toEqual([{ plan: "wed-plan", activity: "wed", linked: true }]);
  });

  it("offers links within three days, nearest first, then the same sport, to plans nobody did yet", () => {
    const done = entry({ id: "d", date: "2026-11-18", status: "done", sport: "run" });
    const list = [
      done,
      entry({ id: "far", date: "2026-11-22", status: "planned" }),
      entry({ id: "near-swim", date: "2026-11-17", status: "planned", sport: "swim" }),
      entry({ id: "near-run", date: "2026-11-19", status: "planned", sport: "run" }),
      entry({ id: "edge", date: "2026-11-15", status: "planned", sport: "run" }),
      entry({ id: "taken", date: "2026-11-16", status: "planned", name: "Taken" }),
      entry({ id: "other-done", date: "2026-11-16", status: "done", name: "Taken" }),
    ];
    const p = pairEntries(list);
    expect(linkOptions(done, list, p).map((e) => e.id)).toEqual(["near-run", "near-swim", "edge"]);
  });
});

/* ───────────── Drag and drop ───────────── */

describe("dropping", () => {
  const today = "2026-11-22";
  const plan = (id: string, date: string, extra: object = {}) =>
    ({ id, date, status: "planned" as const, source: "browser", browser: { workoutId: id }, ...extra });
  let n = 0;
  const key = () => `k${n++}`;

  it("moves a dragged week as a week, keeping the days between them", () => {
    const list = [plan("a", "2026-11-23"), plan("b", "2026-11-25"), plan("c", "2026-11-29")];
    const r = dropOnDay(list, "2026-11-25", "2026-12-02", today, false, key);
    expect(r).toEqual({ copied: false, left: 0, ops: [
      { op: "move", id: "a", to: "2026-11-30" }, { op: "move", id: "b", to: "2026-12-02" }, { op: "move", id: "c", to: "2026-12-06" }] });
  });

  it("keeps the days apart across a clock change and a month end", () => {
    const r = dropOnDay([plan("a", "2026-10-30"), plan("b", "2026-11-02")], "2026-10-30", "2026-10-31", "2026-10-01", false, key);
    expect(r.ops).toEqual([{ op: "move", id: "a", to: "2026-10-31" }, { op: "move", id: "b", to: "2026-11-03" }]);
  });

  it("copies when asked, and when everything dragged is in the past", () => {
    expect(dropOnDay([plan("a", "2026-11-23")], "2026-11-23", "2026-11-24", today, true, () => "x").ops).toEqual([{ op: "copy", id: "a", to: "2026-11-24", key: "x" }]);
    const past = dropOnDay([plan("p", "2026-11-18")], "2026-11-18", "2026-11-24", today, false, () => "y");
    expect(past).toEqual({ copied: true, left: 0, ops: [{ op: "copy", id: "p", to: "2026-11-24", key: "y" }] });
  });

  it("leaves what would land before today, and what can't move, and says how many", () => {
    const list = [plan("a", "2026-11-23"), plan("b", "2026-11-27"), plan("old", "2026-11-20")];
    // Monday dragged back to Sunday 22: the Friday plan lands on Thursday, the old one would land before today.
    const r = dropOnDay(list, "2026-11-23", "2026-11-22", today, false, key);
    expect(r.ops).toEqual([{ op: "move", id: "a", to: "2026-11-22" }, { op: "move", id: "b", to: "2026-11-26" }]);
    expect(r.left).toBe(1);
    // A COROS workout whose steps this app can't write moves, but can't be copied.
    const coros = { id: "c", date: "2026-11-23", status: "planned" as const, source: "coros", coros: { workout: null } };
    expect(dropOnDay([coros], "2026-11-23", "2026-11-24", today, true, key)).toMatchObject({ ops: [], left: 1 });
    expect(dropOnDay([coros], "2026-11-23", "2026-11-24", today, false, key).ops).toEqual([{ op: "move", id: "c", to: "2026-11-24" }]);
    // Recorded activities never move or copy.
    expect(dropOnDay([{ id: "d", date: "2026-11-23", status: "done", source: "synced" }], "2026-11-23", "2026-11-24", today, false, key)).toMatchObject({ ops: [], left: 1 });
  });

  it("links an activity dropped on a plan, either way round, and nothing else", () => {
    type E = { id: string; date: string; status: "done" | "planned"; pending?: string };
    const p: E = { id: "p", date: "2026-11-23", status: "planned" };
    const d: E = { id: "d", date: "2026-11-24", status: "done" };
    expect(linkPair(d, p)).toEqual([p, d]);
    expect(linkPair(p, d)).toEqual([p, d]);
    expect(linkPair(p, { ...p, id: "q" })).toBeNull();
    expect(linkPair(d, { ...p, pending: "added" })).toBeNull();
  });
});
