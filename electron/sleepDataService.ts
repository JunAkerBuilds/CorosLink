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
  TrainingHubSleepRecord,
  TrainingHubSleepSummary
} from "./types";

const PREFERRED_SLEEP_TOOL = "querySleepData";
const FALLBACK_SLEEP_TOOL = "get_sleep_data";

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function happenDayToIso(happenDay: string): string {
  return `${happenDay.slice(0, 4)}-${happenDay.slice(4, 6)}-${happenDay.slice(6, 8)}`;
}

function getLocalTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function isoToHappenDay(value: string): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
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

function parseClockMinutes(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function sleepWindowDurationMinutes(record: TrainingHubSleepRecord): number | undefined {
  const startMinutes = parseClockMinutes(record.sleepStart);
  const endMinutes = parseClockMinutes(record.sleepEnd);

  if (startMinutes === undefined || endMinutes === undefined) {
    return undefined;
  }

  let adjustedEnd = endMinutes;
  if (adjustedEnd <= startMinutes) {
    adjustedEnd += 24 * 60;
  }

  return adjustedEnd - startMinutes;
}

function isPlausibleMainSleep(record: TrainingHubSleepRecord): boolean {
  const totalMinutes = record.totalMinutes ?? 0;
  const windowMinutes = sleepWindowDurationMinutes(record);

  if (windowMinutes !== undefined && totalMinutes > 0) {
    // Reject records where the clock window is a short nap but duration says overnight sleep.
    if (windowMinutes <= 150 && totalMinutes >= 240) {
      return false;
    }
  }

  return true;
}

function parseClockHour(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
}

function parseDurationMinutes(value: unknown): number | undefined {
  const direct = toOptionalNumber(value);
  if (direct !== undefined) {
    return direct;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const raw = value.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  const hourMinuteMatch = raw.match(
    /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?$/i
  );
  if (hourMinuteMatch) {
    if (!hourMinuteMatch[1] && !hourMinuteMatch[2]) {
      return undefined;
    }

    const hours = hourMinuteMatch[1] ? Number(hourMinuteMatch[1]) : 0;
    const minutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours * 60 + minutes;
    }
  }

  const colonMatch = raw.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    const seconds = colonMatch[3] ? Number(colonMatch[3]) : 0;
    if ([hours, minutes, seconds].every(Number.isFinite)) {
      return Math.round(hours * 60 + minutes + seconds / 60);
    }
  }

  return undefined;
}

function readNestedNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    const parsed = toOptionalNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readNestedDuration(
  source: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    const parsed = parseDurationMinutes(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function readNestedString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readAwakeCountOverFiveMinutes(
  source: Record<string, unknown>
): number | undefined {
  return readNestedNumber(source, [
    "awakeCountOverFiveMinutes",
    "awakeCountOver5Minutes",
    "awakeCountGt5Minutes",
    "awakeCountGt5Min",
    "wakeCountOverFiveMinutes",
    "wakeCountOver5Minutes",
    "wakeupsOverFiveMinutes",
    "wakeupsOver5Minutes",
    "wakeUpsOverFiveMinutes",
    "wakeUpsOver5Minutes"
  ]);
}

function parseNapDurationText(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  if (/\b(?:none|no|zero)\b/i.test(value)) {
    return 0;
  }

  return parseDurationMinutes(value);
}

function percentToMinutes(
  percent: number | undefined,
  totalMinutes?: number
): number | undefined {
  if (percent === undefined || totalMinutes === undefined) {
    return undefined;
  }

  const normalized = percent <= 1 ? percent * 100 : percent;
  return Math.round((normalized / 100) * totalMinutes);
}

function normalizePercent(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return value <= 1 ? value * 100 : value;
}

function hasPositiveMinutes(value?: number): boolean {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function readPhasePercent(
  source: Record<string, unknown>,
  phaseKeys: string[],
  percentKeys: string[]
): number | undefined {
  const direct = readNestedNumber(source, [
    ...percentKeys,
    ...phaseKeys.map((key) => `${key}Percent`),
    ...phaseKeys.map((key) => `${key}Ratio`),
    ...phaseKeys.map((key) => `${key}Percentage`)
  ]);
  if (direct !== undefined) {
    return normalizePercent(direct);
  }

  const phases = source.phases;
  if (!phases || typeof phases !== "object") {
    return undefined;
  }

  const phaseRecord = phases as Record<string, unknown>;
  return normalizePercent(
    readNestedNumber(phaseRecord, [
      ...percentKeys,
      ...phaseKeys.map((key) => `${key}Percent`),
      ...phaseKeys.map((key) => `${key}Ratio`),
      ...phaseKeys.map((key) => `${key}Percentage`)
    ])
  );
}

function readPhaseMinutes(
  source: Record<string, unknown>,
  phaseKeys: string[],
  percentKeys: string[],
  totalMinutes?: number,
  percentDenominatorMinutes?: number
): number | undefined {
  const direct = readNestedDuration(source, phaseKeys);
  if (direct !== undefined) {
    return direct;
  }

  const percent = readNestedNumber(source, [
    ...percentKeys,
    ...phaseKeys.map((key) => `${key}Percent`),
    ...phaseKeys.map((key) => `${key}Ratio`),
    ...phaseKeys.map((key) => `${key}Percentage`)
  ]);

  const fromPercent = percentToMinutes(
    percent,
    percentDenominatorMinutes ?? totalMinutes
  );
  if (fromPercent !== undefined) {
    return fromPercent;
  }

  const phases = source.phases;
  if (!phases || typeof phases !== "object") {
    return undefined;
  }

  const phaseRecord = phases as Record<string, unknown>;
  const nestedMinutes = readNestedDuration(phaseRecord, phaseKeys);
  if (nestedMinutes !== undefined) {
    return nestedMinutes;
  }

  const nestedPercent = readNestedNumber(phaseRecord, [
    ...percentKeys,
    ...phaseKeys,
    ...phaseKeys.map((key) => `${key}Percent`),
    ...phaseKeys.map((key) => `${key}Ratio`)
  ]);

  return percentToMinutes(nestedPercent, percentDenominatorMinutes ?? totalMinutes);
}

function inferLightMinutes(record: TrainingHubSleepRecord): number | undefined {
  if (record.lightMinutes !== undefined) {
    return record.lightMinutes;
  }

  const denominator = record.windowMinutes ?? record.totalMinutes;
  const fromPercent = percentToMinutes(record.lightPercent, denominator);
  if (fromPercent !== undefined) {
    return fromPercent;
  }

  if (record.totalMinutes === undefined) {
    return undefined;
  }

  const accountedSleep = (record.deepMinutes ?? 0) + (record.remMinutes ?? 0);
  const sleepOnlyRemainder = record.totalMinutes - accountedSleep;
  if (sleepOnlyRemainder > 0 && record.windowMinutes !== undefined) {
    return sleepOnlyRemainder;
  }

  const accounted = accountedSleep + (record.awakeMinutes ?? 0);

  if (accounted <= 0 || accounted >= record.totalMinutes) {
    return undefined;
  }

  return record.totalMinutes - accounted;
}

function inferAwakePercent(record: TrainingHubSleepRecord): number | undefined {
  if (record.awakePercent !== undefined) {
    return record.awakePercent;
  }

  const denominator = record.windowMinutes ?? record.totalMinutes;
  if (
    record.awakeMinutes === undefined ||
    denominator === undefined ||
    denominator <= 0
  ) {
    return undefined;
  }

  return Math.round((record.awakeMinutes / denominator) * 1000) / 10;
}

function inferLightPercent(record: TrainingHubSleepRecord): number | undefined {
  if (record.lightPercent !== undefined) {
    return record.lightPercent;
  }

  const known = [
    record.deepPercent,
    record.remPercent,
    record.awakePercent
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));

  if (known.length < 3) {
    return undefined;
  }

  const remaining = 100 - known.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(remaining) || remaining < -1 || remaining > 100) {
    return undefined;
  }

  return Math.max(0, Math.round(remaining * 10) / 10);
}

function normalizeSleepRecordFields(
  record: TrainingHubSleepRecord
): TrainingHubSleepRecord {
  const withWindow = {
    ...record,
    windowMinutes: record.windowMinutes ?? sleepWindowDurationMinutes(record)
  };
  const withAwakePercent = {
    ...withWindow,
    awakePercent: inferAwakePercent(withWindow)
  };
  const withLightPercent = {
    ...withAwakePercent,
    lightPercent: inferLightPercent(withAwakePercent)
  };

  return {
    ...withLightPercent,
    lightMinutes: inferLightMinutes(withLightPercent)
  };
}

function sleepRecordPartialReason(record: TrainingHubSleepRecord): string | undefined {
  if (record.kind === "nap") {
    return undefined;
  }

  if (!isPlausibleMainSleep(record)) {
    return "Sleep window does not match the reported main sleep duration.";
  }

  if (record.score === undefined) {
    return "Sleep score is still syncing.";
  }

  if ((record.totalMinutes ?? 0) < 180) {
    return "Main sleep duration is still syncing.";
  }

  if (!isOvernightMainSleep(record)) {
    return "Overnight sleep window is still syncing.";
  }

  if (!hasPositiveMinutes(record.deepMinutes) || !hasPositiveMinutes(record.remMinutes)) {
    return "Sleep stages are still syncing.";
  }

  return undefined;
}

function inferSleepKind(
  raw: Record<string, unknown>,
  record: TrainingHubSleepRecord
): "main" | "nap" {
  const explicit = readNestedString(raw, ["sleepType", "type", "recordType", "sleepKind"]);
  if (explicit && /nap/i.test(explicit)) {
    return "nap";
  }
  if (raw.isNap === true || raw.nap === true) {
    return "nap";
  }

  const startHour = parseClockHour(record.sleepStart);
  const duration = record.totalMinutes ?? 0;

  if (
    startHour !== undefined &&
    startHour >= 10 &&
    startHour <= 18 &&
    duration > 0 &&
    duration <= 150
  ) {
    return "nap";
  }

  if (duration > 0 && duration <= 90 && record.score === undefined) {
    return "nap";
  }

  return "main";
}

function finalizeSleepRecord(
  raw: Record<string, unknown>,
  record: TrainingHubSleepRecord
): TrainingHubSleepRecord {
  const normalized = normalizeSleepRecordFields({
    ...record,
    kind: record.kind ?? inferSleepKind(raw, record)
  });
  const computedPartialReason = sleepRecordPartialReason(normalized);
  const partialReason =
    computedPartialReason ??
    (record.completeness === "partial" ? record.partialReason : undefined);

  return {
    ...normalized,
    completeness: partialReason ? "partial" : "complete",
    partialReason
  };
}

function looksLikeSleepRecord(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw).join(" ").toLowerCase();
  return /sleep|score|deep|rem|awake|nap|main.?sleep|duration|happen.?day|quality/.test(
    keys
  );
}

