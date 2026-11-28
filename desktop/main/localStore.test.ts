import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./localStore";

interface Answer { results: Record<string, unknown>[]; items: { body?: unknown }[]; cursor?: number; more?: boolean }

const open = () => new LocalStore(path.join(mkdtempSync(path.join(tmpdir(), "store-")), "clink.db"));
const call = async (store: LocalStore, method: string, pathAndQuery: string, body?: unknown, token = store.token) => {
  const answer = await store.handle(new Request(`http://local.invalid${pathAndQuery}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: answer.status, body: (await answer.json()) as Answer };
};

describe("local store, speaking the sync API", () => {
  it("keeps versions growing, skips unchanged writes and sorts body keys", async () => {
    const store = open();
    const first = await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "fuel.entry", id: "A", body: { b: 1, a: 2 } }] });
    expect(first.body.results[0]).toMatchObject({ version: 1, changed: true });
    const again = await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "fuel.entry", id: "A", body: { a: 2, b: 1 } }] });
    expect(again.body.results[0]).toMatchObject({ version: 1, changed: false });
    const pulled = await call(store, "GET", "/api/v1/me/sync?since=0");
    expect(JSON.stringify(pulled.body.items[0].body)).toBe('{"a":2,"b":1}');
    expect(pulled.body).toMatchObject({ cursor: 1, more: false });
  });

  it("reports a conflict when the base moved, and deletes with a marker", async () => {
    const store = open();
    await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "gym.planned", id: "P", body: { day: 1 } }] });
    await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "gym.planned", id: "P", body: { day: 2 } }] });
    const stale = await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "gym.planned", id: "P", base: 1, body: { day: 3 } }] });
    expect(stale.body.results[0]).toMatchObject({ conflict: true, version: 2 });
    await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "gym.planned", id: "P", deleted: true }] });
    const pulled = await call(store, "GET", "/api/v1/me/sync?since=2");
    expect(pulled.body.items).toEqual([expect.objectContaining({ id: "P", version: 3, deleted: true })]);
    expect(store.size).toBe(0);
  });

  it("pages by count, says when more is waiting, and resets a cursor from before a wipe", async () => {
    const store = open();
    store.seed(Array.from({ length: 5 }, (_, i) => ({ collection: "activity", id: `a${i}`, body: { n: i } })));
    const page = await call(store, "GET", "/api/v1/me/sync?since=0&limit=2");
    expect(page.body).toMatchObject({ cursor: 2, more: true });
    await call(store, "DELETE", "/api/v1/me/sync");
    expect((await call(store, "GET", "/api/v1/me/sync?since=5")).body).toMatchObject({ items: [], cursor: 0 });
  });

  it("writes a big import in batches the push takes, leaving out only an item too large for it", () => {
    const store = open();
    // 150 activity details of ~20 KB: 3 MB in all, more than one push takes, as a big first import writes.
    const streams = Array.from({ length: 2500 }, (_, i) => i * 1.5);
    const details = Array.from({ length: 150 }, (_, i) => ({ collection: "activity.detail", id: String(1000 + i), body: { streams: { x: streams } } }));
    const huge = { collection: "activity.detail", id: "huge", body: { streams: { x: Array.from({ length: 60_000 }, (_, i) => i) } } };
    expect(store.write([...details, huge])).toEqual({ written: 150, conflicts: 0, skipped: 1 });
    expect(store.count("activity.detail")).toBe(150);
    store.close();
  });

  it("answers status and single items, and refuses other tokens and bad batches", async () => {
    const store = open();
    store.seed([{ collection: "health.day", id: "2026-11-20", body: { hrv: 61 } }]);
    expect((await call(store, "GET", "/api/v1/me/sync/status")).body).toMatchObject({ items: 1, cursor: 1 });
    expect((await call(store, "GET", "/api/v1/me/sync/items?key=health.day/2026-11-20")).body.items).toHaveLength(1);
    expect((await call(store, "GET", "/api/v1/me/sync", undefined, "clink_local_other")).status).toBe(401);
    const bad = await call(store, "POST", "/api/v1/me/sync", { changes: [{ collection: "ok", id: "1", body: {} }, { collection: "Bad!", id: "2", body: {} }] });
    expect(bad.status).toBe(400);
    expect(store.size).toBe(1);
  });

  it("sends a client from before a restore back to 0, even when the backup holds more than it had seen", async () => {
    const store = open();
    store.seed(Array.from({ length: 3 }, (_, i) => ({ collection: "activity", id: `old${i}`, body: { n: i } })));
    // A phone caught up at 3; then a backup of 10 items is restored here.
    const phone = (await call(store, "GET", "/api/v1/me/sync?since=0")).body.cursor!;
    expect(phone).toBe(3);
    store.replaceWith(Array.from({ length: 10 }, (_, i) => ({ collection: "activity", id: `new${i}`, body: { n: i } })));
    // Its status check sees something new, and its pull is told to start over.
    expect((await call(store, "GET", "/api/v1/me/sync/status")).body.cursor).toBeGreaterThan(phone);
    expect((await call(store, "GET", `/api/v1/me/sync?since=${phone}`)).body).toMatchObject({ items: [], cursor: 0, more: false });
    const fresh = (await call(store, "GET", "/api/v1/me/sync?since=0&limit=500")).body;
    expect(fresh.items.map((i) => (i as { id?: string }).id)).toEqual(Array.from({ length: 10 }, (_, i) => `new${i}`));
    // From the new cursor on, nothing is new and nothing starts over.
    expect((await call(store, "GET", `/api/v1/me/sync?since=${fresh.cursor}`)).body).toMatchObject({ items: [], cursor: fresh.cursor, more: false });
  });

  it("moves the cursor on for a wipe with nothing restored, so a client still notices and settles", async () => {
    const store = open();
    store.seed([{ collection: "activity", id: "a", body: { n: 1 } }]);
    await call(store, "DELETE", "/api/v1/me/sync");
    expect((await call(store, "GET", "/api/v1/me/sync/status")).body.cursor).toBe(2);
    expect((await call(store, "GET", "/api/v1/me/sync?since=1")).body).toMatchObject({ items: [], cursor: 0 });
    // Starting over from 0, it lands on the store's cursor, not 0 again (which would make every status check look new).
    expect((await call(store, "GET", "/api/v1/me/sync?since=0")).body).toMatchObject({ items: [], cursor: 2, more: false });
  });
});
