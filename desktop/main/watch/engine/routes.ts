// Navigation routes over the link: an HTRK file (one TRK polyline in indexed delta pages) sent as SFT file index 0x14
// in 4 KB blocks, and command 0xAA for the watch's route library. A port of CorosKit's Protocol/RouteProtocol.swift and
// WatchSession's readRoutes/syncRoute, with the CorosKit helper's `routes` and `syncRoute` answers (Routes in
// the retired clink-watch helper's Maps.swift). The layout follows a route the COROS app sent to a PACE Pro.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CorosError, crc16Ccitt, crc32Mpeg2, put16, put32, u16, u32 } from "./bytes";
import { encodeSftBlockHeader, type Emit } from "./faces";
import type { WatchSession } from "./session";

export const ROUTE_FILE_INDEX = 0x14;
export const ROUTE_BLOCK_BYTES = 4096;
export const ROUTE_INVENTORY_OPCODE = 0xaa;
export const ROUTE_MAXIMUM_BYTES = 2_000_000;
export const ROUTE_MAXIMUM_POINTS = 40_000;
const PAGE_BYTES = 512;
/** The four zoom levels PACE Pro advertises; each gets the complete geometry. */
const NAVIGATION_LEVELS = [0, 2, 4, 6];
const NAVIGATION_FLAGS = 0x55;
/** Height samples in the summary section, evenly spaced along the route. */
const PROFILE_SAMPLES = 480;

export interface RoutePoint { latitude: number; longitude: number }

/** What the watch needs of a route: an ID (kept per route, so resending replaces it), a name and the line. */
export interface RouteInput {
  id: string;
  name: string;
  createdAt: Date;
  distanceMeters: number;
  points: RoutePoint[];
  /** Heights in metres, evenly spaced from start to finish (any number; none when unknown). */
  elevations?: number[];
  ascentMeters?: number;
  descentMeters?: number;
}

export interface EncodedRoute { file: Buffer; trackId: bigint; crc16: number; watchName: string; pointCount: number }
export interface RouteEntry { slot: number; trackId: bigint; crc16: number; revision: number }
export interface RouteInventory { capacity: number; entries: RouteEntry[] }

export const isFull = (inventory: RouteInventory): boolean => inventory.entries.length >= inventory.capacity;

/** Command 0xAA's answer: result 0, capacity, count, entry size 13, then 13-byte entries. */
export function decodeRouteInventory(payload: Uint8Array): RouteInventory {
  if (payload.length < 6 || payload[0] !== 0 || payload[1] === 0 || payload[3] !== 13 || payload[2] > payload[1] || payload.length !== 6 + payload[2] * 13) {
    throw new CorosError("The watch returned an unsupported route library.");
  }
  const capacity = payload[1];
  const entries: RouteEntry[] = [];
  for (let offset = 6; offset < payload.length; offset += 13) {
    const slot = payload[offset];
    if (slot >= capacity || entries.some((e) => e.slot === slot)) throw new CorosError("The watch returned an invalid route slot.");
    const trackId = BigInt(u32(payload, offset + 1)) | (BigInt(u32(payload, offset + 5)) << 32n);
    entries.push({ slot, trackId, crc16: u16(payload, offset + 9), revision: u16(payload, offset + 11) });
  }
  return { capacity, entries };
}

/** The route's own slot when it's on the watch already, else the first free one. */
export function routeSlot(inventory: RouteInventory, trackId: bigint): number {
  const existing = inventory.entries.find((e) => e.trackId === trackId);
  if (existing) return existing.slot;
  for (let slot = 0; slot < inventory.capacity; slot++) if (!inventory.entries.some((e) => e.slot === slot)) return slot;
  throw new CorosError("The watch's route library is full. Remove a route on your watch, then try again.");
}

/** The watch's ID for a route: the first 8 bytes of SHA-256 over the desktop app's namespace and the route's ID. */
export function trackIdFor(routeId: string): bigint {
  const digest = createHash("sha256").update("CorosLink route v1\0" + routeId, "utf8").digest();
  const value = digest.readBigUInt64LE(0);
  return value === 0n ? 1n : value;
}

/** Swift's `.rounded()`: half away from zero. */
const rounded = (v: number) => Math.sign(v) * Math.round(Math.abs(v));
const clampInt32 = (v: number) => Math.min(2147483647, Math.max(-2147483648, v));
/** Metres as the file keeps them: rounded, clamped to Int32, stored as its bit pattern. */
const meters = (v: number) => clampInt32(rounded(v)) >>> 0;
const graphemes = (text: string) => Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text), (s) => s.segment);

