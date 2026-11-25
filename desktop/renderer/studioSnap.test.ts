import { describe, expect, it } from "vitest";
import { inkIn, separable, snapGaps, snapGuides, snapMove, snapPartners, type Box } from "./studioSnap";

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
// A 100 × 40 layer at the top left, and a date layer lower down at x 300–420.
const moving = box(100, 100, 200, 140);
const date = { id: "date", box: box(300, 500, 420, 540) };
const base = { moving, targets: [date], face: 800, threshold: 10 };

describe("studio snapping", () => {
  it("snaps a start, centre or end to another layer's start, centre or end", () => {
    // Left edge 297 → the date's left edge 300.
    expect(snapMove({ ...base, dx: 197, dy: 0 })).toMatchObject({ dx: 200, held: { x: { value: 300, target: "date" } } });
    // Centre 357 → the date's centre 360.
    expect(snapMove({ ...base, dx: 207, dy: 0 }).dx).toBe(210);
    // Bottom 495 → the date's top 500.
    expect(snapMove({ ...base, dx: 0, dy: 355 }).dy).toBe(360);
  });

  it("snaps each axis on its own, to the nearest line", () => {
    const r = snapMove({ ...base, dx: 196, dy: 362 });
    expect(r.dx).toBe(200); // left edge 296 → 300
    expect(r.dy).toBe(360); // top 462… bottom 502 → the date's top 500
  });

  it("keeps the face-centre snap, and it wins a tie", () => {
    // Centre 395 → 400.
    expect(snapMove({ ...base, targets: [], dx: 245, dy: 0 }).dx).toBe(250);
    const onCentre = { id: "c", box: box(390, 0, 410, 20) };
    expect(snapMove({ ...base, targets: [onCentre], dx: 245, dy: 0 }).held.x).toEqual({ value: 400 });
  });

  it("leaves a move alone when nothing is near", () => {
    expect(snapMove({ ...base, dx: 50, dy: 50 })).toEqual({ dx: 50, dy: 50, held: {} });
  });

  it("holds a snap until the pointer pulls 1.5 × the threshold away", () => {
    const wide = { ...base, face: 2000, targets: [{ id: "bar", box: box(300, 500, 700, 540) }] };
    const first = snapMove({ ...wide, dx: 197, dy: 0 });
    // 12 px off: past the threshold, but still held.
    expect(snapMove({ ...wide, dx: 212, dy: 0, held: first.held }).dx).toBe(200);
    // 16 px off: let go.
    expect(snapMove({ ...wide, dx: 216, dy: 0, held: first.held })).toMatchObject({ dx: 216, held: {} });
  });

  it("never snaps the locked-off axis, so a Shift drag stays on its rail", () => {
    const r = snapMove({ ...base, dx: 197, dy: 0, lock: "y" });
    expect(r.dx).toBe(197);
    expect(r.held.x).toBeUndefined();
  });

  it("draws one line per place it lines up, across the selection and every layer on it", () => {
    const other = { id: "steps", box: box(300, 200, 360, 230) };
    const moved = box(300, 600, 400, 640);
    const guides = snapGuides(moved, [date, other], 800);
    // Left edges at 300: one line from the steps (200) down past the selection (640).
    expect(guides).toEqual([{ axis: "x", at: 300, from: 200, to: 640, ids: ["date", "steps"] }]);
  });

  it("draws the face's centre across the whole face", () => {
    expect(snapGuides(box(350, 0, 450, 40), [], 800)).toEqual([{ axis: "x", at: 400, from: 0, to: 800, ids: [], face: true }]);
  });

  it("measures ink only where it's told apart from other layers", () => {
    expect([...separable([date, { id: "a", box: box(0, 0, 10, 10) }, { id: "b", box: box(5, 5, 20, 20) }])]).toEqual(["date"]);
  });

  it("finds the drawn pixels in a region", () => {
    const w = 10, h = 10, px = new Uint8ClampedArray(w * h * 4);
    const dot = (x: number, y: number, a = 255) => { px[(y * w + x) * 4 + 3] = a; };
    dot(3, 4); dot(6, 7); dot(9, 9, 4); // the last one too faint to count
    expect(inkIn(px, w, h, box(0, 0, 10, 10))).toEqual(box(3, 4, 7, 8));
    expect(inkIn(px, w, h, box(0, 0, 5, 5))).toEqual(box(3, 4, 4, 5));
    expect(inkIn(px, w, h, box(7, 0, 10, 3))).toBeNull();
  });
});

