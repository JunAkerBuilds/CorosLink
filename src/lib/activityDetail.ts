// The maths behind one activity's page. The rules follow the phone app (ActivityAnalysis, ActivityFindings,
// TrainingAnalysis, TrainingEffort, RideFindings, SwimAnalysis, StrengthAnalysis, MuscleLoad) so both read alike.
import type { Activity, Lap, MuscleWork, Sport, Streams, StrengthExercise, StrengthSet, SwimData, SwimLength, Stroke, WeekShare, ZoneTime } from "@/data/activities";
import { paceOver, paceUnit, weekKey } from "@/lib/activities";
import { clock } from "@/lib/format";
import { msg, t } from "@/lib/i18n";

const sum = (v: readonly number[]) => v.reduce((s, x) => s + x, 0);

// ------------------------------------------------------------------ effort

export interface EffortLevel { title: string; from: number; hue: string; meaning: string }

/** The five effort levels, by average heart rate as a percent of threshold heart rate. */
export const EFFORT_LEVELS: readonly EffortLevel[] = [
  { title: msg("Easy"), from: 0, hue: "cyan", meaning: msg("Conversational. Builds the base and lets the body recover.") },
  { title: msg("Aerobic"), from: 81, hue: "mint", meaning: msg("Steady endurance. Comfortable, sustainable for a long time.") },
  { title: msg("Tempo"), from: 90, hue: "gold", meaning: msg("Comfortably hard. Short sentences only.") },
  { title: msg("Threshold"), from: 94, hue: "coral", meaning: msg("Right at the edge of what you can hold for an hour.") },
  { title: msg("Hard"), from: 100, hue: "rose", meaning: msg("Above threshold. Intervals and finishes; short by nature.") },
];
export const ZONE_HUES = EFFORT_LEVELS.map((l) => l.hue);

export function thresholdPercent(avgHr: number | null | undefined, thresholdHr: number | null | undefined): number | null {
  if (!avgHr || !thresholdHr) return null;
  return (avgHr / thresholdHr) * 100;
}

export function effortIndex(percent: number): number {
  let k = 0;
  for (let i = 1; i < EFFORT_LEVELS.length; i++) if (percent >= EFFORT_LEVELS[i].from) k = i;
  return k;
}

/** "11 s/km slower than your threshold pace of 4:35 /km." for a pace sport; null when either pace is unknown. */
export function thresholdPaceSentence(paceS: number | null, thresholdS: number | null | undefined): string | null {
  if (paceS == null || !thresholdS) return null;
  const delta = paceS - thresholdS, size = Math.abs(delta);
  const at = `${clock(Math.round(thresholdS))} /km`;
  if (size < 3) return t("Right at your threshold pace of {pace}.", { pace: at });
  const amount = size < 60 ? `${Math.round(size)} s` : clock(Math.round(size));
  return delta > 0 ? t("{amount}/km slower than your threshold pace of {pace}.", { amount, pace: at }) : t("{amount}/km faster than your threshold pace of {pace}.", { amount, pace: at });
}

// ------------------------------------------------------------------- zones

/** The five heart-rate zones cut from threshold heart rate, with no time in them yet. */
export function hrZonesFromThreshold(thresholdHr: number): ZoneTime[] {
  return EFFORT_LEVELS.map((l, i) => ({
    zone: i + 1,
    fromBpm: i === 0 ? null : Math.round((l.from * thresholdHr) / 100),
    toBpm: i === EFFORT_LEVELS.length - 1 ? null : Math.round((EFFORT_LEVELS[i + 1].from * thresholdHr) / 100) - 1,
    seconds: 0,
  }));
}

/** Index of the zone a heart rate falls in, from the zones' lower limits. */
export function hrZoneOf(zones: readonly ZoneTime[], bpm: number): number {
  let k = 0;
  for (let i = 1; i < zones.length; i++) if (zones[i].fromBpm != null && bpm >= (zones[i].fromBpm as number)) k = i;
  return k;
}

/** Pace zones as multiples of threshold pace: the slowest pace of Aerobic, Tempo, Threshold and Hard. */
export const PACE_ZONE_RATIOS = [1.29, 1.14, 1.06, 1] as const;

export function paceZoneOf(paceS: number, thresholdS: number): number {
  const ratio = paceS / thresholdS;
  for (let i = 0; i < PACE_ZONE_RATIOS.length; i++) if (ratio >= PACE_ZONE_RATIOS[i]) return i;
  return PACE_ZONE_RATIOS.length;
}

/** Power zone tops as a share of FTP; zone 7 is everything above the last. */
export const POWER_ZONE_TOPS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] as const;
export const POWER_ZONE_NAMES = [msg("Active recovery"), msg("Endurance"), msg("Tempo"), msg("Threshold"), "VO2max", msg("Anaerobic"), msg("Neuromuscular")] as const;

export function powerZoneOf(watts: number, ftp: number): number {
  for (let i = 0; i < POWER_ZONE_TOPS.length; i++) if (watts <= POWER_ZONE_TOPS[i] * ftp) return i;
  return POWER_ZONE_TOPS.length;
}

/** Seconds per zone: each sample counts for the time it stands for. Samples that `skip` returns true for are left out. */
export function timeInZones(values: readonly number[], dt: readonly number[], zoneOf: (v: number) => number, zones: number, skip?: (v: number, i: number) => boolean): number[] {
  const out = new Array<number>(zones).fill(0);
  values.forEach((v, i) => {
    if (!Number.isFinite(v) || skip?.(v, i)) return;
    out[Math.max(0, Math.min(zones - 1, zoneOf(v)))] += dt[i] ?? 0;
  });
  return out;
}

export interface ZoneRow { name: string; range: string; seconds: number; share: number; color: string }

/** Shares of the whole and the zone the most time went to. */
export function zoneShares<T extends { seconds: number }>(rows: readonly T[]): { rows: (T & { share: number })[]; main: number; total: number } {
  const total = sum(rows.map((r) => r.seconds));
  let main = 0;
  rows.forEach((r, i) => { if (r.seconds > rows[main].seconds) main = i; });
  return { rows: rows.map((r) => ({ ...r, share: total > 0 ? r.seconds / total : 0 })), main, total };
}

