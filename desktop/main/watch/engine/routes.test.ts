// Routes against CorosKit's RouteProtocolTests (the file the COROS app sent to a PACE Pro, the 0xAA library), a whole
// file CorosKit encoded (fixtures/coroskit-route-sample.bin.gz), and the helper's `routes`/`syncRoute` answers.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { u16, u32 } from "./bytes";
import {
  CancelFlag, decodeRouteInventory, encodeRouteBlockHeader, encodeRouteFile, readRoutesCommand, routeInput, routeSlot, routeTiming,
  sendRoute, syncRoute, syncRouteCommand, type RouteInput,
} from "./routes";
import { SimulatedWatch } from "./simulatedWatch";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function sampleRoute(): RouteInput {
  const points = Array.from({ length: 700 }, (_, i) => {
    const t = (i / 700) * 2 * Math.PI;
    // A ~5 km loop plus a far jump to force new page anchors.
    return { latitude: 43.6532 + 0.012 * Math.sin(t) + (i >= 350 && i < 360 ? 0.9 : 0), longitude: -79.3832 + 0.018 * Math.cos(t) };
  });
  return { id: "3F2504E0-4F89-11D3-9A0C-0305E82C3301", name: "Evening loop · Port Lands", createdAt: new Date("2026-10-27T18:00:00Z"), distanceMeters: 5123.4, points };
}

// Parts of the route the COROS app itself sent to a PACE Pro (CorosLink's captured-route.bsp): a 2-point route "tes",
// 2,079 m, losing 12 m.
const capturedHeader = "4854524b0000020000d2cfccb7000c00003ce5c76affb91f0000000000ae2ca9ff19991a00722ea9ff329c1a0074657300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ae2ca9ff19991a00722ea9ff329c1a0000000000fb272bac64274a03030000000f00000008000000000000000c0000005500000000ffff0200";
/** TRK up to the end of the summary's own header: table, line pages, then distance, climb, heights, 480 samples. */
const capturedTrack = "54524b000000000010000000550004090103000300000000021f000700000000070200270000000000ff00020000000010ae2ca90019991a0000c4010000190312ae2ca90019991a0000c4010000190314ae2ca90019991a0000c4010000190316ae2ca90019991a0000c40100001903ffb91f000300000000000c000c0000e001000000000000000000000000000000";
/** The 480 height samples, as (value, count) runs. */
const capturedProfile: [number, number][] = [[255, 1], [234, 35], [213, 23], [191, 12], [170, 23], [149, 24], [128, 35],
  [106, 47], [85, 22], [106, 1], [85, 35], [64, 59], [43, 82], [21, 35], [0, 22], [21, 1], [0, 23]];

beforeAll(() => { routeTiming.verifyPause = 1; });

