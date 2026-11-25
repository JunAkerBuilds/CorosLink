import { describe, expect, it } from "vitest";
import { canonical } from "./canonical";
import { applyEdit, applyPull, applyPushed, baseOf, batches, emptyState, merge3, visible, visibleOne, type SyncState, type Unsent } from "./state";

const item = (id: string, version: number, body: unknown) => ({ collection: "fuel.entry", id, version, body });
const pulled = (state: SyncState, items: Parameters<typeof applyPull>[1]["items"], cursor: number) => applyPull(state, { items, cursor, more: false });

describe("canonical", () => {
  it("sorts keys at every depth and drops whitespace and undefined", () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: undefined, x: null }], c: "x" } })).toBe('{"a":{"c":"x","d":[2,{"x":null,"z":1}]},"b":1}');
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });
});

describe("pull", () => {
  it("adds, replaces and removes items and moves the cursor", () => {
    let s = pulled(emptyState(), [item("A", 1, { g: 1 }), item("B", 2, { g: 2 })], 2);
    expect(s.changed).toBe(true);
    expect(s.state.cursor).toBe(2);
    s = pulled(s.state, [{ collection: "fuel.entry", id: "A", version: 3, deleted: true }, item("B", 4, { g: 5 })], 4);
    expect(visible(s.state, "fuel.entry").map((i) => [i.id, i.body])).toEqual([["B", { g: 5 }]]);
    expect(s.state.cursor).toBe(4);
  });

  it("says nothing changed when the same bodies come again (key order aside)", () => {
    const first = pulled(emptyState(), [item("A", 1, { a: 1, b: 2 })], 1).state;
    expect(pulled(first, [item("A", 5, { b: 2, a: 1 })], 5).changed).toBe(false);
  });

  it("merges a remote change with an unsent edit to the same item, field by field", () => {
    let s = pulled(emptyState(), [{ collection: "fuel.profile", id: "me", version: 1, body: { kcal: 2000, weightKg: 68, goal: { pace: 1, kind: "lose" } } }], 1).state;
    s = applyEdit(s, { collection: "fuel.profile", id: "me", body: { kcal: 2200, weightKg: 68, goal: { pace: 2, kind: "lose" } }, at: 1 });
    // The phone changed the weight and the goal's kind meanwhile.
    s = pulled(s, [{ collection: "fuel.profile", id: "me", version: 7, body: { kcal: 2000, weightKg: 70, goal: { pace: 1, kind: "gain" } } }], 7).state;
    expect(visibleOne(s, "fuel.profile", "me")?.body).toEqual({ kcal: 2200, weightKg: 70, goal: { pace: 2, kind: "gain" } });
    const edit = s.unsent["fuel.profile/me"];
    expect(edit.body).toEqual({ kcal: 2200, weightKg: 70, goal: { pace: 2, kind: "gain" } });
    expect(baseOf(s, edit)).toBe(7);
  });

  it("keeps the edit made here when both sides changed the same field", () => {
    let s = pulled(emptyState(), [item("A", 1, { g: 1 })], 1).state;
    s = applyEdit(s, { collection: "fuel.entry", id: "A", body: { g: 2 }, at: 1 });
    s = pulled(s, [item("A", 7, { g: 9 })], 7).state;
    expect(visibleOne(s, "fuel.entry", "A")?.body).toEqual({ g: 2 });
    expect(Object.keys(s.unsent)).toEqual(["fuel.entry/A"]);
  });

  it("drops an unsent edit once the server holds the same thing", () => {
    let s = pulled(emptyState(), [item("A", 1, { g: 1, n: 1 })], 1).state;
    s = applyEdit(s, { collection: "fuel.entry", id: "A", body: { g: 2, n: 1 }, at: 1 });
    s = pulled(s, [item("A", 7, { n: 1, g: 2 })], 7).state;
    expect(s.unsent).toEqual({});
  });

  it("lets an edit win over a deletion, whichever side made which", () => {
    // Edited here, deleted elsewhere: the edit is sent again and brings the item back.
    let s = pulled(emptyState(), [item("A", 1, { g: 1 })], 1).state;
    s = applyEdit(s, { collection: "fuel.entry", id: "A", body: { g: 2 }, at: 1 });
    s = pulled(s, [{ collection: "fuel.entry", id: "A", version: 5, deleted: true }], 5).state;
    expect(visibleOne(s, "fuel.entry", "A")?.body).toEqual({ g: 2 });
    expect(Object.keys(s.unsent)).toEqual(["fuel.entry/A"]);
    // Deleted here, edited elsewhere: the item stays.
    let t = pulled(emptyState(), [item("B", 1, { g: 1 })], 1).state;
    t = applyEdit(t, { collection: "fuel.entry", id: "B", deleted: true, at: 1 });
    expect(visibleOne(t, "fuel.entry", "B")).toBeUndefined();
    t = pulled(t, [item("B", 6, { g: 3 })], 6).state;
    expect(t.unsent).toEqual({});
    expect(visibleOne(t, "fuel.entry", "B")?.body).toEqual({ g: 3 });
    // Deleted here, and the pull only repeats what was there: still deleted, still to send.
    let u = pulled(emptyState(), [item("C", 1, { g: 1 })], 1).state;
    u = applyEdit(u, { collection: "fuel.entry", id: "C", deleted: true, at: 1 });
    u = pulled(u, [item("C", 1, { g: 1 })], 1).state;
    expect(Object.keys(u.unsent)).toEqual(["fuel.entry/C"]);
  });

  it("keeps a newer unsent edit when the pull only echoes what was pushed before", () => {
    const first: Unsent = { collection: "fuel.entry", id: "A", body: { g: 2 }, at: 1 };
    let s = applyEdit(emptyState(), first);
    s = applyPushed(s, [first], [{ collection: "fuel.entry", id: "A", version: 3 }]);
    s = applyEdit(s, { collection: "fuel.entry", id: "A", body: { g: 4 }, at: 2 });
    s = pulled(s, [item("A", 3, { g: 2 })], 3).state;
    expect(visibleOne(s, "fuel.entry", "A")?.body).toEqual({ g: 4 });
    expect(Object.keys(s.unsent)).toEqual(["fuel.entry/A"]);
  });
});

