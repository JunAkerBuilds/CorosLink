import { getSetting, setSetting } from "./database";
import type { WatchModelId } from "./watchModels";
import { accountFromWatchProfile, decodeWatchProfile, editWatchProfile, encodeWatchProfile, type WatchProfile, type WatchProfileEdits } from "./corosWatchProfile";

/**
 * The watch's training profile (heart-rate, pace and power thresholds and
 * zones), read on each connection and kept here so Local-Only Mode's workout
 * editor uses the same zones as the watch. Edits are written back to the watch.
 */

const PROFILE_SETTING = "watch.trainingProfile";

export interface WatchProfileSummary {
  readAt: string;
  /** The watch the profile was read from, when recognised; editing is locked for a model CorosLink hasn't checked. */
  model?: WatchModelId;
  maxHr: number;
  restingHr: number;
  thresholdHr: number;
  hrZoneType: number;
  /** seconds per km */
  thresholdPaceSecondsPerKm: number;
  ftp: number;
  /** Running critical power, W; 0 when the watch has none. */
  criticalPower?: number;
  maxHrZones: number[];
  reserveHrZones: number[];
  thresholdHrZones: number[];
  /** seconds per km, slowest zone first */
  paceZonesSecondsPerKm: number[];
}

export function storeWatchProfile(bytes: Buffer, now = new Date(), model?: WatchModelId): void {
  decodeWatchProfile(bytes); // refuse to keep something that doesn't parse
  setSetting(PROFILE_SETTING, JSON.stringify({ readAt: now.toISOString(), profile: bytes.toString("base64"), ...(model ? { model } : {}) }));
}

function stored(): { readAt: string; profile: WatchProfile; model?: WatchModelId } | undefined {
  try {
    const raw = getSetting(PROFILE_SETTING);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { readAt: string; profile: string; model?: WatchModelId };
    return { readAt: value.readAt, profile: decodeWatchProfile(Buffer.from(value.profile, "base64")), ...(value.model ? { model: value.model } : {}) };
  } catch {
    return undefined;
  }
}

function summarizeWatchProfile(profile: WatchProfile, readAt: string, model?: WatchModelId): WatchProfileSummary {
  return {
    readAt, ...(model ? { model } : {}), maxHr: profile.maxHr, restingHr: profile.restingHr, thresholdHr: profile.thresholdHr, hrZoneType: profile.hrZoneType,
    thresholdPaceSecondsPerKm: Math.round(profile.thresholdPace / 1000), ftp: profile.ftp, criticalPower: profile.criticalPower,
    maxHrZones: profile.maxHrZones, reserveHrZones: profile.reserveHrZones, thresholdHrZones: profile.thresholdHrZones,
    paceZonesSecondsPerKm: profile.paceZones.map(value => Math.round(value / 1000))
  };
}

/** The last profile read from the watch, or undefined before the first connection. */
export function getWatchProfile(): WatchProfileSummary | undefined {
  const value = stored();
  return value ? summarizeWatchProfile(value.profile, value.readAt, value.model) : undefined;
}

/** The COROS account shape the workout editor reads, from the watch's profile (Local-Only Mode). */
export function localAccountFromWatchProfile(): Record<string, unknown> {
  const value = stored();
  return value ? accountFromWatchProfile(value.profile) : {};
}

/**
 * Applies edits to the profile the watch holds now and writes it back.
 * `link` reads and writes over Bluetooth; the result is what the watch reports afterwards.
 */
export async function updateWatchProfile(
  input: unknown,
  link: { read(): Promise<Buffer>; write(profile: Buffer): Promise<Buffer> }
): Promise<WatchProfileSummary> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const edits: WatchProfileEdits = {};
  for (const key of ["maxHr", "restingHr", "thresholdHr", "hrZoneType"] as const) {
    if (raw[key] !== undefined) edits[key] = Number(raw[key]);
  }
  if (raw.thresholdPaceSecondsPerKm !== undefined) edits.thresholdPace = Math.round(Number(raw.thresholdPaceSecondsPerKm) * 1000);
  const current = decodeWatchProfile(await link.read());
  const next = editWatchProfile(current, edits);
  const after = decodeWatchProfile(await link.write(encodeWatchProfile(next)));
  const changed = (["maxHr", "restingHr", "thresholdHr", "hrZoneType", "thresholdPace"] as const).filter(key => after[key] !== next[key]);
  if (changed.length) throw new Error("The watch didn't keep the new profile. Reconnect and try again.");
  return summarizeWatchProfile(after, new Date().toISOString());
}
