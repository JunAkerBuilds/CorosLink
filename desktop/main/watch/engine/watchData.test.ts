// The session's data operations over a stand-in watch (watchData.fake.ts, CorosKit's SimulatedWatch), against
// CorosKit's WatchDataTests ("Over a (simulated) link"), WatchAlarmTests, WatchFindingTests and the helper's
// Syncer.apply / Settings answers.
import { beforeEach, describe, expect, it } from "vitest";
import fixtures from "./fixtures/sync-watch-changes.json";
import { CorosError, u32 } from "./bytes";
import { alarm, decodeAlarms, EVERY_DAY, isAcknowledgement, alarmRecord } from "./alarms";
import { chunkRange, satelliteModeOf } from "./satellite";
import { encodeDataFile } from "./dataFile";
import { encodeSettingsFile, userInfo } from "./settingsFile";
import { EXTENDED_SWITCHES } from "./settings";
import { SyncRefused } from "./transport";
import { sleepScheduleOf, SyncUserInfo } from "./userInfo";
import { fakeSession, FakeWatch } from "./watchData.fake";
import {
  clearAlarm, readAlarmBytes, readPedometerBytes, readProfile, readStorage, readSyncFile, readUserInfo, ringWatch, setGoals, setSatelliteMode,
  setSleepSchedule, timing, writeAlarm, writeProfile, writeSwitches,
} from "./watchData";
import { applyChanges, settingsRead, setProfile, setSleep, setSwitch } from "./watchSettings";

