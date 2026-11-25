import { fromCoros, fromSample, fromSynced, type Loaded } from "./core";
import { hubCalendar, hubSession } from "./hub";
import { sampleSports } from "./sample/sports";
import { syncView } from "./sync";
import { plannedFromHub, sportsFromItems, type PlannedWorkout } from "./sync/sports";
import type { Family } from "@/lib/sports";
import { dayKey } from "@/lib/format";

/** How a reading reads: mint for good, gold for something to look at, grey otherwise. */
export type Tone = "good" | "attention" | "neutral";
export interface Chip { tone: Tone; text: string }
export interface Figure { value: string; label: string }

/** The colour a sport or a reading is drawn in (`data-hue` in sports.css). */
export type Hue = "run" | "ride" | "swim" | "strength" | "gold" | "rose" | "coral" | "violet" | "slate";

/** One of the four tiles under the hero. `href` is the section it jumps to. */
export interface Tile { label: string; chip: Chip | null; value: string; unit: string; spark: number[] | null; hue: Hue; text: string; href: string }

/** One bar: its value label, its one or two axis labels, and a planned amount drawn as a dashed outline on top. */
export interface Bar { value: number; top: string; label: string; sub?: string; planned?: number; now?: boolean; over?: boolean }
export interface BarChart { bars: Bar[]; /** A dashed line across the chart, with its legend text. */ line: { value: number; text: string } | null; planned: boolean; label: string }

/** A line with a soft area. `labels` are the right-hand scale (top, middle, bottom) and `dates` the first, middle and last. */
export interface LineChart { values: number[]; marks: string[]; dates: string[]; label: string; /** Lower values are drawn higher (a time getting faster). */ flip?: boolean }

/** A section's head: the phone's section name, its chip, how it is read, and its headline. */
export interface Reading { chip: Chip | null; headline: string; sub: string | null }

/** A section with nothing to show, and why: the phone's own "needs" line, or "Nothing from your phone yet". */
export interface Missing { missing: string }
export const isMissing = (v: unknown): v is Missing => typeof v === "object" && v !== null && "missing" in v;

export interface SplitShare { name: string; percent: number; detail: string; hue: Hue }

/* ───────────── Hub ───────────── */

export interface HubRing { family: Family; name: string; percent: number | null; value: string; of: string | null; href: string; label: string }
export interface Standout { family: Family; title: string; detail: string; chip: Chip; href: string }
export interface HubCard { family: Family; name: string; headline: string; spark: number[] | null; figures: Figure[]; href: string }
export interface HoursWeek { /** The week's Monday, YYYY-MM-DD. */ start: string; label: string; sub?: string; total: number; parts: { family: Family; hours: number }[]; planned: number; now: boolean }

export interface SportsHub {
  day: string;
  range: string;
  headline: string;
  text: string | null;
  figures: Figure[];
  rings: HubRing[];
  standouts: Standout[];
  hours: { weeks: HoursWeek[]; total: string; label: string; families: Family[]; planned: boolean };
  cards: HubCard[];
  also: { name: string; sessions: string; time: string; last: string }[];
}

/* ───────────── Running ───────────── */

export interface RunPage {
  hero: { ring: { percent: number; label: string } | null; chip: string; headline: string; text: string | null; figures: Figure[]; chart: BarChart; chartTitle: string };
  tiles: Tile[];
  much: Reading & {
    weeks: BarChart;
    days: BarChart;
    long: { limit: string; last: string; lastOver: boolean; longest: string; runs: BarChart } | null;
  };
  coach: { headline: string; next: { title: string; chips: string[] } | null; facts: Figure[] };
  hard: (Reading & { split: SplitShare[]; weeks: { label: string; runs: { kind: string; day: number }[]; today: number | null }[] }) | Missing;
  engine: (Reading & { trend: LineChart | null; predictions: { name: string; time: string; change: string | null; focus: boolean }[]; vo2: string | null; vo2Change: string | null; /** Shown marked "Sample data" while the six-week history has no source. */ sampleTrend: { chart: LineChart; text: string } | null; marks: Figure[]; bests: { name: string; value: string; date: string; fresh: boolean }[] }) | Missing;
  durability: (Reading & { points: { top: string; label: string; percent: number; held: boolean }[]; label: string }) | Missing;
  efficiency: (Reading & { chart: LineChart }) | Missing;
}

