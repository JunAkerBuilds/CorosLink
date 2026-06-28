import crypto from "node:crypto";
import { deleteSettings, getSetting, setSetting } from "./database";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubActivityLap,
  TrainingHubActivityTrack,
  TrainingHubTrackPoint,
  TrainingHubAnalytics,
  TrainingHubDailyMetric,
  TrainingHubDailyMetrics,
  TrainingHubRacePredictor,
  TrainingHubRaceScore,
  TrainingHubSportStatistic,
  TrainingHubSportType,
  TrainingHubDashboard,
  TrainingHubPersonalRecord,
  TrainingHubPersonalRecordGroup,
  TrainingHubSleepHrvReading,
  TrainingHubSleepHrvSummary,
  TrainingHubStatus,
  TrainingHubThresholdZone,
  TrainingHubUpcomingWorkout,
  TrainingHubZoneDistributionEntry,
  TrainingHubZoneDistributions
} from "./types";

interface LoginResult {
  loginData: TrainingHubLoginData;
  loginBaseUrl: string;
}

const GLOBAL_BASE_URL = "https://teamapi.coros.com";
const LOGIN_URL = `${GLOBAL_BASE_URL}/account/login`;
const RESULT_SUCCESS = "0000";
const AUTH_ERROR_CODES = new Set(["0101", "0102", "1006"]);

const REGION_BASE_URLS: Record<string, string> = {
  "0": "https://teamapi.coros.com",
  "1": "https://teamapi.coros.com",
  "2": "https://teameuapi.coros.com",
  "3": "https://teamapiap.coros.com",
  cn: "https://teamcnapi.coros.com",
  us: "https://teamapi.coros.com",
  eu: "https://teameuapi.coros.com",
  global: "https://teamapi.coros.com"
};

const REGION_PROBE_URLS = [
  "https://teamapi.coros.com",
  "https://teameuapi.coros.com",
  "https://teamcnapi.coros.com",
  "https://teamapiap.coros.com"
];

const SETTINGS = {
  accessToken: "trainingHub.accessToken",
  userId: "trainingHub.userId",
  regionId: "trainingHub.regionId",
  baseUrl: "trainingHub.baseUrl"
};

interface TrainingHubAuthState {
  accessToken: string;
  userId: string;
  regionId: string;
  baseUrl: string;
}

interface TrainingHubApiResponse<T> {
  result?: string;
  apiCode?: string;
  message?: string;
  data?: T;
}

interface TrainingHubLoginData {
  accessToken?: string;
  userId?: string | number;
  regionId?: string | number;
}

interface TrainingHubAccountData {
  userId?: string | number;
}

interface TrainingHubActivityListData {
  dataList?: RawTrainingHubActivity[];
}

interface RawTrainingHubActivity {
  labelId?: string;
  activityId?: string;
  name?: string;
  sportType?: number;
  startTime?: number;
  endTime?: number;
  totalTime?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calorie?: number;
  trainingLoad?: number;
  ascent?: number;
}

interface TrainingHubDashboardData {
  summaryInfo?: Record<string, unknown>;
  sportDataSummary?: {
    count?: number;
    modelValidState?: boolean;
  };
}

interface TrainingHubSportListData {
  sportList?: RawSportType[];
  dataList?: RawSportType[];
}

interface RawSportType {
  sportType?: number;
  sportName?: string;
  name?: string;
}

interface RawDailyMetric {
  happenDay?: string | number;
  trainingLoad?: number;
  rhr?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  tiredRateNew?: number;
  tiredRateStateNew?: number;
  trainingLoadRatio?: number;
  staminaLevel?: number;
  vo2max?: number;
  distance?: number;
  duration?: number;
}

interface RawRaceScore {
  type?: number;
  distance?: number;
  duration?: number;
  avgPace?: number;
  predictSecond?: number;
  predictTime?: number;
  time?: number;
  score?: number;
  raceType?: number | string;
  raceName?: string;
  [key: string]: unknown;
}

interface TrainingHubFileUrlData {
  fileUrl?: string;
}

export function getTrainingHubStatus(): TrainingHubStatus {
  const auth = getStoredAuth();

  return {
    authenticated: Boolean(auth),
    userId: auth?.userId,
    regionId: auth?.regionId,
    baseUrl: auth?.baseUrl
  };
}

export async function loginTrainingHub(
  email: string,
  password: string
): Promise<TrainingHubStatus> {
  const account = email.trim();
  if (!account || !password) {
    throw new Error("Enter your COROS email and password.");
  }

  const pwdHash = crypto.createHash("md5").update(password).digest("hex");
  const session = await establishTrainingHubSession(account, pwdHash);

  setSetting(SETTINGS.accessToken, session.accessToken);
  setSetting(SETTINGS.userId, session.userId);
  setSetting(SETTINGS.regionId, session.regionId);
  setSetting(SETTINGS.baseUrl, session.baseUrl);

  return getTrainingHubStatus();
}

async function establishTrainingHubSession(
  account: string,
  pwdHash: string
): Promise<TrainingHubAuthState> {
  const { loginData, loginBaseUrl } = await loginViaAnyBase(account, pwdHash);
  const accessToken = loginData.accessToken;

  if (!accessToken) {
    throw new Error("COROS login response did not include a usable token.");
  }

  const regionId =
    loginData.regionId === undefined ? "1" : String(loginData.regionId);
  const baseUrl = await resolveTrainingHubBaseUrl(accessToken, loginBaseUrl);

  let userId = String(loginData.userId ?? "").trim();
  const accountData = await queryTrainingHubAccount(accessToken, baseUrl);
  if (accountData?.userId !== undefined) {
    userId = String(accountData.userId).trim();
  }

  if (!userId) {
    throw new Error("COROS login response did not include a user ID.");
  }

  return {
    accessToken,
    userId,
    regionId,
    baseUrl
  };
}

