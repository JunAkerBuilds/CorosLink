// One sync, as the CorosKit helper's Syncer.sync does it (the retired clink-watch helper's main.swift): the waiting
// changes first, then everything the iPhone reads on a connection, handing back the same sync items the iPhone sends
// (docs/sync-contract.md §4–5). Each step that fails is reported in `problems` and the rest still run, as on the iPhone.
import { canonical } from "@/data/sync/canonical";
import { alarmDays, contractDays, decodeAlarms, hasValidTime } from "./alarms";
import { parseDailyHistory } from "./dailyHistory";
import { healthDays, healthNights } from "./healthItems";
import { Kept, type BatteryReading } from "./kept";
import { displayName, firmwareLabel, satelliteChoices, supports, targetOf, type DeviceInfo } from "./models";
import { calendarDay, sameDay } from "./native";
import { gpsModeName, satelliteModeOf, type SatelliteMode } from "./satellite";
import type { WatchSession } from "./session";
import { userInfo } from "./settingsFile";
import { storageUsed } from "./storage";
import { DAILY_HISTORY, readAlarmBytes, readPedometerBytes, readProfile, readSettingsFile, readStorage, readSyncFile, readUserInfo, SPORT_RECORDS } from "./watchData";
import { decodeHealth, defaultSleepProfile, encodeHealth, newWatchHealth, parsePedometer, recordDailyHistory, recordPedometer, recordProfile, sleepProfileFromUserInfo, type WatchHealth } from "./watchHealth";
import { applyChanges, type PendingChange } from "./watchSettings";
import { BATTERY_HISTORY_DAYS, thinned, watchStateBody, type WatchState } from "./watchState";
import { sendWeatherIfDue, type WeatherPlace } from "./weather";
import { workoutItems } from "./workouts";

export interface SyncItemOut { collection: string; id: string; body: string }
export interface SyncResult {
  items: SyncItemOut[]; applied: string[]; refused: string[]; problems: string[];
  watch: Record<string, unknown>; workouts: number; healthDays: number; nights: number; weatherSent: boolean;
}

export interface SyncRequest {
  kept: Kept;
  changes: PendingChange[];
  stepGoal?: number;
  weather: WeatherPlace | null;
}

export interface SyncHost {
  session: WatchSession;
  info: () => DeviceInfo;
  isConnected: () => boolean;
  describe: (info: DeviceInfo) => Record<string, unknown>;
  emit: (event: Record<string, unknown>) => void;
  now?: () => Date;
}

const item = (collection: string, id: string, body: unknown): SyncItemOut => ({ collection, id, body: canonical(body) });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const percent = (read: number, total: number) => Math.trunc((read / total) * 100);

