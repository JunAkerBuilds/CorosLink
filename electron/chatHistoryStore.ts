import crypto from "node:crypto";
import {
  deleteChatSessionRow,
  getChatSessionRow,
  insertChatSessionRow,
  listChatSessionRows,
  updateChatSessionRow
} from "./database";
import type {
  ActivityHrTrendPreview,
  ActivityVisualHrSection,
  ActivityVisualLapPoint,
  ActivityVisualPreview,
  ChatProvider,
  ChatSessionSummary,
  FitnessTrendPreview,
  HrZoneEntry,
  HrZonePreview,
  PersistedChatEntry,
  PersistedChatMessageEntry,
  PersistedChatSource,
  PlanDraftPreview,
  PlanDraftPreviewEntry,
  TrainingHubActivitySeriesPoint,
  TrainingHubThresholdZone,
  TrainingHubTrackPoint,
  TrainingTrendPoint,
  WorkoutDeletePreview
} from "./types";
import { migrateActivityHrTrendPreview } from "./chatActivityTools";

export interface ChatSessionRow {
  id: string;
  provider: string;
  title: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionDatabase {
  listSessions(provider: ChatProvider): ChatSessionRow[];
  getSession(id: string): ChatSessionRow | undefined;
  insertSession(
    id: string,
    provider: ChatProvider,
    title: string,
    messagesJson: string,
    createdAt: string,
    updatedAt: string
  ): void;
  updateSession(
    id: string,
    title: string,
    messagesJson: string,
    updatedAt: string
  ): void;
  deleteSession(id: string): void;
}

function createSqliteSessionDatabase(): ChatSessionDatabase {
  return {
    listSessions: (provider) => listChatSessionRows(provider),
    getSession: (id) => getChatSessionRow(id),
    insertSession: (id, provider, title, messagesJson, createdAt, updatedAt) =>
      insertChatSessionRow(
        id,
        provider,
        title,
        messagesJson,
        createdAt,
        updatedAt
      ),
    updateSession: (id, title, messagesJson, updatedAt) =>
      updateChatSessionRow(id, title, messagesJson, updatedAt),
    deleteSession: (id) => deleteChatSessionRow(id)
  };
}

const defaultDatabase = createSqliteSessionDatabase();

const DEFAULT_SESSION_TITLE = "New chat";
const SESSION_TITLE_MAX = 48;

function normalizeProvider(value: unknown): ChatProvider {
  return value === "local" ? "local" : "chatgpt";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown): PersistedChatSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.snapshotIncluded !== "boolean" ||
    typeof value.mcpEnabled !== "boolean" ||
    typeof value.mcpUsed !== "boolean" ||
    !Array.isArray(value.mcpTools) ||
    !value.mcpTools.every((entry) => typeof entry === "string")
  ) {
    return undefined;
  }

  const source: PersistedChatSource = {
    snapshotIncluded: value.snapshotIncluded,
    mcpEnabled: value.mcpEnabled,
    mcpUsed: value.mcpUsed,
    mcpTools: value.mcpTools
  };
  if (typeof value.mcpError === "string" && value.mcpError.trim()) {
    source.mcpError = value.mcpError;
  }
  return source;
}

function parsePlanDraftEntry(value: unknown): PlanDraftPreviewEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    typeof value.saveToLibrary !== "boolean" ||
    typeof value.workoutType !== "string"
  ) {
    return null;
  }

  return {
    key: value.key,
    name: value.name,
    scheduleDate:
      typeof value.scheduleDate === "string" ? value.scheduleDate : undefined,
    volume: typeof value.volume === "string" ? value.volume : undefined,
    saveToLibrary: value.saveToLibrary,
    workoutType: value.workoutType,
    stepsSummary:
      typeof value.stepsSummary === "string" ? value.stepsSummary : undefined
  };
}

