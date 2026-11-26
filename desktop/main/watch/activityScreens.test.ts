import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import golden from "./fixtures/activityScreensGolden.json";
import { buildLayout, decodePages, decodeSports } from "./activityScreensProtocol";
import { ActivityScreens, type Device } from "./activityScreens";

// Made by CorosLink's own codec (corosActivityScreenProtocol.ts at c2ff5110) from the same pages: Run, four pages of
// 4, 6, 6 and 2 fields, as the PACE Pro on 3.2008.0 returned. The rewrite must give the same bytes.
const SOURCE = Buffer.from(golden.source, "hex");

describe("activity pages protocol", () => {
  it("reads pages as CorosLink did", () => {
    const pages = decodePages(SOURCE, 0);
    expect(JSON.stringify(pages.map((p) => [p.kind, p.rows, p.columns, p.fieldCount, p.baseMetricId, p.fields]))).toBe(golden.decoded);
    expect(pages.map((p) => p.fieldCount)).toEqual([4, 6, 6, 2]);
  });

  it("builds every layout byte for byte as CorosLink did", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) expect(buildLayout(SOURCE, 0, 1, n).toString("hex")).toBe((golden as Record<string, string>)[`page1_${n}`]);
    // Seven is header 0xAE and nine 0xBF, as the backups from the watch test showed.
    expect(buildLayout(SOURCE, 0, 1, 7)[2 + 44]).toBe(0xae);
    expect(buildLayout(SOURCE, 0, 1, 9)[2 + 44]).toBe(0xbf);
    // Only page 2 changes.
    const seven = buildLayout(SOURCE, 0, 1, 7);
    for (const p of [0, 2, 3]) expect(seven.subarray(2 + p * 44, 2 + (p + 1) * 44).equals(SOURCE.subarray(2 + p * 44, 2 + (p + 1) * 44))).toBe(true);
  });

  it("refuses what it doesn't understand", () => {
    expect(() => decodePages(SOURCE.subarray(0, 50), 0)).toThrow(/doesn't understand/);
    expect(() => decodePages(SOURCE, 4)).toThrow();
    const eleven = Buffer.concat([Buffer.from([0, 11]), Buffer.alloc(11 * 44)]);
    expect(() => decodePages(eleven, 0)).toThrow();
    expect(() => buildLayout(SOURCE, 0, 1, 10)).toThrow(/field count/);
    expect(() => decodeSports(Buffer.from([0, 4, 29, 64]))).not.toThrow();
    expect(decodeSports(Buffer.from([0, 4, 29, 64])).map((s) => s.name)).toEqual(["Run", "Bike"]);
    expect(() => decodeSports(Buffer.from([0, 0]))).toThrow();
  });
});

/** A PACE Pro on the other end: it keeps one activity's pages, acks writes, and can be told to misbehave. */
function fakeWatch(folder: string) {
  const watch = {
    pages: Buffer.from(SOURCE), session: "1", acks: true, corrupt: false, writes: [] as Buffer[], enabled: true,
    device: { key: "COROS PACE Pro AB12", name: "PACE Pro", model: "PACE Pro", firmware: "V 3.2008.0" } as Device | null,
    /** Files in the folder at the moment each write reached the watch. */
    onDiskAtWrite: [] as string[][],
  };
  const screens = new ActivityScreens({
    enabled: () => watch.enabled, folder,
    link: () => ({ device: watch.device, session: watch.session }),
    exchange: async (op, payload) => {
      if (op === "read") return payload[0] === 255 ? Buffer.from([0, 4, 64]) : Buffer.from(watch.pages);
      watch.onDiskAtWrite.push(readdirSync(folder));
      watch.writes.push(Buffer.from(payload));
      if (!watch.acks) return Buffer.from([0]);
      watch.pages = watch.corrupt ? Buffer.concat([payload.subarray(0, -1), Buffer.from([payload.at(-1)! ^ 1])]) : Buffer.from(payload);
      return Buffer.from([1]);
    },
  });
  return { watch, screens };
}
const temp = () => mkdtempSync(path.join(tmpdir(), "clink-activity-"));

