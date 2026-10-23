import crypto from "node:crypto";
import { listAthleteFacts, deleteAthleteFact, saveAthleteFact, undoAthleteMemoryChange } from "./athleteMemoryStore";
import type { AthleteMemoryChange, AthleteMemoryNotice } from "./athleteMemoryModel";
import {
  type AthleteToolDependencies,
  type AthleteZonesSnapshot,
  type ZoneEdits
} from "./chatAthleteTools";
import { buildCoachDataStatus, type CoachDataStatus } from "./coachDataStatus";
import { CoachReviewNotSentError, createCoachReviewService, type CoachReviewOutcome } from "./coachReviewActions";
import type { CoachReviewAction, CoachReviewPreview } from "./coachReviewTypes";
import { summarizeForecastDay } from "./coachWeather";
import { corosNativeBle } from "./corosNativeBleService";
import { fetchWatchForecast, type WatchForecast } from "./corosWatchWeather";
import { getSetting, listStoredStrengthSessions, setSetting } from "./database";
import { recentSyncErrors } from "./diagnosticsService";
import { getStoredHevyStrengthSessions } from "./hevyService";
import { currentActivitySource, usingLocalSources } from "./localSync/activitySource";
import { watchSupports } from "./localSync/watchSyncModels";
import { corosMcpServerId, getMcpServerStatus } from "./mcpClientManager";
import { buildPlanCompliance } from "./planCompliance";
import { addRaceTarget, getRaceOverview, normalizeRaceTarget } from "./raceService";
import type { RaceTarget } from "./raceTypes";
import { syncStrengthHistory } from "./strengthHistoryService";
import { buildStrengthProgress } from "./strengthProgress";
import { getStoredStravaStrengthSessions } from "./stravaService";
import {
  getTrainingHubStatus,
  getWorkoutEditorContext,
  listScheduledWorkoutEntries,
  readNativeTrainingPlanEndpoint
} from "./trainingHubService";
import { listManualActivityLinks } from "./trainingLibraryService";
import type { ClaudeCodePermissions, StrengthSession, UnitSystem } from "./types";
import { formatPaceValue } from "./unitSystem";
import { getWatchProfile, updateWatchProfile } from "./watchProfileService";
import { getWeatherLocation, searchWeatherPlaces } from "./watchWeatherService";

// The athlete tools' services, as the app runs them: SQLite stores, the
// Training Hub (or Local-Only Mode's calendar), Open-Meteo, the watch.

const REVIEWS_SETTING = "chat.coachReviews";
const FORECAST_FRESH_MS = 30 * 60_000;

function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

// ----- Local-Only Mode's watch syncs (main registers the reader) -----

let localSyncReader: (() => { activities?: { finishedAt?: string; startedAt: string }; health?: { finishedAt?: string; startedAt: string } } | undefined) | undefined;

export function setCoachLocalSyncReader(reader: typeof localSyncReader): void {
  localSyncReader = reader;
}

// ----- Approvals -----

// chatService owns the settings; it registers how to read Claude's switches (importing it here would be circular).
let claudePermissions: () => ClaudeCodePermissions | undefined = () => undefined;

export function setCoachReviewPermissions(read: () => ClaudeCodePermissions): void {
  claudePermissions = read;
}

function claudeAllows(action: CoachReviewAction, claude: ClaudeCodePermissions | undefined): boolean {
  if (!claude) return true;
  if (action === "addTargetRace") return claude.recentActivities;
  return claude.trainingMetrics;
}

const reviews = createCoachReviewService({
  load: () => getSetting(REVIEWS_SETTING),
  save: (value) => setSetting(REVIEWS_SETTING, value),
  canConfirm: (action, claude) => !claude || claudeAllows(action, claudePermissions()),
  execute: executeReview
});

export function confirmCoachReview(requestId: string): Promise<CoachReviewPreview> {
  return reviews.confirm(requestId);
}

export function dismissCoachReview(requestId: string): CoachReviewPreview {
  return reviews.dismiss(requestId);
}

async function executeReview(action: CoachReviewAction, payload: unknown, preview: CoachReviewPreview): Promise<CoachReviewOutcome> {
  if (action === "addTargetRace") {
    // Checked again on save: the race day may have passed since the card was prepared.
    const saved = addRaceTarget(payload as Omit<RaceTarget, "targetId" | "createdAt">);
    return { results: preview.items.map(() => ({ ok: true })), message: `${saved.name} is in your Races list.` };
  }
  const outcome = await executeZoneUpdate(payload as { edits: ZoneEdits; expected: NonNullable<AthleteZonesSnapshot["current"]> });
  return { ...outcome, results: preview.items.map(() => ({ ok: true })) };
}

