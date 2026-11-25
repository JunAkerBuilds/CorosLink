// The official asset library's rules, from CorosLink's replacement checklist §5 ("Official asset library: R2
// coroslink-assets.akerrules.ca/official-faces, refresh 24 h, 4 downloads at once, local-build fallback"; "Official
// archive ≤25 MB") and docs/watchface-asset-library.md: one host, no redirects, capped answers, a cache that refreshes
// daily, and a library built here from COROS's official faces when the hosted one can't be reached.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compileWatchface } from "../../watchface/compiler/compiler";
import { encodePng } from "../../watchface/compiler/png";
import { officialCategory, officialCategoryForConfigKey, officialFontRole, officialTags } from "../../watchface/officialAssetSets";
import { officialStrip } from "../../watchface/officialFaceSets";
import { createStoreZip } from "../../watchface/zipStore";
import { uploadsToCoros } from "../dataMode";
import {
  Limiter, MAX_OFFICIAL_ARCHIVE, OFFICIAL_DOWNLOADS_AT_ONCE, OFFICIAL_LIBRARY_URL, OFFICIAL_REFRESH_MS, OfficialAssetLibrary, parseOfficialLibrary,
} from "./officialAssets";
import { WatchfaceStudio } from "./studio";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-official-"));
const png = (w: number, h: number, rgba: [number, number, number, number] = [255, 255, 255, 255]) =>
  encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => rgba[i % 4]) });
const WATCH = "COROS W332";
const HOST = "https://library.test/official-faces";

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id, category: "fonts", role: "time", width: 20, height: 30, frames: 10, encoding: "0x2002", elementIds: ["time.hourHigh"],
  configKeys: ["time_hour_high_font"], faces: ["RIDGE"], faceCount: 4, strip: { width: 86, height: 94 }, ...over,
});
const ASSETS = [
  asset("a".repeat(16)),
  asset("b".repeat(16), { role: "weather", configKeys: ["weather_temp_font"], elementIds: ["weather.temperature"], faces: ["STORM"] }),
  asset("c".repeat(16), { category: "battery", role: undefined, frames: 12, width: 40, height: 20, configKeys: ["battery_icon_dir"], elementIds: ["battery.icon"] }),
  asset("d".repeat(16), { category: "weather", role: undefined, frames: 41, width: 60, height: 60, configKeys: ["weather_icon_dir"], elementIds: ["weather.icon"] }),
  asset("e".repeat(16), { category: "weather", role: undefined, frames: 41, width: 60, height: 60, configKeys: ["weather_dark_icon_dir"], elementIds: ["weather.icon"] }),
  asset("f".repeat(16), { category: "status", role: undefined, frames: 1, width: 24, height: 24, configKeys: ["bluetooth_on_icon"], elementIds: ["bluetooth.on"], faces: ["HERALDIC"] }),
];
const library = (assets: unknown[] = ASSETS) => JSON.stringify({ version: 1, firmwareType: WATCH, builtAt: "2026-09-20T01:29:42.291Z", source: "hosted", faceCount: 331, failures: 0, assets });
const manifest = (index = "v1/models/COROS-W332/library.json") => JSON.stringify({ version: 1, models: { [WATCH]: { index } } });
const framesZip = (id: string, count: number, extra: { name: string; data: Buffer }[] = []) =>
  createStoreZip([...Array.from({ length: count }, (_, i) => ({ name: `${id}/${String(i).padStart(2, "0")}.png`, data: png(2, 3, [i, 0, 0, 255]) })), { name: `${id}/README.txt`, data: Buffer.from("© COROS") }, ...extra]);

/** The hosted library, faked: files by path, every request noted. */
function hosted(files: Record<string, string | Buffer | (() => Response | Promise<Response>)>) {
  const asked: { url: string; headers: Record<string, string>; redirect?: string }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), redirect: init?.redirect });
    const file = files[url.replace(`${HOST}/`, "")];
    if (file === undefined || !url.startsWith(`${HOST}/`)) return new Response("no", { status: 404 });
    if (typeof file === "function") return file();
    return new Response(new Uint8Array(Buffer.from(file)));
  }) as typeof globalThis.fetch;
  return { fetch, asked, paths: () => asked.map((a) => a.url.replace(`${HOST}/`, "")) };
}

