// The watch's own settings as the Watch settings page edits them, and the web's waiting changes, in the shapes the
// CorosKit helper answered (the retired clink-watch helper's main.swift: `Settings` and `Syncer.apply`/`writeAlarms`).
// Each write is read back; only the models CorosKit has checked are touched (models.ts `supports`).
import { CorosError } from "./bytes";
import { decodeAlarms, alarmDays, hasValidTime, type WatchAlarm } from "./alarms";
import { satelliteChoices, supports, targetOf, type DeviceInfo } from "./models";
import type { WatchProfile, ZoneType } from "./profile";
import { satelliteModeNamed } from "./satellite";
import type { WatchSwitches } from "./settings";
import type { WatchSession } from "./session";
import type { SleepSchedule } from "./userInfo";
import { alarmPlan, parseWatchChange, type ChangeAlarm } from "./watchChange";
import {
  clearAlarm, readAlarmBytes, readProfile, readUserInfo, setGoals, setSatelliteMode, setSleepSchedule, writeAlarm, writeProfile, writeSwitches,
} from "./watchData";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface SwitchRow { key: string; value: number; values: Record<string, string>; edit?: number[] }

/** Switches whose values are known (`confirmed`), with the values C-LINK may write (`edit`, none for read-only). */
export function switchRows(s: WatchSwitches): SwitchRow[] {
  return s.fields.filter((f) => f.status === "confirmed").flatMap((field) => {
    const value = s.valueOf(field);
    if (value === null) return [];
    const row: SwitchRow = { key: field.key, value, values: Object.fromEntries(Object.entries(field.values).map(([k, v]) => [String(k), v])) };
    if (field.edit) row.edit = field.edit;
    return [row];
  });
}

export interface ProfileView {
  maxHR: number; restingHR: number; thresholdHR: number; zoneType: ZoneType; thresholdPace: number; ftp: number; criticalPower: number; zones: number[];
}

export function profileView(p: WatchProfile): ProfileView {
  return { maxHR: p.maxHR, restingHR: p.restingHR, thresholdHR: p.thresholdHR, zoneType: p.zoneType ?? "maxHR",
    thresholdPace: p.thresholdPace, ftp: p.ftp, criticalPower: p.criticalPower, zones: p.activeHRZones };
}

export const sleepView = (schedule: SleepSchedule | null): SleepSchedule | null => (schedule ? { bedtime: schedule.bedtime, wake: schedule.wake } : null);

export interface SettingsRead { switches?: SwitchRow[]; profile?: ProfileView; sleep?: SleepSchedule | null; problems: string[] }

/** Everything the page shows; a part the watch doesn't answer is left out and named in `problems`. */
export async function settingsRead(session: WatchSession, info: DeviceInfo): Promise<SettingsRead> {
  const out: SettingsRead = { problems: [] };
  if (supports(info, "settings")) {
    try { out.switches = switchRows(await session.readSwitches()); } catch (e) { out.problems.push(`settings: ${messageOf(e)}`); }
  }
  if (supports(info, "profile")) {
    try { out.profile = profileView(await readProfile(session)); } catch (e) { out.problems.push(`profile: ${messageOf(e)}`); }
  }
  if (supports(info, "dailyGoal")) {
    try { out.sleep = sleepView((await readUserInfo(session)).sleepSchedule); } catch (e) { out.problems.push(`sleep: ${messageOf(e)}`); }
  }
  return out;
}

export async function setSwitch(session: WatchSession, key: string, value: number): Promise<SwitchRow[]> {
  const current = await session.readSwitches();
  const stored = await writeSwitches(session, current.setting(key, value), current);
  if (stored.value(key) !== value) throw new CorosError("The watch didn't keep that change.");
  return switchRows(stored);
}

const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

