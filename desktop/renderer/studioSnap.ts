// Snapping a drag on the watch, rewritten from CorosLink's watchfaceEditorSnapping.ts (snapWatchfaceBounds,
// addSpacingCandidates, pickCandidate, watchfaceAlignmentGuides, watchfaceNeighborMeasurements) and WatchfaceEditor's
// dragInk. Pure maths in master pixels: the editor
// hands in what moves and what stays, and gets back how far to move and which lines to draw.
//
// What lines up is what the layers draw ("ink"), not their boxes, once the drag frames have measured it; until then
// the boxes stand in.

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface SnapTarget { id: string; box: Box }
export type Axis = "x" | "y";

/** What an axis snapped to, kept so the drag holds it until the pointer pulls clearly away. */
export interface SnapHold { value: number; target?: string }

/**
 * A line to draw: on `axis` at `at`, running from `from` to `to` across the other axis, past the layers (`ids`) it
 * lines up with. `face` spans the whole face.
 */
export interface SnapGuide { axis: Axis; at: number; from: number; to: number; ids: string[]; face?: boolean }

export interface SnapInput {
  /** What moves (its ink, or its box), where it was when the drag started. */
  moving: Box;
  dx: number;
  dy: number;
  targets: SnapTarget[];
  /** The face's side, master px. */
  face: number;
  /** How near counts, master px. */
  threshold: number;
  /** Last move's snaps, held until they're 1.5 × threshold away. */
  held?: Partial<Record<Axis, SnapHold>>;
  /** Shift keeps the drag on one axis: the other one never snaps, so the selection stays on its rail. */
  lock?: Axis | null;
}

export interface SnapResult { dx: number; dy: number; held: Partial<Record<Axis, SnapHold>> }

/**
 * A gap to a neighbour, to measure while dragging: along `axis` from `from` to `to`, drawn at `at` across the other
 * axis (the middle of where the two overlap). `equal` when it matches the gap on the other side or the neighbour's own
 * gap beyond it; those neighbour-to-neighbour gaps come too, so both sides of an equal spacing show.
 */
export interface SnapGap { axis: Axis; from: number; to: number; at: number; equal: boolean; ids: string[] }

/** Nearest wins; at the same distance the face's centre, then a layer's line, then an equal spacing. */
interface Candidate extends SnapHold { shift: number; rank: number }

const anchors = (a: number, b: number) => [a, (a + b) / 2, b];
const span = (b: Box, axis: Axis): [number, number] => (axis === "x" ? [b.x0, b.x1] : [b.y0, b.y1]);

export const moveBox = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
export const union = (boxes: Box[]): Box | null => boxes.length
  ? boxes.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }))
  : null;

/**
 * The move with each free axis pulled to the nearest line within the threshold: the face's centre (the moving
 * centre), or another layer's start, centre or end (any of the moving start, centre or end). The nearest wins; at the
 * same distance the face's centre does. A line already snapped to holds until the move is 1.5 × threshold off it.
 */
export function snapMove(input: SnapInput): SnapResult {
  const out: SnapResult = { dx: input.dx, dy: input.dy, held: {} };
  for (const axis of ["x", "y"] as const) {
    if (input.lock && input.lock !== axis) continue;
    const d = axis === "x" ? input.dx : input.dy;
    const [m0, m1] = span(input.moving, axis);
    const mine = anchors(m0 + d, m1 + d);
    const list: Candidate[] = [{ value: input.face / 2, shift: input.face / 2 - mine[1], rank: 0 }];
    for (const t of input.targets) {
      const [t0, t1] = span(t.box, axis);
      for (const value of anchors(t0, t1)) for (const m of mine) list.push({ value, target: t.id, shift: value - m, rank: 1 });
    }
    // Equal spacing with the neighbours in line on this axis: centred between the one before and the one after, or
    // as far from the nearest one as it is from its own neighbour.
    const now = moveBox(input.moving, input.dx, input.dy);
    const before = nearest(now, input.targets, axis, true), after = nearest(now, input.targets, axis, false);
    const size = m1 - m0;
    const spaced = (value: number, moving: number, ids: string[]) => list.push({ value, target: ids.join("|"), shift: value - moving, rank: 2 });
    if (before && after) spaced((span(before.t.box, axis)[1] + span(after.t.box, axis)[0] - size) / 2, mine[0], [before.t.id, after.t.id]);
    const beyondBefore = before && nearest(before.t.box, input.targets, axis, true);
    if (before && beyondBefore) spaced(span(before.t.box, axis)[1] + beyondBefore.gap, mine[0], [beyondBefore.t.id, before.t.id]);
    const beyondAfter = after && nearest(after.t.box, input.targets, axis, false);
    if (after && beyondAfter) spaced(span(after.t.box, axis)[0] - beyondAfter.gap, mine[2], [after.t.id, beyondAfter.t.id]);
    const was = input.held?.[axis];
    const kept = was && list.find((c) => c.value === was.value && c.target === was.target && Math.abs(c.shift) <= input.threshold * 1.5);
    const pick = kept || list.filter((c) => Math.abs(c.shift) <= input.threshold)
      .sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift) || a.rank - b.rank)[0];
    if (!pick) continue;
    if (axis === "x") out.dx += pick.shift; else out.dy += pick.shift;
    out.held[axis] = { value: pick.value, ...(pick.target ? { target: pick.target } : {}) };
  }
  return out;
}

/**
 * Every line the moved selection lines up with (within `tolerance`), not only the one it snapped to: one line per
 * place, running across the selection and every layer on it. The face's centre runs across the whole face.
 */
