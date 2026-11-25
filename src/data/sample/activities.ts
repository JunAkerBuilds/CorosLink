/** The sample athlete's activities, copied from the C-LINK redesign canvas (Activities and Activity screens). */
import type { Activity, ActivityDetail, ActivityExtras, Lap, RoutePoint, Sport, Stroke, StrengthExercise, SwimLength, Thresholds } from "@/data/activities";
import { generateDetail, mergeLaps, routeFromCubics, zonesFromBounds } from "@/lib/activities";
import { hrZonesFromThreshold, maxHrFor, relativeEffort, weekShare } from "@/lib/activityDetail";

type Row = [id: string, start: string, name: string, sport: Sport, distanceM: number | null, durationS: number, avgHr: number, maxHr: number, elevationGainM: number | null, cadence: number | null, load: number];

const ROWS: Row[] = [
  ["2026-11-19-morning-tempo", "2026-11-19T07:42", "Morning tempo", "Run", 8020, 2294.52, 158, 172, 64, 174, 96],
  ["2026-11-18-easy-run", "2026-11-18T18:10", "Easy run", "Run", 6100, 2028.03, 138, 151, 31, 168, 54],
  ["2026-11-17-strength-upper-body", "2026-11-17T12:30", "Strength, upper body", "Strength", null, 2890.02, 112, 141, null, null, 41],
  ["2026-11-16-recovery-ride", "2026-11-16T17:05", "Recovery ride", "Ride", 24600, 3482.04, 121, 139, 140, 84, 62],
  ["2026-11-15-long-run", "2026-11-15T08:15", "Long run", "Run", 18040, 5780.01, 149, 165, 212, 170, 120],
  ["2026-11-14-pool-swim", "2026-11-14T10:00", "Pool swim", "Swim", 1500, 1875.05, 128, 149, null, null, 38],
  ["2026-11-13-easy-run", "2026-11-13T07:20", "Easy run", "Run", 5020, 1686.02, 136, 148, 22, 167, 44],
  ["2026-11-12-intervals-6x800", "2026-11-12T18:30", "Intervals, 6 × 800 m", "Run", 9400, 2791.03, 161, 181, 38, 176, 108],
  ["2026-11-11-strength-lower-body", "2026-11-11T12:15", "Strength, lower body", "Strength", null, 2692.04, 118, 146, null, null, 46],
  ["2026-11-10-hill-ride", "2026-11-10T16:40", "Hill ride", "Ride", 38200, 5564.02, 142, 168, 612, 81, 98],
  ["2026-11-08-long-run", "2026-11-08T08:05", "Long run", "Run", 16020, 5170.06, 147, 163, 180, 170, 110],
  ["2026-11-07-strength-lower-body", "2026-11-07T11:00", "Strength, lower body", "Strength", null, 2780.03, 115, 143, null, null, 44],
  ["2026-11-05-tempo-run", "2026-11-05T07:35", "Tempo run", "Run", 8000, 2320.01, 157, 171, 58, 173, 94],
  ["2026-11-04-easy-run", "2026-11-04T18:20", "Easy run", "Run", 6040, 2010.04, 137, 150, 29, 168, 52],
  ["2026-11-03-strength-upper-body", "2026-11-03T12:40", "Strength, upper body", "Strength", null, 2825.02, 113, 140, null, null, 40],
  ["2026-11-01-long-run", "2026-11-01T08:10", "Long run", "Run", 15020, 4890.04, 147, 162, 160, 170, 104],
  ["2026-10-31-strength-lower-body", "2026-10-31T11:10", "Strength, lower body", "Strength", null, 2740.05, 116, 144, null, null, 43],
  ["2026-10-29-intervals-5x1k", "2026-10-29T18:25", "Intervals, 5 × 1 km", "Run", 9100, 2702.03, 160, 180, 35, 176, 104],
  ["2026-10-28-easy-run", "2026-10-28T18:15", "Easy run", "Run", 6000, 2020.02, 136, 149, 28, 167, 50],
  ["2026-10-27-recovery-ride", "2026-10-27T17:00", "Recovery ride", "Ride", 22400, 3250.06, 119, 137, 120, 83, 56],
  ["2026-10-25-long-run", "2026-10-25T08:20", "Long run", "Run", 14020, 4600.01, 146, 161, 150, 169, 98],
  ["2026-10-24-pool-swim", "2026-10-24T10:05", "Pool swim", "Swim", 1400, 1780.04, 126, 147, null, null, 36],
  ["2026-10-22-tempo-run", "2026-10-22T07:30", "Tempo run", "Run", 7020, 2060.03, 156, 170, 50, 173, 84],
];

