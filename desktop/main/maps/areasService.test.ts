import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AreasStatus, MapsWatch, RouteSync } from "../../maps/types";
import type { Sealer } from "../secrets";
import { LineDriver } from "../watch/lineDriver";
import { LocalWatch } from "../watch/service";
import { AreasService, trackIdFor, type RouteForSync } from "./areasService";
import { fakeCoros } from "./areas/testFakes";
import type { AreasDrive } from "./areas/usb";

type Answer = (req: Record<string, unknown>, emit: (event: Record<string, unknown>) => void) => unknown;

/** The CorosKit helper, faked: answers from `answers` (an answer may hold its reply back by returning a promise). */
function fakeHelper(answers: Record<string, Answer>) {
  const sent: Record<string, unknown>[] = [];
  const spawner = () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    const stdout = new PassThrough(), stderr = new PassThrough();
    const emit = (e: Record<string, unknown>) => stdout.write(JSON.stringify(e) + "\n");
    const stdin = new Writable({
      write(chunk: Buffer, _enc, done) {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          const req = JSON.parse(line) as Record<string, unknown>;
          sent.push(req);
          const answer = answers[String(req.cmd)];
          void Promise.resolve().then(() => (answer ? answer(req, emit) : {})).then(
            (result) => emit({ id: req.id, ok: true, result: result ?? {} }),
            (error: Error) => emit({ id: req.id, ok: false, error: error.message }));
        }
        done();
      },
    });
    Object.assign(child, { stdin, stdout, stderr, kill: () => { setImmediate(() => child.emit("exit", null, "SIGTERM")); return true; } });
    return child;
  };
  return { spawner, sent };
}

const sealer: Sealer = {
  encrypt: async (text) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decrypt: async (data) => ({ text: Buffer.from(data.toString().slice(7), "base64").toString(), stale: false }),
};

const info = { name: "COROS PACE Pro 2F1A6C", display: "PACE Pro 2F1A6C", model: "PACE Pro", battery: 54 };
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const route = (n: number): RouteForSync => ({
  id: "r1", name: "Seawall loop", distanceM: 5000, ascentM: 20, descentM: 20, createdAt: "2026-11-24T10:00:00Z",
  points: Array.from({ length: n }, (_, i) => [49.28 + i * 1e-5, -123.12, 10 + i] as [number, number, number]),
});

