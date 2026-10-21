import crypto from "node:crypto";
import { WATCH_EPOCH } from "./corosWatchCommands";
import { encodeWatchFile, SATELLITE_FILE_LIMIT } from "./corosBleTrainingProtocol";

/**
 * GPS assistance for watches whose receiver takes COROS's "cep" files, as the
 * phone app sends them: Airoha ELPO (PACE 4 Pro, PACE 3,
 * and a PACE 4 that reports ELPO) and Synaptics LTO, plus RTO short-term
 * ephemeris (PACE Pro, APEX 4, and a PACE 4 that reports LTO).
 *
 * COROS lists the newest files at `epo.coros.com/cep/query` (no sign-in) by
 * `type`, each with a download link on
 * s3.coros.com, an MD5 and a timestamp. A file is a run of sections, each a
 * 16-byte header {u32 start (seconds since 2014-01-01 UTC), u32 duration
 * (seconds), u32 payload length, u8 section type, u8 subtype, u16 0} and its
 * payload, filling the file exactly. The app wraps the whole file in the
 * watch's 16-byte "HF" header (file id, the first section's start as its time,
 * CRC-16 of the body) and sends it with SendFile, the start hour (since 2014)
 * in the 3 extra header bytes of every block. The watch checks the HF header
 * and both CRCs before it uses the file, and reports the start of what it holds
 * in settings type 13 and the bind reply (hours since 2014).
 *
 * Which file goes where follows what the watch reports in settings type 13,
 * as in the app: its file type, data type and duration for the main file
 * (SendFile 13), a second file (68) and an ephemeris (70). Firmware (3.2008.0):
 * - ELPO, file 13: a PACE 4 with hardware variant 1 and the PACE 4 Pro store it
 *   only after the HF and CRC check, and read sections 5, 4 and 3; they report
 *   144 hours, so the 6-day file. The PACE 3 reports 72 hours (the 3-day file)
 *   and takes the next 96 hours as a second file, 68, which it falls back to
 *   when file 13 runs out.
 * - LTO, file 13, and RTO, file 70: a PACE 4 with hardware variant 2, the PACE
 *   Pro and the APEX 4 hand the payload after the section header to the
 *   receiver, refusing data that has expired; LTO must cover 24 hours or more,
 *   RTO less.
 * - Files 13, 68 and 70 take at most 256 KB (SendFile descriptors); the extra
 *   bytes are ignored. No model checks the subtype; CorosLink does.
 */

export type CepFormat = "elpo" | "elpo-ahead" | "synaptics-lto" | "synaptics-rto";

export interface CepSpec {
  format: CepFormat;
  /** `type` in cep/query. */
  serverType: number;
  /** SendFile id. */
  fileId: number;
  /** Section types the file holds, the first one first. */
  sections: readonly number[];
  /** Subtype every section carries. */
  subtype: number;
  /** Hours the first section covers. */
  hours: number;
  /** How long a downloaded file is used before asking COROS for a newer one. */
  refreshMs: number;
}

const ELPO_SECTIONS = [5, 4, 3] as const;
const SIX_HOURS = 6 * 3_600_000;

/** The COROS files CorosLink sends, by cep/query type. */
export const CEP_FILES: Readonly<Record<number, CepSpec>> = {
  /** ELPO_3: 72 hours from today. */
  61: { format: "elpo", serverType: 61, fileId: 13, sections: ELPO_SECTIONS, subtype: 1, hours: 72, refreshMs: SIX_HOURS },
  /** ELPO_7 (the "6day" file): 144 hours from today. */
  62: { format: "elpo", serverType: 62, fileId: 13, sections: ELPO_SECTIONS, subtype: 1, hours: 144, refreshMs: SIX_HOURS },
  /** ELPO_4: orbits from 72 hours ahead, the second file. */
  63: { format: "elpo-ahead", serverType: 63, fileId: 68, sections: ELPO_SECTIONS, subtype: 1, hours: 72, refreshMs: SIX_HOURS },
  /** SYNA_LTO: 168 hours. */
  82: { format: "synaptics-lto", serverType: 82, fileId: 13, sections: [6], subtype: 2, hours: 168, refreshMs: SIX_HOURS },
  /** SYNA_RTO: a 4-hour ephemeris, renewed through the day. */
  81: { format: "synaptics-rto", serverType: 81, fileId: 70, sections: [6], subtype: 3, hours: 4, refreshMs: 3_600_000 }
};

/**
 * The app's satellite-file table for the receivers the watches report:
 * cep/query type, duration (hours), file type, data type, file index. EPO_GR rows
 * are here so that a watch asking for them is matched, and then sent nothing.
 */
