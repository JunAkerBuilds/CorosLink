// A workout card's middle, in its sport's own terms: exercises and muscles for the gym, a block strip for runs,
// rides and skiing, sets for a swim, stations for HYROX, route blocks for climbing. Pure: built from the workout
// as COROS would hold it plus what is known of the athlete, never from words the model typed.
import type { BodyGroup, BodyRow, BodySeg, BodyStepKind, BodyStrip, CardStat, CoachHue, WorkoutBody, WorkoutBodyKind } from "@/data/coach";
import type { HubIntensity, HubSport, HubStroke, HubWorkout, HubWorkoutStep } from "@/data/hub";
import gymMuscles from "@/data/sync/gymMuscles.json";
import { muscleWork } from "@/lib/activityDetail";
import { clock as clockText, thousands } from "@/lib/format";
import { msg, t, tx } from "@/lib/i18n";
import { formatClock, paceIntensity, ZONE_INTENSITY, type Pacing } from "@/lib/workout";
import { strengthLines, type LiftHistory } from "./strengthCard";
import type { AthleteZones } from "./zones";

/** What is known of the athlete when a card is drawn. Every part may be missing. */
export interface BodyAthlete { pacing?: Pacing | null; zones?: AthleteZones | null; lifts?: LiftHistory | null }

export const SPORT_HUE: Record<HubSport, CoachHue> = {
  run: "mint", trailRun: "lime", bike: "cyan", swim: "blue", strength: "pink", hyrox: "orange", xcSki: "honey", indoorClimb: "coral", bouldering: "gold",
};

/** Which picture a sport's card draws. A session of one step says so plainly instead of drawing one block. */
export function bodyKindFor(sport: HubSport, steps: number): WorkoutBodyKind {
  if (sport === "strength") return "strength";
  if (sport === "hyrox") return "hyrox";
  if (sport === "indoorClimb" || sport === "bouldering") return "climb";
  if (steps <= 1) return "simple";
  return sport === "swim" ? "swim" : "intervals";
}

const KIND_WORDS: Record<BodyStepKind, string> = { warmup: msg("Warm up"), work: msg("Work"), recovery: msg("Recovery"), rest: msg("Rest"), cooldown: msg("Cool down") };
const KIND_HEIGHT: Record<BodyStepKind, number> = { warmup: 0.42, cooldown: 0.42, work: 0.7, recovery: 0.28, rest: 0.15 };
const STROKE_WORDS: Record<HubStroke, string> = {
  freestyle: msg("freestyle"), breaststroke: msg("breaststroke"), backstroke: msg("backstroke"), butterfly: msg("butterfly"), mix: msg("mixed"), individualMedley: msg("medley"), drills: msg("drills"),
};
/** Stroke names as a share's title. */
const STROKE_TITLES: Record<HubStroke | "any", string> = {
  freestyle: msg("Freestyle"), breaststroke: msg("Breaststroke"), backstroke: msg("Backstroke"), butterfly: msg("Butterfly"), mix: msg("Mixed"), individualMedley: msg("Medley"), drills: msg("Drills"), any: msg("Any stroke"),
};

const kindOf = (s: HubWorkoutStep): BodyStepKind =>
  s.kind === "warmup" ? "warmup" : s.kind === "cooldown" ? "cooldown" : s.kind === "training" ? "work" : s.target === "distance" || (s.intensity.kind !== "none" && s.intensity.kind !== "grade") ? "recovery" : "rest";

const paceText = (s: number) => clockText(s, s % 1 ? 2 : 0);
const range = (i: HubIntensity, text: (n: number) => string = String, join = "–") => (i.high != null && i.high !== i.low ? `${text(i.low!)}${join}${text(i.high)}` : text(i.low!));
const mid = (i: HubIntensity): number | null => (i.low == null ? null : i.high != null ? (i.low + i.high) / 2 : i.low);
const metresText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
/** A rest in the fewest words: 20 s, 1:30. */
const restText = (seconds: number) => (seconds < 60 ? `${seconds} s` : formatClock(seconds));
const restWords = (seconds: number) => t("{time} rest", { time: restText(seconds) });

