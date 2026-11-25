// Storage and Wi-Fi map tasks against the CorosKit helper's `--map-codecs` checks (checkMapCodecs in Maps.swift) and
// CorosKit's WatchStorageTests; the commands and `activityScreens` on the simulated watch.
import { describe, expect, it } from "vitest";
import { activityScreensCommand } from "./activityScreens";
import {
  decodeReadiness, decodeStorage, decodeTasks, mapReady, mapRemove, mapStart, mapTasks, READINESS_REASONS, removePayload, requireRemoved,
  startPayload, storageCommand, storageOther, storageUsed,
} from "./maps";
import { SimulatedWatch } from "./simulatedWatch";

const ID = "Ab3_-xyz";
const row = () => { const r = Buffer.alloc(39); r[0] = 3; r.write(ID, 1, "latin1"); r[10] = 0x10; r[18] = 0x10; return r; };

describe("map codecs (checkMapCodecs)", () => {
  it("checks task ids", () => {
    expect(() => removePayload("")).toThrow(); // empty id refused
    expect(() => removePayload(Buffer.alloc(8, 0xff).toString("utf8"))).toThrow(); // all-0xFF id refused
    expect(() => removePayload("abc")).toThrow(); // short id refused
  });

  it("builds the start and remove payloads", () => {
    expect(removePayload(ID)).toEqual(Buffer.concat([Buffer.from([5]), Buffer.from(ID)]));
    expect(startPayload(ID)).toEqual(Buffer.concat([Buffer.from([0x0a]), Buffer.from(ID), Buffer.from([0, 0xff, 0xff])]));
    expect(() => startPayload("abc")).toThrow("COROS returned an invalid map download id.");
  });

  it("reads remove answers", () => {
    expect(() => requireRemoved(Buffer.from([1]))).not.toThrow();
    expect(() => requireRemoved(Buffer.from([0x1a]))).toThrow("USB cable");
    expect(() => requireRemoved(Buffer.from([4]))).toThrow("The watch couldn't cancel the download (code 4).");
    expect(() => requireRemoved(Buffer.alloc(0))).toThrow("The watch couldn't cancel the download.");
  });

  it("reads task rows", () => {
    const r = row();
    const tasks = decodeTasks(Buffer.concat([Buffer.from([1, 1]), r]));
    expect(tasks[0]).toEqual({ id: ID, state: "complete", status: 3, downloadedBytes: 16, totalBytes: 16, errorCode: 0 });
    r[33] = 0x02;
    expect(decodeTasks(Buffer.concat([Buffer.from([1, 1]), r]))[0].state).toBe("failed"); // task error
    expect(() => decodeTasks(Buffer.concat([Buffer.from([1, 2]), r]))).toThrow("unsupported map-task list"); // length checked
    const bad = row(); bad[18] = 0x08;
    expect(() => decodeTasks(Buffer.concat([Buffer.from([1, 1]), bad]))).toThrow("invalid map-download sizes");
  });

  it("reads readiness bits", () => {
    expect(decodeReadiness(Buffer.from([1, 0b0000_0101, 0, 0, 0]))).toEqual({ flags: 5, reasons: [READINESS_REASONS[0], READINESS_REASONS[2]] });
    expect(decodeReadiness(Buffer.from([1, 0, 0, 0, 0])).reasons).toEqual([]);
    // Bits 0 and 4 say the same thing once.
    expect(decodeReadiness(Buffer.from([1, 0x11, 0, 0, 0x80])).reasons).toEqual([READINESS_REASONS[0],
      "The watch says downloads aren't available now. Keep it awake and try again shortly."]);
    expect(() => decodeReadiness(Buffer.from([1, 0, 0, 0]))).toThrow("couldn't check");
  });
});

