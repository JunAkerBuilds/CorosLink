import { safeStorage } from "electron";
import {
  clearHevyCache,
  deleteHevyWorkout,
  deleteSettings,
  getSetting,
  listStoredHevyExerciseTemplates,
  listStoredHevyWorkouts,
  reconcileHevyWorkoutIds,
  setSetting,
  upsertHevyExerciseTemplate,
  upsertHevyWorkout
} from "./database";
import {
  hevyWorkoutId,
  hevyWorkoutStartTime,
  normalizeHevyWorkout
} from "./hevyModel";
import type {
  HevySettingsInput,
  HevyStatus,
  StrengthSession
} from "./types";

type JsonRecord = Record<string, unknown>;

const BASE_URL = "https://api.hevyapp.com/v1";
const INITIAL_HISTORY_DAYS = 365;
const SETTINGS = {
  apiKey: "hevy.apiKey",
  identity: "hevy.identity",
  includeWarmups: "hevy.includeWarmups",
  eventCursor: "hevy.eventCursor",
  coverageSince: "hevy.coverageSince",
  lastSyncedAt: "hevy.lastSyncedAt",
  templatesSyncedAt: "hevy.templatesSyncedAt"
};
const TEMPLATE_REFRESH_MS = 7 * 86_400_000;

interface CredentialStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

let credentialStorage: CredentialStorage = safeStorage;

/** Test seam; production always uses Electron safeStorage. */
export function setHevyCredentialStorageForTests(storage: CredentialStorage): void {
  credentialStorage = storage;
}

interface HevyIdentity {
  userId: string;
  displayName?: string;
  profileUrl?: string;
}

interface HevySyncResult {
  sessions: StrengthSession[];
  fetched: number;
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseIdentity(): HevyIdentity | undefined {
  const raw = getSetting(SETTINGS.identity);
  if (!raw) return undefined;
  try {
    const parsed = record(JSON.parse(raw));
    const userId = stringValue(parsed?.userId);
    if (!userId) return undefined;
    return {
      userId,
      displayName: stringValue(parsed?.displayName),
      profileUrl: stringValue(parsed?.profileUrl)
    };
  } catch {
    return undefined;
  }
}

function readApiKey(): string | undefined {
  const encrypted = getSetting(SETTINGS.apiKey);
  if (!encrypted || !credentialStorage.isEncryptionAvailable()) return undefined;
  try {
    return credentialStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return undefined;
  }
}

function storeApiKey(apiKey: string): void {
  if (!credentialStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure credential storage is unavailable. CorosLink did not save the Hevy API key."
    );
  }
  setSetting(
    SETTINGS.apiKey,
    credentialStorage.encryptString(apiKey).toString("base64")
  );
}

function includeWarmups(): boolean {
  return getSetting(SETTINGS.includeWarmups) === "true";
}

function windowStartEpochSeconds(days: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return Math.floor(start.getTime() / 1000);
}

/** A Hevy API failure, with the HTTP status the Coach's tools report. */
export class HevyApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hevyRequest(
  path: string,
  apiKey: string,
  search?: Record<string, string | number>,
  write?: { method: "POST" | "PUT"; body: unknown }
): Promise<JsonRecord> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, write
    ? {
        method: write.method,
        headers: { "api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(write.body)
      }
    : { headers: { "api-key": apiKey } });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = stringValue(record(payload)?.error);
    // A write's 403 is a plan limit (routines, custom exercises), not the key.
    if (response.status === 401 || (response.status === 403 && !write)) {
      throw new HevyApiError("Hevy rejected the API key. Reconnect Hevy with a current Pro API key.", response.status);
    }
    throw new HevyApiError(message ?? `Hevy API request failed (${response.status}).`, response.status);
  }
  const parsed = record(payload);
  if (!parsed) throw new Error("Hevy returned an invalid response.");
  return parsed;
}

async function fetchIdentity(apiKey: string): Promise<HevyIdentity> {
  const response = await hevyRequest("/user/info", apiKey);
  const data = record(response.data);
  const userId = stringValue(data?.id);
  if (!userId) throw new Error("Hevy did not return an account identity.");
  return {
    userId,
    displayName: stringValue(data?.name),
    profileUrl: stringValue(data?.url)
  };
}

export function getHevyStatus(): HevyStatus {
  const identity = parseIdentity();
  return {
    connected: Boolean(readApiKey() && identity),
    userId: identity?.userId,
    displayName: identity?.displayName,
    profileUrl: identity?.profileUrl,
    lastSyncedAt: getSetting(SETTINGS.lastSyncedAt),
    includeWarmups: includeWarmups()
  };
}

