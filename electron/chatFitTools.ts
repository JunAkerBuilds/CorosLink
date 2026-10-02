import { getFitIndexRow, listStoredTrainingActivities } from "./database";
import {
  POWER_CURVE_DURATIONS,
  routeSimilarity,
  type FitSplit
} from "./fitAnalytics";
import {
  ensureFitSummaries,
  ensureFitSummary,
  listIndexedSummaries
} from "./fitIndexService";
import type { FitActivitySummary } from "./fitSummary";
import {
  getTrainingHubStatus,
  listTrainingHubActivities
} from "./trainingHubService";
import type { CorosMcpTool, TrainingHubActivity, UnitSystem } from "./types";
import {
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue
} from "./unitSystem.js";

export const CHAT_FIT_TOOL_NAMES = [
  "get_power_curve",
  "get_best_efforts",
  "get_activity_splits",
  "compare_activities",
  "find_similar_routes",
  "sync_activity_index"
] as const;

export type ChatFitToolName = (typeof CHAT_FIT_TOOL_NAMES)[number];

export function isChatFitTool(name: string): name is ChatFitToolName {
  return (CHAT_FIT_TOOL_NAMES as readonly string[]).includes(name);
}
// Per-call download cap: enough for a training block, never a history crawl.
const ON_DEMAND_DOWNLOAD_CAP = 25;
const SYNC_DOWNLOAD_CAP_MAX = 100;
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 30;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 730;
const MILE_M = 1609.344;

type SportFilter = "run" | "bike" | "all";

function isRunSport(sportType: number): boolean {
  return sportType >= 100 && sportType <= 103;
}

function isBikeSport(sportType: number): boolean {
  return sportType >= 200 && sportType <= 299;
}

function matchesSport(sportType: number, filter: SportFilter): boolean {
  if (filter === "run") return isRunSport(sportType);
  if (filter === "bike") return isBikeSport(sportType);
  return true;
}

function parseSportFilter(value: unknown, fallback: SportFilter): SportFilter {
  return value === "run" || value === "bike" || value === "all" ? value : fallback;
}

function parseDays(value: unknown, fallback = DEFAULT_WINDOW_DAYS): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.round(numeric)));
}