export function snapGuides(moved: Box, targets: SnapTarget[], face: number, tolerance = 0.75): SnapGuide[] {
  const out: SnapGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    const other: Axis = axis === "x" ? "y" : "x";
    const [m0, m1] = span(moved, axis);
    const mine = anchors(m0, m1);
    if (Math.abs(mine[1] - face / 2) <= tolerance) out.push({ axis, at: face / 2, from: 0, to: face, ids: [], face: true });
    const lines = new Map<number, SnapGuide>();
    for (const t of targets) {
      const [t0, t1] = span(t.box, axis);
      for (const value of anchors(t0, t1)) {
        if (!mine.some((m) => Math.abs(m - value) <= tolerance)) continue;
        if (out.some((g) => g.face && g.axis === axis && Math.abs(g.at - value) <= tolerance)) continue;
        const key = Math.round(value * 4) / 4;
        const [a, b] = span(t.box, other), [c, e] = span(moved, other);
        const was = lines.get(key);
        const ids = was ? (was.ids.includes(t.id) ? was.ids : [...was.ids, t.id]) : [t.id];
        lines.set(key, { axis, at: value, from: Math.min(a, c, was?.from ?? a), to: Math.max(b, e, was?.to ?? b), ids });
      }
    }
    out.push(...lines.values());
  }
  return out;
}

/** Targets whose boxes overlap no other target's: only their ink can be told apart in one drawing of them all. */
export function separable(targets: SnapTarget[]): Set<string> {
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  return new Set(targets.filter((t) => !targets.some((o) => o !== t && hit(o.box, t.box))).map((t) => t.id));
}

/** The box of the pixels in `region` that show (alpha 8 or more) in a `width`-wide RGBA picture, or null. */
export function inkIn(rgba: ArrayLike<number>, width: number, height: number, region: Box): Box | null {
  const left = Math.max(0, Math.floor(region.x0)), top = Math.max(0, Math.floor(region.y0));
  const right = Math.min(width, Math.ceil(region.x1)), bottom = Math.min(height, Math.ceil(region.y1));
  let x0 = right, y0 = bottom, x1 = -1, y1 = -1;
  for (let y = top; y < bottom; y++) {
    for (let x = left, i = (y * width + left) * 4 + 3; x < right; x++, i += 4) {
      if (rgba[i] < 8) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Where two boxes overlap across `axis` (the other axis), or null. */
function across(a: Box, b: Box, axis: Axis): [number, number] | null {
  const other: Axis = axis === "x" ? "y" : "x";
  const [a0, a1] = span(a, other), [b0, b1] = span(b, other);
  const from = Math.max(a0, b0), to = Math.min(a1, b1);
  return to > from ? [from, to] : null;
}

/** The nearest target before (or after) `box` on `axis` that sits beside it (overlapping across), with the gap. */
function nearest(box: Box, targets: SnapTarget[], axis: Axis, before: boolean, tolerance = 0.5) {
  const [b0, b1] = span(box, axis);
  let best: { t: SnapTarget; gap: number; overlap: [number, number] } | null = null;
  for (const t of targets) {
    if (t.box === box) continue;
    const overlap = across(box, t.box, axis);
    if (!overlap) continue;
    const [t0, t1] = span(t.box, axis);
    const gap = before ? b0 - t1 : t0 - b1;
    if (gap < -tolerance) continue;
    if (!best || gap < best.gap) best = { t, gap: Math.max(0, gap), overlap };
  }
  return best;
}

/**
 * The gaps from the moved selection to its nearest neighbour on each side that sits beside it (overlapping across),
 * and the neighbour's own gap beyond when it's equal. Touching or overlapping neighbours have no gap to show.
 */
export function snapGaps(moved: Box, targets: SnapTarget[], tolerance = 0.75): SnapGap[] {
  const out: SnapGap[] = [];
  const gap = (axis: Axis, from: number, to: number, overlap: [number, number], equal: boolean, ids: string[]) =>
    out.push({ axis, from, to, at: (overlap[0] + overlap[1]) / 2, equal, ids });
  for (const axis of ["x", "y"] as const) {
    const [m0, m1] = span(moved, axis);
    const b = nearest(moved, targets, axis, true), a = nearest(moved, targets, axis, false);
    const before = b && b.gap > tolerance ? b : null, after = a && a.gap > tolerance ? a : null;
    const between = !!before && !!after && Math.abs(before.gap - after.gap) <= tolerance;
    const beyondBefore = before && nearest(before.t.box, targets, axis, true);
    const beyondAfter = after && nearest(after.t.box, targets, axis, false);
    const chainBefore = !!beyondBefore && Math.abs(beyondBefore.gap - before!.gap) <= tolerance;
    const chainAfter = !!beyondAfter && Math.abs(beyondAfter.gap - after!.gap) <= tolerance;
    if (before) gap(axis, span(before.t.box, axis)[1], m0, before.overlap, between || chainBefore, [before.t.id]);
    if (after) gap(axis, m1, span(after.t.box, axis)[0], after.overlap, between || chainAfter, [after.t.id]);
    if (chainBefore) gap(axis, span(beyondBefore!.t.box, axis)[1], span(before!.t.box, axis)[0], beyondBefore!.overlap, true, [beyondBefore!.t.id, before!.t.id]);
    if (chainAfter) gap(axis, span(after!.t.box, axis)[1], span(beyondAfter!.t.box, axis)[0], beyondAfter!.overlap, true, [after!.t.id, beyondAfter!.t.id]);
  }
  return out;
}

/**
 * The layers the selection is placed against right now: the ones a line runs past, and the neighbours an equal gap is
 * measured to (a plain gap only measures, so its neighbour isn't outlined).
 */
export function snapPartners(lines: SnapGuide[], gaps: SnapGap[]): Set<string> {
  return new Set([...lines.flatMap((l) => l.ids), ...gaps.filter((g) => g.equal).flatMap((g) => g.ids)]);
}
