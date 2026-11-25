// Synced items → the Sports hub and the Running, Riding and Swimming pages. Pure: plain bodies and `now` in, the
// screens' types out. Headlines and section names follow the phone (SportFindings.swift, SwimFindings.swift,
// SportPages.swift); the numbers come from src/lib/sports.ts.
import type {
  Bar, BarChart, Chip, Figure, HoursWeek, HubCard, HubRing, LineChart, Missing, PowerTile, RidePage, RunPage, SplitShare, Sports, SportsHub, Standout, SwimPage, Tile,
} from "@/data/sports";
import type { HubCalendarDay } from "@/data/hub";
import { hoursMinutes } from "@/lib/calendar";
import { clock, dayKey, thousands } from "@/lib/format";
import {
  addDays, atBest, cogganZones, criticalSwimPace, cyclingVo2Estimate, dayMonthOf, detectSports, durationName, efficiencyTrend, ftpTrend, hoursText, includesSport,
  intensityBalance, isBlip, isSpike, kmText, monthOf, powerCurve, powerZoneSeconds, rideClimbing, runDurability, runTypes, sharePercents, shortfall,
  spikeCheck, sportVolume, standing, swimBands, volumeChange, wattsPerBeat, weekdayLong, weekdayOf, weekStart,
  type Family, type IntensityBalance, type Recording, type RunKind, type SportAct, type SportVolume, type Standing,
} from "@/lib/sports";
import { SPORT_TITLE } from "./geo";
import { refToDate, type ActivityDetailBody, type NativeActivity, type NativeGymWorkout, type NativeSport, type ViewBodyBody, type ViewStrengthBody, type ViewTrainingBody } from "./native";
import { SAMPLE_BIGGEST_CLIMB, SAMPLE_CSS, SAMPLE_CSS_TREND, SAMPLE_RUN_TREND, SAMPLE_STROKES, SAMPLE_SWIM_RECORDS, SAMPLE_SWOLF } from "@/data/sample/sportsReadings";
import { doneSetCount, muscleRow, NOTHING_YET, volumeKg } from "./strength";

const FAMILY_OF: Record<NativeSport, Family> = {
  run: "run", indoorRun: "run", trailRun: "run", track: "run", bike: "ride", indoorBike: "ride", poolSwim: "swim", openWater: "swim",
  strength: "strength", walk: "walk", hike: "walk", cardio: "other", ski: "other", row: "other", multisport: "other", other: "other",
};
export const FAMILY_NAME: Record<Family, string> = { run: "Running", ride: "Riding", swim: "Swimming", strength: "Strength", walk: "Walking", other: "Other" };
export const FAMILY_HREF: Record<Family, string> = { run: "/sports/running", ride: "/sports/riding", swim: "/sports/swimming", strength: "/strength", walk: "/activities", other: "/activities" };
/** The four sports with a page of their own, in the order the hub shows them. */
export const PAGE_FAMILIES: readonly Family[] = ["run", "ride", "swim", "strength"];

/** A workout planned for a day of this week. */
export interface PlannedWorkout { day: string; family: Family; name: string; meters: number; seconds: number }