async function executeZoneUpdate(payload: { edits: ZoneEdits; expected: NonNullable<AthleteZonesSnapshot["current"]> }): Promise<CoachReviewOutcome> {
  const watch = corosNativeBle.localSyncWatch();
  if (!watch) throw new CoachReviewNotSentError("Connect your watch over Bluetooth, then click Update watch again.");
  if (!watchSupports("profile", watch.model)) throw new CoachReviewNotSentError("CorosLink can't change zones on this watch model yet.");
  const stored = getWatchProfile();
  const expected = payload.expected;
  if (stored && (stored.maxHr !== expected.maxHr || stored.restingHr !== expected.restingHr || stored.thresholdHr !== expected.thresholdHr ||
    stored.thresholdPaceSecondsPerKm !== expected.thresholdPaceSecondsPerKm || stored.hrZoneType !== expected.hrZoneType)) {
    throw new Error("The watch's thresholds changed since the coach read them. Ask the coach to prepare the update again.");
  }
  const after = await updateWatchProfile(payload.edits, {
    read: () => corosNativeBle.readWatchProfile(),
    write: (profile) => corosNativeBle.writeWatchProfile(profile)
  });
  return {
    results: [],
    message: `The watch now has max ${after.maxHr}, threshold ${after.thresholdHr} and resting ${after.restingHr} bpm.`
  };
}

// ----- Reads -----

async function readZones(unitSystem: UnitSystem): Promise<AthleteZonesSnapshot> {
  const profile = getWatchProfile();
  const watch = corosNativeBle.localSyncWatch();
  const editable = ["max_hr", "resting_hr", "threshold_hr", "hr_zone_basis", "threshold_pace_seconds_per_km"];
  const update: AthleteZonesSnapshot["update"] = !profile
    ? { possible: false, editable, reason: "CorosLink hasn't read the watch's profile yet; it does on the first Bluetooth connection." }
    : !watch
      ? { possible: false, editable, reason: "The watch isn't connected over Bluetooth right now." }
      : !watchSupports("profile", watch.model ?? profile.model)
        ? { possible: false, editable: [], reason: "CorosLink can't change zones on this watch model yet." }
        : { possible: true, editable };
  const local = usingLocalSources();
  const hub = !local && getTrainingHubStatus().authenticated ? await getWorkoutEditorContext(unitSystem).catch(() => undefined) : undefined;
  const pace = (seconds: number | undefined) => (seconds && seconds > 0 ? formatPaceValue(seconds, unitSystem) : undefined);
  const hubThresholds = hub
    ? {
        ...(hub.maxHr ? { max_hr: hub.maxHr } : {}),
        ...(hub.restingHr ? { resting_hr: hub.restingHr } : {}),
        ...(hub.lthrBpm ? { threshold_hr: hub.lthrBpm } : {}),
        ...(pace(hub.thresholdPaceSecondsPerKm) ? { threshold_pace: pace(hub.thresholdPaceSecondsPerKm) } : {}),
        ...(hub.ftp ? { ftp_w: hub.ftp } : {}),
        ...(hub.criticalPower ? { critical_power_w: hub.criticalPower } : {})
      }
    : undefined;
  const ftp = profile?.ftp || hub?.ftp;
  const powerZones = ftp && hub?.zones.ftp?.length
    ? hub.zones.ftp.map((zone) => ({ zone: zone.index, range: `${Math.round(ftp * zone.lowPercent / 100)}–${Math.round(ftp * zone.highPercent / 100)} W` }))
    : undefined;
  if (!profile) {
    return {
      source: hubThresholds && Object.keys(hubThresholds).length ? "training_hub" : "none",
      thresholds: hubThresholds ?? {},
      ...(hub?.zones.lthr?.length
        ? { hr_zone_basis: "Threshold heart rate", hr_zones: hub.zones.lthr.filter((zone) => zone.lowBpm !== undefined).map((zone) => ({ zone: zone.index, range: `${zone.lowBpm}–${zone.highBpm} bpm` })) }
        : {}),
      ...(powerZones ? { power_zones: powerZones } : {}),
      body_weight: "not available to CorosLink",
      update
    };
  }
  const basis = profile.hrZoneType === 1 ? "% of max heart rate" : profile.hrZoneType === 2 ? "Heart-rate reserve" : "Threshold heart rate";
  const bounds = profile.hrZoneType === 1 ? profile.maxHrZones : profile.hrZoneType === 2 ? profile.reserveHrZones : profile.thresholdHrZones;
  const hrZones = bounds.map((low, index) => ({
    zone: index + 1,
    range: `${low}–${index + 1 < bounds.length ? bounds[index + 1]! - 1 : profile.maxHr} bpm`
  }));
  const paces = profile.paceZonesSecondsPerKm;
  const paceZones = paces.map((slow, index) => ({
    zone: index + 1,
    range: index + 1 < paces.length ? `${pace(slow)}–${pace(paces[index + 1])}` : `faster than ${pace(slow)}`
  }));
  const thresholds = {
    max_hr: profile.maxHr,
    resting_hr: profile.restingHr,
    threshold_hr: profile.thresholdHr,
    ...(pace(profile.thresholdPaceSecondsPerKm) ? { threshold_pace: pace(profile.thresholdPaceSecondsPerKm) } : {}),
    ...(ftp ? { ftp_w: ftp } : {}),
    ...(profile.criticalPower ? { critical_power_w: profile.criticalPower } : {})
  };
  const differs = hubThresholds && (["max_hr", "resting_hr", "threshold_hr", "threshold_pace"] as const)
    .some((key) => hubThresholds[key] !== undefined && hubThresholds[key] !== thresholds[key]);
  return {
    source: "watch",
    read_at: profile.readAt,
    thresholds,
    hr_zone_basis: basis,
    hr_zones: hrZones,
    ...(paceZones.length ? { pace_zones: paceZones } : {}),
    ...(powerZones ? { power_zones: powerZones } : {}),
    ...(differs ? { training_hub: hubThresholds } : {}),
    body_weight: "not available to CorosLink",
    update,
    current: {
      maxHr: profile.maxHr,
      restingHr: profile.restingHr,
      thresholdHr: profile.thresholdHr,
      hrZoneType: profile.hrZoneType,
      thresholdPaceSecondsPerKm: profile.thresholdPaceSecondsPerKm
    }
  };
}

