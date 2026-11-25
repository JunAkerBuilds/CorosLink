// The text Coach's read tools hand to the model, built from the athlete's own items. Pure. Numbers keep the
// precision the phone sent. Names and notes the athlete typed go through `quoted`.
import type { HubCalendarDay, HubWorkout } from "@/data/hub";
import type { NativeActivity, NativeFoodEntry, NativeGymPlanned, NativeGymWorkout, NativeNutrition } from "@/data/sync/native";
import { calendarDayKey } from "@/data/sync/native";
import type { SavedWorkout } from "@/data/workouts";
import { clock as clockText } from "@/lib/format";
import type { Sport } from "@/lib/workout";
import { raceLines, zoneLines, zonesFromPhone, type AthleteZones } from "./zones";
import {
  dayLabel, dayOfRef, familyOf, finite, isDay, localParts, quoted, refMs, shiftDay, SPORT_WORDS, timeLabel, today,
  type AthleteItems, type Clock, type Family,
} from "./items";

/* ───────────── Activities ───────────── */

export const paceOf = (a: Pick<NativeActivity, "distanceMeters" | "durationSeconds">): number | null =>
  finite(a.distanceMeters) && finite(a.durationSeconds) && a.distanceMeters > 0 && a.durationSeconds > 0 ? a.durationSeconds / (a.distanceMeters / 1000) : null;

const kmText = (m: number) => `${(m / 1000).toFixed(2)} km`;

/** Average speed or pace in the sport's own words. */
export function speedText(a: NativeActivity): string | null {
  const p = paceOf(a);
  if (p === null) return null;
  const family = familyOf(a.sport);
  if (family === "ride") return `${(3600 / p).toFixed(1)} km/h`;
  if (family === "swim") return `${clockText(p / 10, 2)} /100 m`;
  return `${clockText(p, 2)} /km`;
}

export function activityLine(a: NativeActivity, clock: Clock): string {
  const ms = refMs(a.start ?? 0), p = localParts(ms, clock);
  const parts = [`${dayLabel(p.day)} ${timeLabel(ms, clock)}`, `"${quoted(a.name) || SPORT_WORDS[a.sport] || "Workout"}"`, SPORT_WORDS[a.sport] ?? a.sport];
  if (finite(a.distanceMeters) && a.distanceMeters > 0) parts.push(kmText(a.distanceMeters));
  if (finite(a.durationSeconds)) parts.push(clockText(a.durationSeconds, 2));
  const s = speedText(a);
  if (s) parts.push(s);
  if (finite(a.averageHR)) parts.push(`avg HR ${a.averageHR}`);
  if (finite(a.maxHR)) parts.push(`max HR ${a.maxHR}`);
  if (finite(a.trainingLoad)) parts.push(`load ${a.trainingLoad}`);
  if (finite(a.elevationGain) && a.elevationGain > 0) parts.push(`+${Math.round(a.elevationGain)} m`);
  if (finite(a.averagePower)) parts.push(`${a.averagePower} W`);
  return `${parts.join(" · ")} [id ${a.id}]`;
}

const FAMILIES: readonly string[] = ["run", "ride", "swim", "strength", "other"];

export function readActivities(items: AthleteItems, clock: Clock, input: { days?: number; sport?: string; limit?: number }): string {
  const days = Math.max(1, Math.min(365, Math.round(input.days ?? 14)));
  const from = shiftDay(today(clock), -(days - 1));
  const family = input.sport && FAMILIES.includes(input.sport) ? (input.sport as Family) : null;
  const all = items.activities.filter((a) => dayOfRef(a.start ?? 0, clock) >= from && (!family || familyOf(a.sport) === family));
  const limit = Math.max(1, Math.min(60, Math.round(input.limit ?? 40)));
  if (!all.length) return `No ${family ?? ""} activities from the phone in the last ${days} days.`.replace("  ", " ");
  const head = `${all.length} ${all.length === 1 ? "activity" : "activities"} in the last ${days} days${all.length > limit ? `, newest ${limit} shown` : ""}, newest first:`;
  return [head, ...all.slice(0, limit).map((a) => activityLine(a, clock))].join("\n");
}

export function findActivity(items: AthleteItems, id: unknown): NativeActivity | null {
  return typeof id === "string" ? items.activities.find((a) => a.id === id) ?? null : null;
}

