import type { WatchModelId } from "./watchModels";

/**
 * The watch's system switches: settings type 0 (SWITCH, one 32-bit word) and
 * type 31 (SWITCH_EXT, two words), little-endian bit fields, least
 * significant first. The watch returns them with every settings read and
 * stores a written word as is, so a switch is changed by reading the word,
 * setting the field and writing the whole word back, as the phone app does.
 *
 * The layout and meanings here are the PACE 4's (W336, firmware 3.2008.0).
 * The main word matches the phone app's layout, but in the first extended
 * word the watch's fields sit one bit above the app's, so the watch's
 * positions are used. Each field's meaning comes from what the watch itself
 * does with it: the names its own Bluetooth commands and battery log give the
 * settings, the texts its screens show for each value, and the features that
 * read the bit (notifications, quiet hours, raise to wake, battery-life
 * estimate, crown, barometer, cycle tracking).
 * A field that only the Bluetooth handlers and settings backup touch has no
 * effect on a PACE 4 ("unused"). Wrist side and time format were also checked
 * against a watch (time format: 1 = 12-hour). "likely" marks a field whose position is known but whose
 * values the watch doesn't label; its values are shown raw until a change
 * made on the watch confirms them (watchSettingsService records each change).
 */

export type FieldStatus = "confirmed" | "likely" | "unused" | "unknown";

/**
 * `edit`: the values CorosLink offers to write, in the order shown. Only for
 * confirmed settings the firmware reads each time it uses them (raise to wake,
 * the notification filter, quiet hours, units and formats, the crown,
 * barometer and display brightness), so a written value takes effect without a
 * restart. Settings that start or stop sensors, change modes or rotate the
 * screen stay on the watch.
 */
export interface SwitchField { key: string; bit: number; width: number; status: FieldStatus; values?: Readonly<Record<number, string>>; edit?: readonly number[] }
type Field = SwitchField;

