// Google Fonts for Studio. The page's Content-Security-Policy keeps it off fonts.googleapis.com, so the main process
// fetches the family list, a family's stylesheet and its font files, keeps them on disk (studio/google-fonts) and
// serves them from the app's own origin; the page registers them with the FontFace API and layers draw with them.
// CorosLink loaded Google's stylesheets straight into its page (src/watchfaces/watchfaceGoogleFonts.ts); this is that
// feature behind this app's sandbox.
//
// - Three hosts only, each for one thing: fonts.google.com/metadata/fonts (the list), fonts.googleapis.com/css2 (a
//   family's faces) and fonts.gstatic.com (the .woff2 files). No redirects; every answer is size-capped.
// - The list is kept for 7 days and a family's faces for 30; a stale one is fetched again, and the copy on disk is
//   used when Google can't be reached. With no list at all, a short built-in list of families stands in.
// - A family's Latin faces are fetched (digits and Latin letters; other scripts only where a family has no Latin
//   subset), 4 files at a time. Nothing is installed on the computer.
// - Only reads from Google, so Local-Only Mode (dataMode.ts), which stops uploads to COROS, has nothing to stop.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Limiter } from "./officialAssets";

export const GOOGLE_LIST_URL = "https://fonts.google.com/metadata/fonts";
export const GOOGLE_CSS_URL = "https://fonts.googleapis.com/css2";
export const GOOGLE_FILE_HOST = "fonts.gstatic.com";
export const GOOGLE_LIST_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const GOOGLE_FAMILY_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LIST = 12 * 1024 * 1024;
const MAX_CSS = 2 * 1024 * 1024;
export const MAX_GOOGLE_FONT_FILE = 5 * 1024 * 1024;
const MAX_FAMILY_FILES = 48;
const MAX_FAMILIES = 4000;
// Google's stylesheet names .woff2 files only to a browser that takes them.
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/;

export class GoogleFontsProblem extends Error {
  constructor(message: string, readonly code = "googleFonts", readonly status = 502) { super(message); }
}

export type GoogleFontCategory = "Sans" | "Serif" | "Display" | "Handwriting" | "Mono";
/** A family as the picker lists it. */
export interface GoogleFamily {
  family: string;
  category: GoogleFontCategory;
  /** The upright weights it has (a variable family lists the hundreds in its range). */
  weights: number[];
  /** The weights it has an italic for (none: the watch slants the upright). */
  italics: number[];
  /** A variable weight axis, when it has one. */
  range?: [number, number];
}
export interface GoogleFontList { families: GoogleFamily[]; source: "google" | "saved" | "builtIn"; fetchedAt?: string }
/** One @font-face of a family, served from this app. */
export interface GoogleFace { weight: string; style: "normal" | "italic"; unicodeRange?: string; file: string }
export interface GoogleFamilyFaces { family: string; faces: GoogleFace[]; fetchedAt: string; preview?: true; saved?: true }

// Families that read well as big digits on a small round screen (CorosLink's list), for when Google's can't be had.
const BUILT_IN: [GoogleFontCategory, string[]][] = [
  ["Sans", ["Bebas Neue", "Oswald", "Teko", "Barlow Condensed", "Saira Condensed", "Roboto Condensed", "Fjalla One", "Antonio", "Inter", "Roboto", "Montserrat", "Poppins", "Manrope", "DM Sans", "Space Grotesk", "Outfit", "Sora", "Lexend", "Urbanist", "Archivo", "Barlow", "Rubik", "Work Sans", "Figtree", "Nunito", "Quicksand", "Rajdhani", "Chakra Petch", "Exo 2", "Kanit", "Saira"]],
  ["Display", ["Anton", "Orbitron", "Audiowide", "Russo One", "Black Ops One", "Bungee", "Michroma", "Archivo Black", "Staatliches", "Righteous", "Monoton", "Comfortaa", "Fredoka", "Press Start 2P", "Silkscreen", "Abril Fatface"]],
  ["Mono", ["JetBrains Mono", "Space Mono", "IBM Plex Mono", "Roboto Mono", "Share Tech Mono", "VT323", "Azeret Mono", "Martian Mono", "Fira Code"]],
  ["Serif", ["Playfair Display", "DM Serif Display", "Bodoni Moda", "Cormorant Garamond", "Libre Baskerville", "Fraunces", "Zilla Slab", "Roboto Slab", "Bitter"]],
  ["Handwriting", ["Pacifico", "Lobster", "Dancing Script", "Caveat", "Permanent Marker", "Kaushan Script"]],
];
export const BUILT_IN_GOOGLE_FAMILIES: GoogleFamily[] = BUILT_IN.flatMap(([category, names]) => names.map((family) => ({ family, category, weights: [400], italics: [] })));