describe("RouteProtocol (RouteProtocolTests)", () => {
  it("writes the file the COROS app sends", () => {
    const samples = capturedProfile.flatMap(([value, count]) => Array<number>(count).fill(value));
    expect(samples).toHaveLength(480);
    // The corners of the captured bounds, nudged so the grid rounds back to the same cells.
    const degrees = (cell: number) => ((cell + (cell < 0 ? -0.5 : 0.5)) * 360) / 16_777_216;
    const file = encodeRouteFile({
      id: "captured", name: "tes", createdAt: new Date(1_791_485_244_000), distanceMeters: 2079.231,
      points: [{ latitude: degrees(1_743_129), longitude: degrees(-5_690_194) }, { latitude: degrees(1_743_922), longitude: degrees(-5_689_742) }],
      elevations: samples.map((s) => (s / 255) * 12), ascentMeters: 3, descentMeters: 15,
    }).file;
    expect(file.length).toBe(3600);
    const body = file.subarray(16);
    // All but the track's CRC (its anchors differ, below), the route ID and the unexplained 8 at 181.
    expect(hex(body.subarray(0, 9))).toBe(capturedHeader.slice(0, 18));
    expect(hex(body.subarray(13, 165))).toBe(capturedHeader.slice(26, 26 + 304));
    expect(hex(body.subarray(173, 181))).toBe("030000000f000000");
    expect(hex(body.subarray(185, 201))).toBe(capturedHeader.slice(370, 370 + 32));
    const track = body.subarray(512);
    expect(hex(track.subarray(0, 0x90))).toBe(capturedTrack);
    expect([...track.subarray(0x90, 0x270)]).toEqual(samples);
    expect(hex(track.subarray(0x270, 0x279))).toBe("010100020003000400");
    expect(hex(track.subarray(0x400, 0x410))).toBe("c401190300800080ffffffffffffffff");
  });

  it("puts the distance in the summary the watch's list reads", () => {
    const encoded = encodeRouteFile(sampleRoute());
    const body = encoded.file.subarray(16), track = body.subarray(512);
    expect(u32(body, 21)).toBe(5_123_400);
    expect(track[24]).toBe(2);
    const summary = u16(track, 27) * 16;
    expect(u32(track, summary)).toBe(5_123_400);
    expect(u16(track, summary + 15)).toBe(480);
    expect(encoded.pointCount).toBe(700);
    const header = encodeRouteBlockHeader(encoded.file.subarray(4096, 8192), 4096, encoded.file.length, 3);
    expect(header).toHaveLength(21);
    expect(header[0]).toBe(0x78);
  });

  it("matches CorosKit's encoding of a whole route, byte for byte", () => {
    const expected = gunzipSync(readFileSync(new URL("./fixtures/coroskit-route-sample.bin.gz", import.meta.url)));
    const route = { ...sampleRoute(), elevations: Array.from({ length: 50 }, (_, i) => 100 + 20 * Math.sin(i / 7)), ascentMeters: 123.6, descentMeters: 120.4 };
    const encoded = encodeRouteFile(route);
    expect(encoded.trackId.toString(16)).toBe("5827b6720724f4ad");
    expect(encoded.crc16).toBe(0xe708);
    expect(encoded.watchName).toBe("Evening loop · Port Lands");
    expect(hex(encoded.file)).toBe(hex(expected));
  });

  it("reads the library and picks slots", () => {
    const entry = (slot: number, id: bigint, crc: number) => {
      const b = Buffer.alloc(13);
      b[0] = slot; b.writeBigUInt64LE(id, 1); b.writeUInt16LE(crc, 9); b[11] = 1;
      return b;
    };
    const inventory = decodeRouteInventory(Buffer.concat([Buffer.from([0, 5, 2, 13, 0, 0]), entry(0, 42n, 0x1234), entry(2, 7n, 0xbeef)]));
    expect(inventory.capacity).toBe(5);
    expect(inventory.entries.map((e) => e.trackId)).toEqual([42n, 7n]);
    expect(inventory.entries[1].crc16).toBe(0xbeef);
    expect(routeSlot(inventory, 7n)).toBe(2);
    expect(routeSlot(inventory, 99n)).toBe(1);
    const full = { capacity: 2, entries: inventory.entries.map((e) => ({ ...e, slot: Math.min(e.slot, 1) })) };
    expect(() => routeSlot(full, 99n)).toThrow("route library is full");
    expect(() => decodeRouteInventory(Buffer.from([0, 5, 1, 12, 0, 0]))).toThrow();
  });

  it("rejects bad routes", () => {
    expect(() => encodeRouteFile({ ...sampleRoute(), points: [sampleRoute().points[0]] })).toThrow("between 2 and 40,000");
    const off = sampleRoute(); off.points[3].latitude = 91;
    expect(() => encodeRouteFile(off)).toThrow("invalid GPS point");
    expect(() => encodeRouteFile({ ...sampleRoute(), distanceMeters: 0 })).toThrow("distance is invalid");
    const same = sampleRoute(); same.points = [same.points[0], { ...same.points[0] }];
    expect(() => encodeRouteFile(same)).toThrow("two distinct GPS points");
  });

  it("names a route as the watch lists it", () => {
    expect(encodeRouteFile({ ...sampleRoute(), name: " \u0001 " }).watchName).toBe("C-LINK route");
    expect(encodeRouteFile({ ...sampleRoute(), name: "a\tb\nc" }).watchName).toBe("a b c");
    const long = encodeRouteFile({ ...sampleRoute(), name: "é".repeat(80) }).watchName;
    expect(Buffer.byteLength(long)).toBe(118);
  });
});

