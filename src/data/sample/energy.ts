import type { EnergyBand, EnergyData, EnergyDay, EnergyEvent, EnergyPoint } from "../energy";
import { SAMPLE_TODAY } from "../core";
import { dayKey } from "@/lib/format";
import { addDays, clockOfDay, scatter } from "@/lib/health";
import { msg } from "@/lib/i18n";

const MONTH = 30;
const BEDTIME = 22 * 60 + 45;
/** Energy gained between bedtime and midnight. */
const EVENING_CHARGE = 2;

/** The current day, exactly as on the canvas: charging overnight, the morning run, two rests, a stressful late morning. */
const today: EnergyDay = {
  date: dayKey(SAMPLE_TODAY),
  points: ([
    [0, 40], [60, 47], [120, 54], [180, 61], [240, 68], [300, 74], [360, 79], [414, 81], [462, 79], [500, 57], [570, 56],
    [660, 67], [690, 66], [735, 62], [760, 61], [820, 66], [850, 64],
  ] as const).map(([minute, level]) => ({ minute, level })),
  bands: [
    { kind: "sleep", from: 0, to: 414, label: msg("Sleep") },
    { kind: "workout", from: 462, to: 500, label: "Morning tempo" },
    { kind: "rest", from: 570, to: 660, label: msg("Rest") },
    { kind: "stress", from: 690, to: 735, label: msg("Stress") },
    { kind: "rest", from: 760, to: 820, label: msg("Rest") },
    { kind: "sleep", from: BEDTIME, to: 1440, label: msg("Sleep") },
  ],
  events: [
    { kind: "sleep", name: msg("Sleep"), detail: "22:58 – 06:54 · Score 84", delta: 52, when: "22:58 – 06:54" },
    { kind: "workout", name: "Morning tempo", detail: "07:42 – 08:20 · 8.02 km", delta: -22 },
    { kind: "rest", name: msg("Rest"), detail: "09:30 – 11:00", delta: 11 },
    { kind: "stress", name: msg("Stress"), detail: "11:30 – 12:15", delta: -4 },
    { kind: "rest", name: msg("Rest"), detail: "12:40 – 13:40", delta: 5 },
    { kind: "awake", name: msg("Awake"), detail: msg("The rest of the day so far"), delta: -7, when: msg("so far") },
  ],
  woke: { minute: 414, level: 81 },
  low: 56,
  high: 81,
  now: { minute: 850, level: 64 },
  bedtime: { minute: BEDTIME, level: 38 },
  pace: { label: msg("Using slowly"), direction: "down" },
  note: msg("On this pace you reach bedtime at about 38. Enough left for an easy evening."),
  headline: msg("Enough left for an easy evening."),
  sleep: { minutes: 462, score: 84 },
};

/** [lowest, highest, on waking] for the six days before today, from the canvas's week chart. */
const WEEK: [number, number, number][] = [[34, 78, 74], [30, 84, 80], [22, 70, 62], [41, 90, 88], [36, 82, 77], [38, 85, 83]];

interface Stretch { kind: "rest" | "workout" | "stress"; name: string; from: number; to: number; change: number }

