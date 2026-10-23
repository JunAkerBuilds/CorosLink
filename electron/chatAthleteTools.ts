import {
  ATHLETE_FACT_CATEGORIES,
  ATHLETE_FACT_CATEGORY_LABELS,
  MAX_ATHLETE_FACT_LENGTH,
  type AthleteFact,
  type AthleteFactInput,
  type AthleteMemoryChange
} from "./athleteMemoryModel";
import type { CoachDataStatus } from "./coachDataStatus";
import type { CoachReviewDraft } from "./coachReviewActions";
import type { CoachReviewItem, CoachReviewPreview } from "./coachReviewTypes";
import type { CoachWeatherReport } from "./coachWeather";
import type { PlanComplianceReport } from "./planCompliance";
import { RACE_DISTANCE_KEYS, raceDistanceLabel } from "./raceModel";
import type { RaceOverview, RaceTarget, RaceTargetInput } from "./raceTypes";
import type { StrengthProgressReport } from "./strengthProgress";
import type { ClaudeCodePermissions, CorosMcpTool, TrainingHubScheduledWorkoutEntry, UnitSystem } from "./types";
import { formatDistanceValue, formatPaceValue } from "./unitSystem";

// The Coach's view of the athlete beyond single activities: what they told it
// before (memory), their zones, races, how the plan is going, the weather, the
// weights they lift and whether the data is fresh. Reads answer at once; the
// three writes outside memory (moves, a target race, zones) stage a review card.
// The services come in as dependencies, so the tools test without Electron.

export const CHAT_ATHLETE_TOOL_NAMES = [
  "get_athlete_context",
  "remember_athlete_fact",
  "forget_athlete_fact",
  "list_races",
  "add_target_race",
  "get_plan_compliance",
  "get_weather_forecast",
  "get_strength_history",
  "propose_zone_update"
] as const;

export type ChatAthleteToolName = (typeof CHAT_ATHLETE_TOOL_NAMES)[number];