function readSleepWindow(raw: Record<string, unknown>): {
  sleepStart?: string;
  sleepEnd?: string;
} {
  const sleepWindow =
    raw.sleepWindow && typeof raw.sleepWindow === "object"
      ? (raw.sleepWindow as Record<string, unknown>)
      : undefined;

  return {
    sleepStart:
      readNestedString(raw, [
        "sleepStart",
        "sleepWindowStart",
        "startTime",
        "sleepStartTime",
        "beginTime",
        "fallAsleepTime",
        "fallAsleep",
        "sleepBeginTime"
      ]) ??
      (typeof sleepWindow?.start === "string" ? sleepWindow.start : undefined),
    sleepEnd:
      readNestedString(raw, [
        "sleepEnd",
        "sleepWindowEnd",
        "endTime",
        "sleepEndTime",
        "finishTime",
        "wakeUpTime",
        "wakeUp",
        "sleepFinishTime"
      ]) ?? (typeof sleepWindow?.end === "string" ? sleepWindow.end : undefined)
  };
}

function parseSleepRecord(
  raw: unknown,
  defaults: Partial<TrainingHubSleepRecord> = {}
): TrainingHubSleepRecord | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  if (!looksLikeSleepRecord(record)) {
    return undefined;
  }

  const happenDay = normalizeHappenDay(
    defaults.happenDay ??
      record.happenDay ??
      record.date ??
      record.day ??
      record.sleepDate ??
      record.statDay ??
      record.happen_day ??
      record.sleepDay
  );

  if (!happenDay) {
    return undefined;
  }

  const mainSleepMinutes = readNestedDuration(record, [
    "mainSleepMinutes",
    "mainSleepMinute",
    "mainSleepDurationMinutes",
    "mainSleepDuration",
    "mainSleepTime",
    "mainSleep",
    "totalSleepTime",
    "sSleepTime"
  ]);

  const totalMinutes =
    defaults.kind === "nap"
      ? readNestedDuration(record, [
          "napMinutes",
          "nap_minutes",
          "napDurationMinutes",
          "napDuration",
          "napTime",
          "totalMinutes",
          "durationMinutes"
        ])
      : mainSleepMinutes ??
        readNestedDuration(record, [
          "totalMinutes",
          "totalDurationMinutes",
          "total_duration_minutes",
          "sleepDurationMinutes",
          "durationMinutes",
          "sleepDuration",
          "sleepTime"
        ]) ??
        (() => {
          const seconds = readNestedNumber(record, [
            "totalDurationSeconds",
            "total_duration_seconds",
            "sleepDurationSeconds",
            "mainSleepSeconds"
          ]);
          return seconds !== undefined ? Math.round(seconds / 60) : undefined;
        })();

  const window = readSleepWindow(record);
  const windowMinutes = sleepWindowDurationMinutes({
    happenDay,
    sleepStart: defaults.sleepStart ?? window.sleepStart,
    sleepEnd: defaults.sleepEnd ?? window.sleepEnd
  });

  const deepPhaseKeys = [
    "deepMinutes",
    "deep_minutes",
    "deepSleepMinutes",
    "deepSleep",
    "deep",
    "deepTime"
  ];
  const deepPercentKeys = [
    "deepSleepPercent",
    "deepPercent",
    "deepRatio",
    "deepSleepRatio",
    "deepSleepPercentage"
  ];
  const lightPhaseKeys = [
    "lightMinutes",
    "light_minutes",
    "lightSleepMinutes",
    "lightSleep",
    "light",
    "lightTime"
  ];
  const lightPercentKeys = [
    "lightSleepPercent",
    "lightPercent",
    "lightRatio",
    "lightSleepRatio",
    "lightSleepPercentage"
  ];
  const remPhaseKeys = [
    "remMinutes",
    "rem_minutes",
    "remSleepMinutes",
    "remSleep",
    "rem",
    "remTime",
    "eyeTime"
  ];
  const remPercentKeys = [
    "remSleepPercent",
    "remPercent",
    "remRatio",
    "remSleepRatio",
    "remSleepPercentage"
  ];
  const awakePhaseKeys = [
    "awakeMinutes",
    "awake_minutes",
    "wakeMinutes",
    "awakeTime",
    "awake",
    "wakeTime"
  ];
  const awakePercentKeys = [
    "awakePercent",
    "awakeRatio",
    "awakeTimePercent",
    "awakeTimePercentage",
    "wakePercent",
    "wakeRatio",
    "wakeTimePercent"
  ];
  const percentDenominator = windowMinutes ?? totalMinutes;
  const deepPercent = readPhasePercent(record, deepPhaseKeys, deepPercentKeys);
  const lightPercent = readPhasePercent(record, lightPhaseKeys, lightPercentKeys);
  const remPercent = readPhasePercent(record, remPhaseKeys, remPercentKeys);
  const awakePercent = readPhasePercent(record, awakePhaseKeys, awakePercentKeys);

  const deepMinutes = readPhaseMinutes(
    record,
    deepPhaseKeys,
    deepPercentKeys,
    totalMinutes,
    percentDenominator
  );
  const lightMinutes = readPhaseMinutes(
    record,
    lightPhaseKeys,
    lightPercentKeys,
    totalMinutes,
    percentDenominator
  );
  const remMinutes = readPhaseMinutes(
    record,
    remPhaseKeys,
    remPercentKeys,
    totalMinutes,
    percentDenominator
  );
  const awakeMinutes =
    readPhaseMinutes(
      record,
      awakePhaseKeys,
      awakePercentKeys,
      totalMinutes,
      percentDenominator
    ) ??
    readNestedDuration(record, [
      "awakeTimeMinutes",
      "awakeDurationMinutes",
      "awakeDuration",
      "awakeTime",
      "wakeDuration"
    ]);

  const phases =
    record.phases && typeof record.phases === "object"
      ? (record.phases as Record<string, unknown>)
      : undefined;

  return finalizeSleepRecord(record, {
    happenDay,
    kind: defaults.kind,
    totalMinutes,
    score:
      defaults.score ??
      readNestedNumber(record, [
        "score",
        "sleepScore",
        "qualityScore",
        "quality_score",
        "sleepQualityScore",
        "performance"
      ]),
    deepMinutes,
    lightMinutes,
    remMinutes,
    awakeMinutes,
    deepPercent,
    lightPercent,
    remPercent,
    awakePercent,
    awakeCountOverFiveMinutes:
      defaults.awakeCountOverFiveMinutes ?? readAwakeCountOverFiveMinutes(record),
    windowMinutes,
    napMinutes:
      readNestedDuration(record, [
        "napMinutes",
        "nap_minutes",
        "napDurationMinutes",
        "napDuration",
        "shortSleepTime",
        "shortSleep"
      ]) ??
      (phases
        ? readNestedDuration(phases, [
            "napMinutes",
            "nap_minutes",
            "napDurationMinutes",
            "napDuration",
            "shortSleepTime",
            "shortSleep"
          ])
        : undefined),
    napStart: readNestedString(record, ["napStart", "napStartTime", "napWindowStart"]),
    napEnd: readNestedString(record, ["napEnd", "napEndTime", "napWindowEnd"]),
    avgHr: readNestedNumber(record, [
      "avgHr",
      "avg_hr",
      "avgHeartRate",
      "avgHeartRateBpm",
      "averageHeartRate"
    ]),
    sleepStart: defaults.sleepStart ?? window.sleepStart,
    sleepEnd: defaults.sleepEnd ?? window.sleepEnd
  });
}

