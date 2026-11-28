// Dragging on the watch without ghosts, rewritten from CorosLink's drag isolation (WatchfaceEditor.tsx's
// isolateDragDesigns and its precomposed drag frames). Before a drag the editor composes two pictures of the face for
// the layers that would move: the face without them (the base) and those layers alone on a transparent sprite. While
// dragging, the base stands in for the face and the sprite follows the pointer; after the drop both stay until the
// face composed at the new place is ready, then it replaces them in one paint. So there's never a frame with the
// artwork in two places, or in none.
import { t } from "@/lib/i18n";
import { chartDragSplit } from "../watchface/engine/chartReadouts";
import { makeWatchfaceDragForegroundDesign } from "../watchface/engine/watchfaceDragIsolation";
import type { WatchfacePreviewScenario } from "../watchface/engine/watchfaceSimulation";
import { allLayersOf, editMode, layersOf, masterSize, renderFace, renderFaceCanvas, rowsOf, spotsOf, type Design, type EditorLayer, type FaceSource, type Mode, type SpotChoice } from "./studioFace";
import { nudge } from "./studioEdits";
import { inkIn, separable, type Box } from "./studioSnap";

/** The face without the moving layers, and the moving layers alone, both `size` px square. */
export interface DragFrames {
  /** Which layers, on which design: the frames are only good for that pair. */
  key: string;
  design: Design;
  base: string;
  /** The moving layers' pixels, cropped to where they are (in the frame's px), or null when nothing could be isolated. */
  sprite: { src: string; x: number; y: number; w: number; h: number } | null;
  size: number;
  /** The layers lifted with the dragged ones (they share a place on the watch), which aren't snap targets. */
  lifted: string[];
  /**
   * What the layers draw, in master px, for snapping (studioSnap.ts): the moving layers' ink (the sprite's box), and
   * each other layer's ink where it can be told apart. Layers missing here snap by their boxes.
   */
  ink: { moving: Box | null; targets: Map<string, Box> };
}

/** Frames are good for these layers at this size, with these states of the shared spots showing. */
export const dragKey = (ids: string[], mode: Mode, size: number, choice: SpotChoice = {}) =>
  `${mode}:${size}:${[...ids].sort().join(",")}:${Object.entries(choice).sort().map(([spot, key]) => `${spot}=${key}`).join(",")}`;

/**
 * The layers that move when these do: them, and any that share their place on the watch (Bluetooth's on, off and
 * airplane images are one position key). Found by moving them a pixel and seeing whose box follows.
 */
export function movingWith(source: FaceSource, root: Design, mode: Mode, layers: EditorLayer[]): EditorLayer[] {
  const moved = editMode(root, mode, (d) => layers.reduce((acc, l) => nudge(acc, l, 1, 1), d));
  if (moved === root) return layers;
  const before = new Map(layersOf(source, root, mode).map((l) => [l.id, l.bounds]));
  const ids = new Set(layers.map((l) => l.id));
  const extra = layersOf(source, moved, mode).filter((l) => {
    const b = before.get(l.id);
    return !ids.has(l.id) && l.visible && b && l.bounds && (l.bounds.x0 !== b.x0 || l.bounds.y0 !== b.y0);
  });
  return extra.length ? [...layers, ...layersOf(source, root, mode).filter((l) => extra.some((e) => e.id === l.id))] : layers;
}

