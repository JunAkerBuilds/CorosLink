import { describe, expect, it } from "vitest";
import {
  alarmsOf, averageDailyDrop, batteryLevels, changeWrites, goalsOf, pendingFromItems, refusedText, wantedAlarms, watchFromState,
  whenText, writesForChange, writesForUndo, type ChangeItem,
} from "./watch";
import { dateToRef, type WatchAlarmBody, type WatchStateBody } from "./native";
import { seedItems } from "@/data/sampleSeed";
import type { Alarm } from "@/data/watch";
import { alarmJson, alarmKey, alarmRows } from "@/lib/watch";

const NOW = new Date(2026, 10, 20, 14, 10);
const AT = dateToRef(NOW);
const seed = seedItems(NOW);
const state = seed.find((i) => i.collection === "watch.state")!.body as WatchStateBody;
const ref = (month: number, day: number, hour = 6, minute = 58) => dateToRef(new Date(2026, month - 1, day, hour, minute));

const SLOT0: WatchAlarmBody = { slot: 0, enabled: true, hour: 6, minute: 15, days: [1, 2, 3, 4, 5] };
const SLOT1: WatchAlarmBody = { slot: 1, enabled: false, hour: 8, minute: 0, days: [6] };
const A0: Alarm = { id: "slot-0", time: "06:15", days: [1, 2, 3, 4, 5], label: "", on: true };
const A1: Alarm = { id: "slot-1", time: "08:00", days: [6], label: "", on: false };
const item = (id: string, value: ChangeItem["body"]["value"], at = AT): ChangeItem => ({ id, body: { value, at, from: "web" } });