export async function readCoachDataStatus(
  options: {
    newest?: { startTime?: number; name?: string; sportName?: string };
    includeNewest?: boolean;
    /** The caller already read the activity list (it may be empty), so don't read it again. */
    newestRead?: boolean;
  } = {}
): Promise<CoachDataStatus> {
  const includeNewest = options.includeNewest !== false;
  const local = usingLocalSources();
  const hub = (() => { try { return getTrainingHubStatus(); } catch { return { authenticated: false }; } })();
  const mcpId = corosMcpServerId();
  const mcp = mcpId ? getMcpServerStatus(mcpId) : undefined;
  let newestActivity = includeNewest ? options.newest : undefined;
  let newestActivityError: string | undefined;
  if (includeNewest && !newestActivity && !options.newestRead && (local || hub.authenticated)) {
    try {
      newestActivity = (await currentActivitySource().listActivities(1, 1))[0];
    } catch (error) {
      newestActivityError = error instanceof Error ? error.message : "couldn't be read";
    }
  }
  const watch = corosNativeBle.localSyncWatch();
  const syncs = local ? localSyncReader?.() : undefined;
  return buildCoachDataStatus({
    now: new Date(),
    localOnly: local,
    trainingHub: { signedIn: hub.authenticated, ...("sessionExpired" in hub && hub.sessionExpired ? { sessionExpired: true } : {}) },
    ...(mcp ? { corosMcp: { connected: mcp.connected, authenticated: mcp.authenticated, ...(mcp.error ? { error: mcp.error } : {}) } } : {}),
    ...(newestActivity?.startTime ? { newestActivity: { startTime: newestActivity.startTime, name: newestActivity.name, sport: newestActivity.sportName } } : {}),
    ...(newestActivityError ? { newestActivityError } : {}),
    watch: { connected: Boolean(watch) || corosNativeBle.isConnected(), name: watch?.name, lastConnectedAt: getWatchProfile()?.readAt },
    ...(syncs
      ? { localSync: { lastActivitySyncAt: syncs.activities?.finishedAt ?? syncs.activities?.startedAt, lastHealthSyncAt: syncs.health?.finishedAt ?? syncs.health?.startedAt } }
      : {}),
    syncErrors: recentSyncErrors()
  });
}

