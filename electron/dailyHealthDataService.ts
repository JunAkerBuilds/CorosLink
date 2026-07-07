import type { BrowserWindow } from "electron";
import {
  callCorosMcpTool,
  connectCorosMcp,
  ensureCorosMcpConnected,
  getCorosMcpStatus,
  getCorosMcpTools,
  listCorosMcpTools
} from "./corosMcpService";
import { recentTrainingHubDateList } from "./trainingTrendUtils";
import type {
  CorosMcpTool,
  TrainingHubDailyHealthRecord,
  TrainingHubDailyHealthSummary
} from "./types";

const PREFERRED_DAILY_HEALTH_TOOL = "queryDailyHealthData";

const DATE_KEYS = [
  "happenDay",
  "happen_day",
  "date",
  "day",
  "summaryDate",
  "healthDate"
];

const STEP_KEYS = [
  "steps",
  "step",
  "stepCount",
  "stepsCount",
  "totalSteps",
  "dailySteps"
];

const CALORIE_KEYS = [
  "calories",
  "calorie",
  "kcal",
  "caloriesKcal",
  "calorieKcal",
  "totalCalories",
  "dailyCalories",
  "caloriesBurned",
  "burnedCalories"
];

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!numeric) {
      return undefined;
    }

    const parsed = Number(numeric[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function happenDayToIso(happenDay: string): string {
  return `${happenDay.slice(0, 4)}-${happenDay.slice(4, 6)}-${happenDay.slice(6, 8)}`;
}

function isoToHappenDay(value: string): string | undefined {
  const match = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match) {
    return undefined;
  }

  return `${match[1]}${match[2]}${match[3]}`;
}

function normalizeHappenDay(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const raw = String(value).trim();
  if (!raw) {
    return undefined;
  }

  if (/^\d{8}$/.test(raw)) {
    return raw;
  }

  const iso = isoToHappenDay(raw);
  if (iso) {
    return iso;
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  return undefined;
}

function getLocalTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through
    }
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function unwrapProseText(value: string): string {
  let current = value.trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!current) {
      return current;
    }

    try {
      const parsed = JSON.parse(current) as unknown;
      if (typeof parsed !== "string") {
        break;
      }
      current = parsed.trim();
    } catch {
      break;
    }
  }

  if (!current.includes("\n") && current.includes("\\n")) {
    current = current.replace(/\\n/g, "\n");
  }

  return current;
}

function collectProseTexts(payload: unknown, found: string[] = []): string[] {
  if (typeof payload === "string") {
    const text = unwrapProseText(payload);
    if (/\b(?:steps?|calories|kcal)\b/i.test(text)) {
      found.push(text);
    }
    return found;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      collectProseTexts(entry, found);
    }
    return found;
  }

  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      collectProseTexts(value, found);
    }
  }

  return found;
}