/** Swift's `.whitespaces`: tab and Unicode space separators. */
const trimSpaces = (text: string) => text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, "");

/** The name the watch lists: controls as spaces, trimmed, at most 119 UTF-8 bytes; "C-LINK route" when empty. */
function watchNameFor(name: string): string {
  let text = trimSpaces(Array.from(name, (c) => { const v = c.codePointAt(0)!; return v < 0x20 || v === 0x7f ? " " : c; }).join(""));
  if (text === "") text = "C-LINK route";
  if (Buffer.byteLength(text) > 119) {
    const parts = graphemes(text);
    while (Buffer.byteLength(parts.join("")) > 119) parts.pop();
    text = parts.join("");
  }
  return text;
}

/** The heights resampled to the summary's 480 points, or none. */
function profile(elevations: number[]): number[] {
  const known = elevations.filter(Number.isFinite);
  if (known.length < 2) return [];
  return Array.from({ length: PROFILE_SAMPLES }, (_, index) => {
    const position = (index / (PROFILE_SAMPLES - 1)) * (known.length - 1);
    const lower = Math.trunc(position), upper = Math.min(lower + 1, known.length - 1);
    return known[lower] + (known[upper] - known[lower]) * (position - lower);
  });
}

const putInt16 = (b: Buffer, v: number, at: number) => b.writeInt16LE(v, at);
const putInt32 = (b: Buffer, v: number, at: number) => b.writeInt32LE(v, at);
const put24 = (b: Buffer, v: number, at: number) => { for (let i = 0; i < 3; i++) b[at + i] = (v >>> (i * 8)) & 0xff; };

interface Grid { x: number; y: number }
interface Page { anchor: Grid; points: Grid[]; data: Buffer }

