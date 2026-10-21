import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceFontSnapshot,
  CorosWatchfaceFontSnapshotGlyph,
  CorosWatchfaceModeDesignState
} from "../../electron/types";

/**
 * Desktop fonts only exist on the computer that has them installed, but a
 * design names them by family. Without help, a project shared with someone who
 * lacks the font is previewed and exported with whatever fallback Chromium
 * picks. Saving and exporting therefore records a snapshot of every named face:
 * its glyphs as a white PNG atlas plus the canvas metrics for each one. Where
 * the family is missing, the canvas helpers below draw from that snapshot with
 * the same measurements the live font produced, so layout and exported sprites
 * match the author's. Only glyph pictures travel with a project, never the font
 * file.
 */

type FontStyle = "normal" | "italic";

/**
 * Each face is captured at these sizes and drawn from the nearest one, so
 * glyphs are never scaled far. Shrinking a large capture a long way loses
 * the stroke weight that small native text has.
 */
const SNAPSHOT_FONT_SIZES = [20, 32, 48, 72, 112, 176] as const;
const SNAPSHOT_PADDING = 2;
const SNAPSHOT_ATLAS_WIDTH = 2048;
const SNAPSHOT_GLYPH_GAP = 2;
const MAX_SNAPSHOT_GLYPHS = 512;
const MAX_SNAPSHOT_ATLAS_PIXELS = 24_000_000;
const MAX_CAPTURED_SNAPSHOTS = 24;
const MAX_LAYER_EDGE = 8192;
/** Printable ASCII plus the symbols watch labels and units commonly use. */
const BASE_SNAPSHOT_GLYPHS =
  Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("") +
  "°·–—’";
const SEPARATOR_GLYPHS = ":/";
const CANVAS_BASELINES: CanvasTextBaseline[] = [
  "top",
  "hanging",
  "middle",
  "alphabetic",
  "ideographic",
  "bottom"
];
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "-apple-system"
]);

export interface WatchfaceFontFace {
  family: string;
  weight: number;
  style: FontStyle;
}

export interface WatchfaceFontUse extends WatchfaceFontFace {
  /** Where the design uses this face, such as "Time" or "Date (always-on)". */
  usedBy: string;
}

export interface WatchfaceMissingFont {
  family: string;
  usedBy: string[];
  /** True when a saved snapshot stands in for the family. */
  hasSnapshot: boolean;
}

/** The canvas text measurements the Studio renderers rely on. */
export type WatchfaceTextMetrics = Pick<
  TextMetrics,
  | "width"
  | "actualBoundingBoxLeft"
  | "actualBoundingBoxRight"
  | "actualBoundingBoxAscent"
  | "actualBoundingBoxDescent"
  | "fontBoundingBoxAscent"
  | "fontBoundingBoxDescent"
>;

/** Minimal canvas surface accepted by {@link measureWatchfaceText}. */
export interface WatchfaceTextContext {
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  letterSpacing?: string;
  measureText(text: string): Partial<WatchfaceTextMetrics> &
    Pick<TextMetrics, "width">;
}

interface LoadedSnapshot {
  snapshot: CorosWatchfaceFontSnapshot;
  image: HTMLImageElement;
}

interface BoundFace extends WatchfaceFontFace {
  /** `context.font` as the browser normalized it when the face was bound. */
  font: string;
  size: number;
}

interface SnapshotFace extends LoadedSnapshot {
  scale: number;
}

interface PlacedGlyph {
  character: string;
  /** Null when the snapshot lacks the character; it is drawn natively instead. */
  glyph: CorosWatchfaceFontSnapshotGlyph | null;
  x: number;
}

interface SnapshotTextLayout {
  placed: PlacedGlyph[];
  metrics: WatchfaceTextMetrics;
  /** Horizontal distance from the pen start to the `textAlign` anchor. */
  shift: number;
  /** Vertical distance from the `textBaseline` anchor to the alphabetic baseline. */
  drop: number;
}

/**
 * A weight the family has no face for is drawn from the face the browser
 * picks instead, thinned or thickened by about how much real faces change per
 * 100 of weight (Arial's stems gain 0.055 em from Regular to Bold).
 */
const WEIGHT_STEM_PER_STEP = 0.017;
/** Regular to Thin, or Bold past Black; beyond that strokes vanish or fill the counters. */
const MAX_SYNTHETIC_STEPS = 3;
/** When several weights draw the same face and its weight cannot be measured, it is most likely one of these, in order. */
const LIKELY_FACE_WEIGHTS = [400, 700, 300, 500, 600, 100, 800, 200, 900];
const WEIGHT_PROBE_TEXT = "0123456789Hamo";

const loadedSnapshots = new Map<string, LoadedSnapshot[]>();
const capturedSnapshots = new Map<string, Promise<CorosWatchfaceFontSnapshot[]>>();
const installedFamilies = new Map<string, boolean>();
const drawnFaceWeights = new Map<string, number>();
const boundFaces = new WeakMap<object, BoundFace>();

