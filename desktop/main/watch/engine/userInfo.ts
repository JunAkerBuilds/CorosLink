// SyncUserInfo, the 71-byte profile the COROS app writes to the watch with control 0x8B and the watch stores as sent,
// then reports in its settings file. A port of CorosKit's WatchData/SyncUserInfo.swift. Besides the daily goals it holds
// height, weight, age, heart-rate zones, the sleep schedule and the HRV baseline, so a change starts from a fresh read
// of the watch's own block and changes only its own bytes. Layout in CorosLink's `coros-daily-goals-ble.md`.
import { CorosError, put32, u32 } from "./bytes";
import { userInfo as userInfoBytes, USER_INFO_BYTES } from "./settingsFile";

export const SYNC_USER_INFO = 0x8b;

/** Sleep Time to Wake Time, local minutes after midnight (CorosKit's SleepSchedule). */
export interface SleepSchedule { bedtime: number; wake: number }

// Where each goal sits (u32): steps, active kcal, then exercise time in seconds; the sleep schedule at 55–58.
const STEP_GOAL = 3, CALORIE_GOAL = 7, EXERCISE_GOAL = 11, SLEEP_SCHEDULE = 55;

const inRange = (v: number, low: number, high: number) => Number.isInteger(v) && v >= low && v <= high;

export class SyncUserInfo {
  readonly bytes: Buffer;

  constructor(bytes: Uint8Array) {
    if (bytes.length !== USER_INFO_BYTES) throw new CorosError("The watch's profile has an unexpected size.");
    this.bytes = Buffer.from(bytes);
  }

  /** From the watch's settings file. */
  static fromSettingsFile(file: Uint8Array): SyncUserInfo { return new SyncUserInfo(userInfoBytes(file)); }

  /** The active-calorie goal in kcal. */
  get calorieGoal(): number { return u32(this.bytes, CALORIE_GOAL); }
  get stepGoal(): number { return u32(this.bytes, STEP_GOAL); }
  get exerciseGoalSeconds(): number { return u32(this.bytes, EXERCISE_GOAL); }

  /** The sleep schedule; null when the bytes aren't clock times (SleepProfile(userInfo:).schedule). */
  get sleepSchedule(): SleepSchedule | null { return sleepScheduleOf(this.bytes); }

  /** Whether the firmware kept height, weight and age as sent (51–249 cm, 11–249 kg, 6–119 years); else it's never written back. */
  get looksWritten(): boolean {
    const b = this.bytes;
    return b[0] >= 51 && b[0] <= 249 && b[1] >= 11 && b[1] <= 249 && (b[2] & 0x7f) >= 6 && (b[2] & 0x7f) <= 119;
  }

  settingCalorieGoal(kcal: number): SyncUserInfo {
    if (!inRange(kcal, 1, 9999)) throw new CorosError("Choose a calorie goal from 1 to 9,999 kcal.");
    return this.setting(kcal, CALORIE_GOAL);
  }

  settingStepGoal(steps: number): SyncUserInfo {
    if (!inRange(steps, 0, 100_000)) throw new CorosError("Choose a step goal from 0 to 100,000.");
    return this.setting(steps, STEP_GOAL);
  }

  /** Kept in seconds. */
  settingExerciseGoalMinutes(minutes: number): SyncUserInfo {
    if (!inRange(minutes, 0, 1440)) throw new CorosError("Choose an exercise goal from 0 to 1,440 minutes.");
    return this.setting(minutes * 60, EXERCISE_GOAL);
  }

  settingSleepSchedule(schedule: SleepSchedule): SyncUserInfo {
    const { bedtime, wake } = schedule;
    if (!inRange(bedtime, 0, 1439) || !inRange(wake, 0, 1439)) throw new CorosError("Choose a bedtime and wake time in the day.");
    if (bedtime === wake) throw new CorosError("Choose a wake time different from the bedtime.");
    const bytes = Buffer.from(this.bytes);
    bytes.set([Math.floor(bedtime / 60), bedtime % 60, Math.floor(wake / 60), wake % 60], SLEEP_SCHEDULE);
    return new SyncUserInfo(bytes);
  }

  private setting(value: number, at: number): SyncUserInfo {
    const bytes = Buffer.from(this.bytes);
    put32(bytes, value, at);
    return new SyncUserInfo(bytes);
  }

  equals(other: SyncUserInfo): boolean { return this.bytes.equals(other.bytes); }

  /** The offsets of the bytes that differ from `other`'s. */
  changedOffsets(other: SyncUserInfo): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bytes.length; i++) if (this.bytes[i] !== other.bytes[i]) out.push(i);
    return out;
  }
}

/** Bytes 55–58 as Sleep Time and Wake Time; null when an hour or minute isn't a clock time. */
export function sleepScheduleOf(info: Uint8Array): SleepSchedule | null {
  if (info.length !== USER_INFO_BYTES) return null;
  const [sh, sm, wh, wm] = [info[55], info[56], info[57], info[58]];
  return sh < 24 && wh < 24 && sm < 60 && wm < 60 ? { bedtime: sh * 60 + sm, wake: wh * 60 + wm } : null;
}