export function isChatAthleteTool(name: string): name is ChatAthleteToolName {
  return (CHAT_ATHLETE_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Which of Claude's switches an athlete tool needs. Memory, weather and the
 * context bundle carry no COROS data of their own; the bundle leaves out the
 * parts whose switch is off.
 */
export function claudeCanUseAthleteTool(name: string, permissions: ClaudeCodePermissions): boolean {
  switch (name) {
    case "list_races":
    case "add_target_race":
    case "get_strength_history":
      return permissions.recentActivities;
    case "get_plan_compliance":
      return permissions.recentActivities && permissions.upcomingWorkouts;
    case "propose_zone_update":
      return permissions.trainingMetrics;
    default:
      return true;
  }
}

export const ATHLETE_CONTEXT_SECTIONS = ["memory", "zones", "races", "data_status"] as const;
export type AthleteContextSection = (typeof ATHLETE_CONTEXT_SECTIONS)[number];

/** The watch's (or COROS account's) thresholds and zones, as the Coach reads them. */
export interface AthleteZonesSnapshot {
  source: "watch" | "training_hub" | "none";
  read_at?: string;
  thresholds: {
    max_hr?: number;
    resting_hr?: number;
    threshold_hr?: number;
    threshold_pace?: string;
    ftp_w?: number;
    critical_power_w?: number;
  };
  hr_zone_basis?: string;
  hr_zones?: Array<{ zone: number; range: string }>;
  pace_zones?: Array<{ zone: number; range: string }>;
  power_zones?: Array<{ zone: number; range: string }>;
  /** COROS account thresholds, when they differ from the watch's. */
  training_hub?: AthleteZonesSnapshot["thresholds"];
  body_weight: string;
  update: { possible: boolean; editable: string[]; reason?: string };
  /** Canonical current values, for propose_zone_update. */
  current?: { maxHr: number; restingHr: number; thresholdHr: number; hrZoneType: number; thresholdPaceSecondsPerKm: number };
}

export interface ZoneEdits {
  maxHr?: number;
  restingHr?: number;
  thresholdHr?: number;
  hrZoneType?: number;
  thresholdPaceSecondsPerKm?: number;
}

export interface AthleteToolDependencies {
  unitSystem: UnitSystem;
  /** Local YYYYMMDD. */
  today: () => string;
  /** Sections this provider may read; Claude Code's switches can hide zones and races. */
  allowed: { zones: boolean; races: boolean };
  claude: boolean;
  memory: {
    list: () => AthleteFact[];
    save: (input: AthleteFactInput) => AthleteMemoryChange;
    remove: (id: string) => AthleteMemoryChange | undefined;
  };
  /** Each memory write, for the transcript ("Coach remembered: …"). */
  onMemoryChange: (change: AthleteMemoryChange) => void;
  races: {
    overview: () => RaceOverview;
    normalizeTarget: (input: RaceTargetInput) => Omit<RaceTarget, "targetId" | "createdAt">;
  };
  zones: () => Promise<AthleteZonesSnapshot>;
  dataStatus: () => Promise<CoachDataStatus>;
  compliance: (startDay: string, endDay: string) => Promise<PlanComplianceReport>;
  weather: (day: string, place?: string) => Promise<CoachWeatherReport>;
  strength: (days: number, exercise?: string, limit?: number) => Promise<StrengthProgressReport & { warnings?: string[] }>;
  stageReview: (draft: CoachReviewDraft) => CoachReviewPreview;
  onReview: (preview: CoachReviewPreview) => void;
}

const DATE = { type: "string", description: "YYYYMMDD" } as const;
const REVIEW_SUMMARY = {
  type: "string",
  description: "Short athlete-facing reason for the change, in plain language. No internal IDs."
} as const;

export function getChatAthleteTools(options: { trainingData: boolean }): CorosMcpTool[] {
  const tools: CorosMcpTool[] = [
    {
      name: "get_athlete_context",
      description:
        "Read what CorosLink knows about the athlete in one call: saved memory facts (goals, injuries and niggles, training days, " +
        "equipment, preferences), heart-rate, pace and power zones and thresholds, upcoming target races and recent race results, " +
        "and data freshness (newest synced activity, watch, Training Hub and COROS MCP connections, recent sync errors). " +
        "Call it at the start of a conversation about training, a plan or a race, and again when data looks missing or stale. " +
        "Pass sections to read only part of it.",
      inputSchema: {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: { type: "string", enum: [...ATHLETE_CONTEXT_SECTIONS] },
            description: "Parts to read. Defaults to all of them."
          }
        }
      }
    },
    {
      name: "remember_athlete_fact",
      description:
        "Save one lasting fact the athlete told you, so later conversations know it: a goal, an injury or niggle, which days or how long " +
        "they can train, equipment, a preference, or a health note they offered. One short sentence that still reads correctly later, " +
        "with dates where they matter (\"Left calf strain since 2026-10-18; easy running only\"). Save only what the athlete said or confirmed; " +
        "never guess, and don't save one-off details of a single session. When a saved fact changed, pass replaces_fact_id instead of adding another. " +
        "Each save shows in the chat, and the athlete can edit or delete it in Coach settings.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...ATHLETE_FACT_CATEGORIES] },
          fact: { type: "string", maxLength: MAX_ATHLETE_FACT_LENGTH, description: "The fact, one sentence." },
          replaces_fact_id: { type: "string", description: "Id of the saved fact this one replaces, e.g. f3k9x2a." }
        },
        required: ["category", "fact"]
      }
    },
    {
      name: "forget_athlete_fact",
      description: "Delete a saved fact that is no longer true, or that the athlete asks you to forget. The athlete sees it in the chat.",
      inputSchema: {
        type: "object",
        properties: { fact_id: { type: "string", description: "Id of the saved fact, e.g. f3k9x2a." } },
        required: ["fact_id"]
      }
    }
  ];
  if (!options.trainingData) return [...tools, weatherTool()];
  return [
    ...tools,
    {
      name: "list_races",
      description:
        "List the athlete's races: target races they are training for (date, distance, goal time and pace, priority, days to go) " +
        "and finished results (official time, pace, average HR, placing, and the build-up runs and distance in the 8 weeks before), " +
        "with the best time per distance. Use it for race-specific plans, tapers, goal paces and progress between races.",
      inputSchema: {
        type: "object",
        properties: {
          include: { type: "string", enum: ["all", "targets", "results"], description: "Default all." },
          distance: { type: "string", enum: [...RACE_DISTANCE_KEYS], description: "Only this distance." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "Most recent results to return. Default 12." }
        }
      }
    },
    {
      name: "add_target_race",
      description:
        "Prepare a review card that adds a race the athlete is training for to their Races list, with an optional goal time and priority " +
        "(A = the season's goal, B important, C tune-up). Nothing is saved until the athlete clicks Add race. " +
        "Use it when the athlete names an upcoming race that list_races doesn't have yet. After awaiting_confirmation, describe the card and stop.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Event name." },
          date: { ...DATE, description: "Race day, YYYYMMDD." },
          distance: { type: "string", enum: [...RACE_DISTANCE_KEYS] },
          distance_km: { type: "number", minimum: 0.1, maximum: 500, description: "Course length in km; required when distance is other." },
          goal_time: { type: "string", description: "Goal finish time as H:MM:SS or MM:SS." },
          priority: { type: "string", enum: ["A", "B", "C"] },
          location: { type: "string" },
          notes: { type: "string" },
          review_summary: REVIEW_SUMMARY
        },
        required: ["name", "date", "distance", "review_summary"]
      }
    },
    {
      name: "get_plan_compliance",
      description:
        "Planned versus done for each scheduled workout in a date range: done, partial (under 75% of the plan), over (above 125%), " +
        "missed, skipped (the athlete said no activity belongs to it), today, or upcoming, with completion percent, planned and actual load, " +
        "and the linked activity. A workout counts as done only when COROS linked the activity (started from the plan on the watch) or the athlete " +
        "linked it in the calendar; same-day activities nobody linked are listed separately as unlinked_activities, so ask before counting one. " +
        "Check it before adapting a plan, judging consistency, or moving workouts.",
      inputSchema: {
        type: "object",
        properties: {
          start_date: { ...DATE, description: "Start YYYYMMDD. Defaults to 14 days ago." },
          end_date: { ...DATE, description: "End YYYYMMDD. Defaults to 7 days from today." }
        }
      }
    },
    weatherTool(),
    {
      name: "get_strength_history",
      description:
        "What the athlete actually lifted, from COROS strength activities and connected Hevy or Strava logs: per exercise the sessions, " +
        "sets, reps, volume, best set, estimated one-rep max per session and its change over the window, recent RPE; per muscle the work sets " +
        "where it is a main mover, sets per week, share-weighted sets and volume. Warm-up sets are left out. Use it for progressive-overload advice (then prepare_exercise_load_update to " +
        "change loads in scheduled Strength workouts), muscle balance, and whether strength is moving.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer", minimum: 7, maximum: 365, description: "Window in days. Default 90." },
          exercise: { type: "string", description: "Only exercises whose name contains this, e.g. squat." },
          limit: { type: "integer", minimum: 1, maximum: 40, description: "Exercises to return, most trained first. Default 15." }
        }
      }
    },
    {
      name: "propose_zone_update",
      description:
        "Prepare a review card that changes the thresholds on the athlete's watch: max, resting and threshold heart rate, the heart-rate " +
        "zone basis, and threshold pace. Each zone set moves with its reference value, keeping its proportions. Read get_athlete_context " +
        "(zones) first and propose a change only from evidence (a recent test, race or repeated workouts above the old threshold) the " +
        "athlete agreed to. The watch must be connected over Bluetooth when the athlete clicks Update watch; the card says so. " +
        "FTP and body weight can't be changed here. After awaiting_confirmation, describe the card and stop.",
      inputSchema: {
        type: "object",
        properties: {
          max_hr: { type: "integer", minimum: 100, maximum: 240 },
          resting_hr: { type: "integer", minimum: 25, maximum: 120 },
          threshold_hr: { type: "integer", minimum: 80, maximum: 230 },
          hr_zone_basis: { type: "string", enum: ["max_hr", "heart_rate_reserve", "threshold_hr"] },
          threshold_pace_seconds_per_km: {
            type: "integer",
            minimum: 120,
            maximum: 900,
            description: "Threshold pace in seconds per kilometre (canonical, whatever units the athlete uses)."
          },
          review_summary: REVIEW_SUMMARY
        },
        required: ["review_summary"]
      }
    }
  ];
}