const message = async (work: () => Promise<unknown>): Promise<string | null> => {
  try { await work(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
};
const pace4 = () => new FakeWatch("COROS PACE 4 1A2B3C", "W336");
const nomad = () => new FakeWatch("COROS NOMAD 81D0", null);

beforeEach(() => { timing.retryMs = 0; timing.satelliteSettleMs = 0; });

describe("over a simulated link", () => {
  it("reads and writes settings and the profile, and reads the files", async () => {
    const { watch, session } = fakeSession();
    const switches = await session.readSwitches();
    const flipped = switches.setting("wristGesture", switches.value("wristGesture") === 1 ? 0 : 1);
    const stored = await writeSwitches(session, flipped, switches);
    expect(stored.value("wristGesture")).toBe(flipped.value("wristGesture"));

    const profile = await readProfile(session);
    expect(profile.maxHR).toBe(190);
    const written = await writeProfile(session, profile.editing({ restingHR: 50 }));
    expect(written.restingHR).toBe(50);

    expect(u32(await readPedometerBytes(session), 0)).toBe(8_412);

    watch.dailyHistory = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));
    const seen: [number, number][] = [];
    const full = await readSyncFile(session, 5, null, (read, total) => seen.push([read, total]));
    expect(full.equals(watch.dailyHistory)).toBe(true);
    expect(seen).toEqual([[4096, 10_000], [8192, 10_000], [10_000, 10_000]]);
    // The watch appended: only what it gained is read, from the stored copy's last page.
    watch.dailyHistory = Buffer.concat([watch.dailyHistory, Buffer.alloc(3000, 9)]);
    watch.reads = [];
    const grown = await readSyncFile(session, 5, full);
    expect(grown.equals(watch.dailyHistory)).toBe(true);
    expect(watch.reads).toEqual([[5, 0], [5, 8192], [5, 12288]]);

    // About 10 KB: the stand-in sends it in 4 KB blocks.
    const settings = await readSyncFile(session, 54);
    expect(settings.equals(watch.settingsFile)).toBe(true);
    expect(settings.length).toBeGreaterThan(8192);
    expect(sleepScheduleOf(userInfo(settings))).toEqual({ bedtime: 23 * 60, wake: 7 * 60 });
  });

  it("reads the whole file again when the stored copy isn't the watch's", async () => {
    const { watch, session } = fakeSession();
    const stored = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));
    watch.dailyHistory = Buffer.concat([Buffer.alloc(10_000, 1), Buffer.alloc(3000, 9)]);
    expect((await readSyncFile(session, 5, stored)).equals(watch.dailyHistory)).toBe(true);
    expect(watch.reads.map(([, o]) => o)).toEqual([0, 4096, 8192, 12288]);
  });

  it("takes the watch's refusals as CorosKit does", async () => {
    const { watch, session } = fakeSession();
    watch.dailyHistory = Buffer.alloc(5000, 3);
    // 0x14 on the first block: nothing to give.
    watch.failReads = [new SyncRefused(0x14)];
    expect((await readSyncFile(session, 5)).length).toBe(0);
    // Busy: straight back, not asked again.
    watch.failReads = [new SyncRefused(0x16)];
    watch.reads = [];
    await expect(readSyncFile(session, 14)).rejects.toBeInstanceOf(SyncRefused);
    expect(watch.reads.length).toBe(1);
    // Nothing past the start is a refusal like any other.
    watch.reads = [];
    watch.failReads = [];
    const read = watch.readSyncBlock.bind(watch);
    watch.readSyncBlock = async (file, offset) => { if (offset > 0) throw new SyncRefused(0x14); return read(file, offset); };
    await expect(readSyncFile(session, 5)).rejects.toBeInstanceOf(SyncRefused);
    watch.readSyncBlock = read;
    // Another failure is asked again once.
    watch.failReads = [new CorosError("The watch returned invalid or incomplete records.")];
    watch.reads = [];
    expect((await readSyncFile(session, 5)).equals(watch.dailyHistory)).toBe(true);
    expect(watch.reads.map(([, o]) => o)).toEqual([0, 0, 4096]);
    // An empty file is nothing new.
    watch.sportRecordFile = Buffer.alloc(0);
    expect((await readSyncFile(session, 14)).length).toBe(0);
    // A watch that dropped the link.
    watch.isConnected = false;
    expect(await message(() => readSyncFile(session, 5))).toBe("Connect and authenticate your watch first.");
  });

  it("refuses a settings file that changes while it's read", async () => {
    const { watch, session } = fakeSession();
    const first = watch.settingsFile;
    const read = watch.readSyncBlock.bind(watch);
    watch.readSyncBlock = async (file, offset) => {
      const answer = await read(file, offset);
      watch.settingsFile = Buffer.concat([first, Buffer.alloc(10)]);
      return answer;
    };
    expect(await message(() => readSyncFile(session, 54))).toBe("The watch's settings changed while they were being read. Sync again.");
  });

  it("reads back a write whose reply was lost", async () => {
    const { watch, session } = fakeSession();
    const switches = await session.readSwitches();
    watch.loseNextWriteReply = true;
    const stored = await writeSwitches(session, switches.setting("units", 1), switches);
    expect(stored.value("units")).toBe(1);
  });

  it("sets the sleep schedule", async () => {
    const { watch, session } = fakeSession();
    const before = await readUserInfo(session);
    expect(before.sleepSchedule).toEqual({ bedtime: 23 * 60, wake: 7 * 60 });
    const after = await setSleepSchedule(session, { bedtime: 22 * 60 + 30, wake: 6 * 60 + 15 });
    expect(after.changedOffsets(before)).toEqual([55, 56, 57, 58]);
    expect([...after.bytes.subarray(55, 59)]).toEqual([22, 30, 6, 15]);
    expect(after.calorieGoal).toBe(500);
    expect(sleepScheduleOf(userInfo(watch.settingsFile))).toEqual({ bedtime: 22 * 60 + 30, wake: 6 * 60 + 15 });
    expect(await message(() => setSleepSchedule(session, { bedtime: 600, wake: 600 }))).toBe("Choose a wake time different from the bedtime.");
    expect(await message(() => setSleepSchedule(session, { bedtime: 1440, wake: 60 }))).toBe("Choose a bedtime and wake time in the day.");
    watch.settingsFile = encodeSettingsFile(Buffer.alloc(71));
    expect(await message(() => setSleepSchedule(session, { bedtime: 0, wake: 480 }))).toBe("The watch's profile looks wrong, so C-LINK didn't change it.");
  });

  it("sets the calorie goal and its alert", async () => {
    const { watch, session } = fakeSession();
    const before = await readUserInfo(session);
    expect(before.calorieGoal).toBe(500);
    const after = await setGoals(session, { calories: 650 });
    expect(after.calorieGoal).toBe(650);
    expect(after.changedOffsets(before)).toEqual([7, 8]);
    expect(SyncUserInfo.fromSettingsFile(watch.settingsFile).equals(after)).toBe(true);
    expect(sleepScheduleOf(userInfo(watch.settingsFile))).toEqual({ bedtime: 23 * 60, wake: 7 * 60 });
    expect(await message(() => setGoals(session, { calories: 10_000 }))).toBe("Choose a calorie goal from 1 to 9,999 kcal.");
    const goals = await setGoals(session, { calories: 700, steps: 8_000, exerciseMinutes: 45 });
    expect([goals.calorieGoal, goals.stepGoal, goals.exerciseGoalSeconds]).toEqual([700, 8_000, 2_700]);
    expect(goals.changedOffsets(after).every((o) => o >= 3 && o < 15)).toBe(true);
    expect(SyncUserInfo.fromSettingsFile(watch.settingsFile).equals(goals)).toBe(true);

    const switches = await session.readSwitches();
    expect(switches.goalAlert).toBe(true);
    const stored = await writeSwitches(session, switches.setting("calorieGoalAlertOff", 1), switches);
    expect(stored.goalAlert).toBe(false);
    expect(watch.settings.get(EXTENDED_SWITCHES)?.[0]).toBe(0x10);

    watch.settingsFile = encodeSettingsFile(Buffer.alloc(71));
    expect(await message(() => setGoals(session, { calories: 700 }))).toBe("The watch's profile looks wrong, so C-LINK didn't change it.");

    const other = fakeSession(pace4());
    expect((await setGoals(other.session, { calories: 650 })).calorieGoal).toBe(650);
    expect(SyncUserInfo.fromSettingsFile(other.watch.settingsFile).calorieGoal).toBe(650);

    const unsupported = fakeSession(nomad());
    expect(await message(() => setGoals(unsupported.session, { calories: 650 }))).toBe("Not available on this watch.");
    expect(SyncUserInfo.fromSettingsFile(unsupported.watch.settingsFile).calorieGoal).toBe(500);
  });

  it("writes alarms, then reads them back", async () => {
    const { session } = fakeSession();
    expect(decodeAlarms(await readAlarmBytes(session))).toEqual([]);
    expect(isAcknowledgement(await writeAlarm(session, alarm(3, true, 6, 45)))).toBe(true);
    const after = await readAlarmBytes(session);
    expect(after.equals(Buffer.concat([Buffer.from([0x02, 0x03]), alarmRecord(alarm(3, true, 6, 45))]))).toBe(true);
    expect(decodeAlarms(after)).toEqual([alarm(3, true, 6, 45)]);
    await writeAlarm(session, alarm(5, true, 22, 15, EVERY_DAY));
    expect(isAcknowledgement(await clearAlarm(session, alarm(3, true, 6, 45)))).toBe(true);
    expect(decodeAlarms(await readAlarmBytes(session)).map((a) => a.slot)).toEqual([5]);
    expect(decodeAlarms(await readAlarmBytes(fakeSession(pace4()).session))).toEqual([]);
    expect(await message(() => readAlarmBytes(fakeSession(nomad()).session))).toBe("C-LINK can't read this watch's alarms yet.");
  });

  it("reads the storage and rings the watch", async () => {
    const { watch, session } = fakeSession();
    expect(await readStorage(session)).toEqual({ maps: 6_120_000_000, audio: 412_000_000, workouts: 2_400_000, routes: 18_600_000, free: 22_350_000_000, total: 34_359_738_368 });
    expect(await ringWatch(session)).toBe(1);
    expect(watch.rings).toBe(1);
    const fresh = fakeSession();
    fresh.session.authenticatedAt = null;
    expect(await message(() => ringWatch(fresh.session))).toBe("Connect and authenticate your watch first.");
    expect(fresh.watch.rings).toBe(0);
  });
});

