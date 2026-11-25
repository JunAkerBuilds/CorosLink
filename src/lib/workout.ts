/**
 * Pure maths for structured workouts: totals with repeats, the estimates that turn a distance
 * into a time (and back) from the step's target, the intensity "shape" drawing, and the edits
 * the builder makes (add, remove, reorder, group). Nothing here touches the browser.
 */

export type Sport = "run" | "ride" | "swim" | "strength";
export type StepKind = "warmup" | "work" | "recovery" | "rest" | "cooldown";
export type LengthUnit = "km" | "m" | "min";

export type StepLength =
  | { type: "distance"; metres: number; unit: "km" | "m" }
  | { type: "time"; seconds: number };

export type StepTarget =
  | { type: "none" }
  | { type: "hr"; zone: number }
  /** Pace range in seconds per km, `fast` being the smaller number. */
  | { type: "pace"; fast: number; slow: number }
  /** A target read from COROS that the builder can't edit. It is saved back unchanged; `label` says what it is. */
  | { type: "kept"; label: string };

export interface WorkoutStep {
  type: "step";
  id: string;
  kind: StepKind;
  length: StepLength;
  target: StepTarget;
  /** What the step is, when its kind doesn't say it: a gym exercise with its sets ("Back squat · 4 × 6"). */
  label?: string;
}

export interface RepeatBlock {
  type: "repeat";
  id: string;
  count: number;
  steps: WorkoutStep[];
}

export type WorkoutItem = WorkoutStep | RepeatBlock;

/** What the estimates need to know about the athlete for one sport. */
export interface Pacing {
  /** Usual pace in each heart rate zone, zone 1 first, in seconds per km. */
  zonePace: readonly number[];
  /** Pace of an untargeted recovery jog, in seconds per km. */
  easyPace: number;
  /** True for a sport done on the spot (strength): timed steps cover no distance. */
  still?: boolean;
}

/** Height of each heart rate zone in the shape drawing (0 to 1). Zone 2 is the canvas "easy". */
export const ZONE_INTENSITY: readonly number[] = [0.3, 0.42, 0.6, 0.78, 0.92];
/** Height of an untargeted step, by kind. */
const KIND_INTENSITY: Record<StepKind, number> = { warmup: 0.42, cooldown: 0.42, work: 0.7, recovery: 0.28, rest: 0.15 };
/** Height of an untargeted hard step in a sport done on the spot: a gym hour loads far less than a running one. */
const STILL_WORK_INTENSITY = 0.26;
/** Load of one hour at full intensity. Chosen so the canvas workout (49:56) reads 104. */
export const LOAD_PER_HOUR = 217;

export const MAX_REPEATS = 99;

/* ───────────── Estimates ───────────── */

const clampZone = (zone: number, pacing: Pacing) => Math.max(1, Math.min(pacing.zonePace.length, Math.round(zone)));

/** The pace a step is expected to move at, in seconds per km. Null for a rest spent standing. */
export function stepPace(step: WorkoutStep, pacing: Pacing): number | null {
  const t = step.target;
  if (t.type === "pace") return (t.fast + t.slow) / 2;
  if (t.type === "hr") return pacing.zonePace[clampZone(t.zone, pacing) - 1];
  switch (step.kind) {
    case "rest": return null;
    case "recovery": return pacing.easyPace;
    case "work": return pacing.zonePace[Math.min(2, pacing.zonePace.length - 1)];
    default: return pacing.zonePace[Math.min(1, pacing.zonePace.length - 1)];
  }
}

/** Seconds a step takes: its own time, or its distance at the expected pace. */
export function stepSeconds(step: WorkoutStep, pacing: Pacing): number {
  if (step.length.type === "time") return step.length.seconds;
  const p = stepPace(step, pacing) ?? pacing.easyPace;
  return (step.length.metres / 1000) * p;
}

/** Metres a step covers: its own distance, or its time at the expected pace (0 while standing). */
export function stepMetres(step: WorkoutStep, pacing: Pacing): number {
  if (step.length.type === "distance") return step.length.metres;
  if (pacing.still) return 0;
  const p = stepPace(step, pacing);
  return p && p > 0 ? (step.length.seconds / p) * 1000 : 0;
}