/** Returns the family a design names, or "" for none and generic families. */
export function normalizeWatchfaceFontFamily(family: string | undefined): string {
  const first = (family ?? "").split(",")[0]?.trim() ?? "";
  const unquoted = first.replace(/^(["'])(.*)\1$/, "$2").trim();
  return GENERIC_FAMILIES.has(unquoted.toLocaleLowerCase()) ? "" : unquoted;
}

function normalizeWeight(weight: number | string | undefined): number {
  const numeric = typeof weight === "string"
    ? weight === "bold" ? 700 : Number.parseFloat(weight)
    : weight;
  const rounded = Math.round((Number.isFinite(numeric) ? Number(numeric) : 400) / 100) * 100;
  return Math.max(100, Math.min(900, rounded));
}

function faceKey(face: WatchfaceFontFace): string {
  return `${face.family.toLocaleLowerCase()}|${face.weight}|${face.style}`;
}

function cssFont(face: WatchfaceFontFace, size: number): string {
  return `${face.style} ${face.weight} ${size}px "${face.family.replace(/["\\]/g, "")}"`;
}

/**
 * Lists every desktop font face a design draws with, including the always-on
 * mode. Faces follow the same inheritance the renderers use: a component style
 * without its own family or weight takes the face-wide one.
 */
export function collectWatchfaceFontUses(
  design: CorosWatchfaceDesignState
): WatchfaceFontUse[] {
  const uses: WatchfaceFontUse[] = [];
  collectModeFontUses(design, design, "", uses);
  const aod = design.modeDesigns?.aod;
  if (aod) collectModeFontUses(aod, design, " (always-on)", uses);
  return uses;
}

function collectModeFontUses(
  mode: CorosWatchfaceModeDesignState,
  base: CorosWatchfaceDesignState,
  suffix: string,
  uses: WatchfaceFontUse[]
): void {
  const add = (
    family: string | undefined,
    weight: number | undefined,
    style: string | undefined,
    usedBy: string
  ) => {
    const name = normalizeWatchfaceFontFamily(family);
    if (!name) return;
    uses.push({
      family: name,
      weight: normalizeWeight(weight),
      style: style === "italic" ? "italic" : "normal",
      usedBy: `${usedBy}${suffix}`
    });
  };
  const family = mode.fontFamily ?? base.fontFamily;
  const weight = mode.fontWeight ?? base.fontWeight;
  const style = mode.fontStyle ?? base.fontStyle;
  add(family, weight, style, "Face-wide font");
  const styled: Array<[string, Record<string, { fontFamily?: string; fontWeight?: number; fontStyle?: string } | undefined> | undefined]> = [
    ["Time", mode.timeStyles],
    ["Metrics", mode.metricStyles],
    ["Date", mode.dateStyles]
  ];
  for (const [label, styles] of styled) {
    for (const item of Object.values(styles ?? {})) {
      add(item?.fontFamily ?? family, item?.fontWeight ?? weight, item?.fontStyle ?? style, label);
    }
  }
  const selectable = mode.selectableMetricStyle;
  if (selectable) {
    add(
      selectable.fontFamily ?? family,
      selectable.fontWeight ?? weight,
      selectable.fontStyle ?? style,
      "Selectable data"
    );
  }
  // Separator glyphs are always drawn bold (watchfaceBackground.ts).
  for (const separator of Object.values(mode.staticSeparators ?? {})) {
    if (separator?.enabled) add(separator.fontFamily ?? family, 700, "normal", "Separators");
  }
  const exerciseSeparator = mode.exerciseSeparator;
  if (exerciseSeparator && exerciseSeparator.enabled !== false && !exerciseSeparator.artwork) {
    add(
      (mode.metricStyles ?? base.metricStyles)?.exercise?.fontFamily || family,
      700,
      "normal",
      "Separators"
    );
  }
  add(mode.ampmIndicator?.fontFamily, 400, "normal", "AM/PM");
  for (const element of mode.backgroundElements ?? []) {
    if (element.kind === "text") add(element.fontFamily, element.weight, "normal", "Text layers");
  }
  for (const native of Object.values(mode.nativeData ?? {})) {
    add(native?.fontFamily, 400, "normal", "Native data");
    for (const part of Object.values(native?.parts ?? {})) {
      add(part?.fontFamily, 400, "normal", "Native data");
    }
  }
}

/**
 * Whether Chromium can draw `family` on this computer: installed locally or
 * loaded by the app. Measures a sample against three generic fallbacks, so the
 * answer matches what the canvas renderers will actually use.
 */
export function isWatchfaceFontInstalled(family: string): boolean {
  const name = normalizeWatchfaceFontFamily(family);
  if (!name || typeof document === "undefined") return true;
  const key = name.toLocaleLowerCase();
  const cached = installedFamilies.get(key);
  if (cached !== undefined) return cached;
  let installed = false;
  document.fonts?.forEach((face) => {
    if (normalizeWatchfaceFontFamily(face.family).toLocaleLowerCase() === key) {
      installed = true;
    }
  });
  const context = installed ? null : document.createElement("canvas").getContext("2d");
  if (context) {
    const sample = "mmmmmmmmmmlli10WQ@#%&";
    const quoted = `"${name.replace(/["\\]/g, "")}"`;
    for (const fallback of ["monospace", "serif", "sans-serif"]) {
      context.font = `72px ${fallback}`;
      const expected = context.measureText(sample);
      context.font = `72px ${quoted}, ${fallback}`;
      const actual = context.measureText(sample);
      if (
        actual.width !== expected.width ||
        actual.actualBoundingBoxAscent !== expected.actualBoundingBoxAscent
      ) {
        installed = true;
        break;
      }
    }
  } else if (!installed) {
    installed = true;
  }
  installedFamilies.set(key, installed);
  return installed;
}

/** Forgets cached font availability, e.g. before re-checking a newly opened project. */
export function forgetWatchfaceFontAvailability(): void {
  installedFamilies.clear();
  drawnFaceWeights.clear();
}

/** Families the design uses that this computer cannot draw. */
export function findMissingWatchfaceFonts(
  design: CorosWatchfaceDesignState
): WatchfaceMissingFont[] {
  const missing = new Map<string, WatchfaceMissingFont>();
  for (const use of collectWatchfaceFontUses(design)) {
    if (isWatchfaceFontInstalled(use.family)) continue;
    const key = use.family.toLocaleLowerCase();
    const entry = missing.get(key) ?? {
      family: use.family,
      usedBy: [],
      hasSnapshot: findLoadedFace(use).length > 0
    };
    if (!entry.usedBy.includes(use.usedBy)) entry.usedBy.push(use.usedBy);
    missing.set(key, entry);
  }
  return [...missing.values()];
}

function isValidSnapshot(value: unknown): value is CorosWatchfaceFontSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<CorosWatchfaceFontSnapshot>;
  return (
    typeof snapshot.family === "string" &&
    Boolean(normalizeWatchfaceFontFamily(snapshot.family)) &&
    Number.isFinite(snapshot.weight) &&
    (snapshot.style === "normal" || snapshot.style === "italic") &&
    Number.isFinite(snapshot.size) &&
    Number(snapshot.size) > 0 &&
    Number.isFinite(snapshot.padding) &&
    typeof snapshot.dataUrl === "string" &&
    snapshot.dataUrl.startsWith("data:image/png;base64,") &&
    Boolean(snapshot.glyphs) &&
    typeof snapshot.glyphs === "object" &&
    Boolean(snapshot.baselines) &&
    typeof snapshot.baselines === "object" &&
    (snapshot.kerning === undefined ||
      (Boolean(snapshot.kerning) && typeof snapshot.kerning === "object"))
  );
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A font snapshot could not be decoded."));
    image.src = dataUrl;
  });
}

