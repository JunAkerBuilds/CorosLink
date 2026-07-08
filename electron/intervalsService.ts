import fs from "node:fs";
import { safeStorage } from "electron";
import { deleteSettings, getSetting, setSetting } from "./database";
import type { IntervalsActivity, IntervalsStatus } from "./types";

const BASE_URL = "https://intervals.icu/api/v1";
const SETTINGS = {
  apiKey: "intervals.apiKey",
  athleteId: "intervals.athleteId",
  importedAt: "intervals.importedAt"
};

// After we import an activity, COROS takes time to process it before it
// shows up in the COROS activity list. Until then, listMissing's fuzzy
// match against COROS activities won't find it and would report it as
// "Missing" again, letting the user re-import (duplicate). We remember
// what we've imported for this long and force onCoros=true for it.
export const RECENT_IMPORT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function storeSecret(key: string, value: string): void {
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : value;
  setSetting(key, payload);
}

function readSecret(key: string): string | undefined {
  const raw = getSetting(key);
  if (!raw) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return raw;
  try {
    return safeStorage.decryptString(Buffer.from(raw, "base64"));
  } catch {
    // Decryption failed (e.g. OS keychain unavailable/changed). Do NOT return
    // the raw ciphertext — it would be sent as the API key and produce a
    // confusing 401. Treat the user as disconnected instead.
    console.warn(`Failed to decrypt secret for "${key}"; treating as unset.`);
    return undefined;
  }
}

function authHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
}

function requireAuth(): { apiKey: string; athleteId: string } {
  const apiKey = readSecret(SETTINGS.apiKey);
  const athleteId = getSetting(SETTINGS.athleteId);
  if (!apiKey || !athleteId) {
    throw new Error("Not connected to intervals.icu.");
  }
  return { apiKey, athleteId };
}

export function getIntervalsStatus(): IntervalsStatus {
  const apiKey = readSecret(SETTINGS.apiKey);
  const athleteId = getSetting(SETTINGS.athleteId);
  return apiKey && athleteId
    ? { connected: true, athleteId }
    : { connected: false };
}

export async function connectIntervals(
  apiKey: string,
  athleteId: string
): Promise<IntervalsStatus> {
  const id = athleteId.trim();
  // Validate the key by hitting the athlete endpoint.
  const resp = await fetch(`${BASE_URL}/athlete/${id}`, {
    headers: { Authorization: authHeader(apiKey.trim()) }
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Invalid intervals.icu API key.");
  }
  if (!resp.ok) {
    throw new Error(`intervals.icu error: ${resp.status}`);
  }
  storeSecret(SETTINGS.apiKey, apiKey.trim());
  setSetting(SETTINGS.athleteId, id);
  return { connected: true, athleteId: id };
}

export function disconnectIntervals(): void {
  deleteSettings([SETTINGS.apiKey, SETTINGS.athleteId]);
}

function fileExtOf(raw: any): IntervalsActivity["fileExt"] {
  const t = String(raw?.source_file?.type ?? raw?.source ?? "").toLowerCase();
  if (t.includes("fit")) return "fit";
  if (t.includes("tcx")) return "tcx";
  return "unknown";
}

export function parseIntervalsActivities(raw: any[]): IntervalsActivity[] {
  return raw.map((a) => {
    const start = a.start_date ?? a.startDate ?? a.start_date_local ?? "";
    return {
      intervalsId: String(a.id),
      name: a.name ?? "Unnamed",
      startEpochMs: start ? Date.parse(start) : 0,
      // COROS's activity list only exposes ELAPSED time (raw.totalTime), so we
      // must prefer elapsed here too — comparing elapsed-vs-moving would flag
      // activities with stops (e.g. cycling) as false "Missing" and cause
      // duplicate imports.
      movingSec: Number(
        a.elapsed_time ?? a.elapsedTime ?? a.moving_time ?? a.movingTime ?? 0
      ),
      distanceM: Number(a.distance ?? 0),
      type: String(a.type ?? ""),
      fileExt: fileExtOf(a)
    };
  });
}

export async function listIntervalsActivities(
  daysBack: number
): Promise<IntervalsActivity[]> {
  const { apiKey, athleteId } = requireAuth();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - daysBack * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url = `${BASE_URL}/athlete/${athleteId}/activities?oldest=${from}&newest=${to}`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(apiKey) }
  });
  if (!resp.ok) {
    throw new Error(`intervals.icu fetch failed: ${resp.status}`);
  }
  return parseIntervalsActivities((await resp.json()) as any[]);
}

export async function downloadIntervalsFit(
  intervalsId: string,
  destPath: string
): Promise<string> {
  const { apiKey } = requireAuth();
  const resp = await fetch(`${BASE_URL}/activity/${intervalsId}/file`, {
    headers: { Authorization: authHeader(apiKey) }
  });
  if (!resp.ok) {
    throw new Error(
      `FIT download failed (${resp.status}) for activity ${intervalsId}`
    );
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return destPath;
}

function readImportedMap(): Record<string, number> {
  const raw = getSetting(SETTINGS.importedAt);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Pure recency filter, extracted so it can be unit tested without touching
 * the (Electron-only, better-sqlite3-backed) settings store.
 */
export function filterRecentIds(
  map: Record<string, number>,
  now: number,
  withinMs: number
): string[] {
  return Object.entries(map)
    .filter(([, importedAt]) => now - importedAt <= withinMs)
    .map(([intervalsId]) => intervalsId);
}

export function recordIntervalsImport(intervalsId: string): void {
  const map = readImportedMap();
  map[intervalsId] = Date.now();
  setSetting(SETTINGS.importedAt, JSON.stringify(map));
}

export function getRecentlyImportedIds(withinMs: number): Set<string> {
  const map = readImportedMap();
  return new Set(filterRecentIds(map, Date.now(), withinMs));
}