function formatDuration(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSignedSeconds(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${formatDuration(Math.abs(value))}`;
}

function formatDate(epochSeconds: number | undefined): string {
  if (!epochSeconds) return "unknown date";
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function formatDurationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`;
}

function formatEffortDistance(distanceM: number, unitSystem: UnitSystem): string {
  if (Math.abs(distanceM - MILE_M) < 1) return "1 mi";
  if (Math.abs(distanceM - 21097.5) < 1) return "Half marathon";
  if (Math.abs(distanceM - 42195) < 1) return "Marathon";
  if (distanceM < 1000) return `${distanceM} m`;
  return formatDistanceValue(distanceM, unitSystem, { digits: distanceM % 1000 === 0 ? 0 : 1 });
}

function speedToPaceSecPerKm(speed: number | undefined): number | undefined {
  return speed && speed > 0 ? 1000 / speed : undefined;
}

function describeSummary(summary: FitActivitySummary, unitSystem: UnitSystem): string {
  const bike = isBikeSport(summary.sportType);
  const pace = speedToPaceSecPerKm(summary.avgSpeed);
  const parts = [
    `id=${summary.activityId}`,
    formatDate(summary.startTime),
    summary.sportName ?? summary.name ?? `sport_type=${summary.sportType}`,
    summary.distanceM ? formatDistanceValue(summary.distanceM, unitSystem) : undefined,
    summary.timerSec ? formatDuration(summary.timerSec) : undefined,
    bike
      ? summary.avgSpeed
        ? formatSpeedValue(summary.avgSpeed * 3.6, unitSystem)
        : undefined
      : pace
        ? formatPaceValue(pace, unitSystem)
        : undefined,
    summary.avgHr ? `avg HR ${summary.avgHr}` : undefined,
    summary.avgPower ? `avg ${summary.avgPower} W` : undefined,
    summary.normalizedPower ? `NP ${summary.normalizedPower} W` : undefined,
    summary.ascentM ? `+${formatElevationValue(summary.ascentM, unitSystem)}` : undefined
  ].filter(Boolean);
  return parts.join(" · ");
}

interface ActivityRef {
  activityId: string;
  sportType: number;
  sportName?: string;
  name?: string;
  startTime?: number;
}

function toRef(activity: TrainingHubActivity): ActivityRef {
  return {
    activityId: activity.activityId,
    sportType: activity.sportType,
    sportName: activity.sportName,
    name: activity.name,
    startTime: activity.startTime
  };
}

/** Activities in the window, newest first, from the Training Hub listing. */
async function listActivitiesInWindow(days: number): Promise<ActivityRef[]> {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const refs: ActivityRef[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const activities = await listTrainingHubActivities(page, LIST_PAGE_SIZE);
    let reachedCutoff = false;
    for (const activity of activities) {
      if (!activity.activityId || seen.has(activity.activityId)) continue;
      if (activity.startTime !== undefined && activity.startTime < since) {
        reachedCutoff = true;
        continue;
      }
      seen.add(activity.activityId);
      refs.push(toRef(activity));
    }
    if (activities.length < LIST_PAGE_SIZE || reachedCutoff) break;
  }
  return refs;
}

/** Resolve sport type (needed for the FIT download URL) from any local source. */
async function resolveActivityRef(
  activityId: string,
  sportType?: number
): Promise<ActivityRef> {
  const row = getFitIndexRow(activityId);
  if (row) {
    return {
      activityId,
      sportType: sportType ?? row.sport_type,
      sportName: row.sport_name ?? undefined,
      name: row.name ?? undefined,
      startTime: row.start_time ?? undefined
    };
  }
  const stored = listStoredTrainingActivities(2000).find(
    (activity) => activity.activityId === activityId
  );
  if (stored) return toRef(stored);
  if (sportType !== undefined) return { activityId, sportType };
  for (let page = 1; page <= 5; page += 1) {
    const activities = await listTrainingHubActivities(page, LIST_PAGE_SIZE);
    const match = activities.find((activity) => activity.activityId === activityId);
    if (match) return toRef(match);
    if (activities.length < LIST_PAGE_SIZE) break;
  }
  throw new Error(
    `Activity ${activityId} was not found. Pass sport_type from list_recent_activities.`
  );
}

function indexNote(deferred: number, failed: number, windowDays: number): string[] {
  const notes: string[] = [];
  if (deferred > 0) {
    notes.push(
      `${deferred} activities in this window are not indexed yet (download cap per question). ` +
        `Call sync_activity_index with days=${windowDays} to index them, or the athlete can index everything from Data → Local activity index.`
    );
  }
  if (failed > 0) {
    notes.push(`${failed} activities could not be downloaded or parsed and were skipped.`);
  }
  return notes;
}

export function getChatFitTools(): CorosMcpTool[] {
  if (!getTrainingHubStatus().authenticated) return [];
  return [
    {
      name: "get_power_curve",
      description:
        "Best average power for standard durations (1s … 2h) across indexed activities in a window, " +
        "or for one activity, computed locally from full-resolution FIT files. Includes a 20-minute FTP " +
        "estimate for cycling and critical-power style bests for running power. No daily file caps.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer", description: `Window ending today. Default ${DEFAULT_WINDOW_DAYS}.` },
          sport: { type: "string", enum: ["bike", "run", "all"], description: "Default bike." },
          activity_id: { type: "string", description: "Restrict to a single activity." },
          sport_type: { type: "number", description: "Sport type for activity_id when known." }
        }
      }
    },
    {
      name: "get_best_efforts",
      description:
        "Fastest times for standard distances (400 m … marathon) found anywhere inside runs (or rides) " +
        "in a window, or in one activity. Computed locally from FIT records, so a fast 5k inside a long run counts.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer", description: `Window ending today. Default ${DEFAULT_WINDOW_DAYS}.` },
          sport: { type: "string", enum: ["run", "bike", "all"], description: "Default run." },
          activity_id: { type: "string" },
          sport_type: { type: "number" }
        }
      }
    },
    {
      name: "get_activity_splits",
      description:
        "Per-km or per-mile splits (pace, HR, power, cadence, elevation) plus aerobic decoupling, " +
        "normalized power, best efforts and a power curve for one activity, from its FIT file. " +
        "Prefer this over get_activity_detail when the athlete asks about pacing, fade, drift, or negative splits.",
      inputSchema: {
        type: "object",
        required: ["activity_id"],
        properties: {
          activity_id: { type: "string" },
          sport_type: { type: "number", description: "From list_recent_activities when known." },
          unit: { type: "string", enum: ["km", "mi"], description: "Defaults to the athlete's unit system." },
          include_laps: { type: "boolean", description: "Also list the watch's recorded laps. Default false." }
        }
      }
    },
    {
      name: "compare_activities",
      description:
        "Compare 2–4 activities side by side: totals, pace/HR/power, route similarity, time gained or " +
        "lost at each 10% of the distance, and split-by-split differences. Use it to compare repeat " +
        "efforts on the same route or the same workout across weeks.",
      inputSchema: {
        type: "object",
        required: ["activity_ids"],
        properties: {
          activity_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
          sport_types: {
            type: "array",
            items: { type: "number" },
            description: "Parallel to activity_ids when known."
          },
          unit: { type: "string", enum: ["km", "mi"] }
        }
      }
    },
    {
      name: "find_similar_routes",
      description:
        "Find indexed activities that follow the same route as a given activity (GPS fingerprint match), " +
        "with date, time, pace and HR for each, so repeat loops can be compared. Only searches activities " +
        "already in the local index; the result says how many in the window are not indexed yet.",
      inputSchema: {
        type: "object",
        required: ["activity_id"],
        properties: {
          activity_id: { type: "string" },
          sport_type: { type: "number" },
          days: { type: "integer", description: "Window to search. Default 365." },
          min_similarity: { type: "number", description: "0–1, default 0.6." }
        }
      }
    },
    {
      name: "sync_activity_index",
      description:
        "Download and index FIT files for activities in a window so the other local analysis tools " +
        "have full coverage. Bounded by max_downloads per call; report progress to the athlete and " +
        "suggest Data → Local activity index for the full history.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Window ending today. Default 90." },
          max_downloads: { type: "integer", description: `Cap for this call, default 30, max ${SYNC_DOWNLOAD_CAP_MAX}.` }
        }
      }
    }
  ];
}

