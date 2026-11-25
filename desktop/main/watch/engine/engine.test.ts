// The engine's ported pieces against CorosKit's own expectations (its tests and shared vectors).
import { generateKeyPairSync } from "node:crypto";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe as group, expect, it } from "vitest";
import vectors from "./fixtures/coroskit-vectors.json";
import { crc16Ccitt, crc32, crc32Mpeg2, u16, u32 } from "./bytes";
import { syncTime } from "./commands";
import { describe, WatchEngine } from "./engine";
import { displayName, supports, targetForAdvertisedName, targetForModelNumber } from "./models";
import { decodeSettings, encodeSettings, settingsRequest, WatchSwitches } from "./settings";
import { keyChecksum, parseWatchKey, SystemBind } from "./systemBind";
import { createPublicKey } from "node:crypto";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const v = vectors.pairing;
/** The vectors' key as CorosKit's helper saves it (JSONEncoder: Data as base64, the account ID as a number). */
const keyText = `{"accountUserId":${v.accountUserId},"dataCollectSwitch":${v.dataCollectSwitch},"deviceName":"COROS PACE Pro 2F1A6C","privateKeyDER":"${v.privateKeyDer}","unit":${v.unit}}`;

group("bytes", () => {
  it("checksums match their standard check values", () => {
    const check = Buffer.from("123456789");
    expect(crc16Ccitt(check)).toBe(0x29b1);
    expect(crc32Mpeg2(check)).toBe(0x0376e6e7);
    expect(crc32(check)).toBe(0xcbf43926);
    expect(u16(Buffer.from([0x34, 0x12]), 0)).toBe(0x1234);
    expect(u32(Buffer.from([0xff, 0xff, 0xff, 0xff]), 0)).toBe(0xffffffff);
  });
});

group("models", () => {
  it("reads model numbers and names as CorosKit does", () => {
    expect(targetForModelNumber("W332")?.id).toBe("pace-pro");
    expect(targetForModelNumber("COROS W332-3.2008.0")?.id).toBe("pace-pro");
    expect(targetForModelNumber("B19S")?.id).toBe("vertix-2s");
    expect(targetForModelNumber("B19")?.id).toBe("vertix-2");
    expect(targetForModelNumber("COROS R4")?.id).toBe("pace-4");
    expect(targetForModelNumber("COROS W706")?.id).toBe("vertix-4");
    expect(supports({ name: "COROS VERTIX 4 1A2B", modelNumber: "COROS W706", maximumWriteBytes: 20 }, "workouts")).toBe(false); // as CorosKit: not checked yet
    expect(targetForModelNumber("X1")).toBeNull();
    expect(displayName("COROS PACE Pro 2F1A6C")).toBe("COROS PACE Pro");
    expect(targetForAdvertisedName("COROS APEX 4 81D0")?.id).toBe("apex-4");
  });
  it("lists the features a PACE Pro has", () => {
    const info = { name: "COROS PACE Pro 2F1A6C", modelNumber: "COROS W332", softwareRevision: "V3.2206.0", batteryPercent: 78, maximumWriteBytes: 362 };
    expect(supports(info, "workouts")).toBe(true);
    expect(supports({ ...info, modelNumber: "B16", name: "COROS VERTIX 1234" }, "workouts")).toBe(false);
    expect(describe(info)).toEqual({ name: info.name, display: "COROS PACE Pro", model: "PACE Pro", firmware: "3.2206.0", battery: 78,
      features: ["healthSync", "settings", "profile", "clockFormat", "weather", "dailyGoal", "liveWorkout", "workouts", "alarms", "satelliteMode", "gearList"] });
  });
});

