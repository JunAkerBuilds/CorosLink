// Coach's answer cards, built from the athlete's own items. Pure. The model picks the card and writes its
// one-line read; every number on the card comes from here, never from the model.
import type { CardStat, CoachHue, CompareCard, FuelCard, PlanCheckCard, PlanDayState, RecapCard, TodayCard, TrendCard } from "@/data/coach";
import { targetsFor, usableProfile } from "@/data/sync/fuel";
import { restingKcal } from "@/data/sync/fuelTargets";
import { calendarDayKey, type ActivityDetailBody, type NativeActivity } from "@/data/sync/native";
import { clock as clockText, signed } from "@/lib/format";
import { msg, t, tx } from "@/lib/i18n";
import { distanceIn, distanceStep, distanceUnit, imperial, paceIn, paceUnitLabel } from "@/lib/units";
import {
  dayLabel, dayOfRef, familyOf, finite, localParts, mondayOfDay, quoted, refMs, shiftDay, shownDay, shownDayMonth, shownSport, shownWeekday, timeLabel, today,
  type AthleteItems, type Clock,
} from "./items";
import {
  burnedOn, eatenOn, findActivity, formNow, METRIC_WORDS, metricSeries, paceOf, speedText, usualRange, weekTotals,
  type Eaten, type HealthMetric, type PlanEntry,
} from "./read";

/** A card, or the reason it can't be drawn (handed back to the model as a tool error). */
export type Built<T> = { card: T } | { error: string };

const SAMPLES = 81;

function thin(values: readonly (number | null)[], count = SAMPLES): number[] {
  const clean = values.filter((v): v is number => finite(v));
  if (clean.length <= count) return clean;
  return Array.from({ length: count }, (_, i) => clean[Math.round((i / (count - 1)) * (clean.length - 1))]);
}

/**
 * Seconds for each whole kilometre (or each `step` metres: a mile in imperial), from laps of that length when the
 * watch cut them, else from the speed stream.
 */
export function kmSplits(a: NativeActivity, d: ActivityDetailBody | undefined, step = 1000): number[] {
  const laps = d?.laps ?? [];
  if (laps.length >= 2 && laps.slice(0, -1).every((l) => finite(l.distanceM) && Math.abs(l.distanceM - step) <= 50)) {
    const last = laps[laps.length - 1];
    const whole = finite(last.distanceM) && Math.abs(last.distanceM - step) <= 50 ? laps : laps.slice(0, -1);
    return whole.map((l) => l.durationS);
  }
  const s = d?.streams;
  if (!s?.speedMps || s.x.length < 2 || s.speedMps.length !== s.x.length) return [];
  const out: number[] = [];
  let dist = 0, time = 0, mark = 0;
  for (let i = 1; i < s.x.length; i++) {
    const v = ((s.speedMps[i] ?? 0) + (s.speedMps[i - 1] ?? 0)) / 2;
    if (!(v > 0.2)) { if (s.axis === "time") time += s.x[i] - s.x[i - 1]; continue; }
    const dx = s.axis === "distance" ? s.x[i] - s.x[i - 1] : v * (s.x[i] - s.x[i - 1]);
    const dt = s.axis === "distance" ? dx / v : s.x[i] - s.x[i - 1];
    if (!(dx > 0) || !(dt > 0)) continue;
    let left = dx, used = 0;
    while (dist + left >= (out.length + 1) * step) {
      const need = (out.length + 1) * step - dist, part = (need / dx) * dt;
      out.push(Math.round((time + used + part - mark) * 100) / 100);
      mark = time + used + part;
      dist += need; left -= need; used += part;
    }
    dist += left;
    time += dt;
  }
  return out.slice(0, 120);
}

/** The route drawn into the recap card's box (viewBox 60 60 660 340). Empty when there is no route. */
export function routePath(route: ActivityDetailBody["route"]): string {
  const pts = (route ?? []).filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]));
  if (pts.length < 2) return "";
  const step = Math.max(1, Math.floor(pts.length / 160));
  const used = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const lat0 = used.reduce((sum, p) => sum + p[0], 0) / used.length, k = Math.cos((lat0 * Math.PI) / 180);
  const xs = used.map((p) => p[1] * k), ys = used.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = 560, h = 260, scale = Math.min(w / Math.max(maxX - minX, 1e-9), h / Math.max(maxY - minY, 1e-9));
  const ox = 110 + (w - (maxX - minX) * scale) / 2, oy = 100 + (h - (maxY - minY) * scale) / 2;
  return used.map((_, i) => `${i ? "L" : "M"}${(ox + (xs[i] - minX) * scale).toFixed(1)} ${(oy + (ys[i] - minY) * scale).toFixed(1)}`).join("");
}

