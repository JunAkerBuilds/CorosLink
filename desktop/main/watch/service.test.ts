import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStore } from "../localStore";
import type { Sealer } from "../secrets";
import { LineDriver } from "./lineDriver";
import { LocalWatch } from "./service";

/** A stand-in for the CorosKit helper: answers each command from `answers`, and remembers what it was sent. */
function fakeHelper(answers: Record<string, (req: Record<string, unknown>) => unknown>) {
  const sent: Record<string, unknown>[] = [];
  const spawner = () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    const stdout = new PassThrough(), stderr = new PassThrough();
    const stdin = new Writable({
      write(chunk: Buffer, _enc, done) {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          const req = JSON.parse(line) as Record<string, unknown>;
          sent.push(req);
          const answer = answers[String(req.cmd)];
          setImmediate(() => {
            try { stdout.write(JSON.stringify({ id: req.id, ok: true, result: answer ? answer(req) : {} }) + "\n"); }
            catch (error) { stdout.write(JSON.stringify({ id: req.id, ok: false, error: (error as Error).message }) + "\n"); }
          });
        }
        done();
      },
    });
    Object.assign(child, { stdin, stdout, stderr, kill: () => { setImmediate(() => child.emit("exit", null, "SIGTERM")); return true; } });
    return child;
  };
  return { spawner, sent };
}

// Sealing that is visibly not the plain text, so the test can tell the key was sealed.
const sealer: Sealer = {
  encrypt: async (text) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decrypt: async (data) => ({ text: Buffer.from(data.toString().slice(7), "base64").toString(), stale: false }),
};