/**
 * Makes a project's saved snapshots available to the canvas helpers. They
 * stay loaded for the session, so converted or duplicated designs keep them.
 */
export async function rememberWatchfaceFontSnapshots(
  snapshots: readonly unknown[] | undefined
): Promise<void> {
  if (!Array.isArray(snapshots) || typeof document === "undefined") return;
  await Promise.all(
    snapshots.filter(isValidSnapshot).map(async (snapshot) => {
      const face: WatchfaceFontFace = {
        family: normalizeWatchfaceFontFamily(snapshot.family),
        weight: normalizeWeight(snapshot.weight),
        style: snapshot.style
      };
      const familyKey = face.family.toLocaleLowerCase();
      const loaded = loadedSnapshots.get(familyKey) ?? [];
      if (loaded.some((entry) => entry.snapshot.dataUrl === snapshot.dataUrl)) return;
      const image = await decodeImage(snapshot.dataUrl).catch(() => null);
      if (
        !image ||
        image.naturalWidth * image.naturalHeight > MAX_SNAPSHOT_ATLAS_PIXELS
      ) {
        return;
      }
      const current = (loadedSnapshots.get(familyKey) ?? []).filter(
        (entry) =>
          faceKey(entry.snapshot) !== faceKey(face) ||
          entry.snapshot.size !== snapshot.size
      );
      loadedSnapshots.set(familyKey, [
        ...current,
        { snapshot: { ...snapshot, ...face }, image }
      ]);
    })
  );
}

/**
 * Every loaded size of the face closest to `face`: the same style first, then
 * the nearest weight.
 */
function findLoadedFace(face: WatchfaceFontFace): LoadedSnapshot[] {
  const candidates = loadedSnapshots.get(face.family.toLocaleLowerCase()) ?? [];
  let best: LoadedSnapshot | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score =
      (candidate.snapshot.style === face.style ? 0 : 10_000) +
      Math.abs(candidate.snapshot.weight - face.weight);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best
    ? candidates.filter((candidate) => faceKey(candidate.snapshot) === faceKey(best.snapshot))
    : [];
}