function parsePlanDraft(value: unknown): PlanDraftPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.draftId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.summary !== "string" ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.conflicts) ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }

  const entries = value.entries
    .map((entry) => parsePlanDraftEntry(entry))
    .filter((entry): entry is PlanDraftPreviewEntry => entry !== null);
  if (entries.length !== value.entries.length) {
    return null;
  }

  if (
    !value.conflicts.every((entry) => typeof entry === "string") ||
    !value.warnings.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return {
    draftId: value.draftId,
    name: value.name,
    summary: value.summary,
    entries,
    conflicts: value.conflicts,
    warnings: value.warnings,
    uploadedAt:
      typeof value.uploadedAt === "number" ? value.uploadedAt : undefined,
    uploadResult:
      isRecord(value.uploadResult) &&
      typeof value.uploadResult.workoutsScheduled === "number" &&
      typeof value.uploadResult.workoutsCreated === "number"
        ? {
            workoutsScheduled: value.uploadResult.workoutsScheduled,
            workoutsCreated: value.uploadResult.workoutsCreated
          }
        : undefined
  };
}

function parseWorkoutDeletePreview(value: unknown): WorkoutDeletePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.requestId !== "string" ||
    (value.target !== "scheduled" &&
      value.target !== "library" &&
      value.target !== "both") ||
    typeof value.summary !== "string"
  ) {
    return null;
  }

  return {
    requestId: value.requestId,
    target: value.target,
    workoutName:
      typeof value.workoutName === "string" ? value.workoutName : undefined,
    scheduleDate:
      typeof value.scheduleDate === "string" ? value.scheduleDate : undefined,
    programId: typeof value.programId === "string" ? value.programId : undefined,
    summary: value.summary
  };
}

function parseSeriesPoint(value: unknown): TrainingHubActivitySeriesPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const point: TrainingHubActivitySeriesPoint = {};
  if (typeof value.distance === "number") {
    point.distance = value.distance;
  }
  if (typeof value.hr === "number") {
    point.hr = value.hr;
  }
  if (typeof value.pace === "number") {
    point.pace = value.pace;
  }
  if (typeof value.power === "number") {
    point.power = value.power;
  }

  return Object.keys(point).length > 0 ? point : null;
}

function parseTrackPoint(value: unknown): TrainingHubTrackPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const point: TrainingHubTrackPoint = {};
  if (typeof value.lat === "number") point.lat = value.lat;
  if (typeof value.lon === "number") point.lon = value.lon;
  if (typeof value.elevation === "number") point.elevation = value.elevation;
  if (typeof value.distance === "number") point.distance = value.distance;
  return Object.keys(point).length > 0 ? point : null;
}

function parseVisualLapPoint(value: unknown): ActivityVisualLapPoint | null {
  if (!isRecord(value) || typeof value.index !== "number") {
    return null;
  }

  return {
    index: value.index,
    avgHr: typeof value.avgHr === "number" ? value.avgHr : undefined,
    maxHr: typeof value.maxHr === "number" ? value.maxHr : undefined,
    distance: typeof value.distance === "number" ? value.distance : undefined,
    duration: typeof value.duration === "number" ? value.duration : undefined,
    pace: typeof value.pace === "number" ? value.pace : undefined
  };
}

function parseHrSection(value: unknown): ActivityVisualHrSection | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.chartKind !== "series" && value.chartKind !== "laps") {
    return null;
  }

  let series: TrainingHubActivitySeriesPoint[] | undefined;
  if (Array.isArray(value.series)) {
    const parsed = value.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (parsed.length !== value.series.length) {
      return null;
    }
    series = parsed.length > 0 ? parsed : undefined;
  }

  let laps: ActivityVisualLapPoint[] | undefined;
  if (Array.isArray(value.laps)) {
    const parsed = value.laps
      .map((lap) => parseVisualLapPoint(lap))
      .filter((lap): lap is ActivityVisualLapPoint => lap !== null);
    if (parsed.length !== value.laps.length) {
      return null;
    }
    laps = parsed.length > 0 ? parsed : undefined;
  }

  return {
    chartKind: value.chartKind,
    series,
    laps
  };
}

