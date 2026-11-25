import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quadkey, type Tile } from "../../../maps/types";
import { AreasProblem, MapPackageClient, normalizeTiles, readSigning, signRequest, type AreaFile } from "./client";
import { SIGNING, fakeCoros } from "./testFakes";
import { AreasHistory } from "./history";
import { modelCode } from "./models";
import { CopyCancelled, areaFileIn, bytesStillNeeded, copyAreas, removeAreaFiles, watchMapFolder } from "./usb";

const tile: Tile = { x: 20, y: 43 };

describe("map area squares", () => {
  it("takes 1–16 squares with x and y 0–127, without duplicates", () => {
    expect(normalizeTiles([{ x: 0, y: 0 }, { x: 127, y: 127 }, { x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 127, y: 127 }]);
    expect(() => normalizeTiles([])).toThrow(AreasProblem);
    expect(() => normalizeTiles(Array.from({ length: 17 }, (_, i) => ({ x: i, y: 0 })))).toThrow(/sixteen|16/);
    for (const bad of [{ x: 128, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 128 }, { x: 1.5, y: 0 }, { x: "1", y: 0 }, null]) {
      expect(() => normalizeTiles([bad])).toThrow(AreasProblem);
    }
  });
});

describe("COROS's map package service", () => {
  it("reads the signing config from the web client as text and signs requests as COROS does", async () => {
    expect(readSigning(`x={prod:{app_id:"${SIGNING.id}",app_secret:"${SIGNING.key}"}}`)).toEqual(SIGNING);
    expect(readSigning("prod:{app_id:\"1\",app_secret:\"zz\"}")).toBeUndefined();
    // Keys sorted, objects add only their key, sign itself left out.
    const body = { b: 2, a: "x", list: [{ q: 1 }], sign: "ignored" };
    expect(signRequest(body, "k")).toBe(signRequest({ a: "x", b: 2, list: [] }, "k"));
    expect(signRequest(body, "k")).toMatch(/^[0-9A-F]{32}$/);

    const coros = fakeCoros();
    const client = new MapPackageClient({ fetch: coros.fetcher });
    const preview = await client.preview([tile], "W332");
    expect((globalThis as { __ran?: boolean }).__ran).toBeUndefined();
    expect(preview).toMatchObject({ fileCount: 2, sizeBytes: 1500 });
    expect(preview.files.map((f) => `${f.layer}/${f.name}`)).toEqual([`VSM/S${quadkey(tile)}V01.t`, `VCM/C${quadkey(tile)}V01.t`]);
    const sent = coros.calls.find((c) => c.body)!.body!;
    expect(sent).toMatchObject({ action: "check", deviceModel: "W332", app_id: SIGNING.id, list: [{ quadkey: quadkey(tile), O: 0, C: 0 }] });
  });

  it("ties a preview to the watch model it was sized for, for 10 minutes", async () => {
    let now = 1_000_000;
    const client = new MapPackageClient({ fetch: fakeCoros().fetcher, now: () => now });
    const preview = await client.preview([tile], "W332");
    expect(() => client.take(preview.id, "W336")).toThrow(/again/);
    expect(client.take(preview.id, "W332").id).toBe(preview.id);
    expect(await client.createTask(preview.id, "W332")).toBe("Ab3_-xyz");
    now += 10 * 60_000 + 1;
    expect(() => client.take(preview.id, "W332")).toThrow(/again/);
  });

  it("refuses odd models and file lists that don't match the squares", async () => {
    const client = new MapPackageClient({ fetch: fakeCoros().fetcher });
    await expect(client.preview([tile], "pace pro")).rejects.toThrow(AreasProblem);
    expect(() => MapPackageClient.files([tile], { fileCount: 1, files: [{ name: "S0000000V01.t", size: 5 }] })).toThrow(/add up/);
    expect(() => MapPackageClient.files([tile], { fileCount: 1, files: [{ name: `S${quadkey(tile)}V01.t`, size: 0 }] })).toThrow(/add up/);
  });
});

describe("watch model codes", () => {
  it("maps names to COROS's codes, longest name first", () => {
    expect(modelCode("PACE Pro")).toBe("W332");
    expect(modelCode("PACE 4 Pro")).toBe("W337");
    expect(modelCode("PACE 4")).toBe("W336");
    expect(modelCode("R4")).toBe("W336");
    expect(modelCode("APEX 4 46mm")).toBe("W541");
    expect(modelCode("APEX 4 42mm")).toBe("W542");
    expect(modelCode("VERTIX 2S")).toBe("B19S");
    expect(modelCode("COROS VERTIX 4")).toBe("W706");
    expect(modelCode("W706")).toBe("W706");
    expect(modelCode("COROS watch")).toBeUndefined();
  });
});

describe("map areas over USB", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "clink-areas-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const file = (layer: "VSM" | "VCM", size: number): AreaFile => ({ name: `${layer === "VSM" ? "S" : "C"}${quadkey(tile)}V01.t`, layer, quadkey: quadkey(tile), version: "V01", sizeBytes: size });

  it("uses the map folder as it's spelled: Map on APEX 4, map on older watches, never a second one", async () => {
    const root = path.join(dir, "watch");
    mkdirSync(path.join(root, "map", "vsm"), { recursive: true });
    const folder = await watchMapFolder(root);
    expect(path.basename(folder)).toBe("map");
    expect(await areaFileIn(folder, file("VSM", 1))).toBe(path.join(root, "map", "vsm", quadkey(tile).slice(0, 3), file("VSM", 1).name));
    const apex = path.join(dir, "apex");
    mkdirSync(path.join(apex, "Map"), { recursive: true });
    expect(path.basename(await watchMapFolder(apex))).toBe("Map");
    // Neither there: Map is made.
    expect(path.basename(await watchMapFolder(path.join(dir, "new")))).toBe("Map");
  });

  it("counts only bytes still needed", async () => {
    const map = path.join(dir, "Map");
    const s = file("VSM", 1000), c = file("VCM", 500);
    expect(await bytesStillNeeded([s, c], map)).toBe(1500);
    mkdirSync(path.dirname(await areaFileIn(map, s)), { recursive: true });
    writeFileSync(await areaFileIn(map, s), Buffer.alloc(1000));
    expect(await bytesStillNeeded([s, c], map)).toBe(500);
    mkdirSync(path.dirname(await areaFileIn(map, c)), { recursive: true });
    writeFileSync(await areaFileIn(map, c), Buffer.alloc(200));
    expect(await bytesStillNeeded([s, c], map)).toBe(300);
  });

  it("downloads to the cache, copies only what the watch lacks, and refuses what doesn't fit", async () => {
    const fetched: string[] = [];
    const coros = fakeCoros({ onFile: (u) => fetched.push(u) });
    const map = path.join(dir, "watch", "Map"), cache = path.join(dir, "cache");
    const s = file("VSM", 1000), c = file("VCM", 500);
    mkdirSync(path.dirname(await areaFileIn(map, s)), { recursive: true });
    writeFileSync(await areaFileIn(map, s), Buffer.alloc(1000));
    const job = { label: "Home", files: [s, c], mapFolder: map, cache, fetch: coros.fetcher, onProgress: () => undefined };
    await expect(copyAreas({ ...job, freeBytes: 499, signal: new AbortController().signal })).rejects.toThrow(/space/);
    const done = await copyAreas({ ...job, freeBytes: 500, signal: new AbortController().signal });
    expect(done).toMatchObject({ state: "done", totalBytes: 500, copiedBytes: 500, files: 1, filesDone: 1 });
    expect(fetched).toEqual([`https://map-oss-us.coros.com/osm/tiles_V01/VCM/${c.name}`]);
    expect(readFileSync(await areaFileIn(map, c)).length).toBe(500);
    expect(readdirSync(path.dirname(await areaFileIn(map, c)))).toEqual([c.name]);
    // A second copy has nothing to do and fetches nothing.
    expect(await copyAreas({ ...job, signal: new AbortController().signal })).toMatchObject({ totalBytes: 0, files: 0 });
    expect(fetched).toHaveLength(1);
  });

  it("stops when cancelled, leaving no half-written file", async () => {
    const abort = new AbortController();
    const map = path.join(dir, "Map");
    const job = { label: "x", files: [file("VSM", 1000)], mapFolder: map, cache: path.join(dir, "cache"), fetch: fakeCoros().fetcher, signal: abort.signal,
      onProgress: (p: { message?: string }) => { if (p.message === "Copying to the watch") abort.abort(); } };
    await expect(copyAreas(job)).rejects.toBeInstanceOf(CopyCancelled);
    expect(await bytesStillNeeded(job.files, map)).toBe(1000);
  });

  it("removes only the named files and keeps squares another area still uses", async () => {
    const map = path.join(dir, "Map");
    const s = file("VSM", 10);
    mkdirSync(path.dirname(await areaFileIn(map, s)), { recursive: true });
    writeFileSync(await areaFileIn(map, s), Buffer.alloc(10));
    const history = new AreasHistory(path.join(dir, "history"));
    const base = { label: "a", tiles: [tile], fileCount: 1, sizeBytes: 10, via: "usb" as const, at: "2026-11-24T00:00:00Z", files: [s], model: "W332" };
    history.addArea({ ...base, id: "one" });
    history.addArea({ ...base, id: "two" });
    expect(history.filesInUseBesides("one").has(`VSM/${s.name}`)).toBe(true);
    expect(await removeAreaFiles([s], map)).toBe(1);
    expect(await bytesStillNeeded([s], map)).toBe(10);
    expect(new AreasHistory(path.join(dir, "history")).areas().map((a) => a.id)).toEqual(["two", "one"]);
  });
});