export interface ChatFitToolCallbacks {
  requestId?: string;
  unitSystem?: UnitSystem;
}

export async function handleChatFitTool(
  name: ChatFitToolName,
  args: Record<string, unknown>,
  callbacks?: ChatFitToolCallbacks
): Promise<string> {
  const unitSystem = callbacks?.unitSystem ?? "metric";
  try {
    switch (name) {
      case "get_power_curve":
        return await handlePowerCurve(args, unitSystem);
      case "get_best_efforts":
        return await handleBestEfforts(args, unitSystem);
      case "get_activity_splits":
        return await handleActivitySplits(args, unitSystem);
      case "compare_activities":
        return await handleCompareActivities(args, unitSystem);
      case "find_similar_routes":
        return await handleFindSimilarRoutes(args, unitSystem);
      case "sync_activity_index":
        return await handleSyncIndex(args);
      default:
        throw new Error(`Unknown tool ${String(name)}`);
    }
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    if (/not authenticated|sign in/i.test(detail)) {
      throw new Error(
        `${name} failed: Training Hub is not signed in. Ask the athlete to connect COROS in Settings.`
      );
    }
    throw new Error(`${name} failed: ${detail}`);
  }
}

async function summariesForWindow(
  days: number,
  sport: SportFilter,
  options: { requirePower?: boolean } = {}
): Promise<{ summaries: FitActivitySummary[]; deferred: number; failed: number; considered: number }> {
  const refs = (await listActivitiesInWindow(days)).filter((ref) =>
    matchesSport(ref.sportType, sport)
  );
  const result = await ensureFitSummaries(refs, ON_DEMAND_DOWNLOAD_CAP);
  const summaries = options.requirePower
    ? result.summaries.filter((summary) => summary.hasPower)
    : result.summaries;
  return {
    summaries,
    deferred: result.deferred,
    failed: result.failed,
    considered: refs.length
  };
}