/** A watch that restores the global record it's sent, as a PACE Pro did. */
function restoringWatch(watch = new FakeWatch()): FakeWatch {
  watch.onSettingsFile = (sent) => {
    const [s, e] = chunkRange(2, sent);
    const body = Buffer.from(watch.settingsFile.subarray(16));
    const [at] = chunkRange(2, watch.settingsFile);
    body.set(sent.subarray(s + 10, e), at + 10 - 16);
    watch.settingsFile = encodeDataFile(body, 54);
  };
  return watch;
}

describe("Satellite Systems", () => {
  it("sends the settings file and checks what the watch reads back", async () => {
    const { watch, session } = fakeSession(restoringWatch());
    const result = await setSatelliteMode(session, "allSystems");
    expect(result.problems).toEqual([]);
    expect(satelliteModeOf(result.before)).toBe("dualFrequency");
    expect(satelliteModeOf(result.after)).toBe("allSystems");
    const sent = watch.receivedFiles.get(54)!;
    expect([...sent.subarray(0, 4)]).toEqual([0x48, 0x46, 0, 54]);
    expect(satelliteModeOf(sent)).toBe("allSystems");
    // Already that mode: nothing sent.
    watch.receivedFiles.clear();
    expect((await setSatelliteMode(session, "allSystems")).problems).toEqual([]);
    expect(watch.receivedFiles.size).toBe(0);
  });

  it("reports a write the watch didn't take", async () => {
    const { session } = fakeSession();
    const result = await setSatelliteMode(session, "allSystems");
    expect(result.problems[0]).toBe("the watch reads back dualFrequency, not allSystems");
  });

  it("is only for watches with the PACE Pro's menu", async () => {
    expect(await message(() => setSatelliteMode(fakeSession(pace4()).session, "allSystems"))).toBe("Not available on this watch.");
  });
});