function parseSleepDayBundle(raw: Record<string, unknown>): TrainingHubSleepRecord[] {
  const happenDay = normalizeHappenDay(
    raw.happenDay ?? raw.date ?? raw.day ?? raw.sleepDate ?? raw.statDay
  );

  if (!happenDay) {
    return [];
  }

  const dayScore = readNestedNumber(raw, [
    "score",
    "sleepScore",
    "qualityScore",
    "quality_score",
    "sleepQualityScore",
    "performance"
  ]);

  const records: TrainingHubSleepRecord[] = [];
  const sleepData = raw.sleepData ?? raw.sleep_data;
  const mainNested =
    raw.mainSleep ?? raw.mainSleepData ?? raw.nightSleep ?? raw.main ?? sleepData;
  const napNested = raw.napSleep ?? raw.napData ?? raw.napInfo;

  if (mainNested && typeof mainNested === "object") {
    const main = parseSleepRecord(mainNested, {
      happenDay,
      kind: "main",
      score: dayScore,
      awakeCountOverFiveMinutes: readAwakeCountOverFiveMinutes(raw)
    });
    if (main) {
      records.push(main);
    }
  } else {
    const topLevelMain = parseSleepRecord(raw, { happenDay, kind: "main", score: dayScore });
    if (topLevelMain) {
      records.push(topLevelMain);
    }
  }

  const napMinutes = readNestedDuration(raw, [
    "napMinutes",
    "nap_minutes",
    "napDurationMinutes",
    "napDuration",
    "shortSleepTime",
    "shortSleep"
  ]);
  const napStart = readNestedString(raw, ["napStart", "napStartTime", "napWindowStart"]);
  const napEnd = readNestedString(raw, ["napEnd", "napEndTime", "napWindowEnd"]);

  const mainIndex = records.findIndex((record) => record.kind === "main");
  if (mainIndex >= 0 && (napMinutes !== undefined || napStart || napEnd)) {
    records[mainIndex] = finalizeSleepRecord(raw, {
      ...records[mainIndex],
      napMinutes: napMinutes ?? records[mainIndex].napMinutes,
      napStart: napStart ?? records[mainIndex].napStart,
      napEnd: napEnd ?? records[mainIndex].napEnd
    });
  }

  if (napNested && typeof napNested === "object") {
    const nap = parseSleepRecord(napNested, {
      happenDay,
      kind: "nap"
    });
    if (nap) {
      records.push(nap);
    }
  } else if (
    (napMinutes !== undefined && napMinutes > 0) ||
    napStart ||
    napEnd
  ) {
    records.push(
      finalizeSleepRecord(raw, {
        happenDay,
        kind: "nap",
        totalMinutes: napMinutes,
        sleepStart: napStart,
        sleepEnd: napEnd,
        napStart,
        napEnd
      })
    );
  }

  return records;
}