export function hrZoneRange(z: ZoneTime): string {
  if (z.fromBpm == null) return t("under {bpm} bpm", { bpm: (z.toBpm ?? 0) + 1 });
  if (z.toBpm == null) return `${z.fromBpm}+ bpm`;
  return `${z.fromBpm}–${z.toBpm + 1} bpm`;
}

export function paceZoneRange(i: number, thresholdS: number): string {
  const at = (r: number) => clock(Math.round(r * thresholdS));
  if (i === 0) return t("slower than {pace} /km", { pace: at(PACE_ZONE_RATIOS[0]) });
  if (i === PACE_ZONE_RATIOS.length) return t("faster than {pace} /km", { pace: at(1) });
  return `${at(PACE_ZONE_RATIOS[i])}–${at(PACE_ZONE_RATIOS[i - 1])} /km`;
}

export function powerZoneRange(i: number, ftp: number): string {
  const top = (k: number) => Math.round(POWER_ZONE_TOPS[k] * ftp);
  if (i === 0) return t("under {watts} W", { watts: top(0) });
  if (i === POWER_ZONE_TOPS.length) return `${top(i - 1)}+ W`;
  return `${top(i - 1)}–${top(i)} W`;
}

// ------------------------------------------------------------------- track

/** A recording with both clocks: seconds and (when known) metres at every sample, and the time each sample stands for. */
export interface Track { n: number; time: number[]; dist: number[] | null; dt: number[]; speed: number[] | null }

/** Metres per second from a chart "pace" value. */
export function speedFromPace(sport: Sport, value: number): number {
  const unit = paceUnit(sport);
  if (!unit || !(value > 0)) return 0;
  return unit === "km/h" ? value / 3.6 : (unit === "min/km" ? 1000 : 100) / value;
}

export function trackOf(streams: Streams, sport: Sport, durationS: number): Track {
  const n = streams.x.length;
  const speed = streams.pace ? streams.pace.map((p) => speedFromPace(sport, p)) : null;
  let time: number[], dist: number[] | null;
  if (streams.axis === "time") {
    time = streams.x.slice();
    dist = streams.distance && streams.distance.length === n ? streams.distance.slice() : null;
  } else {
    dist = streams.x.slice();
    time = [0];
    for (let i = 1; i < n; i++) {
      const v = speed ? (speed[i - 1] + speed[i]) / 2 : 0;
      time.push(time[i - 1] + (v > 0 ? (dist[i] - dist[i - 1]) / v : 0));
    }
    const end = time[n - 1];
    // Without speed the time is spread evenly; with it, the clock is stretched to end on the activity's own time.
    if (!(end > 0)) time = dist.map((d) => (dist![n - 1] > 0 ? (d / dist![n - 1]) * durationS : 0));
    else if (durationS > 0) time = time.map((tm) => (tm * durationS) / end);
  }
  const dt = time.map((_, i) => ((time[Math.min(n - 1, i + 1)] - time[Math.max(0, i - 1)]) / 2));
  return { n, time, dist, dt, speed };
}

// ----------------------------------------------------- grade-adjusted pace

/** How much harder (or easier) a slope makes running than flat ground, from Minetti's cost curve. Never under 0.8. */
export function gradeFactor(grade: number): number {
  const i = Math.max(-0.45, Math.min(0.45, grade));
  const cost = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  return Math.max(cost / 3.6, 0.8);
}

/** Linear reading of `values` at a position along `axis` (which only grows). */
export function valueAt(axis: readonly number[], values: readonly number[], at: number): number {
  const n = axis.length;
  if (n === 0) return 0;
  if (at <= axis[0]) return values[0];
  if (at >= axis[n - 1]) return values[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (axis[mid] <= at) lo = mid; else hi = mid; }
  const span = axis[hi] - axis[lo];
  return span > 0 ? values[lo] + ((values[hi] - values[lo]) * (at - axis[lo])) / span : values[lo];
}

/**
 * The flat-ground metres a stretch was worth: the slope is read every 100 m or more, and a leftover under
 * 50 m counts as flat.
 */
export function flatMetres(dist: readonly number[], elevation: readonly number[], from: number, to: number): number {
  let flat = 0;
  for (let a = from; a < to - 1e-6;) {
    const b = to - a < 150 ? to : a + 100;
    const d = b - a;
    const grade = d >= 50 ? (valueAt(dist, elevation, b) - valueAt(dist, elevation, a)) / d : 0;
    flat += d * (d >= 50 ? gradeFactor(grade) : 1);
    a = b;
  }
  return flat;
}

// ------------------------------------------------------------------ splits

export interface SplitRow {
  label: string;
  name?: string;
  fromM: number;
  toM: number;
  distanceM: number;
  durationS: number;
  /** Seconds per km of flat-ground running the split was worth; null without elevation. */
  gapS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  cadence: number | null;
  strideM: number | null;
  groundContactMs: number | null;
  verticalOscCm: number | null;
  powerW: number | null;
  maxPowerW: number | null;
  ascentM: number | null;
  descentM: number | null;
  /** Shorter than a whole split length. */
  partial: boolean;
}

const mean = (values: readonly number[] | null | undefined, w: readonly number[], from: number, to: number, pick: (i: number) => boolean): number | null => {
  if (!values) return null;
  let s = 0, tm = 0;
  for (let i = from; i <= to; i++) if (pick(i) && Number.isFinite(values[i])) { s += values[i] * w[i]; tm += w[i]; }
  return tm > 0 ? s / tm : null;
};