const APP_EPO_TYPES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [51, 72, 0, 1, 0], [52, 144, 0, 1, 0], [53, 360, 0, 1, 0],
  [61, 72, 2, 1, 0], [62, 168, 2, 1, 0], [63, 96, 2, 1, 1],
  [81, 4, 0x10001, 1, 0], [82, 168, 3, 1, 0]
];

/**
 * The file for what the watch reports, picked as the app picks it. An exact duration match,
 * else the 144- or 168-hour file of that kind, else its first; null when no row fits.
 * Returns the CorosLink spec, or undefined for a file CorosLink doesn't send.
 */
export function cepFileFor(durationHours: number, fileType: number, epoType: number, index: number): CepSpec | undefined {
  const kind = APP_EPO_TYPES.filter(([, , file, data, slot]) => file === fileType && data === epoType && slot === index);
  const anyIndex = APP_EPO_TYPES.filter(([, , file, data]) => file === fileType && data === epoType);
  const prefer = (rows: typeof kind) => rows.find(([, hours]) => hours === 144 || hours === 168) ?? rows[0];
  const row = kind.find(([, hours]) => hours === durationHours) ?? prefer(kind) ?? prefer(anyIndex);
  return row ? CEP_FILES[row[0]] : undefined;
}

/** The HF header counts toward the watch's 256 KB. */
const MAX_BODY_BYTES = SATELLITE_FILE_LIMIT - 16;
const MAX_INDEX_BYTES = 64 * 1024;
const CEP_INDEX = "https://epo.coros.com/cep/query";
/** Seconds from GPS time 0 to the watch's 2014 epoch (0x3fee1d00), as the watch adds them. */
const GPS_TO_WATCH_EPOCH = WATCH_EPOCH - 315_964_800;
/** ELPO section 5: per 6-hour segment, 56 satellite records (GPS 1–32, GLONASS 65–88) of 72 bytes, each stamped with the segment's GPS hour. */
const ELPO_SEGMENT_BYTES = 56 * 72;

export interface CepFile {
  format: CepFormat;
  serverType: number;
  /** The file as COROS serves it (sections only, no HF header). */
  data: Buffer;
  /** Start of the first section, seconds since 2014-01-01 UTC. */
  startSeconds: number;
  /** The same in hours, as the watch reports it. */
  startHour: number;
  /** Hours the first section covers. */
  hours: number;
}

/** Hours since 2014-01-01 UTC, the watch's count for this data. */
export const watchHour = (unixMs: number) => Math.floor((unixMs / 1000 - WATCH_EPOCH) / 3600);
export const unixMsOfWatchHour = (hour: number) => (WATCH_EPOCH + hour * 3600) * 1000;

/** Checks a file against its format: whole sections of the expected types, and (ELPO) every satellite record stamped with its segment's hour. */
export function parseCepFile(bytes: Buffer, spec: CepSpec): CepFile {
  const damaged = () => new Error("The satellite data isn't in the expected format.");
  if (bytes.length < 17 || bytes.length > MAX_BODY_BYTES) throw damaged();
  const seen = new Set<number>();
  let first: { start: number; seconds: number; offset: number; length: number } | undefined;
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 16 > bytes.length) throw damaged();
    const start = bytes.readUInt32LE(offset);
    const seconds = bytes.readUInt32LE(offset + 4);
    const length = bytes.readUInt32LE(offset + 8);
    const type = bytes[offset + 12]!;
    if (!length || offset + 16 + length > bytes.length || bytes[offset + 13] !== spec.subtype || bytes.readUInt16LE(offset + 14) !== 0 ||
        !spec.sections.includes(type) || seen.has(type) || (!first && type !== spec.sections[0]) || !start || !seconds) throw damaged();
    seen.add(type);
    first ??= { start, seconds, offset: offset + 16, length };
    offset += 16 + length;
  }
  if (!first || first.seconds !== spec.hours * 3600) throw damaged();
  if (spec.sections === ELPO_SECTIONS) {
    const segments = spec.hours / 6;
    if (first.start % 3600 || first.length !== segments * ELPO_SEGMENT_BYTES) throw damaged();
    const firstGpsHour = (first.start + GPS_TO_WATCH_EPOCH) / 3600;
    for (let record = 0; record * 72 < first.length; record++) {
      const hour = firstGpsHour + Math.floor(record * 72 / ELPO_SEGMENT_BYTES) * 6;
      if (bytes.readUIntLE(first.offset + record * 72, 3) !== hour) throw new Error("The satellite data is out of order.");
    }
  }
  return { format: spec.format, serverType: spec.serverType, data: Buffer.from(bytes), startSeconds: first.start, startHour: Math.floor(first.start / 3600), hours: spec.hours };
}