async function loginViaAnyBase(
  account: string,
  pwdHash: string
): Promise<LoginResult> {
  const loginTargets = REGION_PROBE_URLS.map(
    (baseUrl) => [baseUrl, `${baseUrl}/account/login`] as const
  );

  let lastError: unknown;

  for (const [loginBaseUrl, loginUrl] of loginTargets) {
    try {
      const loginData = await loginAtBase(loginUrl, account, pwdHash);
      return { loginData, loginBaseUrl };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error && lastError.message) {
    throw lastError;
  }

  throw new Error(
    "COROS login failed. Check your email and password, then try again."
  );
}

async function loginAtBase(
  url: string,
  account: string,
  pwdHash: string
): Promise<TrainingHubLoginData> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*"
    },
    body: JSON.stringify({
      account,
      accountType: 2,
      pwd: pwdHash
    })
  });

  if (!response.ok) {
    throw new Error(
      `COROS login request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TrainingHubApiResponse<TrainingHubLoginData>;
  const result = String(payload.result ?? payload.apiCode ?? "");

  if (result !== RESULT_SUCCESS) {
    throw new Error(payload.message || "COROS login failed.");
  }

  if (!payload.data?.accessToken) {
    throw new Error("COROS login response did not include a usable token.");
  }

  return payload.data;
}

async function queryTrainingHubAccount(
  accessToken: string,
  baseUrl: string
): Promise<TrainingHubAccountData | null> {
  try {
    const response = await fetch(`${baseUrl}/account/query`, {
      headers: buildTrainingHubHeaders(accessToken)
    });

    if (!response.ok) {
      return null;
    }

    const payload =
      (await response.json()) as TrainingHubApiResponse<TrainingHubAccountData>;
    const result = String(payload.result ?? payload.apiCode ?? "");

    if (result !== RESULT_SUCCESS || !payload.data) {
      return null;
    }

    return payload.data;
  } catch {
    return null;
  }
}

export function logoutTrainingHub(): TrainingHubStatus {
  clearTrainingHubAuth();
  return getTrainingHubStatus();
}

export async function listTrainingHubActivities(
  page = 1,
  size = 50
): Promise<TrainingHubActivity[]> {
  const data = await trainingHubGet<TrainingHubActivityListData>(
    "/activity/query",
    {
      size,
      pageNumber: page
    }
  );

  return (data.dataList ?? []).map(mapTrainingHubActivity);
}

export async function getTrainingHubActivityDetail(
  activityId: string,
  sportType: number,
  listActivity?: TrainingHubActivity
): Promise<TrainingHubActivityDetail> {
  const auth = getStoredAuth();
  const raw = await trainingHubRequest<Record<string, unknown>>(
    "/activity/detail/query",
    {
      method: "POST",
      params: {
        labelId: activityId,
        sportType,
        ...(auth?.userId ? { userId: auth.userId } : {})
      }
    }
  );

  let detail = parseActivityDetail(raw);
  if (listActivity) {
    detail = mergeActivityDetailWithList(detail, listActivity);
  }

  const gpsPointCount =
    detail.track?.points.filter(
      (point) => point.lat !== undefined && point.lon !== undefined
    ).length ?? 0;

  if (gpsPointCount < 2) {
    const gpxTrack = await fetchActivityTrackFromGpx(activityId, sportType);
    if (gpxTrack) {
      detail = {
        ...detail,
        track: mergeActivityTracks(detail.track, gpxTrack)
      };
    }
  }

  return detail;
}

export async function getTrainingHubActivityFileUrl(
  activityId: string,
  sportType: number,
  fileType: TrainingHubActivityFileType = 4
): Promise<string> {
  const data = await trainingHubRequest<TrainingHubFileUrlData>(
    "/activity/detail/download",
    {
      method: "POST",
      params: {
        labelId: activityId,
        sportType,
        fileType
      }
    }
  );

  if (!data.fileUrl) {
    throw new Error("COROS did not return a file URL for this activity.");
  }

  return data.fileUrl;
}

export async function getTrainingAnalytics(): Promise<TrainingHubAnalytics> {
  const raw = await trainingHubGet<Record<string, unknown>>("/analyse/query");
  return parseAnalytics(raw);
}

export async function getTrainingDashboard(): Promise<TrainingHubDashboard> {
  const dashboard = await trainingHubGet<TrainingHubDashboardData>(
    "/dashboard/query"
  );

  return parseTrainingDashboard(dashboard);
}

export async function getRacePredictor(): Promise<TrainingHubRacePredictor> {
  const dashboard = await getTrainingDashboard();
  return dashboard.racePredictor;
}

export async function getDailyMetrics(
  dateList: string[]
): Promise<TrainingHubDailyMetrics> {
  const sortedDates = [...dateList].sort();
  const startDay = sortedDates[0];
  const endDay = sortedDates[sortedDates.length - 1];

  if (!startDay || !endDay) {
    throw new Error("At least one date is required for daily metrics.");
  }

  const raw = await trainingHubGet<Record<string, unknown>>(
    "/analyse/dayDetail/query",
    {
      startDay,
      endDay
    }
  );

  return parseDailyMetrics(raw);
}

export async function getSportTypeMap(): Promise<TrainingHubSportType[]> {
  try {
    const data = await trainingHubGet<TrainingHubSportListData>(
      "/activity/fit/getImportSportList"
    );
    const list = data.sportList ?? data.dataList ?? [];

    return list
      .map((item) => ({
        sportType: item.sportType ?? 0,
        sportName: item.sportName ?? item.name ?? `Sport ${item.sportType ?? 0}`
      }))
      .filter((item) => item.sportType > 0);
  } catch {
    return [];
  }
}

export async function getUpcomingWorkouts(
  days = 14
): Promise<TrainingHubUpcomingWorkout[]> {
  const { startDay, endDay } = upcomingScheduleDateRange(days);
  const raw = await trainingHubGet<Record<string, unknown>>(
    "/training/schedule/query",
    {
      startDate: startDay,
      endDate: endDay,
      supportRestExercise: 1
    }
  );

  return parseUpcomingWorkouts(raw, startDay);
}

function upcomingScheduleDateRange(days: number): {
  startDay: string;
  endDay: string;
} {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + Math.max(0, days - 1));

  return {
    startDay: formatScheduleDay(start),
    endDay: formatScheduleDay(end)
  };
}

function formatScheduleDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function parseUpcomingWorkouts(
  raw: Record<string, unknown>,
  todayDay: string
): TrainingHubUpcomingWorkout[] {
  const entities = extractArray(raw, ["entities"]) ?? [];
  const programs = extractArray(raw, ["programs"]) ?? [];
  const programsByIdInPlan = new Map<string, Record<string, unknown>>();
  const programsById = new Map<string, Record<string, unknown>>();

  for (const item of programs) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const program = item as Record<string, unknown>;
    const idInPlan = program.idInPlan;

    if (idInPlan !== undefined && idInPlan !== null) {
      programsByIdInPlan.set(String(idInPlan), program);
    }

    if (program.id !== undefined && program.id !== null) {
      programsById.set(String(program.id), program);
    }
  }

  const workouts: TrainingHubUpcomingWorkout[] = [];

  entities.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const entity = item as Record<string, unknown>;
    const status = toOptionalNumber(entity.status);

    if (status === 3) {
      return;
    }

    const happenDay = String(entity.happenDay ?? "");

    if (!/^\d{8}$/.test(happenDay) || happenDay < todayDay) {
      return;
    }

    const idInPlan = String(entity.idInPlan ?? "");
    const planProgramId = String(entity.planProgramId ?? "");
    const program = resolveScheduledProgram(
      entity,
      index,
      programsByIdInPlan,
      programsById,
      programs
    );

    workouts.push({
      happenDay,
      name: resolveUpcomingWorkoutName(program, entity),
      volume: formatUpcomingWorkoutVolume(program, entity),
      trainingLoad: resolveUpcomingWorkoutLoad(program, entity),
      sportType: toOptionalNumber(program?.sportType),
      sortNo: toOptionalNumber(entity.sortNoInSchedule ?? entity.sortNo)
    });
  });

  return workouts.sort((left, right) => {
    if (left.happenDay !== right.happenDay) {
      return left.happenDay.localeCompare(right.happenDay);
    }

    return (left.sortNo ?? 0) - (right.sortNo ?? 0);
  });
}

function resolveScheduledProgram(
  entity: Record<string, unknown>,
  index: number,
  programsByIdInPlan: Map<string, Record<string, unknown>>,
  programsById: Map<string, Record<string, unknown>>,
  programs: Record<string, unknown>[]
): Record<string, unknown> | undefined {
  const planProgramId = String(entity.planProgramId ?? "");
  const idInPlan = String(entity.idInPlan ?? "");

  return (
    (planProgramId ? programsByIdInPlan.get(planProgramId) : undefined) ??
    (idInPlan ? programsByIdInPlan.get(idInPlan) : undefined) ??
    (planProgramId ? programsById.get(planProgramId) : undefined) ??
    (programs[index] && typeof programs[index] === "object"
      ? programs[index]
      : undefined)
  );
}

function resolveUpcomingWorkoutName(
  program: Record<string, unknown> | undefined,
  entity: Record<string, unknown>
): string {
  const sportData = pickObject(entity, ["sportData"]);

  return (
    (sportData ? pickString(sportData, ["name"]) : undefined) ??
    (program ? pickString(program, ["name"]) : undefined) ??
    pickString(entity, ["name"]) ??
    "Scheduled workout"
  );
}

function resolveUpcomingWorkoutLoad(
  program: Record<string, unknown> | undefined,
  entity: Record<string, unknown>
): number | undefined {
  const sportData = pickObject(entity, ["sportData"]);

  return (
    (sportData ? toOptionalNumber(sportData.trainingLoad) : undefined) ??
    (program ? toOptionalNumber(program.trainingLoad) : undefined) ??
    (program ? toOptionalNumber(program.essence) : undefined) ??
    (program ? toOptionalNumber(program.estimatedValue) : undefined)
  );
}

function corosWorkoutDistanceToMeters(value?: number): number {
  if (!value || value <= 0) {
    return 0;
  }

  // COROS schedule workout distance fields are stored in centimeters.
  return value / 100;
}

function formatUpcomingWorkoutVolume(
  program: Record<string, unknown> | undefined,
  entity: Record<string, unknown>
): string | undefined {
  const sportData = pickObject(entity, ["sportData"]);
  const setCount = resolveWorkoutSetCount(program);

  if (setCount > 1) {
    return `${setCount} set(s)`;
  }

  const distanceMeters =
    corosWorkoutDistanceToMeters(toOptionalNumber(sportData?.distance)) ||
    resolveWorkoutDistanceMeters(program);

  if (distanceMeters > 0) {
    return `${(distanceMeters / 1000).toFixed(2)}km`;
  }

  if (setCount > 0) {
    return `${setCount} set(s)`;
  }

  return undefined;
}

function resolveWorkoutDistanceMeters(
  program: Record<string, unknown> | undefined
): number {
  if (!program) {
    return 0;
  }

  const directDistance = corosWorkoutDistanceToMeters(
    toOptionalNumber(program.distance)
  );

  if (directDistance > 0) {
    return directDistance;
  }

  const estimatedDistance = corosWorkoutDistanceToMeters(
    toOptionalNumber(program.estimatedDistance)
  );

  if (estimatedDistance > 0) {
    return estimatedDistance;
  }

  const exercises = Array.isArray(program.exercises) ? program.exercises : [];
  let total = 0;

  for (const item of exercises) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const exercise = item as Record<string, unknown>;
    const targetType = toOptionalNumber(exercise.targetType);
    const targetValue = toOptionalNumber(exercise.targetValue);
    const sets = Math.max(1, toOptionalNumber(exercise.sets) ?? 1);

    if (targetType === 5 && targetValue) {
      total += corosWorkoutDistanceToMeters(targetValue) * sets;
    }
  }

  return total;
}

function resolveWorkoutSetCount(
  program: Record<string, unknown> | undefined
): number {
  if (!program) {
    return 0;
  }

  const exerciseNum = toOptionalNumber(program.exerciseNum);

  if (exerciseNum && exerciseNum > 0) {
    return Math.round(exerciseNum);
  }

  const exercises = Array.isArray(program.exercises) ? program.exercises : [];

  for (const item of exercises) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const exercise = item as Record<string, unknown>;

    if (exercise.isGroup) {
      const groupSets = toOptionalNumber(exercise.sets);

      if (groupSets && groupSets > 0) {
        return Math.round(groupSets);
      }
    }
  }

  const totalSets =
    toOptionalNumber(program.totalSets) ??
    toOptionalNumber(program.sets);

  if (totalSets && totalSets > 0) {
    return Math.round(totalSets);
  }

  if (exercises.length === 0) {
    return 0;
  }

  return exercises.reduce((count, item) => {
    if (!item || typeof item !== "object") {
      return count;
    }

    const exercise = item as Record<string, unknown>;
    return count + Math.max(1, toOptionalNumber(exercise.sets) ?? 1);
  }, 0);
}

function mapTrainingHubActivity(
  raw: RawTrainingHubActivity
): TrainingHubActivity {
  const activityId = raw.labelId ?? raw.activityId ?? "";

  return {
    activityId,
    name: raw.name,
    sportType: raw.sportType ?? 0,
    startTime: raw.startTime,
    endTime: raw.endTime,
    duration: raw.totalTime,
    distance: raw.distance,
    avgHr: raw.avgHr,
    maxHr: raw.maxHr,
    calories:
      raw.calorie && raw.calorie > 0
        ? Math.round(raw.calorie / 1000)
        : undefined,
    trainingLoad: raw.trainingLoad,
    elevationGain: raw.ascent
  };
}

function parseDailyMetric(raw: RawDailyMetric): TrainingHubDailyMetric {
  return {
    happenDay: String(raw.happenDay ?? ""),
    trainingLoad: toOptionalNumber(raw.trainingLoad),
    rhr: toOptionalNumber(raw.rhr),
    avgSleepHrv: toOptionalNumber(raw.avgSleepHrv),
    sleepHrvBase: toOptionalNumber(raw.sleepHrvBase),
    tiredRateNew: toOptionalNumber(raw.tiredRateNew),
    tiredRateStateNew: toOptionalNumber(raw.tiredRateStateNew),
    trainingLoadRatio: toOptionalNumber(raw.trainingLoadRatio),
    staminaLevel: toOptionalNumber(raw.staminaLevel),
    vo2max: toOptionalNumber(raw.vo2max),
    distance: toOptionalNumber(raw.distance),
    duration: toOptionalNumber(raw.duration)
  };
}

function parseDailyMetrics(raw: Record<string, unknown>): TrainingHubDailyMetrics {
  const dayList = extractDayList(raw).map((item) =>
    parseDailyMetric(item as RawDailyMetric)
  );
  const weekList = extractArray(raw, ["weekList", "evoLab.weekList"]);

  return {
    dayList,
    weekList,
    raw
  };
}

function parseAnalytics(raw: Record<string, unknown>): TrainingHubAnalytics {
  const dayList = extractDayList(raw).map((item) =>
    parseDailyMetric(item as RawDailyMetric)
  );
  const weekList = extractArray(raw, ["weekList", "evoLab.weekList"]);
  const sportStatistics = extractSportStatistics(raw);
  const summary = pickObject(raw, ["summaryInfo"]) ?? {};

  return {
    dayList,
    weekList,
    sportStatistics,
    zoneDistributions: parseZoneDistributions(summary),
    raw
  };
}

function parseZoneDistributions(
  summary: Record<string, unknown>
): TrainingHubZoneDistributions {
  return {
    hrTrainingLoad: parseZoneDistributionEntries(summary.hrTlAreaList),
    hrDistance: parseZoneDistributionEntries(summary.hrDisAreaList),
    hrTime: parseZoneDistributionEntries(summary.hrTimeAreaList),
    distanceFrequency: parseZoneDistributionEntries(
      summary.distanceCountAreaList
    ),
    distanceTrainingLoad: parseZoneDistributionEntries(
      summary.distanceTlAreaList
    ),
    distanceTime: parseZoneDistributionEntries(summary.distanceTimeAreaList)
  };
}

function parseZoneDistributionEntries(
  raw: unknown
): TrainingHubZoneDistributionEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): TrainingHubZoneDistributionEntry | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const entry = item as Record<string, unknown>;
      const index = toOptionalNumber(entry.index);

      if (index === undefined) {
        return null;
      }

      const ratio = toOptionalNumber(entry.ratio);
      const value = toOptionalNumber(entry.value);

      return {
        index,
        ...(ratio !== undefined ? { ratio } : {}),
        ...(value !== undefined ? { value } : {})
      };
    })
    .filter(
      (entry): entry is TrainingHubZoneDistributionEntry => entry !== null
    )
    .sort((left, right) => left.index - right.index);
}

const RECORD_TYPE_LABELS: Record<number, string> = {
  5: "5K",
  6: "3K",
  7: "1K",
  8: "1 Mile",
  9: "2 Mile",
  10: "5K",
  11: "10K",
  12: "Half Marathon",
  13: "Marathon",
  101: "Longest Run",
  102: "Best Pace",
  103: "Most Elevation Gain"
};

const DISTANCE_PR_RECORD_TYPES = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13]);

const PERSONAL_RECORD_SLOT_TYPES = [103, 12, 13] as const;

const RECORD_TYPE_EXCLUDED = new Set([8, 9, 102]);

const RECORD_DISPLAY_ORDER: Record<number, number> = {
  101: 0,
  103: 1,
  7: 2,
  6: 3,
  5: 4,
  10: 4,
  11: 5,
  12: 6,
  13: 7
};

const DISTANCE_PR_DISTANCE_METERS: Record<number, number> = {
  5: 5000,
  6: 3000,
  7: 1000,
  8: 1609,
  9: 3218,
  10: 5000,
  11: 10000,
  12: 21097,
  13: 42195
};

const RACE_PREDICTOR_TYPE_LABELS: Record<number, string> = {
  5: "5K",
  4: "10K",
  2: "Half Marathon",
  1: "Marathon"
};

const RACE_PREDICTOR_TYPE_DISTANCE_METERS: Record<number, number> = {
  5: 5000,
  4: 10000,
  2: 21097,
  1: 42195
};

const RACE_PREDICTOR_DISPLAY_ORDER = [5, 4, 2, 1];

const RECORD_GROUP_LABELS: Record<number, string> = {
  1: "All",
  2: "Half year",
  3: "12 weeks",
  4: "4 weeks"
};

const RECORD_GROUP_DISPLAY_ORDER: Record<number, number> = {
  4: 0,
  3: 1,
  2: 2,
  1: 3
};

function parseTrainingDashboard(
  dashboard: TrainingHubDashboardData
): TrainingHubDashboard {
  const summary = dashboard.summaryInfo ?? {};
  const racePredictor = parseRacePredictor(summary);

  return {
    racePredictor,
    rhr: toOptionalNumber(summary.rhr),
    recoveryPct: toOptionalNumber(summary.recoveryPct),
    recoveryState: toOptionalNumber(summary.recoveryState),
    fullRecoveryHours: toOptionalNumber(summary.fullRecoveryHours),
    fitnessMaxHr: toOptionalNumber(summary.fitnessMaxHr),
    runningLevelHr: toOptionalNumber(summary.runningLevelHr),
    lthrZones: parseThresholdZones(summary.lthrZone),
    ltspZones: parseThresholdZones(summary.ltspZone),
    personalRecords: parsePersonalRecordGroups(summary.recordDetailList),
    sleepHrv: parseSleepHrvSummary(summary.sleepHrvData),
    sportDataCount: toOptionalNumber(dashboard.sportDataSummary?.count),
    raw: dashboard as Record<string, unknown>
  };
}

function parseThresholdZones(raw: unknown): TrainingHubThresholdZone[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const zones: TrainingHubThresholdZone[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const zone = item as Record<string, unknown>;
    const index = toOptionalNumber(zone.index);

    if (index === undefined) {
      continue;
    }

    zones.push({
      index,
      hr: toOptionalNumber(zone.hr),
      pace: toOptionalNumber(zone.pace),
      ratio: toOptionalNumber(zone.ratio)
    });
  }

  return zones.sort((left, right) => left.index - right.index);
}

const RECORD_TYPE_BEST_PACE = 102;
const RECORD_TYPE_LONGEST_RUN = 101;
const RECORD_TYPE_ELEVATION_GAIN = 103;

function isPlausiblePaceSecondsPerKm(value: number): boolean {
  return value >= 120 && value <= 900;
}

function corosCentimetersToMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value / 100;
}

function normalizePersonalRecordDuration(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value >= 10_000 ? value / 100 : value;
}

function normalizePersonalRecordPace(
  type: number,
  record?: number,
  avgPace?: number
): number | undefined {
  if (avgPace !== undefined) {
    const normalized = normalizePersonalRecordPaceValue(avgPace);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  if (type === RECORD_TYPE_BEST_PACE && record !== undefined) {
    return normalizePersonalRecordPaceValue(record);
  }

  return undefined;
}

function normalizePersonalRecordPaceValue(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  if (isPlausiblePaceSecondsPerKm(value)) {
    return value;
  }

  const fromMilliseconds = value / 1000;
  if (isPlausiblePaceSecondsPerKm(fromMilliseconds)) {
    return fromMilliseconds;
  }

  const fromCentiseconds = value / 100;
  if (isPlausiblePaceSecondsPerKm(fromCentiseconds)) {
    return fromCentiseconds;
  }

  return undefined;
}

function derivePersonalRecordPaceFromDuration(
  type: number,
  duration?: number
): number | undefined {
  const knownDistance = DISTANCE_PR_DISTANCE_METERS[type];

  if (
    duration === undefined ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    knownDistance === undefined
  ) {
    return undefined;
  }

  return duration / (knownDistance / 1000);
}

function derivePersonalRecordPaceFromDistance(
  distanceMeters?: number,
  duration?: number
): number | undefined {
  if (
    distanceMeters === undefined ||
    duration === undefined ||
    distanceMeters <= 0 ||
    duration <= 0
  ) {
    return undefined;
  }

  return duration / (distanceMeters / 1000);
}

function resolveDistancePersonalRecordPace(
  type: number,
  duration?: number,
  rawAvgPace?: number
): number | undefined {
  return (
    derivePersonalRecordPaceFromDuration(type, duration) ??
    normalizePersonalRecordPace(type, undefined, rawAvgPace)
  );
}

function normalizeElevationGainMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  if (value >= 10_000) {
    return Math.round(value / 100);
  }

  // COROS often encodes meters * 100 (8400 → 84 m).
  if (value >= 500 && Number.isInteger(value) && value % 100 === 0) {
    const fromCentimeters = value / 100;
    if (fromCentimeters >= 1 && fromCentimeters <= 5000) {
      return Math.round(fromCentimeters);
    }
  }

  return Math.round(value);
}

function resolveElevationGainMeters(raw: Record<string, unknown>): number | undefined {
  const candidates = [
    "record",
    "recordDis",
    "recordValue",
    "time",
    "distance",
    "ascent",
    "elevGain",
    "totalAscent",
    "value"
  ]
    .map((key) => normalizeElevationGainMeters(toOptionalNumber(raw[key])))
    .filter((value): value is number => value !== undefined && value > 0);

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.max(...candidates);
}

function isCorosFiveKPersonalRecord(
  raw: Record<string, unknown>,
  resolvedType: number
): boolean {
  if (resolvedType !== 5 && resolvedType !== 10) {
    return true;
  }

  const rawType = toOptionalNumber(raw.type) ?? 0;

  if (rawType === 5) {
    return true;
  }

  const rawRecord = toOptionalNumber(raw.record);

  if (rawRecord !== undefined && rawRecord >= 10_000) {
    return true;
  }

  const distance = pickDistanceScalar(raw);

  if (distance === undefined) {
    return true;
  }

  return Math.abs(distance - 5000) <= 100;
}

function distancePersonalRecordQuality(
  record: TrainingHubPersonalRecord
): number {
  if (record.type !== 5 && record.type !== 10) {
    return 0;
  }

  if (record.apiType === 5) {
    return 3;
  }

  if (
    record.distance !== undefined &&
    Math.abs(record.distance - 5000) <= 100
  ) {
    return 2;
  }

  return 1;
}

function inferDistanceRecordType(
  name: string,
  distanceMeters?: number
): number | undefined {
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "");

  const nameAliases: Record<string, number> = {
    "1k": 7,
    "1km": 7,
    "3k": 6,
    "3km": 6,
    "5k": 5,
    "5km": 5,
    "10k": 11,
    "10km": 11,
    "1mile": 8,
    "2mile": 9,
    halfmarathon: 12,
    marathon: 13
  };

  if (nameAliases[normalizedName]) {
    return nameAliases[normalizedName];
  }

  if (distanceMeters === undefined || distanceMeters <= 0) {
    return undefined;
  }

  const roundedDistance = Math.round(distanceMeters);
  const distanceAliases: Record<number, number> = {
    1000: 7,
    3000: 6,
    5000: 5,
    10000: 11,
    1609: 8,
    3218: 9,
    21097: 12,
    42195: 13
  };

  return distanceAliases[roundedDistance];
}

function isCorosBestPaceRecord(raw: Record<string, unknown>): boolean {
  const record = pickRecordScalar(raw);
  const avgPace = toOptionalNumber(raw.avgPace);

  if (record === undefined || avgPace === undefined) {
    return false;
  }

  const normalizedRecord = normalizePersonalRecordPaceValue(record);
  const normalizedAvgPace = normalizePersonalRecordPaceValue(avgPace);

  if (
    normalizedRecord === undefined ||
    normalizedAvgPace === undefined ||
    !isPlausiblePaceSecondsPerKm(normalizedRecord)
  ) {
    return false;
  }

  return Math.abs(normalizedRecord - normalizedAvgPace) <= 2;
}

function resolvePersonalRecordType(
  raw: Record<string, unknown>,
  type: number
): number {
  const name = pickString(raw, ["name", "site"])?.toLowerCase() ?? "";

  if (name.includes("longest run") || name.includes("longest ride")) {
    return RECORD_TYPE_LONGEST_RUN;
  }

  if (
    name.includes("elevation") ||
    name.includes("elev gain") ||
    name.includes("elevgain") ||
    name.includes("most elev")
  ) {
    return RECORD_TYPE_ELEVATION_GAIN;
  }

  if (name.includes("best pace")) {
    return RECORD_TYPE_BEST_PACE;
  }

  if (type === 100) {
    return RECORD_TYPE_LONGEST_RUN;
  }

  // COROS uses type 102 for both best pace and most elevation gain.
  if (type === RECORD_TYPE_BEST_PACE) {
    return isCorosBestPaceRecord(raw)
      ? RECORD_TYPE_BEST_PACE
      : RECORD_TYPE_ELEVATION_GAIN;
  }

  if (RECORD_TYPE_LABELS[type]) {
    return type;
  }

  const rawDistance = pickDistanceScalar(raw);
  const inferredType = inferDistanceRecordType(name, rawDistance);

  if (inferredType !== undefined) {
    return inferredType;
  }

  return type;
}

function normalizePersonalRecordLabelKey(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "").replace(/\.0km$/, "km");

  const labelAliases: Record<string, string> = {
    "5k": "5km",
    "10k": "10km",
    "3k": "3km",
    "1k": "1km"
  };

  return labelAliases[normalized] ?? normalized;
}

function canonicalPersonalRecordKey(record: TrainingHubPersonalRecord): string {
  const aliases: Record<number, string> = {
    5: "5km",
    6: "3km",
    7: "1km",
    8: "1mile",
    9: "2mile",
    10: "5km",
    11: "10km",
    12: "halfmarathon",
    13: "marathon",
    101: "longestrun",
    102: "bestpace",
    103: "mostelevationgain"
  };

  if (aliases[record.type]) {
    return aliases[record.type];
  }

  const inferredType = inferDistanceRecordType(record.label, record.distance);

  if (inferredType !== undefined && aliases[inferredType]) {
    return aliases[inferredType];
  }

  return normalizePersonalRecordLabelKey(record.label);
}

function isNativePersonalRecordType(
  apiType: number | undefined,
  resolvedType: number
): boolean {
  return apiType === resolvedType && RECORD_TYPE_LABELS[resolvedType] !== undefined;
}

function isBetterPersonalRecord(
  candidate: TrainingHubPersonalRecord,
  current: TrainingHubPersonalRecord
): boolean {
  if (candidate.type === RECORD_TYPE_BEST_PACE) {
    return (
      (candidate.avgPace ?? Number.POSITIVE_INFINITY) <
      (current.avgPace ?? Number.POSITIVE_INFINITY)
    );
  }

  if (candidate.type === RECORD_TYPE_LONGEST_RUN) {
    return (candidate.distance ?? 0) > (current.distance ?? 0);
  }

  if (candidate.type === RECORD_TYPE_ELEVATION_GAIN) {
    const candidateNative = isNativePersonalRecordType(candidate.apiType, candidate.type);
    const currentNative = isNativePersonalRecordType(current.apiType, current.type);

    if (candidateNative && !currentNative) {
      return true;
    }

    if (!candidateNative && currentNative) {
      return false;
    }

    return (candidate.distance ?? 0) > (current.distance ?? 0);
  }

  if (DISTANCE_PR_RECORD_TYPES.has(candidate.type)) {
    const candidateQuality = distancePersonalRecordQuality(candidate);
    const currentQuality = distancePersonalRecordQuality(current);

    if (candidateQuality !== currentQuality) {
      return candidateQuality > currentQuality;
    }

    const candidateNative = isNativePersonalRecordType(candidate.apiType, candidate.type);
    const currentNative = isNativePersonalRecordType(current.apiType, current.type);

    if (candidateNative && !currentNative) {
      return true;
    }

    if (!candidateNative && currentNative) {
      return false;
    }

    const candidateDuration = candidate.duration ?? Number.POSITIVE_INFINITY;
    const currentDuration = current.duration ?? Number.POSITIVE_INFINITY;

    if (
      candidateNative &&
      currentNative &&
      candidate.happenDay &&
      candidate.happenDay === current.happenDay &&
      candidateDuration !== currentDuration
    ) {
      // Same-day duplicates are usually overlapping segments; COROS keeps the validated effort.
      return candidateDuration > currentDuration;
    }

    return candidateDuration < currentDuration;
  }

  return false;
}

function createPersonalRecordPlaceholder(
  type: number
): TrainingHubPersonalRecord {
  return {
    type,
    label: RECORD_TYPE_LABELS[type] ?? `Record ${type}`,
    duration: undefined,
    distance: undefined,
    avgPace: undefined,
    happenDay: undefined
  };
}

function ensurePersonalRecordSlots(
  records: TrainingHubPersonalRecord[]
): TrainingHubPersonalRecord[] {
  const presentTypes = new Set(records.map((record) => record.type));
  const placeholders = PERSONAL_RECORD_SLOT_TYPES.filter(
    (type) => !presentTypes.has(type)
  ).map((type) => createPersonalRecordPlaceholder(type));

  return [...records, ...placeholders];
}

function finalizePersonalRecords(
  records: TrainingHubPersonalRecord[]
): TrainingHubPersonalRecord[] {
  const deduped = new Map<string, TrainingHubPersonalRecord>();

  for (const record of records) {
    if (RECORD_TYPE_EXCLUDED.has(record.type)) {
      continue;
    }

    const key = canonicalPersonalRecordKey(record);
    const existing = deduped.get(key);

    if (!existing || isBetterPersonalRecord(record, existing)) {
      deduped.set(key, record);
    }
  }

  const sorted = [...deduped.values()].sort((left, right) => {
    const leftOrder = RECORD_DISPLAY_ORDER[left.type] ?? 99;
    const rightOrder = RECORD_DISPLAY_ORDER[right.type] ?? 99;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.label.localeCompare(right.label);
  });

  return ensurePersonalRecordSlots(sorted);
}

function isPersonalRecordEntryPopulated(
  record: TrainingHubPersonalRecord
): boolean {
  if (record.type === RECORD_TYPE_BEST_PACE) {
    return record.avgPace !== undefined && record.avgPace > 0;
  }

  if (record.type === RECORD_TYPE_LONGEST_RUN || record.type === RECORD_TYPE_ELEVATION_GAIN) {
    return record.distance !== undefined && record.distance > 0;
  }

  if (
    (record.type === 5 || record.type === 10) &&
    record.distance !== undefined &&
    record.distance > 0 &&
    Math.abs(record.distance - 5000) > 100
  ) {
    return false;
  }

  return record.duration !== undefined && record.duration > 0;
}

export function parsePersonalRecordGroups(raw: unknown): TrainingHubPersonalRecordGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const group = item as Record<string, unknown>;
      const type = toOptionalNumber(group.type) ?? 0;
      const recordList = extractArray(group, ["recordList"]) ?? [];

      return {
        type,
        label: RECORD_GROUP_LABELS[type] ?? `Period ${type}`,
        records: finalizePersonalRecords(
          recordList
            .map((record) =>
              parsePersonalRecord(record as Record<string, unknown>, type)
            )
            .filter(
              (record, index) =>
                isPersonalRecordEntryPopulated(record) &&
                isCorosFiveKPersonalRecord(
                  recordList[index] as Record<string, unknown>,
                  record.type
                )
            )
        )
      };
    })
    .filter((group): group is TrainingHubPersonalRecordGroup => group !== null)
    .sort((left, right) => {
      const leftOrder = RECORD_GROUP_DISPLAY_ORDER[left.type] ?? 99;
      const rightOrder = RECORD_GROUP_DISPLAY_ORDER[right.type] ?? 99;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.type - right.type;
    });
}

function parsePersonalRecord(
  raw: Record<string, unknown>,
  _periodGroupType = 4
): TrainingHubPersonalRecord {
  const rawType = toOptionalNumber(raw.type) ?? 0;
  const type = resolvePersonalRecordType(raw, rawType);
  const rawRecord = pickRecordScalar(raw);
  const rawAvgPace = toOptionalNumber(raw.avgPace);
  const rawDistance = pickDistanceScalar(raw);
  const happenDay = normalizePersonalRecordDay(raw);
  let label = RECORD_TYPE_LABELS[type];

  if (!label && rawDistance && rawDistance > 0) {
    label =
      rawDistance >= 1000
        ? `${(rawDistance / 1000).toFixed(rawDistance % 1000 === 0 ? 0 : 1)} km`
        : `${Math.round(rawDistance)} m`;
  }

  if (!label) {
    label = pickString(raw, ["name", "site"]) ?? `Record ${type}`;
  }

  if (RECORD_TYPE_LABELS[type]) {
    label = RECORD_TYPE_LABELS[type];
  }

  if (type === RECORD_TYPE_BEST_PACE) {
    return {
      type,
      apiType: rawType,
      label,
      name: pickString(raw, ["name", "site"]),
      duration: undefined,
      distance: undefined,
      avgPace: normalizePersonalRecordPace(type, rawRecord, rawAvgPace),
      happenDay,
      activityId: pickString(raw, ["labelIdStr", "labelId"])
    };
  }

  if (type === RECORD_TYPE_LONGEST_RUN) {
    const distanceMeters = resolveLongestRunDistanceMeters(raw);
    const duration = resolveLongestRunDuration(raw, distanceMeters);
    const avgPace = resolveLongestRunAvgPace(
      raw,
      rawRecord,
      rawAvgPace,
      distanceMeters,
      duration
    );

    return {
      type,
      apiType: rawType,
      label,
      name: pickString(raw, ["name", "site"]),
      distance: distanceMeters,
      duration,
      avgPace,
      happenDay,
      activityId: pickString(raw, ["labelIdStr", "labelId"])
    };
  }

  if (type === RECORD_TYPE_ELEVATION_GAIN) {
    const elevationMeters = resolveElevationGainMeters(raw);
    const duration = normalizePersonalRecordDuration(toOptionalNumber(raw.duration));

    return {
      type,
      apiType: rawType,
      label,
      name: pickString(raw, ["name", "site"]),
      distance: elevationMeters,
      duration,
      avgPace: normalizePersonalRecordPace(type, rawRecord, rawAvgPace),
      happenDay,
      activityId: pickString(raw, ["labelIdStr", "labelId"])
    };
  }

  const duration = resolveDistancePersonalRecordDuration(type, raw);
  const avgPace = resolveDistancePersonalRecordPace(type, duration, rawAvgPace);

  return {
    type,
    apiType: rawType,
    label,
    name: pickString(raw, ["name", "site"]),
    distance: rawDistance && rawDistance > 0 ? rawDistance : undefined,
    duration,
    avgPace,
    happenDay,
    activityId: pickString(raw, ["labelIdStr", "labelId"])
  };
}

function parseSleepHrvSummary(
  raw: unknown
): TrainingHubSleepHrvSummary | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const data = raw as Record<string, unknown>;
  const readings: TrainingHubSleepHrvReading[] = [];

  if (Array.isArray(data.sleepHrvList)) {
    for (const item of data.sleepHrvList) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const reading = item as Record<string, unknown>;
      const happenDay = normalizeHappenDay(reading.happenDay);

      if (!happenDay) {
        continue;
      }

      readings.push({
        happenDay,
        avgSleepHrv: toOptionalNumber(reading.avgSleepHrv),
        sleepHrvBase: toOptionalNumber(reading.sleepHrvBase)
      });
    }
  }

  return {
    happenDay: normalizeHappenDay(data.happenDay),
    avgSleepHrv: toOptionalNumber(data.avgSleepHrv),
    sleepHrvBase: toOptionalNumber(data.sleepHrvBase),
    remainWearDays: toOptionalNumber(data.remainWearDays),
    recentReadings: readings
  };
}

function normalizeHappenDay(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).trim();

  if (/^\d{8}$/.test(text) && text !== "00000000") {
    return text;
  }

  return undefined;
}

function normalizePersonalRecordDay(
  raw: Record<string, unknown>
): string | undefined {
  for (const key of ["happenDay", "date", "recordDay", "day"]) {
    const happenDay = normalizeHappenDay(raw[key]);

    if (happenDay) {
      return happenDay;
    }
  }

  return undefined;
}

function pickRecordScalar(raw: Record<string, unknown>): number | undefined {
  for (const key of ["record", "recordValue", "value", "best"]) {
    const value = toOptionalNumber(raw[key]);

    if (value !== undefined && value > 0) {
      return value;
    }
  }

  return undefined;
}

function pickNormalizedPersonalRecordDuration(
  raw: Record<string, unknown>,
  key: string
): number | undefined {
  return normalizePersonalRecordDuration(toOptionalNumber(raw[key]));
}

function resolveDistancePersonalRecordDuration(
  type: number,
  raw: Record<string, unknown>
): number | undefined {
  const explicitDuration = pickNormalizedPersonalRecordDuration(raw, "duration");

  if (explicitDuration !== undefined) {
    return explicitDuration;
  }

  const validatedDuration = pickNormalizedPersonalRecordDuration(raw, "best");

  if (validatedDuration !== undefined) {
    return validatedDuration;
  }

  const candidates = [
    pickNormalizedPersonalRecordDuration(raw, "record"),
    pickNormalizedPersonalRecordDuration(raw, "time"),
    pickNormalizedPersonalRecordDuration(raw, "recordValue"),
    pickNormalizedPersonalRecordDuration(raw, "duration")
  ].filter((value): value is number => value !== undefined && value > 0);

  if (candidates.length === 0) {
    return undefined;
  }

  let duration = Math.max(...candidates);

  const knownDistance = DISTANCE_PR_DISTANCE_METERS[type];
  const normalizedPace = normalizePersonalRecordPaceValue(toOptionalNumber(raw.avgPace));

  if (knownDistance !== undefined && normalizedPace !== undefined) {
    const durationFromPace = normalizedPace * (knownDistance / 1000);
    const delta = durationFromPace - duration;

    // COROS sometimes stores average-pace extrapolation in `record` (e.g. timer * 5km / distance)
    // while the validated best-effort time matches `avgPace` (see activity 478506322034196580.fit).
    if (delta > 5 && delta < 120) {
      duration = durationFromPace;
    }
  }

  return duration;
}

function resolveLongestRunDuration(
  raw: Record<string, unknown>,
  distanceMeters?: number
): number | undefined {
  const explicitDuration = normalizePersonalRecordDuration(
    toOptionalNumber(raw.duration)
  );

  if (explicitDuration !== undefined) {
    return explicitDuration;
  }

  const timeDuration = normalizePersonalRecordDuration(toOptionalNumber(raw.time));

  if (
    timeDuration !== undefined &&
    distanceMeters !== undefined &&
    isPlausiblePaceSecondsPerKm(timeDuration / (distanceMeters / 1000))
  ) {
    return timeDuration;
  }

  return undefined;
}

function resolveLongestRunAvgPace(
  raw: Record<string, unknown>,
  rawRecord?: number,
  rawAvgPace?: number,
  distanceMeters?: number,
  duration?: number
): number | undefined {
  const fromApi = normalizePersonalRecordPace(
    RECORD_TYPE_LONGEST_RUN,
    rawRecord,
    rawAvgPace
  );

  if (fromApi !== undefined) {
    return fromApi;
  }

  const derived = derivePersonalRecordPaceFromDistance(distanceMeters, duration);

  if (derived !== undefined && isPlausiblePaceSecondsPerKm(derived)) {
    return derived;
  }

  return undefined;
}

function pickDistanceScalar(raw: Record<string, unknown>): number | undefined {
  for (const key of ["distance", "totalDistance", "dis", "recordDis"]) {
    const value = toOptionalNumber(raw[key]);

    if (value !== undefined && value > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeLongestRunDistanceScalar(value: number): number | undefined {
  if (value >= 100_000) {
    return value / 100;
  }

  if (value >= 1000) {
    return value;
  }

  if (value >= 100) {
    return value * 10;
  }

  const fromCentimeters = value / 100;

  if (fromCentimeters >= 1) {
    return fromCentimeters;
  }

  return undefined;
}

function resolveLongestRunDistanceMeters(
  raw: Record<string, unknown>
): number | undefined {
  const rawRecord = pickRecordScalar(raw);

  if (rawRecord !== undefined) {
    const fromRecord = normalizeLongestRunDistanceScalar(rawRecord);

    if (fromRecord !== undefined) {
      return fromRecord;
    }
  }

  const rawDistance = pickDistanceScalar(raw);

  if (rawDistance !== undefined) {
    return normalizeLongestRunDistanceScalar(rawDistance);
  }

  return undefined;
}

export function parseRacePredictor(
  summary: Record<string, unknown>
): TrainingHubRacePredictor {
  const rawList = Array.isArray(summary.runScoreList) ? summary.runScoreList : [];
  const parsedByType = new Map<number, TrainingHubRaceScore>();

  for (const item of rawList) {
    const parsed = parseRaceScore(item as RawRaceScore);

    if (parsed.predictSeconds === undefined) {
      continue;
    }

    const raceType = resolveRacePredictorType(item as RawRaceScore);

    if (raceType !== undefined) {
      parsedByType.set(raceType, parsed);
    } else {
      parsedByType.set(parsedByType.size, parsed);
    }
  }

  const runScoreList = RACE_PREDICTOR_DISPLAY_ORDER.map((type) =>
    parsedByType.get(type)
  ).filter((entry): entry is TrainingHubRaceScore => entry !== undefined);

  if (runScoreList.length === 0) {
    for (const entry of parsedByType.values()) {
      runScoreList.push(entry);
    }
  }

  return {
    staminaLevel: toOptionalNumber(summary.staminaLevel),
    recoveryPct: toOptionalNumber(summary.recoveryPct),
    aerobicEnduranceScore: toOptionalNumber(summary.aerobicEnduranceScore),
    lactateThresholdCapacityScore: toOptionalNumber(
      summary.lactateThresholdCapacityScore
    ),
    anaerobicEnduranceScore: toOptionalNumber(summary.anaerobicEnduranceScore),
    anaerobicCapacityScore: toOptionalNumber(summary.anaerobicCapacityScore),
    lthr: toOptionalNumber(summary.lthr),
    ltsp: toOptionalNumber(summary.ltsp),
    runScoreList,
    raw: summary
  };
}

function resolveRacePredictorType(raw: RawRaceScore): number | undefined {
  const raceType = toOptionalNumber(raw.type) ?? toOptionalNumber(raw.raceType);

  if (raceType === undefined) {
    return undefined;
  }

  return Math.trunc(raceType);
}

function parseRaceScore(raw: RawRaceScore): TrainingHubRaceScore {
  const raceType = resolveRacePredictorType(raw);
  const distance =
    toOptionalNumber(raw.distance) ??
    (raceType !== undefined
      ? RACE_PREDICTOR_TYPE_DISTANCE_METERS[raceType]
      : undefined);
  const predictSeconds =
    toOptionalNumber(raw.duration) ??
    toOptionalNumber(raw.predictSecond) ??
    toOptionalNumber(raw.predictTime) ??
    toOptionalNumber(raw.time);
  const distanceLabel =
    (raceType !== undefined ? RACE_PREDICTOR_TYPE_LABELS[raceType] : undefined) ??
    formatRaceDistanceLabel(distance, raw.raceName, raw.raceType);

  return {
    distance,
    distanceLabel,
    predictSeconds,
    avgPace: toOptionalNumber(raw.avgPace),
    score: toOptionalNumber(raw.score),
    raw
  };
}

function normalizeActivityDuration(value?: number): number | undefined {
  const normalized = normalizePersonalRecordDuration(value);
  return normalized === undefined ? undefined : Math.round(normalized);
}

function normalizeCorosDetailDistanceMeters(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  // COROS detail payloads store distance at 0.01 m precision (see splitlog cmToKm / 100_000).
  return value / 100;
}

function normalizeActivityDistanceMeters(value?: number): number | undefined {
  return normalizeCorosDetailDistanceMeters(value);
}

function normalizeActivityElevationMeters(value?: number): number | undefined {
  return normalizeElevationGainMeters(value);
}

function normalizeActivityCalories(value: unknown): number | undefined {
  const numeric = toOptionalNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  return numeric > 1000 ? Math.round(numeric / 1000) : Math.round(numeric);
}

function pickActivityCalories(
  raw: Record<string, unknown>,
  summary: Record<string, unknown>
): number | undefined {
  return normalizeActivityCalories(
    raw.calorie ?? raw.calories ?? summary.calorie ?? summary.calories
  );
}

function pickActivityNumber(
  raw: Record<string, unknown>,
  summary: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const fromRaw = toOptionalNumber(raw[key]);
    if (fromRaw !== undefined) {
      return fromRaw;
    }

    const fromSummary = toOptionalNumber(summary[key]);
    if (fromSummary !== undefined) {
      return fromSummary;
    }
  }

  return undefined;
}

function isPopulatedActivityLap(lap: TrainingHubActivityLap): boolean {
  return (
    (lap.distance !== undefined && lap.distance > 0) ||
    (lap.duration !== undefined && lap.duration > 0)
  );
}

function flattenLapItems(entry: unknown): Record<string, unknown>[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const lap = entry as Record<string, unknown>;
  const nested = pickArray(lap, ["lapItemList", "itemList", "items"]);

  if (nested?.length) {
    return nested.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
    );
  }

  return [lap];
}

function lapGroupSignature(items: Record<string, unknown>[]): string {
  return JSON.stringify(
    items.map((item) => [
      item.distance ?? item.totalDistance,
      item.totalTime ?? item.duration
    ])
  );
}

function hasNestedLapItems(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const lap = entry as Record<string, unknown>;
  const nested = pickArray(lap, ["lapItemList", "itemList", "items"]);
  return Boolean(nested?.length);
}

function extractActivityLaps(raw: Record<string, unknown>): TrainingHubActivityLap[] {
  const summary = pickObject(raw, ["summaryInfo", "summary", "activitySummary"]) ?? raw;
  const candidateGroups: Record<string, unknown>[][] = [];
  const seen = new Set<string>();

  for (const source of [raw, summary]) {
    const lapList = pickArray(source, ["lapList", "laps", "lapInfoList"]) ?? [];

    if (lapList.length === 0) {
      continue;
    }

    const usesNestedLaps = lapList.some((entry) => hasNestedLapItems(entry));

    if (!usesNestedLaps) {
      const flatLaps = lapList.map((item, index) => parseActivityLap(item, index));

      if (flatLaps.some(isPopulatedActivityLap)) {
        return flatLaps.map((lap, index) => ({ ...lap, index: index + 1 }));
      }
    }

    for (const entry of lapList) {
      const items = flattenLapItems(entry);
      if (items.length === 0) {
        continue;
      }

      const signature = lapGroupSignature(items);
      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      candidateGroups.push(items);
    }
  }

  let bestLaps: TrainingHubActivityLap[] = [];

  for (const items of candidateGroups) {
    const parsed = items.map((item, index) => parseActivityLap(item, index));
    const populatedCount = parsed.filter(isPopulatedActivityLap).length;
    const bestPopulatedCount = bestLaps.filter(isPopulatedActivityLap).length;

    if (
      populatedCount > bestPopulatedCount ||
      (populatedCount === bestPopulatedCount && parsed.length > bestLaps.length)
    ) {
      bestLaps = parsed;
    }
  }

  return bestLaps.map((lap, index) => ({ ...lap, index: index + 1 }));
}

function normalizeGpsCoordinate(value: number): number | undefined {
  if (!Number.isFinite(value) || value === 0) {
    return undefined;
  }

  const abs = Math.abs(value);
  if (abs <= 180) {
    return value;
  }

  if (abs < 1e10) {
    return value / 1e7;
  }

  return undefined;
}

function normalizeTrackElevation(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  const abs = Math.abs(value);

  if (abs > 500) {
    return value / 100;
  }

  return value;
}

function pickNumberArray(
  obj: Record<string, unknown>,
  keys: string[]
): number[] | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }

    const numbers = value
      .map((entry) => toOptionalNumber(entry))
      .filter((entry): entry is number => entry !== undefined);

    if (numbers.length > 0) {
      return numbers;
    }
  }

  return undefined;
}

function decimateTrackPoints(
  points: TrainingHubTrackPoint[],
  maxPoints = 400
): TrainingHubTrackPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = points.length / maxPoints;
  const result: TrainingHubTrackPoint[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    result.push(points[Math.floor(index * step)]!);
  }

  const lastPoint = points[points.length - 1]!;
  if (result[result.length - 1] !== lastPoint) {
    result.push(lastPoint);
  }

  return result;
}

function buildTrackFromParallelArrays(
  lats: number[],
  lons: number[],
  altitudes?: number[],
  distances?: number[]
): TrainingHubTrackPoint[] {
  const length = Math.min(lats.length, lons.length);
  const points: TrainingHubTrackPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const lat = normalizeGpsCoordinate(lats[index]!);
    const lon = normalizeGpsCoordinate(lons[index]!);

    if (lat === undefined || lon === undefined) {
      continue;
    }

    if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) {
      continue;
    }

    const elevation = altitudes?.[index];
    const distance = distances?.[index];

    points.push({
      lat,
      lon,
      elevation:
        elevation !== undefined ? normalizeTrackElevation(elevation) : undefined,
      distance:
        distance !== undefined
          ? normalizeActivityDistanceMeters(distance)
          : undefined
    });
  }

  return points;
}

function normalizeFrequencyDistanceMeters(value?: number): number | undefined {
  return normalizeCorosDetailDistanceMeters(value);
}

function parseTrackPointObject(raw: Record<string, unknown>): TrainingHubTrackPoint | undefined {
  const lat = normalizeGpsCoordinate(
    toOptionalNumber(raw.lat ?? raw.latitude ?? raw.gpsLat ?? raw.y) ?? 0
  );
  const lon = normalizeGpsCoordinate(
    toOptionalNumber(raw.lon ?? raw.longitude ?? raw.gpsLon ?? raw.x) ?? 0
  );
  const elevation = normalizeTrackElevation(
    toOptionalNumber(raw.altitude ?? raw.alt ?? raw.elev ?? raw.elevation)
  );
  const distance = normalizeFrequencyDistanceMeters(
    toOptionalNumber(raw.distance ?? raw.totalDistance ?? raw.dis)
  );

  if (
    lat === undefined &&
    lon === undefined &&
    elevation === undefined &&
    distance === undefined
  ) {
    return undefined;
  }

  const point: TrainingHubTrackPoint = {};

  if (lat !== undefined && lon !== undefined) {
    point.lat = lat;
    point.lon = lon;
  }

  if (elevation !== undefined) {
    point.elevation = elevation;
  }

  if (distance !== undefined) {
    point.distance = distance;
  }

  return point;
}

function parseTrackFromFrequencyList(raw: unknown): TrainingHubTrackPoint[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const points: TrainingHubTrackPoint[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const point = parseTrackPointObject(item as Record<string, unknown>);
    if (point) {
      points.push(point);
    }
  }

  return points;
}

function mergeActivityTracks(
  existing: TrainingHubActivityTrack | undefined,
  incoming: TrainingHubActivityTrack
): TrainingHubActivityTrack {
  if (!existing?.points.length) {
    return incoming;
  }

  const existingHasGps = existing.points.some(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  const incomingHasGps = incoming.points.some(
    (point) => point.lat !== undefined && point.lon !== undefined
  );
  const existingHasElevation = existing.points.some(
    (point) => point.elevation !== undefined
  );
  const incomingHasElevation = incoming.points.some(
    (point) => point.elevation !== undefined
  );

  if (existingHasGps && existingHasElevation) {
    return existing;
  }

  if (incomingHasGps && !existingHasGps) {
    if (existingHasElevation && !incomingHasElevation) {
      return {
        points: incoming.points.map((point, index) => ({
          ...point,
          elevation: point.elevation ?? existing.points[index]?.elevation
        }))
      };
    }

    return incoming;
  }

  if (incomingHasElevation && !existingHasElevation) {
    return {
      points: existing.points.map((point, index) => ({
        ...point,
        elevation: point.elevation ?? incoming.points[index]?.elevation,
        distance: point.distance ?? incoming.points[index]?.distance
      }))
    };
  }

  return existing.points.length >= incoming.points.length ? existing : incoming;
}

async function fetchActivityTrackFromGpx(
  activityId: string,
  sportType: number
): Promise<TrainingHubActivityTrack | undefined> {
  try {
    const fileUrl = await getTrainingHubActivityFileUrl(activityId, sportType, 1);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      return undefined;
    }

    return parseGpxTrack(await response.text());
  } catch {
    return undefined;
  }
}

function parseGpxTrack(gpx: string): TrainingHubActivityTrack | undefined {
  const points: TrainingHubTrackPoint[] = [];
  const trackPointPattern =
    /<trkpt[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;

  for (const match of gpx.matchAll(trackPointPattern)) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const body = match[3] ?? "";
    const elevationMatch = /<ele>([^<]+)<\/ele>/i.exec(body);
    const elevation = elevationMatch ? Number(elevationMatch[1]) : undefined;

    points.push({
      lat,
      lon,
      elevation:
        elevation !== undefined && Number.isFinite(elevation)
          ? elevation
          : undefined
    });
  }

  if (points.length < 2) {
    return undefined;
  }

  return { points: decimateTrackPoints(points) };
}

function hasRoutePoints(points: TrainingHubTrackPoint[]): boolean {
  return (
    points.filter((point) => point.lat !== undefined && point.lon !== undefined)
      .length >= 2
  );
}

function hasElevationPoints(points: TrainingHubTrackPoint[]): boolean {
  return (
    points.filter((point) => point.elevation !== undefined).length >= 2
  );
}

function parseTrackFromSeriesObject(source: Record<string, unknown>): TrainingHubTrackPoint[] {
  const lats = pickNumberArray(source, [
    "latitude",
    "lat",
    "gpsLat",
    "gpsLatList",
    "latList"
  ]);
  const lons = pickNumberArray(source, [
    "longitude",
    "lon",
    "gpsLon",
    "gpsLonList",
    "lonList"
  ]);

  if (!lats || !lons) {
    return [];
  }

  return buildTrackFromParallelArrays(
    lats,
    lons,
    pickNumberArray(source, [
      "altitude",
      "elev",
      "elevation",
      "altitudeList",
      "altList"
    ]),
    pickNumberArray(source, ["distance", "distanceList", "disList"])
  );
}

function parseTrackFromPointList(source: Record<string, unknown>): TrainingHubTrackPoint[] {
  const pointList =
    pickArray(source, ["pointList", "points", "gpsList", "trackList"]) ?? [];
  const points: TrainingHubTrackPoint[] = [];

  for (const entry of pointList) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const point = entry as Record<string, unknown>;
    const lat = normalizeGpsCoordinate(
      toOptionalNumber(point.latitude ?? point.lat ?? point.gpsLat) ?? 0
    );
    const lon = normalizeGpsCoordinate(
      toOptionalNumber(point.longitude ?? point.lon ?? point.gpsLon) ?? 0
    );

    if (lat === undefined || lon === undefined) {
      continue;
    }

    points.push({
      lat,
      lon,
      elevation: normalizeTrackElevation(
        toOptionalNumber(point.altitude ?? point.elev ?? point.elevation)
      ),
      distance: normalizeActivityDistanceMeters(
        toOptionalNumber(point.distance ?? point.totalDistance)
      )
    });
  }

  return points;
}

function trackCandidateScore(points: TrainingHubTrackPoint[]): number {
  let score = 0;

  for (const point of points) {
    if (point.lat !== undefined && point.lon !== undefined) {
      score += 100;
    }

    if (point.elevation !== undefined) {
      score += 1;
    }
  }

  return score;
}

function combineTrackCandidates(
  candidates: TrainingHubTrackPoint[][]
): TrainingHubTrackPoint[] {
  const ranked = candidates
    .filter((points) => points.length > 0)
    .sort((left, right) => trackCandidateScore(right) - trackCandidateScore(left));

  if (ranked.length === 0) {
    return [];
  }

  const best = ranked[0]!;
  const elevationSource =
    ranked.find((points) =>
      points.some((point) => point.elevation !== undefined)
    ) ?? best;
  const gpsSource =
    ranked.find((points) =>
      points.some((point) => point.lat !== undefined && point.lon !== undefined)
    ) ?? best;

  const length = Math.max(best.length, elevationSource.length, gpsSource.length);
  const combined: TrainingHubTrackPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const gpsPoint = gpsSource[index];
    const elevationPoint = elevationSource[index];
    const basePoint = best[index] ?? gpsPoint ?? elevationPoint;

    if (!basePoint && !gpsPoint && !elevationPoint) {
      continue;
    }

    combined.push({
      lat: gpsPoint?.lat ?? basePoint?.lat,
      lon: gpsPoint?.lon ?? basePoint?.lon,
      elevation: elevationPoint?.elevation ?? basePoint?.elevation,
      distance: elevationPoint?.distance ?? basePoint?.distance ?? gpsPoint?.distance
    });
  }

  return combined;
}

function collectGraphListCandidates(graphList: unknown): TrainingHubTrackPoint[][] {
  const candidates: TrainingHubTrackPoint[][] = [];

  if (Array.isArray(graphList)) {
    for (const item of graphList) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const series = item as Record<string, unknown>;
      candidates.push(parseTrackFromFrequencyList(series.frequencyList));
      candidates.push(parseTrackFromSeriesObject(series));
      candidates.push(parseTrackFromPointList(series));
    }
  } else if (graphList && typeof graphList === "object") {
    const series = graphList as Record<string, unknown>;
    candidates.push(parseTrackFromFrequencyList(series.frequencyList));
    candidates.push(parseTrackFromSeriesObject(series));
    candidates.push(parseTrackFromPointList(series));
  }

  return candidates;
}

function parseActivityTrack(raw: Record<string, unknown>): TrainingHubActivityTrack | undefined {
  const candidates: TrainingHubTrackPoint[][] = [];

  if (Array.isArray(raw.frequencyList)) {
    candidates.push(parseTrackFromFrequencyList(raw.frequencyList));
  }

  candidates.push(...collectGraphListCandidates(raw.graphList));

  const gpsLightDuration = raw.gpsLightDuration;
  if (Array.isArray(gpsLightDuration)) {
    candidates.push(parseTrackFromFrequencyList(gpsLightDuration));
  } else if (gpsLightDuration && typeof gpsLightDuration === "object") {
    candidates.push(
      parseTrackFromSeriesObject(gpsLightDuration as Record<string, unknown>)
    );
  }

  const points = combineTrackCandidates(candidates);

  if (!hasRoutePoints(points) && !hasElevationPoints(points)) {
    return undefined;
  }

  return { points: decimateTrackPoints(points) };
}

function isImplausibleMetricRatio(
  detailValue?: number,
  listValue?: number
): boolean {
  if (
    detailValue === undefined ||
    listValue === undefined ||
    detailValue <= 0 ||
    listValue <= 0
  ) {
    return false;
  }

  const ratio = detailValue / listValue;
  return ratio > 10 || ratio < 0.1;
}

function coalesceActivityMetric(
  detailValue: number | undefined,
  listValue: number | undefined
): number | undefined {
  if (detailValue === undefined) {
    return listValue;
  }

  if (listValue === undefined) {
    return detailValue;
  }

  if (isImplausibleMetricRatio(detailValue, listValue)) {
    return listValue;
  }

  return detailValue;
}

export function mergeActivityDetailWithList(
  detail: TrainingHubActivityDetail,
  listActivity: TrainingHubActivity
): TrainingHubActivityDetail {
  return {
    ...detail,
    activityId: detail.activityId ?? listActivity.activityId,
    name: detail.name ?? listActivity.name,
    sportType: detail.sportType ?? listActivity.sportType,
    startTime: detail.startTime ?? listActivity.startTime,
    duration: coalesceActivityMetric(detail.duration, listActivity.duration),
    distance: coalesceActivityMetric(detail.distance, listActivity.distance),
    avgHr: coalesceActivityMetric(detail.avgHr, listActivity.avgHr),
    maxHr: coalesceActivityMetric(detail.maxHr, listActivity.maxHr),
    calories: coalesceActivityMetric(detail.calories, listActivity.calories),
    elevationGain: coalesceActivityMetric(
      detail.elevationGain,
      listActivity.elevationGain
    ),
    trainingLoad: coalesceActivityMetric(
      detail.trainingLoad,
      listActivity.trainingLoad
    )
  };
}

export function parseActivityDetail(raw: Record<string, unknown>): TrainingHubActivityDetail {
  const summary = pickObject(raw, ["summaryInfo", "summary", "activitySummary"]) ?? raw;
  const laps = extractActivityLaps(raw);
  const track = parseActivityTrack(raw);

  const durationRaw = pickActivityNumber(raw, summary, [
    "totalTime",
    "duration",
    "workoutTime"
  ]);
  const distanceRaw = pickActivityNumber(raw, summary, ["distance", "totalDistance"]);
  const elevationRaw = pickActivityNumber(raw, summary, [
    "ascent",
    "elevationGain",
    "totalAscent",
    "elevGain"
  ]);

  return {
    activityId:
      pickString(raw, ["labelId", "activityId"]) ??
      pickString(summary, ["labelId", "activityId"]),
    name: pickString(raw, ["name"]) ?? pickString(summary, ["name"]),
    sportType:
      toOptionalNumber(raw.sportType) ?? toOptionalNumber(summary.sportType),
    startTime:
      toOptionalNumber(raw.startTime) ??
      toOptionalNumber(summary.startTime) ??
      toOptionalNumber(summary.startTimestamp),
    duration: normalizeActivityDuration(durationRaw),
    distance: normalizeActivityDistanceMeters(distanceRaw),
    avgHr:
      toOptionalNumber(raw.avgHr) ??
      toOptionalNumber(summary.avgHr),
    maxHr:
      toOptionalNumber(raw.maxHr) ??
      toOptionalNumber(summary.maxHr),
    calories: pickActivityCalories(raw, summary),
    elevationGain: normalizeActivityElevationMeters(elevationRaw),
    trainingLoad:
      toOptionalNumber(raw.trainingLoad) ??
      toOptionalNumber(summary.trainingLoad),
    laps,
    track,
    raw
  };
}

function parseActivityLap(raw: unknown, index: number): TrainingHubActivityLap {
  if (!raw || typeof raw !== "object") {
    return { index: index + 1 };
  }

  const lap = raw as Record<string, unknown>;
  const distanceRaw =
    toOptionalNumber(lap.distance) ?? toOptionalNumber(lap.totalDistance);
  const durationRaw =
    toOptionalNumber(lap.totalTime) ??
    toOptionalNumber(lap.time) ??
    toOptionalNumber(lap.duration);

  let duration = normalizeActivityDuration(durationRaw);

  if (!duration) {
    const startTimestamp = toOptionalNumber(lap.startTimestamp);
    const endTimestamp = toOptionalNumber(lap.endTimestamp);

    if (
      startTimestamp !== undefined &&
      endTimestamp !== undefined &&
      endTimestamp > startTimestamp
    ) {
      duration = normalizeActivityDuration(endTimestamp - startTimestamp);
    }
  }

  const avgPace = toOptionalNumber(lap.avgPace);

  return {
    index: index + 1,
    distance: normalizeActivityDistanceMeters(distanceRaw),
    duration,
    avgHr: toOptionalNumber(lap.avgHr),
    maxHr: toOptionalNumber(lap.maxHr),
    pace:
      (avgPace !== undefined &&
      isPlausiblePaceSecondsPerKm(normalizeActivityDuration(avgPace) ?? avgPace)
        ? normalizeActivityDuration(avgPace) ?? avgPace
        : undefined) ??
      toOptionalNumber(lap.avgSpeed),
    elevationGain: normalizeActivityElevationMeters(
      toOptionalNumber(lap.ascent) ??
        toOptionalNumber(lap.elevationGain) ??
        toOptionalNumber(lap.elevGain)
    )
  };
}

function extractDayList(raw: Record<string, unknown>): unknown[] {
  return extractArray(raw, [
    "dayList",
    "dayDetailList",
    "dataList",
    "evoLab.dayList",
    "evoLab.dayDetailList"
  ]);
}

function extractSportStatistics(
  raw: Record<string, unknown>
): TrainingHubSportStatistic[] {
  const list = extractArray(raw, [
    "sportStatistic",
    "sportStatistics",
    "evoLab.sportStatistic",
    "evoLab.sportStatistics"
  ]);

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      sportType: toOptionalNumber(item.sportType),
      sportName: pickString(item, ["sportName", "name"]),
      distance: toOptionalNumber(item.distance),
      duration: toOptionalNumber(item.duration),
      count: toOptionalNumber(item.count),
      trainingLoad: toOptionalNumber(item.trainingLoad)
    }));
}

function extractArray(raw: Record<string, unknown>, paths: string[]): Record<string, unknown>[] {
  for (const path of paths) {
    const value = pickPath(raw, path);
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object"
      );
    }
  }

  return [];
}

function pickPath(raw: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = raw;

  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function pickObject(
  raw: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return undefined;
}

function pickArray(raw: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return undefined;
}

function pickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

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

function normalizeCalories(value: unknown): number | undefined {
  const numeric = toOptionalNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  return numeric > 1000 ? Math.round(numeric / 1000) : Math.round(numeric);
}

function formatRaceDistanceLabel(
  distance?: number,
  raceName?: string,
  raceType?: number | string
): string | undefined {
  if (raceName?.trim()) {
    return raceName.trim();
  }

  if (distance) {
    if (distance >= 40_000) {
      return "Marathon";
    }
    if (distance >= 20_000) {
      return "Half Marathon";
    }
    if (distance >= 9_000) {
      return "10K";
    }
    if (distance >= 4_000) {
      return "5K";
    }

    return `${(distance / 1000).toFixed(1)} km`;
  }

  if (raceType !== undefined) {
    return String(raceType);
  }

  return undefined;
}

async function trainingHubGet<T>(
  path: string,
  params?: Record<string, string | number>
): Promise<T> {
  return trainingHubRequest<T>(path, { method: "GET", params });
}

async function trainingHubFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  return trainingHubRequest<T>(path, options);
}

async function trainingHubRequest<T>(
  path: string,
  options: RequestInit & {
    params?: Record<string, string | number>;
  } = {}
): Promise<T> {
  const auth = getStoredAuth();
  if (!auth) {
    throw new Error("Log in to COROS Training Hub first.");
  }

  try {
    return await executeTrainingHubRequest<T>(auth, path, options);
  } catch (error) {
    const retryReason = getTrainingHubRetryReason(error);
    if (!retryReason) {
      throw error;
    }

    const resolvedBaseUrl = await resolveTrainingHubBaseUrl(
      auth.accessToken,
      auth.baseUrl
    );
    if (resolvedBaseUrl === auth.baseUrl) {
      if (retryReason === "token") {
        clearTrainingHubAuth();
        throw new Error("COROS session expired. Log in again.");
      }

      throw error;
    }

    setSetting(SETTINGS.baseUrl, resolvedBaseUrl);

    try {
      return await executeTrainingHubRequest<T>(
        { ...auth, baseUrl: resolvedBaseUrl },
        path,
        options
      );
    } catch (retryError) {
      if (retryReason === "token") {
        clearTrainingHubAuth();
        throw new Error("COROS session expired. Log in again.");
      }

      throw retryError;
    }
  }
}

async function executeTrainingHubRequest<T>(
  auth: TrainingHubAuthState,
  path: string,
  options: RequestInit & {
    params?: Record<string, string | number>;
  } = {}
): Promise<T> {
  const { params, ...requestOptions } = options;
  const url = new URL(`${auth.baseUrl}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    ...buildTrainingHubHeaders(auth.accessToken),
    ...(requestOptions.headers as Record<string, string> | undefined)
  };

  if (requestOptions.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return fetchJson<T>(url.toString(), {
    ...requestOptions,
    headers
  });
}

async function resolveTrainingHubBaseUrl(
  accessToken: string,
  loginBaseUrl: string
): Promise<string> {
  if (await probeTrainingHubBaseUrl(accessToken, loginBaseUrl)) {
    return loginBaseUrl;
  }

  for (const baseUrl of REGION_PROBE_URLS) {
    if (baseUrl === loginBaseUrl) {
      continue;
    }

    if (await probeTrainingHubBaseUrl(accessToken, baseUrl)) {
      return baseUrl;
    }
  }

  return (
    REGION_BASE_URLS["1"] ??
    loginBaseUrl ??
    GLOBAL_BASE_URL
  );
}

async function probeTrainingHubBaseUrl(
  accessToken: string,
  baseUrl: string
): Promise<boolean> {
  const candidates = [
    `${baseUrl}/activity/query?size=1&pageNumber=1`,
    `${baseUrl}/account/query`
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: buildTrainingHubHeaders(accessToken)
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as TrainingHubApiResponse<unknown>;
      const result = String(payload.result ?? payload.apiCode ?? "");

      if (result === RESULT_SUCCESS) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function getTrainingHubRetryReason(
  error: unknown
): "token" | "not-found" | null {
  if (error instanceof InvalidTrainingHubTokenError) {
    return "token";
  }

  if (
    error instanceof Error &&
    error.message.includes("COROS API request failed: 404")
  ) {
    return "not-found";
  }

  return null;
}

class InvalidTrainingHubTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTrainingHubTokenError";
  }
}

function isInvalidTokenMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("access token is invalid") ||
    normalized.includes("token is invalid")
  );
}