/** `request`: maxHR, restingHR, thresholdHR, thresholdPace (whole numbers) and zoneType ("maxHR", "reserve", "threshold"). */
export async function setProfile(session: WatchSession, request: Record<string, unknown>): Promise<ProfileView> {
  const zone = (["maxHR", "reserve", "threshold"] as const).find((z) => z === request.zoneType);
  const edits = { maxHR: int(request.maxHR), restingHR: int(request.restingHR), thresholdHR: int(request.thresholdHR), zoneType: zone, thresholdPace: int(request.thresholdPace) };
  const current = await readProfile(session);
  return profileView(await writeProfile(session, current.editing(edits)));
}

export async function setSleep(session: WatchSession, bedtime: number, wake: number): Promise<SleepSchedule | null> {
  const inDay = (v: number) => Number.isInteger(v) && v >= 0 && v < 1440;
  if (!inDay(bedtime) || !inDay(wake)) throw new CorosError("Pick a bedtime and a wake time.");
  return sleepView((await setSleepSchedule(session, { bedtime, wake })).sleepSchedule);
}

/** A waiting change as the helper took it: the item's id and its body as JSON text (or already parsed). */
export interface PendingChange { id?: unknown; body?: unknown }

/**
 * The web's waiting changes (§5.4), as the iPhone writes them. Returns the ids written and those the watch can't take;
 * a change that failed because the link dropped is in neither, so it's tried at the next sync.
 */
export async function applyChanges(session: WatchSession, info: DeviceInfo, changes: PendingChange[],
  isConnected: () => boolean = () => session.link.isConnected, onChange: () => void = () => {}): Promise<{ applied: string[]; refused: string[] }> {
  const applied: string[] = [], refused: string[] = [];
  for (const raw of changes) {
    if (typeof raw.id !== "string" || raw.body === undefined) continue;
    let body: unknown = raw.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { continue; } }
    const id = raw.id;
    const change = parseWatchChange(id, body);
    if (!change) { refused.push(id); continue; }
    onChange();
    try {
      let taken = true;
      const v = change.value;
      if (change.key === "goal.calories" && "number" in v) {
        if (supports(info, "dailyGoal")) await setGoals(session, { calories: v.number }); else taken = false;
      } else if (change.key === "goal.exerciseMinutes" && "number" in v) {
        if (supports(info, "dailyGoal")) await setGoals(session, { exerciseMinutes: v.number }); else taken = false;
      } else if (change.key === "goal.steps" && "number" in v) {
        // Kept on this computer as the iPhone keeps it; the watch takes it too where it can.
        if (supports(info, "dailyGoal")) await setGoals(session, { steps: v.number }).catch(() => {});
      } else if (change.key === "gpsMode" && "mode" in v) {
        const mode = satelliteModeNamed(v.mode);
        if (supports(info, "satelliteMode") && mode && satelliteChoices(targetOf(info))?.includes(mode)) {
          taken = (await setSatelliteMode(session, mode)).problems.length === 0;
        } else taken = false;
      } else if (change.key === "alarms" && "alarms" in v) {
        taken = supports(info, "alarms") ? await writeAlarms(session, v.alarms) : false;
      } else {
        taken = false;
      }
      (taken ? applied : refused).push(id);
    } catch {
      if (!isConnected()) continue;
      refused.push(id);
    }
  }
  return { applied, refused };
}

const sameAlarm = (a: WatchAlarm, b: WatchAlarm) =>
  a.slot === b.slot && a.hour === b.hour && a.minute === b.minute && a.enabled === b.enabled && alarmDays(a) === alarmDays(b);

/** Makes the watch's alarms `wanted`: clears, then writes, then reads back; false when they don't fit or weren't kept. */
export async function writeAlarms(session: WatchSession, wanted: ChangeAlarm[]): Promise<boolean> {
  const read = async () => decodeAlarms(await readAlarmBytes(session)).filter(hasValidTime);
  const current = await read();
  const plan = alarmPlan(wanted, current);
  if (!plan) return false;
  for (const alarm of plan.clear) await clearAlarm(session, alarm);
  for (const alarm of plan.write) await writeAlarm(session, alarm);
  if (plan.clear.length === 0 && plan.write.length === 0) return true;
  const after = await read();
  return plan.write.every((alarm) => after.some((a) => sameAlarm(a, alarm)));
}
