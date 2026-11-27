// Synced items → the Sports hub and the Running, Riding and Swimming pages. Pure: plain bodies and `now` in, the
// screens' types out. Headlines and section names follow the phone (SportFindings.swift, SwimFindings.swift,
// SportPages.swift); the numbers come from src/lib/sports.ts.
import type {
  Bar, BarChart, Chip, Figure, HoursWeek, HubCard, HubRing, LineChart, Missing, PowerTile, RidePage, RunPage, SplitShare, Sports, SportsHub, Standout, SwimPage, Tile,
} from "@/data/sports";
import type { HubCalendarDay } from "@/data/hub";
import { hoursMinutes } from "@/lib/calendar";
import { language, msg, t, tx } from "@/lib/i18n";
import { clock, dayKey, thousands } from "@/lib/format";
import {
  distanceIn, distanceUnit, heightIn, heightUnit, height, imperial, paceText, swimDistance, swimIn, swimPaceIn, swimPaceText, swimPaceUnitLabel, swimUnit, weight, weightTotal,
} from "@/lib/units";
import {
  addDays, atBest, cogganZones, criticalSwimPace, cyclingVo2Estimate, dayMonthOf, detectSports, durationName, efficiencyTrend, ftpTrend, hoursText, includesSport,
  intensityBalance, isBlip, isSpike, kmText, monthOf, powerCurve, powerZoneSeconds, rideClimbing, runDurability, runTypes, sharePercents, shortfall,
  spikeCheck, sportVolume, standing, swimBands, volumeChange, wattsPerBeat, weekdayLong, weekdayOf, weekStart,
  type Family, type IntensityBalance, type Recording, type RunKind, type SportAct, type SportVolume, type Standing,
} from "@/lib/sports";
import { SPORT_TITLE } from "./geo";
import { refToDate, type ActivityDetailBody, type NativeActivity, type NativeGymWorkout, type NativeSport, type ViewBodyBody, type ViewStrengthBody, type ViewTrainingBody } from "./native";
import { sampleBiggestClimb, sampleCss, sampleCssTrend, sampleRunTrend, sampleStrokes, sampleSwimRecords, sampleSwolf } from "@/data/sample/sportsReadings";
import { doneSetCount, muscleRow, NOTHING_YET, volumeKg } from "./strength";

const FAMILY_OF: Record<NativeSport, Family> = {
  run: "run", indoorRun: "run", trailRun: "run", track: "run", bike: "ride", indoorBike: "ride", poolSwim: "swim", openWater: "swim",
  strength: "strength", walk: "walk", hike: "walk", cardio: "other", ski: "other", row: "other", multisport: "other", other: "other",
};
/** English, translated where shown: `t(FAMILY_NAME[f])`. */
export const FAMILY_NAME: Record<Family, string> = { run: msg("Running"), ride: msg("Riding"), swim: msg("Swimming"), strength: msg("Strength"), walk: msg("Walking"), other: msg("Other") };
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
const missing = (text: string = t(NOTHING_YET)): Missing => ({ missing: text });
const chip = (tone: Chip["tone"], text: string): Chip => ({ tone, text });
const percentText = (v: number) => `${Math.round(Math.abs(v))}%`;
const swimsIn4 = (n: number) => (n === 1 ? t("1 swim in 4 weeks") : t("{n} swims in 4 weeks", { n }));
const qualityIn4 = (n: number) => (n === 1 ? t("1 quality run in 4 weeks") : t("{n} quality runs in 4 weeks", { n }));

/** Under the quality-run headline: how many of the runs were quality, and the easy share when known. */
function qualitySub(quality: number, known: number, easyPercent: number | null): string {
  const vars = { n: known, percent: easyPercent ?? 0 };
  if (quality === known && known === 1) return easyPercent == null ? t("Your one run was tempo or hard.") : t("Your one run was tempo or hard; {percent}% of your running time was easy.", vars);
  if (quality === known) return easyPercent == null ? t("All {n} runs were tempo or hard.", vars) : t("All {n} runs were tempo or hard; {percent}% of your running time was easy.", vars);
  if (known === 1) return easyPercent == null ? t("Out of 1 run.") : t("Out of 1 run; {percent}% of your running time was easy.", vars);
  return easyPercent == null ? t("Out of {n} runs.", vars) : t("Out of {n} runs; {percent}% of your running time was easy.", vars);
}

