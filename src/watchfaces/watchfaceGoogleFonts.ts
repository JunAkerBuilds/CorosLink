import { forgetWatchfaceFontAvailability, normalizeWatchfaceFontFamily } from "./watchfaceFontSnapshots.ts";

/**
 * Google Fonts in Studio. A chosen family is loaded into the app from
 * fonts.googleapis.com, so the canvas draws and rasterizes it exactly like an
 * installed font; on export it becomes PNG digits like any other font, and the
 * project's font snapshot keeps it drawable offline. Nothing is installed on
 * the computer.
 */

export type WatchfaceGoogleFontCategory =
  | "Condensed"
  | "Display"
  | "Sans"
  | "Rounded"
  | "Mono & digital"
  | "Serif"
  | "Script";

export const WATCHFACE_GOOGLE_FONT_CATEGORIES: WatchfaceGoogleFontCategory[] = [
  "Condensed", "Display", "Sans", "Rounded", "Mono & digital", "Serif", "Script"
];

/** Families that read well as big digits on a small round screen. */
export const WATCHFACE_GOOGLE_FONTS: Array<{ family: string; category: WatchfaceGoogleFontCategory }> = [
  ...["Bebas Neue", "Oswald", "Teko", "Barlow Condensed", "Saira Condensed", "Roboto Condensed", "Fjalla One", "Pathway Gothic One", "League Gothic", "Big Shoulders Display", "Sofia Sans Condensed", "Encode Sans Condensed", "IBM Plex Sans Condensed", "Antonio", "Six Caps"]
    .map((family) => ({ family, category: "Condensed" as const })),
  ...["Anton", "Rajdhani", "Orbitron", "Audiowide", "Russo One", "Black Ops One", "Bungee", "Chakra Petch", "Exo 2", "Michroma", "Archivo Black", "Staatliches", "Squada One", "Kanit", "Righteous", "Monoton", "Bowlby One", "Saira"]
    .map((family) => ({ family, category: "Display" as const })),
  ...["Inter", "Roboto", "Montserrat", "Poppins", "Manrope", "DM Sans", "Space Grotesk", "Outfit", "Sora", "Lexend", "Urbanist", "Plus Jakarta Sans", "Archivo", "Barlow", "Rubik", "Work Sans", "Figtree", "Red Hat Display", "Josefin Sans"]
    .map((family) => ({ family, category: "Sans" as const })),
  ...["Nunito", "Quicksand", "Comfortaa", "Varela Round", "M PLUS Rounded 1c", "Baloo 2", "Fredoka"]
    .map((family) => ({ family, category: "Rounded" as const })),
  ...["JetBrains Mono", "Space Mono", "IBM Plex Mono", "Roboto Mono", "Share Tech Mono", "VT323", "Major Mono Display", "Press Start 2P", "Silkscreen", "DotGothic16", "Azeret Mono", "Martian Mono", "Fira Code"]
    .map((family) => ({ family, category: "Mono & digital" as const })),
  ...["Playfair Display", "DM Serif Display", "Abril Fatface", "Bodoni Moda", "Cormorant Garamond", "Libre Baskerville", "Fraunces", "Zilla Slab", "Roboto Slab", "Bitter"]
    .map((family) => ({ family, category: "Serif" as const })),
  ...["Pacifico", "Lobster", "Dancing Script", "Caveat", "Permanent Marker", "Kaushan Script"]
    .map((family) => ({ family, category: "Script" as const }))
];

const CSS_ENDPOINT = "https://fonts.googleapis.com/css2";
const REMEMBERED_KEY = "coroslink.watchface.googleFonts";
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
/** What a picker row shows, so previews download only these glyphs. */
export const WATCHFACE_GOOGLE_FONT_SAMPLE = "12:45 Ag";

const loaded = new Map<string, Promise<boolean>>();
const previews = new Map<string, Promise<void>>();

function key(family: string) {
  return normalizeWatchfaceFontFamily(family).toLocaleLowerCase();
}

export function isWatchfaceGoogleFont(family: string): boolean {
  const name = key(family);
  return WATCHFACE_GOOGLE_FONTS.some((font) => font.family.toLocaleLowerCase() === name) ||
    rememberedWatchfaceGoogleFonts().some((font) => font.toLocaleLowerCase() === name);
}

/** Weight words font files append to a family name, longest first. */
const WEIGHT_WORDS: Array<[string, number]> = [
  ["extralight", 200], ["ultralight", 200], ["extrabold", 800], ["ultrabold", 800], ["semibold", 600], ["demibold", 600],
  ["hairline", 100], ["regular", 400], ["normal", 400], ["medium", 500], ["black", 900], ["heavy", 900],
  ["light", 300], ["thin", 100], ["book", 400], ["bold", 700]
];

export interface WatchfaceGoogleFontName {
  /** The Google family, spelled as the catalog spells it. */
  family: string;
  weight: number;
  italic: boolean;
}

/**
 * Reads a font name such as "RobotoBold", "Roboto-Black" or "roboto bold
 * italic" as a Google family plus weight. Template fonts and font files often
 * glue the weight onto the family; Google serves one family with every weight.
 * Null when the base is not a family Studio knows from Google Fonts.
 */