describe("the helper's settings answers", () => {
  it("reads what the page shows", async () => {
    const { watch, session } = fakeSession();
    const read = await settingsRead(session, watch.info);
    expect(read.problems).toEqual([]);
    expect(read.profile).toEqual({ maxHR: 190, restingHR: 52, thresholdHR: 172, zoneType: "maxHR", thresholdPace: 285_000, ftp: 0, criticalPower: 0, zones: [114, 133, 152, 171, 181] });
    expect(read.sleep).toEqual({ bedtime: 23 * 60, wake: 7 * 60 });
    const wrist = read.switches!.find((r) => r.key === "wristGesture")!;
    expect(wrist).toEqual({ key: "wristGesture", value: 1, values: { 0: "Off", 1: "On" }, edit: [1, 0] });
    expect(read.switches!.find((r) => r.key === "backlight")?.edit).toBeUndefined();
    expect(read.switches!.some((r) => r.key === "lossAlert")).toBe(false);
    expect(await settingsRead(fakeSession(nomad()).session, nomad().info)).toEqual({ problems: [] });
    watch.isConnected = false;
    expect((await settingsRead(session, watch.info)).problems).toEqual([
      "settings: Connect and authenticate your watch first.", "profile: Connect and authenticate your watch first.", "sleep: Connect and authenticate your watch first."]);
  });

  it("sets a switch, the profile and the sleep schedule, each read back", async () => {
    const { session } = fakeSession();
    const rows = await setSwitch(session, "units", 1);
    expect(rows.find((r) => r.key === "units")?.value).toBe(1);
    expect(await message(() => setSwitch(session, "wristHeartRateOff", 1))).toBe("C-LINK can't make this change. Change this setting on the watch.");
    const profile = await setProfile(session, { restingHR: 50, zoneType: "threshold", maxHR: "x" });
    expect([profile.restingHR, profile.maxHR, profile.zoneType]).toEqual([50, 190, "threshold"]);
    expect(await setSleep(session, 22 * 60, 6 * 60)).toEqual({ bedtime: 22 * 60, wake: 6 * 60 });
    expect(await message(() => setSleep(session, -1, 60))).toBe("Pick a bedtime and a wake time.");
  });
});

describe("the web's waiting changes (Syncer.apply)", () => {
  const changes = fixtures.watchChanges.map((row) => ({ id: row.id, body: JSON.stringify(row.body) }));

  it("writes each change the watch can take", async () => {
    const { watch, session } = fakeSession(restoringWatch());
    // The PACE Pro offers all systems and dual frequency; the fixture asks for dual, which it already has.
    const result = await applyChanges(session, watch.info, [...changes, { id: "volume", body: "{\"value\":3}" }, { id: 7, body: "{}" }]);
    expect(result).toEqual({ applied: ["goal.calories", "goal.exerciseMinutes", "goal.steps", "gpsMode", "alarms"], refused: ["volume"] });
    const info = SyncUserInfo.fromSettingsFile(watch.settingsFile);
    expect([info.calorieGoal, info.exerciseGoalSeconds, info.stepGoal]).toEqual([650, 45 * 60, 12_000]);
    expect(decodeAlarms(await readAlarmBytes(session))).toEqual([alarm(0, true, 6, 30, 0b11111), alarm(1, true, 9, 15)]);
  });

  it("refuses what the watch can't take", async () => {
    const { watch, session } = fakeSession(nomad());
    const result = await applyChanges(session, watch.info, changes);
    // The step goal is kept on this computer, so it counts as applied.
    expect(result).toEqual({ applied: ["goal.steps"], refused: ["goal.calories", "goal.exerciseMinutes", "gpsMode", "alarms"] });
    const standard = await applyChanges(fakeSession().session, new FakeWatch().info, [{ id: "gpsMode", body: "{\"value\":\"standard\"}" }]);
    expect(standard).toEqual({ applied: [], refused: ["gpsMode"] });
  });

  it("leaves a change that failed with the link down for the next sync", async () => {
    const { watch, session } = fakeSession();
    const exchange = watch.exchange.bind(watch);
    watch.exchange = async (opcode, payload) => {
      if (opcode === 0x8b) { watch.isConnected = false; throw new CorosError("The watch disconnected."); }
      return exchange(opcode, payload);
    };
    expect(await applyChanges(session, watch.info, changes.slice(0, 1))).toEqual({ applied: [], refused: [] });
    watch.isConnected = true;
    watch.exchange = async (opcode, payload) => {
      if (opcode === 0x8b) throw new CorosError("The watch didn't answer.");
      return exchange(opcode, payload);
    };
    expect(await applyChanges(session, watch.info, changes.slice(0, 1))).toEqual({ applied: [], refused: ["goal.calories"] });
  });
});