describe("watch.state → the page", () => {
  it("writes when it synced", () => {
    expect(whenText(new Date(2026, 10, 20, 6, 58), NOW)).toBe("today at 06:58");
    expect(whenText(new Date(2026, 10, 19, 21, 10), NOW)).toBe("yesterday at 21:10");
    expect(whenText(new Date(2026, 10, 12, 9, 5), NOW)).toBe("12 Nov at 09:05");
    expect(whenText(new Date(2025, 11, 30, 9, 5), NOW)).toBe("30 Dec 2025 at 09:05");
  });

  it("says the desktop synced it in Local mode", () => {
    const w = watchFromState({ ...state, via: "computer" }, [], NOW);
    expect(w.synced).toBe("Synced with this computer today at 13:28");
    expect(w.viaComputer).toBe(true);
    expect(watchFromState(state, [], NOW).viaComputer).toBeUndefined();
  });

  it("maps the seeded watch", () => {
    const w = watchFromState(state, [], NOW);
    expect(w.name).toBe("COROS PACE Pro");
    expect(w.synced).toBe("Synced through your phone today at 13:28"); // 42 minutes before 14:10
    expect(w.storage).toEqual({ usedGb: 11.2, totalGb: 32 });
    expect(w.firmware).toEqual({ version: "3.2108.0", state: "" }); // nothing says whether it is up to date
    expect(w.goals.map((g) => [g.key, g.goal, g.done, g.soFar])).toEqual([
      ["calories", 600, 400, "400 kcal so far today"],
      ["exercise", 45, 81, "81 min so far today"],
      ["steps", 10000, 7303, "7,303 so far today"],
    ]);
    expect(w.alarms).toEqual([A0, A1]);
    expect(w.gpsMode).toBe("all");
    expect(w.gpsOptions.map((o) => o.mode)).toEqual(["standard", "all", "dual"]);
    expect(w.gpsReadOnly).toBe(false);
    expect(w.pending).toEqual([]);
    expect(w.empty).toBeUndefined();
    expect(w.refused).toBeUndefined();
  });

  it("reads the seeded battery history, worked out by hand", () => {
    const w = watchFromState(state, [], NOW);
    // One reading a day from 31 October: 92 falling to 28 over 11 days, charged to 100 on 12 November, 57 now.
    expect(w.batteryHistory.firstDay).toBe("2026-10-31");
    expect(w.batteryHistory.levels).toEqual([92, 90, 82, 77, 71, 66, 59, 52, 49, 41, 34, 28, 100, 94, 89, 87, 82, 75, 68, 62, 57]);
    // Fell 64 + 43 = 107 percent over 19 days = 5.63 a day; 57 / 5.63 = 10.1 days.
    expect(w.batteryHistory.perDay).toBe("5.6% a day");
    expect(w.batteryHistory.summary).toBe("Last 21 days · 5.6% a day on average");
    expect(w.battery).toEqual({ percent: 57, left: "About 10 days left" });
    expect(w.batteryHistory.alt).toBe("Battery level over 21 days: charged to 100 percent on 12 November, now 57 percent");
  });

  it("keeps the last reading of each local day and carries a level over a day without one", () => {
    const { firstDay, levels } = batteryLevels([
      { at: ref(11, 17, 22, 0), percent: 70 }, { at: ref(11, 17, 7, 0), percent: 80 }, // out of order
      { at: ref(11, 16), percent: 85 }, { at: ref(11, 20, 0, 5), percent: 61 },
    ]);
    expect(firstDay).toBe("2026-11-16");
    expect(levels).toEqual([85, 70, 70, 70, 61]);
    expect(batteryLevels(undefined)).toEqual({ firstDay: "", levels: [] });
  });

  it("estimates the daily drop only from enough falling days", () => {
    expect(averageDailyDrop([100, 96, 92, 88])).toBe(4);
    expect(averageDailyDrop([40, 100, 96])).toBeNull(); // one falling day
    expect(averageDailyDrop([50, 100, 96, 92, 86])).toBeCloseTo(14 / 3, 9); // the charge is left out
    const w = watchFromState({ battery: { percent: 64 }, batteryHistory: [{ at: ref(11, 19), percent: 66 }, { at: ref(11, 20), percent: 64 }] }, [], NOW);
    expect(w.battery).toEqual({ percent: 64, left: "" });
    expect(w.batteryHistory.perDay).toBe("");
    expect(w.batteryHistory.summary).toBe("Last 2 days");
  });

  it("shows only what the phone sent", () => {
    const w = watchFromState({ model: "PACE 4", goals: { steps: 8000 }, gpsMode: "dual", alarms: [{ slot: 3, enabled: true, hour: 5, minute: 5, days: [6, 0, 0, 9] }] }, [], NOW);
    expect(w.name).toBe("PACE 4");
    expect(w.synced).toBe("");
    expect(w.battery).toEqual({ percent: null, left: "" });
    expect(w.storage).toBeNull();
    expect(w.firmware.version).toBe("");
    expect(w.goals).toHaveLength(1);
    expect(w.goals[0]).toMatchObject({ key: "steps", goal: 8000, done: 0, soFar: "" });
    expect(goalsOf({ today: { steps: 500 } })).toEqual([]); // no goal, no row
    expect(w.alarms).toEqual([{ id: "slot-3", time: "05:05", days: [0, 6], label: "", on: true }]);
    // The app can't set the mode on this watch: the card shows the current one, read-only.
    expect(w.gpsOptions.map((o) => o.mode)).toEqual(["dual"]);
    expect(w.gpsReadOnly).toBe(true);
    expect(w.batteryHistory.levels).toEqual([]);
  });

  it("limits the GPS choices to what the watch can be set to", () => {
    const w = watchFromState({ gpsMode: "standard", gpsModes: ["standard", "all"] }, [], NOW);
    expect(w.gpsOptions.map((o) => o.mode)).toEqual(["standard", "all"]);
    expect(w.gpsReadOnly).toBe(false);
  });

  it("is an empty shell before the phone has sent anything, and never shows the sample", () => {
    const w = watchFromState(undefined, [item("goal.steps", 12000)], NOW);
    expect(w).toMatchObject({ empty: true, goals: [], alarms: [], pending: [], gpsMode: null, gpsOptions: [], gpsReadOnly: true, storage: null });
    expect(w.battery.percent).toBeNull();
  });

  it("lists what the watch refused in one line", () => {
    const refused = [{ key: "goal.steps", at: ref(11, 20) }, { key: "alarms", at: ref(11, 18, 21, 10) }, { key: "someNewKey", at: ref(11, 19, 8, 0) }];
    expect(refusedText(refused, NOW)).toBe("The watch refused: Steps goal (today at 06:58), Alarms (18 Nov at 21:10), someNewKey (yesterday at 08:00)");
    expect(refusedText([], NOW)).toBe("");
    expect(watchFromState({ ...state, refused }, [], NOW).refused).toContain("Steps goal");
  });
});