/** HTRK v0: the whole line at every navigation level, no simplification and no inferred turns. */
export function encodeRouteFile(route: RouteInput): EncodedRoute {
  if (!route.id || graphemes(route.name).length > 10_000 || route.points.length < 2 || route.points.length > ROUTE_MAXIMUM_POINTS) {
    throw new CorosError("A route must contain between 2 and 40,000 GPS points to sync.");
  }
  const points: Grid[] = [];
  for (const point of route.points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) {
      throw new CorosError("The route contains an invalid GPS point.");
    }
    const lon = point.longitude === 180 ? -180 : point.longitude;
    const grid = { x: Math.trunc((lon / 360) * 16_777_216), y: Math.trunc((point.latitude / 360) * 16_777_216) };
    const last = points[points.length - 1];
    if (!last || last.x !== grid.x || last.y !== grid.y) points.push(grid);
  }
  if (points.length < 2) throw new CorosError("The route needs at least two distinct GPS points.");

  const pages: Page[] = [];
  let index = 0;
  while (index < points.length) {
    const anchor = points[index];
    const group = [anchor];
    const data = Buffer.alloc(PAGE_BYTES, 0xff);
    let offset = 0;
    index += 1;
    while (index < points.length && offset <= PAGE_BYTES - 8) {
      const previous = group[group.length - 1], next = points[index];
      const dx = next.x - previous.x, dy = next.y - previous.y;
      if (dx <= -32768 || dx > 32767 || dy <= -32768 || dy > 32767 || Math.abs(next.x - anchor.x) > 32767 || Math.abs(next.y - anchor.y) > 32767) break;
      putInt16(data, dx, offset); putInt16(data, dy, offset + 2);
      offset += 4; group.push(next); index += 1;
    }
    putInt16(data, -32768, offset); putInt16(data, -32768, offset + 2);
    pages.push({ anchor, points: group, data });
  }

  const perLevel = pages.length;
  const navigationPages = NAVIGATION_LEVELS.flatMap((level) => pages.map((page) => ({ page, level })));
  // Four table entries (line pages, summary, index, data pages), then the sections in that order.
  const metadataOffset = 48;
  const metadataBytes = navigationPages.length * 16;
  const summaryOffset = metadataOffset + metadataBytes;
  const summaryBytes = 512;
  const indexOffset = summaryOffset + summaryBytes;
  const indexBytes = Math.floor((9 + navigationPages.length * 8 + 15) / 16) * 16;
  const dataOffset = Math.floor((indexOffset + indexBytes + PAGE_BYTES - 1) / PAGE_BYTES) * PAGE_BYTES;
  if (528 + dataOffset + navigationPages.length * PAGE_BYTES > ROUTE_MAXIMUM_BYTES) throw new CorosError("The route is too large to send to the watch.");
  const track = Buffer.alloc(dataOffset + navigationPages.length * PAGE_BYTES, 0xff);
  Buffer.from([0x54, 0x52, 0x4b, 0, 0, 0, 0, 0]).copy(track, 0); // "TRK\0"
  put32(track, 16, 8); put16(track, NAVIGATION_FLAGS, 12); track[14] = 4; track[15] = 9;
  const descriptor = (type: number, offset: number, length: number, position: number) => {
    track.fill(0, position, position + 8);
    track[position] = type;
    put16(track, length / 16 - 1, position + 1);
    put16(track, offset / 16, position + 3);
  };
  descriptor(1, metadataOffset, metadataBytes, 16);
  descriptor(2, summaryOffset, summaryBytes, 24);
  descriptor(7, indexOffset, indexBytes, 32);
  track.fill(0, 40, 48);
  track[41] = 0xff; put16(track, dataOffset / PAGE_BYTES, 43);
  if (!Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0 || route.distanceMeters * 1000 > 0xffffffff) {
    throw new CorosError("The route distance is invalid or too long for the watch.");
  }
  const millimetres = rounded(route.distanceMeters * 1000);
  const heights = profile(route.elevations ?? []);
  const low = heights.length ? Math.min(...heights) : 0, high = heights.length ? Math.max(...heights) : 0;
  const mean = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0;
  const ascent = route.ascentMeters ?? 0, descent = route.descentMeters ?? 0;
  track.fill(0, summaryOffset, summaryOffset + summaryBytes);
  put32(track, millimetres, summaryOffset);
  put32(track, meters(ascent), summaryOffset + 4);
  put16(track, meters(low) & 0xffff, summaryOffset + 8);
  put16(track, meters(high) & 0xffff, summaryOffset + 10);
  put16(track, meters(high - low) & 0xffff, summaryOffset + 12);
  put16(track, PROFILE_SAMPLES, summaryOffset + 15);
  heights.forEach((height, i) => { track[summaryOffset + 32 + i] = high > low ? rounded(((height - low) / (high - low)) * 255) : 0; });
  track[indexOffset] = 1;
  NAVIGATION_LEVELS.forEach((_, level) => put16(track, perLevel * (level + 1), indexOffset + 1 + level * 2));
  navigationPages.forEach(({ page, level }, pageIndex) => {
    const offset = metadataOffset + pageIndex * 16;
    track[offset] = 0x10 + level;
    put24(track, page.anchor.x & 0xffffff, offset + 1); track[offset + 4] = 0;
    put24(track, page.anchor.y & 0xffffff, offset + 5);
    const xs = page.points.map((p) => p.x), ys = page.points.map((p) => p.y);
    put16(track, (page.anchor.x - Math.min(...xs)) & 0xffff, offset + 8);
    put16(track, (Math.max(...xs) - page.anchor.x) & 0xffff, offset + 10);
    put16(track, (page.anchor.y - Math.min(...ys)) & 0xffff, offset + 12);
    put16(track, (Math.max(...ys) - page.anchor.y) & 0xffff, offset + 14);
    putInt32(track, page.anchor.x, indexOffset + 9 + pageIndex * 8);
    putInt32(track, page.anchor.y, indexOffset + 13 + pageIndex * 8);
    page.data.copy(track, dataOffset + pageIndex * PAGE_BYTES);
  });

  const head = Buffer.alloc(512);
  head.write("HTRK", 0, "latin1"); put32(head, 512, 5);
  put32(head, crc32Mpeg2(track), 9); put32(head, track.length, 13);
  put32(head, Number(BigInt.asUintN(32, BigInt(Math.floor(route.createdAt.getTime() / 1000)))), 17);
  put32(head, millimetres, 21);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  for (const bounds of [29, 145]) {
    putInt32(head, minX, bounds); putInt32(head, minY, bounds + 4);
    putInt32(head, maxX, bounds + 8); putInt32(head, maxY, bounds + 12);
  }
  [ascent, descent, mean, low, high].forEach((value, i) => put32(head, meters(value), 173 + i * 4));
  const watchName = watchNameFor(route.name);
  Buffer.from(watchName, "utf8").copy(head, 45);
  const trackId = trackIdFor(route.id);
  head.writeBigUInt64LE(trackId, 165);
  put32(head, NAVIGATION_FLAGS, 193);
  head[198] = 0xff; head[199] = 0xff; head[200] = 2;
  const body = Buffer.concat([head, track]);
  const crc16 = crc16Ccitt(body);
  const header = Buffer.alloc(16);
  header[0] = 0x48; header[1] = 0x46; header[3] = ROUTE_FILE_INDEX;
  put32(header, body.length, 8); put16(header, crc16, 12);
  put16(header, crc16Ccitt(header.subarray(0, 14)), 14);
  const file = Buffer.concat([header, body]);
  if (file.length > ROUTE_MAXIMUM_BYTES) throw new CorosError("The route is too large to send to the watch.");
  return { file, trackId, crc16, watchName, pointCount: points.length };
}

