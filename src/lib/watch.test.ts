import { describe, expect, it } from "vitest";
import type { Alarm } from "@/data/watch";
import {
  alarmJson, alarmKey, alarmLine, alarmRows, parseGoal, pendingCount, pendingFor, queueChange, repeatLabel,
  sameValue, undoChange, validTime, valueOf, type PendingChange,
} from "./watch";

const none: PendingChange[] = [];

import { goalShare, lastChargeIndex, stepGoal } from "./watch";

describe("queueChange", () => {
  it("adds a change with what the watch has and what it will get", () => {
    const q = queueChange(none, "goal.steps", 10000, 12000, 5);
    expect(q).toEqual([{ key: "goal.steps", from: 10000, to: 12000, at: 5 }]);
    expect(pendingCount(q)).toBe(1);
  });
  it("replaces an earlier change to the same setting, keeping its place and the watch's value", () => {
    let q = queueChange(none, "goal.steps", 10000, 12000, 1);
    q = queueChange(q, "gps.mode", "all", "dual", 2);
    q = queueChange(q, "goal.steps", 10000, 9000, 3);
    expect(q.map((c) => c.key)).toEqual(["goal.steps", "gps.mode"]);
    expect(q[0]).toEqual({ key: "goal.steps", from: 10000, to: 9000, at: 3 });
    expect(pendingCount(q)).toBe(2);
  });
  it("removes the entry when the setting goes back to what the watch has", () => {
    let q = queueChange(none, "goal.steps", 10000, 12000, 1);
    q = queueChange(q, "goal.steps", 10000, 10000, 2);
    expect(q).toEqual([]);
    expect(pendingCount(q)).toBe(0);
  });
  it("adds nothing for a change that is no change", () => {
    expect(queueChange(none, "gps.mode", "all", "all", 1)).toEqual([]);
  });
  it("compares alarms by content, not identity", () => {
    const a: Alarm = { id: "a1", time: "06:15", days: [1, 2, 3, 4, 5], label: "", on: true };
    let q = queueChange(none, alarmKey("a1"), alarmJson(a), alarmJson({ ...a, on: false }), 1);
    expect(pendingCount(q)).toBe(1);
    q = queueChange(q, alarmKey("a1"), alarmJson(a), alarmJson({ ...a, days: [1, 2, 3, 4, 5] }), 2);
    expect(q).toEqual([]);
  });
  it("does not change the queue it was given", () => {
    const q = queueChange(none, "goal.steps", 10000, 12000, 1);
    const frozen = JSON.stringify(q);
    queueChange(q, "goal.steps", 10000, 8000, 2);
    undoChange(q, "goal.steps");
    expect(JSON.stringify(q)).toBe(frozen);
  });
});

describe("undoChange, pendingFor, valueOf", () => {
  const q = queueChange(queueChange(none, "goal.steps", 10000, 12000, 1), "gps.mode", "all", "dual", 2);
  it("undoes one setting and leaves the rest", () => {
    expect(undoChange(q, "goal.steps").map((c) => c.key)).toEqual(["gps.mode"]);
    expect(undoChange(q, "nothing")).toEqual(q);
  });
  it("finds what is waiting for a setting", () => {
    expect(pendingFor(q, "gps.mode")?.to).toBe("dual");
    expect(pendingFor(q, "goal.calories")).toBeUndefined();
  });
  it("shows the waiting value, or the watch's own", () => {
    expect(valueOf(q, "goal.steps", 10000)).toBe(12000);
    expect(valueOf(q, "goal.calories", 600)).toBe(600);
  });
});

describe("sameValue", () => {
  it("compares deeply", () => {
    expect(sameValue({ a: [1, 2], b: "x" }, { b: "x", a: [1, 2] })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameValue(null, { a: 1 })).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
  });
});

