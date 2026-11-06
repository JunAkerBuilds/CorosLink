/**
 * Decoders for COROS's weather payloads (`weather/query` → data.weather and
 * data.weatherStruct). Schema recovered from the CRSLWeatherUI.proto file
 * descriptor embedded in the COROS Android app (package SportDataPB).
 *
 * weatherStruct is what the phone forwards to the watch over Bluetooth: a run
 * of sections, each a 6-byte javolution header (u8, u8, u16 length, u16)
 * followed by `length` payload bytes; the app parses payloads as
 * WeatherForecastUI.
 */

type FieldKind = "uint" | "int" | "sint" | "string" | "bytes" | "message";

interface FieldSpec {
  name: string;
  kind: FieldKind;
  repeated?: boolean;
  message?: string;
}

const SCHEMA: Record<string, Record<number, FieldSpec>> = {
  WeatherUI: {
    1: { name: "provider", kind: "uint" },
    2: { name: "weatherType", kind: "uint" },
    3: { name: "temperature", kind: "int" },
    4: { name: "bodyFeelTemp", kind: "int" },
    5: { name: "humidity", kind: "int" },
    6: { name: "windDirectionType", kind: "uint" },
    7: { name: "windDirection", kind: "uint" },
    8: { name: "windSpeed", kind: "uint" },
    9: { name: "minTemperature", kind: "int" },
    10: { name: "maxTemperature", kind: "int" },
    11: { name: "precip", kind: "uint" },
    12: { name: "uvi", kind: "uint" },
    13: { name: "aqi", kind: "uint" },
    14: { name: "obsTimestamp", kind: "uint" },
    15: { name: "tideHeight", kind: "sint" },
    16: { name: "pressure", kind: "sint" },
    17: { name: "moonAltitude", kind: "sint" },
    18: { name: "windGust", kind: "uint" },
    31: { name: "imagePath", kind: "string" },
    32: { name: "imagePathDark", kind: "string" },
    33: { name: "fileName", kind: "string" }
  },
  WeatherForecastUI: {
    1: { name: "current", kind: "message", message: "WeatherUI" },
    2: { name: "hourly", kind: "message", message: "WeatherUI", repeated: true },
    3: { name: "daily", kind: "message", message: "WeatherUI", repeated: true },
    4: { name: "provider", kind: "uint" },
    5: { name: "aqiProvider", kind: "uint" },
    6: { name: "timestamp", kind: "uint" },
    7: { name: "timezone", kind: "int" },
    8: { name: "lat", kind: "sint" },
    9: { name: "long", kind: "sint" },
    10: { name: "city", kind: "string" },
    11: { name: "bspQueryInterval", kind: "uint" },
    12: { name: "weatherExpire", kind: "uint" },
    13: { name: "appQueryInterval", kind: "uint" },
    33: { name: "tideEvents", kind: "message", message: "TideEvent", repeated: true },
    99: { name: "code", kind: "int" }
  },
  TideEvent: {
    1: { name: "timestamp", kind: "uint" },
    2: { name: "tideType", kind: "uint" },
    3: { name: "height", kind: "sint" }
  }
};

type Decoded = Record<string, unknown>;

interface RawField {
  field: number;
  wire: number;
  varint?: bigint;
  bytes?: Uint8Array;
  fixed?: Uint8Array;
}

