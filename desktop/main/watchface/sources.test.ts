// Studio's sources: Community faces, the COROS account and its catalogs, and opening either as a project. CorosLink's
// tests for these (scripts/test-community-watchfaces.mjs, the mobile-API parts of test-coros-watchface-service.mjs)
// and its "Must not regress" items for them (replacement-checklist §5: catalog ≤2 MB, packages ≤100 MB, signed
// paths, temp imports cleaned after 7 days) are here.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../../watchface/compiler/png";
import { compileWatchface } from "../../watchface/compiler/compiler";
import { inspectTemplate } from "../../watchface/archive/template";
import { recoverCompiledCorosWatchface } from "../../watchface/recoverBin";
import { readZip } from "../../watchface/zipRead";
import { createStoreZip } from "../../watchface/zipStore";
import type { Sealer } from "../secrets";
import {
  catalogQuery, CommunityCatalog, parseCommunityPage, trustedDownloadLocation, checkFaceUrls, MAX_COMMUNITY_PACKAGE, type CommunityFace,
} from "./community";
import { CorosAccount } from "./corosAccount";
import {
  buildMobileLoginRegion, buildMobileYfHeader, encryptMobileLoginField, extractDecimalProperty, findHttpsUrlInJson, hashCorosPassword,
  normalizeCorosWatchfaceThemes, parseCorosMobileJson, suggestRegion,
} from "./corosMobile";
import { disposition, WatchfaceStudio } from "./studio";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-sources-"));
const png = (w: number, h: number, rgba: [number, number, number, number] = [255, 255, 255, 255]) =>
  encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => rgba[i % 4]) });

/** A small editable PACE Pro template (416 layout + the 800 master) with hour and minute digits. */
function template(): Buffer {
  const files: { name: string; data: Buffer }[] = [
    { name: "info.json", data: Buffer.from('{"m_name":"RIDGE","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_wf_ver":0,"o_template_id":478947569257513340,"o_diy_version":1}') },
    { name: "watchface_customize.png", data: png(40, 40, [9, 9, 9, 255]) },
  ];
  for (const size of [416, 800]) {
    const dir = `watchface_${size}x${size}`, s = size / 416;
    files.push({ name: `${dir}/background.png`, data: png(size, size, [0, 0, 0, 255]) });
    for (let d = 0; d < 10; d++) files.push({ name: `${dir}/01/${String(d).padStart(2, "0")}.png`, data: png(Math.round(20 * s), Math.round(30 * s)) });
    files.push({ name: `${dir}/config.txt`, data: Buffer.from([
      "[watchface_id]=0x00000026", "[background_icon_pos]={0,0}", "[background_icon]=background.png", "[bg_color]=0x000000",
      `[time_hour_high_pos]={${Math.round(100 * s)},${Math.round(150 * s)}}`, "[time_hour_high_font]=01",
      `[time_hour_low_pos]={${Math.round(120 * s)},${Math.round(150 * s)}}`, "[time_hour_low_font]=01",
      `[time_minute_high_pos]={${Math.round(220 * s)},${Math.round(150 * s)}}`, "[time_minute_high_font]=01",
      `[time_minute_low_pos]={${Math.round(240 * s)},${Math.round(150 * s)}}`, "[time_minute_low_font]=01", "",
    ].join("\r\n")) });
  }
  return createStoreZip(files);
}

/** The template compiled for PACE Pro, as an official face arrives. */
function compiled(): Buffer {
  const files = new Map(readZip(template()).filter((e) => !e.directory).map((e) => [e.path, new Uint8Array(e.read())] as const));
  return compileWatchface(files, { faceId: 0x26 }).bin;
}

// ───── Community ─────