group("SystemBind", () => {
  it("signs exactly like CorosKit and CorosLink (shared vectors)", () => {
    const key = parseWatchKey(keyText);
    expect(String(key.accountUserId)).toBe(v.accountUserId); // above 2^53, read without losing digits
    const bind = new SystemBind(key, "COROS PACE Pro 2F1A6C", v.timeZoneSeconds, v.hour12);
    const base = bind.initialPayload(new Date(v.issuedAt * 1000));
    expect(hex(base)).toBe(v.initialPayload);
    // PKCS#1 v1.5 signatures are deterministic, so the same key signs identically.
    expect(hex(bind.authenticatedPayload(base, Buffer.from(v.challenge, "hex")))).toBe(v.authenticatedPayload);
    expect(bind.keyChecksum).toBe(0xe24b);
  });
  it("matches the official app's check bind (CorosKit testBindProfileMatchesTheOfficialApp)", () => {
    const key = parseWatchKey(keyText);
    const base = (twelveHour: boolean, unit = 0, offset = -4 * 3600) =>
      new SystemBind({ ...key, unit }, "COROS PACE Pro 2F1A6C", offset, twelveHour).initialPayload(new Date(1_791_471_375_000));
    expect(hex(base(true).subarray(5, 12))).toBe("8f540418f00021");
    expect(base(false)[11]).toBe(0x20);
    expect(base(false, 1)[11]).toBe(0x22);
    expect(base(true, 0, 20_700)[9]).toBe(23); // Nepal, +5:45.
  });
  it("refuses keys that aren't RSA-2048, and challenges it can't sign", () => {
    const small = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs1", format: "der" }).toString("base64");
    expect(() => new SystemBind({ ...parseWatchKey(keyText), privateKeyDER: small }, "COROS PACE Pro 1")).toThrow(/invalid/);
    expect(() => new SystemBind(parseWatchKey(keyText), "Garmin 1")).toThrow(/COROS/);
    const bind = new SystemBind(parseWatchKey(keyText), "COROS PACE Pro 2F1A6C");
    expect(() => bind.authenticatedPayload(bind.initialPayload(), Buffer.alloc(17))).toThrow(/key update/);
    expect(SystemBind.isBound(Buffer.from([1, ...Array(16).fill(0)]))).toBe(true);
  });
  it("checksums a public key like CorosLink's corosWatchKeyId", () => {
    const der = createPublicKey({ key: Buffer.from(v.privateKeyDer, "base64"), format: "der", type: "pkcs1" }).export({ type: "pkcs1", format: "der" });
    expect(keyChecksum(der)).toBe(0xe24b);
  });
});