/* ───────────── Riding ───────────── */

export interface PowerTile { name: string; watts: string; perKg: string | null; note: string; best: boolean }

export interface RidePage {
  hero: {
    chip: string; headline: string; text: string | null; figures: Figure[];
    curve: { recent: (number | null)[]; best: number[]; marks: number[]; tiles: PowerTile[]; label: string } | Missing;
  };
  tiles: Tile[];
  much: Reading & { weeks: BarChart; figures: Figure[] };
  climb: (Reading & { weeks: BarChart; /** Marked "Sample data": climbs are not found in recordings on the web. */ sampleBiggest: { title: string; detail: string; tag: string; rate: string } | null }) | Missing;
  zones: (Reading & { rows: { zone: string; name: string; range: string; percent: number; text: string; hue: Hue }[] }) | Missing;
  ftp: (Reading & { trend: LineChart | null; figures: Figure[] }) | Missing;
  vo2: (Reading & { figures: Figure[] }) | Missing;
  balance: (Reading & { split: SplitShare[]; note: string }) | Missing;
  perBeat: (Reading & { chart: LineChart | null }) | Missing;
  records: { name: string; value: string; date: string }[];
}

/* ───────────── Swimming ───────────── */

export interface SwimPage {
  hero: { chip: string; headline: string; text: string | null; figures: Figure[]; lanes: { label: string; value: string; share: number; now: boolean }[]; lanesLabel: string };
  tiles: Tile[];
  /** `sample` marks a whole card that is the sample athlete's; `sampleTrend` a block inside a real one. */
  css: Reading & { sample?: boolean; bands: { name: string; text: string; hue: Hue }[]; sampleTrend: LineChart | null };
  /** Each swim's average pace per 100 m, rests included: all the activity list can say. */
  pace: (Reading & { chart: LineChart | null }) | Missing;
  /** SWOLF and the stroke mix need each length of the pool, which no synced item holds: always the sample athlete's, marked so. */
  swolf: Reading & { compare: Figure[]; chart: LineChart; stats: Figure[] };
  strokes: Reading & { rows: SplitShare[] };
  records: Reading & { sample?: boolean; rows: { name: string; value: string; date: string; fresh: boolean }[] };
}

export interface Sports {
  /** The person's sports, most time first, worked out from the last 90 days. Empty when nothing is known: everything shows. */
  families: Family[];
  hub: SportsHub;
  run: RunPage | null;
  ride: RidePage | null;
  swim: SwimPage | null;
}

/** What Training Hub has planned for the rest of this week, when it is connected. A failure there leaves the plan out. */
async function plannedThisWeek(now: Date): Promise<{ planned: PlannedWorkout[]; hub: boolean }> {
  try {
    const session = await hubSession();
    if (session.state !== "signedIn") return { planned: [], hub: false };
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { planned: plannedFromHub((await hubCalendar(dayKey(monday), dayKey(sunday))).data), hub: true };
  } catch {
    return { planned: [], hub: false };
  }
}

/**
 * The Sports hub and the Running, Riding and Swimming pages, worked out in the browser from what the phone synced
 * (activities, recordings, the training view) and, when Training Hub is connected, this week's planned workouts.
 */
export async function loadSports(): Promise<Loaded<Sports>> {
  const view = await syncView();
  if (!view) return fromSample(sampleSports());
  const now = new Date();
  const { planned, hub } = await plannedThisWeek(now);
  const data = sportsFromItems({
    activities: view.all("activity").map((i) => i.body),
    details: view.all("activity.detail").map((i) => ({ id: i.id, body: i.body })),
    training: view.get("view.training", "me"),
    strength: view.get("view.strength", "me"),
    body: view.get("view.body", "me"),
    gym: view.all("gym.workout").map((i) => i.body),
    planned,
  }, now);
  return hub && planned.length ? fromCoros(data) : fromSynced(data);
}

/** What a Coach question opens: the Coach page with the question in its message box. */
export const coachHref = (question: string): string => `/coach?ask=${encodeURIComponent(question)}`;
