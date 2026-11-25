import type { HealthData, SleepSegment, SleepStage, TrendSeries } from "../health";
import { SAMPLE_TODAY } from "../core";
import { dayKey } from "@/lib/format";
import { scatter } from "@/lib/health";

/** A year of readings. The last 30 are exactly the canvas's series; older days carry the same scatter around a flatter trend. */
const DAYS = 365;
const SHOWN = 30;

function series(fn: (i: number, back: number) => number, last: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < DAYS; k++) {
    const i = k - (DAYS - SHOWN); // 0…29 for the canvas's 30 days, negative before them
    out.push(fn(i, Math.min(0, i)));
  }
  out[DAYS - 1] = last;
  return out;
}

/** Slow drift for the days before the canvas's month: fitness builds over the year, with a seasonal wave. */
const drift = (back: number) => Math.max(back, -240) / 240 + Math.sin(back / 58) * 0.35;

const trends: TrendSeries[] = [
  { id: "hrv", name: "HRV", hue: "cyan", unit: " ms", format: "int",
    values: series((i, back) => 56 + Math.max(i, 0) * 0.12 + drift(back) * 6 + scatter(i, 1) * 9, 62) },
  { id: "rhr", name: "Resting heart rate", hue: "rose", unit: " bpm", format: "int",
    values: series((i, back) => 50.3 - Math.max(i, 0) * 0.06 - drift(back) * 2.2 + scatter(i, 2) * 2.4, 48) },
  { id: "sleep", name: "Sleep", hue: "violet", unit: "", format: "hours",
    values: series((i, back) => 7.25 + Math.sin(back / 41) * 0.2 + scatter(i, 3) * 1.6, 7.7) },
  { id: "stress", name: "Stress", hue: "coral", unit: "", format: "int",
    values: series((i, back) => 33 - drift(back) * 3 + scatter(i, 4) * 16, 28) },
  { id: "steps", name: "Steps", hue: "orange", unit: "", format: "thousands",
    values: series((i, back) => 9400 + drift(back) * 900 + scatter(i, 5) * 5200, 8412) },
  { id: "energy", name: "Energy on waking", hue: "mint", unit: "", format: "int",
    values: series((i, back) => 72 + drift(back) * 4 + scatter(i, 6) * 24, 81) },
];

const STAGE: Record<string, SleepStage> = { A: "awake", R: "rem", L: "light", D: "deep" };
const segments: SleepSegment[] = ([
  ["L", 20], ["D", 30], ["L", 25], ["R", 18], ["L", 30], ["D", 28], ["L", 22], ["A", 6], ["L", 28], ["R", 24], ["L", 35],
  ["D", 18], ["L", 30], ["R", 30], ["A", 4], ["L", 26], ["D", 12], ["L", 22], ["R", 34], ["A", 4], ["L", 30],
] as const).map(([s, minutes]) => ({ stage: STAGE[s], minutes }));

export const sampleHealth: HealthData = {
  lastDay: dayKey(SAMPLE_TODAY),
  energyNow: 64,
  night: { score: 84, rating: "Good", startMinute: 22 * 60 + 58, segments, heartRateAsleep: 51 },
  morning: [
    { name: "HRV", today: "62 ms", week: "58", position: 84, hue: "cyan" },
    { name: "Resting heart rate", today: "48 bpm", week: "49", position: 18, hue: "rose" },
    { name: "Sleep", today: "7:42", week: "7:17", position: 76, hue: "violet" },
    { name: "Stress overnight", today: "28", week: "33", position: 24, hue: "coral" },
    { name: "Breathing rate", today: "14.2 /min", week: "14.4", position: 42, hue: "sky" },
    { name: "Blood oxygen", today: "96%", week: "96", position: 60, hue: "sky" },
  ],
  trends,
};
