import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../localStore";
import { PhoneSync } from "./phoneSync";

let open: { stop(): Promise<void> }[] = [];
afterEach(async () => { await Promise.all(open.map((o) => o.stop())); open = []; });

describe("PhoneSync", () => {
  it("listens on the port phones were given, and on another (saved for next time) when that one is taken", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "clink-phonesync-"));
    const taken: Server = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "0.0.0.0", resolve));
    open.push({ stop: () => new Promise((resolve) => taken.close(() => resolve())) });
    const busyPort = (taken.address() as { port: number }).port;

    const phones = new PhoneSync(path.join(dir, "phones.db"), new LocalStore(path.join(dir, "clink.db")), "0.1.0");
    open.push(phones);
    phones.sessions.port = busyPort;
    await phones.start();
    expect(phones.port).not.toBe(busyPort);
    expect(phones.port).toBeGreaterThan(0);
    expect(phones.sessions.port).toBe(phones.port);
  });
});