const CATEGORY: Record<string, GoogleFontCategory> = { "Sans Serif": "Sans", Serif: "Serif", Display: "Display", Handwriting: "Handwriting", Monospace: "Mono" };

/** Google's metadata, reduced to what the picker shows, most popular first. Throws when it isn't the list. */
export function parseGoogleFontList(text: string): GoogleFamily[] {
  // The endpoint has at times prefixed its JSON with )]}' against script inclusion.
  const v = JSON.parse(text.replace(/^\)\]\}'\s*/, "")) as { familyMetadataList?: unknown };
  if (!Array.isArray(v.familyMetadataList)) throw new Error("not the list");
  const families: (GoogleFamily & { popularity: number })[] = [];
  for (const raw of v.familyMetadataList.slice(0, MAX_FAMILIES) as Record<string, unknown>[]) {
    const family = raw?.family;
    if (typeof family !== "string" || !NAME.test(family) || !raw.fonts || typeof raw.fonts !== "object") continue;
    const keys = Object.keys(raw.fonts as object);
    const fixed = keys.filter((k) => /^[1-9]00$/.test(k)).map(Number);
    const axis = (Array.isArray(raw.axes) ? raw.axes : []).find((a: { tag?: unknown }) => a?.tag === "wght") as { min?: unknown; max?: unknown } | undefined;
    const range = axis && typeof axis.min === "number" && typeof axis.max === "number" && axis.max > axis.min
      ? [Math.max(1, Math.round(axis.min)), Math.min(1000, Math.round(axis.max))] as [number, number] : undefined;
    const inRange = [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => range && w >= range[0] && w <= range[1]);
    const weights = range ? inRange : fixed.sort((a, b) => a - b);
    if (!weights.length) continue;
    const italics = keys.filter((k) => /^[1-9]00i$/.test(k)).map((k) => Number(k.slice(0, 3))).sort((a, b) => a - b);
    families.push({
      family, category: CATEGORY[String(raw.category)] ?? "Display", weights, italics: range && italics.length ? inRange : italics, ...(range ? { range } : {}),
      popularity: typeof raw.popularity === "number" ? raw.popularity : 1e9,
    });
  }
  if (!families.length) throw new Error("empty list");
  return families.sort((a, b) => a.popularity - b.popularity).map(({ popularity: _p, ...f }) => f);
}

export interface ParsedFace { weight: string; style: "normal" | "italic"; unicodeRange?: string; subset: string; url: string }

/** The @font-face blocks of a css2 stylesheet whose file is a .woff2 on fonts.gstatic.com; anything else is dropped. */
export function parseGoogleCss(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];
  const block = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (let m = block.exec(css); m; m = block.exec(css)) {
    const body = m[2];
    const prop = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim();
    const src = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*format\(\s*['"]woff2['"]\s*\)/.exec(body)?.[1];
    const weight = prop("font-weight") ?? "400", range = prop("unicode-range");
    if (!src || !trustedFontFile(src) || !/^\d{1,4}(?: \d{1,4})?$/.test(weight)) continue;
    if (range && !/^[U+0-9A-Fa-f?,\s-]{1,4000}$/.test(range)) continue;
    faces.push({ weight, style: prop("font-style") === "italic" ? "italic" : "normal", ...(range ? { unicodeRange: range } : {}), subset: m[1] ?? "", url: src });
  }
  return faces;
}

/** A font file is fetched only from fonts.gstatic.com, over https, and only a .woff2 under /s/. */
export function trustedFontFile(value: string): URL | null {
  let u: URL;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== GOOGLE_FILE_HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  return /^\/s\/[a-z0-9]+\/v\d+\/[A-Za-z0-9_-]+\.woff2$/.test(u.pathname) ? u : null;
}

/** The css2 request for a family: every weight it has, upright and italic; one weight (the nearest to regular) for a row's preview. */
export function googleCssUrl(f: GoogleFamily, preview = false): URL {
  const url = new URL(GOOGLE_CSS_URL);
  const regular = f.weights.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best), f.weights[0]);
  const span = f.range ? `${f.range[0]}..${f.range[1]}` : null;
  const upright = preview ? [String(regular)] : span ? [span] : f.weights.map(String);
  const italic = preview || !f.italics.length ? [] : span ? [span] : f.italics.map(String);
  const axis = italic.length ? `ital,wght@${[...upright.map((w) => `0,${w}`), ...italic.map((w) => `1,${w}`)].join(";")}` : `wght@${upright.join(";")}`;
  // A family with only a regular face (and the built-in entries, which don't know their weights) is asked for plainly.
  const plain = f.weights.length === 1 && f.weights[0] === 400 && !f.range && !f.italics.length;
  url.search = `family=${encodeURIComponent(f.family).replace(/%20/g, "+")}${plain ? "" : `:${axis}`}&display=block`;
  return url;
}

export interface GoogleFontsOptions { fetch?: typeof fetch; now?: () => number }

