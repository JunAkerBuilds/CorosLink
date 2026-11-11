// A FIT file the athlete attaches in Coach, turned into text the model can
// read: the session summary, the laps, and the recorded samples as a table at
// the finest interval that fits a document's budget (usually every second).
// Decoded here in the main process from the original bytes, so what the model
// reads never depends on text the window supplied.
import { corosSportName } from "./corosSportTypes";
import { parseFitActivity, type FitActivity, type FitLap, type FitRecord } from "./fitActivity";
import { decoupling } from "./fitAnalytics";
import { corosSportTypeFromFit } from "./localSync/localActivityDetail";

export class CoachFitFileError extends Error {}

/** FIT files carry ".FIT" at byte 8 of their header. */
export function looksLikeFitFile(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 14 &&
    (bytes[0] === 12 || bytes[0] === 14) &&
    bytes[8] === 0x2e &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x54
  );
}

/** Larger buckets than this would hide the efforts the athlete wants analysed. */
const MAX_BUCKET_SEC = 30;

type Column = {
  header: string;
  value: (record: FitRecord) => number | undefined;
  digits: number;
  /** Cumulative values keep the bucket's last sample instead of the average. */
  last?: boolean;
};

/**
 * The text Coach reads for a FIT file, at most `maxChars` long. Throws
 * CoachFitFileError when the bytes are not an activity FIT file.
 */
export function describeFitForCoach(bytes: Uint8Array, maxChars: number): { text: string; truncated: boolean } {
  if (!looksLikeFitFile(bytes)) throw new CoachFitFileError("not a FIT file");
  let activity: FitActivity;
  try {
    activity = parseFitActivity(bytes);
  } catch {
    throw new CoachFitFileError("could not be decoded");
  }
  if (!activity.session && activity.records.length === 0 && activity.laps.length === 0) {
    throw new CoachFitFileError("has no activity data");
  }

  const sportType = corosSportTypeFromFit(activity.session?.sport, activity.session?.subSport);
  const cycling = sportType >= 200 && sportType < 300;
  const columns = recordColumns(activity.records, cycling);
  const head = [...summaryLines(activity, sportType, cycling), ...lapLines(activity.laps, cycling)].join("\n");

  if (activity.records.length === 0 || columns.length <= 1) {
    return { text: `${head}\n\nThe file has no per-second samples.`, truncated: false };
  }
  const interval = medianInterval(activity.records);
  const budget = maxChars - head.length - 600;
  let bucketSec = 0;
  let rows: string[] = [];
  for (const candidate of [0, 2, 3, 5, 10, 15, 20, 30]) {
    if (candidate > MAX_BUCKET_SEC) break;
    rows = sampleRows(activity.records, columns, candidate);
    bucketSec = candidate;
    if (tableLength(columns, rows) <= budget) break;
  }
  let truncated = false;
  while (rows.length > 1 && tableLength(columns, rows) > budget) {
    rows = rows.slice(0, Math.floor(rows.length * 0.9));
    truncated = true;
  }
  const units = columnUnits(columns, cycling);
  const sampling =
    bucketSec === 0
      ? `one row per recorded sample (the watch recorded about every ${interval} s)`
      : `averaged over ${bucketSec} s of moving time per row so the whole activity fits (the watch recorded about every ${interval} s)`;
  const table = [
    "",
    `Samples: ${sampling}. t = moving seconds from the start, pauses removed. ${units}`,
    columns.map((column) => column.header).join(","),
    ...rows
  ];
  if (truncated) table.push("[Later samples were cut to fit; the rest of the activity is not included.]");
  return { text: `${head}\n${table.join("\n")}`, truncated };
}