function parseActivityVisualPreview(value: unknown): ActivityVisualPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.previewId !== "string" || typeof value.activityId !== "string") {
    return null;
  }

  if (!isRecord(value.sections)) {
    return null;
  }

  const sections: ActivityVisualPreview["sections"] = {};
  if (value.sections.hr !== undefined) {
    const hr = parseHrSection(value.sections.hr);
    if (!hr) {
      return null;
    }
    sections.hr = hr;
  }

  if (value.sections.pace !== undefined) {
    if (!isRecord(value.sections.pace) || !Array.isArray(value.sections.pace.series)) {
      return null;
    }
    const series = value.sections.pace.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (series.length !== value.sections.pace.series.length) {
      return null;
    }
    sections.pace = { series };
  }

  if (value.sections.power !== undefined) {
    if (!isRecord(value.sections.power) || !Array.isArray(value.sections.power.series)) {
      return null;
    }
    const series = value.sections.power.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (series.length !== value.sections.power.series.length) {
      return null;
    }
    sections.power = { series };
  }

  if (value.sections.elevation !== undefined) {
    if (
      !isRecord(value.sections.elevation) ||
      !Array.isArray(value.sections.elevation.points)
    ) {
      return null;
    }
    const points = value.sections.elevation.points
      .map((point) => parseTrackPoint(point))
      .filter((point): point is TrainingHubTrackPoint => point !== null);
    if (points.length !== value.sections.elevation.points.length) {
      return null;
    }
    sections.elevation = { points };
  }

  if (Array.isArray(value.sections.laps)) {
    const laps = value.sections.laps
      .map((lap) => parseVisualLapPoint(lap))
      .filter((lap): lap is ActivityVisualLapPoint => lap !== null);
    if (laps.length !== value.sections.laps.length) {
      return null;
    }
    sections.laps = laps;
  }

  return {
    previewId: value.previewId,
    activityId: value.activityId,
    name: typeof value.name === "string" ? value.name : undefined,
    startTime: typeof value.startTime === "string" ? value.startTime : undefined,
    avgHr: typeof value.avgHr === "number" ? value.avgHr : undefined,
    maxHr: typeof value.maxHr === "number" ? value.maxHr : undefined,
    sections
  };
}

function parseHrTrendLapPoint(value: unknown): ActivityVisualLapPoint | null {
  return parseVisualLapPoint(value);
}

function parseHrTrendPreview(value: unknown): ActivityHrTrendPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.previewId !== "string" ||
    typeof value.activityId !== "string" ||
    (value.chartKind !== "series" && value.chartKind !== "laps")
  ) {
    return null;
  }

  let series: TrainingHubActivitySeriesPoint[] | undefined;
  if (Array.isArray(value.series)) {
    const parsed = value.series
      .map((point) => parseSeriesPoint(point))
      .filter((point): point is TrainingHubActivitySeriesPoint => point !== null);
    if (parsed.length !== value.series.length) {
      return null;
    }
    series = parsed.length > 0 ? parsed : undefined;
  }

  let laps: ActivityVisualLapPoint[] | undefined;
  if (Array.isArray(value.laps)) {
    const parsed = value.laps
      .map((lap) => parseHrTrendLapPoint(lap))
      .filter((lap): lap is ActivityVisualLapPoint => lap !== null);
    if (parsed.length !== value.laps.length) {
      return null;
    }
    laps = parsed.length > 0 ? parsed : undefined;
  }

  return {
    previewId: value.previewId,
    activityId: value.activityId,
    name: typeof value.name === "string" ? value.name : undefined,
    startTime: typeof value.startTime === "string" ? value.startTime : undefined,
    avgHr: typeof value.avgHr === "number" ? value.avgHr : undefined,
    maxHr: typeof value.maxHr === "number" ? value.maxHr : undefined,
    chartKind: value.chartKind,
    series,
    laps
  };
}

function parseTrendPoint(value: unknown): TrainingTrendPoint | null {
  if (!isRecord(value) || typeof value.date !== "string" || typeof value.label !== "string") {
    return null;
  }

  return {
    date: value.date,
    label: value.label,
    trainingLoad:
      typeof value.trainingLoad === "number" ? value.trainingLoad : undefined,
    avgSleepHrv:
      typeof value.avgSleepHrv === "number" ? value.avgSleepHrv : undefined,
    sleepHrvBase:
      typeof value.sleepHrvBase === "number" ? value.sleepHrvBase : undefined,
    rhr: typeof value.rhr === "number" ? value.rhr : undefined
  };
}

