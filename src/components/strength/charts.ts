/** Path maths for the two Strength drawings, as in the design canvas. */

export const BARS_W = 480;
export const BARS_H = 132;

/** One round-topped, round-bottomed bar per value, in a 480×132 box. Twelve bars are 28 wide in 40-wide slots. */
export function pillBars(values: readonly number[]): string[] {
  const n = values.length;
  if (!n) return [];
  const slot = BARS_W / n;
  const r = Math.min(22, slot * 0.35);
  const top = Math.max(...values) * (5.6 / 5.4) || 1;
  return values.map((v, k) => {
    const h = Math.max(2 * r, (v / top) * BARS_H);
    const x = k * slot + (slot - 2 * r) / 2;
    return `M${x.toFixed(1)} ${(BARS_H - h + r).toFixed(1)}a${r} ${r} 0 0 1 ${2 * r} 0v${(h - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 -${2 * r} 0z`;
  });
}

/** A lift's weekly best as a line across a 250×84 box, with the area under it. */
export function liftCurve(history: readonly number[]): { line: string; area: string } {
  if (history.length < 2) return { line: "", area: "" };
  const mn = Math.min(...history) - 4, mx = Math.max(...history) + 1;
  const line = history
    .map((v, i) => `${i ? "L" : "M"}${((i * 250) / (history.length - 1)).toFixed(1)} ${(8 + (1 - (v - mn) / (mx - mn)) * 70).toFixed(1)}`)
    .join(" ");
  return { line, area: `${line} L250 84 L0 84 Z` };
}
