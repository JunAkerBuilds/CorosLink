// Converting a face to another watch. CorosLink's scripts/test-watchface-conversion.cjs and the archive parts of
// scripts/test-recovered-watchface-conversion.cjs, with fixtures built in memory, and the "Must not regress" items of
// its replacement-checklist §5 as named tests.
import { describe, expect, it } from "vitest";
import { decodePng, encodePng } from "../compiler/png";
import { compileWatchface } from "../compiler/compiler";
import { decodeCorosLayout, findCorosBitmapBlocks, readLayoutHeaders } from "../corosBinLayout";
import { recoverCompiledCorosWatchface } from "../recoverBin";
import { compiledFixture } from "./testFixtures";
import { WATCHFACE_TARGETS, getWatchfaceTarget, watchfaceBinTarget, type WatchfaceTarget } from "../watchfaceTargets";
import { readZip } from "../zipRead";
import { buildsFromNativeLayout, buildWatchfaceArchive } from "./build";
import { parseCorosWatchfaceConfig } from "./config";
import {
  configKeysOf, convertWatchfaceEntries, isLocalTemplateId, localConversionCarrier, prepareRecoveredWatchfaceExport, RETAINED_AOD_CONFIG,
  scaleWatchfaceConfig, type WatchfaceConversionEntry as Entry,
} from "./conversion";

const png = (w: number, h: number, color = 180) =>
  encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => [color, 100, 20, 255][i % 4]!) });
const blankPng = (size: number) => encodePng({ width: size, height: size, data: new Uint8Array(size * size * 4) });
const sizeOf = (data: Buffer | undefined) => { const { width, height } = decodePng(data!); return { width, height }; };
const target = (model: string) => getWatchfaceTarget(model)!;
const map = (entries: Entry[]) => new Map(entries.map(e => [e.name, e.data]));
const cfg = (entries: Entry[], name: string) => map(entries).get(name)!.toString("utf8");
const parsed = (entries: Entry[], name: string) => parseCorosWatchfaceConfig(cfg(entries, name));
const crlf = (text: string) => Buffer.from(text.replace(/\n/g, "\r\n"));

function fixture(sizes: readonly number[], aod = true, id = "90071992547409931"): Entry[] {
  const entries: Entry[] = [
    { name: "info.json", data: Buffer.from(`{"o_template_id":${id},"o_diy_version":1,"o_wf_ver":4}`) },
    { name: "watchface_customize.png", data: png(80, 80) },
  ];
  for (const size of sizes) {
    const dir = `watchface_${size}x${size}`, k = size / 800;
    const config = `[watchface_id]=54\r\n[background_icon]=background.png\r\n[time_hour_high_pos]={${160 * k},${240 * k}}\r\n[time_hour_high_font]=digits\r\n[autoalign_time_digit_one_real_xsize]=${40 * k}\r\n[kcal_progress_arc]={${400 * k},${400 * k},${300 * k},${300 * k},-135,135,${20 * k},1}\r\n[time_hour_icon]=hands/hour.png\r\n[time_center_pos]={${400 * k},${400 * k}}\r\n`;
    entries.push({ name: `${dir}/config.txt`, data: Buffer.from(config) }, { name: `${dir}/background.png`, data: png(size, size) },
      { name: `${dir}/thmb.png`, data: png(80, 80) }, { name: `${dir}/hands/hour.png`, data: png(Math.round(20 * k), Math.round(160 * k)) });
    for (let n = 0; n < 10; n++) entries.push({ name: `${dir}/digits/${String(n).padStart(2, "0")}.png`, data: png(Math.round(40 * k), Math.round(80 * k), 150 + n) });
    if (aod) entries.push({ name: `${dir}/AODconfig.txt`, data: Buffer.from(config.replace("[time_hour_high_pos]", "[time_minute_high_pos]")) });
  }
  return entries;
}

/** An official template as a carrier: STANDARD with its own IDs. */
function carrier(sizes: readonly number[], templateId: string): Entry[] {
  const entries: Entry[] = [
    { name: "info.json", data: Buffer.from(`{"m_name":"STANDARD","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_default_language":"en","o_template_id":${templateId},"o_diy_version":1,"o_wf_ver":0}`) },
    { name: "watchface_customize.png", data: blankPng(800) },
  ];
  for (const size of sizes) {
    entries.push({ name: `watchface_${size}x${size}/background.png`, data: blankPng(size) },
      { name: `watchface_${size}x${size}/thmb.png`, data: blankPng(160) },
      { name: `watchface_${size}x${size}/config.txt`, data: Buffer.from(`[watchface_id]=0x0000002${sizes.indexOf(size)}\n[background_icon]=background.png\n`) });
  }
  return entries;
}