export async function connectHevy(apiKey: string): Promise<HevyStatus> {
  const key = apiKey.trim();
  if (!key) throw new Error("Enter a Hevy API key.");
  if (!credentialStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable on this system.");
  }
  const identity = await fetchIdentity(key);
  const previous = parseIdentity();
  if (previous && previous.userId !== identity.userId) {
    clearHevyCache();
    deleteSettings([
      SETTINGS.eventCursor,
      SETTINGS.coverageSince,
      SETTINGS.lastSyncedAt
    ]);
  }
  storeApiKey(key);
  setSetting(SETTINGS.identity, JSON.stringify(identity));
  if (getSetting(SETTINGS.includeWarmups) === undefined) {
    setSetting(SETTINGS.includeWarmups, "false");
  }
  return getHevyStatus();
}

export function updateHevySettings(input: HevySettingsInput): HevyStatus {
  setSetting(SETTINGS.includeWarmups, input.includeWarmups ? "true" : "false");
  return getHevyStatus();
}

export function disconnectHevy(): void {
  clearHevyCache();
  deleteSettings(Object.values(SETTINGS));
}

async function syncExerciseTemplates(apiKey: string): Promise<void> {
  for (let page = 1; ; page += 1) {
    const response = await hevyRequest("/exercise_templates", apiKey, {
      page,
      pageSize: 100
    });
    const templates = Array.isArray(response.exercise_templates)
      ? response.exercise_templates.map(record).filter((item): item is JsonRecord => Boolean(item))
      : [];
    for (const template of templates) {
      const id = stringValue(template.id);
      if (id) upsertHevyExerciseTemplate(id, template);
    }
    const pageCount = Math.max(1, numberValue(response.page_count) ?? page);
    if (page >= pageCount) break;
  }
  setSetting(SETTINGS.templatesSyncedAt, new Date().toISOString());
}

async function ensureExerciseTemplates(
  apiKey: string,
  workouts: JsonRecord[]
): Promise<void> {
  const known = listStoredHevyExerciseTemplates();
  const missing = new Set<string>();
  for (const workout of workouts) {
    const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
    for (const rawExercise of exercises) {
      const id = stringValue(record(rawExercise)?.exercise_template_id);
      if (id && !known.has(id)) missing.add(id);
    }
  }
  for (const id of missing) {
    try {
      const template = await hevyRequest(`/exercise_templates/${encodeURIComponent(id)}`, apiKey);
      upsertHevyExerciseTemplate(id, template);
    } catch {
      // Names in workout payloads are enough for analytics; metadata is fallback only.
    }
  }
}

async function fullSync(apiKey: string): Promise<number> {
  const startedAt = new Date().toISOString();
  const since = windowStartEpochSeconds(INITIAL_HISTORY_DAYS);
  await syncExerciseTemplates(apiKey);
  const retainedIds = new Set<string>();
  let fetched = 0;

  for (let page = 1; ; page += 1) {
    const response = await hevyRequest("/workouts", apiKey, { page, pageSize: 10 });
    const workouts = Array.isArray(response.workouts)
      ? response.workouts.map(record).filter((item): item is JsonRecord => Boolean(item))
      : [];
    let reachedBoundary = false;
    for (const workout of workouts) {
      const id = hevyWorkoutId(workout);
      const startTime = hevyWorkoutStartTime(workout);
      if (!id || startTime === undefined) continue;
      if (startTime < since) {
        reachedBoundary = true;
        continue;
      }
      retainedIds.add(id);
      upsertHevyWorkout(id, startTime, stringValue(workout.updated_at), workout);
      fetched += 1;
    }
    const pageCount = Math.max(1, numberValue(response.page_count) ?? page);
    if (reachedBoundary || page >= pageCount || workouts.length === 0) break;
  }

  reconcileHevyWorkoutIds(since, retainedIds);
  setSetting(SETTINGS.coverageSince, String(since));
  setSetting(SETTINGS.eventCursor, startedAt);
  setSetting(SETTINGS.lastSyncedAt, new Date().toISOString());
  return fetched;
}