function weatherTool(): CorosMcpTool {
  return {
    name: "get_weather_forecast",
    description:
      "Forecast for one day (today through 14 days ahead) at the athlete's saved weather location or a named place: low and high, " +
      "and within about 4 days hourly temperature, feels-like, humidity, dew point, rain chance, wind, UV and US AQI from 05:00 to 21:00, " +
      "the coolest and hottest two-hour windows, a heat pace adjustment estimate (temperature + dew point rule of thumb) and the worst air quality. " +
      "Check it before prescribing a hard or long outdoor session, to adjust paces in heat and humidity, pick a cooler time or day, or warn about poor air.",
    inputSchema: {
      type: "object",
      properties: {
        date: { ...DATE, description: "Day, YYYYMMDD. Defaults to today." },
        place: { type: "string", description: "City or place name when it isn't the athlete's usual location (a race or a trip)." }
      }
    }
  };
}

// ----- Handlers -----

function failure(error_code: string, action: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: false, error_code, action, ...extra });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** YYYYMMDD from YYYYMMDD or YYYY-MM-DD, checked against the calendar. */
export function compactDay(value: unknown): string | undefined {
  const compact = typeof value === "string" ? value.trim().replace(/-/g, "") : typeof value === "number" ? String(value) : "";
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10).replace(/-/g, "") === compact ? compact : undefined;
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + days));
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function dayDistance(from: string, to: string): number {
  const time = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  return Math.round((time(to) - time(from)) / 86_400_000);
}

