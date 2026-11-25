// What the COROS app does on and after each connection besides watch faces: read and write the settings, training
// profile, goals, sleep schedule and alarms, read today's steps, the record files and the storage, set Satellite
// Systems and ring the watch. A port of CorosKit's WatchData/WatchSession+Data.swift (with WatchStorage's and
// WatchFinding's session parts). Each operation runs alone on the link (`session.exclusively`); a file read is one
// exclusive request per block, so a face install can run between two blocks.
import { CorosError } from "./bytes";
import { requireAcknowledgement } from "./commands";
import { BLOCK_BYTES, blockHeader } from "./dataFile";
import { supports, targetOf, type Feature } from "./models";
import { WatchProfile } from "./profile";
import { checkWrite, satelliteModeOf, satelliteSettingsFile, type SatelliteMode } from "./satellite";
import { SETTINGS_FILE } from "./settingsFile";
import { decodeSettings, encodeSettings, EXTENDED_SWITCHES, SETTINGS_GET, SETTINGS_SET, settingsRequest, switchesFrom, USER_INFO, type WatchSwitches } from "./settings";
import { decodeStorage, STORAGE_OPCODE, STORAGE_REQUEST, type WatchStorage } from "./storage";
import { SyncRefused } from "./transport";
import { SYNC_USER_INFO, SyncUserInfo, type SleepSchedule } from "./userInfo";
import { READ_OPCODE, READ_REQUEST, clearPayload, WRITE_OPCODE, writePayload, type WatchAlarm } from "./alarms";
import type { WatchSession } from "./session";

/** SyncData files C-LINK reads (CorosKit's WatchSyncFile); never acknowledged, so the COROS app still gets every record. */
export const DAILY_HISTORY = 5;
export const SPORT_RECORDS = 14;
export { SETTINGS_FILE };
const MAXIMUM_FILE_BYTES = 64 * 1024 * 1024;
/** Page size of the watch's record files; the last page of a stored copy is always read again. */
export const PAGE_BYTES = 4096;

/** GetPedometer: today's running totals; like the other control reads, the request carries one 0x00 byte. */
export const PEDOMETER_OPCODE = 0x90;
/** Find Watch: control 0xB4 with no data, sent as the COROS app's writer sends it: no checksum byte. */
export const FINDING_OPCODE = 0xb4;
export const FINDING_REQUEST = Buffer.from([0xb4, 0x00]);

