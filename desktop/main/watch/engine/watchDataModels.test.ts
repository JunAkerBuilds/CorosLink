// The watch data models against CorosKit's own expectations: WatchDataTests (settings file, goals, profile, stored
// copies), WatchAlarmTests, WatchStorageTests, WatchFindingTests and SyncBodiesTests' SyncWatchChange suite, with
// the shared sync vectors (C-LINK docs/sync-fixtures.json, copied to fixtures/sync-watch-changes.json).
import { describe, expect, it } from "vitest";
import { canonical } from "../../../../src/data/sync/canonical";
import fixtures from "./fixtures/sync-watch-changes.json";
import { crc16Ccitt, crc32, put32, sum8, u16, u32 } from "./bytes";
import { blockHeader, encodeDataFile } from "./dataFile";
import {
  alarm, alarmDays, alarmFrame, alarmRecord, clearPayload, contractDays, DAY, daysFromContract, decodeAlarms, EVERY_DAY, isAcknowledgement, isOnce,
  READ_OPCODE, READ_REQUEST, WRITE_OPCODE, writePayload, type WatchAlarm,
} from "./alarms";
import { satelliteChoices, supportsOn, targetNamed, PACE_PRO } from "./models";
import { WatchProfile } from "./profile";
import { varint } from "./protobuf";
import { checkWrite, checksumHolds, chunkRange, differences, gpsModeName, isModeChange, restoringFile, satelliteModeNamed, satelliteModeOf, satelliteSettingsFile } from "./satellite";
import { encodeSettingsFile, SAMPLE_GLOBAL, userInfo } from "./settingsFile";
import { decodeStorage, storageOther, storageUsed } from "./storage";
import { sleepScheduleOf, SyncUserInfo } from "./userInfo";
import { FINDING_OPCODE, FINDING_REQUEST, nextOffset } from "./watchData";
import { alarmPlan, parseWatchChange, watchChangeBody, WATCH_CHANGE_KEYS, needsWatch, type ChangeAlarm } from "./watchChange";

const hex = (text: string) => Buffer.from(text.replace(/\s+/g, ""), "hex");
const bytes = (b: Uint8Array) => [...b];

describe("data files (WatchDataFile)", () => {
  it("writes the HF header and the block header", () => {
    const body = Buffer.from("weather");
    const file = encodeDataFile(body, 80);
    expect(bytes(file.subarray(0, 4))).toEqual([0x48, 0x46, 0, 80]);
    expect(u32(file, 8)).toBe(body.length);
    expect(u16(file, 12)).toBe(crc16Ccitt(body));
    expect(u16(file, 14)).toBe(crc16Ccitt(file.subarray(0, 14)));
    const header = blockHeader(80, file, 0, file.length);
    expect(bytes(header.subarray(0, 3))).toEqual([0x78, 0, 80]);
    expect([u32(header, 3), u16(header, 7), u32(header, 9)]).toEqual([0, file.length, file.length]);
    expect(bytes(header.subarray(16, 20))).toEqual([0, 0, 0, 3]);
    expect(header[20]).toBe(sum8(header.subarray(2, 20)));
  });
});

