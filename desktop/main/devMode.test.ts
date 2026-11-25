import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DevMode } from "./devMode";
import { LocalStore } from "./localStore";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-dev-"));

describe("developer mode", () => {
  it("keeps sample data in a store of its own, signed in as another viewer", () => {
    const dir = folder(), real = new LocalStore(path.join(dir, "clink.db"));
    const dev = new DevMode(dir, real, { devMode: true, sample: false });
    expect(dev.current.store).toBe(real);
    dev.set({ sample: true });
    expect(dev.current.store).not.toBe(real);
    expect(dev.current.viewer.id).toBe("sample");
    expect(dev.current.store.size).toBeGreaterThan(0);
    expect(real.size).toBe(0); // the real data is never touched
  });

  it("remembers the settings, and turning developer mode off turns sample data off", () => {
    const dir = folder(), real = new LocalStore(path.join(dir, "clink.db"));
    new DevMode(dir, real, { devMode: false, sample: false }).set({ devMode: true, sample: true });
    const again = new DevMode(dir, real, { devMode: false, sample: false });
    expect(again.state).toMatchObject({ devMode: true, sample: true });
    again.set({ devMode: false });
    expect(new DevMode(dir, real, { devMode: true, sample: false }).state).toMatchObject({ devMode: false, sample: false });
  });

  it("resets the sample athlete without touching the real store", () => {
    const dir = folder(), real = new LocalStore(path.join(dir, "clink.db"));
    real.seed([{ collection: "feel.check", id: "2026-11-21", body: { feel: 4 } }]);
    const dev = new DevMode(dir, real, { devMode: true, sample: true });
    const before = dev.current.store.size;
    dev.resetSample();
    expect(dev.current.store.size).toBe(before);
    expect(real.size).toBe(1);
  });

  it("moves the sample athlete to today on the first use of a new day", () => {
    const dir = folder(), real = new LocalStore(path.join(dir, "clink.db"));
    const dev = new DevMode(dir, real, { devMode: true, sample: true });
    const lastActivity = (store: LocalStore) => Math.max(...store.list("activity").map((x) => Number(x.body.start)));
    const monday = dev.sampleAt(new Date(2026, 10, 23, 20, 0));
    const before = lastActivity(monday);
    const later = new DevMode(dir, real, { devMode: true, sample: true }).sampleAt(new Date(2026, 10, 25, 20, 0));
    expect(lastActivity(later) - before).toBeGreaterThan(86_400);
    // The same day again keeps what is there.
    const again = new DevMode(dir, real, { devMode: true, sample: true });
    again.sampleAt(new Date(2026, 10, 25, 21, 0)).write([{ collection: "feel.check", id: "2026-11-25", body: { feel: 4 } }]);
    expect(again.sampleAt(new Date(2026, 10, 25, 22, 0)).count("feel.check")).toBe(1);
  });
});