const startText = (a: NativeActivity, clock: Clock) => { const ms = refMs(a.start ?? 0); return t("{day}, {time}", { day: shownDay(localParts(ms, clock).day), time: timeLabel(ms, clock) }); };
const titleOf = (a: NativeActivity) => quoted(a.name) || shownSport(a.sport);

export function recapCard(items: AthleteItems, clock: Clock, id: string, input: { activity_id?: unknown; read?: unknown; block_from_km?: unknown; block_to_km?: unknown }): Built<RecapCard> {
  const a = findActivity(items, input.activity_id);
  if (!a) return { error: "no activity with that id. Use an id from read_activities." };
  const d = items.details[a.id];
  const step = distanceStep(), miles = imperial();
  const splits = kmSplits(a, d, step), heart = thin(d?.streams?.hr ?? []);
  if (splits.length < 2 || heart.length < 2) return { error: "the phone hasn't sent kilometre splits and heart rate for this activity, so the recap card can't be drawn. Answer in words from read_training activity." };
  // The model names the block in kilometres; in miles it covers the splits nearest those kilometres.
  const perKm = (seconds: number) => (miles ? (seconds * 1000) / step : seconds);
  const inSplits = (km: number) => Math.round((km * 1000) / step);
  const from = finite(input.block_from_km) ? Math.max(1, inSplits(input.block_from_km)) : 0;
  const to = finite(input.block_to_km) ? Math.min(splits.length, inSplits(input.block_to_km)) : 0;
  const inBlock = (k: number) => from > 0 && to >= from && k + 1 >= from && k + 1 <= to;
  const speed = thin((d?.streams?.speedMps ?? []).map((v) => (finite(v) && v > 0.5 ? Math.min(1200, 1000 / v) : null)), heart.length);
  const paceSeconds = speed.length === heart.length ? speed : heart.map((_, i) => perKm(splits[Math.min(splits.length - 1, Math.floor((i / heart.length) * splits.length))]));
  const stats: CardStat[] = [];
  if (finite(a.distanceMeters)) stats.push({ label: t("Distance"), value: distanceIn(a.distanceMeters).toFixed(2), unit: distanceUnit() });
  if (finite(a.durationSeconds)) stats.push({ label: t("Time"), value: clockText(a.durationSeconds, 2) });
  const p = paceOf(a);
  if (p !== null) stats.push({ label: t("Avg pace"), value: clockText(paceIn(p), 2), unit: paceUnitLabel() });
  if (from > 0 && to >= from) stats.push({ label: miles ? t("Mile {from} to {to}", { from, to }) : t("Km {from} to {to}", { from, to }), value: clockText(splits.slice(from - 1, to).reduce((sum, s) => sum + s, 0), 2), hue: "mint" });
  if (finite(a.averageHR)) stats.push({ label: t("Avg heart rate"), value: String(a.averageHR), unit: "bpm", hue: "rose" });
  if (finite(a.trainingLoad)) stats.push({ label: t("Load"), value: String(a.trainingLoad), hue: "pink" });
  const path = routePath(d?.route);
  return {
    card: {
      kind: "recap", id, activityId: a.id, eyebrow: `${shownSport(a.sport)} · ${startText(a, clock)}`, title: titleOf(a),
      routePath: path, routeLabel: path ? t("The route as recorded") : t("No route was recorded"),
      stats, splits: splits.map((seconds, k) => (inBlock(k) ? { seconds, block: true } : { seconds })), heartRate: heart, paceSeconds, ...(miles ? { splitUnit: "mi" as const } : {}),
      chartLabel: miles
        ? t("Pace for each of {n} miles as bars, with heart rate from {low} to {high} bpm over them", { n: splits.length, low: Math.round(Math.min(...heart)), high: Math.round(Math.max(...heart)) })
        : t("Pace for each of {n} kilometres as bars, with heart rate from {low} to {high} bpm over them", { n: splits.length, low: Math.round(Math.min(...heart)), high: Math.round(Math.max(...heart)) }),
      read: quoted(input.read, 240) || undefined,
    },
  };
}