describe("Maps: the watch, routes and map areas", () => {
  let dir: string;
  let local = true;
  let usb: { root: string; free: number } | null = null;
  let routes: Record<string, RouteForSync> = {};
  const watches: LocalWatch[] = [];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "clink-maps-"));
    local = true; usb = null; routes = { r1: route(3) };
    // A paired watch with a saved key, as the Watch page leaves it.
    mkdirSync(path.join(dir, "watch"), { recursive: true });
    writeFileSync(path.join(dir, "watch", "pairing.json"), JSON.stringify({ paired: { name: info.name, display: info.display, model: "PACE Pro", pairedAt: "2026-11-01T00:00:00Z" }, autoSyncHours: 0 }));
    writeFileSync(path.join(dir, "watch", "key.bin"), await sealer.encrypt("{}"));
  });
  afterEach(() => { for (const w of watches.splice(0)) w.stop(); rmSync(dir, { recursive: true, force: true }); });

  const drive: AreasDrive = {
    status: async () => (usb ? { connected: true, model: "PACE Pro", volume: "COROS PACE PRO", totalBytes: 32e9, freeBytes: usb.free, mapBytes: 0 } : { connected: false }),
    root: async () => usb?.root ?? null,
  };

  const make = (answers: Record<string, Answer>, opts: { watch?: boolean } = {}) => {
    const helper = fakeHelper({ hello: () => ({ bluetooth: "ready" }), connect: () => info, ...answers });
    const watch = new LocalWatch(dir, { store: () => null, sealer, localMode: () => local, engine: (onEvent, onLog) => new LineDriver(helper.spawner, onEvent, onLog), log: () => undefined });
    watches.push(watch);
    const coros = fakeCoros();
    const service = new AreasService({
      folder: path.join(dir, "maps"), watch: () => (opts.watch === false ? null : watch), drive: () => drive,
      route: async (id) => routes[id] ?? null, fetch: coros.fetcher,
    });
    const ask = async <T>(method: string, sub: string, body?: object) => {
      const answer = await service.answer(new Request(`clink://app/api/desktop/maps${sub}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), sub);
      return { status: answer!.status, body: (await answer!.json()) as T };
    };
    return { service, watch, ask, sent: helper.sent, coros };
  };

  it("answers only its own paths", async () => {
    const { service } = make({});
    expect(await service.answer(new Request("clink://app/api/desktop/maps/routes"), "/routes")).toBeNull();
    expect(await service.answer(new Request("clink://app/api/desktop/maps/packages"), "/packages")).toBeNull();
  });

  it("describes the watch: map version and areas per model, the COROS model code", async () => {
    const { ask } = make({});
    const watch = (await ask<MapsWatch>("GET", "/watch")).body;
    // Paired in Local mode is enough: the link connects when a send needs it.
    expect(watch).toMatchObject({ name: "PACE Pro", model: "W332", linked: true, connected: false, usb: false, mapVersion: 5, areas: true });
  });

  it("sends a route with every point, skips one the watch has, and knows it's on the watch", async () => {
    let held = false;
    const { ask, service, sent } = make({
      syncRoute: (req, emit) => {
        const file = JSON.parse(readFileSync(String(req.path), "utf8")) as { points: unknown[]; elevations: number[] };
        expect(file.points).toHaveLength(3);
        expect(file.elevations).toEqual([10, 11, 12]);
        emit({ event: "progress", step: "route", phase: "sending", percent: 50 });
        const already = held;
        held = true;
        return { already, slot: 0, trackId: trackIdFor("r1"), crc: 0xbeef, name: "Seawall loop", pointCount: 3, bytes: 2000,
          inventory: { capacity: 30, full: false, routes: [{ slot: 0, trackId: trackIdFor("r1"), crc: 0xbeef }] } };
      },
      routes: () => ({ capacity: 30, full: false, routes: [{ slot: 0, trackId: trackIdFor("r1"), crc: 0xbeef }, { slot: 1, trackId: "00000000000000aa", crc: 1 }] }),
    });
    expect((await ask<RouteSync>("POST", "/routes/r1/sync")).body.state).toBe("connecting");
    await vi.waitFor(async () => expect((await ask<RouteSync>("GET", "/sync")).body).toMatchObject({ state: "done", already: false, percent: 100 }), { timeout: 3000 });
    expect(service.onWatch("r1")).toBe(true);
    expect(service.onWatch("other")).toBe(false);
    await ask("POST", "/routes/r1/sync");
    await vi.waitFor(async () => expect((await ask<RouteSync>("GET", "/sync")).body).toMatchObject({ state: "done", already: true }), { timeout: 3000 });
    const listed = (await ask<{ routes: { id: string; name: string }[] }>("GET", "/watch/routes")).body.routes;
    expect(listed).toEqual([{ id: trackIdFor("r1"), name: "Seawall loop", crc: 0xbeef }, { id: "00000000000000aa", name: "Route on the watch", crc: 1 }]);
    expect(sent.filter((r) => r.cmd === "connect")).toHaveLength(1);
  });

  it("keeps routes between 2 and 40,000 points, without asking the watch", async () => {
    const { ask, sent } = make({});
    for (const n of [1, 40_001]) {
      routes.r1 = route(n);
      const answer = await ask<{ error: { message: string } }>("POST", "/routes/r1/sync");
      expect(answer.status).toBe(400);
      expect(answer.body.error.message).toMatch(/2 and 40,000/);
    }
    expect(sent.some((r) => r.cmd === "syncRoute")).toBe(false);
    expect((await ask("POST", "/routes/missing/sync")).status).toBe(404);
  });

  it("says plainly when the route library is full", async () => {
    const { ask } = make({ syncRoute: () => { throw new Error("The watch's route library is full (30 routes). Remove a route on your watch, then send this one again."); } });
    await ask("POST", "/routes/r1/sync");
    await settle();
    expect((await ask<RouteSync>("GET", "/sync")).body).toMatchObject({ state: "failed", message: expect.stringMatching(/library is full/) });
  });

  it("cancels a route transfer", async () => {
    let finish: (() => void) | null = null;
    const { ask, sent } = make({
      syncRoute: () => new Promise((_, reject) => { finish = () => reject(new Error("Route sync cancelled.")); }),
      cancel: () => { finish?.(); return { cancelled: true }; },
    });
    await ask("POST", "/routes/r1/sync");
    await settle();
    await ask("POST", "/sync/cancel");
    await settle();
    expect(sent.some((r) => r.cmd === "cancel")).toBe(true);
    expect((await ask<RouteSync>("GET", "/sync")).body.state).toBe("cancelled");
  });

  it("doesn't send routes over USB", async () => {
    local = false;
    usb = { root: path.join(dir, "usb"), free: 1e9 };
    const { ask } = make({});
    const answer = await ask<{ error: { message: string } }>("POST", "/routes/r1/sync");
    expect(answer.status).toBe(400);
    expect(answer.body.error.message).toMatch(/Bluetooth, not its USB cable/);
  });

  it("refuses to remove a Wi-Fi task without a real id, and explains 0x1A", async () => {
    const { ask, sent } = make({ mapRemove: () => { throw new Error("Unplug the watch's USB cable, then cancel the download again."); } });
    for (const taskId of ["", "ÿ".repeat(8), "abc", 42]) {
      const answer = await ask<{ error: { message: string } }>("POST", "/areas/cancel", { taskId });
      expect(answer.status).toBe(400);
      expect(answer.body.error.message).toMatch(/Choose a download/);
    }
    expect(sent.some((r) => r.cmd === "mapRemove")).toBe(false);
    const refused = await ask<{ error: { message: string } }>("POST", "/areas/cancel", { taskId: "Ab3_-xyz" });
    expect(refused.body.error.message).toMatch(/USB cable/);
    expect(sent.find((r) => r.cmd === "mapRemove")).toMatchObject({ taskId: "Ab3_-xyz" });
  });

  it("starts a Wi-Fi download only when the watch is ready, and labels its task", async () => {
    let ready = false;
    const { ask, sent } = make({
      mapReady: () => (ready ? { ready: true, flags: 0, reasons: [] } : { ready: false, flags: 4, reasons: ["Unplug the watch's USB cable."] }),
      mapStart: () => ({ tasks: [] }),
      mapTasks: () => ({ tasks: [{ id: "Ab3_-xyz", state: "queued", status: 2, downloadedBytes: 0, totalBytes: 3000, errorCode: 0 }] }),
    });
    const preview = (await ask<{ id: string; sizeBytes: number }>("POST", "/areas/preview", { tiles: [{ x: 20, y: 43 }, { x: 21, y: 43 }] })).body;
    expect(preview.sizeBytes).toBe(3000);
    const blocked = await ask<{ error: { message: string } }>("POST", "/areas/start", { previewId: preview.id, label: "Vancouver", via: "wifi" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/USB cable/);
    ready = true;
    const status = (await ask<AreasStatus>("POST", "/areas/start", { previewId: preview.id, label: "Vancouver", via: "wifi" })).body;
    expect(sent.find((r) => r.cmd === "mapStart")).toMatchObject({ taskId: "Ab3_-xyz" });
    expect(status.tasks).toEqual([{ id: "Ab3_-xyz", state: "queued", downloadedBytes: 0, totalBytes: 3000, errorCode: 0, label: "Vancouver" }]);
    expect(status.history[0]).toMatchObject({ label: "Vancouver", via: "wifi", fileCount: 4 });
    // The preview was used up.
    expect((await ask("POST", "/areas/start", { previewId: preview.id, via: "wifi" })).status).toBe(400);
  });

  it("copies areas over USB to the watch's own map folder, then takes them off again", async () => {
    const root = path.join(dir, "usb");
    mkdirSync(path.join(root, "map"), { recursive: true });
    usb = { root, free: 1e9 };
    const { ask } = make({}, { watch: false });
    const preview = (await ask<{ id: string; neededBytes: number }>("POST", "/areas/preview", { tiles: [{ x: 20, y: 43 }] })).body;
    expect(preview.neededBytes).toBe(1500);
    await ask("POST", "/areas/start", { previewId: preview.id, label: "Home", via: "usb" });
    await settle(100);
    const status = (await ask<AreasStatus>("GET", "/areas")).body;
    expect(status.copy).toMatchObject({ state: "done", copiedBytes: 1500, filesDone: 2 });
    expect(status.history[0]).toMatchObject({ label: "Home", via: "usb" });
    const again = (await ask<{ neededBytes: number }>("POST", "/areas/preview", { tiles: [{ x: 20, y: 43 }] })).body;
    expect(again.neededBytes).toBe(0);
    await ask("DELETE", `/areas/history/${status.history[0].id}`);
    expect((await ask<{ neededBytes: number }>("POST", "/areas/preview", { tiles: [{ x: 20, y: 43 }] })).body.neededBytes).toBe(1500);
    expect((await ask<AreasStatus>("GET", "/areas")).body.history).toEqual([]);
  });

  it("refuses map areas on watches that don't take them", async () => {
    writeFileSync(path.join(dir, "watch", "pairing.json"), JSON.stringify({ paired: { name: "COROS VERTIX 2 1234", display: "VERTIX 2", model: "VERTIX 2", pairedAt: "x" }, autoSyncHours: 0 }));
    const { ask } = make({});
    expect((await ask<MapsWatch>("GET", "/watch")).body).toMatchObject({ mapVersion: 4, areas: false, model: "B19" });
    const answer = await ask<{ error: { message: string } }>("POST", "/areas/preview", { tiles: [{ x: 1, y: 1 }] });
    expect(answer.body.error.message).toMatch(/PACE 4, PACE 4 Pro, PACE Pro and APEX 4/);
  });
});
