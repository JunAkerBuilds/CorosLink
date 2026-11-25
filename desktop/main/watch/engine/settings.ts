// The watch's settings over control opcodes 0xA7 (read) and 0xA6 (write), and its system switches. A port of
// CorosKit's WatchData/WatchSettings.swift. Layouts and meanings were worked out on a PACE 4 (W336, 3.2008.0).
import { CorosError, put32, u32 } from "./bytes";
import { supportsOn, type WatchTarget } from "./models";

export const SETTINGS_GET = 0xa7;
export const SETTINGS_SET = 0xa6;
/** One 32-bit word of system switches. */
export const SWITCHES = 0;
/** The training profile (LitePb.UserInfo). */
export const USER_INFO = 10;
/** Two more words of switches. */
export const EXTENDED_SWITCHES = 31;

/** Splits a settings reply (or request) into type → value, joining chunks. */
export function decodeSettings(payload: Uint8Array): Map<number, Buffer> {
  const settings = new Map<number, Buffer>();
  let offset = 0;
  while (offset + 2 <= payload.length) {
    const type = payload[offset], length = payload[offset + 1];
    if (offset + 2 + length > payload.length) throw new CorosError("The watch returned truncated settings.");
    const value = Buffer.from(payload.subarray(offset + 2, offset + 2 + length));
    settings.set(type, Buffer.concat([settings.get(type) ?? Buffer.alloc(0), value]));
    offset += 2 + length;
  }
  return settings;
}

export function encodeSettings(entries: [number, Uint8Array][]): Buffer {
  const out: Buffer[] = [];
  for (const [type, value] of entries) {
    let offset = 0;
    do {
      const chunk = value.subarray(offset, Math.min(offset + 255, value.length));
      out.push(Buffer.from([type, chunk.length]), Buffer.from(chunk));
      offset += 255;
    } while (offset < value.length);
  }
  return Buffer.concat(out);
}

/** The read request: one setting is asked for alongside the switches, as the app does. */
export const settingsRequest = (types: number[]): Buffer => Buffer.from(types.length === 1 ? [SWITCHES, ...types] : types);

export type SwitchStatus = "confirmed" | "likely" | "unused";
export interface SwitchField {
  key: string;
  record: "main" | "extended";
  bit: number;
  width: number;
  status: SwitchStatus;
  /** What each value means (English, for logs). */
  values: Record<number, string>;
  /** The values C-LINK offers to write; undefined for settings that stay on the watch. */
  edit?: number[];
}

const F = (key: string, record: "main" | "extended", bit: number, width: number, status: SwitchStatus, values: Record<number, string> = {}, edit?: number[]): SwitchField =>
  ({ key, record, bit, width, status, values, edit });
const OFF = [1, 0];
const onOff = { 0: "Off", 1: "On" };

const MAIN: SwitchField[] = [
  F("backlight", "main", 0, 2, "confirmed", { 1: "Turns off after a few seconds", 2: "Stays on" }),
  F("wristGesture", "main", 2, 1, "confirmed", onOff, OFF),
  F("lossAlert", "main", 3, 1, "unused"),
  F("trackApp", "main", 4, 1, "unused"),
  F("weather", "main", 5, 1, "unused"),
  F("scheduledDoNotDisturb", "main", 6, 1, "confirmed", onOff, OFF),
  F("notificationPreview", "main", 7, 1, "unused"),
  F("highLight", "main", 8, 1, "unused"),
  F("sedentaryOld", "main", 9, 1, "unused"),
  F("wrist", "main", 10, 1, "confirmed", { 0: "Left", 1: "Right" }, [0, 1]),
  F("autoHeartRateOld", "main", 11, 1, "unused"),
  F("autoSync", "main", 12, 1, "unused"),
  // The watch's clock shows hour % 12 with AM/PM when this is 1.
  F("timeFormat", "main", 13, 1, "confirmed", { 0: "24-hour", 1: "12-hour" }, [1, 0]),
  F("units", "main", 14, 1, "confirmed", { 0: "Metric", 1: "Imperial" }, [0, 1]),
  F("gpsModeOld", "main", 15, 2, "unused"),
  F("doNotDisturb", "main", 17, 1, "confirmed", onOff, OFF),
  F("autoAltitudeCalibration", "main", 18, 1, "likely"),
  // Set when a phone pairs, but nothing reads it (except on the PACE 3).
  F("timeFromPhone", "main", 19, 1, "unused"),
  F("dialRotation", "main", 20, 1, "confirmed", { 0: "Standard", 1: "Reversed" }, [0, 1]),
  F("raiseToWake", "main", 21, 2, "confirmed", { 0: "Auto", 1: "All day", 2: "Off" }, [0, 1, 2]),
  F("screenRotation", "main", 23, 2, "confirmed", { 0: "Standard", 3: "Rotated" }),
  F("seaLevelPressure", "main", 25, 1, "likely"),
  F("barometerRange", "main", 26, 2, "confirmed", { 0: "Widest", 1: "Zoom 2×", 2: "Zoom 3×", 3: "Zoom 4×" }, [0, 1, 2, 3]),
  F("stormAlert", "main", 28, 1, "confirmed", onOff, OFF),
  F("batterySaver", "main", 29, 1, "confirmed", onOff),
  // One 2-bit field: the watch's notification filter only asks whether it is non-zero.
  F("notificationsInActivity", "main", 30, 2, "confirmed", { 0: "Off", 1: "On", 2: "On", 3: "On" }, OFF),
];

