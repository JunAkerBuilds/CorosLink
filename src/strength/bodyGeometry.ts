/**
 * Procedural anatomy for the Strength view's 3D muscle map.
 *
 * There is no rigged human mesh to load, so the figure is generated: every body
 * part is a generalised cylinder — a stack of elliptical rings swept around a
 * near-vertical axis — and every muscle is a *patch* on that same surface,
 * pushed outward along the ring normal. Because the base body and its muscles
 * are evaluated from one shared surface function, muscle plates hug the body
 * exactly instead of floating over it, and their rims melt back into the
 * silhouette the way a real muscle belly does.
 *
 * Authoring notes:
 *   - Y is up, the figure stands with its feet at y = 0 and its crown at 3.43.
 *   - Cross sections are `x = cx + rx·sin θ`, `z = cz + rz·cos θ`, so θ = 0
 *     faces the camera (+Z), θ = π/2 is +X, θ = π is the back.
 *   - Rings are authored bottom-to-top; that ordering is what makes the swept
 *     triangle winding come out facing outward.
 *   - Bilateral parts are built twice with `cx` negated rather than mirrored by
 *     a negative scale, which would invert the winding and the lighting.
 */

import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { MuscleId } from "./muscles";

export interface Ring {
  y: number;
  /** Lateral offset of the ring centre; defaults to the body midline. */
  cx?: number;
  /** Depth offset, used for the head tilt, the seat and the feet. */
  cz?: number;
  rx: number;
  /** Defaults to `rx`, giving a circular cross-section. */
  rz?: number;
}

interface SolidRing {
  y: number;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

/** Samples used to invert y → u; the body is short enough that this is exact
 *  to well under a millimetre at display scale. */
const HEIGHT_LOOKUP = 192;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * One swept body part. `u` runs 0 → 1 from the bottom ring to the top ring;
 * the rings are interpolated with a Catmull-Rom spline so a dozen authored
 * cross-sections produce a smooth limb.
 */
export class BodySegment {
  private readonly rings: SolidRing[];
  private readonly heights: number[] = [];

  constructor(rings: Ring[], mirrored = false) {
    this.rings = rings.map((ring) => ({
      y: ring.y,
      cx: (ring.cx ?? 0) * (mirrored ? -1 : 1),
      cz: ring.cz ?? 0,
      rx: ring.rx,
      rz: ring.rz ?? ring.rx
    }));

    for (let i = 0; i <= HEIGHT_LOOKUP; i += 1) {
      this.heights.push(this.sample(i / HEIGHT_LOOKUP).y);
    }
  }

  get bottom(): number {
    return this.rings[0].y;
  }

  get top(): number {
    return this.rings[this.rings.length - 1].y;
  }

  sample(u: number): SolidRing {
    const rings = this.rings;
    const last = rings.length - 1;
    const scaled = Math.min(1, Math.max(0, u)) * last;
    const index = Math.min(last - 1, Math.floor(scaled));
    const t = scaled - index;

    const p0 = rings[Math.max(0, index - 1)];
    const p1 = rings[index];
    const p2 = rings[index + 1];
    const p3 = rings[Math.min(last, index + 2)];

    return {
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      cx: catmullRom(p0.cx, p1.cx, p2.cx, p3.cx, t),
      cz: catmullRom(p0.cz, p1.cz, p2.cz, p3.cz, t),
      rx: Math.max(0, catmullRom(p0.rx, p1.rx, p2.rx, p3.rx, t)),
      rz: Math.max(0, catmullRom(p0.rz, p1.rz, p2.rz, p3.rz, t))
    };
  }

  /** Inverse of `sample(u).y`. Heights are monotonic, so a scan of the
   *  precomputed table plus one linear step is enough. */
  uAtY(y: number): number {
    const heights = this.heights;
    if (y <= heights[0]) {
      return 0;
    }
    if (y >= heights[heights.length - 1]) {
      return 1;
    }
    for (let i = 1; i < heights.length; i += 1) {
      if (heights[i] >= y) {
        const span = heights[i] - heights[i - 1];
        const t = span > 1e-6 ? (y - heights[i - 1]) / span : 0;
        return (i - 1 + t) / HEIGHT_LOOKUP;
      }
    }
    return 1;
  }