/** How hard a step is, 0 to 1. */
export function stepIntensity(step: WorkoutStep, pacing: Pacing): number {
  const t = step.target;
  if (t.type === "hr") return ZONE_INTENSITY[Math.min(ZONE_INTENSITY.length, clampZone(t.zone, pacing)) - 1];
  if (t.type === "pace") return paceIntensity((t.fast + t.slow) / 2, pacing);
  return pacing.still && step.kind === "work" ? STILL_WORK_INTENSITY : KIND_INTENSITY[step.kind];
}

/** Intensity of a pace, read off the athlete's zone paces (slower than zone 1 fades to 0.2, faster than the top zone rises to 1). */
export function paceIntensity(secPerKm: number, pacing: Pacing): number {
  const paces = pacing.zonePace;
  const n = Math.min(paces.length, ZONE_INTENSITY.length);
  if (n === 0 || !(secPerKm > 0)) return KIND_INTENSITY.work;
  const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => (x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  if (secPerKm >= paces[0]) {
    const floor = paces[0] * 1.25;
    return secPerKm >= floor ? 0.2 : lerp(secPerKm, paces[0], floor, ZONE_INTENSITY[0], 0.2);
  }
  for (let i = 1; i < n; i++) {
    if (secPerKm >= paces[i]) return lerp(secPerKm, paces[i - 1], paces[i], ZONE_INTENSITY[i - 1], ZONE_INTENSITY[i]);
  }
  const top = paces[n - 1] * 0.9;
  return secPerKm <= top ? 1 : lerp(secPerKm, paces[n - 1], top, ZONE_INTENSITY[n - 1], 1);
}

/* ───────────── Totals ───────────── */

/** Every step in the order it is done, repeat blocks written out `count` times. */
export function expand(items: readonly WorkoutItem[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const item of items) {
    if (item.type === "step") out.push(item);
    else for (let k = 0; k < repeatCount(item.count); k++) out.push(...item.steps);
  }
  return out;
}

const repeatCount = (count: number) => (Number.isFinite(count) ? Math.max(0, Math.min(MAX_REPEATS, Math.floor(count))) : 0);

export interface Totals {
  seconds: number;
  metres: number;
  /** Estimated training load, a whole number. */
  load: number;
}

export function totals(items: readonly WorkoutItem[], pacing: Pacing): Totals {
  let seconds = 0, metres = 0, effort = 0;
  for (const step of expand(items)) {
    const s = stepSeconds(step, pacing);
    seconds += s;
    metres += stepMetres(step, pacing);
    effort += s * stepIntensity(step, pacing);
  }
  return { seconds, metres, load: Math.round((effort / 3600) * LOAD_PER_HOUR) };
}

/** Totals of one repeat block, all its rounds together. */
export function repeatTotals(block: RepeatBlock, pacing: Pacing): Totals {
  return totals([block], pacing);
}

/** Second line for a calendar entry: "9.60 km · 49:56", or the time alone when nothing is covered. */
export function describe(items: readonly WorkoutItem[], pacing: Pacing): string {
  const t = totals(items, pacing);
  const time = formatClock(t.seconds);
  return t.metres >= 1 ? `${(t.metres / 1000).toFixed(2)} km · ${time}` : time;
}

/* ───────────── Shape ───────────── */

export type ShapeBucket = "easy" | "hard" | "rest";

export interface ShapeSegment {
  bucket: ShapeBucket;
  seconds: number;
  intensity: number;
}

const BUCKET: Record<StepKind, ShapeBucket> = { warmup: "easy", cooldown: "easy", work: "hard", recovery: "rest", rest: "rest" };

export function segments(items: readonly WorkoutItem[], pacing: Pacing): ShapeSegment[] {
  return expand(items)
    .map((step) => ({ bucket: BUCKET[step.kind], seconds: stepSeconds(step, pacing), intensity: stepIntensity(step, pacing) }))
    .filter((s) => s.seconds > 0);
}

/** One path per colour: a bar per step, as wide as its share of the time and as tall as its intensity. */
export function shapePaths(segs: readonly ShapeSegment[], w = 500, h = 120, gap = 2): Record<ShapeBucket, string> {
  const out: Record<ShapeBucket, string> = { easy: "", hard: "", rest: "" };
  const total = segs.reduce((sum, s) => sum + s.seconds, 0);
  if (!(total > 0)) return out;
  let x = 0;
  for (const s of segs) {
    const bw = (s.seconds / total) * w;
    const bh = Math.max(0, Math.min(1, s.intensity)) * h;
    const drawn = Math.max(0.5, bw - gap).toFixed(1);
    out[s.bucket] += `M${x.toFixed(1)} ${(h - bh).toFixed(1)}h${drawn}v${bh.toFixed(1)}h-${drawn}z`;
    x += bw;
  }
  return out;
}

/** Times to print under the shape: start, end of the first item, start of the last item, finish. */
export function shapeTicks(items: readonly WorkoutItem[], pacing: Pacing): number[] {
  const spans = items.map((item) => totals([item], pacing).seconds);
  const total = spans.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [0];
  const ticks = items.length >= 3 ? [0, spans[0], total - spans[spans.length - 1], total] : [0, total];
  return ticks.filter((t, k) => k === 0 || Math.round(t) > Math.round(ticks[k - 1]));
}

/* ───────────── Edits ───────────── */

/**
 * The edits work on any list of steps and repeat blocks that carry `type`, `id` and (for a block) `count` and
 * `steps`: the builder's own steps as well as the ones in this file. Everything else on an item is kept as it is.
 */
export interface StepLike { type: "step"; id: string }
export interface RepeatLike { type: "repeat"; id: string; count: number; steps: StepLike[] }
export type ItemLike = StepLike | RepeatLike;
type StepOf<I> = Extract<I, { type: "step" }>;

const mapBlocks = (items: readonly ItemLike[], fn: (block: RepeatLike) => RepeatLike): ItemLike[] =>
  items.map((item) => (item.type === "repeat" ? fn(item) : item));

/** Where an id sits: `blockId` null for the top level. */
export function locate(items: readonly ItemLike[], id: string): { blockId: string | null; index: number } | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.id === id) return { blockId: null, index: i };
    if (item.type === "repeat") {
      const k = item.steps.findIndex((s) => s.id === id);
      if (k >= 0) return { blockId: item.id, index: k };
    }
  }
  return null;
}