/** Waits the engine keeps as CorosKit does; tests shorten them. */
export const timing = { retryMs: 2000, satelliteSettleMs: 2000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Progress = (read: number, total: number) => void;

function requireFeature(session: WatchSession, feature: Feature): void {
  session.requireAuthenticated();
  if (!supports(session.link.info, feature)) throw new CorosError("Not available on this watch.");
}

async function settingsNow(session: WatchSession, types: number[]): Promise<Map<number, Buffer>> {
  return decodeSettings(await session.link.exchange(SETTINGS_GET, settingsRequest(types), 20));
}

async function switchesNow(session: WatchSession): Promise<WatchSwitches> {
  return switchesFrom(await settingsNow(session, [EXTENDED_SWITCHES]), targetOf(session.link.info));
}

async function profileNow(session: WatchSession): Promise<WatchProfile> {
  const bytes = (await settingsNow(session, [USER_INFO])).get(USER_INFO);
  if (!bytes || bytes.length === 0) throw new CorosError("The watch didn't return its training profile.");
  return WatchProfile.decode(bytes);
}

async function writeSettings(session: WatchSession, entries: [number, Uint8Array][]): Promise<void> {
  await session.link.exchange(SETTINGS_SET, encodeSettings(entries), Math.min(240, session.link.info.maximumWriteBytes));
}

/** A write, then what the watch holds. A write whose reply didn't arrive may still have been applied, so the watch is read before it counts as failed. */
async function writeThenRead<T>(session: WatchSession, write: () => Promise<void>, read: () => Promise<T>): Promise<T> {
  try {
    await write();
  } catch (error) {
    if (!session.link.isConnected) throw error;
    try { return await read(); } catch { throw error; }
  }
  return read();
}

// ── Settings, profile, goals ──

/** Writes the switch records whole, as the app does, then reads back what the watch kept. */
export function writeSwitches(session: WatchSession, switches: WatchSwitches, replacing: WatchSwitches): Promise<WatchSwitches> {
  requireFeature(session, "settings");
  return session.exclusively(() => writeThenRead(session, () => writeSettings(session, switches.entries(replacing)), () => switchesNow(session)));
}

export function readProfile(session: WatchSession): Promise<WatchProfile> {
  requireFeature(session, "profile");
  return session.exclusively(() => profileNow(session));
}

/** Writes a training profile (setting 10) and returns what the watch holds afterwards. */
export function writeProfile(session: WatchSession, profile: WatchProfile): Promise<WatchProfile> {
  requireFeature(session, "profile");
  return session.exclusively(() => writeThenRead(session, () => writeSettings(session, [[USER_INFO, profile.encoded()]]), () => profileNow(session)));
}

/** The profile that holds the daily goals, from a fresh settings file. */
export async function readUserInfo(session: WatchSession): Promise<SyncUserInfo> {
  requireFeature(session, "dailyGoal");
  return SyncUserInfo.fromSettingsFile(await readSettingsFile(session));
}

/** Sends a changed SyncUserInfo whole over 0x8B (20-byte writes), then reads it back. */
async function writeUserInfo(session: WatchSession, current: SyncUserInfo, next: SyncUserInfo, refusal: string): Promise<SyncUserInfo> {
  if (!current.looksWritten) throw new CorosError("The watch's profile looks wrong, so C-LINK didn't change it.");
  return writeThenRead(session, () => session.exclusively(async () => {
    requireAcknowledgement(await session.link.exchange(SYNC_USER_INFO, next.bytes, 20), refusal);
  }), () => readUserInfo(session));
}

/**
 * Sets the goals given in one write, as the COROS app does: the watch's own profile with only the goals changed, all
 * 71 bytes over 0x8B, then read back. Returns what the watch holds afterwards. Watch faces read the calorie and
 * exercise-time goals; nothing on a PACE Pro reads the step goal.
 */
export async function setGoals(session: WatchSession, goals: { calories?: number; steps?: number; exerciseMinutes?: number }): Promise<SyncUserInfo> {
  const current = await readUserInfo(session);
  let next = current;
  if (goals.calories !== undefined) next = next.settingCalorieGoal(goals.calories);
  if (goals.steps !== undefined) next = next.settingStepGoal(goals.steps);
  if (goals.exerciseMinutes !== undefined) next = next.settingExerciseGoalMinutes(goals.exerciseMinutes);
  if (next.equals(current)) return current;
  const stored = await writeUserInfo(session, current, next, "The watch didn't accept the new goal.");
  if (stored.calorieGoal !== next.calorieGoal || stored.stepGoal !== next.stepGoal || stored.exerciseGoalSeconds !== next.exerciseGoalSeconds) {
    throw new CorosError("The watch didn't keep the new goal.");
  }
  return stored;
}

/** Sets the sleep schedule (Sleep Time and Wake Time) as `setGoals` sets the goals: bytes 55–58 only. */
export async function setSleepSchedule(session: WatchSession, schedule: SleepSchedule): Promise<SyncUserInfo> {
  const current = await readUserInfo(session);
  const next = current.settingSleepSchedule(schedule);
  if (next.equals(current)) return current;
  const stored = await writeUserInfo(session, current, next, "The watch didn't accept the new sleep schedule.");
  const kept = stored.sleepSchedule;
  if (!kept || kept.bedtime !== schedule.bedtime || kept.wake !== schedule.wake) throw new CorosError("The watch didn't keep the new sleep schedule.");
  return stored;
}

// ── Today's steps, storage, ring ──

/** GetPedometer's raw reply (today's steps, distance, calories, active time); PedometerTotals decodes it. */
export function readPedometerBytes(session: WatchSession): Promise<Buffer> {
  requireFeature(session, "healthSync");
  return session.exclusively(() => session.link.exchange(PEDOMETER_OPCODE, Buffer.from([0]), 20));
}

/** The watch's storage, alone on the link. */
export function readStorage(session: WatchSession): Promise<WatchStorage> {
  session.requireAuthenticated();
  return session.exclusively(async () => decodeStorage(await session.link.exchange(STORAGE_OPCODE, STORAGE_REQUEST, 20)));
}

/** Asks the watch to ring until its back button is pressed, and returns its status byte (1 is likely success). */
export function ringWatch(session: WatchSession): Promise<number> {
  session.requireAuthenticated();
  return session.exclusively(async () => {
    const reply = await session.link.exchangeFrames([FINDING_REQUEST], FINDING_OPCODE);
    if (reply.length === 0) throw new CorosError("The watch didn't answer.");
    return reply[0];
  });
}

// ── Alarms (EXPERIMENTAL) ──

function requireAlarms(session: WatchSession): void {
  session.requireAuthenticated();
  if (!supports(session.link.info, "alarms")) throw new CorosError("C-LINK can't read this watch's alarms yet.");
}

/** The reassembled reply to the alarm read (`A7 00 02 02`), undecoded; `decodeAlarms` turns it into alarms. */
export function readAlarmBytes(session: WatchSession): Promise<Buffer> {
  requireAlarms(session);
  return session.exclusively(() => session.link.exchange(READ_OPCODE, READ_REQUEST, 20));
}

/** Overwrites one slot with 0x87 and returns the reply; an acknowledgement doesn't show it was kept, so read back. */
export function writeAlarm(session: WatchSession, alarm: WatchAlarm): Promise<Buffer> {
  requireAlarms(session);
  const payload = writePayload(alarm);
  return session.exclusively(() => session.link.exchange(WRITE_OPCODE, payload, 20));
}

/** Deletes an alarm by turning it off, then writing its slot empty, so a delete the watch doesn't take still leaves it silent. */
export function clearAlarm(session: WatchSession, alarm: WatchAlarm): Promise<Buffer> {
  requireAlarms(session);
  const off = writePayload({ ...alarm, enabled: false });
  const clear = clearPayload(alarm.slot);
  return session.exclusively(async () => {
    await session.link.exchange(WRITE_OPCODE, off, 20);
    return session.link.exchange(WRITE_OPCODE, clear, 20);
  });
}

// ── Record files ──

/**
 * Where to read next when an earlier copy of the file is stored, after the watch sent `block` at `blockOffset` in a
 * file of `total` bytes: null when the watch's bytes differ from the stored copy (or the file shrank), so the whole
 * file must be read; otherwise the next offset, which skips to the stored copy's last page when the block ends before
 * it. The watch only appends to these files, so a sync reads just what it gained.
 */
export function nextOffset(stored: Uint8Array, block: Uint8Array, blockOffset: number, total: number): number | null {
  if (total < stored.length) return null;
  const overlapEnd = Math.min(stored.length, blockOffset + block.length);
  if (overlapEnd > blockOffset && !Buffer.from(block.subarray(0, overlapEnd - blockOffset)).equals(stored.subarray(blockOffset, overlapEnd))) return null;
  const end = blockOffset + block.length;
  const lastPage = stored.length === 0 ? 0 : Math.floor((stored.length - 1) / PAGE_BYTES) * PAGE_BYTES;
  return end < lastPage ? lastPage : end;
}

/**
 * One SyncData block, alone on the link. A refusal goes straight back (asking again gets the same answer); another
 * failure is asked again once, after 2 s, with the link kept up (dropping it hung up a waking PACE Pro twice).
 */
function syncBlock(session: WatchSession, fileIndex: number, offset: number): Promise<{ remaining: number; block: Buffer }> {
  return session.exclusively(async () => {
    const link = session.link;
    if (!link.isConnected) throw new CorosError("The watch disconnected. Keep it nearby and reconnect.");
    try {
      return await link.readSyncBlock(fileIndex, offset);
    } catch (error) {
      if (error instanceof SyncRefused || !link.isConnected) throw error;
      await sleep(timing.retryMs);
      if (!link.isConnected) throw error;
      return link.readSyncBlock(fileIndex, offset);
    }
  });
}

/**
 * A file the watch only appends to (daily history, workouts), read by offset and never acknowledged. With `stored`,
 * the copy kept from an earlier sync, only what the watch added since is read, once its first block and the stored
 * copy's last page match; otherwise the whole file. The read stops at the length the watch first reported.
 */
async function readAppendingFile(session: WatchSession, fileIndex: number, stored: Uint8Array | null | undefined, changed: string,
  progress: Progress, signal?: AbortSignal): Promise<Buffer> {
  let parts: Uint8Array[] = [];
  let offset = 0;
  let total: number | null = null;
  let known: Uint8Array | null = stored && stored.length > 0 ? stored : null;
  do {
    signal?.throwIfAborted();
    let remaining: number, block: Buffer;
    try {
      ({ remaining, block } = await syncBlock(session, fileIndex, offset));
    } catch (error) {
      // Code 0x14 on the first block, with a zero size: the watch has no file to give.
      if (offset === 0 && error instanceof SyncRefused && error.isNothing) return Buffer.alloc(0);
      throw error;
    }
    // The watch has nothing: the COROS app synced and it dropped every record.
    if (offset === 0 && remaining === 0 && block.length === 0) return Buffer.alloc(0);
    const fileTotal: number = total ?? offset + remaining;
    total = fileTotal;
    if (block.length === 0 || offset + remaining < fileTotal || fileTotal > MAXIMUM_FILE_BYTES) throw new CorosError(changed);
    let next = offset + block.length;
    if (known) {
      const planned = nextOffset(known, block, offset, fileTotal);
      if (planned !== null) {
        if (planned > next) {
          // Skip to the stored copy's last page: the bytes before it are the stored ones.
          parts = [known.subarray(0, planned)];
          next = planned;
        } else {
          parts.push(block);
        }
        if (offset + block.length >= known.length) known = null;
      } else {
        // Not the file stored last time (it shrank or was rewritten): read all of it.
        known = null;
        if (offset !== 0) { parts = []; offset = 0; continue; }
        parts.push(block);
      }
    } else {
      parts.push(block);
    }
    offset = next;
    progress(Math.min(offset, fileTotal), fileTotal);
  } while (offset < (total ?? 0));
  const all = Buffer.concat(parts);
  return all.subarray(0, total ?? all.length);
}

/**
 * The settings file (file 54), read by offset and never acknowledged. The watch writes a fresh snapshot for each read
 * from the start and serves the rest of a read from it; a PACE Pro's fits in one block.
 */
export async function readSettingsFile(session: WatchSession, signal?: AbortSignal): Promise<Buffer> {
  requireFeature(session, "healthSync");
  const parts: Buffer[] = [];
  let read = 0, total = 0;
  do {
    signal?.throwIfAborted();
    const { remaining, block } = await syncBlock(session, SETTINGS_FILE, read);
    if (read === 0) total = remaining;
    if (block.length === 0 || read + remaining !== total) throw new CorosError("The watch's settings changed while they were being read. Sync again.");
    parts.push(block);
    read += block.length;
  } while (read < total);
  return Buffer.concat(parts);
}

/**
 * Reads a SyncData file as CorosKit's readDailyHistory (5), readSportRecords (14) or readSettingsFile (54) does.
 * `stored` (the copy kept from the last sync) only applies to the appending files 5 and 14.
 */
export function readSyncFile(session: WatchSession, fileIndex: number, stored?: Uint8Array | null, progress: Progress = () => {},
  signal?: AbortSignal): Promise<Buffer> {
  switch (fileIndex) {
    case DAILY_HISTORY:
      requireFeature(session, "healthSync");
      return readAppendingFile(session, fileIndex, stored, "The watch's daily history changed while it was being read. Sync again.", progress, signal);
    case SPORT_RECORDS:
      requireFeature(session, "workouts");
      return readAppendingFile(session, fileIndex, stored, "The watch's workouts changed while they were being read. Sync again.", progress, signal);
    case SETTINGS_FILE:
      return readSettingsFile(session, signal);
    default:
      throw new CorosError("The watch sync request is invalid.");
  }
}

// ── Satellite Systems ──

/**
 * Sends a settings file (small: the header chunk and the global record) in 4 KB SendFile blocks. A transfer that stops
 * partway drops the link, as route sends do.
 */
export function sendSettingsFile(session: WatchSession, file: Uint8Array): Promise<void> {
  requireFeature(session, "satelliteMode");
  if (file.length <= 16 || file[3] !== SETTINGS_FILE) throw new CorosError("That isn't a settings file.");
  return session.exclusively(async () => {
    let offset = 0;
    try {
      while (offset < file.length) {
        const block = file.subarray(offset, Math.min(offset + BLOCK_BYTES, file.length));
        await session.link.sendFileBlock(blockHeader(SETTINGS_FILE, block, offset, file.length), block, SETTINGS_FILE);
        offset += block.length;
      }
    } catch (error) {
      if (offset > 0) await session.link.disconnect();
      throw error;
    }
  });
}

/**
 * Sets Satellite Systems from a fresh read of the settings file, then reads it back and checks it. Returns the file
 * read first, the one read after, and the problems, empty when it worked.
 */
export async function setSatelliteMode(session: WatchSession, mode: SatelliteMode): Promise<{ before: Buffer; after: Buffer; problems: string[] }> {
  requireFeature(session, "satelliteMode");
  const before = await readSettingsFile(session);
  if (satelliteModeOf(before) === mode) return { before, after: before, problems: [] };
  await sendSettingsFile(session, satelliteSettingsFile(before, mode));
  await sleep(timing.satelliteSettleMs);
  const after = await readSettingsFile(session);
  return { before, after, problems: checkWrite(mode, before, after) };
}