describe("route sync on the simulated watch", () => {
  it("sends a route, then confirms it in the library", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    const sent: number[] = [];
    const encoded = encodeRouteFile(sampleRoute());
    const done = await syncRoute(session, sampleRoute(), (s) => sent.push(s));
    expect(done.slot).toBe(0);
    expect(done.inventory.entries).toEqual([{ slot: 0, trackId: encoded.trackId, crc16: encoded.crc16, revision: 1 }]);
    expect(sent[0]).toBe(0);
    expect(sent.at(-1)).toBe(encoded.file.length);
    expect(watch.offsets).toEqual([0, 4096, 8192, 12288, 16384].filter((o) => o < encoded.file.length));
    // Unchanged: not sent again.
    watch.offsets = [];
    expect((await syncRoute(session, sampleRoute(), () => {})).slot).toBe(0);
    expect(watch.offsets).toEqual([]);
  });

  it("answers like the helper's routes and syncRoute, with its progress events", async () => {
    const watch = new SimulatedWatch();
    const session = watch.session();
    const folder = mkdtempSync(join(tmpdir(), "clink-route-"));
    const path = join(folder, "route.json");
    const r = sampleRoute();
    writeFileSync(path, JSON.stringify({ id: r.id, name: r.name, createdAt: r.createdAt.getTime() / 1000, distanceM: r.distanceMeters,
      points: r.points.map((p) => [p.latitude, p.longitude]), elevations: [], ascentM: 0, descentM: 0 }));
    const events: Record<string, unknown>[] = [];
    const answer = await syncRouteCommand(session, { path }, (e) => events.push(e));
    const encoded = encodeRouteFile(r);
    const trackId = encoded.trackId.toString(16).padStart(16, "0");
    expect(answer).toEqual({ trackId, crc: encoded.crc16, name: "Evening loop · Port Lands", pointCount: 700, bytes: encoded.file.length,
      already: false, slot: 0, inventory: { capacity: 5, full: false, routes: [{ slot: 0, trackId, crc: encoded.crc16 }] } });
    expect(events[0]).toEqual({ event: "progress", step: "route", phase: "checking", percent: 0 });
    expect(events[1]).toEqual({ event: "progress", step: "route", phase: "sending", percent: 0 });
    expect(events.at(-2)).toEqual({ event: "progress", step: "route", phase: "checking", percent: 100 });
    expect(events.at(-1)).toEqual({ event: "progress", step: "route", phase: "done", percent: 100 });
    expect(await readRoutesCommand(session)).toEqual(answer.inventory);

    events.length = 0;
    const again = await syncRouteCommand(session, { path }, (e) => events.push(e));
    expect(again.already).toBe(true);
    expect(events.map((e) => e.phase)).toEqual(["checking", "done"]);
    await expect(syncRouteCommand(session, {}, () => {})).rejects.toThrow("No route to send.");
  });

  it("refuses a full library and stops when cancelled", async () => {
    const watch = new SimulatedWatch();
    watch.routeCapacity = 1;
    watch.routes.set(0, { trackId: 9n, crc16: 1 });
    const session = watch.session();
    await expect(sendRoute(session, sampleRoute(), () => {})).rejects.toThrow(
      "The watch's route library is full (1 routes). Remove a route on your watch, then send this one again.");
    watch.routeCapacity = 5;
    const cancel = new CancelFlag();
    let blocks = 0;
    const events: Record<string, unknown>[] = [];
    await expect(sendRoute(session, sampleRoute(), (e) => { events.push(e); if (e.phase === "sending" && (e.percent as number) > 0 && ++blocks === 2) cancel.set(true); }, cancel))
      .rejects.toThrow("Route sync cancelled.");
    expect(watch.offsets).toEqual([0, 4096]);
    // Stopped partway: the link is dropped.
    expect(watch.isConnected).toBe(false);
  });

  it("reads the route file as the helper does", () => {
    expect(() => routeInput({ points: [[1, 2], [3, 4]] })).toThrow("The route couldn't be read.");
    expect(() => routeInput({ id: "x", points: [[1, "2"]] })).toThrow("The route couldn't be read.");
    expect(() => routeInput({ id: "x", points: [[1, 2]] })).toThrow("A route must contain between 2 and 40,000 GPS points to sync.");
    expect(() => routeInput({ id: "x", points: [[1, 2], [3]] })).toThrow("The route contains an invalid GPS point.");
    const input = routeInput({ id: "x", points: [[1, 2], [3, 4]], elevations: [1, null] });
    expect(input).toMatchObject({ name: "", distanceMeters: 0, elevations: [], ascentMeters: 0, createdAt: new Date(0) });
  });
});
