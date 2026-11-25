// The small protobuf reader and writer the watch's messages need. A port of CorosKit's WatchData/Protobuf.swift
// (ProtoWriter, ProtoField, ProtoReader). Varints are bigint so 64-bit values and negative int32s survive.
import { CorosError, u32 } from "./bytes";

const damaged = () => new CorosError("The watch sent a damaged message.");

/** A varint's bytes; negative numbers go as 64-bit two's complement, as int32 and int64 do. */
export function varint(value: bigint | number): number[] {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
}

/** Proto3 writer: zero values and empty lists aren't written. */
export class ProtoWriter {
  private parts: number[] = [];

  get data(): Buffer { return Buffer.from(this.parts); }

  private tag(field: number, wire: number): void { this.parts.push(...varint((BigInt(field) << 3n) | BigInt(wire))); }

  int(field: number, value: number | null | undefined): this {
    if (value == null || value === 0) return this;
    this.tag(field, 0);
    this.parts.push(...varint(value));
    return this;
  }

  /** sint32 / sint64 (zigzag). */
  sint(field: number, value: number | null | undefined): this {
    if (value == null) return this;
    const v = BigInt.asIntN(64, BigInt(value));
    return this.int(field, Number(BigInt.asIntN(64, (v << 1n) ^ (v >> 63n))));
  }

  string(field: number, value: string | null | undefined): this {
    if (!value) return this;
    return this.bytes(field, Buffer.from(value, "utf8"));
  }

  packed(field: number, values: readonly number[]): this {
    if (values.length === 0) return this;
    return this.bytes(field, Buffer.from(values.flatMap((v) => varint(v))));
  }

  message(field: number, body: Uint8Array): this { return this.bytes(field, body); }

  raw(encoded: Uint8Array): this {
    this.parts.push(...encoded);
    return this;
  }

  private bytes(field: number, body: Uint8Array): this {
    this.tag(field, 2);
    this.parts.push(...varint(body.length), ...body);
    return this;
  }
}

export type ProtoValue =
  | { kind: "varint"; value: bigint }
  | { kind: "bytes"; value: Buffer }
  | { kind: "fixed32"; value: number }
  | { kind: "fixed64"; value: bigint };

/** One field as read; `encoded` is the field as it appeared, tag included, so it can be written back unchanged. */
export interface ProtoField { number: number; value: ProtoValue; encoded: Buffer }

export const fieldVarint = (f: ProtoField): bigint | null => (f.value.kind === "varint" ? f.value.value : null);
export const fieldBytes = (f: ProtoField): Buffer | null => (f.value.kind === "bytes" ? f.value.value : null);
/** int32 as protobuf writes negatives (64-bit two's complement). */
export const fieldInt32 = (f: ProtoField): number | null => (f.value.kind === "varint" ? Number(BigInt.asIntN(32, f.value.value)) : null);

/** Most fields read from one message: the watch is a Bluetooth peer, so its bytes are bounded. */
const MAXIMUM_FIELDS = 100_000;

export function protoFields(input: Uint8Array): ProtoField[] {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const fields: ProtoField[] = [];
  let offset = 0;
  const readVarint = (): bigint => {
    let value = 0n, shift = 0n;
    while (offset < data.length) {
      const byte = data[offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return BigInt.asUintN(64, value);
      shift += 7n;
      if (shift > 63n) break;
    }
    throw damaged();
  };
  while (offset < data.length) {
    if (fields.length >= MAXIMUM_FIELDS) throw damaged();
    const start = offset;
    const key = readVarint();
    const number = Number(key >> 3n);
    if (number <= 0) throw damaged();
    let value: ProtoValue;
    switch (Number(key & 7n)) {
      case 0: value = { kind: "varint", value: readVarint() }; break;
      case 1: {
        if (offset + 8 > data.length) throw damaged();
        value = { kind: "fixed64", value: data.readBigUInt64LE(offset) };
        offset += 8;
        break;
      }
      case 2: {
        const length = readVarint();
        if (length > BigInt(data.length - offset)) throw damaged();
        value = { kind: "bytes", value: Buffer.from(data.subarray(offset, offset + Number(length))) };
        offset += Number(length);
        break;
      }
      case 5: {
        if (offset + 4 > data.length) throw damaged();
        value = { kind: "fixed32", value: u32(data, offset) };
        offset += 4;
        break;
      }
      default: throw damaged();
    }
    fields.push({ number, value, encoded: Buffer.from(data.subarray(start, offset)) });
  }
  return fields;
}

/** Packed varints, or null when they don't end cleanly. */
export function packedVarints(data: Uint8Array): bigint[] | null {
  const values: bigint[] = [];
  let value = 0n, shift = 0n;
  for (const byte of data) {
    value |= BigInt(byte & 0x7f) << shift;
    if (byte & 0x80) {
      shift += 7n;
      if (shift > 63n) return null;
    } else {
      values.push(BigInt.asUintN(64, value));
      value = 0n;
      shift = 0n;
    }
  }
  return shift === 0n ? values : null;
}