/** Everything the recording says about the stretch between two distances. */
export function stretch(track: Track, streams: Streams, sport: Sport, fromM: number, toM: number, label: string, unitM: number): SplitRow | null {
  const { dist, time, dt } = track;
  if (!dist || toM <= fromM) return null;
  const inside = (i: number) => dist[i] >= fromM && dist[i] <= toM;
  let a = dist.findIndex((d) => d >= fromM), b = -1;
  for (let i = dist.length - 1; i >= 0; i--) if (dist[i] <= toM) { b = i; break; }
  if (a < 0) a = dist.length - 1;
  if (b < a) b = a;
  const max = (values: readonly number[] | null | undefined) => {
    if (!values) return null;
    let m = -Infinity;
    for (let i = a; i <= b; i++) if (inside(i) && values[i] > m) m = values[i];
    return Number.isFinite(m) ? m : null;
  };
  const durationS = valueAt(dist, time, toM) - valueAt(dist, time, fromM);
  const distanceM = toM - fromM;
  let ascentM: number | null = null, descentM: number | null = null;
  if (streams.elevation) {
    ascentM = 0; descentM = 0;
    let prev = valueAt(dist, streams.elevation, fromM);
    for (let i = a; i <= b + 1; i++) {
      const at = i > b ? valueAt(dist, streams.elevation, toM) : streams.elevation[i];
      if (i <= b && !inside(i)) continue;
      if (at > prev) ascentM += at - prev; else descentM += prev - at;
      prev = at;
    }
  }
  const cadence = mean(streams.cadence, dt, a, b, inside);
  const running = paceUnit(sport) === "min/km";
  const stride = streams.stride ? mean(streams.stride, dt, a, b, inside)
    : running && cadence && durationS > 0 ? (distanceM / durationS) * 60 / cadence : null;
  return {
    label, fromM, toM, distanceM, durationS,
    gapS: running && streams.elevation && distanceM > 0 ? (durationS / flatMetres(dist, streams.elevation, fromM, toM)) * 1000 : null,
    avgHr: mean(streams.hr, dt, a, b, inside), maxHr: max(streams.hr), cadence, strideM: stride,
    groundContactMs: mean(streams.groundContact, dt, a, b, inside), verticalOscCm: mean(streams.verticalOsc, dt, a, b, inside),
    powerW: mean(streams.power, dt, a, b, inside), maxPowerW: max(streams.power), ascentM, descentM,
    partial: distanceM < unitM * 0.98,
  };
}

/** The recording cut every `unitM` metres. A last piece shorter than half a percent of a split is dropped. */
export function splitsFromTrack(track: Track, streams: Streams, sport: Sport, unitM: number): SplitRow[] {
  const total = track.dist?.[track.n - 1] ?? 0;
  const out: SplitRow[] = [];
  for (let from = 0, k = 1; from < total - unitM * 0.005; from += unitM, k++) {
    const to = Math.min(total, from + unitM);
    const whole = to - from >= unitM * 0.98;
    const label = whole ? String(Number(((k * unitM) / 1000).toFixed(2))) : Number(((to - from) / 1000).toFixed(2)).toString();
    const row = stretch(track, streams, sport, from, to, label, unitM);
    if (row) out.push(row);
  }
  return out;
}

/** True when the watch's laps are only its automatic kilometre (or mile) laps: every lap but the last is one long. */
export function lapsAreAutomatic(laps: readonly Lap[]): boolean {
  if (laps.length === 0) return true;
  const auto = (m: number | null) => m != null && (Math.abs(m - 1000) <= 20 || Math.abs(m - 1609.344) <= 30);
  return laps.slice(0, -1).every((l) => auto(l.distanceM)) && (laps.length > 1 || auto(laps[0].distanceM));
}

const pickNum = (...v: (number | null | undefined)[]): number | null => {
  for (const x of v) if (x != null && Number.isFinite(x)) return x;
  return null;
};

/**
 * Rows for laps the watch recorded: the lap's own numbers first, and the recording for anything it left out.
 * Works without a recording too (then only the lap's own numbers show).
 */
export function rowsFromLaps(laps: readonly Lap[], track: Track | null, streams: Streams | null, sport: Sport, unitM: number): SplitRow[] {
  let at = 0;
  return laps.map((l, k) => {
    const fromM = at, toM = at + (l.distanceM ?? 0);
    at = toM;
    const read = track && streams && l.distanceM ? stretch(track, streams, sport, fromM, toM, "", unitM) : null;
    const whole = l.distanceM != null && l.distanceM >= unitM * 0.98;
    const running = paceUnit(sport) === "min/km";
    const row: SplitRow = {
      label: l.distanceM != null && !whole && k === laps.length - 1 ? Number((l.distanceM / 1000).toFixed(2)).toString() : String(l.n),
      fromM, toM, distanceM: l.distanceM ?? 0, durationS: l.durationS,
      gapS: read?.gapS != null && read.durationS > 0 ? read.gapS * (l.durationS / read.durationS) : null,
      avgHr: pickNum(l.avgHr, read?.avgHr), maxHr: pickNum(l.maxHr, read?.maxHr), cadence: pickNum(l.cadence, read?.cadence),
      strideM: pickNum(l.strideM, read?.strideM, running && l.cadence && l.distanceM && l.durationS > 0 ? (l.distanceM / l.durationS) * 60 / l.cadence : null),
      groundContactMs: pickNum(l.groundContactMs, read?.groundContactMs), verticalOscCm: pickNum(l.verticalOscCm, read?.verticalOscCm),
      powerW: pickNum(l.powerW, read?.powerW), maxPowerW: pickNum(l.maxPowerW, read?.maxPowerW),
      ascentM: pickNum(l.ascentM, read?.ascentM, l.elevationM != null && l.elevationM >= 0 ? l.elevationM : null), descentM: pickNum(l.descentM, read?.descentM),
      partial: !whole,
    };
    if (l.name) row.name = l.name;
    return row;
  });
}

/** Joins every `size` rows into one (1 km splits into 5 km splits). */
export function groupRows(rows: readonly SplitRow[], size: number, unitM: number): SplitRow[] {
  const out: SplitRow[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const total = totalRow(part, "");
    const whole = total.distanceM >= unitM * size * 0.98;
    out.push({
      ...total,
      label: whole ? String(Number(((unitM * size * (out.length + 1)) / 1000).toFixed(2))) : Number((total.toM / 1000).toFixed(2)).toString(),
      partial: !whole,
    });
  }
  return out;
}

