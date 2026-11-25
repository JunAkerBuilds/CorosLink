/** Pure maths for the Sleep pages (night, week, month, year), ported from the phone's Sleep page. */
import type { SleepStage } from "@/data/health";
import type { SleepRecord } from "@/data/sleep";
import { dayKey, parseDay } from "./format";
import { addDays, mean, nightTotals, stageSpans } from "./health";

/* ---------- Words and colours ---------- */

export type Quality = "Excellent" | "Good" | "Fair" | "Low";

/** C-LINK's words for score ranges: 85+, 70–84, 55–69, below. */
export function quality(score: number): Quality {
  return score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : "Low";
}

/** Hue token name for a score: violet when good, gold when fair, coral when low. */
export function qualityHue(score: number): "violet" | "gold" | "coral" {
  return score >= 70 ? "violet" : score >= 55 ? "gold" : "coral";
}

/** Commonly cited adult shares of the time asleep (not COROS's figures), in %. */
export const TYPICAL_SHARE: Record<Exclude<SleepStage, "awake">, [number, number]> = {
  deep: [13, 23], light: [45, 60], rem: [20, 25],
};

/* ---------- Clock ---------- */

/** A bedtime as minutes after the evening's midnight before it: 23:10 → 1390, 00:20 → 1460. */
export function eveningMinute(minuteOfDay: number): number {
  return minuteOfDay < 12 * 60 ? minuteOfDay + 1440 : minuteOfDay;
}