/** The capture whose size needs the least scaling; shrinking beats enlarging. */
function pickSnapshotSize(
  snapshots: readonly LoadedSnapshot[],
  size: number
): LoadedSnapshot | undefined {
  let best: LoadedSnapshot | undefined;
  let bestCost = Infinity;
  for (const candidate of snapshots) {
    const ratio = candidate.snapshot.size / Math.max(0.5, size);
    const cost = ratio >= 1 ? Math.log(ratio) : 1.5 * Math.log(1 / ratio);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

function collectDesignText(design: CorosWatchfaceDesignState): string {
  const parts: string[] = [];
  for (const mode of [design, design.modeDesigns?.aod]) {
    for (const element of mode?.backgroundElements ?? []) {
      if (element.kind === "text") parts.push(element.text);
    }
    for (const native of Object.values(mode?.nativeData ?? {})) {
      for (const texts of Object.values(native?.assetTexts ?? {})) {
        parts.push(...Object.values(texts ?? {}));
      }
    }
  }
  return parts.join("");
}

function snapshotGlyphSet(design: CorosWatchfaceDesignState): string {
  const glyphs = new Set<string>();
  for (const character of BASE_SNAPSHOT_GLYPHS + collectDesignText(design)) {
    if (glyphs.size >= MAX_SNAPSHOT_GLYPHS) break;
    if (!/[\p{Cc}\p{Cf}]/u.test(character)) glyphs.add(character);
  }
  return [...glyphs].join("");
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Thousandths of a pixel are far below what a watch sprite can show. */
function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The face the browser draws for a weight request, found by comparing renders
 * of every weight: a family without a face for the request (Arial has only
 * Regular and Bold) draws the nearest one, so Arial at 200 looks like 400.
 * Requests that draw the same face share its weight. A shared face holding
 * 400 or 700 is taken as Regular or Bold, so those requests never change;
 * any other is placed by its ink between them (Roboto's 800 and 900 draw its
 * Black, Open Sans's draw its ExtraBold). A family that draws one face for
 * every weight (DIN Condensed is only Bold, Impact only Black) gives nothing
 * to place it by, so it draws as it is at every weight.
 */
function drawnFaceWeight(face: WatchfaceFontFace): number {
  const key = faceKey(face);
  const cached = drawnFaceWeights.get(key);
  if (cached !== undefined) return cached;
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d", { willReadFrequently: true });
  if (!canvas || !context) return face.weight;
  canvas.width = 360;
  canvas.height = 48;
  const prints = new Map<number, string>();
  const inks = new Map<number, number>();
  try {
    for (let weight = 100; weight <= 900; weight += 100) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = cssFont({ ...face, weight }, 32);
      context.fillText(WEIGHT_PROBE_TEXT, 4, 36);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      let ink = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        hash = Math.imul(hash ^ pixels[index]!, 16777619);
        ink += pixels[index]!;
      }
      prints.set(weight, `${hash >>> 0}|${context.measureText(WEIGHT_PROBE_TEXT).width}`);
      inks.set(weight, ink);
    }
  } catch {
    // A canvas that cannot be read back draws every weight as requested.
    drawnFaceWeights.set(key, face.weight);
    return face.weight;
  }
  if (new Set(prints.values()).size === 1) {
    for (const weight of prints.keys()) drawnFaceWeights.set(faceKey({ ...face, weight }), weight);
    return face.weight;
  }
  const regularInk = inks.get(400)!;
  const boldInk = inks.get(700)!;
  for (const [weight, print] of prints) {
    const shared = [...prints.keys()].filter((candidate) => prints.get(candidate) === print);
    let drawn = shared.includes(400) ? 400 : shared.includes(700) ? 700 : undefined;
    if (drawn === undefined && boldInk > regularInk) {
      const estimate = 400 + (300 * (inks.get(weight)! - regularInk)) / (boldInk - regularInk);
      drawn = shared.reduce((best, candidate) =>
        Math.abs(candidate - estimate) < Math.abs(best - estimate) ? candidate : best);
    }
    drawn ??= LIKELY_FACE_WEIGHTS.find((candidate) => shared.includes(candidate)) ?? weight;
    drawnFaceWeights.set(faceKey({ ...face, weight }), drawn);
  }
  return drawnFaceWeights.get(key) ?? face.weight;
}

/**
 * How much thicker, in pixels at `size`, the requested weight's strokes are
 * than the face the browser draws: negative thins. Zero when the family has
 * that face.
 */
function syntheticStemChange(face: WatchfaceFontFace, size: number): number {
  const steps = Math.max(-MAX_SYNTHETIC_STEPS,
    Math.min(MAX_SYNTHETIC_STEPS, (face.weight - drawnFaceWeight(face)) / 100));
  return steps * WEIGHT_STEM_PER_STEP * size;
}

/** How far thickened ink reaches past the drawn face's own glyph bounds, in pixels at `size`. */
function syntheticInkGrowth(face: WatchfaceFontFace, size: number): number {
  return Math.max(0, syntheticStemChange(face, size)) / 2;
}

/** Whether the family lacks a face for this weight, so Studio draws it thinner or thicker itself. */
export function isSyntheticWatchfaceWeight(face: WatchfaceFontFace): boolean {
  const family = normalizeWatchfaceFontFamily(face.family);
  return Boolean(family) && syntheticStemChange({ ...face, family, weight: normalizeWeight(face.weight) }, 1) !== 0;
}

/** The stem change for the face bound to `context`, in its pixels; zero when none applies. */
function boundStemChange(context: { font: string }): number {
  const bound = boundFaces.get(context);
  return bound && bound.font === context.font ? syntheticStemChange(bound, bound.size) : 0;
}

/**
 * Thins (negative `radius`) or thickens what a canvas shows by `radius`
 * device pixels. A pixel's coverage reads as how far inside the outline its
 * center sits (0 at half coverage), so each pixel can take its distance to
 * the nearest edge, move it by the radius, and turn it back into coverage:
 * edges stay as sharp as the browser drew them, and a fraction of a pixel
 * still counts. It works on the drawn pixels, because macOS draws glyphs
 * slightly bolder than their outlines, and stroking the outline would leave
 * a faint ring. Only coverage changes; a thickened canvas needs its color
 * refilled.
 */
function reweighCanvasAlpha(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number
): void {
  const reach = Math.abs(radius);
  if (!(reach > 0) || width <= 0 || height <= 0) return;
  const thicken = radius > 0;
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  const coverage = new Float32Array(width * height);
  for (let index = 0; index < coverage.length; index += 1) coverage[index] = data[index * 4 + 3]! / 255;
  // Every pixel within reach of the moved edge, nearest first.
  const limit = reach + 1;
  const span = Math.ceil(limit);
  const offsets: Array<[number, number, number]> = [];
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      const distance = Math.hypot(dx, dy);
      if (distance <= limit) offsets.push([dx, dy, distance]);
    }
  }
  offsets.sort((a, b) => a[2] - b[2]);
  // Only pixels near an edge can change; summed-area counts of partly
  // covered (thinning) or inked (thickening) pixels skip the rest.
  const counts = new Int32Array((width + 1) * (height + 1));
  for (let py = 0; py < height; py += 1) {
    let row = 0;
    for (let px = 0; px < width; px += 1) {
      const value = coverage[py * width + px]!;
      row += thicken ? Number(value > 0) : Number(value < 1);
      counts[(py + 1) * (width + 1) + px + 1] = counts[py * (width + 1) + px + 1]! + row;
    }
  }
  const near = (px: number, py: number) => {
    const x0 = Math.max(0, px - span);
    const y0 = Math.max(0, py - span);
    const x1 = Math.min(width, px + span + 1);
    const y1 = Math.min(height, py + span + 1);
    return counts[y1 * (width + 1) + x1]! - counts[y0 * (width + 1) + x1]! -
      counts[y1 * (width + 1) + x0]! + counts[y0 * (width + 1) + x0]! > 0;
  };
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const index = py * width + px;
      const own = coverage[index]!;
      if ((thicken ? own >= 1 : own <= 0) || !near(px, py)) continue;
      // Thickening looks for the most inside an inked neighbor reaches,
      // thinning for the least inside a neighbor short of full coverage.
      let inside = thicken ? -Infinity : Infinity;
      for (const [dx, dy, distance] of offsets) {
        if (thicken ? 0.5 - distance <= inside : distance - 0.5 >= inside) break;
        const qx = px + dx;
        const qy = py + dy;
        const value = qx < 0 || qy < 0 || qx >= width || qy >= height ? 0 : coverage[qy * width + qx]!;
        if (thicken ? value <= 0 : value >= 1) continue;
        inside = thicken
          ? Math.max(inside, value - 0.5 - distance)
          : Math.min(inside, value - 0.5 + distance);
      }
      const moved = thicken ? inside + reach : inside - reach;
      data[index * 4 + 3] = Math.round(Math.min(1, Math.max(0, moved + 0.5)) * 255);
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * Fills text on a layer around its ink, thins or thickens the layer, then
 * draws it, so the change never touches what the canvas already shows.
 */
function fillReweightedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number | undefined,
  stemChange: number
): boolean {
  try {
    const transform = context.getTransform();
    const metrics = context.measureText(text);
    const growth = Math.max(0, stemChange) / 2;
    const left = x - finiteOr(metrics.actualBoundingBoxLeft, 0) - growth;
    const right = x + finiteOr(metrics.actualBoundingBoxRight, metrics.width) + growth;
    const top = y - finiteOr(metrics.actualBoundingBoxAscent, 0) - growth;
    const bottom = y + finiteOr(metrics.actualBoundingBoxDescent, 0) + growth;
    const corners = [[left, top], [right, top], [left, bottom], [right, bottom]]
      .map(([px, py]) => transform.transformPoint({ x: px, y: py }));
    const x0 = Math.floor(Math.min(...corners.map((point) => point.x))) - 2;
    const y0 = Math.floor(Math.min(...corners.map((point) => point.y))) - 2;
    const width = Math.ceil(Math.max(...corners.map((point) => point.x))) + 2 - x0;
    const height = Math.ceil(Math.max(...corners.map((point) => point.y))) + 2 - y0;
    if (!(width > 0 && height > 0 && width <= MAX_LAYER_EDGE && height <= MAX_LAYER_EDGE)) return false;
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const layerContext = layer.getContext("2d", { willReadFrequently: true });
    if (!layerContext) return false;
    layerContext.setTransform(new DOMMatrix([1, 0, 0, 1, -x0, -y0]).multiply(transform));
    layerContext.font = context.font;
    layerContext.textAlign = context.textAlign;
    layerContext.textBaseline = context.textBaseline;
    layerContext.direction = context.direction;
    layerContext.fontKerning = context.fontKerning;
    if ("letterSpacing" in context) layerContext.letterSpacing = context.letterSpacing;
    layerContext.fillStyle = context.fillStyle;
    if (maxWidth === undefined) layerContext.fillText(text, x, y);
    else layerContext.fillText(text, x, y, maxWidth);
    const scale = Math.sqrt(Math.abs(transform.a * transform.d - transform.b * transform.c));
    reweighCanvasAlpha(layerContext, width, height, (stemChange / 2) * scale);
    if (stemChange > 0) {
      // Grown pixels have coverage but no color yet: refill the fill style,
      // in the text's own coordinates so gradients line up.
      const inverse = layerContext.getTransform().inverse();
      const cover = [[0, 0], [width, 0], [0, height], [width, height]]
        .map(([px, py]) => inverse.transformPoint({ x: px, y: py }));
      const coverX = Math.min(...cover.map((point) => point.x));
      const coverY = Math.min(...cover.map((point) => point.y));
      layerContext.globalCompositeOperation = "source-in";
      layerContext.fillRect(coverX, coverY,
        Math.max(...cover.map((point) => point.x)) - coverX,
        Math.max(...cover.map((point) => point.y)) - coverY);
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(layer, x0, y0);
    context.restore();
    return true;
  } catch {
    // Canvases without transforms or pixel access draw the face as it is.
    return false;
  }
}

/** Pair adjustments (kerning) in pixels at `size`, keyed by both characters. */
function measureKerning(
  face: WatchfaceFontFace,
  glyphs: string,
  size: number
): Record<string, number> {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return {};
  context.font = cssFont(face, size);
  if ("letterSpacing" in context) context.letterSpacing = "0px";
  const characters = [...glyphs];
  const advances = new Map(
    characters.map((character) => [character, context.measureText(character).width])
  );
  const threshold = size * 0.002;
  const kerning: Record<string, number> = {};
  for (const first of characters) {
    for (const second of characters) {
      const pair = first + second;
      const adjustment =
        context.measureText(pair).width - advances.get(first)! - advances.get(second)!;
      if (Math.abs(adjustment) >= threshold) kerning[pair] = adjustment;
    }
  }
  return kerning;
}

function captureSnapshot(
  face: WatchfaceFontFace,
  glyphs: string,
  size: number,
  kerning: Record<string, number>
): CorosWatchfaceFontSnapshot | null {
  const padding = SNAPSHOT_PADDING;
  const font = cssFont(face, size);
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = font;
  measure.textBaseline = "alphabetic";
  if ("letterSpacing" in measure) measure.letterSpacing = "0px";

  // A thickened face's ink, and so its recorded bounds, reach past the drawn face's.
  const stemChange = syntheticStemChange(face, size);
  const growth = syntheticInkGrowth(face, size);
  const entries = [...glyphs].map((character) => {
    const metrics = measure.measureText(character);
    const drawnLeft = finiteOr(metrics.actualBoundingBoxLeft, 0);
    const drawnRight = finiteOr(metrics.actualBoundingBoxRight, metrics.width);
    const drawnAscent = finiteOr(metrics.actualBoundingBoxAscent, 0);
    const drawnDescent = finiteOr(metrics.actualBoundingBoxDescent, 0);
    const inked = drawnLeft + drawnRight > 0 && drawnAscent + drawnDescent > 0;
    const grown = inked ? growth : 0;
    const left = drawnLeft + grown;
    const right = drawnRight + grown;
    const ascent = drawnAscent + grown;
    const descent = drawnDescent + grown;
    return {
      character,
      glyph: {
        advance: roundMetric(metrics.width),
        left: roundMetric(left),
        right: roundMetric(right),
        ascent: roundMetric(ascent),
        descent: roundMetric(descent),
        x: 0,
        y: 0,
        width: inked ? Math.ceil(left + right + padding * 2) : 0,
        height: inked ? Math.ceil(ascent + descent + padding * 2) : 0
      } satisfies CorosWatchfaceFontSnapshotGlyph
    };
  });

  const reference = measure.measureText("H");
  const baselines: Record<string, number> = {};
  for (const baseline of CANVAS_BASELINES) {
    measure.textBaseline = baseline;
    baselines[baseline] =
      reference.actualBoundingBoxAscent - measure.measureText("H").actualBoundingBoxAscent;
  }

  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let atlasWidth = 1;
  for (const { glyph } of entries) {
    if (!glyph.width) continue;
    if (x > 0 && x + glyph.width > SNAPSHOT_ATLAS_WIDTH) {
      x = 0;
      y += rowHeight + SNAPSHOT_GLYPH_GAP;
      rowHeight = 0;
    }
    glyph.x = x;
    glyph.y = y;
    x += glyph.width + SNAPSHOT_GLYPH_GAP;
    rowHeight = Math.max(rowHeight, glyph.height);
    atlasWidth = Math.max(atlasWidth, x);
  }
  const canvas = document.createElement("canvas");
  canvas.width = atlasWidth;
  canvas.height = Math.max(1, y + rowHeight);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = font;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#ffffff";
  if ("letterSpacing" in context) context.letterSpacing = "0px";
  for (const { character, glyph } of entries) {
    if (!glyph.width) continue;
    context.fillText(character, glyph.x + padding + glyph.left, glyph.y + padding + glyph.ascent);
  }
  // Each glyph's cell already holds its thickened ink, so none reaches a neighbor.
  reweighCanvasAlpha(context, canvas.width, canvas.height, stemChange / 2);
  if (stemChange > 0) {
    context.globalCompositeOperation = "source-in";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const largest = SNAPSHOT_FONT_SIZES[SNAPSHOT_FONT_SIZES.length - 1]!;
  return {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size,
    padding,
    fontAscent: finiteOr(reference.fontBoundingBoxAscent, size * 0.8),
    fontDescent: finiteOr(reference.fontBoundingBoxDescent, size * 0.2),
    baselines,
    kerning: Object.fromEntries(
      Object.entries(kerning).map(([pair, adjustment]) => [
        pair,
        Math.round((adjustment * size * 100) / largest) / 100
      ])
    ),
    dataUrl: canvas.toDataURL("image/png"),
    glyphs: Object.fromEntries(entries.map(({ character, glyph }) => [character, glyph]))
  };
}

/** Captures one face at every snapshot size. */
async function captureFace(
  face: WatchfaceFontFace,
  glyphs: string
): Promise<CorosWatchfaceFontSnapshot[]> {
  const largest = SNAPSHOT_FONT_SIZES[SNAPSHOT_FONT_SIZES.length - 1]!;
  try {
    await document.fonts?.load(cssFont(face, largest), glyphs);
  } catch {
    // Local fonts need no loading; measuring below still reflects them.
  }
  // Kerning scales with size, so the largest capture measures it for all.
  const kerning = measureKerning(face, glyphs, largest);
  return SNAPSHOT_FONT_SIZES.flatMap(
    (size) => captureSnapshot(face, glyphs, size, kerning) ?? []
  );
}

/**
 * Returns the design to write into a saved or exported project, carrying
 * snapshots of each desktop face it names. Installed faces are captured fresh;
 * a missing face keeps the snapshots this session loaded for it, so saving on
 * a computer without the font never replaces good glyphs with fallback ones.
 */
export async function attachWatchfaceFontSnapshots(
  design: CorosWatchfaceDesignState
): Promise<CorosWatchfaceDesignState> {
  const { fontSnapshots: _previous, ...rest } = design;
  if (typeof document === "undefined") return rest;
  const faces = new Map<string, WatchfaceFontFace & { textGlyphs: boolean }>();
  for (const use of collectWatchfaceFontUses(design)) {
    const key = faceKey(use);
    faces.set(key, {
      family: use.family,
      weight: use.weight,
      style: use.style,
      textGlyphs: Boolean(faces.get(key)?.textGlyphs) || !use.usedBy.startsWith("Separators")
    });
  }
  if (faces.size === 0) return rest;
  const textGlyphs = snapshotGlyphSet(design);
  const snapshots = new Map<string, CorosWatchfaceFontSnapshot>();
  for (const { textGlyphs: needsText, ...face } of faces.values()) {
    // A face only the separators use draws nothing but their two glyphs.
    const glyphs = needsText ? textGlyphs : SEPARATOR_GLYPHS;
    if (isWatchfaceFontInstalled(face.family)) {
      const captureKey = `${faceKey(face)}|${glyphs}`;
      let pending = capturedSnapshots.get(captureKey);
      if (!pending) {
        pending = captureFace(face, glyphs).catch(() => []);
        capturedSnapshots.set(captureKey, pending);
        // Typing into a text layer changes the glyph set; keep only recent captures.
        for (const staleKey of capturedSnapshots.keys()) {
          if (capturedSnapshots.size <= MAX_CAPTURED_SNAPSHOTS) break;
          capturedSnapshots.delete(staleKey);
        }
      }
      for (const captured of await pending) snapshots.set(captured.dataUrl, captured);
    } else {
      for (const loaded of findLoadedFace(face)) {
        snapshots.set(loaded.snapshot.dataUrl, loaded.snapshot);
      }
    }
  }
  return snapshots.size > 0 ? { ...rest, fontSnapshots: [...snapshots.values()] } : rest;
}

/** Removes saved snapshots from a design entering the editor's live state. */
export function withoutWatchfaceFontSnapshots(
  design: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  if (!("fontSnapshots" in design)) return design;
  const { fontSnapshots: _snapshots, ...rest } = design;
  return rest;
}

/**
 * Sets `context.font` to `font` and records which design face it names, so
 * {@link measureWatchfaceText} and {@link fillWatchfaceText} can substitute a
 * saved snapshot when that family is not installed.
 */
export function setWatchfaceCanvasFont(
  context: { font: string },
  face: { family: string | undefined; size: number; weight?: number | string; style?: string },
  font: string
): void {
  context.font = font;
  const family = normalizeWatchfaceFontFamily(face.family);
  if (!family) {
    boundFaces.delete(context);
    return;
  }
  boundFaces.set(context, {
    family,
    weight: normalizeWeight(face.weight),
    style: face.style === "italic" ? "italic" : "normal",
    size: face.size,
    font: context.font
  });
}

/** Copies a font set with {@link setWatchfaceCanvasFont} onto another canvas. */
export function copyWatchfaceCanvasFont(
  from: { font: string },
  to: { font: string }
): void {
  to.font = from.font;
  const bound = boundFaces.get(from);
  if (bound) boundFaces.set(to, { ...bound, font: to.font });
  else boundFaces.delete(to);
}

function snapshotFaceFor(context: { font: string }): SnapshotFace | null {
  const bound = boundFaces.get(context);
  // A later plain `context.font` assignment means the binding no longer applies.
  if (!bound || bound.font !== context.font) return null;
  if (isWatchfaceFontInstalled(bound.family)) return null;
  // Pick the capture closest to the size the glyphs land at on the canvas.
  const transform = "getTransform" in context
    ? (context as CanvasRenderingContext2D).getTransform()
    : null;
  const density = transform
    ? Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))
    : 1;
  const loaded = pickSnapshotSize(findLoadedFace(bound), bound.size * (density || 1));
  return loaded ? { ...loaded, scale: bound.size / loaded.snapshot.size } : null;
}