const source = fixture([416, 800]);

describe("scaleWatchfaceConfig", () => {
  it("scales geometry only", () => {
    expect(scaleWatchfaceConfig("[kcal_progress_arc]={400,400,300,300,-135,135,20,1}", 0.3)).toMatch(/\{120,120,90,90,-135,135,6,1\}/);
    expect(scaleWatchfaceConfig("[watchface_id]=800\n[chart_bar_width]=8\n[watchface_time_format]=1", 0.3))
      .toBe("[watchface_id]=800\n[chart_bar_width]=2\n[watchface_time_format]=1");
  });
});

describe("convertWatchfaceEntries", () => {
  it("converts to every supported watch with the carrier's identity", () => {
    const original = source.map(e => ({ name: e.name, data: Buffer.from(e.data) }));
    for (const destination of WATCHFACE_TARGETS) {
      const converted = convertWatchfaceEntries(source, fixture(destination.sizes, destination.display === "amoled", "90071992547409933"), destination);
      expect(cfg(converted.entries, "info.json")).toMatch(/90071992547409933/);
      expect(map(converted.entries).get("watchface_800x800/digits/00.png")).toEqual(map(source).get("watchface_800x800/digits/00.png"));
      for (const size of destination.sizes) {
        expect(cfg(converted.entries, `watchface_${size}x${size}/config.txt`)).toMatch(new RegExp(`\\{${Math.round(160 * size / 800)},${Math.round(240 * size / 800)}\\}`));
        expect(sizeOf(map(converted.entries).get(`watchface_${size}x${size}/hands/hour.png`))).toEqual({ width: Math.round(20 * size / 800), height: Math.round(160 * size / 800) });
      }
    }
    expect(source).toEqual(original);
  });

  it("converts from the 800 master: a converted output reconverted still scales from 800, never from the small tree", () => {
    const direct = convertWatchfaceEntries(source, source, target("pace-pro"));
    const viaPace3 = convertWatchfaceEntries(source, fixture(target("pace-3").sizes, false), target("pace-3"));
    // Spoil the small trees: a conversion that read them would carry this into the result.
    const spoiled = viaPace3.entries.map(e => /^watchface_(240|260|280)x/.test(e.name)
      ? /config\.txt$/.test(e.name) ? { ...e, data: Buffer.from(e.data.toString("utf8").replace(/\[time_hour_high_pos\]=[^\r\n]*/, "[time_hour_high_pos]={1,1}")) }
        : /\.png$/.test(e.name) ? { ...e, data: png(3, 3, 7) } : e
      : e);
    const back = convertWatchfaceEntries(spoiled, source, target("pace-pro"));
    expect(cfg(back.entries, "watchface_416x416/config.txt")).toBe(cfg(direct.entries, "watchface_416x416/config.txt"));
    for (const name of ["watchface_416x416/digits/00.png", "watchface_416x416/hands/hour.png", "watchface_800x800/digits/00.png"]) {
      expect(map(back.entries).get(name), name).toEqual(map(direct.entries).get(name));
    }
    expect(map(back.entries).get("watchface_800x800/digits/00.png")).toEqual(map(source).get("watchface_800x800/digits/00.png"));
  });

  it("keeps a dormant AOD as CorosLinkAODconfig.txt going AMOLED → MIP and restores it going MIP → AMOLED", () => {
    for (const destination of WATCHFACE_TARGETS.filter(t => t.display === "mip")) {
      const converted = convertWatchfaceEntries(source, fixture(destination.sizes, false, "90071992547409933"), destination);
      expect(converted.entries.some(e => /\/AODconfig\.txt$/.test(e.name))).toBe(false);
      expect(converted.entries.filter(e => e.name.endsWith(`/${RETAINED_AOD_CONFIG}`)).map(e => e.name)).toEqual([`watchface_800x800/${RETAINED_AOD_CONFIG}`]);
      const back = convertWatchfaceEntries(converted.entries, source, target("pace-pro"));
      expect(cfg(back.entries, "watchface_800x800/AODconfig.txt")).toBe(cfg(source, "watchface_800x800/AODconfig.txt"));
      expect(back.generatedAod).toBe(false);
      expect(map(back.entries).get("watchface_800x800/digits/00.png")).toEqual(map(source).get("watchface_800x800/digits/00.png"));
    }
  });

  it("rejects unknown geometry", () => {
    expect(() => scaleWatchfaceConfig("[unknown_shape]={10,20,30}", 0.3)).toThrow(/unrecognized geometry/);
    const odd = source.map(e => e.name === "watchface_800x800/config.txt" ? { ...e, data: Buffer.from(`${e.data.toString("utf8")}[unknown_shape]={10,20,30}\r\n`) } : e);
    expect(() => convertWatchfaceEntries(odd, source, target("pace-pro"))).toThrow(/unrecognized geometry \[unknown_shape\]/);
  });

  it("rejects compiled .pb/.bin data and drops stale cached builds", () => {
    const cachedBuilds = [...source, { name: "watchface_416x416/watchface.bin", data: Buffer.from("old compiled build") },
      { name: "watchface_416x416/watchface_ota.bin", data: Buffer.from("old OTA build") }];
    expect(convertWatchfaceEntries(cachedBuilds, source, target("pace-pro")).entries.some(e => e.name.endsWith(".bin"))).toBe(false);
    expect(() => convertWatchfaceEntries([...source, { name: "custom/custom.pb", data: Buffer.from("unknown compiled state") }], source, target("pace-pro"))).toThrow(/editable source/);
    expect(() => convertWatchfaceEntries([...source, { name: "watchface_800x800/face.bin", data: Buffer.from("x") }], source, target("pace-pro"))).toThrow(/compiled device data/);
  });

  it("refuses a source with no 800 master", () => {
    expect(() => convertWatchfaceEntries(fixture([416]), source, target("pace-4"))).toThrow(/no 800px master/);
  });

  it("folds a COROS-app photo into the background on every size", () => {
    const photoFace = [...source.map(e => /\/background\.png$/.test(e.name) ? { ...e, data: png(e.name.includes("800") ? 800 : 416, e.name.includes("800") ? 800 : 416, 0) } : e),
      { name: "custom/custom.pb", data: Buffer.from("0a080a06637573746f6d1a0d637573746f6d5f62672e706e67", "hex") }, { name: "custom/custom_bg.png", data: png(896, 896, 240) }];
    const converted = convertWatchfaceEntries(photoFace, fixture([416, 800], true, "90071992547409933"), target("pace-pro"));
    expect(converted.entries.some(e => e.name.startsWith("custom/"))).toBe(false);
    for (const size of [416, 800]) {
      const bg = decodePng(map(converted.entries).get(`watchface_${size}x${size}/background.png`)!);
      expect({ width: bg.width, height: bg.height }).toEqual({ width: size, height: size });
      expect(bg.data[(Math.floor(size / 2) * size + Math.floor(size / 2)) * 4]).toBe(240);
    }
  });

  it("moves raw edits into the master, rescaled, keeping CRLF lines", () => {
    const pace3 = target("pace-3"), pace3Carrier = fixture(pace3.sizes, false);
    const editPath = "watchface_416x416/config.txt";
    const raw = cfg(source, editPath).replace("[time_hour_high_pos]={83.2,124.80000000000001}", "[time_hour_high_pos]={104,156}");
    const edited = convertWatchfaceEntries(source, pace3Carrier, pace3, { [editPath]: raw });
    expect(edited.appliedRawConfigEditCount).toBe(1);
    expect(cfg(edited.entries, "watchface_800x800/config.txt")).toMatch(/\[time_hour_high_pos\]=\{200,300\}/);
    expect(cfg(edited.entries, "watchface_240x240/config.txt")).toMatch(/\[time_hour_high_pos\]=\{60,90\}/);
    const commented = source.map(e => e.name.endsWith("/config.txt") ? { ...e, data: Buffer.from("// layout\r\n[unused]=\r\n" + e.data.toString("utf8")) } : e);
    const rewritten = convertWatchfaceEntries(commented, pace3Carrier, pace3, { [editPath]: raw.replace("[time_hour_high_font]=digits", "[time_hour_high_font]=custom") });
    for (const size of pace3.sizes) {
      const text = cfg(rewritten.entries, `watchface_${size}x${size}/config.txt`);
      expect(text).not.toMatch(/\r(?!\n)/);
      const lines = text.split(/\r?\n/);
      expect(lines).toContain("[time_hour_high_font]=custom");
      expect(lines).toContain(`[time_hour_high_pos]={${Math.round(200 * size / 800)},${Math.round(300 * size / 800)}}`);
      expect(lines).toContain("[watchface_id]=54");
      expect(lines.some(line => line.startsWith("[unused]"))).toBe(false);
    }
    expect(() => convertWatchfaceEntries(source, pace3Carrier, pace3, { "watchface_390x390/config.txt": "[x]=1" })).toThrow(/does not belong/);
  });

  it("gives a MIP face going to AMOLED an editable AOD copied from Current", () => {
    const amoled = convertWatchfaceEntries(fixture([240, 260, 280, 800], false), source, target("pace-pro"));
    expect(amoled.generatedAod).toBe(true);
    expect(cfg(amoled.entries, "watchface_800x800/AODconfig.txt")).toBe(cfg(amoled.entries, "watchface_800x800/config.txt"));
  });

  it("isolates an AOD only the watch tree carries, with backslash paths", () => {
    const physicalAod = source.filter(e => e.name !== "watchface_800x800/AODconfig.txt");
    const derived = convertWatchfaceEntries(physicalAod, fixture(target("pace-3").sizes, false), target("pace-3"));
    expect(cfg(derived.entries, `watchface_800x800/${RETAINED_AOD_CONFIG}`)).toMatch(/cl_aod_source\\digits/);
    expect(map(derived.entries).has("watchface_800x800/cl_aod_source/digits/00.png")).toBe(true);
  });

  describe("faces whose watch trees hold more than the master", () => {
    const pace4 = target("pace-4");
    const twinSource: Entry[] = [
      { name: "info.json", data: Buffer.from('{"m_name":"Twin","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_template_id":1,"o_diy_version":1,"o_wf_ver":0}') },
      { name: "watchface_customize.png", data: blankPng(800) },
      { name: "watchface_800x800/background.png", data: blankPng(800) },
      { name: "watchface_800x800/config.txt", data: crlf("[watchface_id]=0x00000020\n[background_icon]=background.png\n[time_hour_high_pos]={200,300}\n") },
      // The thinned AOD Studio wrote for 800: positions only.
      { name: "watchface_800x800/AODconfig.txt", data: crlf("[watchface_id]=0x00000020\n[time_hour_high_pos]={200,300}\n") },
      { name: "watchface_416x416/background.png", data: blankPng(416) },
      { name: "watchface_416x416/aod_bg.png", data: blankPng(416) },
      { name: "watchface_416x416/config.txt", data: crlf("[watchface_id]=0x00000021\n[background_icon]=background.png\n[time_hour_high_pos]={104,156}\n[am_pm_icon_pos]=\n[am_icon]=\n[pm_icon]=\n") },
      { name: "watchface_416x416/AODconfig.txt", data: crlf("[watchface_id]=0x00000021\n[background_icon]=aod_bg.png\n[time_hour_high_pos]={104,156}\n") },
    ];
    const carrierEntries = carrier(pace4.sizes, "90071992547409950");

    it("prefers the complete watch-tree AOD over a thinned 800 copy", () => {
      const twin = convertWatchfaceEntries(twinSource, carrierEntries, pace4);
      expect(parsed(twin.entries, "watchface_390x390/AODconfig.txt").background_icon).toBe("cl_aod_source\\aod_bg.png");
      expect(twin.aodDesignScale).toBe(800 / 416);
      expect(parsed(twin.entries, "watchface_390x390/config.txt").am_icon).toBe("");
    });

    it("keeps an intact 800 AOD although the watch tree declares more keys", () => {
      const intact = convertWatchfaceEntries([
        ...twinSource.filter(e => !/AODconfig/.test(e.name)),
        { name: "watchface_800x800/aod_bg.png", data: blankPng(800) },
        { name: "watchface_800x800/AODconfig.txt", data: crlf("[watchface_id]=0x00000020\n[background_icon]=aod_bg.png\n[time_hour_high_pos]={200,300}\n") },
        { name: "watchface_416x416/AODconfig.txt", data: crlf("[watchface_id]=0x00000021\n[background_icon]=aod_bg.png\n[time_hour_high_pos]={104,156}\n[am_pm_icon_pos]={10,10}\n[am_icon]=icon\\am.png\n[pm_icon]=icon\\pm.png\n[battery_icon_lowpower]=battery\\lowpower.png\n") },
      ], carrierEntries, pace4);
      expect(intact.aodDesignScale).toBe(1);
      expect(parsed(intact.entries, "watchface_390x390/AODconfig.txt").background_icon).toBe("aod_bg.png");
      expect(intact.entries.some(e => e.name.includes("/cl_aod_source/"))).toBe(false);
    });

    it("invents no AOD when not wanted, and does by default", () => {
      const without = twinSource.filter(e => !/AODconfig/.test(e.name));
      const noAod = convertWatchfaceEntries(without, carrierEntries, pace4, {}, false);
      expect(noAod.entries.some(e => /AODconfig\.txt$/.test(e.name))).toBe(false);
      expect(noAod.generatedAod).toBe(false);
      expect(convertWatchfaceEntries(without, carrierEntries, pace4).generatedAod).toBe(true);
    });

    it("keeps a native animation on Current only", () => {
      const masterAnimated = convertWatchfaceEntries([
        ...twinSource.filter(e => !/AODconfig/.test(e.name) && !/800x800\/config/.test(e.name)),
        ...Array.from({ length: 3 }, (_, i) => ({ name: `watchface_800x800/cl_animation_03/0${i}.png`, data: png(80, 60, 200) })),
        { name: "watchface_800x800/config.txt", data: crlf("[watchface_id]=0x00000020\n[background_icon]=background.png\n[time_hour_high_pos]={200,300}\n[cl_animation_pos]={10,20}\n[cl_animation_dir]=cl_animation_03\n[cl_animation_delays_ms]=100,100,100\n") },
      ], carrierEntries, pace4);
      expect(masterAnimated.generatedAod).toBe(true);
      for (const size of pace4.sizes) {
        expect(cfg(masterAnimated.entries, `watchface_${size}x${size}/config.txt`)).toMatch(/\[cl_animation_dir\]=cl_animation_03/);
        expect(cfg(masterAnimated.entries, `watchface_${size}x${size}/AODconfig.txt`)).not.toMatch(/cl_animation/);
      }
    });

    it("takes a key a smaller tree draws over a larger tree's blank, with its image", () => {
      const tiered = convertWatchfaceEntries([
        ...twinSource.filter(e => !/AODconfig|416x416\/config/.test(e.name)),
        { name: "watchface_416x416/config.txt", data: crlf("[watchface_id]=0x00000021\n[background_icon]=background.png\n[colon_icon]=\n") },
        // Same file name in the larger tree, other artwork at another size: not the colon this key draws.
        { name: "watchface_416x416/colon.png", data: blankPng(40) },
        { name: "watchface_260x260/background.png", data: blankPng(260) },
        { name: "watchface_260x260/colon.png", data: blankPng(13) },
        { name: "watchface_260x260/config.txt", data: crlf("[watchface_id]=0x00000022\n[background_icon]=background.png\n[colon_icon]=colon.png\n[colon_icon_pos]={130,65}\n") },
      ], carrierEntries, pace4);
      const config = parsed(tiered.entries, "watchface_390x390/config.txt");
      expect(config.colon_icon).toBe("colon.png");
      expect(config.colon_icon_pos).toBe(`{${Math.round(130 * 390 / 260)},${Math.round(65 * 390 / 260)}}`);
      expect(sizeOf(map(tiered.entries).get("watchface_390x390/colon.png")).width).toBe(Math.round(13 * 390 / 260));
    });
  });
});