async function incrementalSync(apiKey: string, cursor: string): Promise<number> {
  const startedAt = new Date().toISOString();
  const oldest = windowStartEpochSeconds(INITIAL_HISTORY_DAYS);
  const updatedWorkouts: JsonRecord[] = [];
  let fetched = 0;

  for (let page = 1; ; page += 1) {
    const response = await hevyRequest("/workouts/events", apiKey, {
      page,
      pageSize: 10,
      since: cursor
    });
    const events = Array.isArray(response.events)
      ? response.events.map(record).filter((item): item is JsonRecord => Boolean(item))
      : [];
    for (const event of events) {
      if (event.type === "deleted") {
        const id = stringValue(event.id);
        if (id) deleteHevyWorkout(id);
        continue;
      }
      const workout = record(event.workout);
      const id = workout ? hevyWorkoutId(workout) : undefined;
      const startTime = workout ? hevyWorkoutStartTime(workout) : undefined;
      if (!workout || !id || startTime === undefined) continue;
      if (startTime < oldest) {
        deleteHevyWorkout(id);
        continue;
      }
      upsertHevyWorkout(id, startTime, stringValue(workout.updated_at), workout);
      updatedWorkouts.push(workout);
      fetched += 1;
    }
    const pageCount = Math.max(1, numberValue(response.page_count) ?? page);
    if (page >= pageCount || events.length === 0) break;
  }

  await ensureExerciseTemplates(apiKey, updatedWorkouts);
  // Cursor movement is deliberately last: partial event application is safely replayed.
  setSetting(SETTINGS.eventCursor, startedAt);
  setSetting(SETTINGS.lastSyncedAt, new Date().toISOString());
  return fetched;
}

export function getStoredHevyStrengthSessions(days: number): StrengthSession[] {
  const templates = listStoredHevyExerciseTemplates();
  return listStoredHevyWorkouts(windowStartEpochSeconds(days))
    .map((stored) => normalizeHevyWorkout(stored.payload, templates, includeWarmups()))
    .filter((session): session is StrengthSession => Boolean(session));
}

export async function syncHevyStrengthHistory(
  days = 90,
  force = false
): Promise<HevySyncResult> {
  const apiKey = readApiKey();
  if (!apiKey) throw new Error("Connect Hevy before syncing strength workouts.");
  const requestedSince = windowStartEpochSeconds(days);
  const coverageSince = Number(getSetting(SETTINGS.coverageSince));
  const cursor = getSetting(SETTINGS.eventCursor);
  const needsFullSync =
    force || !cursor || !Number.isFinite(coverageSince) || coverageSince > requestedSince;
  const fetched = needsFullSync
    ? await fullSync(apiKey)
    : await incrementalSync(apiKey, cursor);
  return { sessions: getStoredHevyStrengthSessions(days), fetched };
}

// ----- The Coach's Hevy tools: live reads and approved writes -----

function requireApiKey(): string {
  const apiKey = readApiKey();
  if (!apiKey || !parseIdentity()) {
    throw new Error("Hevy isn't connected. Connect it in Strength or Settings → Accounts & API with a Hevy Pro API key.");
  }
  return apiKey;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
}

/** Every page of a 10-per-page Hevy list, up to maxPages. */
async function listAllPages(path: string, key: string, maxPages = 30): Promise<JsonRecord[]> {
  const apiKey = requireApiKey();
  const items: JsonRecord[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await hevyRequest(path, apiKey, { page, pageSize: 10 });
    const batch = records(response[key]);
    items.push(...batch);
    const pageCount = Math.max(1, numberValue(response.page_count) ?? page);
    if (page >= pageCount || batch.length === 0) break;
  }
  return items;
}

/**
 * The account's exercise library (built-in and custom), from the local cache.
 * Fetched on first use and refreshed weekly, or at once with refresh.
 */
export async function getHevyExerciseTemplates(refresh = false): Promise<Map<string, JsonRecord>> {
  const apiKey = requireApiKey();
  const syncedAt = Date.parse(getSetting(SETTINGS.templatesSyncedAt) ?? "");
  const stale = !Number.isFinite(syncedAt) || Date.now() - syncedAt > TEMPLATE_REFRESH_MS;
  let templates = listStoredHevyExerciseTemplates();
  if (refresh || stale || templates.size === 0) {
    try {
      await syncExerciseTemplates(apiKey);
    } catch (error) {
      // A stale library still answers searches; an empty one can't.
      if (templates.size === 0) throw error;
    }
    templates = listStoredHevyExerciseTemplates();
  }
  return templates;
}

/** One template by id, fetched (and cached) when the library doesn't have it yet. */
export async function getHevyExerciseTemplate(id: string): Promise<JsonRecord | undefined> {
  const cached = listStoredHevyExerciseTemplates().get(id);
  if (cached) return cached;
  try {
    const template = await hevyRequest(`/exercise_templates/${encodeURIComponent(id)}`, requireApiKey());
    upsertHevyExerciseTemplate(id, template);
    return template;
  } catch (error) {
    if (error instanceof HevyApiError && error.status === 404) return undefined;
    throw error;
  }
}

