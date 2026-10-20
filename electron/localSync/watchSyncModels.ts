import type { CepFormat } from "../corosWatchCep";
import type { WatchModelId } from "../watchModels";

/**
 * Watches whose record files CorosLink reads (SyncData 5 and 14, never acknowledged).
 * The APEX 4 (W541) serves them as the PACE 4 does; the PACE 3 (W331, a PSoC 6
 * watch) runs the same code on another chip, with the same record layout.
 */
export const EXPERIMENTAL_SYNC_MODELS: ReadonlySet<WatchModelId> = new Set(["pace-4", "pace-4-pro", "pace-pro", "apex-4", "pace-3"]);

/**
 * Satellite-data formats (corosWatchCep.ts) and the models whose 3.2008.0 firmware
 * was checked to take each one: how SendFile stores it, the HF and CRC check, and
 * how the watch loads it. The watch says which format
 * it wants (settings type 13); a format it asks for that isn't listed for its
 * model is never sent.
 * - ELPO (file 13): PACE 4 (hardware variant 1 path), PACE 4 Pro, PACE 3.
 * - ELPO from 72 hours ahead (file 68): PACE 3, the only model reporting a second file.
 * - Synaptics LTO (file 13) and RTO ephemeris (file 70): PACE 4 (variant 2 path), PACE Pro, APEX 4.
 * - Not taken anywhere: MediaTek GPS-only EPO (no supported model asks for it: the
 *   bind's type bit is always "all systems"), Airoha EPO (the PACE 4's variant 0
 *   reports no data, and no file it would load is known) and Sony.
 */
export const SATELLITE_FORMAT_MODELS: Readonly<Record<CepFormat, ReadonlySet<WatchModelId>>> = {
  elpo: new Set(["pace-4", "pace-4-pro", "pace-3"]),
  "elpo-ahead": new Set(["pace-3"]),
  "synaptics-lto": new Set(["pace-4", "pace-pro", "apex-4"]),
  "synaptics-rto": new Set(["pace-4", "pace-pro", "apex-4"])
};

/**
 * What CorosLink writes to the watch, by feature, and the models it does so for.
 * Every byte-level fact was worked out on the PACE 4 (W336, firmware
 * 3.2008.0). The PACE 4 Pro (W337) and PACE Pro (W332) 3.2008.0 firmware are
 * the same build and behave the same for everything written here: the switch
 * words sit at the same offsets with the same meanings (clock, raise to wake,
 * quiet hours, notification filter, control centre, SYNC_TIME), and so do the
 * training profile, weather, the workout and plan files, and the record files.
 * GPS assistance is not the same: the PACE Pro has a Synaptics (Broadcom)
 * receiver taking LTO files and the PACE 4 Pro an Airoha one taking ELPO
 * (SATELLITE_FORMAT_MODELS above). The APEX 4 (W541) and PACE 3 (W331)
 * 3.2008.0 firmware were checked the same way: the APEX 4 behaves as the
 * PACE 4, the PACE 3 runs the same code on another chip. Their memory-in-pixel screens drop a
 * few display switches (corosWatchSettings.ts, per model), and their receivers
 * take LTO (APEX 4) and ELPO (PACE 3) files. A model missing from
 * a feature's list is never written to for that feature; the app says "Not
 * available on this watch."
 *
 * Reading (EXPERIMENTAL_SYNC_MODELS) and each write are kept as separate lists on
 * purpose: each is checked on its own, so a new model can be read
 * from before anything is written to it. Today the same five models pass every check.
 */
export type WatchFeature = "settings" | "profile" | "clockFormat" | "weather" | "workouts" | "calendar" | "satelliteData";

export const WATCH_FEATURE_MODELS: Readonly<Record<WatchFeature, ReadonlySet<WatchModelId>>> = {
  /** System switches (settings 0 and 31) written from Watch settings. */
  settings: EXPERIMENTAL_SYNC_MODELS,
  /** The training profile (setting 10). */
  profile: EXPERIMENTAL_SYNC_MODELS,
  /** The watch's own 12/24-hour switch, kept when the clock is set; other watches get this computer's format, as from the phone app. */
  clockFormat: EXPERIMENTAL_SYNC_MODELS,
  /** Weather on connect (SendFile 80). */
  weather: EXPERIMENTAL_SYNC_MODELS,
  /** Single workouts (SendFile 41). */
  workouts: EXPERIMENTAL_SYNC_MODELS,
  /** The training calendar (SendFile 42). */
  calendar: EXPERIMENTAL_SYNC_MODELS,
  /** GPS assistance (SendFile 13, 68 and 70): every model that takes at least one format. */
  satelliteData: new Set(Object.values(SATELLITE_FORMAT_MODELS).flatMap(models => [...models]))
};

export function watchTakesSatelliteFormat(format: CepFormat, model: WatchModelId | undefined): boolean {
  return model !== undefined && SATELLITE_FORMAT_MODELS[format].has(model);
}

export const NOT_AVAILABLE_ON_WATCH = "Not available on this watch.";

export function watchSupports(feature: WatchFeature, model: WatchModelId | undefined): boolean {
  return model !== undefined && WATCH_FEATURE_MODELS[feature].has(model);
}
