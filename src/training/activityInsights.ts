/**
 * Per-activity training label and running-efficiency curve, worked out once
 * from a detail payload and kept in this browser's storage, so the activity
 * list can label a session and the efficiency widget can compare runs without
 * fetching every detail again.
 *
 * The cache is a convenience: a missing or cleared entry is computed again
 * the next time the detail is loaded. Storage failures are ignored.
 */

import { useSyncExternalStore } from "react";
import type { TrainingHubActivity, TrainingHubActivityDetail } from "../../electron/types";
import { parseActivityStreams, type StreamHrZoneModel } from "./activityStreams";
import { activityTimestamp } from "./activityCollection";
import { runEfficiencyCurve, sportHasRunEfficiency, EFFICIENCY_CURVE_VERSION, type CachedEfficiencyRun, type EfficiencyCurve } from "./runEfficiency";
import { summarizeSessionIntensity, sportHasTrainingLabel, INTENSITY_SUMMARY_VERSION, type SessionIntensity } from "./sessionIntensity";
import { isCyclingSportType, isSwimSportType } from "./sportTypes";

const STORAGE_KEY = "coroslink.activityInsights.v1";
/** Newest entries kept; a run older than the efficiency window is rarely asked for again. */
const MAX_ENTRIES = 600;

export interface ActivityInsight {
  activityId: string;
  sportType: number;
  /** Unix seconds. */
  startTime: number;
  /** Moving seconds. */
  seconds: number;
  intensity?: SessionIntensity;
  curve?: EfficiencyCurve;
}

interface InsightStore {
  entries: Record<string, ActivityInsight>;
  /** The heart-rate model the account's sessions were last scored on, for ones that name none. */
  model?: StreamHrZoneModel;
  /** The account's maximum and resting heart rate as Training Hub last read them, for the efficiency figure. */
  profile?: { maxHr: number; restingHr: number };
}

function readStore(): InsightStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as InsightStore | null;
    if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") return parsed;
  } catch {
    // Unreadable or blocked storage: start empty.
  }
  return { entries: {} };
}

let store: InsightStore | null = null;
const listeners = new Set<() => void>();

function current(): InsightStore {
  store ??= readStore();
  return store;
}