function parseFitnessTrendPreview(value: unknown): FitnessTrendPreview | null {
  if (!isRecord(value) || typeof value.previewId !== "string") {
    return null;
  }
  if (!Array.isArray(value.trendPoints)) {
    return null;
  }

  const trendPoints = value.trendPoints
    .map((point) => parseTrendPoint(point))
    .filter((point): point is TrainingTrendPoint => point !== null);
  if (trendPoints.length !== value.trendPoints.length) {
    return null;
  }

  return { previewId: value.previewId, trendPoints };
}

function parseThresholdZone(value: unknown): TrainingHubThresholdZone | null {
  if (!isRecord(value) || typeof value.index !== "number") {
    return null;
  }

  return {
    index: value.index,
    hr: typeof value.hr === "number" ? value.hr : undefined,
    pace: typeof value.pace === "number" ? value.pace : undefined,
    ratio: typeof value.ratio === "number" ? value.ratio : undefined
  };
}

function parseHrZoneEntry(value: unknown): HrZoneEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.index !== "number" ||
    typeof value.label !== "string" ||
    typeof value.percent !== "number" ||
    typeof value.value !== "number"
  ) {
    return null;
  }

  return {
    index: value.index,
    label: value.label,
    percent: value.percent,
    value: value.value
  };
}

function parseHrZonePreview(value: unknown): HrZonePreview | null {
  if (!isRecord(value) || typeof value.previewId !== "string") {
    return null;
  }
  if (
    value.metric !== "time" &&
    value.metric !== "distance" &&
    value.metric !== "trainingLoad"
  ) {
    return null;
  }
  if (!Array.isArray(value.zones) || !Array.isArray(value.lthrZones)) {
    return null;
  }

  const zones = value.zones
    .map((zone) => parseHrZoneEntry(zone))
    .filter((zone): zone is HrZoneEntry => zone !== null);
  const lthrZones = value.lthrZones
    .map((zone) => parseThresholdZone(zone))
    .filter((zone): zone is TrainingHubThresholdZone => zone !== null);
  if (zones.length !== value.zones.length || lthrZones.length !== value.lthrZones.length) {
    return null;
  }

  return {
    previewId: value.previewId,
    metric: value.metric,
    zones,
    lthrZones
  };
}

function parseMessageEntry(value: unknown): PersistedChatMessageEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind !== "message") {
    const role =
      value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
    if (!role || typeof value.content !== "string") {
      return null;
    }

    const source = parseSource(value.source);
    return source
      ? { kind: "message", role, content: value.content, source }
      : { kind: "message", role, content: value.content };
  }

  const role =
    value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  if (!role || typeof value.content !== "string") {
    return null;
  }

  const source = parseSource(value.source);
  return source
    ? { kind: "message", role, content: value.content, source }
    : { kind: "message", role, content: value.content };
}

function parseEntry(value: unknown): PersistedChatEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "planDraft") {
    const draft = parsePlanDraft(value.draft);
    return draft ? { kind: "planDraft", draft } : null;
  }

  if (value.kind === "workoutDelete") {
    const preview = parseWorkoutDeletePreview(value.preview);
    return preview ? { kind: "workoutDelete", preview } : null;
  }

  if (value.kind === "activityVisual") {
    const preview = parseActivityVisualPreview(value.preview);
    return preview ? { kind: "activityVisual", preview } : null;
  }

  if (value.kind === "activityHrTrend") {
    const legacy = parseHrTrendPreview(value.preview);
    return legacy
      ? { kind: "activityVisual", preview: migrateActivityHrTrendPreview(legacy) }
      : null;
  }

  if (value.kind === "fitnessTrend") {
    const preview = parseFitnessTrendPreview(value.preview);
    return preview ? { kind: "fitnessTrend", preview } : null;
  }

  if (value.kind === "hrZoneSummary") {
    const preview = parseHrZonePreview(value.preview);
    return preview ? { kind: "hrZoneSummary", preview } : null;
  }

  return parseMessageEntry(value);
}

export function parseChatTranscriptJson(raw: string): PersistedChatEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => parseEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

function normalizeEntries(entries: PersistedChatEntry[]): PersistedChatEntry[] {
  return entries
    .map((entry) => parseEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

function truncateTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return DEFAULT_SESSION_TITLE;
  }
  return trimmed.length > SESSION_TITLE_MAX
    ? `${trimmed.slice(0, SESSION_TITLE_MAX)}…`
    : trimmed;
}