function sleepRecordKey(record: TrainingHubSleepRecord): string {
  return [
    record.happenDay,
    record.kind ?? "main",
    record.sleepStart ?? "",
    record.totalMinutes ?? "",
    record.score ?? ""
  ].join(":");
}

function mergeSleepRecord(
  existing: TrainingHubSleepRecord,
  incoming: TrainingHubSleepRecord
): TrainingHubSleepRecord {
  return finalizeSleepRecord(
    {},
    {
      ...existing,
      ...Object.fromEntries(
        Object.entries(incoming).filter(([, value]) => value !== undefined)
      ),
      kind: existing.kind ?? incoming.kind,
      score: incoming.score ?? existing.score,
      totalMinutes:
        incoming.kind === "nap"
          ? incoming.totalMinutes ?? existing.napMinutes
          : incoming.totalMinutes ?? existing.totalMinutes,
      napMinutes: incoming.napMinutes ?? existing.napMinutes,
      napStart: incoming.napStart ?? existing.napStart,
      napEnd: incoming.napEnd ?? existing.napEnd
    }
  );
}

function sleepRecordCompleteness(record: TrainingHubSleepRecord): number {
  let score = 0;
  if (record.kind === "main") score += 4;
  if (record.score !== undefined) score += 3;
  if (record.totalMinutes !== undefined) score += 3;
  if (hasPositiveMinutes(record.deepMinutes)) score += 1;
  if (hasPositiveMinutes(record.lightMinutes)) score += 1;
  if (hasPositiveMinutes(record.remMinutes)) score += 1;
  if (hasPositiveMinutes(record.awakeMinutes)) score += 1;
  if (record.sleepStart && record.sleepEnd) score += 2;
  if (hasPositiveMinutes(record.napMinutes)) score += 1;
  if (record.napStart && record.napEnd) score += 1;
  return score;
}

function isOvernightMainSleep(record: TrainingHubSleepRecord): boolean {
  if (record.kind === "nap") {
    return false;
  }

  const startHour = parseClockHour(record.sleepStart);
  const endHour = parseClockHour(record.sleepEnd);
  const duration = record.totalMinutes ?? 0;

  if (startHour !== undefined && endHour !== undefined) {
    // Same-evening nap (e.g. 18:28–19:39) — not overnight main sleep.
    if (endHour > startHour && endHour <= 22 && duration <= 150) {
      return false;
    }

    if (startHour >= 21 && endHour <= 12) {
      return true;
    }

    if (startHour >= 20 && endHour <= 10 && duration >= 180) {
      return true;
    }
  }

  if (startHour !== undefined && startHour >= 21) {
    return true;
  }

  if (endHour !== undefined && endHour <= 10 && duration >= 180) {
    return true;
  }

  return duration >= 300;
}

function isCompleteMainSleep(record: TrainingHubSleepRecord): boolean {
  if (record.kind === "nap") {
    return false;
  }

  if (record.completeness === "partial") {
    return false;
  }

  if (record.score === undefined) {
    return false;
  }

  if ((record.totalMinutes ?? 0) < 180) {
    return false;
  }

  if (!isOvernightMainSleep(record)) {
    return false;
  }

  if (!isPlausibleMainSleep(record)) {
    return false;
  }

  return hasPositiveMinutes(record.deepMinutes) || hasPositiveMinutes(record.remMinutes);
}

function isSelectableMainSleep(record: TrainingHubSleepRecord): boolean {
  return record.kind !== "nap" && isPlausibleMainSleep(record);
}

function attachNapToMain(
  main: TrainingHubSleepRecord,
  naps: TrainingHubSleepRecord[]
): TrainingHubSleepRecord {
  const dayNaps = naps.filter((nap) => nap.happenDay === main.happenDay);
  if (dayNaps.length === 0) {
    return main;
  }

  const bestNap = dayNaps.sort(
    (left, right) => (right.totalMinutes ?? 0) - (left.totalMinutes ?? 0)
  )[0];

  return {
    ...main,
    napMinutes: bestNap.totalMinutes ?? main.napMinutes,
    napStart: bestNap.sleepStart ?? main.napStart,
    napEnd: bestNap.sleepEnd ?? main.napEnd
  };
}

