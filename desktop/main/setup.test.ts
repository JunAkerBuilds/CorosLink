import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dateToRef } from "@/data/sync/native";
import { unpackBackup } from "./backup";
import { DevMode } from "./devMode";
import { LocalStore } from "./localStore";
import { backupDue, backupsToRemove, FirstRun, prePicked, sportCounts, type SetupHost } from "./setup";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-setup-"));
const NOW = new Date("2026-11-25T12:00:00Z");
const daysAgo = (d: number) => dateToRef(new Date(NOW.getTime() - d * 86_400_000));
const act = (sport: string, days: number) => ({ body: { sport, start: daysAgo(days) } as Record<string, unknown> });

function host(over: Partial<SetupHost> = {}, store: LocalStore | null = null): SetupHost {
  return { store: () => store, realStore: () => store, loginItem: null, existingInstall: false, showOnLaunch: true, log: () => {}, ...over };
}

describe("setupDone", () => {
  it("is off on a new install, shows at launch, and is remembered once done", () => {
    const dir = folder();
    const first = new FirstRun(dir, host());
    expect(first.state(NOW)).toMatchObject({ setupDone: false, showOnLaunch: true });
    first.change({ setupDone: true });
    expect(new FirstRun(dir, host()).state(NOW)).toMatchObject({ setupDone: true, showOnLaunch: false });
  });

  it("isn't asked of an install that already had data", () => {
    expect(new FirstRun(folder(), host({ existingInstall: true })).done).toBe(true);
  });

  it("can be run again: setting it back off shows it at the next launch", () => {
    const dir = folder();
    new FirstRun(dir, host({ existingInstall: true })).change({ setupDone: false });
    expect(new FirstRun(dir, host({ existingInstall: true })).state(NOW).showOnLaunch).toBe(true);
  });

  it("never takes over the screens a smoke run opens", () => {
    expect(new FirstRun(folder(), host({ showOnLaunch: false })).state(NOW).showOnLaunch).toBe(false);
  });

  it("starts over from a damaged file", () => {
    const dir = folder();
    writeFileSync(path.join(dir, "setup.json"), "{not json");
    expect(new FirstRun(dir, host()).state(NOW)).toMatchObject({ setupDone: false, sports: null, weeklyBackup: false });
  });

  it("keeps only known sports, in the tiles' order", () => {
    const dir = folder();
    new FirstRun(dir, host()).change({ sports: ["lift", "curling", "run"] });
    expect(new FirstRun(dir, host()).state(NOW).sports).toEqual(["run", "lift"]);
  });

  it("puts the app at login through the host, and says null where it can't", () => {
    let on = false;
    const run = new FirstRun(folder(), host({ loginItem: { get: () => on, set: (v) => { on = v; } } }));
    run.change({ openAtLogin: true });
    expect(run.state(NOW).openAtLogin).toBe(true);
    expect(new FirstRun(folder(), host()).state(NOW).openAtLogin).toBeNull();
  });
});

describe("your sports", () => {
  it("counts the last six months by tile, leaving out walks and older workouts", () => {
    const counts = sportCounts([act("run", 1), act("indoorRun", 3), act("trailRun", 10), act("bike", 2), act("walk", 1), act("run", 200), act("strength", 5), { body: { sport: "run" } }], NOW);
    expect(counts).toEqual({ run: 2, trail: 1, ride: 1, lift: 1 });
  });

  it("picks the sports done regularly, not the odd one", () => {
    expect(prePicked({ run: 86, trail: 9, ride: 41, lift: 58, hike: 4, hybrid: 3 })).toEqual(["run", "ride", "lift"]);
    expect(prePicked({ swim: 3 })).toEqual([]);
    expect(prePicked({})).toEqual([]);
  });

  it("reads them from the store the app shows: the sample athlete's while sample data is on", () => {
    const dir = folder(), real = new LocalStore(path.join(dir, "clink.db"));
    const dev = new DevMode(dir, real, { devMode: false, sample: false });
    const run = new FirstRun(dir, host({ store: () => dev.current.store, realStore: () => real }));
    expect(run.state(new Date()).found).toEqual({});
    dev.set({ sample: true });
    const state = run.state(new Date());
    expect(Object.keys(state.found).length).toBeGreaterThan(0);
    expect(state.picked).toContain("run");
    expect(state.data?.activities).toBeGreaterThan(0);
  });
});

describe("sample data from setup", () => {
  it("turns on without developer mode, stays on across launches, and leaving developer mode turns it off", () => {
    const dir = folder(), real = new LocalStore(path.join(dir, "clink.db"));
    new DevMode(dir, real, { devMode: false, sample: false }).set({ sample: true });
    const again = new DevMode(dir, real, { devMode: false, sample: false });
    expect(again.state).toMatchObject({ devMode: false, sample: true });
    again.set({ devMode: false });
    expect(again.state.sample).toBe(false);
  });
});

describe("weekly backup", () => {
  it("is due a week after the last one", () => {
    expect(backupDue(null, NOW)).toBe(true);
    expect(backupDue(new Date(NOW.getTime() - 6 * 86_400_000).toISOString(), NOW)).toBe(false);
    expect(backupDue(new Date(NOW.getTime() - 7 * 86_400_000).toISOString(), NOW)).toBe(true);
    expect(backupDue("garbage", NOW)).toBe(true);
  });

  it("removes only its own older backups past the newest four", () => {
    const names = ["C-LINK weekly 2026-10-01.clinkbackup", "C-LINK weekly 2026-10-08.clinkbackup", "C-LINK weekly 2026-10-15.clinkbackup",
      "C-LINK weekly 2026-10-22.clinkbackup", "C-LINK weekly 2026-10-29.clinkbackup", "C-LINK backup 2026-01-01.clinkbackup", "notes.txt"];
    expect(backupsToRemove(names)).toEqual(["C-LINK weekly 2026-10-01.clinkbackup"]);
  });

  it("writes the real data to the folder when on, and not again within the week", async () => {
    const dir = folder(), backups = path.join(dir, "out");
    const real = new LocalStore(path.join(dir, "clink.db"));
    real.seed([{ collection: "feel.check", id: "2026-11-21", body: { feel: 4 } }]);
    const run = new FirstRun(dir, host({ backupFolder: backups }, real));
    expect(await run.backUpIfDue(NOW)).toBeNull(); // off
    run.change({ weeklyBackup: true });
    // Turning it on backs up straight away.
    for (let i = 0; i < 40 && !run.state(NOW).lastBackupAt; i++) await new Promise((r) => setTimeout(r, 50));
    const files = readdirSync(backups);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^C-LINK weekly \d{4}-\d{2}-\d{2}\.clinkbackup$/);
    expect((await unpackBackup(readFileSync(path.join(backups, files[0])))).items).toHaveLength(1);
    expect(await run.backUpIfDue(new Date())).toBeNull();
    expect(existsSync(path.join(dir, "setup.json"))).toBe(true);
  });
});