/**
 * The app's rule: send when COROS's file starts later than the data the
 * watch reports; the file replaces it whole. A file that has already run out is never sent.
 */
export function cepFileIsNewer(watchStartHour: number | undefined, file: Pick<CepFile, "startHour" | "hours">, nowHour: number): boolean {
  if (file.startHour + file.hours <= nowHour) return false;
  return file.startHour > (watchStartHour ?? 0);
}

/** What goes over SendFile: the file in an HF header carrying its start time, and the start hour for the block headers. */
export function encodeCepTransfer(file: CepFile): { fileId: number; bytes: Buffer; extra: [number, number, number] } {
  const spec = CEP_FILES[file.serverType];
  if (!spec || spec.format !== file.format) throw new Error("Unknown satellite data.");
  // encodeWatchFile keeps a time below the 2014 epoch as it is: here it is already in watch seconds.
  const bytes = encodeWatchFile(file.data, spec.fileId, file.startSeconds);
  if (bytes.length > SATELLITE_FILE_LIMIT) throw new Error("The satellite data is larger than the watch takes.");
  const hour = file.startHour;
  return { fileId: spec.fileId, bytes, extra: [hour & 0xff, (hour >> 8) & 0xff, (hour >> 16) & 0xff] };
}

/** A response body, refused (and the rest left unread) once it is larger than `maxBytes`, so a misbehaving server can't fill memory. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers?.get("content-length") ?? NaN);
  const tooLarge = () => new Error("The satellite data is larger than expected.");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface CepIndexEntry { type: number; url: string; md5: string; timestamp: number }

const noData = () => new Error("The satellite-data server sent no data.");

/** The newest files COROS has, by type (cep/query; no account, nothing about the user is sent). */
export async function fetchCepIndex(fetchImpl: typeof fetch = fetch): Promise<CepIndexEntry[]> {
  // The app adds a random number so that no cache answers with an old list.
  const url = `${CEP_INDEX}?r=${crypto.randomInt(1, 2 ** 47)}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`The satellite-data server isn't available right now (error ${response.status}). Try again later.`);
  let body: { result?: unknown; data?: unknown } | null;
  try { body = JSON.parse((await readCapped(response, MAX_INDEX_BYTES)).toString("utf8")) as typeof body; } catch (error) {
    if (error instanceof SyntaxError) throw noData();
    throw error;
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) throw noData();
  return body.data.flatMap((item: unknown) => {
    const entry = item as Partial<CepIndexEntry> | null;
    return entry && typeof entry === "object" && Number.isSafeInteger(entry.type) && typeof entry.url === "string" &&
      typeof entry.md5 === "string" && /^[0-9a-f]{32}$/i.test(entry.md5) && Number.isFinite(entry.timestamp)
      ? [{ type: entry.type!, url: entry.url, md5: entry.md5.toLowerCase(), timestamp: entry.timestamp! }]
      : [];
  });
}

/** Downloads the newest file of one format and checks it (link, size, MD5, format, and its start against the server's timestamp). */
export async function fetchCepFile(spec: CepSpec, fetchImpl: typeof fetch = fetch, index?: CepIndexEntry[]): Promise<CepFile> {
  const entry = (index ?? await fetchCepIndex(fetchImpl)).find(item => item.type === spec.serverType);
  if (!entry) throw noData();
  let parsed: URL;
  try { parsed = new URL(entry.url); } catch { throw new Error("The satellite-data server sent an unexpected download link."); }
  if (parsed.protocol !== "https:" || !/(^|\.)coros\.com$/.test(parsed.hostname)) throw new Error("The satellite-data server sent an unexpected download link.");
  const response = await fetchImpl(parsed, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Satellite data couldn't be downloaded (error ${response.status}). Try again later.`);
  const bytes = await readCapped(response, MAX_BODY_BYTES);
  if (crypto.createHash("md5").update(bytes).digest("hex") !== entry.md5) throw new Error("The satellite data was damaged during download. Try again later.");
  const file = parseCepFile(bytes, spec);
  // The server dates each file by its start (ELPO, LTO) or its creation a few seconds later (RTO); a file far from that is not the one listed.
  if (Math.abs(file.startSeconds - (entry.timestamp - WATCH_EPOCH)) > 2 * 86_400) throw new Error("The satellite data isn't in the expected format.");
  return file;
}
