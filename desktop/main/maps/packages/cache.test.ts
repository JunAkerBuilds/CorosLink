import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PackageCache, type CachedRecord } from "./cache";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const record = (id: string): CachedRecord => ({
  packageId: id, region: id.split(":")[2], layer: "topo", version: 5, sizeBytes: 10, savedAt: "2026-11-25T00:00:00.000Z", url: "https://example.invalid/x.zip",
  fingerprint: {} as CachedRecord["fingerprint"],
} as CachedRecord);

describe("PackageCache", () => {
  it("keeps both entries when two downloads finish at the same moment", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "clink-cache-"));
    dirs.push(folder);
    const cache = new PackageCache(folder);
    for (const id of ["v5:topo:asia1", "v5:topo:asia2"]) writeFileSync(cache.fileOf(id), "zip");
    // Before saves went one at a time, the second write's rename found no temp file and threw.
    await Promise.all([cache.put(record("v5:topo:asia1")), cache.put(record("v5:topo:asia2"))]);
    expect(new PackageCache(folder).list().map((r) => r.packageId).sort()).toEqual(["v5:topo:asia1", "v5:topo:asia2"]);
    expect(readdirSync(folder).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