function letterSpacingOf(context: { letterSpacing?: string }): number {
  const spacing = Number.parseFloat(context.letterSpacing ?? "");
  return Number.isFinite(spacing) ? spacing : 0;
}

function measureFallbackCharacter(context: WatchfaceTextContext, character: string) {
  const { textAlign, textBaseline, letterSpacing } = context;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  if (letterSpacing !== undefined) context.letterSpacing = "0px";
  const metrics = context.measureText(character);
  context.textAlign = textAlign;
  context.textBaseline = textBaseline;
  if (letterSpacing !== undefined) context.letterSpacing = letterSpacing;
  const left = finiteOr(metrics.actualBoundingBoxLeft ?? 0, 0);
  const right = finiteOr(metrics.actualBoundingBoxRight ?? metrics.width, metrics.width);
  const ascent = finiteOr(metrics.actualBoundingBoxAscent ?? 0, 0);
  const descent = finiteOr(metrics.actualBoundingBoxDescent ?? 0, 0);
  return {
    advance: metrics.width,
    left,
    right,
    ascent,
    descent,
    inked: left + right > 0 && ascent + descent > 0
  };
}

function layoutSnapshotText(
  face: SnapshotFace,
  text: string,
  context: WatchfaceTextContext
): SnapshotTextLayout {
  const { snapshot, scale } = face;
  const spacing = letterSpacingOf(context);
  const placed: PlacedGlyph[] = [];
  let pen = 0;
  let inkLeft = Infinity;
  let inkRight = -Infinity;
  let ascent = -Infinity;
  let descent = -Infinity;
  let previous = "";
  for (const character of text) {
    const glyph = snapshot.glyphs[character] ?? null;
    pen += (snapshot.kerning?.[previous + character] ?? 0) * scale;
    previous = character;
    placed.push({ character, glyph, x: pen });
    // A character typed after the snapshot was saved falls back like the
    // browser would: measured and drawn with the context's own font list.
    const metrics = glyph
      ? {
          advance: glyph.advance * scale,
          left: glyph.left * scale,
          right: glyph.right * scale,
          ascent: glyph.ascent * scale,
          descent: glyph.descent * scale,
          inked: glyph.width > 0
        }
      : measureFallbackCharacter(context, character);
    if (metrics.inked) {
      inkLeft = Math.min(inkLeft, pen - metrics.left);
      inkRight = Math.max(inkRight, pen + metrics.right);
      ascent = Math.max(ascent, metrics.ascent);
      descent = Math.max(descent, metrics.descent);
    }
    pen += metrics.advance + spacing;
  }
  const width = pen;
  const inked = Number.isFinite(inkLeft);
  const shift =
    context.textAlign === "center"
      ? width / 2
      : context.textAlign === "right" || context.textAlign === "end"
        ? width
        : 0;
  const drop = (snapshot.baselines[context.textBaseline] ?? 0) * scale;
  return {
    placed,
    shift,
    drop,
    metrics: {
      width,
      actualBoundingBoxLeft: inked ? shift - inkLeft : 0,
      actualBoundingBoxRight: inked ? inkRight - shift : 0,
      actualBoundingBoxAscent: inked ? ascent - drop : 0,
      actualBoundingBoxDescent: inked ? descent + drop : 0,
      fontBoundingBoxAscent: snapshot.fontAscent * scale - drop,
      fontBoundingBoxDescent: snapshot.fontDescent * scale + drop
    }
  };
}