const ORIGIN = "https://watchfaces.coroslink.com";
const FACE_ID = "4a6f96bf-0bed-4942-bd66-7b9cf7850a5f";
const item = (over: Partial<Record<keyof CommunityFace, unknown>> = {}) => ({
  id: FACE_ID, slug: "ridge-line", title: "Ridge Line", description: "", creatorName: "Creator", creatorHandle: null, models: ["PACE Pro"], tags: [],
  publishedAt: "2026-10-12T18:00:35.841Z", previewUrl: `${ORIGIN}/api/watch-faces/${FACE_ID}/preview`, detailUrl: `${ORIGIN}/face/ridge-line`,
  downloadUrl: `${ORIGIN}/api/downloads/${FACE_ID}`, packageBytes: 2205409, packageSha256: "a".repeat(64), validatorVersion: null, ...over,
});
const page = (items: unknown[]) => ({ schemaVersion: 1, items, pagination: { page: 1, pageSize: 12, total: items.length, pageCount: 1 }, facets: { models: ["PACE Pro"], styles: [] } });

describe("community catalog", () => {
  // The grouped "designs" listing once sent packageBytes as a bigint string, which took the whole Community tab down.
  it("takes packageBytes as a number or an integer string, nothing else", () => {
    for (const packageBytes of [2205409, "2205409"]) expect(parseCommunityPage(page([item({ packageBytes })])).items[0].packageBytes).toBe(2205409);
    for (const packageBytes of ["", "0", "-5", "1e6", "12.5", " 42", String(MAX_COMMUNITY_PACKAGE + 1), null, true]) {
      expect(() => parseCommunityPage(page([item({ packageBytes })]))).toThrow();
    }
  });
  it("refuses faces whose URLs leave the catalog", () => {
    expect(checkFaceUrls(parseCommunityPage(page([item()])).items[0])).toBeTruthy();
    expect(checkFaceUrls(parseCommunityPage(page([item({ downloadUrl: `${ORIGIN}/api/downloads/${FACE_ID}?model=PACE+Pro` })])).items[0])).toBeTruthy();
    for (const bad of [
      { previewUrl: `https://attacker.test/api/watch-faces/${FACE_ID}/preview` },
      { downloadUrl: `${ORIGIN}/api/downloads/${FACE_ID}?download=https://attacker.test` },
      { downloadUrl: `${ORIGIN}/api/downloads/${FACE_ID}?model=unknown` },
      { detailUrl: `${ORIGIN}/face/../settings` },
    ]) expect(() => checkFaceUrls(parseCommunityPage(page([item(bad)])).items[0])).toThrow(/untrusted/);
  });
  it("follows a download only to signed storage or Vercel Blob", () => {
    const release = `releases/${FACE_ID}/be926c6e-b254-4aba-8ee6-42f95f41304b.zip`;
    const signed = "expires=1790210000&filename=face.zip&signature=abc_DEF-123";
    for (const location of [`${ORIGIN}/api/storage/${release}?${signed}`, `https://store.private.blob.vercel-storage.com/${release}?token=x`]) {
      expect(trustedDownloadLocation(location, ORIGIN)).toBeTruthy();
    }
    for (const location of [
      `https://attacker.test/api/storage/${release}?${signed}`, `http://watchfaces.coroslink.com/api/storage/${release}?${signed}`,
      `${ORIGIN}/api/storage/${release}`, `${ORIGIN}/api/storage/${release}?expires=1790210000`,
      `${ORIGIN}/api/storage/quarantine/${FACE_ID}.zip?${signed}`, `${ORIGIN}/api/storage/releases/../quarantine/x.zip?${signed}`,
      `${ORIGIN}/api/downloads/${FACE_ID}?${signed}`, `https://user:pass@watchfaces.coroslink.com/api/storage/${release}?${signed}`,
      "https://blob.vercel-storage.com.attacker.test/x.zip", "not a url",
    ]) expect(trustedDownloadLocation(location, ORIGIN)).toBeNull();
  });
  it("clamps what it asks", () => {
    const q = catalogQuery({ q: "x".repeat(200), sort: "bogus" as never, page: 0, pageSize: 500, group: "Bad Group" });
    expect(q.get("q")).toHaveLength(100);
    expect(q.get("sort")).toBe("newest");
    expect([q.get("page"), q.get("pageSize"), q.get("group")]).toEqual(["1", "48", null]);
  });
  it("refuses a catalog answer over 2 MB", async () => {
    const big = new CommunityCatalog(folder(), { fetch: async () => new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } }) });
    await expect(big.list()).rejects.toThrow(/large/);
    const huge = new CommunityCatalog(folder(), { fetch: async () => new Response(" ".repeat(2 * 1024 * 1024 + 1)) });
    await expect(huge.list()).rejects.toThrow(/invalid/);
  });
  it("cleans downloads left behind after 7 days", async () => {
    const dir = folder(), now = Date.now();
    const catalog = new CommunityCatalog(dir, { now: () => now });
    for (const [name, age] of [["old.part", 8], ["old.zip", 8], ["new.part", 1], ["keep.txt", 30]] as const) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, "x");
      const at = new Date(now - age * 86_400_000);
      fs.utimesSync(file, at, at);
    }
    await catalog.cleanup();
    expect(fs.readdirSync(dir).sort()).toEqual(["keep.txt", "new.part"]);
  });
});