function hrZone(bpm: number, zones: AthleteZones | null | undefined): number | null {
  for (const z of zones?.hr ?? []) if ((z.fromBpm === null || bpm >= z.fromBpm) && (z.toBpm === null || bpm <= z.toBpm)) return z.zone;
  return null;
}

/** Power zones by share of FTP, the usual seven. */
const POWER_ZONES: [string, number][] = [["Z1", 0.55], ["Z2", 0.75], ["Z3", 0.9], ["Z4", 1.05], ["Z5", 1.2], ["Z6", 1.5], ["Z7", Infinity]];
const powerZone = (share: number) => POWER_ZONES.findIndex(([, to]) => share <= to);

/** What a step asks for, the way its sport says it. */
export function targetWords(i: HubIntensity, ath: BodyAthlete = {}): string {
  switch (i.kind) {
    case "none": case "kept": return "";
    case "bodyweight": return t("Bodyweight");
    case "stroke": return i.stroke ? t(STROKE_WORDS[i.stroke]) : "";
    case "grade": return i.grade ?? (i.gradeOffset == null ? "" : i.gradeOffset === 0 ? t("Onsight grade") : t("Onsight {offset}", { offset: `${i.gradeOffset > 0 ? "+" : "−"}${Math.abs(i.gradeOffset)}` }));
  }
  if (i.low == null) return "";
  switch (i.kind) {
    case "pace": return i.low > 0 ? `${range({ ...i, low: Math.min(i.low, i.high ?? i.low), high: Math.max(i.low, i.high ?? i.low) }, paceText, t(" to "))} /km` : "";
    case "heartRate": { const z = hrZone(mid(i)!, ath.zones); return `${z ? `Z${z} · ` : ""}${range(i)} bpm`; }
    case "power": { const ftp = ath.zones?.ftp; return `${range(i)} W${ftp ? ` · ${range(i, (w) => String(Math.round((w / ftp) * 100)))} % FTP` : ""}`; }
    case "speed": return `${range(i)} km/h`;
    case "cadence": return `${range(i)} /min`;
    case "weight": return `${i.low} kg`;
    case "rpe": return `RPE ${i.low}`;
  }
  return "";
}

/** How long a step is, the way its sport says it. */
function amountWords(s: HubWorkoutStep, sport: HubSport): string {
  const sets = s.sets ?? 1, gym = sport === "strength" || (sport === "hyrox" && (s.sets ?? 0) > 1);
  switch (s.target) {
    case "time": return gym && s.kind === "training" ? `${sets} × ${formatClock(s.seconds ?? 0)}` : formatClock(s.seconds ?? 0);
    case "distance": return sport === "swim" ? `${thousands(Math.round(s.meters ?? 0))} m` : metresText(s.meters ?? 0);
    case "reps": return gym || sets > 1 ? `${sets} × ${s.count ?? 0}` : s.count === 1 ? t("1 rep") : t("{n} reps", { n: s.count ?? 0 });
    case "routes": return s.count === 1 ? tx("climbing", "1 route") : tx("climbing", "{n} routes", { n: s.count ?? 0 });
    case "load": return t("Load {n}", { n: s.load ?? 0 });
    case "hrRecovery": return t("Until {n} bpm", { n: s.bpm ?? 0 });
    case "elevationGain": return t("+{n} m climb", { n: Math.round(s.meters ?? 0) });
    case "open": return gym && s.kind === "training" ? t("{sets} × to lap", { sets }) : t("To lap button");
  }
}

/* ───────────── How long and how hard, for the strip ───────────── */

const EASY_PACE: Partial<Record<HubSport, number>> = { run: 360, trailRun: 420, bike: 130, swim: 1300, xcSki: 240, hyrox: 330 };

/** A strength step's time: about three seconds a rep, the rest between sets. */
function gymSeconds(s: HubWorkoutStep): number {
  const sets = s.sets ?? 1, rest = s.restSeconds ?? 90;
  const one = s.target === "time" ? s.seconds ?? 0 : s.target === "reps" ? (s.count ?? 0) * 3 : 60;
  return Math.max(1, Math.round(sets * one + Math.max(0, sets - 1) * rest));
}