/** Rows added up: times, distance, ascent and descent are summed, the rest weighted by time. */
export function totalRow(rows: readonly SplitRow[], label: string): SplitRow {
  const time = sum(rows.map((r) => r.durationS));
  const weighted = (pick: (r: SplitRow) => number | null) => {
    const have = rows.filter((r) => pick(r) != null);
    const tm = sum(have.map((r) => r.durationS));
    return have.length > 0 && tm > 0 ? sum(have.map((r) => (pick(r) as number) * r.durationS)) / tm : null;
  };
  const added = (pick: (r: SplitRow) => number | null) => (rows.some((r) => pick(r) != null) ? sum(rows.map((r) => pick(r) ?? 0)) : null);
  const top = (pick: (r: SplitRow) => number | null) => {
    const have = rows.map(pick).filter((v): v is number => v != null);
    return have.length ? Math.max(...have) : null;
  };
  const distanceM = sum(rows.map((r) => r.distanceM));
  // Flat metres add up; the pace over them is the total's grade-adjusted pace.
  // A row too short to read a slope from counts as flat.
  const flat = rows.some((r) => r.gapS != null && r.gapS > 0) ? sum(rows.map((r) => (r.gapS != null && r.gapS > 0 ? (r.durationS / r.gapS) * 1000 : r.distanceM))) : null;
  return {
    label, fromM: rows[0]?.fromM ?? 0, toM: rows[rows.length - 1]?.toM ?? 0, distanceM, durationS: Math.round(time * 100) / 100,
    gapS: flat && flat > 0 ? (time / flat) * 1000 : null,
    avgHr: weighted((r) => r.avgHr), maxHr: top((r) => r.maxHr), cadence: weighted((r) => r.cadence), strideM: weighted((r) => r.strideM),
    groundContactMs: weighted((r) => r.groundContactMs), verticalOscCm: weighted((r) => r.verticalOscCm),
    powerW: weighted((r) => r.powerW), maxPowerW: top((r) => r.maxPowerW), ascentM: added((r) => r.ascentM), descentM: added((r) => r.descentM),
    partial: false,
  };
}

/** The fastest whole split, when there are at least two to compare. */
export function fastestIndex(rows: readonly SplitRow[]): number {
  const whole = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.partial && r.durationS > 0 && r.distanceM > 0);
  if (whole.length < 2) return -1;
  return whole.reduce((best, x) => (x.r.distanceM / x.r.durationS > best.r.distanceM / best.r.durationS ? x : best)).i;
}

/** The grade-adjusted column is worth showing when some split differs from its pace by 3 s/km or more. */
export function showsGap(rows: readonly SplitRow[]): boolean {
  return rows.some((r) => r.gapS != null && r.distanceM > 0 && Math.abs(r.gapS - (r.durationS / r.distanceM) * 1000) >= 3);
}

// ---------------------------------------------------------------- findings

export interface Finding { title: string; note: string }

export type WorkoutKind = "Intervals" | "Hard effort" | "Threshold" | "Tempo" | "Long" | "Recovery" | "Easy" | "Steady";

/** Share of the heart-rate time under 90%, under 100% and at or over 100% of threshold heart rate. */
export function intensityShares(hr: readonly number[], dt: readonly number[], thresholdHr: number): { low: number; moderate: number; high: number; seconds: number } {
  const tm = timeInZones(hr, dt, (v) => { const p = (v / thresholdHr) * 100; return p < 90 ? 0 : p < 100 ? 1 : 2; }, 3, (v) => v <= 30);
  const seconds = sum(tm) || 0;
  return { low: seconds ? tm[0] / seconds : 0, moderate: seconds ? tm[1] / seconds : 0, high: seconds ? tm[2] / seconds : 0, seconds };
}

/** Laps the athlete pressed themselves, uneven enough to be repetitions. */
export function looksLikeIntervals(laps: readonly Lap[]): boolean {
  if (laps.length < 4) return false;
  const manual = laps.filter((l) => l.distanceM == null || !(Math.abs(l.distanceM - 1000) <= 20 || Math.abs(l.distanceM - 1609.344) <= 30));
  if (manual.length < laps.length - 1) return false;
  const speeds = laps.filter((l) => l.distanceM && l.durationS > 0).map((l) => (l.distanceM as number) / l.durationS);
  if (speeds.length < 4) return false;
  const m = sum(speeds) / speeds.length;
  const sd = Math.sqrt(sum(speeds.map((s) => (s - m) ** 2)) / speeds.length);
  return m > 0 && sd / m >= 0.12;
}

export function workoutKind(input: {
  sport: Sport; laps: readonly Lap[]; hr: readonly number[] | null; dt: readonly number[]; movingS: number; thresholdHr: number | null | undefined; avgHr: number | null;
}): WorkoutKind | null {
  if (input.sport !== "Run" && input.sport !== "Ride") return null;
  if (looksLikeIntervals(input.laps)) return msg("Intervals");
  if (!input.hr || !input.thresholdHr || !input.avgHr) return null;
  const s = intensityShares(input.hr, input.dt, input.thresholdHr);
  if (input.movingS <= 0 || s.seconds < input.movingS * 0.6) return null;
  const pct = (input.avgHr / input.thresholdHr) * 100, minutes = input.movingS / 60;
  if (s.high >= 0.5) return msg("Hard effort");
  if (s.moderate + s.high >= 0.6 && pct >= 94) return msg("Threshold");
  if (s.moderate >= 0.4) return msg("Tempo");
  if (s.low >= 0.7 && minutes >= (input.sport === "Ride" ? 150 : 75)) return msg("Long");
  if (s.low >= 0.9 && pct < 80 && minutes <= 45) return msg("Recovery");
  if (s.low >= 0.75) return msg("Easy");
  return msg("Steady");
}

