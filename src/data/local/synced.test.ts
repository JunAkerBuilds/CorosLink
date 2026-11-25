import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory store in place of sync's engine: items by collection, a revision, listeners.
const mem = vi.hoisted(() => {
  const items = new Map<string, Map<string, unknown>>();
  const listeners = new Set<() => void>();
  const log: string[] = [];
  let revision = 0;
  const bump = () => { revision++; listeners.forEach((l) => l()); };
  return {
    items, log, loaded: true,
    reset() { items.clear(); log.length = 0; revision++; },
    peekItems: (c: string) => [...(items.get(c) ?? new Map()).entries()].map(([id, body]) => ({ id, version: 1, body })),
    put: (c: string, id: string, body: unknown) => { log.push(`put ${c}/${id}`); (items.get(c) ?? items.set(c, new Map()).get(c)!).set(id, body); bump(); },
    remove: (c: string, id: string) => { log.push(`remove ${c}/${id}`); items.get(c)?.delete(id); bump(); },
    subscribeSync: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    syncRevision: () => revision,
  };
});
vi.mock("@/data/sync/engine", () => ({ ...mem, syncLoaded: () => mem.loaded }));

const { syncedList, MAX_ITEM_CHARS } = await import("./synced");
const { planStore, savedPlans, putPlan, dropPlan } = await import("./plans");
const { libraryWorkouts, savedWorkouts } = await import("./workouts");
const { moveFromBrowser } = await import("./fromBrowser");

const plan = (id: string, name = "Base") => ({ id, name, entries: [], phases: [], weekCount: 4 });
const workout = (id: string, name: string, date = "2026-12-01") => ({ id, name, sport: "run", date, repeatWeeks: 1, items: [] });

function storage(values: Record<string, unknown>) {
  const map = new Map(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map };
}

beforeEach(() => mem.reset());

describe("lists kept as items in this computer's store", () => {
  it("writes only what changed: new and edited entries, and removes what went", () => {
    putPlan(plan("plan:a") as never);
    putPlan(plan("plan:b") as never);
    expect(mem.log).toEqual(["put training.plan/plan:a", "put training.plan/plan:b"]);
    mem.log.length = 0;
    putPlan(plan("plan:a") as never); // the same plan again: nothing to write
    putPlan(plan("plan:a", "Base 2") as never);
    dropPlan("plan:b");
    expect(mem.log).toEqual(["put training.plan/plan:a", "remove training.plan/plan:b"]);
    expect(savedPlans().map((p) => [p.id, p.name])).toEqual([["plan:a", "Base 2"]]);
    expect(planStore.hasSaved()).toBe(true);
  });

  it("refuses an entry the store couldn't take, before writing anything of it", () => {
    const list = syncedList<{ id: string; name: string; text: string }>("training.plan", (l) => l as never);
    expect(() => list.set([{ id: "big", name: "Huge plan", text: "x".repeat(MAX_ITEM_CHARS) }])).toThrow(/Huge plan.*too large/);
    expect(mem.log).toEqual([]);
  });

  it("reads the same list until something changes, so screens don't redraw for nothing", () => {
    putPlan(plan("plan:a") as never);
    const first = planStore.get();
    expect(planStore.get()).toBe(first);
    putPlan(plan("plan:c") as never);
    expect(planStore.get()).not.toBe(first);
  });
});

describe("moving plans and workouts out of the page's storage", () => {
  it("moves each once, keeps what's already here, and removes the old values", () => {
    putPlan(plan("plan:a", "Mine") as never);
    const old = storage({
      "clink.plans.v1": [plan("plan:a", "Old copy"), plan("plan:z"), { nonsense: true }],
      "clink.workouts.v1": [workout("w-1", "Tempo")],
      "clink.workout-library.v1": [workout("lib-1", "Hills", "")],
      "clink.theme": "dark",
    });
    expect(moveFromBrowser(old)).toBe(3);
    expect(savedPlans().map((p) => [p.id, p.name])).toEqual([["plan:a", "Mine"], ["plan:z", "Base"]]);
    expect(savedWorkouts().map((w) => w.id)).toEqual(["w-1"]);
    expect(libraryWorkouts().map((w) => w.name)).toEqual(["Hills"]);
    expect([...old.map.keys()]).toEqual(["clink.theme"]);
    expect(moveFromBrowser(old)).toBe(0);
  });

  it("keeps the old value when the store can't take it, to try at the next start", () => {
    const old = storage({ "clink.plans.v1": [{ ...plan("plan:big", "Huge"), pad: "x".repeat(MAX_ITEM_CHARS) }] });
    expect(moveFromBrowser(old)).toBe(0);
    expect(old.map.has("clink.plans.v1")).toBe(true);
  });
});