/** A finished day that wakes at `waking`, peaks at `high` and bottoms out at `low` before bed. */
function pastDay(date: Date, seed: number, low: number, high: number, waking: number, startLevel: number): EnergyDay {
  const wake = 390 + Math.round((scatter(seed, 31) + 0.5) * 50);
  const span = high - low;
  const evening = seed % 2 === 0;
  const long = date.getDay() === 6;
  const workoutFrom = evening ? 1050 + Math.round(scatter(seed, 32) * 40) : 720 + Math.round(scatter(seed, 32) * 40);
  const workoutLength = long ? 110 : 45 + Math.round((scatter(seed, 33) + 0.5) * 25);
  const stressFrom = evening ? 660 : 900;

  const stretches: Stretch[] = [];
  if (high > waking) stretches.push({ kind: "rest", name: msg("Rest"), from: wake + 30, to: wake + 90, change: high - waking });
  const workoutDrop = Math.round(span * (long ? 0.62 : 0.5));
  const stressDrop = Math.max(1, Math.round(span * 0.08));
  stretches.push({ kind: "workout", name: long ? "Long run" : evening ? "Evening run" : "Lunch run", from: workoutFrom, to: workoutFrom + workoutLength, change: -workoutDrop });
  stretches.push({ kind: "stress", name: msg("Stress"), from: stressFrom, to: stressFrom + 40, change: -stressDrop });
  stretches.sort((a, b) => a.from - b.from);

  // Time awake between the stretches uses what is left of the day's fall, shared out by how long each gap is.
  const awakeDrop = span - workoutDrop - stressDrop;
  const gaps: [number, number][] = [];
  let at = wake;
  for (const s of stretches) { gaps.push([at, s.from]); at = s.to; }
  gaps.push([at, BEDTIME]);
  const peakAt = high > waking ? wake + 90 : wake;
  const gapMinutes = gaps.reduce((sum, [a, b]) => sum + Math.max(0, b - Math.max(a, peakAt)), 0);

  const points: EnergyPoint[] = [{ minute: 0, level: startLevel }, { minute: wake, level: waking }];
  const bands: EnergyBand[] = [{ kind: "sleep", from: 0, to: wake, label: msg("Sleep") }];
  const events: EnergyEvent[] = [{
    kind: "sleep", name: msg("Sleep"), detail: `${clockOfDay(BEDTIME)} – ${clockOfDay(wake)}`, delta: waking - (startLevel - EVENING_CHARGE),
  }];
  let exact = waking, awakeUsed = 0;
  const push = (minute: number) => {
    const level = Math.round(exact);
    const prev = points[points.length - 1];
    points.push({ minute, level });
    return level - prev.level;
  };
  gaps.forEach(([a, b], k) => {
    const minutes = Math.max(0, b - Math.max(a, peakAt));
    if (minutes > 0 && gapMinutes > 0) {
      exact -= (awakeDrop * minutes) / gapMinutes;
      if (k === gaps.length - 1) exact = low;
      awakeUsed -= push(b);
    }
    const s = stretches[k];
    if (!s) return;
    exact += s.change;
    const delta = push(s.to);
    bands.push({ kind: s.kind, from: s.from, to: s.to, label: s.name });
    events.push({ kind: s.kind, name: s.name, detail: `${clockOfDay(s.from)} – ${clockOfDay(s.to)}`, delta });
  });
  events.push({ kind: "awake", name: msg("Awake"), detail: msg("The rest of the day"), delta: -awakeUsed });
  points.push({ minute: 1440, level: low + EVENING_CHARGE });
  bands.push({ kind: "sleep", from: BEDTIME, to: 1440, label: msg("Sleep") });

  return { date: dayKey(date), points, bands, events, woke: { minute: wake, level: waking }, low, high };
}

function buildDays(): EnergyDay[] {
  const days: EnergyDay[] = [];
  let startLevel: number | null = null;
  for (let k = 0; k < MONTH - 1; k++) {
    const back = MONTH - 1 - k; // days before today
    let low: number, high: number, waking: number;
    if (back <= WEEK.length) {
      [low, high, waking] = WEEK[WEEK.length - back];
    } else {
      waking = Math.round(74 + scatter(k, 41) * 24);
      high = waking + Math.round((scatter(k, 42) + 0.5) * 8);
      low = Math.max(12, Math.round(high - 38 - (scatter(k, 43) + 0.5) * 20));
    }
    const from: number = startLevel ?? Math.max(5, waking - 41);
    days.push(pastDay(addDays(SAMPLE_TODAY, -back), k, low, high, waking, Math.min(from, waking)));
    startLevel = low + EVENING_CHARGE;
  }
  days.push(today);
  return days;
}

export const sampleEnergy: EnergyData = { days: buildDays() };
