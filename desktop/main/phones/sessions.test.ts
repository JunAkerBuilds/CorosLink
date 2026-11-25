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
});
