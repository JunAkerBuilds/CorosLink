// Generate: a loop of about the asked distance from the start, or a route from A to B, offered as up to three
// candidates: "Best match", then "More trail" and "Flatter" when those really are more unpaved / climb less.
//
// Loops (BRouter has no round trip for our profiles): via points sit on a circle whose rim passes through the start
// (a circle centred on the start forces an out-and-back to the rim). Three rotations are routed, each scored the way
// an athlete would judge it, then a small request budget goes on rerouting around out-and-back spurs and moving the
// radius toward the target. The seed turns the circle and flips the direction, so "New variation" gives another loop.
// Routing is passed in, so all of this runs in tests without the network.
import { randomUUID } from "node:crypto";
import type { GenerateRequest, LatLon, RouteCandidate, TrackPoint } from "../../../maps/types";
import { meters, offset, projector } from "./geo";
import { carFreeShare, pavedShare, publicGeometry, surfaceShare, unpavedShare, wayShare, type Routed } from "./makeup";
import { RoutingProblem } from "./net";
import { checkDistance, isCycling, maxKmFor, type Prefs } from "./sports";

export interface Engine {
  /** Route through points. `placed` = C-LINK put these points (detours to touch them may be trimmed). */
  route(points: LatLon[], prefs: Prefs, placed: boolean): Promise<Routed>;
  /** A router's own round trip (OpenRouteService); without one, loops are planned here. */
  roundTrip?(start: LatLon, distanceM: number, prefs: Prefs, seed: number): Promise<Routed>;
  /** Requests that can be spent now; improvements stop when this runs low. */
  available?(): number;
}

export interface Shape { bearing: number; radiusM: number; clockwise: boolean; vias: number; skip?: number[] }
interface Scored { shape: Shape; route: Routed; score: number; error: number }

const FREE_ERROR = 0.03;
const FIRST_BEARINGS = [0, 120, 240];
/** Requests per improvement round; a loop stays within six. */
const ROUNDS = [2, 1];
/** Left for the athlete's next edit. */
const RESERVED = 4;
const SPUR_GAP_M = 45;
const SPUR_MIN_M = 120;
const SPUR_WIDTH_M = 35;
const SPUR_FIX_MIN_M = 150;
const SPUR_VIA_RADIUS_M = 300;
const SAME_WAY_M = 25;
const SAMPLE_M = 10;

const viasFor = (m: number) => (m < 6_000 ? 3 : m < 15_000 ? 4 : m < 40_000 ? 5 : 6);

/** Start → vias around the circle → start. The centre sits `radiusM` from the start along `bearing`. */
export function loopPoints(start: LatLon, s: Shape): LatLon[] {
  const centre = offset(start, s.bearing, s.radiusM);
  const step = 360 / (s.vias + 1);
  const vias: LatLon[] = [];
  for (let i = 1; i <= s.vias; i++) {
    if (s.skip?.includes(i - 1)) continue;
    vias.push(offset(centre, s.bearing + 180 + (s.clockwise ? 1 : -1) * step * i, s.radiusM));
  }
  return [start, ...vias, start];
}

/** A stable turn for a variation seed (golden-angle spread); no seed is north. */
export function bearingForSeed(seed: number | undefined): number {
  if (seed === undefined || !Number.isFinite(seed)) return 0;
  return (Math.imul(Math.floor(seed) | 0, 0x9e3779b1) >>> 0) % 360;
}

export interface Spur { from: number; to: number; meters: number; tip: LatLon }

/**
 * Out-and-backs: stretches that come back within 45 m of where they left while enclosing almost no area (up one
 * sidewalk, back down the other). Pairs come from a grid; areas from prefix shoelace sums.
 */
