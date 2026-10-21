import { WATCH_EPOCH } from "./corosWatchCommands";
import { cepFileFor, type CepFormat, type CepSpec } from "./corosWatchCep";
import { watchTakesSatelliteFormat } from "./localSync/watchSyncModels";
import type { WatchModelId } from "./watchModels";

/**
 * The watch's satellite-data (GPS assistance) state, read as the COROS app reads it.
 *
 * 1. The SystemBind reply CorosLink gets when it authenticates (a packed
 *    little-endian struct). Byte 0 holds the bind version in its high nibble;
 *    on success, bytes 11–14 are the satellite-data word: from
 *    version 4, a 24-bit start hour, 3-bit data type and 5-bit chip type (data
 *    covers 144 hours); before, a 24-bit start hour, 6-bit count of 6-hour
 *    blocks, then 1-bit type and chip.
 * 2. Settings type 13 (FW_INFO), which the app reads right after binding and
 *    which wins whenever it reports a duration: file type, data type, 6-hour
 *    block count and start
 *    hour, a second file, and the short-term ephemeris.
 *
 * File type: 0 MediaTek/Airoha EPO (data type 0 GPS
 * only, 1 all systems), 1 Sony, 2 Airoha ELPO, 3 Synaptics LTO. Hours count from
 * the watch's 2014 epoch when the data type is 1 or the file type Sony, else from
 * GPS time 0.
 *
 * All five models' 3.2008.0 firmware answer the bind with version 3 and the type
 * bit set (all systems), so the bind alone can't name the receiver: settings
 * type 13 does. The PACE 4 picks by its hardware variant (0 EPO, 1 ELPO,
 * 2 LTO, 3 Sony); the PACE 4 Pro and PACE 3 always say ELPO, the PACE Pro and
 * APEX 4 LTO with RTO ephemeris. Their bind count is constant: 24 blocks (ELPO on
 * the PACE 4 and PACE 4 Pro), 12 (ELPO on the PACE 3, which also reports a 96-hour
 * second file), 28 (LTO), 0 (EPO, whose start the firmware never fills in).
 */

/** GPS time starts 1980-01-06; the app adds 18 leap seconds. */
const GPS_EPOCH = 315_964_800 - 18;
/** Settings type 13. */
export const SETTING_FW_INFO = 13;
/** Marks an ephemeris file type, as the app stores it. */
const EPH_FLAG = 0x10000;

export type WatchSatelliteFormat = "mtk-epo" | "airoha-epo" | "sony" | "elpo" | "synaptics-lto" | "unknown";

export interface WatchGpsAssistance {
  format: WatchSatelliteFormat;
  /** gps_epo_file_type (the bind's chip type). */
  chipType: number;
  /** gps_epo_type: 0 GPS only, 1 all systems. */
  epoType: number;
  bindVersion: number;
  /** How long the loaded data covers, in hours (the firmware reports a fixed figure per receiver). */
  durationHours: number;
  /** Start of the loaded data, as the watch counts it (hours; 0 when it holds none). */
  startHour: number;
  /** When the loaded data runs out (Unix ms), or undefined when the watch holds none. */
  validUntil?: number;
  /** The second file (ELPO from 72 hours ahead, SendFile 68) from settings type 13: start in hours since 2014. */
  second?: { startHour: number; durationHours: number };
  /** Short-term ephemeris (Synaptics RTO, SendFile 70) from settings type 13: start in hours since 2014. */
  eph?: { fileType: number; epoType: number; startHour: number; durationHours: number };
  /** Where the figures come from. */
  source: "bind" | "settings";
  /** Bytes 11–14 of the bind reply, hex, for diagnostics. */
  raw: string;
  /** Settings type 13 as the watch sent it, hex, for diagnostics. */
  settingsRaw?: string;
  /** Files sent on this connection, by format: the start hour each carried. A sync never sends the same file twice on one connection. */
  sent?: Partial<Record<CepFormat, number>>;
}

/** The format the app picks for a file type and data type. */
export function satelliteFormat(fileType: number, epoType: number): WatchSatelliteFormat {
  switch (fileType) {
    case 0: return epoType === 0 ? "mtk-epo" : epoType === 1 ? "airoha-epo" : "unknown";
    case 1: return "sony";
    case 2: return epoType === 1 ? "elpo" : "unknown";
    case 3: return epoType === 1 ? "synaptics-lto" : "unknown";
    default: return "unknown";
  }
}