export const SAMPLE_ACTIVITIES: Activity[] = ROWS.map(([id, start, name, sport, distanceM, durationS, avgHr, maxHr, elevationGainM, cadence, load]) => ({
  id, start, name, sport, distanceM, durationS, avgHr, maxHr, elevationGainM, cadence, load,
}));

/** The sample athlete's own marks: threshold heart rate and pace, highest heart rate, cycling FTP. */
export const SAMPLE_THRESHOLDS: Thresholds = { hr: 168, maxHr: 186, paceSPerKm: 275, ftp: 245, weightKg: 79 };

/** The lowest heart rate of zones 2 to 5 for the sample athlete, cut from the threshold. */
export const SAMPLE_ZONE_BOUNDS = hrZonesFromThreshold(SAMPLE_THRESHOLDS.hr as number).slice(1).map((z) => z.fromBpm as number);

const zonesWith = (seconds: readonly number[]) => zonesFromBounds(SAMPLE_ZONE_BOUNDS).map((z, i) => ({ ...z, seconds: seconds[i] ?? 0 }));

/** A value that eases towards each kilometre's level, with a small wobble, as the canvas draws its lines. */
function eased(per: readonly number[], n: number, perStep: number, ease: number, amp: number, start?: number): number[] {
  const out: number[] = [];
  let v = start ?? per[0];
  for (let i = 0; i < n; i++) {
    const s = Math.min(per.length - 1, Math.floor(i / perStep));
    v += (per[s] - v) * ease;
    out.push(v + amp * Math.sin(i * 0.9) + amp * 0.6 * Math.sin(i * 0.37 + 1));
  }
  return out;
}