export function compareCard(items: AthleteItems, clock: Clock, id: string, input: { before_activity_id?: unknown; after_activity_id?: unknown; read?: unknown }): Built<CompareCard> {
  const b = findActivity(items, input.before_activity_id), a = findActivity(items, input.after_activity_id);
  if (!a || !b) return { error: "both activities must be ids from read_activities." };
  if (a.id === b.id) return { error: "those are the same activity." };
  const [first, second] = (b.start ?? 0) <= (a.start ?? 0) ? [b, a] : [a, b];
  const rows: CompareCard["rows"] = [];
  const row = (label: string, x: number | undefined | null, y: number | undefined | null, text: (v: number) => string, change: (d: number) => string, lowerIsBetter?: boolean) => {
    if (!finite(x) || !finite(y)) return;
    const diff = y - x;
    rows.push({ label, before: text(x), after: text(y), change: change(diff), better: lowerIsBetter === undefined || diff === 0 ? undefined : lowerIsBetter ? diff < 0 : diff > 0 });
  };
  row(t("Distance"), first.distanceMeters, second.distanceMeters, (v) => `${distanceIn(v).toFixed(2)} ${distanceUnit()}`, (d) => `${signed(distanceIn(d), 2)} ${distanceUnit()}`);
  row(t("Time"), first.durationSeconds, second.durationSeconds, (v) => clockText(v, 2), (d) => `${signed(d, 2)} s`);
  row(t("Avg pace"), paceOf(first), paceOf(second), (v) => `${clockText(paceIn(v), 2)} ${paceUnitLabel()}`, (d) => `${signed(paceIn(d), 2)} s`, true);
  row(t("Avg heart rate"), first.averageHR, second.averageHR, (v) => `${v} bpm`, (d) => `${signed(d)} bpm`);
  row(t("Max heart rate"), first.maxHR, second.maxHR, (v) => `${v} bpm`, (d) => `${signed(d)} bpm`);
  row(t("Cadence"), first.averageCadence, second.averageCadence, (v) => `${v} spm`, (d) => `${signed(d)} spm`);
  row(t("Load"), first.trainingLoad, second.trainingLoad, (v) => String(v), (d) => signed(d));
  if (!rows.length) return { error: "these two activities share no numbers to compare." };
  const step = distanceStep(), miles = imperial();
  const s1 = kmSplits(first, items.details[first.id], step), s2 = kmSplits(second, items.details[second.id], step), n = Math.min(s1.length, s2.length, 30);
  if (n < 1) return { error: "the phone hasn't sent kilometre splits for both activities, so the comparison card can't be drawn. Compare them in words." };
  const day = (x: NativeActivity) => shownDay(dayOfRef(x.start ?? 0, clock));
  const short = (x: NativeActivity) => shownDayMonth(dayOfRef(x.start ?? 0, clock));
  const apart = Math.round(((second.start ?? 0) - (first.start ?? 0)) / 86400);
  return {
    card: {
      kind: "compare", id, eyebrow: `${shownSport(second.sport)} · ${apart === 1 ? t("1 day apart") : t("{n} days apart", { n: apart })}`,
      title: t("{name}, {after} against {before}", { name: titleOf(second), after: short(second), before: short(first) }),
      before: { label: day(first), short: short(first), href: `/activities/${encodeURIComponent(first.id)}` },
      after: { label: day(second), short: short(second), href: `/activities/${encodeURIComponent(second.id)}` },
      rows, beforeSeconds: s1.slice(0, n), afterSeconds: s2.slice(0, n), ...(miles ? { splitUnit: "mi" as const } : {}),
      chartLabel: miles ? t("Pace per mile for both, the first {n} miles", { n }) : t("Pace per kilometre for both, the first {n} kilometres", { n }), read: quoted(input.read, 240) || undefined,
    },
  };
}

