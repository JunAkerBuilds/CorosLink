// Google Fonts through the main process: three hosts and no others, capped answers, a cache that is refreshed and
// stands in when Google can't be reached, and the routes Studio's font picker asks.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { uploadsToCoros } from "../dataMode";
import {
  BUILT_IN_GOOGLE_FAMILIES, GOOGLE_CSS_URL, GOOGLE_FAMILY_FRESH_MS, GOOGLE_LIST_FRESH_MS, GOOGLE_LIST_URL, GoogleFonts, googleCssUrl,
  MAX_GOOGLE_FONT_FILE, parseGoogleCss, parseGoogleFontList, trustedFontFile,
} from "./googleFonts";
import { WatchfaceStudio } from "./studio";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-gfonts-"));
const woff2 = (tag: string) => Buffer.concat([Buffer.from("wOF2"), Buffer.from(tag)]);

const METADATA = ")]}'\n" + JSON.stringify({ familyMetadataList: [
  { family: "Bebas Neue", category: "Display", popularity: 40, fonts: { "400": {} }, axes: [] },
  { family: "Oswald", category: "Sans Serif", popularity: 18, fonts: { "400": {} }, axes: [{ tag: "wght", min: 200, max: 700 }] },
  { family: "Roboto Mono", category: "Monospace", popularity: 9, fonts: { "100": {}, "400": {}, "700": {}, "400i": {}, "700i": {} }, axes: [] },
  { family: "Bad<Name>", category: "Display", popularity: 1, fonts: { "400": {} } },
  { family: "No Fonts", category: "Display", popularity: 2 },
] });

const face = (family: string, subset: string, weight: string, file: string, style = "normal") => `/* ${subset} */
@font-face {
  font-family: '${family}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: block;
  src: url(https://fonts.gstatic.com/s/${family.toLowerCase().replace(/ /g, "")}/v57/${file}.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`;
const OSWALD = face("Oswald", "cyrillic", "200 700", "cyr") + face("Oswald", "latin-ext", "200 700", "ext") + face("Oswald", "latin", "200 700", "lat");

/** Google, faked: answers by URL, every request noted. */
function google(over: Record<string, string | Buffer | (() => Response) | undefined> = {}) {
  const asked: { url: string; redirect?: string; agent?: string }[] = [];
  const answers: Record<string, string | Buffer | (() => Response) | undefined> = {
    [GOOGLE_LIST_URL]: METADATA,
    [`${GOOGLE_CSS_URL}?family=Oswald:wght@200..700&display=block`]: OSWALD,
    [`${GOOGLE_CSS_URL}?family=Oswald:wght@400&display=block`]: face("Oswald", "latin-ext", "400", "ext") + face("Oswald", "latin", "400", "lat"),
    [`${GOOGLE_CSS_URL}?family=Bebas+Neue&display=block`]: face("Bebas Neue", "latin", "400", "bebas"),
    [`${GOOGLE_CSS_URL}?family=Roboto+Mono:ital,wght@0,100;0,400;0,700;1,400;1,700&display=block`]:
      face("Roboto Mono", "latin", "400", "rm400") + face("Roboto Mono", "latin", "700", "rm700", "italic"),
    "https://fonts.gstatic.com/s/oswald/v57/lat.woff2": woff2("oswald-latin"),
    "https://fonts.gstatic.com/s/oswald/v57/ext.woff2": woff2("oswald-ext"),
    "https://fonts.gstatic.com/s/bebasneue/v57/bebas.woff2": woff2("bebas"),
    "https://fonts.gstatic.com/s/robotomono/v57/rm400.woff2": woff2("rm400"),
    "https://fonts.gstatic.com/s/robotomono/v57/rm700.woff2": woff2("rm700"),
    ...over,
  };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, redirect: init?.redirect, agent: new Headers(init?.headers).get("user-agent") ?? undefined });
    const answer = answers[url];
    if (answer === undefined) return new Response("no", { status: 400 });
    return typeof answer === "function" ? answer() : new Response(new Uint8Array(Buffer.from(answer)));
  }) as typeof globalThis.fetch;
  return { fetch, asked, urls: () => asked.map((a) => a.url) };
}
const offline = (async () => { throw new Error("offline"); }) as typeof fetch;