export interface SportsItems {
  activities: readonly NativeActivity[];
  details: readonly { id: string; body: ActivityDetailBody }[];
  training?: ViewTrainingBody;
  strength?: ViewStrengthBody;
  body?: ViewBodyBody;
  gym: readonly NativeGymWorkout[];
  planned: readonly PlannedWorkout[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): number | null => (finite(v) && v > 0 ? v : null);
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const missing = (text: string = NOTHING_YET): Missing => ({ missing: text });
const chip = (tone: Chip["tone"], text: string): Chip => ({ tone, text });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const percentText = (v: number) => `${Math.round(Math.abs(v))}%`;

export function actFromNative(n: NativeActivity): SportAct | null {
  if (!finite(n.start)) return null;
  return {
    id: n.id, at: refToDate(n.start), family: FAMILY_OF[n.sport] ?? "other", kind: n.sport,
    name: typeof n.name === "string" && n.name.trim() ? n.name : SPORT_TITLE[n.sport] ?? SPORT_TITLE.other,
    meters: positive(n.distanceMeters), seconds: positive(n.durationSeconds) ?? 0, avgHr: positive(n.averageHR),
    climbM: finite(n.elevationGain) ? n.elevationGain : null, avgPowerW: positive(n.averagePower),
  };
}

/**
 * An activity's recording over time. One recorded along distance gets its seconds from its speed, or spread evenly
 * over the activity's time when it has none.
 */
export function recordingFrom(act: SportAct, body: ActivityDetailBody): Recording | null {
  const s = body.streams;
  if (!s || !Array.isArray(s.x) || s.x.length < 2) return null;
  const n = s.x.length;
  const same = (v: number[] | undefined) => (Array.isArray(v) && v.length === n ? v : undefined);
  const speed = same(s.speedMps);
  let t: number[];
  if (s.axis === "time") t = s.x;
  else if (speed) {
    t = [0];
    for (let i = 1; i < n; i++) {
      const v = (Math.max(0, speed[i - 1]) + Math.max(0, speed[i])) / 2;
      t.push(t[i - 1] + (v > 0.2 ? Math.max(0, s.x[i] - s.x[i - 1]) / v : 0));
    }
  } else {
    const span = s.x[n - 1] - s.x[0];
    if (!(span > 0) || !(act.seconds > 0)) return null;
    t = s.x.map((x) => ((x - s.x[0]) / span) * act.seconds);
  }
  return { id: act.id, at: act.at, t, hr: same(s.hr), power: same(s.powerW), speed };
}

/** Training Hub's planned workouts of the sports with a page here. */
export function plannedFromHub(days: readonly HubCalendarDay[]): PlannedWorkout[] {
  const family: Record<string, Family> = { run: "run", trailRun: "run", bike: "ride", swim: "swim", strength: "strength", hyrox: "strength" };
  return days.flatMap((d) => d.workouts.flatMap((w) => {
    const f = w.sport ? family[w.sport] : undefined;
    return f ? [{ day: d.day, family: f, name: w.name, meters: w.totals?.meters ?? 0, seconds: w.totals?.seconds ?? 0 }] : [];
  }));
}

/* ───────────── Shared pieces ───────────── */

interface Context {
  now: Date;
  acts: SportAct[];
  by: (family: Family) => SportAct[];
  recordings: Map<string, Recording>;
  training: ViewTrainingBody | undefined;
  thresholdHr: number | null;
  weightKg: number | null;
  /** Planned for the rest of this week: later days, and today while nothing of that sport is recorded yet. */
  planned: (family: Family) => PlannedWorkout[];
  families: Family[];
}

function weekBars(volume: SportVolume, value: (w: SportVolume["weeks"][number]) => number, top: (v: number) => string, planned: number): Bar[] {
  return volume.weeks.map((w, k) => {
    const last = k === volume.weeks.length - 1, v = value(w);
    const bar: Bar = { value: v, top: v > 0 ? top(v) : "", label: String(w.start.getDate()) };
    if (k === 0 || w.start.getMonth() !== volume.weeks[k - 1].start.getMonth()) bar.sub = monthOf(w.start);
    if (last) { bar.now = true; if (planned > 0) bar.planned = planned; }
    return bar;
  });
}

const daysLeft = (volume: SportVolume) => volume.days.length - 1 - volume.todayIndex;

function volumeChip(s: Standing, plannedOnTop: boolean): Chip | null {
  if (plannedOnTop) return chip("good", "On plan");
  switch (s.kind) {
    case "more": return chip("attention", "Big week");
    case "less": return chip("attention", "Light week");
    case "level": return chip("good", "On track");
    default: return null;
  }
}

function splitOf(balance: IntensityBalance): SplitShare[] {
  const [low, moderate, high] = sharePercents(balance);
  return [
    { name: "Easy", percent: low, detail: hoursText(balance.low, true), hue: "run" },
    { name: "Moderate", percent: moderate, detail: hoursText(balance.moderate, true), hue: "gold" },
    { name: "Hard", percent: high, detail: hoursText(balance.high, true), hue: "coral" },
  ];
}

const balanceChip = (b: IntensityBalance): Chip => (b.pattern === "threshold" || b.pattern === "high" ? chip("attention", "Hard block") : b.pattern === "base" ? chip("neutral", "All easy") : chip("good", "In range"));

/** The three right-hand marks and the three dates of a line chart. */
function lineChart(points: readonly { at: Date; value: number }[], text: (v: number) => string, label: string, flip = false): LineChart {
  const values = points.map((p) => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const marks = lo === hi ? [text(hi)] : flip ? [text(lo), text((lo + hi) / 2), text(hi)] : [text(hi), text((lo + hi) / 2), text(lo)];
  const mid = points[Math.floor((points.length - 1) / 2)];
  const dates = points.length >= 3 ? [dayMonthOf(points[0].at), dayMonthOf(mid.at), dayMonthOf(points[points.length - 1].at)] : points.map((p) => dayMonthOf(p.at));
  return { values, marks, dates, label, flip };
}

interface Best { name: string; meters: number; seconds: number; at: Date | null; family: Family }

function bestsOf(training: ViewTrainingBody | undefined): Best[] {
  const family = (sport: string | undefined): Family => {
    const s = (sport ?? "run").toLowerCase();
    if (s.includes("swim") || s === "openwater") return "swim";
    if (s.includes("bike") || s.includes("ride") || s.includes("cycl")) return "ride";
    return "run";
  };
  return (training?.bests ?? [])
    .filter((b) => b != null && finite(b.seconds) && b.seconds > 0 && finite(b.meters) && b.meters > 0)
    .map((b) => ({ name: b.name, meters: b.meters, seconds: b.seconds, at: finite(b.at) ? refToDate(b.at) : null, family: family(b.sport) }));
}

const isFresh = (b: Best, now: Date) => b.at != null && now.getTime() - b.at.getTime() <= 14 * 86_400_000 && b.at.getTime() <= now.getTime();

/* ───────────── Running ───────────── */

const KIND_NAME: Record<RunKind, string> = { easy: "Easy", long: "Long", tempo: "Tempo", hard: "Hard" };

function buildRun(c: Context): RunPage {
  const { now } = c;
  const runs = c.by("run");
  const volume = sportVolume(runs, now);
  const week = volume.weeks[volume.weeks.length - 1];
  const planned = c.planned("run");
  const plannedM = sum(planned.map((p) => p.meters));
  const usual = volume.usualMeters;
  const stand = standing(week.meters, usual, daysLeft(volume), 1000);
  const spikes = spikeCheck(runs, now);
  // Four weeks of rows, the same four the headline counts.
  const types = runTypes(runs, c.thresholdHr, now, 4);
  const balance = intensityBalance(runs, c.recordings, c.thresholdHr, now);
  const tenK = (c.training?.predictions ?? []).find((p) => p != null && Math.abs(p.meters - 10000) < 50 && p.seconds > 0);
  const vo2 = positive(c.training?.vo2max);
  const durability = runDurability(runs.map((r) => c.recordings.get(r.id)).filter((r): r is Recording => r != null), now);
  const efficiency = efficiencyTrend(runs, c.thresholdHr, now);
  const km = (m: number) => (m / 1000).toFixed(1);

  const weeksChart = (): BarChart => ({
    bars: weekBars(volume, (w) => w.meters, km, plannedM),
    line: usual != null ? { value: usual, text: `Usual, ${kmText(usual)}` } : null,
    planned: plannedM > 0,
    label: `Kilometres run in each of the last ${volume.weeks.length} weeks, with ${km(week.meters)} so far this week${plannedM > 0 ? ` and ${km(plannedM)} more planned` : ""}${usual != null ? `, against the usual week of ${kmText(usual)}` : ""}.`,
  });

  const days: BarChart = {
    bars: volume.days.map((d, k) => {
      const plan = k >= volume.todayIndex ? sum(planned.filter((p) => p.day === dayKey(d.date)).map((p) => p.meters)) : 0;
      const bar: Bar = { value: d.meters, top: d.meters > 0 ? km(d.meters) : "", label: weekdayOf(d.date), now: k === volume.todayIndex };
      if (plan > 0) bar.planned = plan;
      return bar;
    }),
    line: null, planned: plannedM > 0,
    label: `This week by day: ${volume.days.map((d) => `${weekdayOf(d.date)} ${km(d.meters)} km`).join(", ")}.`,
  };

  const latest = spikes?.runs[spikes.runs.length - 1] ?? null;
  const monthRuns = (spikes?.runs ?? []).filter((r) => r.at.getTime() >= now.getTime() - 28 * 86_400_000).slice(-12);
  const long = spikes && spikes.nextLimit != null && spikes.recentLongest != null && latest ? {
    limit: kmText(spikes.nextLimit), last: kmText(latest.meters), lastOver: isSpike(latest), longest: kmText(spikes.recentLongest),
    runs: {
      bars: monthRuns.map((r, k) => {
        const bar: Bar = { value: r.meters, top: km(r.meters), label: String(r.at.getDate()), over: isSpike(r), now: k === monthRuns.length - 1 };
        if (k === 0 || r.at.getMonth() !== monthRuns[k - 1].at.getMonth()) bar.sub = monthOf(r.at);
        return bar;
      }),
      line: { value: spikes.nextLimit, text: `10% limit, ${kmText(spikes.nextLimit)}` }, planned: false,
      label: `Each run of the last 4 weeks against the 10% limit of ${kmText(spikes.nextLimit)}: the longest was ${kmText(spikes.recentLongest)}, the latest ${kmText(latest.meters)}.`,
    },
  } : null;

  const total = kmText(week.meters);
  const muchHeadline = stand.kind === "none" ? "No runs yet this week"
    : stand.kind === "more" ? `${total} this week, ${kmText(stand.by)} more than usual`
    : stand.kind === "less" ? `${total} this week, ${kmText(stand.by)} less than usual`
    : stand.kind === "level" ? `${total} this week, about your usual` : `${total} so far this week`;
  const muchChip = volumeChip(stand, plannedM > 0 && usual != null && week.meters + plannedM >= usual * 0.9);

  /* Easy and hard */
  const [lowPct] = balance ? sharePercents(balance) : [0];
  const hard: RunPage["hard"] = !types || types.known === 0
    ? missing("Needs three runs with heart rate in the last 4 weeks.")
    : {
      chip: balance ? balanceChip(balance) : null,
      headline: types.quality > 0 ? `${plural(types.quality, "quality run")} in 4 weeks` : types.weeksWithoutQuality >= 2 ? `No quality run in ${types.weeksWithoutQuality} weeks` : "Mostly easy running",
      sub: types.quality > 0
        ? `${types.quality === types.known ? (types.known === 1 ? "Your one run was tempo or hard" : `All ${types.known} runs were tempo or hard`) : `Out of ${plural(types.known, "run")}`}${balance ? `; ${lowPct}% of your running time was easy` : ""}.`
        : "Your recent runs were easy or long. That suits a base block; if you're racing soon, this is the gap to look at.",
      split: balance ? splitOf(balance) : [],
      // Days run Monday (0) to Sunday (6); `today` marks the current week so later days show as still to come.
      weeks: types.weeks.map((w) => ({
        label: dayMonthOf(w.start),
        runs: w.runs.map((r) => ({ kind: r.kind ? KIND_NAME[r.kind] : "Unknown", day: (r.at.getDay() + 6) % 7 })),
        today: w.start.getTime() === weekStart(now).getTime() ? (now.getDay() + 6) % 7 : null,
      })),
    };

  /* Engine */
  const predictions = (c.training?.predictions ?? []).filter((p) => p != null && p.seconds > 0 && p.meters > 0).sort((a, b) => a.meters - b.meters);
  const runBests = bestsOf(c.training).filter((b) => b.family === "run").sort((a, b) => a.meters - b.meters);
  const marks: Figure[] = [];
  const thresholdPace = positive(c.training?.thresholdPaceSecPerKm);
  if (thresholdPace != null) marks.push({ value: `${clock(thresholdPace, 2)} /km`, label: "Threshold pace" });
  if (c.thresholdHr != null) marks.push({ value: `${Math.round(c.thresholdHr)} bpm`, label: "Threshold heart rate" });
  const engine: RunPage["engine"] = !predictions.length && vo2 == null && !runBests.length ? missing() : {
    chip: null,
    headline: tenK ? `10K prediction: ${clock(tenK.seconds)}` : vo2 != null ? `VO₂ max ${Math.round(vo2)}` : predictions.length ? `${predictions[0].name} prediction: ${clock(predictions[0].seconds)}` : "Your personal bests",
    sub: null, trend: null,
    predictions: predictions.map((p) => ({ name: p.name, time: clock(p.seconds), change: null, focus: p === tenK })),
    vo2: vo2 != null ? String(Math.round(vo2)) : null, vo2Change: null, sampleTrend: SAMPLE_RUN_TREND, marks,
    bests: runBests.map((b) => ({ name: b.name, value: clock(b.seconds, 2), date: b.at ? dayMonthOf(b.at) : "", fresh: isFresh(b, now) })),
  };

  /* Durability */
  const lastPoint = durability?.points[durability.points.length - 1];
  const durabilityCard: RunPage["durability"] = !durability || !lastPoint
    ? missing("Needs three runs of an hour or more with their recording.")
    : {
      chip: durability.heldInARow > 0 ? chip("good", "Holding") : chip("attention", "Drifting"),
      headline: durability.heldInARow > 1 ? `Your last ${durability.heldInARow} long runs held under 5%` : durability.heldInARow === 1 ? "Your last long run held under 5%" : `Your last long run drifted ${lastPoint.percent.toFixed(1)}%`,
      sub: durability.heldInARow > 0 ? `${lastPoint.percent.toFixed(1)}% over ${clock(lastPoint.seconds)} on the latest. Your base covers that distance at this pace.`
        : `Over ${clock(lastPoint.seconds)}. Under 5% suggests your base covers the distance; heat, hills and tired days raise it.`,
      points: durability.points.map((p) => ({ top: `${p.percent.toFixed(1)}%`, label: dayMonthOf(p.at), percent: p.percent, held: p.percent < 5 })),
      label: `Heart-rate drift on the last ${durability.points.length} long runs: ${durability.points.map((p) => `${p.percent.toFixed(1)}%`).join(", ")}, against the 5% line.`,
    };

  /* Efficiency */
  const effCard: RunPage["efficiency"] = !efficiency || efficiency.points.length < 2
    ? missing("Needs three easy runs with heart rate in the last 12 weeks.")
    : {
      chip: efficiency.change == null ? null : efficiency.change >= 1 ? chip("good", `Up ${percentText(efficiency.change)}`) : efficiency.change <= -1 ? chip("attention", `Down ${percentText(efficiency.change)}`) : chip("neutral", "Steady"),
      headline: efficiency.change == null ? `${efficiency.points[efficiency.points.length - 1].value.toFixed(2)} m per heartbeat on your easy runs`
        : efficiency.change >= 1 ? `Easy pace per heartbeat is up ${percentText(efficiency.change)}`
        : efficiency.change <= -1 ? `Easy pace per heartbeat is down ${percentText(efficiency.change)}` : "Easy pace per heartbeat is steady",
      sub: efficiency.change == null ? null : "The last 4 weeks against the 8 before.",
      chart: lineChart(efficiency.points.map((p) => ({ at: p.start, value: p.value })), (v) => v.toFixed(2),
        `Metres per heartbeat on easy runs, week by week, from ${efficiency.points[0].value.toFixed(2)} to ${efficiency.points[efficiency.points.length - 1].value.toFixed(2)}.`),
    };

  /* Hero */
  const fourWeeks = volume.weeks.slice(-5, -1).map((w) => w.meters);
  const building = fourWeeks.length === 4 && fourWeeks.every((m, k) => k === 0 || m >= fourWeeks[k - 1] * 0.95) && fourWeeks[3] > fourWeeks[0];
  const lead = stand.kind === "none" ? "No runs yet this week" : stand.kind === "more" ? "A big week" : stand.kind === "less" ? "A light week" : stand.kind === "level" ? "Right on your usual week" : building ? "A steady build" : "A steady week";
  const heroText = plannedM > 0
    ? `${plural(week.sessions, "run")} in, with ${planned.map((p) => `${p.meters > 0 ? kmText(p.meters) : p.name} on ${weekdayLong(new Date(`${p.day}T12:00`))}`).join(" and ")} still planned. That would make ${kmText(week.meters + plannedM)}${usual != null ? `, ${kmText(Math.abs(week.meters + plannedM - usual))} ${week.meters + plannedM >= usual ? "over" : "under"} your usual week` : ""}.`
    : null;
  const figures: Figure[] = [{ value: total, label: "This week" }, { value: String(week.sessions), label: "Runs" }, { value: clock(week.seconds), label: "Time" }];
  if (vo2 != null) figures.push({ value: String(Math.round(vo2)), label: "VO₂ max" });

  /* Tiles */
  const tiles: Tile[] = [
    {
      label: "Volume", chip: muchChip, value: km(week.meters), unit: "km", spark: volume.weeks.map((w) => w.meters), hue: "run", href: "#much",
      text: plannedM > 0 ? `${km(plannedM)} km planned takes the week to ${kmText(week.meters + plannedM)}` : usual != null ? `Your usual week is ${kmText(usual)}` : plural(week.sessions, "run"),
    },
    {
      label: "Long runs", chip: latest ? (isSpike(latest) ? chip("attention", "Big jump") : chip("good", "Safe to build")) : null,
      value: spikes?.nextLimit != null ? km(spikes.nextLimit) : "–", unit: "km", spark: volume.weeks.map((w) => w.longestMeters), hue: "ride", href: "#much",
      text: spikes?.nextLimit != null ? `Your next run can go up to ${kmText(spikes.nextLimit)}` : "No runs in the last 8 weeks",
    },
    {
      label: "Easy vs hard", chip: balance ? balanceChip(balance) : null, value: balance ? String(lowPct) : "–", unit: balance ? "% easy" : "", spark: null, hue: "run", href: "#hard",
      text: types && types.known > 0 ? `${plural(types.quality, "quality run")} in 4 weeks, out of ${types.known}` : "Needs runs with heart rate",
    },
    {
      label: "Your engine", chip: null, value: tenK ? clock(tenK.seconds) : vo2 != null ? String(Math.round(vo2)) : "–", unit: tenK ? "10K" : vo2 != null ? "VO₂ max" : "", spark: null, hue: "run", href: "#engine",
      text: tenK && vo2 != null ? `VO₂ max ${Math.round(vo2)}` : tenK || vo2 != null ? "From COROS" : NOTHING_YET,
    },
  ];

  /* Coach's read: rules, not a model. */
  const next = planned[0];
  const easyBpm = c.thresholdHr != null ? Math.floor(c.thresholdHr * 0.9) : null;
  const nextChips = [easyBpm != null ? `Easy is under ${easyBpm} bpm` : null, spikes?.nextLimit != null ? `Up to ${kmText(spikes.nextLimit)}` : null].filter((t): t is string => t != null);
  const facts: Figure[] = [];
  if (usual != null) facts.push({ label: "4-week average", value: `${kmText(usual)} a week` });
  if (types && types.known > 0) facts.push({ label: "Quality runs", value: `${types.quality} of ${types.known}` });
  if (lastPoint) facts.push({ label: "Latest long-run drift", value: `${lastPoint.percent.toFixed(1)}%` });
  const coachHeadline = latest && isSpike(latest) ? "Your last run was a big jump."
    : types && types.known > 0 && types.quality === 0 ? "All easy lately."
    : balance && (balance.pattern === "threshold" || balance.pattern === "high") ? "A lot of your running is hard."
    : types && types.quality > 0 ? "The hard work is in the right place." : "A steady week.";

  return {
    hero: {
      ring: usual != null && usual > 0 ? { percent: Math.round((week.meters / usual) * 100), label: `${km(week.meters)} of ${kmText(usual)} run this week` } : null,
      chip: `This week · ${total} so far`,
      headline: `${lead}${tenK ? `, on course for a ${clock(tenK.seconds)} 10K` : ""}.`,
      text: heroText, figures, chart: weeksChart(), chartTitle: "Kilometres a week",
    },
    tiles,
    much: { chip: muchChip, headline: muchHeadline, sub: usual != null ? `Your usual week is ${kmText(usual)}.` : null, weeks: weeksChart(), days, long },
    coach: {
      headline: coachHeadline,
      next: next ? { title: `${next.name} on ${weekdayLong(new Date(`${next.day}T12:00`))}`, chips: nextChips } : nextChips.length ? { title: spikes?.nextLimit != null ? `Up to ${kmText(spikes.nextLimit)}` : `Easy under ${easyBpm} bpm`, chips: spikes?.nextLimit != null && easyBpm != null ? [`Easy is under ${easyBpm} bpm`] : [] } : null,
      facts,
    },
    hard, engine, durability: durabilityCard, efficiency: effCard,
  };
}

/* ───────────── Riding ───────────── */

const ZONE_HUE = ["slate", "ride", "run", "gold", "strength", "coral", "rose"] as const;

function buildRide(c: Context): RidePage {
  const { now } = c;
  const rides = c.by("ride");
  const volume = sportVolume(rides, now);
  const week = volume.weeks[volume.weeks.length - 1];
  const planned = c.planned("ride");
  const plannedS = sum(planned.map((p) => p.seconds));
  const usual = volume.usualSeconds;
  const stand = standing(week.seconds, usual, daysLeft(volume), 900);
  const recs = rides.map((r) => c.recordings.get(r.id)).filter((r): r is Recording => r != null && r.power != null);
  const curve = powerCurve(recs, now);
  const trend = ftpTrend(recs, now);
  const twenty = curve?.find((r) => r.seconds === 1200)?.recent ?? null;
  const setFtp = positive(c.training?.ftp);
  const ftp = setFtp ?? (twenty != null ? twenty * 0.95 : null);
  const perKg = (watts: number) => (c.weightKg != null ? (watts / c.weightKg).toFixed(2) : null);
  const five = curve?.find((r) => r.seconds === 300)?.recent ?? null;
  const vo2Estimate = five != null && c.weightKg != null ? cyclingVo2Estimate(five, c.weightKg) : null;
  const runVo2 = positive(c.training?.vo2max);
  const climbing = rideClimbing(rides, now);
  const balance = intensityBalance(rides, c.recordings, c.thresholdHr, now);
  const zoneSeconds = ftp != null ? powerZoneSeconds(recs, ftp, now) : null;
  const beats = wattsPerBeat(recs, now);
  const hm = (s: number) => hoursMinutes(s);

  /* Power curve */
  const best = curve ? atBest(curve) : [];
  const unbroken = (() => {
    if (!curve || best.length < 2) return false;
    const places = curve.map((r, k) => ((shortfall(r) ?? 100) <= 1 ? k : -1)).filter((k) => k >= 0);
    return places[places.length - 1] - places[0] + 1 === places.length;
  })();
  const curveHeadline = !curve ? null
    : best.length === 1 ? `At your best at ${durationName(best[0].seconds)}.`
    : best.length > 1 && unbroken ? `At your best from ${durationName(best[0].seconds).replace(" min", "")} to ${durationName(best[best.length - 1].seconds)}${best[0].seconds < 60 ? "" : "utes"}.`.replace("minutes", "minutes")
    : best.length > 1 ? `At your best at ${best.map((r) => durationName(r.seconds)).join(", ")}.` : "Your best power in the last 90 days.";
  const curveTiles: PowerTile[] = (curve ?? []).map((r) => {
    const short = shortfall(r);
    const watts = r.recent ?? r.best;
    return {
      name: durationName(r.seconds), watts: `${Math.round(watts)} W`, perKg: perKg(watts) ? `${perKg(watts)} W/kg` : null,
      note: short == null ? "Best ever" : short <= 1 ? "Best" : `−${Math.round(short)}%`, best: short != null && short <= 1,
    };
  });

  const total = hoursText(week.seconds, true);
  const muchHeadline = stand.kind === "none" ? "No rides yet this week"
    : stand.kind === "more" ? `${total} on the bike, ${hoursText(stand.by, true)} more than usual`
    : stand.kind === "less" ? `${total} on the bike, ${hoursText(stand.by, true)} less than usual`
    : stand.kind === "level" ? `${total} on the bike, about your usual` : `${total} on the bike so far this week`;
  const muchChip = volumeChip(stand, plannedS > 0 && usual != null && week.seconds + plannedS >= usual * 0.9)
    ?? (usual != null && week.seconds < usual * 0.5 && daysLeft(volume) <= 3 && week.seconds > 0 ? chip("attention", "Light week") : null);

  const figures: Figure[] = [];
  if (ftp != null) figures.push({ value: `${Math.round(ftp)} W`, label: setFtp != null ? "FTP" : "Estimated FTP" });
  if (ftp != null && perKg(ftp)) figures.push({ value: perKg(ftp) as string, label: "W/kg" });
  if (vo2Estimate != null) figures.push({ value: String(Math.round(vo2Estimate)), label: "Cycling VO₂ max" });
  figures.push({ value: hoursText(week.seconds), label: "This week" });

  /* Climbing */
  const climbNow = climbing ? climbing.weeks[climbing.weeks.length - 1].meters : 0;
  const climbLast = climbing && climbing.weeks.length > 1 ? climbing.weeks[climbing.weeks.length - 2].meters : 0;
  const climbCard: RidePage["climb"] = !climbing || !climbing.weeks.some((w) => w.meters > 0) ? missing("Needs an outdoor ride with its climbing.") : {
    chip: climbing.isNotable ? chip("good", "Big week") : null,
    headline: !(climbNow > 0) ? "No climbing yet this week"
      : climbing.isNotable && climbing.moreBefore ? `${thousands(climbNow)} m this week, your most since ${dayMonthOf(climbing.moreBefore)}` : `${thousands(climbNow)} m climbed this week`,
    sub: climbLast > 0 ? `Last week: ${thousands(climbLast)} m.` : null, sampleBiggest: SAMPLE_BIGGEST_CLIMB,
    weeks: {
      bars: climbing.weeks.map((w, k) => {
        const bar: Bar = { value: w.meters, top: w.meters > 0 ? thousands(w.meters) : "", label: String(w.start.getDate()), now: k === climbing.weeks.length - 1 };
        if (k === 0 || w.start.getMonth() !== climbing.weeks[k - 1].start.getMonth()) bar.sub = monthOf(w.start);
        return bar;
      }),
      line: null, planned: false,
      label: `Metres climbed in each of the last ${climbing.weeks.length} weeks: ${climbing.weeks.map((w) => thousands(w.meters)).join(", ")}.`,
    },
  };

  /* Power zones */
  const zones: RidePage["zones"] = ftp == null || !zoneSeconds ? missing("Needs a ride with a power meter in the last 4 weeks.") : (() => {
    const all = sum(zoneSeconds);
    const share = zoneSeconds.map((s) => (s / all) * 100);
    const low = share[0] + share[1], mid = share[2] + share[3], high = share[4] + share[5] + share[6];
    const defs = cogganZones(ftp);
    return {
      chip: low >= 65 ? chip("good", "In range") : chip("attention", "Hard block"),
      headline: low >= 65 ? "Mostly easy riding, as it should be" : mid >= high ? "A lot of your riding is in the middle" : "Much of your riding is hard",
      sub: `Over the last 4 weeks: ${Math.round(low)}% in zones 1–2, ${Math.round(mid)}% in 3–4 and ${Math.round(high)}% in 5–7.`,
      rows: defs.map((z, k) => ({
        zone: `Z${z.zone}`, name: z.name, percent: share[k], hue: ZONE_HUE[k],
        range: z.from == null ? `under ${(z.to as number) + 1} W` : z.to == null ? `over ${z.from - 1} W` : `${z.from}–${z.to} W`,
        text: `${share[k] >= 10 || share[k] === 0 ? Math.round(share[k]) : share[k].toFixed(1)}%`,
      })),
    };
  })();

  /* FTP */
  const gain = trend.length >= 2 ? trend[trend.length - 1].watts - trend[0].watts : null;
  const ftpChip = gain == null ? null : gain >= 3 ? chip("good", "Rising") : gain <= -3 ? chip("attention", "Falling") : chip("neutral", "Steady");
  const ftpCard: RidePage["ftp"] = ftp == null ? missing("Needs a ride with a power meter.") : {
    chip: ftpChip,
    headline: `${setFtp != null ? "FTP" : "Estimated FTP"}: ${Math.round(ftp)} W`,
    sub: `${setFtp != null ? "As set on your watch." : "95% of your best 20 minutes in the last 90 days."}${gain != null && Math.abs(gain) >= 3 ? ` Your best 20 minutes point to ${Math.round(Math.abs(gain))} W ${gain > 0 ? "more" : "less"} than in the 4 weeks to ${dayMonthOf(trend[0].end)}.` : ""}`,
    trend: trend.length >= 2 ? lineChart(trend.map((p) => ({ at: p.end, value: p.watts })), (v) => `${Math.round(v)} W`,
      `95% of your best 20 minutes in each 4 weeks, from ${Math.round(trend[0].watts)} W to ${Math.round(trend[trend.length - 1].watts)} W.`) : null,
    figures: [
      { value: `${Math.round(ftp)} W`, label: setFtp != null ? "FTP" : "Estimated FTP" },
      ...(perKg(ftp) ? [{ value: perKg(ftp) as string, label: "W/kg" }] : []),
      ...(c.weightKg != null ? [{ value: `${c.weightKg.toFixed(1)} kg`, label: "Weight" }] : []),
    ],
  };

  /* Cycling VO2 max: COROS's own figure is not synced, so this is C-LINK's estimate or nothing. */
  const vo2Card: RidePage["vo2"] = vo2Estimate == null || five == null || c.weightKg == null
    ? missing(five == null ? "Needs a ride of 5 minutes or more with a power meter in the last 90 days." : "Needs your weight.")
    : {
      chip: null, headline: `C-LINK's estimate: about ${Math.round(vo2Estimate)}`,
      sub: `From your best 5 minutes, ${Math.round(five)} W at ${c.weightKg.toFixed(1)} kg. Not COROS's number.`,
      figures: [{ value: String(Math.round(vo2Estimate)), label: "On the bike" }, ...(runVo2 != null ? [{ value: String(Math.round(runVo2)), label: "On your runs" }] : [])],
    };

  /* Easy and hard */
  const RIDE_PATTERN: Record<IntensityBalance["pattern"], string> = {
    base: "Almost all easy riding", polarized: "Mostly easy, with some hard riding", pyramidal: "Mostly easy, with a little hard riding",
    threshold: "A lot of your riding is in the middle", high: "Much of your riding is hard", mixed: "Mostly easy riding",
  };
  const balanceCard: RidePage["balance"] = !balance ? missing("Needs three rides with heart rate in the last 4 weeks.") : {
    chip: balanceChip(balance), headline: RIDE_PATTERN[balance.pattern], sub: "The last 28 days on the bike, by heart rate.", split: splitOf(balance),
    note: "Read against the threshold heart rate on your watch. On a bike it usually sits a few beats lower than on a run, so a ride can read a little easier than it was.",
  };

  /* Watts per beat */
  const cut = now.getTime() - 28 * 86_400_000;
  const recentBeats = beats.filter((p) => p.at.getTime() >= cut).map((p) => p.value), beforeBeats = beats.filter((p) => p.at.getTime() < cut).map((p) => p.value);
  const beatChange = recentBeats.length >= 2 && beforeBeats.length >= 2 ? ((sum(recentBeats) / recentBeats.length) / (sum(beforeBeats) / beforeBeats.length) - 1) * 100 : null;
  const perBeat: RidePage["perBeat"] = !beats.length ? missing("Needs a ride of 30 minutes or more with power and heart rate.") : {
    chip: beatChange == null ? null : beatChange >= 1 ? chip("good", `Up ${percentText(beatChange)}`) : beatChange <= -1 ? chip("attention", `Down ${percentText(beatChange)}`) : chip("neutral", "Steady"),
    headline: `${beats[beats.length - 1].value.toFixed(2)} W per beat on your latest ride`, sub: null,
    chart: beats.length >= 2 ? lineChart(beats, (v) => v.toFixed(2), `Watts per heartbeat on rides of 30 minutes or more, from ${beats[0].value.toFixed(2)} to ${beats[beats.length - 1].value.toFixed(2)}.`) : null,
  };

  /* Records */
  const records: RidePage["records"] = bestsOf(c.training).filter((b) => b.family === "ride").map((b) => ({ name: b.name, value: clock(b.seconds, 2), date: b.at ? dayMonthOf(b.at) : "" }));
  const longest = rides.reduce<SportAct | null>((a, r) => (!a || r.seconds > a.seconds ? r : a), null);
  if (longest && longest.seconds > 0) records.push({ name: "Longest ride", value: hoursText(longest.seconds, true), date: dayMonthOf(longest.at) });
  const steepest = rides.reduce<SportAct | null>((a, r) => ((r.climbM ?? 0) > (a?.climbM ?? 0) ? r : a), null);
  if (steepest && (steepest.climbM ?? 0) > 0) records.push({ name: "Most climbing", value: `${thousands(steepest.climbM as number)} m`, date: dayMonthOf(steepest.at) });

  const nextRide = planned[0];
  const tiles: Tile[] = [
    {
      label: "Volume", chip: muchChip, value: hoursText(week.seconds), unit: usual != null ? `of ${hoursText(usual)}` : "", spark: volume.weeks.map((w) => w.seconds), hue: "ride", href: "#much",
      text: nextRide ? `${nextRide.seconds > 0 ? `A ${hoursText(nextRide.seconds)} ride` : nextRide.name} is planned for ${weekdayLong(new Date(`${nextRide.day}T12:00`))}` : plural(week.sessions, "ride") + " this week",
    },
    {
      label: "FTP", chip: ftpChip, value: ftp != null ? String(Math.round(ftp)) : "–", unit: ftp != null ? "W" : "", spark: trend.length >= 2 ? trend.map((p) => p.watts) : null, hue: "gold", href: "#ftp",
      text: ftp == null ? "Needs a ride with a power meter" : gain != null && gain >= 3 ? `Best 20 minutes point to ${Math.round(gain)} W more than ${trend.length * 4 - 4} weeks ago` : setFtp != null ? "As set on your watch" : "From your best 20 minutes",
    },
    {
      label: "Climbing", chip: climbing?.isNotable ? chip("good", "Big week") : null, value: thousands(climbNow), unit: "m", spark: climbing ? climbing.weeks.map((w) => w.meters) : null, hue: "violet", href: "#climb",
      text: climbing?.isNotable && climbing.moreBefore ? `Your most since ${dayMonthOf(climbing.moreBefore)}` : climbLast > 0 ? `Last week: ${thousands(climbLast)} m` : "Metres climbed this week",
    },
    {
      label: "Easy vs hard", chip: balance ? balanceChip(balance) : null, value: balance ? String(sharePercents(balance)[0]) : "–", unit: balance ? "% easy" : "", spark: null, hue: "run", href: "#balance",
      text: balance ? RIDE_PATTERN[balance.pattern] : "Needs rides with heart rate",
    },
  ];

  const weekLine = usual != null ? `${week.seconds > 0 ? `${total} so far this week, of your usual ${hoursText(usual, true)}` : `No rides yet this week; your usual week is ${hoursText(usual, true)}`}${nextRide && nextRide.seconds > 0 ? `, with a ${hoursText(nextRide.seconds)} ride planned for ${weekdayLong(new Date(`${nextRide.day}T12:00`))}` : ""}.` : null;
  return {
    hero: {
      chip: curve ? "Power · last 90 days" : `This week · ${hoursText(week.seconds)} so far`,
      headline: curveHeadline ?? `${muchHeadline}.`,
      text: curve ? weekLine : null, figures,
      curve: curve ? {
        recent: curve.map((r) => r.recent), best: curve.map((r) => r.best), tiles: curveTiles,
        marks: (() => { const top = Math.max(...curve.map((r) => r.best)); return top > 600 ? [250, 500, 1000] : [100, 200, 400]; })(),
        label: `Power curve: ${curve.map((r) => { const s = shortfall(r); return `${durationName(r.seconds)} ${Math.round(r.recent ?? r.best)} W${s == null ? "" : s <= 1 ? ", your best" : `, ${Math.round(s)}% under your best`}`; }).join("; ")}.`,
      } : missing("Needs a ride with a power meter."),
    },
    tiles,
    much: {
      chip: muchChip, headline: muchHeadline, sub: usual != null ? `Your usual week is ${hoursText(usual, true)}.` : null,
      weeks: {
        bars: weekBars(volume, (w) => w.seconds, hm, plannedS),
        line: usual != null ? { value: usual, text: `Usual, ${hoursText(usual)}` } : null, planned: plannedS > 0,
        label: `Hours ridden in each of the last ${volume.weeks.length} weeks, with ${hm(week.seconds)} so far this week${plannedS > 0 ? ` and ${hoursText(plannedS, true)} planned` : ""}.`,
      },
      figures: [
        { value: String(week.sessions), label: "Rides" }, { value: kmText(week.meters), label: "Distance" }, { value: hoursText(week.longestSeconds), label: "Long ride" },
        ...(volume.yearLongest ? [{ value: hoursText(volume.yearLongest.seconds), label: "Longest this year" }] : []),
      ],
    },
    climb: climbCard, zones, ftp: ftpCard, vo2: vo2Card, balance: balanceCard, perBeat, records,
  };
}

/* ───────────── Swimming ───────────── */

function buildSwim(c: Context): SwimPage {
  const { now } = c;
  const swims = c.by("swim");
  const volume = sportVolume(swims, now);
  const four = volume.weeks.slice(-4);
  const meters = sum(four.map((w) => w.meters)), count = sum(four.map((w) => w.sessions));
  const change = volumeChange(swims, now);
  const bests = bestsOf(c.training).filter((b) => b.family === "swim").sort((a, b) => a.meters - b.meters);
  const b200 = bests.find((b) => Math.abs(b.meters - 200) < 1), b400 = bests.find((b) => Math.abs(b.meters - 400) < 1);
  const css = b200 && b400 ? criticalSwimPace(b200.seconds, b400.seconds) : null;
  const fresh = bests.filter((b) => isFresh(b, now)).sort((a, b) => (b.at as Date).getTime() - (a.at as Date).getTime());
  const top = Math.max(1, ...volume.weeks.map((w) => w.meters));
  const pct = change != null ? Math.round(Math.abs(change) * 100) : 0;
  const volChip = change == null || pct < 5 ? null : change > 0 ? chip("good", `Up ${pct}%`) : chip("attention", `Down ${pct}%`);

  const cssCard: SwimPage["css"] = css == null || !b200 || !b400 ? SAMPLE_CSS : (() => {
    const bands = swimBands(css);
    return {
      chip: null, headline: `Critical swim speed ${clock(css)} /100 m`,
      sub: `Estimated from your best 200 m (${clock(b200.seconds, 2)}) and 400 m (${clock(b400.seconds, 2)}).`,
      bands: [
        { name: "Easy", text: `slower than ${clock(bands.easyFrom)}`, hue: "run" as const },
        { name: "Threshold", text: `${clock(bands.thresholdFrom)} to ${clock(bands.thresholdTo)}`, hue: "gold" as const },
        { name: "Fast", text: `quicker than ${clock(bands.fastTo)}`, hue: "coral" as const },
      ],
      sampleTrend: SAMPLE_CSS_TREND,
    };
  })();

  const records: SwimPage["records"] = !bests.length ? SAMPLE_SWIM_RECORDS : {
    chip: fresh.length ? chip("attention", fresh.length === 1 ? "New record" : `${fresh.length} new`) : null,
    headline: fresh.length === 1 ? `New record: ${fresh[0].name} in ${clock(fresh[0].seconds, 2)}` : fresh.length > 1 ? `${fresh.length} swim records in the last 2 weeks` : "Your swim records",
    sub: fresh.length === 1 && fresh[0].at ? `On ${weekdayOf(fresh[0].at)} ${dayMonthOf(fresh[0].at)}.` : null,
    rows: bests.map((b) => ({ name: b.name, value: clock(b.seconds, 2), date: b.at ? dayMonthOf(b.at) : "", fresh: isFresh(b, now) })),
  };

  /* Pace per 100 m of each swim of the last 12 weeks, rests included. */
  const paced = swims.filter((x) => (x.meters ?? 0) >= 200 && x.seconds > 0 && x.at.getTime() >= now.getTime() - 84 * 86_400_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => ({ at: x.at, value: (x.seconds / (x.meters as number)) * 100 }));
  const cutoff = now.getTime() - 28 * 86_400_000;
  const paceNow = paced.filter((x) => x.at.getTime() >= cutoff).map((x) => x.value), paceThen = paced.filter((x) => x.at.getTime() < cutoff).map((x) => x.value);
  const paceDiff = paceNow.length >= 2 && paceThen.length >= 2 ? sum(paceThen) / paceThen.length - sum(paceNow) / paceNow.length : null;
  const paceChip = paceDiff == null ? null : paceDiff >= 1 ? chip("good", "Faster") : paceDiff <= -1 ? chip("attention", "Slower") : chip("neutral", "Steady");
  const latestPace = paced[paced.length - 1];
  const paceCard: SwimPage["pace"] = !latestPace ? missing("Needs a swim of 200 m or more.") : {
    chip: paceChip,
    headline: paceDiff != null && Math.abs(paceDiff) >= 1 ? `${paceDiff.toFixed(1)} s per 100 ${paceDiff > 0 ? "faster" : "slower"} than before`.replace("-", "") : `${clock(latestPace.value, 2)} /100 m on your latest swim`,
    sub: paceDiff != null ? "The last 4 weeks against the 8 before, rests included." : "Whole swims, rests included.",
    chart: paced.length >= 2 ? lineChart(paced, (v) => clock(v), `Average pace per 100 m on each swim, from ${clock(paced[0].value)} to ${clock(latestPace.value)}. Faster is higher.`, true) : null,
  };

  const figures: Figure[] = [{ value: `${thousands(meters)} m`, label: "Last 4 weeks" }, { value: String(count), label: "Swims" }];
  if (css != null) figures.push({ value: clock(css), label: "CSS /100 m" });
  const longest = swims.filter((s) => s.at.getTime() >= now.getTime() - 28 * 86_400_000).reduce((a, s) => Math.max(a, s.meters ?? 0), 0);
  if (longest > 0) figures.push({ value: `${thousands(longest)} m`, label: "Longest swim" });

  const tiles: Tile[] = [
    { label: "Speed", chip: null, value: css != null ? clock(css) : "–", unit: css != null ? "/100 m" : "", spark: null, hue: "swim", href: "#css", text: css != null ? "From your best 200 m and 400 m" : "Needs a hard 200 m and 400 m" },
    { label: "Pace", chip: paceChip, value: latestPace ? clock(latestPace.value) : "–", unit: latestPace ? "/100 m" : "", spark: paced.length > 1 ? paced.map((x) => -x.value) : null, hue: "ride", href: "#pace", text: latestPace ? "On your latest swim, rests included" : "Needs a swim of 200 m or more" },
    {
      label: "Records", chip: fresh.length ? chip("attention", "New record") : null, value: fresh[0] ? clock(fresh[0].seconds, 2) : bests.length ? String(bests.length) : "–", unit: fresh[0] ? fresh[0].name : bests.length ? "records" : "",
      spark: null, hue: "gold", href: "#records", text: fresh[0]?.at ? `On ${weekdayOf(fresh[0].at)} ${dayMonthOf(fresh[0].at)}` : bests.length ? "No new record in the last 2 weeks" : NOTHING_YET,
    },
    { label: "Volume", chip: volChip, value: thousands(meters), unit: "m", spark: volume.weeks.map((w) => w.meters), hue: "swim", href: "#now", text: `${plural(count, "swim")} in 4 weeks` },
  ];

  return {
    hero: {
      chip: `Last 4 weeks · ${thousands(meters)} m`,
      headline: change != null && change >= 0.1 ? "More time in the water." : change != null && change <= -0.1 ? "A lighter month in the water." : "Steady in the water.",
      text: `${plural(count, "swim")} in 4 weeks.${change != null && pct >= 1 ? ` ${pct}% ${change >= 0 ? "more" : "less"} than the 4 weeks before.` : ""}`,
      figures,
      lanes: volume.weeks.map((w, k) => ({ label: dayMonthOf(w.start), value: thousands(w.meters), share: w.meters / top, now: k === volume.weeks.length - 1 })),
      lanesLabel: `Metres swum in each of the last ${volume.weeks.length} weeks: ${volume.weeks.map((w) => thousands(w.meters)).join(", ")}.`,
    },
    tiles, css: cssCard, pace: paceCard, swolf: SAMPLE_SWOLF, strokes: SAMPLE_STROKES, records,
  };
}

/* ───────────── Hub ───────────── */

function buildHub(c: Context, items: SportsItems, run: RunPage | null, ride: RidePage | null, swim: SwimPage | null): SportsHub {
  const { now } = c;
  const shown = PAGE_FAMILIES.filter((f) => includesSport(c.families, f));
  const all = sportVolume(c.acts, now, 12);
  const volumes = new Map(shown.map((f) => [f, sportVolume(c.by(f), now, 12)]));
  const thisWeek = all.weeks[all.weeks.length - 1];
  const monday = weekStart(now);
  const gymWeek = items.gym.filter((w) => finite(w.start) && refToDate(w.start).getTime() >= monday.getTime() && refToDate(w.start).getTime() <= now.getTime());
  const bests = bestsOf(c.training);
  const muscles = (items.strength?.muscles ?? []).map((m) => muscleRow(m, now));
  const recovering = muscles.filter((m) => m.state === "recovering");

  const rings: HubRing[] = shown.map((f) => {
    const v = volumes.get(f) as SportVolume, w = v.weeks[v.weeks.length - 1];
    let value: string, of: string | null, percent: number | null;
    if (f === "run") { value = kmText(w.meters); of = v.usualMeters != null ? kmText(v.usualMeters) : null; percent = v.usualMeters ? (w.meters / v.usualMeters) * 100 : null; }
    else if (f === "ride") { value = hoursText(w.seconds); of = v.usualSeconds != null ? hoursText(v.usualSeconds) : null; percent = v.usualSeconds ? (w.seconds / v.usualSeconds) * 100 : null; }
    else if (f === "swim") { value = `${thousands(w.meters)} m`; of = v.usualMeters != null ? `${thousands(v.usualMeters)} m` : null; percent = v.usualMeters ? (w.meters / v.usualMeters) * 100 : null; }
    else {
      const usual = Math.round(sum(v.weeks.slice(-5, -1).map((x) => x.sessions)) / 4);
      value = plural(w.sessions, "workout"); of = usual > 0 ? String(usual) : null; percent = usual > 0 ? (w.sessions / usual) * 100 : null;
    }
    return { family: f, name: FAMILY_NAME[f], percent: percent == null ? null : Math.round(percent), value, of: of ? `of ${of}` : null, href: FAMILY_HREF[f], label: `${FAMILY_NAME[f]}: ${value}${of ? ` of ${of}` : ""} this week` };
  });

  const standouts: Standout[] = shown.map((f): Standout => {
    const fresh = bests.filter((b) => b.family === f && isFresh(b, now))[0];
    if (fresh && f !== "strength") return { family: f, title: `New record: ${fresh.name} in ${clock(fresh.seconds, 2)}`, detail: fresh.at ? `On ${weekdayOf(fresh.at)} ${dayMonthOf(fresh.at)}` : "", chip: chip("attention", "New record"), href: FAMILY_HREF[f] };
    if (f === "strength") {
      if (!muscles.length) return { family: f, title: `${rings.find((r) => r.family === f)?.value ?? "No workouts"} this week`, detail: "", chip: chip("neutral", "This week"), href: FAMILY_HREF[f] };
      const names = recovering.slice(0, 3).map((m) => m.name.toLowerCase());
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
      return recovering.length
        ? { family: f, title: `${list.charAt(0).toUpperCase()}${list.slice(1)} ${recovering.length === 1 ? "is" : "are"} still recovering`, detail: `${muscles.filter((m) => m.state === "ready").length} of ${muscles.length} muscles ready`, chip: chip("neutral", "Recovering"), href: FAMILY_HREF[f] }
        : { family: f, title: `All ${muscles.length} muscles are ready`, detail: "", chip: chip("good", "Ready"), href: FAMILY_HREF[f] };
    }
    const page = f === "run" ? run?.much : f === "ride" ? ride?.much : null;
    if (page) return { family: f, title: page.headline, detail: page.sub?.replace(/\.$/, "") ?? "", chip: page.chip ?? chip("neutral", "This week"), href: FAMILY_HREF[f] };
    const tile = swim?.tiles[3];
    return { family: f, title: swim ? `${swim.hero.figures[0].value} swum in the last 4 weeks` : "", detail: tile?.text ?? "", chip: tile?.chip ?? chip("neutral", "Last 4 weeks"), href: FAMILY_HREF[f] };
  }).filter((s) => s.title);

  /* Hours a week, stacked by sport */
  const plannedHours = sum(shown.flatMap((f) => c.planned(f)).map((p) => p.seconds)) / 3600;
  const weeks: HoursWeek[] = all.weeks.map((w, k) => {
    const parts = shown.map((f) => ({ family: f, hours: ((volumes.get(f) as SportVolume).weeks[k]?.seconds ?? 0) / 3600 }));
    const week: HoursWeek = { start: dayKey(w.start), label: String(w.start.getDate()), total: sum(parts.map((p) => p.hours)), parts, planned: 0, now: k === all.weeks.length - 1 };
    if (k === 0 || w.start.getMonth() !== all.weeks[k - 1].start.getMonth()) week.sub = monthOf(w.start);
    if (week.now) week.planned = plannedHours;
    return week;
  });
  const biggest = weeks.reduce((a, w) => (w.total > a.total ? w : a), weeks[0]);

  /* Sport cards */
  const cards: HubCard[] = shown.map((f): HubCard => {
    const v = volumes.get(f) as SportVolume, w = v.weeks[v.weeks.length - 1];
    if (f === "run" && run) {
      const planned = sum(c.planned("run").map((p) => p.meters));
      return {
        family: f, name: FAMILY_NAME[f], href: FAMILY_HREF[f], spark: v.weeks.slice(-8).map((x) => x.meters),
        headline: planned > 0 ? `On plan for ${kmText(w.meters + planned)}` : `${kmText(w.meters)} so far this week`,
        figures: [{ value: String(w.sessions), label: "Runs" }, ...run.tiles.filter((t) => t.label === "Your engine" && t.value !== "–").map((t) => ({ value: t.value, label: t.unit })), ...run.hero.figures.filter((x) => x.label === "VO₂ max")].slice(0, 3),
      };
    }
    if (f === "ride" && ride) {
      return {
        family: f, name: FAMILY_NAME[f], href: FAMILY_HREF[f], spark: v.weeks.slice(-8).map((x) => x.seconds),
        headline: ride.much.chip ? `${ride.much.chip.text}, ${hoursText(w.seconds)} so far` : `${hoursText(w.seconds)} so far this week`,
        figures: ride.hero.figures.filter((x) => x.label !== "This week").slice(0, 3).map((x) => (x.label === "Cycling VO₂ max" ? { ...x, label: "VO₂ max" } : x)),
      };
    }
    if (f === "swim" && swim) {
      return { family: f, name: FAMILY_NAME[f], href: FAMILY_HREF[f], spark: v.weeks.slice(-8).map((x) => x.meters), headline: swim.hero.headline.replace(/\.$/, ""), figures: [{ value: String(w.sessions), label: "Swims" }, ...swim.hero.figures.filter((x) => x.label !== "Swims" && x.label !== "Last 4 weeks")].slice(0, 3) };
    }
    const ready = muscles.filter((m) => m.state === "ready").length;
    const volumeByWeek = v.weeks.slice(-8).map((x) => sum(items.gym.filter((g) => finite(g.start) && refToDate(g.start).getTime() >= x.start.getTime() && refToDate(g.start).getTime() < addDays(x.start, 7).getTime()).map(volumeKg)));
    return {
      family: f, name: FAMILY_NAME[f], href: FAMILY_HREF[f], spark: volumeByWeek.some((x) => x > 0) ? volumeByWeek : v.weeks.slice(-8).map((x) => x.seconds),
      headline: muscles.length ? `${ready} of ${muscles.length} muscles ready` : `${plural(w.sessions, "workout")} this week`,
      figures: [{ value: String(Math.max(w.sessions, gymWeek.length)), label: "Workouts" }, ...(gymWeek.length ? [{ value: String(sum(gymWeek.map(doneSetCount))), label: "Sets" }, { value: `${thousands(sum(gymWeek.map(volumeKg)))} kg`, label: "Volume" }] : [])],
    };
  });

  /* Other sports of the last 90 days */
  const from = now.getTime() - 90 * 86_400_000;
  const others = new Map<string, { sessions: number; seconds: number; last: Date }>();
  for (const a of c.acts) {
    if (shown.includes(a.family) || a.at.getTime() < from || a.at.getTime() > now.getTime() || isBlip(a)) continue;
    const name = SPORT_TITLE[a.kind as NativeSport] ?? "Workout";
    const row = others.get(name) ?? { sessions: 0, seconds: 0, last: a.at };
    row.sessions++; row.seconds += a.seconds; if (a.at.getTime() > row.last.getTime()) row.last = a.at;
    others.set(name, row);
  }

  /* Headline */
  const active = shown.map((f) => ({ f, seconds: (volumes.get(f) as SportVolume).weeks[11]?.seconds ?? 0 })).sort((a, b) => b.seconds - a.seconds);
  const waiting = shown.find((f) => ((volumes.get(f) as SportVolume).weeks[11]?.sessions ?? 0) === 0 && c.planned(f).length > 0);
  const headline = !(thisWeek.seconds > 0) ? "A fresh week."
    : `${FAMILY_NAME[active[0].f]} is carrying the week.${waiting ? ` ${FAMILY_NAME[waiting]} is still to come.` : ""}`;
  const sportsDone = active.filter((a) => a.seconds > 0).length;
  const usualAll = all.usualSeconds;
  const figures: Figure[] = [{ value: hoursText(thisWeek.seconds), label: "So far this week" }];
  if (usualAll != null) figures.push({ value: hoursText(usualAll), label: "Your usual week" });
  figures.push({ value: String(thisWeek.sessions), label: "Workouts" });

  return {
    day: `${weekdayOf(now)} ${dayMonthOf(now)}`,
    range: monday.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() ? `This week · ${weekdayOf(now)} ${dayMonthOf(now)}` : `This week · ${weekdayOf(monday)} ${monday.getDate()}${monday.getMonth() === now.getMonth() ? "" : ` ${monthOf(monday)}`} to ${weekdayOf(now)} ${dayMonthOf(now)}`,
    headline,
    text: thisWeek.seconds > 0 ? `${hoursText(thisWeek.seconds, true)} across ${plural(sportsDone, "sport")} so far${plannedHours > 0 ? `, with ${hoursText(plannedHours * 3600, true)} more planned before Sunday` : ""}.` : null,
    figures, rings, standouts,
    hours: {
      weeks, families: shown, planned: plannedHours > 0, total: `${hoursText(sum(weeks.slice(-4).map((w) => w.total)) * 3600, true)} in the last 4 weeks`,
      label: `Hours of training in each of the last ${weeks.length} weeks, stacked by sport. The biggest week was ${biggest.total.toFixed(1)} hours; this week stands at ${weeks[weeks.length - 1].total.toFixed(1)} hours${plannedHours > 0 ? ` with ${plannedHours.toFixed(1)} more planned` : ""}.`,
    },
    cards,
    also: [...others.entries()].sort((a, b) => b[1].seconds - a[1].seconds).map(([name, r]) => ({ name, sessions: plural(r.sessions, "session"), time: hoursText(r.seconds, true), last: dayMonthOf(r.last) })),
  };
}

/** Everything the Sports section shows, for the athlete as of `now`. */
export function sportsFromItems(items: SportsItems, now: Date): Sports {
  const acts = items.activities.map(actFromNative).filter((a): a is SportAct => a != null && a.at.getTime() <= now.getTime());
  const byId = new Map(acts.map((a) => [a.id, a]));
  const recordings = new Map<string, Recording>();
  for (const d of items.details) {
    const act = byId.get(d.id);
    const rec = act && d.body ? recordingFrom(act, d.body) : null;
    if (rec) recordings.set(rec.id, rec);
  }
  const families = detectSports(acts, now);
  const today = dayKey(now), sunday = dayKey(addDays(weekStart(now), 6));
  const c: Context = {
    now, acts, recordings, families, training: items.training,
    by: (family) => acts.filter((a) => a.family === family),
    thresholdHr: positive(items.training?.thresholdHr),
    weightKg: positive(items.body?.weightKg),
    planned: (family) => items.planned
      .filter((p) => p.family === family && p.day <= sunday && (p.day > today || (p.day === today && !acts.some((a) => a.family === family && dayKey(a.at) === today))))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
  const has = (f: Family) => includesSport(families, f) && c.by(f).length > 0;
  const run = has("run") ? buildRun(c) : null, ride = has("ride") ? buildRide(c) : null, swim = has("swim") ? buildSwim(c) : null;
  return { families, hub: buildHub(c, items, run, ride, swim), run, ride, swim };
}