async function singleSummary(args: Record<string, unknown>): Promise<FitActivitySummary> {
  const activityId = String(args.activity_id ?? "").trim();
  if (!activityId) throw new Error("activity_id is required.");
  const sportType =
    typeof args.sport_type === "number" && Number.isFinite(args.sport_type)
      ? args.sport_type
      : undefined;
  const ref = await resolveActivityRef(activityId, sportType);
  const summary = await ensureFitSummary(ref);
  if (!summary) throw new Error(`No FIT data available for activity ${activityId}.`);
  return summary;
}

async function handlePowerCurve(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const lines: string[] = [];
  let summaries: FitActivitySummary[];
  let notes: string[] = [];
  let heading: string;

  if (args.activity_id) {
    const summary = await singleSummary(args);
    summaries = [summary];
    heading = `Power curve for ${describeSummary(summary, unitSystem)}`;
  } else {
    const days = parseDays(args.days);
    const sport = parseSportFilter(args.sport, "bike");
    const window = await summariesForWindow(days, sport, { requirePower: true });
    summaries = window.summaries;
    notes = indexNote(window.deferred, window.failed, days);
    heading = `Power curve — last ${days} days, ${sport === "all" ? "all sports" : sport}, ${summaries.length} activities with power (of ${window.considered} in window)`;
  }

  if (summaries.length === 0 || summaries.every((summary) => summary.powerCurve.length === 0)) {
    return [
      heading,
      "",
      "No power data found. Running power needs a COROS watch with running power enabled; cycling power needs a paired power meter.",
      ...notes
    ].join("\n");
  }

  lines.push(heading, "", "Duration · best avg power · activity");
  const best = new Map<number, { watts: number; summary: FitActivitySummary }>();
  for (const summary of summaries) {
    for (const point of summary.powerCurve) {
      const current = best.get(point.durationSec);
      if (!current || point.watts > current.watts) {
        best.set(point.durationSec, { watts: point.watts, summary });
      }
    }
  }
  for (const duration of POWER_CURVE_DURATIONS) {
    const entry = best.get(duration);
    if (!entry) continue;
    lines.push(
      `- ${formatDurationLabel(duration)}: ${entry.watts} W (${formatDate(entry.summary.startTime)}, ${entry.summary.name ?? entry.summary.sportName ?? entry.summary.activityId})`
    );
  }

  const twenty = best.get(1200);
  const sixty = best.get(3600);
  const anyBike = summaries.some((summary) => isBikeSport(summary.sportType));
  lines.push("");
  if (twenty) {
    lines.push(
      anyBike
        ? `FTP estimate: ${Math.round(twenty.watts * 0.95)} W (95% of best 20-min ${twenty.watts} W). Treat as an estimate unless the 20 min was an all-out effort.`
        : `Running critical power estimate: ~${Math.round(twenty.watts * 0.95)} W (95% of best 20-min ${twenty.watts} W)${sixty ? `; best 60-min ${sixty.watts} W` : ""}.`
    );
  } else {
    lines.push("No 20-minute effort with continuous power in this window, so no FTP estimate.");
  }

  const npList = summaries
    .filter((summary) => summary.normalizedPower)
    .sort((a, b) => (b.normalizedPower ?? 0) - (a.normalizedPower ?? 0))
    .slice(0, 5);
  if (npList.length > 0) {
    lines.push("", "Highest normalized power sessions:");
    for (const summary of npList) {
      lines.push(`- ${describeSummary(summary, unitSystem)}`);
    }
  }
  lines.push(...notes.map((note) => `\n${note}`));
  return lines.join("\n");
}