describe("merge3", () => {
  it("takes each side's own changes and prefers mine where both changed", () => {
    expect(merge3({ a: 1, b: 1, c: 1 }, { a: 2, b: 1, c: 5 }, { a: 1, b: 3, c: 6 })).toEqual({ a: 2, b: 3, c: 5 });
  });
  it("keeps a field one side added and drops one a side removed", () => {
    expect(merge3({ a: 1, gone: 1 }, { a: 1, mine: 1 }, { a: 1, gone: 1, theirs: 1 })).toEqual({ a: 1, mine: 1, theirs: 1 });
  });
  it("treats a list as one value", () => {
    expect(merge3({ l: [1] }, { l: [1, 2] }, { l: [1, 3] })).toEqual({ l: [1, 2] });
    expect(merge3({ l: [1] }, { l: [1] }, { l: [1, 3] })).toEqual({ l: [1, 3] });
  });
  it("without a base keeps mine and what only the other side has", () => {
    expect(merge3(undefined, { a: 1 }, { a: 2, b: 2 })).toEqual({ a: 1, b: 2 });
  });
});

describe("edits", () => {
  it("stay unsent when the server refuses them as out of date, and are sent against its version next", () => {
    const edit: Unsent = { collection: "fuel.entry", id: "A", body: { g: 2 }, at: 1 };
    let s = applyEdit(pulled(emptyState(), [item("A", 1, { g: 1 })], 1).state, edit);
    expect(baseOf(s, edit)).toBe(1);
    s = applyPushed(s, [edit], [{ collection: "fuel.entry", id: "A", version: 9, changed: false, conflict: true }]);
    expect(s.items["fuel.entry/A"]).toEqual({ collection: "fuel.entry", id: "A", version: 1, body: { g: 1 } });
    expect(baseOf(s, s.unsent["fuel.entry/A"])).toBe(9);
    s = pulled(s, [item("A", 9, { g: 1, note: "x" })], 9).state;
    expect(s.unsent["fuel.entry/A"].body).toEqual({ g: 2, note: "x" });
  });

  it("show at once, stay unsent until pushed, and never move the cursor", () => {
    const edit: Unsent = { collection: "fuel.entry", id: "N", body: { g: 1 }, at: 1 };
    let s = applyEdit({ ...emptyState(), cursor: 10 }, edit);
    expect(visible(s, "fuel.entry")).toEqual([{ collection: "fuel.entry", id: "N", version: 0, body: { g: 1 } }]);
    s = applyPushed(s, [edit], [{ collection: "fuel.entry", id: "N", version: 11, changed: true }]);
    expect(s.unsent).toEqual({});
    expect(s.items["fuel.entry/N"].version).toBe(11);
    expect(s.cursor).toBe(10);
  });

  it("keep an edit that changed again while its push was in flight", () => {
    const sent: Unsent = { collection: "fuel.entry", id: "N", body: { g: 1 }, at: 1 };
    let s = applyEdit(emptyState(), sent);
    s = applyEdit(s, { ...sent, body: { g: 2 }, at: 2 });
    s = applyPushed(s, [sent], [{ collection: "fuel.entry", id: "N", version: 4 }]);
    expect(s.unsent["fuel.entry/N"].body).toEqual({ g: 2 });
  });

  it("hide a deleted item and send nothing for one the server never had", () => {
    let s = pulled(emptyState(), [item("A", 1, { g: 1 })], 1).state;
    s = applyEdit(s, { collection: "fuel.entry", id: "A", deleted: true, at: 1 });
    expect(visible(s, "fuel.entry")).toEqual([]);
    s = applyEdit(s, { collection: "fuel.entry", id: "ghost", body: { g: 1 }, at: 2 });
    s = applyEdit(s, { collection: "fuel.entry", id: "ghost", deleted: true, at: 3 });
    expect(Object.keys(s.unsent)).toEqual(["fuel.entry/A"]);
  });

  it("drop an edit that puts back exactly what the server has", () => {
    let s = pulled(emptyState(), [item("A", 1, { a: 1, b: 2 })], 1).state;
    s = applyEdit(s, { collection: "fuel.entry", id: "A", body: { a: 5, b: 2 }, at: 1 });
    s = applyEdit(s, { collection: "fuel.entry", id: "A", body: { b: 2, a: 1 }, at: 2 });
    expect(s.unsent).toEqual({});
  });
});

describe("batches", () => {
  it("cuts at 200 changes and by size", () => {
    const many = Array.from({ length: 450 }, (_, i): Unsent => ({ collection: "fuel.entry", id: String(i), body: { i }, at: i }));
    expect(batches(many).map((b) => b.length)).toEqual([200, 200, 50]);
    const big = Array.from({ length: 3 }, (_, i): Unsent => ({ collection: "activity.detail", id: String(i), body: { s: "x".repeat(400_000) }, at: i }));
    expect(batches(big).map((b) => b.length)).toEqual([2, 1]);
  });
});