export function actFromNative(n: NativeActivity): SportAct | null {
  if (!finite(n.start)) return null;
  return {
    id: n.id, at: refToDate(n.start), family: FAMILY_OF[n.sport] ?? "other", kind: n.sport,
    name: typeof n.name === "string" && n.name.trim() ? n.name : t(SPORT_TITLE[n.sport] ?? SPORT_TITLE.other),
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
  if (plannedOnTop) return chip("good", t("On plan"));
  switch (s.kind) {
    case "more": return chip("attention", t("Big week"));
    case "less": return chip("attention", t("Light week"));
    case "level": return chip("good", t("On track"));
    default: return null;
  }
}

function splitOf(balance: IntensityBalance): SplitShare[] {
  const [low, moderate, high] = sharePercents(balance);
  return [
    { name: t("Easy"), percent: low, detail: hoursText(balance.low, true), hue: "run" },
    { name: t("Moderate"), percent: moderate, detail: hoursText(balance.moderate, true), hue: "gold" },
    { name: t("Hard"), percent: high, detail: hoursText(balance.high, true), hue: "coral" },
  ];
}

const balanceChip = (b: IntensityBalance): Chip => (b.pattern === "threshold" || b.pattern === "high" ? chip("attention", t("Hard block")) : b.pattern === "base" ? chip("neutral", t("All easy")) : chip("good", t("In range")));

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

const KIND_NAME: Record<RunKind, string> = { easy: msg("Easy"), long: msg("Long"), tempo: msg("Tempo"), hard: msg("Hard") };

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
  const km = (m: number) => distanceIn(m).toFixed(1);
  const mi = imperial();

  const weeksChart = (): BarChart => ({
    bars: weekBars(volume, (w) => w.meters, km, plannedM),
    line: usual != null ? { value: usual, text: t("Usual, {distance}", { distance: kmText(usual) }) } : null,
    planned: plannedM > 0,
    label: plannedM > 0 && usual != null
      ? (mi ? t("Miles run in each of the last {weeks} weeks, with {done} so far this week and {planned} more planned, against the usual week of {usual}.", { weeks: volume.weeks.length, done: km(week.meters), planned: km(plannedM), usual: kmText(usual) })
        : t("Kilometres run in each of the last {weeks} weeks, with {done} so far this week and {planned} more planned, against the usual week of {usual}.", { weeks: volume.weeks.length, done: km(week.meters), planned: km(plannedM), usual: kmText(usual) }))
      : plannedM > 0 ? (mi ? t("Miles run in each of the last {weeks} weeks, with {done} so far this week and {planned} more planned.", { weeks: volume.weeks.length, done: km(week.meters), planned: km(plannedM) })
        : t("Kilometres run in each of the last {weeks} weeks, with {done} so far this week and {planned} more planned.", { weeks: volume.weeks.length, done: km(week.meters), planned: km(plannedM) }))
      : usual != null ? (mi ? t("Miles run in each of the last {weeks} weeks, with {done} so far this week, against the usual week of {usual}.", { weeks: volume.weeks.length, done: km(week.meters), usual: kmText(usual) })
        : t("Kilometres run in each of the last {weeks} weeks, with {done} so far this week, against the usual week of {usual}.", { weeks: volume.weeks.length, done: km(week.meters), usual: kmText(usual) }))
      : mi ? t("Miles run in each of the last {weeks} weeks, with {done} so far this week.", { weeks: volume.weeks.length, done: km(week.meters) })
        : t("Kilometres run in each of the last {weeks} weeks, with {done} so far this week.", { weeks: volume.weeks.length, done: km(week.meters) }),
  });

  const days: BarChart = {
    bars: volume.days.map((d, k) => {
      const plan = k >= volume.todayIndex ? sum(planned.filter((p) => p.day === dayKey(d.date)).map((p) => p.meters)) : 0;
      const bar: Bar = { value: d.meters, top: d.meters > 0 ? km(d.meters) : "", label: weekdayOf(d.date), now: k === volume.todayIndex };
      if (plan > 0) bar.planned = plan;
      return bar;
    }),
    line: null, planned: plannedM > 0,
    label: t("This week by day: {days}.", { days: volume.days.map((d) => `${weekdayOf(d.date)} ${km(d.meters)} ${distanceUnit()}`).join(", ") }),
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
      line: { value: spikes.nextLimit, text: t("10% limit, {distance}", { distance: kmText(spikes.nextLimit) }) }, planned: false,
      label: t("Each run of the last 4 weeks against the 10% limit of {limit}: the longest was {longest}, the latest {latest}.", { limit: kmText(spikes.nextLimit), longest: kmText(spikes.recentLongest), latest: kmText(latest.meters) }),
    },
  } : null;

  const total = kmText(week.meters);
  const muchHeadline = stand.kind === "none" ? t("No runs yet this week")
    : stand.kind === "more" ? t("{total} this week, {by} more than usual", { total, by: kmText(stand.by) })
    : stand.kind === "less" ? t("{total} this week, {by} less than usual", { total, by: kmText(stand.by) })
    : stand.kind === "level" ? t("{total} this week, about your usual", { total }) : t("{total} so far this week", { total });
  const muchChip = volumeChip(stand, plannedM > 0 && usual != null && week.meters + plannedM >= usual * 0.9);

  /* Easy and hard */
  const [lowPct] = balance ? sharePercents(balance) : [0];
  const hard: RunPage["hard"] = !types || types.known === 0
    ? missing(t("Needs three runs with heart rate in the last 4 weeks."))
    : {
      chip: balance ? balanceChip(balance) : null,
      headline: types.quality > 0 ? qualityIn4(types.quality) : types.weeksWithoutQuality >= 2 ? t("No quality run in {weeks} weeks", { weeks: types.weeksWithoutQuality }) : t("Mostly easy running"),
      sub: types.quality > 0
        ? qualitySub(types.quality, types.known, balance ? lowPct : null)
        : t("Your recent runs were easy or long. That suits a base block; if you're racing soon, this is the gap to look at."),
      split: balance ? splitOf(balance) : [],
      // Days run Monday (0) to Sunday (6); `today` marks the current week so later days show as still to come.
      weeks: types.weeks.map((w) => ({
        label: dayMonthOf(w.start),
        runs: w.runs.map((r) => ({ kind: r.kind ? tx("run kind", KIND_NAME[r.kind]) : t("Unknown"), day: (r.at.getDay() + 6) % 7 })),
        today: w.start.getTime() === weekStart(now).getTime() ? (now.getDay() + 6) % 7 : null,
      })),
    };

  /* Engine */
  const predictions = (c.training?.predictions ?? []).filter((p) => p != null && p.seconds > 0 && p.meters > 0).sort((a, b) => a.meters - b.meters);
  const runBests = bestsOf(c.training).filter((b) => b.family === "run").sort((a, b) => a.meters - b.meters);
  const marks: Figure[] = [];
  const thresholdPace = positive(c.training?.thresholdPaceSecPerKm);
  if (thresholdPace != null) marks.push({ value: paceText(thresholdPace, 2), label: t("Threshold pace") });
  if (c.thresholdHr != null) marks.push({ value: `${Math.round(c.thresholdHr)} bpm`, label: t("Threshold heart rate") });
  const engine: RunPage["engine"] = !predictions.length && vo2 == null && !runBests.length ? missing() : {
    chip: null,
    headline: tenK ? t("{race} prediction: {time}", { race: "10K", time: clock(tenK.seconds) }) : vo2 != null ? `VO₂ max ${Math.round(vo2)}` : predictions.length ? t("{race} prediction: {time}", { race: predictions[0].name, time: clock(predictions[0].seconds) }) : t("Your personal bests"),
    sub: null, trend: null,
    predictions: predictions.map((p) => ({ name: p.name, time: clock(p.seconds), change: null, focus: p === tenK })),
    vo2: vo2 != null ? String(Math.round(vo2)) : null, vo2Change: null, sampleTrend: sampleRunTrend(), marks,
    bests: runBests.map((b) => ({ name: b.name, value: clock(b.seconds, 2), date: b.at ? dayMonthOf(b.at) : "", fresh: isFresh(b, now) })),
  };

  /* Durability */
  const lastPoint = durability?.points[durability.points.length - 1];
  const durabilityCard: RunPage["durability"] = !durability || !lastPoint
    ? missing(t("Needs three runs of an hour or more with their recording."))
    : {
      chip: durability.heldInARow > 0 ? chip("good", t("Holding")) : chip("attention", t("Drifting")),
      headline: durability.heldInARow > 1 ? t("Your last {n} long runs held under 5%", { n: durability.heldInARow }) : durability.heldInARow === 1 ? t("Your last long run held under 5%") : t("Your last long run drifted {percent}%", { percent: lastPoint.percent.toFixed(1) }),
      sub: durability.heldInARow > 0 ? t("{percent}% over {time} on the latest. Your base covers that distance at this pace.", { percent: lastPoint.percent.toFixed(1), time: clock(lastPoint.seconds) })
        : t("Over {time}. Under 5% suggests your base covers the distance; heat, hills and tired days raise it.", { time: clock(lastPoint.seconds) }),
      points: durability.points.map((p) => ({ top: `${p.percent.toFixed(1)}%`, label: dayMonthOf(p.at), percent: p.percent, held: p.percent < 5 })),
      label: t("Heart-rate drift on the last {n} long runs: {drifts}, against the 5% line.", { n: durability.points.length, drifts: durability.points.map((p) => `${p.percent.toFixed(1)}%`).join(", ") }),
    };

  /* Efficiency */
  const effCard: RunPage["efficiency"] = !efficiency || efficiency.points.length < 2
    ? missing(t("Needs three easy runs with heart rate in the last 12 weeks."))
    : {
      chip: efficiency.change == null ? null : efficiency.change >= 1 ? chip("good", t("Up {percent}", { percent: percentText(efficiency.change) })) : efficiency.change <= -1 ? chip("attention", t("Down {percent}", { percent: percentText(efficiency.change) })) : chip("neutral", t("Steady")),
      headline: efficiency.change == null ? t("{value} m per heartbeat on your easy runs", { value: efficiency.points[efficiency.points.length - 1].value.toFixed(2) })
        : efficiency.change >= 1 ? t("Easy pace per heartbeat is up {percent}", { percent: percentText(efficiency.change) })
        : efficiency.change <= -1 ? t("Easy pace per heartbeat is down {percent}", { percent: percentText(efficiency.change) }) : t("Easy pace per heartbeat is steady"),
      sub: efficiency.change == null ? null : t("The last 4 weeks against the 8 before."),
      chart: lineChart(efficiency.points.map((p) => ({ at: p.start, value: p.value })), (v) => v.toFixed(2),
        t("Metres per heartbeat on easy runs, week by week, from {from} to {to}.", { from: efficiency.points[0].value.toFixed(2), to: efficiency.points[efficiency.points.length - 1].value.toFixed(2) })),
    };

  /* Hero */
  const fourWeeks = volume.weeks.slice(-5, -1).map((w) => w.meters);
  const building = fourWeeks.length === 4 && fourWeeks.every((m, k) => k === 0 || m >= fourWeeks[k - 1] * 0.95) && fourWeeks[3] > fourWeeks[0];
  const lead = stand.kind === "none" ? t("No runs yet this week") : stand.kind === "more" ? t("A big week") : stand.kind === "less" ? t("A light week") : stand.kind === "level" ? t("Right on your usual week") : building ? t("A steady build") : t("A steady week");
  const heroText = plannedM > 0 ? (() => {
    const still = planned.map((p) => t("{workout} on {day}", { workout: p.meters > 0 ? kmText(p.meters) : p.name, day: weekdayLong(new Date(`${p.day}T12:00`)) })).join(t(" and "));
    const make = kmText(week.meters + plannedM);
    const first = week.sessions === 1 ? t("1 run in, with {planned} still planned.", { planned: still }) : t("{n} runs in, with {planned} still planned.", { n: week.sessions, planned: still });
    const then = usual == null ? t("That would make {total}.", { total: make })
      : week.meters + plannedM >= usual ? t("That would make {total}, {by} over your usual week.", { total: make, by: kmText(Math.abs(week.meters + plannedM - usual)) })
      : t("That would make {total}, {by} under your usual week.", { total: make, by: kmText(Math.abs(week.meters + plannedM - usual)) });
    return `${first} ${then}`;
  })() : null;
  const figures: Figure[] = [{ value: total, label: t("This week") }, { value: String(week.sessions), label: t("Runs") }, { value: clock(week.seconds), label: t("Time") }];
  if (vo2 != null) figures.push({ value: String(Math.round(vo2)), label: "VO₂ max" });

  /* Tiles */
  const tiles: Tile[] = [
    {
      label: t("Volume"), chip: muchChip, value: km(week.meters), unit: distanceUnit(), spark: volume.weeks.map((w) => w.meters), hue: "run", href: "#much",
      text: plannedM > 0 ? t("{planned} planned takes the week to {total}", { planned: kmText(plannedM), total: kmText(week.meters + plannedM) }) : usual != null ? t("Your usual week is {usual}", { usual: kmText(usual) }) : week.sessions === 1 ? t("1 run") : t("{n} runs", { n: week.sessions }),
    },
    {
      label: t("Long runs"), chip: latest ? (isSpike(latest) ? chip("attention", t("Big jump")) : chip("good", t("Safe to build"))) : null,
      value: spikes?.nextLimit != null ? km(spikes.nextLimit) : "–", unit: distanceUnit(), spark: volume.weeks.map((w) => w.longestMeters), hue: "ride", href: "#much",
      text: spikes?.nextLimit != null ? t("Your next run can go up to {distance}", { distance: kmText(spikes.nextLimit) }) : t("No runs in the last 8 weeks"),
    },
    {
      label: t("Easy vs hard"), chip: balance ? balanceChip(balance) : null, value: balance ? String(lowPct) : "–", unit: balance ? t("% easy") : "", spark: null, hue: "run", href: "#hard",
      text: types && types.known > 0 ? (types.quality === 1 ? t("1 quality run in 4 weeks, out of {known}", { known: types.known }) : t("{n} quality runs in 4 weeks, out of {known}", { n: types.quality, known: types.known })) : t("Needs runs with heart rate"),
    },
    {
      label: t("Your engine"), chip: null, value: tenK ? clock(tenK.seconds) : vo2 != null ? String(Math.round(vo2)) : "–", unit: tenK ? "10K" : vo2 != null ? "VO₂ max" : "", spark: null, hue: "run", href: "#engine",
      text: tenK && vo2 != null ? `VO₂ max ${Math.round(vo2)}` : tenK || vo2 != null ? t("From COROS") : t(NOTHING_YET),
    },
  ];

  /* Coach's read: rules, not a model. */
  const next = planned[0];
  const easyBpm = c.thresholdHr != null ? Math.floor(c.thresholdHr * 0.9) : null;
  const easyUnder = easyBpm != null ? t("Easy is under {bpm} bpm", { bpm: easyBpm }) : null;
  const upTo = spikes?.nextLimit != null ? t("Up to {distance}", { distance: kmText(spikes.nextLimit) }) : null;
  const nextChips = [easyUnder, upTo].filter((x): x is string => x != null);
  const facts: Figure[] = [];
  if (usual != null) facts.push({ label: t("4-week average"), value: t("{distance} a week", { distance: kmText(usual) }) });
  if (types && types.known > 0) facts.push({ label: t("Quality runs"), value: t("{n} of {total}", { n: types.quality, total: types.known }) });
  if (lastPoint) facts.push({ label: t("Latest long-run drift"), value: `${lastPoint.percent.toFixed(1)}%` });
  const coachHeadline = latest && isSpike(latest) ? t("Your last run was a big jump.")
    : types && types.known > 0 && types.quality === 0 ? t("All easy lately.")
    : balance && (balance.pattern === "threshold" || balance.pattern === "high") ? t("A lot of your running is hard.")
    : types && types.quality > 0 ? t("The hard work is in the right place.") : t("A steady week.");

  return {
    hero: {
      ring: usual != null && usual > 0 ? { percent: Math.round((week.meters / usual) * 100), label: t("{done} of {usual} run this week", { done: km(week.meters), usual: kmText(usual) }) } : null,
      chip: t("This week · {total} so far", { total }),
      headline: tenK ? t("{lead}, on course for a {time} 10K.", { lead, time: clock(tenK.seconds) }) : t("{lead}.", { lead }),
      text: heroText, figures, chart: weeksChart(), chartTitle: mi ? t("Miles a week") : t("Kilometres a week"),
    },
    tiles,
    much: { chip: muchChip, headline: muchHeadline, sub: usual != null ? t("Your usual week is {usual}.", { usual: kmText(usual) }) : null, weeks: weeksChart(), days, long },
    coach: {
      headline: coachHeadline,
      next: next ? { title: t("{workout} on {day}", { workout: next.name, day: weekdayLong(new Date(`${next.day}T12:00`)) }), chips: nextChips } : nextChips.length ? { title: upTo ?? t("Easy under {bpm} bpm", { bpm: easyBpm ?? 0 }), chips: upTo != null && easyUnder != null ? [easyUnder] : [] } : null,
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
    : best.length === 1 ? t("At your best at {durations}.", { durations: durationName(best[0].seconds) })
    : best.length > 1 && unbroken ? (best[0].seconds < 60
      ? t("At your best from {from} to {to}.", { from: durationName(best[0].seconds), to: durationName(best[best.length - 1].seconds) })
      : t("At your best from {from} to {to} minutes.", { from: Math.round(best[0].seconds / 60), to: Math.round(best[best.length - 1].seconds / 60) }))
    : best.length > 1 ? t("At your best at {durations}.", { durations: best.map((r) => durationName(r.seconds)).join(", ") }) : t("Your best power in the last 90 days.");
  const curveTiles: PowerTile[] = (curve ?? []).map((r) => {
    const short = shortfall(r);
    const watts = r.recent ?? r.best;
    return {
      name: durationName(r.seconds), watts: `${Math.round(watts)} W`, perKg: perKg(watts) ? `${perKg(watts)} W/kg` : null,
      note: short == null ? t("Best ever") : short <= 1 ? t("Best") : `−${Math.round(short)}%`, best: short != null && short <= 1,
    };
  });

  const total = hoursText(week.seconds, true);
  const muchHeadline = stand.kind === "none" ? t("No rides yet this week")
    : stand.kind === "more" ? t("{total} on the bike, {by} more than usual", { total, by: hoursText(stand.by, true) })
    : stand.kind === "less" ? t("{total} on the bike, {by} less than usual", { total, by: hoursText(stand.by, true) })
    : stand.kind === "level" ? t("{total} on the bike, about your usual", { total }) : t("{total} on the bike so far this week", { total });
  const muchChip = volumeChip(stand, plannedS > 0 && usual != null && week.seconds + plannedS >= usual * 0.9)
    ?? (usual != null && week.seconds < usual * 0.5 && daysLeft(volume) <= 3 && week.seconds > 0 ? chip("attention", t("Light week")) : null);

  const figures: Figure[] = [];
  if (ftp != null) figures.push({ value: `${Math.round(ftp)} W`, label: setFtp != null ? "FTP" : t("Estimated FTP") });
  if (ftp != null && perKg(ftp)) figures.push({ value: perKg(ftp) as string, label: "W/kg" });
  if (vo2Estimate != null) figures.push({ value: String(Math.round(vo2Estimate)), label: t("Cycling VO₂ max") });
  figures.push({ value: hoursText(week.seconds), label: t("This week") });

  /* Climbing */
  const climbNow = climbing ? climbing.weeks[climbing.weeks.length - 1].meters : 0;
  const climbLast = climbing && climbing.weeks.length > 1 ? climbing.weeks[climbing.weeks.length - 2].meters : 0;
  const climbCard: RidePage["climb"] = !climbing || !climbing.weeks.some((w) => w.meters > 0) ? missing(t("Needs an outdoor ride with its climbing.")) : {
    chip: climbing.isNotable ? chip("good", t("Big week")) : null,
    headline: !(climbNow > 0) ? t("No climbing yet this week")
      : climbing.isNotable && climbing.moreBefore ? t("{height} this week, your most since {date}", { height: height(climbNow), date: dayMonthOf(climbing.moreBefore) }) : t("{height} climbed this week", { height: height(climbNow) }),
    sub: climbLast > 0 ? t("Last week: {height}.", { height: height(climbLast) }) : null, sampleBiggest: sampleBiggestClimb(),
    weeks: {
      bars: climbing.weeks.map((w, k) => {
        const bar: Bar = { value: w.meters, top: w.meters > 0 ? thousands(heightIn(w.meters)) : "", label: String(w.start.getDate()), now: k === climbing.weeks.length - 1 };
        if (k === 0 || w.start.getMonth() !== climbing.weeks[k - 1].start.getMonth()) bar.sub = monthOf(w.start);
        return bar;
      }),
      line: null, planned: false,
      label: imperial()
        ? t("Feet climbed in each of the last {weeks} weeks: {values}.", { weeks: climbing.weeks.length, values: climbing.weeks.map((w) => thousands(heightIn(w.meters))).join(", ") })
        : t("Metres climbed in each of the last {weeks} weeks: {values}.", { weeks: climbing.weeks.length, values: climbing.weeks.map((w) => thousands(w.meters)).join(", ") }),
    },
  };

  /* Power zones */
  const zones: RidePage["zones"] = ftp == null || !zoneSeconds ? missing(t("Needs a ride with a power meter in the last 4 weeks.")) : (() => {
    const all = sum(zoneSeconds);
    const share = zoneSeconds.map((s) => (s / all) * 100);
    const low = share[0] + share[1], mid = share[2] + share[3], high = share[4] + share[5] + share[6];
    const defs = cogganZones(ftp);
    return {
      chip: low >= 65 ? chip("good", t("In range")) : chip("attention", t("Hard block")),
      headline: low >= 65 ? t("Mostly easy riding, as it should be") : mid >= high ? t("A lot of your riding is in the middle") : t("Much of your riding is hard"),
      sub: t("Over the last 4 weeks: {low}% in zones 1–2, {mid}% in 3–4 and {high}% in 5–7.", { low: Math.round(low), mid: Math.round(mid), high: Math.round(high) }),
      rows: defs.map((z, k) => ({
        zone: `Z${z.zone}`, name: z.name, percent: share[k], hue: ZONE_HUE[k],
        range: z.from == null ? t("under {watts} W", { watts: (z.to as number) + 1 }) : z.to == null ? t("over {watts} W", { watts: z.from - 1 }) : `${z.from}–${z.to} W`,
        text: `${share[k] >= 10 || share[k] === 0 ? Math.round(share[k]) : share[k].toFixed(1)}%`,
      })),
    };
  })();

  /* FTP */
  const gain = trend.length >= 2 ? trend[trend.length - 1].watts - trend[0].watts : null;
  const ftpChip = gain == null ? null : gain >= 3 ? chip("good", t("Rising")) : gain <= -3 ? chip("attention", t("Falling")) : chip("neutral", t("Steady"));
  const ftpCard: RidePage["ftp"] = ftp == null ? missing(t("Needs a ride with a power meter.")) : {
    chip: ftpChip,
    headline: setFtp != null ? `FTP: ${Math.round(ftp)} W` : t("Estimated FTP: {watts} W", { watts: Math.round(ftp) }),
    sub: `${setFtp != null ? t("As set on your watch.") : t("95% of your best 20 minutes in the last 90 days.")}${gain != null && Math.abs(gain) >= 3
      ? ` ${gain > 0 ? t("Your best 20 minutes point to {watts} W more than in the 4 weeks to {date}.", { watts: Math.round(Math.abs(gain)), date: dayMonthOf(trend[0].end) }) : t("Your best 20 minutes point to {watts} W less than in the 4 weeks to {date}.", { watts: Math.round(Math.abs(gain)), date: dayMonthOf(trend[0].end) })}` : ""}`,
    trend: trend.length >= 2 ? lineChart(trend.map((p) => ({ at: p.end, value: p.watts })), (v) => `${Math.round(v)} W`,
      t("95% of your best 20 minutes in each 4 weeks, from {from} W to {to} W.", { from: Math.round(trend[0].watts), to: Math.round(trend[trend.length - 1].watts) })) : null,
    figures: [
      { value: `${Math.round(ftp)} W`, label: setFtp != null ? "FTP" : t("Estimated FTP") },
      ...(perKg(ftp) ? [{ value: perKg(ftp) as string, label: "W/kg" }] : []),
      ...(c.weightKg != null ? [{ value: weight(c.weightKg), label: tx("body", "Weight") }] : []),
    ],
  };

  /* Cycling VO2 max: COROS's own figure is not synced, so this is C-LINK's estimate or nothing. */
  const vo2Card: RidePage["vo2"] = vo2Estimate == null || five == null || c.weightKg == null
    ? missing(five == null ? t("Needs a ride of 5 minutes or more with a power meter in the last 90 days.") : t("Needs your weight."))
    : {
      chip: null, headline: t("C-LINK's estimate: about {value}", { value: Math.round(vo2Estimate) }),
      sub: t("From your best 5 minutes, {watts} W at {weight}. Not COROS's number.", { watts: Math.round(five), weight: weight(c.weightKg) }),
      figures: [{ value: String(Math.round(vo2Estimate)), label: t("On the bike") }, ...(runVo2 != null ? [{ value: String(Math.round(runVo2)), label: t("On your runs") }] : [])],
    };

  /* Easy and hard */
  const RIDE_PATTERN: Record<IntensityBalance["pattern"], string> = {
    base: t("Almost all easy riding"), polarized: t("Mostly easy, with some hard riding"), pyramidal: t("Mostly easy, with a little hard riding"),
    threshold: t("A lot of your riding is in the middle"), high: t("Much of your riding is hard"), mixed: t("Mostly easy riding"),
  };
  const balanceCard: RidePage["balance"] = !balance ? missing(t("Needs three rides with heart rate in the last 4 weeks.")) : {
    chip: balanceChip(balance), headline: RIDE_PATTERN[balance.pattern], sub: t("The last 28 days on the bike, by heart rate."), split: splitOf(balance),
    note: t("Read against the threshold heart rate on your watch. On a bike it usually sits a few beats lower than on a run, so a ride can read a little easier than it was."),
  };

  /* Watts per beat */
  const cut = now.getTime() - 28 * 86_400_000;
  const recentBeats = beats.filter((p) => p.at.getTime() >= cut).map((p) => p.value), beforeBeats = beats.filter((p) => p.at.getTime() < cut).map((p) => p.value);
  const beatChange = recentBeats.length >= 2 && beforeBeats.length >= 2 ? ((sum(recentBeats) / recentBeats.length) / (sum(beforeBeats) / beforeBeats.length) - 1) * 100 : null;
  const perBeat: RidePage["perBeat"] = !beats.length ? missing(t("Needs a ride of 30 minutes or more with power and heart rate.")) : {
    chip: beatChange == null ? null : beatChange >= 1 ? chip("good", t("Up {percent}", { percent: percentText(beatChange) })) : beatChange <= -1 ? chip("attention", t("Down {percent}", { percent: percentText(beatChange) })) : chip("neutral", t("Steady")),
    headline: t("{value} W per beat on your latest ride", { value: beats[beats.length - 1].value.toFixed(2) }), sub: null,
    chart: beats.length >= 2 ? lineChart(beats, (v) => v.toFixed(2), t("Watts per heartbeat on rides of 30 minutes or more, from {from} to {to}.", { from: beats[0].value.toFixed(2), to: beats[beats.length - 1].value.toFixed(2) })) : null,
  };

  /* Records */
  const records: RidePage["records"] = bestsOf(c.training).filter((b) => b.family === "ride").map((b) => ({ name: b.name, value: clock(b.seconds, 2), date: b.at ? dayMonthOf(b.at) : "" }));
  const longest = rides.reduce<SportAct | null>((a, r) => (!a || r.seconds > a.seconds ? r : a), null);
  if (longest && longest.seconds > 0) records.push({ name: t("Longest ride"), value: hoursText(longest.seconds, true), date: dayMonthOf(longest.at) });
  const steepest = rides.reduce<SportAct | null>((a, r) => ((r.climbM ?? 0) > (a?.climbM ?? 0) ? r : a), null);
  if (steepest && (steepest.climbM ?? 0) > 0) records.push({ name: t("Most climbing"), value: height(steepest.climbM as number), date: dayMonthOf(steepest.at) });

  const nextRide = planned[0];
  const tiles: Tile[] = [
    {
      label: t("Volume"), chip: muchChip, value: hoursText(week.seconds), unit: usual != null ? t("of {usual}", { usual: hoursText(usual) }) : "", spark: volume.weeks.map((w) => w.seconds), hue: "ride", href: "#much",
      text: nextRide
        ? (nextRide.seconds > 0
          ? t("A {time} ride is planned for {day}", { time: hoursText(nextRide.seconds), day: weekdayLong(new Date(`${nextRide.day}T12:00`)) })
          : t("{workout} is planned for {day}", { workout: nextRide.name, day: weekdayLong(new Date(`${nextRide.day}T12:00`)) }))
        : week.sessions === 1 ? t("1 ride this week") : t("{n} rides this week", { n: week.sessions }),
    },
    {
      label: "FTP", chip: ftpChip, value: ftp != null ? String(Math.round(ftp)) : "–", unit: ftp != null ? "W" : "", spark: trend.length >= 2 ? trend.map((p) => p.watts) : null, hue: "gold", href: "#ftp",
      text: ftp == null ? t("Needs a ride with a power meter") : gain != null && gain >= 3 ? t("Best 20 minutes point to {watts} W more than {weeks} weeks ago", { watts: Math.round(gain), weeks: trend.length * 4 - 4 }) : setFtp != null ? t("As set on your watch") : t("From your best 20 minutes"),
    },
    {
      label: t("Climbing"), chip: climbing?.isNotable ? chip("good", t("Big week")) : null, value: thousands(heightIn(climbNow)), unit: heightUnit(), spark: climbing ? climbing.weeks.map((w) => w.meters) : null, hue: "violet", href: "#climb",
      text: climbing?.isNotable && climbing.moreBefore ? t("Your most since {date}", { date: dayMonthOf(climbing.moreBefore) }) : climbLast > 0 ? t("Last week: {height}", { height: height(climbLast) }) : imperial() ? t("Feet climbed this week") : t("Metres climbed this week"),
    },
    {
      label: t("Easy vs hard"), chip: balance ? balanceChip(balance) : null, value: balance ? String(sharePercents(balance)[0]) : "–", unit: balance ? t("% easy") : "", spark: null, hue: "run", href: "#balance",
      text: balance ? RIDE_PATTERN[balance.pattern] : t("Needs rides with heart rate"),
    },
  ];

  const weekLine = usual == null ? null : (() => {
    const vars = { total, usual: hoursText(usual, true), time: nextRide ? hoursText(nextRide.seconds) : "", day: nextRide ? weekdayLong(new Date(`${nextRide.day}T12:00`)) : "" };
    const withRide = nextRide != null && nextRide.seconds > 0;
    if (week.seconds > 0) return withRide ? t("{total} so far this week, of your usual {usual}, with a {time} ride planned for {day}.", vars) : t("{total} so far this week, of your usual {usual}.", vars);
    return withRide ? t("No rides yet this week; your usual week is {usual}, with a {time} ride planned for {day}.", vars) : t("No rides yet this week; your usual week is {usual}.", vars);
  })();
  return {
    hero: {
      chip: curve ? t("Power · last 90 days") : t("This week · {total} so far", { total: hoursText(week.seconds) }),
      headline: curveHeadline ?? t("{lead}.", { lead: muchHeadline }),
      text: curve ? weekLine : null, figures,
      curve: curve ? {
        recent: curve.map((r) => r.recent), best: curve.map((r) => r.best), tiles: curveTiles,
        marks: (() => { const top = Math.max(...curve.map((r) => r.best)); return top > 600 ? [250, 500, 1000] : [100, 200, 400]; })(),
        label: t("Power curve: {points}.", { points: curve.map((r) => {
          const s = shortfall(r), point = `${durationName(r.seconds)} ${Math.round(r.recent ?? r.best)} W`;
          return s == null ? point : s <= 1 ? t("{point}, your best", { point }) : t("{point}, {percent}% under your best", { point, percent: Math.round(s) });
        }).join("; ") }),
      } : missing(t("Needs a ride with a power meter.")),
    },
    tiles,
    much: {
      chip: muchChip, headline: muchHeadline, sub: usual != null ? t("Your usual week is {usual}.", { usual: hoursText(usual, true) }) : null,
      weeks: {
        bars: weekBars(volume, (w) => w.seconds, hm, plannedS),
        line: usual != null ? { value: usual, text: t("Usual, {distance}", { distance: hoursText(usual) }) } : null, planned: plannedS > 0,
        label: plannedS > 0
          ? t("Hours ridden in each of the last {weeks} weeks, with {done} so far this week and {planned} planned.", { weeks: volume.weeks.length, done: hm(week.seconds), planned: hoursText(plannedS, true) })
          : t("Hours ridden in each of the last {weeks} weeks, with {done} so far this week.", { weeks: volume.weeks.length, done: hm(week.seconds) }),
      },
      figures: [
        { value: String(week.sessions), label: t("Rides") }, { value: kmText(week.meters), label: t("Distance") }, { value: hoursText(week.longestSeconds), label: t("Long ride") },
        ...(volume.yearLongest ? [{ value: hoursText(volume.yearLongest.seconds), label: t("Longest this year") }] : []),
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
  const volChip = change == null || pct < 5 ? null : change > 0 ? chip("good", t("Up {percent}", { percent: `${pct}%` })) : chip("attention", t("Down {percent}", { percent: `${pct}%` }));

  const cssCard: SwimPage["css"] = css == null || !b200 || !b400 ? sampleCss() : (() => {
    const bands = swimBands(css);
    return {
      chip: null, headline: t("Critical swim speed {pace}", { pace: swimPaceText(css) }),
      sub: t("Estimated from your best 200 m ({b200}) and 400 m ({b400}).", { b200: clock(b200.seconds, 2), b400: clock(b400.seconds, 2) }),
      bands: [
        { name: t("Easy"), text: t("slower than {pace}", { pace: clock(swimPaceIn(bands.easyFrom)) }), hue: "run" as const },
        { name: t("Threshold"), text: t("{from} to {to}", { from: clock(swimPaceIn(bands.thresholdFrom)), to: clock(swimPaceIn(bands.thresholdTo)) }), hue: "gold" as const },
        { name: t("Fast"), text: t("quicker than {pace}", { pace: clock(swimPaceIn(bands.fastTo)) }), hue: "coral" as const },
      ],
      sampleTrend: sampleCssTrend(),
    };
  })();

  const records: SwimPage["records"] = !bests.length ? sampleSwimRecords() : {
    chip: fresh.length ? chip("attention", fresh.length === 1 ? t("New record") : tx("records", "{n} new", { n: fresh.length })) : null,
    headline: fresh.length === 1 ? t("New record: {name} in {time}", { name: fresh[0].name, time: clock(fresh[0].seconds, 2) }) : fresh.length > 1 ? t("{n} swim records in the last 2 weeks", { n: fresh.length }) : t("Your swim records"),
    sub: fresh.length === 1 && fresh[0].at ? t("On {day} {date}.", { day: weekdayOf(fresh[0].at), date: dayMonthOf(fresh[0].at) }) : null,
    rows: bests.map((b) => ({ name: b.name, value: clock(b.seconds, 2), date: b.at ? dayMonthOf(b.at) : "", fresh: isFresh(b, now) })),
  };

  /* Pace per 100 m (or yd, as shown) of each swim of the last 12 weeks, rests included. */
  const paced = swims.filter((x) => (x.meters ?? 0) >= 200 && x.seconds > 0 && x.at.getTime() >= now.getTime() - 84 * 86_400_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => ({ at: x.at, value: swimPaceIn((x.seconds / (x.meters as number)) * 100) }));
  const cutoff = now.getTime() - 28 * 86_400_000;
  const paceNow = paced.filter((x) => x.at.getTime() >= cutoff).map((x) => x.value), paceThen = paced.filter((x) => x.at.getTime() < cutoff).map((x) => x.value);
  const paceDiff = paceNow.length >= 2 && paceThen.length >= 2 ? sum(paceThen) / paceThen.length - sum(paceNow) / paceNow.length : null;
  const paceChip = paceDiff == null ? null : paceDiff >= 1 ? chip("good", t("Faster")) : paceDiff <= -1 ? chip("attention", t("Slower")) : chip("neutral", t("Steady"));
  const latestPace = paced[paced.length - 1];
  const paceCard: SwimPage["pace"] = !latestPace ? missing(t("Needs a swim of 200 m or more.")) : {
    chip: paceChip,
    headline: paceDiff != null && Math.abs(paceDiff) >= 1
      ? (paceDiff > 0 ? t("{seconds} s per 100 faster than before", { seconds: Math.abs(paceDiff).toFixed(1) }) : t("{seconds} s per 100 slower than before", { seconds: Math.abs(paceDiff).toFixed(1) }))
      : t("{pace} on your latest swim", { pace: `${clock(latestPace.value, 2)} ${swimPaceUnitLabel()}` }),
    sub: paceDiff != null ? t("The last 4 weeks against the 8 before, rests included.") : t("Whole swims, rests included."),
    chart: paced.length >= 2 ? lineChart(paced, (v) => clock(v), imperial()
      ? t("Average pace per 100 yd on each swim, from {from} to {to}. Faster is higher.", { from: clock(paced[0].value), to: clock(latestPace.value) })
      : t("Average pace per 100 m on each swim, from {from} to {to}. Faster is higher.", { from: clock(paced[0].value), to: clock(latestPace.value) }), true) : null,
  };

  const figures: Figure[] = [{ value: swimDistance(meters), label: t("Last 4 weeks") }, { value: String(count), label: t("Swims") }];
  if (css != null) figures.push({ value: clock(swimPaceIn(css)), label: `CSS ${swimPaceUnitLabel()}` });
  const longest = swims.filter((s) => s.at.getTime() >= now.getTime() - 28 * 86_400_000).reduce((a, s) => Math.max(a, s.meters ?? 0), 0);
  if (longest > 0) figures.push({ value: swimDistance(longest), label: t("Longest swim") });

  const tiles: Tile[] = [
    { label: t("Speed"), chip: null, value: css != null ? clock(swimPaceIn(css)) : "–", unit: css != null ? swimPaceUnitLabel() : "", spark: null, hue: "swim", href: "#css", text: css != null ? t("From your best 200 m and 400 m") : t("Needs a hard 200 m and 400 m") },
    { label: t("Pace"), chip: paceChip, value: latestPace ? clock(latestPace.value) : "–", unit: latestPace ? swimPaceUnitLabel() : "", spark: paced.length > 1 ? paced.map((x) => -x.value) : null, hue: "ride", href: "#pace", text: latestPace ? t("On your latest swim, rests included") : t("Needs a swim of 200 m or more") },
    {
      label: t("Records"), chip: fresh.length ? chip("attention", t("New record")) : null, value: fresh[0] ? clock(fresh[0].seconds, 2) : bests.length ? String(bests.length) : "–", unit: fresh[0] ? fresh[0].name : bests.length ? t("records") : "",
      spark: null, hue: "gold", href: "#records", text: fresh[0]?.at ? t("On {day} {date}", { day: weekdayOf(fresh[0].at), date: dayMonthOf(fresh[0].at) }) : bests.length ? t("No new record in the last 2 weeks") : t(NOTHING_YET),
    },
    { label: t("Volume"), chip: volChip, value: thousands(swimIn(meters)), unit: swimUnit(), spark: volume.weeks.map((w) => w.meters), hue: "swim", href: "#now", text: swimsIn4(count) },
  ];

  return {
    hero: {
      chip: t("Last 4 weeks · {distance}", { distance: swimDistance(meters) }),
      headline: change != null && change >= 0.1 ? t("More time in the water.") : change != null && change <= -0.1 ? t("A lighter month in the water.") : t("Steady in the water."),
      text: `${t("{swims}.", { swims: swimsIn4(count) })}${change != null && pct >= 1 ? ` ${change >= 0 ? t("{percent}% more than the 4 weeks before.", { percent: pct }) : t("{percent}% less than the 4 weeks before.", { percent: pct })}` : ""}`,
      figures,
      lanes: volume.weeks.map((w, k) => ({ label: dayMonthOf(w.start), value: thousands(swimIn(w.meters)), share: w.meters / top, now: k === volume.weeks.length - 1 })),
      lanesLabel: imperial()
        ? t("Yards swum in each of the last {weeks} weeks: {values}.", { weeks: volume.weeks.length, values: volume.weeks.map((w) => thousands(swimIn(w.meters))).join(", ") })
        : t("Metres swum in each of the last {weeks} weeks: {values}.", { weeks: volume.weeks.length, values: volume.weeks.map((w) => thousands(w.meters)).join(", ") }),
    },
    tiles, css: cssCard, pace: paceCard, swolf: sampleSwolf(), strokes: sampleStrokes(), records,
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
    else if (f === "swim") { value = swimDistance(w.meters); of = v.usualMeters != null ? swimDistance(v.usualMeters) : null; percent = v.usualMeters ? (w.meters / v.usualMeters) * 100 : null; }
    else {
      const usual = Math.round(sum(v.weeks.slice(-5, -1).map((x) => x.sessions)) / 4);
      value = w.sessions === 1 ? t("1 workout") : t("{n} workouts", { n: w.sessions }); of = usual > 0 ? String(usual) : null; percent = usual > 0 ? (w.sessions / usual) * 100 : null;
    }
    const name = t(FAMILY_NAME[f]);
    return {
      family: f, name, percent: percent == null ? null : Math.round(percent), value, of: of ? t("of {usual}", { usual: of }) : null, href: FAMILY_HREF[f],
      label: of ? t("{sport}: {value} of {usual} this week", { sport: name, value, usual: of }) : t("{sport}: {value} this week", { sport: name, value }),
    };
  });

  const standouts: Standout[] = shown.map((f): Standout => {
    const fresh = bests.filter((b) => b.family === f && isFresh(b, now))[0];
    if (fresh && f !== "strength") return { family: f, title: t("New record: {name} in {time}", { name: fresh.name, time: clock(fresh.seconds, 2) }), detail: fresh.at ? t("On {day} {date}", { day: weekdayOf(fresh.at), date: dayMonthOf(fresh.at) }) : "", chip: chip("attention", t("New record")), href: FAMILY_HREF[f] };
    if (f === "strength") {
      const ring = rings.find((r) => r.family === f);
      if (!muscles.length) return { family: f, title: ring ? t("{value} this week", { value: ring.value }) : t("No workouts this week"), detail: "", chip: chip("neutral", t("This week")), href: FAMILY_HREF[f] };
      const names = recovering.slice(0, 3).map((m) => m.name.toLowerCase());
      const list = names.length > 1 ? t("{list} and {last}", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] }) : names[0] ?? "";
      const muscles1 = `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
      return recovering.length
        ? { family: f, title: recovering.length === 1 ? t("{muscles} is still recovering", { muscles: muscles1 }) : t("{muscles} are still recovering", { muscles: muscles1 }), detail: t("{ready} of {total} muscles ready", { ready: muscles.filter((m) => m.state === "ready").length, total: muscles.length }), chip: chip("neutral", t("Recovering")), href: FAMILY_HREF[f] }
        : { family: f, title: t("All {n} muscles are ready", { n: muscles.length }), detail: "", chip: chip("good", t("Ready")), href: FAMILY_HREF[f] };
    }
    const page = f === "run" ? run?.much : f === "ride" ? ride?.much : null;
    if (page) return { family: f, title: page.headline, detail: page.sub?.replace(/[.。]$/, "") ?? "", chip: page.chip ?? chip("neutral", t("This week")), href: FAMILY_HREF[f] };
    const tile = swim?.tiles[3];
    return { family: f, title: swim ? t("{meters} swum in the last 4 weeks", { meters: swim.hero.figures[0].value }) : "", detail: tile?.text ?? "", chip: tile?.chip ?? chip("neutral", t("Last 4 weeks")), href: FAMILY_HREF[f] };
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
        family: f, name: t(FAMILY_NAME[f]), href: FAMILY_HREF[f], spark: v.weeks.slice(-8).map((x) => x.meters),
        headline: planned > 0 ? t("On plan for {distance}", { distance: kmText(w.meters + planned) }) : t("{total} so far this week", { total: kmText(w.meters) }),
        figures: [{ value: String(w.sessions), label: t("Runs") }, ...run.tiles.filter((x) => x.href === "#engine" && x.value !== "–").map((x) => ({ value: x.value, label: x.unit })), ...run.hero.figures.filter((x) => x.label === "VO₂ max")].slice(0, 3),
      };
    }
    if (f === "ride" && ride) {
      return {
        family: f, name: t(FAMILY_NAME[f]), href: FAMILY_HREF[f], spark: v.weeks.slice(-8).map((x) => x.seconds),
        headline: ride.much.chip ? t("{state}, {total} so far", { state: ride.much.chip.text, total: hoursText(w.seconds) }) : t("{total} so far this week", { total: hoursText(w.seconds) }),
        figures: ride.hero.figures.filter((x) => x.label !== t("This week")).slice(0, 3).map((x) => (x.label === t("Cycling VO₂ max") ? { ...x, label: "VO₂ max" } : x)),
      };
    }
    if (f === "swim" && swim) {
      return { family: f, name: t(FAMILY_NAME[f]), href: FAMILY_HREF[f], spark: v.weeks.slice(-8).map((x) => x.meters), headline: swim.hero.headline.replace(/[.。]$/, ""), figures: [{ value: String(w.sessions), label: t("Swims") }, ...swim.hero.figures.filter((x) => x.label !== t("Swims") && x.label !== t("Last 4 weeks"))].slice(0, 3) };
    }
    const ready = muscles.filter((m) => m.state === "ready").length;
    const volumeByWeek = v.weeks.slice(-8).map((x) => sum(items.gym.filter((g) => finite(g.start) && refToDate(g.start).getTime() >= x.start.getTime() && refToDate(g.start).getTime() < addDays(x.start, 7).getTime()).map(volumeKg)));
    return {
      family: f, name: t(FAMILY_NAME[f]), href: FAMILY_HREF[f], spark: volumeByWeek.some((x) => x > 0) ? volumeByWeek : v.weeks.slice(-8).map((x) => x.seconds),
      headline: muscles.length ? t("{ready} of {total} muscles ready", { ready, total: muscles.length }) : w.sessions === 1 ? t("1 workout this week") : t("{n} workouts this week", { n: w.sessions }),
      figures: [{ value: String(Math.max(w.sessions, gymWeek.length)), label: t("Workouts") }, ...(gymWeek.length ? [{ value: String(sum(gymWeek.map(doneSetCount))), label: t("Sets") }, { value: weightTotal(sum(gymWeek.map(volumeKg))), label: t("Volume") }] : [])],
    };
  });

  /* Other sports of the last 90 days */
  const from = now.getTime() - 90 * 86_400_000;
  const others = new Map<string, { sessions: number; seconds: number; last: Date }>();
  for (const a of c.acts) {
    if (shown.includes(a.family) || a.at.getTime() < from || a.at.getTime() > now.getTime() || isBlip(a)) continue;
    const title = SPORT_TITLE[a.kind as NativeSport];
    const name = title ? t(title) : t("Workout");
    const row = others.get(name) ?? { sessions: 0, seconds: 0, last: a.at };
    row.sessions++; row.seconds += a.seconds; if (a.at.getTime() > row.last.getTime()) row.last = a.at;
    others.set(name, row);
  }

  /* Headline */
  const active = shown.map((f) => ({ f, seconds: (volumes.get(f) as SportVolume).weeks[11]?.seconds ?? 0 })).sort((a, b) => b.seconds - a.seconds);
  const waiting = shown.find((f) => ((volumes.get(f) as SportVolume).weeks[11]?.sessions ?? 0) === 0 && c.planned(f).length > 0);
  const headline = !(thisWeek.seconds > 0) ? t("A fresh week.")
    : `${t("{sport} is carrying the week.", { sport: t(FAMILY_NAME[active[0].f]) })}${waiting ? ` ${t("{sport} is still to come.", { sport: t(FAMILY_NAME[waiting]) })}` : ""}`;
  const sportsDone = active.filter((a) => a.seconds > 0).length;
  const usualAll = all.usualSeconds;
  const figures: Figure[] = [{ value: hoursText(thisWeek.seconds), label: t("So far this week") }];
  if (usualAll != null) figures.push({ value: hoursText(usualAll), label: t("Your usual week") });
  figures.push({ value: String(thisWeek.sessions), label: t("Workouts") });

  return {
    day: `${weekdayOf(now)} ${dayMonthOf(now)}`,
    range: monday.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      ? t("This week · {day}", { day: `${weekdayOf(now)} ${dayMonthOf(now)}` })
      : t("This week · {from} to {to}", { from: language() === "en" ? `${weekdayOf(monday)} ${monday.getDate()}${monday.getMonth() === now.getMonth() ? "" : ` ${monthOf(monday)}`}` : `${weekdayOf(monday)} ${dayMonthOf(monday)}`, to: `${weekdayOf(now)} ${dayMonthOf(now)}` }),
    headline,
    text: thisWeek.seconds > 0 ? (() => {
      const vars = { time: hoursText(thisWeek.seconds, true), n: sportsDone, planned: hoursText(plannedHours * 3600, true) };
      if (plannedHours > 0) return sportsDone === 1 ? t("{time} across 1 sport so far, with {planned} more planned before Sunday.", vars) : t("{time} across {n} sports so far, with {planned} more planned before Sunday.", vars);
      return sportsDone === 1 ? t("{time} across 1 sport so far.", vars) : t("{time} across {n} sports so far.", vars);
    })() : null,
    figures, rings, standouts,
    hours: {
      weeks, families: shown, planned: plannedHours > 0, total: t("{time} in the last 4 weeks", { time: hoursText(sum(weeks.slice(-4).map((w) => w.total)) * 3600, true) }),
      label: plannedHours > 0
        ? t("Hours of training in each of the last {weeks} weeks, stacked by sport. The biggest week was {biggest} hours; this week stands at {now} hours with {planned} more planned.", { weeks: weeks.length, biggest: biggest.total.toFixed(1), now: weeks[weeks.length - 1].total.toFixed(1), planned: plannedHours.toFixed(1) })
        : t("Hours of training in each of the last {weeks} weeks, stacked by sport. The biggest week was {biggest} hours; this week stands at {now} hours.", { weeks: weeks.length, biggest: biggest.total.toFixed(1), now: weeks[weeks.length - 1].total.toFixed(1) }),
    },
    cards,
    also: [...others.entries()].sort((a, b) => b[1].seconds - a[1].seconds).map(([name, r]) => ({ name, sessions: r.sessions === 1 ? t("1 session") : t("{n} sessions", { n: r.sessions }), time: hoursText(r.seconds, true), last: dayMonthOf(r.last) })),
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
