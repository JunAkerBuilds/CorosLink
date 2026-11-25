// Google Fonts in Studio's page. The main process fetches and caches the list and the font files
// (desktop/main/watchface/googleFonts.ts; the page's CSP keeps it off Google); here they are registered with the
// FontFace API from the app's own origin, so the canvas draws and rasterizes a chosen family like an installed font.
// On export it becomes PNG digits like any font, and the face's saved snapshot keeps it drawable offline. Rewritten
// from CorosLink's src/watchfaces/watchfaceGoogleFonts.ts.
import { collectWatchfaceFontUses, forgetWatchfaceFontAvailability, hasWatchfaceFontSnapshot, isWatchfaceFontInstalled, normalizeWatchfaceFontFamily } from "../watchface/engine/watchfaceFontSnapshots";
import { googleFamily, googleFontFile, googleFontList, resolveGoogleFonts, said, type GoogleFamily, type GoogleFamilyFaces, type GoogleFontList } from "./studio";
import type { Design } from "./studioFace";

const HUNDREDS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const key = (family: string) => normalizeWatchfaceFontFamily(family).toLowerCase();

// ───── Pure parts ─────

/** The upright weights a family's faces cover ("200 700" is a variable range). */
export function weightsFromFaces(faces: GoogleFamilyFaces["faces"]): number[] {
  const found = new Set<number>();
  for (const face of faces) {
    if (face.style !== "normal") continue;
    const [lo, hi = lo] = face.weight.split(" ").map(Number);
    for (const w of HUNDREDS) if (w >= lo && w <= hi) found.add(w);
    if (lo === hi && !HUNDREDS.includes(lo)) found.add(lo);
  }
  return [...found].sort((a, b) => a - b);
}

/** A family's weights as a row says them: "400", "400 700", "200–700". */
export function weightLabel(f: Pick<GoogleFamily, "weights" | "range">): string {
  if (f.range) return `${f.range[0]}–${f.range[1]}`;
  return f.weights.length > 3 ? `${f.weights[0]}–${f.weights[f.weights.length - 1]}` : f.weights.join(" ");
}

/** The weight a layer takes when it's given a family: its own if the family has it, else the nearest (bolder on a tie). */
export function nearestWeight(weights: readonly number[], wanted: number): number {
  if (!weights.length) return wanted;
  return weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) || (Math.abs(w - wanted) === Math.abs(best - wanted) && w > best) ? w : best), weights[0]);
}

/**
 * The weight to write with a picked Google family: none when it has the one the layer draws at, else the nearest it
 * has. `loaded` is what its downloaded faces cover; `listed` is what Google's list says, used when that is empty.
 */
export function googleWeightFor(loaded: readonly number[], listed: readonly number[], current: number | undefined): number | undefined {
  const has = loaded.length ? loaded : listed;
  const wanted = current ?? 400;
  return !has.length || has.includes(wanted) ? undefined : nearestWeight(has, wanted);
}