const TREND_METRICS: readonly HealthMetric[] = ["hrv", "resting_hr", "sleep", "sleep_score"];
/** The trend metrics' names for the screen; METRIC_WORDS stays English for the model. */
const TREND_NAMES: Partial<Record<HealthMetric, string>> = { hrv: msg("Overnight HRV"), resting_hr: msg("Resting heart rate"), sleep: msg("Sleep"), sleep_score: msg("Sleep score") };

export function trendCard(items: AthleteItems, clock: Clock, id: string, input: { metric?: unknown; title?: unknown; read?: unknown; mark_date?: unknown }): Built<TrendCard> {
  const metric = TREND_METRICS.find((m) => m === input.metric);
  if (!metric) return { error: "metric must be hrv, resting_hr, sleep or sleep_score." };
  const series = metricSeries(items, clock, metric, 90);
  const values = series.map((s) => s.value), usual = usualRange(values);
  if (values.length < 5 || !usual) return { error: `the phone has sent fewer than five days of ${METRIC_WORDS[metric].name.toLowerCase()}, too few for a trend card.` };
  const w = METRIC_WORDS[metric], lastDay = series[series.length - 1].day, name = t(TREND_NAMES[metric] ?? w.name);
  const markAt = typeof input.mark_date === "string" ? series.findIndex((s) => s.day === input.mark_date) : -1;
  return {
    card: {
      kind: "trend", id, eyebrow: name, title: quoted(input.title, 80) || t("{metric}, {value} last", { metric: name, value: `${values[values.length - 1]}${w.unit ? ` ${w.unit}` : ""}` }),
      unit: w.unit, values, lastDay, usual, markBack: markAt >= 0 ? series.length - 1 - markAt : undefined, metric: name,
      href: "/health", hrefLabel: t("Open Health"), read: quoted(input.read, 240) || undefined,
    },
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function todayCard(items: AthleteItems, clock: Clock, id: string, entries: readonly PlanEntry[], input: { title?: unknown; read?: unknown }): Built<TodayCard> {
  const now = today(clock), dials: TodayCard["dials"] = [];
  const night = [...items.nights].reverse().find((n) => calendarDayKey(n.day) >= shiftDay(now, -1));
  if (night && finite(night.totalMinutes)) {
    dials.push({
      label: t("Sleep"), value: `${Math.floor(night.totalMinutes / 60)}:${String(night.totalMinutes % 60).padStart(2, "0")}`, unit: "h",
      note: finite(night.score) ? t("Score {score}", { score: night.score }) : shownDay(calendarDayKey(night.day)), hue: "violet", fraction: clamp01(finite(night.score) ? night.score / 100 : night.totalMinutes / 480),
    });
  }
  const hrv = metricSeries(items, clock, "hrv", 60), lastHrv = hrv[hrv.length - 1];
  if (lastHrv && lastHrv.day >= shiftDay(now, -1)) {
    const usual = usualRange(hrv.map((h) => h.value));
    dials.push({
      label: "HRV", value: String(lastHrv.value), unit: "ms", hue: "cyan",
      note: usual ? (lastHrv.value < usual[0] ? t("Below your range") : lastHrv.value > usual[1] ? t("Above your range") : t("In your range")) : t("Overnight"),
      fraction: usual ? clamp01((lastHrv.value - usual[0] + (usual[1] - usual[0]) / 2) / Math.max(1, (usual[1] - usual[0]) * 2)) : 0.5,
    });
  }
  const energy = items.energy[now]?.now;
  if (energy) dials.push({ label: t("Energy"), value: String(energy.level), note: items.energy[now]?.trend ? tx("energy", ENERGY_WORDS[items.energy[now]!.trend!]) : t("Now"), hue: "gold", fraction: clamp01(energy.level / 100) });
  const ready = items.training?.readiness;
  if (ready && finite(ready.score)) dials.push({ label: t("Readiness"), value: String(ready.score), note: quoted(ready.status, 24) || t("From your phone"), hue: "mint", fraction: clamp01(ready.score / 100) });
  const f = formNow(items);
  if (!dials.length && !f) return { error: "the phone hasn't sent sleep, HRV, Energy, readiness or fitness for today, so there is nothing to put on the card. Say so." };
  const rows: TodayCard["rows"] = [];
  const rhr = metricSeries(items, clock, "resting_hr", 30), lastRhr = rhr[rhr.length - 1];
  if (lastRhr) rows.push({ label: t("Resting heart rate"), value: `${lastRhr.value} bpm`, note: lastRhr.day === now ? undefined : shownDay(lastRhr.day) });
  const load = items.training?.load;
  if (load && finite(load.ratio)) rows.push({ label: t("Load ratio"), value: String(load.ratio), note: quoted(load.status, 24) || undefined });
  const last = items.activities[0];
  if (last) rows.push({ label: t("Last workout"), value: titleOf(last), note: startText(last, clock) });
  const planned = entries.filter((e) => e.date === now);
  rows.push({ label: t("Planned today"), value: planned.length ? planned.map((e) => e.name).join(", ") : t("Nothing") });
  return {
    card: {
      kind: "today", id, eyebrow: t("Today · {day}", { day: shownDay(now) }), title: quoted(input.title, 80) || t("How today looks"), dials,
      form: f ? { value: f.form, note: f.form < -10 ? t("Carrying fatigue") : f.form > 5 ? t("Fresh") : t("Balanced"), min: -30, max: 30 } : undefined,
      rows, read: quoted(input.read, 240) || undefined,
    },
  };
}

const ENERGY_WORDS = { charging: msg("Charging"), steady: msg("Steady"), usingSlowly: msg("Draining slowly"), usingFast: msg("Draining fast") } as const;
const DAY_STATE: Record<PlanDayState, string> = { done: msg("done"), skipped: msg("skipped"), planned: msg("planned"), rest: msg("rest"), "moved-away": msg("moved away"), "moved-here": msg("moved here") };

const SPORT_HUE: Record<string, CoachHue> = { run: "mint", ride: "cyan", swim: "blue", strength: "violet", other: "gold" };

/** Planned against done for one Monday week. A planned day counts as done when an activity of the same sport was recorded on it. */
export function planCheckCard(items: AthleteItems, clock: Clock, id: string, entries: readonly PlanEntry[], input: { week_of?: unknown; title?: unknown; read?: unknown }): Built<PlanCheckCard> {
  const now = today(clock);
  const monday = mondayOfDay(typeof input.week_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.week_of) ? input.week_of : now);
  const days: PlanCheckCard["days"] = [], misses: PlanCheckCard["misses"] = [];
  let plannedCount = 0, doneCount = 0, plannedLoad = 0, knownLoad = false;
  for (let i = 0; i < 7; i++) {
    const day = shiftDay(monday, i), label = shownWeekday(day);
    const done = items.activities.filter((a) => dayOfRef(a.start ?? 0, clock) === day);
    const planned = entries.filter((e) => e.date === day);
    plannedCount += planned.length;
    for (const e of planned) if (finite(e.load)) { plannedLoad += e.load; knownLoad = true; }
    const matched = planned.filter((e) => done.some((a) => familyOf(a.sport) === e.sport));
    doneCount += matched.length;
    let state: PlanDayState;
    if (done.length) state = "done";
    else if (planned.length) state = day < now ? "skipped" : "planned";
    else state = "rest";
    if (day < now) for (const e of planned) if (!matched.includes(e)) misses.push({ day: label, name: e.name, state: "skipped", note: done.length ? t("{name} recorded instead", { name: titleOf(done[0]) }) : t("Nothing recorded that day") });
    days.push({ label, state, hue: done.length ? SPORT_HUE[familyOf(done[0].sport)] : planned.length ? SPORT_HUE[planned[0].sport] : undefined });
  }
  const tot = weekTotals(items, clock, monday);
  if (!plannedCount && !tot.count) return { error: `nothing is planned or recorded in the week of ${dayLabel(monday)}.` };
  const totals: PlanCheckCard["totals"] = [];
  if (plannedCount) totals.push({ label: t("Planned workouts"), done: String(doneCount), planned: String(plannedCount), fraction: clamp01(doneCount / plannedCount), hue: "blue" });
  totals.push({ label: t("Time"), done: clockText(tot.seconds), planned: finite(items.training?.weeklyGoalMinutes) ? t("{n} min goal", { n: items.training.weeklyGoalMinutes }) : t("no goal"), fraction: finite(items.training?.weeklyGoalMinutes) && items.training.weeklyGoalMinutes > 0 ? clamp01(tot.seconds / 60 / items.training.weeklyGoalMinutes) : 0, hue: "mint" });
  if (knownLoad) totals.push({ label: t("Load"), done: String(Math.round(tot.load)), planned: String(Math.round(plannedLoad)), fraction: plannedLoad > 0 ? clamp01(tot.load / plannedLoad) : 0, hue: "pink" });
  return {
    card: {
      kind: "plancheck", id, eyebrow: t("Plan · week of {day}", { day: shownDay(monday) }),
      title: quoted(input.title, 80) || (plannedCount ? t("{done} of {planned} planned workouts done", { done: doneCount, planned: plannedCount })
        : tot.count === 1 ? t("1 workout, nothing planned") : t("{n} workouts, nothing planned", { n: tot.count })),
      days, daysLabel: t("The week day by day: {days}", { days: days.map((d) => t("{day} {state}", { day: d.label, state: t(DAY_STATE[d.state]) })).join(", ") }), totals, misses, read: quoted(input.read, 240) || undefined,
    },
  };
}

/** The day's targets from the Fuel profile and what the watch counted as burned, or null without a usable profile. */
export function fuelTargetsOn(items: AthleteItems, day: string): Eaten | null {
  const p = items.fuelProfile;
  if (!usableProfile(p)) return null;
  const burned = burnedOn(items, day), goal = targetsFor(p, burned === null ? 0 : Math.max(0, burned - restingKcal(p)));
  return { kcal: goal.kcal, protein: goal.protein, carbs: goal.carbs, fat: goal.fat, fiber: goal.fiber };
}

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEALS)[number];
const MEAL_NAMES: Record<MealSlot, string> = { breakfast: msg("Breakfast"), lunch: msg("Lunch"), dinner: msg("Dinner"), snack: msg("Snack") };
export const isMeal = (v: unknown): v is MealSlot => typeof v === "string" && (MEALS as readonly string[]).includes(v);