/** The design with the given layers taken off the face, wherever the design keeps each one. */
export function withoutLayers(design: Design, layers: EditorLayer[]): Design {
  const groups = new Set(layers.map((l) => l.layoutGroupId).filter((g): g is string => !!g));
  const sprites = new Set(layers.map((l) => l.spriteId).filter(Boolean));
  const elements = new Set(layers.map((l) => l.backgroundElementId).filter(Boolean));
  const separators = new Set(layers.map((l) => l.staticSeparatorId).filter(Boolean));
  const natives = new Set(layers.map((l) => l.nativeDataId).filter(Boolean));
  const has = (flag: "weatherIndicator" | "ampmIndicator" | "animation") => layers.some((l) => l[flag]);
  return {
    ...design,
    layerVisibility: { ...design.layerVisibility, ...Object.fromEntries([...groups].map((g) => [g, false])) },
    designSprites: (design.designSprites ?? []).filter((s) => !sprites.has(s.id)),
    backgroundElements: (design.backgroundElements ?? []).filter((e) => !elements.has(e.id)),
    staticSeparators: Object.fromEntries(Object.entries(design.staticSeparators ?? {}).map(([id, s]) => [id, separators.has(id as never) ? { ...s, enabled: false } : s])) as Design["staticSeparators"],
    // The chart keeps the readouts it isn't editing in place on the face: only the edited readout and the graph move
    // with it, so only they come off (turning the chart off would lift every readout on the page with them).
    nativeData: design.nativeData ? Object.fromEntries(Object.entries(design.nativeData).map(([id, n]) => [id, !natives.has(id) ? n
      : id === "chart" ? chartDragSplit(chartDragSplit(n, "readout", false), "graph", false) : { ...n, enabled: false }])) : design.nativeData,
    weatherIndicator: has("weatherIndicator") && design.weatherIndicator ? { ...design.weatherIndicator, enabled: false } : design.weatherIndicator,
    ampmIndicator: has("ampmIndicator") && design.ampmIndicator ? { ...design.ampmIndicator, enabled: false } : design.ampmIndicator,
    animation: has("animation") && design.animation ? { ...design.animation, enabled: false } : design.animation,
  };
}

/** Thrown when the frames being composed are no longer wanted (another layer, another edit). */
export class DragFramesDropped extends Error {
  constructor() { super("The drag frames are no longer wanted."); }
}

/**
 * Between drawings: lets the window handle input, and stops when the frames are no longer wanted. Each drawing of a
 * busy face is one long task, so a run of them must not hold the window between them.
 */
async function breathe(live: () => boolean): Promise<void> {
  if (!live()) throw new DragFramesDropped();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (!live()) throw new DragFramesDropped();
}

/**
 * Composes the drag frames. The base is the face without the layers. The sprite comes from two foreground-only
 * drawings (no background colour or picture, so edges keep their real transparency): with the layers and without
 * them; the pixels that differ are the layers'. `live` says whether they're still wanted: once it's false the work
 * stops at the next drawing with DragFramesDropped.
 */
