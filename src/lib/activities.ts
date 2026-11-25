/** Pure maths for the Activities table and the activity page: filtering, sorting, CSV, laps, routes, sample streams. */
import type { Activity, ActivityDetail, ChartScales, Lap, PlacedPoint, RoutePoint, Sport, Streams, ZoneTime } from "@/data/activities";
import { clock, thousands } from "@/lib/format";

// ---------------------------------------------------------------- formatting

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parses a local `YYYY-MM-DDTHH:MM` start without going through UTC. */
export function parseStart(start: string): Date {
  const [day, time = "00:00"] = start.split("T");
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

/** Thu 19 Nov */
export function formatDay(start: string): string {
  const d = parseStart(start);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Thu 19 Nov 2026, 07:42 */
export function formatDayTime(start: string): string {
  const d = parseStart(start);
  return `${formatDay(start)} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type PaceUnit = "min/km" | "km/h" | "min/100m";

export function paceUnit(sport: Sport): PaceUnit | null {
  return sport === "Run" ? "min/km" : sport === "Ride" ? "km/h" : sport === "Swim" ? "min/100m" : null;
}

/** Pace or speed over a distance and time, in the sport's own unit (see `PaceUnit`). */
export function paceOver(sport: Sport, distanceM: number | null, durationS: number): number | null {
  const unit = paceUnit(sport);
  if (!unit || !distanceM || distanceM <= 0 || durationS <= 0) return null;
  if (unit === "km/h") return distanceM / 1000 / (durationS / 3600);
  return durationS / (distanceM / (unit === "min/km" ? 1000 : 100));
}

/** A pace or speed value with its unit: 4:46 /km, 25.4 km/h, 2:05 /100 m. */
export function formatPaceValue(sport: Sport, value: number | null, decimals = 0): string {
  const unit = paceUnit(sport);
  if (value == null || !unit) return "—";
  if (unit === "km/h") return `${value.toFixed(decimals || 1)} km/h`;
  return `${clock(value, decimals)} ${unit === "min/km" ? "/km" : "/100 m"}`;
}

export function formatPace(a: Activity): string {
  return formatPaceValue(a.sport, paceOver(a.sport, a.distanceM, a.durationS));
}

/** 8.02 km for runs, 24.6 km for rides, 1,500 m for swims. */
export function formatDistance(a: Pick<Activity, "sport" | "distanceM">): string {
  if (a.distanceM == null) return "—";
  if (a.sport === "Swim") return `${thousands(a.distanceM)} m`;
  return `${(a.distanceM / 1000).toFixed(a.sport === "Ride" ? 1 : 2)} km`;
}

/** Table time: whole seconds as the watch shows them, cut rather than rounded up. */
export function formatTime(seconds: number): string {
  return clock(Math.floor(seconds + 1e-9));
}

export function formatElevation(m: number | null): string {
  return m == null ? "—" : `${m > 0 ? "+" : m < 0 ? "−" : ""}${Math.abs(m)} m`;
}

// ------------------------------------------------------- filters and sorting

export type DateRange = "30d" | "90d" | "year" | "all";
export type DistanceBand = "any" | "under5" | "5to10" | "over10";
export type SortKey = "date" | "name" | "sport" | "distance" | "time" | "pace" | "hr" | "elevation" | "cadence" | "load";
export type SortDir = "asc" | "desc";

export interface Filters {
  q: string;
  sport: Sport | "all";
  dates: DateRange;
  distance: DistanceBand;
  sort: SortKey;
  dir: SortDir;
  page: number;
}

export const DEFAULT_FILTERS: Filters = { q: "", sport: "all", dates: "30d", distance: "any", sort: "date", dir: "desc", page: 1 };

export const DATE_RANGES: readonly { value: DateRange; label: string; tail: string }[] = [
  { value: "30d", label: "Last 30 days", tail: "in the last 30 days" },
  { value: "90d", label: "Last 90 days", tail: "in the last 90 days" },
  { value: "year", label: "This year", tail: "this year" },
  { value: "all", label: "All time", tail: "" },
];

export const DISTANCE_BANDS: readonly { value: DistanceBand; label: string }[] = [
  { value: "any", label: "Any distance" },
  { value: "under5", label: "Under 5 km" },
  { value: "5to10", label: "5 to 10 km" },
  { value: "over10", label: "Over 10 km" },
];

const SORT_KEYS: readonly SortKey[] = ["date", "name", "sport", "distance", "time", "pace", "hr", "elevation", "cadence", "load"];
const SPORT_VALUES: readonly Sport[] = ["Run", "Ride", "Strength", "Swim", "Other"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Every word typed must appear somewhere in the activity's name. */
export function matchesSearch(a: Pick<Activity, "name">, q: string): boolean {
  const name = fold(a.name);
  return fold(q).split(/\s+/).filter(Boolean).every((word) => name.includes(word));
}

export function inDateRange(a: Pick<Activity, "start">, range: DateRange, today: Date): boolean {
  if (range === "all") return true;
  const d = parseStart(a.start);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d >= end) return false;
  if (range === "year") return d.getFullYear() === today.getFullYear();
  const days = range === "30d" ? 30 : 90;
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return d >= from;
}

export function inDistanceBand(a: Pick<Activity, "distanceM">, band: DistanceBand): boolean {
  if (band === "any") return true;
  if (a.distanceM == null) return false;
  if (band === "under5") return a.distanceM < 5000;
  if (band === "5to10") return a.distanceM >= 5000 && a.distanceM <= 10000;
  return a.distanceM > 10000;
}

export function filterActivities(list: readonly Activity[], f: Pick<Filters, "q" | "sport" | "dates" | "distance">, today: Date): Activity[] {
  return list.filter(
    (a) => (f.sport === "all" || a.sport === f.sport) && inDateRange(a, f.dates, today) && inDistanceBand(a, f.distance) && matchesSearch(a, f.q),
  );
}

function sortValue(a: Activity, key: SortKey): number | string | null {
  switch (key) {
    case "date": return a.start;
    case "name": return fold(a.name);
    case "sport": return a.sportName ?? a.sport;
    case "distance": return a.distanceM;
    case "time": return a.durationS;
    // Pace and speed are compared as speed, so "descending" always means fastest first.
    case "pace": return a.distanceM ? a.distanceM / a.durationS : null;
    case "hr": return a.avgHr;
    case "elevation": return a.elevationGainM;
    case "cadence": return a.cadence;
    case "load": return a.load;
  }
}

/** Sorted copy. Rows with no value for the column go last either way; ties fall back to newest first. */
export function sortActivities(list: readonly Activity[], key: SortKey, dir: SortDir): Activity[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
    } else if (va !== vb) {
      return (va < vb ? -1 : 1) * sign;
    }
    return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
  });
}

/** The direction a column starts in when first clicked: text A to Z, numbers and dates largest first. */
export function nextSort(current: Pick<Filters, "sort" | "dir">, key: SortKey): { sort: SortKey; dir: SortDir } {
  if (current.sort === key) return { sort: key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: key === "name" || key === "sport" ? "asc" : "desc" };
}

export interface Totals { count: number; distanceM: number; durationS: number; load: number }

export function totals(list: readonly Activity[]): Totals {
  return list.reduce<Totals>(
    (t, a) => ({ count: t.count + 1, distanceM: t.distanceM + (a.distanceM ?? 0), durationS: t.durationS + a.durationS, load: t.load + (a.load ?? 0) }),
    { count: 0, distanceM: 0, durationS: 0, load: 0 },
  );
}

/** 15 activities · 140.9 km · 12:49:47 · Load 1,047 */
export function formatTotals(t: Totals): string {
  return `${t.count} ${t.count === 1 ? "activity" : "activities"} · ${(t.distanceM / 1000).toFixed(1)} km · ${formatTime(t.durationS)} · Load ${thousands(t.load)}`;
}

/** Reads filters from a URL query. Anything missing or unknown falls back to the default. */
export function parseFilters(params: { get(name: string): string | null }): Filters {
  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const v = params.get(name);
    return v != null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const page = Number(params.get("page"));
  return {
    q: params.get("q") ?? "",
    sport: pick<Sport | "all">("sport", [...SPORT_VALUES, "all"], "all"),
    dates: pick("dates", DATE_RANGES.map((r) => r.value), DEFAULT_FILTERS.dates),
    distance: pick("distance", DISTANCE_BANDS.map((b) => b.value), "any"),
    sort: pick("sort", SORT_KEYS, "date"),
    dir: pick<SortDir>("dir", ["asc", "desc"], "desc"),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The query string for these filters, with defaults left out so plain `/activities` stays plain. */
export function filtersToQuery(f: Filters): string {
  const out = new URLSearchParams();
  if (f.q) out.set("q", f.q);
  if (f.sport !== "all") out.set("sport", f.sport);
  if (f.dates !== DEFAULT_FILTERS.dates) out.set("dates", f.dates);
  if (f.distance !== "any") out.set("distance", f.distance);
  if (f.sort !== "date") out.set("sort", f.sort);
  if (f.dir !== "desc") out.set("dir", f.dir);
  if (f.page > 1) out.set("page", String(f.page));
  return out.toString();
}

// ------------------------------------------------------- weeks and the day strip

/** The Monday of the week an activity started in, as `YYYY-MM-DD`. */
export function weekKey(start: string): string {
  const d = parseStart(start);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** "This week" for the week holding `today`, otherwise "9 Nov – 15 Nov". */
export function weekTitle(key: string, today: Date): string {
  const [y, m, d] = key.split("-").map(Number);
  const from = new Date(y, m - 1, d), to = new Date(y, m - 1, d + 6);
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (day >= from && day <= to) return "This week";
  return `${from.getDate()} ${MONTHS[from.getMonth()]} – ${to.getDate()} ${MONTHS[to.getMonth()]}`;
}

export interface WeekGroup { key: string; rows: Activity[]; totals: Totals }

/** Consecutive rows that share a week, in the order given, each with the week's totals over the whole list. */
export function groupByWeek(list: readonly Activity[]): WeekGroup[] {
  const whole = new Map<string, Activity[]>();
  for (const a of list) {
    const k = weekKey(a.start);
    whole.set(k, [...(whole.get(k) ?? []), a]);
  }
  const out: WeekGroup[] = [];
  for (const a of list) {
    const k = weekKey(a.start);
    const last = out[out.length - 1];
    if (last && last.key === k) last.rows.push(a);
    else out.push({ key: k, rows: [a], totals: totals(whole.get(k) ?? []) });
  }
  return out;
}

export interface StripDay { date: Date; activities: Activity[]; load: number }

/** One entry per day for the `days` days ending today, oldest first, with that day's activities and their load. */
export function dayStrip(list: readonly Activity[], today: Date, days = 30): StripDay[] {
  const out: StripDay[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k);
    const activities = list.filter((a) => {
      const d = parseStart(a.start);
      return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
    });
    out.push({ date, activities, load: activities.reduce((s, a) => s + (a.load ?? 0), 0) });
  }
  return out;
}

// ----------------------------------------------------------------------- CSV

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ["Start", "Activity", "Sport", "Distance (km)", "Time", "Time (s)", "Pace / speed", "Avg HR", "Max HR", "Elevation (m)", "Cadence", "Load"];

/** The rows as a CSV file body (RFC 4180, CRLF lines). Times keep their hundredths. */
export function toCsv(list: readonly Activity[]): string {
  const rows = list.map((a) => [
    a.start,
    a.name,
    a.sportName ?? a.sport,
    a.distanceM == null ? null : (a.distanceM / 1000).toFixed(3),
    clock(a.durationS, 2),
    a.durationS.toFixed(2),
    a.distanceM == null ? null : formatPaceValue(a.sport, paceOver(a.sport, a.distanceM, a.durationS), 2),
    a.avgHr,
    a.maxHr,
    a.elevationGainM,
    a.cadence,
    a.load,
  ]);
  return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------- laps

export interface Span { from: number; to: number }

/** Where each lap starts and ends along the chart axis (metres or seconds). */
export function lapSpans(laps: readonly Lap[], axis: Streams["axis"]): Span[] {
  let at = 0;
  return laps.map((l) => {
    const from = at;
    at += axis === "distance" ? l.distanceM ?? 0 : l.durationS;
    return { from, to: at };
  });
}

/** The lap a position falls in. A position exactly on a boundary belongs to the lap that starts there. */
export function lapIndexAt(spans: readonly Span[], x: number): number {
  if (spans.length === 0) return -1;
  for (let i = 0; i < spans.length; i++) if (x < spans[i].to) return i;
  return spans.length - 1;
}

/** Joins consecutive laps into bigger ones: `groups` says how many laps go into each. */
export function mergeLaps(laps: readonly Lap[], groups: readonly number[]): Lap[] {
  const out: Lap[] = [];
  let at = 0;
  for (const size of groups) {
    const part = laps.slice(at, at + size);
    at += size;
    if (part.length === 0) continue;
    const time = part.reduce((s, l) => s + l.durationS, 0);
    const weighted = (pick: (l: Lap) => number | null) =>
      part.some((l) => pick(l) == null) ? null : Math.round(part.reduce((s, l) => s + (pick(l) as number) * l.durationS, 0) / time);
    const summed = (pick: (l: Lap) => number | null) =>
      part.some((l) => pick(l) == null) ? null : part.reduce((s, l) => s + (pick(l) as number), 0);
    out.push({
      n: out.length + 1,
      distanceM: summed((l) => l.distanceM),
      durationS: Math.round(time * 100) / 100,
      avgHr: weighted((l) => l.avgHr),
      maxHr: part.some((l) => l.maxHr == null) ? null : Math.max(...part.map((l) => l.maxHr as number)),
      cadence: weighted((l) => l.cadence),
      elevationM: summed((l) => l.elevationM),
    });
  }
  return out;
}

/** A lap's pace or speed with hundredths (5:08.31, 25.43), or its time when the sport has no distance. */
export function formatLapPace(sport: Sport, lap: Lap): string {
  const v = paceOver(sport, lap.distanceM, lap.durationS);
  if (v == null) return clock(lap.durationS, 2);
  return paceUnit(sport) === "km/h" ? v.toFixed(2) : clock(v, 2);
}

export function formatLapDistance(sport: Sport, lap: Lap): string {
  if (lap.distanceM == null) return "—";
  return sport === "Swim" ? thousands(lap.distanceM) : (lap.distanceM / 1000).toFixed(2);
}

/** Bar length (0 to 100) and whether the lap beat the activity's average, for the lap table. */
export function lapBars(sport: Sport, laps: readonly Lap[], activity: Pick<Activity, "distanceM" | "durationS" | "avgHr">): { width: number; fast: boolean }[] {
  const unit = paceUnit(sport);
  // "Quickness": larger is faster. Without a distance the bar follows heart rate instead.
  const quick = (distanceM: number | null, durationS: number, hr: number | null) => {
    const v = paceOver(sport, distanceM, durationS);
    return v == null ? hr ?? 0 : unit === "km/h" ? v : -v;
  };
  const values = laps.map((l) => quick(l.distanceM, l.durationS, l.avgHr));
  const lo = Math.min(...values), hi = Math.max(...values);
  const mean = quick(activity.distanceM, activity.durationS, activity.avgHr);
  return values.map((v) => ({ width: hi === lo ? 66 : Math.round(36.15 + (60.42 * (v - lo)) / (hi - lo)), fast: v > mean }));
}

// -------------------------------------------------------------------- routes

/** The point `d` metres along a route, between its two nearest recorded points. */
export function routePositionAt(route: readonly RoutePoint[], d: number): { x: number; y: number } {
  if (route.length === 0) return { x: 0, y: 0 };
  if (d <= route[0].d) return { x: route[0].x, y: route[0].y };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    if (d <= b.d) {
      const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  const last = route[route.length - 1];
  return { x: last.x, y: last.y };
}

/** The part of a route between two distances, with exact end points. */
export function routeSlice(route: readonly RoutePoint[], from: number, to: number): { x: number; y: number }[] {
  if (route.length === 0 || to < from) return [];
  return [routePositionAt(route, from), ...route.filter((p) => p.d > from && p.d < to), routePositionAt(route, to)];
}

/** True when every point of the route says where it is on Earth, so it can go on a real map. */
export function isPlaced(route: readonly RoutePoint[]): route is PlacedPoint[] {
  return route.length >= 2 && route.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/** `[longitude, latitude]` at a distance along a placed route. */
export function routeLngLatAt(route: readonly PlacedPoint[], d: number): [number, number] {
  if (route.length === 0) return [0, 0];
  if (d <= route[0].d) return [route[0].lon, route[0].lat];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    if (d <= b.d) {
      const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
      return [a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t];
    }
  }
  const last = route[route.length - 1];
  return [last.lon, last.lat];
}

/** The part of a placed route between two distances as `[longitude, latitude]` pairs, with exact end points. */
export function routeLngLatSlice(route: readonly PlacedPoint[], from: number, to: number): [number, number][] {
  if (route.length === 0 || to < from) return [];
  return [routeLngLatAt(route, from), ...route.filter((p) => p.d > from && p.d < to).map((p): [number, number] => [p.lon, p.lat]), routeLngLatAt(route, to)];
}

export function pointsPath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/** Whole-km marks to label on the route: a round step that gives two to four of them. */
export function kmMarkers(distanceM: number): number[] {
  const km = distanceM / 1000;
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => s >= km / 4.5) ?? 100;
  const out: number[] = [];
  for (let k = step; k < km - step / 2; k += step) out.push(k);
  return out;
}

/** Metres covered at a position on the chart axis; null when a recording drawn over time holds no distance. */
export function metresAt(streams: Pick<Streams, "axis" | "x" | "distance">, at: number): number | null {
  if (streams.axis === "distance") return at;
  const { x, distance: d } = streams;
  if (!d || d.length === 0 || d.length !== x.length) return null;
  if (at <= x[0]) return d[0];
  for (let i = 1; i < x.length; i++) {
    if (at <= x[i]) return d[i - 1] + (d[i] - d[i - 1]) * (x[i] === x[i - 1] ? 0 : (at - x[i - 1]) / (x[i] - x[i - 1]));
  }
  return d[d.length - 1];
}

export type Cubic = [number, number, number, number, number, number];

/**
 * Turns a chain of cubic Bézier curves into route points. `distances[k]` is the metres covered at the end
 * of curve k, or null to spread the distance by drawn length between the known ends around it.
 */
export function routeFromCubics(start: [number, number], cubics: readonly Cubic[], distances: readonly (number | null)[], perCurve = 16): RoutePoint[] {
  const pts: { x: number; y: number; curve: number; len: number }[] = [{ x: start[0], y: start[1], curve: -1, len: 0 }];
  let [px, py] = start;
  let len = 0;
  cubics.forEach(([x1, y1, x2, y2, x3, y3], curve) => {
    const [x0, y0] = [px, py];
    for (let s = 1; s <= perCurve; s++) {
      const t = s / perCurve, u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      len += Math.hypot(x - px, y - py);
      pts.push({ x, y, curve, len });
      [px, py] = [x, y];
    }
  });
  // Known (drawn length, metres) pairs, in order.
  const knots: { len: number; d: number }[] = [{ len: 0, d: 0 }];
  cubics.forEach((_, curve) => {
    const d = distances[curve];
    if (d != null) knots.push({ len: pts[(curve + 1) * perCurve].len, d });
  });
  return pts.map((p) => {
    let k = 1;
    while (k < knots.length - 1 && p.len > knots[k].len) k++;
    const a = knots[k - 1], b = knots[Math.min(k, knots.length - 1)];
    const t = b.len === a.len ? 0 : Math.min(1, (p.len - a.len) / (b.len - a.len));
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, d: a.d + (b.d - a.d) * t };
  });
}

// -------------------------------------------------------------- chart helpers

/** Five evenly spaced labels for the shared chart axis: 0 km, 2, 4, 6, 8 km. */
export function axisTicks(sport: Sport, streams: Pick<Streams, "axis" | "x">): string[] {
  const max = streams.x[streams.x.length - 1] ?? 0;
  return [0, 1, 2, 3, 4].map((k) => {
    const v = (max * k) / 4;
    if (streams.axis === "time") return clock(Math.round(v));
    if (sport === "Swim") return `${thousands(v)}${k === 0 || k === 4 ? " m" : ""}`;
    return `${Number((v / 1000).toFixed(1))}${k === 0 || k === 4 ? " km" : ""}`;
  });
}

/** Where along the axis a sample sits: 4.5 km, 750 m, 12:00. */
export function formatPosition(sport: Sport, axis: Streams["axis"], x: number): string {
  if (axis === "time") return clock(Math.round(x));
  return sport === "Swim" ? `${thousands(x)} m` : `${(x / 1000).toFixed(1)} km`;
}

/** The sample nearest to a position on the axis. */
export function nearestSample(x: readonly number[], at: number): number {
  let best = 0;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - at) < Math.abs(x[best] - at)) best = i;
  return best;
}

/** Heart-rate zone limits (the lowest bpm of zones 2 to 5) as empty zone rows. */
export function zonesFromBounds(bounds: readonly number[]): ZoneTime[] {
  return [...bounds, null].map((upper, i) => ({
    zone: i + 1,
    fromBpm: i === 0 ? null : bounds[i - 1],
    toBpm: upper == null ? null : upper - 1,
    seconds: 0,
  }));
}

export function zoneLabel(z: ZoneTime): string {
  if (z.fromBpm == null) return `Zone ${z.zone} · under ${(z.toBpm ?? 0) + 1}`;
  if (z.toBpm == null) return `Zone ${z.zone} · ${z.fromBpm} and over`;
  return `Zone ${z.zone} · ${z.fromBpm} to ${z.toBpm}`;
}

// ------------------------------------------------- seeded sample generation

/** Small deterministic random source (mulberry32): the same seed always gives the same numbers. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits a whole number across weights so the parts are whole and add up exactly. */
export function splitWhole(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((s, p) => s + p, 0);
  const order = exact.map((e, i) => [e - parts[i], i] as const).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) parts[order[k][1]]++;
  return parts;
}

const LAP_LENGTH_M: Record<Sport, number | null> = { Run: 1000, Ride: 5000, Swim: 100, Strength: null, Other: null };
const TIME_LAP_S = 600;

/**
 * Builds laps, streams, zones and a route for an activity that only has its summary row.
 * Seeded by the activity id, so it is the same every time, and tied to the row: laps add up to the
 * row's distance, time (to the hundredth) and elevation, and heart rate centres on its average.
 */
export function generateDetail(row: Activity, zoneBounds: readonly number[]): ActivityDetail {
  const a = { ...row, avgHr: row.avgHr ?? 0, maxHr: row.maxHr ?? 0 };
  const rnd = seededRandom(a.id);
  const totalCs = Math.round(a.durationS * 100);
  const lapLen = a.distanceM ? LAP_LENGTH_M[a.sport] : null;
  const totalM = a.distanceM ? Math.round(a.distanceM) : 0;

  // Lap sizes: metres for distance sports, hundredths of a second otherwise.
  const sizes: number[] = [];
  const whole = lapLen ?? TIME_LAP_S * 100;
  for (let left = lapLen ? totalM : totalCs; left > 0; left -= whole) sizes.push(Math.min(whole, left));
  const count = sizes.length;

  // How hard each lap was relative to the average: above 1 is slower.
  const swing = a.sport === "Ride" ? 0.07 : 0.035;
  const effort = sizes.map((_, k) => 1 + swing * (rnd() * 2 - 1) + (k === 0 ? 0.03 : 0));
  const lapCs = lapLen ? splitWhole(totalCs, sizes.map((s, k) => s * effort[k])) : sizes;

  const rawHr = effort.map((f, k) => a.avgHr + (1 - f) * 120 + (k === 0 ? -8 : k === 1 ? -3 : (k / count) * 4 - 2));
  const meanHr = rawHr.reduce((s, h, k) => s + h * lapCs[k], 0) / totalCs;
  const lapHr = rawHr.map((h) => Math.min(a.maxHr - 1, Math.round(h + a.avgHr - meanHr)));
  const hottest = lapHr.indexOf(Math.max(...lapHr));
  const lapElev = a.elevationGainM == null ? null : splitWhole(a.elevationGainM, sizes.map((s) => s * (0.4 + rnd())));

  const laps: Lap[] = sizes.map((size, k) => ({
    n: k + 1,
    distanceM: lapLen ? size : null,
    durationS: lapCs[k] / 100,
    avgHr: lapHr[k],
    maxHr: k === hottest ? a.maxHr : Math.min(a.maxHr, lapHr[k] + 3 + Math.round(rnd() * 5)),
    cadence: a.cadence == null ? null : Math.round(a.cadence + (1 - effort[k]) * 60 + (rnd() * 2 - 1) * 1.5),
    elevationM: lapElev ? lapElev[k] : null,
  }));

  // Ten samples per full lap, as the watch's chart export does.
  const step = lapLen ? lapLen / 10 : TIME_LAP_S / 10;
  const n = Math.floor((lapLen ? totalM : a.durationS) / step) + 1;
  const phase = [rnd(), rnd(), rnd(), rnd(), rnd()].map((p) => p * Math.PI * 2);
  const amp = a.elevationGainM == null ? 0 : Math.max(4, Math.min(60, a.elevationGainM / 8));
  const hills = amp ? Math.max(1, Math.round((a.elevationGainM ?? 0) / (2 * amp))) : 0;
  const base = amp * 1.4 + 4 + rnd() * 20;

  const x: number[] = [], pace: number[] = [], hr: number[] = [], elevation: number[] = [], cadence: number[] = [];
  let h = lapHr[0] - 18;
  for (let i = 0; i < n; i++) {
    const k = Math.min(count - 1, Math.floor((i * step) / (lapLen ?? TIME_LAP_S)));
    x.push(i * step);
    const lapPace = paceOver(a.sport, laps[k].distanceM, laps[k].durationS);
    if (lapPace != null) pace.push(lapPace * (1 + 0.006 * Math.sin(i * 0.9 + phase[0]) + 0.004 * Math.sin(i * 0.37 + phase[1])));
    h += (lapHr[k] + 2 - h) * 0.25;
    hr.push(Math.min(a.maxHr, h + 1.5 * Math.sin(i * 0.8 + phase[2])));
    if (amp) elevation.push(base + amp * Math.sin((i / n) * hills * Math.PI * 2 + phase[3]) + amp * 0.4 * Math.sin(i * 0.31 + phase[4]));
    if (laps[k].cadence != null) cadence.push((laps[k].cadence as number) + 1.2 * Math.sin(i * 0.7 + phase[1]));
  }
  const streams: Streams = {
    axis: lapLen ? "distance" : "time",
    x,
    pace: pace.length ? pace : null,
    hr,
    elevation: elevation.length ? elevation : null,
    cadence: cadence.length ? cadence : null,
  };

  // Time in zones: each sample stands for the time it took to cover its step.
  const unit = paceUnit(a.sport);
  const weights = zoneBounds.map(() => 0).concat(0);
  hr.forEach((bpm, i) => {
    const took = streams.pace ? (unit === "km/h" ? 1 / streams.pace[i] : streams.pace[i]) : 1;
    weights[zoneBounds.filter((b) => Math.round(bpm) >= b).length] += took;
  });
  const zoneCs = splitWhole(totalCs, weights);
  const zones = zonesFromBounds(zoneBounds).map((z, i) => ({ ...z, seconds: zoneCs[i] / 100 }));

  return { activity: row, laps, steps: null, streams, scales: scalesFor(streams), route: a.sport === "Run" || a.sport === "Ride" ? loopRoute(rnd, totalM) : null, zones };
}

/** Chart ranges with a little air around the recorded values. */
export function scalesFor(streams: Pick<Streams, "pace" | "hr" | "elevation">): ChartScales {
  const span = (v: readonly number[]) => [Math.min(...v), Math.max(...v)] as const;
  const [hrLo, hrHi] = span(streams.hr ?? []);
  let pace: [number, number] | null = null;
  if (streams.pace) {
    const [lo, hi] = span(streams.pace);
    const pad = (hi - lo) * 0.17 || 1;
    pace = [lo - pad, hi + pad];
  }
  return {
    pace,
    hr: streams.hr ? [Math.floor((hrLo - 8) / 10) * 10, Math.ceil((hrHi + 5) / 10) * 10] : null,
    elevation: streams.elevation ? [0, Math.ceil((span(streams.elevation)[1] + 5) / 5) * 5] : null,
  };
}

/** A closed, wobbly loop inside the 760 × 420 route box, with distance spread by drawn length. */
function loopRoute(rnd: () => number, totalM: number): RoutePoint[] {
  const p = [rnd(), rnd(), rnd(), rnd()].map((v) => v * Math.PI * 2);
  const pts: { x: number; y: number; len: number }[] = [];
  const N = 144;
  let len = 0;
  for (let i = 0; i <= N; i++) {
    const th = ((i % N) / N) * Math.PI * 2 + p[0];
    const r = 1 + 0.18 * Math.sin(2 * th + p[1]) + 0.1 * Math.sin(3 * th + p[2]) + 0.06 * Math.sin(5 * th + p[3]);
    const x = 380 + 250 * r * Math.cos(th), y = 210 + 130 * r * Math.sin(th);
    if (i > 0) len += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
    pts.push({ x, y, len });
  }
  return pts.map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, d: (q.len / len) * totalM }));
}