export function findItem<I extends ItemLike>(items: readonly I[], id: string): I | StepOf<I> | null {
  for (const item of items as readonly ItemLike[]) {
    if (item.id === id) return item as I;
    if (item.type === "repeat") {
      const hit = item.steps.find((s) => s.id === id);
      if (hit) return hit as StepOf<I>;
    }
  }
  return null;
}

/** Adds at the end of the workout, or at the end of a repeat block. Blocks never nest. */
export function addItem<I extends ItemLike>(items: readonly I[], item: I, blockId: string | null = null): I[] {
  if (blockId && item.type === "step" && items.some((i) => i.type === "repeat" && i.id === blockId)) {
    return mapBlocks(items, (b) => (b.id === blockId ? { ...b, steps: [...b.steps, item] } : b)) as I[];
  }
  return [...items, item];
}

function remove(items: readonly ItemLike[], id: string): ItemLike[] {
  return mapBlocks(items.filter((i) => i.id !== id), (b) =>
    b.steps.some((s) => s.id === id) ? { ...b, steps: b.steps.filter((s) => s.id !== id) } : b);
}

/** Removes a step (wherever it is) or a whole repeat block. */
export function removeItem<I extends ItemLike>(items: readonly I[], id: string): I[] {
  return remove(items, id) as I[];
}

