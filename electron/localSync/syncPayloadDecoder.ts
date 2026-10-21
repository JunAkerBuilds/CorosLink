import { decodeCorosSportRecordFile, type CorosSession } from "./corosSportRecord";
import { parseFitActivity } from "../fitActivity";
import { writeFitActivity } from "./fitWriter";
import { fitHeadline, fitSportFromCorosType, type FitHeadline } from "./localActivityDetail";

/**
 * Decoding of a sport-record sync payload: the paged format a PACE 4 writes
 * (`corosSportRecord.ts`), validated against COROS's own decoding. Each
 * finished activity becomes a FIT file. The raw payload is always archived
 * first; this only decides what can be listed now.
 */

const MAX_PROTO_FIELDS = 4096;

export class SyncPayloadFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncPayloadFormatError";
  }
}

const fail = (message: string): never => { throw new SyncPayloadFormatError(message); };

export type ProtoValue = number | Buffer;

/** Bounded protobuf wire decode; varints above 2^53 are rejected rather than rounded. */
export function decodeProtoFields(data: Buffer): Map<number, ProtoValue[]> {
  const fields = new Map<number, ProtoValue[]>();
  let offset = 0;
  let count = 0;
  const varint = (): number => {
    let value = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      if (offset >= data.length) fail("Truncated protobuf varint.");
      const byte = data[offset++]!;
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) {
        if (!Number.isSafeInteger(value)) fail("Protobuf varint out of range.");
        return value;
      }
    }
    return fail("Protobuf varint too long.");
  };
  while (offset < data.length) {
    if (++count > MAX_PROTO_FIELDS) fail("Too many protobuf fields.");
    const key = varint();
    const tag = Math.floor(key / 8);
    const wire = key % 8;
    if (tag <= 0) fail("Invalid protobuf tag.");
    let value: ProtoValue;
    if (wire === 0) value = varint();
    else if (wire === 1) {
      if (offset + 8 > data.length) fail("Truncated protobuf fixed64.");
      value = Number(data.readBigUInt64LE(offset));
      offset += 8;
    } else if (wire === 2) {
      const size = varint();
      if (size > data.length - offset) fail("Truncated protobuf bytes.");
      value = data.subarray(offset, offset + size);
      offset += size;
    } else if (wire === 5) {
      if (offset + 4 > data.length) fail("Truncated protobuf fixed32.");
      value = data.readUInt32LE(offset);
      offset += 4;
    } else {
      return fail("Unsupported protobuf wire type.");
    }
    const list = fields.get(tag) ?? [];
    list.push(value);
    fields.set(tag, list);
  }
  return fields;
}

export function isFitFile(bytes: Uint8Array): boolean {
  return bytes.length >= 14 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

export interface DecodedWatchRecord {
  /** Stable identity: the activity's start time and sport. */
  watchActivityId: string;
  fit: Buffer;
  /** COROS sport type, more specific than what FIT can carry. */
  sportType: number;
  /** The FIT file read back, as the activity list shows it. */
  headline: FitHeadline;
}

export interface DecodedSyncPayload {
  decoder: string;
  records: DecodedWatchRecord[];
  unrecognised: number;
  /** What was skipped and why, for the payload's record (never shown as a failure: the rest decoded). */
  notes?: string;
}

/** Bump when the sport-record decoder or FIT output changes; stored watch activities are then re-decoded at startup. */
export const COROS_SPORT_RECORD_DECODER = "coros-sport-record/v1";

/** One decoded watch activity as a FIT file; deterministic, so re-decoding the same payload yields the same bytes. */
export function corosSessionToFit(session: CorosSession): Buffer {
  return writeFitActivity({
    ...fitSportFromCorosType(session.sportType),
    ...session,
    createdTs: session.endTs,
    laps: session.laps.map((lap, index) => ({ ...lap, endTs: session.laps[index + 1]?.startTs ?? session.endTs }))
  });
}

/** Throws CorosSportRecordFormatError when the file isn't a sport-record file; the caller keeps the raw bytes. */
export function decodeSportSyncPayload(file: Buffer): DecodedSyncPayload {
  const records: DecodedWatchRecord[] = [];
  let unwritable = 0;
  // One activity at a time: each becomes a FIT file before the next one's samples are built.
  // A FIT file that can't be written or read back is set aside like a damaged activity, never dropped unnoticed.
  const decoded = decodeCorosSportRecordFile(file, (session) => {
    try {
      const fit = corosSessionToFit(session);
      records.push({ watchActivityId: session.watchActivityId, fit, sportType: session.sportType, headline: fitHeadline(parseFitActivity(new Uint8Array(fit))) });
    } catch {
      unwritable += 1;
    }
  });
  const notes = [
    decoded.rejected + unwritable ? `${decoded.rejected + unwritable} activit${decoded.rejected + unwritable === 1 ? "y" : "ies"} set aside (implausible times or damaged records).` : "",
    decoded.skippedRecords ? `${decoded.skippedRecords} damaged sample record${decoded.skippedRecords === 1 ? "" : "s"} skipped.` : ""
  ].filter(Boolean).join(" ");
  return {
    decoder: COROS_SPORT_RECORD_DECODER,
    records,
    // Activities still being recorded, or without a summary, are picked up by a later sync; damaged ones wait for a better decoder.
    unrecognised: decoded.incomplete + decoded.rejected + unwritable,
    ...(notes ? { notes } : {})
  };
}