describe("studio equal spacing", () => {
  // A row on y 100–140, on a face big enough that its centre is out of the way.
  const row = (...xs: [number, number][]) => xs.map(([x0, x1], i) => ({ id: "abc"[i], box: box(x0, 100, x1, 140) }));
  const along = { moving: box(0, 100, 100, 140), dy: 0, face: 4000, threshold: 10 };

  it("snaps to the same gap as the two layers before it", () => {
    expect(snapMove({ ...along, targets: row([100, 200], [300, 400]), dx: 495 })).toMatchObject({ dx: 500, held: { x: { value: 500, target: "a|b" } } });
  });

  it("snaps to the same gap as the two layers after it", () => {
    expect(snapMove({ ...along, targets: row([300, 400], [500, 600]), dx: 97 }).dx).toBe(100);
  });

  it("snaps to the middle between two layers", () => {
    expect(snapMove({ ...along, targets: row([100, 200], [500, 600]), dx: 296 })).toMatchObject({ dx: 300, held: { x: { target: "a|b" } } });
  });

  it("only counts layers in line with it", () => {
    const off = [{ id: "a", box: box(100, 600, 200, 640) }, { id: "b", box: box(300, 600, 400, 640) }];
    expect(snapMove({ ...along, targets: off, dx: 495 }).dx).toBe(495);
  });

  it("measures the gaps to the neighbours beside it", () => {
    expect(snapGaps(box(450, 100, 550, 140), row([100, 200], [600, 700]))).toEqual([
      { axis: "x", from: 200, to: 450, at: 120, equal: false, ids: ["a"] },
      { axis: "x", from: 550, to: 600, at: 120, equal: false, ids: ["b"] },
    ]);
  });

  it("marks equal gaps, with the neighbour's own gap beyond", () => {
    expect(snapGaps(box(500, 100, 600, 140), row([100, 200], [300, 400]))).toEqual([
      { axis: "x", from: 400, to: 500, at: 120, equal: true, ids: ["b"] },
      { axis: "x", from: 200, to: 300, at: 120, equal: true, ids: ["a", "b"] },
    ]);
    expect(snapGaps(box(300, 100, 400, 140), row([100, 200], [500, 600])).every((g) => g.equal)).toBe(true);
  });

  it("outlines the layers it lines up with and the ones an equal gap is measured to, not a plain gap's", () => {
    const targets = [...row([100, 200], [300, 400]), { id: "c", box: box(500, 300, 520, 320) }];
    const moved = box(500, 100, 600, 140); // equal after a and b, left edge on c's
    expect([...snapPartners(snapGuides(moved, targets, 4000), snapGaps(moved, targets))].sort()).toEqual(["a", "b", "c"]);
    // Beside it but not lined up (their tops, middles and bottoms are elsewhere): measured, not outlined.
    const plain = box(450, 100, 550, 140), beside = [{ id: "a", box: box(100, 80, 200, 130) }, { id: "b", box: box(600, 80, 700, 130) }];
    expect(snapGaps(plain, beside)).toHaveLength(2);
    expect([...snapPartners(snapGuides(plain, beside, 4000), snapGaps(plain, beside))]).toEqual([]);
  });

  it("shows no gap to a layer it touches or overlaps", () => {
    expect(snapGaps(box(180, 100, 280, 140), row([100, 200]))).toEqual([]);
  });
});