const standard = () => ({ "v1/manifest.json": manifest(), "v1/models/COROS-W332/library.json": library() });

describe("the hosted library", () => {
  it("is the R2 library and nothing else", () => {
    expect(OFFICIAL_LIBRARY_URL).toBe("https://coroslink-assets.akerrules.ca/official-faces");
    expect(OFFICIAL_REFRESH_MS).toBe(24 * 60 * 60 * 1000);
    expect(OFFICIAL_DOWNLOADS_AT_ONCE).toBe(4);
    expect(MAX_OFFICIAL_ARCHIVE).toBe(25 * 1024 * 1024);
  });

  it("downloads a watch's index once, from its own host, with the client header and no redirects", async () => {
    const dir = folder(), net = hosted(standard());
    const lib = new OfficialAssetLibrary(dir, { fetch: net.fetch, url: HOST });
    expect(lib.ensure("pace-pro").state).toBe("loading");
    const status = await lib.settled("pace-pro");
    expect(status).toMatchObject({ state: "ready", source: "hosted", assetCount: 6, faceCount: 331 });
    expect(net.paths()).toEqual(["v1/manifest.json", "v1/models/COROS-W332/library.json"]);
    for (const request of net.asked) {
      expect(new URL(request.url).origin).toBe("https://library.test");
      expect(request.headers["x-coroslink-client"]).toMatch(/^coroslink\//);
      expect(request.redirect).toBe("error");
    }
    // Later visits, and the next start of the app, read the copy on disk.
    lib.ensure("pace-pro");
    const again = new OfficialAssetLibrary(dir, { fetch: net.fetch, url: HOST });
    expect(again.ensure(WATCH)).toMatchObject({ state: "ready", assetCount: 6 });
    await again.settled(WATCH);
    expect(net.asked).toHaveLength(2);
  });

  it("shows the first download's progress in bytes", async () => {
    const body = Buffer.from(library());
    const holder: { lib?: OfficialAssetLibrary } = {};
    const seen: number[] = [];
    const net = hosted({
      "v1/manifest.json": manifest(),
      "v1/models/COROS-W332/library.json": () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(body.subarray(0, 100)));
          setTimeout(() => { seen.push(holder.lib!.ensure(WATCH).done); controller.enqueue(new Uint8Array(body.subarray(100))); controller.close(); }, 5);
        },
      }), { headers: { "content-length": String(body.length) } }),
    });
    const lib = (holder.lib = new OfficialAssetLibrary(folder(), { fetch: net.fetch, url: HOST }));
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    expect(seen).toEqual([100]);
  });

  it("takes a gzip-wrapped index", async () => {
    const net = hosted({ "v1/manifest.json": manifest(), "v1/models/COROS-W332/library.json": gzipSync(Buffer.from(library())) });
    const lib = new OfficialAssetLibrary(folder(), { fetch: net.fetch, url: HOST });
    lib.ensure(WATCH);
    expect((await lib.settled(WATCH)).assetCount).toBe(6);
  });

  it("refuses an index path that leaves the library, an index for another watch and a malformed one", async () => {
    const cases: Record<string, string>[] = [
      { "v1/manifest.json": manifest("https://attacker.test/library.json") },
      { "v1/manifest.json": manifest("v1/models/../../secrets/library.json") },
      { "v1/manifest.json": manifest(), "v1/models/COROS-W332/library.json": library().replace(WATCH, "COROS W336") },
      { "v1/manifest.json": manifest(), "v1/models/COROS-W332/library.json": "{not json" },
      { "v1/manifest.json": JSON.stringify({ version: 2, models: {} }) },
    ];
    for (const files of cases) {
      const net = hosted(files);
      const lib = new OfficialAssetLibrary(folder(), { fetch: net.fetch, url: HOST });
      lib.ensure(WATCH);
      const status = await lib.settled(WATCH);
      expect(status.state).toBe("error");
      expect(status.message).toMatch(/couldn't be reached/);
      expect(net.asked.every((a) => a.url.startsWith(`${HOST}/`))).toBe(true);
    }
  });

  it("drops index entries that aren't sets", () => {
    const parsed = parseOfficialLibrary(library([asset("a".repeat(16)), asset("../../etc"), asset("b".repeat(16), { frames: 100000 }), asset("c".repeat(16), { width: 0 }), null, asset("d".repeat(16), { category: "made-up", role: "nope" })]), WATCH)!;
    expect(parsed.assets.map((a) => a.id)).toEqual(["a".repeat(16), "d".repeat(16)]);
    expect(parsed.assets[1]).toMatchObject({ category: "other" });
    expect(parsed.assets[1].role).toBeUndefined();
  });

  it("refreshes a day-old index in the background and keeps serving the old one", async () => {
    let now = Date.parse("2026-11-23T08:00:00Z");
    const dir = folder(), net = hosted(standard());
    const lib = new OfficialAssetLibrary(dir, { fetch: net.fetch, url: HOST, now: () => now });
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    now += OFFICIAL_REFRESH_MS - 60_000;
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    expect(net.asked).toHaveLength(2);

    now += 120_000;
    const fresh = hosted({ "v1/manifest.json": manifest(), "v1/models/COROS-W332/library.json": library(ASSETS.slice(0, 2)) });
    const later = new OfficialAssetLibrary(dir, { fetch: fresh.fetch, url: HOST, now: () => now });
    expect(later.ensure(WATCH)).toMatchObject({ state: "ready", assetCount: 6 });
    expect(await later.settled(WATCH)).toMatchObject({ state: "ready", assetCount: 2, fetchedAt: new Date(now).toISOString() });
    expect(fresh.paths()).toEqual(["v1/manifest.json", "v1/models/COROS-W332/library.json"]);

    // Offline the next day: yesterday's index stays.
    now += OFFICIAL_REFRESH_MS + 1;
    const offline = new OfficialAssetLibrary(dir, { fetch: (async () => { throw new Error("offline"); }) as typeof fetch, url: HOST, now: () => now });
    offline.ensure(WATCH);
    expect(await offline.settled(WATCH)).toMatchObject({ state: "ready", assetCount: 2 });
  });

  it("downloads at most 4 files at once", async () => {
    let running = 0, peak = 0;
    const slow = async () => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 8)); running -= 1; return new Response(new Uint8Array(png(4, 4))); };
    const many = Array.from({ length: 14 }, (_, i) => asset(i.toString(16).padStart(16, "0")));
    const net = hosted({ "v1/manifest.json": manifest(), "v1/models/COROS-W332/library.json": library(many), ...Object.fromEntries(many.map((a) => [`v1/assets/${a.id}/strip.png`, slow])) });
    const lib = new OfficialAssetLibrary(folder(), { fetch: net.fetch, url: HOST });
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    await Promise.all(many.map((a) => lib.strip(WATCH, a.id)));
    expect(peak).toBe(4);
    expect(lib.downloads.peak).toBe(4);
    // Cached: the second page view fetches nothing.
    const before = net.asked.length;
    await Promise.all(many.map((a) => lib.strip(WATCH, a.id)));
    expect(net.asked).toHaveLength(before);
  });

  it("hands a waiting download the slot of the one that finished", async () => {
    const limiter = new Limiter(2);
    let running = 0, peak = 0;
    await Promise.all(Array.from({ length: 9 }, () => limiter.run(async () => { running += 1; peak = Math.max(peak, running); await Promise.resolve(); running -= 1; })));
    expect(peak).toBe(2);
  });

  it("unpacks a set's frames from its ZIP, only its numbered PNGs", async () => {
    const id = "a".repeat(16);
    const net = hosted({ ...standard(), [`v1/assets/${id}/${id}.zip`]: framesZip(id, 10, [{ name: `${id}/10.png`, data: png(2, 3) }, { name: "../../evil.png", data: png(2, 3) }, { name: `${id}/notes.png`, data: Buffer.from("x") }]) });
    const dir = folder();
    const lib = new OfficialAssetLibrary(dir, { fetch: net.fetch, url: HOST });
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    const set = await lib.frames(WATCH, id);
    expect(set).toMatchObject({ id, category: "fonts", width: 20, height: 30, label: "Digit fonts from RIDGE" });
    expect(set.frames).toHaveLength(10);
    expect(set.frames.every((f) => f.startsWith("data:image/png;base64,iVBOR"))).toBe(true);
    expect(readdirSync(path.join(dir, "COROS-W332", "assets", id)).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `${String(i).padStart(2, "0")}.png`));
    // Once unpacked, opening the set again downloads nothing.
    const before = net.asked.length;
    await lib.frames(WATCH, id);
    expect(net.asked).toHaveLength(before);
    await expect(lib.frames(WATCH, "9".repeat(16))).rejects.toThrow(/isn't in the library/);
    await expect(lib.frames(WATCH, "../x")).rejects.toThrow(/isn't in the library/);
  });

  it("refuses an archive over 25 MB, one with frames missing and one that isn't PNGs", async () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((x) => x.repeat(16));
    const net = hosted({
      ...standard(),
      [`v1/assets/${a}/${a}.zip`]: () => new Response("x", { headers: { "content-length": String(MAX_OFFICIAL_ARCHIVE + 1) } }),
      [`v1/assets/${b}/${b}.zip`]: () => new Response(new Uint8Array(MAX_OFFICIAL_ARCHIVE + 1)),
      [`v1/assets/${c}/${c}.zip`]: framesZip(c, 5),
      [`v1/assets/${d}/${d}.zip`]: createStoreZip(Array.from({ length: 41 }, (_, i) => ({ name: `${d}/${String(i).padStart(2, "0")}.png`, data: Buffer.from("<html>") }))),
    });
    const lib = new OfficialAssetLibrary(folder(), { fetch: net.fetch, url: HOST });
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    await expect(lib.frames(WATCH, a)).rejects.toThrow(/couldn't be downloaded/);
    await expect(lib.frames(WATCH, b)).rejects.toThrow(/couldn't be downloaded/);
    await expect(lib.frames(WATCH, c)).rejects.toThrow(/frames missing/);
    await expect(lib.frames(WATCH, d)).rejects.toThrow(/can't be opened/);
  });

  it("refuses a strip that isn't a PNG", async () => {
    const id = "a".repeat(16);
    const net = hosted({ ...standard(), [`v1/assets/${id}/strip.png`]: "<html>" });
    const lib = new OfficialAssetLibrary(folder(), { fetch: net.fetch, url: HOST });
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    await expect(lib.strip(WATCH, id)).rejects.toThrow(/couldn't be downloaded/);
  });
});

describe("browsing", () => {
  const ready = async () => {
    const lib = new OfficialAssetLibrary(folder(), { fetch: hosted(standard()).fetch, url: HOST });
    lib.ensure(WATCH);
    await lib.settled(WATCH);
    return lib;
  };

  it("filters by category, Used as, purpose, frame count, single or sets, config key and words", async () => {
    const lib = await ready();
    const ids = (q: Parameters<OfficialAssetLibrary["list"]>[1]) => lib.list(WATCH, q).assets.map((a) => a.id[0]).join("");
    expect(ids({})).toBe("abcdef");
    expect(ids({ category: "fonts" })).toBe("ab");
    expect(ids({ category: "fonts", role: "weather" })).toBe("b");
    // "Used as" only means something for digit fonts.
    expect(ids({ category: "weather", role: "time" })).toBe("de");
    expect(ids({ category: "weather", tag: "night" })).toBe("e");
    expect(ids({ frameCount: 41 })).toBe("de");
    expect(ids({ frames: "single" })).toBe("f");
    expect(ids({ frames: "multi" })).toBe("abcde");
    expect(ids({ configKey: "weather_dark_icon_dir" })).toBe("e");
    expect(ids({ q: "heraldic" })).toBe("f");
    expect(ids({ q: "60x60 weather" })).toBe("de");
    expect(ids({ category: "made-up", tag: "../x", configKey: "a b" })).toBe("abcdef");
  });

  it("counts what each filter would show, and pages", async () => {
    const lib = await ready();
    const page = lib.list(WATCH, { category: "fonts", pageSize: 1, page: 2 });
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.assets.map((a) => a.id)).toEqual(["b".repeat(16)]);
    expect(page.categories).toEqual([
      { id: "fonts", label: "Digit fonts", count: 2 }, { id: "battery", label: "Battery", count: 1 }, { id: "weather", label: "Weather", count: 2 }, { id: "status", label: "Status icons", count: 1 },
    ]);
    expect(page.roles).toEqual([{ id: "time", label: "Time digits", count: 1 }, { id: "weather", label: "Temperature digits", count: 1 }]);
    expect(page.tags.map((t) => t.id).sort()).toEqual(["hours", "temperature"]);
    expect(lib.list(WATCH, {}).frameCounts).toEqual([{ frames: 10, count: 2 }, { frames: 12, count: 1 }, { frames: 41, count: 2 }]);
    expect(page.assets[0].tags).toEqual([{ id: "temperature", label: "Temperature" }]);
    expect(lib.list(WATCH, { pageSize: 5000 }).pageSize).toBe(96);
    expect(lib.list(WATCH, { page: 99 }).page).toBe(1);
    expect(() => lib.list("not a watch")).toThrow(/Choose a watch/);
  });
});

describe("what a set is for", () => {
  it("classifies by config key and layout element, fonts first", () => {
    expect(officialCategory(["time.hourHigh"], ["time_hour_high_font"])).toBe("fonts");
    expect(officialCategory(["battery.icon"], ["battery_icon_dir"])).toBe("battery");
    expect(officialCategory(["weather.icon"], [])).toBe("weather");
    expect(officialCategory(["time.colon"], [])).toBe("glyphs");
    expect(officialCategory(["time.hourHand"], [])).toBe("clock");
    expect(officialCategory(["doNotDisturb.on"], [])).toBe("status");
    expect(officialCategory(["background"], [])).toBe("backgrounds");
    expect(officialCategory([], [])).toBe("other");
    expect(officialFontRole(["date.day", "control.hr"])).toBe("date");
    expect(officialFontRole(["steps.value"])).toBe("data");
    expect(officialTags(["time_minute_low_font", "time_minute_high_font", "weather_dark_icon_dir", "chinese_tw_date_week_font"]))
      .toEqual([{ id: "minutes", label: "Minutes" }, { id: "night", label: "Night" }, { id: "weekday", label: "Weekday" }]);
  });

  it("opens a template image's browser on its category", () => {
    expect(officialCategoryForConfigKey("bluetooth_on_icon")).toBe("status");
    expect(officialCategoryForConfigKey("weather_icon_dir")).toBe("weather");
    expect(officialCategoryForConfigKey("time_hour_icon")).toBe("clock");
    expect(officialCategoryForConfigKey("colon_icon")).toBe("clock");
    expect(officialCategoryForConfigKey("watchface_thmb_icon")).toBe("backgrounds");
    expect(officialCategoryForConfigKey("control_hr_icon")).toBe("training");
    expect(officialCategoryForConfigKey("something_else")).toBeUndefined();
  });

  it("lays a strip out about square with 2 px gaps", () => {
    const frames = Array.from({ length: 10 }, () => Buffer.alloc(20 * 30 * 4, 255));
    const strip = officialStrip(20, 30, frames);
    expect([strip.width, strip.height]).toEqual([86, 94]);
    expect(officialStrip(8, 8, [Buffer.alloc(256)])).toMatchObject({ width: 8, height: 8 });
  });
});

// ───── The local build ─────

/** An official face as COROS serves it: a compiled PACE Pro BIN with hour and minute digits. */
function officialBin(tone: number): Buffer {
  const files = new Map<string, Uint8Array>();
  const dir = "watchface_416x416";
  files.set("info.json", Buffer.from('{"m_name":"RIDGE","m_app":"watchface_416x416","m_preview":"watchface_customize.png","o_wf_ver":0}'));
  files.set(`${dir}/background.png`, png(416, 416, [0, 0, 0, 255]));
  for (let d = 0; d < 10; d++) files.set(`${dir}/01/${String(d).padStart(2, "0")}.png`, png(20, 30, [tone, d * 20, 255, 255]));
  files.set(`${dir}/config.txt`, Buffer.from([
    "[watchface_id]=0x00000026", "[background_icon_pos]={0,0}", "[background_icon]=background.png", "[bg_color]=0x000000",
    "[time_hour_high_pos]={100,150}", "[time_hour_high_font]=01", "[time_hour_low_pos]={120,150}", "[time_hour_low_font]=01",
    "[time_minute_high_pos]={220,150}", "[time_minute_high_font]=01", "[time_minute_low_pos]={240,150}", "[time_minute_low_font]=01", "",
  ].join("\r\n")));
  return compileWatchface(files, { faceId: 0x26 }).bin;
}

describe("the local build", () => {
  const down = (async () => { throw new Error("offline"); }) as typeof fetch;

  it("builds the library from COROS's official faces when the hosted one can't be reached", async () => {
    const bins: Record<string, Buffer> = { "https://s3.coros.com/a.bin": officialBin(200), "https://s3.coros.com/b.bin": officialBin(200), "https://s3.coros.com/c.bin": officialBin(90) };
    const downloaded: string[] = [];
    const dir = folder();
    const catalog = {
      faces: async (firmwareType: string) => (firmwareType === WATCH ? [{ id: "1", name: "RIDGE", packageUrl: "https://s3.coros.com/a.bin" }, { id: "2", name: "RIDGE II", packageUrl: "https://s3.coros.com/b.bin" }, { id: "3", name: "DUSK", packageUrl: "https://s3.coros.com/c.bin" }, { id: "4", name: "GONE", packageUrl: "https://s3.coros.com/missing.bin" }] : []),
      download: async (url: string) => { downloaded.push(url); if (!bins[url]) throw new Error("404"); return bins[url]; },
    };
    const lib = new OfficialAssetLibrary(dir, { fetch: down, url: HOST, catalog });
    lib.ensure(WATCH);
    const status = await lib.settled(WATCH);
    expect(status).toMatchObject({ state: "ready", source: "local", faceCount: 3, unit: "faces" });
    const fonts = lib.list(WATCH, { category: "fonts" });
    // The same digits in two faces are one set; the third face's are another.
    expect(fonts.assets.map((a) => [a.frames, a.role, a.faceCount, a.faces.join()])).toEqual([[10, "time", 2, "RIDGE,RIDGE II"], [10, "time", 1, "DUSK"]]);
    expect(fonts.assets[0].tags.map((t) => t.id).sort()).toEqual(["hours", "minutes"]);
    const set = await lib.frames(WATCH, fonts.assets[0].id);
    expect(set.frames).toHaveLength(10);
    expect((await lib.strip(WATCH, fonts.assets[0].id)).readUInt32BE(0)).toBe(0x89504e47);
    // Faces are kept, so building again downloads only what was missing.
    lib.ensure(WATCH, true);
    await lib.settled(WATCH);
    expect(downloaded.filter((u) => u.endsWith("a.bin"))).toHaveLength(1);
    expect(downloaded.filter((u) => u.endsWith("missing.bin"))).toHaveLength(2);
  });

  it("downloads 4 official faces at once and leaves out one over 25 MB", async () => {
    let running = 0, peak = 0;
    const bin = officialBin(10);
    const catalog = {
      faces: async () => [...Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: `F${i}`, packageUrl: `https://s3.coros.com/${i}.bin` })), { id: "big", name: "BIG", packageUrl: "https://s3.coros.com/big.bin" }],
      download: async (url: string) => {
        running += 1; peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return url.endsWith("big.bin") ? Buffer.alloc(MAX_OFFICIAL_ARCHIVE + 1) : bin;
      },
    };
    const lib = new OfficialAssetLibrary(folder(), { fetch: down, url: HOST, catalog });
    lib.ensure(WATCH);
    expect(await lib.settled(WATCH)).toMatchObject({ state: "ready", faceCount: 11, done: 11 });
    expect(peak).toBe(4);
  });

  it("says so when neither the library nor a COROS sign-in is there", async () => {
    const none = new OfficialAssetLibrary(folder(), { fetch: down, url: HOST });
    none.ensure(WATCH);
    expect(await none.settled(WATCH)).toMatchObject({ state: "error", message: "The official library couldn't be reached. Check the connection and try again." });
    const signedOut = new OfficialAssetLibrary(folder(), { fetch: down, url: HOST, catalog: { faces: async () => { throw new Error("Sign in to your COROS account first."); }, download: async () => Buffer.alloc(0) } });
    signedOut.ensure(WATCH);
    expect(await signedOut.settled(WATCH)).toMatchObject({ state: "error", message: "Sign in to your COROS account first." });
    // Trying again later works once the library is back.
    const back = new OfficialAssetLibrary(none.folder, { fetch: hosted(standard()).fetch, url: HOST });
    back.ensure(WATCH, true);
    expect((await back.settled(WATCH)).state).toBe("ready");
  });
});

