import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentRange, download, partPath, PARTIAL_MAX_AGE_MS, prunePartials } from "./download";
import { fakeServer } from "./testServer";

const URL_A = "https://map-oss-us.coros.com/regionMap/v5/asia1_topo_5.0.3.zip";
const bytes = (n: number, seed = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff));

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clink-dl-"));
  const server = fakeServer();
  const target = path.join(dir, "v5_topo_asia1.zip");
  return { dir, server, target };
}

describe("resumable map download", () => {
  it("keeps a .part when the connection drops and resumes it with Range + If-Range on the ETag", async () => {
    const { server, target } = setup();
    const file = bytes(10_000);
    server.files.set(URL_A, { bytes: file, etag: '"abc-1"' });
    server.failAfter = 4_000;
    await expect(download({ url: URL_A, target, fetch: server.fetch })).rejects.toThrow(/pick up where it left off/);
    expect(statSync(partPath(target)).size).toBe(4_000);
    expect(existsSync(target)).toBe(false);

    const seen: number[] = [];
    const size = await download({ url: URL_A, target, fetch: server.fetch, onProgress: (r) => seen.push(r) });
    expect(server.calls[1]).toMatchObject({ range: "bytes=4000-", ifRange: '"abc-1"' });
    expect(size).toBe(10_000);
    expect(seen[0]).toBe(4_000);
    expect(readFileSync(target).equals(file)).toBe(true);
    expect(existsSync(partPath(target))).toBe(false);
    expect(existsSync(`${partPath(target)}.json`)).toBe(false);
  });

  it("starts over when the file changed on the server (ETag no longer matches)", async () => {
    const { server, target } = setup();
    server.files.set(URL_A, { bytes: bytes(10_000), etag: '"old"' });
    server.failAfter = 3_000;
    await expect(download({ url: URL_A, target, fetch: server.fetch })).rejects.toThrow();

    const fresh = bytes(12_000, 7);
    server.files.set(URL_A, { bytes: fresh, etag: '"new"' });
    await download({ url: URL_A, target, fetch: server.fetch });
    expect(server.calls[1]).toMatchObject({ range: "bytes=3000-", ifRange: '"old"' });
    expect(readFileSync(target).equals(fresh)).toBe(true);
  });

  it("starts over when the server ignores Range and sends the whole file", async () => {
    const { server, target } = setup();
    const file = bytes(9_000);
    server.files.set(URL_A, { bytes: file, etag: '"e"' });
    server.failAfter = 5_000;
    await expect(download({ url: URL_A, target, fetch: server.fetch })).rejects.toThrow();
    server.ignoreRange = true;
    await download({ url: URL_A, target, fetch: server.fetch });
    expect(readFileSync(target).equals(file)).toBe(true);
  });

  it("doesn't resume a partial from another URL", async () => {
    const { server, target } = setup();
    server.files.set(URL_A, { bytes: bytes(5_000), etag: '"e"' });
    writeFileSync(partPath(target), bytes(100));
    writeFileSync(`${partPath(target)}.json`, JSON.stringify({ url: "https://map-oss-us.coros.com/other.zip", validator: '"e"', totalBytes: 5_000 }));
    await download({ url: URL_A, target, fetch: server.fetch });
    expect(server.calls[0].range).toBeUndefined();
    expect(statSync(target).size).toBe(5_000);
  });

  it("keeps the partial when cancelled", async () => {
    const { server, target } = setup();
    server.files.set(URL_A, { bytes: bytes(8_000), etag: '"e"' });
    let release!: () => void;
    server.hold = new Promise((r) => { release = r; });
    const controller = new AbortController();
    const running = download({ url: URL_A, target, fetch: server.fetch, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    release();
    await expect(running).rejects.toThrow(/cancelled/);
    expect(existsSync(`${partPath(target)}.json`)).toBe(true);
  });

  it("drops partials untouched for 30 days, and only those", async () => {
    const { dir } = setup();
    const old = path.join(dir, "v5_topo_old.zip.part"), recent = path.join(dir, "v5_topo_new.zip.part");
    for (const f of [old, recent]) { writeFileSync(f, "x"); writeFileSync(`${f}.json`, "{}"); }
    writeFileSync(path.join(dir, "v5_topo_orphan.zip.part.json"), "{}");
    const now = Date.now();
    const aged = (now - PARTIAL_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(old, aged, aged);
    expect(await prunePartials(dir, now)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(`${old}.json`)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(`${recent}.json`)).toBe(true);
    expect(existsSync(path.join(dir, "v5_topo_orphan.zip.part.json"))).toBe(false);
  });

  it("reads Content-Range", () => {
    expect(contentRange("bytes 100-199/2000")).toEqual({ start: 100, total: 2000 });
    expect(contentRange("bytes */2000")).toBeNull();
  });
});