describe("goal and GPS changes", () => {
  it("writes a goal as a number under the contract's key", () => {
    expect(writesForChange(state, [], "goal.exercise", 45, 50, NOW)).toEqual({
      puts: [{ id: "goal.exerciseMinutes", body: { value: 50, at: AT, from: "web" } }], removes: [],
    });
    expect(writesForChange(state, [], "goal.calories", 600, 650, NOW).puts[0]).toEqual({ id: "goal.calories", body: { value: 650, at: AT, from: "web" } });
    expect(writesForChange(state, [], "goal.steps", 10000, 12000, NOW).puts[0].id).toBe("goal.steps");
  });

  it("writes the GPS mode as its string", () => {
    expect(writesForChange(state, [], "gps.mode", "all", "dual", NOW)).toEqual({
      puts: [{ id: "gpsMode", body: { value: "dual", at: AT, from: "web" } }], removes: [],
    });
  });

  it("removes the item when the setting goes back to what the watch has", () => {
    const existing = [item("goal.steps", 12000), item("gpsMode", "dual")];
    expect(writesForChange(state, existing, "goal.steps", 10000, 10000, NOW)).toEqual({ puts: [], removes: ["goal.steps"] });
    expect(writesForUndo(state, existing, "gps.mode", NOW)).toEqual({ puts: [], removes: ["gpsMode"] });
  });

  it("leaves the other waiting items alone", () => {
    const existing = [item("goal.steps", 12000, AT - 600)];
    expect(writesForChange(state, existing, "gps.mode", "all", "standard", NOW)).toEqual({
      puts: [{ id: "gpsMode", body: { value: "standard", at: AT, from: "web" } }], removes: [],
    });
    // A second change to the same goal replaces its item.
    expect(writesForChange(state, existing, "goal.steps", 10000, 12500, NOW).puts).toEqual([{ id: "goal.steps", body: { value: 12500, at: AT, from: "web" } }]);
  });

  it("reads items back as the page's waiting list", () => {
    const pending = pendingFromItems(state, [item("goal.exerciseMinutes", 50, AT - 60), item("gpsMode", "dual"), item("goal.steps", 10000)]);
    expect(pending).toEqual([
      { key: "goal.exercise", from: 45, to: 50, at: NOW.getTime() - 60_000 },
      { key: "gps.mode", from: "all", to: "dual", at: NOW.getTime() },
    ]); // the steps item equals the watch: nothing is waiting
  });

  it("discards everything", () => {
    const existing = [item("goal.steps", 12000), item("gpsMode", "dual"), item("alarms", [SLOT0])];
    expect(changeWrites(state, [], existing, NOW)).toEqual({ puts: [], removes: ["goal.steps", "gpsMode", "alarms"] });
  });
});