async function handleBestEfforts(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  let summaries: FitActivitySummary[];
  let notes: string[] = [];
  let heading: string;
  if (args.activity_id) {
    const summary = await singleSummary(args);
    summaries = [summary];
    heading = `Best efforts inside ${describeSummary(summary, unitSystem)}`;
  } else {
    const days = parseDays(args.days);
    const sport = parseSportFilter(args.sport, "run");
    const window = await summariesForWindow(days, sport);
    summaries = window.summaries;
    notes = indexNote(window.deferred, window.failed, days);
    heading = `Best efforts — last ${days} days, ${sport === "all" ? "all sports" : sport}, ${summaries.length} indexed activities (of ${window.considered} in window)`;
  }

  const best = new Map<number, { seconds: number; paceSecPerKm: number; summary: FitActivitySummary }>();
  for (const summary of summaries) {
    for (const effort of summary.bestEfforts) {
      const current = best.get(effort.distanceM);
      if (!current || effort.seconds < current.seconds) {
        best.set(effort.distanceM, { ...effort, summary });
      }
    }
  }
  if (best.size === 0) {
    return [heading, "", "No distance-based efforts found (no GPS/distance records).", ...notes].join("\n");
  }
  const lines = [heading, "", "Distance · time · pace · activity"];
  for (const [distanceM, entry] of [...best.entries()].sort((a, b) => a[0] - b[0])) {
    const bike = isBikeSport(entry.summary.sportType);
    const speed = bike ? formatSpeedValue((distanceM / entry.seconds) * 3.6, unitSystem) : formatPaceValue(entry.paceSecPerKm, unitSystem);
    lines.push(
      `- ${formatEffortDistance(distanceM, unitSystem)}: ${formatDuration(entry.seconds)} · ${speed} · ${formatDate(entry.summary.startTime)} ${entry.summary.name ?? ""} (id=${entry.summary.activityId})`.replace(/\s+\(/, " (")
    );
  }
  lines.push(...notes.map((note) => `\n${note}`));
  return lines.join("\n");
}

function formatSplitRows(
  splits: FitSplit[],
  unitSystem: UnitSystem,
  bike: boolean,
  unit: "km" | "mi"
): string[] {
  return splits.map((split) => {
    const speed = bike
      ? formatSpeedValue((split.distanceM / split.seconds) * 3.6, unitSystem)
      : formatPaceValue(split.paceSecPerKm, unitSystem);
    const parts = [
      `${split.index}${split.partial ? `* (${formatDistanceValue(split.distanceM, unitSystem)})` : ""}`,
      formatDuration(split.seconds),
      speed,
      split.avgHr ? `HR ${split.avgHr}` : undefined,
      split.avgPower ? `${split.avgPower} W` : undefined,
      split.avgCadence ? `${split.avgCadence} ${bike ? "rpm" : "spm"}` : undefined,
      split.elevGainM || split.elevLossM
        ? `+${formatElevationValue(split.elevGainM, unitSystem, "0")}/-${formatElevationValue(split.elevLossM, unitSystem, "0")}`
        : undefined
    ].filter(Boolean);
    return `- ${unit} ${parts.join(" · ")}`;
  });
}

function splitsFor(summary: FitActivitySummary, unit: "km" | "mi"): FitSplit[] {
  return unit === "mi" ? summary.splitsMi : summary.splitsKm;
}

function resolveUnit(value: unknown, unitSystem: UnitSystem): "km" | "mi" {
  if (value === "km" || value === "mi") return value;
  return unitSystem === "imperial" ? "mi" : "km";
}

function describeDecoupling(summary: FitActivitySummary): string | undefined {
  const d = summary.decoupling;
  if (!d) return undefined;
  const label = d.metric === "power" ? "Pw:HR" : "Pa:HR";
  const verdict =
    d.percent <= 5
      ? "well coupled (aerobic endurance holding)"
      : d.percent <= 10
        ? "moderate drift"
        : "significant drift (fatigue, heat, or pace above aerobic threshold)";
  return `Aerobic decoupling (${label}): ${d.percent > 0 ? "+" : ""}${d.percent}% — ${verdict}.`;
}

async function handleActivitySplits(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const summary = await singleSummary(args);
  const unit = resolveUnit(args.unit, unitSystem);
  const bike = isBikeSport(summary.sportType);
  const splits = splitsFor(summary, unit);
  const lines = [describeSummary(summary, unitSystem), ""];

  if (splits.length === 0) {
    lines.push("No distance splits (no distance records in the file).");
  } else {
    lines.push(`Splits per ${unit} (${splits.length}; * = partial):`);
    lines.push(...formatSplitRows(splits, unitSystem, bike, unit));
    const full = splits.filter((split) => !split.partial);
    if (full.length >= 4) {
      const half = Math.floor(full.length / 2);
      const avg = (items: FitSplit[]) =>
        items.reduce((total, split) => total + split.paceSecPerKm, 0) / items.length;
      const first = avg(full.slice(0, half));
      const second = avg(full.slice(half));
      const delta = ((second - first) / first) * 100;
      lines.push(
        "",
        `Pacing: second half ${Math.abs(delta).toFixed(1)}% ${delta < 0 ? "faster" : "slower"} than the first (${delta < -1 ? "negative split" : delta > 1 ? "positive split / fade" : "even"}).`
      );
    }
  }

  const decouplingLine = describeDecoupling(summary);
  if (decouplingLine) lines.push("", decouplingLine);

  if (summary.hasPower && summary.powerCurve.length > 0) {
    const picks = summary.powerCurve.filter((point) =>
      [5, 60, 300, 1200, 3600].includes(point.durationSec)
    );
    lines.push(
      "",
      `Power: avg ${summary.avgPower ?? "-"} W · NP ${summary.normalizedPower ?? "-"} W · max ${summary.maxPower ?? "-"} W · bests ${picks
        .map((point) => `${formatDurationLabel(point.durationSec)} ${point.watts} W`)
        .join(", ")}`
    );
  }

  if (summary.bestEfforts.length > 0) {
    lines.push(
      "",
      "Best efforts inside this activity: " +
        summary.bestEfforts
          .slice(0, 6)
          .map(
            (effort) =>
              `${formatEffortDistance(effort.distanceM, unitSystem)} ${formatDuration(effort.seconds)}`
          )
          .join(" · ")
    );
  }

  if (args.include_laps === true && summary.laps.length > 0) {
    lines.push("", `Recorded laps (${summary.laps.length}):`);
    for (const lap of summary.laps.slice(0, 50)) {
      const pace = speedToPaceSecPerKm(lap.avgSpeed);
      lines.push(
        `- lap ${lap.index}: ${lap.distanceM ? formatDistanceValue(lap.distanceM, unitSystem) : "-"} · ${formatDuration(lap.timerSec)} · ${
          bike
            ? lap.avgSpeed
              ? formatSpeedValue(lap.avgSpeed * 3.6, unitSystem)
              : "-"
            : formatPaceValue(pace, unitSystem)
        }${lap.avgHr ? ` · HR ${lap.avgHr}` : ""}${lap.avgPower ? ` · ${lap.avgPower} W` : ""}`
      );
    }
  }

  return lines.join("\n");
}

/** Interpolated timer seconds at cumulative distance `target`, from the stored series. */
function seriesTimeAtDistance(summary: FitActivitySummary, target: number): number | null {
  const points = summary.series.filter((point) => point.dist !== undefined);
  if (points.length === 0) return null;
  if (target <= (points[0].dist as number)) return points[0].t;
  const last = points[points.length - 1];
  // Stored distances are rounded to whole metres, so allow the final target
  // to land a hair past the last sample.
  if (target > (last.dist as number) && target - (last.dist as number) <= 2) {
    return last.t;
  }
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const prevD = prev.dist as number;
    const nextD = next.dist as number;
    if (nextD >= target) {
      const span = nextD - prevD;
      const ratio = span > 0 ? (target - prevD) / span : 1;
      return prev.t + (next.t - prev.t) * ratio;
    }
  }
  return null;
}

