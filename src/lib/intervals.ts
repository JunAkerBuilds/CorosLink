// Import from intervals.icu, the pure parts: reading its activity list, deciding what is already on COROS, the
// range of days to ask for, and how a row is written. Ported from the desktop app (CorosLink
// electron/intervalsService.ts and intervalsMatch.ts).

export interface MatchableActivity {
  startEpochMs: number;
  movingSec: number;
  distanceM: number;
}

export interface IntervalsActivity extends MatchableActivity {
  intervalsId: string;
  name: string;
  /** intervals.icu's own type name (Run, VirtualRide, Swim…). */
  type: string;
  fileExt: "fit" | "tcx" | "unknown";
}

export interface IntervalsRow extends IntervalsActivity { onCoros: boolean }

export const START_TOLERANCE_MS = 180_000; // ±3 minutes
export const DURATION_TOLERANCE = 0.05; // ±5%
export const DISTANCE_TOLERANCE = 0.05; // ±5%

function within(a: number, b: number, ratio: number): boolean {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  return larger === 0 ? true : Math.abs(a - b) / larger <= ratio;
}

/** Start within 3 minutes, time within 5%, and distance within 5% when both sides have one. */
export function isAlreadyOnCoros(intervals: MatchableActivity, coros: readonly MatchableActivity[]): boolean {
  return coros.some((c) => {
    if (Math.abs(intervals.startEpochMs - c.startEpochMs) > START_TOLERANCE_MS) return false;
    if (!within(intervals.movingSec, c.movingSec, DURATION_TOLERANCE)) return false;
    return intervals.distanceM > 0 && c.distanceM > 0 ? within(intervals.distanceM, c.distanceM, DISTANCE_TOLERANCE) : true;
  });
}

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function fileExtOf(raw: Bag): IntervalsActivity["fileExt"] {
  const file = isBag(raw.source_file) ? raw.source_file.type : undefined;
  const type = String(file ?? raw.source ?? "").toLowerCase();
  return type.includes("fit") ? "fit" : type.includes("tcx") ? "tcx" : "unknown";
}

/**
 * intervals.icu's activity list as rows. Elapsed time is preferred over moving time because COROS's list only
 * has elapsed time: comparing one against the other would call a ride with stops "missing".
 */
export function parseIntervalsActivities(raw: unknown): IntervalsActivity[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isBag).filter((a) => typeof a.id === "string" || typeof a.id === "number").map((a) => {
    const start = a.start_date ?? a.startDate ?? a.start_date_local ?? "";
    const startEpochMs = typeof start === "string" && start !== "" ? Date.parse(start) : NaN;
    return {
      intervalsId: String(a.id),
      name: typeof a.name === "string" && a.name.trim() !== "" ? a.name.slice(0, 200) : "Unnamed",
      startEpochMs: Number.isFinite(startEpochMs) ? startEpochMs : 0,
      movingSec: count(a.elapsed_time ?? a.elapsedTime ?? a.moving_time ?? a.movingTime),
      distanceM: count(a.distance),
      type: typeof a.type === "string" ? a.type.slice(0, 60) : "",
      fileExt: fileExtOf(a),
    };
  });
}

/** Marks each activity that COROS already has. */
export function withStatus(activities: readonly IntervalsActivity[], coros: readonly MatchableActivity[]): IntervalsRow[] {
  return activities.map((a) => ({ ...a, onCoros: isAlreadyOnCoros(a, coros) }));
}

/** COROS takes a while to list an import, so what was imported here counts as "on COROS" for this long. */
export const RECENT_IMPORT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The ids imported within `withinMs` of `now`, from a map of id to when it was imported. */
export function filterRecentIds(map: Readonly<Record<string, number>>, now: number, withinMs: number): string[] {
  return Object.entries(map).filter(([, importedAt]) => typeof importedAt === "number" && now - importedAt <= withinMs).map(([id]) => id);
}

export const IMPORT_RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
] as const;
export type ImportDays = (typeof IMPORT_RANGES)[number]["days"];
export const DEFAULT_IMPORT_DAYS: ImportDays = 30;

export const isImportDays = (value: unknown): value is ImportDays => IMPORT_RANGES.some((r) => r.days === value);

const DAY_MS = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The days to ask each side for. intervals.icu gets `daysBack` days ending tomorrow by UTC: it reads the dates
 * as the athlete's own, so someone ahead of UTC still sees this morning's activities. COROS gets one more day on each side as YYYYMMDD, so a time-zone edge can only widen what is compared.
 */
export function importWindow(daysBack: number, now: number = Date.now()): { oldest: string; newest: string; corosFrom: string; corosTo: string } {
  return {
    oldest: isoDay(now - daysBack * DAY_MS), newest: isoDay(now + DAY_MS),
    corosFrom: isoDay(now - (daysBack + 1) * DAY_MS).replace(/-/g, ""), corosTo: isoDay(now + DAY_MS).replace(/-/g, ""),
  };
}

/** A row's distance: metres for a swim, kilometres to the hundredth otherwise, a dash when there is none. */
export function importDistance(row: Pick<IntervalsActivity, "distanceM" | "type">): string {
  if (!(row.distanceM > 0)) return "—";
  if (row.type.toLowerCase().includes("swim")) return `${Math.round(row.distanceM).toLocaleString("en-US")} m`;
  return `${(row.distanceM / 1000).toFixed(2)} km`;
}

/** "8 activities loaded · 4 missing from COROS". */
export function importSummary(rows: readonly IntervalsRow[]): string {
  const missing = rows.filter((r) => !r.onCoros).length;
  const loaded = `${rows.length} ${rows.length === 1 ? "activity" : "activities"} loaded`;
  return missing > 0 ? `${loaded} · ${missing} missing from COROS` : `${loaded} · everything is on COROS`;
}