function validUntil(fileType: number, epoType: number, startHour: number, durationHours: number): number | undefined {
  if (startHour <= 0 || durationHours <= 0) return undefined;
  const base = fileType === 1 || epoType === 1 ? WATCH_EPOCH : GPS_EPOCH;
  return (base + (startHour + durationHours) * 3600) * 1000;
}

/** From a successful 17-byte SystemBind reply. */
export function decodeBindGpsAssistance(reply: Buffer): WatchGpsAssistance {
  if (reply.length !== 17) throw new Error("Unexpected bind reply length.");
  const bindVersion = reply[0]! >> 4;
  const word = reply.readUInt32LE(11);
  const startHour = word & 0xffffff;
  const v4 = bindVersion >= 4;
  const epoType = v4 ? (word >>> 24) & 7 : (word >>> 30) & 1;
  const chipType = v4 ? (word >>> 27) & 31 : (word >>> 31) & 1;
  const durationHours = v4 ? 144 : ((word >>> 24) & 63) * 6;
  const until = validUntil(chipType, epoType, startHour, durationHours);
  return {
    format: satelliteFormat(chipType, epoType),
    chipType, epoType, bindVersion, durationHours, startHour,
    ...(until !== undefined ? { validUntil: until } : {}),
    source: "bind",
    raw: reply.subarray(11, 15).toString("hex")
  };
}

/**
 * Settings type 13 (the bytes after its type and length), packed little-endian:
 * block_size_ratio, watchface_version, map_version, gps_epo_duraion (6-hour blocks),
 * gps_epo_type, gps_epo_file_type, gps_epo_duraion2, u32 gps_epo_start_hour,
 * u32 gps_epo_start_hour2, then gps_eph_type, gps_eph_file_type, u32 gps_eph_start_hour,
 * gps_eph_duraion (hours). As the app does, a reply without an EPO duration leaves the
 * bind's figures in place.
 */
export function applyFwInfoGpsAssistance(bind: WatchGpsAssistance | undefined, payload: Buffer): WatchGpsAssistance | undefined {
  const settingsRaw = payload.toString("hex");
  if (payload.length < 15 || payload[3] === 0) return bind ? { ...bind, settingsRaw } : undefined;
  const epoType = payload[4]!;
  const fileType = payload[5]!;
  const durationHours = payload[3]! * 6;
  const startHour = payload.readUInt32LE(7);
  const second = payload[6]! > 0 ? { startHour: payload.readUInt32LE(11), durationHours: payload[6]! * 6 } : undefined;
  const eph = payload.length >= 22 && payload[21]! > 0
    ? { epoType: payload[15]!, fileType: payload[16]! | EPH_FLAG, startHour: payload.readUInt32LE(17), durationHours: payload[21]! }
    : undefined;
  const until = validUntil(fileType, epoType, startHour, durationHours);
  return {
    format: satelliteFormat(fileType, epoType),
    chipType: fileType, epoType,
    bindVersion: bind?.bindVersion ?? 0,
    durationHours, startHour,
    ...(until !== undefined ? { validUntil: until } : {}),
    ...(second ? { second } : {}),
    ...(eph ? { eph } : {}),
    source: "settings",
    raw: bind?.raw ?? "",
    settingsRaw,
    ...(bind?.sent ? { sent: bind.sent } : {})
  };
}

/**
 * The COROS files this watch takes, in the order the app sends them (ephemeris
 * first, then the main file, then the second): the files picked from what it
 * reports, each with the start of the data it holds in that
 * slot, limited to the formats whose handling was checked in this model's
 * firmware (watchSyncModels.ts). Empty for anything else.
 */
export function satelliteFilesFor(assist: WatchGpsAssistance | undefined, model: WatchModelId | undefined): Array<{ spec: CepSpec; watchStartHour: number }> {
  if (!assist) return [];
  const slots: Array<[CepSpec | undefined, number]> = [];
  if (assist.eph && assist.eph.durationHours > 0) slots.push([cepFileFor(assist.eph.durationHours, assist.eph.fileType, assist.eph.epoType, 0), assist.eph.startHour]);
  slots.push([cepFileFor(assist.durationHours, assist.chipType, assist.epoType, 0), assist.startHour]);
  if (assist.second && assist.second.durationHours > 0) slots.push([cepFileFor(assist.second.durationHours, assist.chipType, assist.epoType, 1), assist.second.startHour]);
  return slots.flatMap(([spec, watchStartHour]) => spec && watchTakesSatelliteFormat(spec.format, model) ? [{ spec, watchStartHour }] : []);
}

