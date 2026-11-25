// The conversion service: carriers picked from the destination's templates, kept for offline use, the local carrier
// when there's nothing else, and the carrier's template ID kept as raw text. From the service parts of CorosLink's
// scripts/test-watchface-conversion.cjs, with fake template providers in place of COROS.
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../../watchface/compiler/png";
import { RETAINED_AOD_CONFIG } from "../../watchface/archive/template";
import { getWatchfaceTarget, type WatchfaceTarget } from "../../watchface/watchfaceTargets";
import { readZip } from "../../watchface/zipRead";
import { createStoreZip } from "../../watchface/zipStore";
import { isLocalTemplateId, WatchfaceConverter, type CarrierTemplates } from "./convert";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-convert-"));
const png = (size: number) => encodePng({ width: size, height: size, data: new Uint8Array(size * size * 4).fill(200) });
const target = (model: string) => getWatchfaceTarget(model)!;
const files = (zip: Buffer) => new Map(readZip(zip).filter(e => !e.directory).map(e => [e.path, e.read()]));

/** A face (or a template) with the given trees; `extra` keys go in every config. */
function archive(sizes: readonly number[], templateId: string, extra = "", aod = true): Buffer {
  const entries = [
    { name: "info.json", data: Buffer.from(`{"m_name":"Face","o_template_id":${templateId},"o_diy_version":1,"o_wf_ver":2}`) },
    { name: "watchface_customize.png", data: png(40) },
  ];
  for (const size of sizes) {
    const dir = `watchface_${size}x${size}`, k = size / 800;
    const config = `[watchface_id]=${size}\r\n[background_icon]=background.png\r\n[time_hour_high_pos]={${Math.round(160 * k)},${Math.round(240 * k)}}\r\n${extra}`;
    entries.push({ name: `${dir}/config.txt`, data: Buffer.from(config) }, { name: `${dir}/background.png`, data: png(size) });
    if (aod) entries.push({ name: `${dir}/AODconfig.txt`, data: Buffer.from(config) });
  }
  return createStoreZip(entries);
}

class FakeCatalog implements CarrierTemplates {
  downloads: string[] = [];
  listed = 0;
  constructor(private readonly packages: Map<string, { name: string; bytes: Buffer }>, private readonly offline = false) {}
  async templates() {
    this.listed++;
    if (this.offline) throw new Error("offline");
    return [...this.packages].map(([id, { name }]) => ({ id, name }));
  }
  async download(_target: WatchfaceTarget, id: string) {
    this.downloads.push(id);
    return this.packages.get(id)!.bytes;
  }
}

const source = archive([416, 800], "478947569257513340", "[weather_icon_pos]={10,10}\r\n[weather_icon]=weather\r\n");