function secondsOf(s: HubWorkoutStep, sport: HubSport, ath: BodyAthlete): number {
  if (s.exercise || (s.sets ?? 0) > 0 || s.target === "reps") return gymSeconds(s);
  if (s.target === "time") return s.seconds ?? 0;
  if (s.target === "distance") {
    const i = s.intensity;
    const pace = i.kind === "pace" && mid(i) ? mid(i)! : i.kind === "speed" && mid(i) ? 3600 / mid(i)! : ath.pacing ? (kindOf(s) === "work" ? ath.pacing.zonePace[Math.min(2, ath.pacing.zonePace.length - 1)] : ath.pacing.easyPace) : EASY_PACE[sport] ?? 330;
    return ((s.meters ?? 0) / 1000) * pace;
  }
  return s.target === "routes" ? (s.count ?? 1) * 180 : 120;
}

/** Height from what the athlete's own numbers say; null when the step's target can't be placed against them. */
function knownHeight(s: HubWorkoutStep, ath: BodyAthlete): number | null {
  const i = s.intensity, m = mid(i);
  if (m == null || !(m > 0)) return null;
  if (i.kind === "pace" && ath.pacing && !ath.pacing.still) return paceIntensity(m, ath.pacing);
  if (i.kind === "heartRate") { const z = hrZone(m, ath.zones); if (z) return ZONE_INTENSITY[Math.max(0, Math.min(ZONE_INTENSITY.length, z) - 1)]; }
  if (i.kind === "power" && ath.zones?.ftp) return Math.max(0.2, Math.min(1, 0.3 + (m / ath.zones.ftp - 0.5) * 0.96));
  return null;
}

const SCALED: HubIntensity["kind"][] = ["pace", "heartRate", "power", "speed", "cadence"];

/** Heights for every step: against the athlete where known, else against the workout's own hardest and easiest step. */
function heights(steps: readonly HubWorkoutStep[], ath: BodyAthlete): number[] {
  const spans = new Map<string, [number, number]>();
  for (const s of steps) {
    const m = mid(s.intensity);
    if (m == null || !SCALED.includes(s.intensity.kind)) continue;
    const was = spans.get(s.intensity.kind);
    spans.set(s.intensity.kind, was ? [Math.min(was[0], m), Math.max(was[1], m)] : [m, m]);
  }
  return steps.map((s) => {
    const kind = kindOf(s), known = knownHeight(s, ath);
    if (known !== null) return known;
    const m = mid(s.intensity), span = spans.get(s.intensity.kind);
    if (m == null || !span) return KIND_HEIGHT[kind];
    if (span[0] === span[1]) return kind === "work" ? 0.78 : KIND_HEIGHT[kind];
    const at = (m - span[0]) / (span[1] - span[0]);
    return 0.4 + (s.intensity.kind === "pace" ? 1 - at : at) * 0.6;
  });
}

/* ───────────── Muscles ───────────── */

type MuscleEntry = { m: [string, number][] };
const EXERCISES = gymMuscles.exercises as unknown as Record<string, MuscleEntry | undefined>;
const FAMILIES = gymMuscles.families as unknown as Record<string, [string, number][] | undefined>;
const plainWords = (text: string): string[] =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
const SLUGS = Object.keys(EXERCISES).map((slug) => ({ slug, words: plainWords(slug) }));
/** Movement words and the family of muscles they train, the most particular first. */
const FAMILY_WORDS: [RegExp, string][] = [
  [/leg curl|hamstring curl|nordic/, "legCurl"], [/calf/, "calfRaise"], [/deadlift|rdl|good morning/, "deadlift"], [/lunge|split squat|step up/, "lunge"],
  [/squat|leg pres/, "squat"], [/hip thrust|glute bridge|hip raise/, "hipRaise"], [/bench|chest pres/, "benchPress"], [/push up|pushup/, "pushUp"],
  [/pull up|pullup|chin up|pulldown|pull down/, "pullUp"], [/shoulder pres|overhead pres|military pres/, "shoulderPress"], [/lateral raise/, "lateralRaise"],
  [/tricep|skull|pushdown/, "tricepsExtension"], [/curl/, "curl"], [/row/, "row"], [/plank/, "plank"], [/crunch/, "crunch"], [/sit up|situp/, "sitUp"],
  [/leg raise|knee raise/, "legRaise"], [/fly/, "flye"], [/shrug/, "shrug"], [/swing/, "hipSwing"], [/carry|farmer/, "carry"], [/clean|snatch|jerk/, "olympicLift"],
  [/jump|bound|hop/, "plyo"], [/hyperextension|back extension/, "hyperextension"],
];

