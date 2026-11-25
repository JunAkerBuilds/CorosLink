// The athlete's heart rate and pace zones and their goal race, from wherever they can honestly be read. Pure.
// - The phone: `view.training.hrZones` (the zones set on the watch) and `view.training.goalRaces`, once a phone
//   build sends them (docs/sync-contract.md 5.5).
// - COROS Training Hub, when it is connected: the zones COROS itself works out from threshold heart rate and
//   threshold pace (`/dashboard/query`), and the heart rate numbers on the account (`/account/query`).
// COROS has no goal race; without one from the phone, Coach asks and remembers the answer.
import type { ViewTrainingBody } from "@/data/sync/native";
import { clock as clockText } from "@/lib/format";
import { dayLabel, finite, isDay, quoted } from "./items";

export interface HrZone { zone: number; fromBpm: number | null; toBpm: number | null }
export interface PaceZone { zone: number; fromSecPerKm: number | null; toSecPerKm: number | null }

export interface AthleteZones {
  /** Where they were read. */
  source: "phone" | "coros";
  /** What the heart rate zones are set from, in words: "max heart rate", "threshold heart rate". */
  basis?: string;
  hr: HrZone[];
  /** Slowest zone first. `fromSecPerKm` is the slower end. */
  pace: PaceZone[];
  thresholdHr?: number;
  maxHr?: number;
  restingHr?: number;
  thresholdPaceSecPerKm?: number;
  ftp?: number;
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const positive = (v: unknown): number | undefined => (finite(v) && v > 0 ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : undefined);
const first = (bags: (Record<string, unknown> | undefined)[], keys: string[]): number | undefined => {
  for (const bag of bags) for (const key of keys) { const v = positive(bag?.[key]); if (v !== undefined) return v; }
  return undefined;
};

/** Zones whose items carry each zone's lower bound: a zone ends one below where the next begins. */
function fromLowerBounds(lows: number[]): HrZone[] {
  return lows.map((low, i) => ({ zone: i + 1, fromBpm: Math.round(low), toBpm: i + 1 < lows.length ? Math.round(lows[i + 1]) - 1 : null }));
}

/**
 * What COROS Training Hub says. `dashboard` is the `data` of `/dashboard/query`, `account` of `/account/query`.
 * COROS's zone lists hold one entry per zone with where it starts (`hr` in bpm, `pace` in seconds per km).
 * Null when neither holds a zone or a threshold.
 */
export function zonesFromHub(dashboard: unknown, account: unknown): AthleteZones | null {
  const summary = isBag(dashboard) && isBag(dashboard.summaryInfo) ? dashboard.summaryInfo : undefined;
  const acct = isBag(account) ? account : undefined;
  let zoneData: Record<string, unknown> | undefined;
  const rawZone = acct?.zoneData;
  if (isBag(rawZone)) zoneData = rawZone;
  else if (typeof rawZone === "string") { try { const parsed: unknown = JSON.parse(rawZone); if (isBag(parsed)) zoneData = parsed; } catch { /* not JSON: ignored */ } }
  const sorted = (list: unknown, key: string, ascending: boolean): number[] => {
    if (!Array.isArray(list)) return [];
    const values = list.map((z) => (isBag(z) ? positive(z[key]) : undefined)).filter((v): v is number => v !== undefined);
    return [...new Set(values)].sort((a, b) => (ascending ? a - b : b - a));
  };
  const lthrZone = summary?.lthrZone ?? zoneData?.lthrZone ?? acct?.lthrZone;
  const hrLows = sorted(lthrZone, "hr", true);
  const paceLows = sorted(summary?.ltspZone ?? lthrZone, "pace", false);
  let pace = first([summary], ["ltsp"]) ?? first([zoneData, acct], ["thresholdPace", "thresholdPaceSeconds"]);
  if (pace !== undefined && pace > 10_000) pace /= 1000;
  const out: AthleteZones = {
    source: "coros", basis: hrLows.length ? "threshold heart rate" : undefined,
    hr: hrLows.length >= 3 && hrLows.every((v) => v >= 30 && v <= 250) ? fromLowerBounds(hrLows) : [],
    pace: paceLows.length >= 3 && paceLows.every((v) => v >= 120 && v <= 1200)
      ? paceLows.map((slow, i) => ({ zone: i + 1, fromSecPerKm: slow, toSecPerKm: i + 1 < paceLows.length ? paceLows[i + 1] : null })) : [],
    thresholdHr: first([summary], ["lthr"]) ?? first([zoneData, acct], ["lthr", "thresholdHr"]),
    maxHr: first([zoneData, acct], ["maxHr", "maxHeartRate"]) ?? first([summary], ["fitnessMaxHr"]),
    restingHr: first([zoneData, acct], ["restingHr", "restHr"]) ?? first([summary], ["rhr"]),
    thresholdPaceSecPerKm: pace !== undefined && pace >= 120 && pace <= 1200 ? pace : undefined,
    ftp: first([zoneData, acct], ["ftp", "cycleFtp"]),
  };
  const has = out.hr.length || out.pace.length || out.thresholdHr || out.maxHr || out.thresholdPaceSecPerKm || out.ftp;
  return has ? out : null;
}

const BASIS: Record<string, string> = { maxHr: "max heart rate", reserve: "heart rate reserve", threshold: "threshold heart rate" };

/** The zones the phone sent with its training view (the ones set on the watch), or null when it sent none. */
export function zonesFromPhone(view: ViewTrainingBody | undefined): AthleteZones | null {
  const z = view?.hrZones;
  if (!z || !Array.isArray(z.zones)) return null;
  const hr = z.zones
    .filter((x) => x && finite(x.zone) && (x.fromBpm === null || finite(x.fromBpm)) && (x.toBpm === null || finite(x.toBpm)))
    .map((x) => ({ zone: x.zone, fromBpm: x.fromBpm ?? null, toBpm: x.toBpm ?? null }))
    .sort((a, b) => a.zone - b.zone);
  return hr.length ? { source: "phone", basis: z.basis ? BASIS[z.basis] : undefined, hr, pace: [] } : null;
}

const pace = (s: number) => clockText(s, s % 1 ? 2 : 0);

/** Zones as lines for the model. Empty when there are none. */
export function zoneLines(z: AthleteZones | null): string[] {
  if (!z) return [];
  const from = z.source === "phone" ? "set on the watch" : "from COROS Training Hub";
  const out: string[] = [];
  if (z.hr.length) {
    out.push(`Heart rate zones (${from}${z.basis ? `, by ${z.basis}` : ""}): ${z.hr.map((h) => `Z${h.zone} ${h.fromBpm === null ? `below ${h.toBpm}` : h.toBpm === null ? `${h.fromBpm} and above` : `${h.fromBpm}–${h.toBpm}`} bpm`).join(", ")}`);
  }
  if (z.pace.length) {
    out.push(`Pace zones (${from}, by threshold pace): ${z.pace.map((p) => `Z${p.zone} ${p.toSecPerKm === null ? `${pace(p.fromSecPerKm!)} /km and faster` : `${pace(p.fromSecPerKm!)}–${pace(p.toSecPerKm)} /km`}`).join(", ")}`);
  }
  if (z.source === "coros") {
    const more: string[] = [];
    if (z.thresholdHr) more.push(`threshold heart rate ${z.thresholdHr} bpm`);
    if (z.maxHr) more.push(`max heart rate ${z.maxHr} bpm`);
    if (z.restingHr) more.push(`resting heart rate ${z.restingHr} bpm`);
    if (z.thresholdPaceSecPerKm) more.push(`threshold pace ${pace(z.thresholdPaceSecPerKm)} /km`);
    if (z.ftp) more.push(`FTP ${z.ftp} W`);
    if (more.length) out.push(`COROS Training Hub also has: ${more.join(", ")}`);
  }
  return out;
}

/** The races the athlete is training for, soonest first, from the phone. Past ones are left out. */
export function raceLines(view: ViewTrainingBody | undefined, today: string): string[] {
  const races = Array.isArray(view?.goalRaces) ? view.goalRaces : [];
  return races
    .filter((r) => r && isDay(r.day) && r.day >= today && typeof r.name === "string")
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(0, 5)
    .map((r) => [quoted(r.name, 60), `${dayLabel(r.day)} ${r.day.slice(0, 4)}`, finite(r.distanceMeters) ? `${(r.distanceMeters / 1000).toFixed(1)} km` : "", finite(r.goalSeconds) ? `goal ${clockText(r.goalSeconds)}` : ""].filter(Boolean).join(" · "));
}