export async function composeDragFrames(
  source: FaceSource, root: Design, mode: Mode, layers: EditorLayer[], size: number, scenario?: WatchfacePreviewScenario, choice?: SpotChoice,
  live: () => boolean = () => true,
): Promise<DragFrames> {
  const lifted = movingWith(source, root, mode, layers);
  const without = (d: Design) => withoutLayers(d, lifted);
  const foreground = (d: Design) => makeWatchfaceDragForegroundDesign(d);
  // One drawing at a time, with the window free between them.
  await breathe(live);
  // Not cut to the round screen: a layer dragged in from the edge shows whole, and the dial clips it on screen.
  const fg = await renderFaceCanvas(source, editMode(root, mode, foreground), mode, size, scenario, false, choice);
  await breathe(live);
  const fgBase = await renderFaceCanvas(source, editMode(root, mode, (d) => foreground(without(d))), mode, size, scenario, false, choice);
  await breathe(live);
  const base = await renderFace(source, editMode(root, mode, without), mode, size, scenario, true, choice);
  await breathe(live);
  const { sprite, rest } = difference(fg, fgBase, size);
  // Decoded now, so swapping them in for the face paints them at once.
  await Promise.all([base, sprite?.src].map((src) => (src ? decode(src).then((img) => img.decode()).catch(() => {}) : null)));
  const toMaster = masterSize(source, mode) / size;
  const toFrame = (b: Box): Box => ({ x0: b.x0 / toMaster, y0: b.y0 / toMaster, x1: b.x1 / toMaster, y1: b.y1 / toMaster });
  const toBox = (b: Box): Box => ({ x0: b.x0 * toMaster, y0: b.y0 * toMaster, x1: b.x1 * toMaster, y1: b.y1 * toMaster });
  // The other layers' ink, from the foreground drawing without the moving ones: each inside its own box, and only
  // where no other box overlaps it (there the pixels can't be told apart).
  const liftedIds = new Set(lifted.map((l) => l.id));
  // A shared spot is one target, by the state the watch is showing.
  const rows = rowsOf(layersOf(source, root, mode), spotsOf(allLayersOf(source, root, mode)), choice);
  const targets = snapTargets(rows, liftedIds);
  const apart = separable(targets);
  const measured = new Map<string, Box>();
  for (const t of targets) {
    if (!apart.has(t.id)) continue;
    const ink = inkIn(rest, size, size, toFrame(t.box));
    if (ink) measured.set(t.id, toBox(ink));
  }
  const overlapping = targets.filter((t) => !apart.has(t.id));
  const frames: DragFrames = {
    key: dragKey(layers.map((l) => l.id), mode, size, choice), design: root, base, sprite, size, lifted: [...liftedIds],
    ink: { moving: sprite ? toBox({ x0: sprite.x, y0: sprite.y, x1: sprite.x + sprite.w, y1: sprite.y + sprite.h }) : null, targets: measured },
  };
  // A layer whose box overlaps another's (the hour's digit cells and the colon) can't be told apart in one drawing, and
  // its padded box doesn't line up with ink. Drawn once more without it, the pixels that change inside its box are its.
  // That's a whole drawing per layer, dozens on a busy face, so it isn't done here: refineDragInk does it once the
  // editor has been still a while. Until then those layers snap by their boxes.
  if (overlapping.length) {
    refinements.set(frames, async (stillLive) => {
      const more = new Map(measured);
      for (const t of overlapping) {
        const row = rows.find((r) => r.id === t.id);
        if (!row) continue;
        await breathe(stillLive);
        const alone = await renderFaceCanvas(source, editMode(root, mode, (d) => foreground(without(withoutLayers(d, [row])))), mode, size, scenario, false, choice)
          .catch(() => null);
        if (!alone) continue;
        const ink = changedIn(rest, alone, size, toFrame(t.box));
        if (ink) more.set(t.id, toBox(ink));
      }
      return { ...frames, ink: { ...frames.ink, targets: more } };
    });
  }
  return frames;
}

/** The overlapping layers' ink still to measure for frames, by composeDragFrames. */
const refinements = new WeakMap<DragFrames, (live: () => boolean) => Promise<DragFrames>>();

/** Whether the frames still have overlapping layers whose ink refineDragInk would measure. */
export const canRefineDragInk = (frames: DragFrames) => refinements.has(frames);

/**
 * The frames with the overlapping layers' ink measured too (one drawing each), for snapping to what they draw rather
 * than their boxes. Stops with DragFramesDropped once `live` is false.
 */
export async function refineDragInk(frames: DragFrames, live: () => boolean): Promise<DragFrames> {
  const refine = refinements.get(frames);
  return refine ? refine(live) : frames;
}

/**
 * Drag frames for one part of a layer that moves on its own (an icon apart from its number): the face with that part
 * taken away (`away`, which must leave everything else where it is), and the part alone on a sprite. Nothing snaps
 * to anything; the frames only spare the face a redraw for every pointer move.
 */