/** The 21-byte header that announces one route block on the control channel. */
export function encodeRouteBlockHeader(block: Uint8Array, offset: number, total: number, slot: number): Buffer {
  if (block.length === 0 || block.length > ROUTE_BLOCK_BYTES || offset < 0 || offset + block.length > total || total > ROUTE_MAXIMUM_BYTES || slot < 0 || slot > 254) {
    throw new CorosError("Invalid route transfer block.");
  }
  return encodeSftBlockHeader(block, offset, total, slot, ROUTE_FILE_INDEX);
}

// ── Session operations ──

/** A Cancel the app sends while a route goes over; checked between blocks. */
export class CancelFlag {
  isSet = false;
  set(on: boolean): void { this.isSet = on; }
}

/** The helper's own flag: `cancel` sets it, `syncRoute` clears it as it starts. */
export const routeCancel = new CancelFlag();

class RouteCancelled extends CorosError {
  constructor() { super("Route sync cancelled."); }
}

/** Waits between library checks after a transfer, in milliseconds. Tests shorten it. */
export const routeTiming = { verifyPause: 400 };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function routesNow(session: WatchSession): Promise<RouteInventory> {
  session.requireAuthenticated();
  return decodeRouteInventory(await session.link.exchange(ROUTE_INVENTORY_OPCODE, Buffer.from([0]), 20));
}

/** The watch's route library (0xAA). */
export const readRoutes = (session: WatchSession): Promise<RouteInventory> => session.exclusively(() => routesNow(session));

const holds = (inventory: RouteInventory, encoded: EncodedRoute) => inventory.entries.find((e) => e.trackId === encoded.trackId && e.crc16 === encoded.crc16);

/**
 * Sends a route in 4 KB blocks to its own slot (or the first free one), then confirms the library lists it with the
 * same checksum. A route already there unchanged isn't sent again.
 */
export function syncRoute(session: WatchSession, route: RouteInput, progress: (sent: number, total: number) => void,
  isCancelled: () => boolean = () => false): Promise<{ slot: number; inventory: RouteInventory }> {
  return session.exclusively(async () => {
    const link = session.link;
    const encoded = encodeRouteFile(route);
    const total = encoded.file.length;
    const before = await routesNow(session);
    const slot = routeSlot(before, encoded.trackId);
    if (holds(before, encoded)) {
      progress(total, total);
      return { slot, inventory: before };
    }
    progress(0, total);
    let offset = 0, started = false;
    try {
      while (offset < total) {
        if (isCancelled()) throw new RouteCancelled();
        if (!link.isConnected) throw new CorosError("The watch disconnected during the transfer. Reconnect and try again.");
        const block = encoded.file.subarray(offset, Math.min(offset + ROUTE_BLOCK_BYTES, total));
        const header = encodeRouteBlockHeader(block, offset, total, slot);
        started = true;
        await link.sendFileBlock(header, block, ROUTE_FILE_INDEX);
        offset += block.length;
        progress(offset, total);
      }
      for (let check = 0; check < 6; check++) {
        const after = await routesNow(session);
        const stored = holds(after, encoded);
        if (stored) return { slot: stored.slot, inventory: after };
        await pause(routeTiming.verifyPause);
      }
      throw new CorosError("The watch didn't confirm the route. Reconnect and try again.");
    } catch (error) {
      // A partial transfer leaves the watch mid-file; drop the link as the desktop does.
      if (started) await link.disconnect();
      throw error;
    }
  });
}

// ── The helper's commands (Routes in the retired helper's Maps.swift) ──

export const trackHex = (id: bigint): string => id.toString(16).padStart(16, "0");