/** The muscles an exercise trains, from the app's own table: the nearest exercise by name, else its movement's family. */
export function musclesFor(name: string): [string, number][] | null {
  const words = plainWords(name), has = new Set(words);
  if (!words.length) return null;
  let best: { slug: string; size: number } | null = null;
  for (const s of SLUGS) if (s.words.every((w) => has.has(w)) && (!best || s.words.length > best.size)) best = { slug: s.slug, size: s.words.length };
  if (best) return EXERCISES[best.slug]!.m;
  const text = words.join(" ");
  for (const [pattern, family] of FAMILY_WORDS) if (pattern.test(text)) return FAMILIES[family] ?? null;
  return null;
}

const MUSCLE_TITLE: Record<string, string> = {
  upperBack: msg("Upper back"), lowerBack: msg("Lower back"), chest: msg("Chest"), shoulders: msg("Shoulders"), biceps: msg("Biceps"), triceps: msg("Triceps"),
  forearms: msg("Forearms"), lats: msg("Lats"), traps: msg("Traps"), abs: msg("Abs"), obliques: msg("Obliques"), core: msg("Core"), glutes: msg("Glutes"),
  quads: msg("Quads"), hamstrings: msg("Hamstrings"), calves: msg("Calves"), adductors: msg("Adductors"), abductors: msg("Abductors"), neck: msg("Neck"),
};
const muscleTitle = (key: string) => t(MUSCLE_TITLE[key] ?? key.charAt(0).toUpperCase() + key.slice(1));

/* ───────────── The body ───────────── */

const stepName = (s: HubWorkoutStep, sport: HubSport): string => {
  const kind = kindOf(s);
  if (s.exercise?.name ?? s.name) return (s.exercise?.name ?? s.name)!;
  if (sport === "hyrox" && kind === "work") return s.target === "distance" ? tx("step", "Run") : t("Station");
  if ((sport === "indoorClimb" || sport === "bouldering") && kind === "work") return sport === "bouldering" ? t("Boulders") : tx("step", "Climb");
  if (sport === "swim" && kind === "work") return tx("step", "Swim");
  return t(KIND_WORDS[kind]);
};

/** A HYROX station is a training step with an exercise or a name; a run is one without. */
const isStation = (s: HubWorkoutStep) => s.kind === "training" && (!!s.exercise || !!s.name || s.target === "reps");

/**
 * The card body for a workout. `w` is the workout as COROS would hold it; a gym exercise that isn't from COROS's
 * list carries its name in `name`.
 */