describe("storage (WatchStorageTests)", () => {
  const reply = (sizes: bigint[], status = 1) => {
    const b = Buffer.alloc(1 + sizes.length * 8);
    b[0] = status;
    sizes.forEach((s, i) => b.writeBigUInt64LE(s, 1 + i * 8));
    return b;
  };

  it("decodes the six sizes in the app's order", () => {
    const gb = 1n << 30n;
    const s = decodeStorage(reply([4n * gb, 0n, 5_000_000n, 200_000_000n, 24n * gb, 32n * gb]));
    expect(s).toEqual({ maps: 4n * gb, audio: 0n, workouts: 5_000_000n, routes: 200_000_000n, free: 24n * gb, total: 32n * gb });
    expect(storageUsed(s)).toBe(8n * gb);
    expect(storageOther(s)).toBe(4n * gb - 205_000_000n);
  });

  it("refuses a failed or short reply", () => {
    expect(() => decodeStorage(reply([1n, 1n, 1n, 1n, 1n, 10n], 0))).toThrow();
    expect(() => decodeStorage(Buffer.from([1, 0, 0]))).toThrow();
    expect(() => decodeStorage(reply([0n, 0n, 0n, 0n, 0n, 0n]))).toThrow();
    expect(() => decodeStorage(reply([8n, 0n, 0n, 0n, 5n, 10n]))).toThrow("doesn't add up");
  });

  it("answers like the helper's storage", async () => {
    const watch = new SimulatedWatch();
    expect(await storageCommand(watch.session())).toEqual({ maps: 6_120_000_000, audio: 412_000_000, workouts: 2_400_000, routes: 18_600_000,
      free: 22_350_000_000, total: 34_359_738_368 });
    const session = watch.session();
    session.authenticatedAt = null;
    await expect(storageCommand(session)).rejects.toThrow("Connect and authenticate your watch first.");
  });
});

describe("map commands on the simulated watch", () => {
  const list = Buffer.concat([Buffer.from([1, 1]), row()]);

  it("lists, starts and removes downloads", async () => {
    const watch = new SimulatedWatch();
    watch.mapReplies.set("0bff", list);
    watch.mapReplies.set("19", Buffer.from([1, 0, 0, 0, 0]));
    watch.mapReplies.set(startPayload(ID).toString("hex"), Buffer.from([1]));
    watch.mapReplies.set(removePayload(ID).toString("hex"), Buffer.from([1]));
    const session = watch.session();
    expect((await mapTasks(session)).tasks[0].id).toBe(ID);
    expect(await mapReady(session)).toEqual({ ready: true, flags: 0, reasons: [] });
    expect((await mapStart(session, { taskId: ID })).tasks).toHaveLength(1);
    expect((await mapRemove(session, { taskId: ID })).tasks).toHaveLength(1);
    expect(watch.requests.map(([op, payload]) => `${op.toString(16)} ${payload}`)).toEqual([
      "b6 0bff", "b6 19", "b6 19", `b6 ${startPayload(ID).toString("hex")}`, "b6 0bff", `b6 ${removePayload(ID).toString("hex")}`, "b6 0bff"]);
  });

  it("refuses to start unless the watch is ready, and checks ids first", async () => {
    const watch = new SimulatedWatch();
    watch.mapReplies.set("19", Buffer.from([1, 4, 0, 0, 0]));
    const session = watch.session();
    await expect(mapStart(session, { taskId: ID })).rejects.toThrow("Unplug the watch's USB cable.");
    await expect(mapStart(session, {})).rejects.toThrow("No map download to start.");
    await expect(mapStart(session, { taskId: "x" })).rejects.toThrow("COROS returned an invalid map download id.");
    await expect(mapRemove(session, {})).rejects.toThrow("Choose a download from the watch's list.");
    await expect(mapRemove(session, { taskId: "x" })).rejects.toThrow("Choose a download from the watch's list.");
    expect(watch.requests).toEqual([[0xb6, "19"]]);
  });
});

describe("activityScreens", () => {
  it("reads and writes the activity pages, hex in and out", async () => {
    const watch = new SimulatedWatch();
    watch.replies.set(0x9e, Buffer.from([1, 0xab]));
    watch.replies.set(0x9f, Buffer.from([1]));
    const session = watch.session();
    expect(await activityScreensCommand(session, { op: "read", payload: "00" })).toEqual({ payload: "01ab" });
    expect(await activityScreensCommand(session, { op: "write", payload: "0A0b" })).toEqual({ payload: "01" });
    expect(watch.requests).toEqual([[0x9e, "00"], [0x9f, "0a0b"]]);
  });

  it("checks the request as the helper does", async () => {
    const session = new SimulatedWatch().session();
    const asked = "Which activity pages, read or written?";
    await expect(activityScreensCommand(session, { payload: "00" })).rejects.toThrow(asked);
    await expect(activityScreensCommand(session, { op: "read", payload: "0" })).rejects.toThrow(asked);
    await expect(activityScreensCommand(session, { op: "read", payload: "zz" })).rejects.toThrow(asked);
    await expect(activityScreensCommand(session, { op: "read", payload: "00".repeat(1025) })).rejects.toThrow(asked);
    await expect(activityScreensCommand(session, { op: "delete", payload: "00" })).rejects.toThrow("Activity pages are read or written.");
  });
});