/** Morning tempo, exactly as the canvas draws it. */
function morningTempo(activity: Activity): ActivityDetail {
  const N = 81;
  // km, seconds, avg HR, max HR, cadence, stride m, ground contact ms, vertical oscillation cm, power W, ascent, descent
  const lapRows: number[][] = [
    [1.0, 308.31, 138, 147, 168, 1.16, 252, 9.4, 248, 9, 4],
    [1.0, 302.77, 146, 152, 170, 1.17, 249, 9.3, 255, 12, 8],
    [1.0, 273.12, 162, 167, 176, 1.25, 232, 8.9, 298, 4, 6],
    [1.0, 274.9, 167, 170, 176, 1.24, 233, 8.9, 300, 11, 5],
    [1.0, 275.48, 169, 171, 177, 1.23, 233, 8.8, 299, 8, 7],
    [1.0, 272.06, 171, 172, 178, 1.24, 231, 8.8, 303, 6, 9],
    [1.0, 292.11, 160, 170, 172, 1.19, 243, 9.1, 272, 10, 8],
    [1.0, 290.24, 154, 159, 171, 1.21, 244, 9.2, 268, 4, 13],
    [0.02, 5.53, 153, 154, 172, 1.21, 242, 9.1, 270, 0, 0],
  ];
  const laps: Lap[] = lapRows.map(([km, seconds, hr, max, cadence, stride, gct, vo, power, ascent, descent], k) => ({
    n: k + 1, distanceM: Math.round(km * 1000), durationS: seconds, avgHr: hr, maxHr: max, cadence, elevationM: ascent,
    strideM: stride, groundContactMs: gct, verticalOscCm: vo, powerW: power, ascentM: ascent, descentM: descent,
  }));
  const col = (k: number) => lapRows.slice(0, 8).map((r) => r[k]);

  const x = Array.from({ length: N }, (_, i) => i * 100);
  const elevation = x.map((_, i) => 22 + 12 * Math.sin(i * 0.12) + 5 * Math.sin(i * 0.31));
  const steps = mergeLaps(laps, [2, 4, 3]);
  ["Warm up", "Tempo", "Cool down"].forEach((name, k) => { steps[k].name = name; });

  return {
    activity,
    laps,
    // Warm-up 2 km, tempo 4 km, cool-down to the end.
    steps,
    streams: {
      axis: "distance", x, elevation,
      pace: eased(col(1), N, 10, 0.7, 1.6), hr: eased(col(2).map((v) => v + 2), N, 10, 0.25, 1.2, 118),
      cadence: eased(col(4), N, 10, 0.6, 1.1), power: eased(col(8), N, 10, 0.6, 5),
      groundContact: eased(col(6), N, 10, 0.6, 2.4), verticalOsc: eased(col(7), N, 10, 0.6, 0.09), stride: eased(col(5), N, 10, 0.6, 0.012),
    },
    scales: { pace: [262, 318], hr: [110, 180], elevation: [0, 45] },
    route: routeFromCubics(
      [120, 330],
      [
        [170, 240, 240, 295, 300, 230],
        [360, 165, 410, 150, 480, 125],
        [550, 100, 620, 112, 655, 170],
        [682, 218, 640, 270, 580, 258],
        [518, 246, 462, 200, 406, 226],
        [350, 252, 310, 330, 240, 352],
        [190, 366, 148, 356, 120, 330],
      ],
      [2000, null, 4000, null, 6000, null, 8020],
    ),
    zones: zonesWith([65, 550, 320, 865, 494.52]),
    labels: {
      route: "Route: a loop that follows the river out and returns through the park",
      pace: "Pace: about 5:05 per km for two kilometres, 4:34 for four, then about 4:51",
      hr: "Heart rate climbing to about 171 in the tempo block, then easing to 154",
      elevation: "Elevation rolling between 8 and 38 metres",
    },
    extras: {
      device: "PACE Pro", elapsedS: 2341.52, watchTempC: [17, 24],
      summary: "A controlled tempo. You held the four middle kilometres within 3.42 s of each other at 4:34, right on threshold pace, and your heart rate rose only 9 bpm across them. The second half was 0.4% faster than the first for the same effort. Keep tomorrow easy.",
      weather: { tempC: 9, feelsC: 7, humidityPct: 81, dewPointC: 6, windKmh: 11, windFrom: "NW", gustKmh: 19, finishTempC: 10, sky: "Clear", note: "Cool and dry enough that heat cost you nothing on pace." },
      journal: { felt: 4, tags: ["One gel at 5 km", "Fuel sat well"], note: "Legs came round after the second kilometre. Held back on the last rep." },
      gear: { name: "Tempo shoes, blue pair", note: "412.60 km · learned from your workouts" },
      records: [
        { what: "1 km", rank: "Best this year", value: "4:28.90", pace: "4:29 /km", best: true },
        { what: "1 mile", rank: "3rd best", value: "7:17.44", pace: "4:32 /km" },
        { what: "2 mile", rank: "2nd best", value: "14:39.20", pace: "4:33 /km" },
        { what: "5 km", rank: "4th best", value: "23:11.80", pace: "4:38 /km" },
      ],
      relativeEffort: { score: 74, harderThanPct: 82, basis: "From average heart rate" },
    },
  };
}

/** A closed loop in the 760 × 420 route box, with distance spread evenly along its points. */
function loop(n: number, totalM: number, at: (t: number) => [number, number], turn: number, from: number): RoutePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const [px, py] = at((i / (n - 1)) * Math.PI * 2 * turn + from);
    return { x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10, d: (i / (n - 1)) * totalM };
  });
}