  /** Surface point at (u, θ), displaced `offset` along the radial normal. */
  point(u: number, theta: number, offset: number, target: Vector3): Vector3 {
    const ring = this.sample(u);
    return target.set(
      ring.cx + (ring.rx + offset) * Math.sin(theta),
      ring.y,
      ring.cz + (ring.rz + offset) * Math.cos(theta)
    );
  }
}

/** Sweep a closed tube along a segment, optionally capping the ends. */
export function buildTube(
  segment: BodySegment,
  options: { radial?: number; axial?: number; capTop?: boolean; capBottom?: boolean } = {}
): BufferGeometry {
  const radial = options.radial ?? 40;
  const axial = options.axial ?? 44;

  const positions: number[] = [];
  const indices: number[] = [];
  const scratch = new Vector3();

  for (let j = 0; j <= axial; j += 1) {
    const u = j / axial;
    for (let i = 0; i <= radial; i += 1) {
      const theta = (i / radial) * Math.PI * 2;
      segment.point(u, theta, 0, scratch);
      positions.push(scratch.x, scratch.y, scratch.z);
    }
  }

  const stride = radial + 1;
  for (let j = 0; j < axial; j += 1) {
    for (let i = 0; i < radial; i += 1) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      indices.push(a, b, d, b, c, d);
    }
  }

  const cap = (u: number, upward: boolean) => {
    const ring = segment.sample(u);
    const centre = positions.length / 3;
    positions.push(ring.cx, ring.y, ring.cz);
    const first = positions.length / 3;
    for (let i = 0; i <= radial; i += 1) {
      const theta = (i / radial) * Math.PI * 2;
      segment.point(u, theta, 0, scratch);
      positions.push(scratch.x, scratch.y, scratch.z);
    }
    for (let i = 0; i < radial; i += 1) {
      if (upward) {
        indices.push(centre, first + i, first + i + 1);
      } else {
        indices.push(centre, first + i + 1, first + i);
      }
    }
  };