function readNestedNumber(
  source: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const parsed = toOptionalNumber(source[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readHappenDay(
  source: Record<string, unknown>,
  fallbackDay?: string
): string | undefined {
  for (const key of DATE_KEYS) {
    const parsed = normalizeHappenDay(source[key]);
    if (parsed) {
      return parsed;
    }
  }

  return fallbackDay;
}

function mergeDailyHealthRecord(
  existing: TrainingHubDailyHealthRecord | undefined,
  incoming: TrainingHubDailyHealthRecord
): TrainingHubDailyHealthRecord {
  if (!existing) {
    return incoming;
  }

  return {
    happenDay: incoming.happenDay,
    steps: incoming.steps ?? existing.steps,
    calories: incoming.calories ?? existing.calories
  };
}

function addDailyHealthRecord(
  found: Map<string, TrainingHubDailyHealthRecord>,
  record: TrainingHubDailyHealthRecord
): void {
  found.set(record.happenDay, mergeDailyHealthRecord(found.get(record.happenDay), record));
}

function parseDailyHealthRecordObject(
  raw: Record<string, unknown>,
  fallbackDay?: string
): TrainingHubDailyHealthRecord | undefined {
  const happenDay = readHappenDay(raw, fallbackDay);
  if (!happenDay) {
    return undefined;
  }

  const steps = readNestedNumber(raw, STEP_KEYS);
  const calories = readNestedNumber(raw, CALORIE_KEYS);
  if (steps === undefined && calories === undefined) {
    return undefined;
  }

  return {
    happenDay,
    steps: steps !== undefined ? Math.round(steps) : undefined,
    calories: calories !== undefined ? Math.round(calories) : undefined
  };
}

function walkForDailyHealthRecords(
  value: unknown,
  found: Map<string, TrainingHubDailyHealthRecord>,
  fallbackDay?: string
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkForDailyHealthRecords(entry, found, fallbackDay);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const raw = value as Record<string, unknown>;
  const localFallback = readHappenDay(raw, fallbackDay);
  const record = parseDailyHealthRecordObject(raw, localFallback);
  if (record) {
    addDailyHealthRecord(found, record);
  }

  for (const child of Object.values(raw)) {
    walkForDailyHealthRecords(child, found, localFallback);
  }
}

function parseLabeledNumber(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = toOptionalNumber(match[1]);
    if (parsed !== undefined) {
      return Math.round(parsed);
    }
  }

  return undefined;
}

function parseProseDailyHealthSection(
  section: string,
  fallbackDay?: string
): TrainingHubDailyHealthRecord | undefined {
  const happenDay =
    normalizeHappenDay(section.match(/\b20\d{2}[-/]\d{2}[-/]\d{2}\b/)?.[0]) ??
    normalizeHappenDay(section.match(/\b20\d{6}\b/)?.[0]) ??
    fallbackDay;

  if (!happenDay) {
    return undefined;
  }

  const steps = parseLabeledNumber(section, [
    /\b(?:steps?|step count)\b\s*[:=-]\s*([\d,.]+)/i
  ]);
  const calories = parseLabeledNumber(section, [
    /\b(?:calories(?: burned)?|total calories|daily calories|calorie|kcal)\b\s*[:=-]\s*([\d,.]+)/i
  ]);

  if (steps === undefined && calories === undefined) {
    return undefined;
  }

  return {
    happenDay,
    steps,
    calories
  };
}

function parseProseDailyHealthRecords(
  text: string,
  fallbackDay?: string
): TrainingHubDailyHealthRecord[] {
  const normalized = unwrapProseText(text);
  if (!normalized) {
    return [];
  }

  const dateMatches = [
    ...normalized.matchAll(/\b(?:20\d{2}[-/]\d{2}[-/]\d{2}|20\d{6})\b/g)
  ];
  if (dateMatches.length === 0) {
    const single = parseProseDailyHealthSection(normalized, fallbackDay);
    return single ? [single] : [];
  }

  const records: TrainingHubDailyHealthRecord[] = [];
  for (let index = 0; index < dateMatches.length; index += 1) {
    const current = dateMatches[index];
    const next = dateMatches[index + 1];
    if (current.index === undefined) {
      continue;
    }

    const start = current.index;
    const end = next?.index ?? normalized.length;
    const happenDay = normalizeHappenDay(current[0]) ?? fallbackDay;
    const record = parseProseDailyHealthSection(
      normalized.slice(start, end),
      happenDay
    );
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function mergeDailyHealthRecords(
  records: TrainingHubDailyHealthRecord[]
): TrainingHubDailyHealthRecord[] {
  const merged = new Map<string, TrainingHubDailyHealthRecord>();

  for (const record of records) {
    addDailyHealthRecord(merged, record);
  }

  return [...merged.values()].sort((left, right) =>
    left.happenDay.localeCompare(right.happenDay)
  );
}

export function parseDailyHealthDataResponse(
  text: string,
  fallbackDay = recentTrainingHubDateList(1)[0]
): TrainingHubDailyHealthRecord[] {
  const jsonPayload = extractJsonPayload(text);
  const found = new Map<string, TrainingHubDailyHealthRecord>();
  walkForDailyHealthRecords(jsonPayload, found, fallbackDay);

  const proseRecords = [text, ...collectProseTexts(jsonPayload)]
    .flatMap((candidate) => parseProseDailyHealthRecords(candidate, fallbackDay));

  return mergeDailyHealthRecords([...found.values(), ...proseRecords]);
}

function dailyHealthRecordScore(record: TrainingHubDailyHealthRecord): number {
  const happenDayScore = /^\d{8}$/.test(record.happenDay)
    ? Number(record.happenDay) - 20_000_000
    : 0;
  const completeness =
    (record.steps !== undefined ? 1 : 0) + (record.calories !== undefined ? 1 : 0);

  return happenDayScore * 10 + completeness;
}

export function pickLatestDailyHealthRecord(
  records: TrainingHubDailyHealthRecord[]
): TrainingHubDailyHealthRecord | undefined {
  return [...records].sort(
    (left, right) => dailyHealthRecordScore(right) - dailyHealthRecordScore(left)
  )[0];
}

function dailyHealthResponseQuality(records: TrainingHubDailyHealthRecord[]): number {
  const latest = pickLatestDailyHealthRecord(records);
  if (!latest) {
    return 0;
  }

  return dailyHealthRecordScore(latest) * 100 + Math.min(records.length, 30);
}

function resolveDailyHealthTool(tools: CorosMcpTool[]): CorosMcpTool | undefined {
  const preferred = tools.find((tool) => tool.name === PREFERRED_DAILY_HEALTH_TOOL);
  if (preferred) {
    return preferred;
  }

  return tools.find(
    (tool) =>
      /daily/i.test(tool.name) &&
      /health/i.test(tool.name) &&
      !/heart.?rate|resting|recent.?hr/i.test(tool.name)
  );
}

function schemaPropertyNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    return [];
  }

  return Object.keys(properties as Record<string, unknown>);
}

function addExactDailyHealthDateArgs(
  candidates: Record<string, unknown>[],
  propertyNames: string[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const keyedArgs: Array<[string, unknown][]> = [];

  if (propertyNames.includes("date")) {
    keyedArgs.push([["date", iso]], [["date", happenDay]]);
  }
  if (propertyNames.includes("happenDay")) {
    keyedArgs.push([["happenDay", happenDay]]);
  }
  if (propertyNames.includes("happen_day")) {
    keyedArgs.push([["happen_day", happenDay]]);
  }
  if (propertyNames.includes("day")) {
    keyedArgs.push([["day", happenDay]], [["day", iso]]);
  }

  for (const entries of keyedArgs) {
    candidates.push(Object.fromEntries(entries));
  }
}

function addGenericExactDailyHealthDateArgs(
  candidates: Record<string, unknown>[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const timezone = getLocalTimeZone();

  candidates.push(
    ...(timezone
      ? [
          { startDate: happenDay, endDate: happenDay, days: 1, timezone },
          { startDate: iso, endDate: iso, days: 1, timezone }
        ]
      : []),
    { startDate: happenDay, endDate: happenDay, days: 1 },
    { startDate: iso, endDate: iso, days: 1 },
    { date: iso },
    { date: happenDay },
    { happenDay },
    { happen_day: happenDay },
    { day: happenDay },
    { day: iso }
  );
}

function addDailyHealthQueryArgs(
  candidates: Record<string, unknown>[],
  propertyNames: string[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const query =
    `Return COROS daily health data for ${iso} (${happenDay}). ` +
    "Include steps and total calories.";
  const keys = ["query", "question", "prompt", "input", "text"];

  for (const key of keys) {
    if (propertyNames.includes(key)) {
      candidates.push({ [key]: query });
    }
  }
}

function addGenericDailyHealthQueryArgs(
  candidates: Record<string, unknown>[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const query =
    `Return COROS daily health data for ${iso} (${happenDay}). ` +
    "Include steps and total calories.";

  candidates.push(
    { query },
    { question: query },
    { prompt: query },
    { input: query }
  );
}

function buildDailyHealthToolArgs(
  tool: CorosMcpTool,
  days: number
): Record<string, unknown>[] {
  const dateList = recentTrainingHubDateList(days);
  const startDay = dateList[dateList.length - 1];
  const endDay = dateList[0];
  const startIso = happenDayToIso(startDay);
  const endIso = happenDayToIso(endDay);
  const timezone = getLocalTimeZone();
  const propertyNames = schemaPropertyNames(tool.inputSchema);
  const candidates: Record<string, unknown>[] = [];

  addExactDailyHealthDateArgs(candidates, propertyNames, endDay);
  addGenericExactDailyHealthDateArgs(candidates, endDay);
  addDailyHealthQueryArgs(candidates, propertyNames, endDay);
  addGenericDailyHealthQueryArgs(candidates, endDay);

  const rangedArgs: Record<string, unknown> = {};
  if (propertyNames.includes("startDate")) {
    rangedArgs.startDate = startIso;
  }
  if (propertyNames.includes("endDate")) {
    rangedArgs.endDate = endIso;
  }
  if (propertyNames.includes("startDay")) {
    rangedArgs.startDay = startDay;
  }
  if (propertyNames.includes("endDay")) {
    rangedArgs.endDay = endDay;
  }
  if (propertyNames.includes("start_day")) {
    rangedArgs.start_day = startDay;
  }
  if (propertyNames.includes("end_day")) {
    rangedArgs.end_day = endDay;
  }
  if (propertyNames.includes("days")) {
    rangedArgs.days = days;
  }
  if (timezone && propertyNames.includes("timezone")) {
    rangedArgs.timezone = timezone;
  }
  if (Object.keys(rangedArgs).length > 0) {
    candidates.push(rangedArgs);
  }

  candidates.push(
    { startDate: startIso, endDate: endIso },
    { startDate: startDay, endDate: endDay },
    { startDay, endDay },
    { days },
    {}
  );

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function ensureMcpForDailyHealth(
  mainWindow?: BrowserWindow | null
): Promise<boolean> {
  if (await ensureCorosMcpConnected()) {
    return true;
  }

  const status = getCorosMcpStatus();
  if (!status.authorized) {
    await connectCorosMcp(mainWindow, true);
    return getCorosMcpStatus().connected;
  }

  await connectCorosMcp(mainWindow, true);
  return getCorosMcpStatus().connected;
}

async function fetchDailyHealthRecords(
  dailyHealthTool: CorosMcpTool,
  days: number
): Promise<TrainingHubDailyHealthRecord[]> {
  const fallbackDay = recentTrainingHubDateList(1)[0];
  const argCandidates = buildDailyHealthToolArgs(dailyHealthTool, days);
  let bestRecords: TrainingHubDailyHealthRecord[] = [];
  let bestScore = -1;
  const collectedRecords: TrainingHubDailyHealthRecord[] = [];

  for (const args of argCandidates) {
    try {
      const response = await callCorosMcpTool(dailyHealthTool.name, args);
      const records = parseDailyHealthDataResponse(response, fallbackDay);
      const score = dailyHealthResponseQuality(records);
      collectedRecords.push(...records);

      if (score > bestScore) {
        bestScore = score;
        bestRecords = records;
      }
    } catch (error) {
      console.warn(
        `[dailyHealthDataService] ${dailyHealthTool.name} failed for args ${JSON.stringify(args)}:`,
        error
      );
    }
  }

  const mergedRecords = mergeDailyHealthRecords(collectedRecords);
  return mergedRecords.length > 0 ? mergedRecords : bestRecords;
}

export async function getTrainingDailyHealthData(
  mainWindow?: BrowserWindow | null,
  days = 1
): Promise<TrainingHubDailyHealthSummary> {
  const connected = await ensureMcpForDailyHealth(mainWindow);
  if (!connected) {
    return {
      records: [],
      mcpConnected: false
    };
  }

  try {
    await listCorosMcpTools();
  } catch {
    // fall back to cached tool list
  }

  const dailyHealthTool = resolveDailyHealthTool(getCorosMcpTools());
  if (!dailyHealthTool) {
    return {
      records: [],
      mcpConnected: true
    };
  }

  try {
    const records = await fetchDailyHealthRecords(dailyHealthTool, days);

    return {
      latest: pickLatestDailyHealthRecord(records),
      records,
      mcpConnected: true
    };
  } catch (error) {
    console.warn("[dailyHealthDataService] Failed to fetch daily health data:", error);
    return {
      records: [],
      mcpConnected: true
    };
  }
}