export function updateStep<I extends ItemLike>(items: readonly I[], id: string, patch: Partial<Omit<StepOf<I>, "id" | "type">>): I[] {
  return (items as readonly ItemLike[]).map((item) => {
    if (item.type === "step") return item.id === id ? { ...item, ...patch } : item;
    return item.steps.some((s) => s.id === id) ? { ...item, steps: item.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : item;
  }) as I[];
}

export function setRepeatCount<I extends ItemLike>(items: readonly I[], blockId: string, count: number): I[] {
  const next = Number.isFinite(count) ? Math.max(1, Math.min(MAX_REPEATS, Math.round(count))) : 1;
  return mapBlocks(items, (b) => (b.id === blockId ? { ...b, count: next } : b)) as I[];
}

/** Replaces a repeat block with its steps, once, where the block stood. */
export function ungroup<I extends ItemLike>(items: readonly I[], blockId: string): I[] {
  return (items as readonly ItemLike[]).flatMap((item) => (item.type === "repeat" && item.id === blockId ? item.steps : [item])) as I[];
}

function place(items: readonly ItemLike[], id: string, blockId: string | null, index: number): ItemLike[] {
  const from = locate(items, id);
  const moving = findItem(items, id);
  if (!from || !moving) return [...items];
  if (blockId === id) return [...items];
  if (blockId !== null && (moving.type === "repeat" || !items.some((i) => i.type === "repeat" && i.id === blockId))) return [...items];
  let at = index;
  if (from.blockId === blockId && from.index < index) at -= 1;
  const without = remove(items, id);
  if (blockId === null) {
    at = Math.max(0, Math.min(without.length, at));
    return [...without.slice(0, at), moving, ...without.slice(at)];
  }
  return mapBlocks(without, (b) => {
    if (b.id !== blockId) return b;
    const k = Math.max(0, Math.min(b.steps.length, at));
    return { ...b, steps: [...b.steps.slice(0, k), moving as StepLike, ...b.steps.slice(k)] };
  });
}

/**
 * Moves a step to `index` of the top level (`blockId` null) or of a repeat block.
 * `index` counts positions before the move. A repeat block can only move along the top level.
 */
export function moveTo<I extends ItemLike>(items: readonly I[], id: string, blockId: string | null, index: number): I[] {
  return place(items, id, blockId, index) as I[];
}

/** Drops `id` just before or after `targetId`, in the target's own container. */
export function moveNear<I extends ItemLike>(items: readonly I[], id: string, targetId: string, after: boolean): I[] {
  if (id === targetId) return [...items];
  const target = locate(items, targetId);
  const moving = findItem<ItemLike>(items, id);
  if (!target || !moving) return [...items];
  // A block dropped on a step inside another block lands beside that block.
  if (moving.type === "repeat" && target.blockId !== null) {
    if (target.blockId === id) return [...items];
    const outer = locate(items, target.blockId);
    return outer ? moveTo(items, id, null, outer.index + (after ? 1 : 0)) : [...items];
  }
  return moveTo(items, id, target.blockId, target.index + (after ? 1 : 0));
}

/**
 * One place up (-1) or down (+1), for the keyboard.
 * A step at the edge of a repeat block steps out of it; a step next to a block steps into it.
 * A block swaps with its neighbour.
 */
export function moveItem<I extends ItemLike>(items: readonly I[], id: string, dir: -1 | 1): I[] {
  const at = locate(items, id);
  const moving = findItem<ItemLike>(items, id);
  if (!at || !moving) return [...items];
  if (at.blockId !== null) {
    const block = (items as readonly ItemLike[]).find((i) => i.id === at.blockId) as RepeatLike;
    const j = at.index + dir;
    if (j >= 0 && j < block.steps.length) return moveTo(items, id, at.blockId, dir < 0 ? j : j + 1);
    const outer = locate(items, at.blockId)!;
    return moveTo(items, id, null, outer.index + (dir < 0 ? 0 : 1));
  }
  const j = at.index + dir;
  if (j < 0 || j >= items.length) return [...items];
  const neighbour: ItemLike = items[j];
  if (moving.type === "step" && neighbour.type === "repeat") {
    return moveTo(items, id, neighbour.id, dir < 0 ? neighbour.steps.length : 0);
  }
  return moveTo(items, id, null, dir < 0 ? j : j + 1);
}

/** Whether moveItem would change anything, for disabling the buttons at the ends. */
export function canMove(items: readonly ItemLike[], id: string, dir: -1 | 1): boolean {
  const at = locate(items, id);
  if (!at) return false;
  if (at.blockId !== null) return true;
  const j = at.index + dir;
  return j >= 0 && j < items.length;
}

/* ───────────── Units and text ───────────── */

export function lengthUnit(length: StepLength): LengthUnit {
  return length.type === "time" ? "min" : length.unit;
}

/**
 * The same step measured another way. Between km and m the distance stays; switching to time
 * gives the estimated time for the distance, and switching to distance the estimated distance
 * for the time (to the nearest 10 m).
 */
export function convertLength(step: WorkoutStep, unit: LengthUnit, pacing: Pacing): StepLength {
  if (unit === "min") {
    if (step.length.type === "time") return step.length;
    return { type: "time", seconds: Math.max(1, Math.round(stepSeconds(step, pacing))) };
  }
  if (step.length.type === "distance") return { ...step.length, unit };
  const p = stepPace(step, pacing) ?? pacing.easyPace;
  const metres = Math.max(10, Math.round(((step.length.seconds / p) * 1000) / 10) * 10);
  return { type: "distance", metres, unit };
}

/** m:ss or h:mm:ss, to the whole second. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Reads "4:30", "1:02:03" or a bare number of minutes ("5", "1.5"). Null when it is not a time. */
export function parseClock(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  if (!t.includes(":")) {
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 60);
  }
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p, k) => !(k === parts.length - 1 ? /^\d{1,2}(\.\d+)?$/ : /^\d+$/).test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return Math.round(nums.reduce((sum, n) => sum * 60 + n, 0));
}