describe("prepareRecoveredWatchfaceExport", () => {
  const recovered = fixture([416]).map(e => e.name === "info.json"
    ? { ...e, data: Buffer.from('{"m_name":"Recovered $ face","o_template_id":"478450947264200704","o_diy_version":1,"o_wf_ver":4,"coroslinkRecovery":{"partial":true}}') } : e)
    .filter(e => !e.name.endsWith("/thmb.png"));
  recovered.push({ name: "recovery/source.bin", data: Buffer.from("original firmware") }, { name: "recovery/layout.json", data: Buffer.from("{}") });

  it("exports a recovered face to every watch on the carrier's template", () => {
    const original = structuredClone(recovered);
    for (const destination of WATCHFACE_TARGETS) {
      const built = prepareRecoveredWatchfaceExport(recovered, fixture(destination.sizes, true, "90071992547409933"), destination);
      const manifest = JSON.parse(cfg(built, "info.json").replace(/("o_template_id":)(\d+)/, '$1"$2"')) as Record<string, unknown>;
      expect(manifest.o_template_id).toBe("90071992547409933");
      expect(manifest.m_name).toBe("Recovered $ face");
      expect(manifest.m_app).toBe("watchface_800x800");
      expect(manifest.m_preview).toBe("watchface_customize.png");
      expect(manifest.coroslinkRecovery).toBeUndefined();
      expect(built.some(e => e.name.startsWith("recovery/"))).toBe(false);
      for (const size of destination.sizes) {
        expect(cfg(built, `watchface_${size}x${size}/config.txt`)).toMatch(/\[watchface_thmb_icon\]=thmb.png/);
        expect(sizeOf(map(built).get(`watchface_${size}x${size}/background.png`)).width).toBe(size);
        expect(sizeOf(map(built).get(`watchface_${size}x${size}/thmb.png`)).width).toBe(80);
      }
      if (destination.model === "pace-pro") {
        expect(map(built).get("watchface_416x416/digits/00.png")).toEqual(map(recovered).get("watchface_416x416/digits/00.png"));
        expect(cfg(built, "watchface_416x416/config.txt")).toMatch(/\{83.2,124.80000000000001\}/);
      }
    }
    expect(structuredClone(recovered)).toEqual(original);
  });

  it("rewrites forward-slash recovered references with backslashes", () => {
    const legacy = recovered.map(e => e.name === "watchface_416x416/config.txt"
      ? { ...e, data: Buffer.from(e.data.toString("utf8").replace("[time_hour_high_font]=digits", "[time_hour_high_font]=recovered/group-15\r\n[arc_cut_icon]=recovered/group-14/00.png")) } : e);
    const config = cfg(prepareRecoveredWatchfaceExport(legacy, fixture([416, 800], true, "90071992547409933"), target("pace-pro")), "watchface_416x416/config.txt");
    expect(config).toMatch(/\[time_hour_high_font\]=recovered\\group-15/);
    expect(config).toMatch(/\[arc_cut_icon\]=recovered\\group-14\\00\.png/);
  });

  it("refuses faces with a master and unexpected compiled data", () => {
    expect(() => prepareRecoveredWatchfaceExport(source, source, target("pace-pro"))).toThrow(/Only a recovered/);
    expect(() => prepareRecoveredWatchfaceExport([...recovered, { name: "unexpected.bin", data: Buffer.from("x") }], source, target("pace-pro"))).toThrow(/editable source/);
  });

  it("scales a face recovered from a BIN straight from its native tree", () => {
    const zip = recoverCompiledCorosWatchface(compiledFixture(), "Fixture", "90071992547409931").zip;
    const entries = readZip(zip).filter(e => !e.directory).map(e => ({ name: e.path, data: e.read() }));
    const [nativeX, nativeY] = parsed(entries, "watchface_416x416/config.txt").time_hour_high_pos!.match(/-?\d+/g)!.map(Number);
    const pace4 = target("pace-4");
    const built = prepareRecoveredWatchfaceExport(entries, carrier(pace4.sizes, "9007199254740902"), pace4);
    expect(built.some(e => e.name.startsWith("recovery/") || /\.bin$/i.test(e.name))).toBe(false);
    const scaled = parsed(built, "watchface_390x390/config.txt");
    expect(scaled.time_hour_high_pos).toBe(`{${Math.round(nativeX! * 390 / 416)},${Math.round(nativeY! * 390 / 416)}}`);
    expect(scaled.watchface_id).toBe("0x00000020");
    expect(cfg(built, "info.json")).toMatch(/"o_template_id":9007199254740902\b/);
    expect(cfg(built, "info.json")).toMatch(/"m_name":"Fixture"/);
    expect(sizeOf(map(built).get("watchface_390x390/background.png")).width).toBe(390);
    expect(sizeOf(map(built).get("watchface_390x390/thmb.png")).width).toBe(160);
    const nomad = target("nomad");
    const mip = prepareRecoveredWatchfaceExport(entries, carrier(nomad.sizes, "9007199254740903"), nomad);
    expect([...new Set(mip.flatMap(e => e.name.match(/^watchface_(\d+)x\1\/config\.txt$/)?.[1] ?? []))].map(Number).sort((a, b) => a - b)).toEqual([...nomad.sizes]);
  });

  it("converts a native sprite animation once, and the BIN gets the record", () => {
    const paceProTarget = target("pace-pro");
    const animated: Entry[] = [
      { name: "info.json", data: Buffer.from('{"m_name":"Run","m_app":"watchface_390x390","m_preview":"watchface_customize.png","o_template_id":1,"o_diy_version":1,"o_wf_ver":4,"coroslinkRecovery":{"partial":true}}') },
      { name: "watchface_customize.png", data: blankPng(390) },
      { name: "watchface_390x390/background.png", data: blankPng(390) },
      ...Array.from({ length: 10 }, (_, i) => ({ name: `watchface_390x390/recovered/group-22/${String(i).padStart(2, "0")}.png`, data: png(376, 340, 200) })),
      { name: "watchface_390x390/config.txt", data: crlf("[watchface_id]=1000001880\n[background_icon]=background.png\n[background_icon_pos]={0,0}\n[cl_animation_pos]={0,31}\n[cl_animation_dir]=recovered\\group-22\n[cl_animation_delays_ms]=70,100,100,100,100,100,100,100,100,260\n") },
    ];
    const converted = prepareRecoveredWatchfaceExport(animated, carrier(paceProTarget.sizes, "90071992547409950"), paceProTarget);
    expect(parsed(converted, "watchface_416x416/config.txt").cl_animation_pos).toBe("{0,33}");
    expect(parsed(converted, "watchface_416x416/config.txt").cl_animation_delays_ms).toBe("70,100,100,100,100,100,100,100,100,260");
    expect(parsed(converted, "watchface_800x800/config.txt").cl_animation_pos).toBe("{0,64}");
    const frames = converted.filter(e => e.name.startsWith("watchface_416x416/recovered/group-22/"));
    expect(frames).toHaveLength(10);
    expect([...new Set(frames.map(e => { const { width, height } = sizeOf(e.data); return `${width}x${height}`; }))]).toEqual(["401x363"]);
    const { bin, warnings } = compileWatchface(new Map(converted.map(e => [e.name, e.data])), { faceId: 1, target: watchfaceBinTarget(paceProTarget) });
    expect(bin.toString("latin1", 0, 4)).toBe("614A");
    const headers = readLayoutHeaders(bin);
    const layout = decodeCorosLayout(bin, findCorosBitmapBlocks(bin, Math.max(...headers.map(header => header.offset + header.length))));
    expect(layout.modes[0]!.animation!.slots.map(slot => [slot.position.x, slot.position.y, slot.frameCount, slot.width, slot.height]), warnings.join("; "))
      .toEqual([[0, 33, 10, 401, 363]]);
    expect(layout.modes[0]!.animation!.delays).toEqual([70, 100, 100, 100, 100, 100, 100, 100, 100, 260]);
    expect(layout.modes[1]?.animation).toBeUndefined();
  });
});

