import { createHash } from "node:crypto";
import { crc32Mpeg2 } from "./corosBleAuth";
import type { GeneratedRoute } from "./types";

export const ROUTE_FILE_INDEX = 0x14;
export const ROUTE_BLOCK_BYTES = 4096;
const PAGE_BYTES = 512;
const NAVIGATION_LEVELS = [0, 2, 4, 6] as const;
const NAVIGATION_FLAGS = 0x55;

export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

export interface WatchRouteEntry { slot: number; trackId: string; crc16: number; revision: number }
export interface WatchRouteInventory { capacity: number; entries: WatchRouteEntry[] }

export function decodeRouteInventory(payload: Buffer): WatchRouteInventory {
  if (payload.length < 6 || payload[0] !== 0 || !payload[1] || payload[3] !== 13 ||
      payload[2]! > payload[1]! || payload.length !== 6 + payload[2]! * 13) {
    throw new Error("The watch returned an unsupported route inventory.");
  }
  const entries: WatchRouteEntry[] = [];
  for (let offset = 6; offset < payload.length; offset += 13) {
    const slot = payload[offset]!;
    if (slot >= payload[1]! || entries.some(entry => entry.slot === slot)) throw new Error("The watch returned an invalid route slot.");
    entries.push({ slot, trackId: payload.readBigUInt64LE(offset + 1).toString(),
      crc16: payload.readUInt16LE(offset + 9), revision: payload.readUInt16LE(offset + 11) });
  }
  return { capacity: payload[1]!, entries };
}

export function routeSlot(inventory: WatchRouteInventory, trackId: string): number {
  const existing = inventory.entries.find(entry => entry.trackId === trackId);
  if (existing) return existing.slot;
  for (let slot = 0; slot < inventory.capacity; slot++) {
    if (!inventory.entries.some(entry => entry.slot === slot)) return slot;
  }
  throw new Error("The watch's route library is full. Remove a route on your watch or in COROS, then try again.");
}

function descriptor(type: number, offset: number, length: number): Buffer {
  const value = Buffer.alloc(8);
  value[0] = type;
  value.writeUInt16LE(length / 16 - 1, 1);
  value.writeUInt16LE(offset / 16, 3);
  return value;
}