/**
 * Heart rate against output, first half against second, after the first five minutes: how much less speed
 * (or power) each heartbeat bought late on. Null without 20 minutes to read or with patchy heart rate.
 */
export function decoupling(track: Track, output: readonly number[] | null, hr: readonly number[] | null): number | null {
  if (!output || !hr) return null;
  const { time, dt, n } = track;
  const start = time.findIndex((tm) => tm >= time[0] + 300);
  if (start < 0 || time[n - 1] - time[start] < 1200) return null;
  const mid = (time[start] + time[n - 1]) / 2;
  const half = (from: number, to: number) => {
    let o = 0, h = 0, tm = 0, all = 0;
    for (let i = start; i < n; i++) {
      if (time[i] < from || time[i] > to) continue;
      all += dt[i];
      if (hr[i] > 30 && output[i] > 0) { o += output[i] * dt[i]; h += hr[i] * dt[i]; tm += dt[i]; }
    }
    return all > 0 && tm / all >= 0.8 && h > 0 ? o / h : null;
  };
  const a = half(time[start], mid), b = half(mid, time[n - 1]);
  return a == null || b == null || a <= 0 ? null : ((a - b) / a) * 100;
}

export function decouplingTitle(percent: number): string {
  const x = Math.abs(percent).toFixed(1);
  if (percent < -2) return t("Got more efficient as it went ({percent}%)", { percent: x });
  if (percent < 5) return t("Held steady: {percent}% drift", { percent: x });
  if (percent < 10) return t("Some drift: {percent}%", { percent: x });
  return t("Large drift: {percent}%", { percent: x });
}

/** Second half against first, by distance, as a percent: negative when the second half was faster. */
export function pacingSplit(track: Track, elevation: readonly number[] | null): number | null {
  const { dist, time, n } = track;
  if (!dist || dist[n - 1] < 3000) return null;
  const total = dist[n - 1], mid = total / 2;
  const tMid = valueAt(dist, time, mid);
  const first = tMid - time[0], second = time[n - 1] - tMid;
  const flatA = elevation ? flatMetres(dist, elevation, 0, mid) : mid, flatB = elevation ? flatMetres(dist, elevation, mid, total) : total - mid;
  if (!(first > 0 && second > 0 && flatA > 0 && flatB > 0)) return null;
  return ((second / flatB) / (first / flatA) - 1) * 100;
}

export function pacingFinding(split: number): Finding {
  const x = Math.abs(split).toFixed(1);
  const note = split < 0 ? t("Second half {percent}% faster", { percent: x }) : t("Second half {percent}% slower", { percent: x });
  if (Math.abs(split) <= 2) return { title: t("Even pacing"), note };
  if (split < 0) return { title: t("Negative split"), note };
  return { title: split <= 5 ? t("Slight fade") : t("Positive split"), note };
}

// -------------------------------------------------------------------- ride

/** Normalized power: the fourth root of the mean fourth power of a 30-second rolling average. Null under 30 s. */
export function normalizedPower(time: readonly number[], power: readonly number[]): number | null {
  const n = time.length;
  if (n < 2) return null;
  const span = Math.floor(time[n - 1] - time[0]);
  if (span < 30) return null;
  // Once a second, so the 30-second window means the same whatever the recording interval.
  const each: number[] = [];
  for (let s = 0; s <= span; s++) each.push(Math.max(0, valueAt(time, power, time[0] + s)));
  let window = 0, total = 0, count = 0;
  for (let i = 0; i < each.length; i++) {
    window += each[i];
    if (i >= 30) window -= each[i - 30];
    if (i >= 29) { total += (window / 30) ** 4; count++; }
  }
  return count > 0 ? (total / count) ** 0.25 : null;
}

export interface PowerNumbers { np: number | null; avg: number; max: number; intensity: number | null; stress: number | null; variability: number | null }

export function powerNumbers(track: Track, power: readonly number[], ftp: number | null | undefined): PowerNumbers {
  const tm = sum(track.dt) || 1;
  const avg = sum(power.map((p, i) => Math.max(0, p) * track.dt[i])) / tm;
  const np = normalizedPower(track.time, power);
  const intensity = np != null && ftp ? np / ftp : null;
  const seconds = track.time[track.n - 1] - track.time[0];
  return {
    np, avg, max: Math.max(...power), intensity,
    stress: np != null && ftp && intensity != null ? ((seconds * np * intensity) / (ftp * 3600)) * 100 : null,
    variability: np != null && avg > 0 ? np / avg : null,
  };
}

export const intensityLabel = (f: number): string => (f < 0.75 ? t("Endurance") : f < 0.85 ? t("Tempo") : f < 0.95 ? t("Sweet spot") : t("At threshold or above"));
export const variabilityLabel = (v: number): string => (v <= 1.05 ? t("Evenly ridden") : v <= 1.15 ? t("Some surges") : t("Stop-start or attacking"));

export interface Climb { fromM: number; toM: number; gainM: number; grade: number; seconds: number; powerW: number | null; hr: number | null }

/**
 * Climbs worth naming: one starts when the road has risen 10 m from its low point and ends when it drops 10 m
 * below the top or goes 1 km without a new top; kept when at least 500 m long, 3% steep and 80 m high.
 */
