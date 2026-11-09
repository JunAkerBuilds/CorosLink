import {
  activityMovingSeconds,
  activitySignificantElapsedSeconds,
  SIGNIFICANT_PAUSE_SECONDS
} from "./activityTime";
import {
  downsampleActivitySeries,
  formatActivitySeriesForChat
} from "./trainingHubService";
import { currentActivitySource } from "./localSync/activitySource";
import { ACTIVITY_NAME_MAX_BYTES, activityNameBytes } from "./activityName";
import { trainingDataAvailable } from "./localSync/trainingDataAccess";
import type {
  ActivityHrTrendPreview,
  ActivityVisualLapPoint,
  ActivityVisualPreview,
  CorosMcpTool,
  StrengthDetail,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityLap,
  TrainingHubActivityWorkout,
  TrainingHubLapStep,
  TrainingHubSwimStroke,
  TrainingHubSwimSummary,
  UnitSystem
} from "./types";
import {
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue,
  formatWeightValue,
  METERS_PER_YARD,
  poolUnitSystem,
  swimPaceClock,
  swimPaceUnit
} from "./unitSystem.js";

export const CHAT_ACTIVITY_TOOL_NAMES = [
  "list_recent_activities",
  "get_activity_detail",
  "rename_activity"
] as const;

export type ChatActivityToolName = (typeof CHAT_ACTIVITY_TOOL_NAMES)[number];

const MAX_LAPS = 50;
/** A pool swim's lengths: enough for a long session, row by row. */
const MAX_LENGTHS = 120;

type ActivityRenameListener = (change: { activityId: string; name: string }) => void;
const renameListeners = new Set<ActivityRenameListener>();

/** Main forwards Coach renames so open views (Activities, Calendar, Overview) show the new name. */
export function onCoachActivityRenamed(listener: ActivityRenameListener): () => void {
  renameListeners.add(listener);
  return () => renameListeners.delete(listener);
}

export function isChatActivityTool(name: string): name is ChatActivityToolName {
  return (CHAT_ACTIVITY_TOOL_NAMES as readonly string[]).includes(name);
}

export function getChatActivityTools(): CorosMcpTool[] {
  if (!trainingDataAvailable()) {
    return [];
  }

  return [
    {
      name: "list_recent_activities",
      description:
        "List recent COROS activities with activity_id and sport_type needed for " +
        "get_activity_detail. Prefer this over COROS MCP when you need reliable lap data.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of activities to return (default 10, max 25)"
          },
          page: {
            type: "number",
            description: "Page number for pagination (default 1)"
          }
        }
      }
    },
    {
      name: "get_activity_detail",
      description:
        "Fetch detailed COROS activity data including avg/max power and cadence and a " +
        "lap/split breakdown (distance, duration, avg/max HR, pace, power, cadence). " +
        "For swims synced from the watch it also returns pool length, strokes, SWOLF, stroke rate, " +
        "best pace and water temperature, and each interval and length with its stroke type, " +
        "strokes, SWOLF and stroke rate, rests included. " +
        "A COROS stroke is one full cycle of the arm wearing the watch, not a single arm pull; stroke rate, SWOLF " +
        "and distance per stroke use that count, so in freestyle and backstroke they differ from figures that count " +
        "both arms. A swim done as a watch workout also has the workout's name, " +
        "each interval's step (name, repeat round, target), the training load each lap added, and how far heart rate fell over each rest. " +
        "A run done as a watch workout likewise has the workout and each lap's step, target distance or time and pace or heart-rate range, " +
        "and every run's laps carry the training load they added. " +
        "Use activity_id and sport_type from " +
        "list_recent_activities or the training snapshot. Prefer this local tool over " +
        "COROS MCP for lap and split analysis.",
      inputSchema: {
        type: "object",
        properties: {
          activity_id: {
            type: "string",
            description: "COROS activity ID (labelId)"
          },
          sport_type: {
            type: "number",
            description: "COROS sport type code from the activity list"
          },
          include_series: {
            type: "boolean",
            description:
              "Include downsampled HR/pace/power/cadence progression (~60 points). Default false."
          }
        },
        required: ["activity_id", "sport_type"]
      }
    },
    {
      name: "rename_activity",
      description:
        "Rename a recorded activity on COROS (and in CorosLink). Only when the athlete asks for a new name; " +
        "use the name they give, or one you proposed and they accepted. Use activity_id from list_recent_activities. " +
        "Notes about how it went belong in log_workout_debrief, not the name.",
      inputSchema: {
        type: "object",
        properties: {
          activity_id: { type: "string", description: "COROS activity ID (labelId)" },
          name: { type: "string", description: "The new name, at most 150 bytes." }
        },
        required: ["activity_id", "name"]
      }
    }
  ];
}