export async function sync(host: SyncHost, request: SyncRequest): Promise<SyncResult> {
  const { session, emit } = host;
  const now = host.now ?? (() => new Date());
  const info = host.info();
  const { kept } = request;
  const problems: string[] = [];
  async function attempt<T>(step: string, work: () => Promise<T>): Promise<T | undefined> {
    emit({ event: "progress", step });
    try { return await work(); } catch (error) {
      problems.push(`${step}: ${message(error)}`);
      return undefined;
    }
  }

  // The web's changes, as CloudSync.applyWatchChanges writes them.
  const applied = await applyChanges(session, info, request.changes, host.isConnected, () => emit({ event: "progress", step: "changes" }));

  let health: WatchHealth;
  try { const text = kept.read(kept.healthFile); health = text ? decodeHealth(text.toString("utf8")) : newWatchHealth(); } catch { health = newWatchHealth(); }
  let battery: BatteryReading[] = kept.battery();
  if (info.batteryPercent !== undefined) battery.push({ at: now(), percent: info.batteryPercent });

  let settingsFile: Buffer | undefined;
  if (supports(info, "healthSync")) {
    const steps = await attempt("steps", async () => parsePedometer(await readPedometerBytes(session)));
    if (steps) recordPedometer(health, steps, now());
    const stored = kept.read(kept.dailyHistory);
    const file = await attempt("health", () => readSyncFile(session, DAILY_HISTORY, stored, (read, total) => {
      if (total > 0) emit({ event: "progress", step: "health", percent: percent(read, total) });
    }));
    if (file) {
      settingsFile = await attempt("settings", () => readSettingsFile(session));
      let profile = health.sleepProfile ?? defaultSleepProfile();
      if (settingsFile) { try { profile = sleepProfileFromUserInfo(userInfo(settingsFile)); } catch { /* the profile read before */ } }
      try {
        const history = parseDailyHistory(file);
        recordDailyHistory(health, history, profile, now());
        battery.push(...history.battery.map((b) => ({ at: b.time, percent: b.percent })));
      } catch { /* a damaged file adds nothing, as on the iPhone */ }
      if (!stored || !stored.equals(file)) kept.write(kept.dailyHistory, file);
    }
  }
  if (supports(info, "profile")) {
    const profile = await attempt("profile", () => readProfile(session));
    if (profile) recordProfile(health, profile);
  }
  // The weather, as the iPhone sends it on each connection.
  let weatherSent = false;
  if (supports(info, "weather") && request.weather) {
    const place = request.weather;
    weatherSent = (await attempt("weather", () => sendWeatherIfDue(session, place, kept.folder, false))) ?? false;
  }
  try { kept.write(kept.healthFile, encodeHealth(health)); } catch { /* kept next time */ }

  // Battery readings: one a reading time, the last 60 days.
  const since = now().getTime() - BATTERY_HISTORY_DAYS * 86_400_000;
  const byTime = new Map<number, number>();
  for (const reading of battery) if (reading.at.getTime() >= since) byTime.set(reading.at.getTime(), reading.percent);
  battery = [...byTime].sort((a, b) => a[0] - b[0]).map(([at, p]) => ({ at: new Date(at), percent: p }));
  try { kept.saveBattery(battery); } catch { /* kept next time */ }

  const goals = supports(info, "dailyGoal") ? await attempt("goals", () => readUserInfo(session)) : undefined;
  const alarms = supports(info, "alarms") ? await attempt("alarms", async () => decodeAlarms(await readAlarmBytes(session)).filter(hasValidTime)) : undefined;
  const storage = await attempt("storage", () => readStorage(session));
  let satellite: SatelliteMode | null = null;
  if (settingsFile) { try { satellite = satelliteModeOf(settingsFile); } catch { satellite = null; } }

  // Workouts: read only, never acknowledged, so the COROS app could still take every one later.
  const items: SyncItemOut[] = [];
  let workoutCount = 0;
  if (supports(info, "workouts")) {
    const stored = kept.read(kept.sportRecords);
    const file = await attempt("workouts", () => readSyncFile(session, SPORT_RECORDS, stored, (read, total) => {
      if (total > 0) emit({ event: "progress", step: "workouts", percent: percent(read, total) });
    }));
    if (file) {
      if (!stored || !stored.equals(file)) kept.write(kept.sportRecords, file);
      const made = workoutItems(file, {
        readFit: (id) => kept.read(kept.fitFile(id)),
        writeFit: (id, bytes) => { try { kept.write(kept.fitFile(id), bytes); } catch { /* made again next time */ } },
        details: kept.details(),
      }, health.insights.fitness?.thresholdHR);
      items.push(...made.items.map((i) => item(i.collection, i.id, i.body)));
      try { kept.saveDetails(new Set(made.details)); } catch { /* sent again next time */ }
      workoutCount = made.count;
    }
  }

  // Health: the days and nights the watch's history gives, as the iPhone sends them.
  const today = calendarDay(now());
  const days = healthDays(health.insights, today), nights = healthNights(health.insights, today);
  for (const h of [...days, ...nights]) items.push(item(h.collection, h.id, h.body));

  // The watch as the Watch page shows it.
  const state: WatchState = {
    name: info.name ? displayName(info.name) : undefined,
    model: targetOf(info)?.label,
    firmware: firmwareLabel(info) ?? undefined,
    syncedAt: now(),
  };
  const last = battery.at(-1);
  if (last) state.battery = { percent: last.percent, readAt: last.at };
  if (storage && storage.total > 0) state.storage = { usedBytes: storageUsed(storage), totalBytes: storage.total };
  if (goals) {
    state.goalCalories = goals.calorieGoal;
    state.goalExerciseMinutes = Math.trunc(goals.exerciseGoalSeconds / 60);
  }
  state.goalSteps = request.stepGoal ?? goals?.stepGoal;
  const reading = health.today;
  if (reading && sameDay(reading.day, today)) {
    state.todaySteps = reading.steps;
    state.todayCalories = reading.calories;
    state.todayExerciseMinutes = reading.activeSeconds === undefined ? undefined : Math.trunc(reading.activeSeconds / 60);
  }
  if (alarms) {
    state.alarms = alarms.map((a) => ({ slot: a.slot, enabled: a.enabled, hour: a.hour, minute: a.minute, days: contractDays(alarmDays(a)) }));
    state.alarmsReadAt = now();
  }
  if (satellite) state.gpsMode = gpsModeName(satellite);
  const schedule = health.sleepProfile?.schedule;
  if (schedule) state.sleepSchedule = { bedtime: schedule.bedtime, wake: schedule.wake };
  state.gpsModes = satelliteChoices(targetOf(info))?.map((m) => gpsModeName(m as SatelliteMode));
  state.batteryHistory = thinned(battery, 1000);
  // Not in the iPhone's body: where it synced, so the Watch page says "with this computer".
  items.push(item("watch.state", "me", { ...watchStateBody(state, now()), via: "computer" }));

  return {
    items, applied: applied.applied, refused: applied.refused, problems,
    watch: host.describe(info), workouts: workoutCount,
    healthDays: health.insights.days.length, nights: health.insights.nights.length, weatherSent,
  };
}

