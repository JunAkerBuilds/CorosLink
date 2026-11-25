/** Small pure helpers for the hand-drawn SVG charts. All take plain numbers and return path strings. */

export function extent(values: readonly number[], pad = 0): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (!isFinite(min)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min - pad, max + pad];
}

/** A polyline through `values`, spread evenly across `w`, with `min` at the bottom and `max` at the top of `h`. */
export function linePath(values: readonly number[], w: number, h: number, min: number, max: number): string {
  const n = values.length;
  if (n === 0) return "";
  const span = max - min || 1;
  return values
    .map((v, k) => `${k ? "L" : "M"}${(n === 1 ? 0 : (k * w) / (n - 1)).toFixed(1)} ${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
}

/** The same line closed down to the baseline, for a soft fill under it. */
export function areaPath(values: readonly number[], w: number, h: number, min: number, max: number): string {
  const line = linePath(values, w, h, min, max);
  return line ? `${line} L${w} ${h} L0 ${h} Z` : "";
}

/** Bars as one path. `slot` is the width given to each bar, `bar` the drawn width inside it. */
export function barsPath(values: readonly number[], h: number, max: number, slot: number, bar: number): string {
  const inset = (slot - bar) / 2;
  return values
    .map((v, k) => {
      const bh = Math.max(0, (v / (max || 1)) * h);
      return `M${(k * slot + inset).toFixed(1)} ${(h - bh).toFixed(1)}h${bar}v${bh.toFixed(1)}h-${bar}z`;
    })
    .join(" ");
}

/** Sparkline path in an 80×24 box, as on the dashboard stat strip. */
export function sparkPath(values: readonly number[], w = 80, h = 20): string {
  const [mn, mx] = extent(values);
  return linePath(values, w, h, mn - 0.5, mx + 0.5);
}

/** Which sample a pointer is over, for hover readouts. */
export function indexAt(clientX: number, rect: { left: number; width: number }, count: number): number {
  if (count <= 1 || rect.width <= 0) return 0;
  const k = Math.round(((clientX - rect.left) / rect.width) * (count - 1));
  return Math.max(0, Math.min(count - 1, k));
}

/** A point on a circle, angle in degrees clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** An SVG arc from `from` to `to` degrees (clockwise from 12 o'clock). */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * One path per zone for a line that changes colour as it crosses zones: each segment between two samples goes
 * to the zone of its middle value. `low` is drawn at the bottom, `high` at the top (pass them swapped to flip).
 */
export function zonePaths(values: readonly number[], w: number, h: number, low: number, high: number, zoneOf: (v: number) => number, zones: number): string[] {
  const out = Array.from({ length: zones }, () => "");
  const n = values.length;
  if (n < 2) return out;
  const span = high - low || 1;
  const x = (i: number) => ((i / (n - 1)) * w).toFixed(1);
  const y = (v: number) => (h - ((v - low) / span) * h).toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const z = Math.max(0, Math.min(zones - 1, zoneOf((values[i] + values[i + 1]) / 2)));
    out[z] += `M${x(i)} ${y(values[i])}L${x(i + 1)} ${y(values[i + 1])}`;
  }
  return out;
}

/** Bars with rounded tops in equal slots across `w`, as one path per group. */
export function roundedBars(values: readonly number[], groupOf: (i: number) => number, groups: number, w: number, h: number, max: number, gap = 0.3): string[] {
  const out = Array.from({ length: groups }, () => "");
  const n = values.length;
  if (n === 0 || !(max > 0)) return out;
  const slot = w / n, bar = slot * (1 - gap), r = Math.min(4, bar / 2);
  values.forEach((v, i) => {
    const bh = Math.max(r + 1, Math.min(h, (v / max) * h));
    const x = i * slot + (slot - bar) / 2;
    out[groupOf(i)] += `M${x.toFixed(1)} ${(h - bh + r).toFixed(1)}q0 ${-r} ${r} ${-r}h${(bar - 2 * r).toFixed(1)}q${r} 0 ${r} ${r}v${(bh - r).toFixed(1)}h${(-bar).toFixed(1)}z`;
  });
  return out;
}