/** `context.measureText`, answered from a saved snapshot when the font is missing. */
export function measureWatchfaceText(
  context: WatchfaceTextContext,
  text: string
): WatchfaceTextMetrics {
  const face = snapshotFaceFor(context);
  if (face) return layoutSnapshotText(face, text, context).metrics;
  const metrics = context.measureText(text);
  const left = metrics.actualBoundingBoxLeft ?? 0;
  const right = metrics.actualBoundingBoxRight ?? metrics.width;
  const ascent = metrics.actualBoundingBoxAscent ?? 0;
  const descent = metrics.actualBoundingBoxDescent ?? 0;
  // Thickened ink reaches past the drawn face's bounds; the advance stays.
  const growth = left + right > 0 && ascent + descent > 0 ? Math.max(0, boundStemChange(context)) / 2 : 0;
  return {
    width: metrics.width,
    actualBoundingBoxLeft: left + growth,
    actualBoundingBoxRight: right + growth,
    actualBoundingBoxAscent: ascent + growth,
    actualBoundingBoxDescent: descent + growth,
    fontBoundingBoxAscent: metrics.fontBoundingBoxAscent ?? 0,
    fontBoundingBoxDescent: metrics.fontBoundingBoxDescent ?? 0
  };
}

/**
 * `context.fillText`, drawn from a saved snapshot when the font is missing,
 * and thinned or thickened when the family has no face for the bound weight.
 */