describe("Google's list", () => {
  it("is reduced to what the picker shows, most popular first", () => {
    const families = parseGoogleFontList(METADATA);
    expect(families).toEqual([
      { family: "Roboto Mono", category: "Mono", weights: [100, 400, 700], italics: [400, 700] },
      { family: "Oswald", category: "Sans", weights: [200, 300, 400, 500, 600, 700], italics: [], range: [200, 700] },
      { family: "Bebas Neue", category: "Display", weights: [400], italics: [] },
    ]);
    expect(() => parseGoogleFontList("{}")).toThrow();
    expect(() => parseGoogleFontList('{"familyMetadataList":[]}')).toThrow();
  });

  it("is fetched once, kept for 7 days, then fetched again", async () => {
    let now = Date.parse("2026-11-23T08:00:00Z");
    const dir = folder(), net = google();
    const fonts = new GoogleFonts(dir, { fetch: net.fetch, now: () => now });
    expect((await fonts.list()).source).toBe("google");
    await fonts.list();
    expect(net.urls()).toEqual([GOOGLE_LIST_URL]);
    expect(net.asked[0].redirect).toBe("error");
    // The next start reads the copy on disk.
    now += GOOGLE_LIST_FRESH_MS - 1000;
    expect((await new GoogleFonts(dir, { fetch: net.fetch, now: () => now }).list()).families).toHaveLength(3);
    expect(net.asked).toHaveLength(1);
    now += 2000;
    await new GoogleFonts(dir, { fetch: net.fetch, now: () => now }).list();
    expect(net.asked).toHaveLength(2);
  });

  it("falls back to the saved list, then to the built-in one, and tries Google again next time", async () => {
    let now = Date.parse("2026-11-23T08:00:00Z");
    const dir = folder();
    await new GoogleFonts(dir, { fetch: google().fetch, now: () => now }).list();
    now += GOOGLE_LIST_FRESH_MS + 1;
    expect(await new GoogleFonts(dir, { fetch: offline, now: () => now }).list()).toMatchObject({ source: "saved", families: [{ family: "Roboto Mono" }, { family: "Oswald" }, { family: "Bebas Neue" }] });

    const net = google({ [GOOGLE_LIST_URL]: undefined });
    const none = new GoogleFonts(folder(), { fetch: net.fetch });
    expect(await none.list()).toEqual({ families: BUILT_IN_GOOGLE_FAMILIES, source: "builtIn" });
    await none.list();
    expect(net.asked).toHaveLength(2);
    expect(BUILT_IN_GOOGLE_FAMILIES.length).toBeGreaterThan(60);

    // Something that isn't the list, or is too big, is not taken.
    expect((await new GoogleFonts(folder(), { fetch: google({ [GOOGLE_LIST_URL]: "<html>" }).fetch }).list()).source).toBe("builtIn");
    expect((await new GoogleFonts(folder(), { fetch: google({ [GOOGLE_LIST_URL]: () => new Response("{}", { headers: { "content-length": String(13 * 1024 * 1024) } }) }).fetch }).list()).source).toBe("builtIn");
  });
});

