import { createHash } from "node:crypto";
import type { CorosActivityScreenPage, CorosActivityScreenSport } from "./corosActivityScreenTypes";

// Internal app commands 0x37/0x38 map to these V3 wire commands, not file transfers.
export const ACTIVITY_SCREEN_READ = 0x9e;
export const ACTIVITY_SCREEN_WRITE = 0x9f;
export const ACTIVITY_SCREEN_RECORD_BYTES = 44;
export const ACTIVITY_SCREEN_MAX_PAGES = 10;
const SPORT_NAMES: Readonly<Record<number, string>> = {
  0: "Run", 1: "Indoor Run", 2: "Open Water", 3: "Pool Swim", 4: "Bike", 5: "Trail Run",
  6: "Indoor Bike", 7: "Mountain Climb", 8: "Hike", 9: "Gym Cardio", 10: "GPS Cardio",
  11: "Snowboard", 12: "Ski", 13: "XC Ski", 14: "Track Run", 16: "Strength",
  17: "Rowing", 18: "Indoor Rowing", 26: "Walk", 27: "Indoor Climb", 28: "Jump Rope",
  30: "Mountain Bike", 31: "Gravel Bike", 32: "Road E-Bike", 33: "Mountain E-Bike",
  36: "Bouldering", 38: "Climb Stairs"
};
export function activityScreenSport(id: number): CorosActivityScreenSport {
  if (!Number.isInteger(id) || id < 0 || id > 254 || id === 29 || id === 64) {
    throw new Error("Choose a supported ordinary activity. Custom and multisport pages use a different protocol.");
  }
  return { id, name: SPORT_NAMES[id] ?? `Activity ${id}` };
}
export function decodeActivityScreenSports(payload: Buffer): CorosActivityScreenSport[] {
  if (!payload.length || payload.length > 256 || payload.includes(255) || new Set(payload).size !== payload.length) {
    throw new Error("The watch returned an unsupported activity list.");
  }
  // 0x40 is the custom-activity marker appended by the native reader.
  return [...payload].filter(id => id !== 64 && id !== 29).map(activityScreenSport);
}
export function activityScreenDigest(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}
export function decodeActivityScreenPage(bytes: Buffer, index: number): CorosActivityScreenPage {
  if (bytes.length !== ACTIVITY_SCREEN_RECORD_BYTES) throw new Error("Expected a 44-byte PACE Pro page.");
  const rows = ((bytes[0]! >> 4) & 3) + 1;
  const columns = Array.from({ length: rows }, (_, row) => 1 + ((bytes[0]! >> (3 - row)) & 1));
  const firstMetric = bytes.readUInt16LE(4) >> 6;
  const special = firstMetric === 194 || (bytes[0] === 0x80 && (firstMetric === 300 || firstMetric === 301));
  // Extended flags have not been established for this PACE Pro experiment.
  const grid = (bytes[0]! >> 6) === 2 && bytes[1] === 0 && !special;
  const primaryCount = columns.reduce((sum, n) => sum + n, 0);
  return {
    index, rawHex: bytes.toString("hex"), kind: special ? "special" : grid ? "grid" : "unknown",
    rows, columns, baseMetricId: bytes.readUInt16LE(2) & 1023,
    fields: Array.from({ length: primaryCount }, (_, i) => {
      const word = bytes.readUInt16LE(4 + 2 * i);
      return { metricId: word >> 6, height: (word & 63) + 1 };
    }), fieldCount: grid ? primaryCount + 1 : null
  };
}
export function decodeActivityScreens(payload: Buffer, sportId: number): CorosActivityScreenPage[] {
  activityScreenSport(sportId);
  if (payload.length < 2 || payload[0] !== sportId || payload[1]! > ACTIVITY_SCREEN_MAX_PAGES ||
      payload.length !== 2 + payload[1]! * ACTIVITY_SCREEN_RECORD_BYTES) {
    throw new Error("The watch returned an unsupported activity-page format. This development feature expects 44-byte PACE Pro pages.");
  }
  return Array.from({ length: payload[1]! }, (_, i) => decodeActivityScreenPage(payload.subarray(2 + i * 44, 2 + (i + 1) * 44), i));
}
export function requireActivityScreenAcknowledgement(payload: Buffer): void {
  if (payload.length !== 1 || payload[0] !== 1) throw new Error("The watch did not acknowledge the activity-page settings.");
}
// The ordinary app presets occupy four height units above the separate base field.
const LAYOUTS: Readonly<Record<number, { header: number; heights: readonly number[] }>> = {
  2: { header: 0x80, heights: [4] }, 3: { header: 0x90, heights: [2, 2] },
  4: { header: 0x94, heights: [3, 1, 1] }, 6: { header: 0xa6, heights: [2, 1, 1, 1, 1] },
  8: { header: 0xb7, heights: [1, 1, 1, 1, 1, 1, 1] },
  5: { header: 0x9c, heights: [2, 2, 2, 2] }, 7: { header: 0xae, heights: [1, 1, 1, 1, 2, 2] },
  // Maximum grid expressible by the ordinary header: eight primary slots plus the base.
  // Representable does not establish that the PACE Pro renderer will draw this shape.
  9: { header: 0xbf, heights: [1, 1, 1, 1, 1, 1, 1, 1] }
};
export function supportedActivityScreenFieldCounts(): number[] {
  return Object.keys(LAYOUTS).map(Number);
}
export function buildActivityScreenLayout(payload: Buffer, sportId: number, pageIndex: number, fieldCount: number): Buffer {
  const pages = decodeActivityScreens(payload, sportId);
  const layout = LAYOUTS[fieldCount];
  if (!layout || !Number.isInteger(pageIndex) || !pages[pageIndex]) throw new Error("Choose a page and a supported field count.");
  const source = pages[pageIndex]!;
  if (source.kind !== "grid") throw new Error("Layout experiments require an ordinary grid page. Special or unknown records are preserved only.");
  // Use only already configured metrics. Never guess undocumented metric selectors.
  const metrics = [...new Set([source, ...pages.filter(page => page !== source && page.kind === "grid")]
    .flatMap(page => page.fields.map(field => field.metricId)).filter(id => id !== 192 && id !== 194))];
  if (!metrics.length) throw new Error("Read a page containing live metrics before choosing a layout.");
  const output = Buffer.from(payload), offset = 2 + pageIndex * 44;
  output[offset] = layout.header;
  output[offset + 1] = 0;
  for (let i = 0; i < 12; i++) {
    const metric = i < layout.heights.length ? metrics[i % metrics.length]! : 192;
    const height = layout.heights[i] ?? 1;
    output.writeUInt16LE((metric << 6) | (height - 1), offset + 4 + 2 * i);
  }
  // Preserve the base selector and the remaining bytes, including unknown extensions.
  return output;
}