function summaryLines(activity: FitActivity, sportType: number, cycling: boolean): string[] {
  const session = activity.session;
  const records = activity.records;
  const last = records[records.length - 1];
  const startTs = session?.startTs ?? records[0]?.ts ?? activity.fileCreatedTs;
  const distance = session?.distanceM ?? last?.dist;
  const moving = session?.timerSec ?? last?.t;
  const avgSpeed = session?.avgSpeed ?? (distance && moving ? distance / moving : undefined);
  const lines = ["FIT activity file, decoded by CorosLink. All values are metric."];
  const sport = corosSportName(sportType) ?? (session?.sport !== undefined ? `FIT sport ${session.sport}` : undefined);
  push(lines, "Sport", sport);
  push(lines, "Start", startTs !== undefined ? localTime(startTs) : undefined);
  push(lines, "Elapsed time", duration(session?.elapsedSec));
  push(lines, "Moving time", duration(moving));
  push(lines, "Distance", distance !== undefined ? `${(distance / 1000).toFixed(2)} km` : undefined);
  push(lines, cycling ? "Average speed" : "Average pace", speedText(avgSpeed, cycling));
  push(lines, cycling ? "Max speed" : "Best pace", speedText(session?.maxSpeed, cycling));
  push(lines, "Heart rate", range(session?.avgHr, session?.maxHr, "bpm", session?.minHr));
  push(lines, "Cadence", session?.avgCadence !== undefined ? `avg ${round(session.avgCadence)} ${cycling ? "rpm" : "spm (per leg, as the watch records it)"}` : undefined);
  push(lines, "Power", range(session?.avgPower, session?.maxPower, "W"));
  push(lines, "Normalized power", session?.normalizedPower !== undefined ? `${round(session.normalizedPower)} W` : undefined);
  push(lines, "Elevation", session?.ascentM !== undefined || session?.descentM !== undefined ? `+${round(session?.ascentM ?? 0)} m / -${round(session?.descentM ?? 0)} m` : undefined);
  push(lines, "Calories", session?.calories !== undefined ? `${round(session.calories)} kcal` : undefined);
  push(lines, "Temperature", session?.avgTemperature !== undefined ? `avg ${round(session.avgTemperature)} °C` : undefined);
  const training = session?.training;
  if (training) {
    const parts = [
      training.trainingLoad !== undefined ? `training load ${round(training.trainingLoad)}` : undefined,
      training.aerobicEffect !== undefined ? `aerobic TE ${training.aerobicEffect.toFixed(1)}` : undefined,
      training.anaerobicEffect !== undefined ? `anaerobic TE ${training.anaerobicEffect.toFixed(1)}` : undefined,
      training.vo2max !== undefined ? `VO2max ${round(training.vo2max)}` : undefined,
      training.recovery !== undefined ? `recovery ${Math.round(training.recovery / 3600)} h` : undefined
    ].filter(Boolean);
    push(lines, "Watch analysis", parts.length ? parts.join(", ") : undefined);
  }
  const drift = decoupling(records);
  if (drift) {
    push(
      lines,
      "Aerobic decoupling",
      `${drift.percent}% (${drift.metric === "power" ? "power" : "pace"}:HR, second half of the moving time after a 10 min warm-up vs the first; positive = less output per heartbeat later)`
    );
  }
  push(lines, "Workout followed", activity.workout?.name);
  return lines;
}

function lapLines(laps: FitLap[], cycling: boolean): string[] {
  if (laps.length === 0) return [];
  const header = `lap,moving_time,distance_km,${cycling ? "avg_speed_kmh" : "avg_pace_min_km"},avg_hr,max_hr,avg_cadence,avg_power_w,ascent_m`;
  const rows = laps.map((lap) =>
    [
      lap.index,
      duration(lap.timerSec ?? lap.elapsedSec) ?? "",
      lap.distanceM !== undefined ? (lap.distanceM / 1000).toFixed(2) : "",
      cycling ? (lap.avgSpeed ? (lap.avgSpeed * 3.6).toFixed(1) : "") : pace(lap.avgSpeed) ?? "",
      cell(lap.avgHr),
      cell(lap.maxHr),
      cell(lap.avgCadence),
      cell(lap.avgPower),
      cell(lap.ascentM)
    ].join(",")
  );
  return ["", `Laps (${laps.length}):`, header, ...rows];
}

function recordColumns(records: FitRecord[], cycling: boolean): Column[] {
  const has = (value: (record: FitRecord) => number | undefined) =>
    records.some((record) => {
      const sample = value(record);
      return sample !== undefined && sample > 0;
    });
  const candidates: Column[] = [
    { header: "t", value: (record) => record.t, digits: 0, last: false },
    { header: "dist_m", value: (record) => record.dist, digits: 0, last: true },
    cycling
      ? { header: "speed_kmh", value: (record) => (record.speed !== undefined ? record.speed * 3.6 : undefined), digits: 1 }
      : { header: "pace_s_km", value: (record) => record.speed, digits: 0 },
    { header: "hr", value: (record) => record.hr, digits: 0 },
    { header: "cadence", value: (record) => record.cadence, digits: 0 },
    { header: "power_w", value: (record) => record.power, digits: 0 },
    { header: "alt_m", value: (record) => record.alt, digits: 1 },
    { header: "gap_s_km", value: (record) => record.effortSpeed, digits: 0 },
    { header: "gct_ms", value: (record) => record.groundTime, digits: 0 },
    { header: "vo_mm", value: (record) => record.verticalOscillation, digits: 0 },
    { header: "stride_mm", value: (record) => record.stepLength, digits: 0 }
  ];
  return candidates.filter((column, index) => index === 0 || has(column.value));
}