export function readActivity(items: AthleteItems, clock: Clock, id: unknown): string {
  const a = findActivity(items, id);
  if (!a) return "No activity with that id. Use an id from read_activities.";
  const out = [activityLine(a, clock)];
  if (finite(a.calories)) out.push(`Calories ${a.calories}`);
  if (finite(a.averageCadence)) out.push(`Cadence ${a.averageCadence} spm`);
  const d = items.details[a.id];
  if (!d) return [...out, "The phone has not sent this activity's laps or streams."].join("\n");
  const laps = d.laps ?? [];
  if (laps.length) {
    out.push(`Laps (${laps.length}):`);
    for (const l of laps.slice(0, 60)) {
      const p = finite(l.distanceM) && l.distanceM > 0 ? ` · ${clockText(l.durationS / (l.distanceM / 1000), 2)} /km` : "";
      out.push(`  ${l.n}${l.name ? ` "${quoted(l.name, 40)}"` : ""}: ${finite(l.distanceM) ? `${l.distanceM.toFixed(0)} m · ` : ""}${clockText(l.durationS, 2)}${p}${finite(l.avgHr) ? ` · HR ${l.avgHr}` : ""}${finite(l.maxHr) ? ` (max ${l.maxHr})` : ""}${finite(l.cadence) ? ` · ${l.cadence} spm` : ""}${finite(l.elevationM) ? ` · ${l.elevationM >= 0 ? "+" : ""}${l.elevationM} m` : ""}`);
    }
  }
  const zones = d.zones ?? [];
  if (zones.length) out.push(`Time in heart rate zones: ${zones.map((z) => `Z${z.zone} ${clockText(z.seconds)}`).join(", ")}`);
  if (!laps.length && !zones.length) out.push("No laps or zones in what the phone sent.");
  return out.join("\n");
}

/* ───────────── Health ───────────── */

export type HealthMetric = "hrv" | "resting_hr" | "sleep" | "sleep_score" | "stress" | "steps" | "load";

export const METRIC_WORDS: Record<HealthMetric, { name: string; unit: string }> = {
  hrv: { name: "Overnight HRV", unit: "ms" }, resting_hr: { name: "Resting heart rate", unit: "bpm" }, sleep: { name: "Sleep", unit: "h" },
  sleep_score: { name: "Sleep score", unit: "" }, stress: { name: "Stress", unit: "" }, steps: { name: "Steps", unit: "" }, load: { name: "Training load", unit: "" },
};

export const isMetric = (v: unknown): v is HealthMetric => typeof v === "string" && v in METRIC_WORDS;

