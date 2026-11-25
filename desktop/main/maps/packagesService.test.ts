import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MapManifest, PackagesStatus } from "../../maps/types";
import { PackagesService, type PackagesWatch } from "./packagesService";
import { manifestUrl } from "./packages/manifest";
import { buildZip } from "./packages/testZip";
import { fakeServer } from "./packages/testServer";

const HOST = "https://map-oss-us.coros.com";
const zipFor = (region: string) => buildZip([
  { name: "map/" },
  { name: `map/VSM/${region}/S1.t`, data: "a".repeat(400) },
  { name: `map/VSM/${region}/S2.t`, data: "b".repeat(600), deflate: true },
], { zip64: true });

function setup(options: { freeBytes?: number; folderInWatch?: boolean } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clink-pkg-"));
  const root = path.join(dir, "COROS APEX 4");
  mkdirSync(path.join(root, "Map"), { recursive: true });
  const folder = options.folderInWatch ? path.join(root, "Map", "cache") : path.join(dir, "cache");
  const server = fakeServer();
  const rows = ["asia1", "asia2", "asia3"].flatMap((region) => [
    { region, title: `map.${region}`, parent: "asia", type: "topo", data: { size: 1000, link: `/regionMap/v5/${region}_topo_5.0.3.zip` } },
  ]);
  server.files.set(manifestUrl(5), { bytes: Buffer.from(JSON.stringify({ v: "5", host: `${HOST}/`, updatedAt: "2025-09-16 22:31:26", bundleVersion: "5.0.3", mapData: rows })), etag: "m" });
  for (const r of ["asia1", "asia2", "asia3"]) server.files.set(`${HOST}/regionMap/v5/${r}_topo_5.0.3.zip`, { bytes: zipFor(r), etag: `"${r}"` });
  let watch: PackagesWatch | null = { root, model: "APEX 4 46mm", freeBytes: options.freeBytes ?? 1e9 };
  let invalidated = 0;
  const service = new PackagesService({
    folder, fetch: server.fetch,
    drive: () => ({ watch: async () => watch, invalidate: () => { invalidated++; } }),
  });
  const call = async (method: string, sub: string, body?: unknown) => {
    const res = await service.answer(new Request(`clink://app/api/desktop/maps${sub}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), sub);
    return res;
  };
  const ok = async <T = PackagesStatus>(method: string, sub: string, body?: unknown) => {
    const res = (await call(method, sub, body))!;
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as T;
  };
  return { dir, root, folder, server, service, call, ok, unplug: () => { watch = null; }, invalidated: () => invalidated };
}

const ID = "v5:topo:asia1";
const enc = encodeURIComponent;

describe("COROS Maps packages service", () => {
  it("serves the manifest per version and leaves other paths alone", async () => {
    const { ok, call } = setup();
    const m = await ok<MapManifest>("GET", "/packages/manifest?version=5");
    expect(m.regions.map((r) => r.topo?.id)).toEqual(["v5:topo:asia1", "v5:topo:asia2", "v5:topo:asia3"]);
    expect(await call("GET", "/routes")).toBeNull();
    expect(await call("GET", "/packagesx")).toBeNull();
  });

  it("downloads, caches, installs onto the watch's Map folder and then sees it there", async () => {
    const s = setup();
    let status = await s.ok("POST", `/packages/${enc(ID)}/download`);
    expect(status.jobs[0]).toMatchObject({ packageId: ID, state: "downloading" });
    await s.service.settled.get(ID);
    status = await s.ok("GET", "/packages");
    expect(status.jobs).toEqual([]);
    expect(status.cached).toEqual([expect.objectContaining({ packageId: ID, region: "asia1", layer: "topo", version: 5 })]);
    expect(status.cacheBytes).toBe(zipFor("asia1").length);
    expect(status.onWatch).toEqual([]);

    status = await s.ok("POST", "/packages/install", { ids: [ID] });
    expect(status.install).toMatchObject({ state: "copying", label: "Asia 1 Topo", totalBytes: 1000, files: 2 });
    await s.service.installDone;
    status = await s.ok("GET", "/packages");
    expect(status.install).toMatchObject({ state: "done", copiedBytes: 1000, filesDone: 2 });
    expect(readFileSync(path.join(s.root, "Map", "VSM", "asia1", "S2.t"), "utf8")).toBe("b".repeat(600));
    expect(status.onWatch).toEqual([ID]);
    expect(s.invalidated()).toBe(1);

    // A second install has nothing left to copy.
    await s.ok("POST", "/packages/install", { ids: [ID] });
    await s.service.installDone;
    expect((await s.ok("GET", "/packages")).install).toMatchObject({ state: "done", totalBytes: 0, copiedBytes: 0 });
  });

  it("refuses an install the watch has no room for, before writing anything", async () => {
    const s = setup({ freeBytes: 999 });
    await s.ok("POST", `/packages/${enc(ID)}/download`);
    await s.service.settled.get(ID);
    const res = (await s.call("POST", "/packages/install", { ids: [ID] }))!;
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("noSpace");
    expect(existsSync(path.join(s.root, "Map", "VSM"))).toBe(false);
    expect((await s.ok("GET", "/packages")).install).toBeUndefined();
  });

  it("refuses when the cache is the watch's own Map folder", async () => {
    const s = setup({ folderInWatch: true });
    await s.ok("POST", `/packages/${enc(ID)}/download`);
    await s.service.settled.get(ID);
    const res = (await s.call("POST", "/packages/install", { ids: [ID] }))!;
    expect((await res.json()).error.code).toBe("ownFolder");
  });

  it("asks for the watch when none is plugged in, and for a download first", async () => {
    const s = setup();
    expect((await (await s.call("POST", "/packages/install", { ids: [ID] }))!.json()).error.code).toBe("notCached");
    await s.ok("POST", `/packages/${enc(ID)}/download`);
    await s.service.settled.get(ID);
    s.unplug();
    expect((await (await s.call("POST", "/packages/install", { ids: [ID] }))!.json()).error.code).toBe("noWatch");
    expect((await s.ok("GET", "/packages")).onWatch).toEqual([]);
  });

  it("downloads two at a time, queues the rest, cancels and deletes", async () => {
    const s = setup();
    let release!: () => void;
    s.server.hold = new Promise((r) => { release = r; });
    for (const r of ["asia1", "asia2", "asia3"]) await s.ok("POST", `/packages/${enc(`v5:topo:${r}`)}/download`);
    let status = await s.ok("GET", "/packages");
    expect(status.jobs.map((j) => j.state)).toEqual(["downloading", "downloading", "queued"]);

    status = await s.ok("POST", `/packages/${enc("v5:topo:asia1")}/cancel`);
    await s.service.settled.get("v5:topo:asia1");
    s.server.hold = undefined;
    release();
    // asia3 only starts once asia2 has finished (two at a time), so wait until nothing is running or queued, not
    // just for the downloads running right now.
    for (let i = 0; i < 200; i++) {
      await Promise.all([...s.service.settled.values()]);
      status = await s.ok("GET", "/packages");
      if (!status.jobs.some((j) => j.state === "downloading" || j.state === "queued")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    status = await s.ok("GET", "/packages");
    expect(status.jobs).toEqual([expect.objectContaining({ packageId: "v5:topo:asia1", state: "cancelled" })]);
    expect(status.cached.map((c) => c.packageId).sort()).toEqual(["v5:topo:asia2", "v5:topo:asia3"]);

    status = await s.ok("DELETE", `/packages/cached/${enc("v5:topo:asia2")}`);
    expect(status.cached.map((c) => c.packageId)).toEqual(["v5:topo:asia3"]);
    expect(existsSync(path.join(s.folder, "v5_topo_asia2.zip"))).toBe(false);
  });

  it("refuses ids that aren't in COROS's list", async () => {
    const s = setup();
    const res = (await s.call("POST", `/packages/${enc("v5:topo:atlantis")}/download`))!;
    expect(res.status).toBe(404);
  });
});
