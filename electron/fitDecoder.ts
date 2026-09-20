/**
 * Minimal FIT binary decoder. Dependency-free on purpose: CorosLink only needs
 * a handful of global messages (file_id, session, lap, record, event) and reads
 * raw field values by field number; profile scaling happens in fitActivity.ts.
 *
 * Handles normal and compressed-timestamp record headers, both architectures,
 * developer fields (skipped by size), arrays, and base-type invalid sentinels.
 */

export type FitFieldValue = number | string | (number | undefined)[] | undefined;

export interface FitMessage {
  globalNum: number;
  /** Raw values by field definition number; arrays for multi-element fields. */
  fields: Map<number, FitFieldValue>;
}

export interface FitDecodeResult {
  protocolVersion: number;
  profileVersion: number;
  messages: FitMessage[];
  /** Global message numbers seen in definitions but not decoded. */
  skipped: number[];
}

export class FitDecodeError extends Error {}

interface FieldDefinition {
  num: number;
  size: number;
  baseType: number;
}

interface LocalDefinition {
  globalNum: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
  developerBytes: number;
  totalSize: number;
}

const BASE_TYPE_SIZE: Record<number, number> = {
  0x00: 1, // enum
  0x01: 1, // sint8
  0x02: 1, // uint8
  0x07: 1, // string
  0x83: 2, // sint16
  0x84: 2, // uint16
  0x85: 4, // sint32
  0x86: 4, // uint32
  0x88: 4, // float32
  0x89: 8, // float64
  0x0a: 1, // uint8z
  0x8b: 2, // uint16z
  0x8c: 4, // uint32z
  0x0d: 1, // byte
  0x8e: 8, // sint64
  0x8f: 8, // uint64
  0x90: 8 // uint64z
};

const TIMESTAMP_FIELD = 253;
/** Messages worth decoding; everything else is skipped by size. */
export const FIT_MSG = {
  FILE_ID: 0,
  SESSION: 18,
  LAP: 19,
  RECORD: 20,
  EVENT: 21
} as const;

const DEFAULT_WANTED = new Set<number>([
  FIT_MSG.FILE_ID,
  FIT_MSG.SESSION,
  FIT_MSG.LAP,
  FIT_MSG.RECORD,
  FIT_MSG.EVENT
]);

function readScalar(
  view: DataView,
  offset: number,
  baseType: number,
  littleEndian: boolean
): number | undefined {
  switch (baseType) {
    case 0x00:
    case 0x02:
    case 0x0d: {
      const value = view.getUint8(offset);
      return value === 0xff ? undefined : value;
    }
    case 0x0a: {
      const value = view.getUint8(offset);
      return value === 0 ? undefined : value;
    }
    case 0x01: {
      const value = view.getInt8(offset);
      return value === 0x7f ? undefined : value;
    }
    case 0x83: {
      const value = view.getInt16(offset, littleEndian);
      return value === 0x7fff ? undefined : value;
    }
    case 0x84: {
      const value = view.getUint16(offset, littleEndian);
      return value === 0xffff ? undefined : value;
    }
    case 0x8b: {
      const value = view.getUint16(offset, littleEndian);
      return value === 0 ? undefined : value;
    }
    case 0x85: {
      const value = view.getInt32(offset, littleEndian);
      return value === 0x7fffffff ? undefined : value;
    }
    case 0x86: {
      const value = view.getUint32(offset, littleEndian);
      return value === 0xffffffff ? undefined : value;
    }
    case 0x8c: {
      const value = view.getUint32(offset, littleEndian);
      return value === 0 ? undefined : value;
    }
    case 0x88: {
      const raw = view.getUint32(offset, littleEndian);
      if (raw === 0xffffffff) return undefined;
      const value = view.getFloat32(offset, littleEndian);
      return Number.isFinite(value) ? value : undefined;
    }
    case 0x89: {
      const value = view.getFloat64(offset, littleEndian);
      return Number.isFinite(value) ? value : undefined;
    }
    case 0x8e: {
      const value = view.getBigInt64(offset, littleEndian);
      return value === 0x7fffffffffffffffn ? undefined : Number(value);
    }
    case 0x8f: {
      const value = view.getBigUint64(offset, littleEndian);
      return value === 0xffffffffffffffffn ? undefined : Number(value);
    }
    case 0x90: {
      const value = view.getBigUint64(offset, littleEndian);
      return value === 0n ? undefined : Number(value);
    }
    default:
      return undefined;
  }
}

function readField(
  view: DataView,
  offset: number,
  field: FieldDefinition,
  littleEndian: boolean
): FitFieldValue {
  const baseType = field.baseType;
  if (baseType === 0x07) {
    let end = offset;
    const limit = offset + field.size;
    while (end < limit && view.getUint8(end) !== 0) end += 1;
    if (end === offset) return undefined;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, end - offset);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  const unit = BASE_TYPE_SIZE[baseType];
  if (!unit || field.size < unit) {
    // Unknown base type or truncated field: caller already advances by size.
    return undefined;
  }
  const count = Math.floor(field.size / unit);
  if (count === 1) {
    return readScalar(view, offset, baseType, littleEndian);
  }
  const values: (number | undefined)[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(readScalar(view, offset + index * unit, baseType, littleEndian));
  }
  return values;
}