describe("WatchfaceConverter", () => {
  it("picks the template that covers the face's keys and keeps its ID as raw text", async () => {
    const pace3 = target("pace-3");
    const catalog = new FakeCatalog(new Map([
      ["1", { name: "BOLD", bytes: archive(pace3.sizes, "90071992547409931", "", false) }],
      ["2", { name: "SPORT", bytes: archive(pace3.sizes, "90071992547409933", "[weather_icon_pos]=\r\n[weather_icon]=\r\n", false) }],
      // Missing a PACE 3 tree: never a carrier.
      ["0", { name: "SIMPLE", bytes: archive([240, 800], "5", "[weather_icon_pos]=\r\n[weather_icon]=\r\n", false) }],
    ]));
    const dir = folder();
    const converted = await new WatchfaceConverter(dir, catalog).convert(source, pace3);
    expect(converted.sourceTemplateId).toBe("90071992547409933");
    expect(Number(converted.sourceTemplateId).toString()).not.toBe(converted.sourceTemplateId);
    expect(isLocalTemplateId(converted.sourceTemplateId)).toBe(false);
    expect(catalog.downloads).toEqual(["0", "1", "2"]);
    const out = files(converted.starter);
    expect(out.get("info.json")!.toString()).toMatch(/"o_template_id":90071992547409933\b/);
    expect(out.get("watchface_240x240/config.txt")!.toString()).toMatch(/\[time_hour_high_pos\]=\{48,72\}/);
    expect(out.get("watchface_240x240/config.txt")!.toString()).toMatch(/\[watchface_id\]=240/);
    expect(out.has(`watchface_800x800/${RETAINED_AOD_CONFIG}`)).toBe(true);
    expect(converted.generatedAod).toBe(false);
    expect(converted.aodDesignScale).toBe(1);
    expect(files(fs.readFileSync(path.join(dir, "carriers", "pace-3.zip"))).get("info.json")!.toString()).toMatch(/90071992547409933/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "carriers", "pace-3.carrier.json"), "utf8"))).toMatchObject({ scanned: true });

    // Cached and scanned: the next conversion doesn't ask the catalog.
    const again = new FakeCatalog(new Map());
    expect((await new WatchfaceConverter(dir, again).convert(source, pace3)).sourceTemplateId).toBe("90071992547409933");
    expect(again.listed).toBe(0);
  });

  it("rescans an unscanned cache that lacks the face's keys, and uses it when the scan fails", async () => {
    const pace4 = target("pace-4"), dir = folder();
    fs.mkdirSync(path.join(dir, "carriers"));
    fs.writeFileSync(path.join(dir, "carriers", "pace-4.zip"), archive(pace4.sizes, "111", "", false));
    const offline = new FakeCatalog(new Map(), true);
    const converted = await new WatchfaceConverter(dir, offline).convert(source, pace4);
    expect(offline.listed).toBe(1);
    expect(converted.sourceTemplateId).toBe("111");

    const online = new FakeCatalog(new Map([["7", { name: "BOLD", bytes: archive(pace4.sizes, "222", "[weather_icon_pos]=\r\n[weather_icon]=\r\n", false) }]]));
    expect((await new WatchfaceConverter(dir, online).convert(source, pace4)).sourceTemplateId).toBe("222");

    // A cache that already declares every key is used without a scan.
    const quiet = new FakeCatalog(new Map());
    fs.rmSync(path.join(dir, "carriers", "pace-4.carrier.json"));
    expect((await new WatchfaceConverter(dir, quiet).convert(source, pace4)).sourceTemplateId).toBe("222");
    expect(quiet.listed).toBe(0);
  });

  it("falls back to a local carrier, never cached, with nothing else", async () => {
    const pacePro = target("pace-pro"), dir = folder();
    for (const catalog of [undefined, new FakeCatalog(new Map(), true), new FakeCatalog(new Map())]) {
      const converted = await new WatchfaceConverter(dir, catalog).convert(source, pacePro);
      expect(isLocalTemplateId(converted.sourceTemplateId)).toBe(true);
      expect(files(converted.starter).has("watchface_416x416/AODconfig.txt")).toBe(true);
    }
    expect(fs.existsSync(path.join(dir, "carriers", "pace-pro.zip"))).toBe(false);
  });

  it("applies raw edits and reports them", async () => {
    const converted = await new WatchfaceConverter(folder()).convert(source, target("pace-4"), {
      configTextEdits: { "watchface_416x416/config.txt": files(source).get("watchface_416x416/config.txt")!.toString().replace(/\[time_hour_high_pos\]=[^\r\n]*/, "[time_hour_high_pos]={104,156}") },
    });
    expect(converted.appliedRawConfigEditCount).toBe(1);
    expect(files(converted.starter).get("watchface_800x800/config.txt")!.toString()).toMatch(/\[time_hour_high_pos\]=\{200,300\}/);
  });

  it("generates an AOD for an AMOLED watch only when asked", async () => {
    const mip = archive([240, 260, 280, 800], "1", "", false), converter = new WatchfaceConverter(folder());
    expect((await converter.convert(mip, target("pace-pro"))).generatedAod).toBe(true);
    const without = await converter.convert(mip, target("pace-pro"), { generateAod: false });
    expect(without.generatedAod).toBe(false);
    expect([...files(without.starter).keys()].some(name => name.endsWith("AODconfig.txt"))).toBe(false);
  });

  it("refuses a face with no 800 master, compiled data and oversized archives", async () => {
    const converter = new WatchfaceConverter(folder());
    await expect(converter.convert(archive([416], "1"), target("pace-4"))).rejects.toThrow("This face has no 800 px master, so it can't be converted yet.");
    const compiled = createStoreZip([...files(source)].map(([name, data]) => ({ name, data })).concat({ name: "custom/custom.pb", data: Buffer.from("x") }));
    await expect(converter.convert(compiled, target("pace-4"))).rejects.toThrow(/compiled device data/);
    await expect(converter.convert(Buffer.alloc(0), target("pace-4"))).rejects.toThrow(/100 MB/);
  });
});