async function fetchJson<T>(
  url: string,
  options: RequestInit
): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(
      `COROS API request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as TrainingHubApiResponse<T>;
  const result = String(payload.result ?? payload.apiCode ?? "");

  if (AUTH_ERROR_CODES.has(result)) {
    clearTrainingHubAuth();
    throw new Error("COROS session expired. Log in again.");
  }

  if (result !== RESULT_SUCCESS) {
    const message = payload.message || "COROS API request failed.";
    if (isInvalidTokenMessage(message)) {
      throw new InvalidTrainingHubTokenError(message);
    }
    throw new Error(message);
  }

  if (payload.data === undefined) {
    throw new Error("COROS API response did not include data.");
  }

  return payload.data;
}

function getStoredAuth(): TrainingHubAuthState | null {
  const accessToken = getSetting(SETTINGS.accessToken);
  const userId = getSetting(SETTINGS.userId);
  const regionId = getSetting(SETTINGS.regionId);
  const baseUrl = getSetting(SETTINGS.baseUrl);

  if (!accessToken || !userId || !regionId || !baseUrl) {
    return null;
  }

  return {
    accessToken,
    userId,
    regionId,
    baseUrl
  };
}

function buildTrainingHubHeaders(accessToken: string): Record<string, string> {
  return {
    accesstoken: accessToken,
    Accept: "application/json, text/plain, */*"
  };
}

function clearTrainingHubAuth(): void {
  deleteSettings([
    SETTINGS.accessToken,
    SETTINGS.userId,
    SETTINGS.regionId,
    SETTINGS.baseUrl
  ]);
}