/**
 * Decode a FIT byte buffer. `wanted` limits which global messages are
 * materialized; the rest are skipped so large files stay cheap.
 */
export function decodeFit(
  input: Uint8Array | ArrayBuffer,
  wanted: ReadonlySet<number> = DEFAULT_WANTED
): FitDecodeResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 12) {
    throw new FitDecodeError("File is too small to be a FIT file.");
  }
  const headerSize = view.getUint8(0);
  if (headerSize !== 12 && headerSize !== 14) {
    throw new FitDecodeError(`Unexpected FIT header size ${headerSize}.`);
  }
  const signature = String.fromCharCode(
    bytes[8],
    bytes[9],
    bytes[10],
    bytes[11]
  );
  if (signature !== ".FIT") {
    throw new FitDecodeError("Missing .FIT signature.");
  }
  const protocolVersion = view.getUint8(1);
  const profileVersion = view.getUint16(2, true);
  const dataSize = view.getUint32(4, true);
  const dataEnd = Math.min(bytes.length, headerSize + dataSize);

  const locals = new Map<number, LocalDefinition>();
  const messages: FitMessage[] = [];
  const skipped = new Set<number>();
  let lastTimestamp: number | undefined;
  let offset = headerSize;

  while (offset < dataEnd) {
    const header = view.getUint8(offset);
    offset += 1;

    const compressed = (header & 0x80) !== 0;
    if (!compressed && (header & 0x40) !== 0) {
      // Definition message.
      const hasDeveloper = (header & 0x20) !== 0;
      const localNum = header & 0x0f;
      if (offset + 5 > dataEnd) break;
      const littleEndian = view.getUint8(offset + 1) === 0;
      const globalNum = view.getUint16(offset + 2, littleEndian);
      const fieldCount = view.getUint8(offset + 4);
      offset += 5;

      const fields: FieldDefinition[] = [];
      let totalSize = 0;
      for (let index = 0; index < fieldCount; index += 1) {
        if (offset + 3 > dataEnd) break;
        const field = {
          num: view.getUint8(offset),
          size: view.getUint8(offset + 1),
          baseType: view.getUint8(offset + 2)
        };
        fields.push(field);
        totalSize += field.size;
        offset += 3;
      }

      let developerBytes = 0;
      if (hasDeveloper) {
        const developerCount = view.getUint8(offset);
        offset += 1;
        for (let index = 0; index < developerCount; index += 1) {
          if (offset + 3 > dataEnd) break;
          developerBytes += view.getUint8(offset + 1);
          offset += 3;
        }
      }

      locals.set(localNum, {
        globalNum,
        littleEndian,
        fields,
        developerBytes,
        totalSize: totalSize + developerBytes
      });
      continue;
    }

    // Data message (normal or compressed timestamp header).
    const localNum = compressed ? (header >> 5) & 0x03 : header & 0x0f;
    const definition = locals.get(localNum);
    if (!definition) {
      throw new FitDecodeError(
        `Data message references undefined local type ${localNum} at byte ${offset - 1}.`
      );
    }
    if (offset + definition.totalSize > dataEnd) break;

    let compressedTimestamp: number | undefined;
    if (compressed && lastTimestamp !== undefined) {
      const timeOffset = header & 0x1f;
      const base = lastTimestamp & ~0x1f;
      compressedTimestamp =
        base + timeOffset + (timeOffset < (lastTimestamp & 0x1f) ? 0x20 : 0);
      lastTimestamp = compressedTimestamp;
    }

    const decode = wanted.has(definition.globalNum);
    if (!decode) {
      skipped.add(definition.globalNum);
      // Still track full timestamps so later compressed headers stay correct.
      let cursor = offset;
      for (const field of definition.fields) {
        if (field.num === TIMESTAMP_FIELD && field.baseType === 0x86) {
          const stamp = readScalar(view, cursor, 0x86, definition.littleEndian);
          if (stamp !== undefined) lastTimestamp = stamp;
        }
        cursor += field.size;
      }
      offset += definition.totalSize;
      continue;
    }

    const fields = new Map<number, FitFieldValue>();
    let cursor = offset;
    for (const field of definition.fields) {
      const value = readField(view, cursor, field, definition.littleEndian);
      if (value !== undefined) {
        fields.set(field.num, value);
        if (field.num === TIMESTAMP_FIELD && typeof value === "number") {
          lastTimestamp = value;
        }
      }
      cursor += field.size;
    }
    if (compressedTimestamp !== undefined && !fields.has(TIMESTAMP_FIELD)) {
      fields.set(TIMESTAMP_FIELD, compressedTimestamp);
    }
    messages.push({ globalNum: definition.globalNum, fields });
    offset += definition.totalSize;
  }

  return {
    protocolVersion,
    profileVersion,
    messages,
    skipped: [...skipped].sort((left, right) => left - right)
  };
}

/** FIT epoch (1989-12-31T00:00:00Z) → Unix seconds. */
export const FIT_EPOCH_OFFSET_SECONDS = 631_065_600;

export function fitTimestampToUnixSeconds(value: number): number {
  return value + FIT_EPOCH_OFFSET_SECONDS;
}

/** Semicircles → degrees. */
export function semicirclesToDegrees(value: number): number {
  return (value * 180) / 2 ** 31;
}
