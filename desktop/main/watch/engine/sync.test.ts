// A whole sync over the stand-in watch (watchData.fake.ts), as the CorosKit helper's Syncer.sync runs it: what is read,
// the items handed back, what is kept for the next sync, and that a failing step leaves the rest running.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describe as describeWatch } from "./engine";
import { Kept } from "./kept";
import { sync, type SyncResult } from "./sync";
import { SyncRefused } from "./transport";
import { decodeHealth } from "./watchHealth";
import { fakeSession, FakeWatch } from "./watchData.fake";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name));
const folders: string[] = [];
afterEach(() => { for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true }); });

function setup(watch = new FakeWatch()) {
  watch.dailyHistory = fixture("health-daily-1.bin");
  watch.sportRecordFile = fixture("sport-record-synthetic.bin");
  const { session } = fakeSession(watch);
  const folder = mkdtempSync(path.join(tmpdir(), "clink-sync-"));
  folders.push(folder);
  const events: Record<string, unknown>[] = [];
  const run = (changes: { id: string; body: string }[] = []): Promise<SyncResult> => sync(
    { session, info: () => watch.info, isConnected: () => watch.isConnected, describe: describeWatch, emit: (e) => events.push(e) },
    { kept: new Kept(folder), changes, weather: null },
  );
  return { watch, session, folder, events, run };
}

const body = (r: SyncResult, collection: string) => JSON.parse(r.items.find((i) => i.collection === collection)!.body) as Record<string, unknown>;

describe("sync", () => {
  it("hands back the iPhone's items and keeps the watch's files", async () => {
    const { watch, folder, events, run } = setup();
    const result = await run();
    expect(result.problems).toEqual([]);
    // Daily history, the settings file (for the sleep profile and satellite mode, then again for the goals, as
    // CorosKit's readUserInfo reads it), sport records: 4 KB blocks from the start.
    expect(watch.reads).toEqual([[5, 0], [5, 4096], [54, 0], [54, 4096], [54, 8192], [54, 0], [54, 4096], [54, 8192], [14, 0], [14, 4096]]);
    expect(result.items.map((i) => i.collection).filter((c, i, all) => all.indexOf(c) === i)).toEqual(["activity.detail", "health.day", "health.night", "watch.state"]);
    // The synthetic run is a 20 s blip: no `activity`, but its detail (workouts.test.ts checks the bodies).
    expect(result.items.filter((i) => i.collection === "activity.detail").map((i) => i.id)).toEqual(["coros-1767247200-0"]);
    expect(result.workouts).toBe(1);
    expect(result.healthDays).toBeGreaterThan(0);

    const state = body(result, "watch.state");
    expect(state).toMatchObject({
      via: "computer", name: "COROS PACE Pro", model: "PACE Pro", firmware: "3.2008.0",
      goals: { calories: 500 }, gpsModes: ["all", "dual"], sleepSchedule: { bedtime: 1380, wake: 420 },
      storage: { totalBytes: 34_359_738_368, usedBytes: 34_359_738_368 - 22_350_000_000 },
    });
    expect(state.alarms).toEqual([]);
    expect((state.battery as { percent: number }).percent).toBeTypeOf("number");

    // Kept for next time, in the helper's layout.
    const kept = new Kept(folder);
    expect(kept.read(kept.dailyHistory)!.equals(watch.dailyHistory)).toBe(true);
    expect(kept.read(kept.sportRecords)!.equals(watch.sportRecordFile)).toBe(true);
    expect(kept.details()).toEqual(new Set(["coros-1767247200-0"]));
    expect(decodeHealth(kept.read(kept.healthFile)!.toString()).insights.days.length).toBe(result.healthDays);
    expect(events.filter((e) => e.event === "progress" && e.percent === undefined).map((e) => e.step))
      .toEqual(["steps", "health", "settings", "profile", "goals", "alarms", "storage", "workouts"]);
  });

  it("reads only what's new and sends each detail once", async () => {
    const { watch, run } = setup();
    await run();
    watch.reads = [];
    const again = await run();
    expect(again.items.some((i) => i.collection === "activity.detail")).toBe(false);
    // The first block is checked against the stored copy, then only from its last page on (here the same blocks:
    // the files are two pages).
    expect(watch.reads.filter(([f]) => f !== 54)).toEqual([[5, 0], [5, 4096], [14, 0], [14, 4096]]);
  });

  it("goes on past a step the watch refuses", async () => {
    const { watch, run } = setup();
    watch.failReads = [new SyncRefused(0x16)];
    const result = await run();
    expect(result.problems).toEqual(["health: The watch is busy with a workout or another sync. C-LINK reads it again later."]);
    expect(result.items.some((i) => i.collection === "activity.detail")).toBe(true);
    expect(result.items.at(-1)?.collection).toBe("watch.state");
  });

  it("applies the web's changes first", async () => {
    const { run } = setup();
    const result = await run([{ id: "goal.calories", body: JSON.stringify({ key: "goal.calories", value: 650 }) }, { id: "x", body: "{}" }]);
    expect(result.refused).toContain("x");
    expect(result.applied.length + result.refused.length).toBe(2);
  });
});