export function pickLatestSleepRecord(
  records: TrainingHubSleepRecord[]
): TrainingHubSleepRecord | undefined {
  if (records.length === 0) {
    return undefined;
  }

  const mains = records.filter((record) => record.kind !== "nap");
  const naps = records.filter((record) => record.kind === "nap");
  const selectableMains = mains.filter(isSelectableMainSleep);
  const candidates = selectableMains.length > 0 ? selectableMains : mains;

  const sortedMains = candidates.sort((left, right) => {
    const dayCompare = right.happenDay.localeCompare(left.happenDay);
    if (dayCompare !== 0) {
      return dayCompare;
    }

    const completeCompare =
      Number(isCompleteMainSleep(right)) - Number(isCompleteMainSleep(left));
    if (completeCompare !== 0) {
      return completeCompare;
    }

    const overnightCompare =
      Number(isOvernightMainSleep(right)) - Number(isOvernightMainSleep(left));
    if (overnightCompare !== 0) {
      return overnightCompare;
    }

    return sleepRecordCompleteness(right) - sleepRecordCompleteness(left);
  });

  const latestMain = sortedMains[0];

  if (!latestMain) {
    return undefined;
  }

  return attachNapToMain(latestMain, naps);
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

function parseProseSleepRecords(text: string): TrainingHubSleepRecord[] {
  const sectionsWithIsoDate = text
    .split(/\n(?=20\d{2}-\d{2}-\d{2}\b)/i)
    .map((section) => section.trim())
    .filter(Boolean);
  const sectionsWithDate = text
    .split(/\n(?=Sleep for\s+)/i)
    .map((section) => section.trim())
    .filter(Boolean);
  const hasIsoDatedSection = sectionsWithIsoDate.some((section) =>
    /^20\d{2}-\d{2}-\d{2}\b/.test(section)
  );
  const hasDatedSection = sectionsWithDate.some((section) =>
    /^Sleep for\s+/i.test(section)
  );
  const sections = hasIsoDatedSection
    ? sectionsWithIsoDate
    : hasDatedSection
    ? sectionsWithDate
    : text
        .split(/\n(?=Sleep score:)/i)
        .map((section) => section.trim())
        .filter(Boolean);

  const candidates = sections.length > 1 ? sections : [text.trim()].filter(Boolean);
  const records: TrainingHubSleepRecord[] = [];

  for (const section of candidates) {
    const record = parseProseSleepSection(section);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function parseProseSleepSection(section: string): TrainingHubSleepRecord | undefined {
  const dateMatch = section.match(
    /(?:Sleep for\s+)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Za-z]{3})\s+(\d{1,2})/i
  );
  const monthDateMatch = section.match(/\b([A-Za-z]{3})\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  const isoDateMatch = section.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const compactDateMatch = section.match(/\b(20\d{6})\b/);
  const scoreMatch = section.match(/Sleep score:\s*(\d+(?:\.\d+)?)/i);
  const mainSleepMatch = section.match(/Main sleep:\s*([^\n]+)/i);
  const awakeMatch = section.match(/Awake time:\s*([^\n]+)/i);
  const awakePercentMatch = section.match(/Awake (?:ratio|percent(?:age)?):\s*(\d+(?:\.\d+)?)\s*%/i);
  const awakeCountMatch = section.match(/(?:Awake count|Wake-ups?|Wakeups?)\s*(?:\(?\s*>?\s*5\s*min(?:utes?)?\s*\)?)?:\s*(\d+)/i);
  const deepMatch = section.match(/Deep(?: sleep)?(?: ratio| percent(?:age)?)?:\s*(\d+(?:\.\d+)?)\s*%/i);
  const lightMatch = section.match(/Light(?: sleep)?(?: ratio| percent(?:age)?)?:\s*(\d+(?:\.\d+)?)\s*%/i);
  const remMatch = section.match(/REM(?: sleep)?(?: ratio| percent(?:age)?)?:\s*(\d+(?:\.\d+)?)\s*%/i);
  const windowMatch = section.match(/(?:Main\s+)?Sleep window:\s*([0-9]{1,2}:[0-9]{2})\s*[–-]\s*([0-9]{1,2}:[0-9]{2})/i);
  const napLineMatch = section.match(/\bNaps?(?:\s+Total)?:\s*([^\n]+)/i);
  const napText = napLineMatch?.[1]?.trim();
  const napDurationMatch = napText?.match(
    /\b(?:none|no|zero)\b|(?:(?:\d+(?:\.\d+)?\s*h(?:ours?)?)(?:\s*\d+(?:\.\d+)?\s*m(?:in(?:utes?)?)?)?|\d+(?:\.\d+)?\s*m(?:in(?:utes?)?)?)/i
  );
  const napWindowMatch = napText?.match(/([0-9]{1,2}:[0-9]{2})\s*[–-]\s*([0-9]{1,2}:[0-9]{2})/);

  if (!scoreMatch && !mainSleepMatch) {
    return undefined;
  }

  let happenDay: string | undefined;
  if (monthDateMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec"
    ];
    const monthIndex = monthNames.indexOf(monthDateMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      const month = String(monthIndex + 1).padStart(2, "0");
      const day = String(Number(monthDateMatch[2])).padStart(2, "0");
      happenDay = `${monthDateMatch[3]}${month}${day}`;
    }
  } else if (dateMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec"
    ];
    const monthIndex = monthNames.indexOf(dateMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      const year = new Date().getFullYear();
      const month = String(monthIndex + 1).padStart(2, "0");
      const day = String(Number(dateMatch[2])).padStart(2, "0");
      happenDay = `${year}${month}${day}`;
    }
  } else if (isoDateMatch) {
    happenDay = `${isoDateMatch[1]}${isoDateMatch[2]}${isoDateMatch[3]}`;
  } else if (compactDateMatch) {
    happenDay = compactDateMatch[1];
  }

  if (!happenDay) {
    happenDay = recentTrainingHubDateList(1)[0];
  }

  const totalMinutes = mainSleepMatch
    ? parseDurationMinutes(mainSleepMatch[1].trim())
    : undefined;
  const awakeMinutes = awakeMatch
    ? parseDurationMinutes(awakeMatch[1].trim())
    : undefined;
  const sleepStart = windowMatch?.[1];
  const sleepEnd = windowMatch?.[2];
  const windowMinutes = sleepWindowDurationMinutes({ happenDay, sleepStart, sleepEnd });
  const percentDenominator = windowMinutes ?? totalMinutes;
  const deepPercent = deepMatch ? Number(deepMatch[1]) : undefined;
  const lightPercent = lightMatch ? Number(lightMatch[1]) : undefined;
  const remPercent = remMatch ? Number(remMatch[1]) : undefined;
  const awakePercent =
    awakePercentMatch
      ? Number(awakePercentMatch[1])
      : awakeMinutes !== undefined && percentDenominator !== undefined
        ? Math.round((awakeMinutes / percentDenominator) * 1000) / 10
        : undefined;
  const napDurationText = napDurationMatch?.[0]?.trim();

  return finalizeSleepRecord(
    {},
    {
      happenDay,
      kind: "main",
      totalMinutes,
      score: scoreMatch ? Number(scoreMatch[1]) : undefined,
      deepMinutes:
        deepPercent !== undefined && percentDenominator !== undefined
          ? Math.round((deepPercent / 100) * percentDenominator)
          : undefined,
      lightMinutes:
        lightPercent !== undefined && percentDenominator !== undefined
          ? Math.round((lightPercent / 100) * percentDenominator)
          : undefined,
      remMinutes:
        remPercent !== undefined && percentDenominator !== undefined
          ? Math.round((remPercent / 100) * percentDenominator)
          : undefined,
      awakeMinutes,
      deepPercent,
      lightPercent,
      remPercent,
      awakePercent,
      awakeCountOverFiveMinutes: awakeCountMatch ? Number(awakeCountMatch[1]) : undefined,
      windowMinutes,
      sleepStart,
      sleepEnd,
      napMinutes: napDurationText ? parseNapDurationText(napDurationText) : undefined,
      napStart: napWindowMatch?.[1],
      napEnd: napWindowMatch?.[2]
    }
  );
}

