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
  lastSyncedAt: "hevy.lastSyncedAt"
};

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

async function hevyRequest(
  path: string,
  apiKey: string,
  search?: Record<string, string | number>
): Promise<JsonRecord> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { "api-key": apiKey } });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Hevy rejected the API key. Reconnect Hevy with a current Pro API key.");
    }
    const message = stringValue(record(payload)?.error);
    throw new Error(message ?? `Hevy API request failed (${response.status}).`);
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