/** One value per day for `metric`, oldest first, only days that have it, ending today or earlier. */
export function metricSeries(items: AthleteItems, clock: Clock, metric: HealthMetric, days: number): { day: string; value: number }[] {
  const end = today(clock), from = shiftDay(end, -(days - 1));
  const out = new Map<string, number>();
  for (const d of items.days) {
    const day = calendarDayKey(d.day);
    if (day < from || day > end) continue;
    const v = metric === "hrv" ? d.hrv : metric === "resting_hr" ? d.restingHR : metric === "stress" ? d.stress : metric === "steps" ? d.steps
      : metric === "load" ? d.trainingLoad : metric === "sleep" ? (finite(d.sleepMinutes) ? Math.round((d.sleepMinutes / 60) * 100) / 100 : undefined) : d.sleepScore;
    if (finite(v)) out.set(day, v);
  }
  if (metric === "sleep" || metric === "sleep_score") {
    for (const n of items.nights) {
      const day = calendarDayKey(n.day);
      if (day < from || day > end) continue;
      const v = metric === "sleep" ? (finite(n.totalMinutes) ? Math.round((n.totalMinutes / 60) * 100) / 100 : undefined) : n.score;
      if (finite(v)) out.set(day, v);
    }
  }
  return [...out].map(([day, value]) => ({ day, value })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** The middle 80% of the values: what is "usual" for this athlete. Null with fewer than five. */
export function usualRange(values: readonly number[]): [number, number] | null {
  if (values.length < 5) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return [at(0.1), at(0.9)];
}

const mean = (v: readonly number[]) => v.reduce((t, x) => t + x, 0) / v.length;
const oneDp = (n: number) => String(Math.round(n * 10) / 10);

function seriesText(items: AthleteItems, clock: Clock, metric: HealthMetric, days: number): string {
  const s = metricSeries(items, clock, metric, days), w = METRIC_WORDS[metric];
  if (!s.length) return `${w.name}: nothing from the phone in the last ${days} days.`;
  const values = s.map((p) => p.value), usual = usualRange(values);
  const last = s.slice(-14).map((p) => `${dayLabel(p.day)} ${p.value}`).join(", ");
  return `${w.name}${w.unit ? ` (${w.unit})` : ""}, ${s.length} days: average ${oneDp(mean(values))}, lowest ${Math.min(...values)}, highest ${Math.max(...values)}${usual ? `, usual range ${usual[0]} to ${usual[1]}` : ""}. Latest: ${last}`;
}

export function readHealth(items: AthleteItems, clock: Clock, input: { topic?: string; days?: number }): string {
  const days = Math.max(1, Math.min(400, Math.round(input.days ?? 30)));
  const topic = input.topic ?? "all";
  const out: string[] = [];
  const want = (t: string) => topic === "all" || topic === t;
  if (want("sleep")) {
    out.push(seriesText(items, clock, "sleep", days), seriesText(items, clock, "sleep_score", days));
    const night = items.nights[items.nights.length - 1];
    if (night) {
      const stage = [["deep", night.deepMinutes], ["light", night.lightMinutes], ["REM", night.remMinutes], ["awake", night.awakeMinutes]]
        .filter((x): x is [string, number] => finite(x[1])).map(([n, m]) => `${n} ${m} min`).join(", ");
      out.push(`Last night (${dayLabel(calendarDayKey(night.day))}): ${finite(night.totalMinutes) ? `${Math.floor(night.totalMinutes / 60)} h ${night.totalMinutes % 60} min` : "length unknown"}${finite(night.score) ? `, score ${night.score}` : ""}${stage ? `, ${stage}` : ""}${finite(night.bedtime) ? `, in bed ${timeLabel(refMs(night.bedtime), clock)}` : ""}${finite(night.wakeTime) ? `, up ${timeLabel(refMs(night.wakeTime), clock)}` : ""}${finite(night.napMinutes) && night.napMinutes > 0 ? `, naps ${night.napMinutes} min` : ""}`);
    }
  }
  if (want("hrv")) out.push(seriesText(items, clock, "hrv", days));
  if (want("resting_hr")) out.push(seriesText(items, clock, "resting_hr", days));
  if (want("stress")) out.push(seriesText(items, clock, "stress", days));
  if (want("steps")) out.push(seriesText(items, clock, "steps", days));
  if (want("energy")) {
    const e = items.energy[today(clock)];
    if (!e) out.push("Energy: nothing from the phone for today.");
    else out.push(`Energy today: ${e.now ? `now ${e.now.level}` : "no current level"}${e.woke ? `, woke at ${e.woke.level}` : ""}${e.bedtime ? `, went to bed at ${e.bedtime.level}` : ""}${e.trend ? `, trend ${e.trend}` : ""}${e.learning ? " (still learning this athlete)" : ""}. Events: ${(e.events ?? []).slice(0, 12).map((v) => `${v.kind}${v.workoutName ? ` "${quoted(v.workoutName, 40)}"` : ""}${finite(v.change) ? ` ${v.change > 0 ? "+" : ""}${v.change}` : ""}`).join(", ") || "none"}`);
  }
  return out.length ? out.join("\n") : "Unknown topic. Use sleep, hrv, resting_hr, stress, steps, energy or all.";
}

/* ───────────── Training ───────────── */

/** Fitness, fatigue and form on the last day the phone computed. */
export function formNow(items: AthleteItems): { fitness: number; fatigue: number; form: number; day: string } | null {
  const f = items.training?.fitness;
  if (!f || !isDay(f.start) || !f.fitness?.length || f.fatigue?.length !== f.fitness.length) return null;
  const i = f.fitness.length - 1;
  return { fitness: f.fitness[i], fatigue: f.fatigue[i], form: Math.round((f.fitness[i] - f.fatigue[i]) * 10) / 10, day: shiftDay(f.start, i) };
}

export function weekTotals(items: AthleteItems, clock: Clock, monday: string): { seconds: number; metres: number; load: number; count: number } {
  const end = shiftDay(monday, 6);
  let seconds = 0, metres = 0, load = 0, count = 0;
  for (const a of items.activities) {
    const day = dayOfRef(a.start ?? 0, clock);
    if (day < monday || day > end) continue;
    count += 1;
    seconds += a.durationSeconds ?? 0;
    metres += a.distanceMeters ?? 0;
    load += a.trainingLoad ?? 0;
  }
  return { seconds, metres, load, count };
}

export function readTraining(items: AthleteItems, clock: Clock, input: { topic?: string }): string {
  const t = items.training, topic = input.topic ?? "all", out: string[] = [];
  const want = (x: string) => topic === "all" || topic === x;
  if (want("load")) {
    const l = t?.load;
    out.push(l ? `Load: acute (7 d) ${l.acute ?? "?"}, chronic (28 d) ${l.chronic ?? "?"}, ratio ${l.ratio ?? "?"}${l.status ? `, status "${quoted(l.status, 30)}"` : ""}${finite(l.weekTotal) ? `, this week ${l.weekTotal}` : ""}` : "Load: nothing from the phone.");
    if (t?.readiness) out.push(`Readiness ${t.readiness.score}${t.readiness.status ? ` ("${quoted(t.readiness.status, 30)}")` : ""}`);
  }
  if (want("fitness")) {
    const f = formNow(items);
    if (!f) out.push("Fitness and fatigue: nothing from the phone.");
    else {
      const series = t!.fitness!, n = series.fitness.length;
      const back = (d: number) => (n - 1 - d >= 0 ? `${series.fitness[n - 1 - d]}/${series.fatigue[n - 1 - d]}` : "n/a");
      out.push(`Fitness ${f.fitness}, fatigue ${f.fatigue}, form ${f.form > 0 ? "+" : ""}${f.form} on ${dayLabel(f.day)}. Fitness/fatigue 7 days ago ${back(7)}, 28 days ago ${back(28)}, 84 days ago ${back(84)}.`);
    }
  }
  if (want("week")) {
    const monday = shiftDay(today(clock), -((localParts(clock.nowMs, clock).weekday + 6) % 7));
    for (let w = 0; w < 6; w++) {
      const m = shiftDay(monday, -7 * w), tot = weekTotals(items, clock, m);
      out.push(`Week of ${dayLabel(m)}: ${tot.count} activities, ${clockText(tot.seconds)}, ${kmText(tot.metres)}, load ${Math.round(tot.load)}${w === 0 ? " (so far)" : ""}`);
    }
    if (finite(t?.weeklyGoalMinutes)) out.push(`Weekly goal: ${t.weeklyGoalMinutes} minutes`);
  }
  if (want("records")) {
    const bests = t?.bests ?? [];
    out.push(bests.length ? `Personal bests: ${bests.map((b) => `${quoted(b.name, 20)} ${clockText(b.seconds, 2)}${finite(b.at) ? ` (${dayLabel(dayOfRef(b.at, clock))} ${new Date(refMs(b.at)).getUTCFullYear()})` : ""}`).join("; ")}` : "Personal bests: nothing from the phone.");
  }
  if (want("predictions")) {
    const p = t?.predictions ?? [];
    out.push(p.length ? `Race predictions: ${p.map((x) => `${quoted(x.name, 20)} ${clockText(x.seconds, 2)}`).join("; ")}` : "Race predictions: nothing from the phone.");
  }
  return out.length ? out.join("\n") : "Unknown topic. Use load, fitness, week, records, predictions or all.";
}

/* ───────────── Calendar ───────────── */

/** One planned thing on the calendar, from any of its three sources, with what is needed to move or remove it. */
export interface PlanEntry {
  id: string;
  date: string;
  sport: Sport;
  name: string;
  detail: string;
  source: "coros" | "browser" | "synced";
  load?: number;
  coros?: { idInPlan: string; name: string; workout: HubWorkout | null };
  browser?: { workoutId: string };
  planned?: NativeGymPlanned;
}

const HUB_SPORT: Record<string, Sport> = { run: "run", trailRun: "run", bike: "ride", swim: "swim", strength: "strength", hyrox: "strength" };

/** Everything planned: the COROS calendar (when Training Hub is connected), workouts saved in the browser, gym routines put on a day. */
export function planEntries(items: AthleteItems, hubDays: readonly HubCalendarDay[] | null, browser: readonly SavedWorkout[]): PlanEntry[] {
  const out: PlanEntry[] = [];
  for (const d of hubDays ?? []) {
    for (const w of d.workouts) {
      const t = w.totals, parts: string[] = [];
      if (t && t.sets > 0) parts.push(`${t.sets} sets`);
      else { if (t && t.meters > 0) parts.push(kmText(t.meters)); if (t && t.seconds > 0) parts.push(clockText(t.seconds)); }
      out.push({
        id: `coros-${d.day}-${w.idInPlan}`, date: d.day, sport: (w.sport && HUB_SPORT[w.sport]) || "run", name: quoted(w.name) || "Workout",
        detail: parts.join(" · "), source: "coros", coros: { idInPlan: w.idInPlan, name: w.name, workout: w.workout },
      });
    }
  }
  for (const w of browser) {
    if (!w || typeof w.id !== "string" || !isDay(w.date)) continue;
    out.push({
      id: `browser-${w.id}`, date: w.date, sport: w.sport, name: quoted(w.name) || "Workout", detail: quoted(w.summary?.detail ?? "", 120),
      source: "browser", load: finite(w.summary?.load) ? w.summary.load : undefined, browser: { workoutId: w.id },
    });
  }
  const routines = new Map(items.routines.map((r) => [r.id, r]));
  for (const p of items.planned) {
    if (!p.day || !finite(p.day.year)) continue;
    const r = routines.get(p.routineID), count = r?.entries?.length ?? 0;
    out.push({
      id: `gym-${p.id}`, date: calendarDayKey(p.day), sport: "strength", name: quoted(r?.name) || "Gym workout",
      detail: count ? `${count} ${count === 1 ? "exercise" : "exercises"}` : "", source: "synced", planned: p,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

const SOURCE_WORDS = { coros: "COROS calendar", browser: "saved on this computer", synced: "gym routine from the phone" } as const;

export function readCalendar(items: AthleteItems, clock: Clock, entries: readonly PlanEntry[], input: { from?: string; to?: string }, hubNote: string | null): string {
  const now = today(clock);
  const from = isDay(input.from) ? input.from : shiftDay(now, -7);
  let to = isDay(input.to) ? input.to : shiftDay(now, 14);
  if (to < from) to = from;
  if (shiftDay(from, 62) < to) to = shiftDay(from, 62);
  const out: string[] = [`Calendar ${dayLabel(from)} to ${dayLabel(to)} (today is ${dayLabel(now)}):`];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const done = items.activities.filter((a) => dayOfRef(a.start ?? 0, clock) === day).reverse();
    const planned = entries.filter((e) => e.date === day);
    if (!done.length && !planned.length) continue;
    out.push(`${dayLabel(day)}${day === now ? " (today)" : ""}:`);
    for (const e of planned) out.push(`  planned: "${e.name}" ${e.sport}${e.detail ? ` · ${e.detail}` : ""} (${SOURCE_WORDS[e.source]}) [entry ${e.id}]`);
    for (const a of done) out.push(`  done: ${activityLine(a, clock)}`);
  }
  if (out.length === 1) out.push("Nothing planned or recorded in this range.");
  if (hubNote) out.push(hubNote);
  return out.join("\n");
}

/* ───────────── Fuel ───────────── */

export interface Eaten { kcal: number; protein: number; carbs: number; fat: number; fiber: number }

const scaled = (n: NativeNutrition | undefined, grams: number): Eaten => {
  const f = (finite(grams) ? grams : 0) / 100;
  return { kcal: (n?.kcal ?? 0) * f, protein: (n?.proteinG ?? 0) * f, carbs: (n?.carbsG ?? 0) * f, fat: (n?.fatG ?? 0) * f, fiber: (n?.fiberG ?? 0) * f };
};

export const entriesOn = (items: AthleteItems, clock: Clock, day: string): NativeFoodEntry[] =>
  items.fuelEntries.filter((e) => finite(e.time) && dayOfRef(e.time, clock) === day).sort((a, b) => a.time - b.time);

export function eatenOn(items: AthleteItems, clock: Clock, day: string): Eaten {
  const total: Eaten = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const e of entriesOn(items, clock, day)) {
    const s = scaled(e.item?.per100g, e.grams);
    total.kcal += s.kcal; total.protein += s.protein; total.carbs += s.carbs; total.fat += s.fat; total.fiber += s.fiber;
  }
  return total;
}

/** Calories burned on `day` as the watch counted them, or null. */
export const burnedOn = (items: AthleteItems, day: string): number | null => {
  const d = items.days.find((x) => calendarDayKey(x.day) === day);
  return finite(d?.calories) ? d.calories : null;
};

export function readFuel(items: AthleteItems, clock: Clock, input: { day?: string }, targets: Eaten | null): string {
  const day = isDay(input.day) ? input.day : today(clock);
  const entries = entriesOn(items, clock, day), eaten = eatenOn(items, clock, day), burned = burnedOn(items, day);
  const r = Math.round;
  const out = [`Fuel on ${dayLabel(day)}: eaten ${r(eaten.kcal)} kcal, protein ${r(eaten.protein)} g, carbs ${r(eaten.carbs)} g, fat ${r(eaten.fat)} g, fibre ${r(eaten.fiber)} g.`];
  if (targets) out.push(`Targets: ${r(targets.kcal)} kcal, protein ${r(targets.protein)} g, carbs ${r(targets.carbs)} g, fat ${r(targets.fat)} g. Left: ${r(targets.kcal - eaten.kcal)} kcal, protein ${r(targets.protein - eaten.protein)} g, carbs ${r(targets.carbs - eaten.carbs)} g, fat ${r(targets.fat - eaten.fat)} g.`);
  else out.push("No Fuel profile from the phone, so there are no targets.");
  if (burned !== null) out.push(`Burned ${burned} kcal (watch, whole day so far).`);
  if (!entries.length) out.push("Nothing logged.");
  for (const e of entries.slice(0, 40)) out.push(`  ${e.meal}: "${quoted(e.item?.name, 60)}" ${e.grams} ${e.item?.liquid ? "ml" : "g"} · ${r(scaled(e.item?.per100g, e.grams).kcal)} kcal`);
  const p = items.fuelProfile;
  if (p) out.push(`Fuel profile: goal ${p.goal}, ${p.weightKg} kg, ${p.heightCm} cm, age ${p.age}, sex ${p.sex}.`);
  return out.join("\n");
}

/* ───────────── Strength ───────────── */

const setText = (s: { weightKg?: number; reps?: number; seconds?: number; rpe?: number; kind?: string }) =>
  `${finite(s.weightKg) ? `${s.weightKg} kg × ` : ""}${finite(s.reps) ? s.reps : finite(s.seconds) ? `${s.seconds} s` : "?"}${finite(s.rpe) ? ` @${s.rpe}` : ""}${s.kind && s.kind !== "normal" ? ` (${s.kind})` : ""}`;

function gymLines(w: NativeGymWorkout, names: Record<string, string>, clock: Clock): string[] {
  const out = [`${dayLabel(dayOfRef(w.start, clock))} "${quoted(w.name) || "Gym workout"}"${finite(w.end) ? ` · ${clockText(w.end - w.start)}` : ""}:`];
  for (const e of w.entries ?? []) {
    const sets = (e.sets ?? []).filter((s) => s.doneAt != null);
    if (sets.length) out.push(`  ${quoted(names[e.exerciseID]) || e.exerciseID}: ${sets.map(setText).join(", ")}`);
  }
  return out;
}

export function readStrength(items: AthleteItems, clock: Clock, input: { topic?: string; limit?: number }): string {
  const names = items.strength?.exerciseNames ?? {}, topic = input.topic ?? "workouts", out: string[] = [];
  if (topic === "workouts" || topic === "all") {
    const list = items.gymWorkouts.slice(0, Math.max(1, Math.min(12, Math.round(input.limit ?? 5))));
    out.push(list.length ? `Last ${list.length} gym workouts (of ${items.gymWorkouts.length}), newest first:` : "No gym workouts from the phone.");
    for (const w of list) out.push(...gymLines(w, names, clock));
  }
  if (topic === "routines" || topic === "all") {
    out.push(items.routines.length ? "Saved routines:" : "No saved routines from the phone.");
    for (const r of items.routines.slice(0, 40)) {
      out.push(`  "${quoted(r.name) || "Routine"}"${r.folder ? ` (folder "${quoted(r.folder, 40)}")` : ""}: ${(r.entries ?? []).map((e) => `${quoted(names[e.exerciseID]) || e.exerciseID} ${(e.sets ?? []).length} sets`).join(", ")} [saved_workout routine-${r.id}]`);
    }
  }
  if (topic === "muscles" || topic === "all") {
    const m = items.strength?.muscles ?? [];
    out.push(m.length ? `Muscle fatigue (0 to 100): ${m.map((x) => `${quoted(x.name, 30)} ${x.fatigue}${x.state ? ` ${x.state}` : ""}`).join(", ")}` : "Muscle fatigue: nothing from the phone.");
    const s = items.strength?.suggestion;
    if (s) out.push(`The phone's suggested workout: "${quoted(s.title)}": ${(s.exercises ?? []).map((e) => `${quoted(e.name, 40)} ${e.sets ?? "?"}×${e.reps ?? "?"}${finite(e.weightKg) ? ` at ${e.weightKg} kg` : ""}`).join(", ")}`);
  }
  return out.length ? out.join("\n") : "Unknown topic. Use workouts, routines, muscles or all.";
}

/* ───────────── Profile ───────────── */

/** How often each sport was done in the last 90 days, most frequent first. */
export function sportMix(items: AthleteItems, clock: Clock): { sport: string; count: number }[] {
  const from = shiftDay(today(clock), -89), counts = new Map<string, number>();
  for (const a of items.activities) if (dayOfRef(a.start ?? 0, clock) >= from) counts.set(SPORT_WORDS[a.sport] ?? a.sport, (counts.get(SPORT_WORDS[a.sport] ?? a.sport) ?? 0) + 1);
  return [...counts].map(([sport, count]) => ({ sport, count })).sort((a, b) => b.count - a.count);
}

/** The athletic profile: who this athlete is, in the numbers the phone sent. Missing things are named as missing. */
export function profileText(items: AthleteItems, clock: Clock, hubZones: AthleteZones | null = null): string {
  const t = items.training, p = items.fuelProfile, out: string[] = [];
  const mix = sportMix(items, clock);
  out.push(mix.length ? `Sports, last 90 days: ${mix.map((m) => `${m.sport} ×${m.count}`).join(", ")}` : "No recorded activities from the phone yet.");
  const th: string[] = [];
  if (finite(t?.thresholdPaceSecPerKm)) th.push(`threshold pace ${clockText(t.thresholdPaceSecPerKm, 2)} /km`);
  if (finite(t?.thresholdHr)) th.push(`threshold heart rate ${t.thresholdHr} bpm`);
  if (finite(t?.maxHr)) th.push(`max heart rate ${t.maxHr} bpm`);
  if (finite(t?.ftp)) th.push(`FTP ${t.ftp} W`);
  if (finite(t?.vo2max)) th.push(`VO2max ${t.vo2max}`);
  out.push(th.length ? `Thresholds: ${th.join(", ")}` : "Thresholds: not sent by the phone.");
  const zones = zonesFromPhone(t) ?? hubZones;
  const zoneText = zoneLines(zones);
  out.push(...zoneText);
  if (!zones?.hr.length) out.push("Heart rate zone boundaries: not available (the phone hasn't sent them and COROS Training Hub isn't connected or has none). Ask the athlete before using zones, and remember the answer.");
  const races = raceLines(t, today(clock));
  if (races.length) out.push(`Races they're training for: ${races.join("; ")}`);
  else out.push("Goal race: the phone hasn't sent one. If it matters, ask the athlete and remember the answer.");
  if (p) out.push(`Body: ${p.weightKg} kg, ${p.heightCm} cm, age ${p.age}, sex ${p.sex}; Fuel goal ${p.goal}.`);
  else if (finite(items.body?.weightKg)) out.push(`Body: ${items.body.weightKg} kg.`);
  const f = formNow(items);
  if (f) out.push(`Fitness ${f.fitness}, fatigue ${f.fatigue}, form ${f.form > 0 ? "+" : ""}${f.form}.`);
  if (t?.load && finite(t.load.ratio)) out.push(`Load ratio ${t.load.ratio}${t.load.status ? ` ("${quoted(t.load.status, 30)}")` : ""}.`);
  if (t?.predictions?.length) out.push(`Predictions: ${t.predictions.map((x) => `${quoted(x.name, 20)} ${clockText(x.seconds, 2)}`).join("; ")}`);
  if (t?.bests?.length) out.push(`Bests: ${t.bests.slice(0, 8).map((x) => `${quoted(x.name, 20)} ${clockText(x.seconds, 2)}`).join("; ")}`);
  if (items.watch?.model) out.push(`Watch: ${quoted(items.watch.model, 40)}.`);
  if (items.routines.length || items.gymWorkouts.length) out.push(`Gym: ${items.gymWorkouts.length} logged workouts, ${items.routines.length} saved routines.`);
  if (items.memory.length) out.push(`Told to remember: ${items.memory.slice(-20).map((m) => `"${quoted(m.text, 200)}"`).join("; ")}`);
  return out.join("\n");
}