function isoDay(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

function weekdayLabel(day: string): string {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Seconds from H:MM:SS, MM:SS or a number of seconds. */
export function parseClock(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  const match = typeof value === "string" ? /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match) return undefined;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return seconds > 0 && Number(match[3]) < 60 ? seconds : undefined;
}

export function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export async function handleChatAthleteTool(
  name: ChatAthleteToolName,
  args: Record<string, unknown>,
  deps: AthleteToolDependencies
): Promise<string> {
  try {
    switch (name) {
      case "get_athlete_context": return await athleteContext(args, deps);
      case "remember_athlete_fact": return remember(args, deps);
      case "forget_athlete_fact": return forget(args, deps);
      case "list_races": return listRaces(args, deps);
      case "add_target_race": return addTargetRace(args, deps);
      case "get_plan_compliance": return await planCompliance(args, deps);
      case "get_weather_forecast": return await weather(args, deps);
      case "get_strength_history": return await strengthHistory(args, deps);
      case "propose_zone_update": return await zoneUpdate(args, deps);
    }
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "This tool is unavailable right now." });
  }
}

function memoryView(facts: AthleteFact[]) {
  return facts.map((fact) => ({
    id: fact.id,
    category: fact.category,
    label: ATHLETE_FACT_CATEGORY_LABELS[fact.category],
    fact: fact.text,
    updated: fact.updatedAt.slice(0, 10),
    ...(fact.author === "athlete" ? { written_by: "athlete" } : {})
  }));
}