const KEY = JSON.stringify({ accountUserId: 1, unit: 0, dataCollectSwitch: 0, privateKeyDER: "AAAA" });
const info = { name: "COROS PACE Pro 2F1A6C", display: "PACE Pro 2F1A6C", model: "PACE Pro", firmware: "V3.2206.0", battery: 54 };
const body = (o: object) => JSON.stringify(o);
const ask = (watch: LocalWatch, route: string, json?: object) => watch.answer(new Request(`clink://app/api/desktop/watch${route}`, json ? { method: "POST", body: JSON.stringify(json) } : undefined));
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("Local mode's watch", () => {
  let dir: string;
  let store: LocalStore;
  let local = true;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "clink-watch-")); store = new LocalStore(path.join(dir, "clink.db")); local = true; });
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  const make = (answers: Record<string, (req: Record<string, unknown>) => unknown>) => {
    const helper = fakeHelper({ hello: () => ({ bluetooth: "ready" }), ...answers });
    const watch = new LocalWatch(dir, { store: () => store, sealer, localMode: () => local, engine: (onEvent, onLog) => new LineDriver(helper.spawner, onEvent, onLog), log: () => undefined });
    return { watch, sent: helper.sent };
  };

  it("keeps only the watch key from the COROS sign-in, sealed", async () => {
    const { watch, sent } = make({ signIn: () => ({ key: KEY, account: "a•••@example.com" }) });
    const status = await (await ask(watch, "/signin", { email: "a@example.com", password: "secret", region: "eu" })).json() as { keySaved: boolean; account: string };
    expect(status.keySaved).toBe(true);
    expect(status.account).toBe("a•••@example.com");
    const sealed = readFileSync(path.join(dir, "watch", "key.bin"), "utf8");
    expect(sealed.startsWith("sealed:")).toBe(true);
    expect(sealed).not.toContain("AAAA");
    // Nothing kept on disk holds the password.
    expect(readFileSync(path.join(dir, "watch", "pairing.json"), "utf8")).not.toContain("secret");
    expect(sent.find((r) => r.cmd === "signIn")).toMatchObject({ region: "eu", takeOver: false });
    watch.stop();
  });

  it("won't pair or sync outside Local mode", async () => {
    local = false;
    const { watch } = make({});
    const answer = await ask(watch, "/pair", { name: "COROS PACE Pro 2F1A6C" });
    expect(answer.status).toBe(400);
    expect(((await answer.json()) as { error: { message: string } }).error.message).toMatch(/Local mode/);
    watch.stop();
  });

  it("pairs with the saved key, then syncs what the watch read into the store as a phone would", async () => {
    const { watch, sent } = make({
      signIn: () => ({ key: KEY, account: "a•••@example.com" }),
      connect: () => info,
      sync: (req) => ({
        items: [
          { collection: "activity", id: "w1", body: body({ id: "w1", name: "Run", sport: "run" }) },
          { collection: "health.day", id: "2026-11-23", body: body({ day: { year: 2026, month: 11, day: 23 }, steps: 9000 }) },
          { collection: "watch.state", id: "me", body: body({ name: "PACE Pro 2F1A6C", via: "computer", syncedAt: 1 }) },
        ],
        applied: (req.changes as { id: string }[]).filter((c) => c.id === "goal.calories").map((c) => c.id),
        refused: (req.changes as { id: string }[]).filter((c) => c.id === "gpsMode").map((c) => c.id),
        problems: [], watch: info, workouts: 1, healthDays: 1, nights: 0,
      }),
    });
    // Waiting on the Watch page: a calorie goal the watch takes, and a mode it refuses.
    store.write([
      { collection: "watch.change", id: "goal.calories", body: { value: 650, at: 0, from: "web" } },
      { collection: "watch.change", id: "gpsMode", body: { value: "dual", at: 0, from: "web" } },
    ]);
    await ask(watch, "/signin", { email: "a@example.com", password: "x", region: "us" });
    await ask(watch, "/pair", { name: "COROS PACE Pro 2F1A6C" });
    await settle();

    // The key goes to the helper with connect, and only there.
    expect(sent.find((r) => r.cmd === "connect")).toMatchObject({ name: "COROS PACE Pro 2F1A6C", key: KEY });
    expect(sent.filter((r) => r.cmd !== "connect").some((r) => JSON.stringify(r).includes("AAAA"))).toBe(false);

    expect(store.list("activity").map((a) => a.id)).toEqual(["w1"]);
    expect(store.count("health.day")).toBe(1);
    // Both changes are done with: written, or refused and said so in watch.state.
    expect(store.list("watch.change")).toEqual([]);
    const state = store.list("watch.state")[0].body as { via: string; refused: { key: string }[] };
    expect(state.via).toBe("computer");
    expect(state.refused.map((r) => r.key)).toEqual(["gpsMode"]);

    const status = await (await ask(watch, "")).json() as { paired: { display: string }; lastSync: { newActivities: number; applied: number; refused: number } };
    expect(status.paired.display).toBe("PACE Pro 2F1A6C");
    expect(status.lastSync).toMatchObject({ newActivities: 1, applied: 1, refused: 1 });
    watch.stop();
  });

  it("keeps a change made again during the sync", async () => {
    let bumped = false;
    const { watch } = make({
      signIn: () => ({ key: KEY, account: "a" }),
      connect: () => info,
      sync: () => {
        // The athlete changes the goal again while the watch is being read.
        if (!bumped) { bumped = true; store.write([{ collection: "watch.change", id: "goal.calories", body: { value: 700, at: 1, from: "web" } }]); }
        return { items: [], applied: ["goal.calories"], refused: [], problems: [], watch: info, workouts: 0, healthDays: 0, nights: 0 };
      },
    });
    store.write([{ collection: "watch.change", id: "goal.calories", body: { value: 650, at: 0, from: "web" } }]);
    await ask(watch, "/signin", { email: "a@example.com", password: "x", region: "us" });
    await ask(watch, "/pair", { name: "COROS PACE Pro 2F1A6C" });
    await settle();
    expect(store.list("watch.change").map((c) => c.body.value)).toEqual([700]);
    watch.stop();
  });

  it("forgets the key and the pairing together", async () => {
    const { watch } = make({ signIn: () => ({ key: KEY, account: "a" }) });
    await ask(watch, "/signin", { email: "a@example.com", password: "x", region: "us" });
    await ask(watch, "/forget-key", {});
    expect(existsSync(path.join(dir, "watch", "key.bin"))).toBe(false);
    const status = await (await ask(watch, "")).json() as { keySaved: boolean; paired: unknown };
    expect(status).toMatchObject({ keySaved: false, paired: null });
    watch.stop();
  });

  it("takes only the auto-sync choices the page offers", async () => {
    const { watch } = make({});
    expect((await ask(watch, "/autosync", { minutes: 7 })).status).toBe(400);
    expect(((await (await ask(watch, "/autosync", { minutes: 15 })).json()) as { autoSyncMinutes: number }).autoSyncMinutes).toBe(15);
    expect((await ask(watch, "/autosync", { minutes: 180 })).status).toBe(400);
    watch.stop();
  });
  it("changes the watch's own settings through the helper, checking what the page sends", async () => {
    const switches = [{ key: "doNotDisturb", value: 1, values: { 0: "Off", 1: "On" }, edit: [1, 0] }];
    const { watch, sent } = make({
      signIn: () => ({ key: KEY, account: "a•••@example.com" }),
      connect: () => info,
      sync: () => ({ items: [], applied: [], refused: [], problems: [], watch: info, workouts: 0, healthDays: 0, nights: 0 }),
      settings: () => ({ switches, profile: { maxHR: 190 }, sleep: { bedtime: 1380, wake: 420 }, problems: [] }),
      setSwitch: (req) => ({ switches: [{ ...switches[0], value: req.value }] }),
      setProfile: (req) => ({ profile: { maxHR: req.maxHR } }),
      setSleep: (req) => ({ sleep: { bedtime: req.bedtime, wake: req.wake } }),
      ring: () => ({ status: 1 }),
    });
    // Not paired yet: nothing reaches the watch.
    expect((await ask(watch, "/settings")).status).toBe(400);
    await ask(watch, "/signin", { email: "a@example.com", password: "x", region: "us" });
    await ask(watch, "/pair", { name: "COROS PACE Pro 2F1A6C" });
    await settle();

    expect(((await (await ask(watch, "/settings")).json()) as { sleep: unknown }).sleep).toEqual({ bedtime: 1380, wake: 420 });
    expect(((await (await ask(watch, "/setting", { key: "doNotDisturb", value: 0 })).json()) as { switches: { value: number }[] }).switches[0].value).toBe(0);
    expect((await ask(watch, "/setting", { key: "do-not; disturb", value: 0 })).status).toBe(400);
    expect((await ask(watch, "/setting", { key: "doNotDisturb", value: 1.5 })).status).toBe(400);
    expect((await ask(watch, "/profile", { maxHR: 188, zoneType: "reserve" })).status).toBe(200);
    expect(sent.find((r) => r.cmd === "setProfile")).toMatchObject({ maxHR: 188, zoneType: "reserve" });
    expect((await ask(watch, "/profile", { maxHR: "fast" })).status).toBe(400);
    expect((await ask(watch, "/profile", { zoneType: "lactate" })).status).toBe(400);
    expect((await ask(watch, "/sleep", { bedtime: 1380, wake: 1440 })).status).toBe(400);
    expect(((await (await ask(watch, "/sleep", { bedtime: 1350, wake: 390 })).json()) as { sleep: unknown }).sleep).toEqual({ bedtime: 1350, wake: 390 });
    expect(((await (await ask(watch, "/ring", {})).json()) as { status: number }).status).toBe(1);

    // Outside Local mode the watch isn't touched.
    local = false;
    expect((await ask(watch, "/ring", {})).status).toBe(400);
    watch.stop();
  });
  it("keeps the weather place rounded, sends it with each sync, and installs faces through the helper", async () => {
    const slots = { slots: [{ slot: 0, faceId: 7 }, { slot: 1 }], shown: 0 };
    const { watch, sent } = make({
      signIn: () => ({ key: KEY, account: "a•••@example.com" }),
      connect: () => info,
      sync: () => ({ items: [], applied: [], refused: [], problems: [], watch: info, workouts: 0, healthDays: 0, nights: 0, weatherSent: true }),
      weather: () => ({ sent: true }),
      faces: () => slots,
      showFace: (req) => ({ ...slots, shown: req.slot }),
      install: (req) => {
        // The BIN reaches the helper as a file, never in the message.
        expect(readFileSync(String(req.path)).toString()).toBe("BIN");
        return { slots: [{ slot: 0, faceId: 7 }, { slot: 1, faceId: 9 }], shown: 0, installed: 1 };
      },
    });
    await ask(watch, "/signin", { email: "a@example.com", password: "x", region: "us" });
    await ask(watch, "/pair", { name: "COROS PACE Pro 2F1A6C" });
    await settle();

    expect((await ask(watch, "/weather", { place: { latitude: 120, longitude: 0, city: "Nowhere" } })).status).toBe(400);
    const status = (await (await ask(watch, "/weather", { place: { latitude: 27.71723, longitude: 85.32399, city: "Kathmandu" } })).json()) as { weather: unknown; weatherSentAt: string | null };
    expect(status.weather).toEqual({ latitude: 27.72, longitude: 85.32, city: "Kathmandu" });
    expect(status.weatherSentAt).not.toBeNull();
    expect(sent.find((r) => r.cmd === "weather")).toMatchObject({ place: { latitude: 27.72, longitude: 85.32 } });
    await ask(watch, "/sync", {});
    await settle();
    expect(sent.filter((r) => r.cmd === "sync").at(-1)).toMatchObject({ weather: { city: "Kathmandu" } });

    expect(((await (await ask(watch, "/faces")).json()) as { shown: number }).shown).toBe(0);
    expect((await ask(watch, "/faces/show", { slot: 1, faceId: -1 })).status).toBe(400);
    expect(((await (await ask(watch, "/faces/show", { slot: 0, faceId: 7 })).json()) as { shown: number }).shown).toBe(0);
    expect(watch.faceConnection()).toMatchObject({ connected: true, model: "PACE Pro" });
    const done = await watch.installFace(Buffer.from("BIN"), { slot: 1, expectedFaceId: null, replace: false });
    expect(done.installed).toBe(1);
    expect(sent.find((r) => r.cmd === "install")).toMatchObject({ slot: 1, replace: false });
    // The BIN's file is gone once the helper has it.
    expect(existsSync(String(sent.find((r) => r.cmd === "install")!.path))).toBe(false);

    local = false;
    expect(watch.faceConnection().connected).toBe(false);
    watch.stop();
  });
});