function readVarint(data: Uint8Array, start: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let pos = start;
  for (;;) {
    if (pos >= data.length) throw new Error("truncated varint");
    const byte = data[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if (byte < 0x80) return [result, pos];
    shift += 7n;
    if (shift > 70n) throw new Error("varint too long");
  }
}

function readRawFields(data: Uint8Array): RawField[] {
  const fields: RawField[] = [];
  let pos = 0;
  while (pos < data.length) {
    const [tag, afterTag] = readVarint(data, pos);
    pos = afterTag;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field === 0) throw new Error("field number 0");
    if (wire === 0) {
      const [value, next] = readVarint(data, pos);
      fields.push({ field, wire, varint: value });
      pos = next;
    } else if (wire === 2) {
      const [length, next] = readVarint(data, pos);
      const end = next + Number(length);
      if (end > data.length) throw new Error("truncated length-delimited field");
      fields.push({ field, wire, bytes: data.subarray(next, end) });
      pos = end;
    } else if (wire === 5 || wire === 1) {
      const size = wire === 5 ? 4 : 8;
      if (pos + size > data.length) throw new Error("truncated fixed field");
      fields.push({ field, wire, fixed: data.subarray(pos, pos + size) });
      pos += size;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

function varintValue(kind: FieldKind, value: bigint): number {
  if (kind === "sint") {
    const zigzag = (value >> 1n) ^ -(value & 1n);
    return Number(BigInt.asIntN(64, zigzag));
  }
  if (kind === "int") return Number(BigInt.asIntN(64, value));
  return Number(value);
}

/** Generic schema-less decode: field numbers → values (nested where parseable). */
export function decodeProtobufGeneric(data: Uint8Array, depth = 0): Decoded {
  const out: Decoded = {};
  for (const raw of readRawFields(data)) {
    let value: unknown;
    if (raw.varint !== undefined) value = Number(raw.varint);
    else if (raw.fixed) value = Buffer.from(raw.fixed).toString("hex");
    else if (raw.bytes) {
      value = undefined;
      if (depth < 4 && raw.bytes.length > 0) {
        try {
          value = decodeProtobufGeneric(raw.bytes, depth + 1);
        } catch {
          value = undefined;
        }
      }
      if (value === undefined) {
        const text = Buffer.from(raw.bytes).toString("utf8");
        value = /^[\x20-\x7e -￿]*$/.test(text) ? text : `hex:${Buffer.from(raw.bytes).toString("hex")}`;
      }
    }
    const key = `#${raw.field}`;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

/** Schema decode; fields absent from the recovered schema land under `unknown`. */
export function decodeWeatherMessage(type: string, data: Uint8Array): Decoded {
  const schema = SCHEMA[type];
  const out: Decoded = {};
  const unknown: Decoded = {};
  for (const raw of readRawFields(data)) {
    const spec = schema?.[raw.field];
    let value: unknown;
    if (!spec) {
      value = raw.varint !== undefined ? Number(raw.varint)
        : raw.bytes ? `hex:${Buffer.from(raw.bytes).toString("hex")}`
          : raw.fixed ? `hex:${Buffer.from(raw.fixed).toString("hex")}` : null;
      unknown[`#${raw.field}/w${raw.wire}`] = value;
      continue;
    }
    if (spec.kind === "message" && raw.bytes) value = decodeWeatherMessage(spec.message!, raw.bytes);
    else if (spec.kind === "string" && raw.bytes) value = Buffer.from(raw.bytes).toString("utf8");
    else if (spec.kind === "bytes" && raw.bytes) value = Buffer.from(raw.bytes).toString("hex");
    else if (raw.varint !== undefined) value = varintValue(spec.kind, raw.varint);
    else if (raw.bytes && (spec.kind === "uint" || spec.kind === "int" || spec.kind === "sint")) {
      // Packed repeated scalars (not expected for this schema, but be lenient).
      const values: number[] = [];
      let pos = 0;
      while (pos < raw.bytes.length) {
        const [v, next] = readVarint(raw.bytes, pos);
        values.push(varintValue(spec.kind, v));
        pos = next;
      }
      value = values;
    } else value = null;
    if (spec.repeated) {
      const list = (out[spec.name] as unknown[] | undefined) ?? [];
      list.push(value);
      out[spec.name] = list;
    } else out[spec.name] = value;
  }
  if (Object.keys(unknown).length) out.unknown = unknown;
  return out;
}

export interface WeatherStructSection {
  offset: number;
  headerHex: string;
  byte0: number;
  byte1: number;
  length: number;
  trailer: number;
  byteOrder: "LE" | "BE";
  forecast?: Decoded;
  forecastSummary?: WeatherForecastSummary;
  decodeError?: string;
}

export interface WeatherStructReport {
  totalBytes: number;
  sections: WeatherStructSection[];
  trailingBytes: number;
  parseNote?: string;
}

function parseSections(bytes: Uint8Array, order: "LE" | "BE"): WeatherStructReport | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections: WeatherStructSection[] = [];
  let pos = 0;
  while (bytes.length - pos > 6) {
    const length = view.getUint16(pos + 2, order === "LE");
    const trailer = view.getUint16(pos + 4, order === "LE");
    // The app's reader requires length < remaining-after-header.
    if (length > bytes.length - pos - 6) return null;
    sections.push({
      offset: pos,
      headerHex: Buffer.from(bytes.subarray(pos, pos + 6)).toString("hex"),
      byte0: bytes[pos],
      byte1: bytes[pos + 1],
      length,
      trailer,
      byteOrder: order
    });
    pos += 6 + length;
    if (length === 0) break;
  }
  return { totalBytes: bytes.length, sections, trailingBytes: bytes.length - pos };
}

export function decodeWeatherStruct(bytes: Uint8Array): WeatherStructReport {
  const report = parseSections(bytes, "LE") ?? parseSections(bytes, "BE");
  if (!report) {
    return {
      totalBytes: bytes.length,
      sections: [],
      trailingBytes: bytes.length,
      parseNote: `Header length did not fit in either byte order; first 32 bytes: ${Buffer.from(bytes.subarray(0, 32)).toString("hex")}`
    };
  }
  for (const section of report.sections) {
    const payload = bytes.subarray(section.offset + 6, section.offset + 6 + section.length);
    try {
      section.forecast = decodeWeatherMessage("WeatherForecastUI", payload);
      section.forecastSummary = summarizeForecast(section.forecast);
    } catch (error) {
      section.decodeError = error instanceof Error ? error.message : String(error);
    }
  }
  return report;
}

export interface WeatherSeriesSummary {
  count: number;
  nonZeroPressure: number;
  nonZeroTideHeight: number;
  pressureRange: [number, number] | null;
  tideHeightRange: [number, number] | null;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

export interface WeatherForecastSummary {
  city: string | null;
  lat: number | null;
  long: number | null;
  provider: number | null;
  code: number | null;
  timestamp: number | null;
  current: { pressure: number | null; tideHeight: number | null; temperature: number | null } | null;
  hourly: WeatherSeriesSummary;
  daily: WeatherSeriesSummary;
  tideEvents: number;
  tideEventSample: Decoded[];
  unknownTopLevelFields: string[];
  unknownItemFields: string[];
}

function seriesSummary(items: Decoded[]): WeatherSeriesSummary {
  const pressures = items.map((item) => item.pressure).filter((v): v is number => typeof v === "number" && v !== 0);
  const tides = items.map((item) => item.tideHeight).filter((v): v is number => typeof v === "number" && v !== 0);
  const stamps = items.map((item) => item.obsTimestamp).filter((v): v is number => typeof v === "number");
  const range = (values: number[]): [number, number] | null =>
    values.length ? [Math.min(...values), Math.max(...values)] : null;
  return {
    count: items.length,
    nonZeroPressure: pressures.length,
    nonZeroTideHeight: tides.length,
    pressureRange: range(pressures),
    tideHeightRange: range(tides),
    firstTimestamp: stamps.length ? stamps[0] : null,
    lastTimestamp: stamps.length ? stamps[stamps.length - 1] : null
  };
}

export function summarizeForecast(forecast: Decoded): WeatherForecastSummary {
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const current = forecast.current as Decoded | undefined;
  const hourly = (forecast.hourly as Decoded[] | undefined) ?? [];
  const daily = (forecast.daily as Decoded[] | undefined) ?? [];
  const tideEvents = (forecast.tideEvents as Decoded[] | undefined) ?? [];
  const unknownItemFields = new Set<string>();
  for (const item of [current, ...hourly, ...daily].filter(Boolean) as Decoded[]) {
    for (const key of Object.keys((item.unknown as Decoded | undefined) ?? {})) unknownItemFields.add(key);
  }
  return {
    city: typeof forecast.city === "string" ? forecast.city : null,
    lat: num(forecast.lat),
    long: num(forecast.long),
    provider: num(forecast.provider),
    code: num(forecast.code),
    timestamp: num(forecast.timestamp),
    current: current
      ? { pressure: num(current.pressure), tideHeight: num(current.tideHeight), temperature: num(current.temperature) }
      : null,
    hourly: seriesSummary(hourly),
    daily: seriesSummary(daily),
    tideEvents: tideEvents.length,
    tideEventSample: tideEvents.slice(0, 4),
    unknownTopLevelFields: Object.keys((forecast.unknown as Decoded | undefined) ?? {}),
    unknownItemFields: [...unknownItemFields]
  };
}