describe("activity screens", () => {
  it("reads, then syncs the baseline with a backup and journal on disk before the write, and clears the journal after", async () => {
    const folder = temp();
    const { watch, screens } = fakeWatch(folder);
    expect((await screens.sports()).map((s) => s.name)).toEqual(["Run", "Bike"]);
    const doc = await screens.read(0);
    expect(doc.baseline).toBe("unverified");
    const { document, backup } = await screens.syncBaseline(doc.id);
    expect(watch.onDiskAtWrite[0]).toEqual(expect.arrayContaining([`${backup.id}.json`, "pending-restore.json"]));
    expect(existsSync(path.join(folder, "pending-restore.json"))).toBe(false);
    expect(document.baseline).toBe("read-back-verified");
    expect(watch.writes[0].equals(SOURCE)).toBe(true);
  });

  it("needs the baseline for any layout and its confirmation for experimental ones", async () => {
    const { watch, screens } = fakeWatch(temp());
    const doc = await screens.read(0);
    expect(() => screens.preview(doc.id, 1, 5)).toThrow(/Confirm the standard pages/);
    const four = screens.preview(doc.id, 1, 4);
    await expect(screens.apply(four.id)).rejects.toThrow(/Sync the unchanged pages first/);
    const { document } = await screens.syncBaseline(doc.id);
    expect(() => screens.preview(document.id, 1, 7)).toThrow(/Confirm/);
    const confirmed = await screens.confirmBaseline(document.id);
    expect(confirmed.baseline).toBe("watch-confirmed");
    const seven = screens.preview(confirmed.id, 1, 7);
    expect(seven).toMatchObject({ experimental: true, page: { fieldCount: 7 } });
    const done = await screens.apply(seven.id);
    expect(done.document.baseline).toBe("watch-confirmed");
    expect(watch.pages.equals(buildLayout(SOURCE, 0, 1, 7))).toBe(true);
    // An experimental capture can't become the baseline again, or go to nine fields, until the standard pages are back.
    await expect(screens.syncBaseline(done.document.id)).rejects.toThrow(/experimental layout/);
    expect(() => screens.preview(done.document.id, 2, 9)).toThrow(/Restore the standard backup/);
  });

  it("keeps the journal after a failed write, and allows only that restore until it's done", async () => {
    const folder = temp();
    const { watch, screens } = fakeWatch(folder);
    const doc = await screens.read(0);
    watch.corrupt = true;
    const failed = await screens.syncBaseline(doc.id).catch((e: Error) => e);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toMatch(/read back differ.*restore it before another write/);
    const { pendingRestore } = await screens.status();
    expect(pendingRestore).not.toBeNull();
    watch.corrupt = false;
    const again = await screens.read(0);
    await expect(screens.syncBaseline(again.id)).rejects.toThrow(/Restore the interrupted sync/);
    const restored = await screens.restore(pendingRestore!.id);
    expect(restored.document.baseline).toBe("unverified");
    expect(watch.pages.equals(SOURCE)).toBe(true);
    expect((await screens.status()).pendingRestore).toBeNull();
  });

  it("refuses a write the watch doesn't acknowledge, a changed connection, other watches, stale reads and damaged backups", async () => {
    const folder = temp();
    const { watch, screens } = fakeWatch(folder);
    const doc = await screens.read(0);
    watch.session = "2";
    await expect(screens.syncBaseline(doc.id)).rejects.toThrow(/Read the watch's pages again/);
    const fresh = await screens.read(0);
    watch.acks = false;
    await expect(screens.syncBaseline(fresh.id)).rejects.toThrow(/didn't take/);
    watch.device = { ...watch.device!, model: "PACE 3" };
    await expect(screens.read(0)).rejects.toThrow(/PACE Pro/);
    watch.device = null;
    await expect(screens.sports()).rejects.toThrow(/PACE Pro/);
    watch.enabled = false;
    await expect(screens.read(0)).rejects.toThrow(/developer mode/);
    watch.enabled = true;
    watch.device = { key: "COROS PACE Pro AB12", name: "PACE Pro", model: "PACE Pro", firmware: "V 3.2008.0" };
    const id = "00000000-0000-4000-8000-000000000000";
    writeFileSync(path.join(folder, `${id}.json`), JSON.stringify({ version: 1, backup: { id }, payloadHex: "zz" }));
    expect((await screens.backups()).some((b) => b.id === id)).toBe(false);
    await expect(screens.restore(id)).rejects.toThrow(/damaged/);
  });

  it("answers its routes only for the app's own pages and only in developer mode", async () => {
    const { watch, screens } = fakeWatch(temp());
    const post = (route: string, body: unknown, hub = true) => screens.answer(new Request(`clink://app/api/desktop/developer/activity-screens${route}`, { method: "POST", headers: hub ? { "x-clink-hub": "1" } : {}, body: JSON.stringify(body) }));
    expect((await post("/read", { sportId: 0 }, false)).status).toBe(403);
    const read = (await (await post("/read", { sportId: 0 })).json()) as { document: { id: string; pages: unknown[] } };
    expect(read.document.pages).toHaveLength(4);
    const state = (await (await screens.answer(new Request("clink://app/api/desktop/developer/activity-screens"))).json()) as { ready: boolean };
    expect(state.ready).toBe(true);
    watch.enabled = false;
    expect((await post("/read", { sportId: 0 })).status).toBe(403);
  });
});