describe("alarmRows", () => {
  const onWatch: Alarm[] = [
    { id: "a1", time: "06:15", days: [1, 2, 3, 4, 5], label: "", on: true },
    { id: "a3", time: "08:00", days: [6], label: "", on: false },
  ];
  const added: Alarm = { id: "a2", time: "05:30", days: [0], label: "Long run", on: true };
  it("shows the watch's alarms untouched with an empty queue", () => {
    expect(alarmRows(onWatch, none)).toEqual(onWatch.map((alarm) => ({ alarm, pending: null })));
  });
  it("marks added, changed and removed alarms", () => {
    let q = queueChange(none, alarmKey("a2"), null, alarmJson(added), 1);
    q = queueChange(q, alarmKey("a1"), alarmJson(onWatch[0]), alarmJson({ ...onWatch[0], time: "06:00" }), 2);
    q = queueChange(q, alarmKey("a3"), alarmJson(onWatch[1]), null, 3);
    const rows = alarmRows(onWatch, q);
    expect(rows.map((r) => [r.alarm.id, r.alarm.time, r.pending])).toEqual([
      ["a1", "06:00", "changed"],
      ["a3", "08:00", "removed"],
      ["a2", "05:30", "added"],
    ]);
  });
  it("drops an added alarm again when it is undone", () => {
    const q = undoChange(queueChange(none, alarmKey("a2"), null, alarmJson(added), 1), alarmKey("a2"));
    expect(alarmRows(onWatch, q)).toHaveLength(2);
  });
});

describe("repeatLabel and alarmLine", () => {
  it("names the common patterns", () => {
    expect(repeatLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(repeatLabel([6, 0])).toBe("Weekends");
    expect(repeatLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(repeatLabel([])).toBe("Once");
    expect(repeatLabel([0])).toBe("Sunday");
    expect(repeatLabel([6])).toBe("Saturday");
  });
  it("lists other days Monday first", () => {
    expect(repeatLabel([0, 3, 1])).toBe("Mon, Wed, Sun");
  });
  it("adds the alarm's name", () => {
    expect(alarmLine({ days: [0], label: "Long run" })).toBe("Sunday · Long run");
    expect(alarmLine({ days: [6], label: "" })).toBe("Saturday");
  });
});

describe("parseGoal and validTime", () => {
  it("accepts whole numbers in range only", () => {
    expect(parseGoal("600", 9999)).toBe(600);
    expect(parseGoal(" 45 ", 1440)).toBe(45);
    expect(parseGoal("", 9999)).toBeNull();
    expect(parseGoal("0", 9999)).toBeNull();
    expect(parseGoal("12.5", 9999)).toBeNull();
    expect(parseGoal("-3", 9999)).toBeNull();
    expect(parseGoal("100000", 99999)).toBeNull();
  });
  it("checks 24-hour times", () => {
    expect(validTime("06:15")).toBe(true);
    expect(validTime("23:59")).toBe(true);
    expect(validTime("24:00")).toBe(false);
    expect(validTime("6:15")).toBe(false);
  });
});

describe("goal rings and steppers", () => {
  it("fills the ring by today's share, capped at full", () => {
    expect(goalShare(520, 600)).toBeCloseTo(0.8667, 3);
    expect(goalShare(8412, 10000)).toBeCloseTo(0.8412, 4);
    expect(goalShare(700, 600)).toBe(1);
    expect(goalShare(0, 600)).toBe(0);
    expect(goalShare(10, 0)).toBe(0);
  });

  it("steps to the next multiple and stays inside the limits", () => {
    expect(stepGoal(600, 50, 1, 9999)).toBe(650);
    expect(stepGoal(600, 50, -1, 9999)).toBe(550);
    expect(stepGoal(612, 50, 1, 9999)).toBe(650);
    expect(stepGoal(612, 50, -1, 9999)).toBe(600);
    expect(stepGoal(50, 50, -1, 9999)).toBe(50);
    expect(stepGoal(9980, 50, 1, 9999)).toBe(9999);
  });

  it("finds the last charge", () => {
    expect(lastChargeIndex([34, 30, 100, 97, 91, 88, 83, 80, 76, 68, 67, 66, 65, 64])).toBe(2);
    expect(lastChargeIndex([90, 80, 70])).toBeNull();
  });
});