export function workoutBody(w: HubWorkout, ath: BodyAthlete = {}): WorkoutBody {
  const sport = w.sport, flat = w.blocks.flatMap((b) => b.steps);
  const kind = bodyKindFor(sport, flat.length), climbing = kind === "climb";
  const tall = heights(flat, ath);
  let n = 0, station = 0;
  const list: BodyGroup[] = [], strip: BodyStrip[] = [];
  for (const b of w.blocks) {
    const repeats = b.repeats ?? 1, rows: BodyRow[] = [], segs: BodySeg[] = [];
    for (const s of b.steps) {
      const k = kindOf(s), swim = sport === "swim";
      const stroke = swim && s.intensity.kind === "stroke" ? targetWords(s.intensity) : "";
      const row: BodyRow = {
        kind: k, name: swim && k === "work" && !s.name ? stroke || tx("step", "Swim") : stepName(s, sport), amount: amountWords(s, sport),
        // COROS has every climbing step carry a grade, rests too; a rest's grade says nothing.
        target: (swim && k === "work" && !s.name) || (climbing && s.kind === "rest") ? "" : targetWords(s.intensity, ath), rest: s.restSeconds ? restWords(s.restSeconds) : "",
      };
      if (sport === "hyrox" && isStation(s)) row.mark = ++station;
      if (s.target === "routes") row.mark = s.count ?? 0;
      rows.push(row);
      segs.push({ kind: k, weight: Math.max(1, Math.round(secondsOf(s, sport, ath))), height: tall[n++] });
    }
    const lead = b.steps.findIndex((s) => s.kind === "training"), at = lead < 0 ? 0 : lead;
    strip.push({ repeats, amount: `${repeats > 1 ? `${repeats} × ` : ""}${rows[at].amount}`, target: rows[at].target, segs });
    // A swimmer reads the rest with the repeat it follows: "8 × 100 m freestyle, 20 s rest".
    const kept = sport !== "swim" ? rows : rows.filter((r, i) => {
      const s = b.steps[i], before = i > 0 ? rows[i - 1] : null;
      if (!(before && s.kind === "rest" && s.target === "time" && s.intensity.kind === "none" && before.kind !== "rest")) return true;
      before.rest = restWords(s.seconds ?? 0);
      return false;
    });
    list.push({ repeats, rows: kept });
  }

  const body: WorkoutBody = { kind, unit: "steps", count: flat.length, list, label: "" };
  const said = (g: BodyGroup) => {
    const rows = g.rows.map((r) => [r.name, r.amount, r.target, r.rest].filter(Boolean).join(" ")).join(", ");
    return g.repeats > 1 ? t("{n} times: {steps}", { n: g.repeats, steps: rows }) : rows;
  };
  const all = list.map(said).join("; ");
  body.label = kind === "strength" ? t("Exercises: {list}", { list: all }) : kind === "swim" ? t("Sets: {list}", { list: all }) : t("The workout: {list}", { list: all });

  if (kind === "strength") {
    const work = w.blocks.flatMap((b) => b.steps.filter((s) => s.kind === "training").map((s) => ({ s, times: b.repeats ?? 1 })));
    body.unit = "exercises";
    body.count = work.length;
    const known = work.map(({ s, times }) => ({ workingSets: (s.sets ?? 1) * times, muscles: musclesFor(s.exercise?.name ?? s.name ?? "") }));
    // Muscles are listed only when every exercise is one the app's table knows; a partial list would mislead.
    if (known.length && known.every((k) => k.muscles)) {
      const worked = muscleWork(known.map((k) => ({ workingSets: k.workingSets, muscles: k.muscles! })));
      const top = worked[0]?.sets ?? 1;
      body.shares = worked.slice(0, 8).map((m) => ({ name: muscleTitle(m.name), value: String(Number(m.sets.toFixed(1))), share: m.sets / top }));
      body.sharesLabel = t("Muscles, by sets");
      body.works = worked.slice(0, 3).map((m) => muscleTitle(m.name).toLowerCase());
    }
    Object.assign(body, strengthLines(w, ath.lifts ?? null));
    const sets = work.reduce((n, { s, times }) => n + (s.sets ?? 1) * times, 0);
    const about = Math.round(w.blocks.reduce((sum, b) => sum + b.steps.reduce((t, s) => t + secondsOf(s, sport, ath), 0) * (b.repeats ?? 1), 0) / 60);
    body.line = [work.length === 1 ? t("1 lift") : t("{n} lifts", { n: work.length }), sets === 1 ? t("1 set") : t("{n} sets", { n: sets }), about > 0 ? t("about {n} min", { n: about }) : ""].filter(Boolean).join(" · ");
  } else if (kind === "intervals") {
    body.strip = strip;
    const ftp = sport === "bike" ? ath.zones?.ftp : undefined;
    if (ftp) {
      const time = POWER_ZONES.map(() => 0);
      let all = 0;
      w.blocks.forEach((b, bi) => b.steps.forEach((s, si) => {
        const m = s.intensity.kind === "power" ? mid(s.intensity) : null;
        if (m == null) return;
        const seconds = strip[bi].segs[si].weight * (b.repeats ?? 1);
        time[powerZone(m / ftp)] += seconds;
        all += seconds;
      }));
      if (all > 0) {
        body.shares = POWER_ZONES.map(([name], i) => ({ name, value: formatClock(time[i]), share: time[i] / all })).filter((z) => z.share > 0);
        body.sharesLabel = t("Time in power zones, FTP {ftp} W", { ftp });
      }
    }
  } else if (kind === "swim") {
    body.unit = "sets";
    body.count = list.length;
    const by = new Map<string, number>();
    let longest = 1;
    w.blocks.forEach((b, bi) => {
      let metres = 0;
      for (const s of b.steps) {
        if (s.target !== "distance") continue;
        const m = (s.meters ?? 0) * (b.repeats ?? 1);
        metres += m;
        const stroke: HubStroke | "any" = s.intensity.kind === "stroke" && s.intensity.stroke ? s.intensity.stroke : "any";
        by.set(stroke, (by.get(stroke) ?? 0) + m);
      }
      list[bi].rows[0].bar = metres;
      longest = Math.max(longest, metres);
    });
    for (const g of list) g.rows[0].bar = (g.rows[0].bar ?? 0) / longest;
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    if (total > 0 && by.size > 1) {
      body.shares = [...by].sort((a, b) => b[1] - a[1]).map(([name, m]) => ({ name: t(STROKE_TITLES[name as HubStroke | "any"]), value: `${thousands(Math.round(m))} m`, share: m / total }));
      body.sharesLabel = t("Metres by stroke");
    }
  } else if (kind === "hyrox") {
    body.unit = station ? "stations" : "steps";
    if (station) body.count = station;
  }
  return body;
}