export function findClimbs(track: Track, streams: Streams): Climb[] {
  const { dist, time, dt } = track, alt = streams.elevation;
  if (!dist || !alt) return [];
  const out: Climb[] = [];
  let low = 0, top = -1, climbing = false;
  const close = () => {
    // A flat run-in is not part of the climb: it starts at the last point within 2 m of the low.
    while (low < top - 1 && alt[low + 1] - alt[low] < 2 && alt[low + 1] <= alt[top] - 10) {
      if (alt[low + 1] - alt[low] < 0) break;
      const base = alt[low];
      let k = low + 1;
      while (k < top && alt[k] - base < 2) k++;
      if (k - 1 === low) break;
      low = k - 1;
    }
    const fromM = dist[low], toM = dist[top], gainM = alt[top] - alt[low], length = toM - fromM;
    if (length >= 500 && gainM >= 80 && gainM / length >= 0.03) {
      const inside = (i: number) => i >= low && i <= top;
      out.push({
        fromM, toM, gainM, grade: gainM / length, seconds: time[top] - time[low],
        powerW: mean(streams.power, dt, low, top, inside), hr: mean(streams.hr, dt, low, top, inside),
      });
    }
  };
  for (let i = 1; i < track.n; i++) {
    if (!climbing) {
      if (alt[i] < alt[low]) low = i;
      else if (alt[i] - alt[low] >= 10) { climbing = true; top = i; }
    } else if (alt[i] > alt[top]) top = i;
    else if (alt[top] - alt[i] >= 10 || dist[i] - dist[top] >= 1000) { close(); climbing = false; low = i; }
  }
  if (climbing) close();
  return out;
}

// --------------------------------------------------------- relative effort

/** Edwards' weight for a heart rate as a share of the maximum. */
export function edwardsWeight(hr: number, maxHr: number): number {
  const p = (hr / maxHr) * 100;
  return p < 50 ? 0 : p < 60 ? 1 : p < 70 ? 2 : p < 80 ? 3 : p < 90 ? 4 : 5;
}

export function effortFromSamples(hr: readonly number[], dt: readonly number[], maxHr: number): number {
  return sum(hr.map((v, i) => (v > 30 ? (dt[i] / 60) * edwardsWeight(v, maxHr) : 0)));
}

export const effortFromAverage = (durationS: number, avgHr: number, maxHr: number): number => (durationS / 60) * edwardsWeight(avgHr, maxHr);

/** Sports whose efforts are compared with each other. */
export function effortFamily(a: Pick<Activity, "sport" | "sportName">): string {
  if (a.sport === "Run") return a.sportName === "Walk" || a.sportName === "Hike" ? "walk" : "run";
  return a.sport;
}

/**
 * Share (0 to 100) of the same family's workouts in the 90 days before that scored strictly lower.
 * Null with fewer than five to compare against.
 */
export function harderThan(score: number, activity: Pick<Activity, "id" | "start" | "sport" | "sportName">, all: readonly Activity[], maxHr: number): number | null {
  const at = new Date(activity.start).getTime(), from = at - 90 * 86_400_000;
  const family = effortFamily(activity);
  const before = all.filter((a) => {
    const tm = new Date(a.start).getTime();
    return a.id !== activity.id && tm < at && tm >= from && effortFamily(a) === family && a.avgHr != null && a.durationS > 0;
  });
  if (before.length < 5) return null;
  const lower = before.filter((a) => effortFromAverage(a.durationS, a.avgHr as number, maxHr) < score).length;
  return Math.round((lower / before.length) * 100);
}

// -------------------------------------------------------------------- week

export function weekShare(activity: Pick<Activity, "id" | "start" | "durationS" | "load">, all: readonly Activity[]): WeekShare | null {
  const key = weekKey(activity.start);
  const week = all.filter((a) => weekKey(a.start) === key).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const index = week.findIndex((a) => a.id === activity.id);
  if (index < 0) return null;
  const time = sum(week.map((a) => a.durationS)), load = sum(week.map((a) => a.load ?? 0));
  if (week.length < 2 && !(load > 0)) return null;
  return {
    index: index + 1, count: week.length,
    time: time > 0 ? activity.durationS / time : null,
    load: load > 0 && activity.load != null ? activity.load / load : null,
  };
}

// -------------------------------------------------------------------- swim

export interface SwimNumbers {
  lengths: number; distanceM: number; activeS: number; restS: number;
  /** Seconds per 100 m while swimming. */
  paceS: number | null;
  swolf: number | null; strokesPerLength: number | null; strokeRate: number | null; perStrokeM: number | null;
  mix: { stroke: Stroke; distanceM: number; share: number }[];
}

export function swimNumbers(data: SwimData): SwimNumbers {
  const L = data.lengths, n = L.length;
  const activeS = sum(L.map((l) => l.seconds));
  const stroked = L.filter((l) => l.strokes != null && l.strokes > 0);
  const strokes = sum(stroked.map((l) => l.strokes as number)), strokedS = sum(stroked.map((l) => l.seconds));
  const order: Stroke[] = [];
  for (const l of L) if (!order.includes(l.stroke)) order.push(l.stroke);
  return {
    lengths: n, distanceM: n * data.poolM, activeS, restS: sum(L.slice(0, -1).map((l) => l.restAfterS)),
    paceS: n > 0 ? (activeS / (n * data.poolM)) * 100 : null,
    swolf: stroked.length ? sum(stroked.map((l) => l.seconds + (l.strokes as number))) / stroked.length : null,
    strokesPerLength: stroked.length ? strokes / stroked.length : null,
    strokeRate: strokedS > 0 ? (strokes / strokedS) * 60 : null,
    perStrokeM: strokes > 0 ? (stroked.length * data.poolM) / strokes : null,
    mix: order.map((stroke) => {
      const count = L.filter((l) => l.stroke === stroke).length;
      return { stroke, distanceM: count * data.poolM, share: n ? count / n : 0 };
    }).sort((a, b) => b.distanceM - a.distanceM),
  };
}

/** A pause at the wall this long ends a repetition. */
export const SWIM_REST_S = 10;

export interface SwimRep { from: number; lengths: number; seconds: number; restAfterS: number; stroke: Stroke | "mixed" }
export interface SwimSet { reps: SwimRep[]; lengths: number; stroke: Stroke | "mixed"; distanceM: number; seconds: number; intervalS: number | null; avgRepS: number; avgRestS: number | null; paceS: number }

const mainStroke = (lengths: readonly SwimLength[]): Stroke | "mixed" => {
  const count = new Map<Stroke, number>();
  for (const l of lengths) count.set(l.stroke, (count.get(l.stroke) ?? 0) + 1);
  for (const [stroke, k] of count) if (k > lengths.length / 2) return stroke;
  return "mixed";
};

