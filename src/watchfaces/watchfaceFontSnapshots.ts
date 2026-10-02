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

const loadedSnapshots = new Map<string, LoadedSnapshot[]>();
const capturedSnapshots = new Map<string, Promise<CorosWatchfaceFontSnapshot[]>>();
const installedFamilies = new Map<string, boolean>();
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

  const entries = [...glyphs].map((character) => {
    const metrics = measure.measureText(character);
    const left = finiteOr(metrics.actualBoundingBoxLeft, 0);
    const right = finiteOr(metrics.actualBoundingBoxRight, metrics.width);
    const ascent = finiteOr(metrics.actualBoundingBoxAscent, 0);
    const descent = finiteOr(metrics.actualBoundingBoxDescent, 0);
    const inked = left + right > 0 && ascent + descent > 0;
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
  return {
    width: metrics.width,
    actualBoundingBoxLeft: metrics.actualBoundingBoxLeft ?? 0,
    actualBoundingBoxRight: metrics.actualBoundingBoxRight ?? metrics.width,
    actualBoundingBoxAscent: metrics.actualBoundingBoxAscent ?? 0,
    actualBoundingBoxDescent: metrics.actualBoundingBoxDescent ?? 0,
    fontBoundingBoxAscent: metrics.fontBoundingBoxAscent ?? 0,
    fontBoundingBoxDescent: metrics.fontBoundingBoxDescent ?? 0
  };
}

/** `context.fillText`, drawn from a saved snapshot when the font is missing. */
export function fillWatchfaceText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth?: number
): void {
  const face = snapshotFaceFor(context);
  if (!face || !drawSnapshotText(context, face, text, x, y, maxWidth)) {
    if (maxWidth === undefined) context.fillText(text, x, y);
    else context.fillText(text, x, y, maxWidth);
  }
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