describe("in the app", () => {
  it("is all reading, so Local-Only Mode lets it through", () => {
    expect(uploadsToCoros(new URL(`${OFFICIAL_LIBRARY_URL}/v1/manifest.json`), "GET")).toBe(false);
    expect(uploadsToCoros(new URL(`${OFFICIAL_LIBRARY_URL}/v1/assets/${"a".repeat(16)}/strip.png`), "GET")).toBe(false);
    // The local build's two calls to COROS: the official list (a read COROS takes as a POST) and a face's download.
    expect(uploadsToCoros(new URL("https://apicn.coros.com/coros/watchface/getWatchFaceThemeList"), "POST")).toBe(false);
    expect(uploadsToCoros(new URL("https://s3.coros.com/official/face.bin"), "GET")).toBe(false);
  });

  it("answers Studio's routes: status, a page, a strip, a set and refresh", async () => {
    const id = "a".repeat(16);
    const net = hosted({ ...standard(), [`v1/assets/${id}/strip.png`]: png(8, 8), [`v1/assets/${id}/${id}.zip`]: framesZip(id, 10) });
    const data = folder();
    const official = new OfficialAssetLibrary(path.join(data, "studio", "official-assets"), { fetch: net.fetch, url: HOST });
    const studio = new WatchfaceStudio(data, { official });
    const ask = (route: string, init?: RequestInit) => studio.answer(new Request(`clink://app/api/desktop/studio${route}`, init));
    expect(await (await ask("/official?watch=pace-pro")).json()).toMatchObject({ status: { state: "loading", watch: WATCH } });
    await official.settled("pace-pro");
    const page = await (await ask("/official/assets?watch=pace-pro&category=fonts&role=time")).json() as { total: number; assets: { id: string }[] };
    expect(page.total).toBe(1);
    const strip = await ask(`/official/strips/${id}?watch=pace-pro`);
    expect([strip.status, strip.headers.get("content-type"), strip.headers.get("cache-control")]).toEqual([200, "image/png", "max-age=31536000, immutable"]);
    const set = await (await ask(`/official/sets/${id}?watch=pace-pro`)).json() as { set: { frames: string[] } };
    expect(set.set.frames).toHaveLength(10);
    expect((await ask(`/official/sets/${"9".repeat(16)}?watch=pace-pro`)).status).toBe(404);
    expect((await ask("/official/refresh", { method: "POST", body: "{}" })).status).toBe(403);
    const refreshed = await ask("/official/refresh", { method: "POST", headers: { "x-clink-hub": "1" }, body: JSON.stringify({ watch: "pace-pro" }) });
    expect(await refreshed.json()).toMatchObject({ status: { state: "loading" } });
    await official.settled("pace-pro");
    expect((await ask("/official?watch=nope")).status).toBe(400);
  });
});