/** Repetitions end at a rest of ten seconds or more; a set is a run of repetitions of the same length and stroke. */
export function swimSets(data: SwimData): SwimSet[] {
  const reps: SwimRep[] = [];
  let from = 0;
  data.lengths.forEach((l, i) => {
    if (l.restAfterS >= SWIM_REST_S || i === data.lengths.length - 1) {
      const part = data.lengths.slice(from, i + 1);
      reps.push({ from, lengths: part.length, seconds: sum(part.map((p) => p.seconds)), restAfterS: i === data.lengths.length - 1 ? 0 : l.restAfterS, stroke: mainStroke(part) });
      from = i + 1;
    }
  });
  const groups: SwimRep[][] = [];
  for (const rep of reps) {
    const last = groups[groups.length - 1];
    if (last && last[0].lengths === rep.lengths && last[0].stroke === rep.stroke) last.push(rep);
    else groups.push([rep]);
  }
  return groups.map((g) => {
    const starts = g.slice(0, -1).map((r) => r.seconds + r.restAfterS);
    const even = starts.length > 0 && Math.max(...starts) - Math.min(...starts) <= 5;
    const median = even ? [...starts].sort((a, b) => a - b)[Math.floor(starts.length / 2)] : null;
    const seconds = sum(g.map((r) => r.seconds)), lengths = sum(g.map((r) => r.lengths));
    const rests = g.slice(0, -1).map((r) => r.restAfterS);
    return {
      reps: g, lengths: g[0].lengths, stroke: g[0].stroke, distanceM: g[0].lengths * data.poolM, seconds,
      intervalS: median == null ? null : Math.round(median / 5) * 5,
      avgRepS: seconds / g.length, avgRestS: rests.length ? sum(rests) / rests.length : null,
      paceS: (seconds / (lengths * data.poolM)) * 100,
    };
  });
}

/** A stroke as it reads inside a set's line ("100 m freestyle"). */
const STROKE_WORD: Record<Stroke | "mixed", string> = {
  Freestyle: msg("freestyle"), Breaststroke: msg("breaststroke"), Backstroke: msg("backstroke"), Butterfly: msg("butterfly"),
  Medley: msg("medley"), Drill: msg("drill"), mixed: msg("mixed strokes"),
};

export function swimSetText(set: SwimSet): { title: string; detail: string } {
  const stroke = t(STROKE_WORD[set.stroke] ?? set.stroke.toLowerCase());
  const pace = `${clock(Math.round(set.paceS))} /100 m`;
  if (set.reps.length === 1) return { title: t("{distance} m {stroke}", { distance: set.distanceM, stroke }), detail: t("{lengths} lengths · {pace}", { lengths: set.lengths, pace }) };
  const avg = clock(Math.round(set.avgRepS));
  return {
    title: set.intervalS
      ? t("{reps} × {distance} m {stroke} on {interval}", { reps: set.reps.length, distance: set.distanceM, stroke, interval: clock(set.intervalS) })
      : t("{reps} × {distance} m {stroke}", { reps: set.reps.length, distance: set.distanceM, stroke }),
    detail: set.avgRestS != null ? t("Average {time}, rest {rest}", { time: avg, rest: clock(Math.round(set.avgRestS)) }) : t("Average {time}", { time: avg }),
  };
}

// ---------------------------------------------------------------- strength

/** Epley's estimate of the most that could be lifted once, for sets of 1 to 12 reps. */
export function oneRepMax(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || reps < 1 || reps > 12) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** The exercise's best estimate, to the nearest half kilo; null when no set had more than one rep. */
export function exerciseOneRepMax(ex: StrengthExercise): number | null {
  if (ex.bodyweight || !ex.sets.some((s) => (s.reps ?? 0) > 1)) return null;
  const all = ex.sets.map((s) => (s.weightKg != null && s.reps != null ? oneRepMax(s.weightKg, s.reps) : null)).filter((v): v is number => v != null);
  return all.length ? Math.round(Math.max(...all) * 2) / 2 : null;
}

export const setVolume = (s: StrengthSet): number => (s.weightKg ?? 0) * (s.reps ?? 0);

/** The set to star: the working set with the most volume (or reps, with no weights), when another set did less. */
export function topSetIndex(sets: readonly StrengthSet[]): number {
  if (sets.length < 2) return -1;
  const byVolume = sets.some((s) => setVolume(s) > 0);
  // A warm-up set never takes the star, however many reps it had.
  const score = sets.map((s) => (s.warmUp ? 0 : byVolume ? setVolume(s) : s.reps ?? 0));
  const best = Math.max(...score);
  if (!(best > 0) || !score.some((v) => v < best)) return -1;
  return score.indexOf(best);
}

export interface TimedSet { exercise: number; set: number; startS: number | null; endS: number | null; restS: number | null; volume: number; reps: number }

/** Working sets in the order they were done, each with the rest that followed when both ends are known. */
export function timedSets(exercises: readonly StrengthExercise[]): TimedSet[] {
  const flat: TimedSet[] = [];
  exercises.forEach((ex, e) => ex.sets.forEach((s, k) => {
    if (s.warmUp) return;
    flat.push({ exercise: e, set: k, endS: s.endS, startS: s.endS != null && s.seconds != null ? s.endS - s.seconds : null, restS: null, volume: setVolume(s), reps: s.reps ?? 0 });
  }));
  const timed = flat.every((s) => s.endS != null);
  if (timed) flat.sort((a, b) => (a.endS as number) - (b.endS as number));
  flat.forEach((s, i) => {
    const next = flat[i + 1];
    if (next && s.endS != null && next.startS != null && next.startS >= s.endS) s.restS = next.startS - s.endS;
  });
  return flat;
}

export interface SessionNumbers { sets: number; exercises: number; reps: number; volumeKg: number; workS: number | null; restS: number | null; density: number | null; avgRestS: number | null }