/** Hill ride: three hills along 38.2 km, with speed, power, cadence and heart rate all following the slope. */
function hillRide(activity: Activity): ActivityDetail {
  const N = 192, total = activity.distanceM ?? 38200, km = total / 1000;
  const hills = [[9.4, 186, 2.3], [20.6, 203, 2.7], [30.8, 154, 2.0]];
  const elevAt = (d: number) => hills.reduce((e, [at, high, wide]) => e + high * Math.exp(-(((d - at) / wide) ** 2)), 38);
  const x: number[] = [], elevation: number[] = [], pace: number[] = [], power: number[] = [], cadence: number[] = [], hr: number[] = [];
  let h = 118;
  for (let i = 0; i < N; i++) {
    const d = (i / (N - 1)) * km, grade = (elevAt(d + 0.2) - elevAt(d - 0.2)) / 4;
    const wob = Math.sin(i * 0.45) + 0.6 * Math.sin(i * 0.185 + 1);
    x.push((i / (N - 1)) * total);
    elevation.push(elevAt(d));
    pace.push(Math.max(9.5, Math.min(58.4, 27.5 - grade * 2.6 + wob * 1.2)));
    power.push(Math.max(0, Math.min(300, 172 + grade * 11 + wob * 9)));
    cadence.push(Math.max(58, Math.min(104, 86 - grade * 2.1 + wob * 1.5)));
    h += (112 + power[i] * 0.2 - h) * 0.16;
    hr.push(h + wob);
  }
  return {
    activity, laps: [], steps: null,
    streams: { axis: "distance", x, pace, hr, elevation, cadence, power },
    scales: { pace: [5, 60], hr: [105, 180], elevation: [20, 260] },
    route: loop(N, total, (t) => [385 + 270 * Math.cos(t) + 52 * Math.cos(3 * t + 0.6), 212 + 130 * Math.sin(t) + 34 * Math.sin(2 * t)], 0.99, 2.2),
    zones: zonesWith([1502.02, 2114, 834, 946, 168]),
    labels: { route: "Route: a loop over three hills", elevation: "Elevation: three climbs of about 150 to 200 metres" },
    extras: {
      device: "PACE Pro", elapsedS: 5900.02, watchTempC: [14, 19],
      summary: "A steady hill session. You rode all three climbs within 13 W of each other, the last one the strongest, and spent 16% of the ride at threshold.",
      weather: { tempC: 12, feelsC: 10, humidityPct: 68, dewPointC: 6, windKmh: 14, windFrom: "W", gustKmh: 26, finishTempC: 11, sky: "Partly cloudy" },
      journal: { felt: 4, note: "Good legs on the second climb. Cold on the last descent." },
      gear: { name: "Road bike", note: "1,284.30 km · learned from your workouts" },
      records: [
        { what: "20 min power", rank: "Best this year", value: "226 W", best: true },
        { what: "5 min power", rank: "3rd best", value: "268 W" },
        { what: "Longest climb", rank: "2nd best", value: "201 m" },
      ],
      relativeEffort: { score: 132, harderThanPct: 71, basis: "" },
    },
  };
}