describe("building from a face's own layout", () => {
  const recovered = () => recoverCompiledCorosWatchface(compiledFixture(), "Fixture", "90071992547409931").zip;
  const input = { backgroundDataUrl: `data:image/png;base64,${png(800, 800, 30).toString("base64")}` };
  const files = (zip: Buffer) => readZip(zip).filter(e => !e.directory).map(e => ({ name: e.path, data: e.read() }));

  it("says which faces build from their own layout", () => {
    const pacePro = target("pace-pro"), pace4 = target("pace-4");
    expect(buildsFromNativeLayout({ recoveredFromCompiled: true, resolutionDirectories: ["watchface_416x416"] }, pacePro, pacePro)).toBe(true);
    expect(buildsFromNativeLayout({ resolutionDirectories: ["watchface_416x416", "watchface_800x800"] }, pacePro, pacePro)).toBe(false);
    expect(buildsFromNativeLayout({ resolutionDirectories: ["watchface_416x416", "watchface_800x800"] }, pace4, pacePro)).toBe(false);
    // A COROS-app face carries only its watch's layout.
    expect(buildsFromNativeLayout({ resolutionDirectories: ["watchface_416x416"] }, pacePro, pacePro)).toBe(true);
    expect(buildsFromNativeLayout({ resolutionDirectories: ["watchface_416x416"] }, pace4, pacePro)).toBe(true);
  });

  it("builds a face recovered from a BIN for its own watch and another, on the carrier's template", () => {
    const zip = recovered();
    expect(() => buildWatchfaceArchive(zip, input)).toThrow(/Choose a watch/);
    const [nativeX, nativeY] = parsed(files(zip), "watchface_416x416/config.txt").time_hour_high_pos!.match(/-?\d+/g)!.map(Number);
    for (const destination of [target("pace-pro"), target("pace-4"), target("apex-4")]) {
      const built = files(buildWatchfaceArchive(zip, input, { target: destination, carrier: carrier(destination.sizes, "9007199254740902") }));
      expect(built.some(e => e.name.startsWith("recovery/") || /\.bin$/i.test(e.name))).toBe(false);
      expect(cfg(built, "info.json")).toMatch(/"o_template_id":9007199254740902\b/);
      const trees = [...new Set(built.flatMap(e => e.name.match(/^watchface_(\d+)x\1\/config\.txt$/)?.[1] ?? []))].map(Number).sort((a, b) => a - b);
      expect(trees).toEqual([...destination.sizes].sort((a, b) => a - b));
      for (const size of destination.sizes) {
        // The edited background is drawn from the 800 px render at every size.
        const background = decodePng(map(built).get(`watchface_${size}x${size}/background.png`)!);
        expect([background.width, background.data[0]]).toEqual([size, 30]);
        expect(parsed(built, `watchface_${size}x${size}/config.txt`).watchface_id).toBe(`0x0000002${(destination.sizes as readonly number[]).indexOf(size)}`);
      }
      const small = destination.sizes[0]!;
      expect(parsed(built, `watchface_${small}x${small}/config.txt`).time_hour_high_pos).toBe(`{${Math.round(nativeX! * small / 416)},${Math.round(nativeY! * small / 416)}}`);
      // The full preview, not the recovered thumbnail.
      expect(sizeOf(map(built).get("watchface_customize.png"))).toEqual({ width: 800, height: 800 });
    }
  });

  it("keeps an untouched template background and refuses identity overrides", () => {
    const zip = recovered(), pace4 = target("pace-4");
    const native = { target: pace4, carrier: carrier(pace4.sizes, "9007199254740902") };
    const kept = files(buildWatchfaceArchive(zip, { ...input, keepTemplateBackground: true }, native));
    const own = decodePng(map(files(zip)).get("watchface_416x416/background.png")!);
    expect(decodePng(map(kept).get("watchface_390x390/background.png")!).data[0]).toBe(own.data[0]);
    expect(() => buildWatchfaceArchive(zip, { ...input, templateIdOverride: "12" }, native)).toThrow(/template identity/);
  });
});

describe("carriers", () => {
  it("builds a local carrier with template ID 0 and every size", () => {
    for (const destination of WATCHFACE_TARGETS as readonly WatchfaceTarget[]) {
      const local = localConversionCarrier(destination);
      expect(cfg(local, "info.json")).toMatch(/"o_template_id":0\b/);
      for (const size of destination.sizes) expect(map(local).has(`watchface_${size}x${size}/config.txt`)).toBe(true);
      const converted = convertWatchfaceEntries(source, local, destination);
      expect(cfg(converted.entries, "info.json")).toMatch(/"o_template_id":0\b/);
    }
    expect(isLocalTemplateId("0")).toBe(true);
    expect(isLocalTemplateId("90071992547409933")).toBe(false);
  });

  it("lists the keys a face sets, not its blank declarations", () => {
    const keys = configKeysOf([{ name: "watchface_800x800/config.txt", data: crlf("[Weather_Icon]=w\n[am_icon]=\n") }, { name: "info.json", data: Buffer.from("[x]=1") }]);
    expect([...keys]).toEqual(["weather_icon"]);
  });
});