  if (options.capTop) {
    cap(1, true);
  }
  if (options.capBottom) {
    cap(0, false);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A muscle outline: the angular span the belly covers at a given height. */
export interface SpanStop {
  y: number;
  /** Start angle in radians, using the θ convention documented above. */
  from: number;
  to: number;
}

export interface MusclePatchDef {
  id: MuscleId;
  /** Which body part the belly sits on. */
  part: BodyPartName;
  /** Build the patch on both sides, mirroring the angular span. */
  bilateral?: boolean;
  span: SpanStop[];
  /** Peak height of the belly above the base surface. */
  bulge: number;
  /** Wrap the patch all the way around the limb (deltoid, forearm). */
  wrap?: boolean;
  /** Rounded bellies use an ellipsoidal falloff; plates keep a flatter crown
   *  and steeper seam wall. */
  profile?: "plate" | "belly";
  /**
   * A narrow longitudinal crest above the main belly. The model sheet uses
   * these on the deltoids, pectorals, quadriceps and calves: the extra relief
   * is small in silhouette but is what makes grazing light describe fibre
   * direction instead of reading each muscle as a plain capsule.
   */
  ridge?: number;
  /** Normalized angular position of the crest across the patch. */
  ridgePosition?: number;
  /** Normalized half-width of the crest. */
  ridgeWidth?: number;
}

/**
 * How much of the patch is spent ramping up to full height. Small values give
 * a plateau with steep walls, which is what reads as a defined muscle: the
 * wall catches a highlight on top and drops the rim into shadow.
 */
const EDGE_U = 0.1;
const EDGE_V = 0.12;

/** Patches never quite touch the body, so their rims can't z-fight with it. */
const LIFT = 0.0035;

function pad(t: number, edge: number): number {
  return smoothstep(t / edge) * smoothstep((1 - t) / edge);
}

function spanAt(span: SpanStop[], y: number): { from: number; to: number } {
  if (y <= span[0].y) {
    return { from: span[0].from, to: span[0].to };
  }
  const last = span[span.length - 1];
  if (y >= last.y) {
    return { from: last.from, to: last.to };
  }
  for (let i = 1; i < span.length; i += 1) {
    if (span[i].y >= y) {
      const a = span[i - 1];
      const b = span[i];
      /* Eased rather than linear, so the outline has no visible corners at
         the authored stops. */
      const t = smoothstep((y - a.y) / (b.y - a.y));
      return {
        from: a.from + (b.from - a.from) * t,
        to: a.to + (b.to - a.to) * t
      };
    }
  }
  return { from: last.from, to: last.to };
}

/**
 * Build one muscle belly as a height field over the body surface. The mesh is
 * a grid in (height, angle); its displacement plateaus in the middle and falls
 * back to the body at the rim, so the patch is a closed-looking pad rather
 * than a floating shell.
 */
export function buildMusclePatch(
  segment: BodySegment,
  def: MusclePatchDef,
  mirrored: boolean,
  resolution: { rows?: number; cols?: number } = {}
): BufferGeometry {
  const rows = resolution.rows ?? 26;
  const cols = resolution.cols ?? 22;

  const span = mirrored
    ? def.span.map((stop) => ({ y: stop.y, from: -stop.to, to: -stop.from }))
    : def.span;

  const y0 = span[0].y;
  const y1 = span[span.length - 1].y;

  const positions: number[] = [];
  const indices: number[] = [];
  const scratch = new Vector3();

  for (let j = 0; j <= rows; j += 1) {
    const v = j / rows;
    const y = y0 + (y1 - y0) * v;
    const u = segment.uAtY(y);
    const bounds = spanAt(span, y);
    const rounded = def.profile === "belly";
    const heightPad = rounded
      ? Math.pow(Math.sin(Math.PI * v), 0.72)
      : pad(v, EDGE_U);

    for (let i = 0; i <= cols; i += 1) {
      const t = i / cols;
      const theta = bounds.from + (bounds.to - bounds.from) * t;
      const anglePad = def.wrap
        ? 1
        : rounded
          ? Math.pow(Math.sin(Math.PI * t), 0.72)
          : pad(t, EDGE_V);
      const ridgePosition = def.ridgePosition ?? 0.5;
      const ridgeWidth = Math.max(0.04, def.ridgeWidth ?? 0.22);
      const ridgeDistance = Math.abs(t - ridgePosition) / ridgeWidth;
      const ridge =
        def.ridge && ridgeDistance < 1
          ? def.ridge *
            heightPad *
            anglePad *
            Math.pow(1 - ridgeDistance, 2.2)
          : 0;
      const offset = LIFT + def.bulge * heightPad * anglePad + ridge;
      segment.point(u, theta, offset, scratch);
      positions.push(scratch.x, scratch.y, scratch.z);
    }
  }

  const stride = cols + 1;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      /* Mirroring swaps *and* negates the span bounds, so θ still sweeps
         upward and the winding — hence the outward normal — is unchanged. */
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

export type BodyPartName =
  | "torso"
  | "head"
  | "upperArm"
  | "forearm"
  | "hand"
  | "thigh"
  | "shin"
  | "foot";

/** Overall height of the standing figure, used to frame the camera. */
export const FIGURE_HEIGHT = 3.43;

interface PartDef {
  rings: Ring[];
  /** Bilateral parts are instantiated once per side. */
  paired: boolean;
  capTop?: boolean;
  capBottom?: boolean;
  radial?: number;
  axial?: number;
}

/**
 * Adjacent parts deliberately overlap in y — the thigh's top rings sit inside
 * the pelvis, the forearm's inside the elbow — so the union reads as one body
 * and no cap is ever visible from outside.
 */
export const BODY_PARTS: Record<BodyPartName, PartDef> = {
  torso: {
    paired: false,
    capTop: true,
    capBottom: true,
    radial: 56,
    axial: 72,
    rings: [
      { y: 1.46, rx: 0.262, rz: 0.202 },
      { y: 1.58, rx: 0.306, rz: 0.222 },
      { y: 1.7, rx: 0.326, rz: 0.23 },
      { y: 1.84, rx: 0.324, rz: 0.224, cz: 0.002 },
      { y: 1.98, rx: 0.3, rz: 0.208, cz: 0.004 },
      { y: 2.12, rx: 0.286, rz: 0.198, cz: 0.004 },
      { y: 2.26, rx: 0.306, rz: 0.208, cz: 0.002 },
      { y: 2.4, rx: 0.346, rz: 0.229 },
      { y: 2.54, rx: 0.378, rz: 0.244, cz: -0.002 },
      { y: 2.66, rx: 0.392, rz: 0.242, cz: -0.006 },
      { y: 2.76, rx: 0.382, rz: 0.226, cz: -0.012 },
      { y: 2.84, rx: 0.322, rz: 0.2, cz: -0.018 },
      { y: 2.89, rx: 0.205, rz: 0.158, cz: -0.02 },
      { y: 2.94, rx: 0.146, rz: 0.134, cz: -0.018 },
      { y: 3.0, rx: 0.138, rz: 0.128, cz: -0.016 }
    ]
  },
  head: {
    paired: false,
    capTop: true,
    capBottom: true,
    radial: 40,
    axial: 34,
    rings: [
      { y: 2.95, rx: 0.108, rz: 0.116, cz: 0.012 },
      { y: 3.02, rx: 0.142, rz: 0.15, cz: 0.014 },
      { y: 3.09, rx: 0.164, rz: 0.174, cz: 0.01 },
      { y: 3.18, rx: 0.174, rz: 0.182, cz: 0.002 },
      { y: 3.27, rx: 0.168, rz: 0.172, cz: -0.006 },
      { y: 3.35, rx: 0.14, rz: 0.142, cz: -0.01 },
      { y: 3.41, rx: 0.064, rz: 0.066, cz: -0.012 },
      /* A near-zero final ring so the crown's cap is too small to read as a
         flat spot when the camera tilts above the figure. */
      { y: 3.425, rx: 0.016, rz: 0.018, cz: -0.014 }
    ]
  },
  upperArm: {
    paired: true,
    capTop: true,
    capBottom: true,
    radial: 32,
    axial: 40,
    rings: [
      { y: 2.12, cx: 0.594, rx: 0.082, rz: 0.088 },
      { y: 2.2, cx: 0.576, rx: 0.09, rz: 0.098 },
      { y: 2.32, cx: 0.548, rx: 0.102, rz: 0.11 },
      { y: 2.46, cx: 0.516, rx: 0.116, rz: 0.124 },
      { y: 2.58, cx: 0.486, rx: 0.116, rz: 0.126 },
      { y: 2.68, cx: 0.462, rx: 0.124, rz: 0.134 },
      { y: 2.76, cx: 0.446, rx: 0.128, rz: 0.138 },
      { y: 2.84, cx: 0.432, rx: 0.112, rz: 0.122 },
      { y: 2.88, cx: 0.422, rx: 0.076, rz: 0.084 },
      { y: 2.9, cx: 0.416, rx: 0.032, rz: 0.04 }
    ]
  },
  forearm: {
    paired: true,
    capTop: true,
    capBottom: true,
    radial: 30,
    axial: 34,
    rings: [
      { y: 1.68, cx: 0.728, rx: 0.052, rz: 0.058 },
      { y: 1.76, cx: 0.718, rx: 0.06, rz: 0.066 },
      { y: 1.84, cx: 0.704, rx: 0.074, rz: 0.082 },
      { y: 1.94, cx: 0.682, rx: 0.092, rz: 0.104 },
      { y: 2.04, cx: 0.652, rx: 0.102, rz: 0.114 },
      { y: 2.14, cx: 0.616, rx: 0.098, rz: 0.11 },
      { y: 2.22, cx: 0.576, rx: 0.084, rz: 0.094 }
    ]
  },
  hand: {
    paired: true,
    capTop: true,
    capBottom: true,
    radial: 26,
    axial: 26,
    rings: [
      { y: 1.34, cx: 0.77, rx: 0.052, rz: 0.038 },
      { y: 1.42, cx: 0.766, rx: 0.064, rz: 0.048 },
      { y: 1.52, cx: 0.758, rx: 0.076, rz: 0.058 },
      { y: 1.62, cx: 0.746, rx: 0.078, rz: 0.062 },
      { y: 1.7, cx: 0.73, rx: 0.066, rz: 0.056 },
      { y: 1.75, cx: 0.718, rx: 0.054, rz: 0.05 }
    ]
  },
  thigh: {
    paired: true,
    capTop: true,
    capBottom: true,
    radial: 38,
    axial: 48,
    rings: [
      { y: 0.82, cx: 0.14, rx: 0.098 },
      { y: 0.92, cx: 0.142, rx: 0.108 },
      { y: 1.02, cx: 0.145, rx: 0.12 },
      { y: 1.16, cx: 0.149, rx: 0.138 },
      { y: 1.32, cx: 0.154, rx: 0.158 },
      { y: 1.48, cx: 0.158, rx: 0.174 },
      { y: 1.62, cx: 0.161, rx: 0.184 },
      { y: 1.74, cx: 0.161, rx: 0.186 },
      { y: 1.82, cx: 0.158, rx: 0.176 },
      { y: 1.86, cx: 0.155, rx: 0.152 }
    ]
  },
  shin: {
    paired: true,
    capTop: true,
    capBottom: true,
    radial: 34,
    axial: 44,
    rings: [
      { y: 0.1, cx: 0.124, rx: 0.05 },
      { y: 0.18, cx: 0.125, rx: 0.058 },
      { y: 0.28, cx: 0.127, rx: 0.07 },
      { y: 0.4, cx: 0.13, rx: 0.09 },
      { y: 0.54, cx: 0.134, rx: 0.11 },
      { y: 0.66, cx: 0.137, rx: 0.118 },
      { y: 0.76, cx: 0.139, rx: 0.114 },
      { y: 0.86, cx: 0.14, rx: 0.108 },
      { y: 0.96, cx: 0.14, rx: 0.102 }
    ]
  },
  foot: {
    paired: true,
    capTop: true,
    capBottom: true,
    radial: 28,
    axial: 26,
    rings: [
      { y: 0.0, cx: 0.132, cz: 0.078, rx: 0.112, rz: 0.218 },
      { y: 0.05, cx: 0.132, cz: 0.064, rx: 0.116, rz: 0.226 },
      { y: 0.11, cx: 0.13, cz: 0.02, rx: 0.09, rz: 0.152 },
      { y: 0.16, cx: 0.128, cz: -0.008, rx: 0.064, rz: 0.084 },
      { y: 0.2, cx: 0.126, cz: -0.014, rx: 0.052, rz: 0.06 }
    ]
  }
};

const PI = Math.PI;
const TAU = Math.PI * 2;

/**
 * Every muscle belly on the figure. Unlike the old flat map there is no
 * front/back split — the whole body is built once and the camera decides what
 * you can see. Several bellies share a muscle id on purpose: the six-pack, the
 * three quadriceps heads and the two gastrocnemius heads all read far better
 * as separate plates with grooves between them.
 *
 * Neighbouring bellies are authored to stop a little short of each other. The
 * base body showing through those gaps is what draws the separation lines.
 */
export const MUSCLE_PATCHES: MusclePatchDef[] = [
  // ---- Neck and shoulder girdle ----
  {
    id: "neck",
    part: "torso",
    bilateral: true,
    bulge: 0.016,
    span: [
      { y: 2.86, from: 0.03, to: 0.98 },
      { y: 2.93, from: 0.05, to: 0.9 },
      { y: 3.0, from: 0.07, to: 0.74 }
    ]
  },
  {
    /* The slope from the neck to the point of the shoulder — the only part of
       the trapezius that reads from the front. */
    id: "traps",
    part: "torso",
    bilateral: true,
    bulge: 0.024,
    span: [
      { y: 2.78, from: 0.22, to: 0.96 },
      { y: 2.86, from: 0.2, to: 0.86 },
      { y: 2.94, from: 0.18, to: 0.6 }
    ]
  },
  {
    /* The trapezius kite across the upper back: widest at the shoulder line,
       tapering to a point between the shoulder blades. */
    id: "traps",
    part: "torso",
    bulge: 0.032,
    profile: "belly",
    span: [
      { y: 2.3, from: PI - 0.18, to: PI + 0.18 },
      { y: 2.48, from: PI - 0.38, to: PI + 0.38 },
      { y: 2.64, from: PI - 0.66, to: PI + 0.66 },
      { y: 2.76, from: PI - 0.88, to: PI + 0.88 },
      { y: 2.86, from: PI - 0.8, to: PI + 0.8 },
      { y: 3.0, from: PI - 0.44, to: PI + 0.44 }
    ]
  },
  {
    /* Front/lateral and rear deltoid shells meet at the side ridge. They use
       the same semantic material, but the narrow base-body seam gives the
       cap the reference's pointed lower edge instead of a cylindrical wrap. */
    id: "shoulders",
    part: "upperArm",
    bilateral: true,
    bulge: 0.026,
    profile: "belly",
    ridge: 0.008,
    ridgeWidth: 0.24,
    span: [
      { y: 2.5, from: -0.52, to: 0.54 },
      { y: 2.64, from: -1.34, to: 1.42 },
      { y: 2.78, from: -1.28, to: 1.34 },
      { y: 2.89, from: -0.62, to: 0.66 }
    ]
  },
  {
    id: "shoulders",
    part: "upperArm",
    bilateral: true,
    bulge: 0.025,
    profile: "belly",
    ridge: 0.007,
    span: [
      { y: 2.5, from: 2.52, to: 3.72 },
      { y: 2.64, from: 1.7, to: 4.62 },
      { y: 2.78, from: 1.76, to: 4.56 },
      { y: 2.89, from: 2.44, to: 3.82 }
    ]
  },

  // ---- Chest and core ----
  {
    id: "chest",
    part: "torso",
    bilateral: true,
    bulge: 0.043,
    profile: "belly",
    ridge: 0.008,
    ridgePosition: 0.58,
    ridgeWidth: 0.3,
    span: [
      { y: 2.3, from: 0.08, to: 0.7 },
      { y: 2.4, from: 0.045, to: 1.08 },
      { y: 2.54, from: 0.035, to: 1.29 },
      { y: 2.66, from: 0.05, to: 1.26 },
      { y: 2.77, from: 0.1, to: 1.0 }
    ]
  },
  ...[
    { y0: 2.3, y1: 2.43 },
    { y0: 2.16, y1: 2.285 },
    { y0: 2.02, y1: 2.145 }
  ].map<MusclePatchDef>(({ y0, y1 }) => ({
    id: "abs",
    part: "torso",
    bilateral: true,
    bulge: 0.028,
    span: [
      { y: y0, from: 0.075, to: 0.64 },
      { y: (y0 + y1) * 0.5, from: 0.03, to: 0.72 },
      { y: y1, from: 0.075, to: 0.64 }
    ]
  })),
  {
    /* The lower belly of the rectus, narrower than the blocks above it. */
    id: "abs",
    part: "torso",
    bilateral: true,
    bulge: 0.026,
    span: [
      { y: 1.86, from: 0.07, to: 0.48 },
      { y: 1.93, from: 0.03, to: 0.62 },
      { y: 2.005, from: 0.07, to: 0.54 }
    ]
  },
  {
    /* Paired triangular lower-abdominal plates continue the teal core into
       the pelvis instead of leaving the large rectangular base-body gap that
       made the previous render look assembled from disconnected blocks. */
    id: "abs",
    part: "torso",
    bilateral: true,
    bulge: 0.026,
    span: [
      { y: 1.5, from: 0.04, to: 0.22 },
      { y: 1.64, from: 0.035, to: 0.5 },
      { y: 1.82, from: 0.03, to: 0.64 },
      { y: 1.88, from: 0.03, to: 0.54 }
    ]
  },
  {
    id: "obliques",
    part: "torso",
    bilateral: true,
    bulge: 0.026,
    span: [
      { y: 1.84, from: 0.72, to: 1.06 },
      { y: 2.0, from: 0.8, to: 1.28 },
      { y: 2.16, from: 0.82, to: 1.4 },
      { y: 2.32, from: 0.84, to: 1.36 }
    ]
  },
  ...[
    { y0: 2.28, y1: 2.4, a0: 0.9, a1: 1.44 },
    { y0: 2.39, y1: 2.5, a0: 0.98, a1: 1.5 },
    { y0: 2.49, y1: 2.59, a0: 1.06, a1: 1.52 }
  ].map<MusclePatchDef>(({ y0, y1, a0, a1 }) => ({
    id: "obliques",
    part: "torso",
    bilateral: true,
    bulge: 0.018,
    profile: "belly",
    span: [
      { y: y0, from: a0, to: a1 },
      { y: y1, from: a0 + 0.08, to: a1 - 0.02 }
    ]
  })),

  // ---- Back ----
  {
    id: "lats",
    part: "torso",
    bilateral: true,
    bulge: 0.044,
    ridge: 0.008,
    ridgePosition: 0.62,
    ridgeWidth: 0.34,
    span: [
      { y: 1.94, from: 2.4, to: 3.0 },
      { y: 2.12, from: 1.94, to: 3.0 },
      { y: 2.32, from: 1.58, to: 2.96 },
      { y: 2.5, from: 1.34, to: 2.78 },
      { y: 2.66, from: 1.3, to: 2.54 }
    ]
  },
  {
    id: "lowerBack",
    part: "torso",
    bulge: 0.026,
    span: [
      { y: 1.78, from: PI - 0.76, to: PI + 0.76 },
      { y: 1.94, from: PI - 0.66, to: PI + 0.66 },
      { y: 2.14, from: PI - 0.48, to: PI + 0.48 },
      { y: 2.34, from: PI - 0.24, to: PI + 0.24 }
    ]
  },
  {
    id: "glutes",
    part: "torso",
    bilateral: true,
    bulge: 0.062,
    profile: "belly",
    span: [
      { y: 1.48, from: 2.34, to: 3.06 },
      { y: 1.6, from: 2.1, to: 3.1 },
      { y: 1.72, from: 2.02, to: 3.12 },
      { y: 1.84, from: 2.1, to: 3.1 },
      { y: 1.94, from: 2.34, to: 3.02 }
    ]
  },

  // ---- Arms ----
  {
    id: "biceps",
    part: "upperArm",
    bilateral: true,
    bulge: 0.032,
    profile: "belly",
    ridge: 0.006,
    ridgeWidth: 0.32,
    span: [
      { y: 2.1, from: -0.7, to: 0.7 },
      { y: 2.32, from: -0.96, to: 1.0 },
      { y: 2.46, from: -1.02, to: 1.06 },
      { y: 2.6, from: -0.9, to: 0.96 }
    ]
  },
  {
    id: "triceps",
    part: "upperArm",
    bilateral: true,
    bulge: 0.039,
    profile: "belly",
    ridge: 0.006,
    ridgePosition: 0.44,
    ridgeWidth: 0.34,
    span: [
      { y: 2.1, from: 2.36, to: 3.94 },
      { y: 2.32, from: 2.18, to: 4.1 },
      { y: 2.46, from: 2.14, to: 4.14 },
      { y: 2.62, from: 2.22, to: 4.04 }
    ]
  },
  {
    id: "forearms",
    part: "forearm",
    bilateral: true,
    bulge: 0.022,
    profile: "belly",
    ridge: 0.003,
    ridgePosition: 0.62,
    span: [
      { y: 1.7, from: -0.54, to: 0.62 },
      { y: 1.86, from: -0.66, to: 0.8 },
      { y: 2.04, from: -0.72, to: 0.88 },
      { y: 2.2, from: -0.46, to: 0.58 }
    ]
  },
  {
    id: "forearms",
    part: "forearm",
    bilateral: true,
    bulge: 0.024,
    profile: "belly",
    ridge: 0.003,
    span: [
      { y: 1.72, from: 0.74, to: 1.46 },
      { y: 1.9, from: 0.66, to: 1.8 },
      { y: 2.08, from: 0.62, to: 1.9 },
      { y: 2.2, from: 0.76, to: 1.64 }
    ]
  },
  {
    id: "forearms",
    part: "forearm",
    bilateral: true,
    bulge: 0.019,
    profile: "belly",
    ridge: 0.003,
    span: [
      { y: 1.7, from: 2.02, to: 4.04 },
      { y: 1.88, from: 1.88, to: 4.22 },
      { y: 2.06, from: 1.82, to: 4.3 },
      { y: 2.2, from: 2.04, to: 4.06 }
    ]
  },

  // ---- Legs ----
  {
    /* Rectus femoris down the front of the thigh. */
    id: "quads",
    part: "thigh",
    bilateral: true,
    bulge: 0.04,
    profile: "belly",
    ridge: 0.009,
    ridgeWidth: 0.25,
    span: [
      { y: 0.98, from: -0.34, to: 0.34 },
      { y: 1.18, from: -0.42, to: 0.44 },
      { y: 1.42, from: -0.46, to: 0.48 },
      { y: 1.66, from: -0.42, to: 0.46 },
      { y: 1.76, from: -0.3, to: 0.34 }
    ]
  },
  {
    /* Vastus lateralis, sweeping round the outside of the thigh. */
    id: "quads",
    part: "thigh",
    bilateral: true,
    bulge: 0.039,
    profile: "belly",
    ridge: 0.008,
    ridgePosition: 0.6,
    span: [
      { y: 1.02, from: 0.42, to: 0.96 },
      { y: 1.24, from: 0.5, to: 1.42 },
      { y: 1.48, from: 0.54, to: 1.74 },
      { y: 1.7, from: 0.56, to: 1.84 },
      { y: 1.8, from: 0.58, to: 1.56 }
    ]
  },
  {
    /* Vastus medialis — the teardrop just above the knee. */
    id: "quads",
    part: "thigh",
    bilateral: true,
    bulge: 0.038,
    profile: "belly",
    ridge: 0.007,
    span: [
      { y: 0.94, from: -0.8, to: -0.42 },
      { y: 1.06, from: -1.1, to: -0.5 },
      { y: 1.2, from: -1.22, to: -0.54 },
      { y: 1.36, from: -1.06, to: -0.56 }
    ]
  },
  {
    id: "adductors",
    part: "thigh",
    bilateral: true,
    bulge: 0.032,
    profile: "belly",
    span: [
      { y: 1.1, from: -1.56, to: -1.2 },
      { y: 1.3, from: -1.94, to: -1.24 },
      { y: 1.52, from: -2.16, to: -1.28 },
      { y: 1.74, from: -2.12, to: -1.3 }
    ]
  },
  {
    /* Biceps femoris, the outer hamstring. */
    id: "hamstrings",
    part: "thigh",
    bilateral: true,
    bulge: 0.038,
    profile: "belly",
    ridge: 0.007,
    span: [
      { y: 0.98, from: 2.5, to: 3.08 },
      { y: 1.2, from: 2.18, to: 3.08 },
      { y: 1.44, from: 1.98, to: 3.06 },
      { y: 1.68, from: 1.88, to: 3.04 },
      { y: 1.78, from: 2.06, to: 3.0 }
    ]
  },
  {
    /* Semitendinosus, the inner hamstring. */
    id: "hamstrings",
    part: "thigh",
    bilateral: true,
    bulge: 0.036,
    profile: "belly",
    ridge: 0.006,
    span: [
      { y: 0.98, from: 3.22, to: 3.66 },
      { y: 1.2, from: 3.2, to: 3.84 },
      { y: 1.46, from: 3.2, to: 4.0 },
      { y: 1.7, from: 3.22, to: 4.06 }
    ]
  },
  {
    /* Lateral head of the gastrocnemius. */
    id: "calves",
    part: "shin",
    bilateral: true,
    bulge: 0.04,
    profile: "belly",
    ridge: 0.007,
    span: [
      { y: 0.4, from: 2.6, to: 3.12 },
      { y: 0.55, from: 2.26, to: 3.12 },
      { y: 0.72, from: 2.16, to: 3.1 },
      { y: 0.86, from: 2.22, to: 3.08 },
      { y: 0.96, from: 2.5, to: 3.04 }
    ]
  },
  {
    /* Medial head, which sits lower and fuller than the lateral one. */
    id: "calves",
    part: "shin",
    bilateral: true,
    bulge: 0.042,
    profile: "belly",
    ridge: 0.008,
    span: [
      { y: 0.38, from: 3.18, to: 3.7 },
      { y: 0.55, from: 3.18, to: 4.14 },
      { y: 0.72, from: 3.2, to: 4.3 },
      { y: 0.88, from: 3.22, to: 4.2 },
      { y: 0.96, from: 3.26, to: 3.86 }
    ]
  },
  {
    /* Tibialis anterior, so the shin is not bare from the front. */
    id: "calves",
    part: "shin",
    bilateral: true,
    bulge: 0.022,
    span: [
      { y: 0.2, from: -0.28, to: 0.52 },
      { y: 0.42, from: -0.3, to: 0.82 },
      { y: 0.62, from: -0.26, to: 0.94 },
      { y: 0.84, from: -0.2, to: 0.92 }
    ]
  }
];

/** Wrap an angle into (-π, π]; used to decide which way the figure faces. */
export function normalizeAngle(angle: number): number {
  const wrapped = (((angle + Math.PI) % TAU) + TAU) % TAU;
  return wrapped - Math.PI;
}