/** Pool swim: 60 lengths of a 25 m pool in four sets, as the canvas lists them. */
function poolSwim(activity: Activity): ActivityDetail {
  const rnd = (i: number, k: number) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v) - 0.5; };
  const lengths: SwimLength[] = [];
  const add = (n: number, stroke: Stroke, base: number, strokes: number, spread: number) => {
    for (let i = 0; i < n; i++) lengths.push({ stroke, seconds: base + rnd(lengths.length, 1) * spread, strokes: strokes + Math.round(rnd(lengths.length, 2) * 1.6), restAfterS: 0 });
  };
  add(12, "Freestyle", 29.5, 13, 1.2);
  add(32, "Freestyle", 27.25, 13, 1.4);
  add(8, "Breaststroke", 31, 11, 1.2);
  add(4, "Backstroke", 27, 15, 1.0);
  add(4, "Freestyle", 24.5, 14, 0.9);
  // Each block's total is exact, so the page adds up to 28:00 of swimming.
  const fix = (from: number, to: number, total: number) => {
    const k = total / lengths.slice(from, to).reduce((s, l) => s + l.seconds, 0);
    for (let j = from; j < to; j++) lengths[j].seconds *= k;
  };
  fix(0, 12, 354); fix(12, 44, 872); fix(44, 52, 248); fix(52, 56, 108); fix(56, 60, 98);
  lengths[58].seconds = 23.8;
  lengths[59].seconds = 98 - lengths[56].seconds - lengths[57].seconds - 23.8;
  lengths.forEach((l) => { l.seconds = Math.round(l.seconds * 100) / 100; });
  // Rounding to the hundredth leaves a hundredth or two over; the first length takes it.
  lengths[0].seconds = Math.round((lengths[0].seconds + 1680 - lengths.reduce((t, l) => t + l.seconds, 0)) * 100) / 100;
  // 3:15 at the wall: after the warm-up, between the hundreds and the fifties, and before the cool-down.
  const rests: Record<number, number> = { 12: 30, 44: 12, 46: 12, 48: 12, 50: 12, 52: 12 };
  for (let n = 16; n <= 40; n += 4) rests[n] = 15;
  Object.entries(rests).forEach(([after, s]) => { lengths[Number(after) - 1].restAfterS = s; });

  const N = 126, minutes = activity.durationS / 60;
  const x: number[] = [], hr: number[] = [];
  let h = 96;
  for (let k = 0; k < N; k++) {
    const min = (k / (N - 1)) * minutes;
    const target = min < 6.6 ? 122 : min < 24.5 ? 136 + 8 * Math.sin((min - 6.6) * 2.9) : min < 28.5 ? 128 : 118;
    h += (target - h) * 0.28;
    x.push((k / (N - 1)) * activity.durationS);
    hr.push(h + rnd(k, 5) * 3);
  }
  return {
    activity, laps: [], steps: null,
    streams: { axis: "time", x, pace: null, hr, elevation: null, cadence: null },
    scales: { pace: null, hr: [90, 160], elevation: null },
    route: null,
    zones: zonesWith([1210.05, 560, 105, 0, 0]),
    labels: { hr: "Heart rate over time: rising through the main set, dropping in each rest, lower in the cool-down" },
    extras: {
      device: "PACE Pro",
      summary: "A clean aerobic swim. Your eight hundreds came in between 1:47 and 1:51, with the stroke count holding at 13 a length to the end.",
      journal: { felt: 4, note: "Shoulders loose after Thursday's intervals. Breaststroke kick still feels slow." },
      records: [
        { what: "100 m", rank: "Best this year", value: "1:47.20", best: true },
        { what: "400 m", rank: "2nd best", value: "7:18.60" },
        { what: "Lowest SWOLF", rank: "3rd best", value: "37.9" },
      ],
      relativeEffort: { score: 31, harderThanPct: null, basis: "" },
      swim: { poolM: 25, lengths },
    },
  };
}