/** How often each template appears in the cached workout history (Strength sync), last year. */
export function hevyTemplateUsage(): Map<string, { count: number; lastStart: number }> {
  const usage = new Map<string, { count: number; lastStart: number }>();
  for (const workout of listStoredHevyWorkouts(windowStartEpochSeconds(INITIAL_HISTORY_DAYS))) {
    const seen = new Set<string>();
    for (const exercise of records(workout.payload.exercises)) {
      const id = stringValue(exercise.exercise_template_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const entry = usage.get(id) ?? { count: 0, lastStart: 0 };
      entry.count += 1;
      entry.lastStart = Math.max(entry.lastStart, workout.startTime);
      usage.set(id, entry);
    }
  }
  return usage;
}

export function listHevyRoutines(): Promise<JsonRecord[]> {
  return listAllPages("/routines", "routines");
}

export function listHevyRoutineFolders(): Promise<JsonRecord[]> {
  return listAllPages("/routine_folders", "routine_folders", 10);
}

export async function getHevyRoutine(id: string): Promise<JsonRecord | undefined> {
  try {
    const response = await hevyRequest(`/routines/${encodeURIComponent(id)}`, requireApiKey());
    return record(response.routine) ?? response;
  } catch (error) {
    if (error instanceof HevyApiError && error.status === 404) return undefined;
    throw error;
  }
}

export async function createHevyRoutine(routine: JsonRecord): Promise<JsonRecord> {
  const response = await hevyRequest("/routines", requireApiKey(), undefined, { method: "POST", body: { routine } });
  // Hevy has answered both { routine } and [routine].
  return record(response.routine) ?? record(records(response.routine)[0]) ?? response;
}

export async function updateHevyRoutine(id: string, routine: JsonRecord): Promise<JsonRecord> {
  const response = await hevyRequest(`/routines/${encodeURIComponent(id)}`, requireApiKey(), undefined, { method: "PUT", body: { routine } });
  return record(response.routine) ?? record(records(response.routine)[0]) ?? response;
}

export async function createHevyRoutineFolder(title: string): Promise<JsonRecord> {
  const response = await hevyRequest("/routine_folders", requireApiKey(), undefined, {
    method: "POST",
    body: { routine_folder: { title } }
  });
  return record(response.routine_folder) ?? response;
}

/** Creates a custom exercise and caches its template; returns the new template id. */
export async function createHevyCustomExercise(exercise: JsonRecord): Promise<string> {
  const apiKey = requireApiKey();
  const response = await hevyRequest("/exercise_templates", apiKey, undefined, { method: "POST", body: { exercise } });
  const raw = response.id ?? record(response.exercise_template)?.id;
  const id = typeof raw === "number" ? String(raw) : stringValue(raw);
  if (!id) throw new Error("Hevy created the exercise but didn't return its id. Search for it before using it.");
  await getHevyExerciseTemplate(id).catch(() => undefined);
  return id;
}

export async function getHevyExerciseHistory(
  templateId: string,
  startDate?: string,
  endDate?: string
): Promise<JsonRecord[]> {
  const search: Record<string, string> = {};
  if (startDate) search.start_date = startDate;
  if (endDate) search.end_date = endDate;
  const response = await hevyRequest(`/exercise_history/${encodeURIComponent(templateId)}`, requireApiKey(), search);
  return records(response.exercise_history);
}

export async function listHevyWorkouts(page: number, pageSize: number): Promise<{ workouts: JsonRecord[]; pageCount: number }> {
  const response = await hevyRequest("/workouts", requireApiKey(), { page, pageSize });
  return { workouts: records(response.workouts), pageCount: Math.max(1, numberValue(response.page_count) ?? 1) };
}

export async function getHevyWorkout(id: string): Promise<JsonRecord | undefined> {
  try {
    const response = await hevyRequest(`/workouts/${encodeURIComponent(id)}`, requireApiKey());
    return record(response.workout) ?? response;
  } catch (error) {
    if (error instanceof HevyApiError && error.status === 404) return undefined;
    throw error;
  }
}

export async function listHevyBodyMeasurements(limit: number): Promise<JsonRecord[]> {
  const apiKey = requireApiKey();
  const items: JsonRecord[] = [];
  for (let page = 1; items.length < limit; page += 1) {
    const response = await hevyRequest("/body_measurements", apiKey, { page, pageSize: 10 });
    const batch = records(response.body_measurements);
    items.push(...batch);
    const pageCount = Math.max(1, numberValue(response.page_count) ?? page);
    if (page >= pageCount || batch.length === 0) break;
  }
  return items.slice(0, limit);
}
