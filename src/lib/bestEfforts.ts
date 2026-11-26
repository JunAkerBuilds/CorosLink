/**
 * Fastest stretches of a recorded run: the quickest 400 m, 1 km, mile, 5 km and so on inside one activity,
 * worked out from its time and distance samples (linear between samples).
 */
import { msg } from "@/lib/i18n";

export interface Effort { name: string; metres: number; seconds: number }

export const RUN_EFFORTS: readonly { name: string; metres: number }[] = [
  { name: "400 m", metres: 400 },
  { name: "1 km", metres: 1000 },
  { name: msg("1 mile"), metres: 1609.344 },
  { name: "5 km", metres: 5000 },
  { name: "10 km", metres: 10000 },
  { name: msg("Half marathon"), metres: 21097.5 },
  { name: msg("Marathon"), metres: 42195 },
];

/**
 * Seconds at each sample, from a recording drawn over distance: each step takes its distance at the speed
 * recorded there (the last speed above 0.3 m/s when the watch read a stop).
 */
export function timesFromDistance(metres: readonly number[], speedMps: readonly (number | null)[]): number[] | null {
  if (metres.length < 2 || speedMps.length < metres.length) return null;
  const t = [0];
  let v = 0;
  for (let i = 1; i < metres.length; i++) {
    const s = speedMps[i];
    if (s != null && Number.isFinite(s) && s > 0.3) v = s;
    const dx = metres[i] - metres[i - 1];
    if (!(dx >= 0) || v <= 0) { t.push(t[i - 1]); continue; }
    t.push(t[i - 1] + dx / v);
  }
  return t;
}

/** Time at distance `d` on the samples, linear between them. Samples must not go backwards. */
function timeAt(t: readonly number[], d: readonly number[], at: number, from: number): { time: number; index: number } {
  let i = from;
  while (i < d.length - 1 && d[i + 1] < at) i++;
  if (i >= d.length - 1) return { time: t[d.length - 1], index: d.length - 1 };
  const span = d[i + 1] - d[i];
  const f = span > 0 ? (at - d[i]) / span : 0;
  return { time: t[i] + f * (t[i + 1] - t[i]), index: i };
}

/**
 * The quickest time over each distance that fits in the activity. `t` (seconds) and `d` (metres) are the same
 * length and never go backwards. Every sample start is tried; the end is found by interpolation.
 */
export function bestEfforts(t: readonly number[], d: readonly number[], targets = RUN_EFFORTS): Effort[] {
  const n = Math.min(t.length, d.length);
  if (n < 2) return [];
  for (let i = 1; i < n; i++) if (!(d[i] >= d[i - 1]) || !(t[i] >= t[i - 1])) return [];
  const total = d[n - 1] - d[0];
  const out: Effort[] = [];
  for (const target of targets) {
    if (target.metres > total) break;
    let best = Infinity, j = 0;
    for (let i = 0; i < n && d[i] + target.metres <= d[n - 1]; i++) {
      const end = timeAt(t, d, d[i] + target.metres, Math.max(j, i));
      j = end.index;
      const s = end.time - t[i];
      if (s > 0 && s < best) best = s;
    }
    // And every sample as the end, so a stretch that starts between samples is found too.
    let k = 0;
    for (let e = 0; e < n; e++) {
      const from = d[e] - target.metres;
      if (from < d[0]) continue;
      while (k < n - 1 && d[k + 1] < from) k++;
      const span = d[k + 1] - d[k];
      const f = span > 0 ? (from - d[k]) / span : 0;
      const s = t[e] - (t[k] + f * (t[k + 1] - t[k]));
      if (s > 0 && s < best) best = s;
    }
    if (Number.isFinite(best)) out.push({ name: target.name, metres: target.metres, seconds: best });
  }
  return out;
}