export function fuelCard(items: AthleteItems, clock: Clock, id: string, input: { title?: unknown; read?: unknown; meal?: unknown }): Built<FuelCard> {
  const day = today(clock), targets = fuelTargetsOn(items, day);
  if (!targets) return { error: "there is no Fuel profile from the phone, so there are no targets for the card. Say Fuel isn't set up." };
  const eaten = eatenOn(items, clock, day), r = Math.round;
  const left = (target: number, e: number) => Math.max(0, r(target - e));
  let meal: FuelCard["meal"];
  if (input.meal !== undefined && input.meal !== null) {
    const m = input.meal as Record<string, unknown>;
    const n = (v: unknown, max: number) => (finite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : null);
    const kcal = n(m.kcal, 5000), protein = n(m.protein_g, 500), carbs = n(m.carbs_g, 1000), fat = n(m.fat_g, 500);
    const name = quoted(m.name, 80);
    if (!isMeal(m.slot) || !name || kcal === null || protein === null || carbs === null || fat === null) return { error: "meal needs slot (breakfast, lunch, dinner or snack), name, kcal, protein_g, carbs_g and fat_g." };
    meal = { slot: t(MEAL_NAMES[m.slot]), slotId: m.slot, name, detail: t("{kcal} kcal · {protein} g protein · {carbs} g carbs · {fat} g fat", { kcal: r(kcal), protein: r(protein), carbs: r(carbs), fat: r(fat) }), kcal, proteinG: protein, carbsG: carbs, fatG: fat, day };
  }
  return {
    card: {
      kind: "fuel", id, eyebrow: t("Fuel · today so far"), title: quoted(input.title, 80) || t("{n} kcal left", { n: left(targets.kcal, eaten.kcal) }),
      leftKcal: left(targets.kcal, eaten.kcal), eatenKcal: r(eaten.kcal), targetKcal: r(targets.kcal), burnedKcal: burnedOn(items, day),
      macros: [
        { name: t("Protein"), hue: "rose", grams: r(eaten.protein), leftGrams: left(targets.protein, eaten.protein) },
        { name: t("Carbs"), hue: "mint", grams: r(eaten.carbs), leftGrams: left(targets.carbs, eaten.carbs) },
        { name: t("Fat"), hue: "orange", grams: r(eaten.fat), leftGrams: left(targets.fat, eaten.fat) },
      ],
      meal, read: quoted(input.read, 240) || undefined,
    },
  };
}

export { speedText };