group("clock and settings", () => {
  it("carries both offsets, the format and milliseconds (CorosKit testSyncTimeCarriesBothOffsets…)", () => {
    const now = new Date(1_792_386_000_123);
    for (const minutes of [420, 330, -150, -240, 0]) {
      const p = syncTime(now, true, minutes);
      expect(p.length).toBe(9);
      expect(u32(p, 0)).toBe(1_792_386_000 - 1_388_534_400);
      expect(p.readInt8(4)).toBe(Math.trunc(minutes / 30));
      expect(p.readInt8(5)).toBe(Math.trunc(minutes / 15));
      expect(p[6]).toBe(1);
      expect(u16(p, 7)).toBe(123);
    }
    expect(syncTime(now, false, 0)[6]).toBe(0);
  });
  it("reads and writes settings records and switches", () => {
    expect(hex(settingsRequest([31]))).toBe("001f");
    const word = Buffer.alloc(4);
    word.writeUInt32LE(1 << 13, 0); // 12-hour
    const ext = Buffer.alloc(8);
    const reply = decodeSettings(encodeSettings([[0, word], [31, ext]]));
    const switches = new WatchSwitches(reply.get(0)!, reply.get(31), targetForModelNumber("W336"));
    expect(switches.hour12).toBe(true);
    const changed = switches.setting("brightness", 2);
    expect(changed.value("brightness")).toBe(2);
    expect(changed.entries(switches).map(([t]) => t)).toEqual([0, 31]);
    expect(() => switches.setting("batterySaver", 1)).toThrow(/can't make this change/);
    // Long values are split into 255-byte chunks and joined again.
    const long = Buffer.alloc(600, 7);
    expect(decodeSettings(encodeSettings([[10, long]])).get(10)!.equals(long)).toBe(true);
  });
});

/** A clink-ble stand-in: answers each operation from `answers`, records what was asked. */
function fakeBle(answers: (op: Record<string, unknown>) => Record<string, unknown>) {
  const asked: Record<string, unknown>[] = [];
  const spawn = () => {
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
    let buffer = "";
    stdin.on("data", (d: Buffer) => {
      buffer += d;
      for (let i; (i = buffer.indexOf("\n")) >= 0; buffer = buffer.slice(i + 1)) {
        const op = JSON.parse(buffer.slice(0, i)) as Record<string, unknown>;
        asked.push(op);
        stdout.write(JSON.stringify({ id: op.id, ...answers(op) }) + "\n");
      }
    });
    return child;
  };
  return { spawn, asked };
}

group("WatchEngine over clink-ble", () => {
  const state = { phase: "connected", connected: true, deviceName: "COROS PACE Pro 2F1A6C", modelNumber: "COROS W332", softwareRevision: "V3.2206.0", batteryPercent: 78, maximumWriteBytes: 362 };
  const challenge = Buffer.from(v.challenge, "hex");
  const bound = Buffer.from([1, ...Array(16).fill(0)]);

  it("connects, signs in and sets the clock, as the CorosKit helper does", async () => {
    const ble = fakeBle((op) => {
      if (op.operation === "connect") return { result: state };
      if (op.operation === "exchange" && op.opcode === 0xa5) {
        const signed = Buffer.from(String(op.payload), "base64").length > 17;
        return { result: state, payload: (signed ? bound : challenge).toString("base64") };
      }
      if (op.operation === "exchange" && op.opcode === 0xa7) return { result: state, payload: encodeSettings([[0, Buffer.alloc(4)], [31, Buffer.alloc(8)]]).toString("base64") };
      if (op.operation === "exchange" && op.opcode === 0x8c) return { result: state, payload: Buffer.from([1]).toString("base64") };
      return { result: state };
    });
    const events: Record<string, unknown>[] = [];
    const engine = new WatchEngine(ble.spawn, (e) => events.push(e));
    const info = await engine.call<Record<string, unknown>>("connect", { name: "COROS PACE Pro 2F1A6C", key: keyText });
    expect(info.model).toBe("PACE Pro");
    expect(ble.asked.map((o) => `${o.operation}${o.opcode ? `:${Number(o.opcode).toString(16)}` : ""}`))
      .toEqual(["connect", "exchange:a5", "exchange:a5", "exchange:a7", "exchange:8c"]);
    expect(events.map((e) => e.step)).toEqual(["searching", "signingIn"]);
    // The signed reply goes in frames as large as the link takes, up to 240.
    expect(ble.asked[2].maximumWriteBytes).toBe(240);
    expect(await engine.call("status")).toMatchObject({ connected: true, battery: 78 });
    await expect(engine.call("sync")).rejects.toThrow("No folder to keep the watch's files in.");
    await expect(engine.call("setSwitch", { key: "brightness" })).rejects.toThrow("Which setting, and to what?");
    await expect(engine.call("weather", { place: { latitude: 99, longitude: 0 } })).rejects.toThrow("Pick a place for the weather.");
    await expect(engine.call("nope")).rejects.toThrow("Unknown command.");
    expect(await engine.call("cancel")).toEqual({ cancelled: true });
    expect(await engine.call("disconnect")).toEqual({ connected: false });
    await expect(engine.call("faces")).rejects.toThrow("The watch isn't connected.");
  });

  it("disconnects when the watch refuses the account", async () => {
    const ble = fakeBle((op) => op.operation === "exchange" ? { result: state, payload: challenge.toString("base64") } : { result: state });
    const engine = new WatchEngine(ble.spawn, () => {});
    await expect(engine.call("connect", { name: "COROS PACE Pro 2F1A6C", key: keyText })).rejects.toThrow(/key update|rejected/);
    expect(ble.asked.at(-1)?.operation).toBe("disconnect");
    expect(await engine.call("status")).toEqual({ connected: false });
  });

  it("passes clink-ble's refusals on as they are", async () => {
    const ble = fakeBle(() => ({ error: "The watch did not connect. Open System → Pair Phone on the watch.", detail: { site: "worker.rs:1" } }));
    const engine = new WatchEngine(ble.spawn, () => {});
    await expect(engine.call("connect", { name: "COROS PACE Pro 2F1A6C", key: keyText })).rejects.toThrow(/Pair Phone/);
  });
});