async function athleteContext(args: Record<string, unknown>, deps: AthleteToolDependencies): Promise<string> {
  const requested = Array.isArray(args.sections)
    ? args.sections.filter((section): section is AthleteContextSection => (ATHLETE_CONTEXT_SECTIONS as readonly string[]).includes(String(section)))
    : [];
  const sections = new Set<AthleteContextSection>(requested.length ? requested : ATHLETE_CONTEXT_SECTIONS);
  const result: Record<string, unknown> = { ok: true };
  const hidden: string[] = [];
  if (sections.has("memory")) {
    const facts = deps.memory.list();
    result.memory = facts.length
      ? memoryView(facts)
      : "Nothing saved yet. Save lasting facts the athlete shares with remember_athlete_fact.";
  }
  const reads: Array<Promise<void>> = [];
  if (sections.has("zones")) {
    if (deps.allowed.zones) {
      reads.push(deps.zones().then((zones) => {
        const { current: _current, ...view } = zones;
        result.zones = view;
      }, (error: unknown) => { result.zones = { unavailable: error instanceof Error ? error.message : "Zones are unavailable." }; }));
    } else hidden.push("zones (Training metrics is off in Claude's Coach settings)");
  }
  if (sections.has("races")) {
    if (deps.allowed.races) {
      try {
        result.races = raceSummary(deps.races.overview(), deps, { include: "all", limit: 5 });
      } catch (error) {
        result.races = { unavailable: error instanceof Error ? error.message : "Races are unavailable." };
      }
    } else hidden.push("races (Recent activities is off in Claude's Coach settings)");
  }
  if (sections.has("data_status")) {
    reads.push(deps.dataStatus().then((status) => { result.data_status = status; }, (error: unknown) => {
      result.data_status = { unavailable: error instanceof Error ? error.message : "Data status is unavailable." };
    }));
  }
  await Promise.all(reads);
  if (hidden.length) result.not_shared = hidden;
  return JSON.stringify(result);
}

function remember(args: Record<string, unknown>, deps: AthleteToolDependencies): string {
  const replaces = text(args.replaces_fact_id);
  const change = deps.memory.save({ ...(replaces ? { id: replaces } : {}), category: args.category, text: args.fact });
  if (change.action === "unchanged") {
    return JSON.stringify({ ok: true, saved: false, fact: memoryView([change.fact])[0], note: "Already saved in these words; nothing changed." });
  }
  deps.onMemoryChange(change);
  return JSON.stringify({
    ok: true,
    saved: change.action,
    fact: memoryView([change.fact])[0],
    action: "The athlete sees this in the chat and can undo it. Mention it in a few words only if it helps; don't repeat the whole fact."
  });
}

function forget(args: Record<string, unknown>, deps: AthleteToolDependencies): string {
  const id = text(args.fact_id);
  if (!id) return failure("fact_id_required", "Pass the id of the fact to forget, from get_athlete_context.");
  const change = deps.memory.remove(id);
  if (!change) return failure("fact_not_found", "No saved fact has that id. Read the memory with get_athlete_context.");
  deps.onMemoryChange(change);
  return JSON.stringify({ ok: true, forgot: memoryView([change.fact])[0] });
}