const EXTENDED: SwitchField[] = [
  F("cycleReminderDays", "extended", 5, 3, "confirmed", { 0: "Off" }),
  F("largeFont", "extended", 8, 1, "likely"),
  F("cycleSecondReminder", "extended", 10, 1, "confirmed", onOff),
  F("navigationAlerts", "extended", 11, 1, "likely"),
  F("dailyHeartRate", "extended", 12, 1, "confirmed", { 0: "Every few minutes", 1: "Real-time" }),
  F("wristHeartRateOff", "extended", 13, 1, "confirmed", { 0: "On", 1: "Off" }),
  F("pressureUnit", "extended", 16, 1, "confirmed", { 0: "hPa", 1: "mmHg" }, [0, 1]),
  F("metronomeCue", "extended", 18, 2, "likely"),
  F("timerAlert", "extended", 20, 2, "likely"),
  F("mapOrientation", "extended", 25, 1, "likely"),
  // Auto Lock for the standby dial: 2 unlocks with a turn of the dial instead of a hold.
  F("screenLock", "extended", 26, 2, "confirmed", { 0: "Off", 1: "Hold to unlock", 2: "Scroll to unlock" }, [0, 1, 2]),
  F("touchscreen", "extended", 30, 4, "confirmed", { 4: "Map & activity data", 5: "Always on" }),
  F("backgroundColor", "extended", 35, 1, "likely"),
  // The watch gives a turn alert during navigation only while this is 0.
  F("turnByTurnAlerts", "extended", 37, 1, "confirmed", { 0: "On", 1: "Off" }, [0, 1]),
  F("sleepHrvOff", "extended", 39, 1, "confirmed", { 0: "On", 1: "Off" }),
  F("strydDistance", "extended", 40, 1, "confirmed", { 0: "Watch", 1: "STRYD" }),
  F("hrvStressOff", "extended", 41, 1, "confirmed", { 0: "On", 1: "Off" }),
  F("brightness", "extended", 50, 2, "confirmed", { 0: "Standard", 1: "High", 2: "Max" }, [0, 1, 2]),
  F("alwaysOnDaily", "extended", 52, 1, "confirmed", onOff, OFF),
  F("alwaysOnActivity", "extended", 53, 1, "confirmed", onOff, OFF),
  // Read only: the watch keeps its own unit when this record is written.
  F("temperatureUnit", "extended", 54, 2, "confirmed", { 0: "°C", 1: "°F" }),
  F("sedentaryReminderOff", "extended", 57, 1, "confirmed", { 0: "On", 1: "Off" }),
  F("raiseToWakeActivity", "extended", 60, 2, "confirmed", { 0: "On", 1: "Off", 2: "On", 3: "On" }, [0, 1]),
  F("cycleReminderEnabled", "extended", 63, 1, "likely"),
];

const UNUSED_ON_MIP = new Set(["brightness", "alwaysOnDaily", "alwaysOnActivity", "raiseToWakeActivity"]);
const NIGHT_MODE = F("nightMode", "extended", 28, 1, "confirmed", onOff);
const CALORIE_GOAL_ALERT = F("calorieGoalAlertOff", "extended", 4, 1, "likely", { 0: "On", 1: "Off" }, [0, 1]);

const insertByBit = (fields: SwitchField[], field: SwitchField): SwitchField[] => {
  const at = fields.findIndex((f) => f.bit > field.bit);
  const copy = [...fields];
  copy.splice(at < 0 ? copy.length : at, 0, field);
  return copy;
};