let forecastCache: { key: string; at: number; forecast: WatchForecast } | undefined;

async function readWeather(day: string, place: string | undefined, unitSystem: UnitSystem) {
  let location: { latitude: number; longitude: number; name: string };
  if (place) {
    const [match] = await searchWeatherPlaces(place);
    if (!match) throw new Error(`No place called "${place}" was found. Ask the athlete for a nearby city.`);
    location = { latitude: match.latitude, longitude: match.longitude, name: [match.name, match.detail].filter(Boolean).join(", ") };
  } else {
    const saved = getWeatherLocation();
    if (!saved) throw new Error("CorosLink doesn't know the athlete's location yet. Ask which city to check, then pass place.");
    location = { latitude: saved.latitude, longitude: saved.longitude, name: saved.place ?? "the athlete's location" };
  }
  const key = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
  if (!forecastCache || forecastCache.key !== key || Date.now() - forecastCache.at > FORECAST_FRESH_MS) {
    forecastCache = { key, at: Date.now(), forecast: await fetchWatchForecast(location.latitude, location.longitude) };
  }
  return summarizeForecastDay(forecastCache.forecast, day, location.name, unitSystem);
}

async function readStrength(days: number, exercise: string | undefined, limit: number | undefined, unitSystem: UnitSystem) {
  let sessions: StrengthSession[];
  let warnings: string[] | undefined;
  try {
    const history = await syncStrengthHistory({ days });
    sessions = history.sessions;
    warnings = history.warnings;
  } catch (error) {
    // Cached sessions still answer when a refresh fails.
    const since = Math.floor(Date.now() / 1000) - days * 86_400;
    sessions = [...listStoredStrengthSessions(since), ...getStoredHevyStrengthSessions(days), ...getStoredStravaStrengthSessions(days)];
    warnings = [`Showing cached sessions: ${error instanceof Error ? error.message : "refresh failed"}`];
  }
  return { ...buildStrengthProgress(sessions, { days, unitSystem, exercise, limit }), ...(warnings?.length ? { warnings } : {}) };
}

// ----- Per-turn dependencies -----

export interface AthleteToolRuntimeOptions {
  unitSystem: UnitSystem;
  claudePermissions?: ClaudeCodePermissions;
  onMemoryNotice: (notice: AthleteMemoryNotice) => void;
  onReview: (preview: CoachReviewPreview) => void;
}

export function memoryNotice(change: AthleteMemoryChange): AthleteMemoryNotice {
  return {
    noticeId: crypto.randomUUID(),
    action: change.action === "unchanged" ? "remembered" : change.action,
    fact: change.fact,
    ...(change.previous ? { previous: change.previous } : {}),
    at: new Date().toISOString()
  };
}

export function createAthleteToolDependencies(options: AthleteToolRuntimeOptions): AthleteToolDependencies {
  const claude = options.claudePermissions;
  const unitSystem = options.unitSystem;
  return {
    unitSystem,
    today: () => localDayKey(),
    allowed: { zones: !claude || claude.trainingMetrics, races: !claude || claude.recentActivities },
    claude: Boolean(claude),
    memory: {
      list: listAthleteFacts,
      save: (input) => saveAthleteFact(input, "coach"),
      remove: deleteAthleteFact
    },
    onMemoryChange: (change) => options.onMemoryNotice(memoryNotice(change)),
    races: { overview: getRaceOverview, normalizeTarget: (input) => normalizeRaceTarget(input) },
    zones: () => readZones(unitSystem),
    dataStatus: () => readCoachDataStatus({ includeNewest: !claude || claude.recentActivities }),
    compliance: async (startDay, endDay) => {
      const [scheduled, activities] = await Promise.all([
        listScheduledWorkoutEntries(startDay, endDay),
        currentActivitySource().listActivities(1, 500, startDay, endDay)
      ]);
      return buildPlanCompliance({
        scheduled,
        activities,
        manualLinks: listManualActivityLinks(startDay, endDay),
        startDay,
        endDay,
        today: localDayKey(),
        unitSystem
      });
    },
    weather: (day, place) => readWeather(day, place, unitSystem),
    strength: (days, exercise, limit) => readStrength(days, exercise, limit, unitSystem),
    stageReview: (draft) => reviews.stage(draft, Boolean(claude)),
    onReview: options.onReview
  };
}

/** Undo from the transcript's memory row. */
export function undoAthleteMemoryNotice(notice: AthleteMemoryNotice): void {
  undoAthleteMemoryChange(notice);
}