/** A catalog that serves one face whose package is `bytes`, through a signed redirect. */
function fakeCatalog(bytes: Buffer, sha = createHash("sha256").update(bytes).digest("hex")) {
  const asked: string[] = [];
  const signed = `${ORIGIN}/api/storage/releases/${FACE_ID}/be926c6e-b254-4aba-8ee6-42f95f41304b.zip?expires=1&signature=s`;
  const fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    asked.push(u.pathname + u.search);
    if (u.pathname === "/api/v1/watch-faces/ridge-line") return Response.json({ schemaVersion: 1, item: item({ packageBytes: bytes.length, packageSha256: sha, downloadUrl: `${ORIGIN}/api/downloads/${FACE_ID}?model=PACE+Pro` }) });
    if (u.pathname === `/api/downloads/${FACE_ID}`) return new Response(null, { status: 302, headers: { location: signed } });
    if (u.pathname.startsWith("/api/storage/")) return new Response(new Uint8Array(bytes), { headers: { "content-length": String(bytes.length) } });
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

describe("opening a community face", () => {
  it("downloads the reviewed package, checks it and makes a project", async () => {
    const data = folder();
    const { fetch, asked } = fakeCatalog(template());
    const studio = new WatchfaceStudio(data, { fetch });
    const { project, title } = await studio.openCommunity("ridge-line", "PACE Pro", "pace-pro");
    expect(title).toBe("Ridge Line");
    expect(project).toMatchObject({ name: "Ridge Line", firmwareType: "COROS W332", startedFrom: "template" });
    expect(asked.some((a) => a.startsWith("/api/storage/releases/"))).toBe(true);
    expect((await studio.list()).map((p) => p.name)).toEqual(["Ridge Line"]);
    expect(fs.readdirSync(path.join(data, "studio", "community-imports"))).toEqual([]);
  });
  it("refuses a package that doesn't match its review, and leaves nothing behind", async () => {
    const data = folder();
    const studio = new WatchfaceStudio(data, { fetch: fakeCatalog(template(), "b".repeat(64)).fetch });
    await expect(studio.openCommunity("ridge-line", "PACE Pro", "pace-pro")).rejects.toThrow(/didn't match/);
    expect(await studio.list()).toEqual([]);
    expect(fs.readdirSync(path.join(data, "studio", "community-imports"))).toEqual([]);
  });
  it("answers the page's routes", async () => {
    const studio = new WatchfaceStudio(folder(), { fetch: fakeCatalog(template()).fetch });
    const forbidden = await studio.answer(new Request("clink://app/api/desktop/studio/community/ridge-line/open", { method: "POST", body: "{}" }));
    expect(forbidden.status).toBe(403);
    const opened = await studio.answer(new Request("clink://app/api/desktop/studio/community/ridge-line/open", {
      method: "POST", headers: { "X-Clink-Hub": "1" }, body: JSON.stringify({ model: "PACE Pro", watch: "pace-pro" }),
    }));
    expect(((await opened.json()) as { project: { name: string } }).project.name).toBe("Ridge Line");
  });
});

// ───── COROS mobile API ─────

describe("COROS mobile API", () => {
  it("encrypts login fields as the Android client does", () => {
    expect(encryptMobileLoginField("fixture@example.com")).toBe("gEKTo01dr4WWsaqHSs8+wr1/TKGhdN5Ph7F1mR2+gwA=");
    expect(encryptMobileLoginField(hashCorosPassword("fixture-password"))).toHaveLength(64);
  });
  it("sends the region in the Android shape", () => {
    expect(buildMobileLoginRegion({ locale: "en-US", timeZone: "America/Toronto" }))
      .toBe("DomainRegion(simMcc=310,countryCode=US,timeZoneId=America/Toronto,language=en,countryIso=us)");
    expect([suggestRegion("en-US"), suggestRegion("de-DE"), suggestRegion("en-SG"), suggestRegion("zh-CN"), suggestRegion("en")]).toEqual(["us", "eu", "sg", "cn", "us"]);
  });
  it("keeps IDs beyond Number.MAX_SAFE_INTEGER exact", () => {
    expect(parseCorosMobileJson('{"data":{"watchFaceTemplateId":478947569257513340,"srcWatchFaceTemplateId":478943290396344519}}'))
      .toEqual({ data: { watchFaceTemplateId: "478947569257513340", srcWatchFaceTemplateId: "478943290396344519" } });
    expect(extractDecimalProperty('{"result":"0000","data":{"watchFaceTemplateId":478814257230741704}}', "watchFaceTemplateId")).toBe("478814257230741704");
    expect(buildMobileYfHeader("a".repeat(32), -20, "478814257230741704")).toContain('"userId":478814257230741704,');
  });
  it("reads the official list, without the account's own faces", () => {
    expect(normalizeCorosWatchfaceThemes({
      watchFaceTemplateList: [{ watchFaceTemplateId: "custom-only", watchFaceTemplateName: "Must not appear in the official browser" }],
      watchFaceThemeList: [{ id: 1, watchFaceList: [
        { id: 478762815845416960, watchFaceName: "Digital dusk", imageUrl: "https://s3.coros.com/watchface/digital-dusk.png", watchFaceUrl: "https://api.coros.com/coros/watchface/resource/478762815845416960", firmwareType: "COROS W332", watchFaceVersion: 5 },
        { id: 478762815845416960, watchFaceName: "Duplicate should be suppressed" },
        { id: "blocked-preview", watchFaceName: "Unsafe preview is omitted", imageUrl: "http://example.test/preview.png" },
      ] }],
    })).toEqual([
      { id: "478762815845416960", name: "Digital dusk", previewImageUrl: "https://s3.coros.com/watchface/digital-dusk.png", packageUrl: "https://api.coros.com/coros/watchface/resource/478762815845416960", firmwareType: "COROS W332", watchFaceVersion: 5 },
      { id: "blocked-preview", name: "Unsafe preview is omitted" },
    ]);
  });
  it("reads the account's own faces and the template list", () => {
    expect(normalizeCorosWatchfaceThemes({
      watchFaceTemplateList: [{ watchFaceTemplateId: "478814257230741704", watchFaceTemplateName: "My custom summit face", watchFaceTemplatePreviewImageUrl: "https://s3.coros.com/custom/summit-preview.png", watchFaceTemplateUserCustomUrl: "https://s3.coros.com/custom/summit-face.dat", firmwareType: "COROS W332", srcWatchFaceTemplateId: "250506", backgroundImageId: 13 }],
      watchFaceThemeList: [{ watchFaceList: [{ id: 123, watchFaceName: "Official only" }] }],
    }, "custom")).toEqual([{ id: "478814257230741704", sourceTemplateId: "250506", name: "My custom summit face", previewImageUrl: "https://s3.coros.com/custom/summit-preview.png", packageUrl: "https://s3.coros.com/custom/summit-face.dat", firmwareType: "COROS W332", backgroundImageId: 13 }]);
    expect(normalizeCorosWatchfaceThemes([{ id: 477764002410233956, diyVersion: 1, previewImageUrl: "https://s3.coros.com/watchface_template/preview.png", watchFaceTemplateId: 250601, watchFaceTemplateName: "BOLD", watchFaceTemplateType: 1, watchFaceTemplateUrl: "https://s3.coros.com/watchface_template/source.zip", watchFaceVersion: 0 }]))
      .toEqual([{ id: "250601", name: "BOLD", previewImageUrl: "https://s3.coros.com/watchface_template/preview.png", packageUrl: "https://s3.coros.com/watchface_template/source.zip", watchFaceVersion: 0, diyVersion: 1, templateType: 1 }]);
  });
  it("finds the file a JSON envelope points at", () => {
    expect(findHttpsUrlInJson('{"data":{"previewImageUrl":"https://s3.coros.com/p.png","fileUrl":"https://s3.coros.com/faces/dusk.dat"}}')).toBe("https://s3.coros.com/faces/dusk.dat");
    expect(findHttpsUrlInJson("not json at all")).toBeUndefined();
    expect(findHttpsUrlInJson('{"url":"http://insecure.example/x.dat"}')).toBeUndefined();
  });
});

// ───── The account ─────

const sealed: Sealer = { encrypt: async (t) => Buffer.from(`sealed:${t}`), decrypt: async (b) => ({ text: b.toString().slice(7), stale: false }) };
const TOKEN = "token-abc";
const OFFICIAL_ID = "478762815845416960";

/** COROS's mobile API, as far as Studio uses it. Official faces arrive as compiled BINs. */
function fakeCoros(bin = compiled()) {
  const calls: { path: string; body?: string; headers: Headers }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push({ path: u.hostname + u.pathname, body: typeof init?.body === "string" ? init.body : undefined, headers: new Headers(init?.headers) });
    if (u.pathname === "/coros/user/login") {
      const body = JSON.parse(String(init?.body)) as { checkStatus: number; pwd: string };
      if (body.pwd !== encryptMobileLoginField(hashCorosPassword("right"))) return new Response('{"result":"1030","message":"Wrong password"}');
      if (body.checkStatus === 1) return new Response('{"result":"1115","message":"User logged in"}');
      return new Response(`{"result":"0000","data":{"accessToken":"${TOKEN}","userId":478814257230741704}}`);
    }
    if (u.pathname === "/coros/watchface/getWatchFaceThemeList") {
      return new Response(JSON.stringify({ result: "0000", data: { watchFaceThemeList: [{ watchFaceList: [
        { id: 1, watchFaceName: "Dusk", imageUrl: "https://s3.coros.com/watchface/dusk.png", watchFaceUrl: `https://api.coros.com/coros/watchface/resource/${OFFICIAL_ID}`, firmwareType: "COROS W332" },
      ] }] } }));
    }
    if (u.pathname === `/coros/watchface/resource/${OFFICIAL_ID}`) {
      return u.searchParams.get("accessToken") === TOKEN ? new Response(new Uint8Array(bin)) : new Response("no", { status: 401 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("COROS account", () => {
  it("signs in, saves only the digest when asked, and signs out keeping the saved account", async () => {
    const dir = folder();
    const { fetch, calls } = fakeCoros();
    const account = new CorosAccount(dir, { sealer: sealed, secure: async () => true, fetch, locale: "en-GB" });
    expect(await account.status()).toMatchObject({ signedIn: false, suggestedRegion: "eu", canSave: true });
    await expect(account.signIn({ email: "a@b.c", password: "wrong", region: "eu" })).rejects.toThrow(/Wrong password/);
    expect(await account.signIn({ email: "a@b.c", password: "right", region: "eu", remember: true }))
      .toMatchObject({ signedIn: true, email: "a@b.c", region: "eu", savedEmail: "a@b.c" });
    expect(calls.filter((c) => c.path.endsWith("/user/login")).map((c) => c.path)).toEqual(Array(3).fill("apieu.coros.com/coros/user/login"));
    const file = fs.readFileSync(path.join(dir, "coros-account.bin"), "utf8");
    expect(file).toContain(hashCorosPassword("right"));
    expect(file).not.toContain('"right"');
    // A new run reads it back.
    const again = new CorosAccount(dir, { sealer: sealed, secure: async () => true, fetch });
    expect(await again.status()).toMatchObject({ signedIn: true, savedEmail: "a@b.c" });
    expect(await again.signOut()).toMatchObject({ signedIn: false, savedEmail: "a@b.c" });
    expect(await again.signInSaved({ region: "eu" })).toMatchObject({ signedIn: true });
    expect(await again.forget()).not.toHaveProperty("savedEmail");
  });
  it("writes nothing without a real keychain", async () => {
    const dir = folder();
    const account = new CorosAccount(dir, { sealer: sealed, secure: async () => false, fetch: fakeCoros().fetch });
    expect(await account.signIn({ email: "a@b.c", password: "right", remember: true })).toMatchObject({ signedIn: true, canSave: false });
    expect((await account.status()).savedEmail).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "coros-account.bin"))).toBe(false);
  });
  it("signs out when COROS says the session expired", async () => {
    const fetch = (async (input: RequestInfo | URL) => (String(input).includes("/user/login")
      ? new Response(`{"result":"0000","data":{"accessToken":"${TOKEN}"}}`) : new Response('{"result":"1019","message":"expired"}'))) as typeof globalThis.fetch;
    const account = new CorosAccount(folder(), { sealer: sealed, secure: async () => true, fetch });
    await account.signIn({ email: "a@b.c", password: "right" });
    await expect(account.themes("official", { firmwareType: "COROS W332" })).rejects.toThrow(/expired/);
    expect((await account.status()).signedIn).toBe(false);
  });
  it("fetches packages only from COROS, and only listed ones reach Studio", async () => {
    const account = new CorosAccount(folder(), { sealer: sealed, secure: async () => true, fetch: fakeCoros().fetch });
    await expect(account.fetchPackage("https://attacker.test/x.zip")).rejects.toThrow(/only come from COROS/);
    await expect(account.fetchPackage("http://s3.coros.com/x.zip")).rejects.toThrow(/only come from COROS/);
    const studio = new WatchfaceStudio(folder(), { account });
    await expect(studio.openCorosFace("official", OFFICIAL_ID, "pace-pro")).rejects.toThrow(/Sign in|isn't in the list/);
  });
});

describe("opening an official face", () => {
  it("recovers the compiled face into an editable project", async () => {
    const { fetch } = fakeCoros();
    const account = new CorosAccount(folder(), { sealer: sealed, secure: async () => true, fetch });
    await account.signIn({ email: "a@b.c", password: "right" });
    const studio = new WatchfaceStudio(folder(), { account, fetch });
    const faces = await studio.corosFaces("official", (await import("../../watchface/watchfaceTargets")).getWatchfaceTarget("pace-pro")!);
    expect(faces).toEqual([{ id: OFFICIAL_ID, name: "Dusk", picture: true }]);
    const project = await studio.openCorosFace("official", OFFICIAL_ID, "pace-pro");
    expect(project).toMatchObject({ name: "Dusk", firmwareType: "COROS W332", startedFrom: "template" });
    const opened = await studio.open(project.projectId);
    expect(opened.template.resolutionDirectories).toContain("watchface_416x416");
  });
  it("is a BIN CorosLink's recovery reads back", () => {
    const recovered = recoverCompiledCorosWatchface(compiled(), "Dusk");
    expect(inspectTemplate(recovered.zip).resolutionDirectories).toEqual(["watchface_416x416"]);
  });
});

describe("downloads", () => {
  it("keep a face's name in any language", () => {
    expect(disposition("大野兔.bin")).toBe(`attachment; filename="watch face.bin"; filename*=UTF-8''${encodeURIComponent("大野兔.bin")}`);
    expect(disposition("Ridge Line (editable).zip")).toBe(`attachment; filename="Ridge Line (editable).zip"; filename*=UTF-8''${encodeURIComponent("Ridge Line (editable).zip")}`);
  });
});
