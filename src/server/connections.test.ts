import { describe, expect, it } from "vitest";
import { touchesConnections, withoutConnections } from "./connections";

describe("shared connections", () => {
  it("are taken out of a pull answer and never passed on", () => {
    const other = { collection: "fuel.entry", id: "A", version: 4, deleted: false, body: { name: "Oats" } };
    const hevy = { collection: "connection", id: "hevy", version: 5, deleted: false, body: { apiKey: "HEVY-SECRET-KEY" } };
    const intervals = { collection: "connection", id: "intervals", version: 6, deleted: false, body: { apiKey: "ICU-SECRET", athleteId: "i204817" } };
    const pulled = withoutConnections({ schemaVersion: 1, items: [other, hevy, intervals], cursor: 6, more: false });
    expect(pulled.payload).toEqual({ schemaVersion: 1, items: [other], cursor: 6, more: false });
    expect(pulled.changes).toEqual([{ id: "hevy", body: hevy.body }, { id: "intervals", body: intervals.body }]);
    expect(JSON.stringify(pulled.payload)).not.toContain("SECRET");
  });

  it("read a deletion as disconnected everywhere, keep the newest word, and drop a service they don't know", () => {
    const pulled = withoutConnections({ items: [
      { collection: "connection", id: "hevy", version: 5, body: { apiKey: "OLD-KEY-1234" } },
      { collection: "connection", id: "hevy", version: 7, deleted: true },
      { collection: "connection", id: "strava", version: 8, body: { token: "SECRET" } },
    ], cursor: 8, more: false });
    expect(pulled).toEqual({ payload: { items: [], cursor: 8, more: false }, changes: [{ id: "hevy", body: null }] });
    expect(withoutConnections({ error: { code: "x" } })).toEqual({ payload: { error: { code: "x" } }, changes: [] });
  });

  it("can't be written by the browser, however the name is spelt", () => {
    expect(touchesConnections(JSON.stringify({ changes: [{ collection: "connection", id: "hevy", body: { apiKey: "x" } }] }))).toBe(true);
    expect(touchesConnections('{"changes":[{"collection":"connec\\u0074ion","id":"hevy","deleted":true}]}')).toBe(true);
    expect(touchesConnections(JSON.stringify({ changes: [{ collection: "fuel.entry", id: "connection", body: {} }] }))).toBe(false);
    expect(touchesConnections("not json")).toBe(false);
  });
});