/** Planned metres, timed seconds, sets, routes and stations of a workout, counting repeats. */
export function workoutCounts(w: HubWorkout): { metres: number; seconds: number; sets: number; routes: number; runMetres: number; open: boolean } {
  const out = { metres: 0, seconds: 0, sets: 0, routes: 0, runMetres: 0, open: false };
  for (const b of w.blocks) for (const s of b.steps) {
    const times = b.repeats ?? 1;
    if (s.target === "time") out.seconds += (s.seconds ?? 0) * (s.sets ?? 1) * times;
    else if (s.target === "distance") { out.metres += (s.meters ?? 0) * times; if (!s.exercise && !s.name) out.runMetres += (s.meters ?? 0) * times; }
    else if (s.target === "routes") out.routes += (s.count ?? 0) * times;
    else if (s.target !== "reps") out.open = true;
    if (s.kind === "training" && (s.exercise || s.sets || s.target === "reps")) out.sets += (s.sets ?? 1) * times;
  }
  return out;
}

/**
 * The figures over a card's picture, where the sport reads them differently from a run: a swim in metres and
 * lengths of its pool, the gym in exercises and sets, climbing in routes, HYROX in stations and running.
 * Null leaves the card's own figures as they are.
 */
export function sportStats(w: HubWorkout, body: WorkoutBody, ath: BodyAthlete = {}): CardStat[] | null {
  const c = workoutCounts(w);
  const about = (): number => w.blocks.reduce((sum, b) => sum + b.steps.reduce((t, s) => t + secondsOf(s, w.sport, ath), 0) * (b.repeats ?? 1), 0);
  if (body.kind === "strength") {
    return [{ label: t("Exercises"), value: String(body.count) }, { label: t("Sets"), value: String(c.sets) }, { label: t("Time, about"), value: formatClock(Math.round(about())) }];
  }
  if (w.sport === "swim" && c.metres > 0) {
    const pool = w.poolLength ?? 25, lengths = c.metres / pool;
    const stats: CardStat[] = [{ label: t("Distance"), value: thousands(Math.round(c.metres)), unit: "m" }];
    if (Number.isInteger(lengths)) stats.push({ label: t("Lengths, {pool} m pool", { pool }), value: String(lengths) });
    if (ath.pacing) stats.push({ label: t("Time, about"), value: formatClock(Math.round(about())) });
    return stats;
  }
  if (body.kind === "climb") {
    const stats: CardStat[] = [];
    if (c.routes > 0) stats.push({ label: tx("climbing", "Routes"), value: String(c.routes) });
    if (c.seconds > 0) stats.push({ label: c.routes > 0 || c.open ? t("Timed steps") : t("Time"), value: formatClock(c.seconds) });
    return stats;
  }
  if (body.kind === "hyrox") {
    const stats: CardStat[] = [];
    if (body.unit === "stations") stats.push({ label: t("Stations"), value: String(body.count) });
    if (c.runMetres > 0) stats.push({ label: t("Running"), value: (c.runMetres / 1000).toFixed(2), unit: "km" });
    return stats;
  }
  return null;
}