export interface ChatActivityToolCallbacks {
  onActivityVisual?: (preview: ActivityVisualPreview) => void;
  requestId?: string;
  unitSystem?: UnitSystem;
}

export async function handleChatActivityTool(
  name: ChatActivityToolName,
  args: Record<string, unknown>,
  callbacks?: ChatActivityToolCallbacks
): Promise<string> {
  if (name === "list_recent_activities") {
    return handleListRecentActivities(args, callbacks?.unitSystem ?? "metric");
  }
  if (name === "rename_activity") {
    return handleRenameActivity(args);
  }
  return handleGetActivityDetail(args, callbacks);
}

async function handleRenameActivity(args: Record<string, unknown>): Promise<string> {
  const activityId = String(args.activity_id ?? args.activityId ?? "").trim();
  const requested = String(args.name ?? "").trim();
  if (!activityId) {
    throw new Error("activity_id is required. Call list_recent_activities first to find the correct ID.");
  }
  if (!requested) throw new Error("name is required.");
  if (activityNameBytes(requested) > ACTIVITY_NAME_MAX_BYTES) {
    throw new Error(`That name is too long for COROS (max ${ACTIVITY_NAME_MAX_BYTES} bytes). Shorten it and try again.`);
  }
  try {
    // COROS's write answers empty either way; the start time lets the rename be read back.
    const listed = (await currentActivitySource().listActivities(1, 50)).find(
      (activity) => activity.activityId === activityId
    );
    const saved = await currentActivitySource().renameActivity(activityId, requested, listed?.startTime);
    for (const listener of renameListeners) listener({ activityId, name: saved });
    const previous = listed?.name ? ` (was "${listed.name}")` : "";
    return `Renamed activity ${activityId} to "${saved}"${previous}.`;
  } catch (caught) {
    throw formatActivityToolError("rename_activity", caught);
  }
}

async function handleListRecentActivities(
  args: Record<string, unknown>,
  unitSystem: UnitSystem
): Promise<string> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const page = Math.max(Number(args.page) || 1, 1);

  try {
    const activities = await currentActivitySource().listActivities(page, limit);
    if (activities.length === 0) {
      return "No recent activities found in COROS Training Hub.";
    }

    const lines = activities.map((activity) =>
      formatActivityListLine(activity, unitSystem)
    );
    return [
      `Recent activities (${activities.length}):`,
      "",
      ...lines,
      "",
      "Use get_activity_detail with activity_id and sport_type for lap splits."
    ].join("\n");
  } catch (caught) {
    throw formatActivityToolError("list_recent_activities", caught);
  }
}

async function handleGetActivityDetail(
  args: Record<string, unknown>,
  callbacks?: ChatActivityToolCallbacks
): Promise<string> {
  const activityId = String(args.activity_id ?? args.activityId ?? "").trim();
  const sportType = Number(args.sport_type ?? args.sportType);

  if (!activityId) {
    throw new Error(
      "activity_id is required. Call list_recent_activities first to find the correct ID."
    );
  }
  if (!Number.isFinite(sportType)) {
    throw new Error(
      "sport_type is required. Copy it from list_recent_activities or the training snapshot."
    );
  }

  const includeSeries = args.include_series === true || args.includeSeries === true;

  try {
    const listActivities = await currentActivitySource().listActivities(1, 50);
    const listActivity = listActivities.find(
      (activity) => activity.activityId === activityId
    );
    const detail = await currentActivitySource().getActivityDetail(
      activityId,
      sportType,
      listActivity
    );

    if (!detail.laps.length && !detail.duration && !detail.distance) {
      return (
        `No activity detail found for activity_id=${activityId} sport_type=${sportType}. ` +
        "Check the ID and sport type from list_recent_activities."
      );
    }

    if (callbacks?.onActivityVisual && callbacks.requestId) {
      const preview = buildActivityVisualPreview(detail, callbacks.requestId);
      if (preview) {
        callbacks.onActivityVisual(preview);
      }
    }

    return formatActivityDetailForChat(
      detail,
      includeSeries,
      callbacks?.unitSystem ?? "metric"
    );
  } catch (caught) {
    throw formatActivityToolError("get_activity_detail", caught);
  }
}