export function deriveSessionTitleFromEntries(
  entries: PersistedChatEntry[]
): string {
  for (const entry of entries) {
    if (entry.kind === "message" && entry.role === "user" && entry.content.trim()) {
      return truncateTitle(entry.content);
    }
  }
  return DEFAULT_SESSION_TITLE;
}

function derivePreviewFromEntries(entries: PersistedChatEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "message" && entry.content.trim()) {
      const preview = entry.content.trim().replace(/\s+/g, " ");
      return preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
    }
    if (entry.kind === "planDraft") {
      return entry.draft.summary || entry.draft.name;
    }
    if (entry.kind === "workoutDelete") {
      return entry.preview.summary;
    }
    if (entry.kind === "activityVisual") {
      const label = entry.preview.name ?? "Activity";
      return `${label} activity visuals`;
    }
    if (entry.kind === "activityHrTrend") {
      const label = entry.preview.name ?? "Activity";
      return `${label} heart rate trend`;
    }
    if (entry.kind === "fitnessTrend") {
      return "Fitness trends";
    }
    if (entry.kind === "hrZoneSummary") {
      return "Heart rate zone summary";
    }
  }
  return "";
}

function countMessages(entries: PersistedChatEntry[]): number {
  return entries.filter((entry) => entry.kind === "message").length;
}

function toSessionSummary(row: ChatSessionRow): ChatSessionSummary {
  const entries = parseChatTranscriptJson(row.messages_json);
  return {
    id: row.id,
    provider: normalizeProvider(row.provider),
    title: row.title,
    preview: derivePreviewFromEntries(entries),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    messageCount: countMessages(entries)
  };
}

export function listChatSessions(
  provider: ChatProvider,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary[] {
  return database
    .listSessions(normalizeProvider(provider))
    .map((row) => toSessionSummary(row));
}

export function getChatSession(
  id: string,
  database: ChatSessionDatabase = defaultDatabase
): PersistedChatEntry[] {
  const row = database.getSession(id);
  if (!row) {
    return [];
  }
  return parseChatTranscriptJson(row.messages_json);
}

export function createChatSession(
  provider: ChatProvider,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary {
  const normalizedProvider = normalizeProvider(provider);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  database.insertSession(
    id,
    normalizedProvider,
    DEFAULT_SESSION_TITLE,
    "[]",
    now,
    now
  );
  const row = database.getSession(id);
  if (!row) {
    throw new Error("Failed to create chat session.");
  }
  return toSessionSummary(row);
}

export function saveChatSession(
  id: string,
  entries: PersistedChatEntry[],
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary | null {
  const row = database.getSession(id);
  if (!row) {
    return null;
  }

  const normalizedEntries = normalizeEntries(entries);
  const title =
    row.title === DEFAULT_SESSION_TITLE
      ? deriveSessionTitleFromEntries(normalizedEntries)
      : row.title;
  const updatedAt = new Date().toISOString();
  database.updateSession(
    id,
    title,
    JSON.stringify(normalizedEntries),
    updatedAt
  );
  const nextRow = database.getSession(id);
  return nextRow ? toSessionSummary(nextRow) : null;
}

export function deleteChatSession(
  id: string,
  database: ChatSessionDatabase = defaultDatabase
): void {
  database.deleteSession(id);
}

/** @deprecated Test helper for legacy transcript migration shape. */
export function migrateLegacyTranscriptRow(
  provider: ChatProvider,
  messagesJson: string,
  updatedAt: string,
  database: ChatSessionDatabase = defaultDatabase
): ChatSessionSummary {
  const entries = parseChatTranscriptJson(messagesJson);
  const id = crypto.randomUUID();
  const title = deriveSessionTitleFromEntries(entries);
  database.insertSession(
    id,
    normalizeProvider(provider),
    title,
    JSON.stringify(entries),
    updatedAt,
    updatedAt
  );
  const row = database.getSession(id);
  if (!row) {
    throw new Error("Failed to migrate legacy transcript.");
  }
  return toSessionSummary(row);
}
