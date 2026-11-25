// A PACE Pro activity's data pages over Bluetooth (CorosLink's corosActivityScreenProtocol.ts, rewritten). Read with
// V3 0x9E (the sport id; 255 lists the sports) and written with 0x9F. The answer is the sport id, a page count, then
// one 44-byte record per page: byte 0 the layout header (2 bits kind, 2 bits rows − 1, 4 bits "two columns" per row),
// byte 1 extended flags, a 16-bit word with the bottom field's metric, then up to 12 words of metric << 6 | height − 1.
import { createHash } from "node:crypto";

export const READ = 0x9e;
export const WRITE = 0x9f;
export const RECORD_BYTES = 44;
export const MAX_PAGES = 10;
/** The page counts COROS's app offers; the others are experiments. */
export const PRESET_COUNTS = [2, 3, 4, 6, 8] as const;
export const EXPERIMENTAL_COUNTS = [5, 7, 9] as const;
/** The empty slot and the special pages' metric ids, never copied into a layout. */
const FILLER = 192, SPECIAL = 194;

export interface Sport { id: number; name: string }
export interface Field { metricId: number; height: number }
export interface Page {
  index: number;
  rawHex: string;
  kind: "grid" | "special" | "unknown";
  rows: number;
  columns: number[];
  fields: Field[];
  baseMetricId: number;
  /** Fields including the bottom one; null for a page that isn't a plain grid. */
  fieldCount: number | null;
}

const SPORTS: Readonly<Record<number, string>> = {
  0: "Run", 1: "Indoor Run", 2: "Open Water", 3: "Pool Swim", 4: "Bike", 5: "Trail Run", 6: "Indoor Bike", 7: "Mountain Climb", 8: "Hike",
  9: "Gym Cardio", 10: "GPS Cardio", 11: "Snowboard", 12: "Ski", 13: "XC Ski", 14: "Track Run", 16: "Strength", 17: "Rowing",
  18: "Indoor Rowing", 26: "Walk", 27: "Indoor Climb", 28: "Jump Rope", 30: "Mountain Bike", 31: "Gravel Bike", 32: "Road E-Bike",
  33: "Mountain E-Bike", 36: "Bouldering", 38: "Climb Stairs",
};

/** An ordinary activity. Custom (0x40) and multisport (29) pages use another protocol and are refused. */
export function sportOf(id: number): Sport {
  if (!Number.isInteger(id) || id < 0 || id > 254 || id === 29 || id === 64) throw new Error("Pick an ordinary activity. Custom and multisport pages work differently.");
  return { id, name: SPORTS[id] ?? `Activity ${id}` };
}

/** The answer to reading sport 255: one byte per sport the watch has. */
export function decodeSports(payload: Buffer): Sport[] {
  if (!payload.length || payload.length > 256 || payload.includes(255) || new Set(payload).size !== payload.length) throw new Error("The watch sent an activity list this doesn't understand.");
  return [...payload].filter((id) => id !== 64 && id !== 29).map(sportOf);
}

export const digest = (payload: Buffer) => createHash("sha256").update(payload).digest("hex");

export function decodePage(bytes: Buffer, index: number): Page {
  if (bytes.length !== RECORD_BYTES) throw new Error("A PACE Pro page is 44 bytes.");
  const header = bytes[0];
  const rows = ((header >> 4) & 3) + 1;
  const columns = Array.from({ length: rows }, (_, row) => 1 + ((header >> (3 - row)) & 1));
  const first = bytes.readUInt16LE(4) >> 6;
  const special = first === SPECIAL || (header === 0x80 && (first === 300 || first === 301));
  // Pages with extended flags aren't understood yet.
  const grid = header >> 6 === 2 && bytes[1] === 0 && !special;
  const count = columns.reduce((a, b) => a + b, 0);
  return {
    index, rawHex: bytes.toString("hex"), kind: special ? "special" : grid ? "grid" : "unknown", rows, columns,
    baseMetricId: bytes.readUInt16LE(2) & 1023,
    fields: Array.from({ length: count }, (_, i) => { const word = bytes.readUInt16LE(4 + 2 * i); return { metricId: word >> 6, height: (word & 63) + 1 }; }),
    fieldCount: grid ? count + 1 : null,
  };
}

export function decodePages(payload: Buffer, sportId: number): Page[] {
  sportOf(sportId);
  if (payload.length < 2 || payload[0] !== sportId || payload[1] > MAX_PAGES || payload.length !== 2 + payload[1] * RECORD_BYTES) {
    throw new Error("The watch sent activity pages in a form this doesn't understand (it expects 44-byte PACE Pro pages).");
  }
  return Array.from({ length: payload[1] }, (_, i) => decodePage(payload.subarray(2 + i * RECORD_BYTES, 2 + (i + 1) * RECORD_BYTES), i));
}

export function requireAck(payload: Buffer): void {
  if (payload.length !== 1 || payload[0] !== 1) throw new Error("The watch didn't take the activity pages.");
}

/** Header and row heights for each field count. The presets fill four height units above the bottom field. */
const LAYOUTS: Readonly<Record<number, { header: number; heights: readonly number[] }>> = {
  2: { header: 0x80, heights: [4] }, 3: { header: 0x90, heights: [2, 2] }, 4: { header: 0x94, heights: [3, 1, 1] },
  6: { header: 0xa6, heights: [2, 1, 1, 1, 1] }, 8: { header: 0xb7, heights: [1, 1, 1, 1, 1, 1, 1] },
  5: { header: 0x9c, heights: [2, 2, 2, 2] }, 7: { header: 0xae, heights: [1, 1, 1, 1, 2, 2] },
  // The largest grid the header can say: eight fields and the bottom one. Saying it doesn't mean the watch draws it.
  9: { header: 0xbf, heights: [1, 1, 1, 1, 1, 1, 1, 1] },
};
export const supportedCounts = () => Object.keys(LAYOUTS).map(Number);

/**
 * The pages with one page rearranged to `fieldCount` fields, using only metrics already on the pages (an unknown
 * metric id is never guessed). The bottom field and every other byte stay as they were.
 */
export function buildLayout(payload: Buffer, sportId: number, pageIndex: number, fieldCount: number): Buffer {
  const pages = decodePages(payload, sportId);
  const layout = LAYOUTS[fieldCount];
  const source = pages[pageIndex];
  if (!layout || !Number.isInteger(pageIndex) || !source) throw new Error("Pick a page and a field count.");
  if (source.kind !== "grid") throw new Error("Only an ordinary grid page can be rearranged; special pages are kept as they are.");
  const metrics = [...new Set([source, ...pages.filter((p) => p !== source && p.kind === "grid")]
    .flatMap((p) => p.fields.map((f) => f.metricId)).filter((id) => id !== FILLER && id !== SPECIAL))];
  if (!metrics.length) throw new Error("Read a page with data fields on it first.");
  const out = Buffer.from(payload), at = 2 + pageIndex * RECORD_BYTES;
  out[at] = layout.header;
  out[at + 1] = 0;
  for (let i = 0; i < 12; i++) {
    const metric = i < layout.heights.length ? metrics[i % metrics.length] : FILLER;
    out.writeUInt16LE((metric << 6) | ((layout.heights[i] ?? 1) - 1), at + 4 + 2 * i);
  }
  return out;
}

export const isExperimentalPage = (p: Page) => p.kind === "grid" && !(PRESET_COUNTS as readonly number[]).includes(p.fieldCount ?? 0);