function raceSummary(
  overview: RaceOverview,
  deps: AthleteToolDependencies,
  options: { include: "all" | "targets" | "results"; distance?: string; limit: number }
) {
  const { unitSystem } = deps;
  const today = deps.today();
  const pace = (meters: number, seconds: number) => formatPaceValue(seconds / (meters / 1000), unitSystem);
  const targets = (overview.targets ?? [])
    .filter((target) => target.raceDay >= today && (!options.distance || target.distanceKey === options.distance))
    .map((target) => ({
      name: target.name,
      date: isoDay(target.raceDay),
      days_to_go: dayDistance(today, target.raceDay),
      distance: target.distanceKey === "other" ? formatDistanceValue(target.distance, unitSystem) : raceDistanceLabel(target.distanceKey),
      ...(target.goalTime ? { goal_time: formatClock(target.goalTime), goal_pace: pace(target.distance, target.goalTime) } : {}),
      ...(target.priority ? { priority: target.priority } : {}),
      ...(target.location ? { location: target.location } : {}),
      ...(target.notes ? { notes: target.notes } : {})
    }));
  const results = overview.races.filter((race) => !options.distance || race.distanceKey === options.distance);
  const best = new Map<string, (typeof results)[number]>();
  for (const race of results) {
    if (race.distanceKey === "other") continue;
    const current = best.get(race.distanceKey);
    if (!current || race.officialTime < current.officialTime) best.set(race.distanceKey, race);
  }
  const view = {
    ...(options.include !== "results" ? { targets: targets.length ? targets : "No target races saved. Add one with add_target_race when the athlete names it." } : {}),
    ...(options.include !== "targets"
      ? {
          results: results.length
            ? results.slice(0, options.limit).map((race) => ({
                name: race.name,
                date: new Date(race.startTime * 1000).toISOString().slice(0, 10),
                distance: race.distanceKey === "other" ? formatDistanceValue(race.officialDistance, unitSystem) : raceDistanceLabel(race.distanceKey),
                time: formatClock(race.officialTime),
                pace: pace(race.officialDistance, race.officialTime),
                ...(race.avgHr ? { avg_hr: race.avgHr } : {}),
                ...(race.placing ? { placing: race.placing } : {}),
                ...(race.notes ? { notes: race.notes } : {}),
                ...(race.corosActivityId ? { activity_id: race.corosActivityId } : {}),
                ...(race.buildUp
                  ? {
                      build_up: `${race.buildUp.runs} runs, ${formatDistanceValue(race.buildUp.distance, unitSystem)} in ${race.buildUp.weeks} weeks` +
                        (race.buildUp.longestRun ? `, longest ${formatDistanceValue(race.buildUp.longestRun, unitSystem)}` : "") +
                        (race.buildUp.complete ? "" : " (history starts inside the window, so this undercounts)")
                    }
                  : {})
              }))
            : "No race results tagged yet. The athlete marks races from an activity (Mark as race) or adds them in Training Hub → Races.",
          best_times: [...best.values()].map((race) => ({
            distance: raceDistanceLabel(race.distanceKey),
            time: formatClock(race.officialTime),
            date: new Date(race.startTime * 1000).toISOString().slice(0, 10),
            name: race.name
          }))
        }
      : {})
  };
  return view;
}

function listRaces(args: Record<string, unknown>, deps: AthleteToolDependencies): string {
  const include = args.include === "targets" || args.include === "results" ? args.include : "all";
  const requested = Number(args.limit);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.round(requested))) : 12;
  const distance = typeof args.distance === "string" && (RACE_DISTANCE_KEYS as readonly string[]).includes(args.distance) ? args.distance : undefined;
  return JSON.stringify({ ok: true, ...raceSummary(deps.races.overview(), deps, { include, distance, limit }) });
}

function awaiting(preview: CoachReviewPreview, button: string): string {
  return JSON.stringify({
    status: "awaiting_confirmation",
    preview: { title: preview.title, summary: preview.summary, items: preview.items, ...(preview.notes ? { notes: preview.notes } : {}) },
    action: `The review card is ready. Describe it briefly and wait for the athlete to click ${button}. Nothing has changed yet.`
  });
}