/** Minutes as "7h 42m"; under an hour "14m". */
export function hm(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A signed difference in minutes: "+12m", "−1h 5m", "±0m". */
export function signedHm(minutes: number): string {
  const r = Math.round(minutes);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${hm(r)}`;
}

/* ---------- One night ---------- */

export interface NightFacts {
  asleep: number | null;
  inBed: number | null;
  awake: number | null;
  deep: number | null;
  light: number | null;
  rem: number | null;
  /** Fell asleep, minutes after the evening's midnight. */
  bed: number | null;
  /** Woke up, minutes after the evening's midnight. */
  wake: number | null;
  /** Share of the time in bed spent asleep, %. */
  efficiency: number | null;
  /** Awake stretches of 3 minutes or more, as COROS counts them. */
  wakings: number | null;
  longestAwake: number | null;
  /** Minutes napped in the day. */
  napMinutes: number;
}

export function nightFacts(n: SleepRecord): NightFacts {
  const t = nightTotals(n);
  const bed = n.startMinute != null ? eveningMinute(n.startMinute) : null;
  const awakes = n.segments.filter((s) => s.stage === "awake").map((s) => s.minutes);
  return {
    asleep: t.asleep, inBed: t.inBed, awake: t.awake, deep: t.deep, light: t.light, rem: t.rem,
    bed, wake: bed != null && t.inBed != null ? bed + t.inBed : null,
    efficiency: t.asleep != null && t.inBed ? (t.asleep / t.inBed) * 100 : null,
    wakings: n.segments.length ? awakes.filter((m) => m >= 3).length : null,
    longestAwake: awakes.length ? Math.max(...awakes) : n.segments.length ? 0 : null,
    napMinutes: n.naps.reduce((p, x) => p + x.minutes, 0),
  };
}

/** A stage's share of the time asleep, %, or null. */
export function stageShare(f: NightFacts, stage: Exclude<SleepStage, "awake">): number | null {
  const v = f[stage];
  return v != null && f.asleep ? (v / f.asleep) * 100 : null;
}

export type StressBand = 0 | 1 | 2 | 3;
export const STRESS_BANDS = ["Rest", "Low", "Medium", "High"] as const;
/** COROS's bands: rest 0–25, low 26–50, medium 51–75, high 76–100. */
export function stressBand(v: number): StressBand {
  return v <= 25 ? 0 : v <= 50 ? 1 : v <= 75 ? 2 : 3;
}

export interface StressReading { offset: number; value: number; stage: SleepStage | null }

export interface StressStats {
  readings: StressReading[];
  average: number;
  peak: number;
  /** Minutes after falling asleep. */
  peakOffset: number;
  /** Readings while asleep in each band, rest to high. */
  bands: [number, number, number, number];
  /** Share of the readings while asleep in the rest band, %. */
  restful: number;
  byStage: { deep: number | null; light: number | null; rem: number | null };
}

/**
 * The night's stress the way the phone reads it: readings every 5 minutes, 0 means none was taken, awake stretches
 * left out of the average when the night has its stages.
 */
export function stressStats(n: SleepRecord): StressStats | null {
  if (!n.stress) return null;
  const spans = stageSpans(n.segments);
  const stageAt = (m: number): SleepStage | null => {
    for (const s of spans) if (m < s.to) return s.stage;
    return spans.length ? spans[spans.length - 1].stage : null;
  };
  const readings: StressReading[] = n.stress.readings
    .map((value, i) => ({ offset: n.stress!.startOffset + i * 5, value, stage: null as SleepStage | null }))
    .filter((r) => r.value > 0)
    .map((r) => ({ ...r, stage: stageAt(r.offset) }));
  const asleep = readings.filter((r) => r.stage !== "awake");
  if (asleep.length === 0) return null;
  const peak = asleep.reduce((p, r) => (r.value > p.value ? r : p), asleep[0]);
  const bands: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of asleep) bands[stressBand(r.value)]++;
  const avgOf = (stage: SleepStage) => {
    const a = asleep.filter((r) => r.stage === stage).map((r) => r.value);
    return a.length ? Math.round(mean(a)) : null;
  };
  return {
    readings, average: Math.round(mean(asleep.map((r) => r.value))), peak: peak.value, peakOffset: peak.offset, bands,
    restful: Math.round((bands[0] / asleep.length) * 100),
    byStage: { deep: avgOf("deep"), light: avgOf("light"), rem: avgOf("rem") },
  };
}

/** Mean of a value over the `count` nights before `index` (nights oldest first), skipping nights without it. */
export function usual(nights: readonly SleepRecord[], index: number, read: (n: SleepRecord) => number | null, count = 28): number | null {
  const values = nights.slice(Math.max(0, index - count), index).map(read).filter((v): v is number => v != null);
  return values.length ? mean(values) : null;
}

/* ---------- Tonight ---------- */

export interface TonightPlan {
  /** Minutes after the evening's midnight. */
  bed: number;
  wake: number;
  asleep: number;
  catchUp: number;
  /** The wake time is the watch's sleep schedule's, not the usual mornings'. */
  fromSchedule: boolean;
  /** Tomorrow's first planned workout, by name. */
  workout: string | null;
}

/** Sleep below the 7 hours a night adults need (AASM and Sleep Research Society), naps included. */
export const SLEEP_NEED = 7 * 60;

/**
 * When to be in bed tonight, as the phone's Sleep page works it out (SleepTonight.plan): wake at the watch's sleep
 * schedule (else the usual wake time of the last two weeks), 8 hours asleep plus 15 minutes for an hour of this
 * week's sleep debt or 30 for two, the time in bed that takes at the usual sleep efficiency (80–98%, 90% when
 * unknown), and 15 minutes to fall asleep.
 */
export function tonightPlan(
  nights: readonly SleepRecord[],
  options: { scheduleWake?: number | null; workout?: string | null } = {},
): TonightPlan | null {
  const recent = nights.slice(-14).map(nightFacts);
  const wakes = recent.map((f) => f.wake).filter((v): v is number => v != null);
  const scheduled = options.scheduleWake != null;
  if (!scheduled && !wakes.length) return null;
  const wake = scheduled ? eveningMinute(options.scheduleWake!) : Math.round(mean(wakes));
  const debt = recent.slice(-7).reduce((p, f) => p + (f.asleep != null ? Math.max(0, SLEEP_NEED - f.asleep - f.napMinutes) : 0), 0);
  const catchUp = debt >= 120 ? 30 : debt >= 60 ? 15 : 0;
  const asleep = 8 * 60 + catchUp;
  const efficiencies = recent.map((f) => f.efficiency).filter((v): v is number => v != null);
  const efficiency = Math.min(0.98, Math.max(0.8, (efficiencies.length ? mean(efficiencies) : 90) / 100));
  const bed = Math.round(wake - asleep / efficiency - 15);
  return { bed, wake, asleep, catchUp, fromSchedule: scheduled, workout: options.workout ?? null };
}

/* ---------- Periods ---------- */

export type Range = "week" | "month" | "year";

export interface Period {
  range: Range;
  /** Every day in the period, YYYY-MM-DD, first to last. */
  days: string[];
  title: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));

/** The week (Monday first), month or year holding `anchor`, moved by `offset` of them. */
export function period(range: Range, anchor: string, offset: number): Period {
  const a = parseDay(anchor);
  if (range === "week") {
    const monday = addDays(a, -((a.getDay() + 6) % 7) + offset * 7);
    const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i)));
    const s = parseDay(days[0]), e = parseDay(days[6]);
    return { range, days, title: `${s.getDate()}${s.getMonth() !== e.getMonth() ? ` ${MON[s.getMonth()]}` : ""}–${e.getDate()} ${MON[e.getMonth()]}${e.getFullYear() !== a.getFullYear() ? ` ${e.getFullYear()}` : ""}` };
  }
  if (range === "month") {
    const first = new Date(a.getFullYear(), a.getMonth() + offset, 1);
    const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return { range, days: Array.from({ length: len }, (_, i) => dayKey(new Date(first.getFullYear(), first.getMonth(), i + 1))), title: `${MONTHS[first.getMonth()]} ${first.getFullYear()}` };
  }
  const y = a.getFullYear() + offset;
  const days: string[] = [];
  for (let d = new Date(y, 0, 1); d.getFullYear() === y; d = addDays(d, 1)) days.push(dayKey(d));
  return { range, days, title: String(y) };
}

export interface PeriodSummary {
  nights: number;
  score: number | null;
  asleep: number | null;
  bed: number | null;
  wake: number | null;
  /** Standard deviation of bedtimes, minutes. */
  bedSpread: number | null;
  regularity: "Steady" | "Fairly steady" | "Irregular" | null;
  napMinutes: number;
  /** Minutes short of 7 hours, added up. */
  debt: number;
  shortNights: number;
  efficiency: number | null;
  best: SleepRecord | null;
  mix: { deep: number | null; light: number | null; rem: number | null; awake: number | null; inBed: number | null };
}

const avgOf = <T,>(list: readonly T[], read: (x: T) => number | null) => {
  const v = list.map(read).filter((x): x is number => x != null);
  return v.length ? mean(v) : null;
};

export function summarise(nights: readonly SleepRecord[]): PeriodSummary {
  const facts = nights.map(nightFacts);
  const bed = avgOf(facts, (f) => f.bed);
  const beds = facts.map((f) => f.bed).filter((v): v is number => v != null);
  const spread = bed != null && beds.length > 1 ? Math.sqrt(mean(beds.map((b) => (b - bed) ** 2))) : null;
  const scored = nights.filter((n) => n.score != null);
  return {
    nights: nights.length,
    score: avgOf(nights, (n) => n.score),
    asleep: avgOf(facts, (f) => f.asleep),
    bed, wake: avgOf(facts, (f) => f.wake),
    bedSpread: spread,
    regularity: spread == null ? null : spread < 20 ? "Steady" : spread < 40 ? "Fairly steady" : "Irregular",
    napMinutes: facts.reduce((p, f) => p + f.napMinutes, 0),
    debt: facts.reduce((p, f) => p + (f.asleep != null ? Math.max(0, 420 - f.asleep) : 0), 0),
    shortNights: facts.filter((f) => f.asleep != null && f.asleep < 360).length,
    efficiency: avgOf(facts, (f) => f.efficiency),
    best: scored.length ? scored.reduce((p, n) => (n.score! > p.score! ? n : p), scored[0]) : null,
    mix: {
      deep: avgOf(facts, (f) => f.deep), light: avgOf(facts, (f) => f.light), rem: avgOf(facts, (f) => f.rem),
      awake: avgOf(facts, (f) => f.awake), inBed: avgOf(facts, (f) => f.inBed),
    },
  };
}

/** Nights after a day with a workout against nights after a rest day; nights with nothing known are left out. */
export function trainingSplit(nights: readonly SleepRecord[]) {
  const group = (list: SleepRecord[]) => ({
    nights: list.length, score: avgOf(list, (n) => n.score), asleep: avgOf(list, (n) => nightFacts(n).asleep),
  });
  return {
    trained: group(nights.filter((n) => n.dayBefore != null && n.dayBefore.length > 0)),
    rest: group(nights.filter((n) => n.dayBefore != null && n.dayBefore.length === 0)),
  };
}

/** One value per day of a period from the nights, null on a day without a night or without the value. */
export function perDay(days: readonly string[], byDay: ReadonlyMap<string, SleepRecord>, read: (n: SleepRecord) => number | null): (number | null)[] {
  return days.map((d) => {
    const n = byDay.get(d);
    return n ? read(n) : null;
  });
}

export function monthName(m: number, short = false): string {
  return short ? MON[m] : MONTHS[m];
}

/* ---------- Asking Coach ---------- */

export interface CoachQuestion {
  /** Short words on the chip. */
  label: string;
  /** The whole question Coach receives, naming the night so it reads the right one. */
  ask: string;
}

/**
 * Up to three questions about a night, picked from what stands out in it: short deep sleep, a stress peak, a short
 * or long night against the usual, many wakings. Always ends with the plain question about the night.
 */
export function coachQuestions(n: SleepRecord, usualAsleep: number | null, nightName: string): CoachQuestion[] {
  const f = nightFacts(n), stress = stressStats(n), out: CoachQuestion[] = [];
  const about = (q: string) => `About my sleep on the night to ${nightName}: ${q}`;
  const deep = stageShare(f, "deep");
  if (deep != null && deep < TYPICAL_SHARE.deep[0]) out.push({ label: "Why was deep sleep short?", ask: about("why was my deep sleep short, and what can I change?") });
  if (stress && stress.peak >= 50 && f.bed != null) {
    const at = clockLabel(f.bed + stress.peakOffset);
    out.push({ label: `What raised stress at ${at}?`, ask: about(`what could have raised my stress to ${stress.peak} at ${at}?`) });
  }
  if (f.asleep != null && usualAsleep != null && f.asleep < usualAsleep - 30) out.push({ label: "How do I catch up tonight?", ask: about("I slept less than usual. How should I catch up tonight?") });
  else if (f.wakings != null && f.wakings >= 4) out.push({ label: `Why did I wake ${f.wakings} times?`, ask: about(`why did I wake ${f.wakings} times?`) });
  else if (n.score != null && n.score >= 80) out.push({ label: "What went right?", ask: about("what went right, so I can repeat it?") });
  out.splice(2);
  out.push({ label: "How was this night?", ask: about("how was it, and does it change today's training?") });
  return out;
}

function clockLabel(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
