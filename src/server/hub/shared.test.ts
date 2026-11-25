import { describe, expect, it } from "vitest";
import { readShared, sharedBody, touchesShared, withoutShared } from "./shared";

const session = { accessToken: "TOKEN", userId: "426109589008859136", regionId: "2", baseURL: "https://teameuapi.coros.com" };

describe("the shared Training Hub session", () => {
  it("round-trips, with and without the email", () => {
    expect(sharedBody({ session, email: "me@example.com" })).toEqual({ ...session, email: "me@example.com" });
    expect(sharedBody({ session, email: "" })).toEqual(session);
    expect(readShared({ ...session, email: "me@example.com" })).toEqual({ session, email: "me@example.com" });
    expect(readShared(session)).toEqual({ session, email: "" });
  });

  it("refuses a body that isn't whole or points anywhere but COROS", () => {
    for (const bad of [
      null, "x", [], {},
      { ...session, accessToken: "" }, { ...session, userId: 5 }, { ...session, accessToken: "x".repeat(5000) },
      { ...session, baseURL: "https://evil.example" }, { ...session, baseURL: "https://teameuapi.coros.com.evil.example" },
      { ...session, baseURL: "https://teameuapi.coros.com/" }, { ...session, regionId: 2 },
    ]) expect(readShared(bad)).toBeNull();
  });

  it("is taken out of a pull answer and never passed on", () => {
    const other = { collection: "fuel.entry", id: "A", version: 4, deleted: false, body: { name: "Oats" } };
    const shared = { collection: "hub.session", id: "me", version: 5, deleted: false, body: { ...session, email: "me@example.com" } };
    const pulled = withoutShared({ schemaVersion: 1, items: [other, shared], cursor: 5, more: false });
    expect(pulled.payload).toEqual({ schemaVersion: 1, items: [other], cursor: 5, more: false });
    expect(pulled.change).toEqual({ kind: "session", stored: { session, email: "me@example.com" } });
    expect(JSON.stringify(pulled.payload)).not.toContain("TOKEN");
  });

  it("reads a deletion as signed out everywhere, and says nothing for a body it can't use", () => {
    expect(withoutShared({ items: [{ collection: "hub.session", id: "me", version: 6, deleted: true }], cursor: 6, more: false }))
      .toEqual({ payload: { items: [], cursor: 6, more: false }, change: { kind: "signedOut" } });
    const odd = withoutShared({ items: [{ collection: "hub.session", id: "me", version: 7, body: { ...session, baseURL: "https://evil.example" } },
                                        { collection: "hub.session", id: "other", version: 8, body: session }], cursor: 8, more: false });
    expect(odd).toEqual({ payload: { items: [], cursor: 8, more: false }, change: null });
    expect(withoutShared({ error: { code: "x" } })).toEqual({ payload: { error: { code: "x" } }, change: null });
  });

  it("spots a browser push that tries to write it", () => {
    expect(touchesShared(JSON.stringify({ changes: [{ collection: "fuel.entry", id: "A", body: {} }] }))).toBe(false);
    expect(touchesShared(JSON.stringify({ changes: [{ collection: "fuel.entry", id: "A", body: { note: "hub.session" } }] }))).toBe(false);
    expect(touchesShared(JSON.stringify({ changes: [{ collection: "hub.session", id: "me", deleted: true }] }))).toBe(true);
    expect(touchesShared(JSON.stringify({ changes: [{ collection: "hub.session", id: "me", body: session }] }))).toBe(true);
  });
});