function addTargetRace(args: Record<string, unknown>, deps: AthleteToolDependencies): string {
  const summary = text(args.review_summary);
  if (!summary) return failure("review_summary_required", "Add a plain-language review_summary.");
  const goalTime = args.goal_time === undefined ? undefined : parseClock(args.goal_time);
  if (args.goal_time !== undefined && goalTime === undefined) return failure("invalid_goal_time", "Pass goal_time as H:MM:SS or MM:SS.");
  const distanceKm = Number(args.distance_km);
  const target = deps.races.normalizeTarget({
    name: String(args.name ?? ""),
    raceDay: String(args.date ?? ""),
    distanceKey: args.distance as RaceTargetInput["distanceKey"],
    ...(Number.isFinite(distanceKm) && distanceKm > 0 ? { distance: distanceKm * 1000 } : {}),
    ...(goalTime !== undefined ? { goalTime } : {}),
    ...(args.priority === "A" || args.priority === "B" || args.priority === "C" ? { priority: args.priority } : {}),
    ...(text(args.location) ? { location: text(args.location) } : {}),
    ...(text(args.notes) ? { notes: text(args.notes) } : {})
  });
  const existing = (deps.races.overview().targets ?? []).find(
    (candidate) => candidate.raceDay === target.raceDay && candidate.name.toLowerCase() === target.name.toLowerCase()
  );
  if (existing) return failure("already_saved", "This race is already in the athlete's target races; nothing to add.");
  const { unitSystem } = deps;
  const distance = target.distanceKey === "other" ? formatDistanceValue(target.distance, unitSystem) : raceDistanceLabel(target.distanceKey);
  const items: CoachReviewItem[] = [
    { label: "Race", after: target.name },
    { label: "Date", after: `${weekdayLabel(target.raceDay)} (${dayDistance(deps.today(), target.raceDay)} days to go)` },
    { label: "Distance", after: distance },
    ...(target.goalTime
      ? [{ label: "Goal", after: `${formatClock(target.goalTime)} · ${formatPaceValue(target.goalTime / (target.distance / 1000), unitSystem)}` }]
      : []),
    ...(target.priority ? [{ label: "Priority", after: { A: "A · season goal", B: "B · important", C: "C · tune-up" }[target.priority] }] : []),
    ...(target.location ? [{ label: "Location", after: target.location }] : [])
  ];
  const preview = deps.stageReview({
    action: "addTargetRace",
    title: "Add target race",
    summary,
    items,
    notes: ["Saved in CorosLink's Races list on this computer. Nothing is sent to COROS."],
    payload: target
  });
  deps.onReview(preview);
  return awaiting(preview, "Add race");
}

async function planCompliance(args: Record<string, unknown>, deps: AthleteToolDependencies): Promise<string> {
  const today = deps.today();
  const start = args.start_date === undefined ? shiftDay(today, -14) : compactDay(args.start_date);
  const end = args.end_date === undefined ? shiftDay(today, 7) : compactDay(args.end_date);
  if (!start || !end) return failure("invalid_date", "Pass dates as YYYYMMDD.");
  if (end < start) return failure("invalid_range", "end_date must be on or after start_date.");
  if (dayDistance(start, end) > 92) return failure("range_too_long", "Ask for at most 92 days at a time.");
  const report = await deps.compliance(start, end);
  return JSON.stringify({
    ok: true,
    ...report,
    note: "Only COROS or athlete links count. Ask the athlete before treating an unlinked activity as the planned session; they can link it in the calendar."
  });
}

async function weather(args: Record<string, unknown>, deps: AthleteToolDependencies): Promise<string> {
  const today = deps.today();
  const day = args.date === undefined ? today : compactDay(args.date);
  if (!day) return failure("invalid_date", "Pass date as YYYYMMDD.");
  if (day < today) return failure("past_date", "Forecasts cover today and the next 14 days.");
  if (dayDistance(today, day) > 15) return failure("too_far", "Forecasts reach 14 days ahead. Check again closer to the day.");
  const report = await deps.weather(day, text(args.place));
  return JSON.stringify({ ok: true, ...report });
}

async function strengthHistory(args: Record<string, unknown>, deps: AthleteToolDependencies): Promise<string> {
  const requested = Number(args.days);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(7, Math.round(requested))) : 90;
  const limit = Number.isFinite(Number(args.limit)) ? Math.min(40, Math.max(1, Math.round(Number(args.limit)))) : 15;
  const report = await deps.strength(days, text(args.exercise), limit);
  if (!report.sessions) {
    return JSON.stringify({
      ok: true,
      ...report,
      note: "No strength sessions in this window. COROS strength activities, Hevy and Strava (when connected in Strength) are read."
    });
  }
  return JSON.stringify({ ok: true, ...report });
}

const ZONE_BASIS: Record<string, number> = { max_hr: 1, heart_rate_reserve: 2, threshold_hr: 3 };
const ZONE_BASIS_LABEL: Record<number, string> = { 1: "% of max heart rate", 2: "Heart-rate reserve", 3: "Threshold heart rate" };