describe("SyncUserInfo (daily goals)", () => {
  // CorosLink's goal-test-vectors.py: 175 cm, 70 kg, 35 years, 10,000 steps, 500 kcal, 30 min, phone "iPhone".
  const goalProfile = hex(`AF 46 23 10 27 00 00 F4 01 00 00 08 07 00 00 85 98 A2 AB 72 B5 FF FF FF FF EF CD AB 89 67 45
    23 01 69 50 68 6F 6E 65 00 00 00 00 00 00 00 00 00 00 00 00 00 00 B9 37 17 00 07 00 00 00 00
    00 00 00 00 00 00 00 00 00`);

  it("changes only the goal's bytes", () => {
    const info = new SyncUserInfo(goalProfile);
    expect([info.calorieGoal, info.stepGoal, info.exerciseGoalSeconds]).toEqual([500, 10_000, 1_800]);
    expect(info.looksWritten).toBe(true);
    const edited = info.settingCalorieGoal(650);
    expect(edited.calorieGoal).toBe(650);
    expect(edited.changedOffsets(info)).toEqual([7, 8]);
    expect(bytes(info.settingCalorieGoal(9_999).bytes.subarray(7, 11))).toEqual([0x0f, 0x27, 0, 0]);
    for (const kcal of [0, -1, 10_000]) expect(() => info.settingCalorieGoal(kcal)).toThrow();
    const steps = info.settingStepGoal(8_000);
    expect(steps.stepGoal).toBe(8_000);
    expect(steps.changedOffsets(info)).toEqual([3, 4]);
    expect(bytes(info.settingStepGoal(0).bytes.subarray(3, 7))).toEqual([0, 0, 0, 0]);
    const exercise = info.settingExerciseGoalMinutes(45);
    expect(exercise.exerciseGoalSeconds).toBe(2_700);
    expect(exercise.changedOffsets(info)).toEqual([11, 12]);
    for (const v of [-1, 100_001]) expect(() => info.settingStepGoal(v)).toThrow();
    for (const v of [-1, 1_441]) expect(() => info.settingExerciseGoalMinutes(v)).toThrow();
    expect(SyncUserInfo.fromSettingsFile(encodeSettingsFile(info.bytes)).equals(info)).toBe(true);
    expect(new SyncUserInfo(Buffer.alloc(71)).looksWritten).toBe(false);
    expect(() => new SyncUserInfo(Buffer.alloc(70))).toThrow();
  });
});

describe("WatchProfile (training profile)", () => {
  const v = (value: number) => varint(value);
  const int = (field: number, value: number) => [...v(field << 3), ...v(value)];
  const text = (field: number, value: string) => [...v((field << 3) | 2), value.length, ...Buffer.from(value)];
  const each = (field: number, values: number[]) => values.flatMap((x) => int(field, x));

  it("round-trips and edits", () => {
    const watch = Buffer.from([...each(1, [100, 120, 140, 160, 180]), ...each(2, [130, 150, 165, 175, 185]), ...each(3, [130, 145, 155, 165, 172]),
      ...each(4, [360000, 320000, 300000, 280000, 260000, 240000]), ...each(5, [150, 200, 250, 300, 350]),
      ...int(6, 12345), ...text(7, "Runner"),
      ...int(9, 200), ...int(10, 50), ...int(11, 170), ...int(12, 3), ...int(13, 280000), ...int(14, 300), ...int(15, 250),
      ...each(16, [100, 140, 180, 210, 240, 280]), ...text(17, "V4")]);
    const profile = WatchProfile.decode(watch);
    expect([profile.maxHR, profile.restingHR, profile.thresholdHR, profile.zoneTypeValue, profile.thresholdPace, profile.criticalPower, profile.ftp])
      .toEqual([200, 50, 170, 3, 280000, 300, 250]);
    expect(profile.thresholdHRZones).toEqual([130, 145, 155, 165, 172]);
    expect(profile.passthrough.map((f) => f.number)).toEqual([6, 7, 17]);
    const written = profile.encoded();
    expect(written.length).toBeLessThan(watch.length);
    expect(WatchProfile.decode(written)).toEqual(profile);
    expect(written.includes(Buffer.from("Runner"))).toBe(true);
    expect(written.includes(Buffer.from("V4"))).toBe(true);

    const edited = profile.editing({ maxHR: 190, restingHR: 60, thresholdHR: 175, zoneType: "maxHR", thresholdPace: 266000 });
    expect(edited.maxHRZones).toEqual([95, 114, 133, 152, 171]);
    expect(edited.thresholdHRZones).toEqual([134, 149, 160, 170, 177]);
    expect(edited.reserveHRZones[0]).toBe(Math.round(60 + ((130 - 50) * 130) / 150));
    expect(edited.paceZones[3]).toBe(266000);
    expect(edited.runPowerZones).toEqual(profile.runPowerZones);
    expect(edited.zoneType).toBe("maxHR");
    expect(profile.zoneType).toBe("threshold");
    expect(() => profile.editing({ maxHR: 160 })).toThrow();
    expect(() => profile.editing({ restingHR: 10 })).toThrow();
    expect(() => profile.editing({ thresholdPace: 4 })).toThrow();
  });

  it("lists zones as COROS's app does", () => {
    const profile = WatchProfile.decode(Buffer.from([...each(1, [98, 118, 137, 157, 176]), ...each(2, [131, 155, 171, 177, 188]),
      ...each(3, [140, 158, 166, 179, 186]), ...int(9, 196), ...int(10, 38), ...int(11, 175), ...int(12, 3)]));
    const b = (n: number) => ({ below: n }), m = (x: number, y: number) => ({ between: [x, y] }), a = (n: number) => ({ above: n });
    expect(profile.hrZones.map((z) => z.bpm)).toEqual([b(140), m(140, 158), m(159, 166), m(167, 179), m(180, 186), a(186)]);
    expect(profile.hrZones.map((z) => z.percent)).toEqual([b(80), m(80, 90), m(91, 95), m(96, 102), m(103, 106), a(106)]);
    profile.zoneType = "maxHR";
    expect(profile.hrZones.map((z) => z.percent)).toEqual([b(50), m(50, 60), m(61, 70), m(71, 80), m(81, 90), a(90)]);
    profile.zoneType = "reserve";
    expect(profile.hrZones[0].bpm).toEqual(b(131));
    expect(profile.hrZones.map((z) => z.percent)).toEqual([b(59), m(59, 74), m(75, 84), m(85, 88), m(89, 95), a(95)]);
    profile.restingHR = 0;
    expect(profile.hrZones.length).toBe(6);
    expect(profile.hrZones[0].percent).toBeNull();
    profile.reserveHRZones = [];
    expect(profile.hrZones).toEqual([]);
  });
});