/** What the length box shows: 2.00 for km, 400 for m, 1:30 for time. */
export function formatLength(length: StepLength): string {
  if (length.type === "time") return formatClock(length.seconds);
  return length.unit === "km" ? (length.metres / 1000).toFixed(2) : String(Math.round(length.metres));
}

/** Reads the length box back. Null when the text is not a positive length. */
export function parseLength(text: string, unit: LengthUnit): StepLength | null {
  if (unit === "min") {
    const seconds = parseClock(text);
    return seconds && seconds > 0 && seconds <= 86400 ? { type: "time", seconds } : null;
  }
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const metres = unit === "km" ? Math.round(parseFloat(t) * 1000) : Math.round(parseFloat(t));
  return metres > 0 && metres <= 1_000_000 ? { type: "distance", metres, unit } : null;
}

/* ───────────── New steps ───────────── */

const WORK_LABEL: Record<Sport, string> = { run: "Run", ride: "Ride", swim: "Swim", strength: "Work" };

export function kindLabel(kind: StepKind, sport: Sport): string {
  switch (kind) {
    case "warmup": return "Warm up";
    case "cooldown": return "Cool down";
    case "recovery": return "Recovery";
    case "rest": return "Rest";
    default: return WORK_LABEL[sport];
  }
}

/** A sensible fresh step of a kind. The hard step aims 5 s either side of the top zone's pace. */
export function newStep(id: string, kind: StepKind, sport: Sport, pacing: Pacing): WorkoutStep {
  const base = { type: "step" as const, id, kind };
  if (kind === "rest") return { ...base, length: { type: "time", seconds: 60 }, target: { type: "none" } };
  if (sport === "strength") return { ...base, length: { type: "time", seconds: kind === "work" ? 300 : 120 }, target: { type: "none" } };
  if (kind === "recovery") return { ...base, length: { type: "distance", metres: 400, unit: "m" }, target: { type: "none" } };
  if (kind === "work") {
    const top = pacing.zonePace[pacing.zonePace.length - 1] ?? pacing.easyPace;
    return { ...base, length: { type: "distance", metres: 1000, unit: "km" }, target: { type: "pace", fast: top - 5, slow: top + 5 } };
  }
  return { ...base, length: { type: "distance", metres: 2000, unit: "km" }, target: { type: "hr", zone: 2 } };
}

/** A fresh repeat block: four rounds of a hard step and a recovery. `ids` is [block, hard, recovery]. */
export function newRepeat(ids: readonly [string, string, string], sport: Sport, pacing: Pacing): RepeatBlock {
  return { type: "repeat", id: ids[0], count: 4, steps: [newStep(ids[1], "work", sport, pacing), newStep(ids[2], sport === "strength" ? "rest" : "recovery", sport, pacing)] };
}

/** The target a step gets when its target type changes. */
export function defaultTarget(type: StepTarget["type"], step: WorkoutStep, pacing: Pacing): StepTarget {
  if (type === "none") return { type: "none" };
  if (type === "kept") return step.target;
  if (type === "hr") return { type: "hr", zone: step.kind === "work" ? Math.min(4, pacing.zonePace.length) : 2 };
  const mid = Math.round(stepPace(step, pacing) ?? pacing.easyPace);
  return { type: "pace", fast: mid - 5, slow: mid + 5 };
}