async function zoneUpdate(args: Record<string, unknown>, deps: AthleteToolDependencies): Promise<string> {
  const summary = text(args.review_summary);
  if (!summary) return failure("review_summary_required", "Add a plain-language review_summary.");
  const zones = await deps.zones();
  if (!zones.current) {
    return failure("no_watch_profile", zones.update.reason ?? "CorosLink hasn't read the watch's training profile yet. Ask the athlete to connect the watch over Bluetooth once.");
  }
  if (!zones.update.editable.length) {
    return failure("unsupported_watch", zones.update.reason ?? "CorosLink can't change zones on this watch. The athlete can change them in the COROS app.");
  }
  const integer = (value: unknown) => (value === undefined ? undefined : Number.isInteger(Number(value)) ? Number(value) : NaN);
  const edits: ZoneEdits = {};
  const maxHr = integer(args.max_hr);
  const restingHr = integer(args.resting_hr);
  const thresholdHr = integer(args.threshold_hr);
  const pace = integer(args.threshold_pace_seconds_per_km);
  if ([maxHr, restingHr, thresholdHr, pace].some((value) => Number.isNaN(value))) {
    return failure("invalid_value", "Heart rates and threshold pace must be whole numbers.");
  }
  if (maxHr !== undefined && maxHr !== zones.current.maxHr) edits.maxHr = maxHr;
  if (restingHr !== undefined && restingHr !== zones.current.restingHr) edits.restingHr = restingHr;
  if (thresholdHr !== undefined && thresholdHr !== zones.current.thresholdHr) edits.thresholdHr = thresholdHr;
  if (pace !== undefined && pace !== zones.current.thresholdPaceSecondsPerKm) edits.thresholdPaceSecondsPerKm = pace;
  const basis = typeof args.hr_zone_basis === "string" ? ZONE_BASIS[args.hr_zone_basis] : undefined;
  if (basis !== undefined && basis !== zones.current.hrZoneType) edits.hrZoneType = basis;
  if (!Object.keys(edits).length) return failure("no_change", "These values match the watch already; nothing to change.");
  const next = { ...zones.current, ...edits };
  if (!(next.restingHr < next.thresholdHr && next.thresholdHr < next.maxHr)) {
    return failure("invalid_order", "Resting, threshold and max heart rate must increase in that order.");
  }
  const bpm = (value: number) => `${value} bpm`;
  const paceText = (value: number) => formatPaceValue(value, deps.unitSystem);
  const items: CoachReviewItem[] = [
    ...(edits.maxHr !== undefined ? [{ label: "Max heart rate", before: bpm(zones.current.maxHr), after: bpm(edits.maxHr) }] : []),
    ...(edits.thresholdHr !== undefined ? [{ label: "Threshold heart rate", before: bpm(zones.current.thresholdHr), after: bpm(edits.thresholdHr) }] : []),
    ...(edits.restingHr !== undefined ? [{ label: "Resting heart rate", before: bpm(zones.current.restingHr), after: bpm(edits.restingHr) }] : []),
    ...(edits.hrZoneType !== undefined
      ? [{ label: "Heart-rate zones", before: ZONE_BASIS_LABEL[zones.current.hrZoneType] ?? "Unknown", after: ZONE_BASIS_LABEL[edits.hrZoneType]! }]
      : []),
    ...(edits.thresholdPaceSecondsPerKm !== undefined
      ? [{ label: "Threshold pace", before: paceText(zones.current.thresholdPaceSecondsPerKm), after: paceText(edits.thresholdPaceSecondsPerKm) }]
      : [])
  ];
  const notes = [
    "Each zone set moves with its reference value and keeps its proportions.",
    zones.update.possible
      ? "The watch is connected; keep it nearby until the update finishes."
      : "The watch isn't connected right now. Connect it over Bluetooth before clicking Update watch."
  ];
  const preview = deps.stageReview({
    action: "updateZones",
    title: "Update watch zones",
    summary,
    items,
    notes,
    payload: { edits, expected: zones.current }
  });
  deps.onReview(preview);
  return awaiting(preview, "Update watch");
}