/** Families whose name or kind has every word of the search, in Google's order (most used first). */
export function searchGoogleFonts(families: readonly GoogleFamily[], query: string): GoogleFamily[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...families];
  return families.filter((f) => { const hay = `${f.family} ${f.category}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

/** The families a face names that this computer can't draw yet: the ones to ask Google Fonts for when it opens. */
export function googleFamiliesToLoad(design: Design, installed: (family: string) => boolean = isWatchfaceFontInstalled): string[] {
  const names = collectWatchfaceFontUses(design).map((use) => normalizeWatchfaceFontFamily(use.family)).filter(Boolean);
  return [...new Set(names)].filter((family) => !installed(family));
}

/** What to say when Google fonts a face names couldn't be loaded; `snapshot` says whether the face carries the glyphs. */
export function missingGoogleFontsMessage(families: readonly string[], snapshot: (family: string) => boolean = hasWatchfaceFontSnapshot): string {
  const names = families.length > 2 ? `${families.slice(0, 2).join(", ")} and ${families.length - 2} more` : families.join(" and ");
  const kept = families.every(snapshot);
  return `${names} couldn't be loaded from Google Fonts. ${kept ? "The face draws from its saved snapshot." : "Another font stands in until it can be."}`;
}

// ───── Loading into the page ─────

const added = new Set<string>();
const families = new Map<string, { family: string; weights: number[] }>();
const loading = new Map<string, Promise<GoogleFamilyFaces>>();

/** Registers a family's faces under `as` (its own name, or a row's preview alias). Faces that fail to load are left out. */
async function register(faces: GoogleFamilyFaces, as: string): Promise<void> {
  await Promise.all(faces.faces.map(async (face) => {
    const id = `${as}|${face.file}|${face.weight}|${face.style}`;
    if (added.has(id)) return;
    const font = new FontFace(as, `url("${googleFontFile(face.file)}") format("woff2")`, {
      weight: face.weight, style: face.style, display: "block", ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
    });
    await font.load();
    document.fonts.add(font);
    added.add(id);
  }));
}

function ready(faces: GoogleFamilyFaces): void {
  families.set(key(faces.family), { family: faces.family, weights: weightsFromFaces(faces.faces) });
  // The engine remembers which families it can draw; this one just arrived.
  forgetWatchfaceFontAvailability();
}

/** Loads every weight a family has (fetched once, then from this computer). Throws with Google's reason when it can't. */
export function loadGoogleFamily(family: string): Promise<GoogleFamilyFaces> {
  const k = key(family);
  let pending = loading.get(k);
  if (!pending) {
    pending = googleFamily(family).then(async (faces) => { await register(faces, faces.family); ready(faces); return faces; });
    loading.set(k, pending);
    pending.catch(() => loading.delete(k));
  }
  return pending;
}

/** Whether a family is one loaded from Google Fonts in this session. */
export const isGoogleFamily = (family: string | undefined): boolean => !!family && families.has(key(family));
/** The weights a loaded Google family has, or null for any other font (which takes every weight). */
export const googleWeights = (family: string | undefined): number[] | null => (family ? families.get(key(family))?.weights ?? null : null);

let list: Promise<GoogleFontList> | null = null;
/** Google's families, asked once; asked again after a failure or when Google couldn't be reached. */
export function listGoogleFonts(): Promise<GoogleFontList> {
  list ??= googleFontList().then((l) => { if (l.source !== "google") list = null; return l; }, (e) => { list = null; throw e; });
  return list;
}

/** The family a picker row draws its sample in: one weight, under its own name so it never stands in on the face. */
export const googlePreviewFamily = (family: string) => `st-g ${family}`;

// A row's preview: one upright weight. A few at a time, the row asked for last first (it's the one on screen).
const previews = new Map<string, Promise<boolean>>();
const queue: { family: string; start: () => void }[] = [];
let running = 0;
function pump(): void {
  while (running < 4 && queue.length) {
    running += 1;
    queue.pop()!.start();
  }
}

/** Loads a row's preview face; resolves false when it can't be had. `cancel` drops it if it hasn't started. */
export function loadGooglePreview(family: string): { done: Promise<boolean>; cancel: () => void } {
  const k = key(family);
  const known = previews.get(k);
  if (known) return { done: known, cancel: () => {} };
  let cancel = () => {};
  const done = new Promise<boolean>((resolve) => {
    const item = { family, start: () => {
      googleFamily(family, true).then((faces) => register(faces, googlePreviewFamily(faces.family))).then(() => true, () => false)
        .then((ok) => { running -= 1; if (!ok) previews.delete(k); resolve(ok); pump(); });
    } };
    queue.push(item);
    cancel = () => { const i = queue.indexOf(item); if (i >= 0) { queue.splice(i, 1); previews.delete(k); resolve(false); } };
  });
  previews.set(k, done);
  pump();
  return { done, cancel };
}

/**
 * When a face opens: loads the Google families it names that this computer can't draw. Waits up to `waitMs` so the
 * face first draws in its fonts; a slower answer arrives through `late` (redraw, and say what failed). Offline, the
 * families saved on this computer still load, and the face's own snapshot draws the rest.
 */
export async function openGoogleFonts(design: Design, late: (message?: string) => void, waitMs = 4000): Promise<{ message?: string }> {
  const wanted = googleFamiliesToLoad(design);
  if (!wanted.length) return {};
  const work = (async (): Promise<string | undefined> => {
    let failed: string[];
    try {
      const answer = await resolveGoogleFonts(wanted);
      failed = answer.failed.map((f) => f.family);
      await Promise.all(answer.loaded.map(async (faces) => {
        try { await register(faces, faces.family); ready(faces); } catch { failed.push(faces.family); }
      }));
    } catch (e) {
      // The app itself couldn't be asked; nothing is known about which were Google's.
      return `Fonts couldn't be loaded: ${said(e)}`;
    }
    return failed.length ? missingGoogleFontsMessage(failed) : undefined;
  })();
  let timedOut = false;
  const first = await Promise.race([work.then((message) => ({ message })), new Promise<null>((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, waitMs))]);
  if (first) return first.message ? { message: first.message } : {};
  void work.then((message) => { if (timedOut) late(message); });
  return {};
}