export class GoogleFonts {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private listed: GoogleFontList | null = null;
  private listing: Promise<GoogleFontList> | null = null;
  private readonly loading = new Map<string, Promise<GoogleFamilyFaces>>();
  readonly downloads = new Limiter(4);

  constructor(readonly folder: string, options: GoogleFontsOptions = {}) {
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
  }

  /** A capped GET with no redirects; null when the host can't be reached or says no. */
  private async get(url: URL, max: number, headers: Record<string, string> = {}): Promise<Buffer | null> {
    try {
      const answer = await this.fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!answer.ok || Number(answer.headers.get("content-length") ?? 0) > max) return null;
      const bytes = Buffer.from(await answer.arrayBuffer());
      return bytes.length && bytes.length <= max ? bytes : null;
    } catch { return null; }
  }

  private async write(target: string, bytes: Buffer | string): Promise<void> {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await fs.promises.writeFile(temp, bytes); await fs.promises.rename(temp, target); } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await fs.promises.readFile(file, "utf8")) as T; } catch { return null; }
  }

  // ───── The list ─────

  /** Google's families: from memory or disk while fresh (7 days), else from Google; the saved or built-in list offline. */
  list(): Promise<GoogleFontList> {
    const fresh = (l: GoogleFontList | null) => !!l?.fetchedAt && l.source !== "builtIn" && this.now() - Date.parse(l.fetchedAt) < GOOGLE_LIST_FRESH_MS;
    if (fresh(this.listed)) return Promise.resolve(this.listed!);
    this.listing ??= (async () => {
      const file = path.join(this.folder, "list.json");
      const saved = await this.readJson<GoogleFontList>(file);
      const usable = saved && Array.isArray(saved.families) && saved.families.length ? saved : null;
      if (fresh(usable)) return (this.listed = { ...usable!, source: "google" });
      const bytes = await this.get(new URL(GOOGLE_LIST_URL), MAX_LIST, { accept: "application/json" });
      if (bytes) {
        try {
          const list: GoogleFontList = { families: parseGoogleFontList(bytes.toString("utf8")), source: "google", fetchedAt: new Date(this.now()).toISOString() };
          await this.write(file, JSON.stringify(list)).catch(() => {});
          return (this.listed = list);
        } catch { /* not the list: fall back */ }
      }
      // Not remembered, so the next ask tries Google again.
      return usable ? { ...usable, source: "saved" as const } : { families: BUILT_IN_GOOGLE_FAMILIES, source: "builtIn" as const };
    })().finally(() => { this.listing = null; });
    return this.listing;
  }

  /** The family by its name as Google spells it (case and spaces forgiven), or null when Google has none such. */
  async find(name: unknown): Promise<GoogleFamily | null> {
    if (typeof name !== "string") return null;
    const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wanted = compact(name);
    if (!wanted || wanted.length > 60) return null;
    const { families } = await this.list();
    return families.find((f) => compact(f.family) === wanted) ?? BUILT_IN_GOOGLE_FAMILIES.find((f) => compact(f.family) === wanted) ?? null;
  }

  // ───── A family ─────

  private key(family: string, preview: boolean): string {
    return `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${preview ? ".preview" : ""}`;
  }

  private async filesPresent(faces: GoogleFace[]): Promise<boolean> {
    const found = await Promise.all(faces.map((f) => fs.promises.stat(path.join(this.folder, "files", f.file)).then((s) => s.size > 0, () => false)));
    return faces.length > 0 && found.every(Boolean);
  }

  /**
   * A family's faces, their files on disk: from the cache while fresh (30 days), else from Google, else the cached
   * copy however old. `preview` is one upright weight, for a picker row. Throws "offline" when there's neither.
   */
  faces(name: unknown, preview = false): Promise<GoogleFamilyFaces> {
    const id = `${String(name)}|${preview}`;
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(name, preview).finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  private async load(name: unknown, preview: boolean): Promise<GoogleFamilyFaces> {
    const family = await this.find(name);
    if (!family) throw new GoogleFontsProblem("Google Fonts has no family by that name.", "unknownFamily", 404);
    const manifest = path.join(this.folder, "families", `${this.key(family.family, preview)}.json`);
    const read = async (file: string) => {
      const saved = await this.readJson<GoogleFamilyFaces>(file);
      return saved && Array.isArray(saved.faces) && typeof saved.fetchedAt === "string" && (await this.filesPresent(saved.faces)) ? saved : null;
    };
    // A row's preview is already covered by the whole family, when that's here.
    const saved = (await read(manifest)) ?? (preview ? await read(path.join(this.folder, "families", `${this.key(family.family, false)}.json`)) : null);
    if (saved && this.now() - Date.parse(saved.fetchedAt) < GOOGLE_FAMILY_FRESH_MS) return saved;

    const fetched = await this.fetchFamily(family, preview);
    if (fetched) {
      await this.write(manifest, JSON.stringify(fetched)).catch(() => {});
      return fetched;
    }
    if (saved) return { ...saved, saved: true };
    throw new GoogleFontsProblem(`Google Fonts couldn't be reached, and ${family.family} isn't saved on this computer yet.`, "offline");
  }

  private async fetchFamily(family: GoogleFamily, preview: boolean): Promise<GoogleFamilyFaces | null> {
    const sheet = async (url: URL) => (await this.get(url, MAX_CSS, { "user-agent": BROWSER, accept: "text/css" }))?.toString("utf8") ?? null;
    // A family the list is wrong or silent about (weights it lacks fail the whole request) still has a default face.
    const css = (await sheet(googleCssUrl(family, preview))) ?? (await sheet(googleCssUrl({ ...family, weights: [400], italics: [], range: undefined })));
    if (!css) return null;
    const all = parseGoogleCss(css);
    const latin = all.filter((f) => f.subset === "latin" || f.subset === "latin-ext");
    const wanted = (latin.length ? (preview ? latin.filter((f) => f.subset === "latin") : latin) : all).slice(0, MAX_FAMILY_FILES);
    if (!wanted.length) return null;
    const faces = await Promise.all(wanted.map((face) => this.downloads.run(async (): Promise<GoogleFace | null> => {
      const url = trustedFontFile(face.url);
      if (!url) return null;
      const file = `${createHash("sha256").update(url.href).digest("hex").slice(0, 40)}.woff2`;
      const target = path.join(this.folder, "files", file);
      const have = await fs.promises.stat(target).then((s) => s.size > 0, () => false);
      if (!have) {
        const bytes = await this.get(url, MAX_GOOGLE_FONT_FILE);
        // "wOF2": anything else isn't a font this app will hand to the page.
        if (!bytes || bytes.toString("latin1", 0, 4) !== "wOF2") return null;
        await this.write(target, bytes);
      }
      return { weight: face.weight, style: face.style, ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}), file };
    })));
    const got = faces.filter((f): f is GoogleFace => !!f);
    if (!got.length || got.length < wanted.length) return null;
    return { family: family.family, faces: got, fetchedAt: new Date(this.now()).toISOString(), ...(preview ? { preview: true as const } : {}) };
  }

  /** A cached font file, by the name a family's faces gave it. */
  async file(name: string): Promise<Buffer> {
    if (!/^[a-f0-9]{40}\.woff2$/.test(name)) throw new GoogleFontsProblem("No such font file.", "missing", 404);
    try { return await fs.promises.readFile(path.join(this.folder, "files", name)); } catch { throw new GoogleFontsProblem("No such font file.", "missing", 404); }
  }

  /**
   * The Google families among `names`, with their faces ready: what a face needs when it opens. A name Google doesn't
   * have is left out; one that couldn't be fetched comes back with why.
   */
  async resolve(names: unknown): Promise<{ loaded: GoogleFamilyFaces[]; failed: { family: string; message: string }[] }> {
    const list = (Array.isArray(names) ? names : []).filter((n): n is string => typeof n === "string").slice(0, 24);
    const loaded: GoogleFamilyFaces[] = [], failed: { family: string; message: string }[] = [];
    const found = (await Promise.all(list.map((name) => this.find(name)))).filter((f): f is GoogleFamily => !!f);
    await Promise.all([...new Map(found.map((f) => [f.family, f])).values()].map(async (family) => {
      try { loaded.push(await this.faces(family.family)); } catch (e) { failed.push({ family: family.family, message: e instanceof Error ? e.message : "It couldn't be loaded." }); }
    }));
    return { loaded, failed };
  }

  /** /fonts/google…, or null for Studio's other routes. */
  async answer(request: Request, route: string, url: URL, get: boolean): Promise<Response | null> {
    if (route !== "/fonts/google" && !route.startsWith("/fonts/google/")) return null;
    const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
    if (get && route === "/fonts/google") return json(await this.list());
    if (get && route === "/fonts/google/family") return json({ family: await this.faces(url.searchParams.get("name"), url.searchParams.get("preview") === "1") });
    const m = /^\/fonts\/google\/files\/([a-f0-9]{40}\.woff2)$/.exec(route);
    // A file is named by its Google URL, which changes with the font's version: it never changes under one name.
    if (get && m) return new Response(new Uint8Array(await this.file(m[1])), { headers: { "Content-Type": "font/woff2", "Cache-Control": "max-age=31536000, immutable" } });
    if (!get && route === "/fonts/google/resolve") return json(await this.resolve(((await request.json().catch(() => ({}))) as { families?: unknown }).families));
    return Response.json({ error: { code: "notFound", message: "Not a Studio action." } }, { status: 404 });
  }
}