describe("a family's stylesheet", () => {
  it("asks for the weights the family has, upright and italic", async () => {
    const [mono, oswald, bebas] = parseGoogleFontList(METADATA);
    expect(googleCssUrl(mono).href).toBe(`${GOOGLE_CSS_URL}?family=Roboto+Mono:ital,wght@0,100;0,400;0,700;1,400;1,700&display=block`);
    expect(googleCssUrl(oswald).href).toBe(`${GOOGLE_CSS_URL}?family=Oswald:wght@200..700&display=block`);
    expect(googleCssUrl(bebas).href).toBe(`${GOOGLE_CSS_URL}?family=Bebas+Neue&display=block`);
    expect(googleCssUrl(mono, true).href).toBe(`${GOOGLE_CSS_URL}?family=Roboto+Mono:wght@400&display=block`);
    expect(googleCssUrl({ ...mono, weights: [100, 700] }, true).href).toContain("wght@100&");
  });

  it("keeps only .woff2 files on fonts.gstatic.com", () => {
    const css = OSWALD
      + "@font-face { font-family: 'X'; font-weight: 400; src: url(https://attacker.test/s/x/v1/a.woff2) format('woff2'); }"
      + "@font-face { font-family: 'X'; font-weight: 400; src: url(https://fonts.gstatic.com/s/x/v1/a.ttf) format('truetype'); }"
      + "@font-face { font-family: 'X'; font-weight: 400; src: url(http://fonts.gstatic.com/s/x/v1/a.woff2) format('woff2'); }"
      + "@font-face { font-family: 'X'; font-weight: bold; src: url(https://fonts.gstatic.com/s/x/v1/a.woff2) format('woff2'); }"
      + "@font-face { font-family: 'X'; font-weight: 400; src: url(https://fonts.gstatic.com/s/x/v1/a.woff2) format('woff2'); unicode-range: U+0-7F; } body { background: url(x) }";
    const faces = parseGoogleCss(css);
    expect(faces.map((f) => [f.subset, f.weight, f.style, new URL(f.url).pathname])).toEqual([
      ["cyrillic", "200 700", "normal", "/s/oswald/v57/cyr.woff2"], ["latin-ext", "200 700", "normal", "/s/oswald/v57/ext.woff2"],
      ["latin", "200 700", "normal", "/s/oswald/v57/lat.woff2"], ["", "400", "normal", "/s/x/v1/a.woff2"],
    ]);
    expect(faces[2].unicodeRange).toBe("U+0000-00FF, U+0131");
    for (const bad of ["https://fonts.gstatic.com.attacker.test/s/x/v1/a.woff2", "https://fonts.gstatic.com/s/x/v1/../../a.woff2", "https://fonts.gstatic.com/s/x/v1/a.woff2?x=1", "https://user@fonts.gstatic.com/s/x/v1/a.woff2", "https://fonts.gstatic.com:8443/s/x/v1/a.woff2", "file:///etc/passwd", "nope"]) {
      expect(trustedFontFile(bad)).toBeNull();
    }
    expect(trustedFontFile("https://fonts.gstatic.com/s/oswald/v57/TK3iWkUHHAIjg752GT8Gl-1PKw.woff2")).not.toBeNull();
  });
});