export async function composePartFrames(
  source: FaceSource, root: Design, mode: Mode, key: string, away: (d: Design) => Design, size: number, scenario?: WatchfacePreviewScenario, choice?: SpotChoice,
  live: () => boolean = () => true,
): Promise<DragFrames> {
  const foreground = (d: Design) => makeWatchfaceDragForegroundDesign(d);
  await breathe(live);
  const fg = await renderFaceCanvas(source, editMode(root, mode, foreground), mode, size, scenario, false, choice);
  await breathe(live);
  const fgBase = await renderFaceCanvas(source, editMode(root, mode, (d) => foreground(away(d))), mode, size, scenario, false, choice);
  await breathe(live);
  const base = await renderFace(source, editMode(root, mode, away), mode, size, scenario, true, choice);
  await breathe(live);
  const { sprite } = difference(fg, fgBase, size);
  await Promise.all([base, sprite?.src].map((src) => (src ? decode(src).then((img) => img.decode()).catch(() => {}) : null)));
  const toMaster = masterSize(source, mode) / size;
  return {
    key, design: root, base, sprite, size, lifted: [],
    ink: { moving: sprite ? { x0: sprite.x * toMaster, y0: sprite.y * toMaster, x1: (sprite.x + sprite.w) * toMaster, y1: (sprite.y + sprite.h) * toMaster } : null, targets: new Map() },
  };
}

/** The layers a drag can snap to: what shows on the face, other than the background and what moves. */
export const snapTargets = (layers: EditorLayer[], moving: Set<string>) => layers
  .filter((l) => l.visible && l.bounds && l.kind !== "background" && !moving.has(l.id))
  .map((l) => ({ id: l.id, box: { x0: l.bounds!.x0, y0: l.bounds!.y0, x1: l.bounds!.x1, y1: l.bounds!.y1 } }));

/** A drawing's pixels, read from its wide-gamut canvas so the sprite keeps the face's colours. */
const pixelsOf = (c: HTMLCanvasElement, size: number): ImageData => {
  const x = c.getContext("2d", { colorSpace: "display-p3" })!;
  return x.getImageData(0, 0, size, size, { colorSpace: "display-p3" });
};

/** The pixels of `a` that `b` doesn't have, cropped to their box; and `b`'s pixels. */
function difference(a: HTMLCanvasElement, b: HTMLCanvasElement, size: number): { sprite: DragFrames["sprite"]; rest: Uint8ClampedArray } {
  const pa = pixelsOf(a, size), pb = pixelsOf(b, size).data, d = pa.data;
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i] === pb[i] && d[i + 1] === pb[i + 1] && d[i + 2] === pb[i + 2] && d[i + 3] === pb[i + 3]) { d[i + 3] = 0; continue; }
    const x = p % size, y = (p / size) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { sprite: null, rest: pb };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = canvas(w, h);
  out.getContext("2d", { colorSpace: "display-p3" })!.putImageData(pa, -x0, -y0, x0, y0, w, h);
  return { sprite: { src: out.toDataURL("image/png"), x: x0, y: y0, w, h }, rest: pb };
}

/** The box of the pixels inside `region` where the drawing `b` differs from the pixels `a`, or null. */
function changedIn(a: Uint8ClampedArray, b: HTMLCanvasElement, size: number, region: Box): Box | null {
  // Only the region is read and compared: the rest of the face can't be the layer's.
  const r = {
    x0: Math.max(0, Math.floor(region.x0)), y0: Math.max(0, Math.floor(region.y0)),
    x1: Math.min(size, Math.ceil(region.x1)), y1: Math.min(size, Math.ceil(region.y1)),
  };
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  if (w <= 0 || h <= 0) return null;
  const pb = b.getContext("2d", { colorSpace: "display-p3" })!.getImageData(r.x0, r.y0, w, h, { colorSpace: "display-p3" }).data;
  const mask = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((r.y0 + y) * size + r.x0 + x) * 4, j = (y * w + x) * 4;
      if (a[i] !== pb[j] || a[i + 1] !== pb[j + 1] || a[i + 2] !== pb[j + 2] || a[i + 3] !== pb[j + 3]) mask[i + 3] = 255;
    }
  }
  return inkIn(mask, size, size, region);
}

const canvas = (w: number, h = w): HTMLCanvasElement => Object.assign(document.createElement("canvas"), { width: w, height: h });
const decode = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(t("Couldn't read a drag frame.")));
  img.src = src;
});