/** The fields for a model (the PACE 4's tables when it's unknown), main word first, each in bit order. */
export function switchFields(target: WatchTarget | null): SwitchField[] {
  const memoryInPixel = target?.id === "apex-4" || target?.id === "pace-3";
  let ext = EXTENDED;
  if (memoryInPixel) {
    ext = ext.filter((f) => !UNUSED_ON_MIP.has(f.key)).map((f) => (f.key === "screenLock" ? { ...f, status: "likely" as const } : f));
    ext = insertByBit(ext, NIGHT_MODE);
  }
  if (supportsOn(target, "dailyGoal")) ext = insertByBit(ext, CALORIE_GOAL_ALERT);
  let main = MAIN;
  if (target?.id === "pace-3") {
    main = main.map((f) => (f.key === "timeFromPhone" ? { ...f, status: "likely" as const, values: { 0: "Watch's own", 1: "Follows the phone" } } : f));
    ext = ext.map((f) => (f.key === "touchscreen" ? { ...f, values: { 0: "Navigation only", 1: "Navigation only", 2: "Navigation only", 3: "Navigation only", 4: "Navigation & activity screens", 5: "Always on" } } : f));
  }
  return [...main, ...ext];
}

/** The system switches as one model's firmware uses them. */
export class WatchSwitches {
  /** Setting 0 as the watch stores it. */
  word: number;
  /** Setting 31 as the watch stores it (older watches don't send it); bytes past the first 8 are kept as sent. */
  extendedRecord: Buffer | null;

  constructor(word: Uint8Array, extended: Uint8Array | null | undefined, readonly target: WatchTarget | null) {
    if (word.length < 4) throw new CorosError("The watch's settings are too short.");
    this.word = u32(word, 0);
    this.extendedRecord = extended && extended.length >= 8 ? Buffer.from(extended) : null;
  }

  get fields(): SwitchField[] {
    return switchFields(this.target).filter((f) => f.record === "main" || this.extendedRecord !== null);
  }

  private get extendedWord(): bigint | null {
    if (!this.extendedRecord) return null;
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(this.extendedRecord[i]) << BigInt(i * 8);
    return v;
  }

  valueOf(field: SwitchField): number | null {
    const mask = (1n << BigInt(field.width)) - 1n;
    if (field.record === "main") return Number((BigInt(this.word) >> BigInt(field.bit)) & mask);
    const ext = this.extendedWord;
    return ext === null ? null : Number((ext >> BigInt(field.bit)) & mask);
  }

  value(key: string): number | null {
    const field = this.fields.find((f) => f.key === key);
    return field ? this.valueOf(field) : null;
  }

  /** 12-hour clock on the watch, from its own switch. */
  get hour12(): boolean { return this.value("timeFormat") === 1; }

  /** Whether the watch alerts when the calorie goal is reached; null on watches without the switch. */
  get goalAlert(): boolean | null { const v = this.value("calorieGoalAlertOff"); return v === null ? null : v === 0; }

  /** These switches with one field changed, only to a value the model's table offers. */
  setting(key: string, value: number): WatchSwitches {
    const field = switchFields(this.target).find((f) => f.key === key);
    if (!field || !field.edit?.includes(value)) throw new CorosError("C-LINK can't make this change. Change this setting on the watch.");
    const mask = (1n << BigInt(field.width)) - 1n;
    const next = Object.assign(Object.create(WatchSwitches.prototype) as WatchSwitches, this, { extendedRecord: this.extendedRecord ? Buffer.from(this.extendedRecord) : null });
    if (field.record === "main") {
      next.word = Number(((BigInt(this.word) & ~(mask << BigInt(field.bit))) | (BigInt(value) << BigInt(field.bit))) & 0xffffffffn);
    } else {
      const current = this.extendedWord;
      if (!next.extendedRecord || current === null) throw new CorosError("Reconnect the watch to read all its settings, then try again.");
      const updated = (current & ~(mask << BigInt(field.bit))) | (BigInt(value) << BigInt(field.bit));
      for (let i = 0; i < 8; i++) next.extendedRecord[i] = Number((updated >> BigInt(i * 8)) & 0xffn);
    }
    return next;
  }

  /** The settings entries to write: the whole word, and the extended record when it changed. */
  entries(old: WatchSwitches): [number, Buffer][] {
    const word = Buffer.alloc(4);
    put32(word, this.word, 0);
    const out: [number, Buffer][] = [[SWITCHES, word]];
    if (this.extendedRecord && !(old.extendedRecord && this.extendedRecord.equals(old.extendedRecord))) out.push([EXTENDED_SWITCHES, this.extendedRecord]);
    return out;
  }
}

/** Reads the switches from a settings reply. */
export function switchesFrom(reply: Map<number, Buffer>, target: WatchTarget | null): WatchSwitches {
  const word = reply.get(SWITCHES);
  if (!word) throw new CorosError("The watch didn't return its settings.");
  return new WatchSwitches(word, reply.get(EXTENDED_SWITCHES), target);
}