export const SWITCH_FIELDS = [
  { key: "backlight", bit: 0, width: 2, status: "confirmed", values: { 1: "Turns off after a few seconds", 2: "Stays on" } },
  { key: "wristGesture", bit: 2, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" }, edit: [1, 0] },
  { key: "lossAlert", bit: 3, width: 1, status: "unused" },
  { key: "trackApp", bit: 4, width: 1, status: "unused" },
  { key: "weather", bit: 5, width: 1, status: "unused" },
  { key: "scheduledDoNotDisturb", bit: 6, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" }, edit: [1, 0] },
  { key: "notificationPreview", bit: 7, width: 1, status: "unused" },
  { key: "highLight", bit: 8, width: 1, status: "unused" },
  { key: "sedentaryOld", bit: 9, width: 1, status: "unused" },
  { key: "wrist", bit: 10, width: 1, status: "confirmed", values: { 0: "Left", 1: "Right" }, edit: [0, 1] },
  { key: "autoHeartRateOld", bit: 11, width: 1, status: "unused" },
  { key: "autoSync", bit: 12, width: 1, status: "unused" },
  // The watch's clock shows hour % 12 with AM/PM when this is 1.
  { key: "timeFormat", bit: 13, width: 1, status: "confirmed", values: { 0: "24-hour", 1: "12-hour" }, edit: [1, 0] },
  { key: "units", bit: 14, width: 1, status: "confirmed", values: { 0: "Metric", 1: "Imperial" }, edit: [0, 1] },
  { key: "gpsModeOld", bit: 15, width: 2, status: "unused" },
  { key: "doNotDisturb", bit: 17, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" }, edit: [1, 0] },
  { key: "autoAltitudeCalibration", bit: 18, width: 1, status: "likely" },
  // Set when a phone pairs, but nothing reads it.
  { key: "timeFromPhone", bit: 19, width: 1, status: "unused" },
  { key: "dialRotation", bit: 20, width: 1, status: "confirmed", values: { 0: "Standard", 1: "Reversed" }, edit: [0, 1] },
  { key: "raiseToWake", bit: 21, width: 2, status: "confirmed", values: { 0: "Auto", 1: "All day", 2: "Off" }, edit: [0, 1, 2] },
  { key: "screenRotation", bit: 23, width: 2, status: "confirmed", values: { 0: "Standard", 3: "Rotated (dial on the other side)" } },
  { key: "seaLevelPressure", bit: 25, width: 1, status: "likely" },
  { key: "barometerRange", bit: 26, width: 2, status: "confirmed", values: { 0: "Widest", 1: "Zoom 2×", 2: "Zoom 3×", 3: "Zoom 4×" }, edit: [0, 1, 2, 3] },
  { key: "stormAlert", bit: 28, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" }, edit: [1, 0] },
  { key: "batterySaver", bit: 29, width: 1, status: "confirmed", values: { 0: "Off", 1: "On (no notifications)" } },
  // One 2-bit field: the watch's notification filter only asks whether it is non-zero.
  { key: "notificationsInActivity", bit: 30, width: 2, status: "confirmed", values: { 0: "Off", 1: "On", 2: "On", 3: "On" }, edit: [1, 0] }
] as const satisfies readonly Field[];

export type SwitchKey = typeof SWITCH_FIELDS[number]["key"];
export type WatchSwitches = Record<SwitchKey, number>;

export function decodeSwitches(raw: number): WatchSwitches {
  const values = {} as WatchSwitches;
  for (const field of SWITCH_FIELDS) values[field.key] = Math.floor(raw / 2 ** field.bit) % 2 ** field.width;
  return values;
}

/** The word with one field changed, the rest kept as the watch sent them. */
export function setSwitch(raw: number, key: SwitchKey, value: number): number {
  const field = SWITCH_FIELDS.find(item => item.key === key);
  if (!field || !Number.isInteger(value) || value < 0 || value >= 2 ** field.width) throw new Error("Invalid watch setting.");
  const mask = (2 ** field.width - 1) * 2 ** field.bit;
  return ((raw >>> 0) - ((raw >>> 0) & mask) + value * 2 ** field.bit) >>> 0;
}

export function decodeSwitchWord(bytes: Buffer): number {
  if (bytes.length < 4) throw new Error("The watch's settings are too short.");
  return bytes.readUInt32LE(0);
}

/** The extended switches, settings type 31: two little-endian words, bit numbers counted across both. */
export const SETTING_SWITCH_EXT = 31;

export const EXT_SWITCH_FIELDS = [
  { key: "cycleReminderDays", bit: 5, width: 3, status: "confirmed", values: { 0: "Off" } },
  { key: "largeFont", bit: 8, width: 1, status: "likely" },
  { key: "cycleSecondReminder", bit: 10, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" } },
  { key: "navigationAlerts", bit: 11, width: 1, status: "likely" },
  { key: "dailyHeartRate", bit: 12, width: 1, status: "confirmed", values: { 0: "Every few minutes", 1: "Real-time" } },
  { key: "wristHeartRateOff", bit: 13, width: 1, status: "confirmed", values: { 0: "On", 1: "Off" } },
  { key: "pressureUnit", bit: 16, width: 1, status: "confirmed", values: { 0: "hPa", 1: "mmHg" }, edit: [0, 1] },
  { key: "metronomeCue", bit: 18, width: 2, status: "likely" },
  { key: "timerAlert", bit: 20, width: 2, status: "likely" },
  { key: "mapOrientation", bit: 25, width: 1, status: "likely" },
  { key: "screenLock", bit: 26, width: 2, status: "likely" },
  { key: "touchscreen", bit: 30, width: 4, status: "confirmed", values: { 4: "Map & activity data", 5: "Always on" } },
  { key: "backgroundColor", bit: 35, width: 1, status: "likely" },
  // The watch gives a turn alert during navigation only while this is 0.
  { key: "turnByTurnAlerts", bit: 37, width: 1, status: "confirmed", values: { 0: "On", 1: "Off" }, edit: [0, 1] },
  { key: "sleepHrvOff", bit: 39, width: 1, status: "confirmed", values: { 0: "On", 1: "Off" } },
  { key: "strydDistance", bit: 40, width: 1, status: "confirmed", values: { 0: "Watch", 1: "STRYD" } },
  { key: "hrvStressOff", bit: 41, width: 1, status: "confirmed", values: { 0: "On", 1: "Off" } },
  { key: "brightness", bit: 50, width: 2, status: "confirmed", values: { 0: "Standard", 1: "High", 2: "Max" }, edit: [0, 1, 2] },
  { key: "alwaysOnDaily", bit: 52, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" }, edit: [1, 0] },
  { key: "alwaysOnActivity", bit: 53, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" }, edit: [1, 0] },
  // Read only: the watch keeps its own unit when this record is written (firmware keeps these bits once a
  // flag is set; confirmed on a PACE 4, 2026-10-20). It's changed on the watch.
  { key: "temperatureUnit", bit: 54, width: 2, status: "confirmed", values: { 0: "°C", 1: "°F" } },
  { key: "sedentaryReminderOff", bit: 57, width: 1, status: "confirmed", values: { 0: "On", 1: "Off" } },
  { key: "raiseToWakeActivity", bit: 60, width: 2, status: "confirmed", values: { 0: "On", 1: "Off", 2: "On", 3: "On" }, edit: [0, 1] },
  { key: "cycleReminderEnabled", bit: 63, width: 1, status: "likely" }
] as const satisfies readonly Field[];

/**
 * Per-model fields, on top of the PACE 4 tables above (which stay the table for
 * the PACE 4, PACE 4 Pro and PACE Pro). The APEX 4 (W541) and PACE 3 (W331)
 * 3.2008.0 firmware keep both records at the same offsets and give every other
 * field the PACE 4's meaning, but they have memory-in-pixel screens:
 *  - brightness, the always-on display and raise to wake during activities
 *    (ext 50-53, 60-61) have no effect there (only the battery statistics
 *    read them), so they don't show and can't be edited;
 *  - ext 28 is Night Mode: the control centre titles its fourth card
 *    "Night Mode" and shows ON while the bit is 1. The watch turns it off
 *    itself, so it is display only.
 * The PACE 3's control centre also names the touchscreen values differently
 * (4 "Navigation & Activity Interface", 5 "Always On", anything else
 * "Navigation Only"), and the PACE 3 takes SYNC_TIME's 12/24-hour flag, and
 * applies the phone's time and DST rules, only while main bit 19 is 1.
 */
const NIGHT_MODE = { key: "nightMode", bit: 28, width: 1, status: "confirmed", values: { 0: "Off", 1: "On" } } as const satisfies Field;

const UNUSED_ON_MEMORY_IN_PIXEL: ReadonlySet<string> = new Set(["brightness", "alwaysOnDaily", "alwaysOnActivity", "raiseToWakeActivity"]);

type FieldOverrides = Readonly<Record<string, Partial<Field>>>;

/** How each model differs from the PACE 4 tables; a model not listed uses them as they are. */
const MODEL_SWITCHES: Partial<Record<WatchModelId, { memoryInPixel?: true; main?: FieldOverrides; ext?: FieldOverrides }>> = {
  "apex-4": { memoryInPixel: true },
  "pace-3": {
    memoryInPixel: true,
    main: { timeFromPhone: { status: "likely", values: { 0: "Watch's own", 1: "Follows the phone" } } },
    ext: { touchscreen: { values: { 0: "Navigation only", 1: "Navigation only", 2: "Navigation only", 3: "Navigation only", 4: "Navigation & activity screens", 5: "Always on" } } }
  }
};

function withOverrides(fields: readonly Field[], overrides: FieldOverrides | undefined): readonly Field[] {
  return overrides ? fields.map(field => overrides[field.key] ? { ...field, ...overrides[field.key] } : field) : fields;
}

/** The main-word fields as this model's firmware uses them (the PACE 4 table when the model is unknown). */
export function switchFieldsFor(model?: WatchModelId): readonly Field[] {
  return withOverrides(SWITCH_FIELDS, model ? MODEL_SWITCHES[model]?.main : undefined);
}

/** The extended fields as this model's firmware uses them, in bit order (the PACE 4 table when the model is unknown). */
export function extSwitchFieldsFor(model?: WatchModelId): readonly Field[] {
  const tables = model ? MODEL_SWITCHES[model] : undefined;
  if (!tables) return EXT_SWITCH_FIELDS;
  const fields: Field[] = (EXT_SWITCH_FIELDS as readonly Field[]).filter(field => !tables.memoryInPixel || !UNUSED_ON_MEMORY_IN_PIXEL.has(field.key));
  if (tables.memoryInPixel) fields.splice(fields.findIndex(field => field.bit > NIGHT_MODE.bit), 0, NIGHT_MODE);
  return withOverrides(fields, tables.ext);
}

export type ExtSwitchKey = typeof EXT_SWITCH_FIELDS[number]["key"] | typeof NIGHT_MODE.key;
/** The extended fields a record holds for its model; a field that doesn't apply to the model is absent. */
export type ExtSwitches = Partial<Record<ExtSwitchKey, number>>;

export function decodeExtSwitches(bytes: Buffer, model?: WatchModelId): ExtSwitches {
  if (bytes.length < 8) throw new Error("The watch's extended settings are too short.");
  const word = bytes.readBigUInt64LE(0);
  const values: ExtSwitches = {};
  for (const field of extSwitchFieldsFor(model)) values[field.key as ExtSwitchKey] = Number((word >> BigInt(field.bit)) & BigInt(2 ** field.width - 1));
  return values;
}

/** The extended record with one field changed; bytes past the known 8 are kept as the watch sent them. */
function setExtSwitch(bytes: Buffer, key: ExtSwitchKey, value: number, model?: WatchModelId): Buffer {
  const field = extSwitchFieldsFor(model).find(item => item.key === key);
  if (!field || bytes.length < 8 || !Number.isInteger(value) || value < 0 || value >= 2 ** field.width) throw new Error("Invalid watch setting.");
  const mask = (2n ** BigInt(field.width) - 1n) << BigInt(field.bit);
  const word = (bytes.readBigUInt64LE(0) & ~mask) | (BigInt(value) << BigInt(field.bit));
  const next = Buffer.from(bytes);
  next.writeBigUInt64LE(word, 0);
  return next;
}

/**
 * Applies edits ({ field: value }) to both records. Only fields with an `edit`
 * list in the model's table accept a value, and only one from that list.
 */
export function applySettingEdits(word: number, ext: Buffer | undefined, edits: Record<string, unknown>, model?: WatchModelId): { word: number; ext?: Buffer; extChanged: boolean } {
  let nextWord = word >>> 0;
  let nextExt = ext;
  let extChanged = false;
  for (const [key, raw] of Object.entries(edits)) {
    const value = Number(raw);
    const main = switchFieldsFor(model).find(field => field.key === key);
    const extended = extSwitchFieldsFor(model).find(field => field.key === key);
    const field = main ?? extended;
    if (!field?.edit?.includes(value)) throw new Error("CorosLink can't make this change. Change this setting on the watch.");
    if (main) nextWord = setSwitch(nextWord, key as SwitchKey, value);
    else {
      if (!nextExt) throw new Error("Reconnect the watch to read all its settings, then try again.");
      nextExt = setExtSwitch(nextExt, key as ExtSwitchKey, value, model);
      extChanged = true;
    }
  }
  return { word: nextWord, ...(nextExt ? { ext: nextExt } : {}), extChanged };
}