async function handleCompareActivities(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const ids = Array.isArray(args.activity_ids)
    ? args.activity_ids.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (ids.length < 2 || ids.length > 4) {
    throw new Error("activity_ids must list 2 to 4 activity ids.");
  }
  const sportTypes = Array.isArray(args.sport_types) ? args.sport_types : [];
  const summaries: FitActivitySummary[] = [];
  for (const [index, id] of ids.entries()) {
    const sportType =
      typeof sportTypes[index] === "number" ? (sportTypes[index] as number) : undefined;
    const summary = await ensureFitSummary(await resolveActivityRef(id, sportType));
    if (!summary) throw new Error(`No FIT data available for activity ${id}.`);
    summaries.push(summary);
  }
  const unit = resolveUnit(args.unit, unitSystem);
  const bike = summaries.every((summary) => isBikeSport(summary.sportType));
  const labels = summaries.map((_summary, index) => String.fromCharCode(65 + index));

  const lines = ["Activities:"];
  summaries.forEach((summary, index) => {
    lines.push(`- ${labels[index]}: ${describeSummary(summary, unitSystem)}`);
  });

  // Route similarity against the first activity.
  const base = summaries[0];
  if (base.route) {
    lines.push("", "Route similarity vs A:");
    summaries.slice(1).forEach((summary, index) => {
      const score = summary.route ? routeSimilarity(base.route!, summary.route) : 0;
      lines.push(
        `- ${labels[index + 1]}: ${Math.round(score * 100)}% ${score >= 0.6 ? "(same route)" : score >= 0.3 ? "(partly overlapping)" : "(different route)"}`
      );
    });
  }

  // Time gained/lost at each 10% of the shortest distance.
  const shortest = Math.min(...summaries.map((summary) => summary.distanceM ?? 0));
  if (shortest > 0) {
    lines.push("", `Time vs A at each 10% of ${formatDistanceValue(shortest, unitSystem)} (negative = ahead of A):`);
    for (let step = 1; step <= 10; step += 1) {
      const target = (shortest * step) / 10;
      const baseT = seriesTimeAtDistance(base, target);
      if (baseT === null) continue;
      const cells = summaries.slice(1).map((summary, index) => {
        const t = seriesTimeAtDistance(summary, target);
        return t === null ? `${labels[index + 1]} -` : `${labels[index + 1]} ${formatSignedSeconds(t - baseT)}`;
      });
      lines.push(`- ${step * 10}% (${formatDuration(baseT)} for A): ${cells.join(" · ")}`);
    }
  }

  // Split-by-split, first 20 splits.
  const splitSets = summaries.map((summary) => splitsFor(summary, unit));
  const commonSplits = Math.min(20, ...splitSets.map((splits) => splits.filter((s) => !s.partial).length));
  if (commonSplits > 0) {
    lines.push("", `Splits per ${unit} (${bike ? "speed" : "pace"} · HR):`);
    for (let index = 0; index < commonSplits; index += 1) {
      const cells = splitSets.map((splits, activityIndex) => {
        const split = splits[index];
        const speed = bike
          ? formatSpeedValue((split.distanceM / split.seconds) * 3.6, unitSystem)
          : formatPaceValue(split.paceSecPerKm, unitSystem);
        return `${labels[activityIndex]} ${speed}${split.avgHr ? ` @${split.avgHr}` : ""}`;
      });
      lines.push(`- ${unit} ${index + 1}: ${cells.join(" · ")}`);
    }
  }

  const decouplings = summaries
    .map((summary, index) => {
      const line = describeDecoupling(summary);
      return line ? `- ${labels[index]}: ${line}` : undefined;
    })
    .filter(Boolean) as string[];
  if (decouplings.length > 0) lines.push("", "Decoupling:", ...decouplings);

  return lines.join("\n");
}