const SLEEP_BUNDLE_CHILD_KEYS = new Set([
  "mainSleep",
  "mainSleepData",
  "nightSleep",
  "main",
  "napSleep",
  "napData",
  "napInfo",
  "sleepData",
  "sleep_data"
]);

function walkForSleepRecords(value: unknown, found: Map<string, TrainingHubSleepRecord>): void {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      walkForSleepRecords(entry, found);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const raw = value as Record<string, unknown>;
  const bundled = parseSleepDayBundle(raw);
  if (bundled.length > 0) {
    for (const record of bundled) {
      const key = sleepRecordKey(record);
      const existing = found.get(key);
      found.set(key, existing ? mergeSleepRecord(existing, record) : record);
    }

    for (const [key, nested] of Object.entries(raw)) {
      if (!SLEEP_BUNDLE_CHILD_KEYS.has(key) && nested && typeof nested === "object") {
        walkForSleepRecords(nested, found);
      }
    }
    return;
  }

  const record = parseSleepRecord(raw);
  if (record) {
    const key = sleepRecordKey(record);
    const existing = found.get(key);
    found.set(key, existing ? mergeSleepRecord(existing, record) : record);
  }

  for (const nested of Object.values(raw)) {
    if (nested && typeof nested === "object") {
      walkForSleepRecords(nested, found);
    }
  }
}