describe("stored copies (WatchSyncFile.nextOffset)", () => {
  it("plans the next read", () => {
    const stored = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));
    const grown = Buffer.concat([stored, Buffer.alloc(3000, 9)]);
    expect(nextOffset(stored, grown.subarray(0, 4096), 0, grown.length)).toBe(8192);
    expect(nextOffset(stored, grown.subarray(8192, 12288), 8192, grown.length)).toBe(12288);
    const changed = Buffer.from(grown); changed[10] = 0xee;
    expect(nextOffset(stored, changed.subarray(0, 4096), 0, changed.length)).toBeNull();
    expect(nextOffset(stored, stored.subarray(0, 4096), 0, 5000)).toBeNull();
  });
});

describe("the settings file", () => {
  const info = (weight: number, schedule: number[]) => {
    const b = Buffer.alloc(71);
    b[0] = 175; b[1] = weight;
    b.set(schedule, 55);
    return b;
  };

  it("gives the sleep schedule", () => {
    const file = encodeSettingsFile(info(82, [22, 30, 6, 45]));
    expect(bytes(file.subarray(0, 4))).toEqual([0x48, 0x46, 0, 54]);
    expect(sleepScheduleOf(userInfo(file))).toEqual({ bedtime: 22 * 60 + 30, wake: 6 * 60 + 45 });
    expect(sleepScheduleOf(info(70, [0, 0, 0, 0]))).toEqual({ bedtime: 0, wake: 0 });
    expect(sleepScheduleOf(info(70, [24, 0, 7, 0]))).toBeNull();
    expect(sleepScheduleOf(info(70, [23, 0, 7, 60]))).toBeNull();
  });

  it("gives the satellite mode", () => {
    const i = info(82, [22, 30, 6, 45]);
    expect(satelliteModeOf(encodeSettingsFile(i))).toBe("dualFrequency");
    for (const [nibble, mode] of [[1, "allSystems"], [2, "standard"], [3, "allSystems"], [0xf, "allSystems"]] as const) {
      const global = Buffer.from(SAMPLE_GLOBAL);
      global[15] = 0x10 | nibble;
      expect(satelliteModeOf(encodeSettingsFile(i, global))).toBe(mode);
    }
    expect(satelliteModeOf(encodeSettingsFile(i, Buffer.alloc(27)))).toBeNull();
    expect(satelliteChoices(PACE_PRO)).toEqual(["allSystems", "dualFrequency"]);
    expect(supportsOn(PACE_PRO, "satelliteMode")).toBe(true);
    for (const id of ["pace-4", "pace-4-pro", "apex-4"]) expect(supportsOn(targetNamed(id), "satelliteMode")).toBe(false);
    expect([gpsModeName("standard"), gpsModeName("allSystems"), gpsModeName("dualFrequency")]).toEqual(["standard", "all", "dual"]);
    expect(["standard", "all", "dual", "x"].map(satelliteModeNamed)).toEqual(["standard", "allSystems", "dualFrequency", null]);
  });

  it("is patched with only the mode changed", () => {
    const file = encodeSettingsFile(info(82, [22, 30, 6, 45]));
    const record = (f: Uint8Array) => { const [s, e] = chunkRange(2, f); return Buffer.from(f.subarray(s + 10, e)); };
    /** The file as the watch would read it back once it stored `newRecord`. */
    const readBack = (f: Buffer, newRecord: Uint8Array) => {
      const body = Buffer.from(f.subarray(16));
      const [s] = chunkRange(2, f);
      body.set(newRecord, s + 10 - 16);
      return encodeDataFile(body, 54);
    };
    expect(checksumHolds(record(file))).toBe(true);
    const patched = satelliteSettingsFile(file, "standard");
    expect(satelliteModeOf(patched)).toBe("standard");
    expect(checksumHolds(record(patched))).toBe(true);
    expect(u32(patched, 4)).toBe(0);
    expect(patched.subarray(16, 28).equals(file.subarray(16, 28))).toBe(true);
    expect(chunkRange(0, patched)[0]).toBe(28);
    const sent = differences(file, patched);
    expect(sent.filter((d) => !d.isGlobal).every((d) => d.change === "missing")).toBe(true);
    const changed = sent.find((d) => d.isGlobal)?.bytes ?? [];
    expect(changed.every((b) => [4, 5, 6, 7, 10, 15].includes(b)) && changed.includes(15)).toBe(true);
    expect(isModeChange(sent.find((d) => d.isGlobal)!)).toBe(true);
    expect(differences(file, satelliteSettingsFile(file, "dualFrequency")).find((d) => d.isGlobal)).toBeUndefined();

    const stored = readBack(file, record(patched));
    expect(checkWrite("standard", file, stored)).toEqual([]);
    expect(checkWrite("allSystems", file, stored).length).toBe(1);
    expect(checkWrite("dualFrequency", file, file).length).toBe(0);
    expect(checkWrite("standard", file, file).length).toBeGreaterThan(0);
    const badSum = record(patched); badSum[4] ^= 1;
    expect(checkWrite("standard", file, readBack(file, badSum)).some((p) => p.includes("CRC-32"))).toBe(true);
    const other = record(patched); other[20] ^= 1;
    put32(other, crc32(other.subarray(8)), 4);
    expect(checkWrite("standard", file, readBack(file, other)).some((p) => p.includes("also changed"))).toBe(true);

    const restore = restoringFile(file);
    expect(record(restore).equals(record(file))).toBe(true);
    expect(satelliteModeOf(restore)).toBe("dualFrequency");
    const odd = encodeSettingsFile(info(82, [22, 30, 6, 45]), Buffer.alloc(29));
    expect(() => satelliteSettingsFile(odd, "standard")).toThrow();
  });

  it("refuses damaged files", () => {
    const file = encodeSettingsFile(info(82, [22, 30, 6, 45]));
    const body = Buffer.from(file); body[80] ^= 1;
    expect(() => userInfo(body)).toThrow();
    const header = Buffer.from(file); header[14] ^= 1;
    expect(() => userInfo(header)).toThrow();
    expect(() => userInfo(file.subarray(0, file.length - 1))).toThrow();
    expect(() => userInfo(encodeDataFile(file.subarray(16), 5))).toThrow();
    expect(() => userInfo(encodeSettingsFile(Buffer.alloc(70)))).toThrow();
    const noSettings = Buffer.concat([Buffer.alloc(12), Buffer.from([3, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4])]);
    expect(() => userInfo(encodeDataFile(noSettings, 54))).toThrow("The watch's settings file has no profile.");
  });
});