function commit(next: InsightStore): void {
  const ids = Object.keys(next.entries);
  if (ids.length > MAX_ENTRIES) {
    const keep = ids
      .sort((left, right) => next.entries[right]!.startTime - next.entries[left]!.startTime)
      .slice(0, MAX_ENTRIES);
    next = { ...next, entries: Object.fromEntries(keep.map((id) => [id, next.entries[id]!])) };
  }
  store = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Full or blocked storage: keep the in-memory copy for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isCurrent(entry: ActivityInsight | undefined): boolean {
  if (!entry) return false;
  const labelled = sportHasTrainingLabel(entry.sportType);
  const efficiency = sportHasRunEfficiency(entry.sportType);
  return (
    (!labelled || entry.intensity?.version === INTENSITY_SUMMARY_VERSION) &&
    (!efficiency || entry.curve?.version === EFFICIENCY_CURVE_VERSION)
  );
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** COROS's VO2max as of the run, from the detail summary. */
function detailVo2max(raw: Record<string, unknown> | undefined): number | undefined {
  const summary = raw?.summary;
  if (!summary || typeof summary !== "object") return undefined;
  const record = summary as Record<string, unknown>;
  return positive(record.currentVo2Max) ?? positive(record.hrmVo2Max);
}

/** Details already read, so a re-render does not parse the samples again. */
const derived = new WeakMap<object, ActivityInsight | null>();

/** The label and efficiency inputs of a loaded detail, or nothing for a sport that has neither. */
export function deriveActivityInsight(
  detail: TrainingHubActivityDetail,
  listActivity?: Pick<TrainingHubActivity, "activityId" | "sportType" | "startTime"> | null
): ActivityInsight | null {
  const cached = derived.get(detail);
  if (cached !== undefined) return cached;
  const sportType = detail.sportType ?? listActivity?.sportType;
  const activityId = detail.activityId ?? listActivity?.activityId;
  let insight: ActivityInsight | null = null;
  if (activityId && sportType !== undefined && (sportHasTrainingLabel(sportType) || sportHasRunEfficiency(sportType))) {
    const streams = parseActivityStreams(detail.raw, {
      cycling: isCyclingSportType(sportType),
      swim: isSwimSportType(sportType)
    });
    if (streams) {
      const intensity = summarizeSessionIntensity(streams, sportType);
      const curve = sportHasRunEfficiency(sportType) ? runEfficiencyCurve(streams, detailVo2max(detail.raw)) : undefined;
      insight = {
        activityId,
        sportType,
        startTime: Math.round(activityTimestamp(detail.startTime ?? listActivity?.startTime) / 1000),
        seconds: Math.round(streams.length > 0 ? streams.t[streams.length - 1]! : 0),
        ...(intensity ? { intensity } : {}),
        ...(curve ? { curve } : {})
      };
    }
  }
  derived.set(detail, insight);
  return insight;
}

/** Keep a loaded detail's insight for the list and the efficiency widget. Sample activities are never kept. */
export function rememberActivityInsight(
  detail: TrainingHubActivityDetail,
  listActivity?: Pick<TrainingHubActivity, "activityId" | "sportType" | "startTime"> | null
): ActivityInsight | null {
  const insight = deriveActivityInsight(detail, listActivity);
  if (!insight || insight.activityId.startsWith("sample-") || insight.startTime <= 0) return insight;
  const state = current();
  const previous = state.entries[insight.activityId];
  const model = insight.intensity?.model ?? state.model;
  if (previous && isCurrent(previous) && previous.seconds === insight.seconds && model === state.model) return insight;
  commit({ ...state, ...(model ? { model } : {}), entries: { ...state.entries, [insight.activityId]: insight } });
  return insight;
}

export function getActivityInsight(activityId: string): ActivityInsight | undefined {
  const entry = current().entries[activityId];
  return isCurrent(entry) ? entry : undefined;
}

/** The heart-rate model the account's sessions were last scored on. */
export function lastKnownZoneModel(): StreamHrZoneModel | undefined {
  return current().model;
}

/** Keep the account's heart-rate profile, so a run opened from the calendar reads on it too. */
export function rememberEfficiencyProfile(maxHr: number | undefined, restingHr: number | undefined): void {
  const max = positive(maxHr);
  const rest = positive(restingHr);
  if (max === undefined || rest === undefined) return;
  const state = current();
  if (state.profile?.maxHr === max && state.profile.restingHr === rest) return;
  commit({ ...state, profile: { maxHr: max, restingHr: rest } });
}

export function lastKnownEfficiencyProfile(): { maxHr: number; restingHr: number } | undefined {
  return current().profile;
}

/** Re-renders when an insight is stored; returns the store's version counter. */
export function useActivityInsights(): InsightStore {
  return useSyncExternalStore(subscribe, current, current);
}

/** Road and track runs in `[fromTime, now]` whose curve is not cached yet, newest first. */
export function runsMissingEfficiency(activities: readonly TrainingHubActivity[], fromTime: number): TrainingHubActivity[] {
  const state = current();
  return activities
    .filter((activity) => sportHasRunEfficiency(activity.sportType))
    .filter((activity) => activityTimestamp(activity.startTime) / 1000 >= fromTime)
    .filter((activity) => !activity.activityId.startsWith("sample-"))
    .filter((activity) => !isCurrent(state.entries[activity.activityId]))
    .sort((left, right) => activityTimestamp(right.startTime) - activityTimestamp(left.startTime));
}

/** Every cached road or track run with a curve, oldest first. */
export function cachedEfficiencyRuns(state: InsightStore = current()): CachedEfficiencyRun[] {
  return Object.values(state.entries)
    .filter((entry) => entry.curve?.version === EFFICIENCY_CURVE_VERSION && sportHasRunEfficiency(entry.sportType))
    .map((entry) => ({ activityId: entry.activityId, startTime: entry.startTime, seconds: entry.seconds, curve: entry.curve! }))
    .sort((left, right) => left.startTime - right.startTime);
}

type DetailLoader = (activity: TrainingHubActivity) => Promise<TrainingHubActivityDetail>;

/** Training Hub's activity list and detail loader, while it is open: what a run page fills its six weeks from. */
let efficiencySource: { activities: readonly TrainingHubActivity[]; loadDetail: DetailLoader } | null = null;

export function setEfficiencySource(source: { activities: readonly TrainingHubActivity[]; loadDetail: DetailLoader } | null): void {
  efficiencySource = source;
}

/** At most this many details read for one run page's six weeks. */
const WINDOW_FILL_LIMIT = 40;

/**
 * Read the road and track runs in the six weeks before a run that are not
 * cached yet, so its page can compare it with them. Nothing happens outside
 * Training Hub, where there is no activity list to read from.
 */
export function fillEfficiencyWindow(startTimeSeconds: number): void {
  if (!efficiencySource) return;
  const missing = runsMissingEfficiency(efficiencySource.activities, startTimeSeconds - 42 * 86_400)
    .filter((activity) => activityTimestamp(activity.startTime) / 1000 < startTimeSeconds)
    .slice(0, WINDOW_FILL_LIMIT);
  if (missing.length > 0) void fillEfficiencyHistory(missing, efficiencySource.loadDetail);
}

/** One sweep at a time across the app, so two widgets do not fetch the same runs twice. */
let sweep: Promise<void> | null = null;
const SWEEP_DELAY_MS = 250;

/**
 * Fetch and keep the curves of runs that are missing one, newest first, a few
 * hundred milliseconds apart. A run whose detail fails is skipped this time.
 */
export function fillEfficiencyHistory(
  missing: readonly TrainingHubActivity[],
  loadDetail: (activity: TrainingHubActivity) => Promise<TrainingHubActivityDetail>,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean
): Promise<void> {
  if (sweep) return sweep;
  sweep = (async () => {
    let done = 0;
    for (const activity of missing) {
      if (shouldStop?.()) break;
      try {
        rememberActivityInsight(await loadDetail(activity), activity);
      } catch {
        // Try again on a later sweep.
      }
      done += 1;
      onProgress?.(done, missing.length);
      await new Promise((resolve) => setTimeout(resolve, SWEEP_DELAY_MS));
    }
  })().finally(() => {
    sweep = null;
  });
  return sweep;
}