export interface RouteLibrary { capacity: number; full: boolean; routes: { slot: number; trackId: string; crc: number }[] }

export const describeRoutes = (inventory: RouteInventory): RouteLibrary => ({
  capacity: inventory.capacity,
  full: isFull(inventory),
  routes: [...inventory.entries].sort((a, b) => a.slot - b.slot).map((e) => ({ slot: e.slot, trackId: trackHex(e.trackId), crc: e.crc16 })),
});

/** `routes`: the library's slots with track IDs and CRCs; the watch keeps no names there. */
export const readRoutesCommand = async (session: WatchSession): Promise<RouteLibrary> => describeRoutes(await readRoutes(session));

const isNumber = (v: unknown): v is number => typeof v === "number";

/**
 * The route the app wrote: id, name, createdAt (seconds since 1970), distanceM, ascentM, descentM, points ([[lat, lon]])
 * and elevations (metres, evenly spaced; may be empty). Every point goes as it is.
 */
export function routeInput(raw: unknown): RouteInput {
  const r = raw as Record<string, unknown> | null;
  const rows = r && typeof r === "object" && !Array.isArray(r) ? r.points : undefined;
  if (!r || typeof r.id !== "string" || r.id === "" || !Array.isArray(rows) || !rows.every((row) => Array.isArray(row) && row.every(isNumber))) {
    throw new CorosError("The route couldn't be read.");
  }
  if (rows.length < 2 || rows.length > ROUTE_MAXIMUM_POINTS) throw new CorosError("A route must contain between 2 and 40,000 GPS points to sync.");
  const points = (rows as number[][]).map((row) => {
    if (row.length < 2) throw new CorosError("The route contains an invalid GPS point.");
    return { latitude: row[0], longitude: row[1] };
  });
  const number = (key: string) => (isNumber(r[key]) ? r[key] : 0);
  const elevations = Array.isArray(r.elevations) && r.elevations.every(isNumber) ? r.elevations : [];
  return {
    id: r.id, name: typeof r.name === "string" ? r.name : "", createdAt: new Date(number("createdAt") * 1000),
    distanceMeters: number("distanceM"), points, elevations, ascentMeters: number("ascentM"), descentMeters: number("descentM"),
  };
}

export interface RouteSent {
  trackId: string; crc: number; name: string; pointCount: number; bytes: number;
  already: boolean; slot: number; inventory: RouteLibrary;
}

/**
 * `syncRoute`: one route from a file the app wrote (`path`). Sent unless the watch holds it already (same track ID and
 * CRC16), then checked in the library. Emits `{event: "progress", step: "route", phase, percent}`; `cancel` (the flag)
 * stops it between blocks.
 */
export async function syncRouteCommand(session: WatchSession, request: Record<string, unknown>, emit: Emit, cancel: CancelFlag = routeCancel): Promise<RouteSent> {
  const path = request.path;
  if (typeof path !== "string") throw new CorosError("No route to send.");
  cancel.set(false);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")); } catch { throw new CorosError("The route couldn't be read."); }
  return sendRoute(session, routeInput(raw), emit, cancel);
}

/** `syncRoute` with the route in hand. */
export async function sendRoute(session: WatchSession, route: RouteInput, emit: Emit, cancel: CancelFlag = routeCancel): Promise<RouteSent> {
  const encoded = encodeRouteFile(route);
  const out = { trackId: trackHex(encoded.trackId), crc: encoded.crc16, name: encoded.watchName, pointCount: encoded.pointCount, bytes: encoded.file.length };
  const step = (phase: string, percent: number) => emit({ event: "progress", step: "route", phase, percent });
  step("checking", 0);
  const before = await readRoutes(session);
  const held = holds(before, encoded);
  if (held) {
    step("done", 100);
    return { ...out, already: true, slot: held.slot, inventory: describeRoutes(before) };
  }
  if (!before.entries.some((e) => e.trackId === encoded.trackId) && isFull(before)) {
    throw new CorosError(`The watch's route library is full (${before.capacity} routes). Remove a route on your watch, then send this one again.`);
  }
  if (cancel.isSet) throw new RouteCancelled();
  step("sending", 0);
  const done = await syncRoute(session, route, (sent, total) => {
    if (total <= 0) return;
    step(sent >= total ? "checking" : "sending", Math.trunc((sent / total) * 100));
  }, () => cancel.isSet);
  step("done", 100);
  return { ...out, already: false, slot: done.slot, inventory: describeRoutes(done.inventory) };
}