async function handleFindSimilarRoutes(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const target = await singleSummary(args);
  if (!target.route) {
    return `${describeSummary(target, unitSystem)}\n\nThis activity has no GPS route, so there is nothing to match.`;
  }
  const days = parseDays(args.days, 365);
  const minSimilarity =
    typeof args.min_similarity === "number" && Number.isFinite(args.min_similarity)
      ? Math.min(1, Math.max(0, args.min_similarity))
      : 0.6;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const candidates = listIndexedSummaries({ sinceEpochSeconds: since, requireGps: true, limit: 2000 });
  const matches = candidates
    .filter((summary) => summary.activityId !== target.activityId && summary.route)
    .map((summary) => ({ summary, score: routeSimilarity(target.route!, summary.route!) }))
    .filter((entry) => entry.score >= minSimilarity)
    .sort((a, b) => b.summary.startTime - a.summary.startTime);

  const inWindow = (await listActivitiesInWindow(days)).filter((ref) =>
    matchesSport(ref.sportType, isBikeSport(target.sportType) ? "bike" : isRunSport(target.sportType) ? "run" : "all")
  );
  const indexedIds = new Set(candidates.map((summary) => summary.activityId));
  const unindexed = inWindow.filter((ref) => !indexedIds.has(ref.activityId)).length;

  const lines = [
    `Reference: ${describeSummary(target, unitSystem)}`,
    "",
    `${matches.length} similar route${matches.length === 1 ? "" : "s"} in the last ${days} days (similarity ≥ ${Math.round(minSimilarity * 100)}%):`
  ];
  const bike = isBikeSport(target.sportType);
  for (const { summary, score } of matches.slice(0, 25)) {
    const pace = speedToPaceSecPerKm(summary.avgSpeed);
    lines.push(
      `- ${formatDate(summary.startTime)} · ${Math.round(score * 100)}% · ${formatDuration(summary.timerSec)} · ${
        bike
          ? summary.avgSpeed
            ? formatSpeedValue(summary.avgSpeed * 3.6, unitSystem)
            : "-"
          : formatPaceValue(pace, unitSystem)
      }${summary.avgHr ? ` · HR ${summary.avgHr}` : ""}${summary.avgPower ? ` · ${summary.avgPower} W` : ""} (id=${summary.activityId})`
    );
  }
  if (matches.length > 1) {
    const fastest = [...matches].sort(
      (a, b) => (a.summary.timerSec ?? Infinity) - (b.summary.timerSec ?? Infinity)
    )[0];
    lines.push(
      "",
      `Fastest: ${formatDate(fastest.summary.startTime)} in ${formatDuration(fastest.summary.timerSec)} (id=${fastest.summary.activityId}). Use compare_activities to see where time was gained.`
    );
  }
  if (unindexed > 0) {
    lines.push(
      "",
      `${unindexed} ${bike ? "rides" : "runs"} in this window are not indexed yet, so they were not searched. Call sync_activity_index with days=${days} to include them.`
    );
  }
  return lines.join("\n");
}

async function handleSyncIndex(args: Record<string, unknown>): Promise<string> {
  const days = parseDays(args.days);
  const cap = Math.min(
    SYNC_DOWNLOAD_CAP_MAX,
    Math.max(1, Math.round(Number(args.max_downloads) || 30))
  );
  const refs = await listActivitiesInWindow(days);
  const result = await ensureFitSummaries(refs, cap);
  const lines = [
    `Local activity index — last ${days} days: ${result.summaries.length} of ${refs.length} activities indexed.`,
    `Downloaded now: ${result.downloaded}. Failed: ${result.failed}. Still pending: ${result.deferred}.`
  ];
  if (result.deferred > 0) {
    lines.push(
      "Call sync_activity_index again to continue, or the athlete can index the full history from Data → Local activity index (runs in the background)."
    );
  }
  return lines.join("\n");
}