describe("alarms (WatchAlarmTests)", () => {
  it("frames the read request", () => {
    expect(bytes(alarmFrame(READ_OPCODE, READ_REQUEST))).toEqual([0xa7, 0x00, 0x02, 0x02]);
  });

  it("writes the worked example", () => {
    const payload = writePayload({ slot: 0, enabled: true, hour: 7, minute: 30, repeatByte: 0x7f });
    expect(bytes(payload)).toEqual([0x00, 0xf0, 0x78, 0x7f]);
    expect(bytes(alarmFrame(WRITE_OPCODE, payload))).toEqual([0x87, 0x00, 0x00, 0xf0, 0x78, 0x7f, 0xe7]);
    expect(bytes(writePayload(alarm(2, true, 19, 33)))).toEqual([0x02, 0x72, 0x86, 0x00]);
    expect(bytes(writePayload(alarm(0, true, 6, 0, EVERY_DAY)))).toEqual([0x00, 0xd0, 0x00, 0xff]);
    expect(isAcknowledgement(Buffer.from([1]))).toBe(true);
    expect(isAcknowledgement(Buffer.from([3]))).toBe(false);
  });

  it("decodes alarms set on a PACE Pro", () => {
    const reply = Buffer.from([0x02, 0x1b, 0xd0, 0x00, 0xff, 0x72, 0x86, 0x00, 0x73, 0x8a, 0xc0, 0x74, 0x92, 0x81, 0x65, 0x96, 0x02,
      0x76, 0x9a, 0x84, 0x77, 0x9e, 0x88, 0x78, 0xa2, 0x90, 0x79, 0xa6, 0xa0]);
    const alarms = decodeAlarms(reply);
    expect(alarms.map((a) => a.slot)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(alarms.map((a) => [a.hour, a.minute])).toEqual([[6, 0], [19, 33], [19, 34], [19, 36], [19, 37], [19, 38], [19, 39], [19, 40], [19, 41]]);
    expect(alarms.map((a) => a.enabled)).toEqual([true, true, true, true, false, true, true, true, true]);
    expect(alarmDays(alarms[0])).toBe(EVERY_DAY);
    expect(isOnce(alarms[1])).toBe(true);
    expect(alarms.slice(2).map(alarmDays)).toEqual([DAY.sunday, DAY.monday, DAY.tuesday, DAY.wednesday, DAY.thursday, DAY.friday, DAY.saturday]);
    expect(Buffer.concat(alarms.map(alarmRecord)).equals(reply.subarray(2))).toBe(true);
    for (const a of alarms.filter((x) => x.enabled)) expect(alarm(a.slot, true, a.hour, a.minute, alarmDays(a))).toEqual(a);
    expect(decodeAlarms(Buffer.from([0x02, 0x00]))).toEqual([]);
    expect(decodeAlarms(Buffer.alloc(0))).toEqual([]);
    expect(() => decodeAlarms(Buffer.from([0x02, 0x02, 0xf0, 0x78]))).toThrow();
  });

  it("refuses out-of-range writes", () => {
    for (const a of [alarm(10, true, 7, 0), alarm(-1, true, 7, 0), alarm(0, true, 24, 0), alarm(0, true, 7, 60)]) expect(() => writePayload(a)).toThrow();
    expect(bytes(clearPayload(3))).toEqual([0x03, 0xe3, 0xff, 0x00]);
    expect(() => clearPayload(10)).toThrow();
  });

  it("maps contract days to the watch's bits (shared vectors)", () => {
    for (const v of fixtures.alarmDays.vectors) {
      expect(alarm(0, true, 7, 0, daysFromContract(v.days)).repeatByte).toBe(v.repeatByte);
      expect(contractDays(v.repeatByte & 0x7f)).toEqual(v.days);
    }
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
    const g = Number(gb);
    expect(s).toEqual({ maps: 4 * g, audio: 0, workouts: 5_000_000, routes: 200_000_000, free: 24 * g, total: 32 * g });
    expect(storageUsed(s)).toBe(8 * g);
    expect(storageOther(s)).toBe(4 * g - 205_000_000);
  });
  it("refuses a failed or short reply", () => {
    expect(() => decodeStorage(reply([1n, 1n, 1n, 1n, 1n, 10n], 0))).toThrow();
    expect(() => decodeStorage(Buffer.from([1, 0, 0]))).toThrow();
    expect(() => decodeStorage(reply([0n, 0n, 0n, 0n, 0n, 0n]))).toThrow();
    expect(() => decodeStorage(reply([8n, 0n, 0n, 0n, 5n, 10n]))).toThrow();
  });
});

describe("Find Watch (WatchFindingTests)", () => {
  it("sends the two bytes the COROS app sends", () => {
    expect(bytes(FINDING_REQUEST)).toEqual([0xb4, 0x00]);
    expect(FINDING_REQUEST[0]).toBe(FINDING_OPCODE);
  });
});

describe("watch.change (SyncWatchChangeTests)", () => {
  it("reads and writes back every fixture change the same", () => {
    const rows = fixtures.watchChanges;
    expect(rows.length).toBe(5);
    const keys = new Set<string>();
    for (const row of rows) {
      const change = parseWatchChange(row.id, row.body);
      expect(change).not.toBeNull();
      expect(canonical(watchChangeBody(change!))).toBe(canonical(row.body));
      expect([change!.at, change!.from]).toEqual([fixtures.now, "web"]);
      keys.add(change!.key);
    }
    expect([...keys].sort()).toEqual([...WATCH_CHANGE_KEYS].sort());
    expect(parseWatchChange("alarms", rows[4].body)?.value).toEqual({ alarms: [{ slot: 0, enabled: true, hour: 6, minute: 30, days: [1, 2, 3, 4, 5] }, { enabled: true, hour: 9, minute: 15, days: [] }] });
    expect(needsWatch(parseWatchChange("goal.steps", rows[2].body)!.key)).toBe(false);
  });

  it("refuses changes that don't fit", () => {
    for (const row of fixtures.watchChangesInvalid) expect(parseWatchChange(row.id, row.body)).toBeNull();
  });

  type Row = { slot?: number; enabled: boolean; hour: number; minute: number; days: number[] };
  const wanted = (r: Row): ChangeAlarm => (r.slot === undefined ? { enabled: r.enabled, hour: r.hour, minute: r.minute, days: r.days } : { ...r });
  const watch = (r: Row): WatchAlarm => alarm(r.slot!, r.enabled, r.hour, r.minute, daysFromContract(r.days));

  it("plans alarms as the shared vectors do", () => {
    const vectors = fixtures.alarmPlans.vectors as unknown as { name: string; slots: number; current: Row[]; wanted: Row[]; fits: boolean; write?: Row[]; clear?: number[] }[];
    expect(vectors.length).toBeGreaterThanOrEqual(6);
    for (const v of vectors) {
      const plan = alarmPlan(v.wanted.map(wanted), v.current.map(watch), v.slots);
      if (!v.fits) { expect(plan, v.name).toBeNull(); continue; }
      expect(plan?.write, v.name).toEqual(v.write!.map(watch));
      expect(plan?.clear.map((a) => a.slot), v.name).toEqual(v.clear);
    }
  });

  it("writes what changed and clears the rest", () => {
    const weekdays = DAY.monday | DAY.tuesday | DAY.wednesday | DAY.thursday | DAY.friday;
    const current = [alarm(0, true, 6, 30, weekdays), alarm(1, true, 8, 0), alarm(4, false, 22, 0)];
    const plan = alarmPlan([{ slot: 0, enabled: true, hour: 6, minute: 30, days: [1, 2, 3, 4, 5] }, { slot: 1, enabled: false, hour: 8, minute: 0, days: [] },
      { enabled: true, hour: 9, minute: 15, days: [0, 6] }], current);
    expect(plan?.write).toEqual([alarm(1, false, 8, 0), alarm(2, true, 9, 15, DAY.saturday | DAY.sunday)]);
    expect(plan?.clear.map((a) => a.slot)).toEqual([4]);
    expect(alarmPlan([], current)?.clear.length).toBe(3);
    expect(alarmPlan(Array.from({ length: 11 }, () => ({ enabled: true, hour: 7, minute: 0, days: [] })), [])).toBeNull();
    expect(alarmPlan([{ slot: 2, enabled: true, hour: 7, minute: 0, days: [] }, { slot: 2, enabled: true, hour: 8, minute: 0, days: [] }], [])).toBeNull();
    expect(alarmPlan([{ slot: 10, enabled: true, hour: 7, minute: 0, days: [] }], [])).toBeNull();
  });
});