export function findSpurs(points: readonly TrackPoint[]): Spur[] {
  const n = points.length;
  if (n < 4) return [];
  const at = projector(points[0]);
  const xy = points.map(at);
  const along = [0], lace = [0];
  for (let i = 1; i < n; i++) {
    along.push(along[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y));
    lace.push(lace[i - 1] + (xy[i - 1].x * xy[i].y - xy[i].x * xy[i - 1].y));
  }
  const total = along[n - 1];
  const cell = (i: number) => [Math.floor(xy[i].x / SPUR_GAP_M), Math.floor(xy[i].y / SPUR_GAP_M)];
  const grid = new Map<string, number[]>();
  const pairs: { from: number; to: number; len: number }[] = [];
  for (let end = 0; end < n; end++) {
    const [cx, cy] = cell(end);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const start of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const len = along[end] - along[start];
        if (len < SPUR_MIN_M || len > total * 0.6) continue;
        if (Math.hypot(xy[end].x - xy[start].x, xy[end].y - xy[start].y) > SPUR_GAP_M) continue;
        const area = Math.abs(lace[end] - lace[start] + (xy[end].x * xy[start].y - xy[start].x * xy[end].y)) / 2;
        if (area / (len / 2) <= SPUR_WIDTH_M) pairs.push({ from: start, to: end, len });
      }
    }
    const key = `${cx},${cy}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(end);
  }
  pairs.sort((a, b) => b.len - a.len);
  const spurs: Spur[] = [];
  for (const p of pairs) {
    if (spurs.some((s) => p.from <= s.to && p.to >= s.from)) continue;
    let tip = p.from;
    while (tip < p.to && along[tip] < along[p.from] + p.len / 2) tip++;
    spurs.push({ from: p.from, to: p.to, meters: Math.round(p.len), tip: [points[tip][0], points[tip][1]] });
  }
  return spurs.sort((a, b) => a.from - b.from);
}

/** Share (0–1) of `route`'s length within 25 m of `other` (opposite sidewalks count as the same street). */
export function sharedShare(route: readonly TrackPoint[], other: readonly TrackPoint[]): number {
  if (route.length < 2 || other.length < 1) return 0;
  const at = projector(route[0]);
  const key = (x: number, y: number) => `${Math.floor(x / SAME_WAY_M)},${Math.floor(y / SAME_WAY_M)}`;
  const grid = new Map<string, { x: number; y: number }[]>();
  const o = other.map(at);
  o.forEach((p, i) => {
    const q = o[i + 1] ?? p;
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / SAMPLE_M));
    for (let s = 0; s < steps; s++) {
      const sample = { x: p.x + ((q.x - p.x) * s) / steps, y: p.y + ((q.y - p.y) * s) / steps };
      const k = key(sample.x, sample.y);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(sample);
    }
  });
  const near = (x: number, y: number) => {
    const cx = Math.floor(x / SAME_WAY_M), cy = Math.floor(y / SAME_WAY_M);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const s of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(s.x - x, s.y - y) <= SAME_WAY_M) return true;
    }
    return false;
  };
  const r = route.map(at);
  let total = 0, shared = 0;
  for (let i = 1; i < r.length; i++) {
    const len = Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y);
    const steps = Math.max(1, Math.ceil(len / SAMPLE_M));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      if (near(r[i - 1].x + (r[i].x - r[i - 1].x) * t, r[i - 1].y + (r[i].y - r[i - 1].y) * t)) shared += len / steps;
    }
    total += len;
  }
  return total > 0 ? shared / total : 0;
}

const spurMeters = (r: Routed) => findSpurs(r.points).reduce((a, s) => a + s.meters, 0);

/**
 * Lower is better. Distance first, then what athletes notice on the ground: running a street twice, car parks and
 * driveways, busy carriageways, and the surface and climbing wishes.
 */
export function scoreLoop(r: Routed, targetM: number, prefs: Prefs): number {
  const d = Math.max(1, r.distanceM);
  let score = 10 * Math.max(0, Math.abs(d - targetM) / targetM - FREE_ERROR);
  score += 2.5 * Math.min(1, (r.makeup?.retracedMeters ?? 0) / d);
  score += 4 * Math.min(1, spurMeters(r) / d);
  score += 8 * wayShare(r.tally, ["parking"]);
  score += 3 * wayShare(r.tally, ["busy"]);
  score += 0.6 * wayShare(r.tally, ["service"]);
  if (prefs.surface === "trail") score += 1.2 * surfaceShare(r.tally, ["paved"]);
  else if (prefs.surface === "road") score += 0.8 * surfaceShare(r.tally, ["dirt"]);
  const steep = Math.min(1, ((r.ascentM / d) * 1000) / 25);
  if (prefs.elevation === "hilly") score -= 0.8 * steep;
  else if (prefs.elevation === "flat") score += 0.8 * steep;
  // The stock profile can't see car parks; prefer our own when both answered.
  if (r.stock) score += 0.5;
  return score;
}

export interface Planned { best: Routed; points: LatLon[]; ranked: Routed[] }

export async function planLoop(start: LatLon, targetM: number, prefs: Prefs, seed: number | undefined, engine: Engine): Promise<Planned> {
  const base = bearingForSeed(seed);
  const clockwise = Math.floor(base / 7) % 2 === 0;
  const vias = viasFor(targetM);
  const radius = targetM / (2 * Math.PI * (isCycling(prefs.sport) ? 1.2 : 1.25));
  const samples = new Map<string, { radius: number; distance: number }[]>();
  const family = (s: Shape) => `${s.bearing.toFixed(1)}|${(s.skip ?? []).join(",")}`;
  const affordable = () => (engine.available ? Math.max(0, engine.available() - RESERVED) : Infinity);

  const evaluate = async (shape: Shape): Promise<Scored> => {
    const route = await engine.route(loopPoints(start, shape), prefs, true);
    const list = samples.get(family(shape)) ?? [];
    list.push({ radius: shape.radiusM, distance: route.distanceM });
    samples.set(family(shape), list);
    return { shape, route, score: scoreLoop(route, targetM, prefs), error: Math.abs(route.distanceM - targetM) / targetM };
  };
  const settle = async (shapes: Shape[]) => {
    const results = await Promise.allSettled(shapes.map(evaluate));
    return {
      done: results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      error: results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason as unknown,
    };
  };

  /** The next shape worth routing: drop the via behind a long spur, else move the radius toward the target. */
  const next = (c: Scored): Shape | null => {
    const fix = spurFix(c, start, targetM);
    if (fix) return fix;
    if (c.error <= FREE_ERROR) return null;
    const seen = samples.get(family(c.shape)) ?? [];
    const below = seen.filter((s) => s.distance < targetM).sort((a, b) => b.distance - a.distance)[0];
    const above = seen.filter((s) => s.distance > targetM).sort((a, b) => a.distance - b.distance)[0];
    // A bigger circle can jump across a river or highway, so once both sides are known, interpolate.
    const r = below && above && above.distance !== below.distance
      ? below.radius + ((targetM - below.distance) / (above.distance - below.distance)) * (above.radius - below.radius)
      : c.shape.radiusM * Math.min(2, Math.max(0.5, targetM / Math.max(1, c.route.distanceM)));
    if (seen.some((s) => Math.abs(s.radius - r) / r < 0.02)) return null;
    return { ...c.shape, radiusM: r };
  };

  const first = await settle(FIRST_BEARINGS.map((b) => ({ bearing: (base + b) % 360, radiusM: radius, clockwise, vias })));
  const all = first.done;
  if (!all.length) throw first.error instanceof Error ? first.error : new RoutingProblem("Couldn't make a loop from here. Try another start.", "no_route", 422);

  for (const width of ROUNDS) {
    all.sort((a, b) => a.score - b.score);
    const shapes: Shape[] = [];
    const families = new Set<string>();
    for (const c of all) {
      if (shapes.length >= Math.min(width, affordable())) break;
      if (families.has(family(c.shape))) continue;
      families.add(family(c.shape));
      const s = next(c);
      if (s) shapes.push(s);
    }
    if (!shapes.length) break;
    all.push(...(await settle(shapes)).done);
  }
  all.sort((a, b) => a.score - b.score);
  return { best: all[0].route, points: loopPoints(start, all[0].shape), ranked: all.map((c) => c.route) };
}

function spurFix(c: Scored, start: LatLon, targetM: number): Shape | null {
  const spurs = findSpurs(c.route.points).filter((s) => s.meters >= SPUR_FIX_MIN_M);
  if (!spurs.length) return null;
  const skip = new Set(c.shape.skip ?? []);
  const vias = loopPoints(start, { ...c.shape, skip: [] }).slice(1, -1);
  for (const spur of spurs) {
    let nearest = -1, best = SPUR_VIA_RADIUS_M;
    vias.forEach((v, i) => {
      const m = meters(v, spur.tip);
      if (!skip.has(i) && m < best) { nearest = i; best = m; }
    });
    if (nearest >= 0) skip.add(nearest);
  }
  // Keep two vias at least, so it stays a loop and not an out-and-back.
  if (skip.size === (c.shape.skip?.length ?? 0) || vias.length - skip.size < 2) return null;
  const fixed: Shape = { ...c.shape, skip: [...skip].sort((a, b) => a - b) };
  const perimeter = (pts: LatLon[]) => pts.slice(1).reduce((a, p, i) => a + meters(pts[i], p), 0);
  const removed = spurs.reduce((a, s) => a + s.meters, 0);
  const expected = Math.max(1, c.route.distanceM - removed) *
    (perimeter(loopPoints(start, fixed)) / Math.max(1, perimeter(loopPoints(start, c.shape))));
  return { ...fixed, radiusM: c.shape.radiusM * Math.min(1.5, Math.max(0.7, (targetM / expected) ** 0.9)) };
}

// ---- Candidates ----

const DISTINCT = 0.9;
const distinct = (a: Routed, b: Routed) => Math.max(sharedShare(a.points, b.points), sharedShare(b.points, a.points)) < DISTINCT;

function candidate(r: Routed, label: string, cycling: boolean): RouteCandidate {
  return { ...publicGeometry(r), id: randomUUID(), label, carFree: round2(carFreeShare(r.makeup, cycling)), paved: round2(pavedShare(r.makeup)) };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Loop or A → B, best match first; "More trail" and "Flatter" only when they are. */
export async function generateCandidates(req: GenerateRequest, engine: Engine): Promise<RouteCandidate[]> {
  const prefs: Prefs = { sport: req.sport, surface: req.surface, elevation: req.elevation };
  const cycling = isCycling(req.sport);
  let best: Routed;
  let variant: (p: Prefs) => Promise<Routed>;
  let targetM: number;
  if (req.kind === "loop") {
    checkDistance(req.sport, req.distanceKm);
    targetM = req.distanceKm * 1000;
    const seed = req.seed ?? 0;
    if (engine.roundTrip) {
      best = await engine.roundTrip(req.start, targetM, prefs, seed);
      variant = (p) => engine.roundTrip!(req.start, targetM, p, seed);
    } else {
      const plan = await planLoop(req.start, targetM, prefs, req.seed, engine);
      best = plan.best;
      variant = (p) => engine.route(plan.points, p, true);
    }
  } else {
    if (!req.end) throw new RoutingProblem("Pick where the route ends.", "end");
    const straightKm = meters(req.start, req.end) / 1000;
    if (straightKm < 0.02) throw new RoutingProblem("Start and finish are the same place. Pick a loop instead.", "end");
    if (straightKm > maxKmFor(req.sport)) checkDistance(req.sport, straightKm);
    best = await engine.route([req.start, req.end], prefs, false);
    targetM = best.distanceM;
    variant = (p) => engine.route([req.start, req.end!], p, false);
  }

  const out = [candidate(best, "Best match", cycling)];
  const spare = engine.available ? engine.available() > 2 : true;
  const wantTrail = req.sport !== "road" && req.surface !== "trail";
  const wantFlat = req.elevation !== "flat";
  if (!spare || (!wantTrail && !wantFlat)) return out;
  const [trail, flat] = await Promise.all([
    wantTrail ? variant({ ...prefs, surface: "trail" }).catch(() => null) : null,
    wantFlat ? variant({ ...prefs, elevation: "flat" }).catch(() => null) : null,
  ]);
  const near = (r: Routed) => req.kind === "ab" || Math.abs(r.distanceM - targetM) / targetM <= 0.15;
  const kept: Routed[] = [best];
  if (trail && near(trail) && unpavedShare(trail.makeup) >= unpavedShare(best.makeup) + 0.05 && kept.every((k) => distinct(trail, k))) {
    kept.push(trail);
    out.push(candidate(trail, "More trail", cycling));
  }
  if (flat && near(flat) && flat.ascentM <= best.ascentM * 0.9 - 5 && kept.every((k) => distinct(flat, k))) {
    out.push(candidate(flat, "Flatter", cycling));
  }
  return out;
}