/** Strength, upper body: six lifts of three sets, timed as the canvas draws them. */
function strengthUpper(activity: Activity): ActivityDetail {
  // name, [kg, reps, seconds under load]…; pull-ups carry added weight
  const plan: [string, [number, number, number][], boolean?][] = [
    ["Bench press", [[72.5, 6, 44], [77.5, 5, 42], [72.5, 6, 44]]],
    ["Barbell row", [[70, 8, 44], [70, 8, 44], [70, 8, 46]]],
    ["Overhead press", [[47.5, 6, 38], [50, 5, 34], [47.5, 6, 36]]],
    ["Pull-up", [[10, 6, 34], [10, 6, 34], [10, 5, 30]], true],
    ["Incline dumbbell press", [[40, 10, 44], [40, 10, 44], [40, 9, 40]]],
    ["Lateral raise", [[17.5, 7, 30], [17.5, 6, 28], [17.5, 6, 28]]],
  ];
  const rests = [120, 120, 150, 100, 100, 140, 110, 110, 130, 100, 100, 120, 90, 90, 110, 90, 90, 0];
  let t = 336, k = 0;
  const spans: [number, number, number][] = [];
  const exercises: StrengthExercise[] = plan.map(([name, sets, bodyweight], e) => ({
    name, ...(bodyweight ? { bodyweight: true } : {}),
    sets: sets.map(([kg, reps, seconds]) => {
      const end = t + seconds;
      spans.push([t, end, 118 + Math.round(((kg * reps) / 560) * 22) + (e === 3 ? 14 : 0)]);
      t = end + rests[k++];
      return { weightKg: kg, reps, seconds, endS: end };
    }),
  }));
  const N = 290, x: number[] = [], hr: number[] = [];
  let h = 92;
  for (let i = 0; i < N; i++) {
    const sec = (i / (N - 1)) * activity.durationS;
    let target = 96;
    for (const [from, to, peak] of spans) if (sec >= from && sec <= to + 12) target = peak;
    h += (target - h) * (target > h ? 0.55 : 0.16);
    x.push(sec);
    hr.push(h);
  }
  return {
    activity, laps: [], steps: null,
    streams: { axis: "time", x, pace: null, hr, elevation: null, cadence: null },
    scales: { pace: null, hr: [85, 150], elevation: null },
    route: null,
    zones: [],
    labels: { hr: "Heart rate across the session with the 18 sets marked: it rises during each set and falls in the rest after it" },
    extras: {
      device: "PACE Pro",
      records: [
        { what: "Bench press", rank: "Best 5 reps", value: "77.5 kg × 5", best: true },
        { what: "Barbell row", rank: "Matches your best", value: "70 kg × 8" },
        { what: "Overhead press", rank: "2nd best 5 reps", value: "50 kg × 5" },
      ],
      relativeEffort: { score: 58, harderThanPct: 64, basis: "From your sets" },
      strength: {
        exercises,
        figure: {
          light: "/img/figure-upper-light.webp", dark: "/img/figure-upper-dark.webp",
          label: "The muscle figure coloured by how hard each muscle worked: chest the most, then lats and shoulders.",
        },
      },
    },
  };
}

/** Calories and average power for the four activities the canvas draws in full. */
const MORE: Record<string, Pick<Activity, "calories" | "avgPowerW">> = {
  "2026-11-19-morning-tempo": { calories: 512, avgPowerW: 286 },
  "2026-11-10-hill-ride": { calories: 1084 },
  "2026-11-14-pool-swim": { calories: 342 },
  "2026-11-17-strength-upper-body": { calories: 286 },
};
const BUILT: Record<string, (a: Activity) => ActivityDetail> = {
  "2026-11-19-morning-tempo": morningTempo,
  "2026-11-10-hill-ride": hillRide,
  "2026-11-14-pool-swim": poolSwim,
  "2026-11-17-strength-upper-body": strengthUpper,
};

const cache = new Map<string, ActivityDetail>();

export function sampleActivityDetail(id: string): ActivityDetail | null {
  const row = SAMPLE_ACTIVITIES.find((a) => a.id === id);
  if (!row) return null;
  let detail = cache.get(id);
  if (!detail) {
    const activity = { ...row, ...MORE[id] };
    detail = (BUILT[id] ?? ((a: Activity) => generateDetail(a, SAMPLE_ZONE_BOUNDS)))(activity);
    detail.thresholds = SAMPLE_THRESHOLDS;
    const week = weekShare(activity, SAMPLE_ACTIVITIES);
    if (week) detail.week = week;
    const extras: ActivityExtras = detail.extras ?? {};
    if (!extras.relativeEffort) {
      const effort = relativeEffort({
        activity, streams: detail.streams, all: SAMPLE_ACTIVITIES, maxHr: maxHrFor(SAMPLE_THRESHOLDS.maxHr, SAMPLE_THRESHOLDS.hr, SAMPLE_ACTIVITIES),
      });
      if (effort) extras.relativeEffort = effort;
    }
    if (Object.keys(extras).length > 0) detail.extras = extras;
    cache.set(id, detail);
  }
  return detail;
}