/** HTRK v0, one complete navigation polyline, using TRK's indexed delta pages. */
export function encodeWatchRoute(route: Pick<GeneratedRoute, "id" | "name" | "createdAt" | "points" | "distanceMeters">) {
  if (!route || typeof route.id !== "string" || !route.id || typeof route.name !== "string" || route.name.length > 10_000 ||
      !Array.isArray(route.points) || route.points.length < 2 || route.points.length > 40_000) {
    throw new Error("A route must contain between 2 and 40,000 GPS points to sync.");
  }
  const points = route.points.map(point => {
    if (!point || typeof point.lat !== "number" || typeof point.lon !== "number" || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
        Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) throw new Error("The route contains an invalid GPS point.");
    return { x: Math.trunc((point.lon === 180 ? -180 : point.lon) / 360 * 2 ** 24),
      y: Math.trunc(point.lat / 360 * 2 ** 24) };
  }).filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y);
  if (points.length < 2) throw new Error("The route needs at least two distinct GPS points.");
  const pages: Array<{ anchor: { x: number; y: number }; points: typeof points; data: Buffer }> = [];
  let index = 0;
  while (index < points.length) {
    const anchor = points[index]!;
    const group = [anchor];
    const data = Buffer.alloc(PAGE_BYTES, 0xff);
    let offset = 0;
    index++;
    while (index < points.length && offset <= PAGE_BYTES - 8) {
      const previous = group[group.length - 1]!;
      const next = points[index]!;
      const dx = next.x - previous.x, dy = next.y - previous.y;
      if (dx <= -32768 || dx > 32767 || dy <= -32768 || dy > 32767 ||
          Math.abs(next.x - anchor.x) > 32767 || Math.abs(next.y - anchor.y) > 32767) break;
      data.writeInt16LE(dx, offset); data.writeInt16LE(dy, offset + 2);
      offset += 4; group.push(next); index++;
    }
    data.writeInt16LE(-32768, offset); data.writeInt16LE(-32768, offset + 2);
    pages.push({ anchor, points: group, data });
  }
  // Preserve the complete geometry at each of the four zoom levels advertised
  // by PACE Pro. No route simplification or inferred turn instructions.
  const perLevel = pages.length;
  const navigationPages = NAVIGATION_LEVELS.flatMap(level => pages.map(page => ({ ...page, level })));
  const metadataOffset = 48;
  const metadataBytes = navigationPages.length * 16;
  const indexOffset = metadataOffset + metadataBytes;
  const indexBytes = Math.ceil((9 + navigationPages.length * 8) / 16) * 16;
  const dataOffset = Math.ceil((indexOffset + indexBytes) / PAGE_BYTES) * PAGE_BYTES;
  if (528 + dataOffset + navigationPages.length * PAGE_BYTES > 2_000_000) throw new Error("The encoded route is too large for Bluetooth sync.");
  const track = Buffer.alloc(dataOffset + navigationPages.length * PAGE_BYTES, 0xff);
  track.write("TRK\0", 0, "ascii"); track.fill(0, 4, 8);
  track.writeUInt32LE(16, 8); track.writeUInt16LE(NAVIGATION_FLAGS, 12); track[14] = 4; track[15] = 9;
  descriptor(1, metadataOffset, metadataBytes).copy(track, 16);
  descriptor(7, indexOffset, indexBytes).copy(track, 24);
  track.fill(0, 32, 40); track[33] = 0xff; track.writeUInt16LE(dataOffset / PAGE_BYTES, 35);
  track[indexOffset] = 1;
  NAVIGATION_LEVELS.forEach((_, level) => track.writeUInt16LE(perLevel * (level + 1), indexOffset + 1 + level * 2));
  navigationPages.forEach((page, pageIndex) => {
    const offset = metadataOffset + pageIndex * 16;
    track[offset] = 0x10 + page.level;
    track.writeUIntLE(page.anchor.x & 0xffffff, offset + 1, 3); track[offset + 4] = 0;
    track.writeUIntLE(page.anchor.y & 0xffffff, offset + 5, 3);
    const xs = page.points.map(point => point.x), ys = page.points.map(point => point.y);
    track.writeUInt16LE(page.anchor.x - Math.min(...xs), offset + 8);
    track.writeUInt16LE(Math.max(...xs) - page.anchor.x, offset + 10);
    track.writeUInt16LE(page.anchor.y - Math.min(...ys), offset + 12);
    track.writeUInt16LE(Math.max(...ys) - page.anchor.y, offset + 14);
    track.writeInt32LE(page.anchor.x, indexOffset + 9 + pageIndex * 8);
    track.writeInt32LE(page.anchor.y, indexOffset + 13 + pageIndex * 8);
    page.data.copy(track, dataOffset + pageIndex * PAGE_BYTES);
  });
  const body = Buffer.alloc(512 + track.length);
  body.write("HTRK", 0, "ascii"); body.writeUInt32LE(512, 5);
  body.writeUInt32LE(crc32Mpeg2(track), 9); body.writeUInt32LE(track.length, 13);
  const created = Date.parse(route.createdAt);
  body.writeUInt32LE(Math.floor((Number.isFinite(created) ? created : Date.now()) / 1000) >>> 0, 17);
  if (!Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0 || route.distanceMeters * 1000 > 0xffffffff) {
    throw new Error("The route distance is invalid or exceeds the watch's supported range.");
  }
  body.writeUInt32LE(Math.round(route.distanceMeters * 1000), 21);
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  body.writeInt32LE(Math.min(...xs), 29); body.writeInt32LE(Math.min(...ys), 33);
  body.writeInt32LE(Math.max(...xs), 37); body.writeInt32LE(Math.max(...ys), 41);
  let watchName = route.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "CorosLink route";
  while (Buffer.byteLength(watchName, "utf8") > 119) watchName = Array.from(watchName).slice(0, -1).join("");
  body.write(watchName, 45, 119, "utf8");
  const trackId = createHash("sha256").update("CorosLink route v1\0" + route.id).digest().readBigUInt64LE(0) || 1n;
  body.writeBigUInt64LE(trackId, 165); body.writeUInt32LE(NAVIGATION_FLAGS, 193);
  body[198] = 0xff; body[199] = 0xff; body[200] = 2;
  track.copy(body, 512);
  const crc16 = crc16Ccitt(body);
  const file = Buffer.alloc(16 + body.length);
  file.write("HF", 0, "ascii"); file[3] = ROUTE_FILE_INDEX;
  file.writeUInt32LE(body.length, 8); file.writeUInt16LE(crc16, 12);
  file.writeUInt16LE(crc16Ccitt(file.subarray(0, 14)), 14); body.copy(file, 16);
  if (file.length > 2_000_000) throw new Error("The encoded route is too large for Bluetooth sync.");
  return { file, trackId: trackId.toString(), crc16, watchName, pointCount: points.length };
}

export function encodeRouteBlockHeader(block: Buffer, offset: number, totalBytes: number, slot: number): Buffer {
  if (!block.length || block.length > ROUTE_BLOCK_BYTES || !Number.isInteger(offset) || offset < 0 ||
      offset + block.length > totalBytes || totalBytes > 2_000_000 || !Number.isInteger(slot) || slot < 0 || slot > 254) {
    throw new Error("Invalid COROS route block.");
  }
  const header = Buffer.alloc(21);
  header[0] = 0x78; header[2] = ROUTE_FILE_INDEX;
  header.writeUInt32LE(offset, 3); header.writeUInt16LE(block.length, 7);
  header.writeUInt32LE(totalBytes - offset, 9); header.writeUInt16LE(crc16Ccitt(block), 13);
  header[15] = block.reduce((sum, byte) => (sum + byte) & 255, 0);
  header[16] = slot; header[19] = 3;
  header[20] = header.subarray(2, 20).reduce((sum, byte) => (sum + byte) & 255, 0);
  return header;
}
