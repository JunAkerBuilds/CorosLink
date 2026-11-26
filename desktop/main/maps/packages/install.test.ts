import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertNotOwnFolder, clearLeftovers, fingerprint, mapFolderOf, onWatch, overlaps, plan, targetOf, unpack } from "./install";
import { buildZip } from "./testZip";

const temp = () => mkdtempSync(path.join(os.tmpdir(), "clink-inst-"));
const tile = (n: number, c = "a") => c.repeat(n);

function region(dir: string, top = "map") {
  const file = path.join(dir, `${top}-region.zip`);
  writeFileSync(file, buildZip([
    { name: `${top}/` },
    { name: `${top}/VSM/023/S1.t`, data: tile(100) },
    { name: `${top}/VSM/023/S2.t`, data: tile(200, "b"), deflate: true },
    { name: `${top}/VCM/7/C3.t`, data: tile(300, "c") },
    { name: "readme.txt", data: "not a map file" },
    { name: `${top}/../escape.t`, data: "no" },
  ], { zip64: true }));
  return file;
}

describe("installing map packages over USB", () => {
  it("counts only the bytes still needed: same-size files are skipped, a short one counts its difference", async () => {
    const dir = temp(), zip = region(dir), watchMap = path.join(dir, "watch", "map");
    mkdirSync(path.join(watchMap, "VSM", "023"), { recursive: true });
    writeFileSync(path.join(watchMap, "VSM", "023", "S1.t"), tile(100));
    writeFileSync(path.join(watchMap, "VSM", "023", "S2.t"), tile(50));
    const totals = await plan([zip], watchMap);
    expect(totals).toEqual({ files: 2, bytes: 500, neededBytes: 150 + 300, skipped: 1, replace: new Set() });
  });

  it("unpacks the zip's map folder into the watch's own Map folder, skipping what's there", async () => {
    const dir = temp(), zip = region(dir, "Map"), watchMap = path.join(dir, "watch", "Map");
    mkdirSync(path.join(watchMap, "VSM", "023"), { recursive: true });
    writeFileSync(path.join(watchMap, "VSM", "023", "S1.t"), tile(100));
    const ticks: number[] = [];
    const done = await unpack([{ file: zip, label: "Asia 1 Topo" }], watchMap, { onProgress: (t) => ticks.push(t.copiedBytes) });
    expect(done).toEqual({ copiedBytes: 500, filesDone: 2 });
    expect(ticks.at(-1)).toBe(500);
    expect(readFileSync(path.join(watchMap, "VSM", "023", "S2.t"), "utf8")).toBe(tile(200, "b"));
    expect(readFileSync(path.join(watchMap, "VCM", "7", "C3.t"), "utf8")).toBe(tile(300, "c"));
    expect(existsSync(path.join(dir, "watch", "escape.t"))).toBe(false);
    expect(existsSync(path.join(watchMap, "readme.txt"))).toBe(false);
    expect(readdirSync(path.join(watchMap, "VSM", "023")).sort()).toEqual(["S1.t", "S2.t"]);
  });

  it("stops when cancelled and leaves no half-written tile under its real name", async () => {
    const dir = temp(), zip = region(dir), watchMap = path.join(dir, "watch", "map");
    const controller = new AbortController();
    controller.abort();
    await expect(unpack([{ file: zip, label: "x" }], watchMap, { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(existsSync(path.join(watchMap, "VSM", "023", "S1.t"))).toBe(false);
  });

  it("uses the watch's own spelling of the map folder and never assumes case doesn't matter", () => {
    const apex = temp();
    mkdirSync(path.join(apex, "Map"));
    expect(mapFolderOf(apex, "APEX 4 46mm")).toEqual({ folder: path.join(apex, "Map"), exists: true });
    const older = temp();
    mkdirSync(path.join(older, "map"));
    expect(mapFolderOf(older, "APEX 4")).toEqual({ folder: path.join(older, "map"), exists: true });
    expect(mapFolderOf(temp(), "APEX 4").folder.endsWith(`${path.sep}Map`)).toBe(true);
    expect(mapFolderOf(temp(), "VERTIX 2").folder.endsWith(`${path.sep}map`)).toBe(true);
  });

  it("refuses when the source is the watch's own folder (without case on Windows)", () => {
    expect(overlaps("E:\\Map", "e:\\map", "win32")).toBe(true);
    expect(overlaps("E:\\map\\VSM", "E:\\Map", "win32")).toBe(true);
    expect(overlaps("C:\\Users\\a\\maps", "E:\\Map", "win32")).toBe(false);
    expect(() => assertNotOwnFolder("E:\\MAP", "e:\\Map", "win32")).toThrow(/own Map folder/);
    expect(overlaps("/Volumes/COROS/Map", "/Volumes/COROS/Map/VSM", "linux")).toBe(true);
    expect(overlaps("/Users/a/cache", "/Volumes/COROS/Map", "linux")).toBe(false);
  });

  it("finds a package on the watch from its fingerprint", async () => {
    const dir = temp(), zip = region(dir), watchMap = path.join(dir, "watch", "map");
    const print = await fingerprint(zip);
    expect(print.files).toBe(3);
    expect(await onWatch(print, watchMap)).toBe(false);
    await unpack([{ file: zip, label: "x" }], watchMap);
    expect(await onWatch(print, watchMap)).toBe(true);
    writeFileSync(path.join(watchMap, "VSM", "023", "S1.t"), "short");
    expect(await onWatch(print, watchMap)).toBe(false);
  });

  it("drops the top map folder whatever its case and skips anything else", () => {
    const e = (name: string) => ({ name, directory: name.endsWith("/"), method: 0, crc32: 0, compressedSize: 0, size: 0, offset: 0 });
    expect(targetOf("/w/Map", e("Map/OSM/1/S.csm"))).toBe(path.join("/w/Map", "OSM", "1", "S.csm"));
    expect(targetOf("/w/Map", e("map/VSM/S.t"))).toBe(path.join("/w/Map", "VSM", "S.t"));
    expect(targetOf("/w/Map", e("map/../x.t"))).toBeNull();
    expect(targetOf("/w/Map", e("other/x.t"))).toBeNull();
    expect(targetOf("/w/Map", e("map/VSM/._S.t"))).toBeNull();
  });

  // File names don't change between map versions (…V00.t), so a stale tile can match in size: only its contents tell.
  it("a check replaces a same-size file whose contents differ and leaves a matching one", async () => {
    const dir = temp(), zip = region(dir), watchMap = path.join(dir, "watch", "map");
    await unpack([{ file: zip, label: "x" }], watchMap);
    const stale = path.join(watchMap, "VSM", "023", "S2.t");
    writeFileSync(stale, tile(200, "z"));

    // Sizes alone see nothing to do.
    expect((await plan([zip], watchMap)).files).toBe(0);

    const read: number[] = [];
    const totals = await plan([zip], watchMap, undefined, { check: true, onChecked: (n, total) => { read.push(n); expect(total).toBe(600); } });
    expect(totals).toMatchObject({ files: 1, bytes: 200, neededBytes: 0, skipped: 2 });
    expect([...totals.replace]).toEqual([stale.toLowerCase()]);
    expect(read.at(-1)).toBe(600);

    expect(await unpack([{ file: zip, label: "x" }], watchMap, { replace: totals.replace })).toEqual({ copiedBytes: 200, filesDone: 1 });
    expect(readFileSync(stale, "utf8")).toBe(tile(200, "b"));
    expect((await plan([zip], watchMap, undefined, { check: true })).files).toBe(0);
  });

  it("a check stops when cancelled", async () => {
    const dir = temp(), zip = region(dir), watchMap = path.join(dir, "watch", "map");
    await unpack([{ file: zip, label: "x" }], watchMap);
    const controller = new AbortController();
    controller.abort();
    await expect(plan([zip], watchMap, controller.signal, { check: true })).rejects.toThrow(/cancelled/);
  });

  it("clears unfinished parts a cut-short copy left on the watch", async () => {
    const dir = temp(), watchMap = path.join(dir, "watch", "map");
    mkdirSync(path.join(watchMap, "VSM", "023"), { recursive: true });
    writeFileSync(path.join(watchMap, "VSM", "023", "S1.t.clink-part"), "half");
    writeFileSync(path.join(watchMap, "VSM", "023", "S2.t"), "kept");
    expect(await clearLeftovers(watchMap)).toBe(1);
    expect(readdirSync(path.join(watchMap, "VSM", "023"))).toEqual(["S2.t"]);
    expect(await clearLeftovers(path.join(dir, "no-watch"))).toBe(0);
  });
});
