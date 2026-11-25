// Two years of sample nights for the Sleep pages, the same generator the design canvas uses. The newest night is the
// Health page's sample night (84, 7h 42m, 22:58 to 06:54), so both pages agree.
import type { SleepData, SleepRecord } from "../sleep";
import type { SleepSegment, SleepStage } from "../health";
import { SAMPLE_TODAY } from "../core";
import { sampleHealth } from "./health";
import { dayKey } from "@/lib/format";
import { addDays, scatter as rnd } from "@/lib/health";

const NIGHTS = 730;
const STAGE: Record<string, SleepStage> = { A: "awake", R: "rem", L: "light", D: "deep" };
const WORKOUTS = ["Easy run", "Tempo run", "Long run", "Intervals 6 × 800 m", "Strength: push day", "Endurance ride", "Strength: legs"];

function segmentsFor(back: number, weekend: boolean): SleepSegment[] {
  const target = 438 + rnd(back, 2) * 96 + (weekend ? 24 : 0) - (back % 17 === 5 ? 95 : 0);
  const raw: [string, number][] = [["L", 10 + (rnd(back, 3) + 0.5) * 12]];
  for (let c = 0; c < 5; c++) {
    const deep = Math.max(0, 36 - c * 9 + rnd(back, 10 + c) * 12);
    if (deep > 4) raw.push(["D", deep]);
    raw.push(["L", 22 + rnd(back, 30 + c) * 10]);
    raw.push(["R", 8 + c * 7 + rnd(back, 20 + c) * 8]);
    if (c < 4 && rnd(back, 50 + c) > 0.1) raw.push(["A", 2 + (rnd(back, 60 + c) + 0.5) * 7]);
    raw.push(["L", 18 + rnd(back, 40 + c) * 10]);
  }
  const asleep = raw.reduce((p, [s, m]) => p + (s === "A" ? 0 : m), 0);
  const f = target / asleep;
  return raw.map(([s, m]) => ({ stage: STAGE[s], minutes: Math.max(2, Math.round(s === "A" ? m : m * f)) }));
}

function stressFor(back: number, segments: SleepSegment[]): number[] {
  const base: Record<SleepStage, number> = { deep: 12, light: 20, rem: 28, awake: 48 };
  const inBed = segments.reduce((p, s) => p + s.minutes, 0);
  const shift = rnd(back, 80) * 16 + (back % 7 === 2 ? 12 : 0) + (back === 0 ? 2 : 0);
  const spikeAt = (rnd(back, 82) + 0.5) * inBed * 0.8 + inBed * 0.1;
  const spike = back === 0 ? 30 : rnd(back, 83) > -0.1 ? 18 + (rnd(back, 84) + 0.5) * 30 : 0;
  const out: number[] = [];
  let at = 0, i = 0;
  for (let x = 0; x < inBed; x += 5) {
    while (i < segments.length - 1 && x >= at + segments[i].minutes) { at += segments[i].minutes; i++; }
    const v = base[segments[i].stage] + shift + rnd(back * 400 + x, 81) * 12 + (x < 45 ? 13 * (1 - x / 45) : 0)
      + spike * Math.max(0, 1 - Math.abs(x - spikeAt) / 22);
    out.push(Math.max(1, Math.min(99, Math.round(v))));
  }
  return out;
}

function night(back: number): SleepRecord {
  const date = addDays(SAMPLE_TODAY, -back);
  const weekend = date.getDay() === 6 || date.getDay() === 0;
  const segments = back === 0 ? sampleHealth.night!.segments : segmentsFor(back, weekend);
  const startMinute = back === 0 ? 22 * 60 + 58 : Math.round(22 * 60 + 40 + (rnd(back, 1) + 0.5) * 58 + (weekend ? 28 : 0));
  const asleep = segments.reduce((p, s) => p + (s.stage === "awake" ? 0 : s.minutes), 0);
  const deep = segments.reduce((p, s) => p + (s.stage === "deep" ? s.minutes : 0), 0);
  const rem = segments.reduce((p, s) => p + (s.stage === "rem" ? s.minutes : 0), 0);
  const wakings = segments.filter((s) => s.stage === "awake" && s.minutes >= 3).length;
  const score = back === 0 ? 84 : Math.round(Math.max(44, Math.min(96,
    54 + ((asleep - 390) / 100) * 22 + (deep / asleep - 0.15) * 90 + (rem / asleep - 0.21) * 70 - wakings * 2 + rnd(back, 70) * 8)));
  const napMinutes = Math.round(22 + (rnd(back, 91) + 0.5) * 26);
  const naps = back % 6 === 3 ? [{ startMinute: Math.round(14 * 60 + 10 + rnd(back, 90) * 50), minutes: napMinutes, points: Math.min(5, Math.round(napMinutes / 9)) }] : [];
  const points = naps.reduce((p, n) => p + (n.points ?? 0), 0);
  const trained = rnd(back + 1, 9) > -0.18;
  return {
    day: dayKey(date),
    score: Math.min(100, score + points), nightScore: score, rating: undefined,
    startMinute, segments,
    heartRateAsleep: back === 0 ? 51 : Math.round(52 + rnd(back, 100) * 5 - (score - 75) / 12),
    hrv: back === 0 ? 62 : Math.round(57 + rnd(back, 101) * 12 + (score - 75) / 6 - Math.min(back, 60) * 0.04),
    restingHR: back === 0 ? 48 : Math.round(48.6 + rnd(back, 102) * 4 + Math.min(back, 60) * 0.02),
    stress: { startOffset: 0, readings: stressFor(back, segments) },
    naps,
    dayBefore: trained ? [WORKOUTS[Math.floor((rnd(back + 1, 11) + 0.5) * WORKOUTS.length) % WORKOUTS.length]] : [],
  };
}

let cached: SleepData | null = null;

export function sampleSleep(): SleepData {
  if (!cached) {
    const nights: SleepRecord[] = [];
    for (let back = NIGHTS - 1; back >= 0; back--) nights.push(night(back));
    cached = { today: dayKey(SAMPLE_TODAY), nights };
  }
  return cached;
}