function collectSleepRecords(payload: unknown): TrainingHubSleepRecord[] {
  const found = new Map<string, TrainingHubSleepRecord>();

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      walkForSleepRecords(entry, found);
    }
  } else if (payload && typeof payload === "object") {
    walkForSleepRecords(payload, found);
  }

  return [...found.values()];
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
    if (/sleep|awake|nap|rem/i.test(text)) {
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

function mergeCollectedSleepRecords(
  records: TrainingHubSleepRecord[]
): TrainingHubSleepRecord[] {
  const merged = new Map<string, TrainingHubSleepRecord>();

  for (const record of records) {
    const key = `${record.happenDay}:${record.kind ?? "main"}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, record);
      continue;
    }

    const preferred =
      sleepRecordCompleteness(record) >= sleepRecordCompleteness(existing)
        ? mergeSleepRecord(existing, record)
        : mergeSleepRecord(record, existing);
    merged.set(key, preferred);
  }

  return [...merged.values()].sort((left, right) =>
    left.happenDay.localeCompare(right.happenDay)
  );
}

export function parseSleepDataResponse(text: string): TrainingHubSleepRecord[] {
  const jsonPayload = extractJsonPayload(text);
  const jsonRecords = collectSleepRecords(jsonPayload);
  const proseRecords = [text, ...collectProseTexts(jsonPayload)]
    .flatMap((candidate) => parseProseSleepRecords(unwrapProseText(candidate)));

  return mergeCollectedSleepRecords([...jsonRecords, ...proseRecords]);
}

function resolveSleepTool(tools: CorosMcpTool[]): CorosMcpTool | undefined {
  const preferred = tools.find((tool) => tool.name === PREFERRED_SLEEP_TOOL);
  if (preferred) {
    return preferred;
  }

  const fallback = tools.find((tool) => tool.name === FALLBACK_SLEEP_TOOL);
  if (fallback) {
    return fallback;
  }

  return tools.find(
    (tool) =>
      /sleep/i.test(tool.name) &&
      !/hrv|heart|stress|recovery/i.test(tool.name)
  );
}

function schemaPropertyNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") {
    return [];
  }

  return Object.keys(properties as Record<string, unknown>);
}

function addExactSleepDateArgs(
  candidates: Record<string, unknown>[],
  propertyNames: string[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const keyedArgs: Array<[string, unknown][]> = [];

  if (propertyNames.includes("date")) {
    keyedArgs.push([["date", iso]], [["date", happenDay]]);
  }
  if (propertyNames.includes("sleepDate")) {
    keyedArgs.push([["sleepDate", iso]], [["sleepDate", happenDay]]);
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

function addGenericExactSleepDateArgs(
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
    { startDate: iso, endDate: iso, days: 1 }
  );

  candidates.push(
    { date: iso },
    { date: happenDay },
    { sleepDate: iso },
    { sleepDate: happenDay },
    { happenDay },
    { happen_day: happenDay },
    { day: happenDay },
    { day: iso }
  );
}

function addSleepQueryArgs(
  candidates: Record<string, unknown>[],
  propertyNames: string[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const query =
    `Return detailed sleep data for ${iso} (${happenDay}): sleep score, ` +
    "main sleep duration, sleep window, awake time, deep sleep, REM sleep, and naps.";
  const keys = ["query", "question", "prompt", "input", "text"];

  for (const key of keys) {
    if (propertyNames.includes(key)) {
      candidates.push({ [key]: query });
    }
  }
}

function addGenericSleepQueryArgs(
  candidates: Record<string, unknown>[],
  happenDay: string
): void {
  const iso = happenDayToIso(happenDay);
  const query =
    `Return detailed sleep data for ${iso} (${happenDay}): sleep score, ` +
    "main sleep duration, sleep window, awake time, deep sleep, REM sleep, and naps.";

  candidates.push(
    { query },
    { question: query },
    { prompt: query },
    { input: query }
  );
}

function buildSleepToolArgs(
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

  addExactSleepDateArgs(candidates, propertyNames, endDay);
  addGenericExactSleepDateArgs(candidates, endDay);
  addSleepQueryArgs(candidates, propertyNames, endDay);
  addGenericSleepQueryArgs(candidates, endDay);

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
    { startDay, endDay }
  );

  if (propertyNames.includes("weeks")) {
    candidates.push({ weeks: Math.max(1, Math.ceil(days / 7)) });
  }

  candidates.push({});

  if (tool.name === FALLBACK_SLEEP_TOOL) {
    candidates.push({ weeks: Math.max(1, Math.ceil(days / 7)) });
  }

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

async function ensureMcpForSleep(
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

export function sleepResponseQuality(records: TrainingHubSleepRecord[]): number {
  const latest = pickLatestSleepRecord(records);
  if (!latest) {
    return records.reduce(
      (total, record) => total + sleepRecordCompleteness(record),
      0
    );
  }

  const happenDayScore = /^\d{8}$/.test(latest.happenDay)
    ? Number(latest.happenDay) - 20_000_000
    : 0;
  const completeBonus = isCompleteMainSleep(latest) ? 5_000 : 0;

  return (
    happenDayScore * 10_000 +
    completeBonus +
    sleepRecordCompleteness(latest) * 100 +
    Math.min(records.length, 30)
  );
}

async function fetchSleepRecords(
  sleepTool: CorosMcpTool,
  days: number
): Promise<TrainingHubSleepRecord[]> {
  const argCandidates = buildSleepToolArgs(sleepTool, days);
  let bestRecords: TrainingHubSleepRecord[] = [];
  let bestScore = -1;
  const collectedRecords: TrainingHubSleepRecord[] = [];

  for (const args of argCandidates) {
    try {
      const response = await callCorosMcpTool(sleepTool.name, args);
      const records = parseSleepDataResponse(response);
      const score = sleepResponseQuality(records);
      collectedRecords.push(...records);

      if (score > bestScore) {
        bestScore = score;
        bestRecords = records;
      }
    } catch (error) {
      console.warn(
        `[sleepDataService] ${sleepTool.name} failed for args ${JSON.stringify(args)}:`,
        error
      );
    }
  }

  const mergedRecords = mergeCollectedSleepRecords(collectedRecords);
  return mergedRecords.length > 0 ? mergedRecords : bestRecords;
}

export async function getTrainingSleepData(
  mainWindow?: BrowserWindow | null,
  days = 14
): Promise<TrainingHubSleepSummary> {
  const connected = await ensureMcpForSleep(mainWindow);
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

  const sleepTool = resolveSleepTool(getCorosMcpTools());
  if (!sleepTool) {
    return {
      records: [],
      mcpConnected: true
    };
  }

  try {
    const records = await fetchSleepRecords(sleepTool, days);

    return {
      latest: pickLatestSleepRecord(records),
      records,
      mcpConnected: true
    };
  } catch (error) {
    console.warn("[sleepDataService] Failed to fetch sleep data:", error);
    return {
      records: [],
      mcpConnected: true
    };
  }
}