export function sessionNumbers(exercises: readonly StrengthExercise[]): SessionNumbers {
  const sets = timedSets(exercises);
  const working = exercises.flatMap((ex) => ex.sets.filter((s) => !s.warmUp));
  const timed = working.length > 0 && working.every((s) => s.seconds != null);
  const workS = timed ? sum(working.map((s) => s.seconds as number)) : null;
  const rests = sets.map((s) => s.restS).filter((v): v is number => v != null);
  const restS = rests.length && rests.length >= sets.length - 1 ? sum(rests) : null;
  return {
    sets: working.length, exercises: exercises.filter((ex) => ex.sets.some((s) => !s.warmUp)).length,
    reps: sum(working.map((s) => s.reps ?? 0)), volumeKg: sum(working.map(setVolume)),
    workS, restS, density: workS != null && restS != null && workS + restS > 0 ? workS / (workS + restS) : null,
    avgRestS: rests.length ? sum(rests) / rests.length : null,
  };
}

/** Highest heart rate around the end of a set: from ten seconds before to three after. */
export function peakAround(time: readonly number[], hr: readonly number[], endS: number): number | null {
  let top = -Infinity;
  for (let i = 0; i < time.length; i++) if (time[i] >= endS - 10 && time[i] <= endS + 3 && hr[i] > top) top = hr[i];
  if (!Number.isFinite(top)) top = time.length ? valueAt(time, hr, endS) : -Infinity;
  return Number.isFinite(top) && top > 30 ? top : null;
}

/** How far heart rate fell in a rest: the peak at the end of the set minus the lowest reading before the next. */
export function restDrop(time: readonly number[], hr: readonly number[], endS: number, nextStartS: number): number | null {
  const peak = peakAround(time, hr, endS);
  if (peak == null) return null;
  let low = Infinity;
  for (let i = 0; i < time.length; i++) if (time[i] >= endS && time[i] <= nextStartS && hr[i] < low) low = hr[i];
  return Number.isFinite(low) ? Math.max(0, peak - low) : null;
}

export const MUSCLE_LEVELS = [
  { from: 8, title: msg("Hammered") }, { from: 5.5, title: msg("Hard") }, { from: 3.5, title: msg("Solid") }, { from: 1.75, title: msg("Moderate") }, { from: 0.01, title: msg("Light") },
] as const;

export function muscleLevel(sets: number): string | null {
  return MUSCLE_LEVELS.find((l) => sets >= l.from)?.title ?? null;
}

/** Effective sets per muscle: each working set counts 1 for its movers and less for its helpers. Most worked first. */
export function muscleWork(entries: readonly { workingSets: number; muscles: readonly (readonly [string, number])[] }[]): MuscleWork[] {
  const total = new Map<string, number>();
  for (const e of entries) for (const [name, share] of e.muscles) total.set(name, (total.get(name) ?? 0) + share * e.workingSets);
  return [...total].filter(([, sets]) => sets >= 0.01).map(([name, sets]) => ({ name, sets: Math.round(sets * 100) / 100 })).sort((a, b) => b.sets - a.sets || (a.name < b.name ? -1 : 1));
}

// --------------------------------------------------------------- formatting

/** A split's pace or speed for the table: 5:08, 27.8. */
export function rowPace(sport: Sport, row: Pick<SplitRow, "distanceM" | "durationS">): string {
  const v = paceOver(sport, row.distanceM, row.durationS);
  if (v == null) return "—";
  return paceUnit(sport) === "km/h" ? v.toFixed(1) : clock(Math.round(v));
}

/** Times to the hundredth under an hour; whole seconds with the hour shown above it stay exact too. */
export const exact = (seconds: number): string => clock(seconds, 2);

// ------------------------------------------------- relative effort, whole

export interface RelativeEffort { score: number; harderThanPct: number | null; basis: string }

/** The highest heart rate to weigh efforts against: the athlete's own setting, else what their activities show. */
export function maxHrFor(setting: number | null | undefined, thresholdHr: number | null | undefined, all: readonly Pick<Activity, "maxHr">[]): number | null {
  if (setting) return setting;
  const seen = all.map((a) => a.maxHr).filter((v): v is number => v != null && v >= 120 && v <= 230).sort((a, b) => b - a);
  if (seen.length > 1) return seen[0] - seen[1] > 8 ? seen[1] : seen[0];
  if (seen.length === 1) return seen[0];
  return thresholdHr ? thresholdHr / 0.9 : null;
}

/** Relative Effort for one activity: from its heart-rate recording, else its average, else (strength) its sets. */
export function relativeEffort(input: {
  activity: Activity; streams: Streams | null; all: readonly Activity[]; maxHr: number | null; exercises?: readonly StrengthExercise[];
}): RelativeEffort | null {
  const { activity: a, streams, all, maxHr } = input;
  let score: number | null = null, basis = "", fromSets = false;
  if (maxHr && streams?.hr) score = effortFromSamples(streams.hr, trackOf(streams, a.sport, a.durationS).dt, maxHr);
  else if (maxHr && a.avgHr) { score = effortFromAverage(a.durationS, a.avgHr, maxHr); basis = t("From average heart rate"); }
  const ends = (input.exercises ?? []).flatMap((ex) => ex.sets.map((s) => s.endS)).filter((v): v is number => v != null);
  if (ends.length > 1) {
    const starts = (input.exercises ?? []).flatMap((ex) => ex.sets.map((s) => (s.endS != null ? s.endS - (s.seconds ?? 0) : null))).filter((v): v is number => v != null);
    const setScore = ((Math.max(...ends) - Math.min(...starts)) / 60) * 3;
    if (score == null || setScore > score) { score = setScore; basis = t("From your sets"); fromSets = true; }
  }
  if (score == null || !(score > 0)) return null;
  // Other workouts are scored from their average heart rate here, so a score from sets has nothing fair to rank against.
  const ranked = maxHr && !fromSets ? harderThan(score, a, all, maxHr) : null;
  return { score: Math.round(score), harderThanPct: ranked, basis };
}