function mapLapPoints(laps: TrainingHubActivityLap[]): ActivityVisualLapPoint[] {
  return laps.slice(0, MAX_LAPS).map((lap) => ({
    index: lap.index,
    avgHr: lap.avgHr,
    maxHr: lap.maxHr,
    distance: lap.distance,
    duration: lap.duration,
    pace: lap.pace
  }));
}

export function migrateActivityHrTrendPreview(
  legacy: ActivityHrTrendPreview
): ActivityVisualPreview {
  return {
    previewId: legacy.previewId,
    activityId: legacy.activityId,
    name: legacy.name,
    startTime: legacy.startTime,
    avgHr: legacy.avgHr,
    maxHr: legacy.maxHr,
    sections: {
      hr: {
        chartKind: legacy.chartKind,
        series: legacy.series,
        laps: legacy.laps
      }
    }
  };
}

export function buildActivityVisualPreview(
  detail: TrainingHubActivityDetail,
  requestId: string
): ActivityVisualPreview | null {
  const activityId = detail.activityId?.trim();
  if (!activityId) {
    return null;
  }

  const downsampled =
    detail.series && detail.series.length > 0
      ? downsampleActivitySeries(detail.series)
      : [];

  const sections: ActivityVisualPreview["sections"] = {};

  const hrSeriesPoints = downsampled.filter(
    (point) => point.hr !== undefined && Number.isFinite(point.hr)
  );
  const hrLaps = detail.laps.filter(
    (lap) => lap.avgHr !== undefined && Number.isFinite(lap.avgHr)
  );

  if (hrSeriesPoints.length >= 2) {
    sections.hr = { chartKind: "series", series: downsampled };
  } else if (hrLaps.length >= 2) {
    sections.hr = {
      chartKind: "laps",
      laps: mapLapPoints(hrLaps)
    };
  }

  const pacePoints = downsampled.filter(
    (point) => point.pace !== undefined && Number.isFinite(point.pace)
  );
  if (pacePoints.length >= 2) {
    sections.pace = { series: downsampled };
  }

  const powerPoints = downsampled.filter(
    (point) => point.power !== undefined && Number.isFinite(point.power)
  );
  if (powerPoints.length >= 2) {
    sections.power = { series: downsampled };
  }

  const elevationPoints = (detail.track?.points ?? []).filter(
    (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
  );
  if (elevationPoints.length >= 2) {
    sections.elevation = { points: elevationPoints };
  }

  if (detail.laps.length > 0) {
    sections.laps = mapLapPoints(detail.laps);
  }

  if (
    !sections.hr &&
    !sections.pace &&
    !sections.power &&
    !sections.elevation &&
    !sections.laps
  ) {
    return null;
  }

  return {
    previewId: `${activityId}:${requestId}`,
    activityId,
    sportType: detail.sportType,
    name: detail.name,
    startTime: detail.startTime ? formatIsoDate(detail.startTime) : undefined,
    avgHr: detail.avgHr,
    maxHr: detail.maxHr,
    sections
  };
}

/** @deprecated Use buildActivityVisualPreview */
export function buildActivityHrTrendPreview(
  detail: TrainingHubActivityDetail,
  requestId: string
): ActivityHrTrendPreview | null {
  const preview = buildActivityVisualPreview(detail, requestId);
  if (!preview?.sections.hr) {
    return null;
  }

  const hr = preview.sections.hr;
  return {
    previewId: preview.previewId,
    activityId: preview.activityId,
    name: preview.name,
    startTime: preview.startTime,
    avgHr: preview.avgHr,
    maxHr: preview.maxHr,
    chartKind: hr.chartKind,
    series: hr.series,
    laps: hr.laps
  };
}

function formatActivityToolError(tool: string, caught: unknown): Error {
  const detail = caught instanceof Error ? caught.message : String(caught);
  if (/not authenticated|sign in/i.test(detail)) {
    return new Error(
      `${tool} failed: Training Hub is not signed in. Ask the athlete to connect COROS in Settings.`
    );
  }
  if (/not found|404/i.test(detail)) {
    return new Error(
      `${tool} failed: activity not found. Verify activity_id and sport_type from list_recent_activities.`
    );
  }
  return new Error(`${tool} failed: ${detail}`);
}

function isSwimActivity(sportType: number | undefined, sportName?: string): boolean {
  return sportType === 300 || sportType === 301 || /swim/i.test(sportName ?? "");
}

function isCyclingActivity(sportType: number | undefined, sportName?: string): boolean {
  return (sportType !== undefined && sportType >= 200 && sportType <= 299) ||
    /bike|cycl|ride/i.test(sportName ?? "");
}

/** Moving time, plus elapsed once pauses reach a minute (as COROS shows it). */
function formatActivityListTime(activity: TrainingHubActivity): string | undefined {
  const moving = activityMovingSeconds(activity);
  if (moving === undefined) {
    return undefined;
  }
  const elapsed = activitySignificantElapsedSeconds(activity);
  return elapsed === undefined
    ? formatDurationSeconds(moving)
    : `${formatDurationSeconds(moving)} moving (${formatDurationSeconds(elapsed)} elapsed)`;
}

export function formatActivityListLine(
  activity: TrainingHubActivity,
  unitSystem: UnitSystem
): string {
  const parts = [
    `id=${activity.activityId}`,
    `sport_type=${activity.sportType}`,
    activity.startTime ? formatIsoDate(activity.startTime) : undefined,
    activity.sportName ?? undefined,
    activity.name ?? undefined,
    activity.distance
      ? formatDistanceValue(activity.distance, unitSystem, {
          swim: isSwimActivity(activity.sportType, activity.sportName)
        })
      : undefined,
    formatActivityListTime(activity),
    activity.avgHr ? `avg HR ${activity.avgHr}` : undefined,
    activity.maxHr ? `max HR ${activity.maxHr}` : undefined,
    activity.trainingLoad ? `load ${activity.trainingLoad}` : undefined
  ].filter(Boolean);
  return `- ${parts.join(" · ")}`;
}

export function formatActivityDetailForChat(
  detail: TrainingHubActivityDetail,
  includeSeries: boolean,
  unitSystem: UnitSystem = "metric"
): string {
  const swim = isSwimActivity(detail.sportType, detail.sportName);
  const cycling = isCyclingActivity(detail.sportType, detail.sportName);
  // A pool's distances and paces read in the pool's own unit, as the activity page shows them.
  const swimUnits = poolUnitSystem(detail.swim?.poolLengthUnit, unitSystem);
  // detail.duration is elapsed time including pauses. Like the COROS app,
  // report moving time and derive pace/speed from it (laps are moving too).
  const moving = detail.movingTime ?? detail.duration;
  const paused =
    detail.duration !== undefined && detail.movingTime !== undefined
      ? detail.duration - detail.movingTime
      : 0;
  const showElapsed = paused >= SIGNIFICANT_PAUSE_SECONDS;
  const performance = detail.distance && moving
    ? cycling
      ? `Avg speed: ${formatSpeedValue((detail.distance / 1000) / (moving / 3600), unitSystem)}`
      : !swim
        ? `Avg pace: ${formatPaceSeconds(moving / (detail.distance / 1000), unitSystem)}`
        // The watch's swim pace leaves out rests at the wall; moving time does not.
        : `Avg pace: ${formatSwimPace(detail.swim?.avgPace ?? moving / (detail.distance / 100), swimUnits)}${detail.swim?.avgPace !== undefined ? " (rests left out)" : ""}`
    : undefined;
  const summaryParts = [
    detail.name ? `Name: ${detail.name}` : undefined,
    detail.activityId ? `Activity ID: ${detail.activityId}` : undefined,
    detail.sportType !== undefined ? `Sport type: ${detail.sportType}` : undefined,
    detail.startTime ? `Date: ${formatIsoDate(detail.startTime)}` : undefined,
    detail.distance
      ? `Distance: ${formatDistanceValue(detail.distance, swim ? swimUnits : unitSystem, { swim })}`
      : undefined,
    moving
      ? `${showElapsed ? "Moving time" : "Duration"}: ${formatDurationSeconds(moving)}`
      : undefined,
    showElapsed && detail.duration
      ? `Elapsed: ${formatDurationSeconds(detail.duration)} (${formatDurationSeconds(paused)} paused)`
      : undefined,
    performance,
    detail.avgHr ? `Avg HR: ${detail.avgHr} bpm` : undefined,
    detail.maxHr ? `Max HR: ${detail.maxHr} bpm` : undefined,
    detail.elevationGain
      ? `Elevation gain: +${formatElevationValue(detail.elevationGain, unitSystem)}`
      : undefined,
    detail.avgPower ? `Avg power: ${detail.avgPower} W` : undefined,
    detail.maxPower ? `Max power: ${detail.maxPower} W` : undefined,
    detail.normalizedPower ? `Normalized power: ${detail.normalizedPower} W` : undefined,
    // A swim's cadence is its stroke rate: listed with the swim's figures
    // below when there are any, and named as stroke rate here otherwise.
    detail.avgCadence && !detail.swim
      ? `${swim ? "Avg stroke rate" : "Avg cadence"}: ${formatCadence(detail.avgCadence, cycling, swim)}`
      : undefined,
    detail.maxCadence && !detail.swim
      ? `${swim ? "Max stroke rate" : "Max cadence"}: ${formatCadence(detail.maxCadence, cycling, swim)}`
      : undefined,
    detail.trainingLoad ? `Training load: ${detail.trainingLoad}` : undefined,
    detail.calories ? `Calories: ${Math.round(detail.calories)}` : undefined
  ].filter(Boolean);

  const sections = ["Activity detail", summaryParts.join("\n")];
  if (detail.swim) sections.push("", formatSwimSummary(detail.swim, swimUnits, unitSystem));
  if (swim && hasSwimStrokeFigures(detail, includeSeries)) sections.push("", SWIM_STROKE_NOTE);
  if (detail.workout) sections.push("", formatWorkout(detail.workout, swim ? swimUnits : unitSystem, swim));
  const swimRows = swim && detail.laps.some((lap) => lap.rest || lap.stroke !== undefined || lap.strokes !== undefined || lap.swolf !== undefined);

  // A gym lap list mixes work sets, rests and per-exercise roll-ups, so a lap
  // table would count every set twice; list the parsed sets instead.
  if (detail.strength && detail.strength.exercises.length > 0) {
    sections.push("", formatStrengthSets(detail.strength, unitSystem));
  } else if (swimRows) {
    const pool = detail.swim?.poolLength !== undefined;
    sections.push("", formatSwimRows(pool ? "Intervals" : "Laps", detail.laps, swimUnits, MAX_LAPS));
    const lengths = detail.lapGroups?.find((group) => group.kind === "lengths");
    if (lengths) sections.push("", formatSwimRows("Lengths", lengths.laps, swimUnits, MAX_LENGTHS));
  } else if (detail.laps.length > 0) {
    sections.push("", formatLapTable(detail.laps, unitSystem, swim, cycling));
  } else {
    sections.push("", "Laps: none recorded for this activity.");
  }

  if (includeSeries) {
    sections.push("");
    if (detail.series && detail.series.length > 0) {
      sections.push(
        formatActivitySeriesForChat(
          downsampleActivitySeries(detail.series),
          swim ? swimUnits : unitSystem,
          swim,
          cycling
        )
      );
    } else {
      sections.push(
        "Time series: HR/pace/power/cadence samples are not available in the COROS detail response for this activity. " +
          "For full per-second data, export the FIT file from CorosLink."
      );
    }
  }

  return sections.join("\n");
}

const SWIM_STROKE_NAMES: Record<TrainingHubSwimStroke, string> = {
  freestyle: "freestyle", backstroke: "backstroke", breaststroke: "breaststroke", butterfly: "butterfly",
  drill: "drill", mixed: "mixed", medley: "individual medley"
};

/** m:ss per 100 m, or per 100 yd. */
function formatSwimPace(secondsPer100m: number, unitSystem: UnitSystem): string {
  const clock = swimPaceClock(secondsPer100m, unitSystem);
  return clock ? `${clock}/${swimPaceUnit(unitSystem)}` : "—";
}

/**
 * What one stroke is on a COROS watch: a full cycle of the arm wearing it,
 * never doubled. Every figure built on the count (stroke rate, SWOLF,
 * distance per stroke) follows it, so the coach doesn't compare them with
 * figures that count every hand entry. The get_activity_detail description
 * carries the same definition.
 */
const SWIM_STROKE_NOTE =
  "Strokes: one stroke is a full cycle of the arm wearing the watch, not a single arm pull, and stroke rate, " +
  "SWOLF and distance per stroke all use that count. In freestyle and backstroke, figures that count both arms' " +
  "pulls show about twice the strokes and stroke rate, a higher SWOLF and about half the distance per stroke; " +
  "in breaststroke and butterfly the arms move together, so they match.";

/** Whether a swim's text shows any figure built on the stroke count. */
function hasSwimStrokeFigures(detail: TrainingHubActivityDetail, includeSeries: boolean): boolean {
  const summary = detail.swim;
  if (summary && [summary.strokes, summary.avgStrokeRate, summary.maxStrokeRate, summary.strokeDistance, summary.avgSwolf, summary.bestSwolf]
    .some((value) => value !== undefined)) return true;
  if (!summary && (detail.avgCadence || detail.maxCadence)) return true;
  const laps = [...detail.laps, ...(detail.lapGroups?.flatMap((group) => group.laps) ?? [])];
  if (laps.some((lap) => lap.strokes !== undefined || lap.strokeRate !== undefined || lap.swolf !== undefined
    || lap.avgCadence !== undefined || lap.maxCadence !== undefined)) return true;
  return includeSeries && Boolean(detail.series?.some((point) => point.cadence !== undefined));
}

/** The swim's totals as the watch recorded them; SWOLF is a length's seconds plus its strokes (lower is more efficient). */
function formatSwimSummary(swim: TrainingHubSwimSummary, swimUnits: UnitSystem, unitSystem: UnitSystem): string {
  const lengthUnit = swimUnits === "imperial" ? "yd" : "m";
  const inPoolUnit = (meters: number) => Math.round((swimUnits === "imperial" ? meters / METERS_PER_YARD : meters) * 100) / 100;
  const lines = [
    "Swim (as the watch recorded it):",
    swim.poolLength !== undefined ? `Pool length: ${inPoolUnit(swim.poolLength)} ${lengthUnit}` : undefined,
    swim.lengths !== undefined ? `Lengths swum: ${swim.lengths}` : undefined,
    swim.swimTime !== undefined ? `Swim time (lengths only, rests left out): ${formatDurationSeconds(swim.swimTime)}` : undefined,
    swim.bestPace !== undefined ? `Best pace: ${formatSwimPace(swim.bestPace, swimUnits)}` : undefined,
    swim.strokes !== undefined ? `Total strokes: ${swim.strokes}` : undefined,
    swim.avgSwolf !== undefined ? `Avg SWOLF: ${swim.avgSwolf}` : undefined,
    swim.bestSwolf !== undefined ? `Best SWOLF: ${swim.bestSwolf}` : undefined,
    swim.avgStrokeRate !== undefined ? `Avg stroke rate: ${swim.avgStrokeRate} strokes/min` : undefined,
    swim.maxStrokeRate !== undefined ? `Max stroke rate: ${swim.maxStrokeRate} strokes/min` : undefined,
    swim.strokeDistance !== undefined ? `Distance per stroke: ${inPoolUnit(swim.strokeDistance)} ${lengthUnit}` : undefined,
    swim.waterTemperature !== undefined
      ? `Water temperature: ${unitSystem === "imperial" ? `${Math.round((swim.waterTemperature * 9) / 5 + 32)} °F` : `${swim.waterTemperature} °C`}`
      : undefined
  ].filter(Boolean);
  return lines.join("\n");
}

/** A swim's intervals or lengths: stroke, strokes, SWOLF and stroke rate per row, with the rests between them. */
/** The workout followed on the watch. */
function formatWorkout(workout: TrainingHubActivityWorkout, units: UnitSystem, swim: boolean): string {
  const planned = [
    workout.plannedDistance !== undefined ? `${formatDistanceValue(workout.plannedDistance, units, { swim })} of distance steps` : undefined,
    workout.plannedTime !== undefined ? `${formatDurationSeconds(workout.plannedTime)} of timed steps (rests not counted)` : undefined
  ].filter(Boolean);
  return [
    `Workout${workout.scheduled ? " (scheduled from the training calendar)" : ""}: ${tableText(workout.name ?? "unnamed")}`,
    planned.length ? `Planned: ${planned.join(" and ")}` : undefined
  ].filter(Boolean).join("\n");
}

/** A name in a "|" table: no column breaks or line breaks of its own. */
const tableText = (text: string) => text.replace(/[|\r\n]+/g, " ").trim();

const STEP_KIND_NAMES: Record<NonNullable<TrainingHubLapStep["kind"]>, string> = { warmup: "warm-up", work: "work", recovery: "recovery", cooldown: "cool-down" };

/** The range a workout step asked to stay in. */
function formatStepRange(range: TrainingHubLapStep["range"], unitSystem: UnitSystem): string | undefined {
  if (!range) return undefined;
  const whole = (value: number) => Math.round(value);
  switch (range.kind) {
    case "pace": return `${formatPaceSeconds(range.low, unitSystem)}–${formatPaceSeconds(range.high, unitSystem)}`;
    case "speed": return `${formatSpeedValue(range.low * 3.6, unitSystem)}–${formatSpeedValue(range.high * 3.6, unitSystem)}`;
    case "heartRate": return `HR ${whole(range.low)}–${whole(range.high)} bpm`;
    case "power": return `${whole(range.low)}–${whole(range.high)} W`;
    case "cadence": return `cadence ${whole(range.low)}–${whole(range.high)}/min`;
  }
}

/** A lap's workout step: name, kind of step, repeat round, target. */
function formatLapStep(step: TrainingHubLapStep | undefined, units: UnitSystem, swim = true): string {
  if (!step) return "—";
  const target = !step.target ? undefined
    : step.target.kind === "distance" ? formatDistanceValue(step.target.value, units, { swim })
      : step.target.kind === "time" ? formatDurationSeconds(step.target.value)
        : `HR below ${Math.round(step.target.value)} bpm`;
  const range = formatStepRange(step.range, units);
  const round = step.round !== undefined && step.rounds !== undefined ? `${step.round}/${step.rounds}` : undefined;
  return [
    tableText(step.name ?? "step"),
    // A swim's rests and strokes already say what kind of step it was.
    !swim && step.kind ? ` [${STEP_KIND_NAMES[step.kind]}]` : "",
    step.group ? ` (${tableText(step.group)}${round ? ` ${round}` : ""})` : round ? ` (round ${round})` : "",
    target ? `, target ${target}` : "",
    range ? ` at ${range}` : ""
  ].join("");
}

function formatSwimRows(title: "Intervals" | "Laps" | "Lengths", rows: TrainingHubActivityLap[], swimUnits: UnitSystem, max: number): string {
  const capped = rows.slice(0, max);
  // Workout steps, rest heart-rate drops and per-lap load only when the swim has them.
  const steps = rows.some((row) => row.step !== undefined);
  const drops = rows.some((row) => row.hrDrop !== undefined);
  const loads = rows.some((row) => row.trainingLoad !== undefined);
  const header = ["#", ...(steps ? ["Step"] : []), "Stroke", "Lengths", "Distance", "Duration", "Pace", "Strokes", "SWOLF", "Stroke rate", "Avg HR", "Max HR",
    ...(drops ? ["HR drop"] : []), ...(loads ? ["Load"] : [])].join(" | ");
  const extra = (row: TrainingHubActivityLap) => [
    ...(drops ? [row.hrDrop !== undefined ? `${row.hrDrop} bpm` : ""] : []),
    ...(loads ? [row.trainingLoad ?? "—"] : [])
  ];
  let number = 0;
  const lines = capped.map((row) => {
    if (row.rest) {
      return [
        row.autoRest ? "rest (auto-detected)" : "rest", ...(steps ? [row.step ? formatLapStep(row.step, swimUnits) : ""] : []), "", "", "",
        row.duration ? formatDurationSeconds(row.duration) : "—", "", "", "", "", row.avgHr ?? "—", row.maxHr ?? "—", ...extra(row)
      ].join(" | ");
    }
    number += 1;
    return [
      String(number),
      ...(steps ? [formatLapStep(row.step, swimUnits)] : []),
      row.stroke ? SWIM_STROKE_NAMES[row.stroke] : "—",
      row.lengths ?? "—",
      row.distance ? formatDistanceValue(row.distance, swimUnits, { swim: true }) : "—",
      row.duration ? formatDurationSeconds(row.duration) : "—",
      row.swimPace ? formatSwimPace(row.swimPace, swimUnits) : "—",
      row.strokes ?? "—",
      row.swolf ?? "—",
      row.strokeRate !== undefined ? `${row.strokeRate}/min` : "—",
      row.avgHr ?? "—",
      row.maxHr ?? "—",
      ...extra(row)
    ].join(" | ");
  });
  const result = [`${title} (rests between them as "rest" rows):`, header, ...lines];
  if (rows.length > max) result.push(`… ${rows.length - max} more rows omitted`);
  return result.join("\n");
}

function formatStrengthSets(strength: StrengthDetail, unitSystem: UnitSystem): string {
  const lines = ["Strength sets (rest rows and per-exercise roll-ups left out):"];
  for (const exercise of strength.exercises) {
    const sets = exercise.entries
      .map((set) =>
        set.weightKg > 0 ? `${set.reps} × ${formatWeightValue(set.weightKg, unitSystem)}` : `${set.reps} reps`
      )
      .join(", ");
    lines.push(
      `- ${exercise.rawName ?? exercise.nameKey}: ${exercise.entries.length} ${
        exercise.entries.length === 1 ? "set" : "sets"
      }, ${exercise.totalReps} reps · ${sets}`
    );
  }
  lines.push("Names in T####/S#### form are COROS exercise catalog codes.");
  return lines.join("\n");
}

function formatLapTable(
  laps: TrainingHubActivityLap[],
  unitSystem: UnitSystem,
  swim: boolean,
  cycling: boolean
): string {
  const capped = laps.slice(0, MAX_LAPS);
  // Power and cadence columns appear only when the watch recorded them, so
  // HR-only activities keep the compact table.
  const optionalColumns = LAP_SENSOR_COLUMNS.filter((column) =>
    capped.some((lap) => lap[column.key] !== undefined)
  );
  // A watch workout's steps, rest heart-rate drops and each lap's load, when the activity has them.
  const steps = capped.some((lap) => lap.step !== undefined);
  const drops = capped.some((lap) => lap.hrDrop !== undefined);
  const loads = capped.some((lap) => lap.trainingLoad !== undefined);
  const header = [
    `Lap${steps ? " | Step" : ""} | Distance | Duration | Avg HR | Max HR | ${cycling ? "Speed" : "Pace"}`,
    // A swim's cadence columns are its stroke rate.
    ...optionalColumns.map((column) => swim && column.unit === "cadence" ? column.label.replace("Cadence", "Stroke Rate") : column.label),
    ...(drops ? ["HR drop"] : []),
    ...(loads ? ["Load"] : [])
  ].join(" | ");
  const rows = capped.map((lap) => {
    const cols = [
      String(lap.index),
      ...(steps ? [formatLapStep(lap.step, unitSystem, swim)] : []),
      lap.distance ? formatDistanceValue(lap.distance, unitSystem, { swim }) : "—",
      lap.duration ? formatDurationSeconds(lap.duration) : "—",
      lap.avgHr ? `${lap.avgHr}` : "—",
      lap.maxHr ? `${lap.maxHr}` : "—",
      cycling && lap.distance && lap.duration
        ? formatSpeedValue((lap.distance / 1000) / (lap.duration / 3600), unitSystem)
        : lap.pace ? formatPaceSeconds(lap.pace, unitSystem) : "—",
      ...optionalColumns.map((column) => {
        const value = lap[column.key];
        if (value === undefined) {
          return "—";
        }
        return column.unit === "W" ? `${value} W` : formatCadence(value, cycling, swim);
      }),
      ...(drops ? [lap.hrDrop !== undefined ? `${lap.hrDrop} bpm` : ""] : []),
      ...(loads ? [lap.trainingLoad ?? "—"] : [])
    ];
    return cols.join(" | ");
  });

  const lines = ["Laps:", header, ...rows];
  if (laps.length > MAX_LAPS) {
    lines.push(`… ${laps.length - MAX_LAPS} more laps omitted`);
  }
  return lines.join("\n");
}

const LAP_SENSOR_COLUMNS: ReadonlyArray<{
  key: "avgPower" | "maxPower" | "avgCadence" | "maxCadence";
  label: string;
  unit: "W" | "cadence";
}> = [
  { key: "avgPower", label: "Avg Power", unit: "W" },
  { key: "maxPower", label: "Max Power", unit: "W" },
  { key: "avgCadence", label: "Avg Cadence", unit: "cadence" },
  { key: "maxCadence", label: "Max Cadence", unit: "cadence" }
];

function formatCadence(value: number, cycling: boolean, swim = false): string {
  return `${value} ${swim ? "strokes/min" : cycling ? "rpm" : "spm"}`;
}

function formatIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function formatDurationSeconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPaceSeconds(
  paceSecondsPerKm: number,
  unitSystem: UnitSystem = "metric"
): string {
  return formatPaceValue(paceSecondsPerKm, unitSystem).replace(" /", "/");
}

export { formatDurationSeconds, formatPaceSeconds };
