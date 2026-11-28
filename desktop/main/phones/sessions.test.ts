import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PhoneServer } from "./server";
import { PhoneSessions } from "./sessions";

const fresh = () => new PhoneSessions(path.join(mkdtempSync(path.join(tmpdir(), "clink-phones-")), "phones.db"));

describe("PhoneSessions", () => {
  it("keeps one session per phone key when the same phone pairs again", () => {
    const sessions = fresh();
    sessions.pair(sessions.startPairing().secret, "key-a", "iPhone");
    sessions.pair(sessions.startPairing().secret, "key-a", "iPhone");
    sessions.pair(sessions.startPairing().secret, "key-b", "Pixel");
    expect(sessions.list().map((p) => p.jkt)).toEqual(["key-a", "key-b"]);
  });

  it("writes spaces in the computer's name as %20 in the pairing code", () => {
    const server = new PhoneServer({ sessions: fresh(), store: { token: "t", handle: async () => new Response() }, name: "Addys MacBook Pro", appVersion: "0", platform: "darwin" });
    expect(server.pairingLink("S")).toContain("n=Addys%20MacBook%20Pro");
  });

  it("lets a relay credential be spent once, by its own key, before it lapses", () => {
    const sessions = fresh();
    const now = 1_000_000;
    const late = sessions.mintCredential("key-a", now)!;
    expect(sessions.bootstrap(late.credential, "key-a", "iPhone", now + 2 * 60_000)).toBeNull();
    const other = sessions.mintCredential("key-a", now)!;
    expect(sessions.bootstrap(other.credential, "key-b", "iPhone", now)).toBeNull();
    const good = sessions.mintCredential("key-a", now)!;
    expect(sessions.bootstrap(good.credential, "key-a", "iPhone", now)).toMatchObject({ permissions: expect.arrayContaining(["sync:read"]) });
    expect(sessions.bootstrap(good.credential, "key-a", "iPhone", now)).toBeNull();
  });

  it("remembers a removed phone across restarts, and forgets it when the phone scans a new code", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "clink-phones-")), "phones.db");
    const sessions = new PhoneSessions(file);
    // The phone signing itself out isn't a removal.
    sessions.end(sessions.pair(sessions.startPairing().secret, "key-a", "iPhone")!.sessionToken);
    expect(sessions.mintCredential("key-a")).not.toBeNull();
    sessions.pair(sessions.startPairing().secret, "key-a", "iPhone");
    sessions.remove(sessions.list()[0].id);
    const reopened = new PhoneSessions(file);
    expect(reopened.isRemoved("key-a")).toBe(true);
    expect(reopened.mintCredential("key-a")).toBeNull();
    reopened.pair(reopened.startPairing().secret, "key-a", "iPhone");
    expect(reopened.mintCredential("key-a")).not.toBeNull();
  });
});