function columnUnits(columns: Column[], cycling: boolean): string {
  const notes: Record<string, string> = {
    dist_m: "dist_m = cumulative metres",
    speed_kmh: "speed_kmh = km/h",
    pace_s_km: "pace_s_km = seconds per km",
    hr: "hr = bpm",
    cadence: cycling ? "cadence = rpm" : "cadence = spm per leg (double it for steps per minute)",
    power_w: "power_w = watts",
    alt_m: "alt_m = metres",
    gap_s_km: "gap_s_km = grade-adjusted pace, seconds per km",
    gct_ms: "gct_ms = ground contact time",
    vo_mm: "vo_mm = vertical oscillation",
    stride_mm: "stride_mm = step length"
  };
  const parts = columns.map((column) => notes[column.header]).filter(Boolean);
  return parts.length ? `${parts.join("; ")}. Empty = not recorded.` : "";
}

/** Rows of the record table; with `bucketSec` > 0 the samples of each bucket of moving time are averaged. */
function sampleRows(records: FitRecord[], columns: Column[], bucketSec: number): string[] {
  const rows: string[] = [];
  if (bucketSec === 0) {
    for (const record of records) rows.push(row(columns, [record]));
    return rows;
  }
  let bucket: FitRecord[] = [];
  let bucketStart = records[0]!.t;
  for (const record of records) {
    if (record.t - bucketStart >= bucketSec && bucket.length) {
      rows.push(row(columns, bucket));
      bucket = [];
      bucketStart = bucketStart + Math.floor((record.t - bucketStart) / bucketSec) * bucketSec;
    }
    bucket.push(record);
  }
  if (bucket.length) rows.push(row(columns, bucket));
  return rows;
}

function row(columns: Column[], bucket: FitRecord[]): string {
  return columns
    .map((column, index) => {
      if (index === 0) return String(Math.round(bucket[0]!.t));
      let value: number | undefined;
      if (column.last) {
        for (let at = bucket.length - 1; at >= 0 && value === undefined; at -= 1) value = column.value(bucket[at]!);
      } else {
        const values = bucket.map(column.value).filter((sample): sample is number => sample !== undefined && Number.isFinite(sample));
        value = values.length ? values.reduce((sum, sample) => sum + sample, 0) / values.length : undefined;
      }
      if (value === undefined) return "";
      // Pace columns carry speed until here: average speeds, then invert.
      if (column.header === "pace_s_km" || column.header === "gap_s_km") {
        return value > 0.3 ? String(Math.round(1000 / value)) : "";
      }
      return column.digits === 0 ? String(Math.round(value)) : value.toFixed(column.digits);
    })
    .join(",");
}

function tableLength(columns: Column[], rows: string[]): number {
  return rows.reduce((sum, line) => sum + line.length + 1, columns.length * 10);
}

function medianInterval(records: FitRecord[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < records.length && gaps.length < 2000; index += 1) {
    const gap = records[index]!.ts - records[index - 1]!.ts;
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 1;
  gaps.sort((a, b) => a - b);
  return Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]!));
}

function push(lines: string[], label: string, value: string | undefined): void {
  if (value) lines.push(`${label}: ${value}`);
}

function round(value: number): number {
  return Math.round(value);
}

function cell(value: number | undefined): string {
  return value === undefined ? "" : String(Math.round(value));
}

function range(avg: number | undefined, max: number | undefined, unit: string, min?: number): string | undefined {
  const parts = [
    avg !== undefined ? `avg ${round(avg)}` : undefined,
    max !== undefined ? `max ${round(max)}` : undefined,
    min !== undefined ? `min ${round(min)}` : undefined
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")} ${unit}` : undefined;
}

function duration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, "0");
  return `${hours ? `${hours}:` : ""}${mm}:${String(secs).padStart(2, "0")}`;
}

function pace(speed: number | undefined): string | undefined {
  if (!speed || speed <= 0.3) return undefined;
  return duration(1000 / speed);
}

function speedText(speed: number | undefined, cycling: boolean): string | undefined {
  if (!speed || speed <= 0) return undefined;
  return cycling ? `${(speed * 3.6).toFixed(1)} km/h` : `${pace(speed)} /km`;
}

/** The start as the athlete's clock read it, with the UTC offset. */
function localTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const offset = -date.getTimezoneOffset();
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0");
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 16).replace("T", " ");
  return `${local} (UTC${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}, this computer's time zone)`;
}