export function fillWatchfaceText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth?: number
): void {
  const face = snapshotFaceFor(context);
  if (face && drawSnapshotText(context, face, text, x, y, maxWidth)) return;
  const stemChange = boundStemChange(context);
  if (stemChange !== 0 && fillReweightedText(context, text, x, y, maxWidth, stemChange)) return;
  if (maxWidth === undefined) context.fillText(text, x, y);
  else context.fillText(text, x, y, maxWidth);
}

function drawSnapshotText(
  context: CanvasRenderingContext2D,
  face: SnapshotFace,
  text: string,
  x: number,
  y: number,
  maxWidth: number | undefined
): boolean {
  const { snapshot, image, scale } = face;
  const layout = layoutSnapshotText(face, text, context);
  const pad = snapshot.padding;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { glyph, x: pen } of layout.placed) {
    if (!glyph?.width) continue;
    const left = pen - (glyph.left + pad) * scale;
    const top = -(glyph.ascent + pad) * scale;
    x0 = Math.min(x0, left);
    y0 = Math.min(y0, top);
    x1 = Math.max(x1, left + glyph.width * scale);
    y1 = Math.max(y1, top + glyph.height * scale);
  }
  // Like fillText, squeeze horizontally about the anchor to honor maxWidth.
  const squeeze =
    maxWidth !== undefined && Number.isFinite(maxWidth) && layout.metrics.width > maxWidth
      ? Math.max(0, maxWidth) / layout.metrics.width
      : 1;
  const originX = x - layout.shift;
  // Native canvas text sits its baseline on a whole device pixel.
  let originY = y + layout.drop;
  const transform = context.getTransform();
  if (transform.b === 0 && transform.c === 0 && transform.d !== 0) {
    originY = (Math.round(transform.d * originY + transform.f) - transform.f) / transform.d;
  }
  const fallbacks = layout.placed.filter((placed) => !placed.glyph);
  if (fallbacks.length > 0) {
    context.save();
    context.translate(x, 0);
    context.scale(squeeze, 1);
    context.translate(-x, 0);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    if ("letterSpacing" in context) context.letterSpacing = "0px";
    for (const placed of fallbacks) context.fillText(placed.character, originX + placed.x, originY);
    context.restore();
  }
  if (!Number.isFinite(x0)) return true;

  // Rasterize at the destination's device scale so the glyphs stay crisp.
  const density = Math.max(
    0.05,
    Math.min(
      MAX_LAYER_EDGE / Math.max(1, x1 - x0 + 2),
      MAX_LAYER_EDGE / Math.max(1, y1 - y0 + 2),
      Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))
    )
  );
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.ceil((x1 - x0) * density) + 2);
  layer.height = Math.max(1, Math.ceil((y1 - y0) * density) + 2);
  const layerContext = layer.getContext("2d");
  if (!layerContext) return false;
  layerContext.imageSmoothingEnabled = true;
  layerContext.imageSmoothingQuality = "high";
  for (const { glyph, x: pen } of layout.placed) {
    if (!glyph?.width) continue;
    layerContext.drawImage(
      image,
      glyph.x,
      glyph.y,
      glyph.width,
      glyph.height,
      (pen - (glyph.left + pad) * scale - x0) * density + 1,
      (-(glyph.ascent + pad) * scale - y0) * density + 1,
      glyph.width * scale * density,
      glyph.height * scale * density
    );
  }
  layerContext.globalCompositeOperation = "source-in";
  layerContext.fillStyle = context.fillStyle;
  layerContext.fillRect(0, 0, layer.width, layer.height);
  context.drawImage(
    layer,
    x + (originX + x0 - 1 / density - x) * squeeze,
    originY + y0 - 1 / density,
    (layer.width / density) * squeeze,
    layer.height / density
  );
  return true;
}