describe("a family", () => {
  it("downloads its Latin faces once and serves them from disk", async () => {
    const dir = folder(), net = google();
    const fonts = new GoogleFonts(dir, { fetch: net.fetch });
    const oswald = await fonts.faces("oswald");
    expect(oswald.family).toBe("Oswald");
    expect(oswald.faces.map((f) => [f.weight, f.style, f.unicodeRange])).toEqual([["200 700", "normal", "U+0000-00FF, U+0131"], ["200 700", "normal", "U+0000-00FF, U+0131"]]);
    expect(net.urls().sort()).toEqual([
      GOOGLE_LIST_URL, `${GOOGLE_CSS_URL}?family=Oswald:wght@200..700&display=block`,
      "https://fonts.gstatic.com/s/oswald/v57/ext.woff2", "https://fonts.gstatic.com/s/oswald/v57/lat.woff2",
    ].sort());
    // Only Google's three hosts, no redirects, and a browser's user agent for the stylesheet (it names .woff2 only then).
    for (const a of net.asked) {
      expect(["fonts.google.com", "fonts.googleapis.com", "fonts.gstatic.com"]).toContain(new URL(a.url).hostname);
      expect(a.redirect).toBe("error");
    }
    expect(net.asked.find((a) => a.url.includes("css2"))!.agent).toMatch(/Chrome/);
    expect((await fonts.file(oswald.faces[1].file)).toString("latin1")).toBe("wOF2oswald-latin");
    expect(readdirSync(path.join(dir, "files"))).toHaveLength(2);
    await expect(fonts.file("../list.json")).rejects.toThrow(/No such font file/);
    await expect(fonts.file(`${"0".repeat(40)}.woff2`)).rejects.toThrow(/No such font file/);
    // Again, and after a restart: nothing more is fetched.
    await fonts.faces("Oswald");
    await new GoogleFonts(dir, { fetch: net.fetch }).faces("Oswald");
    expect(net.asked).toHaveLength(4);
  });

  it("loads one upright weight for a picker row, and reuses the whole family when it's here", async () => {
    const net = google();
    const fonts = new GoogleFonts(folder(), { fetch: net.fetch });
    const row = await fonts.faces("Oswald", true);
    expect(row).toMatchObject({ preview: true, faces: [{ weight: "400", style: "normal" }] });
    expect(net.urls()).toContain(`${GOOGLE_CSS_URL}?family=Oswald:wght@400&display=block`);
    expect(net.urls()).not.toContain("https://fonts.gstatic.com/s/oswald/v57/ext.woff2");

    const other = google();
    const whole = new GoogleFonts(folder(), { fetch: other.fetch });
    await whole.faces("Oswald");
    const before = other.asked.length;
    expect((await whole.faces("Oswald", true)).faces).toHaveLength(2);
    expect(other.asked).toHaveLength(before);
  });

  it("keeps italic faces as italic", async () => {
    const fonts = new GoogleFonts(folder(), { fetch: google().fetch });
    expect((await fonts.faces("Roboto Mono")).faces.map((f) => [f.weight, f.style])).toEqual([["400", "normal"], ["700", "italic"]]);
  });

  it("refuses a name Google doesn't have, without asking Google for it", async () => {
    const net = google();
    const fonts = new GoogleFonts(folder(), { fetch: net.fetch });
    for (const name of ["Helvetica Neue", "Oswald&text=x", "../../etc", "", 7, null]) await expect(fonts.faces(name)).rejects.toThrow(/no family by that name/);
    expect(net.urls()).toEqual([GOOGLE_LIST_URL]);
  });

  it("refuses a font file that is too big or isn't a font, and saves nothing of the family", async () => {
    for (const bad of [() => new Response(new Uint8Array(MAX_GOOGLE_FONT_FILE + 1)), () => new Response("x", { headers: { "content-length": String(MAX_GOOGLE_FONT_FILE + 1) } }), "<html>not a font</html>"]) {
      const dir = folder();
      const fonts = new GoogleFonts(dir, { fetch: google({ "https://fonts.gstatic.com/s/oswald/v57/ext.woff2": bad }).fetch });
      await expect(fonts.faces("Oswald")).rejects.toThrow(/couldn't be reached/);
      expect(readdirSync(dir)).not.toContain("families");
    }
  });

  it("downloads 4 files at once", async () => {
    let running = 0, peak = 0;
    const slow = () => { running += 1; peak = Math.max(peak, running); return new Promise<Response>((r) => setTimeout(() => { running -= 1; r(new Response(new Uint8Array(woff2("x")))); }, 6)) as unknown as Response; };
    const names = Array.from({ length: 11 }, (_, i) => `f${i}`);
    const css = names.map((n) => face("Bebas Neue", "latin", "400", n)).join("");
    const net = google({ [`${GOOGLE_CSS_URL}?family=Bebas+Neue&display=block`]: css, ...Object.fromEntries(names.map((n) => [`https://fonts.gstatic.com/s/bebasneue/v57/${n}.woff2`, slow])) });
    const fonts = new GoogleFonts(folder(), { fetch: net.fetch });
    expect((await fonts.faces("Bebas Neue")).faces).toHaveLength(11);
    expect(peak).toBe(4);
  });

  it("is fetched again after 30 days, and the saved copy stands in when Google can't be reached", async () => {
    let now = Date.parse("2026-11-23T08:00:00Z");
    const dir = folder(), net = google();
    await new GoogleFonts(dir, { fetch: net.fetch, now: () => now }).faces("Oswald");
    now += GOOGLE_FAMILY_FRESH_MS - 1000;
    const offlineSoon = new GoogleFonts(dir, { fetch: offline, now: () => now });
    expect((await offlineSoon.faces("Oswald")).saved).toBeUndefined();

    now += 2000;
    const stale = await new GoogleFonts(dir, { fetch: offline, now: () => now }).faces("Oswald");
    expect(stale).toMatchObject({ family: "Oswald", saved: true });
    expect(stale.faces).toHaveLength(2);

    const again = google();
    const refreshed = await new GoogleFonts(dir, { fetch: again.fetch, now: () => now }).faces("Oswald");
    expect(refreshed.fetchedAt).toBe(new Date(now).toISOString());
    // The stylesheet is asked again; the files, named by their URLs, are already here.
    expect(again.urls().filter((u) => u.includes("gstatic"))).toEqual([]);
  });

  it("says plainly when it's offline and the family was never saved", async () => {
    const dir = folder();
    await new GoogleFonts(dir, { fetch: google().fetch }).list();
    const fonts = new GoogleFonts(dir, { fetch: offline });
    await expect(fonts.faces("Bebas Neue")).rejects.toMatchObject({ code: "offline", message: "Google Fonts couldn't be reached, and Bebas Neue isn't saved on this computer yet." });
    // With no list either, the built-in names are still known.
    await expect(new GoogleFonts(folder(), { fetch: offline }).faces("Orbitron")).rejects.toMatchObject({ code: "offline" });
  });
});

describe("in the app", () => {
  it("resolves the Google families a face names and reports the ones it couldn't load", async () => {
    const fonts = new GoogleFonts(folder(), { fetch: google().fetch });
    const { loaded, failed } = await fonts.resolve(["Oswald", "oswald", "Helvetica Neue", "Roboto Mono", "Bebas Neue", 4]);
    expect(loaded.map((f) => f.family).sort()).toEqual(["Bebas Neue", "Oswald", "Roboto Mono"]);
    expect(failed).toEqual([]);
    const away = new GoogleFonts(fonts.folder, { fetch: offline });
    expect((await away.resolve(["Oswald"])).loaded).toHaveLength(1);
    const never = new GoogleFonts(folder(), { fetch: offline });
    expect(await never.resolve(["Oswald", "Arial"])).toEqual({ loaded: [], failed: [{ family: "Oswald", message: "Google Fonts couldn't be reached, and Oswald isn't saved on this computer yet." }] });
    expect(await never.resolve("Oswald")).toEqual({ loaded: [], failed: [] });
  });

  it("only reads from Google, so Local-Only Mode lets it through", () => {
    for (const url of [GOOGLE_LIST_URL, `${GOOGLE_CSS_URL}?family=Oswald`, "https://fonts.gstatic.com/s/oswald/v57/lat.woff2"]) expect(uploadsToCoros(new URL(url), "GET")).toBe(false);
  });

  it("answers Studio's routes: the list, a family, its files and resolve", async () => {
    const data = folder();
    const googleFonts = new GoogleFonts(path.join(data, "studio", "google-fonts"), { fetch: google().fetch });
    const studio = new WatchfaceStudio(data, { googleFonts });
    const ask = (route: string, init?: RequestInit) => studio.answer(new Request(`clink://app/api/desktop/studio${route}`, init));
    expect(await (await ask("/fonts/google")).json()).toMatchObject({ source: "google", families: [{ family: "Roboto Mono" }, { family: "Oswald" }, { family: "Bebas Neue" }] });
    const { family } = await (await ask("/fonts/google/family?name=Oswald")).json() as { family: { faces: { file: string }[] } };
    const file = await ask(`/fonts/google/files/${family.faces[0].file}`);
    expect([file.status, file.headers.get("content-type")]).toEqual([200, "font/woff2"]);
    expect(Buffer.from(await file.arrayBuffer()).toString("latin1", 0, 4)).toBe("wOF2");
    expect((await ask("/fonts/google/family?name=Comic%20Sans")).status).toBe(404);
    expect((await ask("/fonts/google/files/..%2Flist.json")).status).toBe(404);
    expect((await ask("/fonts/google/resolve", { method: "POST", body: "{}" })).status).toBe(403);
    const resolved = await (await ask("/fonts/google/resolve", { method: "POST", headers: { "x-clink-hub": "1" }, body: JSON.stringify({ families: ["Bebas Neue", "Menlo"] }) })).json() as { loaded: { family: string }[] };
    expect(resolved.loaded.map((f) => f.family)).toEqual(["Bebas Neue"]);
  });
});