export function parseWatchfaceGoogleFontName(name: string): WatchfaceGoogleFontName | null {
  let rest = normalizeWatchfaceFontFamily(name).toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  if (!rest) return null;
  const compact = (family: string) => family.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const known = [...WATCHFACE_GOOGLE_FONTS.map(font => font.family), ...rememberedWatchfaceGoogleFonts()];
  // A family whose own name ends in a weight word ("Archivo Black") is that family, not a weight of another.
  const exact = () => known.find(candidate => compact(candidate) === rest);
  let italic = false, weight: number | undefined;
  if (exact()) return { family: exact()!, weight: 400, italic };
  if (rest.endsWith("italic")) { italic = true; rest = rest.slice(0, -"italic".length); }
  if (exact()) return { family: exact()!, weight: 400, italic };
  const word = WEIGHT_WORDS.find(([text]) => rest.endsWith(text) && rest.length > text.length);
  if (word) { weight = word[1]; rest = rest.slice(0, -word[0].length); }
  if (!italic && rest.endsWith("italic")) { italic = true; rest = rest.slice(0, -"italic".length); }
  const family = exact();
  return family ? { family, weight: weight ?? 400, italic } : null;
}

export function rememberedWatchfaceGoogleFonts(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberWatchfaceGoogleFont(family: string) {
  try {
    const list = rememberedWatchfaceGoogleFonts().filter((item) => item.toLocaleLowerCase() !== family.toLocaleLowerCase());
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify([family, ...list].slice(0, 40)));
  } catch {
    // Remembering is a convenience; the font still loads this session.
  }
}

function cssUrl(family: string, axis?: string, text?: string) {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  return `${CSS_ENDPOINT}?family=${name}${axis ? `:${axis}` : ""}${text ? `&text=${encodeURIComponent(text)}` : ""}&display=block`;
}

async function fetchCss(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function injectCss(id: string, css: string) {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/**
 * Loads every weight and italic the family has. Each weight is its own
 * request because asking for one the family lacks fails the whole request.
 * Resolves false when Google has no such family or the network is down.
 */
export function loadWatchfaceGoogleFont(family: string): Promise<boolean> {
  const name = normalizeWatchfaceFontFamily(family);
  if (!name || typeof document === "undefined") return Promise.resolve(false);
  const cacheKey = name.toLocaleLowerCase();
  const pending = loaded.get(cacheKey);
  if (pending) return pending;
  const promise = (async () => {
    const sheets = await Promise.all(
      WEIGHTS.flatMap((weight) => [0, 1].map((italic) => fetchCss(cssUrl(name, `ital,wght@${italic},${weight}`))))
    );
    let css = sheets.filter(Boolean).join("\n");
    if (!css) css = (await fetchCss(cssUrl(name))) ?? "";
    if (!css) return false;
    injectCss(`wf-google-font-${cacheKey.replace(/[^a-z0-9]+/g, "-")}`, css);
    await Promise.all(
      WEIGHTS.map((weight) => document.fonts.load(`${weight} 72px "${name}"`, "0123456789").catch(() => []))
    );
    forgetWatchfaceFontAvailability();
    rememberWatchfaceGoogleFont(name);
    return true;
  })();
  loaded.set(cacheKey, promise);
  promise.then((ok) => { if (!ok) loaded.delete(cacheKey); });
  return promise;
}

/** The family a picker row previews with: a tiny subset under its own name. */
export function watchfaceGoogleFontPreviewFamily(family: string): string {
  return `wf-preview ${family}`;
}

/**
 * Downloads just the sample glyphs, so a list of many families stays light.
 * `weight` adds that weight's subset (a row for "Roboto Bold" shows bold).
 */
export function loadWatchfaceGoogleFontPreview(family: string, weight?: number): Promise<void> {
  const cacheKey = `${key(family)}${weight ? `-${weight}` : ""}`;
  const pending = previews.get(cacheKey);
  if (pending) return pending;
  const promise = (async () => {
    const css = await fetchCss(cssUrl(family, weight ? `wght@${weight}` : undefined, `${WATCHFACE_GOOGLE_FONT_SAMPLE}${family}`));
    if (!css) return;
    // Renamed so the subset never stands in for the real family on the face.
    const alias = watchfaceGoogleFontPreviewFamily(family).replace(/'/g, "");
    injectCss(`wf-google-preview-${cacheKey.replace(/[^a-z0-9]+/g, "-")}`, css.replace(/font-family:\s*'[^']*'/g, `font-family: '${alias}'`));
  })();
  previews.set(cacheKey, promise);
  return promise;
}

/**
 * Loads the Google families a design uses that this computer lacks, before the
 * face first draws. Gives up after `timeoutMs` so an offline open is not held.
 */
export async function loadWatchfaceGoogleFontsFor(families: Iterable<string>, isInstalled: (family: string) => boolean, timeoutMs = 5000): Promise<void> {
  const wanted = [...new Set([...families].map(normalizeWatchfaceFontFamily).filter(Boolean))]
    .filter((family) => isWatchfaceGoogleFont(family) && !isInstalled(family));
  if (!wanted.length) return;
  await Promise.race([
    Promise.all(wanted.map(loadWatchfaceGoogleFont)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
  forgetWatchfaceFontAvailability();
}
