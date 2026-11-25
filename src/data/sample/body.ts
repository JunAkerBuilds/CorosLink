import type { BodyData, Measurement } from "@/data/body";
import { dayKey } from "@/lib/format";

/** The canvas's repeatable noise, −0.5…0.5, so the sample lines look the same on every load. */
const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v) - 0.5;
};

/** Fourteen readings drifting from `from` to `to`, as the canvas draws its small trend lines. */
function drift(k: number, from: number, to: number, wobble: number, decimals: number): number[] {
  const N = 14, scale = 10 ** decimals;
  const out = Array.from({ length: N }, (_, i) => Math.round((from + ((to - from) * i) / (N - 1) + rnd(i, k) * wobble) * scale) / scale);
  out[N - 1] = to;
  return out;
}

const tenth = (v: number) => Math.round(v * 10) / 10;
const END = new Date(2026, 10, 19);
const dayBefore = (n: number) => dayKey(new Date(END.getFullYear(), END.getMonth(), END.getDate() - n));

/**
 * Weigh-ins: every day for the 90 days to Nov 19 (73.7 → 72.4 kg, body fat 15.7 → 14.8% once a week),
 * and once a week for the year and a half before.
 */
function measurements(): Measurement[] {
  const out: Measurement[] = [];
  const WEEKS = 84;
  for (let w = WEEKS; w >= 1; w--) {
    const t = w / WEEKS;
    out.push({
      day: dayBefore(89 + w * 7),
      weightKg: tenth(73.8 + 2.3 * t + Math.sin(t * 9) * 0.5 + rnd(w, 21) * 0.4),
      bodyFatPct: tenth(15.8 + 1.9 * t + rnd(w, 22) * 0.4),
    });
  }
  const W = 90;
  for (let i = 0; i < W; i++) {
    const last = i === W - 1, first = i === 0;
    const m: Measurement = {
      day: dayBefore(W - 1 - i),
      weightKg: last ? 72.4 : first ? 73.7 : tenth(73.7 - (1.3 * i) / (W - 1) + rnd(i, 9) * 0.22),
    };
    if (last) m.bodyFatPct = 14.8;
    else if (first) m.bodyFatPct = 15.7;
    else if (i % 7 === 0) m.bodyFatPct = tenth(15.7 - (0.9 * i) / (W - 1) + rnd(i, 16) * 0.3);
    out.push(m);
  }
  return out;
}

export const BODY_SAMPLE: BodyData = {
  sampleDay: dayKey(END),
  profile: { heightCm: 178, age: 39, goal: "lose", goalWeightKg: 71, restingKcal: 1720 },
  bodyAge: { value: 36.4, asOf: "2026-11-16", nextUpdate: "Monday" },
  headline: "All in your usual range",
  advice: "Nothing to change. Train as planned.",
  signals: [
    { name: "Resting heart rate", detail: "48 bpm · Usual 49", pill: "Usual", hue: "rose", values: drift(1, 49.5, 48, 1.6, 0) },
    { name: "HRV", detail: "62 ms · Usual 58", pill: "+4 ms", hue: "cyan", values: drift(2, 57, 62, 5, 0) },
    { name: "Breathing", detail: "14.2 a minute · Usual 14.4", pill: "Usual", hue: "sky", values: drift(3, 14.5, 14.2, 0.5, 1) },
  ],
  stats: [
    { name: "Resting HR", value: "48", unit: "bpm", note: "−1 in 30 days", hue: "rose", values: drift(11, 49.5, 48, 1.4, 0) },
    { name: "HRV", value: "62", unit: "ms", note: "+4 in 30 days", hue: "cyan", values: drift(12, 57, 62, 5, 0) },
    { name: "Breathing", value: "14.2", unit: "a minute", note: "Steady", hue: "sky", values: drift(13, 14.4, 14.2, 0.5, 1) },
    { name: "VO2max", value: "54", unit: "ml/kg/min", note: "Top 12%", hue: "blue", values: drift(14, 52.4, 54, 0.6, 1) },
  ],
  measurements: measurements(),
};