describe("alarms ↔ the `alarms` item", () => {
  const NEW: Alarm = { id: "web-abc", time: "05:30", days: [0], label: "Long run", on: true };
  const NEW_BODY: WatchAlarmBody = { enabled: true, hour: 5, minute: 30, days: [0] };

  it("adds an alarm: the whole wanted list, the new one without a slot", () => {
    const writes = writesForChange(state, [], alarmKey(NEW.id), null, alarmJson(NEW), NOW);
    expect(writes).toEqual({ puts: [{ id: "alarms", body: { value: [SLOT0, SLOT1, NEW_BODY], at: AT, from: "web" } }], removes: [] });
    expect("slot" in (writes.puts[0].body.value as WatchAlarmBody[])[2]).toBe(false);
  });

  it("reads an added alarm back as one waiting change", () => {
    const pending = pendingFromItems(state, [item("alarms", [SLOT0, SLOT1, NEW_BODY])]);
    expect(pending).toEqual([{ key: "alarm.new-0", from: null, to: { id: "new-0", time: "05:30", days: [0], label: "", on: true }, at: NOW.getTime() }]);
    const rows = alarmRows(alarmsOf(state), pending);
    expect(rows.map((r) => [r.alarm.time, r.pending])).toEqual([["06:15", null], ["08:00", null], ["05:30", "added"]]);
  });

  it("edits an alarm in its slot", () => {
    const next: Alarm = { ...A1, on: true, time: "08:30", days: [0, 6] };
    const writes = writesForChange(state, [], alarmKey("slot-1"), alarmJson(A1), alarmJson(next), NOW);
    const wanted = [SLOT0, { slot: 1, enabled: true, hour: 8, minute: 30, days: [0, 6] }];
    expect(writes).toEqual({ puts: [{ id: "alarms", body: { value: wanted, at: AT, from: "web" } }], removes: [] });
    expect(pendingFromItems(state, [item("alarms", wanted)])).toEqual([
      { key: "alarm.slot-1", from: alarmJson(A1), to: alarmJson(next), at: NOW.getTime() },
    ]);
  });

  it("deletes an alarm by leaving it out", () => {
    const writes = writesForChange(state, [], alarmKey("slot-0"), alarmJson(A0), null, NOW);
    expect(writes.puts).toEqual([{ id: "alarms", body: { value: [SLOT1], at: AT, from: "web" } }]);
    const pending = pendingFromItems(state, [item("alarms", [SLOT1])]);
    expect(pending).toEqual([{ key: "alarm.slot-0", from: alarmJson(A0), to: null, at: NOW.getTime() }]);
    expect(alarmRows(alarmsOf(state), pending).map((r) => r.pending)).toEqual(["removed", null]);
  });

  it("removes the item when the list is back to the watch's own", () => {
    const edited = [item("alarms", [SLOT0, { ...SLOT1, enabled: true }])];
    // Switched back off by hand.
    expect(writesForChange(state, edited, alarmKey("slot-1"), alarmJson(A1), alarmJson(A1), NOW)).toEqual({ puts: [], removes: ["alarms"] });
    // Undo on the row.
    expect(writesForUndo(state, edited, alarmKey("slot-1"), NOW)).toEqual({ puts: [], removes: ["alarms"] });
    // Removing the only added alarm.
    expect(writesForUndo(state, [item("alarms", [SLOT0, SLOT1, NEW_BODY])], "alarm.new-0", NOW)).toEqual({ puts: [], removes: ["alarms"] });
    // Bringing a deleted one back.
    expect(writesForUndo(state, [item("alarms", [SLOT1])], alarmKey("slot-0"), NOW)).toEqual({ puts: [], removes: ["alarms"] });
  });

  it("recomputes the list when one of several alarm changes is undone", () => {
    const existing = [item("alarms", [{ ...SLOT1, enabled: true }, NEW_BODY]), item("goal.steps", 12000)]; // slot 0 deleted, slot 1 on, one added
    expect(pendingFromItems(state, existing).map((c) => c.key)).toEqual(["alarm.slot-0", "alarm.slot-1", "alarm.new-0", "goal.steps"]);
    expect(writesForUndo(state, existing, "alarm.new-0", NOW)).toEqual({
      puts: [{ id: "alarms", body: { value: [{ ...SLOT1, enabled: true }], at: AT, from: "web" } }], removes: [],
    });
    expect(writesForUndo(state, existing, alarmKey("slot-0"), NOW).puts[0].body.value).toEqual([SLOT0, { ...SLOT1, enabled: true }, NEW_BODY]);
  });

  it("edits an alarm that was added and is still waiting", () => {
    const existing = [item("alarms", [SLOT0, SLOT1, NEW_BODY])];
    const next: Alarm = { id: "new-0", time: "05:45", days: [0], label: "", on: true };
    expect(writesForChange(state, existing, "alarm.new-0", null, alarmJson(next), NOW).puts[0].body.value)
      .toEqual([SLOT0, SLOT1, { enabled: true, hour: 5, minute: 45, days: [0] }]);
  });

  it("does not write the item again when nothing in it changed", () => {
    const existing = [item("alarms", [SLOT0, SLOT1, NEW_BODY], AT - 300)];
    expect(writesForChange(state, existing, "goal.steps", 10000, 11000, NOW)).toEqual({
      puts: [{ id: "goal.steps", body: { value: 11000, at: AT, from: "web" } }], removes: [],
    });
  });

  it("builds the wanted list from the watch's alarms and the waiting changes", () => {
    expect(wantedAlarms(state, [])).toEqual([SLOT0, SLOT1]);
    expect(wantedAlarms({}, [{ key: "alarm.web-1", from: null, to: alarmJson(NEW), at: 0 }])).toEqual([NEW_BODY]);
  });
});
